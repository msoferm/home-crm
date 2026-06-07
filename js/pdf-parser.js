// ============================================================
//  PDF parser — column-aware extraction for Israeli bank statements
//
//  Strategy:
//    1. Detect the header line on each page.
//    2. Record each known column's X center + range.
//    3. For each data row, bucket text items by the X-midpoint between
//       columns. Empty cells stay empty.
//    4. If column detection fails on every page → fall back to a simple
//       "sort items by X" extraction so the user gets *something* useful.
// ============================================================

const PdfParser = (() => {

  const HEADER_DEFS = [
    { aliases: ['תאריך ערך','ת.ערך','ת. ערך','value date'],         key: 'chargeDate' },
    { aliases: ['תאריך','date'],                                     key: 'date' },
    { aliases: [
        'סוג תנועה','סוג פעולה',
        'תיאור הפעולה','תיאור פעולה','תיאור התנועה','תיאור','תאור',
        'פרטים','פרטי הפעולה','פרטי פעולה','פרטי תנועה',
        'שם בית עסק','שם בית העסק','שם עסק','שם הספק',
        'description','details','memo','merchant'
      ], key: 'description' },
    { aliases: [
        'זכות/חובה','חובה/זכות','זכות / חובה','חובה / זכות',
        'סכום זכות','סכום חובה','סכום עסקה','סכום החיוב','סכום',
        'amount'
      ], key: 'amount' },
    { aliases: [
        'יתרה בש"ח','יתרה בש״ח','יתרה לאחר עסקה','יתרה לאחר העסקה','יתרה',
        'balance','running balance'
      ], key: 'balance' },
    { aliases: ['אסמכתה','אסמכתא','מספר אסמכתא','reference','ref'], key: 'notes' },
  ];

  const Y_TOL = 3;
  const MIN_HEADER_MATCHES = 3;

  // ---- String normalization (strips bidi + NBSP + quote variants) ----
  const INVISIBLE_RX = /[​-‏‪-‮⁦-⁩؜﻿]/g;
  const norm = (s) => String(s ?? '')
    .replace(INVISIBLE_RX, '')
    .replace(/ /g, ' ')
    .replace(/[״׳′‘’`]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const stripSpaces = (s) => norm(s).replace(/\s+/g, '');

  // ---- Password prompt ----
  const promptPassword = (filename, isRetry = false) => new Promise((resolve) => {
    const body = U.el('div');
    body.appendChild(U.el('div', { style: { marginBottom: '8px' } },
      isRetry ? 'הסיסמה שגויה. נסה שוב.' : `הקובץ "${filename}" מוגן בסיסמה.`));
    body.appendChild(U.el('div', { class: 'muted', style: { marginBottom: '12px', fontSize: '12.5px' } },
      'בבנקים בישראל הסיסמה היא בדרך כלל ת״ז / מספר טלפון / 4 ספרות אחרונות.'));
    const inp = U.el('input', { type: 'password', class: 'input', placeholder: 'סיסמה', style: { width: '100%' } });
    body.appendChild(inp);
    setTimeout(() => inp.focus(), 50);
    const submit = U.el('button', { class: 'btn', onclick: () => { closeModal(); resolve(inp.value || null); } }, 'פתח');
    const cancel = U.el('button', { class: 'btn-soft', onclick: () => { closeModal(); resolve(null); } }, 'ביטול');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closeModal(); resolve(inp.value || null); } });
    let closeModal = UI.openModal({
      title: '🔒 קובץ PDF מוגן', body, footer: [cancel, submit], onClose: () => resolve(null),
    });
  });

  // ---- Extract text items from each page ----
  const extractItems = async (data, password) => {
    if (!window.pdfjsLib) throw new Error('PDF.js לא נטען. בדוק חיבור אינטרנט ורענן.');
    const pdf = await pdfjsLib.getDocument({ data, password }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items.map(it => ({
        str: String(it.str || '').trim(),
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || 0,
        height: it.height || 10,
      })).filter(it => it.str);
      pages.push(items);
    }
    return pages;
  };

  // ---- Group items into lines by Y coordinate ----
  const groupByY = (items, tol = Y_TOL) => {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => b.y - a.y);
    const lines = [];
    let curr = null;
    for (const it of sorted) {
      if (curr && Math.abs(it.y - curr.y) <= tol) {
        curr.items.push(it);
        curr.y = (curr.y * (curr.items.length - 1) + it.y) / curr.items.length;
      } else {
        if (curr) lines.push(curr);
        curr = { y: it.y, items: [it] };
      }
    }
    if (curr) lines.push(curr);
    return lines;
  };

  // ---- Header line detection ----
  const lineText = (line) =>
    [...line.items].sort((a, b) => b.x - a.x).map(it => it.str).join(' ');

  const findHeaderLineIdx = (lines) => {
    let bestIdx = -1, bestScore = 0;
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const text = norm(lineText(lines[i]));
      let score = 0;
      for (const def of HEADER_DEFS) {
        if (def.aliases.some(a => text.includes(norm(a)))) score++;
      }
      if (score >= MIN_HEADER_MATCHES && score > bestScore) {
        bestIdx = i; bestScore = score;
      }
    }
    return bestIdx;
  };

  // ---- Column detection: longest match wins, try 1..3 consecutive items ----
  const detectColumnsFromHeader = (headerLine) => {
    const items = [...headerLine.items].sort((a, b) => b.x - a.x);
    const columns = [];
    const consumed = new Set();

    for (let startIdx = 0; startIdx < items.length; startIdx++) {
      if (consumed.has(startIdx)) continue;
      let bestMatch = null;
      // Try longest first (3 items), down to 1
      for (let n = 3; n >= 1; n--) {
        if (startIdx + n > items.length) continue;
        if ([...Array(n).keys()].some(k => consumed.has(startIdx + k))) continue;
        const rangeItems = items.slice(startIdx, startIdx + n);
        const candidate = norm(rangeItems.map(it => it.str).join(' '));
        const candidateNoSpace = stripSpaces(candidate);
        for (const def of HEADER_DEFS) {
          if (columns.find(c => c.key === def.key)) continue;
          for (const alias of def.aliases) {
            const aliasN = norm(alias);
            const aliasNS = stripSpaces(aliasN);
            if (candidate === aliasN || candidateNoSpace === aliasNS) {
              bestMatch = { def, alias, n, rangeItems };
              break;
            }
          }
          if (bestMatch) break;
        }
        if (bestMatch) break;
      }
      if (bestMatch) {
        const { def, alias, n, rangeItems } = bestMatch;
        const xs = rangeItems.map(it => it.x);
        const widths = rangeItems.map(it => it.width || 30);
        const xMin = Math.min(...xs);
        const xMax = Math.max(...xs.map((x, idx) => x + widths[idx]));
        columns.push({
          key: def.key, label: alias,
          xMin, xMax, xCenter: (xMin + xMax) / 2,
        });
        for (let k = 0; k < n; k++) consumed.add(startIdx + k);
      }
    }
    // RTL sort: rightmost column first
    columns.sort((a, b) => b.xCenter - a.xCenter);
    return columns;
  };

  // ---- Assign data items to columns by closest X-bucket ----
  const ICON_RX = /^[▼▶▸▾◀◁△▲▽▿○●◆◇·•⋮…]+$/;
  const assignItemsToColumns = (items, columns) => {
    if (!columns.length) return [];
    const buckets = columns.map(() => []);
    const centers = columns.map(c => c.xCenter);
    // Boundaries between consecutive columns (centers are sorted descending)
    const bounds = [];
    for (let i = 0; i < centers.length - 1; i++) {
      bounds.push((centers[i] + centers[i + 1]) / 2);
    }
    for (const it of items) {
      if (!it.str) continue;
      if (ICON_RX.test(it.str)) continue;
      const itemCenter = it.x + (it.width || 30) / 2;
      let bucketIdx = columns.length - 1;
      for (let i = 0; i < bounds.length; i++) {
        if (itemCenter >= bounds[i]) { bucketIdx = i; break; }
      }
      buckets[bucketIdx].push(it);
    }
    return buckets.map(list =>
      list.sort((a, b) => b.x - a.x).map(it => it.str).join(' ').trim()
    );
  };

  // ---- Filters for lines we want to skip ----
  const SKIP_PATTERNS = [
    /^תנועות אחרונות$/, /^תנועות שעדיין/, /^תנועות עתידיות$/,
    /^יתרה ותנועות/, /^עובר ושב/, /^חשבון מספר/,
    /^הדפסה בוצעה/, /^\(י\)-פעולה/, /^\(פ\)-פעולה/,
    /^עמוד \d+/, /^page \d+/i,
    /^יתרה משוערכת/, /^סך הכל/, /^סך זכות/, /^סך חובה/,
  ];

  // ---- Simple fallback: sort items by X within each line ----
  const simpleExtract = (pages) => {
    const rows = [];
    for (const items of pages) {
      const lines = groupByY(items);
      for (const line of lines) {
        const cells = [];
        const sorted = [...line.items].sort((a, b) => b.x - a.x);
        let cur = null;
        for (const it of sorted) {
          if (ICON_RX.test(it.str)) continue;
          if (cur && cur.lastX != null && Math.abs(cur.lastX - it.x) < 10) {
            cur.str += ' ' + it.str;
            cur.lastX = it.x;
          } else {
            if (cur) cells.push(cur.str.trim());
            cur = { str: it.str, lastX: it.x };
          }
        }
        if (cur) cells.push(cur.str.trim());
        if (cells.length && cells.some(c => c)) rows.push(cells);
      }
    }
    return rows;
  };

  // ---- Main ----
  const parsePdfFile = async (file) => {
    const buf = await file.arrayBuffer();
    const data = new Uint8Array(buf);

    let pages;
    try {
      pages = await extractItems(data);
    } catch (err) {
      if (err?.name === 'PasswordException' || /password/i.test(err?.message || '')) {
        let pw = await promptPassword(file.name, false);
        while (pw) {
          try { pages = await extractItems(data, pw); break; }
          catch (e2) {
            if (e2?.name === 'PasswordException' || /password/i.test(e2?.message || '')) {
              pw = await promptPassword(file.name, true);
            } else throw e2;
          }
        }
        if (!pages) throw new Error('הקובץ לא נפתח — סיסמה שגויה או בוטל.');
      } else {
        throw new Error('PDF נכשל בקריאה: ' + (err?.message || err));
      }
    }

    if (!pages || !pages.length) throw new Error('PDF ריק (אין עמודים).');

    // Try column-aware extraction first
    const allRows = [];
    let firstColumnsLabels = null;
    let pagesWithHeader = 0;

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const items = pages[pageIdx];
      if (!items.length) continue;
      const lines = groupByY(items);
      const headerIdx = findHeaderLineIdx(lines);
      if (headerIdx < 0) {
        console.log(`[PdfParser] page ${pageIdx + 1}: no header detected`);
        continue;
      }
      const headerLine = lines[headerIdx];
      const columns = detectColumnsFromHeader(headerLine);
      console.log(`[PdfParser] page ${pageIdx + 1}: header at line ${headerIdx + 1}, columns:`,
        columns.map(c => `${c.key}@${Math.round(c.xCenter)}`));
      if (columns.length < 3) continue;
      pagesWithHeader++;

      if (!firstColumnsLabels) {
        firstColumnsLabels = columns.map(c => c.label);
        allRows.push(firstColumnsLabels);
      }

      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        const rawText = lineText(line).trim();
        const text = norm(rawText);
        if (!text) continue;
        if (SKIP_PATTERNS.some(rx => rx.test(rawText))) continue;
        // skip lines that look like a repeated header
        let headerHits = 0;
        for (const def of HEADER_DEFS) {
          if (def.aliases.some(a => text.includes(norm(a)))) headerHits++;
        }
        if (headerHits >= 3) continue;

        const cells = assignItemsToColumns(line.items, columns);
        if (cells.every(c => !c)) continue;
        allRows.push(cells);
      }
    }

    // If column-aware extraction succeeded, return it
    if (pagesWithHeader > 0 && allRows.length > 1) {
      return { sheets: [{ name: 'PDF', rows: allRows }] };
    }

    // FALLBACK: simple X-sort extraction (lossier but always returns something)
    console.warn('[PdfParser] Column-aware extraction failed, falling back to simple extraction.');
    const simpleRows = simpleExtract(pages);
    return { sheets: [{ name: 'PDF (fallback)', rows: simpleRows }] };
  };

  return { parsePdfFile, promptPassword };
})();
