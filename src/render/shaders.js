import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  texture,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  step,
  smoothstep,
  saturate,
  exp,
  abs,
  max,
  min,
  pow,
  clamp,
  sin,
  cos,
  atan,
  length,
  dot,
  cross,
  normalize,
  sign,
  positionLocal,
  positionWorld,
  normalWorld,
  positionView,
  normalView,
  cameraPosition,
  uv,
  vertexColor,
  dFdx,
  dFdy,
  mx_noise_float,
  mx_worley_noise_float,
  mx_fractal_noise_float,
  attribute,
  time,
} from 'three/tsl';
import { ElementalSandboxSubsystem, flameFbmTSL, lineAATSL } from './elemental-sandbox-vfx.js';

// Shared world-space PolyHaven ground texture cache for createArterialTrailMaterial
let _groundPbrTextures = null;
function getGroundPbrTextures() {
  if (_groundPbrTextures) return _groundPbrTextures;
  const makeCanvasTex = (r, g, b) => {
    if (typeof document === 'undefined') {
      const data = new Uint8Array([r, g, b, 255, r, g, b, 255, r, g, b, 255, r, g, b, 255]);
      const tex = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return { tex, canvas: null, ctx: null };
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 256, 256);
    // Seed micro-mineral speckle so the canvas texture has rich grain immediately
    for (let i = 0; i < 600; i++) {
      const x = (i * 73) % 256;
      const y = (i * 137) % 256;
      const d = ((i * 29) % 36) - 18;
      ctx.fillStyle = `rgb(${Math.max(0, Math.min(255, r + d))},${Math.max(0, Math.min(255, g + d))},${Math.max(0, Math.min(255, b + d))})`;
      ctx.fillRect(x, y, 3, 3);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return { tex, canvas, ctx };
  };
  const rockEntry = makeCanvasTex(98, 92, 86);
  const sandstoneEntry = makeCanvasTex(198, 152, 102);
  const beachEntry = makeCanvasTex(210, 168, 118);

  if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
    const loadInto = (url, entry) => {
      if (!entry.ctx || !entry.canvas) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        entry.ctx.drawImage(img, 0, 0, entry.canvas.width, entry.canvas.height);
        entry.tex.needsUpdate = true;
      };
      img.src = url;
    };
    loadInto('/textures/polyhaven/aerial_rocks_02_diff_1k.jpg', rockEntry);
    loadInto('/textures/polyhaven/sandstone_blocks_04/sandstone_blocks_04_diff_1k.jpg', sandstoneEntry);
    loadInto('/textures/polyhaven/aerial_beach_01_diff_1k.jpg', beachEntry);
  }

  _groundPbrTextures = { rockDiff: rockEntry.tex, sandstoneDiff: sandstoneEntry.tex, beachDiff: beachEntry.tex };
  return _groundPbrTextures;
}

// ============================================================================
// 1. PIGALOO PERFECT WATER + LIVE RIPPLE / SPLAT SIMULATION (WebGPU TSL)
// ============================================================================
const RIPPLE_SLOTS = 8;
let _sharedWaterPoolBundle = null;

function getSharedWaterPoolBundle() {
  if (_sharedWaterPoolBundle) return _sharedWaterPoolBundle;

  const rippleUniforms = Array.from({ length: RIPPLE_SLOTS }, () =>
    uniform(new THREE.Vector4(0.0, 0.0, 99.0, 0.0)),
  );
  const geo = new THREE.CircleGeometry(1.0, 64);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshPhysicalNodeMaterial({
    transparent: true,
    forceSinglePass: true,
    depthWrite: false,
    roughness: 0.05,
    metalness: 0.0,
    ior: 1.333,
    side: THREE.DoubleSide,
  });

  const uDeep = uniform(new THREE.Color(0x072430));
  const uShallow = uniform(new THREE.Color(0x1c6c7e));
  const uFoam = uniform(new THREE.Color(0xdcf8ff));
  const uCausticColor = uniform(new THREE.Color(0.26, 0.78, 0.92));
  const uSkyReflectColor = uniform(new THREE.Color(0.42, 0.72, 0.88));
  mat.userData.uDeep = uDeep;
  mat.userData.uShallow = uShallow;
  mat.userData.uFoam = uFoam;
  mat.userData.uCausticColor = uCausticColor;
  mat.userData.uSkyReflectColor = uSkyReflectColor;

  const P = positionWorld;
  const xz = vec2(P.x, P.z);
  const radial = length(vec2(positionLocal.x, positionLocal.z));

  // Organic shoreline distortion so water pools never look like rigid geometric circles
  const shoreWarp = mx_noise_float(vec3(P.x.mul(0.28), P.z.mul(0.28), float(1.7))).mul(0.11);
  const warpedRadial = saturate(radial.add(shoreWarp.mul(smoothstep(0.45, 0.95, radial))));

  // Sum expanding circular ripples from footsteps, dodge rolls, weapon sweeps & raindrops
  let rippleHeight = sin(P.x.mul(0.55).add(time.mul(1.7)))
    .mul(cos(P.z.mul(0.48).sub(time.mul(1.4))))
    .mul(0.018);
  let rippleFoam = float(0.0);

  for (let i = 0; i < RIPPLE_SLOTS; i++) {
    const r = rippleUniforms[i];
    const dist = length(xz.sub(vec2(r.x, r.y)));
    const front = r.z.mul(5.2);
    const delta = dist.sub(front);
    const band = exp(delta.mul(delta).mul(-2.6));
    const decay = exp(r.z.mul(-1.75)).mul(exp(dist.mul(-0.18))).mul(r.w);
    const wave = sin(delta.mul(9.5)).mul(band).mul(decay);
    rippleHeight = rippleHeight.add(wave.mul(0.11));
    rippleFoam = rippleFoam.add(band.mul(decay).mul(0.85));
  }

  mat.positionNode = positionLocal.add(vec3(0, rippleHeight, 0));

  // Multi-scale capillary wave normal perturbation
  const n1 = mx_noise_float(vec3(P.x.mul(0.52).add(time.mul(0.18)), P.z.mul(0.52), time.mul(0.22)));
  const n2 = mx_noise_float(
    vec3(P.x.mul(1.45).sub(time.mul(0.14)), P.z.mul(1.45).add(time.mul(0.12)), time.mul(0.28).add(5.0)),
  );
  const n3 = mx_noise_float(
    vec3(P.x.mul(3.40).add(time.mul(0.24)), P.z.mul(3.40).sub(time.mul(0.19)), time.mul(0.35).add(11.0)),
  );
  const nx = n1.mul(0.09).add(n2.mul(0.05)).add(n3.mul(0.025));
  const nz = n2.mul(0.09).sub(n1.mul(0.05)).add(n3.mul(0.025));
  const N = normalize(vec3(nx, float(1.0), nz));
  mat.normalNode = N;

  // Dielectric Fresnel + Dual-Harmonic Worley Caustics + Soft Shore Intersection
  const V = normalize(cameraPosition.sub(P));
  const NoV = saturate(abs(dot(N, V)));
  const fresnel = pow(float(1.0).sub(NoV), float(4.2)).mul(0.92).add(0.08);

  const c1 = mx_worley_noise_float(vec3(P.x.mul(0.38).add(time.mul(0.08)), P.z.mul(0.38), time.mul(0.11)));
  const c2 = mx_worley_noise_float(
    vec3(P.x.mul(0.34).sub(time.mul(0.06)), P.z.mul(0.34).add(time.mul(0.05)), time.mul(0.09).add(4.0)),
  );
  const caustics = pow(saturate(float(1.0).sub(min(c1, c2).mul(2.85))), float(3.4));

  // Sub-water refracted stone grain so the pool floor blends naturally with the surrounding terrain
  const bedNoise = mx_fractal_noise_float(vec3(P.x.mul(1.6), float(0.0), P.z.mul(1.6)), 3, float(2.0), float(0.5));
  const edgeFactor = smoothstep(0.52, 0.96, warpedRadial);
  const baseWater = mix(uDeep, uShallow, edgeFactor.mul(0.68).add(float(1.0).sub(NoV).mul(0.32)))
    .mul(float(0.88).add(bedNoise.mul(0.24)));
  const causticGlow = uCausticColor.mul(caustics).mul(float(1.0).sub(warpedRadial.mul(0.55))).mul(0.68);

  const shoreFoam = smoothstep(0.82, 0.94, warpedRadial.add(n1.mul(0.04))).mul(
    float(1.0).sub(smoothstep(0.94, 1.0, warpedRadial)),
  );
  const totalFoam = saturate(shoreFoam.mul(0.48).add(rippleFoam));

  const skyReflect = uSkyReflectColor.mul(fresnel.mul(0.76));
  const finalCol = mix(baseWater.add(causticGlow).add(skyReflect), uFoam, totalFoam);

  mat.colorNode = finalCol;
  mat.emissiveNode = causticGlow.mul(0.28).add(uFoam.mul(saturate(rippleFoam).mul(0.45)));
  mat.opacityNode = float(1.0)
    .sub(smoothstep(0.76, 0.99, warpedRadial))
    .mul(mix(float(0.68), float(0.94), saturate(fresnel.add(totalFoam.mul(0.32)))));

  _sharedWaterPoolBundle = {
    geo,
    mat,
    rippleUniforms,
    rippleCursor: 0,
    lastStepTime: -1,
  };
  return _sharedWaterPoolBundle;
}

export function createInteractiveWaterPool({
  center = new THREE.Vector3(0, 0, 0),
  radius = 16,
}) {
  const shared = getSharedWaterPoolBundle();
  const mesh = new THREE.Mesh(shared.geo, shared.mat);
  mesh.position.copy(center);
  mesh.scale.set(radius, 1, radius);
  mesh.renderOrder = 2;

  return {
    mesh,
    center,
    radius,
    injectRipple(x, z, strength = 1.0) {
      const dx = x - center.x;
      const dz = z - center.z;
      if (dx * dx + dz * dz > radius * radius) return false;
      shared.rippleUniforms[shared.rippleCursor].value.set(x, z, 0.0, Math.min(2.2, strength));
      shared.rippleCursor = (shared.rippleCursor + 1) % RIPPLE_SLOTS;
      return true;
    },
    update(dt) {
      const now = performance.now();
      if (now - shared.lastStepTime < 8) return;
      shared.lastStepTime = now;
      for (let i = 0; i < RIPPLE_SLOTS; i++) {
        const v = shared.rippleUniforms[i].value;
        if (v.w > 0.001) {
          v.z += dt;
          if (v.z > 3.0) v.w = 0.0;
        }
      }
    },
  };
}

