/** GLSL for the renderer (WebGL2 / GLSL ES 3.00). Everything outputs premultiplied color to attachment 0 and an emissive copy to attachment 1. */

export const DATA_TEXELS = 16; // texels per instance in the data texture
export const DATA_PER_ROW = 128; // instances per row (2048 texels wide)

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Instanced SDF shapes, atlas text and soft dots. */
export const SHAPE_VS = `${HEAD}
uniform sampler2D uData;
uniform mat3 uProj;      // logical -> clip
uniform int uBase;
flat out int vId;
out vec2 vP;
vec4 F(int k, int i) { return texelFetch(uData, ivec2((i & 127) * 16 + k, i >> 7), 0); }
void main() {
  int i = gl_InstanceID + uBase;
  vId = i;
  vec4 m = F(0, i);          // a b c d
  vec4 t = F(1, i);          // tx ty cx cy
  vec4 h = F(2, i);          // hw hh type opacity
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 p = corner * h.xy;    // relative to the shape centre
  vP = p;
  vec2 q = p + t.zw;         // local position
  vec2 w = vec2(m.x * q.x + m.z * q.y + t.x, m.y * q.x + m.w * q.y + t.y);
  vec3 c = uProj * vec3(w, 1.0);
  gl_Position = vec4(c.xy, 0.0, 1.0);
}`;

