// ============================================================
//  App entry — wires everything together
// ============================================================

const ForecastPage = (() => {

  const render = async () => {
    const fc = await Forecast.build({ monthsAhead: 12 });

    Dashboard.drawForecastChart('chart-forecast-big', fc);

    const tbody = document.getElementById('forecast-tbody');
    U.clearChildren(tbody);
    fc.months.forEach((m, i) => {
      const tr = U.el('tr', {}, [
        U.el('td', {}, [m.label, m.isCurrent ? U.el('span', { class: 'pill info', style: { marginRight: '6px' } }, 'נוכחי') : null].filter(Boolean)),
        U.el('td', { class: 'num amt-in' }, U.fmtILS(m.income)),
        U.el('td', { class: 'num amt-out' }, U.fmtILS(m.installments)),
        U.el('td', { class: 'num amt-out' }, U.fmtILS(m.recurring + m.other)),
        U.el('td', { class: 'num amt-out' }, U.fmtILS(m.totalExpense)),
        U.el('td', { class: 'num ' + (m.net < 0 ? 'amt-out' : 'amt-in') }, U.fmtILS(m.net, true)),
        U.el('td', { class: 'num ' + (m.cumulative < 0 ? 'amt-out' : 'amt-in') }, U.fmtILS(m.cumulative, true)),
      ]);
      tbody.appendChild(tr);
    });
  };

  UI.subscribePage((p) => { if (p === 'forecast') render(); });

  return { render };
})();

// ============================================================
//  Bootstrap
// ============================================================
(async function bootstrap() {
  try {
    await DB.init();
    // Navigation links
    document.querySelectorAll('.nav-item').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        UI.navigate(a.dataset.page);
      });
    });
    // Quick add
    document.getElementById('btn-quick-add').addEventListener('click', () => Transactions.openEdit());

    // Init module event handlers
    Transactions.init();
    Cards.init();
    Categories.init();
    Recurring.init();
    Upload.init();
    Settings.init();
    AuthUI.init();

    UI.initMonthPicker();
    await Transactions.populateFilters();

    // First page
    UI.navigate('dashboard');
  } catch (err) {
    console.error('Bootstrap failed:', err);
    document.body.innerHTML = `<div style="padding:40px;font-family:Heebo,sans-serif;direction:rtl">
      <h2 style="color:#f87171">שגיאה בהפעלת המערכת</h2>
      <pre style="background:#1a2030;padding:16px;border-radius:8px;color:#fbbf24;overflow:auto">${err.stack || err.message}</pre>
      <p style="color:#a2adc4">פתח את הקונסול (F12) למידע נוסף.</p>
    </div>`;
  }
})();
