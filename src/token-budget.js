'use strict';

const { SECURITY_SENSITIVE_PATTERNS, CORE_FILE_PATTERNS } = require('./constants');

/**
 * Approximate token count for a string.
 * Uses a simple heuristic: ~4 characters per token for code.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Check if a file path matches security-sensitive patterns.
 */
function isSecurityFile(filePath) {
  return SECURITY_SENSITIVE_PATTERNS.some(p => p.test(filePath));
}

/**
 * Check if a file path matches core application file patterns.
 */
function isCoreFile(filePath) {
  return CORE_FILE_PATTERNS.some(p => p.test(filePath));
}

/**
 * Compute priority score for a file.
 * Higher score = reviewed first when budget is tight.
 *   Security files: +1000
 *   Core app files: +500
 *   Then by change volume (additions + deletions)
 */
function filePriority(file) {
  let priority = file.additions + file.deletions;
  if (isSecurityFile(file.path)) priority += 1000;
  if (isCoreFile(file.path)) priority += 500;
  return priority;
}

/**
 * Truncate diff to fit within token budget.
 * Strategy: security files first, then smallest files first.
 * Continues past oversized files instead of stopping (bug fix).
 */
function truncateDiff(files, maxTokens) {
  // Sort by priority score descending (security > core > change volume)
  const sorted = [...files].sort((a, b) => filePriority(b) - filePriority(a));

  const included = [];
  let currentTokens = 0;

  for (const file of sorted) {
    const fileText = formatFileForPrompt(file);
    const fileTokens = estimateTokens(fileText);

    if (currentTokens + fileTokens <= maxTokens) {
      included.push(file);
      currentTokens += fileTokens;
    } else {
      // Try to include a truncated version of the file
      const remaining = maxTokens - currentTokens;
      if (remaining > 200) {
        const truncated = truncateFile(file, remaining);
        if (truncated) {
          included.push(truncated);
          // Use actual tokens of the truncated file, not the full remaining budget
          const actualTokens = estimateTokens(formatFileForPrompt(truncated));
          currentTokens += actualTokens;
        }
      }
      // FIX: continue instead of break — remaining smaller files may still fit
      continue;
    }
  }

  return {
    files: included,
    totalFiles: files.length,
    includedFiles: included.length,
    truncated: included.length < files.length,
    estimatedTokens: currentTokens
  };
}

/**
 * Format a single file's diff for the prompt.
 * Includes file status (added/renamed/deleted) when relevant.
 */
function formatFileForPrompt(file) {
  const statusLabel = file.status && file.status !== 'modified' ? ` [${file.status}]` : '';
  let text = `### ${file.path}${statusLabel} (+${file.additions}/-${file.deletions})\n`;

  for (const hunk of file.hunks) {
    text += hunk.header + '\n';
    for (const change of hunk.changes) {
      if (change.type === 'addition') {
        text += '+' + change.content + '\n';
      } else if (change.type === 'deletion') {
        text += '-' + change.content + '\n';
      } else {
        text += ' ' + change.content + '\n';
      }
    }
    text += '\n';
  }

  return text;
}

/**
 * Truncate a file's hunks to fit within a token budget.
 * Keeps the first N hunks that fit.
 */
function truncateFile(file, maxTokens) {
  const statusLabel = file.status && file.status !== 'modified' ? ` [${file.status}]` : '';
  const headerTokens = estimateTokens(`### ${file.path}${statusLabel} (truncated)\n`);
  let remaining = maxTokens - headerTokens;

  if (remaining <= 0) return null;

  const truncatedHunks = [];

  for (const hunk of file.hunks) {
    let hunkText = hunk.header + '\n';
    for (const change of hunk.changes) {
      if (change.type === 'addition') {
        hunkText += '+' + change.content + '\n';
      } else if (change.type === 'deletion') {
        hunkText += '-' + change.content + '\n';
      } else {
        hunkText += ' ' + change.content + '\n';
      }
    }

    const hunkTokens = estimateTokens(hunkText);
    if (hunkTokens <= remaining) {
      truncatedHunks.push(hunk);
      remaining -= hunkTokens;
    } else {
      break;
    }
  }

  if (truncatedHunks.length === 0) return null;

  return {
    ...file,
    hunks: truncatedHunks,
    truncated: true
  };
}

/**
 * Format all included files into a single diff string for the prompt.
 */
function formatDiffForPrompt(budgetResult) {
  let output = '';

  for (const file of budgetResult.files) {
    output += formatFileForPrompt(file);
  }

  if (budgetResult.truncated) {
    output += `\n[Note: ${budgetResult.totalFiles - budgetResult.includedFiles} file(s) omitted due to size constraints]\n`;
  }

  return output;
}

module.exports = { estimateTokens, truncateDiff, formatDiffForPrompt, formatFileForPrompt, isSecurityFile, isCoreFile, filePriority };
