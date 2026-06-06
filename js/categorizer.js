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

  // Auto-classify a transaction as fixed (קבוע) or variable (מזדמן)
  // Heuristic:
  //   1. If it has a recurringParentId or matches a recurring rule → fixed
  //   2. If the category is in the FIXED_CATEGORY_NAMES list → fixed
  //   3. If description matches obvious recurring keywords → fixed
  //   4. Otherwise → variable
  const FIXED_CATEGORY_NAMES = new Set([
    'חשמל', 'מים', 'ארנונה', 'ועד בית', 'תקשורת',
    'ביטוח', 'משכנתא', 'משכורת',
  ]);
  const FIXED_KEYWORDS = [
    'משכורת','משכנתא','ארנונה','חשמל','חברת חשמל','בזק','הוט','פרטנר','סלקום','פלאפון',
    'netflix','נטפליקס','spotify','ספוטיפיי','apple','google','icloud','disney',
    'ועד בית','ועד','דמי ניהול','ביטוח','הראל','מגדל','כלל','מנורה','הפניקס','איילון',
  ];
  const detectFixedOrVariable = async (tx, catName = null) => {
    if (tx.recurringParentId) return 'fixed';
    const text = normalize(tx.description || '');
    if (FIXED_KEYWORDS.some(k => text.includes(normalize(k)))) return 'fixed';
    if (catName && FIXED_CATEGORY_NAMES.has(catName)) return 'fixed';
    if (!catName && tx.categoryId) {
      const cat = await DB.catGet(tx.categoryId);
      if (cat && FIXED_CATEGORY_NAMES.has(cat.name)) return 'fixed';
    }
    return 'variable';
  };

  // Re-classify all transactions that don't have a manual override.
  const autoClassifyAll = async () => {
    const txs = await DB.txAll();
    const cats = await DB.catAll();
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    let changed = 0;
    for (const t of txs) {
      if (t.fixedOrVariableManual) continue; // respect manual overrides
      const cur = t.fixedOrVariable;
      const next = await detectFixedOrVariable(t, catById[t.categoryId]?.name);
      if (cur !== next) {
        await DB.txUpdate(t.id, { fixedOrVariable: next });
        changed++;
      }
    }
    return changed;
  };

  return { categorize, categorizeBulk, recategorizeAll, detectType, detectFixedOrVariable, autoClassifyAll, reset };
})();
