import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { damp } from "./anim";
import { hash01 } from "./layout";
import { COLORS, castAll, mat } from "./palette";

const PAPER_W = 0.24;
/** The page at its tallest, in world units. */
const PAPER_H = 0.3;
/** How many letters fit on one line of the page. */
export const LINE_CHARS = 22;
const MAX_LINES = 9;
const CANVAS_W = 240;
const CANVAS_H = 300;
const LINE_PX = 30;
const MARGIN_PX = 26;
/** How far the carriage travels across one line. */
const CARRIAGE_TRAVEL = 0.15;
const KEY_ROWS = [7, 7, 6] as const;

interface Key {
  mesh: THREE.Mesh;
  restY: number;
  press: number;
}

/** Where a letter count puts you on the page: which line, and how far along it. */
export function pagePosition(textLength: number): { line: number; col: number } {
  const n = Math.max(0, Math.floor(textLength));
  // A long thought keeps typing on the last line rather than running off the page.
  const line = Math.min(MAX_LINES - 1, Math.floor(n / LINE_CHARS));
  return { line, col: n % LINE_CHARS };
}

/** Draws a page of pretend handwriting: one little ink stroke per letter, with gaps between words. */
function drawPage(g: CanvasRenderingContext2D, textLength: number): void {
  g.fillStyle = "#fffdf6";
  g.fillRect(0, 0, CANVAS_W, CANVAS_H);
  g.strokeStyle = "rgba(45, 49, 64, 0.82)";
  g.lineWidth = 5;
  g.lineCap = "round";
  const letter = (CANVAS_W - MARGIN_PX * 2) / LINE_CHARS;
  const total = Math.min(Math.max(0, textLength), MAX_LINES * LINE_CHARS);
  let wordLeft = 0;
  for (let i = 0; i < total; i++) {
    const line = Math.floor(i / LINE_CHARS);
    const col = i % LINE_CHARS;
    if (col === 0) wordLeft = 0;
    // Word lengths come from the position, so the page looks the same every time it is redrawn.
    if (wordLeft === 0) {
      wordLeft = 2 + Math.floor(hash01(i * 7 + 3) * 5);
      if (col !== 0) continue; // the gap between two words
    }
    wordLeft -= 1;
    const x = MARGIN_PX + col * letter;
    const y = MARGIN_PX + line * LINE_PX + (hash01(i + 11) - 0.5) * 2.4;
    g.beginPath();
    g.moveTo(x + 1.5, y);
    g.lineTo(x + letter - 2.5, y);
    g.stroke();
  }
}

/** The bird's low writing desk and its mint typewriter. */
export class Desk {
  readonly group = new THREE.Group();
  // Turned a little toward the camera, so you see the bird's face and the page as it types.
  private static readonly YAW = 0.6;
  private static readonly REACH = 0.48;
  /** Where the bird stands to type, and which way it faces. */
  readonly standAt = new THREE.Vector3(2.75 + Desk.REACH * Math.cos(Desk.YAW), 0, 1.25 - Desk.REACH * Math.sin(Desk.YAW));
  readonly facing = Math.atan2(-Math.cos(Desk.YAW), Math.sin(Desk.YAW));

  private canvas: HTMLCanvasElement | null = null;
  private ink: CanvasRenderingContext2D | null = null;
  private pageTex: THREE.CanvasTexture | null = null;
  private paper: THREE.Mesh;
  private paperMat: THREE.MeshStandardMaterial;
  private carriage = new THREE.Group();
  private lever: THREE.Mesh;
  private keys: Key[] = [];
  private spaceBar: Key;
  private bars: THREE.Mesh[] = [];
  private barKick: number[] = [];
  private textLength = 0;
  private shownHeight = 0.05;
  private carriageZ = CARRIAGE_TRAVEL / 2;
  /** 1 right after a carriage return, easing to 0: the lever flicks and the carriage zips back. */
  private returning = 0;
  private shake = 0;

