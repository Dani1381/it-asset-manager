// categories.js - Single source of truth for device categories (icons, labels, families)
// Loaded after i18n.js on every page. Fills any <select data-category-select> with the list.

const ASSET_CATEGORIES = [
  { value: 'PC',           icon: '🖥️', fa: 'کامپیوتر / کیس',            en: 'Computers / Towers',      family: 'pc' },
  { value: 'Single PC',    icon: '💻', fa: 'تک کیس / سیستم کاربر',       en: 'Single PC / User System', family: 'pc' },
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

window.HEALTH_STATES = HEALTH_STATES;
window.findHealth = findHealth;
window.healthLabel = healthLabel;
window.buildHealthPicker = buildHealthPicker;

window.ASSET_CATEGORIES = ASSET_CATEGORIES;
window.findCategory = findCategory;
window.categoryIcon = categoryIcon;
window.categoryLabel = categoryLabel;
window.populateCategorySelects = populateCategorySelects;
