import * as THREE from "three";
import { Animator, ease, lerpAngle } from "./anim";
import type { Bird } from "./bird";
import { clampToRing, planPath, type Obstacle, type Vec2 } from "./layout";
import * as sound from "./sound";

/** Things on the floor the bird walks around: the tube, the machine, the desk. */
const OBSTACLES: Obstacle[] = [
  { x: 0, z: 0, r: 0.75 },
  { x: 1.25, z: 0.35, r: 0.6 },
  { x: 2.75, z: 1.25, r: 0.6 },
];

/** The bird's motor skills: walking, turning, hopping and flying. The brain decides where to go. */
export class Motor {
  private head = new THREE.Vector3();

  constructor(
    private bird: Bird,
    private animator: Animator,
  ) {}

  get airborne(): boolean {
    return this.bird.root.position.y > 0.02;
  }

  get position(): THREE.Vector3 {
    return this.bird.root.position;
  }

  /** Just above the bird's head: where it balances a bubble it carries. */
  headPoint(out = this.head): THREE.Vector3 {
    return this.bird.headTop(out);
  }

  async walkTo(target: THREE.Vector3, signal?: AbortSignal, speed = 0.8): Promise<void> {
    const b = this.bird;
    const from: Vec2 = { x: b.root.position.x, z: b.root.position.z };
    const route = planPath(from, { x: target.x, z: target.z }, OBSTACLES);
    try {
      for (const p of route) {
        const start = b.root.position.clone();
        const end = new THREE.Vector3(p.x, 0, p.z);
        const dist = start.distanceTo(end);
        if (dist < 0.03) continue;
        await this.face(Math.atan2(end.x - start.x, end.z - start.z), signal, 0.18);
        b.moving = Math.min(1, speed);
        await this.animator.tween(dist / speed, (k) => b.root.position.lerpVectors(start, end, k), ease.linear, signal);
      }
    } finally {
      b.moving = 0;
    }
  }

  /** Flies in a soft arc to a point in the air (or on the floor). Keeps hovering when it arrives aloft. */
  async flyTo(target: THREE.Vector3, signal?: AbortSignal, speed = 1.8): Promise<void> {
    const b = this.bird;
    const start = b.root.position.clone();
    const dist = start.distanceTo(target);
    if (dist < 0.05) return;
    const mid = start.clone().lerp(target, 0.5);
    mid.y = Math.max(start.y, target.y) + Math.min(1.1, 0.25 + dist * 0.12);
    const curve = new THREE.QuadraticBezierCurve3(start, mid, target.clone());
    if (!this.airborne) sound.flutter();
    b.flap = 1;
    b.lean = 0.45;
    try {
      await this.face(Math.atan2(target.x - start.x, target.z - start.z), signal, 0.22);
      await this.animator.tween(0.35 + dist / speed, (k) => curve.getPoint(k, b.root.position), ease.inOut, signal);
    } finally {
      b.lean = 0;
      b.flap = this.airborne ? 0.4 : 0;
    }
  }

  /** Comes back down to the floor, if it's in the air. Not interruptible: it's short. */
  async land(): Promise<void> {
    if (!this.airborne) return;
    const p = this.bird.root.position;
    const spot = clampToRing({ x: p.x, z: p.z }, 1.6, 7);
    await this.flyTo(new THREE.Vector3(spot.x, 0, spot.z), undefined, 2.4);
    this.bird.flap = 0;
    this.bird.root.position.y = 0;
  }

  async face(yaw: number, signal?: AbortSignal, seconds = 0.3): Promise<void> {
    const r = this.bird.root.rotation;
    const from = r.y;
    await this.animator.tween(seconds, (k) => (r.y = lerpAngle(from, yaw, k)), ease.inOut, signal);
  }

  faceToward(p: THREE.Vector3, signal?: AbortSignal): Promise<void> {
    const at = this.bird.root.position;
    return this.face(Math.atan2(p.x - at.x, p.z - at.z), signal);
  }

  async hop(times: number, height: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.animator.tween(0.32, (k) => (this.bird.hopY = Math.sin(k * Math.PI) * height), ease.linear);
    }
    this.bird.hopY = 0;
  }
}
