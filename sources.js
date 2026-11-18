/* sources.js — reconnaissance des liens YouTube / Twitch / Kick / TikTok.
   ViceClip ne télécharge AUCUNE vidéo depuis ces plateformes : elles l'interdisent
   ou le bloquent techniquement. On affiche les infos publiques quand elles sont
   accessibles, puis on guide vers l'import du fichier original. */

export const PLATFORMS = {
  youtube: {
    name: 'YouTube', color: '#ff3b3b',
    howto: [
      'Si c\'est ta vidéo : ouvre YouTube Studio dans Safari (studio.youtube.com, « Version pour ordinateur »), Contenu › ⋮ › Télécharger.',
      'Le fichier arrive dans Fichiers › Téléchargements : importe-le ensuite dans ViceClip.',
      'Pour la vidéo d\'un autre créateur, il te faut son fichier et son autorisation.',
    ],
    why: 'YouTube interdit le téléchargement en dehors de ses propres outils et bloque l\'accès direct au fichier depuis un autre site.',
  },
  twitch: {
    name: 'Twitch', color: '#a970ff',
    howto: [
      'Si c\'est ton live : Tableau de bord créateur › Contenu › Gestionnaire de vidéos › ⋮ › Télécharger (VOD).',
      'Pour un clip de ta chaîne : Gestionnaire de clips › Télécharger.',
      'Les VOD sont supprimées au bout de quelques jours selon ton statut Twitch : télécharge-les vite.',
    ],
    why: 'Twitch ne fournit pas le fichier vidéo aux sites tiers ; seul le propriétaire de la chaîne peut télécharger ses VOD.',
  },
  kick: {
    name: 'Kick', color: '#53fc18',
    howto: [
      'Si c\'est ton live : utilise l\'option de téléchargement de ton tableau de bord Kick si elle t\'est proposée.',
      'Sinon, garde un enregistrement local de tes lives (enregistrement OBS ou de ton appareil de capture).',
      'Importe ensuite ce fichier dans ViceClip.',
    ],
    why: 'Kick ne propose pas d\'accès public au fichier vidéo pour les applications tierces.',
  },
  tiktok: {
    name: 'TikTok', color: '#25f4ee',
    howto: [
      'Pour tes propres vidéos : utilise le fichier original de ta pellicule (sans filigrane).',
      'Une vidéo enregistrée depuis l\'app TikTok contient un filigrane et n\'est pas faite pour être republiée.',
    ],
    why: 'TikTok ne fournit pas le fichier aux sites tiers ; réutiliser la vidéo d\'un autre créateur nécessite son accord.',
  },
};

const YT_ID = /^[\w-]{11}$/;

export function parseVideoUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, '');
  const parts = u.pathname.split('/').filter(Boolean);

  // YouTube
  if (host === 'youtu.be' && YT_ID.test(parts[0] || '')) return yt(parts[0], u);
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const v = u.searchParams.get('v');
    if (v && YT_ID.test(v)) return yt(v, u);
    if (['shorts', 'live', 'embed'].includes(parts[0]) && YT_ID.test(parts[1] || '')) return yt(parts[1], u, parts[0]);
    return { platform: 'youtube', kind: 'page', id: null, url: u.href, label: 'Page YouTube (pas une vidéo précise)' };
  }
  // Twitch
  if (host === 'clips.twitch.tv' && parts[0]) return { platform: 'twitch', kind: 'clip', id: parts[0], url: u.href, label: 'Clip Twitch' };
  if (host === 'twitch.tv') {
    if (parts[0] === 'videos' && /^\d+$/.test(parts[1] || '')) return { platform: 'twitch', kind: 'vod', id: parts[1], url: u.href, label: 'VOD Twitch n°' + parts[1] };
    if (parts[1] === 'clip' && parts[2]) return { platform: 'twitch', kind: 'clip', id: parts[2], channel: parts[0], url: u.href, label: 'Clip de ' + parts[0] };
    if (parts[0]) return { platform: 'twitch', kind: 'channel', id: parts[0], channel: parts[0], url: u.href, label: 'Chaîne ' + parts[0] + ' (live)' };
  }
  // Kick
  if (host === 'kick.com' && parts[0]) {
    const channel = parts[0];
    if (parts[1] === 'videos' && parts[2]) return { platform: 'kick', kind: 'vod', id: parts[2], channel, url: u.href, label: 'VOD de ' + channel };
    if (parts[1] === 'clips' && parts[2]) return { platform: 'kick', kind: 'clip', id: parts[2], channel, url: u.href, label: 'Clip de ' + channel };
    if (u.searchParams.get('clip')) return { platform: 'kick', kind: 'clip', id: u.searchParams.get('clip'), channel, url: u.href, label: 'Clip de ' + channel };
    return { platform: 'kick', kind: 'channel', id: channel, channel, url: u.href, label: 'Chaîne ' + channel + ' (live)' };
  }
  // TikTok
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return { platform: 'tiktok', kind: 'short', id: parts[0] || null, url: u.href, label: 'Lien TikTok court' };
  if (host === 'tiktok.com') {
    const i = parts.indexOf('video');
    if (i > 0 && /^\d+$/.test(parts[i + 1] || '')) return { platform: 'tiktok', kind: 'video', id: parts[i + 1], channel: parts[0].replace(/^@/, ''), url: u.href, label: 'Vidéo de ' + parts[0] };
    return { platform: 'tiktok', kind: 'page', id: null, url: u.href, label: 'Page TikTok' };
  }
  return { platform: null, url: u.href, label: 'Site non reconnu' };
}

function yt(id, u, sub) {
  const label = sub === 'shorts' ? 'Short YouTube' : sub === 'live' ? 'Live YouTube' : 'Vidéo YouTube';
  return {
    platform: 'youtube', kind: sub || 'video', id, url: 'https://www.youtube.com/watch?v=' + id, label,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

/* Infos publiques via oEmbed (titre, auteur, miniature).
   YouTube autorise cet appel depuis un navigateur ; TikTok peut le refuser.
   Twitch et Kick n'ont pas d'oEmbed public sans clé : on ne fait rien. */
export async function fetchPublicInfo(src, { timeout = 7000 } = {}) {
  let endpoint = null;
  if (src.platform === 'youtube' && src.id) endpoint = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(src.url);
  if (src.platform === 'tiktok' && src.kind === 'video') endpoint = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(src.url);
  if (!endpoint) return { ok: false, reason: 'Pas d\'informations publiques accessibles pour ce type de lien.' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(endpoint, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) return { ok: false, reason: r.status === 401 || r.status === 403 ? 'Vidéo privée ou intégration désactivée.' : r.status === 404 ? 'Vidéo introuvable.' : 'Plateforme injoignable (' + r.status + ').' };
    const j = await r.json();
    const thumb = typeof j.thumbnail_url === 'string' && /^https:\/\//.test(j.thumbnail_url) ? j.thumbnail_url : src.thumbnail;
    return { ok: true, title: String(j.title || '').slice(0, 200), author: String(j.author_name || '').slice(0, 100), thumbnail: thumb };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'Délai dépassé : vérifie ta connexion.' : 'La plateforme refuse la lecture de ces infos depuis un autre site.' };
  } finally { clearTimeout(t); }
}
