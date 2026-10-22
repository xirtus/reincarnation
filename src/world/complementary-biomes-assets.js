import * as THREE from 'three';
import { buildVolumetricFirePlume } from '../render/shaders.js';

let _cachedComplementarySuite = null;

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
      let ny = dY * strength;
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
 * stone courses, ziggurat tiers, stave-hall timbers, and Atlantean marble blocks tile cleanly
 * without stretching a single [0..1] UV across colossal megastructures.
 */
export function applyWorldSpaceBoxUVs(geometry, scaleU = 0.16, scaleV = 0.22, lockV01 = false) {
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
 * Converts a cone/cylinder geometry into non-indexed flat-faceted geometry with sharp face normals.
 */
function makeFlatFacetedGeometry(geometry) {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

/**
 * Helper: Draws a 12-petalled Babylonian Ishtar Golden & White Glazed Rosette at (cx, cy).
 */
function drawBabylonianRosette(cCtx, hCtx, rCtx, mCtx, cx, cy, radius) {
  const petals = 12;
  for (let p = 0; p < petals; p++) {
    const ang = (p / petals) * Math.PI * 2;
    cCtx.save();
    cCtx.translate(cx, cy);
    cCtx.rotate(ang);
    cCtx.fillStyle = p % 2 === 0 ? '#f6ecd2' : '#ffcf48';
    cCtx.strokeStyle = '#0a2d52';
    cCtx.lineWidth = 1.6;
    cCtx.beginPath();
    cCtx.ellipse(0, -radius * 0.56, radius * 0.19, radius * 0.42, 0, 0, Math.PI * 2);
    cCtx.fill();
    cCtx.stroke();
    cCtx.restore();

    hCtx.save();
    hCtx.translate(cx, cy);
    hCtx.rotate(ang);
    hCtx.fillStyle = 'rgb(238, 238, 238)';
    hCtx.beginPath();
    hCtx.ellipse(0, -radius * 0.56, radius * 0.17, radius * 0.39, 0, 0, Math.PI * 2);
    hCtx.fill();
    hCtx.restore();

    mCtx.save();
    mCtx.translate(cx, cy);
    mCtx.rotate(ang);
    mCtx.fillStyle = p % 2 === 0 ? 'rgb(65, 65, 65)' : 'rgb(235, 235, 235)';
    mCtx.beginPath();
    mCtx.ellipse(0, -radius * 0.56, radius * 0.17, radius * 0.39, 0, 0, Math.PI * 2);
    mCtx.fill();
    mCtx.restore();
  }

  // Central golden boss
  cCtx.fillStyle = '#ffbf2e';
  cCtx.strokeStyle = '#754c08';
  cCtx.lineWidth = 2;
  cCtx.beginPath();
  cCtx.arc(cx, cy, radius * 0.28, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.stroke();

  hCtx.fillStyle = 'rgb(252, 252, 252)';
  hCtx.beginPath();
  hCtx.arc(cx, cy, radius * 0.28, 0, Math.PI * 2);
  hCtx.fill();

  rCtx.fillStyle = 'rgb(36, 36, 36)';
  rCtx.beginPath();
  rCtx.arc(cx, cy, radius * 0.92, 0, Math.PI * 2);
  rCtx.fill();

  mCtx.fillStyle = 'rgb(245, 245, 245)';
  mCtx.beginPath();
  mCtx.arc(cx, cy, radius * 0.28, 0, Math.PI * 2);
  mCtx.fill();
}

/**
 * Helper: Draws authentic Mesopotamian Cuneiform wedge impressions & solar emblems.
 */
function drawCuneiformWedgeCluster(cCtx, hCtx, rCtx, mCtx, cx, cy, size, variant = 0) {
  const s = size * 0.44;
  const drawWedge = (x, y, len, angle, isGold = false) => {
    for (const [ctx, mode] of [
      [cCtx, 'color'],
      [hCtx, 'height'],
      [rCtx, 'rough'],
      [mCtx, 'metal'],
    ]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      if (mode === 'color') {
        ctx.fillStyle = isGold ? '#cfa034' : '#573c20';
        ctx.strokeStyle = isGold ? '#ffe38a' : '#e6c594';
      } else if (mode === 'height') {
        ctx.fillStyle = 'rgb(42, 42, 42)';
        ctx.strokeStyle = 'rgb(218, 218, 218)';
      } else if (mode === 'rough') {
        ctx.fillStyle = isGold ? 'rgb(55, 55, 55)' : 'rgb(235, 235, 235)';
      } else {
        ctx.fillStyle = isGold ? 'rgb(225, 225, 225)' : 'rgb(20, 20, 20)';
      }
      // Triangular stylus head + tapered tail
      ctx.beginPath();
      ctx.moveTo(-len * 0.5, -s * 0.16);
      ctx.lineTo(-len * 0.5, s * 0.16);
      ctx.lineTo(-len * 0.12, 0);
      ctx.closePath();
      ctx.fill();

      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.beginPath();
      ctx.moveTo(-len * 0.35, 0);
      ctx.lineTo(len * 0.5, 0);
      ctx.stroke();
      ctx.restore();
    }
  };

  if (variant % 4 === 0) {
    // DINGIR (Star / Deity Ideogram) in gold & lapis
    drawWedge(cx, cy, s * 1.4, 0, true);
    drawWedge(cx, cy, s * 1.4, Math.PI / 2, true);
    drawWedge(cx, cy, s * 1.25, Math.PI / 4, false);
    drawWedge(cx, cy, s * 1.25, -Math.PI / 4, false);
  } else if (variant % 4 === 1) {
    // Babylonian Royal Name Triad
    drawWedge(cx - s * 0.45, cy - s * 0.28, s * 0.95, 0, false);
    drawWedge(cx - s * 0.45, cy + s * 0.28, s * 0.95, 0, false);
    drawWedge(cx + s * 0.35, cy, s * 1.15, Math.PI / 2, true);
  } else if (variant % 4 === 2) {
    // Shamash Eight-Rayed Solar Star
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      drawWedge(cx + Math.cos(a) * s * 0.15, cy + Math.sin(a) * s * 0.15, s * 0.9, a, r % 2 === 0);
    }
  } else {
    // Stacked Akkadian Law Code Wedges
    drawWedge(cx, cy - s * 0.36, s * 1.25, 0, false);
    drawWedge(cx - s * 0.3, cy + s * 0.05, s * 0.85, Math.PI / 2, false);
    drawWedge(cx + s * 0.25, cy + s * 0.05, s * 0.85, Math.PI / 2, true);
    drawWedge(cx, cy + s * 0.38, s * 1.1, 0.22, false);
  }
}

/**
 * Helper: Draws glowing Elder Futhark Nordic Runes onto color, height, and emissive canvases.
 */
function drawElderFutharkRune(cCtx, hCtx, eCtx, cx, cy, size, runeIdx = 0) {
  const s = size * 0.42;
  const strokePath = (ctx) => {
    ctx.beginPath();
    const g = runeIdx % 8;
    if (g === 0) {
      // Algiz (Protection / Valkyrie Swan)
      ctx.moveTo(0, -s);
      ctx.lineTo(0, s);
      ctx.moveTo(0, -s * 0.15);
      ctx.lineTo(-s * 0.65, -s * 0.85);
      ctx.moveTo(0, -s * 0.15);
      ctx.lineTo(s * 0.65, -s * 0.85);
    } else if (g === 1) {
      // Othala (Ancestral Hall / Valhalla)
      ctx.moveTo(-s * 0.55, s * 0.9);
      ctx.lineTo(s * 0.55, -s * 0.25);
      ctx.lineTo(0, -s * 0.88);
      ctx.lineTo(-s * 0.55, -s * 0.25);
      ctx.lineTo(s * 0.55, s * 0.9);
    } else if (g === 2) {
      // Tiwaz (Tyr's Spear / Victory)
      ctx.moveTo(0, -s * 0.92);
      ctx.lineTo(0, s * 0.92);
      ctx.moveTo(-s * 0.62, -s * 0.32);
      ctx.lineTo(0, -s * 0.92);
      ctx.lineTo(s * 0.62, -s * 0.32);
    } else if (g === 3) {
      // Fehu (Gold / Cosmic Fire)
      ctx.moveTo(-s * 0.35, -s * 0.9);
      ctx.lineTo(-s * 0.35, s * 0.9);
      ctx.moveTo(-s * 0.35, -s * 0.25);
      ctx.lineTo(s * 0.55, -s * 0.88);
      ctx.moveTo(-s * 0.35, s * 0.25);
      ctx.lineTo(s * 0.48, -s * 0.25);
    } else if (g === 4) {
      // Sowilo (Sun / Lightning Bolt)
      ctx.moveTo(s * 0.48, -s * 0.9);
      ctx.lineTo(-s * 0.48, -s * 0.05);
      ctx.lineTo(s * 0.48, s * 0.05);
      ctx.lineTo(-s * 0.48, s * 0.9);
    } else if (g === 5) {
      // Berkano (Yggdrasil Birch / Rebirth)
      ctx.moveTo(-s * 0.42, -s * 0.9);
      ctx.lineTo(-s * 0.42, s * 0.9);
      ctx.moveTo(-s * 0.42, -s * 0.85);
      ctx.lineTo(s * 0.45, -s * 0.42);
      ctx.lineTo(-s * 0.42, 0);
      ctx.lineTo(s * 0.45, s * 0.45);
      ctx.lineTo(-s * 0.42, s * 0.85);
    } else if (g === 6) {
      // Dagaz (Dawn / Bifrost Awakening)
      ctx.moveTo(-s * 0.58, -s * 0.78);
      ctx.lineTo(-s * 0.58, s * 0.78);
      ctx.lineTo(s * 0.58, -s * 0.78);
      ctx.lineTo(s * 0.58, s * 0.78);
      ctx.closePath();
    } else {
      // Gebo / Bind-Rune of Odin
      ctx.moveTo(-s * 0.62, -s * 0.82);
      ctx.lineTo(s * 0.62, s * 0.82);
      ctx.moveTo(s * 0.62, -s * 0.82);
      ctx.lineTo(-s * 0.62, s * 0.82);
      ctx.moveTo(0, -s * 0.95);
      ctx.lineTo(0, s * 0.95);
    }
    ctx.stroke();
  };

  // Outer carved bevel on height canvas
  hCtx.save();
  hCtx.translate(cx, cy);
  hCtx.strokeStyle = 'rgb(225, 225, 225)';
  hCtx.lineWidth = Math.max(6, s * 0.34);
  hCtx.lineCap = 'round';
  hCtx.lineJoin = 'round';
  strokePath(hCtx);
  hCtx.strokeStyle = 'rgb(18, 18, 18)';
  hCtx.lineWidth = Math.max(3, s * 0.19);
  strokePath(hCtx);
  hCtx.restore();

  // Glowing cyan-aurora (#38f2ff) rune core
  cCtx.save();
  cCtx.translate(cx, cy);
  cCtx.strokeStyle = '#135f78';
  cCtx.lineWidth = Math.max(6, s * 0.34);
  cCtx.lineCap = 'round';
  cCtx.lineJoin = 'round';
  strokePath(cCtx);
  cCtx.strokeStyle = '#38f2ff';
  cCtx.lineWidth = Math.max(2.5, s * 0.16);
  strokePath(cCtx);
  cCtx.restore();

  eCtx.save();
  eCtx.translate(cx, cy);
  eCtx.strokeStyle = '#38f2ff';
  eCtx.shadowColor = '#38f2ff';
  eCtx.shadowBlur = 10;
  eCtx.lineWidth = Math.max(3, s * 0.2);
  eCtx.lineCap = 'round';
  eCtx.lineJoin = 'round';
  strokePath(eCtx);
  eCtx.restore();
}

/**
 * 1. Generates and caches rich 1024x1024 procedural PBR `THREE.CanvasTexture` sets
 *    (composited with PolyHaven `sandstone_blocks_04` / `aerial_rocks_02` where appropriate):
 *    - `babylonLapisBrick`
 *    - `babylonCuneiformRelief`
 *    - `valhallaRunestone`
 *    - `valhallaTimberGold`
 *    - `atlantisMarbleOrichalcum`
 */
export function createComplementaryBiomeTextureSuite(maxAnisotropy = 8) {
  if (_cachedComplementarySuite) return _cachedComplementarySuite;

  const W = 1024;
  const H = 1024;

  // ============================================================================
  // A. BABYLON LAPIS BRICK (1024x1024 Glazed Ishtar Cobalt-Lapis #0e4d8a / #1367A0
  //    & Turquoise coursed brick masonry with embossed golden rosette friezes)
  // ============================================================================
  const lapisColor = document.createElement('canvas');
  const lapisHeight = document.createElement('canvas');
  const lapisRough = document.createElement('canvas');
  const lapisMetal = document.createElement('canvas');
  lapisColor.width = lapisHeight.width = lapisRough.width = lapisMetal.width = W;
  lapisColor.height = lapisHeight.height = lapisRough.height = lapisMetal.height = H;

  const lcCtx = lapisColor.getContext('2d');
  const lhCtx = lapisHeight.getContext('2d');
  const lrCtx = lapisRough.getContext('2d');
  const lmCtx = lapisMetal.getContext('2d');

  lcCtx.fillStyle = '#0e4d8a';
  lcCtx.fillRect(0, 0, W, H);
  lhCtx.fillStyle = 'rgb(176, 176, 176)';
  lhCtx.fillRect(0, 0, W, H);
  lrCtx.fillStyle = 'rgb(52, 52, 52)'; // Vitreous glazed ceramic sheen
  lrCtx.fillRect(0, 0, W, H);
  lmCtx.fillStyle = 'rgb(38, 38, 38)';
  lmCtx.fillRect(0, 0, W, H);

  const brickRows = 16;
  const rowH = H / brickRows;
  const bricksPerRow = 8;
  const brickW = W / bricksPerRow;

  for (let r = 0; r < brickRows; r++) {
    const y0 = r * rowH;
    const isFriezeBand = r === 2 || r === 13;
    const isTurquoiseTrim = r === 1 || r === 3 || r === 12 || r === 14;
    const offset = (r % 2) * (brickW * 0.5);

    for (let b = -1; b <= bricksPerRow; b++) {
      const x0 = b * brickW + offset;
      const seed = r * 31 + b * 17;
      const shift = Math.round((seededRandom(seed) - 0.5) * 26);

      if (isTurquoiseTrim) {
        lcCtx.fillStyle = b % 2 === 0 ? '#189ab4' : '#d4af37';
      } else {
        const red = Math.max(8, Math.min(40, 16 + shift));
        const green = Math.max(60, Math.min(130, 88 + shift));
        const blue = Math.max(115, Math.min(195, 152 + shift));
        lcCtx.fillStyle = `rgb(${red},${green},${blue})`;
      }
      lcCtx.fillRect(x0 + 3, y0 + 3, brickW - 6, rowH - 6);

      // Glazed upper highlight & bottom bevel
      lcCtx.fillStyle = 'rgba(130, 215, 255, 0.28)';
      lcCtx.fillRect(x0 + 4, y0 + 4, brickW - 8, 4);
      lcCtx.fillStyle = 'rgba(4, 18, 38, 0.52)';
      lcCtx.fillRect(x0 + 4, y0 + rowH - 8, brickW - 8, 4);

      const hVal = Math.round(182 + (seededRandom(seed + 9) - 0.5) * 34);
      lhCtx.fillStyle = `rgb(${hVal},${hVal},${hVal})`;
      lhCtx.fillRect(x0 + 4, y0 + 4, brickW - 8, rowH - 8);

      // Mortar joints
      lcCtx.strokeStyle = '#072241';
      lcCtx.lineWidth = 5;
      lcCtx.strokeRect(x0, y0, brickW, rowH);

      lhCtx.strokeStyle = 'rgb(20, 20, 20)';
      lhCtx.lineWidth = 6;
      lhCtx.strokeRect(x0, y0, brickW, rowH);

      lrCtx.strokeStyle = 'rgb(215, 215, 215)';
      lrCtx.lineWidth = 6;
      lrCtx.strokeRect(x0, y0, brickW, rowH);

      if (isTurquoiseTrim && b % 2 !== 0) {
        lmCtx.fillStyle = 'rgb(235, 235, 235)';
        lmCtx.fillRect(x0 + 4, y0 + 4, brickW - 8, rowH - 8);
      }
    }

    if (isFriezeBand) {
      // Embossed Golden & Ivory Ishtar Rosettes along the frieze course
      const count = 8;
      for (let k = 0; k < count; k++) {
        const rcx = (k + 0.5) * (W / count);
        const rcy = y0 + rowH * 0.5;
        drawBabylonianRosette(lcCtx, lhCtx, lrCtx, lmCtx, rcx, rcy, rowH * 0.44);
      }
    }
  }

  // Central Embossed Golden Striding Marduk Dragon / Bull Medallions
  for (let m = 0; m < 4; m++) {
    const mcx = (m + 0.5) * (W / 4);
    const mcy = H * 0.5;
    drawBabylonianRosette(lcCtx, lhCtx, lrCtx, lmCtx, mcx, mcy, 58);
  }

  const babylonLapisMap = configureCanvasTexture(lapisColor, true, maxAnisotropy);
  const babylonLapisNormal = createNormalMapFromHeightCanvas(lapisHeight, 4.2, maxAnisotropy);
  const babylonLapisRough = configureCanvasTexture(lapisRough, false, maxAnisotropy);
  const babylonLapisMetal = configureCanvasTexture(lapisMetal, false, maxAnisotropy);

  // ============================================================================
  // B. BABYLON CUNEIFORM RELIEF (1024x1024 Mesopotamian limestone blocks chiseled
  //    with Cuneiform wedge inscriptions, winged solar emblems & Lamassu relief)
  // ============================================================================
  const cuneiColor = document.createElement('canvas');
  const cuneiHeight = document.createElement('canvas');
  const cuneiRough = document.createElement('canvas');
  const cuneiMetal = document.createElement('canvas');
  cuneiColor.width = cuneiHeight.width = cuneiRough.width = cuneiMetal.width = W;
  cuneiColor.height = cuneiHeight.height = cuneiRough.height = cuneiMetal.height = H;

  const ccCtx = cuneiColor.getContext('2d');
  const chCtx = cuneiHeight.getContext('2d');
  const crCtx = cuneiRough.getContext('2d');
  const cmCtx = cuneiMetal.getContext('2d');

  ccCtx.fillStyle = '#cfa86e';
  ccCtx.fillRect(0, 0, W, H);
  chCtx.fillStyle = 'rgb(180, 180, 180)';
  chCtx.fillRect(0, 0, W, H);
  crCtx.fillStyle = 'rgb(218, 218, 218)';
  crCtx.fillRect(0, 0, W, H);
  cmCtx.fillStyle = 'rgb(24, 24, 24)';
  cmCtx.fillRect(0, 0, W, H);

  const stoneCourses = 8;
  const stoneH = H / stoneCourses;
  for (let row = 0; row < stoneCourses; row++) {
    const y0 = row * stoneH;
    const cols = 4;
    const colW = W / cols;
    const off = (row % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x0 = c * colW + off;
      const seed = row * 19 + c * 29;
      const delta = Math.round((seededRandom(seed) - 0.5) * 28);
      ccCtx.fillStyle = `rgb(${208 + delta}, ${168 + delta}, ${112 + delta})`;
      ccCtx.fillRect(x0 + 4, y0 + 4, colW - 8, stoneH - 8);

      const hBlock = Math.round(175 + (seededRandom(seed + 3) - 0.5) * 30);
      chCtx.fillStyle = `rgb(${hBlock},${hBlock},${hBlock})`;
      chCtx.fillRect(x0 + 5, y0 + 5, colW - 10, stoneH - 10);

      ccCtx.strokeStyle = '#4a3319';
      ccCtx.lineWidth = 6;
      ccCtx.strokeRect(x0, y0, colW, stoneH);

      chCtx.strokeStyle = 'rgb(22, 22, 22)';
      chCtx.lineWidth = 8;
      chCtx.strokeRect(x0, y0, colW, stoneH);
    }

    // Chisel dense horizontal registers of Cuneiform wedges across each stone course
    const glyphCols = 12;
    const cellW = W / glyphCols;
    for (let g = 0; g < glyphCols; g++) {
      const gx = (g + 0.5) * cellW;
      const gy = y0 + stoneH * 0.5;
      drawCuneiformWedgeCluster(ccCtx, chCtx, crCtx, cmCtx, gx, gy, Math.min(cellW, stoneH) * 0.82, row * 7 + g);
    }
  }

  const babylonCuneiMap = configureCanvasTexture(cuneiColor, true, maxAnisotropy);
  const babylonCuneiNormal = createNormalMapFromHeightCanvas(cuneiHeight, 4.4, maxAnisotropy);
  const babylonCuneiRough = configureCanvasTexture(cuneiRough, false, maxAnisotropy);
  const babylonCuneiMetal = configureCanvasTexture(cuneiMetal, false, maxAnisotropy);

  // ============================================================================
  // C. VALHALLA RUNESTONE (1024x1024 Weathered Nordic dark granite & carved
  //    knotwork monoliths with glowing cyan-aurora #38f2ff Elder Futhark runes)
  // ============================================================================
  const runeColor = document.createElement('canvas');
  const runeHeight = document.createElement('canvas');
  const runeRough = document.createElement('canvas');
  const runeMetal = document.createElement('canvas');
  const runeEmissive = document.createElement('canvas');
  runeColor.width = runeHeight.width = runeRough.width = runeMetal.width = runeEmissive.width = W;
  runeColor.height = runeHeight.height = runeRough.height = runeMetal.height = runeEmissive.height = H;

  const rcCtx = runeColor.getContext('2d');
  const rhCtx = runeHeight.getContext('2d');
  const rrCtx = runeRough.getContext('2d');
  const rmCtx = runeMetal.getContext('2d');
  const reCtx = runeEmissive.getContext('2d');

  rcCtx.fillStyle = '#262d38';
  rcCtx.fillRect(0, 0, W, H);
  rhCtx.fillStyle = 'rgb(160, 160, 160)';
  rhCtx.fillRect(0, 0, W, H);
  rrCtx.fillStyle = 'rgb(212, 212, 212)';
  rrCtx.fillRect(0, 0, W, H);
  rmCtx.fillStyle = 'rgb(32, 32, 32)';
  rmCtx.fillRect(0, 0, W, H);
  reCtx.fillStyle = '#000000';
  reCtx.fillRect(0, 0, W, H);

  // Nordic granite blocks & glacial striations
  const gRows = 8;
  const gH = H / gRows;
  for (let r = 0; r < gRows; r++) {
    const y0 = r * gH;
    const gCols = 4;
    const gW = W / gCols;
    const off = (r % 2) * (gW * 0.5);
    for (let c = -1; c <= gCols; c++) {
      const x0 = c * gW + off;
      const seed = r * 23 + c * 41;
      const v = Math.round((seededRandom(seed) - 0.5) * 22);
      rcCtx.fillStyle = `rgb(${38 + v}, ${46 + v}, ${58 + v})`;
      rcCtx.fillRect(x0 + 4, y0 + 4, gW - 8, gH - 8);

      const hVal = Math.round(165 + (seededRandom(seed + 7) - 0.5) * 36);
      rhCtx.fillStyle = `rgb(${hVal},${hVal},${hVal})`;
      rhCtx.fillRect(x0 + 5, y0 + 5, gW - 10, gH - 10);

      rcCtx.strokeStyle = '#11161d';
      rcCtx.lineWidth = 7;
      rcCtx.strokeRect(x0, y0, gW, gH);

      rhCtx.strokeStyle = 'rgb(16, 16, 16)';
      rhCtx.lineWidth = 8;
      rhCtx.strokeRect(x0, y0, gW, gH);
    }
  }

  // Carved Urnes-style Nordic Dragon Interlace Knotwork Borders (top, middle, bottom)
  for (const bandY of [64, 512, 960]) {
    rcCtx.fillStyle = '#1b222c';
    rcCtx.fillRect(0, bandY - 34, W, 68);
    rcCtx.strokeStyle = '#c89e46';
    rcCtx.lineWidth = 4;
    rcCtx.strokeRect(0, bandY - 34, W, 68);

    rhCtx.strokeStyle = 'rgb(232, 232, 232)';
    rhCtx.lineWidth = 5;
    rhCtx.strokeRect(0, bandY - 34, W, 68);

    // Sinusoidal braided knotwork waves
    for (const phase of [0, Math.PI]) {
      rcCtx.strokeStyle = phase === 0 ? '#d8b25c' : '#38f2ff';
      rcCtx.lineWidth = 6;
      rcCtx.beginPath();
      rhCtx.strokeStyle = 'rgb(242, 242, 242)';
      rhCtx.lineWidth = 8;
      rhCtx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = bandY + Math.sin((x / W) * Math.PI * 16 + phase) * 20;
        if (x === 0) {
          rcCtx.moveTo(x, y);
          rhCtx.moveTo(x, y);
        } else {
          rcCtx.lineTo(x, y);
          rhCtx.lineTo(x, y);
        }
      }
      rcCtx.stroke();
      rhCtx.stroke();
    }
  }

  // Glowing Cyan-Aurora (#38f2ff) Elder Futhark Rune Inscriptions across the granite bands
  const runeBandYs = [192, 340, 668, 820];
  for (let bIdx = 0; bIdx < runeBandYs.length; bIdx++) {
    const by = runeBandYs[bIdx];
    const runeCount = 10;
    for (let k = 0; k < runeCount; k++) {
      const rx = (k + 0.5) * (W / runeCount);
      drawElderFutharkRune(rcCtx, rhCtx, reCtx, rx, by, 86, bIdx * 11 + k);
    }
  }

  const valhallaRuneMap = configureCanvasTexture(runeColor, true, maxAnisotropy);
  const valhallaRuneNormal = createNormalMapFromHeightCanvas(runeHeight, 4.4, maxAnisotropy);
  const valhallaRuneRough = configureCanvasTexture(runeRough, false, maxAnisotropy);
  const valhallaRuneMetal = configureCanvasTexture(runeMetal, false, maxAnisotropy);
  const valhallaRuneEmissive = configureCanvasTexture(runeEmissive, true, maxAnisotropy);

  // ============================================================================
  // D. VALHALLA TIMBER GOLD (1024x1024 Norwegian stave-church dark oak timber
  //    framing with gilded bronze dragon-knotwork trim & round Viking shields)
  // ============================================================================
  const timberColor = document.createElement('canvas');
  const timberHeight = document.createElement('canvas');
  const timberRough = document.createElement('canvas');
  const timberMetal = document.createElement('canvas');
  timberColor.width = timberHeight.width = timberRough.width = timberMetal.width = W;
  timberColor.height = timberHeight.height = timberRough.height = timberMetal.height = H;

  const tcCtx = timberColor.getContext('2d');
  const thCtx = timberHeight.getContext('2d');
  const trCtx = timberRough.getContext('2d');
  const tmCtx = timberMetal.getContext('2d');

  tcCtx.fillStyle = '#2d1c10';
  tcCtx.fillRect(0, 0, W, H);
  thCtx.fillStyle = 'rgb(155, 155, 155)';
  thCtx.fillRect(0, 0, W, H);
  trCtx.fillStyle = 'rgb(210, 210, 210)';
  trCtx.fillRect(0, 0, W, H);
  tmCtx.fillStyle = 'rgb(20, 20, 20)';
  tmCtx.fillRect(0, 0, W, H);

  // Heavy Stave-Church Oak Planks + Wood Grain Fibers
  const planks = 8;
  const plankW = W / planks;
  for (let p = 0; p < planks; p++) {
    const x0 = p * plankW;
    const tone = Math.round((seededRandom(p * 13.7) - 0.5) * 20);
    tcCtx.fillStyle = `rgb(${48 + tone}, ${30 + tone}, ${18 + tone})`;
    tcCtx.fillRect(x0 + 3, 0, plankW - 6, H);

    // Wood grain lines
    for (let f = 0; f < 28; f++) {
      const fx = x0 + 6 + seededRandom(p * 100 + f) * (plankW - 12);
      tcCtx.strokeStyle = f % 2 === 0 ? 'rgba(20, 10, 4, 0.45)' : 'rgba(92, 58, 32, 0.30)';
      tcCtx.lineWidth = 2;
      tcCtx.beginPath();
      tcCtx.moveTo(fx, 0);
      tcCtx.bezierCurveTo(fx + 6, H * 0.33, fx - 6, H * 0.66, fx, H);
      tcCtx.stroke();

      thCtx.strokeStyle = f % 2 === 0 ? 'rgb(118, 118, 118)' : 'rgb(182, 182, 182)';
      thCtx.lineWidth = 2;
      thCtx.beginPath();
      thCtx.moveTo(fx, 0);
      thCtx.bezierCurveTo(fx + 6, H * 0.33, fx - 6, H * 0.66, fx, H);
      thCtx.stroke();
    }

    tcCtx.strokeStyle = '#120a04';
    tcCtx.lineWidth = 6;
    tcCtx.strokeRect(x0, 0, plankW, H);
    thCtx.strokeStyle = 'rgb(20, 20, 20)';
    thCtx.lineWidth = 7;
    thCtx.strokeRect(x0, 0, plankW, H);
  }

  // Horizontal Gilded Bronze Dragon-Scale Bands & Mounted Viking War-Shields
  for (const bandY of [220, 780]) {
    tcCtx.fillStyle = '#b88628';
    tcCtx.fillRect(0, bandY - 36, W, 72);
    tcCtx.strokeStyle = '#ffe07d';
    tcCtx.lineWidth = 5;
    tcCtx.strokeRect(0, bandY - 36, W, 72);

    thCtx.fillStyle = 'rgb(225, 225, 225)';
    thCtx.fillRect(0, bandY - 34, W, 68);
    trCtx.fillStyle = 'rgb(52, 52, 52)';
    trCtx.fillRect(0, bandY - 34, W, 68);
    tmCtx.fillStyle = 'rgb(242, 242, 242)';
    tmCtx.fillRect(0, bandY - 34, W, 68);

    // Round Viking Shields along the stave beam
    const shieldCount = 6;
    for (let s = 0; s < shieldCount; s++) {
      const scx = (s + 0.5) * (W / shieldCount);
      const scy = bandY;
      const sr = 58;

      tcCtx.fillStyle = s % 2 === 0 ? '#8c1d18' : '#124e78';
      tcCtx.strokeStyle = '#ffcf48';
      tcCtx.lineWidth = 8;
      tcCtx.beginPath();
      tcCtx.arc(scx, scy, sr, 0, Math.PI * 2);
      tcCtx.fill();
      tcCtx.stroke();

      // Iron/Gold umbo boss at center of shield
      tcCtx.fillStyle = '#ffe07d';
      tcCtx.beginPath();
      tcCtx.arc(scx, scy, sr * 0.32, 0, Math.PI * 2);
      tcCtx.fill();

      thCtx.fillStyle = 'rgb(248, 248, 248)';
      thCtx.beginPath();
      thCtx.arc(scx, scy, sr, 0, Math.PI * 2);
      thCtx.fill();

      tmCtx.fillStyle = 'rgb(245, 245, 245)';
      tmCtx.beginPath();
      tmCtx.arc(scx, scy, sr * 0.35, 0, Math.PI * 2);
      tmCtx.fill();
    }
  }

  const valhallaTimberMap = configureCanvasTexture(timberColor, true, maxAnisotropy);
  const valhallaTimberNormal = createNormalMapFromHeightCanvas(timberHeight, 3.8, maxAnisotropy);
  const valhallaTimberRough = configureCanvasTexture(timberRough, false, maxAnisotropy);
  const valhallaTimberMetal = configureCanvasTexture(timberMetal, false, maxAnisotropy);

  // ============================================================================
  // E. ATLANTIS MARBLE ORICHALCUM (1024x1024 White veined Paros marble inlaid with
  //    gleaming Atlantean Orichalcum #ff8c38 / #ffd266 geometric wave-meander
  //    friezes and bioluminescent cyan-magenta coral veins)
  // ============================================================================
  const atlColor = document.createElement('canvas');
  const atlHeight = document.createElement('canvas');
  const atlRough = document.createElement('canvas');
  const atlMetal = document.createElement('canvas');
  const atlEmissive = document.createElement('canvas');
  atlColor.width = atlHeight.width = atlRough.width = atlMetal.width = atlEmissive.width = W;
  atlColor.height = atlHeight.height = atlRough.height = atlMetal.height = atlEmissive.height = H;

  const acCtx = atlColor.getContext('2d');
  const ahCtx = atlHeight.getContext('2d');
  const arCtx = atlRough.getContext('2d');
  const amCtx = atlMetal.getContext('2d');
  const aeCtx = atlEmissive.getContext('2d');

  acCtx.fillStyle = '#e8eef2';
  acCtx.fillRect(0, 0, W, H);
  ahCtx.fillStyle = 'rgb(186, 186, 186)';
  ahCtx.fillRect(0, 0, W, H);
  arCtx.fillStyle = 'rgb(64, 64, 64)'; // Polished Paros marble & Orichalcum
  arCtx.fillRect(0, 0, W, H);
  amCtx.fillStyle = 'rgb(28, 28, 28)';
  amCtx.fillRect(0, 0, W, H);
  aeCtx.fillStyle = '#000000';
  aeCtx.fillRect(0, 0, W, H);

  // Ashlar Paros Marble blocks with natural blue-grey & bioluminescent veins
  const mRows = 6;
  const mH = H / mRows;
  for (let r = 0; r < mRows; r++) {
    const y0 = r * mH;
    const mCols = 4;
    const mW = W / mCols;
    const off = (r % 2) * (mW * 0.5);
    for (let c = -1; c <= mCols; c++) {
      const x0 = c * mW + off;
      const seed = r * 17 + c * 37;
      const shift = Math.round((seededRandom(seed) - 0.5) * 14);
      acCtx.fillStyle = `rgb(${232 + shift}, ${238 + shift}, ${244 + shift})`;
      acCtx.fillRect(x0 + 3, y0 + 3, mW - 6, mH - 6);

      // Orichalcum (#ff8c38 / #ffd266) inlaid ashlar border around each marble block
      acCtx.strokeStyle = '#ff9c42';
      acCtx.lineWidth = 5;
      acCtx.strokeRect(x0 + 8, y0 + 8, mW - 16, mH - 16);

      ahCtx.strokeStyle = 'rgb(236, 236, 236)';
      ahCtx.lineWidth = 6;
      ahCtx.strokeRect(x0 + 8, y0 + 8, mW - 16, mH - 16);

      amCtx.strokeStyle = 'rgb(245, 245, 245)';
      amCtx.lineWidth = 7;
      amCtx.strokeRect(x0 + 8, y0 + 8, mW - 16, mH - 16);

      arCtx.strokeStyle = 'rgb(32, 32, 32)';
      arCtx.lineWidth = 7;
      arCtx.strokeRect(x0 + 8, y0 + 8, mW - 16, mH - 16);
    }
  }

  // Bioluminescent Cyan (#28f0ff) & Magenta (#ff38b8) Coral Veins coursing through the marble
  for (let v = 0; v < 24; v++) {
    const startX = seededRandom(v * 9.3) * W;
    const startY = seededRandom(v * 14.7) * H;
    const isCyan = v % 2 === 0;
    const veinColor = isCyan ? '#1ee8ff' : '#ff3ca8';

    for (const [ctx, isEm] of [
      [acCtx, false],
      [aeCtx, true],
    ]) {
      ctx.save();
      ctx.strokeStyle = veinColor;
      ctx.lineWidth = isEm ? 3.5 : 2.5;
      ctx.globalAlpha = isEm ? 0.65 : 0.55;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      let vx = startX;
      let vy = startY;
      for (let seg = 0; seg < 6; seg++) {
        vx += (seededRandom(v * 30 + seg) - 0.3) * 110;
        vy += (seededRandom(v * 50 + seg) - 0.5) * 70;
        ctx.lineTo(vx, vy);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Gleaming Atlantean Orichalcum (#ff8c38 / #ffd266) Wave-Meander & Concentric Ring Friezes
  for (const friezeY of [170, 512, 854]) {
    const grad = acCtx.createLinearGradient(0, friezeY - 40, 0, friezeY + 40);
    grad.addColorStop(0, '#ff8c38');
    grad.addColorStop(0.5, '#ffd266');
    grad.addColorStop(1, '#d96218');

    acCtx.fillStyle = grad;
    acCtx.fillRect(0, friezeY - 38, W, 76);

    ahCtx.fillStyle = 'rgb(242, 242, 242)';
    ahCtx.fillRect(0, friezeY - 38, W, 76);
    arCtx.fillStyle = 'rgb(34, 34, 34)';
    arCtx.fillRect(0, friezeY - 38, W, 76);
    amCtx.fillStyle = 'rgb(248, 248, 248)';
    amCtx.fillRect(0, friezeY - 38, W, 76);

    // Recessed Greek/Atlantean Wave-Meander Scroll in deep oceanic turquoise & bioluminescence
    const steps = 16;
    const stepW = W / steps;
    for (let k = 0; k < steps; k++) {
      const mx = k * stepW + stepW * 0.5;
      acCtx.strokeStyle = '#0c4b6e';
      acCtx.lineWidth = 5;
      acCtx.beginPath();
      acCtx.arc(mx, friezeY, 22, 0, Math.PI * 1.65);
      acCtx.stroke();

      ahCtx.strokeStyle = 'rgb(60, 60, 60)';
      ahCtx.lineWidth = 6;
      ahCtx.beginPath();
      ahCtx.arc(mx, friezeY, 22, 0, Math.PI * 1.65);
      ahCtx.stroke();

      aeCtx.fillStyle = k % 2 === 0 ? '#28f0ff' : '#ff48b0';
      aeCtx.beginPath();
      aeCtx.arc(mx, friezeY, 6, 0, Math.PI * 2);
      aeCtx.fill();
    }
  }

  const atlantisMarbleMap = configureCanvasTexture(atlColor, true, maxAnisotropy);
  const atlantisMarbleNormal = createNormalMapFromHeightCanvas(atlHeight, 3.8, maxAnisotropy);
  const atlantisMarbleRough = configureCanvasTexture(atlRough, false, maxAnisotropy);
  const atlantisMarbleMetal = configureCanvasTexture(atlMetal, false, maxAnisotropy);
  const atlantisMarbleEmissive = configureCanvasTexture(atlEmissive, true, maxAnisotropy);

  // Asynchronously composite PolyHaven `sandstone_blocks_04` / `aerial_rocks_02` photogrammetry grain
  if (typeof window !== 'undefined') {
    const loader = new THREE.TextureLoader();
    loader.load(
      '/textures/polyhaven/sandstone_blocks_04/sandstone_blocks_04_diff_1k.jpg',
      (tex) => {
        const img = tex?.image;
        if (!img) return;
        ccCtx.save();
        ccCtx.globalAlpha = 0.36;
        ccCtx.globalCompositeOperation = 'multiply';
        ccCtx.drawImage(img, 0, 0, W, H);
        ccCtx.restore();
        babylonCuneiMap.needsUpdate = true;

        lcCtx.save();
        lcCtx.globalAlpha = 0.22;
        lcCtx.globalCompositeOperation = 'multiply';
        lcCtx.drawImage(img, 0, 0, W, H);
        lcCtx.restore();
        babylonLapisMap.needsUpdate = true;
      },
      undefined,
      () => {}
    );
    loader.load(
      '/textures/polyhaven/aerial_rocks_02_diff_1k.jpg',
      (tex) => {
        const img = tex?.image;
        if (!img) return;
        rcCtx.save();
        rcCtx.globalAlpha = 0.34;
        rcCtx.globalCompositeOperation = 'multiply';
        rcCtx.drawImage(img, 0, 0, W, H);
        rcCtx.restore();
        valhallaRuneMap.needsUpdate = true;
      },
      undefined,
      () => {}
    );
  }

  // Construct shared PBR materials
  const babylonLapisBrickMaterial = new THREE.MeshStandardMaterial({
    name: 'BabylonLapisBrick',
    map: babylonLapisMap,
    normalMap: babylonLapisNormal,
    normalScale: new THREE.Vector2(2.2, 2.2),
    roughnessMap: babylonLapisRough,
    metalnessMap: babylonLapisMetal,
    emissiveMap: babylonLapisMap,
    emissive: new THREE.Color(0x1367a0),
    emissiveIntensity: 0.10,
    roughness: 0.32,
    metalness: 0.24,
  });

  const babylonCuneiformReliefMaterial = new THREE.MeshStandardMaterial({
    name: 'BabylonCuneiformRelief',
    map: babylonCuneiMap,
    normalMap: babylonCuneiNormal,
    normalScale: new THREE.Vector2(2.35, 2.35),
    roughnessMap: babylonCuneiRough,
    metalnessMap: babylonCuneiMetal,
    emissiveMap: babylonCuneiMap,
    emissive: new THREE.Color(0xc88d3a),
    emissiveIntensity: 0.06,
    roughness: 0.82,
    metalness: 0.14,
  });

  const valhallaRunestoneMaterial = new THREE.MeshStandardMaterial({
    name: 'ValhallaRunestone',
    map: valhallaRuneMap,
    normalMap: valhallaRuneNormal,
    normalScale: new THREE.Vector2(2.3, 2.3),
    roughnessMap: valhallaRuneRough,
    metalnessMap: valhallaRuneMetal,
    emissiveMap: valhallaRuneEmissive,
    emissive: new THREE.Color(0x38f2ff),
    emissiveIntensity: 0.85,
    roughness: 0.78,
    metalness: 0.18,
  });

  const valhallaTimberGoldMaterial = new THREE.MeshStandardMaterial({
    name: 'ValhallaTimberGold',
    map: valhallaTimberMap,
    normalMap: valhallaTimberNormal,
    normalScale: new THREE.Vector2(2.05, 2.05),
    roughnessMap: valhallaTimberRough,
    metalnessMap: valhallaTimberMetal,
    roughness: 0.64,
    metalness: 0.32,
  });

  const atlantisMarbleOrichalcumMaterial = new THREE.MeshStandardMaterial({
    name: 'AtlantisMarbleOrichalcum',
    map: atlantisMarbleMap,
    normalMap: atlantisMarbleNormal,
    normalScale: new THREE.Vector2(2.15, 2.15),
    roughnessMap: atlantisMarbleRough,
    metalnessMap: atlantisMarbleMetal,
    emissiveMap: atlantisMarbleEmissive,
    emissive: new THREE.Color(0x42e8ff),
    emissiveIntensity: 0.42,
    roughness: 0.28,
    metalness: 0.56,
  });

  const orichalcumMetalMaterial = new THREE.MeshStandardMaterial({
    name: 'AtlanteanOrichalcumMetal',
    color: 0xffa648,
    normalMap: atlantisMarbleNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.18,
    metalness: 0.92,
    emissive: 0x6e2c08,
    emissiveIntensity: 0.28,
  });

  const solidGoldMaterial = new THREE.MeshStandardMaterial({
    name: 'ComplementarySolidGold',
    color: 0xffd254,
    normalMap: babylonLapisNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.16,
    metalness: 0.96,
    emissive: 0x4a3006,
    emissiveIntensity: 0.24,
  });

  const hangingGardenFoliageMaterial = new THREE.MeshStandardMaterial({
    name: 'BabylonHangingGardenFoliage',
    color: 0x1e8c45,
    emissive: 0x083316,
    emissiveIntensity: 0.22,
    roughness: 0.62,
    metalness: 0.06,
  });

  const turquoiseWaterMaterial = new THREE.MeshStandardMaterial({
    name: 'BabylonTurquoiseWaterSheet',
    color: 0x26d8e8,
    emissive: 0x0b6b78,
    emissiveIntensity: 0.45,
    roughness: 0.12,
    metalness: 0.18,
    transparent: true,
    opacity: 0.84,
  });

  const auroraCyanGlowMaterial = new THREE.MeshStandardMaterial({
    name: 'ValhallaAuroraCyanGlow',
    color: 0x38f2ff,
    emissive: 0x1be4ff,
    emissiveIntensity: 1.35,
    roughness: 0.18,
    metalness: 0.1,
  });

  const bioluminescentCoralCyanMaterial = new THREE.MeshStandardMaterial({
    name: 'AtlantisCoralCyan',
    color: 0x24f0ff,
    emissive: 0x0ec8ff,
    emissiveIntensity: 1.15,
    roughness: 0.32,
    metalness: 0.12,
  });

  const bioluminescentCoralMagentaMaterial = new THREE.MeshStandardMaterial({
    name: 'AtlantisCoralMagenta',
    color: 0xff38b8,
    emissive: 0xd4148a,
    emissiveIntensity: 1.15,
    roughness: 0.34,
    metalness: 0.12,
  });

  _cachedComplementarySuite = {
    babylonLapisBrick: {
      map: babylonLapisMap,
      normalMap: babylonLapisNormal,
      roughnessMap: babylonLapisRough,
      metalnessMap: babylonLapisMetal,
      material: babylonLapisBrickMaterial,
    },
    babylonCuneiformRelief: {
      map: babylonCuneiMap,
      normalMap: babylonCuneiNormal,
      roughnessMap: babylonCuneiRough,
      metalnessMap: babylonCuneiMetal,
      material: babylonCuneiformReliefMaterial,
    },
    valhallaRunestone: {
      map: valhallaRuneMap,
      normalMap: valhallaRuneNormal,
      roughnessMap: valhallaRuneRough,
      metalnessMap: valhallaRuneMetal,
      emissiveMap: valhallaRuneEmissive,
      material: valhallaRunestoneMaterial,
    },
    valhallaTimberGold: {
      map: valhallaTimberMap,
      normalMap: valhallaTimberNormal,
      roughnessMap: valhallaTimberRough,
      metalnessMap: valhallaTimberMetal,
      material: valhallaTimberGoldMaterial,
    },
    atlantisMarbleOrichalcum: {
      map: atlantisMarbleMap,
      normalMap: atlantisMarbleNormal,
      roughnessMap: atlantisMarbleRough,
      metalnessMap: atlantisMarbleMetal,
      emissiveMap: atlantisMarbleEmissive,
      material: atlantisMarbleOrichalcumMaterial,
    },
    materials: {
      babylonLapisBrick: babylonLapisBrickMaterial,
      babylonCuneiformRelief: babylonCuneiformReliefMaterial,
      valhallaRunestone: valhallaRunestoneMaterial,
      valhallaTimberGold: valhallaTimberGoldMaterial,
      atlantisMarbleOrichalcum: atlantisMarbleOrichalcumMaterial,
      orichalcumMetal: orichalcumMetalMaterial,
      solidGold: solidGoldMaterial,
      hangingGardenFoliage: hangingGardenFoliageMaterial,
      turquoiseWater: turquoiseWaterMaterial,
      auroraCyanGlow: auroraCyanGlowMaterial,
      bioluminescentCoralCyan: bioluminescentCoralCyanMaterial,
      bioluminescentCoralMagenta: bioluminescentCoralMagentaMaterial,
    },
  };

  return _cachedComplementarySuite;
}

// ============================================================================
// 2. MONUMENTAL 3D BIOME ARCHITECTURE BUILDERS
// ============================================================================

/**
 * Helper & Exported Builder: Winged Bull / Lion *Lamassu* Colossus with bearded royal crown,
 * sculpted feathered wings, and Cuneiform plinth.
 */
export function buildLamassuColossus(options = {}) {
  const { height = 9.6, useLapisWings = true } = options;
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'BabylonLamassuColossus';

  const scale = height / 9.6;

  // 1. Stepped Cuneiform Plinth
  const plinth = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(3.2 * scale, 1.4 * scale, 5.2 * scale), 0.18, 0.24),
    suite.materials.babylonCuneiformRelief
  );
  plinth.position.y = 0.7 * scale;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // 2. Muscular Bull Torso & Five-Legged Striding Piers
  const body = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.3 * scale, 3.2 * scale, 4.1 * scale), 0.18, 0.24),
    suite.materials.babylonCuneiformRelief
  );
  body.position.set(0, 3.4 * scale, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  for (const lx of [-0.82, 0.82]) {
    for (const lz of [-1.45, 0.0, 1.45]) {
      if (lx < 0 && lz === 0.0) continue; // Classic Mesopotamian 5-legged Lamassu perspective
      const leg = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(0.55 * scale, 2.2 * scale, 0.62 * scale), 0.2, 0.25),
        suite.materials.babylonCuneiformRelief
      );
      leg.position.set(lx * scale, 2.3 * scale, lz * scale);
      leg.castShadow = true;
      group.add(leg);
    }
  }

  // 3. Sweeping Tiered Lapis & Gold Feathered Eagle Wings
  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 3; tier++) {
      const wLen = (3.4 - tier * 0.55) * scale;
      const wH = (1.15 - tier * 0.18) * scale;
      const wing = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(0.28 * scale, wH, wLen), 0.22, 0.26),
        tier % 2 === 0 && useLapisWings ? suite.materials.babylonLapisBrick : suite.materials.solidGold
      );
      wing.position.set(
        side * (1.22 + tier * 0.12) * scale,
        (4.2 + tier * 0.82) * scale,
        (-0.2 - tier * 0.35) * scale
      );
      wing.rotation.x = -0.18 - tier * 0.08;
      wing.castShadow = true;
      group.add(wing);
    }
  }

  // 4. Bearded Human Head, Curled Lapis Beard & Horned Polos Crown of Divinity
  const head = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.48 * scale, 1.65 * scale, 1.52 * scale), 0.22, 0.24),
    suite.materials.babylonCuneiformRelief
  );
  head.position.set(0, 5.85 * scale, 1.65 * scale);
  head.castShadow = true;
  group.add(head);

  const beard = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.12 * scale, 1.45 * scale, 0.65 * scale), 0.24, 0.28),
    suite.materials.babylonLapisBrick
  );
  beard.position.set(0, 4.75 * scale, 2.15 * scale);
  group.add(beard);

  const crown = new THREE.Mesh(
    makeFlatFacetedGeometry(new THREE.CylinderGeometry(0.86 * scale, 0.74 * scale, 1.55 * scale, 8)),
    suite.materials.solidGold
  );
  crown.position.set(0, 7.35 * scale, 1.65 * scale);
  crown.castShadow = true;
  group.add(crown);

  // Twin Bull Horns of Marduk
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(
      new THREE.TorusGeometry(0.68 * scale, 0.12 * scale, 8, 16, Math.PI * 0.85),
      suite.materials.solidGold
    );
    horn.position.set(side * 0.48 * scale, 7.25 * scale, 1.85 * scale);
    horn.rotation.y = side * 0.45;
    group.add(horn);
  }

  return group;
}

