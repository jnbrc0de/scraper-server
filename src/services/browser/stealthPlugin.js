/**
 * Enhanced Stealth Plugin
 * Provides advanced anti-detection measures for browser automation
 * Extends standard evasion with human-like behavior and consistent fingerprinting
 */
const playwright = require('playwright-extra');
const { addExtra } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
const logger = require('../../utils/logger');
const config = require('../../config');

/**
 * BrightData proxy configuration
 * Using residential proxy with port 33335 as required by the new certificate
 */
const PROXY_CONFIG = {
  server: 'brd.superproxy.io:33335',
  username: 'brd-customer-hl_aa4b1775-zone-residential_proxy1',
  password: '15blqlg7ljnm'
};

/**
 * Creates an enhanced stealth plugin with additional protections
 * @returns {Object} - Enhanced stealth plugin
 */
function createEnhancedStealthPlugin() {
  // Start with the base stealth plugin
  const plugin = StealthPlugin;
  
  // Store consistent fingerprint data
  const fingerprintData = {
    // Generate fingerprint when plugin is created, not per-page
    deviceMemory: config.stealth?.deviceMemory || Math.random() > 0.5 ? 8 : 4,
    hardwareConcurrency: config.stealth?.cpuCores || 4 + Math.floor(Math.random() * 4),
    platform: config.stealth?.platform || ['Win32', 'MacIntel', 'Linux x86_64'][Math.floor(Math.random() * 3)],
    vendor: config.stealth?.vendor || ['Google Inc.', 'Apple Computer, Inc.'][Math.floor(Math.random() * 2)],
    renderer: config.stealth?.renderer || [
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)'
    ][Math.floor(Math.random() * 3)],
    maxTouchPoints: Math.random() > 0.7 ? 0 : 5,
    doNotTrack: Math.random() > 0.7 ? '1' : null,
    sessionStorageSize: Math.floor(Math.random() * 10000000),
    localStorageSize: Math.floor(Math.random() * 10000000),
    batteryManager: {
      charging: Math.random() > 0.3,
      chargingTime: Math.random() > 0.3 ? 0 : Infinity,
      dischargingTime: Math.random() > 0.3 ? Infinity : Math.floor(Math.random() * 5000) + 1000,
      level: Math.round((Math.random() * 50 + 50)) / 100  // 50-100%
    },
    connection: {
      effectiveType: ['4g', '3g'][Math.floor(Math.random() * 2)],
      downlink: 5 + Math.random() * 10,
      rtt: Math.floor(Math.random() * 50) + 50,
      saveData: Math.random() > 0.9 // 10% chance of saveData being true
    }
  };
  
  // Override browser's WebGL fingerprint behavior for consistency
  plugin.enabledEvasions.add('chrome.webgl');
  plugin.enabledEvasions.add('chrome.canvas');
  
  // Additional evasions
  plugin.enabledEvasions.add('chrome.runtime');
  plugin.enabledEvasions.add('iframe.contentWindow');
  plugin.enabledEvasions.add('media.codecs');
  plugin.enabledEvasions.add('navigator.hardwareConcurrency');
  plugin.enabledEvasions.add('navigator.languages');
  plugin.enabledEvasions.add('navigator.permissions');
  plugin.enabledEvasions.add('navigator.plugins');
  plugin.enabledEvasions.add('window.outerdimensions');
  
  // Override onPageCreated to inject our custom fingerprint evasions
  const originalOnPageCreated = plugin.onPageCreated;
  plugin.onPageCreated = async function(page) {
    // First run the original stealth onPageCreated
    if (originalOnPageCreated) {
      await originalOnPageCreated.call(this, page);
    }
    
    // Then apply our enhanced evasions
    await applyEnhancedEvasions(page, fingerprintData);
  };
  
  return plugin;
}

/**
 * Applies enhanced evasion techniques to a page
 * @param {import('playwright').Page} page - Playwright page
 * @param {Object} fingerprint - Consistent fingerprint data
 * @returns {Promise<void>}
 */
async function applyEnhancedEvasions(page, fingerprint) {
  try {
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
    
    logger.debug('Applied enhanced fingerprinting protections');
  } catch (error) {
    logger.error('Error applying enhanced evasions', {}, error);
  }
}

// Create and configure the enhanced stealth plugin
const enhancedStealthPlugin = createEnhancedStealthPlugin();

// Add method to get proxy settings for browser launch
function getProxySettings() {
  return {
    server: PROXY_CONFIG.server,
    username: PROXY_CONFIG.username,
    password: PROXY_CONFIG.password
  };
}

// Export both the stealth plugin and proxy settings
module.exports = { 
  stealthPlugin: enhancedStealthPlugin,
  proxyConfig: PROXY_CONFIG,
  getProxySettings 
}; 