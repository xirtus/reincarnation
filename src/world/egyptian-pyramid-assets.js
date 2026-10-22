import * as THREE from 'three';
import { buildVolumetricFirePlume } from '../render/shaders.js';

let _cachedTextureSuite = null;

/**
 * Deterministic pseudo-random helper in [0, 1).
 */
function seededRandom(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * Converts a grayscale height canvas (0 = recessed groove, 128 = mid plane, 255 = raised relief)
 * into a tangent-space normal map CanvasTexture using a 3x3 Sobel filter.
 */
function createNormalMapFromHeightCanvas(heightCanvas, strength = 3.2, maxAnisotropy = 8) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const hCtx = heightCanvas.getContext('2d');
  const src = hCtx.getImageData(0, 0, w, h).data;

  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  const nCtx = normCanvas.getContext('2d');
  const dstImg = nCtx.createImageData(w, h);
  const dst = dstImg.data;

  const sampleH = (x, y) => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255.0;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sampleH(x - 1, y - 1);
      const t = sampleH(x, y - 1);
      const tr = sampleH(x + 1, y - 1);
      const l = sampleH(x - 1, y);
      const r = sampleH(x + 1, y);
      const bl = sampleH(x - 1, y + 1);
      const b = sampleH(x, y + 1);
      const br = sampleH(x + 1, y + 1);

      const dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
      const dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);

      let nx = -dX * strength;
      let ny = dY * strength; // OpenGL tangent space (+Y up)
      let nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * w + x) * 4;
      dst[idx] = Math.max(0, Math.min(255, Math.round((nx * 0.5 + 0.5) * 255)));
      dst[idx + 1] = Math.max(0, Math.min(255, Math.round((ny * 0.5 + 0.5) * 255)));
      dst[idx + 2] = Math.max(0, Math.min(255, Math.round((nz * 0.5 + 0.5) * 255)));
      dst[idx + 3] = 255;
    }
  }

  nCtx.putImageData(dstImg, 0, 0);
  const tex = new THREE.CanvasTexture(normCanvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

function configureCanvasTexture(canvas, isColor = true, maxAnisotropy = 8) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Projects world-space (box-dimension-proportional) UVs onto a BoxGeometry so megalithic
 * stone courses, pyramid tiers, pylons, and tomb walls tile at realistic masonry proportions
 * instead of stretching a single [0..1] UV across 150m.
 */
function applyWorldSpaceBoxUVs(geometry, scaleU = 0.16, scaleV = 0.22, lockV01 = false) {
  const pos = geometry.attributes?.position;
  const norm = geometry.attributes?.normal;
  const uv = geometry.attributes?.uv;
  if (!pos || !norm || !uv) return geometry;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const minX = bb ? bb.min.x : 0;
  const minY = bb ? bb.min.y : 0;
  const minZ = bb ? bb.min.z : 0;
  const spanY = bb ? Math.max(0.001, bb.max.y - bb.min.y) : 1;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - minX;
    const y = pos.getY(i) - minY;
    const z = pos.getZ(i) - minZ;
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));

    let u = 0;
    let v = 0;
    if (ny > nx && ny > nz) {
      u = x * scaleU;
      v = z * scaleU;
    } else if (nx > nz) {
      u = z * scaleU;
      v = lockV01 ? y / spanY : y * scaleV;
    } else {
      u = x * scaleU;
      v = lockV01 ? y / spanY : y * scaleV;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Draws an individual authentic Egyptian hieroglyph in chiseled sunken-relief intaglio
 * (recessed top-left chisel shadow, sunlit bottom-right bevel rim, and weathered mineral pigments).
 * @param {number} glyphType 0..9
 */
function drawEgyptianGlyph(cCtx, hCtx, rCtx, mCtx, cx, cy, size, glyphType, seed = 0) {
  const s = size * 0.44;
  const pigmentRoll = seededRandom(seed * 17.3 + glyphType);
  // Weathered mineral pigments inside sunken relief: Terracotta Carnelian (#c4421e), Ochre Gold (#cfa034),
  // Deep carved sandstone shadow (#6e4f30), Lapis (#1367A0), or Faience Turquoise (#247f88)
  let fillStyle = '#6e4f30';
  let isGold = false;
  let isLapis = false;
  if (pigmentRoll < 0.28) {
    fillStyle = '#c4421e'; // Sun-baked Carnelian / Red-Orange Ochre pigment
  } else if (pigmentRoll < 0.52) {
    fillStyle = '#cfa034'; // Gold leaf / Yellow ochre remnant
    isGold = true;
  } else if (pigmentRoll < 0.68) {
    fillStyle = '#1367A0'; // Sacred Lapis Lazuli pigment remnant
    isLapis = true;
  } else if (pigmentRoll < 0.78) {
    fillStyle = '#247f88'; // Egyptian faience turquoise
  }

  const traceGlyphGeometry = (ctx, g) => {
    ctx.beginPath();
    if (g === 0) {
      // 1. Ankh (Key of Life)
      ctx.ellipse(0, -s * 0.35, s * 0.28, s * 0.38, 0, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.42, 0.02 * s);
      ctx.lineTo(s * 0.42, 0.02 * s);
      ctx.moveTo(0, 0.02 * s);
      ctx.lineTo(0, s * 0.78);
      ctx.stroke();
    } else if (g === 1) {
      // 2. Eye of Horus (Wedjat)
      ctx.moveTo(-s * 0.75, -s * 0.22);
      ctx.quadraticCurveTo(0, -s * 0.55, s * 0.75, -s * 0.18);
      ctx.moveTo(-s * 0.68, 0);
      ctx.quadraticCurveTo(0, -s * 0.32, s * 0.68, 0);
      ctx.quadraticCurveTo(0, s * 0.32, -s * 0.68, 0);
      ctx.moveTo(0.1 * s, 0.15 * s);
      ctx.lineTo(0.1 * s, 0.65 * s);
      ctx.moveTo(-0.1 * s, 0.15 * s);
      ctx.quadraticCurveTo(-0.45 * s, 0.58 * s, -0.62 * s, 0.42 * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
    } else if (g === 2) {
      // 3. Khepri Scarab Beetle
      ctx.ellipse(0, 0.08 * s, s * 0.36, s * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -s * 0.56, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      for (const side of [-1, 1]) {
        ctx.moveTo(side * s * 0.32, -s * 0.2);
        ctx.lineTo(side * s * 0.68, -s * 0.45);
        ctx.moveTo(side * s * 0.36, 0.08 * s);
        ctx.lineTo(side * s * 0.72, 0.08 * s);
        ctx.moveTo(side * s * 0.32, s * 0.35);
        ctx.lineTo(side * s * 0.66, s * 0.62);
      }
      ctx.stroke();
    } else if (g === 3) {
      // 4. Sacred Ibis / Falcon of Horus
      ctx.moveTo(-s * 0.35, -s * 0.55);
      ctx.lineTo(s * 0.1, -s * 0.55);
      ctx.lineTo(s * 0.45, -s * 0.38);
      ctx.moveTo(-s * 0.15, -s * 0.55);
      ctx.lineTo(-s * 0.38, s * 0.25);
      ctx.lineTo(s * 0.42, s * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.15, s * 0.22);
      ctx.lineTo(-s * 0.15, s * 0.72);
      ctx.moveTo(s * 0.12, s * 0.2);
      ctx.lineTo(s * 0.12, s * 0.72);
      ctx.stroke();
    } else if (g === 4) {
      // 5. Feather of Ma'at & Reed Leaf
      ctx.moveTo(-s * 0.18, s * 0.75);
      ctx.lineTo(-s * 0.18, -s * 0.68);
      ctx.quadraticCurveTo(s * 0.38, -s * 0.62, s * 0.28, s * 0.35);
      ctx.lineTo(-s * 0.18, s * 0.35);
      ctx.fill();
      ctx.stroke();
    } else if (g === 5) {
      // 6. Solar Disc of Ra with Uraeus Cobra
      ctx.arc(0, -s * 0.08, s * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -s * 0.08, s * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, s * 0.28);
      ctx.quadraticCurveTo(0, s * 0.72, s * 0.45, s * 0.28);
      ctx.stroke();
    } else if (g === 6) {
      // 7. Three Nile Water Ripples (Nun)
      for (let row = -1; row <= 1; row++) {
        const ry = row * s * 0.42;
        ctx.moveTo(-s * 0.68, ry);
        for (let k = -2; k <= 2; k++) {
          ctx.lineTo(k * s * 0.28, ry + (k % 2 === 0 ? -s * 0.14 : s * 0.14));
        }
      }
      ctx.stroke();
    } else if (g === 7) {
      // 8. Rearing Uraeus Cobra
      ctx.moveTo(-s * 0.35, s * 0.65);
      ctx.quadraticCurveTo(s * 0.45, s * 0.55, 0, s * 0.1);
      ctx.quadraticCurveTo(-s * 0.48, -s * 0.35, 0, -s * 0.62);
      ctx.quadraticCurveTo(s * 0.32, -s * 0.62, s * 0.38, -s * 0.38);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-s * 0.05, -s * 0.32, s * 0.28, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (g === 8) {
      // 9. Djed Pillar (Backbone of Osiris)
      ctx.moveTo(-s * 0.18, s * 0.72);
      ctx.lineTo(-s * 0.12, -s * 0.62);
      ctx.lineTo(s * 0.12, -s * 0.62);
      ctx.lineTo(s * 0.18, s * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let bar = 0; bar < 4; bar++) {
        const by = -s * 0.58 + bar * s * 0.2;
        ctx.moveTo(-s * 0.38, by);
        ctx.lineTo(s * 0.38, by);
      }
      ctx.stroke();
    } else {
      // 10. Crook (Heka) & Flail (Nekhakha)
      ctx.moveTo(-s * 0.38, s * 0.68);
      ctx.lineTo(s * 0.25, -s * 0.35);
      ctx.arc(s * 0.08, -s * 0.42, s * 0.2, 0, Math.PI * 1.35, true);
      ctx.moveTo(s * 0.38, s * 0.68);
      ctx.lineTo(-s * 0.28, -s * 0.48);
      ctx.lineTo(-s * 0.52, -s * 0.05);
      ctx.stroke();
    }
  };

  const g = glyphType % 10;

  // 1. Color pass: Sunlit bottom-right chisel bevel, top-left deep carved shadow, and inner recessed glyph pigment
  cCtx.save();
  cCtx.lineCap = 'round';
  cCtx.lineJoin = 'round';
  // Bottom-right sunlit limestone bevel highlight
  cCtx.save();
  cCtx.translate(cx + 1.8, cy + 1.8);
  cCtx.strokeStyle = 'rgba(248, 224, 178, 0.75)';
  cCtx.fillStyle = 'rgba(248, 224, 178, 0.55)';
  cCtx.lineWidth = Math.max(2.6, s * 0.21);
  traceGlyphGeometry(cCtx, g);
  cCtx.restore();
  // Top-left deep chiseled intaglio shadow
  cCtx.save();
  cCtx.translate(cx - 1.8, cy - 1.8);
  cCtx.strokeStyle = 'rgba(34, 21, 10, 0.88)';
  cCtx.fillStyle = 'rgba(34, 21, 10, 0.78)';
  cCtx.lineWidth = Math.max(2.6, s * 0.22);
  traceGlyphGeometry(cCtx, g);
  cCtx.restore();
  // Center carved recess with weathered mineral pigment
  cCtx.translate(cx, cy);
  cCtx.strokeStyle = '#3b2613';
  cCtx.fillStyle = fillStyle;
  cCtx.lineWidth = Math.max(2.0, s * 0.17);
  traceGlyphGeometry(cCtx, g);
  cCtx.restore();

  // 2. Height pass: Raised bevel rim (218) + deep sunken V-cut chisel groove (18)
  hCtx.save();
  hCtx.lineCap = 'round';
  hCtx.lineJoin = 'round';
  hCtx.translate(cx, cy);
  hCtx.strokeStyle = 'rgb(218, 218, 218)';
  hCtx.fillStyle = 'rgb(195, 195, 195)';
  hCtx.lineWidth = Math.max(4.5, s * 0.34);
  traceGlyphGeometry(hCtx, g);
  hCtx.strokeStyle = 'rgb(18, 18, 18)';
  hCtx.fillStyle = 'rgb(28, 28, 28)';
  hCtx.lineWidth = Math.max(2.6, s * 0.22);
  traceGlyphGeometry(hCtx, g);
  hCtx.restore();

  // 3. Roughness pass
  rCtx.save();
  rCtx.translate(cx, cy);
  rCtx.lineCap = 'round';
  rCtx.lineJoin = 'round';
  const rVal = isGold ? 68 : isLapis ? 128 : 225;
  rCtx.strokeStyle = `rgb(${rVal},${rVal},${rVal})`;
  rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
  rCtx.lineWidth = Math.max(2.2, s * 0.18);
  traceGlyphGeometry(rCtx, g);
  rCtx.restore();

  // 4. Metalness pass
  mCtx.save();
  mCtx.translate(cx, cy);
  mCtx.lineCap = 'round';
  mCtx.lineJoin = 'round';
  const mVal = isGold ? 215 : 10;
  mCtx.strokeStyle = `rgb(${mVal},${mVal},${mVal})`;
  mCtx.fillStyle = `rgb(${mVal},${mVal},${mVal})`;
  mCtx.lineWidth = Math.max(2.2, s * 0.18);
  traceGlyphGeometry(mCtx, g);
  mCtx.restore();
}

/**
 * 1. Generates and caches rich, high-resolution (1024x1024) procedural PBR THREE.CanvasTexture sets
 *    plus PolyHaven sandstone textures for the Egyptian Pyramid & Ancient Tomb level.
 */
export function createEgyptianTextureSuite(maxAnisotropy = 8) {
  if (_cachedTextureSuite) return _cachedTextureSuite;

  const W = 1024;
  const H = 1024;

  // ============================================================================
  // A. HIEROGLYPH RELIEF (1024x1024 Sunken-Relief Sandstone Wall Blocks)
  // ============================================================================
  const hieroColor = document.createElement('canvas');
  const hieroHeight = document.createElement('canvas');
  const hieroRough = document.createElement('canvas');
  const hieroMetal = document.createElement('canvas');
  hieroColor.width = hieroHeight.width = hieroRough.width = hieroMetal.width = W;
  hieroColor.height = hieroHeight.height = hieroRough.height = hieroMetal.height = H;

  const hcCtx = hieroColor.getContext('2d');
  const hhCtx = hieroHeight.getContext('2d');
  const hrCtx = hieroRough.getContext('2d');
  const hmCtx = hieroMetal.getContext('2d');

  // Base warm desert sandstone / Tura limestone
  hcCtx.fillStyle = '#c8a168';
  hcCtx.fillRect(0, 0, W, H);
  hhCtx.fillStyle = 'rgb(185, 185, 185)';
  hhCtx.fillRect(0, 0, W, H);
  hrCtx.fillStyle = 'rgb(214, 214, 214)';
  hrCtx.fillRect(0, 0, W, H);
  hmCtx.fillStyle = 'rgb(10, 10, 10)';
  hmCtx.fillRect(0, 0, W, H);

  // Underlying coursed megalithic ashlar blocks (8 courses x 4 blocks in running bond)
  const registers = 8;
  const regH = H / registers;
  for (let row = 0; row < registers; row++) {
    const y0 = row * regH;
    const blockW = W / 4;
    const rowOffset = (row % 2) * (blockW * 0.5);
    for (let b = -1; b <= 4; b++) {
      const x0 = b * blockW + rowOffset;
      const seed = row * 23 + b * 41;
      const shift = Math.round((seededRandom(seed) - 0.5) * 24);
      const br = Math.min(255, Math.max(0, 202 + shift));
      const bg = Math.min(255, Math.max(0, 162 + shift));
      const bb = Math.min(255, Math.max(0, 106 + shift));
      hcCtx.fillStyle = `rgb(${br},${bg},${bb})`;
      hcCtx.fillRect(x0 + 3, y0 + 3, blockW - 6, regH - 6);

      // Sunlit top/left block chamfer & bottom/right shadow chamfer
      hcCtx.fillStyle = 'rgba(248, 224, 180, 0.35)';
      hcCtx.fillRect(x0 + 4, y0 + 4, blockW - 8, 3);
      hcCtx.fillStyle = 'rgba(54, 36, 18, 0.48)';
      hcCtx.fillRect(x0 + 4, y0 + regH - 7, blockW - 8, 3);

      // Vertical & horizontal ashlar mortar seam
      hcCtx.strokeStyle = '#48321b';
      hcCtx.lineWidth = 4;
      hcCtx.strokeRect(x0, y0, blockW, regH);

      const hAshlar = Math.round(176 + (seededRandom(seed + 9) - 0.5) * 32);
      hhCtx.fillStyle = `rgb(${hAshlar},${hAshlar},${hAshlar})`;
      hhCtx.fillRect(x0 + 4, y0 + 4, blockW - 8, regH - 8);
      hhCtx.strokeStyle = 'rgb(22, 22, 22)';
      hhCtx.lineWidth = 5;
      hhCtx.strokeRect(x0, y0, blockW, regH);
    }
  }

  // Sandstone sedimentary grain, chisel marks & weathered desert pitting
  for (let i = 0; i < 3600; i++) {
    const x = seededRandom(i * 1.13) * W;
    const y = seededRandom(i * 2.41) * H;
    const r = 1.5 + seededRandom(i * 3.7) * 7.5;
    const shade = seededRandom(i * 5.1) > 0.5 ? 'rgba(235, 202, 148, 0.16)' : 'rgba(92, 64, 36, 0.18)';
    hcCtx.fillStyle = shade;
    hcCtx.fillRect(x, y, r * 2.4, r * 0.65);
    const hVal = Math.round(168 + (seededRandom(i * 7.3) - 0.5) * 44);
    hhCtx.fillStyle = `rgb(${hVal},${hVal},${hVal})`;
    hhCtx.fillRect(x, y, r * 1.6, r * 0.8);
  }

  // Horizontal register divider bands & block mortar joints
  for (let r = 0; r < registers; r++) {
    const ry = r * regH;
    // Deep chiseled register groove with weathered Carnelian (#c4421e), Gold (#c99f36) & Lapis (#1367A0) cord inlay
    hcCtx.fillStyle = '#3b2815';
    hcCtx.fillRect(0, ry, W, 8);
    hcCtx.fillStyle = r % 3 === 0 ? '#c4421e' : r % 3 === 1 ? '#c99f36' : '#1367A0';
    hcCtx.fillRect(0, ry + 2, W, 4);

    hhCtx.fillStyle = 'rgb(24, 24, 24)';
    hhCtx.fillRect(0, ry, W, 8);
    hrCtx.fillStyle = r % 3 === 1 ? 'rgb(72, 72, 72)' : 'rgb(150, 150, 150)';
    hrCtx.fillRect(0, ry, W, 8);
    hmCtx.fillStyle = r % 3 === 1 ? 'rgb(210, 210, 210)' : 'rgb(20, 20, 20)';
    hmCtx.fillRect(0, ry + 2, W, 4);
  }

  // Vertical cartouche ovals & hieroglyph columns
  const cols = 8;
  const colW = W / cols;
  for (let c = 0; c < cols; c++) {
    const cx = c * colW;
    // Vertical column divider groove
    hcCtx.fillStyle = '#6e5233';
    hcCtx.fillRect(cx, 0, 5, H);
    hhCtx.fillStyle = 'rgb(45, 45, 45)';
    hhCtx.fillRect(cx, 0, 5, H);

    // Draw Royal Cartouche Ring on every third column
    if (c % 3 === 1) {
      for (let cart = 0; cart < 2; cart++) {
        const cartY = cart * (H / 2) + H * 0.25;
        const cartW = colW * 0.76;
        const cartH = (H / 2) * 0.78;
        hcCtx.save();
        hcCtx.strokeStyle = '#d4af37';
        hcCtx.lineWidth = 6;
        hcCtx.beginPath();
        hcCtx.roundRect(cx + (colW - cartW) * 0.5, cartY - cartH * 0.5, cartW, cartH, cartW * 0.48);
        hcCtx.stroke();
        // Shen knot base of cartouche
        hcCtx.moveTo(cx + colW * 0.14, cartY + cartH * 0.5 + 5);
        hcCtx.lineTo(cx + colW * 0.86, cartY + cartH * 0.5 + 5);
        hcCtx.stroke();
        hcCtx.restore();

        hhCtx.save();
        hhCtx.strokeStyle = 'rgb(235, 235, 235)';
        hhCtx.lineWidth = 7;
        hhCtx.beginPath();
        hhCtx.roundRect(cx + (colW - cartW) * 0.5, cartY - cartH * 0.5, cartW, cartH, cartW * 0.48);
        hhCtx.stroke();
        hhCtx.restore();

        hmCtx.save();
        hmCtx.strokeStyle = 'rgb(225, 225, 225)';
        hmCtx.lineWidth = 6;
        hmCtx.beginPath();
        hmCtx.roundRect(cx + (colW - cartW) * 0.5, cartY - cartH * 0.5, cartW, cartH, cartW * 0.48);
        hmCtx.stroke();
        hmCtx.restore();
      }
    }

    for (let r = 0; r < registers; r++) {
      const gx = cx + colW * 0.52;
      const gy = r * regH + regH * 0.54;
      const glyphIdx = Math.floor(seededRandom((c + 1) * 31 + (r + 1) * 19) * 10);
      drawEgyptianGlyph(hcCtx, hhCtx, hrCtx, hmCtx, gx, gy, Math.min(colW, regH) * 0.72, glyphIdx, c * 13 + r * 7);
    }
  }

  const hieroglyphMap = configureCanvasTexture(hieroColor, true, maxAnisotropy);
  const hieroglyphNormal = createNormalMapFromHeightCanvas(hieroHeight, 3.6, maxAnisotropy);
  const hieroglyphRough = configureCanvasTexture(hieroRough, false, maxAnisotropy);
  const hieroglyphMetal = configureCanvasTexture(hieroMetal, false, maxAnisotropy);

  // ============================================================================
  // B. ANCIENT MURAL (1024x1024 Polychrome Egyptian Tomb Mural Frescoes)
  // ============================================================================
  const muralColor = document.createElement('canvas');
  const muralHeight = document.createElement('canvas');
  const muralRough = document.createElement('canvas');
  const muralMetal = document.createElement('canvas');
  muralColor.width = muralHeight.width = muralRough.width = muralMetal.width = W;
  muralColor.height = muralHeight.height = muralRough.height = muralMetal.height = H;

  const mcCtx = muralColor.getContext('2d');
  const mhCtx = muralHeight.getContext('2d');
  const mrCtx = muralRough.getContext('2d');
  const mmCtx = muralMetal.getContext('2d');

  // Plastered warm Tura limestone ground
  mcCtx.fillStyle = '#dec698';
  mcCtx.fillRect(0, 0, W, H);
  mhCtx.fillStyle = 'rgb(160, 160, 160)';
  mhCtx.fillRect(0, 0, W, H);
  mrCtx.fillStyle = 'rgb(195, 195, 195)';
  mrCtx.fillRect(0, 0, W, H);
  mmCtx.fillStyle = 'rgb(12, 12, 12)';
  mmCtx.fillRect(0, 0, W, H);

  // Upper Kheker Frieze & Polychrome Block Border (Lapis #1367A0, Carnelian #B83A24, Gold #D4AF37, Turquoise #22929B)
  const palette = ['#1367A0', '#D4AF37', '#B83A24', '#22929B'];
  for (const borderY of [0, 310, 680, 980]) {
    const segW = 32;
    for (let x = 0; x < W; x += segW) {
      const col = palette[(x / segW) % palette.length];
      mcCtx.fillStyle = col;
      mcCtx.fillRect(x, borderY, segW - 2, 26);
      mhCtx.fillStyle = 'rgb(205, 205, 205)';
      mhCtx.fillRect(x, borderY, segW - 2, 26);
      if (col === '#D4AF37') {
        mmCtx.fillStyle = 'rgb(225, 225, 225)';
        mmCtx.fillRect(x, borderY, segW - 2, 26);
        mrCtx.fillStyle = 'rgb(65, 65, 65)';
        mrCtx.fillRect(x, borderY, segW - 2, 26);
      }
    }
  }

  // Register 1 (Top: y = 32..305): Winged Horus / Behdety Solar Disc & Starry Duat Band
  mcCtx.fillStyle = '#0c2c47';
  mcCtx.fillRect(0, 32, W, 62);
  for (let s = 0; s < 24; s++) {
    const sx = (s + 0.5) * (W / 24);
    const sy = 63;
    mcCtx.fillStyle = '#D4AF37';
    mcCtx.beginPath();
    for (let p = 0; p < 5; p++) {
      const a1 = (p * 2 * Math.PI) / 5 - Math.PI / 2;
      const a2 = a1 + Math.PI / 5;
      mcCtx.lineTo(sx + Math.cos(a1) * 14, sy + Math.sin(a1) * 14);
      mcCtx.lineTo(sx + Math.cos(a2) * 5.5, sy + Math.sin(a2) * 5.5);
    }
    mcCtx.closePath();
    mcCtx.fill();
    mmCtx.fillStyle = 'rgb(230, 230, 230)';
    mmCtx.fillRect(sx - 10, sy - 10, 20, 20);
  }

  // Outstretched Falcon Wings of Horus in Lapis (#1367A0), Turquoise (#22929B), Carnelian (#B83A24), and Gold (#D4AF37)
  const wingCenterY = 195;
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 3; tier++) {
      const rOuter = 440 - tier * 42;
      const rInner = rOuter - 38;
      const tierCol = tier === 0 ? '#1367A0' : tier === 1 ? '#22929B' : '#B83A24';
      const feathers = 18;
      for (let f = 0; f < feathers; f++) {
        const fx0 = W * 0.5 + side * (55 + f * ((rOuter - 55) / feathers));
        const fy0 = wingCenterY - 40 + tier * 28 + Math.abs(f) * 1.4;
        mcCtx.fillStyle = tierCol;
        mcCtx.strokeStyle = '#D4AF37';
        mcCtx.lineWidth = 2.5;
        mcCtx.beginPath();
        mcCtx.roundRect(Math.min(fx0, fx0 + side * 22), fy0, 22, 34, 8);
        mcCtx.fill();
        mcCtx.stroke();

        mhCtx.fillStyle = 'rgb(210, 210, 210)';
        mhCtx.fillRect(Math.min(fx0, fx0 + side * 22), fy0, 20, 32);
      }
    }
  }
  // Central Solar Disc of Ra with twin golden Uraeus cobras
  mcCtx.fillStyle = '#B83A24';
  mcCtx.strokeStyle = '#D4AF37';
  mcCtx.lineWidth = 8;
  mcCtx.beginPath();
  mcCtx.arc(W * 0.5, wingCenterY, 48, 0, Math.PI * 2);
  mcCtx.fill();
  mcCtx.stroke();
  mhCtx.fillStyle = 'rgb(235, 235, 235)';
  mhCtx.beginPath();
  mhCtx.arc(W * 0.5, wingCenterY, 50, 0, Math.PI * 2);
  mhCtx.fill();
  mmCtx.fillStyle = 'rgb(220, 220, 220)';
  mmCtx.beginPath();
  mmCtx.arc(W * 0.5, wingCenterY, 52, 0, Math.PI * 2);
  mmCtx.fill();

  // Register 2 (Middle: y = 345..670): Anubis Weighing the Heart against the Feather of Ma'at
  // Central Golden Scales of Ma'at
  const scaleX = W * 0.5;
  const scaleTopY = 395;
  mcCtx.strokeStyle = '#D4AF37';
  mcCtx.fillStyle = '#D4AF37';
  mcCtx.lineWidth = 8;
  mcCtx.beginPath();
  mcCtx.moveTo(scaleX, 655);
  mcCtx.lineTo(scaleX, scaleTopY);
  mcCtx.moveTo(scaleX - 150, scaleTopY + 25);
  mcCtx.lineTo(scaleX + 150, scaleTopY + 25);
  mcCtx.stroke();
  // Left pan (Ib Heart Vessel in Carnelian Red) & Right pan (Feather of Ma'at in Lapis/Turquoise)
  for (const panSide of [-1, 1]) {
    const px = scaleX + panSide * 140;
    const py = scaleTopY + 135;
    mcCtx.strokeStyle = '#D4AF37';
    mcCtx.lineWidth = 3;
    mcCtx.beginPath();
    mcCtx.moveTo(px, scaleTopY + 25);
    mcCtx.lineTo(px - 32, py);
    mcCtx.moveTo(px, scaleTopY + 25);
    mcCtx.lineTo(px + 32, py);
    mcCtx.stroke();

    mcCtx.fillStyle = '#D4AF37';
    mcCtx.beginPath();
    mcCtx.arc(px, py, 36, 0, Math.PI, false);
    mcCtx.fill();

    if (panSide < 0) {
      // Carnelian Heart Scarab / Ib jar
      mcCtx.fillStyle = '#B83A24';
      mcCtx.beginPath();
      mcCtx.ellipse(px, py - 24, 18, 24, 0, 0, Math.PI * 2);
      mcCtx.fill();
    } else {
      // Lapis & Gold Feather of Ma'at
      mcCtx.fillStyle = '#1367A0';
      mcCtx.beginPath();
      mcCtx.ellipse(px, py - 32, 12, 34, 0.15, 0, Math.PI * 2);
      mcCtx.fill();
    }
  }

  // Left figure: Jackal-headed Anubis in profile (Black skin, Lapis #1367A0 & Gold #D4AF37 Nemes wig & kilt)
  const drawEgyptianDeityProfile = (cx, baseY, facing, headKind) => {
    mcCtx.save();
    mcCtx.translate(cx, baseY);
    mcCtx.scale(facing, 1);

    // Legs & striding stance
    mcCtx.fillStyle = headKind === 'anubis' ? '#1a1d24' : '#b85a32';
    mcCtx.strokeStyle = '#2a1c11';
    mcCtx.lineWidth = 3;
    mcCtx.beginPath();
    mcCtx.moveTo(-28, 0);
    mcCtx.lineTo(-10, -115);
    mcCtx.lineTo(18, -115);
    mcCtx.lineTo(42, 0);
    mcCtx.lineTo(24, 0);
    mcCtx.lineTo(4, -85);
    mcCtx.lineTo(-12, 0);
    mcCtx.closePath();
    mcCtx.fill();

    // Royal Shendyt Kilt in White & Gold with Lapis belt
    mcCtx.fillStyle = '#f2e6c8';
    mcCtx.beginPath();
    mcCtx.moveTo(-24, -180);
    mcCtx.lineTo(28, -180);
    mcCtx.lineTo(38, -105);
    mcCtx.lineTo(-28, -105);
    mcCtx.closePath();
    mcCtx.fill();
    mcCtx.fillStyle = '#D4AF37';
    mcCtx.fillRect(-26, -186, 54, 14);
    mcCtx.fillStyle = '#1367A0';
    mcCtx.fillRect(-6, -180, 14, 75);

    // Torso & Broad Usekh Collar
    mcCtx.fillStyle = headKind === 'anubis' ? '#1a1d24' : '#b85a32';
    mcCtx.beginPath();
    mcCtx.moveTo(-24, -180);
    mcCtx.lineTo(-38, -268);
    mcCtx.lineTo(38, -268);
    mcCtx.lineTo(24, -180);
    mcCtx.closePath();
    mcCtx.fill();

    // Lapis & Gold Broad Collar
    mcCtx.fillStyle = '#D4AF37';
    mcCtx.beginPath();
    mcCtx.arc(0, -264, 38, 0, Math.PI, false);
    mcCtx.fill();
    mcCtx.fillStyle = '#1367A0';
    mcCtx.beginPath();
    mcCtx.arc(0, -264, 28, 0, Math.PI, false);
    mcCtx.fill();

    // Outstretched Arms holding Was-Scepter & Ankh
    mcCtx.strokeStyle = headKind === 'anubis' ? '#1a1d24' : '#b85a32';
    mcCtx.lineWidth = 14;
    mcCtx.beginPath();
    mcCtx.moveTo(28, -255);
    mcCtx.lineTo(84, -225);
    mcCtx.moveTo(-28, -255);
    mcCtx.lineTo(-64, -195);
    mcCtx.stroke();

    // Golden Was-Scepter in front hand
    mcCtx.strokeStyle = '#D4AF37';
    mcCtx.lineWidth = 6;
    mcCtx.beginPath();
    mcCtx.moveTo(84, -310);
    mcCtx.lineTo(84, 0);
    mcCtx.stroke();

    // Head & Lapis Nemes Wig
    mcCtx.fillStyle = '#1367A0';
    mcCtx.beginPath();
    mcCtx.roundRect(-30, -328, 52, 68, 14);
    mcCtx.fill();

    if (headKind === 'anubis') {
      // Jackal Snout & Tall Pointed Ears
      mcCtx.fillStyle = '#14161c';
      mcCtx.beginPath();
      mcCtx.moveTo(0, -318);
      mcCtx.lineTo(68, -304);
      mcCtx.lineTo(64, -288);
      mcCtx.lineTo(8, -282);
      mcCtx.closePath();
      mcCtx.fill();
      // Tall jackal ears
      mcCtx.beginPath();
      mcCtx.moveTo(-8, -324);
      mcCtx.lineTo(-18, -372);
      mcCtx.lineTo(2, -326);
      mcCtx.moveTo(6, -324);
      mcCtx.lineTo(2, -374);
      mcCtx.lineTo(18, -324);
      mcCtx.fill();
    } else {
      // Falcon Head of Horus + Solar Disc Crown
      mcCtx.fillStyle = '#f2e6c8';
      mcCtx.beginPath();
      mcCtx.arc(10, -302, 24, 0, Math.PI * 2);
      mcCtx.fill();
      mcCtx.fillStyle = '#1a1d24';
      mcCtx.beginPath();
      mcCtx.moveTo(28, -308);
      mcCtx.lineTo(54, -296);
      mcCtx.lineTo(28, -288);
      mcCtx.closePath();
      mcCtx.fill();
      mcCtx.fillStyle = '#B83A24';
      mcCtx.strokeStyle = '#D4AF37';
      mcCtx.lineWidth = 5;
      mcCtx.beginPath();
      mcCtx.arc(4, -348, 22, 0, Math.PI * 2);
      mcCtx.fill();
      mcCtx.stroke();
    }
    mcCtx.restore();

    // Add relief to height map for figure
    mhCtx.fillStyle = 'rgb(215, 215, 215)';
    mhCtx.fillRect(cx - 55, baseY - 355, 110, 355);
  };

  drawEgyptianDeityProfile(210, 665, 1, 'anubis');
  drawEgyptianDeityProfile(814, 665, -1, 'horus');

  // Register 3 (Bottom: y = 715..975): Ra's Golden Solar Barque sailing across the Lapis Duat Waters
  mcCtx.fillStyle = '#1367A0';
  mcCtx.fillRect(0, 905, W, 72);
  // Zigzag Nile waves
  mcCtx.strokeStyle = '#0a253d';
  mcCtx.lineWidth = 4;
  for (let wy = 918; wy < 972; wy += 16) {
    mcCtx.beginPath();
    for (let wx = 0; wx <= W; wx += 24) {
      mcCtx.lineTo(wx, wy + ((wx / 24) % 2 === 0 ? -5 : 5));
    }
    mcCtx.stroke();
  }

  // Golden Papyrus Solar Barque Hull
  mcCtx.fillStyle = '#D4AF37';
  mcCtx.strokeStyle = '#8b6914';
  mcCtx.lineWidth = 5;
  mcCtx.beginPath();
  mcCtx.moveTo(180, 825);
  mcCtx.quadraticCurveTo(W * 0.5, 955, W - 180, 825);
  mcCtx.lineTo(W - 145, 765);
  mcCtx.quadraticCurveTo(W * 0.5, 905, 145, 765);
  mcCtx.closePath();
  mcCtx.fill();
  mcCtx.stroke();

  mhCtx.fillStyle = 'rgb(235, 235, 235)';
  mhCtx.beginPath();
  mhCtx.moveTo(180, 825);
  mhCtx.quadraticCurveTo(W * 0.5, 955, W - 180, 825);
  mhCtx.lineTo(W - 145, 765);
  mhCtx.quadraticCurveTo(W * 0.5, 905, 145, 765);
  mhCtx.closePath();
  mhCtx.fill();

  mmCtx.fillStyle = 'rgb(225, 225, 225)';
  mmCtx.fillRect(220, 845, W - 440, 62);

  // Naos Shrine Cabin in center of Solar Barque
  mcCtx.fillStyle = '#1367A0';
  mcCtx.strokeStyle = '#D4AF37';
  mcCtx.lineWidth = 6;
  mcCtx.fillRect(W * 0.5 - 65, 745, 130, 125);
  mcCtx.strokeRect(W * 0.5 - 65, 745, 130, 125);
  mcCtx.fillStyle = '#B83A24';
  mcCtx.beginPath();
  mcCtx.arc(W * 0.5, 805, 34, 0, Math.PI * 2);
  mcCtx.fill();
  mcCtx.stroke();

  // Aged Plaster Cracks across the mural
  mcCtx.strokeStyle = 'rgba(72, 52, 32, 0.55)';
  mhCtx.strokeStyle = 'rgb(30, 30, 30)';
  for (let c = 0; c < 28; c++) {
    let x = seededRandom(c * 19.3) * W;
    let y = seededRandom(c * 29.7) * H;
    mcCtx.lineWidth = 1.8;
    mhCtx.lineWidth = 3.2;
    mcCtx.beginPath();
    mhCtx.beginPath();
    mcCtx.moveTo(x, y);
    mhCtx.moveTo(x, y);
    for (let step = 0; step < 6; step++) {
      x += (seededRandom(c * 41 + step * 7) - 0.5) * 65;
      y += (seededRandom(c * 53 + step * 11) - 0.3) * 55;
      mcCtx.lineTo(x, y);
      mhCtx.lineTo(x, y);
    }
    mcCtx.stroke();
    mhCtx.stroke();
  }

  const ancientMuralMap = configureCanvasTexture(muralColor, true, maxAnisotropy);
  const ancientMuralNormal = createNormalMapFromHeightCanvas(muralHeight, 3.2, maxAnisotropy);
  const ancientMuralRough = configureCanvasTexture(muralRough, false, maxAnisotropy);
  const ancientMuralMetal = configureCanvasTexture(muralMetal, false, maxAnisotropy);

  // ============================================================================
  // C. GOLD HOARD (1024x1024 3D-Bumped Carpet of Coins, Ingots, Lapis Scarabs & Gems)
  // ============================================================================
  const goldColor = document.createElement('canvas');
  const goldHeight = document.createElement('canvas');
  const goldRough = document.createElement('canvas');
  const goldMetal = document.createElement('canvas');
  goldColor.width = goldHeight.width = goldRough.width = goldMetal.width = W;
  goldColor.height = goldHeight.height = goldRough.height = goldMetal.height = H;

  const gcCtx = goldColor.getContext('2d');
  const ghCtx = goldHeight.getContext('2d');
  const grCtx = goldRough.getContext('2d');
  const gmCtx = goldMetal.getContext('2d');

  gcCtx.fillStyle = '#8b6512';
  gcCtx.fillRect(0, 0, W, H);
  ghCtx.fillStyle = 'rgb(30, 30, 30)';
  ghCtx.fillRect(0, 0, W, H);
  grCtx.fillStyle = 'rgb(65, 65, 65)';
  grCtx.fillRect(0, 0, W, H);
  gmCtx.fillStyle = 'rgb(240, 240, 240)';
  gmCtx.fillRect(0, 0, W, H);

  // Draw 2200 overlapping stamped ancient gold coins, gold bars, Lapis scarabs & Carnelian beads
  for (let i = 0; i < 2200; i++) {
    const cx = seededRandom(i * 3.17) * W;
    const cy = seededRandom(i * 5.83) * H;
    const kindRoll = seededRandom(i * 11.19);
    const radius = 10 + seededRandom(i * 7.41) * 14;

    if (kindRoll < 0.84) {
      // Ancient stamped Gold Coin with conical facet normal height so point lights sparkle intensely
      const goldTones = ['#ffd859', '#f5c438', '#ffdf73', '#e2ad26'];
      gcCtx.fillStyle = goldTones[i % goldTones.length];
      gcCtx.strokeStyle = '#755208';
      gcCtx.lineWidth = 2.0;
      gcCtx.beginPath();
      gcCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      gcCtx.fill();
      gcCtx.stroke();
      // Inner pharaoh stamp ring
      gcCtx.strokeStyle = '#b58416';
      gcCtx.beginPath();
      gcCtx.arc(cx, cy, radius * 0.62, 0, Math.PI * 2);
      gcCtx.stroke();

      // Faceted radial height gradient for sharp normal-map glints
      const hGrad = ghCtx.createRadialGradient(
        cx - (seededRandom(i * 13.7) - 0.5) * radius * 0.5,
        cy - (seededRandom(i * 17.9) - 0.5) * radius * 0.5,
        1,
        cx,
        cy,
        radius
      );
      hGrad.addColorStop(0, 'rgb(255, 255, 255)');
      hGrad.addColorStop(0.7, 'rgb(190, 190, 190)');
      hGrad.addColorStop(1, 'rgb(40, 40, 40)');
      ghCtx.fillStyle = hGrad;
      ghCtx.beginPath();
      ghCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      ghCtx.fill();

      grCtx.fillStyle = 'rgb(38, 38, 38)';
      grCtx.beginPath();
      grCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      grCtx.fill();

      gmCtx.fillStyle = 'rgb(248, 248, 248)';
      gmCtx.beginPath();
      gmCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      gmCtx.fill();
    } else if (kindRoll < 0.91) {
      // Lapis Lazuli (#1367A0) Scarab Amulet
      gcCtx.fillStyle = '#1367A0';
      gcCtx.strokeStyle = '#ffd859';
      gcCtx.lineWidth = 2.5;
      gcCtx.beginPath();
      gcCtx.ellipse(cx, cy, radius * 0.85, radius * 1.15, seededRandom(i * 9.1) * Math.PI, 0, Math.PI * 2);
      gcCtx.fill();
      gcCtx.stroke();

      ghCtx.fillStyle = 'rgb(245, 245, 245)';
      ghCtx.beginPath();
      ghCtx.ellipse(cx, cy, radius * 0.85, radius * 1.15, seededRandom(i * 9.1) * Math.PI, 0, Math.PI * 2);
      ghCtx.fill();

      gmCtx.fillStyle = 'rgb(45, 45, 45)';
      gmCtx.beginPath();
      gmCtx.ellipse(cx, cy, radius * 0.8, radius * 1.1, seededRandom(i * 9.1) * Math.PI, 0, Math.PI * 2);
      gmCtx.fill();
    } else if (kindRoll < 0.97) {
      // Carnelian Red / Emerald Gem Bead
      gcCtx.fillStyle = i % 2 === 0 ? '#c92a2a' : '#12a862';
      gcCtx.strokeStyle = '#ffd859';
      gcCtx.lineWidth = 2.0;
      gcCtx.beginPath();
      gcCtx.arc(cx, cy, radius * 0.78, 0, Math.PI * 2);
      gcCtx.fill();
      gcCtx.stroke();

      ghCtx.fillStyle = 'rgb(250, 250, 250)';
      ghCtx.beginPath();
      ghCtx.arc(cx, cy, radius * 0.78, 0, Math.PI * 2);
      ghCtx.fill();
    } else {
      // Stamped Gold Bullion Bar
      const ang = seededRandom(i * 21.3) * Math.PI;
      gcCtx.save();
      gcCtx.translate(cx, cy);
      gcCtx.rotate(ang);
      gcCtx.fillStyle = '#ffdf6b';
      gcCtx.strokeStyle = '#8b6512';
      gcCtx.lineWidth = 3;
      gcCtx.fillRect(-radius * 1.6, -radius * 0.75, radius * 3.2, radius * 1.5);
      gcCtx.strokeRect(-radius * 1.6, -radius * 0.75, radius * 3.2, radius * 1.5);
      gcCtx.restore();

      ghCtx.save();
      ghCtx.translate(cx, cy);
      ghCtx.rotate(ang);
      ghCtx.fillStyle = 'rgb(252, 252, 252)';
      ghCtx.fillRect(-radius * 1.5, -radius * 0.68, radius * 3.0, radius * 1.36);
      ghCtx.restore();
    }
  }

  const goldHoardMap = configureCanvasTexture(goldColor, true, maxAnisotropy);
  const goldHoardNormal = createNormalMapFromHeightCanvas(goldHeight, 4.4, maxAnisotropy);
  const goldHoardRough = configureCanvasTexture(goldRough, false, maxAnisotropy);
  const goldHoardMetal = configureCanvasTexture(goldMetal, false, maxAnisotropy);

  // ============================================================================
  // D. LIMESTONE BLOCKS (1024x1024 Weathered Tura Limestone / Sandstone Megaliths)
  // ============================================================================
  const limeColor = document.createElement('canvas');
  const limeHeight = document.createElement('canvas');
  const limeRough = document.createElement('canvas');
  limeColor.width = limeHeight.width = limeRough.width = W;
  limeColor.height = limeHeight.height = limeRough.height = H;

  const lcCtx = limeColor.getContext('2d');
  const lhCtx = limeHeight.getContext('2d');
  const lrCtx = limeRough.getContext('2d');

  lcCtx.fillStyle = '#c8a670';
  lcCtx.fillRect(0, 0, W, H);
  lhCtx.fillStyle = 'rgb(188, 188, 188)';
  lhCtx.fillRect(0, 0, W, H);
  lrCtx.fillStyle = 'rgb(222, 222, 222)';
  lrCtx.fillRect(0, 0, W, H);

  const courses = 8;
  const courseH = H / courses;
  for (let row = 0; row < courses; row++) {
    const y0 = row * courseH;
    const blocksInRow = 4;
    const blockW = W / blocksInRow;
    const rowOffset = (row % 2) * (blockW * 0.5);

    for (let b = -1; b <= blocksInRow; b++) {
      const x0 = b * blockW + rowOffset;
      const seed = row * 17 + b * 31;
      const toneShift = Math.round((seededRandom(seed) - 0.5) * 32);
      const r = Math.min(255, Math.max(0, 204 + toneShift));
      const g = Math.min(255, Math.max(0, 166 + toneShift));
      const bl = Math.min(255, Math.max(0, 112 + toneShift));

      lcCtx.fillStyle = `rgb(${r},${g},${bl})`;
      lcCtx.fillRect(x0 + 4, y0 + 4, blockW - 8, courseH - 8);

      // Sunlit upper-left bevel chamfer & deep lower-right shadow chamfer on every megalithic block
      lcCtx.fillStyle = 'rgba(250, 228, 188, 0.52)';
      lcCtx.fillRect(x0 + 5, y0 + 5, blockW - 10, 5);
      lcCtx.fillRect(x0 + 5, y0 + 5, 5, courseH - 10);
      lcCtx.fillStyle = 'rgba(56, 36, 16, 0.62)';
      lcCtx.fillRect(x0 + 5, y0 + courseH - 10, blockW - 10, 5);
      lcCtx.fillRect(x0 + blockW - 10, y0 + 5, 5, courseH - 10);

      const hBlock = Math.round(178 + (seededRandom(seed + 5) - 0.5) * 48);
      lhCtx.fillStyle = `rgb(${hBlock},${hBlock},${hBlock})`;
      lhCtx.fillRect(x0 + 6, y0 + 6, blockW - 12, courseH - 12);

      // Raised bevel rim inside mortar seam for crisp 3D normal map edges
      lhCtx.strokeStyle = 'rgb(222, 222, 222)';
      lhCtx.lineWidth = 4;
      lhCtx.strokeRect(x0 + 5, y0 + 5, blockW - 10, courseH - 10);

      // Deep recessed mortar seam around block
      lcCtx.strokeStyle = '#3e2b16';
      lcCtx.lineWidth = 7;
      lcCtx.strokeRect(x0, y0, blockW, courseH);

      lhCtx.strokeStyle = 'rgb(14, 14, 14)';
      lhCtx.lineWidth = 9;
      lhCtx.strokeRect(x0, y0, blockW, courseH);

      lrCtx.strokeStyle = 'rgb(250, 250, 250)';
      lrCtx.lineWidth = 9;
      lrCtx.strokeRect(x0, y0, blockW, courseH);
    }
  }

  // Horizontal sedimentary strata & wind-eroded desert pitting
  for (let s = 0; s < 140; s++) {
    const sy = seededRandom(s * 6.7) * H;
    lcCtx.fillStyle = s % 2 === 0 ? 'rgba(110, 76, 40, 0.12)' : 'rgba(242, 214, 168, 0.10)';
    lcCtx.fillRect(0, sy, W, 2 + seededRandom(s * 3.1) * 4);
  }
  for (let p = 0; p < 2800; p++) {
    const px = seededRandom(p * 4.3) * W;
    const py = seededRandom(p * 8.9) * H;
    const pr = 1.5 + seededRandom(p * 2.1) * 5.8;
    lcCtx.fillStyle = p % 2 === 0 ? 'rgba(84, 58, 32, 0.25)' : 'rgba(242, 216, 172, 0.18)';
    lcCtx.beginPath();
    lcCtx.arc(px, py, pr, 0, Math.PI * 2);
    lcCtx.fill();

    lhCtx.fillStyle = p % 2 === 0 ? 'rgb(82, 82, 82)' : 'rgb(216, 216, 216)';
    lhCtx.beginPath();
    lhCtx.arc(px, py, pr * 0.85, 0, Math.PI * 2);
    lhCtx.fill();
  }

  const limestoneMap = configureCanvasTexture(limeColor, true, maxAnisotropy);
  const limestoneNormal = createNormalMapFromHeightCanvas(limeHeight, 4.4, maxAnisotropy);
  const limestoneRough = configureCanvasTexture(limeRough, false, maxAnisotropy);

  // ============================================================================
  // E. BLACK BASALT GOLD (1024x1024 Royal Black Basalt with Gold & Lapis Lotus Trim)
  // ============================================================================
  const basaltColor = document.createElement('canvas');
  const basaltHeight = document.createElement('canvas');
  const basaltRough = document.createElement('canvas');
  const basaltMetal = document.createElement('canvas');
  basaltColor.width = basaltHeight.width = basaltRough.width = basaltMetal.width = W;
  basaltColor.height = basaltHeight.height = basaltRough.height = basaltMetal.height = H;

  const bcCtx = basaltColor.getContext('2d');
  const bhCtx = basaltHeight.getContext('2d');
  const brCtx = basaltRough.getContext('2d');
  const bmCtx = basaltMetal.getContext('2d');

  bcCtx.fillStyle = '#181c22';
  bcCtx.fillRect(0, 0, W, H);
  bhCtx.fillStyle = 'rgb(150, 150, 150)';
  bhCtx.fillRect(0, 0, W, H);
  brCtx.fillStyle = 'rgb(75, 75, 75)'; // Polished royal basalt
  brCtx.fillRect(0, 0, W, H);
  bmCtx.fillStyle = 'rgb(30, 30, 30)';
  bmCtx.fillRect(0, 0, W, H);

  // 4x4 Royal Basalt Tiles with Gold-Leaf & Lapis Lazuli (#1367A0) Lotus Corner Inlays
  const tileN = 4;
  const tileS = W / tileN;
  for (let ty = 0; ty < tileN; ty++) {
    for (let tx = 0; tx < tileN; tx++) {
      const x0 = tx * tileS;
      const y0 = ty * tileS;

      // Recessed joint
      bhCtx.strokeStyle = 'rgb(30, 30, 30)';
      bhCtx.lineWidth = 6;
      bhCtx.strokeRect(x0, y0, tileS, tileS);

      // Gold-leaf double border inlay
      bcCtx.strokeStyle = '#d4af37';
      bcCtx.lineWidth = 5;
      bcCtx.strokeRect(x0 + 14, y0 + 14, tileS - 28, tileS - 28);

      bhCtx.strokeStyle = 'rgb(225, 225, 225)';
      bhCtx.lineWidth = 5;
      bhCtx.strokeRect(x0 + 14, y0 + 14, tileS - 28, tileS - 28);

      bmCtx.strokeStyle = 'rgb(240, 240, 240)';
      bmCtx.lineWidth = 5;
      bmCtx.strokeRect(x0 + 14, y0 + 14, tileS - 28, tileS - 28);

      brCtx.strokeStyle = 'rgb(40, 40, 40)';
      brCtx.lineWidth = 5;
      brCtx.strokeRect(x0 + 14, y0 + 14, tileS - 28, tileS - 28);

      // Central Lapis & Gold Lotus Rosette
      const rcx = x0 + tileS * 0.5;
      const rcy = y0 + tileS * 0.5;
      for (let petal = 0; petal < 8; petal++) {
        const ang = (petal / 8) * Math.PI * 2;
        bcCtx.save();
        bcCtx.translate(rcx, rcy);
        bcCtx.rotate(ang);
        bcCtx.fillStyle = petal % 2 === 0 ? '#1367A0' : '#d4af37';
        bcCtx.beginPath();
        bcCtx.ellipse(0, -tileS * 0.16, tileS * 0.045, tileS * 0.12, 0, 0, Math.PI * 2);
        bcCtx.fill();
        bcCtx.restore();

        if (petal % 2 === 1) {
          bmCtx.save();
          bmCtx.translate(rcx, rcy);
          bmCtx.rotate(ang);
          bmCtx.fillStyle = 'rgb(235, 235, 235)';
          bmCtx.beginPath();
          bmCtx.ellipse(0, -tileS * 0.16, tileS * 0.045, tileS * 0.12, 0, 0, Math.PI * 2);
          bmCtx.fill();
          bmCtx.restore();
        }
      }
    }
  }

  const blackBasaltMap = configureCanvasTexture(basaltColor, true, maxAnisotropy);
  const blackBasaltNormal = createNormalMapFromHeightCanvas(basaltHeight, 3.0, maxAnisotropy);
  const blackBasaltRough = configureCanvasTexture(basaltRough, false, maxAnisotropy);
  const blackBasaltMetal = configureCanvasTexture(basaltMetal, false, maxAnisotropy);

  // ============================================================================
  // F. STARRY DUAT CEILING (Deep Lapis #0b2d48 / #1367A0 with Golden 5-Pointed Stars)
  // ============================================================================
  const starColor = document.createElement('canvas');
  const starEmissive = document.createElement('canvas');
  starColor.width = starEmissive.width = 512;
  starColor.height = starEmissive.height = 512;
  const scCtx = starColor.getContext('2d');
  const seCtx = starEmissive.getContext('2d');

  scCtx.fillStyle = '#0b2d48';
  scCtx.fillRect(0, 0, 512, 512);
  seCtx.fillStyle = '#000000';
  seCtx.fillRect(0, 0, 512, 512);

  // Border bands
  scCtx.fillStyle = '#1367A0';
  scCtx.fillRect(0, 0, 512, 24);
  scCtx.fillRect(0, 488, 512, 24);
  scCtx.fillStyle = '#d4af37';
  scCtx.fillRect(0, 24, 512, 6);
  scCtx.fillRect(0, 482, 512, 6);

  const starGrid = 6;
  const cell = 440 / starGrid;
  for (let sy = 0; sy < starGrid; sy++) {
    for (let sx = 0; sx < starGrid; sx++) {
      const cx = 36 + (sx + 0.5) * cell;
      const cy = 36 + (sy + 0.5) * cell;
      for (const ctx of [scCtx, seCtx]) {
        ctx.fillStyle = ctx === scCtx ? '#ffd859' : '#8a6418';
        ctx.beginPath();
        for (let p = 0; p < 5; p++) {
          const a1 = (p * 2 * Math.PI) / 5 - Math.PI / 2;
          const a2 = a1 + Math.PI / 5;
          ctx.lineTo(cx + Math.cos(a1) * 18, cy + Math.sin(a1) * 18);
          ctx.lineTo(cx + Math.cos(a2) * 6, cy + Math.sin(a2) * 6);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  const starryCeilingMap = configureCanvasTexture(starColor, true, maxAnisotropy);
  const starryCeilingEmissive = configureCanvasTexture(starEmissive, true, maxAnisotropy);

  // Asynchronously load PolyHaven 1K sandstone_blocks_04 maps and composite real photogrammetry stone detail
  let polyhavenDiff = null;
  let polyhavenNor = null;
  let polyhavenRough = null;
  if (typeof window !== 'undefined') {
    const loader = new THREE.TextureLoader();
    const setupPH = (url, isSrgb, onLoadCb) => {
      const t = loader.load(url, onLoadCb, undefined, () => {});
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAnisotropy;
      return t;
    };
    polyhavenDiff = setupPH('/textures/polyhaven/sandstone_blocks_04/sandstone_blocks_04_diff_1k.jpg', true, (tex) => {
      const img = tex?.image;
      if (!img) return;
      // Blend real PolyHaven sandstone photogrammetry grain onto our megalithic limestone, hieroglyph, and mural maps
      lcCtx.save();
      lcCtx.globalAlpha = 0.42;
      lcCtx.globalCompositeOperation = 'multiply';
      lcCtx.drawImage(img, 0, 0, W, H);
      lcCtx.restore();
      limestoneMap.needsUpdate = true;

      hcCtx.save();
      hcCtx.globalAlpha = 0.34;
      hcCtx.globalCompositeOperation = 'multiply';
      hcCtx.drawImage(img, 0, 0, W, H);
      hcCtx.restore();
      hieroglyphMap.needsUpdate = true;

      mcCtx.save();
      mcCtx.globalAlpha = 0.24;
      mcCtx.globalCompositeOperation = 'multiply';
      mcCtx.drawImage(img, 0, 0, W, H);
      mcCtx.restore();
      ancientMuralMap.needsUpdate = true;
    });
    polyhavenNor = setupPH('/textures/polyhaven/sandstone_blocks_04/sandstone_blocks_04_nor_gl_1k.jpg', false);
    polyhavenRough = setupPH('/textures/polyhaven/sandstone_blocks_04/sandstone_blocks_04_rough_1k.jpg', false);
  }

  // Construct shared PBR materials (Assassin's Creed Origins chiseled stone realism: strong normalScale, low emissive wash)
  const hieroglyphMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianHieroglyphRelief',
    map: hieroglyphMap,
    normalMap: hieroglyphNormal,
    normalScale: new THREE.Vector2(2.45, 2.45),
    roughnessMap: hieroglyphRough,
    metalnessMap: hieroglyphMetal,
    emissiveMap: hieroglyphMap,
    emissive: new THREE.Color(0xc88b3a),
    emissiveIntensity: 0.06,
    roughness: 0.84,
    metalness: 0.16,
  });

  const ancientMuralMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianAncientMural',
    map: ancientMuralMap,
    normalMap: ancientMuralNormal,
    normalScale: new THREE.Vector2(1.95, 1.95),
    roughnessMap: ancientMuralRough,
    metalnessMap: ancientMuralMetal,
    emissiveMap: ancientMuralMap,
    emissive: new THREE.Color(0xd89e48),
    emissiveIntensity: 0.08,
    roughness: 0.76,
    metalness: 0.22,
  });

  const goldHoardMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianGoldHoard',
    map: goldHoardMap,
    normalMap: goldHoardNormal,
    normalScale: new THREE.Vector2(2.25, 2.25),
    roughnessMap: goldHoardRough,
    metalnessMap: goldHoardMetal,
    emissiveMap: goldHoardMap,
    roughness: 0.14,
    metalness: 0.96,
    emissive: new THREE.Color(0xffc438),
    emissiveIntensity: 0.36,
  });

  const limestoneMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianLimestoneBlocks',
    color: 0xd8b47c,
    map: limestoneMap,
    normalMap: limestoneNormal,
    normalScale: new THREE.Vector2(2.55, 2.55),
    roughnessMap: polyhavenRough || limestoneRough,
    emissiveMap: limestoneMap,
    emissive: new THREE.Color(0xb8843c),
    emissiveIntensity: 0.04,
    roughness: 0.88,
    metalness: 0.05,
  });

  // Smooth royal Tura limestone casing material (for Khafre-style upper pyramid casing mantle & temple cornices)
  const casingLimestoneMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianTuraCasingLimestone',
    color: 0xe8cfa0,
    map: limestoneMap,
    normalMap: polyhavenNor || limestoneNormal,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughnessMap: polyhavenRough || limestoneRough,
    emissive: new THREE.Color(0xc89a52),
    emissiveIntensity: 0.05,
    roughness: 0.64,
    metalness: 0.08,
  });

  const blackBasaltGoldMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianBlackBasaltGold',
    map: blackBasaltMap,
    normalMap: blackBasaltNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: blackBasaltRough,
    metalnessMap: blackBasaltMetal,
    roughness: 0.34,
    metalness: 0.65,
  });

  const starryCeilingMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianStarryDuatCeiling',
    map: starryCeilingMap,
    emissiveMap: starryCeilingEmissive,
    emissive: new THREE.Color(0xffd268),
    emissiveIntensity: 0.55,
    roughness: 0.72,
    metalness: 0.25,
  });

  const solidGoldMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianSolidGold',
    color: 0xffcf48,
    normalMap: hieroglyphNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.16,
    metalness: 0.96,
    emissive: 0x3b2705,
    emissiveIntensity: 0.20,
  });

  const electrumCapMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianElectrumPyramidion',
    color: 0xffe27a,
    normalMap: limestoneNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.14,
    metalness: 0.98,
    emissive: 0x6a4810,
    emissiveIntensity: 0.34,
  });

  const lapisMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianLapisLazuli',
    color: 0x1367a0,
    roughness: 0.28,
    metalness: 0.24,
  });

  const carnelianMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianCarnelian',
    color: 0xc4421e,
    roughness: 0.22,
    metalness: 0.18,
  });

  const emeraldMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianEmerald',
    color: 0x12a862,
    roughness: 0.18,
    metalness: 0.2,
    emissive: 0x05381e,
    emissiveIntensity: 0.35,
  });

  const redGraniteMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianAswanRedGranite',
    color: 0x9c482e,
    map: hieroglyphMap,
    normalMap: hieroglyphNormal,
    normalScale: new THREE.Vector2(2.1, 2.1),
    roughness: 0.48,
    metalness: 0.16,
  });

  // Tiled PolyHaven Desert Sand Dune PBR Material (28x28 tiling across the 540m Giza plateau)
  let desertSandDiff = limestoneMap.clone();
  let desertSandNor = limestoneNormal.clone();
  let desertSandRough = limestoneRough.clone();
  if (typeof window !== 'undefined') {
    const loader = new THREE.TextureLoader();
    const setupTiled = (url, isSrgb) => {
      const t = loader.load(url, undefined, undefined, () => {});
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(28, 28);
      t.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAnisotropy;
      return t;
    };
    desertSandDiff = setupTiled('/textures/polyhaven/aerial_beach_01_diff_1k.jpg', true);
    desertSandNor = setupTiled('/textures/polyhaven/sandstone_blocks_04/sandstone_blocks_04_nor_gl_1k.jpg', false);
    desertSandRough = setupTiled('/textures/polyhaven/aerial_beach_01_rough_1k.jpg', false);
  }

  const desertSandMaterial = new THREE.MeshStandardMaterial({
    name: 'EgyptianGizaDesertSand',
    color: 0xd69a5c,
    map: desertSandDiff,
    normalMap: desertSandNor,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: desertSandRough,
    roughness: 0.88,
    metalness: 0.04,
  });

  _cachedTextureSuite = {
    hieroglyphRelief: {
      map: hieroglyphMap,
      normalMap: hieroglyphNormal,
      roughnessMap: hieroglyphRough,
      metalnessMap: hieroglyphMetal,
      material: hieroglyphMaterial,
    },
    ancientMural: {
      map: ancientMuralMap,
      normalMap: ancientMuralNormal,
      roughnessMap: ancientMuralRough,
      metalnessMap: ancientMuralMetal,
      material: ancientMuralMaterial,
    },
    goldHoard: {
      map: goldHoardMap,
      normalMap: goldHoardNormal,
      roughnessMap: goldHoardRough,
      metalnessMap: goldHoardMetal,
      material: goldHoardMaterial,
    },
    limestoneBlocks: {
      map: limestoneMap,
      normalMap: limestoneNormal,
      roughnessMap: limestoneRough,
      polyhavenDiff,
      polyhavenNor,
      polyhavenRough,
      material: limestoneMaterial,
    },
    blackBasaltGold: {
      map: blackBasaltMap,
      normalMap: blackBasaltNormal,
      roughnessMap: blackBasaltRough,
      metalnessMap: blackBasaltMetal,
      material: blackBasaltGoldMaterial,
    },
    starryCeiling: {
      map: starryCeilingMap,
      emissiveMap: starryCeilingEmissive,
      material: starryCeilingMaterial,
    },
    materials: {
      hieroglyphRelief: hieroglyphMaterial,
      ancientMural: ancientMuralMaterial,
      goldHoard: goldHoardMaterial,
      limestoneBlocks: limestoneMaterial,
      casingLimestone: casingLimestoneMaterial,
      blackBasaltGold: blackBasaltGoldMaterial,
      starryCeiling: starryCeilingMaterial,
      solidGold: solidGoldMaterial,
      electrumCap: electrumCapMaterial,
      lapisLazuli: lapisMaterial,
      carnelian: carnelianMaterial,
      emerald: emeraldMaterial,
      redGranite: redGraniteMaterial,
      desertSand: desertSandMaterial,
    },
  };

  return _cachedTextureSuite;
}

