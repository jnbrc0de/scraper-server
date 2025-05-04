/**
 * Scraper Controller
 * Manages the scraping process and integrates all components
 */
const logger = require('../utils/logger');
const config = require('../config');
const { withRetry } = require('../utils/retry');
const browserService = require('../services/browser/browserService');
// Carrega os serviços de forma condicional para melhorar a performance
const captchaService = require('../services/captcha/captchaService');
const proxyManager = require('../services/proxy/proxyManager');
const cacheService = require('../services/cache/cacheService');
const adapterFactory = require('../adapters/AdapterFactory');
const TaskQueue = require('../services/queue/taskQueue');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Tentativa de carregar serviços opcionais
let emailService = null;
let supabaseService = null;

try {
  emailService = require('../services/notification/emailService');
} catch (e) {
  // Fallback para serviço de email mock
  emailService = {
    enabled: false,
    sendFailureNotification: async () => {},
    sendSuccessNotification: async () => {}
  };
  logger.info('Email service not available, using mock');
}

try {
  supabaseService = require('../services/database/supabaseService');
} catch (e) {
  // Fallback para serviço de database mock
  supabaseService = {
    isInitialized: () => false,
    initialize: () => {},
    upsertScrapeCache: async () => {},
    logScraperSuccess: async () => {},
    logScraperError: async () => {},
    getCachedScrape: async () => null
  };
  logger.info('Database service not available, using mock');
}

class ScraperController {
  constructor() {
    this.initialized = false;
    this.initializePromise = null;
    this.activeScrapeTasks = new Set();
    this.totalScrapesCompleted = 0;
    this.lastMemoryCheck = Date.now();
    this.memoryCheckInterval = 60000; // 1 minuto
    this.memoryLimit = config.browser.memoryLimitMB || 2048; // 2GB default
    this.setupMemoryMonitoring();
  }

  /**
   * Configura monitoramento de memória para evitar vazamentos
   */
  setupMemoryMonitoring() {
    setInterval(() => {
      try {
        this.checkMemoryUsage();
      } catch (error) {
        logger.error('Error in memory monitoring', {}, error);
      }
    }, this.memoryCheckInterval);
  }

  /**
   * Verifica e gerencia o uso de memória
   */
  checkMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    const usedMemoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
    
    logger.debug('Memory usage check', {
      usedMemoryMB,
      heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      activeScrapeTasks: this.activeScrapeTasks.size,
      totalCompleted: this.totalScrapesCompleted
    });
    
    // Se memoria estiver acima do limite, força coleta de lixo e libera recursos
    if (usedMemoryMB > this.memoryLimit) {
      logger.warn('Memory usage exceeded limit, releasing resources', {
        usedMemoryMB,
        limit: this.memoryLimit
      });
      
      // Force garbage collection if available (node --expose-gc)
      if (global.gc) {
        logger.info('Running garbage collection');
        global.gc();
      }
      
      // Fecha recursos do browser para liberar memória
      browserService.closeAll().catch(e => 
        logger.error('Error closing browsers during memory cleanup', {}, e)
      );
    }
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
        
        // Create captchas directory if it doesn't exist
        const captchasDir = path.resolve(process.cwd(), 'captchas');
        await fs.mkdir(captchasDir, { recursive: true }).catch(() => {});
        
        // Initialize proxy manager
        await proxyManager.initialize();
        
