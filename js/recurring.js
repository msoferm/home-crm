// ============================================================
//  Recurring (הוצאות והכנסות קבועות)
// ============================================================

const Recurring = (() => {

  const render = async () => {
    const [rules, cats, accs] = await Promise.all([DB.recAll(), DB.catAll(), DB.accAll()]);
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    const accById = Object.fromEntries(accs.map(a => [a.id, a]));
    const tbody = document.getElementById('rec-tbody');
    U.clearChildren(tbody);
    rules.sort((a, b) => (a.dayOfMonth || 0) - (b.dayOfMonth || 0));
    rules.forEach(r => {
      const cat = catById[r.categoryId];
      const acc = accById[r.accountId];
      const tr = U.el('tr', {}, [
        U.el('td', {}, r.name),
        U.el('td', {}, U.el('span', { class: 'pill ' + (r.type === 'income' ? 'income' : 'expense') }, r.type === 'income' ? 'הכנסה' : 'הוצאה')),
        U.el('td', {}, cat ? U.el('span', { class: 'pill cat', style: { background: cat.color + '22', color: cat.color } }, `${cat.icon || ''} ${cat.name}`) : '—'),
        U.el('td', {}, acc?.name || '—'),
        U.el('td', {}, String(r.dayOfMonth || 1)),
        U.el('td', { class: 'num ' + (r.type === 'income' ? 'amt-in' : 'amt-out') }, U.fmtILS(r.type === 'income' ? r.amount : -r.amount, true)),
        U.el('td', {}, U.el('span', { class: 'pill ' + (r.active ? 'income' : 'warn') }, r.active ? 'פעיל' : 'כבוי')),
        U.el('td', {}, U.el('div', { class: 'row-actions' }, [
          U.el('button', { onclick: () => openEdit(r) }, '✎'),
          U.el('button', { onclick: () => toggleActive(r) }, r.active ? '⏸' : '▶'),
          U.el('button', { onclick: () => deleteRec(r) }, '🗑'),
        ])),
      ]);
      tbody.appendChild(tr);
    });
    if (rules.length === 0) {
      tbody.appendChild(U.el('tr', {}, U.el('td', { colspan: 8, class: 'muted', style: { textAlign: 'center', padding: '30px' } }, 'אין הוצאות קבועות. הוסף משכורת, משכנתא, ארנונה, מנויים וכו׳ כדי שיופיעו בצפי.')));
    }
  };

  const openEdit = async (rec = null) => {
    const [cats, accs] = await Promise.all([DB.catAll(), DB.accAll()]);
    const form = U.el('form');
    const nameInp = UI.inputText('name', rec?.name || '', { placeholder: 'לדוגמה: משכורת / משכנתא / ארנונה' });
    const typeSel = UI.inputSelect('type', [
      { value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' },
    ], rec?.type || 'expense');
    const amountInp = UI.inputText('amount', rec?.amount || '', { type: 'number', step: '0.01' });
    const daySel = UI.inputText('dayOfMonth', rec?.dayOfMonth || 1, { type: 'number', min: '1', max: '31' });
    const catSel = UI.inputSelect('categoryId', cats.map(c => ({ value: c.id, label: `${c.icon || ''} ${c.name}` })), rec?.categoryId || '');
    const accSel = UI.inputSelect('accountId', accs.map(a => ({ value: a.id, label: a.name })), rec?.accountId || accs[0]?.id || '');
    const activeChk = UI.inputCheckbox('active', 'פעיל', rec ? !!rec.active : true);

    form.appendChild(UI.grid([
      UI.fullCol(UI.formField('שם', nameInp)),
      UI.formField('סוג', typeSel),
      UI.formField('סכום (₪)', amountInp),
      UI.formField('יום בחודש', daySel),
      UI.formField('קטגוריה', catSel),
      UI.formField('חשבון/כרטיס', accSel),
      UI.fullCol(activeChk),
    ]));

    const save = U.el('button', { class: 'btn', onclick: async (e) => {
      e.preventDefault();
      const data = UI.collectForm(form);
      if (!data.name || !data.amount) { UI.toast('שם וסכום הם שדות חובה', 'error'); return; }
      const payload = {
        name: data.name, type: data.type, amount: Math.abs(+data.amount),
        dayOfMonth: Math.max(1, Math.min(31, +data.dayOfMonth || 1)),
        categoryId: data.categoryId, accountId: data.accountId,
        active: !!data.active,
      };
      if (rec) await DB.recUpdate(rec.id, payload);
      else await DB.recAdd(payload);
      UI.toast('נשמר', 'success');
      closeModal();
      render();
    }}, 'שמירה');
    const cancel = U.el('button', { class: 'btn-soft', onclick: (e) => { e.preventDefault(); closeModal(); } }, 'ביטול');
    let closeModal = UI.openModal({ title: rec ? 'עריכה' : 'הוצאה/הכנסה קבועה חדשה', body: form, footer: [cancel, save] });
  };

  const toggleActive = async (rec) => {
    await DB.recUpdate(rec.id, { active: !rec.active });
    render();
  };

  const deleteRec = async (rec) => {
    const ok = await UI.confirmDialog({ title: 'מחיקה', body: `למחוק את "${rec.name}"?`, confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    await DB.recDelete(rec.id);
    UI.toast('נמחק', 'success');
    render();
  };

  const init = () => {
    document.getElementById('rec-add').addEventListener('click', () => openEdit());
  };

  UI.subscribePage((p) => { if (p === 'recurring') render(); });

  return { render, init };
})();
