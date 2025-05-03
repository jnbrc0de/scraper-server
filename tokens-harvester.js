/**
 * Token Harvester Launcher
 * Run this script to start the token harvester as a separate process
 */
require('dotenv').config();
const harvester = require('./src/services/captcha/tokenHarvester');
const logger = require('./src/utils/logger');

logger.info('Starting token harvester process');

// Start harvester
harvester.start()
  .then(() => {
    logger.info('Token harvester running');
  })
  .catch(error => {
    logger.error('Failed to start token harvester', {}, error);
    process.exit(1);
  });

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down token harvester...');
  harvester.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down token harvester...');
  harvester.stop();
  process.exit(0);
}); 