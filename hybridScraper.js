const axios = require('axios');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth')();
const randomUseragent = require('random-useragent');
const fs = require('fs');
const path = require('path');
const FingerprintGenerator = require('fingerprint-generator');
const fetch = require('node-fetch'); // Para integração com 2Captcha
const EventEmitter = require('events');
const logEmitter = new EventEmitter();
const crypto = require('crypto');
const HttpsProxyAgent = require('https-proxy-agent');

chromium.use(StealthPlugin);

// ====== Configurações de segurança ======
const CACHE_KEY = process.env.CACHE_KEY || crypto.randomBytes(32).toString('hex'); // Troque por uma chave forte em produção
const LOG_KEY = process.env.LOG_KEY || crypto.randomBytes(32).toString('hex');
const CACHE_TTL_DAYS = 7;
const LOG_MAX_FILES = 10;
const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY; // Defina via variável de ambiente

// ====== Proxy seguro ======
let proxies = [
    'http://xnodtehg:b87riy6ow5mz@45.127.248.127:5128',
    'http://xnodtehg:b87riy6ow5mz@198.23.239.134:6540',
    'http://xnodtehg:b87riy6ow5mz@38.153.152.244:9594',
    'http://xnodtehg:b87riy6ow5mz@86.38.234.176:6630',
    'http://xnodtehg:b87riy6ow5mz@173.211.0.148:6641',
    'http://xnodtehg:b87riy6ow5mz@216.10.27.159:6837',
    'http://xnodtehg:b87riy6ow5mz@154.36.110.199:6853',
    'http://xnodtehg:b87riy6ow5mz@45.151.162.198:6600',
    'http://xnodtehg:b87riy6ow5mz@188.74.210.21:6100'
];

