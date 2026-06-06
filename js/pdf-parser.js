// ============================================================
//  PDF parser — extracts a 2D table-like structure from a PDF
//  by grouping text items by Y (rows) and X (columns).
//  Supports password-protected PDFs (Israeli bank exports).
// ============================================================

const PdfParser = (() => {

  const isPdf = (file) => {
    const n = (file?.name || '').toLowerCase();
    if (n.endsWith('.pdf')) return true;
    // Sniff magic bytes when name is ambiguous
    return false;
  };

  // Prompt the user for a password. Returns a Promise<string|null>.
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
      title: '🔒 קובץ PDF מוגן',
      body, footer: [cancel, submit],
      onClose: () => resolve(null),
    });
  });

  // Extract text items from each page, returning { pages: [[{ str, x, y, width, height }]] }
  const extractItems = async (data, password) => {
    if (!window.pdfjsLib) throw new Error('PDF.js לא נטען. בדוק חיבור אינטרנט ורענן.');
    const loadingTask = pdfjsLib.getDocument({ data, password });
    const pdf = await loadingTask.promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items.map(it => {
        // it.transform = [a, b, c, d, e, f] — e = x, f = y
        const x = it.transform[4];
        const y = it.transform[5];
        return { str: it.str, x, y, width: it.width || 0, height: it.height || 10 };
      }).filter(it => it.str && it.str.trim());
      pages.push(items);
    }
    return pages;
  };

  // Group items into rows by Y coordinate (within tolerance), then sort each row by X (right-to-left for Hebrew).
  // Returns array of rows where each row is an array of cell strings.
  const itemsToRows = (items, yTolerance = 3) => {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => b.y - a.y); // top-to-bottom
    const rows = [];
    let currentRow = [];
    let currentY = sorted[0].y;
    for (const it of sorted) {
      if (Math.abs(it.y - currentY) <= yTolerance) {
        currentRow.push(it);
      } else {
        rows.push(currentRow);
        currentRow = [it];
        currentY = it.y;
      }
    }
    if (currentRow.length) rows.push(currentRow);

    // For each row, sort items by X. For Hebrew/RTL, columns read right-to-left.
    // We sort right-to-left (descending X) so that the FIRST cell is the rightmost (Hebrew "first column").
    return rows.map(row => {
      const sortedRow = row.sort((a, b) => b.x - a.x);
      // Merge adjacent items that are very close (same logical cell)
      const cells = [];
      let cur = null;
      for (const it of sortedRow) {
        if (cur && Math.abs(cur.x - it.x) < (cur.estWidth || 10)) {
          // Same cell — concatenate
          cur.str += ' ' + it.str;
        } else {
          if (cur) cells.push(cur);
          cur = { str: it.str, x: it.x, estWidth: Math.max(it.width, 30) };
        }
      }
      if (cur) cells.push(cur);
      return cells.map(c => c.str.trim()).filter(Boolean);
    });
  };

  // Parse a PDF file into the same { sheets: [{ name, rows }] } shape that XLSX returns,
  // so the existing header detection / row extraction code can run as-is.
  const parsePdfFile = async (file) => {
    const buf = await file.arrayBuffer();

    // Try without password first
    let pages;
    try {
      pages = await extractItems(new Uint8Array(buf));
    } catch (err) {
      if (err?.name === 'PasswordException' || /password/i.test(err?.message || '')) {
        let password = await promptPassword(file.name, false);
        while (password) {
          try {
            pages = await extractItems(new Uint8Array(buf), password);
            break;
          } catch (err2) {
            if (err2?.name === 'PasswordException' || /password/i.test(err2?.message || '')) {
              password = await promptPassword(file.name, true);
            } else {
              throw err2;
            }
          }
        }
        if (!pages) throw new Error('הקובץ לא נפתח — סיסמה שגויה או בוטל.');
      } else {
        throw err;
      }
    }

    // Each page becomes its own "sheet" — keeps the sheet picker happy and helps
    // when transactions span pages.
    const sheets = pages.map((items, idx) => ({
      name: `עמוד ${idx + 1}`,
      rows: itemsToRows(items),
    }));

    // ALSO concatenate all pages into one big sheet — sometimes the header is on
    // page 1 and the data starts on page 2; a combined view lets the header
    // detector still find it.
    const all = [];
    for (const sheet of sheets) all.push(...sheet.rows);
    sheets.push({ name: 'כל העמודים', rows: all });

    return { sheets };
  };

  return { isPdf, parsePdfFile };
})();
