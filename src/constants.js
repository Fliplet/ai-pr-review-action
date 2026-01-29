'use strict';

/**
 * Shared constants for complexity scoring, file prioritization, and security detection.
 */

// File paths matching these patterns are security-sensitive and get review priority
const SECURITY_SENSITIVE_PATTERNS = [
  /auth/i,
  /middleware/i,
  /migration/i,
  /session/i,
  /encrypt/i,
  /password/i,
  /token/i,
  /permission/i,
  /sql/i,
  /route/i,
  /api\//i,
  /secret/i,
  /crypt/i,
  /sanitiz/i,
  /valid/i,
  /login/i
];

// Core application files that are high-impact
const CORE_FILE_PATTERNS = [
  /index\.js$/,
  /app\.js$/,
  /server\.js$/
];

// Keywords in PR title/body that indicate complexity
const COMPLEXITY_KEYWORDS = [
  'refactor',
  'migration',
  'security',
  'architecture',
  'breaking',
  'rewrite',
  'endpoint',
  'schema',
  'database'
];

// Platform-specific file pattern categories for impact assessment
const ROUTE_FILE_PATTERNS = [/routes\//i];
const MIGRATION_FILE_PATTERNS = [/models\/migrations\//i, /migrations?\//i];
const MODEL_FILE_PATTERNS = [/models\/[^/]+\.js$/i];
const DEPENDENCY_FILE_PATTERNS = [/^package\.json$/];
const MIDDLEWARE_FILE_PATTERNS = [/libs\/middlewares\//i];
const AUTH_FILE_PATTERNS = [
  /libs\/authenticate/i, /libs\/passports/i, /libs\/guards/i,
  /routes\/v1\/auth/i, /routes\/v1\/session/i
];
const DATA_SOURCE_PATTERNS = [
  /libs\/datasources/i, /routes\/v1\/data-sources/i, /models\/dataSource/i
];
const TEST_FILE_PATTERNS = [/tests?\//i, /\.test\.js$/i, /\.spec\.js$/i];

// Model identifiers
const MODELS = {
  SONNET: 'claude-sonnet-4-20250514',
  OPUS: 'claude-opus-4-5-20250514'
};

// Pricing per million tokens (input / output)
const MODEL_PRICING = {
  [MODELS.SONNET]: { input: 3, output: 15 },
  [MODELS.OPUS]: { input: 15, output: 75 }
};

module.exports = {
  SECURITY_SENSITIVE_PATTERNS,
  CORE_FILE_PATTERNS,
  COMPLEXITY_KEYWORDS,
  MODELS,
  MODEL_PRICING,
  ROUTE_FILE_PATTERNS,
  MIGRATION_FILE_PATTERNS,
  MODEL_FILE_PATTERNS,
  DEPENDENCY_FILE_PATTERNS,
  MIDDLEWARE_FILE_PATTERNS,
  AUTH_FILE_PATTERNS,
  DATA_SOURCE_PATTERNS,
  TEST_FILE_PATTERNS
};
