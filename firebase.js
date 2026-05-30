/* Firebase bootstrap (Auth + Firestore) for GitHub Pages (no build step).
   Uses Firebase "compat" SDK loaded from gstatic.
*/
(function () {
    const config = window.PV_FIREBASE_CONFIG;
    if (!config || !config.apiKey || config.apiKey === 'YOUR_API_KEY') {
        // Not configured yet; page can still load.
        window.PV_AUTH = {
            isReady: () => false,
            getUser: () => null,
            onAuthStateChanged: (cb) => {
                try { cb(null); } catch { }
                return () => { };
            },
            signInWithGoogle: async () => { throw new Error('Firebase not configured'); },
            signUpWithEmail: async () => { throw new Error('Firebase not configured'); },
            signInWithEmail: async () => { throw new Error('Firebase not configured'); },
            signOut: async () => { },
            deleteAccount: async () => { throw new Error('Firebase not configured'); },
            getIdToken: async () => null,
            db: null,
            loadFavorites: async () => [],
            saveFavorite: async () => { },
            removeFavorite: async () => { },
            loadWatchlist: async () => [],
            saveWatchlistItem: async () => { },
            removeWatchlistItem: async () => { },
            loadDexState: async () => ({ collection: [], masterSets: {} }),
            saveDexState: async () => { },
            loadDexShareSettings: async () => ({ enabled: false, token: '', shareUrl: '' }),
            saveDexShareSettings: async () => ({ enabled: false, token: '', shareUrl: '' }),
            loadSharedDexCollection: async () => ({ collection: [] }),
            loadDexCollectionsMeta: async () => ({
                activeCollectionId: 'default',
                collections: [{ id: 'default', name: 'Default Collection' }],
            }),
            saveDexCollectionsMeta: async () => ({
                activeCollectionId: 'default',
                collections: [{ id: 'default', name: 'Default Collection' }],
            }),
        };
        return;
    }

    if (!window.firebase || !window.firebase.initializeApp) {
        // Firebase scripts not loaded (CSP or missing CDN tags).
        window.PV_AUTH = {
            isReady: () => false,
            getUser: () => null,
            onAuthStateChanged: (cb) => {
                try { cb(null); } catch { }
                return () => { };
            },
            signInWithGoogle: async () => { throw new Error('Firebase SDK not loaded'); },
            signUpWithEmail: async () => { throw new Error('Firebase SDK not loaded'); },
            signInWithEmail: async () => { throw new Error('Firebase SDK not loaded'); },
            signOut: async () => { },
            deleteAccount: async () => { throw new Error('Firebase SDK not loaded'); },
            getIdToken: async () => null,
            db: null,
            loadFavorites: async () => [],
            saveFavorite: async () => { },
            removeFavorite: async () => { },
            loadWatchlist: async () => [],
            saveWatchlistItem: async () => { },
            removeWatchlistItem: async () => { },
            loadDexState: async () => ({ collection: [], masterSets: {} }),
            saveDexState: async () => { },
            loadDexShareSettings: async () => ({ enabled: false, token: '', shareUrl: '' }),
            saveDexShareSettings: async () => ({ enabled: false, token: '', shareUrl: '' }),
            loadSharedDexCollection: async () => ({ collection: [] }),
            loadDexCollectionsMeta: async () => ({
                activeCollectionId: 'default',
                collections: [{ id: 'default', name: 'Default Collection' }],
            }),
            saveDexCollectionsMeta: async () => ({
                activeCollectionId: 'default',
                collections: [{ id: 'default', name: 'Default Collection' }],
            }),
        };
        return;
    }

    // Initialize once.
    let app;
    try {
        app = window.firebase.app();
    } catch {
        app = window.firebase.initializeApp(config);
    }

    const auth = window.firebase.auth();
    const db = window.firebase.firestore ? window.firebase.firestore() : null;
    const functions = window.firebase.functions ? window.firebase.functions() : null;

    function normalizeLocalFlag(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
        if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
        return null;
    }

    function shouldUseLocalFunctionsEmulator() {
        if (!functions || typeof functions.useEmulator !== 'function') return false;

        const host = String(window.location.hostname || '').trim().toLowerCase();
        const isLocalHost = host === 'localhost' || host === '127.0.0.1';
        if (!isLocalHost) return false;

        try {
            const params = new URLSearchParams(window.location.search);
            const queryOverride = normalizeLocalFlag(params.get('pv_functions_emulator'));
            if (queryOverride != null) return queryOverride;
        } catch {
            // ignore
        }

        try {
            const stored = normalizeLocalFlag(window.localStorage.getItem('pv:functions:emulator'));
            if (stored != null) return stored;
        } catch {
            // ignore
        }

        // Default to emulator on localhost to avoid accidental calls to deployed functions.
        return true;
    }

    if (shouldUseLocalFunctionsEmulator()) {
        try {
            functions.useEmulator('127.0.0.1', 5001);
        } catch {
            // ignore
        }
    }

    // Keep users signed in across refresh.
    try {
        auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    } catch {
        // ignore
    }

    function getUser() {
        return auth.currentUser || null;
    }

    async function getIdToken(forceRefresh) {
        const user = getUser();
        if (!user) return null;
        try {
            return await user.getIdToken(Boolean(forceRefresh));
        } catch {
            return null;
        }
    }

    async function getIdTokenResult(forceRefresh) {
        const user = getUser();
        if (!user || !user.getIdTokenResult) return null;
        try {
            return await user.getIdTokenResult(Boolean(forceRefresh));
        } catch {
            return null;
        }
    }

    async function callFunction(name, data) {
        if (!functions || !functions.httpsCallable) throw new Error('Firebase Functions not available');
        const fn = functions.httpsCallable(String(name || ''));
        const res = await fn(data);
        return res?.data;
    }

    function onAuthStateChanged(cb) {
        return auth.onAuthStateChanged(cb);
    }

    async function signInWithGoogle() {
        const provider = new window.firebase.auth.GoogleAuthProvider();
        try {
            return await auth.signInWithPopup(provider);
        } catch (error) {
            const code = String(error?.code || '').toLowerCase();
            const shouldFallbackToRedirect =
                code === 'auth/popup-blocked' ||
                code === 'auth/popup-closed-by-user' ||
                code === 'auth/cancelled-popup-request' ||
                code === 'auth/internal-error';

            if (!shouldFallbackToRedirect) throw error;

            // Fallback for browsers/policies that interfere with popup messaging.
            await auth.signInWithRedirect(provider);
            return null;
        }
    }

    async function signUpWithEmail(email, password) {
        return auth.createUserWithEmailAndPassword(String(email || ''), String(password || ''));
    }

    async function signInWithEmail(email, password) {
        return auth.signInWithEmailAndPassword(String(email || ''), String(password || ''));
    }

    async function signOut() {
        try {
            await auth.signOut();
        } catch {
            // ignore
        }
    }

    async function purgeOwnFirestoreData() {
        const user = getUser();
        if (!user || !db) return;

        const root = userRootRef(user.uid);
        if (!root) return;

        let shareToken = '';
        try {
            const profileSnap = await root.get();
            if (profileSnap && profileSnap.exists) {
                shareToken = normalizeShareToken(profileSnap.data()?.dexShareToken);
            }
        } catch {
            // ignore
        }

        const trackedCollections = ['cardWatchlist', 'sealedWatchlist', 'cardFavorites', 'sealedFavorites'];
        for (const name of trackedCollections) {
            try {
                const snap = await root.collection(name).get();
                if (!snap || snap.empty) continue;
                const jobs = [];
                snap.forEach((doc) => {
                    jobs.push(doc.ref.delete());
                });
                if (jobs.length) await Promise.allSettled(jobs);
            } catch {
                // ignore best-effort cleanup errors
            }
        }

        try {
            await root.collection('dex').doc('state').delete();
        } catch {
            // ignore
        }

        if (shareToken) {
            try {
                const sharedRef = dexSharedDocRef(shareToken);
                if (sharedRef) {
                    await sharedRef.delete();
                }
            } catch {
                // ignore
            }
        }

        try {
            await root.delete();
        } catch {
            // ignore
        }
    }

    async function deleteAccount(options) {
        const user = getUser();
        if (!user) throw new Error('Sign in before deleting your account.');

        const shouldDeleteData = options?.deleteFirestoreData !== false;
        if (shouldDeleteData) {
            await purgeOwnFirestoreData();
        }

        await user.delete();
    }

    function userRootRef(uid) {
        if (!db) return null;
        return db.collection('users').doc(uid);
    }

    function subcollectionName(kind, group) {
        const base = kind === 'sealed' ? 'sealed' : 'card';
        const g = group === 'watchlist' ? 'Watchlist' : 'Favorites';
        return `${base}${g}`;
    }

    function favoritesCollectionRef(uid, kind) {
        const root = userRootRef(uid);
        if (!root) return null;
        return root.collection(subcollectionName(kind, 'favorites'));
    }

    function watchlistCollectionRef(uid, kind) {
        const root = userRootRef(uid);
        if (!root) return null;
        return root.collection(subcollectionName(kind, 'watchlist'));
    }

    async function readCollection(ref) {
        if (!ref) return [];
        try {
            const snap = await ref.get();
            const out = [];
            snap.forEach((doc) => {
                const data = doc.data();
                if (data && typeof data === 'object') out.push(data);
            });
            return out;
        } catch {
            return [];
        }
    }

    async function loadFavorites(kind) {
        const user = getUser();
        if (!user || !db) return [];
        const ref = favoritesCollectionRef(user.uid, kind);
        return readCollection(ref);
    }

    async function saveFavorite(kind, item) {
        const user = getUser();
        if (!user || !db) return;
        const ref = favoritesCollectionRef(user.uid, kind);
        if (!ref) return;
        const id = String(item?.id || '').trim();
        if (!id) return;
        const payload = {
            ...item,
            id,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        };
        await ref.doc(id).set(payload, { merge: true });
    }

    async function removeFavorite(kind, id) {
        const user = getUser();
        if (!user || !db) return;
        const ref = favoritesCollectionRef(user.uid, kind);
        if (!ref) return;
        const docId = String(id || '').trim();
        if (!docId) return;
        await ref.doc(docId).delete();
    }

    async function loadWatchlist(kind) {
        const user = getUser();
        if (!user || !db) return [];
        const watchRef = watchlistCollectionRef(user.uid, kind);
        if (!watchRef) return [];

        // Migration behavior: when Watchlist is requested, also read legacy Favorites
        // and merge any missing items into Watchlist. This prevents data loss for
        // existing users while the UI and localStorage are renamed.
        const favRef = favoritesCollectionRef(user.uid, kind);
        const [watchItems, legacyItems] = await Promise.all([
            readCollection(watchRef),
            readCollection(favRef),
        ]);

        const byId = new Map();
        for (const item of watchItems) {
            const id = String(item?.id || '').trim();
            if (!id) continue;
            byId.set(id, item);
        }

        /** @type {Array<any>} */
        const toMigrate = [];
        for (const item of legacyItems) {
            const id = String(item?.id || '').trim();
            if (!id) continue;
            if (!byId.has(id)) {
                byId.set(id, item);
                toMigrate.push(item);
            }
        }

        if (toMigrate.length) {
            // Best-effort copy into Watchlist; keep legacy Favorites intact.
            await Promise.allSettled(toMigrate.map((item) => saveWatchlistItem(kind, item)));
        }

        return Array.from(byId.values());
    }

    async function saveWatchlistItem(kind, item) {
        const user = getUser();
        if (!user || !db) return;
        const ref = watchlistCollectionRef(user.uid, kind);
        if (!ref) return;
        const id = String(item?.id || '').trim();
        if (!id) return;
        const payload = {
            ...item,
            id,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        };
        await ref.doc(id).set(payload, { merge: true });
    }

    async function removeWatchlistItem(kind, id) {
        const user = getUser();
        if (!user || !db) return;
        const docId = String(id || '').trim();
        if (!docId) return;
        const watchRef = watchlistCollectionRef(user.uid, kind);
        if (watchRef) {
            try { await watchRef.doc(docId).delete(); } catch { /* ignore */ }
        }

        // Also remove from legacy Favorites so deleted items don't reappear
        // during Watchlist migration/merge.
        const favRef = favoritesCollectionRef(user.uid, kind);
        if (favRef) {
            try { await favRef.doc(docId).delete(); } catch { /* ignore */ }
        }
    }

    function dexStateDocRef(uid) {
        const root = userRootRef(uid);
        if (!root) return null;
        return root.collection('dex').doc('state');
    }

    function dexSharedDocRef(token) {
        if (!db) return null;
        return db.collection('dexShared').doc(String(token || ''));
    }

    const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
    const DEX_COLLECTION_ID_REGEX = /^[a-z0-9_-]{1,40}$/;
    const DEX_DEFAULT_COLLECTION_ID = 'default';
    const DEX_DEFAULT_COLLECTION_NAME = 'Default Collection';
    const DEX_MAX_COLLECTIONS_PREMIUM = 8;

    const dexShareSettingsCache = {
        uid: '',
        loaded: false,
        enabled: false,
        token: '',
    };

    const dexCollectionsMetaCache = {
        uid: '',
        loaded: false,
        activeCollectionId: DEX_DEFAULT_COLLECTION_ID,
        collections: [
            {
                id: DEX_DEFAULT_COLLECTION_ID,
                name: DEX_DEFAULT_COLLECTION_NAME,
                createdAt: 0,
                updatedAt: 0,
            },
        ],
    };

    function normalizeDexCollectionId(value, fallback) {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');

        const safe = normalized.slice(0, 40);
        if (!safe || !DEX_COLLECTION_ID_REGEX.test(safe)) {
            const nextFallback = String(fallback || DEX_DEFAULT_COLLECTION_ID).trim().toLowerCase();
            return DEX_COLLECTION_ID_REGEX.test(nextFallback) ? nextFallback : DEX_DEFAULT_COLLECTION_ID;
        }

        return safe;
    }

    function normalizeDexCollectionName(value, fallback) {
        const raw = String(value || '').replace(/\s+/g, ' ').trim();
        const candidate = raw || String(fallback || '').replace(/\s+/g, ' ').trim();
        if (!candidate) return DEX_DEFAULT_COLLECTION_NAME;
        return candidate.slice(0, 50);
    }

    function normalizeDexCollectionTimestamp(value, fallback) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
        const f = Number(fallback);
        if (Number.isFinite(f) && f > 0) return f;
        return Date.now();
    }

    function defaultDexCollectionEntry() {
        return {
            id: DEX_DEFAULT_COLLECTION_ID,
            name: DEX_DEFAULT_COLLECTION_NAME,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
    }

    function normalizeDexCollections(entriesRaw, maxCollections) {
        const max = Math.max(1, Math.floor(Number(maxCollections) || 1));
        const now = Date.now();
        const byId = new Map();

        const source = Array.isArray(entriesRaw) ? entriesRaw : [];
        for (const raw of source) {
            const id = normalizeDexCollectionId(raw?.id, '');
            if (!id) continue;

            const existing = byId.get(id);
            const createdAt = normalizeDexCollectionTimestamp(raw?.createdAt, existing?.createdAt || now);
            const updatedAt = normalizeDexCollectionTimestamp(raw?.updatedAt, createdAt);
            const fallbackName = id === DEX_DEFAULT_COLLECTION_ID ? DEX_DEFAULT_COLLECTION_NAME : id;
            const name = normalizeDexCollectionName(raw?.name, existing?.name || fallbackName);

            byId.set(id, {
                id,
                name,
                createdAt,
                updatedAt,
            });
        }

        if (!byId.has(DEX_DEFAULT_COLLECTION_ID)) {
            byId.set(DEX_DEFAULT_COLLECTION_ID, defaultDexCollectionEntry());
        } else {
            const base = byId.get(DEX_DEFAULT_COLLECTION_ID);
            byId.set(DEX_DEFAULT_COLLECTION_ID, {
                ...base,
                id: DEX_DEFAULT_COLLECTION_ID,
                name: DEX_DEFAULT_COLLECTION_NAME,
            });
        }

        const sorted = Array.from(byId.values())
            .sort((a, b) => {
                if (a.id === DEX_DEFAULT_COLLECTION_ID) return -1;
                if (b.id === DEX_DEFAULT_COLLECTION_ID) return 1;
                const aCreated = Number(a?.createdAt || 0);
                const bCreated = Number(b?.createdAt || 0);
                if (aCreated !== bCreated) return aCreated - bCreated;
                return String(a?.name || '').localeCompare(String(b?.name || ''));
            })
            .slice(0, max);

        const hasDefault = sorted.some((x) => x.id === DEX_DEFAULT_COLLECTION_ID);
        if (!hasDefault) {
            sorted.unshift(defaultDexCollectionEntry());
        }

        return sorted.slice(0, Math.max(1, max));
    }

    function buildDexCollectionsMeta(activeCollectionIdRaw, collectionsRaw, maxCollections) {
        const collections = normalizeDexCollections(collectionsRaw, maxCollections);
        const activeCandidate = normalizeDexCollectionId(activeCollectionIdRaw, DEX_DEFAULT_COLLECTION_ID);
        const activeExists = collections.some((entry) => entry.id === activeCandidate);
        const activeCollectionId = activeExists ? activeCandidate : DEX_DEFAULT_COLLECTION_ID;
        return { activeCollectionId, collections };
    }

    function cacheDexCollectionsMeta(uid, meta) {
        const normalized = buildDexCollectionsMeta(
            meta?.activeCollectionId,
            meta?.collections,
            DEX_MAX_COLLECTIONS_PREMIUM
        );

        dexCollectionsMetaCache.uid = String(uid || '');
        dexCollectionsMetaCache.loaded = true;
        dexCollectionsMetaCache.activeCollectionId = normalized.activeCollectionId;
        dexCollectionsMetaCache.collections = normalized.collections;
    }

    function buildDexCollectionsMetaResult(meta) {
        const normalized = buildDexCollectionsMeta(
            meta?.activeCollectionId,
            meta?.collections,
            DEX_MAX_COLLECTIONS_PREMIUM
        );

        return {
            activeCollectionId: normalized.activeCollectionId,
            collections: normalized.collections.map((entry) => ({
                id: entry.id,
                name: entry.name,
                createdAt: Number(entry.createdAt || 0) || Date.now(),
                updatedAt: Number(entry.updatedAt || 0) || Date.now(),
            })),
        };
    }

    function normalizeRoleFromClaims(claims) {
        const role = String(claims?.role || claims?.tier || '').trim().toLowerCase();
        if (role === 'admin' || role === 'tester' || role === 'premium' || role === 'basic') return role;
        if (claims?.admin === true) return 'admin';
        if (claims?.tester === true) return 'tester';
        if (claims?.premium === true) return 'premium';
        return 'basic';
    }

    function isPremiumRole(role) {
        const normalized = String(role || '').trim().toLowerCase();
        return normalized === 'admin' || normalized === 'tester' || normalized === 'premium';
    }

    async function loadCurrentRoleFromClaims(forceRefresh) {
        const tokenResult = await getIdTokenResult(Boolean(forceRefresh));
        return normalizeRoleFromClaims(tokenResult?.claims || {});
    }

    async function loadDexCollectionsMetaFromProfile(forceRefresh) {
        const user = getUser();
        if (!user || !db) {
            return buildDexCollectionsMeta(DEX_DEFAULT_COLLECTION_ID, [defaultDexCollectionEntry()], 1);
        }

        const uid = String(user.uid || '');
        if (!uid) {
            return buildDexCollectionsMeta(DEX_DEFAULT_COLLECTION_ID, [defaultDexCollectionEntry()], 1);
        }

        if (!forceRefresh && dexCollectionsMetaCache.loaded && dexCollectionsMetaCache.uid === uid) {
            return buildDexCollectionsMeta(
                dexCollectionsMetaCache.activeCollectionId,
                dexCollectionsMetaCache.collections,
                DEX_MAX_COLLECTIONS_PREMIUM
            );
        }

        const role = await loadCurrentRoleFromClaims(Boolean(forceRefresh));
        const maxCollections = isPremiumRole(role) ? DEX_MAX_COLLECTIONS_PREMIUM : 1;

        const root = userRootRef(uid);
        if (!root) {
            return buildDexCollectionsMeta(DEX_DEFAULT_COLLECTION_ID, [defaultDexCollectionEntry()], maxCollections);
        }

        try {
            const snap = await root.get();
            const data = snap && snap.exists ? snap.data() : null;
            const meta = buildDexCollectionsMeta(
                data?.dexActiveCollectionId,
                data?.dexCollections,
                maxCollections
            );
            cacheDexCollectionsMeta(uid, meta);
            return meta;
        } catch {
            const fallback = buildDexCollectionsMeta(DEX_DEFAULT_COLLECTION_ID, [defaultDexCollectionEntry()], maxCollections);
            cacheDexCollectionsMeta(uid, fallback);
            return fallback;
        }
    }

    async function loadDexCollectionsMeta() {
        const meta = await loadDexCollectionsMetaFromProfile(false);
        return buildDexCollectionsMetaResult(meta);
    }

    async function saveDexCollectionsMeta(payload) {
        const user = getUser();
        if (!user || !db) throw new Error('Sign in before editing collections.');

        const uid = String(user.uid || '');
        if (!uid) throw new Error('User session missing UID.');

        const root = userRootRef(uid);
        if (!root) throw new Error('Firestore unavailable.');

        const role = await loadCurrentRoleFromClaims(true);
        const maxCollections = isPremiumRole(role) ? DEX_MAX_COLLECTIONS_PREMIUM : 1;

        const current = await loadDexCollectionsMetaFromProfile(false);
        const requestedCollections = Array.isArray(payload?.collections)
            ? payload.collections
            : current.collections;
        const requestedActiveCollectionId = String(payload?.activeCollectionId || current.activeCollectionId || DEX_DEFAULT_COLLECTION_ID);

        const normalized = buildDexCollectionsMeta(
            requestedActiveCollectionId,
            requestedCollections,
            maxCollections
        );

        await root.set({
            dexCollections: normalized.collections,
            dexActiveCollectionId: normalized.activeCollectionId,
            dexCollectionsUpdatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        cacheDexCollectionsMeta(uid, normalized);
        return buildDexCollectionsMetaResult(normalized);
    }

    function normalizeShareToken(value) {
        const token = String(value || '').trim();
        return SHARE_TOKEN_REGEX.test(token) ? token : '';
    }

    function randomShareToken() {
        const bytes = new Uint8Array(18);
        try {
            const cryptoObj = window.crypto || window.msCrypto;
            if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
                cryptoObj.getRandomValues(bytes);
            } else {
                for (let i = 0; i < bytes.length; i += 1) {
                    bytes[i] = Math.floor(Math.random() * 256);
                }
            }
        } catch {
            for (let i = 0; i < bytes.length; i += 1) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }

        let base64 = '';
        for (let i = 0; i < bytes.length; i += 1) {
            base64 += String.fromCharCode(bytes[i]);
        }

        return btoa(base64)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
    }

    function buildDexShareUrlFromToken(token) {
        const safeToken = normalizeShareToken(token);
        if (!safeToken) return '';

        const pageUrl = new URL('shared-collection.html', window.location.href);
        pageUrl.searchParams.set('share', safeToken);
        return pageUrl.href;
    }

    function buildDexShareSettingsResult(enabled, token) {
        const safeToken = normalizeShareToken(token);
        const canShare = Boolean(enabled) && Boolean(safeToken);
        return {
            enabled: canShare,
            token: safeToken,
            shareUrl: canShare ? buildDexShareUrlFromToken(safeToken) : '',
        };
    }

    function normalizeDexShareSettings(raw) {
        const token = normalizeShareToken(raw?.token || raw?.dexShareToken);
        const enabled = Boolean(raw?.enabled ?? raw?.dexShareEnabled) && Boolean(token);
        return { enabled, token };
    }

    function cacheDexShareSettings(uid, settings) {
        dexShareSettingsCache.uid = String(uid || '');
        dexShareSettingsCache.loaded = true;
        dexShareSettingsCache.enabled = Boolean(settings?.enabled);
        dexShareSettingsCache.token = normalizeShareToken(settings?.token);
    }

    async function loadDexShareSettingsFromProfile(forceRefresh) {
        const user = getUser();
        if (!user || !db) return { enabled: false, token: '' };

        const uid = String(user.uid || '');
        if (!uid) return { enabled: false, token: '' };

        if (!forceRefresh && dexShareSettingsCache.loaded && dexShareSettingsCache.uid === uid) {
            return {
                enabled: dexShareSettingsCache.enabled,
                token: dexShareSettingsCache.token,
            };
        }

        const root = userRootRef(uid);
        if (!root) return { enabled: false, token: '' };

        try {
            const snap = await root.get();
            const data = snap && snap.exists ? snap.data() : null;
            const settings = normalizeDexShareSettings(data || {});
            cacheDexShareSettings(uid, settings);
            return settings;
        } catch {
            return { enabled: false, token: '' };
        }
    }

    async function syncSharedDexSnapshotForUser(uid, settings, collection) {
        const ownerUid = String(uid || '').trim();
        const token = normalizeShareToken(settings?.token);
        if (!ownerUid || !token) return;

        const ref = dexSharedDocRef(token);
        if (!ref) return;

        const canShare = Boolean(settings?.enabled);
        const safeCollection = Array.isArray(collection) ? collection : [];

        const payload = {
            enabled: canShare,
            ownerUid,
            collection: canShare ? safeCollection : [],
            updatedAt: Date.now(),
            updatedAtServer: window.firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (!canShare) {
            payload.disabledAtServer = window.firebase.firestore.FieldValue.serverTimestamp();
        }

        await ref.set(payload, { merge: true });
    }

    async function loadDexShareSettings() {
        const settings = await loadDexShareSettingsFromProfile(false);
        return buildDexShareSettingsResult(settings.enabled, settings.token);
    }

    async function saveDexShareSettings(payload) {
        const user = getUser();
        if (!user || !db) throw new Error('Sign in before changing sharing settings.');

        const uid = String(user.uid || '');
        if (!uid) throw new Error('User session missing UID.');

        const root = userRootRef(uid);
        if (!root) throw new Error('Firestore unavailable.');

        const requestedEnabled = Boolean(payload?.enabled);
        const providedToken = normalizeShareToken(payload?.token);
        const current = await loadDexShareSettingsFromProfile(false);
        const token = providedToken || current.token || randomShareToken();
        const settings = {
            enabled: requestedEnabled && Boolean(token),
            token,
        };

        await root.set({
            dexShareEnabled: settings.enabled,
            dexShareToken: settings.token,
            dexShareUpdatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        cacheDexShareSettings(uid, settings);

        const dexState = await loadDexState();
        await syncSharedDexSnapshotForUser(uid, settings, dexState.collection);

        return buildDexShareSettingsResult(settings.enabled, settings.token);
    }

    async function loadSharedDexCollection(tokenRaw) {
        const token = normalizeShareToken(tokenRaw);
        if (!token || !db) throw new Error('Invalid share link.');

        const ref = dexSharedDocRef(token);
        if (!ref) throw new Error('Shared collection is unavailable right now.');

        try {
            const snap = await ref.get();
            if (!snap.exists) {
                throw new Error('This collection is not currently shared.');
            }

            const data = snap.data();
            const enabled = Boolean(data?.enabled);
            if (!enabled) {
                throw new Error('This collection is not currently shared.');
            }

            const collection = Array.isArray(data?.collection) ? data.collection : [];
            return { collection };
        } catch (error) {
            const code = String(error?.code || '').toLowerCase();
            if (code === 'permission-denied') {
                throw new Error('This collection is not currently shared.');
            }
            throw error;
        }
    }

    async function loadDexState() {
        const user = getUser();
        if (!user || !db) return { collection: [], masterSets: {} };
        const ref = dexStateDocRef(user.uid);
        if (!ref) return { collection: [], masterSets: {} };

        try {
            const snap = await ref.get();
            if (!snap.exists) return { collection: [], masterSets: {} };
            const data = snap.data();
            const collection = Array.isArray(data?.collection) ? data.collection : [];
            const masterSets = (data?.masterSets && typeof data.masterSets === 'object') ? data.masterSets : {};
            return { collection, masterSets };
        } catch {
            return { collection: [], masterSets: {} };
        }
    }

    async function saveDexState(payload) {
        const user = getUser();
        if (!user || !db) return;
        const ref = dexStateDocRef(user.uid);
        if (!ref) return;

        let collection = Array.isArray(payload?.collection) ? payload.collection : [];
        const masterSets = (payload?.masterSets && typeof payload.masterSets === 'object') ? payload.masterSets : {};

        try {
            const role = await loadCurrentRoleFromClaims(false);
            if (!isPremiumRole(role)) {
                collection = collection.map((entry) => {
                    if (!entry || typeof entry !== 'object') return entry;
                    return {
                        ...entry,
                        collectionId: DEX_DEFAULT_COLLECTION_ID,
                    };
                });
            }
        } catch {
            // ignore role read issues and save the payload as-is
        }

        await ref.set({
            collection,
            masterSets,
            updatedAt: Date.now(),
            updatedAtServer: window.firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        try {
            const settings = await loadDexShareSettingsFromProfile(false);
            await syncSharedDexSnapshotForUser(user.uid, settings, collection);
        } catch {
            // ignore share-sync failures so Dex save still succeeds
        }
    }

    window.PV_AUTH = {
        isReady: () => true,
        getUser,
        onAuthStateChanged,
        signInWithGoogle,
        signUpWithEmail,
        signInWithEmail,
        signOut,
        deleteAccount,
        getIdToken,
        getIdTokenResult,
        callFunction,
        db,
        functions,
        loadFavorites,
        saveFavorite,
        removeFavorite,
        loadWatchlist,
        saveWatchlistItem,
        removeWatchlistItem,
        loadDexState,
        saveDexState,
        loadDexShareSettings,
        saveDexShareSettings,
        loadSharedDexCollection,
        loadDexCollectionsMeta,
        saveDexCollectionsMeta,
    };
})();
