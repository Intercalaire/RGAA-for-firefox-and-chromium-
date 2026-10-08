#!/usr/bin/env node
'use strict';

/**
 * tests-bonus-chromium.js
 *
 * Execute les tests bonus (tests-bonus.js) sous Chromium, sur les pages
 * de pa11yci.json, puis ajoute leurs resultats au rapport pa11y-report.json.
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
const { executerTestsBonus } = require('./tests-bonus');

const CONFIG = './pa11yci.json';
const RAPPORT = './pa11y-report.json';
const ATTENTE_MS = 2000;

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

function lireUrls() {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  return (config.urls || [])
    .map((u) => (typeof u === 'string' ? u : u && u.url))
    .filter(Boolean);
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

  console.log(`Tests bonus sous Chromium sur ${urls.length} page(s) :`);
  try {
    for (const url of urls) {
      const page = await navigateur.newPage();
      try {
        await page.setViewport({ width: 1280, height: 1024 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise((r) => setTimeout(r, ATTENTE_MS));

        const anomalies = await executerTestsBonus(page);
        const erreurs = anomalies.filter((a) => a.type === 'error').length;

        rapport.results[url] = [...(rapport.results[url] || []), ...anomalies];
        ajouts += anomalies.length;
        erreursAjoutees += erreurs;
        console.log(` > ${url} - ${erreurs} erreur(s), ${anomalies.length - erreurs} a verifier`);
      } catch (erreur) {
        console.error(` > ${url} - echec : ${erreur.message}`);
        echecs += 1;
      } finally {
        await page.close();
      }
    }
  } finally {
    await navigateur.close();
  }

  rapport.errors = (rapport.errors || 0) + erreursAjoutees;
  fs.writeFileSync(RAPPORT, JSON.stringify(rapport, null, 2), 'utf8');
  console.log(`${ajouts} anomalie(s) ajoutee(s) a ${RAPPORT}`);

  // Memes codes que pa11y-ci : 1 = panne, 2 = erreurs trouvees, 0 = rien.
  if (echecs > 0) process.exit(1);
  process.exit(erreursAjoutees > 0 ? 2 : 0);
}

main().catch((erreur) => {
  console.error(`Erreur fatale : ${erreur.message}`);
  process.exit(1);
});
