const playwright = require('playwright-extra');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const PriceExtractor = require('./extraction');
const extractor = new PriceExtractor();
const RenderOptimizer = require('./renderOptimizations');
const renderOptimizer = new RenderOptimizer();
renderOptimizer.startMemoryMonitoring();
const extractViaVarejoPrice = require('./extractors/viaVarejo');
const CaptchaHandler = require('./captchaHandler');
const captchaHandler = new CaptchaHandler();
const nodemailer = require('nodemailer');

// Lista de user agents para rotação e evitar bloqueios
const UA_LIST = process.env.UA_LIST
  ? JSON.parse(process.env.UA_LIST)
  : [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.85 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 13; SM-G996B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.140 Mobile Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0"
    ];

// Lista de proxies para rotação (opcional)
const PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(',').map(p => p.trim()).filter(Boolean)
  : [];

// Armazena a última estratégia bem-sucedida para domínios Via Varejo
let lastViaVarejoStrategy = null;

// Instância global de browser Playwright (reutilizável)
let globalBrowser = null;

// Configuração do transporte de email (ajuste para seu provedor)
const EMAIL_ENABLED = !!process.env.EMAIL_TO && !!process.env.EMAIL_FROM && !!process.env.EMAIL_PASS && !!process.env.EMAIL_HOST;
let emailTransporter = null;
if (EMAIL_ENABLED) {
  emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '465', 10),
    secure: true,
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_PASS
    }
  });
}

/**
 * Envia email com logs e capturas de tela em caso de falha.
 */
async function sendFailureEmail({ url, failFile, screenshotFile, failReasons }) {
  if (!EMAIL_ENABLED) return;
  try {
    const attachments = [];
    if (fs.existsSync(failFile)) {
      attachments.push({ filename: path.basename(failFile), path: failFile });
    }
    if (fs.existsSync(screenshotFile)) {
      attachments.push({ filename: path.basename(screenshotFile), path: screenshotFile });
    }
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: `[Scraper FAIL] ${url}`,
      text: `Falha ao extrair preço de: ${url}\n\nMotivos:\n${(failReasons || []).join('\n')}`,
      attachments
    });
  } catch (e) {
    console.error('Erro ao enviar email de falha:', e.message);
  }
}

// Logger centralizado com níveis e rotação
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL ? LOG_LEVELS[process.env.LOG_LEVEL] : 2;
function logger(level, ...args) {
  if (LOG_LEVELS[level] <= CURRENT_LOG_LEVEL) {
    console.log(`[${level.toUpperCase()}][${new Date().toISOString()}]`, ...args);
  }
}

// Pool de browser/contexto otimizado com monitoramento ativo de saúde
class BrowserPool {
  constructor(maxBrowsers = 2) {
    this.maxBrowsers = maxBrowsers;
    this.active = 0;
    this.queue = [];
    this.browser = null;
    this.lastHealthCheck = Date.now();
    this.healthCheckInterval = 60000; // 1 min
    this.memoryLimitMB = 400;
    this._startHealthMonitor();
  }

  async acquire(launchOptions) {
    await this._healthCheck();
    if (this.active < this.maxBrowsers) {
      this.active++;
      if (!this.browser || !this.browser.isConnected || !this.browser.isConnected()) {
        if (this.browser) try { await this.browser.close(); } catch {}
        this.browser = await playwright.chromium.launch(launchOptions);
      }
      return this.browser;
    }
    return new Promise(resolve => {
      this.queue.push(async () => {
        this.active++;
        if (!this.browser || !this.browser.isConnected || !this.browser.isConnected()) {
          if (this.browser) try { await this.browser.close(); } catch {}
          this.browser = await playwright.chromium.launch(launchOptions);
        }
        resolve(this.browser);
      });
    });
  }

  async release() {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }

  async closeAll() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
    }
    this.active = 0;
    this.queue = [];
  }

  async _healthCheck() {
    // Checa memória e browser health periodicamente
    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckInterval) return;
    this.lastHealthCheck = now;
    const mem = process.memoryUsage().rss / 1024 / 1024;
    if (mem > this.memoryLimitMB) {
      logger('warn', `Memory usage high (${Math.round(mem)}MB), restarting browser pool`);
      await this.closeAll();
      if (global.gc) global.gc();
    }
    if (this.browser && (!this.browser.isConnected || !this.browser.isConnected())) {
      logger('warn', 'Browser not connected, restarting browser pool');
      await this.closeAll();
    }
  }

  _startHealthMonitor() {
    setInterval(() => this._healthCheck(), this.healthCheckInterval);
  }
}
const browserPool = new BrowserPool(parseInt(process.env.BROWSER_POOL_SIZE || '2', 10));

