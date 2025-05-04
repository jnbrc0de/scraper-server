/**
 * Scraper Controller
 * Manages the scraping process and integrates all components
 */
const logger = require('../utils/logger');
const config = require('../config');
const { withRetry } = require('../utils/retry');
const browserService = require('../services/browser/browserService');
// Temporarily commented out services to debug
// const captchaService = require('../services/captcha/captchaService');
const proxyManager = require('../services/proxy/proxyManager');
const cacheService = require('../services/cache/cacheService');
const adapterFactory = require('../adapters/AdapterFactory');
// const emailService = require('../services/notification/emailService');
// const supabaseService = require('../services/database/supabaseService');
const TaskQueue = require('../services/queue/taskQueue');
const fs = require('fs').promises;
const path = require('path');

// Create mockup services to prevent errors
const captchaService = {
  solveRecaptchaV2: async () => ({ token: 'mock-token' }),
  solveImageCaptcha: async () => 'mock-solution',
  getHarvestedToken: () => null,
  submitForManualResolution: async () => ({ id: 'mock-id' }),
  checkManualSolution: () => null
};

const emailService = {
  enabled: false,
  sendFailureNotification: async () => {},
  sendSuccessNotification: async () => {}
};

const supabaseService = {
  isInitialized: () => false,
  initialize: () => {},
  upsertScrapeCache: async () => {},
  logScraperSuccess: async () => {},
  logScraperError: async () => {}
};

class ScraperController {
  constructor() {
    this.initialized = false;
    this.initializePromise = null;
  }

