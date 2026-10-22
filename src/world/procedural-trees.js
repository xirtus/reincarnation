/**
 * Procedural Trees for Reincarnation: The Serpent's Spine
 * ----------------------------------------------------------------------------
 * 1. Dryad-Powered Sakura Cherry Blossom Trees (adapted from owenyuwono/dryad):
 *    - Full Dryad botanical pipeline: allometric skeleton (buildSkeleton) +
 *      geotropic root & buttress system (growRootSystem) + pipe-model
 *      proportion solver (solveProportions) + parallel-transport tapered branch
 *      mesh with per-vertex crotch AO (buildBranchGeometry) + phyllotactic
 *      foliage cluster solver (generateFoliage).
 *    - High-resolution (1024x1024) organic corymbose sakura sprig texture with
 *      16 varied sub-umbels, serrated spring cherry leaves, buds, 3D-tilted
 *      blossoms, and Sobel tangent-space normal maps (no flat pixelated grids!).
 *    - Curved 3D cupped sprig shells + true 3D 5-petal cupped sakura florets
 *      with Dryad canopy exposure shading and TSL spring breeze sway.
 *
 * 2. Dryad Procedural Forest Trees (from owenyuwono/dryad):
 *    - Botanical allometric skeleton + root system + proportion solver +
 *      branch mesh + curved 3D foliage clusters with Sobel normal maps for
 *      deciduous oaks, crimson maples, and highland pines.
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, float, vec3, sin, cos, smoothstep, clamp, max, length,
  positionLocal, positionWorld, normalWorld, attribute, uv, mix, abs,
} from 'three/tsl';

import { mulberry32 } from './dryad/rng.js';
import { TREE_DEFAULT, PRESETS } from './dryad/presets.js';
import { buildSkeleton } from './dryad/skeleton.js';
import { growRootSystem, ROOT_SALT } from './dryad/roots.js';
import { solveProportions } from './dryad/proportions.js';
import { buildBranchGeometry } from './dryad/branchMesh.js';
import { generateFoliage } from './dryad/foliage.js';
import { makeLeafClusterTexture } from './dryad/leafTexture.js';

import { GRASS_DEFAULT, PRESETS as GAIA_PRESETS } from './gaia/presets.js';
import { buildSkeleton as buildGaiaSkeleton } from './gaia/skeleton.js';
import { solveProportions as solveGaiaProportions } from './gaia/proportions.js';
import { buildBladeGeometry } from './gaia/bladeMesh.js';
import { generateFoliage as generateGaiaFoliage } from './gaia/foliage.js';
import { computeFieldScatter } from './gaia/fieldScatter.js';
import { colorStackRGB } from './gaia/colorRamp.js';

// ─────────────────────────────────────────────────────────────────────────────
// SOBEL TANGENT-SPACE NORMAL MAP BUILDER (adapted from dryad/leafTexture.js)
// ─────────────────────────────────────────────────────────────────────────────

function buildTangentNormalMapTexture(srcCanvas, strength = 2.6, repeat = false) {
  if (typeof document === 'undefined') return null;
  const W = srcCanvas.width;
  const H = srcCanvas.height;
  const sctx = srcCanvas.getContext('2d');
  const src = sctx.getImageData(0, 0, W, H).data;

  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const a = src[i * 4 + 3] / 255;
    const lum = (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255;
    // Slight dome profile from alpha + petal/bark luminance ridges
    h[i] = a > 0.03 ? (lum * 0.75 + Math.pow(a, 0.6) * 0.25) : 0;
  }

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  const oimg = octx.createImageData(W, H);
  const od = oimg.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xm = repeat ? (x - 1 + W) % W : Math.max(0, x - 1);
      const xp = repeat ? (x + 1) % W : Math.min(W - 1, x + 1);
      const ym = repeat ? (y - 1 + H) % H : Math.max(0, y - 1);
      const yp = repeat ? (y + 1) % H : Math.min(H - 1, y + 1);

      const xl = h[y * W + xm];
      const xr = h[y * W + xp];
      const yu = h[ym * W + x];
      const yd = h[yp * W + x];

      const nx = (xl - xr) * strength;
      const ny = (yd - yu) * strength;
      const nz = 1.0;
      const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);

      od[i * 4] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      od[i * 4 + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      od[i * 4 + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      od[i * 4 + 3] = src[i * 4 + 3];
    }
  }
  octx.putImageData(oimg, 0, 0);

  const normTex = new THREE.CanvasTexture(out);
  if (repeat) {
    normTex.wrapS = THREE.RepeatWrapping;
    normTex.wrapT = THREE.RepeatWrapping;
  }
  normTex.needsUpdate = true;
  return normTex;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SAKURA CHERRY BLOSSOM TEXTURE (Organic Dryad Sprig + 16 Corymbose Umbels)
// ─────────────────────────────────────────────────────────────────────────────

function petalWidth(t) {
  if (t <= 0 || t >= 1) return 0;
  return Math.pow(Math.sin(t * Math.PI), 0.56) * (0.44 + 0.56 * Math.pow(t, 0.40));
}

function samplePetalField(px, py, R) {
  const t = py / R;
  if (t < 0 || t > 1.05) return -1;
  const halfW = petalWidth(Math.min(1, Math.max(0, t))) * R * 0.52;
  if (halfW < 1e-4) return -1;
  const nx = Math.abs(px) / halfW;
  // Characteristic Prunus serrulata apical V-notch
  if (t > 0.77) {
    const notchDepth = (t - 0.77) / 0.23;
    const notchWidth = 0.29 * notchDepth;
    if (nx < notchWidth) return -1;
  }
  if (nx > 1.0) return -1;
  return 1.0 - nx;
}

/**
 * Draws a single high-detail Prunus serrulata blossom with 3D foreshortening tilt,
 * cupped shading, delicate venation, crimson nectary throat, and golden anthers.
 */
