'use strict';

const { withRetry } = require('./retry');

/**
 * Check if this commit has already been reviewed by the bot.
 * Uses pagination to handle PRs with many reviews.
 */
async function hasExistingReview(octokit, owner, repo, prNumber, commitSha) {
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data: reviews } = await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
      per_page: perPage,
      page
    });

    const existing = reviews.find(r =>
      r.user && r.user.login === 'github-actions[bot]' &&
      r.commit_id === commitSha &&
      r.body && r.body.includes('AI Code Review')
    );

    if (existing) return true;
    if (reviews.length < perPage) break;
    page++;
  }

  return false;
}

/**
 * Post a review to the PR via GitHub API.
 * Accepts a shared Octokit instance to avoid redundant instantiation.
 * Checks for duplicate reviews before posting.
 */
async function postReview({ octokit, owner, repo, prNumber, review, reviewMode, diffFiles, platformImpact }) {
  // Get the PR's latest commit SHA for the review
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  const commitId = pr.head.sha;

  // Check for duplicate review on this commit
  const alreadyReviewed = await hasExistingReview(octokit, owner, repo, prNumber, commitId);
  if (alreadyReviewed) {
    console.log(`Commit ${commitId.slice(0, 7)} already reviewed. Skipping.`);
    return { event: 'SKIPPED', commentCount: 0 };
  }

  // Determine the event type
  let event = mapApprovalToEvent(review.approval, reviewMode);

  // Build review body
  const body = buildReviewBody(review, platformImpact);

  // Build inline comments, validating line numbers against the actual diff
  const comments = buildReviewComments(review.comments, diffFiles);

  // If no inline comments and Claude approved, upgrade to APPROVE
  if (comments.length === 0 && event === 'COMMENT' && review.approval === 'approve') {
    event = 'APPROVE';
  }

  try {
    await withRetry(
      () => octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: commitId,
        body,
        event,
        comments
      }),
      { maxRetries: 2, baseDelay: 1000, label: 'GitHub createReview' }
    );

    console.log(`Review posted: ${event} with ${comments.length} inline comment(s)`);
  } catch (err) {
    // If inline comments fail (e.g., line not in diff), retry without them
    if (comments.length > 0 && err.status === 422) {
      console.warn('Failed to post inline comments, retrying as body-only review');
      const fallbackBody = body + '\n\n---\n\n' + formatCommentsAsBody(review.comments);

      await withRetry(
        () => octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          commit_id: commitId,
          body: fallbackBody,
          event
        }),
        { maxRetries: 2, baseDelay: 1000, label: 'GitHub createReview (fallback)' }
      );

      console.log(`Review posted (fallback): ${event} with comments in body`);
    } else {
      throw err;
    }
  }

  return { event, commentCount: comments.length };
}

/**
 * Map the AI's approval decision to a GitHub review event.
 */
function mapApprovalToEvent(approval, reviewMode) {
  if (approval === 'approve') {
    return 'APPROVE';
  }

  if (approval === 'request_changes') {
    if (reviewMode === 'can-request-changes') {
      return 'REQUEST_CHANGES';
    }
    // Downgrade to comment if not allowed to request changes
    return 'COMMENT';
  }

  return 'COMMENT';
}

/**
 * Build the main review body text.
 * Optionally includes a platform impact banner at the top.
 */
function buildReviewBody(review, platformImpact) {
  let body = '## AI Code Review\n\n';

  // Platform impact banner (medium+ only)
  if (platformImpact && platformImpact.level !== 'low') {
    body += buildImpactBanner(platformImpact) + '\n\n';
  }

  body += review.summary + '\n\n';

  const criticalCount = review.comments.filter(c => c.severity === 'critical').length;
  const warningCount = review.comments.filter(c => c.severity === 'warning').length;
  const suggestionCount = review.comments.filter(c => c.severity === 'suggestion').length;

  if (review.comments.length > 0) {
    body += '| Severity | Count |\n|----------|-------|\n';
    if (criticalCount) body += `| 🔴 Critical | ${criticalCount} |\n`;
    if (warningCount) body += `| 🟡 Warning | ${warningCount} |\n`;
    if (suggestionCount) body += `| 🔵 Suggestion | ${suggestionCount} |\n`;
  }

  body += '\n---\n*Powered by Claude AI + Fliplet Standards*';

  return body;
}

/**
 * Build platform impact banner for the review body.
 */
function buildImpactBanner(platformImpact) {
  const icons = { critical: '🚨', high: '⚠️', medium: 'ℹ️' };
  const icon = icons[platformImpact.level] || '';
  const label = platformImpact.level.toUpperCase();

  let banner = `> ${icon} **Platform Impact: ${label}**\n`;

  const areas = [];
  if (platformImpact.affectsAuth) areas.push('Authentication');
  if (platformImpact.affectsMiddleware) areas.push('Middleware');
  if (platformImpact.affectsSchema) areas.push('Database Schema');
  if (platformImpact.affectsData) areas.push('Data Sources');
  if (platformImpact.affectsRoutes) areas.push('API Routes');
  if (platformImpact.affectsDependencies) areas.push('Dependencies');

  if (areas.length > 0) {
    banner += `> Affects: ${areas.join(', ')}`;
  }

  return banner;
}

/**
 * Build inline review comments, validating that lines exist in the diff.
 */
function buildReviewComments(comments, diffFiles) {
  const validLines = buildValidLineMap(diffFiles);

  return comments
    .filter(c => {
      // Only include comments where the line is actually in the diff
      const fileLines = validLines.get(c.path);
      return fileLines && fileLines.has(c.line);
    })
    .map(c => ({
      path: c.path,
      line: c.line,
      side: 'RIGHT',
      body: c.body
    }));
}

/**
 * Build a map of file paths to sets of valid line numbers from the diff.
 */
function buildValidLineMap(diffFiles) {
  const map = new Map();

  for (const file of diffFiles) {
    const lines = new Set();
    for (const hunk of file.hunks) {
      for (const change of hunk.changes) {
        if (change.type === 'addition') {
          lines.add(change.line);
        }
      }
    }
    map.set(file.path, lines);
  }

  return map;
}

/**
 * Format comments as markdown body text (fallback when inline posting fails).
 */
function formatCommentsAsBody(comments) {
  let body = '### Review Comments\n\n';

  for (const c of comments) {
    const icon = c.severity === 'critical' ? '🔴' : c.severity === 'warning' ? '🟡' : '🔵';
    body += `${icon} **${c.path}:${c.line}**\n\n${c.body}\n\n---\n\n`;
  }

  return body;
}

module.exports = {
  postReview,
  hasExistingReview,
  mapApprovalToEvent,
  buildReviewBody,
  buildReviewComments,
  buildImpactBanner
};
