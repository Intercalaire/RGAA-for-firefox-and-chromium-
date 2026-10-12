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
const MAX_MESURES_CAPTURE = 60;

// Nombre maximal de composants de chaque type testes au clavier par page (7.3).
const MAX_MOTIFS = 10;

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

  // 9.1
  const titres = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')).filter((h) => !masque(h));
  const h1 = titres.filter((h) => h.tagName === 'H1' || h.getAttribute('aria-level') === '1');
  if (h1.length === 0) {
    ajouter('kit-titre-h1', 'warning', 'Aucun titre de niveau 1 (h1) dans la page', document.body);
  } else if (h1.length > 1) {
    h1.slice(1).forEach((h) => ajouter('kit-titre-h1', 'warning', h1.length + ' titres de niveau 1 (h1) dans la page', h));
  }
  titres.forEach((h) => {
    const alternatives = Array.from(h.querySelectorAll('img[alt], [aria-label]'))
      .map((e) => e.getAttribute('alt') || e.getAttribute('aria-label')).join('');
    if (!texte(h.textContent + alternatives + (h.getAttribute('aria-label') || ''))) {
      ajouter('kit-titre-vide', 'error', 'Titre vide', h);
    }
  });

  // 12.6
  const reperes = (selecteur) => Array.from(document.querySelectorAll(selecteur))
    .filter((el) => !masque(el) && (el.hasAttribute('role') || !el.closest('article, aside, main, nav, section')));
  const principaux = Array.from(document.querySelectorAll('main, [role="main"]')).filter((el) => !masque(el));
  principaux.slice(1).forEach((el) => ajouter('kit-reperes', 'error',
    principaux.length + ' zones de contenu principal (main) visibles dans la page', el));
  [['header, [role="banner"]', "d'en-tete (header)"], ['footer, [role="contentinfo"]', 'de pied de page (footer)']]
    .forEach(([selecteur, nom]) => {
      const zones = reperes(selecteur);
      zones.slice(1).forEach((el) => ajouter('kit-reperes', 'warning', zones.length + ' zones ' + nom + ' de premier niveau', el));
    });

  // 12.8
  document.querySelectorAll('[tabindex]').forEach((el) => {
    if (parseInt(el.getAttribute('tabindex'), 10) > 0 && !masque(el)) {
      ajouter('kit-tabindex', 'warning', 'tabindex="' + el.getAttribute('tabindex')
        + '" : un tabindex positif modifie l\'ordre de tabulation naturel', el);
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
  // Cas particulier 11.10 : formulaire a un seul champ, ou qui signale ses champs facultatifs.
  const casParticulier1110 = (champ) => {
    const formulaire = champ.closest('form');
    if (!formulaire) return false;
    const champs = new Set();
    formulaire.querySelectorAll('input, select, textarea').forEach((c) => {
      const t = (c.getAttribute('type') || 'text').toLowerCase();
      if (masque(c) || ['hidden', 'submit', 'button', 'reset', 'image'].includes(t)) return;
      champs.add(t === 'radio' && c.name ? 'radio:' + c.name : c);
    });
    if (champs.size <= 1) return true;
    return Array.from(formulaire.querySelectorAll('label, legend'))
      .some((e) => /facultati|optionnel|optional/.test(normal(e.textContent)));
  };
  document.querySelectorAll('input, select, textarea').forEach((champ) => {
    if (masque(champ) || champ.disabled) return;
    const type = (champ.getAttribute('type') || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'file', 'range', 'color', 'search'].includes(type)) return;
    const nom = nomAccessible(champ);
    if ((champ.required || champ.getAttribute('aria-required') === 'true') && !obligatoiresGlobal && !casParticulier1110(champ)) {
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
function pageTestsAudit() {
  const anomalies = [];
  const ajouter = (code, type, message, el) => anomalies.push({
    code, type, message,
    selector: window.__kitSelecteur(el),
    context: el.outerHTML.slice(0, 250)
  });
  const masque = (el) => el.closest('[aria-hidden="true"]') || el.getClientRects().length === 0
    || getComputedStyle(el).visibility === 'hidden';
  const texte = (t) => (t || '').replace(/\s+/g, ' ').trim();
  // Ponctuation et majuscules ignorees (cas particuliers 6.1.5, 7.1.3, 11.2.5).
  const comparable = (t) => ' ' + (t || '').toLowerCase().normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  const cache = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width <= 1 || r.height <= 1 || s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)';
  };
  const texteVisible = (el) => {
    let resultat = '';
    const marcheur = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
      const parent = n.parentElement;
      if (parent && !parent.closest('[aria-hidden="true"]') && !cache(parent)
        && getComputedStyle(parent).visibility !== 'hidden') resultat += ' ' + n.textContent;
    }
    return texte(resultat);
  };
  const parIds = (valeur) => (valeur || '').split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)).filter(Boolean).map((e) => e.textContent).join(' ');

  // 6.1.5, 7.1.3, 11.9.2 : le nom accessible contient l'intitule visible.
  const interactifs = 'a[href], button, input[type="submit"], input[type="button"], input[type="reset"], '
    + '[role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"]';
  document.querySelectorAll(interactifs).forEach((el) => {
    if (masque(el)) return;
    const visible = el.tagName === 'INPUT' ? texte(el.value) : texteVisible(el);
    // Cas particulier : intitule servant de symbole (aucune lettre ni chiffre, ou un seul caractere).
    if (comparable(visible).trim().length < 2) return;
    const lien = el.matches('a[href], [role="link"]');
    const formulaire = !lien && el.closest('form');
    const labelledby = texte(parIds(el.getAttribute('aria-labelledby')));
    const label = texte(el.getAttribute('aria-label'));
    // 11.9.2 : chaque attribut present est verifie ; 6.1.5 et 7.1.3 : le nom accessible.
    const valeurs = formulaire
      ? [['aria-labelledby', labelledby], ['aria-label', label], ['title', texte(el.getAttribute('title'))]]
      : [['Le nom accessible', labelledby || label]];
    valeurs.forEach(([source, valeur]) => {
      if (!valeur || comparable(valeur).includes(comparable(visible))) return;
      ajouter(lien ? 'kit-intitule-lien' : formulaire ? 'kit-intitule-bouton' : 'kit-intitule-composant', 'error',
        source + ' "' + valeur.slice(0, 80) + '" ne contient pas l\'intitule visible "' + visible.slice(0, 80) + '"', el);
    });
  });

  // 11.2.5 : aria-label, aria-labelledby et title d'un champ contiennent l'intitule visible (son label).
  document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea')
    .forEach((champ) => {
      if (masque(champ) || !champ.labels || champ.labels.length === 0) return;
      const visible = texte(Array.from(champ.labels).map(texteVisible).join(' '));
      if (comparable(visible).trim().length < 2) return;
      [['aria-labelledby', texte(parIds(champ.getAttribute('aria-labelledby')))],
        ['aria-label', texte(champ.getAttribute('aria-label'))],
        ['title', texte(champ.getAttribute('title'))]].forEach(([attribut, valeur]) => {
        if (valeur && !comparable(valeur).includes(comparable(visible))) {
          ajouter('kit-intitule-champ', 'error', attribut + ' "' + valeur.slice(0, 80)
            + '" ne contient pas l\'intitule visible "' + visible.slice(0, 80) + '"', champ);
        }
      });
    });

  // 11.8.2
  document.querySelectorAll('select optgroup').forEach((groupe) => {
    if (!texte(groupe.getAttribute('label'))) {
      ajouter('kit-optgroup', 'error', 'Groupe d\'options (optgroup) sans attribut label', groupe);
    }
  });

  // 11.4.2, 11.4.3 : etiquette visuellement accolee au champ.
  document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea')
    .forEach((champ) => {
      if (masque(champ) || !champ.labels || champ.labels.length !== 1) return;
      const label = champ.labels[0];
      if (label.contains(champ) || masque(label)) return;
      const s = getComputedStyle(champ);
      const r = champ.getBoundingClientRect();
      const l = label.getBoundingClientRect();
      const coche = champ.type === 'checkbox' || champ.type === 'radio';
      // Cas particulier : case ou bouton radio non presente visuellement comme tel.
      if (coche && (parseFloat(s.opacity) === 0 || r.width < 4 || r.height < 4)) return;
      const chevauche = !(l.right < r.left || l.left > r.right || l.bottom < r.top || l.top > r.bottom);
      if (chevauche) return;
      const rtl = getComputedStyle(label).direction === 'rtl';
      const tolerance = Math.max(24, 2 * parseFloat(getComputedStyle(label).fontSize));
      const memeLigne = l.bottom > r.top && l.top < r.bottom;
      const memeColonne = l.right > r.left && l.left < r.right;
      const dessus = memeColonne && l.bottom <= r.top && r.top - l.bottom <= tolerance;
      const dessous = memeColonne && l.top >= r.bottom && l.top - r.bottom <= tolerance;
      const gauche = memeLigne && l.right <= r.left && r.left - l.right <= tolerance;
      const droite = memeLigne && l.left >= r.right && l.left - r.right <= tolerance;
      const ok = coche ? dessous || (rtl ? gauche : droite) : dessus || (rtl ? droite : gauche);
      if (!ok) {
        ajouter('kit-etiquette-accolee', 'warning', coche
          ? 'Etiquette pas accolee immediatement a droite ou au-dessous de la case'
          : 'Etiquette pas accolee immediatement au-dessus ou a gauche du champ', champ);
      }
    });

  // 4.11.1 : chaque media temporel a des fonctionnalites de controle.
  const CONTROLE = /lecture|lire|play|pause|stop|arr[eê]t/i;
  const controleProche = (media) => {
    for (let p = media.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) {
      const boutons = Array.from(p.querySelectorAll('button, [role="button"], input[type="button"]'));
      if (boutons.some((b) => CONTROLE.test([b.textContent, b.getAttribute('aria-label'), b.title, b.value].join(' ')))) return true;
    }
    return false;
  };
  document.querySelectorAll('video, audio').forEach((media) => {
    if (media.controls || (media.tagName === 'VIDEO' && masque(media))) return;
    if (media.autoplay && media.muted && media.loop) return;
    if (!controleProche(media)) {
      ajouter('kit-media-controles', 'error', 'Media (' + media.tagName.toLowerCase()
        + ') sans fonctionnalites de controle : ni attribut controls, ni bouton lecture / pause', media);
    }
  });

  // 13.8.1 : mouvement automatique de plus de 5 secondes, sans moyen de l'arreter.
  const PAUSE = /pause|arr[eê]t|stop|animation|mouvement/i;
  const pauseDansPage = Array.from(document.querySelectorAll('button, [role="button"], a[href], input[type="checkbox"]'))
    .some((b) => !masque(b) && PAUSE.test([b.textContent, b.getAttribute('aria-label'), b.title,
      b.labels ? Array.from(b.labels).map((x) => x.textContent).join(' ') : ''].join(' ')));
  if (!pauseDansPage) {
    const vus = new Set();
    const animations = document.getAnimations ? document.getAnimations() : [];
    animations.forEach((a) => {
      const cible = a.effect && a.effect.target;
      if (!cible || !(cible instanceof Element) || vus.has(cible) || a.playState !== 'running') return;
      const duree = a.effect.getComputedTiming().endTime;
      if (duree <= 5000 || masque(cible) || cible.closest('[role="progressbar"], [aria-busy="true"]')) return;
      vus.add(cible);
      if (vus.size <= 5) {
        ajouter('kit-mouvement', 'warning', 'Animation de plus de 5 secondes (' + (duree === Infinity ? 'infinie' : Math.round(duree / 1000) + ' s')
          + ') sans bouton pour l\'arreter dans la page', cible);
      }
    });
    document.querySelectorAll('video[autoplay]').forEach((video) => {
      if (!masque(video) && !video.controls && (video.loop || video.duration > 5) && !controleProche(video)) {
        ajouter('kit-mouvement', 'warning', 'Video en lecture automatique de plus de 5 secondes sans bouton pause', video);
      }
    });
  }

  return anomalies;
}

