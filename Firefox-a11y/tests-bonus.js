'use strict';

const fs = require('fs');
const zlib = require('zlib');

/**
 * tests-bonus.js
 *
 * Tests d'accessibilite complementaires d'axe et htmlcs, communs aux kits
 * Firefox (Playwright) et Chromium (Puppeteer). Seules page.evaluate et
 * page.keyboard.press sont utilisees, plus le changement de largeur de fenetre
 * (changerLargeur), seule commande qui differe entre les deux outils : le
 * fichier est donc identique dans les deux kits.
 *
 * Les anomalies sont rendues au format pa11y, avec runner "bonus", et des
 * codes "kit-..." que rgaa-report.js rattache aux criteres RGAA.
 *
 * Ces tests sont des heuristiques : ils signalent des cas tres probables,
 * mais peuvent se tromper. Ils ne remplacent pas une verification humaine.
 */

// Nombre maximal de tabulations par page, pour ne jamais boucler sans fin.
const MAX_TABULATIONS = 200;

const MAX_IGNORES_CONSECUTIFS = 30;

// Largeur imposee par le critere 10.11 (equivaut a un zoom de 400 %).
const LARGEUR_REFLOW = 320;

// Au-dela, une alternative devrait plutot devenir une description detaillee (1.6).
const ALT_MAX = 120;

// Nombre maximal de textes sur image mesures par page (3.2), une capture chacun.
const MAX_CONTRASTES = 30;

// Intitules de liens non explicites hors contexte (critere 6.1).
const LIENS_VAGUES = [
  'cliquez ici', 'cliquer ici', 'ici', 'en savoir plus', 'savoir plus',
  'lire la suite', 'la suite', 'suite', 'voir plus', 'plus', 'lien',
  'click here', 'here', 'read more', 'more', 'learn more'
];

// Alternatives d'images qui ne decrivent rien (critere 1.3).
const ALTS_SUSPECTS = [
  'image', 'img', 'photo', 'photographie', 'picture', 'illustration',
  'logo', 'icone', 'icône', 'icon', 'graphique', 'visuel', 'banniere', 'bannière'
];

function pagePreparer() {
  window.__kitApparence = function (el) {
    const traitVisible = (style, epaisseur) => style !== 'none' && style !== 'hidden' && parseFloat(epaisseur) > 0;
    const traits = (s) => {
      const contour = traitVisible(s.outlineStyle, s.outlineWidth)
        ? [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset].join(' ')
        : 'aucun';
      const bordure = (cote) => traitVisible(s['border' + cote + 'Style'], s['border' + cote + 'Width'])
        ? [s['border' + cote + 'Style'], s['border' + cote + 'Width'], s['border' + cote + 'Color']].join(' ')
        : 'aucune';
      return [contour, bordure('Top'), bordure('Bottom'), s.boxShadow, s.backgroundColor];
    };
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const apparence = [
      ...traits(s), s.color, s.textDecorationLine, s.opacity, s.transform, s.clipPath, s.visibility,
      Math.round(r.top + window.scrollY), Math.round(r.left + window.scrollX),
      Math.round(r.width), Math.round(r.height)
    ];
    // Indicateur porte par un pseudo-element ou par un parent (:focus-within), comme les cartes DSFR.
    ['::before', '::after'].forEach((pseudo) => {
      const p = getComputedStyle(el, pseudo);
      if (p.content !== 'none') apparence.push(...traits(p), p.opacity);
    });
    let parent = el.parentElement;
    for (let i = 0; parent && parent !== document.body && i < 5; i++, parent = parent.parentElement) {
      apparence.push(...traits(getComputedStyle(parent)));
    }
    return JSON.stringify(apparence);
  };

  window.__kitCouleurs = (function () {
    const lire = (c) => {
      if (!c || c === 'transparent') return [0, 0, 0, 0];
      const n = (c.match(/-?[\d.]+%?/g) || []).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : Number(v)));
      const alpha = n.length > 3 ? n[3] : 1;
      if (c.startsWith('rgb') && n.length >= 3) return [n[0], n[1], n[2], alpha];
      if (c.startsWith('color(srgb') && n.length >= 3) return [n[0] * 255, n[1] * 255, n[2] * 255, alpha];
      return null;
    };
    const melanger = (haut, bas) => {
      const a = haut[3];
      return [0, 1, 2].map((i) => haut[i] * a + bas[i] * (1 - a)).concat(1);
    };
    const luminance = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a, b) => {
      const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (h + 0.05) / (l + 0.05);
    };
    // Couleur de fond reellement visible derriere un element, ou null si une
    // image ou un degrade se trouve dessous.
    // Image de fond tres fine (soulignement des liens DSFR) : ce n'est pas un fond.
    const filet = (s) => s.backgroundSize.split(',')
      .every((t) => t.trim().split(/\s+/).some((v) => /^(0(px|%)?|[0-2](\.\d+)?px)$/.test(v)));
    const fond = (el) => {
      const couches = [];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage && s.backgroundImage !== 'none' && !filet(s)) return null;
        const c = lire(s.backgroundColor);
        if (!c) return null;
        if (c[3] > 0) couches.push(c);
        if (c[3] >= 1) break;
      }
      return couches.reduceRight((res, c) => melanger(c, res), [255, 255, 255, 1]);
    };
    return { lire, melanger, ratio, fond };
  })();

  window.__kitSelecteur = function (el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const morceaux = [];
    let courant = el;
    while (courant && courant.nodeType === 1 && courant !== document.body && morceaux.length < 4) {
      let morceau = courant.tagName.toLowerCase();
      const parent = courant.parentElement;
      if (parent) {
        const memes = Array.from(parent.children).filter((c) => c.tagName === courant.tagName);
        if (memes.length > 1) morceau += ':nth-of-type(' + (memes.indexOf(courant) + 1) + ')';
      }
      morceaux.unshift(morceau);
      courant = parent;
    }
    return morceaux.join(' > ') || el.tagName.toLowerCase();
  };

  if (!window.__kitEcoute) {
    window.__kitEcoute = true;
    document.addEventListener('focusout', () => { window.__kitHorsPage = true; }, true);
    document.addEventListener('focusin', () => { window.__kitHorsPage = false; }, true);
  }

  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  window.scrollTo(0, 0);
  window.__kitHorsPage = false;

  const selecteur = 'a[href], area[href], button, input:not([type="hidden"]), '
    + 'select, textarea, summary, [tabindex], [contenteditable="true"]';
  window.__kitRepos = {};
  // Ordre des elements reellement atteignables (affiches, actifs), pour
  // savoir lequel est le dernier de la page.
  window.__kitAtteignables = [];
  let numero = 0;
  document.querySelectorAll(selecteur).forEach((el) => {
    if (el.getAttribute('tabindex') === '-1') return;
    const id = 'k' + (numero++);
    el.setAttribute('data-kit-focus', id);
    window.__kitRepos[id] = window.__kitApparence(el);
    const affiche = el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    if (affiche && !el.disabled) window.__kitAtteignables.push(id);
  });
  return numero;
}

