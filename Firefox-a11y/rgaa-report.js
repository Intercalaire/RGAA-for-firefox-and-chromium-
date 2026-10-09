#!/usr/bin/env node
'use strict';

/**
 * rgaa-report.js
 *
 * Relit un rapport JSON au format pa11y et regroupe les anomalies
 * par thematique et par critere du RGAA 4.1.
 *
 * Usage :
 *   node rgaa-report.js [chemin/vers/a11y-report.json] [--json fichier.json] [--strict] [--code]
 *   --code : sortie 2 s'il reste des erreurs apres les resultats ecartes, 0 sinon
 *
 * Rappel important : il s'agit d'une TRADUCTION des regles WCAG remontees par
 * pa11y vers la nomenclature RGAA, pas d'un audit RGAA. Les outils automatiques
 * ne couvrent qu'une partie des 106 criteres du referentiel.
 */

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ */
/* 1. Thematiques du RGAA 4.1                                          */
/* ------------------------------------------------------------------ */

const THEMATIQUES = {
  1: 'Images',
  2: 'Cadres',
  3: 'Couleurs',
  4: 'Multimedia',
  5: 'Tableaux',
  6: 'Liens',
  7: 'Scripts',
  8: 'Elements obligatoires',
  9: 'Structuration de l\'information',
  10: 'Presentation de l\'information',
  11: 'Formulaires',
  12: 'Navigation',
  13: 'Consultation'
};

/* ------------------------------------------------------------------ */
/* 2. Correspondance regle axe -> critere RGAA                         */
/* ------------------------------------------------------------------ */

