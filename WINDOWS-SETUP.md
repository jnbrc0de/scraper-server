# Windows Setup Guide for Scraper Server

This guide provides solutions for common issues when running the scraper server on Windows, particularly browser installation problems.

## Common Issues

### 1. Error installing Playwright browsers

```
error installing Playwright browsers: Command failed: npx playwright install --with-deps chromium
```

This error occurs when Playwright fails to download and install its bundled browser. This is common on Windows due to various factors like network restrictions, permissions, or antivirus blocking.

## Quick Fix

Run the following command to use your local Chrome installation instead of Playwright's browsers:

```bash
npm run setup-windows
```

This command:
1. Finds your local Chrome installation
2. Configures the environment to use it
3. Creates mock directories to satisfy Playwright
4. Patches the application code
5. Prevents future browser download attempts

## Manual Fix Steps

If the automatic fix doesn't work, here are the manual steps:

1. **Find your Chrome installation path**:
   - Usually at `C:\Program Files\Google\Chrome\Application\chrome.exe`
   - Or at `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`

2. **Create browser-config.json**:
   ```json
   {"chromiumPath":"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"}
   ```

3. **Add environment variables**:
   Create a file named `.env.local` with:
   ```
   CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
   PLAYWRIGHT_BROWSERS_PATH=0
   ```

4. **Create mock browser directories**:
   ```bash
   mkdir -p node_modules/playwright-core/.local-browsers/chromium-1069
   ```

5. **Fix dependencies**:
   ```bash
   npm run fix-dependencies
   ```

## Available Fix Scripts

- `npm run setup-windows` - Comprehensive fix for Windows (recommended)
- `npm run fix-windows-browser` - Just fix browser issues on Windows
- `npm run fix-dependencies` - Fix plugin dependencies
- `npm run fix-browser` - Generic browser installation fix

## Starting the Server

After applying the fixes, start the server with:

```bash
npm run start:win
```

## Troubleshooting

If you still encounter issues:

1. **Check Chrome installation**:
   Make sure Google Chrome is installed and the path in `browser-config.json` is correct.

2. **Check permissions**:
   Ensure you have permissions to access the Chrome executable.

3. **Dependency issues**:
   Run `npm install` to ensure all dependencies are properly installed.

4. **Antivirus issues**:
   Temporarily disable antivirus or add exceptions for the application.

5. **Duplicate CHROME_PATH**:
   If you see an error about duplicate CHROME_PATH, edit `src/services/browser/browserService.js` and make sure there is only one declaration of the CHROME_PATH variable.

## Additional Information

- The application uses your local Chrome installation instead of Playwright's browsers
- The browser-config.json file stores the path to your Chrome executable
- The fix scripts create mock installations to satisfy Playwright's requirements
- Environment variables ensure Playwright doesn't try to download browsers

For more information, see the project documentation. 