/**
 * Chapter VI: Colossal 7-tiered stepped Mesopotamian Ziggurat (`Etemenanki`)
 * with monumental triple staircases, glazed lapis-blue upper temple shrine (`Esagila`)
 * at the summit, golden horns of Marduk, and hanging garden greenery terraces on every tier.
 */
export function buildBabylonianZiggurat(options = {}) {
  const {
    baseWidth = 96,
    height = 56,
    tiers = 7,
  } = options;

  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'BabylonianZigguratEtemenanki';

  const actualTiers = Math.max(5, tiers);
  const shrineRatio = 0.18;
  const bodyHeight = height * (1 - shrineRatio);
  const tierH = bodyHeight / actualTiers;

  // 0. Colossal Stepped Citadel Foundation Plinth & Sub-Grade Skirt (extends down to y = -9.0m so zero gap ever exists under the castle)
  const skirtW = baseWidth * 1.34;
  const skirtD = baseWidth * 1.46;
  const subFoundation = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(skirtW, 10.0, skirtD), 0.12, 0.18),
    suite.materials.babylonCuneiformRelief
  );
  subFoundation.position.set(0, -4.2, baseWidth * 0.08);
  subFoundation.castShadow = true;
  subFoundation.receiveShadow = true;
  group.add(subFoundation);

  const upperPlinth = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(baseWidth * 1.14, 2.2, baseWidth * 1.24), 0.14, 0.2),
    suite.materials.babylonLapisBrick
  );
  upperPlinth.position.set(0, 0.9, baseWidth * 0.06);
  upperPlinth.castShadow = true;
  upperPlinth.receiveShadow = true;
  group.add(upperPlinth);

  // 1. Stepped Ziggurat Terraces with recessed buttress niches & Hanging Garden Greenery ledges
  for (let i = 0; i < actualTiers; i++) {
    const frac = i / actualTiers;
    const tierW = baseWidth * (1.0 - frac * 0.62);
    const yCenter = (i + 0.5) * tierH;

    const isUpperLapis = i >= actualTiers - 2;
    const tierMat = isUpperLapis
      ? suite.materials.babylonLapisBrick
      : i % 2 === 0
      ? suite.materials.babylonCuneiformRelief
      : suite.materials.babylonLapisBrick;

    const tierBox = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(tierW, tierH * 0.96, tierW), 0.14, 0.22),
      tierMat
    );
    tierBox.position.y = yCenter;
    tierBox.castShadow = true;
    tierBox.receiveShadow = true;
    group.add(tierBox);

    // Golden & Glazed Lapis Crenellated Parapet Crown around each Ziggurat terrace
    const parapet = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(tierW * 1.015, tierH * 0.14, tierW * 1.015), 0.18, 0.26),
      i % 2 === 0 ? suite.materials.babylonLapisBrick : suite.materials.solidGold
    );
    parapet.position.y = (i + 0.95) * tierH;
    group.add(parapet);

    // Hanging Garden lush emerald greenery & date-palm terrace strips along each tier ledge
    const ledgeInset = tierW * 0.46;
    for (const side of [-1, 1]) {
      const gardenStripX = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(tierW * 0.86, 0.95, 2.2), 0.22, 0.26),
        suite.materials.hangingGardenFoliage
      );
      gardenStripX.position.set(0, (i + 1.0) * tierH + 0.35, side * ledgeInset);
      group.add(gardenStripX);

      const gardenStripZ = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.2, 0.95, tierW * 0.86), 0.22, 0.26),
        suite.materials.hangingGardenFoliage
      );
      gardenStripZ.position.set(side * ledgeInset, (i + 1.0) * tierH + 0.35, 0);
      group.add(gardenStripZ);
    }
  }

  // 2. Monumental Triple Staircase System with Solid Full-Height Masonry Buttress Under-Walls (never floating!)
  const frontZ = baseWidth * 0.5;
  const rampRun = baseWidth * 0.30;
  const rampTopY = bodyHeight * 0.82;
  const rampSteps = 10;
  for (let s = 0; s < rampSteps; s++) {
    const u = s / rampSteps;
    const stepTopY = rampTopY * (1.0 - u);
    const stepH = stepTopY + 5.0; // Extend down into the foundation plinth (-5.0m) so there is solid masonry under every step!
    const stepD = (rampRun / rampSteps) * 1.08;
    const stepZ = frontZ + u * rampRun;
    const buttressBlock = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(baseWidth * 0.145, stepH, stepD), 0.16, 0.22),
      s % 2 === 0 ? suite.materials.babylonLapisBrick : suite.materials.babylonCuneiformRelief
    );
    buttressBlock.position.set(0, stepTopY - stepH * 0.5, stepZ);
    buttressBlock.castShadow = true;
    buttressBlock.receiveShadow = true;
    group.add(buttressBlock);
  }

  // Sloped Glazed Lapis Balustrade Capping the Solid Central Staircase Buttress
  const centralRampLen = Math.hypot(rampRun, rampTopY);
  const centralRampAngle = Math.atan2(rampTopY, rampRun);
  const centralRamp = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(baseWidth * 0.15, 2.2, centralRampLen), 0.16, 0.22),
    suite.materials.babylonLapisBrick
  );
  centralRamp.position.set(0, rampTopY * 0.5, frontZ + rampRun * 0.46);
  centralRamp.rotation.x = centralRampAngle;
  centralRamp.castShadow = true;
  group.add(centralRamp);

  // Twin Flanking Converging Staircase Buttresses (grounded solidly into the front wall)
  for (const side of [-1, 1]) {
    for (let s = 0; s < 6; s++) {
      const u = s / 6;
      const sTopY = bodyHeight * 0.44 * (1.0 - u);
      const sH = sTopY + 5.0;
      const sx = side * baseWidth * (0.09 + u * 0.28);
      const sideButtress = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry((baseWidth * 0.32) / 6, sH, 5.8), 0.16, 0.22),
        suite.materials.babylonCuneiformRelief
      );
      sideButtress.position.set(sx, sTopY - sH * 0.5, frontZ + 2.4);
      sideButtress.castShadow = true;
      sideButtress.receiveShadow = true;
      group.add(sideButtress);
    }
  }

  // 3. Summit Glazed Lapis-Blue Temple Shrine of Marduk (`Esagila`) + Golden Horns of Marduk
  const topW = baseWidth * 0.34;
  const shrineH = height * shrineRatio;
  const shrineY = bodyHeight + shrineH * 0.5;

  const esagilaShrine = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(topW, shrineH, topW), 0.16, 0.22),
    suite.materials.babylonLapisBrick
  );
  esagilaShrine.position.y = shrineY;
  esagilaShrine.castShadow = true;
  esagilaShrine.receiveShadow = true;
  group.add(esagilaShrine);

  // Faceted Golden Ziggurat Pyramidion Cap & Colossal Horns of Marduk at the Apex
  const apexCap = new THREE.Mesh(
    makeFlatFacetedGeometry(new THREE.ConeGeometry(topW * 0.45, shrineH * 0.55, 4)),
    suite.materials.solidGold
  );
  apexCap.rotation.y = Math.PI / 4;
  apexCap.position.y = bodyHeight + shrineH + shrineH * 0.26;
  group.add(apexCap);

  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(
      makeFlatFacetedGeometry(new THREE.ConeGeometry(topW * 0.08, shrineH * 0.72, 6)),
      suite.materials.solidGold
    );
    horn.position.set(side * topW * 0.28, bodyHeight + shrineH + shrineH * 0.28, 0);
    horn.rotation.z = side * -0.32;
    group.add(horn);
  }

  return group;
}

