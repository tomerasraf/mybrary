import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Cluster, Library } from "@/lib/library";
import type { PlacedBy, Thought } from "@/lib/thoughts";
import { Animator, damp, lerp } from "./anim";
import { Bird } from "./bird";
import { Brain, type BrainHooks } from "./brain";
import { Desk } from "./desk";
import { LibraryScene } from "./library";
import * as sound from "./sound";
import { ThoughtMachine, Tube } from "./tube";

export interface WorldOptions extends BrainHooks {
  fontFamily: string;
  greeting: string;
  onOpen: (id: number) => void;
  /** You tapped a shelf (or the bird's nook). */
  onOpenCluster: (id: number) => void;
  /** You tapped the word on a link. */
  onOpenLink: (id: number) => void;
  /** You dropped a bubble onto a shelf, or out onto the floor (null). It has already moved in the world. */
  onMove: (id: number, clusterId: number | null, from: { clusterId: number | null; placedBy: PlacedBy | null }) => void;
}

export interface WorldHandle {
  load: (library: Library) => void;
  deliver: (thought: Thought) => void;
  pop: (id: number) => Promise<void>;
  setComposing: (value: boolean) => void;
  keystroke: (textLength: number) => void;
  focus: (id: number | null) => void;
  updateCluster: (cluster: Cluster) => void;
  moveBubble: (id: number, clusterId: number | null, by: PlacedBy | null) => void;
  removeLink: (id: number) => void;
  /** Makes these bubbles glow until told otherwise (a search, the bird's answer). */
  mark: (ids: readonly number[]) => void;
  /** Flies the camera to a bubble. Null flies it back to the middle. */
  flyTo: (id: number | null) => void;
  /** Bring the world in line with the library as saved. */
  sync: (library: Library) => void;
  /** Screen position (CSS px) just above the bird's head. */
  birdAnchor: () => { x: number; y: number; visible: boolean };
  dispose: () => void;
}

const TAP_SLOP_PX = 8;
/** The camera never starts closer than this, and eases out as the library grows. */
const MIN_VIEW_DISTANCE = 7.2;
const MAX_VIEW_DISTANCE = 28;
const TAP_MS = 350;
/** How close the camera gets to a bubble it flies to. */
const FLY_DISTANCE = 6.2;
const HOME = new THREE.Vector3(1.5, 1.45, 0.6);

// The bird's brain may be running on the same graphics card as this world, so the world draws no more
// than it needs to: smoothly while something is happening, and half as often when all is calm.
/** Shortest time between two drawn frames while you're doing something or the bird is at its ritual (ms). */
const LIVELY_FRAME_MS = 1000 / 90;
/** ...and while nothing much is going on: about 30 frames a second. */
const CALM_FRAME_MS = 1000 / 30;
/** A display's frames never land exactly on time; this much early still counts. */
const FRAME_SLACK_MS = 1.5;
/** How long after your last touch the world stays lively. */
const LIVELY_AFTER_INPUT_MS = 2500;
/** Screens sharper than this are drawn at this sharpness: past it, you pay a lot of pixels for little. */
const MAX_PIXEL_RATIO = 1.5;

