/**
 * Abstract Adapter Class
 * Defines the interface for all marketplace adapters
 */
class AbstractAdapter {
  /**
   * @param {string} domainName - Domain name this adapter handles
   */
  constructor(domainName) {
    this.domainName = domainName;
    
    if (this.constructor === AbstractAdapter) {
      throw new Error('Cannot instantiate abstract class');
    }
  }

  /**
   * Check if this adapter can handle a given URL
   * @param {string} url - URL to check
   * @returns {boolean} - True if this adapter can handle the URL
   */
  canHandle(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes(this.domainName);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get product data from a page
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<Object>} - Extracted product data
   */
  async extract(page) {
    throw new Error('Method extract() must be implemented');
  }

  /**
   * Extract price from HTML string
   * @param {string} html - HTML content
   * @returns {Promise<number|null>} - Extracted price or null
   */
  async extractPriceFromHTML(html) {
    throw new Error('Method extractPriceFromHTML() must be implemented');
  }

  /**
   * Extract product title from a page
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<string|null>} - Extracted title or null
   */
  async extractTitle(page) {
    throw new Error('Method extractTitle() must be implemented');
  }

  /**
   * Extract product availability from a page
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<boolean|null>} - True if available, false if not, null if unknown
   */
  async extractAvailability(page) {
    throw new Error('Method extractAvailability() must be implemented');
  }

  /**
   * Extract additional product information from a page
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<Object|null>} - Additional product information or null
   */
  async extractProductInfo(page) {
    // Optional method, default implementation returns empty object
    return {};
  }

  /**
   * Extract schema.org or JSON-LD structured data from a page
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<Object|null>} - Structured data or null
   */
  async extractStructuredData(page) {
    try {
      return await page.evaluate(() => {
        const results = {};
        
        // Extract JSON-LD data
        const jsonLdElements = document.querySelectorAll('script[type="application/ld+json"]');
        if (jsonLdElements.length > 0) {
          results.jsonLd = Array.from(jsonLdElements).map(el => {
            try {
              return JSON.parse(el.textContent);
            } catch (e) {
              return null;
            }
          }).filter(Boolean);
        }
        
        // Extract microdata
        const microDataElements = document.querySelectorAll('[itemscope]');
        if (microDataElements.length > 0) {
          results.microdata = Array.from(microDataElements).map(el => {
            const type = el.getAttribute('itemtype');
            const props = {};
            const itemProps = el.querySelectorAll('[itemprop]');
            
            Array.from(itemProps).forEach(prop => {
              const name = prop.getAttribute('itemprop');
              let value;
              
              if (prop.hasAttribute('content')) {
                value = prop.getAttribute('content');
              } else if (prop.tagName === 'META') {
                value = prop.getAttribute('content');
              } else if (prop.tagName === 'IMG') {
                value = prop.getAttribute('src');
              } else if (prop.tagName === 'A') {
                value = prop.getAttribute('href');
              } else if (prop.tagName === 'TIME') {
                value = prop.getAttribute('datetime');
              } else {
                value = prop.textContent.trim();
              }
              
              props[name] = value;
            });
            
            return { type, props };
          });
        }
        
        return Object.keys(results).length > 0 ? results : null;
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Handle any site-specific pre-processing before extraction
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<void>}
   */
  async preProcess(page) {
    // Optional method, default implementation does nothing
  }

  /**
   * Handle site-specific blocks or restrictions
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<boolean>} - True if blocked, false otherwise
   */
  async isBlocked(page) {
    // Default implementation checks for common block indicators
    try {
      return await page.evaluate(() => {
        const blockIndicators = [
          document.body.innerText.toLowerCase().includes('access denied'),
          document.body.innerText.toLowerCase().includes('blocked'),
          document.body.innerText.toLowerCase().includes('suspicious activity'),
          document.body.innerText.toLowerCase().includes('unusual traffic'),
          document.body.innerText.toLowerCase().includes('security check'),
          document.body.innerText.toLowerCase().includes('ip address has been blocked'),
          document.title.toLowerCase().includes('access denied'),
          document.title.toLowerCase().includes('blocked'),
          window.location.href.includes('blocked'),
          window.location.href.includes('denied'),
          window.location.href.includes('captcha')
        ];

        return blockIndicators.some(indicator => indicator === true);
      });
    } catch (error) {
      return false;
    }
  }
}

module.exports = AbstractAdapter; 