/**
 * Chapter VI: Iconic crenellated double-tower Babylonian Ishtar Gate in glazed lapis brick
 * (`babylonLapisBrick`) with golden rosette bands, arched passage, and twin Winged Bull Lamassu Colossi.
 */
export function buildIshtarGlazedGateway(options = {}) {
  const {
    width = 22.0,
    height = 14.5,
  } = options;

  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'BabylonIshtarGlazedGateway';

  const clearSpan = width * 0.44;
  const towerW = (width - clearSpan) * 0.5;
  const towerD = 6.4;

  // 1. Twin Glazed Lapis-Lazuli Crenellated Bastion Towers
  for (const side of [-1, 1]) {
    const tx = side * (clearSpan * 0.5 + towerW * 0.5);
    const tower = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(towerW, height, towerD), 0.16, 0.22),
      suite.materials.babylonLapisBrick
    );
    tower.position.set(tx, height * 0.5, 0);
    tower.castShadow = true;
    tower.receiveShadow = true;
    group.add(tower);

    // Golden Rosette Frieze Band around each tower
    const goldBand = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(towerW + 0.35, 1.15, towerD + 0.35), 0.2, 0.25),
      suite.materials.solidGold
    );
    goldBand.position.set(tx, height * 0.78, 0);
    group.add(goldBand);

    // Stepped Babylonian Merlon Crenellations atop each tower
    const merlonCount = 4;
    for (let m = 0; m < merlonCount; m++) {
      const mx = tx - towerW * 0.36 + (m / (merlonCount - 1)) * (towerW * 0.72);
      for (const fz of [-towerD * 0.42, towerD * 0.42]) {
        const merlon = new THREE.Mesh(
          applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.1, 1.35, 0.65), 0.22, 0.25),
          suite.materials.babylonLapisBrick
        );
        merlon.position.set(mx, height + 0.65, fz);
        group.add(merlon);
      }
    }

    // Twin Winged Bull Lamassu Colossi guarding the Ishtar Gate threshold
    const lamassu = buildLamassuColossus({ height: height * 0.68, useLapisWings: true });
    lamassu.position.set(side * (clearSpan * 0.5 + 2.8), 0, -towerD * 0.62);
    lamassu.rotation.y = Math.PI;
    group.add(lamassu);
  }

  // 2. Monumental Lapis & Gold Archway Spanning the Processional Way
  const lintelH = height * 0.32;
  const lintel = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(clearSpan + towerW * 0.8, lintelH, towerD * 0.88), 0.16, 0.22),
    suite.materials.babylonLapisBrick
  );
  lintel.position.set(0, height - lintelH * 0.5 - 0.4, 0);
  lintel.castShadow = true;
  group.add(lintel);

  const archRing = new THREE.Mesh(
    new THREE.TorusGeometry(clearSpan * 0.48, 0.55, 10, 24, Math.PI),
    suite.materials.solidGold
  );
  archRing.position.set(0, height - lintelH - 0.3, towerD * 0.45);
  group.add(archRing);

  const archRingBack = archRing.clone();
  archRingBack.position.z = -towerD * 0.45;
  group.add(archRingBack);

  return group;
}

