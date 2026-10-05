// smart-fill.js - Interactive Suggestion Chips & Custom Dropdown Engine for Mobile & Desktop

// Preset chips configuration for instant 1-tap filling
const CHIP_PRESETS = {
  storage_drives: [
    { label: '💾 WD 500GB', value: 'WD 500GB HDD' },
    { label: '💾 WD 1TB', value: 'WD 1TB HDD' },
    { label: '⚡ NVMe 256GB', value: '256GB NVMe SSD' },
    { label: '⚡ NVMe 512GB', value: '512GB NVMe SSD' },
    { label: '⚡ SATA 256GB', value: '256GB SATA SSD' },
    { label: '💾 Seagate 500GB', value: 'Seagate 500GB HDD' }
  ],

  ram: [
    { label: '🧠 4 GB', value: '4 GB' },
    { label: '🧠 8 GB', value: '8 GB' },
    { label: '🧠 16 GB', value: '16 GB' },
    { label: '🧠 32 GB', value: '32 GB' },
    { label: '🧠 8GB DDR4', value: '8 GB DDR4' },
    { label: '🧠 16GB DDR4', value: '16 GB DDR4' }
  ],

  cpu: [
    { label: '⚡ Core i5-6500', value: 'Intel(R) Core(TM) i5-6500 CPU @ 3.20GHz' },
    { label: '⚡ Core i5-7500', value: 'Intel(R) Core(TM) i5-7500 CPU @ 3.40GHz' },
    { label: '⚡ Core i7-8700', value: 'Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz' },
    { label: '⚡ Core i5-10400', value: 'Intel(R) Core(TM) i5-10400 CPU @ 2.90GHz' },
    { label: '⚡ Core i3-6100', value: 'Intel(R) Core(TM) i3-6100 CPU @ 3.70GHz' }
  ],

  manufacturer_model: [
    { label: '🖥️ HP 800 G3 SFF', value: 'HP EliteDesk 800 G3 SFF', cat: 'PC' },
    { label: '🖥️ HP 800 G4 SFF', value: 'HP EliteDesk 800 G4 SFF', cat: 'PC' },
    { label: '🖥️ HP ProDesk 600 G3', value: 'HP ProDesk 600 G3 SFF', cat: 'PC' },
    { label: '🖥️ Dell OptiPlex 7050', value: 'Dell OptiPlex 7050', cat: 'PC' },
    { label: '🖥️ Dell OptiPlex 780', value: 'Dell OptiPlex 780', cat: 'PC' },
    { label: '💻 Dell Latitude 5420', value: 'Dell Latitude 5420', cat: 'Laptop' },
    { label: '💻 HP ProBook 450 G8', value: 'HP ProBook 450 G8', cat: 'Laptop' },
    { label: '💻 Lenovo ThinkPad T14', value: 'Lenovo ThinkPad T14', cat: 'Laptop' },
    { label: '📺 Samsung 27"', value: 'Samsung S27C31x', cat: 'Monitor' },
    { label: '📺 Samsung 22"', value: 'Samsung S22F350', cat: 'Monitor' },
    { label: '📺 LG 24"', value: 'LG 24MK430H', cat: 'Monitor' },
    { label: '📺 Dell 24"', value: 'Dell P2422H', cat: 'Monitor' },
    { label: '🖨️ HP LaserJet M404dn', value: 'HP LaserJet Pro M404dn', cat: 'Printer' },
    { label: '🖨️ Canon MF3010', value: 'Canon i-SENSYS MF3010', cat: 'Printer' },
    { label: '🖨️ HP LaserJet M130', value: 'HP LaserJet Pro MFP M130', cat: 'Printer' },
    { label: '🌐 Cisco 2960', value: 'Cisco Catalyst 2960', cat: 'Network' },
    { label: '🌐 MikroTik hEX', value: 'MikroTik hEX RB750Gr3', cat: 'Network' },
    { label: '🌐 TP-Link 24-Port', value: 'TP-Link TL-SG1024D', cat: 'Network' },
    { label: '🌐 Cisco CBS350-24', value: 'Cisco CBS350-24T-4G', cat: 'Network' },
    { label: '🗄️ HP DL380 Gen10', value: 'HPE ProLiant DL380 Gen10', cat: 'Server' },
    { label: '🗄️ Dell R740', value: 'Dell PowerEdge R740', cat: 'Server' },
    { label: '🗄️ HP ML350 Gen10', value: 'HPE ProLiant ML350 Gen10', cat: 'Server' },
    { label: '💽 Samsung 870 EVO', value: 'Samsung 870 EVO 500GB SATA SSD', cat: 'Storage' },
    { label: '💽 Samsung 980 NVMe', value: 'Samsung 980 1TB NVMe SSD', cat: 'Storage' },
    { label: '💽 Kingston A400', value: 'Kingston A400 480GB SATA SSD', cat: 'Storage' },
    { label: '💽 WD Blue 1TB', value: 'WD Blue 1TB HDD (WD10EZEX)', cat: 'Storage' },
    { label: '💽 Seagate 2TB', value: 'Seagate BarraCuda 2TB HDD', cat: 'Storage' },
    { label: '💽 WD Purple 4TB', value: 'WD Purple 4TB Surveillance HDD', cat: 'Storage' },
    { label: '📡 TP-Link VR300', value: 'TP-Link Archer VR300', cat: 'Modem' },
    { label: '📡 D-Link 2750U', value: 'D-Link DSL-2750U', cat: 'Modem' },
    { label: '📡 Huawei B311 LTE', value: 'Huawei B311 4G LTE', cat: 'Modem' },
    { label: '📡 TP-Link MR6400', value: 'TP-Link TL-MR6400 4G', cat: 'Modem' },
    { label: '🛜 MikroTik hAP ac2', value: 'MikroTik hAP ac2', cat: 'Router' },
    { label: '🛜 MikroTik RB4011', value: 'MikroTik RB4011iGS+', cat: 'Router' },
    { label: '🛜 TP-Link Archer C6', value: 'TP-Link Archer C6', cat: 'Router' },
    { label: '🛜 Cisco ISR 4321', value: 'Cisco ISR 4321', cat: 'Router' },
    { label: '📶 UniFi U6 Lite', value: 'Ubiquiti UniFi U6 Lite', cat: 'Access Point' },
    { label: '📶 TP-Link EAP225', value: 'TP-Link EAP225', cat: 'Access Point' },
    { label: '📶 MikroTik cAP ac', value: 'MikroTik cAP ac', cat: 'Access Point' },
    { label: '🔋 APC Back-UPS 650', value: 'APC Back-UPS 650VA', cat: 'UPS' },
    { label: '🔋 APC Smart-UPS 1500', value: 'APC Smart-UPS 1500VA', cat: 'UPS' },
    { label: '☎️ Grandstream GXP1610', value: 'Grandstream GXP1610', cat: 'VoIP Phone' },
    { label: '☎️ Yealink T31P', value: 'Yealink SIP-T31P', cat: 'VoIP Phone' },
    { label: '☎️ Panasonic KX-TS500', value: 'Panasonic KX-TS500', cat: 'VoIP Phone' },
    { label: '📹 Hikvision DVR', value: 'Hikvision DS-7208HGHI DVR', cat: 'Camera' },
    { label: '📹 Dahua IPC', value: 'Dahua IPC-HFW1230S', cat: 'Camera' },
    { label: '📽️ Epson EB-X51', value: 'Epson EB-X51', cat: 'Projector' },
    { label: '📽️ BenQ MX560', value: 'BenQ MX560', cat: 'Projector' },
    { label: '📱 Samsung Tab A8', value: 'Samsung Galaxy Tab A8', cat: 'Tablet' },
    { label: '📱 iPad 10th Gen', value: 'Apple iPad (10th gen)', cat: 'Tablet' },
    { label: '⌨️ Logitech MK270', value: 'Logitech MK270 Keyboard & Mouse', cat: 'Peripheral' },
    { label: '🎧 Logitech H390', value: 'Logitech H390 Headset', cat: 'Peripheral' },
    { label: '📷 Logitech C270', value: 'Logitech C270 Webcam', cat: 'Peripheral' }
  ],

  monitors: [
    { label: '📺 Samsung 27" S27C31x', value: 'Samsung S27C31x' },
    { label: '📺 Samsung 22" S22F350', value: 'Samsung S22F350' },
    { label: '📺 مانیتور دوگانه ۲۷', value: 'Dual Samsung 27" Monitors' },
    { label: '📺 نمایشگر پیش‌فرض', value: 'Default Display' }
  ],

  gpu: [
    { label: '🎮 Intel HD 530', value: 'Intel(R) HD Graphics 530' },
    { label: '🎮 Intel UHD 630', value: 'Intel(R) UHD Graphics 630' },
    { label: '🎮 گرافیک آنبرد', value: 'Integrated Graphics' },
    { label: '🎮 NVIDIA GeForce', value: 'NVIDIA GeForce' }
  ],

  location: [
    { label: '📍 انبار کنار اتاق آقای داننده', value: 'انبار کنار اتاق آقای داننده' },
    { label: '📍 انبار مرکزی', value: 'انبار مرکزی' },
    { label: '📍 اتاق سرور', value: 'اتاق سرور' },
    { label: '📍 طبقه اول', value: 'طبقه اول' },
    { label: '📍 طبقه دوم', value: 'طبقه دوم' },
    { label: '📍 اتاق IT', value: 'واحد IT' }
  ],

  department: [
    { label: '🏢 پشتیبانی IT', value: 'پشتیبانی IT' },
    { label: '🏢 حسابداری', value: 'حسابداری' },
    { label: '🏢 فروش', value: 'فروش' },
    { label: '🏢 مدیریت', value: 'مدیریت' },
    { label: '🏢 منابع انسانی', value: 'منابع انسانی' }
  ]
};

