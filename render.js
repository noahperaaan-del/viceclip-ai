/* render.js — cadrage (9:16, 1:1, 16:9), rendu image par image et export MP4 réel.
   Principe : la vidéo est lue, chaque image est dessinée dans un canvas au format voulu,
   et MediaRecorder encode le canvas + le son (H.264/AAC sur iPhone). */

export const FORMATS = {
  original: { label: 'Original', ar: null },
  '9:16': { label: '9:16 TikTok', ar: 9 / 16 },
  '1:1': { label: '1:1 Carré', ar: 1 },
  '16:9': { label: '16:9 YouTube', ar: 16 / 9 },
};
const even = n => Math.max(2, Math.round(n / 2) * 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* Taille de sortie : « shortSide » = 720 ou 1080 (côté le plus court). */
export function outputSize(srcW, srcH, format, shortSide) {
  const ar = format === 'original' || !FORMATS[format] ? srcW / srcH : FORMATS[format].ar;
  let W, H;
  if (ar >= 1) { H = shortSide; W = H * ar; } else { W = shortSide; H = W / ar; }
  if (format === 'original') {               // jamais plus grand que la source
    const s = Math.min(1, Math.min(srcW, srcH) / shortSide);
    W *= s; H *= s;
  }
  return { W: even(W), H: even(H) };
}

/* Zone de la source à afficher pour remplir le cadre (mode « Recadrer ») */
export function coverRect(sw, sh, outAR, zoom = 1, panX = 0, panY = 0) {
  let cw, ch;
  if (sw / sh > outAR) { ch = sh; cw = sh * outAR; } else { cw = sw; ch = sw / outAR; }
  cw /= zoom; ch /= zoom;
  return { sx: (sw - cw) / 2 * (1 + panX), sy: (sh - ch) / 2 * (1 + panY), sw: cw, sh: ch };
}
/* Position de la vidéo entière dans le cadre (modes « Fond flou » et « Bandes noires ») */
export function containRect(sw, sh, W, H, zoom = 1, panX = 0, panY = 0) {
  const s = Math.min(W / sw, H / sh) * zoom;
  const dw = sw * s, dh = sh * s;
  return { dx: (W - dw) / 2 * (1 + panX), dy: (H - dh) / 2 * (1 + panY), dw, dh };
}

/* Combien de pixels d'écran déplace 1 unité de pan (pour le glisser au doigt) */
export function panScale(sw, sh, W, H, opts, axis) {
  if (opts.format === 'original') return 0;
  if (opts.fit === 'crop') {
    const r = coverRect(sw, sh, W / H, opts.zoom, 0, 0);
    return axis === 'x' ? -(sw - r.sw) / 2 * (W / r.sw) : -(sh - r.sh) / 2 * (H / r.sh);
  }
  const c = containRect(sw, sh, W, H, opts.zoom, 0, 0);
  return axis === 'x' ? (W - c.dw) / 2 : (H - c.dh) / 2;
}

/* Crée une fonction de dessin pour un canvas de taille W×H */
export function createRenderer(ctx, W, H) {
  const tiny = document.createElement('canvas');
  tiny.width = 32; tiny.height = Math.max(2, Math.round(32 * H / W));
  const tg = tiny.getContext('2d');
  return function draw(v, o) {
    const sw = v.videoWidth, sh = v.videoHeight;
    if (!sw || !sh) return;
    if (o.format === 'original') { ctx.drawImage(v, 0, 0, W, H); return; }
    if (o.fit === 'crop') {
      const r = coverRect(sw, sh, W / H, o.zoom, o.panX, o.panY);
      ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
      return;
    }
    if (o.fit === 'blur') {
      // Fond flou très léger à calculer : image réduite à 32 px puis agrandie
      const r = coverRect(sw, sh, W / H, 1, 0, 0);
      tg.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, tiny.width, tiny.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tiny, 0, 0, W, H);
      ctx.fillStyle = 'rgba(7,6,11,.38)';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    const c = containRect(sw, sh, W, H, o.zoom, o.panX, o.panY);
    ctx.drawImage(v, c.dx, c.dy, c.dw, c.dh);
  };
}

/* ---------- Capacités ---------- */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
];
export function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ }
  }
  return '';
}
export function bitrateFor(W, H, quality) {
  const base = W * H * 30 * 0.1;
  return Math.round(clamp(base * (quality === 'high' ? 1.6 : 1), 2.5e6, 14e6));
}

