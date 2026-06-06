// ============================================================
//  Upload page — credit-card & bank statements
// ============================================================

const Upload = (() => {
  let _pendingRows = [];
  let _pendingKind = null;
  let _pendingFileName = '';

  const refreshAccountSelects = async () => {
    const accs = await DB.accAll();
    const cardSel = document.getElementById('upload-card-account');
    const bankSel = document.getElementById('upload-bank-account');
    const cardAccs = accs.filter(a => a.type === 'card' || a.type === 'other');
    const bankAccs = accs.filter(a => a.type === 'bank' || a.type === 'savings' || a.type === 'other');
    cardSel.innerHTML = cardAccs.map(a => `<option value="${a.id}">${a.name}</option>`).join('') || '<option value="">— אין כרטיסים, צור חשבון —</option>';
    bankSel.innerHTML = bankAccs.map(a => `<option value="${a.id}">${a.name}</option>`).join('') || '<option value="">— אין בנקים, צור חשבון —</option>';
  };

  const showParseErrorModal = (result, file, kind) => {
    const body = U.el('div');
    body.appendChild(U.el('div', { style: { marginBottom: '10px', color: '#fca5a5' } }, '⚠️ ' + result.error));
    body.appendChild(U.el('div', { class: 'muted', style: { marginBottom: '14px' } },
      `קובץ: ${file.name} • סוג: ${kind === 'card' ? 'כרטיס אשראי' : 'עו"ש'}`));
    if (result.diagnostic) {
      body.appendChild(U.el('div', { style: { marginBottom: '6px', fontWeight: '600' } }, 'מידע אבחון:'));
      body.appendChild(U.el('pre', {
        style: {
          background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '8px',
          padding: '10px', fontSize: '11.5px', overflow: 'auto', maxHeight: '240px',
          whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left',
        },
      }, result.diagnostic));
    }
    body.appendChild(U.el('div', { class: 'muted', style: { marginTop: '12px', fontSize: '12.5px' } },
      'אם נראה לך שהקובץ אמור לעבוד, פתח את הקונסול (F12) ושלח לי את ההודעות מסוג [parseBank] / [parseCard] — נוכל להוסיף תמיכה.'));
    let closeModal = UI.openModal({
      title: 'לא הצלחתי לקרוא את הקובץ',
      body,
      footer: [U.el('button', { class: 'btn-soft', onclick: () => closeModal() }, 'סגור')],
    });
  };

  const setupDropzone = (zoneId, fileId, kind) => {
    const zone = document.getElementById(zoneId);
    const file = document.getElementById(fileId);
    zone.addEventListener('click', () => file.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0], kind);
    });
    file.addEventListener('change', (e) => {
      if (e.target.files.length) handleFile(e.target.files[0], kind);
    });
  };

  const handleFile = async (file, kind) => {
    UI.toast(`קורא את "${file.name}"...`, '');
    try {
      const accSelId = kind === 'card' ? 'upload-card-account' : 'upload-bank-account';
      const accountId = document.getElementById(accSelId).value || null;
      const result = kind === 'card'
        ? await Parsers.parseCreditCard(file, { accountId })
        : await Parsers.parseBank(file, { accountId });

      if (result.error) {
        showParseErrorModal(result, file, kind);
        return;
      }
      if (!result.rows.length) {
        showParseErrorModal({ error: 'לא נמצאו תנועות בקובץ.', diagnostic: '' }, file, kind);
        return;
      }
      await Parsers.enrichWithCategories(result.rows);
      // Mark duplicates
      const existing = await DB.existingDedupKeys();
      result.rows.forEach(r => {
        r.dedupKey = DB.makeDedupKey(r);
        r.isDuplicate = existing.has(r.dedupKey);
      });
      _pendingRows = result.rows;
      _pendingKind = kind;
      _pendingFileName = file.name;
      renderPreview();
    } catch (err) {
      console.error(err);
      UI.toast('שגיאה בקריאת הקובץ: ' + err.message, 'error');
    }
  };

  const renderPreview = async () => {
    const wrap = document.getElementById('preview-card');
    wrap.classList.remove('hidden');
    const dupCount = _pendingRows.filter(r => r.isDuplicate).length;
    const newCount = _pendingRows.length - dupCount;
    document.getElementById('preview-sub').innerHTML =
      `${_pendingFileName} • ${_pendingRows.length} שורות • ` +
      `<strong style="color:#4ade80">${newCount} חדשות</strong> • ` +
      `<strong style="color:#fbbf24">${dupCount} כפילויות (יוסטו)</strong>`;
    const tbody = document.getElementById('preview-tbody');
    U.clearChildren(tbody);
    const cats = await DB.catAll();
    const catById = Object.fromEntries(cats.map(c => [c.id, c]));
    _pendingRows.slice(0, 200).forEach((r, i) => {
      const cat = catById[r.categoryId];
      const tr = U.el('tr', {}, [
        U.el('td', {}, U.fmtDate(r.date)),
        U.el('td', {}, r.description),
        U.el('td', {}, cat ? U.el('span', { class: 'pill cat', style: { background: cat.color + '22', color: cat.color } }, `${cat.icon || ''} ${cat.name}`) : '—'),
        U.el('td', {}, r.installment ? U.el('span', { class: 'pill warn' }, `${r.installment.current}/${r.installment.total}`) : ''),
        U.el('td', { class: 'num ' + (r.amount < 0 ? 'amt-out' : 'amt-in') }, U.fmtILS(r.amount, true)),
        U.el('td', {}, r.isDuplicate ? U.el('span', { class: 'pill warn' }, 'כפילות') : U.el('span', { class: 'pill income' }, 'חדש')),
      ]);
      tbody.appendChild(tr);
    });
    if (_pendingRows.length > 200) {
      tbody.appendChild(U.el('tr', {}, U.el('td', { colspan: 6, class: 'muted', style: { textAlign: 'center' } }, `… ועוד ${_pendingRows.length - 200} שורות`)));
    }
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const confirmImport = async () => {
    if (!_pendingRows.length) return;
    const newRows = _pendingRows.filter(r => !r.isDuplicate);
    if (!newRows.length) {
      UI.toast('כל השורות כבר קיימות במערכת', 'warn');
      return;
    }
    // Convert installment info to be stored alongside
    const payload = newRows.map(r => ({
      date: r.date,
      description: r.description,
      amount: r.amount,
      type: r.type,
      categoryId: r.categoryId,
      accountId: r.accountId,
      notes: r.notes || '',
      source: r.source,
      sourceFile: r.sourceFile,
      installment: r.installment || null,
      chargeDate: r.chargeDate || null,
      balanceAfter: r.balanceAfter || null,
      dedupKey: r.dedupKey,
    }));
    await DB.txBulkAdd(payload);
    UI.toast(`יובאו ${newRows.length} תנועות חדשות`, 'success');
    _pendingRows = []; _pendingKind = null; _pendingFileName = '';
    document.getElementById('preview-card').classList.add('hidden');
    document.getElementById('file-card').value = '';
    document.getElementById('file-bank').value = '';
    // Refresh dashboard if visible
    if (UI.currentPage() === 'dashboard') Dashboard.render();
  };

  const cancelPreview = () => {
    _pendingRows = []; _pendingKind = null; _pendingFileName = '';
    document.getElementById('preview-card').classList.add('hidden');
    document.getElementById('file-card').value = '';
    document.getElementById('file-bank').value = '';
  };

  const init = () => {
    setupDropzone('dz-card', 'file-card', 'card');
    setupDropzone('dz-bank', 'file-bank', 'bank');
    document.getElementById('preview-confirm').addEventListener('click', confirmImport);
    document.getElementById('preview-cancel').addEventListener('click', cancelPreview);
    refreshAccountSelects();
  };

  UI.subscribePage((p) => { if (p === 'upload') refreshAccountSelects(); });

  return { init, refreshAccountSelects };
})();
