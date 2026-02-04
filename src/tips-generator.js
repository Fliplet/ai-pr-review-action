'use strict';

/**
 * Pattern-based tip definitions.
 * Each tip has a pattern to match against the diff and educational content.
 */
const TIP_DEFINITIONS = [
  {
    id: 'try-finally',
    pattern: /\btry\s*\{[\s\S]*?\}\s*finally\s*\{/,
    title: 'try/finally for cleanup',
    description: 'The `finally` block always executes, ensuring resources are released even when exceptions occur. This pattern is essential for preventing memory leaks with browser instances, file handles, and database connections.'
  },
  {
    id: 'async-await',
    pattern: /async\s+(?:function|\([^)]*\)\s*=>|\w+\s*=\s*async)/,
    title: 'async/await pattern',
    description: 'When converting callbacks to async/await, remember to wrap awaited calls in try/catch blocks to handle rejections. Unhandled promise rejections can crash Node.js processes.'
  },
  {
    id: 'middleware',
    pattern: /(?:app|router)\.(use|get|post|put|delete|patch)\s*\(/,
    title: 'Express middleware order',
    description: 'Middleware execution order matters in Express. Authentication and validation middleware should run before route handlers. Error-handling middleware (4 params) must be defined last.'
  },
  {
    id: 'route-validation',
    pattern: /router\.(get|post|put|delete|patch)\s*\(\s*['"`][^'"`]+['"`]/,
    title: 'Request validation',
    description: 'Always validate and sanitize request inputs (params, query, body) before use. Consider using validation libraries like Joi or express-validator to prevent injection attacks.'
  },
  {
    id: 'promise-all',
    pattern: /Promise\.all\s*\(/,
    title: 'Promise.all parallelism',
    description: 'Promise.all runs promises concurrently but fails fast on first rejection. For independent operations where you want all results (even failures), consider Promise.allSettled instead.'
  },
  {
    id: 'sql-params',
    pattern: /(?:query|execute)\s*\(\s*['"`][\s\S]*?\$\d/,
    title: 'Parameterized queries',
    description: 'Using parameterized queries ($1, $2, etc.) prevents SQL injection by ensuring user input is never interpolated directly into SQL. Always use parameters instead of string concatenation.'
  },
  {
    id: 'env-vars',
    pattern: /process\.env\.\w+/,
    title: 'Environment variables',
    description: 'Environment variables should be validated at startup. Missing required variables can cause cryptic runtime errors. Consider using a validation library or explicit checks during app initialization.'
  },
  {
    id: 'transaction',
    pattern: /\.transaction\s*\(|BEGIN|COMMIT|ROLLBACK/i,
    title: 'Database transactions',
    description: 'Transactions ensure atomicity - either all operations succeed or all are rolled back. Always include error handling to properly rollback failed transactions and release connections.'
  },
  {
    id: 'spread-operator',
    pattern: /\.\.\.\w+/,
    title: 'Spread operator caution',
    description: 'The spread operator creates shallow copies. For nested objects, changes to nested properties affect both copies. Use structured cloning or deep copy utilities for truly independent copies.'
  },
  {
    id: 'fliplet-storage',
    pattern: /Fliplet\.Storage/,
    title: 'Fliplet.Storage best practices',
    description: 'Fliplet.Storage provides cross-platform persistence. Always handle the promise rejection case, as storage may be unavailable in certain contexts (e.g., incognito mode on some browsers).'
  }
];

/**
 * Generate tips based on patterns detected in the diff.
 * Returns at most 2 tips to avoid noise.
 *
 * @param {string} diff - The full diff content
 * @returns {Array<{id: string, title: string, description: string}>}
 */
function generateTips(diff) {
  if (!diff || typeof diff !== 'string') {
    return [];
  }

  const matchedTips = [];

  for (const tip of TIP_DEFINITIONS) {
    if (tip.pattern.test(diff)) {
      matchedTips.push({
        id: tip.id,
        title: tip.title,
        description: tip.description
      });

      // Stop after 2 tips
      if (matchedTips.length >= 2) {
        break;
      }
    }
  }

  return matchedTips;
}

/**
 * Get all available tip definitions (for testing).
 * @returns {Array}
 */
function getTipDefinitions() {
  return TIP_DEFINITIONS;
}

module.exports = {
  generateTips,
  getTipDefinitions
};