function pageEtatFocus() {
  const el = document.activeElement;
  if (window.__kitHorsPage || !el || el === document.body || el === document.documentElement) {
    return { fin: true };
  }
  const id = el.getAttribute('data-kit-focus');
  if (!id || !(id in window.__kitRepos)) {
    return { ignore: true };
  }
  return {
    id,
    visible: window.__kitApparence(el) !== window.__kitRepos[id],
    selecteur: window.__kitSelecteur(el),
    contexte: el.outerHTML.slice(0, 250),
    // Une fenetre modale ouverte a le droit de retenir le focus.
    dansModale: !!el.closest('[aria-modal="true"], dialog[open]'),
    // Dernier element atteignable : y rester apres Tab est la fin du parcours,
    // pas un piege. Firefox sans interface garde le focus dessus, sans aucun
    // evenement, car il n'a pas de barre d'adresse ou l'envoyer.
    dernier: window.__kitAtteignables[window.__kitAtteignables.length - 1] === id
  };
}

function pageTestsStatiques(listes) {
  const anomalies = [];
  const ajouter = (code, type, message, el) => anomalies.push({
    code, type, message,
    selector: window.__kitSelecteur(el),
    context: el.outerHTML.slice(0, 250)
  });
  const masque = (el) => {
    if (el.closest('[aria-hidden="true"]')) return true;
    const s = getComputedStyle(el);
    return s.display === 'none' || s.visibility === 'hidden';
  };

  // Liens dont l'intitule ne veut rien dire hors contexte (6.1).
  document.querySelectorAll('a[href]').forEach((a) => {
    if (masque(a)) return;
    const texte = (a.getAttribute('aria-label') || a.textContent || '')
      .replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.:!…]+$/, '');
    if (!texte || !listes.liensVagues.includes(texte)) return;
    const titre = (a.getAttribute('title') || '').trim();
    if (titre.length > texte.length) return;
    ajouter('kit-lien-vague', 'warning',
      'Intitule de lien non explicite hors contexte : "' + texte + '"', a);
  });

  // Alternatives d'images qui ne decrivent rien (1.3).
  document.querySelectorAll('img[alt], area[alt], input[type="image"][alt]').forEach((img) => {
    if (masque(img)) return;
    const alt = img.getAttribute('alt').trim();
    if (!alt) return;
    const bas = alt.toLowerCase();
    const fichier = (img.getAttribute('src') || img.getAttribute('href') || '')
      .split('/').pop().split('?')[0].toLowerCase();
    const sansExtension = fichier.replace(/\.[a-z0-9]+$/, '');
    const suspect = listes.altsSuspects.includes(bas)
      || /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(bas)
      || (fichier && (bas === fichier || bas === sansExtension));
    if (suspect) {
      ajouter('kit-alt-suspect', 'warning',
        'Alternative textuelle probablement non pertinente : "' + alt + '"', img);
    }
  });

  // Niveaux de titres sautes, par exemple h1 suivi directement de h4 (9.1).
  let precedent = 0;
  document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"][aria-level]').forEach((h) => {
    if (masque(h)) return;
    const niveau = h.getAttribute('aria-level')
      ? parseInt(h.getAttribute('aria-level'), 10)
      : parseInt(h.tagName.charAt(1), 10);
    if (!niveau) return;
    if (precedent && niveau > precedent + 1) {
      ajouter('kit-titres-sauts', 'warning',
        'Niveau de titre saute : h' + precedent + ' suivi de h' + niveau, h);
    }
    precedent = niveau;
  });

  // Lien d'evitement parmi les premiers elements atteints avec Tab (12.7).
  // Inutile si rien n'est focalisable avant le contenu principal.
  const principal = document.querySelector('main, [role="main"]');
  const atteignables = window.__kitAtteignables
    .map((id) => document.querySelector('[data-kit-focus="' + id + '"]'))
    .filter((el) => el && !el.closest('[role="dialog"], [aria-modal="true"], dialog'));
  const avantPrincipal = atteignables.filter((el) => !principal
    || (!principal.contains(el) && (principal.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)));
  if (avantPrincipal.length > 0) {
    const evitement = atteignables.slice(0, 3)
      .find((el) => el.matches('a[href^="#"]') && el.getAttribute('href').length > 1);
    if (!evitement) {
      ajouter('kit-lien-evitement', 'error',
        "Aucun lien d'evitement vers le contenu principal parmi les premiers elements atteints avec Tab",
        atteignables[0]);
    } else {
      const cible = decodeURIComponent(evitement.getAttribute('href').slice(1));
      if (!document.getElementById(cible) && document.getElementsByName(cible).length === 0) {
        ajouter('kit-lien-evitement', 'error',
          "La cible du lien d'evitement est introuvable : #" + cible, evitement);
      }
    }
  }

  // Elements cliquables a la souris mais impossibles a atteindre avec Tab (7.3).
  // Les roles des widgets composites (onglets, listes...) sont exclus : leurs
  // elements ont normalement tabindex="-1", sauf l'element actif.
  const ROLES_CLIQUABLES = ['button', 'link', 'checkbox', 'switch'];
  document.querySelectorAll('body *').forEach((el) => {
    if (el.closest('[data-kit-focus], label, select, [aria-hidden="true"]')) return;
    if (el.getClientRects().length === 0 || masque(el)) return;
    const script = el.hasAttribute('onclick') || ROLES_CLIQUABLES.includes(el.getAttribute('role'));
    if (script) {
      ajouter('kit-clic-sans-clavier', 'error',
        'Element cliquable a la souris mais impossible a atteindre avec Tab', el);
    } else if (getComputedStyle(el).cursor === 'pointer'
      && getComputedStyle(el.parentElement).cursor !== 'pointer') {
      ajouter('kit-clic-sans-clavier', 'warning',
        'Curseur en forme de main sur un element qui ne peut pas recevoir le focus clavier', el);
    }
  });

  return anomalies;
}

