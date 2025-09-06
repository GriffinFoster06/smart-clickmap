// loader.js - External script to replace inline scripts
function waitForTwitchAndLoad() {
    if (typeof Twitch !== 'undefined' && Twitch.ext) {
        // Twitch Extension Helper is ready, now load our modules
        const scripts = [
            'debug.js',
            'heatmap.js',
            'script.js'
        ];

        // Load modules sequentially
        let loadIndex = 0;
        function loadNext() {
            if (loadIndex >= scripts.length) return;

            const script = document.createElement('script');
            script.type = 'module';
            script.src = scripts[loadIndex];
            script.onload = function () {
                loadIndex++;
                loadNext();
            };
            script.onerror = function () {
                console.error('Failed to load script:', scripts[loadIndex]);
                loadIndex++;
                loadNext();
            };
            document.head.appendChild(script);
        }

        loadNext();
    } else {
        // Wait and try again
        setTimeout(waitForTwitchAndLoad, 100);
    }
}

// Start loading process
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForTwitchAndLoad);
} else {
    waitForTwitchAndLoad();
}
