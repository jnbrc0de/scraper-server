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
        '.price__Price',
        '[data-testid="price-value"]',
        '.product-main-info__PriceInfo'
      ],
      title: [
        '[itemprop="name"]',
        '.product-name',
        '.product__title',
        '.productName',
        'h1.name',
        '[data-testid="product-title"]',
        '.product-title'
      ],
      availability: [
        '[itemprop="availability"]',
        '.buybox__buybutton-wrapper',
        '.product__quantity',
        '[data-testid="add-to-cart"]'
      ],
      outOfStock: [
        '.product-unavailable',
        '.unavailable',
        '.product-unavailable-buy-box',
        '[data-testid="unavailable-message"]',
        '.sold-out-message'
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
      logger.warn('Via Varejo page appears to be blocked', { url: page.url() });
      throw new Error('Access blocked by Via Varejo site');
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
      
      // Get structured data
      const structuredData = await this.extractStructuredData(page);
      
      // Extract main data - run in parallel for efficiency
      const [price, title, availability, productInfo] = await Promise.all([
        this.extractPrice(page, structuredData),
        this.extractTitle(page, structuredData),
        this.extractAvailability(page, structuredData),
        this.extractProductInfo(page, structuredData)
      ]);
      
      // Build result
      const result = {
        price,
        title,
        availability,
        ...productInfo,
        structuredData: structuredData ? true : false, // Don't store full structure, just flag
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
   * @param {Object} [structuredData] - Pre-extracted structured data if available
   * @returns {Promise<number|null>} - Extracted price or null
   */
  async extractPrice(page, structuredData = null) {
    try {
      // Tenta extrair com métodos em ordem de confiabilidade
      
      // 1. Tenta extrair do structured data (já fornecido ou extrai agora)
      let priceFromStructured = null;
      if (structuredData) {
        priceFromStructured = this._extractPriceFromStructuredData(structuredData);
        if (priceFromStructured) {
          logger.debug('Price extracted from structured data', { price: priceFromStructured });
          return priceFromStructured;
        }
      }
      
      // 2. Tenta acessar APIs internas do site que podem ter o preço
      try {
        const apiPrice = await this._extractPriceFromAPI(page);
        if (apiPrice) {
          logger.debug('Price extracted from API', { price: apiPrice });
          return apiPrice;
        }
      } catch (e) {
        // Ignora erro e tenta os próximos métodos
      }
      
      // 3. Tenta selectors do DOM em ordem de prioridade
      const priceFromDOM = await this._extractPriceFromDOM(page);
      if (priceFromDOM) {
        logger.debug('Price extracted from DOM', { price: priceFromDOM });
        return priceFromDOM;
      }
      
      // 4. Tenta variáveis globais de JavaScript
      try {
        const jsPrice = await page.evaluate(() => {
          // Procura em diferentes variáveis globais comuns
          if (window.skuJson && window.skuJson.skus && window.skuJson.skus[0]) {
            return window.skuJson.skus[0].bestPrice;
          }
          
          if (window.__PRELOADED_STATE__ && window.__PRELOADED_STATE__.product) {
            return window.__PRELOADED_STATE__.product.price;
          }
          
          if (window.__APOLLO_STATE__) {
            const priceObj = Object.values(window.__APOLLO_STATE__).find(v => v && v.price);
            if (priceObj) return priceObj.price;
          }
          
          if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.product) {
            return window.__INITIAL_STATE__.product.price;
          }
          
          if (window.digitalData && window.digitalData.product) {
            return window.digitalData.product.price;
          }
          
          return null;
        });

        if (jsPrice) {
          const normalizedPrice = this._normalizePrice(jsPrice);
          logger.debug('Price extracted from JS variables', { price: normalizedPrice });
          return normalizedPrice;
        }
      } catch (e) {
        logger.debug('Error extracting JS variable price', {}, e);
      }
      
      // 5. Last resort: regex on HTML
      const html = await page.content();
      const priceFromHTML = await this.extractPriceFromHTML(html);
      
      if (priceFromHTML) {
        logger.debug('Price extracted from HTML regex', { price: priceFromHTML });
        return priceFromHTML;
      }
      
      // Se chegou aqui, não conseguiu extrair
      return null;
    } catch (error) {
      logger.error('Error during price extraction', { url: page.url() }, error);
      return null;
    }
  }
  
  /**
   * Extrai preço da estrutura de dados
   * @param {Object} structuredData - Dados estruturados
   * @returns {number|null} - Preço extraído ou null
   * @private
   */
  _extractPriceFromStructuredData(structuredData) {
    if (!structuredData) return null;
    
    try {
      // Extrai de JSON-LD
      if (structuredData.jsonLd) {
        for (const item of structuredData.jsonLd) {
          // Produto com preço direto
          if (item.offers && item.offers.price) {
            return this._normalizePrice(item.offers.price);
          }
          
          // Produto com múltiplas ofertas
          if (item.offers && Array.isArray(item.offers)) {
            // Pega a primeira oferta disponível
            for (const offer of item.offers) {
              if (offer.price) {
                return this._normalizePrice(offer.price);
              }
            }
          }
          
          // Tenta encontrar preço dentro do produto
          if (item.price) {
            return this._normalizePrice(item.price);
          }
        }
      }
      
      // Extrai de microdata
      if (structuredData.microdata) {
        for (const item of structuredData.microdata) {
          if (item.props && item.props.price) {
            return this._normalizePrice(item.props.price);
          }
        }
      }
    } catch (e) {
      logger.debug('Error extracting price from structured data', {}, e);
    }
    
    return null;
  }
  
  /**
   * Extrai preço de APIs internas
   * @param {import('playwright').Page} page - Página Playwright
   * @returns {Promise<number|null>} - Preço extraído ou null
   * @private
   */
  async _extractPriceFromAPI(page) {
    try {
      return await page.evaluate(async () => {
        // Procura por chamadas de API no armazenamento de sessão
        const apiResponses = sessionStorage.getItem('apiResponses');
        if (apiResponses) {
          try {
            const responses = JSON.parse(apiResponses);
            for (const key in responses) {
              if (responses[key].product && responses[key].product.price) {
                return responses[key].product.price;
              }
            }
          } catch (e) {}
        }
        
        // Tenta extrair do dataLayer
        if (window.dataLayer) {
          for (const item of window.dataLayer) {
            if (item.ecommerce && item.ecommerce.detail && item.ecommerce.detail.products) {
              const product = item.ecommerce.detail.products[0];
              if (product && product.price) {
                return product.price;
              }
            }
          }
        }
        
        return null;
      });
    } catch (e) {
      return null;
    }
  }
  
  /**
   * Extrai preço dos elementos DOM
   * @param {import('playwright').Page} page - Página Playwright
   * @returns {Promise<number|null>} - Preço extraído ou null
   * @private
   */
  async _extractPriceFromDOM(page) {
    // Try CSS selectors in order
    for (const selector of this.selectors.price) {
      try {
        // Tentar com waitForSelector primeiro (com timeout curto)
        const element = await page.waitForSelector(selector, { timeout: 1000 })
          .catch(() => page.$(selector));
        
        if (element) {
          const priceText = await element.textContent();
          if (priceText && priceText.trim()) {
            const price = this._normalizePrice(priceText);
            if (price) return price;
          }
          
          // Verifica atributo content (usado em alguns sites)
          const contentAttr = await element.getAttribute('content');
          if (contentAttr) {
            const price = this._normalizePrice(contentAttr);
            if (price) return price;
          }
        }
      } catch (e) {
        continue; // Tenta com o próximo seletor
      }
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
          
          // Check for content attribute
          const contentAttr = priceElement.attr('content');
          if (contentAttr) {
            const price = this._normalizePrice(contentAttr);
            if (price) return price;
          }
        }
      }
      
      // Try to find JSON-LD
      const jsonLD = $('script[type="application/ld+json"]');
      if (jsonLD.length) {
        for (let i = 0; i < jsonLD.length; i++) {
          try {
            const jsonStr = $(jsonLD[i]).html();
            if (!jsonStr) continue;
            
            const data = JSON.parse(jsonStr);
            
            // Item individual
            if (data.offers && data.offers.price) {
              return this._normalizePrice(data.offers.price);
            }
            
            // Array de ofertas
            if (data.offers && Array.isArray(data.offers)) {
              for (const offer of data.offers) {
                if (offer.price) {
                  return this._normalizePrice(offer.price);
                }
              }
            }
            
            // Preço direto
            if (data.price) {
              return this._normalizePrice(data.price);
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      // Last resort: regex for price patterns in HTML
      const patterns = [
        /"price"\s*:\s*(\d+[\.,]\d+)/,
        /"productPrice"\s*:\s*(\d+[\.,]\d+)/,
        /valor\s*:\s*['"](R?\$?\s*\d+[,.]\d+)/,
        /priceValue\s*[:=]\s*['"]?(R?\$?\s*\d+[,.]\d+)/,
        /R\$ (\d+[\.,]\d+)/,
        /R\$(\d+[\.,]\d+)/,
        /\$(\d+[\.,]\d+)/,
        /preco_de":"R\$\s*([\d\.,]+)/
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
   * @param {Object} [structuredData] - Pre-extracted structured data if available
   * @returns {Promise<string|null>} - Extracted title or null
   */
  async extractTitle(page, structuredData = null) {
    try {
      // 1. Tenta extrair dos dados estruturados
      if (structuredData) {
        const titleFromStructured = this._extractTitleFromStructuredData(structuredData);
        if (titleFromStructured) {
          logger.debug('Title extracted from structured data');
          return titleFromStructured;
        }
      }
      
      // 2. Tenta meta tags
      try {
        const metaTitle = await page.evaluate(() => {
          // Tenta várias meta tags em ordem de prioridade
          const metaTags = [
            document.querySelector('meta[property="og:title"]'),
            document.querySelector('meta[name="title"]'),
            document.querySelector('meta[name="twitter:title"]'),
            document.querySelector('meta[property="product:title"]')
          ];
          
          for (const tag of metaTags) {
            if (tag && tag.getAttribute('content')) {
              return tag.getAttribute('content').trim();
            }
          }
          
          return null;
        });
        
        if (metaTitle) {
          logger.debug('Title extracted from meta tags');
          return this._cleanTitle(metaTitle);
        }
      } catch (e) {
        logger.debug('Error extracting meta title', {}, e);
      }
      
      // 3. Tenta selectors do DOM
      for (const selector of this.selectors.title) {
        try {
          // Tenta primeiro com waitForSelector (timeout curto)
          const element = await page.waitForSelector(selector, { timeout: 1000 })
            .catch(() => page.$(selector));
            
          if (element) {
            const titleText = await element.textContent();
            if (titleText && titleText.trim()) {
              logger.debug('Title extracted from DOM selector');
              return this._cleanTitle(titleText);
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // 4. Tenta extrair de variáveis JavaScript
      try {
        const jsTitle = await page.evaluate(() => {
          // Tenta buscar em diferentes objetos globais
          if (window.digitalData && window.digitalData.product && window.digitalData.product.productInfo) {
            return window.digitalData.product.productInfo.productName;
          }
          
          if (window.__PRELOADED_STATE__ && window.__PRELOADED_STATE__.product) {
            return window.__PRELOADED_STATE__.product.name;
          }
          
          if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.product) {
            return window.__INITIAL_STATE__.product.name;
          }
          
          return null;
        });
        
        if (jsTitle) {
          logger.debug('Title extracted from JS variables');
          return this._cleanTitle(jsTitle);
        }
      } catch (e) {
        logger.debug('Error extracting JS variable title', {}, e);
      }
      
      // 5. Fallback to page title
      try {
        const pageTitle = await page.title();
        if (pageTitle) {
          logger.debug('Title extracted from page title');
          return this._cleanTitle(pageTitle);
        }
      } catch (e) {
        logger.debug('Error extracting page title', {}, e);
      }
      
      return null;
    } catch (error) {
      logger.error('Error during title extraction', { url: page.url() }, error);
      return null;
    }
  }
  
  /**
   * Limpa e formata o título
   * @param {string} title - Título a ser limpo
   * @returns {string} - Título limpo e formatado
   * @private
   */
  _cleanTitle(title) {
    if (!title) return null;
    
    let cleanTitle = title.trim();
    
    // Remove site name do título
    const siteName = this._extractDomain(page?.url() || '').split('.')[0];
    if (siteName) {
      cleanTitle = cleanTitle
        .replace(new RegExp(`[-|]\\s*${siteName}.*$`, 'i'), '')
        .replace(new RegExp(`^${siteName}\\s*[-|]\\s*`, 'i'), '')
        .trim();
    }
    
    // Remove outros sufixos comuns
    cleanTitle = cleanTitle
      .replace(/\s*-\s*compre\s*online/i, '')
      .replace(/\s*-\s*menor\s*preço/i, '')
      .replace(/\s*-\s*entrega\s*rápida/i, '')
      .trim();
    
    return cleanTitle;
  }
  
  /**
   * Extrai título dos dados estruturados
   * @param {Object} structuredData - Dados estruturados
   * @returns {string|null} - Título extraído ou null
   * @private
   */
  _extractTitleFromStructuredData(structuredData) {
    if (!structuredData) return null;
    
    try {
      // Extrai de JSON-LD
      if (structuredData.jsonLd) {
        for (const item of structuredData.jsonLd) {
          if (item.name) {
            return item.name;
          }
        }
      }
      
      // Extrai de microdata
      if (structuredData.microdata) {
        for (const item of structuredData.microdata) {
          if (item.props && item.props.name) {
            return item.props.name;
          }
        }
      }
    } catch (e) {
      logger.debug('Error extracting title from structured data', {}, e);
    }
    
    return null;
  }

  /**
   * Extract product availability from page
   * @param {import('playwright').Page} page - Playwright page
   * @param {Object} [structuredData] - Pre-extracted structured data if available
   * @returns {Promise<boolean|null>} - True if available, false if not, null if unknown
   */
  async extractAvailability(page, structuredData = null) {
    try {
      // 1. Check from structured data if available
      if (structuredData) {
        const availabilityFromStructured = this._extractAvailabilityFromStructuredData(structuredData);
        if (availabilityFromStructured !== null) {
          logger.debug('Availability extracted from structured data', { available: availabilityFromStructured });
          return availabilityFromStructured;
        }
      }
      
      // 2. Check for explicit out of stock indicators - se qualquer um for encontrado, o produto está indisponível
      for (const selector of this.selectors.outOfStock) {
        try {
          const element = await page.$(selector);
          if (element) {
            // Double check element content for confirmation
            const text = await element.textContent();
            if (text && (
                text.toLowerCase().includes('indisponível') || 
                text.toLowerCase().includes('esgotado') ||
                text.toLowerCase().includes('sem estoque') ||
                text.toLowerCase().includes('sold out') ||
                text.toLowerCase().includes('unavailable')
              )) {
              logger.debug('Product marked as out of stock', { selector });
              return false;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // 3. Check for availability indicators - se qualquer um for encontrado, está disponível
      for (const selector of this.selectors.availability) {
        try {
          const element = await page.$(selector);
          if (element) {
            // Check element content
            const text = await element.textContent() || '';
            
            // Check for negative indicators
            if (text.toLowerCase().includes('indisponível') || 
                text.toLowerCase().includes('esgotado') ||
                text.toLowerCase().includes('sem estoque')) {
              return false;
            }
            
            // Check for positive indicators
            if (text.toLowerCase().includes('disponível') || 
                text.toLowerCase().includes('em estoque') ||
                text.toLowerCase().includes('comprar') ||
                text.toLowerCase().includes('adicionar') ||
                text.toLowerCase().includes('carrinho')) {
              return true;
            }
            
            // Se o botão existe e não tem indicadores negativos, provavelmente está disponível
            return true;
          }
        } catch (e) {
          continue;
        }
      }
      
      // 4. Check if 'Add to Cart' button is available
      try {
        const addToCartButton = await page.$('[data-testid="add-to-cart"], .buy-button, .add-to-cart');
        if (addToCartButton) {
          // Verifica se o botão está habilitado
          const isDisabled = await page.evaluate(btn => {
            return btn.disabled || 
                   btn.classList.contains('disabled') || 
                   btn.getAttribute('aria-disabled') === 'true';
          }, addToCartButton);
          
          if (!isDisabled) {
            return true;
          }
        }
      } catch (e) {
        logger.debug('Error checking add to cart button', {}, e);
      }
      
      // 5. Check from JavaScript variables
      try {
        const jsAvailability = await page.evaluate(() => {
          // Verify from common JS objects
          if (window.digitalData && window.digitalData.product) {
            return window.digitalData.product.inStock === true || 
                   window.digitalData.product.availability === 'InStock';
          }
          
          if (window.__PRELOADED_STATE__ && window.__PRELOADED_STATE__.product) {
            return window.__PRELOADED_STATE__.product.inStock === true ||
                   window.__PRELOADED_STATE__.product.availability === 'InStock';
          }
          
          if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.product) {
            return window.__INITIAL_STATE__.product.inStock === true ||
                   window.__INITIAL_STATE__.product.availability === 'InStock';
          }
          
          return null;
        });
        
        if (jsAvailability !== null) {
          logger.debug('Availability extracted from JS variables', { available: jsAvailability });
          return jsAvailability;
        }
      } catch (e) {
        logger.debug('Error extracting JS availability', {}, e);
      }
      
      // 6. Last check: if we found a price, assume it's available
      try {
        const price = await this.extractPrice(page, structuredData);
        if (price) {
          logger.debug('Product has price, assuming available');
          return true;
        }
      } catch (e) {
        logger.debug('Error checking price for availability', {}, e);
      }
      
      // Couldn't determine availability
      return null;
    } catch (error) {
      logger.error('Error during availability extraction', { url: page.url() }, error);
      return null;
    }
  }
  
  /**
   * Extrai disponibilidade dos dados estruturados
   * @param {Object} structuredData - Dados estruturados
   * @returns {boolean|null} - Disponibilidade ou null
   * @private
   */
  _extractAvailabilityFromStructuredData(structuredData) {
    if (!structuredData) return null;
    
    try {
      // Extract from JSON-LD
      if (structuredData.jsonLd) {
        for (const item of structuredData.jsonLd) {
          if (item.offers) {
            const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
            for (const offer of offers) {
              if (offer.availability) {
                // Check schema.org availability values
                if (typeof offer.availability === 'string') {
                  return offer.availability.includes('InStock') || 
                         offer.availability.includes('inStock');
                } else if (typeof offer.availability === 'boolean') {
                  return offer.availability;
                }
              }
              
              // Check for explicit availability flag
              if (offer.hasOwnProperty('inStock')) {
                return offer.inStock === true;
              }
            }
          }
          
          // Some sites put availability directly on the product
          if (item.availability) {
            return typeof item.availability === 'string' ? 
                  (item.availability.includes('InStock') || item.availability.includes('inStock')) : 
                  (item.availability === true);
          }
          
          if (item.hasOwnProperty('inStock')) {
            return item.inStock === true;
          }
        }
      }
      
      // Extract from microdata
      if (structuredData.microdata) {
        for (const item of structuredData.microdata) {
          if (item.props && item.props.availability) {
            return item.props.availability.includes('InStock') || 
                   item.props.availability.includes('inStock');
          }
        }
      }
    } catch (e) {
      logger.debug('Error extracting availability from structured data', {}, e);
    }
    
    return null;
  }

  /**
   * Extract additional product information
   * @param {import('playwright').Page} page - Playwright page
   * @param {Object} [structuredData] - Pre-extracted structured data if available
   * @returns {Promise<Object>} - Additional product data
   */
  async extractProductInfo(page, structuredData = null) {
    try {
      // Se temos dados estruturados, tenta extrair informações deles primeiro
      let info = {};
      
      if (structuredData) {
        info = this._extractProductInfoFromStructuredData(structuredData) || {};
      }
      
      // Complementa com dados do DOM
      const domInfo = await page.evaluate(() => {
        const extracted = {};
        
        // Try to get SKU
        const skuSelectors = [
          '[data-product-sku]', 
          '[itemprop="sku"]', 
          '.product-sku',
          '[data-testid="product-sku"]'
        ];
        
        for (const selector of skuSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            extracted.sku = element.textContent.trim() || element.getAttribute('content') || element.getAttribute('data-product-sku');
            break;
          }
        }
        
        // Try to get brand
        const brandSelectors = [
          '[itemprop="brand"]', 
          '.product-brand',
          '[data-testid="product-brand"]'
        ];
        
        for (const selector of brandSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            extracted.brand = element.textContent.trim() || element.getAttribute('content');
            break;
          }
        }
        
        // Try to get installment info
        const installmentSelectors = [
          '.payment-installments', 
          '.product-installment',
          '[data-testid="installment-info"]'
        ];
        
        for (const selector of installmentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            extracted.installment = element.textContent.trim();
            break;
          }
        }
        
        // Try to get image URL
        const imageSelectors = [
          'meta[property="og:image"]',
          'meta[itemprop="image"]',
          '.product-image img',
          '[data-testid="product-image"] img'
        ];
        
        for (const selector of imageSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            extracted.imageUrl = element.getAttribute('content') || element.getAttribute('src');
            if (extracted.imageUrl && !extracted.imageUrl.startsWith('http')) {
              // Ajusta URLs relativas
              extracted.imageUrl = new URL(extracted.imageUrl, window.location.href).href;
            }
            break;
          }
        }
        
        // Try to get stock info
        const stockSelectors = [
          '.stock-info',
          '[data-testid="stock-info"]',
          '.inventory-status'
        ];
        
        for (const selector of stockSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            extracted.stockInfo = element.textContent.trim();
            break;
          }
        }
        
        // Try to get Specification
        const specsSection = document.querySelector('.product-specifications, .product-details, [data-testid="specifications"]');
        if (specsSection) {
          const specs = {};
          const rows = specsSection.querySelectorAll('tr, .spec-row');
          
          rows.forEach(row => {
            const label = row.querySelector('th, .spec-label, [data-testid="spec-label"]');
            const value = row.querySelector('td, .spec-value, [data-testid="spec-value"]');
            
            if (label && value) {
              specs[label.textContent.trim()] = value.textContent.trim();
            }
          });
          
          if (Object.keys(specs).length > 0) {
            extracted.specifications = specs;
          }
        }
        
        // Try to get from global data variables
        try {
          if (window.digitalData && window.digitalData.product) {
            if (!extracted.sku && window.digitalData.product.productInfo && window.digitalData.product.productInfo.sku) {
              extracted.sku = window.digitalData.product.productInfo.sku;
            }
            
            if (!extracted.brand && window.digitalData.product.productInfo && window.digitalData.product.productInfo.brand) {
              extracted.brand = window.digitalData.product.productInfo.brand;
            }
            
            if (window.digitalData.product.category) {
              extracted.category = window.digitalData.product.category;
            }
          }
        } catch (e) {}
        
        return extracted;
      });
      
      // Merge and return combined info
      return { ...info, ...domInfo };
    } catch (error) {
      logger.debug('Error extracting additional product info', {}, error);
      return {};
    }
  }
  
  /**
   * Extrai informações do produto a partir dos dados estruturados
   * @param {Object} structuredData - Dados estruturados
   * @returns {Object|null} - Informações extraídas ou null
   * @private
   */
  _extractProductInfoFromStructuredData(structuredData) {
    if (!structuredData) return null;
    
    try {
      const info = {};
      
      // Extract from JSON-LD
      if (structuredData.jsonLd) {
        for (const item of structuredData.jsonLd) {
          // Brand info
          if (item.brand) {
            if (typeof item.brand === 'string') {
              info.brand = item.brand;
            } else if (item.brand.name) {
              info.brand = item.brand.name;
            }
          }
          
          // SKU
          if (item.sku) {
            info.sku = item.sku;
          }
          
          // Image
          if (item.image) {
            if (typeof item.image === 'string') {
              info.imageUrl = item.image;
            } else if (Array.isArray(item.image) && item.image.length > 0) {
              info.imageUrl = item.image[0];
            }
          }
          
          // Category
          if (item.category) {
            info.category = item.category;
          }
          
          // Description
          if (item.description) {
            info.description = item.description;
          }
        }
      }
      
      return Object.keys(info).length > 0 ? info : null;
    } catch (e) {
      logger.debug('Error extracting product info from structured data', {}, e);
      return null;
    }
  }

  /**
   * Handle any site-specific setup before extraction
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<void>}
   */
  async preProcess(page) {
    try {
      // 1. Esperar que a página carregue o conteúdo essencial
      const essentialSelectors = this.selectors.price
        .concat(this.selectors.title)
        .slice(0, 3); // Limita para evitar espera desnecessária
      
      const waitPromises = [];
      for (const selector of essentialSelectors) {
        waitPromises.push(
          page.waitForSelector(selector, { timeout: 3000 })
            .catch(() => null) // Ignora erros individuais
        );
      }
      
      // Espera que pelo menos um dos seletores seja encontrado
      await Promise.any(waitPromises).catch(() => {
        // Se nenhum for encontrado, continua assim mesmo
        logger.debug('No essential selectors found during pre-processing');
      });
      
      // 2. Scroll para garantir que os elementos foram carregados
      await page.evaluate(() => {
        // Scroll devagar para baixo para carregar conteúdo lazy-loaded
        const scrollStep = window.innerHeight / 4;
        const totalScroll = Math.min(document.body.scrollHeight, window.innerHeight * 2);
        let currentScroll = 0;
        
        while (currentScroll < totalScroll) {
          window.scrollBy(0, scrollStep);
          currentScroll += scrollStep;
        }
        
        // Scroll de volta ao topo
        window.scrollTo(0, 0);
      });
      
      // 3. Fecha modais ou pop-ups que possam obstruir a visualização
      await this._closePopups(page);
      
      // 4. Pequena espera para garantir que eventuais scripts AJAX foram carregados
      await page.waitForTimeout(500);
    } catch (error) {
      logger.debug('Error in pre-processing', {}, error);
    }
  }
  
  /**
   * Fecha popups e modais que podem atrapalhar a extração
   * @param {import('playwright').Page} page - Página Playwright
   * @returns {Promise<void>}
   * @private
   */
  async _closePopups(page) {
    try {
      // Lista de seletores de botões de fechamento comuns
      const closeButtonSelectors = [
        '.close-button',
        '.modal-close',
        '.modal button.close',
        '.modal .btn-close',
        '[data-testid="close-button"]',
        '.cookie-message .close',
        '.newsletter-popup .close',
        '.overlay-modal .close'
      ];
      
      // Tenta clicar em cada um (com timeout curto)
      await page.evaluate((selectors) => {
        for (const selector of selectors) {
          const buttons = document.querySelectorAll(selector);
          for (const button of buttons) {
            try {
              button.click();
            } catch (e) {
              // Ignora erros de clique
            }
          }
        }
      }, closeButtonSelectors);
      
      // Tenta também automaticamente aceitar cookies
      const cookieAcceptSelectors = [
        '[data-testid="cookie-accept"]',
        '.cookie-banner .accept',
        '.cookie-consent .accept',
        '.cookies-consent-button',
        'button[aria-label="Aceitar cookies"]'
      ];
      
      for (const selector of cookieAcceptSelectors) {
        const button = await page.$(selector);
        if (button) {
          await button.click().catch(() => {});
          break;
        }
      }
    } catch (e) {
      // Ignora erros ao fechar popups
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
      // Converte para string
      const priceStr = price.toString();
      
      // Remove all non-numeric characters except . and ,
      let clean = priceStr.replace(/[^\d,\.]/g, '');
      
      // Sem dígitos, retorna null
      if (!/\d/.test(clean)) return null;
      
      // Regras específicas para valores brasileiros
      // 1. Se tem R$ ou BRL, assume formato brasileiro
      const isBrazilianFormat = priceStr.includes('R$') || priceStr.includes('BRL');
      
      // 2. Se tem vírgula seguida de 2 dígitos no final, assume formato brasileiro
      const hasDecimalComma = /,\d{2}$/.test(clean);
      
      // Processa com base no formato identificado
      if (isBrazilianFormat || hasDecimalComma) {
        // Handle Brazilian number format (where . is thousand separator and , is decimal separator)
        // Example: 1.234,56 -> 1234.56
        
        // Se tem pontos e vírgulas, assume que pontos são separadores de milhar
        if (clean.includes(',') && clean.includes('.')) {
          clean = clean.replace(/\./g, '').replace(',', '.');
        } 
        // Se tem só vírgula, assume que é decimal
        else if (clean.includes(',')) {
          clean = clean.replace(',', '.');
        }
      } else {
        // Para formato americano/internacional (1,234.56), remove vírgulas
        clean = clean.replace(/,/g, '');
      }
      
      // Converte para número e verifica se é válido
      const value = parseFloat(clean);
      
      // Verifica o tamanho do valor para evitar erros comuns (ex: centavos como reais)
      if (value > 100000) {
        // Valor muito alto pode ser erro - tenta dividir por 100
        const adjustedValue = value / 100;
        
        // Se o valor ajustado parece mais razoável, usa-o
        if (adjustedValue > 1 && adjustedValue < 100000) {
          logger.debug('Price adjusted (divided by 100)', { original: value, adjusted: adjustedValue });
          return adjustedValue;
        }
      }
      
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