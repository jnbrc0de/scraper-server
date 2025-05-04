/**
 * Windows-specific Playwright Browser Fix Script
 * 
 * This script addresses "error installing Playwright browsers" issues on Windows
 * by using a combination of strategies:
 * 1. Detecting existing Chrome installation
 * 2. Setting environment variables
 * 3. Bypassing Playwright's own browser installation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Log with timestamp
const log = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

log('Starting Windows-specific Playwright browser fix...');

// Check for system Chrome installation
function findSystemChrome() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      log(`Found Chrome at: ${chromePath}`);
      return chromePath;
    }
  }
  
  log('No system Chrome installation found');
  return null;
}

// Configure environment to use system Chrome
function configureForSystemChrome(chromePath) {
  try {
    // Create browser-config.json
    const configPath = path.join(process.cwd(), 'browser-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ chromiumPath: chromePath }));
    log(`Created browser config at ${configPath}`);
    
    // Set environment variable
    process.env.CHROME_EXECUTABLE_PATH = chromePath;
    
    // Save to .env.local file for persistence
    const envPath = path.join(process.cwd(), '.env.local');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    if (envContent.includes('CHROME_EXECUTABLE_PATH=')) {
      envContent = envContent.replace(/CHROME_EXECUTABLE_PATH=.*\n/, `CHROME_EXECUTABLE_PATH=${chromePath}\n`);
    } else {
      envContent += `\nCHROME_EXECUTABLE_PATH=${chromePath}\n`;
    }
    
    fs.writeFileSync(envPath, envContent);
    log(`Updated ${envPath} with Chrome path`);
    
    return true;
  } catch (error) {
    log(`Error configuring system Chrome: ${error.message}`);
    return false;
  }
}

// Create mock browser installation
function createMockInstallation(chromePath) {
  try {
    log('Creating mock Playwright browsers directory...');
    
    // Create .local-browsers directory
    const mockDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers');
    if (!fs.existsSync(mockDir)) {
      fs.mkdirSync(mockDir, { recursive: true });
    }
    
    // Create chromium directory with specific version
    const chromiumDir = path.join(mockDir, 'chromium-1069');
    if (!fs.existsSync(chromiumDir)) {
      fs.mkdirSync(chromiumDir, { recursive: true });
    }
    
    // Create minimal JSON description
    const revision = {
      revision: '1069',
      executablePath: chromePath,
      folderPath: chromiumDir,
      installByDefault: true
    };
    
    // Save revision info
    fs.writeFileSync(
      path.join(chromiumDir, 'revision.json'),
      JSON.stringify(revision, null, 2)
    );
    
    log('Created mock browser installation');
    return true;
  } catch (error) {
    log(`Error creating mock installation: ${error.message}`);
    return false;
  }
}

// Patch browserService.js to use system Chrome
function patchBrowserService(chromePath) {
  try {
    const browserServicePath = path.join(process.cwd(), 'src', 'services', 'browser', 'browserService.js');
    
    if (fs.existsSync(browserServicePath)) {
      log('Patching browser service to use system Chrome...');
      
      let content = fs.readFileSync(browserServicePath, 'utf8');
      
      // Check if already patched
      if (content.includes('// WINDOWS_CHROME_PATCH')) {
        log('Browser service already patched');
        return true;
      }
      
      // Add code to use system Chrome
      const patchCode = `
      // WINDOWS_CHROME_PATCH
      // Set default launch options
      const CHROME_PATH = ${JSON.stringify(chromePath)};
      const defaultOptions = {
        headless: config.performance.useHeadlessMode !== false,
        executablePath: CHROME_PATH || process.env.CHROME_EXECUTABLE_PATH,
        args: [`;
      
      // Replace the original launch options
      const patched = content.replace(
        /\s+\/\/ Set default launch options\s+const defaultOptions = {[^{]*?headless[^,]*,/m,
        patchCode
      );
      
      if (patched !== content) {
        fs.writeFileSync(browserServicePath, patched);
        log('Successfully patched browser service');
        return true;
      } else {
        log('Could not find the right section to patch');
        return false;
      }
    } else {
      log('Browser service file not found');
      return false;
    }
  } catch (error) {
    log(`Error patching browser service: ${error.message}`);
    return false;
  }
}

// Ensure Playwright doesn't try to download browsers again
function preventPlaywrightDownloads() {
  try {
    // Create PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD file
    fs.writeFileSync('.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', '1');
    log('Created .PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD file');
    
    // Set environment variables
    process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
    process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
    
    // Update package.json scripts
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Update install-browsers script if it exists
      if (packageJson.scripts && packageJson.scripts['install-browsers']) {
        packageJson.scripts['install-browsers'] = 'node fix-windows-browser.js';
        log('Updated package.json install-browsers script');
      }
      
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }
    
    return true;
  } catch (error) {
    log(`Error preventing Playwright downloads: ${error.message}`);
    return false;
  }
}

// Main execution
async function main() {
  try {
    // Find system Chrome
    const chromePath = findSystemChrome();
    
    if (!chromePath) {
      log('No Chrome installation found. Please install Google Chrome and try again.');
      process.exit(1);
    }
    
    // Configure environment to use system Chrome
    configureForSystemChrome(chromePath);
    
    // Create mock browser installation
    createMockInstallation(chromePath);
    
    // Patch browser service
    patchBrowserService(chromePath);
    
    // Prevent Playwright from trying to download browsers
    preventPlaywrightDownloads();
    
    log('Windows-specific Playwright browser fix completed successfully!');
    log(`System Chrome at ${chromePath} will be used instead of Playwright browsers.`);
    log('You can now run your application without Playwright browser installation errors.');
  } catch (error) {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main(); 