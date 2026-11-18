/* ViceClip AI — Phase 1 : import, découpe, export MP4 réel (100 % dans le navigateur) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const even = n => Math.max(2, Math.round(n / 2) * 2);
const MIN_LEN = 0.5;   // durée minimale d'un clip (s)
const MAX_SIDE = 1920; // résolution max de l'export (côté le plus long)

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const tenths = Math.round(t * 10);
  const m = Math.floor(tenths / 600);
  const s = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return m + ':' + s;
}
function fmtDur(t) {
  t = Math.round(t || 0);
  if (t < 60) return t + ' s';
  const m = Math.floor(t / 60), s = t % 60;
  return m + ' min' + (s ? ' ' + s + ' s' : '');
}
function fmtSize(b) {
  if (!b) return '0 Mo';
  return b < 1e6 ? Math.max(1, Math.round(b / 1e3)) + ' Ko' : (b / 1e6).toFixed(b < 1e8 ? 1 : 0).replace('.', ',') + ' Mo';
}
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function once(el, ev, ms) {
  return new Promise((res, rej) => {
    let to;
    const ok = () => { cleanup(); res(); };
    const ko = () => { cleanup(); rej(new Error('Erreur de lecture vidéo')); };
    const cleanup = () => { clearTimeout(to); el.removeEventListener(ev, ok); el.removeEventListener('error', ko); };
    el.addEventListener(ev, ok);
    el.addEventListener('error', ko);
    if (ms) to = setTimeout(() => { cleanup(); rej(new Error('Délai dépassé (' + ev + ')')); }, ms);
  });
}

/* ---------------- Stockage local (IndexedDB) ---------------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('viceclip', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('clips', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction('clips', mode);
      const req = fn(tx.objectStore('clips'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Transaction annulée'));
    });
  };
  return {
    all: () => run('readonly', s => s.getAll()),
    put: c => run('readwrite', s => s.put(c)),
    del: id => run('readwrite', s => s.delete(id)),
  };
})();

/* ---------------- État ---------------- */
const S = {
  file: null, url: null, duration: 0, start: 0, end: 0,
  clips: [], exporting: false, abort: false, abortReason: '',
  previewSel: false, current: null, thumbToken: 0,
};
const video = $('#video');

/* ---------------- Navigation ---------------- */
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view !== 'editor' && !video.paused) video.pause();
  if (view === 'home') renderHome();
  if (view === 'library') renderLibrary();
  window.scrollTo(0, 0);
}
$$('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));

/* ---------------- Détection des capacités ---------------- */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ }
  }
  return '';
}
function canShareFiles() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'video/mp4' })], 't.mp4', { type: 'video/mp4' })] }));
  } catch (e) { return false; }
}
function renderCompat() {
  const mime = pickMime();
  const isMp4 = mime && mime.startsWith('video/mp4');
  const capture = !!HTMLCanvasElement.prototype.captureStream;
  const items = [
    ['Enregistreur vidéo (MediaRecorder)', mime === null ? ['ko', 'Absent'] : ['ok', 'OK']],
    ['Export au format MP4', isMp4 ? ['ok', 'OK'] : mime ? ['meh', 'WebM seulement'] : ['ko', 'Non']],
    ['Capture du rendu (canvas)', capture ? ['ok', 'OK'] : ['ko', 'Non']],
    ['Partage vers Fichiers / Photos', canShareFiles() ? ['ok', 'OK'] : ['meh', 'Téléchargement seul']],
    ['Écran maintenu allumé', 'wakeLock' in navigator ? ['ok', 'OK'] : ['meh', 'Garde l\'écran actif']],
  ];
  $('#compat').innerHTML = items.map(([l, [c, v]]) => `<li><span>${l}</span><span class="${c}">${v}</span></li>`).join('');
}

/* ---------------- Import ---------------- */
function onPick(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) loadFile(f);
}
$('#file-input').addEventListener('change', onPick);
$('#file-input-2').addEventListener('change', onPick);

function loadFile(file) {
  const okType = /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
  if (!okType) { toast('Format non pris en charge. Utilise MP4, MOV ou WebM.'); return; }
  if (S.url) URL.revokeObjectURL(S.url);
  S.file = file;
  S.url = URL.createObjectURL(file);
  S.duration = 0;
  video.src = S.url;
  video.load();
  $('#file-name').textContent = file.name || 'Vidéo';
  $('#file-meta').textContent = fmtSize(file.size);
  $('#clip-title').value = (file.name || 'Clip').replace(/\.[^.]+$/, '').slice(0, 80);
  $('#editor-empty').classList.add('hidden');
  $('#editor-main').classList.remove('hidden');
  $('#big-play').classList.remove('hidden');
  show('editor');
}

