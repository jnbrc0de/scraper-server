/**
 * Enhanced Anti-Detection Module
 * Provides advanced evasion techniques to mimic human behavior and prevent scraper detection
 */
const logger = require('./logger');
const config = require('../config');

/**
 * Simulates realistic mouse movement with acceleration/deceleration
 * @param {import('playwright').Page} page - Playwright page
 * @param {Object} target - Target coordinates {x, y}
 * @param {Object} options - Mouse movement options
 * @returns {Promise<void>}
 */
async function simulateRealisticMouseMovement(page, target, options = {}) {
  const {
    steps = 10,
    minStepDuration = 5,
    maxStepDuration = 15,
    initialDelay = 20,
    finalDelay = 10,
    overshootProbability = 0.3,
    jitterFactor = 0.15
  } = options;

  if (!page || page.isClosed()) return;

  try {
    // Get current mouse position or use a default starting point
    const startPos = { x: 100, y: 100 }; // Default starting position
    
    // Get viewport size for bounds checking
    const viewportSize = await page.evaluate(() => {
      return {
        width: window.innerWidth,
        height: window.innerHeight
      };
    });
    
    // Ensure target is within viewport bounds
    const boundedTarget = {
      x: Math.min(Math.max(target.x, 0), viewportSize.width),
      y: Math.min(Math.max(target.y, 0), viewportSize.height)
    };
    
    // May add slight initial delay before movement starts
    await page.waitForTimeout(initialDelay);
    
    // Calculate distance to target
    const distance = Math.sqrt(
      Math.pow(boundedTarget.x - startPos.x, 2) + 
      Math.pow(boundedTarget.y - startPos.y, 2)
    );
    
    // Adjust steps based on distance
    const adjustedSteps = Math.max(5, Math.min(Math.floor(distance / 10), steps));
    
    // Create array of points along a bezier curve path
    const points = [];
    
    // Add optional control point for more natural curved movement
    const controlPoint = {
      x: startPos.x + (boundedTarget.x - startPos.x) / 2 + (Math.random() - 0.5) * distance * 0.5,
      y: startPos.y + (boundedTarget.y - startPos.y) / 2 + (Math.random() - 0.5) * distance * 0.5
    };
    
    // Generate points along a bezier curve
    for (let i = 0; i <= adjustedSteps; i++) {
      const t = i / adjustedSteps;
      
      // Quadratic bezier curve formula
      const x = Math.pow(1 - t, 2) * startPos.x + 
                2 * (1 - t) * t * controlPoint.x + 
                Math.pow(t, 2) * boundedTarget.x;
                
      const y = Math.pow(1 - t, 2) * startPos.y + 
                2 * (1 - t) * t * controlPoint.y + 
                Math.pow(t, 2) * boundedTarget.y;
      
      // Add jitter that decreases as we approach the target
      const jitterAmount = jitterFactor * (1 - t);
      const jitterX = (Math.random() - 0.5) * distance * jitterAmount;
      const jitterY = (Math.random() - 0.5) * distance * jitterAmount;
      
      points.push({
        x: Math.round(x + jitterX),
        y: Math.round(y + jitterY)
      });
    }
    
    // Move through each point with variable speed
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const progress = i / points.length;
      
      // Variable speed: start slow, accelerate in middle, slow down at end
      // This creates an ease-in, ease-out effect
      let speedFactor;
      if (progress < 0.2) {
        // Ease in - start slow
        speedFactor = 0.3 + progress * 3.5;
      } else if (progress > 0.8) {
        // Ease out - end slow
        speedFactor = 0.3 + (1 - progress) * 3.5;
      } else {
        // Middle - faster
        speedFactor = 1;
      }
      
      // Calculate step duration based on speed factor
      const stepDuration = maxStepDuration - 
        (maxStepDuration - minStepDuration) * speedFactor;
      
      // Move mouse to the point
      await page.mouse.move(point.x, point.y);
      
      // Add variable delay between movements
      await page.waitForTimeout(stepDuration);
    }
    
    // Occasionally overshoot and correct (like humans do)
    if (Math.random() < overshootProbability) {
      const overshoot = {
        x: boundedTarget.x + (Math.random() - 0.5) * 10,
        y: boundedTarget.y + (Math.random() - 0.5) * 10
      };
      
      await page.mouse.move(overshoot.x, overshoot.y);
      await page.waitForTimeout(100);
      await page.mouse.move(boundedTarget.x, boundedTarget.y);
    }
    
    // Final delay after reaching target
    await page.waitForTimeout(finalDelay);
    
  } catch (error) {
    logger.warn('Error simulating mouse movement', {}, error);
  }
}

