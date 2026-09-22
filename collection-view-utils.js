(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PV_COLLECTION_VIEW = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TYPE_FILTER_VALUES = ['all', 'card', 'sealed'];
    const DEFAULT_MOBILE_PAGE_SIZE = 36;
    const DEFAULT_DESKTOP_PAGE_SIZE = 60;
    const DEFAULT_BREAKPOINT_QUERY = '(max-width: 767.98px)';

    function normalizeTypeFilter(rawValue) {
        const value = String(rawValue || '').trim().toLowerCase();
        return TYPE_FILTER_VALUES.includes(value) ? value : 'all';
    }

    function formatUsd(amount) {
        const value = Number(amount);
        if (!Number.isFinite(value)) return '$0.00';
        return `$${value.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`;
    }

    function getResponsivePageSize(windowObject, options) {
        const mobilePageSize = Math.max(1, Math.floor(Number(options?.mobilePageSize) || DEFAULT_MOBILE_PAGE_SIZE));
        const desktopPageSize = Math.max(1, Math.floor(Number(options?.desktopPageSize) || DEFAULT_DESKTOP_PAGE_SIZE));
        const breakpointQuery = String(options?.breakpointQuery || DEFAULT_BREAKPOINT_QUERY);

        try {
            if (windowObject?.matchMedia && windowObject.matchMedia(breakpointQuery).matches) {
                return mobilePageSize;
            }
        } catch {
            // Use the desktop size when media-query evaluation is unavailable.
        }

        return desktopPageSize;
    }

    function getPagination(totalItemsRaw, pageSizeRaw, currentPageRaw) {
        const totalItems = Math.max(0, Math.floor(Number(totalItemsRaw) || 0));
        const pageSize = Math.max(1, Math.floor(Number(pageSizeRaw) || DEFAULT_DESKTOP_PAGE_SIZE));
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const currentPage = Math.min(Math.max(1, Math.floor(Number(currentPageRaw) || 1)), totalPages);
        const startIndex = (currentPage - 1) * pageSize;

        return {
            totalItems,
            pageSize,
            totalPages,
            currentPage,
            startIndex,
            endIndex: Math.min(totalItems, startIndex + pageSize),
        };
    }

    function setCoverageTooltip(trigger, coverageTextRaw) {
        if (!trigger) return;

        const coverageText = String(coverageTextRaw || '').trim().replace(/^\(|\)$/g, '');
        const message = coverageText
            ? `Pricing coverage: ${coverageText}.`
            : 'All collection units are priced.';
        trigger.dataset.collectionValueHint = message;
        trigger.setAttribute('aria-label', message);
    }

    function bindValueSummaryInteractions(options) {
        const valueTrigger = options?.valueTrigger;
        const infoTrigger = options?.infoTrigger;
        const dialog = options?.dialog;
        const closeTrigger = options?.closeTrigger;

        if (infoTrigger && infoTrigger.getAttribute('data-summary-bound') !== '1') {
            infoTrigger.setAttribute('data-summary-bound', '1');
            infoTrigger.addEventListener('click', (event) => {
                event.stopPropagation();
                infoTrigger.classList.toggle('is-open');
            });

            const documentObject = infoTrigger.ownerDocument;
            documentObject?.addEventListener('click', () => {
                infoTrigger.classList.remove('is-open');
            });
        }

        if (!valueTrigger || !dialog || valueTrigger.getAttribute('data-summary-bound') === '1') return;

        valueTrigger.setAttribute('data-summary-bound', '1');
        valueTrigger.addEventListener('click', () => {
            if (typeof options?.isDisabled === 'function' && options.isDisabled()) return;
            if (typeof options?.beforeOpen === 'function') options.beforeOpen();

            if (typeof dialog.showModal === 'function') {
                dialog.showModal();
                return;
            }

            if (typeof options?.getFallbackText === 'function') {
                const fallbackText = String(options.getFallbackText() || '').trim();
                const view = dialog.ownerDocument?.defaultView;
                if (fallbackText && view?.alert) view.alert(fallbackText);
            }
        });

        if (closeTrigger) {
            closeTrigger.addEventListener('click', () => {
                if (typeof dialog.close === 'function') dialog.close();
            });
        }

        dialog.addEventListener('click', (event) => {
            if (event.target === dialog && typeof dialog.close === 'function') dialog.close();
        });
    }

    function renderPagination(container, options) {
        if (!container || typeof container.replaceChildren !== 'function') return;

        const pagination = getPagination(options?.totalItems, options?.pageSize, options?.currentPage);
        if (pagination.totalItems <= pagination.pageSize) {
            container.hidden = true;
            container.replaceChildren();
            return;
        }

        const documentObject = container.ownerDocument;
        if (!documentObject) return;

        const inner = documentObject.createElement('div');
        inner.className = 'pv-collectionPagination__inner';

        const status = documentObject.createElement('p');
        status.className = 'pv-collectionPagination__status';
        status.textContent = `Showing ${pagination.startIndex + 1}-${pagination.endIndex} of ${pagination.totalItems}`;

        const controls = documentObject.createElement('div');
        controls.className = 'pv-collectionPagination__controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', 'Collection pages');

        const pageLabel = documentObject.createElement('span');
        pageLabel.className = 'pv-collectionPagination__pageLabel';
        pageLabel.textContent = `Page ${pagination.currentPage} of ${pagination.totalPages}`;

        function createPageButton(label, targetPage, disabled) {
            const button = documentObject.createElement('button');
            button.className = 'pv-button pv-button--secondary btn pv-collectionPagination__btn';
            button.type = 'button';
            button.textContent = label;
            button.disabled = disabled;
            button.addEventListener('click', () => {
                if (typeof options?.onPageChange === 'function') options.onPageChange(targetPage);
            });
            return button;
        }

        const atFirstPage = pagination.currentPage <= 1;
        const atLastPage = pagination.currentPage >= pagination.totalPages;
        controls.append(
            createPageButton('First', 1, atFirstPage),
            createPageButton('Previous', pagination.currentPage - 1, atFirstPage),
            pageLabel,
            createPageButton('Next', pagination.currentPage + 1, atLastPage),
            createPageButton('Last', pagination.totalPages, atLastPage)
        );
        inner.append(status, controls);
        container.hidden = false;
        container.replaceChildren(inner);
    }

    return {
        formatUsd,
        getPagination,
        getResponsivePageSize,
        bindValueSummaryInteractions,
        normalizeTypeFilter,
        renderPagination,
        setCoverageTooltip,
    };
}));