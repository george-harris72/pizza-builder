/*
 * Copyright 2026 Anthropic PBC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pizza builder: state, rendering, drag and drop, basket and checkout.
 * No framework and no build step. All menu data comes from config.js.
 *
 * Rendering model: every state change schedules one render() on the next
 * microtask. Each region is re-rendered with patchHTML(), which skips the
 * DOM write when the markup is unchanged and restores keyboard focus when it
 * is not. Pizza pieces are keyed so the drop animation only plays on new ones.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ING_BY = {};
  INGREDIENTS.forEach(function (i) { ING_BY[i.id] = i; });

  /* =====================================================================
     UTILITIES
     ===================================================================== */
  var GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  function money(p) { return GBP.format(p / 100); }
  function moneyShort(p) { return p % 100 ? money(p) : '£' + (p / 100); }
  function rng(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }
  function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(id) { return document.getElementById(id); }
  function pieceTf(p, ing) {
    return 'translate(' + (p.x * 400).toFixed(1) + ' ' + (p.y * 400).toFixed(1) + ') rotate(' + p.rot + ') scale(' + (p.sc * ing.s * 1.25).toFixed(3) + ')';
  }
  function vibrate() { try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {} }
  function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  var pieceSeq = 0;
  /* Scatter n pieces. `at` = normalised drop point or null (whole pizza). */
  function genPieces(ing, n, at, crustId, rand) {
    rand = rand || Math.random;
    var sR = find(CRUSTS, crustId).sauceR / 400;
    var half = (20 * ing.s * 1.25 / 400) * 0.6;
    var maxR = Math.max(0.01, sR - half);
    var out = [], off = rand() * 6.28;
    for (var i = 0; i < n; i++) {
      var x, y, a, r;
      if (at) {
        var spread = n === 1 ? 0 : Math.min(0.16, maxR);
        a = rand() * 6.283; r = spread * Math.sqrt(rand());
        x = at.x + Math.cos(a) * r; y = at.y + Math.sin(a) * r;
      } else if (n === 1) {
        x = 0.5 + (rand() - 0.5) * 0.06; y = 0.5 + (rand() - 0.5) * 0.06;
      } else {
        r = maxR * Math.sqrt((i + 0.5) / n) * (0.88 + rand() * 0.2);
        a = off + i * 2.39996 + (rand() - 0.5) * 0.5;
        x = 0.5 + Math.cos(a) * r; y = 0.5 + Math.sin(a) * r;
      }
      var dx = x - 0.5, dy = y - 0.5, d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxR) { var k = maxR * (0.9 + rand() * 0.1) / d; x = 0.5 + dx * k; y = 0.5 + dy * k; }
      out.push({ k: ++pieceSeq, x: +x.toFixed(4), y: +y.toFixed(4), rot: Math.round(rand() * 360), sc: +(0.85 + rand() * 0.3).toFixed(2), d: Math.round(i * (30 + rand() * 30)) });
    }
    return out;
  }
  function clampPieces(toppings, crustId) {
    var sR = find(CRUSTS, crustId).sauceR / 400;
    toppings.forEach(function (t) {
      var ing = ING_BY[t.id], half = (20 * ing.s * 1.25 / 400) * 0.6, maxR = Math.max(0.01, sR - half);
      t.pieces.forEach(function (p) {
        var dx = p.x - 0.5, dy = p.y - 0.5, d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxR) { var k = maxR * 0.95 / d; p.x = +(0.5 + dx * k).toFixed(4); p.y = +(0.5 + dy * k).toFixed(4); }
      });
    });
  }

  /* Pricing (all pence) */
  function unitPrice(base, toppings) {
    if (!base.size) return 0;
    var p = find(SIZES, base.size).price + find(CRUSTS, base.crust).extra + find(CHEESES, base.cheese).extra;
    toppings.forEach(function (t) { p += ING_BY[t.id].price * t.portions; });
    return p;
  }
  function linesFor(base, toppings) {
    var size = find(SIZES, base.size || 'medium'), crust = find(CRUSTS, base.crust), sauce = find(SAUCES, base.sauce), cheese = find(CHEESES, base.cheese);
    var L = [
      { label: size.label + ' ' + size.sub + ' base', price: money(size.price) },
      { label: crust.label + ' crust', price: crust.extra ? money(crust.extra) : 'Included' },
      { label: sauce.id === 'none' ? 'No sauce' : sauce.label + ' sauce', price: 'Included' },
      { label: cheese.label, price: cheese.extra ? money(cheese.extra) : 'Included' }
    ];
    toppings.forEach(function (t) {
      var ing = ING_BY[t.id];
      L.push({ label: ing.name + (t.portions > 1 ? ' ×2' : ''), price: money(ing.price * t.portions) });
    });
    return L;
  }
  function dietFor(base, toppings) {
    var ings = toppings.map(function (t) { return ING_BY[t.id]; });
    var out = [];
    var meat = ings.some(function (i) { return i.cat === 'meat'; });
    var vegan = !meat && ings.every(function (i) { return i.diet.indexOf('VG') >= 0; }) && (base.cheese === 'vegan' || base.cheese === 'none') && base.sauce !== 'garlic';
    if (meat) out.push({ label: 'Contains meat', cls: 'meat' });
    else if (vegan) out.push({ label: 'Vegan', cls: '' });
    else out.push({ label: 'Vegetarian', cls: '' });
    if (ings.some(function (i) { return i.diet.indexOf('HOT') >= 0; })) out.push({ label: 'Spicy', cls: 'meat' });
    if (base.crust === 'gf') out.push({ label: 'Gluten-free base', cls: '' });
    return out;
  }
  function counts(toppings) {
    var meat = 0, veg = 0;
    toppings.forEach(function (t) { var c = ING_BY[t.id].cat; if (c === 'meat') meat++; if (c === 'veg') veg++; });
    return { meat: meat, veg: veg };
  }

  /* =====================================================================
     GAME LOGIC: meter, badges, names
     ===================================================================== */
  function meterFor(toppings) {
    var n = toppings.length;
    if (!n) return { v: 0, label: 'Plain Jane' };
    var c = counts(toppings);
    var pieces = toppings.reduce(function (a, t) { return a + t.pieces.length; }, 0);
    var variety = Math.min(n, 6) / 6 * 40;
    var balance = (c.meat && c.veg) ? 30 * (1 - Math.abs(c.meat - c.veg) / (c.meat + c.veg)) + 5 : 10;
    var coverage = Math.min(1, pieces / 50) * 25;
    var v = Math.round(Math.min(100, variety + balance + coverage));
    var label = v < 25 ? 'Plain Jane' : v < 50 ? 'Getting tasty' : v < 80 ? "Chef's kiss" : 'Legendary';
    return { v: v, label: label };
  }
  function badgesFor(toppings, moves) {
    var ids = toppings.map(function (t) { return t.id; }), c = counts(toppings), out = [];
    if (c.veg >= 4 && c.meat === 0) out.push('garden');
    if (ids.indexOf('jalapeno') >= 0 && ids.indexOf('chilli') >= 0) out.push('burn');
    if (ids.indexOf('pineapple') >= 0) out.push('pine');
    if (c.meat >= 3) out.push('carn');
    if (c.meat === 2 && c.veg === 2) out.push('bal');
    if (moves >= 10) out.push('artist');
    return out;
  }
  function genName(base, toppings) {
    var ids = toppings.map(function (t) { return t.id; });
    if (!ids.length) return 'The Blank Canvas';
    function has() { for (var i = 0; i < arguments.length; i++) if (ids.indexOf(arguments[i]) >= 0) return true; return false; }
    var c = counts(toppings), adj = [], noun = [];
    if (has('jalapeno', 'chilli', 'beef')) adj.push('Fiery', 'Blazing', 'Red-Hot');
    if (has('bacon') || base.sauce === 'bbq') adj.push('Smoky');
    if (base.sauce === 'garlic') adj.push('Garlicky');
    if (has('goat', 'feta') || base.cheese === 'extra') adj.push('Cheesy', 'Creamy');
    if (has('basil', 'rocket')) adj.push('Fresh', 'Herby');
    if (c.meat >= 3) adj.push('Mighty', 'Hearty');
    if (!adj.length) adj.push('Classic', 'Golden', 'Happy', 'Humble');
    if (has('pineapple')) noun.push('Islander', 'Rebel');
    if (c.meat >= 3) noun.push('Butcher', 'Carnivore');
    else if (has('bacon', 'ham')) noun.push('Hog', 'Piggy');
    if (c.meat === 0 && c.veg >= 3) noun.push('Garden', 'Allotment', 'Greenhouse');
    if (has('chicken')) noun.push('Rooster');
    if (has('beef')) noun.push('Bull');
    if (has('pepperoni') && !noun.length) noun.push('Slice', 'Pepperoni Party');
    if (!noun.length) noun.push('Original', 'Favourite', 'Special');
    return 'The ' + pick(adj) + ' ' + pick(noun);
  }

  /* =====================================================================
     CHECKOUT helpers
     ===================================================================== */
  function validate(f) {
    var e = {};
    if (!f.name.trim()) e.name = 'Please enter your full name.';
    var ph = f.phone.replace(/[\s\-()]/g, '');
    if (!ph) e.phone = 'Please enter a phone number.';
    else if (!/^(\+44|0)\d{9,10}$/.test(ph)) e.phone = "That doesn't look like a UK phone number. Try 07123 456789.";
    if (!f.email.trim()) e.email = 'Please enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = "That email address doesn't look right.";
    if (f.method === 'delivery') {
      if (!f.address.trim()) e.address = 'Please enter your delivery address.';
      if (!f.postcode.trim()) e.postcode = 'Please enter your postcode.';
      else if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(f.postcode.trim())) e.postcode = 'Please enter a valid UK postcode, e.g. B91 3QJ.';
    }
    return e;
  }
  function timeSlots() {
    var now = new Date(), start = new Date(now.getTime() + 30 * 60000), out = [];
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    for (var i = 0; i < 12; i++) {
      var t = new Date(start.getTime() + i * 15 * 60000);
      if (t.getTime() - now.getTime() > 3 * 3600000) break;
      var v = pad(t.getHours()) + ':' + pad(t.getMinutes());
      out.push({ value: v, label: v });
    }
    return out;
  }
  function totalsFor(basket, method, promoApplied) {
    var sub = basket.reduce(function (a, it) { return a + it.unit * it.qty; }, 0);
    var disc = promoApplied ? Math.round(sub * 0.1) : 0;
    var del = (method === 'delivery' && sub > 0 && sub < FREE_OVER) ? DELIVERY_FEE : 0;
    return { sub: sub, disc: disc, del: del, total: sub - disc + del };
  }

  /* =====================================================================
     STATE
     ===================================================================== */
  function blankForm() { return { method: 'delivery', name: '', phone: '', email: '', address: '', postcode: '', time: 'asap', promo: '' }; }
  function blankBase() { return { size: null, crust: 'classic', sauce: 'tomato', cheese: 'mozzarella' }; }

  var saved = null;
  try { saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
  var state = Object.assign(
    { base: blankBase(), toppings: [], pizzaName: 'The Blank Canvas', nameCustom: false, moves: 0, badges: [], basket: [], soundOn: false },
    saved || {}
  );
  /* Older saves may be missing piece keys: give every piece a fresh one. */
  try { state.toppings.forEach(function (t) { t.pieces.forEach(function (p) { p.k = ++pieceSeq; p.d = 0; }); }); } catch (e) { state.toppings = []; }
  Object.assign(state, {
    history: [], filter: 'all', tab: 'tray', hover: false, ghost: null, shake: false, pulse: false, flash: false,
    live: '', modal: null,
    review: { qty: 1, notes: '', added: false },
    form: blankForm(),
    touched: {}, submitted: false, promoApplied: false, promoBad: false,
    order: null, confetti: []
  });

  var drag = null, raf = 0, pRaf = 0, uid = 0, suppressClick = false, lastTap = null;
  var opener = null, bakeImg = '', lastImg = '', lastName = '', audio = null;
  var nameKey = keyFor(state.base, state.toppings);

  var cheeseBlobs = [];
  (function () { var r = rng(42); for (var i = 0; i < 46; i++) { var a = r() * 6.283, d = 136 * Math.sqrt(r()); cheeseBlobs.push({ x: +(200 + Math.cos(a) * d).toFixed(1), y: +(200 + Math.sin(a) * d).toFixed(1), r: +(7 + r() * 9).toFixed(1) }); } })();

  var pending = false;
  function setState(patch) {
    if (typeof patch === 'function') patch = patch(state);
    Object.assign(state, patch);
    if (!pending) { pending = true; Promise.resolve().then(flush); }
  }
  var prev = {};
  function flush() {
    pending = false;
    render();
    var s = state;
    if (prev.base !== s.base || prev.toppings !== s.toppings || prev.basket !== s.basket || prev.pizzaName !== s.pizzaName || prev.soundOn !== s.soundOn || prev.badges !== s.badges) {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ base: s.base, toppings: s.toppings, pizzaName: s.pizzaName, nameCustom: s.nameCustom, moves: s.moves, badges: s.badges, basket: s.basket, soundOn: s.soundOn })); } catch (e) {}
    }
    if (prev.modal !== s.modal) {
      if (s.modal) {
        setTimeout(function () {
          var root = $('modal'); if (!root) return;
          var el = root.querySelector('[data-autofocus]') || root.querySelector('button:not([disabled]),input,textarea') || root;
          try { el.focus(); } catch (e) {}
        }, 40);
      } else if (opener && opener.focus && document.body.contains(opener)) {
        try { opener.focus(); } catch (e) {}
        opener = null;
      }
    }
    prev = { base: s.base, toppings: s.toppings, basket: s.basket, pizzaName: s.pizzaName, soundOn: s.soundOn, badges: s.badges, modal: s.modal };
  }

  /* =====================================================================
     FEEDBACK: toasts, live region, sound, poofs
     ===================================================================== */
  function announce(msg) { var el = $('live'); el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 20); }
  function toast(msg, kind) {
    var host = $('toasts'), el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    while (host.children.length > 3) host.removeChild(host.firstChild);
    announce(msg);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
  }
  function flag(name, ms) { var o = {}; o[name] = true; setState(o); setTimeout(function () { var f = {}; f[name] = false; setState(f); }, ms); }
  function poof(x, y) {
    if (reducedMotion()) return;
    var el = document.createElement('div');
    el.className = 'poof'; el.style.left = x + 'px'; el.style.top = y + 'px';
    $('fx').appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 460);
  }
  function sound(type) {
    if (!state.soundOn) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      if (!audio) audio = new C();
      var ac = audio, t = ac.currentTime, g = ac.createGain(); g.connect(ac.destination);
      if (type === 'plop') {
        var o = ac.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(460, t); o.frequency.exponentialRampToValueAtTime(130, t + 0.12);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); o.start(t); o.stop(t + 0.2);
      } else if (type === 'whoosh') {
        var len = Math.floor(ac.sampleRate * 0.25), buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        var src = ac.createBufferSource(); src.buffer = buf;
        var f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.22); f.Q.value = 1.2;
        g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        src.connect(f); f.connect(g); src.start(t);
      } else if (type === 'ding') {
        [880, 1320].forEach(function (fq, k) {
          var o2 = ac.createOscillator(), g2 = ac.createGain(); o2.type = 'triangle'; o2.frequency.value = fq;
          g2.gain.setValueAtTime(0.0001, t + k * 0.09); g2.gain.exponentialRampToValueAtTime(0.25, t + k * 0.09 + 0.01); g2.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.09 + 0.5);
          o2.connect(g2); g2.connect(ac.destination); o2.start(t + k * 0.09); o2.stop(t + k * 0.09 + 0.55);
        });
      }
    } catch (e) {}
  }

  /* =====================================================================
     PIZZA STATE CHANGES (with undo)
     ===================================================================== */
  function keyFor(base, toppings) { return toppings.map(function (t) { return t.id; }).sort().join(',') + '|' + base.sauce + '|' + base.cheese; }
  function snap() { var s = state; return JSON.stringify({ base: s.base, toppings: s.toppings, pizzaName: s.pizzaName, nameCustom: s.nameCustom, moves: s.moves, badges: s.badges }); }
  function setPizza(patch, noHist) {
    var s = state;
    var next = Object.assign({ base: s.base, toppings: s.toppings, moves: s.moves, pizzaName: s.pizzaName, nameCustom: s.nameCustom, badges: s.badges }, patch);
    var key = keyFor(next.base, next.toppings);
    if (!next.nameCustom && key !== nameKey) next.pizzaName = genName(next.base, next.toppings);
    nameKey = key;
    var earned = badgesFor(next.toppings, next.moves);
    var fresh = earned.filter(function (b) { return next.badges.indexOf(b) < 0; });
    if (fresh.length) {
      next.badges = next.badges.concat(fresh);
      fresh.forEach(function (b) { var B = BADGES.filter(function (x) { return x.id === b; })[0]; toast('Badge unlocked: ' + B.name + '!', 'badge'); });
      sound('ding');
    }
    if (!noHist) next.history = s.history.concat([snap()]).slice(-HISTORY_MAX);
    setState(next);
    return next;
  }
  function needBase() {
    toast('Choose your base first — pick a size.');
    setState({ tab: 'base' });
    flag('flash', 700);
  }
  function addIng(id, at, n) {
    var s = state;
    if (!s.base.size) { needBase(); return false; }
    var ing = ING_BY[id], tops = clone(s.toppings), t = tops.filter(function (x) { return x.id === id; })[0];
    if (t && t.portions >= MAX_PORTIONS) { flag('shake', 520); toast(ing.name + ' is already a double portion. Max ×2.'); return false; }
    if (!t && tops.length >= MAX_TOPPINGS) { flag('shake', 520); toast("Whoa, that's a lot! Max " + MAX_TOPPINGS + ' toppings.'); return false; }
    var pcs = genPieces(ing, n || ing.n, at, s.base.crust);
    if (t) { t.portions = 2; t.pieces = t.pieces.concat(pcs); } else tops.push({ id: id, portions: 1, pieces: pcs });
    var base = s.base;
    setPizza({ toppings: tops });
    sound('plop'); vibrate();
    announce(ing.name + (t ? ' doubled' : ' added') + '. ' + tops.length + ' topping' + (tops.length === 1 ? '' : 's') + '. Total ' + money(unitPrice(base, tops)) + '.');
    return true;
  }
  function appendPieces(id, at, n) {
    var tops = clone(state.toppings), t = tops.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var pcs = genPieces(ING_BY[id], n, at, state.base.crust);
    pcs.forEach(function (p) { p.d = 0; });
    t.pieces = t.pieces.concat(pcs);
    setPizza({ toppings: tops }, true);
    sound('plop');
  }
  function removeTopping(id) {
    var tops = state.toppings.filter(function (t) { return t.id !== id; });
    setPizza({ toppings: tops });
    announce(ING_BY[id].name + ' removed. ' + tops.length + ' toppings. Total ' + money(unitPrice(state.base, tops)) + '.');
  }
  function toggleDouble(id) {
    var t = state.toppings.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    if (t.portions < 2) { addIng(id, null); return; }
    var tops = clone(state.toppings), tt = tops.filter(function (x) { return x.id === id; })[0];
    tt.portions = 1; tt.pieces = tt.pieces.slice(0, Math.max(1, Math.ceil(tt.pieces.length / 2)));
    setPizza({ toppings: tops });
    announce(ING_BY[id].name + ' back to a single portion. Total ' + money(unitPrice(state.base, tops)) + '.');
  }
  function removePiece(tid, idx, cx, cy) {
    var tops = clone(state.toppings), t = tops.filter(function (x) { return x.id === tid; })[0];
    if (!t) return;
    t.pieces.splice(idx, 1);
    if (!t.pieces.length) tops = tops.filter(function (x) { return x.id !== tid; });
    setPizza({ toppings: tops });
    poof(cx, cy);
    if (!t.pieces.length) announce(ING_BY[tid].name + ' removed. Total ' + money(unitPrice(state.base, tops)) + '.');
  }
  function setBase(key, val) {
    var base = Object.assign({}, state.base); base[key] = val;
    var patch = { base: base };
    if (key === 'crust') { var tops = clone(state.toppings); clampPieces(tops, val); patch.toppings = tops; }
    var firstSize = key === 'size' && !state.base.size;
    setPizza(patch);
    if (firstSize) { toast('Base ready. Now drag on your toppings!'); setState({ tab: 'tray' }); }
    else announce(key.charAt(0).toUpperCase() + key.slice(1) + ' changed. Total ' + money(unitPrice(base, patch.toppings || state.toppings)) + '.');
  }
  function undo() {
    var h = state.history; if (!h.length) return;
    var p = JSON.parse(h[h.length - 1]);
    nameKey = keyFor(p.base, p.toppings);
    setState(Object.assign(p, { history: h.slice(0, -1) }));
    announce('Undone. Total ' + money(unitPrice(p.base, p.toppings)) + '.');
  }
  function loadSet(baseOver, list, label) {
    var base = Object.assign({}, state.base, baseOver);
    if (!base.size) base.size = 'medium';
    var tops = list.map(function (pair) {
      var ing = ING_BY[pair[0]];
      return { id: ing.id, portions: pair[1], pieces: genPieces(ing, ing.n * pair[1], null, base.crust) };
    });
    setPizza({ base: base, toppings: tops, moves: 0, badges: [], nameCustom: false });
    sound('plop');
    announce(label + ' loaded. ' + tops.length + ' toppings. Total ' + money(unitPrice(base, tops)) + '.');
    scrollToId('build');
    flag('pulse', 1200);
  }
  function surprise() {
    var meats = INGREDIENTS.filter(function (i) { return i.cat === 'meat'; }).map(function (i) { return i.id; });
    var vegs = INGREDIENTS.filter(function (i) { return i.cat === 'veg'; }).map(function (i) { return i.id; });
    function take(arr, n) { var a = arr.slice(), o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return o; }
    var veggie = Math.random() < 0.4;
    var ids = veggie ? take(vegs, 3 + Math.floor(Math.random() * 2)) : take(meats, 1 + Math.floor(Math.random() * 2)).concat(take(vegs, 2 + Math.floor(Math.random() * 2)));
    if (Math.random() < 0.25) ids.push(pick(['goat', 'feta']));
    if (Math.random() < 0.25) ids.push(pick(['rocket', 'chilli']));
    var base = { sauce: pick(['tomato', 'tomato', 'bbq', 'garlic']), crust: pick(['classic', 'classic', 'thin', 'stuffed']), cheese: 'mozzarella' };
    loadSet(base, ids.map(function (i) { return [i, 1]; }), 'Surprise pizza');
  }
  function scrollToId(id) {
    try { var el = $(id); if (el) el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch (e) {}
  }

  /* =====================================================================
     GEOMETRY
     ===================================================================== */
  function sizeScale() { return state.base.size ? find(SIZES, state.base.size).scale : 0.91; }
  function toNorm(cx, cy) {
    var svg = $('pz-svg');
    var r = svg.getBoundingClientRect(), sc = sizeScale();
    var px = (cx - r.left) / r.width * 400, py = (cy - r.top) / r.height * 400;
    return { x: (200 + (px - 200) / sc) / 400, y: (200 + (py - 200) / sc) / 400 };
  }
  function inSauce(p) { var dx = p.x - 0.5, dy = p.y - 0.5; return Math.sqrt(dx * dx + dy * dy) < find(CRUSTS, state.base.crust).sauceR / 400; }

  /* =====================================================================
     DRAG: tray tiles and placed pieces share the document pointer handlers
     ===================================================================== */
  function tileDown(id, e) {
    if (e.button !== undefined && e.button !== 0) return;
    suppressClick = false;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    var rect = e.currentTarget.getBoundingClientRect();
    drag = { kind: 'tile', id: id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, ox: rect.left + rect.width / 2, oy: rect.top + rect.height / 2, active: false, sprinkled: 0, overSince: 0, last: null };
  }
  function placeGhost() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var d = drag, el = $('ghost');
      if (!d || !el) return;
      el.style.transition = 'none'; el.style.opacity = '1';
      el.style.transform = 'translate3d(' + d.cx + 'px,' + d.cy + 'px,0)';
    });
  }
  function hideGhost() { setState({ ghost: null, hover: false }); }
  function springBack(d) {
    var el = $('ghost');
    if (!el || reducedMotion()) { hideGhost(); return; }
    el.style.transition = 'transform .3s cubic-bezier(0.34,1.56,0.64,1), opacity .3s';
    el.style.transform = 'translate3d(' + d.ox + 'px,' + d.oy + 'px,0) scale(.6)';
    el.style.opacity = '0';
    setTimeout(hideGhost, 320);
  }
  function pieceDown(g, e) {
    e.stopPropagation();
    var tid = g.getAttribute('data-tid'), idx = +g.getAttribute('data-idx');
    var now = Date.now(), k = tid + ':' + idx;
    if (lastTap && lastTap.k === k && now - lastTap.t < 320) {
      lastTap = null; drag = null;
      removePiece(tid, idx, e.clientX, e.clientY);
      return;
    }
    lastTap = { k: k, t: now };
    try { $('pz-svg').setPointerCapture(e.pointerId); } catch (err) {}
    var t = state.toppings.filter(function (x) { return x.id === tid; })[0];
    if (!t) return;
    drag = { kind: 'piece', pid: e.pointerId, tid: tid, idx: idx, el: g, orig: g.getAttribute('transform'), pc: t.pieces[idx], sx: e.clientX, sy: e.clientY, moved: false, np: null };
  }
  function onMove(e) {
    var d = drag; if (!d || e.pointerId !== d.pid) return;
    d.cx = e.clientX; d.cy = e.clientY;
    if (d.kind === 'tile') {
      if (!d.active) {
        if (Math.abs(d.cx - d.sx) + Math.abs(d.cy - d.sy) < 8) return;
        if (!state.base.size) { drag = null; suppressClick = true; needBase(); return; }
        d.active = true; suppressClick = true;
        setState({ ghost: d.id }); sound('whoosh');
      }
      placeGhost();
      var p = toNorm(d.cx, d.cy), over = inSauce(p);
      if (over !== state.hover) setState({ hover: over });
      var ing = ING_BY[d.id];
      if (over) {
        var now = performance.now();
        if (!d.overSince) d.overSince = now;
        if (d.sprinkled === 0 && ing.n > 1 && now - d.overSince > 450) {
          if (addIng(d.id, p, 1)) { d.sprinkled = 1; d.last = p; }
          else { drag = null; springBack(d); }
        } else if (d.sprinkled > 0 && d.sprinkled < ing.n) {
          var dx = p.x - d.last.x, dy = p.y - d.last.y;
          if (Math.sqrt(dx * dx + dy * dy) > 0.06) { appendPieces(d.id, p, 1); d.sprinkled++; d.last = p; }
        }
      } else d.overSince = 0;
    } else if (d.kind === 'piece') {
      if (!d.moved && Math.abs(d.cx - d.sx) + Math.abs(d.cy - d.sy) < 4) return;
      d.moved = true;
      var q = toNorm(d.cx, d.cy); d.np = q;
      var pc = Object.assign({}, d.pc, { x: q.x, y: q.y });
      d.el.setAttribute('transform', pieceTf(pc, ING_BY[d.tid]));
      if (inSauce(q)) d.el.classList.remove('out'); else d.el.classList.add('out');
    }
  }
  function onUp(e) {
    var d = drag; if (!d || e.pointerId !== d.pid) return;
    drag = null;
    if (d.kind === 'tile') {
      if (!d.active) return;
      /* The click that follows a drag is swallowed. If the tile was re-rendered
         mid-drag no click arrives, so clear the flag once this event is done. */
      setTimeout(function () { suppressClick = false; }, 0);
      var p = toNorm(e.clientX, e.clientY), over = inSauce(p), ing = ING_BY[d.id];
      if (d.sprinkled > 0) {
        var rem = ing.n - d.sprinkled;
        if (rem > 0) appendPieces(d.id, over ? p : d.last, rem);
        hideGhost();
      } else if (over) { addIng(d.id, p); hideGhost(); }
      else springBack(d);
    } else if (d.kind === 'piece') {
      d.el.classList.remove('out');
      if (!d.moved || !d.np) return;
      lastTap = null;
      if (inSauce(d.np)) {
        var tops = clone(state.toppings), t = tops.filter(function (x) { return x.id === d.tid; })[0];
        if (t && t.pieces[d.idx]) { t.pieces[d.idx].x = +d.np.x.toFixed(4); t.pieces[d.idx].y = +d.np.y.toFixed(4); t.pieces[d.idx].d = 0; }
        setPizza({ toppings: tops, moves: state.moves + 1 });
      } else removePiece(d.tid, d.idx, e.clientX, e.clientY);
    }
  }
  function onCancel(e) {
    var d = drag; if (!d || e.pointerId !== d.pid) return;
    drag = null;
    if (d.kind === 'tile' && d.active) { if (d.sprinkled > 0) hideGhost(); else springBack(d); }
    if (d.kind === 'piece') { d.el.classList.remove('out'); if (d.orig) d.el.setAttribute('transform', d.orig); }
  }

  /* =====================================================================
     MODALS
     ===================================================================== */
  function openModal(name) {
    if (!state.modal) opener = document.activeElement;
    setState({ modal: name });
  }
  function closeModal() { if (state.modal === 'baking') return; setState({ modal: null }); }
  function modalKey(e) {
    if (!state.modal) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeModal(); return; }
    var root = $('modal');
    if (e.key === 'Tab' && root) {
      var f = Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]),[href],input,select,textarea'));
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function snapshotImg() {
    try {
      var c = $('pz-svg').cloneNode(true);
      c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      c.setAttribute('width', '400'); c.setAttribute('height', '400');
      c.removeAttribute('class'); c.removeAttribute('id');
      Array.prototype.forEach.call(c.querySelectorAll('.dz,[display="none"]'), function (n) { n.parentNode.removeChild(n); });
      Array.prototype.forEach.call(c.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
      var defs = document.querySelector('svg defs');
      if (defs) c.insertBefore(defs.cloneNode(true), c.firstChild);
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c));
    } catch (e) { return ''; }
  }
  function addToBasket() {
    var s = state, size = find(SIZES, s.base.size);
    var item = {
      uid: Date.now() + '-' + (++uid), name: s.pizzaName.trim() || 'Custom pizza', base: clone(s.base),
      toppings: s.toppings.map(function (t) { return { id: t.id, name: ING_BY[t.id].name, portions: t.portions }; }),
      lines: linesFor(s.base, s.toppings), diet: dietFor(s.base, s.toppings).map(function (d) { return d.label; }),
      unit: unitPrice(s.base, s.toppings), qty: s.review.qty, notes: s.review.notes.trim(), img: snapshotImg(), sizeText: size.label + ' ' + size.sub
    };
    var basket = s.basket.concat([item]);
    setState({ basket: basket, review: Object.assign({}, s.review, { added: true }) });
    var count = basket.reduce(function (a, it) { return a + it.qty; }, 0);
    announce(item.name + ' added to basket. ' + count + ' in basket.');
  }
  function buildAnother() {
    setPizza({ toppings: [], moves: 0, badges: [], nameCustom: false });
    setState({ history: [], modal: null, review: { qty: 1, notes: '', added: false } });
    opener = null;
    scrollToId('build');
  }

  /* =====================================================================
     CHECKOUT
     ===================================================================== */
  function setForm(k, v) { var f = Object.assign({}, state.form); f[k] = v; var o = { form: f }; if (k === 'promo') o.promoBad = false; setState(o); }
  function touch(k) { var t = Object.assign({}, state.touched); t[k] = true; setState({ touched: t }); }
  function applyPromo() {
    var code = state.form.promo.trim().toUpperCase();
    if (code === PROMO) { setState({ promoApplied: true, promoBad: false }); announce(PROMO + ' applied. 10% off.'); }
    else { setState({ promoApplied: false, promoBad: true }); announce("That code isn't valid."); }
  }
  function submitForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    var errs = validate(state.form);
    setState({ submitted: true });
    if (Object.keys(errs).length) {
      var first = Object.keys(errs)[0]; announce('Please check the form. ' + errs[first]);
      try { $('f-' + first).focus(); } catch (x) {}
      return;
    }
    if (!state.basket.length) { toast('Your basket is empty.'); return; }
    openModal('confirm');
  }
  function confirmOrder() {
    var s = state, T = totalsFor(s.basket, s.form.method, s.promoApplied);
    var number = '#PZ-' + Math.floor(1000 + Math.random() * 9000);
    var f = s.form;
    var eta = f.time !== 'asap' ? (f.method === 'delivery' ? 'Arriving at ' + f.time : 'Ready for collection at ' + f.time) : (f.method === 'delivery' ? 'Arriving in 35–45 minutes' : 'Ready in about 25 minutes');
    var order = {
      orderNumber: number, placedAt: new Date().toISOString(), method: f.method,
      customer: { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), address: f.method === 'delivery' ? f.address.trim() : null, postcode: f.method === 'delivery' ? f.postcode.trim().toUpperCase() : null },
      time: f.time, payment: 'pay-on-' + f.method, promo: s.promoApplied ? PROMO : null,
      items: s.basket.map(function (it) { return { name: it.name, base: it.base, toppings: it.toppings, qty: it.qty, unitPrice: it.unit / 100, notes: it.notes, diet: it.diet }; }),
      totals: { subtotal: T.sub / 100, delivery: T.del / 100, discount: T.disc / 100, total: T.total / 100, currency: 'GBP' }
    };
    bakeImg = s.basket[0] ? s.basket[0].img : '';
    setState({ modal: 'baking' });
    var ms = reducedMotion() ? 1200 : 3000;
    setTimeout(function () {
      submitOrder(order).then(function () {
        console.log(JSON.stringify(order, null, 2));
        var colors = ['#d32618', '#ffca28', '#feee75', '#035841', '#ffffff', '#a8180d'];
        var conf = [];
        for (var i = 0; i < 90; i++) conf.push({ left: (Math.random() * 100).toFixed(1), bg: colors[i % colors.length], delay: Math.round(Math.random() * 600), dur: Math.round(1800 + Math.random() * 1600) });
        var lines = s.basket.map(function (it) { return { label: it.name + ' ×' + it.qty, price: money(it.unit * it.qty) }; });
        if (T.del) lines.push({ label: 'Delivery', price: money(T.del) });
        if (T.disc) lines.push({ label: 'Discount (' + PROMO + ')', price: '−' + money(T.disc) });
        lastImg = bakeImg; lastName = s.basket[0] ? s.basket[0].name : 'my-pizza';
        setState({ modal: 'done', confetti: conf, order: { number: number, eta: eta, lines: lines, total: money(T.total) }, basket: [] });
        sound('ding');
        announce('Order placed. Order number ' + number + '. ' + eta + '.');
      });
    }, ms);
  }
  function savePng() {
    var src = lastImg;
    if (!src) { toast("There's no pizza image to save."); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = 800; c.height = 800;
        c.getContext('2d').drawImage(img, 0, 0, 800, 800);
        c.toBlob(function (blob) {
          if (!blob) { toast("Couldn't save the image here."); return; }
          var a = document.createElement('a'), url = URL.createObjectURL(blob);
          a.href = url; a.download = (lastName || 'my-pizza').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
          document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
          toast('Pizza saved as a PNG.');
        }, 'image/png');
      } catch (e) { toast("Couldn't save the image here."); }
    };
    img.onerror = function () { toast("Couldn't save the image here."); };
    img.src = src;
  }
  function resetAll() {
    nameKey = '';
    setState({
      base: blankBase(), toppings: [], pizzaName: 'The Blank Canvas', nameCustom: false, moves: 0, badges: [], basket: [], history: [],
      modal: null, review: { qty: 1, notes: '', added: false }, confetti: [], order: null,
      form: blankForm(), touched: {}, submitted: false, promoApplied: false, promoBad: false
    });
    ['name', 'phone', 'email', 'address', 'postcode', 'promo'].forEach(function (k) { $('f-' + k).value = ''; });
    $('f-time').value = 'asap';
    opener = null;
    scrollToId('top');
  }

  /* =====================================================================
     RENDERING
     ===================================================================== */
  /* Replace a container's markup only when it changed, keeping focus on the
     element with the same data-fk (or id) if it was inside. */
  function patchHTML(el, html) {
    if (el._html === html) return;
    var a = document.activeElement, key = null;
    if (a && el.contains(a)) key = a.getAttribute('data-fk') || a.id || null;
    el.innerHTML = html;
    el._html = html;
    if (key) {
      var n = el.querySelector('[data-fk="' + key + '"]') || (document.getElementById(key));
      if (n && el.contains(n)) { try { n.focus(); } catch (e) {} }
    }
  }
  function setText(id, v) { var el = $(id); if (el.textContent !== String(v)) el.textContent = v; }
  function setAttr(el, k, v) { if (typeof el === 'string') el = $(el); if (el.getAttribute(k) !== String(v)) el.setAttribute(k, v); }
  function show(id, on) { $(id).hidden = !on; }
  function symUse(id) { return '<svg viewBox="0 0 40 40" aria-hidden="true"><use href="#sym-' + id + '"></use></svg>'; }

  var pieceEls = {};
  function renderPieces(ordered) {
    var host = $('pz-pieces'), keep = {}, list = [];
    ordered.forEach(function (t) { t.pieces.forEach(function (p, i) { list.push({ t: t, p: p, i: i }); keep[p.k] = 1; }); });
    Object.keys(pieceEls).forEach(function (k) {
      if (!keep[k]) { var g = pieceEls[k]; if (g.parentNode) g.parentNode.removeChild(g); delete pieceEls[k]; }
    });
    list.forEach(function (it, n) {
      var g = pieceEls[it.p.k];
      if (!g) {
        g = document.createElementNS(SVG_NS, 'g'); g.setAttribute('class', 'piece');
        var inner = document.createElementNS(SVG_NS, 'g');
        inner.setAttribute('class', 'drop'); inner.setAttribute('style', 'animation-delay: ' + (it.p.d || 0) + 'ms');
        inner.addEventListener('animationend', function () { inner.removeAttribute('class'); inner.removeAttribute('style'); });
        var use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', '#sym-' + it.t.id);
        use.setAttribute('x', '-20'); use.setAttribute('y', '-20'); use.setAttribute('width', '40'); use.setAttribute('height', '40');
        inner.appendChild(use); g.appendChild(inner);
        pieceEls[it.p.k] = g;
      }
      setAttr(g, 'transform', pieceTf(it.p, ING_BY[it.t.id]));
      setAttr(g, 'data-tid', it.t.id); setAttr(g, 'data-idx', it.i);
      var at = host.childNodes[n];
      if (at !== g) host.insertBefore(g, at || null);
    });
  }

  function render() {
    var s = state, base = s.base;
    var crust = find(CRUSTS, base.crust), sauce = find(SAUCES, base.sauce), cheese = find(CHEESES, base.cheese);
    var unit = unitPrice(base, s.toppings);
    var used = {}; s.toppings.forEach(function (t) { used[t.id] = t.portions; });
    var needSize = !base.size;
    var sizeObj = base.size ? find(SIZES, base.size) : null;
    var T = totalsFor(s.basket, s.form.method, s.promoApplied);
    var basketCount = s.basket.reduce(function (a, it) { return a + it.qty; }, 0);
    var empty = !s.basket.length;

    /* header */
    setText('basket-count', basketCount);
    setText('basket-total', money(T.sub));
    setAttr('basket-btn', 'aria-label', 'Basket: ' + basketCount + ' item' + (basketCount === 1 ? '' : 's') + ', ' + money(T.sub));

    /* base panel */
    function opts(list, key, subFn) {
      return list.map(function (o) {
        var on = base[key] === o.id;
        return '<button type="button" class="opt' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="base" data-key="' + key + '" data-val="' + o.id + '" data-fk="opt-' + key + '-' + o.id + '"><b>' + esc(o.label) + '</b><span>' + esc(subFn(o)) + '</span></button>';
      }).join('');
    }
    var groups = [
      ['Size', 'size', SIZES, function (o) { return o.sub + ' · ' + money(o.price); }],
      ['Crust', 'crust', CRUSTS, function (o) { return o.extra ? '+' + money(o.extra) : 'Included'; }],
      ['Sauce', 'sauce', SAUCES, function () { return 'Included'; }],
      ['Cheese', 'cheese', CHEESES, function (o) { return o.extra ? '+' + money(o.extra) : 'Included'; }]
    ];
    patchHTML($('base-groups'), groups.map(function (g) {
      var isSize = g[1] === 'size';
      return '<fieldset class="grp' + (isSize && s.flash ? ' flash' : '') + '"><legend class="flabel">' + g[0] + '</legend>' +
        (isSize && needSize ? '<p class="grp-hint">Pick a size to unlock toppings</p>' : '') +
        '<div class="opts">' + opts(g[2], g[1], g[3]) + '</div></fieldset>';
    }).join(''));
    setAttr('builder', 'class', 'builder show-' + s.tab);

    /* pizza */
    var scale = sizeScale();
    $('pz-scale').style.transform = 'scale(' + scale + ')';
    setAttr('pz-crust', 'fill', crust.fill);
    setAttr('pz-inner', 'r', crust.sauceR + 10); setAttr('pz-inner', 'fill', crust.inner);
    setAttr('pz-stuffed', 'display', base.crust === 'stuffed' ? 'inline' : 'none');
    setAttr('pz-stuffed', 'r', Math.round((188 + crust.sauceR + 10) / 2));
    setAttr('pz-sauce', 'r', crust.sauceR); setAttr('pz-sauce', 'fill', sauce.color);
    var extra = base.cheese === 'extra', cheeseCol = cheese.color || '#FFF0C2';
    patchHTML($('pz-cheese'), cheese.color ?
      '<circle cx="200" cy="200" r="' + (crust.sauceR - 6) + '" fill="' + cheeseCol + '" opacity="' + (extra ? 0.7 : 0.45) + '"></circle>' +
      cheeseBlobs.map(function (b) { return '<circle cx="' + b.x + '" cy="' + b.y + '" r="' + (extra ? +(b.r * 1.35).toFixed(1) : b.r) + '" fill="' + cheeseCol + '" opacity="0.92"></circle>'; }).join('') : '');
    setAttr('pz-dz', 'display', s.hover ? 'inline' : 'none'); setAttr('pz-dz', 'r', crust.sauceR - 4);
    renderPieces(s.toppings.slice().sort(function (a, b) { return (ING_BY[a.id].late ? 1 : 0) - (ING_BY[b.id].late ? 1 : 0); }));
    setAttr('pz-svg', 'aria-label', 'Your pizza: ' + (sizeObj ? sizeObj.label : 'no size yet') + ', ' + crust.label + ' crust, ' + sauce.label + ', ' + cheese.label + ', ' + s.toppings.length + ' toppings');
    setAttr('board', 'class', 'board on-red' + (s.hover ? ' hover' : '') + (s.shake ? ' shake' : '') + (s.pulse ? ' pulse' : ''));
    show('board-hint', needSize || !s.toppings.length);
    setText('board-hint', needSize ? 'Pick a size to get started' : 'Drag toppings here, or tap them in the tray');

    /* ghost */
    setAttr('ghost', 'class', 'ghost' + (s.ghost ? ' on' : ''));
    setAttr('ghost-use', 'href', '#sym-' + (s.ghost || 'pepperoni'));

    /* sound */
    var sl = s.soundOn ? 'Sound on' : 'Sound off';
    setAttr('sound-btn', 'aria-pressed', s.soundOn); setAttr('sound-btn', 'aria-label', sl); setAttr('sound-btn', 'title', sl);
    show('sound-on-icon', s.soundOn); show('sound-off-icon', !s.soundOn);

    /* name */
    var nameIn = $('pz-name');
    if (document.activeElement !== nameIn && nameIn.value !== s.pizzaName) nameIn.value = s.pizzaName;

    /* meter + badges */
    var meter = meterFor(s.toppings);
    setText('meter-label', meter.label);
    setAttr('meter-track', 'aria-valuenow', meter.v); setAttr('meter-track', 'aria-valuetext', meter.v + ' out of 100, ' + meter.label);
    $('meter-fill').style.width = meter.v + '%';
    patchHTML($('badges'), BADGES.map(function (b) {
      var on = s.badges.indexOf(b.id) >= 0;
      return '<li class="badge ' + (on ? 'earned' : 'locked') + '" title="' + esc(b.desc) + '">' + symUse(b.sym) + '<span class="t-label">' + esc(b.name) + '</span><span class="sr">' + (on ? '(unlocked)' : '(locked: ' + esc(b.desc) + ')') + '</span></li>';
    }).join(''));

    /* order bar */
    setText('price', base.size ? money(unit) : money(0));
    setText('topping-meta', s.toppings.length + ' of ' + MAX_TOPPINGS + ' toppings' + (sizeObj ? ' · ' + sizeObj.label + ' ' + sizeObj.sub : ''));
    $('undo-btn').disabled = !s.history.length;
    $('clear-btn').disabled = !s.toppings.length;

    /* tabs */
    setAttr('tab-tray', 'aria-selected', s.tab === 'tray'); setAttr('tab-base', 'aria-selected', s.tab === 'base');

    /* tray */
    patchHTML($('chips'), [['all', 'All'], ['meat', 'Meat'], ['veg', 'Veg'], ['cheese', 'Cheese'], ['extras', 'Extras']].map(function (c) {
      var on = s.filter === c[0];
      return '<button type="button" class="chip t-label' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="chip" data-val="' + c[0] + '" data-fk="chip-' + c[0] + '">' + c[1] + '</button>';
    }).join(''));
    show('tray-note', needSize);
    patchHTML($('tray-grid'), INGREDIENTS.filter(function (i) { return s.filter === 'all' || i.cat === s.filter; }).map(function (ing) {
      var tags = ing.diet.join(' · ');
      var aria = 'Add ' + ing.name + ', ' + money(ing.price) + (used[ing.id] ? ', on your pizza ×' + used[ing.id] : '');
      return '<button type="button" class="tile' + (needSize ? ' dis' : '') + '" data-act="tile" data-id="' + ing.id + '" data-fk="tile-' + ing.id + '" aria-label="' + esc(aria) + '" aria-disabled="' + needSize + '" title="' + (needSize ? 'Choose your base first' : 'Drag onto the pizza, or tap to add') + '">' +
        symUse(ing.id) + '<span class="nm">' + esc(ing.name) + '</span><span class="pr">' + esc(money(ing.price) + (ing.note ? ' · ' + ing.note : '')) + '</span><span class="tags">' + (tags ? esc(tags) : '&nbsp;') + '</span>' +
        (used[ing.id] ? '<span class="cnt">' + (used[ing.id] === 2 ? '×2' : '✓') + '</span>' : '') + '</button>';
    }).join(''));
    setText('mine-count', s.toppings.length);
    show('mine-empty', !s.toppings.length);
    patchHTML($('mine-list'), s.toppings.map(function (t) {
      var ing = ING_BY[t.id], dbl = t.portions > 1;
      return '<li><span class="n">' + esc(ing.name + (dbl ? ' ×2' : '')) + '</span><span>' + money(ing.price * t.portions) + '</span>' +
        '<button type="button" class="mini-btn" aria-pressed="' + dbl + '" aria-label="' + esc((dbl ? 'Single portion of ' : 'Double portion of ') + ing.name) + '" data-act="dbl" data-id="' + t.id + '" data-fk="dbl-' + t.id + '">×2</button>' +
        '<button type="button" class="mini-btn" aria-label="' + esc('Remove ' + ing.name) + '" data-act="rm" data-id="' + t.id + '" data-fk="rm-' + t.id + '">Remove</button></li>';
    }).join(''));

    /* favourites */
    patchHTML($('favs'), PRESETS.map(function (p, i) {
      var pr = unitPrice({ size: 'medium', crust: 'classic', cheese: 'mozzarella' }, p.toppings.map(function (x) { return { id: x[0], portions: x[1] }; }));
      return '<article class="cream-card fav"><div class="px-in" data-speed="' + [0.08, 0.14, 0.05, 0.12][i % 4] + '" data-rot="' + [0.4, -0.5, 0.3, -0.4][i % 4] + '">' +
        '<img class="fav-img" src="' + esc(p.img) + '" alt="' + esc(p.name + ' pizza, seen from above') + '"></div>' +
        '<h3 class="t-title">' + esc(p.name) + '</h3><p>' + esc(p.desc) + '</p><span class="t-label c-red7">From ' + money(pr) + '</span>' +
        '<button type="button" class="btn btn-gold btn-sm" data-act="load" data-id="' + p.id + '">Load into builder</button></article>';
    }).join(''));

    /* checkout form */
    var f = s.form, errs = validate(f), invalid = Object.keys(errs).length > 0;
    setAttr('m-delivery', 'aria-pressed', f.method === 'delivery'); setAttr('m-collection', 'aria-pressed', f.method === 'collection');
    show('address-row', f.method === 'delivery');
    ['name', 'phone', 'email', 'address', 'postcode'].forEach(function (k) {
      var vis = !!errs[k] && !!(s.touched[k] || s.submitted);
      show('e-' + k, vis);
      if (vis) setText('e-' + k, errs[k]);
      setAttr('f-' + k, 'aria-invalid', vis);
    });
    show('e-promo', s.promoBad);
    show('ok-promo', s.promoApplied);
    setText('ok-promo', PROMO + ' applied — 10% off.');
    setText('pay-label', f.method === 'delivery' ? 'Pay on delivery' : 'Pay on collection');
    $('place-btn').disabled = invalid || empty;
    show('place-hint', invalid || empty);
    setText('place-hint', empty ? 'Add a pizza to your basket to place an order.' : 'Fill in the required fields to place your order.');

    /* summary */
    show('sum-empty', empty);
    patchHTML($('sum-items'), s.basket.map(function (it) {
      return '<li><img src="' + esc(it.img) + '" alt=""><span class="n">' + esc(it.name) + ' ×' + it.qty + '<small>' + esc(it.sizeText) + '</small></span><span>' + money(it.unit * it.qty) + '</span></li>';
    }).join(''));
    setText('tot-sub', money(T.sub));
    setText('tot-del', f.method === 'collection' ? 'Collection' : (T.sub === 0 ? money(0) : (T.del ? money(T.del) : 'Free')));
    show('tot-disc-row', T.disc > 0);
    setText('tot-disc-label', 'Discount (' + PROMO + ')');
    setText('tot-disc', '−' + money(T.disc));
    setText('tot-total', money(T.total));

    /* modal */
    patchHTML($('modal-root'), modalHTML(T, basketCount, unit));
  }

  function closeBtn(auto) {
    return '<button type="button" class="icon-btn" data-act="close" data-fk="m-close" aria-label="Close"' + (auto ? ' data-autofocus="1"' : '') + '><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>';
  }
  function linesHTML(lines) { return lines.map(function (l) { return '<li><span>' + esc(l.label) + '</span><span>' + esc(l.price) + '</span></li>'; }).join(''); }
  function basketItemsHTML(withRemove) {
    return state.basket.map(function (it) {
      return '<li><img src="' + esc(it.img) + '" alt=""><span class="n">' + esc(it.name) + ' ×' + it.qty + '<small>' + esc(it.sizeText) + '</small>' +
        (it.notes ? '<small>“' + esc(it.notes) + '”</small>' : '') + '</span><span>' + money(it.unit * it.qty) + '</span>' +
        (withRemove ? '<button type="button" class="mini-btn" data-act="basket-rm" data-uid="' + esc(it.uid) + '" data-fk="brm-' + esc(it.uid) + '" aria-label="' + esc('Remove ' + it.name) + '">Remove</button>' : '') + '</li>';
    }).join('');
  }
  function modalHTML(T, basketCount, unit) {
    var s = state, m = s.modal;
    if (!m) return '';
    var snapSvg = '<svg viewBox="0 0 400 400" class="snap" aria-hidden="true"><use href="#pizza-art"></use></svg>';
    if (m === 'review') {
      var body;
      if (s.review.added) {
        body = '<div style="display: flex; flex-direction: column; gap: 16px; text-align: center; padding: 20px 0">' + snapSvg +
          '<h3 class="t-title c-red">Added to your basket</h3><p>' + basketCount + ' in basket · ' + money(T.sub) + '</p>' +
          '<div class="dlg-btns"><button type="button" class="btn btn-line btn-lg" data-act="build-another" data-autofocus="1">Build another</button><button type="button" class="btn btn-gold btn-lg" data-act="go-checkout">Go to checkout</button></div></div>';
      } else {
        body = snapSvg + '<h3 class="t-title c-red" style="text-align: center">' + esc(s.pizzaName) + '</h3>' +
          '<div class="diet" style="justify-content: center">' + dietFor(s.base, s.toppings).map(function (d) { return '<span class="' + d.cls + '">' + esc(d.label) + '</span>'; }).join('') + '</div>' +
          '<ul class="lines">' + linesHTML(linesFor(s.base, s.toppings)) + '</ul>' +
          '<div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap"><span class="flabel" id="qty-l">Quantity</span>' +
          '<div class="stepper" role="group" aria-labelledby="qty-l"><button type="button" class="icon-btn" data-act="qty-down" data-fk="qty-down" aria-label="Decrease quantity"' + (s.review.qty <= 1 ? ' disabled' : '') + '>−</button>' +
          '<output aria-live="polite">' + s.review.qty + '</output>' +
          '<button type="button" class="icon-btn" data-act="qty-up" data-fk="qty-up" aria-label="Increase quantity"' + (s.review.qty >= 10 ? ' disabled' : '') + '>+</button></div></div>' +
          '<div class="field"><label for="rv-notes">Special instructions</label><textarea id="rv-notes" maxlength="200" placeholder="Well done, please">' + esc(s.review.notes) + '</textarea><span class="count" id="notes-count">' + s.review.notes.length + '/200</span></div>' +
          '<div class="tot big"><span>Total</span><span>' + money(unit * s.review.qty) + '</span></div>' +
          '<div class="dlg-btns"><button type="button" class="btn btn-line btn-lg" data-act="close">Keep building</button><button type="button" class="btn btn-gold btn-lg" data-act="add-to-basket" data-autofocus="1">Add to basket</button></div>';
      }
      return '<div class="overlay" data-overlay="1"><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="rv-h" id="modal">' +
        '<div class="drawer-top"><h2 class="t-headline" id="rv-h" style="font-size: 48px">Your order</h2>' + closeBtn(false) + '</div>' + body + '</div></div>';
    }
    if (m === 'basket') {
      var emptyB = !s.basket.length;
      return '<div class="overlay" data-overlay="1"><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="bk-h" id="modal">' +
        '<div class="drawer-top"><h2 class="t-headline" id="bk-h" style="font-size: 48px">Basket</h2>' + closeBtn(true) + '</div>' +
        (emptyB ? '<p class="empty">Nothing in here yet.</p>' : '') +
        '<ul class="sum-items">' + basketItemsHTML(true) + '</ul>' +
        '<div class="tot big"><span>Subtotal</span><span>' + money(T.sub) + '</span></div>' +
        '<div class="dlg-btns"><button type="button" class="btn btn-line btn-lg" data-act="build-another">Build another</button><button type="button" class="btn btn-gold btn-lg" data-act="go-checkout"' + (emptyB ? ' disabled' : '') + '>Go to checkout</button></div></div></div>';
    }
    if (m === 'clear') {
      return '<div class="overlay center" data-overlay="1"><div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="cl-h" id="modal">' +
        '<h2 class="t-headline" id="cl-h" style="font-size: 48px">Start again?</h2><p>This removes all your toppings. Your base choices stay.</p>' +
        '<div class="dlg-btns"><button type="button" class="btn btn-line btn-lg" data-act="close" data-autofocus="1">No</button><button type="button" class="btn btn-gold btn-lg" data-act="do-clear">Yes, clear it</button></div></div></div>';
    }
    if (m === 'confirm') {
      return '<div class="overlay center" data-overlay="1"><div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="cf-h" id="modal">' +
        '<h2 class="t-headline" id="cf-h" style="font-size: 48px">Ready to bake?</h2><p class="t-title c-red">Total: ' + money(T.total) + '</p>' +
        '<div class="dlg-btns"><button type="button" class="btn btn-line btn-lg" data-act="close">Go back</button><button type="button" class="btn btn-gold btn-lg" data-act="confirm-order" data-autofocus="1">Confirm</button></div></div></div>';
    }
    if (m === 'baking') {
      return '<div class="overlay center bake-bg"><div class="bake" role="dialog" aria-modal="true" aria-labelledby="bk2-h" id="modal" tabindex="-1">' +
        '<div class="oven" aria-hidden="true"><span class="steam s1"></span><span class="steam s2"></span><span class="steam s3"></span><div class="oven-mouth"><span class="flame a"></span><span class="flame b"></span>' +
        (bakeImg ? '<img class="bake-pz" src="' + esc(bakeImg) + '" alt="">' : '') + '</div></div>' +
        '<h2 class="t-headline c-gold" id="bk2-h">Baking your order…</h2><div class="progress" aria-hidden="true"><i></i></div></div></div>';
    }
    if (m === 'done') {
      var o = s.order || { number: '', eta: '', lines: [], total: '' };
      var conf = reducedMotion() ? '' : '<div class="confetti" aria-hidden="true">' + s.confetti.map(function (c) {
        return '<i style="left: ' + c.left + '%; background: ' + c.bg + '; animation-delay: ' + c.delay + 'ms; animation-duration: ' + c.dur + 'ms"></i>';
      }).join('') + '</div>';
      return '<div class="overlay center">' + conf + '<div class="done" role="dialog" aria-modal="true" aria-labelledby="dn-h" id="modal">' +
        '<h2 class="t-headline" id="dn-h">Order placed!</h2><div class="ordno">' + esc(o.number) + '</div>' +
        '<p class="t-title c-red" style="font-size: 24px">' + esc(o.eta) + '</p>' +
        '<ul class="lines" style="text-align: left">' + linesHTML(o.lines) + '</ul>' +
        '<div class="tot big"><span>Total</span><span>' + esc(o.total) + '</span></div>' +
        '<div class="dlg-btns"><button type="button" class="btn btn-line btn-lg" data-act="save-png">Save my pizza</button><button type="button" class="btn btn-gold btn-lg" data-act="reset" data-autofocus="1">Build another pizza</button></div></div></div>';
    }
    return '';
  }

  /* =====================================================================
     PARALLAX
     data-speed moves an element vertically, data-x horizontally (the hero
     wordmark rows), relative to its parent as it crosses the viewport.
     data-rot adds a little spin.
     ===================================================================== */
  var PARALLAX = 1;
  function parallax() {
    var els = document.querySelectorAll('[data-speed],[data-x]');
    var still = reducedMotion(), k = PARALLAX;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (still || !k) { el.style.transform = ''; continue; }
      var host = el.parentElement; if (!host) continue;
      var r = host.getBoundingClientRect();
      if (r.bottom < -400 || r.top > vh + 400) continue;
      var c = (r.top + r.height / 2) - vh / 2;
      var sp = parseFloat(el.getAttribute('data-speed')) || 0;
      var sx = parseFloat(el.getAttribute('data-x')) || 0;
      var rot = parseFloat(el.getAttribute('data-rot')) || 0;
      el.style.transform = 'translate3d(' + (-c * sx * k).toFixed(1) + 'px,' + (-c * sp * k).toFixed(1) + 'px,0) rotate(' + (c * rot * 0.1 * k).toFixed(1) + 'deg)';
    }
  }
  function onScroll() {
    if (pRaf) return;
    pRaf = requestAnimationFrame(function () { pRaf = 0; parallax(); });
  }

  /* =====================================================================
     EVENTS
     ===================================================================== */
  function refreshSlots() {
    var sel = $('f-time'), cur = sel.value, slots = timeSlots();
    sel.innerHTML = '<option value="asap">As soon as possible</option>' + slots.map(function (t) { return '<option value="' + t.value + '">' + t.label + '</option>'; }).join('');
    var ok = cur === 'asap' || slots.some(function (t) { return t.value === cur; });
    sel.value = ok ? cur : 'asap';
    if (!ok && state.form.time !== 'asap') setForm('time', 'asap');
  }

  var ACTIONS = {
    start: function () { scrollToId('build'); flag('pulse', 1200); },
    surprise: surprise,
    base: function (el) { var k = el.getAttribute('data-key'), v = el.getAttribute('data-val'); if (state.base[k] !== v) setBase(k, v); },
    sound: function () { setState({ soundOn: !state.soundOn }); },
    'regen-name': function () {
      var s = state, n = s.pizzaName, tries = 0;
      while (n === s.pizzaName && tries++ < 6) n = genName(s.base, s.toppings);
      setState({ pizzaName: n, nameCustom: false }); announce('New name: ' + n);
    },
    undo: undo,
    'ask-clear': function () { openModal('clear'); },
    'do-clear': function () { setPizza({ toppings: [], moves: 0, badges: [], nameCustom: false }); setState({ modal: null }); announce('Toppings cleared.'); },
    review: function () { if (!state.base.size) { needBase(); return; } setState({ review: { qty: 1, notes: '', added: false } }); openModal('review'); },
    tab: function (el) { setState({ tab: el.getAttribute('data-val') }); },
    chip: function (el) { setState({ filter: el.getAttribute('data-val') }); },
    tile: function (el) { if (suppressClick) { suppressClick = false; return; } addIng(el.getAttribute('data-id'), null); },
    dbl: function (el) { toggleDouble(el.getAttribute('data-id')); },
    rm: function (el) { removeTopping(el.getAttribute('data-id')); },
    load: function (el) { var p = find(PRESETS, el.getAttribute('data-id')); loadSet(p.base, p.toppings, p.name); },
    close: closeModal,
    'qty-down': function () { setState({ review: Object.assign({}, state.review, { qty: Math.max(1, state.review.qty - 1) }) }); },
    'qty-up': function () { setState({ review: Object.assign({}, state.review, { qty: Math.min(10, state.review.qty + 1) }) }); },
    'add-to-basket': addToBasket,
    'build-another': buildAnother,
    'go-checkout': function () { setState({ modal: null }); opener = null; setTimeout(function () { scrollToId('checkout'); }, 50); },
    'basket-rm': function (el) {
      var id = el.getAttribute('data-uid'), it = state.basket.filter(function (x) { return x.uid === id; })[0];
      setState({ basket: state.basket.filter(function (x) { return x.uid !== id; }) });
      if (it) announce(it.name + ' removed from basket.');
    },
    method: function (el) { setForm('method', el.getAttribute('data-val')); },
    promo: applyPromo,
    'confirm-order': confirmOrder,
    'save-png': savePng,
    reset: resetAll
  };

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-overlay')) { closeModal(); return; }
    var el = t && t.closest ? t.closest('[data-act]') : null;
    if (!el || el.disabled) return;
    var fn = ACTIONS[el.getAttribute('data-act')];
    if (fn) fn(el, e);
  });
  $('basket-btn').addEventListener('click', function () { openModal('basket'); });
  $('modal-root').addEventListener('keydown', modalKey);
  $('modal-root').addEventListener('input', function (e) {
    if (e.target.id === 'rv-notes') {
      var v = e.target.value.slice(0, 200);
      state.review = Object.assign({}, state.review, { notes: v });
      setText('notes-count', v.length + '/200');
    }
  });

  $('tray-grid').addEventListener('pointerdown', function (e) {
    var el = e.target.closest('.tile'); if (!el) return;
    tileDown(el.getAttribute('data-id'), { button: e.button, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, currentTarget: el });
  });
  $('pz-pieces').addEventListener('pointerdown', function (e) {
    var g = e.target.closest('.piece'); if (!g) return;
    pieceDown(g, e);
  });
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);

  $('pz-name').addEventListener('input', function (e) { setState({ pizzaName: e.target.value.slice(0, 40), nameCustom: true }); });

  var form = $('co-form');
  form.addEventListener('input', function (e) {
    var k = e.target.name; if (!k || !(k in state.form)) return;
    setForm(k, e.target.value);
  });
  form.addEventListener('change', function (e) { if (e.target.name === 'time') setForm('time', e.target.value); });
  form.addEventListener('focusout', function (e) {
    var k = e.target.name; if (['name', 'phone', 'email', 'address', 'postcode'].indexOf(k) >= 0) touch(k);
  });
  form.addEventListener('submit', submitForm);
  $('f-time').addEventListener('focus', refreshSlots);
  $('f-time').addEventListener('mousedown', refreshSlots);

  try {
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });
  } catch (e) {}

  /* =====================================================================
     INIT
     ===================================================================== */
  Array.prototype.forEach.call(document.querySelectorAll('[data-brand]'), function (el) { el.textContent = BRAND; });
  Array.prototype.forEach.call(document.querySelectorAll('.wm-row'), function (row) {
    var off = row.hasAttribute('data-offset') ? 1 : 0, html = '';
    for (var i = 0; i < 8; i++) html += '<span' + ((i + off) % 2 ? ' class="o"' : '') + '>' + esc(BRAND) + '</span>';
    row.innerHTML = html;
  });
  var minSize = Math.min.apply(null, SIZES.map(function (z) { return z.price; }));
  $('hero-count-tag').textContent = INGREDIENTS.length + ' toppings';
  $('hero-from-tag').textContent = 'From ' + moneyShort(minSize);
  $('free-del-tag').textContent = 'Free delivery over ' + moneyShort(FREE_OVER);
  $('delivery-note').textContent = 'Delivery is ' + money(DELIVERY_FEE) + ', free on orders over ' + moneyShort(FREE_OVER) + '.';
  refreshSlots();
  render();
  prev = { base: state.base, toppings: state.toppings, basket: state.basket, pizzaName: state.pizzaName, soundOn: state.soundOn, badges: state.badges, modal: state.modal };
  setTimeout(onScroll, 60);
})();
