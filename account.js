/* Account page behavior (Firebase Auth) */
document.addEventListener('DOMContentLoaded', function () {
    const emailEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-auth-email'));
    const passEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-auth-password'));
    const statusEl = document.getElementById('pv-auth-status');
    const selfCheckEl = document.getElementById('pv-auth-selfcheck');
    const roleEl = document.getElementById('pv-auth-role');
    const uidEl = document.getElementById('pv-auth-uid');
    const formStatusEl = document.getElementById('pv-auth-form-status');
    const formSelfCheckEl = document.getElementById('pv-auth-form-selfcheck');
    const signInCardEl = document.getElementById('pv-auth-signin-card');
    const sessionCardEl = document.getElementById('pv-auth-session-card');
    const heroBadgeEl = document.getElementById('pv-auth-hero-badge');
    const profileEl = document.getElementById('pv-auth-profile');
    const profileAvatarEl = /** @type {HTMLImageElement} */ (document.getElementById('pv-auth-avatar'));
    const profileAvatarFallbackEl = document.getElementById('pv-auth-avatar-fallback');
    const profileNameEl = document.getElementById('pv-auth-displayname');
    const profileEmailEl = document.getElementById('pv-auth-email-display');
    const sensitiveRevealTimers = new WeakMap();

    const adminDivider = document.getElementById('pv-admin-panel');
    const adminTools = document.getElementById('pv-admin-tools');
    const adminUidEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-admin-uid'));
    const adminRoleEl = /** @type {HTMLSelectElement} */ (document.getElementById('pv-admin-role'));
    const adminSetRoleBtn = document.getElementById('pv-admin-set-role');
    const adminFillSelfBtn = document.getElementById('pv-admin-fill-self');
    const adminStatusEl = document.getElementById('pv-admin-status');
    const adminRefreshLatestSetsBtn = document.getElementById('pv-admin-refresh-latest-sets');
    const adminRefreshLatestSetsStatusEl = document.getElementById('pv-admin-refresh-latest-sets-status');

    const billingPanelEl = document.getElementById('pv-billing-panel');
    const billingStatusEl = document.getElementById('pv-billing-status');
    const billingSubscribeBtn = document.getElementById('pv-billing-subscribe');
    const billingManageBtn = document.getElementById('pv-billing-manage');
    const premiumToolsPanelEl = document.getElementById('pv-premium-tools-panel');
    const premiumToolsStatusEl = document.getElementById('pv-premium-tools-status');
    const premiumExportCsvBtn = document.getElementById('pv-premium-export-csv');
    const premiumExportJsonBtn = document.getElementById('pv-premium-export-json');
    const premiumExportCollectionSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('pv-premium-export-collection-select'));
    const premiumCollectionSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('pv-premium-collection-select'));
    const premiumCollectionNameEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-premium-collection-name'));
    const premiumCollectionCreateBtn = document.getElementById('pv-premium-collection-create');
    const premiumCollectionDeleteBtn = document.getElementById('pv-premium-collection-delete');

    const signInBtn = document.getElementById('pv-auth-signin');
    const signUpBtn = document.getElementById('pv-auth-signup');
    const googleBtn = document.getElementById('pv-auth-google');
    const signOutBtn = document.getElementById('pv-auth-signout');
    const deleteBtn = document.getElementById('pv-auth-delete');
    const dexPanelEl = document.getElementById('pv-dex-panel');
    const dexStatusEl = document.getElementById('pv-dex-status');
    const dexClearCollectionBtn = document.getElementById('pv-dex-clear-collection');
    const dexClearMasterSetsBtn = document.getElementById('pv-dex-clear-master-sets');
    const dexSharePanelEl = document.getElementById('pv-dex-share-panel');
    const dexShareEnabledEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-dex-share-enabled'));
    const dexShareLinkEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-dex-share-link'));
    const dexShareCopyBtn = document.getElementById('pv-dex-share-copy');
    const dexShareStatusEl = document.getElementById('pv-dex-share-status');
    const localDexPanelEl = document.getElementById('pv-local-dex-panel');
    const localDexStatusEl = document.getElementById('pv-local-dex-status');
    const localDexGuardEl = document.getElementById('pv-local-dex-guard');
    const localDexAckEl = /** @type {HTMLInputElement} */ (document.getElementById('pv-local-dex-ack'));
    const localDexClearCollectionBtn = document.getElementById('pv-local-dex-clear-collection');
    const localDexClearMasterSetsBtn = document.getElementById('pv-local-dex-clear-master-sets');

    const DEX_CACHE_PREFIX = 'pv:scrydex:';
    const DEX_COLLECTION_KEY = `${DEX_CACHE_PREFIX}collection:v1`;
    const DEX_MASTER_SETS_KEY = `${DEX_CACHE_PREFIX}masterSets:v1`;
    const DEX_OWNER_UID_KEY = `${DEX_CACHE_PREFIX}dexOwnerUid:v1`;
    const DEX_COLLECTIONS_META_KEY = `${DEX_CACHE_PREFIX}collectionsMeta:v1`;
    const DEX_ACTIVE_COLLECTION_KEY = `${DEX_CACHE_PREFIX}activeCollectionId:v1`;
    const DEX_DEFAULT_COLLECTION_ID = 'default';
    const DEX_DEFAULT_COLLECTION_NAME = 'Default Collection';
    const DEX_MAX_COLLECTIONS_PREMIUM = 3;
    const HOME_URL_CACHE_PREFIX = 'pv:home:url:';
    const HOME_LATEST_EXPANSIONS_CACHE_PREFIX = 'pv:expansions:latestEnglish:';
    let localDexPanelVisible = false;
    let localDexBusy = false;
    let dexShareBusy = false;
    let dexShareUiSyncing = false;
    let dexShareState = {
        enabled: false,
        token: '',
        shareUrl: '',
    };
    let premiumToolsBusy = false;
    let currentRole = 'basic';
    let currentPremiumCollectionsMeta = {
        activeCollectionId: DEX_DEFAULT_COLLECTION_ID,
        collections: [{ id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME }],
    };

    // Temporary diagnostics helper for startup/auth setup issues.
    const ENABLE_AUTH_SELF_CHECK = true;

    function setStatus(msg) {
        const text = String(msg || '');
        if (statusEl) statusEl.textContent = text;
        if (formStatusEl) formStatusEl.textContent = text;
    }

    function setSelfCheck(msg) {
        if (!ENABLE_AUTH_SELF_CHECK || !selfCheckEl) return;
        const text = String(msg || '').trim();
        selfCheckEl.hidden = text.length === 0;
        selfCheckEl.textContent = text;
        if (formSelfCheckEl) {
            formSelfCheckEl.hidden = text.length === 0;
            formSelfCheckEl.textContent = text;
        }
    }

    function clearSelfCheck() {
        if (!selfCheckEl) return;
        selfCheckEl.hidden = true;
        selfCheckEl.textContent = '';
        if (formSelfCheckEl) {
            formSelfCheckEl.hidden = true;
            formSelfCheckEl.textContent = '';
        }
    }

    function setAuthViewMode(isSignedIn) {
        const signedIn = !!isSignedIn;
        if (signInCardEl) signInCardEl.hidden = signedIn;
        if (sessionCardEl) sessionCardEl.hidden = !signedIn;
        if (heroBadgeEl) heroBadgeEl.hidden = !signedIn;
    }

    function setRoleText(msg) {
        if (roleEl) roleEl.textContent = String(msg || '');
    }

    function setUidText(msg) {
        if (uidEl) uidEl.textContent = String(msg || '');
    }

    function revealSensitiveValue(el) {
        if (!(el instanceof HTMLElement)) return;

        el.classList.add('is-revealed');
        const existingTimer = sensitiveRevealTimers.get(el);
        if (existingTimer) {
            window.clearTimeout(existingTimer);
        }

        const timer = window.setTimeout(() => {
            el.classList.remove('is-revealed');
            sensitiveRevealTimers.delete(el);
        }, 4500);

        sensitiveRevealTimers.set(el, timer);
    }

    function setupSensitiveTapReveal() {
        const hasHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
        if (hasHover) return;

        const sensitiveNodes = document.querySelectorAll('.pv-sensitiveValue');
        sensitiveNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;

            node.addEventListener('click', () => revealSensitiveValue(node));
            node.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    revealSensitiveValue(node);
                }
            });
        });
    }

    function setAdminStatus(msg) {
        if (adminStatusEl) adminStatusEl.textContent = String(msg || '');
    }

    function setAdminRefreshLatestSetsStatus(msg) {
        if (adminRefreshLatestSetsStatusEl) {
            adminRefreshLatestSetsStatusEl.textContent = String(msg || '');
        }
    }

    function clearHomeLatestSetsCacheEntries() {
        try {
            const remove = [];
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (key.startsWith(HOME_URL_CACHE_PREFIX) || key.startsWith(HOME_LATEST_EXPANSIONS_CACHE_PREFIX)) {
                    remove.push(key);
                }
            }

            for (const key of remove) {
                localStorage.removeItem(key);
            }
            return remove.length;
        } catch {
            return 0;
        }
    }

    function setAdminVisible(isVisible) {
        const show = !!isVisible;
        if (adminDivider) adminDivider.hidden = !show;
        if (adminTools) adminTools.hidden = !show;
        if (!show) {
            setAdminStatus('');
            setAdminRefreshLatestSetsStatus('');
        }
    }

    function setBillingVisible(isVisible) {
        if (!billingPanelEl) return;
        billingPanelEl.hidden = !isVisible;
        if (!isVisible && billingStatusEl) billingStatusEl.textContent = '';
    }

    function setBillingStatus(msg) {
        if (!billingStatusEl) return;
        billingStatusEl.textContent = String(msg || '');
    }

    function setBillingButtonsDisabled(disabled) {
        const isDisabled = !!disabled;
        if (billingSubscribeBtn instanceof HTMLButtonElement) billingSubscribeBtn.disabled = isDisabled;
        if (billingManageBtn instanceof HTMLButtonElement) billingManageBtn.disabled = isDisabled;
    }

    function setDexStatus(msg) {
        if (!dexStatusEl) return;
        dexStatusEl.textContent = String(msg || '');
    }

    function setDexButtonsDisabled(disabled) {
        const isDisabled = !!disabled;
        if (dexClearCollectionBtn instanceof HTMLButtonElement) dexClearCollectionBtn.disabled = isDisabled;
        if (dexClearMasterSetsBtn instanceof HTMLButtonElement) dexClearMasterSetsBtn.disabled = isDisabled;
    }

    function setDexVisible(isVisible) {
        const show = !!isVisible;
        if (dexPanelEl) dexPanelEl.hidden = !show;
        setDexButtonsDisabled(!show);
        if (!show) setDexStatus('');
    }

    function normalizeDexShareState(raw) {
        const token = String(raw?.token || '').trim();
        const shareUrl = String(raw?.shareUrl || '').trim();
        const enabled = Boolean(raw?.enabled) && Boolean(token) && Boolean(shareUrl);
        return { enabled, token, shareUrl };
    }

    function setDexShareStatus(msg) {
        if (!dexShareStatusEl) return;
        dexShareStatusEl.textContent = String(msg || '');
    }

    function applyDexShareUiState() {
        dexShareUiSyncing = true;
        const hasLink = Boolean(dexShareState?.shareUrl);
        const sharingEnabled = Boolean(dexShareState?.enabled && hasLink);

        if (dexShareEnabledEl instanceof HTMLInputElement) {
            dexShareEnabledEl.checked = sharingEnabled;
            dexShareEnabledEl.disabled = dexShareBusy;
        }

        if (dexShareLinkEl instanceof HTMLInputElement) {
            dexShareLinkEl.value = hasLink ? dexShareState.shareUrl : '';
            dexShareLinkEl.placeholder = sharingEnabled
                ? 'Your share link is ready'
                : 'Enable sharing to generate a link';
        }

        if (dexShareCopyBtn instanceof HTMLButtonElement) {
            dexShareCopyBtn.disabled = dexShareBusy || !sharingEnabled || !hasLink;
        }

        dexShareUiSyncing = false;
    }

    function setDexShareBusy(isBusy) {
        dexShareBusy = !!isBusy;
        applyDexShareUiState();
    }

    function setDexShareVisible(isVisible) {
        const show = !!isVisible;
        if (dexSharePanelEl) dexSharePanelEl.hidden = !show;

        if (!show) {
            dexShareState = {
                enabled: false,
                token: '',
                shareUrl: '',
            };
            dexShareBusy = false;
            setDexShareStatus('');
        }

        applyDexShareUiState();
    }

    function isPremiumRole(role) {
        const normalized = String(role || '').trim().toLowerCase();
        return normalized === 'admin' || normalized === 'tester' || normalized === 'premium';
    }

    function setPremiumToolsVisible(isVisible) {
        if (!premiumToolsPanelEl) return;
        premiumToolsPanelEl.hidden = !Boolean(isVisible);
        if (!isVisible) {
            if (premiumCollectionNameEl instanceof HTMLInputElement) premiumCollectionNameEl.value = '';
            setPremiumToolsStatus('');
        }
    }

    function setPremiumToolsStatus(msg) {
        if (!premiumToolsStatusEl) return;
        premiumToolsStatusEl.textContent = String(msg || '');
    }

    function setPremiumToolsBusy(isBusy) {
        premiumToolsBusy = Boolean(isBusy);
        const disableWriteControls = premiumToolsBusy || !isPremiumRole(currentRole);

        if (premiumExportCollectionSelectEl instanceof HTMLSelectElement) {
            premiumExportCollectionSelectEl.disabled = disableWriteControls;
        }
        if (premiumCollectionSelectEl instanceof HTMLSelectElement) {
            premiumCollectionSelectEl.disabled = premiumToolsBusy;
        }
        if (premiumCollectionNameEl instanceof HTMLInputElement) {
            premiumCollectionNameEl.disabled = disableWriteControls;
        }
        if (premiumCollectionCreateBtn instanceof HTMLButtonElement) {
            premiumCollectionCreateBtn.disabled = disableWriteControls;
        }
        if (premiumCollectionDeleteBtn instanceof HTMLButtonElement) {
            premiumCollectionDeleteBtn.disabled = disableWriteControls;
        }
        if (premiumExportCsvBtn instanceof HTMLButtonElement) {
            premiumExportCsvBtn.disabled = disableWriteControls;
        }
        if (premiumExportJsonBtn instanceof HTMLButtonElement) {
            premiumExportJsonBtn.disabled = disableWriteControls;
        }
    }

    function normalizeCollectionId(value, fallback) {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
        if (!normalized) return String(fallback || DEX_DEFAULT_COLLECTION_ID);
        return normalized;
    }

    function normalizeCollectionName(value, fallback) {
        const raw = String(value || '').replace(/\s+/g, ' ').trim();
        const candidate = raw || String(fallback || '').replace(/\s+/g, ' ').trim();
        if (!candidate) return DEX_DEFAULT_COLLECTION_NAME;
        return candidate.slice(0, 50);
    }

    function normalizeCollectionTimestamp(value, fallback) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
        const f = Number(fallback);
        if (Number.isFinite(f) && f > 0) return f;
        return Date.now();
    }

    function defaultCollectionsMeta() {
        return {
            activeCollectionId: DEX_DEFAULT_COLLECTION_ID,
            collections: [{
                id: DEX_DEFAULT_COLLECTION_ID,
                name: DEX_DEFAULT_COLLECTION_NAME,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }],
        };
    }

    function normalizeCollectionsMeta(raw, options) {
        const maxCollections = options?.premium ? DEX_MAX_COLLECTIONS_PREMIUM : 1;
        const byId = new Map();
        const source = Array.isArray(raw?.collections) ? raw.collections : [];

        for (const entry of source) {
            const id = normalizeCollectionId(entry?.id, '');
            if (!id) continue;

            const existing = byId.get(id);
            const createdAt = normalizeCollectionTimestamp(entry?.createdAt, existing?.createdAt || Date.now());
            const updatedAt = normalizeCollectionTimestamp(entry?.updatedAt, createdAt);
            const fallbackName = id === DEX_DEFAULT_COLLECTION_ID ? DEX_DEFAULT_COLLECTION_NAME : id;

            byId.set(id, {
                id,
                name: normalizeCollectionName(entry?.name, existing?.name || fallbackName),
                createdAt,
                updatedAt,
            });
        }

        if (!byId.has(DEX_DEFAULT_COLLECTION_ID)) {
            byId.set(DEX_DEFAULT_COLLECTION_ID, {
                id: DEX_DEFAULT_COLLECTION_ID,
                name: DEX_DEFAULT_COLLECTION_NAME,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        } else {
            const current = byId.get(DEX_DEFAULT_COLLECTION_ID);
            byId.set(DEX_DEFAULT_COLLECTION_ID, {
                ...current,
                id: DEX_DEFAULT_COLLECTION_ID,
                name: DEX_DEFAULT_COLLECTION_NAME,
            });
        }

        const collections = Array.from(byId.values())
            .sort((a, b) => {
                if (a.id === DEX_DEFAULT_COLLECTION_ID) return -1;
                if (b.id === DEX_DEFAULT_COLLECTION_ID) return 1;
                return Number(a.createdAt || 0) - Number(b.createdAt || 0);
            })
            .slice(0, Math.max(1, maxCollections));

        const requestedActive = normalizeCollectionId(raw?.activeCollectionId, DEX_DEFAULT_COLLECTION_ID);
        const activeCollectionId = collections.some((entry) => entry.id === requestedActive)
            ? requestedActive
            : DEX_DEFAULT_COLLECTION_ID;

        return { activeCollectionId, collections };
    }

    function persistCollectionsMetaLocally(meta) {
        const normalized = normalizeCollectionsMeta(meta, { premium: true });
        currentPremiumCollectionsMeta = normalized;

        try {
            localStorage.setItem(DEX_ACTIVE_COLLECTION_KEY, normalized.activeCollectionId);
        } catch {
            // ignore
        }

        try {
            localStorage.setItem(DEX_COLLECTIONS_META_KEY, JSON.stringify(normalized));
        } catch {
            // ignore
        }

        try {
            window.dispatchEvent(new CustomEvent('pv:dex-collection-context-changed'));
        } catch {
            // ignore
        }
    }

    function restoreCollectionsMetaFromLocal() {
        try {
            const raw = localStorage.getItem(DEX_COLLECTIONS_META_KEY);
            if (!raw) return defaultCollectionsMeta();
            const parsed = JSON.parse(raw);
            return normalizeCollectionsMeta(parsed, { premium: true });
        } catch {
            return defaultCollectionsMeta();
        }
    }

    function readCollectionNameById(collectionId) {
        const id = normalizeCollectionId(collectionId, DEX_DEFAULT_COLLECTION_ID);
        const match = currentPremiumCollectionsMeta.collections.find((entry) => entry.id === id);
        return match ? match.name : (id === DEX_DEFAULT_COLLECTION_ID ? DEX_DEFAULT_COLLECTION_NAME : id);
    }

    function renderPremiumCollectionOptions(meta) {
        const normalized = normalizeCollectionsMeta(meta, { premium: true });

        const buildOptionNodes = () => {
            return normalized.collections.map((entry) => {
                const option = document.createElement('option');
                const label = entry.id === DEX_DEFAULT_COLLECTION_ID
                    ? `${entry.name} (included)`
                    : entry.name;
                option.value = entry.id;
                option.textContent = label;
                return option;
            });
        };

        if (premiumCollectionSelectEl instanceof HTMLSelectElement) {
            premiumCollectionSelectEl.replaceChildren(...buildOptionNodes());
            premiumCollectionSelectEl.value = normalized.activeCollectionId;
        }

        if (premiumExportCollectionSelectEl instanceof HTMLSelectElement) {
            const previousExportId = normalizeCollectionId(
                premiumExportCollectionSelectEl.value,
                normalized.activeCollectionId
            );
            const hasPreviousExportId = normalized.collections.some((entry) => entry.id === previousExportId);

            premiumExportCollectionSelectEl.replaceChildren(...buildOptionNodes());
            premiumExportCollectionSelectEl.value = hasPreviousExportId
                ? previousExportId
                : normalized.activeCollectionId;
        }

        persistCollectionsMetaLocally(normalized);
    }

    async function copyTextToClipboard(text) {
        const value = String(text || '');
        if (!value) return false;

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch {
            // ignore and fall back
        }

        try {
            const el = document.createElement('textarea');
            el.value = value;
            el.setAttribute('readonly', 'readonly');
            el.style.position = 'absolute';
            el.style.left = '-9999px';
            document.body.appendChild(el);
            el.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(el);
            return Boolean(ok);
        } catch {
            return false;
        }
    }

    function getDexShareErrorMessage(error, fallback) {
        const code = String(error?.code || '').trim().toLowerCase();
        const message = String(error?.message || '').trim();
        const lower = message.toLowerCase();

        if (code === 'permission-denied' || lower.includes('missing or insufficient permissions')) {
            return 'Collection sharing is blocked by Firestore rules. Deploy the latest firestore.rules and try again.';
        }

        return message || String(fallback || 'Could not update collection sharing.');
    }

    async function refreshDexShareSettings() {
        const authApi = window?.PV_AUTH;
        if (!authApi?.loadDexShareSettings) {
            setDexShareStatus('Collection sharing is unavailable right now.');
            return;
        }

        setDexShareBusy(true);
        setDexShareStatus('Loading sharing settings...');

        try {
            const settings = await authApi.loadDexShareSettings();
            dexShareState = normalizeDexShareState(settings);
            applyDexShareUiState();

            if (dexShareState.enabled) {
                setDexShareStatus('Sharing is on. Anyone with your link can view your collection in read-only mode.');
            } else {
                setDexShareStatus('Sharing is currently off. Existing shared links are disabled.');
            }
        } catch (error) {
            setDexShareStatus(getDexShareErrorMessage(error, 'Could not load collection sharing settings.'));
        } finally {
            setDexShareBusy(false);
        }
    }

    async function updateDexShareEnabled(nextEnabled) {
        const authApi = window?.PV_AUTH;
        if (!authApi?.saveDexShareSettings) {
            setDexShareStatus('Collection sharing is unavailable right now.');
            return;
        }

        const prevState = { ...dexShareState };
        setDexShareBusy(true);
        setDexShareStatus(nextEnabled
            ? 'Enabling sharing and preparing your read-only link...'
            : 'Disabling sharing...');

        try {
            const saved = await authApi.saveDexShareSettings({
                enabled: Boolean(nextEnabled),
                token: prevState.token,
            });
            dexShareState = normalizeDexShareState(saved);
            applyDexShareUiState();

            if (dexShareState.enabled) {
                setDexShareStatus('Sharing enabled. Your read-only link is active.');
            } else {
                setDexShareStatus('Sharing disabled. Anyone with the old link will now see that sharing is off.');
            }
        } catch (error) {
            dexShareState = prevState;
            applyDexShareUiState();
            setDexShareStatus(getDexShareErrorMessage(error, 'Could not update collection sharing.'));
        } finally {
            setDexShareBusy(false);
        }
    }

    async function copyDexShareLink() {
        const link = String(dexShareState?.shareUrl || '').trim();
        if (!dexShareState?.enabled || !link) {
            setDexShareStatus('Enable sharing first to copy your link.');
            return;
        }

        const copied = await copyTextToClipboard(link);
        setDexShareStatus(copied
            ? 'Share link copied to clipboard.'
            : 'Unable to copy link on this browser.');
    }

    function downloadTextFile(filename, content, mimeType) {
        const blob = new Blob([String(content || '')], { type: String(mimeType || 'text/plain;charset=utf-8') });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = String(filename || 'export.txt');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function toCsvCell(value) {
        const text = String(value == null ? '' : value);
        if (!/[",\n]/.test(text)) return text;
        return `"${text.replace(/"/g, '""')}"`;
    }

    function normalizeCollectionEntryId(rawId) {
        return normalizeCollectionId(rawId, DEX_DEFAULT_COLLECTION_ID);
    }

    function getCardCopyCount(entry) {
        const map = (entry?.conditionQuantities && typeof entry.conditionQuantities === 'object')
            ? entry.conditionQuantities
            : null;
        if (!map) return 1;

        let total = 0;
        for (const value of Object.values(map)) {
            const qty = Math.max(0, Math.floor(Number(value) || 0));
            total += qty;
        }
        return Math.max(1, total);
    }

    function getSealedQuantity(entry) {
        return Math.max(1, Math.floor(Number(entry?.quantity ?? entry?.sealedQuantity) || 1));
    }

    async function loadCollectionsMetaFromCloud() {
        const authApi = window?.PV_AUTH;
        if (!authApi?.loadDexCollectionsMeta) {
            const fallback = restoreCollectionsMetaFromLocal();
            renderPremiumCollectionOptions(fallback);
            return fallback;
        }

        const meta = await authApi.loadDexCollectionsMeta();
        const normalized = normalizeCollectionsMeta(meta, { premium: true });
        renderPremiumCollectionOptions(normalized);
        return normalized;
    }

    async function saveCollectionsMetaToCloud(nextMeta) {
        const authApi = window?.PV_AUTH;
        if (!authApi?.saveDexCollectionsMeta) {
            throw new Error('Collection management is unavailable right now.');
        }

        const saved = await authApi.saveDexCollectionsMeta(nextMeta);
        const normalized = normalizeCollectionsMeta(saved, { premium: true });
        renderPremiumCollectionOptions(normalized);
        return normalized;
    }

    function buildExportRows(items) {
        const list = Array.isArray(items) ? items : [];
        return list.map((entry) => {
            const itemType = String(entry?.itemType || 'card').trim().toLowerCase() === 'sealed' ? 'sealed' : 'card';
            const collectionId = normalizeCollectionEntryId(entry?.collectionId);
            const collectionName = readCollectionNameById(collectionId);
            const setName = String(entry?.setName || entry?.expansionName || entry?.set?.name || entry?.expansion?.name || '');
            const copyCount = itemType === 'sealed' ? getSealedQuantity(entry) : getCardCopyCount(entry);

            return {
                collectionId,
                collectionName,
                itemType,
                id: String(entry?.id || ''),
                name: String(entry?.name || ''),
                setName,
                rarity: String(entry?.rarity || ''),
                number: String(entry?.number || entry?.card_no || ''),
                quantity: copyCount,
                selectedCondition: String(entry?.selectedCondition || ''),
                selectedVariant: String(entry?.selectedVariant || ''),
                conditionQuantities: JSON.stringify(entry?.conditionQuantities || {}),
                variantQuantities: JSON.stringify(entry?.variantQuantities || {}),
                addedAt: Number(entry?.addedAt || 0) || '',
                updatedAt: Number(entry?.updatedAt || 0) || '',
            };
        });
    }

    function buildExportFilePrefix(collectionId) {
        const now = new Date();
        const normalizedCollectionId = normalizeCollectionId(collectionId, DEX_DEFAULT_COLLECTION_ID);
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `pokevalutor-${normalizedCollectionId}-export-${yyyy}${mm}${dd}`;
    }

    async function runPremiumExport(format) {
        if (!isPremiumRole(currentRole)) {
            setPremiumToolsStatus('Premium plan required. Upgrade to export your collection.');
            return;
        }

        const authApi = window?.PV_AUTH;
        if (!authApi?.loadDexState) {
            setPremiumToolsStatus('Export is unavailable right now.');
            return;
        }

        setPremiumToolsBusy(true);
        setPremiumToolsStatus('Preparing export...');

        try {
            await loadCollectionsMetaFromCloud();
            const state = await authApi.loadDexState();
            const selectedCollectionId = normalizeCollectionEntryId(
                premiumExportCollectionSelectEl instanceof HTMLSelectElement
                    ? premiumExportCollectionSelectEl.value
                    : currentPremiumCollectionsMeta.activeCollectionId
            );
            const selectedCollectionName = readCollectionNameById(selectedCollectionId);
            const rows = buildExportRows(state?.collection || [])
                .filter((entry) => entry.collectionId === selectedCollectionId);
            const prefix = buildExportFilePrefix(selectedCollectionId);

            if (String(format || '').toLowerCase() === 'json') {
                const payload = {
                    exportedAt: new Date().toISOString(),
                    collectionId: selectedCollectionId,
                    collectionName: selectedCollectionName,
                    items: rows,
                };
                downloadTextFile(`${prefix}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
                setPremiumToolsStatus(`Exported ${rows.length} item${rows.length === 1 ? '' : 's'} from "${selectedCollectionName}" to JSON.`);
                return;
            }

            const headers = [
                'collectionId',
                'collectionName',
                'itemType',
                'id',
                'name',
                'setName',
                'rarity',
                'number',
                'quantity',
                'selectedCondition',
                'selectedVariant',
                'conditionQuantities',
                'variantQuantities',
                'addedAt',
                'updatedAt',
            ];

            const lines = [headers.join(',')];
            for (const row of rows) {
                lines.push(headers.map((key) => toCsvCell(row[key])).join(','));
            }
            downloadTextFile(`${prefix}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
            setPremiumToolsStatus(`Exported ${rows.length} item${rows.length === 1 ? '' : 's'} from "${selectedCollectionName}" to CSV.`);
        } catch (error) {
            setPremiumToolsStatus(String(error?.message || 'Could not export collection.'));
        } finally {
            setPremiumToolsBusy(false);
        }
    }

    async function refreshPremiumTools() {
        const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
        const premium = isPremiumRole(currentRole);

        if (!user) {
            setPremiumToolsVisible(false);
            return;
        }

        setPremiumToolsVisible(true);
        setPremiumToolsBusy(true);

        try {
            const meta = await loadCollectionsMetaFromCloud();
            if (!premium) {
                const normalized = normalizeCollectionsMeta(meta, { premium: false });
                renderPremiumCollectionOptions(normalized);
                setPremiumToolsStatus('Upgrade to Premium to create extra collections and export data.');
                return;
            }

            setPremiumToolsStatus('Premium tools ready.');
        } catch (error) {
            setPremiumToolsStatus(String(error?.message || 'Could not load premium tools.'));
            renderPremiumCollectionOptions(restoreCollectionsMetaFromLocal());
        } finally {
            setPremiumToolsBusy(false);
        }
    }

    async function createPremiumCollection() {
        if (!isPremiumRole(currentRole)) {
            setPremiumToolsStatus('Premium plan required to create additional collections.');
            return;
        }

        const rawName = String(premiumCollectionNameEl?.value || '').trim();
        if (!rawName) {
            setPremiumToolsStatus('Enter a collection name first.');
            return;
        }

        const currentMeta = normalizeCollectionsMeta(currentPremiumCollectionsMeta, { premium: true });
        if (currentMeta.collections.length >= DEX_MAX_COLLECTIONS_PREMIUM) {
            const extraCollections = Math.max(0, DEX_MAX_COLLECTIONS_PREMIUM - 1);
            setPremiumToolsStatus(`Premium allows up to ${DEX_MAX_COLLECTIONS_PREMIUM} total collections (Default + ${extraCollections} additional).`);
            return;
        }

        const baseId = normalizeCollectionId(rawName, 'collection');
        let nextId = baseId;
        let suffix = 2;
        const existingIds = new Set(currentMeta.collections.map((entry) => entry.id));
        while (existingIds.has(nextId)) {
            nextId = normalizeCollectionId(`${baseId}-${suffix}`, `collection-${suffix}`);
            suffix += 1;
        }

        const nextEntry = {
            id: nextId,
            name: normalizeCollectionName(rawName, baseId),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        setPremiumToolsBusy(true);
        setPremiumToolsStatus('Creating collection...');

        try {
            const saved = await saveCollectionsMetaToCloud({
                collections: [...currentMeta.collections, nextEntry],
                activeCollectionId: nextEntry.id,
            });
            if (premiumCollectionNameEl instanceof HTMLInputElement) premiumCollectionNameEl.value = '';
            setPremiumToolsStatus(`Created collection "${readCollectionNameById(saved.activeCollectionId)}".`);
        } catch (error) {
            setPremiumToolsStatus(String(error?.message || 'Could not create collection.'));
        } finally {
            setPremiumToolsBusy(false);
        }
    }

    async function selectActiveCollection(nextCollectionId) {
        const selectedId = normalizeCollectionId(nextCollectionId, DEX_DEFAULT_COLLECTION_ID);
        const currentMeta = normalizeCollectionsMeta(currentPremiumCollectionsMeta, { premium: true });

        if (!currentMeta.collections.some((entry) => entry.id === selectedId)) {
            setPremiumToolsStatus('Selected collection is unavailable.');
            renderPremiumCollectionOptions(currentMeta);
            return;
        }

        setPremiumToolsBusy(true);
        setPremiumToolsStatus('Updating active collection...');

        try {
            await saveCollectionsMetaToCloud({
                collections: currentMeta.collections,
                activeCollectionId: selectedId,
            });
            setPremiumToolsStatus(`Active collection: ${readCollectionNameById(selectedId)}.`);
        } catch (error) {
            setPremiumToolsStatus(String(error?.message || 'Could not switch active collection.'));
            renderPremiumCollectionOptions(currentMeta);
        } finally {
            setPremiumToolsBusy(false);
        }
    }

    async function deletePremiumCollection() {
        if (!isPremiumRole(currentRole)) {
            setPremiumToolsStatus('Premium plan required to delete additional collections.');
            return;
        }

        const selectedId = normalizeCollectionId(premiumCollectionSelectEl?.value, DEX_DEFAULT_COLLECTION_ID);
        if (selectedId === DEX_DEFAULT_COLLECTION_ID) {
            setPremiumToolsStatus('Default Collection cannot be deleted.');
            return;
        }

        const selectedName = readCollectionNameById(selectedId);
        const confirmed = window.confirm(`Delete "${selectedName}" and remove all its cards/sealed entries from cloud sync?`);
        if (!confirmed) {
            setPremiumToolsStatus('Collection deletion canceled.');
            return;
        }

        setPremiumToolsBusy(true);
        setPremiumToolsStatus('Deleting collection...');

        try {
            const authApi = window?.PV_AUTH;
            const currentMeta = normalizeCollectionsMeta(currentPremiumCollectionsMeta, { premium: true });
            const nextCollections = currentMeta.collections.filter((entry) => entry.id !== selectedId);

            await saveCollectionsMetaToCloud({
                collections: nextCollections,
                activeCollectionId: DEX_DEFAULT_COLLECTION_ID,
            });

            if (authApi?.loadDexState && authApi?.saveDexState) {
                const cloudState = await authApi.loadDexState();
                const cloudCollection = Array.isArray(cloudState?.collection) ? cloudState.collection : [];
                const nextCloudCollection = cloudCollection.filter((entry) => {
                    const entryCollectionId = normalizeCollectionEntryId(entry?.collectionId);
                    return entryCollectionId !== selectedId;
                });

                await authApi.saveDexState({
                    collection: nextCloudCollection,
                    masterSets: (cloudState?.masterSets && typeof cloudState.masterSets === 'object') ? cloudState.masterSets : {},
                });
            }

            const localCollection = readDexCollection();
            const nextLocalCollection = localCollection.filter((entry) => {
                return normalizeCollectionEntryId(entry?.collectionId) !== selectedId;
            });
            writeDexCollection(nextLocalCollection);

            setPremiumToolsStatus(`Deleted "${selectedName}" and removed its tracked entries.`);
        } catch (error) {
            setPremiumToolsStatus(String(error?.message || 'Could not delete collection.'));
        } finally {
            setPremiumToolsBusy(false);
        }
    }

    function setLocalDexStatus(msg) {
        if (!localDexStatusEl) return;
        localDexStatusEl.textContent = String(msg || '');
    }

    function isLocalDexSafetyArmed() {
        return (localDexAckEl instanceof HTMLInputElement) && localDexAckEl.checked;
    }

    function syncLocalDexControlsState() {
        const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
        const signedIn = Boolean(user);
        const armed = isLocalDexSafetyArmed();
        const canRunLocalClear = localDexPanelVisible && !signedIn && armed && !localDexBusy;

        if (localDexClearCollectionBtn instanceof HTMLButtonElement) {
            localDexClearCollectionBtn.disabled = !canRunLocalClear;
        }
        if (localDexClearMasterSetsBtn instanceof HTMLButtonElement) {
            localDexClearMasterSetsBtn.disabled = !canRunLocalClear;
        }
        if (localDexAckEl instanceof HTMLInputElement) {
            localDexAckEl.disabled = !localDexPanelVisible || localDexBusy;
        }

        if (localDexGuardEl) {
            let guardText = 'Safety lock on';
            if (signedIn) {
                guardText = 'Signed-in mode';
            } else if (armed) {
                guardText = 'Safety lock off';
            }

            localDexGuardEl.textContent = guardText;
            localDexGuardEl.classList.toggle('is-armed', !signedIn && armed);
            localDexGuardEl.classList.toggle('is-signed-in', signedIn);
        }
    }

    function setLocalDexVisible(isVisible) {
        const show = !!isVisible;
        if (localDexPanelEl) localDexPanelEl.hidden = !show;
        localDexPanelVisible = show;
        if (!show) {
            setLocalDexStatus('');
            if (localDexAckEl instanceof HTMLInputElement) localDexAckEl.checked = false;
        }
        syncLocalDexControlsState();
    }

    function setLocalDexBusy(isBusy) {
        localDexBusy = !!isBusy;
        syncLocalDexControlsState();
    }

    function safeParseJson(raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function readDexCollection() {
        try {
            const raw = localStorage.getItem(DEX_COLLECTION_KEY);
            if (!raw) return [];
            const parsed = safeParseJson(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function readDexMasterSets() {
        try {
            const raw = localStorage.getItem(DEX_MASTER_SETS_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            return parsed;
        } catch {
            return {};
        }
    }

    function writeDexCollection(next) {
        try {
            localStorage.setItem(DEX_COLLECTION_KEY, JSON.stringify(Array.isArray(next) ? next : []));
        } catch {
            // ignore
        }
    }

    function writeDexMasterSets(next) {
        try {
            const safe = (next && typeof next === 'object' && !Array.isArray(next)) ? next : {};
            localStorage.setItem(DEX_MASTER_SETS_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }
    }

    function clearLocalDexCollectionState() {
        writeDexCollection([]);
        try { localStorage.removeItem(DEX_OWNER_UID_KEY); } catch { }
        window.dispatchEvent(new CustomEvent('pv:dex-state-changed'));
    }

    function clearLocalDexMasterSetsState() {
        writeDexMasterSets({});
        try { localStorage.removeItem(DEX_OWNER_UID_KEY); } catch { }
        window.dispatchEvent(new CustomEvent('pv:dex-state-changed'));
    }

    function runLocalDexClearAction(options) {
        function resetLocalDexAcknowledgment() {
            if (localDexAckEl instanceof HTMLInputElement) {
                localDexAckEl.checked = false;
            }
            syncLocalDexControlsState();
        }

        const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
        if (user) {
            setLocalDexStatus('You are signed in. Use the Dex Data controls in your Session card.');
            return;
        }

        if (!isLocalDexSafetyArmed()) {
            setLocalDexStatus('Safety lock is on. Check the acknowledgment box first.');
            return;
        }

        const ok = window.confirm(String(options?.confirmMessage || 'Confirm this action.'));
        if (!ok) {
            resetLocalDexAcknowledgment();
            setLocalDexStatus(String(options?.cancelMessage || 'Local Dex clear canceled.'));
            return;
        }

        const requiredText = String(options?.requiredText || '').trim().toUpperCase();
        if (requiredText) {
            const promptText = String(options?.promptMessage || 'Type the confirmation text to continue.');
            const confirmText = window.prompt(promptText);
            if (String(confirmText || '').trim().toUpperCase() !== requiredText) {
                resetLocalDexAcknowledgment();
                setLocalDexStatus(String(options?.mismatchMessage || 'Local Dex clear canceled (confirmation text did not match).'));
                return;
            }
        }

        setLocalDexBusy(true);
        setLocalDexStatus(String(options?.progressMessage || 'Clearing local Dex data...'));

        try {
            if (typeof options?.clearAction === 'function') {
                options.clearAction();
            }
            setLocalDexStatus(String(options?.successMessage || 'Local Dex data cleared on this browser only.'));
        } finally {
            resetLocalDexAcknowledgment();
            setLocalDexBusy(false);
        }
    }

    async function syncDexStateToCloud() {
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user || !authApi?.saveDexState) return false;

        const payload = {
            collection: readDexCollection(),
            masterSets: readDexMasterSets(),
        };

        try {
            await authApi.saveDexState(payload);
            return true;
        } catch {
            return false;
        }
    }

    function buildAccountUrlWithQuery(name, value) {
        const next = new URL(window.location.href);
        next.searchParams.set(String(name || ''), String(value || ''));
        return next.href;
    }

    function getStripeStatusMessage(result) {
        const status = String(result?.subscriptionStatus || 'none').toLowerCase();
        const entitled = Boolean(result?.premiumEntitled);
        const role = String(result?.role || '').toLowerCase();

        if (role === 'admin') return 'Admin account: subscription changes do not overwrite admin access.';
        if (role === 'tester') return 'Tester account: subscription changes do not overwrite tester access.';

        if (!result?.hasSubscription) return 'No active subscription. Subscribe to enable premium.';

        if (entitled) {
            if (status === 'trialing') return 'Premium trial active.';
            if (status === 'past_due') return 'Premium active (payment update needed soon).';
            return 'Premium subscription active.';
        }

        if (status === 'canceled') return 'Subscription canceled. Premium access is not active.';
        if (status === 'unpaid' || status === 'incomplete') return 'Subscription requires payment action. Premium access is paused.';
        return `Subscription status: ${status}.`;
    }

    async function refreshBillingStatus() {
        if (!window?.PV_AUTH?.callFunction) {
            setBillingStatus('Billing tools unavailable: Firebase Functions not configured.');
            if (billingManageBtn instanceof HTMLButtonElement) billingManageBtn.disabled = true;
            return;
        }

        setBillingButtonsDisabled(true);
        setBillingStatus('Checking subscription status...');

        try {
            const result = await window.PV_AUTH.callFunction('getStripeSubscriptionStatus', {});
            setBillingStatus(getStripeStatusMessage(result));

            const entitled = Boolean(result?.premiumEntitled);
            if (billingSubscribeBtn instanceof HTMLButtonElement) billingSubscribeBtn.hidden = entitled;
            if (billingManageBtn instanceof HTMLButtonElement) {
                billingManageBtn.disabled = !result?.customerId;
            }
        } catch (error) {
            const message = String(error?.message || 'Could not load subscription status.');
            setBillingStatus(message);
            if (billingSubscribeBtn instanceof HTMLButtonElement) billingSubscribeBtn.hidden = false;
            if (billingManageBtn instanceof HTMLButtonElement) billingManageBtn.disabled = true;
        } finally {
            if (billingSubscribeBtn instanceof HTMLButtonElement && !billingSubscribeBtn.hidden) {
                billingSubscribeBtn.disabled = false;
            }
        }
    }

    async function runBilling(action) {
        try {
            setBillingButtonsDisabled(true);
            await action();
        } catch (error) {
            const message = String(error?.message || 'Billing action failed.');
            setBillingStatus(message);
            if (billingSubscribeBtn instanceof HTMLButtonElement && !billingSubscribeBtn.hidden) {
                billingSubscribeBtn.disabled = false;
            }
            if (billingManageBtn instanceof HTMLButtonElement) billingManageBtn.disabled = false;
        }
    }

    function applyCheckoutStatusFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const checkoutState = String(params.get('checkout') || '').toLowerCase();
        if (checkoutState === 'success') {
            setBillingStatus('Checkout completed. Confirming subscription status...');
        } else if (checkoutState === 'cancelled') {
            setBillingStatus('Checkout canceled. You can subscribe any time.');
        }
    }

    function getProfileInitials(displayName, email) {
        const sourceRaw = String(displayName || email || '').trim();
        const source = sourceRaw.includes('@') ? sourceRaw.split('@')[0] : sourceRaw;
        const cleaned = source.replace(/[^a-zA-Z0-9 ]+/g, ' ').trim();
        if (!cleaned) return 'U';
        const parts = cleaned.split(/\s+/).filter(Boolean);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
    }

    function setProfileSignedOut() {
        if (profileEl) profileEl.hidden = true;
        if (profileNameEl) profileNameEl.textContent = 'PokeValutor user';
        if (profileEmailEl) profileEmailEl.textContent = '';

        if (profileAvatarEl instanceof HTMLImageElement) {
            profileAvatarEl.hidden = true;
            profileAvatarEl.src = '';
            profileAvatarEl.alt = '';
        }

        if (profileAvatarFallbackEl) {
            profileAvatarFallbackEl.hidden = false;
            profileAvatarFallbackEl.textContent = 'U';
        }
    }

    function setProfileSignedIn(user) {
        if (!profileEl) return;

        const displayNameRaw = String(user?.displayName || '').trim();
        const email = String(user?.email || '').trim();
        const displayName = displayNameRaw || (email ? email.split('@')[0] : 'PokeValutor user');
        const photoURL = String(user?.photoURL || '').trim();

        if (profileNameEl) profileNameEl.textContent = displayName;
        if (profileEmailEl) profileEmailEl.textContent = email || 'No email on account';

        if (photoURL && profileAvatarEl instanceof HTMLImageElement) {
            profileAvatarEl.src = photoURL;
            profileAvatarEl.alt = `${displayName} profile photo`;
            profileAvatarEl.hidden = false;
            if (profileAvatarFallbackEl) profileAvatarFallbackEl.hidden = true;
        } else {
            if (profileAvatarEl instanceof HTMLImageElement) {
                profileAvatarEl.hidden = true;
                profileAvatarEl.src = '';
                profileAvatarEl.alt = '';
            }

            if (profileAvatarFallbackEl) {
                profileAvatarFallbackEl.hidden = false;
                profileAvatarFallbackEl.textContent = getProfileInitials(displayName, email);
            }
        }

        profileEl.hidden = false;
    }

    function normalizeRoleFromClaims(claims) {
        const role = String(claims?.role || claims?.tier || '').trim().toLowerCase();
        if (role === 'admin' || role === 'tester' || role === 'premium' || role === 'basic') return role;
        if (claims?.admin === true) return 'admin';
        if (claims?.tester === true) return 'tester';
        if (claims?.premium === true) return 'premium';
        return 'basic';
    }

    function getCreds() {
        const email = String(emailEl?.value || '').trim();
        const password = String(passEl?.value || '');
        return { email, password };
    }

    function applyLocalDevTestCredentials() {
        const host = String(window.location.hostname || '').trim().toLowerCase();
        const isLocalHost = host === 'localhost' || host === '127.0.0.1';
        if (!isLocalHost) return;

        const secretEmail = String(window?.PV_SECRETS?.PV_TEST_AUTH_EMAIL || '').trim();
        const secretPassword = String(window?.PV_SECRETS?.PV_TEST_AUTH_PASSWORD || '');

        if (secretEmail && emailEl && !String(emailEl.value || '').trim()) {
            emailEl.value = secretEmail;
        }

        if (secretPassword && passEl && !String(passEl.value || '')) {
            passEl.value = secretPassword;
        }
    }

    function getAuthTroubleshootMessage(error) {
        if (!ENABLE_AUTH_SELF_CHECK) return '';
        const code = String(error?.code || '').trim().toLowerCase();
        if (!code) return '';

        if (code === 'auth/operation-not-allowed') {
            return 'Setup check: Enable Email/Password in Firebase Console -> Authentication -> Sign-in method.';
        }

        if (code === 'auth/app-not-authorized' || code === 'auth/unauthorized-domain') {
            return 'Setup check: Add this host to Firebase Auth authorized domains, then retry sign-in.';
        }

        if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.') {
            return 'Setup check: Firebase web config appears invalid. Verify apiKey/authDomain/projectId/appId values.';
        }

        if (code === 'auth/network-request-failed') {
            return 'Setup check: Network/CSP blocked Firebase. Confirm internet access and CSP allows gstatic/googleapis.';
        }

        if (code === 'auth/internal-error') {
            return 'Setup check: Google auth popup failed. Verify Firebase authorized domains, allow apis.google.com in CSP script-src, and retry.';
        }

        return '';
    }

    function getDeleteAccountErrorMessage(error) {
        const code = String(error?.code || '').trim().toLowerCase();
        if (!code) return '';

        if (code === 'auth/requires-recent-login' || code === 'auth/user-token-expired') {
            return 'For security, please sign in again and retry account deletion.';
        }

        if (code === 'auth/network-request-failed') {
            return 'Network request failed while deleting the account. Check your connection and retry.';
        }

        if (code === 'auth/popup-blocked' || code === 'auth/internal-error') {
            return 'Re-authentication was blocked by the browser. Sign out, sign in again, then retry deletion.';
        }

        return '';
    }

    function runStartupChecks() {
        if (!ENABLE_AUTH_SELF_CHECK) return;

        if (window.location.protocol === 'file:') {
            setSelfCheck('Setup check: Open this site via http://localhost (not file://) so Firebase Auth can run correctly.');
            return;
        }

        const config = window.PV_FIREBASE_CONFIG;
        const hasPlaceholderKey = String(config?.apiKey || '').trim() === 'YOUR_API_KEY';
        if (!config || !config.apiKey || hasPlaceholderKey) {
            setSelfCheck('Setup check: Firebase config is missing or placeholder. Use firebase-config.local.js (local) or GitHub Secrets (Pages).');
            return;
        }

        if (!window.firebase || !window.firebase.auth) {
            setSelfCheck('Setup check: Firebase SDK not loaded. Verify script tags and CSP script-src for www.gstatic.com.');
            return;
        }

        clearSelfCheck();
    }

    async function run(action) {
        try {
            setStatus('Working…');
            await action();
            clearSelfCheck();
        } catch (e) {
            const message = (e && typeof e === 'object' && 'message' in e) ? String(e.message) : 'Something went wrong.';
            setStatus(message);
            const troubleshoot = getAuthTroubleshootMessage(e);
            if (troubleshoot) setSelfCheck(troubleshoot);
        }
    }

    runStartupChecks();
    applyLocalDevTestCredentials();
    setupSensitiveTapReveal();

    setAuthViewMode(false);
    setDexVisible(false);
    setDexShareVisible(false);
    setLocalDexVisible(false);
    renderPremiumCollectionOptions(restoreCollectionsMetaFromLocal());
    setPremiumToolsVisible(false);
    setPremiumToolsBusy(false);

    if (!window.PV_AUTH || !window.PV_AUTH.onAuthStateChanged) {
        setStatus('Firebase not loaded. Check CSP + firebase-config.js');
        setSelfCheck('Setup check: firebase.js did not initialize. Confirm valid config and Firebase scripts are loading.');
        setLocalDexVisible(true);
        setLocalDexStatus('Auth is unavailable. You can still clear local Dex data below.');
        setPremiumToolsVisible(false);
        setProfileSignedOut();
        return;
    }

    window.PV_AUTH.onAuthStateChanged((user) => {
        if (!user) {
            currentRole = 'basic';
            setAuthViewMode(false);
            setStatus('Signed out');
            setRoleText('');
            setUidText('');
            setAdminVisible(false);
            setBillingVisible(false);
            setDexVisible(false);
            setDexShareVisible(false);
            setLocalDexVisible(true);
            setLocalDexStatus('Safety lock on. Check the acknowledgment box to enable local clear actions.');
            setPremiumToolsVisible(false);
            setProfileSignedOut();
            if (deleteBtn instanceof HTMLButtonElement) deleteBtn.disabled = true;
            return;
        }
        const uid = String(user.uid || '');

        setAuthViewMode(true);
        setProfileSignedIn(user);
        setStatus('Signed in');
        clearSelfCheck();
        if (deleteBtn instanceof HTMLButtonElement) deleteBtn.disabled = false;
        setBillingVisible(true);
        setDexVisible(true);
        setDexShareVisible(true);
        void refreshDexShareSettings();
        setLocalDexVisible(false);
        setPremiumToolsVisible(true);
        setPremiumToolsStatus('Loading premium tools...');
        applyCheckoutStatusFromUrl();
        refreshBillingStatus();

        // Fetch/refresh custom claims for role display + admin gating.
        Promise.resolve(window.PV_AUTH.getIdTokenResult ? window.PV_AUTH.getIdTokenResult(true) : null)
            .then((tokenResult) => {
                const claims = tokenResult?.claims || null;
                const role = normalizeRoleFromClaims(claims);
                currentRole = role;
                setRoleText(`Role: ${role}`);
                setUidText(uid);
                setAdminVisible(role === 'admin');
                void refreshPremiumTools();
            })
            .catch(() => {
                currentRole = 'basic';
                setRoleText('Role: unknown');
                setUidText(uid);
                setAdminVisible(false);
                void refreshPremiumTools();
            });
    });

    if (signInBtn) {
        signInBtn.addEventListener('click', () => {
            run(async () => {
                const { email, password } = getCreds();
                if (!email || !password) throw new Error('Enter email + password.');
                await window.PV_AUTH.signInWithEmail(email, password);
                setStatus('Signed in.');
            });
        });
    }

    if (signUpBtn) {
        signUpBtn.addEventListener('click', () => {
            run(async () => {
                const { email, password } = getCreds();
                if (!email || !password) throw new Error('Enter email + password.');
                if (password.length < 6) throw new Error('Password must be at least 6 characters.');
                await window.PV_AUTH.signUpWithEmail(email, password);
                setStatus('Account created and signed in.');
            });
        });
    }

    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            run(async () => {
                await window.PV_AUTH.signInWithGoogle();
                setStatus('Signed in with Google.');
            });
        });
    }

    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => {
            run(async () => {
                await window.PV_AUTH.signOut();
                setStatus('Signed out');
                setRoleText('');
                setUidText('');
                setAdminVisible(false);
                setProfileSignedOut();
            });
        });
    }

    if (deleteBtn) {
        if (deleteBtn instanceof HTMLButtonElement) deleteBtn.disabled = true;

        deleteBtn.addEventListener('click', () => {
            run(async () => {
                if (!window?.PV_AUTH?.deleteAccount) {
                    throw new Error('Account deletion is not configured.');
                }

                const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
                if (!user) throw new Error('Sign in before deleting your account.');

                const confirmStep1 = window.confirm('Delete your account? This cannot be undone.');
                if (!confirmStep1) {
                    setStatus('Account deletion canceled.');
                    return;
                }

                const confirmText = window.prompt('Type DELETE to confirm account deletion.');
                if (String(confirmText || '').trim().toUpperCase() !== 'DELETE') {
                    setStatus('Account deletion canceled (confirmation text did not match).');
                    return;
                }

                try {
                    await window.PV_AUTH.deleteAccount({ deleteFirestoreData: true });
                    setStatus('Account deleted. Synced account data deletion was attempted.');
                    setRoleText('');
                    setUidText('');
                    setAdminVisible(false);
                    setProfileSignedOut();
                } catch (error) {
                    const msg = getDeleteAccountErrorMessage(error);
                    if (msg) {
                        throw new Error(msg);
                    }
                    throw error;
                }
            });
        });
    }

    if (billingSubscribeBtn) {
        billingSubscribeBtn.addEventListener('click', () => {
            runBilling(async () => {
                if (!window?.PV_AUTH?.callFunction) {
                    throw new Error('Stripe checkout is unavailable (Firebase Functions missing).');
                }

                setBillingStatus('Opening Stripe checkout...');

                const successUrl = buildAccountUrlWithQuery('checkout', 'success');
                const cancelUrl = buildAccountUrlWithQuery('checkout', 'cancelled');
                const result = await window.PV_AUTH.callFunction('createStripeCheckoutSession', { successUrl, cancelUrl });
                const checkoutUrl = String(result?.url || '').trim();
                if (!checkoutUrl) throw new Error('Stripe checkout session did not return a URL.');

                window.location.assign(checkoutUrl);
            });
        });
    }

    if (billingManageBtn) {
        billingManageBtn.addEventListener('click', () => {
            runBilling(async () => {
                if (!window?.PV_AUTH?.callFunction) {
                    throw new Error('Stripe billing portal is unavailable (Firebase Functions missing).');
                }

                setBillingStatus('Opening billing portal...');

                const returnUrl = buildAccountUrlWithQuery('checkout', 'portal-return');
                const result = await window.PV_AUTH.callFunction('createStripePortalSession', { returnUrl });
                const portalUrl = String(result?.url || '').trim();
                if (!portalUrl) throw new Error('Stripe billing portal session did not return a URL.');

                window.location.assign(portalUrl);
            });
        });
    }

    if (dexClearCollectionBtn) {
        dexClearCollectionBtn.addEventListener('click', async () => {
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) {
                setDexStatus('Sign in to manage Dex data.');
                return;
            }

            const ok = window.confirm('Clear your Dex collection? This removes all tracked cards.');
            if (!ok) {
                setDexStatus('Dex collection clear canceled.');
                return;
            }

            const confirmText = window.prompt('Type CLEAR COLLECTION to confirm.');
            if (String(confirmText || '').trim().toUpperCase() !== 'CLEAR COLLECTION') {
                setDexStatus('Dex collection clear canceled (confirmation text did not match).');
                return;
            }

            setDexButtonsDisabled(true);
            setDexStatus('Clearing Dex collection...');

            try {
                writeDexCollection([]);
                window.dispatchEvent(new CustomEvent('pv:dex-state-changed'));
                const synced = await syncDexStateToCloud();
                setDexStatus(synced ? 'Dex collection cleared and synced.' : 'Dex collection cleared on this device. Cloud sync unavailable.');
            } finally {
                setDexButtonsDisabled(false);
            }
        });
    }

    if (dexClearMasterSetsBtn) {
        dexClearMasterSetsBtn.addEventListener('click', async () => {
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) {
                setDexStatus('Sign in to manage Dex data.');
                return;
            }

            const ok = window.confirm('Clear your tracked master sets?');
            if (!ok) {
                setDexStatus('Master sets clear canceled.');
                return;
            }

            const confirmText = window.prompt('Type CLEAR MASTER SETS to confirm.');
            if (String(confirmText || '').trim().toUpperCase() !== 'CLEAR MASTER SETS') {
                setDexStatus('Master sets clear canceled (confirmation text did not match).');
                return;
            }

            setDexButtonsDisabled(true);
            setDexStatus('Clearing master sets...');

            try {
                writeDexMasterSets({});
                window.dispatchEvent(new CustomEvent('pv:dex-state-changed'));
                const synced = await syncDexStateToCloud();
                setDexStatus(synced ? 'Master sets cleared and synced.' : 'Master sets cleared on this device. Cloud sync unavailable.');
            } finally {
                setDexButtonsDisabled(false);
            }
        });
    }

    if (localDexAckEl instanceof HTMLInputElement) {
        localDexAckEl.addEventListener('change', () => {
            syncLocalDexControlsState();
            if (localDexAckEl.checked) {
                setLocalDexStatus('Safety lock off. Choose a local clear action.');
            } else {
                setLocalDexStatus('Safety lock on. Check the acknowledgment box to enable local clear actions.');
            }
        });
    }

    if (localDexClearCollectionBtn) {
        localDexClearCollectionBtn.addEventListener('click', () => {
            runLocalDexClearAction({
                confirmMessage: 'Clear local Dex collection on this browser? Cloud data is unchanged.',
                promptMessage: 'Type CLEAR LOCAL COLLECTION to confirm.',
                requiredText: 'CLEAR LOCAL COLLECTION',
                cancelMessage: 'Local collection clear canceled.',
                mismatchMessage: 'Local collection clear canceled (confirmation text did not match).',
                progressMessage: 'Clearing local Dex collection...',
                successMessage: 'Local Dex collection cleared on this browser only.',
                clearAction: clearLocalDexCollectionState,
            });
        });
    }

    if (localDexClearMasterSetsBtn) {
        localDexClearMasterSetsBtn.addEventListener('click', () => {
            runLocalDexClearAction({
                confirmMessage: 'Clear local master sets on this browser? Cloud data is unchanged.',
                promptMessage: 'Type CLEAR LOCAL MASTER SETS to confirm.',
                requiredText: 'CLEAR LOCAL MASTER SETS',
                cancelMessage: 'Local master sets clear canceled.',
                mismatchMessage: 'Local master sets clear canceled (confirmation text did not match).',
                progressMessage: 'Clearing local master sets...',
                successMessage: 'Local master sets cleared on this browser only.',
                clearAction: clearLocalDexMasterSetsState,
            });
        });
    }

    if (dexShareEnabledEl instanceof HTMLInputElement) {
        dexShareEnabledEl.addEventListener('change', () => {
            if (dexShareUiSyncing) return;
            void updateDexShareEnabled(dexShareEnabledEl.checked);
        });
    }

    if (dexShareCopyBtn) {
        dexShareCopyBtn.addEventListener('click', () => {
            void copyDexShareLink();
        });
    }

    if (premiumExportCsvBtn) {
        premiumExportCsvBtn.addEventListener('click', () => {
            void runPremiumExport('csv');
        });
    }

    if (premiumExportJsonBtn) {
        premiumExportJsonBtn.addEventListener('click', () => {
            void runPremiumExport('json');
        });
    }

    if (premiumCollectionSelectEl instanceof HTMLSelectElement) {
        premiumCollectionSelectEl.addEventListener('change', () => {
            void selectActiveCollection(premiumCollectionSelectEl.value);
        });
    }

    if (premiumCollectionCreateBtn) {
        premiumCollectionCreateBtn.addEventListener('click', () => {
            void createPremiumCollection();
        });
    }

    if (premiumCollectionDeleteBtn) {
        premiumCollectionDeleteBtn.addEventListener('click', () => {
            void deletePremiumCollection();
        });
    }

    if (adminFillSelfBtn) {
        adminFillSelfBtn.addEventListener('click', () => {
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) return;
            if (adminUidEl) adminUidEl.value = String(user.uid || '');
        });
    }

    if (adminSetRoleBtn) {
        adminSetRoleBtn.addEventListener('click', () => {
            run(async () => {
                setAdminStatus('Working…');
                const targetUid = String(adminUidEl?.value || '').trim();
                const role = String(adminRoleEl?.value || '').trim().toLowerCase();
                if (!targetUid) throw new Error('Enter a target UID.');
                if (!role) throw new Error('Choose a role.');

                if (!window?.PV_AUTH?.callFunction) {
                    throw new Error('Role assignment not configured (Firebase Functions missing).');
                }

                const result = await window.PV_AUTH.callFunction('setUserRole', { uid: targetUid, role });
                setAdminStatus(`Role updated: ${String(result?.uid || targetUid).slice(0, 8)}… → ${role}`);
            });
        });
    }

    if (adminRefreshLatestSetsBtn) {
        adminRefreshLatestSetsBtn.addEventListener('click', async () => {
            const btn = adminRefreshLatestSetsBtn instanceof HTMLButtonElement ? adminRefreshLatestSetsBtn : null;
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) {
                setAdminRefreshLatestSetsStatus('Sign in as admin to run this action.');
                return;
            }

            setAdminRefreshLatestSetsStatus('Working…');
            if (btn) btn.disabled = true;

            try {
                const tokenResult = await (window?.PV_AUTH?.getIdTokenResult ? window.PV_AUTH.getIdTokenResult(true) : null);
                const role = normalizeRoleFromClaims(tokenResult?.claims || null);
                if (role !== 'admin') {
                    throw new Error('Admin role is required for this action.');
                }

                const confirmed = window.confirm('Clear Home latest-sets cache on this browser now? The Home page will refetch fresh data on next load.');
                if (!confirmed) {
                    setAdminRefreshLatestSetsStatus('Refresh canceled.');
                    return;
                }

                const removedCount = clearHomeLatestSetsCacheEntries();
                const noun = removedCount === 1 ? 'entry' : 'entries';
                setAdminRefreshLatestSetsStatus(`Done. Cleared ${removedCount} cache ${noun}. Open Home to fetch fresh latest sets.`);
            } catch (error) {
                const message = String(error?.message || 'Could not refresh Home latest sets cache.');
                setAdminRefreshLatestSetsStatus(message);
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    }
});
