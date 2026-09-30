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
  await checkPendingScans();
  setupEventListeners();

  // Periodic check for new pending scans every 15 seconds
  setInterval(checkPendingScans, 15000);
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
        <div style="font-size: 3.5rem; margin-bottom: 1rem;">📦</div>
        <h3 style="color: var(--text-main); margin-bottom: 0.5rem;" data-i18n="no_assets_title">${getTranslation('no_assets_title')}</h3>
        <p style="margin-bottom: 1.5rem;" data-i18n="no_assets_desc">${getTranslation('no_assets_desc')}</p>
        <a href="/add.html" class="btn btn-primary" data-i18n="btn_add_first">${getTranslation('btn_add_first')}</a>
      </div>
    `;
    return;
  }

  container.innerHTML = assets.map(asset => {
    const hasPhoto = asset.primary_photo;
    const photoUrl = hasPhoto ? `/uploads/${asset.primary_photo}` : null;
    
    // Category Icon
    let catIcon = '🖥️';
    if (asset.category === 'Single PC') catIcon = '💻';
    else if (asset.category === 'Laptop') catIcon = '💻';
    else if (asset.category === 'Monitor') catIcon = '📺';
    else if (asset.category === 'Printer') catIcon = '🖨️';
    else if (asset.category === 'Network') catIcon = '🌐';
    else if (asset.category === 'Other') catIcon = '🔌';

    const statusBadgeClass = `badge-${asset.status || 'active'}`;
    const statusText = getTranslation(`status_${asset.status || 'active'}`) || (asset.status || 'active').replace('_', ' ');
    const categoryName = getTranslation(`filter_${(asset.category || 'pc').toLowerCase().replace(' ', '_')}`) || asset.category || 'PC';

    return `
      <div class="asset-card" data-id="${asset.id}">
        <div class="asset-header">
          ${photoUrl ? `
            <img src="${photoUrl}" alt="${escapeHtml(asset.property_id)}" loading="lazy">
          ` : `
            <div class="no-photo">
              <span class="no-photo-icon">${catIcon}</span>
              <span data-i18n="stat_pending_photos">${getTranslation('stat_pending_photos')}</span>
            </div>
          `}
          <div class="asset-tag-badge">${escapeHtml(asset.property_id)}</div>
          <div class="asset-status-badge ${statusBadgeClass}">
            <span class="status-dot"></span>
            <span>${statusText}</span>
          </div>
        </div>

        <div class="asset-body">
          <div class="asset-title" title="${escapeHtml(asset.manufacturer_model || asset.computer_name || 'Device')}">
            ${escapeHtml(asset.manufacturer_model || asset.computer_name || 'Device')}
          </div>
          <div class="asset-subtitle">
            ${catIcon} <span>${escapeHtml(categoryName)}</span>
          </div>

          <div class="asset-user-chip ${asset.user_name ? '' : 'unassigned'}" title="${getTranslation('user_label')} ${escapeHtml(asset.user_name || getTranslation('unassigned'))}">
            <span class="user-avatar-icon">👤</span>
            <span class="user-label-prefix">${getTranslation('user_label')}:</span>
            <span class="user-name-text">${escapeHtml(asset.user_name || getTranslation('unassigned'))}</span>
          </div>

          ${asset.cpu || asset.ram || asset.storage_drives ? `
            <div class="asset-key-specs">
              ${asset.cpu ? `
                <div class="key-spec">
                  <span class="key-spec-icon">🖥️</span>
                  <span class="key-spec-value" title="${escapeHtml(asset.cpu)}">${escapeHtml(asset.cpu)}</span>
                </div>
              ` : ''}
              ${asset.ram ? `
                <div class="key-spec">
                  <span class="key-spec-icon">🧠</span>
                  <span class="key-spec-value">${escapeHtml(asset.ram)}</span>
                </div>
              ` : ''}
              ${asset.storage_drives ? `
                <div class="key-spec">
                  <span class="key-spec-icon">💾</span>
                  <span class="key-spec-value" title="${escapeHtml(asset.storage_drives)}">${escapeHtml(asset.storage_drives)}</span>
                </div>
              ` : ''}
            </div>
          ` : ''}

          <div class="asset-specs-list">
            <div class="spec-item">
              <span class="spec-label">${getTranslation('serial_label')}</span>
              <span class="spec-value" style="font-family: monospace;">${escapeHtml(asset.serial_number || '-')}</span>
            </div>
            ${asset.monitors ? `
              <div class="spec-item">
                <span class="spec-label">${getTranslation('monitors_label')}</span>
                <span class="spec-value" title="${escapeHtml(asset.monitors)}">📺 ${escapeHtml(asset.monitors)}</span>
              </div>
            ` : ''}
            ${asset.location ? `
              <div class="spec-item">
                <span class="spec-label">${getTranslation('location_label')}</span>
                <span class="spec-value">📍 ${escapeHtml(asset.location)}</span>
              </div>
            ` : ''}
          </div>

          <div class="asset-footer">
            <div style="font-size: 0.85rem; color: var(--text-dim);">
              📷 ${asset.photo_count || 0} ${getTranslation('photos_count')}
            </div>
            <div style="display: flex; gap: 0.4rem;">
              <button onclick="quickCameraUpload(${asset.id})" class="btn btn-secondary btn-sm" title="${getTranslation('btn_snap')}">
                📷
              </button>
              <button onclick="openPrintTagModal(${asset.id})" class="btn btn-secondary btn-sm" title="${getTranslation('btn_tag')}">
                🏷️
              </button>
              <a href="/asset.html?id=${asset.id}" class="btn btn-primary btn-sm">
                ${getTranslation('btn_details')}
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
      document.getElementById('setting-gemini-key').value = s.gemini_api_key || '';
      if (document.getElementById('setting-gemini-model')) {
        document.getElementById('setting-gemini-model').value = s.gemini_model || 'gemini-3.6-flash';
      }
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
  const geminiKey = document.getElementById('setting-gemini-key') ? document.getElementById('setting-gemini-key').value.trim() : '';
  const geminiModel = document.getElementById('setting-gemini-model') ? document.getElementById('setting-gemini-model').value : 'gemini-3.6-flash';
  const baleToken = document.getElementById('setting-bale-token').value.trim();
  const baleChatId = document.getElementById('setting-bale-chat-id').value.trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: company,
        asset_tag_prefix: prefix,
        gemini_api_key: geminiKey,
        gemini_model: geminiModel,
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