/**
 * Helper to build a Winged Solar Disc (Behdety) architectural lintel plaque.
 */
function buildWingedSolarDiscPlaque(width = 4.6, height = 1.1) {
  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();

  // Cavetto cornice stone backing with world-space UVs
  const corniceGeo = applyWorldSpaceBoxUVs(new THREE.BoxGeometry(width, height, 0.55), 0.16, 1.0, true);
  const cornice = new THREE.Mesh(corniceGeo, suite.materials.ancientMural);
  cornice.castShadow = true;
  cornice.receiveShadow = true;
  group.add(cornice);

  // Gold torus molding bar below cornice
  const torus = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, width * 1.02, 12),
    suite.materials.solidGold
  );
  torus.rotation.z = Math.PI / 2;
  torus.position.set(0, -height * 0.48, 0.26);
  group.add(torus);

  // Central Carnelian/Gold Solar Disc
  const disc = new THREE.Mesh(
    new THREE.SphereGeometry(height * 0.34, 16, 12),
    suite.materials.solidGold
  );
  disc.scale.set(1, 1, 0.45);
  disc.position.set(0, 0, 0.28);
  group.add(disc);

  // Outstretched Lapis & Gold Wings
  for (const side of [-1, 1]) {
    const wingOuter = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.4, height * 0.44, 0.14),
      suite.materials.lapisLazuli
    );
    wingOuter.position.set(side * width * 0.24, 0.04, 0.24);
    wingOuter.rotation.z = side * -0.06;
    group.add(wingOuter);

    const wingGoldTrim = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.38, height * 0.16, 0.18),
      suite.materials.solidGold
    );
    wingGoldTrim.position.set(side * width * 0.23, 0.18, 0.26);
    wingGoldTrim.rotation.z = side * -0.06;
    group.add(wingGoldTrim);
  }

  return group;
}

