// Chapter IX: The Sacred Island of Athenaion — Biome Orchestrator, Walkable Height Sampler,
// 96m Spatial Cell Chunker/Streamer, Docked Trireme "The Pallas" & Collision Bridge.
import * as THREE from 'three';
import { RNG } from '../athenaion/core/rng.js';
import { Footprints } from '../athenaion/core/footprints.js';
import { proceduralMaterial } from '../athenaion/core/materials.js';
import { GeoBuilder } from '../athenaion/city/geobuilder.js';
import { buildShip, shipMatrix } from '../athenaion/city/ships.js';
import { shipWoodMaterial, sailMaterial, WOOD_ATTRS, SAIL_ATTRS } from '../athenaion/city/shipmats.js';
import * as L from '../athenaion/world/layout.js';
import { heightAt } from '../athenaion/world/heightfield.js';

import * as terrainMod from '../athenaion/modules/terrain.js';
import * as waterMod from '../athenaion/modules/water.js';
import * as templeMod from '../athenaion/modules/temple.js';
import * as acropolisMod from '../athenaion/modules/acropolis.js';
import * as aqueductsMod from '../athenaion/modules/aqueducts.js';
import * as setsMod from '../athenaion/modules/sets.js';
import * as statuesMod from '../athenaion/modules/statues.js';
import * as cityMod from '../athenaion/modules/city.js';
import * as ruinsMod from '../athenaion/modules/ruins.js';
import * as bannersMod from '../athenaion/modules/banners.js';
import * as vegetationMod from '../athenaion/modules/vegetation.js';
import * as floraMod from '../athenaion/modules/flora.js';
import * as waterfallsMod from '../athenaion/modules/waterfalls.js';
import * as birdsMod from '../athenaion/modules/birds.js';

const STEP = 0.85;
export const ATHENA_SHIP = { x: 30, z: 109.6, rotY: Math.PI / 2, seed: 0.41, quayEdge: 102.2 };

// Live reference to the active Athenaion engine registry + trireme for exact runtime `supports(x, z)`
let _activeRegistry = null;
let _activeShip = null;
let _activeGangway = null;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function projectOntoSegment2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz || 1;
  const t = clamp01(((px - ax) * dx + (pz - az) * dz) / lenSq);
  const cx = ax + dx * t;
  const cz = az + dz * t;
  const dist = Math.hypot(px - cx, pz - cz);
  return { t, dist, cx, cz };
}

/**
 * Builds the docked Athenian trireme "The Pallas" at the foot of the Grand Staircase quay.
 */
export function buildDockedTrireme({ x, z, rotY, seed = 0.41, quayEdge = 102.2 } = ATHENA_SHIP) {
  const wood = new GeoBuilder(WOOD_ATTRS);
  const sail = new GeoBuilder(SAIL_ATTRS);
  const { L: shipL, B: shipB } = buildShip(
    wood,
    sail,
    shipMatrix(x, 0.02, z, rotY),
    { type: 'trireme', seed, sailState: 'furled', oarCount: 22, oarsOut: true },
    new RNG('athena-trireme'),
  );
  const group = new THREE.Group();
  group.name = 'The Pallas · Athenian trireme';
  const hull = new THREE.Mesh(wood.toGeometry(), shipWoodMaterial());
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);
  if (!sail.empty) {
    const s = new THREE.Mesh(sail.toGeometry(), sailMaterial());
    s.castShadow = true;
    group.add(s);
  }
  const deckAt = (lz) => {
    const e = Math.max(-1, Math.min(1, (2 * lz) / shipL));
    return 0.02 + 1.3 + (e > 0 ? 1.1 : 2.2) * Math.pow(Math.abs(e), 2.2) - 0.4;
  };
  const halfW = (lz) =>
    (shipB / 2) * Math.pow(Math.max(0.001, Math.sin(Math.PI * (lz / shipL + 0.5))), 0.32) * 0.93 - 0.25;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const local = (px, pz) => {
    const dx = px - x;
    const dz = pz - z;
    return { lx: dx * c - dz * s, lz: dx * s + dz * c };
  };
  const sternZ = -0.39 * shipL;
  const at = (lx, lz) => ({ x: x + lx * c + lz * s, z: z - lx * s + lz * c });
  const sternW = at(0, sternZ);
  const gangway = {
    x: sternW.x,
    z0: quayEdge - 0.6,
    z1: z - (halfW(sternZ) + 0.25) + 0.6,
    y: deckAt(sternZ),
  };
  {
    const len = gangway.z1 - gangway.z0;
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.14, len),
      new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.85 }),
    );
    plank.position.set(gangway.x, (2 + gangway.y) / 2 - 0.06, (gangway.z0 + gangway.z1) / 2);
    plank.rotation.x = -Math.atan2(gangway.y - 2, len);
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(plank);
  }
  return {
    group,
    L: shipL,
    B: shipB,
    sternZ,
    at,
    halfWidth: (lz) => halfW(lz) + 0.25,
    deckAt,
    deckFloor(px, pz) {
      const { lx, lz } = local(px, pz);
      if (Math.abs(lz) > shipL / 2 - 2.2) return null;
      return Math.abs(lx) <= halfW(lz) ? deckAt(lz) : null;
    },
    deckY: deckAt(0),
    gangway,
  };
}

