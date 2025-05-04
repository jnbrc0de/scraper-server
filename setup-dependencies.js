/**
 * Script para instalar e configurar corretamente as dependências do projeto
 * Especialmente os pacotes extras necessários para o stealth plugin e proxy
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Iniciando instalação e configuração do ambiente...');

// Função para verificar se uma dependência está instalada
function isPackageInstalled(packageName) {
  try {
    const nodeModulesPath = path.join(__dirname, 'node_modules', packageName);
    return fs.existsSync(nodeModulesPath);
  } catch (err) {
    return false;
  }
}

// Verifica e cria a estrutura de diretórios necessária
function ensureDirectoriesExist() {
  const dirs = [
    path.join(__dirname, 'logs'),
    path.join(__dirname, 'screenshots'),
    path.join(__dirname, 'captchas'),
    path.join(__dirname, 'tokens'),
    path.join(__dirname, 'src', 'utils'),
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Diretório criado: ${dir}`);
    }
  });
}

// Lista de dependências necessárias para o projeto
const dependencies = [
  'puppeteer-extra',
  'puppeteer-extra-plugin-stealth',
  'playwright-extra',
  'stealth',
  'https-proxy-agent',
  'socks-proxy-agent',
  'tesseract.js',
  'winston',
];

// Verifica e instala cada dependência
let installCommand = '';
for (const dep of dependencies) {
  if (!isPackageInstalled(dep)) {
    installCommand += `${dep} `;
  }
}

// Instala dependências ausentes
if (installCommand) {
  console.log(`Instalando dependências faltantes: ${installCommand}`);
  try {
    execSync(`npm install ${installCommand} --save`, { stdio: 'inherit' });
  } catch (err) {
    console.error('Erro ao instalar pacotes:', err.message);
    process.exit(1);
  }
} else {
  console.log('Todas as dependências necessárias já estão instaladas.');
}

// Cria o arquivo auxiliar para resolver problemas de dependência do plugin stealth
console.log('Configurando o plugin stealth com dependências apropriadas...');

const pluginHelperCode = `/**
 * Plugin Helper
 * Resolve problemas de dependências para plugins do playwright-extra e puppeteer-extra
 */

