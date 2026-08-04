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
            loadDexState: async () => ({ collection: [], masterSets: {}, revision: 0, updatedAt: 0 }),
            saveDexState: async () => ({ saved: false, revision: 0, updatedAt: 0 }),
            loadCollectionValueSnapshot: async () => null,
            loadDexShareSettings: async () => ({ enabled: false, token: '', shareUrl: '' }),
            saveDexShareSettings: async () => ({ enabled: false, token: '', shareUrl: '' }),
            loadSharedDexCollection: async () => ({
                collection: [],
                activeCollectionId: 'default',
                collections: [{ id: 'default', name: 'Default Collection' }],
            }),
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
            loadDexState: async () => ({ collection: [], masterSets: {}, revision: 0, updatedAt: 0 }),
            saveDexState: async () => ({ saved: false, revision: 0, updatedAt: 0 }),
            loadCollectionValueSnapshot: async () => null,
            loadDexShareSettings: async () => ({ enabled: false, token: '', shareUrl: '' }),
            saveDexShareSettings: async () => ({ enabled: false, token: '', shareUrl: '' }),
            loadSharedDexCollection: async () => ({
                collection: [],
                activeCollectionId: 'default',
                collections: [{ id: 'default', name: 'Default Collection' }],
            }),
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
    const WATCHLIST_CLOUD_CACHE_PREFIX = 'pv:scrydex:watchlistCloud:v1:';
    const WATCHLIST_CLOUD_CACHE_TTL_MS = 8 * 60 * 60 * 1000;

    function getWatchlistCloudCacheKey(uid, kind) {
        return `${WATCHLIST_CLOUD_CACHE_PREFIX}${String(uid || '').trim()}:${String(kind || 'card').trim()}`;
    }

    function readWatchlistCloudCache(uid, kind) {
        try {
            const raw = window.localStorage.getItem(getWatchlistCloudCacheKey(uid, kind));
            const cached = raw ? JSON.parse(raw) : null;
            if (!cached || !Array.isArray(cached.value) || Date.now() - Number(cached.savedAt || 0) >= WATCHLIST_CLOUD_CACHE_TTL_MS) {
                return null;
            }
            return cached.value;
        } catch {
            return null;
        }
    }

    function writeWatchlistCloudCache(uid, kind, value) {
        try {
            window.localStorage.setItem(getWatchlistCloudCacheKey(uid, kind), JSON.stringify({
                savedAt: Date.now(),
                value: Array.isArray(value) ? value : [],
            }));
        } catch {
            // ignore storage errors
        }
    }

    function invalidateWatchlistCloudCache(uid, kind) {
        try { window.localStorage.removeItem(getWatchlistCloudCacheKey(uid, kind)); } catch { /* ignore */ }
    }

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
            if (queryOverride != null) {
                try {
                    window.localStorage.setItem('pv:functions:emulator', queryOverride ? '1' : '0');
                } catch {
                    // ignore storage write errors
                }
                return queryOverride;
            }
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

    async function readCollectionWithStatus(ref) {
        if (!ref) return { ok: false, items: [] };
        try {
            const snap = await ref.get();
            const items = [];
            snap.forEach((doc) => {
                const data = doc.data();
                if (data && typeof data === 'object') items.push(data);
            });
            return { ok: true, items };
        } catch {
            return { ok: false, items: [] };
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
        const cached = readWatchlistCloudCache(user.uid, kind);
        if (cached) return cached;
        const watchRef = watchlistCollectionRef(user.uid, kind);
        if (!watchRef) return [];

        // Migration behavior: when Watchlist is requested, also read legacy Favorites
        // and merge any missing items into Watchlist. This prevents data loss for
        // existing users while the UI and localStorage are renamed.
        const favRef = favoritesCollectionRef(user.uid, kind);
        const [watchResult, legacyResult] = await Promise.all([
            readCollectionWithStatus(watchRef),
            readCollectionWithStatus(favRef),
        ]);

        const byId = new Map();
        for (const item of watchResult.items) {
            const id = String(item?.id || '').trim();
            if (!id) continue;
            byId.set(id, item);
        }

        // Do not cache a failed read as an empty watchlist. Keep valid watchlist
        // data available, but retry legacy migration on a later page load.
        if (!watchResult.ok) return [];
        if (!legacyResult.ok) return Array.from(byId.values());

        /** @type {Array<any>} */
        const toMigrate = [];
        for (const item of legacyResult.items) {
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

        const result = Array.from(byId.values());
        writeWatchlistCloudCache(user.uid, kind, result);
        return result;
    }

    async function saveWatchlistItem(kind, item) {
        const user = getUser();
        if (!user || !db) return;
        invalidateWatchlistCloudCache(user.uid, kind);
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
        invalidateWatchlistCloudCache(user.uid, kind);
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
    const DEX_MAX_COLLECTIONS_PREMIUM = 3;

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

        try {
            const [settings, dexState] = await Promise.all([
                loadDexShareSettingsFromProfile(false),
                loadDexState(),
            ]);
            await syncSharedDexSnapshotForUser(uid, settings, dexState.collection, normalized);
        } catch {
            // ignore share-sync failures so metadata save still succeeds
        }

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

    const DEX_CLOUD_DOC_SOFT_LIMIT_BYTES = 900000;

    function estimateJsonSizeBytes(value) {
        try {
            const text = JSON.stringify(value);
            if (typeof TextEncoder !== 'undefined') {
                return new TextEncoder().encode(text).length;
            }
            return String(text || '').length;
        } catch {
            return Number.MAX_SAFE_INTEGER;
        }
    }

    function isFirestorePayloadTooLarge(error) {
        const code = String(error?.code || '').toLowerCase();
        const message = String(error?.message || '').toLowerCase();
        if (code.includes('resource-exhausted') || code.includes('failed-precondition')) return true;
        return /too large|maximum size|exceeds.*size|larger than/i.test(message);
    }

    function compactCollectionString(value, maxLength, fallback) {
        const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
        const candidate = raw || String(fallback || '').replace(/\s+/g, ' ').trim();
        if (!candidate) return '';
        return candidate.slice(0, Math.max(1, Math.floor(Number(maxLength) || 1)));
    }

    function compactCollectionTimestamp(value, fallback) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
        const f = Number(fallback);
        if (Number.isFinite(f) && f > 0) return f;
        return Date.now();
    }

    function compactCollectionMarket(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return null;
        return Math.round(n * 100) / 100;
    }

    function compactCollectionConditionCode(value) {
        const upper = String(value || '').trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
        if (!upper) return '';
        if (upper === 'NM' || upper.startsWith('NEAR MINT')) return 'NM';
        if (upper === 'LP' || upper.startsWith('LIGHT PLAY')) return 'LP';
        if (upper === 'MP' || upper.startsWith('MODERATE PLAY') || upper.startsWith('MID PLAY')) return 'MP';
        if (upper === 'HP' || upper.startsWith('HEAVY PLAY')) return 'HP';
        if (upper === 'DM' || upper.startsWith('DAMAGE')) return 'DM';
        return upper.slice(0, 12);
    }

    function compactCollectionQuantities(rawMap, keyNormalizer, fallbackKey) {
        const out = {};
        if (rawMap && typeof rawMap === 'object') {
            for (const [rawKey, rawQty] of Object.entries(rawMap)) {
                const key = keyNormalizer(rawKey);
                if (!key) continue;
                const qty = Math.floor(Number(rawQty));
                if (!Number.isFinite(qty) || qty <= 0) continue;
                out[key] = Math.min(9999, (out[key] || 0) + qty);
            }
        }

        if (!Object.keys(out).length) {
            const fallback = keyNormalizer(fallbackKey);
            if (fallback) out[fallback] = 1;
        }

        return out;
    }

    function compactCollectionImageList(rawImages) {
        const imageCandidates = [];

        if (Array.isArray(rawImages)) {
            imageCandidates.push(...rawImages);
        } else if (typeof rawImages === 'string') {
            imageCandidates.push({ type: 'front', small: rawImages, medium: rawImages, large: rawImages });
        } else if (rawImages && typeof rawImages === 'object') {
            imageCandidates.push(rawImages);
        }

        if (!imageCandidates.length) return [];

        const front = imageCandidates.find((img) => String(img?.type || '').trim().toLowerCase() === 'front');
        const chosen = front || imageCandidates[0];
        const small = compactCollectionString(chosen?.small ?? chosen?.thumbnail ?? chosen?.url ?? chosen?.src, 500, '');
        const medium = compactCollectionString(chosen?.medium ?? chosen?.small ?? chosen?.url ?? chosen?.src, 500, '');
        const large = compactCollectionString(chosen?.large ?? chosen?.medium ?? chosen?.small ?? chosen?.url ?? chosen?.src, 500, '');

        if (!small && !medium && !large) return [];
        return [{ type: 'front', small, medium, large }];
    }

    function compactCollectionSetLike(rawSet) {
        if (!rawSet || typeof rawSet !== 'object') return null;

        const out = {
            id: compactCollectionString(rawSet?.id, 80, ''),
            name: compactCollectionString(rawSet?.name, 120, ''),
            series: compactCollectionString(rawSet?.series, 80, ''),
            printed_total: Math.max(0, Math.floor(Number(rawSet?.printed_total ?? rawSet?.printedTotal ?? 0) || 0)),
            total: Math.max(0, Math.floor(Number(rawSet?.total ?? 0) || 0)),
            logo: compactCollectionString(rawSet?.logo ?? rawSet?.images?.logo, 500, ''),
            symbol: compactCollectionString(rawSet?.symbol ?? rawSet?.images?.symbol, 500, ''),
            image: compactCollectionString(rawSet?.image ?? rawSet?.images?.logo ?? rawSet?.images?.symbol, 500, ''),
        };

        if (!out.id && !out.name && !out.series && !out.printed_total && !out.total && !out.logo && !out.symbol && !out.image) {
            return null;
        }

        return out;
    }

    function compactCollectionPrices(rawPrices, maxPrices) {
        if (!Array.isArray(rawPrices)) return [];
        const out = [];
        for (const raw of rawPrices) {
            if (!raw || typeof raw !== 'object') continue;
            const market = compactCollectionMarket(raw?.market ?? raw?.marketPrice ?? raw?.market_price);
            if (market == null) continue;
            out.push({
                condition: compactCollectionConditionCode(raw?.condition),
                market,
            });
            if (out.length >= maxPrices) break;
        }
        return out;
    }

    function compactCollectionVariants(rawVariants, aggressive) {
        if (!Array.isArray(rawVariants)) return [];

        const maxVariants = aggressive ? 8 : 18;
        const maxPrices = aggressive ? 3 : 8;
        const out = [];

        for (const raw of rawVariants) {
            if (!raw || typeof raw !== 'object') continue;

            const name = compactCollectionString(raw?.name, 80, '');
            const prices = compactCollectionPrices(raw?.prices, maxPrices);
            const fallbackMarket = compactCollectionMarket(raw?.market ?? raw?.marketPrice ?? raw?.market_price);

            if (!name && !prices.length && fallbackMarket == null) continue;

            const variant = {
                name,
                prices,
            };

            if (!variant.prices.length && fallbackMarket != null) {
                variant.prices = [{ condition: 'NM', market: fallbackMarket }];
            }

            if (!variant.prices.length && aggressive) continue;

            out.push(variant);
            if (out.length >= maxVariants) break;
        }

        return out;
    }

    function compactDexCollectionForCloud(rawCollection, aggressive) {
        if (!Array.isArray(rawCollection)) return [];

        const out = [];
        for (const raw of rawCollection) {
            if (!raw || typeof raw !== 'object') continue;

            const id = compactCollectionString(raw?.id, 120, '');
            if (!id) continue;

            const itemType = String(raw?.itemType || '').trim().toLowerCase() === 'sealed' ? 'sealed' : 'card';
            const collectionId = normalizeDexCollectionId(raw?.collectionId, DEX_DEFAULT_COLLECTION_ID);
            const entry = {
                itemType,
                collectionId,
                id,
                name: compactCollectionString(raw?.name, 160, 'Unknown'),
                setName: compactCollectionString(raw?.setName, 120, ''),
                expansionName: compactCollectionString(raw?.expansionName, 120, ''),
                images: compactCollectionImageList(raw?.images),
                variants: compactCollectionVariants(raw?.variants, aggressive),
                selectedVariant: compactCollectionString(raw?.selectedVariant, 80, ''),
                addedAt: compactCollectionTimestamp(raw?.addedAt, Date.now()),
                updatedAt: compactCollectionTimestamp(raw?.updatedAt, Date.now()),
            };

            const directMarket = compactCollectionMarket(raw?.market ?? raw?.marketPrice ?? raw?.market_price ?? raw?.price ?? raw?.value);
            if (directMarket != null) {
                entry.market = directMarket;
            }

            if (itemType === 'sealed') {
                entry.baseProductId = compactCollectionString(raw?.baseProductId, 120, '');
                entry.variantName = compactCollectionString(raw?.variantName, 80, '');
                entry.variantLabel = compactCollectionString(raw?.variantLabel, 80, '');
                entry.hasMultipleVariants = raw?.hasMultipleVariants === true;
                entry.type = compactCollectionString(raw?.type, 120, 'Sealed product');
                entry.quantity = Math.max(1, Math.floor(Number(raw?.quantity ?? raw?.sealedQuantity ?? 1) || 1));
            } else {
                entry.rarity = compactCollectionString(raw?.rarity, 80, '');
                entry.type = compactCollectionString(raw?.type, 120, '');
                entry.card_no = compactCollectionString(raw?.card_no ?? raw?.cardNo ?? raw?.number ?? raw?.cardNumber, 32, '');
                entry.number = compactCollectionString(raw?.number ?? raw?.card_no ?? raw?.cardNo ?? raw?.cardNumber, 32, '');
                entry.selectedCondition = compactCollectionConditionCode(raw?.selectedCondition);
                entry.conditionQuantities = compactCollectionQuantities(
                    raw?.conditionQuantities,
                    compactCollectionConditionCode,
                    raw?.selectedCondition
                );
                entry.variantQuantities = compactCollectionQuantities(
                    raw?.variantQuantities,
                    (value) => compactCollectionString(value, 80, ''),
                    ''
                );
            }

            const compactExpansion = compactCollectionSetLike(raw?.expansion);
            if (compactExpansion) entry.expansion = compactExpansion;
            const compactSet = compactCollectionSetLike(raw?.set);
            if (compactSet) entry.set = compactSet;

            if (!entry.setName) {
                entry.setName = compactCollectionString(compactSet?.name || compactExpansion?.name, 120, '');
            }
            if (!entry.expansionName) {
                entry.expansionName = compactCollectionString(compactExpansion?.name || compactSet?.name, 120, '');
            }

            out.push(entry);
        }

        return out;
    }

    function compactDexMasterSetsForCloud(rawMasterSets) {
        if (!rawMasterSets || typeof rawMasterSets !== 'object') return {};

        const out = {};
        for (const [key, rawEntry] of Object.entries(rawMasterSets)) {
            if (!rawEntry || typeof rawEntry !== 'object') continue;

            const expansionId = compactCollectionString(rawEntry?.expansionId ?? key, 80, '');
            if (!expansionId) continue;

            const cardIds = Array.isArray(rawEntry?.cardIds)
                ? Array.from(new Set(rawEntry.cardIds.map((id) => compactCollectionString(id, 120, '')).filter(Boolean)))
                : [];

            out[expansionId] = {
                expansionId,
                expansionName: compactCollectionString(rawEntry?.expansionName, 120, 'Unknown Set'),
                series: compactCollectionString(rawEntry?.series, 80, ''),
                setImage: compactCollectionString(rawEntry?.setImage, 500, ''),
                targetCount: Math.max(0, Math.floor(Number(rawEntry?.targetCount || 0) || 0)) || null,
                cardIds,
                count: cardIds.length,
                updatedAt: compactCollectionTimestamp(rawEntry?.updatedAt, Date.now()),
            };
        }

        return out;
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

    async function syncSharedDexSnapshotForUser(uid, settings, collection, collectionsMeta) {
        const ownerUid = String(uid || '').trim();
        const token = normalizeShareToken(settings?.token);
        if (!ownerUid || !token) return;

        const ref = dexSharedDocRef(token);
        if (!ref) return;

        const canShare = Boolean(settings?.enabled);
        let safeCollection = canShare ? compactDexCollectionForCloud(collection, false) : [];
        const normalizedMeta = buildDexCollectionsMetaResult(collectionsMeta || {});

        const payload = {
            enabled: canShare,
            ownerUid,
            collection: canShare ? safeCollection : [],
            activeCollectionId: normalizedMeta.activeCollectionId,
            collections: normalizedMeta.collections.map((entry) => ({
                id: entry.id,
                name: entry.name,
            })),
            updatedAt: Date.now(),
            updatedAtServer: window.firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (!canShare) {
            payload.disabledAtServer = window.firebase.firestore.FieldValue.serverTimestamp();
        }

        if (canShare && estimateJsonSizeBytes(payload) > DEX_CLOUD_DOC_SOFT_LIMIT_BYTES) {
            safeCollection = compactDexCollectionForCloud(collection, true);
            payload.collection = safeCollection;
        }

        try {
            await ref.set(payload, { merge: true });
        } catch (error) {
            if (!canShare || !isFirestorePayloadTooLarge(error)) throw error;
            payload.collection = compactDexCollectionForCloud(collection, true);
            await ref.set(payload, { merge: true });
        }
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

        const [dexState, dexCollectionsMeta] = await Promise.all([
            loadDexState(),
            loadDexCollectionsMetaFromProfile(false),
        ]);
        await syncSharedDexSnapshotForUser(uid, settings, dexState.collection, dexCollectionsMeta);

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
            const activeCollectionId = normalizeDexCollectionId(
                data?.activeCollectionId,
                DEX_DEFAULT_COLLECTION_ID
            );
            const collectionsRaw = Array.isArray(data?.collections)
                ? data.collections
                : Array.isArray(data?.dexCollections)
                    ? data.dexCollections
                    : [defaultDexCollectionEntry()];
            const collections = normalizeDexCollections(collectionsRaw, DEX_MAX_COLLECTIONS_PREMIUM).map((entry) => ({
                id: entry.id,
                name: entry.name,
            }));

            return {
                collection,
                activeCollectionId,
                collections,
            };
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
        if (!user || !db) return { collection: [], masterSets: {}, revision: 0, updatedAt: 0 };
        const ref = dexStateDocRef(user.uid);
        if (!ref) return { collection: [], masterSets: {}, revision: 0, updatedAt: 0 };

        try {
            const snap = await ref.get();
            if (!snap.exists) return { collection: [], masterSets: {}, revision: 0, updatedAt: 0 };
            const data = snap.data();
            const collection = Array.isArray(data?.collection) ? data.collection : [];
            const masterSets = (data?.masterSets && typeof data.masterSets === 'object') ? data.masterSets : {};
            const revision = Math.max(0, Math.floor(Number(data?.revision) || 0));
            const updatedAt = Math.max(0, Number(data?.updatedAt) || 0);
            return { collection, masterSets, revision, updatedAt };
        } catch {
            return { collection: [], masterSets: {}, revision: 0, updatedAt: 0 };
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

        let collectionForCloud = compactDexCollectionForCloud(collection, false);
        const masterSetsForCloud = compactDexMasterSetsForCloud(masterSets);
        const expectedRevision = Math.max(0, Math.floor(Number(payload?.revision) || 0));
        const requestedUpdatedAt = Math.max(0, Number(payload?.updatedAt) || 0);
        const nextUpdatedAt = Math.max(Date.now(), requestedUpdatedAt);
        const basePayload = {
            collection: collectionForCloud,
            masterSets: masterSetsForCloud,
            revision: expectedRevision + 1,
            updatedAt: nextUpdatedAt,
            updatedAtServer: window.firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (estimateJsonSizeBytes(basePayload) > DEX_CLOUD_DOC_SOFT_LIMIT_BYTES) {
            collectionForCloud = compactDexCollectionForCloud(collection, true);
            basePayload.collection = collectionForCloud;
        }

        const saveWithTransaction = async () => {
            return db.runTransaction(async (transaction) => {
                const snap = await transaction.get(ref);
                const current = snap.exists ? (snap.data() || {}) : {};
                const currentRevision = Math.max(0, Math.floor(Number(current?.revision) || 0));
                const currentUpdatedAt = Math.max(0, Number(current?.updatedAt) || 0);

                if (currentRevision !== expectedRevision) {
                    return {
                        saved: false,
                        conflict: true,
                        revision: currentRevision,
                        updatedAt: currentUpdatedAt,
                        collection: Array.isArray(current?.collection) ? current.collection : [],
                        masterSets: (current?.masterSets && typeof current.masterSets === 'object')
                            ? current.masterSets
                            : {},
                    };
                }

                transaction.set(ref, basePayload, { merge: true });
                return {
                    saved: true,
                    conflict: false,
                    revision: basePayload.revision,
                    updatedAt: basePayload.updatedAt,
                    collection: collectionForCloud,
                    masterSets: masterSetsForCloud,
                };
            });
        };

        let saveResult;
        try {
            saveResult = await saveWithTransaction();
        } catch (error) {
            if (!isFirestorePayloadTooLarge(error)) throw error;
            basePayload.collection = compactDexCollectionForCloud(collection, true);
            collectionForCloud = basePayload.collection;
            saveResult = await saveWithTransaction();
        }

        if (!saveResult?.saved) return saveResult;

        try {
            const settings = await loadDexShareSettingsFromProfile(false);
            const dexCollectionsMeta = await loadDexCollectionsMetaFromProfile(false);
            await syncSharedDexSnapshotForUser(user.uid, settings, collectionForCloud, dexCollectionsMeta);
        } catch {
            // ignore share-sync failures so Dex save still succeeds
        }

        return saveResult;
    }

    async function loadCollectionValueSnapshot(collectionId) {
        const selectedCollectionId = String(collectionId || DEX_DEFAULT_COLLECTION_ID).trim() || DEX_DEFAULT_COLLECTION_ID;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        return callFunction('getCollectionValueSnapshot', {
            collectionId: selectedCollectionId,
            timezone,
            useLiveWorkerPrices: true,
        });
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
        loadCollectionValueSnapshot,
        loadDexShareSettings,
        saveDexShareSettings,
        loadSharedDexCollection,
        loadDexCollectionsMeta,
        saveDexCollectionsMeta,
    };

    // Central sign-out handler: runs on every page since firebase.js is loaded everywhere.
    // Clears user-specific localStorage data so it cannot bleed into a different account
    // after sign-out. Only clears on an actual sign-out (not on initial load while signed out).
    let _pvWasSignedIn = false;
    auth.onAuthStateChanged((user) => {
        if (user) {
            _pvWasSignedIn = true;
        } else if (_pvWasSignedIn) {
            _pvWasSignedIn = false;
            try {
                const P = 'pv:scrydex:';
                [
                    `${P}watchlist:v1`,
                    `${P}favorites:v1`,
                    `${P}collection:v1`,
                    `${P}masterSets:v1`,
                    `${P}dexOwnerUid:v1`,
                    `${P}dexCloudRevision:v1`,
                    `${P}dexStateUpdatedAt:v1`,
                    'pv:quota:last:v1',
                ].forEach((key) => {
                    try { localStorage.removeItem(key); } catch { }
                });
            } catch {
                // ignore storage errors
            }
        }
    });
})();