let proxyStats = proxies.map(proxy => ({
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
    } else {
        stat.fails += 1;
        if (stat.fails >= 3) stat.blocked = true;
    }
}

// ====== Cache criptografado ======
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

function encrypt(text, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}
function decrypt(text, key) {
    const [iv, encrypted] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
function getCachePath(url) {
    return path.join(CACHE_DIR, crypto.createHash('sha256').update(url).digest('hex') + '.cache');
}
function saveCache(url, html) {
    const encrypted = encrypt(html, CACHE_KEY);
    fs.writeFileSync(getCachePath(url), encrypted);
}
function loadCache(url) {
    const file = getCachePath(url);
    if (fs.existsSync(file)) {
        try {
            const encrypted = fs.readFileSync(file, 'utf-8');
            return decrypt(encrypted, CACHE_KEY);
        } catch {
            return null;
        }
    }
    return null;
}
function cleanOldCache() {
    const now = Date.now();
    fs.readdirSync(CACHE_DIR).forEach(file => {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        if ((now - stats.mtimeMs) > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
            fs.unlinkSync(filePath);
        }
    });
}
cleanOldCache();

// ====== Logs criptografados e rotação ======
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

function getLogPath() {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(LOG_DIR, `log-${date}.log`);
}
function rotateLogs() {
    const files = fs.readdirSync(LOG_DIR).sort();
    while (files.length > LOG_MAX_FILES) {
        fs.unlinkSync(path.join(LOG_DIR, files.shift()));
    }
}
function structuredLog(event, data = {}) {
    const logObj = {
        timestamp: new Date().toISOString(),
        event,
        ...data
    };
    const encrypted = encrypt(JSON.stringify(logObj), LOG_KEY);
    fs.appendFileSync(getLogPath(), encrypted + '\n');
    rotateLogs();
    logEmitter.emit(event, logObj);
}

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getRandomProxy() {
    if (!proxies.length) return null;
    // Remove proxies bloqueados
    const available = proxies.filter(p => {
        const stat = proxyStats.find(s => s.proxy === p);
        return !stat || !stat.blocked;
    });
    if (!available.length) return null;
    return available[Math.floor(Math.random() * available.length)];
}

function getRandomHeaders() {
    return {
        'User-Agent': randomUseragent.getRandom(),
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Connection': 'keep-alive',
        // ...outros headers se necessário...
    };
}

async function delay(min = 1500, max = 3500) {
    const ms = Math.floor(Math.random() * (max - min)) + min;
    return new Promise(res => setTimeout(res, ms));
}

async function tryHttpScrape(url) {
    try {
        const proxy = getRandomProxy();
        const options = {
            headers: getRandomHeaders(),
            timeout: 15000,
        };
        if (proxy) {
            options.httpsAgent = new HttpsProxyAgent(proxy);
        }
        const res = await axios.get(url, options);
        if (
            res.status === 200 &&
            res.data &&
            !/captcha|robot|blocked|Desculpe|Acesse/i.test(res.data)
        ) {
            log('HTTP scrape bem-sucedido');
            return res.data;
        }
        throw new Error('Blocked or captcha detected');
    } catch (err) {
        log('HTTP scrape falhou: ' + err.message);
        return null;
    }
}

async function simulateHumanInteraction(page) {
    // Movimenta o mouse em pontos aleatórios
    await page.mouse.move(100 + Math.random() * 500, 200 + Math.random() * 200, { steps: 10 });
    await page.waitForTimeout(500 + Math.random() * 500);
    await page.mouse.move(300 + Math.random() * 300, 400 + Math.random() * 200, { steps: 8 });
    // Scrolla a página
    await page.mouse.wheel(0, 200 + Math.random() * 300);
    await page.waitForTimeout(500 + Math.random() * 500);
}

// ====== Captcha seguro ======
async function solveCaptcha2Captcha(page, apiKey) {
    if (!apiKey) throw new Error('2Captcha API key not set');
    // Exemplo para reCAPTCHA v2 (ajuste conforme o captcha encontrado)
    const sitekey = await page.evaluate(() => {
        const el = document.querySelector('[data-sitekey]');
        return el ? el.getAttribute('data-sitekey') : null;
    });
    if (!sitekey) return false;

    const url = page.url();
    // Solicita solução ao 2Captcha
    const req = await fetch(`http://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${url}`);
    const reqText = await req.text();
    const captchaId = reqText.split('|')[1];
    // Aguarda solução
    let token = null;
    for (let i = 0; i < 20; i++) {
        await new Promise(res => setTimeout(res, 5000));
        const res = await fetch(`http://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}`);
        const resText = await res.text();
        if (resText.startsWith('OK|')) {
            token = resText.split('|')[1];
            break;
        }
    }
    if (!token) {
        structuredLog('captcha_failed', { url: page.url() });
        return false;
    }
    // Insere o token no formulário do reCAPTCHA
    await page.evaluate((token) => {
        document.querySelector('textarea[g-recaptcha-response]').value = token;
    }, token);
    // Submete o formulário (ajuste conforme necessário)
    await page.click('button[type=submit], input[type=submit]');
    await page.waitForTimeout(5000);
    return true;
}

const fingerprintGenerator = new FingerprintGenerator({
    browsers: [{ name: 'chrome', minVersion: 100 }],
    devices: ['desktop'],
    operatingSystems: ['windows', 'linux'],
});

// ====== Gerenciamento de erros robusto ======
async function tryBrowserScrape(url, captchaApiKey = null, customProxy = null) {
    let proxy = customProxy || getBestProxy();
    let lastError = null;
    let triedProxies = new Set();
    // Tenta com proxy, se falhar, tenta sem proxy
    for (let attempt = 0; attempt < (proxies.length || 1) + 1; attempt++) {
        const launchOptions = {
            headless: true,
            args: [],
        };
        if (proxy) {
            launchOptions.proxy = { server: proxy };
        }
        // Gera fingerprint realista
        const fingerprint = fingerprintGenerator.getFingerprint();
        let browser, context, page;
        try {
            browser = await chromium.launch(launchOptions);
            context = await browser.newContext({
                userAgent: fingerprint.headers['user-agent'],
                viewport: fingerprint.screen,
                locale: fingerprint.languages[0],
                ...fingerprint.navigator,
            });
            await context.addInitScript(fingerprint.injectable);
            await context.route('**/*', (route) => {
                const req = route.request();
                if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                    route.abort();
                } else {
                    route.continue();
                }
            });
            page = await context.newPage();
            const start = Date.now();
            let html = null;
            let success = false;
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await simulateHumanInteraction(page);
                // Detecta captcha e tenta resolver
                if (captchaApiKey && (await page.content()).includes('g-recaptcha')) {
                    await solveCaptcha2Captcha(page, captchaApiKey);
                }
                html = await page.content();
                success = true;
                structuredLog('browser_scrape_success', { url });
                log('Browser scrape bem-sucedido');
            } catch (err) {
                structuredLog('browser_scrape_error', { url, error: err.message });
                log('Browser scrape falhou: ' + err.message);
                lastError = err;
                // Se erro for de proxy, marca como bloqueado e tenta sem proxy
                if (proxy && /ERR_PROXY_CONNECTION_FAILED|proxy/i.test(err.message)) {
                    const stat = proxyStats.find(p => p.proxy === proxy);
                    if (stat) stat.blocked = true;
                    triedProxies.add(proxy);
                    proxy = getBestProxy();
                    if (!proxy || triedProxies.has(proxy)) proxy = null; // fallback sem proxy
                    continue;
                }
            }
            const latency = Date.now() - start;
            if (proxy) reportProxyResult(proxy, success, latency);
            return html;
        } catch (err) {
            structuredLog('browser_scrape_error', { url, error: err.message });
            lastError = err;
        } finally {
            if (page) await page.close().catch(() => {});
            if (context) await context.close().catch(() => {});
            if (browser) await browser.close().catch(() => {});
        }
        break; // se não for erro de proxy, não tenta novamente
    }
    return null;
}

