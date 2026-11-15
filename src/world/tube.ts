import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Animator, damp, ease } from "./anim";
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
  private glowMat: THREE.MeshBasicMaterial;
  private shake = 0;
  private glow = 0;

  constructor(private animator: Animator) {
    // The outline of the vase, drawn through a soft curve so the flare has no hard edges.
    const outline = new THREE.SplineCurve(
      [
        [0.62, 0.05],
        [0.58, 0.1],
        [0.46, 0.18],
        [0.34, 0.34],
        [0.285, 0.55],
        [0.27, 1.0],
        [0.272, 1.5],
        [0.3, 1.74],
        [0.38, 1.93],
        [0.455, 2.03],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    );
    const profile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.6, 0),
      new THREE.Vector2(0.625, 0.02),
      ...outline.getPoints(44),
      new THREE.Vector2(0.45, 2.065),
      new THREE.Vector2(0.415, 2.075),
      new THREE.Vector2(0.37, 2.03),
      new THREE.Vector2(0.34, 1.9),
    ];
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), mat(COLORS.ceramic, 0.26, { side: THREE.DoubleSide }));

    const band = new THREE.Mesh(new THREE.TorusGeometry(0.283, 0.034, 16, 64).rotateX(Math.PI / 2), mat(COLORS.lilac, 0.38));
    band.position.y = 0.72;
    const band2 = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.034, 16, 64).rotateX(Math.PI / 2), mat(COLORS.mint, 0.38));
    band2.position.y = 1.32;
    const foot = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.026, 12, 72).rotateX(Math.PI / 2), mat(COLORS.ceramicShade, 0.4));
    foot.position.y = 0.026;

    this.filmMat = createBubbleMaterial(0.37);
    this.filmMat.uniforms.uOpacity.value = 0.35;
    this.film = new THREE.Mesh(new THREE.CircleGeometry(0.37, 48).rotateX(-Math.PI / 2), this.filmMat);
    this.film.position.y = 2.03;
    this.film.renderOrder = 3;

    // A warm light down in the throat when a thought is on its way up.
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.33, 40).rotateX(-Math.PI / 2), this.glowMat);
    glow.position.y = 1.96;
    glow.renderOrder = 2;

    this.group.add(body, band, band2, foot, this.film, glow);
    castAll(this.group);
    glow.castShadow = false;
    this.film.castShadow = false;
    body.receiveShadow = true;
  }

  /** Shakes for a while, like something is pushing its way up. */
  async rumble(seconds: number): Promise<void> {
    await this.animator.tween(
      seconds,
      (k) => {
        this.shake = Math.sin(k * Math.PI) * 1;
        this.glow = Math.sin(Math.min(1, k * 1.6) * Math.PI);
      },
      ease.linear,
    );
    this.shake = 0;
    this.glow = 0;
  }

  update(_dt: number, time: number): void {
    this.filmMat.uniforms.uTime.value = time;
    const s = this.shake;
    this.group.rotation.z = Math.sin(time * 38) * 0.02 * s;
    this.group.rotation.x = Math.cos(time * 31) * 0.016 * s;
    this.group.scale.set(1 - 0.03 * s * Math.sin(time * 20), 1 + 0.04 * s * Math.sin(time * 20), 1 - 0.03 * s * Math.sin(time * 20));
    this.filmMat.uniforms.uWobble.value = 1 + s * 4;
    this.glowMat.opacity = this.glow * 0.7;
  }
}

const PUFFS = 3;

