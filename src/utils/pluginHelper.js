/**
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
      const playwright = require('playwright');
      
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
            'stealth/evasions/window.outerdimensions': path.join(path.dirname(stealthPath), 'evasions', 'window.outerdimensions')
          };
          
          // Monkey-patch o require para interceptar chamadas a estas dependências
          const originalRequire = module.constructor.prototype.require;
          module.constructor.prototype.require = function (name) {
            if (dependencyMap[name] && existsSync(dependencyMap[name] + '.js')) {
              try {
                console.log(`Resolvendo dependência: ${name} -> ${dependencyMap[name]}`);
                return originalRequire.call(this, dependencyMap[name]);
              } catch (e) {
                console.warn(`Falha ao carregar dependência ${name}, retornando módulo vazio`);
                return {};
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
          
          // Verificar se temos um mapeamento para a dependência solicitada
          if (dependencyMap[name] && existsSync(dependencyMap[name] + '.js')) {
            console.log(`Resolvendo dependência: ${name} -> ${dependencyMap[name]}`);
            return require(dependencyMap[name]);
          }
          
          // Tentar resolver normalmente se não for encontrado no mapa
          try {
            return require(name);
          } catch (e) {
            console.warn(`Aviso: Não foi possível resolver a dependência: ${name}`);
            // Retornar um módulo vazio para evitar falhas
            return {};
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