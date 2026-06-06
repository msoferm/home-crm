// ============================================================
//  Categories page
// ============================================================

const Categories = (() => {

  const render = async () => {
    const [cats, txs] = await Promise.all([DB.catAll(), DB.txAll()]);
    const grid = document.getElementById('cats-grid');
    U.clearChildren(grid);
    const countByCat = {};
    const sumByCat = {};
    txs.forEach(t => {
      countByCat[t.categoryId] = (countByCat[t.categoryId] || 0) + 1;
      sumByCat[t.categoryId] = (sumByCat[t.categoryId] || 0) + Math.abs(t.amount);
    });
    cats.sort((a, b) => (sumByCat[b.id] || 0) - (sumByCat[a.id] || 0));
    cats.forEach(c => {
      const card = U.el('div', { class: 'cat-card' }, [
        U.el('div', { class: 'cat-icon', style: { background: c.color } }, c.icon || '📦'),
        U.el('div', {}, [
          U.el('div', { class: 'cat-name' }, c.name),
          U.el('div', { class: 'cat-stats' }, `${countByCat[c.id] || 0} תנועות • ${U.fmtILS(sumByCat[c.id] || 0)}`),
          U.el('div', { class: 'cat-stats' }, `${(c.keywords || []).length} מילות מפתח`),
        ]),
        U.el('div', { class: 'cat-actions' }, [
          U.el('button', { class: 'btn-soft', style: { padding: '4px 8px', fontSize: '12px' }, onclick: () => openEdit(c) }, '✎'),
          U.el('button', { class: 'btn-danger', style: { padding: '4px 8px', fontSize: '12px' }, onclick: () => deleteCat(c) }, '🗑'),
        ]),
      ]);
      grid.appendChild(card);
    });
  };

  const openEdit = async (cat = null) => {
    const form = U.el('form');
    const nameInp = UI.inputText('name', cat?.name || '', { placeholder: 'שם הקטגוריה' });
    const iconInp = UI.inputText('icon', cat?.icon || '📦', { placeholder: 'אימוג׳י' });
    const colorInp = U.el('input', { type: 'color', name: 'color', class: 'input', value: cat?.color || '#6366f1' });
    const typeSel = UI.inputSelect('type', [
      { value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' },
    ], cat?.type || 'expense');
    const keywordsInp = U.el('textarea', { name: 'keywords', class: 'input', rows: 4, placeholder: 'מילות מפתח, מופרדות בפסיק' }, [(cat?.keywords || []).join(', ')]);

    form.appendChild(UI.grid([
      UI.fullCol(UI.formField('שם', nameInp)),
      UI.formField('אייקון (אימוג׳י)', iconInp),
      UI.formField('צבע', colorInp),
      UI.formField('סוג', typeSel),
      UI.fullCol(UI.formField('מילות מפתח לסיווג אוטומטי (מופרדות בפסיק)', keywordsInp)),
    ]));

    const save = U.el('button', { class: 'btn', onclick: async (e) => {
      e.preventDefault();
      const data = UI.collectForm(form);
      if (!data.name) { UI.toast('יש למלא שם', 'error'); return; }
      const keywords = (data.keywords || '').split(',').map(s => s.trim()).filter(Boolean);
      const payload = { name: data.name, icon: data.icon, color: data.color, type: data.type, keywords };
      if (cat) await DB.catUpdate(cat.id, payload);
      else await DB.catAdd(payload);
      Categorizer.reset();
      UI.toast('נשמר', 'success');
      closeModal();
      await Transactions.populateFilters();
      render();
    }}, 'שמירה');
    const cancel = U.el('button', { class: 'btn-soft', onclick: (e) => { e.preventDefault(); closeModal(); } }, 'ביטול');
    let closeModal = UI.openModal({ title: cat ? 'עריכת קטגוריה' : 'קטגוריה חדשה', body: form, footer: [cancel, save] });
  };

  const deleteCat = async (cat) => {
    const ok = await UI.confirmDialog({
      title: 'מחיקת קטגוריה',
      body: `למחוק את "${cat.name}"? תנועות יישארו אך ללא שיוך.`,
      confirmLabel: 'מחיקה', danger: true,
    });
    if (!ok) return;
    await DB.catDelete(cat.id);
    Categorizer.reset();
    UI.toast('נמחק', 'success');
    await Transactions.populateFilters();
    render();
  };

  const recategorize = async () => {
    const ok = await UI.confirmDialog({
      title: 'סיווג מחדש',
      body: 'לסווג מחדש את כל התנועות לפי הקטגוריות והמילים הנוכחיות?',
      confirmLabel: 'בצע סיווג מחדש',
    });
    if (!ok) return;
    UI.toast('מסווג מחדש...', '');
    const changed = await Categorizer.recategorizeAll();
    UI.toast(`עודכנו ${changed} תנועות`, 'success');
    render();
  };

  const init = () => {
    document.getElementById('cat-add').addEventListener('click', () => openEdit());
    document.getElementById('cat-recategorize').addEventListener('click', recategorize);
  };

  UI.subscribePage((p) => { if (p === 'categories') render(); });

  return { render, init };
})();
