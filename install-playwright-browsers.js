const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Remove the skip download file if it exists
const skipFile = path.join(__dirname, '.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD');
if (fs.existsSync(skipFile)) {
    console.log('Removing .PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD file...');
    fs.unlinkSync(skipFile);
}

// Function to run command with error handling
function runCommand(command) {
    try {
        console.log(`Running: ${command}`);
        execSync(command, { stdio: 'inherit' });
        return true;
    } catch (error) {
        console.error(`Error executing command: ${command}`);
        console.error(error.message);
        return false;
    }
}

// Main installation process
async function installBrowsers() {
    console.log('Starting Playwright browser installation...');

    // Step 1: Clear npm cache
    console.log('\nStep 1: Clearing npm cache...');
    runCommand('npm cache clean --force');

    // Step 2: Remove existing Playwright installation
    console.log('\nStep 2: Removing existing Playwright installation...');
    runCommand('npm uninstall playwright');

    // Step 3: Install Playwright fresh
    console.log('\nStep 3: Installing Playwright...');
    if (!runCommand('npm install playwright@latest')) {
        console.error('Failed to install Playwright');
        process.exit(1);
    }

    // Step 4: Install browsers
    console.log('\nStep 4: Installing Playwright browsers...');
    if (!runCommand('npx playwright install --with-deps chromium')) {
        console.error('Failed to install Playwright browsers');
        process.exit(1);
    }

    // Step 5: Verify installation
    console.log('\nStep 5: Verifying installation...');
    try {
        const { chromium } = require('playwright');
        console.log('Playwright module loaded successfully');
    } catch (error) {
        console.error('Failed to verify Playwright installation:', error);
        process.exit(1);
    }

    console.log('\nPlaywright browser installation completed successfully!');
}

// Run the installation
installBrowsers().catch(error => {
    console.error('Installation failed:', error);
    process.exit(1);
}); 