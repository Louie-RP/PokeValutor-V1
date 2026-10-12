# Binder PDF dependencies

Loaded only when a user generates a Binder PDF. No CDN execution or CSP relaxation is required.

- `pdf-lib-1.17.1.min.js`: pdf-lib 1.17.1, unchanged UMD distribution. MIT; see `pdf-lib-LICENSE.md`. Upstream: https://github.com/Hopding/pdf-lib
- `fontkit-1.1.1.min.js`: @pdf-lib/fontkit 1.1.1, unchanged UMD distribution from the published npm package. MIT; see `fontkit-LICENSE.md`. Upstream: https://github.com/Hopding/fontkit
- `../fonts/binder/DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`: DejaVu Sans fonts for readable accented card labels and symbols. See `../fonts/binder/LICENSE.txt` for the complete font notices. Fonts are subset into generated PDFs.

Do not edit minified vendor files. Review a dependency upgrade, replace the pinned distribution and notices, and run PDF/CSP/browser checks together.
