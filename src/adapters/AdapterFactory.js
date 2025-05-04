/**
 * Adapter Factory
 * Manages adapter instances and provides the correct adapter for a given URL
 */
const logger = require('../utils/logger');
const ViaVarejoAdapter = require('./ViaVarejoAdapter');
const MagazineLuizaAdapter = require('./MagazineLuizaAdapter');
const AmazonAdapter = require('./AmazonAdapter');
const MercadoLivreAdapter = require('./MercadoLivreAdapter');
const AmericanasAdapter = require('./AmericanasAdapter');
const GenericAdapter = require('./GenericAdapter');
// Import other adapters as they are created
// const KabumAdapter = require('./KabumAdapter');
// const CarrefourAdapter = require('./CarrefourAdapter');
// const FastshopAdapter = require('./FastshopAdapter');

/**
 * Factory that manages and provides the appropriate adapter for a given URL
 */
class AdapterFactory {
  constructor() {
    // Initialize adapter instances
    this.adapters = [
      new ViaVarejoAdapter(),
      new MagazineLuizaAdapter(),
      new AmazonAdapter(),
      new MercadoLivreAdapter(),
      new AmericanasAdapter(),
      // Add more adapters as they are implemented
      // new KabumAdapter(),
      // new CarrefourAdapter(),
      // new FastshopAdapter(),
    ];
    
    // Add the generic adapter as a fallback
    // This should always be the last adapter in the list
    this.genericAdapter = new GenericAdapter();
    
    // Usage metrics for monitoring and optimization
    this.metrics = {
      totalQueries: 0,
      adapterHits: {},
      genericAdapterHits: 0,
      noAdapterHits: 0,
      domains: new Set()
    };
    
    logger.info(`Adapter factory initialized with ${this.adapters.length} specialized adapters plus generic fallback`);
  }

  /**
   * Get the appropriate adapter for a URL
   * @param {string} url - The URL to find an adapter for
   * @returns {object|null} - The adapter instance or null if no adapter found
   */
  getAdapter(url) {
    if (!url) return null;
    
    try {
      // Extract domain from URL for metrics and improved matching
      let domain = null;
      try {
        const urlObj = new URL(url);
        domain = urlObj.hostname;
        this.metrics.domains.add(domain);
      } catch (e) {
        // If URL is invalid, try as-is
      }
      
      // Increment total queries metric
      this.metrics.totalQueries++;
      
      // Find the first adapter that can handle this URL
      for (let i = 0; i < this.adapters.length; i++) {
        const adapter = this.adapters[i];
        if (adapter.canHandle(url)) {
          // Update metrics
          const adapterName = adapter.constructor.name;
          this.metrics.adapterHits[adapterName] = (this.metrics.adapterHits[adapterName] || 0) + 1;
          
          logger.debug(`Found specialized adapter for URL: ${url}`, {
            adapter: adapterName,
            domain
          });
          return adapter;
        }
      }
      
      // If no specialized adapter is found, try the generic adapter
      if (this.genericAdapter.canHandle(url)) {
        // Update metrics
        this.metrics.genericAdapterHits++;
        
        logger.debug(`Using generic adapter for URL: ${url}`, { domain });
        return this.genericAdapter;
      }
      
      // Update metrics for no adapter found
      this.metrics.noAdapterHits++;
      
      logger.warn(`No adapter found for URL: ${url}`, { domain });
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
    return [...this.adapters, this.genericAdapter];
  }

  /**
   * Create and register a new adapter
   * @param {Function} AdapterClass - The adapter class to instantiate
   * @returns {object} - The created adapter instance
   */
  registerAdapter(AdapterClass) {
    try {
      const adapter = new AdapterClass();
      // Add before the generic adapter
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
    return this.adapters.some(adapter => adapter.canHandle(url)) || 
           this.genericAdapter.canHandle(url);
  }

  /**
   * Get information about all registered adapters
   * @returns {Array<Object>} - Array of adapter information objects
   */
  getAdapterInfo() {
    const adapters = [...this.adapters, this.genericAdapter];
    return adapters.map(adapter => ({
      name: adapter.constructor.name,
      domainName: adapter.domainName,
      domains: adapter.domains || [],
      isGeneric: adapter === this.genericAdapter
    }));
  }

  /**
   * Get adapter selection metrics
   * @returns {Object} - Metrics data
   */
  getMetrics() {
    return {
      ...this.metrics,
      domainsCount: this.metrics.domains.size,
      domains: Array.from(this.metrics.domains),
      adapterDistribution: {
        specialized: Object.entries(this.metrics.adapterHits).map(([name, count]) => ({
          name,
          count,
          percentage: this.metrics.totalQueries ? 
            Math.round((count / this.metrics.totalQueries) * 100) : 0
        })),
        generic: {
          count: this.metrics.genericAdapterHits,
          percentage: this.metrics.totalQueries ? 
            Math.round((this.metrics.genericAdapterHits / this.metrics.totalQueries) * 100) : 0
        },
        noAdapter: {
          count: this.metrics.noAdapterHits,
          percentage: this.metrics.totalQueries ? 
            Math.round((this.metrics.noAdapterHits / this.metrics.totalQueries) * 100) : 0
        }
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalQueries: 0,
      adapterHits: {},
      genericAdapterHits: 0,
      noAdapterHits: 0,
      domains: new Set()
    };
  }
}

// Export singleton instance
module.exports = new AdapterFactory(); 