/* Station instruments for the Experience chapter: a 3D candlestick chart and a risk radar.
   Each mounts its own small WebGL canvas inside its viz box, only while the station is near
   the viewport (the caller disposes it when far). Canvases are aria-hidden; the keyboard
   equivalents (range input, signal buttons) live in the page and drive setPick(). */
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, InstancedBufferGeometry,
  InstancedBufferAttribute, BoxGeometry, PlaneGeometry, Mesh, LineSegments, Points, ShaderMaterial,
  AdditiveBlending, NormalBlending, Color, Vector3, LinearSRGBColorSpace, DoubleSide,
} from "../vendor/three-0.186.1/three.module.min.js";

const raw = (hex) => new Color().setHex(hex, LinearSRGBColorSpace);
const CYAN = 0x22d3ee, LIME = 0xa3e635, FG = 0xe6edf5, LINE = 0x233042;

/* synthetic weekly OHLC (same series as the static SVG poster and the page readout) */
export const CANDLES = [[100,102.24,99.23,101.05],[101.05,101.92,98.86,99.79],[99.79,101.75,98.28,100.83],[100.83,101.83,99.46,101.62],[101.62,104.34,101.36,103.07],[103.07,104.53,101.68,103.44],[103.44,104.63,101.04,102.44],[102.44,102.85,101.79,102.62],[102.62,104.08,100.4,101.69],[101.69,102.72,99.77,100.99],[100.99,102.25,100.3,100.94],[100.94,103.28,100.14,101.8],[101.8,104.09,101.04,102.88],[102.88,104.37,101.25,102.62],[102.62,103.53,100.01,101.53],[101.53,102.49,99.91,100.9]];
/* synthetic radar signals: bearing (deg), range (0..1), level (0..1) */
export const SIGNALS = [["VaR reporting", 40, 0.55, 0.62], ["Backtesting", 130, 0.78, 0.35], ["Stress testing", 205, 0.42, 0.85], ["MAR surveillance", 290, 0.68, 0.48], ["Regulatory submissions", 335, 0.3, 0.25]];

const LINE_V = `attribute float aA; varying float vA; varying float vD; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`;
const LINE_F = `uniform vec3 uC; uniform float uAlpha; varying float vA; varying float vD; void main(){ gl_FragColor = vec4(uC, uAlpha * vA * smoothstep(40.0, 10.0, vD)); }`;
function lines(pos, color, alpha, a) {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aA", new BufferAttribute(a ? new Float32Array(a) : new Float32Array(pos.length / 3).fill(1), 1));
  const m = new ShaderMaterial({ uniforms: { uC: { value: raw(color) }, uAlpha: { value: alpha } }, vertexShader: LINE_V, fragmentShader: LINE_F, transparent: true, depthWrite: false, blending: AdditiveBlending });
  const l = new LineSegments(g, m); l.frustumCulled = false; return l;
}