const AXE_VERS_RGAA = {
  // 1. Images
  'image-alt': '1.1',
  'input-image-alt': '1.1',
  'area-alt': '1.1',
  'role-img-alt': '1.1',
  'svg-img-alt': '1.1',
  'object-alt': '1.1',
  'image-redundant-alt': '1.2',
  'server-side-image-map': '7.3',

  // 2. Cadres
  'frame-title': '2.1',
  'frame-title-unique': '2.2',
  'frame-tested': '2.1',

  // 3. Couleurs
  'color-contrast': '3.2',
  'color-contrast-enhanced': '3.2',
  'link-in-text-block': '10.6',

  // 4. Multimedia
  'video-caption': '4.3',
  'audio-caption': '4.1',
  'no-autoplay-audio': '4.10',

  // 5. Tableaux
  'td-headers-attr': '5.7',
  'th-has-data-cells': '5.7',
  'table-fake-caption': '5.4',
  'table-duplicate-name': '5.4',
  'scope-attr-valid': '5.7',
  'empty-table-header': '5.6',
  'td-has-header': '5.7',
  'layout-table': '5.8',

  // 6. Liens
  'link-name': '6.2',
  'identical-links-same-purpose': '6.1',

  // 7. Scripts
  'aria-allowed-attr': '7.1',
  'aria-allowed-role': '7.1',
  'aria-command-name': '7.1',
  'aria-hidden-body': '7.1',
  'aria-hidden-focus': '7.1',
  'aria-input-field-name': '7.1',
  'aria-meter-name': '7.1',
  'aria-progressbar-name': '7.1',
  'aria-required-attr': '7.1',
  'aria-required-children': '7.1',
  'aria-required-parent': '7.1',
  'aria-roledescription': '7.1',
  'aria-roles': '7.1',
  'aria-toggle-field-name': '7.1',
  'aria-tooltip-name': '7.1',
  'aria-valid-attr': '7.1',
  'aria-valid-attr-value': '7.1',
  'aria-prohibited-attr': '7.1',
  'aria-dialog-name': '7.1',
  'aria-text': '7.1',
  'nested-interactive': '7.1',
  'scrollable-region-focusable': '7.3',
  'blink': '13.8',
  'marquee': '13.8',

  // 8. Elements obligatoires
  'html-has-lang': '8.3',
  'html-lang-valid': '8.4',
  'html-xml-lang-mismatch': '8.4',
  'valid-lang': '8.8',
  'document-title': '8.5',
  'duplicate-id': '8.2',
  'duplicate-id-active': '8.2',
  'duplicate-id-aria': '8.2',

  // 9. Structuration
  'heading-order': '9.1',
  'empty-heading': '9.1',
  'page-has-heading-one': '9.1',
  'list': '9.3',
  'listitem': '9.3',
  'definition-list': '9.3',
  'dlitem': '9.3',
  'p-as-heading': '9.1',

  // 10. Presentation
  'meta-viewport': '10.4',
  'meta-viewport-large': '10.4',
  'avoid-inline-spacing': '10.12',
  'focus-order-semantics': '10.7',

  // 11. Formulaires
  'label': '11.1',
  'label-title-only': '11.1',
  'form-field-multiple-labels': '11.1',
  'select-name': '11.1',
  'input-button-name': '11.9',
  'button-name': '11.9',
  'autocomplete-valid': '11.13',
  'aria-required-children-form': '11.1',

  // 12. Navigation
  'bypass': '12.7',
  'skip-link': '12.7',
  'region': '12.6',
  'landmark-one-main': '12.6',
  'landmark-banner-is-top-level': '12.6',
  'landmark-complementary-is-top-level': '12.6',
  'landmark-contentinfo-is-top-level': '12.6',
  'landmark-main-is-top-level': '12.6',
  'landmark-no-duplicate-banner': '12.6',
  'landmark-no-duplicate-contentinfo': '12.6',
  'landmark-no-duplicate-main': '12.6',
  'landmark-unique': '12.6',
  'tabindex': '12.8',
  'accesskeys': '12.10',

  // Tests bonus (tests-bonus.js)
  'kit-focus-visible': '10.7',
  'kit-lien-vague': '6.1',
  'kit-alt-suspect': '1.3',
  'kit-titres-sauts': '9.1',
  'kit-piege-clavier': '12.9',
  'kit-reflow-320': '10.11',
  'kit-lien-evitement': '12.7',
  'kit-clic-sans-clavier': '7.3',
  'kit-image-decorative': '1.2',
  'kit-svg-ambigu': '1.2',
  'kit-alt-long': '1.3',
  'kit-alt-redondant': '1.3',
  'kit-alt-identique': '1.3',
  'kit-captcha': '1.5',
  'kit-description-absente': '1.6',
  'kit-legende': '1.9',
  'kit-contraste-image': '3.2',
  'kit-contraste-composant': '3.3',
  'kit-doctype': '8.1',
  'kit-presentation-html': '10.1',
  'kit-structure': '9.2',
  'kit-fausse-liste': '9.3',
  'kit-tableau-resume': '5.1',
  'kit-tableau-titre': '5.4',
  'kit-tableau-mise-en-forme': '5.8',
  'kit-cadre-titre': '2.2',
  'kit-sens-lecture': '8.10',
  'kit-groupe-champs': '11.5',
  'kit-groupe-legende': '11.6',
  'kit-obligatoire': '11.10',
  'kit-autocomplete': '11.13',
  'kit-document': '13.3',
  'kit-emoji': '13.5',
  'kit-titre-h1': '9.1',
  'kit-titre-vide': '9.1',
  'kit-reperes': '12.6',
  'kit-tabindex': '12.8',
  'kit-motif-aria': '7.1',
  'kit-motif-clavier': '7.3',
  'kit-clavier-composant': '7.3',
  'kit-intitule-lien': '6.1',
  'kit-intitule-composant': '7.1',
  'kit-intitule-bouton': '11.9',
  'kit-intitule-champ': '11.2',
  'kit-optgroup': '11.8',
  'kit-etiquette-accolee': '11.4',
  'kit-media-controles': '4.11',
  'kit-mouvement': '13.8',
  'kit-nouvelle-fenetre': '13.2',
  'kit-espacement': '10.12',

  // 13. Consultation
  'meta-refresh': '13.1',
  'meta-refresh-no-exceptions': '13.1'
};