// ============================================================================
// 2. TRI-PLANAR KITBASH SEAM-BLENDING & ARTERIAL TRAIL NODE MATERIAL (TSL)
// ============================================================================
export function createArterialTrailMaterial() {
  const mat = new THREE.MeshPhysicalNodeMaterial({
    roughness: 0.68,
    metalness: 0.14,
    clearcoat: 0.0,
    clearcoatRoughness: 0.04,
    side: THREE.DoubleSide,
  });

  const uPetalTint = uniform(new THREE.Color(0.96, 0.68, 0.78));
  const uMossTint = uniform(new THREE.Color(0x1367a0));
  const uFrostCoverage = uniform(0.0);
  const uMagmaCoverage = uniform(0.0);
  const uDesertSandstone = uniform(0.0);
  mat.userData.uPetalTint = uPetalTint;
  mat.userData.uMossTint = uMossTint;
  mat.userData.uFrostCoverage = uFrostCoverage;
  mat.userData.uMagmaCoverage = uMagmaCoverage;
  mat.userData.uDesertSandstone = uDesertSandstone;

  const pbrTex = getGroundPbrTextures();
  const P = positionWorld;
  const N = normalWorld;
  const vCol = vertexColor();

  // 1. Multi-Scale Domain-Warped 3D FBM + Worley Flagstone + Coursed Megalithic Joint Relief
  const W = P.add(
    vec3(
      mx_noise_float(P.mul(0.28)),
      mx_noise_float(P.mul(0.28).add(17.0)),
      mx_noise_float(P.mul(0.28).add(31.0)),
    ).mul(0.55),
  );

  const n1 = mx_noise_float(W.mul(0.22));
  const n2 = mx_fractal_noise_float(W.mul(1.35), 4, float(2.05), float(0.5));
  const n3 = mx_fractal_noise_float(P.mul(5.2), 3, float(2.15), float(0.48));
  const microGrit = mx_noise_float(P.mul(18.5));

  // Dual-scale flagstone Voronoi + chiseled ashlar block joints so the road looks like carved ancient masonry
  const flagstoneCell = mx_worley_noise_float(W.mul(0.68));
  const subBlockCell = mx_worley_noise_float(P.mul(1.85).add(vec3(n1.mul(0.6), float(0.0), n1.mul(0.6))));
  const ashlarSeamX = smoothstep(0.92, 0.985, abs(sin(P.x.mul(1.45).add(n1.mul(0.55)))));
  const ashlarSeamZ = smoothstep(0.92, 0.985, abs(sin(P.z.mul(1.35).sub(n1.mul(0.55)))));
  const ashlarMortar = max(ashlarSeamX, ashlarSeamZ).mul(0.65);
  const mortarCrevice = saturate(
    smoothstep(0.46, 0.70, flagstoneCell)
      .mul(0.68)
      .add(smoothstep(0.56, 0.78, subBlockCell).mul(0.32))
      .add(ashlarMortar),
  );

  // Micro-pebble scatter & wind-sculpted desert sand ripples
  const pebbleCell = mx_worley_noise_float(P.mul(7.4));
  const pebbleBump = float(1.0).sub(smoothstep(0.08, 0.28, pebbleCell)).mul(mortarCrevice);
  const sandRipplePhase = P.x.mul(8.5).add(P.z.mul(3.8)).add(n1.mul(4.8)).add(n2.mul(1.6));
  const sandRipple = sin(sandRipplePhase).mul(0.5).add(0.5);
  const sandDriftMask = smoothstep(0.36, 0.72, n1.add(mortarCrevice.mul(0.35))).mul(uDesertSandstone);

  // 2. World-space PolyHaven PBR Texture Sampling (dual-scale anti-tiling blend)
  const uvMacro = vec2(P.x, P.z).mul(0.11).add(vec2(n1.mul(0.08), n2.mul(0.08)));
  const uvDetail = vec2(P.x, P.z).mul(0.42);
  const rockSample = mix(
    texture(pbrTex.rockDiff, uvMacro).rgb,
    texture(pbrTex.rockDiff, uvDetail).rgb,
    float(0.45),
  );
  const sandstoneSample = mix(
    texture(pbrTex.sandstoneDiff, uvMacro).rgb,
    texture(pbrTex.beachDiff, uvDetail).rgb,
    sandDriftMask.mul(0.58).add(0.22),
  );
  const pbrDetailLuma = mix(
    dot(rockSample, vec3(0.333, 0.333, 0.333)),
    dot(sandstoneSample, vec3(0.333, 0.333, 0.333)),
    uDesertSandstone,
  );

  // 3. Stratified dark basalt vs carved flagstone/mud floor vs Egyptian Megalithic Sandstone & Terracotta Flagstones
  const strata = sin(P.y.mul(2.2).add(n1.mul(3.2))).mul(0.5).add(0.5);
  const basalt = mix(
    vec3(0.18, 0.20, 0.24)
      .mul(float(0.68).add(strata.mul(0.38)))
      .mul(mix(vec3(1.0), rockSample.mul(1.35), float(0.52))),
    vec3(0.74, 0.52, 0.31)
      .mul(float(0.78).add(strata.mul(0.32)))
      .mul(mix(vec3(1.0), sandstoneSample.mul(1.28), float(0.58))),
    uDesertSandstone,
  );

  const dryStoneBase = mix(
    vec3(0.30, 0.26, 0.22)
      .mul(float(0.78).add(n2.mul(0.28)).add(n3.mul(0.14)))
      .mul(mix(vec3(1.0), rockSample.mul(1.42), float(0.58))),
    vec3(0.82, 0.57, 0.33)
      .mul(float(0.82).add(n2.mul(0.24)).add(sandRipple.mul(0.12)))
      .mul(mix(vec3(1.0), sandstoneSample.mul(1.32), float(0.64))),
    uDesertSandstone,
  );
  const mortarCol = mix(
    vec3(0.10, 0.09, 0.09).add(pebbleBump.mul(0.08)),
    vec3(0.44, 0.19, 0.08).add(sandRipple.mul(0.08)),
    uDesertSandstone,
  );
  const wetFlagstone = mix(dryStoneBase, mortarCol, mortarCrevice.mul(0.72));
  const moss = uMossTint.mul(float(0.76).add(n3.mul(0.38)).add(pbrDetailLuma.mul(0.22)));

  const floorMask = smoothstep(0.42, 0.82, saturate(abs(N.y)));
  const mossZoneMask = float(1.0)
    .sub(smoothstep(-45.0, 35.0, P.z))
    .mul(smoothstep(0.35, 0.78, saturate(abs(N.y)).add(n1.mul(0.35))));

  let col = mix(basalt, wetFlagstone, floorMask);
  col = mix(col, moss, mossZoneMask.mul(0.58));
  const vColFactor = mix(vCol.rgb.mul(2.1), vec3(1.12, 0.98, 0.84), uDesertSandstone.mul(0.86));
  col = col.mul(vColFactor);

  // Chapter 3 Frostbound snow & crystalline ice accumulation on upward-facing ledges (SnowSystemThreeJS contract)
  const frostMask = floorMask.mul(smoothstep(0.24, 0.70, n1.add(0.38))).mul(uFrostCoverage);
  const snowDriftShade = float(0.92).add(n2.mul(0.08));
  col = mix(col, vec3(0.88, 0.93, 1.0).mul(snowDriftShade), frostMask);

  // View-dependent ice-crystal sparkle glints on snow (achrefelouafi/SnowSystemThreeJS uSnowSparkle)
  const sparkleCell = mx_worley_noise_float(P.mul(22.0).add(cameraPosition.mul(0.16)));
  const snowSparkle = pow(saturate(float(1.0).sub(sparkleCell.mul(2.6))), float(8.0)).mul(frostMask);

  // Fallen Sakura petals / Crimson Autumn leaves / Frost crystals / Desert Gold-Crimson Sand Scatter
  const petalNoise = mx_worley_noise_float(P.mul(3.6));
  const petalCluster = smoothstep(0.32, 0.65, n1).mul(float(1.0).sub(smoothstep(0.08, 0.22, petalNoise)));
  const petalScatterMask = floorMask.mul(petalCluster).mul(float(1.0).sub(smoothstep(20.0, 52.0, P.z)));
  col = mix(col, uPetalTint, petalScatterMask.mul(0.64));

  // Stunning Rain Puddles on Flat Road Flagstones with Shoreline Porosity Darkening & Normal-Map Raindrop Ripples
  const flatRoadMask = smoothstep(0.84, 0.96, saturate(N.y));
  const n1Norm = n1.mul(0.5).add(0.5);
  const n2Norm = n2.mul(0.5).add(0.5);
  const puddleMacro = mx_noise_float(P.mul(0.16)).mul(0.5).add(0.5);
  const puddleField = n1Norm
    .mul(0.44)
    .add(n2Norm.mul(0.24))
    .add(puddleMacro.mul(0.32))
    .add(mortarCrevice.mul(0.20));
  const wetShoreMask = flatRoadMask
    .mul(smoothstep(0.42, 0.60, puddleField))
    .mul(float(1.0).sub(uFrostCoverage.mul(0.85)));
  const puddleMask = flatRoadMask
    .mul(smoothstep(0.56, 0.70, puddleField))
    .mul(float(1.0).sub(uFrostCoverage.mul(0.85)));

  // Porosity subsurface darkening around wet stone & puddle basins
  const wetDarken = mix(float(0.44), float(0.62), uDesertSandstone);
  col = mix(col, col.mul(wetDarken), wetShoreMask.mul(0.84));

  // Localized small-radius concentric raindrop ripples inside puddles (normal-perturbation + subtle glint)
  const dropPhase1 = time.mul(2.4);
  const dropDist1 = mx_worley_noise_float(vec3(P.x.mul(3.2), P.z.mul(3.2), dropPhase1));
  const dropDist2 = mx_worley_noise_float(vec3(P.x.mul(4.1).add(7.3), P.z.mul(4.1).sub(4.1), dropPhase1.add(1.7)));
  const localDrop1 = float(1.0).sub(smoothstep(0.02, 0.24, dropDist1));
  const localDrop2 = float(1.0).sub(smoothstep(0.02, 0.22, dropDist2));
  const ring1 = sin(dropDist1.mul(48.0).sub(time.mul(16.0))).mul(localDrop1);
  const ring2 = sin(dropDist2.mul(44.0).sub(time.mul(14.0))).mul(localDrop2);
  const rainRippleWave = ring1.add(ring2).mul(puddleMask);
  const glintTint = mix(vec3(0.55, 0.72, 0.86), vec3(0.95, 0.68, 0.34), uDesertSandstone);
  const rippleSpecGlint = glintTint.mul(saturate(rainRippleWave).mul(0.09));

  // Glassy Sky & Canopy / Golden Torchlight Fresnel Mirror Reflection in Puddles
  const V = normalize(cameraPosition.sub(P));
  const NoV = saturate(abs(dot(N, V)));
  const puddleFresnel = pow(float(1.0).sub(NoV), float(3.4));
  const canopyReflNoise = sin(P.x.mul(0.38).add(P.z.mul(0.32))).mul(0.5).add(0.5);
  const baseSkyRefl = mix(vec3(0.15, 0.23, 0.32), vec3(0.48, 0.28, 0.14), uDesertSandstone);
  const puddleReflectCol = mix(baseSkyRefl, uPetalTint.mul(0.56), canopyReflNoise.mul(0.42));
  col = mix(col, puddleReflectCol, puddleMask.mul(puddleFresnel.mul(0.74).add(0.22)));
  col = col.add(rippleSpecGlint.mul(puddleMask));

  // Zone 5 Sanctum magma veins OR Chapter 4 Abyssal Caldera full-level magma veins
  const sanctumMask = max(
    uMagmaCoverage,
    smoothstep(45.0, 72.0, P.x).mul(smoothstep(24.0, 70.0, P.z)),
  );
  const magmaVein = smoothstep(0.86, 0.95, float(1.0).sub(abs(n2).mul(2.35))).mul(sanctumMask);
  const magmaGlow = vec3(2.8, 0.58, 0.12).mul(magmaVein);
  const puddleMirrorSheen = puddleReflectCol.mul(puddleMask.mul(puddleFresnel.mul(0.16))).add(rippleSpecGlint.mul(0.35));

  mat.colorNode = mix(col, vec3(0.95, 0.28, 0.08), magmaVein);
  mat.emissiveNode = magmaGlow
    .add(vec3(0.75, 0.88, 1.0).mul(snowSparkle.mul(0.65)))
    .add(puddleMirrorSheen);

  // Screen-space Mikkelsen derivative relief bump + Puddle Mirror Flattening & Raindrop Ripple Normals
  const near = float(1.0).sub(smoothstep(8.0, 42.0, length(positionView)));
  const dryReliefH = n2
    .mul(0.068)
    .add(n3.mul(0.028).mul(near))
    .add(microGrit.mul(0.012).mul(near))
    .add(pebbleBump.mul(0.024).mul(floorMask))
    .add(sandRipple.mul(0.018).mul(sandDriftMask))
    .add(pbrDetailLuma.sub(0.5).mul(0.042).mul(near))
    .sub(mortarCrevice.mul(0.038).mul(floorMask));
  const H = mix(dryReliefH, rainRippleWave.mul(0.018), puddleMask.mul(0.96));
  const dpdx = dFdx(positionView);
  const dpdy = dFdy(positionView);
  const r1 = cross(dpdy, normalView);
  const r2 = cross(normalView, dpdx);
  const det = dot(dpdx, r1);
  const grad = sign(det).mul(dFdx(H).mul(r1).add(dFdy(H).mul(r2)));
  mat.normalNode = normalize(abs(det).mul(normalView).sub(grad));

  // Wetness & puddle mirror roughness inversion (0.02 in puddles, 0.18 on wet shore, 0.72 on dry stone)
  const baseRough = clamp(
    float(0.76)
      .sub(floorMask.mul(0.18))
      .add(n2.mul(0.16))
      .add(mortarCrevice.mul(0.12))
      .sub(pbrDetailLuma.sub(0.5).mul(0.14)),
    0.18,
    0.94,
  );
  const shoreRough = mix(baseRough, float(0.18), wetShoreMask.mul(0.82));
  mat.roughnessNode = mix(shoreRough, float(0.02), puddleMask.mul(0.98));
  mat.clearcoatNode = puddleMask.mul(0.98).add(wetShoreMask.mul(0.36));
  mat.clearcoatRoughnessNode = mix(float(0.16), float(0.02), puddleMask);

  return mat;
}

