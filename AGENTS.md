# Repository security guardrails

- Do not render strings with `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write`, especially when any value can originate from users, APIs, authentication claims, URLs, or storage.
- Build DOM and SVG nodes with `createElement` / `createElementNS`, place display values with `textContent`, and set validated attributes explicitly.
- Do not treat manual HTML escaping as a substitute for avoiding unsafe HTML sinks. If HTML parsing is truly required, document the reason and use a reviewed sanitizer with a restrictive allowlist.
- Include an XSS-focused test or static check when changing code that renders external data.
- Treat all Firebase/Firestore documents, API responses, URLs, authentication claims, and local/session storage values as untrusted at every downstream render site, even when an earlier sync or normalization layer processed them.
- Security tests must inspect the downstream renderer reached by external data, not only the handler that stores or forwards it.
- Do not execute source text dynamically in tests or production (`eval`, `Function`, `vm.runInContext`, or equivalents). Test exported behavior or use static structural assertions when legacy scripts are not importable.
