# ViceClip AI — Analyse, plan et architecture (v2)

*Mis à jour le 18 novembre 2026. Les tarifs cités ont été vérifiés le même jour et peuvent évoluer.*

---

## 1. Analyse du projet existant (v1)

**Ce qui fonctionnait déjà**
- L'import d'une vidéo locale, la découpe précise et l'export en vrai MP4 (H.264), sans filigrane.
- La bibliothèque stockée localement (IndexedDB), l'enregistrement dans Fichiers ou Photos, et l'installation en PWA.
- Un code simple, sans dépendance externe, qui se publie tel quel sur GitHub Pages.

**Ce qui manquait ou freinait**

| Problème | Impact |
|---|---|
| Aucun recadrage 9:16 : l'export gardait le format de la source | Bloquant pour TikTok |
| Pas de choix de résolution ni de qualité | Fichiers trop lourds ou trop flous |
| Aucune aide pour trouver les passages | Pas de valeur « IA » |
| Tout le code dans un seul fichier | Difficile à faire évoluer |
| Bibliothèque sans recherche, favoris ni tri | Inutilisable au-delà de 20 clips |
| Pas de pages Profil et Réglages | Cahier des charges non couvert |
| Aucune politique de sécurité (CSP) | Surface d'attaque XSS |
| Pas de procédure de mise à jour forcée | iOS peut garder l'ancienne version en cache |

---

## 2. Plan d'amélioration priorisé

| Priorité | Chantier | Statut |
|---|---|---|
| P0 | Recadrage 9:16 / 1:1 / 16:9, avec aperçu fidèle et cadrage au doigt | **Fait (v2)** |
| P0 | Choix de la résolution (720p / 1080p) et de la qualité | **Fait (v2)** |
| P0 | Gestion des erreurs en français, annulation, reprise | **Fait (v2)** |
| P1 | Moments forts : analyse sonore locale avec scores expliqués | **Fait (v2)** |
| P1 | Export en lot de plusieurs clips depuis une vidéo longue | **Fait (v2)** |
| P1 | Bibliothèque : recherche, favoris, filtres, tri, renommage, suppression | **Fait (v2)** |
| P1 | Import par lien : détection de la plateforme, infos publiques, procédure légale | **Fait (v2)** |
| P1 | Pages Profil, Réglages, Moteur IA ; écrans de chargement ; CSP | **Fait (v2)** |
| P2 | Sous-titres (incrustation locale) : le moteur est prêt, il manque la transcription | Phase C |
| P2 | Comptes Supabase et historique en ligne | Phase B |
| P3 | Abonnements Stripe | Phase B, **après** que les fonctions vendues existent |
| P3 | Transcription, analyse de l'image, recadrage intelligent | Phase C |

---

## 3. Architecture technique

### Phase A (actuelle) : 100 % sur l'appareil

```
index.html ── app.js (interface, navigation, état)
               ├─ render.js    cadrage + rendu canvas + export MediaRecorder (MP4 H.264/AAC)
               ├─ analysis.js  décodage audio (OfflineAudioContext) → courbe dB → moments
               ├─ sources.js   reconnaissance des liens + oEmbed public (YouTube/TikTok)
               ├─ ai.js        registre des modules (statut, où ça tourne, coût)
               └─ store.js     IndexedDB (clips) + localStorage (réglages)
sw.js  : cache hors ligne, stratégie « réseau d'abord »
```

**Pipeline d'export.** La vidéo est lue de A à B. À chaque image, `createRenderer` la dessine au format voulu (recadrage, fond flou ou bandes noires). En parallèle, `canvas.captureStream` et l'audio Web Audio alimentent `MediaRecorder`, qui encode le fichier. Le résultat est sauvegardé dans IndexedDB, puis partagé ou téléchargé. La même fonction de dessin sert à l'aperçu et à l'export : ce que tu vois est ce que tu obtiens.

