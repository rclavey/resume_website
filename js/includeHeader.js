function includeHeader() {
    fetch('header.html?v=20260817-ada2')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Header request failed: ${response.status}`);
            }
            return response.text();
        })
        .then(data => {
            document.querySelector('header').innerHTML = data;
            initializeNavigation();
            initializeAccessibility();
        })
        .catch(error => console.error(error));
}

function initializeNavigation() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const nav = document.querySelector('.site-nav');
    const menu = document.querySelector('.nav-menu');
    const toggle = document.querySelector('.nav-toggle');

    document.querySelectorAll('.nav-menu a[href]').forEach(link => {
        const linkPage = link.getAttribute('href').split('/').pop();
        if (linkPage === currentPage) {
            link.classList.add('active');
            link.setAttribute('aria-current', 'page');
        }
    });

    if (!nav || !menu || !toggle) {
        return;
    }

    toggle.addEventListener('click', () => {
        const isOpen = menu.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', `${isOpen ? 'Close' : 'Open'} main navigation`);
    });

    document.addEventListener('click', event => {
        if (!nav.contains(event.target)) {
            closeNavigation();
        }
    });

    nav.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || toggle.offsetParent === null) {
            return;
        }
        closeNavigation();
        toggle.focus();
    });

    menu.addEventListener('click', event => {
        if (event.target.closest('a')) {
            closeNavigation();
        }
    });

    function closeNavigation() {
        menu.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open main navigation');
    }
}

function initializeAccessibility() {
    const main = document.querySelector('main');
    if (main) {
        main.id ||= 'main-content';
        main.tabIndex = -1;
    }

    const skipLink = document.querySelector('.skip-link');
    if (skipLink && !skipLink.dataset.accessibilityReady) {
        skipLink.dataset.accessibilityReady = 'true';
        skipLink.addEventListener('click', event => {
            if (!main) {
                return;
            }
            event.preventDefault();
            main.focus();
            history.replaceState(null, '', '#main-content');
        });
    }

    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        const rel = new Set((link.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
        rel.add('noopener');
        rel.add('noreferrer');
        link.setAttribute('rel', [...rel].join(' '));

        if (!link.querySelector('.new-tab-note')) {
            const note = document.createElement('span');
            note.className = 'sr-only new-tab-note';
            note.textContent = ' (opens in a new tab)';
            link.append(note);
        }
    });

    document.querySelectorAll('canvas[aria-label]').forEach(canvas => {
        canvas.setAttribute('role', 'img');
        if (!canvas.textContent.trim()) {
            canvas.textContent = canvas.getAttribute('aria-label');
        }
    });

    document.querySelectorAll('table').forEach(table => {
        table.querySelectorAll('thead th:not([scope])').forEach(header => header.setAttribute('scope', 'col'));
        table.querySelectorAll('tbody th:not([scope])').forEach(header => header.setAttribute('scope', 'row'));

        if (table.querySelector('caption') || table.hasAttribute('aria-label') || table.hasAttribute('aria-labelledby')) {
            return;
        }
        const heading = table.closest('article, section, main')?.querySelector('h2, h3');
        table.setAttribute('aria-label', heading?.textContent.trim() || 'Data table');
    });

    document.querySelectorAll('[role="tablist"]').forEach(initializeTablist);
}

function initializeTablist(tablist, tablistIndex) {
    if (tablist.dataset.accessibilityReady) {
        return;
    }

    const tabs = [...tablist.querySelectorAll(':scope > [role="tab"]')];
    if (!tabs.length) {
        return;
    }

    tablist.dataset.accessibilityReady = 'true';

    tablist.id ||= `page-tabs-${tablistIndex + 1}`;

    const panelForTab = tab => {
        const controls = tab.getAttribute('aria-controls');
        if (controls) {
            return document.getElementById(controls);
        }

        const mappings = [
            ['dashboardView', 'dashboardPanel'],
            ['mmView', 'mmPanel'],
            ['hpView', 'hpPanel'],
            ['hockeyView', 'hockeyPanel']
        ];
        for (const [tabKey, panelKey] of mappings) {
            if (tab.dataset[tabKey]) {
                return document.querySelector(`[data-${panelKey.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}="${CSS.escape(tab.dataset[tabKey])}"]`);
            }
        }
        return null;
    };

    const syncTabs = () => {
        tabs.forEach((tab, index) => {
            const selected = tab.getAttribute('aria-selected') === 'true';
            tab.tabIndex = selected ? 0 : -1;
            tab.id ||= `${tablist.id}-tab-${index + 1}`;

            const panel = panelForTab(tab);
            if (panel) {
                panel.id ||= `${tablist.id}-panel-${index + 1}`;
                tab.setAttribute('aria-controls', panel.id);
                panel.setAttribute('aria-labelledby', tab.id);
            }
        });
    };

    tablist.addEventListener('keydown', event => {
        const currentIndex = tabs.indexOf(event.target.closest('[role="tab"]'));
        if (currentIndex < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            return;
        }

        event.preventDefault();
        let nextIndex;
        if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = tabs.length - 1;
        } else {
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
        }
        tabs[nextIndex].focus();
        tabs[nextIndex].click();
    });

    tablist.addEventListener('click', () => queueMicrotask(syncTabs));
    new MutationObserver(syncTabs).observe(tablist, {
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-selected']
    });
    syncTabs();
}

document.addEventListener('DOMContentLoaded', () => {
    initializeAccessibility();
    includeHeader();
});
