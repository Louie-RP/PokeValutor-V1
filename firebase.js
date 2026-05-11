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

        const collection = Array.isArray(payload?.collection) ? payload.collection : [];
        const masterSets = (payload?.masterSets && typeof payload.masterSets === 'object') ? payload.masterSets : {};

        await ref.set({
            collection,
            masterSets,
            updatedAt: Date.now(),
            updatedAtServer: window.firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    window.PV_AUTH = {
        isReady: () => true,
        getUser,
        onAuthStateChanged,
        signInWithGoogle,
        signUpWithEmail,
        signInWithEmail,
        signOut,
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
    };
})();
