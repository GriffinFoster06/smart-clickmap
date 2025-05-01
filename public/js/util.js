export function getRoomId() {
    return window.location.pathname.split('/').pop();
}

export function socketFor(roomId, protocol = undefined) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return new WebSocket(`${proto}://${location.host}/ws`, protocol);
}
