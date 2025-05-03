/**
 * Retry utility module
 * Provides robust error handling with exponential backoff retry logic
 */
const logger = require('./logger');
const config = require('../config');

/**
 * Execute a function with retry capability and exponential backoff
 * 
 * @param {Function} fn - The function to execute (should return a Promise)
 * @param {Object} options - Retry options
 * @param {number} [options.retries=3] - Maximum number of retry attempts
 * @param {number} [options.baseDelay=1200] - Base delay in ms before retrying
 * @param {number} [options.maxDelay=30000] - Maximum delay between retries
 * @param {Function} [options.shouldRetry] - Function to determine if retry should happen based on error
 * @param {string} [options.operationName='operation'] - Name of the operation for logging
 * @param {Object} [options.context={}] - Additional context for logging
 * @returns {Promise<any>} - The result of the function execution
 */
async function withRetry(fn, options = {}) {
  const {
    retries = config.browser.retries,
    baseDelay = config.browser.baseRetryDelay,
    maxDelay = 30000,
    shouldRetry = () => true,
    operationName = 'operation',
    context = {}
  } = options;

  let lastError;
  
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt - 1);
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt > retries || !shouldRetry(error)) {
        logger.error(`${operationName} failed after ${attempt} attempt(s)`, {
          ...context,
          attempts: attempt,
          maxRetries: retries
        }, error);
        throw error;
      }
      
      // Calculate exponential backoff with jitter
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500,
        maxDelay
      );
      
      logger.warn(`${operationName} failed, retrying in ${Math.round(delay)}ms (attempt ${attempt}/${retries})`, {
        ...context,
        errorMessage: error.message,
        attempt,
        nextDelayMs: Math.round(delay)
      });
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This should never happen due to the throw in the catch block
  throw lastError;
}

/**
 * Create a retry-ready version of a function
 * 
 * @param {Function} fn - The function to wrap with retry capability
 * @param {Object} options - Retry options (see withRetry)
 * @returns {Function} - The wrapped function with retry capability
 */
function createRetryableFunction(fn, options = {}) {
  return async (...args) => {
    return withRetry(async () => fn(...args), options);
  };
}

module.exports = {
  withRetry,
  createRetryableFunction
}; 