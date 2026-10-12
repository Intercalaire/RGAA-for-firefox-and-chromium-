#!/usr/bin/env node
'use strict';

/**
 * tests-bonus-chromium.js
 *
 * Execute les tests bonus (tests-bonus.js) sous Chromium, sur les pages
 * de pa11yci.json, puis ajoute leurs resultats au rapport pa11y-report.json.
 * Les erreurs de pa11y non applicables sur la page reelle (element masque,
 * composant inactif...) y sont aussi requalifiees.
 * A lancer APRES pa11y-ci.
 *
 * Aucune dependance a installer : le script reutilise le Puppeteer et le
 * Chrome installes avec pa11y-ci, dans l'image GitLab comme en local.
 *
 * Usage :
 *   node tests-bonus-chromium.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');
const { executerTestsBonus, requalifierAnomalies, verifierChargement, avecDelai } = require('./tests-bonus');

const CONFIG = './pa11yci.json';
const RAPPORT = './pa11y-report.json';
const ATTENTE_MS = 2000;

/* ------------------------------------------------------------------ */
/* Retrouver le Puppeteer de pa11y-ci                                  */
/* ------------------------------------------------------------------ */

// Choisit le fichier d'entree d'un paquet a partir de son package.json.
function entreeDuPaquet(pkg) {
  const choisir = (e) => {
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') {
      for (const cle of ['import', 'node', 'default', 'require']) {
        if (e[cle]) return choisir(e[cle]);
      }
    }
    return null;
  };
  const exp = pkg.exports && (typeof pkg.exports === 'string' || !pkg.exports['.'])
    ? pkg.exports
    : pkg.exports && pkg.exports['.'];
  return choisir(exp) || pkg.module || pkg.main || 'index.js';
}

// Liste les dossiers ou Puppeteer peut se trouver, en remontant depuis pa11y-ci,
// comme le fait Node pour resoudre un module.
function dossiersCandidats() {
  const candidats = [];
  if (process.env.A11Y_PUPPETEER) candidats.push(process.env.A11Y_PUPPETEER);

  let binaire;
  try {
    binaire = fs.realpathSync(execSync('command -v pa11y-ci', { shell: '/bin/sh' }).toString().trim());
  } catch (erreur) {
    return candidats;
  }

  let dossier = path.dirname(binaire);
  while (dossier !== path.dirname(dossier)) {
    candidats.push(path.join(dossier, 'node_modules', 'puppeteer'));
    candidats.push(path.join(dossier, 'node_modules', 'pa11y', 'node_modules', 'puppeteer'));
    dossier = path.dirname(dossier);
  }
  return candidats;
}

async function chargerPuppeteer() {
  for (const dossier of dossiersCandidats()) {
    const fichierPkg = path.join(dossier, 'package.json');
    if (!fs.existsSync(fichierPkg)) continue;
    const pkg = JSON.parse(fs.readFileSync(fichierPkg, 'utf8'));
    const entree = path.join(dossier, entreeDuPaquet(pkg));
    const module = await import(pathToFileURL(entree).href);
    return module.default || module;
  }
  throw new Error(
    "Puppeteer introuvable. pa11y-ci est-il installe ? "
    + "(en local : npm install -g pa11y-ci pa11y-ci-reporter-html)"
  );
}

/* ------------------------------------------------------------------ */

function lireUrls() {
  if (process.env.A11Y_URL) return process.env.A11Y_URL.split(',').filter(Boolean);
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  return (config.urls || [])
    .map((u) => (typeof u === 'string' ? u : u && u.url))
    .filter(Boolean);
}

// pa11y peut enregistrer la page avec ou sans ".html" ou "/" final.
function cleDuRapport(rapport, url) {
  const normaliser = (u) => u.replace(/(\.html|\/)$/, '');
  if (rapport.results[url]) return url;
  return Object.keys(rapport.results).find((k) => normaliser(k) === normaliser(url)) || null;
}

function lireRapport() {
  if (fs.existsSync(RAPPORT)) {
    return JSON.parse(fs.readFileSync(RAPPORT, 'utf8'));
  }
  // pa11y n'a rien produit : on part d'un rapport vide.
  return { total: 0, passes: 0, errors: 0, results: {} };
}

async function main() {
  const urls = lireUrls();
  if (urls.length === 0) {
    console.error(`Aucune URL dans ${CONFIG}.`);
    process.exit(1);
  }

  const puppeteer = await chargerPuppeteer();
  const navigateur = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const rapport = lireRapport();
  rapport.results = rapport.results || {};
  let ajouts = 0;
  let erreursAjoutees = 0;
  let echecs = 0;
  let requalifiees = 0;
  let erreursRetirees = 0;

  async function analyser(page, url) {
    await page.setViewport({ width: 1280, height: 1024 });
    const reponse = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, ATTENTE_MS));
    const redirection = await verifierChargement(page, url, reponse);
    if (redirection) console.log(` > ${url} - attention : redirigee vers ${redirection}, c'est cette page qui est analysee`);

    const cle = cleDuRapport(rapport, url);
    if (rapport.results[cle]) {
      const avant = rapport.results[cle];
      const apres = await requalifierAnomalies(page, avant);
      const changees = apres.filter((a, i) => a !== avant[i]).length;
      requalifiees += changees;
      erreursRetirees += avant.filter((a, i) => a.type === 'error' && apres[i].type !== 'error').length;
      rapport.results[cle] = apres;
    }

    const anomalies = await executerTestsBonus(page);
    const erreurs = anomalies.filter((a) => a.type === 'error').length;

    const cleBonus = cleDuRapport(rapport, url) || url;
    rapport.results[cleBonus] = [...(rapport.results[cleBonus] || []), ...anomalies];
    ajouts += anomalies.length;
    erreursAjoutees += erreurs;
    console.log(` > ${url} - ${erreurs} erreur(s), ${anomalies.length - erreurs} a verifier`);
  }

  console.log(`Tests bonus sous Chromium sur ${urls.length} page(s) :`);
  try {
    for (const url of urls) {
      const page = await navigateur.newPage();
      try {
        await avecDelai(analyser(page, url), url);
      } catch (erreur) {
        console.error(` > ${url} - echec : ${erreur.message}`);
        echecs += 1;
        const cle = cleDuRapport(rapport, url);
        if (erreur.pageInvalide && cle) {
          erreursRetirees += rapport.results[cle].filter((a) => a.type === 'error').length;
          delete rapport.results[cle];
        }
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await navigateur.close();
  }

  rapport.errors = Math.max(0, (rapport.errors || 0) - erreursRetirees) + erreursAjoutees;
  fs.writeFileSync(RAPPORT, JSON.stringify(rapport, null, 2), 'utf8');
  console.log(`${ajouts} anomalie(s) ajoutee(s) a ${RAPPORT}`);
  if (requalifiees > 0) {
    console.log(`${requalifiees} resultat(s) de pa11y requalifie(s) apres verification sur la page (voir le recapitulatif RGAA)`);
  }

  // Memes codes que pa11y-ci : 1 = panne, 2 = erreurs trouvees, 0 = rien.
  if (echecs > 0) process.exit(1);
  process.exit(erreursAjoutees > 0 ? 2 : 0);
}

main().catch((erreur) => {
  console.error(`Erreur fatale : ${erreur.message}`);
  process.exit(1);
});