function pageTestsMotifs() {
  const anomalies = [];
  const ajouter = (code, type, message, el) => anomalies.push({
    code, type, message,
    selector: window.__kitSelecteur(el),
    context: el.outerHTML.slice(0, 250)
  });
  const masque = (el) => el.closest('[aria-hidden="true"]') || el.getClientRects().length === 0
    || getComputedStyle(el).visibility === 'hidden';
  const texte = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const parIds = (valeur) => (valeur || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id));

  // 7.1 onglets
  document.querySelectorAll('[role="tablist"]').forEach((liste) => {
    if (masque(liste)) return;
    const onglets = Array.from(liste.querySelectorAll('[role="tab"]')).filter((t) => t.closest('[role="tablist"]') === liste);
    if (onglets.length === 0) {
      ajouter('kit-motif-aria', 'error', 'Liste d\'onglets (role="tablist") sans onglet (role="tab")', liste);
      return;
    }
    const choisis = onglets.filter((t) => t.getAttribute('aria-selected') === 'true');
    if (choisis.length === 0) {
      ajouter('kit-motif-aria', 'error', 'Aucun onglet n\'a aria-selected="true"', liste);
    } else if (choisis.length > 1 && liste.getAttribute('aria-multiselectable') !== 'true') {
      ajouter('kit-motif-aria', 'error', choisis.length + ' onglets ont aria-selected="true" en meme temps', liste);
    }
    onglets.forEach((onglet) => {
      if (!['true', 'false'].includes(onglet.getAttribute('aria-selected'))) {
        ajouter('kit-motif-aria', 'error', 'Onglet sans aria-selected="true" ou "false"', onglet);
      }
      const cibles = parIds(onglet.getAttribute('aria-controls'));
      const lie = onglet.id && Array.from(document.querySelectorAll('[role="tabpanel"][aria-labelledby]'))
        .some((p) => p.getAttribute('aria-labelledby').split(/\s+/).includes(onglet.id));
      if (cibles.some((c) => !c)) {
        ajouter('kit-motif-aria', 'error', 'aria-controls de l\'onglet pointe vers un panneau inexistant', onglet);
      } else if (cibles.some((c) => c.getAttribute('role') !== 'tabpanel')) {
        ajouter('kit-motif-aria', 'error', 'Le panneau relie a l\'onglet n\'a pas role="tabpanel"', onglet);
      } else if (cibles.length === 0 && !lie) {
        ajouter('kit-motif-aria', 'error', 'Onglet relie a aucun panneau (aria-controls, ou aria-labelledby sur le panneau)', onglet);
      }
    });
  });

  // 7.1 boutons qui deplient un contenu
  document.querySelectorAll('[aria-expanded][aria-controls]').forEach((bouton) => {
    if (masque(bouton) || bouton.getAttribute('role') === 'tab') return;
    if (parIds(bouton.getAttribute('aria-controls')).some((c) => !c)) {
      const ouvert = bouton.getAttribute('aria-expanded') === 'true';
      ajouter('kit-motif-aria', ouvert ? 'error' : 'warning', 'aria-controls pointe vers un element inexistant'
        + (ouvert ? '' : ' (il est peut-etre cree a l\'ouverture)'), bouton);
    }
  });

  // 7.1 fenetres modales (meme fermees)
  document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"]').forEach((fenetre) => {
    const nom = texte(fenetre.getAttribute('aria-label'))
      || parIds(fenetre.getAttribute('aria-labelledby')).filter(Boolean).map((e) => texte(e.textContent)).join(' ');
    if (!nom) ajouter('kit-motif-aria', 'error', 'Fenetre modale sans nom (aria-labelledby ou aria-label)', fenetre);
  });

  return anomalies;
}

// Composants a tester au clavier (7.3) : marques pour les retrouver depuis Node.
function pageCandidatsMotifs(max) {
  const visible = (el) => !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden' && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const marquer = (el, type) => {
    const id = 'm' + document.querySelectorAll('[data-kit-motif]').length;
    el.setAttribute('data-kit-motif', id);
    return { id, type, selecteur: window.__kitSelecteur(el), contexte: el.outerHTML.slice(0, 250) };
  };
  const candidats = [];
  document.querySelectorAll('[role="tablist"]').forEach((liste) => {
    const onglets = Array.from(liste.querySelectorAll('[role="tab"]')).filter(visible);
    if (onglets.length < 2) return;
    candidats.push(marquer(onglets.find((t) => t.getAttribute('aria-selected') === 'true') || onglets[0], 'onglet'));
  });
  Array.from(document.querySelectorAll('button[aria-expanded], [role="button"][aria-expanded]'))
    .filter((el) => visible(el) && el.getAttribute('role') !== 'tab'
      && !(el.tagName === 'BUTTON' && el.form && el.type === 'submit'))
    .slice(0, max).forEach((el) => candidats.push(marquer(el, 'depliant')));
  Array.from(document.querySelectorAll('[role="checkbox"], [role="switch"]'))
    .filter((el) => visible(el) && el.tagName !== 'INPUT')
    .slice(0, max).forEach((el) => candidats.push(marquer(el, 'case')));
  return candidats;
}

