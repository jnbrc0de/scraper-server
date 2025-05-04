/**
 * Direct Chromium Download Script
 * 
 * This script downloads Chromium directly from source without using Playwright's installer
 * which sometimes fails on Windows environments.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const os = require('os');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { createUnzip } = require('zlib');
const { Extract } = require('unzipper');

const streamPipeline = promisify(pipeline);

// Log with timestamp
const log = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

log('Starting direct Chromium download...');

// Detect Chrome installation first
async function findSystemChrome() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      log(`Found Chrome at: ${chromePath}`);
      
      // Create browser-config.json
      const configPath = path.join(process.cwd(), 'browser-config.json');
      fs.writeFileSync(configPath, JSON.stringify({ chromiumPath: chromePath }));
      log(`Created browser config at ${configPath}`);
      
      // Set environment variable
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
      } catch (err) {
        log(`Error saving Chrome path: ${err.message}`);
      }
      
      return chromePath;
    }
  }
  
  log('No system Chrome installation found. Will download standalone Chrome.');
  return null;
}

// Create the mock directory structure
function createMockDirectories() {
  const playwrightDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers');
  const chromiumDir = path.join(playwrightDir, 'chromium-1069');
  
  try {
    if (!fs.existsSync(playwrightDir)) {
      fs.mkdirSync(playwrightDir, { recursive: true });
    }
    
    if (!fs.existsSync(chromiumDir)) {
      fs.mkdirSync(chromiumDir, { recursive: true });
    }
    
    log(`Created directories: ${chromiumDir}`);
    return chromiumDir;
  } catch (err) {
    log(`Error creating directories: ${err.message}`);
    throw err;
  }
}

// Download a file from a URL
async function downloadFile(url, destPath) {
  log(`Downloading from ${url}`);
  log(`Saving to ${destPath}`);
  
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      const fileStream = createWriteStream(destPath);
      
      fileStream.on('error', err => {
        fs.unlink(destPath, () => {});  // Clean up on error
        reject(err);
      });
      
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastLoggedPercent = -1;
      
      response.on('data', chunk => {
        downloadedBytes += chunk.length;
        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
        
        if (percent % 10 === 0 && percent !== lastLoggedPercent) {
          log(`Download progress: ${percent}%`);
          lastLoggedPercent = percent;
        }
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        log('Download completed');
        resolve();
      });
    });
    
    request.on('error', err => {
      fs.unlink(destPath, () => {});  // Clean up on error
      reject(err);
    });
  });
}

// Extract zip file
async function extractZip(zipPath, extractDir) {
  log(`Extracting ${zipPath} to ${extractDir}`);
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(Extract({ path: extractDir }))
      .on('entry', entry => {
        // Log occasional progress
        if (Math.random() < 0.01) {
          log(`Extracting: ${entry.path}`);
        }
      })
      .on('close', () => {
        log('Extraction completed');
        resolve();
      })
      .on('error', err => {
        reject(err);
      });
  });
}

// Install dependencies for Chrome
async function installDependenciesWindows() {
  try {
    // Try to install unzipper if not already installed
    try {
      require('unzipper');
    } catch (err) {
      log('Installing unzipper package...');
      execSync('npm install unzipper', { stdio: 'inherit' });
    }
    
    return true;
  } catch (err) {
    log(`Error installing dependencies: ${err.message}`);
    return false;
  }
}

// Check if browsers already exist
function checkExistingBrowsers() {
  const possibleLocations = [
    path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers'),
    path.join(process.cwd(), 'node_modules', 'playwright', '.local-browsers'),
    path.join(os.homedir(), '.cache', 'ms-playwright')
  ];

  for (const location of possibleLocations) {
    if (fs.existsSync(location)) {
      try {
        const browsers = fs.readdirSync(location);
        if (browsers.some(dir => dir.startsWith('chromium-'))) {
          log(`Found existing Chromium at ${location}`);
          return true;
        }
      } catch (e) {}
    }
  }
  
  return false;
}

// Configure browser service to use downloaded browser
function configureBrowserService(chromePath) {
  try {
    const browserServicePath = path.join(process.cwd(), 'src', 'services', 'browser', 'browserService.js');
    
    if (fs.existsSync(browserServicePath)) {
      log('Configuring browserService.js to use Chrome...');
      
      let content = fs.readFileSync(browserServicePath, 'utf8');
      
      // Check if already patched
      if (content.includes('// CHROME_PATH_PATCH')) {
        log('browserService.js already patched');
        return;
      }
      
      // Insert the Chrome path configuration
      const patchCode = `
      // CHROME_PATH_PATCH
      const CHROME_PATH = ${JSON.stringify(chromePath)};
      // Set default launch options
      const defaultOptions = {
        headless: config.performance.useHeadlessMode !== false,
        executablePath: CHROME_PATH,
        args: [`;
      
      // Replace the original options
      const patched = content.replace(
        /\s+\/\/ Set default launch options\s+const defaultOptions = {[^{]*?headless[^,]*,/m,
        patchCode
      );
      
      if (patched !== content) {
        fs.writeFileSync(browserServicePath, patched);
        log('Successfully patched browserService.js');
      } else {
        log('Could not find the right section to patch. Will create a config file instead.');
      }
    }
  } catch (error) {
    log(`Error configuring browser service: ${error.message}`);
  }
}

// Main function
async function main() {
  try {
    // First check for Chrome installation
    const chromePath = await findSystemChrome();
    
    if (chromePath) {
      log('Using system Chrome, patching browser service...');
      configureBrowserService(chromePath);
      log('Setup complete! You can now run the application.');
      return;
    }
    
    // Check if browsers already exist
    if (checkExistingBrowsers()) {
      log('Chromium already installed. Setup complete!');
      return;
    }
    
    // Install required dependencies
    await installDependenciesWindows();
    
    // Create directories
    const chromiumDir = createMockDirectories();
    
    // Define paths
    const zipPath = path.join(os.tmpdir(), 'chrome-win.zip');
    
    // Download Chrome for Windows (current stable mini_installer)
    const downloadUrl = 'https://github.com/chromium/chrome-for-testing/releases/download/GoogleChrome-120.0.6099.71/chrome-win64.zip';
    
    await downloadFile(downloadUrl, zipPath);
    
    // Extract the downloaded file
    await extractZip(zipPath, chromiumDir);
    
    // Find the chrome.exe path after extraction
    const chromeExePath = path.join(chromiumDir, 'chrome-win64', 'chrome.exe');
    
    if (fs.existsSync(chromeExePath)) {
      log(`Chrome executable found at: ${chromeExePath}`);
      
      // Create a revision.json file for Playwright to find it
      const revisionInfo = {
        revision: '1069',
        executablePath: chromeExePath,
        folderPath: chromiumDir
      };
      
      fs.writeFileSync(
        path.join(chromiumDir, 'revision.json'),
        JSON.stringify(revisionInfo, null, 2)
      );
      
      // Create browser-config.json
      const configPath = path.join(process.cwd(), 'browser-config.json');
      fs.writeFileSync(configPath, JSON.stringify({ chromiumPath: chromeExePath }));
      log(`Created browser config at ${configPath}`);
      
      // Update browser service
      configureBrowserService(chromeExePath);
      
      // Clean up the zip file
      try {
        fs.unlinkSync(zipPath);
      } catch (err) {}
      
      log('Chrome installation complete! You can now run the application.');
    } else {
      log(`Error: Chrome executable not found at expected path: ${chromeExePath}`);
      throw new Error('Chrome extraction failed');
    }
  } catch (err) {
    log(`Error: ${err.message}`);
    log('Falling back to using system Chrome if available...');
    
    const chromePath = await findSystemChrome();
    if (chromePath) {
      configureBrowserService(chromePath);
      log('Setup complete using system Chrome!');
    } else {
      log('Error: No Chrome installation found and download failed. Please install Chrome and try again.');
    }
  }
}

// Run the main function
main().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
}); 