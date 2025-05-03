/**
 * Error Classification Service
 * Classifies and handles various types of errors encountered during scraping
 */
const logger = require('../../utils/logger');
const { extractDomain, calculateBackoffDelay } = require('../../utils/shared');

// Error types
const ERROR_TYPES = {
  // Network errors
  NETWORK: 'NETWORK',
  CONNECTION_RESET: 'CONNECTION_RESET',
  DNS_LOOKUP: 'DNS_LOOKUP',
  TIMEOUT: 'TIMEOUT',
  
  // HTTP errors
  HTTP_400: 'HTTP_400',
  HTTP_401: 'HTTP_401',
  HTTP_403: 'HTTP_403',
  HTTP_404: 'HTTP_404',
  HTTP_429: 'HTTP_429',
  HTTP_500: 'HTTP_500',
  HTTP_503: 'HTTP_503',
  
  // Content errors
  CONTENT_EMPTY: 'CONTENT_EMPTY',
  CONTENT_INVALID: 'CONTENT_INVALID',
  PARSE_ERROR: 'PARSE_ERROR',
  
  // Bot detection
  CAPTCHA: 'CAPTCHA',
  BOT_DETECTION: 'BOT_DETECTION',
  FINGERPRINT_DETECTED: 'FINGERPRINT_DETECTED',
  BROWSER_VERIFICATION: 'BROWSER_VERIFICATION',
  
  // Authentication
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  
  // Proxy issues
  PROXY_ERROR: 'PROXY_ERROR',
  PROXY_BANNED: 'PROXY_BANNED',
  
  // Resource issues
  RESOURCE_LIMIT: 'RESOURCE_LIMIT',
  
  // Circuit breaker
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  
  // Unknown
  UNKNOWN: 'UNKNOWN'
};