  /**
   * Initialize the scraper controller and all required services
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;
    
    // Prevent multiple simultaneous initialization
    if (this.initializePromise) {
      return this.initializePromise;
    }
    
    this.initializePromise = (async () => {
      logger.info('Initializing scraper controller');
      
      try {
        // Create logs directory if it doesn't exist
        const logsDir = path.resolve(process.cwd(), 'logs');
        await fs.mkdir(logsDir, { recursive: true }).catch(() => {});
        
        // Create screenshots directory if it doesn't exist
        const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
        await fs.mkdir(screenshotsDir, { recursive: true }).catch(() => {});
        
        // Initialize proxy manager
        await proxyManager.initialize();
        
        // Initialize Supabase
        if (config.database.supabaseUrl && config.database.supabaseAnonKey) {
          supabaseService.initialize();
        }
        
        this.initialized = true;
        logger.info('Scraper controller initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize scraper controller', {}, error);
        throw error;
      } finally {
        this.initializePromise = null;
      }
    })();
    
    return this.initializePromise;
  }

  /**
   * Get price for a URL
   * @param {string} url - URL to scrape price from
   * @returns {Promise<Object>} - Scraping result
   */
  async scrapePrice(url) {
    // Ensure controller is initialized
    if (!this.initialized) {
      await this.initialize();
    }
    
    const startTime = Date.now();
    const scrapeContext = {
      url,
      startTime,
      success: false,
      cached: false,
      price: null,
      title: null,
      attempts: 0,
      errors: []
    };
    
    logger.info('Starting price scraping', { url });
    
    try {
      // 1. Check cache first
      if (config.cache.enabled) {
        const cachedData = await this._checkCache(url);
        if (cachedData) {
          logger.info('Returning cached price data', { 
            url, 
            price: cachedData.price,
            age: Math.round((Date.now() - new Date(cachedData.scraped_at).getTime()) / 1000) + 's'
          });
          
          return {
            success: true,
            cached: true,
            price: cachedData.price,
            title: cachedData.title || null,
            url
          };
        }
      }
      
      // 2. Check if we have an adapter for this URL
      const adapter = adapterFactory.getAdapter(url);
      if (!adapter) {
        const error = new Error(`No adapter found for URL: ${url}`);
        throw error;
      }
      
      // 3. Perform the scraping with retry logic
      const result = await withRetry(
        async (attempt) => {
          scrapeContext.attempts = attempt + 1;
          return this._performScrape(url, adapter, scrapeContext);
        },
        {
          retries: config.browser.retries,
          baseDelay: config.browser.baseRetryDelay,
          operationName: 'Scraping price',
          context: { url }
        }
      );
      
      // 4. Record success and save to cache
      const duration = Date.now() - startTime;
      logger.info('Successfully scraped price', { 
        url, 
        price: result.price,
        duration: `${duration}ms` 
      });
      
      // Store in database cache
      if (supabaseService.isInitialized()) {
        await supabaseService.upsertScrapeCache({
          url,
          price: result.price,
          title: result.title,
          cached: false
        });
        
        // Log success
        await supabaseService.logScraperSuccess({
          url,
          price: result.price,
          durationMs: duration,
          proxyUsed: result.proxyUsed
        });
      }
      
      // Store in memory cache
      if (config.cache.enabled) {
        const cacheKey = cacheService.createKey('price', url);
        if (cacheKey) {
          cacheService.set(cacheKey, {
            price: result.price,
            title: result.title,
            cached: false,
            scraped_at: new Date().toISOString()
          });
        }
      }
      
      return {
        success: true,
        cached: false,
        price: result.price,
        title: result.title,
        availability: result.availability,
        url
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to scrape price', { 
        url, 
        attempts: scrapeContext.attempts,
        duration: `${duration}ms` 
      }, error);
      
      // Log error to database
      if (supabaseService.isInitialized()) {
        await supabaseService.logScraperError({
          url,
          error: error.message,
          proxyUsed: scrapeContext.proxyUsed
        });
      }
      
      // Send failure notification if enabled
      if (emailService.enabled && scrapeContext.screenshot) {
        await emailService.sendFailureNotification({
          url,
          reason: [error.message, ...scrapeContext.errors],
          screenshotPath: scrapeContext.screenshot
        });
      }
      
      return {
        success: false,
        cached: false,
        error: error.message,
        url
      };
    }
  }

  /**
   * Scrape multiple URLs in parallel
   * @param {Array<string>} urls - URLs to scrape
   * @param {number} [concurrency=5] - Maximum concurrent scrapes
   * @returns {Promise<Array<Object>>} - Array of scraping results
   */
  async scrapeMultiple(urls, concurrency = config.browser.maxConcurrency) {
    // Ensure controller is initialized
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (!Array.isArray(urls) || urls.length === 0) {
      return [];
    }
    
    const queue = new TaskQueue(concurrency);
    const startTime = Date.now();
    
    logger.info(`Starting batch scrape of ${urls.length} URLs with concurrency ${concurrency}`);
    
    // Create task functions for each URL
    const tasks = urls.map(url => async () => {
      return this.scrapePrice(url);
    });
    
    // Execute tasks with the queue
    try {
      const results = await TaskQueue.runAll(tasks);
      
      const duration = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;
      
      logger.info(`Completed batch scrape`, {
        total: urls.length,
        success: successCount,
        failed: urls.length - successCount,
        duration: `${duration}ms`,
        avgTimePerUrl: `${Math.round(duration / urls.length)}ms`
      });
      
      return results;
    } catch (error) {
      logger.error('Error in batch scrape operation', {}, error);
      throw error;
    }
  }

  /**
   * Perform the actual scraping for a URL
   * @param {string} url - URL to scrape
   * @param {Object} adapter - Adapter to use for scraping
   * @param {Object} context - Scraping context
   * @returns {Promise<Object>} - Scraping result
   * @private
   */
  async _performScrape(url, adapter, context) {
    let browser = null;
    let browserContext = null;
    let page = null;
    
    // Initialize navigation history tracking
    const navigationHistory = {
      requestCount: 0,
      startTime: Date.now(),
      lastRequestTime: null,
      timeframe: 0
    };
    
    try {
      // 1. Get optimized page for the target URL (includes browser and context)
      logger.debug('Getting optimized page for URL', { url });
      page = await browserService.getOptimizedPage(url);
      
      // 2. Track proxy used (if any)
      if (page._proxyUrl) {
        context.proxyUsed = page._proxyUrl;
        context.domain = page._domain || new URL(url).hostname;
        logger.debug('Using proxy for domain', { 
          proxy: context.proxyUsed, 
          domain: context.domain 
        });
      }
      
      // Set up request monitoring for predictive captcha detection
      await page.route('**/*', async (route) => {
        navigationHistory.requestCount++;
        navigationHistory.lastRequestTime = Date.now();
        navigationHistory.timeframe = navigationHistory.lastRequestTime - navigationHistory.startTime;
        await route.continue();
      });
      
      // 3. Navigate to URL with timeout
      logger.debug('Navigating to URL', { url });
      
      const navStartTime = Date.now();
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: config.browser.defaultNavigationTimeout
      });
      
      const navDuration = Date.now() - navStartTime;
      logger.debug('Navigation completed', { 
        url, 
        durationMs: navDuration,
        requests: navigationHistory.requestCount
      });
      
      // 4. Check for predictive captcha patterns before actual detection
      if (config.captcha.predictiveDetection) {
        const predictedCaptcha = await captchaService.predictCaptcha(page, navigationHistory);
        if (predictedCaptcha) {
          logger.info('Predictive captcha detection triggered, performing preemptive solving', 
            { url, requestCount: navigationHistory.requestCount });
            
          // Try to preemptively solve potential captcha
          const solved = await captchaService.solveWithExternalService(page);
          if (solved) {
            logger.info('Preemptively solved captcha successfully', { url });
          }
        }
      }
      
      // 5. Check for blocks or captchas
      const blocked = await adapter.isBlocked(page);
      if (blocked) {
        logger.warn('Page appears to be blocked, checking for captcha', { url });
        
        // Check for captcha
        const hasCaptcha = await captchaService.detectCaptcha(page);
        if (hasCaptcha) {
          logger.warn('Captcha detected, attempting to solve', { url });
          
          // Try to bypass captcha
          let bypassSuccessful = false;
          
          // First try without external service
          bypassSuccessful = await captchaService.bypassWithoutService(page);
          
          // If that fails, try with service if configured
          if (!bypassSuccessful && captchaService.apiKey) {
            bypassSuccessful = await captchaService.solveWithExternalService(page);
          }
          
          // If still not successful and manual resolution is enabled, save for human resolution
          if (!bypassSuccessful && config.captcha.manualResolutionEnabled) {
            context.screenshot = path.resolve(
              process.cwd(), 
              'captchas', 
              `manual-${Date.now()}.png`
            );
            await page.screenshot({ path: context.screenshot });
            
            logger.info('Captcha saved for manual resolution', { 
              url, 
              screenshot: context.screenshot 
            });
            
            // Report proxy failure if captcha could not be bypassed
            if (context.proxyUsed) {
              browserService.reportPageProxyResult(page, false, Date.now() - navStartTime);
            }
            
            throw new Error('Captcha requires manual resolution');
          }
          
          if (!bypassSuccessful) {
            // Take screenshot of the captcha page
            context.screenshot = path.resolve(
              process.cwd(), 
              'screenshots', 
              `captcha-${Date.now()}.png`
            );
            await page.screenshot({ path: context.screenshot });
            
            // Report proxy failure if captcha could not be bypassed
            if (context.proxyUsed) {
              browserService.reportPageProxyResult(page, false, Date.now() - navStartTime);
            }
            
            throw new Error('Failed to bypass captcha');
          }
        } else {
          // Take screenshot of the blocked page
          context.screenshot = path.resolve(
            process.cwd(), 
            'screenshots', 
            `blocked-${Date.now()}.png`
          );
          await page.screenshot({ path: context.screenshot });
          
          // Report proxy failure if page is blocked
          if (context.proxyUsed) {
            browserService.reportPageProxyResult(page, false, Date.now() - navStartTime);
          }
          
          throw new Error('Access blocked by website');
        }
      }
      
      // 6. Run adapter pre-processing
      await adapter.preProcess(page);
      
      // 7. Extract data with the adapter
      logger.debug('Extracting data using adapter', { 
        adapter: adapter.constructor.name, 
        url 
      });
      
      const extractionStartTime = Date.now();
      const extractedData = await adapter.extract(page);
      const extractionDuration = Date.now() - extractionStartTime;
      
      logger.debug('Data extraction completed', {
        url,
        durationMs: extractionDuration
      });
      
      // 8. Validate extracted data
      if (!extractedData || extractedData.price === null || extractedData.price === undefined) {
        // Take screenshot of the page that failed extraction
        context.screenshot = path.resolve(
          process.cwd(), 
          'screenshots', 
          `extraction-failed-${Date.now()}.png`
        );
        await page.screenshot({ path: context.screenshot });
        
        throw new Error('Failed to extract price from page');
      }
      
      // Report successful proxy usage if applicable
      if (context.proxyUsed) {
        browserService.reportPageProxyResult(page, true, Date.now() - context.startTime);
      }
      
      return {
        price: extractedData.price,
        title: extractedData.title,
        availability: extractedData.availability,
        proxyUsed: context.proxyUsed,
        domain: context.domain
      };
    } catch (error) {
      // Report proxy failure if applicable
      if (context.proxyUsed) {
        browserService.reportPageProxyResult(page, false);
      }
      
      // Enhance error object with context for better debugging
      error.navigationHistory = navigationHistory;
      error.context = {
        url,
        scrapeAttempt: context.attempts,
        timestamp: Date.now()
      };
      
      // Add context to the error
      context.errors.push(error.message);
      
      // Take screenshot of error page if not already taken
      if (!context.screenshot && page) {
        try {
          context.screenshot = path.resolve(
            process.cwd(), 
            'screenshots', 
            `error-${Date.now()}.png`
          );
          await page.screenshot({ path: context.screenshot });
        } catch (e) {
          // Ignore screenshot errors
        }
      }
      
      throw error;
    } finally {
      // Clean up resources
      if (page) {
        try {
          await page.close().catch(() => {});
        } catch (e) {}
      }
      
      if (browserContext) {
        try {
          await browserContext.close().catch(() => {});
        } catch (e) {}
      }
    }
  }

  /**
   * Check if a result is available in cache
   * @param {string} url - URL to check cache for
   * @returns {Promise<Object|null>} - Cached data or null
   * @private
   */
  async _checkCache(url) {
    // First check memory cache
    const cacheKey = cacheService.createKey('price', url);
    if (cacheKey) {
      const memCache = cacheService.get(cacheKey);
      if (memCache) {
        return memCache;
      }
    }
    
    // Then check database cache
    if (supabaseService.isInitialized()) {
      return await supabaseService.getCachedScrape(url);
    }
    
    return null;
  }

  /**
   * Gracefully shut down the scraper and clean up resources
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('Shutting down scraper controller');
    
    try {
      // Close all browser instances
      await browserService.closeAll();
      
      logger.info('Scraper controller shut down successfully');
    } catch (error) {
      logger.error('Error shutting down scraper controller', {}, error);
    }
  }
}

// Export singleton instance
module.exports = new ScraperController(); 