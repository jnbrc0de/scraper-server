/**
 * Amazon Adapter
 * Handles extraction from Amazon (amazon.com.br)
 */
const AbstractAdapter = require('./AbstractAdapter');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class AmazonAdapter extends AbstractAdapter {
  constructor() {
    // Parent class requires domain name
    super('amazon');
    
    // List of domains this adapter can handle
    this.domains = [
      'amazon.com.br',
      'amazon.com'
    ];
    
    // CSS selectors for product data extraction
    this.selectors = {
      price: [
        '.a-price .a-offscreen',
        '.a-price-whole',
        '#priceblock_ourprice',
        '#price_inside_buybox',
        '.priceToPay',
        '.a-price',
        '[data-a-color="price"] .a-offscreen',
        '#corePrice_feature_div .a-price .a-offscreen'
      ],
      title: [
        '#productTitle',
        '#title',
        '.product-title-word-break',
        'h1.a-size-large'
      ],
      availability: [
        '#availability',
        '#add-to-cart-button',
        '#buy-now-button',
        '#outOfStock',
        '.availabilityMessage'
      ],
      outOfStock: [
        '#outOfStock',
        '#availability span:contains("indisponível")',
        '#availability span:contains("out of stock")',
        '.out-of-stock'
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
      logger.warn('Amazon page appears to be blocked', { url: page.url() });
      throw new Error('Access blocked by Amazon');
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
      
      // Wait for price element to be visible (Amazon loads prices asynchronously)
      try {
        await page.waitForSelector(this.selectors.price[0], { timeout: 2000 });
      } catch (e) {
        // Continue even if timeout - we'll try other selectors
      }
      
      // Amazon occasionally loads content dynamically - scroll a bit to ensure content loads
      await page.evaluate(() => {
        window.scrollBy(0, 300);
      });
      
      await page.waitForTimeout(500);
      
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
      logger.error('Error extracting data from Amazon page', {
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
          microdata: []
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
        
        // Amazon specific data structures
        const amazonData = {};
        
        // Extract product data from Amazon's global variables
        try {
          if (window.ue_t0) {
            amazonData.ueT0 = window.ue_t0;
          }
          
          if (window.P && window.P.main && window.P.main.cf) {
            amazonData.pmain = window.P.main.cf;
          }
        } catch (e) {
          // Ignore errors
        }
        
        result.amazonData = amazonData;
        
        return Object.keys(result.jsonLd).length > 0 || Object.keys(result.amazonData).length > 0 ? 
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
      if (structuredData && structuredData.jsonLd) {
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
      
      // 2. Extract from DOM selectors - Amazon often has different price formats
      let priceText = null;
      
      // Try whole price + fraction
      for (const selector of this.selectors.price) {
        try {
          const element = await page.$(selector);
          if (element) {
            priceText = await element.textContent();
            if (priceText) {
              const price = this._normalizePrice(priceText);
              if (price) return price;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // 3. Amazon sometimes splits price into whole and fraction parts
      try {
        const wholeElement = await page.$('.a-price-whole');
        const fractionElement = await page.$('.a-price-fraction');
        
        if (wholeElement && fractionElement) {
          const whole = await wholeElement.textContent();
          const fraction = await fractionElement.textContent();
          
          if (whole && fraction) {
            const combinedPrice = `${whole.trim()}${fraction.trim()}`.replace(',', '.');
            return this._normalizePrice(combinedPrice);
          }
        }
      } catch (e) {
        // Continue to other methods
      }
      
      // 4. Try to extract from "buybox" which often contains the price
      try {
        const buyboxPrice = await page.$eval('#buybox', el => {
          const priceElements = el.querySelectorAll('.a-price, .a-color-price');
          for (const element of priceElements) {
            return element.textContent;
          }
          return null;
        });
        
        if (buyboxPrice) {
          return this._normalizePrice(buyboxPrice);
        }
      } catch (e) {
        // Continue to other methods
      }
      
      // 5. Try using regex on the entire page content
      const html = await page.content();
      const priceRegexPatterns = [
        /[RS\$\s](\d+(?:[\.,]\d{2})?)(?!\d)/g,  // Match R$ or $ followed by a number
        /"displayPrice":["']R?\$\s*(\d+(?:[\.,]\d{2}))["']/i,
        /"price":["']R?\$\s*(\d+(?:[\.,]\d{2}))["']/i
      ];
      
      for (const pattern of priceRegexPatterns) {
        const matches = Array.from(html.matchAll(pattern));
        if (matches.length > 0) {
          // Take the first match with a reasonable price
          for (const match of matches) {
            const price = this._normalizePrice(match[1]);
            if (price && price > 1 && price < 100000) {  // Reasonable price range
              return price;
            }
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
      if (structuredData && structuredData.jsonLd) {
        for (const item of structuredData.jsonLd) {
          if (item.name) {
            return item.name;
          }
        }
      }
      
      // 2. Try from product title element (most reliable on Amazon)
      const productTitle = await page.$('#productTitle');
      if (productTitle) {
        const title = await productTitle.textContent();
        if (title) return title.trim();
      }
      
      // 3. Try other title selectors
      for (const selector of this.selectors.title) {
        if (selector === '#productTitle') continue; // Skip if already tried
        
        try {
          const element = await page.$(selector);
          if (element) {
            const title = await element.textContent();
            if (title) return title.trim();
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // 4. Try meta title
      try {
        const metaTitle = await page.$eval('meta[name="title"]', el => el.getAttribute('content'));
        if (metaTitle) return metaTitle;
      } catch (e) {
        // Continue to next method
      }
      
      // 5. Last resort: page title
      return (await page.title()).replace(' - Amazon.com.br', '').replace(' - Amazon.com', '');
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
      // 1. Check for structured data
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
      
      // 2. Check for out of stock indicators
      for (const selector of this.selectors.outOfStock) {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && (
            text.includes('indisponível') || 
            text.includes('out of stock') ||
            text.includes('unavailable') ||
            text.includes('esgotado')) {
            return false;
          }
        }
      }
      
      // 3. Check availability text
      const availabilityElement = await page.$('#availability');
      if (availabilityElement) {
        const text = await availabilityElement.textContent();
        if (text) {
          if (text.includes('Em estoque') || 
              text.includes('in stock') || 
              text.includes('disponível') ||
              text.includes('available')) {
            return true;
          }
          
          if (text.includes('indisponível') || 
              text.includes('out of stock') ||
              text.includes('unavailable') ||
              text.includes('esgotado')) {
            return false;
          }
        }
      }
      
      // 4. Check for buy button
      const buyButton = await page.$('#add-to-cart-button, #buy-now-button');
      if (buyButton) {
        // Check if button is disabled
        const isDisabled = await page.evaluate(button => {
          return button.disabled || 
                 button.classList.contains('a-button-disabled') ||
                 button.style.display === 'none';
        }, buyButton);
        
        return !isDisabled;
      }
      
      // 5. If we have a price, assume it's available
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
      if (structuredData && structuredData.jsonLd) {
        for (const item of structuredData.jsonLd) {
          if (item.brand) {
            info.brand = typeof item.brand === 'string' ? item.brand : item.brand.name;
          }
          
          if (item.sku && !info.sku) {
            info.sku = item.sku;
          }
          
          if (item.mpn && !info.mpn) {
            info.mpn = item.mpn;
          }
          
          if (item.image) {
            info.imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
          }
        }
      }
      
      // 2. Extract from DOM
      const domInfo = await page.evaluate(() => {
        const extracted = {};
        
        // Get ASIN (Amazon's unique identifier)
        const asinElement = document.querySelector('#ASIN, input[name="ASIN"]');
        if (asinElement) {
          extracted.asin = asinElement.value;
        }
        
        // Get brand
        const brandElement = document.querySelector('#bylineInfo, .po-brand');
        if (brandElement) {
          extracted.brand = brandElement.textContent.trim().replace('Brand: ', '').replace('Marca: ', '');
        }
        
        // Get main image URL
        const imageElement = document.querySelector('#landingImage, #imgBlkFront');
        if (imageElement) {
          extracted.imageUrl = imageElement.getAttribute('src') || imageElement.getAttribute('data-a-dynamic-image');
          
          // Amazon stores image data in a JSON object
          if (extracted.imageUrl && extracted.imageUrl.startsWith('{')) {
            try {
              const imageData = JSON.parse(extracted.imageUrl);
              extracted.imageUrl = Object.keys(imageData)[0]; // Get first image URL
            } catch (e) {
              // Ignore parse error
            }
          }
        }
        
        // Get seller info
        const sellerElement = document.querySelector('#merchant-info, #buybox-tabular .tabular-buybox-text[tabular-attribute-name="Sold by"]');
        if (sellerElement) {
          extracted.seller = sellerElement.textContent.trim().replace('Sold by ', '').replace('Vendido por ', '');
        }
        
        // Get specifications
        const specTable = document.querySelector('.detail-bullet-list, .a-spacing-top-base, .prodDetTable');
        if (specTable) {
          const specs = {};
          const rows = Array.from(specTable.querySelectorAll('tr, li, .a-list-item'));
          
          rows.forEach(row => {
            let label, value;
            
            if (row.querySelector('.a-text-right, .a-span3')) {
              label = row.querySelector('.a-text-right, .a-span3');
              value = row.querySelector('.a-text-left, .a-span9');
            } else if (row.textContent.includes(':')) {
              // Detail bullets format (label: value)
              const parts = row.textContent.split(':');
              if (parts.length >= 2) {
                label = { textContent: parts[0] };
                value = { textContent: parts.slice(1).join(':') };
              }
            }
            
            if (label && value) {
              const labelText = label.textContent.trim();
              const valueText = value.textContent.trim();
              
              if (labelText && valueText) {
                specs[labelText] = valueText;
              }
            }
          });
          
          if (Object.keys(specs).length > 0) {
            extracted.specifications = specs;
          }
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
      // Amazon has various bot protection systems
      const blocked = await page.evaluate(() => {
        const body = document.body.textContent.toLowerCase();
        
        // Check for captcha and robot check pages
        return body.includes('captcha') || 
               body.includes('robot check') || 
               body.includes('verificação de robôs') ||
               body.includes('verificação de segurança') ||
               body.includes('automatic suspicious activity') ||
               body.includes('blocked');
      });
      
      if (blocked) {
        // Check URL - Amazon often redirects to a captcha page
        const url = page.url();
        if (url.includes('/captcha/') || url.includes('/ap/verify')) {
          logger.warn('Redirected to Amazon captcha page', { url });
          return true;
        }
        
        // Check for captcha image
        const captchaImg = await page.$('img[src*="captcha"]');
        if (captchaImg) {
          logger.warn('Detected Amazon captcha challenge', { url: page.url() });
          return true;
        }
        
        logger.warn('Detected blocking on Amazon page', { url: page.url() });
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
      // Wait for essential content
      await page.waitForLoadState('domcontentloaded');
      
      // Close any modals or popups
      const closeSelectors = [
        '#a-popover-lgtbox #a-popover-close',
        '.a-popover-close',
        '#sp-cc-accept', // Cookie consent
        '#a-autoid-0' // Location popup
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
      
      // Decline language change if prompted
      try {
        const stayButton = await page.$('input[data-action-type="DISMISS"]');
        if (stayButton) {
          await stayButton.click().catch(() => {});
        }
      } catch (e) {
        // Ignore errors and continue
      }
      
      // Scroll to trigger lazy-loaded content (especially important for prices)
      await page.evaluate(() => {
        window.scrollBy(0, 300);
      });
      
      // Wait briefly for dynamic content to load
      await page.waitForTimeout(1000);
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
                                priceStr.includes('BRL') || 
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
      
      // Parse and check for validity
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

module.exports = AmazonAdapter; 