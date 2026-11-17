/*
 * Copyright 2026 Anthropic PBC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Menu, prices and rules for the pizza builder. Edit this file to change
 * what is on offer; app.js reads everything from here.
 *
 * Prices are in pence. For each ingredient, `s` is the piece size on the
 * pizza and `n` is how many pieces scatter per drop. Each id needs a
 * matching <symbol id="sym-ID"> in index.html.
 */

/* The shop name shown in the logo, hero wordmark and footer. Placeholder. */
var BRAND = 'PIZZANOW';

var INGREDIENTS = [
  { id: 'pepperoni', name: 'Pepperoni', cat: 'meat', price: 120, n: 8, diet: [], s: 1 },
  { id: 'ham', name: 'Ham', cat: 'meat', price: 120, n: 6, diet: [], s: 1.05 },
  { id: 'beef', name: 'Spicy beef', cat: 'meat', price: 140, n: 8, diet: [], s: 0.85 },
  { id: 'chicken', name: 'Chicken', cat: 'meat', price: 150, n: 6, diet: [], s: 1 },
  { id: 'bacon', name: 'Bacon', cat: 'meat', price: 140, n: 6, diet: [], s: 1.1 },
  { id: 'mushroom', name: 'Mushrooms', cat: 'veg', price: 90, n: 8, diet: ['V', 'VG'], s: 0.95 },
  { id: 'onion', name: 'Red onion', cat: 'veg', price: 80, n: 8, diet: ['V', 'VG'], s: 0.9 },
  { id: 'pepper', name: 'Green peppers', cat: 'veg', price: 90, n: 8, diet: ['V', 'VG'], s: 0.95 },
  { id: 'olive', name: 'Black olives', cat: 'veg', price: 90, n: 10, diet: ['V', 'VG'], s: 0.6 },
  { id: 'corn', name: 'Sweetcorn', cat: 'veg', price: 80, n: 14, diet: ['V', 'VG'], s: 0.45 },
  { id: 'jalapeno', name: 'Jalapeños', cat: 'veg', price: 90, n: 8, diet: ['V', 'VG', 'HOT'], s: 0.65 },
  { id: 'tomato', name: 'Cherry tomatoes', cat: 'veg', price: 90, n: 6, diet: ['V', 'VG'], s: 0.85 },
  { id: 'basil', name: 'Fresh basil', cat: 'veg', price: 60, n: 6, diet: ['V', 'VG'], s: 0.8 },
  { id: 'pineapple', name: 'Pineapple', cat: 'extras', price: 90, n: 8, diet: ['V', 'VG'], s: 0.8 },
  { id: 'goat', name: "Goat's cheese", cat: 'cheese', price: 130, n: 6, diet: ['V'], s: 0.85 },
  { id: 'feta', name: 'Feta', cat: 'cheese', price: 120, n: 8, diet: ['V'], s: 0.55 },
  { id: 'rocket', name: 'Rocket', note: 'added after baking', cat: 'extras', price: 70, n: 1, diet: ['V', 'VG'], s: 3.2, late: true },
  { id: 'chilli', name: 'Chilli oil drizzle', cat: 'extras', price: 50, n: 1, diet: ['V', 'VG', 'HOT'], s: 5.2, late: true }
];

