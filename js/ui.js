// ============================================================
//  UI helpers: navigation, modals, toasts, month picker
// ============================================================

const UI = (() => {
  // ---- Page navigation ----
  let _currentPage = 'dashboard';
  const onPageChange = [];

  const PAGE_TITLES = {
    dashboard: 'סקירה',
    transactions: 'תנועות',
    cards: 'כרטיסים וחשבונות',
    forecast: 'צפי לחודשים',
    categories: 'קטגוריות',
    recurring: 'הוצאות והכנסות קבועות',
    budgets: 'תקציבים',
    upload: 'העלאת קבצים',
    settings: 'הגדרות',
  };

  const navigate = (page) => {
    if (!PAGE_TITLES[page]) return;
    _currentPage = page;
    document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== `page-${page}`));
    document.getElementById('page-title').textContent = PAGE_TITLES[page];
    onPageChange.forEach(fn => { try { fn(page); } catch (e) { console.error(e); } });
  };
  const currentPage = () => _currentPage;
  const subscribePage = (fn) => onPageChange.push(fn);

  // ---- Month picker ----
  let _activeMonth = new Date();
  _activeMonth.setDate(1); _activeMonth.setHours(0, 0, 0, 0);
  const onMonthChange = [];
  const setMonth = (d) => {
    _activeMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    document.getElementById('month-label').textContent = U.fmtMonth(_activeMonth);
    onMonthChange.forEach(fn => { try { fn(_activeMonth); } catch (e) { console.error(e); } });
  };
  const activeMonth = () => _activeMonth;
  const subscribeMonth = (fn) => onMonthChange.push(fn);
  const initMonthPicker = () => {
    document.getElementById('month-prev').onclick = () => setMonth(U.addMonths(_activeMonth, -1));
    document.getElementById('month-next').onclick = () => setMonth(U.addMonths(_activeMonth, 1));
    document.getElementById('month-today').onclick = () => setMonth(new Date());
    setMonth(_activeMonth);
  };

  // ---- Modal ----
  const openModal = ({ title, body, footer, onClose }) => {
    const backdrop = document.getElementById('modal-backdrop');
    document.getElementById('modal-title').textContent = title || '';
    const bodyEl = document.getElementById('modal-body');
    U.clearChildren(bodyEl);
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body instanceof Node) bodyEl.appendChild(body);
    const footEl = document.getElementById('modal-foot');
    U.clearChildren(footEl);
    if (footer) {
      (Array.isArray(footer) ? footer : [footer]).forEach(b => footEl.appendChild(b));
    }
    backdrop.classList.remove('hidden');
    const close = () => {
      backdrop.classList.add('hidden');
      document.removeEventListener('keydown', escClose);
      onClose && onClose();
    };
    const escClose = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escClose);
    document.getElementById('modal-close').onclick = close;
    backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
    return close;
  };

  // Form helpers
  const formField = (label, input) => {
    const wrap = U.el('label', {}, [label]);
    wrap.appendChild(input);
    return wrap;
  };
  const inputText = (name, value = '', attrs = {}) =>
    U.el('input', { name, value, type: attrs.type || 'text', class: 'input', placeholder: attrs.placeholder || '', step: attrs.step, min: attrs.min, max: attrs.max });
  const inputDate = (name, value = '') => {
    const d = value instanceof Date ? value : value ? new Date(value) : null;
    const iso = d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
    return U.el('input', { name, value: iso, type: 'date', class: 'input' });
  };
  const inputSelect = (name, options, value = '') => {
    const sel = U.el('select', { name, class: 'input' });
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      if (String(o.value) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  };
  const inputCheckbox = (name, label, checked = false) => {
    const wrap = U.el('label', { class: 'check-wrap' });
    const chk = U.el('input', { name, type: 'checkbox' });
    if (checked) chk.checked = true;
    wrap.appendChild(chk);
    wrap.appendChild(document.createTextNode(' ' + label));
    return wrap;
  };
  const grid = (children) => {
    const g = U.el('div', { class: 'form-grid' });
    children.forEach(c => g.appendChild(c));
    return g;
  };
  const fullCol = (node) => { node.classList.add('full'); return node; };

  const collectForm = (root) => {
    const out = {};
    root.querySelectorAll('input,select,textarea').forEach(el => {
      if (!el.name) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
      else if (el.type === 'date') out[el.name] = el.value ? new Date(el.value) : null;
      else out[el.name] = el.value;
    });
    return out;
  };

  // ---- Toast ----
  const toast = (msg, type = '') => {
    const stack = document.getElementById('toast-stack');
    const t = U.el('div', { class: 'toast ' + type }, msg);
    stack.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-12px)'; t.style.transition = 'all 0.2s'; }, 3000);
    setTimeout(() => { t.remove(); }, 3300);
  };

  // ---- Confirm dialog ----
  const confirmDialog = ({ title, body, confirmLabel = 'אישור', cancelLabel = 'ביטול', danger = false }) =>
    new Promise(resolve => {
      const cancel = U.el('button', { class: 'btn-soft', onclick: () => { closeModal(); resolve(false); } }, cancelLabel);
      const ok = U.el('button', { class: danger ? 'btn-danger' : 'btn', onclick: () => { closeModal(); resolve(true); } }, confirmLabel);
      let closeModal;
      closeModal = openModal({ title, body: typeof body === 'string' ? body : body, footer: [cancel, ok], onClose: () => resolve(false) });
    });

  return {
    navigate, currentPage, subscribePage,
    setMonth, activeMonth, subscribeMonth, initMonthPicker,
    openModal, toast, confirmDialog,
    formField, inputText, inputDate, inputSelect, inputCheckbox, grid, fullCol, collectForm,
  };
})();
