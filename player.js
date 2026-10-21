/* Lecteur vidéo DAFLIX TV
 * Lecteur maison, sans dépendance. Lit le HLS (.m3u8) en natif quand l'appareil le permet,
 * sinon avec hls.js (chargé seulement si besoin), et les fichiers directs (mp4, webm, mp3...).
 * Utilisation :  const l = new LecteurTV(zone, video);  l.lire(url, { titre, logo });
 */
(function (global) {
  "use strict";

  // hls.js n'est chargé que lorsqu'un flux HLS ne peut pas être lu en natif.
  // hls.js (version 1.5.13) est hébergé sur le site lui-même : le fichier hls.min.js se trouve à côté de player.js.
  var HLS_SRC = "/hls.min.js";
  var VITESSES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  var CLE_VOLUME = "matv-volume";

  var promesseHls = null;
  function chargerHls() {
    if (global.Hls) return Promise.resolve(global.Hls);
    if (!promesseHls) {
      promesseHls = new Promise(function (ok, ko) {
        var s = document.createElement("script");
        s.src = HLS_SRC; s.async = true; s.crossOrigin = "anonymous";
        s.onload = function () { global.Hls ? ok(global.Hls) : ko(new Error("hls")); };
        s.onerror = function () { promesseHls = null; ko(new Error("hls")); };
        document.head.appendChild(s);
      });
    }
    return promesseHls;
  }

  // Icônes (fixes, écrites ici : jamais de contenu venant de l'extérieur)
  var S = function (c) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + c + "</svg>"; };
  var ICONES = {
    lire: S('<path d="M7 4.6v14.8a.6.6 0 0 0 .9.5l12-7.4a.6.6 0 0 0 0-1L7.900 4.100a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>'),
    pause: S('<rect x="6" y="4.500" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.500" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>'),
    sonFort: S('<path d="M4 9.500v5h4l5 4v-13l-5 4z" fill="currentColor"/><path d="M16.500 8.500a5 5 0 0 1 0 7M19 6a8.500 8.500 0 0 1 0 12"/>'),
    sonBas: S('<path d="M4 9.500v5h4l5 4v-13l-5 4z" fill="currentColor"/><path d="M16.500 8.500a5 5 0 0 1 0 7"/>'),
    sonCoupe: S('<path d="M4 9.500v5h4l5 4v-13l-5 4z" fill="currentColor"/><path d="M17 9.500l5 5M22 9.500l-5 5"/>'),
    reglages: S('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
    pip: S('<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor"/>'),
    plein: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    pleinSortir: S('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
    retour: S('<path d="M3 12a9 9 0 1 0 3-6.700M3 4v5h5"/>'),
    alerte: S('<circle cx="12" cy="12" r="9"/><path d="M12 7.500v5.500M12 16.500h.01"/>')
  };

  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function bouton(cls, label, icone) {
    var b = el("button", "lt-b " + cls, { type: "button", "aria-label": label, title: label });
    if (icone) b.innerHTML = icone;
    return b;
  }
  function dur(t) {
    if (!isFinite(t) || t < 0) t = 0;
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function borner(x, a, b) { return Math.min(b, Math.max(a, x)); }

  function LecteurTV(zone, video) {
    this.zone = zone; this.v = video;
    this.url = ""; this.titre = ""; this.logo = "";
    this.token = 0; this.hls = null; this.methodes = []; this.m = 0;
    this.essais = 0; this.reprisesMedia = 0; this.raison = "";
    this.jouant = false; this.direct = false; this.glisse = false; this.occupe = false;
    this.garde = null; this.relance = null; this.veille = null; this.masque = null;
    this.pointeur = "mouse"; this.verrou = null; this.erreurFinale = false;
    this.niveau = -1;                       // qualité choisie (-1 = auto)
    this.vitesse = 1;

    video.controls = false; video.removeAttribute("controls");
    video.setAttribute("playsinline", ""); video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    zone.classList.add("lt", "lt-vide");
    zone.tabIndex = 0;
    zone.setAttribute("role", "region");
    zone.setAttribute("aria-label", "Lecteur vidéo");

    this.construire();
    this.lier();
    this.volumeDepart();
    this.majBoutons();
  }

  var P = LecteurTV.prototype;

  /* ---------- Interface ---------- */
  P.construire = function () {
    var z = this.zone, self = this;
    this.scene = el("div", "lt-scene");
    this.attente = el("div", "lt-attente", { "aria-hidden": "true" });
    this.attente.appendChild(el("div", "lt-spin"));

    this.msg = el("div", "lt-msg", { role: "status", "aria-live": "polite" });
    this.msg.hidden = true;
    this.msgLogo = el("div", "lt-msg-icone"); this.msgT = el("strong"); this.msgS = el("small");
    this.msgBtn = el("button", "lt-reessayer", { type: "button" });
    this.msgBtn.innerHTML = ICONES.retour + "<span>Réessayer</span>";
    var corps = el("div", "lt-msg-corps");
    corps.append(this.msgLogo, this.msgT, this.msgS, this.msgBtn);
    this.msg.appendChild(corps);

    this.grand = bouton("lt-grand", "Lecture", ICONES.lire);

    this.barre = el("div", "lt-barre");
    this.prog = el("input", "lt-prog", { type: "range", min: 0, max: 1000, step: 1, value: 0, "aria-label": "Position dans la vidéo" });
    var ligne = el("div", "lt-ligne");
    this.bLire = bouton("lt-lire", "Lecture", ICONES.lire);
    this.bDirect = el("button", "lt-direct", { type: "button", "aria-label": "Revenir au direct" });
    this.bDirect.innerHTML = '<i></i><span>EN DIRECT</span>';
    this.temps = el("span", "lt-temps", { "aria-hidden": "true" });
    var espace = el("span", "lt-espace");
    this.bSon = bouton("lt-son", "Couper le son", ICONES.sonFort);
    this.vol = el("input", "lt-vol", { type: "range", min: 0, max: 1, step: 0.05, value: 1, "aria-label": "Volume" });
    var bloc = el("div", "lt-bloc-son"); bloc.append(this.bSon, this.vol);
    this.bReg = bouton("lt-reg", "Réglages", ICONES.reglages);
    this.bReg.setAttribute("aria-haspopup", "true"); this.bReg.setAttribute("aria-expanded", "false");
    this.bPip = bouton("lt-pip", "Image dans l'image", ICONES.pip);
    this.bPlein = bouton("lt-plein-b", "Plein écran", ICONES.plein);
    ligne.append(this.bLire, this.bDirect, this.temps, espace, bloc, this.bReg, this.bPip, this.bPlein);
    this.barre.append(this.prog, ligne);

    this.menu = el("div", "lt-menu", { role: "menu", "aria-label": "Réglages du lecteur" });
    this.menu.hidden = true;

    z.append(this.scene, this.attente, this.msg, this.grand, this.barre, this.menu);

    var fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled || this.v.webkitEnterFullscreen);
    this.bPlein.hidden = !fsOk;
    var pipOk = !!((document.pictureInPictureEnabled && !this.v.disablePictureInPicture) || (this.v.webkitSupportsPresentationMode && this.v.webkitSupportsPresentationMode("picture-in-picture")));
    this.bPip.hidden = !pipOk;
  };

  P.lier = function () {
    var self = this, v = this.v, z = this.zone;

    // Commandes
    this.bLire.onclick = this.grand.onclick = function () { self.basculer(); };
    this.bSon.onclick = function () { v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 0.5; };
    this.vol.oninput = function () { v.volume = +self.vol.value; v.muted = v.volume === 0; };
    this.bPlein.onclick = function () { self.pleinEcran(); };
    this.bPip.onclick = function () { self.pip(); };
    this.bDirect.onclick = function () { self.versDirect(); };
    this.bReg.onclick = function (e) { e.stopPropagation(); self.menuOuvert(self.menu.hidden); };
    this.msgBtn.onclick = function (e) { e.stopPropagation(); self.relancer(); };

    // Barre de position
    this.prog.addEventListener("input", function () {
      var b = self.bornes(); if (b[1] <= b[0]) return;
      v.currentTime = b[0] + (b[1] - b[0]) * (+self.prog.value / 1000);
      self.majProgres();
    });
    var debut = function () { self.glisse = true; }, fin = function () { self.glisse = false; self.majProgres(); };
    this.prog.addEventListener("pointerdown", debut);
    this.prog.addEventListener("pointerup", fin);
    this.prog.addEventListener("pointercancel", fin);
    this.prog.addEventListener("blur", fin);

    // Clic sur l'image : lecture/pause (souris) ou afficher/masquer les commandes (tactile)
    this.scene.addEventListener("pointerdown", function (e) { self.pointeur = e.pointerType || "mouse"; self.etaitActif = z.classList.contains("lt-actif"); });
    this.scene.addEventListener("click", function () {
      if (!self.menu.hidden) { self.menuOuvert(false); return; }
      if (self.pointeur === "touch" || self.pointeur === "pen") {
        if (self.etaitActif && self.jouant) { z.classList.remove("lt-actif"); clearTimeout(self.masque); }
        else self.reveiller();
      } else self.basculer();
    });
    this.scene.addEventListener("dblclick", function () { if (self.pointeur === "mouse") self.pleinEcran(); });

    // Activité : afficher les commandes puis les masquer
    ["pointermove", "pointerdown", "keydown", "focusin"].forEach(function (n) { z.addEventListener(n, function () { self.reveiller(); }); });
    z.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") self.masquerBientot(600); });
    document.addEventListener("click", function (e) { if (!self.menu.hidden && !self.menu.contains(e.target) && e.target !== self.bReg && !self.bReg.contains(e.target)) self.menuOuvert(false); });

    // Clavier
    z.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" && !self.menu.hidden) { self.menuOuvert(false); self.bReg.focus(); e.preventDefault(); return; }
      var k = e.key, t = e.target;
      // Dans le menu des réglages : flèches haut/bas pour naviguer
      if (!self.menu.hidden && self.menu.contains(t) && (k === "ArrowDown" || k === "ArrowUp")) {
        var items = [].slice.call(self.menu.querySelectorAll("button")), i = items.indexOf(t);
        items[(i + (k === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
        e.preventDefault(); return;
      }
      // Les boutons gardent Entrée/Espace, les curseurs gardent les flèches
      if (t.closest && t.closest("button,[role=menuitemradio]") && (k === " " || k === "Enter")) return;
      if (t.tagName === "INPUT" && (k === " " || k.indexOf("Arrow") === 0 || k === "Home" || k === "End")) return;
      if (!self.menu.hidden && self.menu.contains(t)) return;
      if (z.classList.contains("lt-vide")) return;
      var pris = true;
      if (k === " " || k === "k" || k === "K") self.basculer();
      else if (k === "f" || k === "F") self.pleinEcran();
      else if (k === "m" || k === "M") v.muted = !v.muted;
      else if (k === "ArrowUp") { v.muted = false; v.volume = borner(v.volume + 0.1, 0, 1); }
      else if (k === "ArrowDown") v.volume = borner(v.volume - 0.1, 0, 1);
      else if (k === "ArrowLeft") self.saut(-10);
      else if (k === "ArrowRight") self.saut(10);
      else pris = false;
      if (pris) e.preventDefault();
    });

    // Événements du média
    v.addEventListener("playing", function () { self.surLecture(); });
    v.addEventListener("pause", function () { self.majBoutons(); self.reveiller(); self.libererVeille(); });
    v.addEventListener("play", function () { self.majBoutons(); });
    v.addEventListener("ended", function () { self.majBoutons(); self.reveiller(); });
    v.addEventListener("waiting", function () { self.occuper(true); self.armerVeille(); });
    v.addEventListener("seeking", function () { self.occuper(true); });
    v.addEventListener("seeked", function () { if (!v.paused) self.occuper(false); });
    v.addEventListener("canplay", function () { if (self.jouant) self.occuper(false); });
    v.addEventListener("timeupdate", function () { self.majProgres(); });
    v.addEventListener("progress", function () { self.majProgres(); });
    v.addEventListener("durationchange", function () { self.majMode(); });
    v.addEventListener("loadedmetadata", function () { self.majMode(); });
    v.addEventListener("volumechange", function () { self.majSon(); });
    v.addEventListener("error", function () {
      if (self.methodes[self.m] === "hls" || !self.url) return;
      self.raison = self.raison || ("code " + (v.error ? v.error.code : "?"));
      self.echec();
    });
    v.addEventListener("enterpictureinpicture", function () { z.classList.add("lt-pip-actif"); });
    v.addEventListener("leavepictureinpicture", function () { z.classList.remove("lt-pip-actif"); });

    // Plein écran (+ paysage automatique sur téléphone)
    var fs = function () {
      var el = document.fullscreenElement || document.webkitFullscreenElement, on = el === z;
      z.classList.toggle("lt-plein", on);
      self.bPlein.innerHTML = on ? ICONES.pleinSortir : ICONES.plein;
      self.bPlein.setAttribute("aria-label", on ? "Quitter le plein écran" : "Plein écran");
      self.bPlein.title = on ? "Quitter le plein écran" : "Plein écran";
      try {
        if (on && screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(function () {});
        else if (!on && screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
      } catch (e) {}
    };
    document.addEventListener("fullscreenchange", fs);
    document.addEventListener("webkitfullscreenchange", fs);

    // Réseau et visibilité
    global.addEventListener("online", function () { if (self.erreurFinale) self.relancer(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && self.jouant && !v.paused) self.prendreVeille(); });
  };

  P.reveiller = function () {
    this.zone.classList.add("lt-actif");
    this.masquerBientot(3000);
  };
  P.masquerBientot = function (ms) {
    var self = this; clearTimeout(this.masque);
    this.masque = setTimeout(function () {
      if (self.v.paused || !self.menu.hidden || self.glisse) return;
      if (self.zone.contains(document.activeElement) && document.activeElement.matches && document.activeElement.matches(":focus-visible")) return;
      self.zone.classList.remove("lt-actif");
    }, ms);
  };

  /* ---------- Messages et états ---------- */
  P.message = function (titre, sous, opts) {
    opts = opts || {};
    this.msgT.textContent = titre || ""; this.msgS.textContent = sous || "";
    this.msgS.hidden = !sous;
    this.msgBtn.hidden = !opts.relancer;
    this.msgLogo.innerHTML = opts.erreur ? ICONES.alerte : "";
    this.msgLogo.hidden = !opts.erreur;
    this.msg.classList.toggle("lt-msg-erreur", !!opts.erreur);
    this.msg.hidden = !titre;
    this.zone.classList.toggle("lt-avec-msg", !!titre);
    this.zone.classList.toggle("lt-erreur", !!(titre && opts.erreur));
  };
  P.occuper = function (o) { this.occupe = o; this.zone.classList.toggle("lt-charge", o); };
  P.majBoutons = function () {
    var v = this.v, lit = !v.paused && !v.ended;
    this.zone.classList.toggle("lt-pause", !lit);
    this.bLire.innerHTML = lit ? ICONES.pause : ICONES.lire;
    this.bLire.setAttribute("aria-label", lit ? "Pause" : "Lecture"); this.bLire.title = lit ? "Pause" : "Lecture";
    this.grand.setAttribute("aria-label", lit ? "Pause" : "Lecture");
  };
  P.majSon = function () {
    var v = this.v, coupe = v.muted || v.volume === 0;
    this.bSon.innerHTML = coupe ? ICONES.sonCoupe : (v.volume < 0.5 ? ICONES.sonBas : ICONES.sonFort);
    this.bSon.setAttribute("aria-label", coupe ? "Remettre le son" : "Couper le son"); this.bSon.title = coupe ? "Remettre le son" : "Couper le son";
    this.vol.value = coupe ? 0 : v.volume;
    this.vol.style.setProperty("--niv", (coupe ? 0 : v.volume * 100) + "%");
    try { localStorage.setItem(CLE_VOLUME, JSON.stringify({ v: v.volume, m: v.muted })); } catch (e) {}
  };
  P.volumeDepart = function () {
    try {
      var s = JSON.parse(localStorage.getItem(CLE_VOLUME));
      if (s && typeof s.v === "number") { this.v.volume = borner(s.v, 0, 1); this.v.muted = !!s.m; }
    } catch (e) {}
    this.majSon();
  };

  /* ---------- Position, direct, durée ---------- */
  P.bornes = function () {
    var v = this.v, s = v.seekable;
    if (s && s.length) return [s.start(0), s.end(s.length - 1)];
    if (isFinite(v.duration)) return [0, v.duration];
    return [0, 0];
  };
  P.majMode = function () {
    var v = this.v;
    var direct = this.direct || v.duration === Infinity;
    this.direct = direct;
    var b = this.bornes(), fenetre = b[1] - b[0];
    var peutChercher = fenetre > (direct ? 60 : 0.5);
    this.zone.classList.toggle("lt-live", direct);
    this.zone.classList.toggle("lt-sans-pos", !peutChercher);
    this.prog.disabled = !peutChercher;
    this.majProgres(); this.majMenu();
  };
  P.majProgres = function () {
    var v = this.v, b = this.bornes(), fenetre = b[1] - b[0];
    if (!this.glisse && fenetre > 0) {
      var p = borner((v.currentTime - b[0]) / fenetre, 0, 1);
      this.prog.value = Math.round(p * 1000);
      this.prog.style.setProperty("--lu", p * 100 + "%");
    }
    var ch = 0;
    if (v.buffered && v.buffered.length && fenetre > 0) {
      for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) ch = v.buffered.end(i);
      ch = borner((ch - b[0]) / fenetre, 0, 1);
    }
    this.prog.style.setProperty("--ch", ch * 100 + "%");
    if (this.direct) {
      var retard = b[1] - v.currentTime;
      var diff = fenetre > 60 && retard > 15;
      this.bDirect.classList.toggle("lt-diff", diff);
      this.bDirect.disabled = !diff;
      this.temps.textContent = diff ? "−" + dur(retard) : "";
    } else {
      this.temps.textContent = isFinite(v.duration) ? dur(v.currentTime) + " / " + dur(v.duration) : "";
    }
  };
  P.versDirect = function () {
    var b = this.bornes(), pos = this.hls && this.hls.liveSyncPosition;
    this.v.currentTime = pos || Math.max(b[0], b[1] - 1);
    if (this.v.paused) this.v.play().catch(function () {});
  };
  P.saut = function (s) {
    var b = this.bornes(); if (b[1] <= b[0]) return;
    if (this.direct && b[1] - b[0] <= 60) return;
    this.v.currentTime = borner(this.v.currentTime + s, b[0], b[1]);
  };

  /* ---------- Actions ---------- */
  P.basculer = function () {
    var v = this.v;
    if (this.erreurFinale) { this.relancer(); return; }
    if (!this.url) return;
    if (v.paused || v.ended) {
      if (this.direct && this.hls) { try { this.hls.startLoad(); } catch (e) {} }
      v.play().catch(function () {});
    } else v.pause();
  };
  P.pleinEcran = function () {
    var z = this.zone, v = this.v, self = this;
    var actif = document.fullscreenElement || document.webkitFullscreenElement;
    var ios = function () { if (v.webkitEnterFullscreen) { try { v.webkitEnterFullscreen(); } catch (e) {} } };
    if (actif) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (z.requestFullscreen) { var r = z.requestFullscreen(); if (r && r.catch) r.catch(ios); }
    else if (z.webkitRequestFullscreen) z.webkitRequestFullscreen();
    else ios();
  };
  P.pip = function () {
    var v = this.v;
    try {
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else if (v.requestPictureInPicture) v.requestPictureInPicture().catch(function () {});
      else if (v.webkitSetPresentationMode) v.webkitSetPresentationMode(v.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture");
    } catch (e) {}
  };

  /* ---------- Réglages (qualité, vitesse) ---------- */
  P.menuOuvert = function (o) {
    if (o) this.majMenu();
    if (o && !this.menu.children.length) return;
    this.menu.hidden = !o;
    this.bReg.setAttribute("aria-expanded", o ? "true" : "false");
    this.zone.classList.toggle("lt-menu-ouvert", o);
    if (o) { var c = this.menu.querySelector("[aria-checked=true]") || this.menu.querySelector("button"); if (c) c.focus({ preventScroll: true }); this.reveiller(); }
  };
  P.groupe = function (titre, choix, actuel, action) {
    var self = this, g = el("div", "lt-groupe", { role: "group", "aria-label": titre });
    g.appendChild(el("div", "lt-groupe-t")).textContent = titre;
    choix.forEach(function (c) {
      var b = el("button", "lt-choix", { type: "button", role: "menuitemradio", "aria-checked": c.val === actuel ? "true" : "false" });
      b.textContent = c.label;
      b.onclick = function (e) { e.stopPropagation(); action(c.val); self.majMenu(); self.menuOuvert(false); self.bReg.focus({ preventScroll: true }); };
      g.appendChild(b);
    });
    return g;
  };
  P.majMenu = function () {
    var self = this, m = this.menu;
    m.textContent = "";
    var niveaux = this.hls && this.hls.levels ? this.hls.levels : [];
    if (niveaux.length > 1) {
      var vus = {}, choix = [{ val: -1, label: "Auto" }];
      var liste = niveaux.map(function (n, i) { return { i: i, h: n.height || 0, b: n.bitrate || 0 }; }).sort(function (a, b) { return (b.h - a.h) || (b.b - a.b); });
      liste.forEach(function (n) {
        var label = n.h ? n.h + "p" : (n.b ? Math.round(n.b / 1000) + " kb/s" : "Niveau " + (n.i + 1));
        if (vus[label]) return; vus[label] = 1;
        choix.push({ val: n.i, label: label });
      });
      m.appendChild(this.groupe("Qualité", choix, this.niveau, function (val) {
        self.niveau = val;
        if (self.hls) self.hls.currentLevel = val;
      }));
    }
    if (!this.direct && this.url) {
      m.appendChild(this.groupe("Vitesse", VITESSES.map(function (x) { return { val: x, label: x === 1 ? "Normale" : x + "×" }; }), this.vitesse, function (val) {
        self.vitesse = val; self.v.playbackRate = val;
      }));
    }
    this.bReg.hidden = !m.children.length;
    if (!m.children.length && !this.menu.hidden) this.menuOuvert(false);
  };

  /* ---------- Lecture d'un flux ---------- */
  P.accueil = function (titre, sous) {
    this.arreter();
    this.zone.classList.add("lt-vide");
    this.message(titre, sous);
  };

  P.arreter = function () {
    this.token++;
    clearTimeout(this.garde); clearTimeout(this.relance); clearTimeout(this.veille);
    if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
    var v = this.v;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
    this.url = ""; this.jouant = false; this.direct = false; this.erreurFinale = false;
    this.niveau = -1; this.essais = 0; this.reprisesMedia = 0; this.raison = "";
    this.occuper(false); this.message(null);
    this.zone.classList.remove("lt-live"); this.zone.classList.add("lt-sans-pos");
    this.libererVeille(); this.majMenu(); this.majBoutons();
    if (this.menu && !this.menu.hidden) this.menuOuvert(false);
    this.temps.textContent = ""; this.prog.value = 0; this.prog.style.setProperty("--lu", "0%"); this.prog.style.setProperty("--ch", "0%");
  };

  P.lire = function (url, infos) {
    infos = infos || {};
    this.arreter();
    this.url = url; this.titre = infos.titre || ""; this.logo = infos.logo || "";
    var v = this.v;
    this.zone.classList.remove("lt-vide");
    v.playbackRate = this.vitesse = 1;
    var natif = !!(v.canPlayType && v.canPlayType("application/vnd.apple.mpegurl"));
    var hlsPossible = !!(global.MediaSource || global.ManagedMediaSource);
    var estHls = /m3u8/i.test(url);
    // Ordre des méthodes : "natif" (l'appareil lit tout seul, sans contrainte CORS), "hls" (hls.js), "direct" (mp4, mp3...)
    this.methodes = estHls ? (natif ? (hlsPossible ? ["natif", "hls"] : ["natif"]) : (hlsPossible ? ["hls"] : ["natif"])) : (hlsPossible ? ["direct", "hls"] : ["direct"]);
    this.m = 0;
    this.metadonnees();
    this.demarrer();
  };

  P.demarrer = function () {
    var self = this, v = this.v, meth = this.methodes[this.m], jeton = ++this.token, url = this.url;
    clearTimeout(this.garde); clearTimeout(this.veille);
    this.jouant = false; this.erreurFinale = false;
    if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
    this.message(null); this.occuper(true);

    var jouer = function () {
      var p = v.play();
      if (p && p.catch) p.catch(function (err) {
        if (err && err.name === "NotAllowedError" && jeton === self.token) { self.occuper(false); self.reveiller(); self.message(self.titre || "Prêt", "Touche lecture pour démarrer."); }
      });
    };

    if (meth === "hls") {
      chargerHls().then(function (Hls) {
        if (jeton !== self.token) return;
        if (!Hls.isSupported()) { self.raison = "hls non pris en charge"; self.echec(); return; }
        var h = new Hls({ enableWorker: true, liveDurationInfinity: true, backBufferLength: 60, maxBufferLength: 30 });
        self.hls = h;
        h.on(Hls.Events.MANIFEST_PARSED, function () { self.majMenu(); });
        h.on(Hls.Events.LEVEL_LOADED, function (ev, d) {
          var direct = !!(d && d.details && d.details.live);
          if (direct !== self.direct) { self.direct = direct; self.majMode(); }
        });
        h.on(Hls.Events.ERROR, function (ev, d) {
          if (jeton !== self.token || !d.fatal) return;
          self.raison = d.details || d.type || "";
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && self.reprisesMedia < 2) { self.reprisesMedia++; h.recoverMediaError(); return; }
          self.echec();
        });
        h.loadSource(url); h.attachMedia(v);
        jouer();
      }).catch(function () {
        if (jeton !== self.token) return;
        self.raison = "bibliothèque hls.js indisponible"; self.echec();
      });
    } else {
      v.src = url;
      jouer();
    }
    // Lecture qui ne démarre pas : on passe à la méthode suivante
    if (this.m < this.methodes.length - 1) this.garde = setTimeout(function () { if (jeton === self.token && !self.jouant) self.echec(); }, 9000);
  };

  P.conseil = function (d) {
    if (/manifestParsing|manifestLoadError.*parse/i.test(d)) return "Ce lien n'est pas une playlist HLS valide.";
    if (/codec|bufferAdd|bufferAppend|fragParsing|code 3|code 4/i.test(d) && !/manifestLoad|levelLoad|fragLoad/i.test(d)) return "Format vidéo non pris en charge par cet appareil.";
    if (/hls\.js/i.test(d)) return "Le lecteur n'a pas pu se charger. Vérifie ta connexion.";
    return "";
  };

  P.echec = function () {
    var self = this;
    if (!this.url) return;
    clearTimeout(this.garde);
    if (this.m < this.methodes.length - 1) { this.m++; this.demarrer(); return; }
    this.essais++;
    if (this.essais > 3) {
      this.token++;   // ignore tout événement tardif
      if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
      this.erreurFinale = true; this.occuper(false); this.libererVeille();
      var off = global.navigator && navigator.onLine === false;
      this.message(this.titre ? this.titre + " : flux indisponible" : "Flux indisponible",
        off ? "Tu sembles hors ligne. La lecture reprendra dès le retour de la connexion." : (this.conseil(this.raison) ? this.conseil(this.raison) + (this.raison ? " (" + this.raison + ")" : "") : ""),
        { erreur: true, relancer: true });
      this.reveiller();
      return;
    }
    this.occuper(true);
    this.message(this.titre, "Connexion perdue. Nouvelle tentative " + this.essais + "/3…");
    this.relance = setTimeout(function () { self.m = 0; self.reprisesMedia = 0; self.demarrer(); }, 2500 * this.essais);
  };

  P.relancer = function () {
    if (!this.url) return;
    clearTimeout(this.relance);
    // Réessai manuel : une seule tentative franche (pas 3 tentatives lentes avant de savoir si ça marche)
    this.essais = 3; this.m = 0; this.reprisesMedia = 0; this.raison = "";
    this.demarrer();
  };

  P.surLecture = function () {
    this.jouant = true; this.essais = 0; this.erreurFinale = false;
    clearTimeout(this.garde); clearTimeout(this.veille); clearTimeout(this.relance);
    this.occuper(false); this.message(null);
    this.majBoutons(); this.majMode(); this.prendreVeille();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    this.reveiller();
  };

  // Flux qui reste bloqué trop longtemps : on relance proprement
  P.armerVeille = function () {
    var self = this, jeton = this.token;
    clearTimeout(this.veille);
    if (!this.jouant) return;
    this.veille = setTimeout(function () {
      if (jeton !== self.token || self.v.paused) return;
      self.raison = "flux bloqué"; self.jouant = false; self.m = 0; self.echec();
    }, 20000);
  };

  /* ---------- Confort : écran allumé, commandes du système ---------- */
  P.prendreVeille = function () {
    var self = this;
    try {
      if (!navigator.wakeLock || this.verrou) return;
      navigator.wakeLock.request("screen").then(function (l) {
        self.verrou = l; l.addEventListener("release", function () { if (self.verrou === l) self.verrou = null; });
      }).catch(function () {});
    } catch (e) {}
  };
  P.libererVeille = function () {
    try { if (this.verrou) { this.verrou.release(); this.verrou = null; } } catch (e) {}
  };
  P.metadonnees = function () {
    if (!("mediaSession" in navigator)) return;
    var self = this;
    try {
      var art = this.logo && /^https:/i.test(this.logo) ? [{ src: this.logo }] : [];
      navigator.mediaSession.metadata = new MediaMetadata({ title: this.titre || "DAFLIX TV", artist: "DAFLIX TV", artwork: art });
      navigator.mediaSession.setActionHandler("play", function () { self.v.play().catch(function () {}); });
      navigator.mediaSession.setActionHandler("pause", function () { self.v.pause(); });
    } catch (e) {}
  };

  global.LecteurTV = LecteurTV;
})(window);
