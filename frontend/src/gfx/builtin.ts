/** Built-in fragment shaders: planet, radar, warp core, plasma. Each defines `vec4 shade(vec2 uv, vec2 px)` (straight alpha). */
export interface ShaderDef { glsl: string; uniforms: Record<string, string> }

const NOISE3 = `
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n3(p); p = p * 2.02 + 11.3; a *= 0.5; } return s; }
`;

export const BUILTIN: Record<string, ShaderDef> = {
  planet: {
    uniforms: { uR: 'float', uSeed: 'float', uSpin: 'float', uLight: 'float', uOcean: 'vec3', uLand: 'vec3', uIce: 'vec3', uCloud: 'vec3',
      uAtmo: 'vec3', uAtmoPow: 'float', uClouds: 'float', uNight: 'vec3', uSea: 'float' },
    glsl: `${NOISE3}
vec4 shade(vec2 uv, vec2 px) {
  vec2 p = (uv - 0.5) / uR; p.y = -p.y;            // unit disc, y up
  float r = length(p);
  float la = radians(uLight);
  vec3 L = normalize(vec3(cos(la) * 0.92, sin(la) * 0.55, 0.5));
  if (r > 1.0) {                                    // atmosphere halo outside the globe
    float x = r - 1.0;
    float lit = clamp(dot(normalize(p), L.xy) * 0.5 + 0.55, 0.0, 1.0);
    float a = exp(-x * 9.0) * 0.55 * lit * step(0.001, uAtmoPow);
    return vec4(uAtmo, a);
  }
  float z = sqrt(max(1.0 - r * r, 0.0));
  vec3 n = vec3(p, z);
  float s = uSpin, cs = cos(s), sn = sin(s);
  vec3 v = vec3(cs * n.x + sn * n.z, n.y, -sn * n.x + cs * n.z);
  float elev = fbm3(v * 2.3 + uSeed * 7.1);
  float land = smoothstep(uSea - 0.02, uSea + 0.02, elev);
  vec3 ocean = mix(uOcean * 0.55, uOcean, smoothstep(0.1, uSea, elev));
  vec3 ground = mix(uLand * 0.8, uLand, smoothstep(uSea, 0.8, elev));
  float polar = smoothstep(0.78, 0.9, abs(v.y) + (fbm3(v * 4.0 + uSeed) - 0.5) * 0.25);
  vec3 surf = mix(ocean, ground, land);
  surf = mix(surf, uIce, polar);
  float cl = fbm3(v * 3.4 + vec3(uSeed * 3.0, s * 0.35, 0.0));
  float cloud = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.22, cl) * uClouds * 1.6;
  surf = mix(surf, uCloud, clamp(cloud, 0.0, 0.92));
  float ndl = dot(n, L);
  float lit = smoothstep(-0.08, 0.35, ndl);
  vec3 col = surf * (0.04 + 0.96 * lit);
  vec3 V = vec3(0.0, 0.0, 1.0);
  float spec = pow(max(dot(reflect(-L, n), V), 0.0), 36.0) * (1.0 - land) * (1.0 - cloud) * lit;
  col += vec3(0.8, 0.9, 1.0) * spec * 0.6;
  float night = (1.0 - lit) * land * smoothstep(0.62, 0.7, fbm3(v * 9.0 + uSeed)) * (1.0 - cloud);
  col += uNight * night * 0.9;
  float rim = pow(1.0 - z, 3.0);
  col += uAtmo * rim * (0.25 + 0.9 * lit) * uAtmoPow;
  float edge = clamp((1.0 - r) * uR * 700.0, 0.0, 1.0);
  return vec4(col, edge);
}`,
  },
  radar: {
    uniforms: { uSweep: 'float', uTrail: 'float', uRings: 'float', uCol: 'vec3', uBg: 'vec4', uN: 'float', uC: 'vec4[16]' },
    glsl: `
vec3 typeColor(float t) { return t < 0.5 ? vec3(0.9, 0.95, 1.0) : (t < 1.5 ? vec3(0.30, 0.65, 1.0) : (t < 2.5 ? vec3(1.0, 0.25, 0.25) : vec3(1.0, 0.82, 0.30))); }
vec4 shade(vec2 uv, vec2 px) {
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p);
  float aa = fwidth(r) * 1.2;
  float TAU = 6.2831853;
  if (r > 1.0 + aa) return vec4(0.0);
  float ang = atan(p.x, -p.y);
  vec3 col = uBg.rgb; float a = uBg.a * (1.0 - smoothstep(1.0 - aa, 1.0, r));
  // range rings and bearing marks
  float ringsLine = 0.0;
  for (int i = 1; i <= 8; i++) { if (float(i) > uRings) break; float rr = float(i) / uRings; ringsLine = max(ringsLine, 1.0 - smoothstep(0.0, aa * 1.6, abs(r - rr))); }
  float cross = max(1.0 - smoothstep(0.0, aa * 1.4, abs(p.x)), 1.0 - smoothstep(0.0, aa * 1.4, abs(p.y))) * 0.5;
  float ticks = 0.0;
  float tk = abs(fract(ang / TAU * 36.0 + 0.5) - 0.5) * (TAU * r / 36.0);
  ticks = (1.0 - smoothstep(0.0, aa * 1.2, tk)) * smoothstep(0.93, 0.95, r) * (1.0 - smoothstep(0.995, 1.0, r));
  float gridA = max(ringsLine * 0.55, max(cross * 0.35, ticks * 0.8));
  col = mix(col, uCol, gridA); a = max(a, gridA * 0.9);
  // sweep with a fading trail
  float d = mod(uSweep - ang, TAU);
  float tr = d < uTrail ? pow(1.0 - d / uTrail, 2.2) : 0.0;
  float line = 1.0 - smoothstep(0.0, 0.02, d) ; line = d > TAU - 0.03 ? 1.0 : line;
  float sweep = max(tr * 0.75, line * 0.95) * step(r, 1.0);
  col = mix(col, uCol * 1.15, clamp(sweep, 0.0, 1.0)); a = max(a, sweep * 0.9);
  // outer rim
  float rim = 1.0 - smoothstep(0.0, aa * 2.0, abs(r - 0.995));
  col = mix(col, uCol, rim); a = max(a, rim);
  // contacts: bright right after the sweep passes, pulsing halos
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uN) break;
    vec4 c = uC[i];
    vec2 pos = c.y * vec2(sin(c.x), -cos(c.x));
    float dd = length(p - pos);
    float since = mod(uSweep - c.x, TAU);
    float fresh = exp(-since * 0.9);
    vec3 tc = typeColor(c.z);
    float core = 1.0 - smoothstep(0.022, 0.034, dd);
    float pulse = fract(uTime * 0.7 + c.w);
    float ringR = 0.035 + pulse * 0.09;
    float halo = (1.0 - smoothstep(0.0, 0.012, abs(dd - ringR))) * (1.0 - pulse) * (0.35 + 0.65 * fresh);
    float soft = exp(-dd * 28.0) * (0.25 + 0.75 * fresh);
    float k = max(core, max(halo, soft * 0.6));
    col = mix(col, tc * (0.8 + 0.5 * fresh), clamp(k, 0.0, 1.0)); a = max(a, k);
  }
  return vec4(col, a);
}`,
  },
  warpcore: {
    uniforms: { uPower: 'float', uA: 'vec3', uB: 'vec3', uSpeed: 'float' },
    glsl: `
vec4 shade(vec2 uv, vec2 px) {
  float t = uTime * uSpeed;
  vec2 p = vec2((uv.x - 0.5) * 2.0, uv.y);          // x -1..1, y 0..1 (top..bottom)
  float body = 1.0 - smoothstep(0.0, 0.55, abs(p.x) / (0.55 + 0.1 * sin(uv.y * 6.0 - t * 0.7)));
  float flow = fbm(vec2(p.x * 3.0, uv.y * 4.0 + t * 1.8));
  float flow2 = fbm(vec2(p.x * 6.0 + 7.0, uv.y * 9.0 + t * 3.1));
  float bands = 0.5 + 0.5 * sin(uv.y * 38.0 - t * 4.5 + flow * 4.0);
  float core = exp(-abs(p.x) * 7.0) * (0.55 + 0.45 * bands);
  float inten = (body * (0.25 + 0.9 * flow) + core * 1.4 + flow2 * 0.15 * body) * (0.35 + 0.9 * uPower);
  float rings = 0.0;
  for (int i = 0; i < 4; i++) {
    float cy = 0.1 + 0.27 * float(i);
    float pulse = 0.5 + 0.5 * sin(t * 2.0 - float(i) * 1.3);
    rings += (1.0 - smoothstep(0.0, 0.018, abs(uv.y - cy))) * (1.0 - smoothstep(0.52, 0.62, abs(p.x))) * (0.3 + 0.7 * pulse);
  }
  vec3 col = mix(uA, uB, clamp(core * 1.2 + flow * 0.3, 0.0, 1.0)) * inten + uB * rings * 0.9;
  float a = clamp(max(inten * 0.8, rings), 0.0, 1.0) * smoothstep(0.0, 0.04, uv.y) * (1.0 - smoothstep(0.96, 1.0, uv.y));
  return vec4(col, a);
}`,
  },
  plasma: {
    uniforms: { uA: 'vec3', uB: 'vec3', uScale: 'float', uSpeed: 'float' },
    glsl: `
vec4 shade(vec2 uv, vec2 px) {
  vec2 p = (uv - 0.5) * uScale;
  float t = uTime * uSpeed;
  float f = fbm(p + vec2(t * 0.3, -t * 0.2)) + 0.5 * fbm(p * 2.1 - vec2(t * 0.4, t * 0.1));
  vec3 c = mix(uA, uB, smoothstep(0.3, 1.0, f));
  return vec4(c * (0.5 + f * 0.8), 0.85);
}`,
  },
  shimmer: {
    uniforms: { uCol: 'vec3', uK: 'float' },
    glsl: `
vec4 shade(vec2 uv, vec2 px) {
  float n = fbm(vec2(uv.x * 5.0, uv.y * 36.0 + uTime * 0.5));
  float band = smoothstep(0.55, 0.85, fract(uv.y * 2.5 - uTime * 0.12 + n * 0.45));
  float edge = band * (0.35 + 0.65 * n);
  return vec4(uCol * edge, edge * uK * 0.7);
}`,
  },
  crt: {
    uniforms: { uK: 'float' },
    glsl: `
vec4 shade(vec2 uv, vec2 px) {
  float sl = 0.5 + 0.5 * sin(px.y * 3.14159);
  float flick = 0.05 * sin(uTime * 55.0) + 0.03 * sin(uTime * 13.0);
  float grain = hash21(floor(px) + floor(uTime * 24.0));
  float vig = smoothstep(0.35, 0.95, length(uv - 0.5) * 1.25);
  float a = (0.10 + (1.0 - sl) * 0.14 + flick + (grain - 0.5) * 0.16 + vig * 0.35) * uK;
  return vec4(vec3(0.02, 0.05, 0.03), clamp(a, 0.0, 0.7));
}`,
  },
  scanlines: {
    uniforms: { uCol: 'vec3', uK: 'float' },
    glsl: `
vec4 shade(vec2 uv, vec2 px) {
  float l = 0.5 + 0.5 * sin(px.y * 3.14159);
  float sweep = smoothstep(0.0, 0.08, fract(uv.y - uTime * 0.15)) * (1.0 - smoothstep(0.08, 0.2, fract(uv.y - uTime * 0.15)));
  return vec4(uCol, (l * 0.06 + sweep * 0.05) * uK);
}`,
  },
};
