import * as THREE from 'three';
import { time } from 'three/tsl';
import { loadGLTF } from '../anim/puppet-store.js';
import { normalizeModelMaterials } from '../render/fix-materials.js';
import { ZONES, SHRINES } from './serpent-spline.js';
import { createRockMaterial, createWeatheredRockGeometry } from './weathered-rocks.js';
import { LocalLightPool } from '../render/local-light-pool.js';
import {
  createArterialTrailMaterial,
  createPoseidonCoastalOcean,
  createInteractiveWaterPool,
  createGodRayShaft,
  createRainWeatherSystem,
  buildVolumetricFirePlume,
} from '../render/shaders.js';
import {
  buildSakuraTreeGeometry,
  createSakuraMaterials,
  createFallingSakuraPetals,
  buildDryadTreeGeometry,
  createDryadMaterials,
  buildProceduralMeadowClumpGeometry,
  createProceduralMeadowMaterial,
} from './procedural-trees.js';
import { buildCompleteEgyptianPyramidBiome } from './egyptian-pyramid-assets.js';
import { buildCompleteComplementaryBiome } from './complementary-biomes-assets.js';
import { buildCompleteAthenaionIslandBiome, getAthenaionFloorY } from './athenaion-biome.js';

const KIT_PATHS = {
  // Pigaloo World Library
  pRock1: '/sibling/pigaloo/public/assets/world-library/Stylized_Spruce_Forest/Meshes/Rocks/SM_Rock_01.glb',
  pRock4: '/sibling/pigaloo/public/assets/world-library/Stylized_Spruce_Forest/Meshes/Rocks/SM_Rock_04.glb',
  pSpruce1: '/sibling/pigaloo/public/assets/world-library/Stylized_Spruce_Forest/Meshes/Trees/SM_Spruce_01.glb',
  pBrokenTree: '/sibling/pigaloo/public/assets/world-library/Stylized_Spruce_Forest/Meshes/Debris/SM_Broken_Tree_01.glb',
  pFence: '/sibling/pigaloo/public/assets/world-library/Emberlight/Meshes/Fences/SM_WoodenFence.glb',
  pLantern: '/sibling/pigaloo/public/assets/world-library/Emberlight/Meshes/Lighting/SM_LanternChained.glb',
  pOlympusCol: '/sibling/pigaloo/public/assets/world-library/Olympus/Column/SM/SM_Column_SM_Column_body.glb',
  pOlympusArch: '/sibling/pigaloo/public/assets/world-library/Olympus/Modular_kits/ArchSmall/SM/SM_ArchSmall.glb',

  // Tartarus Cave & Dungeon Kits
  tBlackArch: '/sibling/tartarus/public/env/black_gate/shg_Arch_REF.glb',
  tRockWall: '/sibling/tartarus/public/env/black_gate/shg_Rock_Wall_001_REF.glb',
  tBlackCol: '/sibling/tartarus/public/env/black_gate/shg_Column_001_REF.glb',
  tTorch: '/sibling/tartarus/public/env/black_gate/shg_Torch_REF.glb',
  tSurArch: '/sibling/tartarus/public/env/temple_below/surArches.glb',
  tStalagmite: '/sibling/tartarus/public/env/temple_below/surStalagmite01_REF.glb',
  tTrilithonLeg: '/sibling/tartarus/public/env/pillared_undercroft/crypt_trilithon_leg.glb',
  tTrilithonLintel: '/sibling/tartarus/public/env/pillared_undercroft/crypt_trilithon_lintel.glb',
  tAltar: '/sibling/tartarus/public/env/pillared_undercroft/crypt_altar.glb',
  tBowl: '/sibling/tartarus/public/env/pillared_undercroft/crypt_bowl.glb',
  tCourtArch: '/sibling/tartarus/public/env/court_of_the_last_succubus/court_arch.glb',
  tCourtCol: '/sibling/tartarus/public/env/court_of_the_last_succubus/court_column.glb',
  tCourtChain: '/sibling/tartarus/public/env/court_of_the_last_succubus/court_chain.glb',
  tLavaRing: '/sibling/tartarus/public/env/court_of_the_last_succubus/court_lava_ring.glb',
  tTotem: '/sibling/tartarus/public/env/ember_tusk_warcamp/camp_totem.glb',
  tMineArch: '/sibling/tartarus/public/env/mine_props/wdpncgrdw.glb',
};

