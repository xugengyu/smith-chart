/* ============================================
   smith.js — Interactive Smith Chart + circuit builder
   - Impedance / admittance grids, adjustable resolution
   - Load entry, series/shunt L·C·R matching network
   - Arm a component and place it by moving along the
     constrained constant-R / G / X / B circle
   ============================================ */

(function () {
  'use strict';

  // ---------- DOM ----------
  const wrap        = document.getElementById('chart-wrap');
  const gridCanvas  = document.getElementById('grid-canvas');
  const hoverCanvas = document.getElementById('hover-canvas');
  const gctx = gridCanvas.getContext('2d');
  const hctx = hoverCanvas.getContext('2d');

  const chkImped  = document.getElementById('opt-impedance');
  const chkAdmit  = document.getElementById('opt-admittance');
  const resSlider = document.getElementById('opt-resolution');
  const resLabel  = document.getElementById('resolution-label');
  const z0Input   = document.getElementById('opt-z0');
  const loadRIn   = document.getElementById('load-r');
  const loadXIn   = document.getElementById('load-x');
  const freqIn    = document.getElementById('freq');
  const freqUnit  = document.getElementById('freq-unit');
  const sparamFileIn = document.getElementById('sparam-file');
  const btnClearSparam = document.getElementById('btn-clear-sparam');
  const sparamFminIn = document.getElementById('sparam-fmin');
  const sparamFmaxIn = document.getElementById('sparam-fmax');
  const stubZcIn  = document.getElementById('stub-zc');
  const stubEeffIn= document.getElementById('stub-eeff');
  const armHint   = document.getElementById('arm-hint');
  const btnUndo   = document.getElementById('btn-undo');
  const btnReset  = document.getElementById('btn-reset');
  const schematic = document.getElementById('schematic');
  const zinEl     = document.getElementById('zin-summary');
  const chkQ      = document.getElementById('opt-q');
  const qValIn    = document.getElementById('opt-qval');
  const chkReadout= document.getElementById('opt-readout');
  const zcTip     = document.getElementById('zc-tip');
  const contextMenu = document.getElementById('smith-context-menu');
  const cmParams    = document.getElementById('cm-params');
  const btnCancel   = document.getElementById('btn-cancel');
  const compBtns  = Array.prototype.slice.call(document.querySelectorAll('.comp-btn'));

  const readout = {
    box:  document.getElementById('hover-readout'),
    z:    document.getElementById('rd-z'),
    zOhm: document.getElementById('rd-z-ohm'),
    y:    document.getElementById('rd-y'),
    yS:   document.getElementById('rd-y-siemens'),
    zRow: document.getElementById('row-z'),
    zRow2:document.getElementById('row-z-ohm'),
    zRow2:document.getElementById('row-z-ohm'),
    yRow: document.getElementById('row-y'),
    yRow2:document.getElementById('row-y-siemens'),
    fRow: document.getElementById('row-freq'),
    freq: document.getElementById('rd-freq'),
    gamma:document.getElementById('rd-gamma'),
    vswr: document.getElementById('rd-vswr'),
  };

  // ---------- Colours ----------
  const COL = {
    axis: '#333', outer: '#222',
    imped: '#c0392b', impedMinor: '#e8b4ad',
    admit: '#2166ac', admitMinor: '#aecbe5',
    crosshair: 'rgba(40,40,40,0.35)', vswr: 'rgba(180,80,20,0.5)',
    point: '#111', q: '#7c3aed',
    load: '#d97706', constraint: 'rgba(42,124,111,0.35)', preview: '#2A7C6F',
  };
  // Per-component colours: each component's trace arc, its ending node, and its
  // schematic symbol share one colour, cycling through this palette.
  const PALETTE = ['#0d9488', '#db2777', '#ca8a04', '#0891b2', '#65a30d', '#9d174d', '#4338ca', '#c2410c'];
  function colorFor(i) { return PALETTE[i % PALETTE.length]; }

  // ---------- Component definitions ----------
  // domain: which plane the element adds to (z=impedance, y=admittance)
  // part:   're' (R/G) or 'im' (X/B) ; dir: sign of the allowed change
  const COMPONENTS = {
    sL: { type: 'series', kind: 'L', domain: 'z', part: 'im', dir: +1, name: 'Series inductor' },
    sC: { type: 'series', kind: 'C', domain: 'z', part: 'im', dir: -1, name: 'Series capacitor' },
    sR: { type: 'series', kind: 'R', domain: 'z', part: 're', dir: +1, name: 'Series resistor' },
    pL: { type: 'shunt',  kind: 'L', domain: 'y', part: 'im', dir: -1, name: 'Shunt inductor' },
    pC: { type: 'shunt',  kind: 'C', domain: 'y', part: 'im', dir: +1, name: 'Shunt capacitor' },
    pR: { type: 'shunt',  kind: 'R', domain: 'y', part: 're', dir: +1, name: 'Shunt resistor' },
    // Transmission-line stubs — add susceptance like a reactive element,
    // but the value is realized by a line of impedance Zc and some length. dir:0 → move both ways.
    tpo: { type: 'shunt',  kind: 'TL', domain: 'y', part: 'im', dir: 0, stub: true, term: 'open',  name: 'Shunt open stub' },
    tps: { type: 'shunt',  kind: 'TL', domain: 'y', part: 'im', dir: 0, stub: true, term: 'short', name: 'Shunt short stub' },
    // Cascaded (through) series line — rotates Γ on a circle centred at (Zc−Z0)/(Zc+Z0)
    line:{ type: 'series', kind: 'TL', line: true, name: 'Series line (through)' },
  };
  const CONSTRAINT_NAME = {
    'z.im': 'constant-resistance', 'z.re': 'constant-reactance',
    'y.im': 'constant-conductance', 'y.re': 'constant-susceptance',
  };

  // ---------- Resolution presets ----------
  const RES_LEVELS = [
    [0.5, 1, 2],
    [0.2, 0.5, 1, 2, 5],
    [0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10],
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 3, 4, 5, 10, 20],
    [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
     1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 4, 5, 7, 10, 15, 20, 50],
  ];
  const RES_NAMES = ['Coarse', 'Standard', 'Fine', 'Finer', 'Dense'];
  const MAJOR = new Set([0.2, 0.5, 1, 2, 5]);

  // ---------- State ----------
  let load = { re: 0.5, im: -0.6 };   // normalized load impedance
  let sParamData = null;              // [{f, s11: {re, im}}]
  let sParamZ0 = 50;                  // reference impedance of the touchstone file
  let sParamTracePts = [];            // [{f, z, px, py}] cached trace points
  let comps = [];                     // [{ id, dv, theta, zc }]
  let armedId = null;                 // component id currently armed for placement
  let preview = null;                 // { id, dv, theta, zNew, sol, zc_val, zc, zcn }
  let dragging = null;                // null or { load:true } or { index:i }
  let lastMouse = null;               // {x,y} in canvas coords
  let lastClient = null;              // {x,y} screen coords for tooltip
  let traceHotIndex = -1;             // hovered trace index
  let qHoverIndex = -1;               // hovered Q circle index
  let qHotIndex = -1;                 // clicked/grabbed Q circle index
  let zoomScale = 1;
  let panX = 0, panY = 0;       // last mouse pos in client (page) coords
  let qHotTimer = null;              // dwell timer handle

  // ---------- SVG Context Mock ----------
  class SVGContext {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.elements = [];
      this.path = '';
      this.state = {
        strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, 
        lineDash: [], globalAlpha: 1, font: '10px sans-serif',
        textAlign: 'start', textBaseline: 'alphabetic', clipId: null
      };
      this.stack = [];
      this.clipCounter = 0;
    }
    save() { this.stack.push(Object.assign({}, this.state)); }
    restore() { this.state = this.stack.pop(); }
    beginPath() { this.path = ''; }
    moveTo(x, y) { this.path += `M ${x} ${y} `; }
    lineTo(x, y) { this.path += `L ${x} ${y} `; }
    arc(x, y, r, sa, ea) {
      if (Math.abs(ea - sa - 2*Math.PI) < 0.01) {
        this.path += `M ${x-r} ${y} a ${r} ${r} 0 1 0 ${2*r} 0 a ${r} ${r} 0 1 0 ${-2*r} 0 `;
      }
    }
    stroke() {
      if (!this.path) return;
      let attrs = `fill="none" stroke="${this.state.strokeStyle}" stroke-width="${this.state.lineWidth}" opacity="${this.state.globalAlpha}"`;
      if (this.state.lineDash.length) attrs += ` stroke-dasharray="${this.state.lineDash.join(',')}"`;
      if (this.state.clipId) attrs += ` clip-path="url(#${this.state.clipId})"`;
      this.elements.push(`<path d="${this.path}" ${attrs} />`);
    }
    fill() {
      if (!this.path) return;
      let attrs = `fill="${this.state.fillStyle}" opacity="${this.state.globalAlpha}"`;
      if (this.state.clipId) attrs += ` clip-path="url(#${this.state.clipId})"`;
      this.elements.push(`<path d="${this.path}" ${attrs} />`);
    }
    fillText(txt, x, y) {} // text omitted as requested
    clip() {
      this.clipCounter++;
      const id = 'clip-' + this.clipCounter;
      this.elements.push(`<clipPath id="${id}"><path d="${this.path}" /></clipPath>`);
      this.state.clipId = id;
    }
    setLineDash(dash) { this.state.lineDash = dash; }
    clearRect() {}
    
    toString() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}">
        <rect width="100%" height="100%" fill="#fff" />
        ${this.elements.join('\n')}
      </svg>`;
    }
  }

  // ---------- Geometry ----------
  let cx = 0, cy = 0, R = 0, dpr = 1;
  function gToC(gre, gim) { return [cx + gre * R, cy - gim * R]; }
  function cToG(px, py)   { return [(px - cx) / R, (cy - py) / R]; }

  // ---------- Complex helpers (all {re,im}) ----------
  function cAdd(a, b)  { return { re: a.re + b.re, im: a.im + b.im }; }
  function cInv(a) { const d = a.re * a.re + a.im * a.im; return { re: a.re / d, im: -a.im / d }; }
  function cDiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }
  function zToG(z)  { return cDiv({ re: z.re - 1, im: z.im }, { re: z.re + 1, im: z.im }); }
  function gToZ(g)  { return cDiv({ re: 1 + g.re, im: g.im }, { re: 1 - g.re, im: -g.im }); }

  // apply a lumped/stub component (signed normalized delta dv) to impedance z -> new z
  function applyComp(z, comp, dv) {
    if (comp.domain === 'z') {
      return comp.part === 're' ? { re: z.re + dv, im: z.im } : { re: z.re, im: z.im + dv };
    }
    let y = cInv(z);
    y = comp.part === 're' ? { re: y.re + dv, im: y.im } : { re: y.re, im: y.im + dv };
    return cInv(y);
  }

  // Cascaded (through) transmission line of normalized char. impedance zcn and
  // electrical length θ:  z_in = zcn (z + j zcn tanθ) / (zcn + j z tanθ)
  function lineTransform(z, theta, zcn) {
    const t = Math.tan(theta);
    const num = cAdd(z, { re: 0, im: zcn * t });
    const den = cAdd({ re: zcn, im: 0 }, { re: -z.im * t, im: z.re * t });
    const ratio = cDiv(num, den);
    return { re: zcn * ratio.re, im: zcn * ratio.im };
  }

  // apply any chain entry (dispatches lumped/stub vs through-line) to z
  function applyEntry(z, entry) {
    const comp = COMPONENTS[entry.id];
    if (comp.line) return lineTransform(z, entry.theta, entry.zc / getZ0());
    return applyComp(z, comp, entry.dv);
  }

  // apply any chain entry at frequency f, where entry was designed for f_design
  function applyEntryAtFreq(z, entry, f, f_design) {
    if (f_design <= 0) return applyEntry(z, entry);
    const comp = COMPONENTS[entry.id];
    const Rf = f / f_design;
    
    if (comp.line) {
      return lineTransform(z, entry.theta * Rf, entry.zc / getZ0());
    }
    if (comp.stub) {
      const theta = stubTheta(comp, entry.dv, entry.zc);
      const theta_f = theta * Rf;
      let B_f = 0;
      if (comp.term === 'open') {
        B_f = Math.tan(theta_f) / entry.zc;
      } else {
        B_f = -1 / (entry.zc * Math.tan(theta_f));
      }
      return applyComp(z, comp, B_f * getZ0());
    }
    
    let dv_f = entry.dv;
    if (comp.domain === 'z') {
      if (comp.part === 'im') {
        if (comp.kind === 'L') dv_f = entry.dv * Rf;
        else if (comp.kind === 'C') dv_f = entry.dv / Rf;
      }
    } else {
      if (comp.part === 'im') {
        if (comp.kind === 'C') dv_f = entry.dv * Rf;
        else if (comp.kind === 'L') dv_f = entry.dv / Rf;
      }
    }
    return applyComp(z, comp, dv_f);
  }

  // ---------- Chain ----------
  function chainNodes() {
    let z = { re: load.re, im: load.im };
    const arr = [{ z: { re: z.re, im: z.im } }];
    comps.forEach(function (c) {
      z = applyEntry(z, c);
      arr.push({ z: { re: z.re, im: z.im } });
    });
    return arr;
  }
  function currentZ() {
    const n = chainNodes();
    return n[n.length - 1].z;
  }
  // impedance feeding component `index` (state after components 0..index-1)
  function prefixNode(index) {
    let z = { re: load.re, im: load.im };
    for (let i = 0; i < index; i++) z = applyEntry(z, comps[i]);
    return z;
  }
  // nearest draggable node within `tol` px: { load:true } for the load, { index:i }
  // for a component's output node, or null.
  function hitNode(mouse, tol) {
    let bestD = tol || 9, hit = null;
    const lg = zToG(load), lc = gToC(lg.re, lg.im);
    let d = Math.hypot(lc[0] - mouse.x, lc[1] - mouse.y);
    if (d < bestD) { bestD = d; hit = { load: true }; }
    let z = { re: load.re, im: load.im };
    for (let i = 0; i < comps.length; i++) {
      z = applyEntry(z, comps[i]);
      const g = zToG(z), c = gToC(g.re, g.im);
      d = Math.hypot(c[0] - mouse.x, c[1] - mouse.y);
      if (d < bestD) { bestD = d; hit = { index: i }; }
    }
    return hit;
  }

  // ---------- Sizing / HiDPI ----------
  function resize() {
    const size = wrap.clientWidth;
    dpr = window.devicePixelRatio || 1;
    [gridCanvas, hoverCanvas].forEach(function (c) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
      c.style.width = size + 'px';
      c.style.height = size + 'px';
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    const pad = 26;
    const baseR = size / 2 - pad;
    const baseCx = size / 2;
    const baseCy = size / 2;
    
    R = baseR * zoomScale;
    cx = baseCx + panX;
    cy = baseCy + panY;
    
    drawGrid();
    renderOverlay(null);
  }

  // ---------- Grid ----------
  function gCircle(ctx, gcx, gcy, gr) {
    const [ccx, ccy] = gToC(gcx, gcy);
    ctx.beginPath();
    ctx.arc(ccx, ccy, gr * R, 0, 2 * Math.PI);
    ctx.stroke();
  }
  function clipUnit(ctx) {
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
  }

  function drawGrid() {
    gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
    gctx.save();
    gctx.beginPath(); gctx.arc(cx, cy, R, 0, 2 * Math.PI);
    gctx.fillStyle = '#ffffff'; gctx.fill();
    gctx.restore();

    const vals = RES_LEVELS[parseInt(resSlider.value, 10) - 1];
    
    // Draw faint grid everywhere (outside included)
    if (chkAdmit.checked) drawFamily(vals, false, true);
    if (chkImped.checked) drawFamily(vals, true, true);
    
    // Draw normal grid inside unit circle (overwrites faint)
    if (chkAdmit.checked) drawFamily(vals, false, false);
    if (chkImped.checked) drawFamily(vals, true, false);
    
    if (chkQ.checked) drawQCircles();

    gctx.save();
    gctx.strokeStyle = COL.axis; gctx.lineWidth = 1.1;
    gctx.beginPath(); gctx.moveTo(cx - R, cy); gctx.lineTo(cx + R, cy); gctx.stroke();
    gctx.restore();

    gctx.save();
    gctx.strokeStyle = COL.outer; gctx.lineWidth = 1.6;
    gctx.beginPath(); gctx.arc(cx, cy, R, 0, 2 * Math.PI); gctx.stroke();
    gctx.restore();

    if (chkImped.checked) drawLabels(vals, true);
    if (chkAdmit.checked) drawLabels(vals, false);
  }

  function drawFamily(vals, isImped, isFaint) {
    const sign = isImped ? 1 : -1;
    const major = isImped ? COL.imped : COL.admit;
    const minor = isImped ? COL.impedMinor : COL.admitMinor;
    gctx.save();
    
    if (isFaint) {
      gctx.globalAlpha = 0.15;
    } else {
      clipUnit(gctx);
    }
    
    vals.forEach(function (v) {
      const isMaj = MAJOR.has(v);
      gctx.strokeStyle = isMaj ? major : minor;
      gctx.lineWidth = isMaj ? 1.1 : 0.7;
      gCircle(gctx, sign * (v / (1 + v)), 0, 1 / (1 + v));
      gCircle(gctx, sign * 1, sign * (1 / v), 1 / v);
      gCircle(gctx, sign * 1, sign * (-1 / v), 1 / v);
    });
    gctx.restore();
  }

  function parseQ() {
    return qValIn.value.split(',')
      .map(function (s) { return parseFloat(s.trim()); })
      .filter(function (q) { return isFinite(q) && q > 0; });
  }
  // constant-Q locus: circle centred at (0, ∓1/Q) with radius √(1+1/Q²), through Γ=±1
  function drawQCircles() {
    const qs = parseQ();
    gctx.save(); clipUnit(gctx);
    gctx.strokeStyle = COL.q; gctx.lineWidth = 1; gctx.setLineDash([4, 3]);
    qs.forEach(function (Q) {
      const rad = Math.sqrt(1 + 1 / (Q * Q));
      gCircle(gctx, 0, -1 / Q, rad);   // upper (inductive)
      gCircle(gctx, 0, 1 / Q, rad);    // lower (capacitive)
    });
    gctx.restore();
    // label each Q at the apex of its upper arc
    gctx.save();
    gctx.fillStyle = COL.q;
    gctx.font = '600 11px "JetBrains Mono", "Fira Code", monospace';
    gctx.textAlign = 'center'; gctx.textBaseline = 'bottom';
    qs.forEach(function (Q) {
      const apex = -1 / Q + Math.sqrt(1 + 1 / (Q * Q));   // Γ imag at u=0
      const [px, py] = gToC(0, apex);
      gctx.fillText('Q=' + Q, px, py - 2);
    });
    gctx.restore();
  }

  function drawLabels(vals, isImped) {
    const sign = isImped ? 1 : -1;
    gctx.save();
    gctx.font = '600 11px "JetBrains Mono", "Fira Code", monospace';
    gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
    vals.forEach(function (v) {
      if (!MAJOR.has(v)) return;
      const axG = sign * ((v - 1) / (v + 1));
      const [ax, ay] = gToC(axG, 0);
      gctx.save();
      const txt = String(v);
      gctx.fillStyle = '#fff';
      const w = gctx.measureText(txt).width + 4;
      gctx.fillRect(ax - w / 2, ay + 3, w, 13);
      gctx.fillStyle = isImped ? COL.imped : COL.admit;
      gctx.textBaseline = 'top'; gctx.fillText(txt, ax, ay + 4);
      gctx.restore();
      [v, -v].forEach(function (xv) {
        const d = xv * xv + 1;
        let gre = (xv * xv - 1) / d, gim = (2 * xv) / d;
        gre *= sign; gim *= sign;
        const [px, py] = gToC(gre, gim);
        const nx = px - cx, ny = py - cy, len = Math.hypot(nx, ny) || 1;
        gctx.fillStyle = isImped ? COL.imped : COL.admit;
        gctx.textBaseline = 'middle';
        gctx.fillText((xv > 0 ? '' : '−') + Math.abs(xv), cx + nx / len * (R + 13), cy + ny / len * (R + 13));
      });
    });
    gctx.restore();
  }

  // ---------- Constraint circle for the armed component ----------
  function constraintOf(comp, zc) {
    if (comp.domain === 'z') {
      if (comp.part === 'im') { const r = zc.re; return { kind: 'circle', cx: r / (1 + r), cy: 0, rad: 1 / (1 + r) }; }
      const x = zc.im;
      if (Math.abs(x) < 1e-6) return { kind: 'line' };
      return { kind: 'circle', cx: 1, cy: 1 / x, rad: 1 / Math.abs(x) };
    }
    const yc = cInv(zc);
    if (comp.part === 'im') { const g = yc.re; return { kind: 'circle', cx: -g / (1 + g), cy: 0, rad: 1 / (1 + g) }; }
    const b = yc.im;
    if (Math.abs(b) < 1e-6) return { kind: 'line' };
    return { kind: 'circle', cx: -1, cy: -1 / b, rad: 1 / Math.abs(b) };
  }
  function projectOnto(g, con) {
    if (con.kind === 'line') return { re: g.re, im: 0 };
    let dx = g.re - con.cx, dy = g.im - con.cy, d = Math.hypot(dx, dy) || 1e-9;
    return { re: con.cx + dx / d * con.rad, im: con.cy + dy / d * con.rad };
  }
  function variedValue(comp, z) {
    if (comp.domain === 'z') return comp.part === 're' ? z.re : z.im;
    const y = cInv(z);
    return comp.part === 're' ? y.re : y.im;
  }

  // Given the impedance feeding a component (zIn), the mouse, and (for a line) its
  // Zc, solve the component's parameter. Returns { dv, con } or { theta } for a line.
  function solveParam(comp, zIn, mouse, zcForLine) {
    const gm = { re: 0, im: 0 };
    const gc = cToG(mouse.x, mouse.y);
    gm.re = gc[0]; gm.im = gc[1];
    if (comp.line) {
      const zcn = (zcForLine || getZ0()) / getZ0();
      const rho = (zcn - 1) / (zcn + 1);
      const wc = cDiv({ re: zIn.re - zcn, im: zIn.im }, { re: zIn.re + zcn, im: zIn.im });
      const wm = cDiv({ re: gm.re - rho, im: gm.im }, { re: 1 - rho * gm.re, im: -rho * gm.im });
      let d = Math.atan2(wc.im, wc.re) - Math.atan2(wm.im, wm.re);
      d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return { theta: d / 2 };
    }
    const con = constraintOf(comp, zIn);
    const proj = projectOnto(gm, con);
    let dv = variedValue(comp, gToZ(proj)) - variedValue(comp, zIn);
    if (comp.dir > 0) dv = Math.max(0, dv);
    else if (comp.dir < 0) dv = Math.min(0, dv);
    return { dv: dv, con: con };
  }

  function drawConstraintCircle(con) {
    hctx.save(); clipUnit(hctx);
    hctx.strokeStyle = COL.constraint; hctx.lineWidth = 1; hctx.setLineDash([3, 3]);
    if (con.kind === 'line') { hctx.beginPath(); hctx.moveTo(cx - R, cy); hctx.lineTo(cx + R, cy); hctx.stroke(); }
    else {
      const c = gToC(con.cx, con.cy);
      hctx.beginPath(); hctx.arc(c[0], c[1], con.rad * R, 0, 2 * Math.PI); hctx.stroke();
    }
    hctx.restore();
  }

  // Adaptively sample a parametric Γ curve fΓ(t), t∈[0,1], subdividing until each
  // segment is visually straight in canvas pixels. Guarantees smooth arcs regardless
  // of how non-uniform the t→angle mapping is (fixes coarse/jagged circles).
  function adaptivePath(fG) {
    const TOL = 0.35, MAXSEG = 22, MAXDEPTH = 9;
    const g0 = fG(0), pts = [g0];
    (function recurse(t0, a, t1, b, depth) {
      const tm = (t0 + t1) / 2, gm = fG(tm);
      const pa = gToC(a.re, a.im), pb = gToC(b.re, b.im), pm = gToC(gm.re, gm.im);
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy) || 1e-9;
      const dev = Math.abs((pm[0] - pa[0]) * dy - (pm[1] - pa[1]) * dx) / L;
      if (depth < MAXDEPTH && (dev > TOL || L > MAXSEG)) {
        recurse(t0, a, tm, gm, depth + 1);
        recurse(tm, gm, t1, b, depth + 1);
      } else {
        pts.push(b);
      }
    })(0, g0, 1, fG(1), 0);
    return pts;
  }
  // Γ trajectory produced by applying `comp` with delta 0..dv
  function pathGamma(zStart, comp, dv) {
    return adaptivePath(function (t) { return zToG(applyComp(zStart, comp, dv * t)); });
  }
  // Γ trajectory of a through line, θ swept 0..theta
  function pathLine(zStart, theta, zcn) {
    return adaptivePath(function (t) { return zToG(lineTransform(zStart, theta * t, zcn)); });
  }
  // trajectory for any committed chain entry
  function pathEntry(zStart, entry) {
    const comp = COMPONENTS[entry.id];
    if (comp.line) return pathLine(zStart, entry.theta, entry.zc / getZ0());
    return pathGamma(zStart, comp, entry.dv);
  }

  // ---------- Overlay (chain + armed preview or inspect) ----------
  function clearHover() { hctx.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height); }

  function polyline(gpts, style, width, dash) {
    hctx.save();
    hctx.strokeStyle = style; hctx.lineWidth = width;
    hctx.setLineDash(dash || []);
    hctx.beginPath();
    gpts.forEach(function (g, i) {
      const [px, py] = gToC(g.re, g.im);
      if (i === 0) hctx.moveTo(px, py); else hctx.lineTo(px, py);
    });
    hctx.stroke();
    hctx.restore();
  }
  function dot(g, color, r) {
    const [px, py] = gToC(g.re, g.im);
    hctx.save();
    hctx.fillStyle = color; hctx.beginPath(); hctx.arc(px, py, r, 0, 2 * Math.PI); hctx.fill();
    hctx.strokeStyle = '#fff'; hctx.lineWidth = 1.2; hctx.stroke();
    hctx.restore();
  }

  function drawChain() {
    let z = { re: load.re, im: load.im };
    dot(zToG(z), COL.load, 5);                       // load
    comps.forEach(function (c, i) {
      const col = colorFor(i);
      const hot = i === traceHotIndex;
      polyline(pathEntry(z, c), col, hot ? 4 : 2);   // trace + its ending node share a colour
      z = applyEntry(z, c);
      dot(zToG(z), col, hot ? 6 : 4);
    });
  }

  function drawSParamTrace() {
    sParamTracePts = [];
    if (!sParamData || sParamData.length === 0) return;
    const z0 = getZ0();
    const f_d = getFreq();
    const fmin = parseFloat(sparamFminIn.value) * 1e9 || 0;
    const fmax = parseFloat(sparamFmaxIn.value) * 1e9 || Infinity;
    const gpts = [];
    const rawGpts = [];
    const isTransformed = comps.length > 0 || (armedId && preview);
    sParamData.forEach(function(dp) {
      if (dp.f < fmin || dp.f > fmax) return;
      const s11 = dp.s11;
      const num = { re: 1 + s11.re, im: s11.im };
      const den = { re: 1 - s11.re, im: -s11.im };
      let zUnnorm = cDiv(num, den);
      zUnnorm = { re: zUnnorm.re * sParamZ0, im: zUnnorm.im * sParamZ0 };
      let zNorm = { re: zUnnorm.re / z0, im: zUnnorm.im / z0 };
      
      if (isTransformed) rawGpts.push(zToG(zNorm));

      for (let i = 0; i < comps.length; i++) {
        zNorm = applyEntryAtFreq(zNorm, comps[i], dp.f, f_d);
      }
      if (armedId && preview) {
        zNorm = applyEntryAtFreq(zNorm, preview, dp.f, f_d);
      }
      const g = zToG(zNorm);
      gpts.push(g);
      const [px, py] = gToC(g.re, g.im);
      sParamTracePts.push({ f: dp.f, z: zNorm, px: px, py: py });
    });
    if (isTransformed) {
      polyline(rawGpts, 'rgba(100,100,100,0.3)', 1.5, [4, 4]);
    }
    polyline(gpts, 'rgba(100,100,100,0.6)', 2);
  }

  // component index whose trace polyline passes within `tol` px of the mouse, else -1
  function traceAt(mouse, tol) {
    let z = { re: load.re, im: load.im }, best = -1, bestD = tol || 6;
    for (let i = 0; i < comps.length; i++) {
      const pts = pathEntry(z, comps[i]);
      for (let k = 1; k < pts.length; k++) {
        const a = gToC(pts[k - 1].re, pts[k - 1].im), b = gToC(pts[k].re, pts[k].im);
        const d = distToSeg(mouse.x, mouse.y, a[0], a[1], b[0], b[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
      z = applyEntry(z, comps[i]);
    }
    return best;
  }
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function renderOverlay(mouse) {
    clearHover();

    if (dragging && mouse) { drawEditing(mouse); return; }

    preview = null;
    if (armedId && mouse) calcPreview(mouse);

    if (sParamData) drawSParamTrace();
    drawChain();
    
    if (armedId && mouse) { drawArmedVisuals(mouse); return; }
    if (!armedId && mouse) { drawInspect(mouse); drawQHighlight(); return; }

    drawQHighlight();
    // idle: show the current input point values
    updateReadout(currentZ(), false);
  }

  // bright overlay of the constant-Q circle currently "grabbed" (after 3s dwell)
  function drawQHighlight() {
    if (qHotIndex < 0 || !chkQ.checked) return;
    const qs = parseQ(); const Q = qs[qHotIndex];
    if (Q == null) return;
    const rad = Math.sqrt(1 + 1 / (Q * Q));
    hctx.save(); clipUnit(hctx);
    hctx.strokeStyle = COL.q; hctx.lineWidth = 3; hctx.setLineDash([]);
    [-1 / Q, 1 / Q].forEach(function (cyv) {
      const c = gToC(0, cyv);
      hctx.beginPath(); hctx.arc(c[0], c[1], rad * R, 0, 2 * Math.PI); hctx.stroke();
    });
    hctx.restore();
  }

  // full rotation locus of a through line (θ: 0→π sweeps the whole circle)
  function drawLineLocus(zStart, zcn) {
    hctx.save(); clipUnit(hctx);
    hctx.strokeStyle = COL.constraint; hctx.lineWidth = 1; hctx.setLineDash([3, 3]);
    hctx.beginPath();
    pathLine(zStart, Math.PI, zcn).forEach(function (g, i) {
      const [px, py] = gToC(g.re, g.im);
      if (i === 0) hctx.moveTo(px, py); else hctx.lineTo(px, py);
    });
    hctx.stroke(); hctx.restore();
  }

  // ---------- Armed placement (append a new component) ----------
  function calcPreview(mouse) {
    if (!armedId) return;
    const comp = COMPONENTS[armedId];
    const zc = currentZ();
    if (comp.line) {
      const zcn = currentStubParams().zc / getZ0();
      const sol = solveParam(comp, zc, mouse, currentStubParams().zc);
      const zNew = lineTransform(zc, sol.theta, zcn);
      preview = { id: armedId, line: true, theta: sol.theta, zNew: zNew, sol: sol, zcn: zcn, zc_val: zc, zc: currentStubParams().zc };
    } else {
      const sol = solveParam(comp, zc, mouse);
      const zNew = applyComp(zc, comp, sol.dv);
      preview = { id: armedId, dv: sol.dv, zNew: zNew, sol: sol, zc_val: zc };
    }
  }

  function drawArmedVisuals(mouse) {
    if (!armedId || !preview) return;
    const comp = COMPONENTS[armedId];
    if (comp.line) {
      drawLineLocus(preview.zc_val, preview.zcn);
      polyline(pathLine(preview.zc_val, preview.theta, preview.zcn), COL.preview, 2.5);
      dot(zToG(preview.zNew), COL.preview, 5);
    } else {
      drawConstraintCircle(preview.sol.con);
      polyline(pathGamma(preview.zc_val, comp, preview.dv), COL.preview, 2.5);
      dot(zToG(preview.zNew), COL.preview, 5);
    }
    updateReadout(preview.zNew, true);
    updateArmHint(comp);
  }

  // ---------- Editing a placed component by dragging its node ----------
  function drawEditing(mouse) {
    if (dragging.load) { drawEditingLoad(mouse); return; }
    const index = dragging.index;
    const entry = comps[index];
    const comp = COMPONENTS[entry.id];
    const zIn = prefixNode(index);
    const sol = solveParam(comp, zIn, mouse, entry.zc);

    if (comp.line) entry.theta = sol.theta;
    else entry.dv = sol.dv;

    if (sParamData) drawSParamTrace();

    drawChain();                                   // reflects the edited value
    if (comp.line) drawLineLocus(zIn, entry.zc / getZ0());
    else drawConstraintCircle(sol.con);

    const zOut = applyEntry(zIn, entry);
    dot(zToG(zOut), COL.preview, 6);               // the node being dragged
    updateReadout(zOut, true);

    armHint.classList.add('show');
    const cv = compValue(comp, entry.dv, entry);
    let head = '<b>Editing ' + comp.name + '</b>';
    if (compUsesZc(entry.id)) head += ' · Z<sub>c</sub>=' + fmtZc(entry.zc) + 'Ω';
    armHint.innerHTML = head + ' · drag to change · <b>' + cv.text + '</b>';

    renderSchematic();
    renderCircuitInfo();
  }

  // dragging the load node: set Z_L directly from the cursor (clamped inside |Γ|=1)
  function drawEditingLoad(mouse) {
    if (sParamData) {
      armHint.classList.add('show');
      armHint.innerHTML = '<b>Cannot drag load</b> · Clear S-parameter file first.';
      return;
    }
    let g = cToG(mouse.x, mouse.y);
    let gre = g[0], gim = g[1];
    const rho = Math.hypot(gre, gim);
    if (rho > 0.999) { gre = gre / rho * 0.999; gim = gim / rho * 0.999; }
    const z = gToZ({ re: gre, im: gim });
    load = { re: z.re, im: z.im };
    const z0 = getZ0();
    loadRIn.value = fmtN(load.re * z0);
    loadXIn.value = fmtN(load.im * z0);

    drawChain();
    dot(zToG(load), COL.preview, 6);
    updateReadout(load, true);

    armHint.classList.add('show');
    armHint.innerHTML = '<b>Editing load Z<sub>L</sub></b> · drag to set · <b>' + cplx(load.re * z0, load.im * z0) + ' Ω</b>';

    renderSchematic();
    renderCircuitInfo();
  }

  // ---------- Inspect (nothing armed) ----------
  function snapToTrace(mouse) {
    if (!sParamTracePts || sParamTracePts.length === 0) return null;
    let best = null, bestD = 10;
    for (let i = 0; i < sParamTracePts.length; i++) {
      const p = sParamTracePts[i];
      const d = Math.hypot(p.px - mouse.x, p.py - mouse.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  function drawInspect(mouse) {
    const snap = snapToTrace(mouse);
    let z, gre, gim, rho, f = null;
    if (snap) {
      z = snap.z;
      f = snap.f;
      const g = zToG(z);
      gre = g.re; gim = g.im;
      rho = Math.hypot(gre, gim);
    } else {
      const gc = cToG(mouse.x, mouse.y);
      gre = gc[0]; gim = gc[1];
      rho = Math.hypot(gre, gim);
      if (rho > 1.0001) { updateReadout(null, false, null); return; }
      z = gToZ({ re: gre, im: gim });
    }

    const [sx, sy] = gToC(gre, gim);
    hctx.save(); clipUnit(hctx);
    hctx.strokeStyle = COL.vswr; hctx.lineWidth = 1; hctx.setLineDash([2, 3]);
    hctx.beginPath(); hctx.arc(cx, cy, rho * R, 0, 2 * Math.PI); hctx.stroke();
    hctx.restore();

    hctx.save();
    hctx.strokeStyle = COL.crosshair; hctx.lineWidth = 1;
    hctx.beginPath(); hctx.moveTo(cx, cy); hctx.lineTo(sx, sy); hctx.stroke();
    hctx.restore();
    dot({ re: gre, im: gim }, snap ? COL.preview : COL.point, snap ? 5 : 3.5);

    updateReadout(z, true, f);
  }

  // ---------- Readout ----------
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    const a = Math.abs(n);
    if (a >= 1000) return n.toFixed(0);
    if (a >= 100) return n.toFixed(1);
    if (a >= 1) return n.toFixed(3);
    return n.toFixed(4);
  }
  function cplx(re, im) {
    if (!isFinite(re) || !isFinite(im)) return '∞';
    return fmt(re) + (im >= 0 ? ' + j' : ' − j') + fmt(Math.abs(im));
  }
  function fmtN(n) { return !isFinite(n) ? '∞' : String(Math.round(n * 100) / 100); }
  function updateReadout(z, active, f) {
    if (!z || !active || !chkReadout.checked) { readout.box.style.display = 'none'; return; }
    readout.box.style.display = 'block';
    positionReadout();

    const z0 = getZ0();
    const g = zToG(z);
    const rho = Math.hypot(g.re, g.im);
    const vswr = rho >= 1 ? Infinity : (1 + rho) / (1 - rho);
    const y = cInv(z);

    if (f != null && readout.fRow && readout.freq) {
      readout.fRow.style.display = '';
      readout.freq.style.display = '';
      readout.freq.textContent = engFmt(f, [[1e9, 1e9, 'GHz'], [1e6, 1e6, 'MHz'], [1e3, 1e3, 'kHz'], [0, 1, 'Hz']]);
    } else if (readout.fRow && readout.freq) {
      readout.fRow.style.display = 'none';
      readout.freq.style.display = 'none';
    }

    readout.gamma.textContent = fmt(rho) + ' ∠ ' + (Math.atan2(g.im, g.re) * 180 / Math.PI).toFixed(1) + '°';
    readout.vswr.textContent = isFinite(vswr) ? fmt(vswr) + ' : 1' : '∞ : 1';

    const showZ = chkImped.checked, showY = chkAdmit.checked;
    setRow(readout.zRow, readout.z, showZ);
    setRow(readout.zRow2, readout.zOhm, showZ);
    setRow(readout.yRow, readout.y, showY);
    setRow(readout.yRow2, readout.yS, showY);
    if (showZ) { readout.z.textContent = cplx(z.re, z.im); readout.zOhm.textContent = cplx(z.re * z0, z.im * z0) + ' Ω'; }
    if (showY) { readout.y.textContent = cplx(y.re, y.im); readout.yS.textContent = cplx(y.re / z0 * 1000, y.im / z0 * 1000) + ' mS'; }
  }
  function setRow(dt, dd, show) { dt.style.display = show ? '' : 'none'; dd.style.display = show ? '' : 'none'; }
  function positionReadout() {
    if (!lastClient) return;
    const el = readout.box, w = el.offsetWidth || 200, h = el.offsetHeight || 150;
    let x = lastClient.x + 18, y = lastClient.y + 18;
    if (x + w > window.innerWidth - 8) x = lastClient.x - 18 - w;
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - 8 - h);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // ---------- Component value formatting ----------
  function getZ0() { return parseFloat(z0Input.value) || 50; }
  function getFreq() { return (parseFloat(freqIn.value) || 0) * parseFloat(freqUnit.value); }

  function engFmt(val, units) {
    // units: array of [threshold, divisor, suffix] descending
    const a = Math.abs(val);
    for (let i = 0; i < units.length; i++) {
      if (a >= units[i][0] || i === units.length - 1) {
        const v = val / units[i][1];
        return (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)) + ' ' + units[i][2];
      }
    }
    return val.toString();
  }
  const L_UNITS = [[1, 1, 'H'], [1e-3, 1e-3, 'mH'], [1e-6, 1e-6, 'µH'], [1e-9, 1e-9, 'nH'], [0, 1e-12, 'pH']];
  const C_UNITS = [[1e-6, 1e-6, 'µF'], [1e-9, 1e-9, 'nF'], [1e-12, 1e-12, 'pF'], [0, 1e-15, 'fF']];
  const R_UNITS = [[1e6, 1e6, 'MΩ'], [1e3, 1e3, 'kΩ'], [0, 1, 'Ω']];
  const LEN_UNITS = [[1, 1, 'm'], [1e-2, 1e-2, 'cm'], [0, 1e-3, 'mm']];
  const C_LIGHT = 299792458;

  function currentStubParams() {
    return { zc: parseFloat(stubZcIn.value) || getZ0(), eeff: parseFloat(stubEeffIn.value) || 1 };
  }
  function fmtZc(v) { return v % 1 === 0 ? String(v) : v.toFixed(1); }
  function compUsesZc(id) { const c = COMPONENTS[id]; return !!(c && (c.line || c.stub)); }

  // electrical length θ ∈ [0, π) that realizes delta dv for the given stub
  function stubTheta(comp, dv, zc) {
    const z0 = getZ0();
    let t;
    if (comp.domain === 'z') {                 // series stub: reactance X = dv * z0
      const X = dv * z0;
      t = comp.term === 'short' ? X / zc : -zc / X;      // tanθ
    } else {                                   // shunt stub: susceptance B = dv / z0
      const B = dv / z0;
      t = comp.term === 'open' ? B * zc : -1 / (B * zc); // tanθ
    }
    let th = Math.atan(t);
    return ((th % Math.PI) + Math.PI) % Math.PI;
  }

  // returns { text, ok } — physical value/length for delta dv
  function compValue(comp, dv, inst) {
    const z0 = getZ0(), f = getFreq(), w = 2 * Math.PI * f;

    if (comp.line) {
      const th = inst.theta, eeff = inst.eeff || 1;
      const frac = th / (2 * Math.PI);
      let s = frac.toFixed(3) + 'λ · ' + (th * 180 / Math.PI).toFixed(1) + '°';
      if (f > 0) s += ' · ' + engFmt(frac * (C_LIGHT / f) / Math.sqrt(eeff), LEN_UNITS);
      return { text: s, ok: true };
    }

    if (comp.stub) {
      const p = inst || currentStubParams();
      const th = stubTheta(comp, dv, p.zc);
      const frac = th / (2 * Math.PI);                 // length in wavelengths
      let s = frac.toFixed(3) + 'λ · ' + (th * 180 / Math.PI).toFixed(1) + '°';
      if (f > 0) s += ' · ' + engFmt(frac * (C_LIGHT / f) / Math.sqrt(p.eeff), LEN_UNITS);
      return { text: s, ok: true };
    }

    if (comp.domain === 'z' && comp.part === 're') return { text: engFmt(dv * z0, R_UNITS), ok: true };      // series R
    if (comp.domain === 'y' && comp.part === 're') return { text: engFmt(1 / (dv / z0), R_UNITS), ok: true }; // shunt R
    if (!f) return { text: '— (set frequency)', ok: false };
    if (comp.domain === 'z') {            // series reactance: X = dv * z0
      const X = dv * z0;
      if (comp.kind === 'L') return { text: engFmt(X / w, L_UNITS), ok: true };
      return { text: engFmt(1 / (w * Math.abs(X)), C_UNITS), ok: true };
    }
    // shunt susceptance: B = dv / z0
    const B = dv / z0;
    if (comp.kind === 'C') return { text: engFmt(B / w, C_UNITS), ok: true };
    return { text: engFmt(1 / (w * Math.abs(B)), L_UNITS), ok: true };
  }
  function deltaText(comp, dv) {
    if (comp.domain === 'z') return (comp.part === 're' ? 'Δr = ' : 'Δx = ') + (dv >= 0 ? '+' : '−') + fmt(Math.abs(dv));
    return (comp.part === 're' ? 'Δg = ' : 'Δb = ') + (dv >= 0 ? '+' : '−') + fmt(Math.abs(dv));
  }

  function updateArmHint(comp) {
    let head = '<b>' + comp.name + '</b>';
    if (comp.line) {
      const p = currentStubParams();
      const cv = compValue(comp, 0, { theta: preview ? preview.theta : 0, zc: p.zc, eeff: p.eeff });
      armHint.innerHTML = head + ' · Z<sub>c</sub>=' + fmtZc(p.zc) +
        'Ω (scroll to change) · rotate toward the generator on the constant-|Γ| circle about Z<sub>c</sub>, click to place.<br>' +
        'line length &nbsp;→&nbsp; <b>' + cv.text + '</b>';
      return;
    }
    const dv = preview ? preview.dv : 0;
    if (comp.stub) head += ' · Z<sub>c</sub>=' + fmtZc(currentStubParams().zc) + 'Ω (scroll to change)';
    const cv = compValue(comp, dv, comp.stub ? currentStubParams() : null);
    armHint.innerHTML = head + ' · move along the ' +
      CONSTRAINT_NAME[comp.domain + '.' + comp.part] + ' circle, click to place.<br>' +
      deltaText(comp, dv) + ' &nbsp;→&nbsp; <b>' + cv.text + '</b>';
  }

  // ---------- Schematic ----------
  function el(tag, attrs, children) {
    const NS = 'http://www.w3.org/2000/svg';
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    (children || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  // horizontal symbol path (0,0)->(len,0), centered vertically on y=0
  function symbolPath(kind, len) {
    const m = 6;
    if (kind === 'R') {
      const z = 'M0,0 h' + m + ' l3,-6 l6,12 l6,-12 l6,12 l3,-6 h' + (len - m - 24);
      return z;
    }
    if (kind === 'C') {
      const g = 5, mid = len / 2;
      return 'M0,0 H' + (mid - g) + ' M' + (mid - g) + ',-7 V7 M' + (mid + g) + ',-7 V7 M' + (mid + g) + ',0 H' + len;
    }
    // L: three bumps
    const b = (len - 12) / 3;
    return 'M0,0 h6 a' + (b / 2) + ',' + (b / 2) + ' 0 0 1 ' + b + ',0 a' + (b / 2) + ',' + (b / 2) +
      ' 0 0 1 ' + b + ',0 a' + (b / 2) + ',' + (b / 2) + ' 0 0 1 ' + b + ',0 h6';
  }

  // compact schematic labels (kept short so cells never collide)
  function schLabels(comp, inst) {
    if (comp.line || comp.stub) {
      const th = comp.line ? inst.theta : stubTheta(comp, inst.dv, inst.zc);
      return ['Zc=' + fmtZc(inst.zc) + 'Ω', (th / (2 * Math.PI)).toFixed(3) + 'λ'];
    }
    return [compValue(comp, inst.dv, inst).text];
  }

  function renderSchematic() {
    schematic.innerHTML = '';
    const railY = 46, gndY = 122, symLen = 40, leftPad = 34, rightPad = 20, baseSlot = 70;
    const z0 = getZ0();

    const order = [];                       // left(source) -> right(load), keep comps index
    for (let i = comps.length - 1; i >= 0; i--) order.push({ i: i, comp: COMPONENTS[comps[i].id], inst: comps[i] });
    order.forEach(function (o) { o.labels = schLabels(o.comp, o.inst); });
    const loadLbl = fmtN(load.re * z0) + (load.im >= 0 ? '+j' : '−j') + fmtN(Math.abs(load.im * z0)) + 'Ω';

    // size the slot to the widest label so nothing overlaps horizontally
    gctx.save(); gctx.font = '11px "JetBrains Mono", "Fira Code", monospace';
    let maxW = gctx.measureText(loadLbl).width;
    order.forEach(function (o) { o.labels.forEach(function (s) { maxW = Math.max(maxW, gctx.measureText(s).width); }); });
    gctx.restore();
    const slot = Math.max(baseSlot, Math.ceil(maxW) + 16);

    const labelY0 = gndY + 16, labelDY = 12, svgH = labelY0 + labelDY * 2 + 6;
    const cells = order.length + 1;
    const width = leftPad + cells * slot + rightPad;
    const svg = el('svg', { width: width, height: svgH, viewBox: '0 0 ' + width + ' ' + svgH });

    // ground rail + ground symbol + input terminal
    svg.appendChild(el('line', { x1: leftPad - 10, y1: gndY, x2: width - rightPad, y2: gndY, class: 'sch-wire' }));
    const gx = leftPad - 6;
    svg.appendChild(el('line', { x1: gx, y1: gndY, x2: gx, y2: gndY + 8, class: 'sch-wire' }));
    svg.appendChild(el('line', { x1: gx - 7, y1: gndY + 8, x2: gx + 7, y2: gndY + 8, class: 'sch-wire' }));
    svg.appendChild(el('line', { x1: gx - 4, y1: gndY + 11, x2: gx + 4, y2: gndY + 11, class: 'sch-wire' }));
    svg.appendChild(el('circle', { cx: leftPad - 12, cy: railY, r: 3, class: 'sch-wire' }));
    svg.appendChild(el('line', { x1: leftPad - 12, y1: railY, x2: leftPad, y2: railY, class: 'sch-wire' }));
    svg.appendChild(el('text', { x: leftPad - 16, y: railY - 8, class: 'sch-label' }, [txt('IN')]));

    // one <g> per component: highlight rect + coloured symbol + labels
    let x = leftPad;
    order.forEach(function (o) {
      const g = el('g', { class: 'sch-item', 'data-ci': o.i });
      const xc = x + slot / 2, col = colorFor(o.i), s = x + (slot - symLen) / 2;
      g.appendChild(el('rect', { x: x + 1, y: railY - 26, width: slot - 2, height: (labelY0 + labelDY * 2) - (railY - 26), rx: 5, fill: col, class: 'sch-hilite' }));

      if (o.comp.line) {
        g.appendChild(el('line', { x1: x, y1: railY, x2: s, y2: railY, class: 'sch-wire' }));
        tlBox(g, s, railY, symLen, col);
        g.appendChild(el('line', { x1: s + symLen, y1: railY, x2: x + slot, y2: railY, class: 'sch-wire' }));
      } else if (o.comp.stub) {
        g.appendChild(el('line', { x1: x, y1: railY, x2: x + slot, y2: railY, class: 'sch-wire' }));
        g.appendChild(el('circle', { cx: xc, cy: railY, r: 2.5, class: 'sch-wire', fill: 'currentColor' }));
        g.appendChild(el('line', { x1: xc, y1: railY, x2: xc, y2: railY + 10, class: 'sch-wire' }));
        const bot = railY + 44;
        g.appendChild(el('line', { x1: xc - 4, y1: railY + 10, x2: xc - 4, y2: bot, stroke: col, class: 'sch-comp' }));
        g.appendChild(el('line', { x1: xc + 4, y1: railY + 10, x2: xc + 4, y2: bot, stroke: col, class: 'sch-comp' }));
        termSymbol(g, xc, bot, o.comp.term, +1);
      } else if (o.comp.type === 'series') {
        g.appendChild(el('line', { x1: x, y1: railY, x2: s, y2: railY, class: 'sch-wire' }));
        g.appendChild(el('path', { d: symbolPath(o.comp.kind, symLen), stroke: col, class: 'sch-comp', transform: 'translate(' + s + ',' + railY + ')' }));
        g.appendChild(el('line', { x1: s + symLen, y1: railY, x2: x + slot, y2: railY, class: 'sch-wire' }));
      } else {
        g.appendChild(el('line', { x1: x, y1: railY, x2: x + slot, y2: railY, class: 'sch-wire' }));
        g.appendChild(el('circle', { cx: xc, cy: railY, r: 2.5, class: 'sch-wire', fill: 'currentColor' }));
        const top = railY + 12;
        g.appendChild(el('line', { x1: xc, y1: railY, x2: xc, y2: top, class: 'sch-wire' }));
        g.appendChild(el('path', { d: symbolPath(o.comp.kind, symLen), stroke: col, class: 'sch-comp', transform: 'translate(' + xc + ',' + top + ') rotate(90)' }));
        g.appendChild(el('line', { x1: xc, y1: top + symLen, x2: xc, y2: gndY, class: 'sch-wire' }));
      }
      o.labels.forEach(function (str, k) {
        g.appendChild(el('text', { x: xc, y: labelY0 + k * labelDY, 'text-anchor': 'middle', class: 'sch-label' + (k === 0 ? ' sch-label--val' : '') }, [txt(str)]));
      });
      svg.appendChild(g);
      x += slot;
    });

    // Load cell (shunt box to ground)
    const lg = el('g', { class: 'sch-item', 'data-ci': 'load' });
    const lx = x + slot / 2;
    lg.appendChild(el('line', { x1: x, y1: railY, x2: lx, y2: railY, class: 'sch-wire' }));
    lg.appendChild(el('line', { x1: lx, y1: railY, x2: lx, y2: railY + 12, class: 'sch-wire' }));
    lg.appendChild(el('rect', { x: lx - 14, y: railY + 12, width: 28, height: 32, rx: 3, class: 'sch-load' }));
    lg.appendChild(el('line', { x1: lx, y1: railY + 44, x2: lx, y2: gndY, class: 'sch-wire' }));
    lg.appendChild(el('text', { x: lx, y: railY + 32, 'text-anchor': 'middle', class: 'sch-load-lbl' }, [txt('Z_L')]));
    lg.appendChild(el('text', { x: lx, y: labelY0, 'text-anchor': 'middle', class: 'sch-load-lbl' }, [txt(loadLbl)]));
    svg.appendChild(lg);

    schematic.appendChild(svg);
    if (traceHotIndex >= 0) setSchematicHot(traceHotIndex);
  }
  // inline double-line transmission-line body from (s,y)..(s+len,y)
  function tlBox(g, s, y, len, col) {
    g.appendChild(el('line', { x1: s, y1: y - 4, x2: s + len, y2: y - 4, stroke: col, class: 'sch-comp' }));
    g.appendChild(el('line', { x1: s, y1: y + 4, x2: s + len, y2: y + 4, stroke: col, class: 'sch-comp' }));
    g.appendChild(el('line', { x1: s, y1: y - 4, x2: s, y2: y + 4, stroke: col, class: 'sch-comp' }));
    g.appendChild(el('line', { x1: s + len, y1: y - 4, x2: s + len, y2: y + 4, stroke: col, class: 'sch-comp' }));
  }
  function setSchematicHot(index) {
    const items = schematic.querySelectorAll('.sch-item');
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('sch-item--hot', items[i].getAttribute('data-ci') === String(index));
    }
  }
  function txt(s) { return document.createTextNode(s); }

  // termination glyph at (x,y); dir = +1 extends downward, -1 upward
  function termSymbol(svg, x, y, term, dir) {
    if (term === 'open') {
      svg.appendChild(el('circle', { cx: x, cy: y + dir * 4, r: 3, class: 'sch-wire', fill: 'none' }));
    } else {
      [[8, 0], [5, 3], [2, 6]].forEach(function (b) {
        svg.appendChild(el('line', { x1: x - b[0], y1: y + dir * b[1], x2: x + b[0], y2: y + dir * b[1], class: 'sch-wire' }));
      });
    }
  }

  // ---------- Input impedance summary ----------
  function renderCircuitInfo() {
    const z0 = getZ0();
    const zin = currentZ();
    const g = zToG(zin);
    const rho = Math.hypot(g.re, g.im);
    const vswr = rho >= 1 ? Infinity : (1 + rho) / (1 - rho);
    zinEl.innerHTML =
      '<div>Z<sub>in</sub> = <span class="big">' + cplx(zin.re * z0, zin.im * z0) + ' Ω</span></div>' +
      '<div style="color:var(--text-secondary); margin-top:4px;">z = ' + cplx(zin.re, zin.im) +
      ' &nbsp;·&nbsp; VSWR ' + (isFinite(vswr) ? fmt(vswr) + ':1' : '∞:1') + '</div>';

    btnUndo.disabled = comps.length === 0;
    btnReset.disabled = comps.length === 0;
  }

  function refreshAll() {
    renderSchematic();
    renderCircuitInfo();
    renderOverlay(null);
  }

  // ---------- Arming ----------
  function setArmed(id) {
    armedId = id;
    preview = null;
    if (id) clearQHot();
    if (!compUsesZc(id)) hideTip();
    compBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.comp === id); });
    hoverCanvas.classList.toggle('armed', !!id);
    if (id) {
      const comp = COMPONENTS[id];
      updateArmHint(comp);
      armHint.classList.add('show');
    } else {
      armHint.classList.remove('show');
      preview = null;
      renderOverlay(null);
    }
  }

  function commitPreview() {
    if (!armedId || !preview) return;
    const comp = COMPONENTS[armedId];
    if (comp.line) {
      if (!(preview.theta > 1e-3)) return;
      const p = currentStubParams();
      comps.push({ id: armedId, theta: preview.theta, zc: p.zc, eeff: p.eeff });
    } else {
      if (Math.abs(preview.dv) < 1e-4) return;
      const entry = { id: armedId, dv: preview.dv };
      if (comp.stub) { const p = currentStubParams(); entry.zc = p.zc; entry.eeff = p.eeff; }
      comps.push(entry);
    }
    setArmed(null);
    refreshAll();
  }

  // ---------- S-Parameter Import & Load ----------
  function parseTouchstone(text) {
    const lines = text.split('\n');
    let freqMult = 1e9;
    let format = 'MA';
    let z0 = 50;
    const data = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line || line.startsWith('!')) continue;
      if (line.startsWith('#')) {
        const parts = line.substring(1).trim().split(/\s+/).map(function(s){ return s.toUpperCase(); });
        if (parts.indexOf('HZ') >= 0) freqMult = 1;
        else if (parts.indexOf('KHZ') >= 0) freqMult = 1e3;
        else if (parts.indexOf('MHZ') >= 0) freqMult = 1e6;
        else if (parts.indexOf('GHZ') >= 0) freqMult = 1e9;
        if (parts.indexOf('MA') >= 0) format = 'MA';
        else if (parts.indexOf('DB') >= 0) format = 'DB';
        else if (parts.indexOf('RI') >= 0) format = 'RI';
        const rIdx = parts.indexOf('R');
        if (rIdx >= 0 && rIdx + 1 < parts.length) z0 = parseFloat(parts[rIdx + 1]);
        continue;
      }
      const parts = line.split(/\s+/).filter(function(s){ return s; });
      if (parts.length >= 3) {
        const f = parseFloat(parts[0]) * freqMult;
        const p1 = parseFloat(parts[1]);
        const p2 = parseFloat(parts[2]);
        let s11 = { re: 0, im: 0 };
        if (format === 'MA') {
          const ang = p2 * Math.PI / 180;
          s11 = { re: p1 * Math.cos(ang), im: p1 * Math.sin(ang) };
        } else if (format === 'DB') {
          const mag = Math.pow(10, p1 / 20);
          const ang = p2 * Math.PI / 180;
          s11 = { re: mag * Math.cos(ang), im: mag * Math.sin(ang) };
        } else if (format === 'RI') {
          s11 = { re: p1, im: p2 };
        }
        data.push({ f: f, s11: s11 });
      }
    }
    data.sort(function(a, b) { return a.f - b.f; });
    return { z0: z0, data: data };
  }

  function interpolateSParam(freq) {
    if (!sParamData || sParamData.length === 0) return null;
    if (freq <= sParamData[0].f) return sParamData[0].s11;
    if (freq >= sParamData[sParamData.length - 1].f) return sParamData[sParamData.length - 1].s11;
    for (let i = 0; i < sParamData.length - 1; i++) {
      if (freq >= sParamData[i].f && freq <= sParamData[i + 1].f) {
        const f0 = sParamData[i].f, f1 = sParamData[i + 1].f;
        const s0 = sParamData[i].s11, s1 = sParamData[i + 1].s11;
        const t = (freq - f0) / (f1 - f0);
        return { re: s0.re + t * (s1.re - s0.re), im: s0.im + t * (s1.im - s0.im) };
      }
    }
    return null;
  }

  function syncLoad() {
    const z0 = getZ0();
    if (sParamData && sParamData.length > 0) {
      const freq = getFreq();
      const s11 = interpolateSParam(freq);
      if (s11) {
        const num = { re: 1 + s11.re, im: s11.im };
        const den = { re: 1 - s11.re, im: -s11.im };
        let zUnnorm = cDiv(num, den);
        zUnnorm = { re: zUnnorm.re * sParamZ0, im: zUnnorm.im * sParamZ0 };
        load = { re: zUnnorm.re / z0, im: zUnnorm.im / z0 };
        loadRIn.value = fmtN(zUnnorm.re);
        loadXIn.value = fmtN(zUnnorm.im);
        loadRIn.disabled = true;
        loadXIn.disabled = true;
      }
    } else {
      const r = (parseFloat(loadRIn.value) || 0) / z0;
      const x = (parseFloat(loadXIn.value) || 0) / z0;
      load = { re: r, im: x };
      loadRIn.disabled = false;
      loadXIn.disabled = false;
    }
  }

  // ---------- Cursor tooltip ----------
  function showTip(clientX, clientY, html) {
    zcTip.innerHTML = html;
    zcTip.style.left = (clientX + 14) + 'px';
    zcTip.style.top = (clientY - 30) + 'px';   // above cursor (readout sits below)
    zcTip.style.display = 'block';
  }
  function hideTip() { zcTip.style.display = 'none'; }
  function zcTipHtml(zc) { return 'Z<sub>c</sub> = ' + fmtZc(zc) + ' Ω <small>· scroll to change</small>'; }
  function refreshTip(clientX, clientY) {
    if (clientX == null) { hideTip(); return; }
    let html = null;
    if (dragging && dragging.index != null && compUsesZc(comps[dragging.index].id)) html = zcTipHtml(comps[dragging.index].zc);
    else if (armedId && compUsesZc(armedId)) html = zcTipHtml(currentStubParams().zc);
    else if (qHotIndex >= 0) { const qs = parseQ(); if (qs[qHotIndex] != null) html = 'Q = ' + qs[qHotIndex] + ' <small>· scroll to change</small>'; }
    if (html) showTip(clientX, clientY, html); else hideTip();
  }

  // ---------- Constant-Q hover dwell ----------
  function qUnderCursor(mouse) {
    if (!chkQ.checked) return -1;
    const g = cToG(mouse.x, mouse.y);
    if (Math.hypot(g[0], g[1]) > 1) return -1;
    const qs = parseQ();
    let best = -1, bestD = 8 / R;                 // tolerance in Γ units (~8 px)
    qs.forEach(function (Q, i) {
      const rad = Math.sqrt(1 + 1 / (Q * Q));
      [-1 / Q, 1 / Q].forEach(function (cyv) {
        const d = Math.abs(Math.hypot(g[0], g[1] - cyv) - rad);
        if (d < bestD) { bestD = d; best = i; }
      });
    });
    return best;
  }
  function clearQHot() {
    if (qHotTimer) { clearTimeout(qHotTimer); qHotTimer = null; }
    qHoverIndex = -1; qHotIndex = -1;
  }
  function handleQDwell(mouse) {
    const idx = qUnderCursor(mouse);
    if (idx === qHoverIndex) return;              // still on the same circle → keep counting
    qHoverIndex = idx;
    if (qHotTimer) { clearTimeout(qHotTimer); qHotTimer = null; }
    if (idx !== qHotIndex) qHotIndex = -1;        // moved off the grabbed circle
    if (idx >= 0) {
      qHotTimer = setTimeout(function () {
        qHotIndex = qHoverIndex;                  // grab after 3 s dwell
        renderOverlay(lastMouse);
        if (lastClient) refreshTip(lastClient.x, lastClient.y);
      }, 3000);
    }
  }

  function setTraceHot(idx) { if (idx !== traceHotIndex) { traceHotIndex = idx; setSchematicHot(idx); } }

  // ---------- Events ----------
  function closeContextMenu() {
    contextMenu.style.display = 'none';
  }

  document.addEventListener('click', function(e) {
    if (!contextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });

  hoverCanvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    closeContextMenu();
    
    btnUndo.disabled = comps.length === 0;
    btnReset.disabled = comps.length === 0;

    if (armedId && compUsesZc(armedId)) {
      cmParams.style.display = 'block';
    } else {
      cmParams.style.display = 'none';
    }

    contextMenu.style.display = 'block';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    
    // adjust if it goes offscreen
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) contextMenu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    if (rect.bottom > window.innerHeight) contextMenu.style.top = (window.innerHeight - rect.height - 10) + 'px';
  });

  hoverCanvas.addEventListener('mousemove', function (e) {
    const rect = hoverCanvas.getBoundingClientRect();
    lastMouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    lastClient = { x: e.clientX, y: e.clientY };

    if (dragging && dragging.pan) {
      panX = dragging.startPanX + (lastMouse.x - dragging.startX);
      panY = dragging.startPanY + (lastMouse.y - dragging.startY);
      resize();
      return;
    }

    if (!dragging && !armedId) { handleQDwell(lastMouse); setTraceHot(traceAt(lastMouse, 6)); }
    else setTraceHot(-1);
    
    renderOverlay(lastMouse);
    hoverCanvas.style.cursor = (dragging && dragging.pan) ? 'grabbing' : dragging ? 'grabbing' : armedId ? 'pointer'
      : (hitNode(lastMouse) ? 'grab' : traceHotIndex >= 0 ? 'pointer' : 'crosshair');
    refreshTip(e.clientX, e.clientY);
  });
  hoverCanvas.addEventListener('mouseleave', function () {
    lastMouse = null;
    if (!dragging) { clearQHot(); setTraceHot(-1); renderOverlay(null); hideTip(); }
  });
  hoverCanvas.addEventListener('mousedown', function (e) {
    if (armedId) return;                          // arming uses click-to-place
    const rect = hoverCanvas.getBoundingClientRect();
    const m = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hit = hitNode(m, 10);
    if (hit) {
      e.preventDefault();
      clearQHot();
      dragging = hit;
      lastMouse = m; lastClient = { x: e.clientX, y: e.clientY };
      renderOverlay(m);
      refreshTip(e.clientX, e.clientY);
    } else {
      // Initiate pan
      dragging = { pan: true, startX: m.x, startY: m.y, startPanX: panX, startPanY: panY };
      hoverCanvas.style.cursor = 'grabbing';
    }
  });
  window.addEventListener('mouseup', function () {
    if (dragging) {
      dragging = null;
      armHint.classList.remove('show');
      hoverCanvas.style.cursor = armedId ? 'pointer' : 'crosshair';
      hideTip();
      refreshAll();
    }
  });
  hoverCanvas.addEventListener('click', function (e) {
    if (contextMenu.style.display === 'block') return;
    if (armedId) commitPreview(); 
  });
  hoverCanvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : (1 / 1.1);
    
    const rect = hoverCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const gre = (mx - cx) / R;
    const gim = (cy - my) / R;
    
    zoomScale *= zoomFactor;
    zoomScale = Math.max(0.5, Math.min(50, zoomScale));
    
    const size = wrap.clientWidth;
    const pad = 26;
    const baseR = size / 2 - pad;
    const baseCx = size / 2;
    const baseCy = size / 2;
    
    const newR = baseR * zoomScale;
    const newCx = mx - gre * newR;
    const newCy = my + gim * newR;
    
    panX = newCx - baseCx;
    panY = newCy - baseCy;
    
    resize();
  }, { passive: false });

  compBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      setArmed(armedId === b.dataset.comp ? null : b.dataset.comp);
      closeContextMenu();
    });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setArmed(null); closeContextMenu(); } });

  btnUndo.addEventListener('click', function () { comps.pop(); setArmed(null); refreshAll(); closeContextMenu(); });
  btnReset.addEventListener('click', function () { comps = []; setArmed(null); refreshAll(); closeContextMenu(); });
  btnCancel.addEventListener('click', function () { setArmed(null); closeContextMenu(); });
  document.getElementById('btn-export-svg').addEventListener('click', function () {
    const size = wrap.clientWidth * dpr;
    const svgCtx = new SVGContext(size, size);
    
    const realGctx = gctx;
    const realHctx = hctx;
    
    gctx = svgCtx;
    hctx = svgCtx;
    
    drawGrid();
    if (sParamData) drawSParamTrace();
    drawChain();
    
    gctx = realGctx;
    hctx = realHctx;
    
    const svgStr = svgCtx.toString();
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smith_chart.svg';
    a.click();
    URL.revokeObjectURL(url);
    
    closeContextMenu();
  });
  document.getElementById('btn-reset-view').addEventListener('click', function () {
    zoomScale = 1;
    panX = 0;
    panY = 0;
    resize();
    closeContextMenu();
  });

  sparamFileIn.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      const res = parseTouchstone(ev.target.result);
      if (res.data.length > 0) {
        sParamZ0 = res.z0;
        sParamData = res.data;
        btnClearSparam.style.display = 'inline-block';
        syncLoad();
        refreshAll();
      } else {
        alert('Could not parse valid S-parameter data from this file.');
      }
    };
    reader.readAsText(file);
  });

  btnClearSparam.addEventListener('click', function() {
    sParamData = null;
    sparamFileIn.value = '';
    btnClearSparam.style.display = 'none';
    syncLoad();
    refreshAll();
  });

  [loadRIn, loadXIn].forEach(function (inp) {
    inp.addEventListener('input', function () { syncLoad(); refreshAll(); });
  });
  
  [sparamFminIn, sparamFmaxIn].forEach(function (inp) {
    inp.addEventListener('input', function () { refreshAll(); });
  });
  z0Input.addEventListener('input', function () { syncLoad(); refreshAll(); });
  [freqIn, freqUnit].forEach(function (inp) {
    inp.addEventListener('input', function () { syncLoad(); refreshAll(); });
    inp.addEventListener('change', function () { syncLoad(); refreshAll(); });
  });
  [stubZcIn, stubEeffIn].forEach(function (inp) {
    inp.addEventListener('input', function () { refreshAll(); });
    inp.addEventListener('change', function () { refreshAll(); });
  });

  chkReadout.addEventListener('change', function () { if (!chkReadout.checked) readout.box.style.display = 'none'; });
  chkImped.addEventListener('change', function () { drawGrid(); renderOverlay(null); });
  chkAdmit.addEventListener('change', function () { drawGrid(); renderOverlay(null); });
  chkQ.addEventListener('change', function () { if (!chkQ.checked) clearQHot(); drawGrid(); renderOverlay(null); });
  qValIn.addEventListener('input', function () { if (chkQ.checked) { drawGrid(); renderOverlay(null); } });
  resSlider.addEventListener('input', function () {
    resLabel.textContent = RES_NAMES[parseInt(resSlider.value, 10) - 1];
    drawGrid(); renderOverlay(null);
  });

  let rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 100); });

  // ---------- Init ----------
  resLabel.textContent = RES_NAMES[parseInt(resSlider.value, 10) - 1];
  syncLoad();
  resize();
  refreshAll();
})();