// ============================================================================
// 2B. POSEIDON MULTI-CASCADE SPECTRAL COASTAL OCEAN (owenyuwono/poseidon TSL)
// ============================================================================
export function createPoseidonCoastalOcean({
  center = new THREE.Vector3(-95, -1.65, 118),
  width = 280,
  depth = 280,
} = {}) {
  const geo = new THREE.PlaneGeometry(width, depth, 96, 96);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshPhysicalNodeMaterial({
    roughness: 0.07,
    metalness: 0.0,
    ior: 1.333,
    transparent: true,
    forceSinglePass: true,
  });

  const P = positionWorld;
  const t = time.mul(1.15);

  // 4 Spectral Gerstner/Phillips Wave Cascades (Large Swell -> Chop -> Capillary)
  const w1 = sin(P.x.mul(0.14).add(P.z.mul(0.09)).add(t.mul(1.35))).mul(0.42);
  const w2 = cos(P.x.mul(-0.23).add(P.z.mul(0.27)).sub(t.mul(1.85))).mul(0.22);
  const w3 = sin(P.x.mul(0.52).sub(P.z.mul(0.44)).add(t.mul(2.65))).mul(0.09);
  const w4 = mx_noise_float(vec3(P.x.mul(0.85).add(t.mul(0.4)), P.z.mul(0.85), t.mul(0.5))).mul(0.06);
  const waveH = w1.add(w2).add(w3).add(w4);

  // Choppy horizontal surge displacement
  const chopX = cos(P.x.mul(0.14).add(P.z.mul(0.09)).add(t.mul(1.35))).mul(0.18);
  const chopZ = sin(P.x.mul(-0.23).add(P.z.mul(0.27)).sub(t.mul(1.85))).mul(0.16);
  mat.positionNode = positionLocal.add(vec3(chopX, float(0.0), waveH.add(chopZ.mul(0.15))));

  // Analytic wave slope normal + capillary detail
  const slopeX = cos(P.x.mul(0.14).add(P.z.mul(0.09)).add(t.mul(1.35))).mul(0.14).add(w4.mul(0.25));
  const slopeZ = sin(P.x.mul(-0.23).add(P.z.mul(0.27)).sub(t.mul(1.85))).mul(0.16).sub(w3.mul(0.22));
  const N = normalize(vec3(slopeX.negate(), float(1.0), slopeZ.negate()));
  mat.normalNode = N;

  // Jacobian crest folding & whitecap foam (Poseidon oceanSurfaceMaterial technique)
  const crestMetric = saturate(waveH.sub(0.22).mul(1.85).add(w4.mul(2.2)));
  const foamNoise = mx_worley_noise_float(vec3(P.x.mul(0.65), P.z.mul(0.65), t.mul(0.25)));
  const jacobianFoam = smoothstep(0.38, 0.82, crestMetric.sub(foamNoise.mul(0.28)));

  // Subsurface turquoise crest scatter + Schlick Fresnel sky reflection
  const V = normalize(cameraPosition.sub(P));
  const NoV = saturate(abs(dot(N, V)));
  const fresnel = pow(float(1.0).sub(NoV), float(5.0));

  const deepSea = vec3(0.03, 0.12, 0.19);
  const shallowTurquoise = vec3(0.08, 0.48, 0.56);
  const crestScatter = shallowTurquoise.mul(saturate(waveH.add(0.35)).mul(0.85));
  const skyReflect = vec3(0.46, 0.72, 0.88).mul(fresnel.mul(0.85));
  const oceanCol = mix(deepSea.add(crestScatter).add(skyReflect), vec3(0.92, 0.97, 1.0), jacobianFoam);

  mat.colorNode = oceanCol;
  mat.emissiveNode = crestScatter.mul(0.22).add(vec3(0.25, 0.32, 0.36).mul(jacobianFoam));
  mat.opacityNode = float(0.94);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(center);
  mesh.receiveShadow = true;
  return mesh;
}

// ============================================================================
// 3. WIND-DISPLACED INSTANCED FOLIAGE MATERIAL (WebGPU TSL)
// ============================================================================
export function createWindFoliageMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: 0x1d3f2c,
    roughness: 0.80,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });

  const P = positionWorld;
  const swayMask = max(float(0.0), positionLocal.y.sub(1.2)).mul(0.075);
  const swayX = sin(time.mul(1.85).add(P.x.mul(0.18)).add(P.z.mul(0.12))).mul(swayMask);
  const swayZ = cos(time.mul(1.55).add(P.z.mul(0.19)).sub(P.x.mul(0.11))).mul(swayMask);
  mat.positionNode = positionLocal.add(vec3(swayX, float(0.0), swayZ));

  const tipBright = smoothstep(1.0, 7.5, positionLocal.y);
  mat.colorNode = mix(vec3(0.09, 0.21, 0.14), vec3(0.20, 0.44, 0.28), tipBright);
  return mat;
}

// ============================================================================
// 4. TARTARUS OBSIDIAN / SMOKE ENCOUNTER BARRIER (NO-BYPASS FOG SEAL IN TSL)
// ============================================================================
export function createObsidianSealMesh(width = 8, height = 5.5, color = 0xff4e2a) {
  const geo = new THREE.PlaneGeometry(width, height, 24, 16);
  geo.translate(0, height * 0.5, 0);

  const uDissolve = uniform(0.0);
  const uColor = uniform(new THREE.Color(color));

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    fog: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const uvCoord = uv();
  const P = positionWorld;
  const centered = uvCoord.sub(vec2(0.5, 0.48)).mul(vec2(width / height, 1.0));
  const r = length(centered);
  const ang = atan(centered.y, centered.x);

  // LinearAbilityExtThreeJS Tidewrought Ring + Fire Portal counter-rotating logarithmic spiral vortex & runic rings
  const spiral = sin(ang.mul(5.0).sub(r.mul(10.5)).sub(time.mul(2.8))).mul(0.5).add(0.5);
  const counterSpiral = cos(ang.mul(8.0).add(r.mul(14.0)).add(time.mul(2.1))).mul(0.5).add(0.5);
  const portalRingOuter = lineAATSL(r.sub(0.38), float(0.016));
  const portalRingInner = lineAATSL(r.sub(0.24), float(0.014));
  const runeGlyphs = step(0.45, sin(ang.mul(24.0).add(time.mul(1.8)))).mul(
    smoothstep(0.26, 0.28, r).mul(float(1.0).sub(smoothstep(0.35, 0.37, r))),
  );

  const n1 = mx_noise_float(vec3(uvCoord.x.mul(4.5), uvCoord.y.mul(3.5).sub(time.mul(0.95)), time.mul(0.35))).mul(0.5).add(0.5);
  const n2 = mx_worley_noise_float(vec3(uvCoord.x.mul(7.5).add(time.mul(0.4)), uvCoord.y.mul(6.5).sub(time.mul(1.3)), P.x.mul(0.2)));
  const pattern = mix(n1, float(1.0).sub(n2), 0.52);

  const edge = smoothstep(uDissolve, uDissolve.add(0.16), pattern);
  const rimBurn = float(1.0).sub(edge).mul(smoothstep(uDissolve.sub(0.04), uDissolve.add(0.02), pattern));
  const portalMask = float(1.0).sub(smoothstep(0.34, 0.52, r));
  const runes = portalRingOuter.mul(1.1)
    .add(portalRingInner.mul(0.85))
    .add(runeGlyphs.mul(1.15))
    .add(spiral.mul(counterSpiral).mul(smoothstep(0.44, 0.08, r)).mul(0.55));

  const vFade = smoothstep(0.0, 0.18, uvCoord.y).mul(float(1.0).sub(smoothstep(0.82, 1.0, uvCoord.y)));
  const sFade = smoothstep(0.0, 0.18, uvCoord.x).mul(float(1.0).sub(smoothstep(0.82, 1.0, uvCoord.x)));

  const fireGlow = uColor.mul(runes.mul(0.95).add(rimBurn.mul(1.8)));
  mat.colorNode = fireGlow.mul(portalMask);
  mat.opacityNode = clamp(edge.mul(runes.mul(0.42).add(rimBurn.mul(0.45))).mul(portalMask).mul(vFade).mul(sFade), float(0.0), float(0.65));

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 8;
  mesh.userData = { uDissolve, uColor };
  return mesh;
}

