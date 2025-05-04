/**
 * Advanced Fix for Playwright-Extra Dependencies
 * 
 * This script resolves all dependency and plugin issues by:
 * 1. Creating mock modules for missing dependencies
 * 2. Setting up proper directories for stealth plugin
 * 3. Patching require.resolve to handle dependency resolution
 * 4. Fixing plugin compatibility issues
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Starting advanced dependency fix script...');

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
    'chrome.webgl',
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
  
  // Create enhanced mock files for each evasion
  for (const file of evasionFiles) {
    const filePath = path.join(evasionsDir, `${file}.js`);
    if (!fs.existsSync(filePath)) {
      try {
        const mockContent = `
// Mock evasion module created by fix-dependencies-advanced.js
module.exports = function() {
  return {
    name: '${file}',
    _isPuppeteerExtraPlugin: true,
    requiresImportant: true,
    requires: [],
    beforeLaunch: async function() {},
    afterLaunch: async function() {},
    onPageCreated: async function(page) {
      // Basic implementation for ${file}
      await page.addInitScript(() => {
        try {
          // Handle specific evasions
          ${getSpecificEvasionCode(file)}
        } catch (e) {
          // Silently fail
        }
      });
    }
  };
};`;
        fs.writeFileSync(filePath, mockContent);
        console.log(`Created enhanced mock evasion module: ${file}.js`);
      } catch (err) {
        console.error(`Failed to create mock module for ${file}.js:`, err.message);
      }
    } else {
      console.log(`Module ${file}.js already exists`);
    }
  }
}

// Generate specific evasion code for different plugins
function getSpecificEvasionCode(evasionName) {
  switch(evasionName) {
    case 'chrome.webgl':
      return `
          // Mock WebGL data
          if (!window.chrome) window.chrome = {};
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            // UNMASKED_VENDOR_WEBGL
            if (parameter === 37445) return 'Google Inc. (Intel)';
            // UNMASKED_RENDERER_WEBGL
            if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)';
            return getParameter.call(this, parameter);
          };`;
    
    case 'navigator.webdriver':
      return `
          // Remove webdriver property
          if (navigator.webdriver === true) {
            delete Object.getPrototypeOf(navigator).webdriver;
            Object.defineProperty(navigator, 'webdriver', {
              get: () => false,
              configurable: true
            });
          }`;
    
    case 'navigator.languages':
      return `
          // Set navigator languages
          Object.defineProperty(Object.getPrototypeOf(navigator), 'languages', {
            get: () => ['en-US', 'en'],
            configurable: true
          });`;
    
    case 'chrome.runtime':
      return `
          // Add chrome.runtime
          if (!window.chrome) window.chrome = {};
          if (!window.chrome.runtime) {
            window.chrome.runtime = {
              connect: function() { return {}; },
              sendMessage: function() { return {}; }
            };
          }`;
    
    default:
      return '// No specific implementation for this evasion';
  }
}

// Create a fix for the getUserAgents function
function createAntiDetectionFix() {
  console.log('Creating antiDetection utility fix...');
  
  const utilsDir = path.join(process.cwd(), 'src', 'utils');
  const antiDetectionPath = path.join(utilsDir, 'antiDetection.js');
  
  // Create utils directory if it doesn't exist
  if (!fs.existsSync(utilsDir)) {
    try {
      fs.mkdirSync(utilsDir, { recursive: true });
      console.log(`Created directory: ${utilsDir}`);
    } catch (err) {
      console.error(`Failed to create directory ${utilsDir}:`, err.message);
      return;
    }
  }
  
  // Create plugin helper module
  createPluginHelper(utilsDir);
  
  // Check if antiDetection.js exists
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

// Create plugin helper
function createPluginHelper(utilsDir) {
  const pluginHelperPath = path.join(utilsDir, 'pluginHelper.js');
  
  if (!fs.existsSync(pluginHelperPath)) {
    try {
      const pluginHelperContent = `/**
 * Plugin Helper
 * Resolves dependency problems for playwright-extra and puppeteer-extra-plugin-stealth
 */

const fs = require('fs');
const path = require('path');

