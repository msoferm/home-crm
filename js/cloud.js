// ============================================================
//  Cloud sync — Firebase Auth + Firestore mirror
//  Loaded as ES module; exposes `window.Cloud` globally.
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, deleteDoc, getDocs, onSnapshot,
  writeBatch, serverTimestamp, Timestamp, query,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCi4IckPt8T4OhF470bzSA2UTftFhDvclo',
  authDomain: 'home-crm-1cc0f.firebaseapp.com',
  projectId: 'home-crm-1cc0f',
  storageBucket: 'home-crm-1cc0f.firebasestorage.app',
  messagingSenderId: '116039827729',
  appId: '1:116039827729:web:da7694ef2346f1c4894cb0',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fdb = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const COLLECTIONS = ['transactions', 'accounts', 'categories', 'recurring', 'budgets', 'settings'];

// ---- Helpers ----
const userCol = (uid, name) => collection(fdb, 'users', uid, name);
const userDoc = (uid, name, id) => doc(fdb, 'users', uid, name, id);

// Convert Date → Firestore Timestamp; everything else passes through
const serializeForCloud = (obj) => {
  if (obj == null) return obj;
  if (obj instanceof Date) return Timestamp.fromDate(obj);
  if (Array.isArray(obj)) return obj.map(serializeForCloud);
  if (typeof obj === 'object') {
    const out = {};
    for (const k in obj) out[k] = serializeForCloud(obj[k]);
    return out;
  }
  return obj;
};
const deserializeFromCloud = (obj) => {
  if (obj == null) return obj;
  if (obj?.toDate && typeof obj.toDate === 'function') return obj.toDate();
  if (Array.isArray(obj)) return obj.map(deserializeFromCloud);
  if (typeof obj === 'object') {
    const out = {};
    for (const k in obj) out[k] = deserializeFromCloud(obj[k]);
    return out;
  }
  return obj;
};

// ---- State ----
let currentUser = undefined; // undefined = not yet known; null = signed out; object = signed in
let unsubListeners = [];
let listeners = []; // event subscribers
let syncing = false;
let lastSyncAt = null;

const notify = (event, payload) => listeners.forEach(fn => { try { fn(event, payload); } catch (e) { console.error(e); } });
const subscribe = (fn) => { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; };

// ---- Auth API ----
const signInGoogle = () => signInWithPopup(auth, googleProvider);
const signInEmail = (email, pass) => signInWithEmailAndPassword(auth, email, pass);
const signUpEmail = (email, pass) => createUserWithEmailAndPassword(auth, email, pass);
const logout = async () => {
  // Clear local IndexedDB so private data isn't visible to anyone else on this device.
  try {
    await Promise.all([
      DB.db.transactions.clear(),
      DB.db.accounts.clear(),
      DB.db.categories.clear(),
      DB.db.recurring.clear(),
      DB.db.budgets.clear(),
      DB.db.settings.clear(),
    ]);
  } catch (e) { console.warn('Local clear on logout failed:', e); }
  await signOut(auth);
  // Reload so the app starts clean
  setTimeout(() => location.reload(), 200);
};

