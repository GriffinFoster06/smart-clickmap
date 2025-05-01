import { getRoomId, socketFor } from './util.js';
import { drawDot, clearHeat } from './heatmap.js';

export async function connect() {
    const room = getRoomId();

    // 1. Load saved clicks
    const saved = await fetch(`/api/clicks/${room}`).then(r => r.json());
    saved.forEach(({ x, y }) => drawDot(x, y));

    // 2. Connect WebSocket (protocol = roomId)
    const ws = socketFor(room, room);

    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'click') drawDot(m.x, m.y);
        if (m.type === 'reset') clearHeat();
    };
}
