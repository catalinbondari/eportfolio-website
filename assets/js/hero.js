/* Hero instrument: a synthetic, illustrative volatility surface you can orbit, probe and pin,
   with data streams flowing along it, orbiting data rings, and a HUD layer (market globe and
   floating instrument panels) that leans toward the cursor. Everything here is decorative
   (the canvas is aria-hidden); the keyboard equivalents are the HUD buttons in the page. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, LineSegments, Mesh,
  Points, ShaderMaterial, AdditiveBlending, NormalBlending, Color, Vector2, Vector3, Raycaster,
  Plane, DoubleSide, Group, CanvasTexture, PlaneGeometry, LinearSRGBColorSpace,
  InstancedMesh, InstancedBufferAttribute, BoxGeometry,
} from "../vendor/three-0.186.1/three.module.min.js";

const W = 10, D = 7, HS = 0.95; // world width (strike), depth (tenor), height scale
const raw = (hex) => new Color().setHex(hex, LinearSRGBColorSpace); // shader colours are written as-is (sRGB)
const CYAN = 0x22d3ee, LIME = 0xa3e635, FG = 0xe6edf5, LINE = 0x233042;
const BG = [5 / 255, 7 / 255, 10 / 255];

/* ------------------------------------------------------------- the surface */
/* Vertex displacement lives in the shader. uVol scales the "vol of vol" noise, uScroll folds the
   surface flat as the hero scrolls away, and uRegime drives a regime shift that propagates as a
   front from the short tenors to the long ones, with turbulence riding the front. The same maths
   is mirrored in JS (surf) for the raycast probe and the HUD readouts. */
