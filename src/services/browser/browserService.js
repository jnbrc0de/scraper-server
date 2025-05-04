/**
 * Browser Service
 * Manages browser instances with health monitoring and resource optimization
 */
const { chromium } = require('../browser/stealthPlugin');
const logger = require('../../utils/logger');
const config = require('../../config');
const proxyManager = require('../proxy/proxyManager');
const { getProxySettings } = require('./stealthPlugin');
const { URL } = require('url');
const crypto = require('crypto');
const antiDetection = require('../../utils/antiDetection');

// Plugin is already registered in stealthPlugin.js

class BrowserService {
  constructor() {
    this.browsers = [];
    this.contexts = [];
    this.pages = [];
    this.activeSessions = 0;
    this.maxSessions = config.browser.poolSize;
    this.lastHealthCheck = Date.now();
    this.healthCheckInterval = config.browser.healthCheckInterval;
    this.memoryLimitMB = config.browser.memoryLimitMB;
    this.userAgents = config.browser.userAgents;
    this.sessionHeaders = new Map(); // Track headers for consistency
    this.browserRotationCounter = 0;
    this.browserRotationThreshold = config.browser.rotationThreshold || 100; // Rotate browser after this many uses
    this.prewarming = false;
    this.prewarmingPromise = null;
    
    // Initialize browser pool
    this._startHealthMonitor();
    
    // Start prewarming if enabled
    if (config.browser.prewarmEnabled) {
      this._startPrewarming();
    }
  }

  /**
   * Start the browser prewarming process
   * @private
   */
  _startPrewarming() {
    const interval = config.browser.prewarmInterval || 60000; // Default 1 minute
    
    setInterval(async () => {
      try {
        await this._prewarmBrowsers();
      } catch (error) {
        logger.error('Error during browser prewarming', {}, error);
      }
    }, interval);
    
    // Run initial prewarming
    this._prewarmBrowsers().catch(e => logger.error('Initial prewarming failed', {}, e));
  }
  
  /**
   * Prewarm browser instances during idle time
   * @private
   */
  async _prewarmBrowsers() {
    // Don't prewarm if already in progress
    if (this.prewarming) {
      return;
    }
    
    // Check if we need more browsers
    const targetPoolSize = Math.min(
      this.maxSessions, 
      config.browser.minPrewarmedInstances || 1
    );
    
    if (this.browsers.length >= targetPoolSize) {
      return; // Already have enough browsers
    }
    
    try {
      this.prewarming = true;
      
      // Store promise for waiting if needed
      this.prewarmingPromise = (async () => {
        logger.info('Prewarming browser instances', { target: targetPoolSize, current: this.browsers.length });
        
        const browsersToCreate = targetPoolSize - this.browsers.length;
        
        // Create browser instances
        for (let i = 0; i < browsersToCreate; i++) {
          try {
            // Launch with minimal options
            const browser = await chromium.launch({
              headless: true,
              args: [
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-setuid-sandbox',
                '--no-sandbox'
              ]
            });
            
            // Create a minimal context to fully initialize browser
            const context = await browser.newContext();
            const page = await context.newPage();
            
            // Navigate to about:blank to initialize browser fully
            await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
            
            // Close the page and context, keeping browser warm
            await page.close().catch(() => {});
            await context.close().catch(() => {});
            
            // Add to browser pool
            this.browsers.push(browser);
            
            // Set up closing event to clean up
            browser.on('disconnected', () => {
              this.browsers = this.browsers.filter(b => b !== browser);
              logger.debug('Prewarmed browser disconnected, removed from pool');
            });
            
            // Add metadata
            browser._createdAt = Date.now();
            browser._usageCount = 0;
            browser._prewarmed = true;
            
            logger.debug('Browser instance prewarmed', { index: i + 1, total: browsersToCreate });
          } catch (error) {
            logger.error('Failed to prewarm browser instance', { index: i + 1 }, error);
          }
        }
      })();
      
      await this.prewarmingPromise;
    } catch (error) {
      logger.error('Error during browser prewarming', {}, error);
    } finally {
      this.prewarming = false;
      this.prewarmingPromise = null;
    }
  }

