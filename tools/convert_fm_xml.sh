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
# Schema-Versionierung & Auto-Heal:
#   Vor jedem Import vergleicht das Skript die Schema-Version im SQL-Template
#   (sql/convert_xml.sql: @SCHEMA_VERSION) mit der Version, die in der
#   DB-Tabelle SchemaInfo persistiert ist. Bei Drift wird im Batch-Modus
#   automatisch ein Rebuild ausgeführt (DB löschen, alle XMLs neu importieren).
#   Im Single-File-Modus bricht das Skript stattdessen ab und verweist auf
#   --batch --force-rebuild (siehe project/prd_schema_versioning_auto_heal.md).
#
# Usage:
#   convert_fm_xml.sh <xml-filename>                          # Single file mode
#   convert_fm_xml.sh <xml-filename> --force-rebuild          # Single + erzwungener Rebuild
#   convert_fm_xml.sh --batch                                 # Batch mode (all XML files)
#   convert_fm_xml.sh --batch --fail-fast                     # Batch mode (stop on first error)
#   convert_fm_xml.sh --batch --force-rebuild                 # Batch + DB vorher löschen
#   convert_fm_xml.sh --batch --no-auto-heal                  # Bei Schema-Drift abbrechen statt rebuilden
#   convert_fm_xml.sh --all                                   # Alias for --batch
#   convert_fm_xml.sh --test                                  # Test mode (xml-test/ → fm_test.duckdb)
#   convert_fm_xml.sh --test --fail-fast                      # Test mode (stop on first error)
#
# Flags (alle optional, beliebig kombinierbar):
#   --fail-fast       Stop on first error (Batch/Test mode only)
#   --force-rebuild   DB vor dem Import löschen und komplett neu aufbauen
#   --no-auto-heal    Bei Schema-Drift NICHT auto-rebuilden, sondern abbrechen
#
# Exit codes:
#   0 - Success
#   1 - File not found / No files found / Validation error / Some files failed
#   2 - UTF-8 conversion failed
#   3 - DuckDB conversion failed
#   4 - Unsupported XML format (e.g. legacy FMDynamicTemplate)
#   5 - XML preprocessing failed
#   6 - Schema-Drift erkannt (Single-Mode oder --no-auto-heal): manueller Rebuild nötig

# Constants
PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd))"
SQL_TEMPLATE="$PROJECT_ROOT/sql/convert_xml.sql"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

default_xml_dir() {
    printf '%s\n' "$PROJECT_ROOT/xml"
}

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

# Argument-Parsing: Mode + Flags in beliebiger Reihenfolge.
# Genau ein positionelles Argument (Filename) ODER ein Mode-Flag wird erwartet.
MODE=""
FILENAME=""
FAIL_FAST=false
TEST_MODE=false
FORCE_REBUILD=false
NO_AUTO_HEAL=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --test)
            MODE="batch"
            TEST_MODE=true
            shift
            ;;
        --batch|--all)
            MODE="batch"
            shift
            ;;
        --fail-fast)
            FAIL_FAST=true
            shift
            ;;
        --force-rebuild)
            FORCE_REBUILD=true
            shift
            ;;
        --no-auto-heal)
            NO_AUTO_HEAL=true
            shift
            ;;
        --*)
            echo "ERROR: Unknown flag: $1"
            echo "Usage: $0 <xml-filename> [--force-rebuild] | --batch [--fail-fast] [--force-rebuild] [--no-auto-heal] | --test [--fail-fast] [--force-rebuild]"
            exit 1
            ;;
        *)
            if [ -n "$FILENAME" ]; then
                echo "ERROR: Multiple filenames provided ('$FILENAME', '$1'). Use --batch to process all files."
                exit 1
            fi
            FILENAME="$1"
            MODE="single"
            shift
            ;;
    esac
done

if [ -z "$MODE" ]; then
    echo "ERROR: No argument provided"
    echo "Usage: $0 <xml-filename> [--force-rebuild] | --batch [--fail-fast] [--force-rebuild] [--no-auto-heal] | --test [--fail-fast] [--force-rebuild]"
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
    XML_DIR="${FM_LAB_XML_DIR:-$(default_xml_dir)}"
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
# Schema-Versionierung & Auto-Heal
# Siehe project/prd_schema_versioning_auto_heal.md
# ============================================================================