/**
 * Chapter VI: Stepped stone arch & lotus/palm planter column with cascading turquoise water sheet.
 */
export function buildHangingGardenAqueductColumn(options = {}) {
  const { height = 10.5 } = options;
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'HangingGardenAqueductColumn';

  // 1. Stepped Mesopotamian Cuneiform & Lapis Column Shaft
  const plinth = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.5, 1.3, 2.5), 0.2, 0.25),
    suite.materials.babylonLapisBrick
  );
  plinth.position.y = 0.65;
  group.add(plinth);

  const shaftH = height - 2.6;
  const shaft = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.65, shaftH, 1.65), 0.18, 0.24),
    suite.materials.babylonCuneiformRelief
  );
  shaft.position.y = 1.3 + shaftH * 0.5;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  // 2. Stepped Corbelled Lotus Planter Basin at the Capital
  const capitalBasin = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(3.1, 1.35, 3.1), 0.2, 0.25),
    suite.materials.babylonLapisBrick
  );
  capitalBasin.position.y = height - 0.65;
  capitalBasin.castShadow = true;
  group.add(capitalBasin);

  // Lush Hanging Vines & Date-Palm Crown overflowing the Aqueduct Basin
  const foliageCrown = new THREE.Mesh(
    makeFlatFacetedGeometry(new THREE.DodecahedronGeometry(1.75, 1)),
    suite.materials.hangingGardenFoliage
  );
  foliageCrown.scale.set(1.15, 0.72, 1.15);
  foliageCrown.position.y = height + 0.35;
  group.add(foliageCrown);

  for (let f = 0; f < 8; f++) {
    const a = (f / 8) * Math.PI * 2;
    const frond = new THREE.Mesh(
      makeFlatFacetedGeometry(new THREE.ConeGeometry(0.48, 2.9, 4)),
      suite.materials.hangingGardenFoliage
    );
    frond.position.set(Math.cos(a) * 1.35, height + 0.45, Math.sin(a) * 1.35);
    frond.rotation.y = -a + Math.PI / 2;
    frond.rotation.z = -1.12;
    group.add(frond);
  }

  // 3. Cascading Turquoise Water Sheet (`userData.waterSheet` for UV/scale shimmer in `update()`)
  const waterSheet = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, height - 1.4, 0.14),
    suite.materials.turquoiseWater
  );
  waterSheet.position.set(0, (height - 1.4) * 0.5 + 0.5, 1.02);
  group.add(waterSheet);
  group.userData.waterSheet = waterSheet;

  return group;
}

