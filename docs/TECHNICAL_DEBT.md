# Technical Debt

## Price History module maintainability

**Source:** Sourcery review on PR #22  
**Recorded:** July 28, 2026  
**Priority:** Medium — maintainability work, not a current security or functional blocker

### Progress

The first refactor phase began July 28, 2026:

- `card.js` and Price History now use the shared safe `pv-dom.js` utility.
- Scrydex normalization and metrics moved to `price-history-data.js`.
- Local browser-history rendering moved to `price-history-local.js`.
- Normalized provider rows are cached per payload instead of reparsed on every
  range change.

### Remaining work

1. Continue splitting `price-history.js` into focused modules.
   - Suggested boundaries: data normalization, API/auth access, state
     management, local browser history, SVG/chart rendering, and UI event
     wiring.
   - Preserve the existing premium gate and fail-closed behavior.
   - Ensure non-premium users never trigger the Scrydex history endpoint.
   - Avoid changing visible behavior as part of the structural refactor.

### Completion criteria

- Existing basic and Premium Price History behavior remains unchanged.
- XSS-focused static checks continue to pass.
- Role resolution, feature-disabled behavior, API error states, local-history
  rendering, range selection, and multi-variant comparison have automated
  coverage.
- The refactored modules have explicit responsibilities and no circular
  dependencies.

The unused `pathname` parameter in `card-navigation.js#getBackLabel` was handled
immediately and is not part of this deferred work.
