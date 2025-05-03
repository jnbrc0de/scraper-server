/**
 * Proxy Rotation Service
 * Manages proxy selection, rotation, and health monitoring
 */
const logger = require('../../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const { extractDomain, safeJsonParse, generateId, sleep } = require('../../utils/shared');

class ProxyRotationService {
  constructor(options = {}) {
    this.options = {
      proxyFile: options.proxyFile || process.env.PROXY_FILE || path.join(process.cwd(), 'proxies.json'),
      maxConsecutiveFailures: options.maxConsecutiveFailures || 3,
      healthCheckInterval: options.healthCheckInterval || 15 * 60 * 1000, // 15 minutes
      healthCheckTimeout: options.healthCheckTimeout || 10000, // 10 seconds
      healthCheckUrl: options.healthCheckUrl || 'https://httpbin.org/ip',
      rotationStrategy: options.rotationStrategy || 'performance', // 'random', 'sequential', 'performance'
      countryRotation: options.countryRotation || false, // Whether to rotate by country
      banDuration: options.banDuration || 30 * 60 * 1000, // 30 minutes
      ...options
    };
    
    // Proxies by category
    this.proxies = {
      active: [],     // Currently active proxies
      disabled: [],   // Temporarily disabled/banned proxies
      backup: []      // Backup proxies to use when active pool is depleted
    };
    
    // Proxy usage statistics
    this.proxyStats = new Map();
    
    // Domain to proxy assignments
    this.domainProxies = new Map();
    
    // Last used proxy by domain
    this.lastUsedProxies = new Map();
    
    // Cache for proxy agents to prevent recreating them repeatedly
    this.proxyAgentCache = new Map();
    
    // Initialize
    this._loadProxies();
    
    // Start health check interval
    this._startHealthChecks();
  }
  
  /**
   * Load proxies from configuration file
   * @private
   */
  async _loadProxies() {
    try {
      // Check if proxy file exists
      try {
        await fs.access(this.options.proxyFile);
      } catch (error) {
        // Create default proxy file if it doesn't exist
        await this._createDefaultProxyFile();
      }
      
      // Load proxy data
      const data = await fs.readFile(this.options.proxyFile, 'utf8');
      const proxyData = safeJsonParse(data, []);
      
      if (!Array.isArray(proxyData)) {
        throw new Error('Invalid proxy data: expected an array');
      }
      
      // Clear existing proxies
      this.proxies.active = [];
      this.proxies.disabled = [];
      this.proxies.backup = [];
      
      // Process proxies
      for (const proxy of proxyData) {
        this._addProxy(proxy);
      }
      
      logger.info('Loaded proxies', { 
        active: this.proxies.active.length,
        disabled: this.proxies.disabled.length,
        backup: this.proxies.backup.length
      });
    } catch (error) {
      logger.error('Failed to load proxies', {}, error);
    }
  }
  
  /**
   * Create default proxy file
   * @private
   */
  async _createDefaultProxyFile() {
    logger.info(`Creating default proxy file at ${this.options.proxyFile}`);
    
    // Default proxies (examples)
    const defaultProxies = [
      {
        url: "http://username:password@proxy1.example.com:8080",
        type: "http",
        country: "US",
        city: "New York",
        isp: "Example ISP",
        tags: ["shopping", "residential"],
        enabled: true
      },
      {
        url: "http://username:password@proxy2.example.com:8080",
        type: "http",
        country: "UK",
        city: "London",
        isp: "Example ISP 2",
        tags: ["social", "datacenter"],
        enabled: true
      },
      {
        url: "socks5://username:password@proxy3.example.com:1080",
        type: "socks5",
        country: "DE",
        city: "Berlin",
        isp: "Example ISP 3",
        tags: ["backup", "residential"],
        enabled: true
      }
    ];
    
    // Create directory if it doesn't exist
    const dir = path.dirname(this.options.proxyFile);
    await fs.mkdir(dir, { recursive: true });
    
    // Write default proxy file
    await fs.writeFile(
      this.options.proxyFile, 
      JSON.stringify(defaultProxies, null, 2),
      'utf8'
    );
  }
  
  /**
   * Add a proxy to the appropriate category
   * @param {Object} proxy - Proxy configuration
   * @private
   */
  _addProxy(proxy) {
    // Validate proxy
    if (!proxy.url) {
      logger.warn('Invalid proxy configuration: missing URL', { proxy });
      return;
    }
    
    // Add proxy Id if not present
    if (!proxy.id) {
      proxy.id = generateId();
    }
    
    // Set default statistics if not present
    if (!this.proxyStats.has(proxy.id)) {
      this.proxyStats.set(proxy.id, {
        id: proxy.id,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        consecutiveFailures: 0,
        lastUsed: null,
        lastTested: null,
        avgResponseTime: 0,
        banCount: 0,
        lastBanned: null,
        successRate: 1, // Start optimistic
        score: 1
      });
    }
    
    // Add to appropriate category
    if (proxy.enabled === false) {
      this.proxies.backup.push(proxy);
    } else if (proxy.disabled || proxy.banned) {
      this.proxies.disabled.push(proxy);
    } else {
      this.proxies.active.push(proxy);
    }
  }
  
  /**
   * Save current proxy configurations
   * @private
   */
  async _saveProxies() {
    try {
      // Combine all proxies
      const allProxies = [
        ...this.proxies.active,
        ...this.proxies.disabled,
        ...this.proxies.backup
      ];
      
      // Update proxy stats
      allProxies.forEach(proxy => {
        const stats = this.proxyStats.get(proxy.id);
        if (stats) {
          proxy.stats = {
            successRate: stats.successRate,
            lastUsed: stats.lastUsed,
            lastTested: stats.lastTested,
            banCount: stats.banCount
          };
        }
      });
      
      // Save to file
      await fs.writeFile(
        this.options.proxyFile, 
        JSON.stringify(allProxies, null, 2),
        'utf8'
      );
      
      logger.debug('Saved proxy configurations');
    } catch (error) {
      logger.error('Failed to save proxies', {}, error);
    }
  }
  
  /**
   * Start health check interval
   * @private
   */
  _startHealthChecks() {
    if (this.options.healthCheckInterval > 0) {
      this.healthCheckTimer = setInterval(() => {
        this._performHealthChecks().catch(error => {
          logger.error('Error performing proxy health checks', {}, error);
        });
      }, this.options.healthCheckInterval);
      
      // Run initial health check
      setImmediate(() => {
        this._performHealthChecks().catch(error => {
          logger.error('Error performing initial proxy health checks', {}, error);
        });
      });
    }
  }
  
  /**
   * Perform health checks on proxies
   * @private
   */
  async _performHealthChecks() {
    logger.info('Starting proxy health checks');
    
    const results = {
      checked: 0,
      passed: 0,
      failed: 0,
      activated: 0,
      disabled: 0
    };
    
    // Check active proxies first
    for (const proxy of this.proxies.active) {
      const result = await this._checkProxy(proxy);
      results.checked++;
      
      if (result.success) {
        results.passed++;
      } else {
        results.failed++;
        
        // Disable proxy if it failed health check
        this._disableProxy(proxy, 'Failed health check');
        results.disabled++;
      }
    }
    
    // Check a few disabled proxies to see if they can be reactivated
    const disabledToCheck = this.proxies.disabled
      .filter(proxy => {
        const stats = this.proxyStats.get(proxy.id);
        // Only check proxies that have been disabled for at least ban duration
        return stats && stats.lastBanned && 
               (Date.now() - stats.lastBanned) > this.options.banDuration;
      })
      .slice(0, 5); // Check max 5 disabled proxies
    
    for (const proxy of disabledToCheck) {
      const result = await this._checkProxy(proxy);
      results.checked++;
      
      if (result.success) {
        results.passed++;
        
        // Reactivate proxy
        this._enableProxy(proxy);
        results.activated++;
      } else {
        results.failed++;
      }
    }
    
    // Check a few backup proxies if active pool is low
    if (this.proxies.active.length < 5 && this.proxies.backup.length > 0) {
      const backupToCheck = this.proxies.backup.slice(0, 3); // Check max 3 backup proxies
      
      for (const proxy of backupToCheck) {
        const result = await this._checkProxy(proxy);
        results.checked++;
        
        if (result.success) {
          results.passed++;
          
          // Activate backup proxy
          this._enableProxy(proxy);
          results.activated++;
        } else {
          results.failed++;
        }
      }
    }
    
    logger.info('Proxy health checks completed', results);
    
    // Save proxy configurations
    await this._saveProxies();
  }
  
  /**
   * Check a single proxy
   * @param {Object} proxy - Proxy to check
   * @returns {Promise<Object>} - Check result
   * @private
   */
  async _checkProxy(proxy) {
    const stats = this.proxyStats.get(proxy.id);
    
    try {
      logger.debug(`Checking proxy ${proxy.id}`);
      
      const startTime = Date.now();
      const agent = this._createProxyAgent(proxy);
      
      const response = await axios.get(this.options.healthCheckUrl, {
        httpsAgent: agent,
        timeout: this.options.healthCheckTimeout,
        proxy: false // Use our custom agent
      });
      
      const responseTime = Date.now() - startTime;
      
      // Update stats
      if (stats) {
        stats.lastTested = Date.now();
        stats.avgResponseTime = stats.avgResponseTime === 0 ? 
          responseTime : (stats.avgResponseTime * 0.7) + (responseTime * 0.3);
        
        // Update score
        this._updateProxyScore(proxy.id);
      }
      
      logger.debug(`Proxy ${proxy.id} health check passed`, { responseTime });
      
      return {
        success: true,
        responseTime,
        data: response.data
      };
    } catch (error) {
      logger.warn(`Proxy ${proxy.id} health check failed`, {}, error);
      
      // Update stats
      if (stats) {
        stats.lastTested = Date.now();
        stats.consecutiveFailures++;
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Create a proxy agent for the given proxy
   * @param {Object} proxy - Proxy configuration
   * @returns {Object} - Proxy agent
   * @private
   */
  _createProxyAgent(proxy) {
    if (!proxy || !proxy.url) {
      logger.warn('Invalid proxy for agent creation');
      return null;
    }
    
    // Check cache first
    if (this.proxyAgentCache.has(proxy.id)) {
      return this.proxyAgentCache.get(proxy.id);
    }
    
    // Create new agent
    const agent = new HttpsProxyAgent(proxy.url);
    
    // Cache the agent
    this.proxyAgentCache.set(proxy.id, agent);
    
    return agent;
  }
  
  /**
   * Disable a proxy
   * @param {Object} proxy - Proxy to disable
   * @param {string} reason - Reason for disabling
   * @private
   */
  _disableProxy(proxy, reason) {
    if (!proxy || !proxy.id) {
      logger.warn('Attempted to disable invalid proxy');
      return;
    }
    
    logger.info(`Disabling proxy ${proxy.id}`, { reason });
    
    // Remove from agent cache
    this.proxyAgentCache.delete(proxy.id);
    
    // Mark proxy as disabled
    proxy.disabled = true;
    proxy.disabledReason = reason;
    
    // Update stats
    const stats = this.proxyStats.get(proxy.id);
    if (stats) {
      stats.lastBanned = Date.now();
      stats.banCount++;
    }
    
    // Move from active to disabled
    this.proxies.active = this.proxies.active.filter(p => p.id !== proxy.id);
    this.proxies.disabled.push(proxy);
  }
  
  /**
   * Enable a proxy
   * @param {Object} proxy - Proxy to enable
   * @private
   */
  _enableProxy(proxy) {
    if (!proxy || !proxy.id) {
      logger.warn('Attempted to enable invalid proxy');
      return;
    }
    
    logger.info(`Enabling proxy ${proxy.id}`);
    
    // Mark proxy as enabled
    proxy.disabled = false;
    proxy.disabledReason = null;
    
    // Reset consecutive failures
    const stats = this.proxyStats.get(proxy.id);
    if (stats) {
      stats.consecutiveFailures = 0;
    }
    
    // Move proxy to active list
    if (this.proxies.disabled.some(p => p.id === proxy.id)) {
      this.proxies.disabled = this.proxies.disabled.filter(p => p.id !== proxy.id);
      this.proxies.active.push(proxy);
    } else if (this.proxies.backup.some(p => p.id === proxy.id)) {
      this.proxies.backup = this.proxies.backup.filter(p => p.id === proxy.id);
      this.proxies.active.push(proxy);
    }
  }
  
  /**
   * Update a proxy's performance score
   * @param {string} proxyId - Proxy ID
   * @private
   */
  _updateProxyScore(proxyId) {
    const stats = this.proxyStats.get(proxyId);
    if (!stats) return;
    
    // Calculate success rate
    if (stats.totalRequests > 0) {
      stats.successRate = stats.successfulRequests / stats.totalRequests;
    }
    
    // Calculate score based on multiple factors
    const responseTimeFactor = stats.avgResponseTime === 0 ? 1 : 
      Math.min(1, 5000 / stats.avgResponseTime); // Lower response time is better
    
    const recencyFactor = stats.lastUsed ? 
      Math.min(1, 24 * 60 * 60 * 1000 / Math.max(1, Date.now() - stats.lastUsed)) : 0.5;
    
    const banFactor = Math.max(0.1, 1 - (stats.banCount * 0.1));
    
    // Combine factors with different weights
    stats.score = (
      (stats.successRate * 0.5) + 
      (responseTimeFactor * 0.2) + 
      (recencyFactor * 0.1) + 
      (banFactor * 0.2)
    );
  }
  
  /**
   * Get a proxy for a specific domain
   * @param {string} url - URL to get proxy for
   * @param {Object} options - Proxy selection options
   * @returns {Object|null} - Selected proxy or null if none available
   */
  getProxy(url, options = {}) {
    if (!url) {
      logger.warn('Attempted to get proxy for undefined URL');
      return null;
    }
    
    // Extract domain from URL
    const domain = extractDomain(url);
    
    // Check if domain has a bound proxy
    if (options.bindToSite !== false && this.domainProxies.has(domain)) {
      const boundProxyId = this.domainProxies.get(domain);
      const boundProxy = this.proxies.active.find(p => p.id === boundProxyId);
      
      if (boundProxy) {
        this._updateProxyUsage(boundProxy, domain);
        return boundProxy;
      }
    }
    
    // Filter proxies based on options
    let eligibleProxies = [...this.proxies.active];
    
    // Filter by country if specified
    if (options.country) {
      eligibleProxies = eligibleProxies.filter(
        proxy => proxy.country === options.country
      );
    }
    
    // Filter by tags if specified
    if (options.tags && options.tags.length > 0) {
      eligibleProxies = eligibleProxies.filter(
        proxy => proxy.tags && options.tags.some(tag => proxy.tags.includes(tag))
      );
    }
    
    // Filter by type if specified
    if (options.type) {
      eligibleProxies = eligibleProxies.filter(
        proxy => proxy.type === options.type
      );
    }
    
    // Filter out proxies that are already in use for the given domain
    if (options.enforceUnique && this.lastUsedProxies.has(domain)) {
      const lastProxyId = this.lastUsedProxies.get(domain);
      eligibleProxies = eligibleProxies.filter(proxy => proxy.id !== lastProxyId);
    }
    
    // If no eligible proxies, fallback to all active proxies
    if (eligibleProxies.length === 0) {
      eligibleProxies = [...this.proxies.active];
      
      // If still no proxies, try to activate some from backup
      if (eligibleProxies.length === 0 && this.proxies.backup.length > 0) {
        const backupProxy = this.proxies.backup[0];
        this._enableProxy(backupProxy);
        eligibleProxies.push(backupProxy);
      }
      
      // If still no proxies, give up
      if (eligibleProxies.length === 0) {
        logger.warn('No proxy available', { domain });
        return null;
      }
    }
    
    // Select proxy based on strategy
    let selectedProxy;
    
    switch (this.options.rotationStrategy) {
      case 'sequential':
        // Use the next proxy in sequence
        const lastIndex = this.lastUsedProxies.get('__global__index') || 0;
        const nextIndex = (lastIndex + 1) % eligibleProxies.length;
        selectedProxy = eligibleProxies[nextIndex];
        this.lastUsedProxies.set('__global__index', nextIndex);
        break;
      
      case 'random':
        // Select a random proxy
        selectedProxy = eligibleProxies[Math.floor(Math.random() * eligibleProxies.length)];
        break;
      
      case 'performance':
      default:
        // Select based on performance score
        eligibleProxies.forEach(proxy => {
          const stats = this.proxyStats.get(proxy.id);
          if (stats) {
            this._updateProxyScore(proxy.id);
          }
        });
        
        // Sort by score, with some randomness
        selectedProxy = eligibleProxies.sort((a, b) => {
          const scoreA = (this.proxyStats.get(a.id)?.score || 0) * (0.8 + Math.random() * 0.4);
          const scoreB = (this.proxyStats.get(b.id)?.score || 0) * (0.8 + Math.random() * 0.4);
          return scoreB - scoreA;
        })[0];
        break;
    }
    
    if (!selectedProxy) {
      logger.warn('Failed to select proxy', { domain });
      return null;
    }
    
    this._updateProxyUsage(selectedProxy, domain, options.bindToSite);
    
    return selectedProxy;
  }
  
  /**
   * Update proxy usage information
   * @param {Object} proxy - The selected proxy
   * @param {string} domain - The domain being accessed
   * @param {boolean} bindToSite - Whether to bind this proxy to the domain
   * @private
   */
  _updateProxyUsage(proxy, domain, bindToSite = false) {
    // Update proxy usage information
    this.lastUsedProxies.set(domain, proxy.id);
    
    const stats = this.proxyStats.get(proxy.id);
    if (stats) {
      stats.lastUsed = Date.now();
      stats.totalRequests++;
    }
    
    // For site binding strategy, associate this proxy with the domain
    if (bindToSite) {
      this.domainProxies.set(domain, proxy.id);
    }
    
    logger.debug(`Selected proxy ${proxy.id} for ${domain}`);
  }
  
  /**
   * Record a successful request for a proxy
   * @param {string} proxyId - Proxy ID
   */
  recordSuccess(proxyId) {
    if (!proxyId) return;
    
    const stats = this.proxyStats.get(proxyId);
    if (stats) {
      stats.successfulRequests++;
      stats.consecutiveFailures = 0;
      this._updateProxyScore(proxyId);
    }
  }
  
  /**
   * Record a failed request for a proxy
   * @param {string} proxyId - Proxy ID
   * @param {Object} context - Failure context
   */
  recordFailure(proxyId, context = {}) {
    if (!proxyId) return;
    
    const stats = this.proxyStats.get(proxyId);
    if (!stats) return;
    
    stats.failedRequests++;
    stats.consecutiveFailures++;
    this._updateProxyScore(proxyId);
    
    // Find the proxy
    const proxy = [...this.proxies.active, ...this.proxies.disabled, ...this.proxies.backup]
      .find(p => p.id === proxyId);
    
    if (!proxy) return;
    
    // Check if proxy should be disabled
    if (stats.consecutiveFailures >= this.options.maxConsecutiveFailures) {
      this._disableProxy(proxy, context.reason || 'Too many consecutive failures');
    }
  }
  
  /**
   * Mark a proxy as banned or blocked
   * @param {string} proxyId - Proxy ID
   * @param {string} reason - Reason for ban
   */
  markProxyBanned(proxyId, reason = 'Proxy banned') {
    if (!proxyId) return;
    
    const proxy = [...this.proxies.active, ...this.proxies.disabled]
      .find(p => p.id === proxyId);
    
    if (proxy) {
      this._disableProxy(proxy, reason);
      
      // Save changes
      this._saveProxies().catch(error => {
        logger.error('Failed to save proxies after marking banned', {}, error);
      });
    }
  }
  
  /**
   * Add a new proxy to the service
   * @param {Object} proxyConfig - Proxy configuration
   * @returns {boolean} - Success status
   */
  addProxy(proxyConfig) {
    if (!proxyConfig || !proxyConfig.url) {
      logger.warn('Invalid proxy configuration provided');
      return false;
    }
    
    this._addProxy(proxyConfig);
    
    // Save changes
    this._saveProxies().catch(error => {
      logger.error('Failed to save proxies after adding new proxy', {}, error);
    });
    
    return true;
  }
  
  /**
   * Get the count of proxies by status
   * @returns {Object} - Proxy counts
   */
  getProxyCounts() {
    return {
      active: this.proxies.active.length,
      disabled: this.proxies.disabled.length,
      backup: this.proxies.backup.length,
      total: this.proxies.active.length + this.proxies.disabled.length + this.proxies.backup.length
    };
  }
  
  /**
   * Get all proxy statistics
   * @returns {Array<Object>} - Proxy statistics
   */
  getProxyStats() {
    return Array.from(this.proxyStats.values());
  }
  
  /**
   * Reset consecutive failures for all proxies
   */
  resetFailures() {
    for (const stats of this.proxyStats.values()) {
      stats.consecutiveFailures = 0;
    }
  }
  
  /**
   * Create axios instance with proxy
   * @param {string} url - URL to create instance for
   * @param {Object} options - Proxy options
   * @returns {Object} - Axios instance with proxy
   */
  createAxiosInstanceWithProxy(url, options = {}) {
    const proxy = this.getProxy(url, options);
    
    if (!proxy) {
      // Return regular axios instance if no proxy available
      return axios.create();
    }
    
    const agent = this._createProxyAgent(proxy);
    
    if (!agent) {
      return axios.create();
    }
    
    // Create axios instance with proxy
    const instance = axios.create({
      httpsAgent: agent,
      proxy: false, // We're using our custom agent
      headers: {
        'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Add response interceptor to track proxy performance
    instance.interceptors.response.use(
      response => {
        this.recordSuccess(proxy.id);
        return response;
      },
      error => {
        this.recordFailure(proxy.id, { 
          reason: error.message,
          statusCode: error.response?.status
        });
        
        return Promise.reject(error);
      }
    );
    
    // Attach proxy info to instance
    instance.proxyId = proxy.id;
    instance.proxyUrl = proxy.url;
    
    return instance;
  }
  
  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    // Clear proxy agent cache
    this.proxyAgentCache.clear();
    
    // Save proxy state
    return this._saveProxies();
  }
}

// Export a singleton instance
const proxyRotationService = new ProxyRotationService();
module.exports = proxyRotationService; 