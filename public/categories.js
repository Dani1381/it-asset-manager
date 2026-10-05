// categories.js - Single source of truth for device categories (icons, labels, families)
// Loaded after i18n.js on every page. Fills any <select data-category-select> with the list.

const ASSET_CATEGORIES = [
  { value: 'PC',           icon: '🖥️', fa: 'کامپیوتر / کیس',            en: 'Computers / Towers',      family: 'pc' },
  { value: 'Single PC',    icon: '💻', fa: 'تک کیس / سیستم کاربر',       en: 'Single PC / User System', family: 'pc' },
  { value: 'All-in-One',   icon: '🖥️', fa: 'آل‌این‌وان (All-in-One)',      en: 'All-in-One PCs',          family: 'pc' },
  { value: 'Laptop',       icon: '💻', fa: 'لپ‌تاپ',                      en: 'Laptops',                 family: 'laptop' },
  { value: 'Server',       icon: '🗄️', fa: 'سرور',                        en: 'Servers',                 family: 'server' },
  { value: 'Monitor',      icon: '📺', fa: 'مانیتور',                     en: 'Monitors',                family: 'monitor' },
  { value: 'Storage',      icon: '💽', fa: 'هارد درایو / SSD',            en: 'Hard Drives / SSD',       family: 'storage' },
  { value: 'Printer',      icon: '🖨️', fa: 'پرینتر / اسکنر',              en: 'Printers / Scanners',     family: 'printer' },
  { value: 'Modem',        icon: '📡', fa: 'مودم',                        en: 'Modems',                  family: 'modem' },
  { value: 'Router',       icon: '🛜', fa: 'روتر',                        en: 'Routers',                 family: 'router' },
  { value: 'Access Point', icon: '📶', fa: 'اکسس‌پوینت / وای‌فای',         en: 'Access Points / Wi-Fi',   family: 'network' },
  { value: 'Network',      icon: '🌐', fa: 'سوییچ و شبکه',                en: 'Network Switches',        family: 'network' },
  { value: 'UPS',          icon: '🔋', fa: 'یو‌پی‌اس (UPS)',               en: 'UPS',                     family: 'ups' },
  { value: 'VoIP Phone',   icon: '☎️', fa: 'تلفن / VoIP',                 en: 'Phones / VoIP',           family: 'phone' },
  { value: 'Camera',       icon: '📹', fa: 'دوربین مداربسته / DVR',       en: 'CCTV Cameras / DVR',      family: 'camera' },
  { value: 'Projector',    icon: '📽️', fa: 'ویدئو پروژکتور',              en: 'Projectors',              family: 'projector' },
  { value: 'Tablet',       icon: '📱', fa: 'تبلت / موبایل',               en: 'Tablets / Phones',        family: 'tablet' },
  { value: 'Peripheral',   icon: '⌨️', fa: 'کیبورد / ماوس / هدست',        en: 'Keyboards / Mice / Headsets', family: 'peripheral' },
  { value: 'Attendance Device', icon: '👆', fa: 'دستگاه حضور و غیاب (انگشت‌زنی)', en: 'Time Attendance (Fingerprint)', family: 'office' },
  { value: 'Office Machine', icon: '🗂️', fa: 'کاغذخردکن / پرس / لمینیت',   en: 'Shredders / Binding / Laminators', family: 'office' },
  { value: 'TV',           icon: '📺', fa: 'تلویزیون',                     en: 'Televisions',             family: 'appliance' },
  { value: 'Refrigerator', icon: '🧊', fa: 'یخچال / فریزر',                en: 'Refrigerators / Freezers', family: 'appliance' },
  { value: 'Water Cooler', icon: '🚰', fa: 'آبسردکن',                      en: 'Water Coolers',           family: 'appliance' },
  { value: 'Heater',       icon: '🔥', fa: 'بخاری برقی / گرمایشی',         en: 'Electric Heaters',        family: 'appliance' },
  { value: 'Air Conditioner', icon: '❄️', fa: 'کولر / اسپلیت',            en: 'Air Conditioners',        family: 'appliance' },
  { value: 'Kitchen Appliance', icon: '🍲', fa: 'مایکروویو / سماور / چای‌ساز', en: 'Kitchen Appliances',   family: 'appliance' },
  { value: 'Fan',          icon: '🌀', fa: 'پنکه',                         en: 'Fans',                    family: 'appliance' },
  { value: 'Other',        icon: '🔌', fa: 'سایر قطعات',                  en: 'Other Hardware',          family: 'other' }
];

