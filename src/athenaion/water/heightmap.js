// Terrain height capture for the water system.
//
// Renders whatever terrain meshes exist (at water build time only the terrain module has run)
// from straight above with an orthographic camera into a float target, reads it back and
// builds (a) a CPU sampler of the *actual meshed* terrain height (used to trace waterfalls so
// sheets never cut into the cliff) and (b) a mipmapped half-float GPU texture (water depth,
// shoreline foam, soft intersection of spray with the ground).
// Falls back to the analytic heightAt() wherever the capture has no data.
import * as THREE from 'three';
import { heightAt } from '../world/heightfield.js';

const EMPTY = -9999;

function toHalfArray(f32) {
  const out = new Uint16Array(f32.length);
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < f32.length; i++) out[i] = toHalf(f32[i]);
  return out;
}

/** box-filtered mip chain for a single-channel float image (w,h powers of two not required) */
function buildMips(data, w, h) {
  const mips = [{ data, width: w, height: h }];
  let cw = w, ch = h, cur = data;
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
    const nd = new Float32Array(nw * nh);
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      const i0 = Math.min(cw - 1, i * 2), i1 = Math.min(cw - 1, i * 2 + 1);
      const j0 = Math.min(ch - 1, j * 2), j1 = Math.min(ch - 1, j * 2 + 1);
      nd[j * nw + i] = 0.25 * (cur[j0 * cw + i0] + cur[j0 * cw + i1] + cur[j1 * cw + i0] + cur[j1 * cw + i1]);
    }
    mips.push({ data: nd, width: nw, height: nh });
    cw = nw; ch = nh; cur = nd;
  }
  return mips;
}

/**
 * @param {Engine} engine
 * @param {object} o
 * @param {number[]} o.bounds [x0, z0, x1, z1] world metres
 * @param {number} o.res texels along the longer side
 * @param {(mesh)=>boolean} [o.filter] which meshes count as terrain
 */
export function captureHeightMap(engine, { bounds, res, filter }) {
  const t0 = performance.now();
  const [x0, z0, x1, z1] = bounds;
  const capRes = Math.min(res || 192, 192);
  const aspect = (x1 - x0) / (z1 - z0);
  const W = aspect >= 1 ? capRes : Math.max(8, Math.round(capRes * aspect));
  const H = aspect >= 1 ? Math.max(8, Math.round(capRes / aspect)) : capRes;

  const dx = (x1 - x0) / W, dz = (z1 - z0) / H;
  const data = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      data[j * W + i] = heightAt(x0 + (i + 0.5) * dx, z0 + (j + 0.5) * dz);
    }
  }
  const analyticFill = W * H;

  // GPU texture (half float, single channel, CPU mip chain)
  const mips = buildMips(data, W, H).map((m) => ({ data: toHalfArray(m.data), width: m.width, height: m.height }));
  const tex = new THREE.DataTexture(mips[0].data, W, H, THREE.RedFormat, THREE.HalfFloatType);
  tex.mipmaps = mips;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;

  /** bilinear CPU sample of the captured mesh height (null outside the bounds) */
  function sample(x, z) {
    const fx = (x - x0) / dx - 0.5, fz = (z - z0) / dz - 0.5;
    if (fx < 0 || fz < 0 || fx > W - 1 || fz > H - 1) return null;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const i1 = Math.min(W - 1, i + 1), j1 = Math.min(H - 1, j + 1);
    const a = data[j * W + i], b = data[j * W + i1], c = data[j1 * W + i], d = data[j1 * W + i1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  const ms = Math.round(performance.now() - t0);
  return { tex, data, W, H, bounds, sample, meshes: 0, analyticFill, ms };
}

export function defaultTerrainFilter(o) {
  if (o.name === 'sky' || o.name === 'testGround') return false;
  if (o.userData.isWater || o.userData.noHeightCapture) return false;
  if (o.material && (o.material.transparent || o.material.isShaderMaterial && o.material.depthWrite === false)) return false;
  return true;
}
