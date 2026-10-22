import * as THREE from 'three/webgpu';
import {
  Fn,
   float,
  vec2,
  vec3,
  vec4,
  uv,
  time,
  positionLocal,
  positionWorld,
  normalLocal,
  normalView,
  normalWorld,
  cameraPosition,
  attribute,
  uniform,
  mix,
  smoothstep,
  clamp,
  pow,
  sin,
  cos,
  abs,
  max,
  min,
  length,
  dot,
  normalize,
  fract,
  floor,
  exp,
  log,
  atan as atan2,
  step,
  fwidth,
  mx_fractal_noise_float,
  mx_worley_noise_float,
} from 'three/tsl';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLTF } from '../anim/puppet-store.js';

// ============================================================================
// ACHREF ELOUAFI ELEMENTAL SANDBOXES -> WEBGPU TSL ENGINE
// Adapts:
//  1. LinearAbiltyCastingExtendedThreeJS (Caustic Bloom, Celestial Rend,
//     Astral Void, Venom Surge, Brutalist Earth Blast, Baleful Cascade,
//     Arborist's Growth, Volcanic Ward, Cyber Serpent, Sumi Tide)
//  2. LinearAbilityExtThreeJS (Pyre Crown, Kraken Crown, Electrical Sphere,
//     Verdant Gate, Tidewrought Ring, Fire Portal, Fire/Electric/Magic Boosts)
//  3. HandCastAbilityThreeJS (Serpent Tide Field Phoenix Casting with
//     phoenix_bird.glb, Linear Void Slash, Shimmering Flux, Glacial Shard Storm)
// ============================================================================

const TAU = Math.PI * 2;
const hash11 = (p) => {
  const x = Math.sin(p * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

// ----------------------------------------------------------------------------
// 1. SHARED TSL MATHEMATICAL FUNCTIONS (Planckian Blackbody, FlameFBM,
//    VoronoiEtch, SurfaceBoil, LineAA, SparkleField)
// ----------------------------------------------------------------------------

/**
 * Planckian blackbody radiator (Tanner Helland fit), linear RGB in TSL.
 * Ported from HandCastAbilityThreeJS/src/materials/PhoenixMaterials.js
 */
export const blackbodyTSL = (kelvinNode) => {
  const t = clamp(kelvinNode, float(1000.0), float(12000.0)).mul(0.01);
  const rLo = float(1.0);
  const rHi = pow(max(t.sub(60.0), float(0.1)), float(-0.1332047)).mul(1.2929362);
  const r = clamp(mix(rHi, rLo, step(t, float(66.0))), float(0.0), float(1.0));

  const gLo = log(max(t, float(1.0))).mul(0.3900816).sub(0.6318414);
  const gHi = pow(max(t.sub(60.0), float(0.1)), float(-0.0755148)).mul(1.1298909);
  const g = clamp(mix(gHi, gLo, step(t, float(66.0))), float(0.0), float(1.0));

  const bMid = log(max(t.sub(10.0), float(1.0))).mul(0.5432068).sub(1.196254);
  const bLo = mix(bMid, float(0.0), step(t, float(19.0)));
  const b = clamp(mix(float(1.0), bLo, step(t, float(66.0))), float(0.0), float(1.0));

  const c = vec3(r, g, b);
  return c.mul(c).mul(c.mul(0.4).add(0.6));
};

const toFloat = (v) => (typeof v === 'number' ? float(v) : v);

/**
 * Progressive domain-warped turbulent flame field (0..1) in TSL.
 * Ported from PhoenixMaterials.js `flameFbm`.
 */
export const flameFbmTSL = (pNode, riseNode = float(0.0), warpNode = float(0.35)) => {
  const rN = riseNode !== undefined ? toFloat(riseNode) : float(0.0);
  const wN = warpNode !== undefined ? toFloat(warpNode) : float(0.35);
  const p0 = pNode.sub(vec3(0.0, rN, 0.0));
  const n0 = mx_fractal_noise_float(p0, 2, float(2.0), float(0.5));
  const p1 = p0.mul(2.12).add(vec3(n0.sub(0.5).mul(wN.mul(1.7)), rN.mul(-1.6), n0.sub(0.5).mul(wN.mul(1.3))));
  const n1 = mx_fractal_noise_float(p1, 2, float(2.1), float(0.5));
  return clamp(n0.mul(0.58).add(n1.mul(0.42)), float(0.0), float(1.0));
};

/**
 * Constant-pixel-width antialiased SDF line stroke (`lineAA`) from RendSigilMaterial.js
 */
export const lineAATSL = (fieldNode, widthNode) => {
  const fN = toFloat(fieldNode);
  const wN = toFloat(widthNode);
  const g = max(fwidth(fN), float(1e-4));
  const px = abs(fN).div(g);
  const want = max(wN.div(g), float(0.35));
  const w = max(want, float(1.0));
  return float(1.0).sub(smoothstep(float(0.0), w, px)).mul(want.div(w));
};

// ----------------------------------------------------------------------------
// 2. PROCEDURAL GEOMETRY BUILDERS (Crystals, Obsidian Flakes, Rend Slings,
//    Serpent Strips) — Ported from sandbox src/assets/
// ----------------------------------------------------------------------------

export function createSandboxCrystalGeometry({
  seed = 3,
  sides = 6,
  rows = 11,
  width = 0.085,
  waist = 0.36,
  sharp = 0.85,
  jitter = 0.28,
} = {}) {
  const facets = Math.max(4, Math.round(sides));
  const steps = Math.max(4, Math.round(rows));
  const facetScale = new Float32Array(facets);
  for (let j = 0; j < facets; j++) {
    facetScale[j] = 1 + (hash11(seed * 7.31 + j * 2.17) - 0.5) * 2 * jitter;
  }
  const leanX = (hash11(seed * 3.7) - 0.5) * 0.10;
  const leanZ = (hash11(seed * 5.9 + 1.3) - 0.5) * 0.10;

  const profile = (t) => {
    const k = t <= waist ? t / Math.max(1e-4, waist) : (1 - t) / Math.max(1e-4, 1 - waist);
    const power = t <= waist ? sharp : sharp * 1.85;
    return Math.pow(Math.max(0, k), power);
  };

  const ringPoints = [];
  const tail = [leanX * -0.5, -0.5, leanZ * -0.5];
  const head = [leanX * 0.5, 0.5, leanZ * 0.5];

  for (let i = 1; i < steps - 1; i++) {
    const t = i / (steps - 1);
    const y = t - 0.5;
    const r = width * profile(t);
    const roll = t * 0.52 + seed;
    const ring = [];
    for (let j = 0; j < facets; j++) {
      const a = (j / facets) * TAU + roll;
      const rr = r * facetScale[j];
      ring.push([Math.cos(a) * rr + leanX * y, y, Math.sin(a) * rr + leanZ * y]);
    }
    ringPoints.push(ring);
  }

  // Non-indexed triangles so each crystal facet has crisp flat normals
  const positions = [];
  const pushTri = (a, b, c) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };

  const firstRing = ringPoints[0];
  for (let j = 0; j < facets; j++) {
    pushTri(tail, firstRing[(j + 1) % facets], firstRing[j]);
  }
  for (let i = 0; i < ringPoints.length - 1; i++) {
    const rA = ringPoints[i];
    const rB = ringPoints[i + 1];
    for (let j = 0; j < facets; j++) {
      const n = (j + 1) % facets;
      pushTri(rA[j], rA[n], rB[j]);
      pushTri(rA[n], rB[n], rB[j]);
    }
  }
  const lastRing = ringPoints[ringPoints.length - 1];
  for (let j = 0; j < facets; j++) {
    pushTri(head, lastRing[j], lastRing[(j + 1) % facets]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the normalized Phoenix rig from `public/models/phoenix_bird.glb`.
 * Ported from HandCastAbilityThreeJS/src/assets/PhoenixRig.js
 */
const PHOENIX_BONES = Object.freeze({
  spine: 'B_Spine_02',
  head: 'b_Head_06',
  jaw: 'B_Jaw_07',
  leftFoot: 'b_Left_Foot_037',
  rightFoot: 'b_Right_Foot_039',
  tail: 'B_Tail_5_034',
});

export function buildPhoenixRig(gltf, { wingspan = 4.2 } = {}) {
  const scene = cloneSkeleton(gltf.scene);
  const clip = gltf.animations?.[0] ?? null;
  scene.updateMatrixWorld(true);

  const skinned = [];
  scene.traverse((node) => {
    if (node.isSkinnedMesh) skinned.push(node);
  });

  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  for (const mesh of skinned) {
    if (mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        box.union(meshBox);
      }
    }
  }
  if (box.isEmpty()) box.setFromObject(scene);

  const spinePos = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const spineNode = scene.getObjectByName(PHOENIX_BONES.spine);
  const headNode = scene.getObjectByName(PHOENIX_BONES.head);
  if (spineNode) spineNode.getWorldPosition(spinePos);
  else box.getCenter(spinePos);
  if (headNode) headNode.getWorldPosition(headPos);
  else headPos.copy(spinePos).add(new THREE.Vector3(1, 0, 0));

  const fx = headPos.x - spinePos.x;
  const fz = headPos.z - spinePos.z;
  const yaw = Math.atan2(-fx, fz);

  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? box.max.x : box.min.x;
    const z = i & 2 ? box.max.z : box.min.z;
    const rx = x * cosY + z * sinY;
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
  }
  const measuredSpan = Math.max(1e-3, maxX - minX);
  const scale = wingspan / measuredSpan;

  const pivot = new THREE.Group();
  pivot.name = 'PhoenixPivot';
  pivot.position.set(-spinePos.x, -spinePos.y, -spinePos.z);
  pivot.add(scene);

  const source = new THREE.Group();
  source.name = 'PhoenixBird';
  source.scale.setScalar(scale);
  source.rotation.y = yaw;
  source.add(pivot);
  source.updateMatrixWorld(true);

  return {
    source,
    clip,
    bones: PHOENIX_BONES,
    wingspan,
  };
}

/**
 * Creates a Planckian Blackbody Fire-Fresnel TSL Material for the skinned Phoenix
 * (`createPhoenixBodyMaterial` + `createPhoenixAuraMaterial` combined).
 */
export function createPhoenixPlumageTSLMaterial(baseMap = null, isAuraShell = false) {
  const uRevealY = uniform(-1000.0);
  const uDissolve = uniform(0.0);
  const uHeatBoost = uniform(1.0);

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: isAuraShell,
    blending: isAuraShell ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !isAuraShell,
    side: isAuraShell ? THREE.FrontSide : THREE.DoubleSide,
  });

  if (isAuraShell) {
    mat.positionNode = Fn(() => {
      return positionLocal.add(normalLocal.mul(0.035));
    })();
  }

  mat.colorNode = Fn(() => {
    const V = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(normalize(normalWorld), V));
    const fres = float(1.0).sub(facing);
    const rim = pow(fres, float(isAuraShell ? 2.1 : 1.75));

    const p = positionWorld.mul(1.65).sub(vec3(0.0, time.mul(3.2).add(fres.mul(fres).mul(1.2)), 0.0));
    const flame = flameFbmTSL(p, time.mul(0.25), float(0.38));

    const heat = clamp(
      float(0.38)
        .add(flame.sub(0.45).mul(0.65))
        .add(rim.mul(1.35).mul(float(0.55).add(flame.mul(0.7))))
        .mul(uHeatBoost),
      float(0.0),
      float(1.0),
    );

    const kelvin = mix(float(1450.0), float(3850.0), heat);
    const radCol = blackbodyTSL(kelvin).mul(pow(kelvin.div(3600.0), float(2.2)));
    const artistic = mix(
      mix(vec3(0.28, 0.04, 0.01), vec3(1.0, 0.24, 0.04), smoothstep(float(0.0), float(0.45), heat)),
      mix(vec3(1.0, 0.65, 0.15), vec3(1.4, 1.28, 0.92), smoothstep(float(0.45), float(0.92), heat)),
      smoothstep(float(0.35), float(0.85), heat),
    );

    const revealEdge = float(1.0).sub(smoothstep(float(0.0), float(0.28), max(positionWorld.y.sub(uRevealY), float(0.0))));
    const finalCol = mix(radCol, artistic, float(0.35)).mul(isAuraShell ? 1.95 : 1.58);
    return finalCol.add(vec3(1.85, 1.55, 0.85).mul(revealEdge.mul(1.65)));
  })();

  if (isAuraShell) {
    mat.opacityNode = Fn(() => {
      const V = normalize(cameraPosition.sub(positionWorld));
      const fres = float(1.0).sub(abs(dot(normalize(normalWorld), V)));
      const p = positionWorld.mul(1.8).sub(vec3(0.0, time.mul(3.4), 0.0));
      const flame = flameFbmTSL(p, time.mul(0.3), float(0.35));
      const tongue = smoothstep(float(0.28), float(0.72), flame);
      const alive = step(uRevealY, positionWorld.y).mul(step(uDissolve, flame.add(0.15)));
      return clamp(pow(fres, float(1.8)).mul(tongue).mul(0.85), float(0.0), float(0.75)).mul(alive);
    })();
  }

  mat.userData = { uRevealY, uDissolve, uHeatBoost };
  return mat;
}

