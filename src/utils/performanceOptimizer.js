/**
 * Performance Optimizer Module
 * Provides utilities for optimizing scraping performance and resource usage
 */
const logger = require('./logger');
const os = require('os');

class PerformanceOptimizer {
  constructor() {
    // Track performance metrics
    this.metrics = {
      startTime: Date.now(),
      totalJobs: 0,
      successfulJobs: 0,
      failedJobs: 0,
      totalRequestTime: 0,
      totalJobTime: 0,
      activeConnections: 0,
      peakConnections: 0,
      cpuUsageHistory: [],
      memoryUsageHistory: [],
      errorRates: {
        lastMinute: 0,
        lastFiveMinutes: 0,
        lastHour: 0
      },
      concurrencyHistory: []
    };
    
    // Queue for tracking errors with timestamps
    this.errorQueue = [];
    
    // Settings
    this.settings = {
      baseConcurrency: 5,
      minConcurrency: 1,
      maxConcurrency: 20,
      cpuThreshold: 0.8,      // CPU usage threshold (0-1)
      memoryThreshold: 0.8,   // Memory usage threshold (0-1)
      errorRateThreshold: 0.2 // Error rate threshold (0-1)
    };
    
    // Request blockers by resource type
    this.resourceBlockPatterns = [
      // Analytics and tracking
      /google-analytics\.com/,
      /analytics\.js/,
      /tracking\.js/,
      /pixel\.gif/,
      /beacon/,
      /fb-tracking/,
      
      // Ads
      /ads?[0-9]*\.js/,
      /adserver/,
      /banner/,
      /doubleclick\.net/,
      
      // Social media embeds by default
      /facebook\.com\/plugins/,
      /twitter\.com\/widgets/,
      /platform\.linkedin\.com/,
      /instagram\.com\/embed/,
      
      // Large media by default
      /\.mp4$/,
      /\.webm$/,
      /\.mov$/,
      /large.*\.jpe?g$/,
      /hd.*\.jpe?g$/,
      /large.*\.png$/
    ];
    
    // JavaScript execution patterns - when to allow/block JS
    this.jsExecutionPatterns = {
      // Sites that require JS for core content
      requiresJs: [
        /react-app/,
        /vue-app/,
        /angular/,
        /dynamic-content/,
        /spa-/
      ],
      
      // Scripts that are often unnecessary
      blockByDefault: [
        /gtm\.js/,
        /ga\.js/,
        /hotjar/,
        /optimizely/,
        /criteo/,
        /chartbeat/
      ]
    };
    
    // Start monitoring system metrics
    this._startMonitoring();
  }
  
  /**
   * Start monitoring system resources
   * @private
   */
  _startMonitoring() {
    // Monitor every 10 seconds
    this.monitorInterval = setInterval(() => {
      // Track CPU usage
      const cpuUsage = this._getCurrentCpuUsage();
      this.metrics.cpuUsageHistory.push({
        timestamp: Date.now(),
        value: cpuUsage
      });
      
      // Track memory usage
      const memUsage = this._getCurrentMemoryUsage();
      this.metrics.memoryUsageHistory.push({
        timestamp: Date.now(),
        value: memUsage
      });
      
      // Calculate error rates
      this._calculateErrorRates();
      
      // Trim history to last 60 minutes
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      this.metrics.cpuUsageHistory = this.metrics.cpuUsageHistory.filter(entry => entry.timestamp > oneHourAgo);
      this.metrics.memoryUsageHistory = this.metrics.memoryUsageHistory.filter(entry => entry.timestamp > oneHourAgo);
      this.metrics.concurrencyHistory = this.metrics.concurrencyHistory.filter(entry => entry.timestamp > oneHourAgo);
      
      // Log current status if significant changes
      if (cpuUsage > this.settings.cpuThreshold || memUsage > this.settings.memoryThreshold) {
        logger.info('Resource usage high', {
          cpu: cpuUsage.toFixed(2),
          memory: memUsage.toFixed(2),
          currentConcurrency: this._getRecommendedConcurrency()
        });
      }
    }, 10000);
  }
  