/* ------------------------------------------------------------------ */
/* 3. Correspondance critere de succes WCAG -> critere RGAA            */
/*    (utilisee pour les codes HTML_CodeSniffer, qui contiennent       */
/*     le numero du critere WCAG, par exemple ...Guideline1_1.1_1_1)   */
/* ------------------------------------------------------------------ */

const WCAG_VERS_RGAA = {
  '1.1.1': '1.1',
  '1.2.1': '4.1',
  '1.2.2': '4.3',
  '1.2.3': '4.1',
  '1.2.4': '4.3',
  '1.2.5': '4.5',
  '1.3.1': '9.1',
  '1.3.2': '10.3',
  '1.3.3': '10.9',
  '1.3.4': '10.11',
  '1.3.5': '11.13',
  '1.4.1': '3.1',
  '1.4.2': '4.10',
  '1.4.3': '3.2',
  '1.4.4': '10.4',
  '1.4.5': '1.8',
  '1.4.10': '10.11',
  '1.4.11': '3.3',
  '1.4.12': '10.12',
  '1.4.13': '10.13',
  '2.1.1': '7.3',
  '2.1.2': '12.9',
  '2.2.1': '13.1',
  '2.2.2': '13.8',
  '2.4.1': '12.7',
  '2.4.2': '8.5',
  '2.4.3': '12.8',
  '2.4.4': '6.1',
  '2.4.5': '12.1',
  '2.4.6': '9.1',
  '2.4.7': '10.7',
  '2.5.3': '11.2',
  '3.1.1': '8.3',
  '3.1.2': '8.7',
  '3.2.1': '7.4',
  '3.2.2': '7.4',
  '3.2.3': '12.2',
  '3.2.4': '11.3',
  '3.3.1': '11.10',
  '3.3.2': '11.1',
  '3.3.3': '11.10',
  '3.3.4': '11.10',
  '4.1.1': '8.2',
  '4.1.2': '7.1',
  '4.1.3': '7.5'
};

/* ------------------------------------------------------------------ */
/* 4. Libelles des criteres RGAA les plus frequents                    */
/* ------------------------------------------------------------------ */

