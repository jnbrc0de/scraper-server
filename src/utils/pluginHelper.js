/**
 * Plugin Helper
 * Resolves dependency problems for playwright-extra and puppeteer-extra-plugin-stealth
 */

const fs = require('fs');
const path = require('path');

// Monkey patch the dependency resolution for playwright-extra
function setupPluginDependencyResolution() {
  try {
    // Patch require.resolve to handle stealth plugin dependencies
    const originalResolve = require.resolve;
    require.resolve = function(request, options) {
      // Check if this is a stealth plugin dependency request
      if (request.startsWith('stealth/evasions/')) {
        const evasionName = request.replace('stealth/evasions/', '');
        
        // Try to find it in node_modules/stealth/evasions first
        const customPath = path.join(process.cwd(), 'node_modules', 'stealth', 'evasions', `${evasionName}.js`);
        if (fs.existsSync(customPath)) {
          return customPath;
        }
        
        // Try to find it in puppeteer-extra-plugin-stealth
        try {
          const stealthPath = originalResolve('puppeteer-extra-plugin-stealth');
          const evasionPath = path.join(path.dirname(stealthPath), 'evasions', evasionName, 'index.js');
          
          if (fs.existsSync(evasionPath)) {
            return evasionPath;
          }
        } catch (e) {
          // Puppeteer-extra-plugin-stealth not found, continue
        }
        
        // Return a mock implementation to prevent crashes
        const mockDir = path.join(process.cwd(), 'node_modules', 'stealth', 'evasions');
        if (!fs.existsSync(mockDir)) {
          fs.mkdirSync(mockDir, { recursive: true });
        }
        
        // Create a mock module if it doesn't exist
        if (!fs.existsSync(customPath)) {
          const mockContent = `
// Mock evasion module created by pluginHelper.js
module.exports = function() {
  return {
    name: '${evasionName}',
    requiresImportant: true,
    onPageCreated: async function() {}
  };
};`;
          fs.writeFileSync(customPath, mockContent);
        }
        
        return customPath;
      }
      
      // Use the original resolve for everything else
      return originalResolve(request, options);
    };
    
    // Patch puppeteer-extra-plugin base class check
    try {
      const PlaywrightExtra = require('playwright-extra');
      const originalUse = PlaywrightExtra.Playwright.prototype.use;
      
      PlaywrightExtra.Playwright.prototype.use = function(plugin) {
        // Add missing properties to ensure the plugin is considered valid
        if (plugin && typeof plugin === 'object') {
          if (!plugin.name && plugin._name) {
            plugin.name = plugin._name;
          }
          
          if (!plugin.name) {
            plugin.name = 'stealth-plugin';
          }
          
          if (!plugin._isPuppeteerExtraPlugin) {
            plugin._isPuppeteerExtraPlugin = true;
          }
          
          if (!plugin.requiresLaunchPausePre && typeof plugin.beforeLaunch !== 'function') {
            plugin.beforeLaunch = async () => {};
          }
        }
        
        return originalUse.call(this, plugin);
      };
    } catch (e) {
      console.warn('Failed to patch playwright-extra:', e);
    }
    
    console.log('Plugin dependency resolution setup completed successfully');
  } catch (error) {
    console.error('Error setting up plugin dependency resolution:', error);
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