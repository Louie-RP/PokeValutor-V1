import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, beforeEach, test } from 'node:test';

const originals = Object.fromEntries(['document', 'fetch', 'navigator', 'PV_AUTH', 'PV_POPULARITY']
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalWarn = console.warn;
if (!globalThis.crypto) globalThis.crypto = webcrypto;

class Node {
    constructor(ownerDocument, tagName) {
        Object.assign(this, { ownerDocument, tagName, children: [], listeners: new Map(), hidden: false, disabled: false });
        this.ownText = '';
    }
    set textContent(value) { this.ownText = String(value); this.children = []; }
    get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(''); }
    append(...nodes) {
        for (const node of nodes) {
            if (node.tagName === '#fragment') this.children.push(...node.children);
            else this.children.push(node);
        }
    }
    replaceChildren(...nodes) { this.children = []; this.ownText = ''; this.append(...nodes); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
}

function documentForTest() {
    const elements = new Map();
    const document = {
        listeners: new Map(),
        createElement(tag) { return new Node(document, tag); },
        createDocumentFragment() { return new Node(document, '#fragment'); },
        createTextNode(text) { const node = new Node(document, '#text'); node.textContent = text; return node; },
        getElementById(id) { return elements.get(id) || null; },
        addEventListener(name, handler) { this.listeners.set(name, handler); },
    };
    for (const id of ['panel', 'results', 'status', 'refresh', 'days']) {
        elements.set(`pv-popularity-${id}`, new Node(document, 'div'));
    }
    document.getElementById('pv-popularity-days').value = '30';
    document.getElementById('pv-popularity-panel').hidden = true;
    return document;
}

globalThis.document = documentForTest();
await import('./popularity.js');
const api = globalThis.PV_POPULARITY;
const ready = globalThis.document.listeners.get('DOMContentLoaded');
let requests;
let warnings;
let document;
let navigator;
const row = { id: 'sv1-1', name: 'Pikachu', count: 3 };
const reportData = () => ({
    ok: true, from: '2026-09-19', through: '2026-10-18',
    metrics: { cardSearch: [row], setSearch: [], cardView: [], setView: [] },
});
const card = { id: 'sv1-1', name: 'Pikachu', expansion: { id: 'sv1', name: 'Scarlet & Violet' } };

beforeEach(() => {
    document = documentForTest();
    globalThis.document = document;
    navigator = {};
    Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true });
    requests = [];
    warnings = [];
    console.warn = (...args) => { warnings.push(args); };
    globalThis.PV_AUTH = { getIdToken: async () => 'test-admin-token' };
    globalThis.fetch = async (url, init) => {
        requests.push({ url, init });
        return Response.json(init.method === 'POST' ? { ok: true } : reportData());
    };
    ready();
});

after(() => {
    console.warn = originalWarn;
    for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    }
});

test('search and view delivery is independent of data caches, deduplicates IDs, and excludes raw query data', async () => {
    assert.equal(await api.recordSearch([card, card]), true);
    assert.equal(await api.recordSearch([card]), true); // A new explicit cached search is still an action.
    assert.equal(await api.recordView(card), true);
    const events = requests.map(({ init }) => JSON.parse(init.body));
    assert.equal(events[0].cards.length, 1);
    assert.equal(events[0].type, 'search');
    assert.equal(events[2].type, 'view');
    assert.equal(new Set(events.map((event) => event.eventId)).size, 3);
    for (const event of events) {
        assert.deepEqual(Object.keys(event).sort(), ['cards', 'eventId', 'type']);
        assert.equal(event.cards[0].setId, 'sv1');
    }
    assert.ok(requests.every(({ init }) => init.cache === 'no-store'));
});

test('Do Not Track and Global Privacy Control suppress delivery without network calls', async () => {
    navigator.doNotTrack = '1';
    assert.equal(await api.recordSearch([card]), false);
    navigator.doNotTrack = '0';
    navigator.globalPrivacyControl = true;
    assert.equal(await api.recordView(card), false);
    assert.equal(requests.length, 0);
});

test('dashboard renders hostile stored labels strictly as text and validates link IDs', () => {
    const data = reportData();
    data.metrics.cardSearch[0] = { ...row, name: '<img src=x onerror=alert(1)>' };
    const container = document.createElement('div');
    api.renderReport(container, data);
    assert.ok(container.textContent.includes('<img src=x onerror=alert(1)>'));
    const allNodes = (node) => [node, ...node.children.flatMap(allNodes)];
    assert.equal(allNodes(container).some((node) => node.tagName === 'img'), false);
    const link = allNodes(container).find((node) => node.tagName === 'a');
    assert.equal(link.href, 'card.html?id=sv1-1');
    data.metrics.cardSearch[0] = { ...row, id: 'javascript:alert(1)' };
    assert.throws(() => api.renderReport(container, data), /invalid row/);
});

