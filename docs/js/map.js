/* Cable Turf / front page
   ------------------------------------------------------------------
   A five-step story over one pinned map, ending in the map itself.

   Map layers, bottom to top:
     turf  ·  wire  ·  focus washes  ·  hatch  ·  block edges  ·
     franchise line  ·  outline  ·  labels

   "Cable company" colors each block by its cable company and hatches
   blocks with no Verizon fiber or Astound claimed. "Other options" shades
   each block by the share of its buildings with neither claimed. Open land
   takes neither view.

   Each step sets the camera, the view and which company stands out. The
   last step unlocks the map and works as the panel: hover, tap, samples
   and the view switch. */

(function () {
  'use strict';

  var NYC = [[-74.258, 40.496], [-73.700, 40.915]];
  var MAX_BOUNDS = [[-74.75, 40.25], [-73.25, 41.15]];

  var POSITRON = 'https://tiles.openfreemap.org/styles/positron';
  var ATTRIBUTION =
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ' +
    '<a href="https://openfreemap.org/">OpenFreeMap</a>';

  var BG = '#f0f2f5';

  // Matches the tokens and legend in site.css and index.html. Astound-only
  // blocks and blocks with no cable claim share the open land color.
  var FILL = { S: '#a6c4ef', O: '#96d4c6', B: '#c4b5ea', open: '#e5e8ec' };
  var HATCH = 'rgba(20, 32, 56, .6)';

  // "Other options" view, from none of the block's buildings without one
  // to all. Matches --ramp in site.css.
  var RAMP = [0, '#eef3fb', .25, '#c3d3ee', .5, '#88a3d6', .75, '#4f70b4', 1, '#22407e'];

  var CABLE = {
    S: 'Spectrum',
    O: 'Optimum',
    B: 'Spectrum and Optimum',
    A: 'Astound alone',
    N: 'No cable company claimed'
  };
  var SWATCH = { S: 'spectrum', O: 'optimum', B: 'both', A: 'open', N: 'open' };

  var WIRELESS = [[1, 'Verizon'], [2, 'T-Mobile'], [4, 'Starry']];

  // Fewer buildings per hectare than this is open land, mostly parks,
  // airports and cemeteries. Those blocks hold 0.2% of buildings and
  // nearly a third of the land.
  var OPEN_DENSITY = 0.5;

  // Company tags, placed by hand inside each stretch of turf. They give
  // way to street labels from NAMES_UNTIL.
  var TURF_NAMES = [
    [[-73.872, 40.852], 'O'], [[-73.925, 40.652], 'O'],
    [[-73.968, 40.788], 'S'], [[-73.812, 40.722], 'S'],
    [[-74.150, 40.585], 'S'], [[-74.018, 40.624], 'S'],
    [[-73.948, 40.717], 'S']
  ];
  var NAMES_UNTIL = 13;

  // Sample blocks for the "See a block" chips, in index.html's order. Each
  // point sits inside a block that shows one case: no other option (Bay
  // Ridge), both cable companies (Clinton Hill), the franchise map's
  // exception (Marble Hill), Astound (Murray Hill), fiber at every
  // building (Co-op City).
  var SAMPLES = [
    [-74.02193, 40.62762], [-73.95945, 40.68415], [-73.91176, 40.87708],
    [-73.97814, 40.74365], [-73.82527, 40.86061]
  ];

  // The map for each step, in the page's order. "focus" fades every block
  // but that company's, and "tags" name places the text mentions. The live
  // step keeps the reader's chosen view. Step 2 frames the purple seam in
  // Clinton Hill and Bed-Stuy; step 3 centers on the buildings of the
  // neighborhood meta.json names under "story".
  var STEPS = [
    { bounds: NYC, view: 'holder', hatch: false },
    { center: [-73.9585, 40.6835], zoom: 13.3, view: 'holder', hatch: false, focus: 'B' },
    { center: [-73.944, 40.815], zoom: 13.2, view: 'wire', tags: [[[-73.943, 40.8158], 'Northern Harlem']] },
    { bounds: [[-74.03, 40.57], [-73.77, 40.92]], view: 'holder', hatch: false, focus: 'O' },
    { bounds: NYC, hatch: true, live: true }
  ];

  var fmt = function (n) { return CT.fmt.num(n); };

  // ---- Data ---------------------------------------------------------

  // Ring area in square meters, flat at NYC's latitude.
  var KX = 111320 * Math.cos(40.7 * Math.PI / 180), KY = 110540;

  function ringArea(ring) {
    var a = 0;
    for (var i = 0; i < ring.length - 1; i++) {
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(a) / 2 * KX * KY;
  }

  // Blocks arrive as integer deltas. Each ring starts from the file's origin.
  // A block is open land when it has no buildings or very few for its size.
  function decode(d) {
    var s = d.scale, ox = d.origin[0], oy = d.origin[1];
    return {
      type: 'FeatureCollection',
      features: d.blocks.map(function (b) {
        var area = 0;
        var coordinates = b[5].map(function (rings) {
          return rings.map(function (flat, k) {
            var ring = [], x = ox, y = oy;
            for (var i = 0; i < flat.length; i += 2) {
              x += flat[i]; y += flat[i + 1];
              ring.push([x / s, y / s]);
            }
            ring.push(ring[0]);
            area += (k ? -1 : 1) * ringArea(ring);
            return ring;
          });
        });
        var open = !b[1] || b[1] / (area / 1e4) < OPEN_DENSITY;
        return {
          type: 'Feature',
          properties: { h: b[0], t: b[1], v: b[2], a: b[3], w: b[4], o: open ? 1 : 0, n: b[6] },
          geometry: { type: 'MultiPolygon', coordinates: coordinates }
        };
      })
    };
  }

  // ---- Basemap ------------------------------------------------------

  var INK = { place: '#3f444d', street: '#5f6570', water: '#4f7088', halo: 'rgba(255, 255, 255, .88)' };

  var SIZE = {
    place: ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15, 13.5],
    street: ['interpolate', ['linear'], ['zoom'], 13, 10.5, 16, 12.5],
    water: ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 14]
  };

  // The label layers kept from Positron, and how far from NYC land, in
  // meters, a label may sit before it is clipped.
  var KEEP = {
    'highway-name-major': { near: 60, color: INK.street, size: SIZE.street },
    'highway-name-minor': { near: 60, color: INK.street, size: SIZE.street, minzoom: 14 },
    label_other: { near: 60, color: INK.place, size: SIZE.place, font: 'Noto Sans Regular', flat: true },
    water_name_point_label: { near: 2500, color: INK.water, size: SIZE.water },
    water_name_line_label: { near: 2500, color: INK.water, size: SIZE.water },
    waterway_line_label: { near: 300, color: INK.water, size: SIZE.street }
  };

  function bare() {
    return {
      version: 8, sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': BG } }]
    };
  }

  function basemap(outline) {
    return fetch(POSITRON).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (s) {
      var labels = s.layers.filter(function (l) { return KEEP[l.id]; }).map(function (l) {
        var k = KEEP[l.id];
        l.filter = ['all', l.filter || true, ['<', ['distance', outline], k.near]];
        l.layout['text-size'] = k.size;
        if (k.font) l.layout['text-font'] = [k.font];
        if (k.flat) { l.layout['text-transform'] = 'none'; l.layout['text-letter-spacing'] = .02; }
        if (k.minzoom) l.minzoom = k.minzoom;
        l.paint = { 'text-color': k.color, 'text-halo-color': INK.halo, 'text-halo-width': 1.4, 'text-halo-blur': .3 };
        return l;
      });
      var style = bare();
      style.glyphs = s.glyphs;
      style.sources.openmaptiles = s.sources.openmaptiles;
      style.layers = style.layers.concat(labels);
      return style;
    }).catch(function (err) {
      if (window.console) console.warn('Labels did not load:', err);
      return bare();
    });
  }

  // ---- Map ----------------------------------------------------------

  function firstLabel(map) {
    var hit = map.getStyle().layers.filter(function (l) { return l.type === 'symbol'; })[0];
    return hit ? hit.id : undefined;
  }

  // 45° lines that tile without seams, drawn at twice the screen scale.
  function hatch() {
    var n = 10, canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    var g = canvas.getContext('2d');
    g.strokeStyle = HATCH; g.lineWidth = 2.2; g.lineCap = 'square';
    [[0, n, n, 0], [-n / 2, n / 2, n / 2, -n / 2], [n / 2, n * 1.5, n * 1.5, n / 2]].forEach(function (l) {
      g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(l[2], l[3]); g.stroke();
    });
    return g.getImageData(0, 0, n, n);
  }

  var OPEN = ['==', ['get', 'o'], 1];

  var HOLDER_FILL = ['case', OPEN, FILL.open,
    ['match', ['get', 'h'], 'S', FILL.S, 'O', FILL.O, 'B', FILL.B, FILL.open]];

  // Buildings no rival claims, as a share of the block. A floor, because
  // Verizon's and Astound's claims may overlap.
  var NO_WIRE = ['/', ['max', 0, ['-', ['get', 't'], ['+', ['get', 'v'], ['get', 'a']]]], ['max', ['get', 't'], 1]];

  var WIRE_FILL = ['case', ['any', OPEN, ['match', ['get', 'h'], ['A', 'N'], true, false]], FILL.open,
    ['interpolate', ['linear'], NO_WIRE].concat(RAMP)];

  // Companies the story singles out. Each gets a wash that pales every
  // other block.
  var FOCI = ['B', 'O'];

  // MapLibre fades a layer's opacity only when it is one plain number, never
  // a per-block expression. So each view and each focus is its own layer,
  // and the story fades whole layers in and out.
  function addLayers(map, blocks, city) {
    var before = firstLabel(map);

    map.addImage('hatch', hatch(), { pixelRatio: 2 });
    map.addSource('blocks', { type: 'geojson', data: blocks, generateId: true, maxzoom: 14 });
    map.addSource('franchise', { type: 'geojson', data: city.franchise_line });

    map.addLayer({ id: 'turf', type: 'fill', source: 'blocks', paint: { 'fill-color': HOLDER_FILL } }, before);
    map.addLayer({
      id: 'wire', type: 'fill', source: 'blocks',
      paint: { 'fill-color': WIRE_FILL, 'fill-opacity': 0 }
    }, before);
    FOCI.forEach(function (code) {
      map.addLayer({
        id: 'dim-' + code, type: 'fill', source: 'blocks',
        filter: ['!=', ['get', 'h'], code],
        paint: { 'fill-color': BG, 'fill-opacity': 0 }
      }, before);
    });
    map.addLayer({
      id: 'hatch', type: 'fill', source: 'blocks',
      filter: ['all', ['==', ['get', 'o'], 0], ['==', ['get', 'v'], 0], ['==', ['get', 'a'], 0]],
      paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0 }
    }, before);
    map.addLayer({
      id: 'edges', type: 'line', source: 'blocks',
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, .1, 13, .8, 16, 2.5]
      }
    }, before);
    map.addLayer({
      id: 'franchise-casing', type: 'line', source: 'franchise',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6]
      }
    }, before);
    map.addLayer({
      id: 'franchise', type: 'line', source: 'franchise',
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#16181d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 14, 2.6],
        'line-dasharray': [3, 1.5]
      }
    }, before);
    // Hovered blocks get a thin outline, the picked block a thick one.
    map.addLayer({
      id: 'outline', type: 'line', source: 'blocks',
      paint: {
        'line-color': '#16181d',
        'line-width': ['case', ['boolean', ['feature-state', 'picked'], false], 3.5, 2],
        'line-opacity': ['case',
          ['any', ['boolean', ['feature-state', 'hover'], false], ['boolean', ['feature-state', 'picked'], false]], 1, 0]
      }
    }, before);
  }

  // A marker whose label can fade. MapLibre resets the marker element's own
  // opacity on every frame, so the label is a child.
  function tag(className, text) {
    var el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="' + className + '"></span>';
    el.firstChild.textContent = text;
    return el;
  }

  function addNames(map) {
    TURF_NAMES.forEach(function (n) {
      new maplibregl.Marker({ element: tag('turf-name turf-' + n[1], CABLE[n[1]]) }).setLngLat(n[0]).addTo(map);
    });
    var stage = map.getContainer();
    function toggle() { stage.classList.toggle('names-off', map.getZoom() >= NAMES_UNTIL); }
    map.on('zoom', toggle);
    toggle();
  }

  // ---- Tooltip ------------------------------------------------------

  // The block's cable company, then what its rivals claim, on one line.
  function tipHtml(p) {
    if (!p.t) return '<b>No homes or businesses</b>';
    var one = p.t === 1;
    var parts = ['<b>' + CABLE[p.h] + '</b>', fmt(p.t) + (one ? ' building' : ' buildings')];
    if (one) parts.push(p.v ? 'Verizon fiber claimed' : 'no Verizon fiber claimed');
    else parts.push('Verizon fiber at ' + (p.v === 0 ? 'none' : p.v === p.t ? 'all' : fmt(p.v)));
    if (p.a && p.h !== 'A') parts.push(one ? 'Astound claimed' : 'Astound at ' + (p.a === p.t ? 'all' : fmt(p.a)));
    return parts.join(' · ');
  }

  // Sits above the point, or below it near the top edge, and stays inside
  // the map.
  function place(tip, stage, point) {
    var w = tip.offsetWidth, h = tip.offsetHeight, gap = 12;
    var x = Math.min(Math.max(point.x - w / 2, 8), stage.clientWidth - w - 8);
    var y = point.y - h - gap < 8 ? point.y + gap + 8 : point.y - h - gap;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  // ---- Block readout ------------------------------------------------

  // The block's cable company, then what its rivals claim, then who let
  // them in. Narrative sentences cite their sources inline.

  function bar(label, share, value, color) {
    return '<li><span>' + label + '</span><span class="bar"><i style="width:' + share +
      '%;background:' + color + '"></i></span><span class="v">' + value + '</span></li>';
  }

  function claim(n, t) {
    if (!n) return 'none';
    if (n === t) return t === 1 ? 'yes' : 'all ' + fmt(t);
    return fmt(n) + ' of ' + fmt(t);
  }

  // Sources open in a new tab so the map keeps its place.
  var SRC = {
    franchise: 'https://www.nyc.gov/content/oti/pages/franchises',
    cable: 'https://www.nyc.gov/content/oti/pages/franchises/cable-tv-franchises',
    cablevision: 'https://www.nyc.gov/assets/mocs/downloads/Opportunities/FCRC/agendas/may/2016/FCRC_Public_Meeting_Documents-5-11-16.pdf',
    altice: 'https://www.sec.gov/Archives/edgar/data/1702780/000162828025005486/atus-20241231.htm',
    verizon: 'https://www.nyc.gov/assets/oti/downloads/pdf/cable-tv-franchises/verizon-nyc-franchise-agreement-fcrc-approved.pdf',
    audit: 'https://www.fierce-network.com/telecom/new-york-city-audit-says-verizon-failed-to-deliver-fios-promise'
  };

  function cite(key, text) {
    return '<a href="' + SRC[key] + '" target="_blank" rel="noopener">' + text + '</a>';
  }

  var FRANCHISE = {
    S: '<p>Spectrum\'s cable runs here under a ' + cite('franchise', 'City franchise') +
      ', a contract that lets a company put wires on, over and under City streets.</p>',
    O: '<p>Optimum\'s cable runs here under a ' + cite('franchise', 'City franchise') +
      ', a contract that lets a company put wires on, over and under City streets.</p>',
    B: '<p>Spectrum and Optimum both run cable here under ' + cite('franchise', 'City franchises') +
      ', contracts that let a company put wires on, over and under City streets.</p>'
  };

  var OPTIMUM = '<p>Optimum\'s ' + cite('cablevision', 'agreements') + ' ran to 18 July 2020. At the end of 2024, Altice, ' +
    'Optimum\'s owner, ' + cite('altice', 'reported') + ' the franchise still expired and said it was operating under temporary state authority.</p>';

  var VERIZON = '<p>Verizon holds a ' + cite('cable', 'citywide franchise') + '. When the City granted it in 2008, Verizon ' +
    cite('verizon', 'promised') + ' Fios to every household by 30 June 2014. A ' + cite('audit', 'City audit') +
    ' in 2015 found Fios reached about two in three households.</p>';

  // What the claims show about other options. Verizon's and Astound's
  // claims may overlap, so some blocks get a floor or a ceiling.
  function verdict(p) {
    if (p.h === 'N') return 'No cable company claims this block.';
    var floor = Math.max(0, p.t - p.v - p.a), most = p.t - Math.max(p.v, p.a);
    if (floor === p.t) return p.t === 1 ? 'This building has <b>no other option</b> claimed.' : '<b>No building</b> on this block has another option claimed.';
    if (most <= 0) return '<b>Every building</b> has another option claimed.';
    if (floor > 0) return '<b>At least ' + fmt(floor) + '</b> of ' + fmt(p.t) + ' buildings have no other option claimed.';
    return '<b>Up to ' + fmt(most) + '</b> of ' + fmt(p.t) + ' buildings have no other option claimed.';
  }

  function blockHtml(p, places) {
    var where = p.n >= 0 ? places[p.n] : 'This block';
    var html = '<button type="button" class="back" data-back>← Back</button>' +
      '<section class="readout"><h3 class="section-h">' + where + '</h3>' +
      '<p class="holder"><span class="swatch ' + (p.o ? 'open' : SWATCH[p.h]) + '"></span>' + (p.t ? CABLE[p.h] : 'Open land') + '</p>' +
      '<p class="sub">' + (p.t ? fmt(p.t) + (p.t === 1 ? ' building' : ' buildings') + ' on this block' : 'No homes or businesses on this block') + '</p></section>';
    if (!p.t) return html;

    var air = WIRELESS.filter(function (w) { return p.w & w[0]; }).map(function (w) { return w[1]; });
    html += '<section class="readout"><h3 class="section-h">Other options</h3><ul class="rows">' +
      bar('Verizon fiber', p.v / p.t * 100, claim(p.v, p.t), 'var(--accent)') +
      (p.a ? bar('Astound', p.a / p.t * 100, claim(p.a, p.t), 'var(--astound)') : '') + '</ul>' +
      '<p class="verdict">' + verdict(p) + '</p>' +
      (air.length ? '<p class="fine">Wireless home internet from ' + air.join(' and ').replace(/ and (?=.* and )/, ', ') +
        ' is also claimed here. The map counts only fiber and cable.</p>' : '') + '</section>';

    html += '<section class="readout"><h3 class="section-h">Who let them in</h3>' +
      (FRANCHISE[p.h] || '') + (p.h === 'O' || p.h === 'B' ? OPTIMUM : '') + VERIZON + '</section>';

    html += '<section class="readout"><a class="out" href="https://broadbandmap.fcc.gov/" target="_blank" rel="noopener">Check one building on the FCC\'s map ↗</a></section>';
    return html;
  }

  // ---- Story --------------------------------------------------------

  // The active step is the last one whose top has passed a trigger line:
  // just past the middle when wide, low on the screen when the map sits on
  // top. Only the live step takes hover, taps and map gestures.
  function story(map, places) {
    var steps = [].slice.call(document.querySelectorAll('.step'));
    var stage = map.getContainer();
    var tip = document.getElementById('tip');
    var cityPane = document.getElementById('city');
    var blockPane = document.getElementById('block');
    var group = document.getElementById('view');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    var narrow = window.matchMedia('(max-width: 60rem)');
    var nav = new maplibregl.NavigationControl({ showCompass: false });
    var GESTURES = ['scrollZoom', 'dragPan', 'boxZoom', 'doubleClickZoom', 'keyboard', 'touchZoomRotate'];
    var current = -1, chosen = 'holder', live = false, hovered = null, picked = null;

    var tags = STEPS.map(function (st) {
      return (st.tags || []).map(function (t) {
        var el = tag('place-tag', t[1]);
        new maplibregl.Marker({ element: el }).setLngLat(t[0]).addTo(map);
        return el.firstChild;
      });
    });

    // Layers fade out at once and fade in a beat later, so the new view
    // arrives as the camera settles.
    var FADE = 900, LAG = 450, shown = {};
    function fade(layer, to) {
      if (shown[layer] === to) return;
      var rising = to > (shown[layer] || 0);
      shown[layer] = to;
      map.setPaintProperty(layer, 'fill-opacity-transition', reduce.matches ?
        { duration: 0, delay: 0 } : { duration: FADE, delay: rising ? LAG : 0 });
      map.setPaintProperty(layer, 'fill-opacity', to);
    }

    function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    function setView(view, hatchOn) {
      var wire = view === 'wire';
      fade('wire', wire ? 1 : 0);
      fade('hatch', !wire && hatchOn ? 1 : 0);
      stage.classList.toggle('names-hidden', wire);
      document.querySelector('[data-key="holder"]').hidden = wire;
      document.querySelector('[data-key="wire"]').hidden = !wire;
    }

    function focus(code) {
      FOCI.forEach(function (c) { fade('dim-' + c, c === code ? .72 : 0); });
    }

    function unlock(on) {
      if (on === live) return;
      live = on;
      GESTURES.forEach(function (g) { map[g][on ? 'enable' : 'disable'](); });
      if (on) map.addControl(nav, 'top-right'); else map.removeControl(nav);
      if (!on) hover(null);
    }

    function go(i) {
      if (i === current) return;
      current = i;
      steps.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
      tags.forEach(function (list) {
        list.forEach(function (el) { el.classList.remove('is-shown'); });
      });
      var st = STEPS[i];
      setView(st.live ? chosen : st.view, st.hatch);
      focus(st.focus || null);
      unlock(!!st.live);

      // Place tags wait for the camera to land. A new flight ends the old
      // one with its own moveend, so the listener goes on after it starts.
      function land() {
        if (current === i) tags[i].forEach(function (el) { el.classList.add('is-shown'); });
      }
      var to = st.bounds ? map.cameraForBounds(st.bounds, { padding: 24 }) : { center: st.center, zoom: st.zoom };
      if (reduce.matches) {
        map.jumpTo(to);
        land();
      } else {
        map.flyTo(Object.assign({ duration: 2200, curve: 1, easing: ease, essential: true }, to));
        map.once('moveend', land);
      }
    }

    function pick() {
      var line = window.innerHeight * (narrow.matches ? .78 : .55);
      var i = 0;
      steps.forEach(function (s, k) { if (s.getBoundingClientRect().top < line) i = k; });
      go(i);
    }

    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; pick(); });
    }, { passive: true });
    window.addEventListener('resize', pick);

    // ---- Live panel ----

    function unpick() {
      if (picked !== null) map.setFeatureState({ source: 'blocks', id: picked }, { picked: false });
      picked = null;
    }

    function openBlock(f) {
      unpick();
      picked = f.id;
      map.setFeatureState({ source: 'blocks', id: f.id }, { picked: true });
      blockPane.innerHTML = blockHtml(f.properties, places);
      cityPane.hidden = true;
      blockPane.hidden = false;
    }

    function closeBlock() {
      if (blockPane.hidden) return;
      unpick();
      blockPane.hidden = true;
      cityPane.hidden = false;
    }

    function hover(f, point) {
      if (hovered !== null) map.setFeatureState({ source: 'blocks', id: hovered }, { hover: false });
      hovered = f ? f.id : null;
      if (f) {
        map.setFeatureState({ source: 'blocks', id: f.id }, { hover: true });
        tip.innerHTML = tipHtml(f.properties);
        tip.hidden = false;
        place(tip, stage, point);
      } else {
        tip.hidden = true;
      }
    }

    map.on('mousemove', 'turf', function (e) {
      if (!live) return;
      map.getCanvas().style.cursor = 'pointer';
      hover(e.features[0], e.point);
    });
    map.on('mouseleave', 'turf', function () {
      map.getCanvas().style.cursor = '';
      hover(null);
    });
    map.on('click', function (e) {
      if (!live) return;
      var f = map.queryRenderedFeatures(e.point, { layers: ['turf'] })[0] || null;
      if (f) openBlock(f);
      if (narrow.matches) hover(f, e.point); else hover(null);
    });
    map.on('movestart', function () { if (!tip.hidden) hover(null); });

    group.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      chosen = btn.getAttribute('data-view');
      [].forEach.call(group.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      if (live) setView(chosen, true);
    });

    document.getElementById('find').addEventListener('click', function (e) {
      if (e.target.closest('[data-back]')) return closeBlock();
      var chip = e.target.closest('[data-sample]');
      if (!chip) return;
      var at = SAMPLES[+chip.getAttribute('data-sample')];
      map.flyTo({ center: at, zoom: 15.4, duration: reduce.matches ? 0 : 1800, curve: 1.2, easing: ease });
      map.once('moveend', function () {
        var f = map.queryRenderedFeatures(map.project(at), { layers: ['turf'] })[0];
        if (f) openBlock(f);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeBlock();
    });

    GESTURES.forEach(function (g) { map[g].disable(); });
    pick();
  }

  // ---- Start --------------------------------------------------------

  function start() {
    var message = document.getElementById('map-message');

    if (!window.maplibregl) {
      message.textContent = 'The map library did not load. The story beside it states the same findings.';
      return;
    }

    var blocks = CT.load('blocks.json');
    var city = CT.load('city.json');

    city.then(function (c) { return basemap(c.outline); }).then(function (style) {
      var map;
      try {
        map = new maplibregl.Map({
          container: 'map', style: style, bounds: NYC, maxBounds: MAX_BOUNDS,
          fitBoundsOptions: { padding: 24 },
          minZoom: 9, maxZoom: 17,
          dragRotate: false, pitchWithRotate: false, attributionControl: false,

          // Keeps tiles from earlier steps, so a flight back out shows them
          // while the new ones load instead of blank ground.
          maxTileCacheSize: 600
        });
      } catch (err) {
        message.textContent = 'This browser could not draw the map. The story beside it states the same findings.';
        return;
      }
      map.touchZoomRotate.disableRotation();
      document.getElementById('stage').insertAdjacentHTML('beforeend', '<div class="map-attrib">' + ATTRIBUTION + '</div>');

      return Promise.all([
        blocks, city,
        new Promise(function (resolve) { map.on('load', resolve); })
      ]).then(function (res) {
        addLayers(map, decode(res[0]), res[1]);
        addNames(map);
        story(map, res[0].places || []);
        map.once('idle', function () { message.remove(); });
      });
    }).catch(function (err) {
      message.textContent = err.message;
    });
  }

  document.addEventListener('DOMContentLoaded', start);
})();
