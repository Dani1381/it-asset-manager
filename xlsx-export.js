// Styled .xlsx export without dependencies: RTL sheets, header styling, status colours,
// embedded photo thumbnails, number formats, totals and a summary sheet.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ---------- zip (deflate for XML, stored for images) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const deflate = !f.store;
    const data = deflate ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cbuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cbuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cbuf, end]);
}

// ---------- helpers ----------
const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function imageSize(buf, ext) {
  try {
    if (ext === 'png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  } catch (e) { /* fall through */ }
  return { w: 4, h: 3 };
}

// ---------- styles ----------
// cellXfs indices used below
const S = {
  normal: 0, title: 1, subtitle: 2, header: 3, text: 4, textAlt: 5, price: 6, priceAlt: 7,
  stActive: 8, stStorage: 9, stRepair: 10, stRetired: 11, link: 12, linkAlt: 13,
  hOk: 14, hWarn: 15, hBad: 16, totalLabel: 17, totalPrice: 18, num: 19, numAlt: 20, kpiLabel: 21, kpiValue: 22, center: 23, centerAlt: 24
};
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="8">
  <font><sz val="11"/><name val="Tahoma"/></font>
  <font><b/><sz val="18"/><color rgb="FF1E3A8A"/><name val="Tahoma"/></font>
  <font><sz val="10"/><color rgb="FF64748B"/><name val="Tahoma"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font>
  <font><b/><sz val="11"/><color rgb="FF1D4ED8"/><u/><name val="Tahoma"/></font>
  <font><b/><sz val="11"/><name val="Tahoma"/></font>
  <font><b/><sz val="12"/><color rgb="FF0F172A"/><name val="Tahoma"/></font>
  <font><b/><sz val="20"/><color rgb="FF1E40AF"/><name val="Tahoma"/></font>
</fonts>
<fills count="13">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFEDD5"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE0E7FF"/></patternFill></fill>
</fills>
<borders count="3">
  <border/>
  <border><left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right><top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom></border>
  <border><top style="medium"><color rgb="FF1E3A8A"/></top><bottom style="medium"><color rgb="FF1E3A8A"/></bottom></border>
</borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="25">
  <xf fontId="0" fillId="0" borderId="0"/>
  <xf fontId="1" fillId="0" borderId="0" applyFont="1"><alignment horizontal="right" vertical="center"/></xf>
  <xf fontId="2" fillId="0" borderId="0" applyFont="1"><alignment horizontal="right" vertical="center"/></xf>
  <xf fontId="3" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf fontId="0" fillId="11" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
  <xf fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
  <xf fontId="0" fillId="11" borderId="1" numFmtId="164" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="0" fillId="3" borderId="1" numFmtId="164" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="5" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="5" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="5" fillId="6" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="5" fillId="7" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="4" fillId="11" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="4" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf fontId="0" fillId="5" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf fontId="0" fillId="8" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf fontId="6" fillId="9" borderId="2" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  <xf fontId="6" fillId="9" borderId="2" numFmtId="164" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="0" fillId="11" borderId="1" numFmtId="164" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="0" fillId="3" borderId="1" numFmtId="164" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="2" fillId="10" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf fontId="7" fillId="10" borderId="1" numFmtId="164" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  <xf fontId="0" fillId="11" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ---------- sheet builder ----------
function cell(ref, v, s) {
  if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
  if (typeof v === 'number') return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  if (typeof v === 'object' && v.f) return `<c r="${ref}" s="${s}"><f>${xml(v.f)}</f></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}
function sheetXml({ cols, rows, merges = [], freezeRow = 0, filter = '', hyperlinks = [], drawing = false, tab = 'FF1E3A8A' }) {
  const colsXml = cols.length ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const pane = freezeRow ? `<pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><tabColor rgb="${tab}"/><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView rightToLeft="1" workbookViewId="0" zoomScale="100" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="20"/>
${colsXml}
<sheetData>${rows.map((r, i) => `<row r="${i + 1}"${r.h ? ` ht="${r.h}" customHeight="1"` : ''}>${r.cells.join('')}</row>`).join('')}</sheetData>
${filter ? `<autoFilter ref="${filter}"/>` : ''}
${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
${hyperlinks.length ? `<hyperlinks>${hyperlinks.map((h, i) => `<hyperlink ref="${h.ref}" r:id="rIdL${i + 1}"/>`).join('')}</hyperlinks>` : ''}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
${drawing ? '<drawing r:id="rIdD1"/>' : ''}
</worksheet>`;
}

// ---------- main ----------
const STATUS = { active: ['فعال', S.stActive], in_storage: ['در انبار', S.stStorage], repair: ['در تعمیر', S.stRepair], retired: ['اسقاط', S.stRetired] };
const HEALTH = {
  healthy: ['سالم', S.hOk], initial_ok: ['سالم در تست اولیه', S.hOk], minor_issue: ['ایراد جزئی', S.hWarn],
  untested: ['تست نشده', S.hWarn], needs_check: ['نیاز به بررسی', S.hWarn], broken: ['خراب', S.hBad]
};
const DISK = { ok: ['سالم', S.hOk], warning: ['هشدار', S.hWarn], critical: ['بحرانی', S.hBad] };

function buildAssetsXlsx({ assets, uploadsDir, categoryLabel = c => c, company = 'Arka', baseUrl = '', withPhotos = true }) {
  const now = new Date();
  const dateFa = now.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
  const files = [];
  const media = [];

  // ---- sheet 1: all assets ----
  const COLS = [
    ['عکس', 13], ['شماره اموال', 14], ['دسته', 16], ['سازنده / مدل', 30], ['وضعیت', 12], ['سلامت', 15],
    ['کاربر', 18], ['محل', 16], ['واحد', 14], ['پردازنده', 30], ['رم', 14], ['هاردها', 36], ['گرافیک', 24],
    ['سلامت دیسک', 12], ['سریال', 20], ['نام کامپیوتر', 18], ['IP', 15], ['سیستم‌عامل', 22], ['قیمت (تومان)', 16], ['توضیحات', 30]
  ];
  if (!withPhotos) COLS.shift();
  const off = withPhotos ? 1 : 0;
  const lastCol = colName(COLS.length - 1);
  const rows = [];
  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`];
  rows.push({ h: 34, cells: [cell('A1', `📦 فهرست دارایی‌های IT — ${company}`, S.title)] });
  rows.push({ h: 20, cells: [cell('A2', `تاریخ گزارش: ${dateFa} · تعداد: ${assets.length.toLocaleString('fa-IR')} مورد`, S.subtitle)] });
  rows.push({ h: 8, cells: [] });
  rows.push({ h: 30, cells: COLS.map((c, i) => cell(`${colName(i)}4`, c[0], S.header)) });
  const hyperlinks = [];
  const anchors = [];
  const first = 5;
  assets.forEach((a, idx) => {
    const r = first + idx;
    const alt = idx % 2 === 1;
    const T = alt ? S.textAlt : S.text, C = alt ? S.centerAlt : S.center;
    const st = STATUS[a.status] || [a.status || '', C];
    const he = HEALTH[a.health || 'healthy'] || [a.health, C];
    const dk = DISK[a.disk_health_status] || ['', C];
    const vals = [
      [a.property_id, alt ? S.linkAlt : S.link], [categoryLabel(a.category), C], [a.manufacturer_model, T],
      [st[0], st[1]], [he[0], he[1]], [a.user_name, T], [a.location, T], [a.department, T], [a.cpu, T], [a.ram, C],
      [String(a.storage_drives || '').split(' / ').join('\n'), T], [a.gpu, T], [dk[0], dk[1]], [a.serial_number, C],
      [a.computer_name, C], [a.ip_address, C], [a.os_version, T], [a.price ? Number(a.price) : '', alt ? S.priceAlt : S.price], [a.notes, T]
    ];
    const cells = [];
    if (withPhotos) cells.push(cell(`A${r}`, '', C));
    vals.forEach(([v, s], i) => cells.push(cell(`${colName(i + off)}${r}`, v, s)));
    let h = Math.max(22, Math.min(90, 16 * Math.max(1, String(a.storage_drives || '').split(' / ').length)));
    if (withPhotos && a.primary_photo) {
      // small thumbnail when one exists (keeps the file a few MB instead of tens)
      const thumb = path.join(uploadsDir, '_thumbs', path.parse(a.primary_photo).name + '.jpg');
      const useThumb = fs.existsSync(thumb);
      const fp = useThumb ? thumb : path.join(uploadsDir, path.basename(a.primary_photo));
      const ext = useThumb ? 'jpg' : path.extname(a.primary_photo).slice(1).toLowerCase().replace('jpeg', 'jpg');
      if (['jpg', 'png'].includes(ext) && fs.existsSync(fp)) {
        const buf = fs.readFileSync(fp);
        const n = media.length + 1;
        media.push({ name: `xl/media/image${n}.${ext}`, data: buf, ext });
        const sz = imageSize(buf, ext);
        const boxW = 88, boxH = 62; // px inside the photo cell
        const k = Math.min(boxW / sz.w, boxH / sz.h);
        anchors.push({ row: r - 1, n, w: Math.round(sz.w * k), h: Math.round(sz.h * k), boxW, boxH });
        h = Math.max(h, 52);
      }
    }
    rows.push({ h, cells });
    if (baseUrl) hyperlinks.push({ ref: `${colName(off)}${r}`, url: `${baseUrl}/asset.html?id=${a.id}` });
  });
  const last = first + assets.length - 1;
  const priceCol = colName(COLS.length - 2);
  const tr = last + 1;
  rows.push({ h: 28, cells: [
    cell(`A${tr}`, `جمع کل (${assets.length.toLocaleString('fa-IR')} مورد)`, S.totalLabel),
    ...COLS.slice(1).map((_, i) => {
      const ref = `${colName(i + 1)}${tr}`;
      return colName(i + 1) === priceCol ? cell(ref, { f: `SUBTOTAL(9,${priceCol}${first}:${priceCol}${last})` }, S.totalPrice) : cell(ref, '', S.totalLabel);
    })
  ] });
  merges.push(`A${tr}:${colName(COLS.length - 3)}${tr}`);

  const sheet1 = sheetXml({ cols: COLS.map(c => c[1]), rows, merges, freezeRow: 4, filter: `A4:${lastCol}${Math.max(last, 5)}`, hyperlinks, drawing: anchors.length > 0 });

  // ---- sheet 2: summary ----
  const sum = [];
  const by = (key) => { const m = new Map(); for (const a of assets) { const k = key(a) || '-'; const e = m.get(k) || { n: 0, v: 0 }; e.n++; e.v += Number(a.price) || 0; m.set(k, e); } return [...m].sort((x, y) => y[1].n - x[1].n); };
  const totalValue = assets.reduce((t, a) => t + (Number(a.price) || 0), 0);
  const count = s => assets.filter(a => a.status === s).length;
  sum.push({ h: 34, cells: [cell('A1', '📊 خلاصه دارایی‌ها', S.title)] });
  sum.push({ h: 20, cells: [cell('A2', `تاریخ گزارش: ${dateFa}`, S.subtitle)] });
  sum.push({ h: 10, cells: [] });
  const kpis = [['کل دارایی‌ها', assets.length], ['فعال', count('active')], ['در انبار', count('in_storage')], ['ارزش کل (تومان)', totalValue]];
  sum.push({ h: 24, cells: kpis.map((k, i) => cell(`${colName(i)}4`, k[0], S.kpiLabel)) });
  sum.push({ h: 40, cells: kpis.map((k, i) => cell(`${colName(i)}5`, k[1], S.kpiValue)) });
  sum.push({ h: 14, cells: [] });
  const table = (title, data, startRow) => {
    const out = [];
    out.push({ h: 28, cells: [cell(`A${startRow}`, title, S.header), cell(`B${startRow}`, 'تعداد', S.header), cell(`C${startRow}`, 'ارزش (تومان)', S.header), cell(`D${startRow}`, 'درصد', S.header)] });
    data.forEach(([k, e], i) => {
      const r = startRow + 1 + i, alt = i % 2 === 1;
      out.push({ h: 22, cells: [cell(`A${r}`, k, alt ? S.textAlt : S.text), cell(`B${r}`, e.n, alt ? S.numAlt : S.num), cell(`C${r}`, e.v || '', alt ? S.priceAlt : S.price), cell(`D${r}`, `${Math.round(e.n / Math.max(1, assets.length) * 100)}%`, alt ? S.centerAlt : S.center)] });
    });
    return out;
  };
  let r0 = 7;
  const t1 = table('دسته', by(a => categoryLabel(a.category)), r0); sum.push(...t1); r0 += t1.length;
  sum.push({ h: 14, cells: [] }); r0++;
  const t2 = table('وضعیت', by(a => (STATUS[a.status] || [a.status])[0]), r0); sum.push(...t2); r0 += t2.length;
  sum.push({ h: 14, cells: [] }); r0++;
  const t3 = table('مدل (۲۵ مورد پرتعداد)', by(a => a.manufacturer_model).slice(0, 25), r0); sum.push(...t3);
  const sheet2 = sheetXml({ cols: [34, 16, 22, 18], rows: sum, merges: ['A1:D1', 'A2:D2'], tab: 'FF16A34A' });

  // ---- package ----
  const sheets = [['دارایی‌ها', sheet1], ['خلاصه', sheet2]];
  files.push({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
${anchors.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>` });
  files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` });
  files.push({ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(company)} IT Assets</dc:title><dc:creator>Arka Asset Manager</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().slice(0, 19)}Z</dcterms:created>
</cp:coreProperties>` });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView rightToLeft="1"/></bookViews>
<sheets>${sheets.map((s, i) => `<sheet name="${xml(s[0])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheets[0][0]}'!$A$4:$${lastCol}$${Math.max(last, 5)}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'${sheets[0][0]}'!$4:$4</definedName></definedNames>
</workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` });
  files.push({ name: 'xl/styles.xml', data: STYLES });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s[1] }));
  const rels1 = [
    ...hyperlinks.map((h, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(h.url)}" TargetMode="External"/>`),
    ...(anchors.length ? ['<Relationship Id="rIdD1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'] : [])
  ];
  if (rels1.length) files.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels1.join('')}</Relationships>` });

  if (anchors.length) {
    const EMU = 9525;
    files.push({ name: 'xl/drawings/drawing1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors.map((p, i) => `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${Math.round((p.boxW - p.w) / 2 + 3) * EMU}</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>${Math.round((p.boxH - p.h) / 2 + 3) * EMU}</xdr:rowOff></xdr:from>
<xdr:ext cx="${p.w * EMU}" cy="${p.h * EMU}"/>
<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Photo ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip r:embed="rIdI${p.n}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${p.w * EMU}" cy="${p.h * EMU}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln></xdr:spPr></xdr:pic>
<xdr:clientData/></xdr:oneCellAnchor>`).join('\n')}
</xdr:wsDr>` });
    files.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${media.map((m, i) => `<Relationship Id="rIdI${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.${m.ext}"/>`).join('')}</Relationships>` });
    media.forEach(m => files.push({ name: m.name, data: m.data, store: true }));
  }
  return zip(files);
}

module.exports = { buildAssetsXlsx };