function pageTestsImages(listes) {
  const anomalies = [];
  const ajouter = (code, type, message, el) => anomalies.push({
    code, type, message,
    selector: window.__kitSelecteur(el),
    context: el.outerHTML.slice(0, 250)
  });
  const masque = (el) => {
    if (el.closest('[aria-hidden="true"]')) return true;
    const s = getComputedStyle(el);
    return el.getClientRects().length === 0 || s.visibility === 'hidden';
  };
  const texte = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const normal = (t) => texte(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1.2
  document.querySelectorAll('img[alt=""], img[role="presentation"], img[role="none"]').forEach((img) => {
    if (masque(img)) return;
    const attribut = ['alt', 'title', 'aria-label', 'aria-labelledby'].find((a) => texte(img.getAttribute(a)));
    if (attribut) {
      ajouter('kit-image-decorative', 'error',
        'Image decorative (alt vide ou role presentation) qui porte pourtant un texte : attribut ' + attribut, img);
    }
  });

  // 1.2
  document.querySelectorAll('svg').forEach((svg) => {
    if (svg.parentElement && svg.parentElement.closest('svg')) return;
    if (masque(svg) || svg.getAttribute('role') === 'img') return;
    const r = svg.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    ajouter('kit-svg-ambigu', 'warning',
      'SVG sans aria-hidden="true" (decoratif) ni role="img" et aria-label (porteur d\'information)', svg);
  });

  // 1.3
  const parAlt = new Map();
  document.querySelectorAll('img[alt]').forEach((img) => {
    const alt = texte(img.getAttribute('alt'));
    if (!alt || masque(img)) return;
    if (alt.length > listes.altMax) {
      ajouter('kit-alt-long', 'warning', 'Alternative de ' + alt.length
        + ' caracteres : la raccourcir et prevoir si besoin une description detaillee (1.6)', img);
    }
    const conteneur = img.closest('a, button, figure, p, li, td, th');
    if (conteneur) {
      const copie = conteneur.cloneNode(true);
      copie.querySelectorAll('img').forEach((i) => i.remove());
      if (normal(copie.textContent) === normal(alt)) {
        ajouter('kit-alt-redondant', 'warning',
          'Alternative identique au texte voisin : l\'image est probablement decorative (alt="")', img);
      }
    }
    const cle = normal(alt);
    if (!parAlt.has(cle)) parAlt.set(cle, new Map());
    parAlt.get(cle).set(img.currentSrc || img.getAttribute('src') || '', img);
  });
  parAlt.forEach((sources) => {
    if (sources.size < 2) return;
    sources.forEach((img) => ajouter('kit-alt-identique', 'warning', 'Meme alternative "'
      + texte(img.getAttribute('alt')) + '" pour ' + sources.size + ' images differentes', img));
  });

  // 1.4, 1.5
  const captchas = Array.from(document.querySelectorAll('iframe[src*="captcha" i], iframe[title*="captcha" i], '
    + '[class*="captcha" i], [id*="captcha" i], img[src*="captcha" i], img[alt*="captcha" i]'))
    .filter((el) => !masque(el));
  captchas
    .filter((el) => !captchas.some((autre) => autre !== el && autre.contains(el)))
    .forEach((el) => ajouter('kit-captcha', 'warning', 'CAPTCHA detecte : verifier son alternative (1.4) '
      + 'et la presence d\'un autre moyen d\'acces, audio ou autre (1.5)', el));

  // 1.6
  const complexe = /\b(graphiques?|graphs?|charts?|schemas?|diagrammes?|diagrams?|infographies?|infographics?|histogrammes?|organigrammes?|courbes?|camemberts?|cartographies?)\b/;
  const description = /description|transcription|version textuelle|version texte|donnees|tableau/;
  document.querySelectorAll('img, canvas, [role="img"]').forEach((el) => {
    if (masque(el) || el.getAttribute('alt') === '') return;
    const r = el.getBoundingClientRect();
    if (r.width < 100 || r.height < 100) return;
    const fichier = (el.getAttribute('src') || '').split('?')[0].split('/').pop();
    const indices = normal([fichier, ...['alt', 'class', 'title', 'aria-label'].map((a) => el.getAttribute(a) || '')]
      .join(' ')).replace(/[_\-.]/g, ' ');
    if (el.tagName !== 'CANVAS' && !complexe.test(indices)) return;
    const decrite = (el.getAttribute('aria-describedby') || '').split(/\s+/)
      .some((id) => id && document.getElementById(id) && texte(document.getElementById(id).textContent));
    const figure = el.closest('figure');
    const legende = figure && figure.querySelector('figcaption');
    const voisins = [el.nextElementSibling, el.parentElement && el.parentElement.nextElementSibling]
      .filter(Boolean);
    const aCote = voisins.some((v) => v.matches('details, table') || description.test(normal(v.textContent)));
    if (!decrite && !el.hasAttribute('longdesc') && !(legende && texte(legende.textContent)) && !aCote) {
      ajouter('kit-description-absente', 'warning',
        'Image complexe (graphique, schema...) sans description detaillee reperable', el);
    }
  });

  // 1.9
  document.querySelectorAll('figure').forEach((figure) => {
    const legende = figure.querySelector('figcaption');
    if (!legende || masque(figure)) return;
    if (!figure.querySelector('img, svg, [role="img"], canvas, object, embed')) return;
    const problemes = [];
    const role = figure.getAttribute('role');
    if (role !== 'figure' && role !== 'group') problemes.push('role="figure" ou role="group" absent');
    const label = texte(figure.getAttribute('aria-label'));
    if (!label) problemes.push('aria-label absent');
    else if (label !== texte(legende.textContent)) problemes.push('aria-label different de la legende');
    if (problemes.length) {
      ajouter('kit-legende', 'error', 'Image legendee mal reliee a sa legende : ' + problemes.join(', '), figure);
    }
  });

  return anomalies;
}

function pageTestsStructure() {
  const anomalies = [];
  const ajouter = (code, type, message, el) => anomalies.push({
    code, type, message,
    selector: window.__kitSelecteur(el),
    context: el.outerHTML.slice(0, 250)
  });
  const masque = (el) => el.closest('[aria-hidden="true"]') || el.getClientRects().length === 0
    || getComputedStyle(el).visibility === 'hidden';
  const texte = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const normal = (t) => texte(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nomAccessible = (el) => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    const parIds = ids.map((id) => document.getElementById(id)).filter(Boolean).map((e) => e.textContent).join(' ');
    const labels = el.labels ? Array.from(el.labels).map((l) => l.textContent).join(' ') : '';
    return texte([el.getAttribute('aria-label'), parIds, labels].join(' '));
  };
  const racine = document.documentElement;

  // 8.1
  if (!document.doctype || document.doctype.name.toLowerCase() !== 'html') {
    ajouter('kit-doctype', 'error', 'Type de document (doctype) absent ou invalide', racine);
  }

  // 10.1
  const BALISES = 'basefont, big, blink, center, font, marquee, s, strike, tt';
  const ATTRIBUTS = ['align', 'alink', 'background', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'char',
    'charoff', 'clear', 'compact', 'color', 'frameborder', 'hspace', 'link', 'marginheight', 'marginwidth',
    'text', 'valign', 'vlink', 'vspace'];
  const DIMENSIONS = 'img, object, embed, canvas, svg, video, iframe, input, source';
  let presentation = 0;
  document.querySelectorAll('body, body *').forEach((el) => {
    if (presentation >= 20 || el.closest('svg, math')) return;
    const trouves = ATTRIBUTS.filter((a) => el.hasAttribute(a));
    if (el.hasAttribute('size') && el.tagName !== 'SELECT' && el.tagName !== 'INPUT') trouves.push('size');
    if (!el.matches(DIMENSIONS)) ['width', 'height'].forEach((a) => el.hasAttribute(a) && trouves.push(a));
    if (el.matches(BALISES)) trouves.unshift('balise ' + el.tagName.toLowerCase());
    if (trouves.length) {
      presentation += 1;
      ajouter('kit-presentation-html', 'error', 'Mise en forme dans le HTML au lieu des CSS : ' + trouves.join(', '), el);
    }
  });

  // 9.2
  const premierNiveau = (selecteur) => Array.from(document.querySelectorAll(selecteur))
    .some((el) => !el.closest('article, aside, main, nav, section') || el.matches('[role]'));
  if (!document.querySelector('main, [role="main"]')) {
    ajouter('kit-structure', 'error', 'Zone de contenu principal (main) absente', document.body);
  }
  if (!premierNiveau('header, [role="banner"]')) {
    ajouter('kit-structure', 'warning', "Zone d'en-tete (header ou role=\"banner\") absente", document.body);
  }
  if (!premierNiveau('footer, [role="contentinfo"]')) {
    ajouter('kit-structure', 'warning', 'Zone de pied de page (footer ou role="contentinfo") absente', document.body);
  }
  document.querySelectorAll('header, [role="banner"]').forEach((entete) => {
    const liens = entete.querySelectorAll('a[href]').length;
    if (liens >= 3 && !document.querySelector('nav, [role="navigation"]')) {
      ajouter('kit-structure', 'warning', "Aucune zone de navigation (nav) alors que l'en-tete contient " + liens + ' liens', entete);
    }
  });

  // 9.3
  const PUCE = /^([-\u2013\u2014\u2022\u25aa\u25cf*]|\d+[.)])\s+\S/;
  const vusListe = new Set();
  document.querySelectorAll('p, div').forEach((el) => {
    if (vusListe.has(el) || masque(el) || el.closest('ul, ol, dl')) return;
    if (el.tagName === 'DIV' && el.querySelector('p, div, ul, ol, table')) return;
    const lignes = (el.innerText || '').split('\n').map(texte).filter(Boolean);
    if (lignes.filter((l) => PUCE.test(l)).length >= 2) {
      ajouter('kit-fausse-liste', 'warning', 'Lignes commencant par des puces ou des numeros : utiliser ul ou ol', el);
      return;
    }
    const suite = [el];
    let suivant = el.nextElementSibling;
    while (suivant && suivant.tagName === el.tagName && PUCE.test(texte(suivant.innerText))) {
      suite.push(suivant);
      suivant = suivant.nextElementSibling;
    }
    if (suite.length >= 2 && PUCE.test(texte(el.innerText))) {
      suite.forEach((e) => vusListe.add(e));
      ajouter('kit-fausse-liste', 'warning', suite.length
        + ' paragraphes successifs commencant par des puces ou des numeros : utiliser ul ou ol', el);
    }
  });

  // 5.1, 5.4, 5.8
  document.querySelectorAll('table').forEach((table) => {
    if (masque(table)) return;
    const role = table.getAttribute('role');
    const entetes = table.querySelectorAll('th, [scope], [headers]');
    if (role === 'presentation' || role === 'none') {
      if (entetes.length || table.querySelector('caption, thead, tfoot') || table.hasAttribute('summary')) {
        ajouter('kit-tableau-mise-en-forme', 'error',
          'Tableau de mise en forme qui utilise des elements de tableau de donnees (th, caption, thead...)', table);
      }
      return;
    }
    if (!entetes.length) return;
    const legende = table.querySelector('caption');
    const titre = texte(legende && legende.textContent) || texte(table.getAttribute('title'))
      || texte(table.getAttribute('aria-label')) || nomAccessible(table);
    if (!titre) ajouter('kit-tableau-titre', 'error', 'Tableau de donnees sans titre (caption, aria-label...)', table);
    const complexe = Array.from(table.querySelectorAll('th')).some((th) => th.parentElement.rowIndex > 0 && th.cellIndex > 0)
      || table.querySelector('[headers], th[colspan]:not([colspan="1"]), th[rowspan]:not([rowspan="1"])')
      || table.querySelectorAll('thead tr').length > 1;
    if (complexe && !table.hasAttribute('aria-describedby') && texte(legende && legende.textContent).length < 80) {
      ajouter('kit-tableau-resume', 'warning', 'Tableau complexe sans resume reperable (aria-describedby ou caption detaille)', table);
    }
  });

  // 2.2
  const TITRES_CADRE = ['iframe', 'frame', 'cadre', 'contenu', 'content', 'titre', 'title', 'sans titre', 'untitled',
    'video', 'widget', 'embed', 'map', 'carte'];
  document.querySelectorAll('iframe[title], frame[title]').forEach((cadre) => {
    if (TITRES_CADRE.includes(normal(cadre.getAttribute('title')))) {
      ajouter('kit-cadre-titre', 'warning', 'Titre de cadre generique : "' + texte(cadre.getAttribute('title')) + '"', cadre);
    }
  });

  // 8.10
  const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
  let sens = 0;
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const vusSens = new Set();
  for (let n = marcheur.nextNode(); n && sens < 5; n = marcheur.nextNode()) {
    const el = n.parentElement;
    if (!el || vusSens.has(el) || !RTL.test(n.textContent) || el.closest('[dir], script, style')) continue;
    vusSens.add(el);
    sens += 1;
    ajouter('kit-sens-lecture', 'error', 'Texte ecrit de droite a gauche sans attribut dir="rtl"', el);
  }

  // 11.5, 11.6
  const groupes = new Map();
  document.querySelectorAll('input[type="radio"][name], input[type="checkbox"][name]').forEach((champ) => {
    if (masque(champ)) return;
    const cle = champ.type + ':' + champ.name;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(champ);
  });
  groupes.forEach((champs) => {
    if (champs.length < 2) return;
    const premier = champs[0];
    const conteneur = premier.closest('fieldset, [role="group"], [role="radiogroup"]');
    if (!conteneur || !champs.every((c) => conteneur.contains(c))) {
      ajouter('kit-groupe-champs', 'error', champs.length + ' champs "' + premier.name
        + '" de meme nature non regroupes (fieldset ou role="group")', premier);
      return;
    }
    const legende = conteneur.tagName === 'FIELDSET'
      ? texte(conteneur.querySelector(':scope > legend') && conteneur.querySelector(':scope > legend').textContent)
      : nomAccessible(conteneur);
    if (!legende) {
      ajouter('kit-groupe-legende', 'error', 'Regroupement de champs sans legende (legend ou aria-label)', conteneur);
    }
  });
  document.querySelectorAll('fieldset').forEach((fieldset) => {
    if (masque(fieldset) || fieldset.querySelector(':scope > legend')) return;
    if (!Array.from(groupes.values()).some((champs) => champs.length > 1 && fieldset.contains(champs[0]))) {
      ajouter('kit-groupe-legende', 'error', 'Regroupement de champs (fieldset) sans legende', fieldset);
    }
  });

  // 11.10, 11.13
  const PERSONNEL = /\b(nom|prenom|name|firstname|lastname|surname|family name|given name|username|e ?mail|courriel|mel|tel|telephone|phone|mobile|portable|adresse|address|rue|street|code postal|postal|zip|cp|ville|city|commune|pays|country|naissance|birthday|bday|organisation|entreprise|societe|company|organization)\b/;
  const obligatoiresGlobal = /tous les champs sont obligatoires|sauf mention contraire/.test(normal(document.body.innerText));
  document.querySelectorAll('input, select, textarea').forEach((champ) => {
    if (masque(champ) || champ.disabled) return;
    const type = (champ.getAttribute('type') || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'file', 'range', 'color', 'search'].includes(type)) return;
    const nom = nomAccessible(champ);
    if ((champ.required || champ.getAttribute('aria-required') === 'true') && !obligatoiresGlobal) {
      const groupe = champ.closest('fieldset');
      const legende = groupe && groupe.querySelector(':scope > legend');
      const aide = (champ.getAttribute('aria-describedby') || '').split(/\s+/)
        .map((id) => id && document.getElementById(id)).filter(Boolean).map((e) => e.textContent).join(' ');
      const indications = normal([nom, aide, legende ? legende.textContent : ''].join(' '));
      if (!/\*|obligatoire|requis|required/.test(indications)) {
        ajouter('kit-obligatoire', 'error', 'Champ obligatoire sans indication visible (* ou "obligatoire") dans son etiquette', champ);
      }
    }
    if (type === 'checkbox' || type === 'radio' || champ.tagName === 'TEXTAREA' || champ.hasAttribute('autocomplete')) return;
    const indices = normal([nom, champ.name, champ.id, champ.getAttribute('placeholder')].join(' ')).replace(/[_\-.]/g, ' ');
    if (type === 'email' || type === 'tel' || PERSONNEL.test(indices)) {
      ajouter('kit-autocomplete', 'warning', 'Champ de donnees personnelles sans attribut autocomplete', champ);
    }
  });

  // 13.3
  const vusDocs = new Set();
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href').split(/[?#]/)[0];
    if (!/\.(pdf|docx?|odt|ods|odp|xlsx?|pptx?|rtf)$/i.test(href) || vusDocs.has(href) || masque(a)) return;
    vusDocs.add(href);
    ajouter('kit-document', 'warning', 'Document bureautique (' + href.split('.').pop().toLowerCase()
      + ') : verifier qu\'il est accessible ou qu\'une version accessible existe', a);
  });

  // 13.5
  const EMOJI = /(?![\u00a9\u00ae\u2122])\p{Extended_Pictographic}/u;
  let emojis = 0;
  const marcheurEmoji = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const vusEmoji = new Set();
  for (let n = marcheurEmoji.nextNode(); n && emojis < 10; n = marcheurEmoji.nextNode()) {
    const el = n.parentElement;
    if (!el || vusEmoji.has(el) || !EMOJI.test(n.textContent)) continue;
    if (el.closest('[aria-hidden="true"], script, style') || el.closest('[role="img"][aria-label]')) continue;
    vusEmoji.add(el);
    emojis += 1;
    ajouter('kit-emoji', 'warning', 'Emoji sans alternative (role="img" et aria-label, ou aria-hidden si decoratif)', el);
  }

  return anomalies;
}

