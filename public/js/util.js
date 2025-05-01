export function getRoomId() {
    return window.location.pathname.split('/').pop();
}

export function socketFor(roomId) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    return new WebSocket(`${protocol}://${location.host}/ws/${roomId}`);
}