const LIBELLES_CRITERES = {
  '1.1': 'Chaque image porteuse d\'information a-t-elle une alternative textuelle ?',
  '1.2': 'Chaque image de decoration est-elle correctement ignoree ?',
  '1.3': 'L\'alternative textuelle de chaque image porteuse d\'information est-elle pertinente ?',
  '1.4': 'L\'alternative d\'une image CAPTCHA permet-elle d\'en identifier la nature et la fonction ?',
  '1.5': 'Chaque CAPTCHA a-t-il une solution d\'acces alternatif ?',
  '1.6': 'Chaque image porteuse d\'information a-t-elle, si necessaire, une description detaillee ?',
  '1.9': 'Chaque legende d\'image est-elle correctement reliee a l\'image ?',
  '1.8': 'Chaque image texte est-elle remplacee par du texte stylise ?',
  '2.1': 'Chaque cadre a-t-il un titre de cadre ?',
  '2.2': 'Le titre de chaque cadre est-il pertinent ?',
  '3.1': 'L\'information ne doit pas etre donnee uniquement par la couleur.',
  '3.2': 'Le contraste entre le texte et son arriere-plan est-il suffisant ?',
  '3.3': 'Les couleurs des elements d\'interface sont-elles suffisamment contrastees ?',
  '4.1': 'Chaque media temporel a-t-il une transcription ou des sous-titres ?',
  '4.3': 'Chaque media temporel pre-enregistre a-t-il des sous-titres synchronises ?',
  '5.1': 'Chaque tableau de donnees complexe a-t-il un resume ?',
  '4.5': 'Chaque media temporel a-t-il, si necessaire, une audiodescription synchronisee ?',
  '4.11': 'La consultation de chaque media temporel est-elle controlable par le clavier et la souris ?',
  '4.10': 'Chaque son declenche automatiquement est-il controlable ?',
  '5.3': 'Un tableau de mise en forme reste-t-il comprehensible en linearisant ?',
  '5.4': 'Chaque tableau de donnees a-t-il un titre ?',
  '5.6': 'Les en-tetes de colonnes et de lignes sont-ils correctement declares ?',
  '5.7': 'La technique de liaison entre cellules et en-tetes est-elle pertinente ?',
  '5.8': 'Un tableau de mise en forme n\'utilise-t-il aucun element propre aux tableaux de donnees ?',
  '6.1': 'Chaque lien est-il explicite ?',
  '6.2': 'Chaque lien a-t-il un intitule ?',
  '7.1': 'Chaque script est-il compatible avec les technologies d\'assistance ?',
  '7.3': 'Chaque script est-il controlable par le clavier et la souris ?',
  '7.4': 'Chaque script qui change le contexte previent-il l\'utilisateur ?',
  '7.5': 'Les messages de statut sont-ils correctement restitues ?',
  '8.1': 'Chaque page web est-elle definie par un type de document ?',
  '8.2': 'Le code source est-il valide selon le type de document ?',
  '8.3': 'La langue par defaut est-elle presente ?',
  '8.4': 'Le code de langue est-il pertinent ?',
  '8.5': 'Chaque page a-t-elle un titre de page ?',
  '8.7': 'Les changements de langue sont-ils indiques dans le code ?',
  '8.8': 'Le code de langue de chaque changement de langue est-il valide et pertinent ?',
  '9.1': 'L\'information est-elle structuree par des titres pertinents ?',
  '8.10': 'Les changements du sens de lecture sont-ils signales ?',
  '9.2': 'La structure du document est-elle coherente ?',
  '9.3': 'Chaque liste est-elle correctement structuree ?',
  '10.1': 'Des feuilles de styles sont-elles utilisees pour controler la presentation ?',
  '10.3': 'L\'information reste-t-elle comprehensible sans les feuilles de style ?',
  '10.4': 'Le texte reste-t-il lisible a 200 % de zoom ?',
  '10.6': 'Chaque lien dont la nature n\'est pas evidente est-il visible par rapport au texte ?',
  '10.7': 'La prise de focus est-elle visible ?',
  '10.9': 'L\'information n\'est-elle pas donnee uniquement par la forme, la taille ou la position ?',
  '10.11': 'Le contenu est-il presentable sans defilement bidirectionnel ?',
  '10.12': 'Les proprietes d\'espacement du texte sont-elles redefinissables ?',
  '10.13': 'Les contenus additionnels au survol sont-ils controlables ?',
  '11.1': 'Chaque champ de formulaire a-t-il une etiquette ?',
  '11.2': 'Chaque etiquette associee a un champ est-elle pertinente ?',
  '11.3': 'Les etiquettes des champs de meme fonction sont-elles coherentes ?',
  '11.4': 'Chaque etiquette de champ et son champ sont-ils accoles ?',
  '11.5': 'Les champs de meme nature sont-ils regroupes, si necessaire ?',
  '11.6': 'Chaque regroupement de champs a-t-il une legende ?',
  '11.8': 'Les items de meme nature d\'une liste de choix sont-ils regroupes de maniere pertinente ?',
  '11.9': 'L\'intitule de chaque bouton est-il pertinent ?',
  '11.10': 'Le controle de saisie est-il utilise de maniere pertinente ?',
  '11.13': 'La saisie peut-elle etre completee automatiquement ?',
  '12.1': 'Chaque ensemble de pages a-t-il deux systemes de navigation ?',
  '12.2': 'La navigation est-elle identique dans tout l\'ensemble de pages ?',
  '12.3': 'La page « plan du site » est-elle pertinente ?',
  '12.6': 'Les zones de regroupement de contenus sont-elles atteignables ?',
  '12.7': 'Un lien d\'evitement est-il present en debut de page ?',
  '12.8': 'L\'ordre de tabulation est-il coherent ?',
  '12.9': 'La navigation ne contient-elle aucun piege au clavier ?',
  '12.10': 'Les raccourcis clavier sont-ils controlables ?',
  '13.1': 'L\'utilisateur garde-t-il le controle des limites de temps ?',
  '13.2': 'L\'ouverture d\'une nouvelle fenetre est-elle declenchee par une action de l\'utilisateur ?',
  '13.3': 'Chaque document bureautique en telechargement a-t-il, si necessaire, une version accessible ?',
  '13.5': 'Chaque contenu cryptique (art ASCII, emoticone...) a-t-il une alternative ?',
  '13.8': 'Les contenus en mouvement sont-ils controlables ?'
};