  /**
   * Calculate current CPU usage (0-1)
   * @returns {number} - CPU usage
   * @private
   */
  _getCurrentCpuUsage() {
    try {
      const cpus = os.cpus();
      
      if (!this._lastCpuUsage) {
        this._lastCpuUsage = cpus;
        return 0;
      }
      
      let idleTotal = 0;
      let total = 0;
      
      for (let i = 0; i < cpus.length; i++) {
        const cpu = cpus[i];
        const lastCpu = this._lastCpuUsage[i];
        
        // Calculate difference in CPU times
        const idle = cpu.times.idle - lastCpu.times.idle;
        const user = cpu.times.user - lastCpu.times.user;
        const nice = cpu.times.nice - lastCpu.times.nice;
        const sys = cpu.times.sys - lastCpu.times.sys;
        const irq = cpu.times.irq - lastCpu.times.irq;
        
        idleTotal += idle;
        total += idle + user + nice + sys + irq;
      }
      
      this._lastCpuUsage = cpus;
      
      // Return non-idle percentage
      return total > 0 ? 1 - (idleTotal / total) : 0;
    } catch (error) {
      logger.warn('Error calculating CPU usage', {}, error);
      return 0;
    }
  }
  
  /**
   * Calculate current memory usage (0-1)
   * @returns {number} - Memory usage
   * @private
   */
  _getCurrentMemoryUsage() {
    try {
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      
      return 1 - (freeMem / totalMem);
    } catch (error) {
      logger.warn('Error calculating memory usage', {}, error);
      return 0;
    }
  }
  
  /**
   * Calculate error rates for different time windows
   * @private
   */
  _calculateErrorRates() {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    
    // Clean up old errors
    this.errorQueue = this.errorQueue.filter(error => error.timestamp > oneHourAgo);
    
    // Count recent errors
    const recentErrors = {
      minute: this.errorQueue.filter(error => error.timestamp > oneMinuteAgo).length,
      fiveMinutes: this.errorQueue.filter(error => error.timestamp > fiveMinutesAgo).length,
      hour: this.errorQueue.length
    };
    
    // Calculate error rates based on jobs in each time window
    const jobsLastMinute = this.metrics.concurrencyHistory
      .filter(entry => entry.timestamp > oneMinuteAgo)
      .reduce((sum, entry) => sum + entry.jobCount, 0);
      
    const jobsLastFiveMinutes = this.metrics.concurrencyHistory
      .filter(entry => entry.timestamp > fiveMinutesAgo)
      .reduce((sum, entry) => sum + entry.jobCount, 0);
      
    const jobsLastHour = this.metrics.totalJobs;
    
    this.metrics.errorRates = {
      lastMinute: jobsLastMinute > 0 ? recentErrors.minute / jobsLastMinute : 0,
      lastFiveMinutes: jobsLastFiveMinutes > 0 ? recentErrors.fiveMinutes / jobsLastFiveMinutes : 0,
      lastHour: jobsLastHour > 0 ? recentErrors.hour / jobsLastHour : 0
    };
  }
  
  /**
   * Record a successful job
   * @param {number} requestTime - Time spent on network requests
   * @param {number} totalTime - Total job processing time
   */
  recordSuccess(requestTime, totalTime) {
    this.metrics.totalJobs++;
    this.metrics.successfulJobs++;
    this.metrics.totalRequestTime += requestTime || 0;
    this.metrics.totalJobTime += totalTime || 0;
    
    // Update concurrency history
    this._updateConcurrencyHistory(1, true);
  }
  
  /**
   * Record a failed job
   * @param {Object} error - Error object
   * @param {number} totalTime - Total job time before failure
   */
  recordError(error, totalTime) {
    this.metrics.totalJobs++;
    this.metrics.failedJobs++;
    this.metrics.totalJobTime += totalTime || 0;
    
    // Add to error queue
    this.errorQueue.push({
      timestamp: Date.now(),
      type: error.type || 'unknown',
      message: error.message
    });
    
    // Update concurrency history
    this._updateConcurrencyHistory(1, false);
  }
  
