"use client";

import { useEffect, useRef } from "react";
import type { Palette } from "@/lib/mood";

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

// Domain-warped noise "weather": slow aurora ribbons in the mood colours,
// a faint star field, and a soft grain so it feels like paper under light.
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uTop, uBottom, uGlow, uSpark;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * uRes.x / uRes.y, uv.y);
  float t = uTime * 0.05;

  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, uv.y));

  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1));
  float ribbons = fbm(p * 2.0 + q * 1.8 + vec2(t * 0.6, -t));
  float band = smoothstep(0.45, 0.85, ribbons) * (0.35 + 0.65 * uv.y);
  col = mix(col, uGlow, band * 0.32);
  float wisp = smoothstep(0.62, 0.95, fbm(p * 3.0 - q + t * 0.8));
  col = mix(col, uSpark, wisp * 0.18);

  // stars, stronger near the top
  vec2 g = floor(gl_FragCoord.xy / 3.0);
  float s = hash(g);
  float twinkle = 0.5 + 0.5 * sin(uTime * (0.6 + s * 2.0) + s * 40.0);
  col += step(0.9975, s) * twinkle * smoothstep(0.2, 1.0, uv.y) * 0.8;

  col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.035; // grain
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[sky] shader error", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

const RESOLUTION = 0.5; // render at half size; it's soft anyway
const FRAME_MS = 1000 / 30;

export function MoodSky({ palette, speed }: { palette: Palette; speed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Depend on the colour strings, not the object: every server action
  // re-renders the layout with a fresh palette object.
  const { skyTop, skyBottom, glow, spark } = palette;

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { antialias: false, alpha: false });
    if (!canvas || !gl) return; // CSS gradient on <body> is the fallback

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // Shaders are owned by the linked program from here on.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[sky] link error", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform3fv(u("uTop"), hexToRgb(skyTop));
    gl.uniform3fv(u("uBottom"), hexToRgb(skyBottom));
    gl.uniform3fv(u("uGlow"), hexToRgb(glow));
    gl.uniform3fv(u("uSpark"), hexToRgb(spark));
    const uRes = u("uRes");
    const uTime = u("uTime");

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const drawStill = () => {
      gl.uniform1f(uTime, 20);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const resize = () => {
      canvas.width = Math.max(1, Math.floor(window.innerWidth * RESOLUTION));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * RESOLUTION));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      if (still) drawStill(); // resizing clears the canvas
    };
    resize();
    window.addEventListener("resize", resize);
    const start = performance.now();
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      gl.uniform1f(uTime, ((now - start) / 1000) * speed + 20);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    if (!still) {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteBuffer(buf);
    };
  }, [skyTop, skyBottom, glow, spark, speed]);

  return <canvas ref={ref} className="sky" aria-hidden />;
}
