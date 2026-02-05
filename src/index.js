'use strict';

const { Octokit } = require('@octokit/rest');
const { parseDiff, isReviewableFile, getTotalChanges } = require('./diff-parser');
const { truncateDiff, formatDiffForPrompt, estimateTokens, isSecurityFile } = require('./token-budget');
const { reviewWithClaude, triageFiles } = require('./claude-reviewer');
const { postReview } = require('./github-poster');
const { scorePRComplexity, recommendModel } = require('./complexity-scorer');
const { assessPlatformImpact } = require('./platform-impact');
const { generateTestSuggestions } = require('./test-suggestions');
const { suggestLabels, hasTestFiles } = require('./label-suggester');
const { generateTips } = require('./tips-generator');
const { detectIssues } = require('./issue-detector');
const { MODELS, MODEL_PRICING, SECURITY_SENSITIVE_PATTERNS } = require('./constants');

const DEFAULT_MIN_CHANGES_THRESHOLD = 0;
const TRIAGE_TOKEN_MULTIPLIER = 1.5;
const TRIAGE_MIN_FILES = 5;
const FULL_CONTEXT_SCORE_THRESHOLD = 30;
const FULL_CONTEXT_MAX_FILES = 5;
const FULL_CONTEXT_MAX_LINES = 500;
const FULL_CONTEXT_MIN_HUNKS = 3;
const FULL_CONTEXT_MIN_CHANGES = 50;