  /**
   * Get a browser instance from the pool or create a new one
   * @param {Object} [launchOptions={}] - Browser launch options
   * @returns {Promise<import('playwright').Browser>} - Playwright browser instance
   */
  async getBrowser(launchOptions = {}) {
    try {
      // First perform health check
      await this._healthCheck();
      
      // Wait for prewarming to complete if in progress
      if (this.prewarming && this.prewarmingPromise) {
        await this.prewarmingPromise;
      }
      
      // Remove disconnected browsers
      this.browsers = this.browsers.filter(browser => {
        const isConnected = browser && browser.isConnected && browser.isConnected();
        if (!isConnected && browser) {
          try { browser.close().catch(() => {}); } catch {}
        }
        return isConnected;
      });
      
      // Check if browser rotation is needed
      const shouldRotate = this.browserRotationCounter >= this.browserRotationThreshold;
      
      // Reuse existing browser if available and rotation not needed
      if (!shouldRotate && this.browsers.length > 0) {
        // Sort browsers by usage count (use least used first)
        this.browsers.sort((a, b) => (a._usageCount || 0) - (b._usageCount || 0));
        
        const browser = this.browsers[0];
        
        // Update usage counter
        browser._usageCount = (browser._usageCount || 0) + 1;
        this.browserRotationCounter++;
        
        return browser;
      }
      
      // If we're rotating browsers, close the most used one
      if (shouldRotate && this.browsers.length > 0) {
        // Sort by usage count (descending)
        this.browsers.sort((a, b) => (b._usageCount || 0) - (a._usageCount || 0));
        
        // Close the most used browser
        try {
          const oldBrowser = this.browsers[0];
          logger.info('Rotating browser instance', { 
            usageCount: oldBrowser._usageCount,
            ageMs: Date.now() - (oldBrowser._createdAt || Date.now()) 
          });
          
          this.browsers = this.browsers.slice(1);
          await oldBrowser.close().catch(() => {});
        } catch (e) {
          // Ignore errors in rotation
        }
        
        // Reset counter
        this.browserRotationCounter = 0;
      }
      
      // Set default launch options
      const defaultOptions = {
        headless: true,
        args: [
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-sandbox',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-infobars',
          '--window-size=1366,768',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process'
        ],
        chromiumSandbox: false,
        ignoreHTTPSErrors: true,
        defaultViewport: { width: 1366, height: 768 },
        // Add Bright Data proxy configuration
        proxy: getProxySettings()
      };
      
      // Create new browser instance
      const browser = await chromium.launch({
        ...defaultOptions,
        ...launchOptions
      });
      
      this.browsers.push(browser);
      
      // Set up closing event to clean up
      browser.on('disconnected', () => {
        this.browsers = this.browsers.filter(b => b !== browser);
        logger.debug('Browser disconnected, removed from pool');
      });
      
      // Add metadata
      browser._createdAt = Date.now();
      browser._usageCount = 1;
      
      return browser;
    } catch (error) {
      logger.error('Error creating browser instance', {}, error);
      throw error;
    }
  }

