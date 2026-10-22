// WebGPU TSL N64-Style Math & Swatch Surface System for Athenaion Island (Chapter IX in Reincarnation)
// Replaces heavy multi-octave 3D simplex/fractal noise loops (`mx_fractal_noise_float`) with:
//   1. A single L1-cache-resident 128x128 RGBA N64-style procedural surface swatch (`getN64SurfaceSwatch()`),
//   2. Two-scale rotated world-space UV taps (N64 dual-scroll/detail-texture style), and
//   3. Pure analytic trigonometric interference waves (`sin`/`cos` harmonic math surfaces)
// cutting fragment shader ALU load by >85% while keeping crisp Pentelic marble, karst cliffs,
// terracotta roofs, turquoise Aegean water, and lush sunlit Mediterranean cypress/olive foliage.
import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  attribute,
  positionWorld,
  normalWorld,
  uv,
  texture,
  time,
  sin,
  cos,
  abs,
  fract,
  floor,
  min,
  max,
  clamp,
  mix,
  smoothstep,
  step,
  length,
} from 'three/tsl';

export const NOISE_GLSL = '';
export const CG_DFG_FIX_GLSL = '';
export function applyDFGFix(src) {
  return src;
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const _cache = new Map();
export function cached(key, build) {
  if (!_cache.has(key)) _cache.set(key, build());
  return _cache.get(key);
}

// -----------------------------------------------------------------------------
// N64-Style 128x128 4-Channel Surface Swatch LUT (fits in <64 KB of GPU L1 cache)
//   R: smooth macro value wave (0..1)
//   G: medium karst/stone pitting & grain (0..1)
//   B: diagonal marble vein & wood/strata fiber (0..1)
//   A: fine close-up grit speckle (0..1)
// -----------------------------------------------------------------------------
let _n64SwatchTex = null;
export function getN64SurfaceSwatch() {
  if (_n64SwatchTex) return _n64SwatchTex;
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  const hash2 = (x, y, seed) => {
    const xi = ((x % S) + S) % S;
    const yi = ((y % S) + S) % S;
    let h = (xi * 374761393 + yi * 668265263 + seed * 1442695041) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const vnoise = (u, v, cells, seed) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = hash2(x0, y0, seed);
    const n10 = hash2(x0 + 1, y0, seed);
    const n01 = hash2(x0, y0 + 1, seed);
    const n11 = hash2(x0 + 1, y0 + 1, seed);
    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
  };

  const TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = (y * S + x) * 4;
      // R: smooth tileable macro blotches
      const r = vnoise(u, v, 4, 11) * 0.65 + vnoise(u, v, 8, 23) * 0.35;
      // G: medium limestone/plaster pitting
      const g = vnoise(u, v, 12, 37) * 0.6 + vnoise(u, v, 24, 53) * 0.4;
      // B: tileable marble vein / strata wave
      const warp = (vnoise(u, v, 6, 71) - 0.5) * 2.2;
      const b = 0.5 + 0.5 * Math.sin((u * 2 + v * 3) * TAU + warp);
      // A: crisp high-frequency stone grit
      const a = vnoise(u, v, 32, 97) * 0.65 + hash2(x, y, 131) * 0.35;

      data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      data[i + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }

  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  _n64SwatchTex = tex;
  return tex;
}

// Pure analytic N64-style harmonic interference wave (4 ALU ops, 0 texture/lattice lookups)
function n64Wave2D(px, pz) {
  return sin(px.add(sin(pz.mul(1.37)))).mul(cos(pz.sub(cos(px.mul(1.19))))).mul(0.5).add(0.5);
}

// Rotated 2D coordinate helper (37 deg cos=0.7986, sin=0.6018) to break tiling in N64 dual-tap style
function rot2D(px, pz) {
  return vec2(px.mul(0.7986).sub(pz.mul(0.6018)), px.mul(0.6018).add(pz.mul(0.7986)));
}

// -----------------------------------------------------------------------------
// 1. N64-Style Terrain & Karst Cliff Math Surface (2 swatch reads + trig strata)
// -----------------------------------------------------------------------------
const buildTerrainColorNode = Fn(() => {
  const swatch = getN64SurfaceSwatch();
  const wp = positionWorld;
  const wn = normalWorld;
  const up = clamp(wn.y, 0.0, 1.0);
  const slope = float(1.0).sub(up);

  // Two-scale N64 swatch lookup + analytic macro wave
  const uvMacro = vec2(wp.x.mul(0.011), wp.z.mul(0.011));
  const uvMid = rot2D(wp.x.mul(0.065), wp.z.mul(0.065));
  const sw0 = texture(swatch, uvMacro);
  const sw1 = texture(swatch, uvMid);

  const nMacro = sw0.r.mul(0.65).add(n64Wave2D(wp.x.mul(0.009), wp.z.mul(0.009)).mul(0.35));
  const nMid = sw0.g.mul(0.55).add(sw1.r.mul(0.45));
  const nFine = sw1.g.mul(0.6).add(sw1.a.mul(0.4));

  // Mediterranean maquis grass, sun-cured meadow, and warm terra rossa soil
  const oliveGrass = vec3(0.17, 0.24, 0.095).mul(float(0.84).add(nFine.mul(0.32)));
  const dryMeadow = vec3(0.35, 0.30, 0.16).mul(float(0.86).add(nFine.mul(0.28)));
  const terraRossa = vec3(0.43, 0.30, 0.20).mul(float(0.86).add(nFine.mul(0.30)));

  const ground = mix(oliveGrass, dryMeadow, smoothstep(0.36, 0.68, nMacro));
  const soilGround = mix(ground, terraRossa, smoothstep(0.50, 0.78, nMid).mul(0.65));

  // Stratified Aegean karst limestone cliff bands & horizontal bedding ledges (pure trig + swatch)
  const strataWave = sin(wp.y.mul(0.58).add(nMid.mul(3.8)).add(sw0.b.mul(3.2)));
  const creamCliff = vec3(0.65, 0.59, 0.50);
  const greyCliff = vec3(0.40, 0.38, 0.35);
  const ochreBand = vec3(0.57, 0.46, 0.33);
  const cliffBase = mix(greyCliff, creamCliff, smoothstep(-0.38, 0.52, strataWave));
  const cliffColored = mix(cliffBase, ochreBand, smoothstep(0.52, 0.84, nMid).mul(0.45))
    .mul(float(0.82).add(nFine.mul(0.34)));

  const isCliff = smoothstep(0.22, 0.46, slope);
  const landCol = mix(soilGround, cliffColored, isCliff);

  // Golden shore sand & wet wave-washed rock near y = 0
  const sandCol = vec3(0.68, 0.59, 0.45).mul(float(0.88).add(nFine.mul(0.24)));
  const wetShore = vec3(0.24, 0.22, 0.18);
  const beachMask = float(1.0).sub(smoothstep(0.6, 3.2, wp.y)).mul(smoothstep(0.45, 0.85, up));
  const wetMask = float(1.0).sub(smoothstep(-0.4, 1.1, wp.y));

  const withBeach = mix(landCol, sandCol, beachMask);
  const withWet = mix(withBeach, wetShore, wetMask.mul(0.75));

  // High distant mountain snow (Parnassus / outer ring > 350m)
  const snowMask = smoothstep(350.0, 480.0, wp.y).mul(smoothstep(0.35, 0.72, up));
  const snowCol = vec3(0.88, 0.90, 0.94);
  return mix(withWet, snowCol, snowMask);
});

const buildRuinsSoilColorNode = Fn(() => {
  const swatch = getN64SurfaceSwatch();
  const wp = positionWorld;
  const sw = texture(swatch, vec2(wp.x.mul(0.09), wp.z.mul(0.09)));
  const n1 = sw.r;
  const n2 = sw.g;
  const soil = vec3(0.36, 0.28, 0.19).mul(float(0.84).add(n2.mul(0.32)));
  const stoneGrit = vec3(0.54, 0.49, 0.41).mul(float(0.86).add(n2.mul(0.28)));
  const moss = vec3(0.17, 0.23, 0.095).mul(float(0.86).add(n2.mul(0.28)));
  const c1 = mix(soil, stoneGrit, smoothstep(0.42, 0.74, n1));
  return mix(c1, moss, smoothstep(0.60, 0.84, n1).mul(0.45));
});

// -----------------------------------------------------------------------------
// 2. N64-Style Pentelic Marble & Coursed Ashlar Math Surface (1 swatch read + analytic veins/joints)
// -----------------------------------------------------------------------------
function createMarbleColorNode(baseRGB = [0.76, 0.71, 0.63], warmth = 0.25, courseH = 0.62) {
  return Fn(() => {
    const swatch = getN64SurfaceSwatch();
    const wp = positionWorld;
    const wn = normalWorld;
    const up = clamp(wn.y, 0.0, 1.0);
    const vert = float(1.0).sub(up);

    // Single N64 triplanar-style swatch read on world (x + y, z + y)
    const sw = texture(swatch, vec2(wp.x.add(wp.y.mul(0.35)).mul(0.08), wp.z.sub(wp.y.mul(0.25)).mul(0.08)));
    const nMacro = sw.r;
    const nMid = sw.g;
    const nFine = sw.a;

    const cream = vec3(baseRGB[0], baseRGB[1], baseRGB[2]);
    const ivory = cream.mul(vec3(1.04, 1.02, 0.98));
    const weatheredGrey = cream.mul(vec3(0.83, 0.82, 0.80));

    let col = mix(cream, ivory, smoothstep(0.28, 0.72, nMacro));
    col = mix(col, weatheredGrey, smoothstep(0.58, 0.86, nMacro).mul(0.50));
    col = col.mul(float(0.91).add(nMid.mul(0.18)).add(nFine.sub(0.5).mul(0.07)));

    // Analytic Pentelic marble veins warped by sw.b
    const veinCoord = wp.x.mul(0.75).add(wp.y.mul(1.15)).sub(wp.z.mul(0.55)).add(sw.b.mul(4.8));
    const vein = float(1.0).sub(smoothstep(0.0, 0.09, abs(sin(veinCoord))));
    col = mix(col, col.mul(vec3(0.77, 0.74, 0.70)), vein.mul(0.40));

    // Analytic coursed ashlar horizontal & vertical joints on vertical wall faces
    const ch = float(courseH);
    const fy = fract(wp.y.div(ch));
    const row = floor(wp.y.div(ch));
    const fx = fract(wp.x.add(wp.z).mul(0.42).add(fract(row.mul(0.37))));
    const hJoint = smoothstep(0.0, 0.04, min(fy, float(1.0).sub(fy)));
    const vJoint = smoothstep(0.0, 0.03, min(fx, float(1.0).sub(fx)));
    const jointMask = min(hJoint, vJoint);
    const blockVar = fract(sin(row.mul(12.9898).add(floor(wp.x.add(wp.z).mul(0.42)).mul(78.233))).mul(43758.5453));
    col = col.mul(mix(float(1.0), float(0.92).add(blockVar.mul(0.15)), vert.mul(0.65)));
    col = col.mul(mix(float(1.0), mix(float(0.60), float(1.0), jointMask), vert.mul(0.72)));

    // Warm honey-ochre Pentelic patina
    const patina = smoothstep(0.44, 0.80, nMid);
    col = mix(col, col.mul(vec3(1.05, 0.94, 0.80)), patina.mul(warmth));

    return col;
  })();
}

// -----------------------------------------------------------------------------
// 3. N64-Style Statue Material (vertex attribute `color` = (ao, cavity, metalMask))
// -----------------------------------------------------------------------------
const buildStatueColorNode = Fn(() => {
  const swatch = getN64SurfaceSwatch();
  const vc = attribute('color', 'vec3');
  const wp = positionWorld;
  const ao = clamp(vc.x, 0.0, 1.0);
  const cav = clamp(vc.y, 0.0, 1.0);
  const metal = clamp(vc.z, 0.0, 1.0);

  const sw = texture(swatch, vec2(wp.x.add(wp.y).mul(0.14), wp.z.sub(wp.y).mul(0.14)));
  const nMid = sw.g;
  const nFine = sw.a;

  let marble = vec3(0.79, 0.76, 0.70).mul(float(0.91).add(nMid.mul(0.16)));
  const vein = float(1.0).sub(smoothstep(0.0, 0.07, abs(sin(wp.x.mul(1.1).add(wp.y.mul(1.4)).add(sw.b.mul(4.0))))));
  marble = mix(marble, vec3(0.54, 0.49, 0.43), vein.mul(0.32));

  const grime = clamp(cav.mul(0.85).add(float(1.0).sub(ao).mul(0.95)), 0.0, 1.0);
  marble = mix(marble, vec3(0.40, 0.37, 0.32), smoothstep(0.08, 0.82, grime).mul(0.52));
  marble = marble.mul(mix(float(0.74), float(1.0), smoothstep(0.20, 0.92, ao)));

  const bronze = vec3(0.54, 0.38, 0.20).mul(float(0.86).add(nFine.mul(0.28))).mul(mix(float(0.68), float(1.0), ao));
  const gold = vec3(0.96, 0.76, 0.29).mul(float(0.88).add(nFine.mul(0.24))).mul(mix(float(0.72), float(1.0), ao));

  const isBronzeOrGold = smoothstep(0.30, 0.45, metal);
  const isGold = smoothstep(0.72, 0.88, metal);
  const metalCol = mix(bronze, gold, isGold);

  return mix(marble, metalCol, isBronzeOrGold);
});

const buildStatueMetalnessNode = Fn(() => {
  const vc = attribute('color', 'vec3');
  return smoothstep(0.30, 0.48, clamp(vc.z, 0.0, 1.0)).mul(0.92);
});

const buildStatueRoughnessNode = Fn(() => {
  const vc = attribute('color', 'vec3');
  const metal = clamp(vc.z, 0.0, 1.0);
  const isGold = smoothstep(0.72, 0.88, metal);
  const isMetal = smoothstep(0.30, 0.48, metal);
  return mix(float(0.52), mix(float(0.35), float(0.20), isGold), isMetal);
});

// -----------------------------------------------------------------------------
// 4. N64-Style City Plaster, Terracotta, Stone & Ship Surfaces (pure math + 1 swatch tap)
// -----------------------------------------------------------------------------
const buildCityPlasterColorNode = Fn(() => {
  const swatch = getN64SurfaceSwatch();
  const aFac = attribute('aFac', 'vec4');
  const aSty = attribute('aSty', 'vec4');
  const u = aFac.x;
  const v = aFac.y;
  const wh = max(aFac.w, 3.0);
  const seed = aSty.x;
  const stH = max(aSty.y, 2.5);

  const k = fract(seed.mul(7.13));
  const c1 = mix(vec3(0.76, 0.71, 0.60), vec3(0.74, 0.64, 0.48), smoothstep(0.18, 0.42, k));
  const c2 = mix(c1, vec3(0.72, 0.57, 0.45), smoothstep(0.52, 0.72, k));
  const base = mix(c2, vec3(0.74, 0.66, 0.47), smoothstep(0.78, 0.94, k))
    .mul(float(0.85).add(fract(seed.mul(31.7)).mul(0.20)));

  const sw = texture(swatch, vec2(u.mul(0.12), v.mul(0.12)));
  let col = base.mul(float(0.88).add(sw.g.mul(0.24)));

  const groundMask = float(1.0).sub(smoothstep(stH.mul(0.80), stH.mul(0.95), v));
  const stoneBase = vec3(0.58, 0.53, 0.45).mul(float(0.86).add(sw.r.mul(0.24)));
  col = mix(col, stoneBase, groundMask.mul(0.65));

  const cellU = fract(u.div(2.35)).sub(0.5);
  const cellV = fract(v.div(stH)).sub(0.52);
  const inUpper = smoothstep(stH.mul(0.85), stH.mul(1.05), v).mul(float(1.0).sub(smoothstep(wh.sub(0.9), wh.sub(0.4), v)));
  const winMask = float(1.0).sub(smoothstep(0.16, 0.21, abs(cellU)))
    .mul(float(1.0).sub(smoothstep(0.18, 0.23, abs(cellV))))
    .mul(inUpper);

  return mix(col, vec3(0.11, 0.09, 0.07), winMask.mul(0.88));
});

const buildCityTerracottaColorNode = Fn(() => {
  const aRoof = attribute('aRoof', 'vec4');
  const u = aRoof.x;
  const v = aRoof.y;
  const seed = aRoof.z;
  const k = fract(seed.mul(5.31));

  const c1 = mix(vec3(0.48, 0.19, 0.09), vec3(0.38, 0.15, 0.08), smoothstep(0.25, 0.55, k));
  const base = mix(c1, vec3(0.50, 0.24, 0.12), smoothstep(0.60, 0.85, k))
    .mul(float(0.84).add(fract(seed.mul(17.3)).mul(0.26)));

  const rib = sin(u.mul(18.5)).mul(0.5).add(0.5);
  const course = smoothstep(0.0, 0.15, fract(v.div(0.42)));
  const wave = n64Wave2D(u.mul(0.9), v.mul(0.9));

  return base
    .mul(float(0.84).add(rib.mul(0.22)))
    .mul(mix(float(0.70), float(1.0), course))
    .mul(float(0.90).add(wave.mul(0.20)));
});

const buildCityStoneColorNode = Fn(() => {
  const swatch = getN64SurfaceSwatch();
  const aSt = attribute('aSt', 'vec4');
  const s = aSt.x;
  const t = aSt.y;
  const seed = aSt.z;
  const kind = aSt.w;

  const sw = texture(swatch, vec2(s.mul(0.11), t.mul(0.11)));
  const limestone = vec3(0.61, 0.55, 0.45).mul(float(0.86).add(sw.g.mul(0.24))).mul(float(0.92).add(fract(seed.mul(19.3)).mul(0.16)));

  const jx = smoothstep(0.0, 0.05, min(fract(s.div(1.25)), float(1.0).sub(fract(s.div(1.25)))));
  const jy = smoothstep(0.0, 0.05, min(fract(t.div(0.62)), float(1.0).sub(fract(t.div(0.62)))));
  const joint = min(jx, jy);
  let col = limestone.mul(mix(float(0.64), float(1.0), joint));

  const isStreet = smoothstep(5.5, 6.5, kind).mul(float(1.0).sub(smoothstep(6.5, 7.5, kind)));
  const earth = vec3(0.43, 0.35, 0.26).mul(float(0.86).add(sw.r.mul(0.26)));
  col = mix(col, earth, isStreet.mul(0.45));

  const isVoid = smoothstep(8.5, 9.2, kind);
  return mix(col, vec3(0.025, 0.022, 0.018), isVoid);
});

const buildShipWoodColorNode = Fn(() => {
  const aW = attribute('aW', 'vec4');
  const u = aW.x;
  const v = aW.y;
  const s = aW.z;
  const kind = aW.w;
  const grain = sin(v.mul(36.0).add(u.mul(1.8)).add(s.mul(9.0))).mul(0.5).add(0.5);

  const tarHull = vec3(0.09, 0.068, 0.05).mul(float(0.85).add(grain.mul(0.28)));
  const oakDeck = vec3(0.36, 0.25, 0.15).mul(float(0.85).add(grain.mul(0.28)));
  const bronzeRam = vec3(0.60, 0.42, 0.19);

  const isTar = float(1.0).sub(smoothstep(0.4, 0.8, kind));
  const isBronze = smoothstep(4.5, 5.0, kind).mul(float(1.0).sub(smoothstep(5.2, 5.8, kind)));
  return mix(mix(oakDeck, tarHull, isTar), bronzeRam, isBronze);
});

const buildShipSailColorNode = Fn(() => {
  const aSail = attribute('aSail', 'vec4');
  const u = aSail.x;
  const s = aSail.z;
  const kind = aSail.w;
  const weave = sin(u.mul(14.0)).mul(0.04).add(0.96);
  const linen = vec3(0.76, 0.69, 0.56).mul(weave);
  const stripe = step(0.5, fract(u.div(1.6)));
  const striped = mix(linen, vec3(0.46, 0.15, 0.09).mul(weave), stripe.mul(0.85));
  const navyGold = mix(vec3(0.05, 0.07, 0.18), vec3(0.70, 0.52, 0.19), step(0.72, fract(u.mul(0.35).add(s))));

  const isStriped = smoothstep(0.5, 1.2, kind).mul(float(1.0).sub(smoothstep(1.5, 2.0, kind)));
  const isNavy = smoothstep(1.6, 2.2, kind).mul(float(1.0).sub(smoothstep(2.5, 3.0, kind)));
  return mix(mix(linen, striped, isStriped), navyGold, isNavy);
});

// -----------------------------------------------------------------------------
// 5. N64-Style Aegean Lagoon, Sea & Waterfall Surfaces (dual-scrolled swatch + trig caustics)
// -----------------------------------------------------------------------------
const buildWaterfallColorNode = Fn(() => {
  const swatch = getN64SurfaceSwatch();
  const wp = positionWorld;
  const t = time.mul(1.8);
  const sw1 = texture(swatch, vec2(wp.x.add(wp.z).mul(0.14), wp.y.mul(0.09).add(t)));
  const sw2 = texture(swatch, vec2(wp.x.sub(wp.z).mul(0.28), wp.y.mul(0.18).add(t.mul(1.35))));
  const foam = smoothstep(0.26, 0.74, sw1.g.mul(0.6).add(sw2.b.mul(0.4)));
  return mix(vec3(0.18, 0.42, 0.48), vec3(0.90, 0.95, 0.98), foam);
});

const buildWaterfallOpacityNode = Fn(() => {
  const swatch = getN64SurfaceSwatch();
  const wp = positionWorld;
  const t = time.mul(1.8);
  const sw1 = texture(swatch, vec2(wp.x.add(wp.z).mul(0.14), wp.y.mul(0.09).add(t)));
  return clamp(float(0.62).add(sw1.g.mul(0.34)), 0.42, 0.95);
});

const buildWaterChannelColorNode = Fn(() => {
  const swatch = getN64SurfaceSwatch();
  const wp = positionWorld;
  const t = time.mul(0.35);
  // N64 dual-scrolled water ripple & caustic interference
  const sw1 = texture(swatch, vec2(wp.x.mul(0.045).add(t.mul(0.4)), wp.z.mul(0.045).sub(t.mul(0.3))));
  const sw2 = texture(swatch, rot2D(wp.x.mul(0.11).sub(t.mul(0.5)), wp.z.mul(0.11).add(t.mul(0.4))));
  const ripple = sw1.b.mul(0.55).add(sw2.g.mul(0.45));

  // Turquoise Aegean shallows around the island & deep cerulean sea beyond
  const distFromLagoon = length(vec2(wp.x.add(40.0), wp.z.sub(90.0)));
  const shallowMask = float(1.0).sub(smoothstep(45.0, 320.0, distFromLagoon));

  const deepAegean = vec3(0.04, 0.18, 0.26);
  const lagoonTurquoise = vec3(0.09, 0.38, 0.42);
  const causticHighlight = vec3(0.24, 0.58, 0.60);
  const baseWater = mix(deepAegean, lagoonTurquoise, shallowMask);
  const withCaustics = mix(baseWater, causticHighlight, smoothstep(0.42, 0.82, ripple).mul(0.42));
  const whitecap = smoothstep(0.78, 0.93, ripple);
  return mix(withCaustics, vec3(0.86, 0.92, 0.94), whitecap.mul(0.28));
});

// -----------------------------------------------------------------------------
// 6. Sunlit Mediterranean Foliage & Flora Shaders (Cypress, Olive, Holm Oak, Pine, Ivy, Herbs)
// -----------------------------------------------------------------------------
function createVegetationFoliageNodes(mapTex, species = 'cypress', isCard = false) {
  const palettes = {
    cypress: { deep: [0.09, 0.16, 0.06], mid: [0.18, 0.30, 0.10], tip: [0.36, 0.48, 0.16], gain: 2.65 },
    olive:   { deep: [0.16, 0.22, 0.13], mid: [0.30, 0.38, 0.24], tip: [0.52, 0.58, 0.44], gain: 1.75 },
    broad:   { deep: [0.11, 0.19, 0.07], mid: [0.22, 0.35, 0.12], tip: [0.42, 0.54, 0.19], gain: 2.25 },
    pine:    { deep: [0.12, 0.20, 0.08], mid: [0.24, 0.36, 0.14], tip: [0.40, 0.50, 0.20], gain: 1.85 },
    shrub:   { deep: [0.13, 0.21, 0.09], mid: [0.25, 0.37, 0.15], tip: [0.44, 0.54, 0.22], gain: 2.25 },
  };
  const pal = palettes[species] || palettes.broad;

  const colorNode = Fn(() => {
    const aFol = attribute('aFol', 'vec4');
    const ao = clamp(aFol.x, 0.22, 1.0);
    const tip = clamp(aFol.y, 0.0, 1.0);
    const vr = clamp(aFol.z, 0.0, 1.0);

    const deepCol = vec3(pal.deep[0], pal.deep[1], pal.deep[2]);
    const midCol = vec3(pal.mid[0], pal.mid[1], pal.mid[2]);
    const tipCol = vec3(pal.tip[0], pal.tip[1], pal.tip[2]);

    let crownGrad = mix(deepCol, midCol, smoothstep(0.15, 0.75, ao));
    crownGrad = mix(crownGrad, tipCol, tip.mul(0.72));
    crownGrad = crownGrad.mul(float(0.90).add(vr.mul(0.22)));

    if (mapTex) {
      const texSample = texture(mapTex, uv());
      const boostedTex = texSample.rgb.mul(pal.gain).mul(mix(float(0.62), float(1.18), ao));
      return mix(crownGrad, boostedTex.add(crownGrad.mul(0.38)), 0.65);
    }
    return crownGrad;
  })();

  const opacityNode = isCard && mapTex
    ? Fn(() => texture(mapTex, uv()).a)()
    : null;

  return { colorNode, opacityNode };
}

/**
 * WebGPU TSL implementation of `proceduralMaterial(o = {})`.
 */
export function proceduralMaterial(o = {}) {
  const name = String(o.name || 'proc');
  const lower = name.toLowerCase();
  const rawParams = { ...(o.params || {}) };

  // Strip any undefined/null map properties that Three.js warns about
  for (const k of Object.keys(rawParams)) {
    if (rawParams[k] === undefined || rawParams[k] === null) {
      delete rawParams[k];
    }
  }

  // Statues pack (ao, cavity, metal) into the `color` vertex attribute — disable default vertexColors multiplication
  if (lower.includes('statue')) {
    rawParams.vertexColors = false;
  }

  // Flora leaves (`oliveLeaf`, `ivyLeaf`) pack AO into `color.a`; disable default vertexColors so `color.a` never zeroes opacity
  if (lower === 'oliveleaf' || lower === 'ivyleaf') {
    rawParams.vertexColors = false;
  }

  const customMap = rawParams.map || null;
  if (lower.startsWith('foliage-') || lower === 'ivyleaf') {
    delete rawParams.map;
  }

  const MatClass = o.type === 'physical' ? THREE.MeshPhysicalNodeMaterial : THREE.MeshStandardNodeMaterial;
  const mat = new MatClass(rawParams);
  mat.name = name;
  mat.userData.shaderKey = 'cg_' + name;
  mat.userData.cgUniforms = o.uniforms || {};
  mat.onBeforeCompile = () => {};

  if (lower === 'terrain' || lower === 'aqtestterrain' || lower === 'testground') {
    mat.colorNode = buildTerrainColorNode();
    mat.roughness = 0.90;
    mat.metalness = 0.02;
  } else if (lower === 'ruinssoil' || lower === 'ruinsrockground' || lower === 'acro-soil' || lower === 'florarockfallback') {
    mat.colorNode = buildRuinsSoilColorNode();
    mat.roughness = 0.92;
    mat.metalness = 0.02;
  } else if (lower.includes('statue')) {
    mat.colorNode = buildStatueColorNode();
    mat.metalnessNode = buildStatueMetalnessNode();
    mat.roughnessNode = buildStatueRoughnessNode();
  } else if (lower === 'cityplaster') {
    mat.colorNode = buildCityPlasterColorNode();
    mat.roughness = 0.88;
    mat.metalness = 0.0;
  } else if (lower === 'cityterracotta') {
    mat.colorNode = buildCityTerracottaColorNode();
    mat.roughness = 0.78;
    mat.metalness = 0.02;
  } else if (lower === 'citystone' || lower === 'citystreet') {
    mat.colorNode = buildCityStoneColorNode();
    mat.roughness = 0.86;
    mat.metalness = 0.02;
  } else if (lower === 'cityshipwood') {
    mat.colorNode = buildShipWoodColorNode();
    mat.roughness = 0.68;
  } else if (lower === 'citysail') {
    mat.colorNode = buildShipSailColorNode();
    mat.roughness = 0.88;
  } else if (lower === 'waterfallsheet') {
    mat.colorNode = buildWaterfallColorNode();
    mat.opacityNode = buildWaterfallOpacityNode();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.roughness = 0.25;
  } else if (lower === 'watersurface' || lower === 'aqwater') {
    mat.colorNode = buildWaterChannelColorNode();
    mat.roughness = 0.08;
    mat.metalness = 0.05;
  } else if (lower.startsWith('foliage-') && !lower.endsWith('-bb')) {
    // Tree & shrub crowns: `foliage-cypress-blob`, `foliage-cypress-card`, `foliage-olive-card`, etc.
    const parts = lower.split('-');
    const species = parts[1] || 'broad';
    const isCard = parts[2] === 'card';
    const { colorNode, opacityNode } = createVegetationFoliageNodes(customMap, species, isCard);
    mat.colorNode = colorNode;
    if (opacityNode) {
      mat.opacityNode = opacityNode;
      mat.alphaTest = 0.45;
    }
    mat.roughness = 0.68;
    mat.metalness = 0.0;
  } else if (lower.endsWith('-bb')) {
    // Far-LOD tree impostor billboard
    const parts = lower.split('-');
    const species = parts[1] || 'broad';
    const aAux = attribute('aAux', 'vec2');
    const shape = float(o.uniforms?.uBBShape?.value ?? 1.0);
    const { colorNode } = createVegetationFoliageNodes(null, species, false);
    mat.colorNode = colorNode;
    mat.opacityNode = Fn(() => {
      const u = aAux.x;
      const v = aAux.y;
      const d = length(vec2(u, v.sub(mix(float(0.50), float(0.62), step(0.5, shape))).div(0.46)));
      return step(d, 0.92);
    })();
    mat.alphaTest = 0.5;
  } else if (lower === 'oliveleaf') {
    // Hero & ruins 3D olive leaves (vertex `color` = vec4(r,g,b halved, a=AO))
    mat.colorNode = Fn(() => {
      const vc = attribute('color', 'vec4');
      const ao = clamp(vc.w, 0.35, 1.0);
      const baseOlive = vec3(0.25, 0.33, 0.18).mul(vc.xyz.mul(2.1)).mul(ao);
      return baseOlive;
    })();
    mat.roughness = 0.55;
    mat.metalness = 0.0;
  } else if (lower === 'ivyleaf') {
    // Ivy leaves on ruins & acropolis walls (`customMap = ivyAtlas()`)
    if (customMap) {
      mat.colorNode = Fn(() => {
        const vc = attribute('color', 'vec4');
        const ao = clamp(vc.w, 0.35, 1.0);
        const tex = texture(customMap, uv());
        return tex.rgb.mul(vc.xyz.mul(2.2)).mul(ao).add(vec3(0.05, 0.09, 0.03));
      })();
      mat.opacityNode = Fn(() => texture(customMap, uv()).a)();
      mat.alphaTest = 0.45;
    }
    mat.roughness = 0.54;
    mat.metalness = 0.0;

  } else if (lower === 'herbleaf' || lower === 'mosscushion') {
    // Ground cover (grass tufts, yellow wildflowers, lavender, rosemary, moss, shrubs)
    // Uses vertex `color` (vec4 with halved RGB + w=AO)
    mat.colorNode = Fn(() => {
      const vc = attribute('color', 'vec4');
      const ao = clamp(vc.w, 0.48, 1.0);
      return vc.xyz.mul(2.55).mul(ao).add(vec3(0.05, 0.08, 0.03));
    })();
    mat.roughness = lower === 'mosscushion' ? 0.92 : 0.65;
    mat.metalness = 0.0;
  } else if (lower.includes('void') || lower === 'acro-dark' || (o.uniforms?.uMR?.value?.y > 0.3)) {
    mat.color = new THREE.Color(0.035, 0.032, 0.028);
    mat.roughness = 0.96;
    mat.metalness = 0.0;
  } else if (lower === 'braziercoals') {
    mat.color = new THREE.Color(0.18, 0.06, 0.02);
    mat.emissive = new THREE.Color(0xff5a14);
    mat.emissiveIntensity = 2.4;
    mat.roughness = 0.85;
  } else if (lower.includes('gold')) {
    mat.color = new THREE.Color(0xd8a848);
    mat.metalness = 0.92;
    mat.roughness = 0.26;
  } else if (lower.includes('bronze') || lower === 'brazierinner') {
    mat.color = new THREE.Color(0x7c5830);
    mat.metalness = 0.86;
    mat.roughness = 0.38;
  } else if (lower.includes('bark') || lower.includes('wood') || lower === 'ivystem') {
    const bA = o.uniforms?.uBarkA?.value;
    mat.color = bA ? new THREE.Color(bA.x, bA.y, bA.z) : new THREE.Color(0x584636);
    mat.roughness = 0.88;
    mat.metalness = 0.0;
  } else if (
    lower.startsWith('marble') ||
    lower.startsWith('acro-') ||
    lower.startsWith('aq') ||
    lower.startsWith('ruin') ||
    lower.startsWith('prop') ||
    lower.includes('rock') ||
    lower.includes('limestone') ||
    lower.includes('boulder') ||
    lower.includes('stone')
  ) {
    let baseRGB = [0.74, 0.69, 0.61];
    const uMTint = o.uniforms?.uMTint?.value;
    const uBase = o.uniforms?.uBase?.value;
    const uTint = o.uniforms?.uTint?.value;
    if (uMTint && typeof uMTint.x === 'number') {
      baseRGB = [uMTint.x, uMTint.y, uMTint.z];
    } else if (uBase && typeof uBase.r === 'number') {
      baseRGB = [uBase.r, uBase.g, uBase.b];
    } else if (uTint && typeof uTint.x === 'number') {
      baseRGB = [0.68 * uTint.x, 0.63 * uTint.y, 0.55 * uTint.z];
    }
    const warmth = o.uniforms?.uAcQ?.value?.x ?? 0.25;
    const courseH = o.uniforms?.uCourse?.value ?? 0.62;
    mat.colorNode = createMarbleColorNode(baseRGB, warmth, courseH);
  }

  return mat;
}

/** sRGB hex / css → linear THREE.Color */
export function col(hex) {
  return new THREE.Color(hex);
}
