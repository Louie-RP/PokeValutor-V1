(function (root) {
    'use strict';

    let disabled = false;
    let reportGeneration = 0;
    const metrics = {
        cardSearch: 'Cards: search-result appearances',
        setSearch: 'Sets represented in searches',
        cardView: 'Cards: detail-page views',
        setView: 'Sets: card-detail views',
    };

    function baseUrl() {
        return (root.PV_SECRETS?.PV_API_URL || 'https://pokevalutor-v1.lreyperez18.workers.dev').replace(/\/$/, '');
    }

    async function api(path, body, admin = false) {
        const token = root.PV_AUTH?.getIdToken ? await root.PV_AUTH.getIdToken(false) : null;
        if (admin && !token) throw new Error('Sign in as an admin to view popularity reports.');
        const response = await root.fetch(`${baseUrl()}${path}`, {
            method: body ? 'POST' : 'GET',
            headers: {
                ...(body ? { 'content-type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (!response.ok || data?.ok !== true) {
            if (data?.code === 'POPULARITY_DISABLED' && !admin) disabled = true;
            throw new Error(data?.error || `Popularity request failed (${response.status}).`);
        }
        return data;
    }

    function eventCards(cards) {
        const unique = new Map();
        for (const card of Array.isArray(cards) ? cards : []) {
            const id = String(card?.id || '').toLowerCase();
            const setId = String(card?.expansion?.id || id.split('-')[0] || '').toLowerCase();
            if (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(id)
                || !/^[a-z0-9][a-z0-9_-]{0,95}$/.test(setId) || !id.startsWith(`${setId}-`)) continue;
            unique.set(id, {
                id, setId,
                name: String(card?.name || '').slice(0, 120),
                setName: String(card?.expansion?.name || '').slice(0, 120),
            });
            if (unique.size === 100) break;
        }
        return Array.from(unique.values());
    }

    function record(type, cards, set) {
        if (disabled || root.navigator?.doNotTrack === '1' || root.navigator?.globalPrivacyControl === true) {
            return Promise.resolve(false);
        }
        return Promise.resolve().then(async () => {
            const body = { eventId: root.crypto.randomUUID(), type, cards: eventCards(cards) };
            if (set?.id && type === 'search') {
                body.set = { id: String(set.id).toLowerCase(), name: String(set.name || '').slice(0, 120) };
            }
            await api('/popularity/events', body);
            return true;
        }).catch((error) => {
            root.console.warn('[pv:popularity] event was not recorded', error);
            return false;
        });
    }

    function renderReport(container, data) {
        const document = container.ownerDocument;
        const fragment = document.createDocumentFragment();
        for (const [metric, heading] of Object.entries(metrics)) {
            const section = document.createElement('section');
            const title = document.createElement('h4');
            title.textContent = heading;
            section.append(title);
            const rows = data?.metrics?.[metric];
            if (!Array.isArray(rows)) throw new Error('Popularity report is missing a metric.');
            const list = document.createElement('ol');
            for (const row of rows) {
                if (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(row?.id || '')
                    || !Number.isSafeInteger(row.count) || row.count < 1) {
                    throw new Error('Popularity report contains an invalid row.');
                }
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.className = 'pv-inlineLink';
                link.href = metric.startsWith('card')
                    ? `card.html?id=${encodeURIComponent(row.id)}`
                    : `search.html?expansionId=${encodeURIComponent(row.id)}`;
                link.textContent = `${String(row.name || row.id)} (${row.id})`;
                item.append(link, document.createTextNode(`: ${row.count.toLocaleString()}`));
                list.append(item);
            }
            if (!rows.length) {
                const empty = document.createElement('p');
                empty.textContent = 'No activity recorded for this window yet.';
                section.append(empty);
            } else {
                section.append(list);
            }
            fragment.append(section);
        }
        container.replaceChildren(fragment);
    }

    function setAdminVisible(visible) {
        reportGeneration += 1;
        const panel = root.document?.getElementById('pv-popularity-panel');
        if (!panel) return;
        panel.hidden = !visible;
        root.document.getElementById('pv-popularity-results')?.replaceChildren();
        const status = root.document.getElementById('pv-popularity-status');
        if (status) status.textContent = '';
        const button = root.document.getElementById('pv-popularity-refresh');
        if (button) button.disabled = false;
    }

    async function loadReport() {
        const panel = root.document.getElementById('pv-popularity-panel');
        if (!panel || panel.hidden) return;
        const results = root.document.getElementById('pv-popularity-results');
        const status = root.document.getElementById('pv-popularity-status');
        const button = root.document.getElementById('pv-popularity-refresh');
        const days = root.document.getElementById('pv-popularity-days').value;
        const generation = ++reportGeneration;
        button.disabled = true;
        results.replaceChildren();
        status.textContent = 'Loading popularity report...';
        try {
            const data = await api(`/popularity/report?days=${encodeURIComponent(days)}&limit=20`, null, true);
            if (generation !== reportGeneration || panel.hidden) return;
            renderReport(results, data);
            status.textContent = `${data.from} through ${data.through} (UTC, including today). Top 20 per category.`;
        } catch (error) {
            if (generation !== reportGeneration || panel.hidden) return;
            results.replaceChildren();
            status.textContent = error.message || 'Unable to load popularity report.';
            root.console.warn('[pv:popularity] report failed', error);
        } finally {
            if (generation === reportGeneration) button.disabled = false;
        }
    }

    root.PV_POPULARITY = {
        recordSearch: (cards, set) => record('search', cards, set),
        recordView: (card) => record('view', [card]),
        setAdminVisible, renderReport,
    };
    root.document?.addEventListener('DOMContentLoaded', () => {
        root.document.getElementById('pv-popularity-refresh')?.addEventListener('click', loadReport);
        root.document.getElementById('pv-popularity-days')?.addEventListener('change', loadReport);
    });
}(globalThis));
