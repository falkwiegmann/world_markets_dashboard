/* Markets dashboard — vanilla JS, no dependencies.
   Reads window.FIN_DATA (written by the data fetcher) and renders
   W&B-style panel sections with crosshair tooltips. */

(function () {
  "use strict";

  let DATA = window.FIN_DATA;

  // ---------- Derived ratio series (computed client-side) ----------

  const DERIVED = [
    { key: "spxgold", name: "S&P 500 / Gold", num: "spx", den: "gold", decimals: 3 },
    { key: "spxtlt", name: "S&P 500 / TLT (treasuries)", num: "spx", den: "tlt", decimals: 1 },
    { key: "spxrow", name: "S&P 500 / World ex-US (VEU)", num: "spx", den: "veu", decimals: 1 },
    { key: "ndxspx", name: "NASDAQ 100 / S&P 500", num: "ndx", den: "spx", decimals: 3 },
    { key: "coppergold", name: "Copper / Gold ×1000", num: "copper", den: "gold", scale: 1000, decimals: 3 },
    { key: "btcgold", name: "Bitcoin / Gold", num: "btc", den: "gold", decimals: 2 },
    { key: "ustspread", name: "US 10Y − Euro 10Y spread", num: "us10y", den: "eu10y", op: "sub", unit: "%", decimals: 3 },
    { key: "t30t2", name: "US 30Y − 2Y spread", num: "us30y", den: "us2y", op: "sub", unit: "%", decimals: 3 },
  ];

  function lerpAt(pts, t) {
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; (pts[m][0] <= t ? (lo = m) : (hi = m)); }
    const [ta, va] = pts[lo], [tb, vb] = pts[hi];
    return va + ((vb - va) * (t - ta)) / (tb - ta);
  }
  function anchorAt(pts, t) {
    let lo = 0, hi = pts.length - 1;
    if (t <= pts[0][0]) return pts[0];
    if (t >= pts[hi][0]) return pts[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; (pts[m][0] <= t ? (lo = m) : (hi = m)); }
    return pts[lo];
  }

  // The multpl series are monthly, but P/E, CAPE, and dividend yield move with
  // the daily S&P price — only their earnings/dividend legs are slow. Recompute
  // them on the daily S&P grid (EPS linearly interpolated, held flat past its
  // last month), keeping the original monthly history before the daily window.
  function refineValuation() {
    const spx = DATA.series.spx;
    if (!spx) return;
    const grid = spx.points;
    const t0 = grid[0][0];
    const eps = DATA.series.eps && DATA.series.eps.points;
    const cape = DATA.series.cape && DATA.series.cape.points;
    const dy = DATA.series.divyield && DATA.series.divyield.points;
    const divDollars = dy && dy
      .filter((p) => p[0] >= t0 - 40 * 86400000)
      .map(([t, v]) => [t, (v / 100) * lerpAt(grid, t)]);

    const refine = (key, fn) => {
      const s = DATA.series[key];
      if (!s || s.daily) return;
      const head = s.points.filter((p) => p[0] < t0);
      const tail = grid
        .map(([t, v]) => [t, +fn(t, v).toFixed(s.decimals)])
        .filter((p) => isFinite(p[1]));
      DATA.series[key] = {
        ...s, points: head.concat(tail), daily: true,
        src: (s.src || "") + " · monthly, interpolated to daily by this page using the S&P 500 price",
      };
    };

    if (eps) refine("eps", (t) => lerpAt(eps, t));
    if (eps) refine("pe", (t, price) => price / lerpAt(eps, t));
    if (divDollars && divDollars.length >= 2) {
      refine("divyield", (t, price) => (lerpAt(divDollars, t) / price) * 100);
    }
    if (cape) refine("cape", (t, price) => {
      const [ta, va] = anchorAt(cape, t);
      return va * (price / lerpAt(grid, ta));
    });
  }

  // Align two daily series by timestamp: for each numerator point, divide by
  // the most recent denominator value at or before it (different markets skip
  // different holidays).
  function buildDerived() {
    refineValuation();
    for (const d of DERIVED) {
      const num = DATA.series[d.num], den = DATA.series[d.den];
      if (!num || !den) continue;
      const points = [];
      let j = -1;
      for (const [t, v] of num.points) {
        while (j + 1 < den.points.length && den.points[j + 1][0] <= t + 43200000) j++;
        if (j < 0 || (d.op !== "sub" && !den.points[j][1])) continue;
        const val = d.op === "sub" ? v - den.points[j][1] : (v / den.points[j][1]) * (d.scale || 1);
        points.push([t, +val.toFixed(d.decimals)]);
      }
      if (points.length >= 2) {
        DATA.series[d.key] = {
          name: d.name, unit: d.unit || "", decimals: d.decimals, points,
          src: "Computed by this page from " + num.name + " and " + den.name,
        };
      }
    }
  }
  buildDerived();

  // ---------- Layout config (display layer only — data comes from data.js) ----------

  const TILES = [
    { key: "spx" }, { key: "ndx" }, { key: "eurusd", decimals: 4 },
    { key: "us10y", upIsGood: null }, { key: "gold" }, { key: "btc" },
  ];

  const SECTIONS = [
    {
      title: "Equity indices",
      panels: [
        { title: "Major indices", series: ["spx", "ndx", "sx5e", "dax", "n225"], indexed: true },
        { series: ["spx"] }, { series: ["ndx"] }, { series: ["sx5e"] },
        { series: ["dax"] }, { series: ["n225"] },
      ],
    },
    {
      title: "FX & rates",
      panels: [
        { title: "Central bank policy rates", series: ["pol_us", "pol_xm", "pol_gb", "pol_jp", "pol_ch", "pol_ca", "pol_au"] },
        { title: "10Y yields", series: ["us10y", "eu10y"] },
        { series: ["eurusd"] }, { series: ["gbpusd"] }, { series: ["usdjpy"] },
        { series: ["us10y"] }, { series: ["eu10y"] },
      ],
    },
    {
      title: "Ratios & valuation",
      panels: [
        { series: ["spxgold"] }, { series: ["spxtlt"] }, { series: ["spxrow"] },
        { series: ["ndxspx"] }, { series: ["coppergold"] }, { series: ["btcgold"] },
        { series: ["ustspread"] }, { series: ["t30t2"] }, { series: ["mxnjpy"] },
        { series: ["eps"] }, { series: ["pe"] },
        { series: ["cape"] }, { series: ["divyield"] },
        { title: "Home prices", series: ["hpi", "hpi_ca", "hpi_de", "hpi_au", "hpi_uk"], indexed: true },
      ],
    },
    {
      title: "Commodities & crypto",
      panels: [
        { title: "Crypto", series: ["btc", "eth"], indexed: true },
        { series: ["gold"] }, { series: ["brent"] },
        { series: ["btc"] }, { series: ["eth"] },
      ],
    },
  ];

  const RANGES = [
    { label: "1W", days: 7 }, { label: "1M", days: 31 }, { label: "3M", days: 92 },
    { label: "1Y", days: 366 }, { label: "3Y", days: 1096 }, { label: "5Y", days: 1827 },
    { label: "10Y", days: 3653 }, { label: "All", days: Infinity },
  ];
  const SPAN_MIN = 7, SPAN_MAX = 5600; // custom-slider domain (days), log-scaled

  function fmtSpan(days) {
    if (days < 90) return days + "d";
    if (days < 730) return Math.round(days / 30.44) + "mo";
    return (days / 365.25).toFixed(1).replace(/\.0$/, "") + "y";
  }

  // Preset buttons + log-scale slider for a custom timespan. Used by the
  // topbar and by each fullscreen modal.
  function createRangeControls(initial, onChange) {
    let current = initial;
    const root = el("div", "range-controls");
    const row = el("div", "range-row");
    const buttons = RANGES.map((r) => {
      const b = el("button", null, r.label);
      b.addEventListener("click", () => apply(r));
      row.appendChild(b);
      return b;
    });
    root.appendChild(row);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1000";
    slider.step = "1";
    slider.className = "range-slider";
    slider.title = "Custom timespan (logarithmic)";
    slider.setAttribute("aria-label", "Custom timespan, logarithmic scale");
    const lbl = el("span", "range-span-label");
    let raf = null;
    slider.addEventListener("input", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        // Flipped axis: far left = All, sliding right shortens the span
        const pos = +slider.value;
        const days = pos <= 0 ? Infinity
          : Math.round(SPAN_MIN * Math.pow(SPAN_MAX / SPAN_MIN, (1000 - pos) / 1000));
        apply(days === Infinity ? RANGES[RANGES.length - 1]
          : { label: fmtSpan(days), days, custom: true });
      });
    });
    root.appendChild(slider);
    root.appendChild(lbl);

    const posFor = (days) => days === Infinity ? 0
      : 1000 - Math.round((1000 * Math.log(days / SPAN_MIN)) / Math.log(SPAN_MAX / SPAN_MIN));
    function sync() {
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(RANGES[i] === current)));
      slider.value = String(Math.max(0, Math.min(1000, posFor(current.days))));
      lbl.textContent = current.days === Infinity ? "All" : fmtSpan(current.days);
    }
    function apply(r) { current = r; sync(); onChange(r); }
    sync();
    return { root, set(r) { current = r; sync(); } };
  }

  const SERIES_VARS = ["--series-1", "--series-2", "--series-3", "--series-4",
    "--series-5", "--series-6", "--series-7", "--series-8"];

  // Fixed slot per entity, assigned once in config order — a range change or
  // future filter must never repaint survivors.
  const slotOf = {};
  (function assignSlots() {
    let i = 0;
    for (const key of Object.keys(DATA.series)) slotOf[key] = SERIES_VARS[i++ % SERIES_VARS.length];
  })();

  let state = { range: RANGES[3] }; // default 1Y

  // ---------- Helpers ----------

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function fmtValue(v, s) {
    const dec = s.decimals != null ? s.decimals : 2;
    const num = v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (s.unit === "$") return "$" + num;
    if (s.unit === "%") return num + "%";
    return num;
  }
  function fmtDate(t) {
    return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  function fmtDateShort(t, spanDays) {
    const opts = spanDays > 360 ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" };
    return new Date(t).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  }

  function sliceRange(points, range) {
    if (range.days === Infinity) return points;
    const cutoff = points[points.length - 1][0] - range.days * 86400000;
    const out = points.filter((p) => p[0] >= cutoff);
    return out.length >= 2 ? out : points.slice(-2);
  }

  function niceTicks(min, max, count) {
    const span = max - min || Math.abs(max) || 1;
    const step = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const ticks = [];
    for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) ticks.push(+v.toFixed(10));
    return ticks;
  }

  // Instant hover tip — native `title` tooltips have a fixed ~1s delay
  function instantTip(target, text) {
    let tip = null;
    target.addEventListener("pointerenter", () => {
      tip = el("div", "hovertip", text);
      document.body.appendChild(tip);
      const r = target.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8)) + "px";
      tip.style.top = (r.bottom + 6) + "px";
    });
    const hide = () => { if (tip) { tip.remove(); tip = null; } };
    target.addEventListener("pointerleave", hide);
    target.addEventListener("pointerdown", hide);
  }

  function fmtAge(ms) {
    const mins = Math.round(ms / 60000);
    return mins < 1 ? "just now"
      : mins < 60 ? mins + " min ago"
      : mins < 48 * 60 ? Math.round(mins / 60) + " h ago"
      : Math.round(mins / 1440) + " days ago";
  }

  function deltaNode(pct, upIsGood) {
    const up = pct >= 0;
    const cls = upIsGood === null ? "" : (up === !!upIsGood ? "up" : "down");
    const d = el("span", ("delta " + cls).trim(), (up ? "+" : "") + pct.toFixed(2) + "%");
    return d;
  }

  // Change from `from` to `to`, honoring the series' unit: percent-denominated
  // series (yields, policy rates, spreads) get point differences — a relative
  // change of a percentage is meaningless and explodes near zero.
  function changeNode(s, from, to, upIsGood) {
    if (s.unit === "%") {
      const diff = to - from;
      const cls = upIsGood === null ? "" : ((diff >= 0) === (upIsGood !== false) ? "up" : "down");
      return el("span", ("delta " + cls).trim(), (diff >= 0 ? "+" : "") + diff.toFixed(2) + " pp");
    }
    return deltaNode(((to - from) / from) * 100, upIsGood);
  }

  // ---------- Chart ----------

  const PAD = { top: 12, right: 14, bottom: 24, left: 8 };

  function renderChart(container, panel, range, dims) {
    const W = (dims && dims.W) || 600, H = (dims && dims.H) || 210;
    const keys = panel.series;
    const multi = keys.length > 1;
    // Decimate long ranges for drawing speed — ~3 points per pixel is already
    // beyond visual resolution; always keep the endpoints.
    const MAXPTS = 1500;
    const decimate = (pts) => {
      if (pts.length <= MAXPTS) return pts;
      const stride = Math.ceil(pts.length / MAXPTS);
      const out = pts.filter((_, i) => i % stride === 0);
      if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
      return out;
    };
    const sliced = keys.map((k) => decimate(sliceRange(DATA.series[k].points, range)));

    // Indexed panels rebase every series to 100 at the range start — the
    // one-axis rule for series of different scale.
    const rows = sliced.map((pts) =>
      panel.indexed ? pts.map((p) => [p[0], (p[1] / pts[0][1]) * 100]) : pts.map((p) => [p[0], p[1]])
    );

    const t0 = Math.min(...rows.map((r) => r[0][0]));
    const t1 = Math.max(...rows.map((r) => r[r.length - 1][0]));
    let vMin = Infinity, vMax = -Infinity;
    for (const r of rows) for (const p of r) { if (p[1] < vMin) vMin = p[1]; if (p[1] > vMax) vMax = p[1]; }
    const vPad = (vMax - vMin || Math.abs(vMax) || 1) * 0.08;
    vMin -= vPad; vMax += vPad;

    const x = (t) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
    const y = (v) => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD.top - PAD.bottom);

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });

    // Gridlines + y tick labels (hairline, recessive, clean numbers)
    const yTicks = niceTicks(vMin, vMax, 4);
    const fmtTick = (v) => {
      if (panel.indexed) return v.toFixed(0);
      const s = DATA.series[keys[0]];
      const dec = Math.abs(v) >= 1000 ? 0 : (s.decimals != null ? Math.min(s.decimals, 2) : 2);
      return Math.abs(v) >= 10000
        ? (v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "k"
        : v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    };
    for (const tv of yTicks) {
      svg.appendChild(svgEl("line", { x1: PAD.left, x2: W - PAD.right, y1: y(tv), y2: y(tv), stroke: css("--grid"), "stroke-width": 1 }));
      const lbl = svgEl("text", {
        x: PAD.left + 2, y: y(tv) - 4, fill: css("--text-muted"),
        "font-size": 10.5, "font-family": "inherit",
      });
      lbl.textContent = fmtTick(tv);
      svg.appendChild(lbl);
    }

    // Calendar-year boundaries: faint vertical hairline at every 1 Jan in
    // range; on long ranges only every Nth line gets a year label.
    const yr0 = new Date(t0).getUTCFullYear() + 1, yr1 = new Date(t1).getUTCFullYear();
    const labelStep = Math.max(1, Math.ceil((yr1 - yr0 + 1) / 7));
    for (let yr = yr0; yr <= yr1; yr++) {
      const tj = Date.UTC(yr, 0, 1);
      if (tj <= t0 || tj >= t1) continue;
      svg.appendChild(svgEl("line", {
        x1: x(tj), x2: x(tj), y1: PAD.top, y2: H - PAD.bottom,
        stroke: css("--grid"), "stroke-width": 1,
      }));
      if ((yr - yr0) % labelStep !== 0) continue;
      const lbl = svgEl("text", {
        x: x(tj) + 4, y: PAD.top + 9, fill: css("--text-muted"),
        "font-size": 9.5, "font-family": "inherit",
      });
      lbl.textContent = String(yr);
      svg.appendChild(lbl);
    }

    // X tick labels: first / middle / last
    const spanDays = (t1 - t0) / 86400000;
    const xTickTs = [t0, t0 + (t1 - t0) / 2, t1];
    xTickTs.forEach((tt, i) => {
      const anchor = i === 0 ? "start" : i === 2 ? "end" : "middle";
      const lbl = svgEl("text", {
        x: x(tt), y: H - 8, fill: css("--text-muted"), "text-anchor": anchor,
        "font-size": 10.5, "font-family": "inherit",
      });
      lbl.textContent = fmtDateShort(tt, spanDays);
      svg.appendChild(lbl);
    });

    // Area wash (single series only) + lines
    rows.forEach((r, i) => {
      const color = css(slotOf[keys[i]]);
      const d = r.map((p, j) => (j ? "L" : "M") + x(p[0]).toFixed(2) + " " + y(p[1]).toFixed(2)).join("");
      if (!multi) {
        const yBase = H - PAD.bottom;
        svg.appendChild(svgEl("path", {
          d: d + `L${x(r[r.length - 1][0]).toFixed(2)} ${yBase}L${x(r[0][0]).toFixed(2)} ${yBase}Z`,
          fill: color, opacity: 0.1,
        }));
      }
      svg.appendChild(svgEl("path", {
        d, fill: "none", stroke: color, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round",
      }));
      // End marker with surface ring
      const last = r[r.length - 1];
      svg.appendChild(svgEl("circle", {
        cx: x(last[0]), cy: y(last[1]), r: 4, fill: color,
        stroke: css("--surface-1"), "stroke-width": 2,
      }));
    });

    // Crosshair + hover dots (hidden until pointer enters)
    const cross = svgEl("line", {
      y1: PAD.top, y2: H - PAD.bottom, stroke: css("--baseline"),
      "stroke-width": 1, visibility: "hidden",
    });
    svg.appendChild(cross);
    const hoverDots = rows.map((_, i) => {
      const dot = svgEl("circle", {
        r: 4, fill: css(slotOf[keys[i]]), stroke: css("--surface-1"),
        "stroke-width": 2, visibility: "hidden",
      });
      svg.appendChild(dot);
      return dot;
    });

    // Tooltip (one tooltip, every series; values lead)
    const tip = el("div", "tooltip");
    const tipDate = el("div", "tt-date");
    tip.appendChild(tipDate);
    const tipTable = document.createElement("table");
    const tipRows = keys.map((k, i) => {
      const tr = document.createElement("tr");
      const tdKey = document.createElement("td");
      const swatch = el("span", "tt-key");
      swatch.style.background = css(slotOf[k]);
      tdKey.appendChild(swatch);
      const tdName = el("td", "tt-name", DATA.series[k].name);
      const tdVal = el("td", "tt-val");
      const tdChg = el("td", "tt-chg");
      tr.append(tdKey, tdName, tdVal, tdChg);
      tipTable.appendChild(tr);
      return { tdVal, tdChg };
    });
    tip.appendChild(tipTable);
    container.appendChild(tip);

    // The crosshair finds the X: snap to nearest data position of the first series.
    const anchor = rows[0];
    function onMove(ev) {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const tAt = t0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (t1 - t0);
      let lo = 0, hi = anchor.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; (anchor[mid][0] < tAt ? (lo = mid) : (hi = mid)); }
      const idx = tAt - anchor[lo][0] < anchor[hi][0] - tAt ? lo : hi;
      const ts = anchor[idx][0];
      const cx = x(ts);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
      cross.setAttribute("visibility", "visible");

      tipDate.textContent = fmtDate(ts);
      rows.forEach((r, i) => {
        // Series may skip dates; find nearest point at or before ts.
        let j = Math.min(idx, r.length - 1);
        while (j > 0 && r[j][0] > ts) j--;
        while (j < r.length - 1 && r[j + 1][0] <= ts) j++;
        const v = r[j][1];
        tipRows[i].tdVal.textContent = panel.indexed ? v.toFixed(1) : fmtValue(v, DATA.series[keys[i]]);
        // change from the hovered point to the latest live value (raw scale, so
        // it's identical on indexed panels); point-difference for %-unit series
        const raw = sliced[i][j][1];
        const live = sliced[i][sliced[i].length - 1][1];
        const su = DATA.series[keys[i]];
        let chg, up;
        if (su.unit === "%") {
          const diff = live - raw;
          up = diff >= 0;
          chg = (up ? "+" : "") + diff.toFixed(2) + " pp to now";
        } else {
          const pct = (live / raw - 1) * 100;
          up = pct >= 0;
          chg = (up ? "+" : "") + pct.toFixed(2) + "% to now";
        }
        tipRows[i].tdChg.textContent = chg;
        tipRows[i].tdChg.className = "tt-chg " + (up ? "up" : "down");
        hoverDots[i].setAttribute("cx", x(r[j][0]));
        hoverDots[i].setAttribute("cy", y(v));
        hoverDots[i].setAttribute("visibility", "visible");
      });

      tip.style.display = "block";
      const cRect = container.getBoundingClientRect();
      const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
      let left = ev.clientX - cRect.left + 14;
      if (left + tipW > cRect.width - 4) left = ev.clientX - cRect.left - tipW - 14;
      left = Math.max(2, Math.min(left, cRect.width - tipW - 2));
      let top = ev.clientY - cRect.top - tipH / 2;
      top = Math.max(2, Math.min(top, cRect.height - tipH - 2));
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    function onLeave() {
      cross.setAttribute("visibility", "hidden");
      hoverDots.forEach((d) => d.setAttribute("visibility", "hidden"));
      tip.style.display = "none";
    }
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerleave", onLeave);

    container.appendChild(svg);
  }

  // ---------- Icons ----------

  function icon(name) {
    const svg = svgEl("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": "true" });
    if (name === "grip") {
      [[4.5, 3], [11.5, 3], [4.5, 8], [11.5, 8], [4.5, 13], [11.5, 13]].forEach(([cx, cy]) =>
        svg.appendChild(svgEl("circle", { cx, cy, r: 1.4, fill: "currentColor" })));
    } else {
      const d = name === "expand"
        ? "M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9"
        : "M3 3l10 10M13 3L3 13";
      svg.appendChild(svgEl("path", {
        d, fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round",
      }));
    }
    return svg;
  }

  // ---------- Layout order (drag to reorder, persisted) ----------

  const ORDER_KEY = "markets.layoutOrder.v1";
  let savedOrder = {};
  try { savedOrder = JSON.parse(localStorage.getItem(ORDER_KEY) || "{}"); } catch (e) { /* ignore */ }

  const panelId = (p) => p.title || p.series.join("+");

  function applyOrder(list, ids, idFn) {
    if (!ids || !ids.length) return list;
    return [...list].sort((a, b) => {
      const ia = ids.indexOf(idFn(a)), ib = ids.indexOf(idFn(b));
      return (ia === -1 ? ids.length + list.indexOf(a) : ia) - (ib === -1 ? ids.length + list.indexOf(b) : ib);
    });
  }

  function saveOrder(group, container) {
    savedOrder[group] = [...container.children].map((c) => c.dataset.pid).filter(Boolean);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(savedOrder)); } catch (e) { /* ignore */ }
  }

  // One grid = one drop zone; items only reorder within their own grid.
  function makeSortable(container, group) {
    container.addEventListener("dragover", (e) => {
      const dragging = container.querySelector(".dragging");
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      let ref = null;
      for (const kid of container.children) {
        if (kid === dragging) continue;
        const r = kid.getBoundingClientRect();
        const sameRow = e.clientY >= r.top && e.clientY <= r.bottom;
        if (sameRow ? e.clientX < r.left + r.width / 2 : e.clientY < r.top) { ref = kid; break; }
      }
      if (ref !== dragging.nextSibling) container.insertBefore(dragging, ref);
    });
    container.addEventListener("drop", (e) => e.preventDefault());
    container.addEventListener("dragend", () => saveOrder(group, container));
  }

  function makeDragHandle(item) {
    const handle = el("button", "icon-btn drag-handle");
    handle.title = "Drag to reorder";
    handle.appendChild(icon("grip"));
    handle.addEventListener("pointerdown", () => { item.draggable = true; });
    handle.addEventListener("pointerup", () => { item.draggable = false; });
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", item.dataset.pid || "");
      e.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => item.classList.add("dragging"));
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      item.draggable = false;
    });
    return handle;
  }

  // ---------- Fullscreen modal ----------

  function openModal(panel) {
    const backdrop = el("div", "modal-backdrop");
    const modal = el("div", "modal");
    const head = el("div", "card-head");
    const keys = panel.series;
    const title = panel.title || DATA.series[keys[0]].name;
    head.appendChild(el("span", "title", panel.indexed ? title + " · indexed to 100" : title));

    // Modal-local time range: starts at the page's range, changes only this view
    let mRange = state.range;

    const controls = createRangeControls(mRange, (r) => setRange(r));
    controls.root.style.marginLeft = "auto";
    head.appendChild(controls.root);

    const lastWrap = keys.length === 1 ? el("span", "last") : null;
    if (lastWrap) head.appendChild(lastWrap);

    const closeBtn = el("button", "icon-btn close-btn");
    closeBtn.title = "Close";
    closeBtn.appendChild(icon("close"));
    head.appendChild(closeBtn);
    modal.appendChild(head);
    if (keys.length > 1) modal.appendChild(buildLegend(keys));

    const chartBox = el("div", "chart");
    modal.appendChild(chartBox);

    function setRange(r) {
      mRange = r;
      controls.set(r);
      if (lastWrap) {
        const s = DATA.series[keys[0]];
        const pts = sliceRange(s.points, r);
        const last = pts[pts.length - 1][1];
        lastWrap.textContent = fmtValue(last, s);
        lastWrap.appendChild(changeNode(s, pts[0][1], last, true));
      }
      chartBox.textContent = "";
      renderChart(chartBox, panel, r, { W: 1200, H: 460 });
    }
    setRange(mRange);

    // Footnote: source + recency of the newest data point, per series
    const foot = el("div", "modal-foot");
    keys.forEach((k) => {
      const s = DATA.series[k];
      const lastT = s.points[s.points.length - 1][0];
      const age = Date.now() - lastT;
      const d = new Date(lastT);
      let when = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      // date-only series stamp midnight — showing "00:00" would imply intraday precision
      if (age < 48 * 3600000 && lastT % 86400000 !== 0) {
        when += ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
      }
      when += " (" + fmtAge(age) + ")";
      foot.appendChild(el("div", null,
        (keys.length > 1 ? s.name + " — " : "") + (s.src || "source not recorded")
        + " · latest data point: " + when));
    });
    modal.appendChild(foot);

    function close() {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  // ---------- Cards ----------

  function buildLegend(keys) {
    const legend = el("div", "legend");
    keys.forEach((k) => {
      const key = el("span", "key");
      const swatch = el("span", "swatch");
      swatch.style.background = css(slotOf[k]);
      key.appendChild(swatch);
      key.appendChild(document.createTextNode(DATA.series[k].name));
      legend.appendChild(key);
    });
    return legend;
  }

  function renderCard(panel, range) {
    const card = el("div", "card");
    card.dataset.pid = panelId(panel);
    const head = el("div", "card-head");
    const keys = panel.series;
    const multi = keys.length > 1;
    const title = panel.title || DATA.series[keys[0]].name;
    head.appendChild(makeDragHandle(card));
    head.appendChild(el("span", "title", panel.indexed ? title + " · indexed to 100" : title));

    if (!multi) {
      const s = DATA.series[keys[0]];
      const pts = sliceRange(s.points, range);
      const last = pts[pts.length - 1][1];
      const lastWrap = el("span", "last", fmtValue(last, s));
      lastWrap.appendChild(changeNode(s, pts[0][1], last, panel.upIsGood !== undefined ? panel.upIsGood : true));
      head.appendChild(lastWrap);
    }

    const expandBtn = el("button", "icon-btn expand-btn");
    expandBtn.title = "Expand";
    expandBtn.appendChild(icon("expand"));
    if (multi) expandBtn.style.marginLeft = "auto";
    expandBtn.addEventListener("click", () => openModal(panel));
    head.appendChild(expandBtn);
    card.appendChild(head);

    if (multi) card.appendChild(buildLegend(keys));

    const chartBox = el("div", "chart");
    card.appendChild(chartBox);
    renderChart(chartBox, panel, range);
    return card;
  }

  function renderTile(cfg, range) {
    const s = DATA.series[cfg.key];
    const tile = el("div", "tile");
    tile.dataset.pid = cfg.key;
    tile.appendChild(makeDragHandle(tile));
    tile.appendChild(el("div", "label", s.name));

    const pts = s.points;
    const [tLast, last] = pts[pts.length - 1];
    const [tPrev, prev] = pts[pts.length - 2];
    const valueRow = el("div", "value", fmtValue(last, s));
    // Bar values are session CLOSES (the current bar: the latest trade), but
    // bar timestamps are session OPENS — so label spans by session date and
    // fetch time, never by the bars' open-timestamps.
    const day = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    const upd = new Date(DATA.updated);
    const spanTitle = "Change from the " + day(tPrev) + " session close to the latest price"
      + " (" + day(tLast) + " session, fetched "
      + upd.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC)";
    const delta = changeNode(s, prev, last, cfg.upIsGood !== undefined ? cfg.upIsGood : true);
    instantTip(delta, spanTitle);
    valueRow.appendChild(delta);
    const dlabel = el("span", "dlabel", "1d");
    instantTip(dlabel, spanTitle);
    valueRow.appendChild(dlabel);
    tile.appendChild(valueRow);

    // Sparkline: range slice in the de-emphasis hue, endpoint accented.
    const spark = sliceRange(pts, range);
    const sw = 150, sh = 30;
    let mn = Infinity, mx = -Infinity;
    for (const p of spark) { if (p[1] < mn) mn = p[1]; if (p[1] > mx) mx = p[1]; }
    const sx = (i) => 2 + (i / (spark.length - 1)) * (sw - 8);
    const sy = (v) => 3 + (1 - (v - mn) / (mx - mn || 1)) * (sh - 6);
    const svg = svgEl("svg", { viewBox: `0 0 ${sw} ${sh}`, class: "spark", "aria-hidden": "true" });
    svg.style.width = "100%"; svg.style.height = "30px";
    const d = spark.map((p, i) => (i ? "L" : "M") + sx(i).toFixed(1) + " " + sy(p[1]).toFixed(1)).join("");
    svg.appendChild(svgEl("path", { d, fill: "none", stroke: css("--baseline"), "stroke-width": 1.5, "stroke-linejoin": "round" }));
    svg.appendChild(svgEl("circle", {
      cx: sx(spark.length - 1), cy: sy(last), r: 3,
      fill: css(slotOf[cfg.key]), stroke: css("--surface-1"), "stroke-width": 1.5,
    }));
    tile.appendChild(svg);
    return tile;
  }

  // ---------- Page ----------

  const collapsed = new Set();

  function render() {
    const main = document.querySelector("main");
    main.textContent = "";

    const tiles = el("div", "tiles");
    applyOrder(TILES, savedOrder.__tiles, (t) => t.key)
      .forEach((t) => tiles.appendChild(renderTile(t, state.range)));
    makeSortable(tiles, "__tiles");
    main.appendChild(tiles);

    SECTIONS.forEach((sec) => {
      const available = sec.panels.filter((p) => p.series.every((k) => DATA.series[k]));
      if (!available.length) return;
      const wrap = el("div", "section" + (collapsed.has(sec.title) ? " collapsed" : ""));
      const header = el("button", "section-header");
      header.setAttribute("aria-expanded", String(!collapsed.has(sec.title)));
      header.appendChild(el("span", "chev", "▼"));
      header.appendChild(el("span", null, sec.title));
      header.appendChild(el("span", "count", String(available.length)));
      header.appendChild(el("span", "rule"));
      header.addEventListener("click", () => {
        collapsed.has(sec.title) ? collapsed.delete(sec.title) : collapsed.add(sec.title);
        wrap.classList.toggle("collapsed");
        header.setAttribute("aria-expanded", String(!wrap.classList.contains("collapsed")));
      });
      wrap.appendChild(header);

      const grid = el("div", "panels");
      applyOrder(available, savedOrder[sec.title], panelId)
        .forEach((p) => grid.appendChild(renderCard(p, state.range)));
      makeSortable(grid, sec.title);
      wrap.appendChild(grid);
      main.appendChild(wrap);
    });

    if (DATA.sample) {
      main.appendChild(el("p", "sample-note",
        "Showing generated sample data — the fetcher will replace data.js with live market data."));
    }
  }

  // Topbar range controls are built ONCE — renderTopbar only refreshes the
  // timestamp, so a minute-tick or data reload never rebuilds a mid-drag slider.
  const topControls = createRangeControls(state.range, (r) => {
    state.range = r;
    render();
  });
  document.querySelector(".topbar .range-row").replaceWith(topControls.root);

  function renderTopbar() {
    const up = new Date(DATA.updated);
    const rel = fmtAge(Date.now() - up.getTime());
    document.querySelector(".updated").textContent =
      "Updated " + up.toLocaleString("en-GB", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC (" + rel + ")" + (DATA.sample ? " · sample" : "");
  }
  setInterval(renderTopbar, 60000); // keep the relative age fresh

  // ---------- Live reload ----------
  // The fetcher (launchd, every 15 min) rewrites data.js; re-read it here by
  // re-injecting the script with a cache-buster — works over file://, no server.
  // Energy-light: only refresh when the page is actually visible.

  const RELOAD_EVERY = 5 * 60 * 1000;

  function reloadData() {
    if (document.hidden) return;
    const s = document.createElement("script");
    s.src = "data.js?t=" + Date.now();
    s.onload = () => {
      s.remove();
      if (window.FIN_DATA && window.FIN_DATA.updated !== DATA.updated) {
        DATA = window.FIN_DATA;
        buildDerived();
        renderTopbar();
        render();
      }
    };
    s.onerror = () => s.remove();
    document.body.appendChild(s);
  }

  setInterval(reloadData, RELOAD_EVERY);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reloadData(); });
  window.addEventListener("focus", reloadData);

  // Re-render on theme flip so SVG picks up the dark palette.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderTopbar(); render(); });

  renderTopbar();
  render();
})();