/**
 * Chapter VII: Colossal Asgardian stave-and-granite Great Hall (`Gladsheim`) with curved
 * dragon-prow gable roofs, golden shield-thatched eaves, and towering carved pillars.
 */
export function buildValhallaGreatMeadHall(options = {}) {
  const {
    width = 36,
    height = 28,
    length = 54,
  } = options;

  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'ValhallaGreatMeadHall';

  // 0. Deep Sub-Grade Granite Cliff Foundation Skirt (extends down to y = -8.5m so the Great Hall is always anchored into the mountain/fjord)
  const cliffFoundation = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(width * 1.32, 9.5, length * 1.32), 0.12, 0.18),
    suite.materials.valhallaRunestone
  );
  cliffFoundation.position.y = -4.25;
  cliffFoundation.castShadow = true;
  cliffFoundation.receiveShadow = true;
  group.add(cliffFoundation);

  // 1. Megalithic Nordic Runestone Foundation Plinth
  const plinthH = height * 0.22;
  const plinth = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(width * 1.06, plinthH, length * 1.06), 0.14, 0.2),
    suite.materials.valhallaRunestone
  );
  plinth.position.y = plinthH * 0.5;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // 2. Dark Oak Stave-Church Timber & Gold Hall Body
  const wallH = height * 0.38;
  const hallBody = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(width * 0.88, wallH, length * 0.9), 0.16, 0.22),
    suite.materials.valhallaTimberGold
  );
  hallBody.position.y = plinthH + wallH * 0.5;
  hallBody.castShadow = true;
  hallBody.receiveShadow = true;
  group.add(hallBody);

  // 3. Multi-Tiered Steep Stave-Church Gable Roofs with Golden Shield Eaves
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const tierFrac = t / tiers;
    const rw = width * (0.96 - tierFrac * 0.34);
    const rl = length * (0.96 - tierFrac * 0.28);
    const rh = height * 0.22;
    const ry = plinthH + wallH + t * (rh * 0.68) + rh * 0.4;

    let roofGeo = new THREE.CylinderGeometry(rw * 0.04, rw * 0.58, rh, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1.0, 1.0, rl / Math.max(1, rw));
    roofGeo = makeFlatFacetedGeometry(roofGeo);

    const roofMesh = new THREE.Mesh(
      roofGeo,
      t === tiers - 1 ? suite.materials.solidGold : suite.materials.valhallaTimberGold
    );
    roofMesh.position.y = ry;
    roofMesh.castShadow = true;
    group.add(roofMesh);

    // Golden Shield-Thatched Eave Trim along both sides
    const eaveTrim = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(rw * 0.92, 0.65, rl * 0.94), 0.18, 0.24),
      suite.materials.solidGold
    );
    eaveTrim.position.y = ry - rh * 0.44;
    group.add(eaveTrim);
  }

  // 4. Curved Golden Dragon-Prow Gable Finials at North & South Ridge Ends
  for (const endSide of [-1, 1]) {
    const prowNeck = new THREE.Mesh(
      new THREE.TorusGeometry(2.8, 0.38, 8, 18, Math.PI * 0.78),
      suite.materials.solidGold
    );
    prowNeck.position.set(0, height * 0.94, endSide * length * 0.34);
    prowNeck.rotation.y = endSide > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(prowNeck);

    const dragonHead = new THREE.Mesh(
      makeFlatFacetedGeometry(new THREE.ConeGeometry(0.95, 2.8, 5)),
      suite.materials.solidGold
    );
    dragonHead.position.set(0, height * 1.04, endSide * (length * 0.34 + 2.4));
    dragonHead.rotation.x = endSide * 1.25;
    group.add(dragonHead);
  }

  // 5. Towering Carved Pillars & Glowing Cyan Bifrost Portal Arch
  const colCount = 6;
  for (let c = 0; c < colCount; c++) {
    const cz = -length * 0.38 + (c / (colCount - 1)) * (length * 0.76);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.72, 0.85, wallH * 1.08, 10),
        suite.materials.valhallaRunestone
      );
      pillar.position.set(side * width * 0.46, plinthH + wallH * 0.52, cz);
      pillar.castShadow = true;
      group.add(pillar);
    }
  }

  return group;
}

/**
 * Chapter VII: Monumental Nordic Dragon-Prowed Longship with striped wool sail,
 * oak hull, and round golden shields along the gunwales for the Fjord vista.
 */
export function buildVikingDragonLongship(options = {}) {
  const { length = 22.0 } = options;
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'VikingDragonLongship';

  const scale = length / 22.0;

  // 1. Clinker-Built Dark Oak Longship Hull
  let hullGeo = new THREE.CylinderGeometry(1.95 * scale, 0.75 * scale, length * 0.84, 10, 1);
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.scale(1.15, 0.65, 1.0);
  hullGeo = makeFlatFacetedGeometry(hullGeo);
  const hull = new THREE.Mesh(hullGeo, suite.materials.valhallaTimberGold);
  hull.position.y = 1.35 * scale;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  // 2. Sweeping Curved Dragon Stem-Prow & Coiled Tail Stern
  for (const endSide of [-1, 1]) {
    const stem = new THREE.Mesh(
      new THREE.TorusGeometry(3.4 * scale, 0.32 * scale, 8, 20, Math.PI * 0.75),
      suite.materials.solidGold
    );
    stem.position.set(0, 3.2 * scale, endSide * length * 0.36);
    stem.rotation.y = endSide > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(stem);

    if (endSide > 0) {
      const dragonHead = new THREE.Mesh(
        makeFlatFacetedGeometry(new THREE.ConeGeometry(0.75 * scale, 2.3 * scale, 5)),
        suite.materials.solidGold
      );
      dragonHead.position.set(0, 5.8 * scale, length * 0.48);
      dragonHead.rotation.x = 1.18;
      group.add(dragonHead);
    }
  }

  // 3. Central Oak Mast, Yardarm & Billowing Crimson-Gold Striped Viking Square Sail
  const mastH = 11.5 * scale;
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.32 * scale, mastH, 8),
    suite.materials.valhallaTimberGold
  );
  mast.position.y = mastH * 0.5 + 1.0 * scale;
  mast.castShadow = true;
  group.add(mast);

  const yardW = 8.8 * scale;
  const yard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14 * scale, 0.14 * scale, yardW, 8),
    suite.materials.solidGold
  );
  yard.rotation.z = Math.PI / 2;
  yard.position.set(0, mastH * 0.88, 0);
  group.add(yard);

  // Striped Wool Sail (7 vertical crimson & gold planks curved forward in the fjord wind)
  const stripes = 7;
  const stripeW = yardW / stripes;
  for (let s = 0; s < stripes; s++) {
    const sx = (s - (stripes - 1) * 0.5) * stripeW;
    const sailMat = new THREE.MeshStandardMaterial({
      color: s % 2 === 0 ? 0x9e1b1b : 0xf2d16b,
      roughness: 0.74,
      metalness: 0.08,
    });
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(stripeW * 0.98, mastH * 0.62, 0.18 * scale),
      sailMat
    );
    panel.position.set(sx, mastH * 0.56, 0.55 * scale);
    panel.castShadow = true;
    group.add(panel);
  }

  // 4. Row of Round Golden & Runic Viking Shields along Both Gunwales
  const shieldCount = 8;
  for (let i = 0; i < shieldCount; i++) {
    const sz = -length * 0.32 + (i / (shieldCount - 1)) * (length * 0.64);
    for (const side of [-1, 1]) {
      const shield = new THREE.Mesh(
        new THREE.CylinderGeometry(0.58 * scale, 0.58 * scale, 0.12 * scale, 12),
        i % 2 === 0 ? suite.materials.solidGold : suite.materials.valhallaRunestone
      );
      shield.rotation.z = Math.PI / 2;
      shield.position.set(side * 2.15 * scale, 1.85 * scale, sz);
      group.add(shield);
    }
  }

  return group;
}

/**
 * Chapter VII: Towering carved Nordic granite monolith with glowing cyan Elder Futhark
 * rune inscriptions and knotwork borders.
 */
export function buildElderFutharkRunestone(options = {}) {
  const { height = 9.5 } = options;
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'ElderFutharkRunestone';

  // 1. Stepped Runic Granite Base Plinth
  const plinth = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.6, 1.1, 2.2), 0.22, 0.25),
    suite.materials.valhallaRunestone
  );
  plinth.position.y = 0.55;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // 2. Tapered Monolithic Granite Shaft with Glowing Cyan Elder Futhark Runes
  const shaftH = height - 2.2;
  const shaft = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.75, shaftH, 0.92), 0.2, 0.22),
    suite.materials.valhallaRunestone
  );
  shaft.position.y = 1.1 + shaftH * 0.5;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  // 3. Faceted Pyramidion Runestone Apex + Glowing Cyan Bifrost Rune Crystal Core
  const cap = new THREE.Mesh(
    makeFlatFacetedGeometry(new THREE.ConeGeometry(1.12, 1.45, 4)),
    suite.materials.valhallaRunestone
  );
  cap.rotation.y = Math.PI / 4;
  cap.position.y = height - 0.45;
  cap.castShadow = true;
  group.add(cap);

  // Gilded Bronze Knotwork Collar
  const collar = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.92, 0.42, 1.08), 0.25, 0.25),
    suite.materials.solidGold
  );
  collar.position.y = height - 1.25;
  group.add(collar);

  return group;
}

/**
 * Chapter VIII: Colossal concentric-ringed Greco-Atlantean Tholos & Acropolis
 * with fluted Paros marble columns, gleaming Orichalcum dome/pediments, and a
 * rotating astronomical Orichalcum Astrolabe ring at the apex.
 */