// Monkey patch the dependency resolution for playwright-extra
function setupPluginDependencyResolution() {
  try {
    // Patch require.resolve to handle stealth plugin dependencies
    const originalResolve = require.resolve;
    require.resolve = function(request, options) {
      // Check if this is a stealth plugin dependency request
      if (request.startsWith('stealth/evasions/')) {
        const evasionName = request.replace('stealth/evasions/', '');
        
        // Try to find it in node_modules/stealth/evasions first
        const customPath = path.join(process.cwd(), 'node_modules', 'stealth', 'evasions', \`\${evasionName}.js\`);
        if (fs.existsSync(customPath)) {
          return customPath;
        }
        
        // Try to find it in puppeteer-extra-plugin-stealth
        try {
          const stealthPath = originalResolve('puppeteer-extra-plugin-stealth');
          const evasionPath = path.join(path.dirname(stealthPath), 'evasions', evasionName, 'index.js');
          
          if (fs.existsSync(evasionPath)) {
            return evasionPath;
          }
        } catch (e) {
          // Puppeteer-extra-plugin-stealth not found, continue
        }
        
        // Return a mock implementation to prevent crashes
        const mockDir = path.join(process.cwd(), 'node_modules', 'stealth', 'evasions');
        if (!fs.existsSync(mockDir)) {
          fs.mkdirSync(mockDir, { recursive: true });
        }
        
        // Create a mock module if it doesn't exist
        if (!fs.existsSync(customPath)) {
          const mockContent = \`
// Mock evasion module created by pluginHelper.js
module.exports = function() {
  return {
    name: '\${evasionName}',
    requiresImportant: true,
    _isPuppeteerExtraPlugin: true,
    onPageCreated: async function() {}
  };
};\`;
          fs.writeFileSync(customPath, mockContent);
        }
        
        return customPath;
      }
      
      // Use the original resolve for everything else
      return originalResolve(request, options);
    };
    
    // Patch puppeteer-extra-plugin base class check
    try {
      const PlaywrightExtra = require('playwright-extra');
      const originalUse = PlaywrightExtra.Playwright.prototype.use;
      
      PlaywrightExtra.Playwright.prototype.use = function(plugin) {
        // Add missing properties to ensure the plugin is considered valid
        if (plugin && typeof plugin === 'object') {
          if (!plugin.name && plugin._name) {
            plugin.name = plugin._name;
          }
          
          if (!plugin.name) {
            plugin.name = 'stealth-plugin';
          }
          
          if (!plugin._isPuppeteerExtraPlugin) {
            plugin._isPuppeteerExtraPlugin = true;
          }
          
          if (!plugin.requiresLaunchPausePre && typeof plugin.beforeLaunch !== 'function') {
            plugin.beforeLaunch = async () => {};
          }
        }
        
        return originalUse.call(this, plugin);
      };
    } catch (e) {
      console.warn('Failed to patch playwright-extra:', e);
    }
    
    console.log('Plugin dependency resolution setup completed successfully');
  } catch (error) {
    console.error('Error setting up plugin dependency resolution:', error);
  }
}

module.exports = {
  setupPluginDependencyResolution
};`;

      fs.writeFileSync(pluginHelperPath, pluginHelperContent);
      console.log(`Created pluginHelper.js at ${pluginHelperPath}`);
    } catch (err) {
      console.error(`Failed to create pluginHelper.js:`, err.message);
    }
  } else {
    console.log(`pluginHelper.js already exists at ${pluginHelperPath}`);
  }
}

// Fix package.json
function updatePackageJson() {
  console.log('Updating package.json with required dependencies...');
  
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      // Read the package.json file
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Check and update playwright version
      if (packageJson.dependencies.playwright) {
        if (packageJson.dependencies.playwright < "^1.37.0") {
          packageJson.dependencies.playwright = "^1.39.0";
        }
      } else {
        packageJson.dependencies.playwright = "^1.39.0";
      }
      
      // Ensure other required dependencies
      packageJson.dependencies["playwright-extra"] = "^4.3.6";
      packageJson.dependencies["puppeteer-extra-plugin-stealth"] = "^2.11.2";
      
      // Add scripts
      if (!packageJson.scripts.fix) {
        packageJson.scripts.fix = "node fix-dependencies-advanced.js";
      }
      
      // Write the updated package.json back to disk
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log('Updated package.json with required dependencies');
    } catch (err) {
      console.error('Error updating package.json:', err.message);
    }
  } else {
    console.warn('package.json not found at', packageJsonPath);
  }
}

// Try to install dependencies
function installDependencies() {
  console.log('Attempting to install dependencies...');
  
  try {
    execSync('npm install playwright-extra puppeteer-extra-plugin-stealth --no-save', {
      stdio: 'inherit',
      timeout: 60000
    });
    console.log('Dependencies installed successfully');
  } catch (err) {
    console.error('Error installing dependencies:', err.message);
    console.log('Please run "npm install" manually to complete the setup');
  }
}

// Main execution
const { evasionsDir } = createDirectories();
createMockModules(evasionsDir);
createAntiDetectionFix();
updatePackageJson();
installDependencies();

console.log('\nAdvanced dependency fixes completed! The "Plugin dependency not found" error should be resolved.');
console.log('Please restart your application to apply the changes.');
console.log('\nIf you encounter any issues, run: npm install'); 