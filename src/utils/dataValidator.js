/**
 * Data Validation Module
 * Provides utilities for verifying the integrity of scraped data
 */
const logger = require('./logger');
const schemaValidator = require('./schemaValidator');
const imageValidator = require('./imageValidator');

/**
 * Validates data against a schema with various validation strategies
 */
class DataValidator {
  constructor() {
    // Registry of validation schemas
    this.schemas = new Map();
    
    // Registry of anomaly detection rules
    this.anomalyRules = new Map();
    
    // Registry of known expected values for testing
    this.knownSamples = new Map();
    
    // Track validation statistics
    this.stats = {
      totalValidations: 0,
      schemaFailures: 0,
      anomaliesDetected: 0,
      crossVerificationFailures: 0
    };
  }
  
  /**
   * Register a schema for a data type
   * @param {string} dataType - Type of data (e.g., "product", "category", "review")
   * @param {Object} schema - Schema definition
   */
  registerSchema(dataType, schema) {
    this.schemas.set(dataType, schema);
    logger.debug(`Registered schema for ${dataType}`);
  }
  
  /**
   * Register an anomaly detection rule
   * @param {string} dataType - Type of data
   * @param {string} field - Field to check
   * @param {Function} ruleFn - Function to detect anomalies
   * @param {string} description - Description of the rule
   */
  registerAnomalyRule(dataType, field, ruleFn, description) {
    if (!this.anomalyRules.has(dataType)) {
      this.anomalyRules.set(dataType, []);
    }
    
    this.anomalyRules.get(dataType).push({
      field,
      rule: ruleFn,
      description
    });
    
    logger.debug(`Registered anomaly rule for ${dataType}.${field}: ${description}`);
  }
  
  /**
   * Register a known sample for testing
   * @param {string} id - Unique identifier for the sample
   * @param {string} dataType - Type of data
   * @param {Object} expectedData - Expected data values
   * @param {string} [sourceUrl] - URL where the data comes from
   */
  registerKnownSample(id, dataType, expectedData, sourceUrl) {
    this.knownSamples.set(id, {
      dataType,
      expectedData,
      sourceUrl
    });
  }
  
  /**
   * Validate data against its schema
   * @param {string} dataType - Type of data
   * @param {Object} data - Data to validate
   * @param {Object} options - Validation options
   * @returns {Object} - Validation results
   */
  validate(dataType, data, options = {}) {
    this.stats.totalValidations++;
    
    const {
      performSchemaValidation = true,
      performAnomalyDetection = true,
      performCrossValidation = true,
      strictValidation = false, // Fail on any validation error
      context = {}
    } = options;
    
    const result = {
      valid: true,
      schemaErrors: [],
      anomalies: [],
      crossValidationErrors: [],
      warnings: []
    };
    
    // Schema validation
    if (performSchemaValidation) {
      const schemaResult = this._validateSchema(dataType, data);
      if (!schemaResult.valid) {
        result.valid = false;
        result.schemaErrors = schemaResult.errors;
        this.stats.schemaFailures++;
      }
    }
    
    // Anomaly detection
    if (performAnomalyDetection) {
      const anomalyResult = this._detectAnomalies(dataType, data, context);
      if (anomalyResult.anomalies.length > 0) {
        // Anomalies don't automatically invalidate data
        result.anomalies = anomalyResult.anomalies;
        
        // But in strict mode, they do
        if (strictValidation) {
          result.valid = false;
        }
        
        this.stats.anomaliesDetected += anomalyResult.anomalies.length;
      }
    }
    
    // Cross-verification of data if multiple sources provided
    if (performCrossValidation && data._sources && 
        Array.isArray(data._sources) && data._sources.length > 1) {
      const crossValidationResult = this._performCrossValidation(data);
      if (crossValidationResult.errors.length > 0) {
        result.crossValidationErrors = crossValidationResult.errors;
        
        // If strict validation or serious inconsistencies
        if (strictValidation || crossValidationResult.serious) {
          result.valid = false;
        }
        
        this.stats.crossVerificationFailures++;
      }
    }
    
    // Log validation results
    if (!result.valid) {
      logger.warn(`Data validation failed for ${dataType}`, {
        schemaErrors: result.schemaErrors,
        anomalies: result.anomalies,
        crossValidationErrors: result.crossValidationErrors
      });
    } else if (result.anomalies.length > 0 || result.warnings.length > 0) {
      logger.info(`Data validated with warnings for ${dataType}`, {
        anomalies: result.anomalies,
        warnings: result.warnings
      });
    } else {
      logger.debug(`Data validated successfully for ${dataType}`);
    }
    
    return result;
  }
  
