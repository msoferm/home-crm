// ============================================================
//  Utilities
// ============================================================
const U = (() => {
  const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  const HE_MONTHS_SHORT = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];

  const fmtILS = (n, withSign = false) => {
    if (n == null || isNaN(n)) return '₪0';
    const v = Math.round(n);
    const s = new Intl.NumberFormat('he-IL').format(Math.abs(v));
    const prefix = withSign ? (v >= 0 ? '+' : '−') : (v < 0 ? '−' : '');
    return `${prefix}₪${s}`;
  };

  const fmtNumber = (n) => new Intl.NumberFormat('he-IL').format(n);

  const fmtDate = (d) => {
    if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const fmtMonth = (d) => {
    if (!(d instanceof Date)) d = new Date(d);
    return `${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  };

  const fmtMonthShort = (d) => {
    if (!(d instanceof Date)) d = new Date(d);
    return `${HE_MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  };

  const ymKey = (d) => {
    if (!(d instanceof Date)) d = new Date(d);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const monthRange = (d) => {
    if (!(d instanceof Date)) d = new Date(d);
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  };

  const addMonths = (d, m) => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + m);
    return x;
  };

  // Parse various date formats (Israeli + ISO + Excel)
  const parseDateFlex = (val) => {
    if (val == null || val === '') return null;
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
      // Excel serial date
      const utc_days = Math.floor(val - 25569);
      const utc_value = utc_days * 86400;
      const d = new Date(utc_value * 1000);
      // Account for hours fraction
      const frac = val - Math.floor(val);
      if (frac) d.setMilliseconds(d.getMilliseconds() + Math.round(frac * 86400000));
      return isNaN(d) ? null : d;
    }
    const s = String(val).trim();
    if (!s) return null;
    // DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
    let m = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
    if (m) {
      let [, dd, mm, yy] = m;
      yy = +yy; if (yy < 100) yy += yy < 50 ? 2000 : 1900;
      const d = new Date(+yy, +mm - 1, +dd);
      return isNaN(d) ? null : d;
    }
    // YYYY-MM-DD
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      return isNaN(d) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };

  // Parse number with various locales (handles 1,234.56 and 1.234,56 and ₪1,234)
  const parseNum = (val) => {
    if (val == null || val === '') return null;
    if (typeof val === 'number') return val;
    let s = String(val).trim();
    if (!s) return null;
    // Strip ILS / currency symbols, RTL marks, spaces
    s = s.replace(/[₪$€‎‏‪-‮]/g, '').replace(/\s/g, '').trim();
    if (!s) return null;
    const isNegative = s.startsWith('-') || s.startsWith('−') || /\(.*\)/.test(s);
    s = s.replace(/^[\-−]/, '').replace(/[()]/g, '');
    // If both comma and dot exist, the one occurring later is the decimal mark
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) s = s.replace(/,/g, '');
      else s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      // Single comma: treat as decimal if 1-2 digits after, else thousands sep
      const parts = s.split(',');
      if (parts[1] && parts[1].length <= 2) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return isNegative ? -n : n;
  };

  const uid = () => 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const debounce = (fn, ms = 200) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  const el = (tag, attrs = {}, children = []) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'style') Object.assign(e.style, attrs[k]);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      if (typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(c));
      else e.appendChild(c);
    });
    return e;
  };

  const clearChildren = (e) => { while (e.firstChild) e.removeChild(e.firstChild); };

  const sum = (arr, fn = x => x) => arr.reduce((a, b) => a + (fn(b) || 0), 0);
  const groupBy = (arr, fn) => arr.reduce((acc, v) => {
    const k = fn(v); (acc[k] = acc[k] || []).push(v); return acc;
  }, {});

  const downloadFile = (filename, content, mime = 'application/octet-stream') => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  };

  return {
    HE_MONTHS, HE_MONTHS_SHORT,
    fmtILS, fmtNumber, fmtDate, fmtMonth, fmtMonthShort,
    ymKey, monthRange, addMonths,
    parseDateFlex, parseNum,
    uid, debounce, el, clearChildren, sum, groupBy,
    downloadFile,
  };
})();
