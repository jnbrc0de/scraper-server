/**
 * Via Varejo Adapter
 * Handles extraction from Via Varejo sites (Casas Bahia, Ponto Frio, Extra)
 */
const AbstractAdapter = require('./AbstractAdapter');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class ViaVarejoAdapter extends AbstractAdapter {
  constructor() {
    // Parent class requires domain name
    super('viavarejo');
    
    // List of domains this adapter can handle
    this.domains = [
      'casasbahia.com.br',
      'pontofrio.com.br',
      'extra.com.br'
    ];
    
    // CSS selectors for product data extraction
    this.selectors = {
      price: [
        '[itemprop="price"]',
        '.product-price-value', 
        '.valPrecoAtual', 
        '.product__price-value',
        '[data-testid="product-price-value"]',
        '.productPage__price-value',
        '.product-price__Price-sc-h6x8zi-1',
        '.price__Price'
      ],
      title: [
        '[itemprop="name"]',
        '.product-name',
        '.product__title',
        '.productName',
        'h1.name'
      ],
      availability: [
        '[itemprop="availability"]',
        '.buybox__buybutton-wrapper',
        '.product__quantity'
      ],
      outOfStock: [
        '.product-unavailable',
        '.unavailable',
        '.product-unavailable-buy-box'
      ]
    };
  }

  /**
   * Check if this adapter can handle a given URL
   * @param {string} url - URL to check
   * @returns {boolean} - True if this adapter can handle the URL
   */
  canHandle(url) {
    try {
      const urlObj = new URL(url);
      return this.domains.some(domain => urlObj.hostname.includes(domain));
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract all product data from a page
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<Object>} - Extracted product data
   */
  async extract(page) {
    // First handle any preprocessing needed for this site
    await this.preProcess(page);
    
    // Check if we're blocked
    const blocked = await this.isBlocked(page);
    if (blocked) {
      logger.warn('Via Varejo page appears to be blocked', { url: page.url() });
      throw new Error('Access blocked by Via Varejo site');
    }
    
    try {
      // Extra wait for price to be visible
      await page.waitForTimeout(2000);
      
      // Get structured data
      const structuredData = await this.extractStructuredData(page);
      
      // Extract main data
      const price = await this.extractPrice(page);
      const title = await this.extractTitle(page);
      const availability = await this.extractAvailability(page);
      const productInfo = await this.extractProductInfo(page);
      
      // Build result
      return {
        price,
        title,
        availability,
        ...productInfo,
        structuredData,
        url: page.url()
      };
    } catch (error) {
      logger.error('Error extracting data from Via Varejo page', {
        url: page.url(),
        domain: this._extractDomain(page.url())
      }, error);
      
      throw new Error(`Extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract price from page
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<number|null>} - Extracted price or null
   */
  async extractPrice(page) {
    // First try JSON-LD
    try {
      const priceFromJsonLd = await page.evaluate(() => {
        const jsonLdElement = document.querySelector('script[type="application/ld+json"]');
        if (jsonLdElement) {
          try {
            const data = JSON.parse(jsonLdElement.textContent);
            if (data.offers && data.offers.price) return data.offers.price;
            if (data.offers && data.offers[0] && data.offers[0].price) return data.offers[0].price;
          } catch (e) {}
        }
        return null;
      });

      if (priceFromJsonLd) {
        return this._normalizePrice(priceFromJsonLd);
      }
    } catch (e) {
      logger.debug('Error extracting JSON-LD price', {}, e);
    }

    // Try CSS selectors
    for (const selector of this.selectors.price) {
      try {
        const element = await page.$(selector);
        if (element) {
          const priceText = await element.textContent();
          if (priceText && priceText.trim()) {
            const price = this._normalizePrice(priceText);
            if (price) return price;
          }
        }
      } catch (e) {
        logger.debug(`Error with price selector ${selector}`, {}, e);
      }
    }

    // Try global variables in page's JavaScript
    try {
      const jsPrice = await page.evaluate(() => {
        if (window.skuJson && window.skuJson.skus && window.skuJson.skus[0]) {
          return window.skuJson.skus[0].bestPrice;
        }
        if (window.__APOLLO_STATE__ && 
            Object.values(window.__APOLLO_STATE__).some(v => v && v.price)) {
          const priceObj = Object.values(window.__APOLLO_STATE__).find(v => v && v.price);
          return priceObj.price;
        }
        return null;
      });

      if (jsPrice) {
        return this._normalizePrice(jsPrice);
      }
    } catch (e) {
      logger.debug('Error extracting JS variable price', {}, e);
    }

    // Last resort: regex on HTML
    try {
      const html = await page.content();
      return await this.extractPriceFromHTML(html);
    } catch (e) {
      logger.debug('Error with regex HTML price extraction', {}, e);
    }

    return null;
  }

  /**
   * Extract price from raw HTML
   * @param {string} html - HTML content
   * @returns {Promise<number|null>} - Extracted price or null
   */
  async extractPriceFromHTML(html) {
    try {
      // First try with Cheerio for CSS selectors
      const $ = cheerio.load(html);
      
      // Try each price selector
      for (const selector of this.selectors.price) {
        const priceElement = $(selector).first();
        if (priceElement.length) {
          const priceText = priceElement.text().trim();
          if (priceText) {
            const price = this._normalizePrice(priceText);
            if (price) return price;
          }
        }
      }
      
      // Try to find JSON-LD
      const jsonLD = $('script[type="application/ld+json"]');
      if (jsonLD.length) {
        try {
          const data = JSON.parse(jsonLD.html());
          if (data.offers && data.offers.price) {
            return this._normalizePrice(data.offers.price);
          }
          if (data.offers && data.offers[0] && data.offers[0].price) {
            return this._normalizePrice(data.offers[0].price);
          }
        } catch (e) {}
      }
      
      // Last resort: regex for price patterns in HTML
      const patterns = [
        /"price"\s*:\s*(\d+\.\d+)/,
        /"productPrice"\s*:\s*(\d+\.\d+)/,
        /valor\s*:\s*['"](R?\$?\s*\d+[,.]\d+)/,
        /priceValue\s*[:=]\s*['"]?(R?\$?\s*\d+[,.]\d+)/,
        /R\$ (\d+[\.,]\d+)/,
        /R\$(\d+[\.,]\d+)/
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          return this._normalizePrice(match[1]);
        }
      }
    } catch (error) {
      logger.error('Error extracting price from HTML', {}, error);
    }
    
    return null;
  }

  /**
   * Extract product title from page
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<string|null>} - Extracted title or null
   */
  async extractTitle(page) {
    // First try meta tags
    try {
      const metaTitle = await page.evaluate(() => {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) return ogTitle.getAttribute('content');
        
        const metaTitle = document.querySelector('meta[name="title"]');
        if (metaTitle) return metaTitle.getAttribute('content');
        
        return null;
      });
      
      if (metaTitle) return metaTitle.trim();
    } catch (e) {
      logger.debug('Error extracting meta title', {}, e);
    }
    
    // Try CSS selectors
    for (const selector of this.selectors.title) {
      try {
        const element = await page.$(selector);
        if (element) {
          const titleText = await element.textContent();
          if (titleText && titleText.trim()) {
            return titleText.trim();
          }
        }
      } catch (e) {
        logger.debug(`Error with title selector ${selector}`, {}, e);
      }
    }
    
    // Fallback to page title
    try {
      const pageTitle = await page.title();
      if (pageTitle) {
        // Clean up site name from title
        const siteName = this._extractDomain(page.url()).split('.')[0];
        return pageTitle.replace(new RegExp(`[-|]\\s*${siteName}.*$`, 'i'), '').trim();
      }
    } catch (e) {
      logger.debug('Error extracting page title', {}, e);
    }
    
    return null;
  }

  /**
   * Extract product availability from page
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<boolean|null>} - True if available, false if not, null if unknown
   */
  async extractAvailability(page) {
    // First check if out of stock indicators are present
    for (const selector of this.selectors.outOfStock) {
      try {
        const element = await page.$(selector);
        if (element) {
          // Found an out of stock indicator
          return false;
        }
      } catch (e) {}
    }
    
    // Try with availability selectors
    for (const selector of this.selectors.availability) {
      try {
        const element = await page.$(selector);
        if (element) {
          // Check for text content that might indicate availability
          const text = await element.textContent();
          if (text) {
            // Check for negative indicators
            if (
              text.toLowerCase().includes('indisponível') || 
              text.toLowerCase().includes('esgotado') ||
              text.toLowerCase().includes('sem estoque')
            ) {
              return false;
            }
            
            // Check for positive indicators
            if (
              text.toLowerCase().includes('disponível') || 
              text.toLowerCase().includes('em estoque') ||
              text.toLowerCase().includes('comprar')
            ) {
              return true;
            }
          }
          
          // If we found the element but couldn't determine availability from text
          // assume it's available
          return true;
        }
      } catch (e) {}
    }
    
    // Check from structured data
    try {
      const structuredData = await this.extractStructuredData(page);
      if (structuredData && structuredData.jsonLd) {
        for (const item of structuredData.jsonLd) {
          if (item.offers) {
            const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
            for (const offer of offers) {
              if (offer.availability) {
                return offer.availability.includes('InStock');
              }
            }
          }
        }
      }
    } catch (e) {}
    
    // Last check: if we found a price, assume it's available
    try {
      const price = await this.extractPrice(page);
      if (price) {
        return true;
      }
    } catch (e) {}
    
    // We couldn't determine availability
    return null;
  }

  /**
   * Extract additional product information
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<Object>} - Additional product data
   */
  async extractProductInfo(page) {
    try {
      // Extract SKU, brand, and other details
      return await page.evaluate(() => {
        const info = {};
        
        // Try to get SKU
        const skuElement = document.querySelector('[data-product-sku], [itemprop="sku"], .product-sku');
        if (skuElement) {
          info.sku = skuElement.textContent.trim() || skuElement.getAttribute('content');
        }
        
        // Try to get brand
        const brandElement = document.querySelector('[itemprop="brand"], .product-brand');
        if (brandElement) {
          info.brand = brandElement.textContent.trim() || brandElement.getAttribute('content');
        }
        
        // Try to get installment info
        const installmentElement = document.querySelector('.payment-installments, .product-installment');
        if (installmentElement) {
          info.installment = installmentElement.textContent.trim();
        }
        
        // Try to get image URL
        const imageElement = document.querySelector('[property="og:image"], [itemprop="image"], .product-image img');
        if (imageElement) {
          info.imageUrl = imageElement.getAttribute('content') || imageElement.getAttribute('src');
        }
        
        return info;
      });
    } catch (error) {
      logger.debug('Error extracting additional product info', {}, error);
      return {};
    }
  }

  /**
   * Handle any site-specific setup before extraction
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<void>}
   */
  async preProcess(page) {
    try {
      // Wait for price element to be available
      const priceSelectors = this.selectors.price.join(', ');
      await page.waitForSelector(priceSelectors, { timeout: 5000 }).catch(() => {});
      
      // Scroll down to potentially trigger lazy-loaded content
      await page.evaluate(() => {
        window.scrollBy(0, 300);
      });
      
      // Wait for any potential lazy-loaded content
      await page.waitForTimeout(1000);
    } catch (error) {
      logger.debug('Error in pre-processing', {}, error);
    }
  }

  /**
   * Normalize price value from various formats
   * @param {string|number} price - Price in various formats
   * @returns {number|null} - Normalized price as number or null
   * @private
   */
  _normalizePrice(price) {
    if (!price) return null;
    
    // If already a number, return it
    if (typeof price === 'number') return price;
    
    try {
      // Remove all non-numeric characters except . and ,
      let clean = price.toString().replace(/[^\d,\.]/g, '');
      
      // Handle Brazilian number format (where . is thousand separator and , is decimal separator)
      // Example: 1.234,56 -> 1234.56
      if (clean.includes(',')) {
        // If there are both . and , we assume Brazilian format
        if (clean.includes('.')) {
          clean = clean.replace(/\./g, '').replace(',', '.');
        } else {
          clean = clean.replace(',', '.');
        }
      }
      
      const value = parseFloat(clean);
      return isNaN(value) ? null : value;
    } catch (error) {
      logger.debug('Error normalizing price', { price }, error);
      return null;
    }
  }

  /**
   * Extract domain from URL
   * @param {string} url - URL to extract domain from
   * @returns {string} - Domain name
   * @private
   */
  _extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return '';
    }
  }
}

module.exports = ViaVarejoAdapter; 