function pageMotif({ action, id }) {
  if (action === 'nettoyer') {
    document.querySelectorAll('[data-kit-motif]').forEach((e) => e.removeAttribute('data-kit-motif'));
    if (document.activeElement) document.activeElement.blur();
    return true;
  }
  const el = document.querySelector('[data-kit-motif="' + id + '"]');
  if (!el) return null;
  if (action === 'focus') {
    el.focus();
    return document.activeElement === el;
  }
  if (action === 'clic') {
    el.click();
    return true;
  }
  const actif = document.activeElement;
  return {
    ouvert: el.getAttribute('aria-expanded'),
    coche: el.getAttribute('aria-checked'),
    ongletSuivant: !!actif && actif !== el && actif.getAttribute('role') === 'tab'
      && actif.closest('[role="tablist"]') === el.closest('[role="tablist"]')
  };
}

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
  // Cas particulier 3.3 : apparence geree par les styles natifs du navigateur, sans
  // modification par l'auteur. Temoin du meme type sans les styles de l'auteur.
  const natif = (el) => {
    const temoin = document.createElement(el.tagName);
    if (el.getAttribute('type')) temoin.setAttribute('type', el.getAttribute('type'));
    temoin.style.setProperty('all', 'revert', 'important');
    el.parentElement.appendChild(temoin);
    const a = getComputedStyle(el);
    const b = getComputedStyle(temoin);
    const memes = ['Top', 'Right', 'Bottom', 'Left'].every((c) => ['Style', 'Width', 'Color']
      .every((p) => a['border' + c + p] === b['border' + c + p]))
      && a.backgroundColor === b.backgroundColor && a.boxShadow === b.boxShadow;
    temoin.remove();
    return memes;
  };
  document.querySelectorAll(champs).forEach((el) => {
    if (masque(el) || el.disabled || !el.parentElement || natif(el)) return;
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

// 7.3 : chaque composant doit reagir au clavier. Les fleches entre onglets
// relevent du motif de conception ARIA, seulement recommande : avertissement.
async function testerMotifsClavier(page) {
  const anomalies = [];
  const pause = () => page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
  const signaler = (c, code, type, message) => anomalies.push(versFormatPa11y({
    code, type, message, selector: c.selecteur, context: c.contexte
  }));
  const adresse = page.url();
  const candidats = await page.evaluate(pageCandidatsMotifs, MAX_MOTIFS);
  try {
    for (const c of candidats) {
      if (page.url() !== adresse) break;
      if (!(await page.evaluate(pageMotif, { action: 'focus', id: c.id }))) continue;
      const avant = await page.evaluate(pageMotif, { action: 'etat', id: c.id });
      if (c.type === 'onglet') {
        await page.keyboard.press('ArrowRight');
        await pause();
        const apres = await page.evaluate(pageMotif, { action: 'etat', id: c.id });
        if (apres && !apres.ongletSuivant) {
          signaler(c, 'kit-motif-clavier', 'warning',
            'La fleche droite ne deplace pas le focus vers l\'onglet suivant (motif de conception ARIA)');
        }
        continue;
      }
      const cle = c.type === 'case' ? 'coche' : 'ouvert';
      let reagit = false;
      for (const touche of c.type === 'case' ? ['Space'] : ['Enter', 'Space']) {
        await page.evaluate(pageMotif, { action: 'focus', id: c.id });
        await page.keyboard.press(touche);
        await pause();
        const apres = await page.evaluate(pageMotif, { action: 'etat', id: c.id });
        if (!apres || page.url() !== adresse) break;
        if (apres[cle] !== avant[cle]) {
          reagit = true;
          await page.evaluate(pageMotif, { action: 'focus', id: c.id });
          await page.keyboard.press(touche);
          await pause();
          break;
        }
      }
      if (!reagit && page.url() === adresse) {
        // Si le clic ne change rien non plus, ce n'est pas un probleme propre au clavier.
        await page.evaluate(pageMotif, { action: 'clic', id: c.id });
        await pause();
        const apresClic = await page.evaluate(pageMotif, { action: 'etat', id: c.id });
        if (!apresClic || page.url() !== adresse || apresClic[cle] === avant[cle]) continue;
        await page.evaluate(pageMotif, { action: 'clic', id: c.id });
        await pause();
        signaler(c, 'kit-clavier-composant', 'error', c.type === 'case'
          ? 'La case reagit au clic mais pas a la touche Espace'
          : 'Le contenu s\'ouvre au clic mais ni avec Entree ni avec Espace');
      }
    }
  } finally {
    if (page.url() === adresse) await page.evaluate(pageMotif, { action: 'nettoyer', id: '' });
  }
  return anomalies;
}

// 13.2.1 : fenetre ouverte par la page sans action de l'utilisateur
// (appele avant toute interaction). Playwright : opener() ; Puppeteer : target().opener().
async function fenetresOuvertes(page) {
  try {
    if (typeof page.opener === 'function' && typeof page.context === 'function') {
      const ouvertes = [];
      for (const autre of page.context().pages()) {
        if (autre !== page && (await autre.opener()) === page) {
          ouvertes.push(autre.url());
          await autre.close();
        }
      }
      return ouvertes;
    }
    if (typeof page.browser === 'function') {
      const cible = page.target();
      const ouvertes = [];
      for (const autre of await page.browser().pages()) {
        if (autre !== page && autre.target().opener() === cible) {
          ouvertes.push(autre.url());
          await autre.close();
        }
      }
      return ouvertes;
    }
  } catch (erreur) {
    return [];
  }
  return [];
}

// 10.12.1 : espacements officiels du RGAA, puis texte devenu coupe.
const STYLE_ESPACEMENT = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; '
  + 'word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';

function pageTexteCoupe(etape) {
  if (etape === 'avant') {
    let n = 0;
    document.querySelectorAll('body *').forEach((el) => {
      if (el.closest('canvas, video, svg, [aria-hidden="true"]') || !el.textContent.trim()) return;
      const s = getComputedStyle(el);
      if (!/hidden|clip/.test(s.overflowX + s.overflowY)) return;
      if ((s.webkitLineClamp && s.webkitLineClamp !== 'none') || s.textOverflow === 'ellipsis') return;
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2 || s.clip === 'rect(0px, 0px, 0px, 0px)') return;
      el.setAttribute('data-kit-espacement', String(n++));
    });
  }
  const coupes = {};
  document.querySelectorAll('[data-kit-espacement]').forEach((el) => {
    coupes[el.getAttribute('data-kit-espacement')] = el.scrollHeight > el.clientHeight + 2
      || el.scrollWidth > el.clientWidth + 2;
  });
  if (etape === 'apres') {
    const resultat = Object.keys(coupes).filter((id) => coupes[id]).map((id) => {
      const el = document.querySelector('[data-kit-espacement="' + id + '"]');
      return { id, selecteur: window.__kitSelecteur(el), contexte: el.outerHTML.slice(0, 250) };
    });
    const style = document.getElementById('kit-espacement');
    if (style) style.remove();
    document.querySelectorAll('[data-kit-espacement]').forEach((el) => el.removeAttribute('data-kit-espacement'));
    return resultat;
  }
  return coupes;
}

async function testerEspacement(page) {
  const avant = await page.evaluate(pageTexteCoupe, 'avant');
  await page.evaluate(({ css }) => {
    const style = document.createElement('style');
    style.id = 'kit-espacement';
    style.textContent = css;
    document.head.appendChild(style);
    return new Promise((r) => setTimeout(r, 300));
  }, { css: STYLE_ESPACEMENT });
  const apres = await page.evaluate(pageTexteCoupe, 'apres');
  return apres.filter((c) => !avant[c.id]).slice(0, 10).map((c) => versFormatPa11y({
    code: 'kit-espacement',
    type: 'error',
    message: 'Texte coupe quand les espacements du texte sont augmentes (interligne 1,5, lettres 0,12, mots 0,16, paragraphes 2)',
    selector: c.selecteur,
    context: c.contexte
  }));
}

async function testerReflow(page) {
  const avant = await changerLargeur(page, { width: LARGEUR_REFLOW, height: 800 });
  try {
    return (await page.evaluate(pageTestReflow)).map(versFormatPa11y);
  } finally {
    await changerLargeur(page, avant || { width: 1280, height: 1024 });
  }
}

function pageRequalifier(liste) {
  const trouver = (selecteur) => {
    try { return selecteur ? document.querySelector(selecteur) : null; } catch (e) { return null; }
  };
  const masque = (el) => el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden'
    || el.closest('[aria-hidden="true"], [hidden], [inert]');
  const inactif = (el) => el.closest(':disabled, [aria-disabled="true"]')
    || (el.closest('label') && el.closest('label').control && el.closest('label').control.disabled)
    || (el.tagName === 'A' && !el.hasAttribute('href') && !el.hasAttribute('tabindex') && !el.hasAttribute('role'));
  const arretSon = (m) => {
    const boutons = 'button, [role="button"], input[type="button"], input[type="checkbox"], [role="switch"]';
    const estArret = (b) => !masque(b) && /pause|stop|arr[eê]t|couper|muet|mute|silence|volume|musique|activer le son|sound/i.test([b.textContent,
      b.getAttribute('aria-label'), b.title, b.value, b.labels ? Array.from(b.labels).map((l) => l.textContent).join(' ') : ''].join(' '));
    if (Array.from(document.querySelectorAll('a[href], input, select, textarea, ' + boutons)).filter((x) => !masque(x)).slice(0, 5)
      .some((x) => !x.closest('main, [role="main"]') && estArret(x))) return true;
    for (let p = m.parentElement, i = 0; p && i < 3 && !p.matches('main, [role="main"], body'); p = p.parentElement, i++) {
      if (Array.from(p.querySelectorAll(boutons)).some(estArret)) return true;
    }
    return false;
  };
  const K = window.__kitCouleurs;
  // 3.2 : contraste qu'axe n'a pas pu calculer, mesure si aucun pseudo-element ne peint de fond
  // et si rien ne recouvre le texte.
  // Premiere ligne du texte : le rectangle englobant d'un texte sur plusieurs lignes deborde sur ses voisins.
  const rectTexte = (el) => {
    const noeud = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
    let rects;
    if (noeud) {
      const plage = document.createRange();
      plage.selectNodeContents(noeud);
      rects = Array.from(plage.getClientRects());
    } else rects = Array.from(el.getClientRects());
    return rects.find((r) => r.width > 0 && r.height > 0) || el.getBoundingClientRect();
  };
  // Boite d'un pseudo-element positionne, ou null si on ne peut pas la calculer.
  const boitePseudo = (e, ps) => {
    let base;
    if (ps.position === 'fixed') base = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    else {
      if (getComputedStyle(e).position === 'static') return null;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      base = { left: r.left + parseFloat(s.borderLeftWidth), top: r.top + parseFloat(s.borderTopWidth),
        right: r.right - parseFloat(s.borderRightWidth), bottom: r.bottom - parseFloat(s.borderBottomWidth) };
    }
    const px = (v) => (/px$/.test(v) ? parseFloat(v) : null);
    const [l, t, ri, bo, w, h] = [ps.left, ps.top, ps.right, ps.bottom, ps.width, ps.height].map(px);
    const largeur = w !== null ? w : (l !== null && ri !== null ? base.right - base.left - l - ri : null);
    const hauteur = h !== null ? h : (t !== null && bo !== null ? base.bottom - base.top - t - bo : null);
    if (largeur === null || hauteur === null) return null;
    const gauche = l !== null ? base.left + l : (ri !== null ? base.right - ri - largeur : null);
    const haut = t !== null ? base.top + t : (bo !== null ? base.bottom - bo - hauteur : null);
    if (gauche === null || haut === null || /matrix|rotate|scale|translate/.test(ps.transform)) return null;
    return { left: gauche, top: haut, right: gauche + largeur, bottom: haut + hauteur };
  };
  const mesurer = (el) => {
    const r = rectTexte(el);
    if (r.width === 0 || r.height === 0) return { bloque: 'texte sans dimension' };
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const t = rectTexte(el);
    // Un pseudo-element non positionne se place a cote du texte, jamais dessous.
    // Un pseudo-element positionne ne compte que s'il est visible et touche le texte.
    const voiles = [];
    const porteurs = [];
    let boitesInconnues = false;
    let ordreInconnu = false;
    let imagesDessous = false;
    for (let e = el; e; e = e.parentElement) {
      for (const p of ['::before', '::after']) {
        const ps = getComputedStyle(e, p);
        if (!ps.content || ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
        if (!/absolute|fixed/.test(ps.position)) continue;
        porteurs.push(e);
        if (ps.visibility === 'hidden' || parseFloat(ps.opacity) === 0) continue;
        const boite = boitePseudo(e, ps);
        if (boite && (boite.right - boite.left <= 0 || boite.bottom - boite.top <= 0
          || boite.right <= t.left || boite.left >= t.right || boite.bottom <= t.top || boite.top >= t.bottom)) continue;
        if (ps.backgroundImage !== 'none') { imagesDessous = true; continue; }
        const c = K.lire(ps.backgroundColor);
        if (!c) return { bloque: 'couleur illisible' };
        if (c[3] > 0) {
          voiles.push(parseFloat(ps.opacity) < 1 ? [c[0], c[1], c[2], c[3] * parseFloat(ps.opacity)] : c);
          if (!boite) boitesInconnues = true;
          if (ps.pointerEvents === 'none' && !(parseInt(ps.zIndex, 10) < 0)) ordreInconnu = true;
        }
      }
      const c = K.lire(getComputedStyle(e).backgroundColor);
      if (c && c[3] >= 1) break;
    }
    if (voiles.length > 3) return { bloque: 'trop de voiles (pseudo-elements)' };
    // Pile d'affichage au centre du texte : ce qui est au-dessus du texte doit etre transparent,
    // sauf un porteur de voile, dont le pseudo-element passe alors par-dessus.
    const pile = document.elementsFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    const rang = pile.findIndex((x) => x === el || el.contains(x));
    if (rang < 0) return { bloque: 'texte recouvert par un autre element' };
    let voileDessus = false;
    for (const x of pile.slice(0, rang)) {
      if (porteurs.includes(x)) { voileDessus = true; continue; }
      const sx = getComputedStyle(x);
      const cx = K.lire(sx.backgroundColor);
      const pseudoPeint = ['::before', '::after'].some((p) => {
        const ps = getComputedStyle(x, p);
        return ps.content && ps.content !== 'none' && ps.content !== 'normal'
          && (ps.backgroundImage !== 'none' || (K.lire(ps.backgroundColor) || [0, 0, 0, 1])[3] > 0);
      });
      if (!cx || cx[3] > 0 || sx.backgroundImage !== 'none' || pseudoPeint || x.matches('img, svg, video, canvas, iframe, input, select, textarea')) {
        return { bloque: 'texte recouvert par un autre element (' + window.__kitSelecteur(x) + ')' };
      }
    }
    const s = getComputedStyle(el);
    const fond = K.fond(el);
    const texte = K.lire(s.color);
    const taille = parseFloat(s.fontSize);
    const grand = taille >= 24 || (taille >= 18.66 && Number(s.fontWeight) >= 700);
    const seuil = grand ? 3 : 4.5;
    if (!texte) return { bloque: 'couleur illisible' };
    if (parseFloat(s.opacity) < 1) return { bloque: 'element semi-transparent' };
    if (!fond || imagesDessous) {
      return texte[3] >= 1 ? { capture: true, couleur: texte.slice(0, 3), seuil }
        : { bloque: 'image ou degrade en arriere-plan, texte semi-transparent' };
    }
    const plein = texte[3] < 1 ? K.melanger(texte, fond) : texte;
    // Voile : sous le texte si la pile d'affichage le montre ; absent possible si sa boite est inconnue ;
    // par-dessus seulement si la pile le montre ou si on ne peut pas le savoir.
    const voiler = (c) => voiles.reduceRight((res, v) => K.melanger(v, res), c);
    const ratios = [K.ratio(plein, voiler(fond))];
    if (!voiles.length || boitesInconnues) ratios.push(K.ratio(plein, fond));
    if (voiles.length && (voileDessus || ordreInconnu)) ratios.push(K.ratio(voiler(plein), voiler(fond)));
    const arrondi = (v) => Math.round(v * 100) / 100;
    return { min: arrondi(Math.min(...ratios)), max: arrondi(Math.max(...ratios)), seuil };
  };
  let captures = 0;
  const resultat = liste.map(({ code, message, selector, runner, type }) => {
    const htmlcs = runner === 'htmlcs' || /^WCAG2/.test(code);
    const el = trouver(selector);
    if (type !== 'error') {
      if (code !== 'color-contrast' || !el) return null;
      if (inactif(el)) return { nonApplicable: 'composant inactif' };
      const m = mesurer(el);
      if (m.bloque) return { message: message + ' (non mesurable par le kit : ' + m.bloque + ')' };
      if (m.capture) {
        el.setAttribute('data-kit-mesure', String(captures++));
        return { capture: Number(el.getAttribute('data-kit-mesure')), couleur: m.couleur, seuil: m.seuil };
      }
      if (m.min >= m.seuil) return { nonApplicable: 'contraste suffisant, mesure par le kit' };
      if (m.max < m.seuil) {
        return { type: 'error', message: 'Contraste insuffisant mesure par le kit : ' + m.max + ':1 au mieux, il faut ' + m.seuil + ':1' };
      }
      return { message: 'Contraste entre ' + m.min + ':1 et ' + m.max + ':1 selon la position d\'un voile (pseudo-element), il faut ' + m.seuil + ':1' };
    }
    if (htmlcs && /\.H32(\.|,|$)/.test(code)) return { type: 'warning' };
    if (!el) return null;
    // 4.10
    if (code === 'no-autoplay-audio' && arretSon(el)) {
      return { type: 'warning', message: 'Bouton pour arreter ou couper le son trouve dans la page, a verifier : ' + message };
    }
    // 3.2 : texte d'un element d'interface sur lequel aucune action n'est possible.
    if (/color-contrast|1_4_3|1_4_6/.test(code) && inactif(el)) return { nonApplicable: 'composant inactif' };
    if (!htmlcs || el.closest('head') || el === document.documentElement || el === document.body) return null;
    // 5.8.1 : seuls ces elements et attributs sont interdits dans un tableau de mise en forme.
    if (/F92/.test(code) && el.tagName === 'TABLE') {
      const propres = Array.from(el.querySelectorAll('caption, th, thead, tfoot, [role="rowheader"], [role="columnheader"], td[scope], td[headers], td[axis]'))
        .filter((x) => x.closest('table') === el);
      if (propres.length === 0 && !(el.getAttribute('summary') || '').trim()) {
        return { nonApplicable: 'tableau de mise en forme conforme au test 5.8.1' };
      }
      return null;
    }
    if (el.tagName === 'IFRAME' && masque(el)) {
      return { nonApplicable: 'cadre technique masque' };
    }
    if (masque(el)) {
      return { type: 'warning', message: 'Element masque au chargement, a verifier une fois affiche : ' + message };
    }
    const ancre = /NoSuchID/.test(code) && /"([^"]+)"/.exec(message || '');
    if (ancre && (document.getElementById(ancre[1]) || document.getElementsByName(ancre[1]).length)) {
      return { nonApplicable: 'cible presente apres chargement' };
    }
    return null;
  });
  window.scrollTo(0, 0);
  return resultat;
}

