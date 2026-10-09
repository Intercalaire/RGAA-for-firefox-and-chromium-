### Installation simple pour les vérifs grâce à GitLab

1. Ajouter le dossier Chromium-a11y à votre projet.
2. Ajouter dans le .gitlab-ci.yml à la racine du projet :
```
    include:
        - local: Chromium-a11y/gitlab-ci.yml
```

3. Modifier la liste des URL dans le fichier pa11yci.json (le paramètre urls se trouve en bas du fichier).
Exemple :
```
  "urls": [
    "http://localhost:3000/",
    "http://localhost:3000/mentions-legales.html",
    "http://localhost:3000/accessibilite.html",
    "http://localhost:3000/plan-du-site.html"
  ]
```

Les URL peuvent aussi être celles d'un site en ligne (https://...). Attention aux pages de redirection : utiliser l'adresse finale de la page.

Les deux kits (Chromium-a11y et Firefox-a11y) peuvent être inclus dans le même projet : leurs jobs portent des noms différents et tournent en parallèle.

### Lire les résultats

- Chromium-a11y utilise deux moteurs, axe et htmlcs : une même anomalie peut donc apparaître deux fois.
- Les tests bonus (fichier tests-bonus.js) sont ajoutés au même rapport, avec le moteur « bonus » et des codes commençant par `kit-`. Ils couvrent notamment le focus visible (10.7), le piège clavier (12.9), le lien d'évitement (12.7), l'affichage à 320 px (10.11), l'espacement du texte (10.12), les images (1.2 à 1.9), les contrastes sur image et des composants (3.2, 3.3), les médias (4.11), les tableaux (5.x), l'intitulé visible contenu dans le nom accessible (6.1, 7.1, 11.2, 11.9), les composants au clavier (7.3), la structure et les titres (8.1, 9.1, 9.2, 9.3, 10.1, 12.6, 12.8), les formulaires (11.4, 11.5, 11.6, 11.8, 11.10, 11.13), les nouvelles fenêtres (13.2) et les contenus en mouvement (13.8).
- Les erreurs sont à corriger. Les avertissements (« à vérifier ») sont des cas probables qu'une personne doit confirmer : CAPTCHA, PDF, graphique sans description, alternative trop longue...
- pa11y n'affiche que les erreurs d'axe : les contrastes qu'axe ne sait pas mesurer (texte sur image ou dégradé) n'apparaissent pas. Le test bonus 3.2 les mesure directement sur l'écran.
- Après pa11y, chaque erreur d'axe et de htmlcs est revérifiée sur la page réelle. Celles que le RGAA rend non applicables (iframe de statistiques masquée, contraste d'un composant inactif, cible du lien d'évitement créée après le chargement, tableau de mise en forme conforme au test 5.8.1) sont retirées des erreurs et listées à la fin du récapitulatif, sous « Ecartees apres verification sur la page », avec leur raison. Un élément masqué au chargement (menu ou fenêtre modale fermés) passe en « à vérifier une fois affiché ». Les messages de pa11y affichés au début du test ne tiennent pas compte de ces vérifications : se fier au récapitulatif.
- htmlcs peut aussi signaler des logos SVG pourtant nommés : en cas de doute, vérifier si axe signale aussi l'élément.
- Si un site renvoie une page de vérification anti-robot (« Vérification que vous êtes un humain »), les tests bonus ne sont pas faits sur cette page : elle est signalée en échec au lieu de donner de faux résultats.
- Le récapitulatif final classe toutes les anomalies par critère RGAA. Il ne remplace pas un audit : les outils automatiques ne couvrent qu'une partie des 106 critères.

### Pour faire ses tests en local


## AVEC MAKEFILE

Toutes les commandes se lancent depuis le dossier Chromium-a11y. Taper `make` seul affiche l'aide.

1. Installer pa11y-ci et son Chrome (une seule fois) :
```
    make installer
```
Ne pas lancer `sudo make installer` : Chrome serait alors installé pour root et pa11y ne le trouverait pas. Si `npm install -g` manque de droits (erreur EACCES), `make installer` recommence tout seul avec sudo et demande le mot de passe ; le message d'erreur qui s'affiche au passage est donc normal.

La version de Chrome doit être celle qu'attend pa11y-ci : le Makefile la lit directement dans pa11y-ci. Après une mise à jour de pa11y-ci (erreur « Could not find Chrome (ver. ...) »), il suffit de lancer :
```
    make chrome
```
Pour imposer une version : `make chrome CHROME_VERSION=x.y.z`.

Si Chrome refuse de démarrer avec l'erreur « error while loading shared libraries » :
```
    sudo npx @puppeteer/browsers install chrome@x.y.z --path ~/.cache/puppeteer --install-deps
```

2. Lancer le test :
```
    make test
```
Pour tester seulement certaines pages, sans modifier pa11yci.json :
```
    make test URL=/contact.html
    make test URL=https://exemple.gouv.fr/,/plan-du-site.html
```
Le serveur local est démarré automatiquement à la racine du projet, puis arrêté à la fin. S'il tourne déjà sur le port 3000, il est réutilisé.

pa11y-ci, puis les tests bonus, puis le récapitulatif RGAA s'enchaînent. S'il reste des erreurs dans le récapitulatif (une fois les résultats écartés retirés), make termine par « Error 2 » : c'est normal, cela signale simplement que la page contient des anomalies. « Error 1 » signale en revanche une panne (page injoignable, Chrome absent...) : lire le message au-dessus.

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
    make fclean      supprime aussi le Chrome de pa11y (relancer make chrome ensuite)
```
