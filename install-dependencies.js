/**
 * Script para instalar dependências do projeto
 * Alternativa quando há problemas com PowerShell ou npm diretamente
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Lista de dependências críticas que precisam ser instaladas
const CRITICAL_DEPENDENCIES = [
  'helmet',
  'compression'
];

// Verifica se diretório node_modules existe
if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
  console.log('Diretório node_modules não encontrado. Criando...');
  fs.mkdirSync(path.join(__dirname, 'node_modules'), { recursive: true });
}

// Instala cada dependência
CRITICAL_DEPENDENCIES.forEach(dep => {
  console.log(`\nInstalando dependência: ${dep}`);
  try {
    // Verifica se a dependência já está instalada
    if (fs.existsSync(path.join(__dirname, 'node_modules', dep))) {
      console.log(`Dependência ${dep} já está instalada. Pulando.`);
      return;
    }
    
    // Executa comando com node
    execSync(`node "${process.execPath}" "${path.join(process.execPath, '../node_modules/npm/bin/npm-cli.js')}" install ${dep} --no-save`, {
      stdio: 'inherit',
      shell: true
    });
    console.log(`Dependência ${dep} instalada com sucesso!`);
  } catch (error) {
    console.error(`Erro ao instalar ${dep}:`, error.message);

    // Tenta método alternativo
    try {
      console.log(`Tentando método alternativo para instalar ${dep}...`);
      execSync(`node -e "require('child_process').execSync('npm install ${dep} --no-save', {stdio: 'inherit'})"`, {
        stdio: 'inherit',
        shell: true
      });
      console.log(`Dependência ${dep} instalada com sucesso (método alternativo)!`);
    } catch (err) {
      console.error(`Falha total ao instalar ${dep}. Você precisará instalá-la manualmente.`);
    }
  }
});

console.log('\nVerificação de dependências concluída!');
console.log('Se houver erros acima, você pode precisar instalar as dependências manualmente.');
console.log('Use o comando: npm install\n');

// Agora com instrução para executar o servidor
console.log('Para iniciar o servidor, use: node src/server.js\n'); 