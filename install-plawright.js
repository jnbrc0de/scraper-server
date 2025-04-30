// Script para instalar o Playwright sem problemas de permissão
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Iniciando instalação personalizada do Playwright...');

// Definir variável de ambiente para instalar navegadores no caminho do sistema
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

try {
  // Criar um script temporário para instalar o Playwright
  const scriptPath = path.join(__dirname, 'install-pw.sh');
  fs.writeFileSync(
    scriptPath,
    `#!/bin/bash
export PLAYWRIGHT_BROWSERS_PATH=0
echo "Instalando dependências do sistema para o Playwright..."
apt-get update -y
apt-get install -y wget gnupg ca-certificates
echo "Instalando o Chromium..."
apt-get install -y chromium-browser
echo "Configurando permissões..."
mkdir -p /ms-playwright
chmod -R 777 /ms-playwright
echo "Instalação concluída com sucesso!"
`,
    { mode: 0o755 }
  );

  // Executar o script com sudo se disponível
  try {
    console.log('Tentando executar com sudo...');
    execSync('sudo bash ' + scriptPath, { stdio: 'inherit' });
  } catch (e) {
    console.log('Sudo não disponível, tentando sem sudo...');
    execSync('bash ' + scriptPath, { stdio: 'inherit' });
  }

  // Limpar o script temporário
  fs.unlinkSync(scriptPath);

  // Modificar o arquivo scrape.js para usar o navegador do sistema
  const scrapePath = path.join(__dirname, 'scrape.js');
  if (fs.existsSync(scrapePath)) {
    console.log('Modificando scrape.js para usar o navegador do sistema...');
    let content = fs.readFileSync(scrapePath, 'utf8');
    
    // Adicionar configurações específicas para ambiente de produção
    const launchOptionsPattern = /chromium\.launch\(\s*\{\s*headless:\s*true/;
    if (launchOptionsPattern.test(content)) {
      content = content.replace(
        launchOptionsPattern,
        'chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox", "--disable-setuid-sandbox"]'
      );
    }
    
    fs.writeFileSync(scrapePath, content);
  }

  console.log('Configuração do Playwright concluída!');
} catch (error) {
  console.error('Erro durante a instalação:', error);
  process.exit(1);
}