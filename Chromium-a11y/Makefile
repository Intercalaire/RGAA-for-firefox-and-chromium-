# ---------------------------------------------------------------------------
# Kit d'accessibilite Chromium (pa11y + tests bonus) - WCAG 2.1 AA / RGAA 4.1
#
# A lancer depuis le dossier Chromium-a11y :
#   make            affiche l'aide
#   make test       serveur + pa11y + tests bonus + recapitulatif RGAA
# ---------------------------------------------------------------------------

.DEFAULT_GOAL := aide
.PHONY: aide pas-root installer chrome test rapport fichier clean fclean

# Version de Chrome attendue par pa11y-ci : lue dans le Puppeteer installe avec
# pa11y-ci, pour suivre ses mises a jour. Valeur de secours si la lecture echoue.
CHROME_DETECTE = $(shell f=$$(readlink -f "$$(command -v pa11y-ci)" 2>/dev/null); d=$${f%/bin/*}; \
	cat "$$d"/node_modules/puppeteer-core/lib/*/revisions.js "$$d"/node_modules/puppeteer-core/lib/*/puppeteer/revisions.js \
	"$$d"/../puppeteer-core/lib/*/revisions.js "$$d"/../puppeteer-core/lib/*/puppeteer/revisions.js 2>/dev/null \
	| sed -n "s/.*chrome: '\([0-9.]*\)'.*/\1/p" | head -1)
CHROME_VERSION ?= $(or $(CHROME_DETECTE),155.0.8059.39)

# Serveur local : sert la racine du projet (dossier parent) sur le port 3000.
PORT    ?= 3000
RACINE  ?= ..
SERVEUR ?= npx --yes serve "$(RACINE)" -l $(PORT) --no-port-switching

# Tester seulement certaines pages, sans toucher a la liste :
#   make test URL=/contact.html             (page du serveur local)
#   make test URL=https://exemple.gouv.fr/  (adresse complete)
#   make test URL=/a.html,/b.html           (plusieurs pages)
URL      ?=
A11Y_URL  = $(shell printf '%s' "$(URL)" | tr ',' '\n' | sed 's|^/|http://localhost:$(PORT)/|' | paste -sd, -)

# Copie de pa11yci.json limitee aux pages de URL.
CONFIG_URL = node -e "const c = require('./pa11yci.json'); c.urls = process.env.A11Y_URL.split(','); require('fs').writeFileSync('pa11yci-url.json', JSON.stringify(c, null, 2))"

# Execute $(1) avec le serveur local : reutilise un serveur deja lance,
# sinon le demarre puis l'arrete a la fin, quel que soit le resultat.
define avec_serveur
	@if curl -s -o /dev/null "http://localhost:$(PORT)"; then \
		echo "Serveur deja present sur le port $(PORT) : il est reutilise."; \
		PID=""; \
	else \
		echo "Demarrage du serveur sur $(RACINE), port $(PORT)..."; \
		setsid sh -c 'exec $(SERVEUR)' > serveur.log 2>&1 & PID=$$!; \
		for i in $$(seq 1 60); do \
			curl -s -o /dev/null "http://localhost:$(PORT)" && break; \
			if ! kill -0 $$PID 2>/dev/null; then echo "Le serveur n'a pas demarre, voir serveur.log"; exit 1; fi; \
			sleep 1; \
		done; \
	fi; \
	trap '[ -n "$$PID" ] && kill -- -$$PID 2>/dev/null' EXIT; \
	$(1)
endef

aide:
	@echo "Kit Chromium - commandes disponibles :"
	@echo "  make installer   installe pa11y-ci et son Chrome (une seule fois)"
	@echo "  make chrome      installe le Chrome attendu par pa11y-ci (a relancer apres sa mise a jour)"
	@echo "  make test        lance le serveur, pa11y, les tests bonus et le recapitulatif"
	@echo "  make fichier     comme make test, avec la sortie complete dans resultats.txt"
	@echo "  make rapport     reaffiche le recapitulatif RGAA du dernier test"
	@echo "  make clean       supprime les rapports generes"
	@echo "  make fclean      supprime aussi le Chrome de pa11y (relancer make chrome ensuite)"
	@echo ""
	@echo "Options : make test URL=/contact.html    make test PORT=8080    make chrome CHROME_VERSION=x.y.z"

# Ne pas lancer avec sudo : Chrome serait installe dans /root au lieu de
# votre dossier personnel. Le mot de passe est demande seulement pour npm -g.
installer: pas-root
	npm install -g pa11y-ci pa11y-ci-reporter-html \
		|| { echo "Droits insuffisants : nouvel essai avec sudo"; sudo npm install -g pa11y-ci pa11y-ci-reporter-html; }
	$(MAKE) --no-print-directory chrome

chrome: pas-root
	npx --yes @puppeteer/browsers install chrome@$(CHROME_VERSION) --path ~/.cache/puppeteer

pas-root:
	@if [ "$$(id -u)" -eq 0 ]; then \
		echo "Ne lancez pas make avec sudo : relancez simplement make $(MAKECMDGOALS)"; exit 1; fi

# Ordre impose : tests-bonus-chromium.js complete le rapport ecrit par pa11y-ci.
# Code de sortie : 1 si pa11y-ci ou les tests bonus tombent en panne ; sinon
# celui du recapitulatif RGAA, une fois les resultats ecartes retires
# (2 s'il reste des erreurs, 0 sinon).
test:
	@command -v pa11y-ci > /dev/null || { echo "pa11y-ci absent : lancez d'abord make installer"; exit 1; }
	$(call avec_serveur, \
		export A11Y_URL="$(A11Y_URL)"; CONFIG=pa11yci.json; \
		if [ -n "$$A11Y_URL" ]; then $(CONFIG_URL) && CONFIG=pa11yci-url.json; echo "Test limite a : $$A11Y_URL"; fi; \
		S=0; B=0; R=0; \
		pa11y-ci --config $$CONFIG || S=$$?; \
		node tests-bonus-chromium.js || B=$$?; \
		node rgaa-report.js pa11y-report.json --json rgaa-summary.json --code || R=$$?; \
		if [ $$S -ne 0 ] && [ $$S -ne 2 ]; then exit $$S; fi; \
		if [ $$B -eq 1 ]; then exit 1; fi; \
		exit $$R)

fichier:
	@$(MAKE) --no-print-directory test > resultats.txt 2>&1; S=$$?; \
	echo "Resultats ecrits dans resultats.txt (code de sortie $$S)"; exit $$S

rapport:
	@[ -f pa11y-report.json ] || { echo "Aucun rapport : lancez d'abord make test"; exit 1; }
	@node rgaa-report.js pa11y-report.json

clean:
	rm -rf pa11y-html pa11y-report.json pa11yci-url.json rgaa-summary.json resultats.txt serveur.log capture-*.png

fclean: clean
	rm -rf ~/.cache/puppeteer/chrome/*$(CHROME_VERSION)
