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
  'rewrite'
];

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
  MODEL_PRICING
};
