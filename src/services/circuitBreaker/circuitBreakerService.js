/**
 * Circuit Breaker Service
 * Implements the circuit breaker pattern to prevent repeated requests to failing domains
 */
const logger = require('../../utils/logger');
const { extractDomain } = require('../../utils/shared');

// Circuit breaker states
const STATES = {
  CLOSED: 'CLOSED',     // Normal operation, requests allowed
  OPEN: 'OPEN',         // Circuit is open, requests are blocked
  HALF_OPEN: 'HALF_OPEN' // Testing if the service is back, allowing limited requests
};

class CircuitBreaker {
  constructor(options) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.halfOpenMaxRequests = options.halfOpenMaxRequests || 3;
    
    this.state = STATES.CLOSED;
    this.failures = 0;
    this.halfOpenRequests = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    
    // Circuit specific metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      lastOpenTime: null,
      totalOpenTime: 0,
      openCount: 0
    };
  }
  
  /**
   * Record a successful request
   */
  recordSuccess() {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    
    if (this.state === STATES.HALF_OPEN) {
      this.halfOpenRequests++;
      
      // If we've had enough successful requests in half-open state, close the circuit
      if (this.halfOpenRequests >= this.halfOpenMaxRequests) {
        this._closeCircuit();
      }
    }
    
    // Reset failures in closed state
    if (this.state === STATES.CLOSED) {
      this.failures = 0;
    }
  }
  
  /**
   * Record a failed request
   */
  recordFailure() {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
    
    this.lastFailureTime = Date.now();
    this.failures++;
    
    // If in half-open state, any failure immediately opens the circuit again
    if (this.state === STATES.HALF_OPEN) {
      this._openCircuit();
      return;
    }
    
    // Check if we need to open the circuit
    if (this.state === STATES.CLOSED && this.failures >= this.failureThreshold) {
      this._openCircuit();
    }
  }
  
  /**
   * Check if the circuit allows a request
   * @returns {boolean} - Whether the request is allowed
   */
  isAllowed() {
    // If closed, always allow
    if (this.state === STATES.CLOSED) {
      return true;
    }
    
    // If open, check if we should transition to half-open
    if (this.state === STATES.OPEN) {
      if (Date.now() >= this.nextAttemptTime) {
        this._halfOpenCircuit();
      } else {
        this.metrics.rejectedRequests++;
        return false;
      }
    }
    
    // If half-open, only allow limited requests
    if (this.state === STATES.HALF_OPEN) {
      if (this.halfOpenRequests < this.halfOpenMaxRequests) {
        return true;
      } else {
        this.metrics.rejectedRequests++;
        return false;
      }
    }
    
    return false;
  }
  
  /**
   * Open the circuit
   * @private
   */
  _openCircuit() {
    logger.info(`Opening circuit for ${this.name}`, { 
      failures: this.failures,
      resetTimeout: this.resetTimeout
    });
    
    this.state = STATES.OPEN;
    this.nextAttemptTime = Date.now() + this.resetTimeout;
    this.metrics.lastOpenTime = Date.now();
    this.metrics.openCount++;
  }
  
  /**
   * Set circuit to half-open state
   * @private
   */
  _halfOpenCircuit() {
    logger.info(`Setting circuit to half-open for ${this.name}`);
    
    if (this.state === STATES.OPEN && this.metrics.lastOpenTime) {
      this.metrics.totalOpenTime += Date.now() - this.metrics.lastOpenTime;
    }
    
    this.state = STATES.HALF_OPEN;
    this.halfOpenRequests = 0;
  }
  
  /**
   * Close the circuit
   * @private
   */
  _closeCircuit() {
    logger.info(`Closing circuit for ${this.name}`);
    
    if (this.state === STATES.OPEN && this.metrics.lastOpenTime) {
      this.metrics.totalOpenTime += Date.now() - this.metrics.lastOpenTime;
    }
    
    this.state = STATES.CLOSED;
    this.failures = 0;
    this.halfOpenRequests = 0;
  }
  
  /**
   * Reset the circuit to closed state
   */
  reset() {
    logger.info(`Manually resetting circuit for ${this.name}`);
    this._closeCircuit();
  }
  
  /**
   * Get the current state of the circuit
   * @returns {Object} - Circuit state and metrics
   */
  getState() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      metrics: { ...this.metrics },
      nextAttemptTime: this.nextAttemptTime,
      halfOpenRequests: this.halfOpenRequests
    };
  }
}

class CircuitBreakerService {
  constructor(options = {}) {
    this.options = {
      defaultFailureThreshold: options.defaultFailureThreshold || 5,
      defaultResetTimeout: options.defaultResetTimeout || 60000, // 1 minute
      defaultHalfOpenMaxRequests: options.defaultHalfOpenMaxRequests || 3,
      ...options
    };
    
    // Map of domain to circuit breaker
    this.circuitBreakers = new Map();
    
    // Default circuit breaker configuration by domain
    this.domainConfigs = new Map();
  }
  
