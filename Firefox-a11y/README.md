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
- Les tests bonus (fichier tests-bonus.js) sont ajoutés au même rapport, avec des codes commençant par `kit-`. Ils couvrent notamment le focus visible (10.7), le piège clavier (12.9), le lien d'évitement (12.7), l'affichage à 320 px (10.11), les images (1.2 à 1.9), les contrastes sur image et des composants (3.2, 3.3), les tableaux (5.x), la structure (8.1, 9.2, 9.3, 10.1) et les formulaires (11.5, 11.6, 11.10, 11.13).
- Les erreurs sont à corriger. Les avertissements sont des cas probables qu'une personne doit confirmer : CAPTCHA, PDF, graphique sans description, alternative trop longue...
- Sur un site DSFR, axe met souvent des dizaines de contrastes « à vérifier » (critère 3.2) : il ne sait pas mesurer certains fonds. Ce ne sont pas des erreurs. Si les tests bonus ne signalent rien sur le même texte, le contraste a été mesuré et il est correct.
- axe peut aussi mettre « à vérifier » des attributs ARIA des fenêtres modales du DSFR (critère 7.1) : le composant standard du DSFR est normalement correct.
- Le récapitulatif final classe toutes les anomalies par critère RGAA. Il ne remplace pas un audit : les outils automatiques ne couvrent qu'une partie des 106 critères.

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

Si des erreurs sont trouvées, make termine par « Error 2 » : c'est normal, cela signale simplement que la page contient des anomalies. « Error 1 » signale en revanche une panne (page injoignable, Firefox absent...) : lire le message au-dessus. Une erreur « Cannot find module » signifie que node_modules est abîmé : lancer `make fclean` puis `make installer`.

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
