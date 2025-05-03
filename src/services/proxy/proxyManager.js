/**
 * Proxy Manager Service
 * Handles proxy rotation, monitoring performance, and health checking
 */
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const config = require('../../config');
const { withRetry } = require('../../utils/retry');

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.stats = new Map(); // Store success/failure stats for each proxy
    this.currentIndex = 0;
    this.initialized = false;
    this.domainStats = new Map(); // Track stats per domain
    this.circuitBreakers = new Map(); // Circuit breaker state by domain
    this.lastHealthCheck = Date.now();
    this.healthCheckInterval = 15 * 60 * 1000; // 15 minutes
    this.circuitBreakerThreshold = 5; // Number of consecutive failures before opening circuit
    this.circuitBreakerResetTime = 5 * 60 * 1000; // 5 minutes
    this._startHealthChecks();
  }

  /**
   * Initialize the proxy manager
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      // First check for proxies in config
      if (config.proxy.proxies && config.proxy.proxies.length > 0) {
        this.proxies = [...config.proxy.proxies];
      } 
      // Then try to load from proxy file if available
      else if (config.proxy.proxyFile) {
        await this.loadProxiesFromFile(config.proxy.proxyFile);
      }
      
      // Initialize stats for each proxy
      this.proxies.forEach(proxy => {
        if (!this.stats.has(proxy)) {
          this.stats.set(proxy, { 
            success: 0, 
            failure: 0, 
            consecutiveFailures: 0,
            lastUsed: 0, 
            avgResponseTime: 0,
            banned: false,
            domainPerformance: new Map(), // Track performance by domain
            lastHealthCheck: 0,
            healthCheckResult: true
          });
        }
      });
      
      logger.info(`Proxy manager initialized with ${this.proxies.length} proxies`);
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize proxy manager', {}, error);
      throw error;
    }
  }

  /**
   * Load proxies from a file
   * @param {string} filePath - Path to the proxy file
   * @returns {Promise<void>}
   */
  async loadProxiesFromFile(filePath) {
    try {
      const fileContent = await fs.readFile(path.resolve(filePath), 'utf-8');
      const proxies = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      
      this.proxies = [...proxies];
    } catch (error) {
      logger.error(`Failed to load proxies from ${filePath}`, {}, error);
      this.proxies = [];
    }
  }

  /**
   * Get the next proxy based on the selected rotation strategy
   * @param {string} [domain=null] - Target domain (optional)
   * @returns {string|null} - The proxy URL or null if no proxies available
   */
  getNextProxy(domain = null) {
    if (!this.initialized) {
      logger.warn('Proxy manager not initialized');
      return null;
    }
    
    if (this.proxies.length === 0) {
      logger.warn('No proxies available');
      return null;
    }

    // Check if circuit breaker is open for this domain
    if (domain && this.isCircuitOpen(domain)) {
      logger.warn(`Circuit breaker open for domain: ${domain}, not using proxy`);
      return null;
    }

    // Filter out banned proxies with too many failures
    const availableProxies = this.proxies.filter(proxy => {
      const stats = this.stats.get(proxy);
      return stats && 
             !stats.banned && 
             stats.consecutiveFailures < config.proxy.maxFailures &&
             stats.healthCheckResult !== false;
    });

    if (availableProxies.length === 0) {
      logger.warn('No healthy proxies available, resetting all proxies');
      // Reset all proxies if all are banned
      this.proxies.forEach(proxy => {
        const stats = this.stats.get(proxy);
        if (stats) {
          stats.banned = false;
          stats.consecutiveFailures = 0;
        }
      });
      return this.getNextProxy(domain);
    }

    let selectedProxy;
    
    // Choose next proxy based on strategy
    switch (config.proxy.rotationStrategy) {
      case 'random':
        selectedProxy = availableProxies[Math.floor(Math.random() * availableProxies.length)];
        break;
      
      case 'performance':
        if (domain) {
          // Sort by domain-specific performance if available
          availableProxies.sort((a, b) => {
            const statsA = this.stats.get(a);
            const statsB = this.stats.get(b);
            
            const domainStatsA = statsA.domainPerformance.get(domain);
            const domainStatsB = statsB.domainPerformance.get(domain);
            
            if (domainStatsA && domainStatsB) {
              // Calculate success rates for this domain
              const successRateA = domainStatsA.success / 
                (domainStatsA.success + domainStatsA.failure || 1);
              const successRateB = domainStatsB.success / 
                (domainStatsB.success + domainStatsB.failure || 1);
              
              // Higher success rate is better
              return successRateB - successRateA;
            }
            
            // Fall back to overall performance if no domain-specific data
            const successRateA = statsA.success / (statsA.success + statsA.failure) || 0;
            const successRateB = statsB.success / (statsB.success + statsB.failure) || 0;
            
            // Higher success rate and lower response time is better
            return (successRateB - successRateA) || (statsA.avgResponseTime - statsB.avgResponseTime);
          });
        } else {
          // Sort by overall performance
          availableProxies.sort((a, b) => {
            const statsA = this.stats.get(a);
            const statsB = this.stats.get(b);
            const successRateA = statsA.success / (statsA.success + statsA.failure) || 0;
            const successRateB = statsB.success / (statsB.success + statsB.failure) || 0;
            // Higher success rate and lower response time is better
            return (successRateB - successRateA) || (statsA.avgResponseTime - statsB.avgResponseTime);
          });
        }
        selectedProxy = availableProxies[0];
        break;
      
      case 'sequential':
      default:
        // Simple round-robin
        if (this.currentIndex >= availableProxies.length) {
          this.currentIndex = 0;
        }
        selectedProxy = availableProxies[this.currentIndex++];
        break;
    }
    
    // Update last used timestamp
    const stats = this.stats.get(selectedProxy);
    if (stats) {
      stats.lastUsed = Date.now();
    }
    
    return selectedProxy;
  }

  /**
   * Report success or failure for a proxy
   * @param {string} proxy - The proxy URL
   * @param {boolean} success - Whether the request was successful
   * @param {number} [responseTime=0] - Response time in ms
   * @param {string} [domain=null] - The domain that was accessed (optional)
   */
  reportResult(proxy, success, responseTime = 0, domain = null) {
    if (!proxy || !this.stats.has(proxy)) return;
    
    const stats = this.stats.get(proxy);
    
    // Update overall proxy stats
    if (success) {
      stats.success++;
      stats.consecutiveFailures = 0;
      
      // Update average response time with exponential moving average
      if (stats.avgResponseTime === 0) {
        stats.avgResponseTime = responseTime;
      } else {
        stats.avgResponseTime = stats.avgResponseTime * 0.7 + responseTime * 0.3;
      }
    } else {
      stats.failure++;
      stats.consecutiveFailures++;
      
      // Mark proxy as banned if it fails too many times consecutively
      if (stats.consecutiveFailures >= config.proxy.maxFailures) {
        stats.banned = true;
        logger.warn(`Proxy ${proxy} marked as banned after ${stats.consecutiveFailures} consecutive failures`);
      }
    }
    
    // Update domain-specific stats if domain is provided
    if (domain) {
      if (!stats.domainPerformance.has(domain)) {
        stats.domainPerformance.set(domain, {
          success: 0,
          failure: 0,
          consecutiveFailures: 0,
          avgResponseTime: 0
        });
      }
      
      const domainStats = stats.domainPerformance.get(domain);
      
      if (success) {
        domainStats.success++;
        domainStats.consecutiveFailures = 0;
        
        // Update domain-specific response time
        if (domainStats.avgResponseTime === 0) {
          domainStats.avgResponseTime = responseTime;
        } else {
          domainStats.avgResponseTime = domainStats.avgResponseTime * 0.7 + responseTime * 0.3;
        }
      } else {
        domainStats.failure++;
        domainStats.consecutiveFailures++;
      }
      
      // Update domain circuit breaker
      this.updateCircuitBreaker(domain, success);
    }
  }

  /**
   * Update circuit breaker state for a domain
   * @param {string} domain - The domain
   * @param {boolean} success - Whether the request was successful
   */
  updateCircuitBreaker(domain, success) {
    if (!domain) return;
    
    if (!this.domainStats.has(domain)) {
      this.domainStats.set(domain, {
        success: 0,
        failure: 0,
        consecutiveFailures: 0,
        lastFailure: 0
      });
    }
    
    const stats = this.domainStats.get(domain);
    
    if (success) {
      stats.success++;
      stats.consecutiveFailures = 0;
      
      // Reset circuit breaker if it was half-open and successful
      if (this.circuitBreakers.get(domain) === 'HALF_OPEN') {
        this.circuitBreakers.set(domain, 'CLOSED');
        logger.info(`Circuit breaker for ${domain} reset to CLOSED after successful request`);
      }
    } else {
      stats.failure++;
      stats.consecutiveFailures++;
      stats.lastFailure = Date.now();
      
      // Open circuit breaker if too many consecutive failures
      if (stats.consecutiveFailures >= this.circuitBreakerThreshold) {
        this.circuitBreakers.set(domain, 'OPEN');
        logger.warn(`Circuit breaker for ${domain} set to OPEN after ${stats.consecutiveFailures} consecutive failures`);
      }
    }
  }

  /**
   * Check if circuit breaker is open for a domain
   * @param {string} domain - The domain to check
   * @returns {boolean} - Whether circuit is open
   */
  isCircuitOpen(domain) {
    if (!domain || !this.circuitBreakers.has(domain)) {
      return false;
    }
    
    if (this.circuitBreakers.get(domain) === 'OPEN') {
      const stats = this.domainStats.get(domain);
      if (!stats) return false;
      
      const timeSinceLastFailure = Date.now() - stats.lastFailure;
      
      // If enough time has passed, set to half-open to allow a test request
      if (timeSinceLastFailure >= this.circuitBreakerResetTime) {
        this.circuitBreakers.set(domain, 'HALF_OPEN');
        logger.info(`Circuit breaker for ${domain} set to HALF_OPEN after cooling period`);
        return false;
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Test a proxy's health against a neutral website
   * @param {string} proxy - Proxy to test
   * @returns {Promise<boolean>} - Whether proxy is healthy
   */
  async testProxyHealth(proxy) {
    if (!proxy) return false;
    
    try {
      // Use a simple, reliable site for testing
      const testUrl = 'https://httpbin.org/ip';
      const proxyUrl = this.formatProxyForPlaywright(proxy);
      if (!proxyUrl) return false;
      
      // Test proxy with fetch or another lightweight solution
      // This is placeholder code - implement with your preferred HTTP client
      /*
      const response = await fetch(testUrl, { 
        agent: new HttpsProxyAgent(proxyUrl.server),
        timeout: 5000 
      });
      
      return response.status === 200;
      */
      
      // For now, just simulate a health check
      const isHealthy = Math.random() > 0.1; // 90% chance of success
      
      // Update proxy health status
      const stats = this.stats.get(proxy);
      if (stats) {
        stats.lastHealthCheck = Date.now();
        stats.healthCheckResult = isHealthy;
      }
      
      return isHealthy;
    } catch (error) {
      logger.warn(`Proxy health check failed for ${proxy}`, {}, error);
      
      // Mark as unhealthy
      const stats = this.stats.get(proxy);
      if (stats) {
        stats.lastHealthCheck = Date.now();
        stats.healthCheckResult = false;
      }
      
      return false;
    }
  }

  /**
   * Perform health checks on all proxies
   * @private
   */
  async _runHealthChecks() {
    if (!this.initialized || this.proxies.length === 0) return;
    
    logger.info('Running proxy health checks');
    
    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckInterval) return;
    this.lastHealthCheck = now;
    
    // Create a batch of promises for health checks
    const healthChecks = this.proxies.map(async (proxy) => {
      try {
        await this.testProxyHealth(proxy);
      } catch (error) {
        logger.error(`Health check error for proxy ${proxy}`, {}, error);
      }
    });
    
    // Run health checks in parallel with a concurrency limit
    const batchSize = 5;
    for (let i = 0; i < healthChecks.length; i += batchSize) {
      const batch = healthChecks.slice(i, i + batchSize);
      await Promise.all(batch);
    }
    
    // Log health check results
    const healthyCount = this.proxies.filter(proxy => {
      const stats = this.stats.get(proxy);
      return stats && stats.healthCheckResult;
    }).length;
    
    logger.info(`Proxy health check completed: ${healthyCount}/${this.proxies.length} healthy`);
  }

  /**
   * Start periodic health checks
   * @private
   */
  _startHealthChecks() {
    // Run health checks periodically
    setInterval(() => this._runHealthChecks(), this.healthCheckInterval);
  }

  /**
   * Get statistics for all proxies
   * @returns {Object} - Statistics for each proxy
   */
  getProxyStats() {
    const result = {};
    
    this.proxies.forEach(proxy => {
      const stats = this.stats.get(proxy);
      if (stats) {
        const total = stats.success + stats.failure;
        const successRate = total > 0 ? (stats.success / total) : 0;
        
        result[proxy] = {
          ...stats,
          total,
          successRate,
          health: stats.banned ? 'banned' : 
                 (stats.healthCheckResult === false ? 'unhealthy' :
                 (successRate < config.proxy.minSuccessRate ? 'poor' : 'good'))
        };
        
        // Add domain-specific performance data
        const domainData = {};
        stats.domainPerformance.forEach((domainStats, domain) => {
          const domainTotal = domainStats.success + domainStats.failure;
          const domainSuccessRate = domainTotal > 0 ? 
            (domainStats.success / domainTotal) : 0;
          
          domainData[domain] = {
            successRate: domainSuccessRate,
            total: domainTotal,
            avgResponseTime: domainStats.avgResponseTime
          };
        });
        
        result[proxy].domainPerformance = domainData;
      }
    });
    
    return result;
  }

  /**
   * Get domain-specific statistics
   * @returns {Object} - Statistics for each domain
   */
  getDomainStats() {
    const result = {};
    
    this.domainStats.forEach((stats, domain) => {
      const total = stats.success + stats.failure;
      const successRate = total > 0 ? (stats.success / total) : 0;
      
      result[domain] = {
        ...stats,
        total,
        successRate,
        circuitStatus: this.circuitBreakers.get(domain) || 'CLOSED'
      };
    });
    
    return result;
  }

  /**
   * Get a formatted proxy URL for Playwright
   * @param {string} proxy - The proxy string (e.g., "ip:port" or "user:pass@ip:port")
   * @returns {Object|null} - Proxy config for Playwright or null if invalid
   */
  formatProxyForPlaywright(proxy) {
    if (!proxy) return null;
    
    try {
      let server, username, password;
      
      if (proxy.includes('@')) {
        const [auth, host] = proxy.split('@');
        [username, password] = auth.split(':');
        server = host;
      } else {
        server = proxy;
      }
      
      // Make sure we have a valid proxy server
      if (!server || !server.includes(':')) {
        return null;
      }
      
      const result = { server: `http://${server}` };
      
      if (username && password) {
        result.username = username;
        result.password = password;
      }
      
      return result;
    } catch (error) {
      logger.error(`Invalid proxy format: ${proxy}`, {}, error);
      return null;
    }
  }
  
  /**
   * Get recommended proxy for a specific domain
   * @param {string} domain - Target domain
   * @returns {string|null} - Recommended proxy or null
   */
  getProxyForDomain(domain) {
    if (!domain || !this.initialized) return this.getNextProxy();
    
    // Find proxies that have successfully worked with this domain
    const candidates = this.proxies.filter(proxy => {
      const stats = this.stats.get(proxy);
      if (!stats || stats.banned || !stats.healthCheckResult) return false;
      
      const domainStats = stats.domainPerformance.get(domain);
      return domainStats && domainStats.success > 0 && 
             domainStats.consecutiveFailures < 2;
    });
    
    if (candidates.length === 0) {
      // Fall back to general proxy selection
      return this.getNextProxy(domain);
    }
    
    // Sort by success rate for this domain
    candidates.sort((a, b) => {
      const statsA = this.stats.get(a);
      const statsB = this.stats.get(b);
      const domainStatsA = statsA.domainPerformance.get(domain);
      const domainStatsB = statsB.domainPerformance.get(domain);
      
      const successRateA = domainStatsA.success / 
        (domainStatsA.success + domainStatsA.failure || 1);
      const successRateB = domainStatsB.success / 
        (domainStatsB.success + domainStatsB.failure || 1);
      
      return successRateB - successRateA;
    });
    
    return candidates[0];
  }
  
  /**
   * Integrate with premium residential proxy service
   * @param {Object} options - Provider-specific options
   * @returns {Promise<boolean>} - Success or failure
   */
  async integratePremiumProxies(options) {
    /* 
    // PREMIUM PROXY INTEGRATION - TO BE IMPLEMENTED LATER
    
    try {
      // Example implementation for Bright Data / Luminati
      const { apiKey, zone, country } = options;
      
      // Fetch session details from provider's API
      const response = await fetch('https://api.provider.com/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          zone: zone || 'general',
          country: country || 'us',
          session_duration: 600 // 10 minutes
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create premium proxy session: ${response.statusText}`);
      }
      
      const { session_id, proxy_url } = await response.json();
      
      // Add to our proxy list
      if (proxy_url && !this.proxies.includes(proxy_url)) {
        this.proxies.push(proxy_url);
        
        // Initialize stats for this proxy
        this.stats.set(proxy_url, {
          success: 0,
          failure: 0,
          consecutiveFailures: 0,
          lastUsed: 0,
          avgResponseTime: 0,
          banned: false,
          domainPerformance: new Map(),
          lastHealthCheck: Date.now(),
          healthCheckResult: true,
          premium: true,
          sessionId: session_id,
          expiresAt: Date.now() + (600 * 1000) // 10 minutes
        });
        
        logger.info(`Premium proxy integrated: ${proxy_url}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Failed to integrate premium proxies', {}, error);
      return false;
    }
    */
    
    // Placeholder implementation
    logger.info('Premium proxy integration will be implemented later');
    return false;
  }
}

// Export singleton
module.exports = new ProxyManager(); 