video.addEventListener('loadedmetadata', async () => {
  let d = video.duration;
  if (!isFinite(d)) { // certains WebM n'annoncent pas leur durée
    video.currentTime = 1e9;
    try { await once(video, 'durationchange', 4000); } catch (e) { /* ignore */ }
    d = video.duration;
    video.currentTime = 0;
  }
  if (!isFinite(d) || d <= 0) { toast('Durée de la vidéo illisible.'); return; }
  S.duration = d;
  S.start = 0;
  S.end = Math.min(d, 30);
  $('#total-time').textContent = fmt(d);
  $('#file-meta').textContent = `${fmtDur(d)} · ${video.videoWidth}×${video.videoHeight} · ${fmtSize(S.file.size)}`;
  if (video.currentTime === 0) video.currentTime = 0.001; // force l'affichage de la 1re image sur iOS
  renderRange();
  makeThumbs();
});
video.addEventListener('error', () => {
  if (video.src) toast('Cette vidéo ne peut pas être lue par Safari sur cet appareil.', 4000);
});

/* ---------------- Miniatures de la timeline ---------------- */
async function makeThumbs() {
  const token = ++S.thumbToken;
  const box = $('#thumbs');
  const n = 8;
  box.innerHTML = '<div></div>'.repeat(n);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
  v.src = S.url;
  try {
    v.play().then(() => v.pause()).catch(() => {});
    if (v.readyState < 2) await once(v, 'loadeddata', 6000);
    v.pause();
    const c = document.createElement('canvas');
    c.height = 72;
    c.width = Math.round(72 * (v.videoWidth / v.videoHeight || 16 / 9));
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) {
      if (token !== S.thumbToken) return;
      const p = once(v, 'seeked', 5000);
      v.currentTime = ((i + 0.5) / n) * S.duration;
      await p;
      g.drawImage(v, 0, 0, c.width, c.height);
      box.children[i].style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.6)})`;
    }
  } catch (e) { /* miniatures facultatives */ }
  finally { v.removeAttribute('src'); v.load(); }
}

/* ---------------- Lecture ---------------- */
let AG = null; // graphe audio (créé au premier export)
function resumeAudio() { if (AG && AG.ctx.state !== 'running') AG.ctx.resume().catch(() => {}); }

function togglePlay() {
  if (S.exporting || !S.duration) return;
  resumeAudio();
  S.previewSel = false;
  if (video.paused) video.play().catch(err => toast('Lecture impossible : ' + err.message));
  else video.pause();
}
$('#btn-play').addEventListener('click', togglePlay);
$('#big-play').addEventListener('click', togglePlay);
video.addEventListener('click', togglePlay);
$('#btn-preview-sel').addEventListener('click', async () => {
  if (S.exporting || !S.duration) return;
  resumeAudio();
  video.currentTime = S.start;
  S.previewSel = true;
  video.play().catch(err => toast('Lecture impossible : ' + err.message));
});

const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>';
video.addEventListener('play', () => { $('#btn-play').innerHTML = PAUSE_ICON; $('#big-play').classList.add('hidden'); tick(); });
video.addEventListener('pause', () => { $('#btn-play').innerHTML = PLAY_ICON; if (!S.exporting) $('#big-play').classList.remove('hidden'); });
video.addEventListener('timeupdate', updatePlayhead);
video.addEventListener('seeked', updatePlayhead);

function tick() {
  updatePlayhead();
  if (S.previewSel && video.currentTime >= S.end) { video.pause(); S.previewSel = false; }
  if (!video.paused) requestAnimationFrame(tick);
}
function updatePlayhead() {
  $('#cur-time').textContent = fmt(video.currentTime);
  if (S.duration) $('#playhead').style.left = (video.currentTime / S.duration * 100) + '%';
}

/* ---------------- Sélection du passage ---------------- */
const pct = t => (S.duration ? (t / S.duration) * 100 : 0) + '%';
function renderRange() {
  $('#h-start').style.left = pct(S.start);
  $('#h-end').style.left = pct(S.end);
  $('#sel').style.left = pct(S.start);
  $('#sel').style.width = pct(S.end - S.start);
  $('#dim-left').style.width = pct(S.start);
  $('#dim-right').style.width = pct(S.duration - S.end);
  $('#tc-start').textContent = fmt(S.start);
  $('#tc-end').textContent = fmt(S.end);
  const d = S.end - S.start;
  $('#sel-dur').textContent = d.toFixed(1).replace('.', ',') + ' s';
  const h = $('#sel-hint');
  h.className = '';
  if (d < 15) h.textContent = '· court pour TikTok (idéal : 15–60 s)';
  else if (d > 60) h.textContent = '· plus de 60 s, export plus long';
  else { h.textContent = '· ✓ durée idéale TikTok'; h.className = 'good'; }
}
function setStart(t) { S.start = clamp(t, 0, Math.max(0, S.end - MIN_LEN)); }
function setEnd(t) { S.end = clamp(t, S.start + MIN_LEN, S.duration); }

const timeline = $('#timeline');
let drag = null, seekRaf = 0, seekTarget = 0;
function timeFromX(x) {
  const r = timeline.getBoundingClientRect();
  return clamp((x - r.left) / r.width, 0, 1) * S.duration;
}
function scheduleSeek(t) {
  seekTarget = t;
  if (seekRaf) return;
  seekRaf = requestAnimationFrame(() => { seekRaf = 0; video.currentTime = seekTarget; });
}
timeline.addEventListener('pointerdown', e => {
  if (!S.duration || S.exporting) return;
  e.preventDefault();
  const r = timeline.getBoundingClientRect();
  const xs = r.left + (S.start / S.duration) * r.width;
  const xe = r.left + (S.end / S.duration) * r.width;
  const ds = Math.abs(e.clientX - xs), de = Math.abs(e.clientX - xe);
  if (Math.min(ds, de) < 24) drag = ds <= de ? 'start' : 'end';
  else drag = 'seek';
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
  S.end = S.start + n;
  renderRange();
}));

/* ---------------- Moteur d'export ----------------
   La vidéo est lue du point de début au point de fin, chaque image est dessinée
   sur un canvas, et MediaRecorder encode le canvas + l'audio en MP4 (H.264/AAC)
   avec l'encodeur matériel de l'iPhone. Résultat : un vrai fichier, sans filigrane. */
function audioGraph() {
  if (AG) return AG;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC();
    const src = ctx.createMediaElementSource(video);
    const monitor = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    src.connect(monitor); monitor.connect(ctx.destination); // ce que tu entends
    src.connect(dest);                                       // ce qui est enregistré
    AG = { ctx, monitor, dest };
  } catch (e) { console.warn('Audio indisponible', e); AG = null; }
  return AG;
}

function makeThumb(src) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = Math.round(320 * src.height / src.width);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

async function recordSegment(mime, onProgress) {
  const v = video, start = S.start, end = S.end, len = end - start;
  v.pause();
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) throw new Error('La vidéo n\'est pas encore prête.');
  const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
  const W = even(vw * scale), H = even(vh * scale);
  const cv = $('#exp-canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  if (Math.abs(v.currentTime - start) > 0.01) {
    const p = once(v, 'seeked', 10000);
    v.currentTime = start;
    await p;
  }
  g.drawImage(v, 0, 0, W, H);

  const vStream = cv.captureStream(30);
  const tracks = [...vStream.getVideoTracks()];
  const ag = AG;
  if (ag) {
    await ag.ctx.resume().catch(() => {});
    ag.monitor.gain.value = 0; // export silencieux
    tracks.push(...ag.dest.stream.getAudioTracks());
  }
  const stream = new MediaStream(tracks);
  const opts = { videoBitsPerSecond: Math.round(clamp(W * H * 30 * 0.12, 4e6, 12e6)), audioBitsPerSecond: 160000 };
  if (mime) opts.mimeType = mime;
  const rec = new MediaRecorder(stream, opts);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res, rej) => {
    rec.onstop = res;
    rec.onerror = e => rej(e.error || new Error('Erreur de l\'enregistreur'));
  });

  let done = false, thumb = null;
  const finish = () => {
    if (done) return;
    done = true;
    v.pause();
    if (rec.state !== 'inactive') rec.stop();
  };
  const useRVFC = 'requestVideoFrameCallback' in v;
  const draw = () => {
    if (done) return;
    g.drawImage(v, 0, 0, W, H);
    const t = v.currentTime;
    onProgress(clamp((t - start) / len, 0, 1), t - start);
    if (!thumb && t - start >= Math.min(1, len / 2)) thumb = makeThumb(cv);
    if (S.abort || t >= end || v.ended) return finish();
    useRVFC ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
  };
  const guard = setInterval(() => { if (S.abort || v.currentTime >= end || v.ended) finish(); }, 50);

  try {
    await v.play();
  } catch (err) {
    clearInterval(guard);
    throw new Error('Lecture impossible : ' + err.message);
  }
  rec.start(1000);
  draw();
  try { await stopped; }
  finally {
    clearInterval(guard);
    vStream.getVideoTracks().forEach(t => t.stop());
    if (ag) ag.monitor.gain.value = 1;
  }
  if (S.abort) throw new Error(S.abortReason || 'Export annulé.');
  const type = (rec.mimeType || mime || 'video/mp4').split(';')[0];
  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new Error('Le fichier produit est vide.');
  return { blob, type, thumb: thumb || makeThumb(cv), width: W, height: H, duration: len };
}

const expSheet = $('#export-sheet');
let lastExport = null, expResultUrl = null;

$('#btn-export').addEventListener('click', async () => {
  if (S.exporting || !S.duration) return;
  const mime = pickMime();
  if (mime === null || !HTMLCanvasElement.prototype.captureStream) {
    toast('Ce navigateur ne permet pas l\'export vidéo. Mets iOS à jour (iOS 14.5 minimum, 16+ conseillé).', 5000);
    return;
  }
  audioGraph(); // doit être créé pendant le toucher de l'utilisateur (règle iOS)
  resumeAudio();
  S.exporting = true; S.abort = false; S.abortReason = '';
  S.previewSel = false;
  openExportSheet();
  let wake = null;
  try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }

  try {
    const r = await recordSegment(mime, (p, el) => {
      $('#exp-bar').style.width = (p * 100).toFixed(1) + '%';
      $('#exp-status').textContent = `Encodage ${fmt(el)} / ${fmt(S.end - S.start)} · ${Math.round(p * 100)} %`;
    });
    const title = ($('#clip-title').value || 'Clip').trim();
    const clip = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title, blob: r.blob, type: r.type, size: r.blob.size, thumb: r.thumb,
      duration: r.duration, width: r.width, height: r.height,
      source: S.file ? S.file.name : '', start: S.start, end: S.end, createdAt: Date.now(),
    };
    lastExport = clip;
    try {
      await DB.put(clip);
      S.clips.unshift(clip);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      toast('Stockage Safari plein : enregistre le clip dans Fichiers maintenant.', 5000);
    }
    showExportDone(clip);
  } catch (e) {
    $('#exp-title').textContent = 'Export interrompu';
    $('#exp-status').textContent = e.message || String(e);
    $('#exp-status').classList.add('err');
    $('#exp-cancel').textContent = 'Fermer';
  } finally {
    S.exporting = false;
    if (wake) wake.release().catch(() => {});
  }
});

function openExportSheet() {
  $('#exp-title').textContent = 'Export en cours…';
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
function showExportDone(clip) {
  $('#exp-title').textContent = '✓ Clip prêt';
  $('#exp-bar').style.width = '100%';
  const ext = clip.type.includes('mp4') ? 'MP4' : 'WebM';
  $('#exp-status').textContent = `${ext} · ${clip.width}×${clip.height} · ${fmtDur(clip.duration)} · ${fmtSize(clip.size)}`;
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
  if (S.exporting) { S.abort = true; S.abortReason = 'Export annulé.'; }
  else closeExportSheet();
});
$('#exp-close').addEventListener('click', closeExportSheet);
$('#exp-save').addEventListener('click', () => lastExport && saveClip(lastExport, true));
$('#exp-download').addEventListener('click', () => lastExport && saveClip(lastExport, false));
function closeExportSheet() {
  const rv = $('#exp-result');
  rv.pause(); rv.removeAttribute('src'); rv.load();
  expSheet.classList.add('hidden');
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.exporting) {
    S.abort = true;
    S.abortReason = 'Export interrompu : Safari est passé en arrière-plan. Reste sur l\'app pendant l\'export, puis relance.';
  }
});

/* ---------------- Enregistrement vers Fichiers / Photos ---------------- */
function fileNameFor(clip) {
  const base = (clip.title || 'clip').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'clip';
  return `${base}-viceclip.${clip.type.includes('mp4') ? 'mp4' : 'webm'}`;
}
function saveClip(clip, preferShare) {
  // Appelé directement dans le toucher : obligatoire pour navigator.share sur iOS
  const file = new File([clip.blob], fileNameFor(clip), { type: clip.type });
  if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch(e => {
      if (e.name !== 'AbortError') toast('Partage impossible, utilise « Télécharger dans Fichiers ».', 4000);
    });
    return;
  }
  const u = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = u; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
  toast('Téléchargement lancé → Fichiers › Téléchargements');
}

/* ---------------- Bibliothèque ---------------- */
function cardHTML(c) {
  const d = new Date(c.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return `<button class="clip-card" data-id="${c.id}">
    <div class="th" style="background-image:url(${c.thumb || ''})"><em>${fmt(c.duration).replace(/\.\d$/, '')}</em></div>
    <div class="tx"><b>${esc(c.title)}</b><small>${d} · ${fmtSize(c.size)}</small></div></button>`;
}
function bindCards(root) {
  $$('.clip-card', root).forEach(el => el.addEventListener('click', () => openClip(el.dataset.id)));
}
function renderLibrary() {
  const g = $('#library-grid');
  g.innerHTML = S.clips.length ? S.clips.map(cardHTML).join('')
    : '<div class="empty-lib">Aucun clip pour l\'instant.<br>Va dans l\'éditeur pour créer le premier.</div>';
  bindCards(g);
}
async function renderHome() {
  const total = S.clips.reduce((a, c) => a + (c.duration || 0), 0);
  const size = S.clips.reduce((a, c) => a + (c.size || 0), 0);
  $('#st-count').textContent = S.clips.length;
  $('#st-dur').textContent = fmtDur(total);
  $('#st-size').textContent = fmtSize(size);
  const g = $('#home-recent');
  g.innerHTML = S.clips.length ? S.clips.slice(0, 4).map(cardHTML).join('')
    : '<div class="empty-lib">Tes clips exportés apparaîtront ici.</div>';
  bindCards(g);
  renderCompat();
}

const clipSheet = $('#clip-sheet');
let csUrl = null;
function openClip(id) {
  const c = S.clips.find(x => x.id === id);
  if (!c) return;
  S.current = c;
  $('#cs-title').textContent = c.title;
  $('#cs-meta').textContent = `${c.type.includes('mp4') ? 'MP4' : 'WebM'} · ${c.width}×${c.height} · ${fmtDur(c.duration)} · ${fmtSize(c.size)}`
    + (c.source ? ` · source : ${c.source} (${fmt(c.start)} → ${fmt(c.end)})` : '');
  if (csUrl) URL.revokeObjectURL(csUrl);
  csUrl = URL.createObjectURL(c.blob);
  $('#cs-video').src = csUrl;
  clipSheet.classList.remove('hidden');
}
function closeClip() {
  const v = $('#cs-video');
  v.pause(); v.removeAttribute('src'); v.load();
  clipSheet.classList.add('hidden');
}
$('#cs-close').addEventListener('click', closeClip);
clipSheet.addEventListener('click', e => { if (e.target === clipSheet) closeClip(); });
$('#cs-save').addEventListener('click', () => S.current && saveClip(S.current, true));
$('#cs-download').addEventListener('click', () => S.current && saveClip(S.current, false));
$('#cs-rename').addEventListener('click', async () => {
  const c = S.current; if (!c) return;
  const t = prompt('Nouveau titre', c.title);
  if (t === null || !t.trim()) return;
  c.title = t.trim().slice(0, 80);
  await DB.put(c).catch(() => toast('Impossible d\'enregistrer le titre.'));
  $('#cs-title').textContent = c.title;
  renderLibrary(); renderHome();
});
$('#cs-delete').addEventListener('click', async () => {
  const c = S.current; if (!c) return;
  if (!confirm(`Supprimer « ${c.title} » de la bibliothèque ?`)) return;
  await DB.del(c.id).catch(() => {});
  S.clips = S.clips.filter(x => x.id !== c.id);
  closeClip(); renderLibrary(); renderHome();
  toast('Clip supprimé');
});

/* ---------------- Démarrage ---------------- */
(async function init() {
  try {
    S.clips = (await DB.all()).sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) { console.warn(e); }
  renderHome();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
