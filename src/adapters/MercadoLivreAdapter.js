/**
 * Mercado Livre Adapter
 * Handles extraction from Mercado Livre (mercadolivre.com.br)
 */
const AbstractAdapter = require('./AbstractAdapter');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class MercadoLivreAdapter extends AbstractAdapter {
  constructor() {
    // Parent class requires domain name
    super('mercadolivre');
    
    // List of domains this adapter can handle
    this.domains = [
      'mercadolivre.com.br',
      'mercadolibre.com'
    ];
    
    // CSS selectors for product data extraction
    this.selectors = {
      price: [
        '.ui-pdp-price__second-line .andes-money-amount__fraction',
        '.price-tag-fraction',
        '.ui-pdp-price .andes-money-amount__fraction',
        '[itemprop="price"]',
        '.andes-money-amount.ui-pdp-price__part .andes-money-amount__fraction',
        '.ui-pdp-container__row--price .ui-pdp-price'
      ],
      priceCents: [
        '.ui-pdp-price__second-line .andes-money-amount__cents',
        '.price-tag-cents',
        '.ui-pdp-price .andes-money-amount__cents',
        '.andes-money-amount.ui-pdp-price__part .andes-money-amount__cents'
      ],
      title: [
        '.ui-pdp-title',
        '.item-title h1',
        '.ui-pdp-container__top-wrapper h1',
        '[itemprop="name"]',
        '.ui-pdp-container__title'
      ],
      availability: [
        '.ui-pdp-actions .ui-pdp-buybox__quantity',
        '.item-actions .item-stock',
        '.ui-pdp-stock-information',
        '.ui-pdp-buybox__container .ui-pdp-actions'
      ],
      outOfStock: [
        '.ui-pdp-buybox__unavailable',
        '.item-unavailable',
        '.ui-pdp-buybox__quantity--out-of-stock',
        '.ui-pdp-buybox__unavailable-title'
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
      logger.warn('Mercado Livre page appears to be blocked', { url: page.url() });
      throw new Error('Access blocked by Mercado Livre site');
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
      
      // Wait for price element to be visible - Mercado Livre loads asynchronously
      try {
        await page.waitForSelector(this.selectors.price[0], { timeout: 2000 });
      } catch (e) {
        // Continue even if timeout - we'll try other methods
      }
      
      // Extra wait for price to be visible
      await page.waitForTimeout(500);
      
      // Extract structured data (JSON-LD and microdata)
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
      logger.error('Error extracting data from Mercado Livre page', {
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
          initialData: null
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
        
        // Extract initialData - Mercado Livre stores product data in a global variable
        try {
          if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {
            result.initialData = window.__NEXT_DATA__.props.pageProps;
          } else if (window.__initialData) {
            result.initialData = JSON.parse(window.__initialData);
          }
        } catch (e) {
          // Ignore parse errors
        }
        
        // Extract UI data
        try {
          if (window.__PRELOADED_STATE__) {
            result.preloadedState = window.__PRELOADED_STATE__;
          }
        } catch (e) {
          // Ignore parse errors
        }
        
        return Object.keys(result.jsonLd).length > 0 || result.initialData || result.preloadedState ? 
          result : null;
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
        
        // Check Mercado Livre's initialData
        if (structuredData.initialData) {
          const initialData = structuredData.initialData;
          
          // Navigate through different possible structures
          if (initialData.schema && initialData.schema.offers && initialData.schema.offers.price) {
            return this._normalizePrice(initialData.schema.offers.price);
          }
          
          if (initialData.product && initialData.product.price) {
            return this._normalizePrice(initialData.product.price);
          }
          
          if (initialData.price) {
            return this._normalizePrice(initialData.price);
          }
        }
        
        // Check preloaded state
        if (structuredData.preloadedState && structuredData.preloadedState.product) {
          const product = structuredData.preloadedState.product;
          if (product.price) {
            return this._normalizePrice(product.price);
          }
        }
      }
      
      // 2. Mercado Livre often splits price into whole and cents parts
      // Try to get both and combine them
      let fraction = null;
      let cents = null;
      
      // Try each selector for the main price (fraction)
      for (const selector of this.selectors.price) {
        try {
          const element = await page.$(selector);
          if (element) {
            fraction = await element.textContent();
            if (fraction) {
              fraction = fraction.trim();
              break;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // Try each selector for the cents
      for (const selector of this.selectors.priceCents) {
        try {
          const element = await page.$(selector);
          if (element) {
            cents = await element.textContent();
            if (cents) {
              cents = cents.trim();
              break;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // Combine fraction and cents if both are found
      if (fraction) {
        let priceStr = fraction;
        if (cents) {
          // Make sure cents has exactly 2 digits
          if (cents.length === 1) cents = `0${cents}`;
          priceStr = `${fraction},${cents}`;
        }
        
        const price = this._normalizePrice(priceStr);
        if (price) return price;
      }
      
      // 3. Try to get the full price directly
      try {
        const fullPriceSelector = '.ui-pdp-price__second-line .andes-money-amount';
        const fullPriceElement = await page.$(fullPriceSelector);
        if (fullPriceElement) {
          const priceText = await fullPriceElement.textContent();
          if (priceText) {
            const price = this._normalizePrice(priceText);
            if (price) return price;
          }
        }
      } catch (e) {
        // Continue to other methods
      }
      
      // 4. Try to extract from hidden micro-data
      try {
        const microDataElement = await page.$('[itemprop="price"]');
        if (microDataElement) {
          const priceContent = await microDataElement.getAttribute('content');
          if (priceContent) {
            const price = this._normalizePrice(priceContent);
            if (price) return price;
          }
        }
      } catch (e) {
        // Continue to other methods
      }
      
      // 5. Look for price in entire page with regex
      const html = await page.content();
      const priceRegexPatterns = [
        /"price":\s*(\d+(?:[.,]\d+)?)/i,
        /"price":\s*"(\d+(?:[.,]\d+)?)"/i,
        /R\$\s*(\d+(?:[.,]\d+)?)/i
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
        
        // Check Mercado Livre's initialData
        if (structuredData.initialData) {
          if (structuredData.initialData.schema && structuredData.initialData.schema.name) {
            return structuredData.initialData.schema.name;
          }
          
          if (structuredData.initialData.product && structuredData.initialData.product.title) {
            return structuredData.initialData.product.title;
          }
          
          if (structuredData.initialData.title) {
            return structuredData.initialData.title;
          }
        }
        
        // Check preloaded state
        if (structuredData.preloadedState && structuredData.preloadedState.product) {
          const product = structuredData.preloadedState.product;
          if (product.title) {
            return product.title;
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
        // Remove Mercado Livre suffix
        return pageTitle.replace(/ - Mercado[ ]?Liv[r|v]e$/i, '').trim();
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
        
        // Check Mercado Livre's initialData
        if (structuredData.initialData) {
          if (structuredData.initialData.schema && structuredData.initialData.schema.offers) {
            return structuredData.initialData.schema.offers.availability === 'http://schema.org/InStock';
          }
          
          if (structuredData.initialData.product && structuredData.initialData.product.available !== undefined) {
            return !!structuredData.initialData.product.available;
          }
        }
        
        // Check preloaded state
        if (structuredData.preloadedState && structuredData.preloadedState.product) {
          const product = structuredData.preloadedState.product;
          if (product.available !== undefined) {
            return !!product.available;
          }
        }
      }
      
      // 2. Check for out of stock indicators
      for (const selector of this.selectors.outOfStock) {
        const element = await page.$(selector);
        if (element) {
          // Get the text to confirm it's about availability
          const text = await element.textContent();
          if (text && (
            text.toLowerCase().includes('esgotado') ||
            text.toLowerCase().includes('indisponível') ||
            text.toLowerCase().includes('sem estoque') ||
            text.toLowerCase().includes('agotado') ||
            text.toLowerCase().includes('out of stock')
          )) {
            return false;
          }
        }
      }
      
      // 3. Check for buy button
      const buyButton = await page.$('.ui-pdp-actions .andes-button--loud');
      if (buyButton) {
        // Check if button is disabled
        const isDisabled = await page.evaluate(button => {
          return button.disabled || 
                 button.classList.contains('andes-button--disabled') || 
                 button.getAttribute('aria-disabled') === 'true';
        }, buyButton);
        
        if (!isDisabled) {
          return true;
        }
      }
      
      // 4. Check for product stock information
      const stockInfo = await page.$('.ui-pdp-stock-information');
      if (stockInfo) {
        const stockText = await stockInfo.textContent();
        if (stockText) {
          if (stockText.toLowerCase().includes('disponível') || 
              stockText.toLowerCase().includes('em estoque') ||
              stockText.toLowerCase().includes('disponible') ||
              stockText.toLowerCase().includes('in stock')) {
            return true;
          }
          
          if (stockText.toLowerCase().includes('esgotado') || 
              stockText.toLowerCase().includes('indisponível') ||
              stockText.toLowerCase().includes('agotado') ||
              stockText.toLowerCase().includes('out of stock')) {
            return false;
          }
        }
      }
      
      // 5. If we have a price, product is likely available
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
        
        // Check initialData
        if (structuredData.initialData) {
          const data = structuredData.initialData;
          
          // Check different possible structures
          if (data.schema) {
            if (data.schema.brand && data.schema.brand.name) {
              info.brand = data.schema.brand.name;
            }
            
            if (data.schema.sku) {
              info.sku = data.schema.sku;
            }
            
            if (data.schema.image) {
              info.imageUrl = Array.isArray(data.schema.image) ? data.schema.image[0] : data.schema.image;
            }
          }
          
          if (data.product) {
            if (data.product.brand && !info.brand) {
              info.brand = data.product.brand;
            }
            
            if (data.product.id && !info.sku) {
              info.sku = data.product.id;
            }
            
            if (data.product.pictures && data.product.pictures.length && !info.imageUrl) {
              info.imageUrl = data.product.pictures[0].url;
            }
            
            if (data.product.seller_name) {
              info.seller = data.product.seller_name;
            }
            
            if (data.product.warranty) {
              info.warranty = data.product.warranty;
            }
          }
        }
      }
      
      // 2. Extract from DOM
      const domInfo = await page.evaluate(() => {
        const extracted = {};
        
        // Try to get seller info
        const sellerElement = document.querySelector('.ui-pdp-seller__header__title, .ui-pdp-subtitle');
        if (sellerElement) {
          extracted.seller = sellerElement.textContent.trim();
        }
        
        // Try to get condition
        const conditionElement = document.querySelector('.ui-pdp-subtitle');
        if (conditionElement) {
          const text = conditionElement.textContent.toLowerCase().trim();
          if (text.includes('novo') || text.includes('new')) {
            extracted.condition = 'Novo';
          } else if (text.includes('usado') || text.includes('used')) {
            extracted.condition = 'Usado';
          }
        }
        
        // Try to get installment info
        const installmentElement = document.querySelector('.ui-pdp-payment--md .ui-pdp-media__title');
        if (installmentElement) {
          extracted.installment = installmentElement.textContent.trim();
        }
        
        // Try to get main image
        const imageElement = document.querySelector('.ui-pdp-gallery__figure img');
        if (imageElement) {
          extracted.imageUrl = imageElement.getAttribute('src') || imageElement.getAttribute('data-zoom');
        }
        
        // Try to get specifications
        const specs = {};
        const specElements = document.querySelectorAll('.ui-vip-specs__specs tr, .ui-pdp-specs__table tr, .ui-pdp-specs__list .andes-list__item');
        
        specElements.forEach(row => {
          const label = row.querySelector('th, .andes-list__item-primary, .andes-table__column--left');
          const value = row.querySelector('td, .andes-list__item-secondary, .andes-table__column--right');
          
          if (label && value) {
            const labelText = label.textContent.trim();
            const valueText = value.textContent.trim();
            
            if (labelText && valueText) {
              specs[labelText] = valueText;
              
              // Extract common fields
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
               body.includes('verificação de segurança') || 
               body.includes('security check') || 
               body.includes('robot test') ||
               body.includes('test de robot') ||
               body.includes('detecção de robôs') ||
               body.includes('detección de robots');
      });
      
      if (blocked) {
        // Check for captcha image
        const captchaImg = await page.$('img[src*="captcha"], .captcha-img');
        if (captchaImg) {
          logger.warn('Detected captcha on Mercado Livre page', { url: page.url() });
          return true;
        }
        
        logger.warn('Detected potential blocking on Mercado Livre page', { url: page.url() });
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
        '.cookie-consent-banner-opt-out__action--primary button', // Cookie banner
        '.cookie-consent-banner-opt-out__action--key-accept', // Another cookie banner
        '.nav-top-disclaimer__button', // Top banner
        '.andes-modal__close', // Modal close button
        '.onboarding-cp-button' // Onboarding button
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
      
      // Handle Brazilian/Spanish number format (where . is thousand separator and , is decimal separator)
      // Example: 1.234,56 -> 1234.56
      
      // If both . and , are present, assume . is thousands and , is decimal
      if (clean.includes('.') && clean.includes(',')) {
        clean = clean.replace(/\./g, '').replace(',', '.');
      } 
      // If only , is present, assume it's decimal
      else if (clean.includes(',')) {
        clean = clean.replace(',', '.');
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

module.exports = MercadoLivreAdapter; 