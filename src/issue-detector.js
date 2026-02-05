'use strict';

/**
 * Jira project prefixes used by Fliplet.
 */
const JIRA_PREFIXES = ['DEV', 'PS', 'SEC', 'INFRA', 'QA', 'OPS'];

/**
 * Jira base URL for Fliplet's Atlassian instance.
 */
const JIRA_BASE_URL = 'https://weboo.atlassian.net/browse';

/**
 * Detect issue references in PR metadata and content.
 * Scans title, body, and commit messages for Jira tickets and GitHub issues.
 *
 * @param {object} opts
 * @param {string} opts.prTitle - PR title
 * @param {string} opts.prBody - PR description/body
 * @param {string[]} opts.commitMessages - Array of commit messages (optional)
 * @param {string} opts.diff - Diff content (optional, for comments)
 * @param {string} opts.owner - GitHub repo owner (for GitHub issue links)
 * @param {string} opts.repo - GitHub repo name (for GitHub issue links)
 * @returns {Array<{id: string, url: string, type: 'jira'|'github'}>}
 */
function detectIssues({ prTitle, prBody, commitMessages, diff, owner, repo }) {
  const issues = new Map(); // Use map to deduplicate by ID

  // Combine all text sources
  const sources = [
    prTitle || '',
    prBody || '',
    ...(commitMessages || []),
    diff || ''
  ].join('\n');

  // Detect Jira tickets (DEV-123, PS-456, etc.)
  const jiraPattern = new RegExp(`\\b(${JIRA_PREFIXES.join('|')})-(\\d+)\\b`, 'gi');
  let match;

  while ((match = jiraPattern.exec(sources)) !== null) {
    const prefix = match[1].toUpperCase();
    const number = match[2];
    const id = `${prefix}-${number}`;

    if (!issues.has(id)) {
      issues.set(id, {
        id,
        url: `${JIRA_BASE_URL}/${id}`,
        type: 'jira'
      });
    }
  }

  // Detect GitHub issues (#123)
  // Only match standalone # references, not in URLs or code
  // IMPORTANT: Skip CSS color codes like #333, #fff, #9888
  const ghIssuePattern = /(?:^|[^\w/])#(\d+)\b/gm;

  while ((match = ghIssuePattern.exec(sources)) !== null) {
    const number = match[1];
    const id = `#${number}`;

    // Skip invalid ranges
    if (parseInt(number) < 1 || parseInt(number) > 99999) continue;

    // Skip likely CSS color codes and common non-issue patterns:
    // - 3-digit numbers (shorthand hex: #333, #abc)
    // - 4-digit numbers (ports, error codes, rgba shorthand)
    // - 6-digit numbers (full hex: #333333, #abcdef)
    // - Numbers with all same digit (#111, #9999)
    if (number.length <= 4 || number.length === 6) continue;
    if (/^(\d)\1+$/.test(number)) continue;

    // Skip numbers under 100 (line numbers, indices, small constants)
    if (parseInt(number) < 100) continue;

    if (!issues.has(id) && owner && repo) {
      issues.set(id, {
        id,
        url: `https://github.com/${owner}/${repo}/issues/${number}`,
        type: 'github'
      });
    }
  }

  // Convert map to array and sort (Jira first, then GitHub)
  return Array.from(issues.values()).sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'jira' ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Extract the main ticket reference from PR title (if any).
 * Useful for identifying the primary ticket being addressed.
 *
 * @param {string} prTitle
 * @returns {string|null} Primary ticket ID or null
 */
function extractPrimaryTicket(prTitle) {
  if (!prTitle) return null;

  // Look for ticket at start of title (common convention)
  const pattern = new RegExp(`^\\s*(${JIRA_PREFIXES.join('|')})-(\\d+)`, 'i');
  const match = prTitle.match(pattern);

  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }

  // Check for ticket anywhere in title
  const anywherePattern = new RegExp(`\\b(${JIRA_PREFIXES.join('|')})-(\\d+)\\b`, 'i');
  const anyMatch = prTitle.match(anywherePattern);

  if (anyMatch) {
    return `${anyMatch[1].toUpperCase()}-${anyMatch[2]}`;
  }

  return null;
}

module.exports = {
  detectIssues,
  extractPrimaryTicket,
  JIRA_PREFIXES,
  JIRA_BASE_URL
};
