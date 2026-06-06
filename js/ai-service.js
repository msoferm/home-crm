// ============================================================
//  AI Service — Claude API wrapper for the command palette
//  API key + endpoint are stored as user settings (Firestore-synced).
// ============================================================

const AIService = (() => {

  const SETTINGS_KEY_API = 'claudeApiKey';
  const SETTINGS_KEY_PROXY = 'aiProxyUrl'; // optional CORS-allowing proxy

  const getApiKey = () => DB.setGet(SETTINGS_KEY_API);
  const setApiKey = (key) => DB.setPut(SETTINGS_KEY_API, key);
  const clearApiKey = () => DB.setPut(SETTINGS_KEY_API, '');
  const getProxyUrl = () => DB.setGet(SETTINGS_KEY_PROXY);
  const setProxyUrl = (url) => DB.setPut(SETTINGS_KEY_PROXY, url);

  // Anthropic API does not allow direct browser calls by default. The user
  // can either (a) configure a CORS-allowing proxy (e.g. Cloudflare Worker)
  // or (b) use the dangerouslyAllowBrowser header (Anthropic explicitly
  // enables this only for the new opus/sonnet/haiku endpoints with the
  // anthropic-dangerous-direct-browser-access header). We try direct first;
  // on CORS failure we fall back to a hint about a proxy.

  const isConfigured = async () => !!(await getApiKey());

  // Build a system prompt that describes the schema + available actions.
  const buildSystemPrompt = async () => {
    const cats = await DB.catAll();
    const accs = await DB.accAll();
    const monthYM = U.ymKey(new Date());
    return `אתה עוזר אישי למערכת ניהול כלכלת הבית של המשתמש. השב תמיד בעברית, קצר ומדויק.

המערכת מנהלת:
- חשבונות וכרטיסי אשראי
- תנועות (הכנסות/הוצאות)
- קטגוריות
- הוצאות קבועות (recurring) ומזדמנות
- תקציבים
- צפי לחודשים קדימה

חודש נוכחי: ${monthYM}.

חשבונות זמינים:
${accs.map(a => `- ${a.name}${a.last4Digits ? ' ('+a.last4Digits+')' : ''} [${a.type}]`).join('\n') || '— אין חשבונות —'}

קטגוריות זמינות:
${cats.slice(0, 25).map(c => `- ${c.name}`).join('\n')}

כשהמשתמש שואל שאלה אנליטית (כמה הוצאתי, מה הממוצע, איפה היה הכי הרבה וכו'), השב באופן ישיר על סמך הקונטקסט שיועבר לך בהודעה הבאה (סיכום הנתונים).

אם המשתמש מבקש פעולה (סווג מחדש, צור תקציב וכו'), הסבר באופן קצר מה עליו ללחוץ כדי לבצע.

אל תמציא נתונים שלא קיבלת.`;
  };

  // Build a compact data context to send to the LLM with the user's question.
  // Keeping it small saves tokens.
  const buildDataContext = async (question) => {
    const [txs, cats, accs] = await Promise.all([DB.txAll(), DB.catAll(), DB.accAll()]);
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    const accById = Object.fromEntries(accs.map(a => [a.id, a]));

    // Smart: detect any merchant name in the question and include its transactions.
    // Otherwise include last 3 months of transactions summary.
    const today = new Date();
    const cut = U.addMonths(today, -3);
    const recent = txs.filter(t => new Date(t.date) >= cut);

    // Build per-category totals for last 3 months
    const byCatMonth = {};
    recent.forEach(t => {
      const k = U.ymKey(t.date);
      const cn = catById[t.categoryId]?.name || 'לא מסווג';
      byCatMonth[k] = byCatMonth[k] || {};
      byCatMonth[k][cn] = (byCatMonth[k][cn] || 0) + t.amount;
    });

    // If the question mentions a merchant (4+ chars), include detail transactions
    const merchantWord = (question.match(/[֐-׿א-תa-zA-Z]{3,}/g) || [])
      .filter(w => !['החודש','החודש','שעבר','השנה','כמה','מתי','איפה','מי','כסף','שילמתי','הוצאתי','הכנסתי','הכנסה','הוצאה'].includes(w));
    const focused = [];
    for (const w of merchantWord.slice(0, 3)) {
      const matches = txs.filter(t => (t.description || '').includes(w)).slice(0, 30);
      if (matches.length) {
        focused.push({ keyword: w, transactions: matches.map(t => ({
          date: U.fmtDate(t.date),
          desc: t.description,
          amount: t.amount,
          account: accById[t.accountId]?.name || '—',
          category: catById[t.categoryId]?.name || '—',
        })) });
      }
    }

    // Monthly totals (last 6 months)
    const monthlyTotals = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const k = U.ymKey(m);
      let inc = 0, exp = 0;
      txs.forEach(t => {
        if (U.ymKey(t.date) !== k) return;
        if (t.amount > 0) inc += t.amount;
        else exp += Math.abs(t.amount);
      });
      monthlyTotals.push({ month: k, income: Math.round(inc), expense: Math.round(exp) });
    }

    return {
      monthlyTotals,
      categoryBreakdown: byCatMonth,
      focusedSearches: focused,
      totalTransactions: txs.length,
      accountCount: accs.length,
    };
  };

  // Call Claude API. Returns the text response.
  const ask = async (question) => {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('NO_API_KEY');
    const proxy = await getProxyUrl();

    const systemPrompt = await buildSystemPrompt();
    const dataContext = await buildDataContext(question);

    const messages = [
      {
        role: 'user',
        content: `הקונטקסט (נתוני המשתמש בפועל, השב על סמך זה בלבד):
\`\`\`json
${JSON.stringify(dataContext, null, 2)}
\`\`\`

השאלה של המשתמש: ${question}`,
      },
    ];

    const payload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    };

    const endpoint = proxy || 'https://api.anthropic.com/v1/messages';
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };

    let res;
    try {
      res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
    } catch (err) {
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        throw new Error('CORS_BLOCKED');
      }
      throw err;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 401) throw new Error('INVALID_API_KEY');
      throw new Error(`API_ERROR_${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    return text || '(תשובה ריקה)';
  };

  return { ask, isConfigured, getApiKey, setApiKey, clearApiKey, getProxyUrl, setProxyUrl };
})();
