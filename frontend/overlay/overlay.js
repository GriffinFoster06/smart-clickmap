import { drawBlobs } from './heatmap.js';    // reuse same draw module

const EBS = 'https://smart-clickmap-backend.onrender.com';
const chan = new URLSearchParams(location.search).get('channel');
if (!chan) document.body.textContent='channel param required';

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
function resize(){
  cv.width  = window.innerWidth  || 1920;
  cv.height = window.innerHeight || 1080;
}
resize(); window.addEventListener('resize', resize);

async function poll(){
  try{
    const r = await fetch(`${EBS}/heatmap?channel=${encodeURIComponent(chan)}`);
    const { blobs } = await r.json();
    drawBlobs(ctx, blobs);
  }catch(e){ console.error(e); }
}
setInterval(poll, 1000);
