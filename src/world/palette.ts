import * as THREE from "three";

// A white world with a few soft accents. The bird is the warmest thing in it.
export const COLORS = {
  ceramic: 0xfbfbfa,
  ceramicShade: 0xeceef2,
  lilac: 0xc7c0f2,
  mint: 0x9fd9c6,
  mintDark: 0x6fb8a2,
  ink: 0x2d3140,
  paper: 0xfffdf6,
  wood: 0xe9dccb,
  bird: 0xffc94f,
  birdBelly: 0xfff0c9,
  beak: 0xff8f4a,
  glasses: 0x2d3140,
  light: 0x7be0b0,
} as const;

export function mat(color: number, roughness = 0.55, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
}

export function castAll(obj: THREE.Object3D, receive = false): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = receive;
    }
  });
}
