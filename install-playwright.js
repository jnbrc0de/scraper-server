const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔧 Playwright setup started...');

// Define diretório local para cache de browsers
const browserPath = path.join(__dirname, '.pw-browsers');
process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;

// Garante que o diretório de cache existe e é gravável
try {
  fs.mkdirSync(browserPath, { recursive: true }); // always recursive, no need to check exists
  fs.accessSync(browserPath, fs.constants.W_OK);
} catch (e) {
  console.error(`❌ Browser cache directory "${browserPath}" is not writable.`, e.message);
  process.exit(1);
}

// Executa comandos shell de forma segura
function run(command) {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (e) {
    console.error(`❌ Command failed: ${command}\n`, e.message);
    process.exit(1);
  }
}

// Instala playwright se necessário
try {
  require.resolve('playwright');
} catch (err) {
  console.log('📦 Installing playwright...');
  run('npm install playwright');
}

// Instala Chromium apenas se não estiver presente
const chromiumMarker = path.join(browserPath, 'chromium-marker');
if (!fs.existsSync(chromiumMarker)) {
  console.log('⬇️  Installing Chromium...');
  const playwrightCli = path.join(__dirname, 'node_modules', 'playwright', 'cli.js');
  if (fs.existsSync(playwrightCli)) {
    run(`node ${playwrightCli} install chromium`);
  } else {
    run('npx playwright install chromium');
  }
  fs.writeFileSync(chromiumMarker, 'installed');
} else {
  console.log('✅ Chromium already installed.');
}

console.log('🎉 Playwright setup complete!');