// Contraste des composants d'interface (3.3) : contour des champs de saisie
// et icones des boutons ou liens sans texte, au moins 3:1 avec le fond.
function pageTestsComposants() {
  const C = window.__kitCouleurs;
  const anomalies = [];
  const ajouter = (message, el) => anomalies.push({
    code: 'kit-contraste-composant',
    type: 'error',
    message,
    selector: window.__kitSelecteur(el),
    context: el.outerHTML.slice(0, 250)
  });
  const masque = (el) => el.closest('[aria-hidden="true"]') || el.getClientRects().length === 0
    || getComputedStyle(el).visibility === 'hidden';
  const contraste = (couleur, fond) => (couleur && couleur[3] > 0 ? C.ratio(C.melanger(couleur, fond), fond) : 0);

  const champs = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])'
    + ':not([type="color"]):not([type="file"]):not([type="image"]):not([type="submit"])'
    + ':not([type="button"]):not([type="reset"]), select, textarea';
  document.querySelectorAll(champs).forEach((el) => {
    if (masque(el) || el.disabled || !el.parentElement) return;
    const autour = C.fond(el.parentElement);
    if (!autour) return;
    const s = getComputedStyle(el);
    const couleurs = [C.lire(s.backgroundColor)];
    ['Top', 'Right', 'Bottom', 'Left'].forEach((cote) => {
      const style = s['border' + cote + 'Style'];
      if (style !== 'none' && style !== 'hidden' && parseFloat(s['border' + cote + 'Width']) > 0) {
        couleurs.push(C.lire(s['border' + cote + 'Color']));
      }
    });
    if (s.boxShadow !== 'none') {
      (s.boxShadow.match(/(rgba?|color)\([^)]*\)/g) || []).forEach((c) => couleurs.push(C.lire(c)));
    }
    const meilleur = Math.max(...couleurs.map((c) => contraste(c, autour)));
    if (meilleur < 3) {
      ajouter('Contour du champ trop peu contraste avec le fond : ' + meilleur.toFixed(2) + ':1 au lieu de 3:1', el);
    }
  });

  document.querySelectorAll('a[href], button, [role="button"]').forEach((el) => {
    if (masque(el) || el.textContent.trim()) return;
    const fond = C.fond(el);
    if (!fond) return;
    let couleur = null;
    const forme = el.querySelector('svg path, svg circle, svg rect, svg polygon, svg ellipse, svg line, svg polyline, svg use');
    if (forme) {
      const s = getComputedStyle(forme);
      couleur = C.lire(s.fill !== 'none' && !s.fill.startsWith('url') ? s.fill : s.stroke);
    } else if (!el.querySelector('img')) {
      const avant = getComputedStyle(el, '::before');
      if (avant.content === 'none') return;
      const fondAvant = C.lire(avant.backgroundColor);
      couleur = fondAvant && fondAvant[3] > 0 ? fondAvant : C.lire(avant.color);
    }
    if (!couleur || couleur[3] === 0) return;
    const ratio = contraste(couleur, fond);
    if (ratio < 3) {
      ajouter('Icone trop peu contrastee avec le fond : ' + ratio.toFixed(2) + ':1 au lieu de 3:1', el);
    }
  });

  return anomalies;
}