  /**
   * Get or create a browser context with options
   * @param {import('playwright').Browser} browser - Playwright browser instance
   * @param {Object} [contextOptions={}] - Context options
   * @param {string} [targetUrl=null] - Target URL for domain-specific proxy selection
   * @returns {Promise<import('playwright').BrowserContext>} - Browser context
   */
  async getContext(browser, contextOptions = {}, targetUrl = null) {
    if (!browser || !(browser.isConnected && browser.isConnected())) {
      browser = await this.getBrowser();
    }
    
    try {
      // Generate a fingerprint for this context
      const fingerprint = generateBrowserFingerprint(targetUrl);
      
      // Merge options with defaults
      const mergedOptions = {
        userAgent: fingerprint.userAgent,
        viewport: fingerprint.viewport,
        deviceScaleFactor: fingerprint.deviceScaleFactor,
        locale: 'en-US',
        timezoneId: fingerprint.timezone,
        ...contextOptions
      };
      
      // Create context with cookies
      const context = await browser.newContext(mergedOptions);
      
      // Add device memory and hardware concurrency for consistent fingerprinting
      await context.addInitScript(fingerprint => {
        // Apply consistent fingerprint values
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => fingerprint.deviceMemory,
          configurable: true
        });
        
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => fingerprint.hardwareConcurrency,
          configurable: true
        });
        
