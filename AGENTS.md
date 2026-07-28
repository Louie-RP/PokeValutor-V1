# Repository security guardrails

- Do not render strings with `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write`, especially when any value can originate from users, APIs, authentication claims, URLs, or storage.
- Build DOM and SVG nodes with `createElement` / `createElementNS`, place display values with `textContent`, and set validated attributes explicitly.
- Do not treat manual HTML escaping as a substitute for avoiding unsafe HTML sinks. If HTML parsing is truly required, document the reason and use a reviewed sanitizer with a restrictive allowlist.
- Include an XSS-focused test or static check when changing code that renders external data.