**Mémoire (Safari iOS).**
- La vidéo source n'est jamais copiée en mémoire : elle est lue directement depuis le fichier.
- Les adresses temporaires (`blob:`) sont libérées dès qu'elles ne servent plus.
- Les canvas sont vidés à la fermeture.
- L'analyse sonore est limitée à 700 Mo de vidéo et décode le son à 8 kHz mono, soit environ 115 Mo pour 1 h.

### Phase B : comptes et abonnements

```
PWA (Cloudflare Pages)
  │  supabase-js (clé publique "anon" uniquement)
  ▼
Supabase : Auth e-mail · Postgres + RLS · Edge Functions
  ├─ fn create-checkout   → Stripe Checkout (clé secrète dans les secrets Supabase)
  ├─ fn customer-portal   → portail client Stripe (annulation, carte, factures)
  ├─ fn stripe-webhook    → vérifie la signature, met à jour « subscriptions »
  └─ fn reserve-export    → vérifie et décompte le quota AVANT chaque export
```

**Pourquoi quitter GitHub Pages à cette étape.** Les conditions de GitHub indiquent que Pages n'est pas destiné à faire tourner un SaaS commercial. Cloudflare Pages ou Vercel sont gratuits au départ et l'autorisent.

**Schéma de base (référence, non déployé)**

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  creator_name text, created_at timestamptz default now());
create table subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null default 'free' check (plan in ('free','creator','pro')),
  status text not null default 'active',        -- active | past_due | canceled
  stripe_customer_id text, stripe_subscription_id text,
  current_period_end timestamptz);
create table usage (
  user_id uuid references auth.users on delete cascade,
  period text not null,                           -- '2026-11'
  exports int not null default 0,
  primary key (user_id, period));
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text, source_name text, start_s real, end_s real, format text,
  created_at timestamptz default now());
alter table profiles enable row level security;
alter table subscriptions enable row level security;
alter table usage enable row level security;
alter table projects enable row level security;
-- Chaque utilisateur ne lit que ses lignes ; seules les Edge Functions
-- (clé service) écrivent dans subscriptions et usage.
create policy "lecture perso" on subscriptions for select using (auth.uid() = user_id);
create policy "lecture perso" on usage for select using (auth.uid() = user_id);
create policy "projets perso" on projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profil perso" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
```

**Quotas côté serveur : la limite honnête.** Tant que l'export se fait sur l'iPhone, le serveur peut décompter les exports de façon fiable : `reserve-export` incrémente le compteur de manière atomique et refuse l'export au-delà du quota. En revanche, il ne peut pas *garantir* le filigrane ni la limite de 720p de l'offre Free : une personne technique pourrait modifier le code de sa page. Pour une garantie totale, il faut faire le rendu final côté serveur (Phase C). Recommandation : démarrer avec le décompte serveur, puis basculer le rendu payant côté serveur quand le volume le justifie.

### Phase C : IA serveur

```
iPhone ── extrait l'audio (léger) ──► fn transcribe ──► API Whisper (Groq/OpenAI)
       ◄── mots horodatés ──────────┘
