# ---------------------------------------------------------------------------
# Kit d'accessibilite Chromium (pa11y + tests bonus) - WCAG 2.1 AA / RGAA 4.1
#
# A lancer depuis le dossier Chromium-a11y :
#   make            affiche l'aide
#   make test       serveur + pa11y + tests bonus + recapitulatif RGAA
# ---------------------------------------------------------------------------

.DEFAULT_GOAL := aide
.PHONY: aide pas-root installer chrome test rapport fichier clean fclean

CHROME_VERSION ?= 154.0.8037.57

PORT    ?= 3000
RACINE  ?= ..
SERVEUR ?= npx --yes serve "$(RACINE)" -l $(PORT) --no-port-switching

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
	@echo "  make chrome      reinstalle seulement Chrome (ex : CHROME_VERSION=x.y.z)"
	@echo "  make test        lance le serveur, pa11y, les tests bonus et le recapitulatif"
	@echo "  make fichier     comme make test, avec la sortie complete dans resultats.txt"
	@echo "  make rapport     reaffiche le recapitulatif RGAA du dernier test"
	@echo "  make clean       supprime les rapports generes"
	@echo "  make fclean      supprime aussi le Chrome de pa11y (relancer make chrome ensuite)"
	@echo ""
	@echo "Options : make test PORT=8080    make chrome CHROME_VERSION=x.y.z"

installer: pas-root
	npm install -g pa11y-ci pa11y-ci-reporter-html \
		|| { echo "Droits insuffisants : nouvel essai avec sudo"; sudo npm install -g pa11y-ci pa11y-ci-reporter-html; }
	$(MAKE) --no-print-directory chrome

chrome: pas-root
	npx --yes @puppeteer/browsers install chrome@$(CHROME_VERSION) --path ~/.cache/puppeteer

pas-root:
	@if [ "$$(id -u)" -eq 0 ]; then \
		echo "Ne lancez pas make avec sudo : relancez simplement make $(MAKECMDGOALS)"; exit 1; fi

test:
	@command -v pa11y-ci > /dev/null || { echo "pa11y-ci absent : lancez d'abord make installer"; exit 1; }
	$(call avec_serveur, \
		S=0; \
		pa11y-ci --config pa11yci.json || S=$$?; \
		node tests-bonus-chromium.js || { B=$$?; [ $$S -eq 0 ] && S=$$B; }; \
		node rgaa-report.js pa11y-report.json --json rgaa-summary.json; \
		exit $$S)

fichier:
	@$(MAKE) --no-print-directory test > resultats.txt 2>&1; S=$$?; \
	echo "Resultats ecrits dans resultats.txt (code de sortie $$S)"; exit $$S

rapport:
	@[ -f pa11y-report.json ] || { echo "Aucun rapport : lancez d'abord make test"; exit 1; }
	@node rgaa-report.js pa11y-report.json

clean:
	rm -rf pa11y-html pa11y-report.json rgaa-summary.json resultats.txt serveur.log capture-*.png

fclean: clean
	rm -rf ~/.cache/puppeteer/chrome/*$(CHROME_VERSION)