/* ------------------------------------------------------------------ */
/* 4 bis. Exceptions pour certaines techniques HTML_CodeSniffer        */
/*        Un meme critere WCAG peut couvrir plusieurs thematiques      */
/*        RGAA ; la technique employee permet de trancher.             */
/*        La cle est le fragment de technique present dans le code     */
/*        (par exemple "H64" dans ...2_4_1.H64.1).                     */
/* ------------------------------------------------------------------ */

const TECHNIQUES_VERS_RGAA = {
  H64: '2.1',   // titre de cadre (iframe), et non lien d'evitement
  H67: '1.2',   // image decorative (alt vide) avec un title
  H63: '5.7',   // attribut scope dans un tableau
  H43: '5.7',   // liaison headers / id
  H39: '5.4',   // caption de tableau
  H73: '5.4',   // attribut summary
  H44: '11.1',  // label associe a un champ
  H71: '11.6',  // fieldset sans legend
  F92: '5.8',   // role presentation sur un element qui garde une semantique (tableau)
  F68: '11.1',  // champ de formulaire sans etiquette
  H65: '11.1',  // title sur un champ sans label
  H32: '7.4',   // formulaire sans bouton d'envoi : changement de contexte a la saisie
  H30: '6.2',   // intitule de lien
  H25: '8.5',   // titre de page
  H57: '8.3',   // langue par defaut
  H42: '9.1',   // titres de section
  H48: '9.3',   // listes
  F40: '13.1',  // rafraichissement automatique
  F41: '13.1'   // redirection automatique
};

/* ------------------------------------------------------------------ */
/* 4 ter. Technique H91 de HTML_CodeSniffer                            */
/*        Elle verifie le nom accessible de tout element interactif,   */
/*        et passe par le WCAG 4.1.2 (critere 7.1). Le sous-type       */
/*        present dans le code indique la vraie thematique RGAA.       */
/* ------------------------------------------------------------------ */

const H91_VERS_RGAA = [
  ['.H91.A.', '6.2'],         // lien sans intitule
  ['.H91.Button', '11.9'],    // bouton sans intitule
  ['.H91.Fieldset', '11.6'],  // regroupement sans legende
  ['.H91.Input', '11.1'],     // champ de saisie sans etiquette
  ['.H91.Select', '11.1'],    // liste deroulante sans etiquette
  ['.H91.Textarea', '11.1']   // zone de texte sans etiquette
];

/* ------------------------------------------------------------------ */
/* 5. Resolution d'une anomalie vers un critere RGAA                   */
/* ------------------------------------------------------------------ */

function resoudreCritere(anomalie) {
  const code = String(anomalie.code || '');

  // Cas 1 : regle axe (code court, sans point, du type "image-alt")
  if (AXE_VERS_RGAA[code]) {
    return { critere: AXE_VERS_RGAA[code], source: 'axe' };
  }

  // Cas 2 : technique H91, classee selon le type d'element
  const h91 = H91_VERS_RGAA.find(([motif]) => code.includes(motif));
  if (h91) {
    return { critere: h91[1], source: 'technique H91' };
  }

  // Cas 3 : technique HTML_CodeSniffer connue (prioritaire sur le WCAG seul)
  const technique = code.match(/\.((?:H|F|G|SCR|ARIA)\d+)(?:[.,]|$)/);
  if (technique && technique[1] === 'F92' && !/^<table/i.test(anomalie.context || '')) {
    return { critere: '7.1', source: 'technique F92' };
  }
  if (technique && TECHNIQUES_VERS_RGAA[technique[1]]) {
    return {
      critere: TECHNIQUES_VERS_RGAA[technique[1]],
      source: `technique ${technique[1]}`
    };
  }

  // Cas 4 : code HTML_CodeSniffer, on extrait le critere WCAG (ex. 1_1_1)
  const correspondance = code.match(/\.(\d+)_(\d+)_(\d+)(?:\.|$)/);
  if (correspondance) {
    const wcag = `${correspondance[1]}.${correspondance[2]}.${correspondance[3]}`;
    if (WCAG_VERS_RGAA[wcag]) {
      return { critere: WCAG_VERS_RGAA[wcag], source: `WCAG ${wcag}` };
    }
    return { critere: null, source: `WCAG ${wcag}` };
  }

  return { critere: null, source: anomalie.runner || 'inconnu' };
}