  /**
   * Track concurrency and job counts for historical analysis
   * @param {number} jobCount - Number of jobs to add
   * @param {boolean} success - Whether the jobs were successful
   * @private
   */
  _updateConcurrencyHistory(jobCount, success) {
    const now = Date.now();
    const currentConcurrency = this._getRecommendedConcurrency();
    
    // Add entry to concurrency history
    this.metrics.concurrencyHistory.push({
      timestamp: now,
      concurrency: currentConcurrency,
      jobCount: jobCount,
      successful: success ? jobCount : 0,
      failed: !success ? jobCount : 0
    });
  }
  
  /**
   * Get current recommended concurrency based on resource usage and error rates
   * @returns {number} - Recommended concurrency
   */
  getRecommendedConcurrency() {
    return this._getRecommendedConcurrency();
  }
  
  /**
   * Calculate recommended concurrency based on system metrics
   * @returns {number} - Recommended concurrency
   * @private
   */
  _getRecommendedConcurrency() {
    // Get latest metrics
    const cpuUsage = this.metrics.cpuUsageHistory.length > 0 
      ? this.metrics.cpuUsageHistory[this.metrics.cpuUsageHistory.length - 1].value
      : 0;
      
    const memoryUsage = this.metrics.memoryUsageHistory.length > 0
      ? this.metrics.memoryUsageHistory[this.metrics.memoryUsageHistory.length - 1].value
      : 0;
      
    const errorRate = this.metrics.errorRates.lastFiveMinutes;
    
    // Base concurrency
    let concurrency = this.settings.baseConcurrency;
    
    // Adjust based on CPU usage
    if (cpuUsage > this.settings.cpuThreshold) {
      const cpuFactor = 1 - ((cpuUsage - this.settings.cpuThreshold) / (1 - this.settings.cpuThreshold));
      concurrency *= Math.max(0.1, cpuFactor);
    }
    
    // Adjust based on memory usage
    if (memoryUsage > this.settings.memoryThreshold) {
      const memoryFactor = 1 - ((memoryUsage - this.settings.memoryThreshold) / (1 - this.settings.memoryThreshold));
      concurrency *= Math.max(0.1, memoryFactor);
    }
    
    // Adjust based on error rate
    if (errorRate > this.settings.errorRateThreshold) {
      const errorFactor = 1 - ((errorRate - this.settings.errorRateThreshold) / (1 - this.settings.errorRateThreshold));
      concurrency *= Math.max(0.1, errorFactor);
    }
    
    // Apply limits
    return Math.max(
      this.settings.minConcurrency,
      Math.min(this.settings.maxConcurrency, Math.round(concurrency))
    );
  }
  
  /**
   * Track active connection count
   * @param {number} count - Connection count change (+1 for new, -1 for closed)
   */
  updateConnectionCount(count) {
    this.metrics.activeConnections += count;
    
    // Update peak if needed
    if (this.metrics.activeConnections > this.metrics.peakConnections) {
      this.metrics.peakConnections = this.metrics.activeConnections;
    }
  }
  
  /**
   * Get resource block patterns for request filtering
   * @returns {Array<RegExp>} - Patterns to block
   */
  getResourceBlockPatterns() {
    return this.resourceBlockPatterns;
  }
  
