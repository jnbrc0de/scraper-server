/**
 * Product Scraper Adapter
 * Specialized adapter for scraping product data with resilient error handling
 */
const BaseScraperAdapter = require('./baseScraperAdapter');
const logger = require('../../utils/logger');
const dataValidator = require('../../utils/dataValidator');
const imageValidator = require('../../utils/imageValidator');

class ProductScraperAdapter extends BaseScraperAdapter {
  constructor(options = {}) {
    super({
      maxRetries: 5, // Increase retries for product pages (they're important)
      timeout: 45000, // Longer timeout for product pages
      ...options
    });
    
    // Placeholders for common product image issues
    this.knownPlaceholderImages = options.placeholderImages || [];
    
    // Set validation options
    this.validationOptions = {
      performSchemaValidation: options.performSchemaValidation !== false,
      performAnomalyDetection: options.performAnomalyDetection !== false,
      performCrossVerification: options.performCrossVerification !== false,
      validateImages: options.validateImages !== false,
      strictValidation: options.strictValidation === true,
      minImageWidth: options.minImageWidth || 100,
      minImageHeight: options.minImageHeight || 100
    };
  }
  
  /**
   * Scrape a product from a given URL
   * @param {string} url - Product URL
   * @param {Object} options - Scraping options
   * @returns {Promise<Object>} - Scraped product data
   */
  async scrapeProduct(url, options = {}) {
    logger.info('Starting product scrape', { url });
    
    try {
      // Initialize browser if not already done
      if (!this.page) {
        await this.initializeBrowser({ targetUrl: url });
      }
      
      // Navigate to the product page
      const { page } = await this.navigateTo(url, {
        waitForSelector: options.waitForSelector || '.product-detail, .product-container, #product',
        waitUntil: 'domcontentloaded'
      });
      
      // Extract product data
      const extractionResult = await this.extractData({
        selectors: {
          title: options.selectors?.title || '.product-title, h1.title, .name, [data-testid="product-title"]',
          price: options.selectors?.price || '.price, .product-price, [data-testid="price"]',
          description: {
            type: 'html',
            selector: options.selectors?.description || '.description, #description, [data-testid="description"]'
          },
          images: {
            type: 'list',
            selector: options.selectors?.images || '.product-images img, .gallery img',
            attribute: 'src'
          },
          sku: {
            type: 'attribute',
            selector: options.selectors?.sku || '[data-sku], [data-product-id]',
            attribute: 'data-sku'
          },
          rating: options.selectors?.rating || '.rating, .stars, [data-testid="rating"]',
          availability: options.selectors?.availability || '.availability, .stock, [data-testid="availability"]'
        },
        validateData: (data) => {
          // Basic validation - should at least have title and price
          return data && data.title && data.price;
        }
      });
      
      // Extract structured data if available (JSON-LD)
      const structuredData = await this.extractStructuredData(page);
      
      // Merge structured data with DOM-extracted data, prioritizing DOM data
      const mergedData = this.mergeProductData(extractionResult.data, structuredData);
      
      // Add metadata for validation
      mergedData._sources = ['dom', 'structured'];
      mergedData._metadata = {
        url,
        timestamp: Date.now(),
        extractionTime: Date.now() - extractionResult.timestamp
      };
      
      // Perform data integrity verification
      const validationResult = await this.validateProductData(mergedData, page);
      
      // Add validation metadata to the result
      const result = {
        url: extractionResult.url,
        product: mergedData,
        timestamp: extractionResult.timestamp,
        validation: {
          valid: validationResult.valid,
          warnings: validationResult.warnings,
          errors: validationResult.errors
        }
      };
      
      // If in strict mode and validation failed, throw an error
      if (this.validationOptions.strictValidation && !validationResult.valid) {
        const error = new Error('Product data validation failed');
        error.validationResult = validationResult;
        error.data = mergedData;
        throw error;
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to scrape product', { url }, error);
      throw error;
    }
  }
  
  /**
   * Extract structured data (JSON-LD or microdata) from page
   * @param {import('playwright').Page} page - Playwright page
   * @returns {Promise<Object>} - Structured data if available
   */
  async extractStructuredData(page) {
    try {
      // This is wrapped in performAction to get retry benefits
      return this.performAction(async (page) => {
        // Look for JSON-LD data
        const jsonLd = await page.evaluate(() => {
          const elements = document.querySelectorAll('script[type="application/ld+json"]');
          if (!elements || elements.length === 0) return null;
          
          const results = [];
          elements.forEach(el => {
            try {
              const parsed = JSON.parse(el.textContent);
              if (parsed['@type'] === 'Product' || 
                 (Array.isArray(parsed['@graph']) && 
                  parsed['@graph'].some(item => item['@type'] === 'Product'))) {
                results.push(parsed);
              }
            } catch (e) {}
          });
          
          return results.length > 0 ? results[0] : null;
        });
        
        if (jsonLd) {
          // Process JSON-LD data
          return this.processJsonLd(jsonLd);
        }
        
        // Look for microdata as fallback
        const microdata = await page.evaluate(() => {
          // Simple microdata extraction (could be expanded)
          const name = document.querySelector('[itemprop="name"]')?.textContent;
          const price = document.querySelector('[itemprop="price"]')?.textContent;
          const currency = document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content');
          
          if (!name && !price) return null;
          
          return {
            name,
            price,
            priceCurrency: currency
          };
        });
        
        return microdata;
      }, {
        actionName: 'extract_structured_data',
        maxRetries: 2 // Fewer retries for this supplementary data
      });
    } catch (error) {
      logger.warn('Failed to extract structured data', {}, error);
      return null; // Return null rather than failing the whole operation
    }
  }
  
  /**
   * Process JSON-LD structured data
   * @param {Object} jsonLd - JSON-LD data
   * @returns {Object} - Processed product data
   */
  processJsonLd(jsonLd) {
    try {
      // Handle JSON-LD @graph format
      let product = jsonLd;
      if (jsonLd['@graph'] && Array.isArray(jsonLd['@graph'])) {
        product = jsonLd['@graph'].find(item => item['@type'] === 'Product');
        if (!product) return null;
      }
      
      // Ensure it's a product
      if (product['@type'] !== 'Product') return null;
      
      // Extract relevant fields
      const result = {
        title: product.name,
        structuredDescription: product.description,
        structuredImages: []
      };
      
      // Handle price which can be in different formats
      if (product.offers) {
        const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        if (offers.price) {
          result.structuredPrice = `${offers.price} ${offers.priceCurrency || ''}`.trim();
        }
        if (offers.availability) {
          result.structuredAvailability = offers.availability.replace('http://schema.org/', '');
        }
      }
      
      // Handle images
      if (product.image) {
        if (Array.isArray(product.image)) {
          result.structuredImages = product.image.map(img => typeof img === 'string' ? img : img.url);
        } else if (typeof product.image === 'string') {
          result.structuredImages = [product.image];
        } else if (product.image.url) {
          result.structuredImages = [product.image.url];
        }
      }
      
      // Handle ratings
      if (product.aggregateRating) {
        result.structuredRating = {
          value: product.aggregateRating.ratingValue,
          count: product.aggregateRating.reviewCount
        };
      }
      
      return result;
    } catch (error) {
      logger.warn('Error processing JSON-LD data', {}, error);
      return null;
    }
  }
  
  /**
   * Merge product data from multiple sources
   * @param {Object} domData - Data extracted from DOM
   * @param {Object} structuredData - Data from structured data
   * @returns {Object} - Merged product data
   */
  mergeProductData(domData, structuredData) {
    // If either source is missing, return the other
    if (!domData) return structuredData || {};
    if (!structuredData) return domData;
    
    // Start with DOM data as the base
    const result = { ...domData };
    
    // Track source for each field for cross-validation
    result._dom_title = domData.title;
    result._structured_title = structuredData.title;
    
    result._dom_price = domData.price;
    result._structured_price = structuredData.structuredPrice;
    
    result._dom_description = domData.description;
    result._structured_description = structuredData.structuredDescription;
    
    // Add structured data fields that aren't in DOM data
    // or use structured data as fallback
    if (!result.title && structuredData.title) {
      result.title = structuredData.title;
    }
    
    if (!result.description && structuredData.structuredDescription) {
      result.description = structuredData.structuredDescription;
    }
    
    if ((!result.price || result.price === 'N/A') && structuredData.structuredPrice) {
      result.price = structuredData.structuredPrice;
    }
    
    if ((!result.images || result.images.length === 0) && structuredData.structuredImages) {
      result.images = structuredData.structuredImages;
    } else if (result.images && structuredData.structuredImages) {
      // Save structured images for cross-validation
      result._dom_images = result.images;
      result._structured_images = structuredData.structuredImages;
    }
    
    if (!result.rating && structuredData.structuredRating) {
      result.rating = structuredData.structuredRating.value;
      result.reviewCount = structuredData.structuredRating.count;
    }
    
    if (!result.availability && structuredData.structuredAvailability) {
      result.availability = structuredData.structuredAvailability;
    }
    
    return result;
  }
  
  /**
   * Validate product data for integrity and consistency
   * @param {Object} productData - Product data to validate
   * @param {import('playwright').Page} page - Playwright page for context
   * @returns {Promise<Object>} - Validation results
   */
  async validateProductData(productData, page) {
    try {
      // Prepare validation options
      const options = {
        dataType: 'product',
        performSchemaValidation: this.validationOptions.performSchemaValidation,
        performAnomalyDetection: this.validationOptions.performAnomalyDetection,
        performCrossVerification: this.validationOptions.performCrossVerification,
        validateImages: this.validationOptions.validateImages,
        strictValidation: this.validationOptions.strictValidation
      };
      
      // Validate product data using data validator
      const validationResult = await dataValidator.verifyDataIntegrity(productData, options);
      
      // Additional image validation if enabled
      if (this.validationOptions.validateImages && 
          productData.images && 
          Array.isArray(productData.images) && 
          productData.images.length > 0) {
        
        // Check for placeholder images
        if (this.knownPlaceholderImages.length > 0) {
          const imageChecks = [];
          for (const img of productData.images) {
            try {
              const placeholderCheck = await imageValidator.checkForPlaceholderImage(
                img, 
                this.knownPlaceholderImages,
                { similarityThreshold: 0.85 }
              );
              
              if (placeholderCheck.isPlaceholder) {
                validationResult.warnings.push(`Image ${img} appears to be a placeholder image`);
                imageChecks.push(placeholderCheck);
              }
            } catch (error) {
              logger.debug('Error checking for placeholder image', { imageUrl: img }, error);
            }
          }
          
          validationResult.details.placeholderChecks = imageChecks;
        }
      }
      
      return validationResult;
    } catch (error) {
      logger.error('Error validating product data', {}, error);
      return {
        valid: false,
        errors: [`Validation error: ${error.message}`],
        warnings: []
      };
    }
  }
  
  /**
   * Extract and validate product reviews
   * @param {string} url - Product URL
   * @param {Object} options - Review extraction options
   * @returns {Promise<Object>} - Reviews data with validation results
   */
  async scrapeProductReviews(url, options = {}) {
    logger.info('Scraping product reviews', { url });
    
    try {
      // Initialize browser if needed
      if (!this.page) {
        await this.initializeBrowser({ targetUrl: url });
      }
      
      // Navigate to reviews page or section
      const targetUrl = options.reviewsUrl || url;
      const { page } = await this.navigateTo(targetUrl, {
        waitForSelector: options.waitForSelector || '.reviews, .review-list, #reviews',
        waitUntil: 'domcontentloaded'
      });
      
      // Extract reviews
      const reviewsData = await this.performAction(async (page) => {
        return page.evaluate((selectors) => {
          const reviews = [];
          const reviewElements = document.querySelectorAll(selectors.reviewContainer);
          
          for (const el of reviewElements) {
            const review = {
              rating: parseFloat(el.querySelector(selectors.rating)?.textContent || 
                        el.querySelector(selectors.rating)?.getAttribute('content') || '0'),
              title: el.querySelector(selectors.title)?.textContent?.trim(),
              content: el.querySelector(selectors.content)?.textContent?.trim(),
              author: el.querySelector(selectors.author)?.textContent?.trim(),
              date: el.querySelector(selectors.date)?.textContent?.trim() || 
                    el.querySelector(selectors.date)?.getAttribute('datetime')
            };
            
            // Add verified status if available
            const verifiedEl = el.querySelector(selectors.verified);
            if (verifiedEl) {
              review.verified = true;
            }
            
            // Add images if available
            const imageElements = el.querySelectorAll(selectors.images);
            if (imageElements?.length > 0) {
              review.images = Array.from(imageElements).map(img => img.src || img.getAttribute('data-src'));
            }
            
            reviews.push(review);
          }
          
          return {
            reviews,
            totalCount: parseInt(document.querySelector(selectors.totalCount)?.textContent || '0', 10)
          };
        }, options.selectors || {
          reviewContainer: '.review, .review-item',
          rating: '.rating, .stars, [itemprop="ratingValue"]',
          title: '.review-title, .review-header h3',
          content: '.review-content, .review-text, [itemprop="reviewBody"]',
          author: '.review-author, .author, [itemprop="author"]',
          date: '.review-date, .date, [itemprop="datePublished"]',
          verified: '.verified-purchase, .verified-buyer',
          images: '.review-images img, .user-images img',
          totalCount: '.review-count, .total-reviews, [itemprop="reviewCount"]'
        });
      }, {
        actionName: 'extract_reviews',
        maxRetries: 2
      });
      
      // Validate reviews if we have any
      const validatedReviews = [];
      if (reviewsData.reviews && reviewsData.reviews.length > 0) {
        for (const review of reviewsData.reviews) {
          // Skip empty reviews
          if (!review.content && !review.title) continue;
          
          // Validate each review
          const validationResult = await dataValidator.verifyDataIntegrity(review, {
            dataType: 'review',
            performSchemaValidation: this.validationOptions.performSchemaValidation,
            performAnomalyDetection: this.validationOptions.performAnomalyDetection,
            validateImages: this.validationOptions.validateImages && review.images && review.images.length > 0,
            strictValidation: false // Use less strict validation for reviews
          });
          
          validatedReviews.push({
            ...review,
            validation: {
              valid: validationResult.valid,
              warnings: validationResult.warnings,
              errors: validationResult.errors
            }
          });
        }
      }
      
      return {
        productUrl: url,
        reviews: validatedReviews,
        totalCount: reviewsData.totalCount || validatedReviews.length,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Failed to scrape product reviews', { url }, error);
      throw error;
    }
  }
}

module.exports = ProductScraperAdapter; 