// Model Presets for Auto-filling multiple fields
const MODEL_PRESETS = {
  'hp elitedesk 800 g3': {
    category: 'PC',
    cpu: 'Intel(R) Core(TM) i5-6500 CPU @ 3.20GHz',
    ram: '16 GB',
    storage_drives: '256GB NVMe SSD',
    gpu: 'Intel(R) HD Graphics 530'
  },
  'hp elitedesk 800 g4': {
    category: 'PC',
    cpu: 'Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz',
    ram: '16 GB',
    storage_drives: '512GB NVMe SSD',
    gpu: 'Intel(R) UHD Graphics 630'
  },
  'hp prodesk 600 g3': {
    category: 'PC',
    cpu: 'Intel(R) Core(TM) i5-7500 CPU @ 3.40GHz',
    ram: '8 GB',
    storage_drives: '256GB SSD',
    gpu: 'Intel(R) HD Graphics 630'
  },
  'dell optiplex 7050': {
    category: 'PC',
    cpu: 'Intel(R) Core(TM) i7-7700 CPU @ 3.60GHz',
    ram: '16 GB',
    storage_drives: '256GB NVMe SSD',
    gpu: 'Intel(R) HD Graphics 630'
  },
  'dell optiplex 780': {
    category: 'PC',
    cpu: 'Intel(R) Core(TM)2 Duo CPU E8400 @ 3.00GHz',
    ram: '4 GB',
    storage_drives: '500GB HDD',
    gpu: 'Intel(R) Q45/Q43 Express Chipset'
  },
  'dell latitude 5420': {
    category: 'Laptop',
    cpu: 'Intel(R) Core(TM) i5-1145G7 @ 2.60GHz',
    ram: '16 GB',
    storage_drives: '256GB NVMe SSD',
    gpu: 'Intel(R) Iris(R) Xe Graphics'
  },
  'samsung s27c31x': {
    category: 'Monitor',
    monitors: 'Samsung S27C31x (27")'
  },
  'samsung s22f350': {
    category: 'Monitor',
    monitors: 'Samsung S22F350 (22")'
  }
};