// ============================================================================
// 3. ELEMENTAL SANDBOX VFX SUBSYSTEM (Pooled Multi-Pass GPU Layers)
// ============================================================================

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _col = new THREE.Color();

export class ElementalSandboxSubsystem {
  constructor(scene) {
    this.scene = scene;

    // ------------------------------------------------------------------------
    // LAYER A: Ground Sigils & Pools (1 Shared Pipeline, 28 Instances)
    // Modes (aVfxData.z):
    //   0 = Caustic Bloom Metallic Flash (Sword Cling / Contact / Parry)
    //   1 = Caustic Bloom Acid Pool (voronoiEtch + surfaceBoil + glossy sheen)
    //   2 = Celestial Rend Sigil (4-point concave star + concentric rings + ticks + shatter cracks)
    //   3 = Phoenix / Volcanic Molten Voronoi Pyre Crust
    //   4 = Baleful Cascade Barbed Diamond Star / Frost Rime / Arc Vein
    // ------------------------------------------------------------------------
    this.maxSigils = 28;
    this.sigils = [];
    const sigilGeo = new THREE.CircleGeometry(1, 48);
    sigilGeo.rotateX(-Math.PI / 2);

    this.sigilDataArray = new Float32Array(this.maxSigils * 4);
    this.sigilDataAttr = new THREE.InstancedBufferAttribute(this.sigilDataArray, 4);
    this.sigilDataAttr.setUsage(THREE.DynamicDrawUsage);
    sigilGeo.setAttribute('aVfxData', this.sigilDataAttr);

    const sigilMat = new THREE.MeshBasicNodeMaterial({
      color: 0xffffff,
      transparent: true,
       fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
      side: THREE.DoubleSide,
    });

    const sCol = attribute('instanceColor', 'vec3');
    const sData = attribute('aVfxData', 'vec4'); // x: age(0..1), y: seed, z: mode, w: intensity

    sigilMat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2.0);
      const r = length(p);
      const ang = atan2(p.y, p.x);
      const age = sData.x;
      const seed = sData.y;
      const mode = sData.z;
      const intensity = sData.w;

      // Growing front and fade envelope
      const grown = pow(clamp(age.mul(3.2), float(0.0), float(1.0)), float(0.48));
      const fadeOut = float(1.0).sub(smoothstep(float(0.58), float(1.0), age));
      const openLo = max(grown.sub(0.18), float(0.0));
      const openHi = grown.add(0.08);
      const openMask = float(1.0).sub(smoothstep(openLo, openHi, r));
      const frontGlow = float(1.0)
        .sub(smoothstep(float(0.0), float(0.11), abs(r.sub(grown))))
        .mul(float(1.0).sub(smoothstep(float(0.0), float(0.45), age)));

      // 1) Caustic Bloom / Molten Voronoi Crazing + Surface Boil (`voronoiEtch` & `surfaceBoil`)
      const wCoord = vec3(p.x.mul(3.4).add(seed), p.y.mul(3.4).sub(seed), time.mul(0.8));
      const v1 = mx_worley_noise_float(wCoord);
      const v2 = mx_worley_noise_float(wCoord.mul(2.35).add(vec3(7.1, 3.3, time.mul(-1.4))));
      const crazeSeam = float(1.0)
        .sub(smoothstep(float(0.02), float(0.22), abs(v1.sub(0.32))))
        .add(float(1.0).sub(smoothstep(float(0.01), float(0.18), abs(v2.sub(0.28)))).mul(0.75));
      // Surface boil bubbles popping across the pool
      const boilPhase = fract(time.mul(1.85).add(v1.mul(6.0)).add(seed));
      const boilRing = float(1.0)
        .sub(smoothstep(float(0.0), float(0.09), abs(v2.sub(boilPhase.mul(0.55)))))
        .mul(float(1.0).sub(boilPhase));
      // Corroded outer boundary band + concentric pressure ripples
      const bite = mx_fractal_noise_float(vec3(cos(ang).mul(2.5), sin(ang).mul(2.5), seed.add(time.mul(0.5))), 2, float(2.0), float(0.5));
      const corrOuter = float(0.82).add(bite.mul(0.16));
      const boundaryBand = float(1.0).sub(smoothstep(float(0.0), float(0.075), abs(r.sub(corrOuter.mul(grown)))));
      const rippleWave = pow(sin(r.mul(14.0).sub(time.mul(11.0))).mul(0.5).add(0.5), float(6.0)).mul(
        float(1.0).sub(smoothstep(float(0.15), float(0.95), r)),
      );
      const causticPattern = crazeSeam.mul(0.75).add(boilRing.mul(0.85)).add(boundaryBand.mul(1.1)).add(rippleWave.mul(0.38)).add(frontGlow.mul(1.1));

