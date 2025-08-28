// Enhanced heatmap.js with better visuals and animations

export class HeatmapRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.lastBlobs = [];
        this.animationFrame = null;

        // Visual settings
        this.settings = {
            particleLifetime: 2000,
            particleCount: 8,
            glowEnabled: true,
            animationSpeed: 0.05,
            colorScheme: 'plasma' // plasma, ocean, fire
        };

        this.colorSchemes = {
            plasma: {
                primary: [147, 46, 255],    // Purple
                secondary: [255, 0, 110],   // Pink
                accent: [0, 255, 255],      // Cyan
                top: [50, 255, 50]          // Bright green
            },
            ocean: {
                primary: [0, 119, 190],     // Ocean blue
                secondary: [0, 180, 216],   // Light blue
                accent: [144, 224, 239],    // Very light blue
                top: [255, 193, 7]          // Gold
            },
            fire: {
                primary: [255, 87, 34],     // Red-orange
                secondary: [255, 152, 0],   // Orange
                accent: [255, 193, 7],      // Yellow
                top: [76, 175, 80]          // Green
            }
        };

        this.startAnimation();
    }

    createParticle(x, y, intensity = 1) {
        const colors = this.colorSchemes[this.settings.colorScheme];
        const particleCount = Math.max(3, Math.min(12, Math.floor(intensity * this.settings.particleCount)));

        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
            const speed = 0.5 + Math.random() * 1.5;
            const size = 2 + Math.random() * 4 * intensity;

            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: size,
                maxSize: size,
                life: this.settings.particleLifetime,
                maxLife: this.settings.particleLifetime,
                color: colors.accent,
                intensity: intensity
            });
        }
    }

    updateParticles(deltaTime) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];

            // Update position
            particle.x += particle.vx * deltaTime * 0.1;
            particle.y += particle.vy * deltaTime * 0.1;

            // Update life
            particle.life -= deltaTime;
            const lifeFactor = particle.life / particle.maxLife;

            // Update size (shrink over time)
            particle.size = particle.maxSize * lifeFactor;

            // Add some gravity and friction
            particle.vy += 0.02 * deltaTime;
            particle.vx *= 0.99;
            particle.vy *= 0.99;

            // Remove dead particles
            if (particle.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    drawParticles() {
        this.particles.forEach(particle => {
            const lifeFactor = particle.life / particle.maxLife;
            const alpha = lifeFactor * particle.intensity;

            if (alpha > 0.01) {
                const [r, g, b] = particle.color;

                // Glow effect
                if (this.settings.glowEnabled) {
                    this.ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                    this.ctx.shadowBlur = particle.size * 2;
                } else {
                    this.ctx.shadowBlur = 0;
                }

                this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                this.ctx.beginPath();
                this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                this.ctx.fill();
            }
        });

        this.ctx.shadowBlur = 0; // Reset shadow
    }

    getColorForBlob(blob, scheme) {
        const colors = this.colorSchemes[scheme];

        if (blob.isTop) return colors.top;

        // Interpolate between primary and secondary based on intensity
        const intensity = Math.min(1, blob.intensity || (blob.count / 20));
        const [r1, g1, b1] = colors.primary;
        const [r2, g2, b2] = colors.secondary;

        return [
            Math.round(r1 + (r2 - r1) * intensity),
            Math.round(g1 + (g2 - g1) * intensity),
            Math.round(b1 + (b2 - b1) * intensity)
        ];
    }

    drawBlob(blob, index, total) {
        const W = this.canvas.width;
        const H = this.canvas.height;
        const cx = blob.x * W;
        const cy = blob.y * H;

        // Enhanced radius calculation
        const baseRadius = 8;
        const sizeMultiplier = Math.sqrt(blob.pct || 1) * 0.8;
        const intensityMultiplier = (blob.intensity || 0.5) * 0.5;
        const r = baseRadius + sizeMultiplier * 4 + intensityMultiplier * 10;

        // Pulsing effect for top blob
        const pulseMultiplier = blob.isTop ?
            1 + 0.2 * Math.sin(Date.now() * 0.005) : 1;
        const finalRadius = r * pulseMultiplier;

        const [colorR, colorG, colorB] = this.getColorForBlob(blob, this.settings.colorScheme);

        // Recency fade effect
        const recencyAlpha = blob.recency !== undefined ?
            Math.max(0.3, blob.recency) : 1;

        // Create radial gradient
        const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, finalRadius);
        gradient.addColorStop(0, `rgba(${colorR}, ${colorG}, ${colorB}, ${0.6 * recencyAlpha})`);
        gradient.addColorStop(0.7, `rgba(${colorR}, ${colorG}, ${colorB}, ${0.3 * recencyAlpha})`);
        gradient.addColorStop(1, `rgba(${colorR}, ${colorG}, ${colorB}, 0)`);

        // Draw glow effect
        if (this.settings.glowEnabled) {
            this.ctx.shadowColor = `rgba(${colorR}, ${colorG}, ${colorB}, 0.8)`;
            this.ctx.shadowBlur = blob.isTop ? 25 : 15;
        }

        // Fill the blob
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, finalRadius, 0, 2 * Math.PI);
        this.ctx.fill();

        // Draw border for top blobs
        if (blob.isTop || blob.pct >= 15) {
            this.ctx.strokeStyle = blob.isTop ?
                `rgba(${this.colorSchemes[this.settings.colorScheme].top.join(', ')}, 0.9)` :
                `rgba(255, 255, 255, 0.7)`;
            this.ctx.lineWidth = blob.isTop ? 3 : 2;
            this.ctx.stroke();
        }

        this.ctx.shadowBlur = 0; // Reset shadow

        // Draw percentage text
        const fontSize = Math.max(12, finalRadius * 0.4);
        this.ctx.font = `bold ${fontSize}px 'Segoe UI', Arial, sans-serif`;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.lineWidth = 2;

        const text = `${blob.pct}%`;
        this.ctx.strokeText(text, cx, cy);
        this.ctx.fillText(text, cx, cy);

        // Draw rank indicator for top 3
        if (blob.rank <= 3 && blob.rank !== undefined) {
            const rankY = cy - finalRadius - 20;
            const rankSize = 16;

            // Rank background
            this.ctx.fillStyle = blob.isTop ?
                `rgba(${this.colorSchemes[this.settings.colorScheme].top.join(', ')}, 0.9)` :
                'rgba(255, 255, 255, 0.2)';
            this.ctx.beginPath();
            this.ctx.arc(cx, rankY, rankSize, 0, Math.PI * 2);
            this.ctx.fill();

            // Rank text
            this.ctx.font = `bold ${rankSize}px Arial`;
            this.ctx.fillStyle = blob.isTop ? 'black' : 'white';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(blob.rank.toString(), cx, rankY);
        }
    }

    drawBlobs(blobs) {
        const W = this.canvas.width;
        const H = this.canvas.height;

        // Clear canvas with subtle background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
        this.ctx.fillRect(0, 0, W, H);

        if (!blobs || blobs.length === 0) {
            this.lastBlobs = [];
            return;
        }

        // Detect new blobs and create particles
        if (this.lastBlobs.length < blobs.length) {
            const newBlobs = blobs.slice(this.lastBlobs.length);
            newBlobs.forEach(blob => {
                this.createParticle(
                    blob.x * W,
                    blob.y * H,
                    (blob.intensity || 0.5) * 2
                );
            });
        }

        // Draw each blob
        blobs.forEach((blob, index) => {
            this.drawBlob(blob, index, blobs.length);
        });

        this.lastBlobs = blobs;
    }

    animate() {
        const now = performance.now();
        const deltaTime = now - (this.lastTime || now);
        this.lastTime = now;

        // Update particles
        this.updateParticles(deltaTime);

        // Draw particles
        this.drawParticles();

        // Continue animation
        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    startAnimation() {
        if (!this.animationFrame) {
            this.animate();
        }
    }

    stopAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.particles = [];
        this.lastBlobs = [];
    }

    // Create click ripple effect
    createClickEffect(x, y, intensity = 1) {
        const W = this.canvas.width;
        const H = this.canvas.height;
        const actualX = x * W;
        const actualY = y * H;

        // Create immediate visual feedback
        this.createParticle(actualX, actualY, intensity);

        // Create expanding ripple
        const colors = this.colorSchemes[this.settings.colorScheme];
        const [r, g, b] = colors.accent;

        const ripple = {
            x: actualX,
            y: actualY,
            radius: 0,
            maxRadius: 30 + intensity * 20,
            life: 1000,
            maxLife: 1000,
            color: [r, g, b],
            intensity: intensity
        };

        const animateRipple = () => {
            const ctx = this.ctx;
            const lifeFactor = ripple.life / ripple.maxLife;
            const alpha = lifeFactor * 0.8;

            if (lifeFactor > 0) {
                ripple.radius = ripple.maxRadius * (1 - lifeFactor);

                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                ctx.lineWidth = 3 * lifeFactor;
                ctx.beginPath();
                ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
                ctx.stroke();

                ripple.life -= 16; // ~60fps
                requestAnimationFrame(animateRipple);
            }
        };

        animateRipple();
    }
}

// Legacy function for backward compatibility
export function drawBlobs(ctx, blobs) {
    const renderer = new HeatmapRenderer(ctx.canvas);
    renderer.drawBlobs(blobs);
}