/**
 * Continuous walkable elevation sampler for Chapter IX (The Sacred Island of Athenaion).
 * Uses `engine.registry`'s exact measured supports (Grand Staircase `GS.x = 28`, Podium + Podium Stair,
 * Parthenon Stylobate, Island Bridge, Docked Trireme & Gangway) with analytical fallbacks.
 */
export function getAthenaionFloorY(x, z, currentY = null) {
  const feet = typeof currentY === 'number' && Number.isFinite(currentY) ? currentY : Infinity;
  const baseH = heightAt(x, z);
  const supports = [Math.max(baseH, -0.35)];

  const R = _activeRegistry;
  const A = R?.acropolis;
  const GS = L.GRAND_STAIR;
  const stairSegs = A?.stair?.segs || [];
  const P = A?.podium;
  const T = R?.temple?.main;
  const bridge = R?.islandBridge;

  // 1. Measured Grand Staircase (`GS.x = 28`, `z` from -10 to 93.2, `y` from 54.3 down to 2.0)
  if (stairSegs.length > 0 && typeof A?.surface === 'function') {
    for (const s of stairSegs) {
      if (z >= s.z0 && z <= s.z1 && Math.abs(x - GS.x) <= s.w / 2 + 1.0) {
        supports.push(A.surface(z));
        break;
      }
    }
  } else if (Math.abs(x - 28.0) <= 10.0 && z >= -10.0 && z <= 94.0) {
    // Analytical fallback before `acropolis` module finishes building
    const t = clamp01((93.2 - z) / (93.2 - -10.0));
    supports.push(2.0 + t * 52.3);
  }

  // 2. Measured Acropolis Podium & Podium South Staircase
  if (P) {
    if (x >= P.x0 && x <= P.x1 && z >= P.zN && z <= P.zS) {
      supports.push(P.top);
    }
    if (x >= P.stairX0 - 0.8 && x <= P.stairX1 + 0.8 && z <= P.stairFootZ && z >= P.zS) {
      supports.push(P.top + ((54.3 - P.top) * (z - P.zS)) / (P.stairFootZ - P.zS));
    }
  } else if (x >= -0.5 && x <= 40.5 && z >= -103.6 && z <= -12.0) {
    if (z <= -23.0) {
      supports.push(66.0);
    } else if (x >= 11.0 && x <= 29.0) {
      const tStair = clamp01((-12.0 - z) / 11.0);
      supports.push(54.3 + tStair * 11.7);
    }
  }

  // 3. Measured Parthenon / Athenaion Stylobate & 3-Step Crepidoma
  if (T) {
    const hw = T.W / 2;
    const hl = T.L / 2;
    const dx = Math.abs(x - T.position[0]);
    const dz = Math.abs(z - T.position[2]);
    if (dx <= hw && dz <= hl) {
      supports.push(T.stylobateTop);
    } else if (dx <= hw + 2.4 && dz <= hl + 2.4) {
      const pTop = P?.top ?? 66.0;
      supports.push(T.stylobateTop - (Math.max(dx - hw, dz - hl) / 2.4) * (T.stylobateTop - pTop));
    }
  } else if (x >= 2.0 && x <= 38.0 && z >= -98.0 && z <= -26.0) {
    supports.push(67.5);
  }

  // 4. Measured Arched Island Bridge to the Island Tholos
  if (bridge && typeof bridge.surf === 'function') {
    const dx = x - bridge.A[0];
    const dz = z - bridge.A[2];
    const t = dx * bridge.u[0] + dz * bridge.u[1];
    const d = dx * bridge.n[0] + dz * bridge.n[1];
    if (t >= 0 && t <= bridge.len && Math.abs(d) <= bridge.W / 2) {
      supports.push(bridge.surf(t));
    }
  } else {
    const seg = projectOntoSegment2D(x, z, 2, 97, -3, 118);
    if (seg.dist <= 4.5) {
      supports.push(2.2 + 5.4 * seg.t + 1.5 * Math.sin(Math.PI * seg.t));
    }
  }

  // 5. Island Tholos Stylobate (`[-3, 128]` / `[-14, 128]`)
  if (R?.temple?.island) {
    const [cx, cy, cz] = R.temple.island.center;
    if (Math.hypot(x - cx, z - cz) <= 14.5) {
      supports.push(cy + 0.45);
    }
  }

  // 6. Docked Trireme "The Pallas" & Boarding Gangway
  if (_activeShip) {
    const deck = _activeShip.deckFloor(x, z);
    if (deck != null) supports.push(deck);
  }
  if (_activeGangway) {
    const g = _activeGangway;
    if (Math.abs(x - g.x) <= 1.25 && z >= g.z0 && z <= g.z1) {
      supports.push(2.0 + ((g.y - 2.0) * (z - g.z0)) / (g.z1 - g.z0));
    }
  }

  // 7. Eastern Stone Causeway from Lagoon Quay (`[36, 98]`) to Ruins Terrace (`[116, 156]`)
  {
    const seg = projectOntoSegment2D(x, z, 36, 98, 116, 156);
    if (seg.dist <= 5.5) {
      const h0 = heightAt(36, 98);
      const h1 = heightAt(116, 156);
      const causewayY = h0 + (h1 - h0) * seg.t;
      supports.push(causewayY);
    }
  }

  let best = -Infinity;
  for (const y of supports) {
    if (Number.isFinite(y) && y > best) best = y;
  }
  return best > -Infinity ? best : 0;
}

