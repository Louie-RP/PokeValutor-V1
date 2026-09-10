document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('pv-sets-list');
    const filter = document.getElementById('pv-sets-filter');
    const collapseAllButton = document.getElementById('pv-sets-collapse-all');
    const status = document.getElementById('pv-sets-status');
    const cacheKey = 'pv:sets:english:v1';
    const cacheTtl = 30 * 24 * 60 * 60 * 1000;
    let expansions = [];

    const workerBase = () => String(window?.PV_SECRETS?.PV_API_URL || 'https://pokevalutor-v1.lreyperez18.workers.dev').replace(/\/$/, '');
    const text = (value) => String(value ?? '').trim();
    const dateLabel = (value) => {
        const raw = text(value);
        if (!raw) return '';
        const match = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : new Date(raw);
        return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
    };
    const excluded = (entry) => {
        const id = text(entry?.id).toLowerCase();
        const name = text(entry?.name).toLowerCase();
        const series = text(entry?.series).toLowerCase();
        const language = text(entry?.language || entry?.language_code).toLowerCase();
        return (language && language !== 'english' && language !== 'en') || Boolean(entry?.is_online_only ?? entry?.isOnlineOnly) || id.startsWith('tcgp') || id.startsWith('mcd') || ['promo', 'pocket', 'mcdonald', 'tcg classic', 'energies'].some((word) => name.includes(word) || series.includes(word)) || ['clv', 'clc', 'clb', 'sve'].includes(id);
    };
    const readCache = () => {
        try { const parsed = JSON.parse(localStorage.getItem(cacheKey) || ''); return Date.now() - Number(parsed?.savedAt) < cacheTtl && Array.isArray(parsed?.value) ? parsed.value : null; } catch { return null; }
    };
    const writeCache = (value) => { try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), value })); } catch {} };
    const createCard = (entry) => {
        const item = document.createElement('article'); item.className = 'pv-setCard';
        const link = document.createElement('a'); link.className = 'pv-expansionCardLink'; link.href = `search.html?expansionId=${encodeURIComponent(entry.id)}&expansionName=${encodeURIComponent(entry.name)}`; link.setAttribute('aria-label', `View top cards for ${entry.name}`);
        const logo = document.createElement('div'); logo.className = 'pv-setCard__logo';
        if (entry.logo) { const image = document.createElement('img'); image.src = entry.logo; image.alt = `${entry.name} logo`; image.loading = 'lazy'; image.decoding = 'async'; logo.append(image); }
        const name = document.createElement('h3'); name.className = 'pv-setCard__name'; name.textContent = entry.name;
        const date = document.createElement('p'); date.className = 'pv-setCard__date'; date.textContent = dateLabel(entry.releaseDate);
        link.append(logo, name, date); item.append(link); return item;
    };
    const render = () => {
        const query = text(filter?.value).toLowerCase(); const visible = expansions.filter((entry) => `${entry.name} ${entry.series}`.toLowerCase().includes(query)); list.replaceChildren();
        const groups = new Map(); visible.forEach((entry) => { const key = entry.series || 'Other'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entry); });
        groups.forEach((entries, series) => { const section = document.createElement('details'); section.className = 'pv-setSeries'; section.open = true; const heading = document.createElement('summary'); heading.className = 'pv-setSeries__title'; heading.textContent = series; const grid = document.createElement('div'); grid.className = 'pv-setSeries__grid'; entries.forEach((entry) => grid.append(createCard(entry))); section.append(heading, grid); list.append(section); });
        status.textContent = visible.length ? `${visible.length} set${visible.length === 1 ? '' : 's'} found` : 'No sets match your search.';
        updateCollapseAllButton();
    };
    const updateCollapseAllButton = () => {
        if (!collapseAllButton) return;
        const groups = Array.from(list.querySelectorAll('.pv-setSeries'));
        const allCollapsed = groups.length > 0 && groups.every((group) => !group.open);
        collapseAllButton.textContent = allCollapsed ? 'Expand All' : 'Collapse All';
        collapseAllButton.setAttribute('aria-label', allCollapsed ? 'Expand all series' : 'Collapse all series');
    };
    const load = async () => {
        const cached = readCache();
        if (Array.isArray(cached)) {
            expansions = cached;
            render();
            return;
        }
        try {
            const baseParams = { q: 'language:english -is_online_only:true -id:tcgp* -series:promo -name:promo -series:pocket -name:pocket', orderBy: '-release_date', pageSize: '100', select: 'id,name,logo,release_date,is_online_only,series,language,language_code', casing: 'camel' };
            const merged = []; const seen = new Set(); let totalCount = Number.POSITIVE_INFINITY;
            for (let page = 1; page <= 20 && merged.length < totalCount; page++) {
                const params = new URLSearchParams({ ...baseParams, page: String(page) });
                const response = await fetch(`${workerBase()}/expansions/search?${params}`); if (!response.ok) throw new Error('Set catalog unavailable');
                const payload = await response.json(); const items = Array.isArray(payload?.data) ? payload.data : [];
                totalCount = Number(payload?.totalCount); if (!Number.isFinite(totalCount)) totalCount = merged.length + items.length;
                items.forEach((entry) => { const id = text(entry?.id); if (id && !seen.has(id) && text(entry?.name) && !excluded(entry)) { seen.add(id); merged.push(entry); } });
                if (items.length < 100) break;
            }
            expansions = merged.map((entry) => ({ id: text(entry.id), name: text(entry.name), series: text(entry.series) || 'Other', logo: text(entry.logo), releaseDate: text(entry.releaseDate || entry.release_date) })); writeCache(expansions); render();
        } catch { if (!expansions.length) status.textContent = 'Sets are temporarily unavailable. Please try again later.'; }
    };
    filter?.addEventListener('input', render);
    collapseAllButton?.addEventListener('click', () => {
        const groups = Array.from(list.querySelectorAll('.pv-setSeries'));
        const allCollapsed = groups.length > 0 && groups.every((group) => !group.open);
        groups.forEach((group) => { group.open = allCollapsed; });
        updateCollapseAllButton();
    });
    list?.addEventListener('toggle', updateCollapseAllButton, true);
    load();
});