// Retry strategies by error type
const RETRY_STRATEGIES = {
  // Network errors - retry quickly with short delay
  [ERROR_TYPES.NETWORK]: {
    maxRetries: 5,
    baseDelay: 1000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: false
  },
  [ERROR_TYPES.CONNECTION_RESET]: {
    maxRetries: 4,
    baseDelay: 2000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: false
  },
  [ERROR_TYPES.DNS_LOOKUP]: {
    maxRetries: 3,
    baseDelay: 5000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: false
  },
  [ERROR_TYPES.TIMEOUT]: {
    maxRetries: 4,
    baseDelay: 2000,
    backoffFactor: 2,
    shouldRotateProxy: true,
    shouldRecreateSession: false,
    increaseTimeout: true
  },
  
  // HTTP errors
  [ERROR_TYPES.HTTP_400]: {
    maxRetries: 2,
    baseDelay: 1000,
    backoffFactor: 1.5,
    shouldRotateProxy: false,
    shouldRecreateSession: false
  },
  [ERROR_TYPES.HTTP_401]: {
    maxRetries: 1,
    baseDelay: 1000,
    backoffFactor: 1,
    shouldRotateProxy: false,
    shouldRecreateSession: true,
    requiresAuthentication: true
  },
  [ERROR_TYPES.HTTP_403]: {
    maxRetries: 3,
    baseDelay: 5000,
    backoffFactor: 2,
    shouldRotateProxy: true,
    shouldRecreateSession: true,
    enhanceStealth: true
  },
  [ERROR_TYPES.HTTP_404]: {
    maxRetries: 1, // Rarely helps to retry 404s
    baseDelay: 1000,
    backoffFactor: 1,
    shouldRotateProxy: false,
    shouldRecreateSession: false
  },
  [ERROR_TYPES.HTTP_429]: {
    maxRetries: 5,
    baseDelay: 10000, // Longer delay for rate limiting
    backoffFactor: 2,
    shouldRotateProxy: true,
    shouldRecreateSession: true,
    enhanceStealth: true
  },
  [ERROR_TYPES.HTTP_500]: {
    maxRetries: 3,
    baseDelay: 3000,
    backoffFactor: 1.5,
    shouldRotateProxy: false,
    shouldRecreateSession: false
  },
  [ERROR_TYPES.HTTP_503]: {
    maxRetries: 4,
    baseDelay: 5000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: false
  },
  
  // Content errors
  [ERROR_TYPES.CONTENT_EMPTY]: {
    maxRetries: 3,
    baseDelay: 2000,
    backoffFactor: 1.5,
    shouldRotateProxy: false,
    shouldRecreateSession: true,
    waitForContentSelector: true
  },
  [ERROR_TYPES.CONTENT_INVALID]: {
    maxRetries: 2,
    baseDelay: 2000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: false
  },
  [ERROR_TYPES.PARSE_ERROR]: {
    maxRetries: 2,
    baseDelay: 1000,
    backoffFactor: 1.5,
    shouldRotateProxy: false,
    shouldRecreateSession: false,
    useAlternativeParser: true
  },
  
  // Bot detection
  [ERROR_TYPES.CAPTCHA]: {
    maxRetries: 3,
    baseDelay: 5000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: true,
    enhanceStealth: true,
    solveCaptcha: true
  },
  [ERROR_TYPES.BOT_DETECTION]: {
    maxRetries: 4,
    baseDelay: 5000,
    backoffFactor: 2,
    shouldRotateProxy: true,
    shouldRecreateSession: true,
    enhanceStealth: true,
    evasionTechniques: {
      emulateHumanBehavior: true,
      randomizeFingerprint: true,
      delayRequests: true
    }
  },
  [ERROR_TYPES.FINGERPRINT_DETECTED]: {
    maxRetries: 3,
    baseDelay: 5000,
    backoffFactor: 2,
    shouldRotateProxy: true,
    shouldRecreateSession: true,
    enhanceStealth: true,
    evasionTechniques: {
      randomizeFingerprint: true,
      useIncognitoContext: true
    }
  },
  [ERROR_TYPES.BROWSER_VERIFICATION]: {
    maxRetries: 3,
    baseDelay: 3000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: true,
    enhanceStealth: true,
    evasionTechniques: {
      emulateHumanBehavior: true
    }
  },
  
  // Authentication
  [ERROR_TYPES.AUTH_REQUIRED]: {
    maxRetries: 2,
    baseDelay: 1000,
    backoffFactor: 1.5,
    shouldRotateProxy: false,
    shouldRecreateSession: true,
    requiresAuthentication: true
  },
  [ERROR_TYPES.SESSION_EXPIRED]: {
    maxRetries: 2,
    baseDelay: 1000,
    backoffFactor: 1.5,
    shouldRotateProxy: false,
    shouldRecreateSession: true,
    requiresAuthentication: true
  },
  
  // Proxy issues
  [ERROR_TYPES.PROXY_ERROR]: {
    maxRetries: 5,
    baseDelay: 1000,
    backoffFactor: 1.2,
    shouldRotateProxy: true,
    shouldRecreateSession: true
  },
  [ERROR_TYPES.PROXY_BANNED]: {
    maxRetries: 3,
    baseDelay: 5000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: true,
    disableProxy: true // Disable the current proxy
  },
  
  // Resource issues
  [ERROR_TYPES.RESOURCE_LIMIT]: {
    maxRetries: 3,
    baseDelay: 10000,
    backoffFactor: 2,
    shouldRotateProxy: false,
    shouldRecreateSession: true,
    reduceResourceUsage: true
  },
  
  // Circuit breaker
  [ERROR_TYPES.CIRCUIT_OPEN]: {
    maxRetries: 0, // Don't retry circuit open errors
    baseDelay: 0,
    backoffFactor: 1,
    shouldRotateProxy: false,
    shouldRecreateSession: false
  },
  
  // Default/unknown errors
  [ERROR_TYPES.UNKNOWN]: {
    maxRetries: 3,
    baseDelay: 2000,
    backoffFactor: 1.5,
    shouldRotateProxy: true,
    shouldRecreateSession: false
  }
};

// Error detection patterns
const ERROR_PATTERNS = [
  // Bot detection patterns
  { 
    regex: /captcha|recaptcha|capcha/i, 
    type: ERROR_TYPES.CAPTCHA 
  },
  { 
    regex: /bot detected|bot protection|detected.+?bot|botcheck/i, 
    type: ERROR_TYPES.BOT_DETECTION 
  },
  { 
    regex: /browser not supported|verify.+?browser|verification required/i, 
    type: ERROR_TYPES.BROWSER_VERIFICATION 
  },
  { 
    regex: /unusual traffic|suspicious activity|suspicious request|security check/i, 
    type: ERROR_TYPES.FINGERPRINT_DETECTED 
  },
  
  // Authentication patterns
  { 
    regex: /login required|please sign in|authentication required/i, 
    type: ERROR_TYPES.AUTH_REQUIRED 
  },
  { 
    regex: /session expired|session timeout|please login again/i, 
    type: ERROR_TYPES.SESSION_EXPIRED 
  },
  
  // Proxy and IP patterns
  { 
    regex: /ip banned|ip blocked|address banned|address blocked/i, 
    type: ERROR_TYPES.PROXY_BANNED 
  },
  { 
    regex: /too many requests|rate limit|rate-limit|ratelimit|too many connections/i, 
    type: ERROR_TYPES.HTTP_429 
  },
  
  // Content patterns
  { 
    regex: /no results found|no products found|no items found/i, 
    type: ERROR_TYPES.CONTENT_EMPTY
  }
];

