/* PokeValutor site JS */
(function () {
  const year = document.getElementById('pv-year');
  const form = document.getElementById('pv-contactForm');

  // Update year in footer
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  // Mobile nav toggles with ARIA sync (works across pages)
  const navToggles = Array.from(document.querySelectorAll('.pv-navToggle'));
  for (const btn of navToggles) {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));

      const targetId = btn.getAttribute('aria-controls');
      if (!targetId) return;
      const nav = document.getElementById(targetId);
      if (!nav) return;
      nav.setAttribute('aria-expanded', String(!expanded));
    });
  }

  // Contact form handler (Formspree)
  if (form) {
    const statusEl = document.getElementById('pv-contactStatus');
    const submitBtn = document.getElementById('pv-submit');

    function setStatus(message) {
      if (statusEl) statusEl.textContent = String(message || '');
    }

    form.addEventListener('submit', async (e) => {
      const action = String(form.getAttribute('action') || '');
      const isFormspree = /(^|\/\/)formspree\.io\//i.test(action);

      // If this ever becomes a non-Formspree form, don't interfere.
      if (!isFormspree) return;

      e.preventDefault();
      setStatus('Sending…');

      if (submitBtn && 'disabled' in submitBtn) submitBtn.disabled = true;

      try {
        const formData = new FormData(form);
        const res = await fetch(action, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        });

        if (res.ok) {
          setStatus('Thanks! Your message has been sent. Redirecting…');
          form.reset();

          // Redirect to a static success page (GitHub Pages friendly).
          window.setTimeout(() => {
            window.location.href = 'thanks.html';
          }, 600);
          return;
        }

        // Formspree returns JSON with error details when possible.
        let errorMsg = 'Sorry, there was a problem sending your message. Please try again.';
        try {
          const data = await res.json();
          if (data && typeof data === 'object' && Array.isArray(data.errors) && data.errors.length) {
            const first = data.errors[0];
            if (first && typeof first.message === 'string' && first.message.trim()) {
              errorMsg = first.message.trim();
            }
          }
        } catch {
          // ignore
        }
        setStatus(errorMsg);
      } catch {
        setStatus('Network error. Please check your connection and try again.');
      } finally {
        if (submitBtn && 'disabled' in submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Home page: latest expansions marquee
  const expansionsTrack = document.getElementById('pv-expansions-track');
  const expansionsViewport = document.getElementById('pv-expansions-marquee');

  function shouldEnableExpansionsAutoScroll() {
    if (!expansionsViewport || !expansionsTrack) return false;

    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return false;

    // Disable auto-scroll on mobile/touch/coarse pointers.
    const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarsePointer) return false;

    const smallScreen = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    if (smallScreen) return false;

    return true;
  }

  function getWorkerBase() {
    // Keep consistent with search/sealed pages.
    const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
    return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
  }

  function escapeText(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toDateLabel(isoDate) {
    const raw = String(isoDate || '').trim();
    if (!raw) return '';

    // Scrydex uses YYYY/MM/DD for release_date.
    const m = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    const d = m
      ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
      : new Date(raw);

    if (Number.isNaN(d.getTime())) return raw;
    try {
      return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
    } catch {
      return raw;
    }
  }

  function safeParseJson(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = safeParseJson(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.expiresAt !== 'number' || !('value' in parsed)) return null;
      if (Date.now() > parsed.expiresAt) {
        try { localStorage.removeItem(key); } catch {}
        return null;
      }
      return parsed.value;
    } catch {
      return null;
    }
  }

  function cacheSet(key, value, ttlMs) {
    try {
      const payload = { value, expiresAt: Date.now() + ttlMs, savedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function svgLogoDataUri(label) {
    const safe = String(label || '').slice(0, 40);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="160" viewBox="0 0 420 160">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#FFCB05" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#A78BFA" stop-opacity="0.14"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="420" height="160" rx="20" fill="#0b0b0b"/>
  <rect x="0" y="0" width="420" height="160" rx="20" fill="url(#g)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="28" font-weight="800">${escapeText(safe)}</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function renderExpansionsList(expansions) {
    if (!expansionsTrack) return;
    const list = Array.isArray(expansions) ? expansions : [];

    const html = list.map((x) => {
      const name = String(x?.name || '');
      const dateLabel = toDateLabel(x?.releaseDate || x?.release_date);
      const logoSrc = String(x?.logo || x?.logoSrc || '').trim();
      const src = logoSrc ? logoSrc : svgLogoDataUri(name || 'Expansion');

      return `
        <li class="pv-marquee__item" role="listitem">
          <article class="pv-expansionCard" aria-label="${escapeText(name)}">
            <div class="pv-expansionCard__logo">
              <img src="${escapeText(src)}" alt="${escapeText(name)} logo" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
            </div>
            <p class="pv-expansionCard__name">${escapeText(name)}</p>
            <p class="pv-expansionCard__date">${escapeText(dateLabel)}</p>
          </article>
        </li>`;
    }).join('');

    expansionsTrack.innerHTML = html;

    // Duplicate items only when auto-scrolling (desktop) so mobile doesn't get an
    // overly-long loop and can scroll to a natural end.
    if (shouldEnableExpansionsAutoScroll()) {
      const children = Array.from(expansionsTrack.children);
      for (const child of children) {
        const clone = child.cloneNode(true);
        if (clone && clone.setAttribute) clone.setAttribute('aria-hidden', 'true');
        expansionsTrack.appendChild(clone);
      }
    }
  }

  async function loadLatestEnglishExpansions() {
    // Only run on pages that have the marquee.
    if (!expansionsTrack) return;

    // Bump this key when filtering/shape changes so old cached results don't linger.
    const CACHE_KEY = 'pv:expansions:latestEnglish:v2';
    const TTL_MS = 30 * 24 * 60 * 60 * 1000;

    function isExcludedExpansion(x) {
      const id = String(x?.id || '').toLowerCase();
      const name = String(x?.name || '').toLowerCase();
      const series = String(x?.series || '').toLowerCase();
      const lang = String(x?.language || '').toLowerCase();
      const langCode = String(x?.languageCode || x?.language_code || '').toLowerCase();
      const isOnlineOnly = Boolean(x?.isOnlineOnly ?? x?.is_online_only);

      if (lang && lang !== 'english') return true;
      if (langCode && langCode !== 'en') return true;

      // Pokémon Pocket / TCGP expansions.
      if (isOnlineOnly) return true;
      if (id.startsWith('tcgp') || id.includes('tcgp-')) return true;
      if (series.includes('pocket') || name.includes('pocket')) return true;

      // Promo expansions.
      if (series.includes('promo') || name.includes('promo')) return true;

      return false;
    }

    function normalizeExpansions(list) {
      return (Array.isArray(list) ? list : [])
        .filter((x) => x && typeof x === 'object')
        .filter((x) => !isExcludedExpansion(x))
        .map((x) => ({
          id: String(x.id || ''),
          name: String(x.name || ''),
          logo: String(x.logo || ''),
          releaseDate: String(x.releaseDate || x.release_date || ''),
          // Keep these fields if present so future filtering stays accurate.
          series: x.series,
          language: x.language,
          languageCode: x.languageCode || x.language_code,
          isOnlineOnly: x.isOnlineOnly ?? x.is_online_only,
        }))
        .filter((x) => x.name)
        .slice(0, 6);
    }

    const cached = cacheGet(CACHE_KEY);
    if (Array.isArray(cached) && cached.length) {
      const cleaned = normalizeExpansions(cached);
      if (cleaned.length) {
        // If older cache entries included excluded sets, overwrite cache with the cleaned list.
        if (cleaned.length !== cached.length) {
          cacheSet(CACHE_KEY, cleaned, TTL_MS);
        }
        renderExpansionsList(cleaned);
        return;
      }
      // If cached list becomes empty after filtering, fall through to refetch.
    }

    // Fallback placeholder (renders immediately if the network is slow).
    renderExpansionsList([
      { name: 'Loading expansions…', releaseDate: '', logo: '' },
      { name: 'Please wait', releaseDate: '', logo: '' },
      { name: '', releaseDate: '', logo: '' },
      { name: '', releaseDate: '', logo: '' },
      { name: '', releaseDate: '', logo: '' },
      { name: '', releaseDate: '', logo: '' },
    ]);

    try {
      const base = getWorkerBase();

      // Scrydex docs: expansions have `logo` and `release_date` (YYYY/MM/DD).
      // We call the Worker so API keys are never exposed in the browser.
      // Exclusions:
      // - Remove Pokémon Pocket / TCGP expansions (typically online-only)
      // - Remove promo expansions
      // - Keep English only
      const q = 'language:english -is_online_only:true -id:tcgp* -series:promo -name:promo -series:pocket -name:pocket';
      // Fetch more than 6 so we can filter client-side and still show 6.
      const url = `${base}/expansions/search?q=${encodeURIComponent(q)}&orderBy=-release_date&page=1&pageSize=30&select=id,name,logo,release_date,is_online_only,series,language,language_code&casing=camel`;

      const res = await fetch(url, { method: 'GET' });
      const text = await res.text();
      const data = safeParseJson(text);

      if (!res.ok) {
        const msg = (data && typeof data === 'object' && (data.error || data.message)) ? (data.error || data.message) : `Request failed (${res.status})`;
        throw new Error(String(msg));
      }

      const items = (data && typeof data === 'object' && Array.isArray(data.data)) ? data.data : [];

      const normalized = normalizeExpansions(items);

      if (normalized.length) {
        cacheSet(CACHE_KEY, normalized, TTL_MS);
        renderExpansionsList(normalized);
      }
    } catch {
      // Keep the placeholder if the API fails.
    }
  }

  function enableAutoScroll() {
    if (!expansionsViewport || !expansionsTrack) return;

    // Prevent ending up in a blank area (especially on touch momentum scroll).
    function clampScrollLeft() {
      const max = Math.max(0, expansionsViewport.scrollWidth - expansionsViewport.clientWidth);
      const next = Math.max(0, Math.min(expansionsViewport.scrollLeft, max));
      if (expansionsViewport.scrollLeft !== next) expansionsViewport.scrollLeft = next;
    }

    let clampRaf = 0;
    expansionsViewport.addEventListener('scroll', () => {
      if (clampRaf) return;
      clampRaf = window.requestAnimationFrame(() => {
        clampRaf = 0;
        clampScrollLeft();
      });
    }, { passive: true });

    // Make mouse wheel feel natural: when hovering the marquee, wheel scrolls horizontally.
    // (Trackpads already send deltaX; this mainly helps mouse users.)
    const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (!coarsePointer) {
      expansionsViewport.addEventListener('wheel', (e) => {
        if (!e) return;
        const dx = Math.abs(Number(e.deltaX || 0));
        const dy = Math.abs(Number(e.deltaY || 0));
        if (dy > dx && dy > 0) {
          e.preventDefault();
          expansionsViewport.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }

    if (!shouldEnableExpansionsAutoScroll()) return;

    let paused = false;
    let lastTs = 0;
    const speedPxPerSecond = 22;

    function getLoopWidth() {
      // After duplication, half the scrollWidth is the original content width.
      const w = expansionsTrack.scrollWidth;
      return w > 0 ? w / 2 : 0;
    }

    function onEnter() { paused = true; }
    function onLeave() { paused = false; }

    expansionsViewport.addEventListener('mouseenter', onEnter);
    expansionsViewport.addEventListener('mouseleave', onLeave);
    expansionsViewport.addEventListener('focusin', onEnter);
    expansionsViewport.addEventListener('focusout', onLeave);

    function tick(ts) {
      if (!lastTs) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;

      const loopWidth = getLoopWidth();
      if (loopWidth > 0 && !paused) {
        expansionsViewport.scrollLeft += speedPxPerSecond * dt;
        while (expansionsViewport.scrollLeft >= loopWidth) {
          expansionsViewport.scrollLeft -= loopWidth;
        }
      }

      window.requestAnimationFrame(tick);
    }

    window.requestAnimationFrame(tick);
  }

  loadLatestEnglishExpansions();
  enableAutoScroll();
})();
