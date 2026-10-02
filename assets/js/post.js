/* Lightweight post-processing for capable GPUs: bright-pass bloom at half and quarter
   resolution, then one composite pass with slight chromatic aberration, scanlines and grain.
   Written in-house instead of vendoring three/examples (EffectComposer + UnrealBloomPass):
   same idea, a fraction of the code, and it composites onto the page background colour. */
import {
  WebGLRenderTarget, HalfFloatType, Scene, OrthographicCamera, Mesh, PlaneGeometry,
  ShaderMaterial, Vector2, Vector3,
} from "../vendor/three-0.186.1/three.module.min.js";

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */ `
  uniform sampler2D tIn; uniform float uThr; varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tIn, vUv);
    float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c.rgb * smoothstep(uThr, uThr + 0.35, l), 1.0);
  }`;

const BLUR = /* glsl */ `
  uniform sampler2D tIn; uniform vec2 uDir; varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tIn, vUv).rgb * 0.2270270270;
    s += texture2D(tIn, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
    s += texture2D(tIn, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
    s += texture2D(tIn, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
    s += texture2D(tIn, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tBase; uniform sampler2D tB1; uniform sampler2D tB2;
  uniform vec3 uBg; uniform float uTime; uniform float uStrength;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 d = vUv - 0.5;
    vec2 off = d * dot(d, d) * 0.018;
    vec4 base = texture2D(tBase, vUv);
    vec3 col = vec3(texture2D(tBase, vUv + off).r, base.g, texture2D(tBase, vUv - off).b);
    vec3 bloom = texture2D(tB1, vUv).rgb * 0.85 + texture2D(tB2, vUv).rgb * 1.15;
    col = col + bloom * uStrength + uBg * (1.0 - clamp(base.a, 0.0, 1.0));
    col *= 0.972 + 0.028 * sin(gl_FragCoord.y * 3.14159);
    col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.022;
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Post {
  constructor(renderer, { bg = [0.0196, 0.0275, 0.0392], strength = 0.95, threshold = 0.48 } = {}) {
    this.r = renderer;
    const opt = { type: HalfFloatType, depthBuffer: false };
    // 8-bit MSAA scene target: half-float + 4x MSAA resolves were the most expensive thing on
    // Metal/ANGLE (stalled the compositor); the bright-pass works fine in LDR
    this.rtScene = new WebGLRenderTarget(1, 1, { samples: 4 });
    this.h1 = new WebGLRenderTarget(1, 1, opt); this.h2 = new WebGLRenderTarget(1, 1, opt);
    this.q1 = new WebGLRenderTarget(1, 1, opt); this.q2 = new WebGLRenderTarget(1, 1, opt);
    this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new Scene();
    this.quad = new Mesh(new PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const mk = (fragmentShader, uniforms) => new ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.mBright = mk(BRIGHT, { tIn: { value: null }, uThr: { value: threshold } });
    this.mBlur = mk(BLUR, { tIn: { value: null }, uDir: { value: new Vector2() } });
    this.mComp = mk(COMPOSITE, {
      tBase: { value: this.rtScene.texture }, tB1: { value: this.h1.texture }, tB2: { value: this.q1.texture },
      uBg: { value: new Vector3(...bg) }, uTime: { value: 0 }, uStrength: { value: strength },
    });
  }
  setSize(w, h) { // device pixels
    this.rtScene.setSize(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    this.h1.setSize(hw, hh); this.h2.setSize(hw, hh); this.q1.setSize(qw, qh); this.q2.setSize(qw, qh);
    this.hs = [hw, hh]; this.qs = [qw, qh];
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
  blur(a, b, w, h) {
    this.mBlur.uniforms.tIn.value = a.texture; this.mBlur.uniforms.uDir.value.set(1 / w, 0); this.pass(this.mBlur, b);
    this.mBlur.uniforms.tIn.value = b.texture; this.mBlur.uniforms.uDir.value.set(0, 1 / h); this.pass(this.mBlur, a);
  }
  render(draw, t) {
    const r = this.r;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 0);
    r.clear();
    draw();
    this.mBright.uniforms.tIn.value = this.rtScene.texture; this.pass(this.mBright, this.h1);
    this.blur(this.h1, this.h2, ...this.hs);
    this.mBlur.uniforms.tIn.value = this.h1.texture; this.mBlur.uniforms.uDir.value.set(0, 0); this.pass(this.mBlur, this.q1); // downsample copy
    this.blur(this.q1, this.q2, ...this.qs);
    this.blur(this.q1, this.q2, ...this.qs);
    this.mComp.uniforms.uTime.value = t;
    this.pass(this.mComp, null);
  }
  dispose() {
    [this.rtScene, this.h1, this.h2, this.q1, this.q2].forEach((t) => t.dispose());
    [this.mBright, this.mBlur, this.mComp].forEach((m) => m.dispose());
    this.quad.geometry.dispose();
  }
}