// System Logs Modal Functions
function openLogsModal() {
  document.getElementById('logs-modal').classList.add('active');
  loadSystemLogs();
}

function closeLogsModal() {
  document.getElementById('logs-modal').classList.remove('active');
}

async function loadSystemLogs() {
  const container = document.getElementById('logs-container');
  if (!container) return;
  container.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 1rem;">در حال دریافت لاگ‌ها...</div>';

  try {
    const res = await fetch('/api/logs?limit=200');
    if (!res.ok) throw new Error('خطا در دریافت لاگ‌ها');
    const logs = await res.json();

    if (logs.length === 0) {
      container.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 1rem;">هیچ لاگی ثبت نشده است.</div>';
      return;
    }

    container.innerHTML = logs.map(l => {
      let color = '#94a3b8'; // Default
      let badge = 'ℹ️ INFO';
      if (l.level === 'SUCCESS') { color = '#34d399'; badge = '✅ SUCCESS'; }
      else if (l.level === 'WARN') { color = '#fbbf24'; badge = '⚠️ WARN'; }
      else if (l.level === 'ERROR') { color = '#f87171'; badge = '❌ ERROR'; }

      const timeStr = new Date(l.created_at).toLocaleTimeString('fa-IR');
      return `
        <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding: 6px 0;">
          <span style="color: #64748b;">[${timeStr}]</span>
          <span style="color: ${color}; font-weight: bold;">[${badge}]</span>
          <span style="color: #818cf8; font-weight: 600;">[${escapeHtml(l.source)}]</span>:
          <span style="color: #f1f5f9;">${escapeHtml(l.message)}</span>
          ${l.details ? `<div style="color: #94a3b8; font-size: 0.8rem; margin-top: 2px; padding-left: 12px;">↳ ${escapeHtml(l.details)}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div style="color: var(--danger); padding: 1rem;">⚠️ ${escapeHtml(e.message)}</div>`;
  }
}

async function clearSystemLogs() {
  if (!confirm('آیا مطمئن هستید که تمام لاگ‌های سیستم پاک شوند؟')) return;
  try {
    const res = await fetch('/api/logs', { method: 'DELETE' });
    if (res.ok) {
      await loadSystemLogs();
    }
  } catch (e) {
    alert(e.message);
  }
}

async function handleRestoreDatabase(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!confirm(`آیا مطمئن هستید که می‌خواهید دیتابیس با فایل «${file.name}» جایگزین شود؟ تمام اطلاعات فعلی با این فایل بروزرسانی خواهند شد.`)) {
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const base64 = e.target.result.split(',')[1];
      const res = await fetch('/api/backup/restore-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database_base64: base64 })
      });

      const data = await res.json();
      if (res.ok) {
        alert('دیتابیس با موفقیت بازنشانی شد! صفحه اکنون بازخوانی می‌شود.');
        window.location.reload();
      } else {
        alert('خطا در بازنشانی دیتابیس: ' + (data.error || 'ناشناخته'));
      }
    } catch (err) {
      alert('خطا: ' + err.message);
    }
  };
  reader.readAsDataURL(file);
}

// Pending Scans Approval Queue Functions
async function checkPendingScans() {
  try {
    const res = await fetch('/api/pending-scans');
    if (!res.ok) return;
    const items = await res.json();
    const btn = document.getElementById('pending-scans-btn');
    const badge = document.getElementById('pending-badge-count');

    if (btn && badge) {
      if (items.length > 0) {
        badge.textContent = items.length;
        btn.style.display = 'inline-flex';
      } else {
        btn.style.display = 'none';
      }
    }
  } catch (e) {}
}

function openPendingScansModal() {
  document.getElementById('pending-scans-modal').classList.add('active');
  loadPendingScansList();
}

function closePendingScansModal() {
  document.getElementById('pending-scans-modal').classList.remove('active');
}

async function loadPendingScansList() {
  const container = document.getElementById('pending-scans-list');
  if (!container) return;
  container.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 1.5rem;">در حال دریافت لیست دستگاه‌های منتظر تایید...</div>';

  try {
    const [scansRes, nextIdRes] = await Promise.all([
      fetch('/api/pending-scans'),
      fetch('/api/assets/next-id')
    ]);

    const items = await scansRes.json();
    let nextId = 'AST-0001';
    if (nextIdRes.ok) {
      const nextData = await nextIdRes.json();
      nextId = nextData.nextPropertyId || nextId;
    }

    if (items.length === 0) {
      container.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 2rem;">🎉 هیچ دستگاهی در صف انتظار نیست! تمام اسکن‌ها تایید شده‌اند.</div>';
      checkPendingScans();
      return;
    }

    container.innerHTML = items.map((it, idx) => {
      let icon = '🖥️';
      let catBadge = 'کیس / PC';
      let catBg = 'rgba(59, 130, 246, 0.15)';
      let catColor = '#60a5fa';

      if (it.category === 'Monitor') {
        icon = '📺';
        catBadge = 'مانیتور / نمایشگر';
        catBg = 'rgba(168, 85, 247, 0.15)';
        catColor = '#c084fc';
      } else if (it.category === 'Laptop') {
        icon = '💻';
        catBadge = 'لپ‌تاپ';
        catBg = 'rgba(234, 179, 8, 0.15)';
        catColor = '#fde047';
      }

      const timeStr = new Date(it.created_at).toLocaleTimeString('fa-IR');

      return `
        <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.35rem;">${icon}</span>
              <div>
                <strong style="font-size: 1rem; color: #f8fafc;">${escapeHtml(it.manufacturer_model || it.computer_name || 'دستگاه بدون نام')}</strong>
                <span style="background: ${catBg}; color: ${catColor}; font-size: 0.75rem; padding: 0.15rem 0.45rem; border-radius: 4px; margin-right: 0.5rem;">${catBadge}</span>
              </div>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-dim);">زمان اسکن: ${timeStr}</div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.5rem; font-size: 0.86rem; background: rgba(0,0,0,0.25); padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
            <div>👤 <strong>کاربر:</strong> <span style="background: rgba(6,182,212,0.15); border: 1px solid rgba(6,182,212,0.3); color: #38bdf8; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 6px;">${escapeHtml(it.user_name || 'مشخص نشده')}</span></div>
            <div>💻 <strong>نام سیستم:</strong> <span style="color: #f8fafc; font-weight: 600;">${escapeHtml(it.computer_name || 'N/A')}</span></div>
            ${it.serial_number ? `<div>🔑 <strong>سریال:</strong> ${escapeHtml(it.serial_number)}</div>` : ''}
            ${it.cpu ? `<div>🖥️ <strong>پردازنده:</strong> ${escapeHtml(it.cpu)}</div>` : ''}
            ${it.ram ? `<div>🧠 <strong>رم:</strong> ${escapeHtml(it.ram)}</div>` : ''}
            ${it.storage_drives ? `<div>💾 <strong>هارد:</strong> ${escapeHtml(it.storage_drives)}</div>` : ''}
            ${it.ip_address ? `<div>🌐 <strong>IP:</strong> ${escapeHtml(it.ip_address)}</div>` : ''}
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.4rem;">
            <div style="display: flex; align-items: center; gap: 0.4rem; flex: 1; min-width: 260px;">
              <label style="font-size: 0.82rem; color: #94a3b8; white-space: nowrap;">شماره اموال فیزیکی:</label>
              <input type="text" id="pending-prop-id-${it.id}" class="form-control" style="max-width: 170px; padding: 0.3rem 0.6rem; font-size: 0.88rem; font-family: monospace;" value="${nextId}" placeholder="مثال: AST-0010">
            </div>

            <div style="display: flex; gap: 0.4rem;">
              <button class="btn btn-danger btn-sm" onclick="rejectPendingItem(${it.id})" title="حذف این مورد از صف">
                ❌ رد
              </button>
              <button class="btn btn-success btn-sm" onclick="approvePendingItem(${it.id}, '${it.category}')" style="min-width: 130px;">
                ✅ تایید و ثبت در انبار
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div style="color: var(--danger); padding: 1rem;">خطا در دریافت لیست: ${escapeHtml(e.message)}</div>`;
  }
}

async function approvePendingItem(id, defaultCategory) {
  const propInput = document.getElementById(`pending-prop-id-${id}`);
  const propId = propInput ? propInput.value.trim() : '';

  if (!propId) {
    alert('لطفاً شماره اموال این دستگاه را وارد کنید.');
    return;
  }

  try {
    const res = await fetch(`/api/pending-scans/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propId,
        category: defaultCategory
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert('خطا در تایید: ' + (data.error || 'ناشناخته'));
      return;
    }

    // Refresh pending list and main assets
    await loadPendingScansList();
    await checkPendingScans();
    await loadAssets();
    await loadStats();
  } catch (e) {
    alert('خطا: ' + e.message);
  }
}

async function rejectPendingItem(id) {
  if (!confirm('آیا مطمئن هستید که این دستگاه از صف انتظار حذف شود؟')) return;
  try {
    const res = await fetch(`/api/pending-scans/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadPendingScansList();
      await checkPendingScans();
    }
  } catch (e) {
    alert(e.message);
  }
}

async function syncAllStockPhotos() {
  if (!confirm('آیا می‌خواهید عکس رسمی و تمیز مدل‌ها برای تمام دستگاه‌های فعال انبار به‌روزرسانی شود؟ (عکس‌های قبلی دوربین در گالری دستگاه‌ها باقی می‌مانند)')) return;

  try {
    const res = await fetch('/api/models/sync-all-stock-photos', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      alert(data.message || 'همگام‌سازی عکس‌ها با موفقیت انجام شد!');
      await loadAssets();
    } else {
      alert('خطا در همگام‌سازی: ' + (data.error || 'ناشناخته'));
    }
  } catch (e) {
    alert('خطا: ' + e.message);
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
