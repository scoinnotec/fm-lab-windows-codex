#!/bin/bash
# fm-xml-export-exploder Repository Installation Script
#
# This script clones/updates the fm-xml-export-exploder repository,
# a tool for splitting FileMaker XML exports into individual components.
#
# Usage: install_fm_xml_export_exploder.sh [--force]
#
# Parameters:
#   --force: Remove existing installation and re-clone
#
# Exit codes:
#   0 - Success (installed or already up to date)
#   1 - User cancelled installation
#   2 - Clone/pull failed
#   4 - Directory operation failed

# Constants
PROJECT_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd))"
DOCS_DIR="$PROJECT_ROOT/docs/fm-xml-export-exploder"
VERSION_FILE="$DOCS_DIR/.version"
REPO_URL="https://github.com/bc-m/fm-xml-export-exploder.git"

# Parse arguments
FORCE_INSTALL=false
if [ "$1" == "--force" ]; then
    FORCE_INSTALL=true
fi

# Function: Get local commit hash
get_local_version() {
    if [ -d "$DOCS_DIR/.git" ]; then
        git -C "$DOCS_DIR" rev-parse --short HEAD 2>/dev/null
    fi
}

# Function: Get local commit date
get_local_date() {
    if [ -d "$DOCS_DIR/.git" ]; then
        git -C "$DOCS_DIR" log -1 --format="%ci" 2>/dev/null
    fi
}

# Function: Get remote latest commit info
get_remote_version() {
    git ls-remote "$REPO_URL" HEAD 2>/dev/null | cut -f1 | head -c 7
}

# Function: Check if update is needed
check_version() {
    if [ ! -d "$DOCS_DIR/.git" ]; then
        echo "No existing installation found. Cloning fm-xml-export-exploder repository..."
        return 0
    fi

    if [ "$FORCE_INSTALL" = true ]; then
        echo "Force installation requested. Re-cloning fm-xml-export-exploder repository..."
        return 0
    fi

    echo "Checking for updates..."

    LOCAL_HASH=$(get_local_version)
    REMOTE_HASH=$(get_remote_version)

    if [ -z "$REMOTE_HASH" ]; then
        echo "ERROR: Failed to retrieve remote version information"
        echo "Check your internet connection or try again later."
        exit 2
    fi

    if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
        LOCAL_DATE=$(get_local_date)
        echo "Repository is up to date (commit: $LOCAL_HASH, date: $LOCAL_DATE)"
        echo "No action needed."
        exit 0
    fi

    # Newer version available - prompt user
    LOCAL_DATE=$(get_local_date)
    echo ""
    echo "Newer version available."
    echo "Current: $LOCAL_HASH ($LOCAL_DATE)"
    echo "Remote:  $REMOTE_HASH"
    echo ""
    read -p "Update repository? (y/n): " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Update cancelled by user"
        exit 1
    fi

    return 0
}

# Function: Clone or update repository
install_repo() {
    # SAFETY CHECK 1: Validate DOCS_DIR variable
    if [ -z "$DOCS_DIR" ]; then
        echo "ERROR: DOCS_DIR is not set. Aborting for safety."
        exit 4
    fi

    # SAFETY CHECK 2: Ensure DOCS_DIR contains expected pattern
    if [[ ! "$DOCS_DIR" == *"/docs/fm-xml-export-exploder" ]]; then
        echo "ERROR: DOCS_DIR does not match expected pattern (/docs/fm-xml-export-exploder). Aborting for safety."
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

    if [ -d "$DOCS_DIR/.git" ]; then
        if [ "$FORCE_INSTALL" = true ]; then
            echo "Removing existing installation..."
            rm -rf "$DOCS_DIR"
            echo "Cloning from $REPO_URL..."
            git clone "$REPO_URL" "$DOCS_DIR" 2>&1
            if [ $? -ne 0 ]; then
                echo "ERROR: Clone failed"
                exit 2
            fi
        else
            echo "Pulling latest changes..."
            git -C "$DOCS_DIR" pull --ff-only 2>&1
            if [ $? -ne 0 ]; then
                echo "WARNING: Fast-forward pull failed. Trying reset to origin/main..."
                git -C "$DOCS_DIR" fetch origin 2>&1
                git -C "$DOCS_DIR" reset --hard origin/main 2>&1
                if [ $? -ne 0 ]; then
                    echo "ERROR: Update failed. Try --force to re-clone."
                    exit 2
                fi
            fi
        fi
    else
        # Fresh clone
        mkdir -p "$(dirname "$DOCS_DIR")"
        if [ $? -ne 0 ]; then
            echo "ERROR: Failed to create parent directory"
            exit 4
        fi

        echo "Cloning from $REPO_URL..."
        git clone "$REPO_URL" "$DOCS_DIR" 2>&1
        if [ $? -ne 0 ]; then
            echo "ERROR: Clone failed"
            exit 2
        fi
    fi
}

# Function: Save version marker
save_version() {
    LOCAL_HASH=$(get_local_version)
    LOCAL_DATE=$(get_local_date)
    echo "$LOCAL_HASH $LOCAL_DATE" > "$VERSION_FILE"
}

# Function: Get installation statistics
get_stats() {
    if [ -d "$DOCS_DIR" ]; then
        RS_COUNT=$(find "$DOCS_DIR" -name "*.rs" 2>/dev/null | wc -l | tr -d ' ')
        TOML_COUNT=$(find "$DOCS_DIR" -name "*.toml" 2>/dev/null | wc -l | tr -d ' ')
        echo "($RS_COUNT Rust files, $TOML_COUNT TOML files)"
    fi
}

# Main workflow
main() {
    # Step 1: Check version and prompt user if needed
    check_version

    # Step 2: Clone or update repository
    install_repo

    # Step 3: Save version marker
    save_version

    # Step 4: Report success
    LOCAL_HASH=$(get_local_version)
    LOCAL_DATE=$(get_local_date)
    echo ""
    echo "SUCCESS: fm-xml-export-exploder repository installed successfully"
    echo "Version: $LOCAL_HASH ($LOCAL_DATE)"
    echo "Location: $DOCS_DIR"
    STATS=$(get_stats)
    if [ -n "$STATS" ]; then
        echo "Files: $STATS"
    fi

    exit 0
}

# Execute main workflow
main
