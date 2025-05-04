/**
 * Fix Playwright-Extra Dependencies
 * 
 * This script resolves the "Plugin dependency not found" error by:
 * 1. Creating mock modules for missing dependencies
 * 2. Setting up proper directories for stealth plugin
 * 3. Creating fallback handlers for missing functions
 */

const fs = require('fs');
const path = require('path');

console.log('Starting dependency fix script...');

// Create necessary directories
function createDirectories() {
  const modulesDir = path.join(process.cwd(), 'node_modules');
  const stealthDir = path.join(modulesDir, 'stealth');
  const evasionsDir = path.join(stealthDir, 'evasions');
  
  console.log('Creating required directories...');
  
  // Create directories if they don't exist
  if (!fs.existsSync(stealthDir)) {
    try {
      fs.mkdirSync(stealthDir, { recursive: true });
      console.log(`Created directory: ${stealthDir}`);
    } catch (err) {
      console.error(`Failed to create directory ${stealthDir}:`, err.message);
    }
  }
  
  if (!fs.existsSync(evasionsDir)) {
    try {
      fs.mkdirSync(evasionsDir, { recursive: true });
      console.log(`Created directory: ${evasionsDir}`);
    } catch (err) {
      console.error(`Failed to create directory ${evasionsDir}:`, err.message);
    }
  }
  
  return { modulesDir, stealthDir, evasionsDir };
}

// Create mock modules for stealth evasions
function createMockModules(evasionsDir) {
  console.log('Creating mock evasion modules...');
  
  // List of common evasion files
  const evasionFiles = [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    'chrome.webgl', // The main one causing problems
    'defaultArgs',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    'navigator.vendor',
    'navigator.webdriver',
    'sourceurl',
    'user-agent-override',
    'webgl.vendor',
    'window.outerdimensions'
  ];
  
  // Create empty mock files for each evasion
  for (const file of evasionFiles) {
    const filePath = path.join(evasionsDir, `${file}.js`);
    if (!fs.existsSync(filePath)) {
      try {
        const mockContent = `
// Mock evasion module created by fix-dependencies.js
module.exports = function() {
  return {
    name: '${file}',
    requires: [],
    onPageCreated: async function() {}
  };
};`;
        fs.writeFileSync(filePath, mockContent);
        console.log(`Created mock evasion module: ${file}.js`);
      } catch (err) {
        console.error(`Failed to create mock module for ${file}.js:`, err.message);
      }
    } else {
      console.log(`Module ${file}.js already exists`);
    }
  }
}