function drawSingleSakuraFlower(ctx, cx, cy, radius, baseRot, rng, tintShift = 0, tiltAspect = 1.0, tiltAngle = 0) {
  const numPetals = 5;
  const cosTilt = Math.cos(tiltAngle);
  const sinTilt = Math.sin(tiltAngle);

  for (let p = 0; p < numPetals; p++) {
    const angle = baseRot + (p * Math.PI * 2) / numPetals + (rng() - 0.5) * 0.09;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const r = radius * (0.90 + rng() * 0.16);
    const bound = Math.ceil(r * 1.14);
    const x0 = Math.max(0, Math.floor(cx - bound));
    const x1 = Math.min(ctx.canvas.width - 1, Math.ceil(cx + bound));
    const y0 = Math.max(0, Math.floor(cy - bound));
    const y1 = Math.min(ctx.canvas.height - 1, Math.ceil(cy + bound));
    if (x1 <= x0 || y1 <= y0) continue;

    const img = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const data = img.data;
    const w = x1 - x0 + 1;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const rawDx = x - cx;
        const rawDy = y - cy;
        // Apply 3D foreshortening tilt so blossoms sit at varied natural angles
        const tx = rawDx * cosTilt + rawDy * sinTilt;
        const ty = (-rawDx * sinTilt + rawDy * cosTilt) / Math.max(0.45, tiltAspect);
        const px = tx * cosA + ty * sinA;
        const py = -tx * sinA + ty * cosA;
        const inside = samplePetalField(px, py, r);
        if (inside <= 0) continue;

        const t = Math.min(1, Math.max(0, py / r));
        const edgeSoft = Math.min(1, inside * 4.2);
        // Cupped 3D bowl shading: inner dish slightly recessed, outer petal rim catches sun
        const dishHighlight = Math.sin(t * Math.PI) * 14 * (1 - Math.abs(px) / (r * 0.55));
        const throat = Math.pow(Math.max(0, 1 - t * 1.55), 1.75);
        const vein = Math.sin(Math.abs(px / (r * 0.30)) * 14.0) * 0.035 * (1 - t * 0.5);

        const pr = Math.min(255, Math.max(160, Math.round(252 - throat * 38 + tintShift * 12 + dishHighlight * 0.5 + vein * 22)));
        const pg = Math.min(255, Math.max(110, Math.round(222 - throat * 112 + tintShift * 8 + dishHighlight * 0.7 - (1 - t) * 10)));
        const pb = Math.min(255, Math.max(145, Math.round(235 - throat * 70 + tintShift * 10 + dishHighlight * 0.6)));
        const pa = Math.round(edgeSoft * 252);

        const idx = ((y - y0) * w + (x - x0)) * 4;
        const oldA = data[idx + 3] / 255;
        const newA = pa / 255;
        const outA = newA + oldA * (1 - newA);
        if (outA > 0) {
          data[idx] = Math.round((pr * newA + data[idx] * oldA * (1 - newA)) / outA);
          data[idx + 1] = Math.round((pg * newA + data[idx + 1] * oldA * (1 - newA)) / outA);
          data[idx + 2] = Math.round((pb * newA + data[idx + 2] * oldA * (1 - newA)) / outA);
          data[idx + 3] = Math.round(outA * 255);
        }
      }
    }
    ctx.putImageData(img, x0, y0);
  }

  // Warm crimson-rose calyx heart + delicate radiating stamen filaments + golden pollen anthers
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tiltAngle);
  ctx.scale(1, Math.max(0.5, tiltAspect));

  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.28);
  grad.addColorStop(0, 'rgba(182, 34, 78, 0.96)');
  grad.addColorStop(0.55, 'rgba(222, 84, 126, 0.70)');
  grad.addColorStop(1, 'rgba(250, 202, 220, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
  ctx.fill();

  const stamenCount = 16;
  for (let s = 0; s < stamenCount; s++) {
    const a = (s / stamenCount) * Math.PI * 2 + rng() * 0.28;
    const d = radius * (0.13 + rng() * 0.16);
    const sx = Math.cos(a) * d;
    const sy = Math.sin(a) * d;
    ctx.strokeStyle = 'rgba(242, 148, 174, 0.78)';
    ctx.lineWidth = Math.max(0.9, radius * 0.025);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    ctx.fillStyle = s % 2 === 0 ? 'rgba(255, 222, 118, 0.98)' : 'rgba(246, 172, 114, 0.94)';
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1.1, radius * 0.044), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draws a young bronze-green serrated Prunus cherry leaf or unopened crimson-pink blossom bud
 * so the sprig looks genuinely botanical rather than synthetic pink circles.
 */
function drawSakuraSpringLeafOrBud(ctx, x, y, len, angle, isBud, rng) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  if (isBud) {
    // Crimson calyx tube + plump rose-pink unopened bud
    ctx.fillStyle = 'rgba(116, 36, 52, 0.92)';
    ctx.beginPath();
    ctx.ellipse(0, -len * 0.15, len * 0.18, len * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    const budGrad = ctx.createLinearGradient(0, -len * 0.2, 0, len * 0.65);
    budGrad.addColorStop(0, 'rgba(218, 72, 116, 0.96)');
    budGrad.addColorStop(0.6, 'rgba(248, 152, 184, 0.98)');
    budGrad.addColorStop(1, 'rgba(255, 222, 236, 0.96)');
    ctx.fillStyle = budGrad;
    ctx.beginPath();
    ctx.ellipse(0, len * 0.25, len * 0.26, len * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Young reddish-bronze / fresh spring-green serrated cherry leaf (Prunus serrulata)
    const w = len * 0.36;
    const leafGrad = ctx.createLinearGradient(0, 0, 0, len);
    const bronzeTint = rng() > 0.45;
    if (bronzeTint) {
      leafGrad.addColorStop(0, 'rgba(92, 68, 42, 0.92)');
      leafGrad.addColorStop(0.6, 'rgba(118, 76, 54, 0.90)');
      leafGrad.addColorStop(1, 'rgba(138, 66, 58, 0.88)');
    } else {
      leafGrad.addColorStop(0, 'rgba(68, 96, 46, 0.92)');
      leafGrad.addColorStop(0.65, 'rgba(96, 118, 56, 0.90)');
      leafGrad.addColorStop(1, 'rgba(128, 92, 58, 0.88)');
    }
    ctx.fillStyle = leafGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const tooth = i < steps ? (i % 2 === 0 ? 1.08 : 0.92) : 1.0;
      const hw = Math.sin(t * Math.PI) * w * (1 - t * 0.22) * tooth;
      ctx.lineTo(hw, t * len);
    }
    for (let i = steps - 1; i >= 0; i--) {
      const t = i / steps;
      const tooth = i > 0 ? (i % 2 === 0 ? 1.08 : 0.92) : 1.0;
      const hw = Math.sin(t * Math.PI) * w * (1 - t * 0.22) * tooth;
      ctx.lineTo(-hw, t * len);
    }
    ctx.closePath();
    ctx.fill();

    // Leaf midrib
    ctx.strokeStyle = 'rgba(168, 128, 92, 0.65)';
    ctx.lineWidth = Math.max(1.0, len * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, len * 0.92);
    ctx.stroke();
  }
  ctx.restore();
}

export function makeSakuraClusterTexture(size = 512) {
  // Render a lush 1024x1024 botanical Dryad blossom sprig with 16 distinct organic
  // corymbose umbels (arranged along natural branching shoots, never a boxy 4x4 grid!).
  const outSize = Math.max(768, size * 2);
  const dense = document.createElement('canvas');
  dense.width = outSize;
  dense.height = outSize;
  const ctx = dense.getContext('2d');
  ctx.clearRect(0, 0, outSize, outSize);

  const rng = mulberry32(7719);
  const cx = outSize * 0.5;
  const cy = outSize * 0.52;

  // 16 organic phyllotactic umbel nodes branching from a central woody sakura bough
  const umbelNodes = [];
  const clusterMultiplier = 16;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < clusterMultiplier; i++) {
    const normIdx = i / (clusterMultiplier - 1);
    const radiusFrac = i === 0 ? 0.04 : 0.13 + Math.pow(normIdx, 0.68) * 0.27;
    const angle = i * goldenAngle + (rng() - 0.5) * 0.28;
    const ux = cx + Math.cos(angle) * outSize * radiusFrac;
    const uy = cy + Math.sin(angle) * outSize * radiusFrac * 0.94 - outSize * 0.02;
    umbelNodes.push({
      x: ux,
      y: uy,
      angle,
      scale: 0.82 + (1 - Math.abs(normIdx - 0.45)) * 0.32 + (rng() - 0.5) * 0.14,
      depth: normIdx,
    });
  }

  // 1. Draw dark reddish-brown cherry twigs & pedicels connecting the 16 umbel nodes
  ctx.lineCap = 'round';
  for (let i = 0; i < umbelNodes.length; i++) {
    const u = umbelNodes[i];
    const startX = i === 0 ? cx : cx + (u.x - cx) * 0.22;
    const startY = i === 0 ? cy + outSize * 0.28 : cy + (u.y - cy) * 0.22;
    const ctrlX = (startX + u.x) * 0.5 + (rng() - 0.5) * outSize * 0.05;
    const ctrlY = (startY + u.y) * 0.5 + (rng() - 0.5) * outSize * 0.05;

    ctx.strokeStyle = 'rgba(58, 30, 32, 0.82)';
    ctx.lineWidth = Math.max(2.5, outSize * (0.008 - u.depth * 0.003));
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, u.x, u.y);
    ctx.stroke();
  }

  // 2. Young spring cherry leaves & unopened pink buds tucked along the twigs
  for (let i = 0; i < umbelNodes.length; i++) {
    const u = umbelNodes[i];
    if (i % 2 === 0) {
      drawSakuraSpringLeafOrBud(
        ctx,
        u.x + (rng() - 0.5) * outSize * 0.04,
        u.y + (rng() - 0.5) * outSize * 0.04,
        outSize * (0.065 + rng() * 0.025),
        u.angle + (rng() - 0.5) * 0.9,
        false,
        rng,
      );
    }
    // Distal unopened sakura buds
    if (u.depth > 0.35) {
      const budAngle = u.angle + (rng() - 0.5) * 0.8;
      const budDist = outSize * (0.045 + rng() * 0.035);
      drawSakuraSpringLeafOrBud(
        ctx,
        u.x + Math.cos(budAngle) * budDist,
        u.y + Math.sin(budAngle) * budDist,
        outSize * (0.036 + rng() * 0.012),
        budAngle - Math.PI * 0.5,
        true,
        rng,
      );
    }
  }

  // 3. Pass 1: Deep shaded inner-canopy blossoms across all 16 umbels (volumetric depth)
  const baseFlowerR = outSize * 0.042;
  for (let i = 0; i < umbelNodes.length; i++) {
    const u = umbelNodes[i];
    const bgCount = 2;
    for (let b = 0; b < bgCount; b++) {
      const a = (b / bgCount) * Math.PI * 2 + rng() * 1.8;
      const d = outSize * (0.022 + rng() * 0.032) * u.scale;
      const fx = u.x + Math.cos(a) * d;
      const fy = u.y + Math.sin(a) * d;
      const fr = baseFlowerR * u.scale * (0.86 + rng() * 0.22);
      const tilt = 0.58 + rng() * 0.38;
      drawSingleSakuraFlower(ctx, fx, fy, fr, rng() * Math.PI * 2, rng, -1.35, tilt, rng() * Math.PI);
    }
  }

  // 4. Pass 2: Sunlit hero 5-petal sakura blossoms in each of the 16 corymbose umbels
  for (let i = 0; i < umbelNodes.length; i++) {
    const u = umbelNodes[i];
    const fgCount = 3;
    for (let f = 0; f < fgCount; f++) {
      const a = (f / fgCount) * Math.PI * 2 + u.angle + (rng() - 0.5) * 0.55;
      const d = f === 0 ? outSize * 0.008 * rng() : outSize * (0.024 + rng() * 0.026) * u.scale;
      const fx = u.x + Math.cos(a) * d;
      const fy = u.y + Math.sin(a) * d;
      const fr = baseFlowerR * u.scale * (f === 0 ? 1.12 : 0.92 + rng() * 0.20);
      const tilt = f === 0 ? 0.88 + rng() * 0.12 : 0.65 + rng() * 0.35;
      const tint = (rng() - 0.35) * 1.4;
      drawSingleSakuraFlower(ctx, fx, fy, fr, rng() * Math.PI * 2, rng, tint, tilt, rng() * Math.PI);
    }
  }

  const normalMap = buildTangentNormalMapTexture(dense, 2.8, false);
  const tex = new THREE.CanvasTexture(dense);
  tex.name = 'Sakura blossoms - quarter scale, sixteen clusters per card';
  tex.userData = { flowerScale: 0.25, clusterMultiplier: 16, normalMap };
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeSakuraBarkTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(4099);

  // Deep warm purplish-mahogany Prunus serrulata bark base
  ctx.fillStyle = '#241615';
  ctx.fillRect(0, 0, size, size);

  // Fine vertical bark grain & weathered lichen/moss micro-streaks
  for (let x = 0; x < size; x += 2) {
    const wave = Math.sin(x * 0.14) * 7 + Math.cos(x * 0.37) * 5 + (rng() - 0.5) * 9;
    const v = Math.max(16, Math.min(72, Math.floor(30 + wave)));
    ctx.fillStyle = `rgb(${v + 13}, ${v + 1}, ${v})`;
    ctx.fillRect(x, 0, 2, size);
  }

  // Subtle vertical growth fissures
  for (let i = 0; i < 90; i++) {
    const fx = rng() * size;
    const fy = rng() * size;
    const fh = 24 + rng() * 68;
    ctx.fillStyle = 'rgba(12, 7, 7, 0.48)';
    ctx.fillRect(fx, fy, 1.5 + rng() * 2.0, fh);
  }

  // Characteristic horizontal cherry bark lenticels (warm copper-silver bands with dark lips)
  for (let i = 0; i < 180; i++) {
    const lx = rng() * size;
    const ly = rng() * size;
    const lw = 18 + rng() * 56;
    const lh = 1.6 + rng() * 3.0;
    ctx.fillStyle = 'rgba(16, 9, 8, 0.65)';
    ctx.fillRect(lx - 1, ly - 1, lw + 2, lh + 2);
    ctx.fillStyle = rng() > 0.35 ? 'rgba(108, 72, 60, 0.68)' : 'rgba(148, 108, 88, 0.54)';
    ctx.fillRect(lx, ly, lw, lh);
  }

  const normalMap = buildTangentNormalMapTexture(canvas, 2.4, true);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData = { normalMap };
  tex.needsUpdate = true;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DRYAD-POWERED SAKURA TREE GENERATOR (owenyuwono/dryad botanical pipeline)
