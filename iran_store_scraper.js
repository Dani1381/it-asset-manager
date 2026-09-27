// Iranian E-Commerce Image Scraper (Digikala, Torob, Technolife, JahanBazar)
// Returns array of potential product images for AI vision selection

async function fetchIranianStoreImagesList(modelName, category = '') {
  if (!modelName || !modelName.trim()) return [];

  const cleanModel = modelName
    .replace(/HP HP/gi, 'HP')
    .replace(/SFF/gi, '')
    .trim();

  // Search variations
  const queries = [];
  const cat = (category || '').toLowerCase();
  
  if (cat.includes('monitor') || cleanModel.toLowerCase().includes('s27') || cleanModel.toLowerCase().includes('c24') || cleanModel.toLowerCase().includes('p23') || cleanModel.toLowerCase().includes('mk40')) {
    queries.push(`مانیتور ${cleanModel}`);
    queries.push(`مانیتور خمیده ${cleanModel}`);
    queries.push(`مانیتور سامسونگ ${cleanModel}`);
    queries.push(cleanModel);
  } else if (cat.includes('laptop')) {
    queries.push(`لپ تاپ ${cleanModel}`);
  } else {
    queries.push(`کیس استوک ${cleanModel}`);
    queries.push(`کیس ${cleanModel}`);
    queries.push(`مینی کیس ${cleanModel}`);
    queries.push(cleanModel);
  }

  const candidates = [];

  // 1. Digikala API - Collect top 4 product image candidates
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
          for (const p of products.slice(0, 4)) {
            const imgUrl = p?.images?.main?.url;
            let rawUrl = Array.isArray(imgUrl) ? imgUrl[0] : (typeof imgUrl === 'string' ? imgUrl : null);
            if (rawUrl) {
              const highRes = rawUrl.split('?')[0] + '?x-oss-process=image/resize,m_lfit,h_800,w_800/quality,q_90';
              if (!candidates.some(c => c.url === highRes)) {
                candidates.push({ url: highRes, source: 'دیجی‌کالا (Digikala)', title: p.title_fa || p.title_en });
              }
            }
          }
        }
      }
    } catch (e) {}
    if (candidates.length >= 5) break;
  }

  // 2. Torob API - Collect top candidates if needed
  if (candidates.length < 5) {
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
          if (Array.isArray(results)) {
            for (const r of results.slice(0, 4)) {
              if (r.image_url && !candidates.some(c => c.url === r.image_url)) {
                candidates.push({ url: r.image_url, source: 'ترب (Torob)', title: r.name1 || r.name2 });
              }
            }
          }
        }
      } catch (e) {}
      if (candidates.length >= 6) break;
    }
  }

  return candidates;
}

module.exports = { fetchIranianStoreImagesList };
