// ============================================================
//  Database layer (Dexie / IndexedDB)
// ============================================================

const DB = (() => {
  const db = new Dexie('HomeFinance');

  db.version(1).stores({
    transactions: 'id, date, amount, accountId, categoryId, type, sourceFile, installmentParentId, recurringParentId, dedupKey',
    accounts:     'id, name, type, color',
    categories:   'id, name, parentId, type',
    recurring:    'id, name, dayOfMonth, accountId, categoryId, active',
    budgets:      'id, categoryId',
    settings:     'key',
  });

  const DEFAULT_CATEGORIES = [
    { name: 'מזון וסופר',       icon: '🛒', color: '#10b981', keywords: ['שופרסל','רמי לוי','יינות ביתן','מגה','אושר עד','ויקטורי','טיב טעם','חצי חינם','קרפור','am pm','am:pm','am-pm','סופר','שופ','שוק העיר','superpharm','שופרסל'] },
    { name: 'מסעדות ובתי קפה',   icon: '🍔', color: '#f97316', keywords: ['מסעדה','קפה','ארומה','קופיקס','ג׳נטלמן','בורגר','פיצה','דומינוס','מקדונלד','קפה גרג','קפה לנדוור','שוק','wolt','וולט','tenbis','תן ביס','10bis','עשר ביס','גט','גלידה'] },
    { name: 'דלק ותחבורה',        icon: '⛽', color: '#3b82f6', keywords: ['דלק','פז','סונול','דור אלון','טן','סדש','כביש 6','חניון','חניה','אגד','דן','קווים','רכבת','רכבת ישראל','מטרו','קרסו','אוטו','שמן','גט טקסי','gett','קוויק','מוסך','טסט','רישוי'] },
    { name: 'חשמל',              icon: '💡', color: '#facc15', keywords: ['חברת חשמל','חשמל','iec','פז גז','בזן','אנרגיה'] },
    { name: 'מים',               icon: '💧', color: '#06b6d4', keywords: ['מים','תאגיד','מי','הגיחון','מקורות','מי אביבים','פלגי מים'] },
    { name: 'ארנונה',            icon: '🏛️', color: '#a855f7', keywords: ['ארנונה','עירייה','מועצה','עיריית','רשות'] },
    { name: 'ועד בית',           icon: '🏠', color: '#84cc16', keywords: ['ועד','דיירים'] },
    { name: 'תקשורת',            icon: '📱', color: '#0ea5e9', keywords: ['בזק','הוט','פרטנר','סלקום','פלאפון','גולן','019','rami levy communications','triple','HOT','yes','נטפליקס','netflix','spotify','ספוטיפיי','יוטיוב','youtube','disney','HBO','apple','google','אפל','גוגל','iCloud'] },
    { name: 'ביטוח',              icon: '🛡️', color: '#dc2626', keywords: ['ביטוח','הראל','מגדל','כלל','מנורה','הפניקס','איילון','שלמה','ביטוח לאומי','BL','ביטוח בריאות','ביטוח דירה','ביטוח רכב'] },
    { name: 'בריאות ותרופות',     icon: '⚕️', color: '#ec4899', keywords: ['קופת חולים','מכבי','כללית','מאוחדת','לאומית','סופרפארם','פארם','בי גוד','beauty','אופטיקה','שיניים','פיזיותרפיה','רופא','נטורופת','תרופ','smartdent'] },
    { name: 'בידור ופנאי',         icon: '🎬', color: '#8b5cf6', keywords: ['קולנוע','יס פלאנט','סינמה','תיאטרון','הופעה','משחקי','playstation','xbox','steam','איקאה','אופנה','aliexpress','אמזון','amazon','ebay','חנות','מתנה'] },
    { name: 'ביגוד והנעלה',       icon: '👕', color: '#f59e0b', keywords: ['castro','קסטרו','renuar','רנואר','fox','פוקס','h&m','zara','זארה','אופנת','שוז','adika','ASOS','דרגון','ynet shops','בגדים','נעליים','tory'] },
    { name: 'חינוך וילדים',       icon: '🎒', color: '#22c55e', keywords: ['בית ספר','גן','גנון','חוג','חוגים','קייטנה','שיעורי','אוניברסיטה','מכללה','לימודים','ספרי לימוד','חברת חיוג','התנדבות','ספרים','חברת ילדים','כפר'] },
    { name: 'בית וריהוט',         icon: '🛋️', color: '#7c3aed', keywords: ['איקאה','ikea','הום סנטר','אייס','ace','חומרי בנין','כלי בית','tiv tam','שטיח','ריהוט','מזרון','עמינח','מטבח'] },
    { name: 'משיכת מזומן',         icon: '💵', color: '#64748b', keywords: ['משיכת','מזומן','כספומט','atm','משיכה'] },
    { name: 'העברות ותשלומים',    icon: '🔄', color: '#475569', keywords: ['ביט','bit','paybox','פייבוקס','העברה','העברת','transfer','שיק','המחאה'] },
    { name: 'משכנתא',             icon: '🏦', color: '#0d9488', keywords: ['משכנתא','משכנתה','mortgage','בנק לאומי','לאומי','פועלים','מזרחי','דיסקונט'] },
    { name: 'עמלות בנק',          icon: '🏛️', color: '#94a3b8', keywords: ['עמלת','עמלה','דמי ניהול','ריבית','החזר ריבית','עמלות'] },
    { name: 'משכורת',             icon: '💼', color: '#10b981', keywords: ['משכורת','משכורות','שכר','salary','שכר עבודה','תלוש'] },
    { name: 'מתנות והחזרים',       icon: '🎁', color: '#f43f5e', keywords: ['החזר','החזרי','זיכוי','מתנה','מענק','קצבה'] },
    { name: 'כללי',               icon: '📦', color: '#6b7280', keywords: [] },
  ];

  const DEFAULT_ACCOUNTS = [
    { name: 'עו"ש ראשי', type: 'bank', color: '#3b82f6' },
    { name: 'ויזה כאל',  type: 'card', color: '#6366f1' },
  ];

  const init = async () => {
    const catCount = await db.categories.count();
    if (catCount === 0) {
      const cats = DEFAULT_CATEGORIES.map(c => ({
        id: U.uid(),
        name: c.name,
        icon: c.icon,
        color: c.color,
        keywords: c.keywords,
        type: 'expense',
      }));
      await db.categories.bulkAdd(cats);
    }
    const accCount = await db.accounts.count();
    if (accCount === 0) {
      const accs = DEFAULT_ACCOUNTS.map(a => ({
        id: U.uid(), name: a.name, type: a.type, color: a.color, lastBalance: 0, lastBalanceDate: null,
      }));
      await db.accounts.bulkAdd(accs);
    }
  };

  // ===== Transactions =====
  const txAll = () => db.transactions.toArray();
  const txByMonth = async (date) => {
    const { start, end } = U.monthRange(date);
    return db.transactions.where('date').between(start, end, true, true).toArray();
  };
  const txAdd = async (tx) => {
    tx.id = tx.id || U.uid();
    tx.createdAt = tx.createdAt || new Date();
    await db.transactions.add(tx);
    return tx;
  };
  const txBulkAdd = async (txs) => {
    txs.forEach(t => {
      t.id = t.id || U.uid();
      t.createdAt = t.createdAt || new Date();
    });
    await db.transactions.bulkAdd(txs);
    return txs;
  };
  const txUpdate = async (id, patch) => db.transactions.update(id, patch);
  const txDelete = async (id) => db.transactions.delete(id);
  const txDeleteAll = async () => db.transactions.clear();

  // Dedupe by key: date|amount|description|account
  const makeDedupKey = (tx) => {
    const d = tx.date instanceof Date ? tx.date : new Date(tx.date);
    const ds = isNaN(d) ? '' : `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const desc = (tx.description || '').replace(/\s+/g,'').slice(0,50);
    return `${ds}|${Math.round(tx.amount*100)}|${desc}|${tx.accountId || ''}`;
  };
  const existingDedupKeys = async () => {
    const all = await db.transactions.toArray();
    return new Set(all.map(t => t.dedupKey || makeDedupKey(t)));
  };

  // ===== Accounts =====
  const accAll = () => db.accounts.toArray();
  const accGet = (id) => db.accounts.get(id);
  const accAdd = async (a) => { a.id = a.id || U.uid(); await db.accounts.add(a); return a; };
  const accUpdate = (id, patch) => db.accounts.update(id, patch);
  const accDelete = (id) => db.accounts.delete(id);

  // ===== Categories =====
  const catAll = () => db.categories.toArray();
  const catGet = (id) => db.categories.get(id);
  const catAdd = async (c) => { c.id = c.id || U.uid(); await db.categories.add(c); return c; };
  const catUpdate = (id, patch) => db.categories.update(id, patch);
  const catDelete = (id) => db.categories.delete(id);

  // ===== Recurring =====
  const recAll = () => db.recurring.toArray();
  const recAdd = async (r) => { r.id = r.id || U.uid(); await db.recurring.add(r); return r; };
  const recUpdate = (id, patch) => db.recurring.update(id, patch);
  const recDelete = (id) => db.recurring.delete(id);

  // ===== Budgets =====
  const budgetAll = () => db.budgets.toArray();
  const budgetSet = async (categoryId, monthlyLimit) => {
    const existing = await db.budgets.where('categoryId').equals(categoryId).first();
    if (existing) await db.budgets.update(existing.id, { monthlyLimit });
    else await db.budgets.add({ id: U.uid(), categoryId, monthlyLimit });
  };
  const budgetDelete = async (categoryId) => {
    const existing = await db.budgets.where('categoryId').equals(categoryId).first();
    if (existing) await db.budgets.delete(existing.id);
  };

  // ===== Settings =====
  const setGet = async (key) => (await db.settings.get(key))?.value;
  const setPut = (key, value) => db.settings.put({ key, value });

  // ===== Backup =====
  const exportAll = async () => {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: await db.transactions.toArray(),
      accounts: await db.accounts.toArray(),
      categories: await db.categories.toArray(),
      recurring: await db.recurring.toArray(),
      budgets: await db.budgets.toArray(),
      settings: await db.settings.toArray(),
    };
  };
  const importAll = async (data) => {
    await db.transaction('rw', db.transactions, db.accounts, db.categories, db.recurring, db.budgets, db.settings, async () => {
      await Promise.all([
        db.transactions.clear(),
        db.accounts.clear(),
        db.categories.clear(),
        db.recurring.clear(),
        db.budgets.clear(),
        db.settings.clear(),
      ]);
      if (data.transactions?.length) await db.transactions.bulkAdd(data.transactions);
      if (data.accounts?.length) await db.accounts.bulkAdd(data.accounts);
      if (data.categories?.length) await db.categories.bulkAdd(data.categories);
      if (data.recurring?.length) await db.recurring.bulkAdd(data.recurring);
      if (data.budgets?.length) await db.budgets.bulkAdd(data.budgets);
      if (data.settings?.length) await db.settings.bulkAdd(data.settings);
    });
  };

  const resetAll = async () => {
    await db.transaction('rw', db.transactions, db.accounts, db.categories, db.recurring, db.budgets, db.settings, async () => {
      await Promise.all([
        db.transactions.clear(),
        db.accounts.clear(),
        db.categories.clear(),
        db.recurring.clear(),
        db.budgets.clear(),
        db.settings.clear(),
      ]);
    });
    await init();
  };

  return {
    db, init,
    txAll, txByMonth, txAdd, txBulkAdd, txUpdate, txDelete, txDeleteAll,
    makeDedupKey, existingDedupKeys,
    accAll, accGet, accAdd, accUpdate, accDelete,
    catAll, catGet, catAdd, catUpdate, catDelete,
    recAll, recAdd, recUpdate, recDelete,
    budgetAll, budgetSet, budgetDelete,
    setGet, setPut,
    exportAll, importAll, resetAll,
  };
})();
