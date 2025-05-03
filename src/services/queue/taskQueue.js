/**
 * Task Queue Service
 * Manages concurrency for scraping operations
 */
const logger = require('../../utils/logger');
const config = require('../../config');
const EventEmitter = require('events');

class TaskQueue extends EventEmitter {
  constructor(concurrency = config.browser.maxConcurrency) {
    super();
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
    this.completed = 0;
    this.failed = 0;
    this.startTime = null;
    this.active = new Map(); // Track active tasks
    this.results = []; // Collect results
    
    // Listen for completion
    this.on('completed', this._onTaskCompleted.bind(this));
    this.on('failed', this._onTaskFailed.bind(this));
    this.on('empty', this._onQueueEmpty.bind(this));
    
    logger.info('Task queue initialized', { concurrency });
  }

  /**
   * Add a task to the queue
   * @param {Function} taskFn - Async function to execute
   * @param {Object} [context={}] - Optional context for the task
   * @returns {Promise<any>} - Promise that resolves to the task result
   */
  push(taskFn, context = {}) {
    return new Promise((resolve, reject) => {
      const task = {
        id: this._generateTaskId(),
        fn: taskFn,
        context,
        resolve,
        reject,
        addedAt: Date.now()
      };
      
      this.queue.push(task);
      
      if (!this.startTime) {
        this.startTime = Date.now();
      }
      
      // Attempt to run the next task
      this._next();
      
      logger.debug('Task added to queue', { 
        taskId: task.id, 
        queueLength: this.queue.length,
        running: this.running
      });
    });
  }

  /**
   * Execute next task in queue if concurrency allows
   * @private
   */
  _next() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }
    
    const task = this.queue.shift();
    this.running++;
    
    // Mark task as active
    task.startedAt = Date.now();
    this.active.set(task.id, task);
    
    const runTime = {
      queueTime: task.startedAt - task.addedAt,
      taskId: task.id
    };
    
    // Execute the task
    Promise.resolve()
      .then(() => task.fn(task.context))
      .then(result => {
        // Task completed successfully
        task.completedAt = Date.now();
        runTime.execTime = task.completedAt - task.startedAt;
        runTime.totalTime = task.completedAt - task.addedAt;
        
        // Store results
        const taskResult = {
          id: task.id,
          result,
          context: task.context,
          timing: {
            queueTime: runTime.queueTime,
            execTime: runTime.execTime,
            totalTime: runTime.totalTime
          },
          error: null
        };
        
        this.results.push(taskResult);
        
        // Resolve the task's promise
        task.resolve(result);
        
        // Emit completion event
        this.emit('completed', taskResult);
      })
      .catch(error => {
        // Task failed
        task.completedAt = Date.now();
        runTime.execTime = task.completedAt - task.startedAt;
        runTime.totalTime = task.completedAt - task.addedAt;
        
        const taskResult = {
          id: task.id,
          result: null,
          context: task.context,
          timing: {
            queueTime: runTime.queueTime,
            execTime: runTime.execTime,
            totalTime: runTime.totalTime
          },
          error
        };
        
        this.results.push(taskResult);
        
        // Reject the task's promise
        task.reject(error);
        
        // Emit failure event
        this.emit('failed', taskResult);
        
        logger.error('Task execution failed', {
          taskId: task.id,
          execTime: runTime.execTime,
          ...task.context
        }, error);
      })
      .finally(() => {
        // Remove from active tasks
        this.active.delete(task.id);
        
        // Decrement running count
        this.running--;
        
        // Process next task
        this._next();
        
        // Check if queue is empty
        if (this.running === 0 && this.queue.length === 0) {
          this.emit('empty');
        }
      });
  }

  /**
   * Handle task completion
   * @param {Object} taskResult - Result of completed task
   * @private
   */
  _onTaskCompleted(taskResult) {
    this.completed++;
    
    logger.debug('Task completed', { 
      taskId: taskResult.id,
      execTime: taskResult.timing.execTime,
      queueTime: taskResult.timing.queueTime,
      remaining: this.queue.length,
      running: this.running
    });
  }

  /**
   * Handle task failure
   * @param {Object} taskResult - Result of failed task
   * @private
   */
  _onTaskFailed(taskResult) {
    this.failed++;
    
    logger.warn('Task failed', { 
      taskId: taskResult.id,
      errorMessage: taskResult.error.message,
      remaining: this.queue.length,
      running: this.running
    });
  }

  /**
   * Handle queue becoming empty
   * @private
   */
  _onQueueEmpty() {
    const duration = Date.now() - this.startTime;
    
    logger.info('Task queue empty, all tasks completed', {
      completed: this.completed,
      failed: this.failed,
      total: this.completed + this.failed,
      durationMs: duration
    });
    
    this.emit('done', {
      completed: this.completed,
      failed: this.failed,
      total: this.completed + this.failed,
      duration,
      results: this.results
    });
    
    // Reset queue state
    this.results = [];
    this.completed = 0;
    this.failed = 0;
    this.startTime = null;
  }

  /**
   * Generate a unique task ID
   * @returns {string} - Unique task ID
   * @private
   */
  _generateTaskId() {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get current queue statistics
   * @returns {Object} - Queue statistics
   */
  getStats() {
    const now = Date.now();
    const duration = this.startTime ? now - this.startTime : 0;
    
    const activeTaskStats = Array.from(this.active.values()).map(task => ({
      id: task.id,
      runningTime: now - task.startedAt,
      context: task.context
    }));
    
    return {
      concurrency: this.concurrency,
      queued: this.queue.length,
      running: this.running,
      completed: this.completed,
      failed: this.failed,
      total: this.completed + this.failed + this.running + this.queue.length,
      duration,
      activeTasks: activeTaskStats
    };
  }

  /**
   * Run multiple tasks in parallel
   * @param {Array<Function>} taskFns - Array of task functions to execute
   * @param {Object} [sharedContext={}] - Context shared by all tasks
   * @returns {Promise<Array>} - Promise resolving to array of results
   */
  static async runAll(taskFns, sharedContext = {}) {
    if (!Array.isArray(taskFns) || taskFns.length === 0) {
      return [];
    }
    
    const queue = new TaskQueue();
    
    // Create a wrapper promise that resolves when all tasks are done
    return new Promise((resolve, reject) => {
      // Handle queue completion
      queue.once('done', (stats) => {
        resolve(stats.results.map(r => r.result));
      });
      
      // Push all tasks to the queue
      for (let i = 0; i < taskFns.length; i++) {
        const context = { 
          ...sharedContext, 
          index: i,
          total: taskFns.length
        };
        
        queue.push(taskFns[i], context);
      }
    });
  }
}

module.exports = TaskQueue; 