// 3.2 : texte sur image ou degrade, mesure sur une capture de l'element, texte masque.
async function mesurerSurCapture(page, verdicts) {
  const aMesurer = verdicts.map((v, i) => [v, i]).filter(([v]) => v && v.capture !== undefined);
  if (aMesurer.length === 0) return;
  await page.evaluate(pageMasquerTextes, true);
  try {
    for (const [n, [v, i]] of aMesurer.entries()) {
      let verdict = null;
      if (n < MAX_MESURES_CAPTURE) {
        try {
          const zone = await page.$('[data-kit-mesure="' + v.capture + '"]');
          const image = zone && lirePng(await zone.screenshot({ timeout: 5000 }));
          if (image) {
            const ratios = [];
            const pas = Math.max(1, Math.floor(image.px.length / image.canaux / 5000));
            for (let k = 0; k < image.px.length; k += image.canaux * pas) {
              const a = image.canaux === 4 ? image.px[k + 3] / 255 : 1;
              ratios.push(ratioContraste(v.couleur, [0, 1, 2].map((c) => image.px[k + c] * a + 255 * (1 - a))));
            }
            ratios.sort((x, y) => x - y);
            const pire = ratios[Math.floor(ratios.length * 0.05)];
            const meilleur = ratios[Math.floor(ratios.length * 0.95)];
            if (pire >= v.seuil) verdict = { nonApplicable: 'contraste suffisant, mesure sur capture par le kit' };
            else if (meilleur < v.seuil) {
              verdict = { type: 'error', message: 'Texte sur image ou degrade : contraste de ' + meilleur.toFixed(2)
                + ':1 au mieux, mesure sur capture, il faut ' + v.seuil + ':1' };
            } else {
              verdict = { message: 'Texte sur image ou degrade : contraste entre ' + pire.toFixed(2) + ':1 et '
                + meilleur.toFixed(2) + ':1 selon la zone du fond, mesure sur capture, il faut ' + v.seuil + ':1' };
            }
          }
        } catch (erreur) { /* capture impossible : on laisse a verifier */ }
      }
      verdicts[i] = verdict;
    }
  } finally {
    await page.evaluate(pageMasquerTextes, false);
    await page.evaluate(() => document.querySelectorAll('[data-kit-mesure]').forEach((e) => e.removeAttribute('data-kit-mesure')));
  }
}

