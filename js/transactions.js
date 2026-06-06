// ============================================================
//  Transactions page — list, filter, CRUD
// ============================================================

const Transactions = (() => {
  let _filters = { q: '', categoryId: '', accountId: '', type: '', fixed: '' };

  const populateFilters = async () => {
    const [cats, accs] = await Promise.all([DB.catAll(), DB.accAll()]);
    const catSel = document.getElementById('tx-filter-cat');
    const accSel = document.getElementById('tx-filter-acc');
    catSel.innerHTML = '<option value="">כל הקטגוריות</option>' +
      cats.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('');
    accSel.innerHTML = '<option value="">כל החשבונות</option>' +
      accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  };

  const render = async () => {
    const month = UI.activeMonth();
    const { start, end } = U.monthRange(month);
    const [allTxs, cats, accs] = await Promise.all([DB.txAll(), DB.catAll(), DB.accAll()]);
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    const accById = Object.fromEntries(accs.map(a => [a.id, a]));

    let txs = allTxs.filter(t => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= start && d <= end;
    });
    if (_filters.q) {
      const q = _filters.q.toLowerCase();
      txs = txs.filter(t => (t.description || '').toLowerCase().includes(q));
    }
    if (_filters.categoryId) txs = txs.filter(t => t.categoryId === _filters.categoryId);
    if (_filters.accountId) txs = txs.filter(t => t.accountId === _filters.accountId);
    if (_filters.type) txs = txs.filter(t => t.type === _filters.type);
    if (_filters.fixed === 'fixed') txs = txs.filter(t => t.fixedOrVariable === 'fixed');
    else if (_filters.fixed === 'variable') txs = txs.filter(t => t.fixedOrVariable === 'variable');
    else if (_filters.fixed === 'unclassified') txs = txs.filter(t => !t.fixedOrVariable);

    txs.sort((a, b) => new Date(b.date) - new Date(a.date));

    const tbody = document.getElementById('tx-tbody');
    U.clearChildren(tbody);

    txs.forEach(t => {
      const cat = catById[t.categoryId];
      const acc = accById[t.accountId];
      const installLbl = t.installment && t.installment.total > 1
        ? `${t.installment.current}/${t.installment.total}`
        : '';
      const accLabel = acc ? (acc.last4Digits ? `${acc.name} •••• ${acc.last4Digits}` : acc.name) : '—';
      const fixedBadge = t.fixedOrVariable === 'fixed'
        ? U.el('span', { class: 'pill warn', style: { marginRight: '4px', fontSize: '10.5px' }, title: 'הוצאה קבועה' }, '🔁 קבועה')
        : t.fixedOrVariable === 'variable'
        ? U.el('span', { class: 'pill info', style: { marginRight: '4px', fontSize: '10.5px' }, title: 'הוצאה מזדמנת' }, '◆ מזדמנת')
        : null;
      const tr = U.el('tr', {}, [
        U.el('td', {}, U.fmtDate(t.date)),
        U.el('td', {}, [
          U.el('div', {}, [t.description, ' ', fixedBadge].filter(Boolean)),
          t.notes ? U.el('div', { class: 'muted', style: { fontSize: '11px' } }, t.notes) : null,
        ].filter(Boolean)),
        U.el('td', {}, cat ? U.el('span', { class: 'pill cat', style: { background: cat.color + '22', color: cat.color } }, `${cat.icon || ''} ${cat.name}`) : '—'),
        U.el('td', {}, acc ? U.el('span', { class: 'pill info', style: acc.color ? { background: acc.color + '22', color: acc.color } : {} }, accLabel) : '—'),
        U.el('td', {}, installLbl ? U.el('span', { class: 'pill warn' }, installLbl) : ''),
        U.el('td', { class: 'num ' + (t.amount < 0 ? 'amt-out' : 'amt-in') }, U.fmtILS(t.amount, true)),
        U.el('td', { class: 'row-actions' }, U.el('div', { class: 'row-actions' }, [
          U.el('button', { onclick: () => toggleFixed(t), title: 'החלף קבועה/מזדמנת' }, '🔁'),
          U.el('button', { onclick: () => openEdit(t) }, '✎'),
          U.el('button', { onclick: () => deleteTx(t) }, '🗑'),
        ])),
      ]);
      tbody.appendChild(tr);
    });

    if (txs.length === 0) {
      tbody.appendChild(U.el('tr', {}, U.el('td', { colspan: 7, class: 'muted', style: { textAlign: 'center', padding: '40px' } }, 'אין תנועות תואמות בחודש הנבחר')));
    }

    const inc = U.sum(txs.filter(t => t.type === 'income'), t => t.amount);
    const exp = U.sum(txs.filter(t => t.type === 'expense'), t => Math.abs(t.amount));
    document.getElementById('tx-foot').innerHTML = `
      ${txs.length} תנועות &nbsp;|&nbsp;
      הכנסות: <strong class="amt-in">${U.fmtILS(inc)}</strong> &nbsp;|&nbsp;
      הוצאות: <strong class="amt-out">${U.fmtILS(exp)}</strong> &nbsp;|&nbsp;
      מאזן: <strong class="${(inc - exp) < 0 ? 'amt-out' : 'amt-in'}">${U.fmtILS(inc - exp, true)}</strong>
    `;
  };

  const openEdit = async (tx = null) => {
    const [cats, accs] = await Promise.all([DB.catAll(), DB.accAll()]);
    const form = U.el('form', { id: 'tx-form' });

    const dateInp = UI.inputDate('date', tx?.date || new Date());
    const descInp = UI.inputText('description', tx?.description || '', { placeholder: 'תיאור התנועה' });
    const amountInp = UI.inputText('amount', tx ? Math.abs(tx.amount) : '', { type: 'number', step: '0.01', placeholder: '0.00' });
    const typeSel = UI.inputSelect('type', [{ value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' }], tx?.type || 'expense');
    const catSel = UI.inputSelect('categoryId', cats.map(c => ({ value: c.id, label: `${c.icon || ''} ${c.name}` })), tx?.categoryId || '');
    const accSel = UI.inputSelect('accountId', accs.map(a => ({ value: a.id, label: a.name })), tx?.accountId || accs[0]?.id || '');
    const installCur = UI.inputText('installCurrent', tx?.installment?.current || '', { type: 'number', min: '1', placeholder: '1' });
    const installTot = UI.inputText('installTotal', tx?.installment?.total || '', { type: 'number', min: '1', placeholder: '1' });
    const notesInp = UI.inputText('notes', tx?.notes || '', { placeholder: 'הערות' });

    form.appendChild(UI.grid([
      UI.formField('תאריך', dateInp),
      UI.formField('סוג', typeSel),
      UI.fullCol(UI.formField('תיאור', descInp)),
      UI.formField('סכום (₪)', amountInp),
      UI.formField('קטגוריה', catSel),
      UI.formField('חשבון/כרטיס', accSel),
      UI.formField('תשלום נוכחי', installCur),
      UI.formField('סך תשלומים', installTot),
      UI.fullCol(UI.formField('הערות', notesInp)),
    ]));

    const save = U.el('button', { class: 'btn', onclick: async (e) => {
      e.preventDefault();
      const data = UI.collectForm(form);
      if (!data.description || data.amount == null) {
        UI.toast('יש למלא תיאור וסכום', 'error'); return;
      }
      const installment = (data.installTotal && +data.installTotal > 1)
        ? { current: +data.installCurrent || 1, total: +data.installTotal }
        : null;
      const payload = {
        date: data.date || new Date(),
        description: data.description,
        amount: data.type === 'expense' ? -Math.abs(+data.amount) : Math.abs(+data.amount),
        type: data.type,
        categoryId: data.categoryId,
        accountId: data.accountId,
        notes: data.notes || '',
        installment,
      };
      payload.dedupKey = DB.makeDedupKey(payload);
      if (tx) {
        await DB.txUpdate(tx.id, payload);
        UI.toast('עודכן', 'success');
      } else {
        await DB.txAdd(payload);
        UI.toast('נוסף', 'success');
      }
      closeModal();
      render();
    }}, tx ? 'עדכון' : 'הוספה');

    const cancel = U.el('button', { class: 'btn-soft', onclick: (e) => { e.preventDefault(); closeModal(); } }, 'ביטול');

    let closeModal = UI.openModal({ title: tx ? 'עריכת תנועה' : 'תנועה חדשה', body: form, footer: [cancel, save] });
  };

  // Toggle the fixed/variable flag on a transaction.
  // null → 'fixed' → 'variable' → null (clear)
  const toggleFixed = async (tx) => {
    const next = tx.fixedOrVariable === 'fixed' ? 'variable'
              : tx.fixedOrVariable === 'variable' ? null
              : 'fixed';
    await DB.txUpdate(tx.id, { fixedOrVariable: next, fixedOrVariableManual: true });
    UI.toast(next === 'fixed' ? 'סומן כקבוע' : next === 'variable' ? 'סומן כמזדמן' : 'הוסר סיווג', 'success');
    render();
  };

  const deleteTx = async (tx) => {
    const ok = await UI.confirmDialog({
      title: 'מחיקת תנועה', body: `למחוק את "${tx.description}" על סך ${U.fmtILS(tx.amount, true)}?`,
      confirmLabel: 'מחיקה', danger: true,
    });
    if (!ok) return;
    await DB.txDelete(tx.id);
    UI.toast('נמחק', 'success');
    render();
  };

  const exportCSV = async () => {
    const txs = await DB.txAll();
    const cats = await DB.catAll();
    const accs = await DB.accAll();
    const catById = Object.fromEntries(cats.map(c => [c.id, c.name]));
    const accById = Object.fromEntries(accs.map(a => [a.id, a.name]));
    const rows = [
      ['תאריך','תיאור','קטגוריה','חשבון','סוג','סכום','תשלום','הערות'],
      ...txs.sort((a, b) => new Date(b.date) - new Date(a.date)).map(t => [
        U.fmtDate(t.date),
        t.description || '',
        catById[t.categoryId] || '',
        accById[t.accountId] || '',
        t.type === 'income' ? 'הכנסה' : 'הוצאה',
        t.amount,
        t.installment ? `${t.installment.current}/${t.installment.total}` : '',
        t.notes || '',
      ]),
    ];
    const csv = '﻿' + rows.map(r => r.map(c => {
      const s = String(c).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(',')).join('\n');
    U.downloadFile(`transactions-${U.ymKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8;');
    UI.toast('הקובץ הורד', 'success');
  };

  // Setup events
  const init = () => {
    document.getElementById('tx-search').addEventListener('input', U.debounce((e) => {
      _filters.q = e.target.value; render();
    }, 200));
    document.getElementById('tx-filter-cat').addEventListener('change', (e) => { _filters.categoryId = e.target.value; render(); });
    document.getElementById('tx-filter-acc').addEventListener('change', (e) => { _filters.accountId = e.target.value; render(); });
    document.getElementById('tx-filter-type').addEventListener('change', (e) => { _filters.type = e.target.value; render(); });
    document.getElementById('tx-filter-fixed').addEventListener('change', (e) => { _filters.fixed = e.target.value; render(); });
    document.getElementById('tx-add').addEventListener('click', () => openEdit());
    document.getElementById('tx-export').addEventListener('click', exportCSV);
  };

  UI.subscribePage((p) => { if (p === 'transactions') { populateFilters(); render(); } });
  UI.subscribeMonth(() => { if (UI.currentPage() === 'transactions') render(); });

  return { render, init, openEdit, populateFilters };
})();
