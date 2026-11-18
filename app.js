/* ViceClip AI v2 — interface. Tout le traitement vidéo se fait sur l'appareil. */
import { Clips, loadSettings, saveSettings, DEFAULT_SETTINGS, storageInfo, requestPersist } from './store.js';
import { FORMATS, outputSize, createRenderer, panScale, pickMime, bitrateFor, audioGraph, resumeAudio, recordSegment } from './render.js';
import { analyzeFile } from './analysis.js';
import { parseVideoUrl, fetchPublicInfo, PLATFORMS } from './sources.js';
import { AI_MODULES } from './ai.js';

const VERSION = '2.0.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MIN_LEN = 0.5;

/* ---------------- Utilitaires ---------------- */
function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const tenths = Math.round(t * 10), m = Math.floor(tenths / 600);
  return m + ':' + ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
}
function fmtShort(t) { const s = Math.round(t || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function fmtDur(t) {
  t = Math.round(t || 0);
  if (t < 60) return t + ' s';
  const m = Math.floor(t / 60), s = t % 60;
  return m + ' min' + (s ? ' ' + s + ' s' : '');
}
function fmtSize(b) {
  if (!b) return '0 Mo';
  if (b < 1e6) return Math.max(1, Math.round(b / 1e3)) + ' Ko';
  if (b < 1e9) return (b / 1e6).toFixed(b < 1e8 ? 1 : 0).replace('.', ',') + ' Mo';
  return (b / 1e9).toFixed(1).replace('.', ',') + ' Go';
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
/* Messages d'erreur compréhensibles */
function humanError(e) {
  const n = e && e.name, m = (e && e.message) || String(e);
  if (n === 'NotAllowedError') return 'Safari a bloqué l\'action. Touche à nouveau le bouton.';
  if (n === 'QuotaExceededError') return 'Stockage de Safari plein. Supprime des anciens clips ou enregistre-les dans Fichiers.';
  if (n === 'NotSupportedError') return 'Ce format n\'est pas pris en charge par Safari sur cet appareil.';
  if (n === 'AbortError') return 'Action annulée.';
  if (/memory|allocation|out of/i.test(m)) return 'L\'iPhone manque de mémoire. Ferme d\'autres apps ou utilise une vidéo plus courte.';
  return m;
}
function once(el, ev, ms) {
  return new Promise((res, rej) => {
    let to;
    const ok = () => { cleanup(); res(); };
    const ko = () => { cleanup(); rej(new Error('Erreur de lecture vidéo')); };
    const cleanup = () => { clearTimeout(to); el.removeEventListener(ev, ok); el.removeEventListener('error', ko); };
    el.addEventListener(ev, ok); el.addEventListener('error', ko);
    if (ms) to = setTimeout(() => { cleanup(); rej(new Error('Délai dépassé')); }, ms);
  });
}

/* ---------------- État ---------------- */
let settings = loadSettings();
const S = {
  file: null, url: null, duration: 0, start: 0, end: 0,
  clips: [], exporting: false, abort: false, abortReason: '', previewSel: false, thumbToken: 0,
  edit: {}, analysis: null, activeMoment: -1, current: null,
  lib: { q: '', filter: 'all', sort: 'new' },
};
function resetEdit() {
  S.edit = { format: settings.format, fit: settings.fit, zoom: 1, panX: 0, panY: 0, resolution: +settings.resolution, quality: settings.quality };
}
resetEdit();
const video = $('#video');

/* ---------------- Navigation ---------------- */
const TABS = { home: 'home', create: 'create', library: 'library', profile: 'profile', settings: 'profile', ai: 'profile' };
let currentView = 'home';
function show(view) {
  currentView = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === TABS[view]));
  if (view !== 'create' && !video.paused) video.pause();
  ({ home: renderHome, library: renderLibrary, profile: renderProfile, settings: renderSettings, ai: renderAI })[view]?.();
  if (view === 'create') requestAnimationFrame(layoutPreview);
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-view],[data-goto]');
  if (b && !b.closest('.chips')) show(b.dataset.view || b.dataset.goto);
});

/* ---------------- Puces (sélecteurs) ---------------- */
function setChips(group, value) {
  $$(`.chips[data-group="${group}"] button`).forEach(b => b.classList.toggle('active', b.dataset.v === String(value)));
}
const chipHandlers = {};
document.addEventListener('click', e => {
  const b = e.target.closest('.chips button');
  if (!b) return;
  const g = b.closest('.chips').dataset.group;
  setChips(g, b.dataset.v);
  chipHandlers[g] && chipHandlers[g](b.dataset.v);
});

/* ---------------- Compatibilité ---------------- */
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 't.mp4', { type: 'video/mp4' })] })); }
  catch (e) { return false; }
}
function renderCompat() {
  const mime = pickMime();
  const items = [
    ['Enregistreur vidéo', mime === null ? ['ko', 'Absent'] : ['ok', 'OK']],
    ['Export MP4', mime && mime.startsWith('video/mp4') ? ['ok', 'OK'] : mime ? ['meh', 'WebM seulement'] : ['ko', 'Non']],
    ['Capture du rendu', HTMLCanvasElement.prototype.captureStream ? ['ok', 'OK'] : ['ko', 'Non']],
    ['Analyse du son', (window.OfflineAudioContext || window.webkitOfflineAudioContext) ? ['ok', 'OK'] : ['ko', 'Non']],
    ['Partage vers Fichiers / Photos', canShareFiles() ? ['ok', 'OK'] : ['meh', 'Téléchargement seul']],
    ['Écran maintenu allumé', 'wakeLock' in navigator ? ['ok', 'OK'] : ['meh', 'Garde l\'écran actif']],
  ];
  $('#compat').innerHTML = items.map(([l, [c, v]]) => `<li><span>${l}</span><span class="${c}">${v}</span></li>`).join('');
}

