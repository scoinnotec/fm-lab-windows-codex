#!/bin/bash
# FileMaker Documentation Installation Script
#
# This script downloads and installs FileMaker Pro documentation from MonkeyBread Software.
# It handles version checking, user prompts, and automatic cleanup.
#
# Usage: install_filemaker_docs.sh [--force]
#
# Parameters:
#   --force: Skip version check and prompts, force reinstallation
#
# Exit codes:
#   0 - Success (installed or already up to date)
#   1 - User cancelled installation
#   2 - Download failed
#   3 - Extraction failed
#   4 - Copy operation failed
#   5 - Failed to create temporary directory

# Constants
PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd))"
DOCS_DIR="$PROJECT_ROOT/docs/filemaker"
VERSION_FILE="$DOCS_DIR/.version"
ZIP_URL="https://www.monkeybreadsoftware.com/filemaker/files/Dash/FileMaker%2019.2%20de.zip"
DOCSET_PATH="FileMaker 19.2 de.docset/Contents/Resources"

# Parse arguments
FORCE_INSTALL=false
if [ "$1" == "--force" ]; then
    FORCE_INSTALL=true
fi

# Create temporary working directory
TEMP_DIR=$(mktemp -d) || {
    echo "ERROR: Failed to create temporary directory"
    exit 5
}
trap "rm -rf '$TEMP_DIR'" EXIT  # Ensure cleanup on exit

# Function: Get remote file timestamp
get_remote_timestamp() {
    curl -sI "$ZIP_URL" | grep -i "^last-modified:" | sed 's/last-modified: //i' | tr -d '\r'
}

# Function: Check if update is needed
check_version() {
    if [ ! -f "$DOCS_DIR/docSet.dsidx" ]; then
        # No existing docs found
        echo "No existing docs found. Installing FileMaker documentation..."
        return 0  # Proceed with installation
    fi

    if [ "$FORCE_INSTALL" = true ]; then
        echo "Force installation requested. Reinstalling FileMaker documentation..."
        return 0  # Proceed with installation
    fi

    # Check for newer version
    echo "Checking for updates..."

    REMOTE_DATE=$(get_remote_timestamp)
    if [ -z "$REMOTE_DATE" ]; then
        echo "ERROR: Failed to retrieve remote version information"
        exit 2
    fi

    if [ -f "$VERSION_FILE" ]; then
        LOCAL_DATE=$(cat "$VERSION_FILE")

        # Convert dates to timestamps for comparison
        REMOTE_TS=$(date -j -f "%a, %d %b %Y %T %Z" "$REMOTE_DATE" "+%s" 2>/dev/null)
        LOCAL_TS=$(date -j -f "%a, %d %b %Y %T %Z" "$LOCAL_DATE" "+%s" 2>/dev/null)

        if [ -n "$REMOTE_TS" ] && [ -n "$LOCAL_TS" ] && [ "$REMOTE_TS" -le "$LOCAL_TS" ]; then
            echo "Docs are up to date (version: $LOCAL_DATE)"
            echo "No action needed."
            exit 0
        fi

        # Newer version available - prompt user
        echo ""
        echo "Newer version available."
        echo "Current: $LOCAL_DATE"
        echo "Remote:  $REMOTE_DATE"
        echo ""
        read -p "Replace existing docs? (y/n): " -n 1 -r
        echo ""

        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled by user"
            exit 1
        fi
    else
        # No version file but docs exist - prompt for safety
        echo "Existing documentation found (no version information)."
        echo "Remote version: $REMOTE_DATE"
        echo ""
        read -p "Replace existing docs? (y/n): " -n 1 -r
        echo ""

        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled by user"
            exit 1
        fi
    fi

    return 0  # Proceed with installation
}

# Function: Download FileMaker documentation
download_docs() {
    echo "Downloading from $ZIP_URL..."

    curl -L -o "$TEMP_DIR/FileMaker 19.2 de.zip" "$ZIP_URL" 2>&1 | grep -v "^  "

    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        echo "ERROR: Download failed"
        exit 2
    fi

    # Verify file was downloaded and has reasonable size (should be > 1MB)
    FILE_SIZE=$(stat -f%z "$TEMP_DIR/FileMaker 19.2 de.zip" 2>/dev/null || echo "0")
    if [ "$FILE_SIZE" -lt 1000000 ]; then
        echo "ERROR: Downloaded file is too small ($FILE_SIZE bytes). Download may have failed."
        exit 2
    fi

    echo "Download complete ($(echo "scale=1; $FILE_SIZE / 1024 / 1024" | bc) MB)"
}

