// ============================================================
//  Auth UI — login modal, user pill, sync status
//  Depends on window.Cloud (defined in cloud.js ES module).
// ============================================================

const AuthUI = (() => {

  const openLoginModal = () => {
    if (!window.Cloud) {
      UI.toast('שכבת הענן עדיין נטענת... נסה שוב בעוד רגע', 'warn');
      return;
    }
    const body = U.el('div');

    // Tabs
    let mode = 'login';
    const tabs = U.el('div', { class: 'auth-tabs' });
    const loginTab = U.el('button', { class: 'auth-tab active', type: 'button' }, 'כניסה');
    const signupTab = U.el('button', { class: 'auth-tab', type: 'button' }, 'הרשמה');
    tabs.appendChild(loginTab);
    tabs.appendChild(signupTab);
    body.appendChild(tabs);

    // Google button
    const googleBtn = U.el('button', { class: 'google-btn', type: 'button', onclick: async () => {
      try {
        UI.toast('פותח חלון התחברות...', '');
        await Cloud.signInGoogle();
        UI.toast('התחברת בהצלחה', 'success');
        closeModal();
      } catch (err) {
        console.error(err);
        UI.toast(authErrorMessage(err), 'error');
      }
    }, html: `
      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 8.5-20.4l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 8 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.1 0 9.8-2 13.3-5.2l-6.1-5.2c-2 1.4-4.5 2.2-7.2 2.2-5.2 0-9.6-3.3-11.2-7.9L6.1 32.6A20 20 0 0 0 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.1 5.2A20 20 0 0 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
      </svg>
      התחברות עם Google`,
    });
    body.appendChild(googleBtn);

    // Divider
    body.appendChild(U.el('div', { class: 'auth-divider' }, 'או'));

    // Email/password form
    const form = U.el('form', { class: 'auth-form', onsubmit: async (e) => {
      e.preventDefault();
      const data = UI.collectForm(form);
      if (!data.email || !data.password) { UI.toast('יש למלא דוא"ל וסיסמה', 'error'); return; }
      try {
        if (mode === 'login') await Cloud.signInEmail(data.email, data.password);
        else await Cloud.signUpEmail(data.email, data.password);
        UI.toast(mode === 'login' ? 'התחברת בהצלחה' : 'נרשמת בהצלחה', 'success');
        closeModal();
      } catch (err) {
        console.error(err);
        UI.toast(authErrorMessage(err), 'error');
      }
    }});
    const emailInp = UI.inputText('email', '', { type: 'email', placeholder: 'דוא"ל' });
    const passInp = UI.inputText('password', '', { type: 'password', placeholder: 'סיסמה (לפחות 6 תווים)' });
    form.appendChild(emailInp);
    form.appendChild(passInp);
    const submitBtn = U.el('button', { class: 'btn btn-block', type: 'submit' }, 'כניסה');
    form.appendChild(submitBtn);
    body.appendChild(form);

    // Hint
    body.appendChild(U.el('div', { class: 'auth-hint' }, 'הנתונים שלך יסונכרנו אוטומטית בין כל המכשירים שלך'));

    // Tab switching
    const setMode = (m) => {
      mode = m;
      loginTab.classList.toggle('active', m === 'login');
      signupTab.classList.toggle('active', m === 'signup');
      submitBtn.textContent = m === 'login' ? 'כניסה' : 'הרשמה ושמירת נתונים בענן';
    };
    loginTab.onclick = () => setMode('login');
    signupTab.onclick = () => setMode('signup');

    let closeModal = UI.openModal({
      title: 'התחברות לסנכרון ענן',
      body,
      footer: [U.el('button', { class: 'btn-soft', onclick: () => closeModal() }, 'סגור')],
    });
  };

  const authErrorMessage = (err) => {
    const code = err?.code || '';
    if (code.includes('email-already-in-use')) return 'הדוא"ל כבר רשום במערכת';
    if (code.includes('weak-password')) return 'הסיסמה חלשה מדי (לפחות 6 תווים)';
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'פרטי התחברות שגויים';
    if (code.includes('invalid-email')) return 'דוא"ל לא תקין';
    if (code.includes('popup-closed-by-user')) return 'חלון ההתחברות נסגר';
    if (code.includes('popup-blocked')) return 'הדפדפן חסם את חלון ההתחברות';
    if (code.includes('network')) return 'בעיית רשת — בדוק חיבור לאינטרנט';
    if (code.includes('operation-not-allowed')) return 'יש להפעיל את ספק ההתחברות הזה ב-Firebase Console';
    return err?.message || 'שגיאת התחברות';
  };

  const updateUserPill = (user) => {
    const loginBtn = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    if (user) {
      loginBtn.classList.add('hidden');
      userInfo.classList.remove('hidden');
      const avatar = document.getElementById('user-avatar');
      const name = document.getElementById('user-name');
      avatar.src = user.photoURL || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%236366f1'/><text x='50%25' y='55%25' text-anchor='middle' fill='white' font-family='sans-serif' font-size='14' font-weight='bold'>${(user.displayName || user.email || '?')[0].toUpperCase()}</text></svg>`;
      name.textContent = user.displayName || user.email || 'משתמש';
    } else {
      loginBtn.classList.remove('hidden');
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
    document.getElementById('btn-login').addEventListener('click', openLoginModal);
    document.getElementById('btn-logout').addEventListener('click', async () => {
      const ok = await UI.confirmDialog({
        title: 'התנתקות',
        body: 'הנתונים יישארו ב-IndexedDB המקומי. להתנתק מהענן?',
        confirmLabel: 'התנתקות',
      });
      if (!ok) return;
      await Cloud.logout();
      UI.toast('התנתקת', 'success');
    });

    // Wait for cloud module to be ready (it dispatches 'cloud-ready')
    const subscribe = () => {
      if (!window.Cloud) return;
      Cloud.subscribe((event, payload) => {
        if (event === 'authChange') {
          updateUserPill(payload.user);
          if (!payload.user) updateSyncStatus('offline');
        } else if (event === 'syncStart') {
          updateSyncStatus('syncing');
        } else if (event === 'syncEnd') {
          updateSyncStatus('');
          UI.toast(payload.direction === 'down' ? 'הנתונים סונכרנו מהענן ✓' : 'הנתונים נשמרו בענן ✓', 'success');
          if (window.Dashboard) Dashboard.render();
          if (UI.currentPage() === 'transactions') Transactions.render();
        } else if (event === 'syncError') {
          updateSyncStatus('error');
          UI.toast('שגיאת סנכרון: ' + (payload?.message || ''), 'error');
        } else if (event === 'remoteUpdate') {
          UI.toast(`עדכון מהענן: ${payload.count} שינויים ב-${payload.collection}`, '');
          if (UI.currentPage() === 'dashboard' && window.Dashboard) Dashboard.render();
          if (UI.currentPage() === 'transactions' && window.Transactions) Transactions.render();
        }
      });
      // Initial state
      const u = Cloud.currentUser();
      if (u) updateUserPill(u);
      else updateSyncStatus('offline');
    };

    if (window.Cloud) subscribe();
    else document.addEventListener('cloud-ready', subscribe, { once: true });
  };

  return { init, openLoginModal };
})();
