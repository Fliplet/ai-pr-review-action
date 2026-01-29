'use strict';

const path = require('path');

// JSON files that are worth reviewing (config files with meaningful logic)
const REVIEWABLE_JSON_FILES = ['widget.json'];

/**
 * Parse a unified diff string into structured file changes.
 * Each file entry contains the path, status, hunks, and individual line changes
 * with their line numbers for precise review comments.
 */
function parseDiff(diffText) {
  const files = [];
  const lines = diffText.split('\n');
  let currentFile = null;
  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;
  let pendingStatus = 'modified';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file diff header — reset all per-file state
    if (line.startsWith('diff --git')) {
      currentFile = null;
      currentHunk = null;
      pendingStatus = 'modified';
      continue;
    }

    // Detect new file
    if (line.startsWith('new file mode')) {
      pendingStatus = 'added';
      continue;
    }

    // Detect deleted file
    if (line.startsWith('deleted file mode')) {
      pendingStatus = 'deleted';
      continue;
    }

    // Detect renamed file
    if (line.startsWith('rename from ')) {
      pendingStatus = 'renamed';
      continue;
    }

    if (line.startsWith('rename to ')) {
      continue;
    }

    // Old file path: --- /dev/null means new file
    if (line.startsWith('--- /dev/null')) {
      pendingStatus = 'added';
      continue;
    }

    // Skip regular --- header
    if (line.startsWith('--- ')) {
      continue;
    }

    // New file path: +++ /dev/null means deleted file
    if (line.startsWith('+++ /dev/null')) {
      pendingStatus = 'deleted';
      continue;
    }

    // File path from +++ header (new file path)
    if (line.startsWith('+++ b/')) {
      currentFile = {
        path: line.slice(6),
        status: pendingStatus,
        hunks: [],
        additions: 0,
        deletions: 0
      };
      files.push(currentFile);
      continue;
    }

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
    if (hunkMatch && currentFile) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[3], 10);
      currentHunk = {
        header: line,
        context: hunkMatch[5] ? hunkMatch[5].trim() : '',
        changes: []
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    // Diff content lines
    if (currentHunk && currentFile) {
      if (line.startsWith('+')) {
        currentHunk.changes.push({
          type: 'addition',
          content: line.slice(1),
          line: newLine
        });
        currentFile.additions++;
        newLine++;
      } else if (line.startsWith('-')) {
        currentHunk.changes.push({
          type: 'deletion',
          content: line.slice(1),
          line: oldLine
        });
        currentFile.deletions++;
        oldLine++;
      } else if (line.startsWith(' ')) {
        currentHunk.changes.push({
          type: 'context',
          content: line.slice(1),
          oldLine: oldLine,
          newLine: newLine
        });
        oldLine++;
        newLine++;
      }
    }
  }

  return files;
}

/**
 * Check if a file is worth reviewing.
 * Skips documentation, binary, and lock files.
 * Allows widget.json specifically for config review.
 */
function isReviewableFile(filePath) {
  const skipExtensions = [
    '.md', '.txt', '.yml', '.yaml', '.lock',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot',
    '.min.js', '.min.css', '.map'
  ];

  const skipPaths = [
    'node_modules/',
    'package-lock.json',
    '.github/',
    'dist/',
    'build/',
    'coverage/'
  ];

  const lowerPath = filePath.toLowerCase();

  if (skipPaths.some(p => lowerPath.includes(p))) {
    return false;
  }

  // Allow specific JSON config files (e.g., widget.json)
  if (lowerPath.endsWith('.json')) {
    const fileName = path.basename(lowerPath);
    return REVIEWABLE_JSON_FILES.includes(fileName);
  }

  if (skipExtensions.some(ext => lowerPath.endsWith(ext))) {
    return false;
  }

  return true;
}

/**
 * Get total lines changed across all files.
 */
function getTotalChanges(files) {
  return files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
}

module.exports = { parseDiff, isReviewableFile, getTotalChanges };
