const streamerFromPath = () => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'overlay' && parts[1]) {
    return decodeURIComponent(parts[1]);
  }
  return null;
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleString();
};

const hotkeyDescriptions = (config, streamerInfo) => {
  const entries = [];
  const list = Array.isArray(streamerInfo) ? streamerInfo : [];
  const streamerCount = list.length;
  const nameFor = (id) => {
    const match = list.find((item) => item.id === id);
    return match ? (match.displayName || match.twitchChannel || id) : id;
  };
  if (config.resetHeatmap) {
    entries.push({ key: config.resetHeatmap, label: 'Reset active heatmap' });
  }
  if (config.previousStreamer && streamerCount > 1) {
    entries.push({ key: config.previousStreamer, label: 'Previous streamer' });
  }
  if (config.nextStreamer && streamerCount > 1) {
    entries.push({ key: config.nextStreamer, label: 'Next streamer' });
  }
  for (const [streamerId, key] of Object.entries(config.switchToStreamer || {})) {
    entries.push({ key, label: `Switch to ${nameFor(streamerId)}` });
  }
  return entries;
};

const toast = (() => {
  let el;
  let timer;
  return {
    show(message) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'connection-toast';
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.classList.add('is-visible');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('is-visible'), 2000);
    }
  };
})();

async function main() {
  const streamer = streamerFromPath();
  const statusEl = document.getElementById('connection-status');
  const nameEl = document.getElementById('streamer-name');
  const totalEl = document.getElementById('total-clicks');
  const resetEl = document.getElementById('last-reset');
  const hotkeyListEl = document.querySelector('#hotkey-list ul');
  const hotkeyTemplate = document.getElementById('hotkey-template');
  const clickCatcher = document.getElementById('click-catcher');
  const playerWrapper = document.getElementById('player-wrapper');
  const canvas = document.getElementById('heatmap-canvas');

  if (!streamer) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = 'Missing streamer in URL';
    return;
  }

  try {
    const configResp = await fetch(`/api/overlay/${encodeURIComponent(streamer)}/config`);
    if (!configResp.ok) {
      throw new Error(`Failed to load config (${configResp.status})`);
    }
    const configData = await configResp.json();

    nameEl.textContent = configData.displayName || configData.twitchChannel || streamer;

    if (hotkeyListEl) {
      const entries = hotkeyDescriptions(configData.hotkeys || {}, configData.streamers || []);
      hotkeyListEl.innerHTML = '';
      if (entries.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Edit local-config.json to add hotkeys';
        hotkeyListEl.appendChild(li);
      } else {
        for (const entry of entries) {
          const node = hotkeyTemplate.content.cloneNode(true);
          node.querySelector('kbd').textContent = entry.key;
          node.querySelector('.label').textContent = entry.label;
          hotkeyListEl.appendChild(node);
        }
      }
    }

    createEmbed(configData.twitchChannel || streamer);

    const renderer = new HeatmapRenderer(canvas);
    renderer.resize();
    window.addEventListener('resize', () => renderer.resize());

    const endpoint = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws?streamer=${encodeURIComponent(streamer)}`;
    const socket = new WebSocket(endpoint);

    let totalClicks = 0;

    socket.addEventListener('open', () => {
      statusEl.dataset.state = 'connected';
      statusEl.textContent = 'Connected';
      toast.show('Connected to overlay backend');
    });

    socket.addEventListener('close', () => {
      statusEl.dataset.state = 'error';
      statusEl.textContent = 'Disconnected';
      toast.show('Connection lost. Retrying…');
      setTimeout(() => window.location.reload(), 2500);
    });

    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'welcome') {
          if (payload.heatmap) {
            renderer.updateClusters(payload.heatmap.clusters || []);
            totalClicks = payload.heatmap.totalClicks || 0;
            totalEl.textContent = totalClicks.toLocaleString();
            resetEl.textContent = formatTimestamp(payload.heatmap.lastReset);
          }
        } else if (payload.type === 'heatmap') {
          renderer.updateClusters(payload.data.clusters || []);
          totalClicks = payload.data.totalClicks || totalClicks;
          totalEl.textContent = totalClicks.toLocaleString();
          resetEl.textContent = formatTimestamp(payload.data.lastReset);
        } else if (payload.type === 'reset') {
          renderer.updateClusters([]);
          totalClicks = 0;
          totalEl.textContent = '0';
          resetEl.textContent = formatTimestamp(Date.now());
        }
      } catch (error) {
        console.error('Failed to parse overlay message', error);
      }
    });

    clickCatcher.classList.add('is-armed');
    clickCatcher.addEventListener('click', (event) => {
      const rect = playerWrapper.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'click', x, y }));
      }

      // Allow the Twitch iframe to receive a synthetic click so controls still feel responsive.
      const previousPointerState = clickCatcher.style.pointerEvents;
      clickCatcher.style.pointerEvents = 'none';
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (target && target !== clickCatcher) {
        const synthetic = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          view: window
        });
        target.dispatchEvent(synthetic);
      }
      requestAnimationFrame(() => {
        clickCatcher.style.pointerEvents = previousPointerState || 'auto';
      });
    });

    const heatmapResp = await fetch(`/api/overlay/${encodeURIComponent(streamer)}/heatmap`);
    if (heatmapResp.ok) {
      const heatmapData = await heatmapResp.json();
      renderer.updateClusters(heatmapData.clusters || []);
      totalClicks = heatmapData.totalClicks || totalClicks;
      totalEl.textContent = totalClicks.toLocaleString();
      resetEl.textContent = formatTimestamp(heatmapData.lastReset);
    }
  } catch (error) {
    console.error(error);
    statusEl.dataset.state = 'error';
    statusEl.textContent = 'Offline';
  }
}

function createEmbed(channel) {
  if (!window.Twitch || !window.Twitch.Player) {
    setTimeout(() => createEmbed(channel), 250);
    return;
  }

  const parent = window.location.hostname;
  const embed = new Twitch.Embed('twitch-embed', {
    channel,
    width: '100%',
    height: '100%',
    layout: 'video',
    theme: 'dark',
    allowfullscreen: true,
    parent: [parent]
  });

  embed.addEventListener(Twitch.Embed.VIDEO_READY, () => {
    const player = embed.getPlayer();
    player.setVolume(0.2);
  });
}

main().catch((error) => console.error(error));