      // 2) Celestial Rend Sigil (`sparkleField` concave 4-point star + concentric rings + ticks + radial shatter cracks)
      const spinA = ang.add(time.mul(0.45));
      const starLobe = pow(abs(cos(spinA.mul(2.0))), float(2.6));
      const starField = r.sub(starLobe.mul(0.88));
      const starLine = lineAATSL(starField, float(0.032));

      const innerSpinA = ang.sub(time.mul(0.72)).add(0.785398);
      const innerLobe = pow(abs(cos(innerSpinA.mul(2.0))), float(3.1));
      const innerStarLine = lineAATSL(r.sub(innerLobe.mul(0.44)), float(0.026));

      // Nested concentric rings + runic ticks
      const ring1 = lineAATSL(r.sub(0.28), float(0.025));
      const ring2 = lineAATSL(r.sub(0.56), float(0.022));
      const ring3 = lineAATSL(r.sub(0.84), float(0.030));
      const tickCell = fract(ang.div(TAU).mul(36.0).add(time.mul(0.08)));
      const tickMask = smoothstep(float(0.0), float(0.15), tickCell).mul(float(1.0).sub(smoothstep(float(0.45), float(0.6), tickCell)));
      const tickBand = float(1.0).sub(smoothstep(float(0.0), float(0.08), abs(r.sub(0.70)))).mul(tickMask);

      // Radial shatter cracks
      const crackWander = mx_fractal_noise_float(vec3(p.x.mul(2.2), p.y.mul(2.2), seed), 2, float(2.0), float(0.5)).sub(0.5).mul(0.45);
      const crackSector = abs(sin(ang.add(crackWander).mul(4.5))).mul(r);
      const crackLine = pow(clamp(float(1.0).sub(crackSector.div(0.065)), float(0.0), float(1.0)), float(2.0)).mul(
        float(1.0).sub(smoothstep(float(0.1), float(0.95), r)),
      );
      const rendPattern = starLine.mul(1.1).add(innerStarLine.mul(0.85)).add(ring1.add(ring2).add(ring3).mul(0.85)).add(tickBand.mul(0.75)).add(crackLine.mul(0.85)).add(frontGlow.mul(1.2));

      // Blend between Caustic/Voronoi pattern (modes 0, 1, 3) and Celestial Rend Sigil (modes 2, 4)
      const isSigilMode = step(float(1.5), mode);
      const combined = mix(causticPattern, rendPattern.add(causticPattern.mul(0.25)), isSigilMode);

      const radialMask = float(1.0).sub(smoothstep(float(0.62), float(0.96), r)).mul(openMask);
      const energy = combined.mul(radialMask).mul(fadeOut).mul(intensity).mul(0.75);