/**
 * 2. Builds a colossal, Assassin's Creed Origins-grade Egyptian Great Pyramid (`baseWidth = 90..160`, `height = 65..115`).
 *    Features:
 *    - 36 finely-stepped megalithic core stone courses with world-space UVs (no texture stretching),
 *    - Khafre-style preserved smooth Tura limestone upper casing mantle below the gleaming Electrum Pyramidion,
 *    - Stepped corner bastion megaliths and weathered lower hieroglyphic plinth courses,
 *    - Monumental North Entrance Megalithic Double-Chevron Relieving Gable & Battered Pylon Temple Forecourt.
 */
export function buildMonumentalPyramid(options = {}) {
  const {
    baseWidth = 124,
    height = 88,
    tiers = 34,
    hasEntrancePortal = true,
    hasSubsidiaryPyramids = false,
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'MonumentalGreatPyramid';

  // 1. Megalithic Paved Foundation Apron & Corner Bastion Blocks
  const apronGeo = applyWorldSpaceBoxUVs(new THREE.BoxGeometry(baseWidth * 1.05, 1.8, baseWidth * 1.05), 0.12, 0.22);
  const apronMesh = new THREE.Mesh(apronGeo, suite.materials.limestoneBlocks);
  apronMesh.position.y = 0.9;
  apronMesh.receiveShadow = true;
  group.add(apronMesh);

  // 2. Finely-stepped Megalithic Core Courses (with world-space masonry UVs so every block is properly proportioned)
  const capstoneRatio = 0.11;
  const steppedH = height * (1.0 - capstoneRatio);
  const actualTiers = Math.max(12, tiers);
  const tierH = steppedH / actualTiers;

  for (let i = 0; i < actualTiers; i++) {
    const frac = i / actualTiers;
    const tierW = baseWidth * (1.0 - frac * (1.0 - capstoneRatio));
    const tierGeo = applyWorldSpaceBoxUVs(
      new THREE.BoxGeometry(tierW, tierH * 0.98, tierW),
      0.14,
      0.24
    );
    // Lower 2 courses have carved royal hieroglyph cartouche reliefs; upper courses expose weathered megalithic limestone
    const tierMat = i < 2
      ? suite.materials.hieroglyphRelief
      : i >= actualTiers - 7
      ? suite.materials.casingLimestone
      : suite.materials.limestoneBlocks;
    const tierMesh = new THREE.Mesh(tierGeo, tierMat);
    tierMesh.position.y = (i + 0.5) * tierH;
    tierMesh.castShadow = true;
    tierMesh.receiveShadow = true;
    group.add(tierMesh);
  }

  // 3. Khafre-style Preserved Smooth Tura Limestone Upper Casing Mantle (covering the upper section below the Pyramidion)
  const mantleRatio = 0.30;
  const mantleBottomW = baseWidth * mantleRatio * 1.028;
  const mantleTopW = baseWidth * capstoneRatio * 1.025;
  const mantleH = height * (mantleRatio - capstoneRatio);
  let mantleGeo = new THREE.CylinderGeometry(
    mantleTopW / Math.SQRT2,
    mantleBottomW / Math.SQRT2,
    mantleH,
    4,
    1
  );
  mantleGeo.rotateY(Math.PI / 4);
  mantleGeo = mantleGeo.toNonIndexed();
  mantleGeo.computeVertexNormals();
  applyWorldSpaceBoxUVs(mantleGeo, 0.14, 0.20);
  const mantleMesh = new THREE.Mesh(mantleGeo, suite.materials.casingLimestone);
  mantleMesh.position.y = height * (1.0 - mantleRatio) + mantleH * 0.5;
  mantleMesh.castShadow = true;
  mantleMesh.receiveShadow = true;
  group.add(mantleMesh);

  // Jagged stepped broken lower edge of the Tura limestone casing mantle (Assassin's Creed Origins Khafre detail)
  const brokenCasingY = height * (1.0 - mantleRatio);
  for (let face = 0; face < 4; face++) {
    const faceAngle = (face * Math.PI) / 2;
    for (let k = -2; k <= 2; k++) {
      const blockW = mantleBottomW * 0.16;
      const dropH = (1 + ((face + Math.abs(k)) % 2)) * tierH * 1.15;
      const casingFragmentGeo = applyWorldSpaceBoxUVs(
        new THREE.BoxGeometry(blockW, dropH, tierH * 1.5),
        0.16,
        0.24
      );
      const frag = new THREE.Mesh(casingFragmentGeo, suite.materials.casingLimestone);
      const dist = mantleBottomW * 0.49;
      const lat = k * blockW * 0.92;
      frag.position.set(
        Math.sin(faceAngle) * dist + Math.cos(faceAngle) * lat,
        brokenCasingY - dropH * 0.42,
        Math.cos(faceAngle) * dist - Math.sin(faceAngle) * lat
      );
      frag.rotation.y = faceAngle;
      frag.castShadow = true;
      frag.receiveShadow = true;
      group.add(frag);
    }
  }

  // 4. Authentic Gleaming Gold/Electrum Pyramidion Capstone at the Apex (crisp flat-faceted 4-sided pyramidion)
  const capBaseW = baseWidth * capstoneRatio * 1.045;
  const capH = height * capstoneRatio * 1.08;
  let capGeo = new THREE.ConeGeometry(capBaseW / Math.SQRT2, capH, 4, 1);
  capGeo.rotateY(Math.PI / 4);
  capGeo = capGeo.toNonIndexed();
  capGeo.computeVertexNormals();
  const pyramidion = new THREE.Mesh(capGeo, suite.materials.electrumCap);
  pyramidion.position.y = steppedH + capH * 0.48;
  pyramidion.castShadow = true;
  group.add(pyramidion);

  // Royal Black Basalt & Gold Hieroglyphic Collar Band right below the Electrum Pyramidion
  const collarW = capBaseW * 1.02;
  const collarGeo = applyWorldSpaceBoxUVs(
    new THREE.BoxGeometry(collarW, tierH * 0.65, collarW),
    0.18,
    0.25
  );
  const collarMesh = new THREE.Mesh(collarGeo, suite.materials.blackBasaltGold);
  collarMesh.position.y = steppedH - tierH * 0.12;
  group.add(collarMesh);

  // 5. Monumental North Entrance Megalithic Chevron Gable & Battered Pylon Temple Forecourt
  if (hasEntrancePortal) {
    const portalGroup = new THREE.Group();
    portalGroup.position.set(0, 0, baseWidth * 0.5 + 0.4);

    const portalW = 11.2;
    const portalH = 9.8;
    const portalDepth = 7.4;

    // Massive Flanking Battered Pylon Towers with world-space chiseled hieroglyph UVs
    for (const side of [-1, 1]) {
      const pylonGeo = applyWorldSpaceBoxUVs(
        new THREE.BoxGeometry(4.8, portalH + 3.2, portalDepth),
        0.16,
        0.20
      );
      const pylon = new THREE.Mesh(pylonGeo, suite.materials.hieroglyphRelief);
      pylon.position.set(side * (portalW * 0.5 + 2.0), (portalH + 3.2) * 0.5, 0);
      pylon.rotation.z = side * 0.055; // Authentic Egyptian battered pylon slope
      pylon.castShadow = true;
      pylon.receiveShadow = true;
      portalGroup.add(pylon);

      // Pylon Cavetto Cornice Cap
      const capCorniceGeo = applyWorldSpaceBoxUVs(
        new THREE.BoxGeometry(5.3, 0.85, portalDepth + 0.5),
        0.16,
        0.22
      );
      const capCornice = new THREE.Mesh(capCorniceGeo, suite.materials.casingLimestone);
      capCornice.position.set(side * (portalW * 0.5 + 1.65), portalH + 3.4, 0);
      portalGroup.add(capCornice);
    }

    // Winged Solar Disc Lintel
    const lintel = buildWingedSolarDiscPlaque(portalW + 6.2, 2.2);
    lintel.position.set(0, portalH + 0.95, portalDepth * 0.35);
    portalGroup.add(lintel);

    // Khufu-style Megalithic Double Chevron Relieving Gable Blocks above the lintel
    for (let row = 0; row < 2; row++) {
      for (const side of [-1, 1]) {
        const chevronGeo = applyWorldSpaceBoxUVs(
          new THREE.BoxGeometry(7.2, 1.75, 3.6),
          0.16,
          0.24
        );
        const chevronBlock = new THREE.Mesh(chevronGeo, suite.materials.casingLimestone);
        chevronBlock.position.set(side * 2.65, portalH + 3.6 + row * 1.75, 0.9);
        chevronBlock.rotation.z = side * -0.52;
        chevronBlock.castShadow = true;
        chevronBlock.receiveShadow = true;
        portalGroup.add(chevronBlock);
      }
    }

    group.add(portalGroup);
  }

  // Optional flanking ruined subsidiary Queen Pyramids
  if (hasSubsidiaryPyramids) {
    for (const side of [-1, 1]) {
      const subW = baseWidth * 0.26;
      const subH = height * 0.25;
      const subPyr = buildMonumentalPyramid({
        baseWidth: subW,
        height: subH,
        tiers: 14,
        hasEntrancePortal: false,
        hasSubsidiaryPyramids: false,
      });
      subPyr.position.set(side * (baseWidth * 0.72), 0, baseWidth * 0.22);
      group.add(subPyr);
    }
  }

  return group;
}

/**
 * 3. Builds a monumental sitting Jackal-headed Anubis Guardian Colossus / Sphinx (`height = 8..16m`)
 *    carved from weathered sandstone & black granite with a golden Nemes headdress, glowing golden eyes,
 *    and a hieroglyph-inscribed plinth holding an Ankh / Was-scepter.
 */
export function buildGreatSphinxOrAnubisColossus(options = {}) {
  const {
    variant = 'anubis', // 'anubis' | 'sphinx'
    height = 11.0,
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = variant === 'sphinx' ? 'GreatSphinxColossus' : 'AnubisGuardianColossus';

  const scale = height / 11.0;
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  group.add(root);

  const blackGraniteMat = suite.materials.blackBasaltGold;
  const sandstoneMat = suite.materials.limestoneBlocks;
  const bodyMat = variant === 'anubis' ? blackGraniteMat : sandstoneMat;
  const goldMat = suite.materials.solidGold;
  const lapisMat = suite.materials.lapisLazuli;

  // 1. Hieroglyph-inscribed Megalithic Plinth (0 -> 2.1m)
  const plinthBase = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(4.4, 1.5, 7.6), 0.20, 0.30),
    suite.materials.hieroglyphRelief
  );
  plinthBase.position.y = 0.75;
  plinthBase.castShadow = true;
  plinthBase.receiveShadow = true;
  root.add(plinthBase);

  const plinthCornice = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(4.65, 0.38, 7.85), 0.22, 0.32),
    blackGraniteMat
  );
  plinthCornice.position.y = 1.68;
  plinthCornice.castShadow = true;
  plinthCornice.receiveShadow = true;
  root.add(plinthCornice);

  // 2. Extended Forepaws & Claws resting on the plinth
  for (const side of [-1, 1]) {
    const foreleg = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(0.82, 0.75, 3.4), 0.24, 0.28),
      bodyMat
    );
    foreleg.position.set(side * 1.15, 2.22, 1.75);
    foreleg.castShadow = true;
    foreleg.receiveShadow = true;
    root.add(foreleg);

    const paw = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.58, 1.15),
      goldMat
    );
    paw.position.set(side * 1.15, 2.15, 3.35);
    paw.castShadow = true;
    root.add(paw);
  }

  // Haunches & Couchant/Seated Torso
  const haunches = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(3.2, 2.2, 3.8), 0.22, 0.26),
    bodyMat
  );
  haunches.position.set(0, 2.9, -1.05);
  haunches.castShadow = true;
  haunches.receiveShadow = true;
  root.add(haunches);

  const chest = new THREE.Mesh(
    new THREE.CylinderGeometry(1.38, 1.58, 3.8, 16),
    bodyMat
  );
  chest.position.set(0, 5.1, 0.15);
  chest.rotation.x = 0.12;
  chest.castShadow = true;
  chest.receiveShadow = true;
  root.add(chest);

  // Broad Golden Usekh Collar with Lapis Lazuli inlay around the chest
  const collarGold = new THREE.Mesh(
    new THREE.CylinderGeometry(1.52, 1.72, 0.68, 16),
    goldMat
  );
  collarGold.position.set(0, 6.65, 0.32);
  collarGold.rotation.x = 0.18;
  root.add(collarGold);

  const collarLapis = new THREE.Mesh(
    new THREE.CylinderGeometry(1.56, 1.66, 0.28, 16),
    lapisMat
  );
  collarLapis.position.set(0, 6.65, 0.34);
  collarLapis.rotation.x = 0.18;
  root.add(collarLapis);

  // 3. Iconic Striped Gold-and-Lapis Nemes Headdress
  const nemesHood = new THREE.Mesh(
    new THREE.ConeGeometry(1.85, 2.6, 12),
    lapisMat
  );
  nemesHood.position.set(0, 8.15, 0.18);
  nemesHood.scale.set(1.15, 1.0, 0.92);
  nemesHood.castShadow = true;
  root.add(nemesHood);

  // Nemes Lappets hanging down either side of the chest
  for (const side of [-1, 1]) {
    const lappet = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 2.35, 0.48),
      goldMat
    );
    lappet.position.set(side * 1.12, 6.95, 0.85);
    lappet.rotation.z = side * -0.08;
    root.add(lappet);
  }

  // Head & Snout
  const cranium = new THREE.Mesh(
    new THREE.SphereGeometry(1.08, 16, 14),
    bodyMat
  );
  cranium.position.set(0, 8.05, 0.55);
  root.add(cranium);

  if (variant === 'anubis') {
    // Elongated regal Jackal Snout
    const snout = new THREE.Mesh(
      new THREE.ConeGeometry(0.58, 2.15, 8),
      blackGraniteMat
    );
    snout.rotation.x = Math.PI / 2 + 0.12;
    snout.position.set(0, 7.92, 1.85);
    snout.castShadow = true;
    root.add(snout);

    // Tall pointed Anubis Jackal Ears edged in Gold
    for (const side of [-1, 1]) {
      const earOuter = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 2.15, 6),
        blackGraniteMat
      );
      earOuter.position.set(side * 0.62, 9.85, 0.38);
      earOuter.rotation.z = side * -0.08;
      earOuter.rotation.x = 0.12;
      earOuter.castShadow = true;
      root.add(earOuter);

      const earGoldInner = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 1.75, 6),
        goldMat
      );
      earGoldInner.position.set(side * 0.62, 9.78, 0.48);
      earGoldInner.rotation.z = side * -0.08;
      earGoldInner.rotation.x = 0.12;
      root.add(earGoldInner);
    }
  } else {
    // Pharaoh Sphinx Face + Braided Divine Beard + Uraeus Cobra
    const beard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.12, 1.35, 10),
      goldMat
    );
    beard.position.set(0, 6.95, 1.35);
    beard.rotation.x = 0.25;
    root.add(beard);
  }

  // Golden Uraeus Cobra on the brow
  const uraeus = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.08, 8, 16, Math.PI * 1.3),
    goldMat
  );
  uraeus.position.set(0, 8.85, 1.38);
  root.add(uraeus);

  // Glowing Golden Eyes of Anubis/Sphinx
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xffe066,
    emissive: 0xffa818,
    emissiveIntensity: 3.4,
    roughness: 0.1,
  });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), eyeMat);
    eye.scale.set(1.4, 0.65, 0.8);
    eye.position.set(side * 0.45, 8.22, 1.35);
    root.add(eye);
  }

  // 4. Towering Golden Was-Scepter & Ankh held between the forepaws
  const scepterShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 7.8, 10),
    goldMat
  );
  scepterShaft.position.set(0, 5.6, 2.65);
  scepterShaft.castShadow = true;
  root.add(scepterShaft);

  const ankhLoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.12, 10, 20),
    goldMat
  );
  ankhLoop.scale.set(0.78, 1.15, 1.0);
  ankhLoop.position.set(0, 9.85, 2.65);
  root.add(ankhLoop);

  const ankhCrossbar = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.22, 0.22),
    goldMat
  );
  ankhCrossbar.position.set(0, 9.12, 2.65);
  root.add(ankhCrossbar);

  return group;
}

