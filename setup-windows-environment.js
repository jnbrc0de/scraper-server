/**
 * Comprehensive Windows Environment Setup Script
 * 
 * This script fixes common issues with running the scraper-server on Windows:
 * 1. Fixes dependency issues with Playwright and stealth plugins
 * 2. Sets up the system to use the local Chrome installation
 * 3. Configures appropriate environment variables
 * 
 * Run this script when you encounter Playwright browser installation errors on Windows.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Log with timestamp
const log = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

log('Starting comprehensive Windows environment setup...');

// Step 1: Run fix-dependencies-advanced.js if it exists
try {
  if (fs.existsSync('./fix-dependencies-advanced.js')) {
    log('Running advanced dependency fixes...');
    require('./fix-dependencies-advanced');
    log('Advanced dependency fixes completed');
  } else {
    log('Advanced dependency fix script not found, skipping');
  }
} catch (error) {
  log(`Error running dependency fixes: ${error.message}`);
}

// Step 2: Run fix-windows-browser.js
try {
  if (fs.existsSync('./fix-windows-browser.js')) {
    log('Running Windows browser fixes...');
    require('./fix-windows-browser');
    log('Windows browser fixes completed');
  } else {
    log('Windows browser fix script not found, skipping');
  }
} catch (error) {
  log(`Error running Windows browser fixes: ${error.message}`);
}

// Step 3: Additional verification and troubleshooting
function verifySetup() {
  try {
    log('Verifying setup...');
    
    // Check browser-config.json
    const configPath = path.join(process.cwd(), 'browser-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      log(`Chrome path from config: ${config.chromiumPath}`);
      
      if (!fs.existsSync(config.chromiumPath)) {
        log('WARNING: Configured Chrome executable does not exist!');
      }
    } else {
      log('WARNING: browser-config.json not found');
    }
    
    // Check mock Playwright browser directories
    const playwrightDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers');
    if (fs.existsSync(playwrightDir)) {
      const dirs = fs.readdirSync(playwrightDir);
      log(`Playwright browser directories: ${dirs.join(', ')}`);
    } else {
      log('WARNING: Playwright browser directories not found');
    }
    
    log('Setup verification completed');
  } catch (error) {
    log(`Error verifying setup: ${error.message}`);
  }
}

// Step 4: Additional safety measures
function additionalSafetyMeasures() {
  try {
    // Ensure necessary environment variables are set globally
    log('Setting environment variables in .env.local...');
    
    const envPath = path.join(process.cwd(), '.env.local');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Add PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    if (!envContent.includes('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=')) {
      envContent += '\nPLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1\n';
    }
    
    // Add PLAYWRIGHT_BROWSERS_PATH=0 
    if (!envContent.includes('PLAYWRIGHT_BROWSERS_PATH=')) {
      envContent += '\nPLAYWRIGHT_BROWSERS_PATH=0\n';
    }
    
    fs.writeFileSync(envPath, envContent);
    log('Updated environment variables in .env.local');
    
    // Update package.json to include our setup script
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      if (!packageJson.scripts['setup-windows']) {
        packageJson.scripts['setup-windows'] = 'node setup-windows-environment.js';
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        log('Added setup-windows script to package.json');
      }
    }
  } catch (error) {
    log(`Error setting additional safety measures: ${error.message}`);
  }
}

// Run verification and additional safety measures
verifySetup();
additionalSafetyMeasures();

log('Comprehensive Windows environment setup completed!');
log('You should now be able to run the application without Playwright browser installation errors.');
log('To start the server, run: npm run start:win'); 