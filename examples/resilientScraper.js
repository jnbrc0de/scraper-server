/**
 * Example script demonstrating advanced error handling and resilience features
 */
const ProductScraperAdapter = require('../src/adapters/scraper/productScraperAdapter');
const retryService = require('../src/services/retry/retryService');
const errorHandler = require('../src/utils/errorHandler');
const logger = require('../src/utils/logger');

// Sample URLs to demonstrate different error scenarios
const productUrls = [
  'https://example.com/product/123', // Standard product
  'https://example.com/product/404', // Will return 404 error
  'https://example.com/product/slow', // Will timeout
  'https://example.com/product/captcha', // Will trigger captcha
  'https://example.com/product/blocked' // Will get blocked 
];

// Progress tracking
function displayProgress(stats) {
  console.log('---------------------------------------------------');
  console.log(`Error Rate: ${(stats.errorRate * 100).toFixed(2)}%`);
  console.log(`Backpressure Level: ${stats.backpressureLevel} (${stats.backpressureDelay}ms delay)`);
  console.log(`Sessions Stored: ${stats.sessionStats.totalSessions}`);
  console.log('---------------------------------------------------');
}

// Main function
async function runResilientScraper() {
  logger.info('Starting resilient scraper example');
  
  const scraper = new ProductScraperAdapter({
    maxRetries: 3,
    timeout: 30000
  });
  
  try {
    // Display current error handling stats
    const initialStats = retryService.getErrorStats();
    displayProgress(initialStats);
    
    // Scrape multiple products with resilience
    const results = await scraper.scrapeMultipleProducts(productUrls, {
      concurrency: 2,
      delayBetweenRequests: 2000,
      abortOnError: false
    });
    
    // Log results
    logger.info('Scraping completed', {
      total: results.total,
      successful: results.successful,
      failed: results.failed
    });
    
    console.log('\n--- Successful Products ---');
    results.products.forEach((product, index) => {
      console.log(`\nProduct ${index + 1}: ${product.url}`);
      console.log(`Title: ${product.product.title}`);
      console.log(`Price: ${product.product.price}`);
      // Display only first 100 chars of description
      if (product.product.description) {
        console.log(`Description: ${product.product.description.substring(0, 100)}...`);
      }
    });
    
    console.log('\n--- Failed URLs ---');
    results.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error.url} - ${error.error}`);
    });
    
    // Display final error stats
    const finalStats = retryService.getErrorStats();
    displayProgress(finalStats);
    
  } catch (error) {
    logger.error('Error in resilient scraper example', {}, error);
  } finally {
    // Clean up resources
    await scraper.close().catch(() => {});
  }
}

// Simulate different error types for demonstration
function setupErrorSimulation() {
  // Override the fetch function to simulate different errors
  const originalFetch = global.fetch;
  global.fetch = function(url, options) {
    // Simulate various error scenarios based on URL
    if (url.includes('/404')) {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('Not Found')
      });
    } else if (url.includes('/slow')) {
      // Simulate timeout
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(originalFetch(url, options));
        }, 60000); // Very long delay to trigger timeout
      });
    } else if (url.includes('/captcha')) {
      return Promise.resolve({
        ok: false,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('<html><body><div>Please solve this captcha</div><div class="g-recaptcha"></div></body></html>')
      });
    } else if (url.includes('/blocked')) {
      return Promise.resolve({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve('Access Denied - Your IP address has been blocked')
      });
    }
    
    // For other URLs, use the real fetch
    return originalFetch(url, options);
  };
}

// Only run if directly called (not imported)
if (require.main === module) {
  // Set up error simulation
  setupErrorSimulation();
  
  // Run the example
  runResilientScraper()
    .then(() => {
      console.log('Example completed.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Example failed:', error);
      process.exit(1);
    });
}

module.exports = { runResilientScraper }; 