// Shorthand rules
const SHORTHAND_RULES = {
  storage: [
    { pattern: /^(?:wd|western digital)\s*500$/i, replace: 'WD 500GB HDD' },
    { pattern: /^(?:wd|western digital)\s*1\s*t(?:b)?$/i, replace: 'WD 1TB HDD' },
    { pattern: /^(?:wd|western digital)\s*2\s*t(?:b)?$/i, replace: 'WD 2TB HDD' },
    { pattern: /^(?:seagate|sg)\s*500$/i, replace: 'Seagate 500GB HDD' },
    { pattern: /^(?:seagate|sg)\s*1\s*t(?:b)?$/i, replace: 'Seagate 1TB HDD' },
    { pattern: /^(?:nvme|ssd)\s*128$/i, replace: '128GB NVMe SSD' },
    { pattern: /^(?:nvme|ssd)\s*256$/i, replace: '256GB NVMe SSD' },
    { pattern: /^(?:nvme|ssd)\s*512$/i, replace: '512GB NVMe SSD' },
    { pattern: /^(?:nvme|ssd)\s*1\s*t(?:b)?$/i, replace: '1TB NVMe SSD' },
    { pattern: /^(?:sata|ssd sata)\s*256$/i, replace: '256GB SATA SSD' },
    { pattern: /^(?:sata|ssd sata)\s*512$/i, replace: '512GB SATA SSD' },
    { pattern: /^500$/i, replace: '500GB HDD' },
    { pattern: /^256$/i, replace: '256GB SSD' },
    { pattern: /^512$/i, replace: '512GB SSD' },
    { pattern: /^1tb?$/i, replace: '1TB SSD' },
  ],
  ram: [
    { pattern: /^4$/i, replace: '4 GB' },
    { pattern: /^8$/i, replace: '8 GB' },
    { pattern: /^16$/i, replace: '16 GB' },
    { pattern: /^32$/i, replace: '32 GB' },
    { pattern: /^64$/i, replace: '64 GB' },
    { pattern: /^8\s*d(?:dr)?4$/i, replace: '8 GB DDR4' },
    { pattern: /^16\s*d(?:dr)?4$/i, replace: '16 GB DDR4' },
    { pattern: /^32\s*d(?:dr)?4$/i, replace: '32 GB DDR4' }
  ],
  cpu: [
    { pattern: /^i3\s*6\w*$/i, replace: 'Intel(R) Core(TM) i3-6100 CPU @ 3.70GHz' },
    { pattern: /^i5\s*6500$/i, replace: 'Intel(R) Core(TM) i5-6500 CPU @ 3.20GHz' },
    { pattern: /^i5\s*7500$/i, replace: 'Intel(R) Core(TM) i5-7500 CPU @ 3.40GHz' },
    { pattern: /^i5\s*8500$/i, replace: 'Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz' },
    { pattern: /^i5\s*10400$/i, replace: 'Intel(R) Core(TM) i5-10400 CPU @ 2.90GHz' },
    { pattern: /^i5\s*12400$/i, replace: 'Intel(R) Core(TM) i5-12400 CPU @ 2.50GHz' },
    { pattern: /^i7\s*6700$/i, replace: 'Intel(R) Core(TM) i7-6700 CPU @ 3.40GHz' },
    { pattern: /^i7\s*7700$/i, replace: 'Intel(R) Core(TM) i7-7700 CPU @ 3.60GHz' },
    { pattern: /^i7\s*8700$/i, replace: 'Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz' },
    { pattern: /^i7\s*10700$/i, replace: 'Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz' },
  ],
  model: [
    { pattern: /^hp\s*800\s*g3$/i, replace: 'HP EliteDesk 800 G3 SFF' },
    { pattern: /^hp\s*800\s*g4$/i, replace: 'HP EliteDesk 800 G4 SFF' },
    { pattern: /^hp\s*600\s*g3$/i, replace: 'HP ProDesk 600 G3 SFF' },
    { pattern: /^dell\s*7050$/i, replace: 'Dell OptiPlex 7050' },
    { pattern: /^dell\s*780$/i, replace: 'Dell OptiPlex 780' },
    { pattern: /^dell\s*5420$/i, replace: 'Dell Latitude 5420' },
    { pattern: /^sam(?:sung)?\s*27$/i, replace: 'Samsung S27C31x' },
    { pattern: /^sam(?:sung)?\s*22$/i, replace: 'Samsung S22F350' }
  ]
};

