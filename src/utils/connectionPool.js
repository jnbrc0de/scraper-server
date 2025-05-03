/**
 * Connection Pool Manager
 * Manages a pool of browser instances for efficient reuse across scraping tasks
 */
const { chromium } = require('playwright');
const logger = require('./logger');
const performanceOptimizer = require('./performanceOptimizer');

class ConnectionPool {
  constructor(options = {}) {
    this.options = {
      maxConnections: options.maxConnections || 10,
      minConnections: options.minConnections || 1,
      idleTimeout: options.idleTimeout || 60000, // 1 minute
      maxUsageCount: options.maxUsageCount || 100, // Max uses before recycling
      maxLifetime: options.maxLifetime || 30 * 60 * 1000, // 30 minutes
      rotateUserAgents: options.rotateUserAgents !== false,
      ...options
    };
    
    // Pool of active browser instances
    this.pool = [];
    
    // Queue of pending connection requests
    this.queue = [];
    
    // Statistics
    this.stats = {
      created: 0,
      recycled: 0,
      errors: 0,
      queueMaxLength: 0,
      totalWaitTime: 0,
      totalRequests: 0,
      activeBorrowed: 0
    };
    
    // Start maintenance routine
    this._startMaintenance();
  }
  
  /**
   * Start the pool maintenance routine
   * @private
   */
  _startMaintenance() {
    this.maintenanceInterval = setInterval(() => {
      this._performMaintenance();
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Clean up idle connections and ensure minimum connections
   * @private
   */
  async _performMaintenance() {
    try {
      const now = Date.now();
      
      // Remove idle connections exceeding the timeout
      // Start from the end to avoid index issues when removing
      for (let i = this.pool.length - 1; i >= 0; i--) {
        const conn = this.pool[i];
        
        // Skip if connection is currently in use
        if (conn.inUse) continue;
        
        // Check if connection has been idle too long
        if (!conn.inUse && now - conn.lastUsed > this.options.idleTimeout) {
          // Only close if we have more than min connections
          if (this.pool.length > this.options.minConnections) {
            this.pool.splice(i, 1);
            
            // Clean up the browser
            try {
              await conn.browser.close();
              logger.debug('Closed idle browser connection', { id: conn.id });
            } catch (error) {
              logger.warn('Error closing idle browser', { id: conn.id }, error);
            }
          }
        }
        
        // Check if connection has been used too many times or lived too long
        if (conn.useCount > this.options.maxUsageCount || 
            now - conn.createdAt > this.options.maxLifetime) {
          // Mark for recycling - will be replaced when next requested
          conn.needsRecycling = true;
          logger.debug('Marked browser for recycling', { 
            id: conn.id, 
            useCount: conn.useCount,
            age: (now - conn.createdAt) / 1000
          });
        }
      }
      
      // Ensure we have the minimum number of connections
      if (this.pool.length < this.options.minConnections) {
        const needed = this.options.minConnections - this.pool.length;
        logger.debug(`Creating ${needed} connections to maintain minimum pool size`);
        
        for (let i = 0; i < needed; i++) {
          try {
            await this._createConnection();
          } catch (error) {
            logger.error('Error creating connection during maintenance', {}, error);
          }
        }
      }
      
      // Process any waiting requests in the queue
      if (this.queue.length > 0) {
        await this._processQueue();
      }
    } catch (error) {
      logger.error('Error during connection pool maintenance', {}, error);
    }
  }
  
  /**
   * Process the queue of connection requests
   * @private
   */
  async _processQueue() {
    // Process queue until empty or we run out of available connections
    while (this.queue.length > 0) {
      const availableConnection = this._getAvailableConnection();
      
      if (!availableConnection) {
        // Check if we can create a new connection
        if (this.pool.length < this.options.maxConnections) {
          try {
            const newConn = await this._createConnection();
            this._assignConnectionToNextInQueue(newConn);
          } catch (error) {
            logger.error('Error creating connection for queue', {}, error);
          }
        } else {
          // No more connections available and at max capacity
          break;
        }
      } else {
        this._assignConnectionToNextInQueue(availableConnection);
      }
    }
  }
  
  /**
   * Assign a connection to the next request in the queue
   * @param {Object} connection - The connection to assign
   * @private
   */
  _assignConnectionToNextInQueue(connection) {
    if (this.queue.length === 0 || !connection) return;
    
    const request = this.queue.shift();
    
    // Mark as in use
    connection.inUse = true;
    connection.useCount++;
    connection.lastUsed = Date.now();
    this.stats.activeBorrowed++;
    
    // Calculate wait time
    const waitTime = Date.now() - request.queuedAt;
    this.stats.totalWaitTime += waitTime;
    
    logger.debug('Assigned connection from queue', { 
      id: connection.id, 
      queueLength: this.queue.length,
      waitTime
    });
    
    // Resolve the promise with the connection
    request.resolve(connection);
  }
  
  /**
   * Find an available connection in the pool
   * @returns {Object|null} - Available connection or null
   * @private
   */
  _getAvailableConnection() {
    // First check for any available connections that don't need recycling
    const availableConn = this.pool.find(conn => !conn.inUse && !conn.needsRecycling);
    
    if (availableConn) {
      return availableConn;
    }
    
    // If none found, then even consider those that need recycling
    return this.pool.find(conn => !conn.inUse);
  }
  
  /**
   * Create a new browser connection
   * @returns {Promise<Object>} - New connection
   * @private
   */
  async _createConnection() {
    const id = `conn-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    logger.debug('Creating new browser connection', { id });
    
    try {
      // Launch browser
      const browser = await chromium.launch({
        headless: true,
        ...this.options.launchOptions
      });
      
      // Create connection object
      const connection = {
        id,
        browser,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        inUse: false,
        useCount: 0,
        needsRecycling: false
      };
      
      // Add to pool
      this.pool.push(connection);
      this.stats.created++;
      
      // Track connection for metrics
      performanceOptimizer.updateConnectionCount(1);
      
      return connection;
    } catch (error) {
      this.stats.errors++;
      logger.error('Error creating browser connection', { id }, error);
      throw error;
    }
  }
  
  /**
   * Get a connection from the pool
   * @returns {Promise<Object>} - Browser connection
   */
  async getConnection() {
    this.stats.totalRequests++;
    
    // Check if there's an available connection
    const availableConn = this._getAvailableConnection();
    
    if (availableConn) {
      // If connection needs recycling, create a new one instead
      if (availableConn.needsRecycling) {
        // Remove from pool
        this.pool = this.pool.filter(conn => conn.id !== availableConn.id);
        
        // Close browser
        try {
          await availableConn.browser.close();
        } catch (error) {
          logger.warn('Error closing recycled browser', { id: availableConn.id }, error);
        }
        
        this.stats.recycled++;
        performanceOptimizer.updateConnectionCount(-1);
        
        // Create a new connection
        return this._createConnection();
      }
      
      // Mark as in use
      availableConn.inUse = true;
      availableConn.useCount++;
      availableConn.lastUsed = Date.now();
      this.stats.activeBorrowed++;
      
      return availableConn;
    }
    
    // Check if we can create a new connection
    if (this.pool.length < this.options.maxConnections) {
      return this._createConnection();
    }
    
    // Need to queue the request
    return new Promise((resolve, reject) => {
      const queuedRequest = {
        resolve,
        reject,
        queuedAt: Date.now()
      };
      
      this.queue.push(queuedRequest);
      
      // Update max queue length stat
      if (this.queue.length > this.stats.queueMaxLength) {
        this.stats.queueMaxLength = this.queue.length;
      }
      
      // Process the queue
      this._processQueue();
      
      // Set timeout for the request
      if (this.options.queueTimeout) {
        setTimeout(() => {
          // Remove from queue if still there
          const index = this.queue.indexOf(queuedRequest);
          if (index !== -1) {
            this.queue.splice(index, 1);
            reject(new Error('Connection request timed out in queue'));
          }
        }, this.options.queueTimeout);
      }
    });
  }
  
  /**
   * Release a connection back to the pool
   * @param {Object} connection - Connection to release
   */
  releaseConnection(connection) {
    // Find connection in pool
    const poolConn = this.pool.find(conn => conn.id === connection.id);
    
    if (!poolConn) {
      logger.warn('Attempted to release unknown connection', { id: connection.id });
      return;
    }
    
    // Update state
    poolConn.inUse = false;
    poolConn.lastUsed = Date.now();
    this.stats.activeBorrowed--;
    
    logger.debug('Released connection back to pool', { 
      id: connection.id,
      useCount: poolConn.useCount,
      queueLength: this.queue.length
    });
    
    // Check if there are waiting requests
    if (this.queue.length > 0) {
      // If this connection needs recycling, don't reuse it for queue
      if (!poolConn.needsRecycling) {
        this._assignConnectionToNextInQueue(poolConn);
      } else {
        // Process queue to create new connection if needed
        this._processQueue();
      }
    }
  }
  
  /**
   * Get current pool statistics
   * @returns {Object} - Pool stats
   */
  getStats() {
    return {
      ...this.stats,
      poolSize: this.pool.length,
      availableConnections: this.pool.filter(conn => !conn.inUse).length,
      needsRecycling: this.pool.filter(conn => conn.needsRecycling).length,
      queueLength: this.queue.length,
      averageWaitTime: this.stats.totalRequests > 0 
        ? this.stats.totalWaitTime / this.stats.totalRequests 
        : 0
    };
  }
  
  /**
   * Clean up all connections and resources
   */
  async shutdown() {
    logger.info('Shutting down connection pool', { poolSize: this.pool.length });
    
    // Clear maintenance interval
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
    }
    
    // Close all browser instances
    const closePromises = this.pool.map(async conn => {
      try {
        await conn.browser.close();
        performanceOptimizer.updateConnectionCount(-1);
      } catch (error) {
        logger.warn('Error closing browser during shutdown', { id: conn.id }, error);
      }
    });
    
    // Wait for all to close
    await Promise.all(closePromises);
    
    // Clear pool
    this.pool = [];
    
    // Reject any queued requests
    this.queue.forEach(request => {
      request.reject(new Error('Connection pool is shutting down'));
    });
    this.queue = [];
    
    logger.info('Connection pool shut down successfully');
  }
}

module.exports = ConnectionPool; 