/**
 * Obtém (ou cria) uma instância global de browser Playwright.
 * Garante que o browser está aberto e conectado.
 */
async function getBrowser(launchOptions) {
  if (globalBrowser && globalBrowser.isConnected && globalBrowser.isConnected()) {
    return globalBrowser;
  }
  if (globalBrowser) {
    try { await globalBrowser.close(); } catch {}
    globalBrowser = null;
  }
  globalBrowser = await playwright.chromium.launch(launchOptions);
  return globalBrowser;
}

// Retry/Proxy/User-Agent centralizado
async function withRetries(fn, retries = 3, delayMs = 1200, rotateProxy = true) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastError = e;
      logger('warn', `Retry ${i + 1} failed:`, e.message);
      await new Promise(r => setTimeout(r, delayMs + Math.floor(Math.random() * 500)));
    }
  }
  throw lastError;
}

/**
 * Estratégias de extração de preço, da mais robusta para a menos eficiente.
 * Cada função recebe (page, html, domain) e retorna {price, reasonIfFail, strategyName}
 */
const priceStrategies = [
  // 1. Extrator específico Via Varejo (quando aplicável)
  async (page, html, domain) => {
    if (
      domain.includes('casasbahia.com.br') ||
      domain.includes('pontofrio.com.br') ||
      domain.includes('extra.com.br')
    ) {
      // Se já existe uma estratégia bem-sucedida para Via Varejo, tente ela primeiro
      if (lastViaVarejoStrategy) {
        try {
          const { fn, name } = lastViaVarejoStrategy;
          const price = await fn(page, html, domain);
          if (price) return { price, strategyName: name };
        } catch (err) {
          // log erro mas não interrompe
        }
      }
      // Tente o extrator padrão Via Varejo
      try {
        await page.waitForTimeout(1000);
        const price = await extractViaVarejoPrice(page);
        if (price) {
          lastViaVarejoStrategy = { fn: async (p, h, d) => await extractViaVarejoPrice(p), name: 'extractViaVarejoPrice' };
          return { price, strategyName: 'extractViaVarejoPrice' };
        }
      } catch (err) {
        // log erro mas não interrompe
      }
      // Tente o extractor.extractFromStructuredData
      try {
        const price2 = await extractor.extractFromStructuredData(html);
        if (price2) {
          lastViaVarejoStrategy = { fn: async (p, h, d) => await extractor.extractFromStructuredData(h), name: 'extractFromStructuredData' };
          return { price: price2, strategyName: 'extractFromStructuredData' };
        }
      } catch (err) {}
      // Tente o extractor.extractFromDomainSelectors
      try {
        const price3 = await extractor.extractFromDomainSelectors(html, domain);
        if (price3) {
          lastViaVarejoStrategy = { fn: async (p, h, d) => await extractor.extractFromDomainSelectors(h, d), name: 'extractFromDomainSelectors' };
          return { price: price3, strategyName: 'extractFromDomainSelectors' };
        }
      } catch (err) {}
      // Tente o extractor.extractFromGenericSelectors
      try {
        const price4 = await extractor.extractFromGenericSelectors(html);
        if (price4) {
          lastViaVarejoStrategy = { fn: async (p, h, d) => await extractor.extractFromGenericSelectors(h), name: 'extractFromGenericSelectors' };
          return { price: price4, strategyName: 'extractFromGenericSelectors' };
        }
      } catch (err) {}
      // Tente o extractor.extractFromTextPatterns
      try {
        const price5 = await extractor.extractFromTextPatterns(html);
        if (price5) {
          lastViaVarejoStrategy = { fn: async (p, h, d) => await extractor.extractFromTextPatterns(h), name: 'extractFromTextPatterns' };
          return { price: price5, strategyName: 'extractFromTextPatterns' };
        }
      } catch (err) {}
      return { price: null, reasonIfFail: 'viaVarejo: todas estratégias falharam' };
    }
    return { price: null, reasonIfFail: 'não é viaVarejo' };
  },
  // 2. Structured Data (JSON-LD)
  async (page, html, domain) => {
    try {
      const price = await extractor.extractFromStructuredData(html);
      if (price) return { price, strategyName: 'extractFromStructuredData' };
      return { price: null, reasonIfFail: 'structured data não encontrado' };
    } catch (err) {
      return { price: null, reasonIfFail: 'structured data erro: ' + err.message };
    }
  },
  // 3. Seletores específicos por domínio
  async (page, html, domain) => {
    try {
      const price = await extractor.extractFromDomainSelectors(html, domain);
      if (price) return { price, strategyName: 'extractFromDomainSelectors' };
      return { price: null, reasonIfFail: 'seletor específico não encontrado' };
    } catch (err) {
      return { price: null, reasonIfFail: 'seletor específico erro: ' + err.message };
    }
  },
  // 4. Seletores genéricos
  async (page, html, domain) => {
    try {
      const price = await extractor.extractFromGenericSelectors(html);
      if (price) return { price, strategyName: 'extractFromGenericSelectors' };
      return { price: null, reasonIfFail: 'seletor genérico não encontrado' };
    } catch (err) {
      return { price: null, reasonIfFail: 'seletor genérico erro: ' + err.message };
    }
  },
  // 5. Inline JSON em window (ex: __PRELOADED_STATE__, __INITIAL_STATE__)
  async (page, html, domain) => {
    try {
      const inlineJsonPrice = await page.evaluate(() => {
        try {
          let price = null;
          if (window.__PRELOADED_STATE__ && typeof window.__PRELOADED_STATE__ === 'object') {
            const str = JSON.stringify(window.__PRELOADED_STATE__);
            const match = str.match(/"price"\s*:\s*"?([\d.,]+)/i);
            if (match) price = match[1];
          }
          if (!price && window.__INITIAL_STATE__ && typeof window.__INITIAL_STATE__ === 'object') {
            const str = JSON.stringify(window.__INITIAL_STATE__);
            const match = str.match(/"price"\s*:\s*"?([\d.,]+)/i);
            if (match) price = match[1];
          }
          return price;
        } catch { return null; }
      });
      if (inlineJsonPrice) return { price: inlineJsonPrice, strategyName: 'inlineJsonPrice' };
      return { price: null, reasonIfFail: 'inline JSON price não encontrado' };
    } catch (err) {
      return { price: null, reasonIfFail: 'inline JSON erro: ' + err.message };
    }
  },
  // 6. Variáveis JS comuns no HTML
  async (page, html, domain) => {
    try {
      const match = html.match(/window\.(?:__PRELOADED_STATE__|__INITIAL_STATE__)\s*=\s*(\{.*?\});/s);
      if (match) {
        const obj = JSON.parse(match[1]);
        if (obj && obj.price) return { price: obj.price, strategyName: 'jsVarPrice' };
      }
      return { price: null, reasonIfFail: 'variável JS price não encontrada' };
    } catch (err) {
      return { price: null, reasonIfFail: 'variável JS erro: ' + err.message };
    }
  },
  // 7. Regex em todo o HTML (último recurso)
  async (page, html, domain) => {
    try {
      const price = await extractor.extractFromTextPatterns(html);
      if (price) return { price, strategyName: 'extractFromTextPatterns' };
      return { price: null, reasonIfFail: 'regex no HTML não encontrou preço' };
    } catch (err) {
      return { price: null, reasonIfFail: 'regex erro: ' + err.message };
    }
  }
];

// Remover flag --single-process e --no-sandbox do RenderOptimizer
// Corrigir getBrowserLaunchOptions para não usar flags problemáticas
RenderOptimizer.prototype.getBrowserLaunchOptions = function () {
  return {
    args: [
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      // '--no-sandbox', // Removido para evitar problemas de contexto/browser
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--disable-features=site-per-process',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      // '--single-process', // REMOVIDO: causa falha de contexto/browser
      '--disable-extensions'
    ],
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    ignoreDefaultArgs: ['--enable-automation']
  };
};

// Função utilitária para garantir contexto e página válidos
async function safeNewPage(browser, context) {
  if (!browser || !browser.isConnected || !browser.isConnected()) throw new Error('Browser is not connected');
  if (!context || context.isClosed && context.isClosed()) throw new Error('Context is closed');
  return await context.newPage();
}

// Aplique EnhancedStealth antes de page.goto
const EnhancedStealth = require('./stealth');
const enhancedStealth = new EnhancedStealth();

// Importa simulação de comportamento humano realista
const { simulateRealisticBrowsing } = require('./humanBehavior');
const FingerprintGenerator = require('fingerprint-generator');

// Corrija a inicialização do FingerprintGenerator para usar .default se necessário
let FingerprintGenClass = FingerprintGenerator && FingerprintGenerator.default ? FingerprintGenerator.default : FingerprintGenerator;
let fingerprintGenerator = new FingerprintGenClass({
  browsers: [{ name: 'chrome', minVersion: 100 }],
  devices: ['desktop'],
  operatingSystems: ['windows', 'linux'],
});

// Rotaciona fingerprint periodicamente (ex: a cada 6h)
setInterval(() => {
  fingerprintGenerator = new FingerprintGenClass({
    browsers: [{ name: 'chrome', minVersion: 100 }],
    devices: ['desktop'],
    operatingSystems: ['windows', 'linux'],
  });
  logger('info', 'Fingerprint rotacionado');
}, 6 * 60 * 60 * 1000);

// Proxy pool com monitoramento de bloqueios e rotação automática
let proxyStats = PROXIES.map(proxy => ({
  proxy,
  fails: 0,
  success: 0,
  lastLatency: null,
  blocked: false,
}));

function getBestProxy() {
  // Prioriza proxies não bloqueados e mais rápidos
  const available = proxyStats.filter(p => !p.blocked);
  if (!available.length) return null;
  available.sort((a, b) => (a.lastLatency || 9999) - (b.lastLatency || 9999));
  return available[0].proxy;
}

function reportProxyResult(proxy, success, latency) {
  const stat = proxyStats.find(p => p.proxy === proxy);
  if (!stat) return;
  if (success) {
    stat.success += 1;
    stat.lastLatency = latency;
    stat.fails = 0;
  } else {
    stat.fails += 1;
    if (stat.fails >= 3) stat.blocked = true;
  }
}

function rotateProxy() {
  // Remove proxies bloqueados e retorna um proxy válido aleatório
  const available = proxyStats.filter(p => !p.blocked).map(p => p.proxy);
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// --- Browser/contexto robusto e à prova de falhas ---

// Função robusta para criar/obter browser Playwright
async function getOrCreateBrowser(launchOptions) {
  // Usa pool, mas sempre valida conexão e tenta relançar se necessário
  let browser;
  try {
    browser = await browserPool.acquire(launchOptions);
    if (!browser || !browser.isConnected || !browser.isConnected()) {
      if (browser) try { await browser.close(); } catch {}
      browser = await playwright.chromium.launch(launchOptions);
    }
    return browser;
  } catch (e) {
    logger('error', 'Erro ao criar browser:', e.message);
    throw e;
  }
}

// Função robusta para criar contexto Playwright (com health check extra)
async function getOrCreateContext(browser, launchOptions, userAgent) {
  if (!browser || !browser.isConnected || !browser.isConnected()) throw new Error('Browser is not connected');
  let context;
  try {
    context = await browser.newContext({
      userAgent,
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true
    });
    if (context.isClosed && context.isClosed()) throw new Error('Context is closed after creation');
    return context;
  } catch (e) {
    logger('error', 'Erro ao criar contexto:', e.message);
    if (context && context.isClosed && !context.isClosed()) {
      try { await context.close(); } catch {}
    }
    throw e;
  }
}

// Função robusta para criar página Playwright (com health check extra)
async function getOrCreatePage(browser, context) {
  if (!browser || !browser.isConnected || !browser.isConnected()) throw new Error('Browser is not connected');
  if (!context || (context.isClosed && context.isClosed())) throw new Error('Context is closed');
  try {
    const page = await context.newPage();
    if (page.isClosed && page.isClosed()) throw new Error('Page is closed after creation');
    return page;
  } catch (e) {
    logger('error', 'Erro ao criar página:', e.message);
    throw e;
  }
}

// Função para resolver captchas invisíveis/JS (ex: Amazon)
async function tryAdvancedCaptchaBypass(page, failReasons) {
  // 1. Tenta bypass humano (simulação de interação)
  let bypassed = await captchaHandler.bypassWithoutService(page);
  if (bypassed) {
    failReasons.push('captcha contornado com simulação humana');
    return true;
  }

  // 2. Tenta resolver captchas invisíveis/JS (ex: Amazon)
  // Exemplo: Amazon usa "captcha" em JS, verifica se há challenge
  const isAmazonChallenge = await page.evaluate(() => {
    return !!document.querySelector('form[action*="validateCaptcha"]') ||
      !!document.querySelector('input[name="field-keywords"]') && document.body.innerText.match(/digite os caracteres/i);
  });
  if (isAmazonChallenge) {
    failReasons.push('captcha JS/Amazon detectado');
    // Tenta simular digitação ou interação
    try {
      const input = await page.$('input[name="field-keywords"], input[type="text"]');
      if (input) {
        await input.focus();
        await page.keyboard.type('test', { delay: 200 });
        await page.waitForTimeout(1000);
      }
      await page.mouse.move(200 + Math.random() * 200, 200 + Math.random() * 200, { steps: 10 });
      await page.waitForTimeout(1000);
      // Tenta submeter o form
      const btn = await page.$('button[type="submit"], input[type="submit"]');
      if (btn) await btn.click();
      await page.waitForTimeout(2000);
      // Verifica se saiu do captcha
      const stillCaptcha = await captchaHandler.detectCaptcha(page);
      if (!stillCaptcha) {
        failReasons.push('captcha JS/Amazon contornado');
        return true;
      }
    } catch (e) {
      failReasons.push('falha ao tentar bypass JS/Amazon');
    }
  }

  // 3. Tenta 2Captcha se chave disponível
  if (process.env.CAPTCHA_API_KEY) {
    try {
      // Exemplo para reCAPTCHA v2
      const sitekey = await page.evaluate(() => {
        const el = document.querySelector('[data-sitekey]');
        return el ? el.getAttribute('data-sitekey') : null;
      });
      if (sitekey) {
        const urlPage = page.url();
        const fetch = require('node-fetch');
        const req = await fetch(`http://2captcha.com/in.php?key=${process.env.CAPTCHA_API_KEY}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${urlPage}`);
        const reqText = await req.text();
        const captchaId = reqText.split('|')[1];
        let token = null;
        for (let i = 0; i < 20; i++) {
          await new Promise(res => setTimeout(res, 5000));
          const res = await fetch(`http://2captcha.com/res.php?key=${process.env.CAPTCHA_API_KEY}&action=get&id=${captchaId}`);
          const resText = await res.text();
          if (resText.startsWith('OK|')) {
            token = resText.split('|')[1];
            break;
          }
        }
        if (token) {
          await page.evaluate((token) => {
            document.querySelector('textarea[g-recaptcha-response]').value = token;
          }, token);
          await page.click('button[type=submit], input[type=submit]');
          await page.waitForTimeout(5000);
          failReasons.push('captcha resolvido via 2Captcha');
          const stillCaptcha = await captchaHandler.detectCaptcha(page);
          if (!stillCaptcha) return true;
        } else {
          failReasons.push('2Captcha não conseguiu resolver');
        }
      } else {
        failReasons.push('sitekey não encontrada para 2Captcha');
      }
    } catch (e) {
      failReasons.push('erro ao tentar 2Captcha: ' + (e.message || e));
    }
  }

  // 4. (Opcional) Capmonster (exemplo de integração)
  // if (process.env.CAPMONSTER_API_KEY) { ... }

  return false;
}

// Circuit breaker por domínio
const circuitBreaker = {
  state: {}, // { [domain]: 'CLOSED' | 'OPEN' | 'HALF_OPEN' }
  failureCount: {},
  lastFailureTime: {},
  failureThreshold: 5,
  resetTimeout: 60 * 1000, // 1 minuto

  canAttempt(domain) {
    if (!this.state[domain]) this.state[domain] = 'CLOSED';
    if (this.state[domain] === 'OPEN' && this.failureCount[domain] >= this.failureThreshold) {
      const timeSinceLastFailure = Date.now() - (this.lastFailureTime[domain] || 0);
      if (timeSinceLastFailure < this.resetTimeout) {
        logger('warn', `Circuit breaker OPEN for ${domain}, skipping scraping`);
        return false;
      } else {
        this.state[domain] = 'HALF_OPEN';
      }
    }
    return true;
  },
  report(domain, success) {
    if (!this.failureCount[domain]) this.failureCount[domain] = 0;
    if (success) {
      this.failureCount[domain] = 0;
      if (this.state[domain] === 'HALF_OPEN') this.state[domain] = 'CLOSED';
    } else {
      this.failureCount[domain]++;
      this.lastFailureTime[domain] = Date.now();
      if (this.failureCount[domain] >= this.failureThreshold) {
        this.state[domain] = 'OPEN';
        logger('warn', `Circuit breaker OPEN for ${domain} after ${this.failureCount[domain]} failures`);
      }
    }
  }
};

// Retry com backoff exponencial e jitter
async function withRetriesCircuit(fn, retries = 3, baseDelayMs = 1200, rotateProxy = true, domain = '') {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastError = e;
      logger('warn', `Retry ${i + 1} failed:`, e.message);
      // Exponencial backoff + jitter
      const delay = Math.min(baseDelayMs * Math.pow(2, i), 10000) + Math.floor(Math.random() * 500);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Realiza o scraping de preço de um produto em uma URL.
 * Tenta múltiplas estratégias, troca proxy a cada falha, retorna motivo detalhado.
 * Integra detecção e bypass de captcha em todas as tentativas.
 * @param {string} url URL do produto
 * @returns {Promise<{success: boolean, price?: number, cached?: boolean, error?: string, failReasons?: string[]}>}
 */
async function scrapePrice(url) {
  // Detecta caminho do Chromium baixado pelo Playwright (Render)
  let executablePath;
  try {
    const browserPath = path.join(__dirname, '.pw-browsers');
    const chromiumDir = fs.readdirSync(browserPath)
      .find(d => d.startsWith('chromium-') || d.startsWith('chromium_headless_shell-'));
    if (chromiumDir) {
      const candidate = path.join(browserPath, chromiumDir, 'chrome-linux', 'chrome');
      if (fs.existsSync(candidate)) executablePath = candidate;
    }
  } catch (e) {
    // fallback: Playwright resolve sozinho
  }

  let failReasons = [];
  let proxiesToTry = proxyStats.filter(p => !p.blocked).map(p => p.proxy);
  if (proxiesToTry.length === 0) proxiesToTry = [null];

  let lastError = null;
  // Otimização: calcule domain uma vez só
  let domain = '';
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    domain = '';
  }

  // Circuit breaker: verifica se pode tentar
  if (!circuitBreaker.canAttempt(domain)) {
    return {
      success: false,
      error: 'Circuit breaker open for this domain',
      failReasons: ['Circuit breaker open for this domain']
    };
  }

  // Tenta cada proxy disponível
  for (let proxyIdx = 0; proxyIdx < proxiesToTry.length; proxyIdx++) {
    let proxy = proxiesToTry[proxyIdx];

    const result = await withRetriesCircuit(async (retryAttempt) => {
      // Rotaciona proxy a cada retry
      if (retryAttempt > 0) proxy = rotateProxy();

      // Rotaciona user-agent, proxy, headers e fingerprint a cada tentativa
      const userAgent = UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
      const currentProxy = PROXIES.length > 0
        ? PROXIES[Math.floor(Math.random() * PROXIES.length)]
        : proxy;
      const fingerprint = fingerprintGenerator.getFingerprint();

      // Opções otimizadas para ambiente Render
      const baseLaunchOptions = renderOptimizer.getBrowserLaunchOptions();
      const launchOptions = {
        ...baseLaunchOptions,
        userAgent,
        args: [
          ...(baseLaunchOptions.args || []),
          ...(currentProxy ? [`--proxy-server=${currentProxy}`] : [])
        ],
        ...(executablePath ? { executablePath } : {})
      };

      // Reutiliza browser global, fecha apenas a página/contexto
      let browser, context, page;
      const start = Date.now();
      let proxySuccess = false;
      try {
        browser = await getOrCreateBrowser(launchOptions);
        context = await getOrCreateContext(browser, launchOptions, userAgent);

        // Injeta fingerprint customizado
        await context.addInitScript(fingerprint.injectable);

        await context.route('**/*', (route) => {
          const req = route.request();
          const url = req.url();
          const resourceType = req.resourceType();
          if (
            ['image', 'stylesheet', 'font', 'media', 'other'].includes(resourceType) ||
            url.match(/\.(png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot|otf|ico)(\?|$)/i) ||
            url.includes('google-analytics') ||
            url.includes('doubleclick') ||
            url.includes('facebook.com/tr') ||
            url.includes('gtm.js') ||
            url.includes('googletagmanager') ||
            url.includes('adsystem') ||
            url.includes('adservice')
          ) {
            route.abort();
          } else {
            route.continue();
          }
        });

        // Use robusta função para criar página
        page = await getOrCreatePage(browser, context);

        // Aplique stealth antes de navegar
        await enhancedStealth.applyToPage(page);

        // Simule movimento humano realista antes do goto
        await simulateRealisticBrowsing(page);

        // Headers realistas e rotacionados
        await page.setExtraHTTPHeaders({
          'User-Agent': fingerprint.headers['user-agent'] || userAgent,
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'sec-ch-ua': fingerprint.headers['sec-ch-ua'] || '"Google Chrome";v="119", "Chromium";v="119", "Not-A.Brand";v="24"',
          'sec-ch-ua-platform': fingerprint.headers['sec-ch-ua-platform'] || '"Windows"',
          'sec-ch-ua-mobile': fingerprint.headers['sec-ch-ua-mobile'] || '?0',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'max-age=0',
          'DNT': '1',
          'Referer': url
        });

        // Só navegue se a página não estiver fechada
        if (page.isClosed && page.isClosed()) throw new Error('Page is closed before goto');
        let gotoSuccess = false;
        for (let gotoAttempt = 0; gotoAttempt < 2; gotoAttempt++) {
          try {
            if (page.isClosed && page.isClosed()) throw new Error('Page is closed before goto');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
            gotoSuccess = true;
            break;
          } catch (gotoErr) {
            logger('warn', 'Falha em page.goto(), tentativa', gotoAttempt + 1, gotoErr.message);
            if (gotoAttempt === 0) {
              // Tenta reabrir a página/contexto se possível
              if (page && page.isClosed && page.isClosed()) {
                try { await page.close(); } catch {}
                page = await getOrCreatePage(browser, context);
                await enhancedStealth.applyToPage(page);
                await simulateRealisticBrowsing(page);
                await page.setExtraHTTPHeaders({
                  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                  'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not-A.Brand";v="24"',
                  'sec-ch-ua-platform': '"Windows"',
                  'sec-ch-ua-mobile': '?0',
                  'Upgrade-Insecure-Requests': '1',
                  'Cache-Control': 'max-age=0',
                  'DNT': '1',
                  'Referer': url
                });
              }
            } else {
              throw gotoErr;
            }
          }
        }
        if (!gotoSuccess) throw new Error('page.goto falhou após retries');

        // Simule movimento humano após o carregamento também
        await simulateRealisticBrowsing(page);

        // Aguarda seletor de preço se possível (robusto)
        try {
          await page.waitForSelector('.price, [itemprop="price"], .product-price-value, .sales-price', { timeout: 10000 });
        } catch (e) {
          // Não encontrou seletor, mas segue tentando estratégias
        }

        // Captcha detection (sempre no início)
        let isCaptcha = await captchaHandler.detectCaptcha(page);
        if (isCaptcha) {
          failReasons.push('captcha detectado');
          // Captcha Handling Avançado: tenta bypass humano, JS/invisível, 2Captcha, etc
          const bypassed = await tryAdvancedCaptchaBypass(page, failReasons);
          if (bypassed) {
            isCaptcha = await captchaHandler.detectCaptcha(page);
          }
        }
        // Se ainda for captcha, desista desta tentativa
        if (isCaptcha) {
          failReasons.push('captcha não resolvido');
          throw new Error('Captcha detectado e não resolvido');
        }

        const html = await page.content();

        // Otimização: não recalcule domain aqui, já foi feito antes

        // Tenta cada estratégia em ordem de robustez
        for (const strategy of priceStrategies) {
          try {
            const { price, reasonIfFail, strategyName } = await strategy(page, html, domain);
            let priceNum = price;
            if (price && typeof price !== 'number') {
              const cleaned = String(price).replace(/[^\d,\.]/g, '').replace(',', '.');
              priceNum = Number(cleaned);
            }
            if (price && !isNaN(priceNum)) {
              // Sempre feche contexto/página mesmo em caso de sucesso
              try { await context.close(); } catch {}
              try { await browserPool.release(); } catch {}
              // Delay aleatório entre requests
              await new Promise(res => setTimeout(res, 1200 + Math.random() * 1200));
              return { success: true, price: priceNum, cached: false, failReasons, strategy: strategyName };
            }
            if (reasonIfFail) failReasons.push(reasonIfFail);
          } catch (err) {
            failReasons.push('Erro na estratégia: ' + (err.message || err));
          }
        }

        // Se chegou aqui, nenhuma estratégia funcionou
        // Salva HTML e screenshot para análise se falhar
        const failDir = path.join(__dirname, 'scrape_failures');
        if (!fs.existsSync(failDir)) fs.mkdirSync(failDir);
        const domainSafe = domain || 'unknown';
        const timestamp = Date.now();
        const failFile = path.join(failDir, `${timestamp}_${domainSafe.replace(/[^\w]/g, '_')}.html`);
        fs.writeFileSync(failFile, html);
        let screenshotFile = '';
        try {
          // Screenshot fullPage: true e com timestamp
          screenshotFile = path.join(failDir, `${timestamp}_${domainSafe.replace(/[^\w]/g, '_')}.png`);
          await page.screenshot({ path: screenshotFile, fullPage: true, timeout: 10000 });
        } catch (e) {
          // Ignore screenshot errors
        }

        failReasons.push(`Nenhuma estratégia funcionou. HTML/screenshot salvos em ${failDir}`);
        // Envia email com logs e capturas de tela
        await sendFailureEmail({ url, failFile, screenshotFile, failReasons });
        try { await context.close(); } catch {}
        try { await browserPool.release(); } catch {}
        // Delay aleatório entre requests
        await new Promise(res => setTimeout(res, 1200 + Math.random() * 1200));
        throw new Error(`Nenhuma estratégia funcionou. HTML/screenshot salvos em ${failDir}`);
      } catch (err) {
        // Loga erro do scraping
        failReasons.push('Erro geral no scraping: ' + (err.message || err));
        throw err;
      } finally {
        // Sempre feche contextos/páginas mesmo em caso de erro
        try { if (page) await page.close(); } catch {}
        try { if (context) await context.close(); } catch {}
        try { await browserPool.release(); } catch {}
      }
    }, 3, 1200, true, domain).catch(error => {
      lastError = error;
      return null;
    });

    // Reporta resultado ao circuit breaker
    circuitBreaker.report(domain, result && result.success);

    // Log detalhado de erros
    if (!result || !result.success) {
      logger('error', `Scraping failed for ${url} [${domain}]:`, lastError ? lastError.message : 'unknown');
      if (failReasons.length) logger('error', 'Fail reasons:', failReasons.join(' | '));
    }

    if (result && result.success) {
      return result;
    }
    failReasons.push(`proxy ${proxy || 'sem proxy'} falhou: ${lastError ? lastError.message : 'erro desconhecida'}`);
  }

  // Se chegou aqui, falhou com todos os proxies e estratégias
  return {
    success: false,
    error: lastError ? lastError.message : 'Falha desconhecida',
    failReasons
  };
}

// --- Escalabilidade e Paralelismo ---
// Limite de workers já configurável via MAX_WORKERS
const MAX_WORKERS = parseInt(process.env.MAX_WORKERS || '3', 10);

// Fila de tarefas para distribuir scraping entre múltiplos workers/processos
class TaskQueue {
  constructor(concurrency = MAX_WORKERS) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  push(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.next();
    });
  }

  next() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    const { task, resolve, reject } = this.queue.shift();
    this.running++;
    Promise.resolve()
      .then(task)
      .then(result => resolve(result))
      .catch(err => reject(err))
      .finally(() => {
        this.running--;
        this.next();
      });
  }
}