// ---------------------------------------------------------------------------
// Category-aware suggestions
// When "Monitor" is selected only monitor models are suggested, when a
// PC / case is selected only PC models, etc. Hardware chips (CPU/RAM/...)
// are only shown for computer-type devices.
// ---------------------------------------------------------------------------
let SMART_DB = {};

// Map a category value to the family used for filtering suggestions
function categoryFamily(cat) {
  if (typeof findCategory === 'function') {
    const c = findCategory(cat);
    if (c) return c.family;
  }
  const v = String(cat || '').trim().toLowerCase();
  if (v === 'pc' || v === 'single pc') return 'pc';
  return v || 'other';
}

const COMPUTER_FAMILIES = new Set(['pc', 'laptop', 'server']);

// Recent DB models for one category family (falls back to [] if server is old)
function dbModelsForFamily(family) {
  const byCat = SMART_DB.models_by_category;
  if (!byCat || typeof byCat !== 'object') return [];
  const out = [];
  for (const [cat, list] of Object.entries(byCat)) {
    if (categoryFamily(cat) === family && Array.isArray(list)) out.push(...list);
  }
  return out;
}

function presetModelsForFamily(family) {
  return CHIP_PRESETS.manufacturer_model.filter(c => categoryFamily(c.cat) === family);
}

// Field ids for the two forms that use smart chips
const SMART_FORMS = [
  {
    category: 'category', model: 'manufacturer_model', modelCallback: true,
    hw: { cpu: 'cpu', ram: 'ram', storage: 'storage_drives', gpu: 'gpu' },
    monitors: 'monitors', location: 'location', department: 'department'
  },
  {
    category: 'edit-category', model: 'edit-model', modelCallback: false,
    hw: { cpu: 'edit-cpu', ram: 'edit-ram', storage: 'edit-storage', gpu: 'edit-gpu' },
    monitors: 'edit-monitors', location: 'edit-location', department: 'edit-department'
  }
];

