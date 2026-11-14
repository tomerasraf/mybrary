import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Thought } from "@/lib/thoughts";
import { Animator } from "./anim";
import { Bird } from "./bird";
import { Brain, type BrainHooks } from "./brain";
import { BubbleField } from "./bubbles";
import { Desk } from "./desk";
import * as sound from "./sound";
import { ThoughtMachine, Tube } from "./tube";

export interface WorldOptions extends BrainHooks {
  fontFamily: string;
  greeting: string;
  onOpen: (id: number) => void;
}

export interface WorldHandle {
  setThoughts: (thoughts: Thought[]) => void;
  deliver: (thought: Thought) => void;
  pop: (id: number) => Promise<void>;
  setComposing: (value: boolean) => void;
  keystroke: (textLength: number) => void;
  focus: (id: number | null) => void;
  /** Screen position (CSS px) just above the bird's head. */
  birdAnchor: () => { x: number; y: number; visible: boolean };
  dispose: () => void;
}

const TAP_SLOP_PX = 8;
const TAP_MS = 350;

export function createWorld(canvas: HTMLCanvasElement, opts: WorldOptions): WorldHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(2.6, 2.9, 7.6);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(1.5, 1.45, 0.6);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 3;
  controls.maxDistance = 32;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.18;
  controls.update();

  // Light: a bright sky, a soft sun for shadows, and an invisible floor that only catches them.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ec, 2.2));
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.0);
  sun.position.set(4, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.12 }));
  floor.receiveShadow = true;
  scene.add(floor);

  const animator = new Animator();
  const tube = new Tube(animator);
  const machine = new ThoughtMachine(animator);
  const desk = new Desk();
  const bird = new Bird();
  const bubbles = new BubbleField(scene, animator, opts.fontFamily);
  scene.add(tube.group, machine.group, desk.group, bird.root);
  const brain = new Brain(bird, desk, machine, tube, bubbles, animator, opts);

  // ---------- sizing ----------
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // On tall (phone) screens keep the same sideways view by widening the vertical field of view.
    const minHorizontal = THREE.MathUtils.degToRad(58);
    const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHorizontal / 2) / camera.aspect));
    camera.fov = Math.min(85, Math.max(42, needed));
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // ---------- pointer: hover and tap ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number; t: number } | null = null;
  let idleSince = performance.now();

  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    toNdc(e);
    const id = bubbles.pick(raycaster);
    const overBird = raycaster.intersectObject(bird.root, true).length > 0;
    bubbles.setHover(id);
    canvas.style.cursor = id !== null || overBird ? "pointer" : "grab";
  };
  const onDown = (e: PointerEvent) => {
    sound.unlockAudio();
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    controls.autoRotate = false;
    idleSince = performance.now();
  };
  const onUp = (e: PointerEvent) => {
    idleSince = performance.now();
    if (!down) return;
    const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_SLOP_PX && performance.now() - down.t < TAP_MS;
    down = null;
    if (!tap) return;
    toNdc(e);
    if (raycaster.intersectObject(bird.root, true).length > 0) {
      brain.poke();
      return;
    }
    const id = bubbles.pick(raycaster);
    if (id !== null) {
      sound.touch();
      opts.onOpen(id);
    }
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  // ---------- loop ----------
  let last = performance.now();
  let time = 0;
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    time += dt;
    if (!controls.autoRotate && performance.now() - idleSince > 20_000) controls.autoRotate = true;
    animator.update(dt);
    tube.update(dt, time);
    machine.update(dt, time);
    desk.update(dt);
    bird.update(dt, time);
    bubbles.update(dt, time);
    controls.update();
    renderer.render(scene, camera);
  };
  frame();
  brain.start(opts.greeting);

  const anchor = new THREE.Vector3();
  return {
    setThoughts: (thoughts) => bubbles.setAll(thoughts),
    deliver: (thought) => brain.deliver(thought),
    pop: (id) => bubbles.pop(id),
    setComposing: (value) => brain.setComposing(value),
    keystroke: (len) => brain.keystroke(len),
    focus: (id) => bubbles.setFocus(id),
    birdAnchor: () => {
      bird.headTop(anchor).project(camera);
      const visible = anchor.z < 1 && Math.abs(anchor.x) < 1.2 && Math.abs(anchor.y) < 1.2;
      return {
        x: ((anchor.x + 1) / 2) * canvas.clientWidth,
        y: ((1 - anchor.y) / 2) * canvas.clientHeight,
        visible,
      };
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      brain.dispose();
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      controls.dispose();
      bubbles.disposeAll();
      renderer.dispose();
    },
  };
}
