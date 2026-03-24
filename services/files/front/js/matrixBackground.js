/**
 * KHRYPTO — Matrix Crypto Background
 * Canvas-based animated rain of crypto symbols and percentage changes.
 * 
 * Usage: import and call initMatrixBackground('matrixCanvas') on DOMContentLoaded.
 *        For game page: initMatrixBackground('matrixCanvas', { blurred: true })
 */

const CRYPTO_SYMBOLS = ['₿', 'Ξ', '◎', 'Ð', '₮', 'Ł', '⟠', '◆', '$', '¢'];
const PERCENTAGES = ['+5.2%', '-1.4%', '+0.8%', '-3.1%', '+12.5%', '-0.3%', '+2.7%', '-6.8%', '+1.1%', '-2.4%', '+8.9%', '-4.5%'];

function initMatrixBackground(canvasId, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (options.blurred) {
        canvas.classList.add('matrix-blurred');
    }

    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const FONT_SIZE = 14;
    const columnCount = Math.floor(canvas.width / FONT_SIZE);

    // Each column tracks: y position, speed, character, type, color
    const columns = [];
    for (let i = 0; i < columnCount; i++) {
        columns.push(createColumn(i));
    }

    function createColumn(index) {
        const isPercentage = Math.random() < 0.25; // 25% chance of percentage text
        const isPositive = Math.random() < 0.5;
        let char;
        if (isPercentage) {
            char = PERCENTAGES[Math.floor(Math.random() * PERCENTAGES.length)];
        } else {
            char = CRYPTO_SYMBOLS[Math.floor(Math.random() * CRYPTO_SYMBOLS.length)];
        }

        return {
            x: index * FONT_SIZE,
            y: Math.random() * -canvas.height * 2, // stagger start positions
            speed: 0.5 + Math.random() * 2,
            char: char,
            isPercentage: isPercentage,
            isPositive: isPercentage ? char.startsWith('+') : isPositive,
            opacity: 0.08 + Math.random() * 0.18, // muted: 0.08 – 0.26
            switchTimer: Math.floor(Math.random() * 200) + 50, // frames until char change
            frameCount: 0,
        };
    }

    function draw() {
        // Semi-transparent black overlay for trail effect
        ctx.fillStyle = 'rgba(11, 11, 11, 0.12)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.font = `${FONT_SIZE}px 'Courier New', monospace`;

        for (let i = 0; i < columns.length; i++) {
            const col = columns[i];

            // Set color based on type
            if (col.isPositive) {
                ctx.fillStyle = `rgba(0, 230, 118, ${col.opacity})`; // neon green
            } else {
                ctx.fillStyle = `rgba(255, 23, 68, ${col.opacity * 0.8})`; // neon red (slightly dimmer)
            }

            ctx.fillText(col.char, col.x, col.y);

            // Move down
            col.y += col.speed;
            col.frameCount++;

            // Switch character periodically
            if (col.frameCount >= col.switchTimer) {
                col.frameCount = 0;
                col.switchTimer = Math.floor(Math.random() * 200) + 50;
                const isPercentage = Math.random() < 0.25;
                if (isPercentage) {
                    col.char = PERCENTAGES[Math.floor(Math.random() * PERCENTAGES.length)];
                    col.isPositive = col.char.startsWith('+');
                } else {
                    col.char = CRYPTO_SYMBOLS[Math.floor(Math.random() * CRYPTO_SYMBOLS.length)];
                    col.isPositive = Math.random() < 0.5;
                }
                col.isPercentage = isPercentage;
            }

            // Reset when off screen
            if (col.y > canvas.height + 50) {
                columns[i] = createColumn(i);
                columns[i].y = Math.random() * -100;
            }
        }

        requestAnimationFrame(draw);
    }

    // Handle column count on resize
    window.addEventListener('resize', () => {
        const newCount = Math.floor(canvas.width / FONT_SIZE);
        while (columns.length < newCount) {
            columns.push(createColumn(columns.length));
        }
        while (columns.length > newCount) {
            columns.pop();
        }
    });

    draw();
}

// Auto-export for module and non-module usage
if (typeof window !== 'undefined') {
    window.initMatrixBackground = initMatrixBackground;
}