test('admin panel loads requested 30/60/90 windows and exposes empty state', async () => {
    api.setAdminVisible(true);
    const button = document.getElementById('pv-popularity-refresh');
    for (const days of ['30', '60', '90']) {
        document.getElementById('pv-popularity-days').value = days;
        await button.listeners.get('click')();
        assert.ok(requests.at(-1).url.endsWith(`days=${days}&limit=20`));
        assert.equal(requests.at(-1).init.headers.Authorization, 'Bearer test-admin-token');
        assert.ok(document.getElementById('pv-popularity-results').textContent.includes('No activity recorded'));
        assert.equal(button.disabled, false);
    }
});

test('signout hides and clears reports and discards an in-flight response', async () => {
    api.setAdminVisible(true);
    let finish;
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    const pending = document.getElementById('pv-popularity-refresh').listeners.get('click')();
    await Promise.resolve();
    api.setAdminVisible(false);
    finish(Response.json(reportData()));
    await pending;
    assert.equal(document.getElementById('pv-popularity-panel').hidden, true);
    assert.equal(document.getElementById('pv-popularity-results').textContent, '');
    assert.equal(document.getElementById('pv-popularity-status').textContent, '');
    assert.equal(document.getElementById('pv-popularity-refresh').disabled, false);
});

test('a missing token or denied report surfaces an error and never renders stale rows', async () => {
    api.setAdminVisible(true);
    globalThis.PV_AUTH.getIdToken = async () => null;
    await document.getElementById('pv-popularity-refresh').listeners.get('click')();
    assert.match(document.getElementById('pv-popularity-status').textContent, /Sign in as an admin/);
    assert.equal(requests.length, 0);
    globalThis.PV_AUTH.getIdToken = async () => 'basic-token';
    globalThis.fetch = async () => Response.json({ ok: false, error: 'Admin access required.' }, { status: 403 });
    await document.getElementById('pv-popularity-refresh').listeners.get('click')();
    assert.equal(document.getElementById('pv-popularity-results').textContent, '');
    assert.match(document.getElementById('pv-popularity-status').textContent, /Admin access required/);
    assert.equal(warnings.length, 2);
});

test('tracking failures are logged without breaking searches or retrying them', async () => {
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await api.recordSearch([card]), false);
    assert.equal(warnings.length, 1);
});

test('static wiring tracks only terminal search results, not paging, restoration or fallback attempts', async () => {
    const read = (file) => readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    const [search, home, cardPage, frontend, account] = await Promise.all(
        ['search.js', 'home-preview.js', 'card.js', 'popularity.js', 'account.js'].map(read),
    );
    assert.equal((search.match(/PV_POPULARITY\?\.recordSearch/g) || []).length, 4);
    const loadMore = search.slice(search.indexOf('    async function loadMoreDexSetCards()'), search.indexOf('    if (form && input)'));
    assert.doesNotMatch(loadMore, /PV_POPULARITY/);
    const searchFetcher = search.slice(search.indexOf('    async function fetchCardsSearchPage('), search.indexOf('    function isMatchingExpansionResultSet('));
    assert.doesNotMatch(searchFetcher, /PV_POPULARITY/);
    assert.match(home, /if \(trackPopularity\) void window\.PV_POPULARITY\?\.recordSearch\(cards\)/);
    assert.match(home, /runLiveCardSearch\(cachedSearch\.query, false\)/);
    assert.match(cardPage, /renderCard\(card\);\s+void window\.PV_POPULARITY\?\.recordView\(card\)/);
    assert.match(account, /const generation = \+\+authViewGeneration;\s+setAdminVisible\(false\)/);
    assert.match(account, /if \(generation !== authViewGeneration\) return/);
    assert.doesNotMatch(frontend, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval|Function)\b/);
    for (const file of ['index.html', 'home-preview.html', 'search.html', 'dex.html', 'card.html', 'account.html']) {
        const html = await read(file);
        assert.match(html, /popularity\.js\?v=2026-10-18-popularity-1/);
    }
    const html = await read('account.html');
    for (const days of ['30', '60', '90']) assert.ok(html.includes(`value="${days}"`));
});

test('disabled tracking logs once then stops sending until reload', async () => {
    globalThis.fetch = async () => {
        requests.push({});
        return Response.json({ ok: false, code: 'POPULARITY_DISABLED', error: 'Popularity tracking is disabled.' }, { status: 409 });
    };
    assert.equal(await api.recordSearch([card]), false);
    assert.equal(await api.recordSearch([card]), false);
    assert.equal(requests.length, 1);
    assert.equal(warnings.length, 1);
});