function categoryKey(value) {
  return 'filter_' + String(value || 'other').toLowerCase().replace(/\s+/g, '_');
}

function findCategory(value) {
  const v = String(value || '').trim().toLowerCase();
  return ASSET_CATEGORIES.find(c => c.value.toLowerCase() === v) || null;
}

function categoryIcon(value) {
  const c = findCategory(value);
  return c ? c.icon : '🔌';
}

function categoryLabel(value) {
  const c = findCategory(value);
  if (!c) return value || '-';
  const lang = (typeof CURRENT_LANG !== 'undefined') ? CURRENT_LANG : 'fa';
  return lang === 'en' ? c.en : c.fa;
}

// Register translations so data-i18n="filter_xxx" works everywhere
(function registerCategoryTranslations() {
  if (typeof TRANSLATIONS === 'undefined') return;
  for (const c of ASSET_CATEGORIES) {
    const key = categoryKey(c.value);
    if (TRANSLATIONS.fa) TRANSLATIONS.fa[key] = `${c.icon} ${c.fa}`;
    if (TRANSLATIONS.en) TRANSLATIONS.en[key] = `${c.icon} ${c.en}`;
  }
})();

// Fill every category <select> (keeps an existing "all" option if present)
function populateCategorySelects(root = document) {
  root.querySelectorAll('select[data-category-select]').forEach(sel => {
    const current = sel.value;
    sel.querySelectorAll('option[data-cat-generated]').forEach(o => o.remove());
    for (const c of ASSET_CATEGORIES) {
      const opt = document.createElement('option');
      opt.value = c.value;
      opt.dataset.catGenerated = '1';
      opt.dataset.i18n = categoryKey(c.value);
      opt.textContent = (typeof getTranslation === 'function') ? getTranslation(categoryKey(c.value)) : `${c.icon} ${c.fa}`;
      sel.appendChild(opt);
    }
    if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => populateCategorySelects());
} else {
  populateCategorySelects();
}

// Physical condition of a device (default: healthy)
const HEALTH_STATES = [
  { value: 'healthy',     icon: '✅', fa: 'سالم',                 en: 'Healthy',              hint: 'کاملاً سالم و تست‌شده' },
  { value: 'initial_ok',  icon: '🟢', fa: 'سالم در تست اولیه',    en: 'OK on first test',     hint: 'ظاهر و روشن‌شدن اولیه اوکی است، ولی تست کامل نشده' },
  { value: 'minor_issue', icon: '🟡', fa: 'کار می‌کند، ایراد جزئی', en: 'Works, minor issue',   hint: 'کار می‌کند ولی ایراد کوچکی دارد (خط و خش، پیکسل، باتری ضعیف...)' },
  { value: 'needs_check', icon: '🟠', fa: 'نیازمند بررسی',        en: 'Needs inspection',     hint: 'رفتار مشکوک دارد و باید بررسی شود' },
  { value: 'untested',    icon: '⚪', fa: 'تست نشده',             en: 'Not tested',           hint: 'هنوز روشن یا تست نشده' },
  { value: 'broken',      icon: '🔴', fa: 'خراب',                 en: 'Broken',               hint: 'کار نمی‌کند' }
];

function findHealth(value) {
  return HEALTH_STATES.find(h => h.value === value) || HEALTH_STATES[0];
}

function healthLabel(value) {
  const h = findHealth(value);
  const lang = (typeof CURRENT_LANG !== 'undefined') ? CURRENT_LANG : 'fa';
  return `${h.icon} ${lang === 'en' ? h.en : h.fa}`;
}

// Segmented picker bound to a hidden <input>. Returns a setter.
function buildHealthPicker(container, input) {
  container.classList.add('health-picker');
  container.innerHTML = HEALTH_STATES.map(h =>
    `<button type="button" class="health-option health-${h.value}" data-value="${h.value}" title="${h.hint}">${h.icon} ${h.fa}</button>`
  ).join('');
  const set = (value) => {
    const v = findHealth(value).value;
    input.value = v;
    container.querySelectorAll('.health-option').forEach(b => b.classList.toggle('active', b.dataset.value === v));
  };
  container.addEventListener('click', e => {
    const b = e.target.closest('.health-option');
    if (b) set(b.dataset.value);
  });
  set(input.value || 'healthy');
  return set;
}

// ---- Storage text -> one chip per disk ("TOSHIBA DT01ACA050 (466GB) / Lexar SSD NM620 256GB (238GB)") ----
function guessDiskKind(model) {
  const m = String(model || '');
  if (/nvme|\bsn\d{3}\b|mzvl|pm9\d\d|\b9[78]0\b|\bnm\d{3}\b/i.test(m)) return 'NVMe';
  if (/ssd|\bsu\d{3}\b|a400|c800|evo|mx500|bx500|sandisk|lexar|green 2\.5|\bmz7/i.test(m)) return 'SSD';
  if (/^st\d|wdc|\bwd\d|\bwd(blue|black|red|purple)|hgst|hitachi|toshiba|seagate|barracuda|maxtor|samsung hd\d|hdd|\bdt01|\bhd7\d\d|hard (drive|disk)/i.test(m)) return 'HDD';
  return '';
}

function parseDisks(text) {
  return String(text || '').split(' / ').map(s => s.trim())
    .filter(s => s && !/^\d?$/.test(s) && !/usb device|flash drive/i.test(s))
    .map(s => {
      const m = s.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\s*(GB|TB)\)\s*$/i);
      const model = (m ? m[1] : s).replace(/\s+ATA Device$/i, '').trim();
      let size = '';
      if (m) {
        const gb = Number(m[2]) * (m[3].toUpperCase() === 'TB' ? 1024 : 1);
        size = gb >= 1000 ? `${Math.round(gb / 1024 * 10) / 10}TB` : `${Math.round(gb)}GB`;
      }
      return { model, size, kind: guessDiskKind(s) };
    });
}

