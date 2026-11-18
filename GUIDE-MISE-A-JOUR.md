# Mettre à jour ViceClip sur GitHub Pages depuis l'iPhone

## 1. Garder une version stable (avant toute mise à jour)

1. Dans Safari, ouvre ton dépôt `viceclip` sur github.com.
2. Touche **Code › Download ZIP**. Le fichier arrive dans Fichiers › Téléchargements.
3. Renomme-le `viceclip-v1-stable.zip` et garde-le.

Pour revenir en arrière, il suffira de renvoyer ces fichiers de la même façon qu'à l'étape 2.

## 2. Envoyer la v2

1. Dans **Fichiers**, touche `ViceClip-AI-v2.zip` : iOS crée un dossier `viceclip-v2`.
2. Sur github.com, ouvre ton dépôt, puis touche **Add file › Upload files**.
3. Touche **choose your files** et sélectionne **tous les fichiers** du dossier `viceclip-v2` :
   - index.html, styles.css, app.js, store.js, render.js, analysis.js, sources.js, ai.js, sw.js ;
   - manifest.webmanifest et les 3 icônes ;
   - les fichiers .md (facultatifs, mais utiles comme documentation).
4. GitHub remplace les fichiers de même nom. Touche **Commit changes**.
5. Attends 1 à 2 minutes : l'onglet **Actions** affiche une coche verte quand c'est publié.

Tous les fichiers sont au même niveau (aucun dossier) : c'est voulu, car Safari ne peut pas envoyer de dossiers sur GitHub.

## 3. Voir la nouvelle version sur l'iPhone

- Ouvre ton lien `https://TON-PSEUDO.github.io/viceclip/` et fais glisser la page vers le bas pour actualiser, deux fois.
- Si l'ancienne version reste affichée : **Réglages (roue dentée) › Forcer la mise à jour de l'app**.
  - Cette option n'existe qu'à partir de la v2. Depuis la v1, ferme l'onglet, rouvre-le, puis actualise.
- Le badge **v2** en haut de l'écran confirme que la mise à jour est passée.

Tes clips sont conservés : la v2 lit la même bibliothèque que la v1.

## 4. En cas de problème

| Symptôme | Solution |
|---|---|
| Page blanche | Un fichier `.js` manque : renvoie-les tous |
| L'ancienne version reste | Réglages › Forcer la mise à jour, ou ferme puis rouvre l'onglet |
| Erreur 404 | Settings › Pages : la branche doit être `main` et le dossier `/ (root)` |
| Retour à la v1 | Renvoie les fichiers du ZIP de sauvegarde, puis supprime les fichiers propres à la v2 (store.js, render.js, analysis.js, sources.js, ai.js) |
