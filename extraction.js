const cheerio = require('cheerio');

/**
 * PriceExtractor: extrai preços de HTML usando múltiplas estratégias/fallbacks.
 */
class PriceExtractor {
  constructor() {
    // Seletores específicos por domínio problemático
    this.domainSelectors = {
      'magazineluiza.com.br': [
        '[itemprop="price"]',
        '.price-template__text',
        '.sc-jTzLTM',
        '.sc-hSdWYo',
        '.src__BestPrice-sc-1jnodg-5'
      ],
      'casasbahia.com.br': [
        '[itemprop="price"]',
        '.product-price-value',
        '.sales-price',
        '.price-template__text',
        '.src__BestPrice-sc-1jnodg2-5'
      ],
      'pontofrio.com.br': [
        '[itemprop="price"]',
        '.product-price-value',
        '.sales-price',
        '.price-template__text',
        '.src__BestPrice-sc-1jnodg2-5'
      ],
      'extra.com.br': [
        '[itemprop="price"]',
        '.product-price-value',
        '.sales-price',
        '.price-template__text',
        '.src__BestPrice-sc-1jnodg2-5'
      ],
      'carrefour.com.br': [
        '[itemprop="price"]',
        '.product-price-value',
        '.sales-price',
        '.price-template__text',
        '.src__BestPrice-sc-1jnodg2-5'
      ]
    };

    // Seletores genéricos para fallback
    this.genericSelectors = [
      '[itemprop="price"]',
      '.price',
      '.sales-price',
      '.src__BestPrice-sc-1jnodg2-5',
      '.preco-a-vista',
      '.precoPor'
    ];
  }

  /**
   * Estratégia principal: tenta várias formas de extrair o preço.
   * @param {string} html HTML da página
   * @param {string} domain Domínio do marketplace
   * @returns {number|null}
   */
  async extractPrice(html, domain) {
    let price = await this.extractFromStructuredData(html);
    if (!price && this.domainSelectors[domain]) {
      price = await this.extractFromDomainSelectors(html, domain);
    }
    if (!price) {
      price = await this.extractFromGenericSelectors(html);
    }
    if (!price) {
      price = await this.extractFromTextPatterns(html);
    }
    return this.formatPrice(price);
  }

  // --- Funções auxiliares privadas ---

  _loadCheerio(html) {
    return cheerio.load(html);
  }

  _findJsonLd($) {
    return $('script[type="application/ld+json"]');
  }

  /**
   * Extrai preço de scripts JSON-LD (schema.org).
   */
  async extractFromStructuredData(html) {
    try {
      const $ = this._loadCheerio(html);
      const scripts = this._findJsonLd($);
      for (const script of scripts) {
        try {
          const json = JSON.parse($(script).html());
          if (json && json.offers && json.offers.price) {
            return json.offers.price;
          }
          if (Array.isArray(json)) {
            for (const obj of json) {
              if (obj.offers && obj.offers.price) {
                return obj.offers.price;
              }
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  /**
   * Extrai preço usando seletores específicos do domínio.
   */
  async extractFromDomainSelectors(html, domain) {
    try {
      const $ = this._loadCheerio(html);
      for (const selector of this.domainSelectors[domain]) {
        const price = $(selector).first().text().replace(/[^\d,\.]/g, '').trim();
        if (price) return price;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Extrai preço usando seletores genéricos.
   */
  async extractFromGenericSelectors(html) {
    try {
      const $ = this._loadCheerio(html);
      for (const selector of this.genericSelectors) {
        const price = $(selector).first().text().replace(/[^\d,\.]/g, '').trim();
        if (price) return price;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Extrai preço usando regex em todo o HTML (último recurso).
   */
  async extractFromTextPatterns(html) {
    const regex = /R?\$ ?(\d{1,3}(?:[\.\,]\d{3})*[\.,]\d{2})/g;
    const matches = html.match(regex);
    if (matches && matches.length > 0) {
      return matches[0];
    }
    return null;
  }

  /**
   * Normaliza string de preço para número.
   */
  formatPrice(price) {
    if (!price) return null;
    let clean = price.replace(/[^\d,\.]/g, '').replace(/\.(?=\d{3,3}\D)/g, '').replace(',', '.');
    const value = parseFloat(clean);
    return isNaN(value) ? null : value;
  }
}

module.exports = PriceExtractor;
