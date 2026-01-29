'use strict';

const {
  TEST_FILE_PATTERNS,
  AUTH_FILE_PATTERNS,
  ROUTE_FILE_PATTERNS
} = require('./constants');

const MAX_SUGGESTIONS = 2;
const TRIVIAL_LINE_THRESHOLD = 30;

/**
 * Generate test gap suggestions as review comments.
 * Post-processing step — no LLM call. Deterministic and fast.
 *
 * Noise control:
 * - Skip entirely if PR < 30 total lines AND impact is 'low'
 * - Only check for test gaps if no test files exist in the diff
 * - Cap at 2 suggestions max
 * - De-duplicate against existing Claude comments mentioning "test"
 *
 * @param {Array<{ path: string, additions: number, deletions: number, hunks: Array }>} files
 * @param {{ level: string, affectsAuth: boolean, affectsRoutes: boolean }} platformImpact
 * @param {string} repoName
 * @param {Array<{ body: string }>} existingComments - Claude's review comments
 * @returns {Array<{ path: string, line: number, severity: string, body: string }>}
 */
function generateTestSuggestions(files, platformImpact, repoName, existingComments) {
  const suggestions = [];

  // Calculate total lines changed
  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  // Skip entirely for trivial low-impact PRs
  if (totalLines < TRIVIAL_LINE_THRESHOLD && platformImpact.level === 'low') {
    return [];
  }

  // Check if PR already includes test files
  const hasTestFiles = files.some(f => TEST_FILE_PATTERNS.some(p => p.test(f.path)));
  if (hasTestFiles) {
    return [];
  }

  // Check if Claude already mentioned tests
  const claudeMentionedTests = (existingComments || []).some(c =>
    c.body && /\btest(s|ing)?\b/i.test(c.body)
  );

  // Detect auth/security changes without tests
  const authFiles = files.filter(f => AUTH_FILE_PATTERNS.some(p => p.test(f.path)));
  if (authFiles.length > 0 && !claudeMentionedTests && suggestions.length < MAX_SUGGESTIONS) {
    suggestions.push({
      path: authFiles[0].path,
      line: getFirstAdditionLine(authFiles[0]),
      severity: 'warning',
      body: '**[warning]** This PR modifies authentication/security code but includes no test changes. Auth changes are high-risk — consider adding tests to verify login flows, token validation, and permission checks still work correctly.'
    });
  }

  // Detect route changes without tests
  const routeFiles = files.filter(f => ROUTE_FILE_PATTERNS.some(p => p.test(f.path)));
  if (routeFiles.length > 0 && !claudeMentionedTests && suggestions.length < MAX_SUGGESTIONS) {
    suggestions.push({
      path: routeFiles[0].path,
      line: getFirstAdditionLine(routeFiles[0]),
      severity: 'suggestion',
      body: '**[suggestion]** This PR modifies API routes but includes no test changes. Consider adding integration tests for the affected endpoints to prevent regressions.'
    });
  }

  // Detect new endpoints (router.get, router.post, etc.) without tests
  if (suggestions.length < MAX_SUGGESTIONS && !claudeMentionedTests) {
    const newEndpointFile = findNewEndpointFile(files);
    if (newEndpointFile && !suggestions.some(s => s.path === newEndpointFile.file.path)) {
      suggestions.push({
        path: newEndpointFile.file.path,
        line: newEndpointFile.line,
        severity: 'suggestion',
        body: '**[suggestion]** New endpoint detected without corresponding tests. Consider adding tests that cover request validation, successful responses, and error cases.'
      });
    }
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

/**
 * Get the first addition line number from a file, defaulting to 1.
 */
function getFirstAdditionLine(file) {
  if (!file.hunks) return 1;
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === 'addition') return change.line;
    }
  }
  return 1;
}

/**
 * Find a file containing new endpoint definitions (router.get, router.post, etc.).
 * Returns { file, line } or null.
 */
function findNewEndpointFile(files) {
  const endpointPattern = /router\.(get|post|put|patch|delete)\s*\(/;

  for (const file of files) {
    if (!file.hunks) continue;
    for (const hunk of file.hunks) {
      for (const change of hunk.changes) {
        if (change.type === 'addition' && endpointPattern.test(change.content)) {
          return { file, line: change.line };
        }
      }
    }
  }
  return null;
}

module.exports = { generateTestSuggestions };
