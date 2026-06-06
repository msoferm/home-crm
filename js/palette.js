// ============================================================
//  Command Palette — Ctrl+K natural-language commands.
//  Local intent matching for common queries + AI fallback.
// ============================================================

const Palette = (() => {

  let _selectedIdx = 0;
  let _results = []; // [{ icon, title, sub, run, data }]
  let _open = false;

  const open = () => {
    _open = true;
    document.getElementById('palette-backdrop').classList.remove('hidden');
    const inp = document.getElementById('palette-input');
    inp.value = '';
    setTimeout(() => inp.focus(), 50);
    renderResults('');
  };
  const close = () => {
    _open = false;
    document.getElementById('palette-backdrop').classList.add('hidden');
    document.getElementById('palette-input').value = '';
    U.clearChildren(document.getElementById('palette-results'));
    _results = []; _selectedIdx = 0;
  };

  // ---- Intent matchers ----
  // Each matcher takes the lower-cased question and returns either:
  //   null (no match) | { icon, title, sub, run, data }
  // run() executes the action and returns a `result` (text/data to display)

  const norm = (s) => String(s || '').replace(/[״״׳′‘’`]/g, '"').toLowerCase().trim();

  // Time-window parser: returns { start, end, label }
  const parseTimeWindow = (q) => {
    const now = new Date();
    if (/החודש שעבר|חודש שעבר/.test(q)) {
      const m = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const r = U.monthRange(m);
      return { ...r, label: U.fmtMonth(m) };
    }
    if (/השבוע/.test(q)) {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { start: d, end: now, label: 'שבוע אחרון' };
    }
    if (/השנה/.test(q)) {
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear(), 11, 31, 23, 59, 59),
        label: `שנת ${now.getFullYear()}`,
      };
    }
    if (/השנה שעברה/.test(q)) {
      return {
        start: new Date(now.getFullYear() - 1, 0, 1),
        end: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59),
        label: `שנת ${now.getFullYear() - 1}`,
      };
    }
    if (/השנתיים/.test(q)) {
      return { start: U.addMonths(now, -24), end: now, label: 'שנתיים אחרונות' };
    }
    if (/(\d+)\s*חודשים/.test(q)) {
      const n = +q.match(/(\d+)\s*חודשים/)[1];
      return { start: U.addMonths(now, -n), end: now, label: `${n} חודשים אחרונים` };
    }
    if (/אי פעם|תמיד|כל הזמן/.test(q)) {
      return { start: new Date(2000, 0, 1), end: now, label: 'כל הזמן' };
    }
    // default: this month
    const r = U.monthRange(now);
    return { ...r, label: U.fmtMonth(now) };
  };

  // Extract a "merchant" keyword: phrase after "ב" / "על" / "אצל" / "ב<X>"
  const extractMerchant = (q) => {
    // Try: "כמה הוצאתי ב<X>" or "על <X>" or "אצל <X>"
    let m = q.match(/(?:ב|על|אצל)\s+([א-ת'"-\w\s]{2,40}?)(?:\s+(?:החודש|השבוע|השנה|חודש|שעבר|אי פעם)|$)/);
    if (m) return m[1].trim().replace(/[?!.,]+$/, '');
    m = q.match(/(?:ב|על|אצל)([א-ת]{2,20})/); // attached
    if (m) return m[1].trim();
    return null;
  };

  // INTENT: how much did I spend [on X] [in time]
  const intentSpendingTotal = async (q) => {
    if (!/(כמה|סך|סכום)\s*(הוצא|שילמ|בזב)/.test(q) && !/^(כמה הוצא|כמה שילמ)/.test(q)) return null;
    const tw = parseTimeWindow(q);
    const merchant = extractMerchant(q);
    const allTxs = await DB.txAll();
    let txs = allTxs.filter(t => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= tw.start && d <= tw.end && t.type === 'expense';
    });
    if (merchant) {
      const mNorm = norm(merchant);
      txs = txs.filter(t => norm(t.description).includes(mNorm));
    }
    const total = U.sum(txs, t => Math.abs(t.amount));
    const sub = merchant
      ? `הוצאות ב"${merchant}" — ${tw.label}`
      : `סך הוצאות — ${tw.label}`;
    return {
      icon: '💸',
      title: 'סך הוצאות',
      sub,
      data: { kind: 'sum', total, count: txs.length, txs: txs.slice(0, 10).map(t => ({
        date: U.fmtDate(t.date), desc: t.description, amt: t.amount,
      })) },
      run: async () => ({ kind: 'sum', total, count: txs.length, label: sub }),
    };
  };

  // INTENT: how much did I earn / income
  const intentIncome = async (q) => {
    if (!/(הכנסה|הכנסות|הרווחתי|קיבלתי)/.test(q)) return null;
    const tw = parseTimeWindow(q);
    const allTxs = await DB.txAll();
    const txs = allTxs.filter(t => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= tw.start && d <= tw.end && t.type === 'income';
    });
    const total = U.sum(txs, t => t.amount);
    return {
      icon: '💰', title: 'סך הכנסות', sub: tw.label,
      data: { kind: 'sum', total, count: txs.length },
      run: async () => ({ kind: 'sum', total, count: txs.length, label: 'הכנסות — ' + tw.label }),
    };
  };

  // INTENT: top categories / breakdown
  const intentTopCategories = async (q) => {
    if (!/(לפי קטגוריה|פילוח|הכי הרבה|חלוקה|רוב הכסף|איפה הכסף)/.test(q)) return null;
    const tw = parseTimeWindow(q);
    const [txs, cats] = await Promise.all([DB.txAll(), DB.catAll()]);
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    const monthTxs = txs.filter(t => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= tw.start && d <= tw.end && t.type === 'expense';
    });
    const byCat = {};
    monthTxs.forEach(t => { byCat[t.categoryId] = (byCat[t.categoryId] || 0) + Math.abs(t.amount); });
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, v]) => ({
      name: catById[id]?.name || 'לא מסווג', total: v,
    }));
    return {
      icon: '📊', title: 'פילוח לפי קטגוריה', sub: tw.label,
      data: { kind: 'breakdown', rows },
      run: async () => ({ kind: 'breakdown', rows, label: tw.label }),
    };
  };

  // INTENT: fixed vs variable
  const intentFixedVariable = async (q) => {
    if (!/(קבועות|מזדמנות|קבועה|מזדמנת|fixed|variable)/.test(q)) return null;
    const tw = parseTimeWindow(q);
    const txs = await DB.txAll();
    const monthTxs = txs.filter(t => {
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= tw.start && d <= tw.end && t.type === 'expense';
    });
    const fixed = U.sum(monthTxs.filter(t => t.fixedOrVariable === 'fixed'), t => Math.abs(t.amount));
    const variable = U.sum(monthTxs.filter(t => t.fixedOrVariable === 'variable'), t => Math.abs(t.amount));
    return {
      icon: '🔁', title: 'קבועות vs מזדמנות', sub: tw.label,
      data: { kind: 'fv', fixed, variable },
      run: async () => ({ kind: 'fv', fixed, variable, label: tw.label }),
    };
  };

  // INTENT: balance
  const intentBalance = async (q) => {
    if (!/(מאזן|יתרה|כמה כסף יש|כמה נשאר)/.test(q)) return null;
    const [txs, accs] = await Promise.all([DB.txAll(), DB.accAll()]);
    const rows = accs.map(a => {
      const my = txs.filter(t => t.accountId === a.id);
      const total = (a.lastBalance || 0) + U.sum(my, t => t.amount);
      return { name: a.name + (a.last4Digits ? ` •••• ${a.last4Digits}` : ''), total };
    });
    const grand = U.sum(rows, r => r.total);
    return {
      icon: '🏦', title: 'מאזן חשבונות', sub: `${rows.length} חשבונות`,
      data: { kind: 'balance', rows, grand },
      run: async () => ({ kind: 'balance', rows, grand }),
    };
  };

  // INTENT: navigation
  const intentNavigate = async (q) => {
    const map = [
      { kw: /סקירה|דשבורד|בית/, page: 'dashboard', name: 'סקירה' },
      { kw: /תנועות|רשימת תנועות|הוצאות/, page: 'transactions', name: 'תנועות' },
      { kw: /כרטיסים|חשבונות/, page: 'cards', name: 'כרטיסים וחשבונות' },
      { kw: /צפי|תחזית/, page: 'forecast', name: 'צפי' },
      { kw: /קטגורי/, page: 'categories', name: 'קטגוריות' },
      { kw: /קבוע/, page: 'recurring', name: 'הוצאות קבועות' },
      { kw: /תקציב/, page: 'budgets', name: 'תקציבים' },
      { kw: /העלא|טען קובץ|ייבוא/, page: 'upload', name: 'העלאת קבצים' },
      { kw: /הגדרות/, page: 'settings', name: 'הגדרות' },
    ];
    if (!/^(פתח|עבור|לך|הצג|תראה)/.test(q)) return null;
    for (const { kw, page, name } of map) {
      if (kw.test(q)) {
        return {
          icon: '↗', title: `פתח עמוד: ${name}`, sub: 'ניווט מהיר',
          data: null,
          run: async () => { UI.navigate(page); close(); return null; },
        };
      }
    }
    return null;
  };

  // INTENT: recategorize / classify
  const intentRecategorize = async (q) => {
    if (!/(סווג מחדש|recategorize|לסווג)/.test(q)) return null;
    return {
      icon: '🔄', title: 'סווג מחדש את כל התנועות', sub: 'מריץ סיווג אוטומטי',
      data: null,
      run: async () => {
        const a = await Categorizer.recategorizeAll();
        const b = await Categorizer.autoClassifyAll();
        return { kind: 'text', text: `✓ ${a} תנועות עודכנו קטגוריה • ${b} תנועות סווגו ל-קבוע/מזדמן` };
      },
    };
  };

  // Suggestions to show when input is empty
  const defaultSuggestions = () => [
    { icon: '💸', title: 'כמה הוצאתי החודש?', sub: 'דוגמה', data: null, run: () => doQuery('כמה הוצאתי החודש') },
    { icon: '🛒', title: 'כמה הוצאתי בשופרסל השנה?', sub: 'דוגמה', data: null, run: () => doQuery('כמה הוצאתי בשופרסל השנה') },
    { icon: '📊', title: 'פילוח לפי קטגוריה החודש', sub: 'דוגמה', data: null, run: () => doQuery('פילוח לפי קטגוריה החודש') },
    { icon: '🔁', title: 'הוצאות קבועות vs מזדמנות', sub: 'דוגמה', data: null, run: () => doQuery('כמה קבועות vs מזדמנות החודש') },
    { icon: '🏦', title: 'מאזן כל החשבונות', sub: 'דוגמה', data: null, run: () => doQuery('מה המאזן') },
    { icon: '🔄', title: 'סווג מחדש את כל התנועות', sub: 'פעולה', data: null, run: () => doQuery('סווג מחדש') },
  ];

  const allIntents = [
    intentSpendingTotal, intentIncome, intentTopCategories,
    intentFixedVariable, intentBalance, intentNavigate, intentRecategorize,
  ];

  // Run all intent matchers and return matches
  const matchIntents = async (q) => {
    const out = [];
    for (const fn of allIntents) {
      try {
        const r = await fn(q);
        if (r) out.push(r);
      } catch (e) { console.warn('intent error', e); }
    }
    return out;
  };

  // ---- Rendering ----
  const renderResults = async (q) => {
    const wrap = document.getElementById('palette-results');
    U.clearChildren(wrap);
    const text = norm(q);
    _results = text ? await matchIntents(text) : defaultSuggestions();
    _selectedIdx = 0;
    if (!_results.length) {
      wrap.appendChild(U.el('div', { class: 'palette-result', style: { color: 'var(--muted)' } }, [
        U.el('div', { class: 'palette-result-head' }, [
          U.el('span', { class: 'palette-result-icon' }, '🤖'),
          U.el('span', { class: 'palette-result-title' }, 'אין התאמה מקומית — לחץ "שאל את ה-AI" למטה כדי לשלוח את השאלה ל-Claude'),
        ]),
      ]));
      return;
    }
    _results.forEach((r, i) => {
      const item = U.el('div', { class: 'palette-result' + (i === _selectedIdx ? ' selected' : ''), onclick: () => executeResult(i) }, [
        U.el('div', { class: 'palette-result-head' }, [
          U.el('span', { class: 'palette-result-icon' }, r.icon),
          U.el('div', {}, [
            U.el('div', { class: 'palette-result-title' }, r.title),
            r.sub ? U.el('div', { class: 'palette-result-sub' }, r.sub) : null,
          ].filter(Boolean)),
        ]),
        r.data ? renderResultData(r.data) : null,
      ].filter(Boolean));
      wrap.appendChild(item);
    });
  };

  const renderResultData = (data) => {
    if (!data) return null;
    if (data.kind === 'sum') {
      return U.el('div', { class: 'palette-result-data' }, [
        U.el('div', { class: 'big' }, U.fmtILS(data.total)),
        U.el('div', { class: 'muted', style: { marginTop: '4px' } }, `${data.count} תנועות`),
      ]);
    }
    if (data.kind === 'breakdown') {
      const wrap = U.el('div', { class: 'palette-result-data' });
      data.rows.forEach(r => wrap.appendChild(U.el('div', { class: 'mini-row' }, [
        U.el('span', {}, r.name),
        U.el('strong', {}, U.fmtILS(r.total)),
      ])));
      return wrap;
    }
    if (data.kind === 'fv') {
      const total = data.fixed + data.variable;
      const fp = total ? Math.round((data.fixed / total) * 100) : 0;
      return U.el('div', { class: 'palette-result-data' }, [
        U.el('div', { class: 'mini-row' }, [U.el('span', {}, '🔁 קבועות'), U.el('strong', {}, `${U.fmtILS(data.fixed)} (${fp}%)`)]),
        U.el('div', { class: 'mini-row' }, [U.el('span', {}, '◆ מזדמנות'), U.el('strong', {}, `${U.fmtILS(data.variable)} (${100 - fp}%)`)]),
      ]);
    }
    if (data.kind === 'balance') {
      const wrap = U.el('div', { class: 'palette-result-data' });
      data.rows.forEach(r => wrap.appendChild(U.el('div', { class: 'mini-row' }, [
        U.el('span', {}, r.name),
        U.el('strong', { class: r.total < 0 ? 'amt-out' : 'amt-in' }, U.fmtILS(r.total, true)),
      ])));
      wrap.appendChild(U.el('div', { class: 'mini-row', style: { marginTop: '4px', borderTop: '1px solid var(--border)' } }, [
        U.el('strong', {}, 'סך הכל'),
        U.el('strong', { class: data.grand < 0 ? 'amt-out' : 'amt-in' }, U.fmtILS(data.grand, true)),
      ]));
      return wrap;
    }
    return null;
  };

  // Execute selected result
  const executeResult = async (idx) => {
    const r = _results[idx];
    if (!r) return;
    if (r.run) {
      const out = await r.run();
      if (out?.kind === 'text') {
        UI.toast(out.text, 'success');
        setTimeout(close, 600);
      }
    }
  };

  // Helper: programmatically set query and re-render
  const doQuery = async (q) => {
    const inp = document.getElementById('palette-input');
    inp.value = q;
    await renderResults(q);
  };

  // ---- AI fallback ----
  const askAI = async () => {
    const q = document.getElementById('palette-input').value.trim();
    if (!q) { UI.toast('הקלד שאלה', 'warn'); return; }
    if (!await AIService.isConfigured()) {
      openAiKeyPrompt();
      return;
    }
    const loading = document.getElementById('palette-loading');
    const aiBtn = document.getElementById('palette-ai-btn');
    loading.classList.remove('hidden');
    aiBtn.disabled = true;
    try {
      const reply = await AIService.ask(q);
      const wrap = document.getElementById('palette-results');
      U.clearChildren(wrap);
      wrap.appendChild(U.el('div', { class: 'palette-result-head', style: { padding: '10px 12px 0' } }, [
        U.el('span', { class: 'palette-result-icon' }, '🤖'),
        U.el('span', { class: 'palette-result-title' }, 'תשובת ה-AI'),
      ]));
      wrap.appendChild(U.el('div', { class: 'palette-ai-response' }, reply));
    } catch (err) {
      if (err.message === 'NO_API_KEY') openAiKeyPrompt();
      else if (err.message === 'INVALID_API_KEY') UI.toast('מפתח ה-API שגוי. עדכן בהגדרות.', 'error');
      else if (err.message === 'CORS_BLOCKED') UI.toast('הדפדפן חסם את הקריאה ל-Claude. ייתכן שצריך פרוקסי — דבר איתי אם זה הבעיה.', 'error');
      else UI.toast('שגיאה: ' + err.message, 'error');
    } finally {
      loading.classList.add('hidden');
      aiBtn.disabled = false;
    }
  };

  const openAiKeyPrompt = () => {
    const body = U.el('div');
    body.appendChild(U.el('div', { style: { marginBottom: '10px' } },
      'כדי לשאול את ה-AI, נדרש מפתח API של Anthropic Claude.'));
    body.appendChild(U.el('div', { class: 'muted', style: { marginBottom: '12px', fontSize: '12.5px' } },
      'הזן את המפתח שלך מ-console.anthropic.com → API Keys. המפתח נשמר רק בחשבון שלך ולא חשוף למשתמשים אחרים.'));
    const inp = U.el('input', { type: 'password', class: 'input', placeholder: 'sk-ant-...', style: { width: '100%' } });
    body.appendChild(inp);
    const save = U.el('button', { class: 'btn', onclick: async () => {
      const v = inp.value.trim();
      if (!v.startsWith('sk-ant-')) { UI.toast('המפתח צריך להתחיל ב-"sk-ant-"', 'error'); return; }
      await AIService.setApiKey(v);
      UI.toast('מפתח נשמר. נסה שוב את השאלה.', 'success');
      closeModal();
    }}, 'שמור');
    const cancel = U.el('button', { class: 'btn-soft', onclick: () => closeModal() }, 'ביטול');
    let closeModal = UI.openModal({
      title: '🔑 מפתח Claude API', body, footer: [cancel, save],
    });
  };

  // ---- Wiring ----
  const init = () => {
    const inp = document.getElementById('palette-input');
    const handler = U.debounce(() => renderResults(inp.value), 120);
    inp.addEventListener('input', handler);

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        _selectedIdx = Math.min(_results.length - 1, _selectedIdx + 1);
        updateSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _selectedIdx = Math.max(0, _selectedIdx - 1);
        updateSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) askAI();
        else if (_results[_selectedIdx]) executeResult(_selectedIdx);
        else askAI();
      }
    });

    document.getElementById('palette-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'palette-backdrop') close();
    });
    document.getElementById('palette-fab').addEventListener('click', open);
    document.getElementById('palette-ai-btn').addEventListener('click', askAI);

    // Global hotkey: Ctrl+K (or Cmd+K) opens the palette
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (_open) close(); else open();
      }
    });

    // Show fab only when authenticated (palette is gated like the rest)
    if (window.Cloud) {
      const u = Cloud.currentUser();
      if (u) document.getElementById('palette-fab').classList.remove('hidden');
      Cloud.subscribe((evt, payload) => {
        if (evt === 'authReady' || evt === 'authChange') {
          document.getElementById('palette-fab').classList.toggle('hidden', !payload.user);
        }
      });
    }
  };

  const updateSelection = () => {
    document.querySelectorAll('.palette-result').forEach((el, i) => {
      el.classList.toggle('selected', i === _selectedIdx);
    });
  };

  return { init, open, close };
})();
