/**
 * Configuration module for the scraper application
 * Centralizes all configuration settings to make them easily accessible
 */
require('dotenv').config();

// Default user agents for rotation
const DEFAULT_UA_LIST = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.85 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; SM-G996B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.140 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0"
];

// Configure settings from environment variables with sensible defaults
module.exports = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    // Levels: 'error', 'warn', 'info', 'debug'
    levels: { error: 0, warn: 1, info: 2, debug: 3 },
  },

  // Browser and scraping configuration
  browser: {
    poolSize: parseInt(process.env.BROWSER_POOL_SIZE || '2', 10),
    maxConcurrency: parseInt(process.env.MAX_CONCURRENT_SCRAPES || '5', 10),
    defaultNavigationTimeout: parseInt(process.env.NAVIGATION_TIMEOUT || '30000', 10),
    defaultWaitTimeout: parseInt(process.env.WAIT_TIMEOUT || '10000', 10),
    retries: parseInt(process.env.SCRAPE_RETRIES || '3', 10),
    baseRetryDelay: parseInt(process.env.BASE_RETRY_DELAY || '1200', 10),
    memoryLimitMB: parseInt(process.env.MEMORY_LIMIT_MB || '400', 10),
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000', 10),
    userAgents: process.env.UA_LIST ? JSON.parse(process.env.UA_LIST) : DEFAULT_UA_LIST,
  },

  // Proxy configuration
  proxy: {
    enabled: process.env.USE_PROXIES === 'true' || true, // Habilitamos por padrão já que estamos usando Bright Data
    rotationStrategy: process.env.PROXY_ROTATION_STRATEGY || 'sequential', // 'sequential', 'random', 'performance'
    proxies: process.env.PROXIES ? process.env.PROXIES.split(',').map(p => p.trim()).filter(Boolean) : [],
    proxyFile: process.env.PROXY_FILE || 'Webshare9proxies.txt',
    maxFailures: parseInt(process.env.MAX_PROXY_FAILURES || '3', 10),
    minSuccessRate: parseFloat(process.env.MIN_PROXY_SUCCESS_RATE || '0.6', 10),
    // Enhanced proxy management settings
    healthCheckInterval: parseInt(process.env.PROXY_HEALTH_CHECK_INTERVAL || '900000', 10), // 15 minutes
    healthCheckUrl: process.env.PROXY_HEALTH_CHECK_URL || 'https://httpbin.org/ip',
    circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5', 10),
    circuitBreakerResetTime: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIME || '300000', 10), // 5 minutes
    domainSpecificTracking: process.env.DOMAIN_SPECIFIC_TRACKING !== 'false',
    preferDomainSpecificProxies: process.env.PREFER_DOMAIN_SPECIFIC_PROXIES !== 'false',
    // Bright Data proxy configuration
    brightData: {
      enabled: true,
      server: 'brd.superproxy.io:33335',
      username: 'brd-customer-hl_aa4b1775-zone-residential_proxy1',
      password: '15blqlg7ljnm',
      useCertificate: false, // Configurar como true se você precisar usar certificado SSL
      certPath: process.env.BRIGHTDATA_CERT_PATH || './New SSL certifcate - MUST BE USED WITH PORT 33335/CA.CRT',
    },
  },

  // Email notification configuration
  email: {
    enabled: !!(process.env.EMAIL_TO && process.env.EMAIL_FROM && process.env.EMAIL_PASS && process.env.EMAIL_HOST),
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '465', 10),
    secure: true,
  },

  // Captcha configuration
  captcha: {
    service: process.env.CAPTCHA_SERVICE, // null, '2captcha', 'capmonster', etc.
    apiKey: process.env.CAPTCHA_API_KEY,
    bypassAttempts: parseInt(process.env.CAPTCHA_BYPASS_ATTEMPTS || '2', 10),
    // Enhanced captcha settings
    tokenHarvesting: process.env.CAPTCHA_TOKEN_HARVESTING === 'true',
    harvestInterval: parseInt(process.env.CAPTCHA_HARVEST_INTERVAL || '300000', 10), // 5 minutes
    manualResolutionEnabled: process.env.MANUAL_CAPTCHA_RESOLUTION === 'true',
    manualResolutionWebhook: process.env.MANUAL_CAPTCHA_WEBHOOK,
    ocrEnabled: process.env.OCR_ENABLED === 'true',
    predictiveDetection: process.env.PREDICTIVE_CAPTCHA === 'true',
    captchaTimeout: parseInt(process.env.CAPTCHA_SOLVING_TIMEOUT || '180000', 10), // 3 minutes
  },

  // Cache configuration
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    ttl: parseInt(process.env.CACHE_TTL || '3600', 10), // Default 1 hour
  },

  // Database configuration
  database: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  }
}; 