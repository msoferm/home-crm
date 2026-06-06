// ============================================================
//  Dashboard view — KPIs, charts, insights
// ============================================================

const Dashboard = (() => {
  let charts = {};

  // ---- Chart defaults for dark theme + Hebrew ----
  const setupChartDefaults = () => {
    Chart.defaults.font.family = 'Heebo, Segoe UI, sans-serif';
    Chart.defaults.color = '#a2adc4';
    Chart.defaults.borderColor = '#2a3148';
    Chart.defaults.plugins.tooltip.rtl = true;
    Chart.defaults.plugins.tooltip.backgroundColor = '#1a2030';
    Chart.defaults.plugins.tooltip.borderColor = '#2a3148';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.titleColor = '#e8ecf5';
    Chart.defaults.plugins.tooltip.bodyColor = '#e8ecf5';
    Chart.defaults.plugins.legend.rtl = true;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = 14;
  };

  const destroyChart = (id) => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } };

  const drawCategoryChart = async (txs, cats) => {
    destroyChart('categories');
    const ctx = document.getElementById('chart-categories');
    if (!ctx) return;
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    const map = {};
    txs.filter(t => t.type === 'expense').forEach(t => {
      const k = t.categoryId || 'unknown';
      map[k] = (map[k] || 0) + Math.abs(t.amount);
    });
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (entries.length === 0) {
      // Render an empty-state doughnut to keep the canvas alive for future renders
      charts.categories = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['אין הוצאות בחודש זה'], datasets: [{ data: [1], backgroundColor: ['#2a3148'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: { enabled: false } } },
      });
      return;
    }
    charts.categories = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: entries.map(([id]) => catById[id]?.name || 'אחר'),
        datasets: [{
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map(([id]) => catById[id]?.color || '#6b7280'),
          borderColor: '#1a2030',
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${U.fmtILS(ctx.parsed)}`,
            },
          },
        },
      },
    });
  };

  const drawFlowChart = async (allTxs) => {
    destroyChart('flow');
    const ctx = document.getElementById('chart-flow');
    if (!ctx) return;
    // 12 months ending at current month
    const today = new Date();
    const labels = [];
    const inData = [];
    const outData = [];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(today.getFullYear(), today.getMonth() - i, 1);
      labels.push(U.fmtMonthShort(m));
      const key = U.ymKey(m);
      let inc = 0, exp = 0;
      allTxs.forEach(t => {
        if (U.ymKey(t.date) !== key) return;
        if (t.type === 'income') inc += t.amount;
        else exp += Math.abs(t.amount);
      });
      inData.push(Math.round(inc));
      outData.push(Math.round(exp));
    }
    charts.flow = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'הכנסות', data: inData, backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 6 },
          { label: 'הוצאות', data: outData, backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { callback: (v) => U.fmtILS(v) },
          },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${U.fmtILS(ctx.parsed.y)}` } },
        },
      },
    });
  };

  const drawForecastChart = async (canvasId, fc) => {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const labels = fc.months.map(m => m.labelShort);
    const income = fc.months.map(m => Math.round(m.income));
    const expense = fc.months.map(m => -Math.round(m.totalExpense));
    const cumulative = fc.months.map(m => Math.round(m.cumulative));
    charts[canvasId] = new Chart(ctx, {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'הכנסות צפויות', data: income, backgroundColor: 'rgba(16,185,129,0.65)', borderRadius: 6, yAxisID: 'y' },
          { type: 'bar', label: 'הוצאות צפויות', data: expense, backgroundColor: 'rgba(239,68,68,0.65)', borderRadius: 6, yAxisID: 'y' },
          { type: 'line', label: 'מאזן מצטבר', data: cumulative, borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.18)', borderWidth: 2.5, pointRadius: 3, tension: 0.35, yAxisID: 'y2', fill: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: { stacked: false, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: (v) => U.fmtILS(v) } },
          y2: { position: 'left', grid: { drawOnChartArea: false }, ticks: { callback: (v) => U.fmtILS(v) } },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${U.fmtILS(ctx.parsed.y)}` } },
        },
      },
    });
  };

  const renderRecent = async (allTxs, cats, accs) => {
    const tbody = document.getElementById('dash-recent');
    U.clearChildren(tbody);
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    const accById = Object.fromEntries(accs.map(a => [a.id, a]));
    const recent = [...allTxs].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
    recent.forEach(t => {
      const cat = catById[t.categoryId];
      const tr = U.el('tr', {}, [
        U.el('td', {}, U.fmtDate(t.date)),
        U.el('td', {}, t.description),
        U.el('td', {}, U.el('span', { class: 'pill cat', style: { background: (cat?.color || '#6366f1') + '22', color: cat?.color || '#6366f1' } }, cat?.name || '—')),
        U.el('td', { class: 'num ' + (t.amount < 0 ? 'amt-out' : 'amt-in') }, U.fmtILS(t.amount, true)),
      ]);
      tbody.appendChild(tr);
    });
    if (recent.length === 0) {
      tbody.appendChild(U.el('tr', {}, U.el('td', { colspan: 4, class: 'muted', style: { textAlign: 'center', padding: '24px' } }, 'אין תנועות עדיין — העלה קובץ או הוסף תנועה ידנית')));
    }
  };

  const renderAccounts = async (accs, allTxs) => {
    const wrap = document.getElementById('dash-accounts');
    U.clearChildren(wrap);
    const totalsByAcc = {};
    allTxs.forEach(t => { totalsByAcc[t.accountId] = (totalsByAcc[t.accountId] || 0) + t.amount; });
    accs.forEach(a => {
      const balance = (a.lastBalance || 0) + (totalsByAcc[a.id] || 0);
      wrap.appendChild(U.el('div', { class: 'account-row' }, [
        U.el('div', {}, [
          U.el('span', { class: 'acc-dot', style: { background: a.color || '#6366f1' } }),
          U.el('strong', {}, a.name),
          ' ',
          U.el('span', { class: 'muted' }, a.type === 'bank' ? 'בנק' : 'כרטיס'),
        ]),
        U.el('div', { class: balance < 0 ? 'amt-out' : 'amt-in' }, U.fmtILS(balance, true)),
      ]));
    });
    if (accs.length === 0) {
      wrap.appendChild(U.el('div', { class: 'muted' }, 'אין חשבונות. הוסף בטאב "כרטיסים וחשבונות".'));
    }
  };

  const renderBudgets = async (cats, monthTxs) => {
    const wrap = document.getElementById('dash-budgets');
    U.clearChildren(wrap);
    const budgets = await DB.budgetAll();
    if (!budgets.length) {
      wrap.appendChild(U.el('div', { class: 'muted' }, 'אין תקציבים. קבע בטאב "תקציבים".'));
      return;
    }
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    const usedByCat = {};
    monthTxs.filter(t => t.type === 'expense').forEach(t => {
      usedByCat[t.categoryId] = (usedByCat[t.categoryId] || 0) + Math.abs(t.amount);
    });
    budgets.sort((a, b) => (usedByCat[b.categoryId] || 0) / (b.monthlyLimit || 1) - (usedByCat[a.categoryId] || 0) / (a.monthlyLimit || 1));
    budgets.slice(0, 6).forEach(b => {
      const cat = catById[b.categoryId];
      if (!cat) return;
      const used = usedByCat[b.categoryId] || 0;
      const pct = Math.min(100, Math.round((used / b.monthlyLimit) * 100));
      const cls = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : '';
      wrap.appendChild(U.el('div', { class: 'budget-row' }, [
        U.el('div', { class: 'b-top' }, [
          U.el('div', { class: 'b-name' }, [cat.icon + ' ' + cat.name]),
          U.el('div', { class: 'b-val' }, `${U.fmtILS(used)} / ${U.fmtILS(b.monthlyLimit)} (${pct}%)`),
        ]),
        U.el('div', { class: 'bar' }, U.el('div', { class: 'bar-fill ' + cls, style: { width: pct + '%' } })),
      ]));
    });
  };

  const renderInsights = async (allTxs, monthTxs, cats, fc) => {
    const wrap = document.getElementById('dash-insights');
    U.clearChildren(wrap);
    const insights = [];

    // Fixed vs variable breakdown for the current month
    const fixedSum = U.sum(monthTxs.filter(t => t.type === 'expense' && t.fixedOrVariable === 'fixed'), t => Math.abs(t.amount));
    const varSum = U.sum(monthTxs.filter(t => t.type === 'expense' && t.fixedOrVariable === 'variable'), t => Math.abs(t.amount));
    const totalClassified = fixedSum + varSum;
    if (totalClassified > 0) {
      const fixedPct = Math.round((fixedSum / totalClassified) * 100);
      insights.push(`🔁 הוצאות קבועות: ${U.fmtILS(fixedSum)} (${fixedPct}%) • ◆ מזדמנות: ${U.fmtILS(varSum)} (${100 - fixedPct}%)`);
    }

    // Insight 1: month-over-month change
    const today = new Date();
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevKey = U.ymKey(prevMonth);
    let prevExp = 0;
    allTxs.forEach(t => {
      if (U.ymKey(t.date) === prevKey && t.type === 'expense') prevExp += Math.abs(t.amount);
    });
    const thisExp = U.sum(monthTxs.filter(t => t.type === 'expense'), t => Math.abs(t.amount));
    if (prevExp > 0) {
      const diff = thisExp - prevExp;
      const pct = Math.round((diff / prevExp) * 100);
      const sign = diff > 0 ? '⬆️' : '⬇️';
      insights.push(`${sign} ההוצאות החודש ${diff > 0 ? 'גבוהות' : 'נמוכות'} ב-${Math.abs(pct)}% מהחודש שעבר (${U.fmtILS(Math.abs(diff))})`);
    }

    // Insight 2: top category
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    const byCat = {};
    monthTxs.filter(t => t.type === 'expense').forEach(t => { byCat[t.categoryId] = (byCat[t.categoryId] || 0) + Math.abs(t.amount); });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const c = catById[top[0]];
      insights.push(`🏆 קטגוריה מובילה החודש: ${c?.icon || ''} ${c?.name || ''} — ${U.fmtILS(top[1])}`);
    }

    // Insight 3: forecast warning
    const negMonth = fc?.months?.find(m => m.cumulative < 0);
    if (negMonth) {
      insights.push(`⚠️ לפי הצפי, המאזן ייכנס לאדום ב-${negMonth.label}`);
    } else if (fc?.months?.length) {
      const last = fc.months[fc.months.length - 1];
      insights.push(`✅ הצפי ל-12 חודשים: מאזן מצטבר ${U.fmtILS(last.cumulative, true)}`);
    }

    // Insight 4: upcoming installments
    const totalUpcomingInstall = U.sum(fc?.installmentProjections || [], t => Math.abs(t.amount));
    if (totalUpcomingInstall > 0) {
      insights.push(`💳 סה"כ תשלומים עתידיים פתוחים: ${U.fmtILS(totalUpcomingInstall)}`);
    }

    if (insights.length === 0) {
      wrap.appendChild(U.el('div', { class: 'muted' }, 'אין מספיק נתונים לתובנות עדיין.'));
      return;
    }
    insights.forEach(text => {
      wrap.appendChild(U.el('div', { class: 'insight-row' }, text));
    });
  };

  const render = async () => {
    setupChartDefaults();
    const month = UI.activeMonth();
    document.getElementById('cat-chart-sub').textContent = U.fmtMonth(month);
    const [allTxs, cats, accs] = await Promise.all([DB.txAll(), DB.catAll(), DB.accAll()]);
    const { start, end } = U.monthRange(month);
    const monthTxs = allTxs.filter(t => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= start && d <= end;
    });
    const income = U.sum(monthTxs.filter(t => t.type === 'income'), t => t.amount);
    const expense = U.sum(monthTxs.filter(t => t.type === 'expense'), t => Math.abs(t.amount));
    const balance = income - expense;
    document.getElementById('kpi-income').textContent = U.fmtILS(income);
    document.getElementById('kpi-income-sub').textContent = `${monthTxs.filter(t => t.type === 'income').length} תנועות`;
    document.getElementById('kpi-expense').textContent = U.fmtILS(expense);
    document.getElementById('kpi-expense-sub').textContent = `${monthTxs.filter(t => t.type === 'expense').length} תנועות`;
    document.getElementById('kpi-balance').textContent = U.fmtILS(balance, true);
    document.getElementById('kpi-balance').className = 'kpi-value ' + (balance < 0 ? 'amt-out' : 'amt-in');

    // Forecast for upcoming projections
    const fc = await Forecast.build({ monthsAhead: 12 });
    const upcoming = U.sum(fc.installmentProjections, t => Math.abs(t.amount));
    document.getElementById('kpi-upcoming').textContent = U.fmtILS(upcoming);
    document.getElementById('kpi-upcoming-sub').textContent = `${fc.installmentProjections.length} תשלומים פתוחים`;

    await Promise.all([
      drawCategoryChart(monthTxs, cats),
      drawFlowChart(allTxs),
      drawForecastChart('chart-forecast', { months: fc.months.slice(0, 6) }),
      renderRecent(allTxs, cats, accs),
      renderAccounts(accs, allTxs),
      renderBudgets(cats, monthTxs),
      renderInsights(allTxs, monthTxs, cats, fc),
    ]);
  };

  // Re-render when current page is dashboard
  UI.subscribePage((p) => { if (p === 'dashboard') render(); });
  UI.subscribeMonth(() => { if (UI.currentPage() === 'dashboard') render(); });

  return { render, drawForecastChart };
})();
