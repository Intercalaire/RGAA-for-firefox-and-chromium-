### Installation simple pour les vérifs GitLab

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
    {
		"url": "http://localhost:3000/"
	},
	{
		"url": "http://localhost:3000/contact"
	}
	]
```

Les deux kits (Chromium-a11y et Firefox-a11y) peuvent être inclus dans le même projet : leurs jobs portent des noms différents et tournent en parallèle.

### Lire les résultats

- Chromium-a11y utilise deux moteurs, axe et htmlcs : une même anomalie peut donc apparaître deux fois.

### POUR faire ses tests en local

1. Installer pa11y-ci (une seule fois) :
```
    npm install -g pa11y-ci pa11y-ci-reporter-html
```
2. Installer le Chrome utilisé par pa11y (une seule fois) :
```
    npx @puppeteer/browsers install chrome@154.0.8037.57 --path ~/.cache/puppeteer
```
Le numéro de version doit être celui qu'attend pa11y-ci. Après une mise à jour de pa11y-ci, le nouveau numéro est indiqué dans le message d'erreur « Could not find Chrome (ver. ...) ».

Si Chrome refuse de démarrer avec l'erreur « error while loading shared libraries » :
```
    sudo npx @puppeteer/browsers install chrome@154.0.8037.57 --path ~/.cache/puppeteer --install-deps
```
3. Dans un premier terminal, à la racine du projet :
```
    npx serve . -l 3000
```
4. Dans un second terminal, à la racine du projet :
```
    cd Chromium-a11y && pa11y-ci --config pa11yci.json && node rgaa-report.js pa11y-report.json
```
