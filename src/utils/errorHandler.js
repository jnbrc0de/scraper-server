/**
 * Advanced Error Handler Module
 * Provides sophisticated error classification and handling strategies for web scraping
 */
const logger = require('./logger');
const config = require('../config');

// Error classification constants
const ERROR_TYPES = {
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  PARSE: 'parse',
  CAPTCHA: 'captcha',
  BLOCKED: 'blocked',
  ACCESS_DENIED: 'access_denied',
  RATE_LIMIT: 'rate_limit',
  SESSION_EXPIRED: 'session_expired',
  DATA_VALIDATION: 'data_validation',
  BROWSER: 'browser',
  PROXY: 'proxy',
  UNKNOWN: 'unknown'
};

/**
 * Classifies an error based on its properties and message
 * @param {Error} error - The error to classify
 * @param {Object} context - Additional context about the request
 * @returns {String} - The classified error type
 */
function classifyError(error, context = {}) {
  const message = error.message ? error.message.toLowerCase() : '';
  const stack = error.stack ? error.stack.toLowerCase() : '';
  
  // Network errors
  if (
    message.includes('net::') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('socket') ||
    message.includes('dns')
  ) {
    return ERROR_TYPES.NETWORK;
  }
  
  // Timeout errors
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    error.name === 'TimeoutError'
  ) {
    return ERROR_TYPES.TIMEOUT;
  }
  
  // Parsing errors
  if (
    message.includes('parse') ||
    message.includes('syntax') ||
    message.includes('unexpected token') ||
    error.name === 'SyntaxError'
  ) {
    return ERROR_TYPES.PARSE;
  }
  
  // Captcha detection
  if (
    message.includes('captcha') ||
    (context.html && (
      context.html.includes('captcha') ||
      context.html.includes('recaptcha') ||
      context.html.includes('security check')
    ))
  ) {
    return ERROR_TYPES.CAPTCHA;
  }
  
  // Blocking detection
  if (
    message.includes('blocked') ||
    message.includes('denied') ||
    message.includes('403') ||
    (context.statusCode && context.statusCode === 403)
  ) {
    return ERROR_TYPES.BLOCKED;
  }
  
  // Access denied
  if (
    message.includes('access denied') ||
    message.includes('unauthorized') ||
    message.includes('401') ||
    (context.statusCode && context.statusCode === 401)
  ) {
    return ERROR_TYPES.ACCESS_DENIED;
  }
  
  // Rate limiting
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    (context.statusCode && context.statusCode === 429)
  ) {
    return ERROR_TYPES.RATE_LIMIT;
  }
  
  // Session expired
  if (
    message.includes('session') ||
    message.includes('expired') ||
    message.includes('invalid session')
  ) {
    return ERROR_TYPES.SESSION_EXPIRED;
  }
  
  // Data validation
  if (
    message.includes('validation') ||
    message.includes('invalid data') ||
    message.includes('schema')
  ) {
    return ERROR_TYPES.DATA_VALIDATION;
  }
  
  // Browser errors
  if (
    message.includes('browser') ||
    message.includes('chromium') ||
    message.includes('webkit') ||
    message.includes('firefox') ||
    message.includes('playwright')
  ) {
    return ERROR_TYPES.BROWSER;
  }
  
  // Proxy errors
  if (
    message.includes('proxy') ||
    message.includes('socks')
  ) {
    return ERROR_TYPES.PROXY;
  }
  
  // Default to unknown
  return ERROR_TYPES.UNKNOWN;
}

/**
 * Determines the retry strategy based on error type
 * @param {String} errorType - The classified error type
 * @param {Number} attempt - Current retry attempt (1-based)
 * @param {Object} options - Additional options
 * @returns {Object} - Retry strategy with delay and whether to retry
 */
