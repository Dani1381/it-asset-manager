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
    { label: '🖥️ HP 800 G3 SFF', value: 'HP EliteDesk 800 G3 SFF' },
    { label: '🖥️ HP 800 G4 SFF', value: 'HP EliteDesk 800 G4 SFF' },
    { label: '🖥️ Dell OptiPlex 7050', value: 'Dell OptiPlex 7050' },
    { label: '🖥️ Dell OptiPlex 780', value: 'Dell OptiPlex 780' },
    { label: '💻 Dell Latitude 5420', value: 'Dell Latitude 5420' },
    { label: '📺 Samsung 27"', value: 'Samsung S27C31x' },
    { label: '📺 Samsung 22"', value: 'Samsung S22F350' }
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

// Main Initialization
async function initSmartFill() {
  let dbSuggestions = {};
  try {
    const res = await fetch('/api/suggestions');
    if (res.ok) {
      dbSuggestions = await res.json();
    }
  } catch (e) {
    console.warn('Could not load suggestions:', e);
  }

  // Render suggestion chips container for each input
  setupFieldChips('manufacturer_model', CHIP_PRESETS.manufacturer_model, dbSuggestions.models, applyModelPreset);
  setupFieldChips('storage_drives', CHIP_PRESETS.storage_drives, dbSuggestions.storages);
  setupFieldChips('ram', CHIP_PRESETS.ram, dbSuggestions.rams);
  setupFieldChips('cpu', CHIP_PRESETS.cpu, dbSuggestions.cpus);
  setupFieldChips('monitors', CHIP_PRESETS.monitors, dbSuggestions.monitors);
  setupFieldChips('gpu', CHIP_PRESETS.gpu, dbSuggestions.gpus);
  setupFieldChips('location', CHIP_PRESETS.location, dbSuggestions.locations);
  setupFieldChips('department', CHIP_PRESETS.department, dbSuggestions.departments);

  // Edit modal fields
  setupFieldChips('edit-model', CHIP_PRESETS.manufacturer_model, dbSuggestions.models);
  setupFieldChips('edit-storage', CHIP_PRESETS.storage_drives, dbSuggestions.storages);
  setupFieldChips('edit-ram', CHIP_PRESETS.ram, dbSuggestions.rams);
  setupFieldChips('edit-cpu', CHIP_PRESETS.cpu, dbSuggestions.cpus);
  setupFieldChips('edit-monitors', CHIP_PRESETS.monitors, dbSuggestions.monitors);
  setupFieldChips('edit-location', CHIP_PRESETS.location, dbSuggestions.locations);
  setupFieldChips('edit-department', CHIP_PRESETS.department, dbSuggestions.departments);

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
  container.style.display = 'flex';
  container.style.flexWrap = 'wrap';
  container.style.gap = '0.35rem';
  container.style.marginTop = '0.45rem';

  combined.slice(0, 7).forEach(chip => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-btn';
    btn.textContent = chip.label;
    btn.style.padding = '0.25rem 0.6rem';
    btn.style.fontSize = '0.8rem';
    btn.style.backgroundColor = chip.isRecent ? 'rgba(59, 130, 246, 0.18)' : 'rgba(255, 255, 255, 0.08)';
    btn.style.border = chip.isRecent ? '1px solid #3b82f6' : '1px solid var(--border-color)';
    btn.style.borderRadius = '20px';
    btn.style.color = chip.isRecent ? '#93c5fd' : 'var(--text-muted)';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.15s ease';
    btn.style.whiteSpace = 'nowrap';

    btn.onmouseover = () => {
      btn.style.backgroundColor = 'var(--primary)';
      btn.style.color = '#ffffff';
      btn.style.borderColor = 'var(--primary)';
    };
    btn.onmouseout = () => {
      btn.style.backgroundColor = chip.isRecent ? 'rgba(59, 130, 246, 0.18)' : 'rgba(255, 255, 255, 0.08)';
      btn.style.color = chip.isRecent ? '#93c5fd' : 'var(--text-muted)';
      btn.style.borderColor = chip.isRecent ? '1px solid #3b82f6' : 'var(--border-color)';
    };

    btn.onclick = (e) => {
      e.preventDefault();
      input.value = chip.value;
      input.focus();
      // Visual feedback
      input.style.borderColor = '#10b981';
      setTimeout(() => { input.style.borderColor = ''; }, 600);
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
      if (cat && preset.category) cat.value = preset.category;
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

// Auto-run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSmartFill);
} else {
  initSmartFill();
}
