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

// Try to load playwright-extra safely
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(playwright.chromium);
  
  // Load StealthPlugin safely
  try {
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    // Initialize stealth plugin with enhanced features
    const plugin = createEnhancedStealthPlugin(StealthPlugin);
    chromium.use(plugin);
    logger.info('Stealth plugin initialized successfully');
  } catch (stealthError) {
    logger.error('Failed to load stealth plugin, using vanilla playwright:', stealthError.message);
    // Fall back to vanilla playwright if stealth plugin fails
    chromium = playwright.chromium;
  }
} catch (error) {
  logger.error('Failed to initialize playwright-extra, falling back to vanilla playwright:', error.message);
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
    // Start with the base stealth plugin
    const plugin = StealthPlugin();
    
    // Add required properties to make it compatible with playwright-extra
    if (!plugin._isPuppeteerExtraPlugin) {
      plugin._isPuppeteerExtraPlugin = true;
    }
    
    if (!plugin.name) {
      plugin.name = 'stealth-plugin';
    }
    
    // Add required hooks if missing
    if (typeof plugin.beforeLaunch !== 'function') {
      plugin.beforeLaunch = async () => {};
    }
    
    if (typeof plugin.afterLaunch !== 'function') {
      plugin.afterLaunch = async () => {};
    }
    
    if (typeof plugin.onPageCreated !== 'function') {
      plugin.onPageCreated = async (page) => {
        // Apply basic evasions
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
    }
    
    return plugin;
  } catch (e) {
    logger.error('Error creating enhanced stealth plugin:', e.message);
    // Return a minimal non-functional plugin to avoid crashing
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
    // Verify page is valid
    if (!page || typeof page.evaluate !== 'function') {
      logger.warn('Invalid page object passed to applyEnhancedEvasions');
      return;
    }
    
    // Inject our fingerprint data for consistency
    await page.evaluate((fp) => {
      window._fingerprintData = fp;
    }, fingerprint);
  
    // Override navigator properties for consistent fingerprinting
    await page.evaluate(() => {
      const fp = window._fingerprintData;
      
      // Override deviceMemory
      if ('deviceMemory' in navigator) {
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => fp.deviceMemory,
          configurable: true
        });
      }
      
      // Override hardwareConcurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => fp.hardwareConcurrency,
        configurable: true
      });
      
      // Override platform
      Object.defineProperty(navigator, 'platform', {
        get: () => fp.platform,
        configurable: true
      });
      
      // Override maxTouchPoints
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => fp.maxTouchPoints,
        configurable: true
      });
      
      // Override doNotTrack
      Object.defineProperty(navigator, 'doNotTrack', {
        get: () => fp.doNotTrack,
        configurable: true
      });
    });
    
    // Enhanced WebGL fingerprinting protection
    await page.evaluate(() => {
      const fp = window._fingerprintData;
      
      // Override WebGL vendor and renderer
      const getParameterProxyHandler = {
        apply: function(target, thisArg, args) {
          const param = args[0];
          
          if (param === thisArg.VENDOR) {
            return fp.vendor;
          }
          
          if (param === thisArg.RENDERER) {
            return fp.renderer;
          }
          
          // Call the original function for other parameters
          return target.apply(thisArg, args);
        }
      };
      
      // Apply to both WebGL contexts
      for (const webglType of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
        if (window[webglType]) {
          const originalGetParameter = window[webglType].prototype.getParameter;
          window[webglType].prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);
        }
      }
    });
    
    // Add Canvas noise for fingerprint protection
    await page.evaluate(() => {
      // Add subtle noise to canvas data
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      
      CanvasRenderingContext2D.prototype.getImageData = function() {
        const imageData = originalGetImageData.apply(this, arguments);
        
        // Don't modify very small canvases (often used for legitimate purposes)
        if (imageData.width * imageData.height < 256) return imageData;
        
        // Add subtle noise to a small percentage of pixels
        const data = imageData.data;
        const noise = 2; // Maximum noise amount
        
        for (let i = 0; i < data.length; i += 4) {
          // Only modify ~5% of pixels
          if (Math.random() < 0.05) {
            data[i] = Math.max(0, Math.min(255, data[i] + (Math.random() * noise * 2 - noise)));
            data[i+1] = Math.max(0, Math.min(255, data[i+1] + (Math.random() * noise * 2 - noise)));
            data[i+2] = Math.max(0, Math.min(255, data[i+2] + (Math.random() * noise * 2 - noise)));
          }
        }
        
        return imageData;
      };
      
      // Also modify toDataURL for complete protection
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        // Add noise before converting to data URL
        if (this.width * this.height > 256) {
          const ctx = this.getContext('2d');
          ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.01})`;
          ctx.fillRect(
            Math.random() * this.width, 
            Math.random() * this.height, 
            1, 
            1
          );
        }
        
        return originalToDataURL.apply(this, arguments);
      };
    });
    
    // Mock battery API
    await page.evaluate(() => {
      if (navigator.getBattery) {
        const fp = window._fingerprintData;
        const batteryInfo = fp.batteryManager;
        
        navigator.getBattery = function() {
          return Promise.resolve({
            charging: batteryInfo.charging,
            chargingTime: batteryInfo.chargingTime,
            dischargingTime: batteryInfo.dischargingTime,
            level: batteryInfo.level,
            addEventListener: function() {},
            removeEventListener: function() {}
          });
        };
      }
    });
    
    // Mock connection info
    await page.evaluate(() => {
      if (navigator.connection) {
        const connectionInfo = window._fingerprintData.connection;
        
        // Override connection properties
        Object.defineProperties(navigator.connection, {
          effectiveType: { 
            get: () => connectionInfo.effectiveType,
            configurable: true
          },
          downlink: { 
            get: () => connectionInfo.downlink,
            configurable: true
          },
          rtt: { 
            get: () => connectionInfo.rtt,
            configurable: true
          },
          saveData: { 
            get: () => connectionInfo.saveData,
            configurable: true
          }
        });
      }
    });
    
    // Override storage estimation to prevent fingerprinting
    await page.evaluate(() => {
      const fp = window._fingerprintData;
      
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate = function() {
          return Promise.resolve({
            quota: Math.round(fp.localStorageSize * 1.2),
            usage: fp.localStorageSize,
            usageDetails: {
              "indexedDB": Math.round(fp.localStorageSize * 0.7),
              "caches": Math.round(fp.localStorageSize * 0.2),
              "serviceWorkerRegistrations": Math.round(fp.localStorageSize * 0.1)
            }
          });
        };
      }
      
      // Override Storage prototype methods to report consistent sizes
      for (const storageType of ['localStorage', 'sessionStorage']) {
        if (window[storageType]) {
          const originalSetItem = Storage.prototype.setItem;
          
          Storage.prototype.setItem = function(key, value) {
            // Check if we're at "capacity" for fingerprinting resistance
            if (this === window[storageType] && 
                JSON.stringify([...Object.entries(this)]).length > 
                  (storageType === 'localStorage' ? fp.localStorageSize : fp.sessionStorageSize)) {
              throw new Error('QuotaExceededError');
            }
            
            return originalSetItem.call(this, key, value);
          };
        }
      }
    });
    
    logger.debug('Applied advanced fingerprint evasion');
  } catch (error) {
    logger.warn('Error applying fingerprint evasion', {}, error);
  }
}

/**
 * Gets proxy settings for a browser launch
 * @returns {Object|null} - Proxy configuration or null if disabled
 */
function getProxySettings() {
  // If proxies are disabled in config, return null
  if (config.proxy?.enabled === false) {
    return null;
  }
  
  // Default proxy configuration
  const defaultProxy = {
    server: 'brd.superproxy.io:33335',
    username: 'brd-customer-hl_aa4b1775-zone-residential_proxy1',
    password: '15blqlg7ljnm'
  };
  
  try {
    // Check if we should use Bright Data proxy
    if (config.proxy?.brightData?.enabled !== false) {
      return {
        server: config.proxy?.brightData?.server || defaultProxy.server,
        username: config.proxy?.brightData?.username || defaultProxy.username,
        password: config.proxy?.brightData?.password || defaultProxy.password
      };
    }
    
    // Use general proxy if configured
    if (config.proxy?.server) {
      return {
        server: config.proxy.server,
        username: config.proxy.username,
        password: config.proxy.password
      };
    }
    
    // No proxy configured, return null
    return null;
  } catch (error) {
    logger.error('Error setting up proxy configuration:', error);
    return null;
  }
}

module.exports = {
  chromium,
  getProxySettings
}; 