/**
 * 4. Builds a towering tapered red-granite / sandstone Pharaonic Obelisk (`height = 7..14m`)
 *    with sunken-relief hieroglyphic cartouches down all four faces and a gilded Pyramidion tip.
 */
export function buildHieroglyphObelisk(options = {}) {
  const {
    height = 10.8,
    baseWidth = 1.38,
    broken = false,
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'PharaonicHieroglyphObelisk';

  // Stepped Basalt & Limestone Pedestal
  const pedH = height * 0.16;
  const ped1 = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(baseWidth * 1.65, pedH * 0.48, baseWidth * 1.65), 0.22, 0.30),
    suite.materials.blackBasaltGold
  );
  ped1.position.y = pedH * 0.24;
  ped1.castShadow = true;
  ped1.receiveShadow = true;
  group.add(ped1);

  const ped2 = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(baseWidth * 1.32, pedH * 0.56, baseWidth * 1.32), 0.22, 0.30),
    suite.materials.hieroglyphRelief
  );
  ped2.position.y = pedH * 0.74;
  ped2.castShadow = true;
  ped2.receiveShadow = true;
  group.add(ped2);

  // Tapered Monolithic Shaft with Sunken-Relief Hieroglyphs on all 4 faces
  const shaftH = broken ? height * 0.48 : height * 0.72;
  const rBottom = (baseWidth * 0.96) / Math.SQRT2;
  const rTop = (baseWidth * 0.62) / Math.SQRT2;
  let shaftGeo = new THREE.CylinderGeometry(rTop, rBottom, shaftH, 4, 1);
  shaftGeo.rotateY(Math.PI / 4);
  shaftGeo = shaftGeo.toNonIndexed();
  shaftGeo.computeVertexNormals();
  applyWorldSpaceBoxUVs(shaftGeo, 0.22, 0.22);

  const shaftMesh = new THREE.Mesh(shaftGeo, suite.materials.redGranite);
  shaftMesh.position.y = pedH + shaftH * 0.5;
  shaftMesh.castShadow = true;
  shaftMesh.receiveShadow = true;
  group.add(shaftMesh);

  // Golden & Lapis Vertical Cartouche Framing Strips on the 4 faces
  const stripH = shaftH * 0.88;
  for (let face = 0; face < 4; face++) {
    const ang = (face * Math.PI) / 2;
    const faceGroup = new THREE.Group();
    faceGroup.rotation.y = ang;
    const midOffset = baseWidth * 0.39;
    const plaque = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(baseWidth * 0.42, stripH, 0.06), 0.26, 0.22),
      suite.materials.hieroglyphRelief
    );
    plaque.position.set(0, pedH + shaftH * 0.5, midOffset);
    faceGroup.add(plaque);
    group.add(faceGroup);
  }

  // Gilded Electrum Pyramidion Tip (flat-faceted 4-sided pyramidion)
  const capH = height * 0.14;
  let capGeo = new THREE.ConeGeometry(rTop * 1.03, capH, 4, 1);
  capGeo.rotateY(Math.PI / 4);
  capGeo = capGeo.toNonIndexed();
  capGeo.computeVertexNormals();
  const capMesh = new THREE.Mesh(capGeo, suite.materials.electrumCap);
  if (broken) {
    capMesh.position.set(baseWidth * 1.4, capH * 0.38, baseWidth * 0.8);
    capMesh.rotation.z = 0.42;
  } else {
    capMesh.position.y = pedH + shaftH + capH * 0.5;
  }
  capMesh.castShadow = true;
  group.add(capMesh);

  return group;
}

