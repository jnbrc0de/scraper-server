const NodeCache = require('node-cache');
require('dotenv').config();

const ttl = parseInt(process.env.CACHE_TTL_SECONDS, 10) || 14400;
module.exports = new NodeCache({ stdTTL: ttl, checkperiod: 600 });
