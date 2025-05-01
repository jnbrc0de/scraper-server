const playwright = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth')();
playwright.use(StealthPlugin);
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

/**
 * Executa uma função com tentativas e espera exponencial.
 * Agora, a cada retry, troca user-agent e proxy (se disponível).
 * @param {Function} fn Função assíncrona a ser executada.
 * @param {number} retries Número de tentativas.
 * @param {number} delay Delay base em ms.
 */
async function withRetries(fn, retries = 6, delay = 1200) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastError = e;
      // Espera exponencial + jitter
      const jitter = Math.floor(Math.random() * 500);
      await new Promise(r => setTimeout(r, delay * (i + 1) + jitter));
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
  let proxiesToTry = PROXIES.length > 0 ? [...PROXIES] : [null];
  let lastError = null;

  // Tenta cada proxy disponível
  for (let proxyIdx = 0; proxyIdx < proxiesToTry.length; proxyIdx++) {
    const proxy = proxiesToTry[proxyIdx];

    const result = await withRetries(async (retryAttempt) => {
      // Troca user-agent e proxy a cada retry
      const userAgent = UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
      const currentProxy = PROXIES.length > 0
        ? PROXIES[Math.floor(Math.random() * PROXIES.length)]
        : proxy;

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
      try {
        browser = await getBrowser(launchOptions);
        context = await browser.newContext({
          userAgent,
          viewport: { width: 1280, height: 800 },
          ignoreHTTPSErrors: true
        });

        // Ignora rotas inúteis (imagens, fontes, analytics, ads, etc)
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

        page = await context.newPage();

        // Headers realistas
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

        // Timeout aumentado para 90 segundos
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

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
          // 1. Tenta bypass manual (simulação humana)
          const bypassed = await captchaHandler.bypassWithoutService(page);
          if (bypassed) {
            failReasons.push('captcha contornado com simulação humana');
            isCaptcha = await captchaHandler.detectCaptcha(page);
          }
        }
        // 2. Se ainda for captcha, tenta 2Captcha se chave disponível
        if (isCaptcha && process.env.CAPTCHA_API_KEY) {
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
                isCaptcha = await captchaHandler.detectCaptcha(page);
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
        // Se ainda for captcha, desista desta tentativa
        if (isCaptcha) {
          failReasons.push('captcha não resolvido');
          throw new Error('Captcha detectado e não resolvido');
        }

        const html = await page.content();
        const domain = (() => {
          try {
            const u = new URL(url);
            return u.hostname.replace(/^www\./, '');
          } catch {
            return '';
          }
        })();

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
          screenshotFile = path.join(failDir, `${timestamp}_${domainSafe.replace(/[^\w]/g, '_')}.png`);
          await page.screenshot({ path: screenshotFile, fullPage: true, timeout: 10000 });
        } catch (e) {
          // Ignore screenshot errors
        }

        failReasons.push(`Nenhuma estratégia funcionou. HTML/screenshot salvos em ${failDir}`);
        // Envia email com logs e capturas de tela
        await sendFailureEmail({ url, failFile, screenshotFile, failReasons });
        throw new Error(`Nenhuma estratégia funcionou. HTML/screenshot salvos em ${failDir}`);
      } catch (err) {
        // Loga erro do scraping
        failReasons.push('Erro geral no scraping: ' + (err.message || err));
        throw err;
      } finally {
        if (page) {
          try { await page.close(); } catch {}
        }
        if (context) {
          try { await context.close(); } catch {}
        }
        // NÃO fecha o browser global aqui!
      }
    }, 3, 2000).catch(error => { // 3 tentativas por proxy, delay maior
      lastError = error;
      return null;
    });

    if (result && result.success) {
      return result;
    }
    failReasons.push(`proxy ${proxy || 'sem proxy'} falhou: ${lastError ? lastError.message : 'erro desconhecido'}`);
  }

  // Se chegou aqui, falhou com todos os proxies e estratégias
  return {
    success: false,
    error: lastError ? lastError.message : 'Falha desconhecida',
    failReasons
  };
}

module.exports = { scrapePrice };