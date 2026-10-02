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
    { label: '🌐 TP-Link 24-Port', value: 'TP-Link TL-SG1024D', cat: 'Network' }
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
  const c = String(cat || '').trim().toLowerCase();
  if (c === 'pc' || c === 'single pc' || c === 'case' || c === 'all-in-one') return 'pc';
  if (c === 'laptop') return 'laptop';
  if (c === 'monitor') return 'monitor';
  if (c === 'printer') return 'printer';
  if (c === 'network') return 'network';
  return 'other';
}

const COMPUTER_FAMILIES = new Set(['pc', 'laptop']);

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

  // Hardware chips only make sense for computers
  setupFieldChips(form.hw.cpu, isComputer ? CHIP_PRESETS.cpu : [], isComputer ? SMART_DB.cpus : []);
  setupFieldChips(form.hw.ram, isComputer ? CHIP_PRESETS.ram : [], isComputer ? SMART_DB.rams : []);
  setupFieldChips(form.hw.storage, isComputer ? CHIP_PRESETS.storage_drives : [], isComputer ? SMART_DB.storages : []);
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

  // Attach text expansions
  setupShorthand('storage_drives', SHORTHAND_RULES.storage);
  setupShorthand('ram', SHORTHAND_RULES.ram);
  setupShorthand('cpu', SHORTHAND_RULES.cpu);
  setupShorthand('manufacturer_model', SHORTHAND_RULES.model, applyModelPreset);

  setupShorthand('edit-storage', SHORTHAND_RULES.storage);
  setupShorthand('edit-ram', SHORTHAND_RULES.ram);
  setupShorthand('edit-cpu', SHORTHAND_RULES.cpu);
  setupShorthand('edit-model', SHORTHAND_RULES.model);
}

// Render interactive chips below a form field
function setupFieldChips(inputId, defaultChips = [], dbItems = [], callback) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const parent = input.parentElement;
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
      const ram = document.getElementById('ram');
      const storage = document.getElementById('storage_drives');
      const gpu = document.getElementById('gpu');
      const cat = document.getElementById('category');
      const monitors = document.getElementById('monitors');

      if (cpu && (!cpu.value || cpu.value === '.') && preset.cpu) cpu.value = preset.cpu;
      if (ram && (!ram.value || ram.value === '0') && preset.ram) ram.value = preset.ram;
      if (storage && (!storage.value || storage.value === '.') && preset.storage_drives) storage.value = preset.storage_drives;
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

    // Default CPU
    const cpuInput = document.getElementById('cpu') || document.getElementById('edit-cpu');
    if (cpuInput && s.default_cpu) {
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

    // Default RAM
    const ramInput = document.getElementById('ram') || document.getElementById('edit-ram');
    if (ramInput && s.default_ram) {
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
    if (storageInput && s.default_storage) {
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