export function buildAtlanteanOrichalcumTemple(options = {}) {
  const {
    baseWidth = 68,
    height = 46,
  } = options;

  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'AtlanteanOrichalcumTemple';

  const baseRadius = baseWidth * 0.5;

  // 0. Deep Sub-Grade Acropolis Foundation Drum (extends down to y = -8.5m so the Temple is always anchored into the terrain/seabed)
  const subDrum = new THREE.Mesh(
    new THREE.CylinderGeometry(baseRadius * 1.12, baseRadius * 1.24, 9.0, 28),
    suite.materials.atlantisMarbleOrichalcum
  );
  subDrum.position.y = -4.0;
  subDrum.receiveShadow = true;
  subDrum.castShadow = true;
  group.add(subDrum);

  // 1. Three Concentric Stepped Paros Marble & Orichalcum Crepidoma Rings (Plato's Critias Rings of Atlantis)
  for (let r = 0; r < 3; r++) {
    const rad = baseRadius * (1.0 - r * 0.16);
    const stepH = 1.85;
    const step = new THREE.Mesh(
      new THREE.CylinderGeometry(rad * 0.98, rad, stepH, 28),
      r % 2 === 0 ? suite.materials.atlantisMarbleOrichalcum : suite.materials.orichalcumMetal
    );
    step.position.y = (r + 0.5) * stepH;
    step.receiveShadow = true;
    step.castShadow = true;
    group.add(step);
  }

  const stylobateY = 3 * 1.85;
  const colonnadeH = height * 0.42;
  const colRadius = baseRadius * 0.62;

  // 2. Peripteral Ring of 16 Fluted Paros Marble & Orichalcum Columns
  const colCount = 16;
  for (let i = 0; i < colCount; i++) {
    const ang = (i / colCount) * Math.PI * 2;
    const cx = Math.cos(ang) * colRadius;
    const cz = Math.sin(ang) * colRadius;

    const colShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.15, colonnadeH, 12),
      suite.materials.atlantisMarbleOrichalcum
    );
    colShaft.position.set(cx, stylobateY + colonnadeH * 0.5, cz);
    colShaft.castShadow = true;
    colShaft.receiveShadow = true;
    group.add(colShaft);

    const colCap = new THREE.Mesh(
      new THREE.CylinderGeometry(1.42, 0.98, 1.1, 10),
      suite.materials.orichalcumMetal
    );
    colCap.position.set(cx, stylobateY + colonnadeH - 0.35, cz);
    group.add(colCap);
  }

  // 3. Inner Sanctum Tholos Rotunda & Gleaming Orichalcum Ribbed Dome
  const tholosY = stylobateY + colonnadeH;
  const entablature = new THREE.Mesh(
    new THREE.CylinderGeometry(colRadius * 1.06, colRadius * 1.04, 2.6, 28),
    suite.materials.orichalcumMetal
  );
  entablature.position.y = tholosY + 1.3;
  entablature.castShadow = true;
  group.add(entablature);

  const domeRadius = colRadius * 0.84;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(domeRadius, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
    suite.materials.orichalcumMetal
  );
  dome.scale.set(1.0, (height * 0.26) / Math.max(1, domeRadius), 1.0);
  dome.position.y = tholosY + 2.4;
  dome.castShadow = true;
  group.add(dome);

  // 4. Rotating Astronomical Orichalcum Astrolabe Ring at the Apex (`userData.astrolabeGroup`)
  const astrolabeGroup = new THREE.Group();
  astrolabeGroup.name = 'OrichalcumAstrolabeApex';
  astrolabeGroup.position.set(0, height * 0.92, 0);

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(baseRadius * 0.22, 0.45, 10, 28),
    suite.materials.orichalcumMetal
  );
  astrolabeGroup.add(outerRing);

  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(baseRadius * 0.15, 0.34, 10, 24),
    suite.materials.solidGold
  );
  innerRing.rotation.x = Math.PI / 3;
  innerRing.rotation.y = Math.PI / 4;
  astrolabeGroup.add(innerRing);

  const coreCrystal = new THREE.Mesh(
    makeFlatFacetedGeometry(new THREE.OctahedronGeometry(baseRadius * 0.08, 0)),
    suite.materials.bioluminescentCoralCyan
  );
  astrolabeGroup.add(coreCrystal);

  group.add(astrolabeGroup);
  group.userData.astrolabeGroup = astrolabeGroup;

  return group;
}

/**
 * Chapter VIII: Towering 14m marble & Orichalcum Colossus of Poseidon holding
 * a gleaming 3-pronged Orichalcum Trident and sea-serpent plinth.
 */
export function buildPoseidonTridentColossus(options = {}) {
  const { height = 14.0 } = options;
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'PoseidonTridentColossus';

  const s = height / 14.0;

  // 0. Sub-Grade Reef & Marble Foundation Pier (extends down to y = -6.0m so colossi on the horizon are always grounded)
  const subPier = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(5.2 * s, 6.5 * s, 5.2 * s), 0.16, 0.22),
    suite.materials.atlantisMarbleOrichalcum
  );
  subPier.position.y = -3.0 * s;
  subPier.castShadow = true;
  subPier.receiveShadow = true;
  group.add(subPier);

  // 1. Paros Marble & Orichalcum Plinth + Coiled Sea-Serpent / Hippocampus Relief Ring
  const plinth = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(3.8 * s, 2.2 * s, 3.8 * s), 0.18, 0.24),
    suite.materials.atlantisMarbleOrichalcum
  );
  plinth.position.y = 1.1 * s;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const serpentCoil = new THREE.Mesh(
    new THREE.TorusKnotGeometry(1.55 * s, 0.28 * s, 48, 8, 2, 3),
    suite.materials.orichalcumMetal
  );
  serpentCoil.rotation.x = Math.PI / 2;
  serpentCoil.position.y = 2.35 * s;
  group.add(serpentCoil);

  // 2. Draped Chiton Lower Robe & Heroic Paros Marble Torso with Orichalcum Cuirass
  const robe = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05 * s, 1.45 * s, 4.2 * s, 12),
    suite.materials.atlantisMarbleOrichalcum
  );
  robe.position.y = 4.3 * s;
  robe.castShadow = true;
  group.add(robe);

  const torso = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.45 * s, 3.3 * s, 1.45 * s), 0.22, 0.24),
    suite.materials.atlantisMarbleOrichalcum
  );
  torso.position.y = 7.8 * s;
  torso.castShadow = true;
  group.add(torso);

  const cuirassBelt = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.58 * s, 0.85 * s, 1.56 * s), 0.25, 0.25),
    suite.materials.orichalcumMetal
  );
  cuirassBelt.position.y = 6.6 * s;
  group.add(cuirassBelt);

  // 3. Bearded Head of Poseidon & Radiant 5-Spiked Sea-King Crown
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.88 * s, 14, 12),
    suite.materials.atlantisMarbleOrichalcum
  );
  head.position.y = 10.35 * s;
  group.add(head);

  for (let k = -2; k <= 2; k++) {
    const spike = new THREE.Mesh(
      makeFlatFacetedGeometry(new THREE.ConeGeometry(0.18 * s, 1.15 * s, 4)),
      suite.materials.orichalcumMetal
    );
    spike.position.set(k * 0.28 * s, 11.45 * s, 0.15 * s);
    spike.rotation.z = -k * 0.22;
    group.add(spike);
  }

  // 4. Gleaming 3-Pronged Orichalcum Trident held high in right hand
  const tridentGroup = new THREE.Group();
  tridentGroup.position.set(1.75 * s, 7.2 * s, 0.55 * s);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14 * s, 0.14 * s, 11.8 * s, 10),
    suite.materials.orichalcumMetal
  );
  tridentGroup.add(shaft);

  const crossbar = new THREE.Mesh(
    new THREE.BoxGeometry(1.95 * s, 0.28 * s, 0.28 * s),
    suite.materials.orichalcumMetal
  );
  crossbar.position.y = 4.6 * s;
  tridentGroup.add(crossbar);

  for (const px of [-0.82, 0, 0.82]) {
    const prongH = (px === 0 ? 2.55 : 2.15) * s;
    const prong = new THREE.Mesh(
      makeFlatFacetedGeometry(new THREE.ConeGeometry(0.2 * s, prongH, 4)),
      px === 0 ? suite.materials.bioluminescentCoralCyan : suite.materials.orichalcumMetal
    );
    prong.position.set(px * s, 4.6 * s + prongH * 0.5, 0);
    tridentGroup.add(prong);
  }

  group.add(tridentGroup);
  group.userData.tridentGroup = tridentGroup;

  return group;
}

/**
 * Chapter VIII: Sculpted deep-sea reef spire with glowing magenta/cyan/gold coral polyps
 * and Orichalcum ruin fragments.
 */
export function buildBioluminescentCoralSpire(options = {}) {
  const { height = 8.4, seed = 1 } = options;
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = 'BioluminescentCoralSpire';

  // 1. Broken Atlantean Marble & Orichalcum Ruin Plinth Base
  const baseBlock = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(2.4, 1.35, 2.4), 0.2, 0.25),
    suite.materials.atlantisMarbleOrichalcum
  );
  baseBlock.position.y = 0.68;
  baseBlock.rotation.y = seededRandom(seed * 3.7) * Math.PI;
  group.add(baseBlock);

  // 2. Tapering Sculpted Deep-Sea Reef Spire Segments
  const segs = 6;
  const segH = (height - 1.2) / segs;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < segs; i++) {
    const rBot = 0.92 * (1 - i * 0.11);
    const rTop = 0.76 * (1 - i * 0.12);
    const segMesh = new THREE.Mesh(
      makeFlatFacetedGeometry(new THREE.CylinderGeometry(rTop, rBot, segH * 1.12, 7)),
      suite.materials.atlantisMarbleOrichalcum
    );
    cx += (seededRandom(seed * 11 + i) - 0.5) * 0.28;
    cz += (seededRandom(seed * 19 + i) - 0.5) * 0.28;
    const sy = 1.2 + (i + 0.5) * segH;
    segMesh.position.set(cx, sy, cz);
    segMesh.castShadow = true;
    group.add(segMesh);

    // Sculpted Orichalcum Collar Ring & Tapered Bioluminescent Crystal Fin embedded into the marble spire
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(rBot * 1.08, rBot * 1.10, 0.14, 12),
      suite.materials.orichalcumMetal
    );
    collar.position.set(cx, sy - segH * 0.42, cz);
    group.add(collar);

    const polypMat =
      i % 2 === 0
        ? suite.materials.bioluminescentCoralCyan
        : suite.materials.orichalcumMetal;
    const ang = i * 2.1 + seed;
    const fin = new THREE.Mesh(
      makeFlatFacetedGeometry(new THREE.ConeGeometry(0.22, 0.78, 5)),
      polypMat
    );
    fin.position.set(cx + Math.cos(ang) * (rBot * 0.88), sy, cz + Math.sin(ang) * (rBot * 0.88));
    fin.rotation.z = -Math.cos(ang) * 0.48;
    fin.rotation.x = Math.sin(ang) * 0.48;
    group.add(fin);
  }

  return group;
}

/**
 * Helper: Builds a Biome-Themed Torch / Brazier / Bioluminescent Beacon (`userData.flameGroup`, `userData.pointLight`).
 */
function buildComplementaryBiomeBrazier(chapterIndex = 6, options = {}) {
  const { height = 1.85, includePointLight = false, seed = 1 } = options;
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = `ComplementaryBiomeBrazier_Ch${chapterIndex}`;

  const isValhalla = chapterIndex === 7 || chapterIndex === 3;
  const isAtlantis = chapterIndex === 8 || chapterIndex === 4;

  const standMat = isAtlantis
    ? suite.materials.orichalcumMetal
    : isValhalla
    ? suite.materials.valhallaRunestone
    : suite.materials.babylonLapisBrick;

  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.52, height * 0.78, 8),
    standMat
  );
  stand.position.y = height * 0.39;
  stand.castShadow = true;
  group.add(stand);

  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.34, height * 0.26, 10),
    suite.materials.solidGold
  );
  bowl.position.y = height * 0.85;
  group.add(bowl);

  const flameColor = isAtlantis ? 0xff9a38 : isValhalla ? 0x38f2ff : 0xffa62b;
  const flameGroup = buildVolumetricFirePlume({
    scale: 1.12,
    coreColorHex: isValhalla ? 0xe8ffff : 0xffe68c,
    midColorHex: isValhalla ? 0x28d8ff : isAtlantis ? 0xff7c24 : 0xff7305,
    outerColorHex: isValhalla ? 0x0d58e8 : isAtlantis ? 0xd81868 : 0xff1200,
    emberCount: 10,
  });
  flameGroup.position.y = height * 0.96;
  group.add(flameGroup);
  group.userData.flameGroup = flameGroup;
  group.userData.baseIntensity = 7.5;

  if (includePointLight) {
    const pl = new THREE.PointLight(flameColor, 7.5, 14.5, 2.0);
    pl.position.set(0, height + 0.55, 0);
    group.add(pl);
    group.userData.pointLight = pl;
  }

  return group;
}

/**
 * Helper: Builds a Secret Branch Sliding Portal Doorway & Treasure Hoard Mound for Chapters 6, 7, 8 (and 2, 3, 4).
 */
function buildComplementarySecretSlidingDoor(chapterIndex = 6, width = 8.4, height = 6.4) {
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = `ComplementarySecretDoor_Ch${chapterIndex}`;

  const frameMat =
    chapterIndex === 7
      ? suite.materials.valhallaRunestone
      : chapterIndex === 8
      ? suite.materials.atlantisMarbleOrichalcum
      : suite.materials.babylonLapisBrick;

  const doorMat =
    chapterIndex === 7
      ? suite.materials.valhallaTimberGold
      : chapterIndex === 8
      ? suite.materials.orichalcumMetal
      : suite.materials.babylonCuneiformRelief;

  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(1.4, height, 1.6), 0.2, 0.24),
      frameMat
    );
    jamb.position.set(side * (width * 0.5 + 0.5), height * 0.5, 0);
    jamb.castShadow = true;
    group.add(jamb);

    // Parted heavy stone/orichalcum/runic doors leaving a walkable opening in the middle
    const leafW = width * 0.36;
    const leaf = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(leafW, height * 0.88, 0.82), 0.2, 0.24),
      doorMat
    );
    leaf.position.set(side * (width * 0.38), height * 0.44, 0);
    group.add(leaf);
  }

  const lintel = new THREE.Mesh(
    applyWorldSpaceBoxUVs(new THREE.BoxGeometry(width + 2.6, 1.35, 1.85), 0.18, 0.24),
    frameMat
  );
  lintel.position.set(0, height + 0.45, 0);
  group.add(lintel);

  return group;
}