/* ================= IMPORT ================= */
function onPick(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) loadFile(f);
}
$('#file-input').addEventListener('change', onPick);
$('#file-input-2').addEventListener('change', onPick);
document.addEventListener('change', e => { if (e.target.matches('.ur-file')) onPick(e); });

function loadFile(file) {
  const okType = /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
  if (!okType) { toast('Format non pris en charge. Utilise un fichier MP4, MOV ou WebM.'); return; }
  if (S.exporting) return;
  if (S.url) URL.revokeObjectURL(S.url);  // libère l'ancienne vidéo
  S.file = file; S.url = URL.createObjectURL(file);
  S.duration = 0; S.analysis = null; S.activeMoment = -1;
  resetEdit(); syncEditChips();
  $('#moments').innerHTML = ''; $('#btn-batch').classList.add('hidden');
  $('#energy').classList.add('hidden'); $('#marks').innerHTML = '';
  $('#stage-loading').classList.remove('hidden');
  $('#big-play').classList.add('hidden');
  video.src = S.url; video.load();
  $('#file-name').textContent = file.name || 'Vidéo';
  $('#file-meta').textContent = fmtSize(file.size);
  $('#clip-title').value = (file.name || 'Clip').replace(/\.[^.]+$/, '').slice(0, 80);
  $('#src-pick').classList.add('hidden');
  $('#editor').classList.remove('hidden');
  show('create');
}

video.addEventListener('loadedmetadata', async () => {
  let d = video.duration;
  if (!isFinite(d)) {
    video.currentTime = 1e9;
    try { await once(video, 'durationchange', 4000); } catch (e) { /* ignore */ }
    d = video.duration; video.currentTime = 0;
  }
  if (!isFinite(d) || d <= 0) { toast('Impossible de lire la durée de cette vidéo.'); return; }
  S.duration = d; S.start = 0; S.end = Math.min(d, 30);
  $('#total-time').textContent = fmt(d);
  $('#file-meta').textContent = `${fmtDur(d)} · ${video.videoWidth}×${video.videoHeight} · ${fmtSize(S.file.size)}`;
  if (video.currentTime === 0) video.currentTime = 0.001;
  renderRange(); updateResHint(); makeThumbs();
});
video.addEventListener('loadeddata', () => {
  $('#stage-loading').classList.add('hidden');
  if (video.paused) $('#big-play').classList.remove('hidden');
  layoutPreview();
});
video.addEventListener('error', () => {
  if (!video.getAttribute('src')) return;
  $('#stage-loading').classList.add('hidden');
  toast('Safari ne peut pas lire cette vidéo. Essaie un autre fichier (MP4 H.264 conseillé).', 5000);
});

/* ---------- Import par lien ---------- */
$('#url-paste').addEventListener('click', async () => {
  try { $('#url-input').value = (await navigator.clipboard.readText()).trim(); analyzeUrl(); }
  catch (e) { toast('Collage refusé : appuie longuement dans le champ puis « Coller ».'); $('#url-input').focus(); }
});
$('#url-go').addEventListener('click', analyzeUrl);
$('#url-input').addEventListener('keydown', e => { if (e.key === 'Enter') analyzeUrl(); });

async function analyzeUrl() {
  const box = $('#url-result');
  const src = parseVideoUrl($('#url-input').value);
  box.classList.remove('hidden');
  if (!src) { box.innerHTML = '<p class="tiny">Ce lien n\'est pas valide. Copie l\'adresse complète depuis l\'app (bouton Partager › Copier le lien).</p>'; return; }
  if (!src.platform) { box.innerHTML = '<p class="tiny">Ce site n\'est pas pris en charge. ViceClip reconnaît YouTube, Twitch, Kick et TikTok. Tu peux toujours importer le fichier vidéo.</p>'; return; }
  const P = PLATFORMS[src.platform];
  box.innerHTML = `
    <div class="ur-head">
      <img class="ur-thumb hidden" alt="">
      <div><div class="ur-plat" style="color:${P.color}">${P.name}</div>
      <div class="ur-title">${esc(src.label)}</div><div class="tiny ur-author"><span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Recherche des infos publiques…</div></div>
    </div>
    <ul class="ur-meta">
      <li><span>Plateforme</span><b>${P.name}</b></li>
      <li><span>Titre</span><b class="m-title">…</b></li>
      <li><span>Durée</span><b>Non accessible sans API officielle</b></li>
      <li><span>Téléchargement direct</span><b style="color:var(--danger)">Non autorisé</b></li>
    </ul>
    <div class="ur-why">${esc(P.why)}</div>
    <b class="tiny">Comment récupérer le fichier original</b>
    <ol class="ur-steps">${P.howto.map(h => `<li>${esc(h)}</li>`).join('')}</ol>
    <label class="btn primary full">J'ai le fichier : l'importer<input type="file" class="ur-file" accept="video/mp4,video/quicktime,video/webm,video/*" hidden></label>
    <a class="btn ghost full" style="margin-top:8px" target="_blank" rel="noopener noreferrer">Ouvrir le lien</a>`;
  box.querySelector('a').href = src.url;
  if (src.thumbnail) showThumb(box, src.thumbnail);
  const info = await fetchPublicInfo(src);
  const author = box.querySelector('.ur-author'), title = box.querySelector('.m-title');
  if (!author) return; // résultat remplacé entre-temps
  if (info.ok) {
    box.querySelector('.ur-title').textContent = info.title || src.label;
    title.textContent = 'Trouvé ✓';
    author.textContent = info.author ? 'par ' + info.author : '';
    if (info.thumbnail) showThumb(box, info.thumbnail);
  } else {
    title.textContent = 'Non accessible';
    author.textContent = info.reason;
  }
}
function showThumb(box, url) {
  const img = box.querySelector('.ur-thumb');
  img.onload = () => img.classList.remove('hidden');
  img.onerror = () => img.classList.add('hidden');
  img.referrerPolicy = 'no-referrer';
  img.src = url;
}

