/* ============================================
   smith.js — Interactive Smith Chart
   Impedance / admittance grids, adjustable
   resolution, live hover readout + crosshair.
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

  const readout = {
    box:  document.getElementById('readout'),
    z:    document.getElementById('rd-z'),
    zOhm: document.getElementById('rd-z-ohm'),
    y:    document.getElementById('rd-y'),
    yS:   document.getElementById('rd-y-siemens'),
    zRow: document.getElementById('row-z'),
    zRow2:document.getElementById('row-z-ohm'),
    yRow: document.getElementById('row-y'),
    yRow2:document.getElementById('row-y-siemens'),
    gamma:document.getElementById('rd-gamma'),
    vswr: document.getElementById('rd-vswr'),
    hint: document.getElementById('readout-hint'),
  };

  // ---------- Colours (chart is always on white) ----------
  const COL = {
    axis:      '#333333',
    outer:     '#222222',
    imped:     '#c0392b',   // resistance / reactance — red
    impedMinor:'#e8b4ad',
    admit:     '#2166ac',   // conductance / susceptance — blue
    admitMinor:'#aecbe5',
    label:     '#555555',
    crosshair: 'rgba(40,40,40,0.35)',
    vswr:      'rgba(180,80,20,0.5)',
    point:     '#111111',
  };

  // ---------- Resolution presets ----------
  // Each level is a set of normalized magnitudes used for both the
  // resistance/conductance circles and the reactance/susceptance arcs.
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

  // ---------- Geometry (CSS pixels) ----------
  let cx = 0, cy = 0, R = 0, dpr = 1;

  function gToC(gre, gim) { return [cx + gre * R, cy - gim * R]; }
  function cToG(px, py)   { return [(px - cx) / R, (cy - py) / R]; }

  // ---------- Sizing / HiDPI ----------
  function resize() {
    const size = wrap.clientWidth;              // square area
    dpr = window.devicePixelRatio || 1;
    [gridCanvas, hoverCanvas].forEach(function (c) {
      c.width  = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
      c.style.width  = size + 'px';
      c.style.height = size + 'px';
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    const pad = 26;                             // room for perimeter labels
    cx = size / 2;
    cy = size / 2;
    R  = size / 2 - pad;
    drawGrid();
    clearHover();
  }

  // ---------- Draw a circle defined in the Γ-plane ----------
  function gCircle(ctx, gcx, gcy, gr) {
    const [ccx, ccy] = gToC(gcx, gcy);
    ctx.beginPath();
    ctx.arc(ccx, ccy, gr * R, 0, 2 * Math.PI);
    ctx.stroke();
  }

  function clipUnit(ctx) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.clip();
  }

  // ---------- Grid ----------
  function drawGrid() {
    gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);

    // White backing disk
    gctx.save();
    gctx.beginPath();
    gctx.arc(cx, cy, R, 0, 2 * Math.PI);
    gctx.fillStyle = '#ffffff';
    gctx.fill();
    gctx.restore();

    const vals = RES_LEVELS[parseInt(resSlider.value, 10) - 1];
    const showZ = chkImped.checked;
    const showY = chkAdmit.checked;

    // Grids are clipped to the unit disk so arcs terminate at the boundary.
    if (showY) drawFamily(vals, false);   // draw admittance first (under)
    if (showZ) drawFamily(vals, true);

    // Real axis
    gctx.save();
    gctx.strokeStyle = COL.axis;
    gctx.lineWidth = 1.1;
    gctx.beginPath();
    gctx.moveTo(cx - R, cy);
    gctx.lineTo(cx + R, cy);
    gctx.stroke();
    gctx.restore();

    // Outer boundary
    gctx.save();
    gctx.strokeStyle = COL.outer;
    gctx.lineWidth = 1.6;
    gctx.beginPath();
    gctx.arc(cx, cy, R, 0, 2 * Math.PI);
    gctx.stroke();
    gctx.restore();

    // Labels
    if (showZ) drawLabels(vals, true);
    if (showY) drawLabels(vals, false);
  }

  // isImped=true → resistance/reactance (red), else conductance/susceptance (blue)
  function drawFamily(vals, isImped) {
    const sign = isImped ? 1 : -1;             // admittance = Γ → -Γ
    const major = isImped ? COL.imped : COL.admit;
    const minor = isImped ? COL.impedMinor : COL.admitMinor;

    gctx.save();
    clipUnit(gctx);

    vals.forEach(function (v) {
      const isMaj = MAJOR.has(v);
      gctx.strokeStyle = isMaj ? major : minor;
      gctx.lineWidth = isMaj ? 1.1 : 0.7;

      // constant resistance / conductance circle
      gCircle(gctx, sign * (v / (1 + v)), 0, 1 / (1 + v));

      // constant reactance / susceptance arcs (± both halves)
      gCircle(gctx, sign * 1, sign * (1 / v), 1 / v);
      gCircle(gctx, sign * 1, sign * (-1 / v), 1 / v);
    });

    gctx.restore();
  }

  function drawLabels(vals, isImped) {
    const sign = isImped ? 1 : -1;
    gctx.save();
    gctx.fillStyle = isImped ? COL.imped : COL.admit;
    gctx.font = '600 11px "JetBrains Mono", "Fira Code", monospace';
    gctx.textAlign = 'center';
    gctx.textBaseline = 'middle';

    vals.forEach(function (v) {
      if (!MAJOR.has(v)) return;

      // resistance / conductance on the real axis
      const axG = sign * ((v - 1) / (v + 1));
      const [ax, ay] = gToC(axG, 0);
      gctx.save();
      gctx.fillStyle = '#ffffff';
      const txt = String(v);
      const w = gctx.measureText(txt).width + 4;
      gctx.fillRect(ax - w / 2, ay + 3, w, 13);
      gctx.fillStyle = isImped ? COL.imped : COL.admit;
      gctx.textBaseline = 'top';
      gctx.fillText(txt, ax, ay + 4);
      gctx.restore();

      // reactance / susceptance at the perimeter (± signs)
      [v, -v].forEach(function (xv) {
        const d = xv * xv + 1;
        let gre = (xv * xv - 1) / d;
        let gim = (2 * xv) / d;
        gre *= sign; gim *= sign;
        const [px, py] = gToC(gre, gim);
        const nx = (px - cx), ny = (py - cy);
        const len = Math.hypot(nx, ny) || 1;
        const lx = cx + (nx / len) * (R + 13);
        const ly = cy + (ny / len) * (R + 13);
        gctx.textBaseline = 'middle';
        gctx.fillStyle = isImped ? COL.imped : COL.admit;
        gctx.fillText((xv > 0 ? '' : '−') + Math.abs(xv), lx, ly);
      });
    });
    gctx.restore();
  }

  // ---------- Hover ----------
  function clearHover() {
    hctx.clearRect(0, 0, hoverCanvas.width, hoverCanvas.height);
  }

  function fmt(n) {
    if (!isFinite(n)) return '∞';
    const a = Math.abs(n);
    if (a >= 1000) return n.toFixed(0);
    if (a >= 100)  return n.toFixed(1);
    if (a >= 1)    return n.toFixed(3);
    return n.toFixed(4);
  }
  // complex a+jb string
  function cplx(re, im) {
    if (!isFinite(re) || !isFinite(im)) return '∞';
    return fmt(re) + (im >= 0 ? ' + j' : ' − j') + fmt(Math.abs(im));
  }

  function onMove(evt) {
    const rect = hoverCanvas.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const py = evt.clientY - rect.top;
    const [gre, gim] = cToG(px, py);
    const rho = Math.hypot(gre, gim);

    clearHover();

    if (rho > 1.0001) {                          // outside the chart
      readout.box.classList.remove('readout--active');
      readout.hint.style.display = '';
      return;
    }
    readout.box.classList.add('readout--active');
    readout.hint.style.display = 'none';

    const [sx, sy] = gToC(gre, gim);   // hover point in canvas coords

    // --- constant-VSWR (|Γ|) circle through the point ---
    hctx.save();
    clipUnit(hctx);
    hctx.strokeStyle = COL.vswr;
    hctx.lineWidth = 1;
    hctx.setLineDash([2, 3]);
    hctx.beginPath();
    hctx.arc(cx, cy, rho * R, 0, 2 * Math.PI);
    hctx.stroke();
    hctx.restore();

    // --- Γ vector from centre + point marker ---
    hctx.save();
    hctx.strokeStyle = COL.crosshair;
    hctx.lineWidth = 1;
    hctx.beginPath();
    hctx.moveTo(cx, cy); hctx.lineTo(sx, sy);
    hctx.stroke();
    hctx.fillStyle = COL.point;
    hctx.beginPath();
    hctx.arc(sx, sy, 3.5, 0, 2 * Math.PI);
    hctx.fill();
    hctx.restore();

    // ---------- Compute impedance / admittance ----------
    const z0 = parseFloat(z0Input.value) || 50;

    // z = (1+Γ)/(1-Γ)
    const dz = (1 - gre) * (1 - gre) + gim * gim;
    const zr = (1 - gre * gre - gim * gim) / dz;
    const zx = (2 * gim) / dz;

    // y = (1-Γ)/(1+Γ)
    const dy = (1 + gre) * (1 + gre) + gim * gim;
    const yg = (1 - gre * gre - gim * gim) / dy;
    const yb = (-2 * gim) / dy;

    const vswr = rho >= 1 ? Infinity : (1 + rho) / (1 - rho);
    const angDeg = Math.atan2(gim, gre) * 180 / Math.PI;

    readout.gamma.textContent = fmt(rho) + ' ∠ ' + angDeg.toFixed(1) + '°';
    readout.vswr.textContent  = isFinite(vswr) ? fmt(vswr) + ' : 1' : '∞ : 1';

    const showZ = chkImped.checked;
    const showY = chkAdmit.checked;

    // Toggle both the term (<dt>) and its value (<dd>) so the grid stays aligned
    readout.zRow.style.display  = showZ ? '' : 'none';
    readout.z.style.display     = showZ ? '' : 'none';
    readout.zRow2.style.display = showZ ? '' : 'none';
    readout.zOhm.style.display  = showZ ? '' : 'none';
    readout.yRow.style.display  = showY ? '' : 'none';
    readout.y.style.display     = showY ? '' : 'none';
    readout.yRow2.style.display = showY ? '' : 'none';
    readout.yS.style.display    = showY ? '' : 'none';

    if (showZ) {
      readout.z.textContent = cplx(zr, zx);
      readout.zOhm.textContent = cplx(zr * z0, zx * z0) + ' Ω';
    }
    if (showY) {
      readout.y.textContent = cplx(yg, yb);
      // admittance in millisiemens
      readout.yS.textContent = cplx(yg / z0 * 1000, yb / z0 * 1000) + ' mS';
    }
  }

  // ---------- Events ----------
  hoverCanvas.addEventListener('mousemove', onMove);
  hoverCanvas.addEventListener('mouseleave', function () {
    clearHover();
    readout.box.classList.remove('readout--active');
    readout.hint.style.display = '';
  });

  chkImped.addEventListener('change', drawGrid);
  chkAdmit.addEventListener('change', drawGrid);
  resSlider.addEventListener('input', function () {
    resLabel.textContent = RES_NAMES[parseInt(resSlider.value, 10) - 1];
    drawGrid();
  });
  z0Input.addEventListener('input', function () { /* readout updates on next move */ });

  let rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 100);
  });

  // ---------- Init ----------
  resLabel.textContent = RES_NAMES[parseInt(resSlider.value, 10) - 1];
  resize();
})();
