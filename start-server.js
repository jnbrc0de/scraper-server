/**
 * Script de inicialização alternativo que verifica dependências antes de iniciar o servidor
 * Útil para contornar problemas em ambientes Windows com PowerShell
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

console.log('Verificando dependências críticas...');

// Verificar dependências críticas
const missingDeps = [];
const criticalDeps = ['helmet', 'compression'];

criticalDeps.forEach(dep => {
  const depPath = path.join(__dirname, 'node_modules', dep);
  if (!fs.existsSync(depPath)) {
    missingDeps.push(dep);
  }
});

// Se houver dependências faltando, tentar instalá-las
if (missingDeps.length > 0) {
  console.log(`Dependências faltando: ${missingDeps.join(', ')}`);
  console.log('Tentando instalar dependências faltantes...');
  
  try {
    // Verificar se temos install-dependencies.js
    const installerPath = path.join(__dirname, 'install-dependencies.js');
    if (fs.existsSync(installerPath)) {
      console.log('Usando script de instalação personalizado...');
      execSync('node install-dependencies.js', { stdio: 'inherit' });
    } else {
      // Tentativa direta
      console.log('Tentando instalação direta...');
      execSync(`npm install ${missingDeps.join(' ')} --no-save`, { stdio: 'inherit' });
    }
    console.log('Dependências instaladas com sucesso!');
  } catch (error) {
    console.error('Erro ao instalar dependências:', error.message);
    console.log('\n===== ATENÇÃO =====');
    console.log('Não foi possível instalar automaticamente as dependências.');
    console.log('Por favor, execute manualmente:');
    console.log(`npm install ${missingDeps.join(' ')}`);
    console.log('=====================\n');
    
    // Perguntar se o usuário quer continuar mesmo assim
    console.log('Deseja continuar mesmo sem as dependências? (s/n)');
    process.stdin.once('data', (data) => {
      const answer = data.toString().trim().toLowerCase();
      if (answer !== 's' && answer !== 'sim' && answer !== 'y' && answer !== 'yes') {
        console.log('Operação cancelada pelo usuário.');
        process.exit(1);
      }
      startServer();
    });
  }
} else {
  // Todas as dependências estão presentes
  console.log('Todas as dependências críticas estão instaladas!');
  startServer();
}

/**
 * Inicia o servidor
 */
function startServer() {
  console.log('\nIniciando o servidor...');
  
  // Caminho para o arquivo do servidor
  const serverPath = path.join(__dirname, 'src', 'server.js');
  
  // Verificar se o arquivo existe
  if (!fs.existsSync(serverPath)) {
    console.error(`Erro: Arquivo do servidor não encontrado: ${serverPath}`);
    process.exit(1);
  }
  
  // Iniciar o servidor como um processo filho
  const serverProcess = spawn('node', [serverPath], {
    stdio: 'inherit'
  });
  
  // Lidar com eventos do processo
  serverProcess.on('error', (err) => {
    console.error('Erro ao iniciar o servidor:', err);
  });
  
  serverProcess.on('exit', (code) => {
    console.log(`Servidor encerrado com código: ${code}`);
  });
  
  // Encaminhar sinais para o processo filho
  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      console.log(`\nSinal ${signal} recebido. Encerrando servidor...`);
      serverProcess.kill(signal);
    });
  });
} 