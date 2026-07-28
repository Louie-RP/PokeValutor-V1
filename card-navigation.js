(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root?.document) api.initializeCardBackLink(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function getBackLabel() {
        return 'Back to previous page';
    }

    function getSafePreviousPage(referrer, currentHref) {
        try {
            const currentUrl = new URL(currentHref);
            const previousUrl = new URL(referrer);
            const isWebPage = currentUrl.protocol === 'https:' || currentUrl.protocol === 'http:';
            if (!isWebPage || previousUrl.origin !== currentUrl.origin) return null;
            if (previousUrl.href === currentUrl.href) return null;
            return {
                href: previousUrl.href,
                label: getBackLabel(),
            };
        } catch {
            return null;
        }
    }

    function initializeCardBackLink(windowObject) {
        windowObject.document.addEventListener('DOMContentLoaded', function () {
            const backLink = windowObject.document.getElementById('pv-card-back-link');
            if (!backLink) return;

            const previousPage = getSafePreviousPage(
                windowObject.document.referrer,
                windowObject.location.href
            );
            if (!previousPage) return;

            backLink.href = previousPage.href;
            backLink.textContent = previousPage.label;
            backLink.addEventListener('click', function (event) {
                if (windowObject.history.length <= 1) return;
                event.preventDefault();
                windowObject.history.back();
            });
        });
    }

    return {
        getBackLabel,
        getSafePreviousPage,
        initializeCardBackLink,
    };
}));
