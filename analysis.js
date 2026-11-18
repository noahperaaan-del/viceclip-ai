/* analysis.js — Détection locale des moments forts par analyse du SON.
   100 % sur l'iPhone, gratuit, aucune donnée envoyée.
   Ce que ça repère : pics de volume, montées brutales (cris, rires, réactions,
   explosions, fusillades), passages intenses soutenus.
   Ce que ça NE fait PAS : comprendre l'image ou les paroles. */

const HOP = 0.5; // une mesure toutes les 0,5 s

function decode(buf) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('Ce navigateur ne sait pas analyser le son.');
  let ctx = null;
  for (const rate of [8000, 16000, 22050, 44100]) {
    try { ctx = new OAC(1, rate, rate); break; } catch (e) { /* taux refusé, on essaie le suivant */ }
  }
  if (!ctx) throw new Error('Analyse du son impossible sur ce navigateur.');
  return new Promise((res, rej) => {
    const fail = () => rej(new Error('Impossible de lire la piste audio (vidéo sans son ou format audio non pris en charge).'));
    try {
      const p = ctx.decodeAudioData(buf, res, fail);
      if (p && p.catch) p.catch(fail);
    } catch (e) { fail(); }
  });
}

function median(arr) {
  const a = Float32Array.from(arr).sort();
  return a.length ? a[a.length >> 1] : 0;
}

/* Mesure le niveau sonore (dB) de chaque fenêtre de 0,5 s */
export function loudnessCurve(audio) {
  const rate = audio.sampleRate, n = Math.floor(audio.duration / HOP);
  const hop = Math.round(rate * HOP);
  const chans = [];
  for (let c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const a = i * hop, b = Math.min(a + hop, chans[0].length);
    for (let k = a; k < b; k++) {
      let s = 0;
      for (const ch of chans) s += ch[k];
      s /= chans.length;
      sum += s * s;
    }
    db[i] = 10 * Math.log10(sum / Math.max(1, b - a) + 1e-10);
  }
  return db;
}

/* Choisit les meilleurs passages à partir de la courbe (testable sans navigateur) */
export function findMoments(db, duration, { clipLength = 30, count = 6 } = {}) {
  const n = db.length;
  const audible = Array.from(db).filter(x => x > -60);
  if (audible.length < n * 0.1) throw new Error('Le son est quasi silencieux : pas de moments forts détectables à l\'oreille.');
  const base = median(audible);
  const spread = Math.max(3, median(audible.map(x => Math.abs(x - base))) * 1.4826);

  // Intensité soutenue (moyenne sur 2 s) et montée brutale (vs les 6 s précédentes)
  const sustained = new Float32Array(n), onset = new Float32Array(n), score = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = i; k < Math.min(n, i + 4); k++) { s += db[k]; c++; }
    sustained[i] = s / c;
    let p = 0, pc = 0;
    for (let k = Math.max(0, i - 12); k < i - 1; k++) { p += db[k]; pc++; }
    onset[i] = pc ? db[i] - p / pc : 0;
    score[i] = 0.6 * (sustained[i] - base) / spread + 0.4 * Math.max(0, onset[i]) / spread;
  }
  const sorted = Float32Array.from(score).sort();
  const pctOf = v => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; } return lo / n; };

  const order = Array.from(score.keys()).sort((a, b) => score[b] - score[a]);
  const len = Math.min(clipLength, duration);
  const picks = [];
  for (const i of order) {
    if (picks.length >= count || score[i] < 1) break; // en dessous : rien de notable
    const t = i * HOP;
    let start = Math.max(0, t - len * 0.4);             // on garde la montée avant le pic
    let end = Math.min(duration, start + len);
    start = Math.max(0, end - len);
    const overlap = picks.some(p => Math.min(end, p.end) - Math.max(start, p.start) > len * 0.3);
    if (overlap) continue;
    // Explications
    const a = Math.floor(start / HOP), b = Math.min(n, Math.ceil(end / HOP));
    let peak = -Infinity, peakAt = t, loud = 0, maxOnset = 0;
    for (let k = a; k < b; k++) {
      if (db[k] > peak) { peak = db[k]; peakAt = k * HOP; }
      if (db[k] > base + 6) loud++;
      maxOnset = Math.max(maxOnset, onset[k]);
    }
    const reasons = [`Pic sonore à ${fmt(peakAt)} : +${Math.round(peak - base)} dB au-dessus du niveau habituel`];
    if (maxOnset >= 9) reasons.push(`Montée brutale du son (+${Math.round(maxOnset)} dB) : typique d'une réaction, d'un cri ou d'une explosion`);
    if (loud * HOP >= 4) reasons.push(`${Math.round(loud * HOP)} s de passage intense dans l'extrait`);
    picks.push({ start, end, peakAt, score: Math.round(pctOf(score[i]) * 100), raw: score[i], reasons });
  }
  // Courbe réduite (≈ 240 points, 0–1) pour l'affichage sur la timeline
  const pts = Math.min(240, n), curve = new Float32Array(pts);
  for (let j = 0; j < pts; j++) {
    const a = Math.floor(j * n / pts), b = Math.max(a + 1, Math.floor((j + 1) * n / pts));
    let m = -Infinity;
    for (let k = a; k < b; k++) m = Math.max(m, db[k]);
    curve[j] = Math.min(1, Math.max(0, (m - (base - 2 * spread)) / (5 * spread)));
  }
  return { moments: picks.sort((x, y) => y.raw - x.raw), curve, base, spread };
}

function fmt(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }

export const MAX_ANALYSIS_BYTES = 700 * 1024 * 1024;

export async function analyzeFile(file, { clipLength, count, onProgress = () => {} } = {}) {
  if (file.size > MAX_ANALYSIS_BYTES) {
    throw new Error(`Vidéo trop lourde pour l'analyse sur iPhone (${Math.round(file.size / 1048576)} Mo, maximum 700 Mo). Découpe d'abord un passage plus court, puis analyse-le.`);
  }
  onProgress(0.05, 'Lecture du fichier…');
  let buf = await file.arrayBuffer();
  onProgress(0.3, 'Décodage du son (peut prendre un moment)…');
  const audio = await decode(buf);
  buf = null;
  onProgress(0.75, 'Mesure de l\'intensité…');
  await new Promise(r => setTimeout(r, 30));
  const db = loudnessCurve(audio);
  onProgress(0.92, 'Sélection des meilleurs passages…');
  const res = findMoments(db, audio.duration, { clipLength, count });
  onProgress(1, 'Terminé');
  return res;
}
