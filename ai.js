/* ai.js — Registre des modules d'analyse. Chaque module déclare honnêtement
   où il tourne, ce qu'il coûte et s'il est disponible. L'interface n'affiche
   un module comme « disponible » que s'il est réellement branché. */

export const AI_MODULES = [
  { id: 'audio-moments', name: 'Moments forts (analyse sonore)', where: 'local', cost: 'Gratuit', status: 'available',
    desc: 'Repère les pics de volume, cris, réactions et explosions et propose des extraits avec un score expliqué. Ne comprend ni l\'image ni les paroles.' },
  { id: 'multi-clip', name: 'Plusieurs clips d\'une vidéo longue', where: 'local', cost: 'Gratuit', status: 'available',
    desc: 'Exporte d\'un coup tous les moments proposés (un après l\'autre, en temps réel).' },
  { id: 'scores', name: 'Scores de pertinence expliqués', where: 'local', cost: 'Gratuit', status: 'available',
    desc: 'Chaque proposition indique pourquoi elle a été choisie (dB, montée brutale, durée intense).' },
  { id: 'transcription', name: 'Transcription de la parole (FR)', where: 'serveur', cost: '≈ 0,04 $ par heure d\'audio (Whisper via API)', status: 'planned', phase: 'C',
    desc: 'Nécessite un serveur pour protéger la clé API et appliquer les quotas.' },
  { id: 'subtitles', name: 'Sous-titres synchronisés + mots clés', where: 'local après transcription', cost: 'Gratuit une fois la transcription faite', status: 'planned', phase: 'C',
    desc: 'Incrustation dans la vidéo exportée, plusieurs styles, texte corrigeable.' },
  { id: 'speakers', name: 'Changements d\'intervenants', where: 'serveur', cost: 'Inclus dans certaines API de transcription', status: 'planned', phase: 'C', desc: '' },
  { id: 'smart-crop', name: 'Recadrage intelligent (suivi du sujet)', where: 'local (détection de visage) ou serveur', cost: 'Gratuit en local, plus lent', status: 'planned', phase: 'C', desc: '' },
  { id: 'titles', name: 'Génération de titres', where: 'serveur (modèle de langage)', cost: 'Quelques centimes pour 100 clips', status: 'planned', phase: 'C', desc: '' },
  { id: 'translation', name: 'Traduction des sous-titres', where: 'serveur', cost: 'Faible (texte uniquement)', status: 'planned', phase: 'C', desc: '' },
  { id: 'visual-moments', name: 'Analyse de l\'image (action, kills, poursuites)', where: 'serveur (GPU)', cost: 'Le plus coûteux, à mesurer', status: 'planned', phase: 'C', desc: '' },
];