        // Initialize Supabase
        if (supabaseService && config.database.supabaseUrl && config.database.supabaseAnonKey) {
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
    
    // Gera um ID único para esta tarefa de scraping
    const scrapeId = crypto.randomBytes(8).toString('hex');
    
    const startTime = Date.now();
    const scrapeContext = {
      id: scrapeId,
      url,
      startTime,
      success: false,
      cached: false,
      price: null,
      title: null,
      attempts: 0,
      errors: []
    };
    
    // Registra esta tarefa como ativa
    this.activeScrapeTasks.add(scrapeId);
    
    logger.info('Starting price scraping', { url, scrapeId });
    
    try {
      // 1. Check cache first
      if (config.cache.enabled) {
        const cachedData = await this._checkCache(url);
        if (cachedData) {
          logger.info('Returning cached price data', { 
            url, 
            price: cachedData.price,
            age: Math.round((Date.now() - new Date(cachedData.scraped_at).getTime()) / 1000) + 's',
            scrapeId
          });
          
          // Remove dos jobs ativos e incrementa contador
          this.activeScrapeTasks.delete(scrapeId);
          this.totalScrapesCompleted++;
          
          return {
            success: true,
            cached: true,
            price: cachedData.price,
            title: cachedData.title || null,
            availability: cachedData.availability,
            url,
            scrapeId
          };
        }
      }
      
      // 2. Check if we have an adapter for this URL
      const adapter = adapterFactory.getAdapter(url);
      if (!adapter) {
        const error = new Error(`No adapter found for URL: ${url}`);
        throw error;
      }
      
      // Adiciona timeout global para evitar que a operação fique presa
      const timeoutPromise = new Promise((_, reject) => {
        const timeout = config.browser.globalScrapeTimeout || 60000; // 1 minuto por padrão
        setTimeout(() => {
          reject(new Error(`Global scrape timeout exceeded (${timeout}ms)`));
        }, timeout);
      });
      
      // 3. Perform the scraping with retry logic
      const scrapePromise = withRetry(
        async (attempt) => {
          scrapeContext.attempts = attempt + 1;
          return this._performScrape(url, adapter, scrapeContext);
        },
        {
          retries: config.browser.retries,
          baseDelay: config.browser.baseRetryDelay,
          operationName: 'Scraping price',
          context: { url, scrapeId }
        }
      );
      
      // Espera o scrape ou o timeout, o que vier primeiro
      const result = await Promise.race([scrapePromise, timeoutPromise]);
      
      // 4. Record success and save to cache
      const duration = Date.now() - startTime;
      logger.info('Successfully scraped price', { 
        url, 
        price: result.price,
        duration: `${duration}ms`,
        scrapeId
      });
      
      // Store in database cache
      if (supabaseService.isInitialized()) {
        await supabaseService.upsertScrapeCache({
          url,
          price: result.price,
          title: result.title,
          availability: result.availability,
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
            availability: result.availability,
            cached: false,
            scraped_at: new Date().toISOString()
          });
        }
      }
      
      // Incrementa contador e libera a tarefa
      this.activeScrapeTasks.delete(scrapeId);
      this.totalScrapesCompleted++;
      
      return {
        success: true,
        cached: false,
        price: result.price,
        title: result.title,
        availability: result.availability,
        url,
        scrapeId,
        durationMs: duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to scrape price', { 
        url, 
        attempts: scrapeContext.attempts,
        duration: `${duration}ms`,
        scrapeId
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
      
      // Limpa a tarefa do registro
      this.activeScrapeTasks.delete(scrapeId);
      this.totalScrapesCompleted++;
      
      return {
        success: false,
        cached: false,
        error: error.message,
        url,
        scrapeId,
        durationMs: duration
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
    
    // Limita a concorrência baseado na memória disponível
    const memoryUsage = process.memoryUsage();
    const usedMemoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
    const maxConcurrencyByMemory = Math.max(
      1, 
      Math.floor((this.memoryLimit - usedMemoryMB) / 200) // Estima ~200MB por processo
    );
    
    // Ajusta a concorrência se necessário
    const adjustedConcurrency = Math.min(concurrency, maxConcurrencyByMemory);
    if (adjustedConcurrency < concurrency) {
      logger.warn('Adjusting concurrency due to memory constraints', {
        requested: concurrency,
        adjusted: adjustedConcurrency,
        memoryUsedMB: usedMemoryMB,
        memoryLimitMB: this.memoryLimit
      });
    }
    
    const queue = new TaskQueue(adjustedConcurrency);
    const startTime = Date.now();
    
    logger.info(`Starting batch scrape of ${urls.length} URLs with concurrency ${adjustedConcurrency}`);
    
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
      logger.debug('Getting optimized page for URL', { url, scrapeId: context.id });
      
      // Adiciona timeout para a obtenção da página
      const pagePromise = browserService.getOptimizedPage(url);
      const timeoutPromise = new Promise((_, reject) => {
        const timeout = config.browser.pageCreationTimeout || 30000; // 30 segundos por padrão
        setTimeout(() => {
          reject(new Error(`Page creation timeout exceeded (${timeout}ms)`));
        }, timeout);
      });
      
      page = await Promise.race([pagePromise, timeoutPromise]);
      
      // 2. Track proxy used (if any)
      if (page._proxyUrl) {
        context.proxyUsed = page._proxyUrl;
        context.domain = page._domain || new URL(url).hostname;
        logger.debug('Using proxy for domain', { 
          proxy: context.proxyUsed, 
          domain: context.domain,
          scrapeId: context.id
        });
      }
      
      // Define limites de timeout para os recursos
      await page.setDefaultNavigationTimeout(config.browser.defaultNavigationTimeout || 30000);
      await page.setDefaultTimeout(config.browser.defaultElementTimeout || 10000);
      
      // Set up request monitoring for predictive captcha detection
      await page.route('**/*', async (route) => {
        navigationHistory.requestCount++;
        navigationHistory.lastRequestTime = Date.now();
        navigationHistory.timeframe = navigationHistory.lastRequestTime - navigationHistory.startTime;
        await route.continue();
      });
      
      // 3. Navigate to URL with timeout
      logger.debug('Navigating to URL', { url, scrapeId: context.id });
      
      const navStartTime = Date.now();
      
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: config.browser.defaultNavigationTimeout || 30000
        });
      } catch (navigationError) {
        // Tentativa de recuperação se a página estiver parcialmente carregada
        if (navigationError.message.includes('timeout')) {
          logger.warn('Navigation timeout, attempting to continue with partially loaded page', { 
            url, 
            scrapeId: context.id
          });
          
          // Verifica se a página carregou o mínimo necessário
          const isPageUsable = await page.evaluate(() => {
            return document.body && document.body.innerHTML.length > 0;
          }).catch(() => false);
          
          if (!isPageUsable) {
            throw navigationError; // Realmente não conseguiu carregar
          }
          
          // Senão continua com o que temos
          logger.info('Continuing with partially loaded page', { url, scrapeId: context.id });
        } else {
          throw navigationError;
        }
      }
      