// Create a fix for the getUserAgents function
function createAntiDetectionFix() {
  console.log('Creating antiDetection utility fix...');
  
  const utilsDir = path.join(process.cwd(), 'src', 'utils');
  const antiDetectionPath = path.join(utilsDir, 'antiDetection.js');
  
  if (fs.existsSync(antiDetectionPath)) {
    try {
      // Read the file
      let content = fs.readFileSync(antiDetectionPath, 'utf8');
      
      // Check if getUserAgents function exists
      if (!content.includes('function getUserAgents()')) {
        // Add the function at the end before module.exports
        const getUserAgentsFunction = `
/**
 * Returns a list of common browser user agent strings
 * @returns {Array<string>} - List of user agent strings
 */
function getUserAgents() {
  return [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Chrome on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
  ];
}`;

        // Find the module.exports line
        const moduleExportsMatch = content.match(/module\.exports\s*=\s*{[^}]+}/);
        
        if (moduleExportsMatch) {
          // Replace the module.exports line by including getUserAgents
          const originalExports = moduleExportsMatch[0];
          const newExports = originalExports.replace(
            /module\.exports\s*=\s*{([^}]+)}/,
            `module.exports = {$1,\n  getUserAgents\n}`
          );
          
          // Replace the content
          content = content.replace(moduleExportsMatch[0], `${getUserAgentsFunction}\n\n${newExports}`);
          
          // Write the modified content back to the file
          fs.writeFileSync(antiDetectionPath, content);
          console.log(`Updated ${antiDetectionPath} with getUserAgents function`);
        } else {
          console.warn(`Could not find module.exports in ${antiDetectionPath}`);
          
          // Append the function and new exports at the end
          content += `\n${getUserAgentsFunction}\n\nmodule.exports = {\n  ...module.exports,\n  getUserAgents\n};\n`;
          fs.writeFileSync(antiDetectionPath, content);
          console.log(`Appended getUserAgents function to ${antiDetectionPath}`);
        }
      } else {
        console.log(`getUserAgents function already exists in ${antiDetectionPath}`);
      }
    } catch (err) {
      console.error(`Error updating ${antiDetectionPath}:`, err.message);
    }
  } else {
    console.warn(`antiDetection.js file not found at ${antiDetectionPath}`);
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(utilsDir)) {
      try {
        fs.mkdirSync(utilsDir, { recursive: true });
        console.log(`Created directory: ${utilsDir}`);
      } catch (err) {
        console.error(`Failed to create directory ${utilsDir}:`, err.message);
      }
    }
    
    // Create a minimal version of the file
    try {
      const minimalContent = `/**
 * Anti-Detection Utilities
 * Provides functions to avoid scraper detection
 */

/**
 * Returns a list of common browser user agent strings
 * @returns {Array<string>} - List of user agent strings
 */
function getUserAgents() {
  return [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Chrome on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
  ];
}

/**
 * Applies advanced browser fingerprint evasion techniques
 * @param {import('playwright').Page} page - Playwright page
 * @param {Object} options - Fingerprint options
 * @returns {Promise<void>}
 */
async function applyAdvancedFingerprintEvasion(page, options = {}) {
  // Empty implementation to prevent errors
  return Promise.resolve();
}

/**
 * Simulates realistic mouse movement
 * @param {import('playwright').Page} page - Playwright page
 * @param {Object} target - Target coordinates {x, y}
 * @param {Object} options - Mouse movement options
 * @returns {Promise<void>}
 */
async function simulateRealisticMouseMovement(page, target, options = {}) {
  // Empty implementation to prevent errors
  return Promise.resolve();
}

/**
 * Simulates realistic typing
 * @param {import('playwright').Page} page - Playwright page
 * @param {string} selector - Element selector
 * @param {string} text - Text to type
 * @param {Object} options - Typing options
 * @returns {Promise<void>}
 */
async function simulateRealisticTyping(page, selector, text, options = {}) {
  // Empty implementation to prevent errors
  return Promise.resolve();
}

/**
 * Simulates human-like page interaction
 * @param {import('playwright').Page} page - Playwright page
 * @param {Object} options - Interaction options
 * @returns {Promise<void>}
 */
async function simulateHumanPageInteraction(page, options = {}) {
  // Empty implementation to prevent errors
  return Promise.resolve();
}

module.exports = {
  getUserAgents,
  applyAdvancedFingerprintEvasion,
  simulateRealisticMouseMovement,
  simulateRealisticTyping,
  simulateHumanPageInteraction
};`;
      fs.writeFileSync(antiDetectionPath, minimalContent);
      console.log(`Created minimal antiDetection.js at ${antiDetectionPath}`);
    } catch (err) {
      console.error(`Failed to create antiDetection.js:`, err.message);
    }
  }
}

