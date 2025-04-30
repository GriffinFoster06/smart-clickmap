import { drawBlobs } from './heatmap.js';

const chan = location.pathname.split('/')[1];
const heatElement = document.getElementById('heat');

if (heatElement) {
    const ctx = heatElement.getContext('2d');

    const intervalId = setInterval(() => {
        fetch(`/api/${chan}/heatmap`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data && Array.isArray(data.blobs)) {
                    drawBlobs(ctx, data.blobs);
                } else {
                    console.warn('Invalid data format received from API');
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
} else {
    console.error('Canvas element with id "heat" not found.');
}