function renderCategoryChips(form) {
  const catEl = document.getElementById(form.category);
  if (!catEl) return;
  const family = categoryFamily(catEl.value);
  const isComputer = COMPUTER_FAMILIES.has(family);

  // Model chips: only models of the selected device type
  setupFieldChips(
    form.model,
    presetModelsForFamily(family),
    dbModelsForFamily(family),
    form.modelCallback ? applyModelPreset : undefined
  );

  // Hardware chips only make sense for computers (storage also for standalone drives)
  const showStorage = isComputer || family === 'storage';
  setupFieldChips(form.hw.cpu, isComputer ? CHIP_PRESETS.cpu : [], isComputer ? SMART_DB.cpus : []);
  setupFieldChips(form.hw.ram, isComputer ? CHIP_PRESETS.ram : [], isComputer ? SMART_DB.rams : []);
  setupFieldChips(form.hw.storage, showStorage ? CHIP_PRESETS.storage_drives : [], showStorage ? SMART_DB.storages : []);
  setupFieldChips(form.hw.gpu, isComputer ? CHIP_PRESETS.gpu : [], isComputer ? SMART_DB.gpus : []);

  // Monitor field: relevant for computers (attached screens) and monitors themselves
  const showMon = isComputer || family === 'monitor';
  setupFieldChips(form.monitors, showMon ? CHIP_PRESETS.monitors : [], showMon ? SMART_DB.monitors : []);
}

// Public hook: re-render chips after a form's category is set from code
function refreshSmartChips() {
  SMART_FORMS.forEach(renderCategoryChips);
}
window.refreshSmartChips = refreshSmartChips;

// Main Initialization
async function initSmartFill() {
  try {
    const res = await fetch('/api/suggestions');
    if (res.ok) {
      SMART_DB = await res.json();
    }
  } catch (e) {
    console.warn('Could not load suggestions:', e);
  }

  SMART_FORMS.forEach(form => {
    renderCategoryChips(form);
    setupFieldChips(form.location, CHIP_PRESETS.location, SMART_DB.locations);
    setupFieldChips(form.department, CHIP_PRESETS.department, SMART_DB.departments);

    const catEl = document.getElementById(form.category);
    if (catEl && !catEl.dataset.smartBound) {
      catEl.dataset.smartBound = '1';
      catEl.addEventListener('change', () => renderCategoryChips(form));
    }
  });

  // Several drives per device: one row each
  setupMultiDiskInput('storage_drives');
  setupMultiDiskInput('edit-storage');

  // As-you-type suggestions from models already in the database
  setupModelAutocomplete('manufacturer_model', 'category', it => { if (window.onModelPicked) window.onModelPicked(it); });
  setupModelAutocomplete('edit-model', 'edit-category');

  // Attach text expansions
  // (storage shorthand now runs per row inside the multi-disk editor)
  setupShorthand('ram', SHORTHAND_RULES.ram);
  setupShorthand('cpu', SHORTHAND_RULES.cpu);
  setupShorthand('manufacturer_model', SHORTHAND_RULES.model, applyModelPreset);

  setupShorthand('edit-ram', SHORTHAND_RULES.ram);
  setupShorthand('edit-cpu', SHORTHAND_RULES.cpu);
  setupShorthand('edit-model', SHORTHAND_RULES.model);
}

