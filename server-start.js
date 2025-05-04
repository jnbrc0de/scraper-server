/**
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
require('./src/server'); 