// ============================================================================
// 5. STEREOPOLIS VOLUMETRIC GODRAYS & PERFECT-DODGE HOLOGRAM MIRAGE CLONE (TSL)
// ============================================================================
export function createGodRayShaft({ topRadius = 1.8, bottomRadius = 4.2, height = 22, color = 0x9fd8ff }) {
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, height, 16, 1, true);
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const uCol = uniform(new THREE.Color(color));
  const uvCoord = uv();
  const V = normalize(cameraPosition.sub(positionWorld));
  const edge = pow(abs(dot(normalWorld, V)), float(1.6));
  const vFade = smoothstep(0.0, 0.25, uvCoord.y).mul(float(1.0).sub(smoothstep(0.68, 1.0, uvCoord.y)));
  const shimmer = sin(uvCoord.x.mul(18.0).add(time.mul(1.4))).mul(0.2).add(0.8);

  mat.colorNode = uCol.mul(0.48);
  mat.opacityNode = edge.mul(vFade).mul(shimmer).mul(0.20);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 4;
  return mesh;
}

const _sharedHeadGeo = new THREE.SphereGeometry(0.14, 8, 6);
const _sharedTorsoGeo = new THREE.CapsuleGeometry(0.17, 0.32, 3, 6);
const _sharedLimbGeo = new THREE.CapsuleGeometry(0.085, 0.28, 3, 6);
const _mirageJoints = [
  'pelvis',
  'spine_02.x',
  'head.x',
  'arm_stretch.l',
  'forearm_stretch.l',
  'arm_stretch.r',
  'forearm_stretch.r',
  'thigh_stretch.l',
  'leg_stretch.l',
  'thigh_stretch.r',
  'leg_stretch.r',
];

