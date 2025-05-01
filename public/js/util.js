/* util.js – shared helpers for front-end modules
 *
 * - getRoomId(): parses current URL to extract the room ID
 * - socketFor(): builds a WebSocket connection with protocol fallback
 */

/** Extract the roomId from the current URL path */
export function getRoomId() {
    const segments = window.location.pathname.split('/');
    return segments[segments.length - 1];
}

/**
 * Create a WebSocket connection to the server.
 *
 * @param {string} roomId - Room ID to use as protocol
 * @param {string} protocol - Optional custom subprotocol (usually same as roomId)
 */
export function socketFor(roomId, protocol = undefined) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsURL = `${proto}://${location.host}/ws`;
    return new WebSocket(wsURL, protocol || roomId);
}