  /**
   * Configure a specific domain
   * @param {string} domain - Domain to configure
   * @param {Object} config - Circuit breaker config
   */
  configureDomain(domain, config) {
    if (!domain) {
      logger.warn('Attempted to configure circuit breaker for undefined domain');
      return;
    }
    
    this.domainConfigs.set(domain, {
      failureThreshold: config.failureThreshold || this.options.defaultFailureThreshold,
      resetTimeout: config.resetTimeout || this.options.defaultResetTimeout,
      halfOpenMaxRequests: config.halfOpenMaxRequests || this.options.defaultHalfOpenMaxRequests
    });
    
    // Update existing circuit breaker if it exists
    if (this.circuitBreakers.has(domain)) {
      const circuitBreaker = this.circuitBreakers.get(domain);
      circuitBreaker.failureThreshold = config.failureThreshold || circuitBreaker.failureThreshold;
      circuitBreaker.resetTimeout = config.resetTimeout || circuitBreaker.resetTimeout;
      circuitBreaker.halfOpenMaxRequests = config.halfOpenMaxRequests || circuitBreaker.halfOpenMaxRequests;
    }
  }
  
  /**
   * Get the circuit breaker for a URL
   * @param {string} url - URL to get circuit breaker for
   * @returns {CircuitBreaker} - Circuit breaker
   */
  getCircuitBreaker(url) {
    if (!url) {
      logger.warn('Attempted to get circuit breaker for undefined URL');
      return null;
    }
    
    const domain = extractDomain(url);
    
    if (!this.circuitBreakers.has(domain)) {
      // Get domain config if available
      const config = this.domainConfigs.get(domain) || {};
      
      this.circuitBreakers.set(domain, new CircuitBreaker({
        name: domain,
        failureThreshold: config.failureThreshold || this.options.defaultFailureThreshold,
        resetTimeout: config.resetTimeout || this.options.defaultResetTimeout,
        halfOpenMaxRequests: config.halfOpenMaxRequests || this.options.defaultHalfOpenMaxRequests
      }));
    }
    
    return this.circuitBreakers.get(domain);
  }
  
  /**
   * Check if a request to a URL is allowed
   * @param {string} url - URL to check
   * @returns {boolean} - Whether the request is allowed
   */
  isRequestAllowed(url) {
    if (!url) return true; // Allow if no URL provided
    
    const circuitBreaker = this.getCircuitBreaker(url);
    return circuitBreaker ? circuitBreaker.isAllowed() : true;
  }
  
  /**
   * Record a successful request
   * @param {string} url - URL of the successful request
   */
  recordSuccess(url) {
    if (!url) return;
    
    const circuitBreaker = this.getCircuitBreaker(url);
    if (circuitBreaker) {
      circuitBreaker.recordSuccess();
    }
  }
  
  /**
   * Record a failed request
   * @param {string} url - URL of the failed request
   */
  recordFailure(url) {
    if (!url) return;
    
    const circuitBreaker = this.getCircuitBreaker(url);
    if (circuitBreaker) {
      circuitBreaker.recordFailure();
    }
  }
  
  /**
   * Execute a function with circuit breaker protection
   * @param {string} url - URL being accessed
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} - Result of the function
   */
  async executeWithCircuitBreaker(url, fn) {
    if (!url) {
      // If no URL is provided, just execute the function without circuit breaker
      return fn();
    }
    
    const circuitBreaker = this.getCircuitBreaker(url);
    
    if (!circuitBreaker || circuitBreaker.isAllowed()) {
      try {
        const result = await fn();
        circuitBreaker && circuitBreaker.recordSuccess();
        return result;
      } catch (error) {
        circuitBreaker && circuitBreaker.recordFailure();
        throw error;
      }
    } else {
      const state = circuitBreaker.getState();
      const error = new Error(`Circuit breaker open for ${state.name}`);
      error.type = 'CIRCUIT_OPEN';
      error.circuitBreaker = state;
      throw error;
    }
  }
  
  /**
   * Reset a circuit breaker for a specific URL
   * @param {string} url - URL to reset circuit breaker for
   */
  resetCircuitBreaker(url) {
    if (!url) return;
    
    const domain = extractDomain(url);
    if (this.circuitBreakers.has(domain)) {
      this.circuitBreakers.get(domain).reset();
    }
  }
  
  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers() {
    for (const circuitBreaker of this.circuitBreakers.values()) {
      circuitBreaker.reset();
    }
  }
  
  /**
   * Get all circuit breakers and their states
   * @returns {Array<Object>} - Circuit breaker states
   */
  getAllCircuitBreakerStates() {
    return Array.from(this.circuitBreakers.values()).map(cb => cb.getState());
  }
}

// Export a singleton instance
const circuitBreakerService = new CircuitBreakerService();
module.exports = circuitBreakerService; 