/**
 * Base Scraper Adapter
 * Provides common functionality for all scraper implementations with advanced error handling
 */
const browserService = require('../../services/browser/browserService');
const retryService = require('../../services/retry/retryService');
const logger = require('../../utils/logger');
const crypto = require('crypto');
const antiDetection = require('../../utils/antiDetection');
const performanceOptimizer = require('../../utils/performanceOptimizer');
const ConnectionPool = require('../../utils/connectionPool');

// Create a shared connection pool
const connectionPool = new ConnectionPool({
  minConnections: 2,
  maxConnections: 10,
  idleTimeout: 60000,
  maxUsageCount: 100
});

class BaseScraperAdapter {
  constructor(options = {}) {
    this.options = {
      maxRetries: 3,
      timeout: 30000,
      waitForNavigation: true,
      waitUntil: 'domcontentloaded',
      humanEmulation: true, // Enable human-like behavior by default
      
      // Performance optimization options
      optimizeRequests: options.optimizeRequests !== false,
      blockMedia: options.blockMedia !== false,
      blockNonEssentialImages: options.blockNonEssentialImages !== false,
      useDomSnapshot: options.useDomSnapshot || false,
      disableJavaScript: options.disableJavaScript || false,
      useConnectionPool: options.useConnectionPool !== false,
      
      ...options
    };
    
    // Generate session ID for this adapter instance
    this.sessionId = crypto.randomUUID();
    
    // Request timing metrics
    this.metrics = {
      requestStartTime: 0,
      navigationTimes: [],
      extractionTimes: [],
      totalRequestTime: 0
    };
    
    // Store DOM snapshots for lightweight access
    this.domSnapshots = new Map();
  }
  
  /**
   * Initialize a browser and page for scraping
   * @param {Object} options - Browser initialization options
   * @returns {Promise<Object>} - Browser context object
   */
  async initializeBrowser(options = {}) {
    const startTime = Date.now();
    this.metrics.requestStartTime = startTime;
    
    // Check if JavaScript is required for the target site
    const disableJavaScript = this.options.disableJavaScript;
    if (options.targetUrl && disableJavaScript) {
      // Override if the specific site requires JavaScript
      if (performanceOptimizer.isJavaScriptRequired(options.targetUrl)) {
        logger.info('JavaScript required for this site, enabling', { url: options.targetUrl });
        options.contextOptions = {
          ...options.contextOptions,
          javaScriptEnabled: true
        };
      } else {
        // Disable JavaScript for better performance if configured
        options.contextOptions = {
          ...options.contextOptions,
          javaScriptEnabled: false
        };
      }
    }
    
    // Use connection pool if enabled
    let browser, context, page;
    
    if (this.options.useConnectionPool) {
      try {
        const connection = await connectionPool.getConnection();
        browser = connection.browser;
        
        // Create a new context for isolation
        context = await browserService.getContext(browser, options.contextOptions, options.targetUrl);
        page = await browserService.getPage(context);
        
        // Store connection reference
        this.connection = connection;
      } catch (error) {
        // Fall back to direct browser creation if pool fails
        logger.warn('Connection pool error, falling back to direct browser creation', {}, error);
        browser = await browserService.getBrowser();
        context = await browserService.getContext(browser, options.contextOptions, options.targetUrl);
        page = await browserService.getPage(context);
      }
    } else {
      // Direct browser creation without pooling
      browser = await browserService.getBrowser();
      context = await browserService.getContext(browser, options.contextOptions, options.targetUrl);
      page = await browserService.getPage(context);
    }
    
    // Store references
    this.browser = browser;
    this.context = context;
    this.page = page;
    
    // Set up standard options
    if (options.timeout || this.options.timeout) {
      page.setDefaultTimeout(options.timeout || this.options.timeout);
      page.setDefaultNavigationTimeout(options.timeout || this.options.timeout);
    }
    
    // Set up page error handling
    page.on('pageerror', error => {
      logger.warn('Page error', { url: page.url() }, error);
    });
    
    // Apply enhanced fingerprint evasion if enabled
    if (this.options.humanEmulation) {
      await antiDetection.applyAdvancedFingerprintEvasion(page, options.fingerprintOptions);
    }
    
    // Apply request optimization if enabled
    if (this.options.optimizeRequests) {
      await this._setupRequestOptimization(page, options.targetUrl);
    }
    
    // Track performance
    this.metrics.initializationTime = Date.now() - startTime;
    
    return { browser, context, page };
  }
  
