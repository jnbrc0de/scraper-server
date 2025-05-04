/**
 * Playwright Browser Installation Script
 * 
 * This script downloads and installs the required browsers for Playwright,
 * handling error cases and OS compatibility.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Starting Playwright browser installation...');

// Check if we're running in a container or CI environment
const isContainer = checkIfContainer();
const isCI = process.env.CI === 'true';

// Determine platform-specific args
let installArgs = '';

if (isContainer || isCI) {
  console.log('Detected container or CI environment, using --with-deps flag');
  installArgs += ' --with-deps';
}

// Check system architecture and memory
const architecture = os.arch();
const totalMemoryMB = Math.floor(os.totalmem() / 1024 / 1024);

console.log(`System info: ${os.platform()} ${architecture}, ${totalMemoryMB}MB RAM`);

// For low memory systems, only install chromium
if (totalMemoryMB < 2048) {
  console.log('Low memory system detected, installing only Chromium browser');
  installArgs += ' chromium';
} else {
  console.log('Installing Chromium browser');
  installArgs += ' chromium';
}

// Check if we need to update browsers
try {
  // Run the installation command with appropriate args
  console.log(`Running: npx playwright install${installArgs}`);
  execSync(`npx playwright install${installArgs}`, { stdio: 'inherit' });
  console.log('Playwright browsers installed successfully!');
  
  // Check installation result
  const browserPath = path.join(
    process.cwd(),
    'node_modules',
    'playwright-core',
    '.local-browsers'
  );
  
  if (fs.existsSync(browserPath)) {
    console.log(`Browsers installed at: ${browserPath}`);
    // List installed browsers
    const browsers = fs.readdirSync(browserPath);
    console.log('Installed browsers:', browsers.join(', '));
  } else {
    console.log('Browser directory not found. Installation may have used a different path.');
  }
  
  // Ensure permissions are correct on Linux
  if (os.platform() === 'linux') {
    try {
      console.log('Setting executable permissions for Linux...');
      execSync('find ./node_modules/playwright-core/.local-browsers -type f -name "chrome*" -exec chmod +x {} \\;', { stdio: 'inherit' });
      execSync('find ./node_modules/playwright-core/.local-browsers -type f -name "firefox*" -exec chmod +x {} \\;', { stdio: 'inherit' });
    } catch (permErr) {
      console.warn('Warning: Could not set executable permissions:', permErr.message);
    }
  }
  
} catch (error) {
  console.error('Error installing Playwright browsers:', error.message);
  console.error('Please try manually running: npx playwright install');
  process.exit(1);
}

/**
 * Check if the process is running inside a container
 * @returns {boolean} - True if running in a container
 */
function checkIfContainer() {
  try {
    // Check for Docker
    if (fs.existsSync('/.dockerenv')) {
      return true;
    }
    
    // Check for container-specific paths
    if (fs.existsSync('/proc/1/cgroup')) {
      const content = fs.readFileSync('/proc/1/cgroup', 'utf-8');
      if (content.includes('docker') || content.includes('lxc') || content.includes('kubepods')) {
        return true;
      }
    }
    
    // Check for Render environment
    if (process.env.RENDER === 'true' || process.env.RENDER_SERVICE_ID) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

// Handle graceful exit
process.on('exit', () => {
  console.log('Browser installation process complete');
});
