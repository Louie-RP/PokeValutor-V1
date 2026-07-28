(function (root, factory) {
    const api = factory(root?.document);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PV_DOM = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (documentObject) {
    'use strict';

    function requireDocument() {
        if (!documentObject) throw new Error('PV_DOM requires a document.');
        return documentObject;
    }

    function setAttributes(element, attributes) {
        Object.entries(attributes || {}).forEach(([name, value]) => {
            if (value !== undefined && value !== null) {
                element.setAttribute(name, String(value));
            }
        });
        return element;
    }

    function createElement(tagName, { className, text, attributes } = {}) {
        const element = requireDocument().createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return setAttributes(element, attributes);
    }

    function createSvgElement(tagName, attributes = {}) {
        const element = requireDocument().createElementNS(
            'http://www.w3.org/2000/svg',
            tagName
        );
        return setAttributes(element, attributes);
    }

    return {
        createElement,
        createSvgElement,
        setAttributes,
    };
}));