let metrics = {
    total: 0,
    success: 0,
    fail: 0,
    blocked: 0,
    byMarketplace: {}
};

function structuredLog(event, data = {}) {
    const logObj = {
        timestamp: new Date().toISOString(),
        event,
        ...data
    };
    console.log(JSON.stringify(logObj));
    logEmitter.emit(event, logObj);
}

// ====== Monitoramento de bloqueios em tempo real ======
logEmitter.on('scrape_result', (logObj) => {
    if (logObj.blocked) {
        structuredLog('alert_blocked', {
            url: logObj.url,
            marketplace: logObj.marketplace,
            timestamp: logObj.timestamp
        });
        // Aqui você pode integrar com sistemas de alerta (email, Slack, etc)
    }
});

// ====== Atualização automática de fingerprints ======
setInterval(() => {
    fingerprintGenerator = new FingerprintGenerator({
        browsers: [{ name: 'chrome', minVersion: 100 }],
        devices: ['desktop'],
        operatingSystems: ['windows', 'linux'],
    });
    structuredLog('fingerprint_rotated', { timestamp: new Date().toISOString() });
}, 6 * 60 * 60 * 1000);

function updateMetrics(marketplace, success, blocked = false) {
    metrics.total++;
    if (!metrics.byMarketplace[marketplace]) {
        metrics.byMarketplace[marketplace] = { total: 0, success: 0, fail: 0, blocked: 0 };
    }
    metrics.byMarketplace[marketplace].total++;
    if (success) {
        metrics.success++;
        metrics.byMarketplace[marketplace].success++;
    } else {
        metrics.fail++;
        metrics.byMarketplace[marketplace].fail++;
        if (blocked) {
            metrics.blocked++;
            metrics.byMarketplace[marketplace].blocked++;
        }
    }
}

