// How many lagging points sag the surface behind the pointer. Abalone.jsx fills
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

// Abalone shell: wide pearl plates stepped one above the next, a thin black
// line at every step, colour that slides from lavender through pink and gold
// to green where the steps crowd together, and a soft white gloss on top.
export const FRAG = `#version 300 es
precision highp float;
#define DENTS ${DENT_COUNT}
in vec2 vUv;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uTilt;
uniform vec3 uDents[DENTS];

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

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// The colours mother-of-pearl passes through as its layers thicken.
vec3 nacre(float x) {
  const vec3 stops[7] = vec3[7](
    vec3(0.60, 0.68, 0.94),
    vec3(0.77, 0.71, 0.94),
    vec3(0.95, 0.68, 0.81),
    vec3(0.93, 0.87, 0.62),
    vec3(0.60, 0.89, 0.70),
    vec3(0.28, 0.69, 0.72),
    vec3(0.42, 0.58, 0.92)
  );
  x = fract(x) * 7.0;
  int i = int(floor(x));
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(stops[i], stops[(i + 1) % 7], f);
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  float t = uTime;

  // Droop. The whole surface creeps downward very slowly, and it hangs lower
  // wherever the pointer has just been.
  vec2 q = p;
  float sag = 0.0;
  for (int i = 0; i < DENTS; i++) {
    vec2 d = p - uDents[i].xy;
    sag += uDents[i].z * exp(-dot(d, d) / 0.07);
  }
  q.y += sag + 0.018 * sin(p.x * 1.7 + t * 0.05) + t * 0.003;

  // The plates run on a diagonal and are long in that direction.
  vec2 r = rot(-0.87) * q;
  r *= vec2(0.5, 1.2);
  vec2 w = vec2(
    fbm(r * 1.3 + vec2(3.1, 0.7) + t * 0.004),
    fbm(r * 1.3 + vec2(7.7, 4.2) - t * 0.003)
  );
  float h = fbm(r * 0.85 + 1.7 * w);
  // In places the plates crowd into a tight stack of steps.
  float cliffs = smoothstep(0.46, 0.56, fbm(r * 0.9 + vec2(11.0, 5.0) + 0.7 * w));
  float ragged = 0.45 * fbm(r * 3.2 + vec2(4.0, 8.0)) + 0.07 * noise(q * 19.0);
  float v = h * 13.0 + cliffs * 9.0 + ragged + t * 0.006;

  float id = floor(v);
  float f = fract(v);
  float fw = max(fwidth(v), 0.00001);
  float px = min(f, 1.0 - f) / fw;
  float crowd = smoothstep(10.0, 46.0, fw * uRes.y);
  float unit = uRes.y / 1000.0;
  float edge = exp(-px / (9.0 * unit));

  // Colour. Wide plates stay pale lavender and blue; crowded steps and the
  // skin beside each line run on through pink, gold and green.
  float cloud = fbm(q * 2.1 + vec2(2.0, 9.0) + 0.5 * w);
  float accent = smoothstep(0.58, 0.82, fbm(q * 2.7 + vec2(6.0, 13.0)));
  float touch = 0.0;
  for (int i = 0; i < DENTS; i++) {
    vec2 d = p - uDents[i].xy;
    touch += exp(-dot(d, d) / 0.12) * step(0.0001, uDents[i].z);
  }
  float phase = -0.12 + 0.42 * cloud + 0.1 * hash(vec2(id, 3.7)) + 0.24 * accent
    + crowd * (0.12 + 0.44 * f) + edge * 0.32
    + dot(uTilt, vec2(0.1, 0.07)) + 0.05 * touch + t * 0.002;
  vec3 col = nacre(phase);
  vec3 pearl = vec3(0.86, 0.87, 0.96);
  col = mix(pearl, col, mix(0.62, 1.0, max(crowd, edge)));

  // Each plate is a shallow step: in shadow just past its line, bright further on.
  float lift = mix(smoothstep(0.0, 0.36, f), 1.0, crowd * 0.7);
  col = mix(col * vec3(0.6, 0.64, 0.84), col * 1.05, lift);

  // Fine growth lines along the plates.
  col *= 0.97 + 0.06 * noise(vec2(r.x * 5.0, r.y * 170.0));

  // Gloss: long soft highlights that lie along the plates and slide a little
  // with the pointer.
  float gloss = fbm(r * vec2(1.3, 6.5) + 1.4 * w + uTilt * 0.35 + vec2(t * 0.004, 0.0));
  gloss = smoothstep(0.56, 0.8, gloss) * (1.0 - 0.7 * crowd) * lift;
  col = mix(col, vec3(0.97, 0.97, 1.0), gloss * 0.6);

  // A few weathered, brassy patches.
  float worn = smoothstep(0.66, 0.8, fbm(q * 1.6 + vec2(9.0, 1.0)));
  worn *= 0.4 + 0.6 * fbm(q * 9.0);
  col = mix(col, vec3(0.55, 0.47, 0.25), worn * 0.3);

  // Deepen it: the shell in the photograph is richer than pastel.
  float luma = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(vec3(luma), col, 1.32);
  col = pow(max(col, 0.0), vec3(1.2));

  // The black line at every step, thicker in some stretches than others.
  float weight = mix(0.5, 2.7, smoothstep(0.3, 0.72, noise(r * 2.4 + id * 1.7))) * unit;
  weight = min(weight, 0.26 / fw);
  float line = 1.0 - smoothstep(weight - 0.8, weight + 0.8, px);
  col *= 1.0 - 0.22 * exp(-px / (weight * 2.6 + 1.0));
  col = mix(col, vec3(0.03, 0.035, 0.05), line);

  float grain = hash(gl_FragCoord.xy);
  col += (grain - 0.5) * 0.025;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