class ErrorClassificationService {
  constructor() {
    this.errorTypes = ERROR_TYPES;
    this.retryStrategies = RETRY_STRATEGIES;
    this.errorPatterns = ERROR_PATTERNS;
    
    // Domain-specific error patterns
    this.domainPatterns = new Map();
    
    // Error statistics
    this.errorStats = {
      totalErrors: 0,
      errorsByType: {},
      errorsByDomain: {}
    };
    
    // Cache for already classified errors to prevent duplicate processing
    this.classificationCache = new Map();
    this.maxCacheSize = 1000;
    
    this._initializeDomainPatterns();
  }
  
  /**
   * Initialize domain-specific error patterns
   * @private
   */
  _initializeDomainPatterns() {
    // Amazon patterns
    this.domainPatterns.set('amazon.com', [
      { 
        regex: /robot check|not a robot|bot check|human/i, 
        type: ERROR_TYPES.CAPTCHA 
      },
      { 
        regex: /sorry.*technical issue|difficulty.*website/i, 
        type: ERROR_TYPES.HTTP_503 
      }
    ]);
    
    // Walmart patterns
    this.domainPatterns.set('walmart.com', [
      { 
        regex: /access denied|unusual activity|security challenge/i, 
        type: ERROR_TYPES.BOT_DETECTION 
      },
      { 
        regex: /verification required|verify.+?human/i, 
        type: ERROR_TYPES.CAPTCHA 
      }
    ]);
    
    // BestBuy patterns
    this.domainPatterns.set('bestbuy.com', [
      { 
        regex: /access denied|unusual activity|security challenge/i, 
        type: ERROR_TYPES.BOT_DETECTION 
      },
      { 
        regex: /high demand|high volume|try again later/i, 
        type: ERROR_TYPES.HTTP_429 
      }
    ]);
  }
  
  /**
   * Generate a cache key for an error and context
   * @param {Error} error - Error object
   * @param {Object} context - Context object
   * @returns {string} - Cache key
   * @private
   */
  _generateCacheKey(error, context) {
    const errorKey = `${error.name}:${error.message}:${error.code || ''}`;
    const contextKey = context.url ? `:${context.url}:${context.statusCode || ''}` : '';
    return errorKey + contextKey;
  }
  
  /**
   * Clean up the classification cache if it exceeds the max size
   * @private
   */
  _cleanupCache() {
    if (this.classificationCache.size > this.maxCacheSize) {
      // Remove oldest entries (first 20% of the cache)
      const entriesToRemove = Math.floor(this.maxCacheSize * 0.2);
      const keys = Array.from(this.classificationCache.keys()).slice(0, entriesToRemove);
      keys.forEach(key => this.classificationCache.delete(key));
    }
  }
  
  /**
   * Classify an error based on message, status code, and HTML content
   * @param {Error} error - Error object
   * @param {Object} context - Additional context for classification
   * @returns {Object} - Classified error
   */
  classifyError(error, context = {}) {
    // Ensure we have valid input
    if (!error) {
      logger.warn('Attempted to classify undefined error');
      error = new Error('Unknown error');
    }
    
    const {
      statusCode,
      url,
      html,
      headers = {},
      responseData
    } = context;
    
    // Check cache first
    const cacheKey = this._generateCacheKey(error, context);
    if (this.classificationCache.has(cacheKey)) {
      return this.classificationCache.get(cacheKey);
    }
    
    // Start with unknown type
    let errorType = ERROR_TYPES.UNKNOWN;
    
    // Try to extract domain from URL
    let domain = null;
    if (url) {
      domain = extractDomain(url);
    }
    
    // Check if it's already a classified error
    if (error.type && Object.values(ERROR_TYPES).includes(error.type)) {
      errorType = error.type;
    } 
    // Classify based on status code
    else if (statusCode) {
      switch (statusCode) {
        case 400: errorType = ERROR_TYPES.HTTP_400; break;
        case 401: errorType = ERROR_TYPES.AUTH_REQUIRED; break;
        case 403: errorType = ERROR_TYPES.HTTP_403; break;
        case 404: errorType = ERROR_TYPES.HTTP_404; break;
        case 429: errorType = ERROR_TYPES.HTTP_429; break;
        case 500: errorType = ERROR_TYPES.HTTP_500; break;
        case 503: errorType = ERROR_TYPES.HTTP_503; break;
      }
    }
    // Classify network errors
    else if (error.code === 'ECONNRESET') {
      errorType = ERROR_TYPES.CONNECTION_RESET;
    }
    else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' || error.message?.includes('timeout')) {
      errorType = ERROR_TYPES.TIMEOUT;
    }
    else if (error.code === 'ENOTFOUND' || error.code === 'ENOENT') {
      errorType = ERROR_TYPES.DNS_LOOKUP;
    }
    else if (error.code && error.code.startsWith('E') && !error.statusCode) {
      errorType = ERROR_TYPES.NETWORK;
    }
    
