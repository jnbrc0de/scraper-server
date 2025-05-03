/**
 * Example script demonstrating enhanced anti-detection measures
 */
const ProductScraperAdapter = require('../src/adapters/scraper/productScraperAdapter');
const baseScraperAdapter = require('../src/adapters/scraper/baseScraperAdapter');
const logger = require('../src/utils/logger');
const antiDetection = require('../src/utils/antiDetection');

/**
 * Example demonstrating enhanced anti-detection scraping
 */
async function runStealthScraperExample() {
  logger.info('Starting stealth scraper example');
  
  // Initialize the product scraper with enhanced stealth options
  const scraper = new ProductScraperAdapter({
    humanEmulation: true,
    timeout: 60000, // longer timeout for human-like behavior
    fingerprintOptions: {
      deviceMemory: 8,
      hardwareConcurrency: 8,
      canvasNoise: true,
      webglNoise: true
    }
  });
  
  try {
    // Initialize browser with enhanced fingerprint evasion
    await scraper.initializeBrowser({
      fingerprintOptions: {
        // Customize fingerprint if needed
        webglVendor: 'Google Inc.',
        webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'
      }
    });
    
    // First, navigate to a test page for demonstrating human-like interactions
    await scraper.navigateTo('https://bot.sannysoft.com/', {
      waitForSelector: 'title',
      interactionOptions: {
        scrollDepth: 1.0, // Scroll all the way down
        interactionTime: 5000, // Spend 5 seconds on the page
        readingMode: true
      }
    });
    
    // Wait for page to load and allow time to see the bot detection results
    await scraper.page.waitForTimeout(2000);
    
    // Take a screenshot of the bot detection results
    await scraper.page.screenshot({ path: 'bot-detection-results.png' });
    
    console.log('Screenshot saved as bot-detection-results.png');
    
    // Demonstrate form filling with realistic typing
    // Navigate to a login form
    await scraper.navigateTo('https://httpbin.org/forms/post', {
      waitForSelector: 'form'
    });
    
    // Fill out form fields with realistic typing
    console.log('Filling form with realistic typing...');
    await scraper.fillForm({
      'input[name="custname"]': 'John Smith',
      'input[name="custtel"]': '555-123-4567',
      'input[name="custemail"]': 'john.smith@example.com',
      'textarea[name="comments"]': 'This is a test comment with realistic typing simulation. Notice the variable speed and occasional pauses.',
    }, {
      minTypeDelay: 30,
      maxTypeDelay: 120,
      mistakeProbability: 0.05, // 5% chance of typos that are then corrected
      submitSelector: 'button[type="submit"]',
      waitForNavigation: true
    });
    
    // Wait for form submission result
    await scraper.page.waitForSelector('pre', { timeout: 10000 });
    
    // Extract the form submission result
    const formResult = await scraper.page.evaluate(() => {
      const pre = document.querySelector('pre');
      return pre ? pre.textContent : null;
    });
    
    console.log('\nForm submission result:');
    console.log(formResult);
    
    // Now demonstrate WebGL fingerprinting protection
    console.log('\nTesting WebGL fingerprinting protection...');
    const fingerprint = await scraper.page.evaluate(() => {
      // Create a canvas element for WebGL
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      
      // Check if we can get WebGL information
      if (!gl) {
        return { webgl: false };
      }
      
      // Get vendor and renderer info
      const vendor = gl.getParameter(gl.VENDOR);
      const renderer = gl.getParameter(gl.RENDERER);
      
      // Test canvas fingerprinting
      const canvas2d = document.createElement('canvas');
      canvas2d.width = 200;
      canvas2d.height = 200;
      const ctx = canvas2d.getContext('2d');
      ctx.fillStyle = 'rgb(255,0,0)';
      ctx.fillRect(0, 0, 100, 100);
      ctx.fillStyle = 'rgb(0,255,0)';
      ctx.fillRect(100, 0, 100, 100);
      ctx.fillStyle = 'rgb(0,0,255)';
      ctx.fillRect(0, 100, 100, 100);
      ctx.fillStyle = 'rgb(255,255,0)';
      ctx.fillRect(100, 100, 100, 100);
      
      // Add text (which is often used for fingerprinting)
      ctx.fillStyle = 'rgb(0,0,0)';
      ctx.font = '48px Arial';
      ctx.fillText('Canvas Test', 10, 100);
      
      // Get data URL (hash of this is often used for fingerprinting)
      const dataURL = canvas2d.toDataURL();
      
      // For demonstration, let's hash the dataURL
      let hash = 0;
      for (let i = 0; i < dataURL.length; i++) {
        hash = ((hash << 5) - hash) + dataURL.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
      }
      
      // Get media devices (often used for fingerprinting)
      let mediaDeviceInfo = 'unavailable';
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        mediaDeviceInfo = 'available';
      }
      
      // Get browser features often used for fingerprinting
      return {
        webgl: true,
        vendor,
        renderer,
        canvasHash: hash,
        deviceMemory: navigator.deviceMemory || 'unavailable',
        hardwareConcurrency: navigator.hardwareConcurrency || 'unavailable',
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        mediaDevices: mediaDeviceInfo,
        doNotTrack: navigator.doNotTrack
      };
    });
    
    console.log('Browser fingerprint values:');
    console.log(JSON.stringify(fingerprint, null, 2));
    
    // Run a second time to show values stay consistent
    console.log('\nRe-testing fingerprint to check consistency...');
    const fingerprint2 = await scraper.page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      
      if (!gl) {
        return { webgl: false };
      }
      
      // Get vendor and renderer info
      const vendor = gl.getParameter(gl.VENDOR);
      const renderer = gl.getParameter(gl.RENDERER);
      
      // Get browser features often used for fingerprinting
      return {
        webgl: true,
        vendor,
        renderer,
        deviceMemory: navigator.deviceMemory || 'unavailable',
        hardwareConcurrency: navigator.hardwareConcurrency || 'unavailable',
        platform: navigator.platform
      };
    });
    
    console.log('Second fingerprint check:');
    console.log(JSON.stringify(fingerprint2, null, 2));
    
    logger.info('Stealth scraper example completed successfully');
  } catch (error) {
    logger.error('Error in stealth scraper example', {}, error);
  } finally {
    // Clean up resources
    await scraper.close().catch(() => {});
  }
}

// Only run if directly called (not imported)
if (require.main === module) {
  runStealthScraperExample()
    .then(() => {
      console.log('\nExample completed.');
      process.exit(0);
    })
    .catch(error => {
      console.error('Example failed:', error);
      process.exit(1);
    });
}

module.exports = { runStealthScraperExample }; 