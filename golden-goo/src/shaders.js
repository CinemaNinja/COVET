// How many beads the draw shader expects. GoldenGoo.jsx fills exactly this many.
export const DROP_COUNT = 18;

// Pace of everything the liquid does on its own: the pigment folding, the tide,
// the whirlpools, and the swells drifting. 1 is the original pace; 1 / 3 takes
// three times as long over the same motion. The pointer's push and the spring
// back are not affected.
export const SWIRL_SPEED = 1 / 3;
const SWIRL_GLSL = SWIRL_SPEED.toFixed(5);

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
uniform float uTime;
uniform float uCalm;

const float SWIRL = ${SWIRL_GLSL};

vec2 perp(vec2 v) {
  return vec2(-v.y, v.x);
}

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
  float gap = dot(toPointer, toPointer);
  float nearPointer = exp(-gap / 0.05);

  // The pointer shoves the liquid ahead of it, and the liquid beside its path
  // runs back the other way, so a stroke leaves an eddy on either side.
  vec2 away = toPointer / sqrt(gap + 0.00001);
  float ring = (gap / 0.05) * exp(-gap / 0.05);
  vec2 force = uPointerVel * nearPointer * 7.5;
  force += (2.0 * dot(uPointerVel, away) * away - uPointerVel) * ring * 9.0;

  // The surface moves on its own: a slow tide across the whole band, and three
  // wandering whirlpools that wind the pigment up and let it go again.
  float life = 1.0 - uCalm * 0.85;
  float clock = uTime * SWIRL;
  vec2 tide = vec2(
    sin(p.y * 2.3 + clock * 0.37) + 0.6 * sin(p.x * 1.9 - p.y * 1.1 + clock * 0.21 + 1.7),
    cos(p.x * 2.1 - clock * 0.29) + 0.6 * sin(p.y * 2.9 + p.x * 0.8 - clock * 0.17 + 4.2)
  );
  force += tide * 0.85 * life;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 eye = vec2(
      sin(clock * (0.071 + 0.023 * fi) + fi * 2.1) * uAspect * 0.42,
      cos(clock * (0.093 - 0.017 * fi) + fi * 4.3) * 0.33
    );
    vec2 arm = p - eye;
    float turn = sin(clock * (0.23 + 0.05 * fi) + fi * 1.7);
    force += perp(arm) * exp(-dot(arm, arm) / 0.09) * 9.0 * turn * life;
  }

  // The liquid is thicker where the pointer is: more drag, more internal friction.
  float thick = nearPointer;
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
#define DROPS ${DROP_COUNT}
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uState;
uniform float uHasState;
uniform float uAspect;
uniform float uTime;
uniform float uSeed;
uniform vec3 uDrops[DROPS];
uniform vec2 uDropVel[DROPS];
uniform float uSwell;

const float SWIRL = ${SWIRL_GLSL};

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

// The drops are not objects sitting on the liquid. Each is a soft swell in the
// surface, with no edge: its height falls away smoothly to nothing. Swells that
// drift together add up and become one, and a moving swell stretches along its
// path. Returns the height in x and the uphill slope in yz; "pull" is how far
// the swells draw the picture underneath toward their middles.
vec3 swell(vec2 p, out vec2 pull) {
  float height = 0.0;
  vec2 slope = vec2(0.0);
  pull = vec2(0.0);
  for (int i = 0; i < DROPS; i++) {
    vec3 drop = uDrops[i];
    vec2 q = p - drop.xy;
    float sigma = drop.z * 1.5;
    if (dot(q, q) > sigma * sigma * 20.0) continue;
    vec2 vel = uDropVel[i];
    float speed = length(vel);
    vec2 dir = speed > 0.0001 ? vel / speed : vec2(1.0, 0.0);
    vec2 side = vec2(-dir.y, dir.x);
    float stretch = min(speed * 0.35, 0.45);
    float along = 1.0 / (1.0 + stretch);
    float across = 1.0 + stretch * 0.4;
    vec2 l = vec2(dot(q, dir) * along, dot(q, side) * across);
    float w = exp(-dot(l, l) / (sigma * sigma));
    height += w;
    slope += (dir * (l.x * along) + side * (l.y * across)) * (-2.0 * w / sigma);
    pull += q * w;
  }
  float ease = exp(-height);
  return vec3(1.0 - ease, slope * ease);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec2 drag = uHasState > 0.5 ? texture(uState, vUv).xy : vec2(0.0);
  float t = uTime;
  float tFlow = t * 1.35 * SWIRL;

  // A swell bends the one surface rather than laying a second picture on top,
  // so there is no boundary where one stops and the liquid starts.
  vec2 pull;
  vec3 rise = swell(p, pull);
  vec2 pd = p - drag - pull * 0.5 * uSwell;

  float gold;
  vec2 flow;
  vec3 col = marble(pd * 1.15 + uSeed, tFlow, 3.0, 0.0, gold, flow);
  col += glitter(pd, flow, t, gold);

  // Light from the upper left catches the near slope of each swell and leaves
  // the far slope a little darker. No rim, no outline, no cast shadow.
  vec2 light = normalize(vec2(-0.55, 0.83));
  float lit = dot(-rise.yz, light);
  col *= 1.0 + uSwell * (0.44 * lit + 0.05 * rise.x);
  float sheen = max(lit, 0.0);
  col += vec3(1.0, 0.93, 0.8) * sheen * sheen * sheen * 0.5 * uSwell;

  vec2 v = (vUv - 0.5) * vec2(1.0, 0.9);
  col *= 1.0 - 0.5 * dot(v, v);

  float grain = hash(gl_FragCoord.xy + fract(t * 7.13) * vec2(311.0, 173.0));
  col += (grain - 0.5) * 0.11;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
