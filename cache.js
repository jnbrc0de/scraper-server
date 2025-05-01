const NodeCache = require('node-cache');
require('dotenv').config();

// TTL padrão em segundos (default: 4 horas)
const ttl = parseInt(process.env.CACHE_TTL_SECONDS, 10) || 14400;

// Exporta instância de cache em memória para uso global
module.exports = new NodeCache({ stdTTL: ttl, checkperiod: 600 });
