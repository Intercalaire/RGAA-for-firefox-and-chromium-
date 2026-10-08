#!/usr/bin/env node
'use strict';

/**
 * a11y-firefox.js
 *
 * Teste l'accessibilite sous Firefox avec Playwright + axe-core, puis avec
 * les tests bonus de tests-bonus.js (focus visible, liens vagues...).
 * Produit un rapport JSON au format pa11y, relu par rgaa-report.js.
 *
 * Prerequis (versions a aligner sur l'image Docker du job) :
 *   npm install --save-dev playwright@1.56.0 @axe-core/playwright
 *   npx playwright install firefox     (en local uniquement)
 *
 * Usage :
 *   node a11y-firefox.js
 *   node a11y-firefox.js --sortie autre-nom.json
 *   node a11y-firefox.js --capture     (capture pleine page, diagnostic)
 */

const fs = require('fs');
const { firefox } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const { executerTestsBonus } = require('./tests-bonus');

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

// Pages a tester. Le port doit correspondre a celui de "serve" (3000 par defaut).
const URLS = [
  'http://localhost:3000/site-test/page-correcte.html',
  'http://localhost:3000/site-test/erreurs-bonus.html',
  'http://localhost:3000/site-test/erreurs-bonus-2.html',
  'http://localhost:3000/site-test/erreurs-images-couleurs.html',
  'http://localhost:3000/site-test/erreurs-structure-formulaires.html',
  'http://localhost:3000/site-test/erreurs-titres-reperes.html',
  'http://localhost:3000/site-test/piege-blocage.html',
  'http://localhost:3000/site-test/piege-boucle.html'
];

if (process.env.A11Y_URL) URLS.splice(0, URLS.length, ...process.env.A11Y_URL.split(',').filter(Boolean));

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const REGLES_IGNOREES = [];

const ATTENTE_MS = 2000;


function lireArguments() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--sortie');
  return {
    sortie: i !== -1 ? args[i + 1] : './a11y-report.json',
    capture: args.includes('--capture')
  };
}

/*
	Convertit un resultat axe en anomalies au format pa11y. axe regroupe les occurrences sous une seule regle ; pa11y produit une entree par element. On deplie donc les noeuds.
	Les resultats "incomplete" d'axe (contraste indecidable, etc.) sont classes en avertissement, comme le fait levelCapWhenNeedsReview dans pa11y : ils demandent une verification manuelle, ce ne sont pas des erreurs averees.
 */
function versFormatPa11y(resultat, type) {
  return resultat.nodes.map((noeud) => ({
    code: resultat.id,
    type,
    typeCode: type === 'error' ? 1 : 2,
    message: resultat.help,
    context: noeud.html,
    selector: Array.isArray(noeud.target) ? noeud.target.join(' ') : String(noeud.target),
    runner: 'axe',
    runnerExtras: {
      description: resultat.description,
      impact: resultat.impact,
      helpUrl: resultat.helpUrl
    }
  }));
}

async function analyser(page, url, capture) {
  process.stdout.write(`Analyse de ${url} ... `);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(ATTENTE_MS);

  if (capture) {
    const nom = `capture-${url.replace(/[^a-z0-9]/gi, '_').slice(0, 60)}.png`;
    await page.screenshot({ path: nom, fullPage: true });
  }

  let constructeur = new AxeBuilder({ page }).withTags(TAGS);
  if (REGLES_IGNOREES.length > 0) {
    constructeur = constructeur.disableRules(REGLES_IGNOREES);
  }

  const resultats = await constructeur.analyze();

  // Tests bonus, apres axe car le parcours au clavier deplace le focus.
  // Une panne de ces tests ne doit pas faire perdre les resultats d'axe.
  let bonus = [];
  try {
    bonus = await executerTestsBonus(page);
  } catch (erreur) {
    console.error(`\n  Tests bonus impossibles sur ${url} : ${erreur.message}`);
  }

  const erreurs = [
    ...resultats.violations.flatMap((r) => versFormatPa11y(r, 'error')),
    ...bonus.filter((a) => a.type === 'error')
  ];
  const avertissements = [
    ...resultats.incomplete.flatMap((r) => versFormatPa11y(r, 'warning')),
    ...bonus.filter((a) => a.type !== 'error')
  ];

  console.log(`${erreurs.length} erreur(s), ${avertissements.length} a verifier`);
  return { anomalies: [...erreurs, ...avertissements], erreurs: erreurs.length };
}

async function main() {
  const { sortie, capture } = lireArguments();

  const navigateur = await firefox.launch();
  const page = await (await navigateur.newContext()).newPage();

  const resultats = {};
  let totalErreurs = 0;
  let totalAnomalies = 0;
  let echecs = 0;

  try {
    for (const url of URLS) {
      try {
        const { anomalies, erreurs } = await analyser(page, url, capture);
        resultats[url] = anomalies;
        totalErreurs += erreurs;
        totalAnomalies += anomalies.length;
      } catch (erreur) {
        console.error(`  Echec sur ${url} : ${erreur.message}`);
        resultats[url] = [];
        echecs += 1;
      }
    }
  } finally {
    await navigateur.close();
  }

  const rapport = {
    total: totalAnomalies,
    passes: Object.values(resultats).filter((a) => !a.some((x) => x.type === 'error')).length - echecs,
    errors: totalErreurs,
    navigateur: 'firefox',
    results: resultats
  };

  fs.writeFileSync(sortie, JSON.stringify(rapport, null, 2), 'utf8');
  console.log(`\nRapport ecrit dans ${sortie}`);
  console.log(`Total : ${totalErreurs} erreur(s) sur ${URLS.length} page(s)`);

  // Code 1 si une page n'a pas pu etre analysee (panne, et non anomalie),
  // code 2 s'il reste des erreurs, comme pa11y-ci, sinon 0.
  if (echecs > 0) process.exit(1);
  process.exit(totalErreurs > 0 ? 2 : 0);
}

main().catch((erreur) => {
  console.error(`Erreur fatale : ${erreur.message}`);
  process.exit(1);
});
