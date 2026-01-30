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
        return auth.signInWithPopup(provider);
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

    async function loadFavorites(kind) {
        const user = getUser();
        if (!user || !db) return [];
        const ref = favoritesCollectionRef(user.uid, kind);
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
        const ref = watchlistCollectionRef(user.uid, kind);
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
        const ref = watchlistCollectionRef(user.uid, kind);
        if (!ref) return;
        const docId = String(id || '').trim();
        if (!docId) return;
        await ref.doc(docId).delete();
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
    };
})();