function base(viz, { tier, reduced }) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "stn-gl";
  viz.append(canvas);
  let renderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: tier <= 1 ? "low-power" : "high-performance" }); }
  catch { canvas.remove(); return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier >= 2 ? 1.75 : 1.4));
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 100);
  const st = { canvas, renderer, scene, camera, t: 0, visible: true, docVisible: !document.hidden, running: false, raf: 0, pointer: { x: 0, y: 0, tx: 0, ty: 0, in: false, cx: 0, cy: 0 }, reduced };
  const resize = () => { const w = viz.clientWidth, h = viz.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); st.onResize?.(); st.dirty = true; };
  st.ro = new ResizeObserver(resize); st.ro.observe(viz); resize();
  st.io = new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; st.sync(); });
  st.io.observe(viz);
  st.onVis = () => { st.docVisible = !document.hidden; st.sync(); };
  document.addEventListener("visibilitychange", st.onVis);
  const move = (e) => { const r = viz.getBoundingClientRect(); st.pointer.cx = e.clientX - r.left; st.pointer.cy = e.clientY - r.top; st.pointer.tx = (st.pointer.cx / r.width) * 2 - 1; st.pointer.ty = (st.pointer.cy / r.height) * 2 - 1; st.pointer.in = true; st.onPointer?.(); st.dirty = true; };
  const leave = () => { st.pointer.in = false; st.pointer.tx = st.pointer.ty = 0; st.onPointer?.(); st.dirty = true; };
  viz.addEventListener("pointermove", move);
  viz.addEventListener("pointerleave", leave);
  let last = performance.now();
  const frame = (now) => {
    st.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!reduced) st.t += dt;
    const p = st.pointer, k = 1 - Math.exp(-dt * 4);
    p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
    // reduced motion: render only when something changed (a static poster with hover)
    if (reduced && !st.dirty && Math.abs(p.tx - p.x) < 1e-3) return;
    st.dirty = false;
    st.update(dt, now);
    renderer.render(scene, camera);
    if (!st.live) { st.live = true; viz.classList.add("is-live"); }
  };
  st.sync = () => {
    const go = st.visible && st.docVisible && !st.disposed;
    if (go && !st.running) { st.running = true; last = performance.now(); st.dirty = true; st.raf = requestAnimationFrame(frame); }
    else if (!go && st.running) { st.running = false; cancelAnimationFrame(st.raf); }
  };
  st.dispose = () => {
    if (st.disposed) return;
    st.disposed = true; st.sync();
    st.io.disconnect(); st.ro.disconnect();
    document.removeEventListener("visibilitychange", st.onVis);
    viz.removeEventListener("pointermove", move); viz.removeEventListener("pointerleave", leave);
    scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    const lost = renderer.getContext().isContextLost?.();
    renderer.dispose(); if (!lost) renderer.forceContextLoss?.();
    canvas.remove(); viz.classList.remove("is-live");
    st.onDispose?.();
  };
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); st.dispose(); });
  return st;
}

