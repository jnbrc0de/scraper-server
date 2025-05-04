/**
 * Setup Plugin Dependencies
 * Ensures all required plugin dependencies are installed and properly configured.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Setting up playwright-extra plugin dependencies...');

// Install dependencies
const dependencies = [
  'playwright-extra',
  'puppeteer-extra-plugin-stealth'
];

// Check if package.json exists
const packageJsonPath = path.join(__dirname, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error('package.json not found!');
  process.exit(1);
}

// Check current installed packages
let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
} catch (error) {
  console.error('Error reading package.json:', error);
  process.exit(1);
}

// Get currently installed dependencies
const installedDeps = packageJson.dependencies || {};

// Check for missing dependencies
const missingDeps = dependencies.filter(dep => !installedDeps[dep]);

if (missingDeps.length > 0) {
  console.log(`Installing missing dependencies: ${missingDeps.join(', ')}`);
  try {
    execSync(`npm install ${missingDeps.join(' ')} --save`, { stdio: 'inherit' });
    console.log('Dependencies installed successfully!');
  } catch (error) {
    console.error('Error installing dependencies:', error.message);
    process.exit(1);
  }
} else {
  console.log('All required dependencies are already installed.');
}

// Create symbolic links if node_modules structure requires it
const nodeModulesPath = path.join(__dirname, 'node_modules');
const stealthPluginPath = path.join(nodeModulesPath, 'puppeteer-extra-plugin-stealth');
const evasionsPath = path.join(stealthPluginPath, 'evasions');

console.log('Creating necessary symbolic links for stealth plugin...');

// Map of dependencies that might need linking
const stealthEvasionPaths = [
  'chrome.app',
  'chrome.csi',
  'chrome.loadTimes',
  'chrome.runtime',
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
  'window.outerdimensions',
  'chrome.webgl'
];

try {
  // Check if evasions directory exists
  if (fs.existsSync(evasionsPath)) {
    // Make sure the stealth/evasions directory exists
    const stealthDirPath = path.join(nodeModulesPath, 'stealth');
    const stealthEvasionsPath = path.join(stealthDirPath, 'evasions');
    
    if (!fs.existsSync(stealthDirPath)) {
      fs.mkdirSync(stealthDirPath, { recursive: true });
    }
    
    if (!fs.existsSync(stealthEvasionsPath)) {
      fs.mkdirSync(stealthEvasionsPath, { recursive: true });
    }
    
    // Create symbolic links for each evasion module
    for (const evasion of stealthEvasionPaths) {
      const sourcePath = path.join(evasionsPath, evasion + '.js');
      const targetPath = path.join(stealthEvasionsPath, evasion + '.js');
      
      if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
        // Make the link for Windows and other OSes
        if (process.platform === 'win32') {
          // For Windows, copy the file instead
          fs.copyFileSync(sourcePath, targetPath);
        } else {
          // For Unix-based systems, create a symbolic link
          fs.symlinkSync(sourcePath, targetPath);
        }
        console.log(`Created link for ${evasion}`);
      }
    }
    
    console.log('Symbolic links created successfully!');
  } else {
    console.warn('Evasions directory not found! Check installation of puppeteer-extra-plugin-stealth');
  }
} catch (error) {
  console.error('Error creating symbolic links:', error.message);
}

console.log('Setup complete! Plugin dependencies are now properly configured.'); 