// Ajuda a resolver o problema do "stealth/evasions/chrome.webgl" dependency not found
function setupPluginDependencyResolution() {
  try {
    // Verifica se temos as bibliotecas necessárias
    const { existsSync } = require('fs');
    const path = require('path');
    
    // Tentar carregar puppeteer-extra-plugin-stealth
    let stealthPath = '';
    try {
      stealthPath = require.resolve('puppeteer-extra-plugin-stealth');
      console.log('Stealth plugin encontrado em:', stealthPath);
    } catch (e) {
      console.warn('Aviso: puppeteer-extra-plugin-stealth não encontrado. Os recursos de evasão podem não funcionar corretamente.');
      return;
    }
    
    // Configurar resolução de dependências para o playwright-extra
    try {
      const { addExtra } = require('playwright-extra');
      const { plugins } = addExtra(require('playwright').chromium);
      
      // Configurar resolução personalizada de dependências
      plugins.setDependencyResolver((name) => {
        // Mapear caminhos para dependências comuns que podem estar ausentes
        const dependencyMap = {
          'stealth/evasions/chrome.webgl': path.join(path.dirname(stealthPath), 'evasions', 'chrome.webgl'),
          'stealth/evasions/chrome.runtime': path.join(path.dirname(stealthPath), 'evasions', 'chrome.runtime'),
          'stealth/evasions/iframe.contentWindow': path.join(path.dirname(stealthPath), 'evasions', 'iframe.contentWindow'),
          'stealth/evasions/media.codecs': path.join(path.dirname(stealthPath), 'evasions', 'media.codecs'),
          'stealth/evasions/navigator.hardwareConcurrency': path.join(path.dirname(stealthPath), 'evasions', 'navigator.hardwareConcurrency'),
          'stealth/evasions/navigator.languages': path.join(path.dirname(stealthPath), 'evasions', 'navigator.languages'),
          'stealth/evasions/navigator.permissions': path.join(path.dirname(stealthPath), 'evasions', 'navigator.permissions'),
          'stealth/evasions/navigator.plugins': path.join(path.dirname(stealthPath), 'evasions', 'navigator.plugins'),
          'stealth/evasions/navigator.vendor': path.join(path.dirname(stealthPath), 'evasions', 'navigator.vendor'),
          'stealth/evasions/sourceurl': path.join(path.dirname(stealthPath), 'evasions', 'sourceurl'),
          'stealth/evasions/user-agent-override': path.join(path.dirname(stealthPath), 'evasions', 'user-agent-override'),
          'stealth/evasions/webgl.vendor': path.join(path.dirname(stealthPath), 'evasions', 'webgl.vendor'),
          'stealth/evasions/window.outerdimensions': path.join(path.dirname(stealthPath), 'evasions', 'window.outerdimensions'),
        };
        
        // Verificar se temos um mapeamento para a dependência solicitada
        if (dependencyMap[name] && existsSync(dependencyMap[name] + '.js')) {
          console.log(\`Resolvendo dependência: \${name} -> \${dependencyMap[name]}\`);
          return require(dependencyMap[name]);
        }
        
        // Tentar resolver normalmente se não for encontrado no mapa
        try {
          return require(name);
        } catch (e) {
          console.warn(\`Aviso: Não foi possível resolver a dependência: \${name}\`);
          // Retornar um módulo vazio para evitar falhas
          return {};
        }
      });
      
      console.log('Resolução de dependências para plugins configurada com sucesso');
    } catch (e) {
      console.warn('Aviso: Falha ao configurar resolução de dependências:', e.message);
    }
  } catch (e) {
    console.error('Erro ao configurar helper de plugins:', e);
  }
}

// Executar configuração
setupPluginDependencyResolution();

module.exports = {
  setupPluginDependencyResolution
};`;

// Garantir que o diretório utils existe
const utilsDir = path.join(__dirname, 'src', 'utils');
if (!fs.existsSync(utilsDir)) {
  fs.mkdirSync(utilsDir, { recursive: true });
}

fs.writeFileSync(path.join(utilsDir, 'pluginHelper.js'), pluginHelperCode);

// Cria um arquivo server-start.js otimizado que carrega o helper antes de iniciar o servidor
console.log('Configurando arquivo de inicialização do projeto...');

const serverStartCode = `/**
 * Arquivo de inicialização do servidor com configurações corretas
 */
// Carrega o helper que resolve dependências de plugins
require('./src/utils/pluginHelper');

// Carrega variáveis de ambiente
require('dotenv').config();

// Configuração explícita para o proxy Bright Data
const config = require('./src/config');
console.log('Configurando proxy Bright Data...');

// Inicializa o servidor
console.log('Iniciando servidor...');
require('./src/server');`;

fs.writeFileSync(path.join(__dirname, 'server-start.js'), serverStartCode);

// Cria um arquivo .env de exemplo se não existir
if (!fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = `# Configurações do servidor
PORT=3000
NODE_ENV=production

# Configurações do navegador
BROWSER_POOL_SIZE=2
MAX_CONCURRENT_SCRAPES=5
NAVIGATION_TIMEOUT=30000
WAIT_TIMEOUT=10000
SCRAPE_RETRIES=3
MEMORY_LIMIT_MB=400

# Configuração de proxy
USE_PROXIES=true
PROXY_ROTATION_STRATEGY=sequential

# Configuração de cache
CACHE_ENABLED=true
CACHE_TTL=3600

# Configuração de log
LOG_LEVEL=info`;

  fs.writeFileSync(path.join(__dirname, '.env'), envContent);
  console.log('Arquivo .env de exemplo criado');
}

// Atualiza package.json para usar o novo script de inicialização
try {
  const packageJsonPath = path.join(__dirname, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  // Adiciona os scripts para iniciar e configurar o servidor
  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts.start = 'node server-start.js';
  packageJson.scripts.setup = 'node setup-dependencies.js';
  packageJson.scripts.prod = 'NODE_ENV=production node server-start.js';
  packageJson.scripts.dev = 'nodemon server-start.js';
  
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log('package.json atualizado com novos scripts');
} catch (err) {
  console.error('Erro ao atualizar package.json:', err.message);
}

// Cria diretórios necessários
ensureDirectoriesExist();

console.log('\nConfiguração concluída com sucesso!');
console.log('\nPara iniciar o servidor em produção, execute:');
console.log('npm run prod');
console.log('\nPara iniciar em desenvolvimento, execute:');
console.log('npm run dev');
console.log('\nPara atualizar as dependências no futuro, execute:');
console.log('npm run setup'); 