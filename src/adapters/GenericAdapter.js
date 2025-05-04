/**
 * Generic Adapter
 * Fallback adapter that attempts to extract data from any e-commerce site
 * using common patterns and selectors
 */
const AbstractAdapter = require('./AbstractAdapter');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class GenericAdapter extends AbstractAdapter {
  constructor() {
    // Parent class requires domain name
    super('generic');
    
    // This adapter is a fallback for any domain not handled by specific adapters
    this.domains = [];
    
    // Common e-commerce selectors that work across many sites
    this.selectors = {
      price: [
        // Schema.org standard
        '[itemprop="price"]',
        // Common price selectors across e-commerce sites
        '.price',
        '.product-price',
        '.price-value',
        '.sales-price',
        '.current-price',
        '.price-current',
        '.price-box',
        '.product__price',
        '.product-info__price',
        '.offer-price',
        // CSS patterns with price or valor in class name
        '[class*="price"]',
        '[class*="Price"]',
        '[class*="preco"]',
        '[class*="Preco"]',
        '[class*="valor"]',
        '[class*="Valor"]',
        // Data attributes
        '[data-price]',
        '[data-testid*="price"]',
        '[data-element="price"]',
        // Elements that often contain prices
        'strong.price',
        'span.price',
        'div.price',
        'p.price'
      ],
      title: [
        // Schema.org standard
        '[itemprop="name"]',
        'h1[itemprop="name"]',
        // Common title selectors
        'h1.product-name',
        'h1.product-title',
        'h1.title',
        '.product-name',
        '.product-title',
        '.product__name',
        '.product__title',
        '.title-product',
        // Common patterns
        'h1[class*="title"]',
        'h1[class*="name"]',
        'h1[class*="product"]',
        // Fallback - first h1 on the page
        'h1'
      ],
      availability: [
        // Schema.org standard
        '[itemprop="availability"]',
        '[itemprop="offers"] [itemprop="availability"]',
        // Common buy button selectors
        '.buy-button',
        '.btn-buy',
        '.add-to-cart',
        '.add-cart',
        '.add-to-basket',
        '.btn-cart',
        '[class*="buy"]',
        '[class*="Buy"]',
        '[class*="cart"]',
        '[class*="Cart"]',
        // Data attributes
        '[data-testid*="buy"]',
        '[data-testid*="cart"]',
        '[data-action="buy"]',
        '[data-action="add-to-cart"]'
      ],
      outOfStock: [
        // Common out of stock indicators
        '.out-of-stock',
        '.sold-out',
        '.unavailable',
        '.not-available',
        '.product-unavailable',
        '.stock-off',
        '.no-stock',
        '[class*="outOfStock"]',
        '[class*="unavailable"]',
        '[class*="soldOut"]'
      ]
    };
    
    // Cache para evitar reprocessamento
    this._cache = new Map();
  }

  /**
   * Check if this adapter can handle a given URL
   * @param {string} url - URL to check
   * @returns {boolean} - Always returns true as this is a fallback adapter
   */
  canHandle(url) {
    try {
      // Check if URL is valid
      const urlObj = new URL(url);
      
      // This is a fallback adapter, so only return true for HTTP/HTTPS URLs
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return false;
      }
      
      logger.debug('Generic adapter will attempt to handle URL', { url });
      return true;
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
    
    try {
      // Get URL for cache key
      const url = page.url();
      const cacheKey = `extract:${url}`;
      
      // Check cache
      if (this._cache.has(cacheKey)) {
        logger.debug('Using cached extraction result', { url });
        return this._cache.get(cacheKey);
      }
      
      // Extra wait for content to be fully loaded
      await page.waitForTimeout(2000);
      
      // Extract structured data
      const structuredData = await this._extractStructuredData(page);
      
      // Extract main data
      const [price, title, availability, productInfo] = await Promise.all([
        this._extractPrice(page, structuredData),
        this._extractTitle(page, structuredData),
        this._extractAvailability(page, structuredData),
        this._extractProductInfo(page, structuredData)
      ]);
      
      logger.debug('Generic adapter extraction results', {
        url,
        hasPrice: !!price,
        hasTitle: !!title,
        hasAvailability: availability !== null
      });
      
      // Build result
      const result = {
        price,
        title,
        availability,
        ...productInfo,
        structuredData: structuredData ? true : false,
        url: page.url(),
        adapter: 'generic'
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
      logger.error('Error extracting data using generic adapter', {
        url: page.url(),
        domain: this._extractDomain(page.url())
      }, error);
      
      throw new Error(`Generic extraction failed: ${error.message}`);
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
          openGraph: {},
          meta: {}
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
        
        // Extract basic meta tags
        const metaTags = document.querySelectorAll('meta[name][content]');
        if (metaTags.length) {
          metaTags.forEach(tag => {
            const name = tag.getAttribute('name');
            const content = tag.getAttribute('content');
            if (name && content) {
              result.meta[name] = content;
            }
          });
        }
        
        // Extract common global e-commerce variables
        const jsData = {};
        
        // Common variable names that could contain product data
        const globalVarNames = [
          'window.dataLayer',
          'window.__INITIAL_STATE__',
          'window.__PRELOADED_STATE__',
          'window.PRODUCT_DATA',
          'window.product',
          'window.productData',
          'window.__NEXT_DATA__',
          'window.PRODUCT',
          'window.__APOLLO_STATE__',
          'window.digitalData'
        ];
        
        // Try to extract each global variable
        globalVarNames.forEach(varPath => {
          try {
            const parts = varPath.split('.');
            let obj = window;
            for (const part of parts.slice(1)) {
              obj = obj[part];
              if (!obj) break;
            }
            if (obj) {
              jsData[parts[parts.length - 1]] = JSON.parse(JSON.stringify(obj));
            }
          } catch (e) {
            // Ignore errors
          }
        });
        
        if (Object.keys(jsData).length > 0) {
          result.jsData = jsData;
        }
        
        return Object.keys(result.jsonLd).length > 0 || 
               Object.keys(result.openGraph).length > 0 || 
               Object.keys(result.meta).length > 0 || 
               Object.keys(jsData).length > 0 ? result : null;
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
            // Standard Product schema
            if (item['@type'] === 'Product' && item.offers) {
              const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
              for (const offer of offers) {
                if (offer.price) {
                  return this._normalizePrice(offer.price);
                }
              }
            }
            
            // Any object with a price
            if (item.price) {
              return this._normalizePrice(item.price);
            }
            
            // Look for nested offers
            if (item.offers && item.offers.price) {
              return this._normalizePrice(item.offers.price);
            }
          }
        }
        
        // Check Open Graph
        if (structuredData.openGraph && structuredData.openGraph.price) {
          return this._normalizePrice(structuredData.openGraph.price);
        }
        
        // Check meta tags
        if (structuredData.meta && structuredData.meta.price) {
          return this._normalizePrice(structuredData.meta.price);
        }
        
        // Check JavaScript data
        if (structuredData.jsData) {
          // Helper function to recursively search for price in an object
          const findPrice = (obj, maxDepth = 3, currentDepth = 0) => {
            if (currentDepth > maxDepth || typeof obj !== 'object' || obj === null) return null;
            
            // Check direct price properties
            const priceProps = ['price', 'priceValue', 'currentPrice', 'salesPrice', 'sellingPrice'];
            for (const prop of priceProps) {
              if (obj[prop] !== undefined && obj[prop] !== null) {
                const price = this._normalizePrice(obj[prop]);
                if (price) return price;
              }
            }
            
            // Check nested objects
            for (const key in obj) {
              if (typeof obj[key] === 'object' && obj[key] !== null) {
                const price = findPrice(obj[key], maxDepth, currentDepth + 1);
                if (price) return price;
              }
            }
            
            return null;
          };
          
          // Try each data source
          for (const key in structuredData.jsData) {
            const price = findPrice(structuredData.jsData[key]);
            if (price) return price;
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
            
            // Check for data-price attribute
            const dataPriceAttr = await element.getAttribute('data-price');
            if (dataPriceAttr) {
              const price = this._normalizePrice(dataPriceAttr);
              if (price) return price;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // 3. Look for meta tags with prices
      const metaPrice = await page.evaluate(() => {
        const metaTags = document.querySelectorAll('meta[property="product:price:amount"], meta[name="product:price:amount"], meta[property="og:price:amount"]');
        for (const tag of metaTags) {
          return tag.getAttribute('content');
        }
        return null;
      });
      
      if (metaPrice) {
        const price = this._normalizePrice(metaPrice);
        if (price) return price;
      }
      
      // 4. Look for price in the page content using regex
      const html = await page.content();
      const priceRegexPatterns = [
        /[R$£€\$]\s*(\d+(?:[.,]\d+)?)/gi,
        /"price":["']?(\d+(?:[.,]\d+)?)["']?/gi,
        /"currentPrice":["']?(\d+(?:[.,]\d+)?)["']?/gi,
        /"sellingPrice":["']?(\d+(?:[.,]\d+)?)["']?/gi
      ];
      
      for (const pattern of priceRegexPatterns) {
        const matches = Array.from(html.matchAll(pattern));
        if (matches.length > 0) {
          // Find the most reasonable price (filter out very high or very low values)
          const prices = matches.map(match => this._normalizePrice(match[1]))
                                .filter(p => p !== null)
                                .sort((a, b) => a - b);
          
          // Take a price in a reasonable range if available
          for (const price of prices) {
            if (price > 1 && price < 100000) {
              return price;
            }
          }
          
          // If we can't find a reasonable price, return the first one
          if (prices.length > 0) {
            return prices[0];
          }
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
        
        // Check Open Graph
        if (structuredData.openGraph && structuredData.openGraph.title) {
          return structuredData.openGraph.title;
        }
        
        // Check meta tags
        if (structuredData.meta && structuredData.meta.title) {
          return structuredData.meta.title;
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
      
      // 3. Try each title selector
      for (const selector of this.selectors.title) {
        try {
          const element = await page.$(selector);
          if (element) {
            const titleText = await element.textContent();
            if (titleText && titleText.trim().length > 0) return titleText.trim();
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // 4. Fall back to page title
      const pageTitle = await page.title();
      if (pageTitle) {
        // Try to clean up the page title (remove site name if present)
        const parts = pageTitle.split(/[|\-–—]/).map(p => p.trim());
        if (parts.length > 1) {
          // Return the longest part as it's likely the product title
          return parts.reduce((a, b) => a.length > b.length ? a : b);
        }
        return pageTitle;
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
      }
      
      // 2. Check for out of stock indicators
      for (const selector of this.selectors.outOfStock) {
        const element = await page.$(selector);
        if (element) {
          // Check the text to confirm it's about availability
          const text = await element.textContent();
          if (text && (
            text.toLowerCase().includes('esgotado') ||
            text.toLowerCase().includes('indisponível') ||
            text.toLowerCase().includes('sem estoque') ||
            text.toLowerCase().includes('fora de estoque') ||
            text.toLowerCase().includes('out of stock') ||
            text.toLowerCase().includes('unavailable') ||
            text.toLowerCase().includes('sold out')
          )) {
            return false;
          }
        }
      }
      
      // 3. Check for availability indicators
      for (const selector of this.selectors.availability) {
        const element = await page.$(selector);
        if (element) {
          // Check if enabled
          const isDisabled = await page.evaluate(btn => {
            return btn.disabled || 
                   btn.getAttribute('disabled') === 'true' || 
                   btn.classList.contains('disabled') ||
                   btn.style.display === 'none';
          }, element);
          
          if (!isDisabled) {
            return true;
          }
        }
      }
      
      // 4. Check page content for availability indicators
      const availabilityText = await page.evaluate(() => {
        const body = document.body.innerText.toLowerCase();
        
        // Out of stock indicators
        if (body.includes('out of stock') || 
            body.includes('unavailable') || 
            body.includes('sold out') ||
            body.includes('esgotado') || 
            body.includes('indisponível') || 
            body.includes('sem estoque') ||
            body.includes('fora de estoque')) {
          return false;
        }
        
        // In stock indicators
        if (body.includes('in stock') || 
            body.includes('available') || 
            body.includes('em estoque') || 
            body.includes('disponível')) {
          return true;
        }
        
        return null;
      });
      
      if (availabilityText !== null) return availabilityText;
      
      // 5. If we have a price, assume the product is available
      const price = await this._extractPrice(page, structuredData);
      if (price !== null) {
        return true;
      }
      
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
            // Extract brand
            if (item.brand) {
              info.brand = typeof item.brand === 'string' ? item.brand : (item.brand.name || null);
            }
            
            // Extract SKU
            if (item.sku) {
              info.sku = item.sku;
            }
            
            // Extract image
            if (item.image) {
              info.imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
            }
            
            // Extract description
            if (item.description && !info.description) {
              info.description = item.description;
            }
          }
        }
        
        // Check Open Graph
        if (structuredData.openGraph) {
          if (!info.imageUrl && structuredData.openGraph.image) {
            info.imageUrl = structuredData.openGraph.image;
          }
          
          if (!info.description && structuredData.openGraph.description) {
            info.description = structuredData.openGraph.description;
          }
        }
      }
      
      // 2. Extract from DOM
      const domInfo = await page.evaluate(() => {
        const extracted = {};
        
        // Try to get main image
        const imageElement = document.querySelector('[itemprop="image"], .product-image img, .product__image img');
        if (imageElement) {
          extracted.imageUrl = imageElement.getAttribute('src') || imageElement.getAttribute('data-src');
        }
        
        // Try to get seller
        const sellerElement = document.querySelector('[itemprop="seller"], .seller-name, .product-seller, .sold-by');
        if (sellerElement) {
          extracted.seller = sellerElement.textContent.trim();
        }
        
        // Try to get brand
        const brandElement = document.querySelector('[itemprop="brand"], .brand, .product-brand');
        if (brandElement) {
          extracted.brand = brandElement.textContent.trim();
        }
        
        // Try to get specifications table
        const specs = {};
        const specRows = document.querySelectorAll('.specifications tr, .product-specs tr, .product-details tr, [class*="spec"] tr');
        
        specRows.forEach(row => {
          const label = row.querySelector('th') || row.querySelector('td:first-child');
          const value = row.querySelector('td:last-child') || row.querySelector('td:nth-child(2)');
          
          if (label && value && label !== value) {
            const labelText = label.textContent.trim();
            const valueText = value.textContent.trim();
            
            if (labelText && valueText) {
              specs[labelText] = valueText;
              
              // Extract common fields
              if (labelText.toLowerCase().includes('brand') || 
                  labelText.toLowerCase().includes('marca')) {
                extracted.brand = valueText;
              }
              
              if (labelText.toLowerCase().includes('model') || 
                  labelText.toLowerCase().includes('modelo')) {
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
      // Check for common blocking indicators in page content and URL
      const blocked = await page.evaluate(() => {
        const body = document.body.textContent.toLowerCase();
        const url = window.location.href.toLowerCase();
        const title = document.title.toLowerCase();
        
        // Common bot detection keywords
        const botDetectionTerms = [
          'captcha', 
          'robot', 
          'bot', 
          'automated', 
          'challenge', 
          'security check',
          'verificação', 
          'verificacion',
          'human verification',
          'suspicious activity',
          'unusual traffic',
          'access denied',
          'acesso negado',
          'blocked',
          'bloqueado'
        ];
        
        // Check body text for bot detection terms
        const hasBlockingTerms = botDetectionTerms.some(term => body.includes(term));
        
        // Check URL for captcha or verification paths
        const suspiciousUrl = 
          url.includes('/captcha') || 
          url.includes('/challenge') || 
          url.includes('/verify') || 
          url.includes('/security-check') || 
          url.includes('/human');
        
        // Check title for blocking indicators
        const suspiciousTitle = 
          title.includes('captcha') || 
          title.includes('robot') || 
          title.includes('security') || 
          title.includes('verificação') || 
          title.includes('verificacion') ||
          title.includes('blocked') || 
          title.includes('denied');
          
        return hasBlockingTerms || suspiciousUrl || suspiciousTitle;
      });
      
      if (blocked) {
        // Look for specific elements that confirm blocking
        const captchaElements = await page.$$([
          // Common captcha selectors across sites
          'form[action*="captcha"]',
          'img[src*="captcha"]',
          '.captcha-container',
          '.captcha-challenge',
          '.g-recaptcha',
          '[data-sitekey]', // reCAPTCHA attribute
          'iframe[src*="recaptcha"]',
          'iframe[src*="captcha"]',
          // Cloudflare and other services
          '#challenge-form',
          '#challenge-running',
          '.cf-browser-verification',
          // Common text in bot detection elements
          'text="I\'m not a robot"',
          'text="Sou humano"',
          'text="Confirm you are human"',
          'text="Verificação de segurança"'
        ].join(','));
        
        if (captchaElements.length > 0) {
          logger.warn('Detected captcha/challenge on page', { url: page.url() });
          return true;
        }
        
        // Also check for HTTP status indicators through the page
        const status403 = await page.$('.status-code:text("403"), .error-code:text("403")');
        if (status403) {
          logger.warn('Detected 403 error page', { url: page.url() });
          return true;
        }
        
        logger.warn('Potential blocking detected on page', { url: page.url() });
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
      
      // Try to close common popups and accept cookies - more comprehensive list
      const closeSelectors = [
        // Cookie banners - common patterns across many sites
        '.cookie-notice .accept', '.cookie-notice .agree', '.cookie-notice [aria-label*="accept"]',
        '.cookie-banner .accept', '.cookie-banner .agree', '.cookie-banner [aria-label*="accept"]',
        '.cookie-consent .accept', '.cookie-consent .agree', '.cookie-consent [aria-label*="accept"]',
        '.cookies-consent-banner button', 
        '.cookie-consent-banner button',
        '#accept-cookies', '#acceptCookies', '[data-testid="accept-cookies"]',
        '[aria-label="accept cookies"]', '[aria-label="accept all cookies"]',
        '[aria-label="accept and close"]',
        'button:has-text("Accept")', 'button:has-text("Accept Cookies")', 
        'button:has-text("Accept All")', 'button:has-text("Allow cookies")',
        'button:has-text("Aceitar")', 'button:has-text("Aceitar Cookies")',
        'button:has-text("Ok")', 'button:has-text("OK")', 'button:has-text("Continue")',
        // GDPR specific
        '.gdpr-banner .accept', '.gdpr-banner .agree',
        '.gdpr-consent button', '.gdpr-cookie-notice button',
        // Privacy banners
        '.privacy-banner .accept', '.privacy-policy-banner .accept',
        // Newsletter and subscription popups
        '.newsletter-popup .close', '.newsletter-popup-close', '.newsletter-modal .close',
        '.signup-popup .close', '.subscription-popup .close',
        // General modals and popups
        '.modal-close', '.modal .close', '.modal [aria-label="Close"]',
        '.popup-close', '.popup .close', '.popup [aria-label="Close"]',
        '.close-modal', '.dismiss-modal', 
        '.overlay-close', '.overlay .close', 
        '.lightbox-close', '.lightbox .close',
        // Chat widgets
        '.chat-widget-close', '.livechat-close', '.chat-popup .close'
      ];
      
      // Try each selector
      for (const selector of closeSelectors) {
        try {
          const closeButtons = await page.$$(selector);
          for (const button of closeButtons) {
            // Check if the button is visible before clicking
            const isVisible = await button.isVisible();
            if (isVisible) {
              await button.click().catch(() => {});
              // Small wait after clicking to allow animation to complete
              await page.waitForTimeout(300);
            }
          }
        } catch (e) {
          // Ignore errors and continue with next selector
        }
      }
      
      // Also try to press Escape key to close popups
      await page.keyboard.press('Escape').catch(() => {});
      
      // Scroll down to trigger lazy-loaded content
      await page.evaluate(() => {
        // Scroll down smoothly
        const maxScrollY = Math.max(
          document.body.scrollHeight, 
          document.documentElement.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.offsetHeight
        ) * 0.6; // Scroll to 60% of page
        
        // Use smooth scrolling for better simulation
        const scrollStep = Math.floor(maxScrollY / 10);
        let currentScroll = 0;
        
        function smoothScroll() {
          if (currentScroll < maxScrollY) {
            currentScroll = Math.min(currentScroll + scrollStep, maxScrollY);
            window.scrollTo(0, currentScroll);
            setTimeout(smoothScroll, 100);
          }
        }
        
        smoothScroll();
      });
      
      // Wait for dynamic content to load
      await page.waitForTimeout(1500);
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
      
      // Determine format (Brazilian/European vs US)
      // Brazilian/European: R$ 1.234,56 / 1.234,56€
      // US: $1,234.56
      
      const isBrazilianFormat = priceStr.includes('R$') || 
                                /\d{1,3}(?:\.\d{3})+,\d{2}/.test(priceStr);
      
      const isEuropeanFormat = priceStr.includes('€') || 
                               /\d{1,3}(?:\.\d{3})+,\d{2}/.test(priceStr) ||
                               /\d{1,3}(?:,\d{3})+\.\d{2}/.test(priceStr);
      
      if (isBrazilianFormat || isEuropeanFormat) {
        // If both . and , are present, assume . is thousands and , is decimal
        if (clean.includes('.') && clean.includes(',')) {
          clean = clean.replace(/\./g, '').replace(',', '.');
        } 
        // If only , is present, assume it's decimal
        else if (clean.includes(',')) {
          clean = clean.replace(',', '.');
        }
      } else {
        // For US/international format (1,234.56), remove commas
        clean = clean.replace(/,/g, '');
      }
      
      // Parse and validate
      const value = parseFloat(clean);
      if (isNaN(value)) return null;
      
      // Check for unreasonable values (may indicate formatting error)
      if (value > 1000000) {
        // Try to fix by dividing by 100 (common error)
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

module.exports = GenericAdapter;
