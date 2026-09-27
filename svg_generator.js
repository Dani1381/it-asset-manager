// Professional Product Card SVG Generator - Never fails, always clean
const crypto = require('crypto');

function generateProductCard(model, category, assetId) {
  const cat = (category || '').toLowerCase();
  const modelClean = (model || 'IT Device').slice(0, 28);

  // Brand color detection
  let brandColor = '#1e40af';
  const m = (model || '').toLowerCase();
  if (m.includes('hp')) brandColor = '#0096d6';
  else if (m.includes('dell')) brandColor = '#007db8';
  else if (m.includes('lenovo')) brandColor = '#e2231a';
  else if (m.includes('samsung')) brandColor = '#1428a0';
  else if (m.includes('lg')) brandColor = '#a50034';
  else if (m.includes('asus')) brandColor = '#000000';
  else if (m.includes('acer')) brandColor = '#83b81a';
  else if (m.includes('apple')) brandColor = '#555555';
  else if (m.includes('sony')) brandColor = '#000000';
  else if (m.includes('canon')) brandColor = '#cc0000';
  else if (m.includes('epson')) brandColor = '#003399';
  else if (m.includes('brother')) brandColor = '#002d72';

  // Device icon (unicode emoji rendered in SVG)
  let icon = '🖥️';
  let typeLabel = 'PC / DESKTOP';
  if (cat.includes('monitor')) { icon = '🖥️'; typeLabel = 'MONITOR / DISPLAY'; }
  else if (cat.includes('laptop')) { icon = '💻'; typeLabel = 'LAPTOP'; }
  else if (cat.includes('printer')) { icon = '🖨️'; typeLabel = 'PRINTER'; }
  else if (cat.includes('network')) { icon = '🌐'; typeLabel = 'NETWORK DEVICE'; }
  else if (cat.includes('other')) { icon = '🔌'; typeLabel = 'IT EQUIPMENT'; }

  // Truncate model name for long names
  const modelText = modelClean.length > 24 ? modelClean.slice(0, 24) + '…' : modelClean;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${brandColor};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:#0f172a;stop-opacity:1"/>
    </linearGradient>
    <linearGradient id="card" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1"/>
      <stop offset="100%" style="stop-color:#f1f5f9;stop-opacity:1"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#000000" flood-opacity="0.25"/>
    </filter>
  </defs>

  <rect width="800" height="800" fill="url(#bg)"/>

  <!-- Subtle grid pattern -->
  <g opacity="0.06" stroke="#ffffff" stroke-width="2">
    ${Array.from({length: 20}, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="800"/>`).join('')}
    ${Array.from({length: 20}, (_, i) => `<line x1="0" y1="${i * 40}" x2="800" y2="${i * 40}"/>`).join('')}
  </g>

  <!-- Central product card -->
  <rect x="90" y="140" width="620" height="520" rx="24" fill="url(#card)" filter="url(#shadow)"/>

  <!-- Type badge -->
  <rect x="130" y="180" width="200" height="44" rx="22" fill="${brandColor}"/>
  <text x="230" y="209" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">${typeLabel}</text>

  <!-- Big device icon -->
  <text x="400" y="370" font-family="Arial" font-size="170" text-anchor="middle">${icon}</text>

  <!-- Model name -->
  <text x="400" y="470" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="#0f172a" text-anchor="middle">${escapeXml(modelText)}</text>

  <!-- Brand strip -->
  <rect x="90" y="604" width="620" height="56" rx="0" fill="${brandColor}"/>
  <text x="400" y="640" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="3">OFFICIAL PRODUCT REFERENCE</text>

  <!-- Footer -->
  <text x="400" y="730" font-family="Arial, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">IT Asset Manager • Asset #${assetId || '000'}</text>
</svg>`;

  return svg;
}

function escapeXml(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { generateProductCard };
