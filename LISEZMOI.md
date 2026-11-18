# ViceClip AI — Phase 1

Éditeur vidéo qui tourne entièrement dans Safari : import, choix du passage, découpe et export en vrai fichier MP4 sans filigrane. Aucun serveur, aucune API payante : la vidéo ne quitte jamais l'iPhone.

## Fichiers (tous à la racine, aucun dossier)

| Fichier | Rôle |
|---|---|
| index.html | Structure de l'app (Accueil, Éditeur, Clips) |
| styles.css | Design noir / violet néon |
| app.js | Import, timeline, moteur d'export, bibliothèque |
| sw.js | Mode hors ligne + installation sur l'écran d'accueil |
| manifest.webmanifest | Nom, couleurs, icônes de l'app |
| icon-180/192/512.png | Icônes |

## Mettre l'app en ligne gratuitement depuis l'iPhone (GitHub Pages)

1. Dans **Fichiers**, touche le ZIP : iOS le décompresse dans un dossier `viceclip`.
2. Dans Safari, crée un compte gratuit sur **github.com**.
3. Touche **+ › New repository**, nomme-le `viceclip`, coche **Public**, puis **Create repository**.
4. Touche **uploading an existing file** (ou **Add file › Upload files**), sélectionne **tous les fichiers** du dossier `viceclip`, puis **Commit changes**.
5. Va dans **Settings › Pages**. Dans « Branch », choisis **main** et **/ (root)**, puis **Save**.
6. Au bout d'une à deux minutes, l'app est en ligne sur `https://TON-PSEUDO.github.io/viceclip/`.
7. Ouvre ce lien dans Safari, puis **Partager › Sur l'écran d'accueil** : ViceClip s'ouvre comme une vraie app.

Pour une mise à jour, renvoie les fichiers modifiés de la même façon (ils remplacent les anciens).

Autres hébergeurs gratuits possibles : Cloudflare Pages ou Netlify (il suffit d'y déposer les mêmes fichiers).
L'app a besoin du **HTTPS**, que tous ces hébergeurs fournissent.

## Utilisation

1. **Éditeur › Choisir une vidéo** : depuis Photos ou Fichiers (MP4, MOV, WebM).
2. Glisse les poignées violettes, ou utilise −1 s / −0,1 / +0,1 / +1 s et « Placer à la lecture ».
3. **Lire la sélection** pour vérifier le passage, puis donne un titre au clip.
4. **Exporter le clip en MP4** : reste sur l'écran pendant l'export, qui se fait en temps réel.
5. **Enregistrer / Partager › Enregistrer dans Fichiers** (ou **Enregistrer la vidéo** pour Photos).
   Tu peux aussi utiliser **Télécharger dans Fichiers**, qui place le clip dans Fichiers › Téléchargements.

## Comment fonctionne l'export

La vidéo est lue du point de début au point de fin. Chaque image est dessinée dans un canvas, et le son passe par Web Audio.
`MediaRecorder` encode ensuite le tout en MP4 (H.264 + AAC) avec l'encodeur matériel de l'iPhone.
Le clip est enregistré dans la bibliothèque (IndexedDB) et peut être sauvegardé via le menu de partage iOS.

## Limites connues

- **Export en temps réel** : un clip de 60 s demande environ 60 s. Si Safari passe en arrière-plan (appel, verrouillage), l'export est annulé proprement, et il suffit de le relancer.
- **Réencodage** : le clip est réencodé (jusqu'à 1920 px, entre 4 et 12 Mbit/s), ce n'est pas une copie bit à bit. La qualité reste très bonne pour TikTok.
- **Vidéos HDR / Dolby Vision** de l'iPhone : les couleurs peuvent paraître un peu plus ternes après export (conversion en SDR).
- **Bibliothèque** : elle est stockée dans Safari. iOS peut l'effacer si l'espace manque ou si le site n'est pas utilisé pendant plusieurs semaines. Enregistre toujours tes clips dans Fichiers ou Photos.
- **Liens YouTube** : non pris en charge. Le navigateur ne peut pas récupérer le fichier d'une vidéo YouTube sans contourner leurs protections. Utilise plutôt tes propres enregistrements ou VOD, téléchargés légalement (par exemple depuis YouTube Studio pour tes propres vidéos).
- Configuration requise : **iOS 14.5 minimum** ; iOS 16 ou plus récent est conseillé.
