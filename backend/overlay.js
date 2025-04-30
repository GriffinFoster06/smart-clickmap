import { drawBlobs } from './heatmap.js';

const chan = location.pathname.split('/')[1];
const ctx = document.getElementById('heat').getContext('2d');

setInterval(() => {
    fetch(`/api/${chan}/heatmap`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data && data.blobs) {
                drawBlobs(ctx, data.blobs);
            } else {
                console.warn('Invalid data format received from API');
            }
        })
        .catch(error => {
            console.error('Error fetching heatmap data:', error.message);
        });
}, 1000);