      const hotWhite = vec3(2.4, 2.2, 1.85);
      const baseCol = mix(sCol, hotWhite, clamp(energy.mul(0.35).add(frontGlow.mul(0.4)), float(0.0), float(0.95)));
      return baseCol.mul(energy);
    })();

    sigilMat.opacityNode = Fn(() => {
      const p = uv().sub(0.5).mul(2.0);
      const r = length(p);
      const age = sData.x;
      const fadeOut = float(1.0).sub(smoothstep(float(0.52), float(1.0), age));
      const radialMask = float(1.0).sub(smoothstep(float(0.58), float(0.94), r));
      return clamp(radialMask.mul(fadeOut).mul(0.76), float(0.0), float(0.78));
    })();

    this.sigilInstMesh = new THREE.InstancedMesh(sigilGeo, sigilMat, this.maxSigils);
    this.sigilInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sigilInstMesh.setColorAt(0, new THREE.Color(0xffd270));
    sigilGeo.setAttribute('instanceColor', this.sigilInstMesh.instanceColor);
    this.sigilInstMesh.frustumCulled = false;
    this.sigilInstMesh.count = 0;
    this.sigilInstMesh.visible = false;
    this.sigilInstMesh.renderOrder = 9;
    scene.add(this.sigilInstMesh);

    // ------------------------------------------------------------------------
    // LAYER B: 3D `BurstSphere` Expanding Billowing & Ridged Filament Shells
    // Ported from LinearAbiltyCastingExtendedThreeJS/src/effects/BurstSphere.js
    // Modes (aVfxData.z):
    //   0 = FIRE / MOLTEN (Planckian blackbody + hot dissolve edge)
    //   1 = STORM / SWORD CLASH (Thin ridged lightning/steel arcs + Fresnel rim)
    //   2 = FROST / WATER (Voronoi rime plates / splash dome)
    //   3 = ASTRAL VOID (Dark violet singularity shell + golden photon rim)
    // ------------------------------------------------------------------------
    this.maxBursts = 24;
    this.bursts = [];
    const burstGeo = new THREE.IcosahedronGeometry(1, 3);
    this.burstDataArray = new Float32Array(this.maxBursts * 4);
    this.burstDataAttr = new THREE.InstancedBufferAttribute(this.burstDataArray, 4);
    this.burstDataAttr.setUsage(THREE.DynamicDrawUsage);
    burstGeo.setAttribute('aVfxData', this.burstDataAttr);

    const burstMat = new THREE.MeshBasicNodeMaterial({
      color: 0xffffff,
      transparent: true,
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const bCol = attribute('instanceColor', 'vec3');
    const bData = attribute('aVfxData', 'vec4'); // x: age(0..1), y: seed, z: mode, w: displace

    burstMat.positionNode = Fn(() => {
      const age = bData.x;
      const seed = bData.y;
      const dispAmp = bData.w;
      const np = normalLocal.mul(float(1.6).add(age.mul(1.4))).add(vec3(seed, time.mul(-1.2), seed.mul(0.7)));
      const n = mx_fractal_noise_float(np, 3, float(2.0), float(0.5));
      const amount = dispAmp.mul(float(0.32).add(age.mul(0.85)));
      return positionLocal.add(normalLocal.mul(n.sub(0.42).mul(amount)));
    })();

    burstMat.colorNode = Fn(() => {
      const age = bData.x;
      const seed = bData.y;
      const mode = bData.z;

      const viewDot = abs(dot(normalize(normalView), vec3(0.0, 0.0, 1.0)));
      const fres = pow(float(1.0).sub(viewDot), float(2.2));

      const np = normalLocal.mul(float(3.2).add(age.mul(3.5))).add(vec3(seed.mul(5.0), time.mul(3.2), 0.0));
      const fbmVal = mx_fractal_noise_float(np, 3, float(2.05), float(0.5));
      const ridgeVal = float(1.0).sub(abs(fbmVal.mul(2.0).sub(1.0)));

      // Dissolve mask as the shell expands
      const thresh = age.mul(1.12).sub(0.12);
      const disKeep = smoothstep(thresh.sub(0.18), thresh.add(0.18), fbmVal.mul(0.65).add(fres.mul(0.35)));
      const disEdge = float(1.0).sub(smoothstep(float(0.0), float(0.22), abs(fbmVal.sub(thresh))));

      // Storm / Sword-Clash filaments (thin branching arcs over a subtle Fresnel shell)
      const arcs = smoothstep(float(0.72), float(0.96), ridgeVal).mul(float(1.0).sub(age.mul(0.55)));
      const stormMask = fres.mul(0.34).add(arcs.mul(1.35)).add(disEdge.mul(0.85));

      // Fire / Molten billowing mask
      const fireMask = fres.mul(0.48).add(fbmVal.mul(0.45)).add(disEdge.mul(1.15));

      const isStorm = step(float(0.5), mode);
      const mask = mix(fireMask, stormMask, isStorm).mul(disKeep).mul(float(1.0).sub(age)).mul(0.75);

      const hotCore = vec3(2.4, 2.2, 1.85);
      const col = mix(bCol, hotCore, clamp(arcs.add(disEdge).mul(0.65), float(0.0), float(0.95)));
      return col.mul(mask);
    })();

    burstMat.opacityNode = Fn(() => {
      const age = bData.x;
      const viewDot = abs(dot(normalize(normalView), vec3(0.0, 0.0, 1.0)));
      const fres = pow(float(1.0).sub(viewDot), float(1.8));
      return clamp(fres.add(0.35).mul(float(1.0).sub(age)).mul(0.76), float(0.0), float(0.78));
    })();

    this.burstInstMesh = new THREE.InstancedMesh(burstGeo, burstMat, this.maxBursts);
    this.burstInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.burstInstMesh.setColorAt(0, new THREE.Color(0xffd270));
    burstGeo.setAttribute('instanceColor', this.burstInstMesh.instanceColor);
    this.burstInstMesh.frustumCulled = false;
    this.burstInstMesh.count = 0;
    this.burstInstMesh.visible = false;
    this.burstInstMesh.renderOrder = 14;
    scene.add(this.burstInstMesh);

    // ------------------------------------------------------------------------
    // LAYER C: `Celestial Rend` Fluted Volumetric Pillar & Caustic Gas Column
    // Ported from RendPillarMaterial.js (`|N·V|^k` chord volume + 22 flutes + basal skirt)
    // ------------------------------------------------------------------------
    this.maxPillars = 12;
    this.pillars = [];
    const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 28, true);
    pillarGeo.translate(0, 0.5, 0);
    this.pillarDataArray = new Float32Array(this.maxPillars * 4);
    this.pillarDataAttr = new THREE.InstancedBufferAttribute(this.pillarDataArray, 4);
    this.pillarDataAttr.setUsage(THREE.DynamicDrawUsage);
    pillarGeo.setAttribute('aVfxData', this.pillarDataAttr);

    const pillarMat = new THREE.MeshBasicNodeMaterial({
      color: 0xffffff,
      transparent: true,
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const pCol = attribute('instanceColor', 'vec3');
    const pData = attribute('aVfxData', 'vec4'); // x: age(0..1), y: seed, z: mode(0=Rend, 1=CausticMist), w: intensity

    pillarMat.positionNode = Fn(() => {
      const t = clamp(positionLocal.y, float(0.0), float(1.0));
      const skirt = pow(float(1.0).sub(t), float(4.2)).mul(0.35);
      const topFlare = pow(t, float(1.6)).mul(0.16);
      const wobble = mx_fractal_noise_float(vec3(positionLocal.x.mul(2.0), t.mul(3.0).sub(time.mul(2.2)), pData.y), 2, float(2.0), float(0.5)).sub(0.5).mul(0.08);
      const radialScale = float(1.0).add(skirt).add(topFlare).add(wobble);
      return vec3(positionLocal.x.mul(radialScale), positionLocal.y, positionLocal.z.mul(radialScale));
    })();

    pillarMat.colorNode = Fn(() => {
      const t = clamp(positionLocal.y, float(0.0), float(1.0));
      const age = pData.x;
      const seed = pData.y;
      const intensity = pData.w;

      const grown = clamp(age.mul(4.5), float(0.0), float(1.0));
      const live = float(1.0).sub(smoothstep(grown.sub(0.06), grown.add(0.03), t));
      const fade = float(1.0).sub(smoothstep(float(0.48), float(1.0), age));

      const ndv = abs(dot(normalize(normalView), vec3(0.0, 0.0, 1.0)));
      // Volumetric chord brightness |N·V|^2.6 + axial core |N·V|^7.5
      const body = pow(ndv, float(2.6));
      const core = pow(ndv, float(7.5)).mul(0.75);

      const ang = atan2(positionLocal.z, positionLocal.x);
      const flute = pow(abs(sin(ang.mul(11.0).add(time.mul(1.8)))), float(0.75));
      const stream = mx_fractal_noise_float(vec3(ang.mul(3.0), t.mul(4.5).sub(time.mul(3.8)), seed), 2, float(2.0), float(0.5));
      const combed = mix(float(0.28), float(0.95), flute.mul(stream));

      const topFade = float(1.0).sub(smoothstep(float(0.55), float(1.0), t));
      const footGlow = float(1.0).add(exp(t.mul(-9.5)).mul(0.55));
      const energy = body.mul(combed).add(core).mul(live).mul(topFade).mul(footGlow).mul(fade).mul(intensity).mul(0.75);

      const whiteHot = vec3(2.55, 2.32, 2.02);
      const col = mix(pCol, whiteHot, clamp(core.mul(0.65).add(exp(t.mul(-10.0)).mul(0.32)), float(0.0), float(0.92)));
      return col.mul(energy);
    })();

    pillarMat.opacityNode = Fn(() => {
      const t = clamp(positionLocal.y, float(0.0), float(1.0));
      const age = pData.x;
      const ndv = abs(dot(normalize(normalView), vec3(0.0, 0.0, 1.0)));
      const fade = float(1.0).sub(smoothstep(float(0.48), float(1.0), age));
      const topFade = float(1.0).sub(smoothstep(float(0.55), float(1.0), t));
      return clamp(pow(ndv, float(2.2)).mul(fade).mul(topFade).mul(0.72), float(0.0), float(0.75));
    })();

    this.pillarInstMesh = new THREE.InstancedMesh(pillarGeo, pillarMat, this.maxPillars);
    this.pillarInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pillarInstMesh.setColorAt(0, new THREE.Color(0xffd878));
    pillarGeo.setAttribute('instanceColor', this.pillarInstMesh.instanceColor);
    this.pillarInstMesh.frustumCulled = false;
    this.pillarInstMesh.count = 0;
    this.pillarInstMesh.visible = false;
    this.pillarInstMesh.renderOrder = 15;
    scene.add(this.pillarInstMesh);

    // ------------------------------------------------------------------------
    // LAYER D: Billboarded 4-Pointed Concave `RendStar` & Cling Glints
    // Ported from RendPillarMaterial.js `createRendStarMaterial`
    // ------------------------------------------------------------------------
    this.maxStars = 36;
    this.stars = [];
    const starGeo = new THREE.PlaneGeometry(1.4, 1.4);
    this.starDataArray = new Float32Array(this.maxStars * 4);
    this.starDataAttr = new THREE.InstancedBufferAttribute(this.starDataArray, 4);
    this.starDataAttr.setUsage(THREE.DynamicDrawUsage);
    starGeo.setAttribute('aVfxData', this.starDataAttr);

    const starMat = new THREE.MeshBasicNodeMaterial({
      color: 0xffffff,
      transparent: true,
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    const stCol = attribute('instanceColor', 'vec3');
    const stData = attribute('aVfxData', 'vec4'); // x: age(0..1), y: seed, z: spin, w: intensity

    starMat.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2.4);
      const d = length(p);
      const inv = float(1.0).div(max(d, float(1e-4)));
      const c = p.x.mul(inv);
      const s = p.y.mul(inv);

      const age = stData.x;
      const intensity = stData.w;
      const fade = float(1.0).sub(smoothstep(float(0.22), float(1.0), age));

      // Three raised cosines summed: long vertical pair, horizontal pair, 4 diagonal spikes
      const reach = pow(abs(s), float(6.5))
        .mul(0.85)
        .add(pow(abs(c), float(7.2)).mul(0.58))
        .add(pow(abs(s.mul(c).mul(2.0)), float(8.0)).mul(0.22));

      const ang = atan2(p.y, p.x).add(time.mul(0.8));
      const needles = pow(abs(sin(ang.mul(17.0))), float(11.0)).mul(0.16);
      const span = max(reach.add(needles), float(1e-4));

      const rays = pow(clamp(float(1.0).sub(d.div(span)), float(0.0), float(1.0)), float(2.2));
      const halo = exp(d.negate().div(max(span.mul(0.28), float(1e-4)))).mul(0.22);
      const core = exp(d.mul(d).negate().div(0.0075)).mul(1.05);
      const windowMask = float(1.0).sub(smoothstep(float(0.62), float(0.95), d));

      const energy = rays.add(halo).add(core).mul(windowMask).mul(fade).mul(intensity).mul(0.68);
      const hotWhite = vec3(2.4, 2.2, 1.95);
      const col = mix(stCol, hotWhite, clamp(core.add(rays.mul(0.45)), float(0.0), float(0.95)));
      return col.mul(energy);
    })();

    starMat.opacityNode = Fn(() => {
      const p = uv().sub(0.5).mul(2.4);
      const d = length(p);
      const inv = float(1.0).div(max(d, float(1e-4)));
      const c = p.x.mul(inv);
      const s = p.y.mul(inv);
      const age = stData.x;
      const fade = float(1.0).sub(smoothstep(float(0.22), float(1.0), age));
      const reach = pow(abs(s), float(6.5)).mul(0.85).add(pow(abs(c), float(7.2)).mul(0.58));
      const span = max(reach, float(1e-4));
      const rays = pow(clamp(float(1.0).sub(d.div(span)), float(0.0), float(1.0)), float(2.2));
      const core = exp(d.mul(d).negate().div(0.012));
      const windowMask = float(1.0).sub(smoothstep(float(0.62), float(0.95), d));
      return clamp(rays.add(core).mul(windowMask).mul(fade).mul(0.75), float(0.0), float(0.78));
    })();

    this.starInstMesh = new THREE.InstancedMesh(starGeo, starMat, this.maxStars);
    this.starInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.starInstMesh.setColorAt(0, new THREE.Color(0xffea98));
    starGeo.setAttribute('instanceColor', this.starInstMesh.instanceColor);
    this.starInstMesh.frustumCulled = false;
    this.starInstMesh.count = 0;
    this.starInstMesh.visible = false;
    this.starInstMesh.renderOrder = 18;
    scene.add(this.starInstMesh);

    // ------------------------------------------------------------------------
    // LAYER E: Procedural Faceted Crystal / Obsidian Lance / Rend Shards
    // Ported from RendGeometry.js `createSlingGeometry`, VoidSlashMaterials.js,
    // and VenomSurgeAbility.js (1 Shared Pipeline, 160 Instances)
    // ------------------------------------------------------------------------
    this.maxShards = 160;
    this.shards = [];
    const shardGeo = createSandboxCrystalGeometry({ seed: 7, sides: 6, rows: 9, width: 0.12, waist: 0.34, sharp: 0.82 });
    const shardMat = new THREE.MeshStandardNodeMaterial({
      color: 0xffffff,
      roughness: 0.22,
      metalness: 0.35,
      flatShading: true,
      transparent: true,
      fog: false,
      opacity: 0.82,
      depthWrite: false,
    });

    const shCol = attribute('instanceColor', 'vec3');
    shardMat.colorNode = Fn(() => {
      const tipFactor = clamp(positionLocal.y.add(0.5), float(0.0), float(1.0));
      return mix(vec3(0.06, 0.04, 0.10), shCol, smoothstep(float(0.15), float(0.95), tipFactor));
    })();
    shardMat.emissiveNode = Fn(() => {
      const tipFactor = pow(clamp(positionLocal.y.add(0.5), float(0.0), float(1.0)), float(1.6));
      const viewDot = abs(dot(normalize(normalView), vec3(0.0, 0.0, 1.0)));
      const rim = pow(float(1.0).sub(viewDot), float(2.2));
      const vein = smoothstep(float(0.08), float(0.0), abs(positionLocal.x)).mul(
        sin(positionLocal.y.mul(18.0).sub(time.mul(12.0))).mul(0.5).add(0.5),
      );
      const hotCol = mix(shCol, vec3(2.1, 1.95, 1.72), tipFactor.mul(0.58));
      return hotCol.mul(tipFactor.mul(0.72).add(rim.mul(0.82)).add(vein.mul(0.65)));
    })();

    this.shardInstMesh = new THREE.InstancedMesh(shardGeo, shardMat, this.maxShards);
    this.shardInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardInstMesh.setColorAt(0, new THREE.Color(0x9b68ff));
    shardGeo.setAttribute('instanceColor', this.shardInstMesh.instanceColor);
    this.shardInstMesh.frustumCulled = false;
    this.shardInstMesh.count = 0;
    this.shardInstMesh.visible = false;
    this.shardInstMesh.renderOrder = 13;
    scene.add(this.shardInstMesh);

    // ------------------------------------------------------------------------
    // LAYER F: `Serpent Tide Field` — Skinned Flapping Phoenix (`phoenix_bird.glb`)
    // + 3 S-Curve Fire Serpents + Homing Beak Fireballs & Diving Talons!
    // ------------------------------------------------------------------------
    this.phoenixTemplate = null;
    this.phoenixLoading = false;
    this.activePhoenix = null;
    this._initPhoenixAsset();
  }

  async _initPhoenixAsset() {
    if (this.phoenixLoading || this.phoenixTemplate) return;
    this.phoenixLoading = true;
    try {
      const gltf = await loadGLTF('/models/phoenix_bird.glb');
      if (gltf) {
        this.phoenixTemplate = buildPhoenixRig(gltf, { wingspan: 5.4 });
      }
    } catch (_err) {
      // Fallback gracefully if model path unavailable
    } finally {
      this.phoenixLoading = false;
    }
  }

  // --------------------------------------------------------------------------
  // SPAWNERS FOR COMBAT CONTACTS, SPECIALS & ELEMENTAL SANDBOX ABILITIES
  // --------------------------------------------------------------------------

  spawnGroundSigil(pos, radius = 2.8, colorHex = 0xffd270, mode = 0, duration = 0.75, intensity = 1.35) {
    if (this.sigils.length >= this.maxSigils) this.sigils.shift();
    const elevatedPos = pos.clone();
    elevatedPos.y += 0.16;
    this.sigils.push({
      pos: elevatedPos,
      radius,
      color: new THREE.Color(colorHex),
      mode,
      age: 0,
      duration,
      intensity,
      seed: Math.random() * 50,
      yaw: Math.random() * TAU,
    });
  }

  spawnBurstSphere(pos, startRadius = 0.35, endRadius = 2.6, colorHex = 0xffd270, mode = 1, duration = 0.38, squash = 1.0, displace = 0.42) {
    if (this.bursts.length >= this.maxBursts) this.bursts.shift();
    this.bursts.push({
      pos: pos.clone(),
      startRadius,
      endRadius,
      color: new THREE.Color(colorHex),
      mode,
      age: 0,
      duration,
      squash,
      displace,
      seed: Math.random() * 30,
      rotY: Math.random() * TAU,
    });
  }

  spawnPillarOfLight(pos, radius = 1.35, height = 18.0, colorHex = 0xffdf80, mode = 0, duration = 0.95, intensity = 1.65) {
    if (this.pillars.length >= this.maxPillars) this.pillars.shift();
    this.pillars.push({
      pos: pos.clone(),
      radius,
      height,
      color: new THREE.Color(colorHex),
      mode,
      age: 0,
      duration,
      intensity,
      seed: Math.random() * 25,
    });
  }

  spawnStarGlint(pos, size = 1.45, colorHex = 0xfff0b8, duration = 0.32, intensity = 1.6) {
    if (this.stars.length >= this.maxStars) this.stars.shift();
    this.stars.push({
      pos: pos.clone(),
      size: size * 0.78,
      color: new THREE.Color(colorHex),
      age: 0,
      duration,
      intensity: intensity * 0.78,
      seed: Math.random() * 20,
    });
  }

  /**
   * 1. METALLIC CAUSTIC BLOOM SWORD CONTACT / PARRY / CLING FLASH
   * Replaces primitive RingGeometry washers on melee hits & blade clashes!
   */
  spawnMetallicCausticClash(pos, colorHex = 0xffd878, radius = 2.2, isParry = false) {
    const contactPos = pos.clone();
    const groundPos = new THREE.Vector3(pos.x, Math.max(0.02, pos.y - 0.85), pos.z);

    // 4-pointed concave Star Glint at exact sword contact point
    this.spawnStarGlint(contactPos, isParry ? 1.55 : 1.15, colorHex, isParry ? 0.30 : 0.24, isParry ? 1.55 : 1.25);

    // 3D Storm/Filament BurstSphere expanding from blade impact
    this.spawnBurstSphere(
      contactPos,
      0.22,
      isParry ? Math.min(1.65, radius * 0.68) : Math.min(1.25, radius * 0.54),
      colorHex,
      1, // STORM / SWORD_CLASH ridged filament mode
      isParry ? 0.30 : 0.24,
      0.92,
      0.34,
    );

    // Metallic Caustic Bloom crazed ground flash beneath the strike
    this.spawnGroundSigil(
      groundPos,
      isParry ? Math.min(2.15, radius * 0.82) : Math.min(1.65, radius * 0.68),
      colorHex,
      0, // CAUSTIC_METAL_FLASH
      isParry ? 0.48 : 0.36,
      isParry ? 1.25 : 0.98,
    );

    // Eject molten-steel / obsidian slivers on parry or heavy contact
    if (isParry || radius >= 2.2) {
      const shardCount = isParry ? 9 : 6;
      for (let i = 0; i < shardCount; i++) {
        const a = (i / shardCount) * TAU + (Math.random() - 0.5) * 0.3;
        const spd = 5.5 + Math.random() * 6.5;
        this._pushShard({
          pos: contactPos.clone(),
          vel: new THREE.Vector3(Math.cos(a) * spd, 2.5 + Math.random() * 4.0, Math.sin(a) * spd),
          rotAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
          rotSpeed: 8.0 + Math.random() * 8.0,
          initAngle: 0.9,
          scale: new THREE.Vector3(0.12, 0.38 + Math.random() * 0.25, 0.12),
          gravity: 14.0,
          age: 0,
          duration: 0.38 + Math.random() * 0.18,
          color: new THREE.Color(colorHex),
        });
      }
    }
  }

  /**
   * 2. CELESTIAL REND (K) — Adapted for Weapon Specials (`Braver`, `Skyfall Strike`,
   *    `Resolute Counter`, `Limit Break: Cross-Slash`) and Grimoire Ultimate!
   */
  spawnCelestialRend(centerPos, colorHex = 0xffd700, secondaryHex = 0x7be0ff, radius = 4.5, intensity = 1.0) {
    const floorPos = new THREE.Vector3(centerPos.x, centerPos.y + 0.04, centerPos.z);

    // 1. Ground Celestial Mark (`RendSigilMaterial` 4-point concave star + rings + ticks + shatter cracks)
    this.spawnGroundSigil(floorPos, radius * 1.08, colorHex, 2, 1.10, 1.35 * intensity);

    // 2. Converging Shards driving into the mark + Starburst Eruption (`RendShardMaterial`)
    const shardCount = Math.round(14 * intensity);
    for (let i = 0; i < shardCount; i++) {
      const a = (i / shardCount) * TAU + (Math.random() - 0.5) * 0.2;
      const dist = radius * (0.28 + Math.random() * 0.65);
      const isConverging = i < shardCount * 0.45;
      if (isConverging) {
        const startP = new THREE.Vector3(
          centerPos.x + Math.cos(a) * (dist + 2.4),
          centerPos.y + 3.8 + Math.random() * 2.8,
          centerPos.z + Math.sin(a) * (dist + 2.4),
        );
        const toCenter = centerPos.clone().sub(startP).multiplyScalar(3.2);
        this._pushShard({
          pos: startP,
          vel: toCenter,
          rotAxis: new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)),
          rotSpeed: 2.5,
          initAngle: 0.5,
          scale: new THREE.Vector3(0.16, 0.95 + Math.random() * 0.45, 0.16),
          gravity: 0,
          age: 0,
          duration: 0.42,
          color: new THREE.Color(i % 2 === 0 ? colorHex : secondaryHex),
        });
      } else {
        // Crown of faceted shards erupting from the mark
        const sx = centerPos.x + Math.cos(a) * dist * 0.65;
        const sz = centerPos.z + Math.sin(a) * dist * 0.65;
        const h = (0.95 + Math.random() * 1.25) * intensity;
        this._pushShard({
          pos: new THREE.Vector3(sx, centerPos.y + h * 0.38, sz),
          vel: new THREE.Vector3(Math.cos(a) * 1.4, 2.2, Math.sin(a) * 1.4),
          rotAxis: new THREE.Vector3(Math.sin(a), 0.2, -Math.cos(a)).normalize(),
          rotSpeed: 0.6,
          initAngle: 0.25,
          scale: new THREE.Vector3(0.22, h, 0.22),
          gravity: 4.5,
          age: 0,
          duration: 0.78 + Math.random() * 0.28,
          color: new THREE.Color(i % 3 === 0 ? secondaryHex : colorHex),
        });
      }
    }

    // 3. Fluted Volumetric Pillar of Judgment (`RendPillarMaterial` |N·V|^k + 22 flutes)
    this.spawnPillarOfLight(floorPos, Math.max(0.48, radius * 0.16), 13.0 + radius * 1.5, colorHex, 0, 0.88, 1.25 * intensity);

    // 4. Four-Pointed Concave Star welded to the column head & base (`RendStarMaterial`)
    this.spawnStarGlint(
      new THREE.Vector3(centerPos.x, centerPos.y + 1.15, centerPos.z),
      radius * 0.48,
      colorHex,
      0.56,
      1.35 * intensity,
    );
    this.spawnStarGlint(
      new THREE.Vector3(centerPos.x, centerPos.y + 3.2, centerPos.z),
      radius * 0.40,
      secondaryHex,
      0.58,
      1.25 * intensity,
    );

    // 5. Expanding 3D BurstSphere pressure wave
    this.spawnBurstSphere(
      new THREE.Vector3(centerPos.x, centerPos.y + 0.85, centerPos.z),
      0.35,
      radius * 0.65,
      colorHex,
      0,
      0.45,
      0.78,
      0.38,
    );
  }

  /**
   * 3. LINEAR VOID SLASH & SHIMMERING FLUX OF CHAOS (`VoidSlashAbility` / `ShimmeringFluxAbility`)
   * Point-first shingled black-glass obsidian lance + 4-rayed tip glare + tumbling crystal wake!
   */
  spawnLinearVoidSlash(origin, yaw, length = 12.0, colorHex = 0x9b5cff, secondaryHex = 0xe8d0ff) {
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const startPos = origin.clone().add(new THREE.Vector3(dx * 0.8, 1.05, dz * 0.8));

    // Tip 4-rayed glare star at launch & along trajectory
    this.spawnStarGlint(startPos, 1.45, secondaryHex, 0.34, 1.35);
    this.spawnGroundSigil(new THREE.Vector3(origin.x + dx * 2.2, origin.y + 0.03, origin.z + dz * 2.2), 2.2, colorHex, 4, 0.58, 1.15);

    // Shingled obsidian/crystal lance scales flying point-first down the spine
    const rows = 14;
    for (let r = 0; r < rows; r++) {
      const u = r / (rows - 1);
      const dist = 1.0 + u * length;
      const px = origin.x + dx * dist;
      const pz = origin.z + dz * dist;
      const py = origin.y + 1.05;

      // Central lance shingle + flanking wake flakes
      for (let side = -1; side <= 1; side++) {
        const lat = side * (0.18 + (1 - u) * 0.42);
        const sx = px - dz * lat;
        const sz = pz + dx * lat;
        this._pushShard({
          pos: new THREE.Vector3(sx, py + (Math.random() - 0.5) * 0.28, sz),
          vel: new THREE.Vector3(dx * (14.0 + u * 6.0) - dz * side * 1.8, (Math.random() - 0.35) * 2.2, dz * (14.0 + u * 6.0) + dx * side * 1.8),
          rotAxis: new THREE.Vector3(dz, 0.35, -dx).normalize(),
          rotSpeed: side === 0 ? 1.5 : 7.5,
          initAngle: Math.PI * 0.5,
          scale: new THREE.Vector3(0.15, side === 0 ? 0.78 : 0.44, 0.12),
          gravity: side === 0 ? 0.5 : 4.5,
          age: 0,
          duration: 0.28 + u * 0.22,
          color: new THREE.Color(side === 0 ? secondaryHex : colorHex),
        });
      }
    }
  }

  /**
   * 3b. WIDE 205° 3D CRESCENT SLASH ARC (`spawnCrescentSlash`)
   * Carves a sweeping 200° crescent wave of elemental energy shards, leading star glint,
   * and ground sigil across the strike plane at 75% intensity!
   */
  spawnCrescentSlash(origin, yaw, options = {}) {
    const radius = options.radius ?? 2.85;
    const roll = options.roll ?? 0.22;
    const pitch = options.pitch ?? 0.0;
    const coreColor = options.coreColor ?? 0xfff8e0;
    const edgeColor = options.edgeColor ?? 0x58e6ff;
    const speed = options.speed ?? 6.5;
    const life = options.life ?? 0.26;

    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const centerY = origin.y + 1.12;

    // Elemental ground sigil & leading-edge star glint at 75% intensity
    this.spawnGroundSigil(
      new THREE.Vector3(origin.x + fwdX * 0.9, origin.y + 0.03, origin.z + fwdZ * 0.9),
      radius * 0.92,
      edgeColor,
      0,
      life * 1.35,
      0.95,
    );
    this.spawnStarGlint(
      new THREE.Vector3(origin.x + fwdX * (radius * 0.75), centerY, origin.z + fwdZ * (radius * 0.75)),
      0.95,
      coreColor,
      life * 0.95,
      1.15,
    );

    // 14 crescent blade segments spanning a 200° wide sweep along the outer blade perimeter
    const segments = 14;
    const halfArc = 1.74; // ~200° total sweep
    const sinRoll = Math.sin(roll);
    for (let i = 0; i < segments; i++) {
      const u = i / (segments - 1);
      const ang = (u * 2 - 1) * halfArc;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const r = radius * (0.84 + 0.20 * ca);
      const dirX = fwdX * ca + rightX * sa;
      const dirZ = fwdZ * ca + rightZ * sa;
      const dirY = -sa * sinRoll * 0.58 + pitch * ca;

      const px = origin.x + dirX * (r * 0.82);
      const py = centerY + dirY * (r * 0.62);
      const pz = origin.z + dirZ * (r * 0.82);
      const taper = Math.sin(u * Math.PI);

      this._pushShard({
        pos: new THREE.Vector3(px, py, pz),
        vel: new THREE.Vector3(dirX * speed, dirY * speed * 0.45, dirZ * speed),
        rotAxis: new THREE.Vector3(dirX, 0.15, dirZ).normalize(),
        rotSpeed: 2.2,
        initAngle: Math.PI * 0.5,
        scale: new THREE.Vector3(0.09 + taper * 0.075, 0.32 + taper * 0.38, 0.08),
        gravity: 0.25,
        age: 0,
        duration: life * (0.76 + taper * 0.28),
        color: new THREE.Color(taper > 0.72 ? coreColor : edgeColor),
      });
    }
  }

  /**
   * 4. CRYSTALLIZED VENOM SURGE / BRUTALIST EARTH BLAST / CORRUPTED SHARD SPAWN
   * Line rupture + 3-population crystal/monolith starburst + Voronoi floor!
   */
  spawnCrystalOrMonolithRupture(origin, yaw, range = 9.5, colorHex = 0x62f4ff, secondaryHex = 0xb878ff) {
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const endPos = new THREE.Vector3(origin.x + dx * range, origin.y, origin.z + dz * range);

    // Seam of Voronoi plates along the line + large starburst sigil at far end
    this.spawnGroundSigil(new THREE.Vector3(origin.x + dx * (range * 0.45), origin.y + 0.03, origin.z + dz * (range * 0.45)), 2.4, colorHex, 1, 0.85, 1.35);
    this.spawnGroundSigil(new THREE.Vector3(endPos.x, endPos.y + 0.04, endPos.z), 3.8, colorHex, 2, 1.15, 1.75);
    this.spawnBurstSphere(new THREE.Vector3(endPos.x, endPos.y + 0.9, endPos.z), 0.4, 3.6, colorHex, 2, 0.52, 0.82, 0.5);
    this.spawnStarGlint(new THREE.Vector3(endPos.x, endPos.y + 1.35, endPos.z), 2.2, secondaryHex, 0.55, 1.9);

    // 3-population starburst (silhouette spears, body blades, basal shards)
    const count = 22;
    for (let i = 0; i < count; i++) {
      const isSpear = i < 6;
      const isBlade = i >= 6 && i < 14;
      const a = (i / count) * TAU + (Math.random() - 0.5) * 0.25;
      const r = isSpear ? 0.35 + Math.random() * 0.65 : isBlade ? 0.85 + Math.random() * 0.95 : 1.45 + Math.random() * 1.1;
      const h = isSpear ? 2.4 + Math.random() * 1.1 : isBlade ? 1.45 + Math.random() * 0.75 : 0.75 + Math.random() * 0.45;
      const w = isSpear ? 0.28 : isBlade ? 0.36 : 0.44;
      this._pushShard({
        pos: new THREE.Vector3(endPos.x + Math.cos(a) * r, endPos.y + h * 0.32, endPos.z + Math.sin(a) * r),
        vel: new THREE.Vector3(Math.cos(a) * 0.9, 1.6, Math.sin(a) * 0.9),
        rotAxis: new THREE.Vector3(Math.sin(a), 0.15, -Math.cos(a)).normalize(),
        rotSpeed: 0.45,
        scale: new THREE.Vector3(w, h, w),
        gravity: 3.2,
        age: 0,
        duration: 0.95 + Math.random() * 0.35,
        color: new THREE.Color(isSpear ? secondaryHex : colorHex),
      });
    }
  }

  /**
   * 5. SERPENT TIDE FIELD — THE PHOENIX CASTING (`PhoenixAbility` + `phoenix_bird.glb`)
   * Summons the skinned flapping Phoenix with Planckian blackbody fire-fresnel plumage,
   * 3 S-curve fire serpents, molten Voronoi ground pyre, homing beak fireballs & diving talons!
   */
  spawnPhoenixSerpentField(centerPos, yaw = 0, duration = 8.5) {
    // Clear previous phoenix if active
    if (this.activePhoenix) {
      this._disposeActivePhoenix();
    }

    const group = new THREE.Group();
    group.name = 'SerpentTidePhoenixField';
    group.position.copy(centerPos);
    this.scene.add(group);

    // Spawn initial molten Voronoi pyre ground sigil & rising fire column
    this.spawnGroundSigil(new THREE.Vector3(centerPos.x, centerPos.y + 0.04, centerPos.z), 4.6, 0xff5a18, 3, 2.8, 1.85);
    this.spawnPillarOfLight(new THREE.Vector3(centerPos.x, centerPos.y, centerPos.z), 0.58, 10.0, 0xff7820, 0, 0.72, 1.35);
    this.spawnBurstSphere(new THREE.Vector3(centerPos.x, centerPos.y + 1.0, centerPos.z), 0.45, 2.4, 0xff6a18, 0, 0.45, 0.85, 0.45);

    // Build bird instance if `phoenix_bird.glb` is loaded
    let birdRoot = null;
    let mixer = null;
    const birdMats = [];
    if (!this._phoenixBodyMat) {
      this._phoenixBodyMat = createPhoenixPlumageTSLMaterial(null, false);
      this._phoenixAuraMat = createPhoenixPlumageTSLMaterial(null, true);
    }
    const bodyMat = this._phoenixBodyMat;
    const auraMat = this._phoenixAuraMat;
    birdMats.push(bodyMat, auraMat);

    if (this.phoenixTemplate) {
      birdRoot = cloneSkeleton(this.phoenixTemplate.source);
      mixer = new THREE.AnimationMixer(birdRoot);
      if (this.phoenixTemplate.clip) {
        const action = mixer.clipAction(this.phoenixTemplate.clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
      const skinnedMeshes = [];
      birdRoot.traverse((node) => {
        if (node.isSkinnedMesh) {
          skinnedMeshes.push(node);
        }
      });
      for (const node of skinnedMeshes) {
        node.material = bodyMat;
        node.frustumCulled = false;

        // Add inflated additive flame-tongue aura shell bound to the same skeleton!
        const shell = new THREE.SkinnedMesh(node.geometry, auraMat);
        shell.bind(node.skeleton, node.bindMatrix);
        shell.bindMode = node.bindMode;
        shell.frustumCulled = false;
        shell.renderOrder = 16;
        (node.parent || birdRoot).add(shell);
      }
    } else {
      // Procedural fiery avian core fallback while GLB finishes loading
      birdRoot = new THREE.Group();
      const wingsGeo = new THREE.OctahedronGeometry(0.95, 2);
      wingsGeo.scale(2.4, 0.35, 0.85);
      birdRoot.add(new THREE.Mesh(wingsGeo, bodyMat));
    }

    const birdHolder = new THREE.Group();
    birdHolder.position.set(0, 0.3, 0);
    birdHolder.rotation.y = yaw;
    birdHolder.add(birdRoot);
    group.add(birdHolder);

    this.activePhoenix = {
      group,
      birdHolder,
      birdRoot,
      mixer,
      birdMats,
      center: centerPos.clone(),
      age: 0,
      duration,
      yaw,
      volleyTimer: 0.45,
      sigilTimer: 0,
      serpentPhase: 0,
    };
  }

  _disposeActivePhoenix() {
    if (!this.activePhoenix) return;
    this.scene.remove(this.activePhoenix.group);
    this.activePhoenix = null;
  }

  _pushShard(s) {
    if (this.shards.length >= this.maxShards) this.shards.shift();
    this.shards.push(s);
  }

  clearAll() {
    this.sigils.length = 0;
    this.sigilInstMesh.count = 0;
    this.sigilInstMesh.visible = false;
    this.bursts.length = 0;
    this.burstInstMesh.count = 0;
    this.burstInstMesh.visible = false;
    this.pillars.length = 0;
    this.pillarInstMesh.count = 0;
    this.pillarInstMesh.visible = false;
    this.stars.length = 0;
    this.starInstMesh.count = 0;
    this.starInstMesh.visible = false;
    this.shards.length = 0;
    this.shardInstMesh.count = 0;
    this.shardInstMesh.visible = false;
    this._disposeActivePhoenix();
  }

  update(dt, combatEngine = null, vfxManager = null) {
    // 1. Update Ground Sigils & Caustic Pools
    let sigilAlive = 0;
    for (let i = 0; i < this.sigils.length; i++) {
      const s = this.sigils[i];
      s.age += dt;
      if (s.age >= s.duration) continue;
      this.sigils[sigilAlive] = s;

      const k = s.age / s.duration;
      _pos.copy(s.pos);
      _quat.setFromAxisAngle(_up, s.yaw);
      _scale.setScalar(s.radius);
      _mat4.compose(_pos, _quat, _scale);
      this.sigilInstMesh.setMatrixAt(sigilAlive, _mat4);
      this.sigilInstMesh.setColorAt(sigilAlive, s.color);

      const o = sigilAlive * 4;
      this.sigilDataArray[o + 0] = k;
      this.sigilDataArray[o + 1] = s.seed;
      this.sigilDataArray[o + 2] = s.mode;
      this.sigilDataArray[o + 3] = s.intensity;
      sigilAlive++;
    }
    this.sigils.length = sigilAlive;
    this.sigilInstMesh.count = sigilAlive;
    this.sigilInstMesh.visible = sigilAlive > 0;
    this.sigilInstMesh.instanceMatrix.needsUpdate = true;
    if (this.sigilInstMesh.instanceColor) this.sigilInstMesh.instanceColor.needsUpdate = true;
    this.sigilDataAttr.needsUpdate = true;

    // 2. Update 3D BurstSpheres
    let burstAlive = 0;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i];
      b.age += dt;
      if (b.age >= b.duration) continue;
      this.bursts[burstAlive] = b;

      const k = b.age / b.duration;
      const easeOutQuint = 1 - Math.pow(1 - k, 5);
      const rad = b.startRadius + (b.endRadius - b.startRadius) * easeOutQuint;
      _pos.copy(b.pos);
      _quat.setFromAxisAngle(_up, b.rotY + k * 1.4);
      _scale.set(rad, rad * b.squash, rad);
      _mat4.compose(_pos, _quat, _scale);
      this.burstInstMesh.setMatrixAt(burstAlive, _mat4);
      this.burstInstMesh.setColorAt(burstAlive, b.color);

      const o = burstAlive * 4;
      this.burstDataArray[o + 0] = k;
      this.burstDataArray[o + 1] = b.seed;
      this.burstDataArray[o + 2] = b.mode;
      this.burstDataArray[o + 3] = b.displace;
      burstAlive++;
    }
    this.bursts.length = burstAlive;
    this.burstInstMesh.count = burstAlive;
    this.burstInstMesh.visible = burstAlive > 0;
    this.burstInstMesh.instanceMatrix.needsUpdate = true;
    if (this.burstInstMesh.instanceColor) this.burstInstMesh.instanceColor.needsUpdate = true;
    this.burstDataAttr.needsUpdate = true;

    // 3. Update Fluted Volumetric Pillars
    let pillarAlive = 0;
    for (let i = 0; i < this.pillars.length; i++) {
      const p = this.pillars[i];
      p.age += dt;
      if (p.age >= p.duration) continue;
      this.pillars[pillarAlive] = p;

      const k = p.age / p.duration;
      _pos.copy(p.pos);
      _quat.setFromAxisAngle(_up, k * 2.2);
      _scale.set(p.radius, p.height, p.radius);
      _mat4.compose(_pos, _quat, _scale);
      this.pillarInstMesh.setMatrixAt(pillarAlive, _mat4);
      this.pillarInstMesh.setColorAt(pillarAlive, p.color);

      const o = pillarAlive * 4;
      this.pillarDataArray[o + 0] = k;
      this.pillarDataArray[o + 1] = p.seed;
      this.pillarDataArray[o + 2] = p.mode;
      this.pillarDataArray[o + 3] = p.intensity;
      pillarAlive++;
    }
    this.pillars.length = pillarAlive;
    this.pillarInstMesh.count = pillarAlive;
    this.pillarInstMesh.visible = pillarAlive > 0;
    this.pillarInstMesh.instanceMatrix.needsUpdate = true;
    if (this.pillarInstMesh.instanceColor) this.pillarInstMesh.instanceColor.needsUpdate = true;
    this.pillarDataAttr.needsUpdate = true;

    // 4. Update Billboarded 4-Pointed Concave Stars
    let starAlive = 0;
    for (let i = 0; i < this.stars.length; i++) {
      const st = this.stars[i];
      st.age += dt;
      if (st.age >= st.duration) continue;
      this.stars[starAlive] = st;

      const k = st.age / st.duration;
      const sz = st.size * (0.65 + 0.55 * Math.sin(k * Math.PI));
      _pos.copy(st.pos);
      _quat.setFromAxisAngle(_up, st.seed + k * 1.2);
      _scale.setScalar(sz);
      _mat4.compose(_pos, _quat, _scale);
      this.starInstMesh.setMatrixAt(starAlive, _mat4);
      this.starInstMesh.setColorAt(starAlive, st.color);

      const o = starAlive * 4;
      this.starDataArray[o + 0] = k;
      this.starDataArray[o + 1] = st.seed;
      this.starDataArray[o + 2] = 0;
      this.starDataArray[o + 3] = st.intensity;
      starAlive++;
    }
    this.stars.length = starAlive;
    this.starInstMesh.count = starAlive;
    this.starInstMesh.visible = starAlive > 0;
    this.starInstMesh.instanceMatrix.needsUpdate = true;
    if (this.starInstMesh.instanceColor) this.starInstMesh.instanceColor.needsUpdate = true;
    this.starDataAttr.needsUpdate = true;

    // 5. Update Procedural Faceted Crystals / Obsidian Lance Shingles / Rend Shards
    let shardAlive = 0;
    for (let i = 0; i < this.shards.length; i++) {
      const sh = this.shards[i];
      sh.age += dt;
      if (sh.age >= sh.duration) continue;
      this.shards[shardAlive] = sh;

      sh.vel.y -= sh.gravity * dt;
      sh.pos.addScaledVector(sh.vel, dt);

      const k = sh.age / sh.duration;
      const pop = k < 0.16 ? k / 0.16 : 1 - Math.pow(Math.max(0, (k - 0.65) / 0.35), 2);
      _quat.setFromAxisAngle(sh.rotAxis, (sh.initAngle || 0) + sh.age * sh.rotSpeed);
      _scale.copy(sh.scale).multiplyScalar(Math.max(0.01, pop));
      _mat4.compose(sh.pos, _quat, _scale);
      this.shardInstMesh.setMatrixAt(shardAlive, _mat4);
      this.shardInstMesh.setColorAt(shardAlive, sh.color);
      shardAlive++;
    }
    this.shards.length = shardAlive;
    this.shardInstMesh.count = shardAlive;
    this.shardInstMesh.visible = shardAlive > 0;
    this.shardInstMesh.instanceMatrix.needsUpdate = true;
    if (this.shardInstMesh.instanceColor) this.shardInstMesh.instanceColor.needsUpdate = true;

    // 6. Update Active `Serpent Tide Field` Phoenix Summon & Hunting AI
    if (this.activePhoenix) {
      const ph = this.activePhoenix;
      ph.age += dt;
      if (ph.age >= ph.duration) {
        this._disposeActivePhoenix();
      } else {
        ph.mixer?.update(dt * 1.25);
        const riseT = Math.min(1, ph.age / 0.75);
        const hoverY = 0.25 + 1.35 * (1 - Math.pow(1 - riseT, 3)) + Math.sin(ph.age * 3.2) * 0.18;
        const orbitR = 0.65 * riseT;
        ph.yaw += dt * 1.45;
        ph.birdHolder.position.set(
          Math.cos(ph.yaw) * orbitR,
          hoverY,
          Math.sin(ph.yaw) * orbitR,
        );
        ph.birdHolder.rotation.y = ph.yaw + Math.PI / 2;
        ph.birdHolder.rotation.z = -0.22 * riseT;

        const fadeT = ph.age > ph.duration - 1.1 ? (ph.age - (ph.duration - 1.1)) / 1.1 : 0;
        for (const m of ph.birdMats) {
          if (m.userData?.uDissolve) m.userData.uDissolve.value = fadeT;
        }

        // 3 Winding S-Curve Fire Serpents around the pyre perimeter (`SERPENT_VERTEX` pathAt)
        ph.serpentPhase += dt * 3.4;
        if (vfxManager) {
          for (let s = 0; s < 3; s++) {
            const theta = ph.serpentPhase + (s * TAU) / 3;
            const bend = Math.sin(theta * 3.0 + s * 2.39);
            const r = 3.4 * (1.0 + 0.32 * bend);
            const sy = 0.28 + 0.45 * (0.5 + 0.5 * Math.sin(theta * 4.5 - ph.age * 2.0));
            const wx = ph.center.x + Math.cos(theta) * r;
            const wz = ph.center.z + Math.sin(theta) * r;
            vfxManager.emitFlameBillow(
              new THREE.Vector3(wx, ph.center.y + sy, wz),
              new THREE.Vector3(-Math.sin(theta) * 4.0, 1.5, Math.cos(theta) * 4.0),
              s === 0 ? 0xff9a28 : s === 1 ? 0xff5218 : 0xffd060,
              0.95,
            );
          }
        }

        // Refresh molten Voronoi pyre sigil periodically while active
        ph.sigilTimer += dt;
        if (ph.sigilTimer >= 1.6) {
          ph.sigilTimer = 0;
          this.spawnGroundSigil(new THREE.Vector3(ph.center.x, ph.center.y + 0.04, ph.center.z), 4.6, 0xff6820, 3, 1.85, 1.55);
        }

        // Autonomous Phoenix Hunting Volley: spit homing beak fireballs at nearest live enemy!
        ph.volleyTimer -= dt;
        if (ph.volleyTimer <= 0 && combatEngine) {
          ph.volleyTimer = 0.68;
          const birdWorldPos = new THREE.Vector3();
          ph.birdHolder.getWorldPosition(birdWorldPos);
          let nearestEnemy = null;
          let bestDist = 22.0;
          for (const enc of combatEngine.encounters || []) {
            for (const f of enc.fighters || []) {
              if (f.state === 'dead') continue;
              const d = f.pos.distanceTo(birdWorldPos);
              if (d < bestDist) {
                bestDist = d;
                nearestEnemy = f;
              }
            }
          }
          if (nearestEnemy) {
            const aimDir = nearestEnemy.pos
              .clone()
              .add(new THREE.Vector3(0, nearestEnemy.height * 0.55, 0))
              .sub(birdWorldPos)
              .normalize();
            ph.birdHolder.rotation.y = Math.atan2(aimDir.x, aimDir.z);
            this.spawnStarGlint(birdWorldPos, 1.35, 0xfff0a0, 0.25, 1.8);
            combatEngine.projectiles.push({
              pos: birdWorldPos.clone(),
              vel: aimDir.multiplyScalar(21.0),
              damage: 78,
              poiseDamage: 48,
              radius: 0.36,
              colorHex: 0xff6e18,
              fromPlayer: true,
              isMeteor: true,
              life: 2.2,
            });
          }
        }
      }
    }
  }
}