const GLSL_SURF = /* glsl */ `
  uniform float uTime;
  uniform float uRegime;
  uniform float uVol;
  uniform float uScroll;
  uniform vec2 uMouse;
  uniform float uHover;
  float surfCalm(vec2 uv, float t) {
    float k = (uv.x - 0.55) * 2.0; float v = uv.y;
    float y = 1.5 * k * k * (1.0 - 0.55 * v) - 0.75 * k * (1.0 - 0.5 * v) + 1.25 * exp(-2.6 * v);
    return y + 0.12 * sin(4.0 * v + t * 0.6) * cos(3.0 * uv.x - t * 0.4);
  }
  float surfStress(vec2 uv, float t) {
    float k = (uv.x - 0.55) * 2.0; float v = uv.y;
    float y = 1.9 * k * k * (1.0 - 0.45 * v) - 1.4 * k * (1.0 - 0.4 * v) + 2.4 * exp(-3.4 * v) + 0.25;
    return y + 0.18 * sin(5.0 * v + t * 0.9) * cos(4.0 * uv.x - t * 0.6);
  }
  // cheap deterministic pseudo-noise (domain-warped sines), mirrored exactly in JS
  float pn(vec2 p, float t) {
    return 0.5 * sin(p.x * 5.3 + t * 0.7 + sin(p.y * 3.1 - t * 0.4) * 1.7)
         + 0.3 * sin(p.y * 7.7 - t * 0.9 + sin(p.x * 4.3 + t * 0.3) * 1.3)
         + 0.2 * sin((p.x + p.y) * 11.0 + t * 1.3);
  }
  float regimeAt(vec2 uv) { return smoothstep(0.0, 1.0, uRegime * 1.7 - uv.y * 0.7); }
  float frontAt(vec2 uv) { float r = regimeAt(uv); return 4.0 * r * (1.0 - r); }
  float surf(vec2 uv, float t) {
    float r = regimeAt(uv);
    float h = mix(surfCalm(uv, t), surfStress(uv, t), r) + (0.07 * uVol + 0.5 * frontAt(uv)) * pn(uv, t);
    return h * (1.0 - 0.55 * uScroll);
  }
  float probe(vec2 uv) {
    vec2 d = (uv - uMouse) * vec2(${(W / D).toFixed(3)}, 1.0);
    return exp(-dot(d, d) / 0.010) * uHover;
  }
  vec3 surfPos(vec2 uv, float lift) {
    float h = surf(uv, uTime) + probe(uv) * 0.45;
    return vec3((uv.x - 0.5) * ${W.toFixed(1)}, h * ${HS.toFixed(2)} + lift - uScroll * 0.6, (uv.y - 0.5) * ${D.toFixed(1)});
  }
`;
const sCalm = (u, v, t) => { const k = (u - 0.55) * 2; return 1.5 * k * k * (1 - 0.55 * v) - 0.75 * k * (1 - 0.5 * v) + 1.25 * Math.exp(-2.6 * v) + 0.12 * Math.sin(4 * v + t * 0.6) * Math.cos(3 * u - t * 0.4); };
const sStress = (u, v, t) => { const k = (u - 0.55) * 2; return 1.9 * k * k * (1 - 0.45 * v) - 1.4 * k * (1 - 0.4 * v) + 2.4 * Math.exp(-3.4 * v) + 0.25 + 0.18 * Math.sin(5 * v + t * 0.9) * Math.cos(4 * u - t * 0.6); };
const pn = (x, y, t) => 0.5 * Math.sin(x * 5.3 + t * 0.7 + Math.sin(y * 3.1 - t * 0.4) * 1.7) + 0.3 * Math.sin(y * 7.7 - t * 0.9 + Math.sin(x * 4.3 + t * 0.3) * 1.3) + 0.2 * Math.sin((x + y) * 11 + t * 1.3);
const sstep = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
// s = { t, r (regime 0..1), vol, sc (scroll 0..1) }
const surf = (u, v, s) => { const r = sstep(s.r * 1.7 - v * 0.7); const f = 4 * r * (1 - r); return (sCalm(u, v, s.t) * (1 - r) + sStress(u, v, s.t) * r + (0.07 * s.vol + 0.5 * f) * pn(u, v, s.t)) * (1 - 0.55 * s.sc); };
const SCROLL_DROP = 0.6;
// synthetic mapping from the surface to "market" units, labelled illustrative in the HUD
const K = (u) => 0.6 + u * 0.8, T = (v) => 0.25 + v * 9.75, SIG = (h) => 10 + h * 7.5;
const VERT_SURF = /* glsl */ `
  ${GLSL_SURF}
  varying float vH; varying float vGlow; varying float vDepth; varying vec2 vUv; varying float vFront;
  void main() {
    float g = probe(uv);
    vec3 p = surfPos(uv, 0.0);
    vH = surf(uv, uTime) / (1.0 - 0.55 * uScroll) + g * 0.45; vGlow = g; vUv = uv; vFront = frontAt(uv);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG_LINES = /* glsl */ `
  uniform vec3 uC1; uniform vec3 uC2; uniform float uAlpha; uniform vec2 uSnap; uniform float uSnapOn; uniform vec2 uGrid; uniform float uScroll;
  varying float vH; varying float vGlow; varying float vDepth; varying vec2 vUv; varying float vFront;
  void main() {
    float t = clamp((vH + 0.3) / 2.8, 0.0, 1.0);
    vec3 c = mix(uC1, uC2, smoothstep(0.35, 0.95, t));
    c = mix(c, uC2 * 1.25, vFront * 0.55); // the regime front burns lime as it sweeps through
    float row = 1.0 - smoothstep(0.0, 0.3 / uGrid.y, abs(vUv.y - uSnap.y));
    float col = 1.0 - smoothstep(0.0, 0.3 / uGrid.x, abs(vUv.x - uSnap.x));
    float hi = max(row, col) * uSnapOn;
    c = mix(c, vec3(0.92, 0.95, 0.98), max(vGlow * 0.5, hi * 0.7));
    float fog = smoothstep(30.0, 9.0, vDepth);
    float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    gl_FragColor = vec4(c, (uAlpha + vGlow * 0.6 + hi * 0.55 + vFront * 0.35) * fog * mix(0.35, 1.0, edge) * (1.0 - 0.55 * uScroll));
  }`;
const FRAG_FILL = /* glsl */ `
  uniform vec3 uC1; uniform vec3 uC2;
  varying float vH; varying float vGlow; varying float vDepth; varying vec2 vUv; varying float vFront;
  void main() {
    float t = clamp((vH + 0.3) / 2.8, 0.0, 1.0);
    vec3 c = mix(uC1, uC2, smoothstep(0.35, 0.95, t));
    float fog = smoothstep(30.0, 9.0, vDepth);
    gl_FragColor = vec4(c * 0.55, (0.05 + 0.07 * t + vGlow * 0.12 + vFront * 0.06) * fog);
  }`;

/* data streams: comet-tailed particles flowing along tenor lines */
const VERT_STREAM = /* glsl */ `
  ${GLSL_SURF}
  attribute vec4 aSeed; // u0, v, speed, tail index 0..1
  uniform float uSize;
  varying float vA; varying float vDepth;
  void main() {
    float u = fract(aSeed.x + uTime * aSeed.z);
    vec3 p = surfPos(vec2(u, aSeed.y), 0.06);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    vA = sin(3.14159 * u) * (1.0 - aSeed.w * 0.8);
    gl_PointSize = uSize * (1.0 - aSeed.w * 0.6) * (14.0 / vDepth);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG_DOT = /* glsl */ `
  uniform vec3 uC; varying float vA; varying float vDepth;
  void main() {
    vec2 q = gl_PointCoord - 0.5; float r = dot(q, q);
    if (r > 0.25) discard;
    float fog = smoothstep(30.0, 8.0, vDepth);
    gl_FragColor = vec4(mix(uC, vec3(1.0), smoothstep(0.08, 0.0, r) * 0.6), smoothstep(0.25, 0.0, r) * vA * fog);
  }`;

/* order-flow tape: synthetic trade prints on two lanes hugging the near edges of the surface.
   Buys stand up (lime), sells hang below the tape (cyan); block size sets height. All motion is
   computed here from uTime, so the CPU uploads the instance attributes once. */
const VERT_FLOW = /* glsl */ `
  attribute vec4 aFlow; attribute float aSide; // lane, phase, speed, size; side
  uniform float uTime; uniform float uRegime; uniform float uScroll;
  varying float vSide; varying float vA; varying float vY; varying float vDepth;
  void main() {
    float s = fract(aFlow.y + uTime * aFlow.z * (1.0 + 0.9 * uRegime));
    float env = sin(3.14159 * s);
    float h = (0.05 + aFlow.w * (0.55 + 0.35 * uRegime)) * env;
    vec3 base = aFlow.x < 0.5
      ? vec3(${(W / 2 + 0.5).toFixed(2)}, -0.6, (s - 0.5) * ${D.toFixed(1)})
      : vec3((0.5 - s) * ${W.toFixed(1)}, -0.6, ${(-D / 2 - 0.5).toFixed(2)});
    vec3 p = position;
    p.xz *= 0.035 + aFlow.w * 0.025;
    p.y = (p.y + 0.5) * h * (aSide > 0.5 ? 1.0 : -0.7);
    vec4 mv = modelViewMatrix * vec4(base + p, 1.0);
    vY = position.y + 0.5; vSide = aSide; vA = env * (1.0 - uScroll); vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG_FLOW = /* glsl */ `
  uniform vec3 uC1; uniform vec3 uC2;
  varying float vSide; varying float vA; varying float vY; varying float vDepth;
  void main() {
    vec3 c = mix(uC1, uC2, vSide);
    float fog = smoothstep(32.0, 9.0, vDepth);
    gl_FragColor = vec4(c, (0.15 + 0.6 * vY * vY) * vA * fog * 0.7);
  }`;

/* simple coloured lines (rings, floor, globe, arcs): per-vertex alpha via aA, optional pulse along aT */
const VERT_LINE = /* glsl */ `
  attribute float aA; attribute float aT;
  varying float vA; varying float vT; varying float vDepth; varying float vFace;
  void main() {
    vA = aA; vT = aT;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    vFace = normalize(normalMatrix * normalize(position)).z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG_LINE = /* glsl */ `
  uniform vec3 uC; uniform float uAlpha; uniform float uTime; uniform float uPulse; uniform float uFace; uniform float uFog;
  varying float vA; varying float vT; varying float vDepth; varying float vFace;
  void main() {
    float a = uAlpha * vA;
    if (uPulse > 0.0) { float p = fract(uTime * 0.22 + vA * 7.13) ; a = uAlpha * (0.25 + 2.2 * exp(-pow((vT - p) * 9.0, 2.0))); }
    if (uFace > 0.0) a *= mix(0.18, 1.0, smoothstep(-0.2, 0.4, vFace));
    if (uFog > 0.0) a *= smoothstep(uFog, uFog * 0.35, vDepth);
    gl_FragColor = vec4(uC, a);
  }`;
const VERT_PT = /* glsl */ `
  attribute float aA; uniform float uSize; uniform float uTime; varying float vA; varying float vFace;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFace = normalize(normalMatrix * normalize(position)).z;
    vA = aA;
    gl_PointSize = uSize * (1.0 + 0.35 * sin(uTime * 2.4 + aA * 11.0));
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG_PT = /* glsl */ `
  uniform vec3 uC; varying float vA; varying float vFace;
  void main() {
    vec2 q = gl_PointCoord - 0.5; float r = dot(q, q);
    if (r > 0.25) discard;
    gl_FragColor = vec4(uC, smoothstep(0.25, 0.02, r) * mix(0.15, 1.0, smoothstep(-0.1, 0.3, vFace)));
  }`;

function lineMat(color, alpha, { pulse = 0, face = 0, fog = 0 } = {}) {
  return new ShaderMaterial({
    uniforms: { uC: { value: raw(color) }, uAlpha: { value: alpha }, uTime: { value: 0 }, uPulse: { value: pulse }, uFace: { value: face }, uFog: { value: fog } },
    vertexShader: VERT_LINE, fragmentShader: FRAG_LINE, transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
}
function lineGeo(pos, a, t) {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  const n = pos.length / 3;
  g.setAttribute("aA", new BufferAttribute(a ? new Float32Array(a) : new Float32Array(n).fill(1), 1));
  g.setAttribute("aT", new BufferAttribute(t ? new Float32Array(t) : new Float32Array(n), 1));
  return g;
}

function grid(nu, nv) {
  const n = (nu + 1) * (nv + 1);
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let j = 0, k = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) { uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv; }
  const at = (i, j) => j * (nu + 1) + i;
  const lines = [], tris = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) lines.push(at(i, j), at(i + 1, j));
  for (let i = 0; i <= nu; i++) for (let j = 0; j < nv; j++) lines.push(at(i, j), at(i, j + 1));
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) tris.push(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  const mk = (index) => { const g = new BufferGeometry(); g.setAttribute("position", new BufferAttribute(pos, 3)); g.setAttribute("uv", new BufferAttribute(uv, 2)); g.setIndex(index); return g; };
  return { lineGeo: mk(lines), fillGeo: mk(tris) };
}

/* ---------------------------------------------------------------- HUD bits */
const MARKETS = [[53.35, -6.26], [51.51, -0.13], [50.11, 8.68], [40.71, -74.0], [35.68, 139.69], [22.32, 114.17], [1.35, 103.82], [-33.87, 151.21], [43.65, -79.38]];
function ll(lat, lon, r) {
  const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
  return new Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
}
function buildGlobe(r, rich) {
  const g = new Group();
  const pos = [];
  const seg = 72;
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let i = 0; i < seg; i++) { const a = ll(lat, (i / seg) * 360, r), b = ll(lat, ((i + 1) / seg) * 360, r); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  }
  for (let lon = 0; lon < 180; lon += 30) {
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * 360, t1 = ((i + 1) / seg) * 360;
      const p = (t) => (t <= 180 ? ll(90 - t, lon, r) : ll(t - 270, lon + 180, r));
      const a = p(t0), b = p(t1); pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  g.add(new LineSegments(lineGeo(pos), lineMat(CYAN, 0.42, { face: 1 })));
  // equator ring slightly larger, as an instrument bezel
  const bz = [];
  for (let i = 0; i < 96; i++) { if (i % 3 === 2) continue; const a = (i / 96) * Math.PI * 2, b = ((i + 1) / 96) * Math.PI * 2; bz.push(Math.cos(a) * r * 1.22, 0, Math.sin(a) * r * 1.22, Math.cos(b) * r * 1.22, 0, Math.sin(b) * r * 1.22); }
  const bezel = new LineSegments(lineGeo(bz), lineMat(CYAN, 0.35));
  g.add(bezel);
  // market nodes
  const mp = [], ma = [];
  MARKETS.forEach(([la, lo], i) => { const v = ll(la, lo, r * 1.01); mp.push(v.x, v.y, v.z); ma.push(i / MARKETS.length); });
  const pg = new BufferGeometry();
  pg.setAttribute("position", new BufferAttribute(new Float32Array(mp), 3));
  pg.setAttribute("aA", new BufferAttribute(new Float32Array(ma), 1));
  const pm = new ShaderMaterial({ uniforms: { uC: { value: raw(LIME) }, uSize: { value: 7 * Math.min(devicePixelRatio, 2) }, uTime: { value: 0 } }, vertexShader: VERT_PT, fragmentShader: FRAG_PT, transparent: true, depthWrite: false, blending: AdditiveBlending });
  g.add(new Points(pg, pm));
  // arcs from Dublin with travelling pulses
  if (rich) {
    const ap = [], aa = [], at = [];
    const home = ll(MARKETS[0][0], MARKETS[0][1], r);
    MARKETS.slice(1).forEach((m, k) => {
      const to = ll(m[0], m[1], r);
      const steps = 40;
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = new Vector3().copy(home).lerp(to, t).normalize().multiplyScalar(r * (1 + 0.32 * Math.sin(Math.PI * t) * home.distanceTo(to) / (2 * r)));
        if (prev) { ap.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); aa.push(k / 8, k / 8); at.push((i - 1) / steps, t); }
        prev = p;
      }
    });
    g.add(new LineSegments(lineGeo(ap, aa, at), lineMat(LIME, 0.5, { pulse: 1 })));
  }
  g.userData.mats = g.children.map((c) => c.material);
  g.userData.bezel = bezel;
  return g;
}

function buildRings(rich) {
  const g = new Group();
  const specs = rich
    ? [[6.4, 0.18, 0.0, CYAN, 0.32, 160, 4], [7.3, -0.12, 0.6, LIME, 0.22, 220, 9], [8.1, 0.32, -0.4, CYAN, 0.16, 120, 2]]
    : [[6.6, 0.18, 0.0, CYAN, 0.3, 120, 4]];
  for (const [rad, tiltX, tiltZ, col, alpha, n, gap] of specs) {
    const pos = [];
    for (let i = 0; i < n; i++) {
      if (i % gap === gap - 1) continue; // dashes
      const a = (i / n) * Math.PI * 2, b = ((i + 0.6) / n) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad, Math.cos(b) * rad, 0, Math.sin(b) * rad);
    }
    // tick marks every 30 degrees
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad, Math.cos(a) * rad, 0.28, Math.sin(a) * rad); }
    const ring = new LineSegments(lineGeo(pos), lineMat(col, alpha, { fog: 34 }));
    const holder = new Group();
    holder.rotation.set(tiltX, 0, tiltZ);
    holder.add(ring);
    holder.userData = { ring, speed: (rad % 2 > 1 ? -1 : 1) * (0.05 + (rad - 6) * 0.03) };
    g.add(holder);
  }
  return g;
}

/* floating instrument panels: canvas textures with synthetic mini charts */
function makePanel(kind) {
  const cw = 384, ch = 240;
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const ctx = c.getContext("2d");
  const tex = new CanvasTexture(c);
  const mat = new ShaderMaterial({
    uniforms: { map: { value: tex }, uO: { value: 0.9 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float uO; varying vec2 vUv; void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb, t.a * uO); }`,
    transparent: true, depthWrite: false, side: DoubleSide,
  });
  const mesh = new Mesh(new PlaneGeometry(1.6, 1.0), mat);
  const draw = (s) => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "rgba(5,7,10,0.72)"; ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = "rgba(35,48,66,1)"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, cw - 2, ch - 2);
    ctx.strokeStyle = "#22D3EE"; ctx.lineWidth = 3;
    const br = 18;
    [[0, 0, 1, 1], [cw, 0, -1, 1], [0, ch, 1, -1], [cw, ch, -1, -1]].forEach(([x, y, dx, dy]) => { ctx.beginPath(); ctx.moveTo(x + dx * br, y + dy * 1.5); ctx.lineTo(x + dx * 1.5, y + dy * 1.5); ctx.lineTo(x + dx * 1.5, y + dy * br); ctx.stroke(); });
    ctx.font = "600 22px JetBrains Mono, monospace"; ctx.fillStyle = "#93A1B3"; ctx.textBaseline = "top";
    const title = { atm: "SIGMA ATM 1Y", term: "TERM STRUCTURE", skew: "SKEW 1Y" }[kind];
    ctx.fillText(title, 18, 16);
    ctx.fillStyle = "#FBBF24"; ctx.font = "600 17px JetBrains Mono, monospace"; ctx.textAlign = "right"; ctx.fillText("SYNTH", cw - 18, 19); ctx.textAlign = "left";
    const x0 = 18, x1 = cw - 18, y0 = 62, y1 = ch - 22;
    ctx.strokeStyle = "rgba(35,48,66,1)"; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const y = y0 + (i / 3) * (y1 - y0); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
    if (kind === "atm") {
      const h = s.hist; const mn = Math.min(...h) - 0.2, mx = Math.max(...h) + 0.2;
      ctx.strokeStyle = "#A3E635"; ctx.lineWidth = 3; ctx.beginPath();
      h.forEach((v, i) => { const x = x0 + (i / (h.length - 1)) * (x1 - x0 - 90), y = y1 - ((v - mn) / (mx - mn)) * (y1 - y0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = "#E6EDF5"; ctx.font = "600 30px JetBrains Mono, monospace"; ctx.textAlign = "right";
      ctx.fillText(h[h.length - 1].toFixed(2), x1, y0 + 8); ctx.textAlign = "left";
    } else if (kind === "term") {
      const vals = s.term; const mx = Math.max(...vals) * 1.1, bw = (x1 - x0) / vals.length;
      vals.forEach((v, i) => { const hh = (v / mx) * (y1 - y0); ctx.fillStyle = "rgba(34,211,238,0.35)"; ctx.fillRect(x0 + i * bw + 4, y1 - hh, bw - 8, hh); ctx.fillStyle = "#22D3EE"; ctx.fillRect(x0 + i * bw + 4, y1 - hh, bw - 8, 3); });
    } else {
      const vals = s.skew; const mn = Math.min(...vals), mx = Math.max(...vals);
      ctx.strokeStyle = "#22D3EE"; ctx.lineWidth = 3; ctx.beginPath();
      vals.forEach((v, i) => { const x = x0 + (i / (vals.length - 1)) * (x1 - x0), y = y1 - ((v - mn) / (mx - mn + 1e-6)) * (y1 - y0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    tex.needsUpdate = true;
  };
  mesh.userData = { draw, tex };
  return mesh;
}

/* ================================================================== mount */
export function mountHero(host, { tier = 2, ui = {}, onFps } = {}) {
  const mobile = tier <= 1;
  const rich = tier >= 2;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("role", "presentation");
  host.insertBefore(canvas, host.querySelector(".viz-hud"));

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, failIfMajorPerformanceCaveat: true, powerPreference: mobile ? "low-power" : "high-performance" });
  } catch { canvas.remove(); return null; }
  const maxDpr = tier >= 3 ? 1.75 : tier === 2 ? 1.5 : 1.4;
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;

  let post = null;
  const usePost = tier >= 3;

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.1, 120);
  const target = new Vector3(0.3, 0.45, 0);
  const hudScene = new Scene();
  const hudCam = new PerspectiveCamera(30, 1, 0.1, 60);
  const flatScene = new Scene(); // HUD panels with text: drawn after bloom so their type stays crisp
  hudCam.position.set(0, 0, 10);

  const uniforms = {
    uTime: { value: 0 }, uRegime: { value: 0 }, uVol: { value: 0.6 }, uScroll: { value: 0 },
    uMouse: { value: new Vector2(0.5, 0.5) }, uHover: { value: 0 },
    uC1: { value: raw(CYAN) }, uC2: { value: raw(LIME) },
    uAlpha: { value: mobile ? 0.8 : 0.7 },
    uSnap: { value: new Vector2(-1, -1) }, uSnapOn: { value: 0 },
    uGrid: { value: new Vector2(1, 1) },
  };
  // JS mirror of the shader surface: S for geometry (includes the scroll fold), S0 for readouts
  const sst = { t: 0, r: 0, vol: 0.6, sc: 0 };
  const S = (u, v) => { sst.t = uniforms.uTime.value; sst.r = uniforms.uRegime.value; sst.vol = uniforms.uVol.value; sst.sc = uniforms.uScroll.value; return surf(u, v, sst); };
  const S0 = (u, v) => { S(0, 0); sst.sc = 0; return surf(u, v, sst); };
  const drop = () => uniforms.uScroll.value * SCROLL_DROP;
  const [nu, nv] = mobile ? [34, 22] : [60, 40];
  uniforms.uGrid.value.set(nu, nv);
  const { lineGeo: sLines, fillGeo: sFill } = grid(nu, nv);
  const common = { uniforms, vertexShader: VERT_SURF, transparent: true, depthWrite: false };
  const fill = new Mesh(sFill, new ShaderMaterial({ ...common, fragmentShader: FRAG_FILL, side: DoubleSide, blending: NormalBlending }));
  const lines = new LineSegments(sLines, new ShaderMaterial({ ...common, fragmentShader: FRAG_LINES, blending: AdditiveBlending }));
  fill.frustumCulled = lines.frustumCulled = false;
  scene.add(fill, lines);

  // data streams
  const streams = mobile ? 70 : tier === 2 ? 220 : 320, tail = 5;
  const seeds = new Float32Array(streams * tail * 4);
  for (let s = 0, k = 0; s < streams; s++) {
    const u0 = Math.random(), v = Math.round(Math.random() * nv) / nv, sp = 0.035 + Math.random() * 0.07;
    for (let j = 0; j < tail; j++, k++) seeds.set([u0 - j * 0.0055, v, sp, j / (tail - 1)], k * 4);
  }
  const stGeo = new BufferGeometry();
  stGeo.setAttribute("position", new BufferAttribute(new Float32Array(streams * tail * 3), 3));
  stGeo.setAttribute("aSeed", new BufferAttribute(seeds, 4));
  const stMat = new ShaderMaterial({
    uniforms: { ...uniforms, uSize: { value: (mobile ? 3.2 : 3.6) * dpr }, uC: { value: raw(LIME) } },
    vertexShader: VERT_STREAM, fragmentShader: FRAG_DOT, transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  const streamPts = new Points(stGeo, stMat);
  streamPts.frustumCulled = false;
  scene.add(streamPts);

  // order-flow tape (InstancedMesh, synthetic)
  const FLOW_N = mobile ? 48 : tier === 2 ? 120 : 180;
  const flowGeo = new BoxGeometry(1, 1, 1);
  const flowSeed = new Float32Array(FLOW_N * 4), flowSide = new Float32Array(FLOW_N);
  for (let i = 0; i < FLOW_N; i++) {
    flowSeed.set([i % 2, Math.random(), 0.016 + Math.random() * 0.022, Math.pow(Math.random(), 2.6)], i * 4);
    flowSide[i] = Math.random() < 0.52 ? 1 : 0;
  }
  flowGeo.setAttribute("aFlow", new InstancedBufferAttribute(flowSeed, 4));
  flowGeo.setAttribute("aSide", new InstancedBufferAttribute(flowSide, 1));
  const flow = new InstancedMesh(flowGeo, new ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uRegime: uniforms.uRegime, uScroll: uniforms.uScroll, uC1: uniforms.uC1, uC2: uniforms.uC2 },
    vertexShader: VERT_FLOW, fragmentShader: FRAG_FLOW, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
  }), FLOW_N);
  flow.frustumCulled = false;
  scene.add(flow);
  const tape = new LineSegments(lineGeo([W / 2 + 0.5, -0.6, -D / 2, W / 2 + 0.5, -0.6, D / 2, -W / 2, -0.6, -D / 2 - 0.5, W / 2, -0.6, -D / 2 - 0.5]), lineMat(CYAN, 0.28));
  scene.add(tape);

  // floor grid + axis ticks
  const fp = [];
  for (let i = 0; i <= 10; i++) { const x = (i / 10 - 0.5) * W; fp.push(x, -0.6, -D / 2, x, -0.6, D / 2); }
  for (let j = 0; j <= 7; j++) { const z = (j / 7 - 0.5) * D; fp.push(-W / 2, -0.6, z, W / 2, -0.6, z); }
  const floor = new LineSegments(lineGeo(fp), lineMat(LINE, 0.9));
  floor.material.blending = NormalBlending;
  scene.add(floor);

  // rings around the surface
  const rings = buildRings(rich);
  rings.position.copy(target).setY(0.2);
  scene.add(rings);

  // probe: drop line + snapped node ring
  const probeGeo = lineGeo(new Array(6).fill(0));
  const probeLine = new LineSegments(probeGeo, lineMat(FG, 0));
  probeLine.frustumCulled = false;
  const ringPts = [];
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2, b = ((i + 1) / 32) * Math.PI * 2; ringPts.push(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22, Math.cos(b) * 0.22, 0, Math.sin(b) * 0.22); }
  const nodeRing = new LineSegments(lineGeo(ringPts), lineMat(FG, 0));
  scene.add(probeLine, nodeRing);

  // pins: up to 4 drop lines
  const MAX_PINS = 4;
  const pinGeo = lineGeo(new Array(MAX_PINS * 6).fill(0));
  const pinLines = new LineSegments(pinGeo, lineMat(LIME, 0.9));
  pinLines.frustumCulled = false;
  scene.add(pinLines);

  // HUD layer: globe + instrument panels
  const globe = buildGlobe(1, rich);
  hudScene.add(globe);
  const panels = rich ? ["atm", "term"].map((k) => { const m = makePanel(k); m.userData.kind = k; flatScene.add(m); return m; }) : [];
  const hudLayout = () => {
    const halfH = Math.tan((hudCam.fov * Math.PI) / 360) * 10, halfW = halfH * hudCam.aspect;
    const narrow = hudCam.aspect < 1;
    const gs = narrow ? halfH * 0.16 : Math.min(halfH * 0.2, halfW * 0.13);
    globe.scale.setScalar(gs);
    globe.userData.base = narrow ? new Vector3(halfW * 0.58, -halfH * 0.02, 0) : new Vector3(halfW * 0.74, -halfH * 0.06, 0);
    const spots = [[-0.3, 0.7, -1.0], [0.18, -0.44, 0.4]];
    panels.forEach((p, i) => { const [x, y, z] = spots[i]; p.userData.base = new Vector3(halfW * x, halfH * y, z); p.scale.setScalar(Math.min(1.15, halfH * 0.24)); });
  };

  // synthetic telemetry state (derived from the synthetic surface)
  const tel = { hist: [], term: [], skew: [] };

  /* ------------------------------------------------------------- input */
  const ndc = new Vector2(), ray = new Raycaster(), hit = new Vector3(), tmp = new Vector3();
  const planeAt = new Plane(new Vector3(0, 1, 0), -0.8);
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let hoverTarget = 0, hoverValid = false;
  const mouseUv = new Vector2(0.5, 0.5);
  const snapUv = new Vector2(-1, -1);

  // orbit state (custom controls: damped, clamped, inertial, idle auto-rotate)
  const VIEWS = {
    surface: { az: -0.62, el: 0.42, R: mobile ? 13 : 15.5 },
    term: { az: -Math.PI / 2, el: 0.07, R: mobile ? 12.5 : 14.5 },
    skew: { az: 0, el: 0.07, R: mobile ? 12.5 : 14.5 },
  };
  const orb = { az: VIEWS.surface.az, el: VIEWS.surface.el, R: VIEWS.surface.R, vAz: 0, vEl: 0, fly: null, zoom: 1 };
  let view = "surface", lastInput = performance.now(), dragging = false;
  let drag = null;

  const pickUv = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // march the ray against the analytic surface (cheap, exact enough for a probe)
    const o = ray.ray.origin, d = ray.ray.direction;
    let prevS = null, prevT = 0;
    for (let i = 0; i <= 90; i++) {
      const t = 4 + i * 0.36;
      tmp.copy(o).addScaledVector(d, t);
      const u = tmp.x / W + 0.5, v = tmp.z / D + 0.5;
      if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) { prevS = null; continue; }
      const s = tmp.y - (S(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))) * HS - drop());
      if (prevS !== null && prevS > 0 && s <= 0) {
        const tt = prevT + (t - prevT) * (prevS / (prevS - s));
        hit.copy(o).addScaledVector(d, tt);
        const hu = hit.x / W + 0.5, hv = hit.z / D + 0.5;
        if (hu >= 0 && hu <= 1 && hv >= 0 && hv <= 1) return new Vector2(hu, hv);
        return null;
      }
      prevS = s; prevT = t;
    }
    if (ray.ray.intersectPlane(planeAt, hit)) { const u = hit.x / W + 0.5, v = hit.z / D + 0.5; if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return new Vector2(u, v); }
    return null;
  };

  const onMove = (e) => {
    pointer.tx = (e.clientX / innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / innerHeight) * 2 - 1;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, now = performance.now();
      const dt = Math.max(8, now - drag.t);
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 5) { dragging = true; host.classList.add("is-dragging"); orb.fly = null; }
      const dAz = -dx * 0.0065, dEl = drag.touch ? 0 : dy * 0.0045;
      orb.az += dAz; orb.el = Math.min(1.25, Math.max(0.04, orb.el + dEl));
      orb.vAz = orb.vAz * 0.6 + (dAz / dt) * 1000 * 0.4; orb.vEl = orb.vEl * 0.6 + (dEl / dt) * 1000 * 0.4;
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
      lastInput = now;
      if (dragging) { hoverTarget = 0; return; }
    }
    if (e.pointerType && e.pointerType !== "mouse") return;
    const uv = pickUv(e.clientX, e.clientY);
    if (uv) { mouseUv.copy(uv); hoverTarget = 1; hoverValid = true; } else { hoverTarget = 0; hoverValid = false; }
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), t0: performance.now(), moved: 0, touch: e.pointerType === "touch", id: e.pointerId };
    orb.vAz = orb.vEl = 0;
    if (!drag.touch) canvas.setPointerCapture?.(e.pointerId);
  };
  const onUp = (e) => {
    if (!drag) return;
    const wasClick = drag.moved < 6 && performance.now() - drag.t0 < 450;
    if (performance.now() - drag.t > 90) { orb.vAz = 0; orb.vEl = 0; } // released while still: no fling
    drag = null; dragging = false; host.classList.remove("is-dragging");
    canvas.releasePointerCapture?.(e.pointerId);
    lastInput = performance.now();
    if (wasClick) { const uv = pickUv(e.clientX, e.clientY); if (uv) addPin(snap(uv)); }
  };
  const onWheel = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return; // plain wheel scrolls the page
    e.preventDefault();
    orb.zoom = Math.min(1.45, Math.max(0.62, orb.zoom * Math.exp(e.deltaY * 0.0018)));
    lastInput = performance.now();
  };
  addEventListener("pointermove", onMove, { passive: true });
  canvas.addEventListener("pointerdown", onDown);
  addEventListener("pointerup", onUp);
  addEventListener("pointercancel", () => { drag = null; dragging = false; host.classList.remove("is-dragging"); });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", () => setView("surface", true));
  canvas.addEventListener("pointerleave", () => { if (!drag) hoverTarget = 0; });

  const snap = (uv) => new Vector2(Math.round(uv.x * nu) / nu, Math.round(uv.y * nv) / nv);

  /* ------------------------------------------------------------- pins */
  const pins = [];
  let pinSeq = 0;
  const pinList = ui.pins;
  function addPin(uv) {
    if (!pinList) return;
    if (pins.length >= MAX_PINS) removePin(pins[0].id, false);
    const id = ++pinSeq;
    const li = document.createElement("li");
    li.className = "pin";
    li.innerHTML = `<span class="pin-id">P${id}</span><span class="pin-v"></span><button type="button" class="pin-x" aria-label="Remove probe P${id}">&times;</button>`;
    li.querySelector(".pin-x").addEventListener("click", () => removePin(id, true));
    pinList.append(li);
    pins.push({ id, uv: uv.clone(), li, v: li.querySelector(".pin-v") });
    writePins(true);
  }
  function removePin(id, focus) {
    const i = pins.findIndex((p) => p.id === id);
    if (i < 0) return;
    pins[i].li.remove();
    pins.splice(i, 1);
    if (focus) (pins.at(-1)?.li.querySelector(".pin-x") || ui.pinBtn)?.focus?.();
  }
  function writePins() {
    for (const p of pins) { p.v.textContent = `K ${K(p.uv.x).toFixed(2)}  T ${T(p.uv.y).toFixed(1)}Y\nσ ${SIG(S0(p.uv.x, p.uv.y)).toFixed(2)}%`; p.h = p.li.offsetHeight; }
  }

  /* ------------------------------------------------------------- API */
  function setView(name, reset) {
    if (!VIEWS[name]) return;
    view = name;
    const v = VIEWS[name];
    const twoPi = Math.PI * 2;
    let az = v.az; // shortest path
    while (az - orb.az > Math.PI) az -= twoPi;
    while (orb.az - az > Math.PI) az += twoPi;
    orb.fly = { az, el: v.el, R: v.R };
    orb.vAz = orb.vEl = 0;
    if (reset) orb.zoom = 1;
    lastInput = performance.now();
    ui.onView?.(name);
  }
  function setRegime(on) { regimeTarget = on ? 1 : 0; }
  let scrollTarget = 0;
  function setScroll(p) { scrollTarget = Math.min(1, Math.max(0, p)); }
  let regimeTarget = 0;
  function pinCentre() { addPin(snap(new Vector2(0.55, 0.077))); }

  /* ------------------------------------------------------------- size */
  let pinOff = { x: 0, y: 0 };
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 52 : 34;
    camera.updateProjectionMatrix();
    hudCam.aspect = w / h;
    hudCam.updateProjectionMatrix();
    hudLayout();
    if (post) post.setSize(Math.round(w * dpr), Math.round(h * dpr));
    const hr = host.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    pinOff = { x: cr.left - hr.left, y: cr.top - hr.top };
  };
  if (usePost) { import("./post.js").then((m) => { post = new m.Post(renderer, { bg: BG }); resize(); fence = 3; }).catch(() => {}); }
  new ResizeObserver(resize).observe(canvas);
  resize();

  /* ------------------------------------------------------------- loop */
  let running = false, visible = !document.hidden, inView = true, rafId = 0, last = performance.now(), t = 0;
  let first = true, telAt = 0, labelAt = 0, probeAt = 0, frames = 0, fpsAt = performance.now(), fps = 60, lowSince = 0, bailed = false;
  let probeFrames = 0, probeStart = 0, slowFrames = 0, fence = 0;
  const probeLabel = ui.label;
  const proj = new Vector3();
  const toScreen = (v, cam) => { proj.copy(v).project(cam); return { x: (proj.x * 0.5 + 0.5) * canvas.clientWidth, y: (-proj.y * 0.5 + 0.5) * canvas.clientHeight, z: proj.z }; };

  const frame = (now) => {
    rafId = requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    t += dt;
    uniforms.uTime.value = t;
    // regime shift: a constant-speed ramp so the front visibly sweeps short tenors to long (~2.2 s)
    { const r = uniforms.uRegime.value, st = dt * 0.45; uniforms.uRegime.value = r + Math.max(-st, Math.min(st, regimeTarget - r)); }
    uniforms.uVol.value += (0.6 + 0.9 * regimeTarget - uniforms.uVol.value) * (1 - Math.exp(-dt * 1.2));
    uniforms.uScroll.value += (scrollTarget - uniforms.uScroll.value) * (1 - Math.exp(-dt * 9));

    // probe easing + snapping
    uniforms.uHover.value += (hoverTarget - uniforms.uHover.value) * (1 - Math.exp(-dt * 8));
    uniforms.uMouse.value.lerp(mouseUv, 1 - Math.exp(-dt * 14));
    if (hoverValid) snapUv.copy(snap(mouseUv));
    uniforms.uSnap.value.copy(snapUv);
    uniforms.uSnapOn.value += ((hoverValid ? 1 : 0) - uniforms.uSnapOn.value) * (1 - Math.exp(-dt * 10));
    pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 5));
    pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 5));

    // orbit: fly-to preset, inertia, idle auto-rotate
    if (orb.fly) {
      const k = 1 - Math.exp(-dt * 3.6);
      orb.az += (orb.fly.az - orb.az) * k; orb.el += (orb.fly.el - orb.el) * k; orb.R += (orb.fly.R - orb.R) * k;
      if (Math.abs(orb.fly.az - orb.az) < 1e-3 && Math.abs(orb.fly.el - orb.el) < 1e-3) orb.fly = null;
    } else if (!drag) {
      orb.az += orb.vAz * dt; orb.el = Math.min(1.25, Math.max(0.04, orb.el + orb.vEl * dt));
      const damp = Math.exp(-dt * 3.2);
      orb.vAz *= damp; orb.vEl *= damp;
      if (view === "surface" && now - lastInput > 4000) orb.az += 0.045 * dt * Math.min(1, (now - lastInput - 4000) / 2000);
    }
    const sc = uniforms.uScroll.value;
    const az = orb.az + pointer.x * 0.08 + sc * 0.25, el = Math.min(1.3, Math.max(0.03, orb.el - pointer.y * 0.04 + sc * 0.38));
    const R = orb.R * orb.zoom * (camera.aspect < 1 ? 0.92 : 1) * (1 + sc * 0.14);
    camera.position.set(target.x + R * Math.cos(el) * Math.sin(az), target.y + R * Math.sin(el), target.z + R * Math.cos(el) * Math.cos(az));
    camera.lookAt(target);

    // rings + HUD objects react to the cursor
    rings.children.forEach((h, i) => { h.userData.ring.rotation.y += h.userData.speed * dt; });
    rings.rotation.x += (pointer.y * 0.12 - rings.rotation.x) * (1 - Math.exp(-dt * 3));
    rings.rotation.z += (-pointer.x * 0.08 - rings.rotation.z) * (1 - Math.exp(-dt * 3));
    if (globe.userData.base) {
      globe.position.set(globe.userData.base.x - pointer.x * 0.25, globe.userData.base.y + pointer.y * 0.18 + Math.sin(t * 0.8) * 0.05, 0);
      globe.rotation.y = t * 0.16 + pointer.x * 0.5;
      globe.rotation.x = 0.38 + pointer.y * 0.28;
      globe.userData.bezel.rotation.y = -t * 0.3;
      globe.userData.mats.forEach((m) => { if (m.uniforms.uTime) m.uniforms.uTime.value = t; });
    }
    panels.forEach((p, i) => {
      const b = p.userData.base; if (!b) return;
      p.position.set(b.x - pointer.x * (0.32 + i * 0.12), b.y + pointer.y * 0.22 + Math.sin(t * 0.7 + i * 2) * 0.06, b.z);
      p.rotation.y = -0.38 + pointer.x * 0.42 + (i === 2 ? 0.55 : 0);
      p.rotation.x = -pointer.y * 0.3;
    });

    // probe geometry
    const m = uniforms.uMouse.value, hv = uniforms.uHover.value, reg = uniforms.uRegime.value;
    const sv = snapUv;
    const hS = S(sv.x, sv.y), hRead = S0(sv.x, sv.y), dy = drop();
    const px = (sv.x - 0.5) * W, pz = (sv.y - 0.5) * D;
    const a = probeGeo.attributes.position.array;
    a[0] = px; a[1] = -0.6; a[2] = pz; a[3] = px; a[4] = (hS + 0.45 * hv) * HS - dy; a[5] = pz;
    probeGeo.attributes.position.needsUpdate = true;
    probeLine.material.uniforms.uAlpha.value = hv * 0.9;
    nodeRing.position.set(px, (hS + 0.45 * hv) * HS + 0.02 - dy, pz);
    nodeRing.material.uniforms.uAlpha.value = hv;

    // pins
    const pa = pinGeo.attributes.position.array;
    pa.fill(0);
    pins.forEach((p, i) => {
      const x = (p.uv.x - 0.5) * W, z = (p.uv.y - 0.5) * D, y = S(p.uv.x, p.uv.y) * HS - dy;
      pa.set([x, -0.6, z, x, y + 0.9, z], i * 6);
      const s = toScreen(tmp.set(x, y + 0.9, z), camera);
      const off = s.z > 1 || s.x < 0 || s.y < 0 || s.x > canvas.clientWidth || s.y > canvas.clientHeight;
      p.li.style.opacity = off ? "0" : "";
      p.li.style.transform = `translate3d(${Math.round(s.x + pinOff.x)}px, ${Math.round(s.y + pinOff.y - (p.h || 44) - 9)}px, 0)`;
    });
    pinGeo.attributes.position.needsUpdate = true;

    // floating label near the probe, and the HUD readout
    if (probeLabel) {
      if (hv > 0.05) {
        const s = toScreen(tmp.set(px, (hS + 0.45 * hv) * HS - dy, pz), camera);
        probeLabel.style.transform = `translate3d(${Math.round(s.x + pinOff.x + 16)}px, ${Math.round(s.y + pinOff.y - 46)}px, 0)`;
        if (now - labelAt > 60) { labelAt = now; probeLabel.innerHTML = `<b>K</b> ${K(sv.x).toFixed(2)}  <b>T</b> ${T(sv.y).toFixed(2)}Y\n<b>σ</b> ${SIG(hRead).toFixed(2)}%  synthetic`; }
        probeLabel.classList.add("is-on");
      } else probeLabel.classList.remove("is-on");
    }
    if (ui.probe && now - probeAt > 100) { probeAt = now; ui.probe.textContent = hv > 0.05 ? `K ${K(sv.x).toFixed(2)} · T ${T(sv.y).toFixed(1)}Y · σ ${SIG(hRead).toFixed(1)}%` : "Hover the surface to probe"; }

    // telemetry (synthetic, read off the synthetic surface) + panels, 2 Hz
    if (now - telAt > 500) {
      telAt = now;
      const atm = SIG(S0(0.55, 0.077));
      tel.hist.push(atm); if (tel.hist.length > 40) tel.hist.shift();
      while (tel.hist.length < 2) tel.hist.push(atm);
      tel.term = [0.02, 0.08, 0.16, 0.26, 0.4, 0.56, 0.74, 0.95].map((v) => SIG(S0(0.55, v)));
      tel.skew = Array.from({ length: 24 }, (_, i) => SIG(S0(i / 23, 0.08)));
      panels.forEach((p) => p.userData.draw(tel));
      const skew = (S0(0.45, 0.08) - S0(0.65, 0.08)) * 7.5;
      const slope = (S0(0.55, 0.9) - S0(0.55, 0.077)) * 7.5;
      ui.onTelemetry?.({ atm, skew, slope, regime: reg > 0.5 ? "Stress" : "Calm", fps });
      writePins();
    }

    // render
    // selective bloom: only the neon geometry goes through the bright-pass; text panels go on after
    const glow = () => { renderer.render(scene, camera); renderer.clearDepth(); renderer.render(hudScene, hudCam); };
    if (post) post.render(glow, t);
    else { renderer.setRenderTarget(null); renderer.clear(); glow(); }
    if (panels.length) { renderer.setRenderTarget(null); renderer.clearDepth(); renderer.render(flatScene, hudCam); }

    // fps + adaptive quality
    frames++;
    if (now - fpsAt > 1000) {
      fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now;
      onFps?.(fps);
      if (fps < 45) { lowSince ||= now; } else lowSince = 0;
      if (lowSince && now - lowSince > 2500) { degrade(); lowSince = 0; }
    }
    if (first) { first = false; host.classList.add("is-live"); probeStart = now; }
    else if (!bailed && probeFrames < 60) {
      // a GPU that cannot hold the scene falls back to the poster. Shader compiles (first frames,
      // the post chain arriving) are fenced off so one-off hitches do not count.
      if (fence > 0) { fence--; probeFrames = 0; probeStart = now; }
      else {
        probeFrames++;
        if (rawDt > 0.12 && probeFrames > 3) slowFrames++;
        const avg = probeFrames === 60 ? 60000 / (now - probeStart) : 60;
        if (slowFrames >= 3 || avg < 28) { host.dataset.bail = slowFrames >= 3 ? `slow x${slowFrames}` : `avg ${Math.round(avg)}fps`; bail(); }
      }
    }
  };
  let level = tier;
  function degrade() {
    if (post) { post.dispose(); post = null; level = 2; return; }
    if (dpr > 1) { dpr = 1; resize(); return; }
    if (panels.length) { panels.forEach((p) => { flatScene.remove(p); p.geometry.dispose(); p.material.dispose(); p.userData.tex.dispose(); }); panels.length = 0; return; }
  }
  function bail() { bailed = true; host.classList.remove("is-live"); stop(); setTimeout(dispose, 1500); ui.onBail?.(); }
  const start = () => { if (running || bailed) return; running = true; last = performance.now(); fpsAt = last; frames = 0; rafId = requestAnimationFrame(frame); };
  const stop = () => { if (!running) return; running = false; cancelAnimationFrame(rafId); };
  let ready = false;
  const sync = () => (ready && visible && inView ? start() : stop());
  const onVis = () => { visible = !document.hidden; sync(); };
  document.addEventListener("visibilitychange", onVis);
  const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); });
  io.observe(host);
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); bail(); });
  // compile shaders off the main thread first (KHR_parallel_shader_compile) so the first frame
  // is not one long blocking task
  const warm = renderer.compileAsync ? Promise.all([[scene, camera], [hudScene, hudCam], [flatScene, hudCam]].map(([sc, cam]) => renderer.compileAsync(sc, cam))) : Promise.resolve();
  warm.catch(() => {}).then(() => { ready = true; if (!bailed) sync(); });

  function dispose() {
    stop();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerup", onUp);
    scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    [hudScene, flatScene].forEach((sc) => sc.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); o.userData?.tex?.dispose?.(); }));
    post?.dispose();
    renderer.dispose();
    pins.slice().forEach((p) => removePin(p.id));
    canvas.remove();
  }

  return { setView, setRegime, setScroll, pinCentre, dispose, get level() { return level; } };
}
