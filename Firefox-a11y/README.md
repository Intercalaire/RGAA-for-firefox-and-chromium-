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

### Pour faire ses tests en local
## Local UBUNTU cat /etc/os-release
(information : je n'ai pu tester que sur Ubuntu 26.xxxx)

# POUR UBUNTU 26.xxxx
1. Dans un premier terminal à la racine du projet :
```
    npx serve . -l 3000
```
2. Dans un second terminal à la racine du projet:
```
    cd Firefox-a11y && npm ci && PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install firefox
```
3. Puis toujours dans le second terminal :
```
    npm run a11y
```

# POUR UBUNTU 24.xxxx
1. Dans un premier terminal à la racine du projet :
```
    npx serve . -l 3000
```
2. Dans un second terminal à la racine du projet :
```
    cd Firefox-a11y && npm ci && npx playwright install firefox 
```
3. Puis toujours dans le second terminal :
```
    npm run a11y
```

## LOCAL DEBIAN cat /etc/debian_version

# POUR DEBIAN 12

Voir installation de Ubuntu 24.xxxx

# POUR DEBIAN 13

Voir installation de ubuntu 26.xxx mais remplacer l'étape 2 par 

```
    cd Firefox-a11y && npm ci && PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=debian12-x64 npx playwright install firefox
```
