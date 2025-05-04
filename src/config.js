/**
 * Server configuration
 */
module.exports = {
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    timeout: 120000, // 2 minutes
    keepAliveTimeout: 65000, // 65 seconds
    headersTimeout: 66000 // 66 seconds
  },
  
  browser: {
    maxConcurrency: 5,
    timeout: 30000, // 30 seconds
    retryAttempts: 3,
    retryDelay: 1000, // 1 second
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  
  proxy: {
    enabled: process.env.USE_PROXY === 'true',
    rotationStrategy: 'round-robin',
    circuitBreakerThreshold: 3,
    circuitBreakerResetTime: 300000, // 5 minutes
    timeout: 10000 // 10 seconds
  },
  
  cache: {
    enabled: process.env.ENABLE_CACHE === 'true',
    ttl: 3600000, // 1 hour
    maxSize: 1000 // Maximum number of items
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json',
    directory: 'logs'
  }
}; 