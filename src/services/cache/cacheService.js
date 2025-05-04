/**
 * Cache Service
 * Provides caching functionality with TTL support and domain-specific caching policies
 */
const NodeCache = require('node-cache');
const logger = require('../../utils/logger');
const config = require('../../config');
const crypto = require('crypto');

class CacheService {
  constructor() {
    // Inicializa o cache com tempo de vida padrão
    this.cache = new NodeCache({
      stdTTL: config.cache.ttl || 3600, // 1 hora por padrão
      checkperiod: Math.min(config.cache.ttl / 3 || 1200, 600) // Check expiration every n seconds (max 10 min)
    });
    
    this.enabled = config.cache.enabled;
    
    // Set up stats tracking
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hashedKeys: 0 // Contador para chaves que precisaram ser hasheadas
    };
    
    // Configurações por domínio
    this.domainSettings = new Map();
    
    // Configura políticas por domínio
    this._initializeDomainSettings();
    
    // Configura limpeza automática
    this._setupAutomaticCleanup();
    
    logger.info('Cache service initialized', {
      ttl: config.cache.ttl || 3600,
      enabled: this.enabled,
      domains: this.domainSettings.size
    });
  }

  /**
   * Initialize the cache service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      if (!this.enabled) {
        logger.info('Cache service is disabled, skipping initialization test');
        return true;
      }
      // Verifica se o cache está funcionando
      const testKey = 'test:initialization';
      const testValue = { timestamp: Date.now() };
      
      // Tenta setar e recuperar um valor de teste
      this.set(testKey, testValue, 60);
      const retrieved = this.get(testKey);
      
      if (!retrieved || retrieved.timestamp !== testValue.timestamp) {
        throw new Error('Cache initialization test failed');
      }
      
      // Remove o valor de teste
      this.delete(testKey);
      
      logger.info('Cache service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize cache service:', error);
      throw error;
    }
  }

  /**
   * Shutdown the cache service
   * @returns {Promise<void>}
   */
  async shutdown() {
    try {
      // Limpa o cache
      this.flush();
      
      // Para o NodeCache
      this.cache.close();
      
      logger.info('Cache service shut down successfully');
    } catch (error) {
      logger.error('Error shutting down cache service:', error);
      throw error;
    }
  }
  
  /**
   * Inicializa configurações por domínio
   * @private
   */
  _initializeDomainSettings() {
    // Carrega configurações de domínios do config
    const domainConfigs = config.cache.domains || {};
    
    // Adiciona domínios específicos
    Object.entries(domainConfigs).forEach(([domain, settings]) => {
      this.domainSettings.set(domain, {
        ttl: settings.ttl || config.cache.ttl || 3600,
        maxItems: settings.maxItems || 500,
        enabled: settings.enabled !== undefined ? settings.enabled : true
      });
    });
    
    // Adiciona configuração padrão para outros domínios
    this.defaultDomainSettings = {
      ttl: config.cache.ttl || 3600,
      maxItems: config.cache.maxItemsPerDomain || 1000,
      enabled: this.enabled
    };
  }
  
  /**
   * Configura limpeza periódica de cache
   * @private
   */
  _setupAutomaticCleanup() {
    const cleanupInterval = config.cache.cleanupInterval || 3600 * 1000; // 1 hora por padrão
    
    setInterval(() => {
      try {
        this._performCleanup();
      } catch (error) {
        logger.error('Error during cache cleanup', {}, error);
      }
    }, cleanupInterval);
  }
  
  /**
   * Executa limpeza de cache
   * @private
   */
  _performCleanup() {
    if (!this.enabled) return;
    
    const startTime = Date.now();
    let deletedItems = 0;
    
    try {
      // Mapeia entradas por domínio
      const domainItems = new Map();
      
      // Agrupa chaves por domínio
      const keys = this.cache.keys();
      keys.forEach(key => {
        // Extrai domínio da chave (formato é "namespace:dominio:identifier")
        const parts = key.split(':');
        if (parts.length >= 2) {
          const domain = parts[1];
          
          if (!domainItems.has(domain)) {
            domainItems.set(domain, []);
          }
          
          domainItems.get(domain).push(key);
        }
      });
      
      // Para cada domínio, verifica se excede o limite
      domainItems.forEach((domainKeys, domain) => {
        const settings = this.domainSettings.get(domain) || this.defaultDomainSettings;
        
        // Se o número de itens excede o limite, remove os mais antigos
        if (domainKeys.length > settings.maxItems) {
          // Obtém timestamps para classificação
          const keyData = domainKeys.map(key => {
            const value = this.cache.get(key);
            const timestamp = value && value.scraped_at 
              ? new Date(value.scraped_at).getTime() 
              : 0;
              
            return { key, timestamp };
          });
          
          // Ordena por timestamp (mais antigos primeiro)
          keyData.sort((a, b) => a.timestamp - b.timestamp);
          
          // Remove até ficar abaixo do limite
          const itemsToRemove = domainKeys.length - settings.maxItems;
          const keysToRemove = keyData.slice(0, itemsToRemove).map(item => item.key);
          
          keysToRemove.forEach(key => {
            this.cache.del(key);
            deletedItems++;
          });
          
          logger.info(`Cleaned up ${keysToRemove.length} cached items for domain ${domain}`, {
            domain,
            totalItems: domainKeys.length,
            removedItems: keysToRemove.length,
            maxItems: settings.maxItems
          });
        }
      });
      
      const duration = Date.now() - startTime;
      logger.info(`Cache cleanup completed`, {
        duration: `${duration}ms`,
        deletedItems,
        totalItems: keys.length
      });
    } catch (error) {
      logger.error('Error during cache cleanup', {}, error);
    }
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {any|null} - Cached value or null if not found
   */
  get(key) {
    if (!this.enabled || !key) return null;
    
    try {
      const value = this.cache.get(key);
      
      if (value !== undefined) {
        this.stats.hits++;
        return value;
      }
      
      this.stats.misses++;
      return null;
    } catch (error) {
      logger.warn('Error retrieving from cache', { key }, error);
      return null;
    }
  }

  /**
   * Set a value in cache with optional TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} [ttl] - Time to live in seconds (overrides default)
   * @returns {boolean} - Success or failure
   */
  set(key, value, ttl) {
    if (!this.enabled || !key) return false;
    
    try {
      // Extrai o domínio da chave para determinar o TTL
      const domain = this._extractDomainFromKey(key);
      const domainSettings = domain ? (this.domainSettings.get(domain) || this.defaultDomainSettings) : this.defaultDomainSettings;
      
      // Se cache para este domínio está desativado
      if (domainSettings && domainSettings.enabled === false) {
        return false;
      }
      
      // Usa TTL específico do domínio se não especificado
      const effectiveTtl = ttl || (domainSettings ? domainSettings.ttl : null);
      
      // Adiciona timestamp interno se não existir (para política de expiração)
      if (value && typeof value === 'object' && !value._cacheTimestamp) {
        value._cacheTimestamp = Date.now();
      }
      
      const success = this.cache.set(key, value, effectiveTtl);
      
      if (success) {
        this.stats.sets++;
      }
      
      return success;
    } catch (error) {
      logger.warn('Error storing in cache', { key }, error);
      return false;
    }
  }
  
  /**
   * Extrai o domínio da chave
   * @param {string} key - Chave do cache
   * @returns {string|null} - Domínio ou null
   * @private
   */
  _extractDomainFromKey(key) {
    if (!key) return null;
    
    const parts = key.split(':');
    return parts.length >= 2 ? parts[1] : null;
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   * @returns {boolean} - Success or failure
   */
  delete(key) {
    if (!this.enabled || !key) return false;
    
    try {
      const success = this.cache.del(key);
      
      if (success) {
        this.stats.deletes++;
      }
      
      return success;
    } catch (error) {
      logger.warn('Error deleting from cache', { key }, error);
      return false;
    }
  }

  /**
   * Check if a key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean} - True if key exists
   */
  has(key) {
    if (!this.enabled || !key) return false;
    return this.cache.has(key);
  }

  /**
   * Get all cached keys
   * @returns {string[]} - Array of cached keys
   */
  keys() {
    if (!this.enabled) return [];
    return this.cache.keys();
  }
  
  /**
   * Get keys for a specific domain
   * @param {string} domain - Domain to get keys for
   * @returns {string[]} - Array of cached keys for this domain
   */
  getDomainKeys(domain) {
    if (!this.enabled || !domain) return [];
    
    return this.cache.keys().filter(key => {
      const parts = key.split(':');
      return parts.length >= 2 && parts[1] === domain;
    });
  }
  
  /**
   * Flush cache for a specific domain
   * @param {string} domain - Domain to flush cache for
   * @returns {number} - Number of items deleted
   */
  flushDomain(domain) {
    if (!this.enabled || !domain) return 0;
    
    let deleted = 0;
    const keys = this.getDomainKeys(domain);
    
    keys.forEach(key => {
      if (this.cache.del(key)) {
        deleted++;
        this.stats.deletes++;
      }
    });
    
    logger.info(`Flushed cache for domain ${domain}`, { deleted, total: keys.length });
    return deleted;
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getStats() {
    const cacheStats = this.cache.getStats();
    const keyCount = this.cache.keys().length;
    
    // Conta itens por domínio
    const domainStats = {};
    this.cache.keys().forEach(key => {
      const domain = this._extractDomainFromKey(key);
      if (domain) {
        if (!domainStats[domain]) {
          domainStats[domain] = 0;
        }
        domainStats[domain]++;
      }
    });
    
    return {
      ...this.stats,
      keys: keyCount,
      domains: domainStats,
      vsize: cacheStats.vsize,
      ksize: cacheStats.ksize,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses || 1),
      memoryUsageKb: Math.round(cacheStats.vsize / 1024)
    };
  }

  /**
   * Flush all cached items
   */
  flush() {
    if (!this.enabled) return;
    
    const keyCount = this.cache.keys().length;
    this.cache.flushAll();
    this.stats.deletes += keyCount;
    
    logger.info('Cache flushed', { itemsDeleted: keyCount });
  }

  /**
   * Create a namespaced cache key
   * @param {string} namespace - Key namespace
   * @param {string} identifier - Key identifier (typically a URL)
   * @returns {string} - Combined cache key
   */
  createKey(namespace, identifier) {
    if (!namespace || !identifier) {
      return null;
    }
    
    try {
      // Extrai o domínio para incluir na chave
      let domain = '';
      try {
        const url = new URL(identifier);
        domain = url.hostname;
      } catch (e) {
        // Se não é uma URL válida, usa o identificador como está
        domain = identifier.replace(/[^a-zA-Z0-9]/g, '');
      }
      
      // Limpa o identificador para garantir compatibilidade
      let safeIdentifier = '';
      
      if (identifier.length > 100) {
        // Para identificadores longos, usamos um hash para evitar chaves muito grandes
        safeIdentifier = crypto.createHash('md5').update(identifier).digest('hex');
        this.stats.hashedKeys++;
      } else {
        // Remove non-alphanumeric characters from identifier
        safeIdentifier = String(identifier).replace(/[^a-zA-Z0-9]/g, '');
      }
      
      return `${namespace}:${domain}:${safeIdentifier}`;
    } catch (error) {
      logger.warn('Error creating cache key', { namespace, identifier }, error);
      return null;
    }
  }
}

// Export singleton
module.exports = new CacheService(); 