/**
 * Magazine Luiza Adapter
 * Handles extraction from Magazine Luiza (magazineluiza.com.br)
 */
const AbstractAdapter = require('./AbstractAdapter');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class MagazineLuizaAdapter extends AbstractAdapter {
  constructor() {
    // Parent class requires domain name
    super('magazineluiza');
    
    // List of domains this adapter can handle
    this.domains = [
      'magazineluiza.com.br'
    ];
    
    // CSS selectors for product data extraction
    this.selectors = {
      price: [
        '[data-testid="price-value"]',
        '.price-template__text',
        '.price-template-price-block',
        '.price-template__best-price',
        '[data-testid="price-original"]',
        '.price-value',
        '.price--big'
      ],
      title: [
        '[data-testid="heading-product-title"]',
        '.header-product__title',
        '.product-title',
        'h1.title',
        'h1.product-name',
        '[data-testid="product-title"]'
      ],
      availability: [
        '[data-testid="bagButton"]',
        '.button__buy',
        '.button--buy',
        '.buy-button',
        '[data-testid="add-to-cart"]'
      ],
      outOfStock: [
        '.unavailable-product',
        '.out-of-stock',
        '[data-testid="unavailable"]',
        '.product-unavailable',
        '.unavailable'
      ]
    };
    
    // Cache para evitar reprocessamento
    this._cache = new Map();
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
      logger.warn('Magazine Luiza page appears to be blocked', { url: page.url() });
      throw new Error('Access blocked by Magazine Luiza site');
    }
    
    try {
      // Get URL for cache key
      const url = page.url();
      const cacheKey = `extract:${url}`;
      
      // Check cache
      if (this._cache.has(cacheKey)) {
        logger.debug('Using cached extraction result', { url });
        return this._cache.get(cacheKey);
      }
      
      // Extra wait for price to be visible
      await page.waitForTimeout(1000);
      
      // Extract structured data (JSON-LD and microdata)
      const structuredData = await this._extractStructuredData(page);
      
      // Extract main data - run in parallel for efficiency
      const [price, title, availability, productInfo] = await Promise.all([
        this._extractPrice(page, structuredData),
        this._extractTitle(page, structuredData),
        this._extractAvailability(page, structuredData),
        this._extractProductInfo(page, structuredData)
      ]);
      
      // Build result
      const result = {
        price,
        title,
        availability,
        ...productInfo,
        structuredData: structuredData ? true : false,
        url: page.url()
      };
      
      // Cache result for reuse
      this._cache.set(cacheKey, result);
      
      // Limite o tamanho do cache
      if (this._cache.size > 100) {
        // Remove o item mais antigo (FIFO)
        const firstKey = this._cache.keys().next().value;
        this._cache.delete(firstKey);
      }
      
      return result;
    } catch (error) {
      logger.error('Error extracting data from Magazine Luiza page', {
        url: page.url(),
        domain: this._extractDomain(page.url())
      }, error);
      
      throw new Error(`Extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract structured data from page (JSON-LD and microdata)
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<Object|null>} - Structured data or null
   * @private
   */
  async _extractStructuredData(page) {
    try {
      return await page.evaluate(() => {
        const result = {
          jsonLd: [],
          microdata: [],
          openGraph: {}
        };
        
        // Extract JSON-LD
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        if (jsonLdScripts.length) {
          jsonLdScripts.forEach(script => {
            try {
              if (script.textContent) {
                const jsonData = JSON.parse(script.textContent);
                result.jsonLd.push(jsonData);
              }
            } catch (e) {
              // Ignore parse errors
            }
          });
        }
        
        // Extract Open Graph
        const ogMetaTags = document.querySelectorAll('meta[property^="og:"]');
        if (ogMetaTags.length) {
          ogMetaTags.forEach(tag => {
            const property = tag.getAttribute('property');
            const content = tag.getAttribute('content');
            if (property && content) {
              const key = property.replace('og:', '');
              result.openGraph[key] = content;
            }
          });
        }
        
        // Check for dataLayer (common in Magazine Luiza)
        if (window.dataLayer) {
          result.dataLayer = window.dataLayer;
        }
        
        // Check for product JSON in global variable (common in Magazine Luiza)
        if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && 
            window.__NEXT_DATA__.props.pageProps && 
            window.__NEXT_DATA__.props.pageProps.product) {
          result.nextData = window.__NEXT_DATA__.props.pageProps.product;
        }
        
        return Object.keys(result.jsonLd).length > 0 || 
               Object.keys(result.openGraph).length > 0 || 
               result.dataLayer || 
               result.nextData ? result : null;
      });
    } catch (error) {
      logger.debug('Error extracting structured data', {}, error);
      return null;
    }
  }

  /**
   * Extract price from page
   * @param {import('playwright').Page} page - Playwright page
   * @param {Object} structuredData - Pre-extracted structured data
   * @returns {Promise<number|null>} - Extracted price or null
   * @private
   */
  async _extractPrice(page, structuredData = null) {
    try {
      // 1. Try to extract from structured data first
      if (structuredData) {
        // Check nextData (specific to Magazine Luiza)
        if (structuredData.nextData && structuredData.nextData.price) {
          const price = this._normalizePrice(structuredData.nextData.price);
          if (price) return price;
        }
        
        // Check JSON-LD
        if (structuredData.jsonLd && structuredData.jsonLd.length) {
          for (const item of structuredData.jsonLd) {
            // Check for Offer format
            if (item.offers && item.offers.price) {
              const price = this._normalizePrice(item.offers.price);
              if (price) return price;
            }
            
            // Check for array of offers
            if (item.offers && Array.isArray(item.offers)) {
              for (const offer of item.offers) {
                if (offer.price) {
                  const price = this._normalizePrice(offer.price);
                  if (price) return price;
                }
              }
            }
          }
        }
        
        // Check Open Graph
        if (structuredData.openGraph && structuredData.openGraph.price) {
          const price = this._normalizePrice(structuredData.openGraph.price);
          if (price) return price;
        }
      }
      
      // 2. Try to extract from DOM selectors
      for (const selector of this.selectors.price) {
        try {
          const element = await page.$(selector);
          if (element) {
            const priceText = await element.textContent();
            if (priceText) {
              const price = this._normalizePrice(priceText);
              if (price) return price;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // 3. Try to extract from global JS variables
      const jsPrice = await page.evaluate(() => {
        // Check dataLayer (common in Magazine Luiza)
        if (window.dataLayer) {
          for (const item of window.dataLayer) {
            if (item.ecommerce && 
                item.ecommerce.detail && 
                item.ecommerce.detail.products && 
                item.ecommerce.detail.products[0] && 
                item.ecommerce.detail.products[0].price) {
              return item.ecommerce.detail.products[0].price;
            }
          }
        }
        
        // Check Magazine Luiza specific variables
        if (window.__NEXT_DATA__ && 
            window.__NEXT_DATA__.props && 
            window.__NEXT_DATA__.props.pageProps && 
            window.__NEXT_DATA__.props.pageProps.product) {
          return window.__NEXT_DATA__.props.pageProps.product.price;
        }
        
        return null;
      });
      
      if (jsPrice) {
        const normalizedPrice = this._normalizePrice(jsPrice);
        if (normalizedPrice) return normalizedPrice;
      }
      
      // 4. Try to extract from HTML using regex
      const html = await page.content();
      const priceRegexPatterns = [
        /"price":\s*"?(\d+[.,]\d+)"?/i,
        /"price":\s*(\d+[.,]\d+)/i,
        /"priceValue":\s*"?(\d+[.,]\d+)"?/i,
        /\\"price\\":\s*\\"(\d+[.,]\d+)\\"/i,
        /R\$\s*(\d+[.,]\d+)/i
      ];
      
      for (const pattern of priceRegexPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const price = this._normalizePrice(match[1]);
          if (price) return price;
        }
      }
      
      return null;
    } catch (error) {
      logger.error('Error extracting price', { url: page.url() }, error);
      return null;
    }
  }

  /**
   * Extract title from page
   * @param {import('playwright').Page} page - Playwright page
   * @param {Object} structuredData - Pre-extracted structured data
   * @returns {Promise<string|null>} - Extracted title or null
   * @private
   */
  async _extractTitle(page, structuredData = null) {
    try {
      // 1. Try to extract from structured data first
      if (structuredData) {
        // Check nextData (specific to Magazine Luiza)
        if (structuredData.nextData && structuredData.nextData.title) {
          return structuredData.nextData.title;
        }
        
        // Check JSON-LD
        if (structuredData.jsonLd && structuredData.jsonLd.length) {
          for (const item of structuredData.jsonLd) {
            if (item.name) {
              return item.name;
            }
          }
        }
        
        // Check Open Graph
        if (structuredData.openGraph && structuredData.openGraph.title) {
          return structuredData.openGraph.title;
        }
      }
      
      // 2. Try to extract from meta tags
      const metaTitle = await page.evaluate(() => {
        const metaTitle = document.querySelector('meta[property="og:title"]') || 
                          document.querySelector('meta[name="title"]') || 
                          document.querySelector('meta[name="twitter:title"]');
                          
        return metaTitle ? metaTitle.getAttribute('content') : null;
      });
      
      if (metaTitle) return metaTitle;
      
      // 3. Try to extract from DOM selectors
      for (const selector of this.selectors.title) {
        try {
          const element = await page.$(selector);
          if (element) {
            const titleText = await element.textContent();
            if (titleText) return titleText.trim();
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // 4. Fall back to page title
      return await page.title();
    } catch (error) {
      logger.error('Error extracting title', { url: page.url() }, error);
      return null;
    }
  }

  /**
   * Extract availability from page
   * @param {import('playwright').Page} page - Playwright page
   * @param {Object} structuredData - Pre-extracted structured data
   * @returns {Promise<boolean|null>} - True if available, false if not, null if unknown
   * @private
   */
  async _extractAvailability(page, structuredData = null) {
    try {
      // 1. Try to extract from structured data first
      if (structuredData) {
        // Check nextData (specific to Magazine Luiza)
        if (structuredData.nextData && structuredData.nextData.hasOwnProperty('available')) {
          return structuredData.nextData.available === true;
        }
        
        // Check JSON-LD
        if (structuredData.jsonLd && structuredData.jsonLd.length) {
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
      }
      
      // 2. Check for out of stock indicators
      for (const selector of this.selectors.outOfStock) {
        const element = await page.$(selector);
        if (element) {
          // This suggests the product is out of stock
          return false;
        }
      }
      
      // 3. Check for buy button/availability indicators
      for (const selector of this.selectors.availability) {
        const element = await page.$(selector);
        if (element) {
          // Check if the button is disabled
          const isDisabled = await page.evaluate(el => {
            return el.disabled || 
                   el.classList.contains('disabled') || 
                   el.getAttribute('disabled') === 'true' ||
                   el.getAttribute('aria-disabled') === 'true';
          }, element);
          
          if (!isDisabled) {
            // This suggests the product is available
            return true;
          }
        }
      }
      
      // 4. Look for text indicators in the page
      const availabilityText = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        if (bodyText.includes('fora de estoque') || 
            bodyText.includes('indisponível') || 
            bodyText.includes('sem estoque')) {
          return false;
        }
        
        if (bodyText.includes('em estoque') || 
            bodyText.includes('disponível')) {
          return true;
        }
        
        return null;
      });
      
      if (availabilityText !== null) return availabilityText;
      
      // 5. If we have a price, assume it's available
      const price = await this._extractPrice(page, structuredData);
      return price !== null;
    } catch (error) {
      logger.error('Error extracting availability', { url: page.url() }, error);
      return null;
    }
  }

  /**
   * Extract additional product information
   * @param {import('playwright').Page} page - Playwright page
   * @param {Object} structuredData - Pre-extracted structured data
   * @returns {Promise<Object>} - Additional product information
   * @private
   */
  async _extractProductInfo(page, structuredData = null) {
    try {
      const info = {};
      
      // 1. Extract info from structured data if available
      if (structuredData) {
        // Check nextData (specific to Magazine Luiza)
        if (structuredData.nextData) {
          const nextData = structuredData.nextData;
          
          if (nextData.id) info.sku = nextData.id;
          if (nextData.brand) info.brand = nextData.brand;
          if (nextData.images && nextData.images.length) {
            info.imageUrl = nextData.images[0];
          }
          if (nextData.category) info.category = nextData.category;
        }
        
        // Check JSON-LD
        if (structuredData.jsonLd && structuredData.jsonLd.length) {
          for (const item of structuredData.jsonLd) {
            if (item.brand && !info.brand) {
              info.brand = typeof item.brand === 'string' ? item.brand : item.brand.name;
            }
            
            if (item.sku && !info.sku) {
              info.sku = item.sku;
            }
            
            if (item.image && !info.imageUrl) {
              info.imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
            }
          }
        }
        
        // Check Open Graph
        if (structuredData.openGraph) {
          if (structuredData.openGraph.image && !info.imageUrl) {
            info.imageUrl = structuredData.openGraph.image;
          }
        }
      }
      
      // 2. Extract info from DOM
      const domInfo = await page.evaluate(() => {
        const extracted = {};
        
        // Try to get installment info
        const installmentInfo = document.querySelector('.price-template__installments, .installment') ||
                                document.querySelector('[data-testid="installment-value"]');
        if (installmentInfo) {
          extracted.installment = installmentInfo.textContent.trim();
        }
        
        // Try to get seller info
        const sellerInfo = document.querySelector('.seller-info, .sold-by, [data-testid="seller-info"]');
        if (sellerInfo) {
          extracted.seller = sellerInfo.textContent.trim();
        }
        
        // Try to get specifications
        const specs = {};
        const specsContainer = document.querySelector('.specifications, .technical-info, [data-testid="specifications"]');
        if (specsContainer) {
          const rows = specsContainer.querySelectorAll('tr, li, .spec-row');
          rows.forEach(row => {
            const label = row.querySelector('th, .label') || row.querySelector('*:first-child');
            const value = row.querySelector('td, .value') || row.querySelector('*:last-child');
            
            if (label && value && label !== value) {
              const labelText = label.textContent.trim();
              const valueText = value.textContent.trim();
              
              if (labelText && valueText) {
                specs[labelText] = valueText;
              }
            }
          });
        }
        
        if (Object.keys(specs).length > 0) {
          extracted.specifications = specs;
        }
        
        return extracted;
      });
      
      return { ...info, ...domInfo };
    } catch (error) {
      logger.debug('Error extracting product info', { url: page.url() }, error);
      return {};
    }
  }

  /**
   * Check if the site is blocking our scraper
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<boolean>} - True if blocked, false otherwise
   */
  async isBlocked(page) {
    try {
      // Check for common blocking indicators
      const blocked = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        
        // Check for challenge or antibot systems
        return bodyText.includes('captcha') || 
               bodyText.includes('bloqueado') || 
               bodyText.includes('acesso negado') || 
               bodyText.includes('access denied') || 
               bodyText.includes('challenge') || 
               bodyText.includes('security check') ||
               bodyText.includes('verificação de segurança');
      });
      
      if (blocked) {
        logger.warn('Detected blocking on Magazine Luiza page', { url: page.url() });
      }
      
      return blocked;
    } catch (error) {
      logger.error('Error checking if blocked', { url: page.url() }, error);
      return false;
    }
  }

  /**
   * Prepare page for scraping (e.g., dismiss popups, set location)
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<void>}
   */
  async preProcess(page) {
    try {
      // Wait for the main content to load
      await page.waitForLoadState('domcontentloaded');
      
      // Close cookie banners and popups
      const closeSelectors = [
        '.cookie-notification-container button',
        '.cookie-banner .close',
        '.cookie-banner .accept',
        '.popup-close',
        '[data-testid="close-button"]',
        '.modal-close'
      ];
      
      for (const selector of closeSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click().catch(() => {});
          }
        } catch (e) {
          // Ignore errors and continue
        }
      }
      
      // Scroll to make sure lazy-loaded elements appear
      await page.evaluate(() => {
        window.scrollTo(0, window.innerHeight / 2);
      });
      
      // Wait briefly for dynamic content to load
      await page.waitForTimeout(500);
    } catch (error) {
      logger.debug('Error in pre-processing', { url: page.url() }, error);
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
      // Convert to string
      const priceStr = price.toString();
      
      // Remove all non-numeric characters except . and ,
      let clean = priceStr.replace(/[^\d,\.]/g, '');
      
      // Check if we have any digits
      if (!/\d/.test(clean)) return null;
      
      // Handle Brazilian number format (where . is thousand separator and , is decimal separator)
      // Example: 1.234,56 -> 1234.56
      
      // If it's likely Brazilian format
      const isBrazilianFormat = priceStr.includes('R$') || priceStr.includes('BRL') || /\d{1,3}(?:\.\d{3})+,\d{2}/.test(priceStr);
      
      if (isBrazilianFormat) {
        // If both . and , are present, assume . is thousands and , is decimal
        if (clean.includes('.') && clean.includes(',')) {
          clean = clean.replace(/\./g, '').replace(',', '.');
        } 
        // If only , is present, assume it's decimal
        else if (clean.includes(',')) {
          clean = clean.replace(',', '.');
        }
      } else {
        // For international format (1,234.56), remove commas
        clean = clean.replace(/,/g, '');
      }
      
      // Parse and validate
      const value = parseFloat(clean);
      
      if (isNaN(value)) return null;
      
      // Check for unreasonable values (too high or too low)
      if (value > 1000000) {
        // Try dividing by 100 (common error in Brazilian prices)
        return value / 100;
      }
      
      return value;
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

module.exports = MagazineLuizaAdapter; 