/**
 * Generic Adapter
 * Fallback adapter that attempts to extract data from any e-commerce site
 * using common patterns and selectors
 */
const AbstractAdapter = require('./AbstractAdapter');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const config = require('../config');
const { withRetry } = require('../utils/retry');

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
        'meta[itemprop="price"]',
        'meta[property="product:price:amount"]',
        'meta[property="og:price:amount"]',
        'meta[name="twitter:data1"]',
        // Common price selectors across e-commerce sites
        '.price',
        '.product-price',
        '.price-current',
        '.sales-price',
        '.current-price',
        '.new-price',
        '.main-price',
        '.price-value',
        '.price__value',
        '.product__price',
        '.offer-price',
        '.promotion-price',
        '.card__price',
        '.final-price',
        '.actual-price',
        '.price-box',
        '.price-container',
        '.product-page-price',
        '.special-price',
        '.product-price-value',
        // Brazilian e-commerce specific selectors
        '.preco-produto',
        '.precoPor',
        '.valor-por',
        '.preco-promocional',
        '.preco-vista',
        '.price-boleto',
        '.precoPix',
        '.preco-a-vista',
        '.valorpix',
        '.product-price__best-price',
        // JSON-LD selectors
        'script[type="application/ld+json"]'
      ],
      title: [
        // Standard meta tags
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'meta[itemprop="name"]',
        // Common title selectors
        'h1.product-name',
        'h1.product-title',
        'h1.title',
        'h1.page-title',
        '.product-title',
        '.product-name',
        '.product__name',
        '.product__title',
        '#productTitle',
        '.title-product',
        '.product-header',
        '.main-title',
        // Brazilian e-commerce specific selectors
        '.nome-produto',
        '.product-name-title',
        '.titulo-produto',
        '.product-info-name',
        '.prodTitle',
        // Schema.org standard
        '[itemprop="name"]'
      ],
      availability: [
        // Schema.org standard
        '[itemprop="availability"]',
        'meta[itemprop="availability"]',
        'link[itemprop="availability"]',
        // Common out of stock indicators
        '.out-of-stock',
        '.sold-out',
        '.unavailable',
        '.not-available',
        '.availability-status',
        '.stock-status',
        '.product-availability',
        // Brazilian out of stock indicators
        '.produto-indisponivel',
        '.indisponivel',
        '.sem-estoque',
        '.avise-me',
        '.produto-esgotado',
        // In stock indicators
        '.in-stock',
        '.available',
        '.stock-available',
        '.produto-disponivel',
        '.comprar',
        '.buy-button',
        '.add-to-cart'
      ],
      // Image selectors for product images
      image: [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[itemprop="image"]',
        '[itemprop="image"]',
        '#product-image',
        '.product-image',
        '.main-image',
        '.product-photo',
        '.product-featured-image',
        '.zoom-image',
        '.foto-produto-principal',
        '.product-image-zoom',
        '.full-image'
      ]
    };
    
    // Common patterns for price extraction using regex
    this.pricePatterns = [
      // Match Brazilian price formats (BRL): R$ 1.234,56 
      /R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i,
      // Match dollar formats: $1,234.56
      /\$\s?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i,
      // Match price with currency codes
      /(BRL|USD|EUR)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d{1,3}(?:\.\d{3})*(?:,\d{2}))/i,
      // Match prices that come after specific words (Brazilian sites)
      /(?:preço|preco|valor|por|apenas|de)(?:\s+por)?(?:\s+apenas)?(?:\s+R\$)?(?:\s+-)?\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i,
      // Match prices that have common Brazilian payment terms
      /(?:à vista|avista|pix|boleto)(?:\s+por)?(?:\s+R\$)?\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i,
      // Match numbers with exactly 2 decimal places, common price format 
      /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/
    ];
    
    // Configure blacklist patterns to avoid extracting wrong prices
    this.priceBlacklist = [
      /parcela/i,
      /installment/i,
      /prestação/i,
      /pagamento/i,
      /payment/i,
      /frete/i,
      /shipping/i,
      /entrega/i,
      /delivery/i,
      /juros/i, // interest
      /desconto\s+de/i, // discount of
      /cashback/i,
      /pontos?/i, // points
      /milhas?/i, // miles
      /código/i, // code
      /cupom/i, // coupon
      /cep/i, // zip code
      /avaliações/i, // ratings
      /estoque/i // stock
    ];
    
    // Keywords that indicate product availability
    this.availabilityKeywords = {
      inStock: [
        'in stock', 'em estoque', 'disponível', 'available', 'in-stock',
        'disponibilidade imediata', 'pronta entrega', 'comprar', 'compre agora',
        'adicionar ao carrinho', 'add to cart', 'buy now', 'comprar agora',
        'disponível para compra', 'produto disponível', 'disponível em',
        'em estoque em', 'entrega', 'frete', 'calcular frete', 'envio'
      ],
      outOfStock: [
        'out of stock', 'fora de estoque', 'indisponível', 'unavailable', 'out-of-stock',
        'produto esgotado', 'sem estoque', 'sold out', 'not available',
        'avise-me quando chegar', 'notify me', 'produto indisponível', 'esgotado',
        'não disponível', 'aguardando reposição', 'me avise', 'avise-me',
        'produto sob encomenda', 'sob consulta'
      ]
    };
    
    // Initialize cache for reducing redundant processing
    this._cache = new Map();
    
    // Store extraction statistics
    this.stats = {
      totalAttempts: 0,
      successfulExtractions: 0,
      failedExtractions: 0,
      priceFoundMethods: {},
      fallbacksUsed: 0
    };
  }

  /**
   * Determines if this adapter can handle the given URL
   * @param {string} url - URL to check
   * @returns {boolean} - True for any URL since this is a fallback adapter
   */
  canHandle(url) {
    // Generic adapter is designed to handle any e-commerce site
    // It should be used as a last resort when no specific adapter matches
    
    // Skip if URL is missing or invalid
    if (!url) return false;
    
    try {
      // Parse URL to get domain
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      
      // Avoid handling known non-e-commerce sites
      const nonEcommercePatterns = [
        /google\.com$/i,
        /facebook\.com$/i,
        /instagram\.com$/i,
        /twitter\.com$/i,
        /youtube\.com$/i,
        /linkedin\.com$/i,
        /pinterest\.com$/i,
        /reddit\.com$/i,
        /wikipedia\.org$/i,
        /github\.com$/i,
        /mail\./i,
        /webmail/i,
        /gov\./i,
        /email/i,
        /login/i,
        /signin/i,
        /conta/i,
        /admin/i
      ];
      
      for (const pattern of nonEcommercePatterns) {
        if (pattern.test(domain)) {
          return false;
        }
      }
      
      // Check if URL path contains product-like indicators
      const path = urlObj.pathname.toLowerCase();
      const productIndicators = [
        '/p/', '/produto/', '/product/', '/item/', '/detalhe/', '/pd/', 
        '/prod/', '/productdetails', '/productdetail', 'comprar'
      ];
      
      // For product-like URLs, this adapter should handle them
      for (const indicator of productIndicators) {
        if (path.includes(indicator)) {
          return true;
        }
      }
      
      // For all other URLs, the generic adapter will handle them but with lower confidence
      return true;
    } catch (error) {
      logger.error('Error in GenericAdapter.canHandle', { url }, error);
      return false;
    }
  }
  
  /**
   * Pre-process page to handle cookie banners, popups, etc
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<void>}
   */
  async preProcess(page) {
    try {
      // Set a reasonable timeout
      const timeout = config.adapter.preProcessTimeout || 15000;
      
      // Wait for page to load with retry mechanism
      await withRetry(
        async () => {
          await page.waitForLoadState('domcontentloaded', { timeout: timeout / 2 });
          
          // Wait for some meaningful content to appear (a product-related element)
          const contentSelectors = [
            // Common product indicators
            '.product', '.product-info', '.product-details', 
            '.product-page', '.product-main', '.product-container',
            '#product', '[itemprop="product"]', '[itemtype*="Product"]',
            // Brazilian site selectors
            '.produto', '.detalhe-produto', '.detalhes-produto', 
            '.ficha-produto', '.pagina-produto'
          ];
          
          // Try to find at least one content element
          for (const selector of contentSelectors) {
            const element = await page.$(selector);
            if (element) {
              logger.debug('Found product content element', { selector });
              return; // Found a content element, can proceed
            }
          }
          
          // If no specific element found, wait for any price-like content
          await page.waitForSelector(this.selectors.price.join(','), { 
            timeout: timeout / 2,
            state: 'attached'
          }).catch(() => {}); // Ignore errors, we'll try other methods
        }, 
        { 
          retries: 2, 
          operationName: 'GenericAdapter.preProcess.waitForContent',
          context: { url: page.url() }
        }
      ).catch(() => {
        // If we fail to find content, just continue with what we have
        logger.warn('Could not find specific product content, continuing with page as-is');
      });
      
      // Handle cookie banners and popups with retry and multiple approaches
      await this._handleOverlays(page, timeout);
      
      // Scroll page to reveal lazy-loaded content
      await this._scrollPageToRevealContent(page);
      
    } catch (error) {
      // Log but don't fail the entire extraction for preprocessing issues
      logger.warn('Error in GenericAdapter preprocessing', {
        url: page.url(),
        message: error.message
      });
    }
  }

  /**
   * Handle overlays, cookie banners, and popups
   * @param {import('playwright').Page} page - Playwright page
   * @param {number} timeout - Timeout in ms
   * @private
   */
  async _handleOverlays(page, timeout) {
    // Common cookie banner accept buttons
    const bannerSelectors = [
      'button[id*="cookie" i]',
      'button[class*="cookie" i]',
      'button[id*="accept" i]',
      'button[class*="accept" i]',
      '[id*="cookie" i] button',
      '[class*="cookie" i] button',
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("Aceitar")',
      'button:has-text("Aceitar Todos")',
      // Common Brazilian e-commerce consent buttons
      'button:has-text("Continuar e fechar")',
      'button:has-text("Entendido")',
      'button:has-text("Concordo")',
      'button:has-text("Fechar")',
      'button:has-text("Pular")',
      'a:has-text("Fechar")',
      'a:has-text("Pular")',
      'a:has-text("Entendi")',
      '.close-button',
      '.btn-close',
      '.fechar',
      '.close-modal',
      '.modal-close',
      '.popup-close'
    ];
    
    // Try multiple methods to handle overlays
    try {
      // Method 1: Click buttons using Playwright selectors
      for (const selector of bannerSelectors) {
        const button = await page.$(selector);
        if (button) {
          await button.click().catch(() => {});
          logger.debug('Clicked overlay element', { selector });
          await page.waitForTimeout(500); // Short wait to let overlay disappear
        }
      }
      
      // Method 2: Evaluate script to remove common overlay elements
      await page.evaluate(() => {
        // Common overlay class/id patterns
        const overlayPatterns = [
          'cookie', 'banner', 'popup', 'modal', 'overlay', 'newsletter',
          'lightbox', 'notification', 'consent', 'dialog', 'alert', 'welcome',
          'popup-container', 'modal-container', 'cookie-notice', 'cookie-banner',
          'aviso-cookie', 'cookie-consent', 'gdpr', 'privacy-alert', 'subscribe',
          'inscreva', 'cadastro', 'popup-newsletter'
        ];
        
        // Remove elements that match overlay patterns
        overlayPatterns.forEach(pattern => {
          document.querySelectorAll(`[class*="${pattern}" i], [id*="${pattern}" i]`).forEach(el => {
            // Only remove if it looks like an overlay (fixed position, high z-index)
            const style = window.getComputedStyle(el);
            if (style.position === 'fixed' || 
                style.position === 'absolute' || 
                parseInt(style.zIndex) > 100) {
              el.remove();
            }
          });
        });
        
        // Remove fixed/absolute positioned elements at the top level that cover significant portion of the page
        document.querySelectorAll('body > *').forEach(el => {
          const style = window.getComputedStyle(el);
          if ((style.position === 'fixed' || style.position === 'absolute') && 
              style.zIndex && parseInt(style.zIndex) > 100) {
            
            // Check if element covers significant portion of viewport
            const rect = el.getBoundingClientRect();
            const viewportArea = window.innerWidth * window.innerHeight;
            const elementArea = rect.width * rect.height;
            
            if (elementArea > viewportArea * 0.2) { // If covers more than 20% of viewport
              el.style.display = 'none';
            }
          }
        });
        
        // Reset body overflow to allow scrolling if it was blocked
        document.body.style.overflow = 'auto';
      });
      
    } catch (error) {
      logger.debug('Error handling overlays', { message: error.message });
    }
  }
  
  /**
   * Scroll page to ensure lazy-loaded content is loaded
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<void>}
   * @private
   */
  async _scrollPageToRevealContent(page) {
    try {
      // Evaluate scroll script with retry
      await withRetry(
        async () => {
          // Scroll to reveal any lazy-loaded content
          return await page.evaluate(async () => {
            // Get initial document height
            const getDocHeight = () => Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight
            );
            
            const viewportHeight = window.innerHeight;
            let lastHeight = getDocHeight();
            let totalScrolled = 0;
            
            // Scroll down in steps to trigger lazy loading
            for (let i = 0; i < 6; i++) {
              const scrollTarget = Math.min(totalScrolled + viewportHeight, lastHeight);
              window.scrollTo(0, scrollTarget);
              totalScrolled = scrollTarget;
              
              // Wait briefly for content to potentially load
              await new Promise(r => setTimeout(r, 300));
              
              // Check if we've reached the bottom or content isn't expanding
              const newHeight = getDocHeight();
              if (totalScrolled >= newHeight || newHeight === lastHeight) {
                break;
              }
              lastHeight = newHeight;
            }
            
            // Return to product details section (likely top of page but not absolute top)
            window.scrollTo(0, Math.min(500, lastHeight * 0.2));
            
            return { 
              scrolled: totalScrolled,
              finalHeight: lastHeight
            };
          });
        },
        {
          retries: 1,
          operationName: 'GenericAdapter.scrollPage',
          context: { url: page.url() }
        }
      );
    } catch (error) {
      logger.debug('Error scrolling page', { message: error.message });
    }
  }
  
  /**
   * Main extraction method for e-commerce product details
   * @param {import('playwright').Page} page - Playwright page object
   * @returns {Promise<Object>} - Extracted data object
   */
  async extract(page) {
    try {
      // First handle any preprocessing needed for this site
      await this.preProcess(page);
      
      // Extract data from the page
      const price = await this.extractPrice(page);
      const title = await this.extractTitle(page);
      const availability = await this.extractAvailability(page);
      
      // Try to identify product information from JSON-LD data
      const jsonLdData = await this._extractJsonLdData(page);
      
      // Combine data with preference for explicitly extracted values
      return {
        price: price || (jsonLdData?.price ? this.normalizePrice(jsonLdData.price) : null),
        title: title || jsonLdData?.name || null,
        availability: availability !== null ? availability : (jsonLdData?.availability ? 
          this._parseAvailabilityFromJsonLd(jsonLdData.availability) : true),
        currency: jsonLdData?.priceCurrency || null,
        metadata: {
          url: page.url(),
          domain: this._extractDomain(page.url()),
          extractedAt: new Date().toISOString(),
          adapter: 'GenericAdapter'
        }
      };
    } catch (error) {
      logger.error('Error extracting data using GenericAdapter', {
        url: page.url(),
        domain: this._extractDomain(page.url())
      }, error);
      
      throw new Error(`Generic extraction failed: ${error.message}`);
    }
  }
  
  /**
   * Extract price from the page
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<number|null>} - Extracted price or null
   */
  async extractPrice(page) {
    try {
      // Try to extract price using selectors
      let price = await this._extractPriceFromSelectors(page);
      
      // If not found, try to extract from HTML content with regex
      if (!price) {
        price = await this._extractPriceFromHtml(page);
      }
      
      // If still not found, try to extract from meta tags
      if (!price) {
        price = await this._extractPriceFromMeta(page);
      }
      
      // If found, normalize and return
      if (price) {
        return this.normalizePrice(price);
      }
      
      return null;
    } catch (error) {
      logger.warn('Error extracting price with GenericAdapter', { url: page.url() }, error);
      return null;
    }
  }
  
  /**
   * Extract price from selectors
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<string|null>} - Raw price string or null
   * @private
   */
  async _extractPriceFromSelectors(page) {
    for (const selector of this.selectors.price) {
      // Skip JSON-LD selector as it's handled differently
      if (selector.includes('application/ld+json')) continue;
      
      try {
        const element = await page.$(selector);
        if (element) {
          // Try to extract from content attribute first (for meta tags)
          const priceFromContent = await element.getAttribute('content');
          if (priceFromContent) {
            const normalizedPrice = this._cleanPriceString(priceFromContent);
            if (this._isValidPrice(normalizedPrice)) {
              return normalizedPrice;
            }
          }
          
          // If not in content, get text content
          const text = await element.textContent();
          if (text) {
            const normalizedPrice = this._cleanPriceString(text);
            if (this._isValidPrice(normalizedPrice)) {
              return normalizedPrice;
            }
          }
        }
      } catch (e) {
        // Continue to next selector on error
      }
    }
    
    return null;
  }
  
  /**
   * Extract price from HTML using regex patterns
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<string|null>} - Raw price string or null
   * @private
   */
  async _extractPriceFromHtml(page) {
    try {
      // Get price-related parts of the HTML
      const priceHtml = await page.evaluate(() => {
        const elements = [];
        
        // Find elements with price-related keywords
        const priceKeywords = ['price', 'preço', 'valor', 'oferta', 'promocao', 'promo'];
        
        for (const keyword of priceKeywords) {
          // Search in id, class, and data attributes
          document.querySelectorAll(`[id*="${keyword}" i], [class*="${keyword}" i], [data-*="${keyword}" i]`)
            .forEach(el => elements.push(el.outerHTML));
        }
        
        return elements.join(' ');
      });
      
      if (!priceHtml) return null;
      
      // Apply regex patterns to find price
      for (const pattern of this.pricePatterns) {
        const match = priceHtml.match(pattern);
        if (match && match[1]) {
          const priceStr = match[1];
          
          // Check if price is in a blacklisted context (e.g., "parcela de R$ 99,90")
          let isBlacklisted = false;
          for (const blacklistPattern of this.priceBlacklist) {
            // Get 50 characters before and after the price for context
            const startIdx = Math.max(0, priceHtml.indexOf(priceStr) - 50);
            const endIdx = Math.min(priceHtml.length, priceHtml.indexOf(priceStr) + priceStr.length + 50);
            const context = priceHtml.substring(startIdx, endIdx);
            
            if (blacklistPattern.test(context)) {
              isBlacklisted = true;
              break;
            }
          }
          
          if (!isBlacklisted && this._isValidPrice(priceStr)) {
            return priceStr;
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.debug('Error extracting price from HTML', { url: page.url() }, error);
      return null;
    }
  }
  
  /**
   * Extract price from meta tags
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<string|null>} - Raw price string or null
   * @private
   */
  async _extractPriceFromMeta(page) {
    const metaSelectors = [
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[property="product:price"]',
      'meta[name="twitter:data1"]'
    ];
    
    for (const selector of metaSelectors) {
      try {
        const content = await page.$eval(selector, el => el.getAttribute('content'));
        if (content && this._isValidPrice(content)) {
          return content;
        }
      } catch (e) {
        // Continue to next selector on error
      }
    }
    
    return null;
  }
  
  /**
   * Extract title from the page
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<string|null>} - Product title or null
   */
  async extractTitle(page) {
    try {
      // Try to extract title from selectors
      for (const selector of this.selectors.title) {
        try {
          if (selector.startsWith('meta')) {
            // For meta tags, get content attribute
            const content = await page.$eval(selector, el => el.getAttribute('content'));
            if (content) return content.trim();
          } else {
            // For regular elements, get text content
            const text = await page.$eval(selector, el => el.textContent);
            if (text) return text.trim();
          }
        } catch (e) {
          // Continue to next selector on error
        }
      }
      
      // If not found from selectors, try common title patterns
      try {
        // Try to get from document title with common patterns
        const pageTitle = await page.title();
        if (pageTitle) {
          // Remove common separators and site names
          const cleanedTitle = pageTitle
            .replace(/[|\-–—]\s*[\w\s]+\.[a-z]{2,}$/, '') // Remove site name after separator
            .replace(/[|\-–—].*?compre\s+online/, '') // Remove "| Compre online" etc.
            .replace(/[|\-–—].*?Comprar\s+na\s+[\w\s]+/, '') // Remove "| Comprar na Amazon" etc.
            .trim();
            
          if (cleanedTitle) return cleanedTitle;
        }
      } catch (e) {
        // Fallback to other methods on error
      }
      
      // Last resort: try using h1 elements (most product pages have the title as h1)
      try {
        const h1Text = await page.$eval('h1', el => el.textContent);
        if (h1Text) return h1Text.trim();
      } catch (e) {
        // No h1 found or other error
      }
      
      return null;
    } catch (error) {
      logger.warn('Error extracting title with GenericAdapter', { url: page.url() }, error);
      return null;
    }
  }
  
  /**
   * Extract availability information
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<boolean|null>} - true if available, false if unavailable, null if unknown
   */
  async extractAvailability(page) {
    try {
      // Try to extract from schema.org markup first
      try {
        const availability = await page.$eval('[itemprop="availability"]', el => {
          return el.getAttribute('href') || el.getAttribute('content') || el.textContent;
        });
        
        if (availability) {
          if (availability.includes('InStock') || availability.includes('in stock')) {
            return true;
          } else if (availability.includes('OutOfStock') || availability.includes('out of stock')) {
            return false;
          }
        }
      } catch (e) {
        // No schema.org markup found, continue to other methods
      }
      
      // Check for common out-of-stock indicators
      for (const selector of this.selectors.availability) {
        try {
          if (await page.$(selector)) {
            const text = await page.$eval(selector, el => el.textContent.toLowerCase());
            
            // Check against out-of-stock keywords
            for (const keyword of this.availabilityKeywords.outOfStock) {
              if (text.includes(keyword.toLowerCase())) {
                return false;
              }
            }
            
            // Check against in-stock keywords
            for (const keyword of this.availabilityKeywords.inStock) {
              if (text.includes(keyword.toLowerCase())) {
                return true;
              }
            }
            
            // If there's an availability element but no clear status, check for specific text
            if (selector.includes('availability') || selector.includes('stock')) {
              // If element found is related to stock status but ambiguous, 
              // inspect add-to-cart buttons as fallback
              break;
            }
          }
        } catch (e) {
          // Continue to next selector on error
        }
      }
      
      // Check for add-to-cart buttons (presence usually indicates availability)
      try {
        const cartButtonSelectors = [
          'button[id*="add-to-cart" i]',
          'button[class*="add-to-cart" i]',
          'button[id*="addtocart" i]',
          'button[class*="addtocart" i]',
          'button[id*="comprar" i]',
          'button[class*="comprar" i]',
          'a[id*="add-to-cart" i]',
          'a[class*="add-to-cart" i]',
          'a[id*="comprar" i]',
          'a[class*="comprar" i]',
          '[id*="buy-now" i]',
          '[class*="buy-now" i]',
          '[id*="buy-button" i]',
          '[class*="buy-button" i]'
        ];
        
        for (const selector of cartButtonSelectors) {
          const isDisabled = await page.evaluate(sel => {
            const button = document.querySelector(sel);
            return button ? button.disabled || button.classList.contains('disabled') : true;
          }, selector);
          
          if (!isDisabled) {
            // Found an enabled add-to-cart button
            return true;
          }
        }
      } catch (e) {
        // Continue with other checks on error
      }
      
      // Look for specific out-of-stock texts in the page content
      const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
      
      for (const keyword of this.availabilityKeywords.outOfStock) {
        if (pageText.includes(keyword.toLowerCase())) {
          return false;
        }
      }
      
      // Default to available if we couldn't determine otherwise
      // (most product pages show products that are available)
      return true;
    } catch (error) {
      logger.warn('Error extracting availability with GenericAdapter', { url: page.url() }, error);
      return null;
    }
  }
  
  /**
   * Extract structured data from JSON-LD scripts
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<Object|null>} - JSON-LD data or null
   * @private
   */
  async _extractJsonLdData(page) {
    try {
      const jsonLdData = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent);
            
            // Look for product data in various formats
            if (data['@type'] === 'Product') {
              return data;
            } else if (data['@graph']) {
              // Find product in graph
              const product = data['@graph'].find(item => item['@type'] === 'Product');
              if (product) return product;
            } else if (Array.isArray(data) && data.some(item => item['@type'] === 'Product')) {
              return data.find(item => item['@type'] === 'Product');
            }
          } catch (e) {
            // Ignore parsing errors and continue
          }
        }
        
        return null;
      });
      
      if (!jsonLdData) return null;
      
      // Extract relevant product data
      const result = {
        name: jsonLdData.name,
        description: jsonLdData.description,
        availability: null,
        price: null,
        priceCurrency: null,
        image: null
      };
      
      // Extract price information
      if (jsonLdData.offers) {
        const offers = Array.isArray(jsonLdData.offers) ? 
          jsonLdData.offers[0] : jsonLdData.offers;
        
        if (offers) {
          result.price = offers.price || null;
          result.priceCurrency = offers.priceCurrency || null;
          result.availability = offers.availability || null;
        }
      }
      
      // Extract image
      if (jsonLdData.image) {
        if (typeof jsonLdData.image === 'string') {
          result.image = jsonLdData.image;
        } else if (Array.isArray(jsonLdData.image) && jsonLdData.image.length > 0) {
          result.image = jsonLdData.image[0];
        } else if (jsonLdData.image.url) {
          result.image = jsonLdData.image.url;
        }
      }
      
      return result;
    } catch (error) {
      logger.debug('Error extracting JSON-LD data', { url: page.url() }, error);
      return null;
    }
  }
  
  /**
   * Parse availability string from JSON-LD
   * @param {string} availability - Availability string from JSON-LD
   * @returns {boolean} - true if available, false if not
   * @private
   */
  _parseAvailabilityFromJsonLd(availability) {
    if (!availability) return true;
    
    const availabilityString = availability.toLowerCase();
    
    if (availabilityString.includes('instock') || 
        availabilityString.includes('in stock') ||
        availabilityString.includes('available')) {
      return true;
    }
    
    if (availabilityString.includes('outofstock') ||
        availabilityString.includes('out of stock') ||
        availabilityString.includes('unavailable') ||
        availabilityString.includes('soldout') ||
        availabilityString.includes('sold out')) {
      return false;
    }
    
    return true; // Default to available
  }
  
  /**
   * Clean price string and remove non-numeric characters except for decimal separator
   * @param {string} price - Price string to clean
   * @returns {string} - Cleaned price string
   * @private
   */
  _cleanPriceString(price) {
    if (!price) return '';
    
    // Convert to string if it's not already
    const priceString = String(price);
    
    // Remove currency symbols, spaces, and other non-numeric characters
    // Keep only digits, commas, dots, and semicolons (some sites use semicolons as separators)
    let cleanedPrice = priceString.replace(/[^0-9,.\s]/g, '').trim();
    
    // Handle Brazilian price format (R$ 1.234,56)
    if (cleanedPrice.includes(',') && (cleanedPrice.includes('.') || cleanedPrice.length > 6)) {
      // Remove all dots (thousand separators)
      cleanedPrice = cleanedPrice.replace(/\./g, '');
      // Replace comma with dot for decimal
      cleanedPrice = cleanedPrice.replace(',', '.');
    }
    
    return cleanedPrice;
  }
  
  /**
   * Check if a price string is valid
   * @param {string} price - Price string to validate
   * @returns {boolean} - True if valid
   * @private
   */
  _isValidPrice(price) {
    if (!price) return false;
    
    // Convert to number for validation
    const numericPrice = parseFloat(price);
    
    // Check if conversion worked and price is a positive number
    if (isNaN(numericPrice) || numericPrice <= 0) {
      return false;
    }
    
    // Validate against reasonable range for e-commerce products
    // Very low or extremely high values are likely errors
    if (numericPrice < 0.1 || numericPrice > 1000000) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Normalize price from string to number
   * @param {string|number} price - Price to normalize
   * @returns {number|null} - Normalized price
   */
  normalizePrice(price) {
    if (price === null || price === undefined) return null;
    
    // If already a number, return it
    if (typeof price === 'number') return price;
    
    // Clean the price string
    const cleanedPrice = this._cleanPriceString(price);
    
    // Convert to number
    const numericPrice = parseFloat(cleanedPrice);
    
    if (isNaN(numericPrice) || numericPrice <= 0) {
      return null;
    }
    
    return numericPrice;
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
    } catch (e) {
      // Return empty string if URL parsing fails
      return '';
    }
  }
}

module.exports = GenericAdapter;