  /**
   * Set up request optimization filters
   * @param {import('playwright').Page} page - Playwright page
   * @param {string} targetUrl - Target URL for domain extraction
   * @private
   */
  async _setupRequestOptimization(page, targetUrl) {
    // Get target domain for request filtering
    const allowedDomains = [];
    if (targetUrl) {
      try {
        const targetDomain = new URL(targetUrl).hostname;
        allowedDomains.push(targetDomain);
      } catch (e) {
        // Invalid URL, won't add to allowed domains
      }
    }
    
    // Create request filter from performance optimizer
    const requestFilter = performanceOptimizer.createRequestFilter({
      blockImages: this.options.blockNonEssentialImages,
      blockMedia: this.options.blockMedia,
      blockFonts: false, // Keep fonts for visual integrity
      blockStyles: false, // Keep styles for visual integrity
      allowedDomains: allowedDomains.length > 0 ? allowedDomains : undefined
    });
    
    // Apply request interception
    await page.route('**/*', async (route) => {
      const request = route.request();
      
      // Check if the request should be allowed
      if (requestFilter(request)) {
        await route.continue();
      } else {
        await route.abort('blockedbyclient');
      }
    });
    
    logger.debug('Request optimization enabled', { 
      blockMedia: this.options.blockMedia,
      blockNonEssentialImages: this.options.blockNonEssentialImages,
      allowedDomains
    });
  }
  
