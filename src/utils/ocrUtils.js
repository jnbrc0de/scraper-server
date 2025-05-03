/**
 * OCR Utilities for Captcha Solving
 * Provides tools for image processing and OCR using Tesseract.js
 */
const Tesseract = require('tesseract.js');
const Jimp = require('jimp');
const logger = require('./logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Preprocess image for better OCR accuracy
 * @param {string} imagePath - Path to input image
 * @param {string} outputPath - Path to save processed image
 * @returns {Promise<string>} - Path to processed image
 */
async function preprocessImage(imagePath, outputPath) {
  try {
    // Load image
    const image = await Jimp.read(imagePath);
    
    // Apply preprocessing
    image
      .grayscale() // Convert to grayscale
      .contrast(0.5) // Increase contrast
      .normalize() // Normalize colors
      .brightness(0.05) // Slight brightness increase
      .threshold({ max: 200 }); // Apply threshold for noise reduction
    
    // Save processed image
    await image.writeAsync(outputPath);
    return outputPath;
  } catch (error) {
    logger.error('Error preprocessing image', { imagePath }, error);
    return imagePath; // Return original if processing fails
  }
}

/**
 * Perform OCR on an image
 * @param {string} imagePath - Path to image
 * @param {Object} options - OCR options
 * @returns {Promise<string>} - Extracted text
 */
async function performOCR(imagePath, options = {}) {
  try {
    // Create temp folder for processed images if it doesn't exist
    const tempDir = path.resolve(process.cwd(), 'temp');
    await fs.mkdir(tempDir, { recursive: true }).catch(() => {});
    
    // Preprocess image for better OCR results
    const processedImagePath = path.join(tempDir, `processed-${path.basename(imagePath)}`);
    await preprocessImage(imagePath, processedImagePath);
    
    // Perform OCR
    const { data } = await Tesseract.recognize(
      processedImagePath,
      options.lang || 'eng',
      {
        logger: m => logger.debug('Tesseract log', { message: m }),
        ...options
      }
    );
    
    // Clean up text
    const text = data.text
      .trim()
      .replace(/\s+/g, '') // Remove whitespace
      .replace(/[^a-zA-Z0-9]/g, ''); // Keep only alphanumeric
    
    logger.debug('OCR result', { text, imagePath });
    
    // Clean up temp file
    await fs.unlink(processedImagePath).catch(() => {});
    
    return text;
  } catch (error) {
    logger.error('OCR failed', { imagePath }, error);
    return '';
  }
}

/**
 * Detect and solve simple captchas using OCR
 * @param {string} imagePath - Path to captcha image
 * @returns {Promise<string|null>} - Captcha solution or null if failed
 */
async function solveCaptcha(imagePath) {
  try {
    // Specialized settings for captchas
    const options = {
      lang: 'eng',
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    };
    
    // First attempt
    let text = await performOCR(imagePath, options);
    
    // If result is too short or too long, likely incorrect
    if (text.length < 3 || text.length > 10) {
      // Try with different preprocessing
      const tempDir = path.resolve(process.cwd(), 'temp');
      const altImagePath = path.join(tempDir, `alt-${path.basename(imagePath)}`);
      
      // Load image with alternative preprocessing
      const image = await Jimp.read(imagePath);
      image
        .grayscale()
        .invert() // Try inverted colors
        .contrast(0.7)
        .writeAsync(altImagePath);
      
      // Second OCR attempt
      text = await performOCR(altImagePath, options);
      
      // Clean up
      await fs.unlink(altImagePath).catch(() => {});
    }
    
    return text.length >= 3 && text.length <= 8 ? text : null;
  } catch (error) {
    logger.error('Captcha solving failed', { imagePath }, error);
    return null;
  }
}

module.exports = {
  performOCR,
  preprocessImage,
  solveCaptcha
}; 