// -----------------------------------------------------------------------------
// 96m Spatial Cell Chunker (`splitMeshByCells`, `splitInstancedByCells`, `chunkWorld`)
// Splits island-spanning merged/instanced meshes into 96m cells for frustum + distance culling.
// -----------------------------------------------------------------------------
const keyOf = (x, z, cell) => Math.floor(x / cell) + ':' + Math.floor(z / cell);

function splitMeshByCells(mesh, cell = 96) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  if (!pos) return null;
  const triCount = (idx ? idx.count : pos.count) / 3;
  const m = mesh.matrixWorld.elements;
  const buckets = new Map();
  const v = (i) => (idx ? idx.getX(i) : i);
  for (let t = 0; t < triCount; t++) {
    let x = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      const i = v(t * 3 + k);
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      x += m[0] * px + m[4] * py + m[8] * pz + m[12];
      z += m[2] * px + m[6] * py + m[10] * pz + m[14];
    }
    const key = keyOf(x / 3, z / 3, cell);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(t);
  }
  if (buckets.size < 2) return null;
  const out = [];
  for (const tris of buckets.values()) {
    const sub = new THREE.BufferGeometry();
    if (idx) {
      const remap = new Map();
      const order = [];
      const ind = new Uint32Array(tris.length * 3);
      let n = 0;
      for (const t of tris) {
        for (let k = 0; k < 3; k++) {
          const i = idx.getX(t * 3 + k);
          let j = remap.get(i);
          if (j === undefined) {
            j = order.length;
            remap.set(i, j);
            order.push(i);
          }
          ind[n++] = j;
        }
      }
      for (const [name, a] of Object.entries(g.attributes)) {
        const arr = new a.array.constructor(order.length * a.itemSize);
        for (let j = 0; j < order.length; j++) {
          for (let c = 0; c < a.itemSize; c++) {
            arr[j * a.itemSize + c] = a.array[order[j] * a.itemSize + c];
          }
        }
        sub.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
      }
      sub.setIndex(new THREE.BufferAttribute(order.length > 65535 ? ind : Uint16Array.from(ind), 1));
    } else {
      for (const [name, a] of Object.entries(g.attributes)) {
        const arr = new a.array.constructor(tris.length * 3 * a.itemSize);
        let o = 0;
        for (const t of tris) {
          for (let k = 0; k < 3; k++) {
            for (let c = 0; c < a.itemSize; c++) {
              arr[o++] = a.array[(t * 3 + k) * a.itemSize + c];
            }
          }
        }
        sub.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
      }
    }
    sub.computeBoundingSphere();
    const c = new THREE.Mesh(sub, mesh.material);
    c.name = mesh.name + ':cell';
    c.castShadow = mesh.castShadow;
    c.receiveShadow = mesh.receiveShadow;
    c.renderOrder = mesh.renderOrder;
    Object.assign(c.userData, mesh.userData);
    mesh.matrix.decompose(c.position, c.quaternion, c.scale);
    out.push(c);
  }
  return out;
}