  /**
   * Navigate to a URL with retry logic
   * @param {string} url - URL to navigate to
   * @param {Object} options - Navigation options
   * @returns {Promise<Object>} - Navigation result
   */
  async navigateTo(url, options = {}) {
    const navigateStartTime = Date.now();
    
    const navigateOptions = {
      waitUntil: options.waitUntil || this.options.waitUntil,
      timeout: options.timeout || this.options.timeout
    };
    
    // Check if browser is initialized
    if (!this.page) {
      await this.initializeBrowser({ targetUrl: url });
    }
    
    // Create context object for retry service
    const context = {
      url,
      page: this.page,
      browser: this.browser,
      sessionId: this.sessionId
    };
    
    // Execute with retry logic
    const result = await retryService.withRetry(async (state) => {
      const page = state.page || this.page;
      
      // Apply any state transformations from fallback strategies
      if (state.simplified) {
        logger.info('Using simplified navigation', { url });
        navigateOptions.waitUntil = 'domcontentloaded';
      }
      
      if (state.timeoutMultiplier) {
        navigateOptions.timeout = navigateOptions.timeout * state.timeoutMultiplier;
      }
      
      // Navigate to URL
      const response = await page.goto(url, navigateOptions);
      
      // Check for common error responses
      if (response) {
        const status = response.status();
        if (status >= 400) {
          // For 4xx/5xx responses, throw an error to trigger retry
          const html = await page.content().catch(() => '');
          throw new Error(`HTTP error ${status} on ${url}: ${html.substring(0, 100)}`);
        }
      }
      
      // Wait for any additional selectors if configured
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { 
          timeout: navigateOptions.timeout 
        });
      }
      
      // Simulate human-like page interaction if enabled
      if (this.options.humanEmulation && !state.simplified) {
        await this._simulateHumanInteraction(page, options.interactionOptions);
      }
      
      // For session resurrection, save important state
      const sessionState = {
        url,
        cookies: await this.page.context().cookies().catch(() => []),
        timestamp: Date.now()
      };
      
      // If DOM snapshots are enabled, capture a snapshot
      if (this.options.useDomSnapshot) {
        const snapshot = await this._captureDomSnapshot(page);
        if (snapshot) {
          this.domSnapshots.set(url, {
            snapshot,
            timestamp: Date.now()
          });
        }
      }
      
      // Return page content and response info
      return {
        page,
        response,
        url: page.url(),
        sessionState
      };
    }, {
      maxRetries: options.maxRetries || this.options.maxRetries,
      context,
      sessionId: this.sessionId,
      initialState: {
        page: this.page
      }
    });
    
    // Track performance metrics
    const navigationTime = Date.now() - navigateStartTime;
    this.metrics.navigationTimes.push(navigationTime);
    this.metrics.totalRequestTime += navigationTime;
    
    return result;
  }
  
  /**
   * Capture a lightweight DOM snapshot for efficient data access
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<Object>} - DOM snapshot
   * @private
   */
  async _captureDomSnapshot(page) {
    try {
      const snapshotFunction = performanceOptimizer.createDomSnapshotFunction();
      return await snapshotFunction(page);
    } catch (error) {
      logger.warn('Failed to capture DOM snapshot', {}, error);
      return null;
    }
  }
  
  /**
   * Get a DOM snapshot if available
   * @param {string} url - URL to get snapshot for
   * @returns {Object|null} - DOM snapshot or null if not available
   */
  getDomSnapshot(url) {
    const snapshotData = this.domSnapshots.get(url);
    if (!snapshotData) return null;
    
    // Check if snapshot is fresh enough (10 minutes)
    const isFresh = Date.now() - snapshotData.timestamp < 10 * 60 * 1000;
    return isFresh ? snapshotData.snapshot : null;
  }
  
  /**
   * Simulate human-like interaction with the page
   * @param {import('playwright').Page} page - Playwright page 
   * @param {Object} options - Interaction options
   * @private
   */
  async _simulateHumanInteraction(page, options = {}) {
    // Default interaction options
    const interactionOptions = {
      scrollDepth: options?.scrollDepth || 0.6,
      interactionTime: options?.interactionTime || 3000,
      readingMode: options?.readingMode !== undefined ? options.readingMode : Math.random() > 0.3,
      moveCursor: options?.moveCursor !== undefined ? options.moveCursor : true,
      interactionPoints: options?.interactionPoints || []
    };
    
    await antiDetection.simulateHumanPageInteraction(page, interactionOptions);
  }
  
  /**
   * Extract data from the page
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} - Extracted data
   */
  async extractData(options = {}) {
    const extractionStartTime = Date.now();
    
    if (!this.page) {
      throw new Error('Browser not initialized. Call initializeBrowser() first');
    }
    
    // Create context object for retry service
    const context = {
      url: this.page.url(),
      page: this.page,
      browser: this.browser,
      sessionId: this.sessionId
    };
    
    // Check if we can use a DOM snapshot instead of live DOM
    let snapshot = null;
    if (this.options.useDomSnapshot) {
      snapshot = this.getDomSnapshot(this.page.url());
      
      // If we have a fresh snapshot and extraction is simple, use it directly
      if (snapshot && options.useSnapshotIfAvailable !== false && 
          !options.requiresLiveDOM && !options.requiresJavaScript) {
        logger.debug('Using DOM snapshot for extraction', { url: this.page.url() });
        
        try {
          const data = this._extractFromSnapshot(snapshot, options);
          
          // Track performance
          const extractionTime = Date.now() - extractionStartTime;
          this.metrics.extractionTimes.push(extractionTime);
          this.metrics.totalRequestTime += extractionTime;
          
          return {
            data,
            url: this.page.url(),
            timestamp: Date.now(),
            fromSnapshot: true
          };
        } catch (error) {
          // If snapshot extraction fails, fall back to live DOM
          logger.warn('Snapshot extraction failed, falling back to live DOM', {}, error);
        }
      }
    }
    
    // Execute with retry logic
    const result = await retryService.withRetry(async (state) => {
      const page = state.page || this.page;
      
      // Apply any state transformations from fallback strategies
      if (state.useAlternativeParser) {
        logger.info('Using alternative parser for extraction', { url: page.url() });
        return this._extractWithAlternativeMethod(page, options);
      }
      
      // Simulate human interaction before extraction if enabled
      if (this.options.humanEmulation && state.enhancedStealth) {
        // If we're in enhanced stealth mode, do more realistic interactions
        await this._simulateHumanInteraction(page, {
          scrollDepth: 0.7,
          interactionTime: 5000 + Math.random() * 3000,
          readingMode: true
        });
      }
      
      // Extract data based on selectors
      const extractedData = {};
      
      if (options.selectors) {
        for (const [key, selector] of Object.entries(options.selectors)) {
          try {
            if (typeof selector === 'string') {
              // Simple text content extraction
              extractedData[key] = await page.$eval(selector, el => el.textContent.trim())
                .catch(() => null);
            } else if (typeof selector === 'object') {
              // Complex extraction with type
              extractedData[key] = await this._extractComplexSelector(page, selector);
            }
          } catch (error) {
            logger.debug(`Failed to extract ${key}`, { selector }, error);
            extractedData[key] = null;
          }
        }
      }
      
      // Validate extracted data if validation function provided
      if (options.validateData && typeof options.validateData === 'function') {
        const isValid = options.validateData(extractedData);
        if (!isValid) {
          throw new Error('Data validation failed');
        }
      }
      
      return {
        data: extractedData,
        url: page.url(),
        timestamp: Date.now(),
        sessionState: {
          url: page.url(),
          timestamp: Date.now()
        }
      };
    }, {
      maxRetries: options.maxRetries || this.options.maxRetries,
      context,
      sessionId: this.sessionId,
      initialState: {
        page: this.page
      }
    });
    
    // Track performance
    const extractionTime = Date.now() - extractionStartTime;
    this.metrics.extractionTimes.push(extractionTime);
    this.metrics.totalRequestTime += extractionTime;
    
    // Update performance optimizer metrics
    performanceOptimizer.recordSuccess(
      this.metrics.totalRequestTime,
      Date.now() - this.metrics.requestStartTime
    );
    
    // If DOM snapshots are enabled and we don't have one yet, capture it now
    if (this.options.useDomSnapshot && !snapshot) {
      this._captureDomSnapshot(this.page).then(newSnapshot => {
        if (newSnapshot) {
          this.domSnapshots.set(this.page.url(), {
            snapshot: newSnapshot,
            timestamp: Date.now()
          });
        }
      }).catch(() => {/* Ignore errors */});
    }
    
    return result;
  }
  
  /**
   * Extract data from a DOM snapshot
   * @param {Object} snapshot - DOM snapshot
   * @param {Object} options - Extraction options
   * @returns {Object} - Extracted data
   * @private
   */
  _extractFromSnapshot(snapshot, options) {
    const extractedData = {};
    
    if (!options.selectors) return extractedData;
    
    // Helper function to query the snapshot DOM
    const querySnapshot = (selector, node = snapshot.root) => {
      if (!node || !node.children) return null;
      
      // Simple implementation - for production use a more robust CSS selector engine
      // This is a basic implementation for common simple selectors
      
      // Match current node
      if (selector.startsWith('#') && node.attributes && node.attributes.id === selector.substring(1)) {
        return node;
      }
      
      if (selector.startsWith('.') && node.attributes && node.attributes.class && 
          node.attributes.class.split(' ').includes(selector.substring(1))) {
        return node;
      }
      
      if (!selector.includes('.') && !selector.includes('#') && 
          node.tagName === selector.toLowerCase()) {
        return node;
      }
      
      // Search children recursively
      for (const child of node.children) {
        const result = querySnapshot(selector, child);
        if (result) return result;
      }
      
      return null;
    };
    
    for (const [key, selector] of Object.entries(options.selectors)) {
      try {
        if (typeof selector === 'string') {
          // Simple text content extraction
          const element = querySnapshot(selector);
          extractedData[key] = element ? element.textContent.trim() : null;
        } else if (typeof selector === 'object') {
          // For complex selectors, just store null and let live DOM handle it later
          extractedData[key] = null;
        }
      } catch (error) {
        extractedData[key] = null;
      }
    }
    
    return extractedData;
  }
  
  /**
   * Extract data using fallback regex method when DOM selectors fail
   * @param {import('playwright').Page} page - Playwright page
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} - Extracted data
   * @private
   */
  async _extractWithAlternativeMethod(page, options) {
    // Get the page HTML
    const html = await page.content();
    const extractedData = {};
    
    // Extract data using regex patterns
    if (options.selectors) {
      for (const [key, selector] of Object.entries(options.selectors)) {
        try {
          if (typeof selector === 'string') {
            // Convert CSS selector to regex pattern
            const regex = this._selectorToRegex(selector);
            const match = html.match(regex);
            extractedData[key] = match && match[1] ? match[1].trim() : null;
          } else if (typeof selector === 'object') {
            // Handle complex selectors using regex
            const baseRegex = this._selectorToRegex(selector.selector);
            const match = html.match(baseRegex);
            
            if (match && match[1]) {
              if (selector.type === 'html') {
                extractedData[key] = match[1];
              } else if (selector.type === 'attribute' && selector.attribute) {
                // Extract attribute value with regex
                const attrRegex = new RegExp(`${selector.selector}[^>]*${selector.attribute}=["']([^"']*)["']`);
                const attrMatch = html.match(attrRegex);
                extractedData[key] = attrMatch && attrMatch[1] ? attrMatch[1] : null;
              } else if (selector.type === 'list') {
                // For lists, extract all matches
                const globalRegex = new RegExp(baseRegex.source, 'g');
                extractedData[key] = [];
                let match;
                while ((match = globalRegex.exec(html)) !== null) {
                  if (match[1]) extractedData[key].push(match[1].trim());
                }
              } else {
                extractedData[key] = match[1].trim();
              }
            } else {
              extractedData[key] = null;
            }
          }
        } catch (error) {
          extractedData[key] = null;
        }
      }
    }
    
    return {
      data: extractedData,
      url: page.url(),
      timestamp: Date.now(),
      alternativeMethod: true
    };
  }
  
  /**
   * Convert CSS selector to regex pattern
   * @param {string} selector - CSS selector
   * @returns {RegExp} - Regex pattern
   * @private
   */
  _selectorToRegex(selector) {
    // Very simple conversion, can be enhanced for better matching
    const simplifiedSelector = selector.replace(/[#.]/g, '').split(' ').pop();
    return new RegExp(`<[^>]*class=['"]?[^'"]*${simplifiedSelector}[^'"]*['"]?[^>]*>(.*?)<\/`, 'i');
  }
  
  /**
   * Extract data using complex selector options
   * @param {import('playwright').Page} page - Playwright page
   * @param {Object} selectorOptions - Complex selector options
   * @returns {Promise<any>} - Extracted data
   * @private
   */
  async _extractComplexSelector(page, selectorOptions) {
    if (selectorOptions.type === 'attribute' && selectorOptions.selector && selectorOptions.attribute) {
      const element = await page.$(selectorOptions.selector);
      if (element) {
        return await element.getAttribute(selectorOptions.attribute);
      }
    } else if (selectorOptions.type === 'list' && selectorOptions.selector) {
      const elements = await page.$$(selectorOptions.selector);
      const results = [];
      
      for (const element of elements) {
        if (selectorOptions.childSelector) {
          const childElement = await element.$(selectorOptions.childSelector);
          if (childElement) {
            results.push(await childElement.textContent());
          }
        } else {
          results.push(await element.textContent());
        }
      }
      
      return results.map(item => item.trim());
    } else if (selectorOptions.type === 'html' && selectorOptions.selector) {
      const element = await page.$(selectorOptions.selector);
      if (element) {
        return await element.innerHTML();
      }
    }
    
    return null;
  }
  
  /**
   * Perform an action on the page with retry logic
   * @param {Function} action - Action to perform
   * @param {Object} options - Action options
   * @returns {Promise<any>} - Action result
   */
  async performAction(action, options = {}) {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initializeBrowser() first');
    }
    
    // Create context object for retry service
    const context = {
      url: this.page.url(),
      page: this.page,
      browser: this.browser,
      sessionId: this.sessionId,
      actionName: options.actionName || 'unknown'
    };
    
    // Execute with retry logic
    return retryService.withRetry(async (state) => {
      const page = state.page || this.page;
      
      // Apply enhanced human behavior if requested by fallback strategies
      if (state.enhancedStealth && state.evasionTechniques?.emulateHumanBehavior) {
        await this._emulateHumanBehavior(page);
      }
      
      // Execute the action
      const result = await action(page, state);
      
      // Save session state for resurrection
      const sessionState = {
        url: page.url(),
        timestamp: Date.now(),
        actionPerformed: options.actionName
      };
      
      return {
        result,
        sessionState
      };
    }, {
      maxRetries: options.maxRetries || this.options.maxRetries,
      context,
      sessionId: this.sessionId,
      initialState: {
        page: this.page
      }
    });
  }
  
  /**
   * Fill form fields with realistic human typing
   * @param {Object} formData - Field selectors and values to fill
   * @param {Object} options - Form filling options
   * @returns {Promise<void>}
   */
  async fillForm(formData, options = {}) {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initializeBrowser() first');
    }
    
    const useHumanTyping = this.options.humanEmulation && 
                          options.humanTyping !== false;
    
    // Process each form field
    for (const [selector, value] of Object.entries(formData)) {
      try {
        // Find the element
        const element = await this.page.$(selector);
        if (!element) {
          logger.warn(`Form field not found: ${selector}`);
          continue;
        }
        
        if (useHumanTyping) {
          // Use realistic typing simulation
          await antiDetection.simulateRealisticTyping(this.page, selector, value, {
            minDelay: options.minTypeDelay || 30,
            maxDelay: options.maxTypeDelay || 100,
            mistakeProbability: options.mistakeProbability || 0.05
          });
        } else {
          // Use standard typing for speed
          await element.fill(value);
        }
        
        // Add a small pause between fields
        await this.page.waitForTimeout(options.fieldDelay || 
          (useHumanTyping ? 300 + Math.random() * 500 : 100));
      } catch (error) {
        logger.warn(`Error filling form field ${selector}`, {}, error);
      }
    }
    
    // If submit selector is provided, click it
    if (options.submitSelector) {
      try {
        const submitButton = await this.page.$(options.submitSelector);
        if (submitButton) {
          if (this.options.humanEmulation) {
            // Move mouse to button first
            const boundingBox = await submitButton.boundingBox();
            if (boundingBox) {
              await antiDetection.simulateRealisticMouseMovement(this.page, {
                x: boundingBox.x + boundingBox.width / 2,
                y: boundingBox.y + boundingBox.height / 2
              });
              
              // Add slight pause before clicking (as humans would)
              await this.page.waitForTimeout(200 + Math.random() * 300);
              
              // Click the button
              await this.page.mouse.click(
                boundingBox.x + boundingBox.width / 2,
                boundingBox.y + boundingBox.height / 2
              );
            }
          } else {
            // Standard click
            await submitButton.click();
          }
          
          // Wait for navigation if needed
          if (options.waitForNavigation !== false) {
            await this.page.waitForNavigation({ 
              waitUntil: options.waitUntil || 'domcontentloaded' 
            }).catch(() => {});
          }
        }
      } catch (error) {
        logger.warn('Error submitting form', {}, error);
      }
    }
  }
  
  /**
   * Emulate human-like behavior on page
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<void>}
   * @private
   */
  async _emulateHumanBehavior(page) {
    await antiDetection.simulateHumanPageInteraction(page, {
      scrollDepth: 0.6 + Math.random() * 0.3,
      interactionTime: 2000 + Math.random() * 4000,
      readingMode: Math.random() > 0.3,
      moveCursor: true
    });
  }
  
  /**
   * Close browser and clean up resources
   */
  async close() {
    // If using connection pool, release connection
    if (this.connection && this.options.useConnectionPool) {
      try {
        // Close context only, not the browser
        if (this.context) {
          await this.context.close();
        }
        connectionPool.releaseConnection(this.connection);
        
        // Clear references
        this.browser = null;
        this.context = null;
        this.page = null;
        this.connection = null;
        
        return;
      } catch (error) {
        logger.warn('Error releasing connection to pool', {}, error);
        // Fall through to standard close below
      }
    }
    
    // Standard cleanup if not using pool or pool release failed
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch (error) {
      logger.warn('Error closing browser', {}, error);
    } finally {
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
  
  /**
   * Get performance metrics
   * @returns {Object} - Performance metrics
   */
  getMetrics() {
    const navigationAvg = this.metrics.navigationTimes.length > 0 ?
      this.metrics.navigationTimes.reduce((a, b) => a + b, 0) / this.metrics.navigationTimes.length : 0;
      
    const extractionAvg = this.metrics.extractionTimes.length > 0 ?
      this.metrics.extractionTimes.reduce((a, b) => a + b, 0) / this.metrics.extractionTimes.length : 0;
    
    return {
      ...this.metrics,
      averageNavigationTime: navigationAvg,
      averageExtractionTime: extractionAvg,
      totalTime: Date.now() - this.metrics.requestStartTime,
      poolStats: this.options.useConnectionPool ? connectionPool.getStats() : null,
      optimizerStats: performanceOptimizer.getMetrics()
    };
  }
}

/**
 * Get the shared connection pool instance
 * @returns {ConnectionPool} - Connection pool
 */
BaseScraperAdapter.getConnectionPool = () => connectionPool;

module.exports = BaseScraperAdapter; 