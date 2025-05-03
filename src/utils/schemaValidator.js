/**
 * Schema Validator Module
 * Provides JSON Schema validation for data structures
 */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const logger = require('./logger');

class SchemaValidator {
  constructor() {
    // Initialize AJV with options
    this.ajv = new Ajv({
      allErrors: true,           // Return all errors, not just the first
      verbose: true,             // Include schema path in errors
      $data: true,               // Allow schema to reference other data
      useDefaults: true,         // Set default values from schema
      coerceTypes: true,         // Try to coerce data to correct type
      removeAdditional: false    // Do not remove additional properties
    });
    
    // Add string formats
    addFormats(this.ajv);
    
    // Add custom formats
    this._addCustomFormats();
    
    // Schema registry
    this.schemas = new Map();
  }
  
  /**
   * Add a schema to the validator
   * @param {string} schemaId - Unique schema identifier
   * @param {Object} schema - JSON Schema object
   */
  addSchema(schemaId, schema) {
    try {
      // Ensure schema has $id
      const schemaWithId = {
        ...schema,
        $id: schemaId
      };
      
      // Compile and add schema
      this.ajv.addSchema(schemaWithId, schemaId);
      this.schemas.set(schemaId, schemaWithId);
      
      logger.debug(`Added schema: ${schemaId}`);
    } catch (error) {
      logger.error(`Error adding schema ${schemaId}`, {}, error);
      throw error;
    }
  }
  
  /**
   * Validate data against a schema
   * @param {string} schemaId - Schema identifier
   * @param {Object} data - Data to validate
   * @returns {Object} - Validation result
   */
  validate(schemaId, data) {
    if (!this.schemas.has(schemaId)) {
      return {
        valid: false,
        errors: [{ message: `Schema not found: ${schemaId}` }]
      };
    }
    
    try {
      const validate = this.ajv.getSchema(schemaId);
      const valid = validate(data);
      
      if (!valid) {
        // Format errors to be more readable
        const errors = (validate.errors || []).map(err => this._formatError(err));
        return { valid: false, errors };
      }
      
      return { valid: true, errors: [] };
    } catch (error) {
      logger.error(`Error validating against schema ${schemaId}`, {}, error);
      return {
        valid: false,
        errors: [{ message: `Validation error: ${error.message}` }]
      };
    }
  }
  
