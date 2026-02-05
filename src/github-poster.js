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
 * Dismiss previous bot reviews to avoid conflicting verdicts.
 * Only dismisses APPROVED or CHANGES_REQUESTED reviews (not COMMENT).
 */
async function dismissPreviousBotReviews(octokit, owner, repo, prNumber) {
  let page = 1;
  const perPage = 100;
  const dismissed = [];

  while (true) {
    const { data: reviews } = await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
      per_page: perPage,
      page
    });

    for (const review of reviews) {
      // Only dismiss bot reviews that have a verdict (APPROVED or CHANGES_REQUESTED)
      const isBotReview = review.user && review.user.login === 'github-actions[bot]' &&
        review.body && review.body.includes('AI Code Review');
      const hasVerdict = review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED';

      if (isBotReview && hasVerdict) {
        try {
          await octokit.pulls.dismissReview({
            owner,
            repo,
            pull_number: prNumber,
            review_id: review.id,
            message: 'Superseded by new AI review on latest commit.'
          });
          dismissed.push(review.id);
        } catch (err) {
          // May fail if review is already dismissed or PR is merged
          console.warn(`Could not dismiss review ${review.id}: ${err.message}`);
        }
      }
    }

    if (reviews.length < perPage) break;
    page++;
  }

  if (dismissed.length > 0) {
    console.log(`Dismissed ${dismissed.length} previous bot review(s)`);
  }

  return dismissed;
}

/**
 * Post a review to the PR via GitHub API.
 * Accepts a shared Octokit instance to avoid redundant instantiation.
 * Checks for duplicate reviews before posting.
 */
async function postReview({ octokit, owner, repo, prNumber, review, reviewMode, diffFiles, platformImpact, fileSummaries, tips, suggestedLabels, relatedIssues }) {
  // Get the PR's latest commit SHA for the review
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  const commitId = pr.head.sha;

  // Check for duplicate review on this commit
  const alreadyReviewed = await hasExistingReview(octokit, owner, repo, prNumber, commitId);
  if (alreadyReviewed) {
    console.log(`Commit ${commitId.slice(0, 7)} already reviewed. Skipping.`);
    return { event: 'SKIPPED', commentCount: 0 };
  }

  // Dismiss previous bot reviews to avoid conflicting verdicts
  // (e.g., showing both APPROVED and CHANGES_REQUESTED on the same PR)
  await dismissPreviousBotReviews(octokit, owner, repo, prNumber);

  // Determine the event type
  let event = mapApprovalToEvent(review.approval, reviewMode);

  // Build review body with all enhanced sections
  const body = buildReviewBody(review, platformImpact, {
    fileSummaries,
    tips,
    suggestedLabels,
    relatedIssues
  });

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
 * Build the status badge based on approval decision.
 * Provides prominent visual feedback at the top of the review.
 */
function buildStatusBadge(review) {
  const criticalCount = review.comments.filter(c => c.severity === 'critical').length;
  const warningCount = review.comments.filter(c => c.severity === 'warning').length;
  const totalIssues = review.comments.length;

  if (review.approval === 'approve') {
    return '# ✅ APPROVED\n> No critical issues found\n\n---\n';
  }

  if (review.approval === 'request_changes') {
    const subtitle = criticalCount > 0
      ? `> ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} require attention`
      : `> ${totalIssues} issue${totalIssues > 1 ? 's' : ''} found`;
    return `# ❌ CHANGES REQUESTED\n${subtitle}\n\n---\n`;
  }

  // comment
  const subtitle = warningCount > 0
    ? `> ${warningCount} warning${warningCount > 1 ? 's' : ''} to review`
    : `> ${totalIssues} suggestion${totalIssues > 1 ? 's' : ''} for improvement`;
  return `# ⚠️ NEEDS ATTENTION\n${subtitle}\n\n---\n`;
}

/**
 * Build the main review body text.
 * Optionally includes a platform impact banner at the top.
 */
function buildReviewBody(review, platformImpact, options = {}) {
  const { fileSummaries, tips, suggestedLabels, relatedIssues } = options;

  let body = '## AI Code Review\n\n';

  // Status badge at the very top
  body += buildStatusBadge(review);

  // Walkthrough table (file summaries)
  if (fileSummaries && fileSummaries.length > 0) {
    body += buildWalkthroughTable(fileSummaries);
  }

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

  // Tips section
  if (tips && tips.length > 0) {
    body += buildTipsSection(tips);
  }

  // Suggested labels
  if (suggestedLabels && suggestedLabels.length > 0) {
    body += buildLabelSuggestions(suggestedLabels);
  }

  // Related issues
  if (relatedIssues && relatedIssues.length > 0) {
    body += buildRelatedIssues(relatedIssues);
  }

  body += '\n---\n*Powered by Claude AI + Fliplet Standards*';

  return body;
}

/**
 * Build walkthrough table summarizing changes per file.
 * Caps at 10 files to avoid overly long reviews.
 */
function buildWalkthroughTable(fileSummaries) {
  const maxFiles = 10;
  const displayed = fileSummaries.slice(0, maxFiles);
  const overflow = fileSummaries.length - maxFiles;

  let table = '## Walkthrough\n\n';
  table += '| File | Changes |\n';
  table += '|------|--------|\n';

  for (const file of displayed) {
    const path = file.path.replace(/\|/g, '\\|');
    const summary = (file.summary || 'Modified').replace(/\|/g, '\\|');
    table += `| \`${path}\` | ${summary} |\n`;
  }

  if (overflow > 0) {
    table += `| | *+${overflow} more file${overflow > 1 ? 's' : ''}* |\n`;
  }

  table += '\n---\n\n';
  return table;
}

/**
 * Build tips section with educational notes.
 * Max 2 tips to avoid noise.
 */
function buildTipsSection(tips) {
  const displayTips = tips.slice(0, 2);
  let section = '## 💡 Tips\n\n';

  for (const tip of displayTips) {
    section += `- **${tip.title}**: ${tip.description}\n`;
  }

  section += '\n---\n\n';
  return section;
}

/**
 * Build label suggestions section.
 */
function buildLabelSuggestions(labels) {
  const formatted = labels.map(l => `\`${l}\``).join(' ');
  return `## 🏷️ Suggested Labels\n\n${formatted}\n\n---\n\n`;
}

/**
 * Build related issues section with links.
 */
function buildRelatedIssues(issues) {
  let section = '## 🔗 Related Issues\n\n';

  for (const issue of issues) {
    section += `- [${issue.id}](${issue.url})\n`;
  }

  section += '\n---\n\n';
  return section;
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
  dismissPreviousBotReviews,
  mapApprovalToEvent,
  buildReviewBody,
  buildReviewComments,
  buildImpactBanner,
  buildStatusBadge,
  buildWalkthroughTable,
  buildTipsSection,
  buildLabelSuggestions,
  buildRelatedIssues
};
