// ============================================================
//  Forecast engine
//  For each upcoming month, predicts:
//   - remaining installments from existing transactions
//   - recurring income/expenses (rules)
//   - average of recent months for "other" expenses (smoothed)
// ============================================================

const Forecast = (() => {

  // Build per-month projection of installments still outstanding
  // A purchased item with installments {current N of M, date D} will generate
  // future expense rows on the same day-of-month for the missing installments.
  const expandInstallments = (txs, monthsAhead) => {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastForecastMonth = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() + monthsAhead, 0);

    for (const t of txs) {
      const inst = t.installment;
      if (!inst || !inst.total || inst.total <= 1) continue;
      const start = t.date instanceof Date ? t.date : new Date(t.date);
      const perInstall = Math.abs(t.amount);
      // current = the installment number this transaction represents (already paid)
      const current = inst.current || 1;
      const remaining = inst.total - current;
      for (let i = 1; i <= remaining; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
        if (d < firstOfThisMonth) continue;
        if (d > lastForecastMonth) break;
        out.push({
          date: d,
          amount: -perInstall,
          type: 'expense',
          accountId: t.accountId,
          categoryId: t.categoryId,
          description: `${t.description} — תשלום ${current + i}/${inst.total}`,
          virtual: true,
          source: 'installment',
        });
      }
    }
    return out;
  };

  // Build per-month projection of recurring rules
  const expandRecurring = (rules, monthsAhead, fromMonth = null) => {
    const out = [];
    const today = new Date();
    const start = fromMonth || new Date(today.getFullYear(), today.getMonth(), 1);
    for (let m = 0; m < monthsAhead; m++) {
      const ym = new Date(start.getFullYear(), start.getMonth() + m, 1);
      for (const r of rules) {
        if (!r.active) continue;
        const day = Math.min(r.dayOfMonth || 1, new Date(ym.getFullYear(), ym.getMonth() + 1, 0).getDate());
        const d = new Date(ym.getFullYear(), ym.getMonth(), day);
        const isIncome = r.type === 'income';
        const amt = isIncome ? Math.abs(r.amount) : -Math.abs(r.amount);
        out.push({
          date: d,
          amount: amt,
          type: r.type,
          accountId: r.accountId,
          categoryId: r.categoryId,
          description: r.name,
          virtual: true,
          source: 'recurring',
          recurringId: r.id,
        });
      }
    }
    return out;
  };

  // Compute average monthly expenses (excluding installments to avoid double-count)
  // from the past N months, for "expected discretionary spend"
  const averageMonthlyExpense = (txs, monthsBack = 3) => {
    const today = new Date();
    const startBack = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const endLastMonth = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
    let sum = 0; let count = 0;
    const months = new Set();
    for (const t of txs) {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      if (d < startBack || d > endLastMonth) continue;
      if (t.type !== 'expense') continue;
      // Skip installments because we already project them
      if (t.installment && t.installment.total > 1) continue;
      // Skip recurring-source charges because we already project them
      if (t.recurringParentId) continue;
      sum += Math.abs(t.amount);
      months.add(U.ymKey(d));
    }
    const monthCount = Math.max(months.size, 1);
    return sum / monthCount;
  };

  // Build the full forecast model
  const build = async ({ monthsAhead = 12 } = {}) => {
    const [txs, rules, accounts] = await Promise.all([
      DB.txAll(), DB.recAll(), DB.accAll()
    ]);

    const today = new Date();
    const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Build initial balances: sum of bank-account balances
    let openingBalance = 0;
    for (const a of accounts) {
      if (a.type === 'bank') {
        openingBalance += (a.lastBalance || 0);
      }
    }
    // If we don't have explicit balances, derive net of all past transactions for bank accounts
    if (!openingBalance) {
      const bankAccIds = new Set(accounts.filter(a => a.type === 'bank').map(a => a.id));
      for (const t of txs) {
        if (bankAccIds.has(t.accountId)) {
          const d = t.date instanceof Date ? t.date : new Date(t.date);
          if (d < firstOfThisMonth) openingBalance += t.amount;
        }
      }
    }

    const installmentProjections = expandInstallments(txs, monthsAhead);
    const recurringProjections = expandRecurring(rules, monthsAhead, firstOfThisMonth);
    const avgDiscretionary = averageMonthlyExpense(txs, 3);

    // Per-month rollup
    const months = [];
    let cumulative = openingBalance;

    for (let m = 0; m < monthsAhead; m++) {
      const ym = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() + m, 1);
      const key = U.ymKey(ym);

      const installments = installmentProjections.filter(t => U.ymKey(t.date) === key);
      const recurring = recurringProjections.filter(t => U.ymKey(t.date) === key);
      const actuals = txs.filter(t => U.ymKey(t.date) === key);

      // For current month: keep actuals AND add expected remaining (recurring not yet paid, etc.)
      let income = 0, installSum = 0, recurringExpense = 0, otherExpense = 0;

      if (m === 0) {
        // Use actuals so far + remaining recurring for the month + remaining installments
        actuals.forEach(t => {
          if (t.type === 'income') income += t.amount;
          else otherExpense += Math.abs(t.amount);
        });
        // Don't double count: installments included in actuals already; only add NOT-yet-paid
        installments.forEach(t => { installSum += Math.abs(t.amount); });
        recurring.forEach(t => {
          // Has a recurring tx already happened this month for the same rule?
          const already = actuals.find(a => a.recurringParentId === t.recurringId);
          if (!already) {
            if (t.type === 'income') income += t.amount;
            else recurringExpense += Math.abs(t.amount);
          }
        });
      } else {
        recurring.forEach(t => {
          if (t.type === 'income') income += t.amount;
          else recurringExpense += Math.abs(t.amount);
        });
        installments.forEach(t => { installSum += Math.abs(t.amount); });
        // Expected discretionary (smoothed)
        otherExpense += avgDiscretionary;
      }

      const totalExpense = installSum + recurringExpense + otherExpense;
      const net = income - totalExpense;
      cumulative += net;

      months.push({
        date: ym,
        key,
        label: U.fmtMonth(ym),
        labelShort: U.fmtMonthShort(ym),
        income,
        installments: installSum,
        recurring: recurringExpense,
        other: otherExpense,
        totalExpense,
        net,
        cumulative,
        isPast: false,
        isCurrent: m === 0,
      });
    }

    return {
      openingBalance,
      avgDiscretionary,
      months,
      installmentProjections,
      recurringProjections,
    };
  };

  return { build, expandInstallments, expandRecurring };
})();