        // Store fingerprint values for consistency across page lifecycle
        window._contextFingerprint = fingerprint;
      }, fingerprint);
      
      // Set consistent headers on all requests if enabled
      if (config.browser.enforceHeaderConsistency) {
        await context.route('**/*', async (route, request) => {
          const headers = request.headers();
          
          // Ensure consistent user-agent on all requests
          headers['user-agent'] = mergedOptions.userAgent;
          
          // Add common headers seen in real browsers
          headers['accept-language'] = 'en-US,en;q=0.9';
          headers['sec-ch-ua'] = `"Chromium";v="${fingerprint.browserVersion}", "Google Chrome";v="${fingerprint.browserVersion}"`;
          headers['sec-ch-ua-mobile'] = '?0';
          headers['sec-ch-ua-platform'] = `"${fingerprint.platform}"`;
          
          // Continue with modified headers
          await route.continue({ headers });
        });
      }
      
      // Store generated fingerprint on the context for later use
      context._fingerprint = fingerprint;
      
      // Store session ID and metadata
      context._sessionId = crypto.randomUUID();
      context._createdAt = Date.now();
      context._domain = targetUrl ? new URL(targetUrl).hostname : null;
      
      // Store the headers used for consistency checks
      this.sessionHeaders.set(context._sessionId, { 
        userAgent: mergedOptions.userAgent, 
        headers: { ...mergedOptions }
      });
      
      // Add to managed contexts
      this.contexts.push(context);
      
      // Clean up when context is closed
      context.on('close', () => {
        this.contexts = this.contexts.filter(c => c !== context);
        this.sessionHeaders.delete(context._sessionId);
        logger.debug('Context closed, removed from managed contexts');
      });
      
      return context;
    } catch (error) {
      logger.error('Error creating browser context', {}, error);
      throw error;
    }
  }

  /**
   * Setup resource optimization routes for a context
   * @param {import('playwright').BrowserContext} context - Browser context
   * @param {Object} options - Resource optimization options
   * @private
   */
  async _setupResourceOptimization(context, options = {}) {
    const defaultOptions = {
      blockAds: true,
      optimizeImages: true,
      blockTrackers: true,
      blockMedia: false,
      blockFonts: false,
      customPatterns: []
    };
    
    const opts = { ...defaultOptions, ...options };
    
    // Define patterns to block/optimize
    const patterns = [];
    
    if (opts.blockAds) {
      patterns.push(
        /.*\/ads\/.*/, 
        /.*\/adserve\/.*/, 
        /.*\/pagead\/.*/, 
        /.*\/googleads\/.*/,
        /.*doubleclick\.net\/.*/
      );
    }
    
    if (opts.blockTrackers) {
      patterns.push(
        /.*\/gtm\.js/,
        /.*\/analytics\.js/,
        /.*\/gtag\/js/,
        /.*\/pixel\.gif/,
        /.*\/collect.*/,
        /.*facebook\.com\/tr.*/
      );
    }
    
    if (opts.blockMedia) {
      patterns.push(
        /.*\.(mp4|avi|webm|ogg|mp3|wav|flac)$/
      );
    }
    
    if (opts.blockFonts) {
      patterns.push(
        /.*\.(woff|woff2|ttf|otf|eot)$/
      );
    }
    
    // Add custom patterns
    if (Array.isArray(opts.customPatterns)) {
      patterns.push(...opts.customPatterns);
    }
    
    // Setup route handlers for blocking
    if (patterns.length > 0) {
      await context.route(patterns, route => route.abort());
    }
    
    // Setup image optimization if enabled
    if (opts.optimizeImages) {
      await context.route(/.*\.(png|jpg|jpeg|gif|webp)$/, async (route) => {
        const request = route.request();
        const resourceType = request.resourceType();
        
        // Only optimize images that aren't critical
        if (resourceType === 'image') {
          // Check if this is likely a primary product image
          const url = request.url();
          if (url.includes('main') || url.includes('primary') || url.includes('hero')) {
            // Let important images load normally
            await route.continue();
            return;
          }
          
          // Let small images load normally (they're likely icons)
          if (request.headers()['content-length'] && 
              parseInt(request.headers()['content-length']) < 5000) {
            await route.continue();
            return;
          }
          
          // For other images, reduce quality
          await route.continue({
            headers: {
              ...request.headers(),
              'Accept': 'image/webp,image/avif,image/jxl,*/*;q=0.8' // Prefer optimized formats
            }
          });
        } else {
          await route.continue();
        }
      });
    }
  }
  
  /**
   * Setup routes to maintain header consistency
   * @param {import('playwright').BrowserContext} context - Browser context
   * @param {string} sessionId - Unique session ID
   * @private
   */
  async _setupHeaderConsistencyRoutes(context, sessionId) {
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      
      // Skip non-HTTP requests
      if (!url.startsWith('http')) {
        await route.continue();
        return;
      }
      
      // Get the original headers for this session
      const sessionData = this.sessionHeaders.get(sessionId);
      if (!sessionData) {
        await route.continue();
        return;
      }
      
      // Get current request headers
      const headers = request.headers();
      
      // Ensure user-agent consistency
      if (sessionData.userAgent && headers['user-agent'] !== sessionData.userAgent) {
        headers['user-agent'] = sessionData.userAgent;
      }
      
      // Ensure accept-language consistency
      if (sessionData.headers['Accept-Language'] && 
          headers['accept-language'] !== sessionData.headers['Accept-Language']) {
        headers['accept-language'] = sessionData.headers['Accept-Language'];
      }
      
      // Ensure consistent browser signature headers
      if (sessionData.headers['sec-ch-ua']) {
        headers['sec-ch-ua'] = sessionData.headers['sec-ch-ua'];
        headers['sec-ch-ua-mobile'] = sessionData.headers['sec-ch-ua-mobile'];
        headers['sec-ch-ua-platform'] = sessionData.headers['sec-ch-ua-platform'];
      }
      
      // Continue with consistent headers
      await route.continue({ headers });
    });
  }

  /**
   * Get a new page from a context
   * @param {import('playwright').BrowserContext} context - Browser context
   * @returns {Promise<import('playwright').Page>} - Playwright page
   */
  async getPage(context) {
    if (!context) {
      const browser = await this.getBrowser();
      context = await this.getContext(browser);
    }
    
    try {
      const page = await context.newPage();
      
      // Apply fingerprint from context if available
      if (context._fingerprint) {
        await antiDetection.applyAdvancedFingerprintEvasion(page, {
          deviceMemory: context._fingerprint.deviceMemory,
          hardwareConcurrency: context._fingerprint.hardwareConcurrency,
          screenResolution: {
            width: context._fingerprint.viewport.width,
            height: context._fingerprint.viewport.height
          },
          webglVendor: context._fingerprint.webglVendor,
          webglRenderer: context._fingerprint.webglRenderer
        });
      }
      
      // Add custom protocol handler for resource savings on image-heavy sites
      if (config.browser.resourceBlockingEnabled) {
        await page.route(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i, route => {
          // Check if we should block images
          if (context._options && context._options.blockImages) {
            return route.abort();
          }
          // Fallback to continuing the request
          return route.continue();
        });
      }
      
      // Store reference to parent context's proxy URL and domain
      if (context._proxyUrl) {
        page._proxyUrl = context._proxyUrl;
      }
      
      if (context._domain) {
        page._domain = context._domain;
      }
      
      // Copy session ID for tracking
      if (context._sessionId) {
        page._sessionId = context._sessionId;
      }
      
      // Add to managed pages
      this.pages.push(page);
      
      // Set up page closing event
      page.on('close', () => {
        this.pages = this.pages.filter(p => p !== page);
        logger.debug('Page closed, removed from managed pages');
      });
      
      return page;
    } catch (error) {
      logger.error('Error creating page', {}, error);
      throw error;
    }
  }

  /**
   * Report a proxy result based on a page session's success or failure
   * @param {import('playwright').Page} page - Playwright page
   * @param {boolean} success - Whether the operation was successful
   * @param {number} latency - Response time in ms
   */
  reportPageProxyResult(page, success, latency = 0) {
    if (page && page._proxyUrl && config.proxy.enabled) {
      const domain = page._domain || this._extractDomain(page.url());
      proxyManager.reportResult(page._proxyUrl, success, latency, domain);
      
      // Log detailed information about proxy performance
      if (!success) {
        logger.warn('Proxy failed for request', {
          proxy: page._proxyUrl,
          domain,
          latency
        });
      } else {
        logger.debug('Proxy succeeded for request', {
          proxy: page._proxyUrl,
          domain,
          latency
        });
      }
    }
  }

  /**
   * Extract domain from URL
   * @param {string} url - URL to extract domain from
   * @returns {string|null} - Domain name or null if invalid
   * @private
   */
  _extractDomain(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname;
    } catch (error) {
      return null;
    }
  }

  /**
   * Create a new browser context and page for a specific URL
   * @param {string} targetUrl - URL to optimize for
   * @param {Object} [contextOptions={}] - Context options
   * @returns {Promise<import('playwright').Page>} - Playwright page
   */
  async getOptimizedPage(targetUrl, contextOptions = {}) {
    const browser = await this.getBrowser();
    const context = await this.getContext(browser, contextOptions, targetUrl);
    const page = await this.getPage(context);
    return page;
  }

  /**
   * Clean up and close all browser resources
   * @returns {Promise<void>}
   */
  async closeAll() {
    // Close pages first
    for (const page of this.pages) {
      try {
        if (!page.isClosed()) {
          await page.close().catch(() => {});
        }
      } catch {}
    }
    this.pages = [];
    
    // Then close contexts
    for (const context of this.contexts) {
      try {
        await context.close().catch(() => {});
      } catch {}
    }
    this.contexts = [];
    
    // Finally close browsers
    for (const browser of this.browsers) {
      try {
        await browser.close().catch(() => {});
      } catch {}
    }
    this.browsers = [];
    
    // Clear session data
    this.sessionHeaders.clear();
    
    logger.info('Closed all browser resources');
  }

  /**
   * Get a random user agent from the configured list
   * @returns {string} - User agent string
   * @private
   */
  _getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  /**
   * Perform a health check on the browser pool
   * @returns {Promise<void>}
   * @private
   */
  async _healthCheck() {
    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckInterval) return;
    
    this.lastHealthCheck = now;
    
    try {
      // Check memory usage
      const mem = process.memoryUsage().rss / 1024 / 1024;
      if (mem > this.memoryLimitMB) {
        logger.warn(`Memory usage high (${Math.round(mem)}MB), restarting browser pool`);
        await this.closeAll();
        if (global.gc) global.gc();
      }
      
      // Check browsers
      for (const browser of [...this.browsers]) {
        if (!browser.isConnected || !browser.isConnected()) {
          logger.warn('Found disconnected browser, removing from pool');
          this.browsers = this.browsers.filter(b => b !== browser);
          try { await browser.close().catch(() => {}); } catch {}
        } else {
          // Check browser age - rotate browsers older than configured max age
          const browserAge = now - (browser._createdAt || now);
          const maxBrowserAge = config.browser.maxBrowserAge || 3600000; // Default 1 hour
          
          if (browserAge > maxBrowserAge) {
            logger.info('Rotating old browser instance', { ageMs: browserAge });
            this.browsers = this.browsers.filter(b => b !== browser);
            try { await browser.close().catch(() => {}); } catch {}
          }
        }
      }
      
      // Log browser pool stats
      logger.debug('Browser pool health check', {
        poolSize: this.browsers.length,
        activeSessions: this.activeSessions,
        managedContexts: this.contexts.length,
        managedPages: this.pages.length,
        memoryUsageMB: Math.round(mem)
      });
    } catch (error) {
      logger.error('Error during browser health check', {}, error);
    }
  }

  /**
   * Start the periodic health monitoring
   * @private
   */
  _startHealthMonitor() {
    // Use setInterval for periodic health checks
    setInterval(() => this._healthCheck(), this.healthCheckInterval);
    
    // Handle process exit to clean up resources
    process.on('exit', () => {
      try {
        // Synchronous close operations since process is exiting
        this.browsers.forEach(browser => {
          try { browser.close(); } catch {}
        });
      } catch {}
    });
  }
  
  /**
   * Create an isolated browser context that doesn't share any state
   * @param {Object} [contextOptions={}] - Context options
   * @returns {Promise<import('playwright').BrowserContext>} - Isolated browser context
   */
  async createIsolatedContext(contextOptions = {}) {
    try {
      // Always create a new browser instance for full isolation
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-sandbox',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ],
        // Add Bright Data proxy configuration
        proxy: getProxySettings()
      });
      
      // Create a context with default options
      const userAgent = this._getRandomUserAgent();
      const context = await browser.newContext({
        userAgent,
        viewport: { width: 1366, height: 768 },
        ...contextOptions
      });
      
      // Set timeouts
      context.setDefaultNavigationTimeout(config.browser.defaultNavigationTimeout);
      context.setDefaultTimeout(config.browser.defaultWaitTimeout);
      
      // Mark as isolated to handle differently
      context._isolated = true;
      context._browser = browser;
      
      // Set up cleanup when context is closed
      context.on('close', async () => {
        try {
          await browser.close().catch(() => {});
        } catch (e) {}
      });
      
      return context;
    } catch (error) {
      logger.error('Error creating isolated context', {}, error);
      throw error;
    }
  }

  /**
   * Get browser pool statistics
   * @returns {Object} - Browser statistics
   */
  getStats() {
    const now = Date.now();
    
    return {
      poolSize: this.browsers.length,
      activeSessions: this.activeSessions,
      totalContexts: this.contexts.length,
      totalPages: this.pages.length,
      browsers: this.browsers.map(browser => ({
        usageCount: browser._usageCount || 0,
        ageMs: now - (browser._createdAt || now),
        prewarmed: !!browser._prewarmed
      })),
      prewarming: this.prewarming,
      rotationCounter: this.browserRotationCounter,
      rotationThreshold: this.browserRotationThreshold
    };
  }
}

