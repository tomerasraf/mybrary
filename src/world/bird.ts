import * as THREE from "three";
import { damp } from "./anim";
import { COLORS, castAll, mat } from "./palette";

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
  private eyes: THREE.Mesh[] = [];

  private walkPhase = 0;
  private lastStepSign = 1;
  private strikeL = 0;
  private strikeR = 0;
  private strikeSide = false;
  private talkLeft = 0;
  private blinkIn = 2;
  private blinking = 0;
  private cur = { lookUp: 0, lean: 0, slump: 0, flap: 0, beak: 0, moving: 0 };

  constructor() {
    const yellow = mat(COLORS.bird, 0.62);
    const belly = mat(COLORS.birdBelly, 0.7);
    const orange = mat(COLORS.beak, 0.5);
    const ink = mat(COLORS.ink, 0.35);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 40, 30), yellow);
    ball.scale.set(1, 1.04, 0.95);
    const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 24), belly);
    tummy.position.set(0, -0.05, 0.085);
    tummy.scale.set(1, 1, 0.62);

    // Eyes, glints and round glasses.
    const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const rim = mat(COLORS.glasses, 0.3);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), ink);
      eye.position.set(0.068 * side, 0.06, 0.172);
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), glint);
      g.position.set(0.008, 0.009, 0.02);
      eye.add(g);
      this.eyes.push(eye);
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.0065, 10, 32), rim);
      lens.position.set(0.07 * side, 0.06, 0.19);
      lens.rotation.y = side * 0.25;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 6).rotateX(Math.PI / 2), rim);
      arm.position.set(0.155 * side, 0.065, 0.12);
      arm.rotation.y = side * 0.55;
      const cheek = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0xffa7a0, roughness: 0.9, transparent: true, opacity: 0.75 }),
      );
      cheek.position.set(0.118 * side, -0.005, 0.145);
      cheek.scale.set(1, 0.6, 0.4);
      this.body.add(eye, lens, arm, cheek);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6).rotateZ(Math.PI / 2), rim);
    bridge.position.set(0, 0.07, 0.2);

    const beakUp = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.075, 16).rotateX(Math.PI / 2), orange);
    beakUp.position.set(0, 0.005, 0.215);
    beakUp.scale.set(1, 0.7, 1);
    const lower = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.05, 14).rotateX(Math.PI / 2), orange);
    lower.position.set(0, -0.006, 0.022);
    lower.scale.set(1, 0.55, 1);
    this.beakLow.position.set(0, -0.012, 0.19);
    this.beakLow.add(lower);

    // A little tuft on top and a tail behind.
    for (const [x, tilt, h] of [
      [-0.02, 0.35, 0.07],
      [0.0, 0.0, 0.09],
      [0.022, -0.35, 0.065],
    ]) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.018, h, 10), yellow);
      tuft.position.set(x, 0.205 + h / 2 - 0.01, -0.01);
      tuft.rotation.z = tilt;
      this.body.add(tuft);
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), yellow);
    tail.position.set(0, -0.05, -0.2);
    tail.rotation.x = -2.1;
    tail.scale.set(1, 1, 0.35);

    for (const [wing, side] of [
      [this.wingL, -1],
      [this.wingR, 1],
    ] as const) {
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), yellow);
      w.scale.set(0.42, 1, 0.85);
      w.position.set(0.02 * side, -0.075, 0);
      wing.add(w);
      wing.position.set(0.178 * side, 0.03, -0.005);
    }

    this.holder.position.set(0, -0.03, 0.27);
    this.body.add(ball, tummy, bridge, beakUp, this.beakLow, tail, this.wingL, this.wingR, this.holder);
    this.body.position.y = 0.245;

    for (const [foot, side] of [
      [this.footL, -1],
      [this.footR, 1],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.07, 8), orange);
      leg.position.y = -0.035;
      for (const a of [-0.5, 0, 0.5]) {
        const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.035, 4, 8).rotateX(Math.PI / 2), orange);
        toe.position.set(Math.sin(a) * 0.02, -0.07, 0.02 + Math.cos(a) * 0.012);
        toe.rotation.y = a;
        foot.add(toe);
      }
      foot.add(leg);
      foot.position.set(0.07 * side, 0.075, 0.02);
    }

    this.root.add(this.body, this.footL, this.footR);
    castAll(this.root);
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

    // Walking: waddle, bounce, swinging feet, and a step sound per footfall.
    if (this.moving > 0.01) this.walkPhase += dt * 13 * Math.max(0.6, this.moving);
    const sw = Math.sin(this.walkPhase);
    if (c.moving > 0.3 && Math.sign(sw) !== this.lastStepSign) {
      this.lastStepSign = Math.sign(sw) || 1;
      this.onStep?.();
    }
    const breath = Math.sin(time * 2.2) * 0.006;
    this.body.position.y = 0.245 + Math.abs(sw) * 0.035 * c.moving + breath - c.slump * 0.03 + this.hopY;
    this.body.rotation.z = sw * 0.14 * c.moving + Math.sin(time * 0.7) * 0.03 * c.slump;
    this.body.rotation.x = -c.lookUp * 0.5 + c.lean * 0.4 + c.slump * 0.15;
    this.body.scale.set(1 + breath, 1 - breath, 1 + breath);

    this.footL.rotation.x = sw * 0.7 * c.moving;
    this.footR.rotation.x = -sw * 0.7 * c.moving;
    this.footL.position.y = 0.075 + Math.max(0, sw) * 0.03 * c.moving + this.hopY;
    this.footR.position.y = 0.075 + Math.max(0, -sw) * 0.03 * c.moving + this.hopY;

    // Wings: resting, typing, or flapping with joy.
    this.strikeL = Math.max(0, this.strikeL - dt * 8);
    this.strikeR = Math.max(0, this.strikeR - dt * 8);
    const flapAngle = Math.abs(Math.sin(time * 22)) * 1.3 * c.flap;
    const restZ = 0.12 + Math.sin(time * 2.2) * 0.03 - c.slump * 0.08;
    if (this.typing) {
      this.wingL.rotation.set(-1.0 - this.strikeL * 0.45, 0, -0.35);
      this.wingR.rotation.set(-1.0 - this.strikeR * 0.45, 0, 0.35);
    } else {
      this.wingL.rotation.set(-c.lean * 1.2, 0, -(restZ + flapAngle));
      this.wingR.rotation.set(-c.lean * 1.2, 0, restZ + flapAngle);
    }

    // Beak: chatter while talking, plus any deliberate opening (a yawn).
    this.talkLeft = Math.max(0, this.talkLeft - dt);
    const chatter = this.talkLeft > 0 ? (Math.sin(time * 24) * 0.5 + 0.5) * 0.45 : 0;
    c.beak = damp(c.beak, Math.max(this.beakOpen, chatter), 18, dt);
    this.beakLow.rotation.x = c.beak * 0.7;

    // Blinking.
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinking = 0.14;
      this.blinkIn = 2 + Math.random() * 4;
    }
    this.blinking = Math.max(0, this.blinking - dt);
    const lid = this.blinking > 0 ? 0.12 : 1 - c.slump * 0.45;
    for (const eye of this.eyes) eye.scale.y = lid;
  }
}
