let activeBubble = null;
let draggedBubble = null;
let mouseX = 0;
let mouseY = 0;
const bubblesData = [];

document.addEventListener('DOMContentLoaded', () => {
    initPageTransitions();

    if (document.getElementById('bubblesContainer')) {
        initMouseTracker();
        initBubbles();
        initBubbleModal();
        animateBubbles();
    }
});

window.addEventListener('pageshow', hidePageLoader);

// About 页的跨页面离场动画。
function hidePageLoader() {
    document.getElementById('pageLoader')?.classList.remove('active');
}

function initPageTransitions() {
    const loader = document.getElementById('pageLoader');
    if (!loader) return;

    if (loader.classList.contains('active')) {
        window.setTimeout(hidePageLoader, 800);
    }

    document.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (!link || event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.target === '_blank' || link.hasAttribute('download') || link.classList.contains('no-loader')) return;

        const destination = new URL(link.href, window.location.href);
        const isSamePageAnchor = destination.pathname === window.location.pathname
            && destination.search === window.location.search
            && destination.hash;
        if (!['http:', 'https:', 'file:'].includes(destination.protocol) || isSamePageAnchor) return;

        event.preventDefault();
        loader.classList.add('active');
        window.setTimeout(() => {
            window.location.href = destination.href;
        }, 600);
    });
}

// About 页的漂浮标签。
function initMouseTracker() {
    window.addEventListener('mousemove', (event) => {
        mouseX = event.clientX;
        mouseY = event.clientY;
    }, { passive: true });

    window.addEventListener('mouseup', () => {
        draggedBubble = null;
    });
}

function initBubbles() {
    const container = document.getElementById('bubblesContainer');
    if (!container) return;

    const tags = ['bilibili', 'ACEE', 'X-Lab', 'Instagram', 'ZJU', '与人连接', '长期主义', '创造', '探索'];
    bubblesData.length = 0;
    container.replaceChildren();

    tags.forEach(createBubble);

    const removedTags = new Set(['3305', '电影', '技术产品', '终身学习']);
    const savedBubbles = readSavedBubbles().filter((text) => !removedTags.has(text));
    saveBubbles(savedBubbles);
    savedBubbles.forEach(createBubble);

    createInteractiveBubble();
    createInteractiveBubble();
}

function createBubble(text) {
    const container = document.getElementById('bubblesContainer');
    if (!container) return null;

    const bubble = document.createElement('div');
    const size = 80 + Math.random() * 40;
    const bubbleData = {
        el: bubble,
        x: size / 2 + Math.random() * Math.max(0, window.innerWidth - size),
        y: size / 2 + Math.random() * Math.max(0, window.innerHeight - size),
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        size
    };

    bubble.className = 'bubble';
    bubble.textContent = text;
    bubble.style.animation = 'none';
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.addEventListener('mousedown', (event) => {
        draggedBubble = bubbleData;
        event.stopPropagation();
    });

    container.appendChild(bubble);
    bubblesData.push(bubbleData);
    return bubbleData;
}

function createInteractiveBubble() {
    const bubbleData = createBubble('+');
    if (!bubbleData) return;

    bubbleData.el.classList.add('interactive');
    bubbleData.el.addEventListener('click', () => openBubbleModal(bubbleData.el));
}

function animateBubbles() {
    if (!document.getElementById('bubblesContainer')) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    bubblesData.forEach((bubble, index) => {
        if (bubble === draggedBubble) {
            bubble.x += (mouseX - bubble.x) * 0.2;
            bubble.y += (mouseY - bubble.y) * 0.2;
            bubble.vx = (mouseX - bubble.x) * 0.1;
            bubble.vy = (mouseY - bubble.y) * 0.1;
        } else {
            bubble.x += bubble.vx;
            bubble.y += bubble.vy;
            bounceAtViewportEdge(bubble, width, height);

            for (let otherIndex = index + 1; otherIndex < bubblesData.length; otherIndex += 1) {
                resolveBubbleCollision(bubble, bubblesData[otherIndex]);
            }

            if (Math.hypot(bubble.vx, bubble.vy) > 2) {
                bubble.vx *= 0.99;
                bubble.vy *= 0.99;
            }
        }

        bubble.el.style.left = `${bubble.x - bubble.size / 2}px`;
        bubble.el.style.top = `${bubble.y - bubble.size / 2}px`;
    });

    window.requestAnimationFrame(animateBubbles);
}

function bounceAtViewportEdge(bubble, width, height) {
    const radius = bubble.size / 2;

    if (bubble.x < radius) {
        bubble.x = radius;
        bubble.vx *= -0.8;
    } else if (bubble.x > width - radius) {
        bubble.x = width - radius;
        bubble.vx *= -0.8;
    }

    if (bubble.y < radius) {
        bubble.y = radius;
        bubble.vy *= -0.8;
    } else if (bubble.y > height - radius) {
        bubble.y = height - radius;
        bubble.vy *= -0.8;
    }
}

function resolveBubbleCollision(first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy);
    const minimumDistance = (first.size + second.size) / 2;
    if (distance === 0 || distance >= minimumDistance) return;

    const normalX = dx / distance;
    const normalY = dy / distance;
    const relativeVelocity = (second.vx - first.vx) * normalX + (second.vy - first.vy) * normalY;

    if (relativeVelocity < 0) {
        const impulse = (2 * relativeVelocity) / (first.size + second.size);
        first.vx += impulse * second.size * normalX;
        first.vy += impulse * second.size * normalY;
        second.vx -= impulse * first.size * normalX;
        second.vy -= impulse * first.size * normalY;
    }

    const overlap = (minimumDistance - distance) / 2;
    first.x -= normalX * overlap;
    first.y -= normalY * overlap;
    second.x += normalX * overlap;
    second.y += normalY * overlap;
}

function initBubbleModal() {
    const modal = document.getElementById('bubbleModal');
    const input = document.getElementById('bubbleInput');
    if (!modal || !input) return;

    const closeModal = () => {
        modal.classList.remove('active');
        activeBubble = null;
        input.value = '';
    };

    document.getElementById('bubbleModalClose')?.addEventListener('click', closeModal);
    document.getElementById('bubbleCancel')?.addEventListener('click', closeModal);
    document.getElementById('bubbleSave')?.addEventListener('click', () => {
        if (!activeBubble) return;

        const text = input.value.trim();
        activeBubble.textContent = text || '留言';
        activeBubble.classList.remove('interactive');

        if (text) {
            const savedBubbles = readSavedBubbles();
            savedBubbles.push(text);
            saveBubbles(savedBubbles);
        }

        closeModal();
    });

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });
}

function openBubbleModal(bubble) {
    const modal = document.getElementById('bubbleModal');
    const input = document.getElementById('bubbleInput');
    if (!modal || !input) return;

    activeBubble = bubble;
    input.value = bubble.textContent === '+' ? '' : bubble.textContent;
    modal.classList.add('active');
    input.focus();
}

function readSavedBubbles() {
    try {
        const saved = JSON.parse(localStorage.getItem('userBubbles') || '[]');
        return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function saveBubbles(bubbles) {
    try {
        localStorage.setItem('userBubbles', JSON.stringify(bubbles));
    } catch {
        // 页面仍可使用，只是不保留用户新增的气泡。
    }
}
