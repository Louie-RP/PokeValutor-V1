import {
    getGuideVariantOptions, cleanText, normalizeGuideSearch,
    buildBinderPlan, selectPrintableInserts, packPrintSheets,
    sanitizeBinderFilename, hasBinderPdfAccess,
} from './master-set-guide-model.mjs?v=2026-09-30-variants-1';

const LIST_PAGE_SIZE = 10;
const COLLECTION_KEY = 'pv:scrydex:collection:v1';

function textElement(tag, text, className = '') {
    const element = document.createElement(tag);
    element.textContent = cleanText(text, 500);
    if (className) element.className = className;
    return element;
}

function checkboxLabel(text, checked, id, onChange) {
    const label = document.createElement('label');
    label.className = 'pv-guideExport__check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, textElement('span', text));
    return { label, input };
}

function matches(row, query) {
    return !query || normalizeGuideSearch(`${row.name} ${row.number} ${row.printedNumber} ${row.variantLabel}`).includes(query);
}

export function initBinderExport({ getSnapshot }) {
    const button = document.getElementById('pv-guide-export');
    const dialog = document.getElementById('pv-guide-export-dialog');
    if (!(button instanceof HTMLButtonElement) || !(dialog instanceof HTMLDialogElement)) return;
    const get = id => document.getElementById(`pv-export-${id}`);
    const e = Object.fromEntries([
        'close', 'settings', 'layout', 'style', 'scope', 'paper', 'variants', 'card-search', 'card-list', 'card-count',
        'include-matching', 'exclude-matching', 'card-prev', 'card-next', 'card-page',
        'print-search', 'print-list', 'print-count', 'print-matching', 'skip-matching', 'print-prev', 'print-next', 'print-page',
        'additional', 'summary', 'collection-note', 'access', 'upgrade', 'status', 'progress',
        'generate', 'cancel', 'download', 'share',
    ].map(id => [id, get(id)]));
    if (Object.values(e).some(value => !value)) return;
    const state = {
        snapshot: null, enabledVariants: new Set(), excludedSlotIds: new Set(), skippedSlotIds: new Set(),
        cardPage: 1, printPage: 1, allowed: false, accessPending: false,
        busy: false, jobId: 0, accessId: 0, controller: null, blob: null, objectUrl: '', filename: '', ownerId: '',
    };

    function discardResult() {
        if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
        state.blob = null;
        state.objectUrl = '';
        e.download.removeAttribute('href');
        e.download.hidden = true;
        e.share.hidden = true;
    }

    function currentPlan(includeExclusions = true) {
        return buildBinderPlan(state.snapshot.manifest, state.snapshot.ownedIndex, {
            layout: e.layout.value, enabledVariants: [...state.enabledVariants],
            excludedSlotIds: includeExclusions ? state.excludedSlotIds : new Set(),
        });
    }

    function printable(plan = currentPlan()) {
        return selectPrintableInserts(plan, { scope: e.scope.value, skippedSlotIds: state.skippedSlotIds });
    }

    function candidates() {
        return selectPrintableInserts(currentPlan(), { scope: e.scope.value });
    }

    function collectionNote() {
        const known = state.snapshot.ownershipKnown;
        e.scope.querySelector('option[value="missing"]').disabled = !known;
        e['collection-note'].hidden = known && e.scope.value !== 'missing';
        e['collection-note'].textContent = known
            ? 'Missing status uses the Default Collection saved on this device.'
            : 'Default Collection data is unavailable or belongs to another account. Export the entire planned binder, or sync your collection in Dex first.';
    }

    function updateSummary() {
        const plan = currentPlan();
        const inserts = printable(plan);
        const sheets = packPrintSheets(inserts, e.paper.value).sheets;
        e.summary.textContent = `${inserts.length} inserts · ${sheets.length} PDF pages`;
        e.generate.disabled = state.busy || state.accessPending || !state.allowed || inserts.length === 0
            || (e.scope.value === 'missing' && !state.snapshot.ownershipKnown);
        if (inserts.length === 0 && !state.busy) e.status.textContent = 'No inserts match your selection. Include cards or choose the entire planned binder.';
    }

    function updatePager(prefix, count) {
        const property = prefix === 'card' ? 'cardPage' : 'printPage';
        const pages = Math.max(1, Math.ceil(count / LIST_PAGE_SIZE));
        state[property] = Math.min(Math.max(1, state[property]), pages);
        e[`${prefix}-page`].textContent = `Page ${state[property]} of ${pages}`;
        e[`${prefix}-prev`].disabled = state[property] <= 1;
        e[`${prefix}-next`].disabled = state[property] >= pages;
        return (state[property] - 1) * LIST_PAGE_SIZE;
    }

    function cardGroups() {
        const groups = new Map();
        const query = normalizeGuideSearch(e['card-search'].value);
        for (const row of currentPlan(false)) {
            const group = groups.get(row.cardId) || [];
            group.push(row);
            groups.set(row.cardId, group);
        }
        return [...groups.values()].filter(group => group.some(row => matches(row, query)));
    }

    function updateCardList() {
        const groups = cardGroups();
        const start = updatePager('card', groups.length);
        e['card-count'].textContent = `${groups.length} matching cards`;
        const nodes = groups.slice(start, start + LIST_PAGE_SIZE).map(group => {
            const node = document.createElement('div');
            node.className = 'pv-guideExport__card';
            const selected = group.filter(row => !state.excludedSlotIds.has(row.slotId)).length;
            const { label, input } = checkboxLabel(`${group[0].printedNumber} · ${group[0].name}`, selected > 0,
                `pv-export-card-${group[0].cardId}`, checked => {
                    group.forEach(row => checked ? state.excludedSlotIds.delete(row.slotId) : state.excludedSlotIds.add(row.slotId));
                    changed();
                });
            input.indeterminate = selected > 0 && selected < group.length;
            node.append(label);
            const variants = document.createElement('div');
            variants.className = 'pv-guideExport__cardVariants';
            for (const row of group) {
                variants.append(checkboxLabel(row.variantLabel, !state.excludedSlotIds.has(row.slotId),
                    `pv-export-slot-${row.slotId}`, checked => {
                        checked ? state.excludedSlotIds.delete(row.slotId) : state.excludedSlotIds.add(row.slotId);
                        changed();
                    }).label);
            }
            node.append(variants);
            return node;
        });
        e['card-list'].replaceChildren(...nodes);
        if (!nodes.length) e['card-list'].append(textElement('p', 'No cards match.'));
    }

    function matchingCandidates() {
        const query = normalizeGuideSearch(e['print-search'].value);
        return candidates().filter(row => matches(row, query));
    }

    function updatePrintList() {
        const rows = matchingCandidates();
        const start = updatePager('print', rows.length);
        e['print-count'].textContent = `${rows.length} matching inserts`;
        e['print-list'].replaceChildren(...rows.slice(start, start + LIST_PAGE_SIZE).map(row =>
            checkboxLabel(`${row.printedNumber} · ${row.name} · ${row.variantLabel} — Page ${row.binderPage}, Pocket ${row.pocket}`,
                !state.skippedSlotIds.has(row.slotId), `pv-export-print-${row.slotId}`, checked => {
                    checked ? state.skippedSlotIds.delete(row.slotId) : state.skippedSlotIds.add(row.slotId);
                    changed();
                }).label));
        if (!rows.length) e['print-list'].append(textElement('p', 'No inserts match.'));
    }

    function render() {
        const focusedId = document.activeElement?.id;
        collectionNote();
        updateCardList();
        updatePrintList();
        updateSummary();
        if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
    }

    function changed() {
        discardResult();
        e.status.textContent = '';
        render();
    }

    async function checkAccess(forceRefresh = false) {
        const requestId = ++state.accessId;
        state.accessPending = true;
        state.allowed = false;
        e.access.hidden = false;
        e.access.textContent = 'Checking PDF access…';
        updateSummary();
        const auth = window.PV_AUTH;
        const user = auth?.getUser?.();
        try {
            const token = user ? await auth.getIdTokenResult(forceRefresh) : null;
            if (requestId !== state.accessId || !dialog.open) return false;
            state.allowed = hasBinderPdfAccess(user, token?.claims);
            e.access.hidden = state.allowed;
            e.access.textContent = state.allowed ? ''
                : user ? 'Binder PDF export is available to Premium, Tester, and Admin accounts.'
                    : 'Sign in with a Premium, Tester, or Admin account to generate a PDF.';
        } catch {
            if (requestId !== state.accessId) return false;
            e.access.textContent = 'Account access could not be checked. Close and reopen export to retry.';
        } finally {
            if (requestId === state.accessId) {
                state.accessPending = false;
                e.upgrade.hidden = state.allowed;
                updateSummary();
            }
        }
        return state.allowed;
    }

    function setBusy(busy) {
        state.busy = busy;
        e.settings.disabled = busy;
        e.cancel.hidden = !busy;
        e.progress.hidden = !busy;
        updateSummary();
    }

    function cancelGeneration() {
        state.jobId++;
        state.controller?.abort();
        state.controller = null;
        setBusy(false);
        e.status.textContent = 'PDF generation cancelled.';
    }

    function open() {
        try {
            state.snapshot = getSnapshot();
            state.ownerId = window.PV_AUTH?.getUser?.()?.uid || '';
            state.enabledVariants = new Set(state.snapshot.enabledVariants);
            state.excludedSlotIds = new Set();
            state.skippedSlotIds = new Set();
            state.cardPage = state.printPage = 1;
            e.layout.value = state.snapshot.layout;
            e.scope.value = 'all';
            e.paper.value = 'letter9';
            e.additional.open = false;
            e.additional.querySelectorAll('details').forEach(section => { section.open = false; });
            e['card-search'].value = e['print-search'].value = '';
            e.status.textContent = '';
            discardResult();
            e.variants.replaceChildren(...getGuideVariantOptions(state.snapshot.manifest).map(({ value: variant, label }) =>
                checkboxLabel(label, state.enabledVariants.has(variant), `pv-export-variant-${variant}`, checked => {
                    checked ? state.enabledVariants.add(variant) : state.enabledVariants.delete(variant);
                    state.cardPage = state.printPage = 1;
                    changed();
                }).label));
            state.allowed = false;
            render();
            dialog.showModal();
            void checkAccess();
        } catch (error) {
            button.disabled = true;
            button.textContent = 'PDF export unavailable';
        }
    }

    async function generate() {
        if (state.busy) return;
        const jobId = ++state.jobId;
        const ownerId = window.PV_AUTH?.getUser?.()?.uid || '';
        discardResult();
        setBusy(true);
        e.progress.value = 0;
        e.status.textContent = 'Preparing PDF…';
        const controller = new AbortController();
        state.controller = controller;
        try {
            if (!await checkAccess(true)) {
                if (jobId === state.jobId) e.status.textContent = 'PDF generation requires an eligible signed-in account.';
                return;
            }
            if (jobId !== state.jobId || ownerId !== (window.PV_AUTH?.getUser?.()?.uid || '')) return;
            state.snapshot = getSnapshot();
            if (e.scope.value === 'missing' && !state.snapshot.ownershipKnown) throw new Error('Sync the Default Collection in Dex before exporting missing variants.');
            render();
            const inserts = printable();
            if (!inserts.length) throw new Error('No inserts match your selection.');
            const options = {
                setName: cleanText(state.snapshot.manifest.expansion.name), layout: e.layout.value,
                style: e.style.value, scope: e.scope.value, paper: e.paper.value,
                signal: controller.signal,
                onProgress: progress => {
                    if (jobId !== state.jobId) return;
                    e.status.textContent = `${progress.stage} — ${progress.completed} / ${progress.total}`;
                    e.progress.max = progress.total;
                    e.progress.value = progress.completed;
                },
            };
            const { renderBinderPdf } = await import('./master-set-guide-pdf.mjs?v=2026-09-30-variants-1');
            const result = await renderBinderPdf(inserts, options);
            if (jobId !== state.jobId || !dialog.open || ownerId !== (window.PV_AUTH?.getUser?.()?.uid || '')) return;
            state.blob = new Blob([result.bytes], { type: 'application/pdf' });
            state.filename = sanitizeBinderFilename(options.setName, options.layout, options.scope, options.style);
            state.objectUrl = URL.createObjectURL(state.blob);
            e.download.href = state.objectUrl;
            e.download.download = state.filename;
            e.download.hidden = false;
            const file = new File([state.blob], state.filename, { type: 'application/pdf' });
            e.share.hidden = !(navigator.share && navigator.canShare?.({ files: [file] }));
            e.status.textContent = `PDF ready: ${result.insertCount} inserts, ${result.pageCount} PDF pages.${result.failedImages ? ` ${result.failedImages} images could not load; their labels are included.` : ''} Choose Download PDF.`;
        } catch (error) {
            if (jobId === state.jobId) e.status.textContent = error?.name === 'AbortError' ? 'PDF generation cancelled.'
                : error instanceof Error ? error.message : 'PDF generation failed. Please retry.';
        } finally {
            if (jobId === state.jobId) { state.controller = null; setBusy(false); }
        }
    }

    button.addEventListener('click', open);
    e.close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        if (state.busy) cancelGeneration();
        state.accessId++;
        discardResult();
        button.focus();
    });
    e.cancel.addEventListener('click', cancelGeneration);
    e.generate.addEventListener('click', () => { void generate(); });
    for (const control of ['layout', 'style', 'scope', 'paper']) e[control].addEventListener('change', changed);
    for (const prefix of ['card', 'print']) {
        e[`${prefix}-search`].addEventListener('input', () => { state[prefix === 'card' ? 'cardPage' : 'printPage'] = 1; render(); });
        for (const direction of ['prev', 'next']) e[`${prefix}-${direction}`].addEventListener('click', () => {
            state[prefix === 'card' ? 'cardPage' : 'printPage'] += direction === 'prev' ? -1 : 1;
            render();
        });
    }
    for (const action of ['include', 'exclude']) e[`${action}-matching`].addEventListener('click', () => {
        cardGroups().flat().forEach(row => action === 'include' ? state.excludedSlotIds.delete(row.slotId) : state.excludedSlotIds.add(row.slotId));
        changed();
    });
    for (const action of ['print', 'skip']) e[`${action}-matching`].addEventListener('click', () => {
        matchingCandidates().forEach(row => action === 'print' ? state.skippedSlotIds.delete(row.slotId) : state.skippedSlotIds.add(row.slotId));
        changed();
    });
    e.share.addEventListener('click', async () => {
        if (!state.blob) return;
        try {
            const file = new File([state.blob], state.filename, { type: 'application/pdf' });
            await navigator.share({ files: [file], title: 'PokéValuator binder inserts' });
        } catch (error) {
            if (error?.name !== 'AbortError') e.status.textContent = 'Sharing is unavailable. Use Download PDF instead.';
        }
    });
    function refreshCollection() {
        if (!dialog.open || state.busy) return;
        state.snapshot = getSnapshot();
        discardResult();
        render();
    }
    window.addEventListener('storage', event => {
        if (event.key === COLLECTION_KEY || event.key === 'pv:scrydex:dexOwnerUid:v1' || event.key === null) refreshCollection();
    });
    window.addEventListener('pv:dex-state-changed', refreshCollection);
    window.PV_AUTH?.onAuthStateChanged?.(user => {
        if (!dialog.open) return;
        const userId = user?.uid || '';
        if (userId !== state.ownerId) {
            if (state.busy) cancelGeneration();
            state.ownerId = userId;
            discardResult();
            state.snapshot = getSnapshot();
            render();
        }
        void checkAccess();
    });
    window.addEventListener('pagehide', () => { state.controller?.abort(); discardResult(); });
    button.disabled = false;
}