// Textes poses sur une image ou un degrade (3.2) : axe ne sait pas les mesurer.
// Chaque texte est entoure d'un span marque, pour en faire une capture ensuite.
function pageCandidatsContraste(max) {
  const C = window.__kitCouleurs;
  const medias = Array.from(document.querySelectorAll('img, picture, video, canvas, svg'))
    .map((m) => m.getBoundingClientRect())
    .filter((r) => r.width > 50 && r.height > 50);
  const candidats = [];
  const vus = new Set();
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textes = [];
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) textes.push(n);

  for (const n of textes) {
    if (candidats.length >= max) break;
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || vus.has(el)) continue;
    vus.add(el);
    if (el.closest('script, style, noscript, svg, [aria-hidden="true"]')) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.left < 0) continue;
    const couleur = C.lire(s.color);
    if (!couleur || couleur[3] < 1) continue;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const surMedia = medias.some((m) => x >= m.left && x <= m.right && y >= m.top && y <= m.bottom);
    if (C.fond(el) !== null && !surMedia) continue;

    const taille = parseFloat(s.fontSize);
    const gras = parseInt(s.fontWeight, 10) >= 700;
    const id = 'c' + candidats.length;
    candidats.push({
      id,
      couleur,
      seuil: taille >= 24 || (gras && taille >= 18.66) ? 3 : 4.5,
      selecteur: window.__kitSelecteur(el),
      contexte: el.outerHTML.slice(0, 250)
    });
    const span = document.createElement('span');
    span.setAttribute('data-kit-contraste', id);
    n.parentNode.insertBefore(span, n);
    span.appendChild(n);
  }
  return candidats;
}