export const SHAPE_FS = `${HEAD}
uniform sampler2D uData;
uniform sampler2D uAtlas;
flat in int vId;
in vec2 vP;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec4 F(int k) { return texelFetch(uData, ivec2((vId & 127) * 16 + k, vId >> 7), 0); }

float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdRRect(vec2 p, vec2 b, vec4 r) { // r = tl tr br bl
  float rr = p.x < 0.0 ? (p.y < 0.0 ? r.x : r.w) : (p.y < 0.0 ? r.y : r.z);
  vec2 q = abs(p) - b + rr;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rr;
}
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r), k1 = length(p / (r * r));
  return k1 < 1e-6 ? -min(r.x, r.y) : k0 * (k0 - 1.0) / k1;
}
float sdArc(vec2 p, float r0, float r1, float a0, float a1) { // degrees, 0 = up, clockwise
  float d = length(p);
  float ring = max(r0 - d, d - r1);
  float span = a1 - a0;
  if (abs(span) >= 359.99) return ring;
  float mid = radians(a0 + span * 0.5);
  float half_ = radians(abs(span) * 0.5);
  float ang = atan(p.x, -p.y) - mid;
  ang = mod(ang + 3.14159265, 6.2831853) - 3.14159265;
  float edge = (abs(ang) - half_) * max(d, 1.0);
  return max(ring, edge);
}
float sdSeg(vec2 p, vec4 s, float hw, float cap) {
  vec2 a = s.xy, b = s.zw;
  vec2 ba = b - a;
  float L = max(length(ba), 1e-5);
  vec2 dir = ba / L;
  vec2 pa = p - a;
  float x = dot(pa, dir), y = dot(pa, vec2(-dir.y, dir.x));
  if (cap < 0.5) { float cx = clamp(x, 0.0, L); return length(vec2(x - cx, y)) - hw; }
  return max(abs(x - L * 0.5) - L * 0.5, abs(y) - hw);
}
float sdElbow(vec2 p, vec4 g, vec2 bs) { // g = w h ro ri, bs = bar side; base corner is top-left, p is relative to the centre
  vec2 size = g.xy;
  vec2 q = p + size * 0.5;
  float outer = sdRRect(p, size * 0.5, vec4(g.z, 0.0, 0.0, 0.0));
  float pad = max(size.x, size.y);
  vec2 lo = vec2(bs.y, bs.x), hi = size + pad;
  float inner = sdRRect(q - (lo + hi) * 0.5, (hi - lo) * 0.5, vec4(g.w, 0.0, 0.0, 0.0));
  return max(outer, -inner);
}

vec4 stopColor(float t, vec4 c0, vec4 c1, vec4 c2, vec3 o) {
  c0.rgb *= c0.a; c1.rgb *= c1.a; c2.rgb *= c2.a;
  vec4 c;
  if (t <= o.x) c = c0;
  else if (t < o.y) c = mix(c0, c1, (t - o.x) / max(o.y - o.x, 1e-5));
  else if (t < o.z) c = mix(c1, c2, (t - o.y) / max(o.z - o.y, 1e-5));
  else c = c2;
  return c.a > 1e-5 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}

void main() {
  vec4 h = F(2);
  float type = h.z, opacity = h.w;
  vec4 P = F(3), R = F(4);
  vec4 fc0 = F(5), fc1 = F(6), fc2 = F(7), fk = F(8), gg = F(9), sc = F(10), sg = F(11), sh = F(12), shc = F(13);
  float sw = sg.x, glow = sg.y, shBlur = sg.w;
  vec2 p = vP;
  float d = 1e6;
  int ty = int(type + 0.5);
  vec4 fill = fc0;
  float cov = 1.0, scov = 0.0;
  float aaw = 1.0;
  if (ty == 0) d = sdRRect(p, P.xy * 0.5, R);
  else if (ty == 1) d = length(p) - P.x;
  else if (ty == 2) d = sdEllipse(p, P.xy);
  else if (ty == 3) d = sdArc(p, P.x, P.y, P.z, P.w);
  else if (ty == 4) d = sdSeg(p, P, R.x, R.y);
  else if (ty == 6) d = sdElbow(p, P, R.xy);
  if (ty == 5) { // soft dot (particles, light): P.x = radius, P.y = falloff
    float k = clamp(length(p) / max(P.x, 1e-4), 0.0, 1.0);
    float a = pow(1.0 - k, max(P.y, 0.1)) * fc0.a;
    vec4 c = vec4(fc0.rgb * a, a) * opacity;
    o0 = c; o1 = vec4(fc0.rgb * a * glow * opacity, a * min(glow, 1.0) * opacity);
    return;
  }
  if (ty == 7) { // atlas texture: P = uv rect, R.x = mode (0 tint by alpha, 1 full colour), R.zw = size
    vec2 uv = mix(P.xy, P.zw, (p + R.zw * 0.5) / R.zw);
    vec4 tx = texture(uAtlas, uv);               // premultiplied
    vec4 c = R.x < 0.5 ? vec4(fc0.rgb * tx.a, tx.a) * fc0.a : tx * fc0.a;
    c *= opacity;
    o0 = c; o1 = vec4(c.rgb * glow, c.a * min(glow, 1.0));
    return;
  }
  float w = max(fwidth(d), 1e-4);
  // fill
  if (fk.x > 0.5) {
    float t;
    if (fk.x < 1.5) { vec2 a = gg.xy, b = gg.zw; vec2 ab = b - a; t = dot(vP + F(1).zw - a, ab) / max(dot(ab, ab), 1e-6); }
    else { t = length(vP + F(1).zw - gg.xy) / max(gg.z, 1e-4); }
    fill = stopColor(clamp(t, 0.0, 1.0), fc0, fc1, fc2, fk.yzw);
  }
  cov = clamp(0.5 - d / w, 0.0, 1.0);
  scov = sw > 0.0 ? clamp(0.5 - (abs(d) - sw * 0.5) / w, 0.0, 1.0) : 0.0;
  vec4 col = vec4(0.0);
  // shadow underneath (same shape, offset, blurred)
  if (sh.z > 0.0) {
    vec2 ps = p - sh.xy;
    float ds = 1e6;
    if (ty == 0) ds = sdRRect(ps, P.xy * 0.5, R); else if (ty == 1) ds = length(ps) - P.x; else if (ty == 2) ds = sdEllipse(ps, P.xy);
    else if (ty == 3) ds = sdArc(ps, P.x, P.y, P.z, P.w); else if (ty == 4) ds = sdSeg(ps, P, R.x, R.y); else if (ty == 6) ds = sdElbow(ps, P, R.xy);
    float sa = shBlur > 0.0 ? 1.0 - smoothstep(-shBlur, shBlur, ds) : clamp(0.5 - ds / w, 0.0, 1.0);
    sa *= sh.z * shc.a;
    col = vec4(shc.rgb * sa, sa);
  }
  vec4 f = vec4(fill.rgb * fill.a * cov, fill.a * cov);
  col = f + col * (1.0 - f.a);
  vec4 s = vec4(sc.rgb * sc.a * scov, sc.a * scov);
  col = s + col * (1.0 - s.a);
  vec4 own = s + f * (1.0 - s.a);
  col *= opacity;
  o0 = col;
  o1 = vec4(own.rgb * glow * opacity, own.a * min(glow, 1.0) * opacity);
}`;

