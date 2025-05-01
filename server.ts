import express from 'express';
import cors from 'cors';
import { scrapeAndCache } from './scraper';
import { supabase } from './supabaseClient';

const app: express.Application = express();
app.use(cors());
app.use(express.json());

// Endpoint para scraping
app.post('/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const result = await scrapeAndCache(url);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// Endpoint para consultar cache
app.get('/cache', async (req, res) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : undefined;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const { data, error } = await supabase
      .from('scrape_cache')
      .select('price, cached_at, expires_at')
      .eq('url', url)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// Endpoint para consultar reports
app.get('/reports', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('scraping_reports')
      .select('*')
      .order('scraped_at', { ascending: false })
      .limit(20);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Scraper server running on port ${port}`);
});
