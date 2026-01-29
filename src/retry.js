'use strict';

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 529];

/**
 * Retry a function with exponential backoff on transient errors.
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options
 * @param {number} options.maxRetries - Maximum number of attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {string} options.label - Label for log messages
 */
async function withRetry(fn, { maxRetries = 3, baseDelay = 1000, label = 'API call' } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.statusCode || (err.error && err.error.status);
      const isRetryable = RETRYABLE_STATUS_CODES.includes(status) ||
                          err.code === 'ECONNRESET' ||
                          err.code === 'ETIMEDOUT';

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

module.exports = { withRetry };