# Function: Extract and validate archive
extract_docs() {
    echo "Extracting documentation..."

    unzip -q "$TEMP_DIR/FileMaker 19.2 de.zip" -d "$TEMP_DIR"

    if [ $? -ne 0 ]; then
        echo "ERROR: Extraction failed"
        exit 3
    fi

    # Validate expected structure
    if [ ! -d "$TEMP_DIR/$DOCSET_PATH" ]; then
        echo "ERROR: Unexpected archive structure"
        echo "Expected path not found: $DOCSET_PATH"
        exit 3
    fi

    if [ ! -d "$TEMP_DIR/$DOCSET_PATH/Documents" ]; then
        echo "ERROR: Documents directory not found in archive"
        exit 3
    fi

    if [ ! -f "$TEMP_DIR/$DOCSET_PATH/docSet.dsidx" ]; then
        echo "ERROR: docSet.dsidx not found in archive"
        exit 3
    fi
}

# Function: Install documentation files
install_docs() {
    echo "Installing to $DOCS_DIR..."

    # SAFETY CHECK 1: Validate DOCS_DIR variable
    if [ -z "$DOCS_DIR" ]; then
        echo "ERROR: DOCS_DIR is not set. Aborting for safety."
        exit 4
    fi

    # SAFETY CHECK 2: Ensure DOCS_DIR contains expected pattern
    if [[ ! "$DOCS_DIR" == *"/docs/filemaker" ]]; then
        echo "ERROR: DOCS_DIR does not match expected pattern (/docs/filemaker). Aborting for safety."
        echo "Current value: $DOCS_DIR"
        exit 4
    fi

    # SAFETY CHECK 3: Prevent deletion of root or system directories
    case "$DOCS_DIR" in
        /|/bin|/etc|/usr|/var|/System|/Library|/Applications|$HOME)
            echo "ERROR: DOCS_DIR points to a protected directory. Aborting for safety."
            exit 4
            ;;
    esac

    # Create target directory if it doesn't exist
    mkdir -p "$DOCS_DIR"

    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to create target directory: $DOCS_DIR"
        exit 4
    fi

    # SAFETY CHECK 4: If version file exists, verify we're in the right directory
    if [ -f "$VERSION_FILE" ]; then
        # Version file exists, proceed with deletion
        :
    elif [ -d "$DOCS_DIR/Documents" ] || [ -f "$DOCS_DIR/docSet.dsidx" ]; then
        # Files exist but no version file - could be wrong directory
        echo "WARNING: Target directory contains files but no version marker."
        echo "This could indicate a wrong target directory."
        read -p "Continue anyway? (y/n): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled for safety"
            exit 1
        fi
    fi

    # SAFETY CHECK 5: Change to target directory and use relative paths
    cd "$DOCS_DIR" || {
        echo "ERROR: Cannot change to target directory: $DOCS_DIR"
        exit 4
    }

    # Remove old files using relative paths (now safe)
    rm -rf "./Documents" "./docSet.dsidx"

    # Copy new files (back to using absolute path for source)
    cp -R "$TEMP_DIR/$DOCSET_PATH/Documents" "$DOCS_DIR/" 2>&1
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to copy Documents directory"
        exit 4
    fi

    cp "$TEMP_DIR/$DOCSET_PATH/docSet.dsidx" "$DOCS_DIR/" 2>&1
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to copy docSet.dsidx"
        exit 4
    fi

    # Store version marker with remote timestamp
    REMOTE_DATE=$(get_remote_timestamp)
    echo "$REMOTE_DATE" > "$VERSION_FILE"

    if [ $? -ne 0 ]; then
        echo "WARNING: Failed to create version marker file"
        # Not a critical error, continue
    fi
}

# Function: Get installation statistics
get_stats() {
    if [ -f "$DOCS_DIR/docSet.dsidx" ]; then
        # Count HTML files in Documents directory
        DOC_COUNT=$(find "$DOCS_DIR/Documents" -name "*.html" 2>/dev/null | wc -l | tr -d ' ')
        echo "($DOC_COUNT HTML documentation files)"
    fi
}


# Main workflow
main() {
    # Step 1: Check version and prompt user if needed
    check_version

    # Step 2: Download documentation
    download_docs

    # Step 3: Extract and validate
    extract_docs

    # Step 4: Install files
    install_docs

    # Step 5: Report success
    REMOTE_DATE=$(get_remote_timestamp)
    echo ""
    echo "SUCCESS: FileMaker documentation installed successfully"
    echo "Version: $REMOTE_DATE"
    echo "Location: $DOCS_DIR"
    STATS=$(get_stats)
    if [ -n "$STATS" ]; then
        echo "Files: $STATS"
    fi

    exit 0
}

# Execute main workflow
main