  /**
   * Validate data against its schema
   * @param {string} dataType - Type of data
   * @param {Object} data - Data to validate
   * @returns {Object} - Schema validation results
   * @private
   */
  _validateSchema(dataType, data) {
    const schema = this.schemas.get(dataType);
    if (!schema) {
      return { 
        valid: true, 
        errors: [],
        warnings: [`No schema registered for ${dataType}`]
      };
    }
    
    const errors = [];
    let valid = true;
    
    // Check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (data[field] === undefined || data[field] === null || data[field] === '') {
          valid = false;
          errors.push({
            field,
            message: `Required field "${field}" is missing or empty`
          });
        }
      }
    }
    
    // Check field types and formats
    if (schema.properties) {
      for (const [field, props] of Object.entries(schema.properties)) {
        if (data[field] === undefined || data[field] === null) {
          continue; // Skip validating undefined fields (required fields already checked)
        }
        
        // Type validation
        if (props.type) {
          const actualType = Array.isArray(data[field]) ? 'array' : typeof data[field];
          if (actualType !== props.type) {
            if (props.type === 'number' && actualType === 'string' && !isNaN(Number(data[field]))) {
              // Auto-convert string to number for comparison
              data[field] = Number(data[field]);
            } else {
              valid = false;
              errors.push({
                field,
                message: `Field "${field}" should be type "${props.type}" but got "${actualType}"`
              });
            }
          }
        }
        
        // Range validation for numbers
        if (props.type === 'number' || (props.type === 'string' && props.format === 'numeric')) {
          const num = typeof data[field] === 'string' ? Number(data[field]) : data[field];
          
          if (props.minimum !== undefined && num < props.minimum) {
            valid = false;
            errors.push({
              field,
              message: `Field "${field}" value ${num} is less than minimum ${props.minimum}`
            });
          }
          
          if (props.maximum !== undefined && num > props.maximum) {
            valid = false;
            errors.push({
              field,
              message: `Field "${field}" value ${num} is greater than maximum ${props.maximum}`
            });
          }
        }
        
        // String format validation
        if (props.type === 'string' && props.format) {
          switch (props.format) {
            case 'email':
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data[field])) {
                valid = false;
                errors.push({
                  field,
                  message: `Field "${field}" is not a valid email`
                });
              }
              break;
              
            case 'url':
              try {
                new URL(data[field]);
              } catch (e) {
                valid = false;
                errors.push({
                  field,
                  message: `Field "${field}" is not a valid URL`
                });
              }
              break;
              
            case 'numeric':
              if (isNaN(Number(data[field]))) {
                valid = false;
                errors.push({
                  field,
                  message: `Field "${field}" is not numeric`
                });
              }
              break;
              
            // Add more formats as needed
          }
        }
        
        // Validate array items
        if (props.type === 'array' && props.items && Array.isArray(data[field])) {
          for (let i = 0; i < data[field].length; i++) {
            const item = data[field][i];
            
            // Type validation for array items
            if (props.items.type) {
              const actualType = typeof item;
              if (actualType !== props.items.type) {
                valid = false;
                errors.push({
                  field: `${field}[${i}]`,
                  message: `Array item should be type "${props.items.type}" but got "${actualType}"`
                });
              }
            }
          }
        }
        
        // Pattern validation
        if (props.type === 'string' && props.pattern) {
          const regex = new RegExp(props.pattern);
          if (!regex.test(data[field])) {
            valid = false;
            errors.push({
              field,
              message: `Field "${field}" does not match pattern "${props.pattern}"`
            });
          }
        }
        
        // Enum validation
        if (props.enum && Array.isArray(props.enum)) {
          if (!props.enum.includes(data[field])) {
            valid = false;
            errors.push({
              field,
              message: `Field "${field}" value "${data[field]}" is not in allowed values: ${props.enum.join(', ')}`
            });
          }
        }
      }
    }
    
    return { valid, errors };
  }
  
  /**
   * Detect anomalies in the data
   * @param {string} dataType - Type of data
   * @param {Object} data - Data to check
   * @param {Object} context - Additional context
   * @returns {Object} - Detected anomalies
   * @private
   */
  _detectAnomalies(dataType, data, context = {}) {
    const anomalies = [];
    
    // Apply registered anomaly rules
    const rules = this.anomalyRules.get(dataType) || [];
    for (const { field, rule, description } of rules) {
      // Skip undefined fields
      if (data[field] === undefined) continue;
      
      try {
        const isAnomaly = rule(data[field], data, context);
        if (isAnomaly) {
          anomalies.push({
            field,
            description,
            value: data[field]
          });
        }
      } catch (error) {
        logger.warn(`Error applying anomaly rule for ${dataType}.${field}`, {}, error);
      }
    }
    
    // Standard anomaly checks for common data types
    
    // Price anomalies
    if (data.price !== undefined) {
      const price = typeof data.price === 'string' 
        ? parseFloat(data.price.replace(/[^0-9.]/g, '')) 
        : data.price;
        
      if (!isNaN(price)) {
        // Check for suspiciously low prices
        if (price < 0.1 && context.minExpectedPrice && price < context.minExpectedPrice) {
          anomalies.push({
            field: 'price',
            description: 'Price is suspiciously low',
            value: price
          });
        }
        
        // Check for suspiciously high prices
        if (context.maxExpectedPrice && price > context.maxExpectedPrice) {
          anomalies.push({
            field: 'price',
            description: 'Price is suspiciously high',
            value: price
          });
        }
      }
    }
    
    // Title anomalies
    if (data.title) {
      // Check for very short titles
      if (data.title.length < 3) {
        anomalies.push({
          field: 'title',
          description: 'Title is suspiciously short',
          value: data.title
        });
      }
      
      // Check for placeholder titles
      const placeholderPatterns = [
        /product( title)?/i,
        /untitled/i,
        /no( product)? name/i,
        /^test/i,
        /^placeholder/i,
        /^title/i
      ];
      
      for (const pattern of placeholderPatterns) {
        if (pattern.test(data.title.trim())) {
          anomalies.push({
            field: 'title',
            description: 'Title appears to be a placeholder',
            value: data.title
          });
          break;
        }
      }
    }
    
    // Image URL anomalies
    if (data.images && Array.isArray(data.images)) {
      // Check for placeholder or missing images
      const suspiciousImagePatterns = [
        /placeholder/i,
        /no[-_]?image/i,
        /missing/i,
        /default[-_]?product/i
      ];
      
      for (let i = 0; i < data.images.length; i++) {
        const imgUrl = data.images[i];
        if (typeof imgUrl === 'string') {
          for (const pattern of suspiciousImagePatterns) {
            if (pattern.test(imgUrl)) {
              anomalies.push({
                field: `images[${i}]`,
                description: 'Image URL appears to be a placeholder',
                value: imgUrl
              });
              break;
            }
          }
          
          // Validate image file extension
          if (!/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(imgUrl)) {
            anomalies.push({
              field: `images[${i}]`,
              description: 'Image URL has an unusual file extension',
              value: imgUrl
            });
          }
        }
      }
    }
    
    return { anomalies };
  }
  
  /**
   * Cross-validate data from multiple sources
   * @param {Object} data - Data with multiple sources
   * @returns {Object} - Cross-validation results
   * @private
   */
  _performCrossValidation(data) {
    const errors = [];
    let serious = false;
    
    // Skip if there are no multiple sources
    if (!data._sources || !Array.isArray(data._sources) || data._sources.length <= 1) {
      return { errors, serious };
    }
    
    // For each field that has multiple sources, compare values
    for (const [field, value] of Object.entries(data)) {
      // Skip metadata fields
      if (field.startsWith('_') || field === 'sources') continue;
      
      // Check if we have multiple source values for this field
      const sourceFields = [];
      for (const source of data._sources) {
        const sourceFieldName = `_${source}_${field}`;
        if (data[sourceFieldName] !== undefined) {
          sourceFields.push({
            source,
            value: data[sourceFieldName]
          });
        }
      }
      
      // If we have multiple source values, compare them
      if (sourceFields.length > 1) {
        // For numeric values, check if they're within tolerance
        if (typeof value === 'number' || !isNaN(Number(value))) {
          const numValues = sourceFields.map(sf => 
            typeof sf.value === 'number' ? sf.value : Number(String(sf.value).replace(/[^0-9.]/g, '')));
          
          const nonNanValues = numValues.filter(v => !isNaN(v));
          if (nonNanValues.length > 1) {
            const min = Math.min(...nonNanValues);
            const max = Math.max(...nonNanValues);
            
            // Calculate relative difference
            const relativeDiff = min === 0 ? Infinity : (max - min) / min;
            
            // If difference is more than 10%, flag it
            if (relativeDiff > 0.1) {
              errors.push({
                field,
                message: `Inconsistent numeric values from different sources (${relativeDiff.toFixed(2)}% difference)`,
                sources: sourceFields.map(sf => ({ source: sf.source, value: sf.value }))
              });
              
              // If difference is very large, mark as serious
              if (relativeDiff > 0.5) {
                serious = true;
              }
            }
          }
        } 
        // For string values, check if they're similar
        else if (typeof value === 'string') {
          const stringValues = sourceFields.map(sf => String(sf.value).trim());
          
          // Calculate string similarity using simple comparison
          const allSame = stringValues.every(v => v === stringValues[0]);
          
          if (!allSame) {
            // Check if strings are similar using character overlap
            const mostlyDifferent = this._calculateStringSimilarity(stringValues) < 0.5;
            
            if (mostlyDifferent) {
              errors.push({
                field,
                message: `Text values from different sources are significantly different`,
                sources: sourceFields.map(sf => ({ source: sf.source, value: sf.value }))
              });
              
              // Mark as serious if completely different
              if (this._calculateStringSimilarity(stringValues) < 0.2) {
                serious = true;
              }
            }
          }
        }
      }
    }
    
    return { errors, serious };
  }
  
  /**
   * Calculate similarity between strings (0-1)
   * @param {string[]} strings - Array of strings to compare
   * @returns {number} - Similarity score (0-1)
   * @private
   */
  _calculateStringSimilarity(strings) {
    if (strings.length <= 1) return 1;
    
    // Simple bag-of-words similarity
    const words = strings.map(s => 
      s.toLowerCase().split(/\W+/).filter(w => w.length > 0));
    
    // Get unique words from all strings
    const uniqueWords = new Set();
    words.forEach(wordArray => {
      wordArray.forEach(word => uniqueWords.add(word));
    });
    
    // For each string, calculate how many unique words it contains
    const wordCounts = words.map(wordArray => {
      const uniqueSet = new Set(wordArray);
      return uniqueSet.size;
    });
    
    // Calculate Jaccard similarity between all pairs
    let totalSimilarity = 0;
    let pairs = 0;
    
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const set1 = new Set(words[i]);
        const set2 = new Set(words[j]);
        
        // Calculate intersection
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        
        // Calculate union
        const union = new Set([...set1, ...set2]);
        
        // Calculate Jaccard similarity
        const similarity = union.size === 0 ? 1 : intersection.size / union.size;
        
        totalSimilarity += similarity;
        pairs++;
      }
    }
    
    // Return average similarity
    return pairs === 0 ? 1 : totalSimilarity / pairs;
  }
  
  /**
   * Validate image by checking if it's loaded correctly
   * @param {import('playwright').Page} page - Playwright page
   * @param {string} imageUrl - URL of the image to check
   * @returns {Promise<Object>} - Validation result
   */
  async validateImage(page, imageUrl) {
    if (!page || !imageUrl) {
      return { valid: false, error: 'Missing page or image URL' };
    }
    
    try {
      // Check if the image loads correctly
      const isValid = await page.evaluate(async (url) => {
        return new Promise((resolve) => {
          const img = new Image();
          
          img.onload = () => {
            // Check if image has reasonable dimensions
            const validDimensions = img.width > 10 && img.height > 10;
            
            // Create canvas to check if image has content
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(img.width, 50); // Sample a small area
            canvas.height = Math.min(img.height, 50);
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            // Check if image has non-white/transparent content
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            
            let hasContent = false;
            for (let i = 0; i < data.length; i += 4) {
              // If any pixel is not white/transparent
              if (data[i+3] > 10 && (data[i] < 245 || data[i+1] < 245 || data[i+2] < 245)) {
                hasContent = true;
                break;
              }
            }
            
            resolve({ 
              valid: validDimensions && hasContent,
              width: img.width,
              height: img.height,
              hasContent
            });
          };
          
          img.onerror = () => {
            resolve({ valid: false, error: 'Failed to load image' });
          };
          
          img.src = url;
        });
      }, imageUrl);
      
      return isValid;
    } catch (error) {
      logger.warn('Error validating image', { imageUrl }, error);
      return { valid: false, error: error.message };
    }
  }
  
  /**
   * Test against known samples
   * @param {string} id - Sample ID
   * @param {Object} actualData - Actual scraped data
   * @returns {Object} - Test results
   */
  testAgainstSample(id, actualData) {
    const sample = this.knownSamples.get(id);
    if (!sample) {
      return { 
        valid: false, 
        error: `No sample found with ID ${id}` 
      };
    }
    
    const differences = [];
    const { dataType, expectedData } = sample;
    
    // Compare each field in the expected data
    for (const [field, expectedValue] of Object.entries(expectedData)) {
      const actualValue = actualData[field];
      
      if (actualValue === undefined) {
        differences.push({
          field,
          expected: expectedValue,
          actual: 'undefined',
          message: 'Field is missing in actual data'
        });
        continue;
      }
      
      // Different comparison strategies based on field type
      if (typeof expectedValue === 'number') {
        // For numbers, allow small differences
        const actualNum = typeof actualValue === 'string' 
          ? parseFloat(actualValue.replace(/[^0-9.]/g, ''))
          : actualValue;
          
        if (isNaN(actualNum)) {
          differences.push({
            field,
            expected: expectedValue,
            actual: actualValue,
            message: 'Expected number but got non-numeric value'
          });
        } else if (Math.abs(expectedValue - actualNum) / Math.max(1, expectedValue) > 0.1) {
          // Allow 10% difference for numbers
          differences.push({
            field,
            expected: expectedValue,
            actual: actualNum,
            message: 'Numeric value differs by more than 10%'
          });
        }
      } else if (typeof expectedValue === 'string') {
        // For strings, check if they're similar
        const similarity = this._calculateStringSimilarity([expectedValue, String(actualValue)]);
        if (similarity < 0.7) {
          differences.push({
            field,
            expected: expectedValue,
            actual: actualValue,
            message: 'Text value is significantly different',
            similarity
          });
        }
      } else if (Array.isArray(expectedValue)) {
        // For arrays, check length and sample contents
        if (!Array.isArray(actualValue)) {
          differences.push({
            field,
            expected: `Array with ${expectedValue.length} items`,
            actual: actualValue,
            message: 'Expected array but got non-array value'
          });
        } else if (expectedValue.length > 0 && actualValue.length === 0) {
          differences.push({
            field,
            expected: `Array with ${expectedValue.length} items`,
            actual: 'Empty array',
            message: 'Expected non-empty array but got empty array'
          });
        }
      } else if (typeof expectedValue === 'boolean') {
        // For booleans, check exact match
        if (actualValue !== expectedValue) {
          differences.push({
            field,
            expected: expectedValue,
            actual: actualValue,
            message: 'Boolean value does not match'
          });
        }
      }
    }
    
    return {
      valid: differences.length === 0,
      dataType,
      differences,
      sampleId: id
    };
  }
  
  /**
   * Register default schemas and rules for common data types
   */
  registerDefaults() {
    // Product schema
    this.registerSchema('product', {
      required: ['title', 'price'],
      properties: {
        title: { type: 'string', minLength: 3 },
        price: { type: 'number', minimum: 0 },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        description: { type: 'string' },
        sku: { type: 'string' },
        availability: { type: 'string' },
        brand: { type: 'string' },
        images: { type: 'array', items: { type: 'string', format: 'url' } },
        rating: { type: 'number', minimum: 0, maximum: 5 },
        reviewCount: { type: 'number', minimum: 0 }
      }
    });
    
    // Price anomaly detection
    this.registerAnomalyRule(
      'product', 
      'price', 
      (price) => price === 0 || price === 0.0 || price === '0' || price === '0.0', 
      'Price is zero, likely a placeholder or error'
    );
    
    this.registerAnomalyRule(
      'product',
      'price',
      (price, data) => {
        // Check if price is significantly lower than typical products in this category
        // This is just an example - you would configure thresholds per category
        const numPrice = typeof price === 'string' ? parseFloat(price.replace(/[^0-9.]/g, '')) : price;
        
        // For example, electronics shouldn't be $1
        if (data.category === 'electronics' && numPrice < 5) {
          return true;
        }
        
        return false;
      },
      'Price is suspiciously low for product category'
    );
    
    // Description anomaly detection
    this.registerAnomalyRule(
      'product',
      'description',
      (description) => {
        if (!description) return false;
        
        // Check for placeholder descriptions
        const placeholders = [
          /no description( available)?/i,
          /description( to be added)?/i,
          /coming soon/i,
          /placeholder/i,
          /lorem ipsum/i
        ];
        
        return placeholders.some(pattern => pattern.test(description));
      },
      'Description appears to be a placeholder'
    );
  }
  
  /**
   * Get validation statistics
   * @returns {Object} - Validation stats
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Cross-verify data from multiple sources and check for inconsistencies
   * @param {Object} data - The data to cross-verify
   * @param {Array<string>} sources - List of source names
   * @param {Object} options - Verification options
   * @returns {Promise<Object>} - Verification results
   */
  async crossVerifyData(data, sources, options = {}) {
    const {
      threshold = 0.1,  // Threshold for numerical differences
      stringSimilarityThreshold = 0.7,  // Threshold for string similarity
      fieldsToCompare = Object.keys(data).filter(k => !k.startsWith('_')),
      strictMode = false  // Whether to fail on any inconsistency
    } = options;
    
    const result = {
      valid: true,
      inconsistencies: [],
      warnings: []
    };
    
    // If there's only one source, we can't cross-verify
    if (sources.length <= 1) {
      result.warnings.push('Cannot cross-verify with only one source');
      return result;
    }
    
    // Get source-specific data
    const sourceData = {};
    for (const source of sources) {
      sourceData[source] = {};
      for (const field of fieldsToCompare) {
        const sourceFieldKey = `${source}_${field}`;
        if (data[sourceFieldKey] !== undefined) {
          sourceData[source][field] = data[sourceFieldKey];
        }
      }
    }
    
    // Compare fields across sources
    for (const field of fieldsToCompare) {
      const values = [];
      const sourcesWithField = [];
      
      for (const source of sources) {
        if (sourceData[source][field] !== undefined) {
          values.push(sourceData[source][field]);
          sourcesWithField.push(source);
        }
      }
      
      // Need at least two sources to compare
      if (values.length < 2) continue;
      
      // Handle different types of data
      if (values.every(v => typeof v === 'number' || !isNaN(Number(v)))) {
        // Numeric comparison
        const numericValues = values.map(v => typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, '')));
        const validNumbers = numericValues.filter(v => !isNaN(v));
        
        if (validNumbers.length >= 2) {
          const min = Math.min(...validNumbers);
          const max = Math.max(...validNumbers);
          const diff = min === 0 ? (max > 0 ? 1 : 0) : (max - min) / min;
          
          if (diff > threshold) {
            const inconsistency = {
              field,
              message: `Numeric values differ by ${(diff * 100).toFixed(1)}%`,
              values: sourcesWithField.map((source, i) => ({ source, value: values[i] }))
            };
            result.inconsistencies.push(inconsistency);
            
            // Mark as invalid in strict mode or if difference is very large
            if (strictMode || diff > threshold * 5) {
              result.valid = false;
            }
          }
        }
      } else if (values.every(v => typeof v === 'string')) {
        // String comparison
        const similarity = this._calculateStringSimilarity(values);
        if (similarity < stringSimilarityThreshold) {
          const inconsistency = {
            field,
            message: `String values have low similarity (${(similarity * 100).toFixed(1)}%)`,
            values: sourcesWithField.map((source, i) => ({ source, value: values[i] }))
          };
          result.inconsistencies.push(inconsistency);
          
          // Mark as invalid in strict mode or if similarity is very low
          if (strictMode || similarity < stringSimilarityThreshold * 0.5) {
            result.valid = false;
          }
        }
      } else if (values.every(v => Array.isArray(v))) {
        // Array comparison
        const lengths = values.map(v => v.length);
        const minLength = Math.min(...lengths);
        const maxLength = Math.max(...lengths);
        
        // If array lengths differ significantly
        if (minLength < maxLength * 0.7) {
          const inconsistency = {
            field,
            message: `Array lengths differ significantly (${minLength} vs ${maxLength})`,
            values: sourcesWithField.map((source, i) => ({ source, value: `Array[${values[i].length}]` }))
          };
          result.inconsistencies.push(inconsistency);
          
          if (strictMode) {
            result.valid = false;
          }
        }
      }
      // Other types are skipped
    }
    
    // Log findings
    if (result.inconsistencies.length > 0) {
      logger.warn(`Found ${result.inconsistencies.length} inconsistencies across sources`, {
        inconsistencies: result.inconsistencies.length,
        fieldCount: fieldsToCompare.length
      });
    }
    
    return result;
  }

  /**
   * Verify data integrity by checking for anomalies and inconsistencies
   * @param {Object} data - Data to verify
   * @param {Object} options - Verification options
   * @returns {Promise<Object>} - Verification results
   */
  async verifyDataIntegrity(data, options = {}) {
    const {
      dataType,
      performSchemaValidation = true,
      performAnomalyDetection = true,
      performCrossVerification = true,
      validateImages = false,
      checkAgainstSamples = false,
      sampleIds = [],
      strictValidation = false
    } = options;
    
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      details: {}
    };
    
    // 1. Schema validation
    if (performSchemaValidation && dataType) {
      const schemaResult = schemaValidator.validate(dataType, data);
      result.details.schema = schemaResult;
      
      if (!schemaResult.valid) {
        result.valid = false;
        result.errors.push(...schemaResult.errors.map(err => `Schema validation failed: ${err.field} - ${err.message}`));
      }
    }
    
    // 2. Anomaly detection
    if (performAnomalyDetection) {
      const anomalyResult = this._detectAnomalies(dataType || 'unknown', data);
      result.details.anomalies = anomalyResult;
      
      if (anomalyResult.anomalies.length > 0) {
        result.warnings.push(...anomalyResult.anomalies.map(a => `Anomaly detected: ${a.field} - ${a.message}`));
        
        // In strict mode, anomalies make the data invalid
        if (strictValidation) {
          result.valid = false;
        }
      }
    }
    
    // 3. Cross-verification if multiple sources
    if (performCrossVerification && data._sources && data._sources.length > 1) {
      const crossVerifyResult = await this.crossVerifyData(data, data._sources, {
        strictMode: strictValidation
      });
      result.details.crossVerification = crossVerifyResult;
      
      if (!crossVerifyResult.valid) {
        result.valid = false;
        result.errors.push(...crossVerifyResult.inconsistencies.map(i => `Cross-verification failed: ${i.field} - ${i.message}`));
      } else if (crossVerifyResult.inconsistencies.length > 0) {
        result.warnings.push(...crossVerifyResult.inconsistencies.map(i => `Possible inconsistency: ${i.field} - ${i.message}`));
      }
    }
    
    // 4. Image validation
    if (validateImages && data.images && Array.isArray(data.images)) {
      try {
        const imageResults = await imageValidator.validateMultipleImages(data.images);
        result.details.images = imageResults;
        
        const invalidImages = imageResults.filter(r => !r.valid);
        if (invalidImages.length > 0) {
          result.warnings.push(`${invalidImages.length} of ${data.images.length} images failed validation`);
          
          // In strict mode, invalid images make the data invalid
          if (strictValidation && invalidImages.length > data.images.length * 0.5) {
            result.valid = false;
            result.errors.push(`Majority of images (${invalidImages.length}/${data.images.length}) failed validation`);
          }
        }
      } catch (error) {
        logger.error('Error validating images', {}, error);
        result.warnings.push(`Image validation error: ${error.message}`);
      }
    }
    
    // 5. Sample testing
    if (checkAgainstSamples && sampleIds.length > 0) {
      const sampleResults = [];
      
      for (const sampleId of sampleIds) {
        const sampleResult = this.testAgainstSample(sampleId, data);
        sampleResults.push({ id: sampleId, ...sampleResult });
        
        if (!sampleResult.valid) {
          result.warnings.push(`Failed sample test ${sampleId}: ${sampleResult.differences.length} differences found`);
          
          // In strict mode, sample test failures make the data invalid
          if (strictValidation) {
            result.valid = false;
            result.errors.push(`Sample test ${sampleId} failed: Data does not match expected values`);
          }
        }
      }
      
      result.details.sampleTests = sampleResults;
    }
    
    // Log overall result
    if (!result.valid) {
      logger.warn(`Data integrity verification failed`, {
        errors: result.errors.length,
        warnings: result.warnings.length,
        dataType
      });
    } else if (result.warnings.length > 0) {
      logger.info(`Data integrity verified with warnings`, {
        warnings: result.warnings.length,
        dataType
      });
    } else {
      logger.debug(`Data integrity successfully verified`, { dataType });
    }
    
    return result;
  }
}

// Export a singleton instance
const validator = new DataValidator();

// Initialize with default schemas and rules
validator.registerDefaults();

module.exports = validator; 