function splitInstancedByCells(mesh, cell = 96) {
  if (Object.values(mesh.geometry.attributes).some((a) => a.isInstancedBufferAttribute)) return null;
  const mat = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const buckets = new Map();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, mat);
    p.setFromMatrixPosition(mat).applyMatrix4(mesh.matrixWorld);
    const key = keyOf(p.x, p.z, cell);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(i);
  }
  if (buckets.size < 2) return null;
  const out = [];
  const color = new THREE.Color();
  for (const list of buckets.values()) {
    const c = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach((i, j) => {
      mesh.getMatrixAt(i, mat);
      c.setMatrixAt(j, mat);
      if (mesh.instanceColor) {
        mesh.getColorAt(i, color);
        c.setColorAt(j, color);
      }
    });
    c.instanceMatrix.needsUpdate = true;
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
    c.name = mesh.name + ':cell';
    c.castShadow = mesh.castShadow;
    c.receiveShadow = mesh.receiveShadow;
    c.renderOrder = mesh.renderOrder;
    c.frustumCulled = mesh.frustumCulled;
    Object.assign(c.userData, mesh.userData);
    mesh.matrix.decompose(c.position, c.quaternion, c.scale);
    c.computeBoundingSphere();
    out.push(c);
  }
  return out;
}

export function chunkAthenaionWorld(root, { cell = 96, skip = () => false } = {}) {
  root.updateMatrixWorld(true);
  const work = [];
  root.traverse((o) => {
    if (
      !(o.isMesh || o.isInstancedMesh) ||
      o.isSkinnedMesh ||
      !o.geometry ||
      Array.isArray(o.material) ||
      o.geometry.groups.length > 1 ||
      o.userData.noChunk ||
      skip(o)
    ) {
      return;
    }
    if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || o.morphTargetInfluences) return;
    if (o.isInstancedMesh) o.computeBoundingSphere();
    const bs = o.isInstancedMesh
      ? o.boundingSphere
      : o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
    if (!bs) return;
    const r = bs.radius * o.matrixWorld.getMaxScaleOnAxis();
    if (r > cell * 1.5) work.push(o);
  });
  let split = 0;
  let made = 0;
  for (const o of work) {
    const parts = o.isInstancedMesh ? splitInstancedByCells(o, cell) : splitMeshByCells(o, cell);
    if (!parts) continue;
    const parent = o.parent;
    for (const c of parts) {
      c.userData.chunked = true;
      parent.add(c);
    }
    parent.remove(o);
    if (!o.isInstancedMesh) o.geometry.dispose();
    else o.dispose?.();
    split++;
    made += parts.length;
  }
  return { split, made };
}