/**
 * Simulates realistic human typing with variable speed and occasional errors
 * @param {import('playwright').Page} page - Playwright page
 * @param {string} selector - Element selector to type into
 * @param {string} text - Text to type
 * @param {Object} options - Typing options
 * @returns {Promise<void>}
 */
async function simulateRealisticTyping(page, selector, text, options = {}) {
  const {
    minDelay = 30,
    maxDelay = 100,
    initialDelay = 300,
    typingVariability = 0.5,
    mistakeProbability = 0.05,
    finalDelay = 350
  } = options;

  if (!page || page.isClosed()) return;

  try {
    // Click the field first
    const element = await page.$(selector);
    if (!element) {
      logger.warn(`Element not found for typing: ${selector}`);
      return;
    }
    
    // Get element position for realistic click
    const boundingBox = await element.boundingBox();
    if (!boundingBox) return;
    
    // Click with realistic mouse movement
    const clickTarget = {
      x: boundingBox.x + boundingBox.width / 2 + (Math.random() - 0.5) * 10,
      y: boundingBox.y + boundingBox.height / 2 + (Math.random() - 0.5) * 5
    };
    
    await simulateRealisticMouseMovement(page, clickTarget);
    await page.mouse.click(clickTarget.x, clickTarget.y);
    
    // Wait before starting to type
    await page.waitForTimeout(initialDelay);
    
    // Characters typed per second - varies by person but 200-300 is typical
    // https://en.wikipedia.org/wiki/Typing#Alphanumeric_entry
    const avgTypingSpeed = 250; // chars per minute
    const baseDelay = 60000 / avgTypingSpeed; // milliseconds per character
    
    // Clear any existing value
    await element.fill('');
    
    // Type each character with variable speed
    for (let i = 0; i < text.length; i++) {
      // Decide whether to make a mistake
      if (Math.random() < mistakeProbability) {
        // Type a wrong character
        const charCode = text.charCodeAt(i);
        const mistakeChar = String.fromCharCode(
          charCode + Math.floor((Math.random() - 0.5) * 4)
        );
        
        await page.type(selector, mistakeChar, { delay: 0 });
        
        // Pause as if the user noticed the error
        await page.waitForTimeout(300 + Math.random() * 100);
        
        // Delete the wrong character
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200 + Math.random() * 100);
      }
      
      // Type the correct character
      await page.type(selector, text[i], { delay: 0 });
      
      // Variable delay between keystrokes
      const varianceFactor = 1 + ((Math.random() - 0.5) * 2 * typingVariability);
      
      // Typing speed varies based on character type
      let charDelay = baseDelay * varianceFactor;
      
      // Longer pauses after punctuation
      if (['.', ',', '!', '?', ';', ':'].includes(text[i])) {
        charDelay *= 1.5;
      }
      
      // Longer pauses after spaces (new words)
      if (text[i] === ' ') {
        charDelay *= 1.2;
      }
      
      // Ensure delay is within bounds
      const delay = Math.max(minDelay, Math.min(maxDelay, charDelay));
      
      await page.waitForTimeout(delay);
    }
    
    // Pause after typing is complete (like a human would)
    await page.waitForTimeout(finalDelay);
    
  } catch (error) {
    logger.warn('Error simulating realistic typing', {}, error);
  }
}

/**
 * Applies enhanced browser fingerprint evasion techniques
 * @param {import('playwright').Page} page - Playwright page
 * @param {Object} options - Fingerprint options
 * @returns {Promise<void>}
 */
