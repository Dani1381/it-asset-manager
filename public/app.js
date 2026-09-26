// app.js - Frontend application logic for IT Asset Master

// State
let allAssets = [];
let networkInfo = null;

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  await loadStats();
  await loadAssets();
  await loadNetworkInfo();
  setupEventListeners();
}

// Setup Event Listeners
function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(filterAssets, 250));
  }

  const categoryFilter = document.getElementById('category-filter');
  if (categoryFilter) {
    categoryFilter.addEventListener('change', filterAssets);
  }

  const statusFilter = document.getElementById('status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', filterAssets);
  }
}

// Debounce helper
function debounce(fn, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Load Dashboard Statistics
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const stats = await res.json();

    setElementText('stat-total', stats.total || 0);
    setElementText('stat-active', stats.active || 0);
    setElementText('stat-pcs', stats.pcs || 0);
    setElementText('stat-monitors', stats.monitors || 0);
    setElementText('stat-storage', stats.inStorage || 0);
    setElementText('stat-pending-photos', stats.pendingPhotos || 0);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Helper to set text content safely
function setElementText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// Load Network Info (for phone LAN connectivity)
async function loadNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      networkInfo = await res.json();
      const ip = networkInfo.localIps && networkInfo.localIps[0];
      const lanUrl = ip ? `http://${ip}:${networkInfo.port}` : `http://localhost:${networkInfo.port || 3000}`;
      
      const badge = document.getElementById('lan-ip-badge');
      if (badge && ip) {
        badge.textContent = `LAN: ${ip}:${networkInfo.port}`;
        badge.title = `Access from phone: ${lanUrl}`;
      }
    }
  } catch (e) {
    console.warn('Network info unavailable:', e);
  }
}