class AthenaionEngineContext {
  constructor(rootGroup, camera) {
    this.scene = rootGroup;
    this.camera = camera || new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 60000);
    this.renderer = null;
    this.width = 1280;
    this.height = 800;
    this.time = 0;
    this.quality = {
      name: 'preview',
      terrainRes: 0.5,
      density: 0.36,
      detail: 0.45,
      samples: 1,
      shadowMapSize: 2048,
      theta: 0.011,
      chunkFar: 320,
      floraFar: 135,
      floraCast: 50,
      shadowMaxFar: 220,
    };
    this.params = new URLSearchParams('vegTris=1600000');
    this.seed = 'athenaion-v1';
    this.rng = (salt = '') => new RNG(`${this.seed}:${salt}`);
    this.footprints = new Footprints();
    this.slots = { banner: [], brazier: [], statue: [], ivy: [], urn: [], planter: [], lamp: [] };
    this.registry = {};
    this.moduleRoots = {};
    this._updaters = [];
    this._shotListeners = [];
    this.sunDir = new THREE.Vector3(-0.62, 0.36, 0.69).normalize();
    this.lighting = { sunDir: this.sunDir, setSun: () => {} };
    this.envIntensity = 1.0;
    this.stats = {};
  }

  add(obj, opts = {}) {
    if (!obj) return obj;
    const cast = opts.castShadow ?? true;
    const receive = opts.receiveShadow ?? true;
    obj.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = c.userData.castShadow ?? cast;
        c.receiveShadow = c.userData.receiveShadow ?? receive;
      }
    });
    this.scene.add(obj);
    return obj;
  }

  patchMaterial(mat) {
    return mat;
  }

  onUpdate(fn) {
    if (typeof fn === 'function') this._updaters.push(fn);
  }

  onShot(fn) {
    if (typeof fn === 'function') this._shotListeners.push(fn);
  }

  update(elapsed, camera) {
    this.time = elapsed;
    if (camera) this.camera = camera;
    for (let i = 0; i < this._updaters.length; i++) {
      try {
        this._updaters[i](elapsed, 0.016, this);
      } catch {
        // Ignore non-critical animation callback errors
      }
    }
  }
}

function buildRuinsCauseway(engine) {
  const group = new THREE.Group();
  group.name = 'athenaion:ruins-causeway';
  const stoneMat = proceduralMaterial({
    name: 'acro-marble',
    params: { color: 0xffffff, roughness: 0.62, metalness: 0 },
  });
  const ax = 36;
  const az = 98;
  const bx = 116;
  const bz = 156;
  const h0 = heightAt(ax, az);
  const h1 = heightAt(bx, bz);
  const len = Math.hypot(bx - ax, bz - az);
  const yaw = Math.atan2(bx - ax, bz - az);
  const rampGeo = new THREE.BoxGeometry(6.5, 2.8, len);
  const rampMesh = new THREE.Mesh(rampGeo, stoneMat);
  rampMesh.position.set((ax + bx) * 0.5, (h0 + h1) * 0.5 - 1.2, (az + bz) * 0.5);
  rampMesh.rotation.y = yaw;
  rampMesh.rotation.x = -Math.atan2(h1 - h0, len);
  rampMesh.castShadow = true;
  rampMesh.receiveShadow = true;
  group.add(rampMesh);
  engine.add(group);
}

function populateDynamicSolidObstacles(engine, solidObstacles) {
  const R = engine.registry;
  const T = R.temple?.main;
  if (T && Array.isArray(T.columns)) {
    const [tx, ty, tz] = T.position;
    for (const [lx, lz] of T.columns) {
      solidObstacles.push({
        type: 'cylinder',
        x: tx + lx,
        y: ty - 0.5,
        z: tz + lz,
        r: 0.92,
        h: T.colH || 12.0,
      });
    }
  }
  if (R.temple?.island) {
    const [cx, cy, cz] = R.temple.island.center;
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2;
      solidObstacles.push({
        type: 'cylinder',
        x: cx + Math.cos(ang) * 10.6,
        y: cy - 0.5,
        z: cz + Math.sin(ang) * 10.6,
        r: 0.52,
        h: 11.0,
      });
    }
  }
}

/**
 * Builds the complete Chapter IX Athenaion Island Biome inside `worldGroup`.
 */
