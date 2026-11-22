import { useEffect, useRef, useState } from "react";
import { VERT, SIM_FRAG, DRAW_FRAG } from "./shaders.js";

const SIM_LONG_SIDE = 256;
const SIM_STEP = 1 / 60;
const SPRING_STEP = 1 / 120;
const MAX_RENDER_SCALE = 1.5;

// Radii and spring feel for the heavy drop and the two that trail it.
const MAIN = { radius: 0.15, stiffness: 34, zeta: 0.42 };
const SATELLITES = [
  { radius: 0.055, stiffness: 15, zeta: 0.36, offset: 0.215, angle: 0.5, spin: 0.19 },
  { radius: 0.03, stiffness: 8.5, zeta: 0.32, offset: 0.275, angle: 2.6, spin: -0.13 },
];

const FRAME = { position: "relative", width: "100%", height: "100%", overflow: "hidden" };
const CANVAS = { position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" };

// Shown only if the browser cannot run WebGL2.
const STILL = [
  "radial-gradient(ellipse 60% 50% at 30% 35%, #f0c877, transparent 70%)",
  "radial-gradient(ellipse 55% 60% at 75% 65%, #c9762a, transparent 72%)",
  "radial-gradient(ellipse 40% 35% at 60% 20%, #2a1a10, transparent 70%)",
  "#8e4a17",
].join(", ");

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(gl, fragmentSource, uniformNames) {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERT);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log);
  }
  const uniforms = {};
  for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
}

function makeTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, complete };
}