function pageMasquerTextes(masquer) {
  if (masquer) {
    const style = document.createElement('style');
    style.id = 'kit-sans-texte';
    style.textContent = '* { color: transparent !important; -webkit-text-fill-color: transparent !important; '
      + 'text-shadow: none !important; }';
    document.head.appendChild(style);
    return;
  }
  const style = document.getElementById('kit-sans-texte');
  if (style) style.remove();
  document.querySelectorAll('[data-kit-contraste]').forEach((span) => span.replaceWith(...span.childNodes));
}

// Defilement horizontal a 320 px de large (10.11). On signale les elements
// les plus hauts qui depassent, hors conteneurs qui defilent ou coupent.
function pageTestReflow() {
  const largeur = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth <= largeur + 1) return [];

  const EXCEPTIONS = 'table, pre, code, img, video, canvas, svg, iframe, object, embed, [role="img"]';
  const dansConteneur = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };
  const depasse = (el) => el.getBoundingClientRect().right > largeur + 1;

  const fautifs = [];
  for (const el of document.querySelectorAll('body *')) {
    if (fautifs.length >= 5) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !depasse(el)) continue;
    if (el.parentElement !== document.body && depasse(el.parentElement)) continue;
    if (getComputedStyle(el).position === 'fixed' || dansConteneur(el)) continue;
    fautifs.push(el);
  }
  if (fautifs.length === 0) fautifs.push(document.body);

  return fautifs.map((el) => {
    const exception = el.closest(EXCEPTIONS) !== null;
    return {
      code: 'kit-reflow-320',
      type: exception ? 'warning' : 'error',
      message: 'A ' + largeur + ' px de large, la page defile horizontalement a cause de cet element'
        + (exception ? ' (tableau, image ou code : verifier s\'il s\'agit d\'une exception)' : ''),
      selector: window.__kitSelecteur(el),
      context: el.outerHTML.slice(0, 250)
    };
  });
}