/* ---------- Audio : un seul graphe par élément vidéo (règle Web Audio) ---------- */
let AG = null;
export function audioGraph(video) {
  if (AG) return AG;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC();
    const src = ctx.createMediaElementSource(video);
    const monitor = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    src.connect(monitor); monitor.connect(ctx.destination);
    src.connect(dest);
    AG = { ctx, monitor, dest };
  } catch (e) { console.warn('Audio indisponible', e); AG = null; }
  return AG;
}
export function resumeAudio() { if (AG && AG.ctx.state !== 'running') AG.ctx.resume().catch(() => {}); }

export function makeThumb(src, w = 320) {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.round(w * src.height / src.width);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.7);
  c.width = c.height = 0; // libère la mémoire
  return url;
}

function once(el, ev, ms) {
  return new Promise((res, rej) => {
    let to;
    const ok = () => { cleanup(); res(); };
    const ko = () => { cleanup(); rej(new Error('Erreur de lecture vidéo')); };
    const cleanup = () => { clearTimeout(to); el.removeEventListener(ev, ok); el.removeEventListener('error', ko); };
    el.addEventListener(ev, ok); el.addEventListener('error', ko);
    if (ms) to = setTimeout(() => { cleanup(); rej(new Error('La vidéo ne répond pas (délai dépassé).')); }, ms);
  });
}

/* Enregistre [start, end] de la vidéo dans un vrai fichier.
   draw() dessine l'image courante dans canvas. */
export async function recordSegment({ video: v, canvas, draw, start, end, mime, bitrate, onProgress, shouldAbort }) {
  const len = end - start;
  v.pause();
  if (!v.videoWidth) throw new Error('La vidéo n\'est pas encore prête.');
  if (Math.abs(v.currentTime - start) > 0.01) {
    const p = once(v, 'seeked', 10000);
    v.currentTime = start;
    await p;
  }
  draw();

  const vStream = canvas.captureStream(30);
  const tracks = [...vStream.getVideoTracks()];
  const ag = AG;
  if (ag) {
    await ag.ctx.resume().catch(() => {});
    ag.monitor.gain.value = 0; // export silencieux pour l'utilisateur
    tracks.push(...ag.dest.stream.getAudioTracks());
  }
  const opts = { videoBitsPerSecond: bitrate, audioBitsPerSecond: 160000 };
  if (mime) opts.mimeType = mime;
  const rec = new MediaRecorder(new MediaStream(tracks), opts);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res, rej) => {
    rec.onstop = res;
    rec.onerror = e => rej(e.error || new Error('Erreur de l\'encodeur vidéo.'));
  });

  let done = false, thumb = null;
  const finish = () => {
    if (done) return;
    done = true;
    v.pause();
    if (rec.state !== 'inactive') rec.stop();
  };
  const useRVFC = 'requestVideoFrameCallback' in v;
  const loop = () => {
    if (done) return;
    draw();
    const t = v.currentTime;
    onProgress(clamp((t - start) / len, 0, 1), t - start);
    if (!thumb && t - start >= Math.min(1, len / 2)) thumb = makeThumb(canvas);
    if (shouldAbort() || t >= end || v.ended) return finish();
    useRVFC ? v.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  };
  const guard = setInterval(() => { if (shouldAbort() || v.currentTime >= end || v.ended) finish(); }, 50);

  try { await v.play(); }
  catch (err) { clearInterval(guard); if (ag) ag.monitor.gain.value = 1; throw err; }
  rec.start(1000);
  loop();
  try { await stopped; }
  finally {
    clearInterval(guard);
    vStream.getVideoTracks().forEach(t => t.stop());
    if (ag) ag.monitor.gain.value = 1;
  }
  if (shouldAbort()) throw new Error('__abort__');
  const type = (rec.mimeType || mime || 'video/mp4').split(';')[0];
  const blob = new Blob(chunks, { type });
  chunks.length = 0;
  if (!blob.size) throw new Error('Le fichier produit est vide.');
  return { blob, type, thumb: thumb || makeThumb(canvas), width: canvas.width, height: canvas.height, duration: len };
}
