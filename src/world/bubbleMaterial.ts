import * as THREE from "three";

// A soap bubble drawn for a white world: nearly clear in the middle, thin-film rainbow at the
// rim, two window-like highlights, and a gentle wobble. Cheap enough for phones.

const vertex = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uWobble;
varying vec3 vNormalW;
varying vec3 vViewW;

void main() {
  vec3 p = position;
  float w = sin(p.y * 5.0 + uTime * 2.1 + uSeed * 6.0) * 0.6
          + sin(p.x * 4.0 - uTime * 1.6 + uSeed * 3.0) * 0.4
          + sin(p.z * 6.0 + uTime * 2.7) * 0.3;
  p += normal * w * 0.018 * uWobble;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uOpacity;
uniform float uGlow;
uniform vec3 uTint;
uniform float uTintAmt;
varying vec3 vNormalW;
varying vec3 vViewW;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewW);
  float facing = max(dot(N, V), 0.0);
  float f = 1.0 - facing;
  float fres = pow(f, 2.4);

  // Thin-film interference, faked with a cosine palette that drifts over time.
  float film = f * 2.6 + N.y * 0.5 + uTime * 0.04 + uSeed;
  vec3 iri = 0.5 + 0.5 * cos(6.28318 * (film + vec3(0.0, 0.33, 0.67)));
  iri = mix(iri, vec3(0.78, 0.84, 0.98), 0.25);

  // Two reflected "windows".
  vec3 R = reflect(-V, N);
  float s1 = smoothstep(0.93, 0.975, dot(R, normalize(vec3(-0.45, 0.75, 0.5))));
  float s2 = smoothstep(0.965, 0.99, dot(R, normalize(vec3(0.6, 0.35, 0.7))));
  float spec = clamp(s1 + s2 * 0.7, 0.0, 1.0);

  // A whisper of grey at the very edge keeps bubbles readable against white.
  float edge = smoothstep(0.82, 1.0, f);
  vec3 col = mix(iri, iri * 0.62, edge * 0.6);
  col = mix(col, vec3(1.0), spec);
  // A shelf's colour: the film takes it on, and the body holds a faint wash of it.
  col = mix(col, uTint * 0.92, uTintAmt * (0.75 + 0.25 * f));
  col += uGlow * vec3(0.25, 0.22, 0.12);

  float alpha = 0.035 + fres * 0.8 + spec * 0.85 + uGlow * 0.12 + uTintAmt * (0.1 + fres * 0.3);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uOpacity);
}
`;

export function createBubbleMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: seed },
      uWobble: { value: 1 },
      uOpacity: { value: 1 },
      uGlow: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uTintAmt: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
  });
}

let shadowTexture: THREE.Texture | null = null;

/** A soft round smudge, used as the floor shadow under floating things. */
export function blobShadowTexture(): THREE.Texture {
  if (shadowTexture) return shadowTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(60,70,90,0.55)");
    grad.addColorStop(0.5, "rgba(60,70,90,0.18)");
    grad.addColorStop(1, "rgba(60,70,90,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  shadowTexture = new THREE.CanvasTexture(canvas);
  return shadowTexture;
}

/** The first words of a thought, handwritten, to float inside its bubble. */
export function textTexture(text: string, fontFamily: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!g) return tex;

  g.fillStyle = "rgba(70, 76, 96, 0.78)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `56px ${fontFamily}`;
  g.direction = "inherit";

  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > size * 0.66 && line) {
      lines.push(line);
      line = word;
    } else line = next;
    if (lines.length === 3) break;
  }
  if (lines.length < 3 && line) lines.push(line);
  const lh = 62;
  const top = size / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => g.fillText(l, size / 2, top + i * lh));
  tex.needsUpdate = true;
  return tex;
}

/** A one-line handwritten label (a shelf's name, a link's word). `aspect` is width / height. */
export function labelTexture(
  text: string,
  fontFamily: string,
  color = "rgba(60, 66, 86, 0.9)",
): { texture: THREE.CanvasTexture; aspect: number } {
  const h = 128;
  const probe = document.createElement("canvas").getContext("2d");
  const font = `76px ${fontFamily}`;
  let w = 256;
  if (probe) {
    probe.font = font;
    w = Math.min(1536, Math.max(128, Math.ceil(probe.measureText(text).width + 48)));
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (g) {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 4);
    texture.needsUpdate = true;
  }
  return { texture, aspect: w / h };
}
