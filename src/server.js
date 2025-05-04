/**
 * Scraper Server
 * Main server file that sets up Express routes
 */

// Import dependencies
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const logger = require('./utils/logger');
const scraperController = require('./controllers/scraperController');
const adapterFactory = require('./adapters/AdapterFactory');
const browserService = require('./services/browser/browserService');
const proxyManager = require('./services/proxy/proxyManager');
const cacheService = require('./services/cache/cacheService');
const path = require('path');

// Create Express app
const app = express();
const port = config.server.port || process.env.PORT || 3000;

// Set up middleware
app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Middleware de log para requisições
app.use((req, res, next) => {
  const startTime = Date.now();
  const originalEnd = res.end;
  
  res.end = function() {
    const responseTime = Date.now() - startTime;
    logger.info(`${req.method} ${req.originalUrl}`, {
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.headers['user-agent']
    });
    return originalEnd.apply(this, arguments);
  };
  
  next();
});

// Health check route
app.get('/health', (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: config.server.env,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    adapters: adapterFactory.getAdapterInfo(),
    cache: {
      enabled: config.cache.enabled,
      stats: cacheService.getStats()
    },
    proxies: proxyManager.getProxyStats()
  };
  
  res.json(status);
});

// Proxy statistics route
app.get('/proxy-stats', (req, res) => {
  try {
    const proxyStats = proxyManager.getProxyStats();
    const domainStats = proxyManager.getDomainStats();
    
    res.json({
      success: true,
      proxies: proxyStats,
      domains: domainStats,
      config: {
        enabled: config.proxy.enabled,
        strategy: config.proxy.rotationStrategy,
        totalProxies: Object.keys(proxyStats).length,
        circuitBreakerThreshold: config.proxy.circuitBreakerThreshold,
        circuitBreakerResetTime: config.proxy.circuitBreakerResetTime
      }
    });
  } catch (error) {
    logger.error('Error retrieving proxy stats', {}, error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve proxy statistics'
    });
  }
});

// Captcha routes
app.get('/captchas/pending', (req, res) => {
  const captchaService = require('./services/captcha/captchaService');
  
  try {
    const pendingTasks = Array.from(captchaService.pendingTasks.values())
      .filter(task => task.status === 'pending')
      .sort((a, b) => b.timestamp - a.timestamp);
    
    res.json({
      success: true,
      count: pendingTasks.length,
      captchas: pendingTasks.map(task => ({
        id: task.id,
        url: task.url,
        type: task.type,
        timestamp: task.timestamp,
        screenshotPath: path.basename(task.screenshotPath)
      }))
    });
  } catch (error) {
    logger.error('Error retrieving pending captchas', {}, error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve pending captchas'
    });
  }
});

app.get('/captchas/image/:id', (req, res) => {
  const captchaService = require('./services/captcha/captchaService');
  const captchaId = req.params.id;
  
  try {
    const task = captchaService.pendingTasks.get(captchaId);
    
    if (!task || !task.screenshotPath) {
      return res.status(404).json({
        success: false,
        error: 'Captcha not found'
      });
    }
    
    res.sendFile(task.screenshotPath);
  } catch (error) {
    logger.error('Error retrieving captcha image', { captchaId }, error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve captcha image'
    });
  }
});

app.post('/captchas/solve/:id', (req, res) => {
  const captchaService = require('./services/captcha/captchaService');
  const captchaId = req.params.id;
  const { solution } = req.body;
  
  if (!solution) {
    return res.status(400).json({
      success: false,
      error: 'Solution is required'
    });
  }
  
  try {
    const task = captchaService.pendingTasks.get(captchaId);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Captcha not found'
      });
    }
    
    task.status = 'solved';
    task.solution = solution;
    task.solvedAt = Date.now();
    
    res.json({
      success: true,
      message: 'Captcha solution submitted'
    });
  } catch (error) {
    logger.error('Error solving captcha', { captchaId }, error);
    res.status(500).json({
      success: false,
      error: 'Failed to solve captcha'
    });
  }
});

// Initialize services
async function initializeServices() {
  try {
    await browserService.initialize();
    await proxyManager.initialize();
    await cacheService.initialize();
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', {}, error);
    process.exit(1);
  }
}

// Start server
async function startServer() {
  try {
    await initializeServices();
    
    app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
    });
  } catch (error) {
    logger.error('Failed to start server', {}, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  await browserService.shutdown();
  await proxyManager.shutdown();
  await cacheService.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  await browserService.shutdown();
  await proxyManager.shutdown();
  await cacheService.shutdown();
  process.exit(0);
});

// Start the server
startServer(); 