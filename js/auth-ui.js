// ============================================================
//  Auth UI — single-user gate (login only, no signup, no Google)
//  Depends on window.Cloud (defined in cloud.js ES module).
// ============================================================

const AuthUI = (() => {

  const authErrorMessage = (err) => {
    const code = err?.code || '';
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'דוא"ל או סיסמה שגויים';
    if (code.includes('invalid-email')) return 'דוא"ל לא תקין';
    if (code.includes('network')) return 'בעיית רשת — בדוק חיבור לאינטרנט';
    if (code.includes('operation-not-allowed')) return 'התחברות אינה זמינה כרגע';
    if (code.includes('too-many-requests')) return 'יותר מדי ניסיונות — נסה שוב בעוד דקות';
    if (code.includes('user-disabled')) return 'החשבון מושבת';
    return err?.message || 'שגיאת התחברות';
  };

  const showError = (msg) => {
    const e = document.getElementById('gate-error');
    e.textContent = msg;
    e.classList.remove('hidden');
  };
  const clearError = () => document.getElementById('gate-error').classList.add('hidden');

  const showGate = () => {
    document.getElementById('boot-screen').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  };
  const showApp = () => {
    document.getElementById('boot-screen').classList.add('hidden');
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  };
  const showBoot = () => {
    document.getElementById('boot-screen').classList.remove('hidden');
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  };

  const wireGate = () => {
    document.getElementById('gate-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      const data = UI.collectForm(e.target);
      if (!data.email || !data.password) { showError('יש למלא דוא"ל וסיסמה'); return; }
      const submitBtn = document.getElementById('gate-submit-btn');
      submitBtn.disabled = true;
      const origText = submitBtn.textContent;
      submitBtn.textContent = 'מתחבר...';
      try {
        await Cloud.signInEmail(data.email, data.password);
        // auth state listener will call showApp()
      } catch (err) {
        console.error(err);
        showError(authErrorMessage(err));
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }
    });
  };

  const updateUserPill = (user) => {
    const userInfo = document.getElementById('user-info');
    if (user) {
      userInfo.classList.remove('hidden');
      const avatar = document.getElementById('user-avatar');
      const name = document.getElementById('user-name');
      avatar.src = user.photoURL || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%236366f1'/><text x='50%25' y='55%25' text-anchor='middle' fill='white' font-family='sans-serif' font-size='14' font-weight='bold'>${(user.displayName || user.email || '?')[0].toUpperCase()}</text></svg>`;
      name.textContent = user.displayName || user.email || 'משתמש';
    } else {
      userInfo.classList.add('hidden');
    }
  };

  const updateSyncStatus = (status) => {
    const dot = document.getElementById('sync-status');
    if (!dot) return;
    dot.className = 'sync-status ' + status;
    dot.title = ({
      syncing: 'מסנכרן עם הענן...',
      error: 'שגיאת סנכרון',
      offline: 'לא מחובר לענן',
      '': 'מסונכרן ✓',
    }[status]) || 'מסונכרן ✓';
  };

  const init = () => {
    wireGate();

    document.getElementById('btn-logout').addEventListener('click', async () => {
      const ok = await UI.confirmDialog({
        title: 'התנתקות',
        body: 'המידע המקומי יימחק מהמכשיר הזה (נשאר בטוח בענן). להמשיך?',
        confirmLabel: 'התנתקות', danger: true,
      });
      if (!ok) return;
      try {
        await Cloud.logout();
      } catch (err) {
        UI.toast('שגיאה בהתנתקות: ' + err.message, 'error');
      }
    });

    const subscribe = () => {
      Cloud.subscribe((event, payload) => {
        if (event === 'authReady') {
          if (payload.user) { updateUserPill(payload.user); showApp(); }
          else showGate();
        } else if (event === 'authChange') {
          updateUserPill(payload.user);
          if (payload.user) showApp();
          else showGate();
        } else if (event === 'syncStart') {
          updateSyncStatus('syncing');
        } else if (event === 'syncEnd') {
          updateSyncStatus('');
          if (payload.direction === 'down') UI.toast('הנתונים סונכרנו מהענן ✓', 'success');
          if (window.Dashboard) Dashboard.render();
          if (UI.currentPage() === 'transactions' && window.Transactions) Transactions.render();
        } else if (event === 'syncError') {
          updateSyncStatus('error');
          UI.toast('שגיאת סנכרון: ' + (payload?.message || ''), 'error');
        } else if (event === 'remoteUpdate') {
          if (UI.currentPage() === 'dashboard' && window.Dashboard) Dashboard.render();
          if (UI.currentPage() === 'transactions' && window.Transactions) Transactions.render();
        }
      });
      const u = Cloud.currentUser();
      if (u !== undefined) {
        if (u) { updateUserPill(u); showApp(); }
        else showGate();
      }
    };

    if (window.Cloud) subscribe();
    else document.addEventListener('cloud-ready', subscribe, { once: true });

    setTimeout(() => {
      if (!window.Cloud) {
        showGate();
        showError('שכבת הענן לא נטענה. בדוק חיבור אינטרנט ורענן את הדף.');
      }
    }, 8000);
  };

  return { init, showGate, showApp, showBoot };
})();
