/**
 * Retry utility module
 * Provides robust error handling with exponential backoff retry logic
 */
const logger = require('./logger');
const config = require('../config');

// Error classification patterns to determine retry strategies
const ERROR_TYPES = {
  NETWORK: [
    'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
    'network error', 'net::ERR', 'Network error', 'network timeout'
  ],
  TIMEOUT: [
    'timeout', 'Timeout', 'timed out', 'TimeoutError'
  ],
  BLOCKED: [
    'blocked', 'captcha', 'Blocked', 'detected', 'denied', 'forbidden', 'bot detection'
  ],
  RATE_LIMIT: [
    'rate limit', 'too many requests', '429', 'Rate limited', 'ratelimit'
  ],
  SERVER_ERROR: [
    '500', '502', '503', '504', 'Internal Server Error', 'Bad Gateway', 'Service Unavailable'
  ]
};

/**
 * Classify error to determine appropriate retry strategy
 * @param {Error} error - The error to classify
 * @returns {string} - Error type classification
 */
function classifyError(error) {
  if (!error) return 'UNKNOWN';
  
  const message = error.message || '';
  const code = error.code || '';
  const status = error.status || error.statusCode || 0;
  
  // Check for network errors
  if (ERROR_TYPES.NETWORK.some(pattern => message.includes(pattern) || code.includes(pattern))) {
    return 'NETWORK';
  }
  
  // Check for timeout errors
  if (ERROR_TYPES.TIMEOUT.some(pattern => message.includes(pattern) || code.includes(pattern))) {
    return 'TIMEOUT';
  }
  
  // Check for blocked/bot detection errors
  if (ERROR_TYPES.BLOCKED.some(pattern => message.includes(pattern) || code.includes(pattern))) {
    return 'BLOCKED';
  }
  
  // Check for rate limiting
  if (ERROR_TYPES.RATE_LIMIT.some(pattern => message.includes(pattern) || code.includes(pattern)) || status === 429) {
    return 'RATE_LIMIT';
  }
  
  // Check for server errors
  if (ERROR_TYPES.SERVER_ERROR.some(pattern => message.includes(pattern) || code.includes(pattern)) || 
      (status >= 500 && status < 600)) {
    return 'SERVER_ERROR';
  }
  
  // HTTP error codes
  if (status === 403 || status === 401) {
    return 'BLOCKED';
  }
  
  if (status === 404) {
    return 'NOT_FOUND';
  }
  
  return 'UNKNOWN';
}

/**
 * Calculate delay based on error type and attempt number
 * @param {string} errorType - Type of error
 * @param {number} attempt - Current attempt number
 * @param {number} baseDelay - Base delay in ms
 * @param {number} maxDelay - Maximum delay in ms
 * @returns {number} - Delay in ms before next retry
 */
function calculateSmartDelay(errorType, attempt, baseDelay, maxDelay) {
  // Base exponential backoff formula
  let delay = baseDelay * Math.pow(2, attempt - 1);
  
  // Adjust based on error type
  switch (errorType) {
    case 'NETWORK':
      // Network errors: short initial delay, increases more rapidly
      delay = baseDelay * Math.pow(1.5, attempt);
      break;
      
    case 'TIMEOUT':
      // Timeout errors: medium delay, increases steadily
      delay = baseDelay * Math.pow(1.7, attempt);
      break;
      
    case 'BLOCKED':
      // Blocking/captcha: longer delays to avoid detection patterns
      delay = baseDelay * 2 * Math.pow(2, attempt);
      break;
      
    case 'RATE_LIMIT':
      // Rate limiting: much longer delays to respect rate limits
      delay = baseDelay * 5 * Math.pow(2, attempt);
      break;
      
    case 'SERVER_ERROR':
      // Server errors: medium-long delay, increases moderately
      delay = baseDelay * 2 * Math.pow(1.5, attempt);
      break;
      
    default:
      // Unknown errors: standard exponential backoff
      delay = baseDelay * Math.pow(2, attempt - 1);
  }
  
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * (delay * 0.25);
  delay += jitter;
  
  // Cap at maximum delay
  return Math.min(delay, maxDelay);
}

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
 * @param {Boolean} [options.useSmartRetry=true] - Whether to use smart retry strategy
 * @returns {Promise<any>} - The result of the function execution
 */
async function withRetry(fn, options = {}) {
  const {
    retries = config.browser.retries,
    baseDelay = config.browser.baseRetryDelay,
    maxDelay = config.browser.maxRetryDelay,
    shouldRetry = () => true,
    operationName = 'operation',
    context = {},
    useSmartRetry = true
  } = options;

  let lastError;
  
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt - 1);
    } catch (error) {
      lastError = error;
      
      // For NOT_FOUND error types, we might not want to retry
      if (error.status === 404 || classifyError(error) === 'NOT_FOUND') {
        if (!shouldRetry(error)) {
          logger.warn(`${operationName} received 404 Not Found, not retrying`, {
            ...context,
            url: error.url || context.url
          });
          throw error;
        }
      }
      
      // Check if we should retry
      if (attempt > retries || !shouldRetry(error)) {
        logger.error(`${operationName} failed after ${attempt} attempt(s)`, {
          ...context,
          attempts: attempt,
          maxRetries: retries,
          errorType: useSmartRetry ? classifyError(error) : undefined
        }, error);
        throw error;
      }
      
      // Determine error type for smart retry
      const errorType = useSmartRetry ? classifyError(error) : 'UNKNOWN';
      
      // Calculate delay based on error type if using smart retry
      const delay = useSmartRetry
        ? calculateSmartDelay(errorType, attempt, baseDelay, maxDelay)
        : Math.min(baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500, maxDelay);
      
      logger.warn(`${operationName} failed, retrying in ${Math.round(delay)}ms (attempt ${attempt}/${retries})`, {
        ...context,
        errorMessage: error.message,
        attempt,
        errorType: useSmartRetry ? errorType : undefined,
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
  createRetryableFunction,
  classifyError,
  ERROR_TYPES
}; 