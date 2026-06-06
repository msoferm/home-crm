// ============================================================
//  File parsers — credit card statements & bank statements
//  Smart column auto-detection for Israeli formats
// ============================================================

const Parsers = (() => {

  // ---- Header keyword maps (Hebrew + English) ----
  // NOTE: Order matters. More specific keys (chargeDate) come before generic (date)
  // so that a column "תאריך חיוב" maps to chargeDate, not to date.
  const HEADER_MAP = {
    chargeDate: [
      'תאריך חיוב','מועד חיוב','חיוב בתאריך','עסקה תחויב ב','תאריך חיוב הכרטיס','תאריך לחיוב'
    ],
    date: [
      'תאריך עסקה','תאריך רכישה','תאריך','תאריך ערך','תאריך פעולה','תאריך הפעולה',
      'מועד','מועד עסקה','עסקה בתאריך','date','transaction date','posting date','value date'
    ],
    description: [
      'שם בית עסק','שם בית העסק','בית עסק','בית העסק','שם עסק',
      'תיאור הפעולה','תיאור פעולה','תיאור התנועה','תיאור התנועה','תיאור','תאור',
      'פרטים','פרטי הפעולה','פרטי פעולה','פרטי תנועה','פירוט','פירוט פעולה',
      'שם הספק','שם הפעולה','מהות הפעולה','מהות',
      'description','details','narration','memo','merchant','transaction','desc'
    ],
    amount: [
      'סכום עסקה','סכום בש"ח','סכום ש"ח','סכום','סכום החיוב','סכום בשקלים',
      'סכום החיוב בש"ח','סכום פעולה','סכום הפעולה','סכום בש״ח','סכום תנועה',
      'amount','חיוב','חיוב בש"ח','total'
    ],
    debit: [
      'חובה','סכום חובה','בחובה','חובה בש"ח','סכום בחובה','משיכה','משיכות',
      'debit','withdrawal','dr'
    ],
    credit: [
      'זכות','סכום זכות','בזכות','זכות בש"ח','סכום בזכות','הפקדה','הפקדות',
      'credit','deposit','cr'
    ],
    balance: [
      'יתרה','יתרה בש"ח','יתרה לאחר עסקה','יתרה לאחר העסקה','יתרת עו"ש',
      'יתרה משוערכת','יתרה ערך','יתרה משוערכת בש"ח',
      'balance','running balance'
    ],
    totalAmount: [
      'סכום עסקה מקורי','סך עסקה','סכום עסקה כולל','סכום מקורי','סכום עסקה בש"ח'
    ],
    installNum: [
      'מספר תשלום','תשלום','מס\' תשלום','תשלום מס\'','installment'
    ],
    installTotal: [
      'מספר תשלומים','סך תשלומים','כמות תשלומים','total installments'
    ],
    notes: [
      'הערות','הערה','notes','note','אסמכתא','מספר אסמכתא','אסמכתא/מס\' שיק',
      'סוג תנועה','סוג','אסמכתא 1','אסמכתא 2','reference'
    ],
  };

  // Strip ALL invisible / formatting characters that Israeli bank exports
  // often inject into header cells. Using \u escapes — encoding-proof.
  //   ​-‏: ZWSP, ZWNJ, ZWJ, LRM, RLM
  //   ‪-‮: LRE, RLE, PDF, LRO, RLO
  //   ⁦-⁩: LRI, RLI, FSI, PDI
  //    : NBSP  |  ﻿: BOM/ZWNBSP  |  ؜: ALM
  const INVISIBLE_RX = /[​-‏‪-‮⁦-⁩؜﻿]/g;
  const NBSP_RX = / /g;
  const stripInvisible = (s) => String(s).replace(INVISIBLE_RX, '').replace(NBSP_RX, ' ');

  const norm = (s) => stripInvisible(String(s || ''))
    .replace(/[״׳′‘’`]/g, '"') // Hebrew/curly quotes → "
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // Match a header cell to one of our known column types
  const matchHeader = (cell) => {
    const c = norm(cell);
    if (!c) return null;
    for (const key in HEADER_MAP) {
      for (const variant of HEADER_MAP[key]) {
        if (c === norm(variant)) return { key, exact: true };
      }
    }
    for (const key in HEADER_MAP) {
      for (const variant of HEADER_MAP[key]) {
        if (c.includes(norm(variant))) return { key, exact: false };
      }
    }
    return null;
  };

  // Find the header row by scanning the first 40 rows.
  const findHeaderRow = (rows) => {
    let best = { idx: -1, score: 0, map: null };
    const limit = Math.min(40, rows.length);
    for (let i = 0; i < limit; i++) {
      const row = rows[i] || [];
      const map = {};
      let score = 0;
      row.forEach((cell, colIdx) => {
        const m = matchHeader(cell);
        if (m && !(m.key in map)) {
          map[m.key] = colIdx;
          score += m.exact ? 2 : 1;
        }
      });
      const hasDate = 'date' in map || 'chargeDate' in map;
      const hasAmt = 'amount' in map || 'debit' in map || 'credit' in map;
      const hasDesc = 'description' in map;
      if ((hasDate || hasDesc) && hasAmt && score > best.score) {
        best = { idx: i, score, map };
      }
    }
    return best.idx >= 0 ? best : null;
  };

  // FALLBACK: if `description` wasn't detected, look at the un-mapped columns.
  // For each unmapped column index, sample data rows and decide which one looks
  // most like a description (mostly text, longer cells). Returns the col index.
  const guessDescriptionColumn = (rows, headerIdx, map) => {
    const usedCols = new Set(Object.values(map));
    const headerRow = rows[headerIdx] || [];
    const sample = rows.slice(headerIdx + 1, headerIdx + 1 + 25);
    let best = null;
    for (let col = 0; col < headerRow.length; col++) {
      if (usedCols.has(col)) continue;
      let textScore = 0, totalCells = 0, totalLen = 0;
      for (const r of sample) {
        const v = r ? r[col] : null;
        if (v == null || String(v).trim() === '') continue;
        totalCells++;
        const s = String(v).trim();
        totalLen += s.length;
        // text = not a pure number and not a pure date
        const isNum = U.parseNum(s) != null && /^[\s\-+0-9.,()₪]+$/.test(s);
        const isDate = !!U.parseDateFlex(s) && s.length <= 12;
        if (!isNum && !isDate) textScore++;
      }
      if (totalCells < 3) continue;
      const textRatio = textScore / totalCells;
      const avgLen = totalLen / totalCells;
      if (textRatio < 0.6) continue;
      const score = textRatio * Math.min(avgLen, 60);
      if (!best || score > best.score) best = { col, score };
    }
    return best ? best.col : -1;
  };

  // Pick the sheet most likely to contain the transactions table.
  const pickBestSheet = (sheets) => {
    let best = null;
    for (const sheet of sheets) {
      const h = findHeaderRow(sheet.rows);
      if (h && (!best || h.score > best.header.score)) {
        best = { sheet, header: h };
      }
    }
    return best;
  };

  // Build a diagnostic string listing the actual header-row cells AND first few rows.
  const buildDiagnostic = (sheets, header) => {
    const lines = [];
    if (header) {
      const sheet = sheets.find(s => true); // first; we'll pass the actual one below
      lines.push(`שורת כותרת זוהתה בשורה ${header.idx + 1}`);
      lines.push(`עמודות שזוהו: ${Object.keys(header.map).join(', ') || '(אין)'}`);
    }
    sheets.forEach(sheet => {
      const rows = sheet.rows || [];
      lines.push('');
      lines.push(`-- גיליון "${sheet.name}" — שורות 1-8 (גולמיות) --`);
      rows.slice(0, 8).forEach((row, i) => {
        const cells = (row || []).map(c => {
          const s = stripInvisible(String(c ?? '')).slice(0, 30);
          return s || '∅';
        }).slice(0, 12);
        lines.push(`${i + 1}: ` + cells.join(' | '));
      });
    });
    return lines.join('\n');
  };

  // ---- Read a workbook from File ----
  const readFile = async (file) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      if (!window.PdfParser) throw new Error('מודול PDF לא נטען. רענן את הדף.');
      return PdfParser.parsePdfFile(file);
    }
    if (name.endsWith('.csv')) {
      const text = await file.text();
      return new Promise((resolve, reject) => {
        Papa.parse(text, {
          complete: (results) => resolve({ sheets: [{ name: 'CSV', rows: results.data }] }),
          error: reject,
        });
      });
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
    const sheets = wb.SheetNames.map(n => ({
      name: n,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: false }),
    }));
    return { sheets };
  };

  // ---- Parse credit-card statement ----
  const parseCreditCard = async (file, opts = {}) => {
    const { accountId = null } = opts;
    const { sheets } = await readFile(file);
    const results = [];

    const best = pickBestSheet(sheets);
    if (!best) {
      return {
        error: 'לא הצלחתי לזהות מבנה כרטיס אשראי. ודא שהקובץ כולל עמודות תאריך/תיאור/סכום.',
        diagnostic: buildDiagnostic(sheets, null),
        rows: [],
      };
    }
    const usedSheet = best.sheet;
    const header = best.header;
    let { idx: headerIdx, map } = header;

    // FALLBACK: if description column not found, infer it
    if (!('description' in map)) {
      const guess = guessDescriptionColumn(usedSheet.rows, headerIdx, map);
      if (guess >= 0) {
        map = { ...map, description: guess };
        console.log('[parseCard] description fallback guessed col', guess);
      }
    }

    const dataRows = usedSheet.rows.slice(headerIdx + 1);
    const get = (row, key) => (key in map) ? row[map[key]] : null;

    const reject = { empty: 0, noDate: 0, noDesc: 0, noAmt: 0, summary: 0 };

    for (const row of dataRows) {
      if (!row || row.every(c => c == null || String(c).trim() === '')) { reject.empty++; continue; }
      const desc = String(get(row, 'description') || '').trim();
      let date = U.parseDateFlex(get(row, 'date') || get(row, 'chargeDate'));
      const chargeDate = U.parseDateFlex(get(row, 'chargeDate'));
      let amt = U.parseNum(get(row, 'amount'));
      if (amt == null) {
        const d = U.parseNum(get(row, 'debit'));
        const c = U.parseNum(get(row, 'credit'));
        if (d != null) amt = -Math.abs(d);
        else if (c != null) amt = Math.abs(c);
      } else {
        amt = -Math.abs(amt);
      }
      if (!date) { reject.noDate++; continue; }
      if (amt == null) { reject.noAmt++; continue; }
      if (!desc) { reject.noDesc++; continue; }
      if (/^(סה"כ|סך הכל|total|סיכום)/i.test(desc)) { reject.summary++; continue; }

      const installNum = U.parseNum(get(row, 'installNum'));
      const installTotal = U.parseNum(get(row, 'installTotal'));
      const totalAmount = U.parseNum(get(row, 'totalAmount'));
      const isInstallment = installTotal && installTotal > 1;
      const notes = String(get(row, 'notes') || '').trim() ||
                    (isInstallment ? `תשלום ${installNum || 1} מתוך ${installTotal}` : '');

      results.push({
        date, chargeDate: chargeDate || null,
        description: desc, amount: amt, type: 'expense',
        accountId, source: 'card-statement', sourceFile: file.name, notes,
        installment: isInstallment
          ? { current: installNum || 1, total: installTotal, totalAmount: totalAmount ? Math.abs(totalAmount) : null }
          : null,
      });
    }

    if (!results.length) {
      const parts = [];
      if (reject.noDate) parts.push(`${reject.noDate} ללא תאריך`);
      if (reject.noAmt) parts.push(`${reject.noAmt} ללא סכום`);
      if (reject.noDesc) parts.push(`${reject.noDesc} ללא תיאור`);
      return {
        error: 'זוהה מבנה אך לא נמצאו תנועות תקינות. ' + (parts.join(' • ') || 'בדוק את תוכן הקובץ.'),
        diagnostic: buildDiagnostic([usedSheet], { idx: headerIdx, map }),
        rows: [],
      };
    }

    return { rows: results, headerMap: map, sheet: usedSheet.name };
  };

  // ---- Parse bank statement (עו"ש) ----
  const parseBank = async (file, opts = {}) => {
    const { accountId = null } = opts;
    const { sheets } = await readFile(file);
    const results = [];

    const best = pickBestSheet(sheets);
    if (!best) {
      return {
        error: 'לא הצלחתי לזהות מבנה עו"ש. ודא שהקובץ כולל תאריך/פרטים/חובה/זכות או סכום.',
        diagnostic: buildDiagnostic(sheets, null),
        rows: [],
      };
    }
    const usedSheet = best.sheet;
    const header = best.header;
    let { idx: headerIdx, map } = header;

    // FALLBACK: if description column not detected, infer it from unmapped columns
    if (!('description' in map)) {
      const guess = guessDescriptionColumn(usedSheet.rows, headerIdx, map);
      if (guess >= 0) {
        map = { ...map, description: guess };
        console.log('[parseBank] description fallback guessed col', guess);
      }
    }

    const dataRows = usedSheet.rows.slice(headerIdx + 1);
    console.log('[parseBank] Sheet:', usedSheet.name, '| Header row:', headerIdx + 1, '| Columns:', map);
    const get = (row, key) => (key in map) ? row[map[key]] : null;

    let lastBalance = null;
    const reject = { empty: 0, noDate: 0, noDesc: 0, noAmt: 0, summary: 0 };

    for (const row of dataRows) {
      if (!row || row.every(c => c == null || String(c).trim() === '')) { reject.empty++; continue; }
      const desc = String(get(row, 'description') || '').trim();
      const date = U.parseDateFlex(get(row, 'date'));
      let amt = null;
      const debit = U.parseNum(get(row, 'debit'));
      const credit = U.parseNum(get(row, 'credit'));
      if (debit != null && debit !== 0) amt = -Math.abs(debit);
      else if (credit != null && credit !== 0) amt = Math.abs(credit);
      else amt = U.parseNum(get(row, 'amount'));

      if (!date) { reject.noDate++; continue; }
      if (amt == null || amt === 0) { reject.noAmt++; continue; }
      if (!desc) { reject.noDesc++; continue; }
      if (/^(סה"כ|יתרת|סך הכל|total|סיכום|יתרה לתחילת|יתרה לסוף)/i.test(desc)) { reject.summary++; continue; }

      const bal = U.parseNum(get(row, 'balance'));
      if (bal != null) lastBalance = { value: bal, date };

      results.push({
        date, description: desc, amount: amt,
        type: amt < 0 ? 'expense' : 'income',
        accountId, source: 'bank-statement', sourceFile: file.name,
        notes: '', balanceAfter: bal,
      });
    }

    if (!results.length) {
      console.warn('[parseBank] 0 rows accepted. Rejections:', reject, '| map:', map);
      const parts = [];
      if (reject.noDate) parts.push(`${reject.noDate} ללא תאריך`);
      if (reject.noAmt) parts.push(`${reject.noAmt} ללא סכום`);
      if (reject.noDesc) parts.push(`${reject.noDesc} ללא תיאור`);
      if (reject.summary) parts.push(`${reject.summary} שורות סיכום`);
      return {
        error: 'זוהה מבנה אך לא נמצאו שורות תנועה תקינות. ' + (parts.join(' • ') || 'בדוק תוכן.'),
        diagnostic: buildDiagnostic([usedSheet], { idx: headerIdx, map }),
        rows: [],
      };
    }
    return { rows: results, headerMap: map, sheet: usedSheet.name, lastBalance };
  };

  // ---- Generic auto-detect ----
  const parseAuto = async (file, opts = {}) => {
    const { sheets } = await readFile(file);
    let hasBalance = false;
    for (const s of sheets) {
      const h = findHeaderRow(s.rows);
      if (h && 'balance' in h.map) { hasBalance = true; break; }
    }
    if (hasBalance) return { kind: 'bank', ...(await parseBank(file, opts)) };
    return { kind: 'card', ...(await parseCreditCard(file, opts)) };
  };

  // Apply auto-categorization + fixed/variable classification to parsed rows.
  const enrichWithCategories = async (rows) => {
    const cats = await DB.catAll();
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    for (const r of rows) {
      const categoryId = await Categorizer.categorize(r.description);
      r.categoryId = categoryId;
      r.categoryName = catById[categoryId]?.name || 'כללי';
      r.categoryColor = catById[categoryId]?.color || '#6b7280';
      r.fixedOrVariable = await Categorizer.detectFixedOrVariable(r, catById[categoryId]?.name);
    }
    return rows;
  };

  return { parseCreditCard, parseBank, parseAuto, enrichWithCategories };
})();
