# PokeValutor-V1

Overview
- Project website scaffold for GitHub Pages with accessible HTML, CSS, and JS.

Files
- [index.html](index.html): Semantic layout with header, main, footer, unique ids/classes, skip link, ARIA.
- [styles.css](styles.css): Responsive design, strong contrast, focus styles, reduced-motion support.
- [script.js](script.js): Nav toggle with ARIA sync, footer year, basic form handling.

Local Preview
1. Open index.html in a browser, or use a simple server:

```bash
# Python 3
python -m http.server 8080
# Then visit http://localhost:8080
```

Deploy to GitHub Pages
1. Commit and push to main.
2. In GitHub, Settings → Pages → Source: Deploy from a branch.
3. Select branch main, folder /root.
4. Save and open the provided Pages URL.

Accessibility Notes
- Keyboard navigation supported; visible focus states.
- Skip link to jump to main content.
- Landmarks: banner, main, contentinfo; labels and ARIA used thoughtfully.