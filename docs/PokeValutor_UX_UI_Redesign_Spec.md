# PokéValutor — Homepage UI/UX Redesign Specification

**Target Page:** Mobile / Responsive Homepage Layout  
**Doc Version:** v1.4  
**Scope:** Design System Alignment, Typography & Information Architecture  
**Date:** July 2026  

---

## 0. Implementation Status

**Status:** Initial homepage redesign complete; security hardening and accessibility verification remain.

### Final Background Direction

The initial implementation used charcoal (`#0F0F12`) for the homepage canvas. Visual review found that it appeared too faded, so the final direction restores the original true-black background while retaining the redesigned elevated surfaces:

* The homepage base remains true black (`#000000`).
* Elevated cards and the footer use zinc-black surfaces (`#18181B`).
* Borders use `#27272A` instead of glow-heavy separation.

This preserves the stronger original black appearance while keeping clear separation between the canvas and card surfaces. The redesign tokens remain scoped to the homepage so established subpages are not changed unintentionally.

### Implemented in July 2026

* Added homepage-scoped true-black, zinc, yellow, border, text, and heading tokens.
* Replaced the serif display font with **Plus Jakarta Sans** for homepage headings.
* Removed the outer card surface from the homepage hero.
* Updated the primary **Search Cards** and outlined **Search Sealed** CTA treatments.
* Replaced the collector/vendor bullet cards with the two-column **Unified Portfolio** and **Market Intelligence** micro-feature grid.
* Replaced the two feature buttons with one **Explore All Features →** link.
* Added left/right alignment and row dividers to Latest Sets card-price rows.
* Retained the secondary horizontal set carousel.
* Reworked Trending Cards into a thumbnail, title/set, and stacked price/status layout.
* Replaced Trending Cards HTML-string rendering with DOM node creation and validated image URL protocols.
* Kept the footer compact and hide the fixed back-to-top control whenever the footer is visible.
* Added homepage layout and XSS-focused static regression tests.
* Verified populated mobile (`390px`) and desktop (`1280px`) layouts in a real browser.

---

## 1. Executive Summary & Core Objectives

The objective of this specification is to optimize the **PokéValutor** homepage layout, improve alignment and contrast, clean up nested container visual clutter, and establish a modern typography and component hierarchy.

### Key Audit Findings & Clarifications
* **Typography Hierarchy:** Serif headlines conflict with the modern, data-focused nature of a TCG analytics platform.
* **Container Nesting:** Excessive card-in-card wrapping shrinks usable screen width on mobile viewports.
* **Latest Sets Clarification:** The top section displays the **top 3 value cards for the latest 3 sets**, while the subsequent section provides access to **several other sets**. Both sections serve distinct functional roles and are retained.
* **Floating UI Elements:** The Back-to-Top button remains anchored to the bottom-right corner and automatically hides when the footer enters the viewport, preventing overlap without adding excess footer height.

---

## 2. Design System Tokens & Styles

| Category | Current State | Proposed Spec Token |
| :--- | :--- | :--- |
| **Background Base** | `#000000` Pure Black | `#000000` True Black (Retained after visual review) |
| **Card Surface** | `#121212` Dark Neutral | `#18181B` Zinc-900 (Subtle elevated surface) |
| **Primary Accent** | `#FFD000` Gold/Yellow | `#FFCC00` Poké Yellow (Primary Action & Branding) |
| **Subtle Borders** | Variable / Glow | `1px solid #27272A` Zinc-800 border stroke |
| **Headings Font** | Serif Style | **Plus Jakarta Sans / Inter** Bold Sans-Serif (700/800) |
| **Body / Secondary** | Low-contrast Grey (`#888888`) | `#D1D5DB` Gray-300 (High-contrast accessibility) |

---

## 3. Component-by-Component Refactoring Specs

### 3.1 Hero Section

| Aspect | Specification |
| :--- | :--- |
| **Container Padding** | Remove the outer card wrapping. Hero content sits directly on the base canvas with standard outer inline padding (`16px`). |
| **Primary CTA** | Filled Yellow (`#FFCC00`, `#000000` text) for **"Search Cards"**. |
| **Secondary CTA** | Outlined style (`1px solid #3F3F46`) for **"Search Sealed"**. |
| **Typography** | Modern bold display sans-serif heading. Increase body contrast to `#D1D5DB`. |

---

### 3.2 Feature Section ("Built for Quick Checks")

