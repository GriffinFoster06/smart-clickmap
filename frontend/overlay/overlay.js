import { drawBlobs } from './heatmap.js';    // reuse same draw module

const EBS = 'https://smart-clickmap-backend.onrender.com';
let channelId = null;
Twitch.ext.onAuthorized(auth => {
  channelId = auth.channelId;
  setInterval(poll, 1000);
});

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
function resize(){
  cv.width  = window.innerWidth  || 1920;
  cv.height = window.innerHeight || 1080;
}
resize(); window.addEventListener('resize', resize);

async function poll(){
  if(!channelId) return;
  try{
    const r = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(channelId)}`);
    const { blobs } = await r.json();
    drawBlobs(ctx, blobs);
  }catch(e){ console.error(e); }
}
