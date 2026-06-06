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
      const networkLabel = ({ visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', isracard: 'Isracard', diners: 'Diners' })[a.network] || '';
      const subParts = [];
      if (a.type === 'card') {
        subParts.push(networkLabel || 'כרטיס אשראי');
        if (a.last4Digits) subParts.push(`•••• ${a.last4Digits}`);
        if (a.issuer) subParts.push(a.issuer);
      } else if (a.type === 'bank') subParts.push('חשבון עו"ש');
      else if (a.type === 'savings') subParts.push('חיסכון');
      else subParts.push('אחר');
      const card = U.el('div', { class: 'acc-card', style: { '--acc': a.color || '#6366f1' } }, [
        U.el('div', {}, [
          U.el('div', { class: 'acc-name' }, a.name),
          U.el('div', { class: 'acc-type' }, subParts.join(' • ')),
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
    const nameInp = UI.inputText('name', acc?.name || '', { placeholder: 'לדוגמה: ויזה כאל / לאומי עו"ש' });
    const typeSel = UI.inputSelect('type', [
      { value: 'card', label: 'כרטיס אשראי' },
      { value: 'bank', label: 'עו"ש' },
      { value: 'savings', label: 'חיסכון' },
      { value: 'other', label: 'אחר' },
    ], acc?.type || 'card');
    const networkSel = UI.inputSelect('network', [
      { value: '', label: '—' },
      { value: 'visa', label: 'Visa' },
      { value: 'mastercard', label: 'Mastercard' },
      { value: 'amex', label: 'American Express' },
      { value: 'isracard', label: 'Isracard' },
      { value: 'diners', label: 'Diners' },
    ], acc?.network || '');
    const last4Inp = UI.inputText('last4Digits', acc?.last4Digits || '', { placeholder: '1234', type: 'text' });
    last4Inp.setAttribute('inputmode', 'numeric');
    last4Inp.setAttribute('maxlength', '4');
    last4Inp.setAttribute('pattern', '\\d{4}');
    const issuerInp = UI.inputText('issuer', acc?.issuer || '', { placeholder: 'בנק/חברה (אופציונלי, לדוגמה: לאומי קארד)' });
    const colorInp = U.el('input', { type: 'color', name: 'color', class: 'input', value: acc?.color || '#6366f1' });
    const balInp = UI.inputText('lastBalance', acc?.lastBalance || 0, { type: 'number', step: '0.01' });

    // Card-only fields visibility toggle
    const cardFields = U.el('div', { class: 'card-only-fields' }, [
      UI.formField('רשת', networkSel),
      UI.formField('4 ספרות אחרונות', last4Inp),
      UI.fullCol(UI.formField('מנפיק (אופציונלי)', issuerInp)),
    ]);
    const updateVisibility = () => {
      cardFields.style.display = typeSel.value === 'card' ? '' : 'none';
    };
    typeSel.addEventListener('change', updateVisibility);
    setTimeout(updateVisibility, 0);

    form.appendChild(UI.grid([
      UI.fullCol(UI.formField('שם', nameInp)),
      UI.formField('סוג', typeSel),
      UI.formField('צבע', colorInp),
      UI.fullCol(cardFields),
      UI.fullCol(UI.formField('יתרת פתיחה (₪) — אופציונלי', balInp)),
    ]));

    const save = U.el('button', { class: 'btn', onclick: async (e) => {
      e.preventDefault();
      const data = UI.collectForm(form);
      if (!data.name) { UI.toast('יש למלא שם', 'error'); return; }
      // Validate last4Digits if provided
      const last4 = (data.last4Digits || '').replace(/\D/g, '').slice(0, 4);
      if (data.type === 'card' && data.last4Digits && last4.length !== 4) {
        UI.toast('4 הספרות חייבות להיות 4 ספרות', 'error'); return;
      }
      const payload = {
        name: data.name, type: data.type, color: data.color,
        lastBalance: +data.lastBalance || 0,
        last4Digits: last4 || null,
        network: data.network || null,
        issuer: data.issuer || null,
      };
      if (acc) await DB.accUpdate(acc.id, payload);
      else await DB.accAdd(payload);
      UI.toast('נשמר', 'success');
      closeModal();
      await Transactions.populateFilters();
      if (window.Upload) await Upload.refreshAccountSelects();
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