| Aspect | Specification |
| :--- | :--- |
| **Layout Shift** | Replace bulleted lists ("For Collectors" / "For Vendors") with a clean 2-column micro-feature grid. |
| **Collectors Block** | **Unified Portfolio** *(Icon: Box/Folder)* — Track single cards and sealed product values in one place. |
| **Vendors Block** | **Market Intelligence** *(Icon: Trending Up)* — Compare variants and spot top-performing cards faster. |
| **Action Link** | Replace separate card buttons with a single unified section link: *"Explore All Features →"*. |

---

### 3.3 "Latest Sets" & Card Listings Architecture

* **Top Section (Latest 3 Sets + Top Value Cards):**
  * Displays the top 3 high-value cards for the 3 newest sets.
  * Align card titles to the left and prices to the right using `display: flex; justify-content: space-between;`.
  * Add subtle row dividers (`border-bottom: 1px solid #27272A`) between price items for scannability.
* **Secondary Carousel Section (Additional Sets):**
  * Retain horizontal carousel for browsing additional/older sets.
  * Ensure card image tiles maintain consistent aspect ratios and clear set label text.

---

### 3.4 "Trending Cards" & Layout Padding Fixes

* **Trending Cards Row Grid:** Group thumbnail on the left, card title & set in the center-left, and price + status badge (`Flat` / `% Change`) stacked cleanly on the right.
* **Footer Spacing (Back-to-Top Clearance):** Keep the footer at its standard compact padding and hide the bottom-right control while the footer is visible.

```css
/* Hide the fixed control while the footer is visible. */
.pv-scroll-top.is-over-footer {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

/* Card Price Row Alignment Standard */
.set-card-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #27272A;
}
```

---

## 4. Implementation Checklist

- [x] Replace H1/H2 serif typography with sans-serif display font (`Plus Jakarta Sans`).
- [x] Remove outer card wrapping from the Hero section to restore mobile screen margin.
- [x] Refactor "For Collectors" and "For Vendors" bullet lists into a 2-column feature grid.
- [x] Implement Flexbox `justify-content: space-between` on top 3 value card price rows in Latest Sets.
- [x] Maintain the horizontal set carousel for secondary set exploration.
- [x] Keep the footer compact and hide the back-to-top button while the footer is visible.
- [ ] Verify WCAG AA contrast compliance with measured automated and manual checks against the final `#000000` background.

---

## 5. Remaining Work Ranked by Severity and Priority

| Rank | Severity | Priority | Area | Required Work | Reason |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **High** | **P0** | Latest Sets security | Replace API-derived `innerHTML` rendering in the Latest Sets spotlight and fallback states with `createElement`, `textContent`, `replaceChildren`, and explicitly validated attributes/URLs. | External data is still passed through an unsafe HTML parsing sink. Manual escaping is not an acceptable substitute under repository security rules. |
| **2** | **High** | **P0** | Runtime XSS coverage | Add DOM-based tests using malicious card names, set names, image URLs, and links for both Latest Sets and Trending Cards. | Current homepage XSS coverage is static and does not prove hostile values remain inert at runtime. |
| **3** | **Medium** | **P1** | Accessibility verification | Run measured WCAG AA contrast checks and manually verify keyboard focus order, carousel operation, screen-reader labels, and reduced-motion behavior. | The new colors appear accessible, but the checklist cannot be considered complete until contrast and interaction behavior are measured. |
| **4** | **Medium** | **P2** | CSP delivery | Move `frame-ancestors` from the HTML meta CSP to the production HTTP response headers. | Browsers ignore `frame-ancestors` when it is delivered through a meta element, producing a console warning and leaving framing policy unenforced by that directive. |
| **5** | **Low** | **P2** | Cross-page consistency | Decide whether the true-black/zinc tokens and sans-serif hierarchy should be rolled out to secondary pages after regression testing. | Tokens are intentionally homepage-scoped to minimize initial regression risk, so other pages retain the previous visual system. |
| **6** | **Low** | **P3** | Visual polish | Review long card names, uncommon price lengths, unavailable-price states, and very narrow devices (`320px–375px`). | Current mobile and desktop samples look correct, but edge-case content may require small truncation or wrapping adjustments. |

### Recommended Execution Order

1. Complete the Latest Sets DOM-safe renderer and runtime XSS tests together.
2. Run accessibility verification.
3. Correct CSP delivery at the hosting layer.
4. Decide whether to extend the visual tokens to other pages.
5. Finish edge-case visual polish after representative content testing.
