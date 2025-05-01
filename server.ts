import express from 'express';
import { scrapeAndCache } from './scraper';
import { supabase } from './supabaseClient';

const app = express();
app.use(express.json());

// Endpoint para scraping
app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const result = await scrapeAndCache(url);
  res.json(result);
});

// Endpoint para consultar cache
app.get('/cache', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  const { data, error } = await supabase
    .from('scrape_cache')
    .select('price, cached_at, expires_at')
    .eq('url', url)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Endpoint para consultar reports
app.get('/reports', async (req, res) => {
  const { data, error } = await supabase
    .from('scraping_reports')
    .select('*')
    .order('scraped_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Scraper server running on port ${port}`);
});
