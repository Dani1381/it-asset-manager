// smart-fill.js - Intelligent Autocomplete, Memory & Hardware Shortcuts for IT Asset Master

// Model Hardware Profiles / Presets
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
  'dell latitude 5420': {
    category: 'Laptop',
    cpu: 'Intel(R) Core(TM) i5-1145G7 @ 2.60GHz',
    ram: '16 GB',
    storage_drives: '256GB NVMe SSD',
    gpu: 'Intel(R) Iris(R) Xe Graphics'
  },
  'samsung s27c31x': {
    category: 'Monitor',
    monitors: 'Samsung S27C31x (27" IPS 75Hz)'
  },
  'samsung s22f350': {
    category: 'Monitor',
    monitors: 'Samsung S22F350 (22" Full HD)'
  }
};

// Common IT Hardware Shortcuts & Abbreviations
const HARDWARE_SHORTCUTS = {
  // Storage shortcuts
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

  // RAM shortcuts
  ram: [
    { pattern: /^4$/i, replace: '4 GB' },
    { pattern: /^8$/i, replace: '8 GB' },
    { pattern: /^16$/i, replace: '16 GB' },
    { pattern: /^32$/i, replace: '32 GB' },
    { pattern: /^64$/i, replace: '64 GB' },
    { pattern: /^4\s*d(?:dr)?3$/i, replace: '4 GB DDR3' },
    { pattern: /^8\s*d(?:dr)?3$/i, replace: '8 GB DDR3' },
    { pattern: /^8\s*d(?:dr)?4$/i, replace: '8 GB DDR4' },
    { pattern: /^16\s*d(?:dr)?4$/i, replace: '16 GB DDR4' },
    { pattern: /^32\s*d(?:dr)?4$/i, replace: '32 GB DDR4' },
    { pattern: /^16\s*d(?:dr)?5$/i, replace: '16 GB DDR5' },
    { pattern: /^32\s*d(?:dr)?5$/i, replace: '32 GB DDR5' },
  ],

  // CPU shortcuts
  cpu: [
    { pattern: /^i3\s*6\w*$/i, replace: 'Intel Core i3-6100 CPU @ 3.70GHz' },
    { pattern: /^i5\s*6500$/i, replace: 'Intel Core i5-6500 CPU @ 3.20GHz' },
    { pattern: /^i5\s*7500$/i, replace: 'Intel Core i5-7500 CPU @ 3.40GHz' },
    { pattern: /^i5\s*8500$/i, replace: 'Intel Core i5-8500 CPU @ 3.00GHz' },
    { pattern: /^i5\s*10400$/i, replace: 'Intel Core i5-10400 CPU @ 2.90GHz' },
    { pattern: /^i5\s*12400$/i, replace: 'Intel Core i5-12400 CPU @ 2.50GHz' },
    { pattern: /^i7\s*6700$/i, replace: 'Intel Core i7-6700 CPU @ 3.40GHz' },
    { pattern: /^i7\s*7700$/i, replace: 'Intel Core i7-7700 CPU @ 3.60GHz' },
    { pattern: /^i7\s*8700$/i, replace: 'Intel Core i7-8700 CPU @ 3.20GHz' },
    { pattern: /^i7\s*10700$/i, replace: 'Intel Core i7-10700 CPU @ 2.90GHz' },
    { pattern: /^i7\s*12700$/i, replace: 'Intel Core i7-12700 CPU @ 2.10GHz' },
  ],

  // Model shortcuts
  model: [
    { pattern: /^hp\s*800\s*g3$/i, replace: 'HP EliteDesk 800 G3 SFF' },
    { pattern: /^hp\s*800\s*g4$/i, replace: 'HP EliteDesk 800 G4 SFF' },
    { pattern: /^hp\s*800\s*g5$/i, replace: 'HP EliteDesk 800 G5 SFF' },
    { pattern: /^hp\s*600\s*g3$/i, replace: 'HP ProDesk 600 G3 SFF' },
    { pattern: /^hp\s*400\s*g5$/i, replace: 'HP ProDesk 400 G5 SFF' },
    { pattern: /^dell\s*7050$/i, replace: 'Dell OptiPlex 7050' },
    { pattern: /^dell\s*7060$/i, replace: 'Dell OptiPlex 7060' },
    { pattern: /^dell\s*3050$/i, replace: 'Dell OptiPlex 3050' },
    { pattern: /^dell\s*5420$/i, replace: 'Dell Latitude 5420' },
    { pattern: /^dell\s*5430$/i, replace: 'Dell Latitude 5430' },
    { pattern: /^sam(?:sung)?\s*27$/i, replace: 'Samsung 27" S27C31x' },
    { pattern: /^sam(?:sung)?\s*22$/i, replace: 'Samsung 22" S22F350' },
    { pattern: /^sam(?:sung)?\s*24$/i, replace: 'Samsung 24" Essential Monitor' },
    { pattern: /^lg\s*24$/i, replace: 'LG 24" IPS Monitor' },
    { pattern: /^lg\s*22$/i, replace: 'LG 22" Monitor' },
  ],

  // Monitor shortcuts
  monitors: [
    { pattern: /^sam(?:sung)?\s*27$/i, replace: 'Samsung S27C31x (27")' },
    { pattern: /^sam(?:sung)?\s*22$/i, replace: 'Samsung S22F350 (22")' },
    { pattern: /^dual\s*27$/i, replace: 'Dual 27" Monitors' },
    { pattern: /^dual\s*24$/i, replace: 'Dual 24" Monitors' },
    { pattern: /^hp\s*24$/i, replace: 'HP EliteDisplay E243 (24")' },
  ]
};

