/**
 * Chrome Portable Downloader
 * 
 * Downloads a portable version of Chrome for Windows
 * Provides a reliable alternative to the built-in Playwright browser installation
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec, execSync } = require('child_process');
const os = require('os');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// Configuration
const CHROME_DOWNLOAD_URL = 'https://github.com/portapps/ungoogled-chromium-portable/releases/download/114.0.5735.134-26/ungoogled-chromium-portable-win64-114.0.5735.134-26.7z';
const DOWNLOAD_PATH = path.join(process.cwd(), 'chrome-portable.7z');
const EXTRACT_PATH = path.join(process.cwd(), 'chrome-portable');
const CHROME_EXE_PATH = path.join(EXTRACT_PATH, 'ungoogled-chromium-portable.exe');
const CONFIG_PATH = path.join(process.cwd(), 'browser-config.json');
const ENV_PATH = path.join(process.cwd(), '.env.local');

// Check if 7zip is available (needed for extraction)
function check7ZipAvailability() {
  try {
    execSync('where 7z', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Display a header with timestamp
function logHeader(message) {
  console.log('\n' + '='.repeat(80));
  console.log(`[${new Date().toISOString()}] ${message}`);
  console.log('='.repeat(80));
}

// Display a log message with timestamp
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Download a file from URL
async function downloadFile(url, outputPath) {
  log(`Downloading from ${url}`);
  log(`This might take a while... Please be patient.`);
  
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status code: ${response.statusCode}`));
        return;
      }
      
      const fileSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      let lastLoggedPercent = 0;
      
      response.on('data', chunk => {
        downloadedSize += chunk.length;
        const percent = Math.floor((downloadedSize / fileSize) * 100);
        
        if (percent > lastLoggedPercent + 9) {
          lastLoggedPercent = percent;
          log(`Download progress: ${percent}%`);
        }
      });
      
      const fileStream = createWriteStream(outputPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        log('Download completed successfully');
        resolve();
      });
      
      fileStream.on('error', err => {
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    }).on('error', err => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// Extract the 7z archive
function extractArchive(archivePath, outputPath) {
  log(`Extracting to ${outputPath}`);
  
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
      }
      
      const command = `7z x "${archivePath}" -o"${outputPath}" -y`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Extraction failed: ${error.message}`));
          return;
        }
        
        log('Extraction completed successfully');
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Update configuration files to use the portable Chrome
function updateConfig(chromePath) {
  log(`Updating configuration to use Chrome at: ${chromePath}`);
  
  // Update browser-config.json
  const config = { chromiumPath: chromePath };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  log(`Updated ${CONFIG_PATH}`);
  
  // Update .env.local
  let envContent = '';
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, 'utf8');
  }
  
  if (envContent.includes('CHROME_EXECUTABLE_PATH=')) {
    envContent = envContent.replace(/CHROME_EXECUTABLE_PATH=.*\n/g, `CHROME_EXECUTABLE_PATH=${chromePath.replace(/\\/g, '\\\\')}\n`);
  } else {
    envContent += `\nCHROME_EXECUTABLE_PATH=${chromePath.replace(/\\/g, '\\\\')}\n`;
  }
  
  fs.writeFileSync(ENV_PATH, envContent);
  log(`Updated ${ENV_PATH}`);
}

// Check for system Chrome in standard locations
function checkSystemChrome() {
  const possiblePaths = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  ];
  
  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      log(`Found system Chrome at: ${chromePath}`);
      return chromePath;
    }
  }
  
  log('No system Chrome installation found');
  return null;
}

// Create a mock browser installation for Playwright
function createMockBrowserFiles(chromePath) {
  log('Creating mock browser files for Playwright');
  
  const browserDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers');
  const chromiumDir = path.join(browserDir, 'chromium-1095');
  
  if (!fs.existsSync(browserDir)) {
    fs.mkdirSync(browserDir, { recursive: true });
  }
  
  if (!fs.existsSync(chromiumDir)) {
    fs.mkdirSync(chromiumDir, { recursive: true });
  }
  
  // Create a revision.json file
  const revision = {
    revision: '1095',
    browsers: [
      {
        name: 'chromium',
        revision: '1095',
        installByDefault: true,
        browserPath: chromePath
      }
    ]
  };
  
  fs.writeFileSync(path.join(chromiumDir, 'revision.json'), JSON.stringify(revision, null, 2));
  log('Created mock browser files');
}

// Main function
async function main() {
  logHeader('Chrome Portable Downloader');
  log(`Platform: ${os.platform()} ${os.arch()}`);
  
  try {
    // First check if we already have a system Chrome
    const systemChromePath = checkSystemChrome();
    if (systemChromePath) {
      log('Using system Chrome installation');
      updateConfig(systemChromePath);
      createMockBrowserFiles(systemChromePath);
      logHeader('Configuration Complete');
      log('Your project is now configured to use the system Chrome installation.');
      log('You can now run your application without Playwright browser installation.');
      return;
    }
    
    // Check if 7zip is available
    if (!check7ZipAvailability()) {
      log('7-Zip is not installed or not in PATH. Please install 7-Zip and add it to PATH.');
      log('You can download 7-Zip from: https://www.7-zip.org/download.html');
      log('After installing, try running this script again.');
      process.exit(1);
    }
    
    // Remove previous downloads/extractions if they exist
    if (fs.existsSync(DOWNLOAD_PATH)) {
      log(`Removing previous download: ${DOWNLOAD_PATH}`);
      fs.unlinkSync(DOWNLOAD_PATH);
    }
    
    if (fs.existsSync(EXTRACT_PATH)) {
      log(`Previous extraction found at: ${EXTRACT_PATH}`);
      log('Keeping existing extraction');
    } else {
      // Download portable Chrome
      await downloadFile(CHROME_DOWNLOAD_URL, DOWNLOAD_PATH);
      
      // Extract the archive
      await extractArchive(DOWNLOAD_PATH, EXTRACT_PATH);
      
      // Cleanup the downloaded archive
      fs.unlinkSync(DOWNLOAD_PATH);
      log('Removed downloaded archive');
    }
    
    // Find Chrome executable in extracted files
    let chromePath = '';
    if (fs.existsSync(CHROME_EXE_PATH)) {
      chromePath = CHROME_EXE_PATH;
    } else {
      // Search for chrome.exe in the extracted directory
      const findChrome = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            const result = findChrome(filePath);
            if (result) return result;
          } else if (file.toLowerCase() === 'chrome.exe' || file.toLowerCase().includes('chromium')) {
            return filePath;
          }
        }
        return null;
      };
      
      chromePath = findChrome(EXTRACT_PATH);
      if (!chromePath) {
        throw new Error('Could not find Chrome executable in extracted files');
      }
    }
    
    log(`Found Chrome executable at: ${chromePath}`);
    
    // Update configuration
    updateConfig(chromePath);
    
    // Create mock browser files
    createMockBrowserFiles(chromePath);
    
    logHeader('Installation Complete');
    log('Portable Chrome has been downloaded and configured successfully.');
    log('You can now run your application without Playwright browser installation.');
    
  } catch (error) {
    logHeader('ERROR');
    log(`An error occurred: ${error.message}`);
    
    // Fallback to system Chrome
    const systemChromePath = checkSystemChrome();
    if (systemChromePath) {
      log('Falling back to system Chrome installation');
      updateConfig(systemChromePath);
      createMockBrowserFiles(systemChromePath);
      logHeader('Fallback Configuration Complete');
      log('Your project is now configured to use the system Chrome installation.');
    } else {
      log('No Chrome installation found. Please install Chrome manually and run this script again.');
    }
  }
}

// Run the main function
main().catch(err => {
  logHeader('FATAL ERROR');
  log(err.stack || err.message);
  process.exit(1);
}); 