// ---------------------------------------------------------------------------
// Model autocomplete: while typing, similar models already in the database
// are listed (fuzzy match, typo tolerant). Picking one sets the model name and
// category and lets the page fill the rest (specs, photo).
// ---------------------------------------------------------------------------
function acEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function acHighlight(text, query) {
  const safe = acEscape(text);
  const words = String(query || '').toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter(w => w.length >= 2);
  if (!words.length) return safe;
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

function setupModelAutocomplete(inputId, categoryId, onPick) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.acBound) return;
  input.dataset.acBound = '1';
  input.setAttribute('autocomplete', 'off');

  const wrap = document.createElement('div');
  wrap.className = 'model-ac-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const list = document.createElement('div');
  list.className = 'model-ac-list';
  list.hidden = true;
  wrap.appendChild(list);

  let items = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  const close = () => { list.hidden = true; active = -1; };

  function render(query) {
    if (!items.length) { close(); return; }
    list.innerHTML = `<div class="model-ac-head">🔎 مدل‌های مشابه در انبار</div>` + items.map((it, i) => `
      <button type="button" class="model-ac-item${i === active ? ' active' : ''}" data-i="${i}">
        ${it.photo_url ? `<img class="model-ac-thumb" src="${acEscape(it.photo_url)}" alt="" loading="lazy">`
                       : `<span class="model-ac-thumb">${typeof categoryIcon === 'function' ? categoryIcon(it.category) : '📦'}</span>`}
        <span class="model-ac-text">
          <span class="model-ac-name">${acHighlight(it.model, query)}</span>
          <span class="model-ac-meta">${acEscape(typeof categoryLabel === 'function' ? categoryLabel(it.category) : it.category)} · ${it.count} عدد ثبت‌شده${it.photo_url ? ' · 🖼️ عکس دارد' : ''}</span>
        </span>
      </button>`).join('');
    list.hidden = false;
  }

  function pick(i) {
    const it = items[i];
    if (!it) return;
    input.value = it.model;
    close();
    const cat = categoryId && document.getElementById(categoryId);
    if (cat && it.category && cat.value !== it.category && [...cat.options].some(o => o.value === it.category)) {
      cat.value = it.category;
      cat.dispatchEvent(new Event('change'));
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (onPick) onPick(it);
  }

  async function search() {
    const q = input.value.trim();
    if (q.length < 2) { items = []; close(); return; }
    const mySeq = ++seq;
    const cat = categoryId && document.getElementById(categoryId);
    try {
      const res = await fetch(`/api/models/search?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat ? cat.value : '')}`);
      if (!res.ok || mySeq !== seq) return;
      const data = await res.json();
      // Nothing to suggest if the only hit is exactly what is already typed
      items = (data.results || []).filter(r => r.model.toLowerCase() !== q.toLowerCase() || data.results.length > 1);
      active = -1;
      if (document.activeElement === input) render(q);
    } catch (e) { /* offline: no suggestions */ }
  }

  input.addEventListener('input', e => {
    if (!e.isTrusted) return; // value set from code (chips, pick, AI) — don't reopen
    clearTimeout(timer);
    timer = setTimeout(search, 220);
  });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) search(); });
  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; render(input.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(input.value); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(active); }
    else if (e.key === 'Escape') close();
  });
  // mousedown fires before blur, so the click is not lost
  list.addEventListener('mousedown', e => {
    const b = e.target.closest('.model-ac-item');
    if (b) { e.preventDefault(); pick(Number(b.dataset.i)); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
window.setupModelAutocomplete = setupModelAutocomplete;

// ---------------------------------------------------------------------------
// Multi-disk editor: one row per drive instead of a single text box.
// The original <input> stays (hidden) and keeps "A / B / C", so every other piece
// of code that reads or writes .value keeps working; the rows follow it.
// ---------------------------------------------------------------------------
function setupMultiDiskInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.multiDisk) return;
  input.dataset.multiDisk = '1';
  input.dataset.multi = '1';

  const box = document.createElement('div');
  box.className = 'disk-editor';
  input.insertAdjacentElement('afterend', box);
  input.style.display = 'none';

  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const getRaw = () => proto.get.call(input);
  const setRaw = v => proto.set.call(input, v);
  const split = v => String(v || '').split(' / ').map(s => s.trim()).filter(Boolean);
  let rendering = false;

  function sync() {
    const vals = [...box.querySelectorAll('.disk-row-input')].map(i => i.value.trim()).filter(Boolean);
    setRaw(vals.join(' / '));
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
  }

  function addRow(value = '', focus = false) {
    const row = document.createElement('div');
    row.className = 'disk-row';
    row.innerHTML = `<span class="disk-row-n"></span>
      <input type="text" class="form-control disk-row-input" dir="ltr" placeholder="مثلاً 256GB NVMe SSD یا WD 500GB HDD">
      <button type="button" class="disk-row-del" title="حذف این هارد">✖</button>`;
    const field = row.querySelector('input');
    field.value = value;
    field.addEventListener('input', () => { if (!rendering) sync(); });
    // the same shorthand as the old single box: "nvme 256" -> "256GB NVMe SSD"
    field.addEventListener('blur', () => {
      const v = field.value.trim();
      for (const r of SHORTHAND_RULES.storage) if (r.pattern.test(v)) { field.value = r.replace; sync(); break; }
    });
    row.querySelector('.disk-row-del').addEventListener('click', () => {
      row.remove();
      if (!box.querySelector('.disk-row')) addRow();
      number();
      sync();
    });
    box.insertBefore(row, addBtn);
    number();
    if (focus) field.focus();
  }

  function number() {
    box.querySelectorAll('.disk-row').forEach((r, i) => { r.querySelector('.disk-row-n').textContent = `${i + 1}`; });
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn-secondary btn-sm disk-add-btn';
  addBtn.textContent = '➕ افزودن هارد / SSD';
  addBtn.addEventListener('click', () => addRow('', true));
  box.appendChild(addBtn);

  function render() {
    rendering = true;
    box.querySelectorAll('.disk-row').forEach(r => r.remove());
    const vals = split(getRaw());
    (vals.length ? vals : ['']).forEach(v => addRow(v));
    rendering = false;
  }

  // Code that sets input.value (AI scan, same-model copy, edit form...) redraws the rows
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: getRaw,
    set(v) { setRaw(v); render(); }
  });
  render();
}
window.setupMultiDiskInput = setupMultiDiskInput;