/** Triangle meshes (polygon / path fills) with the same paints. */
export const MESH_VS = `${HEAD}
in vec2 aPos;
uniform mat3 uProj;
uniform mat3 uModel;
out vec2 vLocal;
void main() {
  vLocal = aPos;
  vec3 w = uModel * vec3(aPos, 1.0);
  vec3 c = uProj * w;
  gl_Position = vec4(c.xy, 0.0, 1.0);
}`;

export const MESH_FS = `${HEAD}
in vec2 vLocal;
uniform vec4 uC0, uC1, uC2, uK, uG;
uniform float uOpacity, uGlow;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  vec4 c = uC0;
  if (uK.x > 0.5) {
    float t;
    if (uK.x < 1.5) { vec2 a = uG.xy, b = uG.zw, ab = b - a; t = dot(vLocal - a, ab) / max(dot(ab, ab), 1e-6); }
    else t = length(vLocal - uG.xy) / max(uG.z, 1e-4);
    t = clamp(t, 0.0, 1.0);
    vec4 a0 = vec4(uC0.rgb * uC0.a, uC0.a), a1 = vec4(uC1.rgb * uC1.a, uC1.a), a2 = vec4(uC2.rgb * uC2.a, uC2.a);
    vec4 m = t <= uK.y ? a0 : (t < uK.z ? mix(a0, a1, (t - uK.y) / max(uK.z - uK.y, 1e-5)) : (t < uK.w ? mix(a1, a2, (t - uK.z) / max(uK.w - uK.z, 1e-5)) : a2));
    c = m.a > 1e-5 ? vec4(m.rgb / m.a, m.a) : vec4(0.0);
  }
  vec4 pm = vec4(c.rgb * c.a, c.a) * uOpacity;
  o0 = pm;
  o1 = vec4(pm.rgb * uGlow, pm.a * min(uGlow, 1.0));
}`;

/** A textured rectangle in local coordinates: pixel canvases and offscreen layers. */
export const TEX_VS = `${HEAD}
uniform mat3 uProj;
uniform mat3 uModel;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = c;
  vec3 w = uModel * vec3(c * uSize, 1.0);
  vec3 p = uProj * w;
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

export const TEX_FS = `${HEAD}
in vec2 vUv;
uniform sampler2D uTex;
uniform float uOpacity, uGlow, uFlipY;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  vec2 uv = vec2(vUv.x, uFlipY > 0.5 ? 1.0 - vUv.y : vUv.y);
  vec4 c = texture(uTex, uv) * uOpacity;  // premultiplied
  o0 = c;
  o1 = vec4(c.rgb * uGlow, c.a * min(uGlow, 1.0));
}`;

/** Fullscreen helpers: composite an offscreen layer (with blur) and the bloom chain. */
export const FS_VS = `${HEAD}
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = c;
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BLUR_FS = `${HEAD}
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;     // texel step along the blur axis
uniform float uSigma;  // in texels
out vec4 o;
void main() {
  float s = max(uSigma, 0.01);
  int n = int(min(ceil(s * 2.5), 24.0));
  vec4 acc = texture(uTex, vUv);
  float wsum = 1.0;
  for (int i = 1; i <= 24; i++) {
    if (i > n) break;
    float w = exp(-0.5 * float(i * i) / (s * s));
    acc += (texture(uTex, vUv + uDir * float(i)) + texture(uTex, vUv - uDir * float(i))) * w;
    wsum += 2.0 * w;
  }
  o = acc / wsum;
}`;

export const DOWN_FS = `${HEAD}
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec4 s = texture(uTex, vUv) * 4.0;
  s += texture(uTex, vUv + uTexel * vec2(-1.0, -1.0));
  s += texture(uTex, vUv + uTexel * vec2(1.0, -1.0));
  s += texture(uTex, vUv + uTexel * vec2(-1.0, 1.0));
  s += texture(uTex, vUv + uTexel * vec2(1.0, 1.0));
  o = s / 8.0;
}`;

export const UP_FS = `${HEAD}
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uWeight;
out vec4 o;
void main() {
  vec4 s = texture(uTex, vUv + uTexel * vec2(-1.0, 0.0)) + texture(uTex, vUv + uTexel * vec2(1.0, 0.0))
         + texture(uTex, vUv + uTexel * vec2(0.0, -1.0)) + texture(uTex, vUv + uTexel * vec2(0.0, 1.0))
         + (texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, -1.0))
         + texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, 1.0))) * 0.5;
  o = (s / 6.0) * uWeight;
}`;