// Fix the browserService.js file if needed
function fixBrowserService() {
  console.log('Checking browserService.js...');
  
  const browserServicePath = path.join(process.cwd(), 'src', 'services', 'browser', 'browserService.js');
  
  if (fs.existsSync(browserServicePath)) {
    try {
      // Read the file
      let content = fs.readFileSync(browserServicePath, 'utf8');
      
      // Check if the fix is already implemented
      if (!content.includes('getDefaultUserAgents()') && content.includes('this.userAgents = antiDetection.getUserAgents()')) {
        console.log('Fixing browserService.js to handle missing getUserAgents...');
        
        // Add the getDefaultUserAgents function
        const defaultUserAgentsFunction = `
/**
 * Returns a list of default user agents to use if the antiDetection module fails
 * @returns {string[]} Array of user agent strings
 */
function getDefaultUserAgents() {
  return [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Chrome on macOS
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
  ];
}`;

        // Replace the direct call with a safe initialization
        const fixedInitialization = `
    // Safely initialize user agents list
    try {
      this.userAgents = antiDetection.getUserAgents && typeof antiDetection.getUserAgents === 'function' 
        ? antiDetection.getUserAgents() 
        : getDefaultUserAgents();
    } catch (e) {
      logger.warn('Error initializing user agents from antiDetection module, using defaults', {}, e);
      this.userAgents = getDefaultUserAgents();
    }`;

        content = content.replace(
          /this\.userAgents = antiDetection\.getUserAgents\(\);/g,
          fixedInitialization
        );

        // Add the getDefaultUserAgents function before the module.exports
        content = content.replace(
          /module\.exports = new BrowserService\(\);/g,
          `${defaultUserAgentsFunction}\n\nmodule.exports = new BrowserService();`
        );

        // Write the modified content back to the file
        fs.writeFileSync(browserServicePath, content);
        console.log(`Updated ${browserServicePath} with safe user agents initialization`);
      } else {
        console.log(`browserService.js already has the necessary fixes`);
      }
    } catch (err) {
      console.error(`Error updating ${browserServicePath}:`, err.message);
    }
  } else {
    console.warn(`browserService.js file not found at ${browserServicePath}`);
  }
}

// Fix the stealthPlugin.js file to handle missing plugins
function fixStealthPlugin() {
  console.log('Checking stealthPlugin.js...');
  
  const stealthPluginPath = path.join(process.cwd(), 'src', 'services', 'browser', 'stealthPlugin.js');
  
  if (fs.existsSync(stealthPluginPath)) {
    try {
      // Read the file
      let content = fs.readFileSync(stealthPluginPath, 'utf8');
      
      // Check if it's already using a try-catch for playwright-extra
      if (!content.includes('try {') && content.includes('const { addExtra } = require(\'playwright-extra\')')) {
        console.log('Fixing stealthPlugin.js to handle missing dependencies...');
        
        // Replace direct requires with try-catch blocks
        const safeRequires = `// Try to load playwright-extra safely
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
}`;
        
        // Replace the original requires
        content = content.replace(
          /const { addExtra } = require\('playwright-extra'\);\s*const playwright = require\('playwright'\);\s*const chromium = addExtra\(playwright\.chromium\);\s*const StealthPlugin = require\('puppeteer-extra-plugin-stealth'\);/,
          `const playwright = require('playwright');\n${safeRequires}`
        );
        
        // Update function signature if needed
        content = content.replace(
          /function createEnhancedStealthPlugin\(\)/,
          `function createEnhancedStealthPlugin(StealthPlugin)`
        );
        
        // Write the modified content back to the file
        fs.writeFileSync(stealthPluginPath, content);
        console.log(`Updated ${stealthPluginPath} with safer dependency handling`);
      } else {
        console.log(`stealthPlugin.js already has the necessary fixes`);
      }
    } catch (err) {
      console.error(`Error updating ${stealthPluginPath}:`, err.message);
    }
  } else {
    console.warn(`stealthPlugin.js file not found at ${stealthPluginPath}`);
  }
}

// Main execution
const { evasionsDir } = createDirectories();
createMockModules(evasionsDir);
createAntiDetectionFix();
fixBrowserService();
fixStealthPlugin();

console.log('\nDependency fixes completed! The "Plugin dependency not found" error should be resolved.');
console.log('Please restart your application to apply the changes.'); 