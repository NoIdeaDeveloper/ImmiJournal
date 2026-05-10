/**
 * Lightweight canvas confetti animation.
 * Renders ~120 pieces falling from the top of the viewport for ~3 seconds.
 */
export function launchConfetti() {
    const canvas = document.createElement("canvas");
    canvas.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const COLORS = [
        "#c9a870", "#e8e0d0", "#7ec8a0", "#6aafd4",
        "#d47f8a", "#a78bd4", "#f0c04a", "#6ed4c8",
    ];

    const pieces = Array.from({ length: 120 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * -canvas.height * 0.2 - 10,
        size: Math.random() * 7 + 5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        vx: (Math.random() - 0.5) * 2,
        vy: Math.random() * 3 + 2,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.2,
        shape: Math.random() > 0.5 ? "rect" : "circle",
    }));

    let frame = 0;
    const MAX_FRAMES = 180; // ~3 seconds at 60fps

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fade out in the last 30 frames
        const alpha = frame > MAX_FRAMES - 30 ? (MAX_FRAMES - frame) / 30 : 1;
        ctx.globalAlpha = alpha;

        for (const p of pieces) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillStyle = p.color;
            if (p.shape === "rect") {
                ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            p.x += p.vx;
            p.y += p.vy;
            p.angle += p.spin;
            p.vy += 0.05; // gravity
        }

        frame++;
        if (frame < MAX_FRAMES) {
            requestAnimationFrame(draw);
        } else {
            canvas.remove();
        }
    }

    requestAnimationFrame(draw);
}
