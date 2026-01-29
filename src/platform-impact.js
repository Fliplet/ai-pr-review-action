'use strict';

const fs = require('fs');
const path = require('path');
const {
  AUTH_FILE_PATTERNS,
  DATA_SOURCE_PATTERNS,
  MIDDLEWARE_FILE_PATTERNS,
  MIGRATION_FILE_PATTERNS,
  ROUTE_FILE_PATTERNS,
  DEPENDENCY_FILE_PATTERNS
} = require('./constants');

/**
 * Load architecture knowledge from static JSON.
 * Returns empty structure if file is missing (graceful degradation).
 */
function loadArchitecture() {
  try {
    const archPath = path.join(__dirname, '..', 'standards', 'fliplet-architecture.json');
    return JSON.parse(fs.readFileSync(archPath, 'utf-8'));
  } catch (err) {
    return { criticalPaths: {} };
  }
}

const RISK_LEVELS = ['critical', 'high', 'medium', 'low'];

/**
 * Compare risk levels. Returns the higher risk.
 */
function higherRisk(a, b) {
  const ai = RISK_LEVELS.indexOf(a);
  const bi = RISK_LEVELS.indexOf(b);
  return ai <= bi ? a : b;
}

/**
 * Deterministic platform impact assessment.
 * Pure pattern matching — no LLM call. Runs in milliseconds.
 *
 * @param {Array<{ path: string }>} files - Parsed diff files
 * @param {string} repoName - Repository name (e.g., 'fliplet-api')
 * @returns {object} Impact assessment
 */
function assessPlatformImpact(files, repoName) {
  const architecture = loadArchitecture();
  const impacts = [];
  let overallLevel = 'low';

  const flags = {
    affectsAuth: false,
    affectsData: false,
    affectsMiddleware: false,
    affectsSchema: false,
    affectsRoutes: false,
    affectsDependencies: false
  };

  let criticalFileCount = 0;
  let highFileCount = 0;

  for (const file of files) {
    const filePath = file.path;

    // Check against architecture critical paths
    for (const [category, info] of Object.entries(architecture.criticalPaths || {})) {
      const matched = info.files.some(pattern => {
        // Support both exact prefix matches and directory matches
        if (pattern.endsWith('/')) {
          return filePath.includes(pattern) || filePath.startsWith(pattern);
        }
        return filePath.includes(pattern);
      });

      if (matched) {
        impacts.push({
          file: filePath,
          category,
          risk: info.risk,
          description: info.description
        });
        overallLevel = higherRisk(overallLevel, info.risk);
        if (info.risk === 'critical') criticalFileCount++;
        if (info.risk === 'high') highFileCount++;
      }
    }

    // Check constant patterns for flag setting
    if (AUTH_FILE_PATTERNS.some(p => p.test(filePath))) {
      flags.affectsAuth = true;
      if (overallLevel !== 'critical') overallLevel = higherRisk(overallLevel, 'high');
    }

    if (DATA_SOURCE_PATTERNS.some(p => p.test(filePath))) {
      flags.affectsData = true;
      if (overallLevel !== 'critical') overallLevel = higherRisk(overallLevel, 'high');
    }

    if (MIDDLEWARE_FILE_PATTERNS.some(p => p.test(filePath))) {
      flags.affectsMiddleware = true;
      overallLevel = higherRisk(overallLevel, 'critical');
    }

    if (MIGRATION_FILE_PATTERNS.some(p => p.test(filePath))) {
      flags.affectsSchema = true;
      overallLevel = higherRisk(overallLevel, 'critical');
    }

    if (ROUTE_FILE_PATTERNS.some(p => p.test(filePath))) {
      flags.affectsRoutes = true;
      if (overallLevel !== 'critical') overallLevel = higherRisk(overallLevel, 'medium');
    }

    if (DEPENDENCY_FILE_PATTERNS.some(p => p.test(filePath))) {
      flags.affectsDependencies = true;
      if (overallLevel !== 'critical' && overallLevel !== 'high') {
        overallLevel = higherRisk(overallLevel, 'medium');
      }
    }
  }

  // Deduplicate impacts by file+category
  const seen = new Set();
  const uniqueImpacts = impacts.filter(i => {
    const key = `${i.file}:${i.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = buildSummary(uniqueImpacts, flags, overallLevel);

  return {
    level: overallLevel,
    impacts: uniqueImpacts,
    summary,
    ...flags,
    criticalFileCount,
    highFileCount
  };
}

/**
 * Build a human-readable summary for the Claude prompt.
 * Returns empty string for low-impact PRs to avoid noise.
 */
function buildSummary(impacts, flags, level) {
  if (level === 'low') return '';

  const parts = [];

  // Group impacted categories
  const categories = [...new Set(impacts.map(i => i.category))];
  const impactedFiles = [...new Set(impacts.map(i => i.file))];

  if (impactedFiles.length > 0) {
    const fileExamples = impactedFiles.slice(0, 3).join(', ');
    const more = impactedFiles.length > 3 ? ` and ${impactedFiles.length - 3} more` : '';
    parts.push(`This PR modifies ${categories.join(', ')} paths (${fileExamples}${more}).`);
  }

  // Flag-based warnings
  const warnings = [];
  if (flags.affectsAuth) warnings.push('authentication');
  if (flags.affectsMiddleware) warnings.push('middleware pipeline');
  if (flags.affectsSchema) warnings.push('database schema');
  if (flags.affectsData) warnings.push('data source layer');
  if (flags.affectsDependencies) warnings.push('dependencies');

  if (warnings.length > 0) {
    parts.push(`Affected areas: ${warnings.join(', ')}.`);
  }

  if (level === 'critical') {
    parts.push('These are critical platform paths — pay special attention to security regressions, breaking changes, and data integrity.');
  } else if (level === 'high') {
    parts.push('These are high-impact platform paths — check for breaking changes and regressions.');
  } else {
    parts.push('Review for unintended side effects.');
  }

  return parts.join(' ');
}

module.exports = { assessPlatformImpact };
