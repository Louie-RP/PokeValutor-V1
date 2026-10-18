import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const files = await readdir('.');
const sharedCss = (await readFile('styles.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const script = await readFile('script.js', 'utf8');
const pricingClass = '.pv-nav__link--pricing';
const ordinaryLink = /\.pv-nav__link(?![\w-])/;
const appearanceProperty = /(?:^|;)\s*(?:color|background(?:-[\w-]+)?|border(?:-[\w-]+)?|font(?:-[\w-]+)?|box-shadow)\s*:/;

test('shared Pricing CTA owns dark text on gold in every interactive state', () => {
    const rules = [...sharedCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const state of ['', ':hover', ':focus', ':focus-visible', '[aria-current="page"]']) {
        const selector = `.pv-nav__link${pricingClass}${state}`;
        const rule = rules.find(([, selectors]) => selectors.split(',').some((item) => item.trim() === selector));
        assert.ok(rule, `Missing shared Pricing style for ${state || 'default'}`);
        assert.match(rule[2], /color:\s*#(?:111111|050505)\s*;/);
        assert.match(rule[2], /background:\s*linear-gradient\(/);
    }
    assert.match(script, /isNavLinkForPage\(link, 'pricing\.html'\)[\s\S]*?link\.classList\.add\('pv-nav__link--pricing'\)/);
});

for (const file of files.filter((name) => name.endsWith('.css') && name !== 'styles.css')) {
    test(`${file} leaves Pricing appearance to the shared CTA`, async () => {
        const css = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const [, selectors, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            if (!appearanceProperty.test(declarations)) continue;
            for (const selector of selectors.split(',')) {
                assert.ok(
                    !selector.replaceAll(`:not(${pricingClass})`, '').includes(pricingClass),
                    `${file}: Pricing appearance must stay in styles.css`,
                );
                if (!ordinaryLink.test(selector)) continue;
                assert.ok(
                    selector.includes(`:not(${pricingClass})`),
                    `${file}: ${selector.trim()} must not override the Pricing CTA`,
                );
            }
        }
    });
}

for (const file of files.filter((name) => name.endsWith('.html'))) {
    test(`${file} uses the cache-busted shared navigation stylesheet`, async () => {
        const html = await readFile(file, 'utf8');
        if (!html.includes('pv-nav__link')) return;
        const stylesheetVersion = file === 'search.html'
            ? '2026-10-18-search-pagination-1'
            : '2026-10-18-pricing-nav-1';
        assert.ok(html.includes(`href="styles.css?v=${stylesheetVersion}"`));
        assert.match(html, /src="script\.js(?:\?[^"]*)?"[^>]*defer/);
        for (const [, stylesheet] of html.matchAll(/href="([^"]+-refresh\.css)\?[^"]*"/g)) {
            const css = await readFile(stylesheet, 'utf8');
            if (!ordinaryLink.test(css)) continue;
            assert.ok(
                html.includes(`${stylesheet}?v=${stylesheetVersion}`),
                `${file} must invalidate the cached ${stylesheet}`,
            );
        }
    });
}