// ---- Sync: push one record ----
const pushOne = async (collectionName, record) => {
  if (!currentUser || !record?.id) return;
  try {
    await setDoc(userDoc(currentUser.uid, collectionName, record.id), {
      ...serializeForCloud(record),
      _updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('Cloud push failed:', collectionName, record.id, err.message);
  }
};

const pushSettingsRow = async (row) => {
  if (!currentUser || !row?.key) return;
  try {
    await setDoc(userDoc(currentUser.uid, 'settings', row.key), {
      ...serializeForCloud(row),
      _updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('Cloud push settings failed:', row.key, err.message);
  }
};

const deleteOne = async (collectionName, id) => {
  if (!currentUser || !id) return;
  try {
    await deleteDoc(userDoc(currentUser.uid, collectionName, id));
  } catch (err) {
    console.warn('Cloud delete failed:', collectionName, id, err.message);
  }
};

// ---- Sync: push all (initial sync up) ----
const pushAll = async () => {
  if (!currentUser) return;
  syncing = true;
  notify('syncStart', { direction: 'up' });
  try {
    for (const colName of COLLECTIONS) {
      const local = await (
        colName === 'transactions' ? DB.txAll() :
        colName === 'accounts' ? DB.accAll() :
        colName === 'categories' ? DB.catAll() :
        colName === 'recurring' ? DB.recAll() :
        colName === 'budgets' ? DB.budgetAll() :
        DB.db.settings.toArray()
      );
      if (!local.length) continue;
      // Write in chunks of 400 (Firestore batch limit is 500)
      for (let i = 0; i < local.length; i += 400) {
        const batch = writeBatch(fdb);
        local.slice(i, i + 400).forEach(rec => {
          const key = colName === 'settings' ? rec.key : rec.id;
          if (!key) return;
          batch.set(userDoc(currentUser.uid, colName, key), {
            ...serializeForCloud(rec),
            _updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
    }
    lastSyncAt = new Date();
    notify('syncEnd', { direction: 'up', at: lastSyncAt });
  } finally {
    syncing = false;
  }
};

// ---- Sync: pull all (initial pull down) ----
const pullAll = async () => {
  if (!currentUser) return;
  syncing = true;
  notify('syncStart', { direction: 'down' });
  try {
    for (const colName of COLLECTIONS) {
      const snap = await getDocs(userCol(currentUser.uid, colName));
      const remote = snap.docs.map(d => deserializeFromCloud({ ...d.data() }));
      // Strip our metadata fields
      remote.forEach(r => { delete r._updatedAt; });
      if (!remote.length) continue;

      // Replace local content with cloud content for that collection
      const table = DB.db[colName];
      await table.clear();
      // Ensure id present
      const filtered = remote.filter(r => r.id || (colName === 'settings' && r.key));
      if (filtered.length) await table.bulkAdd(filtered);
    }
    lastSyncAt = new Date();
    notify('syncEnd', { direction: 'down', at: lastSyncAt });
  } finally {
    syncing = false;
  }
};

// ---- Real-time listeners (live updates from other devices) ----
const startLiveListeners = () => {
  stopLiveListeners();
  if (!currentUser) return;
  for (const colName of COLLECTIONS) {
    const unsub = onSnapshot(userCol(currentUser.uid, colName), async (snap) => {
      // Only act on remote changes (not our own writes during initial pull)
      const remoteChanges = snap.docChanges().filter(c => !c.doc.metadata.hasPendingWrites);
      if (!remoteChanges.length) return;
      const table = DB.db[colName];
      for (const change of remoteChanges) {
        const data = deserializeFromCloud({ ...change.doc.data() });
        delete data._updatedAt;
        if (change.type === 'removed') {
          await table.delete(colName === 'settings' ? data.key : data.id);
        } else {
          await table.put(data);
        }
      }
      notify('remoteUpdate', { collection: colName, count: remoteChanges.length });
    }, (err) => {
      console.warn('Listener error', colName, err.message);
    });
    unsubListeners.push(unsub);
  }
};
const stopLiveListeners = () => {
  unsubListeners.forEach(fn => { try { fn(); } catch {} });
  unsubListeners = [];
};

// ---- Wrap DB write methods to mirror to cloud automatically ----
const installDBWraps = () => {
  if (installDBWraps._done) return;
  installDBWraps._done = true;

  // transactions
  const txAddOrig = DB.txAdd, txBulkAddOrig = DB.txBulkAdd, txUpdateOrig = DB.txUpdate, txDeleteOrig = DB.txDelete;
  DB.txAdd = async (tx) => { const r = await txAddOrig(tx); pushOne('transactions', r); return r; };
  DB.txBulkAdd = async (txs) => { const r = await txBulkAddOrig(txs); r.forEach(t => pushOne('transactions', t)); return r; };
  DB.txUpdate = async (id, patch) => {
    const r = await txUpdateOrig(id, patch);
    const full = await DB.db.transactions.get(id);
    if (full) pushOne('transactions', full);
    return r;
  };
  DB.txDelete = async (id) => { const r = await txDeleteOrig(id); deleteOne('transactions', id); return r; };

  // accounts
  const accAddOrig = DB.accAdd, accUpdateOrig = DB.accUpdate, accDeleteOrig = DB.accDelete;
  DB.accAdd = async (a) => { const r = await accAddOrig(a); pushOne('accounts', r); return r; };
  DB.accUpdate = async (id, patch) => {
    const r = await accUpdateOrig(id, patch);
    const full = await DB.db.accounts.get(id);
    if (full) pushOne('accounts', full);
    return r;
  };
  DB.accDelete = async (id) => { const r = await accDeleteOrig(id); deleteOne('accounts', id); return r; };

  // categories
  const catAddOrig = DB.catAdd, catUpdateOrig = DB.catUpdate, catDeleteOrig = DB.catDelete;
  DB.catAdd = async (c) => { const r = await catAddOrig(c); pushOne('categories', r); return r; };
  DB.catUpdate = async (id, patch) => {
    const r = await catUpdateOrig(id, patch);
    const full = await DB.db.categories.get(id);
    if (full) pushOne('categories', full);
    return r;
  };
  DB.catDelete = async (id) => { const r = await catDeleteOrig(id); deleteOne('categories', id); return r; };

  // recurring
  const recAddOrig = DB.recAdd, recUpdateOrig = DB.recUpdate, recDeleteOrig = DB.recDelete;
  DB.recAdd = async (r) => { const x = await recAddOrig(r); pushOne('recurring', x); return x; };
  DB.recUpdate = async (id, patch) => {
    const r = await recUpdateOrig(id, patch);
    const full = await DB.db.recurring.get(id);
    if (full) pushOne('recurring', full);
    return r;
  };
  DB.recDelete = async (id) => { const r = await recDeleteOrig(id); deleteOne('recurring', id); return r; };

  // budgets
  const budgetSetOrig = DB.budgetSet, budgetDeleteOrig = DB.budgetDelete;
  DB.budgetSet = async (categoryId, monthlyLimit) => {
    await budgetSetOrig(categoryId, monthlyLimit);
    const b = await DB.db.budgets.where('categoryId').equals(categoryId).first();
    if (b) pushOne('budgets', b);
  };
  DB.budgetDelete = async (categoryId) => {
    const b = await DB.db.budgets.where('categoryId').equals(categoryId).first();
    await budgetDeleteOrig(categoryId);
    if (b) deleteOne('budgets', b.id);
  };
};

// ---- Auth state lifecycle ----
const onAuthChange = (cb) => onAuthStateChanged(auth, cb);

// Bootstrap when user signs in
let firstAuthFired = false;
const handleAuthChange = async (user) => {
  const wasUser = currentUser;
  currentUser = user; // null = signed out, object = signed in

  // First time we hear from Firebase Auth: emit authReady; later changes are authChange.
  if (!firstAuthFired) {
    firstAuthFired = true;
    notify('authReady', { user });
  } else {
    notify('authChange', { user });
  }

  if (user) {
    installDBWraps();
    // For privacy: when a user logs in, always reset local DB defaults before pulling,
    // so leftover local data from before login doesn't accidentally get pushed/merged.
    // The pull will repopulate from the cloud's source of truth.
    try {
      const probe = await getDocs(query(userCol(user.uid, 'transactions')));
      const cloudHasData = !probe.empty;
      if (cloudHasData) {
        await pullAll();
      } else {
        // First-time login for this user.
        // Ensure defaults exist (DB.init was called at boot), then push to cloud.
        const hasAny = (await DB.txAll()).length || (await DB.accAll()).length || (await DB.catAll()).length;
        if (hasAny) await pushAll();
      }
      if (window.Dashboard) Dashboard.render();
      startLiveListeners();
    } catch (err) {
      console.error('Initial sync failed:', err);
      notify('syncError', err);
    }
  } else {
    stopLiveListeners();
  }
};

onAuthChange(handleAuthChange);

// ---- Public API ----
window.Cloud = {
  signInGoogle, signInEmail, signUpEmail, logout,
  pushAll, pullAll,
  subscribe,
  isSyncing: () => syncing,
  lastSyncAt: () => lastSyncAt,
  currentUser: () => currentUser,
};

// Signal readiness
document.dispatchEvent(new Event('cloud-ready'));