function getMarketplace(url) {
    if (!url || typeof url !== 'string') return 'outro';
  
    const map = [
      { domain: 'amazon.com.br', name: 'amazon' },
      { domain: 'magazineluiza.com.br', name: 'magalu' },
      { domain: 'mercadolivre.com.br', name: 'mercadolivre' },
      { domain: 'americanas.com.br', name: 'americanas' },
      { domain: 'kabum.com.br', name: 'kabum' },
      { domain: 'casasbahia.com.br', name: 'casasbahia' },
      { domain: 'shopee.com.br', name: 'shopee' },
      { domain: 'pontofrio.com.br', name: 'pontofrio' },
      { domain: 'submarino.com.br', name: 'submarino' },
      { domain: 'extra.com.br', name: 'extra' },
      { domain: 'carrefour.com.br', name: 'carrefour' },
      { domain: 'fastshop.com.br', name: 'fastshop' }
    ];
  
    const found = map.find(entry => url.includes(entry.domain));
    return found ? found.name : 'outro';
  }
  

// ====== Parsers com sanitização ======
function sanitize(str) {
    return String(str).replace(/[<>"'`]/g, '');
}
const parsers = {
    amazon: html => {
        const match = html.match(/"priceblock_ourprice".*?R\$ ([\d.,]+)/);
        return match ? { price: sanitize(match[1]) } : null;
    },
    magalu: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    mercadolivre: html => {
        // Tenta pegar preço à vista destacado
        let match = html.match(/"price":\s*"?([\d.,]+)/i);
        if (match) return { price: sanitize(match[1]) };
        // Fallback para outros padrões
        match = html.match(/<span[^>]*class="andes-money-amount__fraction"[^>]*>([\d.]+)<\/span>/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    americanas: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    casasbahia: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    kabum: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    pontofrio: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    extra: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    carrefour: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    fastshop: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    shopee: html => {
        const match = html.match(/"price":\s*"?([\d.,]+)/i);
        return match ? { price: sanitize(match[1]) } : null;
    },
    outro: html => null
};

async function hybridScrape(url, useCache = true, captchaApiKey = null) {
    if (useCache) {
        const cached = loadCache(url);
        if (cached) {
            log('Cache hit');
            return cached;
        }
    }
    const marketplace = getMarketplace(url);
    let html = await tryHttpScrape(url);
    let blocked = false;
    if (!html) {
        html = await tryBrowserScrape(url, captchaApiKey);
        blocked = !html;
    }
    if (html && useCache) saveCache(url, html);
    // Delay aleatório entre requests
    await delay();
    // Logging e métricas
    const parsed = parsers[marketplace] ? parsers[marketplace](html || '') : null;
    structuredLog('scrape_result', {
        url,
        marketplace,
        success: !!html,
        blocked,
        parsed
    });
    updateMetrics(marketplace, !!html, blocked);
    return { html, parsed };
}

function getMetrics() {
    return metrics;
}

// ====== Paralelismo seguro ======
const MAX_WORKERS = parseInt(process.env.MAX_WORKERS || '3', 10);
async function parallelScrape(urls, captchaApiKey = null, concurrency = MAX_WORKERS) {
    const results = [];
    let idx = 0;
    async function worker() {
        while (idx < urls.length) {
            const myIdx = idx++;
            const url = urls[myIdx];
            const html = await hybridScrape(url, true, captchaApiKey);
            results[myIdx] = html;
        }
    }
    await Promise.all(Array(concurrency).fill(0).map(worker));
    return results;
}

// ====== Lembrete de revisão de dependências ======
function remindDependencyUpdate() {
    const lastCheckFile = path.join(__dirname, '.last_dep_check');
    let lastCheck = 0;
    if (fs.existsSync(lastCheckFile)) {
        lastCheck = parseInt(fs.readFileSync(lastCheckFile, 'utf-8'), 10);
    }
    const now = Date.now();
    // Lembrete a cada 7 dias
    if (now - lastCheck > 7 * 24 * 60 * 60 * 1000) {
        structuredLog('dependency_update_reminder', {
            message: 'Revisar e atualizar dependências com "npm outdated" e "npm update".',
            timestamp: new Date().toISOString()
        });
        fs.writeFileSync(lastCheckFile, now.toString());
    }
}
remindDependencyUpdate();

// ====== Exportação segura ======
module.exports = { hybridScrape, parallelScrape, getMetrics, logEmitter };

// ====== Dependências ======
// Mantenha todas as dependências SEMPRE atualizadas e monitore CVEs.