async function requalifierAnomalies(page, anomalies) {
  const candidates = anomalies.filter((a) => !String(a.code || '').startsWith('kit-')
    && (a.type === 'error' || a.code === 'color-contrast'));
  if (candidates.length === 0) return anomalies;
  try { await attendreAntiRobot(page); } catch (e) { return anomalies; }
  await page.evaluate(pagePreparer);
  const verdicts = await page.evaluate(pageRequalifier, candidates.map((a) => ({
    code: String(a.code || ''), message: a.message, selector: a.selector, runner: a.runner, type: a.type
  })));
  await mesurerSurCapture(page, verdicts);
  const parAnomalie = new Map(candidates.map((a, i) => [a, verdicts[i]]));
  return anomalies.map((a) => {
    const v = parAnomalie.get(a);
    if (!v) return a;
    if (v.nonApplicable) return { ...a, type: 'notice', nonApplicable: v.nonApplicable };
    return { ...a, ...v };
  });
}

function pageAntiRobot() {
  if (document.querySelector('#challenge-form, #cf-challenge-running, #challenge-running, #px-captcha')) return true;
  const corps = document.body ? document.body.innerText.slice(0, 600) : '';
  return /^(just a moment|un instant|attention required|access denied)/i.test(document.title.trim())
    || /checking your browser|verify(ing)? you are (a )?human|v[ée]rifi\S* (que|si) vous [êe]tes (un )?(humain|robot)/i.test(corps);
}

async function attendreAntiRobot(page) {
  for (let i = 0; i < 15; i++) {
    let bloque;
    try { bloque = await page.evaluate(pageAntiRobot); } catch (e) { bloque = true; }
    if (!bloque) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('page de verification anti-robot (Cloudflare ou autre) : tests bonus non realises sur cette page');
}

// Page d'erreur, page vide ou redirection : la page testee n'est pas celle demandee.
function pageChargement() {
  const titre = (document.title || '').trim();
  const h1 = document.querySelector('h1');
  const texte = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim();
  const media = document.querySelector('body img, body svg, body video, body canvas, body iframe, body object, body embed');
  return { titre, h1: h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '', vide: !texte && !media };
}

const TITRE_ERREUR = /^\s*(erreur|error)?\s*[45]\d\d\s*$|\b(erreur|error)\s*[45]\d\d\b|^\s*[45]\d\d\s*[-:–|]?\s*(not found|forbidden|internal server error|introuvable|interdit|erreur)|page (introuvable|non trouv[ée]e)|page not found|internal server error|erreur (interne|du serveur)/i;

function cheminComparable(u) {
  try {
    const x = new URL(u);
    return x.pathname.replace(/\/index(\.html?)?$/, '/').replace(/\.html?$/, '').replace(/\/+$/, '') + x.search;
  } catch (e) { return u; }
}

async function verifierChargement(page, urlDemandee, reponse) {
  const statut = reponse && typeof reponse.status === 'function' ? reponse.status() : 0;
  const invalide = (message) => Object.assign(new Error(`${message} : page non analysee`), { pageInvalide: true });
  if (statut >= 400) throw invalide(`la page repond ${statut}`);
  const etat = await page.evaluate(pageChargement);
  if (TITRE_ERREUR.test(etat.titre) || TITRE_ERREUR.test(etat.h1)) throw invalide(`page d'erreur (« ${etat.titre || etat.h1} »)`);
  if (etat.vide) throw invalide('page vide');
  const finale = page.url();
  return cheminComparable(finale) !== cheminComparable(urlDemandee) ? finale : null;
}

function DELAI_PAGE_MS() { return (Number(process.env.A11Y_DELAI_PAGE) || 300) * 1000; }

async function avecDelai(promesse, quoi) {
  let minuteur;
  const delai = DELAI_PAGE_MS();
  const limite = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error(`${quoi} depasse ${delai / 1000} s : page abandonnee (A11Y_DELAI_PAGE pour changer)`)), delai);
  });
  promesse.catch(() => {});
  try { return await Promise.race([promesse, limite]); } finally { clearTimeout(minuteur); }
}