      const navDuration = Date.now() - navStartTime;
      logger.debug('Navigation completed', { 
        url, 
        durationMs: navDuration,
        requests: navigationHistory.requestCount,
        scrapeId: context.id
      });
      
      // 4. Check for predictive captcha patterns before actual detection
      if (config.captcha.predictiveDetection) {
        const predictedCaptcha = await captchaService.predictCaptcha(page, navigationHistory);
        if (predictedCaptcha) {
          logger.info('Predictive captcha detection triggered, performing preemptive solving', 
            { url, requestCount: navigationHistory.requestCount, scrapeId: context.id });
            
          // Try to preemptively solve potential captcha
          const solved = await captchaService.solveWithExternalService(page);
          if (solved) {
            logger.info('Preemptively solved captcha successfully', { url, scrapeId: context.id });
          }
        }
      }
      
      // 5. Check for blocks or captchas
      const blocked = await adapter.isBlocked(page);
      if (blocked) {
        logger.warn('Page appears to be blocked, checking for captcha', { url, scrapeId: context.id });
        
        // Check for captcha
        const hasCaptcha = await captchaService.detectCaptcha(page);
        if (hasCaptcha) {
          logger.warn('Captcha detected, attempting to solve', { url, scrapeId: context.id });
          
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
            const captchaDir = path.resolve(process.cwd(), 'captchas');
            await fs.mkdir(captchaDir, { recursive: true }).catch(() => {});
            
            context.screenshot = path.resolve(
              captchaDir, 
              `manual-${context.id}-${Date.now()}.png`
            );
            await page.screenshot({ path: context.screenshot });
            
            logger.info('Captcha saved for manual resolution', { 
              url, 
              screenshot: context.screenshot,
              scrapeId: context.id
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
              `captcha-${context.id}-${Date.now()}.png`
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
            `blocked-${context.id}-${Date.now()}.png`
          );
          await page.screenshot({ path: context.screenshot });
          
          // Report proxy failure if page is blocked
          if (context.proxyUsed) {
            browserService.reportPageProxyResult(page, false, Date.now() - navStartTime);
          }
          
          throw new Error('Access blocked by website');
        }
      }
      
      // 6. After handling any blocks or captchas, run the extraction
      logger.debug('Extracting data using adapter', { 
        adapter: adapter.constructor.name, 
        url, 
        scrapeId: context.id 
      });
      
      // Implement retries for extraction with exponential backoff
      const maxExtractionAttempts = 3;
      let extractionResult = null;
      let extractionError = null;
      
      for (let attempt = 1; attempt <= maxExtractionAttempts; attempt++) {
        try {
          const extractionStartTime = Date.now();
          
          // Run the extraction with timeout protection
          const extractionPromise = adapter.extract(page);
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Extraction timeout exceeded (${config.adapter.extractionTimeout || 45000}ms)`));
            }, config.adapter.extractionTimeout || 45000); // 45 segundos timeout padrão
          });
          
          extractionResult = await Promise.race([extractionPromise, timeoutPromise]);
          const extractionDuration = Date.now() - extractionStartTime;
          
          logger.debug('Data extraction completed', { 
            url, 
            durationMs: extractionDuration,
            attempt,
            success: !!extractionResult,
            scrapeId: context.id
          });
          
          // Validate extraction result
          if (!extractionResult || 
              (extractionResult.price === undefined && extractionResult.price === null)) {
            throw new Error('Invalid extraction result: missing price');
          }
          
          // Success!
          context.attempts = attempt;
          break;
        } catch (error) {
          extractionError = error;
          logger.warn(`Extraction attempt ${attempt} failed`, { 
            url, 
            error: error.message,
            scrapeId: context.id 
          });
          
          // If this is not the last attempt, wait before trying again
          if (attempt < maxExtractionAttempts) {
            // Exponential backoff: 2^attempt * 1000ms + small random jitter
            const backoffTime = (Math.pow(2, attempt) * 1000) + (Math.random() * 1000);
            logger.debug(`Retrying extraction in ${Math.round(backoffTime)}ms`, { 
              url,
              attempt,
              scrapeId: context.id 
            });
            
            await new Promise(resolve => setTimeout(resolve, backoffTime));
            
            // Refresh page before retrying if needed
            if (error.message.includes('timeout') || error.message.includes('detached')) {
              logger.debug('Refreshing page before retry', { url, scrapeId: context.id });
              await page.reload({ waitUntil: 'domcontentloaded' })
                .catch(e => logger.warn('Page refresh failed', { error: e.message }));
              
              // Re-run pre-processing after refresh
              await adapter.preProcess(page)
                .catch(e => logger.warn('Pre-processing after refresh failed', { error: e.message }));
            }
          }
        }
      }
      
      // If all extraction attempts failed, throw the last error
      if (!extractionResult) {
        if (extractionError) {
          context.errors.push(extractionError.message);
          throw extractionError;
        }
        throw new Error('Data extraction failed after multiple attempts');
      }
      
      // Capture a screenshot if configured
      if (config.screenshots.enabled) {
        const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
        await fs.mkdir(screenshotsDir, { recursive: true }).catch(() => {});
        
        context.screenshot = path.resolve(
          screenshotsDir, 
          `${context.id}-${Date.now()}.png`
        );
        
        await page.screenshot({ 
          path: context.screenshot,
          fullPage: config.screenshots.fullPage
        }).catch(e => {
          logger.warn('Failed to capture screenshot', { url, error: e.message });
        });
      }
      
      // Report proxy success if used
      if (context.proxyUsed) {
        browserService.reportPageProxyResult(page, true, Date.now() - navigationHistory.startTime);
      }
      
      // Extract essential data from result
      const result = {
        price: extractionResult.price,
        title: extractionResult.title || null,
        availability: extractionResult.availability !== undefined ? 
                      extractionResult.availability : true,
        metadata: {
          adapter: adapter.constructor.name,
          url: url,
          domain: context.domain,
          extractionTime: Date.now() - context.startTime,
          extracted: Object.keys(extractionResult)
        }
      };
      
      // Close page to free resources
      await page.close().catch(() => {});
      
      return result;
    } catch (error) {
      // Report proxy failure if used
      if (context.proxyUsed) {
        browserService.reportPageProxyResult(page, false, Date.now() - navigationHistory.startTime);
      }
      
      // Try to capture error screenshot if configured
      if (config.screenshots.enabled && config.screenshots.captureOnError) {
        try {
          const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
          await fs.mkdir(screenshotsDir, { recursive: true }).catch(() => {});
          
          context.screenshot = path.resolve(
            screenshotsDir, 
            `error-${context.id}-${Date.now()}.png`
          );
          
          await page.screenshot({ 
            path: context.screenshot,
            fullPage: config.screenshots.fullPage
          });
        } catch (screenshotError) {
          logger.warn('Failed to capture error screenshot', { 
            url, 
            error: screenshotError.message
          });
        }
      }
      
      // Close page to free resources
      await page.close().catch(() => {});
      
      throw error;
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
   * Retorna estatísticas do scraper controller
   * @returns {Object} - Estatísticas
   */
  getStats() {
    return {
      activeScrapeTasks: this.activeScrapeTasks.size,
      totalScrapesCompleted: this.totalScrapesCompleted,
      memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptime: process.uptime()
    };
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
      
      // Clean temporary files if needed
      this.cleanupTempFiles().catch(e => 
        logger.warn('Error cleaning up temporary files', {}, e)
      );
      
      logger.info('Scraper controller shut down successfully');
    } catch (error) {
      logger.error('Error shutting down scraper controller', {}, error);
    }
  }
  
  /**
   * Limpa arquivos temporários antigos (screenshots, logs, etc)
   */
  async cleanupTempFiles() {
    try {
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 dias
      
      // Limpa screenshots antigos
      const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
      const screenshots = await fs.readdir(screenshotsDir);
      
      for (const file of screenshots) {
        try {
          const filePath = path.join(screenshotsDir, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
          }
        } catch (e) {
          // Ignora erros individuais
        }
      }
      
      // Limpa captchas antigos
      const captchasDir = path.resolve(process.cwd(), 'captchas');
      const captchas = await fs.readdir(captchasDir);
      
      for (const file of captchas) {
        try {
          const filePath = path.join(captchasDir, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
          }
        } catch (e) {
          // Ignora erros individuais
        }
      }
      
      logger.info('Temporary files cleanup completed');
    } catch (error) {
      logger.error('Error during temporary files cleanup', {}, error);
    }
  }
}

// Export singleton instance
module.exports = new ScraperController(); 