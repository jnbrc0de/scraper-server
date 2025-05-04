/**
 * Plugin Helper
 * Resolve problemas de dependências para plugins do playwright-extra e puppeteer-extra
 */

// Ajuda a resolver o problema do "stealth/evasions/chrome.webgl" dependency not found
function setupPluginDependencyResolution() {
  try {
    // Verifica se temos as bibliotecas necessárias
    const { existsSync, mkdirSync, copyFileSync, writeFileSync } = require('fs');
    const path = require('path');
    
    // Tentar carregar puppeteer-extra-plugin-stealth
    let stealthPath = '';
    try {
      stealthPath = require.resolve('puppeteer-extra-plugin-stealth');
      console.log('Stealth plugin encontrado em:', stealthPath);
    } catch (e) {
      try {
        // Try alternate resolution method - look directly in node_modules
        const potentialPaths = [
          path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-extra-plugin-stealth', 'index.js'),
          path.join(process.cwd(), 'node_modules', 'puppeteer-extra-plugin-stealth', 'index.js'),
          '/opt/render/project/src/node_modules/puppeteer-extra-plugin-stealth/index.js' // Common path in render.com
        ];
        
        for (const potentialPath of potentialPaths) {
          if (existsSync(potentialPath)) {
            stealthPath = potentialPath;
            console.log('Stealth plugin encontrado (método alternativo) em:', stealthPath);
            break;
          }
        }
        
        if (!stealthPath) {
          console.warn('Aviso: puppeteer-extra-plugin-stealth não encontrado. Os recursos de evasão podem não funcionar corretamente.');
          // Create mock module to prevent errors
          createMockStealthModules();
          return;
        }
      } catch (e2) {
        console.warn('Aviso: puppeteer-extra-plugin-stealth não encontrado. Os recursos de evasão podem não funcionar corretamente.');
        // Create mock module to prevent errors
        createMockStealthModules();
        return;
      }
    }
    
    // Function to create mock modules if needed
    function createMockStealthModules() {
      try {
        const modulesDir = path.join(__dirname, '..', '..', 'node_modules');
        const stealthDir = path.join(modulesDir, 'stealth');
        const evasionsDir = path.join(stealthDir, 'evasions');
        
        // Create directories if they don't exist
        if (!existsSync(stealthDir)) {
          mkdirSync(stealthDir, { recursive: true });
        }
        
        if (!existsSync(evasionsDir)) {
          mkdirSync(evasionsDir, { recursive: true });
        }
        
        // List of common evasion files
        const evasionFiles = [
          'chrome.app',
          'chrome.csi',
          'chrome.loadTimes',
          'chrome.runtime',
          'chrome.webgl',
          'defaultArgs',
          'iframe.contentWindow',
          'media.codecs',
          'navigator.hardwareConcurrency',
          'navigator.languages',
          'navigator.permissions',
          'navigator.plugins',
          'navigator.vendor',
          'navigator.webdriver',
          'sourceurl',
          'user-agent-override',
          'webgl.vendor',
          'window.outerdimensions'
        ];
        
        // Create empty mock files for each evasion
        for (const file of evasionFiles) {
          const filePath = path.join(evasionsDir, file + '.js');
          if (!existsSync(filePath)) {
            const mockContent = `
// Mock evasion module created by pluginHelper
module.exports = function() {
  return {
    name: '${file}',
    requires: [],
    onPageCreated: async function() {}
  };
};`;
            writeFileSync(filePath, mockContent);
            console.log(`Created mock evasion module: ${file}.js`);
          }
        }
        
        console.log('Created mock stealth modules to prevent errors');
      } catch (err) {
        console.warn('Failed to create mock modules:', err.message);
      }
    }
    
    // Diretamente criar/copiar evasions para corrigir o problema de dependência
    try {
      const evasionsPath = path.join(path.dirname(stealthPath), 'evasions');
      const stealthDirPath = path.join(path.dirname(path.dirname(stealthPath)), 'stealth');
      const stealthEvasionsPath = path.join(stealthDirPath, 'evasions');
      
      // Verificar se o diretório de evasões existe
      if (existsSync(evasionsPath)) {
        // Criar diretórios stealth/evasions se não existirem
        if (!existsSync(stealthDirPath)) {
          mkdirSync(stealthDirPath, { recursive: true });
        }
        
        if (!existsSync(stealthEvasionsPath)) {
          mkdirSync(stealthEvasionsPath, { recursive: true });
        }
        
        // Lista de arquivos de evasão comuns
        const evasionFiles = [
          'chrome.app',
          'chrome.csi',
          'chrome.loadTimes',
          'chrome.runtime',
          'chrome.webgl', // O principal que causa problemas
          'defaultArgs',
          'iframe.contentWindow',
          'media.codecs',
          'navigator.hardwareConcurrency',
          'navigator.languages',
          'navigator.permissions',
          'navigator.plugins',
          'navigator.vendor',
          'navigator.webdriver',
          'sourceurl',
          'user-agent-override',
          'webgl.vendor',
          'window.outerdimensions'
        ];
        
        // Copiar/criar link para cada arquivo
        for (const file of evasionFiles) {
          const sourcePath = path.join(evasionsPath, file + '.js');
          const targetPath = path.join(stealthEvasionsPath, file + '.js');
          
          if (existsSync(sourcePath) && !existsSync(targetPath)) {
            try {
              // No Windows, copiar o arquivo em vez de criar link simbólico
              if (process.platform === 'win32') {
                copyFileSync(sourcePath, targetPath);
              } else {
                // Em sistemas Unix, criar link simbólico
                require('fs').symlinkSync(sourcePath, targetPath);
              }
              console.log(`Criado link/cópia para ${file}.js`);
            } catch (linkErr) {
              console.warn(`Não foi possível criar link para ${file}.js:`, linkErr.message);
              // Tentar cópia direta como fallback
              try {
                copyFileSync(sourcePath, targetPath);
                console.log(`Copiado ${file}.js como fallback`);
              } catch (copyErr) {
                console.warn(`Também não foi possível copiar ${file}.js:`, copyErr.message);
                
                // If copy fails, create an empty mock file
                try {
                  const mockContent = `
// Mock evasion module created by pluginHelper
module.exports = function() {
  return {
    name: '${file}',
    requires: [],
    onPageCreated: async function() {}
  };
};`;
                  writeFileSync(targetPath, mockContent);
                  console.log(`Created mock evasion module for ${file}.js`);
                } catch (mockErr) {
                  console.warn(`Could not create mock module for ${file}.js:`, mockErr.message);
                }
              }
            }
          } else if (!existsSync(sourcePath) && !existsSync(targetPath)) {
            // Source doesn't exist, create a mock file
            try {
              const mockContent = `
// Mock evasion module created by pluginHelper
module.exports = function() {
  return {
    name: '${file}',
    requires: [],
    onPageCreated: async function() {}
  };
};`;
              writeFileSync(targetPath, mockContent);
              console.log(`Created mock evasion module for ${file}.js (source missing)`);
            } catch (mockErr) {
              console.warn(`Could not create mock module for ${file}.js:`, mockErr.message);
            }
          }
        }
      } else {
        // If evasions directory doesn't exist, create mock modules
        console.warn('Evasions directory not found, creating mock modules');
        createMockStealthModules();
      }
    } catch (fileErr) {
      console.warn('Erro ao configurar arquivos de evasão:', fileErr.message);
      // Attempt to create mock modules if file operations fail
      createMockStealthModules();
    }
    
    // Configurar resolução de dependências para o playwright-extra
    try {
      // Load playwright-extra safely
      let playwrightExtra;
      try {
        playwrightExtra = require('playwright-extra');
      } catch (e) {
        console.warn('playwright-extra not found or could not be loaded:', e.message);
        return;
      }
      
      const { addExtra } = playwrightExtra;
      
      // Check if playwright can be loaded
      let playwright;
      try {
        playwright = require('playwright');
      } catch (e) {
        console.warn('playwright not found or could not be loaded:', e.message);
        return;
      }
      
      // Verificar se o método de plugins existe e iniciar corretamente
      let plugins;
      try {
        plugins = addExtra(playwright.chromium).plugins;
        
        // Verifica se o método setDependencyResolver existe
        if (!plugins || typeof plugins.setDependencyResolver !== 'function') {
          // Método alternativo: usar uma abordagem de monkey-patching para resolver dependências
          console.log('Usando método alternativo para resolução de dependências');
          
          // Criar um mapa de dependências
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
          
          // Add fallback paths for server environments (like render.com)
          const serverFallbackPaths = {
            'stealth/evasions/chrome.webgl': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'chrome.webgl'),
            'stealth/evasions/chrome.runtime': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'chrome.runtime'),
            'stealth/evasions/iframe.contentWindow': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'iframe.contentWindow'),
            'stealth/evasions/media.codecs': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'media.codecs'),
            'stealth/evasions/navigator.hardwareConcurrency': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.hardwareConcurrency'),
            'stealth/evasions/navigator.languages': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.languages'),
            'stealth/evasions/navigator.permissions': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.permissions'),
            'stealth/evasions/navigator.plugins': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.plugins'),
            'stealth/evasions/navigator.vendor': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.vendor'),
            'stealth/evasions/sourceurl': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'sourceurl'),
            'stealth/evasions/user-agent-override': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'user-agent-override'),
            'stealth/evasions/webgl.vendor': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'webgl.vendor'),
            'stealth/evasions/window.outerdimensions': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'window.outerdimensions'),
          };
          
          // Garantir que todos os caminhos existem
          for (const [key, depPath] of Object.entries(dependencyMap)) {
            if (!existsSync(depPath + '.js')) {
              console.warn(`Aviso: Caminho de dependência inválido: ${depPath}.js`);
              
              // Check if the server fallback path exists
              if (existsSync(serverFallbackPaths[key] + '.js')) {
                dependencyMap[key] = serverFallbackPaths[key];
                console.log(`Using server fallback path for ${key}: ${serverFallbackPaths[key]}`);
                continue;
              }
              
              // Tentar encontrar o arquivo em um caminho alternativo
              const altPath = path.join(path.dirname(path.dirname(stealthPath)), key + '.js');
              if (existsSync(altPath)) {
                dependencyMap[key] = altPath.replace(/\.js$/, '');
                console.log(`Usando caminho alternativo para ${key}: ${altPath}`);
              }
            }
          }
          
          // Monkey-patch o require para interceptar chamadas a estas dependências
          const originalRequire = module.constructor.prototype.require;
          module.constructor.prototype.require = function (name) {
            if (dependencyMap[name] && existsSync(dependencyMap[name] + '.js')) {
              try {
                console.log(`Resolvendo dependência: ${name} -> ${dependencyMap[name]}`);
                return originalRequire.call(this, dependencyMap[name]);
              } catch (e) {
                console.warn(`Falha ao carregar dependência ${name}, retornando módulo vazio`);
                // Return a minimal mock module
                return {
                  name: name.split('/').pop(),
                  requires: [],
                  onPageCreated: async function() {}
                };
              }
            }
            
            // Try to load directly from our node_modules/stealth directory
            if (name.startsWith('stealth/evasions/') && existsSync(path.join(__dirname, '..', '..', 'node_modules', name + '.js'))) {
              try {
                const modulePath = path.join(__dirname, '..', '..', 'node_modules', name);
                console.log(`Resolvendo dependência (caminho direto): ${name} -> ${modulePath}`);
                return originalRequire.call(this, modulePath);
              } catch (e) {
                // Fallback to empty mock module
                console.warn(`Falha ao carregar dependência direta ${name}, retornando módulo vazio`);
                return {
                  name: name.split('/').pop(),
                  requires: [],
                  onPageCreated: async function() {}
                };
              }
            }
            
            return originalRequire.call(this, name);
          };
          
          console.log('Resolução alternativa de dependências configurada com sucesso');
          return;
        }
        
        // Usar o método padrão se disponível
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
          
          // Server fallback paths for render.com environment
          const serverFallbackPaths = {
            'stealth/evasions/chrome.webgl': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'chrome.webgl'),
            'stealth/evasions/chrome.runtime': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'chrome.runtime'),
            'stealth/evasions/iframe.contentWindow': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'iframe.contentWindow'),
            'stealth/evasions/media.codecs': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'media.codecs'),
            'stealth/evasions/navigator.hardwareConcurrency': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.hardwareConcurrency'),
            'stealth/evasions/navigator.languages': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.languages'),
            'stealth/evasions/navigator.permissions': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.permissions'),
            'stealth/evasions/navigator.plugins': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.plugins'),
            'stealth/evasions/navigator.vendor': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'navigator.vendor'),
            'stealth/evasions/sourceurl': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'sourceurl'),
            'stealth/evasions/user-agent-override': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'user-agent-override'),
            'stealth/evasions/webgl.vendor': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'webgl.vendor'),
            'stealth/evasions/window.outerdimensions': path.join(__dirname, '..', '..', 'node_modules', 'stealth', 'evasions', 'window.outerdimensions'),
          };
          
          // Verificar se temos um mapeamento para a dependência solicitada
          if (dependencyMap[name] && existsSync(dependencyMap[name] + '.js')) {
            console.log(`Resolvendo dependência: ${name} -> ${dependencyMap[name]}`);
            return require(dependencyMap[name]);
          }
          
          // Check server fallback paths
          if (serverFallbackPaths[name] && existsSync(serverFallbackPaths[name] + '.js')) {
            console.log(`Resolvendo dependência (servidor): ${name} -> ${serverFallbackPaths[name]}`);
            return require(serverFallbackPaths[name]);
          }
          
          // Tentar resolver diretamente no diretório stealth/evasions
          const alternativePath = path.join(path.dirname(path.dirname(stealthPath)), name);
          if (existsSync(alternativePath + '.js')) {
            console.log(`Resolvendo dependência (caminho alternativo): ${name} -> ${alternativePath}`);
            return require(alternativePath);
          }
          
          // Tentar resolver normalmente se não for encontrado no mapa
          try {
            return require(name);
          } catch (e) {
            console.warn(`Aviso: Não foi possível resolver a dependência: ${name}`);
            // Return a minimal mock module that won't crash the application
            return {
              name: name.split('/').pop(),
              requires: [],
              onPageCreated: async function() {}
            };
          }
        });
        
      } catch (e) {
        console.warn(`Erro ao configurar plugins: ${e.message}`);
        return;
      }
      
      console.log('Resolução de dependências para plugins configurada com sucesso');
    } catch (e) {
      console.warn('Aviso: Falha ao configurar resolução de dependências:', e.message);
    }
  } catch (e) {
    console.error('Erro ao configurar helper de plugins:', e);
  }
}