// Exemplo de uso da fila para scraping paralelo
async function parallelScrape(urls, captchaApiKey = null, concurrency = MAX_WORKERS) {
  const queue = new TaskQueue(concurrency);
  const results = [];
  await Promise.all(
    urls.map((url, idx) =>
      queue.push(() => scrapePrice(url, captchaApiKey)).then(r => { results[idx] = r; })
    )
  );
  return results;
}

// Silencie logs de D-Bus se quiser (opcional)
process.on('warning', (w) => {
  if (w.message && w.message.includes('Failed to connect to the bus')) return;
  console.warn(w);
});

// --- Atualização contínua de fingerprints e dependências ---
// Rotaciona fingerprints semanalmente (além do já existente a cada 6h)
setInterval(() => {
  fingerprintGenerator = new FingerprintGenClass({
    browsers: [{ name: 'chrome', minVersion: 100 }],
    devices: ['desktop'],
    operatingSystems: ['windows', 'linux'],
  });
  logger('info', '[AutoUpdate] Fingerprint rotacionado (semanal)');
}, 7 * 24 * 60 * 60 * 1000);

// Lembrete semanal para atualizar dependências
setInterval(() => {
  logger('info', '[AutoUpdate] Lembrete: execute "npm outdated" e "npm update" para manter dependências atualizadas.');
}, 7 * 24 * 60 * 60 * 1000);

