### Installation simple pour les vérifs grâce à GitLab

1. Ajouter le dossier Firefox-a11y à votre projet.
2. Ajouter dans le .gitlab-ci.yml à la racine du projet
```
    include:
        - local: Firefox-a11y/gitlab-ci.yml
```

3. Modifier la liste des URL du fichier a11y-firefox.js (le paramètre URLS se trouve en haut du fichier) 
Exemple :
```
const URLS = [
  'http://localhost:3000/',
  'http://localhost:3000/contact.html',
  'http://localhost:3000/mentions-legales.html',
  'http://localhost:3000/accessibilite.html',
  'http://localhost:3000/plan-du-site.html',
  'http://localhost:3000/articles/exemple-article.html'
];
```

Les URL peuvent aussi être celles d'un site en ligne (https://...). Attention aux pages de redirection : utiliser l'adresse finale de la page.

Les deux kits (Chromium-a11y et Firefox-a11y) peuvent être inclus dans le même projet : leurs jobs portent des noms différents et tournent en parallèle.

### Lire les résultats

- Firefox-a11y utilise le moteur axe : les violations sont des erreurs, les cas qu'axe ne sait pas trancher sont des avertissements (« à vérifier »).
- Les tests bonus (fichier tests-bonus.js) sont ajoutés au même rapport, avec des codes commençant par `kit-`. Ils couvrent notamment le focus visible (10.7), le piège clavier (12.9), le lien d'évitement (12.7), l'affichage à 320 px (10.11), le zoom à 200 % (10.4), l'espacement du texte (10.12), les images (1.2 à 1.9), les contrastes sur image et des composants (3.2, 3.3), les médias (4.11), les tableaux (5.x), l'intitulé visible contenu dans le nom accessible (6.1, 7.1, 11.2, 11.9), les composants au clavier (7.3), la structure et les titres (8.1, 9.1, 9.2, 9.3, 10.1, 12.6, 12.8), les formulaires (11.4, 11.5, 11.6, 11.8, 11.10, 11.13), les nouvelles fenêtres (13.2), les contenus en mouvement (13.8), le titre de page (8.6), les consignes qui reposent sur la forme, la position ou la couleur (10.9, 3.1), le format de saisie (11.10), le contenu affiché au survol seulement (10.14), les raccourcis à une seule touche (12.10), les listes déroulantes qui changent de contexte (7.4), la navigation (12.1, 12.2, 12.4, 12.5), les liens cassés de la page « plan du site » (12.3), les sons lancés automatiquement (4.10), l'orientation de l'écran (13.9), les couleurs de texte et de fond déclarées ensemble (10.5), les balises utilisées pour la mise en page (8.9), les contenus qui apparaissent au survol ou au focus (10.13), et en « à vérifier » : les médias sans transcription ou sans texte qui les identifie (4.1, 4.7), les passages dans une autre langue sans attribut lang (8.7) et les messages de statut non annoncés (7.5). Pour les raccourcis et les listes déroulantes, le kit appuie sur quelques touches et choisit une autre option dans chaque liste : l'envoi des formulaires est intercepté, rien n'est réellement envoyé. Pour le titre et la navigation, les pages d'un même site testées ensemble sont comparées entre elles : titre unique, menu principal, lien « plan du site » et moteur de recherche toujours présents, identiques et à la même place (la page d'accueil est exclue du 12.2, et seules les pages qui partagent le même menu principal sont comparées). Pour les sons, la lecture automatique est autorisée dans le navigateur du test (sortie son coupée) afin de voir ce que la page lance d'elle-même. Pour l'orientation, la page est affichée comme sur un téléphone, en portrait puis en paysage. Pour les contenus au survol, le kit passe la souris sur les premiers éléments de la page, puis sur l'infobulle qui apparaît, et appuie sur Échap.
- Les erreurs sont à corriger. Les avertissements sont des cas probables qu'une personne doit confirmer : CAPTCHA, PDF, graphique sans description, alternative trop longue...
- Quand axe ne sait pas trancher un contraste (critère 3.2), le kit le mesure lui-même : à partir des couleurs, ou sur une capture d'écran pour un texte sur image ou dégradé. Les contrastes suffisants sont listés à la fin du récapitulatif, sous « Ecartees apres verification sur la page » ; les contrastes insuffisants deviennent des erreurs ; les autres restent « à vérifier », avec la fourchette mesurée ou la raison dans le message (« non mesurable par le kit : ... »).
- axe peut aussi mettre « à vérifier » des attributs ARIA des fenêtres modales du DSFR (critère 7.1) : le composant standard du DSFR est normalement correct.
- Si un site renvoie une page de vérification anti-robot (« Vérification que vous êtes un humain »), les tests bonus ne sont pas faits sur cette page : elle est signalée en échec au lieu de donner de faux résultats.
- Une page qui répond 404 ou 500, une page d'erreur (titre « Page introuvable », « Erreur 404 »...) ou une page vide est signalée en échec et n'est pas analysée. Une page redirigée ailleurs (vers la connexion, l'accueil...) est analysée, mais le journal affiche « attention : redirigée vers ... » : vérifier que c'est bien la page voulue.
- Une page qui dépasse 5 minutes d'analyse est abandonnée et signalée en échec, les autres pages continuent. Les pages en échec sont listées à la fin du récapitulatif RGAA, avec la raison (« Pages non analysées »). Pour changer ce délai : `A11Y_DELAI_PAGE=600 make test` (en secondes).
- Le récapitulatif final classe toutes les anomalies par critère RGAA. Un même élément signalé par plusieurs règles pour le même critère (axe et un test bonus, par exemple) n'y est compté qu'une fois (ligne « Doublons fusionnes ») : ses totaux peuvent donc être un peu plus bas que ceux affichés page par page pendant l'analyse. Il ne remplace pas un audit : les outils automatiques ne couvrent qu'une partie des 106 critères.

### Pour faire ses tests en local


## AVEC MAKEFILE

Toutes les commandes se lancent depuis le dossier Firefox-a11y. Taper `make` seul affiche l'aide.

1. Installer les dépendances et Firefox (une seule fois) :
```
    make installer
```
Sur un système plus récent que Playwright (Ubuntu 26.04, Debian 13…), l'installation de Firefox est d'abord refusée, puis `make installer` recommence tout seul en se faisant passer pour Ubuntu 24.04. Le message « does not support firefox » qui s'affiche au passage est donc normal.

Pour imposer une autre plateforme :
```
    make installer PLATEFORME=debian12-x64
```

2. Lancer le test :
```
    make test
```
Pour tester seulement certaines pages, sans modifier a11y-firefox.js :
```
    make test URL=/contact.html
    make test URL=https://exemple.gouv.fr/,/plan-du-site.html
```
Le serveur local est démarré automatiquement à la racine du projet, puis arrêté à la fin. S'il tourne déjà sur le port 3000, il est réutilisé.

S'il reste des erreurs (une fois les résultats écartés retirés), make termine par « Error 2 » : c'est normal, cela signale simplement que la page contient des anomalies. « Error 1 » signale en revanche une panne (page injoignable, page d'erreur 404, page abandonnée, Firefox absent...) : lire le message au-dessus. Une erreur « Cannot find module » signifie que node_modules est abîmé : lancer `make fclean` puis `make installer`.

Pour voir ce que mesure le test de contraste sur image (3.2), lancer :
```
    KIT_CAPTURES=1 make test
```
Chaque zone mesurée est enregistrée dans un fichier capture-contraste-N.png, dont le nom apparaît dans le message.

Autres commandes :
```
    make fichier     même chose, avec toute la sortie dans resultats.txt
    make rapport     réaffiche le récapitulatif du dernier test
    make clean       supprime les rapports générés
    make fclean      supprime aussi node_modules (relancer make installer ensuite)
```

Pour connaître sa version du système : `cat /etc/os-release` (Ubuntu) ou `cat /etc/debian_version` (Debian).
