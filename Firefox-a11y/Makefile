# ---------------------------------------------------------------------------
# Kit d'accessibilite Firefox (Playwright + axe + tests bonus) - RGAA 4.1
#
# A lancer depuis le dossier Firefox-a11y :
#   make            affiche l'aide
#   make test       serveur + analyse Firefox + tests bonus + recapitulatif RGAA
# ---------------------------------------------------------------------------

.DEFAULT_GOAL := aide
.PHONY: aide installer test rapport fichier clean fclean

# Systemes plus recents que Playwright 1.56 (Ubuntu 26.04, Debian 13...) :
# si l'installation normale de Firefox echoue, make installer recommence
# automatiquement en se faisant passer pour PLATEFORME_SECOURS. On peut
# aussi imposer une plateforme : make installer PLATEFORME=debian12-x64
PLATEFORME         ?=
PLATEFORME_SECOURS ?= ubuntu24.04-x64

# ---------------------------------------------------------------------------
# Serveur local
#
# Le site est servi depuis la RACINE du projet (le dossier parent du kit).
# Si un serveur repond deja sur le port, il est reutilise ; sinon, on en
# demarre un pour la duree du test, puis on l'arrete.
# ---------------------------------------------------------------------------

PORT    ?= 3000
RACINE  ?= ..
SERVEUR ?= npx --yes serve "$(RACINE)" -l $(PORT) --no-port-switching

# Tester seulement certaines pages, sans toucher a la liste :
#   make test URL=/contact.html             (page du serveur local)
#   make test URL=https://exemple.gouv.fr/  (adresse complete)
#   make test URL=/a.html,/b.html           (plusieurs pages)
URL      ?=
A11Y_URL  = $(shell printf '%s' "$(URL)" | tr ',' '\n' | sed 's|^/|http://localhost:$(PORT)/|' | paste -sd, -)

# Demarre le serveur si besoin, execute la commande passee en parametre,
# arrete le serveur et restitue le code de sortie de la commande.
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
	@echo "Kit Firefox - commandes disponibles :"
	@echo "  make installer   installe les dependances et Firefox (une seule fois)"
	@echo "  make test        lance le serveur, l'analyse, les tests bonus et le recapitulatif"
	@echo "  make fichier     comme make test, avec la sortie complete dans resultats.txt"
	@echo "  make rapport     reaffiche le recapitulatif RGAA du dernier test"
	@echo "  make clean       supprime les rapports generes"
	@echo "  make fclean      supprime aussi node_modules (relancer make installer ensuite)"
	@echo ""
	@echo "Option : make test URL=/contact.html (une ou plusieurs pages, separees par des virgules)"
	@echo "Systeme non reconnu : make installer reessaie seul en mode $(PLATEFORME_SECOURS)"

installer:
	npm ci
	@if [ -n "$(PLATEFORME)" ]; then \
		echo "Installation de Firefox en mode $(PLATEFORME)..."; \
		PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=$(PLATEFORME) npx playwright install firefox; \
	elif npx playwright install firefox; then \
		true; \
	else \
		echo ""; \
		echo "Installation refusee : systeme probablement trop recent pour Playwright."; \
		echo "Nouvel essai en mode $(PLATEFORME_SECOURS)..."; \
		PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=$(PLATEFORME_SECOURS) npx playwright install firefox; \
	fi

test:
	@[ -d node_modules ] || { echo "Dependances absentes : lancez d'abord make installer"; exit 1; }
	$(call avec_serveur, A11Y_URL="$(A11Y_URL)" npm run --silent a11y)

fichier:
	@$(MAKE) --no-print-directory test > resultats.txt 2>&1; S=$$?; \
	echo "Resultats ecrits dans resultats.txt (code de sortie $$S)"; exit $$S

rapport:
	@node rgaa-report.js a11y-report.json

clean:
	rm -f a11y-report.json rgaa-summary.json resultats.txt serveur.log capture-*.png

fclean: clean
	rm -rf node_modules/