async function run() {
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;
  const prNumber = parseInt(process.env.PR_NUMBER, 10);
  const reviewMode = process.env.REVIEW_MODE || 'can-request-changes';
  const maxDiffTokens = parseInt(process.env.MAX_DIFF_TOKENS, 10) || 15000;
  const maxOutputTokens = parseInt(process.env.MAX_OUTPUT_TOKENS, 10) || 4096;
  const autoModelSelection = (process.env.AUTO_MODEL_SELECTION || 'true') === 'true';
  const enableThinking = process.env.ENABLE_THINKING || 'auto';
  const explicitModel = process.env.CLAUDE_MODEL;
  const minChangesThreshold = parseInt(process.env.MIN_LINES, 10) || DEFAULT_MIN_CHANGES_THRESHOLD;

  if (!prNumber || isNaN(prNumber)) {
    console.log('No PR number provided. Skipping review.');
    return;
  }

  console.log(`Reviewing PR #${prNumber} on ${owner}/${repo}`);

  // Single Octokit instance shared across all modules
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  // Fetch PR metadata from API when not available from event context
  // (e.g., workflow_dispatch triggers don't provide pull_request event data)
  let prTitle = process.env.PR_TITLE || '';
  let prBody = process.env.PR_BODY || '';
  let prBase = process.env.PR_BASE || '';
  if (!prTitle || !prBase) {
    console.log('Fetching PR metadata from API (workflow_dispatch mode)...');
    const { data: prData } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    });
    prTitle = prTitle || prData.title || '';
    prBody = prBody || prData.body || '';
    prBase = prBase || prData.base.ref || 'master';
  }

  // Fetch the PR diff
  const { data: diff } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' }
  });

  // Parse the diff
  const allFiles = parseDiff(diff);

  // Filter to reviewable files only
  const reviewableFiles = allFiles.filter(f => isReviewableFile(f.path));

  if (reviewableFiles.length === 0) {
    console.log('No reviewable code files in this PR. Skipping.');
    return;
  }

  // Check minimum changes threshold (skip if threshold is 0)
  const totalChanges = getTotalChanges(reviewableFiles);
  if (minChangesThreshold > 0 && totalChanges < minChangesThreshold) {
    console.log(`Only ${totalChanges} line(s) changed. Below threshold of ${minChangesThreshold}. Skipping.`);
    return;
  }

  console.log(`Found ${reviewableFiles.length} reviewable file(s) with ${totalChanges} total changes`);

  // --- Platform impact assessment (deterministic, no LLM call) ---
  const platformImpact = assessPlatformImpact(reviewableFiles, repo);
  console.log(`Platform impact: ${platformImpact.level}`);

  // --- Complexity scoring & adaptive model selection ---
  const complexityScore = scorePRComplexity({ files: reviewableFiles, prTitle, prBody, platformImpact });
  console.log(`Complexity score: ${complexityScore}/100`);

  let selectedModel;
  if (explicitModel) {
    // Explicit model input overrides adaptive selection
    selectedModel = explicitModel;
    console.log(`Model (explicit override): ${selectedModel}`);
  } else if (autoModelSelection) {
    selectedModel = recommendModel(complexityScore);
    console.log(`Model (auto-selected): ${selectedModel}`);
  } else {
    selectedModel = MODELS.SONNET;
    console.log(`Model (default): ${selectedModel}`);
  }

  // --- Full file context for modified files (from PR HEAD, not base) ---
  // Always fetch full context to avoid false positives about unused imports
  // or undefined methods that exist elsewhere in the file
  let fullFileContext = '';
  let fullContextTokens = 0;
  const prHeadRef = process.env.PR_HEAD_REF || `refs/pull/${prNumber}/head`;
  fullFileContext = await fetchFullFileContext(octokit, owner, repo, prHeadRef, reviewableFiles);
  fullContextTokens = estimateTokens(fullFileContext);
  if (fullContextTokens > 0) {
    console.log(`Full file context: ${fullContextTokens} estimated tokens (from PR HEAD)`);
  }

  // Reduce diff budget proportionally when full context is included
  const effectiveDiffBudget = fullContextTokens > 0
    ? Math.max(maxDiffTokens - fullContextTokens, Math.floor(maxDiffTokens * 0.5))
    : maxDiffTokens;

  // Apply token budget (priority-sorted: security > core > change volume)
  const budgetResult = truncateDiff(reviewableFiles, effectiveDiffBudget);
  const formattedDiff = formatDiffForPrompt(budgetResult);

  if (budgetResult.truncated) {
    console.log(`Diff truncated: reviewing ${budgetResult.includedFiles}/${budgetResult.totalFiles} files (~${budgetResult.estimatedTokens} tokens)`);
  }

  // Get file list with status context for Claude
  const fileList = reviewableFiles.map(f => {
    const status = f.status && f.status !== 'modified' ? ` (${f.status})` : '';
    return `${f.path}${status}`;
  });

  // --- Two-pass triage for large diffs ---
  let triageUsage = null;
  let diffForReview = formattedDiff;
  let filesForReview = fileList;

  const estimatedDiffTokens = budgetResult.estimatedTokens;
  const shouldTriage = estimatedDiffTokens > (effectiveDiffBudget * TRIAGE_TOKEN_MULTIPLIER)
    && reviewableFiles.length > TRIAGE_MIN_FILES;

  if (shouldTriage) {
    console.log(`Large diff detected (${estimatedDiffTokens} tokens, ${reviewableFiles.length} files). Running triage pass...`);

    const triage = await triageFiles({
      diff: formattedDiff,
      fileList: fileList.map(f => f.replace(/ \(.*\)$/, '')), // strip status labels
      prTitle
    });

    triageUsage = triage.usage;
    console.log(`Triage flagged ${triage.flaggedFiles.length}/${reviewableFiles.length} files for deep review`);
    console.log(`Triage tokens: ${triageUsage.inputTokens} input, ${triageUsage.outputTokens} output`);

    // Re-filter to only flagged files
    if (triage.flaggedFiles.length < reviewableFiles.length) {
      const flaggedSet = new Set(triage.flaggedFiles);
      const flaggedFiles = reviewableFiles.filter(f => flaggedSet.has(f.path));
      if (flaggedFiles.length > 0) {
        const flaggedBudget = truncateDiff(flaggedFiles, effectiveDiffBudget);
        diffForReview = formatDiffForPrompt(flaggedBudget);
        filesForReview = flaggedFiles.map(f => {
          const status = f.status && f.status !== 'modified' ? ` (${f.status})` : '';
          return `${f.path}${status}`;
        });
      }
    }
  }

  // --- Call Claude for review ---
  console.log('Calling Claude API for review...');
  const review = await reviewWithClaude({
    diff: diffForReview,
    prTitle,
    prBody,
    prBase,
    repoName: repo,
    fileList: filesForReview,
    maxOutputTokens,
    model: selectedModel,
    enableThinking,
    complexityScore,
    fullFileContext: fullFileContext || undefined,
    platformImpact
  });

  console.log(`Claude response: ${review.approval} (${review.comments.length} comments)`);
  console.log(`Model used: ${review.model}${review.thinkingEnabled ? ' (with extended thinking)' : ''}`);
  console.log(`Token usage: ${review.usage.inputTokens} input, ${review.usage.outputTokens} output`);

  // --- Test suggestions (post-processing, no LLM call) ---
  const testSuggestions = generateTestSuggestions(reviewableFiles, platformImpact, repo, review.comments);
  if (testSuggestions.length > 0) {
    review.comments = [...review.comments, ...testSuggestions];
    console.log(`Added ${testSuggestions.length} test suggestion(s)`);
  }

  // --- Generate tips based on diff patterns (no LLM call) ---
  const tips = generateTips(diffForReview);
  if (tips.length > 0) {
    console.log(`Generated ${tips.length} tip(s) for common patterns`);
  }

  // --- Suggest labels based on platform impact and PR content (no LLM call) ---
  const prHasTestFiles = hasTestFiles(fileList.map(f => f.replace(/ \(.*\)$/, '')));
  const suggestedLabels = suggestLabels({
    platformImpact,
    fileList: fileList.map(f => f.replace(/ \(.*\)$/, '')),
    prTitle,
    prBody,
    hasTestFiles: prHasTestFiles
  });
  if (suggestedLabels.length > 0) {
    console.log(`Suggested labels: ${suggestedLabels.join(', ')}`);
  }

  // --- Detect related issues from PR content (no LLM call) ---
  const relatedIssues = detectIssues({
    prTitle,
    prBody,
    diff: diffForReview,
    owner,
    repo
  });
  if (relatedIssues.length > 0) {
    console.log(`Detected ${relatedIssues.length} related issue(s): ${relatedIssues.map(i => i.id).join(', ')}`);
  }

  // Post the review to GitHub (shared octokit, with duplicate check)
  const result = await postReview({
    octokit,
    owner,
    repo,
    prNumber,
    review,
    reviewMode,
    diffFiles: reviewableFiles,
    platformImpact,
    fileSummaries: review.file_summaries || [],
    tips,
    suggestedLabels,
    relatedIssues
  });

  if (result.event === 'SKIPPED') {
    console.log('Review skipped (duplicate).');
    return;
  }

  console.log(`Review posted successfully: ${result.event} with ${result.commentCount} inline comment(s)`);

  // --- Model-aware cost estimation ---
  logCostEstimate(review, triageUsage);
}