// ─────────────────────────────────────────────────────────────────────────────

const SAKURA_GENOME = {
  ...TREE_DEFAULT,
  branchiness: 0.88,      // Deep 6-order branching with fine terminal twigs
  branchFactorN: 0.68,    // Rich spreading bough forks
  tillering: 0.00,
  radialOrder: 0.64,
  appendageBreadth: 0.58,
  appendageDensity: 1.24, // Lush full spring bloom
  segmentation: 0.45,     // Smooth curved boughs & gnarled trunk
  succulence: 0.14,
  stemGirth: 0.76,        // Sturdy ancient cherry trunk
  taper: 0.72,            // Natural pipe-model taper to delicate twigs
  rigidity: 0.42,
  verticality: 0.54,
  ribbing: 0.14,          // Subtle organic root/trunk fluting
  spininess: 0.00,
  branchAngle: 0.74,      // Wide umbrella-dome cherry canopy spread
  lengthRatio: 0.73,
  apicalBias: 0.44,       // Low fork into sweeping primary boughs
  droopBias: 0.04,
  pigment: 0.92,
  leafSize: 1.05,
  jitter: 1.00,
  crownStart: 0.38,       // Boughs begin low on the trunk (classic Somei-Yoshino silhouette)
  weep: 0.18,             // Graceful gentle cascade at outer blossom tips
  trunkHeight: 0.52,
  rootCount: 0.68,        // Prominent gnarled surface roots
  rootDepth: 0.45,
  rootSpread: 0.74,
  rootFlare: 0.52,
  rootButtress: 0.28,
  rootBranchiness: 0.55,
  rootTaper: 0.52,
  structuralSeed: 0x3B9F1D77 >>> 0,
};

/**
 * Emits a curved 3D cupped sprig shell (subdivided 2x2 curved dish rather than a flat quad)
 * so blossom clusters have true 3D volume, quadratic gravity droop, and never look like flat planes.
 */
function appendCurvedSprigShell(
  positions,
  normals,
  uvs,
  colors,
  indices,
  anchorPos,
  rightVec,
  upVec,
  faceNorm,
  canopyNorm,
  width,
  length,
  cupDepth,
  droopAmount,
  cr,
  cg,
  cb,
) {
  const cols = 2;
  const rows = 2;
  const baseVertex = positions.length / 3;

  for (let r = 0; r <= rows; r++) {
    const v = r / rows; // 0 at twig attachment -> 1 at distal sprig tip
    const centeredV = v - 0.32;
    const gravityDroop = v * v * droopAmount;

    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const centeredU = (u - 0.5) * 2.0; // -1 .. +1

      // Parabolic 3D cupping across width + arch along length
      const cupOffset = (1.0 - centeredU * centeredU * 0.85) * Math.sin(v * Math.PI) * cupDepth;

      const px =
        anchorPos.x +
        rightVec.x * (centeredU * width * 0.5) +
        upVec.x * (centeredV * length) +
        faceNorm.x * cupOffset;
      const py =
        anchorPos.y +
        rightVec.y * (centeredU * width * 0.5) +
        upVec.y * (centeredV * length) +
        faceNorm.y * cupOffset -
        gravityDroop;
      const pz =
        anchorPos.z +
        rightVec.z * (centeredU * width * 0.5) +
        upVec.z * (centeredV * length) +
        faceNorm.z * cupOffset;

      positions.push(px, py, pz);

      // Blend local cupped normal with hemispherical canopy normal (Dryad leafMesh technique)
      const nx = canopyNorm.x * 0.72 + faceNorm.x * 0.28 + rightVec.x * (centeredU * 0.18);
      const ny = canopyNorm.y * 0.72 + faceNorm.y * 0.28 + 0.15;
      const nz = canopyNorm.z * 0.72 + faceNorm.z * 0.28 + rightVec.z * (centeredU * 0.18);
      const nLen = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / nLen, ny / nLen, nz / nLen);

      uvs.push(u, v);

      // Subtle gradient brightening from twig base to sunlit sprig tip
      const tipLift = 0.94 + v * 0.08;
      colors.push(
        Math.min(1, cr * tipLift),
        Math.min(1, cg * tipLift),
        Math.min(1, cb * tipLift),
      );
    }
  }

  const stride = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = baseVertex + r * stride + c;
      const b = a + 1;
      const d = a + stride;
      const e = d + 1;
      indices.push(a, b, e, a, e, d);
    }
  }
}

/**
 * Emits a true 3D 5-petal cupped sakura floret (15 triangles) at outer sunlit tips
 * so close-up views reveal genuine 3D sculpted flowers alongside the cupped sprigs.
 */