  /**
   * Add new resource patterns to block
   * @param {Array<RegExp|string>} patterns - Patterns to add to blocklist
   */
  addResourceBlockPatterns(patterns) {
    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        this.resourceBlockPatterns.push(new RegExp(pattern));
      } else if (pattern instanceof RegExp) {
        this.resourceBlockPatterns.push(pattern);
      }
    }
  }
  
  /**
   * Check if JavaScript is required for a given URL
   * @param {string} url - URL to check
   * @returns {boolean} - Whether JavaScript is required
   */
  isJavaScriptRequired(url) {
    // Check if URL matches any pattern that requires JS
    return this.jsExecutionPatterns.requiresJs.some(pattern => pattern.test(url));
  }
  
  /**
   * Should a script be blocked for optimization?
   * @param {string} scriptUrl - Script URL to check
   * @returns {boolean} - Whether the script should be blocked
   */
  shouldBlockScript(scriptUrl) {
    // Check if script URL matches any block pattern
    return this.jsExecutionPatterns.blockByDefault.some(pattern => pattern.test(scriptUrl));
  }
  
  /**
   * Create a lightweight request filter function for Playwright
   * @param {Object} options - Filter options
   * @returns {Function} - Request filter function
   */
  createRequestFilter(options = {}) {
    const {
      blockImages = false,
      blockMedia = true,
      blockFonts = false,
      blockStyles = false,
      allowedDomains = [],
      customBlockPatterns = []
    } = options;
    
    // Combine standard and custom block patterns
    const allBlockPatterns = [
      ...this.resourceBlockPatterns,
      ...customBlockPatterns
    ];
    
    return (request) => {
      const url = request.url();
      const resourceType = request.resourceType();
      
      // Check if domain is in allowed list
      if (allowedDomains.length > 0) {
        const domain = new URL(url).hostname;
        if (!allowedDomains.some(allowedDomain => domain.includes(allowedDomain))) {
          return false; // Block requests to non-allowed domains
        }
      }
      
      // Block by resource type
      if (
        (blockImages && resourceType === 'image') ||
        (blockMedia && (resourceType === 'media' || resourceType === 'video')) ||
        (blockFonts && resourceType === 'font') ||
        (blockStyles && resourceType === 'stylesheet')
      ) {
        return false;
      }
      
      // Block by pattern
      if (allBlockPatterns.some(pattern => pattern.test(url))) {
        return false;
      }
      
      // Allow request by default
      return true;
    };
  }
  
  /**
   * Create DOM snapshot capture function
   * @returns {Function} - Function to capture DOM snapshot
   */
  createDomSnapshotFunction() {
    return async (page) => {
      try {
        // Capture a lightweight representation of the DOM
        return await page.evaluate(() => {
          // Helper to serialize DOM node
          const serializeNode = (node, depth = 0, maxDepth = 10) => {
            if (depth > maxDepth) return null;
            
            if (node.nodeType === Node.TEXT_NODE) {
              return { type: 'text', content: node.textContent };
            }
            
            if (node.nodeType !== Node.ELEMENT_NODE) return null;
            
            // Get attributes
            const attributes = {};
            for (const attr of node.attributes) {
              attributes[attr.name] = attr.value;
            }
            
            // Recursively serialize children
            const children = [];
            for (const child of node.childNodes) {
              const serializedChild = serializeNode(child, depth + 1, maxDepth);
              if (serializedChild) {
                children.push(serializedChild);
              }
            }
            
            return {
              type: 'element',
              tagName: node.tagName.toLowerCase(),
              attributes,
              children,
              textContent: node.textContent
            };
          };
          
          // Serialize the entire document
          return {
            title: document.title,
            url: window.location.href,
            root: serializeNode(document.documentElement, 0, 5) // Limit depth for efficiency
          };
        });
      } catch (error) {
        logger.error('Error creating DOM snapshot', {}, error);
        return null;
      }
    };
  }
  
  /**
   * Get optimization metrics and statistics
   * @returns {Object} - Current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      currentConcurrency: this._getRecommendedConcurrency(),
      averageJobTime: this.metrics.totalJobs > 0 
        ? this.metrics.totalJobTime / this.metrics.totalJobs 
        : 0,
      averageRequestTime: this.metrics.successfulJobs > 0 
        ? this.metrics.totalRequestTime / this.metrics.successfulJobs 
        : 0,
      successRate: this.metrics.totalJobs > 0 
        ? this.metrics.successfulJobs / this.metrics.totalJobs 
        : 0
    };
  }
  
  /**
   * Configure the optimizer settings
   * @param {Object} settings - New settings
   */
  configure(settings) {
    this.settings = {
      ...this.settings,
      ...settings
    };
    
    logger.info('Performance optimizer configured', {
      baseConcurrency: this.settings.baseConcurrency,
      maxConcurrency: this.settings.maxConcurrency,
      cpuThreshold: this.settings.cpuThreshold,
      errorRateThreshold: this.settings.errorRateThreshold
    });
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
  }
}

module.exports = new PerformanceOptimizer(); 