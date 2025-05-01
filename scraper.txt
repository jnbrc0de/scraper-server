const { chromium } = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth')();
const randomUseragent = require('random-useragent');
const proxies = [
    // Adicione proxies gratuitos ou baratos aqui, formato: 'http://user:pass@ip:port'
    // Exemplo: 'http://username:password@proxy1.com:8080'
];
const MAX_RETRIES = 5;

chromium.use(StealthPlugin);

async function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

async function getPageWithStealth(proxy = null) {
    const launchOptions = {
        headless: true,
        args: [],
    };
    if (proxy) {
        launchOptions.proxy = { server: proxy };
    }
    let browser, context, page;
    try {
        browser = await chromium.launch(launchOptions);
        context = await browser.newContext({
            userAgent: randomUseragent.getRandom(),
            viewport: { width: 1280, height: 800 },
        });
        await context.route('**/*', (route) => {
            const req = route.request();
            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                route.abort();
            } else {
                route.continue();
            }
        });
        page = await context.newPage();
        return { browser, page };
    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        throw err;
    }
}

async function scrape(url) {
    let attempt = 0;
    let lastError = null;
    while (attempt < MAX_RETRIES) {
        const proxy = proxies.length ? proxies[Math.floor(Math.random() * proxies.length)] : null;
        let browser, page;
        try {
            ({ browser, page } = await getPageWithStealth(proxy));
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            // ... scraping logic ...
            const content = await page.content();
            await browser.close();
            // Delay aleatório entre 2 e 5 segundos
            await delay(2000 + Math.random() * 3000);
            return content;
        } catch (err) {
            lastError = err;
            attempt++;
            if (page) await page.close().catch(() => {});
            if (browser) await browser.close().catch(() => {});
            // Delay curto antes de tentar novamente
            await delay(1000 + Math.random() * 2000);
        }
    }
    console.error('Scrape failed after max retries:', lastError && lastError.message);
    throw lastError;
}

module.exports = { scrape };
