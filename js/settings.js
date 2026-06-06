// ============================================================
//  Settings — backup, restore, demo data, reset
// ============================================================

const Settings = (() => {

  const exportBackup = async () => {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    U.downloadFile(`home-finance-backup-${new Date().toISOString().slice(0,10)}.json`, blob);
    UI.toast('הגיבוי הורד', 'success');
  };

  const importBackup = async (file) => {
    const ok = await UI.confirmDialog({
      title: 'שחזור מגיבוי',
      body: 'פעולה זו תחליף את כל הנתונים הקיימים. להמשיך?',
      confirmLabel: 'שחזור', danger: true,
    });
    if (!ok) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Re-hydrate dates
      data.transactions?.forEach(t => {
        if (t.date) t.date = new Date(t.date);
        if (t.chargeDate) t.chargeDate = new Date(t.chargeDate);
        if (t.createdAt) t.createdAt = new Date(t.createdAt);
      });
      await DB.importAll(data);
      Categorizer.reset();
      UI.toast('הנתונים שוחזרו', 'success');
      Dashboard.render();
    } catch (err) {
      console.error(err);
      UI.toast('שגיאה בשחזור: ' + err.message, 'error');
    }
  };

  const reset = async () => {
    const ok = await UI.confirmDialog({
      title: 'איפוס המערכת',
      body: 'פעולה זו תמחק את כל הנתונים — תנועות, חשבונות, קטגוריות בהתאמה אישית, תקציבים, וקבועים. אין דרך לשחזר ללא גיבוי. להמשיך?',
      confirmLabel: 'מחק את הכל', danger: true,
    });
    if (!ok) return;
    await DB.resetAll();
    Categorizer.reset();
    UI.toast('המערכת אותחלה', 'success');
    Dashboard.render();
  };

  const loadDemo = async () => {
    const ok = await UI.confirmDialog({
      title: 'טעינת נתוני דוגמה',
      body: 'יתווספו 3 חודשי תנועות לדוגמה ושני חשבונות. להמשיך?',
      confirmLabel: 'טען דוגמה',
    });
    if (!ok) return;

    const accs = await DB.accAll();
    let bankAcc = accs.find(a => a.type === 'bank');
    let cardAcc = accs.find(a => a.type === 'card');
    if (!bankAcc) bankAcc = await DB.accAdd({ name: 'לאומי עו"ש', type: 'bank', color: '#1e40af', lastBalance: 12000 });
    if (!cardAcc) cardAcc = await DB.accAdd({ name: 'ויזה כאל', type: 'card', color: '#6366f1', lastBalance: 0 });

    const cats = await DB.catAll();
    const catByName = Object.fromEntries(cats.map(c => [c.name, c]));
    const getCat = (n) => catByName[n]?.id || cats[0].id;

    // Recurring: salary, mortgage, electricity, internet
    const recurring = [
      { name: 'משכורת', type: 'income', amount: 18500, dayOfMonth: 10, categoryId: getCat('משכורת'), accountId: bankAcc.id, active: true },
      { name: 'משכנתא', type: 'expense', amount: 6200, dayOfMonth: 1, categoryId: getCat('משכנתא'), accountId: bankAcc.id, active: true },
      { name: 'חשמל', type: 'expense', amount: 480, dayOfMonth: 15, categoryId: getCat('חשמל'), accountId: bankAcc.id, active: true },
      { name: 'נטפליקס', type: 'expense', amount: 56, dayOfMonth: 7, categoryId: getCat('תקשורת'), accountId: cardAcc.id, active: true },
      { name: 'סלקום', type: 'expense', amount: 180, dayOfMonth: 20, categoryId: getCat('תקשורת'), accountId: bankAcc.id, active: true },
    ];
    for (const r of recurring) await DB.recAdd(r);

    // 3 months of varied transactions
    const today = new Date();
    const sampleExpenses = [
      ['שופרסל דיל סניף', 450, 'מזון וסופר'],
      ['רמי לוי שיווק', 720, 'מזון וסופר'],
      ['פז דלק', 280, 'דלק ותחבורה'],
      ['ארומה תל אביב', 38, 'מסעדות ובתי קפה'],
      ['Wolt תל אביב', 95, 'מסעדות ובתי קפה'],
      ['סופר פארם', 165, 'בריאות ותרופות'],
      ['קסטרו תל אביב', 320, 'ביגוד והנעלה'],
      ['ארנונה תל אביב', 950, 'ארנונה'],
      ['IKEA נתניה', 1450, 'בית וריהוט'],
      ['חברת חשמל', 480, 'חשמל'],
      ['ביט - אבי כהן', 250, 'העברות ותשלומים'],
      ['Spotify', 21, 'תקשורת'],
      ['Apple iCloud', 11, 'תקשורת'],
      ['פיצה דומינוס', 92, 'מסעדות ובתי קפה'],
    ];
    const newTxs = [];
    for (let m = 0; m < 3; m++) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - m, 1);
      // Salary
      newTxs.push({
        date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 10),
        description: 'משכורת חברה ב"מ',
        amount: 18500, type: 'income',
        categoryId: getCat('משכורת'), accountId: bankAcc.id, notes: '', source: 'demo',
      });
      // Mortgage
      newTxs.push({
        date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1),
        description: 'משכנתא — בנק מזרחי',
        amount: -6200, type: 'expense',
        categoryId: getCat('משכנתא'), accountId: bankAcc.id, source: 'demo',
      });
      // Random expenses
      for (let i = 0; i < 14; i++) {
        const sample = sampleExpenses[Math.floor(Math.random() * sampleExpenses.length)];
        const day = 1 + Math.floor(Math.random() * 27);
        const variance = 0.85 + Math.random() * 0.3;
        newTxs.push({
          date: new Date(monthDate.getFullYear(), monthDate.getMonth(), day),
          description: sample[0],
          amount: -Math.round(sample[1] * variance),
          type: 'expense',
          categoryId: getCat(sample[2]),
          accountId: Math.random() > 0.4 ? cardAcc.id : bankAcc.id,
          source: 'demo',
        });
      }
    }
    // An installment example
    const today_ = new Date();
    newTxs.push({
      date: new Date(today_.getFullYear(), today_.getMonth() - 1, 10),
      description: 'מקרר LG — תשלום 1/6',
      amount: -650, type: 'expense',
      categoryId: getCat('בית וריהוט'), accountId: cardAcc.id,
      installment: { current: 1, total: 6, totalAmount: 3900 },
      notes: 'תשלום 1 מתוך 6', source: 'demo',
    });
    newTxs.push({
      date: new Date(today_.getFullYear(), today_.getMonth(), 10),
      description: 'מקרר LG — תשלום 2/6',
      amount: -650, type: 'expense',
      categoryId: getCat('בית וריהוט'), accountId: cardAcc.id,
      installment: { current: 2, total: 6, totalAmount: 3900 },
      notes: 'תשלום 2 מתוך 6', source: 'demo',
    });

    newTxs.forEach(t => { t.dedupKey = DB.makeDedupKey(t); });
    await DB.txBulkAdd(newTxs);

    // A budget or two
    await DB.budgetSet(getCat('מזון וסופר'), 2500);
    await DB.budgetSet(getCat('מסעדות ובתי קפה'), 800);
    await DB.budgetSet(getCat('דלק ותחבורה'), 1200);

    UI.toast(`נטענו ${newTxs.length} תנועות + ${recurring.length} קבועים + 3 תקציבים`, 'success');
    Dashboard.render();
  };

  const updateAiStatus = async () => {
    const k = await AIService.getApiKey();
    const el = document.getElementById('settings-ai-status');
    if (!el) return;
    if (k) {
      el.textContent = `✓ מפתח שמור (...${k.slice(-6)}). פלטת ה-AI פעילה.`;
      el.style.color = '#4ade80';
    } else {
      el.textContent = '⚠ לא הוגדר מפתח. שאלות AI לא יעבדו.';
      el.style.color = 'var(--muted)';
    }
  };

  const init = () => {
    document.getElementById('settings-export').addEventListener('click', exportBackup);
    document.getElementById('settings-import').addEventListener('change', (e) => {
      if (e.target.files.length) { importBackup(e.target.files[0]); e.target.value = ''; }
    });
    document.getElementById('settings-reset').addEventListener('click', reset);
    document.getElementById('settings-demo').addEventListener('click', loadDemo);

    document.getElementById('settings-ai-save').addEventListener('click', async () => {
      const inp = document.getElementById('settings-ai-key');
      const v = inp.value.trim();
      if (!v) { UI.toast('הזן מפתח', 'error'); return; }
      if (!v.startsWith('sk-ant-')) { UI.toast('המפתח צריך להתחיל ב-"sk-ant-"', 'error'); return; }
      await AIService.setApiKey(v);
      inp.value = '';
      UI.toast('מפתח נשמר', 'success');
      updateAiStatus();
    });
    document.getElementById('settings-ai-clear').addEventListener('click', async () => {
      const ok = await UI.confirmDialog({ title: 'מחיקת מפתח', body: 'למחוק את מפתח ה-AI?', confirmLabel: 'מחק', danger: true });
      if (!ok) return;
      await AIService.clearApiKey();
      UI.toast('המפתח נמחק', 'success');
      updateAiStatus();
    });
    document.getElementById('settings-classify').addEventListener('click', async () => {
      UI.toast('מסווג...', '');
      const n = await Categorizer.autoClassifyAll();
      UI.toast(`${n} תנועות עודכנו`, 'success');
    });

    UI.subscribePage((p) => { if (p === 'settings') updateAiStatus(); });
  };

  return { init };
})();
