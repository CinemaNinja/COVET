import { useEffect, useRef, useState } from "react";
import { VERT, FRAG, DENT_COUNT } from "./shaders.js";

const MAX_RENDER_SCALE = 1;
const MAX_PIXELS = 2200000;
const FRAME_GAP = 22; // milliseconds; the shell moves slowly, so it need not draw every frame

// Three points trail the pointer, each lazier than the last. The surface hangs
// a little lower under each, so a place the pointer has left takes several
// seconds to rise again. Depth is a fraction of the surface height.
const CHAIN = [
  { stiffness: 5, zeta: 0.8, depth: 0.018 },
  { stiffness: 1.6, zeta: 0.75, depth: 0.026 },
  { stiffness: 0.5, zeta: 0.8, depth: 0.03 },
].slice(0, DENT_COUNT);

// How lazily the colours follow the pointer across the shell.
const TILT = { stiffness: 3, zeta: 0.9 };

const FRAME = { position: "relative", width: "100%", height: "100%", overflow: "hidden" };
const CANVAS = {
  position: "absolute",
  inset: 0,
  display: "block",
  width: "100%",
  height: "100%",
  opacity: 0,
  transition: "opacity 1.2s ease",
};

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

function link(gl, uniformNames) {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERT);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG);
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

function stepSpring(body, targetX, targetY, dt, stiffness, zeta) {
  const damping = 2 * zeta * Math.sqrt(stiffness);
  body.vx += (stiffness * (targetX - body.x) - damping * body.vx) * dt;
  body.vy += (stiffness * (targetY - body.y) - damping * body.vy) * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
}

// src is the photograph the surface is made from. The whole picture is used.
export default function Nacre({ src }) {
  const canvasRef = useRef(null);
  const [unsupported, setUnsupported] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!src) {
      setUnsupported(true);
      return undefined;
    }
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) {
      setUnsupported(true);
      return undefined;
    }

    let shell;
    try {
      shell = link(gl, ["uRes", "uTime", "uTilt", "uDents", "uTex", "uTexAspect"]);
    } catch (error) {
      console.error(error);
      setUnsupported(true);
      return undefined;
    }

    // The photograph. Nothing is drawn until it has arrived, so the still
    // picture the page put underneath shows until the living one is ready.
    const texture = gl.createTexture();
    let textureAspect = 1;
    let loaded = false;
    let gone = false;
    const photo = new Image();
    photo.decoding = "async";
    photo.onload = () => {
      if (gone) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, photo);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      textureAspect = photo.naturalWidth / photo.naturalHeight;
      loaded = true;
    };
    photo.onerror = () => {
      if (!gone) setUnsupported(true);
    };
    photo.src = src;

    const vao = gl.createVertexArray();
    const quad = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let aspect = 1;

    const resize = () => {
      // A background does not need every pixel of a large screen, so the canvas
      // is capped and the browser stretches it the rest of the way.
      const area = Math.max(1, canvas.clientWidth * canvas.clientHeight);
      const scale = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE, Math.sqrt(MAX_PIXELS / area));
      const width = Math.max(1, Math.floor(canvas.clientWidth * scale));
      const height = Math.max(1, Math.floor(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      aspect = width / height;
    };

    const pointer = { clientX: 0, clientY: 0, seen: false };
    const target = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0, vx: 0, vy: 0 };
    const chain = CHAIN.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    const dentUniform = new Float32Array(DENT_COUNT * 3);
    let presence = 0;
    let placed = false;

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
    let frame = 0;
    let visible = true;
    let shown = false;

    const tick = (now) => {
      if (!visible) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
      if (!loaded) {
        last = now;
        return;
      }
      if (now - last < FRAME_GAP) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reduced) time += dt;

      // The pointer is measured against the canvas each frame, so the shell
      // also answers when the page scrolls under a resting cursor.
      if (pointer.seen) {
        const rect = canvas.getBoundingClientRect();
        target.x = ((pointer.clientX - rect.left) / rect.width - 0.5) * aspect;
        target.y = 0.5 - (pointer.clientY - rect.top) / rect.height;
        if (!placed) {
          chain.forEach((body) => {
            body.x = target.x;
            body.y = target.y;
          });
          placed = true;
        }
      }

      // The sag fades in once a pointer exists, and is left out entirely for
      // visitors who ask for reduced motion.
      const wanted = pointer.seen && !reduced ? 1 : 0;
      presence += (wanted - presence) * (1 - Math.exp(-0.8 * dt));

      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        chain.forEach((body, index) => {
          stepSpring(body, target.x, target.y, h, CHAIN[index].stiffness, CHAIN[index].zeta);
        });
        stepSpring(tilt, target.x / Math.max(aspect, 1), target.y, h, TILT.stiffness, TILT.zeta);
      }

      chain.forEach((body, index) => {
        dentUniform[index * 3] = body.x;
        dentUniform[index * 3 + 1] = body.y;
        dentUniform[index * 3 + 2] = CHAIN[index].depth * presence;
      });

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(shell.program);
      gl.bindVertexArray(vao);
      gl.uniform2f(shell.uniforms.uRes, canvas.width, canvas.height);
      gl.uniform1f(shell.uniforms.uTime, time);
      gl.uniform2f(shell.uniforms.uTilt, tilt.x, tilt.y);
      gl.uniform3fv(shell.uniforms.uDents, dentUniform);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(shell.uniforms.uTex, 0);
      gl.uniform1f(shell.uniforms.uTexAspect, textureAspect);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!shown) {
        shown = true;
        setReady(true);
      }
    };

    frame = requestAnimationFrame(tick);

    // Stop drawing while the shell is scrolled out of view.
    const watcher = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !frame) {
          last = performance.now();
          frame = requestAnimationFrame(tick);
        }
      },
      { rootMargin: "80px" }
    );
    watcher.observe(canvas);

    return () => {
      gone = true;
      photo.onload = null;
      photo.onerror = null;
      cancelAnimationFrame(frame);
      watcher.disconnect();
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      gl.deleteTexture(texture);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(shell.program);
    };
  }, [src]);

  // Styled inline so the component can be dropped into any page without a
  // stylesheet. If the browser cannot draw it, the canvas is removed and
  // whatever the page put behind it shows through.
  const canvasStyle = unsupported ? { display: "none" } : ready ? { ...CANVAS, opacity: 1 } : CANVAS;
  return (
    <div className="nacre" style={FRAME}>
      <canvas ref={canvasRef} style={canvasStyle} aria-hidden="true" />
    </div>
  );
}
