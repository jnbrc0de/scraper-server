/**
 * Solução definitiva para o erro de instalação do Playwright no Windows
 * 
 * Este script resolve o problema:
 * "error installing Playwright browsers: Command failed: npx playwright install --with-deps chromium"
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Função para log
const log = (message) => console.log(`[FIX] ${message}`);

log('Iniciando correção do Playwright...');

// Encontrar Chrome instalado
function detectarChrome() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      log(`Chrome encontrado em: ${chromePath}`);
      return chromePath;
    }
  }
  log('Chrome não encontrado. Por favor, instale o Google Chrome.');
  return null;
}

// Configurar ambiente
function configurarAmbiente(chromePath) {
  // 1. Criar browser-config.json
  const configPath = path.join(process.cwd(), 'browser-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ chromiumPath: chromePath }));
  log(`Arquivo de configuração criado em ${configPath}`);

  // 2. Definir variáveis de ambiente
  process.env.CHROME_EXECUTABLE_PATH = chromePath;
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
  
  // 3. Salvar variáveis no .env.local
  const envPath = path.join(process.cwd(), '.env.local');
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  // Atualizar variáveis existentes ou adicionar novas
  if (envContent.includes('CHROME_EXECUTABLE_PATH=')) {
    envContent = envContent.replace(/CHROME_EXECUTABLE_PATH=.*(\r?\n|$)/, `CHROME_EXECUTABLE_PATH=${chromePath}$1`);
  } else {
    envContent += `\nCHROME_EXECUTABLE_PATH=${chromePath}`;
  }
  
  if (!envContent.includes('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=')) {
    envContent += `\nPLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`;
  }
  
  if (!envContent.includes('PLAYWRIGHT_BROWSERS_PATH=')) {
    envContent += `\nPLAYWRIGHT_BROWSERS_PATH=0`;
  }
  
  fs.writeFileSync(envPath, envContent);
  log(`Variáveis de ambiente salvas em ${envPath}`);
}

// Criar diretórios necessários para o Playwright
function criarDiretoriosPlaywright(chromePath) {
  // Diretório para browsers
  const playwrightDir = path.join(process.cwd(), 'node_modules', 'playwright-core', '.local-browsers');
  if (!fs.existsSync(playwrightDir)) {
    fs.mkdirSync(playwrightDir, { recursive: true });
  }
  
  // Diretório específico do Chromium
  const chromiumDir = path.join(playwrightDir, 'chromium-1069');
  if (!fs.existsSync(chromiumDir)) {
    fs.mkdirSync(chromiumDir, { recursive: true });
  }
  
  // Criar arquivo de revisão
  const revision = {
    revision: '1069',
    executablePath: chromePath,
    folderPath: chromiumDir,
    installByDefault: true
  };
  
  fs.writeFileSync(
    path.join(chromiumDir, 'revision.json'),
    JSON.stringify(revision, null, 2)
  );
  
  // Arquivo para evitar download
  fs.writeFileSync('.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', '1');
  
  log('Diretórios e arquivos de configuração criados para o Playwright');
}

// Corrigir o package.json
function corrigirPackageJson() {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Remover scripts desnecessários
    const scriptsParaManter = ['fix-playwright', 'start', 'start:win', 'dev', 'build'];
    const novosScripts = {};
    
    for (const script in packageJson.scripts) {
      if (scriptsParaManter.includes(script)) {
        novosScripts[script] = packageJson.scripts[script];
      }
    }
    
    // Adicionar nosso script
    novosScripts['fix-playwright'] = 'node fix-playwright.js';
    novosScripts['install-browsers'] = 'node fix-playwright.js';
    
    packageJson.scripts = novosScripts;
    
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    log('Package.json atualizado para remover scripts desnecessários');
  }
}

// Corrigir o browserService.js para usar o Chrome
function corrigirBrowserService(chromePath) {
  const browserServicePath = path.join(process.cwd(), 'src', 'services', 'browser', 'browserService.js');
  
  if (fs.existsSync(browserServicePath)) {
    let content = fs.readFileSync(browserServicePath, 'utf8');
    
    // Verificar se já foi corrigido
    if (content.includes('// FIX-PLAYWRIGHT')) {
      log('O arquivo browserService.js já foi corrigido');
      return;
    }
    
    // Criar patch para usar o Chrome local
    const patchCode = `
      // FIX-PLAYWRIGHT
      const CHROME_PATH = ${JSON.stringify(chromePath)};
      // Set default launch options
      const defaultOptions = {
        headless: config.performance.useHeadlessMode !== false,
        executablePath: process.env.CHROME_EXECUTABLE_PATH || CHROME_PATH,
        args: [`;
    
    // Substituir configurações originais
    const patched = content.replace(
      /\s+\/\/ Set default launch options\s+const defaultOptions = {[^{]*?headless[^,]*,/m,
      patchCode
    );
    
    if (patched !== content) {
      fs.writeFileSync(browserServicePath, patched);
      log('Arquivo browserService.js corrigido para usar o Chrome local');
    } else {
      log('Não foi possível encontrar a seção a ser corrigida no browserService.js');
    }
  } else {
    log('Arquivo browserService.js não encontrado');
  }
}

// Remover arquivos desnecessários
function limparProjeto() {
  const arquivosParaRemover = [
    'fix-windows-browser.js',
    'setup-windows-environment.js',
    'download-chrome.js',
    'download-chrome-portable.js',
    'install-chromium.js',
    'fix-browser-installation.js'
  ];
  
  arquivosParaRemover.forEach(arquivo => {
    if (fs.existsSync(arquivo)) {
      try {
        fs.unlinkSync(arquivo);
        log(`Arquivo removido: ${arquivo}`);
      } catch (err) {
        log(`Erro ao remover ${arquivo}: ${err.message}`);
      }
    }
  });
}

// Função principal
async function main() {
  try {
    // 1. Encontrar Chrome
    const chromePath = detectarChrome();
    if (!chromePath) {
      log('Por favor, instale o Google Chrome e tente novamente.');
      process.exit(1);
    }
    
    // 2. Configurar ambiente
    configurarAmbiente(chromePath);
    
    // 3. Criar diretórios e arquivos do Playwright
    criarDiretoriosPlaywright(chromePath);
    
    // 4. Corrigir browserService.js
    corrigirBrowserService(chromePath);
    
    // 5. Limpar o projeto
    limparProjeto();
    
    // 6. Corrigir package.json
    corrigirPackageJson();
    
    log('CORREÇÃO CONCLUÍDA!');
    log(`Chrome em ${chromePath} será usado no lugar dos navegadores do Playwright`);
    log('Execute "npm run start:win" para iniciar o servidor');
  } catch (error) {
    log(`ERRO: ${error.message}`);
    process.exit(1);
  }
}

// Executar
main(); 