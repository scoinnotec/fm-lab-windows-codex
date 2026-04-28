---
name: install-filemaker-docs
description: Download and install FileMaker Pro documentation from Claris Software. Automatically checks for newer versions and prompts before replacing existing docs.
---

# FileMaker Documentation Installation Skill

## When to Use This Skill

Use this skill when you need to:
- Perform initial setup of FileMaker documentation
- Update to the latest FileMaker documentation
- Reinstall documentation after corruption or accidental deletion

The skill automates:
- Downloading the FileMaker docset from Claris (which is actually hosted on MonkeyBread Softwares Website)
- Version checking to avoid unnecessary downloads
- Extraction and installation to the correct location
- User confirmation when replacing existing documentation
- Cleanup of temporary files

## Parameters

The skill accepts **optional parameters**:
- `--force` - Skip version check and user prompts, force reinstallation

Without parameters, the skill will:
- Check for existing documentation
- Compare versions and prompt if update is available
- Install directly if no existing documentation found

## Workflow

When invoked, the skill performs these steps:

1. **Check Existing Docs** - Verify if documentation already exists
2. **Version Check** - Compare local version with remote (via HTTP Last-Modified timestamp)
3. **User Prompt** - Ask for confirmation if newer version is available
4. **Download** - Fetch `FileMaker 19.2 de.zip` from MonkeyBread Software to temporary directory
5. **Extract** - Unzip and validate the docset structure
6. **Install** - Copy documentation files to `docs/filemaker/` directory
7. **Version Marker** - Store version information for future comparisons
8. **Cleanup** - Remove all temporary files automatically
9. **Report** - Provide clear success or error message

## Available Tools

This skill uses bundled scripts that handle all operations:
- **Installation Script**: `scripts/install_filemaker_docs.sh`
  - Downloads and installs FileMaker documentation
  - Usage: Execute with optional `--force` flag

## Working Process

### Step 1: Accept User Request
When the user asks to install or update FileMaker documentation, determine if force installation is needed.

### Step 2: Execute Installation Script
Run the automation script:
```bash
bash .claude/skills/install-filemaker-docs/scripts/install_filemaker_docs.sh
```

Or with force flag:
```bash
bash .claude/skills/install-filemaker-docs/scripts/install_filemaker_docs.sh --force
```

### Step 3: Handle User Prompts
If the script finds a newer version, it will prompt:
```
Newer version available.
Current: Sun, 12 Jan 2026 16:47:42 GMT
Remote:  Mon, 20 Jan 2026 10:15:30 GMT
Replace existing docs? (y/n):
```

Inform the user and let them decide.

### Step 4: Report Results
The script will output one of:
- `SUCCESS: FileMaker documentation installed successfully`
- `Docs are up to date (version: [timestamp])`
- `Installation cancelled by user`
- `ERROR: Download failed`
- `ERROR: Extraction failed`
- `ERROR: Copy operation failed`

Report the result to the user with appropriate context.

## Error Handling

### Network Failures
If curl fails to download the ZIP file:
- Check internet connection
- Verify the MonkeyBread Software website is accessible
- Try again later if server is temporarily unavailable

### Extraction Errors
If unzip fails or archive structure is unexpected:
- Archive may be corrupted during download
- Retry the download
- Check available disk space

### Copy Operation Failed
If copying files to `docs/filemaker/` fails:
- Check file permissions on `docs/` directory
- Verify available disk space (~50MB needed)
- Ensure no other process is using the documentation files

### Disk Space
The installation requires approximately 50MB of free space:
- 12MB for download
- 38MB for extraction

## Output Format

Provide concise feedback:

**Success (Fresh Installation):**
```
No existing docs found. Installing FileMaker documentation...
Downloading from https://www.monkeybreadsoftware.com/filemaker/files/Dash/FileMaker%2019.2%20de.zip...
Download complete (12.7 MB)
Extracting documentation...
Installing to docs/filemaker/...

SUCCESS: FileMaker documentation installed successfully
Version: Mon, 13 Jan 2026 10:15:30 GMT
Location: docs/filemaker/
Files: (1019 HTML documentation files)
```

**Success (Already Up to Date):**
```
Checking for updates...
Docs are up to date (version: Mon, 13 Jan 2026 10:15:30 GMT)
No action needed.
```

**Success (Update):**
```
Checking for updates...
Newer version available.
Current: Sun, 12 Jan 2026 16:47:42 GMT
Remote:  Mon, 13 Jan 2026 10:15:30 GMT
Replace existing docs? (y/n): y
Downloading from https://www.monkeybreadsoftware.com/filemaker/files/Dash/FileMaker%2019.2%20de.zip...
...
SUCCESS: FileMaker documentation updated successfully
```

**Failure:**
```
ERROR: [specific error message]
[suggestion for resolution]
```

## Notes

- All temporary files are automatically cleaned up via trap mechanism
- Original documentation is only replaced after successful download and extraction
- The version marker file (`.version`) stores HTTP Last-Modified timestamp
- Multiple installations will overwrite the existing documentation
- The script is safe to run multiple times
- Documentation is required by the `filemaker-function-reference` skill