  constructor() {
    this.group.position.set(2.75, 0, 1.25);
    this.group.rotation.y = Desk.YAW;
    const wood = mat(COLORS.wood, 0.72);

    // A low table: the bird is small, and has to reach the keys.
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.04, 0.78, 4, 0.018), wood);
    top.position.y = 0.105;
    const legGeo = new THREE.CylinderGeometry(0.02, 0.015, 0.09, 10);
    for (const [x, z] of [
      [-0.19, -0.32],
      [0.19, -0.32],
      [-0.19, 0.32],
      [0.19, 0.32],
    ]) {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(x, 0.045, z);
      leg.rotation.set(z > 0 ? 0.12 : -0.12, 0, x > 0 ? -0.12 : 0.12);
      this.group.add(leg);
    }
    const surface = 0.125;

    // A stack of blank pages and a cup of pencils, so it looks like somebody works here.
    const sheet = new RoundedBoxGeometry(0.15, 0.006, 0.2, 1, 0.002);
    for (let i = 0; i < 4; i++) {
      const page = new THREE.Mesh(sheet, mat(COLORS.paper, 0.9));
      page.position.set(-0.14 + hash01(i) * 0.012, surface + 0.003 + i * 0.006, -0.27);
      page.rotation.y = (hash01(i + 5) - 0.5) * 0.24;
      this.group.add(page);
    }
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.06, 20), mat(COLORS.lilac, 0.45));
    cup.position.set(-0.17, surface + 0.03, 0.3);
    this.group.add(cup);
    for (const [dx, dz, color] of [
      [0.008, 0.004, 0xffc94f],
      [-0.01, -0.006, COLORS.mintDark],
      [0.0, 0.012, 0xff9f8a],
    ] as const) {
      const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.09, 6), mat(color, 0.5));
      pencil.position.set(-0.17 + dx, surface + 0.075, 0.3 + dz);
      pencil.rotation.set(dz * 14, 0, -dx * 14);
      this.group.add(pencil);
    }

    // The typewriter faces +x, toward where the bird stands.
    const tw = new THREE.Group();
    tw.position.set(0.04, surface, 0);
    const mint = mat(COLORS.mint, 0.38);
    const dark = mat(COLORS.mintDark, 0.42);
    const ink = mat(COLORS.ink, 0.45);

    const base = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.05, 0.42, 5, 0.022), mint);
    base.position.set(-0.01, 0.026, 0);
    // The keyboard sits on a slope that rises away from the bird.
    const slope = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.03, 0.38, 4, 0.014), mint);
    slope.position.set(0.055, 0.058, 0);
    slope.rotation.z = -0.3;
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.085, 0.4, 5, 0.03), mint);
    housing.position.set(-0.105, 0.075, 0);
    const basket = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 10, 28, Math.PI).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2), dark);
    basket.position.set(-0.035, 0.078, 0);
    const badge = new THREE.Mesh(new RoundedBoxGeometry(0.006, 0.014, 0.07, 2, 0.003), mat(COLORS.paper, 0.5));
    badge.position.set(0.161, 0.03, 0);
    tw.add(base, slope, housing, basket, badge);

    // Round keys in three rows, each one able to dip.
    const cap = new THREE.CylinderGeometry(0.0135, 0.0135, 0.009, 16);
    const capMat = mat(COLORS.paper, 0.42);
    KEY_ROWS.forEach((count, row) => {
      for (let i = 0; i < count; i++) {
        const key = new THREE.Mesh(cap, capMat);
        const restY = 0.067 + row * 0.0125;
        key.position.set(0.118 - row * 0.038, restY, (i - (count - 1) / 2) * 0.047 + (row === 1 ? 0.012 : 0));
        tw.add(key);
        this.keys.push({ mesh: key, restY, press: 0 });
      }
    });
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.15, 4, 10).rotateX(Math.PI / 2), capMat);
    bar.position.set(0.15, 0.052, 0);
    tw.add(bar);
    this.spaceBar = { mesh: bar, restY: 0.052, press: 0 };

    // Typebars that swing up and hit the page when a key is struck.
    const barGeo = new THREE.BoxGeometry(0.005, 0.085, 0.005).translate(0, 0.0425, 0);
    for (let i = 0; i < 7; i++) {
      const typebar = new THREE.Mesh(barGeo, ink);
      typebar.position.set(-0.03, 0.08, (i - 3) * 0.018);
      typebar.rotation.z = -1.25;
      tw.add(typebar);
      this.bars.push(typebar);
      this.barKick.push(0);
    }

    // The carriage: a rubber roller with knobs, a return lever, and the page.
    this.carriage.position.set(-0.115, 0.135, this.carriageZ);
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.02, 0.5, 3, 0.008), dark);
    rail.position.set(0, -0.015, 0);
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.4, 24).rotateX(Math.PI / 2), mat(0x3a3f52, 0.6));
    const knobGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.028, 20).rotateX(Math.PI / 2);
    const knobA = new THREE.Mesh(knobGeo, ink);
    knobA.position.z = 0.215;
    const knobB = new THREE.Mesh(knobGeo, ink);
    knobB.position.z = -0.215;
    const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.36, 8).rotateX(Math.PI / 2), mat(0xdfe3ea, 0.25, { metalness: 0.6 }));
    guide.position.set(0.026, 0.02, 0);
    this.lever = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.07, 4, 8).translate(0, 0.035, 0), mat(0xdfe3ea, 0.25, { metalness: 0.6 }));
    this.lever.position.set(0.02, 0.0, 0.2);
    this.lever.rotation.set(0.5, 0, -1.1);
    this.carriage.add(rail, roller, knobA, knobB, guide, this.lever);

    if (typeof document !== "undefined") {
      this.canvas = document.createElement("canvas");
      this.canvas.width = CANVAS_W;
      this.canvas.height = CANVAS_H;
      this.ink = this.canvas.getContext("2d");
      this.pageTex = new THREE.CanvasTexture(this.canvas);
      this.pageTex.colorSpace = THREE.SRGBColorSpace;
      this.pageTex.anisotropy = 4;
    }
    // A little of its own light, so the page reads as white paper and not as a grey card.
    this.paperMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.pageTex,
      emissive: 0xffffff,
      emissiveMap: this.pageTex,
      emissiveIntensity: 0.3,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(PAPER_W, 1).translate(0, 0.5, 0).rotateY(Math.PI / 2), this.paperMat);
    this.paper.position.set(-0.012, 0.012, 0);
    this.paper.rotation.z = 0.22;
    this.carriage.add(this.paper);
    tw.add(this.carriage);

    this.group.add(top, tw);
    castAll(this.group);
    top.receiveShadow = true;
    // The smallest parts are too small to throw a shadow anyone would see: skipping them saves drawing them twice.
    for (const small of [...this.keys.map((k) => k.mesh), ...this.bars, bar, badge, guide, this.lever]) small.castShadow = false;
    this.redraw();
  }

  /**
   * The text is this long now. Moves the carriage and the page to match.
   * Returns true when that started a new line (time for the bell).
   */
  type(textLength: number): boolean {
    const before = pagePosition(this.textLength);
    this.textLength = Math.max(0, textLength);
    const now = pagePosition(this.textLength);
    this.redraw();
    const newLine = now.line > before.line;
    if (newLine) this.returning = 1;
    return newLine;
  }

  /** One key goes down and a typebar flicks up. `space`: the long bar instead. */
  strike(space = false): void {
    if (space) this.spaceBar.press = 1;
    else this.keys[Math.floor(Math.random() * this.keys.length)].press = 1;
    this.barKick[Math.floor(Math.random() * this.bars.length)] = 1;
    this.shake = 1;
  }

  /** Takes the page out of the typewriter and returns a loose copy, typed lines and all, for the bird to carry. */
  tearPage(): THREE.Mesh {
    let map: THREE.CanvasTexture | null = null;
    if (this.canvas && typeof document !== "undefined") {
      const copy = document.createElement("canvas");
      copy.width = CANVAS_W;
      copy.height = CANVAS_H;
      copy.getContext("2d")?.drawImage(this.canvas, 0, 0);
      map = new THREE.CanvasTexture(copy);
      map.colorSpace = THREE.SRGBColorSpace;
    }
    const loose = new THREE.Mesh(
      new THREE.PlaneGeometry(PAPER_W * 0.8, PAPER_H * 0.8).rotateY(Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map,
        emissive: 0xffffff,
        emissiveMap: map,
        emissiveIntensity: 0.3,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    loose.castShadow = true;
    this.textLength = 0;
    this.shownHeight = 0.05;
    this.returning = 1;
    this.redraw();
    return loose;
  }

  update(dt: number): void {
    const { line, col } = pagePosition(this.textLength);

    // The page feeds up one line at a time; only the typed part (and a little margin) shows above the roller.
    const shownPx = MARGIN_PX + (line + 0.75) * LINE_PX;
    const want = Math.max(0.05, (shownPx / CANVAS_H) * PAPER_H);
    this.shownHeight = damp(this.shownHeight, want, 9, dt);
    this.paper.scale.y = this.shownHeight;
    if (this.pageTex) {
      const part = Math.min(1, this.shownHeight / PAPER_H);
      this.pageTex.repeat.set(1, part);
      this.pageTex.offset.set(0, 1 - part);
    }

    // The carriage steps along with every letter, and zips back on a new line.
    this.returning = Math.max(0, this.returning - dt * 3.2);
    const target = CARRIAGE_TRAVEL / 2 - (col / LINE_CHARS) * CARRIAGE_TRAVEL;
    this.carriageZ = damp(this.carriageZ, target, this.returning > 0 ? 14 : 30, dt);
    this.shake = Math.max(0, this.shake - dt * 14);
    this.carriage.position.z = this.carriageZ;
    this.carriage.position.y = 0.135 - this.shake * 0.0025;
    this.lever.rotation.z = -1.1 + Math.sin(this.returning * Math.PI) * 0.7;

    for (const key of [...this.keys, this.spaceBar]) {
      if (key.press <= 0 && key.mesh.position.y === key.restY) continue;
      key.press = Math.max(0, key.press - dt * 11);
      key.mesh.position.y = key.restY - Math.sin(key.press * Math.PI) * 0.007;
    }
    this.bars.forEach((typebar, i) => {
      this.barKick[i] = Math.max(0, this.barKick[i] - dt * 10);
      typebar.rotation.z = -1.25 + Math.sin(this.barKick[i] * Math.PI) * 1.15;
    });
  }

  dispose(): void {
    this.pageTex?.dispose();
  }

  private redraw(): void {
    if (!this.ink || !this.pageTex) return;
    drawPage(this.ink, this.textLength);
    this.pageTex.needsUpdate = true;
  }
}
