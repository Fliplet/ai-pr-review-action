'use strict';

/**
 * Suggest labels for a PR based on files changed, platform impact, and PR metadata.
 * Deterministic rules - no LLM call required.
 *
 * @param {object} opts
 * @param {object} opts.platformImpact - Platform impact assessment
 * @param {string[]} opts.fileList - List of changed file paths
 * @param {string} opts.prTitle - PR title
 * @param {string} opts.prBody - PR body/description
 * @param {boolean} opts.hasTestFiles - Whether PR includes test file changes
 * @returns {string[]} Array of suggested label names
 */
function suggestLabels({ platformImpact, fileList, prTitle, prBody, hasTestFiles }) {
  const labels = [];
  const titleLower = (prTitle || '').toLowerCase();
  const bodyLower = (prBody || '').toLowerCase();
  const combined = titleLower + ' ' + bodyLower;

  // Security label - when auth or middleware affected
  if (platformImpact) {
    if (platformImpact.affectsAuth || platformImpact.affectsMiddleware) {
      labels.push('security');
    }

    // Database label
    if (platformImpact.affectsSchema) {
      labels.push('database');
    }

    // Dependencies label
    if (platformImpact.affectsDependencies) {
      labels.push('dependencies');
    }
  }

  // Breaking change detection - route changes + breaking keywords
  const breakingKeywords = ['breaking', 'deprecated', 'removed', 'migration required'];
  const hasBreakingKeyword = breakingKeywords.some(kw => combined.includes(kw));
  const hasRouteChanges = platformImpact && platformImpact.affectsRoutes;
  if (hasBreakingKeyword || (hasRouteChanges && combined.includes('api'))) {
    labels.push('breaking-change');
  }

  // Needs tests - when no test files in diff
  if (!hasTestFiles && fileList && fileList.length > 0) {
    const hasCodeChanges = fileList.some(f =>
      f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.jsx') || f.endsWith('.tsx')
    );
    if (hasCodeChanges) {
      labels.push('needs-tests');
    }
  }

  // Performance label - keywords in title/body
  const perfKeywords = ['performance', 'memory', 'cache', 'optimize', 'speed', 'slow', 'leak', 'latency'];
  if (perfKeywords.some(kw => combined.includes(kw))) {
    labels.push('performance');
  }

  // Bug fix label
  const bugKeywords = ['fix', 'bug', 'issue', 'error', 'crash', 'broken'];
  if (bugKeywords.some(kw => titleLower.includes(kw))) {
    labels.push('bug');
  }

  // Feature label
  const featureKeywords = ['feature', 'add', 'new', 'implement', 'introduce'];
  if (featureKeywords.some(kw => titleLower.startsWith(kw) || titleLower.includes('add '))) {
    labels.push('enhancement');
  }

  // Documentation label
  const docFiles = (fileList || []).filter(f =>
    f.endsWith('.md') || f.includes('docs/') || f.includes('README')
  );
  if (docFiles.length > 0 && docFiles.length === fileList.length) {
    labels.push('documentation');
  }

  // Refactor label
  const refactorKeywords = ['refactor', 'cleanup', 'reorganize', 'restructure'];
  if (refactorKeywords.some(kw => combined.includes(kw))) {
    labels.push('refactor');
  }

  // Deduplicate and return
  return [...new Set(labels)];
}

/**
 * Check if any files in the list are test files.
 * @param {string[]} fileList
 * @returns {boolean}
 */
function hasTestFiles(fileList) {
  if (!fileList || fileList.length === 0) return false;

  const testPatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /tests?\//,
    /__tests__\//,
    /\.test$/
  ];

  return fileList.some(f => testPatterns.some(p => p.test(f)));
}

module.exports = {
  suggestLabels,
  hasTestFiles
};