  /**
   * Formats an error object from AJV into a more readable format
   * @param {Object} error - AJV error object
   * @returns {Object} - Formatted error
   * @private
   */
  _formatError(error) {
    // Get the field path
    const path = error.instancePath.replace(/^\//, '') || error.params.missingProperty || '(root)';
    
    // Format based on error keyword
    let message = error.message || 'Invalid value';
    
    switch (error.keyword) {
      case 'required':
        message = `Missing required property: ${error.params.missingProperty}`;
        break;
        
      case 'type':
        message = `Should be ${error.params.type}`;
        break;
        
      case 'format':
        message = `Should match format "${error.params.format}"`;
        break;
        
      case 'enum':
        message = `Should be one of: ${error.params.allowedValues.join(', ')}`;
        break;
        
      case 'pattern':
        message = `Should match pattern "${error.params.pattern}"`;
        break;
        
      case 'minimum':
        message = `Should be >= ${error.params.limit}`;
        break;
        
      case 'maximum':
        message = `Should be <= ${error.params.limit}`;
        break;
        
      case 'minLength':
        message = `Should have at least ${error.params.limit} characters`;
        break;
        
      case 'maxLength':
        message = `Should have at most ${error.params.limit} characters`;
        break;
    }
    
    return {
      field: path,
      message,
      rule: error.keyword,
      params: error.params
    };
  }
  
  /**
   * Add custom formats to the validator
   * @private
   */
  _addCustomFormats() {
    // Add 'currency' format (3-letter ISO code)
    this.ajv.addFormat('currency', {
      type: 'string',
      validate: (value) => /^[A-Z]{3}$/.test(value)
    });
    
    // Add 'price' format (number or string with optional currency symbol)
    this.ajv.addFormat('price', {
      type: ['string', 'number'],
      validate: (value) => {
        if (typeof value === 'number') return value >= 0;
        return /^[$€£¥]?\s?[\d.,]+$/.test(value);
      }
    });
    
    // Add 'color' format (hex, rgb, rgba, hsl, hsla, or named color)
    this.ajv.addFormat('color', {
      type: 'string',
      validate: (value) => {
        return (
          /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) || // hex
          /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(value) || // rgb
          /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/i.test(value) || // rgba
          /^hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\)$/i.test(value) || // hsl
          /^hsla\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*,\s*[\d.]+\s*\)$/i.test(value) // hsla
        );
      }
    });
    
    // Add 'image-url' format (URL ending with image extension)
    this.ajv.addFormat('image-url', {
      type: 'string',
      validate: (value) => {
        try {
          const url = new URL(value);
          return /\.(jpe?g|png|gif|svg|webp|avif)(\?.*)?$/i.test(url.pathname);
        } catch (e) {
          return false;
        }
      }
    });
    
    // Add 'date-iso' format (ISO 8601 date)
    this.ajv.addFormat('date-iso', {
      type: 'string',
      validate: (value) => {
        return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/.test(value);
      }
    });
    
    // Add 'dimensions' format (WxH)
    this.ajv.addFormat('dimensions', {
      type: 'string',
      validate: (value) => {
        return /^\d+\s?[xX]\s?\d+$/.test(value);
      }
    });
    
    // Add 'percentage' format
    this.ajv.addFormat('percentage', {
      type: ['string', 'number'],
      validate: (value) => {
        if (typeof value === 'number') return value >= 0 && value <= 100;
        return /^(\d{1,3}(\.\d+)?|\.\d+)%?$/.test(value);
      }
    });
  }
  
  /**
   * Register common schemas for e-commerce data
   */
  registerCommonSchemas() {
    // Product schema
    this.addSchema('product', {
      type: 'object',
      required: ['title', 'price'],
      properties: {
        title: { type: 'string', minLength: 3 },
        price: { oneOf: [
          { type: 'number', minimum: 0 },
          { type: 'string', format: 'price' }
        ]},
        originalPrice: { oneOf: [
          { type: 'number', minimum: 0 },
          { type: 'string', format: 'price' }
        ]},
        currency: { type: 'string', format: 'currency' },
        description: { type: 'string' },
        sku: { type: 'string' },
        availability: { type: 'string' },
        brand: { type: 'string' },
        images: { 
          type: 'array', 
          items: { type: 'string', format: 'uri' }
        },
        rating: { type: 'number', minimum: 0, maximum: 5 },
        reviewCount: { type: 'number', minimum: 0 },
        specifications: {
          type: 'object',
          additionalProperties: true
        },
        variants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              price: { oneOf: [
                { type: 'number', minimum: 0 },
                { type: 'string', format: 'price' }
              ]}
            },
            required: ['name', 'value']
          }
        },
        dimensions: {
          type: 'object',
          properties: {
            weight: { type: 'string' },
            length: { type: 'string' },
            width: { type: 'string' },
            height: { type: 'string' },
            unit: { type: 'string' }
          }
        },
        categories: {
          type: 'array',
          items: { type: 'string' }
        },
        url: { type: 'string', format: 'uri' },
        inStock: { type: 'boolean' },
        stockCount: { type: 'number', minimum: 0 },
        shippingInfo: {
          type: 'object',
          properties: {
            free: { type: 'boolean' },
            price: { oneOf: [
              { type: 'number', minimum: 0 },
              { type: 'string', format: 'price' }
            ]},
            estimatedDays: { type: 'number', minimum: 0 }
          }
        },
        _sources: {
          type: 'object',
          additionalProperties: true
        },
        _metadata: {
          type: 'object',
          additionalProperties: true
        }
      }
    });
    
    // Category schema
    this.addSchema('category', {
      type: 'object',
      required: ['name', 'url'],
      properties: {
        name: { type: 'string', minLength: 2 },
        url: { type: 'string', format: 'uri' },
        parentCategory: { type: 'string' },
        breadcrumbs: {
          type: 'array',
          items: { type: 'string' }
        },
        subcategories: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'url'],
            properties: {
              name: { type: 'string' },
              url: { type: 'string', format: 'uri' },
              imageUrl: { type: 'string', format: 'uri' },
              count: { type: 'number', minimum: 0 }
            }
          }
        },
        productCount: { type: 'number', minimum: 0 },
        description: { type: 'string' },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              values: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    count: { type: 'number', minimum: 0 },
                    url: { type: 'string', format: 'uri' }
                  }
                }
              }
            }
          }
        },
        _metadata: {
          type: 'object',
          additionalProperties: true
        }
      }
    });
    
    // Review schema
    this.addSchema('review', {
      type: 'object',
      required: ['rating', 'author', 'date'],
      properties: {
        productId: { type: 'string' },
        productUrl: { type: 'string', format: 'uri' },
        rating: { type: 'number', minimum: 0, maximum: 5 },
        title: { type: 'string' },
        content: { type: 'string' },
        author: { type: 'string' },
        date: { type: 'string', format: 'date-iso' },
        verified: { type: 'boolean' },
        helpful: {
          type: 'object',
          properties: {
            yes: { type: 'number', minimum: 0 },
            no: { type: 'number', minimum: 0 },
            percentage: { oneOf: [
              { type: 'number', minimum: 0, maximum: 100 },
              { type: 'string', format: 'percentage' }
            ]}
          }
        },
        images: {
          type: 'array',
          items: { type: 'string', format: 'uri' }
        },
        pros: {
          type: 'array',
          items: { type: 'string' }
        },
        cons: {
          type: 'array',
          items: { type: 'string' }
        },
        _metadata: {
          type: 'object',
          additionalProperties: true
        }
      }
    });
    
    // Price history schema
    this.addSchema('priceHistory', {
      type: 'object',
      required: ['productId', 'prices'],
      properties: {
        productId: { type: 'string' },
        productUrl: { type: 'string', format: 'uri' },
        prices: {
          type: 'array',
          items: {
            type: 'object',
            required: ['price', 'date'],
            properties: {
              price: { oneOf: [
                { type: 'number', minimum: 0 },
                { type: 'string', format: 'price' }
              ]},
              currency: { type: 'string', format: 'currency' },
              date: { type: 'string', format: 'date-iso' },
              source: { type: 'string' },
              available: { type: 'boolean' }
            }
          }
        },
        lowestPrice: {
          type: 'object',
          properties: {
            price: { oneOf: [
              { type: 'number', minimum: 0 },
              { type: 'string', format: 'price' }
            ]},
            date: { type: 'string', format: 'date-iso' }
          }
        },
        highestPrice: {
          type: 'object',
          properties: {
            price: { oneOf: [
              { type: 'number', minimum: 0 },
              { type: 'string', format: 'price' }
            ]},
            date: { type: 'string', format: 'date-iso' }
          }
        },
        averagePrice: { oneOf: [
          { type: 'number', minimum: 0 },
          { type: 'string', format: 'price' }
        ]},
        currency: { type: 'string', format: 'currency' },
        _metadata: {
          type: 'object',
          additionalProperties: true
        }
      }
    });
    
    // Search results schema
    this.addSchema('searchResults', {
      type: 'object',
      required: ['query', 'totalResults', 'results'],
      properties: {
        query: { type: 'string' },
        totalResults: { type: 'number', minimum: 0 },
        currentPage: { type: 'number', minimum: 1 },
        totalPages: { type: 'number', minimum: 1 },
        resultsPerPage: { type: 'number', minimum: 0 },
        results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'url'],
            properties: {
              title: { type: 'string' },
              url: { type: 'string', format: 'uri' },
              price: { oneOf: [
                { type: 'number', minimum: 0 },
                { type: 'string', format: 'price' }
              ]},
              imageUrl: { type: 'string', format: 'uri' },
              description: { type: 'string' },
              rating: { type: 'number', minimum: 0, maximum: 5 },
              reviewCount: { type: 'number', minimum: 0 },
              position: { type: 'number', minimum: 1 },
              sponsored: { type: 'boolean' }
            }
          }
        },
        filters: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'string' },
                count: { type: 'number', minimum: 0 },
                url: { type: 'string', format: 'uri' }
              }
            }
          }
        },
        _metadata: {
          type: 'object',
          additionalProperties: true
        }
      }
    });
  }
  
  /**
   * Register all schemas by default
   */
  initialize() {
    this.registerCommonSchemas();
    return this;
  }
}

module.exports = new SchemaValidator().initialize(); 