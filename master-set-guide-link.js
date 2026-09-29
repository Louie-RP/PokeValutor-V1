(function () {
    const link = document.getElementById('pv-master-set-guide-link');
    if (!(link instanceof HTMLAnchorElement)) return;

    const params = new URLSearchParams(window.location.search);
    const expansionId = String(params.get('expansionId') || '').trim();
    const expansionName = String(params.get('expansionName') || '').trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(expansionId)) return;

    fetch('data/master-set-guides/index.json')
        .then((response) => {
            if (!response.ok) throw new Error('Guide index unavailable.');
            return response.json();
        })
        .then((index) => {
            const guides = Array.isArray(index?.guides) ? index.guides : [];
            const supported = guides.some((entry) => String(entry?.expansionId || '') === expansionId);
            if (!supported) return;

            const guideParams = new URLSearchParams();
            guideParams.set('expansionId', expansionId);
            if (expansionName) guideParams.set('expansionName', expansionName);
            link.href = `master-set-guide.html?${guideParams.toString()}`;
            link.hidden = false;
        })
        .catch(() => {
            link.hidden = true;
        });
})();