var SIZES = [
  { id: 'small', label: 'Small', sub: '10"', price: 800, scale: 0.82 },
  { id: 'medium', label: 'Medium', sub: '12"', price: 1050, scale: 0.91 },
  { id: 'large', label: 'Large', sub: '14"', price: 1300, scale: 1 }
];
var CRUSTS = [
  { id: 'classic', label: 'Classic', extra: 0, sauceR: 156, fill: '#E3A65A', inner: '#D9944A' },
  { id: 'thin', label: 'Thin & Crispy', extra: 0, sauceR: 170, fill: '#CF8A43', inner: '#B97638' },
  { id: 'stuffed', label: 'Stuffed Crust', extra: 150, sauceR: 142, fill: '#EDBE73', inner: '#E0A85E' },
  { id: 'gf', label: 'Gluten-free', extra: 200, sauceR: 158, fill: '#D6AE76', inner: '#C79B62' }
];
var SAUCES = [
  { id: 'tomato', label: 'Tomato', color: '#B8281C' },
  { id: 'bbq', label: 'BBQ', color: '#5B2716' },
  { id: 'garlic', label: 'Garlic & Herb', color: '#F2E8CF' },
  { id: 'none', label: 'No sauce', color: '#F1D49C' }
];
var CHEESES = [
  { id: 'mozzarella', label: 'Mozzarella', extra: 0, color: '#FFF0C2' },
  { id: 'vegan', label: 'Vegan cheese', extra: 100, color: '#F3E4B0' },
  { id: 'extra', label: 'Extra cheese', extra: 120, color: '#FFEBAA' },
  { id: 'none', label: 'No cheese', extra: 0, color: null }
];

var BADGES = [
  { id: 'garden', name: 'Garden Party', desc: '4+ veg toppings, no meat', sym: 'basil' },
  { id: 'burn', name: 'Feel the Burn', desc: 'Jalapeños + chilli oil', sym: 'jalapeno' },
  { id: 'pine', name: 'Controversial', desc: 'Pineapple added', sym: 'pineapple' },
  { id: 'carn', name: 'Carnivore', desc: '3+ meat toppings', sym: 'bacon' },
  { id: 'bal', name: 'Perfectly Balanced', desc: 'Exactly 2 meat + 2 veg', sym: 'scale' },
  { id: 'artist', name: 'Artist', desc: 'Moved 10+ pieces', sym: 'brush' }
];

var PRESETS = [
  { id: 'margherita', name: 'Margherita', img: 'assets/img/preset-margherita.webp', desc: 'Tomato, mozzarella, cherry tomatoes and fresh basil.', base: { sauce: 'tomato', cheese: 'mozzarella', crust: 'classic' }, toppings: [['tomato', 1], ['basil', 1]] },
  { id: 'pepperoni', name: 'Pepperoni Classic', img: 'assets/img/preset-pepperoni.webp', desc: 'A double helping of pepperoni on tomato and mozzarella.', base: { sauce: 'tomato', cheese: 'mozzarella', crust: 'classic' }, toppings: [['pepperoni', 2]] },
  { id: 'veggie', name: 'Veggie Garden', img: 'assets/img/preset-veggie.webp', desc: 'Mushrooms, red onion, green peppers, olives and sweetcorn.', base: { sauce: 'tomato', cheese: 'mozzarella', crust: 'classic' }, toppings: [['mushroom', 1], ['onion', 1], ['pepper', 1], ['olive', 1], ['corn', 1]] },
  { id: 'meat', name: 'Meat Feast', img: 'assets/img/preset-meat.webp', desc: 'Pepperoni, ham, spicy beef, chicken and bacon.', base: { sauce: 'bbq', cheese: 'mozzarella', crust: 'classic' }, toppings: [['pepperoni', 1], ['ham', 1], ['beef', 1], ['chicken', 1], ['bacon', 1]] }
];

var DELIVERY_FEE = 250;      // pence
var FREE_OVER = 2500;        // free delivery at or above this subtotal (pence)
var PROMO = 'PIZZA10';       // demo promo code: 10% off
var STORE_KEY = 'pizzaBuilder.v1';
var MAX_TOPPINGS = 8;
var MAX_PORTIONS = 2;
var HISTORY_MAX = 30;

/* BACKEND HOOK --------------------------------------------------------
   Connect a real ordering / payment API here. Return a Promise that
   resolves with { ok: true, orderNumber } once the server accepts it.
   --------------------------------------------------------------------- */
function submitOrder(order) {
  // e.g. return fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) }).then(function (r) { return r.json(); });
  return Promise.resolve({ ok: true, orderNumber: order.orderNumber });
}