// Load Assets
async function loadAssets() {
  const container = document.getElementById('assets-container');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-dim);">
      <div style="font-size: 2rem; margin-bottom: 0.5rem;">⏳</div>
      Loading inventory...
    </div>
  `;

  try {
    const res = await fetch('/api/assets?limit=500');
    if (!res.ok) throw new Error('Failed to fetch assets');
    allAssets = await res.json();
    renderAssets(allAssets);
  } catch (err) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--danger);">
        ⚠️ Could not load assets: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

// Filter and re-render assets
function filterAssets() {
  const search = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('category-filter')?.value || 'all';
  const status = document.getElementById('status-filter')?.value || 'all';

  const filtered = allAssets.filter(item => {
    // Category match
    if (cat !== 'all') {
      if (cat === 'PC' && item.category !== 'PC' && item.category !== 'Laptop') return false;
      if (cat !== 'PC' && item.category !== cat) return false;
    }
    // Status match
    if (status !== 'all' && item.status !== status) return false;

    // Search query match
    if (search) {
      const match = (
        (item.property_id || '').toLowerCase().includes(search) ||
        (item.computer_name || '').toLowerCase().includes(search) ||
        (item.serial_number || '').toLowerCase().includes(search) ||
        (item.user_name || '').toLowerCase().includes(search) ||
        (item.manufacturer_model || '').toLowerCase().includes(search) ||
        (item.ip_address || '').toLowerCase().includes(search) ||
        (item.cpu || '').toLowerCase().includes(search) ||
        (item.monitors || '').toLowerCase().includes(search) ||
        (item.location || '').toLowerCase().includes(search)
      );
      if (!match) return false;
    }

    return true;
  });

  renderAssets(filtered);
}

// Render Assets Grid
function renderAssets(assets) {
  const container = document.getElementById('assets-container');
  if (!container) return;

  if (assets.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: var(--text-dim);">
        <div style="font-size: 3rem; margin-bottom: 1rem;">📦</div>
        <h3 style="color: var(--text-main); margin-bottom: 0.5rem;">No devices found</h3>
        <p style="margin-bottom: 1.5rem;">Run the .bat scanner on a PC or click "+ Add Device" to add old equipment manually.</p>
        <a href="/add.html" class="btn btn-primary">➕ Add First Device</a>
      </div>
    `;
    return;
  }

  container.innerHTML = assets.map(asset => {
    const hasPhoto = asset.primary_photo;
    const photoUrl = hasPhoto ? `/uploads/${asset.primary_photo}` : null;
    
    // Category Icon
    let catIcon = '🖥️';
    if (asset.category === 'Laptop') catIcon = '💻';
    else if (asset.category === 'Monitor') catIcon = '📺';
    else if (asset.category === 'Printer') catIcon = '🖨️';
    else if (asset.category === 'Network') catIcon = '🌐';
    else if (asset.category === 'Other') catIcon = '🔌';

    const statusBadgeClass = `badge-${asset.status || 'active'}`;
    const statusText = (asset.status || 'active').replace('_', ' ');

    return `
      <div class="asset-card" data-id="${asset.id}">
        <div class="asset-header">
          ${photoUrl ? `
            <img src="${photoUrl}" alt="${escapeHtml(asset.property_id)}" loading="lazy">
          ` : `
            <div class="no-photo">
              <span class="no-photo-icon">${catIcon}</span>
              <span>No photo attached</span>
            </div>
          `}
          <div class="asset-tag-badge">${escapeHtml(asset.property_id)}</div>
          <div class="asset-status-badge ${statusBadgeClass}">${statusText}</div>
        </div>

        <div class="asset-body">
          <div class="asset-title" title="${escapeHtml(asset.manufacturer_model || asset.computer_name || 'Device')}">
            ${escapeHtml(asset.manufacturer_model || asset.computer_name || 'Device')}
          </div>
          <div class="asset-subtitle">
            ${catIcon} ${escapeHtml(asset.category || 'PC')} • 
            User: <strong>${escapeHtml(asset.user_name || 'Unassigned')}</strong>
          </div>

          <div class="asset-specs-list">
            <div class="spec-item">
              <span class="spec-label">Serial:</span>
              <span class="spec-value" style="font-family: monospace;">${escapeHtml(asset.serial_number || 'N/A')}</span>
            </div>
            ${asset.cpu ? `
              <div class="spec-item">
                <span class="spec-label">CPU:</span>
                <span class="spec-value" title="${escapeHtml(asset.cpu)}">${escapeHtml(asset.cpu)}</span>
              </div>
            ` : ''}
            ${asset.ram ? `
              <div class="spec-item">
                <span class="spec-label">RAM:</span>
                <span class="spec-value">${escapeHtml(asset.ram)}</span>
              </div>
            ` : ''}
            ${asset.monitors ? `
              <div class="spec-item">
                <span class="spec-label">Monitors:</span>
                <span class="spec-value" title="${escapeHtml(asset.monitors)}">📺 ${escapeHtml(asset.monitors)}</span>
              </div>
            ` : ''}
            ${asset.location ? `
              <div class="spec-item">
                <span class="spec-label">Location:</span>
                <span class="spec-value">📍 ${escapeHtml(asset.location)}</span>
              </div>
            ` : ''}
          </div>

          <div class="asset-footer">
            <div style="font-size: 0.78rem; color: var(--text-dim);">
              📷 ${asset.photo_count || 0} photo(s)
            </div>
            <div style="display: flex; gap: 0.4rem;">
              <button onclick="quickCameraUpload(${asset.id})" class="btn btn-secondary btn-sm" title="Snap Photo from Phone">
                📷
              </button>
              <button onclick="openPrintTagModal(${asset.id})" class="btn btn-secondary btn-sm" title="Print Asset Tag Sticker">
                🏷️ Tag
              </button>
              <a href="/asset.html?id=${asset.id}" class="btn btn-primary btn-sm">
                Details &rarr;
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Quick Camera Upload for an Asset
let currentUploadAssetId = null;
function quickCameraUpload(assetId) {
  currentUploadAssetId = assetId;
  const input = document.getElementById('global-camera-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

// Handle Camera Input change
async function handleGlobalCameraSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file || !currentUploadAssetId) return;

  const btn = document.querySelector(`.asset-card[data-id="${currentUploadAssetId}"] button`);
  if (btn) btn.textContent = 'Uploading...';

  try {
    // Compress image client side
    const base64 = await resizeImageFile(file, 1600, 1600, 0.85);

    const res = await fetch(`/api/assets/${currentUploadAssetId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64,
        original_name: file.name,
        caption: 'Device Photo'
      })
    });

    if (!res.ok) throw new Error('Upload failed');
    
    // Refresh stats & assets
    await loadStats();
    await loadAssets();
    alert('Photo saved successfully!');
  } catch (err) {
    alert('Photo upload failed: ' + err.message);
  } finally {
    currentUploadAssetId = null;
  }
}

