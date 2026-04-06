/* ═══════════════════════════════════════════════════════
   KHRYPTO — Rules Page JS
   TOC active-section tracking + smooth scroll + back button
   ═══════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

    // ── Back button ──
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            window.location.href = '../homePage/index.html';
        });
    }

    // ── Smooth scroll for TOC links ──
    const tocLinks = document.querySelectorAll('.toc-link');
    tocLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').slice(1);
            const target = document.getElementById(targetId);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // ── Intersection Observer — highlight active TOC link + fade sections in ──
    const sections = document.querySelectorAll('.rules-section');
    const observerOptions = {
        root: null,
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0
    };

    const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Update TOC
                tocLinks.forEach(link => link.classList.remove('active'));
                const activeLink = document.querySelector(`.toc-link[data-section="${entry.target.id}"]`);
                if (activeLink) {
                    activeLink.classList.add('active');
                }
            }
        });
    }, observerOptions);

    sections.forEach(section => {
        sectionObserver.observe(section);
    });

    // ── Fade-in sections on scroll ──
    const fadeObserverOptions = {
        root: null,
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.05
    };

    const fadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                fadeObserver.unobserve(entry.target); // Only animate once
            }
        });
    }, fadeObserverOptions);

    sections.forEach(section => {
        fadeObserver.observe(section);
    });
});
