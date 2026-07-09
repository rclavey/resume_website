function includeHeader() {
    fetch('header.html')
        .then(response => response.text())
        .then(data => {
            document.querySelector('header').innerHTML = data;
            initializeNavigation();
        });
}

function initializeNavigation() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const nav = document.querySelector('.site-nav');
    const menu = document.querySelector('.nav-menu');
    const toggle = document.querySelector('.nav-toggle');

    document.querySelectorAll('nav a[href]').forEach(link => {
        const linkPage = link.getAttribute('href').split('/').pop();
        if (linkPage === currentPage) {
            link.classList.add('active');
        }
    });

    if (!nav || !menu || !toggle) {
        return;
    }

    toggle.addEventListener('click', () => {
        const isOpen = menu.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('click', event => {
        if (!nav.contains(event.target)) {
            menu.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
        }
    });
}

document.addEventListener('DOMContentLoaded', includeHeader);
