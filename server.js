const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { scrapePrice } = require('./scrape');

const app = express();
const port = process.env.PORT || 3000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/scrape-price', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success: false, error: 'Missing url' });

  try {
    const result = await scrapePrice(url);
    if (!result.success) throw new Error(result.error || 'Unknown scraping error');
    // Persist data in Supabase (cache history)
    await supabase.from('scrape_cache').upsert({
      url,
      price: result.price,
      cached: result.cached,
      scraped_at: new Date().toISOString()
    }, { onConflict: 'url' });
    res.json(result);
  } catch (err) {
    // Log error
    try {
      await supabase.from('scraping_reports').insert({
        url,
        success: false,
        error: err.message,
        scraped_at: new Date().toISOString()
      });
    } catch (e) {
      // Ignore Supabase logging errors
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(port, () => console.log(`Scraper running on port ${port}`));