// Render interactive chips below a form field
function setupFieldChips(inputId, defaultChips = [], dbItems = [], callback) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // The autocomplete wraps the model input; chips belong below the wrapper
  const acWrap = input.closest('.model-ac-wrap');
  const parent = acWrap ? acWrap.parentElement : input.parentElement;
  if (!parent) return;

  // Remove existing chips if any
  const existing = parent.querySelector('.chips-container');
  if (existing) existing.remove();

  // Merge default chips and DB items
  const combined = [];
  const seen = new Set();

  // First add recent items from DB
  if (Array.isArray(dbItems)) {
    dbItems.slice(0, 4).forEach(item => {
      if (item && item.trim() && !seen.has(item.toLowerCase())) {
        seen.add(item.toLowerCase());
        combined.push({ label: `🕒 ${item.slice(0, 24)}`, value: item, isRecent: true });
      }
    });
  }

  // Next add default presets
  if (Array.isArray(defaultChips)) {
    defaultChips.forEach(chip => {
      if (!seen.has(chip.value.toLowerCase())) {
        seen.add(chip.value.toLowerCase());
        combined.push(chip);
      }
    });
  }

  if (combined.length === 0) return;

  // Create chips container
  const container = document.createElement('div');
  container.className = 'chips-container';

  combined.slice(0, 8).forEach(chip => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-btn' + (chip.isRecent ? ' chip-recent' : '');
    btn.textContent = chip.label;
    btn.title = chip.value;

    btn.onclick = (e) => {
      e.preventDefault();
      if (input.dataset.multi) {
        // multi-disk field: a chip adds one more drive instead of replacing the list
        const list = String(input.value || '').split(' / ').map(s => s.trim()).filter(Boolean);
        if (!list.some(d => d.toLowerCase() === chip.value.toLowerCase())) list.push(chip.value);
        input.value = list.join(' / ');
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
        if (callback) callback(chip.value);
        return;
      }
      input.value = chip.value;
      input.focus();
      // Visual feedback
      input.style.borderColor = '#10b981';
      setTimeout(() => { input.style.borderColor = ''; }, 600);
      // Trigger input listeners (photo suggestion / serial dup check)
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
      if (callback) callback(chip.value);
    };

    container.appendChild(btn);
  });

  parent.appendChild(container);
}

// Auto-fill multiple fields when a known model is selected
function applyModelPreset(modelName) {
  if (!modelName) return;
  const clean = modelName.toLowerCase().trim();

  for (const [key, preset] of Object.entries(MODEL_PRESETS)) {
    if (clean.includes(key)) {
      const cpu = document.getElementById('cpu');
      const gpu = document.getElementById('gpu');
      const cat = document.getElementById('category');
      const monitors = document.getElementById('monitors');

      // Same model = same CPU / GPU; RAM and disks differ per unit, so they are not filled from presets
      if (cpu && (!cpu.value || cpu.value === '.') && preset.cpu) cpu.value = preset.cpu;
      if (gpu && (!gpu.value || gpu.value === '.') && preset.gpu) gpu.value = preset.gpu;
      if (monitors && !monitors.value && preset.monitors) monitors.value = preset.monitors;
      if (cat && preset.category && cat.value !== preset.category) {
        cat.value = preset.category;
        cat.dispatchEvent(new Event('change'));
      }
      break;
    }
  }
}

// Shorthand handler
function setupShorthand(inputId, rules, afterHook) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const expand = () => {
    const val = input.value.trim();
    if (!val) return;

    for (const r of rules) {
      if (r.pattern.test(val)) {
        input.value = r.replace;
        input.style.borderColor = '#10b981';
        setTimeout(() => { input.style.borderColor = ''; }, 600);
        try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
        break;
      }
    }
    if (afterHook) afterHook(input.value);
  };

  input.addEventListener('blur', expand);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') expand();
  });
}

