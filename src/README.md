# Refactored Scraper Server

A high-performance, resilient, and modular web scraping server built with Node.js and Playwright.

## Features

- **Modular Architecture**: Clean separation between components (adapters, services, controllers)
- **Adapter Pattern**: Support for multiple marketplaces with unified interface
- **Robust Error Handling**: Granular try/catch blocks with context-aware logging
- **Anti-Detection Measures**: User-agent rotation, fingerprint masking, proxy support
- **Captcha Handling**: Automatic captcha detection and solving strategies
- **Proxy Management**: Smart rotation with success/failure tracking
- **Caching**: In-memory and database caching with TTL support
- **Concurrency Control**: Managed parallel scraping with configurable limits
- **Monitoring & Logging**: Structured JSON logs and performance metrics
- **Resource Management**: Memory monitoring and automatic cleanup

## Project Structure

```
src/
├── adapters/            # Site-specific adapters
│   ├── AbstractAdapter.js    # Base adapter interface
│   ├── AdapterFactory.js     # Factory for creating/managing adapters
│   └── ViaVarejoAdapter.js   # Adapter for Via Varejo sites
├── config/              # Configuration management
│   └── index.js              # Central config with env var handling
├── controllers/         # Main application controllers
│   └── scraperController.js  # Core scraping logic
├── middlewares/         # Express middlewares
├── models/              # Data models
├── services/            # Shared services
│   ├── browser/              # Browser management
│   │   ├── browserService.js  # Browser service
│   │   └── stealthPlugin.js   # Anti-detection plugin
│   ├── cache/                # Caching
│   │   └── cacheService.js    # Cache service
│   ├── captcha/              # Captcha handling
│   │   └── captchaService.js  # Captcha service
│   ├── database/             # Database interactions
│   │   └── supabaseService.js # Supabase service
│   ├── notification/         # Notifications
│   │   └── emailService.js    # Email service
│   ├── proxy/                # Proxy management
│   │   └── proxyManager.js    # Proxy service
│   └── queue/                # Task queuing
│       └── taskQueue.js       # Concurrency management
├── utils/               # Utilities
│   ├── logger.js             # Logging utility
│   └── retry.js              # Retry logic with exponential backoff
└── server.js            # Main application entry point
```

## Getting Started

### Prerequisites

- Node.js 20.0.0 or higher
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment variables example:
   ```bash
   cp .env.example .env
   ```
4. Customize the `.env` file with your settings

### Running the Server

Development mode with auto-reload:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### GET /health
Health check endpoint that returns server status and stats.

### GET /scrape-price?url=PRODUCT_URL
Scrape price data from a single URL.

### POST /scrape-batch
Scrape price data from multiple URLs in parallel.

Request body:
```json
{
  "urls": ["URL1", "URL2", "URL3"],
  "concurrency": 5
}
```

## Configuration

The application is highly configurable through environment variables:

- **Server**: `PORT`, `NODE_ENV`
- **Browser**: `BROWSER_POOL_SIZE`, `MAX_CONCURRENT_SCRAPES`, etc.
- **Proxies**: `USE_PROXIES`, `PROXY_ROTATION_STRATEGY`, etc.
- **Cache**: `CACHE_ENABLED`, `CACHE_TTL`
- **Captcha**: `CAPTCHA_SERVICE`, `CAPTCHA_API_KEY`
- **Database**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- **Email**: `EMAIL_TO`, `EMAIL_FROM`, etc.

See `.env.example` for all available options.

## Adding New Site Adapters

To add support for a new marketplace, create a new adapter class that extends `AbstractAdapter`:

1. Create a file in `src/adapters/<SiteName>Adapter.js`
2. Implement the required methods (`extract`, `extractPriceFromHTML`, etc.)
3. Register the adapter in `AdapterFactory.js`

## Future Improvements

- Migrate to TypeScript for better type safety
- Add Puppeteer Cluster support for improved resource management
- Implement Redis-based distributed task queue
- Add more sophisticated anti-bot fingerprinting techniques
- Create a web dashboard for monitoring and management
- Implement proxy rotation frameworks
- Add support for headless Chrome/Firefox fallbacks
- Add comprehensive test suite with mocked HTML responses

## License

MIT 