// 12.1, 12.2, 12.4, 12.5 : menu, plan du site et moteur de recherche de la page.
function pageNavigation() {
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const chemin = (a) => {
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      return u.origin === location.origin ? u.pathname.replace(/(\/index)?\.html?$/, '').replace(/\/$/, '') + u.search : u.href;
    } catch (e) { return a.getAttribute('href') || ''; }
  };
  // Position dans la zone qui contient l'element (en-tete, pied de page), sinon dans la page.
  const place = (el) => {
    if (!visible(el)) return null;
    const zone = el.parentElement && el.parentElement.closest('header, footer, [role="banner"], [role="contentinfo"]');
    const r = el.getBoundingClientRect();
    const z = zone ? zone.getBoundingClientRect() : { left: -scrollX, top: -scrollY };
    return { x: Math.round(r.left - z.left), y: Math.round(r.top - z.top), zone: zone ? zone.tagName.toLowerCase() : 'page' };
  };
  const decrire = (el) => ({ selecteur: window.__kitSelecteur(el), contexte: el.outerHTML.slice(0, 250) });
  const intitule = (el) => norm([el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')].join(' '));

  const menus = Array.from(document.querySelectorAll('nav, [role="navigation"]'))
    .filter((n) => !n.parentElement || !n.parentElement.closest('nav, [role="navigation"]'))
    .filter((n) => !/fil d|ariane|breadcrumb|pagination|evitement|évitement|skip|acces rapide|accès rapide/
      .test(norm([n.getAttribute('aria-label'), n.className, n.id].join(' '))))
    .filter((n) => n.querySelectorAll('a[href]').length >= 3)
    .map((n) => ({ liens: Array.from(n.querySelectorAll('a[href]')).map(chemin),
      textes: Array.from(n.querySelectorAll('a[href]')).map((a) => norm(a.textContent)).filter(Boolean), place: place(n), el: n }));
  const PLAN = /plan du site|plan de site|sitemap/;
  const plan = Array.from(document.querySelectorAll('a[href]')).find((a) => PLAN.test(intitule(a)));
  const champ = 'input[type="search"], input[name="q"], input[name="s"], input[name="search"], input[name="recherche"], input[name="query"]';
  const recherche = document.querySelector('[role="search"], search')
    || Array.from(document.querySelectorAll('form')).find((f) => f.querySelector(champ) && !f.closest('main, [role="main"]'))
    || Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
      .find((b) => /^(rechercher|recherche|search)\b/.test(intitule(b)) && !b.closest('main, [role="main"], form'));
  const contenu = document.querySelector('main, [role="main"]');

  const elements = [['menu', menus[0] && menus[0].el], ['plan', plan], ['recherche', recherche], ['contenu', contenu]]
    .filter(([, el]) => el);
  elements.sort(([, a], [, b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return {
    menus: menus.map((m) => ({ liens: m.liens, textes: m.textes, place: m.place, ...decrire(m.el) })),
    plan: plan ? { texte: norm(plan.textContent), cible: chemin(plan), place: place(plan), ...decrire(plan) } : null,
    recherche: recherche ? { type: recherche.matches('a, button, [role="button"]') ? 'bouton' : 'formulaire',
      texte: recherche.matches('a, button, [role="button"]') ? intitule(recherche) : '', place: place(recherche), ...decrire(recherche) } : null,
    ordre: elements.map(([nom]) => nom),
    titre: (document.title || '').replace(/\s+/g, ' ').trim()
  };
}

const SITES_VUS = new Map();
const ECART_PLACE = 16;

async function testerNavigation(page) {
  const n = await page.evaluate(pageNavigation);
  const adresse = new URL(page.url());
  const accueil = /\/(index\.html?)?$/.test(adresse.pathname);
  const site = SITES_VUS.get(adresse.origin) || {};
  SITES_VUS.set(adresse.origin, site);
  const anomalies = [];
  const signaler = (code, message, cible) => anomalies.push(versFormatPa11y({
    code, type: 'warning', message, selector: cible ? cible.selecteur : 'body', context: cible ? cible.contexte : '<body>'
  }));
  // Menus compares par leurs intitules de liens (part d'intitules communs).
  const ressemblance = (a, b) => {
    const tous = new Set([...a, ...b]);
    return tous.size ? a.filter((t) => b.includes(t)).length / tous.size : 0;
  };
  const decalage = (a, b) => a && b && (a.zone !== b.zone || Math.abs(a.x - b.x) > ECART_PLACE || Math.abs(a.y - b.y) > ECART_PLACE);
  // Ordre relatif : l'element est-il toujours avant (ou apres) chacun des autres ?
  const ordreDifferent = (ref, nom) => ref.ordre.includes(nom) && n.ordre.includes(nom)
    && ref.ordre.filter((x) => x !== nom && n.ordre.includes(x))
      .some((x) => (ref.ordre.indexOf(nom) < ref.ordre.indexOf(x)) !== (n.ordre.indexOf(nom) < n.ordre.indexOf(x)));

  // 8.6 : titre de page generique, ou identique a celui d'une autre page du site.
  const titre = n.titre.toLowerCase();
  const GENERIQUE = /^(accueil|home|page|sans titre|untitled|document|nouvelle page|index|titre|test|welcome|bienvenue|page d'accueil)$/;
  site.titres = site.titres || {};
  const chemin = adresse.pathname.replace(/(\/index)?\.html?$/, '').replace(/\/$/, '') + adresse.search;
  if (titre && (GENERIQUE.test(titre) || titre === adresse.hostname || /\.(html?|php|aspx?)$/.test(titre))) {
    signaler('kit-titre-page', 'Titre de page generique (« ' + n.titre + ' ») : il doit identifier le contenu de la page');
  } else if (titre && site.titres[titre] && site.titres[titre] !== chemin) {
    signaler('kit-titre-page', 'Titre de page identique a celui de ' + site.titres[titre] + ' (« ' + n.titre + ' ») : chaque page doit avoir un titre unique');
  } else if (titre && !site.titres[titre]) site.titres[titre] = chemin;

  // 12.1 : evalue sur la premiere page testee du site, en general l'accueil.
  const presents = [n.menus.length && 'menu de navigation', n.plan && 'plan du site', n.recherche && 'moteur de recherche'].filter(Boolean);
  const premiere = !site.vu;
  site.vu = true;
  if (premiere && presents.length < 2) {
    signaler('kit-systemes-navigation', 'Moins de deux systemes de navigation (menu, plan du site, moteur de recherche) : '
      + (presents.join(', ') || 'aucun') + ' (non applicable pour un site de tres peu de pages)');
  }

  // 12.2 : la page d'accueil est un cas particulier.
  if (!accueil && n.menus.length) {
    if (!site.menu) site.menu = { ...n.menus[0], ordre: n.ordre, url: page.url() };
    else {
      const ref = site.menu;
      const proches = n.menus.map((m) => ({ m, score: ressemblance(m.textes, ref.textes) }))
        .sort((a, b) => b.score - a.score);
      const meme = proches[0] && proches[0].score >= 0.5 ? proches[0].m : null;
      if (meme && decalage(meme.place, ref.place)) {
        signaler('kit-menu-place', 'Menu de navigation pas a la meme place que sur ' + ref.url, meme);
      } else if (meme && ordreDifferent(ref, 'menu')) {
        signaler('kit-menu-place', 'Menu de navigation pas dans le meme ordre du code source que sur ' + ref.url, meme);
      }
    }
  }

  // 12.4 et 12.5 : seulement entre pages qui partagent le meme menu principal
  // (meme ensemble de pages ; une page de processus ou isolee n'est pas comparee).
  if (!site.menuEnsemble && n.menus.length) site.menuEnsemble = n.menus[0].textes;
  const memeEnsemble = !site.menuEnsemble || n.menus.some((m) => ressemblance(m.textes, site.menuEnsemble) >= 0.5);
  if (memeEnsemble) [['plan', 'kit-plan-site', 'Lien vers le plan du site'], ['recherche', 'kit-moteur-recherche', 'Moteur de recherche']]
    .forEach(([nom, code, libelle]) => {
      const ici = n[nom];
      const ref = site[nom];
      if (!ref) {
        if (ici) site[nom] = { ...ici, ordre: n.ordre, url: page.url() };
        return;
      }
      if (!ici) signaler(code, libelle + ' absent, alors qu\'il est present sur ' + ref.url);
      else if (ici.texte !== ref.texte || ici.cible !== ref.cible || ici.type !== ref.type) {
        signaler(code, libelle + ' different de celui de ' + ref.url + ' (fonctionnalite non identique)', ici);
      } else if (decalage(ici.place, ref.place)) signaler(code, libelle + ' pas a la meme place que sur ' + ref.url, ici);
      else if (ordreDifferent(ref, nom)) signaler(code, libelle + ' pas dans le meme ordre du code source que sur ' + ref.url, ici);
    });
  return anomalies;
}

// 10.9, 3.1, 11.10.5, 10.14
function pageTestsComplements() {
  const anomalies = [];
  const ajouter = (code, type, message, el) => anomalies.push({
    code, type, message, selector: window.__kitSelecteur(el), context: el.outerHTML.slice(0, 250)
  });
  const masque = (el) => el.closest('[aria-hidden="true"]') || el.getClientRects().length === 0
    || getComputedStyle(el).visibility === 'hidden';
  const texte = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const mot = (liste) => '(?<![\\p{L}])(?:' + liste + ')(?![\\p{L}])';

  // 10.9 et 3.1 : consignes qui renvoient a la forme, la position ou la couleur.
  const POSITION = 'à droite|à gauche|en haut|en bas|ci-dessus|ci-dessous|plus haut|plus bas|de droite|de gauche|du haut|du bas';
  const FORME = 'rond|ronde|ronds|rondes|carré|carrée|carrés|triangulaire|en forme de';
  const COULEUR = 'rouge|rouges|vert|verte|verts|vertes|bleu|bleue|bleus|orange|jaune|jaunes|gris|grise|violet';
  const ACTION = 'cliquez|cliquer|appuyez|appuyer|sélectionnez|touchez|utilisez|consultez';
  const OBJET = 'bouton|boutons|lien|liens|icône|icônes|icone|pictogramme|pictogrammes|case|cases|onglet|onglets|flèche|champ|champs|zone|encadré|élément|éléments|mot|mots|ligne|lignes';
  const regles = [
    ['kit-forme-position', new RegExp(mot(ACTION) + '[^.!?]{0,50}?' + mot(POSITION + '|' + FORME), 'iu')],
    ['kit-forme-position', new RegExp(mot(OBJET) + '[^.!?]{0,30}?' + mot(POSITION + '|' + FORME), 'iu')],
    ['kit-couleur-texte', new RegExp(mot(OBJET + '|' + ACTION) + '[^.!?]{0,30}?' + mot('en (?:' + COULEUR + ')|de couleur (?:' + COULEUR + ')|(?:' + COULEUR + ')'), 'iu')]
  ];
  const vus = { 'kit-forme-position': 0, 'kit-couleur-texte': 0 };
  document.querySelectorAll('p, li, td, th, dd, dt, label, legend, caption, figcaption, span, div, strong, em').forEach((el) => {
    if (masque(el) || el.closest('script, style, noscript, svg')) return;
    const propre = texte(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    if (propre.length < 12) return;
    for (const [code, motif] of regles) {
      const trouve = motif.exec(propre);
      if (!trouve || vus[code] >= 5) continue;
      vus[code] += 1;
      ajouter(code, 'warning', code === 'kit-couleur-texte'
        ? 'Consigne qui semble reposer sur la couleur seule (« ' + trouve[0] + ' ») : verifier qu\'une autre indication existe'
        : 'Consigne qui semble reposer sur la forme ou la position (« ' + trouve[0] + ' ») : verifier qu\'une autre indication existe', el);
      break;
    }
  });

  // 11.10.5 : champ a format impose sans indication visible du format.
  const INDICATION = /format|exemple|ex\s?[.:]|jj|mm\/|aaaa|\d+\s*(chiffres|caract)|@|\d{2}[/.\- ]\d{2}/i;
  const DATE = /(?<![\p{L}])(date|naissance)(?![\p{L}])/iu;
  const parIds = (v) => (v || '').split(/\s+/).map((id) => id && document.getElementById(id)).filter(Boolean)
    .map((e) => e.textContent).join(' ');
  let formats = 0;
  document.querySelectorAll('input:not([type]), input[type="text"], input[type="tel"], input[type="email"], input[type="number"], input[type="search"]')
    .forEach((champ) => {
      if (masque(champ) || champ.disabled || formats >= 10) return;
      const etiquette = texte([...(champ.labels || [])].map((l) => l.textContent).join(' ') + ' '
        + parIds(champ.getAttribute('aria-labelledby')) + ' ' + (champ.getAttribute('aria-label') || ''));
      const impose = champ.hasAttribute('pattern') || ((champ.type === 'text' || !champ.getAttribute('type')) && DATE.test(etiquette + ' ' + champ.name + ' ' + champ.id));
      if (!impose) return;
      if (INDICATION.test(etiquette + ' ' + parIds(champ.getAttribute('aria-describedby')))) return;
      formats += 1;
      ajouter('kit-format-saisie', 'warning', 'Champ a format impose sans indication visible du format (dans l\'etiquette ou un texte lie par aria-describedby)'
        + (INDICATION.test(champ.placeholder || '') ? ' : le placeholder seul ne suffit pas, il disparait a la saisie' : ''), champ);
    });

  // 10.14 : contenu revele au survol par CSS, sans equivalent au focus.
  const regleCss = [];
  const parcourir = (liste) => {
    for (const r of liste) {
      if (r.selectorText) regleCss.push(r);
      else if (r.cssRules) parcourir(r.cssRules);
    }
  };
  for (const feuille of document.styleSheets) {
    try { parcourir(feuille.cssRules); } catch (e) { /* feuille d'un autre domaine : illisible */ }
  }
  const selecteurs = new Set(regleCss.flatMap((r) => r.selectorText.split(',').map((x) => x.trim())));
  const revele = (style) => Array.from(style).some((p) => {
    const v = style.getPropertyValue(p).trim();
    if (p === 'display') return v !== 'none';
    if (p === 'visibility') return v === 'visible';
    if (p === 'opacity') return parseFloat(v) > 0;
    if (p === 'max-height' || p === 'height') return v !== '0' && v !== '0px';
    return p === 'clip' || p === 'clip-path' || p === 'content';
  });
  let survols = 0;
  regleCss.forEach((r) => {
    r.selectorText.split(',').map((x) => x.trim()).forEach((sel) => {
      const i = sel.indexOf(':hover');
      if (i < 0 || survols >= 5) return;
      // Contenu additionnel : un autre element (descendant, voisin) ou un pseudo-element.
      if (!/^(\s|>|\+|~|::?(before|after))/.test(sel.slice(i + 6)) || !revele(r.style)) return;
      if ([':focus', ':focus-within', ':focus-visible'].some((f) => selecteurs.has(sel.replace(':hover', f)))) return;
      let declencheur = null;
      try { declencheur = document.querySelector(sel.slice(0, i) || '*'); } catch (e) { return; }
      if (!declencheur || masque(declencheur)) return;
      survols += 1;
      ajouter('kit-survol-seul', 'warning', 'Contenu qui apparait au survol (' + sel.slice(0, 80) + ') sans regle equivalente au focus clavier : verifier qu\'il apparait aussi au clavier', declencheur);
    });
  });

  // 4.10
  const ARRET = /pause|stop|arr[eê]t|couper|muet|mute|silence|volume|musique|activer le son|sound/i;
  const BOUTONS = 'button, [role="button"], input[type="button"], input[type="checkbox"], [role="switch"]';
  const estArret = (b) => !masque(b) && ARRET.test([b.textContent, b.getAttribute('aria-label'), b.title, b.value,
    b.labels ? Array.from(b.labels).map((l) => l.textContent).join(' ') : ''].join(' '));
  const arretEnTete = Array.from(document.querySelectorAll('a[href], input, select, textarea, ' + BOUTONS))
    .filter((x) => !masque(x)).slice(0, 5).some((x) => !x.closest('main, [role="main"]') && estArret(x));
  const arretPres = (m) => {
    if (arretEnTete) return true;
    for (let p = m.parentElement, i = 0; p && i < 3 && !p.matches('main, [role="main"], body'); p = p.parentElement, i++) {
      if (Array.from(p.querySelectorAll(BOUTONS)).some(estArret)) return true;
    }
    return false;
  };
  document.querySelectorAll('audio, video').forEach((m) => {
    if (m.muted || m.volume === 0 || m.duration <= 3 || m.mozHasAudio === false || (m.controls && !masque(m))) return;
    if (!m.autoplay && m.paused && m.played.length === 0) return;
    const origine = m.autoplay ? 'Son en lecture automatique (autoplay)' : 'Son lance automatiquement par un script';
    if (arretPres(m)) {
      ajouter('kit-son-auto', 'warning', origine + ', de plus de 3 secondes : bouton pour l\'arreter ou couper le son trouve, verifier qu\'il fonctionne', m);
    } else {
      ajouter('kit-son-auto', 'error', origine + ', de plus de 3 secondes, sans bouton pour l\'arreter ou couper le son', m);
    }
  });
  document.querySelectorAll('bgsound, embed[src], object[data]').forEach((e) => {
    const src = e.getAttribute('src') || e.getAttribute('data') || '';
    const auto = (e.getAttribute('autostart') || e.getAttribute('autoplay') || 'true').toLowerCase();
    if (arretPres(e)) return;
    if (e.tagName === 'BGSOUND' || (/\.(mp3|wav|ogg|oga|m4a|aac|mid|midi|wma)(\?|#|$)/i.test(src) && !/^(false|0)$/.test(auto))) {
      ajouter('kit-son-auto', 'warning', 'Son integre (' + e.tagName.toLowerCase() + ') susceptible de demarrer seul, sans bouton pour l\'arreter : a verifier', e);
    }
  });
  document.querySelectorAll('iframe[src]').forEach((f) => {
    const src = f.getAttribute('src');
    if (masque(f) || !/[?&](autoplay|auto_play)=(1|true)(&|#|$)/i.test(src) || /[?&](mute|muted)=(1|true)(&|#|$)/i.test(src)) return;
    ajouter('kit-son-auto', 'warning', 'Lecteur integre en lecture automatique (autoplay=1) sans son coupe (mute=1) : verifier que le son peut etre arrete', f);
  });
  return anomalies;
}

// 12.10 : raccourcis clavier a une seule touche, le focus etant sur la page.
const TOUCHES_RACCOURCIS = ['/', '?', 's', 'f', 'j', 'k', 'n', 'g', 'h', 'm'];

function pageRaccourci(action) {
  if (action === 'installer') {
    window.__kitMutations = 0;
    if (!window.__kitObservateur) {
      window.__kitObservateur = new MutationObserver((liste) => { window.__kitMutations += liste.length; });
      window.__kitObservateur.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    return true;
  }
  if (action === 'etat') {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    window.__kitMutations = 0;
    return { adresse: location.href, x: scrollX, y: scrollY };
  }
  if (action === 'nettoyer') {
    if (window.__kitObservateur) window.__kitObservateur.disconnect();
    window.__kitObservateur = null;
    return true;
  }
  const actif = document.activeElement;
  return { adresse: location.href, x: scrollX, y: scrollY, mutations: window.__kitMutations,
    focus: actif && actif !== document.body ? window.__kitSelecteur(actif) : null,
    contexte: actif && actif !== document.body ? actif.outerHTML.slice(0, 250) : null };
}

async function testerRaccourcis(page) {
  const pause = (ms) => page.evaluate((d) => new Promise((r) => setTimeout(r, d)), ms);
  const adresse = page.url();
  const anomalies = [];
  try {
    await page.evaluate(pageRaccourci, 'installer');
    await page.evaluate(pageRaccourci, 'etat');
    await pause(400);
    const calme = (await page.evaluate(pageRaccourci, 'apres')).mutations === 0;
    for (const touche of TOUCHES_RACCOURCIS) {
      const avant = await page.evaluate(pageRaccourci, 'etat');
      await page.keyboard.press(touche);
      await pause(150);
      let apres;
      try { apres = await page.evaluate(pageRaccourci, 'apres'); } catch (e) { apres = { adresse: 'navigation' }; }
      const effets = [];
      if (apres.adresse !== avant.adresse) effets.push('changement de page ou d\'adresse');
      else {
        if (apres.focus) effets.push('focus deplace');
        if (apres.x !== avant.x || apres.y !== avant.y) effets.push('defilement');
        if (calme && apres.mutations > 0) effets.push('contenu modifie');
      }
      if (effets.length) {
        anomalies.push(versFormatPa11y({ code: 'kit-raccourci', type: 'warning',
          message: 'La touche « ' + touche + ' » seule declenche une action (' + effets.join(', ') + ') : verifier que ce raccourci peut etre desactive, configure, ou qu\'il ne marche que sur son composant',
          selector: apres.focus || 'html', context: apres.contexte || '<html>' }));
        if (apres.adresse !== avant.adresse) {
          await page.goto(adresse);
          await page.evaluate(pagePreparer);
          await page.evaluate(pageRaccourci, 'installer');
        } else await page.keyboard.press('Escape');
        if (anomalies.length >= 3) break;
      }
    }
  } finally {
    try { await page.evaluate(pageRaccourci, 'nettoyer'); } catch (e) { /* page changee */ }
  }
  return anomalies;
}

// 7.4 : une liste deroulante qui change de contexte des la selection d'une option.
// L'envoi des formulaires est intercepte : il est detecte, mais bloque.
function pageListe(action) {
  if (action === 'candidats') {
    const listes = Array.from(document.querySelectorAll('select:not([multiple]):not([disabled])'))
      .filter((s) => s.options.length >= 2 && s.getClientRects().length > 0).slice(0, 5);
    listes.forEach((s, i) => s.setAttribute('data-kit-liste', String(i)));
    if (!window.__kitEnvois) {
      window.__kitEnvois = 0;
      document.addEventListener('submit', (e) => { window.__kitEnvois += 1; e.preventDefault(); }, true);
      HTMLFormElement.prototype.submit = function () { window.__kitEnvois += 1; };
      HTMLFormElement.prototype.requestSubmit = function () { window.__kitEnvois += 1; };
    }
    return listes.length;
  }
  if (action === 'nettoyer') {
    document.querySelectorAll('[data-kit-liste]').forEach((s) => s.removeAttribute('data-kit-liste'));
    return true;
  }
  const liste = document.querySelector('[data-kit-liste="' + action.id + '"]');
  if (!liste) return null;
  if (action.etape === 'changer') {
    liste.focus();
    window.__kitEnvois = 0;
    const avant = liste.selectedIndex;
    liste.selectedIndex = avant === 0 ? 1 : 0;
    liste.dispatchEvent(new Event('input', { bubbles: true }));
    liste.dispatchEvent(new Event('change', { bubbles: true }));
    return { avant, adresse: location.href };
  }
  const resultat = { adresse: location.href, envoi: window.__kitEnvois > 0,
    focus: document.activeElement !== liste && document.activeElement !== document.body,
    selecteur: window.__kitSelecteur(liste), contexte: liste.outerHTML.slice(0, 250) };
  liste.selectedIndex = action.avant;
  return resultat;
}

async function testerListesDeroulantes(page) {
  const adresse = page.url();
  const anomalies = [];
  const nombre = await page.evaluate(pageListe, 'candidats');
  for (let id = 0; id < nombre; id++) {
    let changement;
    try { changement = await page.evaluate(pageListe, { id, etape: 'changer' }); } catch (e) { break; }
    if (!changement) continue;
    await page.evaluate(() => new Promise((r) => setTimeout(r, 500))).catch(() => {});
    const fenetres = await fenetresOuvertes(page);
    let r;
    try { r = await page.evaluate(pageListe, { id, etape: 'verifier', avant: changement.avant }); } catch (e) { r = null; }
    const effets = [];
    if (!r || r.adresse !== changement.adresse) effets.push('changement de page');
    if (r && r.envoi) effets.push('envoi du formulaire');
    if (fenetres.length) effets.push('nouvelle fenetre');
    if (r && r.focus) effets.push('focus deplace');
    if (effets.length) {
      anomalies.push(versFormatPa11y({ code: 'kit-changement-contexte', type: 'warning',
        message: 'Choisir une option de cette liste declenche un changement de contexte (' + effets.join(', ')
          + ') sans bouton : verifier qu\'un texte previent l\'utilisateur avant',
        selector: r ? r.selecteur : 'select', context: r ? r.contexte : '<select>' }));
    }
    if (!r || r.adresse !== changement.adresse) {
      await page.goto(adresse);
      await page.evaluate(pagePreparer);
      break;
    }
  }
  try { await page.evaluate(pageListe, 'nettoyer'); } catch (e) { /* page changee */ }
  return anomalies;
}

// 10.4 : zoom graphique du navigateur a 200 % (largeur divisee par deux), sans texte coupe.
async function testerZoom(page) {
  const taille = (page.viewportSize ? page.viewportSize() : page.viewport()) || { width: 1280, height: 1024 };
  const avant = await page.evaluate(pageTexteCoupe, 'avant');
  await changerLargeur(page, { width: Math.round(taille.width / 2), height: Math.round(taille.height / 2) });
  let apres;
  try {
    apres = await page.evaluate(pageTexteCoupe, 'apres');
  } finally {
    await changerLargeur(page, taille);
  }
  return apres.filter((c) => !avant[c.id]).slice(0, 10).map((c) => versFormatPa11y({
    code: 'kit-zoom-200',
    type: 'error',
    message: 'Texte coupe quand la page est agrandie a 200 % (zoom du navigateur, ' + Math.round(taille.width / 2) + ' px de large)',
    selector: c.selecteur,
    context: c.contexte
  }));
}

// 13.9
const ORIENTATIONS = [['portrait', { width: 412, height: 915 }], ['paysage', { width: 915, height: 412 }]];

function pageOrientation() {
  const visible = (el) => {
    if (!el || el.getClientRects().length === 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && parseFloat(st.opacity) > 0;
  };
  const decrire = (el) => ({ selecteur: window.__kitSelecteur(el), contexte: el.outerHTML.slice(0, 250) });
  const zone = document.querySelector('main, [role="main"]') || document.body;
  const zoneVisible = visible(zone) && visible(document.body);
  const ROTATION = /(tourne[rz]|pivote[rz]|faites pivoter|retourne[rz]|basculez|passez)[^.!?]{0,40}(appareil|t[ée]l[ée]phone|tablette|[ée]cran|mobile|mode portrait|mode paysage|en portrait|en paysage)|rotate[^.!?]{0,30}(device|phone|screen|tablet)|(switch|turn)[^.!?]{0,30}(portrait|landscape)/i;
  let message = null;
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n && !message; n = marcheur.nextNode()) {
    if (!/tourn|pivot|retourn|bascul|passez|rotat|switch|turn/i.test(n.textContent)) continue;
    for (let el = n.parentElement, i = 0; el && el !== document.body && i < 3; el = el.parentElement, i++) {
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (t.length > 300) break;
      if (ROTATION.test(t)) {
        if (visible(el) && !el.closest('script, style, noscript, template')) message = { ...decrire(el), texte: t.slice(0, 80) };
        break;
      }
    }
  }
  return {
    zone: decrire(zone),
    zoneVisible,
    texte: zoneVisible ? zone.innerText.replace(/\s+/g, ' ').trim().length : 0,
    message
  };
}

async function testerOrientation(page) {
  const taille = (page.viewportSize ? page.viewportSize() : page.viewport()) || { width: 1280, height: 1024 };
  const etats = {};
  try {
    for (const [nom, dimensions] of ORIENTATIONS) {
      await changerLargeur(page, dimensions);
      etats[nom] = await page.evaluate(pageOrientation);
    }
  } finally {
    await changerLargeur(page, taille);
  }
  const signaler = (type, message, cible) => [versFormatPa11y({
    code: 'kit-orientation', type, message, selector: cible.selecteur, context: cible.contexte
  })];
  const paires = [['portrait', 'paysage'], ['paysage', 'portrait']];
  for (const [a, b] of paires) {
    const m = etats[a].message;
    if (m && !(etats[b].message && etats[b].message.selecteur === m.selecteur)) {
      return signaler('error', 'Message demandant de changer d\'orientation affiche en mode ' + a + ' (« ' + m.texte
        + ' ») : le contenu doit etre consultable en portrait et en paysage (hors jeu, piano, depot de cheque...)', m);
    }
  }
  for (const [a, b] of paires) {
    if (!etats[a].zoneVisible && etats[b].zoneVisible) {
      return signaler('error', 'Contenu principal masque en mode ' + a + ', visible en mode ' + b, etats[a].zone);
    }
  }
  for (const [a, b] of paires) {
    if (etats[b].texte > 200 && etats[a].texte < etats[b].texte * 0.3) {
      return signaler('warning', 'En mode ' + a + ', le contenu principal ne montre que ' + Math.round(100 * etats[a].texte / etats[b].texte)
        + ' % du texte visible en mode ' + b + ' : verifier que le contenu reste le meme', etats[a].zone);
    }
  }
  return [];
}

// 12.3.2 : sur la page « plan du site », chaque lien interne doit aboutir.
// 401, 403 et 429 (pages protegees ou limitees) ne sont pas comptes comme casses.
async function pagePlanDuSite() {
  const PLAN = /plan du site|plan de site|sitemap/i;
  const h1 = document.querySelector('h1');
  if (!PLAN.test(document.title) && !(h1 && PLAN.test(h1.textContent))) return [];
  const zone = document.querySelector('main, [role="main"]') || document.body;
  const vus = new Set();
  const liens = Array.from(zone.querySelectorAll('a[href]')).filter((a) => {
    let u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return false; }
    if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return false;
    u.hash = '';
    if (u.href === location.href.split('#')[0] || vus.has(u.href)) return false;
    vus.add(u.href);
    a.__kitCible = u.href;
    return true;
  }).slice(0, 150);
  const anomalies = [];
  const verifier = async (a) => {
    let statut;
    try {
      let r = await fetch(a.__kitCible, { method: 'HEAD', redirect: 'follow', credentials: 'same-origin' });
      if (r.status === 405 || r.status === 501) r = await fetch(a.__kitCible, { redirect: 'follow', credentials: 'same-origin' });
      statut = r.status;
    } catch (e) {
      statut = 'injoignable';
    }
    if (statut === 'injoignable' || statut === 404 || statut === 410 || statut >= 500) {
      anomalies.push({ code: 'kit-plan-lien-casse', type: 'error',
        message: 'Lien du plan du site qui n\'aboutit pas (' + statut + ') : ' + a.__kitCible,
        selector: window.__kitSelecteur(a), context: a.outerHTML.slice(0, 250) });
    }
  };
  for (let i = 0; i < liens.length; i += 6) await Promise.all(liens.slice(i, i + 6).map(verifier));
  return anomalies;
}

async function executerTestsBonus(page) {
  await attendreAntiRobot(page);
  const fenetres = (await fenetresOuvertes(page)).map((adresse) => versFormatPa11y({
    code: 'kit-nouvelle-fenetre',
    type: 'error',
    message: 'Une nouvelle fenetre s\'est ouverte sans action de l\'utilisateur : ' + adresse,
    selector: 'html',
    context: '<html>'
  }));
  await page.evaluate(pagePreparer);
  const navigation = await testerNavigation(page);
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
  const espacement = await testerEspacement(page);
  const zoom = await testerZoom(page);
  const orientation = await testerOrientation(page);
  const planDuSite = await page.evaluate(pagePlanDuSite);
  const audit = await page.evaluate(pageTestsAudit);
  const complements = await page.evaluate(pageTestsComplements);
  const motifs = await page.evaluate(pageTestsMotifs);
  const motifsClavier = await testerMotifsClavier(page);
  const raccourcis = await testerRaccourcis(page);
  const listes = await testerListesDeroulantes(page);
  return [...fenetres, ...navigation, ...[...statiques, ...images, ...structure, ...composants, ...audit, ...complements, ...planDuSite, ...motifs].map(versFormatPa11y),
    ...clavier, ...contrastes, ...reflow, ...espacement, ...zoom, ...orientation, ...motifsClavier, ...raccourcis, ...listes];
}

module.exports = {
  executerTestsBonus,
  requalifierAnomalies,
  verifierChargement,
  avecDelai,
  // Exportes pour les tests du kit lui-meme.
  _interne: {
    pagePreparer, pageNavigation, pageEtatFocus, pageTestsStatiques, pageTestsImages, pageTestsStructure, pageTestsComposants, pageTestsMotifs, pageTestsAudit, pageTestsComplements,
    pageTestReflow, pageCandidatsContraste, parcourirAuClavier, testerContrasteSurImage, testerReflow, lirePng,
    LIENS_VAGUES, ALTS_SUSPECTS
  }
};