function buildComplementaryTreasureHoard(chapterIndex = 6, radius = 3.6, seed = 1) {
  const suite = createComplementaryBiomeTextureSuite();
  const group = new THREE.Group();
  group.name = `ComplementaryTreasureHoard_Ch${chapterIndex}`;

  const mound = new THREE.Mesh(
    makeFlatFacetedGeometry(new THREE.ConeGeometry(radius, 1.35, 10)),
    chapterIndex === 8 ? suite.materials.orichalcumMetal : suite.materials.solidGold
  );
  mound.position.y = 0.65;
  mound.receiveShadow = true;
  group.add(mound);

  // Centerpiece relic atop the hoard
  const relic =
    chapterIndex === 7
      ? buildElderFutharkRunestone({ height: 5.2 })
      : chapterIndex === 8
      ? buildPoseidonTridentColossus({ height: 6.4 })
      : buildLamassuColossus({ height: 5.4, useLapisWings: true });
  relic.position.y = 0.85;
  group.add(relic);

  return group;
}

// ============================================================================
// 3. HIGH-LEVEL LEVEL ORCHESTRATOR: buildCompleteComplementaryBiome
// ============================================================================

/**
 * Populates the entire level (`t = 0.00 -> 1.00` + secret branch `u = 0.00 -> 1.00`)
 * when `chapterIndex` is `6` (Babylon), `7` (Valhalla), `8` (Atlantis),
 * or adds horizon/sanctum megastructures for `2`, `3`, `4`.
 *
 * Returns `{ rootGroup, exteriorGroup, interiorGroup, textureSuite, lightAnchors, solidObstacles, animatedProps, update(dt, elapsed, playerLoc) }`.
 */