// Verificar compatibilidade das dependências instaladas
function checkDependenciesCompatibility() {
  try {
    const path = require('path');
    const fs = require('fs');
    
    // Encontrar o caminho correto para o package.json do projeto
    const projectRootPath = path.resolve(__dirname, '..', '..');
    const packageJsonPath = path.join(projectRootPath, 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
      console.warn(`Aviso: package.json não encontrado em ${packageJsonPath}`);
      return;
    }
    
    const pkg = require(packageJsonPath);
    const dependencies = pkg.dependencies || {};
    
    // Verificar dependências críticas
    const criticalDeps = [
      'playwright-extra',
      'puppeteer-extra-plugin-stealth',
      'playwright'
    ];
    
    let missingDeps = [];
    for (const dep of criticalDeps) {
      if (!dependencies[dep]) {
        missingDeps.push(dep);
      }
    }
    
    if (missingDeps.length > 0) {
      console.warn(`Aviso: Dependências críticas ausentes: ${missingDeps.join(', ')}`);
      console.warn('Execute "npm run setup" para instalar todas as dependências necessárias');
    } else {
      console.log('Todas as dependências críticas estão presentes.');
    }
    
    // Verificar compatibilidade de versões
    if (dependencies['playwright'] && dependencies['playwright-extra']) {
      try {
        const playwright = require('playwright');
        const playwrightExtra = require('playwright-extra');
        console.log(`Versões: playwright=${playwright.version || 'desconhecida'}, playwright-extra=${playwrightExtra.version || 'desconhecida'}`);
      } catch (e) {
        console.warn('Não foi possível verificar as versões das bibliotecas:', e.message);
      }
    }
  } catch (e) {
    console.warn('Não foi possível verificar a compatibilidade das dependências:', e.message);
  }
}

// Executar configuração
setupPluginDependencyResolution();
checkDependenciesCompatibility();

module.exports = {
  setupPluginDependencyResolution,
  checkDependenciesCompatibility
}; 