import * as THREE from "three";
import { damp } from "./anim";
import { COLORS, castAll, mat } from "./palette";

const BODY_Y = 0.245;

/**
 * The little bird with round glasses: a procedural rig plus the per-frame motion that brings
 * it to life. The brain sets intentions (walk, type, look up…); this turns them into poses.
 */
export class Bird {
  readonly root = new THREE.Group();
  /** Things the bird carries attach here. */
  readonly holder = new THREE.Group();

  // Intentions, set by the brain. All 0..1 unless noted.
  moving = 0;
  typing = false;
  lookUp = 0;
  lean = 0;
  slump = 0;
  flap = 0;
  hopY = 0;
  beakOpen = 0;
  onStep: (() => void) | null = null;

  private body = new THREE.Group();
  private wingL = new THREE.Group();
  private wingR = new THREE.Group();
  private footL = new THREE.Group();
  private footR = new THREE.Group();
  private beakLow = new THREE.Group();
  private tuft = new THREE.Group();
  private tail = new THREE.Group();
  private eyes: THREE.Mesh[] = [];

  private walkPhase = 0;
  private lastStepSign = 1;
  private strikeL = 0;
  private strikeR = 0;
  private strikeSide = false;
  private talkLeft = 0;
  private blinkIn = 2;
  private blinking = 0;
  private lastHop = 0;
  private hopSpeed = 0;
  /** A springy lag behind the body's movement, for the tuft and tail. */
  private sway = 0;
  private swayV = 0;
  private cur = { lookUp: 0, lean: 0, slump: 0, flap: 0, beak: 0, moving: 0, typing: 0 };

