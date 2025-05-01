const { chromium } = require('playwright');
const cache = require('./cache');
require('dotenv').config();
const path = require('path');
const fs = require('fs');

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

const PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(',').map(p => p.trim()).filter(Boolean)
  : [];

const STORE_SELECTORS = {
  amazon: [
    '.a-price .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice', '#priceblock_saleprice',
    '[data-asin-price]', '.a-price-whole', '.a-price .a-price-fraction'
  ],
  mercadolivre: [
    '.andes-money-amount__fraction', '.price-tag-fraction', '[data-testid="price-value"]'
  ],
  casasbahia: [
    '.product-price-value', '.sales-price', '.price-template__text'
  ],
  magazineluiza: [
    '.price-template__text', '.sc-jTzLTM', '.sc-hSdWYo'
  ],
  kabum: [
    '.preco_desconto', '.finalPrice', '.priceCard'
  ],
  americanas: [
    '.src__BestPrice-sc-1jnodg2-5', '.price__SalesPrice-sc-1h6xw2i-2', '.sales-price'
  ]
};

function getStore(url) {
  const keys = Object.keys(STORE_SELECTORS);
  for (const k of keys) if (url.includes(k)) return k;
  return 'amazon';
}

function normalizePrice(text) {
  if (!text) return null;
  // Remove currency, spaces, etc.
  let cleaned = text.replace(/[\sR$\$€£]|(de:)/gi, '').replace(/\./g, '').replace(',', '.');
  let match = cleaned.match(/(\d+(\.\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1]);
}

async function withRetries(fn, retries = 5, delay = 2000) {
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

// Estratégias de extração por domínio
const STRATEGIES = {
  amazon: [
    // Seletor primário
    async (page) => {
      const sel = ['.a-price .a-offscreen', '#priceblock_ourprice', '#priceblock_dealprice', '#priceblock_saleprice', '[data-asin-price]', '.a-price-whole', '.a-price .a-price-fraction'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    // JSON-LD
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    // Regex fallback
    async (page) => {
      const html = await page.content();
      const match = html.match(/"priceblock_ourprice".*?R\$ ?([\d.,]+)/i) || html.match(/"price":"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  mercadolivre: [
    // Seletor primário (preço à vista)
    async (page) => {
      const sel = ['.andes-money-amount__fraction', '.price-tag-fraction', '[data-testid="price-value"]'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          // Verifica se há preço à vista destacado
          const avista = await page.$('.ui-pdp-price__second-line .andes-money-amount__fraction');
          if (avista) {
            const avistaText = await page.evaluate(el => el.textContent.trim(), avista);
            const price = normalizePrice(avistaText);
            if (price && !isNaN(price)) return price;
          }
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    // JSON-LD
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    // Regex fallback
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  magazineluiza: [
    // Seletor primário
    async (page) => {
      const sel = ['.price-template__text', '.sc-jTzLTM', '.sc-hSdWYo', '.sc-dcJsrY', '.sc-hUpaCq'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    // JSON-LD
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    // Regex fallback
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  americanas: [
    async (page) => {
      const sel = ['.src__BestPrice-sc-1jnodg2-5', '.price__SalesPrice-sc-1h6xw2i-2', '.sales-price', '.product-price-value'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  casasbahia: [
    async (page) => {
      const sel = ['.product-price-value', '.sales-price', '.price-template__text', '.src__BestPrice-sc-1jnodg2-5'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  kabum: [
    async (page) => {
      const sel = ['.preco_desconto', '.finalPrice', '.priceCard', '.sc-dcJsrY', '.sc-hUpaCq'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  pontofrio: [
    async (page) => {
      const sel = ['.product-price-value', '.sales-price', '.price-template__text', '.src__BestPrice-sc-1jnodg2-5'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  extra: [
    async (page) => {
      const sel = ['.product-price-value', '.sales-price', '.price-template__text', '.src__BestPrice-sc-1jnodg2-5'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  carrefour: [
    async (page) => {
      const sel = ['.product-price-value', '.sales-price', '.price-template__text', '.src__BestPrice-sc-1jnodg2-5'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ],
  fastshop: [
    async (page) => {
      const sel = ['.sales-price', '.finalPrice', '.price-template__text', '.src__BestPrice-sc-1jnodg2-5'];
      for (const s of sel) {
        try {
          await page.waitForSelector(s, { timeout: 6000 });
          const priceText = await page.$eval(s, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) return price;
        } catch {}
      }
      return null;
    },
    async (page) => {
      const ld = await page.$$eval('script[type="application/ld+json"]', nodes => nodes.map(n => n.innerText));
      for (const json of ld) {
        try {
          const data = JSON.parse(json);
          if (data && typeof data === 'object') {
            if (data.offers && data.offers.price) return parseFloat(data.offers.price);
            if (Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) return parseFloat(offer.price);
              }
            }
          }
        } catch {}
      }
      return null;
    },
    async (page) => {
      const html = await page.content();
      const match = html.match(/"price":\s*"?([\d.,]+)/i);
      if (match) return normalizePrice(match[1]);
      return null;
    }
  ]
};

// Mapeamento dinâmico de estratégia preferencial por domínio
const preferredStrategy = {};

// Detecta domínio a partir da URL
function getDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return 'amazon';
  }
}

async function scrapePrice(url) {
  const cached = cache.get(url);
  if (cached) return { success: true, price: cached, cached: true };

  // Detecta caminho do Chromium baixado pelo Playwright
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
    const userAgent = UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
    const proxy = PROXIES.length > 0
      ? PROXIES[Math.floor(Math.random() * PROXIES.length)]
      : null;

    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        ...(proxy ? [`--proxy-server=${proxy}`] : [])
      ],
      ...(executablePath ? { executablePath } : {})
    };

    const browser = await chromium.launch(launchOptions);
    let context;
    try {
      context = await browser.newContext({
        userAgent,
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

      const domain = getDomain(url);
      const strategies = STRATEGIES[domain] || STRATEGIES['amazon'];
      let price = null;
      let strategyIdx = preferredStrategy[domain] ?? 0;

      // 1. Tenta a estratégia preferencial
      if (strategies[strategyIdx]) {
        price = await strategies[strategyIdx](page);
      }

      // 2. Se falhar, tenta todas as estratégias e atualiza o perfil se encontrar uma melhor
      if (!price) {
        for (let i = 0; i < strategies.length; i++) {
          if (i === strategyIdx) continue;
          price = await strategies[i](page);
          if (price) {
            preferredStrategy[domain] = i;
            break;
          }
        }
      }

      if (price && !isNaN(price)) {
        cache.set(url, price);
        return { success: true, price, cached: false };
      }
      throw new Error('Price not found');
    } finally {
      if (context) await context.close();
      await browser.close();
    }
  }, 5, 2000).catch(error => {
    return { success: false, error: error.message || String(error) };
  });
}

module.exports = { scrapePrice };