// Online Spec Search via AI / Internet
async function lookupModelOnline() {
  const modelInput = document.getElementById('manufacturer_model') || document.getElementById('edit-model');
  if (!modelInput || !modelInput.value.trim()) {
    alert('لطفاً ابتدا نام یا مدل دستگاه را در کادر بنویسید (مثال: HP EliteDesk 800 G3)');
    if (modelInput) modelInput.focus();
    return;
  }

  const modelName = modelInput.value.trim();
  const btn = document.getElementById('online-lookup-btn');
  const status = document.getElementById('model-lookup-status');

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ در حال استعلام مشخصات...';
  }
  if (status) {
    status.style.display = 'block';
    status.style.color = '#a78bfa';
    status.textContent = 'در حال جستجو و استخراج کانفیگ‌های رسمی این مدل...';
  }

  try {
    const res = await fetch('/api/gemini/lookup-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'استعلام با خطا مواجه شد');
    }

    const s = data.specs;
    if (s.canonical_name) modelInput.value = s.canonical_name;

    // Category
    if (s.category) {
      const cat = document.getElementById('category') || document.getElementById('edit-category');
      if (cat) { cat.value = s.category; cat.dispatchEvent(new Event('change')); }
    }

    // Default CPU (only when empty)
    const cpuInput = document.getElementById('cpu') || document.getElementById('edit-cpu');
    if (cpuInput && s.default_cpu && !cpuInput.value.trim()) {
      cpuInput.value = s.default_cpu;
      cpuInput.style.borderColor = '#10b981';
      setTimeout(() => { cpuInput.style.borderColor = ''; }, 1000);
    }

    // Generate CPU Chips from discovered CPU options!
    if (Array.isArray(s.cpu_options) && s.cpu_options.length > 0) {
      const cpuChips = s.cpu_options.map(opt => ({ label: `⚡ ${opt}`, value: opt }));
      setupFieldChips('cpu', cpuChips, []);
      setupFieldChips('edit-cpu', cpuChips, []);
    }

    // Computers: RAM / disks differ per unit, so the factory defaults are only offered as chips below the fields
    const catEl = document.getElementById('category') || document.getElementById('edit-category');
    const isComputer = COMPUTER_FAMILIES.has(categoryFamily(catEl ? catEl.value : s.category));

    // Default RAM
    const ramInput = document.getElementById('ram') || document.getElementById('edit-ram');
    if (ramInput && s.default_ram && !isComputer) {
      ramInput.value = s.default_ram;
      ramInput.style.borderColor = '#10b981';
      setTimeout(() => { ramInput.style.borderColor = ''; }, 1000);
    }

    // Generate RAM Chips from discovered RAM options!
    if (Array.isArray(s.ram_options) && s.ram_options.length > 0) {
      const ramChips = s.ram_options.map(opt => ({ label: `🧠 ${opt}`, value: opt }));
      setupFieldChips('ram', ramChips, []);
      setupFieldChips('edit-ram', ramChips, []);
    }

    // Default Storage
    const storageInput = document.getElementById('storage_drives') || document.getElementById('edit-storage');
    if (storageInput && s.default_storage && !isComputer) {
      storageInput.value = s.default_storage;
      storageInput.style.borderColor = '#10b981';
      setTimeout(() => { storageInput.style.borderColor = ''; }, 1000);
    }

    // Generate Storage Chips
    if (Array.isArray(s.storage_options) && s.storage_options.length > 0) {
      const storChips = s.storage_options.map(opt => ({ label: `💾 ${opt}`, value: opt }));
      setupFieldChips('storage_drives', storChips, []);
      setupFieldChips('edit-storage', storChips, []);
    }

    // GPU & Monitors
    const gpuInput = document.getElementById('gpu');
    if (gpuInput && s.gpu) gpuInput.value = s.gpu;

    const monInput = document.getElementById('monitors') || document.getElementById('edit-monitors');
    if (monInput && s.monitors) monInput.value = s.monitors;

    // Notes
    if (s.notes) {
      const notesInput = document.getElementById('notes') || document.getElementById('edit-notes');
      if (notesInput) {
        notesInput.value = (notesInput.value ? notesInput.value + '\n' : '') + `💡 ${s.notes}`;
      }
    }

    if (status) {
      status.style.color = 'var(--success)';
      status.innerHTML = `✅ <strong>مشخصات استاندارد این مدل یافت شد!</strong> پردازنده‌ها و گزینه‌های پیشنهادی به صورت دکمه زیر فیلدها اضافه شدند.`;
    }
  } catch (err) {
    if (status) {
      status.style.color = 'var(--danger)';
      status.textContent = `⚠️ ${err.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🌐 استعلام مجدد مشخصات';
    }
  }
}

// Auto-run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSmartFill);
} else {
  initSmartFill();
}