function append3DCuppedSakuraFloret(
  positions,
  normals,
  uvs,
  colors,
  indices,
  center,
  outAxis,
  floretRadius,
  rng,
) {
  const upRef = Math.abs(outAxis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const basisU = new THREE.Vector3().crossVectors(outAxis, upRef).normalize();
  const basisV = new THREE.Vector3().crossVectors(outAxis, basisU).normalize();
  const rot0 = rng() * Math.PI * 2;

  const centerIdx = positions.length / 3;
  // Recessed crimson calyx heart vertex
  positions.push(center.x, center.y, center.z);
  normals.push(outAxis.x, outAxis.y, outAxis.z);
  uvs.push(0.5, 0.5);
  colors.push(0.88, 0.56, 0.68);

  const numPetals = 5;
  for (let p = 0; p < numPetals; p++) {
    const a = rot0 + (p * Math.PI * 2) / numPetals;
    const aL = a - 0.34;
    const aR = a + 0.34;
    const lift = floretRadius * 0.32;

    const dirL = new THREE.Vector3()
      .addScaledVector(basisU, Math.cos(aL))
      .addScaledVector(basisV, Math.sin(aL));
    const dirR = new THREE.Vector3()
      .addScaledVector(basisU, Math.cos(aR))
      .addScaledVector(basisV, Math.sin(aR));
    const dirMid = new THREE.Vector3()
      .addScaledVector(basisU, Math.cos(a))
      .addScaledVector(basisV, Math.sin(a));

    const vL = center.clone().addScaledVector(dirL, floretRadius * 0.92).addScaledVector(outAxis, lift);
    const vR = center.clone().addScaledVector(dirR, floretRadius * 0.92).addScaledVector(outAxis, lift);
    const vNotch = center.clone().addScaledVector(dirMid, floretRadius * 0.76).addScaledVector(outAxis, lift * 0.85);

    const pBase = positions.length / 3;
    positions.push(vL.x, vL.y, vL.z, vNotch.x, vNotch.y, vNotch.z, vR.x, vR.y, vR.z);
    for (let k = 0; k < 3; k++) {
      normals.push(outAxis.x, outAxis.y, outAxis.z);
      colors.push(1.0, 0.93, 0.96);
    }
    uvs.push(0.45, 0.55, 0.5, 0.58, 0.55, 0.55);
    indices.push(centerIdx, pBase, pBase + 1, centerIdx, pBase + 1, pBase + 2);
  }
}

export function buildSakuraTreeGeometry(seed = 108, targetHeight = 9.4) {
  const structuralSeed = ((seed * 2654435761) ^ SAKURA_GENOME.structuralSeed) >>> 0;
  const genome = {
    ...SAKURA_GENOME,
    structuralSeed,
  };
  const env = { gravity: 1.0, medium: 'air', wind: 0.22, aridity: 0.18, light: 0.72, sunAngle: 0.22 };

  // 1. Run the full Dryad botanical pipeline: Skeleton -> Roots -> Proportions -> Branch Mesh -> Foliage
  const skelRng = mulberry32(structuralSeed);
  const skeleton = buildSkeleton(genome, skelRng);
  const rootRng = mulberry32((structuralSeed ^ ROOT_SALT) >>> 0);
  growRootSystem(skeleton, genome, rootRng, { env });
  solveProportions(skeleton, env, genome);

  const rawBranch = buildBranchGeometry(skeleton, {
    includeRoot: true,
    ribbing: genome.ribbing,
    ribCount: 7,
  });
  const rawFoliage = generateFoliage(skeleton, genome, { nodeToBone: rawBranch.nodeToBone });

  // Measure vertical extent above ground so tree normalizes cleanly to targetHeight
  let maxY = 1.0;
  let minY = 0.0;
  for (let i = 1; i < rawBranch.positions.length; i += 3) {
    const y = rawBranch.positions[i];
    if (y > maxY) maxY = y;
    if (y < minY) minY = y;
  }
  const fCount = rawFoliage.count || 0;
  for (let i = 0; i < fCount; i++) {
    const py = rawFoliage.position[i * 3 + 1] + (rawFoliage.scale[i] || 0.8) * 0.5;
    if (py > maxY) maxY = py;
  }
  const scale = targetHeight / maxY;

  // 2. Build Bark Geometry with Dryad per-vertex crotch AO & clamped underground taproot depth
  const vCount = rawBranch.positions.length / 3;
  const barkPos = new Float32Array(rawBranch.positions.length);
  const barkCol = new Float32Array(rawBranch.positions.length);
  const barkUv = new Float32Array(rawBranch.uvs.length);

  for (let i = 0; i < vCount; i++) {
    const i3 = i * 3;
    const px = rawBranch.positions[i3] * scale;
    // Clamp deep taproot vertices at -0.55m so surface buttress roots flare naturally into soil
    const rawY = rawBranch.positions[i3 + 1] * scale;
    const py = rawY < -0.55 ? -0.55 + (rawY + 0.55) * 0.15 : rawY;
    const pz = rawBranch.positions[i3 + 2] * scale;

    barkPos[i3] = px;
    barkPos[i3 + 1] = py;
    barkPos[i3 + 2] = pz;

    // Bake Dryad's per-vertex AO (darker in fork crotches & root collar, warmer on upper limbs)
    const aoVal = rawBranch.ao ? rawBranch.ao[i] : 0.85;
    const heightWarmth = Math.min(1, Math.max(0, py / (targetHeight * 0.75)));
    const shade = 0.52 + aoVal * 0.48;
    barkCol[i3] = shade * (0.96 + heightWarmth * 0.08);
    barkCol[i3 + 1] = shade * (0.90 + heightWarmth * 0.06);
    barkCol[i3 + 2] = shade * (0.92 + heightWarmth * 0.05);

    barkUv[i * 2] = rawBranch.uvs[i * 2] * 2.0;
    barkUv[i * 2 + 1] = rawBranch.uvs[i * 2 + 1] * scale * 0.55;
  }

  const barkGeo = new THREE.BufferGeometry();
  barkGeo.setAttribute('position', new THREE.BufferAttribute(barkPos, 3));
  barkGeo.setAttribute('normal', new THREE.BufferAttribute(rawBranch.normals, 3));
  barkGeo.setAttribute('uv', new THREE.BufferAttribute(barkUv, 2));
  barkGeo.setAttribute('color', new THREE.BufferAttribute(barkCol, 3));
  barkGeo.setIndex(new THREE.BufferAttribute(rawBranch.indices, 1));

  // 3. Build Volumetric Curved 3D Blossom Sprig Clusters + 3D Hero Florets from Dryad's generateFoliage SoA
  const blossomPositions = [];
  const blossomNormals = [];
  const blossomUVs = [];
  const blossomColors = [];
  const blossomIndices = [];

  const rng = mulberry32((structuralSeed ^ 0x5A1C09A) >>> 0);
  const crownCenter = new THREE.Vector3(0, targetHeight * 0.56, 0);

  // Select ~165 well-distributed Dryad foliage anchors across the entire dome crown
  const maxAnchors = 165;
  const step = Math.max(1, Math.floor(fCount / maxAnchors));

  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const X = new THREE.Vector3();
  const canopyNorm = new THREE.Vector3();
  const shellRight = new THREE.Vector3();
  const shellUp = new THREE.Vector3();
  const shellFace = new THREE.Vector3();

  let anchorIdx = 0;
  for (let c = 0; c < fCount && anchorIdx < maxAnchors; c += step, anchorIdx++) {
    const c3 = c * 3;
    P.set(
      rawFoliage.position[c3] * scale,
      rawFoliage.position[c3 + 1] * scale,
      rawFoliage.position[c3 + 2] * scale,
    );
    // Keep canopy above low head-clearance while preserving weeping tips
    if (P.y < 1.65) P.y = 1.65 + (P.y * 0.25);

    T.set(rawFoliage.tangent[c3], rawFoliage.tangent[c3 + 1], rawFoliage.tangent[c3 + 2]);
    if (T.lengthSq() < 1e-6) T.set(0, 1, 0);
    else T.normalize();

    N.set(rawFoliage.normal[c3], rawFoliage.normal[c3 + 1], rawFoliage.normal[c3 + 2]);
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0);
    else N.normalize();

    X.crossVectors(T, N);
    if (X.lengthSq() < 1e-6) X.set(0, 0, 1);
    else X.normalize();
    N.crossVectors(X, T).normalize();

    canopyNorm.subVectors(P, crownCenter);
    if (canopyNorm.lengthSq() < 0.01) canopyNorm.set(0, 1, 0);
    else canopyNorm.normalize();

    // Dryad exposure (0 = shaded inner canopy, 1 = sunlit outer dome) + ageColor
    const exp = rawFoliage.exposure ? rawFoliage.exposure[c] : 0.75;
    const age = rawFoliage.ageColor ? rawFoliage.ageColor[c] : 0.6;
    const tint = (rng() - 0.5) * 0.08;

    // Inner clusters have deeper warm rose-blush AO; outer sunlit crown gleams snow-pink
    const cr = THREE.MathUtils.clamp(0.84 + exp * 0.16 + tint * 0.4, 0.78, 1.0);
    const cg = THREE.MathUtils.clamp(0.68 + exp * 0.26 + age * 0.04 - Math.abs(tint) * 0.3, 0.62, 0.98);
    const cb = THREE.MathUtils.clamp(0.76 + exp * 0.22 + tint * 0.3, 0.70, 1.0);

    const sprigSize = THREE.MathUtils.clamp((rawFoliage.scale[c] || 0.85) * scale * 0.54, 0.85, 1.52);
    const baseRoll = rawFoliage.rotation[c] || 0;

    // Emit 2 curved 3D cupped shells per anchor (8 tris each = 16 tris per anchor)
    for (let s = 0; s < 2; s++) {
      const roll = baseRoll + s * (Math.PI * 0.52) + (rng() - 0.5) * 0.25;
      const ca = Math.cos(roll);
      const sa = Math.sin(roll);

      shellRight.set(
        X.x * ca + N.x * sa,
        X.y * ca + N.y * sa,
        X.z * ca + N.z * sa,
      ).normalize();

      shellFace.set(
        -X.x * sa + N.x * ca,
        -X.y * sa + N.y * ca,
        -X.z * sa + N.z * ca,
      ).normalize();

      // Ensure face normal points generally outward/upward
      if (shellFace.dot(canopyNorm) < 0) shellFace.negate();

      shellUp.copy(T).addScaledVector(canopyNorm, 0.28).normalize();

      appendCurvedSprigShell(
        blossomPositions,
        blossomNormals,
        blossomUVs,
        blossomColors,
        blossomIndices,
        P,
        shellRight,
        shellUp,
        shellFace,
        canopyNorm,
        sprigSize,
        sprigSize * 0.96,
        sprigSize * 0.18, // 3D parabolic cup depth
        sprigSize * 0.14, // Quadratic gravity droop
        cr,
        cg,
        cb,
      );
    }

    // Add a sculpted 3D 5-petal cupped floret accent on outer sunlit tips
    if (exp > 0.62 && anchorIdx % 2 === 0) {
      const floretCenter = P.clone().addScaledVector(canopyNorm, sprigSize * 0.32);
      append3DCuppedSakuraFloret(
        blossomPositions,
        blossomNormals,
        blossomUVs,
        blossomColors,
        blossomIndices,
        floretCenter,
        canopyNorm,
        0.13 + rng() * 0.05,
        rng,
      );
    }
  }

  const blossomGeo = new THREE.BufferGeometry();
  blossomGeo.setAttribute('position', new THREE.Float32BufferAttribute(blossomPositions, 3));
  blossomGeo.setAttribute('normal', new THREE.Float32BufferAttribute(blossomNormals, 3));
  blossomGeo.setAttribute('uv', new THREE.Float32BufferAttribute(blossomUVs, 2));
  blossomGeo.setAttribute('color', new THREE.Float32BufferAttribute(blossomColors, 3));
  blossomGeo.setIndex(blossomIndices);

  return { barkGeo, blossomGeo };
}

