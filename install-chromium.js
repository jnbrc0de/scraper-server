/**
 * Windows-compatible Chromium Installation Script
 * Handles common installation issues on Windows environments
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { URL } = require('url');

// Log with timestamp
const log = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

log('Starting Windows-compatible Chromium installation...');
log(`Platform: ${os.platform()}, Architecture: ${os.arch()}`);

// Check for existing browsers
const checkExistingBrowsers = () => {
  const possibleLocations = [
    path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers'),
    path.join(process.cwd(), 'node_modules', 'playwright', '.local-browsers'),
    path.join(os.homedir(), '.cache', 'ms-playwright')
  ];

  let foundBrowsers = false;
  
  possibleLocations.forEach(location => {
    if (fs.existsSync(location)) {
      try {
        const browsers = fs.readdirSync(location);
        log(`Found browsers at ${location}: ${browsers.join(', ')}`);
        foundBrowsers = true;
      } catch (e) {
        log(`Error reading directory ${location}: ${e.message}`);
      }
    }
  });
  
  return foundBrowsers;
};

// Create browser directories
const createDirectories = () => {
  const browserDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers');
  
  try {
    if (!fs.existsSync(browserDir)) {
      fs.mkdirSync(browserDir, { recursive: true });
      log(`Created directory: ${browserDir}`);
    }
  } catch (err) {
    log(`Error creating directory ${browserDir}: ${err.message}`);
  }
};

// Try various installation methods
const installChromium = async () => {
  const methods = [
    {
      name: 'Standard installation',
      command: 'npx playwright install chromium',
      options: { stdio: 'inherit' }
    },
    {
      name: 'Installation with dependencies',
      command: 'npx playwright install chromium --with-deps',
      options: { stdio: 'inherit' }
    },
    {
      name: 'Setting PLAYWRIGHT_BROWSERS_PATH to 0',
      command: 'set PLAYWRIGHT_BROWSERS_PATH=0 && npx playwright install chromium',
      options: { stdio: 'inherit', shell: true }
    },
    {
      name: 'Using PowerShell',
      command: 'powershell -Command "npx playwright install chromium"',
      options: { stdio: 'inherit' }
    }
  ];

  // Check if browsers already exist
  if (checkExistingBrowsers()) {
    log('Browsers already installed. Checking Chrome desktop installation...');
    checkChromeDesktopInstallation();
    return;
  }

  // Create directories
  createDirectories();

  // Try each method
  for (const method of methods) {
    try {
      log(`Trying installation method: ${method.name}`);
      execSync(method.command, method.options);
      log('Installation successful!');
      
      // Check if browsers were installed
      if (checkExistingBrowsers()) {
        return;
      } else {
        log('Installation command completed but browsers not found. Trying next method...');
      }
    } catch (error) {
      log(`Error with method "${method.name}": ${error.message}`);
    }
  }

  // If all methods failed, check for Chrome desktop installation
  log('All standard installation methods failed. Checking for Chrome desktop installation...');
  checkChromeDesktopInstallation();

  // Create a mock installation as last resort
  createMockInstallation();
};

// Check for Chrome desktop installation
const checkChromeDesktopInstallation = () => {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      log(`Found Chrome at: ${chromePath}`);
      
      // Save path to env file
      try {
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
        
        // Create browser-config.json
        const configPath = path.join(process.cwd(), 'browser-config.json');
        fs.writeFileSync(configPath, JSON.stringify({ chromiumPath: chromePath }));
        log(`Created browser config at ${configPath}`);
        
        // Load our custom module patches
        try {
          require('./fix-dependencies-advanced.js');
          log('Applied dependency fixes');
        } catch (e) {
          log(`Could not apply dependency fixes: ${e.message}`);
        }
        
        return chromePath;
      } catch (e) {
        log(`Error saving Chrome path: ${e.message}`);
      }
    }
  }
  
  log('No Chrome installation found.');
  return null;
};

// Create a mock installation as last resort
const createMockInstallation = () => {
  log('Creating mock browser installation as last resort...');
  
  try {
    const mockDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers', 'chromium');
    if (!fs.existsSync(mockDir)) {
      fs.mkdirSync(mockDir, { recursive: true });
    }
    
    // Create a marker file
    fs.writeFileSync(path.join(mockDir, 'installed'), 'mock installation');
    
    // Create minimal JSON description
    const revision = {
      revision: '1000',
      path: mockDir,
      executablePath: checkChromeDesktopInstallation() || 'chrome.exe',
      installByDefault: true
    };
    
    // Save revision info
    fs.writeFileSync(path.join(mockDir, 'revision.json'), JSON.stringify(revision, null, 2));
    
    log('Created mock browser installation. Will attempt to use system Chrome.');
    
    // Modify browser service to use system Chrome
    patchBrowserService();
  } catch (e) {
    log(`Error creating mock installation: ${e.message}`);
  }
};

// Patch browserService.js to handle missing browser gracefully
const patchBrowserService = () => {
  try {
    const browserServicePath = path.join(process.cwd(), 'src', 'services', 'browser', 'browserService.js');
    
    if (fs.existsSync(browserServicePath)) {
      log('Patching browser service to use system Chrome...');
      
      let content = fs.readFileSync(browserServicePath, 'utf8');
      
      // Check if already patched
      if (content.includes('// PATCH: Use system Chrome if available')) {
        log('Browser service already patched');
        return;
      }
      
      // Add code to use system Chrome
      const patchCode = `
      // PATCH: Use system Chrome if available
      try {
        // Try to load browser config for system Chrome
        let executablePath;
        try {
          const configPath = path.join(process.cwd(), 'browser-config.json');
          if (fs.existsSync(configPath)) {
            const browserConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            executablePath = browserConfig.chromiumPath;
          }
        } catch (e) {
          logger.warn('Error loading browser config', {}, e);
        }
        
        // Check environment variable
        executablePath = executablePath || process.env.CHROME_EXECUTABLE_PATH;
        
        // Set default launch options
        const defaultOptions = {
          headless: config.performance.useHeadlessMode !== false,
          executablePath,
          args: [`;
      
      // Replace the original launch options
      content = content.replace(/\s+\/\/ Set default launch options\s+const defaultOptions = {[\s\S]+?headless:([^\n,]+),/m, patchCode);
      
      // Write back the patched file
      fs.writeFileSync(browserServicePath, content);
      log('Successfully patched browser service to use system Chrome');
    }
  } catch (error) {
    log(`Error patching browser service: ${error.message}`);
  }
};

// Main execution
installChromium().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
}); 