/**
 * Fetch full file content for reviewable files via GitHub API.
 * Fetches from PR HEAD to show current state, not base state.
 * Returns formatted context string, or empty string if none qualify.
 */
async function fetchFullFileContext(octokit, owner, repo, ref, files) {
  // Fetch full context for ALL reviewable JS files to avoid false positives
  // about unused imports or undefined methods that exist in other parts of the file
  const candidates = files
    .filter(f => /\.(js|ts|jsx|tsx)$/.test(f.path) && f.status !== 'deleted')
    .slice(0, FULL_CONTEXT_MAX_FILES * 2); // Allow more files for accurate context

  if (candidates.length === 0) return '';

  let context = '';
  for (const file of candidates) {
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: file.path,
        ref
      });

      if (data.type !== 'file' || !data.content) continue;

      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const lines = content.split('\n');
      const truncatedContent = lines.slice(0, FULL_CONTEXT_MAX_LINES).join('\n');
      const truncatedNote = lines.length > FULL_CONTEXT_MAX_LINES
        ? `\n[... truncated at ${FULL_CONTEXT_MAX_LINES}/${lines.length} lines]\n`
        : '';

      context += `### ${file.path} (full file)\n\`\`\`\n${truncatedContent}${truncatedNote}\`\`\`\n\n`;
    } catch (err) {
      // File might not exist on base branch (new file) — skip silently
      console.log(`Could not fetch full content for ${file.path}: ${err.message}`);
    }
  }

  return context;
}

/**
 * Log model-aware cost estimation to GitHub Actions output.
 */
function logCostEstimate(review, triageUsage) {
  const pricing = MODEL_PRICING[review.model] || MODEL_PRICING[MODELS.SONNET];
  const reviewCost = (review.usage.inputTokens * pricing.input / 1000000)
    + (review.usage.outputTokens * pricing.output / 1000000);

  let totalCost = reviewCost;
  let costBreakdown = `Review (${review.model}): $${reviewCost.toFixed(4)}`;

  if (triageUsage) {
    const triagePricing = MODEL_PRICING[MODELS.SONNET];
    const triageCost = (triageUsage.inputTokens * triagePricing.input / 1000000)
      + (triageUsage.outputTokens * triagePricing.output / 1000000);
    totalCost += triageCost;
    costBreakdown += ` | Triage (${MODELS.SONNET}): $${triageCost.toFixed(4)}`;
  }

  console.log(`Estimated cost: $${totalCost.toFixed(4)} (${costBreakdown})`);
}

run().catch(err => {
  console.error('AI Review failed:', err.message);
  // Don't fail the workflow on review errors - it's informational
  process.exit(0);
});
