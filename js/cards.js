// ============================================================
//  Cards & Accounts page
// ============================================================

const Cards = (() => {

  const render = async () => {
    const [accs, txs] = await Promise.all([DB.accAll(), DB.txAll()]);
    const grid = document.getElementById('accounts-grid');
    U.clearChildren(grid);

    accs.forEach(a => {
      const my = txs.filter(t => t.accountId === a.id);
      const thisMonth = U.ymKey(new Date());
      const monthExp = U.sum(my.filter(t => U.ymKey(t.date) === thisMonth && t.type === 'expense'), t => Math.abs(t.amount));
      const monthInc = U.sum(my.filter(t => U.ymKey(t.date) === thisMonth && t.type === 'income'), t => t.amount);

      // For a credit card: "open" installments
      const openInstallments = my.filter(t => t.installment && t.installment.total > 1);
      let openSum = 0;
      openInstallments.forEach(t => {
        const left = (t.installment.total - (t.installment.current || 1));
        if (left > 0) openSum += left * Math.abs(t.amount);
      });

      const totalBalance = (a.lastBalance || 0) + U.sum(my, t => t.amount);
      const card = U.el('div', { class: 'acc-card', style: { '--acc': a.color || '#6366f1' } }, [
        U.el('div', {}, [
          U.el('div', { class: 'acc-name' }, a.name),
          U.el('div', { class: 'acc-type' }, a.type === 'bank' ? 'חשבון עו"ש' : a.type === 'card' ? 'כרטיס אשראי' : 'אחר'),
        ]),
        U.el('div', {}, [
          U.el('div', { class: 'acc-balance' }, U.fmtILS(totalBalance, true)),
          U.el('div', { class: 'acc-stats' }, [
            U.el('span', {}, `החודש: ${U.fmtILS(monthExp)}`),
            a.type === 'card' && openSum > 0 ? U.el('span', {}, `תשלומים פתוחים: ${U.fmtILS(openSum)}`) : null,
          ].filter(Boolean)),
        ]),
        U.el('div', { class: 'acc-actions' }, [
          U.el('button', { class: 'btn-soft', onclick: () => openEdit(a) }, 'עריכה'),
          U.el('button', { class: 'btn-danger', onclick: () => deleteAccount(a) }, 'מחיקה'),
        ]),
      ]);
      grid.appendChild(card);
    });

    if (accs.length === 0) {
      grid.appendChild(U.el('div', { class: 'muted' }, 'אין חשבונות. הוסף חשבון חדש בלחצן למעלה.'));
    }
  };

  const openEdit = async (acc = null) => {
    const form = U.el('form');
    const nameInp = UI.inputText('name', acc?.name || '', { placeholder: 'לדוגמה: לאומי עו"ש / ויזה כאל' });
    const typeSel = UI.inputSelect('type', [
      { value: 'bank', label: 'עו"ש' },
      { value: 'card', label: 'כרטיס אשראי' },
      { value: 'savings', label: 'חיסכון' },
      { value: 'other', label: 'אחר' },
    ], acc?.type || 'card');
    const colorInp = U.el('input', { type: 'color', name: 'color', class: 'input', value: acc?.color || '#6366f1' });
    const balInp = UI.inputText('lastBalance', acc?.lastBalance || 0, { type: 'number', step: '0.01' });

    form.appendChild(UI.grid([
      UI.fullCol(UI.formField('שם', nameInp)),
      UI.formField('סוג', typeSel),
      UI.formField('צבע', colorInp),
      UI.fullCol(UI.formField('יתרת פתיחה (₪) — אופציונלי', balInp)),
    ]));

    const save = U.el('button', { class: 'btn', onclick: async (e) => {
      e.preventDefault();
      const data = UI.collectForm(form);
      if (!data.name) { UI.toast('יש למלא שם', 'error'); return; }
      const payload = { name: data.name, type: data.type, color: data.color, lastBalance: +data.lastBalance || 0 };
      if (acc) await DB.accUpdate(acc.id, payload);
      else await DB.accAdd(payload);
      UI.toast('נשמר', 'success');
      closeModal();
      await Transactions.populateFilters();
      await Upload.refreshAccountSelects();
      render();
    }}, 'שמירה');
    const cancel = U.el('button', { class: 'btn-soft', onclick: (e) => { e.preventDefault(); closeModal(); } }, 'ביטול');
    let closeModal = UI.openModal({ title: acc ? 'עריכת חשבון' : 'חשבון חדש', body: form, footer: [cancel, save] });
  };

  const deleteAccount = async (acc) => {
    const ok = await UI.confirmDialog({
      title: 'מחיקת חשבון',
      body: `למחוק את "${acc.name}"? תנועות המקושרות לחשבון יישארו אך ללא שיוך.`,
      confirmLabel: 'מחיקה', danger: true,
    });
    if (!ok) return;
    await DB.accDelete(acc.id);
    UI.toast('נמחק', 'success');
    render();
  };

  const init = () => {
    document.getElementById('acc-add').addEventListener('click', () => openEdit());
  };

  UI.subscribePage((p) => { if (p === 'cards') render(); });

  return { render, init, openEdit };
})();
