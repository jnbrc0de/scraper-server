/**
 * Application Configuration
 */
const config = {
  // General application settings
  app: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info'
  },
  
  // Logging configuration (adicionado para resolver erro de logger)
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    levels: { error: 0, warn: 1, info: 2, debug: 3 }
  },
  
  // Browser settings
  browser: {
    poolSize: process.env.BROWSER_POOL_SIZE || 5,
    defaultNavigationTimeout: parseInt(process.env.BROWSER_NAV_TIMEOUT || '30000', 10),
    defaultWaitTimeout: parseInt(process.env.BROWSER_WAIT_TIMEOUT || '30000', 10),
    memoryLimitMB: parseInt(process.env.BROWSER_MEMORY_LIMIT || '2048', 10),
    healthCheckInterval: parseInt(process.env.BROWSER_HEALTH_CHECK_INTERVAL || '60000', 10),
    maxBrowserAge: parseInt(process.env.BROWSER_MAX_AGE || '3600000', 10), // 1 hour
    rotationThreshold: parseInt(process.env.BROWSER_ROTATION_THRESHOLD || '100', 10),
    prewarmEnabled: process.env.BROWSER_PREWARM_ENABLED !== 'false',
    prewarmInterval: parseInt(process.env.BROWSER_PREWARM_INTERVAL || '60000', 10),
    minPrewarmedInstances: parseInt(process.env.BROWSER_MIN_PREWARMED || '1', 10),
    enforceHeaderConsistency: process.env.ENFORCE_HEADER_CONSISTENCY !== 'false',
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ]
  },
  
  // Proxy settings
  proxy: {
    enabled: true,
    proxyFile: './proxies.json',
    rotationStrategy: 'sequential',
    healthCheckInterval: 900000,
    healthCheckUrl: 'https://httpbin.org/ip',
    maxFailures: 5
  },
  
  // Captcha handling settings
  captcha: {
    service: process.env.CAPTCHA_SERVICE || '2captcha',
    apiKey: process.env.CAPTCHA_API_KEY || '',
    harvesterEnabled: process.env.CAPTCHA_HARVESTER_ENABLED === 'true',
    harvesterInterval: parseInt(process.env.CAPTCHA_HARVESTER_INTERVAL || '300000', 10), // 5 minutes
    harvesterTargets: process.env.CAPTCHA_HARVESTER_TARGETS ? 
      process.env.CAPTCHA_HARVESTER_TARGETS.split(',') : [],
    allowManualSolving: process.env.CAPTCHA_ALLOW_MANUAL === 'true',
    manualSolvingEndpoint: process.env.CAPTCHA_MANUAL_ENDPOINT || '/captchas/pending'
  },
  
  // Scraping settings with advanced error handling
  scraping: {
    maxRetries: parseInt(process.env.SCRAPING_MAX_RETRIES || '3', 10),
    concurrency: parseInt(process.env.SCRAPING_CONCURRENCY || '5', 10),
    defaultDelay: parseInt(process.env.SCRAPING_DEFAULT_DELAY || '1000', 10),
    maxSavedSessions: parseInt(process.env.SCRAPING_MAX_SESSIONS || '100', 10),
    sessionTTL: parseInt(process.env.SCRAPING_SESSION_TTL || '3600000', 10), // 1 hour
    backpressureThreshold: parseFloat(process.env.SCRAPING_BACKPRESSURE_THRESHOLD || '0.3'),
    backpressureWindowSize: parseInt(process.env.SCRAPING_BACKPRESSURE_WINDOW || '60000', 10), // 1 minute
    errorClassificationEnabled: process.env.ERROR_CLASSIFICATION_ENABLED !== 'false',
    progressiveFallbackEnabled: process.env.PROGRESSIVE_FALLBACK_ENABLED !== 'false',
    sessionResurrectionEnabled: process.env.SESSION_RESURRECTION_ENABLED !== 'false',
    retryJitterFactor: parseFloat(process.env.RETRY_JITTER_FACTOR || '0.2')
  },
  
  // Storage settings
  storage: {
    type: process.env.STORAGE_TYPE || 'memory', // memory, file, mongodb
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/scraper',
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true
      }
    },
    filePath: process.env.STORAGE_FILE_PATH || './data'
  },
  
  // Enhanced stealth settings
  stealth: {
    enabled: process.env.STEALTH_ENABLED !== 'false',
    deviceMemory: parseInt(process.env.STEALTH_DEVICE_MEMORY || '8', 10),
    cpuCores: parseInt(process.env.STEALTH_CPU_CORES || '8', 10),
    platform: process.env.STEALTH_PLATFORM || 'Win32',
    vendor: process.env.STEALTH_VENDOR || 'Google Inc.',
    renderer: process.env.STEALTH_RENDERER,
    canvasNoise: process.env.STEALTH_CANVAS_NOISE !== 'false',
    webglNoise: process.env.STEALTH_WEBGL_NOISE !== 'false',
    batteryEmulation: process.env.STEALTH_BATTERY_EMULATION !== 'false',
    connectionEmulation: process.env.STEALTH_CONNECTION_EMULATION !== 'false',
    humanEmulation: {
      enabled: process.env.HUMAN_EMULATION_ENABLED !== 'false',
      mouseMovements: process.env.HUMAN_MOUSE_MOVEMENTS !== 'false',
      scrolling: process.env.HUMAN_SCROLLING !== 'false',
      typing: process.env.HUMAN_TYPING !== 'false',
      mistakeProbability: parseFloat(process.env.HUMAN_MISTAKE_PROBABILITY || '0.05'),
      minTypingDelay: parseInt(process.env.HUMAN_MIN_TYPING_DELAY || '30', 10),
      maxTypingDelay: parseInt(process.env.HUMAN_MAX_TYPING_DELAY || '100', 10),
      readingSpeed: process.env.HUMAN_READING_SPEED || 'normal', // slow, normal, fast
      interactionDelay: parseInt(process.env.HUMAN_INTERACTION_DELAY || '500', 10),
      jitterFactor: parseFloat(process.env.HUMAN_JITTER_FACTOR || '0.15')
    },
    browserFingerprint: {
      // Generate random but consistent values for each process restart
      generated: process.env.STEALTH_GENERATED_FINGERPRINT !== 'false',
      // Alternatively, use fixed values for complete consistency
      fixed: process.env.STEALTH_FIXED_FINGERPRINT === 'true',
      userAgent: process.env.STEALTH_FIXED_USER_AGENT
    }
  },
  
  // Cache configuration (adicionado para compatibilidade)
  cache: {
    enabled: true,
    ttl: 3600
  }
};

module.exports = config; 