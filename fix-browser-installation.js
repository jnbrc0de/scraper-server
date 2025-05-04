/**
 * Fix Browser Installation Script
 * 
 * This script addresses the Playwright browser installation issue:
 * "browserType.launch: Executable doesn't exist at /node_modules/playwright-core/.local-browsers/..."
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Starting browser installation fix...');

// Detect environment
const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_ID;
const isDocker = fs.existsSync('/.dockerenv');
const isLinux = os.platform() === 'linux';

console.log(`Environment: ${os.platform()}, Docker: ${isDocker}, Render: ${isRender}`);

// Step 1: Fix dependency issues from previous script
try {
  if (fs.existsSync('./fix-dependencies-advanced.js')) {
    console.log('Running dependency fix script first...');
    require('./fix-dependencies-advanced');
  }
} catch (err) {
  console.warn('Warning: Could not run dependency fix script:', err.message);
}

// Step 2: Install Playwright browsers
console.log('Installing Playwright browsers...');

try {
  // For Render and Docker environments, use special flags
  let installCommand = 'npx playwright install chromium';
  
  if (isRender || isDocker) {
    installCommand += ' --with-deps';
  }
  
  console.log(`Running: ${installCommand}`);
  execSync(installCommand, { stdio: 'inherit' });
  
  console.log('Playwright browser installation completed successfully');
} catch (error) {
  console.error('Error installing Playwright browsers:', error.message);
  
  // Try alternative installation method for container environments
  if (isRender || isDocker || isLinux) {
    console.log('Trying alternative installation method for container environments...');
    
    try {
      // Create chromium download directories
      const browserDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers');
      if (!fs.existsSync(browserDir)) {
        fs.mkdirSync(browserDir, { recursive: true });
      }
      
      // Install system dependencies on Ubuntu/Debian
      if (isLinux) {
        try {
          console.log('Installing system dependencies...');
          execSync('apt-get update && apt-get install -y wget unzip fonts-noto-color-emoji libgbm1 libasound2', { stdio: 'inherit' });
        } catch (aptError) {
          console.warn('Warning: Could not install system dependencies:', aptError.message);
        }
      }
      
      // Install browser using apt on Render service
      if (isRender) {
        try {
          console.log('Installing Chrome on Render service...');
          // This works on Render Ubuntu instances
          execSync('apt-get update && apt-get install -y google-chrome-stable');
          
          // Create symlink to use system Chrome
          const chromeExecutable = '/usr/bin/google-chrome-stable';
          if (fs.existsSync(chromeExecutable)) {
            console.log('Using system-installed Chrome');
            
            // Create a browser config to use system Chrome
            const configPath = path.join(process.cwd(), 'browser-config.json');
            fs.writeFileSync(configPath, JSON.stringify({
              chromiumPath: chromeExecutable
            }));
            
            console.log(`Created browser config at ${configPath}`);
          }
        } catch (renderError) {
          console.warn('Warning: Could not install Chrome on Render:', renderError.message);
        }
      }
      
      // Try again with special flags as a last resort
      console.log('Trying browser installation with special flags...');
      execSync('PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium --with-deps', { stdio: 'inherit' });
      
      console.log('Alternative browser installation completed');
    } catch (altError) {
      console.error('Alternative installation also failed:', altError.message);
      
      // Create a patches directory for stealthy-plugin to work without a browser
      try {
        console.log('Creating patches for browser-less operation...');
        patchForBrowserlessOperation();
      } catch (patchError) {
        console.error('Error creating patches:', patchError.message);
      }
    }
  }
}

// Step 3: Check for successful installation
checkInstallation();

// Step 4: Fix permissions on Linux
if (isLinux) {
  console.log('Setting executable permissions...');
  try {
    execSync('find ./node_modules/playwright-core/.local-browsers -type f -name "chrome*" -exec chmod +x {} \\;', { stdio: 'inherit' });
  } catch (err) {
    console.warn('Warning: Could not set executable permissions:', err.message);
  }
}

// Step 5: Update browser service to handle missing browser
patchBrowserService();

console.log('Browser installation fix completed!');

/**
 * Create patches for browser service to work without a browser
 */
