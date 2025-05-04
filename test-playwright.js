const { chromium } = require('playwright');

async function testPlaywright() {
    console.log('Starting Playwright test...');
    
    try {
        // Launch browser
        console.log('Launching browser...');
        const browser = await chromium.launch();
        
        // Create a new page
        const page = await browser.newPage();
        
        // Navigate to a test page
        console.log('Navigating to example.com...');
        await page.goto('https://example.com');
        
        // Get page title
        const title = await page.title();
        console.log('Page title:', title);
        
        // Close browser
        await browser.close();
        console.log('Test completed successfully!');
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

testPlaywright(); 