function versFormatPa11y(a) {
  return {
    code: a.code,
    type: a.type,
    typeCode: a.type === 'error' ? 1 : 2,
    message: a.message,
    context: a.context,
    selector: a.selector,
    runner: 'bonus',
    runnerExtras: {}
  };
}

async function parcourirAuClavier(page) {
  const anomalies = [];
  const ordre = [];
  let ignores = 0;

  for (let i = 0; i < MAX_TABULATIONS; i++) {
    await page.keyboard.press('Tab');
    const etat = await page.evaluate(pageEtatFocus);

    if (etat.fin) break;                       // le focus a quitte la page
    if (etat.ignore) {                         // element non repere (iframe...)
      if (++ignores >= MAX_IGNORES_CONSECUTIFS) break;
      continue;
    }
    ignores = 0;

    if (ordre.includes(etat.id)) {
      const bloque = etat.id === ordre[ordre.length - 1] && ordre.length > 1;
      if (bloque && etat.dernier) break;
      const tourComplet = !bloque && etat.id === ordre[0];
      if (!tourComplet && !etat.dansModale) {
        anomalies.push(versFormatPa11y({
          code: 'kit-piege-clavier',
          type: 'error',
          message: bloque
            ? 'La touche Tab ne permet plus de sortir de cet element'
            : 'La touche Tab tourne en boucle sur une partie de la page, sans atteindre le reste',
          selector: etat.selecteur,
          context: etat.contexte
        }));
      }
      break;
    }
    ordre.push(etat.id);

    if (!etat.visible) {
      anomalies.push(versFormatPa11y({
        code: 'kit-focus-visible',
        type: 'error',
        message: "Aucun indicateur visuel quand l'element recoit le focus clavier",
        selector: etat.selecteur,
        context: etat.contexte
      }));
    }
  }
  return anomalies;
}