iPhone : sous-titres incrustés localement par render.js (gratuit)
Vidéos lourdes → stockage R2 → worker ffmpeg (VPS) → clip rendu → lien de téléchargement
```

Envoyer seulement l'audio (environ 1 Mo par minute) plutôt que la vidéo divise les coûts et les temps d'envoi.

---

## 4. Feuille de route des abonnements

1. **Phase B1 — Comptes (gratuit)** : inscription par e-mail, connexion, mot de passe oublié, suppression du compte (efface toutes les données liées), historique des projets.
2. **Phase B2 — Stripe en mode test** : Checkout, webhook, portail client. Scénarios à valider : paiement réussi, échec (`invoice.payment_failed` → statut `past_due` + e-mail), renouvellement (`invoice.paid`), annulation en fin de période (`customer.subscription.deleted`).
3. **Phase B3 — Pages légales** (à faire valider par un professionnel) :
   - mentions légales (avec ton SIRET) ;
   - CGV d'abonnement ;
   - politique de confidentialité RGPD ;
   - information sur le droit de rétractation de 14 jours : pour un service numérique démarré immédiatement, il faut recueillir l'accord exprès du client avant le début du service ;
   - désignation d'un médiateur de la consommation ;
   - mentions de TVA (franchise en base, puis guichet OSS pour les clients européens au-delà du seuil).
4. **Phase B4 — Activer les paiements réels** uniquement pour ce qui fonctionne déjà. Concrètement, le plan **Creator** peut être vendu dès que les comptes et les quotas tournent. Les sous-titres automatiques ne seront annoncés qu'en Phase C.
5. **Phase C — PRO** : la détection IA avancée et les sous-titres avancés sont livrés, puis le plan PRO est activé.

| Offre | Prix | Frais Stripe estimés par paiement* | Reste |
|---|---|---|---|
| Free | 0 € | — | — |
| Creator | 9,99 € | ≈ 0,47 € | ≈ 9,52 € |
| Pro | 24,99 € | ≈ 0,80 € | ≈ 24,19 € |

\* Carte européenne standard à 1,5 % + 0,25 €, plus Stripe Billing à 0,7 %. Hors TVA et hors cotisations sociales.

---

## 5. Coûts d'exploitation estimés

| Poste | Phase A | Phase B (≈ 100 utilisateurs) | Phase C (≈ 1 000 utilisateurs) |
|---|---|---|---|
| Hébergement de l'app | 0 € (GitHub Pages, 100 Go/mois de bande passante, limite souple) | 0 € (Cloudflare Pages) | 0 à 20 €/mois |
| Base + Auth (Supabase) | — | 0 € (offre gratuite : 500 Mo de base, 1 Go de fichiers, mise en pause après 1 semaine sans activité) | ≈ 25 $/mois (Pro) |
| Stockage vidéo | — | — | Cloudflare R2 : 10 Go gratuits, puis 0,015 $/Go/mois, sortie gratuite |
| Transcription | — | — | Whisper turbo via Groq ≈ 0,04 $/h d'audio (soit ≈ 4 $ pour 100 h) |
| Rendu vidéo serveur | — | — | VPS de 5 à 10 €/mois pour commencer ; plusieurs serveurs ensuite |
| Nom de domaine | facultatif | ≈ 10 €/an | ≈ 10 €/an |
| **Total** | **0 €** | **≈ 0 à 1 €/mois** | **≈ 40 à 100 €/mois** |

Ces chiffres sont des ordres de grandeur. Le vrai coût de la Phase C dépend des heures de vidéo traitées. Aucune offre gratuite ne permet un traitement illimité : les quotas par plan existent pour ça.

---

## 6. État honnête des fonctionnalités (v2)

**Terminé et testé (dans Chrome au format iPhone ; à confirmer sur ton iPhone)**
- Import MP4/MOV/WebM, lecture, timeline avec miniatures, poignées, réglages fins, durées rapides.
- Formats 9:16, 1:1, 16:9 et Original ; modes Recadrer, Fond flou et Bandes noires ; zoom ; cadrage au doigt.
- Export MP4 réel en 720p ou 1080p, deux qualités, annulation, arrêt propre si Safari passe en arrière-plan.
- Moments forts par analyse sonore, avec score et raisons ; marqueurs sur la timeline ; export en lot.
- Bibliothèque : recherche, favoris, filtres par format, tri, renommage, suppression.
- Profil local, Réglages (valeurs par défaut, stockage, mise à jour forcée), page Moteur IA.
- Liens YouTube, Twitch, Kick et TikTok reconnus, avec procédure légale pour récupérer le fichier.
- Mode hors ligne et compatibilité avec la v1 : les anciens clips sont conservés.

**Écrit mais non vérifié ici** : la récupération du titre et de la miniature YouTube ou TikTok. Mon environnement de test n'a pas accès à ces sites ; l'app affiche alors son message de repli, qui a été vérifié.

**Pas encore développé** : comptes, abonnements, quotas, filigrane Free, transcription, sous-titres, détection d'intervenants, recadrage intelligent, titres automatiques, traduction, analyse de l'image.