    // Check error message against patterns
    const errorMessage = error.message || '';
    
    // Check domain-specific patterns first
    if (domain) {
      for (const [patternDomain, patterns] of this.domainPatterns.entries()) {
        if (domain.includes(patternDomain)) {
          for (const pattern of patterns) {
            if (pattern.regex.test(errorMessage) || 
                (html && pattern.regex.test(html))) {
              errorType = pattern.type;
              break;
            }
          }
        }
      }
    }
    
    // Check general patterns if not classified by domain
    if (errorType === ERROR_TYPES.UNKNOWN) {
      for (const pattern of this.errorPatterns) {
        if (pattern.regex.test(errorMessage) || 
            (html && pattern.regex.test(html))) {
          errorType = pattern.type;
          break;
        }
      }
    }
    
    // Check HTML content if available
    if (html && errorType === ERROR_TYPES.UNKNOWN) {
      // Check for empty content
      if (html.trim().length < 50) {
        errorType = ERROR_TYPES.CONTENT_EMPTY;
      }
      
      // Check for common error indicators in HTML
      if (/<title>.*?(error|sorry|blocked|captcha|robot|security).*?<\/title>/i.test(html)) {
        // Try to determine specific type based on content
        if (/captcha|recaptcha|robot/i.test(html)) {
          errorType = ERROR_TYPES.CAPTCHA;
        } else if (/blocked|banned|unusual|suspicious/i.test(html)) {
          errorType = ERROR_TYPES.BOT_DETECTION;
        } else if (/login|sign in|account/i.test(html)) {
          errorType = ERROR_TYPES.AUTH_REQUIRED;
        }
      }
    }
    
    // Update statistics
    this.errorStats.totalErrors++;
    this.errorStats.errorsByType[errorType] = (this.errorStats.errorsByType[errorType] || 0) + 1;
    
    if (domain) {
      if (!this.errorStats.errorsByDomain[domain]) {
        this.errorStats.errorsByDomain[domain] = {};
      }
      this.errorStats.errorsByDomain[domain][errorType] = 
        (this.errorStats.errorsByDomain[domain][errorType] || 0) + 1;
    }
    
    // Get retry strategy
    const retryStrategy = this.getRetryStrategy(errorType);
    
    // Create classified error
    const classifiedError = new Error(error.message);
    classifiedError.originalError = error;
    classifiedError.type = errorType;
    classifiedError.retryStrategy = retryStrategy;
    classifiedError.context = context;
    classifiedError.time = Date.now();
    
    // Cache the result
    this.classificationCache.set(cacheKey, classifiedError);
    this._cleanupCache();
    
    logger.debug('Classified error', { 
      type: errorType, 
      url,
      message: error.message
    });
    
