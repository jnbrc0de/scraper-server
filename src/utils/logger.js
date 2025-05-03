/**
 * Logger utility module
 * Provides structured logging with configurable log levels and formats
 */
const config = require('../config');

class Logger {
  constructor() {
    // Definir níveis padrão caso config.logging não esteja disponível
    const defaultLevels = { error: 0, warn: 1, info: 2, debug: 3 };
    const defaultLevel = 'info';
    
    // Verificar se config e config.logging existem
    this.levels = (config && config.logging && config.logging.levels) || defaultLevels;
    this.currentLogLevel = this.levels[(config && config.logging && config.logging.level) || defaultLevel] || this.levels.info;
  }

  /**
   * Log a message with the specified level, context, and additional data
   * @param {string} level - The log level ('error', 'warn', 'info', 'debug')
   * @param {string} message - The main log message
   * @param {Object} [context={}] - Additional contextual information
   * @param {Error} [error=null] - Optional error object to include stack trace
   */
  log(level, message, context = {}, error = null) {
    if (this.levels[level] <= this.currentLogLevel) {
      const timestamp = new Date().toISOString();
      const logData = {
        level: level.toUpperCase(),
        timestamp,
        message,
        ...context
      };

      // Include error details if provided
      if (error) {
        logData.error = {
          message: error.message,
          stack: error.stack,
          name: error.name
        };
      }

      // In production, you might want to use a proper logging library like Winston or Pino
      // For now, we'll use console.log with JSON formatting
      if (level === 'error') {
        console.error(JSON.stringify(logData));
      } else {
        console.log(JSON.stringify(logData));
      }
    }
  }

  // Convenience methods for different log levels
  error(message, context = {}, error = null) {
    this.log('error', message, context, error);
  }

  warn(message, context = {}) {
    this.log('warn', message, context);
  }

  info(message, context = {}) {
    this.log('info', message, context);
  }

  debug(message, context = {}) {
    this.log('debug', message, context);
  }

  /**
   * Create a child logger with pre-filled context
   * @param {Object} baseContext - Context to include in all logs from this child
   * @returns {Object} - Child logger instance
   */
  child(baseContext = {}) {
    const childLogger = {};
    
    // Create methods that include the base context
    for (const level of Object.keys(this.levels)) {
      childLogger[level] = (message, context = {}, error = null) => {
        this.log(level, message, { ...baseContext, ...context }, error);
      };
    }
    
    return childLogger;
  }

  /**
   * Set the current log level
   * @param {string} level - The log level to set
   */
  setLevel(level) {
    if (this.levels[level] !== undefined) {
      this.currentLogLevel = this.levels[level];
    }
  }
}

// Export a singleton instance
module.exports = new Logger(); 