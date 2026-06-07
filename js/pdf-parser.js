// ============================================================
//  PDF parser — column-aware extraction for Israeli bank statements
//
//  The previous version just sorted text items by X within each Y-line, which
//  loses column structure when some rows have empty cells (e.g. no value-date,
//  no balance). The new version:
//    1. Detects the header line on each page.
//    2. Records the X position of each known column header.
//    3. For each data row, buckets text items by *closest column X* — so
//       missing cells stay empty instead of squashing later cells leftward.
//
//  Supports password-protected PDFs.
// ============================================================

const PdfParser = (() => {

  // Header aliases — ORDER MATTERS for the matcher. More-specific first.
  const HEADER_DEFS = [
    { aliases: ['תאריך ערך','ת.ערך','ת. ערך'],                     key: 'chargeDate' },
    { aliases: ['תאריך'],                                           key: 'date' },
    { aliases: ['סוג תנועה','תיאור הפעולה','תיאור פעולה','תיאור','פרטים','פרטי הפעולה','שם בית עסק','שם בית העסק'], key: 'description' },
    { aliases: ['זכות/חובה','חובה/זכות','זכות / חובה','חובה / זכות','סכום זכות','סכום חובה','סכום עסקה','סכום החיוב','סכום'], key: 'amount' },
    { aliases: ['יתרה בש"ח','יתרה בש״ח','יתרה לאחר עסקה','יתרה'],   key: 'balance' },
    { aliases: ['אסמכתה','אסמכתא','מספר אסמכתא'],                  key: 'notes' },
  ];

  const Y_TOL = 3;            // Same-line tolerance (PDF points)
  const MIN_HEADER_MATCHES = 3; // Need at least this many known headers on a line

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

  // Group items into lines by Y coordinate (within tolerance).
  const groupByY = (items, tol = Y_TOL) => {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => b.y - a.y); // top-to-bottom (PDF Y is bottom-up)
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

  // Concatenate a line's text in RTL reading order (rightmost first).
  const lineText = (line) =>
    [...line.items].sort((a, b) => b.x - a.x).map(it => it.str).join(' ');

  // Find the header line on a page (returns the line index, or -1).
  const findHeaderLineIdx = (lines) => {
    let bestIdx = -1, bestScore = 0;
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const text = lineText(lines[i]);
      let score = 0;
      for (const def of HEADER_DEFS) {
        if (def.aliases.some(a => text.includes(a))) score++;
      }
      if (score >= MIN_HEADER_MATCHES && score > bestScore) {
        bestIdx = i; bestScore = score;
      }
    }
    return bestIdx;
  };

  // From a header line, identify each column's X center and X range.
  // Multi-word headers like "תאריך ערך" may be split across PDF items, so
  // we try to merge consecutive items that together form a known header.
  const detectColumnsFromHeader = (headerLine) => {
    // Sort items right-to-left (RTL Hebrew)
    const items = [...headerLine.items].sort((a, b) => b.x - a.x);
    const columns = [];
    const used = new Set();
    let i = 0;
    while (i < items.length) {
      if (used.has(i)) { i++; continue; }
      let matched = false;
      // Try all known aliases, longest first
      for (const def of HEADER_DEFS) {
        for (const alias of def.aliases) {
          const words = alias.split(/\s+/);
          // Try matching `words.length` consecutive items starting at i
          const candidateItems = items.slice(i, i + words.length);
          if (candidateItems.length < words.length) continue;
          const candidate = candidateItems.map(it => it.str).join(' ').trim();
          // Also try matching without spaces (some PDFs split chars weirdly)
          if (candidate === alias || candidate.replace(/\s+/g, '') === alias.replace(/\s+/g, '')) {
            // Check we haven't already mapped this key
            if (columns.find(c => c.key === def.key)) continue;
            const xs = candidateItems.map(it => it.x);
            const widths = candidateItems.map(it => it.width || 30);
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs.map((x, idx) => x + widths[idx]));
            columns.push({
              key: def.key,
              label: alias,
              xMin, xMax,
              xCenter: (xMin + xMax) / 2,
            });
            for (let k = 0; k < words.length; k++) used.add(i + k);
            i += words.length;
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (!matched) i++;
    }
    // Sort columns by X (rightmost first, RTL order)
    columns.sort((a, b) => b.xCenter - a.xCenter);
    return columns;
  };

  // Assign each item in a data line to the closest column by X center.
  // Empty columns stay empty. Returns an array of cell strings in column order.
  const assignItemsToColumns = (items, columns, headerY) => {
    if (!columns.length) return [];
    const buckets = columns.map(() => []);
    // Bracket X-boundaries between columns at the midpoints of column centers.
    // This is more reliable than nearest-center when columns are uneven.
    const centers = columns.map(c => c.xCenter);
    const bounds = [];
    for (let i = 0; i < centers.length - 1; i++) {
      bounds.push((centers[i] + centers[i + 1]) / 2);
    }
    for (const it of items) {
      if (!it.str || it.str.length === 0) continue;
      // Skip arrow / icon glyphs the bank UI prints
      if (/^[▼▶▸▾◀◁△▲▽▿○●◆◇]+$/.test(it.str)) continue;
      const itemCenter = it.x + (it.width || 30) / 2;
      // Walk centers (sorted RTL = descending) and find which bucket itemCenter falls into
      let bucketIdx = columns.length - 1; // default to leftmost
      for (let i = 0; i < bounds.length; i++) {
        if (itemCenter >= bounds[i]) { bucketIdx = i; break; }
      }
      buckets[bucketIdx].push(it);
    }
    // Render each bucket: sort RTL, join with space
    return buckets.map(list =>
      list.sort((a, b) => b.x - a.x).map(it => it.str).join(' ').trim()
    );
  };

  // Lines we always want to skip from data parsing.
  const SKIP_PATTERNS = [
    /^תנועות אחרונות$/, /^תנועות שעדיין/, /^תנועות עתידיות$/,
    /^יתרה ותנועות/, /^עובר ושב/, /^חשבון מספר/,
    /^הדפסה בוצעה/, /^\(י\)-פעולה/, /^סופר משה/,
    /^עמוד \d+/, /^page \d+/i,
  ];

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
      } else throw err;
    }

    const allRows = [];
    let firstColumnsLabels = null;

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const items = pages[pageIdx];
      if (!items.length) continue;
      const lines = groupByY(items);
      const headerIdx = findHeaderLineIdx(lines);

      if (headerIdx < 0) {
        // Page has no header (or unrelated layout). Skip — data on this page
        // would be ambiguous without column anchors.
        continue;
      }

      const headerLine = lines[headerIdx];
      const columns = detectColumnsFromHeader(headerLine);
      if (columns.length < 3) continue;

      // First page only: emit the header row so the downstream header detector
      // (in parsers.js) can re-identify the columns by name.
      if (!firstColumnsLabels) {
        firstColumnsLabels = columns.map(c => c.label);
        allRows.push(firstColumnsLabels);
      }

      // Data lines = lines BELOW the header (lower Y, since groupByY went top→bottom).
      // We already iterate in top→bottom order.
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        const text = lineText(line).trim();
        if (!text) continue;
        if (SKIP_PATTERNS.some(rx => rx.test(text))) continue;
        // Skip lines that look like a repeated header (same content as the header)
        if (HEADER_DEFS.some(d => d.aliases.some(a => text === a || text.startsWith(a + ' ')))
            && /תאריך/.test(text) && /יתרה|זכות|חובה/.test(text)) continue;

        const cells = assignItemsToColumns(line.items, columns, headerLine.y);
        if (cells.every(c => !c)) continue;
        allRows.push(cells);
      }
    }

    // Wrap in the { sheets: [...] } shape parsers.js expects
    return { sheets: [{ name: 'PDF', rows: allRows }] };
  };

  return { parsePdfFile, promptPassword };
})();