  constructor() {
    const yellow = mat(COLORS.bird, 0.58);
    const deep = mat(0xf5b63a, 0.6);
    const belly = mat(COLORS.birdBelly, 0.68);
    const orange = mat(COLORS.beak, 0.45);
    const ink = mat(COLORS.ink, 0.25);

    // A round body, a touch wider at the bottom, with a pale tummy and a fluff of chest feathers.
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 48, 36), yellow);
    ball.scale.set(1, 1.04, 0.95);
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.19, 36, 24), yellow);
    hips.position.set(0, -0.035, -0.01);
    hips.scale.set(1.04, 0.85, 0.98);
    const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.15, 36, 26), belly);
    tummy.position.set(0, -0.055, 0.083);
    tummy.scale.set(1, 1, 0.62);
    for (const [x, y, s] of [
      [-0.03, -0.015, 0.03],
      [0.03, -0.015, 0.03],
      [0, -0.045, 0.034],
    ]) {
      const fluff = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), belly);
      fluff.position.set(x, y, 0.172);
      fluff.scale.set(1, 1.1, 0.5);
      this.body.add(fluff);
    }

    // Eyes with two glints, soft cheeks, and round glasses with a little glass in them.
    const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const rim = mat(COLORS.glasses, 0.28);
    const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false });
    const cheekMat = new THREE.MeshStandardMaterial({ color: 0xffa7a0, roughness: 0.9, transparent: true, opacity: 0.7, depthWrite: false });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.027, 20, 16), ink);
      eye.position.set(0.068 * side, 0.06, 0.17);
      const big = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), glint);
      big.position.set(0.009, 0.011, 0.022);
      const small = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), glint);
      small.position.set(-0.008, -0.007, 0.024);
      eye.add(big, small);
      this.eyes.push(eye);

      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.0075, 12, 40), rim);
      lens.position.set(0.07 * side, 0.06, 0.19);
      lens.rotation.y = side * 0.25;
      const pane = new THREE.Mesh(new THREE.CircleGeometry(0.046, 28), glass);
      pane.position.copy(lens.position);
      pane.rotation.y = lens.rotation.y;
      pane.renderOrder = 4;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.14, 8).rotateX(Math.PI / 2), rim);
      arm.position.set(0.155 * side, 0.065, 0.12);
      arm.rotation.y = side * 0.55;
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), cheekMat);
      cheek.position.set(0.12 * side, -0.008, 0.143);
      cheek.scale.set(1, 0.6, 0.4);
      this.body.add(eye, lens, pane, arm, cheek);
    }
    const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0055, 8, 16, Math.PI), rim);
    bridge.position.set(0, 0.066, 0.203);

    const beakUp = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.075, 20).rotateX(Math.PI / 2), orange);
    beakUp.position.set(0, 0.005, 0.215);
    beakUp.scale.set(1, 0.7, 1);
    const lower = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.05, 16).rotateX(Math.PI / 2), orange);
    lower.position.set(0, -0.006, 0.022);
    lower.scale.set(1, 0.55, 1);
    this.beakLow.position.set(0, -0.012, 0.19);
    this.beakLow.add(lower);

    // Three soft feathers on top that bounce, and a fan of three for a tail.
    const featherGeo = new THREE.SphereGeometry(1, 14, 10);
    for (const [x, tilt, h, back] of [
      [-0.024, 0.5, 0.05, -0.25],
      [0.0, 0.0, 0.066, -0.45],
      [0.026, -0.5, 0.046, -0.2],
    ]) {
      const feather = new THREE.Mesh(featherGeo, yellow);
      feather.scale.set(0.016, h, 0.022);
      feather.position.set(x, h * 0.8, 0);
      feather.rotation.set(back, 0, tilt);
      this.tuft.add(feather);
    }
    this.tuft.position.set(0, 0.2, -0.012);

    for (const [a, len] of [
      [-0.55, 0.075],
      [0, 0.09],
      [0.55, 0.075],
    ]) {
      const feather = new THREE.Mesh(featherGeo, deep);
      feather.scale.set(0.03, 0.012, len);
      feather.position.set(Math.sin(a) * 0.045, 0, -Math.cos(a) * len * 0.75);
      feather.rotation.y = a;
      this.tail.add(feather);
    }
    this.tail.position.set(0, -0.04, -0.17);
    this.tail.rotation.x = 0.5;

    // Wings: a soft teardrop with two darker flight feathers at the tip.
    for (const [wing, side] of [
      [this.wingL, -1],
      [this.wingR, 1],
    ] as const) {
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), yellow);
      w.scale.set(0.4, 1, 0.85);
      w.position.set(0.02 * side, -0.075, 0);
      for (const [dz, dy, s] of [
        [-0.03, -0.155, 0.034],
        [0.022, -0.165, 0.038],
      ]) {
        const tip = new THREE.Mesh(featherGeo, deep);
        tip.scale.set(0.014, s, 0.026);
        tip.position.set(0.024 * side, dy + 0.02, dz);
        wing.add(tip);
      }
      wing.add(w);
      wing.position.set(0.178 * side, 0.03, -0.005);
    }

    this.holder.position.set(0, -0.03, 0.27);
    this.body.add(ball, hips, tummy, bridge, beakUp, this.beakLow, this.tuft, this.tail, this.wingL, this.wingR, this.holder);
    this.body.position.y = BODY_Y;

    for (const [foot, side] of [
      [this.footL, -1],
      [this.footR, 1],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.01, 0.07, 10), orange);
      leg.position.y = -0.035;
      for (const a of [-0.55, 0, 0.55]) {
        const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.036, 4, 10).rotateX(Math.PI / 2), orange);
        toe.position.set(Math.sin(a) * 0.021, -0.068, 0.02 + Math.cos(a) * 0.012);
        toe.rotation.y = a;
        foot.add(toe);
      }
      foot.add(leg);
      foot.position.set(0.07 * side, 0.075, 0.02);
    }

    this.root.add(this.body, this.footL, this.footR);
    castAll(this.root);
    // Glasses, glints and cheeks don't need shadows of their own.
    this.body.traverse((o) => {
      const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (geo && (geo.type === "TorusGeometry" || geo.type === "CircleGeometry")) o.castShadow = false;
    });
    for (const eye of this.eyes) eye.traverse((o) => (o.castShadow = false));
  }

  /** One key press: alternate wings stab at the keys. */
  strike(): void {
    this.strikeSide = !this.strikeSide;
    if (this.strikeSide) this.strikeL = 1;
    else this.strikeR = 1;
  }

  /** Moves the beak as if talking, for a while. */
  talk(seconds: number): void {
    this.talkLeft = Math.max(this.talkLeft, seconds);
  }

  /** World position just above the bird's head, for speech bubbles. */
  headTop(target: THREE.Vector3): THREE.Vector3 {
    return this.body.localToWorld(target.set(0, 0.34, 0));
  }

  update(dt: number, time: number): void {
    const c = this.cur;
    c.moving = damp(c.moving, this.moving, 10, dt);
    c.lookUp = damp(c.lookUp, this.lookUp, 4, dt);
    c.lean = damp(c.lean, this.lean, 6, dt);
    c.slump = damp(c.slump, this.slump, 2.5, dt);
    c.flap = damp(c.flap, this.flap, 8, dt);
    c.typing = damp(c.typing, this.typing ? 1 : 0, 9, dt);

    // Walking: waddle, bounce, swinging feet, and a step sound per footfall.
    if (this.moving > 0.01) this.walkPhase += dt * 13 * Math.max(0.6, this.moving);
    const sw = Math.sin(this.walkPhase);
    if (c.moving > 0.3 && Math.sign(sw) !== this.lastStepSign) {
      this.lastStepSign = Math.sign(sw) || 1;
      this.onStep?.();
    }

    this.strikeL = Math.max(0, this.strikeL - dt * 9);
    this.strikeR = Math.max(0, this.strikeR - dt * 9);
    const strike = Math.max(this.strikeL, this.strikeR);

    // Hops stretch on the way up and squash on landing.
    this.hopSpeed = damp(this.hopSpeed, dt > 0 ? (this.hopY - this.lastHop) / dt : 0, 20, dt);
    this.lastHop = this.hopY;
    const stretch = THREE.MathUtils.clamp(this.hopSpeed * 0.22, -0.16, 0.2);

    const breath = Math.sin(time * 2.2) * 0.006;
    const bounce = Math.abs(sw) * 0.035 * c.moving;
    this.body.position.y = BODY_Y + bounce + breath - c.slump * 0.03 + this.hopY - strike * 0.008 * c.typing;
    // A curious tilt of the head when it looks up at a bubble.
    const curious = Math.sin(time * 0.9) * 0.1 * c.lookUp;
    this.body.rotation.z = sw * 0.14 * c.moving + Math.sin(time * 0.7) * 0.03 * c.slump + curious;
    // At the typewriter it bends over the keys, and nods a little with every strike.
    this.body.rotation.x = -c.lookUp * 0.5 + c.lean * 0.4 + c.slump * 0.15 + c.typing * (0.14 + strike * 0.05);
    this.body.scale.set(1 + breath - stretch * 0.5, 1 - breath + stretch, 1 + breath - stretch * 0.5);

    this.footL.rotation.x = sw * 0.7 * c.moving;
    this.footR.rotation.x = -sw * 0.7 * c.moving;
    this.footL.position.y = 0.075 + Math.max(0, sw) * 0.03 * c.moving + this.hopY;
    this.footR.position.y = 0.075 + Math.max(0, -sw) * 0.03 * c.moving + this.hopY;

    // Wings: resting, typing, or flapping with joy.
    const flapAngle = Math.abs(Math.sin(time * 22)) * 1.3 * c.flap;
    const restZ = 0.12 + Math.sin(time * 2.2) * 0.03 - c.slump * 0.08;
    const reach = c.typing;
    // Wings stretch a little to reach the keys.
    this.wingL.scale.y = this.wingR.scale.y = 1 + reach * 0.22;
    this.wingL.rotation.set(-c.lean * 1.2 * (1 - reach) - reach * (1.15 + this.strikeL * 0.5), 0, -((restZ + flapAngle) * (1 - reach) + reach * 0.32));
    this.wingR.rotation.set(-c.lean * 1.2 * (1 - reach) - reach * (1.15 + this.strikeR * 0.5), 0, (restZ + flapAngle) * (1 - reach) + reach * 0.32);

    // The tuft and tail trail behind whatever the body does, on a little spring.
    const drive = sw * c.moving * 0.5 + this.hopSpeed * 0.25 + strike * 0.35 * c.typing;
    this.swayV += ((drive - this.sway) * 90 - this.swayV * 9) * dt;
    this.sway += this.swayV * dt;
    this.tuft.rotation.x = -0.1 - this.sway * 0.9 + Math.sin(time * 1.7) * 0.04;
    this.tuft.rotation.z = Math.sin(time * 1.3) * 0.05 + sw * 0.1 * c.moving;
    this.tail.rotation.x = 0.5 + this.sway * 0.5 + c.flap * Math.sin(time * 18) * 0.2;
    this.tail.rotation.y = sw * 0.25 * c.moving;

    // Beak: chatter while talking, plus any deliberate opening (a yawn).
    this.talkLeft = Math.max(0, this.talkLeft - dt);
    const chatter = this.talkLeft > 0 ? (Math.sin(time * 24) * 0.5 + 0.5) * 0.45 : 0;
    c.beak = damp(c.beak, Math.max(this.beakOpen, chatter), 18, dt);
    this.beakLow.rotation.x = c.beak * 0.7;

    // Blinking, sleepy lids when it slumps, and happy squinting eyes when it flaps for joy.
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinking = 0.14;
      this.blinkIn = 2 + Math.random() * 4;
    }
    this.blinking = Math.max(0, this.blinking - dt);
    const lid = this.blinking > 0 ? 0.12 : (1 - c.slump * 0.45) * (1 - Math.min(1, c.flap) * 0.55);
    for (const eye of this.eyes) eye.scale.y = lid;
  }
}
