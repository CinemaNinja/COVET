export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Elastic, viscous displacement field. Each texel stores how far the liquid has
// been dragged (xy) and how fast it is still moving (zw). The pointer tugs it,
// neighbours pull on each other, and a spring hauls it home with overshoot.
export const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outState;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uDt;
uniform vec2 uPointer;
uniform vec2 uPointerVel;
uniform vec2 uOrb;
uniform vec2 uOrbVel;
uniform float uCalm;

void main() {
  vec4 s = texture(uState, vUv);
  vec4 lap =
    texture(uState, vUv + vec2(uTexel.x, 0.0)) +
    texture(uState, vUv - vec2(uTexel.x, 0.0)) +
    texture(uState, vUv + vec2(0.0, uTexel.y)) +
    texture(uState, vUv - vec2(0.0, uTexel.y)) -
    4.0 * s;

  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 toPointer = p - uPointer;
  vec2 toOrb = p - uOrb;
  float nearPointer = exp(-dot(toPointer, toPointer) / 0.05);
  float nearOrb = exp(-dot(toOrb, toOrb) / 0.075);
  float thick = max(nearPointer, nearOrb);

  vec2 force = uPointerVel * nearPointer * 7.5 + uOrbVel * nearOrb * 4.5;

  // The liquid is thicker where the pointer is: more drag, more internal friction.
  float damping = mix(2.5, 4.4, thick) + uCalm * 6.0;
  float viscosity = mix(1.4, 7.5, thick);

  vec2 acc = 320.0 * lap.xy - 12.5 * s.xy - damping * s.zw + viscosity * lap.zw + force;
  vec2 vel = s.zw + acc * uDt;
  vec2 disp = s.xy + vel * uDt;

  // Soft limit so a hard yank stretches the liquid without tearing it.
  float reach = length(disp);
  if (reach > 0.3) disp *= (0.3 + 0.22 * tanh((reach - 0.3) / 0.22)) / reach;

  outState = vec4(disp, vel);
}
`;

export const DRAW_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uState;
uniform float uHasState;
uniform float uAspect;
uniform float uTime;
uniform float uSeed;
uniform vec3 uOrbs[3];
uniform vec2 uOrbVel;

const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = ROT * p * 2.03 + vec2(11.7, 5.3);
    amp *= 0.5;
  }
  return sum;
}

float fbm3(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 3; i++) {
    sum += amp * noise(p);
    p = ROT * p * 2.07 + vec2(3.1, 17.9);
    amp *= 0.5;
  }
  return sum / 0.875;
}

// Poured pigment: gold folded through itself, with smoky umber veins.
vec3 marble(vec2 p, float t, float swirl, float crisp, out float gold, out vec2 flow) {
  vec2 q = vec2(
    fbm(p + t * vec2(0.031, -0.019)),
    fbm(p + vec2(5.2, 1.3) + t * vec2(-0.023, 0.027))
  );
  vec2 r = vec2(
    fbm(p + swirl * q + vec2(1.7, 9.2) + t * 0.021),
    fbm(p + swirl * q + vec2(8.3, 2.8) - t * 0.017)
  );
  vec2 w = p + swirl * r;
  float f = fbm(w);
  float streak = fbm3((ROT * w) * vec2(1.3, 8.5) + vec2(0.0, t * 0.02));

  float tone = clamp((f - 0.5) * mix(1.5, 2.3, crisp) + 0.52 + (streak - 0.5) * 0.5 + (q.x - 0.5) * 0.45, 0.0, 1.0);
  float band = mix(0.2, 0.09, crisp);

  vec3 rust = vec3(0.66, 0.31, 0.11);
  vec3 amber = vec3(0.83, 0.49, 0.15);
  vec3 goldTone = vec3(0.93, 0.67, 0.27);
  vec3 cream = vec3(0.98, 0.85, 0.61);
  vec3 blush = vec3(0.88, 0.5, 0.3);
  vec3 smoke = vec3(0.4, 0.33, 0.27);
  vec3 umber = vec3(0.07, 0.045, 0.03);

  vec3 col = mix(rust, amber, smoothstep(0.24 - band, 0.24 + band, tone));
  col = mix(col, goldTone, smoothstep(0.46 - band, 0.46 + band, tone));
  col = mix(col, cream, smoothstep(0.76 - band, 0.76 + band, tone) * 0.8);
  col = mix(col, blush, smoothstep(0.5, 0.78, q.y) * 0.36);
  col *= 0.9 + 0.22 * r.y;

  // Pigment is granular, not glassy.
  float powder = noise(w * 46.0) * 0.6 + noise(w * 97.0 + 4.0) * 0.4;
  col *= 0.9 + 0.2 * powder;

  float veinMask = smoothstep(0.44, 0.62, fbm3(p * 0.55 + vec2(3.1, 7.7) + q * 0.8));
  float veinWidth = mix(0.15, 0.085, crisp);
  float vein = 1.0 - smoothstep(0.0, veinWidth, abs(r.x - 0.47));
  vein *= vein;
  float pool = smoothstep(mix(0.43, 0.41, crisp), mix(0.2, 0.25, crisp), r.y + (streak - 0.5) * 0.3);
  float dark = clamp(max(vein * veinMask, pool), 0.0, 1.0) * 0.93;
  col = mix(col, mix(smoke, umber, smoothstep(0.45, 1.0, dark)), dark);

  gold = (1.0 - dark * 0.8) * smoothstep(0.22, 0.7, tone) * (0.45 + 1.1 * streak);
  flow = r;
  return col;
}

vec3 sparkle(vec2 p, float scale, float t, float density) {
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 rnd = hash2(id);
  if (rnd.x > density) return vec3(0.0);
  vec2 centre = 0.22 + 0.56 * hash2(id + 3.7);
  float d = length(f - centre);
  float twinkle = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(t * (0.7 + 2.4 * rnd.y) + rnd.y * 60.0), 4.0);
  float size = mix(0.1, 0.25, rnd.y * rnd.y);
  float dot_ = smoothstep(size, size * 0.2, d) * twinkle;
  vec3 tint = mix(vec3(1.0, 0.84, 0.52), vec3(1.0, 0.97, 0.9), rnd.y);
  tint = mix(tint, vec3(0.66, 0.84, 1.0), step(0.94, rnd.y));
  return tint * dot_;
}

vec3 glitter(vec2 p, vec2 flow, float t, float gold) {
  vec2 g = p + flow * 0.11;
  float density = clamp(0.14 + 0.62 * gold, 0.0, 0.9);
  vec3 sum = sparkle(g, 190.0, t, density) * 0.8;
  sum += sparkle(g + 7.3, 330.0, t * 1.3, density) * 0.62;
  sum += sparkle(g + 2.9, 84.0, t * 0.7, density * 0.14) * 0.7;
  return sum * (0.35 + 0.65 * min(gold, 1.0));
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// One heavy drop and two smaller ones that bud off and melt back into it.
float orbField(vec2 p) {
  vec2 q = p - uOrbs[0].xy;
  float speed = length(uOrbVel);
  vec2 dir = speed > 0.0001 ? uOrbVel / speed : vec2(1.0, 0.0);
  float stretch = min(speed * 0.17, 0.4);
  vec2 l = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
  l.x /= 1.0 + stretch;
  l.y *= 1.0 + stretch * 0.45;
  float wobble = 0.0035 * sin(atan(l.y, l.x) * 3.0 + uTime * 0.9) + 0.002 * sin(atan(l.y, l.x) * 5.0 - uTime * 0.6);
  float d0 = length(l) - uOrbs[0].z + wobble;
  float d1 = length(p - uOrbs[1].xy) - uOrbs[1].z;
  float d2 = length(p - uOrbs[2].xy) - uOrbs[2].z;
  return smin(d0, smin(d1, d2, 0.04), 0.055);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 drag = uHasState > 0.5 ? texture(uState, vUv).xy : vec2(0.0);
  vec2 pd = p - drag;
  float t = uTime;

  float gold;
  vec2 flow;
  vec3 col = marble(pd * 1.15 + uSeed, t, 3.0, 0.0, gold, flow);
  col += glitter(pd, flow, t, gold);

  float d = orbField(p);
  vec2 light = normalize(vec2(-0.55, 0.83));

  float shadow = orbField(p + light * 0.02);
  float halo = smoothstep(0.1, -0.01, shadow);
  col *= 1.0 - 0.66 * halo * halo;

  if (d < 0.004) {
    vec2 e = vec2(0.002, 0.0);
    vec2 n = normalize(vec2(
      orbField(p + e.xy) - orbField(p - e.xy),
      orbField(p + e.yx) - orbField(p - e.yx)
    ) + 0.000001);

    float radius = uOrbs[0].z;
    vec2 centre = uOrbs[0].xy;
    float depth = clamp(-d / radius, 0.0, 1.0);
    vec2 local = (p - centre) * mix(1.75, 0.85, sqrt(depth)) - drag * 0.35;

    float innerGold;
    vec2 innerFlow;
    vec3 inner = marble(ROT * local * 2.1 + centre * 0.35 + vec2(7.3, 2.1) + uSeed, t * 1.5 + 20.0, 4.6, 1.0, innerGold, innerFlow);
    inner += glitter(local * 0.9 + centre * 0.3, innerFlow, t, innerGold) * 1.25;
    inner = inner * 1.14 + vec3(0.035, 0.02, 0.0);

    inner *= mix(0.34, 1.0, smoothstep(0.0, 0.04, -d));

    float lit = dot(n, light);
    float rim = smoothstep(0.0045, 0.001, abs(-d - 0.005));
    inner += vec3(1.0, 0.86, 0.62) * rim * (0.08 + 0.5 * max(lit, 0.0));
    inner += vec3(0.9, 0.58, 0.28) * rim * 0.2 * max(-lit, 0.0);

    vec2 glint = (p - (centre + light * radius * 0.5)) * vec2(1.0, 1.5);
    float spec = smoothstep(radius * 0.36, 0.0, length(glint));
    inner += vec3(1.0, 0.95, 0.85) * spec * spec * 0.36;

    col = mix(col, inner, smoothstep(0.004, -0.004, d));
  }

  vec2 v = (vUv - 0.5) * vec2(1.0, 0.9);
  col *= 1.0 - 0.5 * dot(v, v);

  float grain = hash(gl_FragCoord.xy + fract(t * 7.13) * vec2(311.0, 173.0));
  col += (grain - 0.5) * 0.11;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
