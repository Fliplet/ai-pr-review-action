'use strict';

const { SECURITY_SENSITIVE_PATTERNS, COMPLEXITY_KEYWORDS, MODELS } = require('./constants');

/**
 * Score PR complexity on a 0-100 scale.
 * Used to decide model selection and whether to enable extended thinking.
 *
 * Scoring rubric:
 *   - Total changes > 200 lines: +20
 *   - Files > 10: +15
 *   - Any security-sensitive file paths: +25
 *   - Complexity keywords in PR title/body: +15
 *   - Many hunks (>20 total): +10
 *   - Large single file (>100 changes): +15
 */
function scorePRComplexity({ files, prTitle, prBody }) {
  let score = 0;

  // Total line changes
  const totalChanges = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  if (totalChanges > 200) {
    score += 20;
  }

  // File count
  if (files.length > 10) {
    score += 15;
  }

  // Security-sensitive paths
  const hasSecurityFiles = files.some(f =>
    SECURITY_SENSITIVE_PATTERNS.some(p => p.test(f.path))
  );
  if (hasSecurityFiles) {
    score += 25;
  }

  // Complexity keywords in title or body
  const textToSearch = `${prTitle || ''} ${prBody || ''}`.toLowerCase();
  const hasComplexityKeyword = COMPLEXITY_KEYWORDS.some(kw => textToSearch.includes(kw));
  if (hasComplexityKeyword) {
    score += 15;
  }

  // Many hunks across files
  const totalHunks = files.reduce((sum, f) => sum + (f.hunks ? f.hunks.length : 0), 0);
  if (totalHunks > 20) {
    score += 10;
  }

  // Any single file with large changes
  const hasLargeFile = files.some(f => (f.additions + f.deletions) > 100);
  if (hasLargeFile) {
    score += 15;
  }

  return Math.min(score, 100);
}

/**
 * Recommend a model based on complexity score.
 * Score >= 40 → Opus for deeper analysis.
 * Otherwise → Sonnet for fast, cost-effective review.
 */
function recommendModel(score) {
  return score >= 40 ? MODELS.OPUS : MODELS.SONNET;
}

module.exports = { scorePRComplexity, recommendModel };