export function buildCompleteComplementaryBiome(chapterIndex, worldGroup, spine, topology, options = {}) {
  const activeSpine = spine && typeof spine.getSampleAt === 'function' ? spine : topology;
  const textureSuite = createComplementaryBiomeTextureSuite(options.maxAnisotropy || 8);

  const lightAnchors = [];
  const solidObstacles = [];
  const animatedProps = [];

  const rootGroup = new THREE.Group();
  rootGroup.name = `ComplementaryBiomeRoot_Ch${chapterIndex}`;

  const exteriorGroup = new THREE.Group();
  exteriorGroup.name = `ComplementaryExteriorGroup_Ch${chapterIndex}`;
  rootGroup.add(exteriorGroup);

  const portalThresholdGroup = new THREE.Group();
  portalThresholdGroup.name = `ComplementaryPortalThresholdGroup_Ch${chapterIndex}`;
  rootGroup.add(portalThresholdGroup);

  const interiorGroup = new THREE.Group();
  interiorGroup.name = `ComplementaryInteriorGroup_Ch${chapterIndex}`;
  rootGroup.add(interiorGroup);

  const addNodeAtT = (node, t, isBranch = false) => {
    if (!isBranch && Math.abs(t - 0.24) < 0.009) {
      portalThresholdGroup.add(node);
    } else if (!isBranch && t < 0.235) {
      exteriorGroup.add(node);
    } else {
      interiorGroup.add(node);
    }
  };

  if (worldGroup?.isObject3D) {
    worldGroup.add(rootGroup);
  } else if (worldGroup?.scene?.isObject3D) {
    worldGroup.scene.add(rootGroup);
  }

  const registerCylinder = (spec) => {
    const obs = {
      id: spec.id || `comp_cyl_${solidObstacles.length}`,
      type: 'cylinder',
      x: spec.x,
      y: spec.y,
      z: spec.z,
      r: spec.r,
      h: spec.h ?? 6.0,
      kind: spec.kind || 'biome_monument',
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
      id: spec.id || `comp_obb_${solidObstacles.length}`,
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
      kind: spec.kind || 'biome_wall',
      walkableTop: Boolean(spec.walkableTop),
    };
    solidObstacles.push(obs);
    if (typeof worldGroup?.addSolidOBB === 'function') {
      worldGroup.addSolidOBB(obs);
    }
    return obs;
  };

  const sampleAt = (t) => {
    if (activeSpine && typeof activeSpine.getSampleAt === 'function') {
      return activeSpine.getSampleAt(t);
    }
    return {
      point: new THREE.Vector3(0, 0, -t * 200),
      flatTangent: new THREE.Vector3(0, 0, -1),
      halfWidth: 4.5,
    };
  };

  const branchSampleAt = (u) => {
    if (activeSpine && typeof activeSpine.getBranchSampleAt === 'function') {
      return activeSpine.getBranchSampleAt(u);
    }
    return {
      point: new THREE.Vector3(24 + u * 45, 0, -45),
      flatTangent: new THREE.Vector3(1, 0, 0),
      halfWidth: 4.0,
    };
  };

  const worldPosAt = (t, lat = 0, dy = 0, isBranch = false) => {
    if (activeSpine && typeof activeSpine.getWorldPos === 'function') {
      return activeSpine.getWorldPos(t, lat, dy, isBranch);
    }
    const s = isBranch ? branchSampleAt(t) : sampleAt(t);
    const right = new THREE.Vector3(-s.flatTangent.z, 0, s.flatTangent.x);
    return s.point.clone().addScaledVector(right, lat).add(new THREE.Vector3(0, dy, 0));
  };

  const placeBrazierAt = (t, lat, dy = 0, isBranch = false, seed = 1) => {
    const pos = worldPosAt(t, lat, dy, isBranch);
    const brazier = buildComplementaryBiomeBrazier(chapterIndex, {
      height: 1.85,
      includePointLight: options.includePointLights !== false,
      seed,
    });
    brazier.position.copy(pos);
    addNodeAtT(brazier, t, isBranch);

    const lightColor = chapterIndex === 8 || chapterIndex === 4 ? 0x28f0ff : chapterIndex === 7 || chapterIndex === 3 ? 0x38f2ff : 0xffa62b;
    lightAnchors.push({
      id: `comp_brazier_${chapterIndex}_${isBranch ? 'b' : 'm'}_${t.toFixed(3)}_${lat.toFixed(1)}`,
      position: pos.clone().add(new THREE.Vector3(0, 2.2, 0)),
      color: lightColor,
      intensity: 7.5,
      distance: 14.5,
      brazier,
    });
    animatedProps.push({
      kind: 'brazier',
      brazier,
      phase: seed * 2.13 + t * 17.9,
    });
  };

  // ============================================================================
  // SECTION 1: CONTINUOUS OUTDOOR TERRAIN FLOOR & 4 COLOSSAL HORIZON MEGASTRUCTURES
  // ============================================================================
  // 1A. Continuous 580x580m Biome Terrain Floor beneath the Horizon Castles/Ziggurats/Halls/Temples
  //     (Prevents distant castles and staircases from ever floating over empty sky!)
  {
    const terrainSize = 580;
    const terrainSegs = 80;
    const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegs, terrainSegs);
    terrainGeo.rotateX(-Math.PI / 2);
    const centerOffset = new THREE.Vector3(-82, 0, -16);
    const posAttr = terrainGeo.attributes.position;
    const uvAttr = terrainGeo.attributes.uv;

    const isValhalla = chapterIndex === 7 || chapterIndex === 3;
    const isAtlantis = chapterIndex === 8 || chapterIndex === 4;

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i) + centerOffset.x;
      const wz = posAttr.getZ(i) + centerOffset.z;

      let minDist = Infinity;
      let nearestY = 0.0;
      let nearestHw = 4.5;
      if (activeSpine?.samples?.length) {
        for (let k = 0; k <= Math.min(155, activeSpine.samples.length - 1); k++) {
          const s = activeSpine.samples[k];
          if (!s) continue;
          const d = Math.hypot(wx - s.point.x, wz - s.point.z);
          if (d < minDist) {
            minDist = d;
            nearestY = s.point.y;
            nearestHw = s.halfWidth;
          }
        }
      }

      const hills =
        Math.sin(wx * 0.036 + wz * 0.029) * 1.15 +
        Math.cos(wx * 0.072 - wz * 0.058) * 0.55 +
        Math.sin((wx + wz) * 0.14) * 0.18;

      let wy;
      if (minDist < nearestHw + 1.0) {
        // Depress below the wet trail channel & interactive rain puddles
        wy = nearestY - 0.44;
      } else if (minDist < nearestHw + 9.0) {
        // Smoothly rise from the trail curb to the surrounding citadel / fjord / acropolis plateau
        const blend = (minDist - (nearestHw + 1.0)) / 8.0;
        wy = nearestY - 0.16 + blend * (0.45 + Math.max(0, hills * 0.65));
      } else {
        wy = Math.min(3.4, nearestY * 0.55) + 0.55 + hills;
      }

      // Depress a Fjord channel around the Viking Longships in Valhalla (Ch. 7 / 3) so ships float in water while Mead Halls sit on high granite headlands
      if (isValhalla) {
        const dShip1 = Math.hypot(wx - -14, wz - -94);
        const dShip2 = Math.hypot(wx - -166, wz - -38);
        const shipDist = Math.min(dShip1, dShip2);
        if (shipDist < 28) {
          const shipBlend = Math.max(0, 1 - shipDist / 28);
          wy = wy * (1 - shipBlend) + -1.35 * shipBlend;
        }
      }

      posAttr.setXYZ(i, wx - centerOffset.x, wy, wz - centerOffset.z);
    }
    terrainGeo.computeVertexNormals();

    let terrainDiff = null;
    let terrainNor = null;
    let terrainRough = null;
    if (typeof window !== 'undefined') {
      const loader = new THREE.TextureLoader();
      const setupTiled = (url, isSrgb) => {
        const t = loader.load(url, undefined, undefined, () => {});
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(28, 28);
        t.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = options.maxAnisotropy || 8;
        return t;
      };
      terrainDiff = setupTiled(
        isValhalla
          ? '/textures/polyhaven/aerial_rocks_02_diff_1k.jpg'
          : '/textures/polyhaven/aerial_beach_01_diff_1k.jpg',
        true,
      );
      terrainNor = setupTiled(
        isValhalla || isAtlantis
          ? '/textures/polyhaven/aerial_rocks_02_nor_gl_1k.jpg'
          : '/textures/polyhaven/sandstone_blocks_04/sandstone_blocks_04_nor_gl_1k.jpg',
        false,
      );
      terrainRough = setupTiled(
        isValhalla
          ? '/textures/polyhaven/aerial_rocks_02_rough_1k.jpg'
          : '/textures/polyhaven/aerial_beach_01_rough_1k.jpg',
        false,
      );
    }

    const terrainMat = new THREE.MeshStandardMaterial({
      name: `ComplementaryOutdoorTerrain_Ch${chapterIndex}`,
      color: isAtlantis ? 0x8e8272 : isValhalla ? 0x5c6d7e : 0xc99358,
      map: terrainDiff || textureSuite.babylonCuneiformRelief.map,
      normalMap: terrainNor || textureSuite.babylonCuneiformRelief.normalMap,
      normalScale: new THREE.Vector2(1.45, 1.45),
      roughnessMap: terrainRough || textureSuite.babylonCuneiformRelief.roughnessMap,
      roughness: 0.88,
      metalness: 0.05,
    });

    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.position.copy(centerOffset);
    terrainMesh.receiveShadow = true;
    addNodeAtT(terrainMesh, 0.08, false);

    // For Valhalla (Fjord) & Atlantis (Sunken Acropolis), add a reflective Fjord/Lagoon Water Sheet across the low-lying channels
    if (isValhalla || isAtlantis) {
      const fjordGeo = new THREE.PlaneGeometry(580, 580);
      fjordGeo.rotateX(-Math.PI / 2);
      const fjordMesh = new THREE.Mesh(fjordGeo, textureSuite.materials.turquoiseWater);
      fjordMesh.position.set(-82, -0.18, -16);
      fjordMesh.receiveShadow = true;
      addNodeAtT(fjordMesh, 0.08, false);
    }
  }

  const horizonSites = [
    { x: -94, y: 0.4, z: -86, yaw: 0.08, t: 0.18, scale: 1.0 },
    { x: -14, y: 0.4, z: -94, yaw: -0.12, t: 0.12, scale: 0.9 },
    { x: 44, y: 0.4, z: -24, yaw: -0.26, t: 0.08, scale: 0.82 },
    { x: -166, y: 0.5, z: -38, yaw: 0.22, t: 0.10, scale: 0.88 },
  ];

  horizonSites.forEach((site, idx) => {
    let mega = null;
    let siteY = site.y;
    if (chapterIndex === 6 || chapterIndex === 2) {
      // Chapter VI (Babylon) & Chapter II: Colossal 7-Tiered Babylonian Ziggurats (Etemenanki)
      mega = buildBabylonianZiggurat({
        baseWidth: Math.round(96 * site.scale),
        height: Math.round(56 * site.scale),
        tiers: 7,
      });
    } else if (chapterIndex === 7 || chapterIndex === 3) {
      // Chapter VII (Valhalla) & Chapter III: Valhalla Great Mead Halls & Viking Dragon Longships
      if (idx % 2 === 0) {
        mega = buildValhallaGreatMeadHall({
          width: Math.round(38 * site.scale),
          height: Math.round(30 * site.scale),
          length: Math.round(56 * site.scale),
        });
      } else {
        mega = buildVikingDragonLongship({
          length: Math.round(28 * site.scale),
        });
        siteY = -0.35;
        animatedProps.push({
          kind: 'longship',
          node: mega,
          baseY: siteY,
          phase: idx * 1.7,
        });
      }
    } else {
      // Chapter VIII (Atlantis) & Chapter IV: Atlantean Orichalcum Acropolis Temples & Poseidon Colossi
      if (idx % 2 === 0) {
        mega = buildAtlanteanOrichalcumTemple({
          baseWidth: Math.round(70 * site.scale),
          height: Math.round(46 * site.scale),
        });
        if (mega.userData.astrolabeGroup) {
          animatedProps.push({
            kind: 'astrolabe',
            node: mega.userData.astrolabeGroup,
            phase: idx * 1.3,
          });
        }
      } else {
        mega = buildPoseidonTridentColossus({
          height: Math.round(26 * site.scale),
        });
      }
    }

    if (mega) {
      mega.position.set(site.x, siteY, site.z);
      mega.rotation.y = site.yaw;
      addNodeAtT(mega, site.t, false);
    }
  });

  // For Chapters 2, 3, and 4, add iconic Final Boss Sanctum Landmark at t = 0.96 and return cleanly
  // so their core forest/canyon/highland geometry remains intact while gaining monumental horizon & arena landmarks.
  if (chapterIndex === 2 || chapterIndex === 3 || chapterIndex === 4) {
    const endSample = sampleAt(0.985);
    const endYaw = Math.atan2(endSample.flatTangent.x, endSample.flatTangent.z);
    const sanctumLandmark =
      chapterIndex === 2
        ? buildIshtarGlazedGateway({ width: 22, height: 14 })
        : chapterIndex === 3
        ? buildValhallaGreatMeadHall({ width: 28, height: 22, length: 36 })
        : buildAtlanteanOrichalcumTemple({ baseWidth: 42, height: 30 });
    sanctumLandmark.position.copy(endSample.point).addScaledVector(endSample.flatTangent, 16.0);
    sanctumLandmark.rotation.y = endYaw;
    addNodeAtT(sanctumLandmark, 0.98, false);
    if (sanctumLandmark.userData?.astrolabeGroup) {
      animatedProps.push({
        kind: 'astrolabe',
        node: sanctumLandmark.userData.astrolabeGroup,
        phase: 0.5,
      });
    }

    const update = (dt, elapsed = 0) => {
      const tNow = elapsed || performance.now() * 0.001;
      for (let i = 0; i < animatedProps.length; i++) {
        const p = animatedProps[i];
        if (p.kind === 'astrolabe' && p.node) {
          p.node.rotation.y = tNow * 0.55 + p.phase;
          p.node.rotation.z = Math.sin(tNow * 0.8 + p.phase) * 0.18;
        } else if (p.kind === 'longship' && p.node) {
          p.node.position.y = p.baseY + Math.sin(tNow * 1.4 + p.phase) * 0.35;
          p.node.rotation.z = Math.sin(tNow * 1.1 + p.phase) * 0.04;
        }
      }
    };

    return {
      rootGroup,
      exteriorGroup,
      interiorGroup,
      exteriorDesertGroup: exteriorGroup,
      interiorTombGroup: interiorGroup,
      textureSuite,
      lightAnchors,
      solidObstacles,
      animatedProps,
      update,
    };
  }

  // ============================================================================
  // SECTION 2: PROCESSIONAL AVENUE (t = 0.02 -> 0.21) FOR CHAPTERS 6, 7, 8
  // ============================================================================
  const avenueStops = [0.028, 0.068, 0.108, 0.148, 0.188];
  avenueStops.forEach((t, idx) => {
    const s = sampleAt(t);
    const hw = s.halfWidth;
    const tangentYaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);

    for (const side of [-1, 1]) {
      const lat = side * (hw + 4.4);
      const pos = worldPosAt(t, lat, -0.1, false);
      const inwardYaw = tangentYaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);

      let prop = null;
      let colRadius = 1.65;
      if (chapterIndex === 6) {
        prop =
          idx % 2 === 0
            ? buildLamassuColossus({ height: 9.4, useLapisWings: true })
            : buildHangingGardenAqueductColumn({ height: 10.6 });
        if (prop.userData.waterSheet) {
          animatedProps.push({
            kind: 'waterSheet',
            node: prop.userData.waterSheet,
            phase: idx * 1.3 + side,
          });
        }
        colRadius = idx % 2 === 0 ? 2.15 : 1.35;
      } else if (chapterIndex === 7) {
        prop = buildElderFutharkRunestone({ height: 9.6 + (idx % 2) * 1.6 });
        colRadius = 1.25;
      } else {
        prop =
          idx % 2 === 0
            ? buildPoseidonTridentColossus({ height: 12.5 })
            : buildBioluminescentCoralSpire({ height: 9.2, seed: idx * 7 + (side > 0 ? 1 : 2) });
        colRadius = idx % 2 === 0 ? 1.95 : 1.35;
      }

      prop.position.copy(pos);
      prop.rotation.y = inwardYaw;
      addNodeAtT(prop, t, false);
      registerCylinder({
        id: `comp_avenue_${chapterIndex}_${t.toFixed(3)}_${side}`,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        r: colRadius,
        h: 9.5,
        kind: 'avenue_monument',
      });

      placeBrazierAt(t, side * (hw + 1.6), 0, false, idx * 10 + (side > 0 ? 1 : 2));
    }
  });

  // ============================================================================
  // SECTION 3: MONUMENTAL THRESHOLD GATEWAY AT t = 0.24
  // ============================================================================
  {
    const tPortal = 0.24;
    const s = sampleAt(tPortal);
    const hw = s.halfWidth;
    const portalYaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);
    const clearSpan = (hw + 1.4) * 2;

    let gateway = null;
    if (chapterIndex === 6) {
      gateway = buildIshtarGlazedGateway({ width: clearSpan + 11.0, height: 14.8 });
    } else if (chapterIndex === 7) {
      gateway = new THREE.Group();
      gateway.name = 'ValhallaStaveThresholdGateway';
      for (const side of [-1, 1]) {
        const rs = buildElderFutharkRunestone({ height: 13.5 });
        rs.position.set(side * (clearSpan * 0.5 + 2.4), 0, 0);
        gateway.add(rs);
      }
      const gableBeam = new THREE.Mesh(
        applyWorldSpaceBoxUVs(new THREE.BoxGeometry(clearSpan + 8.5, 2.8, 3.6), 0.16, 0.22),
        textureSuite.materials.valhallaTimberGold
      );
      gableBeam.position.set(0, 11.2, 0);
      gateway.add(gableBeam);
    } else {
      gateway = new THREE.Group();
      gateway.name = 'AtlantisOrichalcumThresholdGateway';
      for (const side of [-1, 1]) {
        const col = buildPoseidonTridentColossus({ height: 14.0 });
        col.position.set(side * (clearSpan * 0.5 + 2.8), 0, 0);
        col.rotation.y = Math.PI;
        gateway.add(col);
      }
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(clearSpan * 0.56, 0.85, 12, 28, Math.PI),
        textureSuite.materials.orichalcumMetal
      );
      arch.position.set(0, 8.8, 0);
      gateway.add(arch);
    }

    gateway.position.copy(s.point);
    gateway.rotation.y = portalYaw;
    addNodeAtT(gateway, tPortal, false);

    for (const side of [-1, 1]) {
      const pierPos = worldPosAt(tPortal, side * (clearSpan * 0.5 + 2.5), 0, false);
      registerCylinder({
        id: `comp_portal_pier_${chapterIndex}_${side}`,
        x: pierPos.x,
        y: pierPos.y,
        z: pierPos.z,
        r: 2.25,
        h: 13.5,
        kind: 'portal_pier',
      });
    }
  }

  // ============================================================================
  // SECTION 4: COLONNADED INTERIOR HALLS (t = 0.25 -> 0.62)
  // ============================================================================
  // Subterranean/Interior Vault Shell so no exterior sky leaks inside the halls
  {
    const wallMat = (
      chapterIndex === 7
        ? textureSuite.materials.valhallaRunestone
        : chapterIndex === 8
        ? textureSuite.materials.atlantisMarbleOrichalcum
        : textureSuite.materials.babylonLapisBrick
    ).clone();
    wallMat.side = THREE.BackSide;
    const vaultShell = new THREE.Mesh(
      applyWorldSpaceBoxUVs(new THREE.BoxGeometry(320, 60, 320), 0.12, 0.16),
      wallMat
    );
    vaultShell.position.set(-18, 22, -10);
    interiorGroup.add(vaultShell);
  }

  for (let tHall = 0.265; tHall <= 0.615; tHall += 0.042) {
    const s = sampleAt(tHall);
    const hw = s.halfWidth;
    const yaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);

    for (const side of [-1, 1]) {
      const lat = side * (hw + 2.6);
      const pos = worldPosAt(tHall, lat, 0, false);
      const inwardYaw = yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);

      let hallProp = null;
      if (chapterIndex === 6) {
        hallProp = buildHangingGardenAqueductColumn({ height: 10.2 });
        if (hallProp.userData.waterSheet) {
          animatedProps.push({
            kind: 'waterSheet',
            node: hallProp.userData.waterSheet,
            phase: tHall * 25 + side,
          });
        }
      } else if (chapterIndex === 7) {
        hallProp = buildElderFutharkRunestone({ height: 9.8 });
      } else {
        hallProp =
          Math.round(tHall * 100) % 2 === 0
            ? buildBioluminescentCoralSpire({ height: 9.4, seed: Math.round(tHall * 100) + side })
            : buildPoseidonTridentColossus({ height: 11.8 });
      }

      hallProp.position.copy(pos);
      hallProp.rotation.y = inwardYaw;
      addNodeAtT(hallProp, tHall, false);
      registerCylinder({
        id: `comp_hall_col_${chapterIndex}_${tHall.toFixed(3)}_${side}`,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        r: 1.25,
        h: 9.5,
        kind: 'hall_column',
      });

      if (Math.round(tHall * 1000) % 84 < 42) {
        placeBrazierAt(tHall, side * (hw + 0.9), 0, false, Math.round(tHall * 200) + side);
      }
    }
  }

  // ============================================================================
  // SECTION 5: SECRET BRANCH TREASURY (u = 0.00 -> 1.00)
  // ============================================================================
  for (const uDoor of [0.08, 0.62]) {
    const bs = branchSampleAt(uDoor);
    const doorYaw = Math.atan2(bs.flatTangent.x, bs.flatTangent.z);
    const door = buildComplementarySecretSlidingDoor(chapterIndex, bs.halfWidth * 1.9 + 1.2, 6.4);
    door.position.copy(bs.point);
    door.rotation.y = doorYaw;
    addNodeAtT(door, 0.225, true);
  }

  for (const uHoard of [0.72, 0.82, 0.94]) {
    const bs = branchSampleAt(uHoard);
    const bYaw = Math.atan2(bs.flatTangent.x, bs.flatTangent.z);
    if (uHoard > 0.9) {
      const centerHoard = buildComplementaryTreasureHoard(chapterIndex, 4.2, 99);
      centerHoard.position.copy(bs.point);
      centerHoard.rotation.y = bYaw;
      addNodeAtT(centerHoard, 0.225, true);
      registerCylinder({
        id: `comp_secret_apex_hoard_${chapterIndex}`,
        x: bs.point.x,
        y: bs.point.y,
        z: bs.point.z,
        r: 2.1,
        h: 3.2,
        kind: 'treasure_hoard',
      });
    } else {
      for (const side of [-1, 1]) {
        const hPos = worldPosAt(uHoard, side * 5.6, 0, true);
        const sideHoard = buildComplementaryTreasureHoard(chapterIndex, 3.1, Math.round(uHoard * 100) + side);
        sideHoard.position.copy(hPos);
        sideHoard.rotation.y = bYaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        addNodeAtT(sideHoard, 0.225, true);
        placeBrazierAt(uHoard, side * 3.8, 0, true, Math.round(uHoard * 100) + side);
      }
    }
  }

  // ============================================================================
  // SECTION 6: FINAL BOSS SANCTUM (t = 0.82 -> 1.00)
  // ============================================================================
  {
    const arenaSample = sampleAt(0.96);
    const arenaCenter = arenaSample.point;
    const ringCount = 10;
    const ringRadius = 15.6;

    for (let i = 0; i < ringCount; i++) {
      const ang = (i / ringCount) * Math.PI * 2 + 0.25;
      const rx = arenaCenter.x + Math.cos(ang) * ringRadius;
      const rz = arenaCenter.z + Math.sin(ang) * ringRadius;
      const ry = arenaCenter.y;

      let sanctumProp = null;
      if (chapterIndex === 6) {
        sanctumProp =
          i % 2 === 0
            ? buildLamassuColossus({ height: 11.4, useLapisWings: true })
            : buildHangingGardenAqueductColumn({ height: 11.2 });
      } else if (chapterIndex === 7) {
        sanctumProp = buildElderFutharkRunestone({ height: 11.5 });
      } else {
        sanctumProp =
          i % 2 === 0
            ? buildPoseidonTridentColossus({ height: 14.0 })
            : buildBioluminescentCoralSpire({ height: 10.4, seed: 500 + i });
      }

      sanctumProp.position.set(rx, ry, rz);
      sanctumProp.rotation.y = -ang - Math.PI / 2;
      addNodeAtT(sanctumProp, 0.96, false);
      registerCylinder({
        id: `comp_sanctum_ring_${chapterIndex}_${i}`,
        x: rx,
        y: ry,
        z: rz,
        r: 1.85,
        h: 11.0,
        kind: 'sanctum_monument',
      });
    }

    // Colossal Sanctum Apex Megastructure behind the Final Boss Throne at t = 0.995
    const endSample = sampleAt(0.995);
    const endYaw = Math.atan2(endSample.flatTangent.x, endSample.flatTangent.z);
    const apexPos = endSample.point.clone().addScaledVector(endSample.flatTangent, 18.0);

    const apexMonument =
      chapterIndex === 6
        ? buildBabylonianZiggurat({ baseWidth: 44, height: 28, tiers: 7 })
        : chapterIndex === 7
        ? buildValhallaGreatMeadHall({ width: 30, height: 24, length: 42 })
        : buildAtlanteanOrichalcumTemple({ baseWidth: 46, height: 34 });

    apexMonument.position.copy(apexPos);
    apexMonument.rotation.y = endYaw;
    addNodeAtT(apexMonument, 0.99, false);
    if (apexMonument.userData?.astrolabeGroup) {
      animatedProps.push({
        kind: 'astrolabe',
        node: apexMonument.userData.astrolabeGroup,
        phase: 2.1,
      });
    }
  }

  // Per-frame animation update
  const update = (dt, elapsed = 0, playerLoc = null) => {
    if (playerLoc) {
      const inInterior = Boolean(playerLoc.isBranch) || (playerLoc.t ?? 0) >= 0.238;
      exteriorGroup.visible = !inInterior;
      interiorGroup.visible = inInterior;
    }
    const tNow = elapsed || performance.now() * 0.001;
    for (let i = 0; i < animatedProps.length; i++) {
      const p = animatedProps[i];
      if (p.kind === 'brazier' && p.brazier) {
        const fg = p.brazier.userData.flameGroup;
        const pl = p.brazier.userData.pointLight;
        const flicker = Math.sin(tNow * 11.1 + p.phase) * 0.12 + Math.cos(tNow * 17.3 + p.phase * 1.6) * 0.08;
        if (fg) {
          fg.scale.set(1.0 + flicker * 0.45, 1.0 + flicker * 0.9, 1.0 - flicker * 0.35);
          fg.rotation.y = tNow * 2.3 + p.phase;
        }
        if (pl) {
          pl.intensity = (p.brazier.userData.baseIntensity || 7.5) * (1.0 + flicker);
        }
      } else if (p.kind === 'astrolabe' && p.node) {
        p.node.rotation.y = tNow * 0.65 + p.phase;
        p.node.rotation.x = Math.sin(tNow * 0.9 + p.phase) * 0.28;
      } else if (p.kind === 'waterSheet' && p.node) {
        p.node.scale.x = 1.0 + Math.sin(tNow * 5.2 + p.phase) * 0.06;
      } else if (p.kind === 'longship' && p.node) {
        p.node.position.y = p.baseY + Math.sin(tNow * 1.35 + p.phase) * 0.35;
        p.node.rotation.z = Math.sin(tNow * 1.05 + p.phase) * 0.04;
      }
    }
  };

  return {
    rootGroup,
    exteriorGroup,
    interiorGroup,
    exteriorDesertGroup: exteriorGroup,
    interiorTombGroup: interiorGroup,
    textureSuite,
    lightAnchors,
    solidObstacles,
    animatedProps,
    update,
  };
}