/**
 * 5. Builds an authentic Karnak/Luxor-style Papyrus / Lotus Bundle Hypostyle Column (`height = 6..10m`, `radius = 0.7..1.1m`)
 *    with a flared lotus-petal capital, polychrome mural bands (`#1367A0` lapis, gold, carnelian),
 *    hieroglyphic shaft inscriptions, and a carved circular plinth.
 */
export function buildLotusHypostyleColumn(options = {}) {
  const {
    height = 7.8,
    radius = 0.88,
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'LotusHypostyleColumn';

  // 1. Carved Circular Cushion Plinth
  const plinthH = height * 0.09;
  const plinthMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.24, radius * 1.38, plinthH, 16),
    suite.materials.blackBasaltGold
  );
  plinthMesh.position.y = plinthH * 0.5;
  plinthMesh.castShadow = true;
  plinthMesh.receiveShadow = true;
  group.add(plinthMesh);

  // Lower Lotus-Leaf Base Collar
  const collarH = height * 0.08;
  const baseCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.02, radius * 1.18, collarH, 12),
    suite.materials.ancientMural
  );
  baseCollar.position.y = plinthH + collarH * 0.5;
  baseCollar.castShadow = true;
  group.add(baseCollar);

  // 2. Main Hieroglyphic & Polychrome Shaft
  const shaftH = height * 0.64;
  const shaftMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.88, radius * 1.02, shaftH, 16),
    suite.materials.hieroglyphRelief
  );
  shaftMesh.position.y = plinthH + collarH + shaftH * 0.5;
  shaftMesh.castShadow = true;
  shaftMesh.receiveShadow = true;
  group.add(shaftMesh);

  // Five Horizontal Binding Cord Bands in Gold & Lapis (#1367A0) below the capital
  const neckY = plinthH + collarH + shaftH;
  for (let b = 0; b < 4; b++) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.9, radius * 0.045, 8, 20),
      b % 2 === 0 ? suite.materials.solidGold : suite.materials.lapisLazuli
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = neckY - 0.14 - b * 0.12;
    group.add(band);
  }

  // 3. Flared Karnak Open-Lotus / Papyrus Bell Capital
  const capH = height * 0.15;
  const bellMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.56, radius * 0.86, capH, 16),
    suite.materials.ancientMural
  );
  bellMesh.position.y = neckY + capH * 0.5;
  bellMesh.castShadow = true;
  bellMesh.receiveShadow = true;
  group.add(bellMesh);

  // Sculpted 3D Lotus Petals around the bell capital in Lapis (#1367A0) & Gold
  const petalCount = 12;
  for (let p = 0; p < petalCount; p++) {
    const ang = (p / petalCount) * Math.PI * 2;
    const petal = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.26, capH * 0.95, 4),
      p % 2 === 0 ? suite.materials.lapisLazuli : suite.materials.solidGold
    );
    const pr = radius * 1.18;
    petal.position.set(Math.cos(ang) * pr, neckY + capH * 0.48, Math.sin(ang) * pr);
    petal.rotation.y = -ang + Math.PI / 2;
    petal.rotation.x = 0.34;
    group.add(petal);
  }

  // 4. Square Hieroglyphic Abacus Block at the top of the capital
  const abacusH = height * 0.06;
  const abacus = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.15, abacusH, radius * 2.15),
    suite.materials.blackBasaltGold
  );
  abacus.position.y = neckY + capH + abacusH * 0.5;
  abacus.castShadow = true;
  abacus.receiveShadow = true;
  group.add(abacus);

  return group;
}

/**
 * 6. Builds an architectural tomb corridor wall/ceiling segment (`length = 8..12m`, `width = 9..14m`, `height = 6.5..9m`)
 *    featuring sloped/battered limestone walls with `ancientMural` upper fresco panels and `hieroglyphRelief` lower dado blocks,
 *    a corbelled megalithic ceiling painted with Egyptian golden stars on deep Duat lapis blue (`#0b2d48` / `#1367A0`),
 *    and optional Winged Solar Disc lintels over doorways.
 */
export function buildTombCorridorMuralModule(options = {}) {
  const {
    length = 10.0,
    width = 11.2,
    height = 7.6,
    hasCeiling = true,
    hasDoorwayLintel = false,
    openSide = 0, // -1 left open for alcove/branch, +1 right open, 0 both closed
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'TombCorridorMuralModule';

  const hw = width * 0.5;
  const dadoH = height * 0.38;
  const muralH = height * 0.52;

  for (const side of [-1, 1]) {
    if (openSide === side) continue;

    const wallGroup = new THREE.Group();
    wallGroup.position.set(side * (hw + 0.55), 0, 0);
    // Subtle inward Pharaonic batter angle
    wallGroup.rotation.z = side * 0.045;

    // Lower Dado Block Wall (Sunken Hieroglyph Relief with world-space masonry UVs)
    const dadoMesh = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.15, dadoH, length), 0.18, 0.24),
      suite.materials.hieroglyphRelief
    );
    dadoMesh.position.y = dadoH * 0.5;
    dadoMesh.castShadow = true;
    dadoMesh.receiveShadow = true;
    wallGroup.add(dadoMesh);

    // Royal Black Basalt & Gold Molding Band
    const molding = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.26, 0.28, length), 0.22, 0.25),
      suite.materials.blackBasaltGold
    );
    molding.position.y = dadoH + 0.14;
    wallGroup.add(molding);

    // Upper Polychrome Tomb Mural Fresco Panel (locked [0..1] vertical register UV, proportional horizontal tiling)
    const muralMesh = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.08, muralH, length), 0.14, 1.0, true),
      suite.materials.ancientMural
    );
    muralMesh.position.y = dadoH + 0.28 + muralH * 0.5;
    muralMesh.castShadow = true;
    muralMesh.receiveShadow = true;
    wallGroup.add(muralMesh);

    // Upper Cavetto Cornice
    const cornice = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.38, height * 0.1, length), 0.16, 0.24),
      suite.materials.casingLimestone || suite.materials.limestoneBlocks
    );
    cornice.position.y = height - height * 0.05;
    wallGroup.add(cornice);

    group.add(wallGroup);
  }

  // Corbelled Megalithic Ceiling painted with Golden Stars on Deep Duat Lapis Blue (#0b2d48 / #1367A0)
  if (hasCeiling) {
    for (const side of [-1, 1]) {
      const corbel1 = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.2, 0.65, length), 0.16, 0.24),
        suite.materials.limestoneBlocks
      );
      corbel1.position.set(side * (hw - 0.5), height + 0.25, 0);
      group.add(corbel1);

      const corbel2 = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.2, 0.65, length), 0.18, 0.24),
        suite.materials.hieroglyphRelief
      );
      corbel2.position.set(side * (hw - 1.55), height + 0.85, 0);
      group.add(corbel2);
    }

    const ceilingSlab = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(width + 1.2, 0.55, length), 0.20, 0.20),
      suite.materials.starryCeiling
    );
    ceilingSlab.position.set(0, height + 1.35, 0);
    ceilingSlab.receiveShadow = true;
    group.add(ceilingSlab);
  }

  // Optional Winged Solar Disc Lintel & Pylon Jambs spanning the corridor
  if (hasDoorwayLintel) {
    for (const side of [-1, 1]) {
      const jamb = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.55, height + 0.4, 1.65), 0.20, 0.22),
        suite.materials.hieroglyphRelief
      );
      jamb.position.set(side * (hw - 0.25), (height + 0.4) * 0.5, 0);
      jamb.castShadow = true;
      jamb.receiveShadow = true;
      group.add(jamb);
    }

    const plaque = buildWingedSolarDiscPlaque(width + 1.2, 1.45);
    plaque.position.set(0, height - 0.55, 0);
    group.add(plaque);
  }

  return group;
}

/**
 * 7. Builds an Indiana Jones-style Secret Sliding Stone Passage Doorway:
 *    a heavy counterweighted hieroglyphic stone slab partially slid aside/recessed at an angle
 *    to reveal a hidden golden-lit passage, complete with stone gear/chain counterweights,
 *    broken seal pillars, and a warm golden volumetric glow plane / light spill from the secret room beyond.
 */
