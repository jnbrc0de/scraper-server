import { supabase } from './supabaseClient';

export async function scrapeAndCache(url: string): Promise<{ price: number | null, error?: string }> {
  // Verifica cache
  const { data: cache, error: cacheError } = await supabase
    .from('scrape_cache')
    .select('price, expires_at')
    .eq('url', url)
    .single();

  if (cache && cache.expires_at && new Date(cache.expires_at) > new Date()) {
    return { price: cache.price };
  }

  // ...scraping real (exemplo fictício)...
  let price: number | null = null;
  let error: string | undefined = undefined;
  try {
    // price = await realScrapingFunction(url);
    price = Math.random() * 100; // mock
  } catch (e: any) {
    error = e.message;
  }

  // Salva no cache e no report
  if (price !== null) {
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 horas
    const cachedAt = new Date().toISOString();
    await supabase.from('scrape_cache').upsert([
      { url, price, cached_at: cachedAt, expires_at: expiresAt }
    ]);
  }
  await supabase.from('scraping_reports').insert([
    { url, price, success: price !== null, error, scraped_at: new Date().toISOString() }
  ]);

  return { price, error };
}