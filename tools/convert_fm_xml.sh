#!/bin/bash
# FileMaker XML to DuckDB Conversion Script
#
# This script automates the conversion of FileMaker XML exports to DuckDB database.
# It handles UTF-16 to UTF-8 encoding conversion automatically.
# Supports both single-file and batch processing modes.
#
# Supported XML formats:
#   - SaXML v2.1.0.0+ (FileMaker 19+) with root element <FMSaveAsXML>
#   - SaXML v2.0.0.0 (FileMaker 18.x) is NOT supported — uses legacy root
#     element <FMDynamicTemplate> which is incompatible with the SQL XPath queries.
#     Files with this root element are skipped with a warning.
#
# Usage:
#   convert_fm_xml.sh <xml-filename>         # Single file mode
#   convert_fm_xml.sh --batch                # Batch mode (all XML files)
#   convert_fm_xml.sh --batch --fail-fast    # Batch mode (stop on first error)
#   convert_fm_xml.sh --all                  # Alias for --batch
#   convert_fm_xml.sh --test                 # Test mode (xml-test/ → fm_test.duckdb)
#   convert_fm_xml.sh --test --fail-fast     # Test mode (stop on first error)
#
# Parameters:
#   $1: XML filename OR --batch/--all/--test flag
#   $2: Optional --fail-fast flag (only in batch/test mode)
#
# Exit codes:
#   0 - Success
#   1 - File not found / No files found / Validation error / Some files failed
#   2 - UTF-8 conversion failed
#   3 - DuckDB conversion failed
#   4 - Unsupported XML format (e.g. legacy FMDynamicTemplate)
#   5 - XML preprocessing failed

# Constants
PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd))"
SQL_TEMPLATE="$PROJECT_ROOT/sql/convert_xml.sql"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Locate DuckDB binary — check PATH first, then common install locations
DUCKDB_BIN=""
if command -v duckdb &>/dev/null; then
    DUCKDB_BIN=$(command -v duckdb)
else
    for _candidate in \
        "$HOME/.duckdb/cli/latest/duckdb" \
        "/opt/homebrew/bin/duckdb" \
        "/usr/local/bin/duckdb"; do
        if [ -x "$_candidate" ]; then
            DUCKDB_BIN="$_candidate"
            break
        fi
    done
fi
if [ -z "$DUCKDB_BIN" ]; then
    echo "ERROR: DuckDB CLI not found. Install it from https://duckdb.org/docs/installation/"
    exit 1
fi

# Detect processing mode and --test flag
MODE="single"
FILENAME=""
FAIL_FAST=false
TEST_MODE=false

if [[ "$1" == "--test" ]]; then
    MODE="batch"
    TEST_MODE=true
    if [[ "$2" == "--fail-fast" ]]; then
        FAIL_FAST=true
    fi
elif [[ "$1" == "--batch" ]] || [[ "$1" == "--all" ]]; then
    MODE="batch"
    if [[ "$2" == "--fail-fast" ]]; then
        FAIL_FAST=true
    fi
elif [ -n "$1" ]; then
    MODE="single"
    FILENAME="$1"
else
    echo "ERROR: No argument provided"
    echo "Usage: $0 <xml-filename> | --batch [--fail-fast] | --all [--fail-fast] | --test [--fail-fast]"
    exit 1
fi

# Set directories based on mode
if $TEST_MODE; then
    XML_DIR="$PROJECT_ROOT/xml-test"
    DB_DIR="$PROJECT_ROOT/db"
    DB_FILE="$DB_DIR/fm_test.duckdb"
    LOG_DIR="$PROJECT_ROOT/logs"
    LOG_PREFIX="test_batch_import"
else
    XML_DIR="$PROJECT_ROOT/xml"
    DB_DIR="$PROJECT_ROOT/db"
    DB_FILE="$DB_DIR/fm_catalog.duckdb"
    LOG_DIR="$PROJECT_ROOT/logs"
    LOG_PREFIX="batch_import"
fi

LOG_FILE="$LOG_DIR/${LOG_PREFIX}_${TIMESTAMP}.log"
ERROR_LOG_FILE="$LOG_DIR/${LOG_PREFIX}_${TIMESTAMP}_errors.log"

# REST-API copy target (nur im Produktionsmodus)
REST_API_DB_DIR="$PROJECT_ROOT/rest-api/db"
REST_API_DB_FILE="$REST_API_DB_DIR/fm_catalog.duckdb"
REST_API_RELOAD_URL="${REST_API_RELOAD_URL:-http://localhost:3003/api/admin/reload}"