/** A soft pool of colour on the floor, so the tube, machine and desk stand on something. */
function stageTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (g) {
    const fade = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    fade.addColorStop(0, "rgba(196, 190, 236, 0.3)");
    fade.addColorStop(0.45, "rgba(202, 214, 240, 0.16)");
    fade.addColorStop(1, "rgba(220, 226, 240, 0)");
    g.fillStyle = fade;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(canvas: HTMLCanvasElement, opts: WorldOptions): WorldHandle {
  // "low-power": on a laptop with two graphics chips, this asks for the small one and leaves the big one to the model.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
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
  controls.target.copy(HOME);
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
  // Only the stage casts real shadows (bubbles have their own soft blobs), so a small, tight map is enough.
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -4.5;
  sun.shadow.camera.right = 4.5;
  sun.shadow.camera.top = 4.5;
  sun.shadow.camera.bottom = -4.5;
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.12 }));
  floor.receiveShadow = true;
  const stageMap = stageTexture();
  const stage = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: stageMap, transparent: true, depthWrite: false }),
  );
  stage.position.set(1.1, -0.002, 0.5);
  stage.renderOrder = -1;
  scene.add(stage, floor);

  const animator = new Animator();
  const tube = new Tube(animator);
  const machine = new ThoughtMachine(animator);
  const desk = new Desk();
  const bird = new Bird();
  const library = new LibraryScene(scene, animator, opts.fontFamily);
  const bubbles = library.bubbles;
  scene.add(tube.group, machine.group, desk.group, bird.root);
  const brain = new Brain(bird, desk, machine, tube, library, animator, opts);

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

  // ---------- pointer: hover, tap and drag ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  /** A press that may become a tap or, on a bubble, a drag. */
  let down: { id: number; x: number; y: number; t: number; bubble: number | null; dragging: boolean } | null = null;
  const dragPlane = new THREE.Plane();
  const dragHit = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  let idleSince = performance.now();
  let lastInput = performance.now();
  const onWheel = () => (lastInput = performance.now());

  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  const overBird = () => raycaster.intersectObject(bird.root, true).length > 0;

  const onMove = (e: PointerEvent) => {
    lastInput = performance.now();
    if (down && e.pointerId !== down.id) return;
    toNdc(e);
    if (down?.bubble != null) {
      if (!down.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= TAP_SLOP_PX) {
        const at = bubbles.position(down.bubble);
        if (!at) return;
        // Drag on a plane facing the camera, through the bubble.
        camera.getWorldDirection(camDir);
        dragPlane.setFromNormalAndCoplanarPoint(camDir, at);
        if (!library.startDrag(down.bubble, at)) {
          // The bird has it right now; this press just turns into nothing.
          down.bubble = null;
          return;
        }
        down.dragging = true;
        canvas.style.cursor = "grabbing";
        sound.touch();
      }
      if (down.dragging && raycaster.ray.intersectPlane(dragPlane, dragHit)) {
        dragHit.y = Math.max(0.5, dragHit.y);
        library.dragTo(dragHit, raycaster.ray, raycaster);
      }
      return;
    }
    if (e.pointerType !== "mouse") return;
    const id = bubbles.pick(raycaster);
    const link = id === null ? library.links.pick(raycaster) : null;
    const shelf = id === null && link === null ? library.clusters.pick(raycaster) : null;
    bubbles.setHover(id);
    library.links.setHover(link);
    library.clusters.setHover(shelf?.id ?? null);
    canvas.style.cursor = id !== null || link !== null || shelf !== null || overBird() ? "pointer" : "grab";
  };

  // Capture phase, so a press on a bubble can stop the camera from turning before OrbitControls sees it.
  const onDown = (e: PointerEvent) => {
    sound.unlockAudio();
    if (down) {
      // A second finger: let go of any drag (the bubble goes back), and let the camera have the gesture.
      cancelPress();
      return;
    }
    toNdc(e);
    const bubble = overBird() ? null : bubbles.pick(raycaster);
    const mine = bubble !== null && library.clusterOf(bubble) !== library.nook;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), bubble: mine ? bubble : null, dragging: false };
    if (mine) {
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
    }
    controls.autoRotate = false;
    fly = null;
    idleSince = performance.now();
  };

  const onUp = (e: PointerEvent) => {
    idleSince = performance.now();
    if (!down || e.pointerId !== down.id) return;
    controls.enabled = true;
    const press = down;
    down = null;
    if (press.dragging) {
      drop();
      return;
    }
    const tap = Math.hypot(e.clientX - press.x, e.clientY - press.y) < TAP_SLOP_PX && performance.now() - press.t < TAP_MS * 2;
    if (!tap) return;
    toNdc(e);
    if (overBird()) {
      brain.poke();
      return;
    }
    const id = bubbles.pick(raycaster);
    if (id !== null) {
      sound.touch();
      opts.onOpen(id);
      return;
    }
    const link = library.links.pick(raycaster);
    if (link !== null) {
      sound.touch();
      opts.onOpenLink(link);
      return;
    }
    const shelf = library.clusters.pick(raycaster);
    if (shelf) {
      sound.touch();
      opts.onOpenCluster(shelf.id);
    }
  };

  const drop = () => {
    const dropped = library.endDrag();
    canvas.style.cursor = "grab";
    if (!dropped) return;
    const from = { clusterId: library.clusterOf(dropped.id), placedBy: library.placedBy(dropped.id) };
    if (dropped.shelf === from.clusterId) return; // back where it was
    library.move(dropped.id, dropped.shelf, "you");
    sound.pop(0.6);
    opts.onMove(dropped.id, dropped.shelf, from);
  };
  /** Interrupted (a phone call, a second finger): the bubble goes back where it was. */
  const cancelPress = () => {
    controls.enabled = true;
    if (down?.dragging) {
      library.endDrag();
      canvas.style.cursor = "grab";
    }
    down = null;
  };
  const onCancel = (e: PointerEvent) => {
    if (down && e.pointerId === down.id) cancelPress();
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown, { capture: true });
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("wheel", onWheel, { passive: true });

  // While you're not steering, the camera eases back far enough to see the whole library.
  const fromTarget = new THREE.Vector3();
  const frameLibrary = (dt: number) => {
    const want = THREE.MathUtils.clamp(3 + library.extent() * 0.92, MIN_VIEW_DISTANCE, MAX_VIEW_DISTANCE);
    fromTarget.subVectors(camera.position, controls.target);
    const now = fromTarget.length();
    if (Math.abs(now - want) < 0.01) return;
    fromTarget.setLength(damp(now, want, 0.5, dt));
    camera.position.copy(controls.target).add(fromTarget);
  };

  // Flying to a bubble you looked for, and back to the middle afterwards.
  let fly: { to: THREE.Vector3; dist: number | null } | null = null;
  const flyStep = (dt: number) => {
    if (!fly) return;
    fromTarget.subVectors(camera.position, controls.target);
    const k = 1 - Math.exp(-3.2 * dt);
    controls.target.lerp(fly.to, k);
    if (fly.dist !== null) fromTarget.setLength(lerp(fromTarget.length(), fly.dist, k));
    camera.position.copy(controls.target).add(fromTarget);
    const there = controls.target.distanceTo(fly.to) < 0.02;
    if (there && (fly.dist === null || Math.abs(fromTarget.length() - fly.dist) < 0.05)) fly = null;
  };

  // ---------- loop ----------
  let last = performance.now();
  let time = 0;
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    // Skip this frame if the last one was drawn recently enough for what's going on.
    const lively = down !== null || fly !== null || brain.lively || now - lastInput < LIVELY_AFTER_INPUT_MS;
    if (now - last < (lively ? LIVELY_FRAME_MS : CALM_FRAME_MS) - FRAME_SLACK_MS) return;
    const dt = Math.min((now - last) / 1000, 1 / 15);
    last = now;
    time += dt;
    if (!controls.autoRotate && performance.now() - idleSince > 20_000) {
      controls.autoRotate = true;
      // Left looking at one bubble: drift back to the middle before turning again.
      if (controls.target.distanceTo(HOME) > 0.05) fly = { to: HOME.clone(), dist: null };
    }
    flyStep(dt);
    if (controls.autoRotate && !fly) frameLibrary(dt);
    animator.update(dt);
    tube.update(dt, time);
    machine.update(dt, time);
    desk.update(dt);
    bird.update(dt, time);
    library.update(dt, time);
    controls.update();
    renderer.render(scene, camera);
  };
  frame();
  brain.start(opts.greeting);

  const anchor = new THREE.Vector3();
  return {
    load: (lib) => library.load(lib),
    deliver: (thought) => brain.deliver(thought),
    pop: async (id) => {
      await bubbles.pop(id);
      library.removeThought(id);
    },
    setComposing: (value) => brain.setComposing(value),
    keystroke: (len) => brain.keystroke(len),
    focus: (id) => bubbles.setFocus(id),
    updateCluster: (c) => library.updateCluster(c),
    moveBubble: (id, clusterId, by) => library.move(id, clusterId, by),
    sync: (lib) => library.sync(lib),
    removeLink: (id) => void library.links.remove(id),
    mark: (ids) => bubbles.setMarked(ids),
    flyTo: (id) => {
      const at = id === null ? null : bubbles.position(id);
      controls.autoRotate = false;
      idleSince = performance.now();
      fly = at ? { to: at.clone(), dist: FLY_DISTANCE } : { to: HOME.clone(), dist: null };
    },
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
      canvas.removeEventListener("pointerdown", onDown, { capture: true });
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("wheel", onWheel);
      desk.dispose();
      stageMap.dispose();
      controls.dispose();
      library.disposeAll();
      renderer.dispose();
    },
  };
}
