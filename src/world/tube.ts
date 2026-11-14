import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Animator, ease } from "./anim";
import { createBubbleMaterial } from "./bubbleMaterial";
import { COLORS, castAll, mat } from "./palette";
import * as sound from "./sound";

/** The tube in the middle of everything, where thoughts become bubbles. */
export class Tube {
  readonly group = new THREE.Group();
  /** World position of the mouth's centre. */
  readonly mouth = new THREE.Vector3(0, 2.06, 0);
  private film: THREE.Mesh;
  private filmMat: THREE.ShaderMaterial;
  private shake = 0;

  constructor(private animator: Animator) {
    const profile = [
      [0.0, 0.0],
      [0.62, 0.0],
      [0.62, 0.06],
      [0.5, 0.14],
      [0.34, 0.32],
      [0.28, 0.5],
      [0.27, 1.5],
      [0.3, 1.75],
      [0.4, 1.95],
      [0.46, 2.04],
      [0.43, 2.08],
      [0.36, 2.02],
      [0.34, 1.9],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), mat(COLORS.ceramic, 0.28, { side: THREE.DoubleSide }));

    const band = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 16, 64).rotateX(Math.PI / 2), mat(COLORS.lilac, 0.4));
    band.position.y = 0.72;
    const band2 = band.clone();
    band2.position.y = 1.32;
    band2.material = mat(COLORS.mint, 0.4);

    this.filmMat = createBubbleMaterial(0.37);
    this.filmMat.uniforms.uOpacity.value = 0.35;
    this.film = new THREE.Mesh(new THREE.CircleGeometry(0.37, 48).rotateX(-Math.PI / 2), this.filmMat);
    this.film.position.y = 2.03;
    this.film.renderOrder = 3;

    this.group.add(body, band, band2, this.film);
    castAll(this.group);
    body.receiveShadow = true;
  }

  /** Shakes for a while, like something is pushing its way up. */
  async rumble(seconds: number): Promise<void> {
    await this.animator.tween(seconds, (k) => (this.shake = Math.sin(k * Math.PI) * 1), ease.linear);
    this.shake = 0;
  }

  update(dt: number, time: number): void {
    this.filmMat.uniforms.uTime.value = time;
    const s = this.shake;
    this.group.rotation.z = Math.sin(time * 38) * 0.02 * s;
    this.group.rotation.x = Math.cos(time * 31) * 0.016 * s;
    this.group.scale.set(1 - 0.03 * s * Math.sin(time * 20), 1 + 0.04 * s * Math.sin(time * 20), 1 - 0.03 * s * Math.sin(time * 20));
    this.filmMat.uniforms.uWobble.value = 1 + s * 4;
  }
}

/** The little machine the bird feeds pages into. It sends them along a pipe to the tube. */
export class ThoughtMachine {
  readonly group = new THREE.Group();
  /** Where the bird pushes the page in (world space). */
  readonly slot: THREE.Vector3;
  /** Where the bird stands to use it. */
  readonly standAt = new THREE.Vector3(1.25, 0, 0.98);
  private lamp: THREE.Mesh;
  private lampMat: THREE.MeshStandardMaterial;
  private spark: THREE.Mesh;
  private pipe: THREE.CatmullRomCurve3;
  private hum = 0;

  constructor(private animator: Animator) {
    const origin = new THREE.Vector3(1.25, 0, 0.35);
    this.group.position.copy(origin);

    const box = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.42, 0.56, 4, 0.08), mat(COLORS.ceramic, 0.35));
    box.position.y = 0.21;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.06), mat(COLORS.ink, 0.6));
    slot.position.set(0, 0.42, 0.14);
    const lip = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.04, 0.12, 2, 0.02), mat(COLORS.mint, 0.4));
    lip.position.set(0, 0.415, 0.14);
    this.lampMat = mat(COLORS.light, 0.3, { emissive: COLORS.light, emissiveIntensity: 0.2 });
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), this.lampMat);
    this.lamp.position.set(0.24, 0.3, 0.285);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), mat(COLORS.ceramicShade));
    for (const [x, z] of [
      [-0.28, -0.2],
      [0.28, -0.2],
      [-0.28, 0.2],
      [0.28, 0.2],
    ]) {
      const f = foot.clone();
      f.position.set(x, 0.0, z);
      this.group.add(f);
    }
    this.group.add(box, slot, lip, this.lamp);
    this.slot = origin.clone().add(new THREE.Vector3(0, 0.44, 0.14));

    // A pipe from the machine's back into the side of the tube.
    this.pipe = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.3, 0.22, -0.05),
      new THREE.Vector3(-0.62, 0.25, -0.2),
      new THREE.Vector3(-0.86, 0.6, -0.32),
      new THREE.Vector3(-0.98, 0.95, -0.35),
    ]);
    const pipeMesh = new THREE.Mesh(new THREE.TubeGeometry(this.pipe, 48, 0.055, 14), mat(COLORS.ceramicShade, 0.3));
    this.spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3b8, transparent: true, opacity: 0 }),
    );
    this.group.add(pipeMesh, this.spark);
    castAll(this.group);
  }

  /** Swallows a page and sends a glowing thought up the pipe. */
  async swallow(): Promise<void> {
    sound.whir(1.3);
    await this.animator.tween(1.0, (k) => (this.hum = Math.sin(k * Math.PI)), ease.linear);
    const sparkMat = this.spark.material as THREE.MeshBasicMaterial;
    await this.animator.tween(
      0.8,
      (k) => {
        this.pipe.getPoint(k, this.spark.position);
        sparkMat.opacity = Math.sin(k * Math.PI) * 0.95;
        this.hum = 0.4 * (1 - k);
      },
      ease.inOut,
    );
    sparkMat.opacity = 0;
    this.hum = 0;
  }

  update(_dt: number, time: number): void {
    const blink = this.hum > 0.01 ? (Math.sin(time * 30) > 0 ? 1.6 : 0.2) : 0.25 + Math.sin(time * 1.5) * 0.1;
    this.lampMat.emissiveIntensity = blink;
    this.group.position.x = 1.25 + Math.sin(time * 60) * 0.006 * this.hum;
  }
}