// Helper: Resize image file to base64
function resizeImageFile(file, maxWidth, maxHeight, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality || 0.85);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Open Print Asset Tag Sticker Modal
function openPrintTagModal(assetId) {
  const asset = allAssets.find(a => a.id === assetId);
  if (!asset) return;

  const modal = document.getElementById('tag-modal');
  if (!modal) return;

  document.getElementById('tag-modal-id').textContent = asset.property_id;
  document.getElementById('tag-modal-serial').textContent = asset.serial_number || 'N/A';
  document.getElementById('tag-modal-model').textContent = asset.manufacturer_model || asset.computer_name || asset.category;
  document.getElementById('tag-modal-user').textContent = asset.user_name || 'Company Asset';

  // Generate QR Code containing URL to view this asset
  const origin = window.location.origin;
  const assetUrl = `${origin}/asset.html?id=${asset.id}`;
  const qrContainer = document.getElementById('tag-modal-qr');
  if (qrContainer && window.QRCode) {
    new QRCode(qrContainer, {
      text: assetUrl,
      width: 75,
      height: 75
    });
  }

  modal.classList.add('active');
}

function closePrintTagModal() {
  const modal = document.getElementById('tag-modal');
  if (modal) modal.classList.remove('active');
}

function printAssetTag() {
  window.print();
}

// Mobile LAN QR Modal (scan to open on phone)
function openMobileQrModal() {
  const modal = document.getElementById('mobile-qr-modal');
  if (!modal) return;

  const ip = (networkInfo && networkInfo.localIps && networkInfo.localIps[0]) || window.location.hostname;
  const port = (networkInfo && networkInfo.port) || window.location.port || '3000';
  const url = `http://${ip}:${port}`;

  const linkEl = document.getElementById('mobile-qr-link');
  if (linkEl) {
    linkEl.href = url;
    linkEl.textContent = url;
  }

  const qrContainer = document.getElementById('mobile-qr-code');
  if (qrContainer && window.QRCode) {
    new QRCode(qrContainer, {
      text: url,
      width: 180,
      height: 180
    });
  }

  modal.classList.add('active');
}

function closeMobileQrModal() {
  const modal = document.getElementById('mobile-qr-modal');
  if (modal) modal.classList.remove('active');
}

// Settings Modal
async function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const s = await res.json();
      document.getElementById('setting-company').value = s.company_name || '';
      document.getElementById('setting-prefix').value = s.asset_tag_prefix || 'AST-';
      document.getElementById('setting-bale-token').value = s.bale_token || '';
      document.getElementById('setting-bale-chat-id').value = s.bale_chat_id || '';
    }
  } catch (e) {
    console.error(e);
  }

  modal.classList.add('active');
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.remove('active');
}

async function saveSettings(event) {
  event.preventDefault();
  const company = document.getElementById('setting-company').value.trim();
  const prefix = document.getElementById('setting-prefix').value.trim();
  const baleToken = document.getElementById('setting-bale-token').value.trim();
  const baleChatId = document.getElementById('setting-bale-chat-id').value.trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: company,
        asset_tag_prefix: prefix,
        bale_token: baleToken,
        bale_chat_id: baleChatId
      })
    });

    if (res.ok) {
      alert('Settings saved successfully!');
      closeSettingsModal();
    } else {
      alert('Failed to save settings');
    }
  } catch (e) {
    alert('Error saving settings: ' + e.message);
  }
}

async function testBaleBot() {
  const btn = document.getElementById('test-bale-btn');
  if (btn) btn.textContent = 'Sending...';

  try {
    const res = await fetch('/api/test-bale', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert('Success! Check your Bale Messenger chat for the test message.');
    } else {
      alert('Bale message failed: ' + (data.error || data.reason));
    }
  } catch (e) {
    alert('Error testing Bale: ' + e.message);
  } finally {
    if (btn) btn.textContent = '🔔 Test Bale Notification';
  }
}

// Utility: Escape HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