function diskChipsHtml(text) {
  const disks = parseDisks(text);
  if (!disks.length) return '';
  const icon = { NVMe: '⚡', SSD: '💠', HDD: '💿' };
  const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  return `<span class="disk-chips">${disks.map(d => `
    <span class="disk-chip kind-${(d.kind || 'other').toLowerCase()}" title="${e(d.model)}${d.size ? ' · ' + d.size : ''}">
      <span class="disk-chip-icon">${icon[d.kind] || '💾'}</span>
      ${d.kind ? `<span class="disk-chip-kind">${d.kind}</span>` : ''}
      ${d.size ? `<span class="disk-chip-size">${e(d.size)}</span>` : ''}
      <span class="disk-chip-model">${e(d.model)}</span>
    </span>`).join('')}</span>`;
}

window.parseDisks = parseDisks;
window.diskChipsHtml = diskChipsHtml;

// ---- CPU / RAM / GPU details for the component chips ----
const chipEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

function cpuInfo(cpu) {
  const raw = String(cpu || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const info = { raw, name: '', gen: null, ghz: '', threads: '', cores: '', family: '' };
  let m;
  if ((m = raw.match(/\b(i[3579])-\s?(\d{4,5})([A-Z]{0,2})\b/i))) {
    info.name = `Core ${m[1].toLowerCase()}-${m[2]}${m[3] || ''}`;
    const num = m[2];
    info.gen = num.length === 5 ? Number(num.slice(0, 2)) : Number(num[0]);
    info.family = 'core';
  } else if ((m = raw.match(/\b(i[3579]) CPU\s+(\d{3})\b/i))) {          // 1st gen: "Core(TM) i5 CPU 650"
    info.name = `Core ${m[1].toLowerCase()} ${m[2]}`; info.gen = 1; info.family = 'core';
  } else if ((m = raw.match(/Core\(TM\)2 (Duo|Quad)\s+CPU\s+([A-Z]\d{4})/i) || raw.match(/Core 2 (Duo|Quad)\s+([A-Z]?\d{4})/i))) {
    info.name = `Core 2 ${m[1]} ${m[2]}`; info.family = 'core2';
  } else if ((m = raw.match(/\b(Pentium|Celeron|Xeon|Athlon)(?:\(R\))?\s*(?:CPU\s*)?([A-Z]?\d{3,4}[A-Z]?(?:\s*v\d)?)/i))) {
    info.name = `${m[1]} ${m[2]}`; info.family = m[1].toLowerCase();
  } else if ((m = raw.match(/Ryzen\s+\d\s+\d{4}\w*/i))) {
    info.name = m[0]; info.family = 'ryzen';
  } else {
    info.name = raw.replace(/\(R\)|\(TM\)|CPU|@.*$/gi, '').replace(/\s+/g, ' ').trim();
  }
  if ((m = raw.match(/@\s*([\d.]+)\s*GHz/i))) info.ghz = `${Number(m[1])}GHz`;
  if ((m = raw.match(/(\d+)\s*Threads?/i))) info.threads = m[1];
  if ((m = raw.match(/(\d+)\s*Cores?/i))) info.cores = m[1];
  return info;
}

// DDR generation a desktop of this CPU uses (estimate when the scanner did not report it)
function ramTypeFromCpu(ci) {
  if (!ci) return '';
  if (ci.family === 'core2') return 'DDR2/DDR3';
  if (ci.family === 'core' && ci.gen) {
    if (ci.gen <= 5) return 'DDR3';
    if (ci.gen <= 11) return 'DDR4';
    return 'DDR4/DDR5';
  }
  if (ci.family === 'ryzen') return 'DDR4';
  return '';
}

function ramInfo(ram, cpu) {
  const raw = String(ram || '').trim();
  const m = raw.match(/(\d+(?:\.\d+)?)\s*GB/i);
  if (!m) return null;
  const type = (raw.match(/\bDDR\d\w*\b/i) || [''])[0].toUpperCase();
  const speed = (raw.match(/(\d{3,4})\s*MHz/i) || [])[1] || '';
  // "(2x8GB)" or "(2x4GB + 1x8GB)" -> "2×8GB" / "2×4GB + 1×8GB"
  const modGroup = (raw.match(/\(([^)]*\d+\s*[x×]\s*\d+(?:\.\d+)?\s*GB[^)]*)\)/i) || [])[1] || '';
  const modules = modGroup.replace(/\s*[x×]\s*/g, '×').replace(/\s+/g, ' ').trim();
  const guessed = type ? '' : ramTypeFromCpu(cpuInfo(cpu));
  return { gb: `${Math.round(Number(m[1]))} GB`, type: type || guessed, guessed: !type && !!guessed, speed: speed ? `${speed}MHz` : '', modules };
}