export function buildSecretSlidingDoorway(options = {}) {
  const {
    width = 6.2,
    height = 5.6,
    openFraction = 0.72,
    includeLight = true,
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'SecretSlidingStoneDoorway';

  const halfW = width * 0.5;

  // 1. Heavy Hieroglyphic Stone Jambs & Recessed Wall Slot
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.75, height, 1.85), 0.20, 0.22),
      suite.materials.hieroglyphRelief
    );
    jamb.position.set(side * (halfW + 0.82), height * 0.5, 0);
    jamb.castShadow = true;
    jamb.receiveShadow = true;
    group.add(jamb);

    // Broken Pharaoh Cartouche Seal Pillars flanking the threshold
    const sealPillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 1.65, 8),
      suite.materials.blackBasaltGold
    );
    sealPillar.position.set(side * (halfW + 0.22), 0.82, 0.95);
    sealPillar.castShadow = true;
    group.add(sealPillar);
  }

  // Monumental Winged Solar Disc Lintel & Stone Track Header
  const header = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(width + 4.4, 1.35, 2.15), 0.16, 0.24),
    suite.materials.limestoneBlocks
  );
  header.position.set(0, height + 0.65, 0);
  header.castShadow = true;
  header.receiveShadow = true;
  group.add(header);

  const solarPlaque = buildWingedSolarDiscPlaque(width + 2.8, 1.25);
  solarPlaque.position.set(0, height + 0.68, 0.85);
  group.add(solarPlaque);

  // 2. Massive Slid-Aside Counterweighted Hieroglyphic Stone Door Slab
  // Slid to the right side so the center walking corridor stays 100% clear!
  const doorSlabW = width * 0.88;
  const doorSlab = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(doorSlabW, height * 0.95, 0.92), 0.20, 0.22),
    suite.materials.hieroglyphRelief
  );
  const slideOffset = halfW + doorSlabW * 0.5 * openFraction + 0.65;
  doorSlab.position.set(slideOffset, height * 0.475, -0.18);
  doorSlab.rotation.y = -0.12; // Slightly canted from ancient stone rollers
  doorSlab.castShadow = true;
  doorSlab.receiveShadow = true;
  group.add(doorSlab);

  // Gold & Lapis Pharaoh Seal Medallion carved into the sliding stone door
  const sealMedallion = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.85, 1.0, 16),
    suite.materials.solidGold
  );
  sealMedallion.rotation.x = Math.PI / 2;
  sealMedallion.position.set(slideOffset - doorSlabW * 0.25, height * 0.52, -0.18);
  group.add(sealMedallion);

  // 3. Ancient Mechanical Stone Gear Wheel & Counterweight Chains
  for (const side of [-1, 1]) {
    const gearGroup = new THREE.Group();
    gearGroup.position.set(side * (halfW + 1.15), height + 0.55, 1.12);

    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.68, 0.28, 12),
      suite.materials.solidGold
    );
    wheel.rotation.x = Math.PI / 2;
    gearGroup.add(wheel);

    // Counterweight chain & hanging stone block
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6),
      suite.materials.blackBasaltGold
    );
    chain.position.set(side * 0.35, -1.4, 0);
    gearGroup.add(chain);

    const counterweight = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.95, 0.55),
      suite.materials.blackBasaltGold
    );
    counterweight.position.set(side * 0.35, -2.85, 0);
    gearGroup.add(counterweight);

    group.add(gearGroup);
  }

  // 4. Warm Golden Volumetric Light Spill Plane & PointLight beckoning from the secret room
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffc648,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glowBeam = new THREE.Mesh(
    new THREE.ConeGeometry(width * 0.55, 5.5, 16, 1, true),
    glowMat
  );
  glowBeam.position.set(0, height * 0.45, -1.2);
  glowBeam.rotation.x = Math.PI / 2 - 0.35;
  group.add(glowBeam);

  if (includeLight) {
    const secretLight = new THREE.PointLight(0xffb838, 9.5, 18.0, 1.4);
    secretLight.position.set(0, 3.2, -1.4);
    group.add(secretLight);
  }

  return group;
}

/**
 * Builds a Royal Gilded Pharaoh Sarcophagus on a stepped black-basalt dais
 * with a striped gold-and-lapis Nemes pharaoh mask lid (slightly ajar or resting beside the stone coffer),
 * surrounded by four golden Canopic Jars.
 */
export function buildPharaohSarcophagus(options = {}) {
  const {
    ajar = true,
    includeCanopicJars = true,
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'PharaohRoyalSarcophagus';

  // 1. Stepped Royal Black Basalt & Gold Inlay Dais
  const dais1 = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(3.8, 0.32, 5.2), 0.24, 0.32),
    suite.materials.blackBasaltGold
  );
  dais1.position.y = 0.16;
  dais1.castShadow = true;
  dais1.receiveShadow = true;
  group.add(dais1);

  const dais2 = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(3.0, 0.28, 4.4), 0.24, 0.32),
    suite.materials.blackBasaltGold
  );
  dais2.position.y = 0.46;
  dais2.castShadow = true;
  dais2.receiveShadow = true;
  group.add(dais2);

  // 2. Carved Red-Granite & Hieroglyph Outer Coffer Box
  const coffer = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.72, 1.12, 3.15), 0.28, 0.34),
    suite.materials.redGranite
  );
  coffer.position.y = 1.16;
  coffer.castShadow = true;
  coffer.receiveShadow = true;
  group.add(coffer);

  // Inner Golden Treasury Glow inside the opened coffer
  const innerGoldBed = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.42, 0.25, 2.85), 0.30, 0.30),
    suite.materials.goldHoard
  );
  innerGoldBed.position.y = 1.62;
  group.add(innerGoldBed);

  // 3. Anthropoid Gilded Pharaoh Lid with Lapis (#1367A0) & Gold Nemes Mask
  const lidGroup = new THREE.Group();
  if (ajar) {
    lidGroup.position.set(0.38, 1.76, 0.18);
    lidGroup.rotation.y = 0.22;
  } else {
    lidGroup.position.set(0, 1.76, 0);
  }

  const lidSlab = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.78, 0.32, 3.22), 0.28, 0.34),
    suite.materials.solidGold
  );
  lidSlab.castShadow = true;
  lidGroup.add(lidSlab);

  // Sculpted Golden Mummy Effigy Torso (chamfered royal anthropoid sarcophagus body)
  const effigyTorso = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.12, 0.36, 2.24), 0.28, 0.34),
    suite.materials.solidGold
  );
  effigyTorso.position.set(0, 0.24, 0.24);
  lidGroup.add(effigyTorso);

  // Striped Lapis (#1367A0) & Gold Pharaoh Death Mask (Tutankhamun style)
  const nemesMask = new THREE.Mesh(
    new THREE.SphereGeometry(0.56, 20, 16),
    suite.materials.lapisLazuli
  );
  nemesMask.scale.set(1.12, 0.62, 1.02);
  nemesMask.position.set(0, 0.36, -0.92);
  lidGroup.add(nemesMask);

  const pharaohFace = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 20, 16),
    suite.materials.solidGold
  );
  pharaohFace.position.set(0, 0.48, -0.88);
  lidGroup.add(pharaohFace);

  // Crossed Crook & Flail on the Pharaoh's chest
  for (const side of [-1, 1]) {
    const scepter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.05, 8),
      side < 0 ? suite.materials.lapisLazuli : suite.materials.carnelian
    );
    scepter.rotation.x = Math.PI / 2;
    scepter.rotation.z = side * 0.55;
    scepter.position.set(0, 0.54, -0.25);
    lidGroup.add(scepter);
  }

  group.add(lidGroup);

  // 4. Four Golden & Alabaster Canopic Jars at the four corners of the dais
  if (includeCanopicJars) {
    const corners = [
      [-1.18, -1.78],
      [1.18, -1.78],
      [-1.18, 1.78],
      [1.18, 1.78],
    ];
    corners.forEach(([cx, cz], idx) => {
      const jarGroup = new THREE.Group();
      jarGroup.position.set(cx, 0.6, cz);

      const jarBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.16, 0.68, 12),
        suite.materials.limestoneBlocks
      );
      jarBody.position.y = 0.34;
      jarBody.castShadow = true;
      jarGroup.add(jarBody);

      const jarStopper = new THREE.Mesh(
        new THREE.SphereGeometry(0.21, 10, 10),
        idx % 2 === 0 ? suite.materials.solidGold : suite.materials.lapisLazuli
      );
      jarStopper.position.y = 0.78;
      jarGroup.add(jarStopper);

      group.add(jarGroup);
    });
  }

  return group;
}

/**
 * 8. Builds an opulent, Indiana Jones / Tutankhamun Treasury gold hoard cluster (`radius = 2.5..6.0m`):
 *    - Sculpted mounds of gleaming gold coins (`goldHoard` PBR material),
 *    - Stacked gold bullion ingots, ornate golden chalices, jewelled Canopic chests topped with recumbent Anubis statues,
 *      golden battle shields, and scattered emerald/lapis/ruby gems,
 *    - Optional royal Gilded Pharaoh Sarcophagus on a stepped black-basalt dais.
 */
export function buildGoldTreasureRoomHoard(options = {}) {
  const {
    radius = 3.8,
    includeSarcophagus = false,
    includeLight = true,
    seed = 1,
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'GoldTreasureRoomHoard';

  // 1. Sculpted Mounds of Gleaming Gold Coins & Jewels (`goldHoard` PBR material)
  const moundCount = 5;
  for (let m = 0; m < moundCount; m++) {
    const ang = (m / moundCount) * Math.PI * 2 + seed * 0.7;
    const dist = m === 0 ? 0 : radius * (0.36 + seededRandom(seed + m * 11) * 0.28);
    const mRadius = m === 0 ? radius * 0.68 : radius * (0.38 + seededRandom(seed + m * 19) * 0.22);
    const mHeight = mRadius * (0.42 + seededRandom(seed + m * 23) * 0.18);

    const moundGeo = new THREE.SphereGeometry(mRadius, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
    // Perturb vertices slightly for organic treasure pile silhouettes
    const posAttr = moundGeo.attributes.position;
    for (let v = 0; v < posAttr.count; v++) {
      const vx = posAttr.getX(v);
      const vy = posAttr.getY(v);
      const vz = posAttr.getZ(v);
      const bump = 1.0 + Math.sin(vx * 3.1 + vz * 2.7 + m) * 0.08;
      posAttr.setXYZ(v, vx * bump, vy * (mHeight / mRadius), vz * bump);
    }
    moundGeo.computeVertexNormals();

    const moundMesh = new THREE.Mesh(moundGeo, suite.materials.goldHoard);
    moundMesh.position.set(Math.cos(ang) * dist, 0.0, Math.sin(ang) * dist);
    moundMesh.castShadow = true;
    moundMesh.receiveShadow = true;
    group.add(moundMesh);
  }

  // 2. Stacked Gold Bullion Ingots Pyramid
  const ingotStack = new THREE.Group();
  ingotStack.position.set(radius * 0.35, 0.18, radius * 0.28);
  for (let row = 0; row < 3; row++) {
    const count = 4 - row;
    for (let i = 0; i < count; i++) {
      const ingot = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.18, 0.24),
        suite.materials.solidGold
      );
      ingot.position.set((i - (count - 1) * 0.5) * 0.28, row * 0.18, 0);
      ingot.rotation.y = 0.22;
      ingot.castShadow = true;
      ingotStack.add(ingot);
    }
  }
  group.add(ingotStack);

  // 3. Jewelled Canopic Shrine Chest topped with a Recumbent Black-and-Gold Anubis Statue
  const chestGroup = new THREE.Group();
  chestGroup.position.set(-radius * 0.38, 0.22, radius * 0.25);
  chestGroup.rotation.y = 0.48;

  const chestBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.92, 0.95),
    suite.materials.solidGold
  );
  chestBox.position.y = 0.46;
  chestBox.castShadow = true;
  chestGroup.add(chestBox);

  const chestLapisInlay = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 0.64, 0.98),
    suite.materials.lapisLazuli
  );
  chestLapisInlay.position.y = 0.46;
  chestGroup.add(chestLapisInlay);

  // Small recumbent Anubis jackal atop the golden shrine chest
  const jackalBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.36, 0.34),
    suite.materials.blackBasaltGold
  );
  jackalBody.position.set(0, 1.1, 0);
  chestGroup.add(jackalBody);

  const jackalHead = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.48, 6),
    suite.materials.solidGold
  );
  jackalHead.rotation.z = -Math.PI / 2;
  jackalHead.position.set(0.45, 1.32, 0);
  chestGroup.add(jackalHead);

  group.add(chestGroup);

  // 4. Ornate Golden Chalices, Ceremonial Shields & Scattered Faceted Gems (Emerald, Lapis, Carnelian)
  const gemMaterials = [
    suite.materials.emerald,
    suite.materials.lapisLazuli,
    suite.materials.carnelian,
    suite.materials.solidGold,
  ];
  for (let g = 0; g < 16; g++) {
    const ga = (g / 16) * Math.PI * 2 + seed;
    const gr = radius * (0.22 + seededRandom(seed * 7 + g * 13) * 0.62);
    const gx = Math.cos(ga) * gr;
    const gz = Math.sin(ga) * gr;

    if (g % 4 === 0) {
      // Golden Pharaonic Goblet / Chalice
      const chalice = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.12, 0.52, 10),
        suite.materials.solidGold
      );
      chalice.position.set(gx, 0.38, gz);
      chalice.rotation.z = (seededRandom(g * 5) - 0.5) * 0.6;
      chalice.castShadow = true;
      group.add(chalice);
    } else {
      // Faceted Octahedral Jewel
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.16 + seededRandom(g * 9) * 0.1, 0),
        gemMaterials[g % gemMaterials.length]
      );
      gem.position.set(gx, 0.26 + seededRandom(g * 3) * 0.35, gz);
      gem.rotation.set(g * 0.7, g * 1.1, g * 0.4);
      group.add(gem);
    }
  }

  // Golden Ceremonial Sun-Shield leaning against the hoard
  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 0.78, 0.08, 18),
    suite.materials.solidGold
  );
  shield.position.set(radius * 0.25, 0.68, -radius * 0.35);
  shield.rotation.x = 0.45;
  shield.rotation.y = -0.35;
  shield.castShadow = true;
  group.add(shield);

  // 5. Optional Royal Gilded Pharaoh Sarcophagus centerpiece
  if (includeSarcophagus) {
    const sarcophagus = buildPharaohSarcophagus({ ajar: true, includeCanopicJars: true });
    sarcophagus.position.set(0, 0.15, 0);
    group.add(sarcophagus);
  }

  // Warm Golden PointLight over the treasure hoard so every coin facet glints
  if (includeLight) {
    const hoardLight = new THREE.PointLight(0xffc94a, 8.8, 16.0, 1.4);
    hoardLight.position.set(0, 2.4, 0);
    group.add(hoardLight);
  }

  return group;
}

/**
 * 9. Builds a bronze lotus-tripod Pharaonic fire brazier (`height = 1.65m`)
 *    with glowing embers and flame cones so the level can attach dynamic warm torch lights (`0xff9d3b`)
 *    that reflect in the wet floor puddles and off the gold treasure.
 */
export function buildEgyptianBrazier(options = {}) {
  const {
    height = 1.65,
    lit = true,
    includePointLight = true,
    lightColor = 0xff9d3b,
    lightIntensity = 7.4,
    lightDistance = 14.5,
  } = options;

  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'EgyptianBronzeBrazier';

  const scale = height / 1.65;
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  group.add(root);

  const bronzeMat = new THREE.MeshStandardMaterial({
    color: 0x8a5e2b,
    roughness: 0.32,
    metalness: 0.86,
  });

  // Stepped circular base & 3 lion-paw tripod legs
  const baseDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.56, 0.16, 12),
    suite.materials.blackBasaltGold
  );
  baseDisc.position.y = 0.08;
  baseDisc.castShadow = true;
  baseDisc.receiveShadow = true;
  root.add(baseDisc);

  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.075, 1.28, 8),
      bronzeMat
    );
    leg.position.set(Math.cos(ang) * 0.24, 0.72, Math.sin(ang) * 0.24);
    leg.rotation.z = Math.cos(ang) * 0.16;
    leg.rotation.x = -Math.sin(ang) * 0.16;
    leg.castShadow = true;
    root.add(leg);
  }

  // Central lotus-column stem
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.16, 1.25, 10),
    suite.materials.solidGold
  );
  stem.position.y = 0.74;
  stem.castShadow = true;
  root.add(stem);

  // Flared Lotus-Petal Fire Bowl
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.24, 0.36, 14),
    bronzeMat
  );
  bowl.position.y = 1.42;
  bowl.castShadow = true;
  root.add(bowl);

  const goldRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.045, 8, 20),
    suite.materials.solidGold
  );
  goldRim.rotation.x = Math.PI / 2;
  goldRim.position.y = 1.58;
  root.add(goldRim);

  let flameGroup = null;
  let pointLight = null;

  if (lit) {
    // Glowing Charcoal & Gold Ember Bed
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xff5a14,
      emissive: 0xff4808,
      emissiveIntensity: 3.2,
      roughness: 0.4,
    });
    const embers = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      emberMat
    );
    embers.scale.set(1.0, 0.38, 1.0);
    embers.position.y = 1.52;
    root.add(embers);

    // WebGPU TSL Volumetric Turbulent Fire Plume + Rising Glowing Embers (inspired by webgpu_volume_fire)
    flameGroup = buildVolumetricFirePlume({
      scale: 1.08,
      coreColorHex: 0xffe68c,
      midColorHex: 0xff7305,
      outerColorHex: 0xff1200,
      emberCount: 10,
    });
    flameGroup.position.y = 1.54;
    root.add(flameGroup);

    if (includePointLight) {
      pointLight = new THREE.PointLight(lightColor, lightIntensity, lightDistance, 1.45);
      pointLight.position.set(0, 2.05 * scale, 0);
      group.add(pointLight);
    }
  }

  group.userData.flameGroup = flameGroup;
  group.userData.pointLight = pointLight;
  group.userData.baseIntensity = lightIntensity;
  return group;
}

/**
 * Helper: Builds a colossal Gilded Royal Solar Barque of Khufu-Ra shrine for the final burial chamber & Mirror Basin.
 */
export function buildSolarBarqueOfRa(options = {}) {
  const { length = 14.0 } = options;
  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'GildedSolarBarqueOfRa';

  const s = length / 14.0;
  const root = new THREE.Group();
  root.scale.setScalar(s);
  group.add(root);

  // Stepped Basalt & Gold Altar Pedestal
  const pedestal = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 1.35, 9.5),
    suite.materials.blackBasaltGold
  );
  pedestal.position.y = 0.675;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  root.add(pedestal);

  // Curved Golden Papyrus Hull
  const hullCenter = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 0.78, 8.8, 12),
    suite.materials.solidGold
  );
  hullCenter.rotation.x = Math.PI / 2;
  hullCenter.scale.set(1.1, 1.0, 0.58);
  hullCenter.position.y = 1.85;
  hullCenter.castShadow = true;
  root.add(hullCenter);

  // High curving Lotus Prow & Stern posts
  for (const endSide of [-1, 1]) {
    const prow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.68, 4.6, 10),
      suite.materials.solidGold
    );
    prow.position.set(0, 3.35, endSide * 5.2);
    prow.rotation.x = endSide * 0.48;
    prow.castShadow = true;
    root.add(prow);

    const lotusFinial = new THREE.Mesh(
      new THREE.ConeGeometry(0.65, 1.1, 12),
      suite.materials.lapisLazuli
    );
    lotusFinial.position.set(0, 5.35, endSide * 6.25);
    lotusFinial.rotation.x = endSide * -2.4;
    root.add(lotusFinial);
  }

  // Central Naos Canopy Shrine with Lapis Lazuli (#1367A0) & Glowing Solar Disc of Ra
  const naos = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 2.85, 3.25),
    suite.materials.ancientMural
  );
  naos.position.y = 3.45;
  naos.castShadow = true;
  root.add(naos);

  const solarDisc = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 18, 14),
    suite.materials.electrumCap
  );
  solarDisc.position.set(0, 5.65, 0);
  root.add(solarDisc);

  return group;
}

/**
 * Helper: Builds a Date Palm Oasis Tree cluster with curved fibrous trunk and warm Red-Orange / Terracotta-Flame desert fronds
 * complementing the sun-scorched pyramid flora.
 */