// Decodage minimal d'une capture PNG (8 bits, RGB ou RGBA, non entrelacee).
function lirePng(donnees) {
  const b = Buffer.from(donnees);
  const idat = [];
  let largeur = 0;
  let hauteur = 0;
  let canaux = 0;
  for (let pos = 8; pos + 8 <= b.length;) {
    const taille = b.readUInt32BE(pos);
    const nom = b.toString('ascii', pos + 4, pos + 8);
    const bloc = b.subarray(pos + 8, pos + 8 + taille);
    if (nom === 'IHDR') {
      if (bloc[8] !== 8 || bloc[12] !== 0 || (bloc[9] !== 2 && bloc[9] !== 6)) return null;
      largeur = bloc.readUInt32BE(0);
      hauteur = bloc.readUInt32BE(4);
      canaux = bloc[9] === 6 ? 4 : 3;
    } else if (nom === 'IDAT') {
      idat.push(bloc);
    } else if (nom === 'IEND') {
      break;
    }
    pos += 12 + taille;
  }
  if (!canaux) return null;
  const brut = zlib.inflateSync(Buffer.concat(idat));
  const ligne = largeur * canaux;
  const px = Buffer.alloc(ligne * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (ligne + 1)];
    for (let x = 0; x < ligne; x++) {
      const v = brut[y * (ligne + 1) + 1 + x];
      const a = x >= canaux ? px[y * ligne + x - canaux] : 0;
      const h = y > 0 ? px[(y - 1) * ligne + x] : 0;
      const ah = x >= canaux && y > 0 ? px[(y - 1) * ligne + x - canaux] : 0;
      let p;
      if (filtre === 0) p = v;
      else if (filtre === 1) p = v + a;
      else if (filtre === 2) p = v + h;
      else if (filtre === 3) p = v + ((a + h) >> 1);
      else if (filtre === 4) {
        const e = a + h - ah;
        const pa = Math.abs(e - a);
        const pb = Math.abs(e - h);
        const pc = Math.abs(e - ah);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? h : ah);
      } else return null;
      px[y * ligne + x] = p & 255;
    }
  }
  return { canaux, px };
}

function ratioContraste(a, b) {
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
}

// Capture le fond sous chaque texte (texte rendu transparent) et compare
// sa couleur a celle du texte, pixel par pixel.
let numeroCapture = 0;

async function testerContrasteSurImage(page) {
  const candidats = await page.evaluate(pageCandidatsContraste, MAX_CONTRASTES);
  if (candidats.length === 0) return [];
  const anomalies = [];
  await page.evaluate(pageMasquerTextes, true);
  try {
    for (const c of candidats) {
      const zone = await page.$('[data-kit-contraste="' + c.id + '"]');
      if (!zone) continue;
      let image;
      let fichier = '';
      try {
        const capture = await zone.screenshot({ timeout: 5000 });
        if (process.env.KIT_CAPTURES) {
          fichier = 'capture-contraste-' + (++numeroCapture) + '.png';
          fs.writeFileSync(fichier, capture);
        }
        image = lirePng(capture);
      } catch (erreur) {
        continue;
      }
      if (!image) continue;
      const ratios = [];
      const pas = Math.max(1, Math.floor(image.px.length / image.canaux / 5000));
      for (let i = 0; i < image.px.length; i += image.canaux * pas) {
        const a = image.canaux === 4 ? image.px[i + 3] / 255 : 1;
        const pixel = [0, 1, 2].map((k) => image.px[i + k] * a + 255 * (1 - a));
        ratios.push(ratioContraste(c.couleur, pixel));
      }
      ratios.sort((x, y) => x - y);
      const pire = ratios[Math.floor(ratios.length * 0.05)];
      const meilleur = ratios[Math.floor(ratios.length * 0.95)];
      if (pire >= c.seuil) continue;
      anomalies.push(versFormatPa11y({
        code: 'kit-contraste-image',
        type: meilleur < c.seuil ? 'error' : 'warning',
        message: meilleur < c.seuil
          ? 'Texte sur image ou degrade : contraste de ' + meilleur.toFixed(2) + ':1 au mieux, il faut ' + c.seuil + ':1'
            + (fichier ? ' [' + fichier + ']' : '')
          : 'Texte sur image ou degrade : contraste insuffisant sur une partie du fond (jusqu\'a '
            + pire.toFixed(2) + ':1, il faut ' + c.seuil + ':1)'
          + (fichier ? ' [' + fichier + ']' : ''),
        selector: c.selecteur,
        context: c.contexte
      }));
    }
  } finally {
    await page.evaluate(pageMasquerTextes, false);
  }
  return anomalies;
}

// Playwright : setViewportSize / viewportSize. Puppeteer : setViewport / viewport.
async function changerLargeur(page, taille) {
  const avant = page.viewportSize ? page.viewportSize() : page.viewport();
  if (page.setViewportSize) await page.setViewportSize(taille);
  else await page.setViewport(taille);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
  return avant;
}

async function testerReflow(page) {
  const avant = await changerLargeur(page, { width: LARGEUR_REFLOW, height: 800 });
  try {
    return (await page.evaluate(pageTestReflow)).map(versFormatPa11y);
  } finally {
    await changerLargeur(page, avant || { width: 1280, height: 1024 });
  }
}

async function executerTestsBonus(page) {
  await page.evaluate(pagePreparer);
  const statiques = await page.evaluate(pageTestsStatiques, {
    liensVagues: LIENS_VAGUES,
    altsSuspects: ALTS_SUSPECTS
  });
  const images = await page.evaluate(pageTestsImages, { altMax: ALT_MAX });
  const structure = await page.evaluate(pageTestsStructure);
  const composants = await page.evaluate(pageTestsComposants);
  const clavier = await parcourirAuClavier(page);
  const contrastes = await testerContrasteSurImage(page);
  const reflow = await testerReflow(page);
  return [...[...statiques, ...images, ...structure, ...composants].map(versFormatPa11y), ...clavier, ...contrastes, ...reflow];
}

module.exports = {
  executerTestsBonus,
  // Exportes pour les tests du kit lui-meme.
  _interne: {
    pagePreparer, pageEtatFocus, pageTestsStatiques, pageTestsImages, pageTestsStructure, pageTestsComposants,
    pageTestReflow, pageCandidatsContraste, parcourirAuClavier, testerContrasteSurImage, testerReflow, lirePng,
    LIENS_VAGUES, ALTS_SUSPECTS
  }
};