function gpuInfo(gpu) {
  const raw = String(gpu || '').replace(/^[0-9a-f:.]+ [^:]*: /i, '').replace(/\s+/g, ' ').trim();
  if (!raw || /^(standard graphics|n\/?a)/i.test(raw)) return null;
  const parts = raw.split(' / ').map(s => s.trim()).filter(Boolean);
  return parts.map(p => {
    const dedicated = /nvidia|geforce|quadro|radeon (rx|pro|hd \d{4})|amd radeon(?! graphics)|\bgtx\b|\brtx\b/i.test(p) && !/radeon\(tm\) graphics|vega \d+ graphics/i.test(p);
    let name = p.replace(/\(R\)|\(TM\)|Corporation|Integrated Graphics Controller|Graphics Controller/gi, '').replace(/\s+/g, ' ').trim();
    const hd = p.match(/\[([^\]]+)\]/); // lspci: "IvyBridge GT2 [HD Graphics 4000]"
    if (hd) name = `Intel ${hd[1]}`;
    // lspci family names without the marketing name
    else if (/2nd Generation Core Processor Family/i.test(p)) name = 'Intel HD Graphics 2000/3000';
    else if (/3rd Gen Core processor Graphics/i.test(p)) name = 'Intel HD Graphics 2500/4000';
    else if (/4th Gen Core Processor Integrated Graphics|Xeon E3-1200 v3/i.test(p)) name = 'Intel HD Graphics 4400/4600';
    else if (/^Intel\s*(?:Corporation\s*)?\d{1,2}(?:st|nd|rd|th) Gen/i.test(name)) name = 'Intel HD Graphics';
    return { name, kind: dedicated ? 'مجزا' : 'آنبرد' };
  });
}

