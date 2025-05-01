import { getRoomId, socketFor } from './util.js';
import { drawDot, clearHeat } from './heatmap.js';

export function adminInit() {
    const ws = socketFor(getRoomId());
    const clicksEl = document.getElementById('clicks');
    const usersEl = document.getElementById('users');
    const mini = document.getElementById('mini');
    const ctx = mini.getContext('2d');
    let clicks = 0, users = 0;

    ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'click') {
            clicksEl.textContent = `${++clicks} clicks`;
            // draw small preview dot
            ctx.beginPath();
            ctx.arc(msg.x * mini.width, msg.y * mini.height, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
        if (msg.type === 'reset') {
            clicks = 0;
            clicksEl.textContent = `0 clicks`;
            ctx.clearRect(0, 0, mini.width, mini.height);
        }
    };

    document.getElementById('start').onclick = () => ws.send(JSON.stringify({ type: 'start' }));
    document.getElementById('stop').onclick = () => ws.send(JSON.stringify({ type: 'stop' }));
    document.getElementById('reset').onclick = () => ws.send(JSON.stringify({ type: 'reset' }));
}
