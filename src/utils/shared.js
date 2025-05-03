/**
 * Shared Utility Functions
 * Common functionality used across different services in the scraper system
 */
const { URL } = require('url');
const crypto = require('crypto');
const logger = require('./logger');

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} - Extracted domain or original URL if parsing fails
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    // If URL is invalid, return the original string
    return url;
  }
}

/**
 * Apply jitter to a delay value to prevent thundering herd problem
 * @param {number} baseDelay - Base delay value in milliseconds
 * @param {number} factor - Jitter factor (0-1)
 * @returns {number} - Delay with jitter applied
 */
function applyJitter(baseDelay, factor = 0.2) {
  const jitter = baseDelay * factor * (Math.random() * 2 - 1);
  return Math.floor(baseDelay + jitter);
}

/**
 * Calculate exponential backoff delay
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} attempt - Current attempt number (starting from 1)
 * @param {number} backoffFactor - Factor to multiply each attempt
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number} - Calculated delay with jitter
 */
function calculateBackoffDelay(baseDelay, attempt, backoffFactor = 1.5, maxDelay = 60000) {
  const exponentialPart = Math.pow(backoffFactor, attempt - 1);
  const calculatedDelay = Math.min(baseDelay * exponentialPart, maxDelay);
  return applyJitter(calculatedDelay);
}

/**
 * Safely parse JSON with error handling
 * @param {string} str - JSON string to parse
 * @param {*} defaultValue - Default value to return on error
 * @returns {*} - Parsed object or default value
 */
function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch (error) {
    logger.warn('Failed to parse JSON', { error: error.message });
    return defaultValue;
  }
}

/**
 * Generate a random ID
 * @param {number} length - Length of ID (default: 10)
 * @returns {string} - Random ID
 */
function generateId(length = 10) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Sanitize an input value to prevent injections
 * @param {string} input - Input to sanitize
 * @returns {string} - Sanitized input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  // Basic input sanitization to prevent injection
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/**
 * Create a throttled version of a function
 * @param {Function} func - Function to throttle
 * @param {number} limit - Throttle limit in milliseconds
 * @returns {Function} - Throttled function
 */
function throttle(func, limit) {
  let lastCall = 0;
  let lastResult;
  
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      lastResult = func.apply(this, args);
    }
    return lastResult;
  };
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  extractDomain,
  applyJitter,
  calculateBackoffDelay,
  safeJsonParse,
  generateId,
  sanitizeInput,
  throttle,
  sleep
}; 