/* ---------------------------------------------------------------- chart */
const BOX_V = /* glsl */ `
  attribute vec4 aBody; // x, yLow, height, up
  attribute float aIdx;
  uniform float uGrow; uniform float uPick; uniform float uN; uniform float uZ; uniform float uDim;
  varying vec2 vUv; varying float vUp; varying float vPick; varying float vD; varying float vDim;
  void main() {
    float d = aIdx / uN * 0.55;
    float g = smoothstep(d, d + 0.45, uGrow);
    float w = 0.52 * (1.0 + 0.18 * step(abs(aIdx - uPick), 0.1));
    vec3 p = vec3(aBody.x + position.x * w, aBody.y + (position.y + 0.5) * max(aBody.z, 0.04) * g, position.z * 0.52 + uZ);
    vUv = uv; vUp = aBody.w; vPick = step(abs(aIdx - uPick), 0.1); vDim = uDim;
    vec4 mv = modelViewMatrix * vec4(p, 1.0); vD = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const BOX_F = /* glsl */ `
  uniform vec3 uUp; uniform vec3 uDn;
  varying vec2 vUv; varying float vUp; varying float vPick; varying float vD; varying float vDim;
  void main() {
    vec2 e2 = min(vUv, 1.0 - vUv);
    vec2 fw = fwidth(vUv);
    float edge = 1.0 - min(smoothstep(0.0, fw.x * 1.6, e2.x), smoothstep(0.0, fw.y * 1.6, e2.y));
    vec3 c = mix(uDn, uUp, vUp);
    c = mix(c, vec3(0.92, 0.95, 0.98), vPick * 0.45);
    float fillA = mix(0.05, 0.3, vUp) + vPick * 0.18;
    gl_FragColor = vec4(c, (fillA + edge * 0.95) * smoothstep(40.0, 12.0, vD) * (1.0 - vDim * 0.45));
  }`;
const WICK_V = /* glsl */ `
  attribute float aIdx; attribute float aEnd; attribute vec3 aLine; // x, lo, hi
  uniform float uGrow; uniform float uN; uniform float uPick;
  varying float vPick;
  void main() {
    float d = aIdx / uN * 0.55; float g = smoothstep(d, d + 0.45, uGrow);
    float mid = (aLine.y + aLine.z) * 0.5;
    float y = mix(mid, mix(aLine.y, aLine.z, aEnd), g);
    vPick = step(abs(aIdx - uPick), 0.1);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aLine.x, y, 0.0, 1.0);
  }`;
const WICK_F = `uniform vec3 uC; varying float vPick; void main(){ gl_FragColor = vec4(mix(uC, vec3(1.0), vPick * 0.5), 0.75 + vPick * 0.25); }`;

export function mountChart(viz, { tier = 2, reduced = false, onPick } = {}) {
  const st = base(viz, { tier, reduced });
  if (!st) return null;
  const { scene, camera } = st;
  const n = CANDLES.length;
  const lo = Math.min(...CANDLES.map((c) => c[2])), hi = Math.max(...CANDLES.map((c) => c[1]));
  const H = 9.0; // price pane height (world units); the volume pane hangs below the floor
  const Y = (v) => ((v - lo) / (hi - lo)) * H;
  const X = (i) => (i - (n - 1) / 2) * 0.86;

  const box = new BoxGeometry(1, 1, 1);
  const g = new InstancedBufferGeometry();
  g.index = box.index; g.setAttribute("position", box.getAttribute("position")); g.setAttribute("uv", box.getAttribute("uv"));
  const body = new Float32Array(n * 4), idx = new Float32Array(n);
  CANDLES.forEach(([o, h, l, c], i) => { body.set([X(i), Y(Math.min(o, c)), Y(Math.max(o, c)) - Y(Math.min(o, c)), c >= o ? 1 : 0], i * 4); idx[i] = i; });
  g.setAttribute("aBody", new InstancedBufferAttribute(body, 4));
  g.setAttribute("aIdx", new InstancedBufferAttribute(idx, 1));
  g.instanceCount = n;
  const uni = { uGrow: { value: reduced ? 1 : 0 }, uPick: { value: n - 1 }, uN: { value: n }, uUp: { value: raw(LIME) }, uDn: { value: raw(CYAN) }, uZ: { value: 0 }, uDim: { value: 0 } };
  const bodies = new Mesh(g, new ShaderMaterial({ uniforms: uni, vertexShader: BOX_V, fragmentShader: BOX_F, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
  bodies.frustumCulled = false;
  scene.add(bodies);

  // synthetic volume pane: bars hang below the floor, sized from each week's range
  const rngMax = Math.max(...CANDLES.map((c) => c[1] - c[2]));
  const vg = new InstancedBufferGeometry();
  vg.index = box.index; vg.setAttribute("position", box.getAttribute("position")); vg.setAttribute("uv", box.getAttribute("uv"));
  const vbody = new Float32Array(n * 4);
  CANDLES.forEach(([o, h, l, c], i) => { const v = ((h - l) / rngMax) * 2.2; vbody.set([X(i), -0.35 - v, v, c >= o ? 1 : 0], i * 4); });
  vg.setAttribute("aBody", new InstancedBufferAttribute(vbody, 4));
  vg.setAttribute("aIdx", new InstancedBufferAttribute(idx, 1));
  vg.instanceCount = n;
  const vuni = { ...uni, uZ: { value: 0 }, uDim: { value: 1 } };
  const vols = new Mesh(vg, new ShaderMaterial({ uniforms: vuni, vertexShader: BOX_V, fragmentShader: BOX_F, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
  vols.frustumCulled = false;
  scene.add(vols);

  const wg = new BufferGeometry();
  const wl = [], wi = [], we = [];
  CANDLES.forEach(([, h, l], i) => { wl.push(X(i), Y(l), Y(h), X(i), Y(l), Y(h)); wi.push(i, i); we.push(0, 1); });
  wg.setAttribute("position", new BufferAttribute(new Float32Array(n * 6), 3));
  wg.setAttribute("aLine", new BufferAttribute(new Float32Array(wl), 3));
  wg.setAttribute("aIdx", new BufferAttribute(new Float32Array(wi), 1));
  wg.setAttribute("aEnd", new BufferAttribute(new Float32Array(we), 1));
  const wicks = new LineSegments(wg, new ShaderMaterial({ uniforms: { ...uni, uC: { value: raw(CYAN) } }, vertexShader: WICK_V, fragmentShader: WICK_F, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  wicks.frustumCulled = false;
  scene.add(wicks);

  // floor grid, price levels on a back wall, last-close line
  const fp = [], fa = [];
  const x0 = X(0) - 0.9, x1 = X(n - 1) + 0.9;
  for (let i = 0; i <= 16; i++) { const x = x0 + ((x1 - x0) * i) / 16; fp.push(x, -0.02, -1.6, x, -0.02, 1.6); fa.push(0.6, 0.6); }
  for (let j = 0; j <= 4; j++) { const z = -1.6 + (3.2 * j) / 4; fp.push(x0, -0.02, z, x1, -0.02, z); fa.push(0.6, 0.6); }
  for (let j = 0; j <= 4; j++) { const y = (H * j) / 4; fp.push(x0, y, -1.6, x1, y, -1.6); fa.push(0.45, 0.45); }
  fp.push(x0, -0.35, 0, x1, -0.35, 0); fa.push(0.8, 0.8);
  scene.add(lines(fp, LINE, 1, fa));
  const last = CANDLES[n - 1][3];
  const dash = [];
  for (let x = x0; x < x1; x += 0.3) dash.push(x, Y(last), 0.4, Math.min(x + 0.16, x1), Y(last), 0.4);
  scene.add(lines(dash, CYAN, 0.55));

  // pick column highlight (vertical bracket)
  const sel = lines([0, -2.6, 0.7, 0, H + 0.3, 0.7, 0, -2.6, -0.7, 0, H + 0.3, -0.7], FG, 0.35);
  // floating tag over the picked candle (decorative; the readout in the page is the accessible copy)
  const tip = document.createElement("span");
  tip.className = "chart-tip";
  viz.append(tip);
  st.onDispose = () => tip.remove();
  const tipBox = { w: 150, h: 24 };
  scene.add(sel);

  const centre = new Vector3(0, H / 2 - 1.3, 0);
  let pick = n - 1, growStart = -1;
  const proj = new Vector3();
  const screen = (x, y) => { proj.set(x, y, 0).project(camera); return { x: (proj.x * 0.5 + 0.5) * viz.clientWidth, y: (-proj.y * 0.5 + 0.5) * viz.clientHeight }; };
  st.onPointer = () => {
    if (!st.pointer.in) return;
    let best = -1, bd = 1e9;
    CANDLES.forEach(([, h, l], i) => {
      const a = screen(X(i), Y(h)), b = screen(X(i), Y(l));
      const dx = Math.abs(st.pointer.cx - a.x);
      const inY = st.pointer.cy > Math.min(a.y, b.y) - 28 && st.pointer.cy < Math.max(a.y, b.y) + 28;
      if (inY && dx < bd && dx < 26) { bd = dx; best = i; }
    });
    if (best >= 0 && best !== pick) { setPick(best); onPick?.(best); }
  };
  function setPick(i) {
    pick = i; uni.uPick.value = i; vuni.uPick.value = i; sel.position.x = X(i); st.dirty = true;
    const [o, , , c] = CANDLES[i];
    tip.textContent = `W${String(i + 1).padStart(2, "0")}  C ${c.toFixed(2)}  ${c >= o ? "+" : ""}${(((c - o) / o) * 100).toFixed(2)}%`;
    tipBox.w = tip.offsetWidth || tipBox.w; tipBox.h = tip.offsetHeight || tipBox.h;
  }
  setPick(pick);
  st.update = (dt, now) => {
    if (!reduced) {
      if (growStart < 0) growStart = now;
      uni.uGrow.value = Math.min(1, (now - growStart) / 1800);
    }
    const p = st.pointer;
    const az = -0.3 + Math.sin(st.t * 0.25) * 0.07 + p.x * 0.2;
    const el = 0.26 - p.y * 0.08;
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const R = Math.max(12, 7.9 / (tanH * camera.aspect), (H / 2 + 2.0) / tanH);
    camera.position.set(centre.x + R * Math.cos(el) * Math.sin(az), centre.y + R * Math.sin(el), centre.z + R * Math.cos(el) * Math.cos(az));
    camera.lookAt(centre);
    camera.updateMatrixWorld();
    const [, ch] = CANDLES[pick];
    const sp = screen(X(pick), Y(ch) + 0.45);
    const tw = tipBox.w / 2 + 8;
    const tx = Math.min(viz.clientWidth - tw, Math.max(tw, sp.x)), ty = Math.max(tipBox.h + 34, sp.y);
    tip.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0) translate(-50%, -100%)`;
    if (reduced || uni.uGrow.value < 1) st.dirty = true;
  };
  return { setPick, dispose: st.dispose };
}

