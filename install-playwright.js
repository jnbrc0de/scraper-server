const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔧 Playwright setup started...');

// Always use a local cache for browsers to avoid permission issues and improve scalability
const browserPath = path.join(__dirname, '.pw-browsers');
process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;

// Ensure browser cache directory exists and is writable
try {
  if (!fs.existsSync(browserPath)) fs.mkdirSync(browserPath, { recursive: true });
  fs.accessSync(browserPath, fs.constants.W_OK);
} catch (e) {
  console.error(`❌ Browser cache directory "${browserPath}" is not writable.`, e.message);
  process.exit(1);
}

// Helper to run commands safely
function run(command, fallback) {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (e) {
    if (fallback) {
      try {
        execSync(fallback, { stdio: 'inherit' });
        return;
      } catch (e2) {
        // continue to error below
      }
    }
    console.error(`❌ Command failed: ${command}\n`, e.message);
    process.exit(1);
  }
}

// Ensure playwright is installed
try {
  require.resolve('playwright');
} catch {
  console.log('📦 Installing playwright...');
  run('npm install playwright');
}

// Install Chromium only if not already present
const chromiumMarker = path.join(browserPath, 'chromium-marker');
if (!fs.existsSync(chromiumMarker)) {
  console.log('⬇️  Installing Chromium...');
  // Try npx first, fallback to node module bin
  run(
    'npx --no-install playwright install chromium',
    'node ./node_modules/playwright/cli.js install chromium'
  );
  fs.writeFileSync(chromiumMarker, 'installed');
} else {
  console.log('✅ Chromium already installed.');
}

console.log('🎉 Playwright setup complete!');
