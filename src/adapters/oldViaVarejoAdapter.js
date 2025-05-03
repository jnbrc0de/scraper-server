/**
 * Extrator robusto para preços em sites Via Varejo (Casas Bahia, Ponto Frio, Extra).
 * Tenta JSON-LD, seletores, variáveis JS e regex.
 */
const extractViaVarejoPrice = async (page) => {
  // Aguarda carregamento extra para garantir renderização de preço
  await page.waitForTimeout(3000);

  try {
    // 1. Extrai do JSON-LD (schema.org)
    const jsonLdPrice = await page.evaluate(() => {
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

    if (jsonLdPrice) return jsonLdPrice;

    // 2. Tenta múltiplos seletores específicos
    const selectors = [
      '.product-price-value', 
      '.valPrecoAtual', 
      '.product__price-value',
      '[data-testid="product-price-value"]',
      '.productPage__price-value',
      '.product-price__Price-sc-h6x8zi-1',
      '.price__Price'
    ];

    for (const selector of selectors) {
      try {
        if (await page.$(selector)) {
          const price = await page.$eval(selector, el => el.textContent.trim());
          if (price && price.includes('R$')) return price;
        }
      } catch (e) {}
    }

    // 3. Verifica variáveis JS expostas no window
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

    if (jsPrice) return jsPrice;

    // 4. Regex no HTML como último recurso
    const regexPrice = await page.evaluate(() => {
      const htmlContent = document.documentElement.innerHTML;
      const patterns = [
        /"price"\s*:\s*(\d+\.\d+)/,
        /"productPrice"\s*:\s*(\d+\.\d+)/,
        /valor\s*:\s*['"](R?\$?\s*\d+[,.]\d+)/,
        /priceValue\s*[:=]\s*['"]?(R?\$?\s*\d+[,.]\d+)/
      ];
      for (const pattern of patterns) {
        const match = htmlContent.match(pattern);
        if (match && match[1]) return match[1];
      }
      return null;
    });

    return regexPrice;
  } catch (e) {
    console.error('Erro ao extrair preço Via Varejo:', e);
    return null;
  }
};

module.exports = extractViaVarejoPrice;
