class ScraperWithRetry {
  constructor(scrapeFn) {
    this.maxRetries = 3;
    this.circuitState = {}; // Por domínio: CLOSED, HALF_OPEN, OPEN
    this.failureThreshold = 5;
    this.failureCount = {};
    this.lastFailureTime = {};
    this.resetTimeout = 60 * 1000; // 1 minuto
    this.scrape = scrapeFn; // Função de scraping real (ex: scrapePrice)
  }

  async scrapeWithRetry(url, options = {}) {
    const domain = new URL(url).hostname;
    if (!this.circuitState[domain]) this.circuitState[domain] = 'CLOSED';

    // Circuit breaker: OPEN
    if (this.circuitState[domain] === 'OPEN' && this.failureCount[domain] >= this.failureThreshold) {
      const timeSinceLastFailure = Date.now() - (this.lastFailureTime[domain] || 0);
      if (timeSinceLastFailure < this.resetTimeout) {
        console.log(`Circuit aberto para ${domain}, pulando scraping`);
        return { success: false, error: 'Circuit breaker open' };
      } else {
        this.circuitState[domain] = 'HALF_OPEN';
      }
    }

    let retries = 0;
    let lastError = null;

    while (retries <= this.maxRetries) {
      try {
        const result = await this.scrape(url, options);

        // Resetar contador em caso de sucesso
        if (this.circuitState[domain] === 'HALF_OPEN') {
          this.circuitState[domain] = 'CLOSED';
          this.failureCount[domain] = 0;
        }
        if (result && result.success) {
          this.failureCount[domain] = 0;
          return result;
        }
        throw new Error(result && result.error ? result.error : 'Scraping failed');
      } catch (error) {
        retries++;
        lastError = error;
        this.failureCount[domain] = (this.failureCount[domain] || 0) + 1;
        this.lastFailureTime[domain] = Date.now();

        if (this.failureCount[domain] >= this.failureThreshold) {
          this.circuitState[domain] = 'OPEN';
          console.log(`Circuit aberto para ${domain} após ${this.failureCount[domain]} falhas`);
          break;
        }

        // Espera exponencial entre tentativas
        const delay = Math.min(1000 * Math.pow(2, retries), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return { success: false, error: lastError?.message || 'Max retries exceeded' };
  }
}

module.exports = ScraperWithRetry;