export function spawnHologramMirageClone(scene, playerPuppet, worldPos, worldYaw) {
  const group = new THREE.Group();
  group.position.copy(worldPos);
  group.rotation.y = worldYaw;

  const holoMat = new THREE.MeshBasicMaterial({
    color: 0x38f2ff,
    transparent: true,
    fog: false,
    opacity: 0.68,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const v = new THREE.Vector3();
  const invRoot = new THREE.Matrix4().copy(playerPuppet.root.matrixWorld).invert();

  for (const jName of _mirageJoints) {
    const b = playerPuppet.source.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(jName));
    if (!b) continue;
    b.getWorldPosition(v);
    v.applyMatrix4(invRoot);
    const isHead = jName.includes('head');
    const isTorso = jName.includes('spine') || jName.includes('pelvis');
    const geo = isHead ? _sharedHeadGeo : isTorso ? _sharedTorsoGeo : _sharedLimbGeo;
    const m = new THREE.Mesh(geo, holoMat);
    m.position.copy(v);
    group.add(m);
  }

  scene.add(group);
  return {
    group,
    holoMat,
    age: 0,
    maxLife: 0.62,
    update(dt) {
      this.age += dt;
      const k = Math.max(0, 1 - this.age / this.maxLife);
      holoMat.opacity = k * 0.68;
      holoMat.color.setRGB(0.22 + (1 - k) * 0.46, 0.92 - (1 - k) * 0.6, 1.0);
      if (this.age >= this.maxLife) {
        scene.remove(group);
        holoMat.dispose();
        return false;
      }
      return true;
    },
  };
}

// ============================================================================
// 6. RIBBON BLADE TRAIL & ZERO-ALLOCATION GPU COMBAT / SPELL VFX SYSTEM
// ============================================================================
let _sharedRibbonSlashMat = null;
function getSharedRibbonSlashMat() {
  if (_sharedRibbonSlashMat) return _sharedRibbonSlashMat;
  const mat = new THREE.MeshBasicNodeMaterial({
    vertexColors: true,
    transparent: true,
    fog: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // HandCastAbilityThreeJS VoidSlash / ShimmeringFlux + hun0fx Crescent Slash domain-warped TSL shader
  mat.colorNode = Fn(() => {
    const u = uv().x; // 0 = leading sword edge, 1 = trailing tail
    const v = uv().y; // 0 = hilt base, 1 = outer blade tip
    const vCol = vertexColor();

    // Domain-warped FBM flame/energy wisps shredding the trailing arc
    const fbm1 = flameFbmTSL(vec3(u.mul(6.5).sub(time.mul(9.5)), v.mul(4.2), time.mul(3.2)));
    const fbm2 = flameFbmTSL(vec3(u.mul(13.0).sub(time.mul(14.0)).add(fbm1.mul(1.8)), v.mul(8.5), time.mul(5.0)));
    const wisp = mix(fbm1, fbm2, 0.5);

    // Sharp outer crescent razor edge + shredded inner energy wake
    const outerRazor = smoothstep(0.68, 0.97, v);
    const midWake = smoothstep(0.12, 0.82, v).mul(smoothstep(0.18, 0.78, wisp.add(float(1.0).sub(u).mul(0.45))));
    const headFlash = float(1.0).sub(smoothstep(0.0, 0.28, u)).mul(smoothstep(0.35, 0.98, v));

    const hotCore = vec3(2.4, 2.2, 1.98);
    const slashCol = mix(vCol.rgb, hotCore, outerRazor.mul(0.55).add(headFlash.mul(0.45)));
    const mask = clamp(outerRazor.mul(1.15).add(midWake.mul(0.90)), 0.0, 1.40);
    return slashCol.mul(mask);
  })();
  mat.opacityNode = Fn(() => {
    const u = uv().x;
    const v = uv().y;
    const vCol = vertexColor();
    const lum = max(vCol.r, max(vCol.g, vCol.b));
    const tailFade = float(1.0).sub(smoothstep(0.15, 1.0, u));
    const edgeMask = smoothstep(0.06, 0.85, v);
    return clamp(lum.mul(tailFade).mul(edgeMask).mul(0.76), float(0.0), float(0.78));
  })();
  _sharedRibbonSlashMat = mat;
  return mat;
}

export class RibbonBladeTrail {
  constructor(scene, colorHex = 0x7be0ff, samples = 22) {
    this.samples = samples;
    this.history = [];
    this.wasActive = false;
    this.posAttr = new Float32Array(samples * 2 * 3);
    this.colAttr = new Float32Array(samples * 2 * 3);
    this.uvAttr = new Float32Array(samples * 2 * 2);

    for (let i = 0; i < samples; i++) {
      const u = i / Math.max(1, samples - 1);
      this.uvAttr.set([u, 0.0, u, 1.0], i * 4);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.posAttr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colAttr, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uvAttr, 2));
    const indices = [];
    for (let i = 0; i < samples - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(indices);

    this.mat = getSharedRibbonSlashMat();
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.color = new THREE.Color(colorHex);
    scene.add(this.mesh);
  }

  setColor(hex) {
    this.color.setHex(hex);
  }

  update(dt, basePos, tipPos, active = false, intensity = 1.0) {
    // Prevent flat stretched triangles from stale idle coordinates when a new swing starts!
    if (active && !this.wasActive) {
      this.history.length = 0;
    }
    this.wasActive = active;

    for (let i = 0; i < this.history.length; i++) {
      this.history[i].age += dt;
    }
    if (active && basePos.distanceToSquared(tipPos) > 0.01) {
      this.history.unshift({
        base: basePos.clone(),
        tip: tipPos.clone(),
        age: 0,
      });
    }
    const maxAge = 0.19;
    while (this.history.length > this.samples || (this.history.length && this.history[this.history.length - 1].age > maxAge)) {
      this.history.pop();
    }

    const len = this.history.length;
    if (len < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    for (let i = 0; i < this.samples; i++) {
      const rec = this.history[Math.min(i, len - 1)];
      const b = rec.base;
      const t = rec.tip;
      this.posAttr.set([b.x, b.y, b.z], i * 6);
      this.posAttr.set([t.x, t.y, t.z], i * 6 + 3);

      const fade = i < len ? Math.max(0, 1 - rec.age / maxAge) * (1 - i / this.samples) * Math.min(1.25, intensity * 0.82) : 0;
      const f2 = fade * fade;
      this.colAttr.set([this.color.r * f2 * 0.20, this.color.g * f2 * 0.20, this.color.b * f2 * 0.20], i * 6);
      this.colAttr.set([this.color.r * f2 * 0.92, this.color.g * f2 * 0.92, this.color.b * f2 * 0.92], i * 6 + 3);
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    if (this.mesh) {
      this.mesh.parent?.remove(this.mesh);
      this.mesh.geometry?.dispose?.();
    }
  }
}

const _vfxDummy = new THREE.Matrix4();
const _vfxPos = new THREE.Vector3();
const _vfxScale = new THREE.Vector3();
const _vfxQuat = new THREE.Quaternion();
const _vfxUp = new THREE.Vector3(0, 1, 0);
const _vfxDir = new THREE.Vector3();
const _vfxCol = new THREE.Color();

export class CombatVFXManager {
  constructor(scene, maxParticles = 1400) {
    this.scene = scene;
    this.max = maxParticles;
    this.particles = [];
    this.mirageClones = [];

    // 1. Pre-allocated InstancedMesh for High-Velocity Sparks, Flame Tongues, Lightning Filaments & Magic Motes
    const geo = new THREE.OctahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicNodeMaterial({
      color: 0xffffff,
      transparent: true,
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pInstCol = attribute('instanceColor', 'vec3');
    mat.colorNode = Fn(() => {
      const core = smoothstep(float(0.65), float(0.0), length(positionLocal.xz));
      return mix(pInstCol, vec3(1.85, 1.7, 1.48), core.mul(0.58)).mul(1.18);
    })();
    mat.opacityNode = Fn(() => {
      const core = smoothstep(float(0.95), float(0.0), length(positionLocal.xz));
      return clamp(core.mul(0.78), float(0.0), float(0.82));
    })();

    this.instMesh = new THREE.InstancedMesh(geo, mat, maxParticles);
    this.instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instMesh.setColorAt(0, new THREE.Color(0xffffff));
    geo.setAttribute('instanceColor', this.instMesh.instanceColor);
    this.instMesh.frustumCulled = false;
    this.instMesh.count = 0;
    this.instMesh.renderOrder = 12;
    scene.add(this.instMesh);

    // 2. Pre-allocated InstancedMesh for Volumetric Turbulent Fireballs & Spell Orbs (WebGPU TSL Shader!)
    this.maxOrbs = 48;
    const orbGeo = new THREE.IcosahedronGeometry(1, 3);
    const orbMat = new THREE.MeshBasicNodeMaterial({
      color: 0xffffff,
      transparent: true,
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orbInstCol = attribute('instanceColor', 'vec3');
    orbMat.positionNode = Fn(() => {
      const p = positionLocal.toVar();
      const nCoord = p.mul(2.6).add(vec3(time.mul(3.4), time.mul(-7.5), time.mul(2.8)));
      const turb = mx_fractal_noise_float(nCoord, 3, float(2.0), float(0.5));
      const tongue = turb.sub(0.45).mul(0.42);
      return p.add(normalView.xyz.mul(tongue));
    })();
    orbMat.colorNode = Fn(() => {
      const viewDot = abs(dot(normalize(normalView), vec3(0.0, 0.0, 1.0)));
      const nCoord = positionLocal.mul(3.4).add(vec3(0.0, time.mul(-9.0), time.mul(4.2)));
      const flameNoise = mx_fractal_noise_float(nCoord, 3, float(2.1), float(0.52));
      const heat = clamp(pow(viewDot, float(0.85)).add(flameNoise.sub(0.5).mul(0.65)), float(0.0), float(1.0));
      const whiteHotCore = vec3(2.4, 2.1, 1.58);
      const midFlame = orbInstCol.mul(1.45);
      const outerEmber = orbInstCol.mul(vec3(0.75, 0.22, 0.06));
      const col = mix(outerEmber, midFlame, smoothstep(float(0.12), float(0.58), heat));
      return mix(col, whiteHotCore, smoothstep(float(0.62), float(0.95), heat));
    })();
    orbMat.opacityNode = float(0.84);

    this.orbInstMesh = new THREE.InstancedMesh(orbGeo, orbMat, this.maxOrbs);
    this.orbInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbInstMesh.setColorAt(0, new THREE.Color(0xff6a20));
    orbGeo.setAttribute('instanceColor', this.orbInstMesh.instanceColor);
    this.orbInstMesh.frustumCulled = false;
    this.orbInstMesh.count = 0;
    this.orbInstMesh.renderOrder = 13;
    scene.add(this.orbInstMesh);

    // 3. Pre-allocated Shockwave Ring Pool (24 reusable rings)
    this.ringGeo = new THREE.RingGeometry(0.76, 1.0, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringPool = [];
    this.activeRings = [];
    for (let i = 0; i < 24; i++) {
      const rMat = new THREE.MeshBasicMaterial({
        color: 0xffd270,
        transparent: true,
        fog: false,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const rMesh = new THREE.Mesh(this.ringGeo, rMat);
      rMesh.visible = false;
      rMesh.frustumCulled = false;
      rMesh.renderOrder = 11;
      scene.add(rMesh);
      this.ringPool.push({ mesh: rMesh, mat: rMat, age: 0, duration: 0.36, maxRadius: 4.0 });
    }

    // 4. Pre-allocated Concentric Runic Light Rings Pool around Player for Magic Casting!
    this.haloGeo = new THREE.TorusGeometry(1.0, 0.038, 12, 72);
    this.haloGeo.rotateX(Math.PI / 2);
    this.haloPool = [];
    this.activeHalos = [];
    for (let i = 0; i < 18; i++) {
      const uCol = uniform(new THREE.Color(0x7be0ff));
      const uOp = uniform(0.0);
      const hMat = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        fog: false,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      hMat.colorNode = Fn(() => {
        const u = uv().x.mul(6.283185);
        const rune1 = sin(u.mul(8.0).add(time.mul(9.0))).mul(0.5).add(0.5);
        const rune2 = cos(u.mul(16.0).sub(time.mul(6.5))).mul(0.5).add(0.5);
        const pattern = mix(float(0.35), float(1.15), rune1.mul(rune2));
        const core = mix(uCol, vec3(2.25, 2.14, 1.88), rune1.mul(0.45));
        return core.mul(pattern).mul(uOp);
      })();
      hMat.opacityNode = clamp(uOp.mul(0.76), float(0.0), float(0.78));
      const hMesh = new THREE.Mesh(this.haloGeo, hMat);
      hMesh.visible = false;
      hMesh.frustumCulled = false;
      hMesh.renderOrder = 14;
      scene.add(hMesh);
      this.haloPool.push({
        mesh: hMesh,
        uCol,
        uOp,
        age: 0,
        duration: 0.75,
        baseRadius: 1.0,
        maxRadius: 2.2,
        spinSpeed: 4.0,
        riseSpeed: 0.8,
        tiltX: 0,
        tiltZ: 0,
      });
    }

    this.flashLight = new THREE.PointLight(0xffb860, 0, 15, 1.7);
    this.clashLight = new THREE.PointLight(0x88f0ff, 0, 14, 1.7);
    scene.add(this.flashLight, this.clashLight);
    this.flashTimer = 0;
    this.clashTimer = 0;
    this._projTrailAcc = 0;
    this.combatEngine = null;

    // 5. Achref Elouafi Elemental Sandbox Subsystem (Caustic Bloom, Celestial Rend, Void Slash, Crystal Surge & Phoenix Casting!)
    this.sandbox = new ElementalSandboxSubsystem(scene);
  }

  _pushParticle(p) {
    if (this.particles.length >= this.max) {
      this.particles.shift();
    }
    this.particles.push(p);
  }

  // High-velocity sparks with optional ground bounce & electric secondary filaments
  emitSparks(pos, dir = null, count = 34, colorHex = 0xffc864, speedScale = 1.0) {
    if (count >= 26 && this.sandbox) {
      this.sandbox.spawnStarGlint(pos, 0.95 * speedScale, colorHex, 0.22, 1.15);
    }
    const baseCol = new THREE.Color(colorHex);
    const hotCol = new THREE.Color(0xfff4d8);
    const elecCol = new THREE.Color(0x88f2ff);
    for (let i = 0; i < count; i++) {
      const isHot = i % 3 === 0;
      const isElec = i % 5 === 0;
      const vx = (Math.random() - 0.5) * 2.4 + (dir ? dir.x * 1.25 : 0);
      const vy = Math.random() * 1.55 + 0.4;
      const vz = (Math.random() - 0.5) * 2.4 + (dir ? dir.z * 1.25 : 0);
      const sp = (4.8 + Math.random() * 8.5) * speedScale;
      this._pushParticle({
        x: pos.x + (Math.random() - 0.5) * 0.12,
        y: pos.y + (Math.random() - 0.5) * 0.12,
        z: pos.z + (Math.random() - 0.5) * 0.12,
        vx: vx * sp,
        vy: vy * sp,
        vz: vz * sp,
        age: 0,
        life: 0.22 + Math.random() * 0.24,
        size: isElec ? 0.024 : 0.026 + Math.random() * 0.034,
        stretch: isElec ? 6.2 : 3.6 + Math.random() * 2.2,
        gravity: isElec ? 1.5 : 13.5,
        bounce: !isElec,
        groundY: Math.max(0, pos.y - 1.05),
        color: (isElec ? elecCol : isHot ? hotCol : baseCol).clone(),
      });
    }
    this.flashLight.position.copy(pos);
    this.flashLight.color.setHex(colorHex);
    this.flashLight.intensity = 21 * speedScale;
    this.flashTimer = 0.13;
  }

  // Electric Steel-on-Steel Blade Clash & Parry Flash (Caustic Bloom metallic adaptation + BurstSphere + RendStar + jagged arcs!)
  emitSwordClash(pos, dir = null, colorHex = 0xffd878) {
    this.emitSparks(pos, dir, 48, colorHex, 1.35);
    if (this.sandbox) {
      this.sandbox.spawnMetallicCausticClash(pos, colorHex, 1.85);
    }

    // Emit 18 jagged electric lightning arc filaments snapping outward from the blade contact point
    const white = new THREE.Color(0xffffff);
    const cyan = new THREE.Color(0x74f2ff);
    const gold = new THREE.Color(0xffe484);
    for (let i = 0; i < 18; i++) {
      const theta = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const phi = (Math.random() - 0.5) * Math.PI * 0.85;
      const sp = 11.0 + Math.random() * 14.0;
      const dx = Math.cos(theta) * Math.cos(phi);
      const dy = Math.sin(phi) + 0.25;
      const dz = Math.sin(theta) * Math.cos(phi);
      this._pushParticle({
        x: pos.x + dx * 0.18,
        y: pos.y + dy * 0.18,
        z: pos.z + dz * 0.18,
        vx: dx * sp,
        vy: dy * sp,
        vz: dz * sp,
        age: 0,
        life: 0.10 + Math.random() * 0.08,
        size: 0.032 + Math.random() * 0.02,
        stretch: 7.5 + Math.random() * 3.5,
        gravity: 0.0,
        jitter: 22.0,
        color: (i % 3 === 0 ? white : i % 2 === 0 ? cyan : gold).clone(),
      });
    }

    this.clashLight.position.copy(pos);
    this.clashLight.color.setHex(0x9cf6ff);
    this.clashLight.intensity = 34;
    this.clashTimer = 0.14;
  }

  // Elemental Sandbox Runic Ground Sigil + Volumetric Burst + Helical Ribbons around the Player during Magic Casting!
  spawnMagicLightRings(origin, primaryHex = 0x7be0ff, secondaryHex = 0xc6a4ff) {
    if (this.sandbox) {
      this.sandbox.spawnGroundSigil(origin, 2.5, primaryHex, 2, 0.72, 1.15);
      this.sandbox.spawnBurstSphere(
        new THREE.Vector3(origin.x, origin.y + 0.95, origin.z),
        0.35,
        1.75,
        secondaryHex,
        2,
        0.36,
        0.9,
        0.32,
      );
      this.sandbox.spawnStarGlint(
        new THREE.Vector3(origin.x, origin.y + 1.15, origin.z),
        1.25,
        primaryHex,
        0.30,
        1.25,
      );
    }

    // Double-helix ascending ribbons of light motes + electric magic flash around the caster
    const col1 = new THREE.Color(primaryHex);
    const col2 = new THREE.Color(secondaryHex);
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < 28; i++) {
      const strand = i % 2 === 0 ? 0 : Math.PI;
      const t = i / 28;
      const angle = t * Math.PI * 4 + strand;
      const rad = 0.85 + Math.sin(t * Math.PI) * 0.35;
      const px = origin.x + Math.cos(angle) * rad;
      const py = origin.y + 0.15 + t * 1.85;
      const pz = origin.z + Math.sin(angle) * rad;
      const tangX = -Math.sin(angle) * 5.2;
      const tangZ = Math.cos(angle) * 5.2;
      this._pushParticle({
        x: px,
        y: py,
        z: pz,
        vx: tangX,
        vy: 3.4 + Math.random() * 2.2,
        vz: tangZ,
        age: 0,
        life: 0.36 + Math.random() * 0.20,
        size: 0.038 + Math.random() * 0.025,
        stretch: 3.8,
        gravity: -2.5,
        color: (i % 4 === 0 ? white : i % 2 === 0 ? col1 : col2).clone(),
      });
    }

    // Electric magic flash arcs
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const sp = 9.5 + Math.random() * 8.0;
      this._pushParticle({
        x: origin.x + Math.cos(a) * 0.35,
        y: origin.y + 1.05 + (Math.random() - 0.5) * 0.4,
        z: origin.z + Math.sin(a) * 0.35,
        vx: Math.cos(a) * sp,
        vy: (Math.random() - 0.3) * 6.0,
        vz: Math.sin(a) * sp,
        age: 0,
        life: 0.12 + Math.random() * 0.08,
        size: 0.030,
        stretch: 6.5,
        gravity: 0.0,
        jitter: 18.0,
        color: (i % 2 === 0 ? white : col1).clone(),
      });
    }

    this.clashLight.position.set(origin.x, origin.y + 1.2, origin.z);
    this.clashLight.color.setHex(primaryHex);
    this.clashLight.intensity = 31;
    this.clashTimer = 0.14;
  }

  // Realistic Volumetric Flame Tongue & Rising Ember/Smoke Billow Emitter for Fireballs & Flame Attacks
  emitFlameBillow(pos, vel = null, colorHex = 0xff5a20, intensity = 1.0) {
    const coreCol = new THREE.Color(0xfff0a8);
    const midFlame = new THREE.Color(colorHex);
    const deepFlame = new THREE.Color(0xc82208);

    const count = Math.max(2, Math.round(4 * intensity));
    for (let i = 0; i < count; i++) {
      const isCore = i === 0;
      const isEmber = i === count - 1;
      const backVx = vel ? -vel.x * (0.18 + Math.random() * 0.15) : 0;
      const backVz = vel ? -vel.z * (0.18 + Math.random() * 0.15) : 0;
      this._pushParticle({
        x: pos.x + (Math.random() - 0.5) * 0.24,
        y: pos.y + (Math.random() - 0.5) * 0.24,
        z: pos.z + (Math.random() - 0.5) * 0.24,
        vx: backVx + (Math.random() - 0.5) * 2.4,
        vy: 1.8 + Math.random() * 2.8,
        vz: backVz + (Math.random() - 0.5) * 2.4,
        age: 0,
        life: isEmber ? 0.38 + Math.random() * 0.25 : 0.18 + Math.random() * 0.16,
        size: isEmber ? 0.028 : (0.095 + Math.random() * 0.065) * intensity,
        stretch: isEmber ? 3.8 : 1.65 + Math.random() * 0.85,
        gravity: -4.2, // Buoyant rising thermal convection!
        jitter: isEmber ? 8.0 : 3.5,
        color: (isCore ? coreCol : isEmber ? deepFlame : midFlame).clone(),
      });
    }
  }

  emitWaterDroplets(pos, count = 16) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.8;
      this._pushParticle({
        x: pos.x + (Math.random() - 0.5) * 0.4,
        y: pos.y + 0.08,
        z: pos.z + (Math.random() - 0.5) * 0.4,
        vx: Math.cos(angle) * sp,
        vy: 2.2 + Math.random() * 2.4,
        vz: Math.sin(angle) * sp,
        age: 0,
        life: 0.35 + Math.random() * 0.25,
        size: 0.03 + Math.random() * 0.03,
        stretch: 1.2,
        gravity: 9.8,
        color: new THREE.Color(0xb8f4ff),
      });
    }
  }

  // Pigaloo Threadlight + HandCastAbilityThreeJS Linear Void Slash 3-Lane Piercing Burst (Cast_Thread)
  emitThreadlightLanes(origin, yaw, range = 13.5, colorHex = 0x9fffe6) {
    this.spawnMagicLightRings(origin, colorHex, 0x58e6ff);
    if (this.sandbox) {
      this.sandbox.spawnLinearVoidSlash(origin, yaw, range, colorHex);
    }
    const col = new THREE.Color(colorHex);
    const white = new THREE.Color(0xffffff);
    for (let lane = -1; lane <= 1; lane++) {
      const angle = yaw + lane * 0.22;
      const dx = -Math.sin(angle);
      const dz = -Math.cos(angle);
      for (let d = 1.0; d <= range; d += 0.95) {
        const px = origin.x + dx * d;
        const py = origin.y + 1.05 + Math.sin(d * 0.6) * 0.12;
        const pz = origin.z + dz * d;
        for (let k = 0; k < 3; k++) {
          this._pushParticle({
            x: px + (Math.random() - 0.5) * 0.22,
            y: py + (Math.random() - 0.5) * 0.22,
            z: pz + (Math.random() - 0.5) * 0.22,
            vx: dx * (7.5 + Math.random() * 4.5) + (Math.random() - 0.5) * 1.4,
            vy: (Math.random() - 0.35) * 2.4,
            vz: dz * (7.5 + Math.random() * 4.5) + (Math.random() - 0.5) * 1.4,
            age: 0,
            life: 0.30 + (d / range) * 0.22,
            size: 0.055 + Math.random() * 0.035,
            stretch: 4.2,
            gravity: 0.5,
            color: (k === 0 ? white : col).clone(),
          });
        }
      }
    }
    this.flashLight.position.copy(origin).y += 1.2;
    this.flashLight.color.setHex(colorHex);
    this.flashLight.intensity = 25;
    this.flashTimer = 0.15;
  }

  // Pigaloo Prism Surge + Celestial Rend (Cast_Surge / Magic_2H_Area_1)
  emitPrismSurge(origin, radius = 6.2, colorHex = 0xc6a4ff) {
    this.spawnMagicLightRings(origin, colorHex, 0x9fffe6);
    if (this.sandbox) {
      this.sandbox.spawnCelestialRend(origin, colorHex, 0x9fffe6, radius * 0.85, 0.95);
    }
    const col1 = new THREE.Color(colorHex);
    const col2 = new THREE.Color(0x9fffe6);
    for (let i = 0; i < 18; i++) {
      const y = 1 - (2 * (i + 0.5)) / 18;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * 2.399963;
      const dx = Math.cos(a) * r;
      const dy = Math.abs(y) * 0.75 + 0.15;
      const dz = Math.sin(a) * r;
      for (let d = 0.8; d <= radius; d += 1.0) {
        this._pushParticle({
          x: origin.x + dx * d,
          y: origin.y + 1.0 + dy * d * 0.65,
          z: origin.z + dz * d,
          vx: dx * (8.5 + Math.random() * 4.0),
          vy: dy * (5.5 + Math.random() * 2.5),
          vz: dz * (8.5 + Math.random() * 4.0),
          age: 0,
          life: 0.36 + Math.random() * 0.22,
          size: 0.062 + Math.random() * 0.04,
          stretch: 3.4,
          gravity: 1.2,
          color: (i % 2 === 0 ? col1 : col2).clone(),
        });
      }
    }
    this.flashLight.position.copy(origin).y += 1.3;
    this.flashLight.color.setHex(colorHex);
    this.flashLight.intensity = 28;
    this.flashTimer = 0.15;
  }

  // Coalesced Arcane Lance / Beam + Crystallized Venom / Monolith Rupture (Magic_2H_Attack_2)
  emitArcaneBeam(origin, yaw, length = 15.0, colorHex = 0x58e6ff) {
    this.spawnMagicLightRings(origin, colorHex, 0xffffff);
    if (this.sandbox) {
      this.sandbox.spawnCrystalOrMonolithRupture(origin, yaw, length * 0.82, colorHex, true);
    }
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const col = new THREE.Color(colorHex);
    const coreCol = new THREE.Color(0xffffff);
    for (let d = 0.6; d <= length; d += 0.38) {
      const spiral = d * 2.6;
      const sx = Math.cos(spiral) * 0.24;
      const sy = Math.sin(spiral) * 0.24;
      this._pushParticle({
        x: origin.x + dx * d - dz * sx,
        y: origin.y + 1.18 + sy,
        z: origin.z + dz * d + dx * sx,
        vx: dx * 15.5,
        vy: sy * 1.8,
        vz: dz * 15.5,
        age: 0,
        life: 0.26 + (d / length) * 0.18,
        size: 0.068,
        stretch: 5.2,
        gravity: 0.0,
        color: (d % 0.8 < 0.4 ? coreCol : col).clone(),
      });
    }
  }

  // HandCastAbilityThreeJS Serpent Tide Field (Flapping Phoenix + 3 Fire Serpents + Homing Beak Fireballs)
  emitPhoenixTide(origin, yaw, colorHex = 0xff6a20) {
    this.spawnMagicLightRings(origin, colorHex, 0xffd270);
    if (this.sandbox) {
      this.sandbox.spawnPhoenixSerpentField(origin, yaw, { duration: 4.8, colorHex });
    }
    this.flashLight.position.copy(origin).y += 2.2;
    this.flashLight.color.setHex(colorHex);
    this.flashLight.intensity = 34;
    this.flashTimer = 0.18;
  }

  // Molten Meteor / Tempest Vortex / Abyssal Nova AoE + Celestial Rend Cataclysm Emitter
  emitSpellCataclysm(centerPos, radius = 5.5, colorHex = 0xff5a26, style = 'meteor') {
    this.spawnMagicLightRings(centerPos, colorHex, 0xffd270);
    if (this.sandbox) {
      this.sandbox.spawnCelestialRend(centerPos, colorHex, 0xfff0b8, radius * 0.92, 1.08);
    }
    const col = new THREE.Color(colorHex);
    const coreCol = new THREE.Color(0xfff2b8);
    for (let i = 0; i < 76; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      const px = centerPos.x + Math.cos(angle) * dist;
      const pz = centerPos.z + Math.sin(angle) * dist;
      if (style === 'meteor') {
        this._pushParticle({
          x: px + (Math.random() - 0.5) * 1.5,
          y: centerPos.y + 4.5 + Math.random() * 4.5,
          z: pz + (Math.random() - 0.5) * 1.5,
          vx: (Math.random() - 0.5) * 3.0,
          vy: -14.0 - Math.random() * 6.0,
          vz: (Math.random() - 0.5) * 3.0,
          age: 0,
          life: 0.38 + Math.random() * 0.24,
          size: 0.085 + Math.random() * 0.05,
          stretch: 4.4,
          gravity: 8.0,
          color: (i % 3 === 0 ? coreCol : col).clone(),
        });
      } else if (style === 'storm') {
        const tangX = -Math.sin(angle);
        const tangZ = Math.cos(angle);
        this._pushParticle({
          x: px,
          y: centerPos.y + 0.3 + Math.random() * 2.8,
          z: pz,
          vx: tangX * 10.5 + (Math.random() - 0.5) * 2.0,
          vy: 3.6 + Math.random() * 4.2,
          vz: tangZ * 10.5 + (Math.random() - 0.5) * 2.0,
          age: 0,
          life: 0.44 + Math.random() * 0.25,
          size: 0.065 + Math.random() * 0.04,
          stretch: 4.0,
          gravity: -1.8,
          color: (i % 4 === 0 ? coreCol : col).clone(),
        });
      } else {
        // Void Nova radial detonation
        this._pushParticle({
          x: centerPos.x + Math.cos(angle) * 0.4,
          y: centerPos.y + 1.1,
          z: centerPos.z + Math.sin(angle) * 0.4,
          vx: Math.cos(angle) * (8.5 + Math.random() * 7.5),
          vy: (Math.random() - 0.25) * 6.8,
          vz: Math.sin(angle) * (8.5 + Math.random() * 7.5),
          age: 0,
          life: 0.36 + Math.random() * 0.25,
          size: 0.072 + Math.random() * 0.04,
          stretch: 3.8,
          gravity: 1.5,
          color: (i % 3 === 0 ? coreCol : col).clone(),
        });
      }
    }
    this.flashLight.position.copy(centerPos).y += 1.5;
    this.flashLight.color.setHex(colorHex);
    this.flashLight.intensity = 28;
    this.flashTimer = 0.16;
  }

  // Replaces primitive flat RingGeometry washers with Caustic Bloom Voronoi-crazed ground sigils + 3D BurstSphere filament shells + RendStar glints!
  spawnShockwaveRing(pos, maxRadius = 4.2, colorHex = 0xffd270, vertical = false) {
    if (!this.sandbox) return;
    if (vertical) {
      this.sandbox.spawnBurstSphere(
        pos,
        0.28,
        Math.max(0.85, maxRadius * 0.42),
        colorHex,
        1,
        0.30,
        0.92,
        0.38,
      );
      this.sandbox.spawnStarGlint(pos, Math.max(0.75, maxRadius * 0.42), colorHex, 0.24, 1.25);
    } else {
      this.sandbox.spawnGroundSigil(pos, Math.max(1.2, maxRadius * 0.84), colorHex, 0, 0.46, 1.15);
      this.sandbox.spawnBurstSphere(
        new THREE.Vector3(pos.x, pos.y + 0.55, pos.z),
        0.30,
        Math.max(0.82, maxRadius * 0.35),
        colorHex,
        1,
        0.30,
        0.82,
        0.38,
      );
    }
  }

  spawnMirage(playerPuppet, pos, yaw) {
    this.mirageClones.push(spawnHologramMirageClone(this.scene, playerPuppet, pos, yaw));
  }

  // Syncs active spell projectiles/fireballs into the Turbulent TSL Fireball InstancedMesh
  // and continuously sheds realistic volumetric flame tongues & embers along each trajectory!
  syncProjectiles(projectiles) {
    const count = Math.min(this.maxOrbs, projectiles.length);
    for (let i = 0; i < count; i++) {
      const b = projectiles[i];
      const scale = (b.radius || 0.28) * 1.22;
      _vfxQuat.identity();
      _vfxDummy.compose(b.pos, _vfxQuat, _vfxScale.setScalar(scale));
      this.orbInstMesh.setMatrixAt(i, _vfxDummy);
      const hex = b.colorHex || (b.fromPlayer ? 0xff7828 : 0xff4518);
      _vfxCol.setHex(hex);
      this.orbInstMesh.setColorAt(i, _vfxCol);

      // Shed turbulent flame billows & glowing ember trails behind every flying fireball/orb
      this.emitFlameBillow(b.pos, b.vel, hex, b.isMeteor ? 1.28 : 0.82);
    }
    this.orbInstMesh.count = count;
    this.orbInstMesh.instanceMatrix.needsUpdate = true;
    if (this.orbInstMesh.instanceColor) this.orbInstMesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.flashLight.intensity *= Math.max(0, this.flashTimer / 0.15);
    }
    if (this.clashTimer > 0) {
      this.clashTimer = Math.max(0, this.clashTimer - dt);
      this.clashLight.intensity *= Math.max(0, this.clashTimer / 0.15);
    }

    let alive = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy -= p.gravity * dt;
      if (p.jitter) {
        p.vx += (Math.random() - 0.5) * p.jitter * dt * 12;
        p.vy += (Math.random() - 0.5) * p.jitter * dt * 12;
        p.vz += (Math.random() - 0.5) * p.jitter * dt * 12;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Ground bounce for hot steel sparks!
      if (p.bounce && p.groundY !== undefined && p.y <= p.groundY && p.vy < 0) {
        p.y = p.groundY + 0.02;
        p.vy = -p.vy * 0.48;
        p.vx *= 0.78;
        p.vz *= 0.78;
      }

      this.particles[alive] = p;

      const fade = 1 - p.age / p.life;
      _vfxDir.set(p.vx, p.vy, p.vz);
      if (_vfxDir.lengthSq() > 1e-4) {
        _vfxDir.normalize();
        _vfxQuat.setFromUnitVectors(_vfxUp, _vfxDir);
      } else {
        _vfxQuat.identity();
      }
      const sz = p.size * (0.35 + 0.65 * fade);
      _vfxDummy.compose(_vfxPos.set(p.x, p.y, p.z), _vfxQuat, _vfxScale.set(sz, sz * p.stretch, sz));
      this.instMesh.setMatrixAt(alive, _vfxDummy);
      _vfxCol.copy(p.color).multiplyScalar(fade * 1.12);
      this.instMesh.setColorAt(alive, _vfxCol);
      alive++;
    }
    this.particles.length = alive;
    this.instMesh.count = alive;
    this.instMesh.instanceMatrix.needsUpdate = true;
    if (this.instMesh.instanceColor) this.instMesh.instanceColor.needsUpdate = true;

    for (let i = this.activeRings.length - 1; i >= 0; i--) {
      const r = this.activeRings[i];
      r.age += dt;
      const k = Math.min(1, r.age / r.duration);
      r.mesh.scale.setScalar(0.25 + (r.maxRadius - 0.25) * (1 - Math.pow(1 - k, 2)));
      r.mat.opacity = 0.72 * (1 - k);
      if (k >= 1) {
        r.mesh.visible = false;
        this.activeRings.splice(i, 1);
        this.ringPool.push(r);
      }
    }

    // Update Concentric Runic Light Rings around the Player
    for (let i = this.activeHalos.length - 1; i >= 0; i--) {
      const h = this.activeHalos[i];
      h.age += dt;
      const k = Math.min(1, h.age / h.duration);
      const ease = 1 - Math.pow(1 - k, 2.2);
      const rad = h.baseRadius + (h.maxRadius - h.baseRadius) * ease;
      h.mesh.scale.setScalar(rad);
      h.mesh.position.y += h.riseSpeed * dt;
      h.mesh.rotation.y += h.spinSpeed * dt;
      h.uOp.value = Math.sin(k * Math.PI) * 1.02;
      if (k >= 1) {
        h.mesh.visible = false;
        this.activeHalos.splice(i, 1);
        this.haloPool.push(h);
      }
    }

    for (let i = this.mirageClones.length - 1; i >= 0; i--) {
      if (!this.mirageClones[i].update(dt)) {
        this.mirageClones.splice(i, 1);
      }
    }

    if (this.sandbox) {
      this.sandbox.update(dt, this.combatEngine, this);
    }
  }
}

// ============================================================================
// 7. DYNAMIC 3D RAIN WEATHER & GROUND SPLASH CORONA SYSTEM (WebGPU TSL)
// ============================================================================
export function createRainWeatherSystem(scene) {
  const group = new THREE.Group();
  group.name = 'rain_weather_system';
  scene.add(group);

  const uRainColor = uniform(new THREE.Color(0x9ad8f8));
  const uRainOpacity = uniform(0.22);

  // Slanted 3D Raindrop Streaks (1,200 GPU-animated instances centered around the player)
  const streakCount = 1200;
  const streakGeo = new THREE.PlaneGeometry(0.009, 0.86, 1, 2);
  const streakSeeds = new Float32Array(streakCount * 4);
  const streakDummy = new THREE.Object3D();

  const streakMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const aRainSeed = attribute('aRainSeed', 'vec4');
  streakMat.positionNode = Fn(() => {
    const pos = positionLocal.toVar();
    const speed = float(19.5).add(aRainSeed.y.mul(5.8));
    const cycle = time.mul(speed).add(aRainSeed.x.mul(22.0)).mod(float(18.0));
    const dropY = float(15.5).sub(cycle);
    const windSlantX = cycle.mul(-0.11).add(sin(time.mul(2.1).add(aRainSeed.z.mul(6.28))).mul(0.14));
    const windSlantZ = cycle.mul(0.06);
    pos.x.addAssign(windSlantX);
    pos.y.addAssign(dropY);
    pos.z.addAssign(windSlantZ);
    return pos;
  })();

  const uvStreak = uv();
  const streakTipFade = smoothstep(float(0.0), float(0.28), uvStreak.y).mul(
    float(1.0).sub(smoothstep(float(0.72), float(1.0), uvStreak.y)),
  );
  streakMat.colorNode = uRainColor.mul(1.15);
  streakMat.opacityNode = streakTipFade.mul(uRainOpacity);

  const streakInst = new THREE.InstancedMesh(streakGeo, streakMat, streakCount);
  let s = 48271;
  const nextRand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  for (let i = 0; i < streakCount; i++) {
    const angle = nextRand() * Math.PI * 2;
    const radius = 1.6 + Math.sqrt(nextRand()) * 22.0;
    streakDummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    streakDummy.rotation.set(0.04, nextRand() * Math.PI, 0.11);
    const sc = 0.82 + nextRand() * 0.45;
    streakDummy.scale.set(1.0, sc, 1.0);
    streakDummy.updateMatrix();
    streakInst.setMatrixAt(i, streakDummy.matrix);

    streakSeeds[i * 4 + 0] = nextRand();
    streakSeeds[i * 4 + 1] = nextRand();
    streakSeeds[i * 4 + 2] = nextRand();
    streakSeeds[i * 4 + 3] = nextRand();
  }
  streakGeo.setAttribute('aRainSeed', new THREE.InstancedBufferAttribute(streakSeeds, 4));
  streakInst.instanceMatrix.needsUpdate = true;
  streakInst.frustumCulled = false;
  streakInst.renderOrder = 9;
  group.add(streakInst);

  return {
    group,
    uRainColor,
    uRainOpacity,
    setChapterWeather(chapterIndex = 1) {
      if (chapterIndex === 1) {
        uRainColor.value.setHex(0x9ad8f8);
        uRainOpacity.value = 0.22;
      } else if (chapterIndex === 2) {
        uRainColor.value.setHex(0xd8b898);
        uRainOpacity.value = 0.20;
      } else if (chapterIndex === 3) {
        uRainColor.value.setHex(0xe8f6ff);
        uRainOpacity.value = 0.28;
      } else if (chapterIndex === 5) {
        uRainColor.value.setHex(0xffb868);
        uRainOpacity.value = 0.14;
      } else if (chapterIndex === 6) {
        uRainColor.value.setHex(0x88f0d8);
        uRainOpacity.value = 0.16;
      } else if (chapterIndex === 7) {
        uRainColor.value.setHex(0x98f6ff);
        uRainOpacity.value = 0.24;
      } else if (chapterIndex === 8) {
        uRainColor.value.setHex(0x74e8ff);
        uRainOpacity.value = 0.18;
      } else {
        uRainColor.value.setHex(0xff7838);
        uRainOpacity.value = 0.18;
      }
    },
    update(dt, playerPos) {
      if (playerPos) {
        group.position.copy(playerPos);
      }
    },
  };
}

// ============================================================================
// 8. VOLUMETRIC TURBULENT FIRE PLUME FOR TORCHES & BRAZIERS (WebGPU TSL)
//    Inspired by https://threejs.org/examples/?q=fire#webgpu_volume_fire
// ============================================================================
const _volFireMaterialCache = new Map();

export function createVolumetricFireMaterial({
  coreColorHex = 0xffe68c,
  midColorHex = 0xff7305,
  outerColorHex = 0xff1200,
  isInnerCore = false,
} = {}) {
  const key = `${coreColorHex}_${midColorHex}_${outerColorHex}_${isInnerCore ? 1 : 0}`;
  if (_volFireMaterialCache.has(key)) return _volFireMaterialCache.get(key);

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const uCoreCol = uniform(new THREE.Color(coreColorHex));
  const uMidCol = uniform(new THREE.Color(midColorHex));
  const uOuterCol = uniform(new THREE.Color(outerColorHex));
  mat.userData.uCoreCol = uCoreCol;
  mat.userData.uMidCol = uMidCol;
  mat.userData.uOuterCol = uOuterCol;

  // 1. Turbulent Upward-Advected Flame Tongue Vertex Displacement
  mat.positionNode = Fn(() => {
    const pos = positionLocal.toVar();
    const h = saturate(uv().y);
    const worldPhase = positionWorld.x.mul(0.37).add(positionWorld.z.mul(0.53));
    const tFlow = time.mul(isInnerCore ? 5.6 : 4.4).add(worldPhase);

    const nCoord = vec3(
      pos.x.mul(3.4).add(sin(tFlow.mul(0.7)).mul(0.45)),
      pos.y.mul(2.6).sub(tFlow),
      pos.z.mul(3.4).add(cos(tFlow.mul(0.65)).mul(0.45)),
    );
    const turb1 = mx_fractal_noise_float(nCoord, 3, float(2.05), float(0.52));
    const turb2 = mx_noise_float(nCoord.mul(2.15).add(vec3(7.1, tFlow.mul(-1.35), 3.7)));

    // Pinch flame tip into licking tongues while keeping base anchored to brazier coal bed
    const taper = float(1.0).sub(pow(h, float(1.35)).mul(0.76));
    const swayX = sin(tFlow.mul(1.35).add(h.mul(4.8))).mul(0.14).add(turb1.sub(0.5).mul(0.34)).mul(pow(h, float(1.15)));
    const swayZ = cos(tFlow.mul(1.15).sub(h.mul(4.2))).mul(0.14).add(turb2.sub(0.5).mul(0.34)).mul(pow(h, float(1.15)));
    const radialLick = float(1.0).add(turb1.sub(0.48).mul(0.52).mul(smoothstep(0.08, 0.85, h)));

    pos.x.assign(pos.x.mul(taper).mul(radialLick).add(swayX));
    pos.z.assign(pos.z.mul(taper).mul(radialLick).add(swayZ));
    pos.y.addAssign(turb2.sub(0.45).mul(0.18).mul(h));
    return pos;
  })();

  // 2. 3D Volumetric Density + Beer-Lambert Powder + Blackbody Radiation Ramp (webgpu_volume_fire)
  const vUv = uv();
  const h = saturate(vUv.y);
  const worldSeed = positionWorld.x.mul(0.41).add(positionWorld.z.mul(0.67));
  const tAdv = time.mul(isInnerCore ? 6.2 : 4.8).add(worldSeed);

  // Domain-warped 3D volumetric fire coordinates
  const sampleP = positionLocal
    .mul(isInnerCore ? 4.2 : 3.4)
    .add(vec3(sin(tAdv.mul(0.8)).mul(0.35), tAdv.mul(-1.45), cos(tAdv.mul(0.75)).mul(0.35)));
  const warpVec = vec3(
    mx_noise_float(sampleP.mul(0.85)),
    mx_noise_float(sampleP.mul(0.85).add(13.7)),
    mx_noise_float(sampleP.mul(0.85).add(29.3)),
  ).mul(0.65);

  const fbmMain = mx_fractal_noise_float(sampleP.add(warpVec), 4, float(2.08), float(0.52));
  const fbmFine = mx_noise_float(sampleP.mul(2.4).sub(vec3(0.0, tAdv.mul(1.8), 0.0)));
  const radialDist = length(vec2(positionLocal.x, positionLocal.z)).mul(isInnerCore ? 2.6 : 1.9);

  // Cylindrical + vertical temperature/density envelope (matching webgpu_volume_fire)
  const baseIgnite = smoothstep(float(0.0), float(0.14), h);
  const topErosion = float(1.0).sub(smoothstep(float(0.32), float(0.98), h));
  const coreColumn = saturate(float(1.0).sub(radialDist.mul(float(0.65).add(h.mul(0.85)))));

  const rawDensity = saturate(
    coreColumn
      .mul(0.68)
      .add(fbmMain.mul(0.72))
      .add(fbmFine.mul(0.28))
      .sub(pow(h, float(1.12)).mul(0.78)),
  ).mul(baseIgnite);

  // Eroded flame filaments & detached licking tongues near the top
  const flameMask = smoothstep(float(0.18), float(0.68), rawDensity.add(topErosion.mul(0.24)));

  // Beer-Lambert powder self-shadowing & volumetric emission curve: 1.0 - exp(-density * 2.8)
  const powder = float(1.0).sub(exp(rawDensity.mul(-2.85)));
  const temperature = saturate(rawDensity.mul(1.18).add(float(1.0).sub(h).mul(0.26)));

  // Blackbody temperature ramp: Outer Red (0xff1200) -> Mid Orange (0xff7305) -> White-Gold Core (0xffe68c)
  const colLowMid = mix(uOuterCol.mul(1.15), uMidCol.mul(1.75), smoothstep(float(0.14), float(0.56), temperature));
  const colBlackbody = mix(
    colLowMid,
    uCoreCol.mul(isInnerCore ? 2.55 : 2.05),
    smoothstep(float(0.54), float(0.88), temperature),
  );

  mat.colorNode = colBlackbody.mul(powder.mul(1.05).add(0.20));
  mat.opacityNode = saturate(flameMask.mul(powder).mul(isInnerCore ? 0.82 : 0.72));

  _volFireMaterialCache.set(key, mat);
  return mat;
}

let _sharedVolFireGeos = null;
function getSharedVolFireGeos() {
  if (_sharedVolFireGeos) return _sharedVolFireGeos;

  // Sculpted open-ended flame volume shells with vertical & radial subdivisions for smooth vertex turbulence
  const outerShellGeo = new THREE.CylinderGeometry(0.14, 0.36, 0.96, 18, 16, true);
  outerShellGeo.translate(0, 0.48, 0);

  const innerCoreGeo = new THREE.CylinderGeometry(0.07, 0.22, 0.68, 14, 12, true);
  innerCoreGeo.translate(0, 0.32, 0);

  // 3 intersecting vertical cross-volume slices at 0°, 60°, 120° so internal fire filaments are dense from any view angle
  const sliceGeo = new THREE.PlaneGeometry(0.66, 1.02, 8, 16);
  sliceGeo.translate(0, 0.50, 0);

  // Rising glowing ember spark geometry
  const emberGeo = new THREE.OctahedronGeometry(0.026, 0);

  _sharedVolFireGeos = { outerShellGeo, innerCoreGeo, sliceGeo, emberGeo };
  return _sharedVolFireGeos;
}

export function buildVolumetricFirePlume({
  scale = 1.0,
  coreColorHex = 0xffe68c,
  midColorHex = 0xff7305,
  outerColorHex = 0xff1200,
  emberCount = 8,
} = {}) {
  const geos = getSharedVolFireGeos();
  const outerMat = createVolumetricFireMaterial({
    coreColorHex,
    midColorHex,
    outerColorHex,
    isInnerCore: false,
  });
  const innerMat = createVolumetricFireMaterial({
    coreColorHex,
    midColorHex,
    outerColorHex,
    isInnerCore: true,
  });

  const plumeGroup = new THREE.Group();
  plumeGroup.name = 'VolumetricFirePlumeTSL';
  plumeGroup.scale.setScalar(scale);

  // 1. Outer turbulent volumetric flame envelope
  const outerMesh = new THREE.Mesh(geos.outerShellGeo, outerMat);
  outerMesh.renderOrder = 11;
  plumeGroup.add(outerMesh);

  // 2. Inner white-gold high-temperature plasma core
  const innerMesh = new THREE.Mesh(geos.innerCoreGeo, innerMat);
  innerMesh.renderOrder = 12;
  plumeGroup.add(innerMesh);

  // 3. Intersecting volumetric cross-planes (0°, 60°, 120°) for full 3D raymarched-style interior density
  for (let i = 0; i < 3; i++) {
    const sliceMesh = new THREE.Mesh(geos.sliceGeo, i === 1 ? innerMat : outerMat);
    sliceMesh.rotation.y = (i * Math.PI) / 3;
    sliceMesh.renderOrder = 11 + (i % 2);
    plumeGroup.add(sliceMesh);
  }

  // 4. GPU-Animated Rising & Spiraling Glowing Spark Embers
  if (emberCount > 0) {
    const emberMat = createVolumetricEmberMaterial(coreColorHex, midColorHex);
    const emberInst = new THREE.InstancedMesh(geos.emberGeo, emberMat, emberCount);
    const seeds = new Float32Array(emberCount * 4);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < emberCount; i++) {
      dummy.position.set(0, 0.12, 0);
      dummy.scale.setScalar(0.75 + (i % 3) * 0.28);
      dummy.updateMatrix();
      emberInst.setMatrixAt(i, dummy.matrix);
      seeds[i * 4 + 0] = (i * 0.6180339) % 1.0;
      seeds[i * 4 + 1] = ((i * 1.3247179) % 1.0) * Math.PI * 2;
      seeds[i * 4 + 2] = 0.12 + ((i * 0.4532) % 0.22);
      seeds[i * 4 + 3] = 1.15 + ((i * 0.7548) % 0.85);
    }
    geos.emberGeo.setAttribute('aEmberSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    emberInst.instanceMatrix.needsUpdate = true;
    emberInst.frustumCulled = false;
    emberInst.renderOrder = 13;
    plumeGroup.add(emberInst);
  }

  return plumeGroup;
}

const _volEmberMatCache = new Map();
function createVolumetricEmberMaterial(coreColorHex = 0xffe68c, midColorHex = 0xff7305) {
  const key = `${coreColorHex}_${midColorHex}`;
  if (_volEmberMatCache.has(key)) return _volEmberMatCache.get(key);

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const uCore = uniform(new THREE.Color(coreColorHex));
  const uMid = uniform(new THREE.Color(midColorHex));
  const aSeed = attribute('aEmberSeed', 'vec4');

  const cycle = time.mul(aSeed.w).add(aSeed.x.mul(5.0)).mod(float(1.0));
  mat.positionNode = Fn(() => {
    const pos = positionLocal.toVar();
    const spiralAngle = aSeed.y.add(cycle.mul(5.5)).add(time.mul(1.8));
    const spiralRad = aSeed.z.mul(float(0.35).add(cycle.mul(0.95)));
    pos.x.addAssign(cos(spiralAngle).mul(spiralRad));
    pos.z.addAssign(sin(spiralAngle).mul(spiralRad));
    pos.y.addAssign(cycle.mul(1.45));
    return pos;
  })();

  const fade = sin(cycle.mul(3.14159265));
  mat.colorNode = mix(uMid.mul(2.4), uCore.mul(3.8), float(1.0).sub(cycle));
  mat.opacityNode = saturate(fade);

  _volEmberMatCache.set(key, mat);
  return mat;
}