/* ---------- Miniatures de la timeline ---------- */
async function makeThumbs() {
  const token = ++S.thumbToken, box = $('#thumbs'), n = 8;
  box.innerHTML = '<div></div>'.repeat(n);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.src = S.url;
  const c = document.createElement('canvas');
  try {
    v.play().then(() => v.pause()).catch(() => {});
    if (v.readyState < 2) await once(v, 'loadeddata', 6000);
    v.pause();
    c.height = 64; c.width = Math.round(64 * (v.videoWidth / v.videoHeight || 16 / 9));
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      if (token !== S.thumbToken) return;
      const p = once(v, 'seeked', 5000);
      v.currentTime = ((i + 0.5) / n) * S.duration;
      await p;
      g.drawImage(v, 0, 0, c.width, c.height);
      box.children[i].style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.55)})`;
    }
  } catch (e) { /* miniatures facultatives */ }
  finally { v.removeAttribute('src'); v.load(); c.width = c.height = 0; }
}

/* ================= LECTURE + APERÇU ================= */
function togglePlay() {
  if (S.exporting || !S.duration) return;
  resumeAudio(); S.previewSel = false;
  if (video.paused) video.play().catch(err => toast(humanError(err)));
  else video.pause();
}
$('#btn-play').addEventListener('click', togglePlay);
$('#big-play').addEventListener('click', togglePlay);
$('#btn-preview-sel').addEventListener('click', () => playRange(S.start));
function playRange(from) {
  if (S.exporting || !S.duration) return;
  resumeAudio();
  video.currentTime = from; S.previewSel = true;
  video.play().catch(err => toast(humanError(err)));
}
const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>';
video.addEventListener('play', () => { $('#btn-play').innerHTML = PAUSE; $('#big-play').classList.add('hidden'); tick(); });
video.addEventListener('pause', () => { $('#btn-play').innerHTML = PLAY; if (!S.exporting) $('#big-play').classList.remove('hidden'); drawPreview(); });
video.addEventListener('timeupdate', updatePlayhead);
video.addEventListener('seeked', () => { updatePlayhead(); drawPreview(); });

function tick() {
  updatePlayhead();
  if (!S.exporting) drawPreview();
  if (S.previewSel && video.currentTime >= S.end) { video.pause(); S.previewSel = false; }
  if (!video.paused) requestAnimationFrame(tick);
}
function updatePlayhead() {
  $('#cur-time').textContent = fmt(video.currentTime);
  if (S.duration) $('#playhead').style.left = (video.currentTime / S.duration * 100) + '%';
}

/* Aperçu fidèle du rendu final (même fonction de dessin que l'export) */
const pv = $('#pv'), pvWrap = $('#pv-wrap'), stage = $('#stage');
let pvDraw = null;
function layoutPreview() {
  const on = S.edit.format !== 'original' && video.videoWidth > 0;
  pvWrap.classList.toggle('hidden', !on);
  $('#framing').classList.toggle('hidden', S.edit.format === 'original');
  $('#big-play').style.pointerEvents = on ? 'none' : '';
  if (!on || currentView !== 'create') return;
  const { W, H } = outputSize(video.videoWidth, video.videoHeight, S.edit.format, 480);
  if (pv.width !== W || pv.height !== H) { pv.width = W; pv.height = H; }
  pvDraw = createRenderer(pv.getContext('2d'), W, H);
  const bw = stage.clientWidth - 16, bh = stage.clientHeight - 16;
  const s = Math.min(bw / W, bh / H);
  pv.style.width = Math.floor(W * s) + 'px';
  pv.style.height = Math.floor(H * s) + 'px';
  drawPreview();
}
function drawPreview() {
  if (pvDraw && S.edit.format !== 'original' && video.readyState >= 2) pvDraw(video, S.edit);
}
window.addEventListener('resize', () => requestAnimationFrame(layoutPreview));

// Glisser l'image pour cadrer
let panDrag = null;
pvWrap.addEventListener('pointerdown', e => {
  if (S.exporting) return;
  panDrag = { x: e.clientX, y: e.clientY, px: S.edit.panX, py: S.edit.panY, moved: false };
  try { pvWrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
pvWrap.addEventListener('pointermove', e => {
  if (!panDrag) return;
  const k = pv.width / pv.clientWidth; // px écran -> px de rendu
  const dx = (e.clientX - panDrag.x) * k, dy = (e.clientY - panDrag.y) * k;
  if (Math.abs(dx) + Math.abs(dy) > 3) panDrag.moved = true;
  const sx = panScale(video.videoWidth, video.videoHeight, pv.width, pv.height, S.edit, 'x');
  const sy = panScale(video.videoWidth, video.videoHeight, pv.width, pv.height, S.edit, 'y');
  if (Math.abs(sx) > 0.5) S.edit.panX = clamp(panDrag.px + dx / sx, -1, 1);
  if (Math.abs(sy) > 0.5) S.edit.panY = clamp(panDrag.py + dy / sy, -1, 1);
  drawPreview();
});
['pointerup', 'pointercancel'].forEach(ev => pvWrap.addEventListener(ev, () => {
  if (panDrag && !panDrag.moved) togglePlay(); // simple toucher = lecture/pause
  panDrag = null;
}));
video.addEventListener('click', togglePlay);

/* ---------- Réglages d'édition ---------- */
function syncEditChips() {
  setChips('format', S.edit.format); setChips('fit', S.edit.fit);
  setChips('resolution', S.edit.resolution); setChips('quality', S.edit.quality);
  $('#zoom').value = S.edit.zoom; $('#zoom-val').textContent = S.edit.zoom.toFixed(1).replace('.', ',') + '×';
}
chipHandlers.format = v => { S.edit.format = v; S.edit.panX = S.edit.panY = 0; S.edit.zoom = 1; syncEditChips(); layoutPreview(); updateResHint(); };
chipHandlers.fit = v => { S.edit.fit = v; S.edit.panX = S.edit.panY = 0; layoutPreview(); };
chipHandlers.resolution = v => { S.edit.resolution = +v; updateResHint(); };
chipHandlers.quality = v => { S.edit.quality = v; updateResHint(); };
$('#zoom').addEventListener('input', e => {
  S.edit.zoom = +e.target.value;
  $('#zoom-val').textContent = S.edit.zoom.toFixed(1).replace('.', ',') + '×';
  drawPreview();
});
$('#recenter').addEventListener('click', () => { S.edit.panX = S.edit.panY = 0; S.edit.zoom = 1; syncEditChips(); drawPreview(); });

function updateResHint() {
  if (!video.videoWidth) return;
  const { W, H } = outputSize(video.videoWidth, video.videoHeight, S.edit.format, S.edit.resolution);
  const mb = bitrateFor(W, H, S.edit.quality) / 8 / 1e6 * 30;
  let txt = `Sortie ${W}×${H} · environ ${mb.toFixed(0)} Mo pour 30 s.`;
  if (S.edit.format !== 'original' && S.edit.fit === 'crop') {
    const srcPx = Math.min(video.videoHeight, video.videoWidth * (W / H) >= video.videoHeight ? video.videoHeight : video.videoWidth);
    if (Math.max(W, H) > Math.max(video.videoWidth, video.videoHeight) || srcPx < Math.min(W, H) * 0.7) txt += ' La zone recadrée est plus petite que la sortie : l\'image sera agrandie (un peu moins nette).';
  }
  $('#res-hint').textContent = txt;
}

/* ================= SÉLECTION DU PASSAGE ================= */
const pct = t => (S.duration ? (t / S.duration) * 100 : 0) + '%';
function renderRange() {
  $('#h-start').style.left = pct(S.start); $('#h-end').style.left = pct(S.end);
  $('#sel').style.left = pct(S.start); $('#sel').style.width = pct(S.end - S.start);
  $('#dim-left').style.width = pct(S.start); $('#dim-right').style.width = pct(S.duration - S.end);
  $('#tc-start').textContent = fmt(S.start); $('#tc-end').textContent = fmt(S.end);
  const d = S.end - S.start;
  $('#sel-dur').textContent = d.toFixed(1).replace('.', ',') + ' s';
  const h = $('#sel-hint');
  h.className = '';
  if (d < 15) h.textContent = '· court pour TikTok (idéal 15–60 s)';
  else if (d > 60) h.textContent = '· plus de 60 s, export plus long';
  else { h.textContent = '· ✓ durée idéale'; h.className = 'good'; }
}
function setStart(t) { S.start = clamp(t, 0, Math.max(0, S.end - MIN_LEN)); }
function setEnd(t) { S.end = clamp(t, S.start + MIN_LEN, S.duration); }

const timeline = $('#timeline');
let drag = null, seekRaf = 0, seekTarget = 0;
const timeFromX = x => { const r = timeline.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * S.duration; };
function scheduleSeek(t) {
  seekTarget = t;
  if (!seekRaf) seekRaf = requestAnimationFrame(() => { seekRaf = 0; video.currentTime = seekTarget; });
}
timeline.addEventListener('pointerdown', e => {
  if (!S.duration || S.exporting) return;
  e.preventDefault();
  const r = timeline.getBoundingClientRect();
  const ds = Math.abs(e.clientX - (r.left + S.start / S.duration * r.width));
  const de = Math.abs(e.clientX - (r.left + S.end / S.duration * r.width));
  drag = Math.min(ds, de) < 24 ? (ds <= de ? 'start' : 'end') : 'seek';
  if (!video.paused) video.pause();
  S.previewSel = false;
  try { timeline.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  moveDrag(e);
});
timeline.addEventListener('pointermove', e => { if (drag) moveDrag(e); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => timeline.addEventListener(ev, () => { drag = null; }));
function moveDrag(e) {
  const t = timeFromX(e.clientX);
  if (drag === 'start') { setStart(t); scheduleSeek(S.start); }
  else if (drag === 'end') { setEnd(t); scheduleSeek(S.end); }
  else scheduleSeek(t);
  S.activeMoment = -1; markActiveMoment();
  renderRange();
}
$$('.nudges button').forEach(b => b.addEventListener('click', () => {
  if (!S.duration) return;
  const d = parseFloat(b.dataset.d);
  if (b.dataset.n === 'start') { setStart(S.start + d); video.currentTime = S.start; }
  else { setEnd(S.end + d); video.currentTime = S.end; }
  renderRange();
}));
$('#set-start').addEventListener('click', () => {
  if (!S.duration) return;
  const t = Math.min(video.currentTime, S.duration - MIN_LEN);
  if (S.end - t < MIN_LEN) S.end = Math.min(S.duration, t + 30);
  setStart(t); renderRange();
});
$('#set-end').addEventListener('click', () => {
  if (!S.duration) return;
  const t = Math.max(video.currentTime, MIN_LEN);
  if (t - S.start < MIN_LEN) S.start = Math.max(0, t - 30);
  setEnd(t); renderRange();
});
$$('.presets button').forEach(b => b.addEventListener('click', () => {
  if (!S.duration) return;
  const n = Math.min(parseFloat(b.dataset.p), S.duration);
  if (S.start + n > S.duration) S.start = S.duration - n;
  S.end = S.start + n; renderRange();
}));

/* ================= MOMENTS FORTS (analyse sonore locale) ================= */
$('#btn-analyze').addEventListener('click', async () => {
  if (!S.file || S.exporting) return;
  const btn = $('#btn-analyze');
  btn.disabled = true;
  $('#an-progress').classList.remove('hidden');
  $('#moments').innerHTML = ''; $('#btn-batch').classList.add('hidden');
  const file = S.file;
  try {
    const res = await analyzeFile(file, {
      clipLength: +settings.clipLength, count: +settings.suggestions,
      onProgress: (p, msg) => { $('#an-bar').style.width = (p * 100) + '%'; $('#an-status').textContent = msg; },
    });
    if (file !== S.file) return; // une autre vidéo a été chargée entre-temps
    S.analysis = res;
    renderMoments(); drawEnergy();
    $('#an-status').textContent = res.moments.length
      ? `${res.moments.length} moment(s) trouvé(s). Touche « Utiliser » pour charger un passage.`
      : 'Aucun pic sonore marquant : la vidéo a un volume très régulier. Choisis le passage à la main.';
  } catch (e) {
    $('#an-status').textContent = humanError(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Relancer l\'analyse';
  }
});
function renderMoments() {
  const ms = S.analysis ? S.analysis.moments : [];
  $('#moments').innerHTML = ms.map((m, i) => `
    <li class="moment" data-i="${i}">
      <div class="mscore" title="Score d'intensité">${m.score}</div>
      <div class="mbody"><b>${fmtShort(m.start)} → ${fmtShort(m.end)}</b>
        <ul>${m.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="mbtns"><button class="btn small" data-act="use">Utiliser</button><button class="btn ghost small" data-act="play">▶ Écouter</button></div>
      </div></li>`).join('');
  $('#marks').innerHTML = ms.map(m => `<span class="mark" style="left:${pct(m.peakAt)}"></span>`).join('');
  const total = ms.reduce((a, m) => a + (m.end - m.start), 0);
  const b = $('#btn-batch');
  b.classList.toggle('hidden', ms.length < 2);
  b.textContent = `Exporter les ${ms.length} moments (≈ ${Math.ceil(total / 60)} min)`;
  markActiveMoment();
}
$('#moments').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = +btn.closest('.moment').dataset.i, m = S.analysis.moments[i];
  S.start = m.start; S.end = m.end; S.activeMoment = i;
  renderRange(); markActiveMoment();
  if (btn.dataset.act === 'play') playRange(Math.max(m.start, m.peakAt - 3));
  else { video.currentTime = m.start; toast('Passage chargé : ' + fmtShort(m.start) + ' → ' + fmtShort(m.end)); }
});
function markActiveMoment() { $$('.moment').forEach(li => li.classList.toggle('active', +li.dataset.i === S.activeMoment)); }
function drawEnergy() {
  const c = $('#energy'), curve = S.analysis && S.analysis.curve;
  if (!curve) return;
  c.classList.remove('hidden');
  const w = c.width = timeline.clientWidth * 2, h = c.height = timeline.clientHeight * 2;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, 'rgba(124,58,237,.15)'); grad.addColorStop(1, 'rgba(251,191,36,.85)');
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(0, h);
  curve.forEach((v, i) => g.lineTo(i / (curve.length - 1) * w, h - v * h * 0.95));
  g.lineTo(w, h); g.closePath(); g.fill();
}

/* ================= EXPORT ================= */
const expSheet = $('#export-sheet');
let lastExport = null, expResultUrl = null;

$('#btn-export').addEventListener('click', () => startExport([{ start: S.start, end: S.end, title: ($('#clip-title').value || 'Clip').trim() }]));
$('#btn-batch').addEventListener('click', () => {
  const base = ($('#clip-title').value || 'Clip').trim();
  startExport(S.analysis.moments.map((m, i) => ({ start: m.start, end: m.end, title: `${base} – moment ${i + 1}`, score: m.score })));
});

async function startExport(jobs) {
  if (S.exporting || !S.duration || !jobs.length) return;
  const mime = pickMime();
  if (mime === null || !HTMLCanvasElement.prototype.captureStream) {
    toast('Ce navigateur ne permet pas l\'export vidéo. Mets ton iPhone à jour (iOS 16 ou plus conseillé).', 5000);
    return;
  }
  audioGraph(video); resumeAudio(); // doit se faire pendant le toucher (règle iOS)
  S.exporting = true; S.abort = false; S.abortReason = ''; S.previewSel = false;
  openExportSheet(jobs.length);
  let wake = null;
  try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }

  const vw = video.videoWidth, vh = video.videoHeight;
  const { W, H } = outputSize(vw, vh, S.edit.format, S.edit.resolution);
  const cv = $('#exp-canvas');
  cv.width = W; cv.height = H;
  const draw = createRenderer(cv.getContext('2d'), W, H);
  const opts = { ...S.edit };
  const bitrate = bitrateFor(W, H, S.edit.quality);
  const made = [];
  try {
    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      if (jobs.length > 1) { $('#exp-batch').textContent = `Clip ${j + 1} sur ${jobs.length} · ${esc(job.title)}`; }
      const r = await recordSegment({
        video, canvas: cv, draw: () => draw(video, opts), start: job.start, end: job.end, mime, bitrate,
        shouldAbort: () => S.abort,
        onProgress: (p, el) => {
          const tot = (j + p) / jobs.length;
          $('#exp-bar').style.width = (tot * 100).toFixed(1) + '%';
          $('#exp-status').textContent = `Encodage ${fmt(el)} / ${fmt(job.end - job.start)} · ${Math.round(tot * 100)} %`;
        },
      });
      const clip = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: job.title.slice(0, 80), blob: r.blob, type: r.type, size: r.blob.size, thumb: r.thumb,
        duration: r.duration, width: r.width, height: r.height, format: opts.format, fit: opts.fit,
        favorite: false, score: job.score ?? null,
        source: S.file ? S.file.name : '', start: job.start, end: job.end, createdAt: Date.now(),
      };
      try { await Clips.put(clip); S.clips.unshift(clip); }
      catch (e) { toast('Stockage plein : enregistre ce clip dans Fichiers tout de suite.', 5000); }
      made.push(clip);
    }
    requestPersist();
    lastExport = made[made.length - 1];
    showExportDone(lastExport, made.length);
  } catch (e) {
    $('#exp-title').textContent = made.length ? `Export arrêté (${made.length} clip(s) gardé(s))` : 'Export interrompu';
    $('#exp-status').textContent = e.message === '__abort__' ? (S.abortReason || 'Export annulé.') : humanError(e);
    $('#exp-status').classList.add('err');
    $('#exp-cancel').textContent = 'Fermer';
  } finally {
    S.exporting = false;
    if (wake) wake.release().catch(() => {});
  }
}
function openExportSheet(n) {
  $('#exp-title').textContent = n > 1 ? `Export de ${n} clips…` : 'Export en cours…';
  $('#exp-batch').classList.toggle('hidden', n < 2);
  $('#exp-status').textContent = 'Préparation…';
  $('#exp-status').classList.remove('err');
  $('#exp-bar').style.width = '0%';
  $('#exp-canvas').classList.remove('hidden');
  $('#exp-result').classList.add('hidden');
  $('#exp-running').classList.remove('hidden');
  $('#exp-done').classList.add('hidden');
  $('#exp-cancel').textContent = 'Annuler';
  expSheet.classList.remove('hidden');
}
function showExportDone(clip, n) {
  $('#exp-title').textContent = n > 1 ? `✓ ${n} clips prêts` : '✓ Clip prêt';
  $('#exp-batch').textContent = n > 1 ? 'Tous les clips sont dans l\'onglet Clips. Voici le dernier :' : '';
  $('#exp-bar').style.width = '100%';
  $('#exp-status').textContent = `${clip.type.includes('mp4') ? 'MP4' : 'WebM'} · ${clip.width}×${clip.height} · ${fmtDur(clip.duration)} · ${fmtSize(clip.size)}`;
  if (expResultUrl) URL.revokeObjectURL(expResultUrl);
  expResultUrl = URL.createObjectURL(clip.blob);
  const rv = $('#exp-result');
  rv.src = expResultUrl;
  rv.classList.remove('hidden');
  $('#exp-canvas').classList.add('hidden');
  $('#exp-running').classList.add('hidden');
  $('#exp-done').classList.remove('hidden');
}
$('#exp-cancel').addEventListener('click', () => {
  if (S.exporting) { S.abort = true; S.abortReason = 'Export annulé.'; } else closeExportSheet();
});
$('#exp-close').addEventListener('click', closeExportSheet);
$('#exp-save').addEventListener('click', () => lastExport && saveClip(lastExport, true));
$('#exp-download').addEventListener('click', () => lastExport && saveClip(lastExport, false));
function closeExportSheet() {
  const rv = $('#exp-result');
  rv.pause(); rv.removeAttribute('src'); rv.load();
  if (expResultUrl) { URL.revokeObjectURL(expResultUrl); expResultUrl = null; }
  const cv = $('#exp-canvas'); cv.width = cv.height = 2; // libère la mémoire du canvas
  expSheet.classList.add('hidden');
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.exporting) {
    S.abort = true;
    S.abortReason = 'Export interrompu : Safari est passé en arrière-plan. Reste sur l\'app pendant l\'export, puis relance.';
  }
});

/* ---------- Enregistrement vers Fichiers / Photos ---------- */
function fileNameFor(c) {
  const base = (c.title || 'clip').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'clip';
  const fmtTag = c.format && c.format !== 'original' ? '-' + c.format.replace(':', 'x') : '';
  return `${base}${fmtTag}-viceclip.${c.type.includes('mp4') ? 'mp4' : 'webm'}`;
}
function saveClip(c, preferShare) {
  // Appel direct dans le toucher : obligatoire pour le partage iOS
  const file = new File([c.blob], fileNameFor(c), { type: c.type });
  if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch(e => { if (e.name !== 'AbortError') toast('Partage impossible : utilise « Télécharger dans Fichiers ».', 4000); });
    return;
  }
  const u = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = u; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
  toast('Téléchargement lancé → Fichiers › Téléchargements');
}

/* ================= BIBLIOTHÈQUE ================= */
function cardHTML(c) {
  const d = new Date(c.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const fmtLabel = c.format && c.format !== 'original' ? `<span class="fmt">${esc(c.format)}</span>` : '';
  return `<div class="clip-card" data-id="${esc(c.id)}" role="button" tabindex="0" aria-label="${esc(c.title)}">
    <div class="th" style="background-image:url('${c.thumb && c.thumb.startsWith('data:image/') ? c.thumb : ''}')">
      <button class="fav ${c.favorite ? 'on' : ''}" data-fav="${esc(c.id)}" aria-label="Favori">${c.favorite ? '★' : '☆'}</button>
      ${fmtLabel}<em>${fmtShort(c.duration)}</em></div>
    <div class="tx"><b>${esc(c.title)}</b><small>${d} · ${fmtSize(c.size)}</small></div></div>`;
}
function bindCards(root) {
  root.onclick = e => {
    const f = e.target.closest('[data-fav]');
    if (f) { e.stopPropagation(); toggleFav(f.dataset.fav); return; }
    const card = e.target.closest('.clip-card');
    if (card) openClip(card.dataset.id);
  };
  root.onkeydown = e => { const card = e.target.closest('.clip-card'); if (card && e.key === 'Enter') openClip(card.dataset.id); };
}
function filteredClips() {
  const q = S.lib.q.trim().toLowerCase();
  let list = S.clips.filter(c => {
    if (S.lib.filter === 'fav' && !c.favorite) return false;
    if (['9:16', '1:1', '16:9'].includes(S.lib.filter) && c.format !== S.lib.filter) return false;
    return !q || (c.title + ' ' + (c.source || '')).toLowerCase().includes(q);
  });
  const sorters = { new: (a, b) => b.createdAt - a.createdAt, old: (a, b) => a.createdAt - b.createdAt, long: (a, b) => b.duration - a.duration, az: (a, b) => a.title.localeCompare(b.title, 'fr') };
  return list.sort(sorters[S.lib.sort]);
}
function renderLibrary() {
  const g = $('#library-grid'), list = filteredClips();
  setChips('libfilter', S.lib.filter);
  g.innerHTML = list.length ? list.map(cardHTML).join('')
    : `<div class="empty-lib">${S.clips.length ? 'Aucun clip ne correspond à ta recherche.' : 'Aucun clip pour l\'instant.<br>Va dans « Créer » pour faire le premier.'}</div>`;
  bindCards(g);
}
$('#lib-q').addEventListener('input', e => { S.lib.q = e.target.value; renderLibrary(); });
$('#lib-sort').addEventListener('change', e => { S.lib.sort = e.target.value; renderLibrary(); });
chipHandlers.libfilter = v => { S.lib.filter = v; renderLibrary(); };

async function toggleFav(id) {
  const c = S.clips.find(x => x.id === id);
  if (!c) return;
  c.favorite = !c.favorite;
  try { await Clips.put(c); } catch (e) { toast(humanError(e)); }
  refreshAll();
  if (S.current === c) $('#cs-fav').textContent = c.favorite ? '★ Favori' : '☆ Favori';
}
function refreshAll() {
  if (currentView === 'library') renderLibrary();
  if (currentView === 'home') renderHome();
  if (currentView === 'profile') renderProfile();
}

const clipSheet = $('#clip-sheet');
let csUrl = null;
function openClip(id) {
  const c = S.clips.find(x => x.id === id);
  if (!c) return;
  S.current = c;
  $('#cs-title').textContent = c.title;
  $('#cs-fav').textContent = c.favorite ? '★ Favori' : '☆ Favori';
  $('#cs-meta').textContent = `${c.type.includes('mp4') ? 'MP4' : 'WebM'} · ${c.width}×${c.height} · ${fmtDur(c.duration)} · ${fmtSize(c.size)}`
    + (c.source ? ` · source : ${c.source} (${fmtShort(c.start)} → ${fmtShort(c.end)})` : '');
  if (csUrl) URL.revokeObjectURL(csUrl);
  csUrl = URL.createObjectURL(c.blob);
  $('#cs-video').src = csUrl;
  clipSheet.classList.remove('hidden');
}
function closeClip() {
  const v = $('#cs-video');
  v.pause(); v.removeAttribute('src'); v.load();
  if (csUrl) { URL.revokeObjectURL(csUrl); csUrl = null; }
  clipSheet.classList.add('hidden');
  S.current = null;
}
$('#cs-close').addEventListener('click', closeClip);
clipSheet.addEventListener('click', e => { if (e.target === clipSheet) closeClip(); });
$('#cs-save').addEventListener('click', () => S.current && saveClip(S.current, true));
$('#cs-download').addEventListener('click', () => S.current && saveClip(S.current, false));
$('#cs-fav').addEventListener('click', () => S.current && toggleFav(S.current.id));
$('#cs-rename').addEventListener('click', async () => {
  const c = S.current; if (!c) return;
  const t = prompt('Nouveau titre', c.title);
  if (t === null || !t.trim()) return;
  c.title = t.trim().slice(0, 80);
  try { await Clips.put(c); } catch (e) { toast(humanError(e)); }
  $('#cs-title').textContent = c.title;
  refreshAll();
});
$('#cs-delete').addEventListener('click', async () => {
  const c = S.current; if (!c) return;
  if (!confirm(`Supprimer « ${c.title} » ?`)) return;
  try { await Clips.del(c.id); } catch (e) { toast(humanError(e)); return; }
  S.clips = S.clips.filter(x => x.id !== c.id);
  closeClip(); refreshAll();
  toast('Clip supprimé');
});

/* ================= ACCUEIL / PROFIL / IA / RÉGLAGES ================= */
function totals() {
  return {
    n: S.clips.length,
    dur: S.clips.reduce((a, c) => a + (c.duration || 0), 0),
    size: S.clips.reduce((a, c) => a + (c.size || 0), 0),
    fav: S.clips.filter(c => c.favorite).length,
  };
}
function renderHome() {
  const t = totals();
  $('#st-count').textContent = t.n; $('#st-dur').textContent = fmtDur(t.dur); $('#st-fav').textContent = t.fav;
  $('#hello').textContent = settings.creatorName ? 'Salut ' + settings.creatorName : 'Studio de clips';
  const g = $('#home-recent');
  g.innerHTML = t.n ? S.clips.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 4).map(cardHTML).join('')
    : '<div class="empty-lib">Tes clips exportés apparaîtront ici.</div>';
  bindCards(g);
  const on = AI_MODULES.filter(m => m.status === 'available').length;
  $('#ai-summary').innerHTML = `<div><span>Modules actifs (locaux, gratuits)</span><b style="color:var(--ok)">${on}</b></div>
    <div><span>Modules prévus (serveur)</span><b>${AI_MODULES.length - on}</b></div>`;
  renderCompat();
}
function renderProfile() {
  const t = totals(), name = settings.creatorName || 'Créateur';
  $('#pf-name').textContent = name; $('#avatar').textContent = name.trim()[0].toUpperCase();
  $('#pf-input').value = settings.creatorName;
  $('#pf-count').textContent = t.n; $('#pf-dur').textContent = fmtDur(t.dur); $('#pf-size').textContent = fmtSize(t.size);
}
$('#pf-input').addEventListener('change', e => {
  settings.creatorName = e.target.value.trim().slice(0, 40);
  saveSettings(settings); renderProfile(); toast('Pseudo enregistré');
});
function renderAI() {
  $('#ai-list').innerHTML = AI_MODULES.map(m => `
    <div class="ai-item ${m.status === 'available' ? 'on' : ''}">
      <h4>${esc(m.name)} ${m.status === 'available' ? '<span class="badge ok">Disponible</span>' : `<span class="badge">Phase ${esc(m.phase)}</span>`}</h4>
      <p><b>Où :</b> ${esc(m.where)} · <b>Coût :</b> ${esc(m.cost)}</p>${m.desc ? `<p>${esc(m.desc)}</p>` : ''}</div>`).join('');
}
async function renderSettings() {
  for (const k of ['format', 'fit', 'resolution', 'quality', 'clipLength', 'suggestions']) setChips('set-' + k, settings[k]);
  $('#app-version').textContent = 'v' + VERSION;
  const info = await storageInfo();
  const t = totals();
  $('#storage-info').textContent = info
    ? `${t.n} clip(s) · ${fmtSize(t.size)} de vidéos. Espace utilisé par l'app : ${fmtSize(info.usage)} sur ${fmtSize(info.quota)} disponibles. ${info.persisted ? 'Protection activée ✓' : 'iOS peut effacer ces données si l\'espace manque ou après plusieurs semaines sans utilisation.'}`
    : `${t.n} clip(s) · ${fmtSize(t.size)} de vidéos.`;
}
for (const k of ['format', 'fit', 'resolution', 'quality', 'clipLength', 'suggestions']) {
  chipHandlers['set-' + k] = v => { settings[k] = ['resolution', 'clipLength', 'suggestions'].includes(k) ? +v : v; saveSettings(settings); toast('Réglage enregistré'); };
}
$('#btn-persist').addEventListener('click', async () => {
  const ok = await requestPersist();
  toast(ok ? 'Protection activée ✓' : 'Safari a refusé. Astuce : ajoute l\'app à l\'écran d\'accueil, puis réessaie.', 4500);
  renderSettings();
});
$('#btn-clear').addEventListener('click', async () => {
  if (!S.clips.length) { toast('La bibliothèque est déjà vide.'); return; }
  if (!confirm(`Supprimer définitivement les ${S.clips.length} clips de l'app ? (Les copies enregistrées dans Fichiers ou Photos ne sont pas touchées.)`)) return;
  try { await Clips.clear(); S.clips = []; toast('Bibliothèque vidée'); renderSettings(); }
  catch (e) { toast(humanError(e)); }
});
$('#btn-reset').addEventListener('click', () => {
  const name = settings.creatorName;
  settings = { ...DEFAULT_SETTINGS, creatorName: name };
  saveSettings(settings); renderSettings(); toast('Réglages réinitialisés');
});
$('#btn-refresh').addEventListener('click', async () => {
  try {
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  } catch (e) { /* ignore */ }
  location.reload();
});

/* ================= DÉMARRAGE ================= */
(async function init() {
  syncEditChips();
  try { S.clips = await Clips.all(); }
  catch (e) { toast('Bibliothèque inaccessible : ' + humanError(e), 5000); }
  renderHome();
  const sp = $('#splash');
  sp.classList.add('out');
  setTimeout(() => sp.remove(), 400);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
