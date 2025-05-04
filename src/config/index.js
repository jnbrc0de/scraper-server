/**
 * Configuration Module
 * Centralizes all configuration from environment variables
 */
require('dotenv').config();

module.exports = {
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    timeout: parseInt(process.env.SERVER_TIMEOUT || '300000', 10), // 5 minutes - increased for complex scraping
    keepAliveTimeout: parseInt(process.env.KEEP_ALIVE_TIMEOUT || '65000', 10), // 65 seconds
    headersTimeout: parseInt(process.env.HEADERS_TIMEOUT || '66000', 10), // 66 seconds
  },

  // Browser configuration
  browser: {
    poolSize: parseInt(process.env.BROWSER_POOL_SIZE || '4', 10), // Increased pool size
    maxConcurrency: parseInt(process.env.MAX_CONCURRENT_SCRAPES || '8', 10), // Optimized for throughput
    defaultNavigationTimeout: parseInt(process.env.NAVIGATION_TIMEOUT || '45000', 10), // Increased for reliability
    defaultElementTimeout: parseInt(process.env.WAIT_TIMEOUT || '15000', 10), // Increased for reliability
    pageCreationTimeout: parseInt(process.env.PAGE_CREATION_TIMEOUT || '30000', 10), // Increased for reliability
    globalScrapeTimeout: parseInt(process.env.GLOBAL_SCRAPE_TIMEOUT || '120000', 10), // Increased for complex sites
    retries: parseInt(process.env.SCRAPE_RETRIES || '5', 10), // More retries for resilience
    baseRetryDelay: parseInt(process.env.BASE_RETRY_DELAY || '2000', 10),
    maxRetryDelay: parseInt(process.env.MAX_RETRY_DELAY || '30000', 10), // Increased for rate limiting cases
    memoryLimitMB: parseInt(process.env.MEMORY_LIMIT_MB || '3072', 10), // Increased for better performance
    // Browser stealth options - all enabled by default for better detection avoidance
    useStealth: process.env.USE_STEALTH !== 'false',
    randomizeUserAgent: process.env.RANDOMIZE_USER_AGENT !== 'false', // Enable by default
    randomize: {
      viewport: process.env.RANDOMIZE_VIEWPORT !== 'false', // Enable by default
      webgl: process.env.RANDOMIZE_WEBGL !== 'false', // Enable by default
      timezone: process.env.RANDOMIZE_TIMEZONE !== 'false', // Enable by default
    },
    // Enhanced resource management
    closeInactiveBrowsers: process.env.CLOSE_INACTIVE_BROWSERS !== 'false',
    browserInactiveTimeout: parseInt(process.env.BROWSER_INACTIVE_TIMEOUT || '300000', 10), // 5 minutes
    rotationThreshold: parseInt(process.env.BROWSER_ROTATION_THRESHOLD || '50', 10), // Rotation after 50 uses
    prewarmEnabled: process.env.BROWSER_PREWARM !== 'false', // Enable browser prewarming by default
    prewarmInterval: parseInt(process.env.BROWSER_PREWARM_INTERVAL || '120000', 10), // 2 minutes
  },

  // Proxy configuration
  proxy: {
    enabled: process.env.USE_PROXIES !== 'false', // Enable by default for production
    rotationStrategy: process.env.PROXY_ROTATION_STRATEGY || 'performance', // Use performance-based rotation by default
    // Proxy service specific options
    proxyFile: process.env.PROXY_FILE,
    // Circuit breaker options
    circuitBreakerThreshold: parseInt(process.env.PROXY_CIRCUIT_BREAKER_THRESHOLD || '3', 10), // More sensitive
    circuitBreakerResetTime: parseInt(process.env.PROXY_CIRCUIT_BREAKER_RESET_TIME || '300000', 10), // 5 minutes
    // Domain-specific options
    storeDomainPerformance: process.env.STORE_DOMAIN_PERFORMANCE !== 'false',
    domainRotationEnabled: process.env.DOMAIN_ROTATION_ENABLED !== 'false', // Enable by default
    proxyRetries: parseInt(process.env.PROXY_RETRIES || '3', 10),
    rotateOnStatusCodes: process.env.ROTATE_ON_STATUS_CODES || '403,429,503', // Rotate on these status codes
    proxyHealthCheckInterval: parseInt(process.env.PROXY_HEALTH_CHECK_INTERVAL || '600000', 10), // 10 minutes
  },

  // Screenshot configuration
  screenshots: {
    enabled: process.env.SCREENSHOTS_ENABLED !== 'false',
    captureOnError: process.env.CAPTURE_ERROR_SCREENSHOTS !== 'false',
    fullPage: process.env.FULL_PAGE_SCREENSHOTS === 'true',
    maxScreenshots: parseInt(process.env.MAX_SCREENSHOTS || '1000', 10), // Limit total screenshot count
    cleanupOlderThan: parseInt(process.env.CLEANUP_SCREENSHOTS_OLDER_THAN || '604800000', 10), // 7 days
  },

  // Email notification config
  email: {
    enabled: process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true',
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    notifyOnSuccess: process.env.NOTIFY_ON_SUCCESS === 'true',
    notifyOnFailure: process.env.NOTIFY_ON_FAILURE === 'true',
  },

  // Captcha configuration
  captcha: {
    service: process.env.CAPTCHA_SERVICE, // null, '2captcha', 'capmonster', etc.
    apiKey: process.env.CAPTCHA_API_KEY,
    bypassAttempts: parseInt(process.env.CAPTCHA_BYPASS_ATTEMPTS || '3', 10),
    // Enhanced captcha settings
    tokenHarvesting: process.env.CAPTCHA_TOKEN_HARVESTING !== 'false', // Enable by default
    harvestInterval: parseInt(process.env.CAPTCHA_HARVEST_INTERVAL || '300000', 10), // 5 minutes
    manualResolutionEnabled: process.env.MANUAL_CAPTCHA_RESOLUTION === 'true',
    manualResolutionWebhook: process.env.MANUAL_CAPTCHA_WEBHOOK,
    ocrEnabled: process.env.OCR_ENABLED !== 'false', // Enable OCR by default
    predictiveDetection: process.env.PREDICTIVE_CAPTCHA !== 'false', // Enable by default
    captchaTimeout: parseInt(process.env.CAPTCHA_SOLVING_TIMEOUT || '180000', 10), // 3 minutes
    balanceCheckInterval: parseInt(process.env.CAPTCHA_BALANCE_CHECK_INTERVAL || '3600000', 10), // 1 hour
  },

  // Cache configuration
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    ttl: parseInt(process.env.CACHE_TTL || '14400', 10), // Default 4 hours - reduced for fresher data
    maxEntries: parseInt(process.env.CACHE_MAX_ENTRIES || '25000', 10), // Increased cache size
    persistToDisk: process.env.CACHE_PERSIST_TO_DISK !== 'false', // Enable by default
    cacheDir: process.env.CACHE_DIR || './cache',
    compressionEnabled: process.env.CACHE_COMPRESSION !== 'false', // Enable compression by default
    refreshThreshold: parseInt(process.env.CACHE_REFRESH_THRESHOLD || '10800', 10), // Refresh after 3 hours
  },

  // Database configuration
  database: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    connectionPool: parseInt(process.env.DB_CONNECTION_POOL || '10', 10), // Connection pool size
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000', 10), // 10 seconds
  },
  
  // Adapter configuration
  adapter: {
    extractionTimeout: parseInt(process.env.ADAPTER_EXTRACTION_TIMEOUT || '60000', 10), // Increased to 60s
    enabled: process.env.ADAPTERS_ENABLED !== 'false',
    checkCache: process.env.ADAPTER_CHECK_CACHE !== 'false',
    returnOnlyValidCache: process.env.RETURN_ONLY_VALID_CACHE !== 'false',
    maxExtractionRetries: parseInt(process.env.MAX_EXTRACTION_RETRIES || '3', 10),
    useGenericFallback: process.env.USE_GENERIC_FALLBACK !== 'false',
    preProcessTimeout: parseInt(process.env.PRE_PROCESS_TIMEOUT || '20000', 10), // Increased timeout
    forceRefreshOnError: process.env.FORCE_REFRESH_ON_ERROR !== 'false', // Enable by default
    adaptiveExtraction: process.env.ADAPTIVE_EXTRACTION !== 'false', // Enable adaptive extraction by default
    parallelExtraction: process.env.PARALLEL_EXTRACTION !== 'false', // Enable parallel extraction
  },
  
  // Resiliência e monitoramento
  resilience: {
    circuitBreakerEnabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
    fallbackToCachedOnError: process.env.FALLBACK_TO_CACHED_ON_ERROR !== 'false',
    maxFailuresBeforeAlert: parseInt(process.env.MAX_FAILURES_BEFORE_ALERT || '10', 10),
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '300000', 10), // 5 min
    maxErrors: parseInt(process.env.MAX_ERRORS_BEFORE_RESTART || '50', 10),
    errorThresholdPeriod: parseInt(process.env.ERROR_THRESHOLD_PERIOD || '3600000', 10), // 1 hour
    automaticRecovery: process.env.AUTOMATIC_RECOVERY !== 'false', // Enable auto recovery
    gracefulShutdown: process.env.GRACEFUL_SHUTDOWN !== 'false', // Enable graceful shutdown
    errorClassification: process.env.ERROR_CLASSIFICATION !== 'false', // Enable error classification
  },
  
  // Performance optimization
  performance: {
    optimizeResourceLoading: process.env.OPTIMIZE_RESOURCES !== 'false', // Block non-essential resources
    disableImages: process.env.DISABLE_IMAGES === 'true', // Optional image disabling
    disableAnimations: process.env.DISABLE_ANIMATIONS !== 'false', // Disable animations by default
    disableJavascript: process.env.DISABLE_JAVASCRIPT === 'true', // Optional JS disabling
    useHeadlessMode: process.env.USE_HEADLESS !== 'false', // Use headless by default
    useIncognitoContexts: process.env.USE_INCOGNITO !== 'false', // Use incognito contexts by default
    pageReuseLimit: parseInt(process.env.PAGE_REUSE_LIMIT || '10', 10), // Limit page reuse to avoid memory issues
  }
}; 