function getRetryStrategy(errorType, attempt = 1, options = {}) {
  const maxRetries = options.maxRetries || config.scraping.maxRetries || 3;
  
  // Base strategy
  const strategy = {
    shouldRetry: attempt <= maxRetries,
    delay: 1000 * Math.pow(2, attempt), // Exponential backoff
    errorType,
    errorSeverity: 'normal',
    fallbackMethod: null
  };
  
  // Adjust strategy based on error type
  switch (errorType) {
    case ERROR_TYPES.NETWORK:
      strategy.delay = 2000 * Math.pow(1.5, attempt);
      strategy.errorSeverity = 'moderate';
      break;
      
    case ERROR_TYPES.TIMEOUT:
      strategy.delay = 3000 * Math.pow(1.5, attempt);
      strategy.errorSeverity = 'moderate';
      strategy.fallbackMethod = 'simplify_request';
      break;
      
    case ERROR_TYPES.PARSE:
      strategy.delay = 1000;
      strategy.errorSeverity = 'high';
      strategy.fallbackMethod = 'alternative_parser';
      break;
      
    case ERROR_TYPES.CAPTCHA:
      strategy.delay = 5000 * Math.pow(2, attempt);
      strategy.errorSeverity = 'critical';
      strategy.fallbackMethod = 'captcha_solving';
      strategy.shouldRotateProxy = true;
      break;
      
    case ERROR_TYPES.BLOCKED:
      strategy.delay = 10000 * Math.pow(2, attempt);
      strategy.errorSeverity = 'critical';
      strategy.fallbackMethod = 'stealth_mode';
      strategy.shouldRotateProxy = true;
      strategy.shouldRotateBrowser = true;
      break;
      
    case ERROR_TYPES.RATE_LIMIT:
      strategy.delay = 30000 * Math.pow(2, Math.min(attempt, 3));
      strategy.errorSeverity = 'high';
      strategy.shouldRotateProxy = true;
      break;
      
    case ERROR_TYPES.SESSION_EXPIRED:
      strategy.delay = 1000;
      strategy.errorSeverity = 'moderate';
      strategy.fallbackMethod = 'session_renewal';
      break;
      
    case ERROR_TYPES.DATA_VALIDATION:
      strategy.delay = 500;
      strategy.errorSeverity = 'low';
      strategy.shouldRetry = attempt <= 1; // Only retry once for validation errors
      break;
      
    case ERROR_TYPES.BROWSER:
      strategy.delay = 2000;
      strategy.errorSeverity = 'high';
      strategy.shouldRetry = attempt <= 2;
      strategy.shouldRotateBrowser = true;
      break;
      
    case ERROR_TYPES.PROXY:
      strategy.delay = 1000;
      strategy.errorSeverity = 'moderate';
      strategy.shouldRotateProxy = true;
      break;
      
    case ERROR_TYPES.UNKNOWN:
    default:
      strategy.delay = 3000 * Math.pow(2, attempt);
      strategy.errorSeverity = 'unknown';
      break;
  }
  
  // Respect the max retry constraint
  strategy.shouldRetry = strategy.shouldRetry && attempt <= maxRetries;
  
  // Apply jitter to prevent thundering herd
  strategy.delay = applyJitter(strategy.delay);
  
  return strategy;
}

/**
 * Apply jitter to delay time to prevent synchronized retries
 * @param {Number} delay - Base delay in ms
 * @param {Number} jitterFactor - Jitter factor (0-1)
 * @returns {Number} - Delay with jitter applied
 */
function applyJitter(delay, jitterFactor = 0.2) {
  const jitter = delay * jitterFactor;
  return delay - jitter + (Math.random() * jitter * 2);
}

/**
 * Tracks error rates to implement strategic backpressure
 */
class ErrorRateTracker {
  constructor(options = {}) {
    this.windowSize = options.windowSize || 60000; // Default 60 second window
    this.errorThreshold = options.errorThreshold || 0.3; // 30% error rate threshold
    this.errors = [];
    this.requests = [];
    this.backpressureLevel = 0; // 0 = normal, higher = more backpressure
    this.maxBackpressureLevel = options.maxBackpressureLevel || 5;
  }
  
  /**
   * Record a request attempt
   * @param {Boolean} isError - Whether the request resulted in an error
   */
  recordRequest(isError = false) {
    const now = Date.now();
    
    // Clean old records
    this._cleanOldRecords(now);
    
    // Add new record
    if (isError) {
      this.errors.push(now);
    }
    this.requests.push(now);
    
    // Recalculate backpressure
    this._updateBackpressure();
  }
  
