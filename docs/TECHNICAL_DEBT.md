# Technical Debt

## Price History module maintainability

**Source:** Sourcery review on PR #22  
**Recorded:** July 28, 2026  
**Priority:** Medium — maintainability work, not a current security or functional blocker

### Deferred work

1. Evaluate a shared safe DOM-construction helper for `card.js` and
   `price-history.js`.
   - Preserve the repository rule against `innerHTML` and other unsafe HTML
     sinks.
   - Keep Price History independently removable and feature-flagged.
   - Standardize helper behavior before migrating call sites.

2. Split `price-history.js` into focused modules.
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