// Initialize Smart-Fill for a page
async function initSmartFill() {
  let suggestions = {};
  try {
    const res = await fetch('/api/suggestions');
    if (res.ok) {
      suggestions = await res.json();
    }
  } catch (e) {
    console.warn('Could not load suggestions:', e);
  }

  // 2. Build HTML Datalists
  createDatalist('dl-models', suggestions.models || []);
  createDatalist('dl-cpus', suggestions.cpus || []);
  createDatalist('dl-rams', suggestions.rams || ['8 GB', '16 GB', '32 GB', '4 GB', '64 GB']);
  createDatalist('dl-storages', suggestions.storages || ['256GB SSD', '512GB SSD', '1TB SSD', '500GB HDD', '1TB HDD']);
  createDatalist('dl-gpus', suggestions.gpus || ['Intel HD Graphics', 'NVIDIA GeForce', 'Integrated Graphics']);
  createDatalist('dl-monitors', suggestions.monitors || ['Samsung S27C31x', 'Samsung S22F350', 'LG 24" IPS', 'Default Display']);
  createDatalist('dl-locations', suggestions.locations || ['انبار مرکزی', 'طبقه اول', 'طبقه دوم', 'اتاق سرور', 'واحد IT']);
  createDatalist('dl-departments', suggestions.departments || ['پشتیبانی IT', 'حسابداری', 'فروش', 'منابع انسانی', 'مدیریت']);
  createDatalist('dl-users', suggestions.users || []);

  // 3. Attach Datalists to Form Inputs
  attachListToInput('manufacturer_model', 'dl-models');
  attachListToInput('cpu', 'dl-cpus');
  attachListToInput('ram', 'dl-rams');
  attachListToInput('storage_drives', 'dl-storages');
  attachListToInput('gpu', 'dl-gpus');
  attachListToInput('monitors', 'dl-monitors');
  attachListToInput('location', 'dl-locations');
  attachListToInput('department', 'dl-departments');
  attachListToInput('user_name', 'dl-users');

  // Edit modal inputs
  attachListToInput('edit-model', 'dl-models');
  attachListToInput('edit-cpu', 'dl-cpus');
  attachListToInput('edit-ram', 'dl-rams');
  attachListToInput('edit-storage', 'dl-storages');
  attachListToInput('edit-monitors', 'dl-monitors');
  attachListToInput('edit-location', 'dl-locations');
  attachListToInput('edit-department', 'dl-departments');
  attachListToInput('edit-user', 'dl-users');

  // 4. Attach Live Typing Expansion Handlers
  setupInputExpansion('storage_drives', HARDWARE_SHORTCUTS.storage);
  setupInputExpansion('ram', HARDWARE_SHORTCUTS.ram);
  setupInputExpansion('cpu', HARDWARE_SHORTCUTS.cpu);
  setupInputExpansion('manufacturer_model', HARDWARE_SHORTCUTS.model, applyModelPreset);
  setupInputExpansion('monitors', HARDWARE_SHORTCUTS.monitors);
  
  setupInputExpansion('edit-model', HARDWARE_SHORTCUTS.model);
  setupInputExpansion('edit-ram', HARDWARE_SHORTCUTS.ram);
}

// Helper: Apply known model presets
function applyModelPreset(modelName) {
  const clean = modelName.toLowerCase().trim();
  for (const [key, preset] of Object.entries(MODEL_PRESETS)) {
    if (clean.includes(key)) {
      const cpu = document.getElementById('cpu');
      const ram = document.getElementById('ram');
      const storage = document.getElementById('storage_drives');
      const gpu = document.getElementById('gpu');
      const cat = document.getElementById('category');
      const monitors = document.getElementById('monitors');

      if (cpu && !cpu.value && preset.cpu) cpu.value = preset.cpu;
      if (ram && !ram.value && preset.ram) ram.value = preset.ram;
      if (storage && !storage.value && preset.storage_drives) storage.value = preset.storage_drives;
      if (gpu && !gpu.value && preset.gpu) gpu.value = preset.gpu;
      if (monitors && !monitors.value && preset.monitors) monitors.value = preset.monitors;
      if (cat && preset.category) cat.value = preset.category;
      break;
    }
  }
}

// Helper: Create <datalist> in document body
function createDatalist(id, items) {
  let dl = document.getElementById(id);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = id;
    document.body.appendChild(dl);
  }
  const unique = Array.from(new Set(items)).filter(Boolean);
  dl.innerHTML = unique.map(item => `<option value="${escapeHtml(item)}"></option>`).join('');
}

// Helper: Attach datalist to an input field
function attachListToInput(inputId, datalistId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.setAttribute('list', datalistId);
    input.setAttribute('autocomplete', 'off');
  }
}

// Helper: Expand shorthand as user types or on blur/Enter
function setupInputExpansion(inputId, rules, afterHook) {
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
        break;
      }
    }
    if (afterHook) afterHook(input.value);
  };

  input.addEventListener('blur', expand);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      expand();
    }
  });
}

// Auto-run on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSmartFill);
} else {
  initSmartFill();
}
