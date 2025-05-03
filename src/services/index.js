/**
 * Service Registry
 * Central point for accessing all services with lazy loading
 */
const captchaService = require('./captcha/captchaService');
const circuitBreakerService = require('./circuitBreaker/circuitBreakerService');
const errorClassificationService = require('./error/errorClassificationService');
const proxyRotationService = require('./proxy/proxyRotationService');

// Re-export all services
module.exports = {
  captcha: captchaService,
  circuitBreaker: circuitBreakerService,
  errorClassification: errorClassificationService,
  proxyRotation: proxyRotationService,
  
  /**
   * Initialize all services
   * @returns {Promise<void>}
   */
  async initializeAll() {
    // Nothing special required for initialization
    // Services are initialized on import
    return Promise.resolve();
  },
  
  /**
   * Clean up all services
   * @returns {Promise<void>}
   */
  async cleanupAll() {
    try {
      // Clean up each service in parallel
      await Promise.all([
        captchaService.cleanup(),
        proxyRotationService.cleanup()
      ]);
    } catch (error) {
      console.error('Error during service cleanup:', error);
    }
  }
}; 