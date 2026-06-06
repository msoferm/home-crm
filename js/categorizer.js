// ============================================================
//  Auto-categorization engine
//  Matches transaction descriptions to categories by keyword
// ============================================================

const Categorizer = (() => {
  let _cache = null;

  const reset = () => { _cache = null; };

  const load = async () => {
    if (_cache) return _cache;
    const cats = await DB.catAll();
    // Build a normalized keyword index
    const idx = [];
    cats.forEach(c => {
      (c.keywords || []).forEach(kw => {
        if (!kw) return;
        idx.push({
          categoryId: c.id,
          keyword: String(kw).toLowerCase().trim(),
        });
      });
    });
    // longer keywords first for better matching
    idx.sort((a, b) => b.keyword.length - a.keyword.length);
    _cache = { cats, idx, generalId: cats.find(c => c.name === 'כללי')?.id || cats[cats.length - 1]?.id };
    return _cache;
  };

  const normalize = (s) => String(s || '').toLowerCase()
    .replace(/[֐-ׇ]/g, ch => ch) // keep hebrew
    .replace(/\s+/g, ' ')
    .trim();

  const categorize = async (description) => {
    const { idx, generalId } = await load();
    const text = normalize(description);
    if (!text) return generalId;
    for (const { keyword, categoryId } of idx) {
      if (text.includes(keyword)) return categoryId;
    }
    return generalId;
  };

  const categorizeBulk = async (descriptions) => {
    await load();
    return Promise.all(descriptions.map(d => categorize(d)));
  };

  const recategorizeAll = async () => {
    reset();
    await load();
    const txs = await DB.txAll();
    let changed = 0;
    for (const t of txs) {
      // Only re-categorize expenses with the default "general" cat or no cat
      const newCat = await categorize(t.description);
      if (newCat && newCat !== t.categoryId) {
        await DB.txUpdate(t.id, { categoryId: newCat });
        changed++;
      }
    }
    return changed;
  };

  // Determine if a transaction is income (positive amount + matches income keywords)
  // or expense (everything else)
  const INCOME_HINTS = ['משכורת','שכר','החזר','זיכוי','salary','refund','קצבה','מענק','דיבידנד','ריבית זכות','העברה זכות'];
  const detectType = (description, amount) => {
    const t = normalize(description);
    if (amount > 0 && INCOME_HINTS.some(k => t.includes(k))) return 'income';
    if (amount < 0) return 'expense';
    if (amount > 0) return 'income';
    return 'expense';
  };

  return { categorize, categorizeBulk, recategorizeAll, detectType, reset };
})();
