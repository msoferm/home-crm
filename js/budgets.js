// ============================================================
//  Budgets page
// ============================================================

const Budgets = (() => {

  const render = async () => {
    const [budgets, cats, txs] = await Promise.all([DB.budgetAll(), DB.catAll(), DB.txAll()]);
    const month = UI.activeMonth();
    const { start, end } = U.monthRange(month);
    const monthTxs = txs.filter(t => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= start && d <= end && t.type === 'expense';
    });
    const usedByCat = {};
    monthTxs.forEach(t => { usedByCat[t.categoryId] = (usedByCat[t.categoryId] || 0) + Math.abs(t.amount); });
    const budgetByCat = Object.fromEntries(budgets.map(b => [b.categoryId, b]));

    const tbody = document.getElementById('budget-tbody');
    U.clearChildren(tbody);
    cats.filter(c => c.type !== 'income').forEach(c => {
      const b = budgetByCat[c.id];
      const used = usedByCat[c.id] || 0;
      const limit = b?.monthlyLimit || 0;
      const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
      const cls = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : '';
      const inp = U.el('input', { type: 'number', class: 'input', value: limit || '', step: '50', style: { width: '120px' }, placeholder: 'ללא תקציב' });
      inp.addEventListener('change', async () => {
        const v = +inp.value || 0;
        if (v > 0) await DB.budgetSet(c.id, v);
        else await DB.budgetDelete(c.id);
        render();
      });
      const tr = U.el('tr', {}, [
        U.el('td', {}, U.el('span', { class: 'pill cat', style: { background: c.color + '22', color: c.color } }, `${c.icon || ''} ${c.name}`)),
        U.el('td', { class: 'num' }, inp),
        U.el('td', { class: 'num' }, U.fmtILS(used)),
        U.el('td', { style: { minWidth: '180px' } }, [
          U.el('div', { class: 'bar' }, U.el('div', { class: 'bar-fill ' + cls, style: { width: Math.min(pct, 100) + '%' } })),
          U.el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } }, limit > 0 ? `${pct}% מהתקציב` : '—'),
        ]),
        U.el('td', {}, limit > 0 ? U.el('button', { class: 'btn-soft', style: { padding: '4px 10px', fontSize: '12px' }, onclick: async () => { await DB.budgetDelete(c.id); render(); } }, 'הסר') : ''),
      ]);
      tbody.appendChild(tr);
    });
  };

  UI.subscribePage((p) => { if (p === 'budgets') render(); });
  UI.subscribeMonth(() => { if (UI.currentPage() === 'budgets') render(); });

  return { render };
})();