export const COMPOSITE_FS = `${HEAD}
in vec2 vUv;
uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform float uStrength;
uniform float uHasBloom;
out vec4 o;
void main() {
  vec4 c = texture(uColor, vUv);
  vec3 b = uHasBloom > 0.5 ? texture(uBloom, vUv).rgb * uStrength * 0.5 : vec3(0.0);
  float ba = min(1.0, max(b.r, max(b.g, b.b)));
  o = vec4(c.rgb + b, max(c.a, ba));
}`;

/** Starfield: instanced billboards, positions advance with time on the GPU. */
export const STAR_VS = `${HEAD}
in vec4 aStar;          // x y z0 seed (x,y in -1..1)
uniform mat3 uProj;
uniform mat3 uModel;
uniform vec2 uSize;
uniform float uTime, uSpeed, uFov, uStreak, uSize0;
uniform vec2 uLook;     // look offset: parallax shifts nearer stars more
out vec2 vQ;
out vec4 vCol;
out vec2 vLocal;
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  float z = fract(aStar.z - uTime * uSpeed);       // 1 far .. 0 near
  float depth = mix(0.04, 1.0, z);                  // never zero
  vec2 center = uSize * 0.5;
  vec2 pos = center + (aStar.xy * uSize * 0.5 + uLook * (1.0 - depth) * uSize * 0.5) / (depth * uFov);
  float near = 1.0 - depth;
  float tw = 0.75 + 0.25 * sin(uTime * (1.0 + hash(aStar.w) * 3.0) + aStar.w * 40.0);
  float sz = uSize0 * (0.35 + near * 2.2) * (0.6 + hash(aStar.w + 3.0) * 0.8);
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 dir = normalize(pos - center + 1e-4);
  float streak = uStreak * uSpeed * near * 60.0 * sz;
  vec2 off = corner.x * dir * (sz + streak * (corner.x < 0.0 ? 1.0 : 0.0)) + corner.y * vec2(-dir.y, dir.x) * sz;
  vQ = corner;
  float tint = hash(aStar.w + 7.0);
  vec3 c = tint < 0.15 ? vec3(0.72, 0.84, 1.0) : (tint < 0.27 ? vec3(1.0, 0.86, 0.68) : vec3(1.0));
  vCol = vec4(c, clamp(0.25 + near * 1.1, 0.0, 1.0) * tw * smoothstep(0.0, 0.08, z) * (1.0 - smoothstep(0.92, 1.0, z) * 0.0));
  vLocal = pos + off;
  vec3 w = uModel * vec3(pos + off, 1.0);
  vec3 p = uProj * w;
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

export const STAR_FS = `${HEAD}
in vec2 vQ;
in vec4 vCol;
in vec2 vLocal;
uniform vec2 uSize;
uniform float uOpacity, uGlow;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  if (vLocal.x < 0.0 || vLocal.y < 0.0 || vLocal.x > uSize.x || vLocal.y > uSize.y) discard;
  float r = length(vQ);
  float a = pow(clamp(1.0 - r, 0.0, 1.0), 1.6) * vCol.a * uOpacity;
  o0 = vec4(vCol.rgb * a, a);
  o1 = vec4(vCol.rgb * a * uGlow, a * min(uGlow, 1.0));
}`;

/** Quad for user / built-in fragment shaders. */
export const CUSTOM_VS = `${HEAD}
uniform mat3 uProj;
uniform mat3 uModel;
uniform vec2 uSize;
uniform float uPad;
out vec2 vUv;
out vec2 vPx;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = (c * 2.0 - 1.0) * (uSize * 0.5 + uPad) + uSize * 0.5;
  vPx = px;
  vUv = px / uSize;
  vec3 w = uModel * vec3(px, 1.0);
  vec3 p = uProj * w;
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

export const CUSTOM_PRELUDE = `${HEAD}
in vec2 vUv;
in vec2 vPx;
uniform vec2 uSize;
uniform float uTime, uOpacity, uGlow;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

export const CUSTOM_MAIN = `
void main() {
  vec4 c = shade(vUv, vPx);
  c.a = clamp(c.a, 0.0, 1.0) * uOpacity;
  o0 = vec4(c.rgb * c.a, c.a);
  o1 = vec4(c.rgb * c.a * uGlow, c.a * min(uGlow, 1.0));
}`;
