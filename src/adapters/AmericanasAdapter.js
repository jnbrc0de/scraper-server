/**
 * Americanas Adapter
 * Handles extraction from Americanas (americanas.com.br)
 */
const AbstractAdapter = require('./AbstractAdapter');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class AmericanasAdapter extends AbstractAdapter {
  constructor() {
    // Parent class requires domain name
    super('americanas');
    
    // List of domains this adapter can handle
    this.domains = [
      'americanas.com.br',
      'submarino.com.br',
      'shoptime.com.br' // Same group, similar structure
    ];
    
    // CSS selectors for product data extraction
    this.selectors = {
      price: [
        '[data-testid="price-value"]',
        '.priceSales',
        '.price__SalesPrice",
        '.sales-price',
        '.product-price-value',
        '.price-box__SalesPrice'
      ],
      title: [
        '[data-testid="product-title"]',
        '.product-title',
        '.product__title',
        '.product__ProductTitle',
        'h1[itemprop="name"]',
        '.product-name'
      ],
      availability: [
        '[data-testid="buy-button"]',
        '.buy-button',
        '.buybox__BuyButton',
        '.wrapper__buy-button',
        '.buy-section .button-success'
      ],
      outOfStock: [
        '[data-testid="unavailable-product"]',
        '.unavailable',
        '.product__unavailable',
        '.buy-section .unavailable',
        '.buy-section .warning'
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
      logger.warn('Americanas page appears to be blocked', { url: page.url() });
      throw new Error('Access blocked by Americanas site');
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
      
      // Extra wait for price to be visible - Americanas may load prices with JS
      await page.waitForTimeout(1000);
      
      // Extract structured data
      const structuredData = await this._extractStructuredData(page);
      
      // Extract main data
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
      
      // Limit cache size
      if (this._cache.size > 100) {
        const firstKey = this._cache.keys().next().value;
        this._cache.delete(firstKey);
      }
      
      return result;
    } catch (error) {
      logger.error('Error extracting data from Americanas page', {
        url: page.url(),
        domain: this._extractDomain(page.url())
      }, error);
      
      throw new Error(`Extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract structured data from page
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<Object|null>} - Structured data or null
   * @private
   */
  async _extractStructuredData(page) {
    try {
      return await page.evaluate(() => {
        const result = {
          jsonLd: [],
          microdata: [],
          pageInfo: null
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
        
        // Americanas stores product information in global variables
        if (window.__APOLLO_STATE__) {
          result.pageInfo = { apollo: window.__APOLLO_STATE__ };
        } else if (window.__PRELOADED_STATE__) {
          result.pageInfo = { preloaded: window.__PRELOADED_STATE__ };
        } else if (window.__PRODUCT__) {
          result.pageInfo = { product: window.__PRODUCT__ };
        }
        
        return Object.keys(result.jsonLd).length > 0 || result.pageInfo ? result : null;
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
      // 1. Try to extract from structured data
      if (structuredData) {
        // Check JSON-LD
        if (structuredData.jsonLd && structuredData.jsonLd.length) {
          for (const item of structuredData.jsonLd) {
            if (item.offers && item.offers.price) {
              return this._normalizePrice(item.offers.price);
            }
            
            if (item.offers && Array.isArray(item.offers)) {
              for (const offer of item.offers) {
                if (offer.price) {
                  return this._normalizePrice(offer.price);
                }
              }
            }
          }
        }
        
        // Check Americanas-specific global variables
        if (structuredData.pageInfo) {
          // Apollo State structure
          if (structuredData.pageInfo.apollo) {
            const apollo = structuredData.pageInfo.apollo;
            
            // Find price in Apollo cache
            for (const key in apollo) {
              if (apollo[key] && apollo[key].price) {
                return this._normalizePrice(apollo[key].price);
              }
              
              // Check for offers object
              if (apollo[key] && apollo[key].offers && apollo[key].offers.price) {
                return this._normalizePrice(apollo[key].offers.price);
              }
            }
          }
          
          // Preloaded state structure
          if (structuredData.pageInfo.preloaded) {
            const preloaded = structuredData.pageInfo.preloaded;
            
            if (preloaded.product && preloaded.product.price) {
              return this._normalizePrice(preloaded.product.price);
            }
            
            if (preloaded.offers && preloaded.offers.length) {
              return this._normalizePrice(preloaded.offers[0].price);
            }
          }
          
          // Direct product object
          if (structuredData.pageInfo.product) {
            const product = structuredData.pageInfo.product;
            
            if (product.price) {
              return this._normalizePrice(product.price);
            }
            
            if (product.salesPrice) {
              return this._normalizePrice(product.salesPrice);
            }
          }
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
      
      // 3. Try to extract from data attributes
      try {
        const priceElement = await page.$('[data-price], [data-testid="price-value"]');
        if (priceElement) {
          const dataPrice = await priceElement.getAttribute('data-price');
          if (dataPrice) {
            const price = this._normalizePrice(dataPrice);
            if (price) return price;
          }
        }
      } catch (e) {
        // Continue to other methods
      }
      
      // 4. Try using regex on the entire page content
      const html = await page.content();
      const priceRegexPatterns = [
        /"price":\s*"?(\d+[.,]\d+)"?/i,
        /"salesPrice":\s*"?(\d+[.,]\d+)"?/i,
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
      // 1. Try from structured data
      if (structuredData) {
        // Check JSON-LD
        if (structuredData.jsonLd && structuredData.jsonLd.length) {
          for (const item of structuredData.jsonLd) {
            if (item.name) {
              return item.name;
            }
          }
        }
        
        // Check Americanas-specific global variables
        if (structuredData.pageInfo) {
          // Apollo State structure
          if (structuredData.pageInfo.apollo) {
            const apollo = structuredData.pageInfo.apollo;
            
            // Find title in Apollo cache
            for (const key in apollo) {
              if (apollo[key] && apollo[key].name) {
                return apollo[key].name;
              }
            }
          }
          
          // Preloaded state structure
          if (structuredData.pageInfo.preloaded) {
            const preloaded = structuredData.pageInfo.preloaded;
            
            if (preloaded.product && preloaded.product.name) {
              return preloaded.product.name;
            }
          }
          
          // Direct product object
          if (structuredData.pageInfo.product) {
            const product = structuredData.pageInfo.product;
            
            if (product.name) {
              return product.name;
            }
          }
        }
      }
      
      // 2. Try to extract from meta tags
      const metaTitle = await page.evaluate(() => {
        const metaTitle = document.querySelector('meta[property="og:title"]') || 
                          document.querySelector('meta[name="title"]');
                          
        return metaTitle ? metaTitle.getAttribute('content') : null;
      });
      
      if (metaTitle) return metaTitle;
      
      // 3. Try each title selector
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
      const pageTitle = await page.title();
      if (pageTitle) {
        // Remove site suffix
        return pageTitle.replace(/\s[-|]\s(Americanas|Submarino|Shoptime)$/, '').trim();
      }
      
      return null;
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
      // 1. Check structured data
      if (structuredData) {
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
        
        // Check Americanas-specific global variables
        if (structuredData.pageInfo) {
          // Apollo State structure
          if (structuredData.pageInfo.apollo) {
            const apollo = structuredData.pageInfo.apollo;
            
            // Look for availability in Apollo cache
            for (const key in apollo) {
              if (apollo[key] && apollo[key].availability) {
                return apollo[key].availability === 'IN_STOCK';
              }
              
              if (apollo[key] && apollo[key].offers && apollo[key].offers.availability) {
                return apollo[key].offers.availability === 'IN_STOCK';
              }
            }
          }
          
          // Preloaded state structure
          if (structuredData.pageInfo.preloaded) {
            const preloaded = structuredData.pageInfo.preloaded;
            
            if (preloaded.product && preloaded.product.available !== undefined) {
              return !!preloaded.product.available;
            }
          }
          
          // Direct product object
          if (structuredData.pageInfo.product) {
            const product = structuredData.pageInfo.product;
            
            if (product.available !== undefined) {
              return !!product.available;
            }
            
            if (product.status) {
              return product.status === 'AVAILABLE';
            }
          }
        }
      }
      
      // 2. Check for out of stock indicators
      for (const selector of this.selectors.outOfStock) {
        const element = await page.$(selector);
        if (element) {
          // Confirm it's about availability
          const text = await element.textContent();
          if (text && (
            text.toLowerCase().includes('indisponível') ||
            text.toLowerCase().includes('sem estoque') ||
            text.toLowerCase().includes('esgotado') ||
            text.toLowerCase().includes('unavailable') ||
            text.toLowerCase().includes('out of stock')
          )) {
            return false;
          }
        }
      }
      
      // 3. Check for buy button
      for (const selector of this.selectors.availability) {
        const element = await page.$(selector);
        if (element) {
          // Check if button is enabled
          const isDisabled = await page.evaluate(button => {
            return button.disabled || 
                   button.getAttribute('disabled') === 'true' || 
                   button.classList.contains('disabled');
          }, element);
          
          if (!isDisabled) {
            return true;
          }
        }
      }
      
      // 4. Check page content for availability indicators
      const availabilityText = await page.evaluate(() => {
        const body = document.body.innerText.toLowerCase();
        
        if (body.includes('produto indisponível') || 
            body.includes('produto não disponível') ||
            body.includes('fora de estoque') ||
            body.includes('esgotado')) {
          return false;
        }
        
        if (body.includes('produto disponível') || 
            body.includes('em estoque') ||
            body.includes('comprar agora')) {
          return true;
        }
        
        return null;
      });
      
      if (availabilityText !== null) return availabilityText;
      
      // 5. If we have a price, product is likely available
      const price = await this._extractPrice(page, structuredData);
      if (price) return true;
      
      return null;
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
      
      // 1. Extract from structured data
      if (structuredData) {
        // Check JSON-LD
        if (structuredData.jsonLd && structuredData.jsonLd.length) {
          for (const item of structuredData.jsonLd) {
            if (item.brand) {
              info.brand = typeof item.brand === 'string' ? item.brand : (item.brand.name || null);
            }
            
            if (item.sku) {
              info.sku = item.sku;
            }
            
            if (item.image) {
              info.imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
            }
            
            if (item.mpn) {
              info.mpn = item.mpn;
            }
          }
        }
        
        // Check Americanas-specific global variables
        if (structuredData.pageInfo) {
          // Extract from Apollo data
          if (structuredData.pageInfo.apollo) {
            const apollo = structuredData.pageInfo.apollo;
            
            for (const key in apollo) {
              const item = apollo[key];
              
              if (item && item.brand && item.brand.name && !info.brand) {
                info.brand = item.brand.name;
              }
              
              if (item && item.sku && !info.sku) {
                info.sku = item.sku;
              }
              
              if (item && item.images && item.images.length && !info.imageUrl) {
                info.imageUrl = item.images[0].large || item.images[0].url;
              }
              
              if (item && item.seller && item.seller.name && !info.seller) {
                info.seller = item.seller.name;
              }
            }
          }
          
          // Extract from preloaded state
          if (structuredData.pageInfo.preloaded) {
            const preloaded = structuredData.pageInfo.preloaded;
            
            if (preloaded.product) {
              const product = preloaded.product;
              
              if (product.brand && !info.brand) {
                info.brand = product.brand;
              }
              
              if (product.id && !info.sku) {
                info.sku = product.id;
              }
              
              if (product.images && product.images.length && !info.imageUrl) {
                info.imageUrl = product.images[0].large || product.images[0].url;
              }
              
              if (product.seller && !info.seller) {
                info.seller = product.seller;
              }
            }
          }
          
          // Extract from direct product object
          if (structuredData.pageInfo.product) {
            const product = structuredData.pageInfo.product;
            
            if (product.brand && !info.brand) {
              info.brand = product.brand;
            }
            
            if (product.id && !info.sku) {
              info.sku = product.id;
            }
            
            if (product.images && product.images.length && !info.imageUrl) {
              info.imageUrl = product.images[0].large || product.images[0].url;
            }
            
            if (product.seller && !info.seller) {
              info.seller = product.seller;
            }
          }
        }
      }
      
      // 2. Extract from DOM
      const domInfo = await page.evaluate(() => {
        const extracted = {};
        
        // Try to get seller info
        const sellerElement = document.querySelector('[data-testid="seller-name"], .seller-name, .product-seller');
        if (sellerElement) {
          extracted.seller = sellerElement.textContent.trim();
        }
        
        // Try to get installment info
        const installmentElement = document.querySelector('[data-testid="installment"], .installment, .installment-value');
        if (installmentElement) {
          extracted.installment = installmentElement.textContent.trim();
        }
        
        // Try to get main image
        const imageElement = document.querySelector('.product-image img, [data-testid="image"]');
        if (imageElement) {
          extracted.imageUrl = imageElement.getAttribute('src');
        }
        
        // Try to get specifications
        const specs = {};
        const specRows = document.querySelectorAll('[data-testid="product-specification"] tr, .spec-row, .tech-spec-row');
        
        specRows.forEach(row => {
          const label = row.querySelector('th, .spec-label');
          const value = row.querySelector('td, .spec-value');
          
          if (label && value) {
            const labelText = label.textContent.trim();
            const valueText = value.textContent.trim();
            
            if (labelText && valueText) {
              specs[labelText] = valueText;
              
              // Extract common information
              if (labelText.toLowerCase().includes('marca') || labelText.toLowerCase().includes('brand')) {
                extracted.brand = valueText;
              }
              
              if (labelText.toLowerCase().includes('modelo') || labelText.toLowerCase().includes('model')) {
                extracted.model = valueText;
              }
            }
          }
        });
        
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
        const body = document.body.textContent.toLowerCase();
        
        // Check for captcha and security checks
        return body.includes('captcha') || 
               body.includes('robot challenge') || 
               body.includes('verificação de segurança') || 
               body.includes('security verification') ||
               body.includes('confirme que você é humano') ||
               body.includes('confirm you are human') ||
               body.includes('temos que verificar se você é humano');
      });
      
      if (blocked) {
        // Check for captcha image or elements
        const captchaElement = await page.$('form[data-automation="captcha-challenge"], .captcha-challenge, .g-recaptcha');
        if (captchaElement) {
          logger.warn('Detected captcha on Americanas page', { url: page.url() });
          return true;
        }
        
        logger.warn('Detected potential blocking on Americanas page', { url: page.url() });
      }
      
      return blocked;
    } catch (error) {
      logger.error('Error checking if blocked', { url: page.url() }, error);
      return false;
    }
  }

  /**
   * Prepare page for scraping
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<void>}
   */
  async preProcess(page) {
    try {
      // Wait for content to load
      await page.waitForLoadState('domcontentloaded');
      
      // Close any modals or popups
      const closeSelectors = [
        '[data-testid="close-button"]',
        '.cookie-notification-container button',
        '.overlay__close',
        '.close-modal',
        '.newsletter-popup__close'
      ];
      
      for (const selector of closeSelectors) {
        try {
          const buttons = await page.$$(selector);
          for (const button of buttons) {
            await button.click().catch(() => {});
          }
        } catch (e) {
          // Ignore errors and continue
        }
      }
      
      // Scroll to trigger lazy-loaded content
      await page.evaluate(() => {
        window.scrollBy(0, 300);
      });
      
      // Wait for dynamic content to load
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
      
      // No digits? Return null
      if (!/\d/.test(clean)) return null;
      
      // Determine format (Brazilian vs International)
      // Brazilian: R$ 1.234,56  |  International: $1,234.56
      const isBrazilianFormat = priceStr.includes('R$') || 
                                /\d{1,3}(?:\.\d{3})+,\d{2}/.test(priceStr);
      
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

module.exports = AmericanasAdapter; 