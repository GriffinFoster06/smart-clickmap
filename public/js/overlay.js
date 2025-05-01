import { getRoomId, socketFor } from './util.js';
import { drawDot, clearHeat } from './heatmap.js';

export function connect() {
    const ws = socketFor(getRoomId());
    ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'click') drawDot(msg.x, msg.y);
        if (msg.type === 'reset') clearHeat();
    };
}

export function viewerInit() {
    const room = getRoomId();
    const ws = socketFor(room);
    const canvas = document.getElementById('heat');

    canvas.addEventListener('click', e => {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const payload = JSON.stringify({ type: 'click', x, y });
        ws.send(payload);
        drawDot(x, y);
    });

    ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'click') drawDot(msg.x, msg.y);
        if (msg.type === 'reset') clearHeat();
    };
}
