// Iranian E-Commerce Image Scraper (Digikala, Torob, Technolife, JahanBazar)
// Fast, zero-dependency, local Iranian CDN access with high resolution images

async function fetchIranianStoreImage(modelName, category = '') {
  if (!modelName || !modelName.trim()) return null;

  const cleanModel = modelName
    .replace(/HP HP/gi, 'HP')
    .replace(/SFF/gi, '')
    .trim();

  // Search variations
  const queries = [];
  const cat = (category || '').toLowerCase();
  
  if (cat.includes('monitor') || cleanModel.toLowerCase().includes('s27') || cleanModel.toLowerCase().includes('p23') || cleanModel.toLowerCase().includes('mk40')) {
    queries.push(`مانیتور ${cleanModel}`);
    queries.push(`مانیتور ${cleanModel.split(' ')[0]}`);
  } else if (cat.includes('laptop')) {
    queries.push(`لپ تاپ ${cleanModel}`);
  } else {
    queries.push(`کیس استوک ${cleanModel}`);
    queries.push(`مینی کیس ${cleanModel}`);
    queries.push(cleanModel);
  }

  // 1. Digikala API (Fastest and highest resolution 800x800)
  for (const q of queries) {
    try {
      const url = `https://api.digikala.com/v1/search/?q=${encodeURIComponent(q)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);

      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: ctrl.signal
      });
      clearTimeout(timer);

      if (resp.ok) {
        const json = await resp.json();
        const products = json?.data?.products;
        if (Array.isArray(products) && products.length > 0) {
          const imgUrl = products[0]?.images?.main?.url;
          let finalUrl = Array.isArray(imgUrl) ? imgUrl[0] : (typeof imgUrl === 'string' ? imgUrl : null);
          if (finalUrl) {
            finalUrl = finalUrl.split('?')[0] + '?x-oss-process=image/resize,m_lfit,h_800,w_800/quality,q_90';
            return { url: finalUrl, source: 'دیجی‌کالا (Digikala)' };
          }
        }
      }
    } catch (e) {}
  }

  // 2. Torob API (Comprehensive aggregator across JahanBazar, Technolife, Digikala & 100+ stores)
  for (const q of queries) {
    try {
      const url = `https://api.torob.com/v4/base-product/search/?sort=popularity&page=0&size=5&query=${encodeURIComponent(q)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);

      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: ctrl.signal
      });
      clearTimeout(timer);

      if (resp.ok) {
        const json = await resp.json();
        const results = json?.results;
        if (Array.isArray(results) && results.length > 0 && results[0].image_url) {
          return { url: results[0].image_url, source: 'ترب و جهان‌بازار (Torob)' };
        }
      }
    } catch (e) {}
  }

  return null;
}

module.exports = { fetchIranianStoreImage };
