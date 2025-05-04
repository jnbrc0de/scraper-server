/**
 * Arquivo de inicialização do servidor com configurações corretas
 */
// Verificar e instalar dependências do plugin se necessário
try {
  console.log('Verificando dependências do plugin...');
  require('./setup-plugin-dependencies');
} catch (e) {
  console.warn('Erro ao verificar dependências do plugin:', e.message);
  console.warn('Você pode precisar executar: npm run setup-plugins');
}

// Carrega o helper que resolve dependências de plugins
console.log('Inicializando resolução de dependências do plugin...');
require('./src/utils/pluginHelper');

// Carrega variáveis de ambiente
require('dotenv').config();

// Configuração explícita para o proxy Bright Data
const config = require('./src/config');
console.log('Configurando proxy Bright Data...');

// Inicializa o servidor
console.log('Iniciando servidor...');
require('./src/server'); 