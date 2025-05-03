/**
 * Performance Benchmark Script
 * 
 * Measures and compares the performance of the scraper with different optimization settings.
 * Run this script to see the impact of the various performance optimization features.
 */

const ProductScraperAdapter = require('../adapters/scraper/productScraperAdapter');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Sample product URLs to test with
const sampleUrls = [
  'https://www.amazon.com/dp/B07ZPKN6YR',
  'https://www.bestbuy.com/site/samsung-galaxy-s23-128gb-unlocked-phantom-black/6529758.p',
  'https://www.walmart.com/ip/SAMSUNG-65-Class-4K-Crystal-UHD-2160P-LED-Smart-TV-with-HDR-UN65TU7000/195337031'
];

// Test configurations
const testConfigurations = [
  {
    name: 'Baseline (No Optimizations)',
    options: {
      optimizeRequests: false,
      blockMedia: false,
      blockNonEssentialImages: false,
      useDomSnapshot: false,
      disableJavaScript: false,
      useConnectionPool: false
    }
  },
  {
    name: 'Request Optimization Only',
    options: {
      optimizeRequests: true,
      blockMedia: true,
      blockNonEssentialImages: true,
      useDomSnapshot: false,
      disableJavaScript: false,
      useConnectionPool: false
    }
  },
  {
    name: 'JavaScript Optimization Only',
    options: {
      optimizeRequests: false,
      blockMedia: false,
      blockNonEssentialImages: false,
      useDomSnapshot: false,
      disableJavaScript: true,
      useConnectionPool: false
    }
  },
  {
    name: 'Connection Pool Only',
    options: {
      optimizeRequests: false,
      blockMedia: false,
      blockNonEssentialImages: false,
      useDomSnapshot: false,
      disableJavaScript: false,
      useConnectionPool: true
    }
  },
  {
    name: 'DOM Snapshot Only',
    options: {
      optimizeRequests: false,
      blockMedia: false,
      blockNonEssentialImages: false,
      useDomSnapshot: true,
      disableJavaScript: false,
      useConnectionPool: false
    }
  },
  {
    name: 'Full Optimization',
    options: {
      optimizeRequests: true,
      blockMedia: true,
      blockNonEssentialImages: true,
      useDomSnapshot: true,
      disableJavaScript: true,
      useConnectionPool: true
    }
  }
];

/**
 * Run a benchmark test for a specific configuration
 * @param {Object} config - Test configuration
 * @param {Array<string>} urls - URLs to test with
 * @returns {Promise<Object>} - Test results
 */
async function runBenchmark(config, urls) {
  logger.info(`Running benchmark: ${config.name}`, config.options);
  
  const startTime = Date.now();
  const results = [];
  
  // Create scraper with configuration
  const scraper = new ProductScraperAdapter({
    ...config.options,
    humanEmulation: false, // Disable for deterministic benchmarking
    timeout: 60000 // Longer timeout for reliability
  });
  
  try {
    // Test sequential scraping
    const sequentialStart = Date.now();
    for (const url of urls) {
      try {
        const result = await scraper.scrapeProduct(url, {
          selectors: {
            title: '.product-title, h1, .name, [data-testid="product-title"]',
            price: '.price, .product-price, [data-testid="price"]',
            rating: '.rating, .stars, [data-testid="rating"]'
          }
        });
        
        results.push({
          url,
          success: true,
          data: result,
          time: Date.now() - sequentialStart
        });
      } catch (error) {
        results.push({
          url,
          success: false,
          error: error.message,
          time: Date.now() - sequentialStart
        });
      }
    }
    
    // Test parallel scraping
    const parallelStart = Date.now();
    const parallelResults = await Promise.all(urls.map(url => 
      scraper.scrapeProduct(url, {
        selectors: {
          title: '.product-title, h1, .name, [data-testid="product-title"]',
          price: '.price, .product-price, [data-testid="price"]',
          rating: '.rating, .stars, [data-testid="rating"]'
        }
      }).catch(error => ({
        url,
        success: false,
        error: error.message
      }))
    ));
    
    const parallelTime = Date.now() - parallelStart;
    
    // Get scraper metrics
    const metrics = scraper.getMetrics();
    
    // Close scraper
    await scraper.close();
    
    // Calculate results
    const totalTime = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    
    return {
      configName: config.name,
      options: config.options,
      totalTime,
      sequentialTime: results.length > 0 ? results[results.length - 1].time : 0,
      parallelTime,
      successRate: (successCount / urls.length) * 100,
      metrics,
      urlResults: results.map(r => ({
        url: r.url,
        success: r.success,
        time: r.time,
        hasData: r.success && r.data && r.data.product && r.data.product.title ? true : false
      }))
    };
  } catch (error) {
    logger.error(`Benchmark error for ${config.name}`, {}, error);
    await scraper.close();
    
    return {
      configName: config.name,
      error: error.message,
      totalTime: Date.now() - startTime,
      successRate: 0
    };
  }
}

