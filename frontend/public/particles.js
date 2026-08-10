(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const palette = ['#d9f8ff', '#61d9ec', '#8b91ff', '#ffffff'];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.className = 'site-particle-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let animationFrame = 0;
    let lastTime = 0;
    const particles = [];
    const rings = [];
    const boundFrameDocuments = new WeakSet();

    const resizeCanvas = () => {
        pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const createBurst = (x, y) => {
        const count = 8;

        for (let index = 0; index < count; index += 1) {
            const angle = (Math.PI * 2 * index) / count + (Math.random() - 0.5) * 0.55;
            const speed = 42 + Math.random() * 82;
            const life = 430 + Math.random() * 250;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life,
                maxLife: life,
                size: 0.9 + Math.random() * 2,
                length: 4 + Math.random() * 10,
                color: palette[Math.floor(Math.random() * palette.length)],
                streak: index % 3 !== 0
            });
        }

        rings.push({
            x,
            y,
            radius: 5,
            life: 420,
            maxLife: 420,
            color: palette[0]
        });

        if (!animationFrame) {
            lastTime = performance.now();
            animationFrame = window.requestAnimationFrame(drawParticles);
        }
    };

    function drawParticles(time) {
        const delta = Math.min((time - lastTime) / 1000, 0.032);
        lastTime = time;
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = 'lighter';

        for (let index = particles.length - 1; index >= 0; index -= 1) {
            const particle = particles[index];
            particle.life -= delta * 1000;
            if (particle.life <= 0) {
                particles.splice(index, 1);
                continue;
            }

            particle.vx *= Math.pow(0.03, delta);
            particle.vy = particle.vy * Math.pow(0.06, delta) + 9 * delta;
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;

            const alpha = Math.pow(particle.life / particle.maxLife, 1.7);
            context.globalAlpha = alpha;
            context.strokeStyle = particle.color;
            context.fillStyle = particle.color;
            context.lineWidth = Math.max(0.6, particle.size * alpha);
            context.shadowBlur = 9 * alpha;
            context.shadowColor = particle.color;

            if (particle.streak) {
                const magnitude = Math.hypot(particle.vx, particle.vy) || 1;
                context.beginPath();
                context.moveTo(
                    particle.x - (particle.vx / magnitude) * particle.length,
                    particle.y - (particle.vy / magnitude) * particle.length
                );
                context.lineTo(particle.x, particle.y);
                context.stroke();
            } else {
                context.beginPath();
                context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                context.fill();
            }
        }

        for (let index = rings.length - 1; index >= 0; index -= 1) {
            const ring = rings[index];
            ring.life -= delta * 1000;
            if (ring.life <= 0) {
                rings.splice(index, 1);
                continue;
            }

            const progress = 1 - ring.life / ring.maxLife;
            ring.radius = 5 + progress * 34;
            context.globalAlpha = (1 - progress) * 0.32;
            context.strokeStyle = ring.color;
            context.lineWidth = 1;
            context.shadowBlur = 6;
            context.shadowColor = ring.color;
            context.beginPath();
            context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            context.stroke();
        }

        context.globalAlpha = 1;
        context.shadowBlur = 0;

        if (particles.length || rings.length) {
            animationFrame = window.requestAnimationFrame(drawParticles);
        } else {
            context.clearRect(0, 0, width, height);
            animationFrame = 0;
        }
    }

    const handlePointer = (event, offsetX = 0, offsetY = 0) => {
        if (event.button !== 0) return;
        if (event.pointerType === 'touch' && event.isPrimary === false) return;
        createBurst(event.clientX + offsetX, event.clientY + offsetY);
    };

    const bindFrame = (frame) => {
        try {
            const frameDocument = frame.contentDocument;
            if (!frameDocument || boundFrameDocuments.has(frameDocument)) return;

            boundFrameDocuments.add(frameDocument);
            frameDocument.addEventListener('pointerdown', (event) => {
                const bounds = frame.getBoundingClientRect();
                handlePointer(event, bounds.left, bounds.top);
            });
        } catch {
            // 跨域 iframe 无法读取时，仅保留页面本身的粒子反馈。
        }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { passive: true });
    document.addEventListener('pointerdown', (event) => handlePointer(event));
    document.querySelectorAll('iframe').forEach((frame) => {
        frame.addEventListener('load', () => bindFrame(frame));
        bindFrame(frame);
    });
})();
