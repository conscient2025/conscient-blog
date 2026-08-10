(() => {
    document.querySelectorAll('[data-global-header]').forEach((header) => {
        const toggle = header.querySelector('[data-global-menu]');
        const links = header.querySelector('.global-links');
        if (!toggle || !links) return;

        const closeMenu = () => {
            header.classList.remove('is-nav-open');
            toggle.setAttribute('aria-expanded', 'false');
            links.setAttribute('aria-hidden', 'true');
        };

        const syncMenuState = () => {
            if (window.matchMedia('(min-width: 821px)').matches) {
                header.classList.remove('is-nav-open');
                toggle.setAttribute('aria-expanded', 'false');
                links.removeAttribute('aria-hidden');
            } else if (!header.classList.contains('is-nav-open')) {
                links.setAttribute('aria-hidden', 'true');
            }
        };

        toggle.addEventListener('click', () => {
            const willOpen = !header.classList.contains('is-nav-open');
            header.classList.toggle('is-nav-open', willOpen);
            toggle.setAttribute('aria-expanded', String(willOpen));
            links.setAttribute('aria-hidden', String(!willOpen));
        });

        links.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', closeMenu);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeMenu();
        });

        window.addEventListener('resize', syncMenuState, { passive: true });
        syncMenuState();
    });
})();