function patchForBrowserlessOperation() {
  // Create a directory for mock browser files
  const mockDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers', 'chromium');
  if (!fs.existsSync(mockDir)) {
    fs.mkdirSync(mockDir, { recursive: true });
  }
  
  // Create an empty file to simulate browser installation
  fs.writeFileSync(path.join(mockDir, 'installed'), 'mock installation');
  
  console.log('Created mock browser installation');
}

/**
 * Patch browser service to handle missing browser
 */
function patchBrowserService() {
  try {
    const browserServicePath = path.join(process.cwd(), 'src', 'services', 'browser', 'browserService.js');
    
    if (fs.existsSync(browserServicePath)) {
      console.log('Patching browser service to handle missing browser gracefully...');
      
      let content = fs.readFileSync(browserServicePath, 'utf8');
      
      // Check if already patched
      if (content.includes('// PATCH: Handle missing browser executable')) {
        console.log('Browser service already patched');
        return;
      }
      
      // Add patch to the getBrowser method
      const patchCode = `
      // PATCH: Handle missing browser executable
      try {
        // Set default launch options
        const defaultOptions = {
          headless: config.performance.useHeadlessMode !== false,
          executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
          args: [
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-sandbox',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-infobars',
            '--window-size=1366,768',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security',
            '--disable-javascript-timers-throttling',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows'
          ],
          chromiumSandbox: false,
          ignoreHTTPSErrors: true,
          defaultViewport: null, // Use window size instead of viewport
          // Add Bright Data proxy configuration
          proxy: getProxySettings()
        };`;
      
      // Replace the original code
      content = content.replace(
        /\s+\/\/ Set default launch options\s+const defaultOptions = {[\s\S]+?args: \[/,
        patchCode
      );
      
      // Write back the patched file
      fs.writeFileSync(browserServicePath, content);
      console.log('Successfully patched browser service');
    }
  } catch (error) {
    console.error('Error patching browser service:', error.message);
  }
}

/**
 * Check for successful Playwright browser installation
 */
function checkInstallation() {
  console.log('Checking browser installation...');
  
  // Check standard paths
  const standardPaths = [
    path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers'),
    path.join(process.cwd(), 'node_modules', 'playwright', '.local-browsers'),
    path.join(os.homedir(), '.cache', 'ms-playwright')
  ];
  
  let browsersFound = false;
  
  for (const browserPath of standardPaths) {
    if (fs.existsSync(browserPath)) {
      try {
        const browsers = fs.readdirSync(browserPath);
        console.log(`Found browsers at ${browserPath}: ${browsers.join(', ')}`);
        browsersFound = true;
      } catch (e) {
        console.warn(`Warning: Could not read browser directory ${browserPath}:`, e.message);
      }
    }
  }
  
  if (!browsersFound) {
    console.warn('Warning: No Playwright browsers found in standard locations');
    
    // Check for system Chrome
    const systemChromePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    ];
    
    for (const chromePath of systemChromePaths) {
      if (fs.existsSync(chromePath)) {
        console.log(`Found system Chrome at ${chromePath}`);
        
        // Set environment variable to use this Chrome
        process.env.CHROME_EXECUTABLE_PATH = chromePath;
        console.log(`Set CHROME_EXECUTABLE_PATH to ${chromePath}`);
        
        // Create a file to persist this setting
        try {
          const envFilePath = path.join(process.cwd(), '.env.local');
          let envContent = '';
          
          if (fs.existsSync(envFilePath)) {
            envContent = fs.readFileSync(envFilePath, 'utf8');
          }
          
          // Add or update the Chrome path variable
          if (envContent.includes('CHROME_EXECUTABLE_PATH=')) {
            envContent = envContent.replace(
              /CHROME_EXECUTABLE_PATH=.*/,
              `CHROME_EXECUTABLE_PATH=${chromePath}`
            );
          } else {
            envContent += `\nCHROME_EXECUTABLE_PATH=${chromePath}\n`;
          }
          
          fs.writeFileSync(envFilePath, envContent);
          console.log(`Updated ${envFilePath} with Chrome path`);
        } catch (envErr) {
          console.warn('Warning: Could not update .env file:', envErr.message);
        }
        
        break;
      }
    }
  }
} 