/**
 * Token Harvester Worker
 * Runs in a separate process to periodically harvest reCAPTCHA tokens
 * for common sites to maintain a ready supply of valid tokens
 */
const { chromium } = require('playwright-extra');
const { stealthPlugin, getProxySettings } = require('../browser/stealthPlugin');
const logger = require('../../utils/logger');
const config = require('../../config');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;

// Register stealth plugin
chromium.use(stealthPlugin);

class TokenHarvester {
  constructor() {
    this.apiKey = config.captcha.apiKey;
    this.service = config.captcha.service;
    this.harvestInterval = config.captcha.harvestInterval;
    this.isRunning = false;
    this.sites = [
      // Example sites that commonly use reCAPTCHA
      // Each entry defines a site where we want to harvest tokens
      {
        url: 'https://www.example.com/product/123',
        sitekey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI', // This is Google's test key
        domain: 'example.com',
        tokens: []
      }
      // Add more sites as needed
    ];
  }

  /**
   * Start the token harvesting process
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Token harvester is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting token harvester');

    // Run the first harvest immediately
    await this._harvestTokens();

    // Then schedule periodic harvesting
    this.intervalId = setInterval(async () => {
      try {
        await this._harvestTokens();
      } catch (error) {
        logger.error('Error in scheduled token harvesting', {}, error);
      }
    }, this.harvestInterval);
  }

  /**
   * Stop the token harvesting process
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    logger.info('Token harvester stopped');
  }

  /**
   * Harvest tokens for all configured sites
   * @private
   */
  async _harvestTokens() {
    logger.info('Starting token harvest cycle');

    // Process each site
    for (const site of this.sites) {
      try {
        // Clean up expired tokens
        const now = Date.now();
        site.tokens = site.tokens.filter(token => token.expiresAt > now);

        // Check if we need more tokens (keep up to 5 valid tokens per site)
        if (site.tokens.length >= 5) {
          logger.debug('Sufficient tokens available', { site: site.domain });
          continue;
        }

        logger.info('Harvesting tokens', { site: site.domain, url: site.url });
        
        // Solve with external service
        if (this.service === '2captcha') {
          await this._harvestWithExternalService(site);
        } else {
          // Solve with browser automation
          await this._harvestWithBrowser(site);
        }
      } catch (error) {
        logger.error('Error harvesting tokens for site', { site: site.domain }, error);
      }
    }

    logger.info('Token harvest cycle completed');
  }

  /**
   * Harvest tokens using an external captcha service
   * @param {Object} site - Site configuration
   * @private
   */
  async _harvestWithExternalService(site) {
    if (!this.apiKey) {
      logger.warn('No API key configured for external service');
      return;
    }

    try {
      // Request token from 2Captcha
      const createTaskResponse = await axios.post(`https://2captcha.com/in.php`, null, {
        params: {
          key: this.apiKey,
          method: 'userrecaptcha',
          googlekey: site.sitekey,
          pageurl: site.url,
          json: 1
        }
      });

      if (createTaskResponse.data.status !== 1) {
        throw new Error(`Failed to create captcha task: ${createTaskResponse.data.error_text}`);
      }

      const taskId = createTaskResponse.data.request;
      logger.debug('Created reCAPTCHA task', { taskId, site: site.domain });

      // Wait for results with exponential backoff
      let retries = 0;
      const maxRetries = 12;
      let delay = 5000;

      while (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));

        const resultResponse = await axios.get(`https://2captcha.com/res.php`, {
          params: {
            key: this.apiKey,
            action: 'get',
            id: taskId,
            json: 1
          }
        });

        if (resultResponse.data.status === 1) {
          const token = resultResponse.data.request;
          
          // Add to site tokens
          site.tokens.push({
            token,
            createdAt: Date.now(),
            expiresAt: Date.now() + 110000 // 1m50s
          });

          // Report to the main process/API
          await this._reportToken(site.domain, site.sitekey, token);
          
          logger.info('Successfully harvested token', { site: site.domain });
          return;
        } else if (resultResponse.data.request !== 'CAPCHA_NOT_READY') {
          throw new Error(`Captcha solving failed: ${resultResponse.data.request}`);
        }

        retries++;
        delay = Math.min(delay * 1.5, 20000);
      }

      throw new Error('Captcha solving timed out');
    } catch (error) {
      logger.error('Error harvesting token with external service', { site: site.domain }, error);
    }
  }

  /**
   * Harvest tokens using browser automation
   * @param {Object} site - Site configuration
   * @private
   */
  async _harvestWithBrowser(site) {
    let browser = null;
    let context = null;
    let page = null;

    try {
      // Launch browser
      browser = await chromium.launch({
        headless: true
      });

      // Create context with stealth
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        viewport: { width: 1280, height: 720 },
      });

      // Create page
      page = await context.newPage();

      // Navigate to the site
      await page.goto(site.url, { waitUntil: 'networkidle' });

      // Find and solve reCAPTCHA
      const hasCaptcha = await page.evaluate((sitekey) => {
        return !!document.querySelector(`.g-recaptcha[data-sitekey="${sitekey}"]`);
      }, site.sitekey);

      if (!hasCaptcha) {
        logger.warn('No captcha found on page', { url: site.url });
        return;
      }

      // Wait for reCAPTCHA iframe to load
      await page.waitForSelector('iframe[src*="recaptcha"]');

      // Implement logic to click checkbox and extract token
      // This is a complex task and often requires external services anyway
      
      // For this example, we'll just log that manual solving would be needed
      logger.info('Browser-based token harvesting would require manual solving');
      
    } catch (error) {
      logger.error('Error harvesting token with browser', { site: site.domain }, error);
    } finally {
      // Clean up resources
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }

  /**
   * Report harvested token to main process
   * @param {string} domain - Site domain
   * @param {string} sitekey - reCAPTCHA sitekey
   * @param {string} token - Harvested token
   * @private
   */
  async _reportToken(domain, sitekey, token) {
    try {
      // In a real implementation, this might:
      // 1. Post to an internal API endpoint
      // 2. Use IPC if this is a child process
      // 3. Write to a shared database
      
      // For this example, we'll just write to a file
      const tokensDir = path.resolve(process.cwd(), 'tokens');
      await fs.mkdir(tokensDir, { recursive: true }).catch(() => {});
      
      const tokenFile = path.join(tokensDir, `${domain}.json`);
      
      // Read existing tokens
      let tokens = [];
      try {
        const content = await fs.readFile(tokenFile, 'utf-8');
        tokens = JSON.parse(content);
      } catch (e) {
        // File might not exist yet
      }
      
      // Add new token
      tokens.push({
        sitekey,
        token,
        createdAt: Date.now(),
        expiresAt: Date.now() + 110000 // 1m50s
      });
      
      // Remove expired tokens
      const now = Date.now();
      tokens = tokens.filter(t => t.expiresAt > now);
      
      // Save back to file
      await fs.writeFile(tokenFile, JSON.stringify(tokens, null, 2));
      
      logger.debug('Token saved to file', { domain, file: tokenFile });
    } catch (error) {
      logger.error('Error reporting token', { domain }, error);
    }
  }
}

// Create and export a singleton instance
const harvester = new TokenHarvester();

// Export the singleton
module.exports = harvester;

// If this file is run directly, start the harvester
if (require.main === module) {
  const dotenv = require('dotenv');
  dotenv.config();
  
  harvester.start()
    .catch(error => {
      console.error('Failed to start token harvester:', error);
      process.exit(1);
    });
} 