function freeTarget(gl, target) {
  if (!target) return;
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

function stepSpring(body, targetX, targetY, dt, stiffness, zeta) {
  const damping = 2 * zeta * Math.sqrt(stiffness);
  body.vx += (stiffness * (targetX - body.x) - damping * body.vx) * dt;
  body.vy += (stiffness * (targetY - body.y) - damping * body.vy) * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
}

export default function GoldenGoo() {
  const canvasRef = useRef(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) {
      setUnsupported(true);
      return undefined;
    }

    let sim;
    let draw;
    try {
      sim = link(gl, SIM_FRAG, [
        "uState",
        "uTexel",
        "uAspect",
        "uDt",
        "uPointer",
        "uPointerVel",
        "uOrb",
        "uOrbVel",
        "uCalm",
      ]);
      draw = link(gl, DRAW_FRAG, ["uState", "uHasState", "uAspect", "uTime", "uSeed", "uOrbs", "uOrbVel"]);
    } catch (error) {
      console.error(error);
      setUnsupported(true);
      return undefined;
    }

    const vao = gl.createVertexArray();
    const quad = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const canFloat = Boolean(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seed = 3 + Math.random() * 40;

    let aspect = 1;
    let simWidth = 0;
    let simHeight = 0;
    let read = null;
    let write = null;
    let hasField = false;

    const pointer = { clientX: 0, clientY: 0, seen: false };
    const target = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };
    const main = { x: 0, y: 0, vx: 0, vy: 0 };
    const satellites = SATELLITES.map((spec) => ({
      x: Math.cos(spec.angle) * spec.offset,
      y: Math.sin(spec.angle) * spec.offset,
      vx: 0,
      vy: 0,
    }));
    const orbUniform = new Float32Array(9);

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE);
      const width = Math.max(1, Math.floor(canvas.clientWidth * scale));
      const height = Math.max(1, Math.floor(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      aspect = width / height;

      const nextWidth = aspect >= 1 ? SIM_LONG_SIDE : Math.max(8, Math.round(SIM_LONG_SIDE * aspect));
      const nextHeight = aspect >= 1 ? Math.max(8, Math.round(SIM_LONG_SIDE / aspect)) : SIM_LONG_SIDE;
      if (canFloat && (nextWidth !== simWidth || nextHeight !== simHeight)) {
        freeTarget(gl, read);
        freeTarget(gl, write);
        simWidth = nextWidth;
        simHeight = nextHeight;
        read = makeTarget(gl, simWidth, simHeight);
        write = makeTarget(gl, simWidth, simHeight);
        hasField = read.complete && write.complete;
      }
    };

    const onPointer = (event) => {
      pointer.clientX = event.clientX;
      pointer.clientY = event.clientY;
      pointer.seen = true;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);

    let time = 0;
    let last = performance.now();
    let springDebt = 0;
    let simDebt = 0;
    let frame = 0;
    let visible = true;
    let resumed = true;

    const tick = (now) => {
      if (!visible) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      time += dt * (reduced ? 0.3 : 1);

      // Until the pointer shows up, the drop wanders on its own. The pointer is
      // measured against the canvas every frame, so scrolling the page past a
      // resting cursor drags the liquid too.
      if (pointer.seen) {
        const rect = canvas.getBoundingClientRect();
        target.x = ((pointer.clientX - rect.left) / rect.width - 0.5) * aspect;
        target.y = 0.5 - (pointer.clientY - rect.top) / rect.height;
      } else {
        target.x = Math.sin(time * 0.23) * 0.3 * Math.min(aspect, 1.6);
        target.y = Math.sin(time * 0.31 + 1.2) * 0.17;
      }
      if (resumed) {
        target.px = target.x;
        target.py = target.y;
        resumed = false;
      }

      const ease = 1 - Math.exp(-16 * dt);
      target.vx += ((target.x - target.px) / dt - target.vx) * ease;
      target.vy += ((target.y - target.py) / dt - target.vy) * ease;
      target.px = target.x;
      target.py = target.y;
      const pull = Math.hypot(target.vx, target.vy);
      const pullScale = pull > 4.5 ? 4.5 / pull : 1;

      springDebt += dt;
      while (springDebt >= SPRING_STEP) {
        springDebt -= SPRING_STEP;
        stepSpring(main, target.x, target.y, SPRING_STEP, reduced ? 60 : MAIN.stiffness, reduced ? 1 : MAIN.zeta);
        satellites.forEach((satellite, index) => {
          const spec = SATELLITES[index];
          const angle = spec.angle + time * spec.spin;
          stepSpring(
            satellite,
            main.x + Math.cos(angle) * spec.offset,
            main.y + Math.sin(angle) * spec.offset,
            SPRING_STEP,
            spec.stiffness,
            reduced ? 1 : spec.zeta
          );
        });
      }

      const breathe = 1 + 0.025 * Math.sin(time * 0.8);
      orbUniform[0] = main.x;
      orbUniform[1] = main.y;
      orbUniform[2] = MAIN.radius * breathe;
      satellites.forEach((satellite, index) => {
        orbUniform[3 + index * 3] = satellite.x;
        orbUniform[4 + index * 3] = satellite.y;
        orbUniform[5 + index * 3] = SATELLITES[index].radius;
      });

      gl.bindVertexArray(vao);
      gl.disable(gl.BLEND);

      if (hasField) {
        gl.useProgram(sim.program);
        gl.viewport(0, 0, simWidth, simHeight);
        gl.uniform1i(sim.uniforms.uState, 0);
        gl.uniform2f(sim.uniforms.uTexel, 1 / simWidth, 1 / simHeight);
        gl.uniform1f(sim.uniforms.uAspect, aspect);
        gl.uniform1f(sim.uniforms.uDt, SIM_STEP);
        gl.uniform2f(sim.uniforms.uPointer, target.x, target.y);
        gl.uniform2f(sim.uniforms.uPointerVel, target.vx * pullScale, target.vy * pullScale);
        gl.uniform2f(sim.uniforms.uOrb, main.x, main.y);
        gl.uniform2f(sim.uniforms.uOrbVel, main.vx, main.vy);
        gl.uniform1f(sim.uniforms.uCalm, reduced ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);

        simDebt = Math.min(simDebt + dt, SIM_STEP * 3);
        while (simDebt >= SIM_STEP) {
          simDebt -= SIM_STEP;
          gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
          gl.bindTexture(gl.TEXTURE_2D, read.texture);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          [read, write] = [write, read];
        }
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(draw.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hasField ? read.texture : null);
      gl.uniform1i(draw.uniforms.uState, 0);
      gl.uniform1f(draw.uniforms.uHasState, hasField ? 1 : 0);
      gl.uniform1f(draw.uniforms.uAspect, aspect);
      gl.uniform1f(draw.uniforms.uTime, time);
      gl.uniform1f(draw.uniforms.uSeed, seed);
      gl.uniform3fv(draw.uniforms.uOrbs, orbUniform);
      gl.uniform2f(draw.uniforms.uOrbVel, main.vx, main.vy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    frame = requestAnimationFrame(tick);

    // Stop drawing while the liquid is scrolled out of view.
    const watcher = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !frame) {
          last = performance.now();
          resumed = true;
          frame = requestAnimationFrame(tick);
        }
      },
      { rootMargin: "80px" }
    );
    watcher.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      freeTarget(gl, read);
      freeTarget(gl, write);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(sim.program);
      gl.deleteProgram(draw.program);
    };
  }, []);

  // Styled inline so the component can be dropped into any page without a stylesheet.
  return (
    <div className="golden-goo" style={unsupported ? { ...FRAME, background: STILL } : FRAME}>
      <canvas ref={canvasRef} style={unsupported ? { display: "none" } : CANVAS} aria-hidden="true" />
    </div>
  );
}