# ============================================================================
# Function: Sync master DB to rest-api/db/ and trigger server reload.
# Called after a successful import/catalog build in production mode only
# (test mode is explicitly excluded). Curl failure is non-fatal: it just
# means the REST-API server is not running.
# ============================================================================
sync_to_rest_api() {
    # Guard: nur Produktionsmodus
    if $TEST_MODE; then
        return 0
    fi
    if [ ! -f "$DB_FILE" ]; then
        echo "ℹ Skipping rest-api sync: master DB not found at $DB_FILE"
        return 0
    fi

    mkdir -p "$REST_API_DB_DIR"

    # Atomares Replace: erst nach .tmp kopieren, dann mv
    if cp "$DB_FILE" "$REST_API_DB_FILE.tmp" && mv -f "$REST_API_DB_FILE.tmp" "$REST_API_DB_FILE"; then
        echo "✓ Synced master DB to rest-api/db/fm_catalog.duckdb"
    else
        echo "✗ WARNING: Sync to rest-api/db/ failed"
        rm -f "$REST_API_DB_FILE.tmp" 2>/dev/null
        return 1
    fi

    # Reload-Trigger (best effort)
    local CURL_ARGS=(-sS -X POST --max-time 5 -o /dev/null -w "%{http_code}")
    if [ -n "$ADMIN_RELOAD_TOKEN" ]; then
        CURL_ARGS+=(-H "X-Admin-Token: $ADMIN_RELOAD_TOKEN")
    fi

    local HTTP_CODE
    HTTP_CODE=$(curl "${CURL_ARGS[@]}" "$REST_API_RELOAD_URL" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" = "200" ]; then
        echo "✓ REST-API reload triggered ($REST_API_RELOAD_URL)"
    elif [ "$HTTP_CODE" = "000" ]; then
        echo "ℹ REST-API not reachable at $REST_API_RELOAD_URL (ok if not running)"
    else
        echo "✗ REST-API reload returned HTTP $HTTP_CODE"
    fi

    return 0
}

# ============================================================================
# Function: Process a single XML file
# Arguments: $1 = filename (just the basename, not full path)
# Returns: 0 on success, non-zero on error
# ============================================================================
process_single_file() {
    local FILENAME="$1"

    # 1. Validate XML file exists
    if [ ! -f "$XML_DIR/$FILENAME" ]; then
        echo "ERROR: File not found: $FILENAME"
        return 1
    fi

    # 2. Create temporary working directory
    local TEMP_DIR=$(mktemp -d)
    trap "rm -rf '$TEMP_DIR'" RETURN  # Ensure cleanup on return

    # 3. Check file encoding using 'file -I'
    local ENCODING=$(file -I "$XML_DIR/$FILENAME" | grep -o 'charset=[^ ]*' | cut -d= -f2)

    # 4. Convert to UTF-8 if needed (into temp directory)
    local XML_FILE
    if [[ "$ENCODING" == "utf-16le" ]] || [[ "$ENCODING" == "utf-16be" ]]; then
        echo "  Converting from $ENCODING to UTF-8..."
        local BASENAME="${FILENAME%.xml}"
        local UTF8_FILE="${BASENAME}_utf8.xml"

        iconv -f UTF-16 -t UTF-8 "$XML_DIR/$FILENAME" > "$TEMP_DIR/$UTF8_FILE"

        if [ $? -ne 0 ]; then
            echo "  ERROR: UTF-8 conversion failed"
            return 2
        fi

        XML_FILE="$UTF8_FILE"
    else
        # Already UTF-8 or compatible - copy to temp directory
        echo "  File is already UTF-8 compatible (detected: $ENCODING)"
        cp "$XML_DIR/$FILENAME" "$TEMP_DIR/$FILENAME"
        XML_FILE="$FILENAME"
    fi

    # 5. Validate XML root element — only FMSaveAsXML (SaXML v2.1.0.0+) is supported
    local ROOT_ELEMENT=$(head -c 4096 "$TEMP_DIR/$XML_FILE" | grep -oE '<(FMSaveAsXML|FMDynamicTemplate)[ >]' | head -1 | sed 's/[< >]//g')

    if [[ "$ROOT_ELEMENT" == "FMDynamicTemplate" ]]; then
        echo "  WARNING: Skipped — legacy SaXML v2.0.0.0 format (FMDynamicTemplate)"
        echo "  This format (FileMaker 18.x) is not supported. Minimum: SaXML v2.1.0.0 (FileMaker 19+)."
        return 4
    fi

    if [[ -z "$ROOT_ELEMENT" ]]; then
        echo "  WARNING: Skipped — could not detect XML root element (expected FMSaveAsXML)"
        return 4
    fi

    # 5b. Preprocess XML before read_xml. Two transformations:
    #
    #   (a) CR (0x0D) -> DEL (0x7F): FileMaker uses CR as line terminator in
    #       Calculation CDATA. The webbed extension's CleanTextContent()
    #       collapses ASCII whitespace runs (incl. CR/LF/TAB) in element text
    #       to a single space, destroying line structure. DEL is XML 1.0
    #       valid and not ASCII whitespace, so it survives extraction. The
    #       matching replace(col, chr(127), chr(10)) lives in convert_xml.sql.
    #
    #   (b) Strip XML 1.0 invalid C0 control bytes (0x00-0x08, 0x0B, 0x0C,
    #       0x0E-0x1F). FileMaker scripts can contain Char(3) etc., which
    #       libxml2 rejects with "Invalid Input Error: ... contains invalid
    #       XML". Tab (0x09) and LF (0x0A) are explicitly preserved; CR
    #       (0x0D) is already substituted to DEL by step (a) above.
    #
    # tr is byte-oriented but UTF-8 safe here: UTF-8 continuation bytes are
    # always in the 0x80-0xBF range, never 0x0D or any other C0 byte.
    local PREPROCESSED_FILE="${XML_FILE%.xml}_clean.xml"
    local PRE_INPUT="$TEMP_DIR/$XML_FILE"
    local PRE_OUTPUT="$TEMP_DIR/$PREPROCESSED_FILE"

    local PRE_INPUT_SIZE
    PRE_INPUT_SIZE=$(wc -c < "$PRE_INPUT" | tr -d ' ')
    local PRE_CR_COUNT
    PRE_CR_COUNT=$(tr -dc '\r' < "$PRE_INPUT" | wc -c | tr -d ' ')

    if ! tr '\r' '\177' < "$PRE_INPUT" \
            | tr -d '\000-\010\013\014\016-\037' > "$PRE_OUTPUT"; then
        echo "  ERROR: XML preprocessing failed"
        return 5
    fi

    local PRE_OUTPUT_SIZE
    PRE_OUTPUT_SIZE=$(wc -c < "$PRE_OUTPUT" | tr -d ' ')
    local PRE_STRIPPED=$((PRE_INPUT_SIZE - PRE_OUTPUT_SIZE))

    echo "  Preprocessed: replaced_cr=$PRE_CR_COUNT stripped_invalid=$PRE_STRIPPED"
    XML_FILE="$PREPROCESSED_FILE"

    # 6. Create temporary SQL script with correct filename.
    # Das SQL-Template liest FM_XML_DIR per getenv() — wir setzen sie unten beim
    # duckdb-Aufruf auf $TEMP_DIR. Nur der fm_xml-Dateiname wird per sed ersetzt.
    local TEMP_SQL="$TEMP_DIR/convert.sql"
    sed -e "s/SET VARIABLE fm_xml = '.*';/SET VARIABLE fm_xml = '$XML_FILE';/" \
        "$SQL_TEMPLATE" > "$TEMP_SQL"

    # 7. Execute DuckDB conversion
    echo "  Converting XML to DuckDB..."

    # Capture both stdout and stderr to temp file for error logging
    local ERROR_LOG="$TEMP_DIR/error.log"
    if FM_XML_DIR="$TEMP_DIR" "$DUCKDB_BIN" "$DB_FILE" < "$TEMP_SQL" > "$ERROR_LOG" 2>&1; then
        local RESULT=0
    else
        local RESULT=$?
        # On error, output error log to console
        echo "  ERROR: DuckDB conversion failed (exit code: $RESULT)"
        echo "  Error details:"
        cat "$ERROR_LOG" | sed 's/^/    /'
        # Return error log content for batch logging
        cat "$ERROR_LOG"
    fi

    # 8. Report result (cleanup happens automatically via trap)
    if [ $RESULT -eq 0 ]; then
        return 0
    else
        return 3
    fi
}

# ============================================================================
# Main Script Execution
# ============================================================================

if [[ "$MODE" == "batch" ]]; then
    # ========================================================================
    # BATCH MODE: Process all XML files
    # ========================================================================
    echo "========================================="
    if $TEST_MODE; then
        echo "FileMaker XML TEST Import"
        echo "Source: xml-test/ → db/fm_test.duckdb"
    else
        echo "FileMaker XML Batch Import"
    fi
    if $FAIL_FAST; then
        echo "(Fail-Fast Mode: Stop on first error)"
    fi
    echo "========================================="

    # 1. Discover all XML files
    shopt -s nullglob  # Return empty array if no matches
    XML_FILES=("$XML_DIR"/*.xml)
    TOTAL=${#XML_FILES[@]}

    if [ $TOTAL -eq 0 ]; then
        echo "ERROR: No XML files found in $XML_DIR"
        exit 1
    fi

    echo "Found $TOTAL XML files to process"
    echo ""

    # 2. Create logs directory and initialize log file
    mkdir -p "$LOG_DIR"

    cat > "$LOG_FILE" << EOF
================================================================================
FileMaker XML Batch Import Log
================================================================================
Start Time: $(date '+%Y-%m-%d %H:%M:%S')
Total Files: $TOTAL

--------------------------------------------------------------------------------
Per-File Results:
--------------------------------------------------------------------------------
EOF

    # 3. Initialize counters
    SUCCESS_COUNT=0
    SKIPPED_COUNT=0
    declare -a FAILED_FILES
    declare -a SKIPPED_FILES

    # 4. Start timer for entire batch
    BATCH_START=$(date +%s.%N)

    # 5. Process each file
    for i in "${!XML_FILES[@]}"; do
        FILE="${XML_FILES[$i]}"
        BASENAME=$(basename "$FILE")
        CURRENT=$((i + 1))

        echo "[$CURRENT/$TOTAL] Processing: $BASENAME"

        # Start timer for this file
        FILE_START=$(date +%s.%N)

        # Call single-file processing function (capture error output)
        ERROR_OUTPUT=$(process_single_file "$BASENAME" 2>&1)
        RESULT=$?

        if [ $RESULT -eq 0 ]; then
            ((SUCCESS_COUNT++))
            FILE_STATUS="SUCCESS"
            echo "  ✓ Success"
        elif [ $RESULT -eq 4 ]; then
            ((SKIPPED_COUNT++))
            SKIPPED_FILES+=("$BASENAME")
            FILE_STATUS="SKIPPED"
            echo "  ⊘ Skipped (unsupported format)"
        else
            FAILED_FILES+=("$BASENAME")
            FILE_STATUS="FAILED"
            echo "  ✗ Failed"

            # Write error details to separate error log file
            if [ -n "$ERROR_OUTPUT" ]; then
                echo "================================================================================" >> "$ERROR_LOG_FILE"
                echo "ERROR: $BASENAME" >> "$ERROR_LOG_FILE"
                echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
                echo "================================================================================" >> "$ERROR_LOG_FILE"
                echo "$ERROR_OUTPUT" >> "$ERROR_LOG_FILE"
                echo "" >> "$ERROR_LOG_FILE"
            fi

            # Stop immediately if fail-fast mode is enabled
            if $FAIL_FAST; then
                echo ""
                echo "========================================="
                echo "FAIL-FAST MODE: Stopping batch import"
                echo "========================================="
                echo "Failed on file: $BASENAME"
                echo "Error log: $ERROR_LOG_FILE"
                echo ""
                exit 1
            fi
        fi

        # End timer and calculate duration
        FILE_END=$(date +%s.%N)
        FILE_DURATION=$(echo "$FILE_END - $FILE_START" | bc)

        # Log to file (with proper UTF-8 character width handling)
        # Calculate actual character count (not bytes) for proper alignment
        CHAR_COUNT=${#BASENAME}
        PADDING=$((30 - CHAR_COUNT))
        if [ $PADDING -lt 0 ]; then
            PADDING=0
        fi
        SPACES=$(printf '%*s' $PADDING '')

        awk -v ts="$(date '+%Y-%m-%d %H:%M:%S')" \
            -v bn="$BASENAME" -v sp="$SPACES" \
            -v dur="$FILE_DURATION" -v st="$FILE_STATUS" \
            'BEGIN { printf "%s | %s%s | %8.3fs | %s\n", ts, bn, sp, dur+0, st }' >> "$LOG_FILE"

        echo ""
    done

    # 6. XML-Referenzen werden jetzt direkt in convert_xml.sql extrahiert
    # (XMLStepReferences + XMLLayoutReferences per xml_extract_text())
    # Python-Script ist nicht mehr nötig.

    # 7. Build universal catalogs (inkl. Variablen-Parser)
    echo "========================================="
    echo "Building universal catalogs..."
    echo "========================================="

    CATALOG_TEMP_LOG=$(mktemp)
    if "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_universal_catalogs.sql" > "$CATALOG_TEMP_LOG" 2>&1; then
        echo "✓ Universal catalogs created successfully"
    else
        echo "✗ WARNING: Universal catalogs failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: Universal Catalogs Creation" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$CATALOG_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$CATALOG_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$CATALOG_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: Universal Catalogs Creation"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$CATALOG_TEMP_LOG"
    echo ""

    # 7b. Sync to rest-api/db/ (Produktionsmodus, nur wenn keine Fehler)
    if ! $TEST_MODE && [ ${#FAILED_FILES[@]} -eq 0 ]; then
        echo "========================================="
        echo "Syncing database to rest-api/..."
        echo "========================================="
        sync_to_rest_api
        echo ""
    fi

    # 8. End timer for entire batch
    BATCH_END=$(date +%s.%N)
    BATCH_DURATION=$(echo "$BATCH_END - $BATCH_START" | bc)

    # Calculate minutes and seconds
    BATCH_MINUTES=$(echo "$BATCH_DURATION / 60" | bc)
    BATCH_SECONDS=$(echo "$BATCH_DURATION - ($BATCH_MINUTES * 60)" | bc)

    # 8. Final report
    echo "========================================="
    echo "Batch Import Complete"
    echo "========================================="
    echo "Total files: $TOTAL"
    echo "Successful: $SUCCESS_COUNT"
    echo "Skipped: $SKIPPED_COUNT"
    echo "Failed: ${#FAILED_FILES[@]}"
    awk -v m="$BATCH_MINUTES" -v s="$BATCH_SECONDS" -v d="$BATCH_DURATION" \
        'BEGIN { printf "Total duration: %dm %.3fs (%.3f seconds)\n", m, s+0, d+0 }'

    # Write summary to log file
    cat >> "$LOG_FILE" << EOF

--------------------------------------------------------------------------------
Summary:
--------------------------------------------------------------------------------
End Time: $(date '+%Y-%m-%d %H:%M:%S')
Total Duration: ${BATCH_MINUTES}m ${BATCH_SECONDS}s ($BATCH_DURATION seconds)
Total Files: $TOTAL
Successful: $SUCCESS_COUNT
Skipped: $SKIPPED_COUNT
Failed: ${#FAILED_FILES[@]}
EOF

    if [ $SKIPPED_COUNT -gt 0 ]; then
        echo ""
        echo "Skipped files (unsupported format):"
        printf '  - %s\n' "${SKIPPED_FILES[@]}"

        # Write skipped files to log
        echo "" >> "$LOG_FILE"
        echo "Skipped Files (unsupported format):" >> "$LOG_FILE"
        for skipped_file in "${SKIPPED_FILES[@]}"; do
            echo "  - $skipped_file" >> "$LOG_FILE"
        done
    fi

    if [ ${#FAILED_FILES[@]} -gt 0 ]; then
        echo ""
        echo "Failed files:"
        printf '  - %s\n' "${FAILED_FILES[@]}"

        # Write failed files to log
        echo "" >> "$LOG_FILE"
        echo "Failed Files:" >> "$LOG_FILE"
        for failed_file in "${FAILED_FILES[@]}"; do
            echo "  - $failed_file" >> "$LOG_FILE"
        done
    fi

    # Close log file
    echo "================================================================================" >> "$LOG_FILE"

    # Inform user about log location
    echo ""
    echo "Log file: $LOG_FILE"

    # Inform user about error log if errors occurred
    if [ ${#FAILED_FILES[@]} -gt 0 ] && [ -f "$ERROR_LOG_FILE" ]; then
        echo "Error details: $ERROR_LOG_FILE"
    fi

    # Exit with appropriate code
    if [ ${#FAILED_FILES[@]} -gt 0 ]; then
        exit 1
    fi

    exit 0

elif [[ "$MODE" == "single" ]]; then
    # ========================================================================
    # SINGLE FILE MODE: Process one XML file
    # ========================================================================

    # Call single-file processing function
    if process_single_file "$FILENAME"; then
        echo "SUCCESS: Database created successfully from $FILENAME"

        # Sync-Hook auch im Single-Mode (Produktionsmodus).
        # Hinweis: Universal Catalogs werden im Single-Mode NICHT automatisch
        # gebaut. Fuer einen vollstaendigen Datenstand sollte danach noch
        # "duckdb db/fm_catalog.duckdb < sql/create_universal_catalogs.sql"
        # laufen (oder --batch verwenden).
        if ! $TEST_MODE; then
            echo ""
            echo "Syncing database to rest-api/..."
            sync_to_rest_api
        fi

        exit 0
    else
        exit $?
    fi
fi