function buildRibbonMesh(samples, isBranch, material) {
  const count = samples.length;
  const cols = 7; // Cross-section vertices: outer-left cliff wall -> left curb -> floor -> right curb -> outer-right cliff wall
  const positions = new Float32Array(count * cols * 3);
  const colors = new Float32Array(count * cols * 3);
  const uvs = new Float32Array(count * cols * 2);
  const indices = [];

  const cRoad = new THREE.Color(0x524b44);
  const cCurb = new THREE.Color(0x363a35);
  const cWall = new THREE.Color(0x23262c);

  for (let i = 0; i < count; i++) {
    const s = samples[i];
    const t = isBranch ? 0.225 : s.t;
    const hw = s.halfWidth;
    // Zone 3 suspension bridge (t ~ 0.48..0.54) has open abyss on sides instead of tall rock walls
    const isBridge = !isBranch && t > 0.475 && t < 0.545;
    // Zone 4 Mirror Basin (t ~ 0.68..0.78) is a sunken amphitheater
    const isBasin = !isBranch && t > 0.68 && t < 0.78;

    const wallH = isBridge ? -8.0 : isBasin ? 9.5 : 11.5 + Math.sin(i * 0.37) * 2.5;
    const wallOut = hw + (isBridge ? 0.6 : 4.8);

    const offsets = [
      [-wallOut, wallH, cWall],
      [-hw - 0.8, isBridge ? -0.4 : 1.35, cWall],
      [-hw, 0.08, cCurb],
      [0, 0.0, cRoad],
      [hw, 0.08, cCurb],
      [hw + 0.8, isBridge ? -0.4 : 1.35, cWall],
      [wallOut, wallH, cWall],
    ];

    for (let c = 0; c < cols; c++) {
      const [lat, dy, col] = offsets[c];
      const idx = (i * cols + c) * 3;
      const uvIdx = (i * cols + c) * 2;
      const jitter = (c === 0 || c === cols - 1) ? Math.sin(i * 0.7 + c) * 0.9 : 0;
      const wx = s.point.x + s.right.x * (lat + jitter);
      const wy = s.point.y + dy;
      const wz = s.point.z + s.right.z * (lat + jitter);

      positions[idx] = wx;
      positions[idx + 1] = wy;
      positions[idx + 2] = wz;

      colors[idx] = col.r;
      colors[idx + 1] = col.g;
      colors[idx + 2] = col.b;

      uvs[uvIdx] = c / (cols - 1);
      uvs[uvIdx + 1] = i * 0.25;
    }

    if (i < count - 1) {
      for (let c = 0; c < cols - 1; c++) {
        const a = i * cols + c;
        const b = a + 1;
        const d = (i + 1) * cols + c;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData.origPositions = new Float32Array(positions);
  mesh.userData.samples = samples;
  return mesh;
}

export class KitbashWorld {
  constructor(scene, spine) {
    this.scene = scene;
    this.spine = spine;
    this.sectorCount = 12;
    this.sectors = Array.from({ length: this.sectorCount }, (_, i) => {
      const g = new THREE.Group();
      g.name = `sector_${i}`;
      scene.add(g);
      return {
        index: i,
        tMin: i / this.sectorCount,
        tMax: (i + 1) / this.sectorCount,
        group: g,
      };
    });
    this.branchGroup = new THREE.Group();
    this.branchGroup.name = 'sector_left_branch';
    scene.add(this.branchGroup);

    this.waterPools = [];
    this.shrineObjects = [];
    this.destructiblePillars = [];
    this.solidObstacles = [];
    this.debrisChunks = [];
    this.godRays = [];
    this.torches = [];
    this.windTime = 0;
    this.instancedFoliage = [];
    this.nonEgyptianProps = [];
    this.isEgyptianBiome = false;
  }

  addSolidCylinder({ id, x, y, z, r, h = 5.5, kind = 'rock', walkableTop = false, pillarRef = null }) {
    const obs = {
      id: id || `obs_${this.solidObstacles.length}`,
      type: 'cylinder',
      x,
      y,
      z,
      r,
      h,
      kind,
      walkableTop,
      pillarRef,
    };
    this.solidObstacles.push(obs);
    return obs;
  }

  addSolidOBB({ id, x, y, z, hx, hz, yaw = 0, h = 5.5, kind = 'wall', walkableTop = false }) {
    const obs = {
      id: id || `obb_${this.solidObstacles.length}`,
      type: 'obb',
      x,
      y,
      z,
      hx,
      hz,
      cos: Math.cos(yaw),
      sin: Math.sin(yaw),
      h,
      kind,
      walkableTop,
    };
    this.solidObstacles.push(obs);
    return obs;
  }

  sectorForT(t) {
    const idx = Math.min(this.sectorCount - 1, Math.max(0, Math.floor(t * this.sectorCount)));
    return this.sectors[idx].group;
  }

  addSectorInstances(source) {
    const buckets = Array.from({ length: this.sectorCount }, () => []);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < source.count; i++) {
      source.getMatrixAt(i, matrix);
      const x = matrix.elements[12], z = matrix.elements[14];
      let nearest = this.spine.samples[0], distance = Infinity;
      for (const sample of this.spine.samples) {
        const d = (sample.point.x - x) ** 2 + (sample.point.z - z) ** 2;
        if (d < distance) { nearest = sample; distance = d; }
      }
      const sector = Math.min(this.sectorCount - 1, Math.floor(nearest.t * this.sectorCount));
      buckets[sector].push(matrix.clone());
    }
    buckets.forEach((matrices, sector) => {
      if (!matrices.length) return;
      const batch = new THREE.InstancedMesh(source.geometry, source.material, matrices.length);
      batch.name = `Sector ${sector} ${source.material.name || 'scenery'} instances`;
      batch.userData.keepInEgypt = Boolean(source.userData?.keepInEgypt);
      batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow;
      matrices.forEach((value, index) => batch.setMatrixAt(index, value));
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere(); batch.boundingSphere.radius += 0.4;
      this.sectors[sector].group.add(batch);
      this.instancedFoliage.push(batch);
    });
  }

  async build() {
    const trailMat = createArterialTrailMaterial();
    this.trailMat = trailMat;

    // 1. Main Serpent's Spine Arterial Corridor & Zone 2 Left Branch Ribbon
    const mainRibbon = buildRibbonMesh(this.spine.samples, false, trailMat);
    this.mainRibbon = mainRibbon;
    this.scene.add(mainRibbon);
    const branchRibbon = buildRibbonMesh(this.spine.branchSamples, true, trailMat);
    this.branchRibbon = branchRibbon;
    this.branchGroup.add(branchRibbon);

    // 2. Build Zone 3 Suspension Bridge Timber Planks & Catenary Rope Rails (t: 0.475 -> 0.545)
    this.buildSuspensionBridge();

    // 3. Build Interactive Pigaloo Perfect Water Pools (Zone 1 Puddles, Zone 2 Left Clearing, Zone 4 Mirror Basin)
    this.buildWaterPools();

    // 4. Build Instanced Corridor Framing (Perimeter Basalt Columns, Stalagmites & Wind-Swaying Foliage)
    this.buildInstancedCorridorFraming();

    // 5. Build the 5 Diegetic Shrines (with Solid Stone Pedestal & Trilithon Colliders) + Ascension Realm Gate
    this.buildShrines();
    this.buildAscensionPortal();

    // 6. Build the 8 Destructible Stone Pillars in Zone 5's Apex Sovereign Arena (t = 0.96)
    this.buildDestructiblePillars();

    // 6b. Build Solid Tactical Boulders & Ruined Monoliths in Trail Pockets & Arenas
    this.buildSolidArenaCoverRocks();

    // 7. Build Stereopolis Volumetric GodRays in Zone 3 & Zone 4
    this.buildGodRays();

    // 8. Async-stream and kitbash real GLB assets from Pigaloo & Tartarus into each sector
    this.populateKitbashGLBs();

    // 9. Build the Complete Egyptian Pyramid & Ancient Tomb Biome (toggled active in Chapter V / ?map=egypt)
    this.egyptianBiome = buildCompleteEgyptianPyramidBiome(this.scene, this.spine, null, {
      includePointLights: false,
    });
    if (this.egyptianBiome?.rootGroup) {
      this.egyptianBiome.rootGroup.visible = false;
    }

    this.localLightPool = new LocalLightPool(this.scene, [...this.sectors.map(s => s.group), this.branchGroup]);
    this.rainWeather = createRainWeatherSystem(this.scene);
    this._rainRippleAcc = 0;
    this._rainPoolIdx = 0;
  }

  buildSuspensionBridge() {
    const plankGeo = new THREE.BoxGeometry(4.4, 0.16, 0.65);
    const plankMat = new THREE.MeshStandardMaterial({
      color: 0x8a6c52,
      roughness: 0.85,
      metalness: 0.05,
    });
    if (typeof document !== 'undefined') {
      const loader = new THREE.TextureLoader();
      loader.load('/sibling/pigaloo/public/assets/world/materials/rough_wood_diff_2k.jpg', (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        plankMat.map = tex;
        plankMat.needsUpdate = true;
      });
      loader.load('/sibling/pigaloo/public/assets/world/materials/rough_wood_nor_gl_2k.jpg', (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        plankMat.normalMap = tex;
        plankMat.normalScale.set(1.3, 1.3);
        plankMat.needsUpdate = true;
      });
      loader.load('/sibling/pigaloo/public/assets/world/materials/rough_wood_rough_2k.jpg', (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        plankMat.roughnessMap = tex;
        plankMat.needsUpdate = true;
      });
    }
    const postGeo = new THREE.CylinderGeometry(0.11, 0.13, 1.45, 6);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.9 });

    const group = this.sectorForT(0.51);
    const steps = 28;
    const leftTopPts = [];
    const rightTopPts = [];

    for (let i = 0; i <= steps; i++) {
      const t = 0.475 + (i / steps) * 0.07;
      const s = this.spine.getSampleAt(t);
      const plank = new THREE.Mesh(plankGeo, plankMat);
      plank.position.copy(s.point).add(new THREE.Vector3(0, 0.06, 0));
      plank.rotation.y = Math.atan2(s.flatTangent.x, s.flatTangent.z);
      plank.castShadow = true;
      plank.receiveShadow = true;
      group.add(plank);

      if (i % 3 === 0) {
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(postGeo, plankMat);
          post.position
            .copy(s.point)
            .addScaledVector(s.right, side * 2.15)
            .add(new THREE.Vector3(0, 0.72, 0));
          group.add(post);
          this.addSolidCylinder({
            id: `bridge_post_${i}_${side}`,
            x: post.position.x,
            y: s.point.y,
            z: post.position.z,
            r: 0.35,
            h: 2.2,
            kind: 'bridge_post',
          });
          const ropePt = post.position.clone().add(new THREE.Vector3(0, 0.6, 0));
          if (side < 0) leftTopPts.push(ropePt);
          else rightTopPts.push(ropePt);
        }
      }
    }

    for (const pts of [leftTopPts, rightTopPts]) {
      if (pts.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(pts);
        const ropeGeo = new THREE.TubeGeometry(curve, 24, 0.045, 6, false);
        group.add(new THREE.Mesh(ropeGeo, ropeMat));
      }
    }
  }

  buildWaterPools() {
    // Zone 1 Outer Horizon: Poseidon Multi-Cascade Spectral Coastal Ocean (owenyuwono/poseidon)
    this.poseidonOcean = createPoseidonCoastalOcean({
      center: new THREE.Vector3(-82, -1.55, -10),
      width: 620,
      depth: 620,
    });
    this.sectorForT(0.02).add(this.poseidonOcean);

    // Zone 1: Ankle-deep tidal canyon puddles (nested cleanly inside the flat center channel)
    const p1 = this.spine.getWorldPos(0.08, 0, -0.05);
    const pool1 = createInteractiveWaterPool({ center: p1, radius: 2.2, deepColor: 0x092a36, shallowColor: 0x1a687a });
    this.sectorForT(0.08).add(pool1.mesh);
    this.waterPools.push(pool1);

    const p2 = this.spine.getWorldPos(0.15, 0, -0.05);
    const pool2 = createInteractiveWaterPool({ center: p2, radius: 2.4, deepColor: 0x092a36, shallowColor: 0x1a687a });
    this.sectorForT(0.15).add(pool2.mesh);
    this.waterPools.push(pool2);

    // Zone 2 Left Branch: Sunken Tidal Clearing ("Wandering Wight" Arena)
    const branchCenter = this.spine.getWorldPos(0.82, 0, 0.03, true);
    const branchPool = createInteractiveWaterPool({
      center: branchCenter,
      radius: 12.2,
      deepColor: 0x072630,
      shallowColor: 0x1d7080,
    });
    this.branchGroup.add(branchPool.mesh);
    this.waterPools.push(branchPool);

    // Zone 4: The Mirror Basin ("Whiteclad Noble" Circular Water Arena)
    const mirrorCenter = this.spine.getWorldPos(0.73, 0, 0.04, false);
    const mirrorPool = createInteractiveWaterPool({
      center: mirrorCenter,
      radius: 16.0,
      deepColor: 0x06202e,
      shallowColor: 0x20889e,
    });
    this.sectorForT(0.73).add(mirrorPool.mesh);
    this.waterPools.push(mirrorPool);
  }

  injectWaterRipple(worldPos, strength = 1.0) {
    let hitWater = false;
    for (const pool of this.waterPools) {
      if (Math.abs(worldPos.y - pool.center.y) < 1.8) {
        if (pool.injectRipple(worldPos.x, worldPos.z, strength)) {
          hitWater = true;
        }
      }
    }
    return hitWater;
  }

  buildInstancedCorridorFraming() {
    const dummy = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();

    // 1. Craggy Canyon Cliff Buttresses along outer wall edges (replaces bare cylinder poles)
    const cliffCount = 160;
    const cliffGeo = createWeatheredRockGeometry(2.42, 9.8, { seed: 37 });
    cliffGeo.translate(0, -2.5, 0);
    const cliffMat = createRockMaterial();
    const cliffInst = new THREE.InstancedMesh(cliffGeo, cliffMat, cliffCount);
    cliffInst.castShadow = true;
    cliffInst.receiveShadow = true;

    for (let i = 0; i < cliffCount; i++) {
      const t = (i / cliffCount) * 0.96 + 0.02;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? 1 : -1;
      const distOut = s.halfWidth + 3.1 + (i % 3) * 1.15;
      pos.copy(s.point).addScaledVector(s.right, side * distOut).add(new THREE.Vector3(0, -0.4, 0));
      euler.set(Math.sin(i * 1.7) * 0.12, i * 1.3, Math.cos(i * 1.1) * 0.12);
      quat.setFromEuler(euler);
      const rScale = 0.85 + (i % 3) * 0.25;
      const hScale = 0.85 + (i % 4) * 0.30;
      scale.set(rScale, hScale, rScale);
      dummy.compose(pos, quat, scale);
      cliffInst.setMatrixAt(i, dummy);
    }
    cliffInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(cliffInst);

    // 2. Dryad Botanical Sakura Cherry Blossom Trees (Somei-Yoshino & Ancient Overhanging Sakura)
    // Full Dryad pipe-model skeleton + geotropic root system + 3D cupped sakura sprigs & florets
    const sakuraCount = 68;
    const { barkGeo: sakuraBarkGeo, blossomGeo: sakuraBlossomGeo } = buildSakuraTreeGeometry(108, 10.2);
    const { barkMat: sakuraBarkMat, blossomMat: sakuraBlossomMat } = createSakuraMaterials(time);
    const sakuraBarkInst = new THREE.InstancedMesh(sakuraBarkGeo, sakuraBarkMat, sakuraCount);
    const sakuraBlossomInst = new THREE.InstancedMesh(sakuraBlossomGeo, sakuraBlossomMat, sakuraCount);
    sakuraBarkInst.castShadow = true;
    sakuraBarkInst.receiveShadow = true;
    sakuraBlossomInst.castShadow = true;
    sakuraBlossomInst.receiveShadow = true;

    for (let i = 0; i < sakuraCount; i++) {
      const t = (i / sakuraCount) * 0.86 + 0.010;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? -1 : 1;
      // Place right along the scenic trail curb & embankment so players walk beneath the volumetric sakura canopy
      const overWidth = 1.28 + (i % 3) * 0.72;
      const distOut = s.halfWidth + overWidth;
      // Match embankment height so gnarled Dryad surface roots sit firmly in the ground
      const groundLift = Math.max(0, (overWidth - 0.6) * 0.28) - 0.16;
      pos.copy(s.point).addScaledVector(s.right, side * distOut).add(new THREE.Vector3(0, groundLift, 0));
      euler.set(side * -0.06, i * 1.618, (i % 2 === 0 ? 1 : -1) * 0.03);
      quat.setFromEuler(euler);
      const sc = 0.86 + (i % 4) * 0.15;
      scale.set(sc, sc, sc);
      dummy.compose(pos, quat, scale);
      sakuraBarkInst.setMatrixAt(i, dummy);
      sakuraBlossomInst.setMatrixAt(i, dummy);

      this.addSolidCylinder({
        id: `sakura_trunk_${i}`,
        x: pos.x,
        y: s.point.y,
        z: pos.z,
        r: 0.55 * sc,
        h: 5.5,
        kind: 'tree_trunk',
      });
    }
    sakuraBarkInst.instanceMatrix.needsUpdate = true;
    sakuraBlossomInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(sakuraBarkInst);
    this.addSectorInstances(sakuraBlossomInst);

    // 2b. Ancient Overhanging Specimen Sakura Trees framing key vistas, bridges & shrines
    const ancientSakuraCount = 28;
    const { barkGeo: ancSakuraBarkGeo, blossomGeo: ancSakuraBlossomGeo } = buildSakuraTreeGeometry(271, 11.6);
    const ancSakuraBarkInst = new THREE.InstancedMesh(ancSakuraBarkGeo, sakuraBarkMat, ancientSakuraCount);
    const ancSakuraBlossomInst = new THREE.InstancedMesh(ancSakuraBlossomGeo, sakuraBlossomMat, ancientSakuraCount);
    ancSakuraBarkInst.castShadow = true;
    ancSakuraBarkInst.receiveShadow = true;
    ancSakuraBlossomInst.castShadow = true;
    ancSakuraBlossomInst.receiveShadow = true;

    for (let i = 0; i < ancientSakuraCount; i++) {
      const t = (i / ancientSakuraCount) * 0.82 + 0.024;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? 1 : -1;
      const overWidth = 1.65 + (i % 2) * 0.85;
      const distOut = s.halfWidth + overWidth;
      const groundLift = Math.max(0, (overWidth - 0.6) * 0.28) - 0.18;
      pos.copy(s.point).addScaledVector(s.right, side * distOut).add(new THREE.Vector3(0, groundLift, 0));
      euler.set(side * -0.08, i * 2.399 + 0.8, 0);
      quat.setFromEuler(euler);
      const sc = 0.96 + (i % 3) * 0.16;
      scale.set(sc, sc, sc);
      dummy.compose(pos, quat, scale);
      ancSakuraBarkInst.setMatrixAt(i, dummy);
      ancSakuraBlossomInst.setMatrixAt(i, dummy);
    }
    ancSakuraBarkInst.instanceMatrix.needsUpdate = true;
    ancSakuraBlossomInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(ancSakuraBarkInst);
    this.addSectorInstances(ancSakuraBlossomInst);

    // 3. Dryad Procedural Forest Trees (from owenyuwono/dryad) — Deciduous Oaks, Crimson Maples & Highland Pines
    const mapleCount = 36;
    const { barkGeo: mapleBarkGeo, foliageGeo: mapleFoliageGeo } = buildDryadTreeGeometry('maple', 77, 10.4);
    const { barkMat: mapleBarkMat, foliageMat: mapleFoliageMat } = createDryadMaterials('maple', time);
    const mapleBarkInst = new THREE.InstancedMesh(mapleBarkGeo, mapleBarkMat, mapleCount);
    const mapleFoliageInst = new THREE.InstancedMesh(mapleFoliageGeo, mapleFoliageMat, mapleCount);
    mapleBarkInst.castShadow = true;
    mapleBarkInst.receiveShadow = true;
    mapleFoliageInst.castShadow = true;
    mapleFoliageInst.receiveShadow = true;

    for (let i = 0; i < mapleCount; i++) {
      const t = (i / mapleCount) * 0.84 + 0.016;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? -1 : 1;
      const overWidth = 1.75 + (i % 3) * 0.85;
      const distOut = s.halfWidth + overWidth;
      const groundLift = Math.max(0, (overWidth - 0.6) * 0.30) - 0.20;
      pos.copy(s.point).addScaledVector(s.right, side * distOut).add(new THREE.Vector3(0, groundLift, 0));
      euler.set(side * -0.05, i * 1.93 + 0.4, 0);
      quat.setFromEuler(euler);
      const sc = 0.84 + (i % 4) * 0.15;
      scale.set(sc, sc, sc);
      dummy.compose(pos, quat, scale);
      mapleBarkInst.setMatrixAt(i, dummy);
      mapleFoliageInst.setMatrixAt(i, dummy);
    }
    mapleBarkInst.instanceMatrix.needsUpdate = true;
    mapleFoliageInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(mapleBarkInst);
    this.addSectorInstances(mapleFoliageInst);

    const oakCount = 60;
    const { barkGeo: oakBarkGeo, foliageGeo: oakFoliageGeo } = buildDryadTreeGeometry('oak', 42, 11.2);
    const { barkMat: oakBarkMat, foliageMat: oakFoliageMat } = createDryadMaterials('oak', time);
    const oakBarkInst = new THREE.InstancedMesh(oakBarkGeo, oakBarkMat, oakCount);
    const oakFoliageInst = new THREE.InstancedMesh(oakFoliageGeo, oakFoliageMat, oakCount);
    oakBarkInst.castShadow = true;
    oakBarkInst.receiveShadow = true;
    oakFoliageInst.castShadow = true;
    oakFoliageInst.receiveShadow = true;

    for (let i = 0; i < oakCount; i++) {
      const t = (i / oakCount) * 0.82 + 0.018;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? 1 : -1;
      const overWidth = 1.95 + (i % 3) * 0.95;
      const distOut = s.halfWidth + overWidth;
      const groundLift = Math.max(0, (overWidth - 0.6) * 0.32) - 0.22;
      pos.copy(s.point).addScaledVector(s.right, side * distOut).add(new THREE.Vector3(0, groundLift, 0));
      euler.set(side * -0.04, i * 2.15 + 0.5, 0);
      quat.setFromEuler(euler);
      const sc = 0.85 + (i % 4) * 0.16;
      scale.set(sc, sc, sc);
      dummy.compose(pos, quat, scale);
      oakBarkInst.setMatrixAt(i, dummy);
      oakFoliageInst.setMatrixAt(i, dummy);

      this.addSolidCylinder({
        id: `dryad_oak_${i}`,
        x: pos.x,
        y: s.point.y,
        z: pos.z,
        r: 0.52 * sc,
        h: 5.5,
        kind: 'tree_trunk',
      });
    }
    oakBarkInst.instanceMatrix.needsUpdate = true;
    oakFoliageInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(oakBarkInst);
    this.addSectorInstances(oakFoliageInst);

    const pineCount = 56;
    const { barkGeo: pineBarkGeo, foliageGeo: pineFoliageGeo } = buildDryadTreeGeometry('pine', 101, 13.5);
    const { barkMat: pineBarkMat, foliageMat: pineFoliageMat } = createDryadMaterials('pine', time);
    const pineBarkInst = new THREE.InstancedMesh(pineBarkGeo, pineBarkMat, pineCount);
    const pineFoliageInst = new THREE.InstancedMesh(pineFoliageGeo, pineFoliageMat, pineCount);
    pineBarkInst.castShadow = true;
    pineFoliageInst.castShadow = true;

    for (let i = 0; i < pineCount; i++) {
      const t = (i / pineCount) * 0.84 + 0.022;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? -1 : 1;
      const overWidth = 2.85 + (i % 3) * 1.05;
      const distOut = s.halfWidth + overWidth;
      const groundLift = Math.max(0, (overWidth - 0.6) * 0.35) - 0.25;
      pos.copy(s.point).addScaledVector(s.right, side * distOut).add(new THREE.Vector3(0, groundLift, 0));
      euler.set(0, i * 1.37 + 1.1, 0);
      quat.setFromEuler(euler);
      const sc = 0.88 + (i % 3) * 0.18;
      scale.set(sc, sc, sc);
      dummy.compose(pos, quat, scale);
      pineBarkInst.setMatrixAt(i, dummy);
      pineFoliageInst.setMatrixAt(i, dummy);
    }
    pineBarkInst.instanceMatrix.needsUpdate = true;
    pineFoliageInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(pineBarkInst);
    this.addSectorInstances(pineFoliageInst);

    this.sakuraBlossomMat = sakuraBlossomMat;
    this.mapleFoliageMat = mapleFoliageMat;
    this.oakFoliageMat = oakFoliageMat;
    this.pineFoliageMat = pineFoliageMat;

    // 4. Gaia Interlocking Botanical Grass Turf & Stemmed Wildflower Clusters (owenyuwono/gaia)
    const meadowCount = 960;
    const meadowGeo = buildProceduralMeadowClumpGeometry(314);
    const meadowMat = createProceduralMeadowMaterial(time);
    this.meadowMat = meadowMat;
    const meadowInst = new THREE.InstancedMesh(meadowGeo, meadowMat, meadowCount);
    meadowInst.userData.keepInEgypt = true;
    meadowInst.castShadow = false;
    meadowInst.receiveShadow = true;

    for (let i = 0; i < meadowCount; i++) {
      const t = (i / meadowCount) * 0.88 + 0.008;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? -1 : 1;
      // Overlapping verge bands so adjacent 0.82m-radius Gaia swards interlock into a continuous meadow border
      const band = i % 3;
      const bandFrac = band === 0 ? 0.72 : band === 1 ? 0.88 : 1.04;
      const jitter = ((i * 7) % 11 - 5) * 0.045;
      const edgeOffset = bandFrac * s.halfWidth + jitter;
      const bankLift = Math.max(0, (edgeOffset - s.halfWidth * 0.88) * 0.14);
      pos.copy(s.point).addScaledVector(s.right, side * edgeOffset).add(new THREE.Vector3(0, bankLift, 0));
      euler.set(0, i * 2.39996, 0);
      quat.setFromEuler(euler);
      const sc = 1.04 + (i % 5) * 0.10;
      scale.set(sc, sc * 0.92, sc);
      dummy.compose(pos, quat, scale);
      meadowInst.setMatrixAt(i, dummy);
    }
    meadowInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(meadowInst);

    // 4b. Dryad Botanical Woodland Ferns & Flowering Lilac Shrubs (owenyuwono/dryad presets: 'fern' & 'lilac')
    const fernCount = 180;
    const { foliageGeo: fernFoliageGeo } = buildDryadTreeGeometry('fern', 505, 1.15);
    const { foliageMat: fernFoliageMat } = createDryadMaterials('fern', time);
    fernFoliageMat.color.setHex(0x1367a0);
    this.fernFoliageMat = fernFoliageMat;
    const fernInst = new THREE.InstancedMesh(fernFoliageGeo, fernFoliageMat, fernCount);
    fernInst.userData.keepInEgypt = true;
    fernInst.castShadow = true;
    fernInst.receiveShadow = true;

    for (let i = 0; i < fernCount; i++) {
      const t = (i / fernCount) * 0.86 + 0.012;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? 1 : -1;
      const edgeOffset = (0.88 + (i % 3) * 0.16) * s.halfWidth;
      const bankLift = Math.max(0, (edgeOffset - s.halfWidth * 0.85) * 0.18) - 0.06;
      pos.copy(s.point).addScaledVector(s.right, side * edgeOffset).add(new THREE.Vector3(0, bankLift, 0));
      euler.set(0, i * 2.199, 0);
      quat.setFromEuler(euler);
      const sc = 0.78 + (i % 4) * 0.12;
      scale.set(sc, sc, sc);
      dummy.compose(pos, quat, scale);
      fernInst.setMatrixAt(i, dummy);
    }
    fernInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(fernInst);

    const lilacCount = 110;
    const { barkGeo: lilacBarkGeo, foliageGeo: lilacFoliageGeo } = buildDryadTreeGeometry('lilac', 607, 1.85);
    const { barkMat: lilacBarkMat, foliageMat: lilacFoliageMat } = createDryadMaterials('lilac', time);
    this.lilacFoliageMat = lilacFoliageMat;
    const lilacBarkInst = new THREE.InstancedMesh(lilacBarkGeo, lilacBarkMat, lilacCount);
    const lilacFoliageInst = new THREE.InstancedMesh(lilacFoliageGeo, lilacFoliageMat, lilacCount);
    lilacBarkInst.castShadow = true;
    lilacFoliageInst.castShadow = true;
    lilacFoliageInst.receiveShadow = true;

    for (let i = 0; i < lilacCount; i++) {
      const t = (i / lilacCount) * 0.85 + 0.015;
      const s = this.spine.getSampleAt(t);
      const side = i % 2 === 0 ? -1 : 1;
      const edgeOffset = s.halfWidth + 0.65 + (i % 3) * 0.45;
      const bankLift = Math.max(0, (edgeOffset - s.halfWidth * 0.85) * 0.22) - 0.08;
      pos.copy(s.point).addScaledVector(s.right, side * edgeOffset).add(new THREE.Vector3(0, bankLift, 0));
      euler.set(0, i * 1.832, 0);
      quat.setFromEuler(euler);
      const sc = 0.76 + (i % 3) * 0.14;
      scale.set(sc, sc, sc);
      dummy.compose(pos, quat, scale);
      lilacBarkInst.setMatrixAt(i, dummy);
      lilacFoliageInst.setMatrixAt(i, dummy);
    }
    lilacBarkInst.instanceMatrix.needsUpdate = true;
    lilacFoliageInst.instanceMatrix.needsUpdate = true;
    this.addSectorInstances(lilacBarkInst);
    this.addSectorInstances(lilacFoliageInst);

    // 5. Drifting aerodynamic Sakura Blossom Petals across the corridor
    this.sakuraPetals = createFallingSakuraPetals(this.scene, time, 640);
  }

  buildAscensionPortal() {
    const s = this.spine.getSampleAt(0.992);
    const pos = this.spine.getWorldPos(0.992, 0, 0, false);
    const group = new THREE.Group();
    group.position.copy(pos);
    group.rotation.y = Math.atan2(s.flatTangent.x, s.flatTangent.z);

    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, 0.09, 14, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd700 }),
    );
    outerRing.position.y = 2.8;
    group.add(outerRing);

    const innerRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.06, 12, 40),
      new THREE.MeshBasicMaterial({ color: 0x58e6ff }),
    );
    innerRing.position.y = 2.8;
    group.add(innerRing);

    const riftCore = new THREE.Mesh(
      new THREE.CircleGeometry(1.82, 36),
      new THREE.MeshBasicMaterial({
        color: 0x3b8cff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      }),
    );
    riftCore.position.y = 2.8;
    group.add(riftCore);

    const light = new THREE.PointLight(0x58e6ff, 12.0, 22, 1.4);
    light.position.set(0, 3.0, 0);
    group.add(light);

    this.sectorForT(0.992).add(group);
    this.ascensionPortal = { group, pos: pos.clone(), outerRing, innerRing, riftCore, light };
  }

  setEgyptianDesertProfile(enabled) {
    const updateRibbon = (ribbon, isBranchRibbon) => {
      if (!ribbon?.geometry) return;
      const posAttr = ribbon.geometry.getAttribute('position');
      const orig = ribbon.userData?.origPositions;
      const samples = ribbon.userData?.samples;
      if (!posAttr || !orig || !samples) return;
      const arr = posAttr.array;
      const cols = 7;

      if (!enabled) {
        arr.set(orig);
      } else {
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];
          const t = isBranchRibbon ? 0.225 : s.t;
          for (let c = 0; c < cols; c++) {
            const idx = (i * cols + c) * 3;
            arr[idx] = orig[idx];
            arr[idx + 2] = orig[idx + 2];
            if (c === 0 || c === 1 || c === 5 || c === 6) {
              if (!isBranchRibbon && t < 0.235) {
                // Open Zone 1 outer cliff walls into low sweeping desert sand dunes so the Great Pyramids vista is unobstructed
                const duneH = (c === 0 || c === 6) ? 0.38 + Math.sin(i * 0.28 + c) * 0.22 : 0.14;
                arr[idx + 1] = s.point.y + duneH;
              } else {
                // Inside the Giant Pyramid / Tomb & Secret Gold Vault: tuck jagged canyon rock walls below the tomb floor so straight hieroglyph/mural walls stand cleanly
                arr[idx + 1] = s.point.y - 0.18;
              }
            } else {
              arr[idx + 1] = orig[idx + 1];
            }
          }
        }
      }
      posAttr.needsUpdate = true;
      ribbon.geometry.computeVertexNormals();
    };

    updateRibbon(this.mainRibbon, false);
    updateRibbon(this.branchRibbon, true);
  }

  getOrCreateComplementaryBiome(chapterIndex) {
    if (!this.complementaryBiomes) {
      this.complementaryBiomes = new Map();
    }
    if (this.complementaryBiomes.has(chapterIndex)) {
      return this.complementaryBiomes.get(chapterIndex);
    }
    const biome = buildCompleteComplementaryBiome(chapterIndex, this.scene, this.spine, null, {
      includePointLights: false,
    });
    if (biome?.rootGroup) {
      biome.rootGroup.visible = false;
    }
    this.complementaryBiomes.set(chapterIndex, biome);
    return biome;
  }

  setChapterBiome(chapterIndex = 1) {
    this.activeChapterIndex = chapterIndex;
    const uPetal = this.trailMat?.userData?.uPetalTint?.value;
    const uMoss = this.trailMat?.userData?.uMossTint?.value;
    const uFrost = this.trailMat?.userData?.uFrostCoverage;
    const uMagma = this.trailMat?.userData?.uMagmaCoverage;
    const uDesertSandstone = this.trailMat?.userData?.uDesertSandstone;

    const uBladeCol = this.meadowMat?.userData?.uBladeColor?.value;
    const uBladeTip = this.meadowMat?.userData?.uBladeTipColor?.value;
    const uBladeEmissive = this.meadowMat?.userData?.uBladeEmissive?.value;
    const waterUserData = this.waterPools?.[0]?.mesh?.material?.userData;

    const isAthenaion = chapterIndex === 9;
    const isEgypt = chapterIndex === 5;
    const isFullCustomBiome = isEgypt || (chapterIndex >= 6 && !isAthenaion);
    this.isAthenaionBiome = isAthenaion;
    this.isEgyptianBiome = isEgypt;
    this.isMonumentalBiome = isFullCustomBiome;

    // Switch SerpentSpineTopology between standard canyon curve and open-island Athenaion Sacred Way
    this.spine?.setAthenaionMode?.(isAthenaion, isAthenaion ? getAthenaionFloorY : null);
    if (this.shrineObjects) {
      for (const sh of this.shrineObjects) {
        const s = this.spine.getSampleAt(sh.t);
        const pos = this.spine.getWorldPos(sh.t, sh.sideOffset, 0, false);
        sh.worldPos.copy(pos);
        if (sh.group) {
          sh.group.position.copy(pos);
          sh.group.rotation.y = Math.atan2(-s.right.x * Math.sign(sh.sideOffset), -s.right.z * Math.sign(sh.sideOffset));
        }
      }
    }
    if (this.ascensionPortal) {
      const pos = this.spine.getWorldPos(0.992, 0, 0, false);
      this.ascensionPortal.pos.copy(pos);
      if (this.ascensionPortal.group) {
        this.ascensionPortal.group.position.copy(pos);
      }
    }

    if (!this._canyonSolidObstacles) {
      this._canyonSolidObstacles = [...this.solidObstacles];
    }

    if (isAthenaion) {
      if (!this.athenaionBiome) {
        this.athenaionBiome = buildCompleteAthenaionIslandBiome(this.scene, this.spine, null, {});
      }
      if (this.athenaionBiome?.rootGroup) {
        this.athenaionBiome.rootGroup.visible = true;
      }
      this.solidObstacles = this.athenaionBiome?.solidObstacles || [];
    } else {
      if (this.athenaionBiome?.rootGroup) {
        this.athenaionBiome.rootGroup.visible = false;
      }
      this.solidObstacles = this._canyonSolidObstacles;
    }

    if (this.mainRibbon) this.mainRibbon.visible = !isAthenaion;
    if (this.branchRibbon) this.branchRibbon.visible = !isAthenaion;
    if (this.sakuraPetals) this.sakuraPetals.visible = !isAthenaion;

    if (this.egyptianBiome?.rootGroup) {
      this.egyptianBiome.rootGroup.visible = isEgypt;
    }

    // Toggle Complementary Biomes (Chapters 2, 3, 4 landmarks + Chapters 6, 7, 8 full monumental biomes)
    if (this.complementaryBiomes) {
      for (const [, b] of this.complementaryBiomes) {
        if (b?.rootGroup) b.rootGroup.visible = false;
      }
    }
    this.activeComplementaryBiome = null;
    if (chapterIndex >= 2 && chapterIndex !== 5 && !isAthenaion) {
      const compBiome = this.getOrCreateComplementaryBiome(chapterIndex);
      if (compBiome?.rootGroup) {
        compBiome.rootGroup.visible = true;
      }
      this.activeComplementaryBiome = compBiome;
    }

    if (this.poseidonOcean) {
      this.poseidonOcean.visible = !isEgypt && chapterIndex !== 6 && !isAthenaion;
    }
    if (uDesertSandstone) {
      uDesertSandstone.value = isEgypt ? 1.0 : chapterIndex === 6 ? 0.86 : chapterIndex === 8 ? 0.34 : 0.0;
    }
    this.setEgyptianDesertProfile(isFullCustomBiome);
    for (const batch of this.instancedFoliage) {
      if (!batch.userData?.keepInEgypt) {
        batch.visible = !isFullCustomBiome && !isAthenaion;
      } else {
        batch.visible = !isAthenaion;
      }
    }
    for (const prop of this.nonEgyptianProps) {
      prop.visible = !isFullCustomBiome && !isAthenaion;
    }

    if (isEgypt) {
      // Warm Sacred Nile Amber-Gold & Torchlight Caustics in water pools
      waterUserData?.uDeep?.value?.setHex(0x281608);
      waterUserData?.uShallow?.value?.setHex(0x7c4a1e);
      waterUserData?.uFoam?.value?.setHex(0xffe0a8);
      waterUserData?.uCausticColor?.value?.setRGB(0.96, 0.64, 0.22);
      waterUserData?.uSkyReflectColor?.value?.setRGB(0.84, 0.58, 0.28);
      this.shrinePedestalMat?.color?.setHex(0xd89c5a);
      this.arenaRockMat?.color?.setHex(0xd89c5a);
      const egyptMats = this.egyptianBiome?.textureSuite?.materials;
      if (egyptMats && this.destructiblePillars) {
        for (const p of this.destructiblePillars) {
          if (p.colMesh) p.colMesh.material = egyptMats.hieroglyphRelief;
          if (p.strip) p.strip.material = egyptMats.solidGold;
          if (p.tartarusCol) p.tartarusCol.visible = false;
        }
      }
    } else if (chapterIndex >= 6 && this.activeComplementaryBiome?.textureSuite?.materials) {
      const compMats = this.activeComplementaryBiome.textureSuite.materials;
      if (chapterIndex === 6) {
        // Chapter VI: Euphrates Turquoise & Babylonian Gold Caustics
        waterUserData?.uDeep?.value?.setHex(0x062c38);
        waterUserData?.uShallow?.value?.setHex(0x16888e);
        waterUserData?.uFoam?.value?.setHex(0xdcf8f2);
        waterUserData?.uCausticColor?.value?.setRGB(0.96, 0.78, 0.28);
        waterUserData?.uSkyReflectColor?.value?.setRGB(0.32, 0.82, 0.74);
        this.shrinePedestalMat?.color?.setHex(0xc89a58);
        this.arenaRockMat?.color?.setHex(0xc89a58);
      } else if (chapterIndex === 7) {
        // Chapter VII: Glacial Fjord & Bifrost Cyan-Aurora Caustics
        waterUserData?.uDeep?.value?.setHex(0x051c2c);
        waterUserData?.uShallow?.value?.setHex(0x145878);
        waterUserData?.uFoam?.value?.setHex(0xe2f8ff);
        waterUserData?.uCausticColor?.value?.setRGB(0.28, 0.94, 1.0);
        waterUserData?.uSkyReflectColor?.value?.setRGB(0.36, 0.84, 0.96);
        this.shrinePedestalMat?.color?.setHex(0x889aa8);
        this.arenaRockMat?.color?.setHex(0x889aa8);
      } else {
        // Chapter VIII: Sunken Atlantis Bioluminescent & Orichalcum Caustics
        waterUserData?.uDeep?.value?.setHex(0x061e38);
        waterUserData?.uShallow?.value?.setHex(0x127898);
        waterUserData?.uFoam?.value?.setHex(0xd8f8ff);
        waterUserData?.uCausticColor?.value?.setRGB(1.0, 0.68, 0.24);
        waterUserData?.uSkyReflectColor?.value?.setRGB(0.42, 0.82, 0.98);
        this.shrinePedestalMat?.color?.setHex(0xd8d0c4);
        this.arenaRockMat?.color?.setHex(0xd8d0c4);
      }
      if (this.destructiblePillars) {
        const colMat =
          chapterIndex === 7
            ? compMats.valhallaRunestone
            : chapterIndex === 8
            ? compMats.atlantisMarbleOrichalcum
            : compMats.babylonLapisBrick;
        const stripMat = chapterIndex === 8 ? compMats.orichalcumMetal : compMats.solidGold;
        for (const p of this.destructiblePillars) {
          if (p.colMesh) p.colMesh.material = colMat;
          if (p.strip) p.strip.material = stripMat;
          if (p.tartarusCol) p.tartarusCol.visible = false;
        }
      }
    } else {
      waterUserData?.uDeep?.value?.setHex(0x072430);
      waterUserData?.uShallow?.value?.setHex(0x1c6c7e);
      waterUserData?.uFoam?.value?.setHex(0xdcf8ff);
      waterUserData?.uCausticColor?.value?.setRGB(0.26, 0.78, 0.92);
      waterUserData?.uSkyReflectColor?.value?.setRGB(0.42, 0.72, 0.88);
      this.shrinePedestalMat?.color?.setHex(0xd4d0c8);
      this.arenaRockMat?.color?.setHex(0xd4d0c8);
      if (this.destructiblePillars) {
        for (const p of this.destructiblePillars) {
          if (p.colMesh && p.origColMat) p.colMesh.material = p.origColMat;
          if (p.strip && p.origStripMat) p.strip.material = p.origStripMat;
          if (p.tartarusCol) p.tartarusCol.visible = true;
        }
      }
    }

    if (chapterIndex === 1) {
      // Chapter I: The Sakura Threshold (Blush Somei-Yoshino Blossoms & Dark #1367A0 Coastal Verge)
      uPetal?.setRGB(0.96, 0.68, 0.78);
      uMoss?.setHex(0x1367a0);
      if (uFrost) uFrost.value = 0.0;
      if (uMagma) uMagma.value = 0.0;
      uBladeCol?.setHex(0x1367a0);
      uBladeTip?.setHex(0x1367a0);
      uBladeEmissive?.setRGB(0.012, 0.136, 0.352);
      this.sakuraBlossomMat?.color?.setHex(0xffffff);
      this.mapleFoliageMat?.color?.setHex(0xffffff);
      this.oakFoliageMat?.color?.setHex(0xffffff);
      this.fernFoliageMat?.color?.setHex(0x1367a0);
      this.lilacFoliageMat?.color?.setHex(0xffffff);
      this.meadowMat?.color?.setHex(0xffffff);
      this.sakuraPetals?.material?.color?.setHex(0xffdfe9);
    } else if (chapterIndex === 2) {
      // Chapter II: The Crimson Autumn Sanctum (Blood-Maple & Golden Russet Highland)
      uPetal?.setRGB(0.94, 0.32, 0.14);
      uMoss?.setRGB(0.46, 0.28, 0.14);
      if (uFrost) uFrost.value = 0.0;
      if (uMagma) uMagma.value = 0.0;
      uBladeCol?.setHex(0xc85a24);
      uBladeTip?.setHex(0xe88a38);
      uBladeEmissive?.setRGB(0.18, 0.04, 0.01);
      this.sakuraBlossomMat?.color?.setHex(0xff8454);
      this.mapleFoliageMat?.color?.setHex(0xff5228);
      this.oakFoliageMat?.color?.setHex(0xffa438);
      this.fernFoliageMat?.color?.setHex(0xd88838);
      this.lilacFoliageMat?.color?.setHex(0xff8a58);
      this.meadowMat?.color?.setHex(0xffb458);
      this.sakuraPetals?.material?.color?.setHex(0xff6a32);
    } else if (chapterIndex === 3) {
      // Chapter III: The Frostbound Dragon Spire (Snow-Blanketed Flagstones & Winter Frost Sakura)
      uPetal?.setRGB(0.84, 0.94, 1.0);
      uMoss?.setRGB(0.32, 0.48, 0.62);
      if (uFrost) uFrost.value = 0.74;
      if (uMagma) uMagma.value = 0.0;
      uBladeCol?.setHex(0x6498b8);
      uBladeTip?.setHex(0xc8e8ff);
      uBladeEmissive?.setRGB(0.06, 0.18, 0.28);
      this.sakuraBlossomMat?.color?.setHex(0xd8f2ff);
      this.mapleFoliageMat?.color?.setHex(0xc8e8ff);
      this.oakFoliageMat?.color?.setHex(0xb8dcf0);
      this.fernFoliageMat?.color?.setHex(0xb4d8f2);
      this.lilacFoliageMat?.color?.setHex(0xdcf2ff);
      this.meadowMat?.color?.setHex(0xd4ecff);
      this.sakuraPetals?.material?.color?.setHex(0xe2f6ff);
    } else if (chapterIndex === 5) {
      // Chapter V: The Sunken Necropolis of Khufu-Ra (Warm Sandstone/Terracotta Floors & Red-Orange Pyramid Grass/Flora)
      uPetal?.setRGB(0.92, 0.42, 0.16);
      uMoss?.setHex(0xb83e16);
      if (uFrost) uFrost.value = 0.0;
      if (uMagma) uMagma.value = 0.0;
      uBladeCol?.setHex(0xc83e14);
      uBladeTip?.setHex(0xf06a24);
      uBladeEmissive?.setRGB(0.28, 0.045, 0.008);
      this.fernFoliageMat?.color?.setHex(0xd44618);
      this.meadowMat?.color?.setHex(0xffffff);
      this.sakuraPetals?.material?.color?.setHex(0xff7830);
    } else if (chapterIndex === 6) {
      // Chapter VI: The Hanging Gardens & Lapis Ziggurat of Babylon (Cobalt Lapis #0e4d8a, Gold & Lush Emerald-Jade Oasis Flora)
      uPetal?.setRGB(0.18, 0.86, 0.58);
      uMoss?.setHex(0x0e4d8a);
      if (uFrost) uFrost.value = 0.0;
      if (uMagma) uMagma.value = 0.0;
      uBladeCol?.setHex(0x187a52);
      uBladeTip?.setHex(0x4ce89a);
      uBladeEmissive?.setRGB(0.02, 0.22, 0.12);
      this.sakuraBlossomMat?.color?.setHex(0x52f2b8);
      this.mapleFoliageMat?.color?.setHex(0x28c884);
      this.oakFoliageMat?.color?.setHex(0x34d892);
      this.fernFoliageMat?.color?.setHex(0x1ca86c);
      this.lilacFoliageMat?.color?.setHex(0xffd258);
      this.meadowMat?.color?.setHex(0xffffff);
      this.sakuraPetals?.material?.color?.setHex(0xffd464);
    } else if (chapterIndex === 7) {
      // Chapter VII: The Norse Valhalla Fjords & Yggdrasil Great Hall (Frosted Runestone, Bifrost Cyan & Golden Yggdrasil Canopy)
      uPetal?.setRGB(0.24, 0.94, 1.0);
      uMoss?.setHex(0x1a5c7a);
      if (uFrost) uFrost.value = 0.54;
      if (uMagma) uMagma.value = 0.0;
      uBladeCol?.setHex(0x1c6e8c);
      uBladeTip?.setHex(0x58f2ff);
      uBladeEmissive?.setRGB(0.04, 0.24, 0.32);
      this.sakuraBlossomMat?.color?.setHex(0xffd86b);
      this.mapleFoliageMat?.color?.setHex(0x64f2ff);
      this.oakFoliageMat?.color?.setHex(0xf2c858);
      this.fernFoliageMat?.color?.setHex(0x48d8f0);
      this.lilacFoliageMat?.color?.setHex(0x78f6ff);
      this.meadowMat?.color?.setHex(0xe8faff);
      this.sakuraPetals?.material?.color?.setHex(0x74f6ff);
    } else if (chapterIndex === 8) {
      // Chapter VIII: The Sunken Atlantis Orichalcum Acropolis (Paros Marble, Orichalcum Gold & Bioluminescent Magenta-Coral Flora)
      uPetal?.setRGB(1.0, 0.38, 0.72);
      uMoss?.setHex(0x1367a0);
      if (uFrost) uFrost.value = 0.0;
      if (uMagma) uMagma.value = 0.0;
      uBladeCol?.setHex(0xa82468);
      uBladeTip?.setHex(0xff64b4);
      uBladeEmissive?.setRGB(0.28, 0.04, 0.18);
      this.sakuraBlossomMat?.color?.setHex(0xff68c4);
      this.mapleFoliageMat?.color?.setHex(0x38f2ff);
      this.oakFoliageMat?.color?.setHex(0xff9c38);
      this.fernFoliageMat?.color?.setHex(0xd83892);
      this.lilacFoliageMat?.color?.setHex(0x58f4ff);
      this.meadowMat?.color?.setHex(0xffffff);
      this.sakuraPetals?.material?.color?.setHex(0xff78c8);
    } else {
      // Chapter IV: The Abyssal Caldera of Reincarnation (Volcanic Obsidian Maw & Cinder Ash)
      uPetal?.setRGB(1.0, 0.34, 0.08);
      uMoss?.setRGB(0.22, 0.13, 0.12);
      if (uFrost) uFrost.value = 0.0;
      if (uMagma) uMagma.value = 0.88;
      uBladeCol?.setHex(0xa83818);
      uBladeTip?.setHex(0xd85824);
      uBladeEmissive?.setRGB(0.22, 0.03, 0.005);
      this.sakuraBlossomMat?.color?.setHex(0xff5a36);
      this.mapleFoliageMat?.color?.setHex(0xe84218);
      this.oakFoliageMat?.color?.setHex(0xc84828);
      this.fernFoliageMat?.color?.setHex(0xa8482c);
      this.lilacFoliageMat?.color?.setHex(0xd85234);
      this.meadowMat?.color?.setHex(0xd46a42);
      this.sakuraPetals?.material?.color?.setHex(0xff521b);
    }
    this.rainWeather?.setChapterWeather?.(chapterIndex);
    if (this.rainWeather?.group) {
      this.rainWeather.group.visible = !isAthenaion;
    }
    if (this.sakuraPetals) {
      this.sakuraPetals.visible = !isAthenaion;
    }
  }


  buildShrines() {
    const pedestalMaterial = createRockMaterial();
    this.shrinePedestalMat = pedestalMaterial;
    for (const sh of SHRINES) {
      const s = this.spine.getSampleAt(sh.t);
      const pos = this.spine.getWorldPos(sh.t, sh.sideOffset, 0, false);
      const group = new THREE.Group();
      group.position.copy(pos);
      group.rotation.y = Math.atan2(-s.right.x * Math.sign(sh.sideOffset), -s.right.z * Math.sign(sh.sideOffset));

      // Pedestal + Stereopolis glowing rune ring + ember core + WebGPU TSL Volumetric Fire Plume
      const baseMesh = new THREE.Mesh(
        createWeatheredRockGeometry(1.45, 0.45, { walkableTop: true, seed: sh.zone * 3 }),
        pedestalMaterial,
      );
      baseMesh.receiveShadow = true;
      group.add(baseMesh);

      const runeRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.95, 0.045, 12, 32),
        new THREE.MeshBasicMaterial({ color: 0xffb84d }),
      );
      runeRing.rotation.x = Math.PI / 2;
      runeRing.position.y = 1.65;
      group.add(runeRing);

      const coreCrystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffd280,
          emissive: 0xff8c24,
          emissiveIntensity: 2.6,
          roughness: 0.2,
        }),
      );
      coreCrystal.position.y = 1.65;
      group.add(coreCrystal);

      const shrineFlamePlume = buildVolumetricFirePlume({
        scale: 0.94,
        coreColorHex: 0xffe68c,
        midColorHex: 0xff7305,
        outerColorHex: 0xff1200,
        emberCount: 8,
      });
      shrineFlamePlume.position.y = 1.48;
      group.add(shrineFlamePlume);

      const light = new THREE.PointLight(0xff9d42, 8.5, 15, 1.5);
      light.position.set(0, 2.2, 0);
      group.add(light);

      // Register solid stone collider for the Shrine pedestal + altar + trilithon legs!
      this.addSolidCylinder({
        id: `shrine_solid_${sh.id}`,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        r: 1.42,
        h: 3.6,
        kind: 'shrine',
      });

      // Load and attach real Tartarus Trilithon & Altar GLBs into the Shrine
      Promise.all([
        loadGLTF(KIT_PATHS.tTrilithonLeg),
        loadGLTF(KIT_PATHS.tTrilithonLintel),
        loadGLTF(KIT_PATHS.tAltar),
        loadGLTF(KIT_PATHS.tBowl),
      ]).then(([legGltf, lintelGltf, altarGltf, bowlGltf]) => {
        if (legGltf?.scene) {
          const legL = legGltf.scene.clone(true);
          legL.position.set(-1.1, 0, -0.4);
          legL.scale.setScalar(0.75);
          const legR = legGltf.scene.clone(true);
          legR.position.set(1.1, 0, -0.4);
          legR.scale.setScalar(0.75);
          group.add(legL, legR);
        }
        if (lintelGltf?.scene) {
          const lintel = lintelGltf.scene.clone(true);
          lintel.position.set(0, 2.6, -0.4);
          lintel.scale.setScalar(0.65);
          group.add(lintel);
        }
        if (altarGltf?.scene) {
          const altar = altarGltf.scene.clone(true);
          altar.position.set(0, 0.25, 0);
          altar.scale.setScalar(0.65);
          group.add(altar);
        }
        if (bowlGltf?.scene) {
          const bowl = bowlGltf.scene.clone(true);
          bowl.position.set(0, 0.95, 0);
          bowl.scale.setScalar(0.7);
          group.add(bowl);
        }
      });

      this.sectorForT(sh.t).add(group);
      this.shrineObjects.push({
        ...sh,
        worldPos: pos,
        group,
        runeRing,
        coreCrystal,
        light,
        discovered: sh.zone === 1,
      });
    }
  }

  buildDestructiblePillars() {
    // 8 Destructible Stereopolis/Tartarus Pillars in Zone 5's Apex Sovereign Crater Arena (t = 0.96)
    const arenaCenter = this.spine.getWorldPos(0.96, 0, 0, false);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x2c2832,
      roughness: 0.65,
      metalness: 0.25,
    });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0xff5a26 });

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + 0.35;
      const r = 10.5;
      const px = arenaCenter.x + Math.cos(angle) * r;
      const pz = arenaCenter.z + Math.sin(angle) * r;
      const py = arenaCenter.y;

      const group = new THREE.Group();
      group.position.set(px, py, pz);

      const origColMat = pillarMat.clone();
      const colMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.92, 5.6, 8), origColMat);
      colMesh.position.y = 2.8;
      colMesh.castShadow = true;
      colMesh.receiveShadow = true;
      group.add(colMesh);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.6, 1.68), trimMat);
      strip.position.y = 2.8;
      group.add(strip);

      const pillarObj = {
        id: `pillar_${i}`,
        pos: new THREE.Vector3(px, py, pz),
        radius: 1.05,
        hp: 120,
        maxHp: 120,
        intact: true,
        group,
        colMesh,
        strip,
        origColMat,
        origStripMat: trimMat,
        tartarusCol: null,
      };

      // Also attach real Tartarus/Olympus column mesh when loaded
      loadGLTF(KIT_PATHS.tCourtCol).then((gltf) => {
        if (gltf?.scene) {
          const m = gltf.scene.clone(true);
          m.scale.setScalar(0.85);
          m.visible = !this.isEgyptianBiome;
          group.add(m);
          pillarObj.tartarusCol = m;
        }
      });

      this.sectorForT(0.96).add(group);
      this.destructiblePillars.push(pillarObj);

      // Register solid collider linked to pillarObj.intact so intact pillars block movement & projectiles!
      this.addSolidCylinder({
        id: `pillar_solid_${i}`,
        x: px,
        y: py,
        z: pz,
        r: 1.05,
        h: 5.6,
        kind: 'pillar',
        pillarRef: pillarObj,
      });
    }
  }

  buildSolidArenaCoverRocks() {
    // Sculpted Basalt Boulders & Ruined Monolith Cover Rocks placed along the trail edges & arenas
    // Every boulder is 100% solid; flat-topped boulders (walkableTop: true) can also be jumped onto!
    const rockMat = createRockMaterial();
    this.arenaRockMat = rockMat;

    const placements = [
      // Zone 1: Coastal Basalt Outcrops (tucked along trail edges so they don't block cave views)
      { t: 0.042, lat: 2.35, r: 1.1, h: 0.95, walkableTop: true },
      { t: 0.068, lat: -2.85, r: 1.15, h: 1.45, walkableTop: false },
      { t: 0.115, lat: 2.35, r: 1.1, h: 0.95, walkableTop: true },
      { t: 0.168, lat: -2.85, r: 1.25, h: 1.65, walkableTop: false },
      // Zone 2: Courtyard & Vanguard Krampus Arena Cover Monoliths
      { t: 0.242, lat: -2.4, r: 1.2, h: 1.1, walkableTop: true },
      { t: 0.345, lat: -5.4, r: 1.45, h: 3.1, walkableTop: false },
      { t: 0.348, lat: 5.4, r: 1.45, h: 3.1, walkableTop: false },
      { t: 0.376, lat: -5.2, r: 1.35, h: 1.15, walkableTop: true },
      { t: 0.378, lat: 5.2, r: 1.35, h: 2.8, walkableTop: false },
      // Zone 3: Cavern Switchback Boulders
      { t: 0.455, lat: 2.1, r: 1.15, h: 2.3, walkableTop: false },
      { t: 0.578, lat: -2.9, r: 1.25, h: 1.05, walkableTop: true },
      { t: 0.605, lat: 2.8, r: 1.3, h: 2.5, walkableTop: false },
      // Zone 4: Mirror Basin Stepping Stones & Perimeter Rocks
      { t: 0.712, lat: -7.8, r: 1.5, h: 1.0, walkableTop: true },
      { t: 0.715, lat: 7.8, r: 1.5, h: 1.0, walkableTop: true },
      { t: 0.748, lat: -8.2, r: 1.6, h: 2.9, walkableTop: false },
      { t: 0.752, lat: 8.2, r: 1.6, h: 2.9, walkableTop: false },
      // Zone 5: Sanctum Obsidian Outcrops
      { t: 0.865, lat: 2.9, r: 1.25, h: 2.6, walkableTop: false },
      { t: 0.895, lat: -2.9, r: 1.25, h: 1.1, walkableTop: true },
    ];

    placements.forEach((b, idx) => {
      const pos = this.spine.getWorldPos(b.t, b.lat, 0, false);
      const group = new THREE.Group();
      group.position.copy(pos);

      const geo = createWeatheredRockGeometry(b.r, b.h, { walkableTop: b.walkableTop, seed: idx * 1.17 });
      const mesh = new THREE.Mesh(geo, rockMat);
      mesh.name = `Weathered ${b.walkableTop ? 'stepping stone' : 'boulder'} ${idx}`;
      mesh.rotation.y = idx * 1.17;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      this.sectorForT(b.t).add(group);
      this.addSolidCylinder({
        id: `boulder_${idx}`,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        r: b.r * 0.96,
        h: b.h,
        kind: b.walkableTop ? 'boulder_step' : 'boulder',
        walkableTop: b.walkableTop,
      });
    });
  }

  damagePillar(pillar, amount, impactDir = new THREE.Vector3(0, 1, 0)) {
    if (!pillar.intact) return false;
    pillar.hp -= amount;
    pillar.colMesh.material.emissive?.setHex(0xff4518);
    pillar.colMesh.material.emissiveIntensity = 0.6 * (1 - Math.max(0, pillar.hp) / pillar.maxHp);

    if (pillar.hp <= 0) {
      pillar.intact = false;
      pillar.group.visible = false;
      // Spawn flying stone debris chunks!
      const chunkGeo = new THREE.DodecahedronGeometry(0.38, 0);
      const chunkMat = new THREE.MeshStandardMaterial({
        color: 0x342f38,
        roughness: 0.7,
        emissive: 0xff4518,
        emissiveIntensity: 0.35,
      });
      for (let k = 0; k < 14; k++) {
        const m = new THREE.Mesh(chunkGeo, chunkMat);
        m.position.copy(pillar.pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 3.8, (Math.random() - 0.5) * 1.2));
        this.scene.add(m);
        this.debrisChunks.push({
          mesh: m,
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 8 + impactDir.x * 5,
            3.5 + Math.random() * 6.5,
            (Math.random() - 0.5) * 8 + impactDir.z * 5,
          ),
          rotVel: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
          groundY: pillar.pos.y + 0.25,
          age: 0,
        });
      }
      return true;
    }
    return false;
  }

  buildGodRays() {
    // Zone 3 Cavern Roof Gaps & Zone 4 Mirror Basin Sky-Dome Shafts
    const placements = [
      { t: 0.46, lat: -1.5, h: 20, color: 0xa8dcff, rTop: 1.5, rBot: 3.6 },
      { t: 0.54, lat: 1.2, h: 22, color: 0xa8dcff, rTop: 1.8, rBot: 4.2 },
      { t: 0.61, lat: -0.8, h: 20, color: 0x9ce8ff, rTop: 1.6, rBot: 3.8 },
      { t: 0.73, lat: 0.0, h: 26, color: 0xbaf5ff, rTop: 4.5, rBot: 9.5 }, // Mirror Basin central shaft
      { t: 0.75, lat: -5.5, h: 24, color: 0x9ce8ff, rTop: 2.2, rBot: 4.8 },
    ];
    for (const p of placements) {
      const pos = this.spine.getWorldPos(p.t, p.lat, p.h * 0.45, false);
      const shaft = createGodRayShaft({
        topRadius: p.rTop,
        bottomRadius: p.rBot,
        height: p.h,
        color: p.color,
      });
      shaft.position.copy(pos);
      shaft.rotation.z = -0.18;
      shaft.rotation.x = 0.12;
      this.sectorForT(p.t).add(shaft);
      this.godRays.push(shaft);
    }
  }

  async populateKitbashGLBs() {
    // Solid radius & arch pier offsets for placed GLBs so nothing can be walked through
    const ARCH_PIER_SPECS = {
      tBlackArch: { pierOffset: 2.65, pierRadius: 1.05 },
      tSurArch: { pierOffset: 2.55, pierRadius: 1.0 },
      tCourtArch: { pierOffset: 2.85, pierRadius: 1.1 },
      tMineArch: { pierOffset: 2.45, pierRadius: 0.95 },
      pOlympusArch: { pierOffset: 2.75, pierRadius: 1.05 },
    };
    const PROP_SOLID_RADIUS = {
      pRock1: 1.65,
      pRock4: 1.75,
      pSpruce1: 0.95,
      pBrokenTree: 1.15,
      pFence: 1.25,
      tStalagmite: 1.15,
    };
    // Target world-space max dimension / height (meters) at scaleVal = 1.0 so heterogeneously exported GLBs match human scale
    const TARGET_GLB_SPAN = {
      tBlackArch: { maxW: 6.4, maxH: 5.4 },
      tSurArch: { maxW: 6.2, maxH: 5.2 },
      tCourtArch: { maxW: 6.6, maxH: 5.6 },
      tMineArch: { maxW: 6.0, maxH: 5.0 },
      pOlympusArch: { maxW: 6.8, maxH: 5.8 },
      tRockWall: { maxW: 4.6, maxH: 4.2 },
      pRock1: { maxW: 2.6, maxH: 2.1 },
      pRock4: { maxW: 2.8, maxH: 2.3 },
    };

    const placeGLB = async (key, t, lat, dy, yawOffset = 0, scaleVal = 1.0, isBranch = false) => {
      const s = isBranch ? this.spine.getBranchSampleAt(t) : this.spine.getSampleAt(t);
      const pos = this.spine.getWorldPos(t, lat, dy, isBranch);
      const worldYaw = Math.atan2(s.flatTangent.x, s.flatTangent.z) + yawOffset;

      // Immediately register synchronous solid colliders for arches, rocks, fences, stalagmites & trees!
      let registeredObs = null;
      if (ARCH_PIER_SPECS[key]) {
        const spec = ARCH_PIER_SPECS[key];
        const pierDist = spec.pierOffset * scaleVal;
        const pierR = spec.pierRadius * scaleVal;
        for (const side of [-1, 1]) {
          this.addSolidCylinder({
            id: `arch_${key}_${t.toFixed(3)}_${side}`,
            x: pos.x + s.right.x * side * pierDist,
            y: s.point.y,
            z: pos.z + s.right.z * side * pierDist,
            r: pierR,
            h: 6.5,
            kind: 'arch_pier',
          });
        }
      } else if (key === 'pFence') {
        this.addSolidOBB({
          id: `fence_${t.toFixed(3)}_${lat.toFixed(1)}`,
          x: pos.x,
          y: s.point.y,
          z: pos.z,
          hx: 0.45 * scaleVal,
          hz: 1.85 * scaleVal,
          yaw: Math.atan2(s.flatTangent.x, s.flatTangent.z),
          h: 2.4,
          kind: 'fence',
        });
      } else if (PROP_SOLID_RADIUS[key]) {
        registeredObs = this.addSolidCylinder({
          id: `prop_${key}_${t.toFixed(3)}_${lat.toFixed(1)}`,
          x: pos.x,
          y: s.point.y,
          z: pos.z,
          r: PROP_SOLID_RADIUS[key] * scaleVal,
          h: 5.0,
          kind: key,
        });
      }

      const gltf = await loadGLTF(KIT_PATHS[key]);
      if (!gltf?.scene) return;
      const clone = gltf.scene.clone(true);
      normalizeModelMaterials(clone);
      clone.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      // Center and scale-normalize GLB assets on their local geometry bounding box so raw GLB offsets/scales never misplace them
      let nodeToPlace = clone;
      let effScale = scaleVal;
      clone.updateMatrixWorld(true);
      let localBox = new THREE.Box3().setFromObject(clone);
      if (!localBox.isEmpty()) {
        let sx = localBox.max.x - localBox.min.x;
        let sz = localBox.max.z - localBox.min.z;
        if ((ARCH_PIER_SPECS[key] || key === 'tRockWall') && sz > sx * 1.35) {
          clone.rotation.y = Math.PI / 2;
          clone.updateMatrixWorld(true);
          localBox = new THREE.Box3().setFromObject(clone);
          sx = localBox.max.x - localBox.min.x;
          sz = localBox.max.z - localBox.min.z;
        }
        const sy = localBox.max.y - localBox.min.y;
        const targetSpec = TARGET_GLB_SPAN[key];
        if (targetSpec) {
          const spanHorizontal = Math.max(sx, sz, 0.1);
          const normFactor = Math.min(targetSpec.maxW / spanHorizontal, targetSpec.maxH / Math.max(sy, 0.1));
          effScale = scaleVal * normFactor;
        }
        const lcx = (localBox.min.x + localBox.max.x) * 0.5;
        const lcz = (localBox.min.z + localBox.max.z) * 0.5;
        clone.position.set(-lcx, -localBox.min.y, -lcz);
        const wrapper = new THREE.Group();
        wrapper.add(clone);
        nodeToPlace = wrapper;
      }

      nodeToPlace.position.copy(pos);
      nodeToPlace.rotation.y = worldYaw;
      nodeToPlace.scale.setScalar(effScale);
      if (key !== 'tTorch') {
        nodeToPlace.visible = !this.isEgyptianBiome;
        this.nonEgyptianProps.push(nodeToPlace);
      }
      if (isBranch) this.branchGroup.add(nodeToPlace);
      else this.sectorForT(t).add(nodeToPlace);

      // Refine rock/prop collider center & radius from actual loaded mesh bounding box
      if (registeredObs) {
        nodeToPlace.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(nodeToPlace);
        if (!box.isEmpty()) {
          const cx = (box.min.x + box.max.x) * 0.5;
          const cz = (box.min.z + box.max.z) * 0.5;
          const rx = (box.max.x - box.min.x) * 0.42;
          const rz = (box.max.z - box.min.z) * 0.42;
          const measuredR = Math.max(0.65, Math.min(2.4, (rx + rz) * 0.5));
          registeredObs.x = cx;
          registeredObs.z = cz;
          registeredObs.r = measuredR;
        }
      }
    };

    // Build shared Carved Stone Arch Doorway & Recessed Dark Cave Tunnel geometries
    const outerArchShape = new THREE.Shape();
    outerArchShape.moveTo(-2.35, 0);
    outerArchShape.lineTo(-2.35, 2.35);
    outerArchShape.absarc(0, 2.35, 2.35, Math.PI, 0, true);
    outerArchShape.lineTo(2.35, 0);
    outerArchShape.lineTo(1.52, 0);
    outerArchShape.lineTo(1.52, 2.25);
    outerArchShape.absarc(0, 2.25, 1.52, 0, Math.PI, false);
    outerArchShape.lineTo(-1.52, 0);
    outerArchShape.closePath();

    const stoneArchFrameGeo = new THREE.ExtrudeGeometry(outerArchShape, {
      depth: 0.95,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.08,
      bevelThickness: 0.08,
    });
    stoneArchFrameGeo.translate(0, 0, -0.45);
    const stoneArchFrameMat = new THREE.MeshStandardMaterial({
      color: 0x484d58,
      roughness: 0.72,
      metalness: 0.16,
    });

    const innerPortalShape = new THREE.Shape();
    innerPortalShape.moveTo(-1.54, 0);
    innerPortalShape.lineTo(-1.54, 2.25);
    innerPortalShape.absarc(0, 2.25, 1.54, Math.PI, 0, true);
    innerPortalShape.lineTo(1.54, 0);
    innerPortalShape.closePath();

    const cavePortalGeo = new THREE.ExtrudeGeometry(innerPortalShape, {
      depth: 1.4,
      bevelEnabled: false,
    });
    cavePortalGeo.translate(0, 0, -1.65);
    const cavePortalMat = new THREE.MeshBasicMaterial({
      color: 0x030408,
    });
    const caveThresholdGeo = new THREE.BoxGeometry(4.9, 0.28, 2.1);
    const caveThresholdMat = new THREE.MeshStandardMaterial({
      color: 0x343842,
      roughness: 0.82,
      metalness: 0.14,
    });

    // Helper: Build a complete Recessed Cave Entrance in the cliff wall with its Stone Arch Doorway
    const placeCaveEntrance = (archKey, t, side, scaleVal = 1.12, isBranch = false) => {
      const s = isBranch ? this.spine.getBranchSampleAt(t) : this.spine.getSampleAt(t);
      const hw = s.halfWidth;
      const inwardYaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      const worldYaw = Math.atan2(s.flatTangent.x, s.flatTangent.z) + inwardYaw;

      // 1. Recessed dark cave portal + carved stone arch frame + threshold co-axially mounted in one caveGroup
      const portalPos = this.spine.getWorldPos(t, side * (hw + 1.45), -0.15, isBranch);
      const caveGroup = new THREE.Group();
      caveGroup.position.copy(portalPos);
      caveGroup.rotation.y = worldYaw;
      caveGroup.scale.setScalar(scaleVal);
      caveGroup.visible = !this.isEgyptianBiome;
      this.nonEgyptianProps.push(caveGroup);

      const darkVoid = new THREE.Mesh(cavePortalGeo, cavePortalMat);
      caveGroup.add(darkVoid);

      const carvedArchFrame = new THREE.Mesh(stoneArchFrameGeo, stoneArchFrameMat);
      carvedArchFrame.castShadow = true;
      carvedArchFrame.receiveShadow = true;
      caveGroup.add(carvedArchFrame);

      const threshold = new THREE.Mesh(caveThresholdGeo, caveThresholdMat);
      threshold.position.set(0, 0.12, 0.05);
      threshold.receiveShadow = true;
      caveGroup.add(threshold);

      // Warm flickering amber torch glow illuminating the stone arch jambs and threshold
      const caveLight = new THREE.PointLight(0xff8a36, 5.5, 11.0, 1.5);
      caveLight.position.set(0, 2.5, 0.75);
      caveGroup.add(caveLight);

      if (isBranch) this.branchGroup.add(caveGroup);
      else this.sectorForT(t).add(caveGroup);

      // Register solid arch piers around the cave doorway
      const pierDist = 2.05 * scaleVal;
      const pierR = 0.85 * scaleVal;
      for (const pierSide of [-1, 1]) {
        this.addSolidCylinder({
          id: `cave_arch_${archKey}_${t.toFixed(3)}_${pierSide}`,
          x: portalPos.x + s.flatTangent.x * pierSide * pierDist,
          y: s.point.y,
          z: portalPos.z + s.flatTangent.z * pierSide * pierDist,
          r: pierR,
          h: 6.5,
          kind: 'arch_pier',
        });
      }

      // 2. Load, normalize scale, and coaxially center the Kitbash Stone Arch right over the cave doorway
      loadGLTF(KIT_PATHS[archKey]).then((gltf) => {
        if (!gltf?.scene) return;
        const archClone = gltf.scene.clone(true);
        normalizeModelMaterials(archClone);
        archClone.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        archClone.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(archClone);
        if (!box.isEmpty()) {
          let sx = box.max.x - box.min.x;
          let sz = box.max.z - box.min.z;
          if (sz > sx * 1.35) {
            archClone.rotation.y = Math.PI / 2;
            archClone.updateMatrixWorld(true);
            box = new THREE.Box3().setFromObject(archClone);
            sx = box.max.x - box.min.x;
            sz = box.max.z - box.min.z;
          }
          const sy = box.max.y - box.min.y;
          const normScale = Math.min(5.2 / Math.max(0.1, sx), 4.8 / Math.max(0.1, sy));
          archClone.scale.setScalar(normScale);
          const cx = (box.min.x + box.max.x) * 0.5;
          const cz = (box.min.z + box.max.z) * 0.5;
          archClone.position.set(-cx * normScale, -box.min.y * normScale, -cz * normScale + 0.15);
        }
        caveGroup.add(archClone);
      });

      // 3. Embed normalized flanking Rock Wall wings & boulders around the arch so cliff wall + arch form one cave entrance
      placeGLB('tRockWall', t, side * (hw + 2.85), -0.25, inwardYaw, scaleVal * 0.92, isBranch);
      placeGLB(side < 0 ? 'pRock1' : 'pRock4', t - 0.008, side * (hw + 2.45), -0.2, inwardYaw + 0.25, scaleVal, isBranch);
      placeGLB(side < 0 ? 'pRock4' : 'pRock1', t + 0.008, side * (hw + 2.45), -0.2, inwardYaw - 0.25, scaleVal, isBranch);
      placeGLB('tTorch', t - 0.004, side * (hw + 1.15), 1.65, inwardYaw, 0.95, isBranch);
    };

    // Helper: Build a Trail Tunnel Gateway Arch seamlessly connected to left & right Cliff Rock Walls
    const placeGatewayArchWithWalls = (archKey, t, scaleVal = 1.2) => {
      const hw = this.spine.getSampleAt(t).halfWidth;
      placeGLB(archKey, t, 0, -0.2, 0, scaleVal);
      placeGLB('tRockWall', t, -(hw + 2.35), -0.25, Math.PI / 2, scaleVal * 0.95);
      placeGLB('tRockWall', t, hw + 2.35, -0.25, -Math.PI / 2, scaleVal * 0.95);
      placeGLB('pRock1', t, -(hw + 2.65), -0.2, 0.35, scaleVal);
      placeGLB('pRock4', t, hw + 2.65, -0.2, -0.35, scaleVal);
    };

    // Zone 1: Cliffside Cave Entrances with Integrated Stone Arch Doorways (fixes bare rock walls & misplaced arches!)
    placeCaveEntrance('tBlackArch', 0.045, -1, 1.12);
    placeCaveEntrance('tSurArch', 0.085, 1, 1.12);
    placeCaveEntrance('tBlackArch', 0.125, -1, 1.15);
    placeCaveEntrance('tMineArch', 0.165, 1, 1.18);
    placeGatewayArchWithWalls('tBlackArch', 0.195, 1.18);

    // Zone 2 Left Branch ("Wandering Wight" Clearing): Totems, Cave Alcove & Broken Olympus Pillars (100% Solid!)
    placeCaveEntrance('tSurArch', 0.55, -1, 1.12, true);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const c = this.spine.getBranchSampleAt(0.82).point;
      const tx = c.x + Math.cos(angle) * 10.8;
      const tz = c.z + Math.sin(angle) * 10.8;
      this.addSolidCylinder({
        id: `branch_totem_${i}`,
        x: tx,
        y: c.y,
        z: tz,
        r: 1.05,
        h: 5.5,
        kind: 'totem_pillar',
      });
      loadGLTF(i % 2 === 0 ? KIT_PATHS.tTotem : KIT_PATHS.pOlympusCol).then((gltf) => {
        if (!gltf?.scene) return;
        const m = gltf.scene.clone(true);
        normalizeModelMaterials(m);
        m.position.set(tx, c.y, tz);
        m.rotation.y = -angle;
        m.scale.setScalar(i % 2 === 0 ? 1.25 : 0.95);
        m.visible = !this.isEgyptianBiome;
        this.nonEgyptianProps.push(m);
        this.branchGroup.add(m);
      });
    }

    // Zone 2 Right Branch (Courtyard): Arched Cave Entrances in Courtyard Walls, Scaffolding & Lanterns
    placeCaveEntrance('tSurArch', 0.255, -1, 1.14);
    placeCaveEntrance('tCourtArch', 0.315, 1, 0.98);
    placeCaveEntrance('tBlackArch', 0.365, -1, 1.14);
    placeGatewayArchWithWalls('tBlackArch', 0.405, 1.22);
    for (const t of [0.27, 0.33, 0.35, 0.38]) {
      const hw = this.spine.getSampleAt(t).halfWidth;
      placeGLB('pFence', t, -(hw + 0.5), 0, Math.PI / 2, 1.2);
      placeGLB('pFence', t, hw + 0.5, 0, -Math.PI / 2, 1.2);
      placeGLB('pLantern', t, -(hw + 0.4), 2.8, 0, 1.0);
    }

    // Zone 3: The Serpent's Ascent — Mine Tunnel Cave Entrances, Stalagmites & Chasm Gateways
    placeGatewayArchWithWalls('tMineArch', 0.45, 1.32);
    placeCaveEntrance('tMineArch', 0.468, 1, 1.18);
    placeGatewayArchWithWalls('tMineArch', 0.56, 1.32);
    placeCaveEntrance('tSurArch', 0.59, -1, 1.15);
    placeGatewayArchWithWalls('tSurArch', 0.625, 1.18);
    for (const t of [0.44, 0.48, 0.55, 0.58, 0.61]) {
      const hw = this.spine.getSampleAt(t).halfWidth;
      placeGLB('tStalagmite', t, -(hw + 1.4), -0.2, 0.3, 1.2);
      placeGLB('tStalagmite', t, hw + 1.4, -0.2, -0.5, 1.25);
    }

    // Zone 4: The Mirror Basin — Ring of Weathered Olympus Columns & Perimeter Cave Entrances
    const basinCenter = this.spine.getSampleAt(0.73).point;
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + 0.15;
      const r = 14.2;
      const cx = basinCenter.x + Math.cos(angle) * r;
      const cz = basinCenter.z + Math.sin(angle) * r;
      this.addSolidCylinder({
        id: `basin_col_${i}`,
        x: cx,
        y: basinCenter.y,
        z: cz,
        r: 1.12,
        h: 6.5,
        kind: 'column',
      });
      loadGLTF(i % 2 === 0 ? KIT_PATHS.pOlympusCol : KIT_PATHS.tBlackCol).then((gltf) => {
        if (!gltf?.scene) return;
        const m = gltf.scene.clone(true);
        normalizeModelMaterials(m);
        m.position.set(cx, basinCenter.y - 0.2, cz);
        m.rotation.y = -angle;
        m.scale.setScalar(1.15);
        m.visible = !this.isEgyptianBiome;
        this.nonEgyptianProps.push(m);
        this.sectorForT(0.73).add(m);
      });
    }
    placeGatewayArchWithWalls('pOlympusArch', 0.67, 1.42);
    placeGatewayArchWithWalls('tBlackArch', 0.79, 1.22);

    // Zone 5: The Sanctum of Tartarus — Obsidian Cave Portals, Hanging Chains & Lava Rings
    placeGatewayArchWithWalls('tCourtArch', 0.85, 1.05);
    placeCaveEntrance('tBlackArch', 0.88, -1, 1.15);
    placeCaveEntrance('tSurArch', 0.88, 1, 1.15);
    placeGatewayArchWithWalls('tCourtArch', 0.91, 1.08);
    placeGLB('tLavaRing', 0.96, 0, 0.05, 0, 0.85);
    for (const t of [0.84, 0.87, 0.90, 0.93]) {
      const hw = this.spine.getSampleAt(t).halfWidth;
      placeGLB('tCourtChain', t, -(hw + 1.2), 4.5, 0.2, 1.0);
      placeGLB('tCourtChain', t, hw + 1.2, 4.5, -0.2, 1.0);
    }
  }

  /**
   * Spline-Driven Sector Culling (Section 6 of Conceptual Plan):
   * Only keeps geometry active for [t - 0.15, t + 0.21] (plus branch when near Zone 2 fork).
   */
  update(dt, playerLoc) {
    this.windTime += dt;

    for (const pool of this.waterPools) {
      pool.update(dt);
    }

    // Continuous ambient raindrop ripples across interactive rain puddles & basins
    this._rainRippleAcc = (this._rainRippleAcc || 0) + dt;
    if (this._rainRippleAcc >= 0.08 && this.waterPools.length > 0) {
      this._rainRippleAcc = 0;
      const pool = this.waterPools[this._rainPoolIdx % this.waterPools.length];
      this._rainPoolIdx = ((this._rainPoolIdx || 0) + 1) % this.waterPools.length;
      const a = Math.sin(this.windTime * 13.7 + this._rainPoolIdx) * Math.PI * 2;
      const r = (0.15 + Math.abs(Math.cos(this.windTime * 7.3 + this._rainPoolIdx)) * 0.72) * pool.radius;
      pool.injectRipple(pool.center.x + Math.cos(a) * r, pool.center.z + Math.sin(a) * r, 0.42);
    }

    for (const sh of this.shrineObjects) {
      sh.runeRing.rotation.z += dt * 0.8;
      sh.coreCrystal.rotation.y += dt * 1.4;
      sh.coreCrystal.position.y = 1.65 + Math.sin(this.windTime * 2.5 + sh.zone) * 0.08;
      sh.light.intensity = 7.8 + Math.sin(this.windTime * 7.3 + sh.zone * 2) * 1.1;
    }

    if (this.ascensionPortal) {
      this.ascensionPortal.outerRing.rotation.z += dt * 0.95;
      this.ascensionPortal.innerRing.rotation.z -= dt * 1.45;
      this.ascensionPortal.riftCore.material.opacity = 0.36 + Math.sin(this.windTime * 3.2) * 0.14;
      this.ascensionPortal.light.intensity = 11.0 + Math.sin(this.windTime * 5.4) * 2.2;
    }

    // Update flying debris chunks from shattered pillars
    for (let i = this.debrisChunks.length - 1; i >= 0; i--) {
      const c = this.debrisChunks[i];
      c.age += dt;
      if (c.mesh.position.y > c.groundY) {
        c.vel.y -= 16 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.rotVel.x * dt;
        c.mesh.rotation.y += c.rotVel.y * dt;
        if (c.mesh.position.y <= c.groundY) {
          c.mesh.position.y = c.groundY;
          c.vel.multiplyScalar(0.25);
        }
      }
      if (c.age > 12) {
        this.scene.remove(c.mesh);
        this.debrisChunks.splice(i, 1);
      }
    }

    // Sector Culling along t ∈ [0, 1]
    const pt = playerLoc.isBranch ? 0.225 : playerLoc.t;
    const isMonumentalOutdoors = this.isMonumentalBiome && !playerLoc.isBranch && pt < 0.238;
    if (this.mainRibbon?.geometry) {
      this.mainRibbon.visible = !this.isAthenaionBiome;
      // When outdoors in Giza / Babylon / Valhalla / Atlantis, only draw the outdoor processional trail up to the Threshold Portal (i <= 156)
      this.mainRibbon.geometry.setDrawRange(0, isMonumentalOutdoors ? 156 * 6 * 6 : Infinity);
    }
    if (this.branchRibbon) {
      this.branchRibbon.visible = !this.isAthenaionBiome;
    }
    if (this.ascensionPortal?.group) {
      this.ascensionPortal.group.visible = !isMonumentalOutdoors && !this.isAthenaionBiome;
    }
    for (const sec of this.sectors) {
      if (this.isAthenaionBiome) {
        sec.group.visible = false;
      } else {
        const visible = isMonumentalOutdoors
          ? sec.tMin < 0.25
          : sec.tMax >= pt - 0.16 && sec.tMin <= pt + 0.22;
        sec.group.visible = visible;
      }
    }
    this.branchGroup.visible = !this.isAthenaionBiome && !isMonumentalOutdoors && (playerLoc.isBranch || (pt >= 0.12 && pt <= 0.38));
    const sample = playerLoc.sample?.point || this.spine.getSampleAt(pt).point;
    const focusPos = playerLoc.worldPos || sample;
    this.meadowMat?.userData?.uPlayerPos?.value?.copy(focusPos);
    this.rainWeather?.update?.(dt, focusPos);
    this.localLightPool?.update(dt, sample);
    if (this.isEgyptianBiome && this.egyptianBiome?.update) {
      this.egyptianBiome.update(dt, this.windTime, playerLoc);
    }
    if (this.activeComplementaryBiome?.update) {
      this.activeComplementaryBiome.update(dt, this.windTime, playerLoc);
    }
    if (this.isAthenaionBiome && this.athenaionBiome?.update) {
      this.athenaionBiome.update(dt, this.windTime, focusPos);
    }
  }
}
