/* Cable Turf / shared behavior
   ------------------------------------------------------------------
   Formatting, data loading and the chrome. Every page loads this first.
   No dependencies. */

(function () {
  'use strict';

  var REPO = 'https://github.com/jaramana/cableturf.publicworks.nyc';

  var whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  var fmt = {
    num: function (n) {
      return n === null || n === undefined || isNaN(n) ? '—' : whole.format(n);
    },

    // 2026-10-15 as 15 October 2026.
    date: function (iso) {
      return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
      }).format(new Date(iso + 'T00:00:00Z'));
    }
  };

  var cache = {};

  // Each load checks with the server, so a rebuilt file never meets an
  // older script.
  function load(path) {
    if (!cache[path]) {
      cache[path] = fetch('data/' + path, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('Could not load ' + path + ' (' + r.status + ').');
        return r.json();
      });
    }
    return cache[path];
  }

  // ---- Chrome -----------------------------------------------------

  var PAGES = [
    { href: 'index.html', nav: 'Map' },
    { href: 'data.html',  nav: 'Data' },
    { href: 'about.html', nav: 'About' }
  ];

  // The disclaimer, word for word wherever it appears.
  var COLOPHON =
    '<p class="colophon"><strong>This is not an official product.</strong> ' +
      'It is an independent initiative, not affiliated with, endorsed by, ' +
      'or produced by the <a href="https://www.fcc.gov/">Federal Communications ' +
      'Commission</a> or the City of New York. Please refer to them for ' +
      'authoritative information.</p>';

  var PORTFOLIO =
    '<p class="portfolio">A <a href="https://publicworks.nyc/">publicworks.nyc</a> project.</p>';

  // On a phone the nav folds behind a menu button. Escape, a tap outside the
  // masthead, a tap on a link, or a window wide enough to show the nav folds
  // it again. Open, the page underneath stops scrolling.
  function menu(head) {
    var button = head.querySelector('.nav-toggle');
    var wide = window.matchMedia('(min-width: 40.01rem)');
    var nav = head.querySelector('.nav');
    function set(open) {
      if (open) nav.style.setProperty('--sheet-top', head.getBoundingClientRect().bottom + 'px');
      button.setAttribute('aria-expanded', String(open));
      head.classList.toggle('menu-open', open);
      document.documentElement.classList.toggle('menu-locked', open);
    }
    button.addEventListener('click', function () {
      set(button.getAttribute('aria-expanded') !== 'true');
    });
    head.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && head.classList.contains('menu-open')) { set(false); button.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (head.classList.contains('menu-open') && !head.contains(e.target)) set(false);
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    wide.addEventListener('change', function () { if (wide.matches) set(false); });
  }

  function buildChrome() {
    var here = location.pathname.split('/').pop() || 'index.html';

    var head = document.querySelector('[data-chrome="masthead"]');
    if (head) {
      head.className = 'masthead';
      head.innerHTML =
        '<div class="wrap masthead-inner">' +
          '<a class="wordmark" href="index.html">Cable Turf</a>' +
          '<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">' +
            '<span class="sr-only">Menu</span>' +
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
              '<path class="bar-top" d="M4 7h16"/>' +
              '<path class="bar-mid" d="M4 12h16"/>' +
              '<path class="bar-bottom" d="M4 17h16"/>' +
            '</svg>' +
          '</button>' +
          '<nav class="nav" id="site-nav" aria-label="Sections">' +
            PAGES.map(function (p) {
              return '<a href="' + p.href + '"' +
                (p.href === here ? ' aria-current="page"' : '') + '>' + p.nav + '</a>';
            }).join('') +
          '</nav>' +
        '</div>';
      menu(head);
    }

    var foot = document.querySelector('[data-chrome="footer"]');
    if (foot && foot.hasAttribute('data-compact')) {
      foot.className = 'footer footer-compact';
      foot.innerHTML = COLOPHON + PORTFOLIO;
    } else if (foot) {
      foot.className = 'footer';
      foot.innerHTML =
        '<div class="wrap"><div class="footer-grid">' +
          '<div><h2 class="footer-head">Views</h2><ul>' +
            '<li><a href="index.html">Map</a></li>' +
          '</ul></div>' +
          '<div><h2 class="footer-head">Reference</h2><ul>' +
            '<li><a href="data.html">Data</a></li>' +
            '<li><a href="about.html">About</a></li>' +
          '</ul></div>' +
          '<div><h2 class="footer-head">Sources</h2><ul>' +
            '<li><a href="https://broadbandmap.fcc.gov/data-download">FCC Broadband Data Collection</a></li>' +
            '<li><a href="https://data.cityofnewyork.us/d/wmsu-5muw">NYC Planning 2020 Census Blocks</a></li>' +
            '<li><a href="https://data.cityofnewyork.us/d/n2h8-q6ag">OTI Cable Franchise Areas</a></li>' +
            '<li><a href="https://data.cityofnewyork.us/d/9nt8-h7nd">NYC Planning 2020 NTAs</a></li>' +
          '</ul></div>' +
          '<div><h2 class="footer-head">Project</h2><ul>' +
            '<li><a href="' + REPO + '">Source on GitHub</a></li>' +
            '<li><a href="' + REPO + '/issues">Report an error</a></li>' +
          '</ul></div>' +
        '</div>' + COLOPHON + PORTFOLIO + '</div>';
    }

    var built = document.querySelector('p#built');
    var figures = document.querySelectorAll('[data-meta]');
    if (built || figures.length) {
      load('meta.json').then(function (m) {
        if (built) built.textContent = 'Data built ' + fmt.date(m.built) + '.';
        fill(figures, m);
      });
    }
  }

  // Figures typed into a page are refreshed from the summary, so the page
  // can't drift from the files. A key ending in _pct is a percentage and
  // keeps the decimal places of the typed figure.
  function fill(nodes, meta) {
    [].forEach.call(nodes, function (el) {
      var key = el.getAttribute('data-meta');
      var value = key.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, meta);
      if (value == null) return;
      var digits = (el.textContent.split('.')[1] || '').replace(/\D/g, '').length;
      el.textContent = /_pct$/.test(key) ? value.toFixed(digits) + '%' : fmt.num(value);
    });
  }

  document.addEventListener('DOMContentLoaded', buildChrome);

  window.CT = { fmt: fmt, load: load };
})();
