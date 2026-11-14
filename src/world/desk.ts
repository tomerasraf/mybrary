import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COLORS, castAll, mat } from "./palette";

const PAPER_W = 0.26;
const PAPER_MAX_H = 0.3;

/** The bird's little desk and its mint typewriter. */
export class Desk {
  readonly group = new THREE.Group();
  /** Where the bird stands to type, and which way it faces. */
  // Turned a little toward the camera, so you see the bird's face and the page as it types.
  private static readonly YAW = 0.6;
  readonly standAt = new THREE.Vector3(2.75 + 0.55 * Math.cos(Desk.YAW), 0, 1.25 - 0.55 * Math.sin(Desk.YAW));
  readonly facing = Math.atan2(-Math.cos(Desk.YAW), Math.sin(Desk.YAW));
  private paper: THREE.Mesh;
  private paperAmount = 0;
  private shown = 0;
  private bars: THREE.Mesh[] = [];
  private barKick: number[] = [];
  private carriage: THREE.Group;

  constructor() {
    this.group.position.set(2.75, 0, 1.25);
    this.group.rotation.y = Desk.YAW;

    const top = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.05, 0.78, 3, 0.02), mat(COLORS.wood, 0.7));
    top.position.y = 0.27;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.25, 10), mat(COLORS.wood, 0.7));
    for (const [x, z] of [
      [-0.25, -0.33],
      [0.25, -0.33],
      [-0.25, 0.33],
      [0.25, 0.33],
    ]) {
      const l = leg.clone();
      l.position.set(x, 0.125, z);
      this.group.add(l);
    }

    // The typewriter faces +x, toward where the bird stands.
    const tw = new THREE.Group();
    tw.position.y = 0.295;
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.11, 0.42, 4, 0.04), mat(COLORS.mint, 0.42));
    body.position.y = 0.055;
    const deck = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.05, 0.38, 3, 0.02), mat(COLORS.mintDark, 0.45));
    deck.position.set(-0.08, 0.12, 0);

    this.carriage = new THREE.Group();
    this.carriage.position.set(-0.1, 0.16, 0);
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.46, 20).rotateX(Math.PI / 2), mat(COLORS.mintDark, 0.5));
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16).rotateX(Math.PI / 2), mat(COLORS.ink, 0.5));
    knob.position.z = 0.245;
    const knob2 = knob.clone();
    knob2.position.z = -0.245;
    this.carriage.add(roller, knob, knob2);

    this.paper = new THREE.Mesh(
      new THREE.PlaneGeometry(PAPER_W, 1).translate(0, 0.5, 0).rotateY(Math.PI / 2),
      mat(COLORS.paper, 0.9, { side: THREE.DoubleSide }),
    );
    this.paper.position.set(-0.01, 0.02, 0);
    this.paper.rotation.z = 0.25;
    this.paper.scale.y = 0.06;
    this.carriage.add(this.paper);

    // Three rows of round keys.
    const keyGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.012, 12);
    const keyMat = mat(COLORS.paper, 0.5);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 7 - row; i++) {
        const key = new THREE.Mesh(keyGeo, keyMat);
        key.position.set(0.04 + row * 0.04, 0.115 + row * 0.012, -0.15 + i * 0.05 + row * 0.025);
        tw.add(key);
      }
    }
    // Typebars that flick up when a key is struck.
    const barGeo = new THREE.BoxGeometry(0.006, 0.07, 0.006).translate(0, 0.035, 0);
    const barMat = mat(COLORS.ink, 0.4);
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(-0.02, 0.1, -0.06 + i * 0.024);
      bar.rotation.z = -1.2;
      tw.add(bar);
      this.bars.push(bar);
      this.barKick.push(0);
    }

    tw.add(body, deck, this.carriage);
    this.group.add(top, tw);
    castAll(this.group);
  }

  /** How full the page in the typewriter is, 0..1. */
  setPaper(amount: number): void {
    this.paperAmount = Math.max(0, Math.min(1, amount));
  }

  strike(): void {
    const i = Math.floor(Math.random() * this.bars.length);
    this.barKick[i] = 1;
  }

  /** Takes the page out of the typewriter and returns a loose copy for the bird to carry. */
  tearPage(): THREE.Mesh {
    const loose = new THREE.Mesh(
      new THREE.PlaneGeometry(PAPER_W * 0.8, PAPER_MAX_H * 0.8).rotateY(Math.PI / 2),
      mat(COLORS.paper, 0.9, { side: THREE.DoubleSide }),
    );
    loose.castShadow = true;
    this.paperAmount = 0;
    this.shown = 0;
    this.paper.scale.y = 0.06;
    return loose;
  }

  update(dt: number): void {
    this.shown += (Math.max(0.06, this.paperAmount * PAPER_MAX_H) - this.shown) * (1 - Math.exp(-6 * dt));
    this.paper.scale.y = Math.max(0.06, this.shown);
    // The carriage creeps along as the page fills.
    this.carriage.position.z = 0.08 - this.paperAmount * 0.16;
    this.bars.forEach((bar, i) => {
      this.barKick[i] = Math.max(0, this.barKick[i] - dt * 9);
      bar.rotation.z = -1.2 + this.barKick[i] * 1.05;
    });
  }
}