async function applyAdvancedFingerprintEvasion(page, options = {}) {
  const {
    deviceMemory = 8,
    hardwareConcurrency = 8,
    screenResolution = { width: 1920, height: 1080 },
    batteryLevel = Math.random() * 0.5 + 0.5, // 50-100%
    batteryCharging = Math.random() > 0.3,
    webglVendor = 'Google Inc. (Intel)',
    webglRenderer = 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    doNotTrack = Math.random() > 0.7 ? '1' : null,
    mediaDevices = {
      audioInputs: Math.floor(Math.random() * 2) + 1,
      audioOutputs: Math.floor(Math.random() * 2) + 1,
      videoInputs: Math.floor(Math.random() * 2) 
    },
    addCanvasNoise = true,
    addWebglNoise = true
  } = options;

  if (!page || page.isClosed()) return;

  try {
    // Store the fingerprint in the page for consistent values
    await page.evaluate((fp) => {
      window._fingerprintData = fp;
    }, {
      deviceMemory,
      hardwareConcurrency,
      screenResolution,
      batteryLevel,
      batteryCharging,
      webglVendor,
      webglRenderer,
      doNotTrack,
      mediaDevices,
      timeZoneOffset: new Date().getTimezoneOffset(),
      sessionStorage: Math.random().toString(36).substring(2, 15),
      localStorage: Math.random().toString(36).substring(2, 15)
    });

    // Override device memory
    await page.evaluate(() => {
      const memoryValue = window._fingerprintData.deviceMemory;
      Object.defineProperty(navigator, 'deviceMemory', {
        get: function() { return memoryValue; },
        configurable: true
      });
    });

    // Override hardware concurrency
    await page.evaluate(() => {
      const concurrencyValue = window._fingerprintData.hardwareConcurrency;
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: function() { return concurrencyValue; },
        configurable: true
      });
    });

    // Override screen values
    await page.evaluate(() => {
      const resolution = window._fingerprintData.screenResolution;
      
      for (const screenProp of ['availWidth', 'width']) {
        Object.defineProperty(screen, screenProp, {
          get: function() { return resolution.width; },
          configurable: true
        });
      }
      
      for (const screenProp of ['availHeight', 'height']) {
        Object.defineProperty(screen, screenProp, {
          get: function() { return resolution.height; },
          configurable: true
        });
      }
    });

    // Add Canvas fingerprinting protection
    if (addCanvasNoise) {
      await page.evaluate(() => {
        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        
        // Add subtle noise to canvas data
        CanvasRenderingContext2D.prototype.getImageData = function() {
          const imageData = originalGetImageData.apply(this, arguments);
          
          // Don't modify very small canvases (often used for legitimate purposes)
          if (imageData.width * imageData.height < 256) return imageData;
          
          // Add subtle noise to a small percentage of pixels
          const data = imageData.data;
          const noise = 2; // Maximum noise amount
          
          for (let i = 0; i < data.length; i += 4) {
            // Only modify ~5% of pixels
            if (Math.random() < 0.05) {
              data[i] = Math.max(0, Math.min(255, data[i] + (Math.random() * noise * 2 - noise)));
              data[i+1] = Math.max(0, Math.min(255, data[i+1] + (Math.random() * noise * 2 - noise)));
              data[i+2] = Math.max(0, Math.min(255, data[i+2] + (Math.random() * noise * 2 - noise)));
            }
          }
          
          return imageData;
        };
        
        // Also modify toDataURL for complete protection
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function() {
          // Add noise before converting to data URL
          if (this.width * this.height > 256) {
            const ctx = this.getContext('2d');
            ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.01})`;
            ctx.fillRect(
              Math.random() * this.width, 
              Math.random() * this.height, 
              1, 
              1
            );
          }
          
          return originalToDataURL.apply(this, arguments);
        };
      });
    }

    // Add WebGL fingerprinting protection
    if (addWebglNoise) {
      await page.evaluate((webglData) => {
        const { webglVendor, webglRenderer } = webglData;
        
        // Override WebGL vendor and renderer strings
        const getParameterProxyHandler = {
          apply: function(target, thisArg, args) {
            const param = args[0];
            
            if (param === thisArg.VENDOR) {
              return webglVendor;
            }
            
            if (param === thisArg.RENDERER) {
              return webglRenderer;
            }
            
            // Call the original function for other parameters
            return target.apply(thisArg, args);
          }
        };
        
        // Apply to both WebGL contexts
        const webglTypes = ['WebGLRenderingContext', 'WebGL2RenderingContext'];
        for (const webglType of webglTypes) {
          if (window[webglType]) {
            const prototype = window[webglType].prototype;
            const originalGetParameter = prototype.getParameter;
            prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);
          }
        }
      }, { webglVendor, webglRenderer });
    }

    // Mock battery API
    await page.evaluate(() => {
      if (navigator.getBattery) {
        const batteryLevel = window._fingerprintData.batteryLevel;
        const batteryCharging = window._fingerprintData.batteryCharging;
        
        navigator.getBattery = function() {
          return Promise.resolve({
            charging: batteryCharging,
            chargingTime: batteryCharging ? 0 : Infinity,
            dischargingTime: batteryCharging ? Infinity : Math.floor(Math.random() * 5000) + 1000,
            level: batteryLevel,
            addEventListener: function() {},
            removeEventListener: function() {}
          });
        };
      }
    });

    // Mock connection info
    await page.evaluate(() => {
      if (navigator.connection) {
        const connectionTypes = ['wifi', 'cellular', 'ethernet'];
        const effectiveTypes = ['4g', '3g'];
        
        Object.defineProperties(navigator.connection, {
          type: { 
            get: () => connectionTypes[Math.floor(Math.random() * connectionTypes.length)],
            configurable: true
          },
          effectiveType: { 
            get: () => effectiveTypes[Math.floor(Math.random() * effectiveTypes.length)],
            configurable: true
          },
          downlink: { 
            get: () => (5 + Math.random() * 10).toFixed(1),
            configurable: true
          },
          rtt: { 
            get: () => Math.floor(Math.random() * 50) + 50,
            configurable: true
          },
          saveData: { 
            get: () => false,
            configurable: true
          }
        });
      }
    });

    // Mock media devices info
    await page.evaluate(() => {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        const mediaConfig = window._fingerprintData.mediaDevices;
        
        navigator.mediaDevices.enumerateDevices = function() {
          return originalEnumerateDevices.apply(this, arguments)
            .then(devices => {
              // Filter and adjust devices based on our configuration
              const filteredDevices = [];
              let audioInputCount = 0;
              let audioOutputCount = 0;
              let videoInputCount = 0;
              
              for (const device of devices) {
                const kind = device.kind;
                
                if (kind === 'audioinput' && audioInputCount < mediaConfig.audioInputs) {
                  filteredDevices.push(device);
                  audioInputCount++;
                } else if (kind === 'audiooutput' && audioOutputCount < mediaConfig.audioOutputs) {
                  filteredDevices.push(device);
                  audioOutputCount++;
                } else if (kind === 'videoinput' && videoInputCount < mediaConfig.videoInputs) {
                  filteredDevices.push(device);
                  videoInputCount++;
                }
              }
              
              return filteredDevices;
            });
        };
      }
    });

    // Set consistent Do Not Track value
    await page.evaluate(() => {
      const dntValue = window._fingerprintData.doNotTrack;
      
      Object.defineProperty(navigator, 'doNotTrack', {
        get: function() { return dntValue; },
        configurable: true
      });
    });

    // Simulate language consistency
    await page.evaluate(() => {
      // Force consistent language preferences (based on the Accept-Language header)
      Object.defineProperty(navigator, 'languages', {
        get: function() { 
          return ['en-US', 'en'];
        },
        configurable: true
      });
    });
    
    logger.debug('Applied advanced fingerprint evasion');
  } catch (error) {
    logger.warn('Error applying fingerprint evasion', {}, error);
  }
}

/**
 * Simulates human-like page interaction including scrolling, moving, reading
 * @param {import('playwright').Page} page - Playwright page
 * @param {Object} options - Interaction options
 * @returns {Promise<void>}
 */
async function simulateHumanPageInteraction(page, options = {}) {
  const {
    scrollDepth = 0.8, // How far down the page to scroll (0-1)
    interactionTime = 5000, // How long to interact with the page
    readingMode = true, // Simulate reading by scrolling slowly
    moveCursor = true, // Move cursor during scrolling
    interactionPoints = [] // Specific elements to interact with
  } = options;

  if (!page || page.isClosed()) return;

  try {
    // Get page dimensions
    const dimensions = await page.evaluate(() => {
      return {
        windowHeight: window.innerHeight,
        documentHeight: document.body.scrollHeight,
        documentWidth: document.body.scrollWidth
      };
    });
    
    const scrollTarget = dimensions.documentHeight * scrollDepth;
    const startTime = Date.now();
    
    // Calculate scroll step based on reading mode
    const scrollStep = readingMode ? 
      dimensions.windowHeight / 10 : // Small steps for reading
      dimensions.windowHeight / 3;   // Larger steps for scanning
    
    // Reading speed varies from 200-400 pixels per second depending on content
    const baseScrollDelay = readingMode ? 800 : 300;
    
    // Current scroll position
    let currentScrollY = 0;
    
    // Perform scrolling
    while (currentScrollY < scrollTarget && (Date.now() - startTime) < interactionTime) {
      // Calculate next scroll position with variable step size
      const variability = 0.2; // 20% variability in scroll amount
      const variableStep = scrollStep * (1 + (Math.random() - 0.5) * variability);
      
      // Don't scroll past the target
      const nextScrollY = Math.min(currentScrollY + variableStep, scrollTarget);
      
      // Scroll to the next position
      await page.evaluate((y) => {
        window.scrollTo({
          top: y,
          behavior: 'smooth'
        });
      }, nextScrollY);
      
      // Update current position
      currentScrollY = nextScrollY;
      
      // Move cursor to simulate eye tracking while reading
      if (moveCursor) {
        // Find a random position in the current viewport
        const randomX = Math.floor(Math.random() * (dimensions.documentWidth * 0.8));
        const randomY = Math.floor(currentScrollY + (Math.random() * dimensions.windowHeight * 0.7));
        
        await simulateRealisticMouseMovement(page, { x: randomX, y: randomY }, {
          steps: 5, // Fewer steps for casual movement
          jitterFactor: 0.1
        });
      }
      
      // Occasionally pause as if reading something interesting
      if (readingMode && Math.random() < 0.2) {
        await page.waitForTimeout(800 + Math.random() * 1200);
      }
      
      // Wait before next scroll
      const scrollDelay = baseScrollDelay * (1 + (Math.random() - 0.5) * 0.3);
      await page.waitForTimeout(scrollDelay);
    }
    
    // If specific interaction points were provided, interact with them
    if (interactionPoints && interactionPoints.length > 0) {
      for (const point of interactionPoints) {
        // Find the element
        const element = await page.$(point.selector);
        if (element) {
          // Get element position
          const boundingBox = await element.boundingBox();
          if (boundingBox) {
            // Scroll element into view if needed
            await element.scrollIntoViewIfNeeded();
            
            // Move to the element
            const targetX = boundingBox.x + boundingBox.width / 2;
            const targetY = boundingBox.y + boundingBox.height / 2;
            
            await simulateRealisticMouseMovement(page, { x: targetX, y: targetY });
            
            // Perform the specified action
            if (point.action === 'hover') {
              // Just hover over the element
              await page.waitForTimeout(300 + Math.random() * 700);
            } else if (point.action === 'click') {
              // Click the element
              await page.mouse.click(targetX, targetY);
              await page.waitForTimeout(500 + Math.random() * 500);
            }
          }
        }
      }
    }
    
    logger.debug('Completed human page interaction simulation');
  } catch (error) {
    logger.warn('Error simulating human page interaction', {}, error);
  }
}

module.exports = {
  simulateRealisticMouseMovement,
  simulateRealisticTyping,
  applyAdvancedFingerprintEvasion,
  simulateHumanPageInteraction
}; 