// --- Monitoramento de mudanças nos sites-alvo ---
// Exemplo: loga quando um seletor falha repetidamente para facilitar ajuste rápido
const selectorFailureCount = {};
function reportSelectorFailure(domain, selector) {
  const key = `${domain}:${selector}`;
  selectorFailureCount[key] = (selectorFailureCount[key] || 0) + 1;
  if (selectorFailureCount[key] === 3) {
    logger('warn', `[Monitoramento] Seletor falhou 3x: ${selector} em ${domain}. Verifique se houve mudança no site.`);
  }
}

// Modifique as funções de extração para chamar reportSelectorFailure em caso de falha de seletor
// Exemplo para extractFromDomainSelectors:
PriceExtractor.prototype.extractFromDomainSelectors = async function(html, domain) {
  try {
    const $ = this._loadCheerio(html);
    for (const selector of this.domainSelectors[domain]) {
      const price = $(selector).first().text().replace(/[^\d,\.]/g, '').trim();
      if (price) return price;
      // Reporta falha de seletor
      reportSelectorFailure(domain, selector);
    }
  } catch (e) {}
  return null;
};

// --- Testes automatizados de scraping em ambiente de staging ---
// Exemplo: função para rodar testes automáticos (pode ser chamada via cron ou CI)
async function runStagingScrapeTests() {
  const testUrls = [
    // Adicione URLs reais de produtos de cada marketplace para teste
    'https://www.magazineluiza.com.br/produto-teste',
    'https://www.casasbahia.com.br/produto-teste',
    // ...outros marketplaces...
  ];
  for (const url of testUrls) {
    try {
      const result = await scrapePrice(url);
      if (!result.success) {
        logger('error', `[StagingTest] Falha ao extrair preço de ${url}:`, result.error);
      } else {
        logger('info', `[StagingTest] Sucesso: ${url} => R$${result.price}`);
      }
    } catch (e) {
      logger('error', `[StagingTest] Erro inesperado em ${url}:`, e.message);
    }
  }
}

// Exporte para uso externo ou agende via cron/CI
module.exports = { scrapePrice, parallelScrape, runStagingScrapeTests };