/* ------------------------------------------------------------------ */
/* 6. Lecture du rapport pa11y                                         */
/* ------------------------------------------------------------------ */

function lireRapport(chemin) {
  if (!fs.existsSync(chemin)) {
    console.error(`Rapport introuvable : ${chemin}`);
    console.error('Lancez d\'abord le test d\'accessibilite, puis relancez ce script.');
    process.exit(1);
  }

  let brut;
  try {
    brut = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  } catch (erreur) {
    console.error(`Le fichier ${chemin} n'est pas un JSON valide : ${erreur.message}`);
    process.exit(1);
  }

  // pa11y-ci : { total, passes, errors, results: { url: [anomalies] } }
  // pa11y simple : [anomalies]
  const anomalies = [];

  if (Array.isArray(brut)) {
    brut.forEach((a) => anomalies.push({ ...a, url: '(page unique)' }));
  } else if (brut.results && typeof brut.results === 'object') {
    Object.entries(brut.results).forEach(([url, liste]) => {
      (liste || []).forEach((a) => anomalies.push({ ...a, url }));
    });
  } else {
    console.error('Structure de rapport non reconnue.');
    process.exit(1);
  }

  return { anomalies, meta: Array.isArray(brut) ? {} : brut };
}

/* ------------------------------------------------------------------ */
/* 7. Regroupement                                                     */
/* ------------------------------------------------------------------ */

// Un meme element signale pour le meme critere par plusieurs regles (axe et
// htmlcs, ou un outil et un test bonus) n'est compte qu'une fois. On le
// reconnait a son selecteur, ou a defaut a un extrait de code identique.
function fusionnerDoublons(anomalies) {
  // Les attributs data-kit-* sont poses par les tests bonus pendant le test.
  const extrait = (a) => String(a.context || '').replace(/ data-kit-[a-z-]+="[^"]*"/g, '')
    .replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  // htmlcs coupe ses extraits : "<fieldset><input type="checkbo...</fieldset>".
  const memeExtrait = (x, y) => {
    if (!x || !y) return false;
    const coupeX = x.includes('...');
    const coupeY = y.includes('...');
    if (coupeX && coupeY) return x === y;
    if (coupeX || coupeY) {
      const [coupe, entier] = coupeX ? [x, y] : [y, x];
      const debut = coupe.split('...')[0];
      return debut.length >= 25 && entier.startsWith(debut);
    }
    const [court, long] = x.length <= y.length ? [x, y] : [y, x];
    return court === long || (court.length >= 80 && long.startsWith(court));
  };
  const gardees = [];
  const parPage = new Map();
  let fusions = 0;
  anomalies.forEach((a) => {
    const { critere } = resoudreCritere(a);
    if (!critere) { gardees.push(a); return; }
    const cle = a.url + ' ' + critere;
    const voisines = parPage.get(cle) || [];
    const autreRegle = (k) => k.code !== a.code && !(k.aussi || []).includes(a.code);
    const double = voisines.find((k) => autreRegle(k) && a.selector && k.selector === a.selector)
      || voisines.find((k) => autreRegle(k) && memeExtrait(extrait(k), extrait(a)));
    if (double) {
      double.aussi = [...(double.aussi || []), a.code];
      if ((a.type || 'error') === 'error') double.type = 'error';
      fusions += 1;
      return;
    }
    const copie = { ...a };
    voisines.push(copie);
    parPage.set(cle, voisines);
    gardees.push(copie);
  });
  return { anomalies: gardees, fusions };
}