/**
 * Format benchmark results as a markdown table
 * @param {Array<Object>} results - Benchmark results
 * @returns {string} - Markdown formatted results
 */
function formatResults(results) {
  // Create header
  let markdown = '# Scraper Performance Benchmark Results\n\n';
  markdown += 'Date: ' + new Date().toISOString() + '\n\n';
  
  // Create summary table
  markdown += '## Summary\n\n';
  markdown += '| Configuration | Total Time (ms) | Sequential (ms) | Parallel (ms) | Success Rate | Memory (MB) |\n';
  markdown += '|---------------|----------------|----------------|--------------|-------------|------------|\n';
  
  for (const result of results) {
    const memoryUsage = result.metrics && result.metrics.optimizerStats ? 
      (result.metrics.optimizerStats.memoryUsageHistory.slice(-1)[0]?.value || 0) * 100 : 'N/A';
    
    markdown += `| ${result.configName} | ${result.totalTime} | ${result.sequentialTime} | ${result.parallelTime} | ${result.successRate.toFixed(1)}% | ${typeof memoryUsage === 'number' ? memoryUsage.toFixed(1) : memoryUsage} |\n`;
  }
  
  // Add performance comparison
  const baseline = results.find(r => r.configName === 'Baseline (No Optimizations)');
  const optimized = results.find(r => r.configName === 'Full Optimization');
  
  if (baseline && optimized) {
    const speedupParallel = baseline.parallelTime / optimized.parallelTime;
    const speedupSequential = baseline.sequentialTime / optimized.sequentialTime;
    
    markdown += '\n## Performance Improvement\n\n';
    markdown += `- Sequential: ${speedupSequential.toFixed(2)}x faster with full optimization\n`;
    markdown += `- Parallel: ${speedupParallel.toFixed(2)}x faster with full optimization\n`;
  }
  
  // Add detailed results
  markdown += '\n## Detailed Results\n\n';
  
  for (const result of results) {
    markdown += `### ${result.configName}\n\n`;
    
    if (result.error) {
      markdown += `Error: ${result.error}\n\n`;
      continue;
    }
    
    // URL results
    markdown += '| URL | Success | Time (ms) | Data Retrieved |\n';
    markdown += '|-----|---------|-----------|---------------|\n';
    
    for (const urlResult of result.urlResults) {
      markdown += `| ${urlResult.url} | ${urlResult.success ? '✓' : '✗'} | ${urlResult.time} | ${urlResult.hasData ? '✓' : '✗'} |\n`;
    }
    
    // Metrics
    if (result.metrics) {
      markdown += '\n**Performance Metrics:**\n\n';
      markdown += `- Average Navigation Time: ${result.metrics.averageNavigationTime?.toFixed(0) || 'N/A'} ms\n`;
      markdown += `- Average Extraction Time: ${result.metrics.averageExtractionTime?.toFixed(0) || 'N/A'} ms\n`;
      
      if (result.metrics.poolStats) {
        markdown += `- Connection Pool Size: ${result.metrics.poolStats.poolSize}\n`;
        markdown += `- Connections Created: ${result.metrics.poolStats.created}\n`;
        markdown += `- Connections Recycled: ${result.metrics.poolStats.recycled}\n`;
      }
    }
    
    markdown += '\n';
  }
  
  return markdown;
}

/**
 * Run all benchmark tests
 */
async function runAllBenchmarks() {
  logger.info('Starting performance benchmarks');
  
  const results = [];
  
  for (const config of testConfigurations) {
    // Run each benchmark
    const result = await runBenchmark(config, sampleUrls);
    results.push(result);
    
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Format and save results
  const markdown = formatResults(results);
  const outputDir = path.join(__dirname, '../../benchmark-results');
  
  try {
    await fs.mkdir(outputDir, { recursive: true });
    const filename = `benchmark-${new Date().toISOString().replace(/:/g, '-')}.md`;
    await fs.writeFile(path.join(outputDir, filename), markdown);
    logger.info(`Benchmark results saved to ${filename}`);
    
    // Save raw data for additional analysis
    await fs.writeFile(
      path.join(outputDir, 'raw-' + filename.replace('.md', '.json')), 
      JSON.stringify(results, null, 2)
    );
  } catch (error) {
    logger.error('Error saving benchmark results', {}, error);
  }
  
  // Log summary
  console.log('\nBenchmark Summary:');
  for (const result of results) {
    console.log(`${result.configName}: ${result.totalTime}ms, Success Rate: ${result.successRate.toFixed(1)}%`);
  }
}

// Run the benchmarks
if (require.main === module) {
  runAllBenchmarks().catch(error => {
    logger.error('Benchmark failed', {}, error);
    process.exit(1);
  });
}

module.exports = { runBenchmark, formatResults, runAllBenchmarks }; 