  /**
   * Clean records outside the window
   * @param {Number} now - Current timestamp
   */
  _cleanOldRecords(now) {
    const cutoff = now - this.windowSize;
    this.errors = this.errors.filter(time => time >= cutoff);
    this.requests = this.requests.filter(time => time >= cutoff);
  }
  
  /**
   * Update backpressure level based on error rate
   */
  _updateBackpressure() {
    if (this.requests.length === 0) {
      this.backpressureLevel = 0;
      return;
    }
    
    const errorRate = this.errors.length / this.requests.length;
    
    // Adjust backpressure level
    if (errorRate > this.errorThreshold) {
      // Increase backpressure (slow down) when error rate is high
      this.backpressureLevel = Math.min(
        this.backpressureLevel + 1,
        this.maxBackpressureLevel
      );
    } else if (errorRate < this.errorThreshold / 2) {
      // Decrease backpressure (speed up) when error rate is low
      this.backpressureLevel = Math.max(this.backpressureLevel - 1, 0);
    }
  }
  
  /**
   * Get the current error rate
   * @returns {Number} - Error rate (0-1)
   */
  getErrorRate() {
    this._cleanOldRecords(Date.now());
    if (this.requests.length === 0) return 0;
    return this.errors.length / this.requests.length;
  }
  
  /**
   * Get additional delay time based on backpressure
   * @returns {Number} - Additional delay in ms
   */
  getBackpressureDelay() {
    if (this.backpressureLevel === 0) return 0;
    
    // Exponential backoff based on backpressure level
    return 1000 * Math.pow(2, this.backpressureLevel - 1);
  }
  
  /**
   * Get current backpressure stats
   * @returns {Object} - Backpressure statistics
   */
  getStats() {
    return {
      errorRate: this.getErrorRate(),
      backpressureLevel: this.backpressureLevel,
      errorCount: this.errors.length,
      requestCount: this.requests.length,
      additionalDelay: this.getBackpressureDelay()
    };
  }
}

// Create global error tracker instance
const globalErrorTracker = new ErrorRateTracker();

/**
 * Session state manager for session resurrection
 */
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.maxSessions = config.scraping.maxSavedSessions || 100;
  }
  
  /**
   * Save session state
   * @param {String} sessionId - Unique ID for the session
   * @param {Object} state - Session state to save
   */
  saveSession(sessionId, state) {
    // Trim sessions if over limit
    if (this.sessions.size >= this.maxSessions) {
      // Remove oldest session
      const oldestKey = this.sessions.keys().next().value;
      this.sessions.delete(oldestKey);
    }
    
    // Add timestamp to session data
    this.sessions.set(sessionId, {
      ...state,
      savedAt: Date.now()
    });
  }
  
  /**
   * Get saved session state
   * @param {String} sessionId - Unique ID for the session
   * @returns {Object|null} - Session state or null if not found
   */
  getSession(sessionId) {
    return this.sessions.has(sessionId) ? this.sessions.get(sessionId) : null;
  }
  
  /**
   * Check if session exists
   * @param {String} sessionId - Unique ID for the session
   * @returns {Boolean} - Whether session exists
   */
  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }
  
  /**
   * Delete a session
   * @param {String} sessionId - Unique ID for the session
   */
  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
  }
  
  /**
   * Clear expired sessions
   * @param {Number} maxAge - Maximum age in ms
   */
  clearExpiredSessions(maxAge = 3600000) { // Default 1 hour
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.savedAt > maxAge) {
        this.sessions.delete(sessionId);
      }
    }
  }
  
  /**
   * Get session statistics
   * @returns {Object} - Session statistics
   */
  getStats() {
    return {
      totalSessions: this.sessions.size,
      maxSessions: this.maxSessions
    };
  }
}

// Create global session manager instance
const sessionManager = new SessionManager();

module.exports = {
  ERROR_TYPES,
  classifyError,
  getRetryStrategy,
  ErrorRateTracker,
  globalErrorTracker,
  SessionManager,
  sessionManager,
  applyJitter
}; 