    return classifiedError;
  }
  
  /**
   * Get the retry strategy for an error type
   * @param {string} errorType - Error type
   * @returns {Object} - Retry strategy
   */
  getRetryStrategy(errorType) {
    return this.retryStrategies[errorType] || this.retryStrategies[ERROR_TYPES.UNKNOWN];
  }
  
  /**
   * Calculate backoff delay for a retry
   * @param {Object} retryStrategy - Retry strategy
   * @param {number} attempt - Current attempt number (starts at 1)
   * @returns {number} - Delay in milliseconds
   */
  calculateBackoffDelay(retryStrategy, attempt) {
    const { baseDelay, backoffFactor } = retryStrategy;
    return calculateBackoffDelay(baseDelay, attempt, backoffFactor);
  }
  
  /**
   * Check if an error should be retried
   * @param {Object} classifiedError - Classified error
   * @param {number} attempt - Current attempt number (starts at 1)
   * @returns {boolean} - Whether to retry
   */
  shouldRetry(classifiedError, attempt) {
    if (!classifiedError || !classifiedError.retryStrategy) {
      return false;
    }
    
    const { retryStrategy } = classifiedError;
    return attempt <= retryStrategy.maxRetries;
  }
  
  /**
   * Create a retry context with appropriate recovery actions
   * @param {Object} classifiedError - Classified error
   * @param {number} attempt - Current attempt number
   * @param {Object} baseContext - Base context to extend
   * @returns {Object} - Retry context with recovery actions
   */
  createRetryContext(classifiedError, attempt, baseContext = {}) {
    if (!classifiedError || !classifiedError.retryStrategy) {
      logger.warn('Attempted to create retry context for invalid error');
      return { ...baseContext, attempt, delay: 1000 };
    }
    
    const { retryStrategy, type } = classifiedError;
    const delay = this.calculateBackoffDelay(retryStrategy, attempt);
    
    // Create retry context with appropriate recovery actions
    const retryContext = {
      ...baseContext,
      errorType: type,
      attempt,
      delay,
      maxRetries: retryStrategy.maxRetries
    };
    
    // Add recovery actions
    if (retryStrategy.shouldRotateProxy) {
      retryContext.rotateProxy = true;
    }
    
    if (retryStrategy.shouldRecreateSession) {
      retryContext.recreateSession = true;
    }
    
    if (retryStrategy.enhanceStealth) {
      retryContext.enhanceStealth = true;
    }
    
    if (retryStrategy.evasionTechniques) {
      retryContext.evasionTechniques = retryStrategy.evasionTechniques;
    }
    
    if (retryStrategy.increaseTimeout) {
      retryContext.timeoutMultiplier = 1 + (attempt * 0.5); // Increase timeout by 50% each attempt
    }
    
    if (retryStrategy.waitForContentSelector) {
      retryContext.waitForContentSelector = true;
    }
    
    if (retryStrategy.useAlternativeParser) {
      retryContext.useAlternativeParser = true;
    }
    
    if (retryStrategy.solveCaptcha) {
      retryContext.solveCaptcha = true;
    }
    
    if (retryStrategy.disableProxy) {
      retryContext.disableProxy = true;
    }
    
    if (retryStrategy.requiresAuthentication) {
      retryContext.requiresAuthentication = true;
    }
    
    if (retryStrategy.reduceResourceUsage) {
      retryContext.reduceResourceUsage = true;
      retryContext.simplified = true;
    }
    
    // For some errors, simplify the request
    if (attempt > retryStrategy.maxRetries / 2) {
      retryContext.simplified = true;
    }
    
    return retryContext;
  }
  
  /**
   * Get error statistics
   * @returns {Object} - Error statistics
   */
  getErrorStats() {
    return { ...this.errorStats };
  }
  
  /**
   * Reset error statistics
   */
  resetErrorStats() {
    this.errorStats = {
      totalErrors: 0,
      errorsByType: {},
      errorsByDomain: {}
    };
    
    // Also clear the cache
    this.classificationCache.clear();
  }
  
  /**
   * Add a custom error pattern
   * @param {RegExp} regex - Regular expression to match
   * @param {string} type - Error type
   * @param {string} domain - Optional domain to restrict pattern to
   */
  addErrorPattern(regex, type, domain = null) {
    if (!Object.values(ERROR_TYPES).includes(type)) {
      throw new Error(`Invalid error type: ${type}`);
    }
    
    if (!(regex instanceof RegExp)) {
      try {
        regex = new RegExp(regex);
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${error.message}`);
      }
    }
    
    const pattern = { regex, type };
    
    if (domain) {
      if (!this.domainPatterns.has(domain)) {
        this.domainPatterns.set(domain, []);
      }
      this.domainPatterns.get(domain).push(pattern);
    } else {
      this.errorPatterns.push(pattern);
    }
    
    // Clear cache after adding new patterns
    this.classificationCache.clear();
    
    return true;
  }
}

// Export both the service instance and error types
const errorClassificationService = new ErrorClassificationService();
module.exports = errorClassificationService;
module.exports.ERROR_TYPES = ERROR_TYPES; 