function regrouper(anomalies) {
  const parCritere = new Map();
  const nonClassees = [];

  anomalies.forEach((anomalie) => {
    const { critere, source } = resoudreCritere(anomalie);

    if (!critere) {
      nonClassees.push({ ...anomalie, source });
      return;
    }

    if (!parCritere.has(critere)) {
      parCritere.set(critere, {
        critere,
        thematique: Number(critere.split('.')[0]),
        libelle: LIBELLES_CRITERES[critere] || '(libelle non renseigne)',
        occurrences: []
      });
    }

    parCritere.get(critere).occurrences.push({
      url: anomalie.url,
      type: anomalie.type || 'error',
      message: anomalie.message,
      selecteur: anomalie.selector,
      contexte: anomalie.context,
      code: anomalie.code,
      aussi: anomalie.aussi,
      runner: anomalie.runner
    });
  });

  // Regroupement par thematique
  const parThematique = new Map();
  parCritere.forEach((entree) => {
    const num = entree.thematique;
    if (!parThematique.has(num)) {
      parThematique.set(num, {
        numero: num,
        nom: THEMATIQUES[num] || 'Thematique inconnue',
        criteres: []
      });
    }
    parThematique.get(num).criteres.push(entree);
  });

  // Tri : thematiques par numero, criteres par numero
  const resultat = [...parThematique.values()].sort((a, b) => a.numero - b.numero);
  resultat.forEach((t) => {
    t.criteres.sort((a, b) => {
      const na = Number(a.critere.split('.')[1]);
      const nb = Number(b.critere.split('.')[1]);
      return na - nb;
    });
  });

  return { thematiques: resultat, nonClassees };
}

/* ------------------------------------------------------------------ */
/* 8. Affichage console                                                */
/* ------------------------------------------------------------------ */

const COULEURS = process.stdout.isTTY && !process.env.NO_COLOR
  ? { gras: '\x1b[1m', rouge: '\x1b[31m', jaune: '\x1b[33m', vert: '\x1b[32m', gris: '\x1b[90m', fin: '\x1b[0m' }
  : { gras: '', rouge: '', jaune: '', vert: '', gris: '', fin: '' };

function tronquer(texte, longueur) {
  if (!texte) return '';
  const propre = String(texte).replace(/\s+/g, ' ').trim();
  return propre.length > longueur ? `${propre.slice(0, longueur - 1)}…` : propre;
}

