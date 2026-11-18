# ViceClip AI v2 — Checklist de tests

## A. Tests exécutés (Chrome, écran iPhone 14, 18/11/2026)

Vidéo de test : 3 min, 1280×720, 170 Mo, avec 3 pics sonores placés à 0:40, 1:35 et 2:30.
L'app a été servie depuis un sous-dossier (`/v2/`), comme sur GitHub Pages (`/viceclip/`).

| Test | Résultat |
|---|---|
| Chargement, écran de démarrage, diagnostic de compatibilité | ✅ |
| Réglages par défaut enregistrés et conservés après rechargement | ✅ |
| Lien YouTube : détection + procédure ; infos publiques injoignables → message de repli | ✅ (repli seulement) |
| Lien Twitch : détection d'une VOD + message « pas d'infos publiques » | ✅ |
| Analyseur de liens (14 cas : YouTube, Shorts, Twitch, Kick, TikTok, liens invalides, `javascript:`) | ✅ |
| Import 170 Mo, aperçu 9:16, avertissement de résolution | ✅ |
| Cadrage au doigt dans l'aperçu | ✅ |
| Analyse sonore : 3 moments détectés à 0:41, 1:38 et 2:30 (cibles : 0:40, 1:35, 2:30), en 0,7 s | ✅ |
| Export 9:16 Recadrer 720p : MP4 H.264 720×1280, 15,0 s | ✅ (vérifié avec ffprobe) |
| Export 1:1 Fond flou 1080p : MP4 H.264 1080×1080, 5,0 s | ✅ (vérifié avec ffprobe) |
| Export en lot de 3 moments (9:16, Bandes noires) | ✅ |
| Annulation d'un export en cours | ✅ |
| Recherche, favori, filtre « 1:1 », renommage, suppression | ✅ |
| Profil (pseudo) affiché sur l'accueil après rechargement | ✅ |
| Service worker actif (mode hors ligne) | ✅ |
| Erreurs JavaScript | ✅ Aucune (seulement les accès réseau bloqués dans mon environnement) |

## B. À vérifier sur ton iPhone (je ne peux pas le faire à ta place)

- [ ] L'export produit bien un MP4 avec le son en AAC (Chrome produit de l'Opus).
- [ ] « Enregistrer / Partager » ouvre le menu iOS → Enregistrer dans Fichiers, ou dans Photos.
- [ ] « Télécharger dans Fichiers » → le fichier apparaît dans Fichiers › Téléchargements.
- [ ] Le son est présent dans le clip exporté, y compris avec l'interrupteur silencieux activé.
- [ ] Vidéo filmée à l'iPhone (HEVC/HDR) : l'import, l'aperçu et l'export fonctionnent ; vérifier les couleurs.
- [ ] Enregistrement d'écran GTA de 30 min ou plus : l'analyse sonore aboutit sans plantage.
- [ ] Vidéo de plus de 700 Mo : le message clair de limite s'affiche.
- [ ] Verrouiller l'iPhone pendant un export : arrêt propre avec un message.
- [ ] Glisser l'image pour cadrer, et les poignées de la timeline, au doigt.
- [ ] Lien YouTube réel : le titre et la miniature s'affichent.
- [ ] App ajoutée à l'écran d'accueil : elle s'ouvre en plein écran et fonctionne en mode avion (sauf les liens).
- [ ] Les anciens clips de la v1 sont toujours dans l'onglet Clips.

## C. Sécurité (revue du code)

- ✅ Politique CSP stricte : scripts uniquement depuis le site, aucun script tiers.
- ✅ Tous les textes saisis ou reçus (titres, oEmbed) sont échappés avant affichage.
- ✅ Seuls les liens `http(s)` sont acceptés ; les miniatures externes doivent être en `https`.
- ✅ Aucune clé, aucun mot de passe, aucune donnée envoyée : rien de secret dans le dépôt public.
- ✅ Les liens externes s'ouvrent avec `noopener noreferrer`.
- ℹ️ Phase B : clés secrètes Stripe et Supabase (`service_role`) uniquement dans les secrets des Edge Functions, jamais dans GitHub.
