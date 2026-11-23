// How many lagging points sag the surface behind the pointer. Nacre.jsx fills
// exactly this many.
export const DENT_COUNT = 3;

export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Shell-a nacre: the whole photograph, laid edge to edge across the surface and
// brought to life. It breathes slowly, hangs lower where the pointer has been,
// and its colours and highlights turn as the pointer crosses it, the way
// mother-of-pearl changes when it is tilted in the hand.
export const FRAG = `#version 300 es
precision highp float;
#define DENTS ${DENT_COUNT}
// How far the photograph may be widened or narrowed to fit the surface before
// the rest is cropped. A shell forgives a little of this, and it keeps far more
// of the picture in view.
#define GIVE 1.2
in vec2 vUv;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uTilt;
uniform vec3 uDents[DENTS];
uniform sampler2D uTex;
uniform float uTexAspect;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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

const mat2 TURN = mat2(0.8, -0.6, 0.6, 0.8);

float fbm(vec2 p) {
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 3; i++) {
    sum += amp * noise(p);
    p = TURN * p * 2.0 + vec2(11.7, 5.3);
    amp *= 0.5;
  }
  return sum / 0.875;
}

// Turns a colour around the grey axis, so brightness holds while the hue moves.
vec3 hueTurn(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  float sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}

const vec3 LUMA = vec3(0.3, 0.59, 0.11);

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  float t = uTime;

  // Fit the whole photograph to the surface: stretch it a little toward the
  // surface's shape, then crop only what still does not fit.
  float ratio = aspect / uTexAspect;
  float rest = ratio / clamp(ratio, 1.0 / GIVE, GIVE);
  vec2 span = rest > 1.0 ? vec2(1.0, 1.0 / rest) : vec2(rest, 1.0);
  span *= 0.97; // a margin, so the movement below never runs off the picture

  // Droop. The surface hangs lower wherever the pointer has just been.
  float sag = 0.0;
  float touch = 0.0;
  for (int i = 0; i < DENTS; i++) {
    vec2 d = p - uDents[i].xy;
    sag += uDents[i].z * exp(-dot(d, d) / 0.08);
    touch += exp(-dot(d, d) / 0.13) * step(0.0001, uDents[i].z);
  }

  // Breath. A slow swell passes through the plates, as if seen through water.
  vec2 w = vec2(
    fbm(p * 1.6 + vec2(2.4, 0.9) + t * 0.02),
    fbm(p * 1.6 + vec2(6.8, 3.7) - t * 0.017)
  ) - 0.5;

  vec2 q = vUv - 0.5;
  q.y += sag + 0.005 * sin(p.x * 1.5 + t * 0.05);
  q += vec2(w.x / aspect, w.y) * 0.02;
  q -= vec2(uTilt.x / aspect, uTilt.y) * 0.012;
  vec2 uv = 0.5 + q * span;

  // The photograph, with its neighbours read once for both crispness and relief.
  vec2 step2 = 1.5 / vec2(textureSize(uTex, 0));
  vec3 c = texture(uTex, uv).rgb;
  vec3 cl = texture(uTex, uv - vec2(step2.x, 0.0)).rgb;
  vec3 cr = texture(uTex, uv + vec2(step2.x, 0.0)).rgb;
  vec3 cd = texture(uTex, uv - vec2(0.0, step2.y)).rgb;
  vec3 cu = texture(uTex, uv + vec2(0.0, step2.y)).rgb;
  vec3 col = c + (c - 0.25 * (cl + cr + cd + cu)) * 0.75;
  float luma = dot(c, LUMA);

  // Relief. Each terrace catches a light that leans with the pointer.
  vec2 slope = vec2(dot(cr - cl, LUMA), dot(cu - cd, LUMA));
  vec2 light = normalize(vec2(-0.55, 0.8) + uTilt * 1.6);
  col *= 1.0 + 0.5 * dot(slope, light);

  // Iridescence. Hue slides with the angle of view, differently on every plate.
  float cloud = fbm(p * 2.0 + vec2(1.5, 7.0) + 0.6 * w);
  float phase = 0.9 * luma + 0.7 * cloud + dot(uTilt, vec2(0.9, 0.6)) + 0.25 * touch + t * 0.016;
  col = hueTurn(col, 0.2 * sin(6.2832 * phase));

  // Sheen on the pale plates, drifting in and out.
  float sheen = smoothstep(0.45, 0.85, luma) * (0.5 + 0.5 * sin(6.2832 * (0.5 * phase + cloud) + 1.3));
  col += sheen * vec3(0.08, 0.1, 0.1);

  // A little deeper than the print.
  col = mix(vec3(dot(col, LUMA)), col, 1.22);
  col *= 1.06;

  float grain = hash(gl_FragCoord.xy);
  col += (grain - 0.5) * 0.03;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
