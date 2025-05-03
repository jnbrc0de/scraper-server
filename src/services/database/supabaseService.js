/**
 * Supabase Database Service
 * Manages interactions with Supabase database
 */
const { createClient } = require('@supabase/supabase-js');
const logger = require('../../utils/logger');
const config = require('../../config');

class SupabaseService {
  constructor() {
    this.client = null;
    this.initialized = false;
    
    // Initialize client if credentials are available
    if (config.database.supabaseUrl && config.database.supabaseAnonKey) {
      this.initialize();
    } else {
      logger.warn('Supabase credentials not found, database service disabled');
    }
  }

  /**
   * Initialize the Supabase client
   * @returns {boolean} - Success or failure
   */
  initialize() {
    try {
      this.client = createClient(
        config.database.supabaseUrl,
        config.database.supabaseAnonKey
      );
      
      this.initialized = true;
      logger.info('Supabase client initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Supabase client', {}, error);
      return false;
    }
  }

  /**
   * Check if service is initialized
   * @returns {boolean} - Whether service is initialized
   */
  isInitialized() {
    return this.initialized && !!this.client;
  }

  /**
   * Insert or update a scraping cache entry
   * @param {Object} data - Cache data to store
   * @param {string} data.url - URL of the scraped page
   * @param {number} data.price - Extracted price
   * @param {boolean} data.cached - Whether this is from cache
   * @param {string} [data.title] - Product title if available
   * @returns {Promise<Object|null>} - Inserted/updated data or null on failure
   */
  async upsertScrapeCache(data) {
    if (!this.isInitialized()) {
      logger.warn('Supabase client not initialized, cannot store cache');
      return null;
    }
    
    try {
      // Add timestamp if not provided
      if (!data.scraped_at) {
        data.scraped_at = new Date().toISOString();
      }
      
      const { data: result, error } = await this.client
        .from('scrape_cache')
        .upsert({
          url: data.url,
          price: data.price,
          cached: data.cached,
          title: data.title || null,
          scraped_at: data.scraped_at
        }, { onConflict: 'url' })
        .select('price, cached, scraped_at');
      
      if (error) {
        throw error;
      }
      
      return result[0] || null;
    } catch (error) {
      logger.error('Error upserting scrape cache', { url: data.url }, error);
      return null;
    }
  }

  /**
   * Get cached scrape data by URL
   * @param {string} url - URL to get cache for
   * @param {number} [maxAge=3600] - Maximum age in seconds
   * @returns {Promise<Object|null>} - Cached data or null if not found/expired
   */
  async getCachedScrape(url, maxAge = config.cache.ttl) {
    if (!this.isInitialized()) {
      logger.warn('Supabase client not initialized, cannot get cache');
      return null;
    }
    
    try {
      // Calculate minimum timestamp based on maxAge
      const minTimestamp = new Date(Date.now() - (maxAge * 1000)).toISOString();
      
      const { data, error } = await this.client
        .from('scrape_cache')
        .select('*')
        .eq('url', url)
        .gte('scraped_at', minTimestamp)
        .order('scraped_at', { ascending: false })
        .limit(1);
      
      if (error) {
        throw error;
      }
      
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      logger.error('Error getting cached scrape', { url }, error);
      return null;
    }
  }

  /**
   * Log a scraper error report
   * @param {Object} reportData - Error report data
   * @param {string} reportData.url - URL that failed
   * @param {string} reportData.error - Error message
   * @param {string} [reportData.proxyUsed] - Proxy that was used (if any)
   * @returns {Promise<boolean>} - Success or failure
   */
  async logScraperError(reportData) {
    if (!this.isInitialized()) {
      logger.warn('Supabase client not initialized, cannot log error');
      return false;
    }
    
    try {
      const { error } = await this.client
        .from('scraping_reports')
        .insert({
          url: reportData.url,
          success: false,
          error: reportData.error,
          proxy_used: reportData.proxyUsed || null,
          scraped_at: new Date().toISOString()
        });
      
      if (error) {
        throw error;
      }
      
      return true;
    } catch (error) {
      logger.error('Error logging scraper error report', { url: reportData.url }, error);
      return false;
    }
  }

  /**
   * Log a successful scrape
   * @param {Object} reportData - Success report data
   * @param {string} reportData.url - URL that was scraped
   * @param {number} reportData.price - Extracted price
   * @param {number} reportData.durationMs - Time taken to scrape
   * @param {string} [reportData.proxyUsed] - Proxy that was used (if any)
   * @returns {Promise<boolean>} - Success or failure
   */
  async logScraperSuccess(reportData) {
    if (!this.isInitialized()) {
      logger.warn('Supabase client not initialized, cannot log success');
      return false;
    }
    
    try {
      const { error } = await this.client
        .from('scraping_reports')
        .insert({
          url: reportData.url,
          success: true,
          price: reportData.price,
          duration_ms: reportData.durationMs,
          proxy_used: reportData.proxyUsed || null,
          scraped_at: new Date().toISOString()
        });
      
      if (error) {
        throw error;
      }
      
      return true;
    } catch (error) {
      logger.error('Error logging scraper success report', { url: reportData.url }, error);
      return false;
    }
  }

  /**
   * Get Supabase client for direct operations
   * @returns {Object|null} - Supabase client or null if not initialized
   */
  getClient() {
    return this.isInitialized() ? this.client : null;
  }
}

// Export singleton instance
module.exports = new SupabaseService(); 