# Berechnet MD5 über die übergebenen Dateien (cross-platform: macOS+Linux).
compute_files_hash() {
    local files=("$@")
    if command -v md5sum &>/dev/null; then
        cat "${files[@]}" 2>/dev/null | md5sum | awk '{print $1}'
    elif command -v md5 &>/dev/null; then
        cat "${files[@]}" 2>/dev/null | md5 -q
    else
        cat "${files[@]}" 2>/dev/null | shasum -a 256 | cut -c1-32
    fi
}

# Liest Schema-Marker aus dem SQL-Template-Header.
# Setzt SCHEMA_VERSION_EXPECTED und SCHEMA_HASH_EXPECTED (global).
read_template_schema_info() {
    SCHEMA_VERSION_EXPECTED=$(grep -m1 '^-- @SCHEMA_VERSION ' "$SQL_TEMPLATE" | awk '{print $3}')

    local hash_files_raw
    hash_files_raw=$(grep -m1 '^-- @SCHEMA_HASH_FILES ' "$SQL_TEMPLATE" | cut -d' ' -f3-)

    if [ -z "$SCHEMA_VERSION_EXPECTED" ] || [ -z "$hash_files_raw" ]; then
        echo "ERROR: SQL-Template fehlt @SCHEMA_VERSION oder @SCHEMA_HASH_FILES im Header."
        echo "       Datei: $SQL_TEMPLATE"
        exit 1
    fi

    # Hash-Files relativ zum Projekt-Root auflösen
    local -a abs_paths=()
    local f
    for f in $hash_files_raw; do
        abs_paths+=("$PROJECT_ROOT/$f")
        if [ ! -f "$PROJECT_ROOT/$f" ]; then
            echo "ERROR: SQL-Template-Referenz fehlt: $PROJECT_ROOT/$f"
            exit 1
        fi
    done

    SCHEMA_HASH_EXPECTED=$(compute_files_hash "${abs_paths[@]}")
}

# Liest den aktuellen Schema-Stand aus der DB (falls vorhanden).
# Setzt SCHEMA_VERSION_DB und SCHEMA_HASH_DB (global) — leer wenn unbekannt.
read_db_schema_info() {
    SCHEMA_VERSION_DB=""
    SCHEMA_HASH_DB=""

    if [ ! -f "$DB_FILE" ]; then
        return 0
    fi

    local row
    row=$("$DUCKDB_BIN" -readonly "$DB_FILE" -csv -noheader -c \
        "SELECT Schema_Version, Schema_Hash FROM SchemaInfo ORDER BY Schema_Built_At DESC LIMIT 1" \
        2>/dev/null) || row=""

    if [ -n "$row" ]; then
        SCHEMA_VERSION_DB=$(echo "$row" | cut -d',' -f1)
        SCHEMA_HASH_DB=$(echo "$row" | cut -d',' -f2)
    fi
}

# Detection-Logik. Setzt SCHEMA_ACTION und SCHEMA_REASON (global).
# Mögliche Werte: fresh_build | incremental | rebuild | warn
compute_schema_state() {
    read_template_schema_info
    read_db_schema_info

    if [ ! -f "$DB_FILE" ]; then
        SCHEMA_ACTION="fresh_build"
        SCHEMA_REASON="DB-Datei existiert nicht — normaler Erst-Import"
    elif [ -z "$SCHEMA_VERSION_DB" ]; then
        SCHEMA_ACTION="rebuild"
        SCHEMA_REASON="DB ohne SchemaInfo-Tabelle (Pre-Versioning-Stand oder Datei korrupt)"
    elif [ "$SCHEMA_VERSION_DB" != "$SCHEMA_VERSION_EXPECTED" ]; then
        SCHEMA_ACTION="rebuild"
        SCHEMA_REASON="Schema-Version $SCHEMA_VERSION_DB → $SCHEMA_VERSION_EXPECTED"
    elif [ "$SCHEMA_HASH_DB" != "$SCHEMA_HASH_EXPECTED" ]; then
        SCHEMA_ACTION="warn"
        SCHEMA_REASON="Schema-Hash drift erkannt (Version unverändert) — Rebuild empfohlen via --force-rebuild"
    else
        SCHEMA_ACTION="incremental"
        SCHEMA_REASON="Schema OK (v$SCHEMA_VERSION_DB)"
    fi
}

