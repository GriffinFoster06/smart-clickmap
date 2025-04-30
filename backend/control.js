const chan = location.pathname.split('/')[1];
const qs = new URLSearchParams(location.search);
const key = qs.get('key') || '';
const stats = document.getElementById('stats');

// Helper function to make API calls
function call(ep) {
    return fetch(`/api/${chan}/${ep}?key=${key}`, { method: 'POST' })
        .catch(error => console.error(`Error calling endpoint ${ep}:`, error));
}

// Ensure buttons exist before attaching event listeners
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const resetButton = document.getElementById('reset');

if (startButton) startButton.onclick = () => call('start');
if (stopButton) stopButton.onclick = () => call('stop');
if (resetButton) resetButton.onclick = () => call('reset');

// Update stats periodically
const intervalId = setInterval(() => {
    fetch(`/api/${chan}/heatmap`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (stats && data && typeof data.totalClicks === 'number' && Array.isArray(data.blobs)) {
                stats.textContent = `${data.totalClicks} clicks | ${data.blobs.length} blobs`;
            } else {
                console.warn('Invalid data format received from API:', data);
            }
        })
        .catch(error => {
            console.error('Error fetching heatmap data:', error.message);
        });
}, 1000);

// Cleanup interval on page unload
window.addEventListener('beforeunload', () => {
    clearInterval(intervalId);
});
