/**
 * Retry Service
 * Provides advanced retry logic with integration of all other services 
 */
const logger = require('../../utils/logger');
const { sleep, calculateBackoffDelay } = require('../../utils/shared');
const errorClassificationService = require('../error/errorClassificationService');
const circuitBreakerService = require('../circuitBreaker/circuitBreakerService');
const captchaService = require('../captcha/captchaService');
const proxyRotationService = require('../proxy/proxyRotationService');

class RetryService {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || 3,
      baseDelay: options.baseDelay || 1000,
      backoffFactor: options.backoffFactor || 1.5,
      useCircuitBreaker: options.useCircuitBreaker !== false,
      useErrorClassification: options.useErrorClassification !== false,
      useCaptchaSolving: options.useCaptchaSolving !== false,
      useProxyRotation: options.useProxyRotation !== false,
      maxDuration: options.maxDuration || 5 * 60 * 1000, // 5 minutes max
      ...options
    };
  }
  
  /**
   * Execute a function with retry logic
   * @param {Function} fn - Function to execute
   * @param {Object} options - Retry options
   * @returns {Promise<any>} - Result of the function
   */
  async withRetry(fn, options = {}) {
    const {
      maxRetries = this.options.maxRetries,
      context = {},
      initialState = {}
    } = options;
    
    // Start time for max duration tracking
    const startTime = Date.now();
    
    // Tracks the state between retries
    let state = {
      ...initialState,
      retryCount: 0
    };
    
    // Check circuit breaker if enabled and URL is present
    if (this.options.useCircuitBreaker && context.url) {
      if (!circuitBreakerService.isRequestAllowed(context.url)) {
        const error = new Error(`Circuit breaker open for ${context.url}`);
        error.type = errorClassificationService.ERROR_TYPES.CIRCUIT_OPEN;
        throw error;
      }
    }
    
    while (true) {
      try {
        // Execute function with current state
        const result = await fn(state);
        
        // Record success with circuit breaker if URL is present
        if (this.options.useCircuitBreaker && context.url) {
          circuitBreakerService.recordSuccess(context.url);
        }
        
        // If using proxy rotation, record proxy success
        if (this.options.useProxyRotation && context.proxyId) {
          proxyRotationService.recordSuccess(context.proxyId);
        }
        
        // Return successful result
        return result;
      } catch (error) {
        // Max duration check
        if (Date.now() - startTime > this.options.maxDuration) {
          logger.warn('Retry operation exceeded maximum duration', {
            url: context.url,
            duration: Date.now() - startTime,
            maxDuration: this.options.maxDuration
          });
          throw error;
        }
        
        // Classify error if error classification is enabled
        let classifiedError = error;
        if (this.options.useErrorClassification) {
          classifiedError = errorClassificationService.classifyError(error, context);
        }
        
        // Record failure with circuit breaker if URL is present
        if (this.options.useCircuitBreaker && context.url) {
          circuitBreakerService.recordFailure(context.url);
        }
        
        // If using proxy rotation, record proxy failure
        if (this.options.useProxyRotation && context.proxyId) {
          proxyRotationService.recordFailure(context.proxyId, { 
            reason: classifiedError.message || error.message,
            errorType: classifiedError.type
          });
        }
        
        // Check if we should retry
        state.retryCount++;
        if (state.retryCount > maxRetries) {
          logger.warn('Max retries exceeded', { 
            url: context.url,
            retries: state.retryCount - 1, 
            errorType: classifiedError.type || 'unknown'
          });
          throw classifiedError;
        }
        
        // Get retry context from classified error or use simple backoff
        if (this.options.useErrorClassification) {
          const retryContext = errorClassificationService.createRetryContext(
            classifiedError, 
            state.retryCount,
            state
          );
          
          // Update state with retry context
          state = {
            ...state,
            ...retryContext
          };
        } else {
          // Use simple exponential backoff if error classification not enabled
          state.delay = calculateBackoffDelay(
            this.options.baseDelay, 
            state.retryCount,
            this.options.backoffFactor
          );
        }
        
        // Handle proxy rotation
        if (this.options.useProxyRotation && state.rotateProxy && context.url) {
          logger.info('Rotating proxy for next attempt', {
            url: context.url,
            attempt: state.retryCount
          });
          
          if (state.disableProxy && context.proxyId) {
            proxyRotationService.markProxyBanned(context.proxyId, 'Marked as banned during retry');
          }
          
          // Request a new proxy for next attempt
          context.rotateProxy = true;
        }
        
        // Handle captcha solving
        if (this.options.useCaptchaSolving && state.solveCaptcha) {
          await this._handleCaptcha(state, context);
        }
        
        // Log retry attempt
        logger.info('Retrying operation', { 
          url: context.url,
          attempt: state.retryCount, 
          maxRetries,
          delay: state.delay,
          errorType: classifiedError.type || 'unknown',
          errorMessage: error.message
        });
        
        // Delay before retry
        await sleep(state.delay);
      }
    }
  }
  
  /**
   * Handle captcha solving as part of retry strategy
   * @param {Object} state - Current retry state
   * @param {Object} context - Retry context
   * @private
   */
  async _handleCaptcha(state, context) {
    try {
      // Check if we have captcha info
      if (!context.captchaInfo) {
        logger.debug('No captcha info available for solving');
        return;
      }
      
      const { type, sitekey, url, imageUrl } = context.captchaInfo;
      
      logger.info('Attempting to solve captcha', { type, url });
      
      let solution;
      
      if (type === 'recaptcha' && sitekey) {
        // Try to get a harvested token first
        solution = captchaService.getHarvestedToken(url);
        
        if (!solution) {
          // Solve reCAPTCHA
          solution = await captchaService.solveRecaptchaV2({
            sitekey,
            url
          });
        }
      } else if (type === 'image' && imageUrl) {
        // Solve image captcha
        solution = await captchaService.solveImageCaptcha(imageUrl);
      } else {
        logger.warn('Unsupported captcha type for automatic solving', { type });
        return;
      }
      
      if (solution) {
        // Add solution to state for next retry
        state.captchaSolution = solution;
        logger.info('Captcha solved successfully');
      }
    } catch (error) {
      logger.warn('Failed to solve captcha', {}, error);
    }
  }
  
  /**
   * Execute a function with integrated circuit breaker protection
   * @param {string} url - URL being accessed
   * @param {Function} fn - Function to execute
   * @param {Object} options - Additional options
   * @returns {Promise<any>} - Result of the function
   */
  async executeWithCircuitBreaker(url, fn, options = {}) {
    if (!url) {
      return fn();
    }
    
    return circuitBreakerService.executeWithCircuitBreaker(url, fn);
  }
  
  /**
   * Create a retriable version of a function
   * @param {Function} fn - Function to make retriable
   * @param {Object} options - Retry options
   * @returns {Function} - Wrapped function with retry capability
   */
  createRetriableFunction(fn, options = {}) {
    return async (...args) => {
      return this.withRetry(
        () => fn(...args), 
        options
      );
    };
  }
}

// Export a singleton instance
const retryService = new RetryService();
module.exports = retryService; 