// Store fingerprints by domain for consistency in the same session
const fingerprints = new Map();

/**
 * Generate a consistent browser fingerprint for the session
 * @param {string} targetDomain - Target domain (for domain-specific settings)
 * @returns {Object} - Browser fingerprint configuration
 */
function generateBrowserFingerprint(targetDomain = null) {
  // Allow domain-specific fingerprints for consistent tracking
  const domainHash = targetDomain ? 
    crypto.createHash('md5').update(targetDomain).digest('hex').substring(0, 8) :
    null;
  
  // Use stored fingerprints if available
  if (domainHash && fingerprints.has(domainHash)) {
    return fingerprints.get(domainHash);
  }
  
  // Base configuration for fixed fingerprinting
  if (config.stealth?.browserFingerprint?.fixed && config.stealth?.browserFingerprint?.userAgent) {
    const fixedFingerprint = createFixedFingerprint();
    if (domainHash) {
      fingerprints.set(domainHash, fixedFingerprint);
    }
    return fixedFingerprint;
  }
  
  // Generate random but believable fingerprint
  const userAgents = config.browser.userAgents || [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  ];
  
  // Select a random user agent
  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  // Extract browser version from user agent
  const chromeVersionMatch = userAgent.match(/Chrome\/(\d+)/);
  const browserVersion = chromeVersionMatch ? chromeVersionMatch[1] : '116';
  
  // Determine platform from user agent
  const platform = userAgent.includes('Windows') ? 'Windows' : 
                  userAgent.includes('Mac') ? 'macOS' : 
                  'Linux';
                  
  // Generate viewport dimensions (common sizes with slight variations)
  let width, height;
  const screenType = Math.random();
  
  if (screenType < 0.6) {
    // Desktop (1920x1080, 1366x768, etc.)
    width = [1920, 1366, 1440, 1536, 1280][Math.floor(Math.random() * 5)];
    height = [1080, 900, 768, 864, 720][Math.floor(Math.random() * 5)];
  } else if (screenType < 0.85) {
    // Laptop (13"-15")
    width = 1280 + Math.floor(Math.random() * 300);
    height = 720 + Math.floor(Math.random() * 180);
  } else {
    // Large monitor
    width = 1920 + Math.floor(Math.random() * 1000);
    height = 1080 + Math.floor(Math.random() * 500);
  }
  
  // Create consistent viewport size (avoid odd numbers)
  width = Math.floor(width / 2) * 2;
  height = Math.floor(height / 2) * 2;
  
  // Generate timezone based on common values
  const timezones = [
    'America/New_York',
    'America/Los_Angeles',
    'America/Chicago',
    'Europe/London',
    'Europe/Paris',
    'Asia/Tokyo',
    'Australia/Sydney'
  ];
  
  const timezone = timezones[Math.floor(Math.random() * timezones.length)];
  
  // Create the fingerprint object
  const fingerprint = {
    userAgent,
    browserVersion,
    platform,
    deviceMemory: config.stealth?.deviceMemory || (Math.random() > 0.5 ? 8 : 4),
    hardwareConcurrency: config.stealth?.cpuCores || 4 + Math.floor(Math.random() * 4),
    viewport: { width, height },
    deviceScaleFactor: Math.random() > 0.1 ? 1 : 2,
    timezone,
    doNotTrack: Math.random() > 0.7 ? '1' : null,
    webglVendor: config.stealth?.vendor || 'Google Inc.',
    webglRenderer: config.stealth?.renderer || 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    maxTouchPoints: Math.random() > 0.7 ? 0 : 5,
    colorDepth: 24,
    sessionStorageSize: Math.floor(Math.random() * 10000000),
    localStorageSize: Math.floor(Math.random() * 10000000)
  };
  
  // Store fingerprint for domain consistency if applicable
  if (domainHash) {
    fingerprints.set(domainHash, fingerprint);
  }
  
  return fingerprint;
}

/**
 * Create a fixed fingerprint for complete consistency across sessions
 * @returns {Object} - Fixed browser fingerprint
 */
function createFixedFingerprint() {
  return {
    userAgent: config.stealth.browserFingerprint.userAgent,
    browserVersion: '116',
    platform: 'Windows',
    deviceMemory: 8,
    hardwareConcurrency: 8, 
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    timezone: 'America/New_York',
    doNotTrack: null,
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    maxTouchPoints: 0,
    colorDepth: 24,
    sessionStorageSize: 10000000,
    localStorageSize: 10000000
  };
}

module.exports = new BrowserService(); 