export function buildCompleteAthenaionIslandBiome(worldGroup, spine, topology, options = {}) {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'Biome_Athenaion_Island';
  worldGroup.add(rootGroup);

  const engine = new AthenaionEngineContext(rootGroup, options.camera);
  _activeRegistry = engine.registry;

  const solidObstacles = [
    { type: 'cylinder', x: -10, y: 53.0, z: -40, r: 3.2, h: 32.0 },
    { type: 'cylinder', x: 50, y: 53.0, z: -40, r: 3.2, h: 32.0 },
    { type: 'cylinder', x: 133.1, y: 50.5, z: 140.0, r: 2.6, h: 6.5 },
  ];

  // Practical warm brazier light anchors at exact Athenaion Sites (`ATHENA_SITES`)
  const lightAnchors = [
    { position: new THREE.Vector3(24.0, 4.2, 97.0), color: 0xff9d3b, intensity: 14.0, distance: 22.0 },
    { position: new THREE.Vector3(32.0, 4.2, 97.0), color: 0xff9d3b, intensity: 14.0, distance: 22.0 },
    { position: new THREE.Vector3(24.0, 31.0, 31.5), color: 0xff9d3b, intensity: 14.0, distance: 22.0 },
    { position: new THREE.Vector3(32.0, 31.0, 31.5), color: 0xff9d3b, intensity: 14.0, distance: 22.0 },
    { position: new THREE.Vector3(16.0, 56.5, -17.0), color: 0xffa844, intensity: 18.0, distance: 28.0 },
    { position: new THREE.Vector3(32.0, 56.5, -17.0), color: 0xffa844, intensity: 18.0, distance: 28.0 },
    { position: new THREE.Vector3(20.0, 69.5, -27.4), color: 0xffb454, intensity: 20.0, distance: 32.0 },
    { position: new THREE.Vector3(-3.0, 10.2, 128.0), color: 0xff9d3b, intensity: 16.0, distance: 24.0 },
    { position: new THREE.Vector3(116.0, 54.2, 156.0), color: 0xff9d3b, intensity: 16.0, distance: 24.0 },
  ];

  let buildFinished = false;
  const streamed = [];
  let frameCount = 0;

  function streamChunks(camPos) {
    if (!streamed.length || !camPos) return 0;
    const q = engine.quality;
    let drawn = 0;
    for (let i = 0; i < streamed.length; i++) {
      const s = streamed[i];
      const d = Math.max(1, Math.hypot(s.x - camPos.x, s.y - camPos.y, s.z - camPos.z) - s.r);
      const on = s.r / d > q.theta && d < s.far;
      s.o.visible = on;
      if (on) drawn++;
      s.o.castShadow = on && s.cast && d < s.castFar && s.r / d > q.theta * 2;
    }
    return drawn;
  }

  // Build all procedural Athenaion modules asynchronously in dependency order
  (async () => {
    const t0 = performance.now();
    try {
      // 1. Docked Athenian Trireme "The Pallas" at the Lagoon Quay
      const ship = buildDockedTrireme(ATHENA_SHIP);
      _activeShip = ship;
      _activeGangway = ship.gangway;
      engine.add(ship.group);
      buildRuinsCauseway(engine);

      const orderedModules = [
        ['terrain', terrainMod],
        ['water', waterMod],
        ['temple', templeMod],
        ['acropolis', acropolisMod],
        ['aqueducts', aqueductsMod],
        ['sets', setsMod],
        ['statues', statuesMod],
        ['city', cityMod],
        ['ruins', ruinsMod],
        ['banners', bannersMod],
        ['vegetation', vegetationMod],
        ['flora', floraMod],
        ['waterfalls', waterfallsMod],
        ['birds', birdsMod],
      ];

      for (const [modName, mod] of orderedModules) {
        const m0 = performance.now();
        const before = new Set(engine.scene.children);
        try {
          await mod.build(engine);
          engine.moduleRoots[modName] = engine.scene.children.filter((c) => !before.has(c));
          console.log(`[AthenaionBiome] Built module '${modName}' in ${Math.round(performance.now() - m0)} ms`);
        } catch (err) {
          console.warn(`[AthenaionBiome] Module '${modName}' warning:`, err);
        }
        await new Promise((r) => setTimeout(r, 0));
      }

      // 2. Populate exact column collision cylinders from built temples
      populateDynamicSolidObstacles(engine, solidObstacles);

      // 3. Throttle vegetation LOD re-bucketing & ocean FFT to 150ms intervals for smooth 60 FPS
      const veg = engine.registry.vegetation;
      if (veg && typeof veg.maybeUpdate === 'function') {
        const origUpdate = veg.maybeUpdate.bind(veg);
        let lastVeg = 0;
        veg.maybeUpdate = (c) => {
          const now = performance.now();
          if (now - lastVeg < 150) return false;
          lastVeg = now;
          return origUpdate(c);
        };
      }
      const ocean = engine.registry.water?.ocean;
      if (ocean && typeof ocean.update === 'function') {
        const origOcean = ocean.update.bind(ocean);
        let lastOceanT = -1;
        ocean.update = (t) => {
          if (Math.abs(t - lastOceanT) < 0.15) return;
          lastOceanT = t;
          origOcean(t);
        };
      }

      // 4. Split world-spanning merged/instanced meshes into 96m spatial cells (`chunkAthenaionWorld`)
      const vegGroup = veg?.group;
      const terrainRoot = engine.registry.terrain?.root;
      const inside = (o, root) => {
        for (let p = o; p; p = p.parent) if (p === root) return true;
        return false;
      };
      const chunks = chunkAthenaionWorld(rootGroup, {
        cell: 96,
        skip: (o) =>
          (vegGroup && inside(o, vegGroup)) ||
          (terrainRoot && inside(o, terrainRoot)) ||
          o.material?.transparent,
      });

      const floraRoots = engine.moduleRoots.flora || [];
      const sphere = new THREE.Sphere();
      const q = engine.quality;
      rootGroup.updateMatrixWorld(true);
      rootGroup.traverse((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || !o.geometry || !o.visible || o.frustumCulled === false) return;
        if (vegGroup && inside(o, vegGroup)) return;
        if (o.isInstancedMesh) o.computeBoundingSphere();
        const bs = o.isInstancedMesh
          ? o.boundingSphere
          : o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
        if (!bs) return;
        sphere.copy(bs).applyMatrix4(o.matrixWorld);
        const isFlora = floraRoots.some((root) => inside(o, root));
        streamed.push({
          o,
          x: sphere.center.x,
          y: sphere.center.y,
          z: sphere.center.z,
          r: sphere.radius,
          cast: o.castShadow,
          far: isFlora ? q.floraFar : o.userData.chunked ? q.chunkFar : Infinity,
          castFar: isFlora ? q.floraCast : sphere.radius > 20 ? q.shadowMaxFar : Math.min(110, q.shadowMaxFar),
        });
      });

      // Trigger initial shot/camera LOD bucket population for vegetation & waterfalls
      for (const fn of engine._shotListeners) {
        try {
          fn({ pos: [28, 30, 45], target: [24, 54, -20], fov: 50, sun: L.SUN });
        } catch {
          // Ignore
        }
      }

      buildFinished = true;
      if (typeof window !== 'undefined') {
        window.__athenaionReady = true;
      }
      console.log(
        `[AthenaionBiome] Complete Athenaion Island world built in ${Math.round(performance.now() - t0)} ms ` +
          `(chunked ${chunks.split} batches -> ${chunks.made} cells, ${streamed.length} streamed meshes)`,
      );
    } catch (err) {
      console.error('[AthenaionBiome] Build error:', err);
    }
  })();

  return {
    rootGroup,
    engine,
    lightAnchors,
    solidObstacles,
    getFloorY: getAthenaionFloorY,
    isReady: () => buildFinished,
    update(dt, elapsed, playerPos, camera) {
      let cam = camera;
      if (!cam && playerPos) {
        engine.camera.position.set(playerPos.x, (playerPos.y || 0) + 6, playerPos.z + 12);
        cam = engine.camera;
      }
      engine.update(elapsed, cam);
      if (buildFinished && cam && frameCount++ % 8 === 0) {
        streamChunks(cam.position);
      }
    },
  };
}
