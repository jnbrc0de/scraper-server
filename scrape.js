const { chromium } = require('playwright');
const cache = require('./cache');
require('dotenv').config();

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

async function scrapePrice(url) {
  const cached = cache.get(url);
  if (cached) return { success: true, price: cached, cached: true };

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
      ]
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

      const store = getStore(url);
      for (const selector of STORE_SELECTORS[store]) {
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          const priceText = await page.$eval(selector, el => el.textContent.trim());
          const price = normalizePrice(priceText);
          if (price && !isNaN(price)) {
            cache.set(url, price);
            return { success: true, price, cached: false };
          }
        } catch (err) {
          // Try next selector
        }
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