export function createSakuraMaterials(uTime) {
  const barkTex = makeSakuraBarkTexture(512);
  const blossomTex = makeSakuraClusterTexture(512);

  const barkMat = new MeshStandardNodeMaterial({
    name: 'Sakura Bark',
    map: barkTex,
    normalMap: barkTex.userData?.normalMap || null,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughness: 0.84,
    metalness: 0.03,
    vertexColors: true,
  });

  if (typeof document !== 'undefined') {
    const loader = new THREE.TextureLoader();
    loader.load('/textures/polyhaven/bark_willow_nor_gl_1k.jpg', (norTex) => {
      norTex.wrapS = THREE.RepeatWrapping;
      norTex.wrapT = THREE.RepeatWrapping;
      norTex.anisotropy = 8;
      barkMat.normalMap = norTex;
      barkMat.normalScale.set(1.45, 1.45);
      barkMat.needsUpdate = true;
    });
    loader.load('/textures/polyhaven/bark_willow_rough_1k.jpg', (roughTex) => {
      roughTex.wrapS = THREE.RepeatWrapping;
      roughTex.wrapT = THREE.RepeatWrapping;
      roughTex.anisotropy = 8;
      barkMat.roughnessMap = roughTex;
      barkMat.needsUpdate = true;
    });
  }

  const blossomMat = new MeshStandardNodeMaterial({
    name: 'Sakura Canopy Blossoms',
    map: blossomTex,
    normalMap: blossomTex.userData?.normalMap || null,
    normalScale: new THREE.Vector2(1.35, 1.35),
    alphaTest: 0.32,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.56,
    metalness: 0.0,
    vertexColors: true,
  });

  if (uTime) {
    // Hierarchical spring breeze sway + individual petal flutter for sakura boughs
    blossomMat.positionNode = Fn(() => {
      const pos = positionLocal.toVar();
      const wPos = positionWorld;
      const heightMask = smoothstep(float(1.8), float(8.8), pos.y);
      const radialMask = smoothstep(float(0.5), float(4.8), pos.x.mul(pos.x).add(pos.z.mul(pos.z)));
      const phase = uTime.mul(1.55).add(wPos.x.mul(0.21)).add(wPos.z.mul(0.18));
      const flutter = sin(uTime.mul(4.6).add(pos.x.mul(3.1)).add(pos.y.mul(2.4)).add(pos.z.mul(2.7))).mul(0.038).mul(radialMask);
      pos.x.addAssign(sin(phase).mul(0.15).add(flutter).mul(heightMask));
      pos.z.addAssign(cos(phase.mul(0.88)).mul(0.12).add(flutter).mul(heightMask));
      pos.y.addAssign(sin(phase.mul(1.35)).mul(0.042).mul(heightMask));
      return pos;
    })();

    // Soft translucent subsurface sakura petal rim-backlight glow (GPU Gems wrap-scatter)
    blossomMat.emissiveNode = Fn(() => {
      const nY = clamp(normalWorld.y.mul(0.5).add(0.5), float(0.0), float(1.0));
      const heightGlow = smoothstep(float(2.2), float(8.5), positionLocal.y);
      return vec3(0.20, 0.085, 0.125).mul(nY).mul(float(0.65).add(heightGlow.mul(0.45)));
    })();
  }

  return { barkMat, blossomMat };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. FALLING SAKURA PETAL PARTICLES (Aerodynamic drift & spiral flutter)
// ─────────────────────────────────────────────────────────────────────────────

export function createFallingSakuraPetals(scene, uTime, count = 480) {
  // Build a cupped 3D V-notched sakura petal mesh geometry
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0, -0.058);
  petalShape.quadraticCurveTo(0.050, -0.02, 0.046, 0.040);
  petalShape.lineTo(0.015, 0.058);
  petalShape.lineTo(0, 0.038); // Apical V-notch
  petalShape.lineTo(-0.015, 0.058);
  petalShape.lineTo(-0.046, 0.040);
  petalShape.quadraticCurveTo(-0.050, -0.02, 0, -0.058);

  const geo = new THREE.ShapeGeometry(petalShape, 4);
  const seeds = new Float32Array(count * 4);
  const rng = mulberry32(9913);

  const dummy = new THREE.Object3D();
  const mat = new MeshStandardNodeMaterial({
    color: new THREE.Color(0xffdfe9),
    roughness: 0.42,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  if (uTime) {
    const aSeed = attribute('aPetalSeed', 'vec4');
    mat.positionNode = Fn(() => {
      const pos = positionLocal.toVar();
      const t = uTime.mul(float(0.58).add(aSeed.w.mul(0.38))).add(aSeed.x.mul(25.0));
      const fallCycle = t.mod(float(14.0));
      const dropY = float(11.8).sub(fallCycle.mul(0.86));
      const spiralX = sin(t.mul(1.95).add(aSeed.y.mul(6.28))).mul(1.45).add(sin(t.mul(0.48)).mul(2.25));
      const spiralZ = cos(t.mul(1.55).add(aSeed.z.mul(6.28))).mul(1.45).add(cos(t.mul(0.40)).mul(1.95));

      // 3D tumble & bank flutter on the local petal vertex
      const tumble = sin(t.mul(4.1).add(aSeed.y.mul(10.0)));
      pos.y.addAssign(pos.x.mul(tumble).mul(0.48));
      pos.x.addAssign(spiralX);
      pos.y.addAssign(dropY);
      pos.z.addAssign(spiralZ);
      return pos;
    })();

    mat.emissiveNode = vec3(0.26, 0.12, 0.16);
  }

  const inst = new THREE.InstancedMesh(geo, mat, count);
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (8 + rng() * 52);
    const z = (rng() - 0.5) * 240;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    const s = 0.85 + rng() * 0.70;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);

    seeds[i * 4 + 0] = rng();
    seeds[i * 4 + 1] = rng();
    seeds[i * 4 + 2] = rng();
    seeds[i * 4 + 3] = rng();
  }
  geo.setAttribute('aPetalSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  scene.add(inst);
  return inst;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DRYAD PROCEDURAL FOREST TREES (owenyuwono/dryad full pipeline + roots)
// ─────────────────────────────────────────────────────────────────────────────

function makeDryadLeafClusterTexture(species = 'oak', size = 512) {
  if (species !== 'pine') {
    // Use Dryad's authentic superformula + pinnate venation + Sobel normal map generator!
    const presetId =
      species === 'maple'
        ? 'maple'
        : species === 'fern'
        ? 'fern'
        : species === 'lilac'
        ? 'lilac'
        : species === 'bush'
        ? 'bush'
        : 'oak';
    const presetEntry = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
    const g = presetEntry.genome || TREE_DEFAULT;
    const seedMap = { maple: 8821, fern: 4419, lilac: 6637, bush: 3911, oak: 5113 };
    const dryadCluster = makeLeafClusterTexture({
      pigment: species === 'maple' ? 0.04 : g.pigment,
      breadth: g.appendageBreadth,
      seed: seedMap[presetId] || 5113,
      resolution: 'medium',
      leafWidth: g.leafWidth,
      leafLength: g.leafLength,
      leafTip: g.leafTip,
      leafSerration: g.leafSerration,
      leafLobing: g.leafLobing,
      leafSkew: g.leafSkew,
      leafDivision: g.leafDivision || 0,
      frondFan: g.frondFan || 0,
      leafMode: 'cluster',
    });
    if (dryadCluster?.source) {
      const tex = new THREE.CanvasTexture(dryadCluster.source);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      if (dryadCluster.normal) {
        const normTex = new THREE.CanvasTexture(dryadCluster.normal);
        normTex.needsUpdate = true;
        tex.userData = { normalMap: normTex };
      }
      tex.needsUpdate = true;
      return tex;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const rng = mulberry32(species === 'pine' ? 3119 : 5113);
  const half = size * 0.5;

  if (species === 'pine') {
    // Highland conifer needle fascicle sprays with woody shoot cores
    for (let b = 0; b < 22; b++) {
      const a = (b / 22) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      const len = size * (0.26 + rng() * 0.20);
      const ex = half + Math.cos(a) * len;
      const ey = half + Math.sin(a) * len;

      ctx.strokeStyle = 'rgba(58, 40, 26, 0.82)';
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(half, half);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      const needles = 32;
      for (let n = 0; n < needles; n++) {
        const t = n / needles;
        const bx = half + (ex - half) * t;
        const by = half + (ey - half) * t;
        const side = n % 2 === 0 ? 1 : -1;
        const na = a + side * (0.52 + rng() * 0.36);
        const nLen = size * (0.065 + (1 - t * 0.4) * 0.055);
        const g = Math.floor(66 + t * 38 + (rng() - 0.5) * 16);
        const r = Math.floor(g * 0.50);
        const bl = Math.floor(g * 0.44);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, 0.94)`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(na) * nLen, by + Math.sin(na) * nLen);
        ctx.stroke();
      }
    }
  }

  const normalMap = buildTangentNormalMapTexture(canvas, 2.4, false);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData = { normalMap };
  tex.needsUpdate = true;
  return tex;
}

function makeDryadBarkTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(8123);

  ctx.fillStyle = '#30231a';
  ctx.fillRect(0, 0, size, size);

  for (let x = 0; x < size; x += 2) {
    const ridge = Math.sin(x * 0.22) * 12 + Math.cos(x * 0.51) * 6 + (rng() - 0.5) * 14;
    const r = Math.max(18, Math.min(95, Math.floor(52 + ridge)));
    const g = Math.max(14, Math.min(78, Math.floor(39 + ridge * 0.8)));
    const b = Math.max(10, Math.min(62, Math.floor(29 + ridge * 0.6)));
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(x, 0, 2, size);
  }

  // Deep bark plates & fissures
  for (let i = 0; i < 110; i++) {
    const fx = rng() * size;
    const fy = rng() * size;
    const fh = 22 + rng() * 64;
    ctx.fillStyle = 'rgba(14, 9, 7, 0.58)';
    ctx.fillRect(fx, fy, 1.8 + rng() * 2.2, fh);
  }

  const normalMap = buildTangentNormalMapTexture(canvas, 2.6, true);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData = { normalMap };
  tex.needsUpdate = true;
  return tex;
}

export function buildDryadTreeGeometry(species = 'oak', seed = 42, targetHeight = 11.5) {
  const presetId = species === 'pine' ? 'spruce' : species;
  const presetEntry =
    PRESETS.find((p) => p.id === presetId) ||
    PRESETS.find((p) => p.id === 'oak') ||
    PRESETS[0];
  const baseGenome = presetEntry.genome || presetEntry;
  const structuralSeed = ((seed * 2654435761) ^ (baseGenome.structuralSeed || 0x4c2f7a11)) >>> 0;
  const genome = {
    ...baseGenome,
    structuralSeed,
  };
  const env = { gravity: 1.0, medium: 'air', wind: 0.25, aridity: 0.2 };

  const rng = mulberry32(structuralSeed);
  const skeleton = buildSkeleton(genome, rng);
  const rootRng = mulberry32((structuralSeed ^ ROOT_SALT) >>> 0);
  growRootSystem(skeleton, genome, rootRng, { env });
  solveProportions(skeleton, env, genome);

  const rawBranch = buildBranchGeometry(skeleton, {
    includeRoot: targetHeight >= 3.0,
    ribbing: species === 'oak' ? 0.12 : 0.06,
    ribCount: 8,
  });
  const rawFoliage = generateFoliage(skeleton, genome, { nodeToBone: rawBranch.nodeToBone });

  // Measure actual vertical extent so we normalize cleanly to targetHeight
  let maxY = 0.25;
  for (let i = 1; i < rawBranch.positions.length; i += 3) {
    if (rawBranch.positions[i] > maxY) maxY = rawBranch.positions[i];
  }
  const fCount = rawFoliage.count || 0;
  for (let i = 0; i < fCount; i++) {
    const py = rawFoliage.position[i * 3 + 1] + (rawFoliage.scale[i] || 0.8) * 0.5;
    if (py > maxY) maxY = py;
  }
  const scale = targetHeight / maxY;
  const isLowShrub = targetHeight < 3.2;

  const vCount = rawBranch.positions.length / 3;
  const barkPos = new Float32Array(rawBranch.positions.length);
  const barkCol = new Float32Array(rawBranch.positions.length);
  for (let i = 0; i < vCount; i++) {
    const i3 = i * 3;
    barkPos[i3] = rawBranch.positions[i3] * scale;
    const rawY = rawBranch.positions[i3 + 1] * scale;
    const minRootY = isLowShrub ? -0.06 : -0.55;
    barkPos[i3 + 1] = rawY < minRootY ? minRootY + (rawY - minRootY) * 0.15 : rawY;
    barkPos[i3 + 2] = rawBranch.positions[i3 + 2] * scale;

    const aoVal = rawBranch.ao ? rawBranch.ao[i] : 0.85;
    const shade = 0.50 + aoVal * 0.50;
    barkCol[i3] = shade;
    barkCol[i3 + 1] = shade;
    barkCol[i3 + 2] = shade;
  }

  const barkGeo = new THREE.BufferGeometry();
  barkGeo.setAttribute('position', new THREE.BufferAttribute(barkPos, 3));
  barkGeo.setAttribute('normal', new THREE.BufferAttribute(rawBranch.normals, 3));
  barkGeo.setAttribute('uv', new THREE.BufferAttribute(rawBranch.uvs, 2));
  barkGeo.setAttribute('color', new THREE.BufferAttribute(barkCol, 3));
  barkGeo.setIndex(new THREE.BufferAttribute(rawBranch.indices, 1));

  // Build curved 3D cupped foliage clusters from Dryad's SoA cluster cards
  const maxClusters = isLowShrub ? 96 : 180;
  const step = Math.max(1, Math.floor(fCount / maxClusters));
  const fPos = [];
  const fNorm = [];
  const fUv = [];
  const fCol = [];
  const fIdx = [];

  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const X = new THREE.Vector3();
  const P = new THREE.Vector3();
  const outNormal = new THREE.Vector3();
  const shellRight = new THREE.Vector3();
  const shellFace = new THREE.Vector3();
  const shellUp = new THREE.Vector3();

  for (let c = 0; c < fCount; c += step) {
    const c3 = c * 3;
    P.set(
      rawFoliage.position[c3] * scale,
      rawFoliage.position[c3 + 1] * scale,
      rawFoliage.position[c3 + 2] * scale,
    );
    if (isLowShrub && P.y < 0.08) P.y = 0.08 + Math.max(0, P.y) * 0.5;

    T.set(rawFoliage.tangent[c3], rawFoliage.tangent[c3 + 1], rawFoliage.tangent[c3 + 2]);
    if (T.lengthSq() < 1e-6) T.set(0, 1, 0);
    else T.normalize();

    N.set(rawFoliage.normal[c3], rawFoliage.normal[c3 + 1], rawFoliage.normal[c3 + 2]);
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0);
    else N.normalize();

    X.crossVectors(T, N);
    if (X.lengthSq() < 1e-6) X.set(0, 0, 1);
    else X.normalize();
    N.crossVectors(X, T).normalize();

    const minSpan = isLowShrub ? 0.24 : 0.95;
    const spanMult = species === 'fern' ? 0.95 : species === 'lilac' ? 0.88 : species === 'pine' ? 1.05 : 1.18;
    const cardSpan = Math.max(minSpan, (rawFoliage.scale[c] || 0.85) * scale * spanMult);
    outNormal.copy(P).setY(Math.max(0.25, P.y - targetHeight * 0.45)).normalize();

    const exp = rawFoliage.exposure ? rawFoliage.exposure[c] : 0.75;
    const age = rawFoliage.ageColor ? rawFoliage.ageColor[c] : 0.5;
    const shade = 0.58 + exp * 0.42;
    const cr = shade * (0.94 + age * 0.10);
    const cg = shade * (0.96 + exp * 0.06);
    const cb = shade * 0.90;

    for (let plane = 0; plane < 2; plane++) {
      const ang = (rawFoliage.rotation[c] || 0) + plane * (Math.PI * 0.5);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      shellRight.set(X.x * ca + N.x * sa, X.y * ca + N.y * sa, X.z * ca + N.z * sa).normalize();
      shellFace.set(-X.x * sa + N.x * ca, -X.y * sa + N.y * ca, -X.z * sa + N.z * ca).normalize();
      if (shellFace.dot(outNormal) < 0) shellFace.negate();
      shellUp.copy(T).normalize();

      appendCurvedSprigShell(
        fPos,
        fNorm,
        fUv,
        fCol,
        fIdx,
        P,
        shellRight,
        shellUp,
        shellFace,
        outNormal,
        cardSpan,
        cardSpan,
        cardSpan * 0.14,
        cardSpan * 0.12,
        cr,
        cg,
        cb,
      );
    }
  }

  const foliageGeo = new THREE.BufferGeometry();
  foliageGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  foliageGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fNorm, 3));
  foliageGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
  foliageGeo.setAttribute('color', new THREE.Float32BufferAttribute(fCol, 3));
  foliageGeo.setIndex(fIdx);

  return { barkGeo, foliageGeo };
}

let _sharedDryadBarkMat = null;

function getSharedDryadBarkMaterial() {
  if (_sharedDryadBarkMat) return _sharedDryadBarkMat;
  const barkTex = makeDryadBarkTexture(512);
  const barkMat = new MeshStandardNodeMaterial({
    name: 'Dryad Shared Bark',
    map: barkTex,
    normalMap: barkTex.userData?.normalMap || null,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughness: 0.86,
    metalness: 0.03,
    vertexColors: true,
  });

  if (typeof document !== 'undefined') {
    const loader = new THREE.TextureLoader();
    loader.load('/textures/polyhaven/bark_willow_diff_1k.jpg', (diffTex) => {
      diffTex.wrapS = THREE.RepeatWrapping;
      diffTex.wrapT = THREE.RepeatWrapping;
      diffTex.colorSpace = THREE.SRGBColorSpace;
      diffTex.anisotropy = 8;
      barkMat.map = diffTex;
      barkMat.needsUpdate = true;
    });
    loader.load('/textures/polyhaven/bark_willow_nor_gl_1k.jpg', (norTex) => {
      norTex.wrapS = THREE.RepeatWrapping;
      norTex.wrapT = THREE.RepeatWrapping;
      norTex.anisotropy = 8;
      barkMat.normalMap = norTex;
      barkMat.normalScale.set(1.5, 1.5);
      barkMat.needsUpdate = true;
    });
    loader.load('/textures/polyhaven/bark_willow_rough_1k.jpg', (roughTex) => {
      roughTex.wrapS = THREE.RepeatWrapping;
      roughTex.wrapT = THREE.RepeatWrapping;
      roughTex.anisotropy = 8;
      barkMat.roughnessMap = roughTex;
      barkMat.needsUpdate = true;
    });
  }
  _sharedDryadBarkMat = barkMat;
  return _sharedDryadBarkMat;
}

export function createDryadMaterials(species = 'oak', uTime) {
  const barkMat = getSharedDryadBarkMaterial();
  const leafTex = makeDryadLeafClusterTexture(species, 512);

  const isLowShrub = species === 'fern' || species === 'lilac' || species === 'bush';
  const foliageMat = new MeshStandardNodeMaterial({
    name: `Dryad ${species} Foliage`,
    map: leafTex,
    normalMap: leafTex.userData?.normalMap || null,
    normalScale: new THREE.Vector2(1.25, 1.25),
    alphaTest: 0.32,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: isLowShrub ? 0.58 : 0.68,
    metalness: 0.02,
    vertexColors: true,
  });

  if (uTime) {
    foliageMat.positionNode = Fn(() => {
      const pos = positionLocal.toVar();
      const wPos = positionWorld;
      const heightMask = isLowShrub
        ? smoothstep(float(0.12), float(1.4), pos.y)
        : smoothstep(float(2.2), float(10.0), pos.y);
      const swayAmp = isLowShrub ? 0.045 : 0.14;
      const phase = uTime.mul(1.45).add(wPos.x.mul(0.18)).add(wPos.z.mul(0.16));
      pos.x.addAssign(sin(phase).mul(swayAmp).mul(heightMask));
      pos.z.addAssign(cos(phase.mul(0.9)).mul(swayAmp * 0.78).mul(heightMask));
      return pos;
    })();
  }

  return { barkMat, foliageMat };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. GAIA BOTANICAL INTERLOCKING GRASS TURF & WILDFLOWER CLUSTERS
//    (Powered by owenyuwono/gaia: presets.js, skeleton.js, proportions.js,
//     bladeMesh.js, foliage.js, fieldScatter.js, colorRamp.js)
// ─────────────────────────────────────────────────────────────────────────────

const WILDFLOWER_SPECIES_PALETTES = [
  // 0: Alpine Anemone (Delicate Sakura Blush-White)
  { throat: [0.76, 0.24, 0.42], rim: [0.99, 0.88, 0.93], anther: [0.98, 0.82, 0.24] },
  // 1: Campanula Harebell (Sky-Violet Periwinkle)
  { throat: [0.34, 0.26, 0.72], rim: [0.68, 0.74, 0.98], anther: [0.98, 0.88, 0.38] },
  // 2: Ranunculus Buttercup (Sunlit Meadow Gold)
  { throat: [0.84, 0.52, 0.06], rim: [0.99, 0.86, 0.18], anther: [0.95, 0.64, 0.08] },
  // 3: Stellaria Stitchwort (Crisp Snow-White & Pale Jade Throat)
  { throat: [0.58, 0.76, 0.48], rim: [0.98, 0.98, 0.99], anther: [0.96, 0.80, 0.28] },
];

/**
 * Appends a realistic botanical wildflower stem (slender curved pedicel + basal bract leaves)
 * crowned with a delicate 1.6cm–2.4cm 5-petal 3D cupped corolla.
 * Uses uv.y = 2.0 on petals so the Gaia TSL shader preserves pure petal pigment while
 * applying parallel grass venation exclusively to uv.y <= 1.0 grass blades.
 */
function appendBotanicalStemmedWildflower(
  positions,
  normals,
  uvs,
  colors,
  indices,
  baseX,
  baseZ,
  stemHeight,
  leanX,
  leanZ,
  corollaRadius,
  palette,
  rng,
) {
  // 1. Slender green pedicel stem ribbon (2 segments, 2mm half-width)
  const stemSegs = 2;
  const stemHalfW = 0.0022;
  const stemBaseVert = positions.length / 3;
  const yaw = rng() * Math.PI * 2;
  const rx = Math.cos(yaw);
  const rz = Math.sin(yaw);

  for (let s = 0; s <= stemSegs; s++) {
    const t = s / stemSegs;
    const curveT = t * t;
    const sx = baseX + leanX * curveT;
    const sy = stemHeight * t;
    const sz = baseZ + leanZ * curveT;
    const w = stemHalfW * (1.0 - t * 0.35);
    const gShade = 0.16 + t * 0.22;

    for (const side of [-1, 1]) {
      positions.push(sx + rx * side * w, sy, sz + rz * side * w);
      normals.push(rx * side * 0.35, 0.92, rz * side * 0.35);
      uvs.push(side < 0 ? 0.2 : 0.8, t * 0.8);
      colors.push(gShade * 0.14, gShade * 0.62, gShade * 0.96);
    }
  }
  for (let s = 0; s < stemSegs; s++) {
    const a = stemBaseVert + s * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }

  // 2. Delicate 3D Cupped 5-Petal Wildflower Corolla at the pedicel apex (1.6cm–2.4cm radius)
  const apexX = baseX + leanX;
  const apexY = stemHeight;
  const apexZ = baseZ + leanZ;

  const up = new THREE.Vector3(leanX * 1.4, 0.94, leanZ * 1.4).normalize();
  const helper = Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(up, helper).normalize();
  const t2 = new THREE.Vector3().crossVectors(up, t1).normalize();

  const baseIdx = positions.length / 3;
  // Center receptacle / golden anther heart
  positions.push(apexX, apexY, apexZ);
  normals.push(up.x, up.y, up.z);
  uvs.push(0.5, 2.0);
  colors.push(palette.anther[0], palette.anther[1], palette.anther[2]);

  const petals = 5;
  const rot0 = rng() * Math.PI * 2;
  for (let p = 0; p < petals; p++) {
    const a = rot0 + (p * Math.PI * 2) / petals;
    const aL = a - 0.30;
    const aR = a + 0.30;
    const r = corollaRadius * (0.90 + rng() * 0.16);
    const cupLift = r * 0.34;

    const dirL = t1.clone().multiplyScalar(Math.cos(aL)).addScaledVector(t2, Math.sin(aL));
    const dirM = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a));
    const dirR = t1.clone().multiplyScalar(Math.cos(aR)).addScaledVector(t2, Math.sin(aR));

    const pL = new THREE.Vector3(apexX, apexY, apexZ).addScaledVector(dirL, r * 0.86).addScaledVector(up, cupLift);
    const pTip = new THREE.Vector3(apexX, apexY, apexZ).addScaledVector(dirM, r * 1.05).addScaledVector(up, cupLift * 0.72);
    const pR = new THREE.Vector3(apexX, apexY, apexZ).addScaledVector(dirR, r * 0.86).addScaledVector(up, cupLift);

    const nPetal = up.clone().multiplyScalar(0.82).addScaledVector(dirM, 0.25).normalize();
    const vStart = positions.length / 3;

    positions.push(pL.x, pL.y, pL.z, pTip.x, pTip.y, pTip.z, pR.x, pR.y, pR.z);
    normals.push(nPetal.x, nPetal.y, nPetal.z, nPetal.x, nPetal.y, nPetal.z, nPetal.x, nPetal.y, nPetal.z);
    // uv.y = 2.0 flags wildflower petals so grass venation does not darken them
    uvs.push(0.2, 2.0, 0.5, 2.0, 0.8, 2.0);
    colors.push(
      palette.throat[0] * 0.35 + palette.rim[0] * 0.65,
      palette.throat[1] * 0.35 + palette.rim[1] * 0.65,
      palette.throat[2] * 0.35 + palette.rim[2] * 0.65,
      palette.rim[0],
      palette.rim[1],
      palette.rim[2],
      palette.throat[0] * 0.35 + palette.rim[0] * 0.65,
      palette.throat[1] * 0.35 + palette.rim[1] * 0.65,
      palette.throat[2] * 0.35 + palette.rim[2] * 0.65,
    );

    indices.push(baseIdx, vStart, vStart + 1);
    indices.push(baseIdx, vStart + 1, vStart + 2);
  }
}

export function buildProceduralMeadowClumpGeometry(seed = 314) {
  const rng = mulberry32(seed);
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  // 1. Bridson Poisson-Disk Field Scatter from Owen Yuwono's Gaia (gaia/fieldScatter.js):
  //    Packs ~24 multi-tiller Gaia grass tufts across a 0.82m disc with minDist = 0.21m
  //    so adjacent tufts and adjacent instances interlock into an unbroken lush turf carpet!
  const scatter = computeFieldScatter(seed, {
    radius: 0.82,
    minDist: 0.21,
    k: 30,
  });

  // Select authentic Gaia presets: Fine Fescue, Meadow Grass, Tussock & Sedge
  const gaiaSpeciesIds = ['meadow', 'tussock', 'fine-fescue', 'sedge'];
  const gaiaGenomes = gaiaSpeciesIds.map((id) => {
    const found = GAIA_PRESETS.find((p) => p.id === id);
    return found ? found.genome : GRASS_DEFAULT;
  });

  const env = { gravity: 1.0, medium: 'air', wind: 0.28, aridity: 0.12 };
  const tuftCount = Math.min(24, scatter.count);

  for (let c = 0; c < tuftCount; c++) {
    const cx = scatter.positions[c * 3];
    const cz = scatter.positions[c * 3 + 2];
    const rotY = scatter.rotationsY[c];
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    // Preserve full horizontal arch & ribbon breadth (scaleXZ ~ 1.15) while keeping height natural (0.18m – 0.36m)
    const scaleXZ = scatter.scalesXZ[c] * 1.18;
    const scaleY = scatter.scalesY[c] * 0.56;
    const clumpJitter = scatter.colorJitter[c];

    const baseGenome = gaiaGenomes[c % gaiaGenomes.length];
    const structuralSeed = ((seed + c * 7919) ^ (baseGenome.structuralSeed || 0x4C2F7A11)) >>> 0;
    // Tune Gaia proportion genes so solveGaiaProportions creates a lush outward-arching fountain rosette
    // rather than stiff vertical needles (verticality < 0.42 fans outward; low stiffness unlocks arch & tipDroop)
    const genome = {
      ...baseGenome,
      tillerCount: 2.1, // ~24 blades per tuft * 24 tufts = ~576 slender arching grass blades per patch
      clumpSpread: 0.24,
      fanSpread: 1.0,
      bladeSegments: 0.35, // 5 smooth segments per arching blade
      bladeLength: 0.18,
      bladeLengthMax: 0.36,
      bladeWidth: 0.15, // 1.2cm - 1.9cm grass blade width (via bladeWidthGeneToWorld)
      bladeWidthMax: 0.24,
      bladeTaper: 0.92,
      bladeTaperMax: 0.98,
      arch: 0.72,
      archMax: 0.96,
      tipDroop: 0.48,
      tipDroopMax: 0.76,
      stiffness: 0.20,
      verticality: 0.34,
      curve: 0.42,
      structuralSeed,
    };

    const clumpRng = mulberry32(structuralSeed);
    const skel = buildGaiaSkeleton(genome, clumpRng);
    solveGaiaProportions(skel, env, genome);

    const mesh = buildBladeGeometry(skel, {
      midribStrength: genome.midribStrength ?? 0.65,
      crossSectionCurl: genome.crossSectionCurl ?? 0.38,
      bladeTaper: genome.bladeTaper ?? 0.75,
    });

    // Anchor grass turf to exact HTML #1367A0 (sRGB [0.075, 0.404, 0.627])
    const baseRgb = [
      Math.max(0.045, 0.075 + clumpJitter * 0.015),
      Math.max(0.280, 0.404 + clumpJitter * 0.045),
      Math.max(0.460, 0.627 + clumpJitter * 0.065),
    ];

    const vBase = positions.length / 3;
    const vCount = mesh.vertexCount;

    for (let v = 0; v < vCount; v++) {
      const lx = mesh.positions[v * 3] * scaleXZ;
      const ly = mesh.positions[v * 3 + 1] * scaleY;
      const lz = mesh.positions[v * 3 + 2] * scaleXZ;

      const wx = cx + lx * cosY - lz * sinY;
      const wy = Math.max(0, ly);
      const wz = cz + lx * sinY + lz * cosY;
      positions.push(wx, wy, wz);

      // Gaia canopy-biased normal: mix(bladeNormal, +Y, 0.68) for coherent meadow sun-sheen
      const rnx = mesh.normals[v * 3];
      const rny = mesh.normals[v * 3 + 1];
      const rnz = mesh.normals[v * 3 + 2];
      const wnx = (rnx * cosY - rnz * sinY) * 0.32;
      const wny = rny * 0.32 + 0.68;
      const wnz = (rnx * sinY + rnz * cosY) * 0.32;
      const invN = 1.0 / (Math.hypot(wnx, wny, wnz) || 1.0);
      normals.push(wnx * invN, wny * invN, wnz * invN);

      const u = mesh.uvs[v * 2];
      const vCoord = mesh.uvs[v * 2 + 1];
      uvs.push(u, vCoord);

      // Gaia basal sheath AO (deep #0b3c5d root -> #1367A0 tip) + per-blade colorSeed variation
      const sway = mesh.swayFactor[v];
      const ao = Math.max(0.52, mesh.ao[v] * (0.62 + 0.38 * sway));
      const bladeSeedDelta = (mesh.colorSeed[v] - 0.5) * 0.06;
      const rCol = Math.max(0.025, (baseRgb[0] + bladeSeedDelta * 0.20) * ao);
      const gCol = Math.max(0.160, (baseRgb[1] + bladeSeedDelta * 0.65) * ao);
      const bCol = Math.max(0.280, (baseRgb[2] + bladeSeedDelta * 1.00) * ao);
      colors.push(rCol, gCol, bCol);
    }

    const idxArr = mesh.indices;
    for (let i = 0; i < idxArr.length; i++) {
      indices.push(vBase + idxArr[i]);
    }

    // 2. Emit Gaia Spikelet Seed-Heads at terminal culm tips for Meadow & Tussock clumps (gaia/foliage.js)
    if ((genome.seedHead || 0) > 0.2 && c % 2 === 1) {
      const seedHeads = generateGaiaFoliage(skel, genome, { nodeToBlade: mesh.nodeToBlade });
      const shCount = Math.min(6, seedHeads.count || 0);
      for (let s = 0; s < shCount; s++) {
        const sx = cx + (seedHeads.position[s * 3] * scaleXZ * cosY - seedHeads.position[s * 3 + 2] * scaleXZ * sinY);
        const sy = Math.max(0.14, seedHeads.position[s * 3 + 1] * scaleY);
        const sz = cz + (seedHeads.position[s * 3] * scaleXZ * sinY + seedHeads.position[s * 3 + 2] * scaleXZ * cosY);
        const shBase = positions.length / 3;
        const shH = 0.030 + rng() * 0.016;
        const shW = 0.0055;
        positions.push(
          sx - shW, sy, sz,
          sx + shW, sy, sz,
          sx, sy + shH, sz,
        );
        normals.push(0, 0.95, 0.3, 0, 0.95, 0.3, 0, 1, 0);
        uvs.push(0.2, 0.95, 0.8, 0.95, 0.5, 1.0);
        // Deep #1367A0 coastal spikelet panicle tone
        colors.push(0.075, 0.404, 0.627, 0.075, 0.404, 0.627, 0.11, 0.48, 0.72);
        indices.push(shBase, shBase + 1, shBase + 2);
      }
    }
  }

  // 3. Tightly Bundled Botanical Wildflower Bouquets nestled inside the Gaia grass turf:
  //    5 compact botanical corymb clusters of 6–7 stemmed wildflowers each (3.4cm–4.8cm corollas at y = 0.14m–0.28m)
  const clusterCenters = 5;
  for (let cl = 0; cl < clusterCenters; cl++) {
    const clAng = (cl / clusterCenters) * Math.PI * 2 + (rng() - 0.5) * 0.45;
    const clDist = 0.12 + rng() * 0.46;
    const clusterX = Math.cos(clAng) * clDist;
    const clusterZ = Math.sin(clAng) * clDist;
    const palette = WILDFLOWER_SPECIES_PALETTES[(seed + cl) % WILDFLOWER_SPECIES_PALETTES.length];
    const flowersInCluster = 6 + (cl % 2);

    for (let f = 0; f < flowersInCluster; f++) {
      const fAng = (f / flowersInCluster) * Math.PI * 2 + rng() * 0.55;
      const fSpread = 0.022 + rng() * 0.048; // Tightly bundled 2–7cm basal bouquet!
      const bx = clusterX + Math.cos(fAng) * fSpread;
      const bz = clusterZ + Math.sin(fAng) * fSpread;
      const stemH = 0.13 + rng() * 0.14; // Nestled naturally with the arching grass canopy
      const leanX = Math.cos(fAng) * (0.024 + rng() * 0.036);
      const leanZ = Math.sin(fAng) * (0.024 + rng() * 0.036);
      const corollaRadius = 0.034 + rng() * 0.014; // Visible, realistic 3.4cm–4.8cm botanical wildflower florets

      appendBotanicalStemmedWildflower(
        positions,
        normals,
        uvs,
        colors,
        indices,
        bx,
        bz,
        stemH,
        leanX,
        leanZ,
        corollaRadius,
        palette,
        rng,
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

export function createProceduralMeadowMaterial(uTime) {
  const mat = new MeshStandardNodeMaterial({
    name: 'Gaia Botanical Interlocking Grass & Wildflowers',
    roughness: 0.50,
    metalness: 0.02,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const uPlayerPos = uniform(new THREE.Vector3(0, -999, 0));
  // Default to HTML #1367A0 for Chapter 1; Chapter 5 (Egyptian Pyramid) overrides to warm red-orange
  const uBladeColor = uniform(new THREE.Color(0x1367a0));
  const uBladeTipColor = uniform(new THREE.Color(0x1367a0));
  const uBladeEmissive = uniform(new THREE.Color(0.012, 0.136, 0.352));
  mat.userData.uPlayerPos = uPlayerPos;
  mat.userData.uBladeColor = uBladeColor;
  mat.userData.uBladeTipColor = uBladeTipColor;
  mat.userData.uBladeEmissive = uBladeEmissive;

  // Gaia procedural longitudinal leaf venation + central midrib V-crease + customizable biome blade & tip tone
  const vUv = uv();
  const vColor = attribute('color', 'vec3');
  mat.colorNode = Fn(() => {
    const isBlade = smoothstep(float(1.25), float(1.05), vUv.y);
    // Longitudinal parallel vascular veins across blade width (vUv.x ∈ [0, 1])
    const veinWave = sin(vUv.x.mul(44.0)).mul(0.5).add(0.5);
    const veinFactor = mix(float(1.0), float(0.92).add(veinWave.mul(0.16)), isBlade);

    // Central V-channel midrib ridge at vUv.x = 0.5
    const midribDist = abs(vUv.x.sub(0.5));
    const midribHighlight = float(1.0).sub(smoothstep(float(0.0), float(0.09), midribDist)).mul(0.18).mul(isBlade);

    // Compute height shading along blade (0.58 at root -> 1.12 at tip) multiplied by uBladeColor
    const bladeHeightShade = float(0.58).add(clamp(vUv.y, float(0.0), float(1.0)).mul(0.54));
    const dynamicBladeCol = uBladeColor.mul(bladeHeightShade);
    const baseSourceCol = mix(vColor, dynamicBladeCol, isBlade);

    const tipMask = smoothstep(float(0.62), float(1.0), clamp(vUv.y, float(0.0), float(1.0))).mul(isBlade);
    const baseCol = baseSourceCol.mul(veinFactor).add(uBladeTipColor.mul(midribHighlight));
    return mix(baseCol, uBladeTipColor, tipMask.mul(0.52));
  })();

  // Subsurface translucency on blades (preserves #1367A0 in Chapter 1 and fiery red-orange in Chapter 5)
  mat.emissiveNode = Fn(() => {
    const isBlade = smoothstep(float(1.25), float(1.05), vUv.y);
    const tipFactor = clamp(positionLocal.y.mul(2.8), float(0.18), float(1.0));
    const bladeEmissive = uBladeEmissive.mul(tipFactor).mul(0.32);
    const petalEmissive = vColor.mul(0.10);
    return mix(petalEmissive, bladeEmissive, isBlade);
  })();

  if (uTime) {
    mat.positionNode = Fn(() => {
      const pos = positionLocal.toVar();
      const wPos = positionWorld;
      // Root-anchored quadratic sway factor (roots at y=0 never slide!)
      const hFactor = clamp(pos.y.mul(2.8), float(0.0), float(1.0));
      const bendWeight = hFactor.mul(hFactor);

      // Gaia dual-layer traveling wind wave + high-frequency tip flutter (gaia/windGlsl.js)
      const gustPhase = uTime.mul(2.05).add(wPos.x.mul(0.32)).add(wPos.z.mul(0.24));
      const flutter = sin(uTime.mul(5.4).add(pos.x.mul(14.0)).add(pos.z.mul(14.0))).mul(0.016);
      pos.x.addAssign(sin(gustPhase).mul(0.085).add(flutter).mul(bendWeight));
      pos.z.addAssign(cos(gustPhase.mul(0.86)).mul(0.068).add(flutter).mul(bendWeight));

      // Interactive Player/Combat Contact Bending
      const dx = wPos.x.sub(uPlayerPos.x);
      const dz = wPos.z.sub(uPlayerPos.z);
      const horizDist = length(vec3(dx, float(0.0), dz)).add(float(0.001));
      const contactPush = float(1.0).sub(smoothstep(float(0.20), float(1.85), horizDist)).mul(bendWeight);
      pos.x.addAssign(dx.div(horizDist).mul(contactPush.mul(0.28)));
      pos.z.addAssign(dz.div(horizDist).mul(contactPush.mul(0.28)));
      pos.y.subAssign(contactPush.mul(0.12));

      return pos;
    })();
  }

  return mat;
}
