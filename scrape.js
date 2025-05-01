const { chromium } = require('playwright');
const cache = require('./cache');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const PriceExtractor = require('./extraction');
const extractor = new PriceExtractor();
const RenderOptimizer = require('./renderOptimizations');
const renderOptimizer = new RenderOptimizer();
renderOptimizer.startMemoryMonitoring();
const extractViaVarejoPrice = require('./extractors/viaVarejo');

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

/**
 * Executa uma função com tentativas e espera exponencial.
 * @param {Function} fn Função assíncrona a ser executada.
 * @param {number} retries Número de tentativas.
 * @param {number} delay Delay base em ms.
 */
async function withRetries(fn, retries = 5, delay = 800) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw lastError;
}

/**
 * Realiza o scraping de preço de um produto em uma URL.
 * Usa cache, browser headless, user-agent/proxy rotativo e extratores robustos.
 * @param {string} url URL do produto
 * @returns {Promise<{success: boolean, price?: number, cached?: boolean, error?: string}>}
 */
async function scrapePrice(url) {
  // Verifica cache em memória
  const cached = cache.get(url);
  if (cached) return { success: true, price: cached, cached: true };

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

  return await withRetries(async () => {
    // Seleciona user-agent e proxy aleatório
    const userAgent = UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
    const proxy = PROXIES.length > 0
      ? PROXIES[Math.floor(Math.random() * PROXIES.length)]
      : null;

    // Opções otimizadas para ambiente Render
    const baseLaunchOptions = renderOptimizer.getBrowserLaunchOptions();
    const launchOptions = {
      ...baseLaunchOptions,
      userAgent,
      args: [
        ...(baseLaunchOptions.args || []),
        ...(proxy ? [`--proxy-server=${proxy}`] : [])
      ],
      ...(executablePath ? { executablePath } : {})
    };

    // Inicia browser headless
    const browser = await chromium.launch(launchOptions);
    let context;
    try {
      // Cria contexto isolado com user-agent e viewport padrão
      context = await browser.newContext({
        userAgent,
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // Extrai HTML da página carregada
      const html = await page.content();
      const domain = (() => {
        try {
          const u = new URL(url);
          return u.hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();

      let price;
      // Usa extrator específico para Via Varejo (Casas Bahia, Ponto Frio, Extra)
      if (
        domain.includes('casasbahia.com.br') ||
        domain.includes('pontofrio.com.br') ||
        domain.includes('extra.com.br')
      ) {
        price = await extractViaVarejoPrice(page);
        if (!price) price = await extractor.extractPrice(html, domain);
      } else {
        price = await extractor.extractPrice(html, domain);
      }

      // Normaliza preço para número
      let priceNum = price;
      if (typeof price !== 'number') {
        const cleaned = String(price).replace(/[^\d,\.]/g, '').replace(',', '.');
        priceNum = Number(cleaned);
      }

      if (price && !isNaN(priceNum)) {
        cache.set(url, priceNum);
        return { success: true, price: priceNum, cached: false };
      }
      throw new Error('Price not found');
    } finally {
      // Fecha contexto e browser em paralelo para liberar recursos rapidamente
      await Promise.all([
        context ? context.close() : Promise.resolve(),
        browser.close()
      ]);
    }
  }, 5, 800).catch(error => {
    return { success: false, error: error.message || String(error) };
  });
}

module.exports = { scrapePrice };