/**
 * Enhanced Stealth Plugin
 * Provides advanced anti-detection measures for browser automation
 * Extends standard evasion with human-like behavior and consistent fingerprinting
 */
const playwright = require('playwright');
const logger = require('../../utils/logger');
const config = require('../../config');

// Load plugin helper to ensure dependencies are properly resolved
const pluginHelper = require('../../utils/pluginHelper');
pluginHelper.setupPluginDependencyResolution();

// Initialize playwright-extra with stealth plugin
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(playwright.chromium);
  
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  const plugin = createEnhancedStealthPlugin(StealthPlugin);
  chromium.use(plugin);
  logger.info('Stealth plugin initialized successfully');
} catch (error) {
  logger.error('Failed to initialize stealth plugin, using vanilla playwright:', error.message);
  chromium = playwright.chromium;
}

/**
 * BrightData proxy configuration
 * Using residential proxy with port 33335 as required by the new certificate
 */
const PROXY_CONFIG = config.proxy?.brightData || {
  server: 'brd.superproxy.io:33335',
  username: 'brd-customer-hl_aa4b1775-zone-residential_proxy1',
  password: '15blqlg7ljnm'
};

/**
 * Creates an enhanced stealth plugin with additional protections
 * @param {Function} StealthPlugin - The stealth plugin constructor
 * @returns {Object} - Enhanced stealth plugin
 */
function createEnhancedStealthPlugin(StealthPlugin) {
  try {
    const plugin = StealthPlugin();
    
    // Add required properties for playwright-extra compatibility
    plugin._isPuppeteerExtraPlugin = true;
    plugin.name = 'stealth-plugin';
    
    // Add required hooks
    plugin.beforeLaunch = async () => {};
    plugin.afterLaunch = async () => {};
    
    plugin.onPageCreated = async (page) => {
      await page.addInitScript(() => {
        // Override webdriver property
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        // Add chrome object if missing
        if (!window.chrome) {
          window.chrome = {};
        }
        
        // Add chrome.runtime if missing
        if (!window.chrome.runtime) {
          window.chrome.runtime = {};
        }
      });
    };
    
    return plugin;
  } catch (e) {
    logger.error('Error creating enhanced stealth plugin:', e.message);
    return {
      name: 'minimal-stealth-plugin',
      _isPuppeteerExtraPlugin: true,
      beforeLaunch: async () => {},
      afterLaunch: async () => {},
      onPageCreated: async () => {}
    };
  }
}

/**
 * Applies enhanced evasion techniques to a page
 * @param {import('playwright').Page} page - Playwright page
 * @param {Object} fingerprint - Consistent fingerprint data
 * @returns {Promise<void>}
 */
async function applyEnhancedEvasions(page, fingerprint) {
  try {
    if (!page || typeof page.evaluate !== 'function') {
      logger.warn('Invalid page object passed to applyEnhancedEvasions');
      return;
    }
    
    // Inject fingerprint data
    await page.evaluate((fp) => {
      window._fingerprintData = fp;
    }, fingerprint);
  
    // Override navigator properties
    await page.evaluate(() => {
      const fp = window._fingerprintData;
      
      // Override common navigator properties
      const properties = {
        deviceMemory: fp.deviceMemory,
        hardwareConcurrency: fp.hardwareConcurrency,
        platform: fp.platform,
        maxTouchPoints: fp.maxTouchPoints,
        doNotTrack: fp.doNotTrack
      };
      
      Object.entries(properties).forEach(([key, value]) => {
        if (key in navigator) {
          Object.defineProperty(navigator, key, {
            get: () => value,
            configurable: true
          });
        }
      });
    });
    
    // Enhanced WebGL fingerprinting protection
    await page.evaluate(() => {
      const fp = window._fingerprintData;
      
      const getParameterProxyHandler = {
        apply: function(target, thisArg, args) {
          const param = args[0];
          
          if (param === thisArg.VENDOR) return fp.vendor;
          if (param === thisArg.RENDERER) return fp.renderer;
          
          return target.apply(thisArg, args);
        }
      };
      
      ['WebGLRenderingContext', 'WebGL2RenderingContext'].forEach(webglType => {
        if (window[webglType]) {
          const originalGetParameter = window[webglType].prototype.getParameter;
          window[webglType].prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);
        }
      });
    });
    
    // Add Canvas noise
    await page.evaluate(() => {
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        const imageData = originalGetImageData.apply(this, args);
        const data = imageData.data;
        
        // Add subtle noise to canvas data
        for (let i = 0; i < data.length; i += 4) {
          data[i] = data[i] + (Math.random() * 2 - 1);
          data[i + 1] = data[i + 1] + (Math.random() * 2 - 1);
          data[i + 2] = data[i + 2] + (Math.random() * 2 - 1);
        }
        
        return imageData;
      };
    });
    
    logger.debug('Enhanced evasions applied successfully');
  } catch (error) {
    logger.error('Error applying enhanced evasions:', error);
  }
}

/**
 * Gets proxy settings for a browser launch
 * @returns {Object|null} - Proxy configuration or null if disabled
 */
function getProxySettings() {
  if (!config.proxy?.enabled) return null;
  
  return {
    server: config.proxy.server || 'brd.superproxy.io:33335',
    username: config.proxy.username,
    password: config.proxy.password
  };
}

module.exports = {
  chromium,
  applyEnhancedEvasions,
  getProxySettings
}; 