function afficher(groupes, anomalies, detaille, ecartees = [], fusions = 0) {
  const c = COULEURS;
  const totalErreurs = anomalies.filter((a) => (a.type || 'error') === 'error').length;
  const totalAutres = anomalies.length - totalErreurs;
  const urls = new Set(anomalies.map((a) => a.url));

  console.log('');
  console.log(`${c.gras}RECAPITULATIF PAR CRITERE RGAA 4.1${c.fin}`);
  console.log('='.repeat(60));
  console.log(`Anomalies : ${c.rouge}${totalErreurs} erreur(s)${c.fin}` +
    (totalAutres ? `, ${totalAutres} avertissement(s)/note(s)` : '') +
    ` sur ${urls.size} page(s)`);
  console.log('');

  if (groupes.thematiques.length === 0) {
    console.log(`${c.vert}Aucune anomalie rattachee a un critere RGAA.${c.fin}`);
  }

  groupes.thematiques.forEach((thematique) => {
    const total = thematique.criteres.reduce((n, cr) => n + cr.occurrences.length, 0);
    console.log(`${c.gras}${thematique.numero}. ${thematique.nom}${c.fin} ${c.gris}(${total})${c.fin}`);

    thematique.criteres.forEach((critere) => {
      console.log(`  ${c.rouge}Critere ${critere.critere}${c.fin} ` +
        `${c.gris}x${critere.occurrences.length}${c.fin}`);
      console.log(`    ${critere.libelle}`);

      const aAfficher = detaille ? critere.occurrences : critere.occurrences.slice(0, 3);
      aAfficher.forEach((o) => {
        console.log(`    ${c.gris}- ${tronquer(o.selecteur, 60)}${c.fin}`);
        if (detaille) {
          console.log(`      ${c.gris}${tronquer(o.contexte, 70)}${c.fin}`);
          console.log(`      ${c.gris}${o.url}${c.fin}`);
        }
      });
      if (!detaille && critere.occurrences.length > 3) {
        console.log(`    ${c.gris}  … et ${critere.occurrences.length - 3} autre(s)${c.fin}`);
      }
      console.log('');
    });
  });

  if (groupes.nonClassees.length > 0) {
    console.log(`${c.jaune}Non rattachees a un critere RGAA (${groupes.nonClassees.length})${c.fin}`);
    console.log(`${c.gris}Completez les tables du script pour les classer.${c.fin}`);
    const codes = new Map();
    groupes.nonClassees.forEach((a) => {
      codes.set(a.code, (codes.get(a.code) || 0) + 1);
    });
    [...codes.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([code, n]) => console.log(`  ${c.gris}- ${tronquer(code, 70)} (x${n})${c.fin}`));
    console.log('');
  }

  if (fusions > 0) {
    console.log(`${c.gris}Doublons fusionnes (meme element signale par plusieurs regles) : ${fusions}${c.fin}`);
    console.log('');
  }

  if (ecartees.length > 0) {
    const raisons = new Map();
    ecartees.forEach((a) => raisons.set(a.nonApplicable, (raisons.get(a.nonApplicable) || 0) + 1));
    console.log(`${c.gris}Ecartees apres verification sur la page (non applicables) : ${ecartees.length}${c.fin}`);
    [...raisons.entries()].forEach(([raison, n]) => console.log(`  ${c.gris}- ${raison} (x${n})${c.fin}`));
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(`${c.jaune}Rappel : ce recapitulatif traduit des regles WCAG vers la${c.fin}`);
  console.log(`${c.jaune}nomenclature RGAA. Il ne constitue pas un audit : les outils${c.fin}`);
  console.log(`${c.jaune}automatiques ne couvrent qu'une partie des 106 criteres.${c.fin}`);
  console.log('');
}

/* ------------------------------------------------------------------ */
/* 9. Point d'entree                                                   */
/* ------------------------------------------------------------------ */

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const detaille = args.includes('--detail');

  const indexJson = args.indexOf('--json');
  const sortieJson = indexJson !== -1 ? args[indexJson + 1] : null;

  const positionnels = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (indexJson !== -1 && i === indexJson + 1) return false;
    return true;
  });
  const chemin = path.resolve(positionnels[0] || './a11y-report.json');

  const { anomalies: toutes } = lireRapport(chemin);
  // Resultats d'outils ecartes apres verification sur la page reelle.
  const ecartees = toutes.filter((a) => a.nonApplicable);
  const { anomalies, fusions } = fusionnerDoublons(toutes.filter((a) => !a.nonApplicable));
  const groupes = regrouper(anomalies);

  afficher(groupes, anomalies, detaille, ecartees, fusions);

  if (sortieJson) {
    const contenu = {
      genereLe: new Date().toISOString(),
      source: chemin,
      totalAnomalies: anomalies.length,
      doublonsFusionnes: fusions,
      avertissement: 'Traduction WCAG vers RGAA. Ne constitue pas un audit RGAA.',
      thematiques: groupes.thematiques,
      nonClassees: groupes.nonClassees,
      nonApplicables: ecartees.map((a) => ({
        url: a.url, raison: a.nonApplicable, code: a.code, message: a.message, selecteur: a.selector
      }))
    };
    fs.writeFileSync(sortieJson, JSON.stringify(contenu, null, 2), 'utf8');
    console.log(`Recapitulatif ecrit dans ${sortieJson}`);
  }

  // --code : 2 s'il reste des erreurs une fois les resultats ecartes retires, 0 sinon.
  const erreurs = anomalies.filter((a) => (a.type || 'error') === 'error').length;
  if (args.includes('--code')) process.exit(erreurs > 0 ? 2 : 0);
  process.exit(strict && erreurs > 0 ? 1 : 0);
}

main();