function buildDesertOasisPalm(options = {}) {
  const { height = 7.4, seed = 1 } = options;
  const suite = createEgyptianTextureSuite();
  const group = new THREE.Group();
  group.name = 'EgyptianOasisPalm';

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x6e4226,
    normalMap: suite.limestoneBlocks.normalMap,
    roughness: 0.9,
  });
  const frondInnerMat = new THREE.MeshStandardMaterial({
    color: 0xc83e14, // Fiery Red-Orange desert palm frond matching the Chapter 5 pyramid grass
    emissive: 0x3a0c02,
    emissiveIntensity: 0.18,
    roughness: 0.56,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const frondTipMat = new THREE.MeshStandardMaterial({
    color: 0xf06a24, // Sun-bleached flame-amber outer palm fronds
    emissive: 0x481404,
    emissiveIntensity: 0.22,
    roughness: 0.52,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  const segs = 7;
  const segH = height / segs;
  let cx = 0;
  let cz = 0;
  const leanX = (seededRandom(seed * 3.1) - 0.5) * 0.22;
  const leanZ = (seededRandom(seed * 7.3) - 0.5) * 0.22;

  for (let i = 0; i < segs; i++) {
    const rBot = 0.36 * (1 - i * 0.06);
    const rTop = 0.32 * (1 - i * 0.06);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, segH * 1.08, 8),
      trunkMat
    );
    cx += leanX * (i + 1) * 0.35;
    cz += leanZ * (i + 1) * 0.35;
    ring.position.set(cx, (i + 0.5) * segH, cz);
    ring.castShadow = true;
    ring.receiveShadow = true;
    group.add(ring);
  }

  const crownPos = new THREE.Vector3(cx, height, cz);
  const frondCount = 12;
  for (let f = 0; f < frondCount; f++) {
    const ang = (f / frondCount) * Math.PI * 2 + seed;
    const frond = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 3.8, 4),
      f % 2 === 0 ? frondInnerMat : frondTipMat
    );
    frond.scale.set(1.0, 1.0, 0.18);
    frond.position.copy(crownPos).add(new THREE.Vector3(Math.cos(ang) * 1.48, -0.15, Math.sin(ang) * 1.48));
    frond.rotation.y = -ang + Math.PI / 2;
    frond.rotation.z = -1.18;
    frond.castShadow = true;
    group.add(frond);
  }

  return group;
}

/**
 * 10. High-level orchestrator that populates the complete Egyptian Pyramid & Ancient Tomb biome
 *     ("The Sunken Necropolis of Khufu-Ra") along the spine (`t = 0.00 -> 1.00`) and secret branch (`u = 0.0 -> 1.0`).
 *
 * Returns `{ textureSuite, lightAnchors, solidObstacles, animatedProps, update(dt, elapsed) }`.
 */