/* ---------------------------------------------------------------- radar */
const DISC_F = /* glsl */ `
  uniform float uSweep; uniform vec3 uC; uniform vec3 uL;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.02) discard;
    float a = atan(p.x, p.y); if (a < 0.0) a += 6.28318;
    float fw = fwidth(r);
    float rings = 0.0;
    for (int i = 1; i <= 4; i++) { float rr = float(i) * 0.25; rings += 1.0 - smoothstep(0.0, fw * 1.5, abs(r - rr)); }
    float cross = (1.0 - smoothstep(0.0, fwidth(p.x) * 1.2, abs(p.x))) + (1.0 - smoothstep(0.0, fwidth(p.y) * 1.2, abs(p.y)));
    float ticks = step(0.94, r) * (1.0 - smoothstep(0.0, 0.02, abs(fract(a / 6.28318 * 36.0 + 0.5) - 0.5)));
    float d = mod(uSweep - a, 6.28318);
    float trail = exp(-d * 2.4) * step(r, 1.0);
    float beam = (1.0 - smoothstep(0.0, 0.025, d)) * step(r, 1.0);
    vec3 c = uC * (rings * 0.55 + cross * 0.25 + ticks * 0.7) + uL * (trail * 0.32 + beam * 0.9);
    float alpha = clamp(rings * 0.55 + cross * 0.25 + ticks * 0.7 + trail * 0.4 + beam, 0.0, 1.0) + 0.03;
    gl_FragColor = vec4(c, alpha);
  }`;
