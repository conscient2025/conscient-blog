(() => {
    const header = document.getElementById('siteHeader');
    const menuToggle = document.getElementById('menuToggle');
    const mobileNav = document.getElementById('mobileNav');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const updateHeader = () => {
        header?.classList.toggle('is-scrolled', window.scrollY > 24);
    };

    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });

    if (menuToggle && mobileNav) {
        const closeMenu = () => {
            menuToggle.setAttribute('aria-expanded', 'false');
            mobileNav.setAttribute('aria-hidden', 'true');
            mobileNav.classList.remove('is-open');
        };

        menuToggle.addEventListener('click', () => {
            const willOpen = menuToggle.getAttribute('aria-expanded') !== 'true';
            menuToggle.setAttribute('aria-expanded', String(willOpen));
            mobileNav.setAttribute('aria-hidden', String(!willOpen));
            mobileNav.classList.toggle('is-open', willOpen);
        });

        mobileNav.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', closeMenu);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeMenu();
        });
    }

    const revealItems = document.querySelectorAll('.reveal');
    if (reducedMotion.matches || !('IntersectionObserver' in window)) {
        revealItems.forEach((item) => item.classList.add('is-visible'));
        return;
    }

    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });

    revealItems.forEach((item, index) => {
        item.style.transitionDelay = `${Math.min(index % 4, 3) * 80}ms`;
        revealObserver.observe(item);
    });
})();
