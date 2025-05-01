class RenderOptimizer {
  constructor() {
    this.memoryLimit = 450 * 1024 * 1024; // ~450MB (limite do plano free)
    this.browserPool = null;
    this.isMemoryCleanupActive = false;
  }

  // Opções otimizadas para Render Free
  getBrowserLaunchOptions() {
    return {
      args: [
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-features=site-per-process',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ],
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      ignoreDefaultArgs: ['--enable-automation']
    };
  }

  // Monitorar uso de memória
  startMemoryMonitoring() {
    if (this.isMemoryCleanupActive) return;
    this.isMemoryCleanupActive = true;
    setInterval(() => this.checkMemoryUsage(), 60000);
  }

  async checkMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    console.log(`Uso de memória: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB`);
    if (memoryUsage.rss > this.memoryLimit * 0.8) {
      console.log('Memória próxima do limite, forçando limpeza...');
      if (this.browserPool && typeof this.browserPool.closeAll === 'function') {
        await this.browserPool.closeAll();
      }
      if (global.gc) {
        global.gc();
      }
    }
  }

  // Pool de browsers (apenas 1 browser por vez no Render Free)
  setupBrowserPool(maxConcurrent = 1) {
    // Exemplo de pool simples
    this.browserPool = {
      active: 0,
      queue: [],
      async acquire(createBrowserFn) {
        if (this.active < maxConcurrent) {
          this.active++;
          return await createBrowserFn();
        }
        return new Promise(resolve => {
          this.queue.push(async () => {
            this.active++;
            resolve(await createBrowserFn());
          });
        });
      },
      async release() {
        this.active--;
        if (this.queue.length > 0) {
          const next = this.queue.shift();
          next();
        }
      },
      async closeAll() {
        // Implemente lógica para fechar browsers se necessário
      }
    };
    return this.browserPool;
  }
}

module.exports = RenderOptimizer;