// One coloured chip; `compact` hides the long detail (dashboard cards)
function partChip(kind, mainText, tags, detail, title) {
  return `<span class="part-chip part-${kind}" title="${chipEsc(title || '')}">
    <span class="part-chip-main">${chipEsc(mainText)}</span>
    ${tags.filter(Boolean).map(t => `<span class="part-chip-tag${t.dim ? ' is-dim' : ''}">${chipEsc(t.text || t)}</span>`).join('')}
    ${detail ? `<span class="part-chip-detail">${chipEsc(detail)}</span>` : ''}
  </span>`;
}

function cpuChipHtml(cpu) {
  const c = cpuInfo(cpu);
  if (!c) return '';
  const tags = [];
  if (c.gen) tags.push(`نسل ${c.gen}`);
  if (c.ghz) tags.push(c.ghz);
  if (c.cores && c.threads) tags.push(`${c.cores} هسته / ${c.threads} رشته`);
  else if (c.threads) tags.push(`${c.threads} رشته`);
  return `<span class="part-chips">${partChip('cpu', c.name, tags, '', c.raw)}</span>`;
}

function ramChipHtml(ram, cpu) {
  const r = ramInfo(ram, cpu);
  if (!r) return '';
  const tags = [];
  if (r.type) tags.push({ text: r.guessed ? `${r.type} ≈` : r.type, dim: r.guessed });
  if (r.speed) tags.push(r.speed);
  if (r.modules) tags.push(r.modules);
  const title = r.guessed ? `${ram} — نوع رم از روی نسل پردازنده تخمین زده شده` : String(ram);
  return `<span class="part-chips">${partChip('ram', r.gb, tags, '', title)}</span>`;
}

function gpuChipHtml(gpu) {
  const list = gpuInfo(gpu);
  if (!list || !list.length) return '';
  return `<span class="part-chips">${list.map(g => partChip('gpu', g.name, [g.kind], '', String(gpu))).join('')}</span>`;
}

// ---- Price (Toman) ----
function formatPrice(v, short) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const fa = x => x.toLocaleString('fa-IR');
  if (short) {
    if (n >= 1e9) return `${fa(Math.round(n / 1e8) / 10)} میلیارد تومان`;
    if (n >= 1e6) return `${fa(Math.round(n / 1e5) / 10)} میلیون تومان`;
    if (n >= 1e3) return `${fa(Math.round(n / 1e3))} هزار تومان`;
  }
  return `${fa(n)} تومان`;
}

// "12500000" while typing -> "12,500,000" (accepts Persian digits)
function bindPriceInput(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const digits = input.value.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d]/g, '');
    input.value = digits ? Number(digits).toLocaleString('en-US') : '';
  });
}

window.formatPrice = formatPrice;
window.bindPriceInput = bindPriceInput;

window.cpuInfo = cpuInfo;
window.ramInfo = ramInfo;
window.cpuChipHtml = cpuChipHtml;
window.ramChipHtml = ramChipHtml;
window.gpuChipHtml = gpuChipHtml;

window.HEALTH_STATES = HEALTH_STATES;
window.findHealth = findHealth;
window.healthLabel = healthLabel;
window.buildHealthPicker = buildHealthPicker;

window.ASSET_CATEGORIES = ASSET_CATEGORIES;
window.findCategory = findCategory;
window.categoryIcon = categoryIcon;
window.categoryLabel = categoryLabel;
window.populateCategorySelects = populateCategorySelects;
