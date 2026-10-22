// Top-down analytical walkable surface map for WebGPU Athenaion (`surfaceMap` & `viewSurface`).
// Avoids synchronous WebGL `readRenderTargetPixels` stalls and evaluates `heightAt(x, z)` directly.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';

export function surfaceMap(engine, cx, cz, size, res) {
  const half = size / 2;
  const texel = size / res;
  const H = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    const z = cz - half + (j + 0.5) * texel;
    const row = (res - 1 - j) * res;
    for (let i = 0; i < res; i++) {
      const x = cx - half + (i + 0.5) * texel;
      H[row + i] = heightAt(x, z);
    }
  }
  const idx = (x, z) => {
    const i = Math.floor((x - (cx - half)) / texel);
    const j = Math.floor((z - (cz - half)) / texel);
    if (i < 0 || j < 0 || i >= res || j >= res) return -1;
    return (res - 1 - j) * res + i;
  };
  const h = (x, z) => {
    const k = idx(x, z);
    return k >= 0 ? H[k] : heightAt(x, z);
  };
  const has = (x, z) => idx(x, z) >= 0;
  const edge = (x, z, r = texel) => {
    const c = h(x, z);
    return Math.max(
      Math.abs(h(x + r, z) - c),
      Math.abs(h(x - r, z) - c),
      Math.abs(h(x, z + r) - c),
      Math.abs(h(x, z - r) - c),
    );
  };
  const normal = (x, z, r = texel) => {
    const nx = h(x - r, z) - h(x + r, z);
    const nz = h(x, z - r) - h(x, z + r);
    const ny = 2 * r;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  const obj = () => null;
  return { h, has, edge, normal, obj, size, res, texel, cx, cz };
}

export function viewSurface(engine, shot, w, h) {
  const cam = new THREE.PerspectiveCamera(shot.fov ?? 40, 1672 / 941, shot.near ?? 0.5, 30000);
  cam.position.set(...shot.pos);
  cam.lookAt(new THREE.Vector3(...shot.target));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return {
    w,
    h,
    at: () => null,
    obj: () => null,
    normal: () => null,
    cam,
  };
}
