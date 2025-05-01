import { supabase } from './supabaseClient';

export async function scrapeAndCache(url: string): Promise<{ price: number | null, error?: string }> {
  // Verifica cache
  const { data: cache, error: cacheError } = await supabase
    .from('scrape_cache')
    .select('price, expires_at')
    .eq('url', url)
    .single();

  if (cache && new Date(cache.expires_at) > new Date()) {
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
    await supabase.from('scrape_cache').upsert([
      { url, price }
    ]);
  }
  await supabase.from('scraping_reports').insert([
    { url, price, success: price !== null, error }
  ]);

  return { price, error };
}