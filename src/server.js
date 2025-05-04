/**
 * Scraper Server
 * Main server file that sets up Express routes
 */

// Install required browsers if needed
const { execSync } = require('child_process');

try {
  // Verifica se já existe a instalação do Chromium antes de tentar instalar
  console.log('Verificando instalação do Chromium...');
  const result = execSync('node -e "try { require(\'playwright\').chromium.executablePath(); console.log(\'Chromium já instalado\'); } catch(e) { process.exit(1); }"', { stdio: 'pipe' }).toString();
  
  if (result.includes('Chromium já instalado')) {
    console.log('Chromium já está instalado, pulando instalação');
  } else {
    throw new Error('Chromium não encontrado');
  }
} catch (e) {
  console.log('Instalando Chromium...');
  try {
    execSync('npx playwright install chromium', { stdio: 'inherit' });
  } catch (e2) {
    try {
      execSync('node ./node_modules/playwright/cli.js install chromium', { stdio: 'inherit' });
    } catch (e3) {
      console.error('Falha na instalação do Chromium:', e3.message);
      process.exit(1);
    }
  }
}

// Silence D-Bus warnings
process.on('warning', (w) => {
  if (w.message && w.message.includes('Failed to connect to the bus')) return;
  console.warn(w);
});

// Import dependencies
const express = require('express');
const cors = require('cors');
let helmet, compression;

// Tentativa de importar módulos opcionais
try {
  helmet = require('helmet');
} catch (e) {
  console.log('Módulo helmet não encontrado. Configuração de segurança não será aplicada.');
  helmet = null;
}

try {
  compression = require('compression');
} catch (e) {
  console.log('Módulo compression não encontrado. Compressão HTTP não será aplicada.');
  compression = null;
}

const config = require('./config');
const logger = require('./utils/logger');
const scraperController = require('./controllers/scraperController');
const adapterFactory = require('./adapters/AdapterFactory');
const browserService = require('./services/browser/browserService');
const proxyManager = require('./services/proxy/proxyManager');
const cacheService = require('./services/cache/cacheService');
const path = require('path');
const crypto = require('crypto');

// Create Express app
const app = express();
const port = config.server.port || process.env.PORT || 3000;

// Set up middleware
app.use(cors());
// Adiciona helmet apenas se disponível
if (helmet) {
  app.use(helmet()); // Adiciona headers de segurança
}
// Adiciona compression apenas se disponível
if (compression) {
  app.use(compression()); // Comprime as respostas HTTP
}
app.use(express.json({ limit: '1mb' }));

// Middleware de log para requisições
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Intercepta o método end para registrar o tempo de resposta
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

// Captcha manual resolution routes
app.get('/captchas/pending', (req, res) => {
  const captchaService = require('./services/captcha/captchaService');
  
  try {
    // Get list of pending captchas
    const pendingTasks = Array.from(captchaService.pendingTasks.values())
      .filter(task => task.status === 'pending')
      .sort((a, b) => b.timestamp - a.timestamp); // Newest first
    
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
    // Find captcha task
    const task = captchaService.pendingTasks.get(captchaId);
    
    if (!task || !task.screenshotPath) {
      return res.status(404).json({
        success: false,
        error: 'Captcha not found'
      });
    }
    
    // Send captcha image
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
    // Find captcha task
    const task = captchaService.pendingTasks.get(captchaId);
    
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Captcha not found'
      });
    }
    
    // Update task
    task.status = 'solved';
    task.solution = solution;
    task.solvedAt = Date.now();
    
    // In a real implementation, you would apply the solution
    // to the pending browser session or store it for later use
    
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

// Single URL scraping route
app.get('/scrape-price', async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required parameter: url' 
    });
  }
  
  try {
    const result = await scraperController.scrapePrice(url);
    res.json(result);
  } catch (error) {
    logger.error('Error handling scrape-price request', { url }, error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Batch scraping route
app.post('/scrape-batch', async (req, res) => {
  const { urls, concurrency } = req.body;
  
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing or invalid required parameter: urls (must be a non-empty array)' 
    });
  }
  
  try {
    const results = await scraperController.scrapeMultiple(
      urls, 
      concurrency || config.browser.maxConcurrency
    );
    
    res.json({
      success: true,
      results,
      total: urls.length,
      successCount: results.filter(r => r.success).length
    });
  } catch (error) {
    logger.error('Error handling scrape-batch request', { 
      urlCount: urls.length 
    }, error);
    
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start the server
async function startServer() {
  try {
    // Initialize the scraper controller
    await scraperController.initialize();
    
    // Start listening
    const server = app.listen(port, () => {
      logger.info(`Scraper server running on port ${port}`);
    });
    
    // Configure socket timeout
    server.timeout = config.server.timeout || 120000; // Default 2 minutes
    
    // Enable keep-alive
    server.keepAliveTimeout = config.server.keepAliveTimeout || 65000; // Default 65 seconds
    server.headersTimeout = config.server.headersTimeout || 66000; // Keep slightly above keepAliveTimeout
    
    // Handle process exit
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', {}, error);
      shutdown();
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection', { promise }, reason);
    });
  } catch (error) {
    logger.error('Failed to start server', {}, error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down server');
  
  try {
    // Shut down scraper controller
    await scraperController.shutdown();
    
    // Exit process
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {}, error);
    process.exit(1);
  }
}

// Start the server
startServer(); 