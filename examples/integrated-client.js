/**
 * Integrated Client Example
 * Demonstrates how to use the optimized services together
 */
const services = require('../src/services');
const { extractDomain } = require('../src/utils/shared');

/**
 * Scrape a website with full error handling, proxy rotation, and circuit breaker
 * @param {string} url - URL to scrape
 * @param {Object} options - Scraping options
 * @returns {Promise<Object>} - Scraped data
 */
async function scrapeWebsite(url, options = {}) {
  const domain = extractDomain(url);
  
  console.log(`Starting scrape of ${url}`);
  
  // Create context object for error classification
  const context = { 
    url,
    domain,
    ...options
  };
  
  return services.retry.withRetry(async (state) => {
    // If we should rotate proxy or first attempt
    if (state.rotateProxy || state.retryCount === 0) {
      // Get proxy for this domain, with binding if specified
      const proxyOptions = {
        bindToSite: options.bindDomainToProxy,
        country: options.preferredCountry,
        tags: options.proxyTags
      };
      
      // Create axios instance with proxy
      const axiosInstance = services.proxyRotation.createAxiosInstanceWithProxy(url, proxyOptions);
      
      // Update context with proxy information
      context.proxyId = axiosInstance.proxyId;
      context.userAgent = axiosInstance.defaults.headers['User-Agent'];
      
      console.log(`Using proxy for ${domain}${state.retryCount > 0 ? ' (rotated)' : ''}`);
      
      // Save the instance for use in the scraping process
      state.axios = axiosInstance;
    }
    
    // Handle captcha if solution exists
    if (state.captchaSolution) {
      console.log('Using solved captcha token');
      state.captchaToken = state.captchaSolution;
    }
    
    try {
      // Perform the request
      const response = await state.axios.get(url, {
        timeout: state.timeoutMultiplier ? 
          options.timeout * state.timeoutMultiplier : 
          options.timeout || 30000,
        headers: {
          // Add any custom headers
          ...options.headers,
          // Add captcha token if available
          ...(state.captchaToken ? {'X-Captcha-Token': state.captchaToken} : {})
        }
      });
      
      // Add response to context for potential error classification
      context.statusCode = response.status;
      context.headers = response.headers;
      context.html = response.data;
      
      // Check for captcha in the response
      if (typeof response.data === 'string' && 
          (response.data.includes('captcha') || response.data.includes('robot'))) {
        
        console.log('Detected captcha in the response');
        
        // Extract captcha information if possible
        const sitekey = extractRecaptchaSitekey(response.data);
        
        if (sitekey) {
          // Add captcha info to context for future retry
          context.captchaInfo = {
            type: 'recaptcha',
            sitekey,
            url
          };
          
          // Throw specialized error
          const error = new Error('Captcha detected');
          error.type = 'CAPTCHA';
          throw error;
        }
      }
      
      // Process the data - this would be replaced with actual scraping logic
      const result = processScrapedData(response.data, options);
      
      console.log(`Successfully scraped ${url}`);
      return result;
    } catch (error) {
      // Add error details to context
      if (error.response) {
        context.statusCode = error.response.status;
        context.headers = error.response.headers;
        context.html = error.response.data;
      }
      
      console.error(`Error scraping ${url}: ${error.message}`);
      
      // Let the retry service handle the error
      throw error;
    }
  }, {
    context,
    maxRetries: options.maxRetries || 3
  });
}

/**
 * Extract reCAPTCHA sitekey from HTML
 * @param {string} html - HTML content
 * @returns {string|null} - Extracted sitekey or null
 */
function extractRecaptchaSitekey(html) {
  if (!html) return null;
  
  // Common patterns for reCAPTCHA sitekey
  const patterns = [
    /data-sitekey="([^"]+)"/i,
    /sitekey=([^&"]+)/i,
    /'sitekey'\s*:\s*'([^']+)'/i,
    /"sitekey"\s*:\s*"([^"]+)"/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Process scraped data (placeholder)
 * @param {string} html - HTML content
 * @param {Object} options - Processing options
 * @returns {Object} - Processed data
 */
function processScrapedData(html, options) {
  // This would be replaced with actual data extraction logic
  return {
    title: html.match(/<title>([^<]+)<\/title>/i)?.[1] || 'No title',
    url: options.url,
    length: html.length,
    timestamp: new Date().toISOString()
  };
}

/**
 * Main function to demonstrate usage
 */
async function main() {
  try {
    // Initialize services if needed
    await services.initializeAll();
    
    // Example usage
    const result = await scrapeWebsite('https://example.com', {
      maxRetries: 5,
      bindDomainToProxy: true,
      timeout: 30000,
      headers: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    console.log('Scraped data:', result);
    
    // Cleanup services
    await services.cleanupAll();
  } catch (error) {
    console.error('Scraping failed:', error);
    
    // Get error statistics
    const errorStats = services.errorClassification.getErrorStats();
    console.log('Error statistics:', errorStats);
    
    // Get circuit breaker state
    const circuitBreakerStates = services.circuitBreaker.getAllCircuitBreakerStates();
    console.log('Circuit breaker states:', circuitBreakerStates);
    
    // Cleanup services
    await services.cleanupAll();
    process.exit(1);
  }
}

// Run the example if this script is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  scrapeWebsite
}; 