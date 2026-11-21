// ==UserScript==
// @name         GeoFS Exterior Lights
// @namespace    https://github.com/
// @version      1.0.1
// @description  Nav, beacon, strobe, landing, taxi, runway turnoff, ice, logo and emergency-exit lights for GeoFS, each switchable. F7 = panel, keys 1-9 = toggle.
// @author       you
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* =============================================================================
 * GeoFS External Lights  —  nav / beacon / strobe / landing / taxi / turnoff /
 *                          ice / logo / emergency-exit lights, all switchable
 * -----------------------------------------------------------------------------
 * Version 1.0.0  ·  single-file add-on for GeoFS (https://www.geo-fs.com)
 *
 * Install: Tampermonkey (use geofs-lights.user.js), or paste this file in the
 *          browser console on the GeoFS page, or use the bookmarklet.
 * Open:    the LIGHTS button in GeoFS's bottom toolbar, or press F7.
 *
 * How it works
 *   - The light points are Cesium PointPrimitives added to GeoFS's own viewer,
 *     positioned relative to the aircraft every frame (lat/lon from
 *     geofs.aircraft.instance.llaLocation, heading from the animation values).
 *   - Each switch toggles a light group; the state is saved in localStorage and
 *     re-applied when the sim (re)loads or the aircraft changes.
 *   - Land/retract logic: landing, taxi, turnoff and logo lights go out when the
 *     gear is up (per GeoFS's gear state), so they do not float in the air.
 *   - Strobe flashes and beacon rotates, like the real thing.
 *
 * Nothing here writes to the flight model: it only reads the sim and draws.
 * ============================================================================= */

(function () {
  'use strict';

  if (window.GeoFSLights && window.GeoFSLights.version) {
    console.log('[GeoFS Lights] already loaded, v' + window.GeoFSLights.version);
    return;
  }

  var VERSION = '1.0.1';
  var STORE_KEY = 'geofs.lights.state.v1';
  var TICK_MS = 60;                    // ~16 fps update, cheap
  var M_PER_DEG_LAT = 111320;

  // --- light definitions -------------------------------------------------------
  // Every light is placed in aircraft body axes:
  //   fwd  = metres ahead of the reference point (negative = behind)
  //   side = metres to the right (+ = right wing, - = left wing)
  //   up   = metres above the reference point (negative = below, e.g. gear)
  // Positions are generic airliner/C172-ish; they scale with the aircraft size
  // (see scaleFor) so they sit sensibly on a Cessna and on an A380 alike.
  //
  // group:  which switch drives it
  // mode:   'steady' | 'flash' | 'rotate'
  var LIGHTS = [
    // --- NAVIGATION: red left, green right, white tail, steady -----------------
    { id: 'nav-left',    group: 'nav',   mode: 'steady', color: [255, 30, 30],  size: 7, fwd: 0.2,  side: -1.00, up: 0.05, label: 'Nav — left wing (red)' },
    { id: 'nav-right',   group: 'nav',   mode: 'steady', color: [20, 255, 60],  size: 7, fwd: 0.2,  side:  1.00, up: 0.05, label: 'Nav — right wing (green)' },
    { id: 'nav-tail',    group: 'nav',   mode: 'steady', color: [255, 255, 235], size: 6, fwd: -1.05, side: 0.00, up: 0.20, label: 'Nav — tail (white)' },

    // --- BEACON: red anti-collision, upper + lower fuselage, rotating flash ----
    { id: 'beacon-top',  group: 'beacon', mode: 'rotate', color: [255, 40, 40], size: 13, fwd: 0.05, side: 0, up: 0.42, label: 'Beacon — upper fuselage' },
    { id: 'beacon-bot',  group: 'beacon', mode: 'rotate', color: [255, 40, 40], size: 11, fwd: 0.05, side: 0, up: -0.28, label: 'Beacon — lower fuselage' },

    // --- STROBE: brilliant white, wingtips + tail, double flash ----------------
    { id: 'strobe-left',  group: 'strobe', mode: 'flash', color: [255, 255, 255], size: 16, fwd: 0.15, side: -1.02, up: 0.05, label: 'Strobe — left wingtip' },
    { id: 'strobe-right', group: 'strobe', mode: 'flash', color: [255, 255, 255], size: 16, fwd: 0.15, side:  1.02, up: 0.05, label: 'Strobe — right wingtip' },
    { id: 'strobe-tail',  group: 'strobe', mode: 'flash', color: [255, 255, 255], size: 13, fwd: -1.08, side: 0.00, up: 0.20, label: 'Strobe — tail' },

    // --- LANDING: nose gear + wing root, far throw, steady ---------------------
    { id: 'land-nose',   group: 'landing', mode: 'steady', color: [255, 250, 225], size: 20, fwd: 0.55, side: 0.00, up: -0.30, beam: 1, gear: true, label: 'Landing — nose gear' },
    { id: 'land-left',   group: 'landing', mode: 'steady', color: [255, 250, 225], size: 18, fwd: 0.30, side: -0.42, up: -0.22, beam: 1, gear: true, label: 'Landing — left wing root' },
    { id: 'land-right',  group: 'landing', mode: 'steady', color: [255, 250, 225], size: 18, fwd: 0.30, side: 0.42, up: -0.22, beam: 1, gear: true, label: 'Landing — right wing root' },

    // --- TAXI: nose gear, wide and soft, steady --------------------------------
    { id: 'taxi',        group: 'taxi',  mode: 'steady', color: [255, 240, 200], size: 13, fwd: 0.52, side: 0.00, up: -0.32, beam: 1, gear: true, label: 'Taxi — nose gear' },

    // --- RUNWAY TURNOFF: angled off the nose gear, forward-outboard ------------
    { id: 'turnoff-left',  group: 'turnoff', mode: 'steady', color: [255, 245, 215], size: 11, fwd: 0.50, side: -0.28, up: -0.30, beam: 1, yaw: -55, gear: true, label: 'Runway turnoff — left' },
    { id: 'turnoff-right', group: 'turnoff', mode: 'steady', color: [255, 245, 215], size: 11, fwd: 0.50, side: 0.28, up: -0.30, beam: 1, yaw: 55, gear: true, label: 'Runway turnoff — right' },

    // --- ICE: wing leading edges, warm white, steady ---------------------------
    { id: 'ice-left',    group: 'ice',   mode: 'steady', color: [255, 235, 180], size: 8, fwd: 0.12, side: -0.55, up: 0.02, label: 'Ice — left wing root' },
    { id: 'ice-right',   group: 'ice',   mode: 'steady', color: [255, 235, 180], size: 8, fwd: 0.12, side: 0.55, up: 0.02, label: 'Ice — right wing root' },

    // --- LOGO: on the tail, lighting the fin ------------------------------------
    { id: 'logo-left',   group: 'logo',  mode: 'steady', color: [255, 245, 220], size: 9, fwd: -0.95, side: -0.10, up: 0.30, gear: true, label: 'Logo — tail left' },
    { id: 'logo-right',  group: 'logo',  mode: 'steady', color: [255, 245, 220], size: 9, fwd: -0.95, side: 0.10, up: 0.30, gear: true, label: 'Logo — tail right' },

    // --- EMERGENCY EXIT: green over-wing escape path lights --------------------
    { id: 'exit-left-1',  group: 'exit', mode: 'steady', color: [40, 255, 120], size: 6, fwd: 0.05, side: -0.30, up: -0.10, label: 'Emergency exit — left 1' },
    { id: 'exit-left-2',  group: 'exit', mode: 'steady', color: [40, 255, 120], size: 6, fwd: -0.20, side: -0.30, up: -0.10, label: 'Emergency exit — left 2' },
    { id: 'exit-right-1', group: 'exit', mode: 'steady', color: [40, 255, 120], size: 6, fwd: 0.05, side: 0.30, up: -0.10, label: 'Emergency exit — right 1' },
    { id: 'exit-right-2', group: 'exit', mode: 'steady', color: [40, 255, 120], size: 6, fwd: -0.20, side: 0.30, up: -0.10, label: 'Emergency exit — right 2' }
  ];

  // The switches, in the order they appear in the panel.
  var GROUPS = [
    { id: 'nav',     name: 'Nav lights',            hint: 'red / green / white, steady',   key: '1' },
    { id: 'beacon',  name: 'Beacon lights',         hint: 'red, flashing on the fuselage', key: '2' },
    { id: 'strobe',  name: 'Strobe lights',         hint: 'white double-flash, wingtips',  key: '3' },
    { id: 'landing', name: 'Landing lights',        hint: 'gear down only',                key: '4' },
    { id: 'taxi',    name: 'Taxi light',            hint: 'nose gear, gear down only',     key: '5' },
    { id: 'turnoff', name: 'Runway turnoff lights', hint: 'angled off the nose gear',      key: '6' },
    { id: 'ice',     name: 'Ice lights',            hint: 'wing leading edges',            key: '7' },
    { id: 'logo',    name: 'Logo lights',           hint: 'tail fin, gear down only',      key: '8' },
    { id: 'exit',    name: 'Emergency exit lights', hint: 'green escape path lights',      key: '9' }
  ];

  var DEFAULTS = { nav: true, beacon: true, strobe: false, landing: false, taxi: false, turnoff: false, ice: false, logo: false, exit: false };

  // --- state -------------------------------------------------------------------
  var state = loadState();
  var runtime = {
    collection: null,
    points: {},          // id -> PointPrimitive
    aircraftId: null,
    scale: 1,
    gearDown: true,
    panelOpen: false,
    visible: 0,
    built: false
  };

  function loadState() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { s = {}; }
    GROUPS.forEach(function (grp) { if (typeof s[grp.id] !== 'boolean') s[grp.id] = DEFAULTS[grp.id]; });
    return s;
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // --- helpers -----------------------------------------------------------------
  function g() { return window.geofs; }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function isPaused() {
    try {
      var G = g();
      if (!G) return false;
      if (typeof G.isPaused === 'function') return !!G.isPaused();
      return !!G.pause;
    } catch (e) { return false; }
  }

  // GeoFS 3.x keeps the gear state in geofs.animation.values.gearPosition (0 = up,
  // 1 = down on most aircraft). If the field is missing we assume "down" so the
  // lights still work on aircraft that do not model gear.
  function readGear() {
    try {
      var v = g() && g().animation && g().animation.values;
      if (!v) return true;
      var gp = num(v.gearPosition);
      if (gp != null) return gp > 0.15;
      if (typeof v.gearDown === 'boolean') return v.gearDown;
      return true;
    } catch (e) { return true; }
  }

  // Position + heading of the aircraft, in the form we need.
  function readPose() {
    try {
      var I = g() && g().aircraft && g().aircraft.instance;
      if (!I) return null;
      var lla = I.llaLocation || I.lastLlaLocation;
      if (!lla || lla.length < 2) return null;
      var v = (g().animation && g().animation.values) || {};
      var hdg = num(v.heading360);
      if (hdg == null) hdg = num(v.heading);
      if (hdg == null) hdg = 0;
      return {
        lat: lla[0], lon: lla[1], alt: num(lla[2]) || 0,
        heading: hdg * Math.PI / 180,
        pitch: (num(v.atilt) || 0) * Math.PI / 180,
        roll: (num(v.aroll) || 0) * Math.PI / 180,
        id: I.id
      };
    } catch (e) { return null; }
  }

  // --- the Cesium layer ---------------------------------------------------------
  function getViewer() {
    try {
      var G = g();
      return (G && G.api && G.api.viewer) || null;
    } catch (e) { return null; }
  }

  function ensureCollection() {
    var viewer = getViewer();
    if (!viewer) return null;
    if (runtime.collection && runtime.collection._owner === viewer) return runtime.collection;
    if (runtime.collection) destroyCollection();
    try {
      var C = window.Cesium;
      var coll = new C.PointPrimitiveCollection();
      viewer.scene.primitives.add(coll);
      coll._owner = viewer;
      runtime.collection = coll;
      runtime.points = {};
      return coll;
    } catch (e) {
      console.warn('[GeoFS Lights] cannot create the light layer', e);
      return null;
    }
  }

  function destroyCollection() {
    try {
      if (runtime.collection) {
        runtime.collection.removeAll();
        var v = runtime.collection._owner;
        if (v && v.scene && v.scene.primitives) v.scene.primitives.remove(runtime.collection);
      }
    } catch (e) {}
    runtime.collection = null;
    runtime.points = {};
  }

  // How big is this aircraft? Uses the mass of the model if available, else a
  // middle-of-the-road scale, and keeps it in a sane range.
  function computeScale() {
    try {
      var I = g().aircraft.instance;
      var m = num(I && I.definition && I.definition.mass);
      if (m != null && m > 0) {
        // 1000 kg ultralight -> ~0.6, 60 000 kg airliner -> ~1.6
        return clamp(0.45 + Math.sqrt(m) / 170, 0.55, 1.8);
      }
    } catch (e) {}
    return 1;
  }

  // Turn the body-axis position of a light into lat/lon/height.
  // Aircraft axes: fwd along the nose, side to the right, up to the sky.
  // The extra `yaw` (degrees) aims a lamp outward, e.g. runway turnoff lights.
  function placeLight(pose, def, scale) {
    var fwd = def.fwd * scale * 12;      // ~12 m nose-to-tail reference
    var side = def.side * scale * 12;    // ~12 m half-span reference
    var up = def.up * scale * 6;

    // yaw the lamp direction in the horizontal plane (for angled lamps)
    if (def.yaw) {
      var y = def.yaw * Math.PI / 180;
      var f = fwd, s = side;
      fwd = f * Math.cos(y) - s * Math.sin(y);
      side = f * Math.sin(y) + s * Math.cos(y);
    }

    // body -> world (heading), pitch and roll are small enough to ignore for the
    // couple of metres involved; heading is what matters for the wingtips.
    // Screen convention: heading 0 = north, 90 = east. A right-hand-side point is
    // east of the aircraft when heading 0, south when heading 90, and so on:
    //   east  = fwd*sin(h) + side*cos(h)
    //   north = fwd*cos(h) - side*sin(h)
    var ch = Math.cos(pose.heading), sh = Math.sin(pose.heading);
    var east = fwd * sh + side * ch;
    var north = fwd * ch - side * sh;

    var dLat = north / M_PER_DEG_LAT;
    var dLon = east / (M_PER_DEG_LAT * Math.max(0.2, Math.cos(pose.lat * Math.PI / 180)));

    return {
      lat: pose.lat + dLat,
      lon: pose.lon + dLon,
      height: pose.alt + up
    };
  }

  function colorOf(def, alpha) {
    var C = window.Cesium;
    return new C.Color(def.color[0] / 255, def.color[1] / 255, def.color[2] / 255, alpha);
  }

  function addPoint(def) {
    var C = window.Cesium;
    var coll = runtime.collection;
    if (!C || !coll) return null;
    var p = coll.add({
      position: C.Cartesian3.fromDegrees(0, 0, 0),
      pixelSize: def.size,
      color: colorOf(def, 1),
      outlineColor: colorOf(def, 0.35),
      outlineWidth: Math.max(2, def.size * 0.5),
      show: false,
      disableDepthTestDistance: def.beam ? Number.POSITIVE_INFINITY : 0,
      scaleByDistance: new C.NearFarScalar(50, 1.0, 30000, 0.35)
    });
    return p;
  }

  function rebuild() {
    destroyCollection();
    if (!ensureCollection()) return;
    LIGHTS.forEach(function (def) {
      runtime.points[def.id] = addPoint(def);
    });
    runtime.built = true;
  }

  // --- the per-frame update -----------------------------------------------------
  var flashClock = 0;

  function update(dt) {
    var pose = readPose();
    if (!pose) return;

    if (pose.id !== runtime.aircraftId) {
      runtime.aircraftId = pose.id;
      runtime.scale = computeScale();
    }

    var coll = ensureCollection();
    if (!coll) return;
    if (!runtime.built || Object.keys(runtime.points).length !== LIGHTS.length) rebuild();

    runtime.gearDown = readGear();
    flashClock += dt;

    // strobe pattern: two quick flashes then a pause, ~1 Hz (like real strobes)
    var phase = flashClock % 1.1;
    var strobeOn = phase < 0.12 || (phase > 0.22 && phase < 0.34);
    // beacon: rotating/flashing every ~0.9 s
    var beaconOn = (flashClock % 0.9) < 0.3;

    var C = window.Cesium;
    var visibleCount = 0;

    for (var i = 0; i < LIGHTS.length; i++) {
      var def = LIGHTS[i];
      var p = runtime.points[def.id];
      if (!p) continue;

      var groupOn = !!state[def.group];
      var on = groupOn;
      if (on && def.gear && !runtime.gearDown) on = false;
      if (on && def.mode === 'flash') on = strobeOn;
      if (on && def.mode === 'rotate') on = beaconOn;

      if (!on) {
        if (p.show) p.show = false;
        continue;
      }

      var pos = placeLight(pose, def, runtime.scale);
      p.position = C.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.height);
      if (!p.show) p.show = true;
      visibleCount++;
    }
    runtime.visible = visibleCount;
  }

  // --- UI -----------------------------------------------------------------------
  var el = {};

  var CSS = [
    // the panel is a fixed overlay so it is visible whether or not it sits in a GeoFS panel
    '#gfl-panel{position:fixed!important;left:14px!important;top:80px!important;z-index:99999!important;' +
      'width:310px;max-height:calc(100vh - 120px);overflow:auto;display:none;' +
      'background:rgba(16,20,26,.96)!important;border:1px solid rgba(255,255,255,.12);border-radius:8px;' +
      'padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);font-family:Roboto,Arial,sans-serif;color:#e9eef5;font-size:13px}',
    '#gfl-panel.gfl-open{display:block!important}',
    '#gfl-panel h3{margin:0 0 2px;font-size:15px;font-weight:500;color:#fff}',
    '#gfl-panel h3 small{opacity:.5;font-weight:400;font-size:11px}',
    '#gfl-panel .gfl-sub{opacity:.55;font-size:11px;margin-bottom:10px}',
    '#gfl-panel .gfl-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07)}',
    '#gfl-panel .gfl-name{font-size:13px}',
    '#gfl-panel .gfl-hint{display:block;opacity:.45;font-size:10px;margin-top:1px}',
    '#gfl-panel .gfl-key{opacity:.35;font-size:10px;border:1px solid rgba(255,255,255,.25);border-radius:3px;padding:0 4px;margin-left:6px}',
    '#gfl-panel .gfl-btn{background:#39424e;color:#fff;border:0;border-radius:4px;padding:5px 10px;font-size:11px;cursor:pointer;min-width:52px;letter-spacing:.5px}',
    '#gfl-panel .gfl-btn.on{background:#26b36b}',
    '#gfl-panel .gfl-btn:hover{filter:brightness(1.15)}',
    '#gfl-panel .gfl-foot{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}',
    '#gfl-panel .gfl-foot button{background:#2d6cdf;color:#fff;border:0;border-radius:4px;padding:5px 9px;font-size:11px;cursor:pointer}',
    '#gfl-panel .gfl-foot button.ghost{background:#39424e}',
    '#gfl-panel .gfl-status{opacity:.6;font-size:11px;margin-top:8px;min-height:14px}',
    '#gfl-button{font-size:11px;font-weight:600;letter-spacing:.5px}',
    '#gfl-button.gfl-any-on{color:#8dffbe}',
    '#gfl-button.gfl-active{color:#8dffbe;box-shadow:inset 0 -2px 0 #26b36b}'
  ].join('');

  function injectCss() {
    if (document.getElementById('gfl-css')) return;
    var st = document.createElement('style');
    st.id = 'gfl-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function buildUi() {
    // Always a body-level overlay: hosting the panel inside GeoFS's own left menu made it
    // invisible when that menu was closed, which looked like "the tab does not open".
    var panel = document.createElement('div');
    panel.id = 'gfl-panel';
    panel.setAttribute('data-noblur', 'true');

    var rows = GROUPS.map(function (grp) {
      return '<div class="gfl-row">' +
        '<div><span class="gfl-name">' + grp.name + '<span class="gfl-key">' + grp.key + '</span></span>' +
        '<span class="gfl-hint">' + grp.hint + '</span></div>' +
        '<button class="gfl-btn" data-group="' + grp.id + '">OFF</button>' +
        '</div>';
    }).join('');

    panel.innerHTML =
      '<h3>Exterior Lights <small>v' + VERSION + '</small></h3>' +
      '<div class="gfl-sub">Keys 1–9 toggle a group · F7 opens this panel</div>' +
      rows +
      '<div class="gfl-foot">' +
      '<button id="gfl-all">All on</button>' +
      '<button id="gfl-none" class="ghost">All off</button>' +
      '<button id="gfl-cold" class="ghost">Cold &amp; dark</button>' +
      '<button id="gfl-takeoff" class="ghost">Takeoff set</button>' +
      '</div>' +
      '<div class="gfl-status" id="gfl-status"></div>';

    document.body.appendChild(panel);

    panel.querySelectorAll('.gfl-btn').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        toggle(b.getAttribute('data-group'));
      });
    });
    panel.querySelector('#gfl-all').addEventListener('click', function () { setAll(true); });
    panel.querySelector('#gfl-none').addEventListener('click', function () { setAll(false); });
    panel.querySelector('#gfl-cold').addEventListener('click', function () { preset('cold'); });
    panel.querySelector('#gfl-takeoff').addEventListener('click', function () { preset('takeoff'); });

    // toolbar button, next to GeoFS's own buttons
    addButton();

    el.panel = panel;
    el.status = panel.querySelector('#gfl-status');
    el.button = document.getElementById('gfl-button');
    el.buttons = {};
    GROUPS.forEach(function (grp) {
      el.buttons[grp.id] = panel.querySelector('.gfl-btn[data-group="' + grp.id + '"]');
    });
  }

  function addButton() {
    if (document.getElementById('gfl-button')) return;
    var bar = document.querySelector('.geofs-ui-bottom') || document.querySelector('.geofs-ui-left');
    if (!bar) return;
    var btn = document.createElement('button');
    btn.id = 'gfl-button';
    btn.type = 'button';
    btn.title = 'Exterior lights (F7)';
    btn.className = 'mdl-button mdl-js-button geofs-f-standard-ui';
    btn.textContent = 'LIGHTS';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });
    bar.appendChild(btn);
  }

  function refreshUi() {
    if (!el.buttons) return;
    var any = false;
    GROUPS.forEach(function (grp) {
      var on = !!state[grp.id];
      if (on) any = true;
      var b = el.buttons[grp.id];
      if (!b) return;
      b.textContent = on ? 'ON' : 'OFF';
      b.className = 'gfl-btn' + (on ? ' on' : '');
    });
    if (el.button) el.button.className = 'mdl-button mdl-js-button geofs-f-standard-ui' + (any ? ' gfl-any-on' : '');
    if (el.status) {
      el.status.textContent = runtime.visible + ' light' + (runtime.visible === 1 ? '' : 's') + ' showing' +
        (runtime.gearDown ? '' : ' · gear up: landing/taxi/turnoff/logo hidden');
    }
  }

  function togglePanel(force) {
    runtime.panelOpen = force == null ? !runtime.panelOpen : !!force;
    if (el.panel) {
      el.panel.style.display = runtime.panelOpen ? 'block' : 'none';
      el.panel.classList.toggle('gfl-open', runtime.panelOpen);
    }
    if (el.button) el.button.classList.toggle('gfl-active', runtime.panelOpen);
    if (runtime.panelOpen) refreshUi();
  }

  // --- switch actions -----------------------------------------------------------
  function toggle(groupId) {
    if (!(groupId in state)) return;
    state[groupId] = !state[groupId];
    afterChange();
  }
  function setAll(on) {
    GROUPS.forEach(function (grp) { state[grp.id] = !!on; });
    afterChange();
  }
  function preset(name) {
    if (name === 'cold') {
      setAll(false);
    } else if (name === 'takeoff') {
      state.nav = true; state.beacon = true; state.strobe = true;
      state.landing = true; state.taxi = false; state.turnoff = true;
      state.ice = state.ice; state.logo = false; state.exit = false;
      afterChange();
    }
  }
  function afterChange() {
    saveState();
    refreshUi();
    // apply right away so a single click is visible without waiting for the tick
    update(0);
  }

  // --- keys ---------------------------------------------------------------------
  function onKey(e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'F7') { e.preventDefault(); togglePanel(); return; }

    // 1-9 toggle the light groups
    for (var i = 0; i < GROUPS.length; i++) {
      if (e.key === GROUPS[i].key) {
        e.preventDefault();
        toggle(GROUPS[i].id);
        return;
      }
    }
  }

  // --- boot ---------------------------------------------------------------------
  var last = 0;
  function loop() {
    var now = Date.now();
    var dt = last ? Math.min(0.25, (now - last) / 1000) : 0.06;
    last = now;
    try {
      if (!isPaused()) update(dt);
    } catch (err) {
      console.warn('[GeoFS Lights] update error', err);
    }
    if (runtime.panelOpen) refreshUi();
  }

  function boot() {
    injectCss();
    buildUi();
    refreshUi();
    rebuild();
    document.addEventListener('keydown', onKey);
    setInterval(loop, TICK_MS);
    // the toolbar can be re-rendered by GeoFS: put the LIGHTS button back if it goes away
    setInterval(function () {
      if (!document.getElementById('gfl-button')) addButton();
    }, 2000);
    console.log('%c[GeoFS Lights] v' + VERSION + ' ready — F7 panel, keys 1-9 toggle',
      'color:#26b36b;font-weight:bold');
  }

  function waitForGeofs() {
    var tries = 0;
    (function poll() {
      var G = g();
      var ready = G && G.api && G.api.viewer && G.aircraft && G.aircraft.instance;
      if (ready) return boot();
      if (++tries > 240) {
        console.warn('[GeoFS Lights] GeoFS not found — is this the GeoFS page? UI loaded anyway.');
        return boot();
      }
      setTimeout(poll, 500);
    })();
  }

  // public surface (console, other add-ons)
  window.GeoFSLights = {
    version: VERSION,
    toggle: toggle,
    on: function (id) { if (id in state) { state[id] = true; afterChange(); } },
    off: function (id) { if (id in state) { state[id] = false; afterChange(); } },
    all: setAll,
    preset: preset,
    togglePanel: togglePanel,
    state: function () { return Object.assign({}, state); },
    lights: LIGHTS.map(function (l) { return { id: l.id, group: l.group, label: l.label }; })
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForGeofs);
  } else {
    waitForGeofs();
  }
})();
