(function () {
  'use strict';
  var D = window.FLIGHT_DATA;
  var root = document.getElementById('flights');
  if (!D || !root) return;

  var canvas = root.querySelector('canvas');
  var ctx = canvas.getContext('2d');
  var box = root.querySelector('.fl-map');
  var capEl = root.querySelector('.fl-cap');
  var playBtn = root.querySelector('.fl-play');
  var speedBtn = root.querySelector('.fl-speed');
  var rangeEl = root.querySelector('.fl-range');

  var GOLD = '232,196,106';
  var LON0 = 10, LAT_MAX = 83, LAT_MIN = -57;
  var DWELL = 0.34, HOLD_END = 2.2, FADE_OUT = 1.0;
  var KM_TO_MI = 0.621371;

  // ---------- projection (Miller cylindrical, centered on lon0) ----------
  function miller(lat) { return 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * Math.PI / 180)); }
  var Y0 = miller(LAT_MAX), Y1 = miller(LAT_MIN);
  var ASPECT = (Y0 - Y1) / (2 * Math.PI);
  function uOf(lon) { var x = (lon - LON0) / 360 + 0.5; return x - Math.floor(x); }
  function vOf(lat) { return (Y0 - miller(lat)) / (Y0 - Y1); }
  function nearest(u, prev) { while (u - prev > 0.5) u -= 1; while (prev - u > 0.5) u += 1; return u; }

  // ---------- data ----------
  var airports = {};
  Object.keys(D.airports).forEach(function (k) {
    var a = D.airports[k];
    airports[k] = { code: k, city: a[0], cc: a[1], lat: a[2], lon: a[3], u: uOf(a[3]), v: vOf(a[2]) };
  });

  function toRad(d) { return d * Math.PI / 180; }
  function vec(lat, lon) { var la = toRad(lat), lo = toRad(lon); return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; }
  function distKm(a, b) {
    var p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lon - a.lon), dp = p2 - p1;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function buildLeg(f) {
    var a = airports[f[1]], b = airports[f[2]];
    if (!a || !b) return null;
    var km = distKm(a, b);
    var n = Math.max(16, Math.ceil(km / 120));
    var va = vec(a.lat, a.lon), vb = vec(b.lat, b.lon);
    var dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    var om = Math.acos(dot), so = Math.sin(om);
    var pts = [], prevU = a.u;
    for (var k = 0; k <= n; k++) {
      var s = k / n, lat, lon;
      if (so < 1e-6) { lat = a.lat; lon = a.lon; }
      else {
        var A = Math.sin((1 - s) * om) / so, B = Math.sin(s * om) / so;
        var x = A * va[0] + B * vb[0], y = A * va[1] + B * vb[1], z = A * va[2] + B * vb[2];
        lat = Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI;
        lon = Math.atan2(y, x) * 180 / Math.PI;
      }
      var u = k === 0 ? a.u : nearest(uOf(lon), prevU);
      prevU = u;
      pts.push([u, vOf(lat)]);
    }
    return {
      date: f[0], from: a, to: b, km: km, pts: pts,
      dur: Math.min(1.5, 0.3 + 0.7 * km / 9000)
    };
  }

  var legs = D.flights.map(buildLeg).filter(Boolean);
  var N = legs.length;

  // ---------- stats ----------
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) { var p = d.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  var lastDate = legs[N - 1].date;
  var twoYearsAgo = (function () { var p = lastDate.split('-'); return (+p[0] - 2) + '-' + p[1] + '-' + p[2]; })();

  var RANGES = {
    all: function () { return true; },
    two: function (l) { return l.date >= twoYearsAgo; },
    y2026: function (l) { return l.date.slice(0, 4) === '2026'; },
    y2025: function (l) { return l.date.slice(0, 4) === '2025'; },
    y2024: function (l) { return l.date.slice(0, 4) === '2024'; }
  };

  function showStats(key) {
    var sub = legs.filter(RANGES[key] || RANGES.all);
    var ctry = {}, cities = {}, km = 0;
    sub.forEach(function (l) {
      ctry[l.from.cc] = 1; ctry[l.to.cc] = 1;
      cities[l.from.city] = 1; cities[l.to.city] = 1;
      km += l.km;
    });
    var vals = {
      flights: sub.length,
      countries: Object.keys(ctry).length,
      cities: Object.keys(cities).length,
      miles: Math.round(km * KM_TO_MI)
    };
    Object.keys(vals).forEach(function (k) {
      var el = root.querySelector('[data-stat="' + k + '"]');
      if (el) el.textContent = vals[k].toLocaleString('en-US');
    });
    if (rangeEl) rangeEl.textContent = sub.length ? fmtDate(sub[0].date) + ' – ' + fmtDate(sub[sub.length - 1].date) : '';
    root.querySelectorAll('.fl-tabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-range') === key ? 'true' : 'false');
    });
  }
  root.querySelectorAll('.fl-tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showStats(b.getAttribute('data-range')); });
  });
  showStats('all');

  // ---------- places list ----------
  (function () {
    var list = root.querySelector('.fl-list');
    if (!list) return;
    var byCountry = {};
    legs.forEach(function (l) {
      [l.from, l.to].forEach(function (a) {
        (byCountry[a.cc] = byCountry[a.cc] || {})[a.city] = 1;
      });
    });
    var codes = Object.keys(byCountry).sort(function (x, y) { return D.countries[x].localeCompare(D.countries[y]); });
    function flag(cc) { return String.fromCodePoint.apply(null, cc.split('').map(function (c) { return 127397 + c.charCodeAt(0); })); }
    codes.forEach(function (cc) {
      var row = document.createElement('p');
      var s = document.createElement('strong');
      s.textContent = flag(cc) + ' ' + D.countries[cc];
      var t = document.createElement('span');
      t.textContent = Object.keys(byCountry[cc]).sort().join(', ');
      row.appendChild(s); row.appendChild(t);
      list.appendChild(row);
    });
    var sum = root.querySelector('.fl-places summary');
    if (sum) sum.textContent = 'All places (' + codes.length + ' countries)';
  })();

  // ---------- basemap ----------
  var world = null, countries = []; // [{iso, rings:[[u,v,u,v...]]}]
  fetch('world.json').then(function (r) { return r.json(); }).then(function (j) {
    countries = j.c.map(function (c) {
      return {
        iso: c.i,
        rings: c.r.map(function (flat) {
          var out = [], pu = 0;
          for (var i = 0; i < flat.length; i += 2) {
            var u = uOf(flat[i]);
            if (i > 0) u = nearest(u, pu);
            pu = u;
            out.push(u, vOf(flat[i + 1]));
          }
          return out;
        })
      };
    });
    world = true;
    buildLayers();
  }).catch(function () { /* map still works without the basemap */ });

  // ---------- layers / sizing ----------
  var W = 0, H = 0, dpr = 1;
  var baseC = document.createElement('canvas'), tintC = document.createElement('canvas'), routeC = document.createElement('canvas');
  var baseX = baseC.getContext('2d'), tintX = tintC.getContext('2d'), routeX = routeC.getContext('2d');
  var countryPaths = {};

  function wraps(c, fn) {
    for (var o = -1; o <= 1; o++) { c.save(); c.translate(o * W, 0); fn(); c.restore(); }
  }
  function ringPath(r) {
    var p = new Path2D();
    for (var i = 0; i < r.length; i += 2) {
      if (i === 0) p.moveTo(r[0] * W, r[1] * H); else p.lineTo(r[i] * W, r[i + 1] * H);
    }
    p.closePath();
    return p;
  }
  function legPath(l) {
    var p = new Path2D(), pts = l.pts;
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) p.moveTo(pts[0][0] * W, pts[0][1] * H); else p.lineTo(pts[i][0] * W, pts[i][1] * H);
    }
    return p;
  }

  var visitedCountries = {}, visitedAirports = {}, doneLegs = 0;

  function paintTint(iso) {
    var paths = countryPaths[iso];
    if (!paths) return;
    tintX.fillStyle = 'rgba(' + GOLD + ',0.2)';
    tintX.strokeStyle = 'rgba(' + GOLD + ',0.45)';
    tintX.lineWidth = 0.7;
    wraps(tintX, function () { paths.forEach(function (p) { tintX.fill(p); tintX.stroke(p); }); });
  }
  function paintRoute(l) {
    routeX.strokeStyle = 'rgba(' + GOLD + ',0.4)';
    routeX.lineWidth = 1.1;
    routeX.lineJoin = 'round';
    var p = legPath(l);
    wraps(routeX, function () { routeX.stroke(p); });
  }

  function buildLayers() {
    if (!W) return;
    [baseC, tintC, routeC].forEach(function (c) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
    [baseX, tintX, routeX].forEach(function (c) { c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); });
    countryPaths = {};
    countries.forEach(function (c) { (countryPaths[c.iso] = countryPaths[c.iso] || []).push.apply(countryPaths[c.iso], c.rings.map(ringPath)); });
    baseX.fillStyle = 'rgba(255,255,255,0.075)';
    baseX.strokeStyle = 'rgba(255,255,255,0.16)';
    baseX.lineWidth = 0.6;
    wraps(baseX, function () {
      Object.keys(countryPaths).forEach(function (iso) {
        countryPaths[iso].forEach(function (p) { baseX.fill(p); baseX.stroke(p); });
      });
    });
    Object.keys(visitedCountries).forEach(paintTint);
    for (var i = 0; i < doneLegs; i++) paintRoute(legs[i]);
  }

  function resize() {
    var w = box.clientWidth;
    if (!w) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = w; H = Math.round(w * ASPECT);
    canvas.style.height = H + 'px';
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildLayers();
    render();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(box);
  window.addEventListener('resize', resize);

  // ---------- state machine ----------
  var st = { i: 0, phase: 'dwell', t: 0, place: legs[0].from, jumped: false, fade: 1 };
  var paused = false, speed = 1, visible = true, raf = 0, lastTs = 0;
  var SPEEDS = [1, 2, 4];

  function visitAirport(a) {
    visitedAirports[a.code] = 1;
    if (!visitedCountries[a.cc]) { visitedCountries[a.cc] = 1; paintTint(a.cc); }
  }
  function setCaption(l, idx) {
    if (!capEl) return;
    capEl.textContent = (idx + 1) + ' / ' + N + ' · ' + fmtDate(l.date) + ' · ' + l.from.city + ' → ' + l.to.city;
  }
  function resetLoop() {
    visitedCountries = {}; visitedAirports = {}; doneLegs = 0;
    [tintX, routeX].forEach(function (c) { c.clearRect(0, 0, W, H); });
    st = { i: 0, phase: 'dwell', t: 0, place: legs[0].from, jumped: false, fade: 1 };
    visitAirport(st.place);
  }

  function step(dt) {
    st.t += dt;
    if (st.phase === 'dwell') {
      if (st.t >= DWELL) {
        var next = legs[st.i];
        if (next.from.code !== st.place.code && !st.jumped) {
          st.place = next.from; st.jumped = true; st.t = 0; visitAirport(st.place);
          return;
        }
        st.jumped = false;
        st.phase = 'fly'; st.t = 0;
        setCaption(next, st.i);
      }
    } else if (st.phase === 'fly') {
      var l = legs[st.i];
      if (st.t >= l.dur) {
        paintRoute(l); doneLegs = st.i + 1;
        visitAirport(l.to);
        st.place = l.to; st.i++; st.t = 0;
        if (st.i >= N) st.phase = 'end'; else st.phase = 'dwell';
      }
    } else if (st.phase === 'end') {
      if (st.t >= HOLD_END) { st.phase = 'fade'; st.t = 0; }
    } else if (st.phase === 'fade') {
      st.fade = Math.max(0, 1 - st.t / FADE_OUT);
      if (st.t >= FADE_OUT) resetLoop();
    }
  }

  // ---------- drawing ----------
  var plane = (function () {
    var p = new Path2D();
    p.moveTo(9, 0); p.lineTo(3, -1.8); p.lineTo(0.5, -8); p.lineTo(-1.8, -8); p.lineTo(-1.2, -1.8);
    p.lineTo(-6, -1.3); p.lineTo(-7.5, -4); p.lineTo(-9, -4); p.lineTo(-8, 0);
    p.lineTo(-9, 4); p.lineTo(-7.5, 4); p.lineTo(-6, 1.3); p.lineTo(-1.2, 1.8);
    p.lineTo(-1.8, 8); p.lineTo(0.5, 8); p.lineTo(3, 1.8); p.closePath();
    return p;
  })();

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawLabel(a, alpha) {
    if (alpha <= 0.01) return;
    var fs = Math.max(11, Math.min(13, W / 55));
    ctx.font = '600 ' + fs + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    var tw = ctx.measureText(a.city).width, w = tw + 16, h = fs + 10;
    var ax = a.u * W, ay = a.v * H;
    var y = ay - 14 - h; if (y < 2) y = ay + 14;
    var x = Math.max(2, Math.min(W - w - 2, ax - w / 2));
    ctx.save();
    ctx.globalAlpha = alpha * st.fade;
    ctx.strokeStyle = 'rgba(' + GOLD + ',0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ax, ay, 4 + 5 * (1 - alpha), 0, 6.2832); ctx.stroke();
    ctx.fillStyle = 'rgba(8,14,32,0.92)'; roundRect(x, y, w, h, h / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(' + GOLD + ',0.8)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#f5e2a8'; ctx.textBaseline = 'middle'; ctx.fillText(a.city, x + 8, y + h / 2 + 0.5);
    ctx.restore();
  }

  function render() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(baseC, 0, 0, W, H);
    ctx.globalAlpha = st.fade;
    ctx.drawImage(tintC, 0, 0, W, H);
    ctx.drawImage(routeC, 0, 0, W, H);
    // airport dots
    ctx.fillStyle = 'rgba(' + GOLD + ',0.95)';
    Object.keys(visitedAirports).forEach(function (k) {
      var a = airports[k];
      ctx.beginPath(); ctx.arc(a.u * W, a.v * H, 2.1, 0, 6.2832); ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (st.phase === 'fly') {
      var l = legs[st.i], p = Math.min(1, st.t / l.dur);
      var e = 0.5 - 0.5 * Math.cos(Math.PI * p);
      var f = e * (l.pts.length - 1), i0 = Math.min(l.pts.length - 2, Math.floor(f)), fr = f - i0;
      var A = l.pts[i0], B = l.pts[i0 + 1];
      var cu = A[0] + (B[0] - A[0]) * fr, cv = A[1] + (B[1] - A[1]) * fr;
      // live trail
      var tp = new Path2D();
      tp.moveTo(l.pts[0][0] * W, l.pts[0][1] * H);
      for (var k = 1; k <= i0; k++) tp.lineTo(l.pts[k][0] * W, l.pts[k][1] * H);
      tp.lineTo(cu * W, cv * H);
      ctx.save();
      ctx.strokeStyle = 'rgba(' + GOLD + ',0.95)'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
      wraps(ctx, function () { ctx.stroke(tp); });
      ctx.restore();
      // plane
      var ang = Math.atan2((B[1] - A[1]) * H, (B[0] - A[0]) * W);
      var px = (((cu % 1) + 1) % 1) * W, py = cv * H, sc = Math.max(0.7, Math.min(1.1, W / 700));
      ctx.save();
      ctx.translate(px, py); ctx.rotate(ang); ctx.scale(sc, sc);
      ctx.shadowColor = 'rgba(' + GOLD + ',0.9)'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#fff6d8'; ctx.fill(plane);
      ctx.restore();
      // departure label fades out as the plane leaves
      drawLabel(l.from, 1 - Math.min(1, st.t / 0.22));
    } else if (st.phase === 'dwell') {
      drawLabel(st.place, Math.min(1, st.t / 0.14));
    } else if (st.phase === 'end') {
      drawLabel(st.place, 1);
    }
  }

  // ---------- loop / controls ----------
  function frame(ts) {
    raf = 0;
    if (paused || !visible) return;
    var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    var s = dt * speed, guard = 0;
    while (s > 0 && guard++ < 8) { var chunk = Math.min(s, 0.05); step(chunk); s -= chunk; }
    render();
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && !paused && visible) { lastTs = 0; raf = requestAnimationFrame(frame); } }

  function setPaused(p) {
    paused = p;
    if (playBtn) { playBtn.textContent = p ? 'Play' : 'Pause'; playBtn.setAttribute('aria-pressed', p ? 'true' : 'false'); }
    if (!p) kick();
  }
  if (playBtn) playBtn.addEventListener('click', function () { setPaused(!paused); });
  canvas.addEventListener('click', function () { setPaused(!paused); });
  if (speedBtn) speedBtn.addEventListener('click', function () {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    speedBtn.textContent = speed + '×';
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) kick(); }, { threshold: 0.05 }).observe(box);
  }

  // ---------- start ----------
  visitAirport(st.place);
  resize();
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    // static picture of everything; Play starts the animation from the top
    for (var q = 0; q < N; q++) { paintRoute(legs[q]); visitAirport(legs[q].to); visitAirport(legs[q].from); }
    doneLegs = N; st.phase = 'end'; st.i = N; st.place = legs[N - 1].to;
    if (capEl) capEl.textContent = N + ' flights';
    setPaused(true);
    var startOver = playBtn && playBtn.addEventListener('click', function once() {
      playBtn.removeEventListener('click', once);
      resetLoop();
    });
    render();
  } else {
    setCaption(legs[0], 0);
    kick();
  }
})();
