/**
 * Cache Service
 * Provides caching functionality with TTL support
 */
const NodeCache = require('node-cache');
const logger = require('../../utils/logger');
const config = require('../../config');

class CacheService {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttl,
      checkperiod: Math.min(config.cache.ttl / 3, 600) // Check expiration every n seconds (max 10 min)
    });
    
    this.enabled = config.cache.enabled;
    
    // Set up stats tracking
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
    
    logger.info('Cache service initialized', {
      ttl: config.cache.ttl,
      enabled: this.enabled
    });
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {any|null} - Cached value or null if not found
   */
  get(key) {
    if (!this.enabled || !key) return null;
    
    try {
      const value = this.cache.get(key);
      
      if (value !== undefined) {
        this.stats.hits++;
        return value;
      }
      
      this.stats.misses++;
      return null;
    } catch (error) {
      logger.warn('Error retrieving from cache', { key }, error);
      return null;
    }
  }

  /**
   * Set a value in cache with optional TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} [ttl] - Time to live in seconds (overrides default)
   * @returns {boolean} - Success or failure
   */
  set(key, value, ttl) {
    if (!this.enabled || !key) return false;
    
    try {
      const success = this.cache.set(key, value, ttl);
      
      if (success) {
        this.stats.sets++;
      }
      
      return success;
    } catch (error) {
      logger.warn('Error storing in cache', { key }, error);
      return false;
    }
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   * @returns {boolean} - Success or failure
   */
  delete(key) {
    if (!this.enabled || !key) return false;
    
    try {
      const success = this.cache.del(key);
      
      if (success) {
        this.stats.deletes++;
      }
      
      return success;
    } catch (error) {
      logger.warn('Error deleting from cache', { key }, error);
      return false;
    }
  }

  /**
   * Check if a key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean} - True if key exists
   */
  has(key) {
    if (!this.enabled || !key) return false;
    return this.cache.has(key);
  }

  /**
   * Get all cached keys
   * @returns {string[]} - Array of cached keys
   */
  keys() {
    if (!this.enabled) return [];
    return this.cache.keys();
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getStats() {
    const cacheStats = this.cache.getStats();
    
    return {
      ...this.stats,
      keys: this.cache.keys().length,
      vsize: cacheStats.vsize,
      ksize: cacheStats.ksize,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses || 1)
    };
  }

  /**
   * Flush all cached items
   */
  flush() {
    if (!this.enabled) return;
    
    this.cache.flushAll();
    logger.info('Cache flushed');
  }

  /**
   * Create a namespaced cache key
   * @param {string} namespace - Key namespace
   * @param {string} identifier - Key identifier
   * @returns {string} - Combined cache key
   */
  createKey(namespace, identifier) {
    if (!namespace || !identifier) {
      return null;
    }
    
    // Remove non-alphanumeric characters from identifier
    const safeIdentifier = String(identifier).replace(/[^a-zA-Z0-9]/g, '');
    
    return `${namespace}:${safeIdentifier}`;
  }
}

// Export singleton
module.exports = new CacheService(); 