const BLIP_V = /* glsl */ `
  attribute vec2 aPolar; attribute float aIdx; uniform float uSweep; uniform float uPick; uniform float uSize;
  varying float vLit; varying float vPick;
  void main() {
    float d = mod(uSweep - aPolar.x, 6.28318);
    vPick = step(abs(aIdx - uPick), 0.1);
    vLit = max(0.28 + 0.72 * exp(-d * 0.9), vPick);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (0.8 + vLit * 0.6 + vPick * 0.6) * (16.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const BLIP_F = /* glsl */ `
  uniform vec3 uC; varying float vLit; varying float vPick;
  void main() {
    vec2 q = gl_PointCoord - 0.5; float r = dot(q, q);
    if (r > 0.25) discard;
    vec3 c = mix(uC, vec3(1.0), smoothstep(0.06, 0.0, r) * 0.7 + vPick * 0.2);
    gl_FragColor = vec4(c, smoothstep(0.25, 0.0, r) * vLit);
  }`;

export function mountRadar(viz, { tier = 2, reduced = false, onPick } = {}) {
  const st = base(viz, { tier, reduced });
  if (!st) return null;
  const { scene, camera } = st;
  const RAD = 3.4;
  const discUni = { uSweep: { value: 0.9 }, uC: { value: raw(CYAN) }, uL: { value: raw(LIME) } };
  const disc = new Mesh(new PlaneGeometry(RAD * 2, RAD * 2), new ShaderMaterial({ uniforms: discUni, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`, fragmentShader: DISC_F, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);

  const pos = [], polar = [], ids = [], stalks = [], stA = [];
  const heads = SIGNALS.map(([, brg, rng, lvl], i) => {
    const a = (brg * Math.PI) / 180;
    const x = Math.sin(a) * rng * RAD, z = -Math.cos(a) * rng * RAD, h = 0.35 + lvl * 2.1;
    pos.push(x, h, z, x, 0.01, z); polar.push(a, rng, a, rng); ids.push(i, i);
    stalks.push(x, 0.01, z, x, h, z); stA.push(0.25, 1);
    return new Vector3(x, h, z);
  });
  const bg = new BufferGeometry();
  bg.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  bg.setAttribute("aPolar", new BufferAttribute(new Float32Array(polar), 2));
  bg.setAttribute("aIdx", new BufferAttribute(new Float32Array(ids), 1));
  const blipUni = { uSweep: discUni.uSweep, uPick: { value: -1 }, uSize: { value: 9 * Math.min(devicePixelRatio, 2) }, uC: { value: raw(LIME) } };
  const blips = new Points(bg, new ShaderMaterial({ uniforms: blipUni, vertexShader: BLIP_V, fragmentShader: BLIP_F, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  blips.frustumCulled = false;
  scene.add(blips);
  const stalkLines = lines(stalks, LIME, 0.6, stA);
  scene.add(stalkLines);
  // outer bezel ring + ground ring
  const bz = [];
  for (let i = 0; i < 120; i++) { if (i % 4 === 3) continue; const a = (i / 120) * Math.PI * 2, b = ((i + 0.7) / 120) * Math.PI * 2; bz.push(Math.cos(a) * RAD * 1.08, 0, Math.sin(a) * RAD * 1.08, Math.cos(b) * RAD * 1.08, 0, Math.sin(b) * RAD * 1.08); }
  const bezel = lines(bz, CYAN, 0.4);
  scene.add(bezel);

  let pick = -1;
  const proj = new Vector3();
  st.onPointer = () => {
    if (!st.pointer.in) return;
    let best = -1, bd = 32;
    heads.forEach((h, i) => { proj.copy(h).project(camera); const x = (proj.x * 0.5 + 0.5) * viz.clientWidth, y = (-proj.y * 0.5 + 0.5) * viz.clientHeight; const d = Math.hypot(x - st.pointer.cx, y - st.pointer.cy); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && best !== pick) { setPick(best); onPick?.(best); }
  };
  function setPick(i) { pick = i; blipUni.uPick.value = i; st.dirty = true; }
  st.update = (dt) => {
    if (!reduced) discUni.uSweep.value = (discUni.uSweep.value + dt * (Math.PI * 2 / 6)) % (Math.PI * 2);
    bezel.rotation.y -= reduced ? 0 : dt * 0.08;
    const p = st.pointer;
    const az = 0.5 + p.x * 0.25 + (reduced ? 0 : Math.sin(st.t * 0.2) * 0.1), el = 0.72 - p.y * 0.12;
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const R = Math.max(12, 4.5 / (tanH * camera.aspect), 3.9 / tanH);
    camera.position.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el) + 0.4, R * Math.cos(el) * Math.cos(az));
    camera.lookAt(0, 0.6, 0);
  };
  return { setPick, dispose: st.dispose };
}