export function buildCompleteEgyptianPyramidBiome(worldGroup, spine, topology, options = {}) {
  const activeSpine = spine && typeof spine.getSampleAt === 'function' ? spine : topology;
  const textureSuite = createEgyptianTextureSuite(options.maxAnisotropy || 8);

  const lightAnchors = [];
  const solidObstacles = [];
  const animatedProps = [];

  const rootGroup = new THREE.Group();
  rootGroup.name = 'EgyptianPyramidBiomeRoot';

  const exteriorDesertGroup = new THREE.Group();
  exteriorDesertGroup.name = 'EgyptianExteriorDesertGroup';
  rootGroup.add(exteriorDesertGroup);

  const portalThresholdGroup = new THREE.Group();
  portalThresholdGroup.name = 'EgyptianPortalThresholdGroup';
  rootGroup.add(portalThresholdGroup);

  const interiorTombGroup = new THREE.Group();
  interiorTombGroup.name = 'EgyptianInteriorTombGroup';
  rootGroup.add(interiorTombGroup);

  // Route outdoor desert props (t < 0.232), portal threshold (t ~ 0.24), and underground tomb props (t > 0.242 or branch)
  const addNodeAtT = (node, t, isBranch = false) => {
    if (!isBranch && Math.abs(t - 0.24) < 0.008) {
      portalThresholdGroup.add(node);
    } else if (!isBranch && t < 0.235) {
      exteriorDesertGroup.add(node);
    } else {
      interiorTombGroup.add(node);
    }
  };

  if (worldGroup?.isObject3D) {
    worldGroup.add(rootGroup);
  } else if (worldGroup?.scene?.isObject3D) {
    worldGroup.scene.add(rootGroup);
  }

  const registerCylinder = (spec) => {
    const obs = {
      id: spec.id || `egypt_cyl_${solidObstacles.length}`,
      type: 'cylinder',
      x: spec.x,
      y: spec.y,
      z: spec.z,
      r: spec.r,
      h: spec.h ?? 6.0,
      kind: spec.kind || 'egypt_monument',
      walkableTop: Boolean(spec.walkableTop),
    };
    solidObstacles.push(obs);
    if (typeof worldGroup?.addSolidCylinder === 'function') {
      worldGroup.addSolidCylinder(obs);
    }
    return obs;
  };

  const registerOBB = (spec) => {
    const yaw = spec.yaw || 0;
    const obs = {
      id: spec.id || `egypt_obb_${solidObstacles.length}`,
      type: 'obb',
      x: spec.x,
      y: spec.y,
      z: spec.z,
      hx: spec.hx,
      hz: spec.hz,
       yaw,
      cos: Math.cos(yaw),
      sin: Math.sin(yaw),
      h: spec.h ?? 6.5,
      kind: spec.kind || 'egypt_wall',
      walkableTop: Boolean(spec.walkableTop),
    };
    solidObstacles.push(obs);
    if (typeof worldGroup?.addSolidOBB === 'function') {
      worldGroup.addSolidOBB(obs);
    }
    return obs;
  };

  const placeBrazierAt = (t, lat, dy = 0, isBranch = false, seed = 1) => {
    const pos = activeSpine.getWorldPos(t, lat, dy, isBranch);
    const brazier = buildEgyptianBrazier({
      height: 1.65,
      lit: true,
      includePointLight: options.includePointLights !== false,
      seed,
    });
    brazier.position.copy(pos);
    addNodeAtT(brazier, t, isBranch);

    const worldLightPos = pos.clone().add(new THREE.Vector3(0, 2.05, 0));
    lightAnchors.push({
      id: `brazier_${isBranch ? 'branch' : 'main'}_${t.toFixed(3)}_${lat.toFixed(1)}`,
      position: worldLightPos,
      color: 0xff9d3b,
      intensity: 7.4,
      distance: 14.5,
      brazier,
    });
    animatedProps.push({
      kind: 'brazier',
      brazier,
      phase: seed * 2.17 + t * 19.3,
    });
    registerCylinder({
      id: `brazier_col_${isBranch ? 'b' : 'm'}_${t.toFixed(3)}_${lat.toFixed(1)}`,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      r: 0.62,
      h: 1.8,
      kind: 'brazier',
    });
  };

  // Helper: Build a perimeter ring of Pharaonic Hieroglyph & Polychrome Mural Wall Panels around circular chambers
  const buildChamberPerimeterWalls = (centerPoint, radius, wallHeight, panelCount, tTag, isBranch = false, skipAngles = []) => {
    const group = new THREE.Group();
    group.position.copy(centerPoint);
    const panelWidth = (2 * Math.PI * radius) / panelCount * 1.08;
    const dadoH = wallHeight * 0.38;
    const muralH = wallHeight * 0.52;

    for (let i = 0; i < panelCount; i++) {
      const ang = (i / panelCount) * Math.PI * 2;
      let skip = false;
      for (const sa of skipAngles) {
        let diff = Math.abs(Math.atan2(Math.sin(ang - sa), Math.cos(ang - sa)));
        if (diff < 0.34) {
          skip = true;
          break;
        }
      }
      if (skip) continue;

      const panelGroup = new THREE.Group();
      panelGroup.position.set(Math.cos(ang) * radius, 0, Math.sin(ang) * radius);
      panelGroup.rotation.y = -ang + Math.PI / 2;

      const dado = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(panelWidth, dadoH, 1.15), 0.18, 0.24),
        textureSuite.materials.hieroglyphRelief
      );
      dado.position.y = dadoH * 0.5;
      dado.castShadow = true;
      dado.receiveShadow = true;
      panelGroup.add(dado);

      const molding = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(panelWidth + 0.1, 0.28, 1.26), 0.22, 0.25),
        textureSuite.materials.blackBasaltGold
      );
      molding.position.y = dadoH + 0.14;
      panelGroup.add(molding);

      const mural = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(panelWidth, muralH, 1.08), 0.14, 1.0, true),
        textureSuite.materials.ancientMural
      );
      mural.position.y = dadoH + 0.28 + muralH * 0.5;
      mural.castShadow = true;
      mural.receiveShadow = true;
      panelGroup.add(mural);

      const cornice = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(panelWidth + 0.2, wallHeight * 0.1, 1.38), 0.16, 0.24),
        textureSuite.materials.casingLimestone || textureSuite.materials.limestoneBlocks
      );
      cornice.position.y = wallHeight - wallHeight * 0.05;
      panelGroup.add(cornice);

      group.add(panelGroup);
    }
    addNodeAtT(group, tTag, isBranch);
  };

  // ============================================================================
  // SECTION 1: OUTDOOR EGYPTIAN DESERT & SPHINX AVENUE (t = 0.00 -> 0.25)
  // ============================================================================
  // 1A. Continuous Golden Giza Desert Sand-Dune Terrain Floor (PolyHaven aerial_beach_01 + sandstone_blocks_04 PBR)
  {
    const desertSize = 540;
    const desertSegs = 76;
    const desertGeo = new THREE.PlaneGeometry(desertSize, desertSize, desertSegs, desertSegs);
    desertGeo.rotateX(-Math.PI / 2);
    const centerOffset = new THREE.Vector3(-82, 0, 12);
    const posAttr = desertGeo.attributes.position;

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i) + centerOffset.x;
      const wz = posAttr.getZ(i) + centerOffset.z;

      // Find nearest Zone 1 spine sample (t in [0.00, 0.25]) so the desert floor hugs the oasis trail without covering puddles
      let minDist = Infinity;
      let nearestY = 0.0;
      let nearestHw = 4.0;
      for (let k = 0; k <= 150; k++) {
        const s = activeSpine.samples[k];
        if (!s) continue;
        const dx = wx - s.point.x;
        const dz = wz - s.point.z;
        const d = Math.hypot(dx, dz);
        if (d < minDist) {
          minDist = d;
          nearestY = s.point.y;
          nearestHw = s.halfWidth;
        }
      }

      const dunes =
        Math.sin(wx * 0.042 + wz * 0.031) * 1.15 +
        Math.cos(wx * 0.085 - wz * 0.064) * 0.55 +
        Math.sin((wx + wz) * 0.16) * 0.18;

      let wy;
      if (minDist < nearestHw + 1.0) {
        // Depress below the wet oasis trail channel & interactive rain puddles
        wy = nearestY - 0.42;
      } else if (minDist < nearestHw + 8.5) {
        // Smoothly blend from the Sphinx/Obelisk plinth level out into rolling desert sand dunes
        const blend = (minDist - (nearestHw + 1.0)) / 7.5;
        wy = nearestY - 0.18 + blend * (0.35 + Math.max(0, dunes * 0.65));
      } else {
        wy = Math.min(3.6, nearestY * 0.55) + 0.45 + dunes;
      }
      posAttr.setXYZ(i, wx - centerOffset.x, wy, wz - centerOffset.z);
    }
    desertGeo.computeVertexNormals();

    const desertMesh = new THREE.Mesh(desertGeo, textureSuite.materials.desertSand);
    desertMesh.position.copy(centerOffset);
    desertMesh.receiveShadow = true;
    addNodeAtT(desertMesh, 0.08, false);
  }

  // 1B. Four Colossal Horizon Great Pyramids (Khufu-Ra, Khafre-Set, Menkaure-Thoth, Djedefre-Horus) framing the Giza Horizon
  const vistaPyramids = [
    // Great Pyramid of Khufu-Ra rising behind the Megalithic Portal at the north end of the Sphinx Avenue
    { x: -96, y: 0.2, z: -84, baseWidth: 112, height: 54, tiers: 38, yaw: 0.06, sub: false, t: 0.18 },
    // Great Pyramid of Khafre-Set dominating the center-left horizon behind the Sphinx & Obelisk Avenue
    { x: -12, y: 0.2, z: -92, baseWidth: 98, height: 47, tiers: 36, yaw: -0.10, sub: true, t: 0.12 },
    // Pyramid of Djedefre-Horus framing the center-right horizon behind the Oasis Palm & Mummy vanguard
    { x: 42, y: 0.2, z: -22, baseWidth: 80, height: 38, tiers: 32, yaw: -0.24, sub: true, t: 0.08 },
    // Pyramid of Menkaure-Thoth towering on the far-left western desert horizon
    { x: -168, y: 0.5, z: -36, baseWidth: 88, height: 43, tiers: 32, yaw: 0.22, sub: true, t: 0.10 },
  ];
  for (const vp of vistaPyramids) {
    const pyr = buildMonumentalPyramid({
      baseWidth: vp.baseWidth,
      height: vp.height,
      tiers: vp.tiers,
      hasEntrancePortal: true,
      hasSubsidiaryPyramids: vp.sub,
    });
    pyr.position.set(vp.x, vp.y, vp.z);
    pyr.rotation.y = vp.yaw;
    addNodeAtT(pyr, vp.t, false);
  }

  // Subterranean Megalithic Pyramid Interior Vault Shell (BackSide enclosure so zero outdoor sky ever leaks between curving tomb corridors)
  {
    const shellWallMat = textureSuite.materials.hieroglyphRelief.clone();
    shellWallMat.side = THREE.BackSide;
    const shellRoofMat = textureSuite.materials.starryCeiling.clone();
    shellRoofMat.side = THREE.BackSide;
    const shellFloorMat = textureSuite.materials.blackBasaltGold.clone();
    shellFloorMat.side = THREE.BackSide;
    const shellMaterials = [
      shellWallMat,
      shellWallMat,
      shellRoofMat,
      shellFloorMat,
      shellWallMat,
      shellWallMat,
    ];
    const vaultShell = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(320, 58, 320), 0.12, 0.16),
      shellMaterials
    );
    vaultShell.position.set(-18, 22, -10);
    interiorTombGroup.add(vaultShell);
  }

  // 1C. Processional Avenue of Sphinxes / Anubis Colossi & Hieroglyphic Obelisks (t = 0.02 -> 0.21)
  const avenueStops = [0.028, 0.065, 0.105, 0.145, 0.185];
  avenueStops.forEach((t, idx) => {
    const s = activeSpine.getSampleAt(t);
    const hw = s.halfWidth;
    const tangentYaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);

    for (const side of [-1, 1]) {
      const lat = side * (hw + 4.2);
      const pos = activeSpine.getWorldPos(t, lat, -0.15, false);
      const inwardYaw = tangentYaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);

      if (idx % 2 === 0) {
        const colossus = buildGreatSphinxOrAnubisColossus({
          variant: idx === 0 ? 'sphinx' : 'anubis',
          height: 9.8,
        });
        colossus.position.copy(pos);
        colossus.rotation.y = inwardYaw;
        addNodeAtT(colossus, t, false);
        registerCylinder({
          id: `avenue_colossus_${t.toFixed(3)}_${side}`,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          r: 2.35,
          h: 9.5,
          kind: 'anubis_colossus',
        });
      } else {
        const obelisk = buildHieroglyphObelisk({
          height: 11.2,
          baseWidth: 1.38,
          broken: idx === 3 && side < 0,
        });
        obelisk.position.copy(pos);
        obelisk.rotation.y = inwardYaw;
        addNodeAtT(obelisk, t, false);
        registerCylinder({
          id: `avenue_obelisk_${t.toFixed(3)}_${side}`,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          r: 1.15,
          h: 10.5,
          kind: 'obelisk',
        });
      }

      // Flanking bronze processional braziers along the avenue
      placeBrazierAt(t, side * (hw + 1.55), 0, false, idx * 10 + (side > 0 ? 1 : 2));
    }

    // Desert Oasis Date Palms with Red-Orange fronds framing the outer oasis banks
    const palmSide = idx % 2 === 0 ? -1 : 1;
    const palmPos = activeSpine.getWorldPos(t + 0.012, palmSide * (hw + 6.4), -0.2, false);
    const palm = buildDesertOasisPalm({ height: 7.6, seed: idx + 1 });
    palm.position.copy(palmPos);
    addNodeAtT(palm, t, false);
  });

  // 1D. Megalithic Great Pyramid Entrance Portal straddling the spine at t = 0.24
  {
    const tPortal = 0.24;
    const s = activeSpine.getSampleAt(tPortal);
    const hw = s.halfWidth;
    const portalYaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);
    const portalPos = s.point.clone();

    const gatewayGroup = new THREE.Group();
    gatewayGroup.name = 'GreatPyramidEntrancePortal';
    gatewayGroup.position.copy(portalPos);
    gatewayGroup.rotation.y = portalYaw;

    const clearSpan = (hw + 1.2) * 2;
    const pylonW = 5.0;
    const pylonH = 13.4;
    const pylonD = 5.8;

    for (const side of [-1, 1]) {
      const px = side * (clearSpan * 0.5 + pylonW * 0.5);
      const pylon = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(pylonW, pylonH, pylonD), 0.16, 0.20),
        textureSuite.materials.hieroglyphRelief
      );
      pylon.position.set(px, pylonH * 0.5 - 0.2, 0);
      pylon.rotation.z = side * 0.055;
      pylon.castShadow = true;
      pylon.receiveShadow = true;
      gatewayGroup.add(pylon);

      const pylonCap = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(pylonW + 0.5, 0.85, pylonD + 0.5), 0.16, 0.22),
        textureSuite.materials.casingLimestone || textureSuite.materials.limestoneBlocks
      );
      pylonCap.position.set(px - side * 0.35, pylonH + 0.1, 0);
      gatewayGroup.add(pylonCap);

      const worldPierPos = activeSpine.getWorldPos(tPortal, px, 0, false);
      registerCylinder({
        id: `pyramid_portal_pier_${side}`,
        x: worldPierPos.x,
        y: worldPierPos.y,
        z: worldPierPos.z,
        r: 2.35,
        h: pylonH,
        kind: 'pylon_pier',
      });

      // Twin towering Anubis Colossi guarding the Pyramid threshold
      const guard = buildGreatSphinxOrAnubisColossus({ variant: 'anubis', height: 11.4 });
      guard.position.set(side * (clearSpan * 0.5 + 3.2), 0, -4.6);
      guard.rotation.y = Math.PI;
      gatewayGroup.add(guard);
    }

    // Winged Solar Disc Lintel & Khufu Chevron Relieving Stones over the entrance
    const lintel = buildWingedSolarDiscPlaque(clearSpan + pylonW * 1.8, 2.2);
    lintel.position.set(0, 8.2, 0);
    gatewayGroup.add(lintel);

    for (const side of [-1, 1]) {
      const chevron = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(7.8, 1.95, 4.4), 0.16, 0.24),
        textureSuite.materials.casingLimestone || textureSuite.materials.limestoneBlocks
      );
      chevron.position.set(side * 2.9, 11.2, 0);
      chevron.rotation.z = side * -0.5;
      chevron.castShadow = true;
      gatewayGroup.add(chevron);
    }

    addNodeAtT(gatewayGroup, tPortal, false);
  }

  // ============================================================================
  // SECTION 2: SECRET PASSAGES & GOLD TREASURY ROOMS
  // (Branch at t = 0.225 AND Secret Alcoves along t = 0.455..0.565)
  // ============================================================================
  // 2A. Indiana Jones Secret Sliding Stone Doorways (at Branch Entry u = 0.07 AND Gold Vault Entry u = 0.62)
  for (const uDoor of [0.07, 0.62]) {
    const bs = activeSpine.getBranchSampleAt(uDoor);
    const doorYaw = Math.atan2(bs.flatTangent.x, bs.flatTangent.z);
    const secretDoor = buildSecretSlidingDoorway({
      width: bs.halfWidth * 1.85 + 1.2,
      height: 6.2,
      openFraction: 0.78,
      includeLight: options.includePointLights !== false,
    });
    secretDoor.position.copy(bs.point);
    secretDoor.rotation.y = doorYaw;
    addNodeAtT(secretDoor, 0.225, true);

    lightAnchors.push({
      id: `secret_branch_door_light_${uDoor.toFixed(2)}`,
      position: bs.point.clone().add(new THREE.Vector3(0, 3.2, 0)),
      color: 0xffb838,
      intensity: 10.5,
      distance: 18.0,
    });
  }

  // 2B. Seamless Secret Passage Hieroglyph & Mural Corridor (u = 0.10 -> 0.58)
  for (let u = 0.10; u <= 0.59; u += 0.08) {
    const bs = activeSpine.getBranchSampleAt(u);
    const bYaw = Math.atan2(bs.flatTangent.x, bs.flatTangent.z);
    const mod = buildTombCorridorMuralModule({
      length: 7.6,
      width: bs.halfWidth * 2 + 1.0,
      height: 7.4,
      hasCeiling: true,
      hasDoorwayLintel: Math.abs(u - 0.34) < 0.03,
    });
    mod.position.copy(bs.point);
    mod.rotation.y = bYaw;
    addNodeAtT(mod, 0.225, true);

    if (Math.round(u * 100) % 16 === 2) {
      placeBrazierAt(u, -(bs.halfWidth - 0.35), 0, true, Math.round(u * 100));
      placeBrazierAt(u, bs.halfWidth - 0.35, 0, true, Math.round(u * 100) + 1);
    }
  }

  // 2C. Enclosed Secret Gold Treasury Vault Chamber (u = 0.66 -> 0.98, centered at u = 0.82)
  {
    const clearSample = activeSpine.getBranchSampleAt(0.82);
    const entrySample = activeSpine.getBranchSampleAt(0.62);
    const endSample = activeSpine.getBranchSampleAt(0.95);
    const endYaw = Math.atan2(endSample.flatTangent.x, endSample.flatTangent.z);
    const entryAngle = Math.atan2(
      entrySample.point.z - clearSample.point.z,
      entrySample.point.x - clearSample.point.x
    );

    // Enclose the entire Secret Gold Treasury with 12 Pharaonic Hieroglyph & Polychrome Mural Wall Panels + Starry Vault Roof
    buildChamberPerimeterWalls(clearSample.point, 12.6, 8.8, 12, 0.225, true, [entryAngle]);

    const vaultRoof = new THREE.Mesh(
      new THREE.CylinderGeometry(13.2, 13.2, 0.65, 16),
      textureSuite.materials.starryCeiling
    );
    vaultRoof.position.copy(clearSample.point).add(new THREE.Vector3(0, 9.0, 0));
    addNodeAtT(vaultRoof, 0.225, true);

    // Royal Gilded Pharaoh Sarcophagus + Mountain of Gold Hoard at the apex of the secret vault (u = 0.95)
    const royalHoard = buildGoldTreasureRoomHoard({
      radius: 4.4,
      includeSarcophagus: true,
      includeLight: options.includePointLights !== false,
      seed: 77,
    });
    royalHoard.position.copy(endSample.point);
    royalHoard.rotation.y = endYaw;
    addNodeAtT(royalHoard, 0.225, true);
    registerCylinder({
      id: 'secret_vault_sarcophagus',
      x: endSample.point.x,
      y: endSample.point.y,
      z: endSample.point.z,
      r: 2.25,
      h: 3.2,
      kind: 'sarcophagus',
    });

    // Flanking Gold Hoard Mounds, Golden Sarcophagi, Lotus Columns & Braziers along the Left & Right Sides of the Vault
    // (Leaves the central camera/combat sightline lat in [-3.4m, +3.4m] 100% unobstructed!)
    const vaultRows = [0.71, 0.79, 0.87];
    vaultRows.forEach((uRow, rIdx) => {
      for (const side of [-1, 1]) {
        const hoardPos = activeSpine.getWorldPos(uRow, side * 5.8, 0, true);
        const colPos = activeSpine.getWorldPos(uRow, side * 9.6, 0, true);
        const rowSample = activeSpine.getBranchSampleAt(uRow);
        const inwardYaw = Math.atan2(rowSample.flatTangent.x, rowSample.flatTangent.z) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);

        const hoard = buildGoldTreasureRoomHoard({
          radius: 2.9,
          includeSarcophagus: rIdx === 1,
          includeLight: options.includePointLights !== false,
          seed: 200 + rIdx * 17 + (side > 0 ? 5 : 0),
        });
        hoard.position.copy(hoardPos);
        hoard.rotation.y = inwardYaw;
        addNodeAtT(hoard, 0.225, true);

        registerCylinder({
          id: `secret_vault_hoard_${rIdx}_${side}`,
          x: hoardPos.x,
          y: hoardPos.y,
          z: hoardPos.z,
          r: 1.75,
          h: 2.4,
          kind: 'gold_hoard',
        });

        const lotusCol = buildLotusHypostyleColumn({ height: 8.6, radius: 0.88 });
        lotusCol.position.copy(colPos);
        lotusCol.rotation.y = inwardYaw;
        addNodeAtT(lotusCol, 0.225, true);

        placeBrazierAt(uRow, side * 3.8, 0, true, 400 + rIdx * 10 + (side > 0 ? 1 : 2));
      }
    });
  }

  // ============================================================================
  // SECTION 3: GRAND PYRAMID INTERIOR CORRIDORS & HYPOSTYLE HALL (t = 0.245 -> 0.64)
  // ============================================================================
  // 3A. Continuous, Seamless Overlapping Hieroglyph & Mural Corridor Modules
  const mainCorridorRanges = [
    [0.242, 0.342],
    [0.382, 0.472],
    [0.546, 0.642],
  ];
  let corrIdx = 0;
  for (const [tStart, tEnd] of mainCorridorRanges) {
    for (let t = tStart; t <= tEnd + 0.001; t += 0.010) {
      const s = activeSpine.getSampleAt(t);
      const hw = s.halfWidth;
      const yaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);

      // Open side alcove for secret gold rooms at t ~ 0.454 (right) and t ~ 0.572 (left)
      const isRightAlcove = Math.abs(t - 0.454) < 0.007;
      const isLeftAlcove = Math.abs(t - 0.572) < 0.007;
      const openSide = isRightAlcove ? 1 : isLeftAlcove ? -1 : 0;

      const corrMod = buildTombCorridorMuralModule({
        length: 9.4,
        width: hw * 2 + 1.2,
        height: 8.6,
        hasCeiling: true,
        hasDoorwayLintel: corrIdx % 3 === 0,
        openSide,
      });
      corrMod.position.copy(s.point);
      corrMod.rotation.y = yaw;
      addNodeAtT(corrMod, t, false);

      // Flanking Lotus Columns & Flickering Bronze Braziers every second module
      if (corrIdx % 2 === 0) {
        for (const side of [-1, 1]) {
          if (openSide === side) continue;
          const colPos = activeSpine.getWorldPos(t, side * (hw - 0.15), 0, false);
          const col = buildLotusHypostyleColumn({ height: 8.1, radius: 0.74 });
          col.position.copy(colPos);
          col.rotation.y = yaw;
          addNodeAtT(col, t, false);
        }
        placeBrazierAt(t, -(hw - 0.65), 0, false, 300 + corrIdx * 2);
        placeBrazierAt(t, hw - 0.65, 0, false, 301 + corrIdx * 2);
      }

      // Secret Side-Chamber Gold Treasury Alcoves at t ~ 0.454 and t ~ 0.572!
      if (openSide !== 0) {
        const alcoveDoorPos = activeSpine.getWorldPos(t, openSide * (hw + 1.2), 0, false);
        const alcoveVaultPos = activeSpine.getWorldPos(t, openSide * (hw + 5.4), 0, false);
        const inwardYaw = yaw + (openSide > 0 ? -Math.PI / 2 : Math.PI / 2);

        const alcoveDoor = buildSecretSlidingDoorway({
          width: 5.2,
          height: 5.6,
          openFraction: 0.76,
          includeLight: options.includePointLights !== false,
        });
        alcoveDoor.position.copy(alcoveDoorPos);
        alcoveDoor.rotation.y = inwardYaw;
        addNodeAtT(alcoveDoor, t, false);

        const alcoveHoard = buildGoldTreasureRoomHoard({
          radius: 3.6,
          includeSarcophagus: true,
          includeLight: options.includePointLights !== false,
          seed: Math.round(t * 1000),
        });
        alcoveHoard.position.copy(alcoveVaultPos);
        alcoveHoard.rotation.y = inwardYaw;
        addNodeAtT(alcoveHoard, t, false);
      }
      corrIdx++;
    }
  }

  // 3B. Grand Karnak Hypostyle Hall Colonnade & Mural Enclosure around Boss 1 Arena (t = 0.36)
  {
    const hallSample = activeSpine.getSampleAt(0.36);
    const hallCenter = hallSample.point;
    const entryPt = activeSpine.getSampleAt(0.326).point;
    const exitPt = activeSpine.getSampleAt(0.394).point;
    const angIn = Math.atan2(entryPt.z - hallCenter.z, entryPt.x - hallCenter.x);
    const angOut = Math.atan2(exitPt.z - hallCenter.z, exitPt.x - hallCenter.x);

    buildChamberPerimeterWalls(hallCenter, 12.2, 9.2, 14, 0.36, false, [angIn, angOut]);

    const hallRoof = new THREE.Mesh(
      new THREE.CylinderGeometry(12.8, 12.8, 0.65, 16),
      textureSuite.materials.starryCeiling
    );
    hallRoof.position.copy(hallCenter).add(new THREE.Vector3(0, 9.4, 0));
    addNodeAtT(hallRoof, 0.36, false);

    const colCount = 10;
    for (let i = 0; i < colCount; i++) {
      const ang = (i / colCount) * Math.PI * 2 + 0.15;
      const r = 10.2;
      const cx = hallCenter.x + Math.cos(ang) * r;
      const cz = hallCenter.z + Math.sin(ang) * r;
      const cy = hallCenter.y;

      const col = buildLotusHypostyleColumn({ height: 9.0, radius: 0.92 });
      col.position.set(cx, cy, cz);
      col.rotation.y = -ang;
      addNodeAtT(col, 0.36, false);

      registerCylinder({
        id: `hypostyle_hall_col_${i}`,
        x: cx,
        y: cy,
        z: cz,
        r: 1.05,
        h: 9.0,
        kind: 'lotus_column',
      });
    }
  }

  // 3C. Subterranean Duat Chasm Bridge Guardians & Obelisks (t = 0.48 -> 0.54)
  for (const tBridge of [0.485, 0.51, 0.535]) {
    const s = activeSpine.getSampleAt(tBridge);
    const hw = s.halfWidth;
    const yaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);
    for (const side of [-1, 1]) {
      const pos = activeSpine.getWorldPos(tBridge, side * (hw + 6.2), -7.5, false);
      const colossus = buildGreatSphinxOrAnubisColossus({
        variant: 'anubis',
        height: 13.5,
      });
      colossus.position.copy(pos);
      colossus.rotation.y = yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      addNodeAtT(colossus, tBridge, false);
    }
  }

  // ============================================================================
  // SECTION 4: CANOPIC MUMMY CATACOMBS & PHARAOH'S SOLAR BARQUE SANCTUM (t = 0.64 -> 1.00)
  // ============================================================================
  // 4A. Sunken Sacred Nile Basin / Canopic Mirror Amphitheater (t = 0.73)
  {
    const basinCenter = activeSpine.getSampleAt(0.73).point;
    const entryPt = activeSpine.getSampleAt(0.66).point;
    const exitPt = activeSpine.getSampleAt(0.80).point;
    const angIn = Math.atan2(entryPt.z - basinCenter.z, entryPt.x - basinCenter.x);
    const angOut = Math.atan2(exitPt.z - basinCenter.z, exitPt.x - basinCenter.x);

    buildChamberPerimeterWalls(basinCenter, 16.8, 9.6, 16, 0.73, false, [angIn, angOut]);

    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const r = 14.8;
      const px = basinCenter.x + Math.cos(ang) * r;
      const pz = basinCenter.z + Math.sin(ang) * r;
      const py = basinCenter.y;

      if (i % 2 === 0) {
        const lotusCol = buildLotusHypostyleColumn({ height: 9.2, radius: 0.95 });
        lotusCol.position.set(px, py, pz);
        lotusCol.rotation.y = -ang;
        addNodeAtT(lotusCol, 0.73, false);
      } else {
        const obelisk = buildHieroglyphObelisk({ height: 11.5, baseWidth: 1.35 });
        obelisk.position.set(px, py, pz);
        obelisk.rotation.y = -ang;
        addNodeAtT(obelisk, 0.73, false);
      }
    }
  }

  // 4B. Continuous Canopic Mummy Catacombs (t = 0.825 -> 0.925)
  for (let tCat = 0.825; tCat <= 0.926; tCat += 0.014) {
    const s = activeSpine.getSampleAt(tCat);
    const hw = s.halfWidth;
    const yaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);

    const mod = buildTombCorridorMuralModule({
      length: 8.4,
      width: hw * 2 + 1.0,
      height: 8.2,
      hasCeiling: true,
      hasDoorwayLintel: Math.abs(tCat - 0.839) < 0.008 || Math.abs(tCat - 0.923) < 0.008,
    });
    mod.position.copy(s.point);
    mod.rotation.y = yaw;
    addNodeAtT(mod, tCat, false);

    if (Math.round(tCat * 1000) % 28 < 14) {
      for (const side of [-1, 1]) {
        const sarcPos = activeSpine.getWorldPos(tCat, side * (hw - 0.85), 0, false);
        const sarc = buildPharaohSarcophagus({ ajar: true, includeCanopicJars: true });
        sarc.position.copy(sarcPos);
        sarc.rotation.y = yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        addNodeAtT(sarc, tCat, false);

        placeBrazierAt(tCat + 0.006, side * (hw - 0.55), 0, false, Math.round(tCat * 500) + side);
      }
    }
  }

  // 4C. Pharaoh's Inner Burial Sanctum, High Pyramid Shaft & Solar Barque of Khufu-Ra (t = 0.95 -> 1.00)
  {
    const arenaSample = activeSpine.getSampleAt(0.96);
    const arenaCenter = arenaSample.point;
    const entryPt = activeSpine.getSampleAt(0.92).point;
    const angIn = Math.atan2(entryPt.z - arenaCenter.z, entryPt.x - arenaCenter.x);

    // Enclose the Boss 3 Pharaoh Sanctum with monumental Hieroglyph & Polychrome Mural Temple Walls
    buildChamberPerimeterWalls(arenaCenter, 18.2, 12.2, 16, 0.96, false, [angIn]);

    // Ring of Monumental Lotus Columns, Obelisks, Anubis Colossi & Gold Hoard Piles around Boss 3 Arena
    const ringCount = 12;
    for (let i = 0; i < ringCount; i++) {
      const ang = (i / ringCount) * Math.PI * 2 + 0.26;
      const r = 15.2;
      const rx = arenaCenter.x + Math.cos(ang) * r;
      const rz = arenaCenter.z + Math.sin(ang) * r;
      const ry = arenaCenter.y;

      if (i % 3 === 0) {
        const anubis = buildGreatSphinxOrAnubisColossus({ variant: 'anubis', height: 12.2 });
        anubis.position.set(rx, ry, rz);
        anubis.rotation.y = -ang - Math.PI / 2;
        addNodeAtT(anubis, 0.96, false);
        registerCylinder({
          id: `sanctum_anubis_${i}`,
          x: rx,
          y: ry,
          z: rz,
          r: 2.3,
          h: 11.5,
          kind: 'anubis_colossus',
        });
      } else if (i % 3 === 1) {
        const col = buildLotusHypostyleColumn({ height: 10.6, radius: 1.02 });
        col.position.set(rx, ry, rz);
        col.rotation.y = -ang;
        addNodeAtT(col, 0.96, false);
        registerCylinder({
          id: `sanctum_lotus_col_${i}`,
          x: rx,
          y: ry,
          z: rz,
          r: 1.15,
          h: 10.6,
          kind: 'lotus_column',
        });
      } else {
        const hoard = buildGoldTreasureRoomHoard({
          radius: 3.4,
          includeSarcophagus: i === 2 || i === 8,
          includeLight: options.includePointLights !== false,
          seed: 900 + i,
        });
        hoard.position.set(rx, ry, rz);
        hoard.rotation.y = -ang;
        addNodeAtT(hoard, 0.96, false);
        registerCylinder({
          id: `sanctum_hoard_${i}`,
          x: rx,
          y: ry,
          z: rz,
          r: 1.85,
          h: 2.2,
          kind: 'gold_hoard',
        });
      }
    }

    // High Stepped Pyramid Vault Shaft Opening directly above the Boss 3 Arena (y = +12m -> +34m)
    const vaultShaftGroup = new THREE.Group();
    vaultShaftGroup.position.copy(arenaCenter);
    for (let tier = 0; tier < 7; tier++) {
      const span = 35.0 - tier * 3.6;
      const tierY = 12.2 + tier * 2.8;
      const thickness = 2.6;
      for (let side = 0; side < 4; side++) {
        const beam = new THREE.Mesh(
          applyWorldSpaceBoxUVs(new THREE.BoxGeometry(span, 2.85, thickness), 0.16, 0.28),
          tier % 2 === 0 ? textureSuite.materials.hieroglyphRelief : textureSuite.materials.ancientMural
        );
        const a = (side * Math.PI) / 2;
        beam.position.set(Math.sin(a) * (span * 0.5), tierY, Math.cos(a) * (span * 0.5));
        beam.rotation.y = a;
        vaultShaftGroup.add(beam);
      }
    }
    addNodeAtT(vaultShaftGroup, 0.96, false);

    // Colossal Gilded Solar Barque of Khufu-Ra & Royal Sarcophagus Dais in the Pharaoh's Burial Sanctum (t = 0.995)
    const endSample = activeSpine.getSampleAt(0.995);
    const endYaw = Math.atan2(endSample.flatTangent.x, endSample.flatTangent.z);
    const barquePos = endSample.point.clone().addScaledVector(endSample.flatTangent, 2.2);
    const solarBarque = buildSolarBarqueOfRa({ length: 15.5 });
    solarBarque.position.copy(barquePos);
    solarBarque.rotation.y = endYaw + Math.PI / 2;
    addNodeAtT(solarBarque, 0.99, false);
  }

  // Per-frame animation update for flickering braziers & exterior/interior visibility
  const update = (dt, elapsed = 0, playerLoc = null) => {
    if (playerLoc) {
      const inTomb = Boolean(playerLoc.isBranch) || (playerLoc.t ?? 0) >= 0.238;
      exteriorDesertGroup.visible = !inTomb;
      interiorTombGroup.visible = inTomb;
    }
    const tNow = elapsed || performance.now() * 0.001;
    for (let i = 0; i < animatedProps.length; i++) {
      const p = animatedProps[i];
      if (p.kind === 'brazier' && p.brazier) {
        const fg = p.brazier.userData.flameGroup;
        const pl = p.brazier.userData.pointLight;
        const flicker = Math.sin(tNow * 11.3 + p.phase) * 0.12 + Math.cos(tNow * 17.7 + p.phase * 1.7) * 0.08;
        if (fg) {
          fg.scale.set(1.0 + flicker * 0.45, 1.0 + flicker * 0.95, 1.0 - flicker * 0.35);
          fg.rotation.y = tNow * 2.4 + p.phase;
        }
        if (pl) {
          pl.intensity = p.brazier.userData.baseIntensity * (1.0 + flicker);
        }
      }
    }
  };

  return {
    rootGroup,
    exteriorDesertGroup,
    interiorTombGroup,
    textureSuite,
    lightAnchors,
    solidObstacles,
    animatedProps,
    update,
  };
}
