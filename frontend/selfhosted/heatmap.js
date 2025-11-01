const TWO_PI = Math.PI * 2;

function createGradient(ctx, x, y, radius, alpha = 0.35) {
    const gradient = ctx.createRadialGradient(x, y, Math.max(4, radius * 0.1), x, y, radius);
    gradient.addColorStop(0, `rgba(56, 189, 248, ${Math.min(alpha * 1.2, 0.65)})`);
    gradient.addColorStop(0.45, `rgba(14, 165, 233, ${alpha})`);
    gradient.addColorStop(1, 'rgba(14, 116, 233, 0)');
    return gradient;
}

export class SimpleHeatmap {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });
        this.summary = { totalClicks: 0, clusters: [] };
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas.parentElement || canvas);
        window.addEventListener('orientationchange', () => this.resize());
        this.resize();
    }

    setSummary(summary) {
        this.summary = summary || { totalClicks: 0, clusters: [] };
        this.draw();
    }

    clear() {
        this.summary = { totalClicks: 0, clusters: [] };
        this.draw();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const ratio = this.pixelRatio;
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.draw();
    }

    draw() {
        const { clusters = [], totalClicks = 0 } = this.summary || {};
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        this.ctx.clearRect(0, 0, width, height);

        if (!clusters.length || !totalClicks) {
            return;
        }

        const baseScale = Math.min(width, height);

        for (const cluster of clusters) {
            const cx = cluster.x * width;
            const cy = cluster.y * height;
            const radius = Math.max(20, cluster.radius * baseScale);

            this.ctx.fillStyle = createGradient(this.ctx, cx, cy, radius, Math.min(0.25 + cluster.percentage / 200, 0.65));
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, TWO_PI);
            this.ctx.fill();

            this.ctx.strokeStyle = `rgba(125, 211, 252, ${Math.min(0.6, 0.2 + cluster.percentage / 150)})`;
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, TWO_PI);
            this.ctx.stroke();

            const label = `${Math.round(cluster.percentage)}%`;
            this.ctx.font = `600 ${Math.max(14, radius * 0.35)}px 'Inter', 'Segoe UI', sans-serif`;
            this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            const textWidth = this.ctx.measureText(label).width;
            const padding = Math.max(12, radius * 0.2);
            const labelWidth = textWidth + padding;
            const labelHeight = Math.max(32, radius * 0.45);
            const labelX = cx - labelWidth / 2;
            const labelY = cy - labelHeight / 2;

            this.ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
            this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

            this.ctx.fillStyle = '#f8fafc';
            this.ctx.textBaseline = 'middle';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(label, cx, cy);
        }
    }
}

export function deriveChannelFromLocation(defaultChannel) {
    const pathSegments = window.location.pathname
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean);

    if (pathSegments.length === 0) {
        const searchChannel = new URLSearchParams(window.location.search).get('channel');
        return (searchChannel || defaultChannel || '').toLowerCase();
    }

    return pathSegments[pathSegments.length - 1].toLowerCase();
}

export function connectToHeatmap(channel, { onSummary, onStatus }) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let socket;
    let reconnectTimer;

    const connect = () => {
        clearTimeout(reconnectTimer);
        const wsUrl = `${protocol}://${window.location.host}/ws?channel=${encodeURIComponent(channel)}`;
        socket = new WebSocket(wsUrl);

        socket.addEventListener('open', () => {
            onStatus?.('connected');
        });

        socket.addEventListener('close', () => {
            onStatus?.('disconnected');
            reconnectTimer = setTimeout(connect, 2000);
        });

        socket.addEventListener('error', () => {
            socket.close();
        });

        socket.addEventListener('message', (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'hello' || payload.type === 'heatmap') {
                    onSummary?.(payload.summary || {});
                } else if (payload.type === 'reset') {
                    onSummary?.({ totalClicks: 0, clusters: [] });
                }
            } catch (error) {
                console.warn('Failed to parse websocket payload', error);
            }
        });
    };

    connect();

    return {
        close() {
            clearTimeout(reconnectTimer);
            socket?.close();
        }
    };
}
