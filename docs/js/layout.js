/* Shared XTO header + footer for the storefront and inner pages (franchise, careers, contact). */
(function () {
  'use strict';
  var page = document.body.getAttribute('data-page') || 'home';
  var home = page === 'home';
  var NAV = [
    ['home', home ? '#top' : 'site.html', 'Home'],
    ['menu', home ? '#menu' : 'site.html#menu', 'Menu'],
    ['offers', home ? '#offers' : 'site.html#offers', 'Offers'],
    ['locator', home ? '#outlets' : 'site.html#outlets', 'Store Locator'],
    ['franchise', 'franchise.html', 'Franchise Enquiry'],
    ['story', home ? '#story' : 'site.html#story', 'Our Story'],
    ['careers', 'careers.html', 'Jobs & Careers'],
    ['contact', 'contact.html', 'Contact Us']
  ];
  var ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
  var ICON_CART = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
  var ICON_TRACK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-6.5 8-12a8 8 0 1 0-16 0c0 5.5 8 12 8 12z"/><circle cx="12" cy="10" r="3"/></svg>';

  var header = '' +
    '<header class="xh" id="nav">' +
      '<div class="xh-top"><div class="xw xh-in">' +
        '<a class="xh-brand" href="site.html" aria-label="XTO Pizza home">' +
          '<span class="xh-logo"><img src="images/mark.svg" alt="" /></span>' +
          '<span class="xh-word">XTO PIZZA<em>PURE VEG</em></span>' +
        '</a>' +
        '<form class="xh-search" id="headSearchForm" role="search">' + ICON_SEARCH +
          '<label class="xvis" for="headSearch">Search the menu</label>' +
          '<input id="headSearch" type="search" placeholder="Search for pizzas, burgers, shakes..." autocomplete="off" />' +
        '</form>' +
        '<div class="xh-actions">' +
          '<a class="xh-pill" href="#" id="trackLink">' + ICON_TRACK + '<span class="t">Track</span></a>' +
          '<button class="xh-pill cart" id="cartBtn" type="button" aria-label="Open cart">' + ICON_CART + '<span class="t">Cart</span><span class="cart-count" id="cartCount">0</span></button>' +
        '</div>' +
      '</div></div>' +
      '<nav class="xh-nav" aria-label="Main"><div class="xw">' +
        NAV.map(function (n) { return '<a href="' + n[1] + '"' + (n[0] === page ? ' aria-current="page"' : '') + '>' + n[2] + '</a>'; }).join('') +
      '</div></nav>' +
    '</header>';

  var footer = '' +
    '<footer class="xf"><div class="xw">' +
      '<div class="xf-grid">' +
        '<div>' +
          '<div class="xf-brand"><span class="xh-logo"><img src="images/mark.svg" alt="" /></span><span class="xh-word">XTO PIZZA</span></div>' +
          '<p>Pune\'s pure veg pizzeria. Stone-baked pizzas, stacked burgers, pasta, wraps and thick shakes from two outlets on the Sinhagad Road side.</p>' +
          '<span class="xf-veg"><span class="xveg inline"></span>100% pure vegetarian</span>' +
        '</div>' +
        '<div><h4>Quick links</h4>' +
          '<a href="site.html#menu">Full menu</a><a href="site.html#offers">Offers</a><a href="site.html#outlets">Store locator</a>' +
          '<a href="franchise.html">Franchise enquiry</a><a href="careers.html">Jobs &amp; careers</a><a href="contact.html">Contact us</a><a href="app.html">Get the app</a>' +
        '</div>' +
        '<div><h4>Outlets</h4>' +
          '<p><b style="color:#fff">Shivane (Khadakwasla)</b><br>NDA Rd, near Add Mart, Shivane, Pune 411023<br><a href="tel:+917030000776">+91 70300 00776</a> &middot; 11 am - 10:30 pm</p>' +
          '<p><b style="color:#fff">Nanded City</b><br>Destination Centre, F-65, Sinhagad Rd, Pune 411068<br><a href="tel:+917030000886">+91 70300 00886</a> &middot; 11 am - 11 pm</p>' +
        '</div>' +
        '<div><h4>Connect</h4>' +
          '<a href="mailto:info@xtopizza.com">info@xtopizza.com</a><a href="mailto:ordernow@xtopizza.com">ordernow@xtopizza.com</a>' +
          '<a href="https://xtopizza.com" target="_blank" rel="noopener">xtopizza.com</a>' +
          '<p style="margin-top:10px">Dine-in and takeaway. UPI, cards and netbanking via Razorpay. GST and packaging charges extra.</p>' +
        '</div>' +
      '</div>' +
      '<div class="xf-base"><span>&copy; 2026 XTO Pizza. Ardur Foods Pvt. Ltd. All rights reserved.</span><span><a href="privacy.html" style="display:inline">Privacy</a> &middot; <a href="terms.html" style="display:inline">Terms</a> &middot; <a href="refund.html" style="display:inline">Refunds</a></span></div>' +
    '</div></footer>';

  var hm = document.getElementById('xh-mount'); if (hm) hm.outerHTML = header;
  var fm = document.getElementById('xf-mount'); if (fm) fm.outerHTML = footer;

  // header search: on the home page filter the menu, elsewhere jump to it
  var f = document.getElementById('headSearchForm');
  if (f) f.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('headSearch').value.trim();
    if (!home) { location.href = 'site.html?q=' + encodeURIComponent(q) + '#menu'; return; }
    var ms = document.getElementById('menuSearch');
    if (ms) { ms.value = q; ms.dispatchEvent(new Event('input')); }
    var m = document.getElementById('menu'); if (m) m.scrollIntoView({ behavior: 'smooth' });
  });

  // cart button on inner pages sends the visitor to the storefront drawer
  if (!home) {
    var cb = document.getElementById('cartBtn');
    if (cb) cb.addEventListener('click', function () { location.href = 'site.html?cart=1'; });
    var tl = document.getElementById('trackLink');
    if (tl) tl.addEventListener('click', function (e) { e.preventDefault(); location.href = 'site.html?track=1'; });
    try {
      var cart = JSON.parse(localStorage.getItem('xto_cart_v1') || '{}');
      var n = Object.keys(cart).reduce(function (s, k) { return s + cart[k]; }, 0);
      var c = document.getElementById('cartCount'); if (c) c.textContent = n;
    } catch (e) {}
  }
})();
