/**
 * Adapter Factory
 * Manages adapter instances and provides the correct adapter for a given URL
 */
const logger = require('../utils/logger');
const ViaVarejoAdapter = require('./ViaVarejoAdapter');
// Import other adapters as they are created
// const MagazineLuizaAdapter = require('./MagazineLuizaAdapter');
// const MercadoLivreAdapter = require('./MercadoLivreAdapter');

/**
 * Factory that manages and provides the appropriate adapter for a given URL
 */
class AdapterFactory {
  constructor() {
    // Initialize adapter instances
    this.adapters = [
      new ViaVarejoAdapter(),
      // Add more adapters as they are implemented
      // new MagazineLuizaAdapter(),
      // new MercadoLivreAdapter(),
    ];
    
    logger.info(`Adapter factory initialized with ${this.adapters.length} adapters`);
  }

  /**
   * Get the appropriate adapter for a URL
   * @param {string} url - The URL to find an adapter for
   * @returns {object|null} - The adapter instance or null if no adapter found
   */
  getAdapter(url) {
    if (!url) return null;
    
    try {
      // Find the first adapter that can handle this URL
      const adapter = this.adapters.find(adapter => adapter.canHandle(url));
      
      if (adapter) {
        logger.debug(`Found adapter for URL: ${url}`, { 
          adapter: adapter.constructor.name 
        });
        return adapter;
      }
      
      logger.warn(`No adapter found for URL: ${url}`);
      return null;
    } catch (error) {
      logger.error(`Error finding adapter for URL: ${url}`, {}, error);
      return null;
    }
  }

  /**
   * Get all available adapters
   * @returns {Array} - Array of all adapter instances
   */
  getAllAdapters() {
    return [...this.adapters];
  }

  /**
   * Create and register a new adapter
   * @param {Function} AdapterClass - The adapter class to instantiate
   * @returns {object} - The created adapter instance
   */
  registerAdapter(AdapterClass) {
    try {
      const adapter = new AdapterClass();
      this.adapters.push(adapter);
      
      logger.info(`Registered new adapter: ${adapter.constructor.name}`);
      return adapter;
    } catch (error) {
      logger.error(`Failed to register adapter: ${AdapterClass.name}`, {}, error);
      throw error;
    }
  }

  /**
   * Check if any adapter can handle the given URL
   * @param {string} url - URL to check
   * @returns {boolean} - True if any adapter can handle the URL
   */
  canHandleUrl(url) {
    return this.adapters.some(adapter => adapter.canHandle(url));
  }

  /**
   * Get information about all registered adapters
   * @returns {Array<Object>} - Array of adapter information objects
   */
  getAdapterInfo() {
    return this.adapters.map(adapter => ({
      name: adapter.constructor.name,
      domainName: adapter.domainName,
      domains: adapter.domains || []
    }));
  }
}

// Export singleton instance
module.exports = new AdapterFactory(); 