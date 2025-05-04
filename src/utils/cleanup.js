/**
 * Cleanup Utility
 * Script para limpar arquivos temporários e executar tarefas de manutenção
 */
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

// Configurações
const AGE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const DIRS_TO_CLEAN = [
  { path: 'screenshots', maxAge: AGE_LIMIT_MS },
  { path: 'captchas', maxAge: AGE_LIMIT_MS },
  { path: 'logs', maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dias para logs
];

/**
 * Limpa arquivos antigos de um diretório
 * @param {string} dirPath - Caminho do diretório
 * @param {number} maxAge - Idade máxima dos arquivos em ms
 * @returns {Promise<number>} - Número de arquivos removidos
 */
async function cleanDirectory(dirPath, maxAge) {
  try {
    const now = Date.now();
    const fullPath = path.resolve(process.cwd(), dirPath);
    
    // Verifica se o diretório existe
    try {
      await fs.access(fullPath);
    } catch (e) {
      logger.info(`Directory ${dirPath} does not exist, creating it`);
      await fs.mkdir(fullPath, { recursive: true });
      return 0;
    }
    
    // Lista arquivos no diretório
    const files = await fs.readdir(fullPath);
    
    // Counter for deleted files
    let deleted = 0;
    
    // Process each file
    for (const file of files) {
      try {
        const filePath = path.join(fullPath, file);
        const stats = await fs.stat(filePath);
        
        // Check if it's a file
        if (stats.isFile()) {
          const fileAge = now - stats.mtime.getTime();
          
          // Delete if older than maxAge
          if (fileAge > maxAge) {
            await fs.unlink(filePath);
            deleted++;
          }
        }
      } catch (error) {
        logger.error(`Error processing file ${file}`, {}, error);
      }
    }
    
    return deleted;
  } catch (error) {
    logger.error(`Error cleaning directory ${dirPath}`, {}, error);
    return 0;
  }
}

/**
 * Função principal para limpeza
 */
async function cleanupAll() {
  logger.info('Starting cleanup process');
  
  const results = {};
  let totalDeleted = 0;
  
  // Clean each directory
  for (const dir of DIRS_TO_CLEAN) {
    const deleted = await cleanDirectory(dir.path, dir.maxAge);
    results[dir.path] = deleted;
    totalDeleted += deleted;
  }
  
  logger.info('Cleanup completed', { 
    totalFilesDeleted: totalDeleted,
    details: results
  });
  
  return { totalDeleted, results };
}

// Se executado diretamente (node cleanup.js)
if (require.main === module) {
  cleanupAll()
    .then(results => {
      console.log('Cleanup completed:');
      console.log(`Total files deleted: ${results.totalDeleted}`);
      for (const [dir, count] of Object.entries(results.results)) {
        console.log(`- ${dir}: ${count} files deleted`);
      }
      process.exit(0);
    })
    .catch(error => {
      console.error('Cleanup failed:', error);
      process.exit(1);
    });
} else {
  // Exporta se usado como módulo
  module.exports = {
    cleanupAll,
    cleanDirectory
  };
} 