# Schreibt einen Auto-Heal-Block ins Batch-Log.
log_schema_action() {
    local logfile="$1"
    [ -z "$logfile" ] && return 0
    [ ! -f "$logfile" ] && return 0

    {
        echo ""
        echo "================================================================================"
        echo "Schema Auto-Heal Detection"
        echo "================================================================================"
        echo "DB Version (before):   ${SCHEMA_VERSION_DB:-<none>}"
        echo "DB Hash    (before):   ${SCHEMA_HASH_DB:-<none>}"
        echo "Template Version:      $SCHEMA_VERSION_EXPECTED"
        echo "Template Hash:         $SCHEMA_HASH_EXPECTED"
        echo "Reason:                $SCHEMA_REASON"
        echo "Action:                $SCHEMA_ACTION_EXECUTED"
        echo "--------------------------------------------------------------------------------"
        echo ""
    } >> "$logfile"
}

# Löscht die DB-Datei (mit Bestätigung im TTY, ohne im non-interaktiven Modus).
# $1: Grund (für Nutzer-Meldung)
delete_db_for_rebuild() {
    local reason="$1"
    if [ ! -f "$DB_FILE" ]; then
        return 0
    fi

    if [[ -t 0 ]] && ! $FORCE_REBUILD; then
        echo ""
        echo "  Grund: $reason"
        echo "  Lösche $DB_FILE und baue neu auf? [y/N] "
        read -r CONFIRM
        if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
            echo "  Abgebrochen."
            exit 6
        fi
    fi

    rm -f "$DB_FILE"
    echo "  ✓ DB gelöscht: $DB_FILE"
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

    # 6. Create temporary SQL script with correct filename + schema markers.
    # Das SQL-Template liest FM_XML_DIR per getenv() — wir setzen sie unten beim
    # duckdb-Aufruf auf $TEMP_DIR. Per sed ersetzen wir:
    #   - fm_xml         → aktueller XML-Dateiname
    #   - schema_version → aus @SCHEMA_VERSION-Header (single source of truth)
    #   - schema_hash    → MD5 über @SCHEMA_HASH_FILES (zur Build-Zeit berechnet)
    local TEMP_SQL="$TEMP_DIR/convert.sql"
    sed -e "s/SET VARIABLE fm_xml = '.*';/SET VARIABLE fm_xml = '$XML_FILE';/" \
        -e "s/SET VARIABLE schema_version = '.*';/SET VARIABLE schema_version = '$SCHEMA_VERSION_EXPECTED';/" \
        -e "s/SET VARIABLE schema_hash = '.*';/SET VARIABLE schema_hash = '$SCHEMA_HASH_EXPECTED';/" \
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

# ----------------------------------------------------------------------------
# Schema-Detection & Auto-Heal (vor jedem Import)
# Logik gemäß project/prd_schema_versioning_auto_heal.md §5.3-§5.5.
# ----------------------------------------------------------------------------
compute_schema_state
SCHEMA_ACTION_EXECUTED="$SCHEMA_ACTION"

echo "========================================="
echo "Schema-Detection"
echo "========================================="
echo "Template Version:  $SCHEMA_VERSION_EXPECTED"
echo "Template Hash:     ${SCHEMA_HASH_EXPECTED:0:12}…"
if [ -n "$SCHEMA_VERSION_DB" ]; then
    echo "DB Version:        $SCHEMA_VERSION_DB"
    echo "DB Hash:           ${SCHEMA_HASH_DB:0:12}…"
else
    echo "DB Version:        <keine SchemaInfo / DB existiert nicht>"
fi
echo "Action:            $SCHEMA_ACTION"
echo "Reason:            $SCHEMA_REASON"

# 1. --force-rebuild überstimmt alle Detection-Ergebnisse
if $FORCE_REBUILD && [ -f "$DB_FILE" ]; then
    echo ""
    echo "  ⚠ --force-rebuild aktiv: DB wird vor dem Import gelöscht"
    delete_db_for_rebuild "--force-rebuild explizit gesetzt"
    SCHEMA_ACTION_EXECUTED="force_rebuild"
fi

# 2. Schema-Drift behandeln
if [ "$SCHEMA_ACTION" = "rebuild" ] && ! $FORCE_REBUILD; then
    if $NO_AUTO_HEAL; then
        echo ""
        echo "ERROR: Schema-Drift erkannt und --no-auto-heal aktiv → Abbruch."
        echo "       $SCHEMA_REASON"
        echo ""
        echo "       Manueller Rebuild: bash \"$0\" --batch --force-rebuild"
        exit 6
    fi

    if [[ "$MODE" == "single" ]]; then
        echo ""
        echo "ERROR: Schema-Drift erkannt — DB ist nicht kompatibel mit aktuellen SQL-Templates."
        echo "       DB-Version: ${SCHEMA_VERSION_DB:-<none>}   Template-Version: $SCHEMA_VERSION_EXPECTED"
        echo "       Reason: $SCHEMA_REASON"
        echo ""
        echo "Auto-Heal ist im Single-File-Modus deaktiviert (würde alle anderen Dateien"
        echo "aus der DB verlieren). Wähle einen der folgenden Wege:"
        echo ""
        echo "  Empfohlen:  bash \"$0\" --batch --force-rebuild"
        echo "              (löscht DB, importiert alle XML-Dateien aus xml/ neu)"
        echo ""
        echo "  Manuell:    rm \"$DB_FILE\" && bash \"$0\" \"$FILENAME\""
        echo "              (Vorsicht: andere Dateien sind dann nicht mehr in der DB)"
        exit 6
    fi

    # Batch-Modus: Auto-Heal durchführen
    echo ""
    echo "  ⚠ Auto-Heal: DB wird gelöscht und im Batch-Modus neu aufgebaut"
    delete_db_for_rebuild "$SCHEMA_REASON"
    SCHEMA_ACTION_EXECUTED="auto_heal_rebuild"
fi

# 3. Warn-Pfad (Hash-Drift ohne Versions-Bump)
if [ "$SCHEMA_ACTION" = "warn" ]; then
    echo ""
    echo "  ⚠ WARNING: $SCHEMA_REASON"
fi

echo ""

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
Schema Version (Template): $SCHEMA_VERSION_EXPECTED
Schema Action: $SCHEMA_ACTION_EXECUTED ($SCHEMA_REASON)
EOF

    # Bei Auto-Heal/Force-Rebuild: detaillierten Block ins Log schreiben
    if [[ "$SCHEMA_ACTION_EXECUTED" =~ ^(auto_heal_rebuild|force_rebuild)$ ]]; then
        log_schema_action "$LOG_FILE"
    fi

    cat >> "$LOG_FILE" << EOF

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
    # CWD = PROJECT_ROOT, damit relative Pfade wie 'data/mbs_component_exceptions.csv'
    # in create_universal_catalogs.sql (PluginComponent-INSERTs) auflösbar sind.
    if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_universal_catalogs.sql") > "$CATALOG_TEMP_LOG" 2>&1; then
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

    # 7a. Build table occurrence usage analysis
    # Precomputes TO usage details so the REST API does not need slow live
    # formula scans for every request.
    echo "========================================="
    echo "Building table occurrence usage analysis..."
    echo "========================================="

    TO_USAGE_TEMP_LOG=$(mktemp)
    if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_table_occurrence_usage_analysis.sql") > "$TO_USAGE_TEMP_LOG" 2>&1; then
        echo "✓ Table occurrence usage analysis built successfully"
    else
        echo "✗ WARNING: Table occurrence usage analysis failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: Table Occurrence Usage Analysis" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$TO_USAGE_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$TO_USAGE_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$TO_USAGE_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: Table Occurrence Usage Analysis"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$TO_USAGE_TEMP_LOG"
    echo ""

    # 7b. Build object usage analysis
    echo "========================================="
    echo "Building object usage analysis..."
    echo "========================================="

    OBJECT_USAGE_TEMP_LOG=$(mktemp)
    if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_object_usage_analysis.sql") > "$OBJECT_USAGE_TEMP_LOG" 2>&1; then
        echo "✓ Object usage analysis built successfully"
    else
        echo "✗ WARNING: Object usage analysis failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: Object Usage Analysis" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$OBJECT_USAGE_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$OBJECT_USAGE_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$OBJECT_USAGE_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: Object Usage Analysis"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$OBJECT_USAGE_TEMP_LOG"
    echo ""

    # 7c. Build credential analysis
    echo "========================================="
    echo "Building credential analysis..."
    echo "========================================="

    CREDENTIAL_TEMP_LOG=$(mktemp)
    if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_credential_analysis.sql") > "$CREDENTIAL_TEMP_LOG" 2>&1; then
        echo "✓ Credential analysis built successfully"
    else
        echo "✗ WARNING: Credential analysis failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: Credential Analysis" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$CREDENTIAL_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$CREDENTIAL_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$CREDENTIAL_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: Credential Analysis"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$CREDENTIAL_TEMP_LOG"
    echo ""

    # 7d. Build API integration analysis
    echo "========================================="
    echo "Building API integration analysis..."
    echo "========================================="

    API_INTEGRATION_TEMP_LOG=$(mktemp)
    if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_api_integration_analysis.sql") > "$API_INTEGRATION_TEMP_LOG" 2>&1; then
        echo "✓ API integration analysis built successfully"
    else
        echo "✗ WARNING: API integration analysis failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: API Integration Analysis" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$API_INTEGRATION_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$API_INTEGRATION_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$API_INTEGRATION_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: API Integration Analysis"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$API_INTEGRATION_TEMP_LOG"
    echo ""

    # 7e. Build layout object quality analysis
    echo "========================================="
    echo "Building layout object quality analysis..."
    echo "========================================="

    LAYOUT_QUALITY_TEMP_LOG=$(mktemp)
    if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_layout_object_quality_analysis.sql") > "$LAYOUT_QUALITY_TEMP_LOG" 2>&1; then
        echo "✓ Layout object quality analysis built successfully"
    else
        echo "✗ WARNING: Layout object quality analysis failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: Layout Object Quality Analysis" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$LAYOUT_QUALITY_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$LAYOUT_QUALITY_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$LAYOUT_QUALITY_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: Layout Object Quality Analysis"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$LAYOUT_QUALITY_TEMP_LOG"
    echo ""

    # 7e. Build quality and risk analysis
    echo "========================================="
    echo "Building quality and risk analysis..."
    echo "========================================="

    QUALITY_TEMP_LOG=$(mktemp)
    if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_quality_analysis.sql") > "$QUALITY_TEMP_LOG" 2>&1; then
        echo "✓ Quality and risk analysis built successfully"
    else
        echo "✗ WARNING: Quality and risk analysis failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: Quality and Risk Analysis" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$QUALITY_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$QUALITY_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$QUALITY_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: Quality and Risk Analysis"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$QUALITY_TEMP_LOG"
    echo ""

    # 7f. Build localization labels
    echo "========================================="
    echo "Building localization labels..."
    echo "========================================="

    LOCALIZATION_TEMP_LOG=$(mktemp)
    if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_localization_labels.sql") > "$LOCALIZATION_TEMP_LOG" 2>&1; then
        echo "✓ Localization labels built successfully"
    else
        echo "✗ WARNING: Localization labels failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: Localization Labels" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$LOCALIZATION_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$LOCALIZATION_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$LOCALIZATION_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: Localization Labels"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$LOCALIZATION_TEMP_LOG"
    echo ""

    # 7g. Build resolution tables (ObjectHomes + TableOccurrenceResolution)
    # PRD prd_rest_api_token_extended_infos.md §5.1: datei-übergreifende
    # Resolutions werden nach allen Imports einmalig neu aufgebaut.
    echo "========================================="
    echo "Building resolution tables..."
    echo "========================================="

    RESOLUTION_TEMP_LOG=$(mktemp)
    if "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/build_resolutions.sql" > "$RESOLUTION_TEMP_LOG" 2>&1; then
        echo "✓ Resolution tables built successfully"
    else
        echo "✗ WARNING: Resolution tables failed"

        echo "================================================================================" >> "$ERROR_LOG_FILE"
        echo "ERROR: Resolution Tables Creation" >> "$ERROR_LOG_FILE"
        echo "Time: $(date '+%Y-%m-%d %H:%M:%S')" >> "$ERROR_LOG_FILE"
        echo "================================================================================" >> "$ERROR_LOG_FILE"
        cat "$RESOLUTION_TEMP_LOG" >> "$ERROR_LOG_FILE"
        echo "" >> "$ERROR_LOG_FILE"

        echo "Error details:"
        cat "$RESOLUTION_TEMP_LOG" | sed 's/^/  /'

        if $FAIL_FAST; then
            rm -f "$RESOLUTION_TEMP_LOG"
            echo ""
            echo "========================================="
            echo "FAIL-FAST MODE: Stopping batch import"
            echo "========================================="
            echo "Failed during: Resolution Tables Creation"
            echo "Error log: $ERROR_LOG_FILE"
            echo ""
            exit 1
        fi
    fi
    rm -f "$RESOLUTION_TEMP_LOG"
    echo ""

    # 7g. Sync to rest-api/db/ (Produktionsmodus, nur wenn keine Fehler)
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

        # Resolutions werden auch im Single-File-Mode neu aufgebaut
        # (PRD prd_rest_api_token_extended_infos.md §5.1). Hängt von ObjectCatalog
        # aus den Universal Catalogs ab — bei Single-File-Mode wird ObjectCatalog
        # NICHT automatisch aktualisiert. Für vollen Datenstand: --batch verwenden
        # oder anschließend: duckdb db/fm_catalog.duckdb < sql/create_universal_catalogs.sql
        echo ""
        echo "Building resolution tables..."
        if "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/build_resolutions.sql" > /dev/null 2>&1; then
            echo "✓ Resolution tables built"
        else
            echo "✗ WARNING: Resolution tables failed (run universal_catalogs first?)"
        fi

        echo ""
        echo "Building table occurrence usage analysis..."
        if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_table_occurrence_usage_analysis.sql") > /dev/null 2>&1; then
            echo "✓ Table occurrence usage analysis built"
        else
            echo "✗ WARNING: Table occurrence usage analysis failed"
        fi

        echo ""
        echo "Building object usage analysis..."
        if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_object_usage_analysis.sql") > /dev/null 2>&1; then
            echo "✓ Object usage analysis built"
        else
            echo "✗ WARNING: Object usage analysis failed"
        fi

        echo ""
        echo "Building credential analysis..."
        if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_credential_analysis.sql") > /dev/null 2>&1; then
            echo "✓ Credential analysis built"
        else
            echo "✗ WARNING: Credential analysis failed"
        fi

        echo ""
        echo "Building API integration analysis..."
        if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_api_integration_analysis.sql") > /dev/null 2>&1; then
            echo "✓ API integration analysis built"
        else
            echo "✗ WARNING: API integration analysis failed"
        fi

        echo ""
        echo "Building layout object quality analysis..."
        if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_layout_object_quality_analysis.sql") > /dev/null 2>&1; then
            echo "✓ Layout object quality analysis built"
        else
            echo "✗ WARNING: Layout object quality analysis failed"
        fi

        echo ""
        echo "Building quality and risk analysis..."
        if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_quality_analysis.sql") > /dev/null 2>&1; then
            echo "✓ Quality and risk analysis built"
        else
            echo "✗ WARNING: Quality and risk analysis failed"
        fi

        echo ""
        echo "Building localization labels..."
        if (cd "$PROJECT_ROOT" && "$DUCKDB_BIN" "$DB_FILE" < "$PROJECT_ROOT/sql/create_localization_labels.sql") > /dev/null 2>&1; then
            echo "✓ Localization labels built"
        else
            echo "✗ WARNING: Localization labels failed"
        fi

        # Sync-Hook auch im Single-Mode (Produktionsmodus).
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
