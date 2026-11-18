/*
 * Copyright 2026 Anthropic PBC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pre-loader. Its own styles are inline in index.html, so it paints first.
 *  1. Wait for the spinning pizza image and the headline font, then show the
 *     pre-loader in full.
 *  2. Only then load the rest of the site: the main stylesheet, the photos
 *     (written as data-src in the markup), config.js, app.js and the menu
 *     photos named in config.js. The progress bar tracks each one.
 *  3. When everything has arrived (or after a time limit), fade it out.
 */
(function () {
  'use strict';

  var me = document.currentScript;
  var VER = (me && me.getAttribute('data-version')) || '1';
  var READY_LIMIT_MS = 3000;   // never wait longer than this for the pizza + font
  var TOTAL_LIMIT_MS = 20000;  // never keep the site hidden longer than this
  var STEPS = [[25, 'Warming the oven'], [50, 'Rolling the dough'], [75, 'Adding the toppings'], [100, 'Baking'], [101, 'Ready!']];

  var root = document.getElementById('preloader');
  if (!root) return;
  var fill = document.getElementById('preloader-fill');
  var track = document.getElementById('preloader-track');
  var pctEl = document.getElementById('preloader-pct');
  var stepEl = document.getElementById('preloader-step');
  var pizza = root.querySelector('.preloader-pizza img');
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---------- helpers ---------- */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function imageReady(img) {
    return new Promise(function (r) {
      if (!img || (img.complete && img.naturalWidth)) return r();
      img.addEventListener('load', r, { once: true });
      img.addEventListener('error', r, { once: true });
    });
  }
  function fontReady() {
    // The font stylesheet loads without blocking the page; wait for it, then for Anton itself.
    var link = document.getElementById('font-css');
    var cssLoaded = new Promise(function (r) {
      if (!link || link.sheet) return r();
      link.addEventListener('load', r, { once: true });
      link.addEventListener('error', r, { once: true });
    });
    return cssLoaded.then(function () {
      if (!document.fonts || !document.fonts.load) return;
      return document.fonts.load('56px Anton').catch(function () {});
    });
  }

  /* ---------- progress ---------- */
  var total = 0, done = 0, shown = 0, finished = false;
  function track1() {
    total++;
    var called = false;
    return function () { if (called) return; called = true; done++; update(); };
  }
  function update() {
    var p = total ? Math.floor(done / total * 100) : 0;
    if (p < shown) p = shown;          // never go backwards when new items are added
    shown = p;
    fill.style.width = p + '%';
    pctEl.textContent = p + '%';
    track.setAttribute('aria-valuenow', p);
    for (var i = 0; i < STEPS.length; i++) if (p < STEPS[i][0]) { stepEl.textContent = STEPS[i][1]; break; }
    if (done === total && appLoaded) finish();
  }

  /* ---------- loading the rest of the site ---------- */
  var appLoaded = false;
  function loadCss(href) {
    var d = track1();
    return new Promise(function (r) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href;
      l.onload = l.onerror = function () { d(); r(); };
      document.head.appendChild(l);
    });
  }
  function loadScript(src) {
    var d = track1();
    return new Promise(function (r) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = s.onerror = function () { d(); r(); };
      document.body.appendChild(s);
    });
  }
  function loadImage(img, src) {
    var d = track1();
    img.addEventListener('load', d, { once: true });
    img.addEventListener('error', d, { once: true });
    img.src = src;
  }
  function loadSite() {
    var css = loadCss('css/styles.css?v=' + VER);
    Array.prototype.forEach.call(document.querySelectorAll('img[data-src]'), function (img) {
      var src = img.getAttribute('data-src');
      img.removeAttribute('data-src');
      loadImage(img, src);
    });
    var config = loadScript('js/config.js?v=' + VER).then(function () {
      // Menu photos are named in config.js and drawn by app.js; fetch them now.
      if (window.PRESETS && PRESETS.forEach) PRESETS.forEach(function (p) { if (p.img) loadImage(new Image(), p.img); });
    });
    var appDone = track1();
    // app.js measures the page, so it runs once the stylesheet is in.
    Promise.all([css, config]).then(function () {
      var s = document.createElement('script');
      s.src = 'js/app.js?v=' + VER; s.async = false;
      s.onload = s.onerror = function () { appLoaded = true; appDone(); };
      document.body.appendChild(s);
    });
    update();
    setTimeout(finish, TOTAL_LIMIT_MS);
  }

  /* ---------- the end ---------- */
  function finish() {
    if (finished) return;
    finished = true;
    shown = 100; fill.style.width = '100%'; pctEl.textContent = '100%';
    track.setAttribute('aria-valuenow', 100); stepEl.textContent = 'Ready!';
    setTimeout(function () {
      root.classList.add('done');
      document.documentElement.classList.remove('is-loading');
      if (location.hash) {
        try { var t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); } catch (e) {}
      }
      try { window.dispatchEvent(new Event('resize')); } catch (e) {}
      setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 600);
    }, reduced ? 0 : 450);
  }

  /* ---------- go ---------- */
  Promise.race([Promise.all([imageReady(pizza), fontReady()]), wait(READY_LIMIT_MS)]).then(function () {
    root.classList.add('ready');
    // Let the pre-loader finish fading in before the rest starts downloading.
    setTimeout(loadSite, reduced ? 0 : 400);
  });
})();