/** The little machine the bird feeds pages into. It sends them along a glass pipe to the tube. */
export class ThoughtMachine {
  readonly group = new THREE.Group();
  /** Where the bird pushes the page in (world space). */
  readonly slot: THREE.Vector3;
  /** Where the bird stands to use it. */
  readonly standAt = new THREE.Vector3(1.25, 0, 0.98);
  private shell = new THREE.Group();
  private lampMat: THREE.MeshStandardMaterial;
  private needle: THREE.Group;
  private rollers: THREE.Mesh[] = [];
  private spark: THREE.Mesh;
  private pipe: THREE.CatmullRomCurve3;
  private puffs: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];
  private chimneyTop = new THREE.Vector3(-0.24, 0.6, -0.14);
  /** How hard the machine is working, 0..1: it hums, blinks and the needle swings. */
  private hum = 0;
  private humShown = 0;
  private puffIn = 0;

  constructor(private animator: Animator) {
    const origin = new THREE.Vector3(1.25, 0, 0.35);
    this.group.position.copy(origin);
    const ceramic = mat(COLORS.ceramic, 0.32);
    const shade = mat(COLORS.ceramicShade, 0.4);
    const ink = mat(COLORS.ink, 0.5);

    const box = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.4, 0.56, 6, 0.1), ceramic);
    box.position.y = 0.235;
    box.receiveShadow = true;
    const skirt = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.05, 0.52, 3, 0.022), shade);
    skirt.position.y = 0.05;

    // Where the page goes in: a mint plate, a dark slot between two rubber rollers, and a rest behind it.
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.03, 0.2, 3, 0.014), mat(COLORS.mint, 0.38));
    plate.position.set(0, 0.428, 0.13);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.012, 0.034), ink);
    slot.position.set(0, 0.441, 0.14);
    const rollerGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.36, 14).rotateZ(Math.PI / 2);
    for (const z of [0.117, 0.163]) {
      const roller = new THREE.Mesh(rollerGeo, mat(0x3a3f52, 0.6));
      roller.position.set(0, 0.447, z);
      this.rollers.push(roller);
    }
    const rest = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.2, 0.014, 3, 0.006), shade);
    rest.position.set(0, 0.52, 0.04);
    rest.rotation.x = -0.32;

    // The face: a dial whose needle swings while it works, three buttons and a lamp.
    const face = 0.281;
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.07, 36), mat(COLORS.paper, 0.6));
    dial.position.set(-0.19, 0.26, face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.011, 12, 40), mat(COLORS.mintDark, 0.4));
    rim.position.copy(dial.position);
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.15 + (i / 4) * 0.7);
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.002), ink);
      tick.position.set(-0.19 + Math.cos(a) * 0.052, 0.26 + Math.sin(a) * 0.052, face + 0.002);
      tick.rotation.z = a - Math.PI / 2;
      this.shell.add(tick);
    }
    this.needle = new THREE.Group();
    this.needle.position.set(-0.19, 0.245, face + 0.004);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.055, 0.003).translate(0, 0.0275, 0), mat(0xff8f4a, 0.5));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 12).rotateX(Math.PI / 2), ink);
    this.needle.add(hand, hub);
    this.needle.rotation.z = 0.9;

    [COLORS.lilac, 0xffd98a, 0xffb3a8].forEach((color, i) => {
      const button = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 18).rotateX(Math.PI / 2), mat(color, 0.4));
      button.position.set(0.03 + i * 0.07, 0.2, face + 0.004);
      this.shell.add(button);
    });
    this.lampMat = mat(COLORS.light, 0.3, { emissive: COLORS.light, emissiveIntensity: 0.2 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.026, 18, 12), this.lampMat);
    lamp.position.set(0.24, 0.31, face);
    const lampRing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 24), shade);
    lampRing.position.copy(lamp.position);
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.008, 0.004, 1, 0.002), mat(0xd5d9e2, 0.5));
      vent.position.set(0.1, 0.3 + i * 0.022, face + 0.001);
      this.shell.add(vent);
    }

    // A stubby chimney that puffs while the machine thinks.
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 20), shade);
    chimney.position.set(this.chimneyTop.x, 0.5, this.chimneyTop.z);
    const cap = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.012, 10, 24).rotateX(Math.PI / 2), mat(COLORS.lilac, 0.4));
    cap.position.set(this.chimneyTop.x, 0.58, this.chimneyTop.z);

    const footGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.03, 14);
    for (const [x, z] of [
      [-0.28, -0.2],
      [0.28, -0.2],
      [-0.28, 0.2],
      [0.28, 0.2],
    ]) {
      const foot = new THREE.Mesh(footGeo, mat(0xd5d9e2, 0.5));
      foot.position.set(x, 0.015, z);
      this.group.add(foot);
    }
    this.shell.add(box, skirt, plate, slot, ...this.rollers, rest, dial, rim, this.needle, lamp, lampRing, chimney, cap);
    this.slot = origin.clone().add(new THREE.Vector3(0, 0.45, 0.14));

    // A glass pipe from the machine's side into the tube, so you can watch the thought travel.
    this.pipe = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.34, 0.24, -0.04),
      new THREE.Vector3(-0.6, 0.26, -0.18),
      new THREE.Vector3(-0.84, 0.58, -0.31),
      new THREE.Vector3(-0.98, 0.95, -0.35),
    ]);
    const glass = new THREE.MeshStandardMaterial({
      color: 0xd9e6fb,
      roughness: 0.08,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    const pipeMesh = new THREE.Mesh(new THREE.TubeGeometry(this.pipe, 48, 0.055, 16), glass);
    pipeMesh.renderOrder = 1;
    const collarGeo = new THREE.TorusGeometry(0.06, 0.016, 10, 24);
    for (const [k, color] of [
      [0.03, COLORS.mint],
      [0.97, COLORS.lilac],
    ] as const) {
      const collar = new THREE.Mesh(collarGeo, mat(color, 0.4));
      collar.position.copy(this.pipe.getPoint(k));
      collar.lookAt(collar.position.clone().add(this.pipe.getTangent(k)));
      this.group.add(collar);
    }
    this.spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0, depthWrite: false }),
    );

    const puffGeo = new THREE.SphereGeometry(0.035, 12, 8);
    for (let i = 0; i < PUFFS; i++) {
      const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(puffGeo, puffMat);
      mesh.visible = false;
      this.puffs.push({ mesh, mat: puffMat, life: 0 });
      this.group.add(mesh);
    }

    this.group.add(this.shell, this.spark, pipeMesh);
    castAll(this.group);
    pipeMesh.castShadow = false;
    this.spark.castShadow = false;
    for (const p of this.puffs) p.mesh.castShadow = false;
    // Details on the face are too small for shadows worth drawing.
    this.shell.traverse((o) => {
      if (o !== box && o !== chimney && o !== rest && o !== skirt) o.castShadow = false;
    });
  }

  /** Pulls a loose page (already in the world, standing upright) down into the slot, a tug at a time. */
  async takePage(page: THREE.Mesh, height: number): Promise<void> {
    const from = page.position.clone();
    const above = this.slot.clone();
    above.y += height / 2 + 0.01;
    await this.animator.tween(0.4, (k) => {
      page.position.lerpVectors(from, above, k);
      page.position.y += Math.sin(k * Math.PI) * 0.06;
    });
    // Three tugs: the rollers grab, pull, pause.
    const tugs = 3;
    for (let i = 0; i < tugs; i++) {
      sound.tug();
      this.hum = 0.5;
      await this.animator.tween(
        0.17,
        (k) => {
          const eaten = (i + k) / tugs;
          const left = height * (1 - eaten);
          // The top edge sinks toward the slot while the bottom is already inside.
          page.scale.y = Math.max(0.001, 1 - eaten);
          page.position.set(this.slot.x, this.slot.y + left / 2, this.slot.z);
          for (const r of this.rollers) r.rotation.x -= 0.25;
        },
        ease.out,
      );
      await this.animator.wait(0.07);
    }
    this.hum = 0;
  }

  /** Works on the page for a moment, then sends a glowing thought up the pipe. */
  async swallow(): Promise<void> {
    sound.whir(1.3);
    await this.animator.tween(1.0, (k) => (this.hum = Math.sin(k * Math.PI)), ease.linear);
    const sparkMat = this.spark.material as THREE.MeshBasicMaterial;
    await this.animator.tween(
      0.8,
      (k) => {
        this.pipe.getPoint(k, this.spark.position);
        sparkMat.opacity = Math.sin(k * Math.PI) * 0.95;
        this.spark.scale.setScalar(0.8 + Math.sin(k * Math.PI * 4) * 0.15);
        this.hum = 0.4 * (1 - k);
      },
      ease.inOut,
    );
    sparkMat.opacity = 0;
    this.hum = 0;
  }

  update(dt: number, time: number): void {
    this.humShown = damp(this.humShown, this.hum, 10, dt);
    const h = this.humShown;
    const busy = h > 0.02;
    this.lampMat.emissiveIntensity = busy ? (Math.sin(time * 30) > 0 ? 1.8 : 0.3) : 0.3 + Math.sin(time * 1.5) * 0.12;
    // The whole case shivers and squashes a touch while it works; the needle swings to the right.
    this.shell.position.x = Math.sin(time * 60) * 0.005 * h;
    this.shell.scale.set(1 + h * 0.015, 1 - h * 0.025 + Math.sin(time * 24) * 0.008 * h, 1 + h * 0.015);
    this.needle.rotation.z = 0.9 - h * 1.7 + Math.sin(time * 17) * 0.12 * h;

    // Puffs from the chimney while it's working.
    this.puffIn -= dt;
    if (busy && this.puffIn <= 0) {
      const free = this.puffs.find((p) => p.life <= 0);
      if (free) {
        free.life = 1;
        free.mesh.visible = true;
        free.mesh.position.copy(this.chimneyTop);
        this.puffIn = 0.28;
      }
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life = Math.max(0, p.life - dt * 1.1);
      const age = 1 - p.life;
      p.mesh.position.y = this.chimneyTop.y + age * 0.34;
      p.mesh.position.x = this.chimneyTop.x + Math.sin(age * 5 + p.mesh.id) * 0.03;
      p.mesh.scale.setScalar(0.6 + age * 1.6);
      p.mat.opacity = Math.sin(Math.min(1, p.life * 1.4) * Math.PI * 0.5) * 0.75;
      if (p.life === 0) p.mesh.visible = false;
    }
  }
}
