const https = require('https');

// Global & Iranian Multi-Store Scraper (Digikala, Torob/JahanBazar, Amazon, Global Tech Catalogs)
async function fetchMultiSourceProductImages(modelName, category = '') {
  if (!modelName || !modelName.trim()) return [];

  const cleanModel = modelName
    .replace(/HP HP/gi, 'HP')
    .replace(/SFF/gi, '')
    .trim();

  const candidates = [];
  const cat = (category || '').toLowerCase();

  // Search variations for Persian & Global stores
  const persianQueries = [];
  if (cat.includes('monitor') || cleanModel.toLowerCase().includes('s27') || cleanModel.toLowerCase().includes('c24') || cleanModel.toLowerCase().includes('p23') || cleanModel.toLowerCase().includes('mk40')) {
    persianQueries.push(`مانیتور ${cleanModel}`);
    persianQueries.push(`مانیتور ${cleanModel.split(' ')[0]}`);
  } else if (cat.includes('laptop')) {
    persianQueries.push(`لپ تاپ ${cleanModel}`);
  } else {
    persianQueries.push(`کیس استوک ${cleanModel}`);
    persianQueries.push(`مینی کیس ${cleanModel}`);
    persianQueries.push(cleanModel);
  }

  // 1. SOURCE 1: Digikala API (Ultra-Fast 800x800 Studio Photos)
  for (const q of persianQueries) {
    try {
      const url = `https://api.digikala.com/v1/search/?q=${encodeURIComponent(q)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);

      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: ctrl.signal
      });
      clearTimeout(timer);

      if (resp.ok) {
        const json = await resp.json();
        const products = json?.data?.products;
        if (Array.isArray(products) && products.length > 0) {
          for (const p of products.slice(0, 3)) {
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
    if (candidates.length >= 3) break;
  }

  // 2. SOURCE 2: Torob API (Aggregates JahanBazar, LionComputer, Technolife & 500+ stores)
  for (const q of persianQueries) {
    try {
      const url = `https://api.torob.com/v4/base-product/search/?sort=popularity&page=0&size=5&query=${encodeURIComponent(q)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);

      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: ctrl.signal
      });
      clearTimeout(timer);

      if (resp.ok) {
        const json = await resp.json();
        const results = json?.results;
        if (Array.isArray(results)) {
          for (const r of results.slice(0, 3)) {
            if (r.image_url && !candidates.some(c => c.url === r.image_url)) {
              candidates.push({ url: r.image_url, source: 'ترب و جهان‌بازار (Torob / JahanBazar)', title: r.name1 || r.name2 });
            }
          }
        }
      }
    } catch (e) {}
    if (candidates.length >= 5) break;
  }

  // 3. SOURCE 3: Global Amazon / Tech Catalog Image Resolver (via Bing Media direct index)
  try {
    const globalQuery = `${cleanModel} product amazon white background`;
    const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(globalQuery)}&first=1`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);

    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      },
      signal: ctrl.signal
    });
    clearTimeout(timer);

    if (resp.ok) {
      const html = await resp.text();
      const murlMatches = html.match(/murl&quot;:&quot;(https?:[^&]+)&quot;/g) || html.match(/"murl":"(https?:[^"]+)"/g) || [];
      for (const raw of murlMatches.slice(0, 3)) {
        const clean = raw.replace(/murl&quot;:&quot;/, '').replace(/&quot;/, '').replace(/"murl":"/, '').replace(/"/, '');
        if (clean && clean.startsWith('http') && !candidates.some(c => c.url === clean)) {
          let sourceLabel = 'آمازون و مراجع جهانی (Amazon / Global)';
          if (clean.includes('amazon') || clean.includes('media-amazon')) sourceLabel = 'آمازون (Amazon)';
          candidates.push({ url: clean, source: sourceLabel, title: cleanModel });
        }
      }
    }
  } catch (e) {}

  return candidates;
}

module.exports = { fetchMultiSourceProductImages };
