        const root = document.documentElement;

        // Custom cursor
        const dot = document.getElementById('cursor-dot');
        const trail = document.getElementById('cursor-trail');
        let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
        let trailX = mouseX, trailY = mouseY;
        const hoverSel = '.nav-link, button, a, .color-swatch, input, select';

        if (window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            root.classList.add('has-custom-cursor');

            let trailRunning = false;
            const renderTrail = () => {
                trailX += (mouseX - trailX) * 0.15;
                trailY += (mouseY - trailY) * 0.15;
                trail.style.transform = `translate3d(${trailX}px, ${trailY}px, 0) translate(-50%, -50%)`;
                if (Math.abs(mouseX - trailX) > 0.3 || Math.abs(mouseY - trailY) > 0.3) requestAnimationFrame(renderTrail);
                else trailRunning = false;
            };
            document.addEventListener('mousemove', (e) => {
                mouseX = e.clientX; mouseY = e.clientY;
                dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0) translate(-50%, -50%)`;
                if (!trailRunning) { trailRunning = true; requestAnimationFrame(renderTrail); }
            }, { passive: true });

            document.addEventListener('mouseover', (e) => {
                document.body.classList.toggle('cursor-hovering', !!e.target.closest(hoverSel));
            });

            document.addEventListener('mouseleave', () => { dot.style.opacity = trail.style.opacity = 0; });
            document.addEventListener('mouseenter', () => { dot.style.opacity = trail.style.opacity = 1; });
        } else {
            dot.style.display = 'none';
            trail.style.display = 'none';
        }

        // Magnetic button
        document.querySelectorAll('.magnetic-wrap').forEach(wrap => {
            const btn = wrap.querySelector('.magnetic-btn');
            wrap.addEventListener('mousemove', (e) => {
                const r = wrap.getBoundingClientRect();
                btn.style.transition = 'none';
                btn.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.4}px, ${(e.clientY - r.top - r.height / 2) * 0.4}px)`;
            });
            wrap.addEventListener('mouseleave', () => {
                btn.style.transition = 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                btn.style.transform = 'translate(0px, 0px)';
            });
        });
        document.querySelectorAll('[data-scroll-to]').forEach(btn => {
            btn.addEventListener('click', () => document.querySelector(btn.dataset.scrollTo)?.scrollIntoView({ behavior: 'smooth' }));
        });

        // Scroll-driven effects

        const cockpit = document.getElementById('cockpit');
        const cockpitBg = document.getElementById('cockpit-bg');
        let ticking = false;

        function updateScrollEffects() {
            ticking = false;
            const vh = window.innerHeight;

            // Cockpit parallax
            const c = cockpit.getBoundingClientRect();
            if (c.top < vh && c.bottom > 0) {
                cockpitBg.style.transform = `translate3d(0, ${(c.top / vh) * 10}%, 0) scale(1.2)`;
            }
        }
        function requestUpdate() {
            if (!ticking) { ticking = true; requestAnimationFrame(updateScrollEffects); }
        }
        window.addEventListener('scroll', requestUpdate, { passive: true });
        window.addEventListener('resize', requestUpdate, { passive: true });
        window.addEventListener('load', requestUpdate);
        requestUpdate();

        // Active rear wing
        const aeroWing = document.getElementById('aero-wing');
        const aeroStruts = document.getElementById('aero-struts');
        const aeroBar = document.getElementById('aero-bar');
        const aeroLabel = document.getElementById('aero-label');
        const AERO_LABELS = {
            0: 'WING STOWED: FLUSH WITH THE ENGINE COVER',
            4: 'WING AT 4°: STABILITY AT HIGH SPEED',
            11: 'WING AT 11°: MORE DOWNFORCE AT MID-RANGE SPEEDS',
        };
        const setWing = (btn) => {
            const deg = Number(btn.dataset.deg), rise = Number(btn.dataset.rise) * 110;
            document.querySelectorAll('.aero-mode').forEach(b => {
                const on = b === btn;
                b.setAttribute('aria-pressed', String(on));
                b.classList.toggle('bg-[#e6b31e]', on); b.classList.toggle('text-black', on);
                b.classList.toggle('border-[#e6b31e]', on); b.classList.toggle('text-white', !on); b.classList.toggle('border-white/20', !on);
            });
            if (aeroWing) aeroWing.style.transform = `translateY(${-rise}px) rotate(${-deg}deg)`;
            if (aeroStruts) aeroStruts.style.opacity = rise ? '1' : '0';
            aeroBar.style.width = `${Math.round((deg / 11) * 100)}%`;
            aeroLabel.textContent = AERO_LABELS[deg];
        };
        document.querySelectorAll('.aero-mode').forEach(btn => btn.addEventListener('click', () => setWing(btn)));
        const aeroStart = document.querySelector('.aero-mode[aria-pressed="true"]');
        if (aeroStart) setWing(aeroStart);

        // Reveal on view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                const gauge = entry.target.querySelector('.radial-value');
                if (gauge) {
                    setTimeout(() => {
                        const percent = gauge.getAttribute('data-percentage');
                        gauge.style.strokeDashoffset = 283 - (283 * percent) / 100;
                    }, 500);
                }
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.1 });
        document.querySelectorAll('.reveal-up, .reveal-scale, .gauge-container').forEach(el => observer.observe(el));

        // Nav icon / full-screen menu
        const menuToggle = document.getElementById('menu-toggle');
        const siteMenu = document.getElementById('site-menu');

        function setMenu(open) {
            siteMenu.classList.toggle('is-open', open);
            siteMenu.setAttribute('aria-hidden', String(!open));
            menuToggle.setAttribute('aria-expanded', String(open));
            menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
            root.classList.toggle('menu-open', open);
            if (open) siteMenu.querySelector('a')?.focus({ preventScroll: true });
        }
        menuToggle.addEventListener('click', () => setMenu(!siteMenu.classList.contains('is-open')));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && siteMenu.classList.contains('is-open')) { setMenu(false); menuToggle.focus(); }
        });
        siteMenu.querySelectorAll('a[href^="#"]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.querySelector(link.getAttribute('href'));
                setMenu(false);
                requestAnimationFrame(() => target?.scrollIntoView({ behavior: 'smooth' }));
            });
        });

        // Booking dialog
        const booking = document.getElementById('booking');
        const bookingForm = document.getElementById('booking-form');
        const bookingDone = document.getElementById('booking-done');
        const bookingError = document.getElementById('booking-error');
        const bookingBuild = document.getElementById('booking-build');
        const bookingBuildInput = document.getElementById('booking-build-input');

        function loadBuild() {
            let saved = null;
            try { saved = JSON.parse(sessionStorage.getItem('aventador.build') || 'null'); } catch (e) { saved = null; }
            if (saved && Array.isArray(saved.lines)) {
                bookingBuild.textContent = saved.lines.join('\n');
                bookingBuildInput.value = saved.lines.join('; ');
                return true;
            }
            return false;
        }

        document.querySelectorAll('.open-booking').forEach(btn => {
            btn.addEventListener('click', () => {
                if (siteMenu.classList.contains('is-open')) setMenu(false);
                loadBuild();
                bookingForm.classList.remove('hidden');
                bookingDone.classList.add('hidden');
                bookingError.classList.add('hidden');
                booking.showModal();
            });
        });
        booking.querySelectorAll('.close-booking').forEach(b => b.addEventListener('click', () => booking.close()));
        booking.addEventListener('click', (e) => { if (e.target === booking) booking.close(); });

        bookingForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const missing = [...bookingForm.querySelectorAll('[required]')].find(f => !f.value.trim());
            const email = bookingForm.elements.email;
            if (missing) {
                bookingError.textContent = 'Fill in your name, email and country to request a test drive.';
                bookingError.classList.remove('hidden'); missing.focus(); return;
            }
            if (!email.checkValidity()) {
                bookingError.textContent = 'Enter a valid email address, like name@example.com.';
                bookingError.classList.remove('hidden'); email.focus(); return;
            }

            bookingForm.reset();
            bookingForm.classList.add('hidden');
            bookingDone.classList.remove('hidden');
        });

        // Navbar
        const siteNav = document.getElementById('site-nav');
        const navProgress = document.getElementById('nav-progress');
        function updateNav() {
            siteNav.classList.toggle('is-scrolled', window.scrollY > 24);
            const max = document.documentElement.scrollHeight - window.innerHeight;
            navProgress.style.transform = `scaleX(${max > 0 ? Math.min(window.scrollY / max, 1) : 0})`;
        }
        window.addEventListener('scroll', updateNav, { passive: true });
        window.addEventListener('resize', updateNav, { passive: true });
        updateNav();

        // Arriving from the configurator
        if (location.hash === '#reserve' && loadBuild()) {
            requestAnimationFrame(() => {
                bookingForm.classList.remove('hidden');
                bookingDone.classList.add('hidden');
                bookingError.classList.add('hidden');
                booking.showModal();
            });
        }

        // Landing sequence
        const seqFigure = document.getElementById('seq-figure');
        const seqCaption = document.getElementById('seq-caption');
        const seqSteps = document.querySelectorAll('.lp-step');
        if (seqFigure && seqSteps.length) {
            const setStep = (step) => {
                seqFigure.dataset.active = step.dataset.step;
                seqCaption.textContent = step.dataset.caption;
                seqSteps.forEach((s) => s.classList.toggle('is-active', s === step));
            };
            setStep(seqSteps[0]);
            const seqObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => { if (entry.isIntersecting) setStep(entry.target); });
            }, { rootMargin: '-45% 0px -45% 0px' });
            seqSteps.forEach((s) => seqObserver.observe(s));
        }

        // Performance
        const offscreen = new IntersectionObserver((entries) => {
            entries.forEach((entry) => entry.target.classList.toggle('is-offscreen', !entry.isIntersecting));
        }, { rootMargin: '100px 0px' });
        document.querySelectorAll('section, footer').forEach((el) => offscreen.observe(el));

        // Hero test-drive video

        {
            const video = document.querySelector('.lp-hero-video');
            const toggle = document.getElementById('hero-video-toggle');
            if (video && toggle && typeof video.play === 'function') {
                const label = toggle.querySelector('.lp-hero-pause-label');
                const connection = navigator.connection || {};
                const saveData = !!connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '');
                const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                let wantsPlay = !(saveData || reduceMotion);
                let onScreen = true;
                let loaded = false;
                let pageReady = false;

                const setButton = () => {
                    const paused = !wantsPlay;
                    toggle.setAttribute('aria-pressed', String(paused));
                    label.textContent = paused ? 'Play video' : 'Pause video';
                    toggle.setAttribute('aria-label', paused ? 'Play the background video' : 'Pause the background video');
                };
                const load = () => {
                    if (loaded) return;
                    loaded = true;

                    const width = Math.min(window.innerWidth, screen.width || window.innerWidth) * Math.min(window.devicePixelRatio || 1, 2);
                    const av1 = video.canPlayType('video/mp4; codecs="av01.0.05M.08"') === 'probably';
                    const h264 = video.canPlayType('video/mp4; codecs="avc1.64001f"') !== '';
                    const { src, srcAv1, srcSmall } = video.dataset;
                    const sources = [...new Set((width <= 1100 ? [h264 && srcSmall, av1 && srcAv1, srcSmall] : [av1 && srcAv1, h264 && src, src]).filter(Boolean))];
                    let i = 0;
                    video.addEventListener('error', () => {
                        if (++i < sources.length) { video.src = sources[i]; sync(); } else { toggle.hidden = true; }
                    });
                    video.addEventListener('playing', () => video.classList.add('is-ready'), { once: true });
                    video.src = sources[0];
                };
                const sync = () => {
                    if (!pageReady) return;
                    if (wantsPlay && onScreen && !document.hidden) {
                        load();
                        const p = video.play();
                        if (p && p.catch) p.catch((err) => { if (err.name === 'NotAllowedError') { wantsPlay = false; setButton(); } });
                    } else if (loaded) {
                        video.pause();
                    }
                };

                toggle.hidden = false;
                setButton();
                toggle.addEventListener('click', () => { wantsPlay = !wantsPlay; pageReady = true; setButton(); sync(); });
                new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; sync(); }).observe(video);
                document.addEventListener('visibilitychange', sync);
                const start = () => (window.requestIdleCallback || ((fn) => setTimeout(fn, 300)))(() => { pageReady = true; sync(); }, { timeout: 2500 });
                if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
            }
        }
