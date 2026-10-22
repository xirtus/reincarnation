// Fast WebGPU Terrain Builder for Athenaion Island (Chapter IX in Reincarnation)
// Builds the high-resolution Athenaion Island & Gorge terrain mesh (`heightAt(x, z)`)
// plus the surrounding Aegean Mountain Amphitheatre and scattered 3D karst boulders.
import * as THREE from 'three';
import { terrainMaterial } from '../terrain/material.js';
import { loadFarGrid } from '../terrain/far.js';
import { scatterBoulders } from '../terrain/boulders.js';
import { SHOTS } from '../world/shots.js';
import * as L from '../world/layout.js';
import { heightAt, WEST_CRAG, HILLTOPS, MOUNT_NOTCH } from '../world/heightfield.js';

function buildHeightGridGeometry(x0, x1, z0, z1, step) {
  const nx = Math.max(8, Math.round((x1 - x0) / step));
  const nz = Math.max(8, Math.round((z1 - z0) / step));
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cx = (x0 + x1) * 0.5;
  const cz = (z0 + z1) * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + cx;
    const wz = pos.getZ(i) + cz;
    const wy = heightAt(wx, wz);
    pos.setXYZ(i, wx, wy, wz);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export async function buildTerrain(engine) {
  const t0 = performance.now();
  try {
    await loadFarGrid();
  } catch (e) {
    console.warn('[terrain] far grid fallback to analytic', e);
  }
  const mat = terrainMaterial();
  const root = new THREE.Group();
  root.name = 'terrain';


  // 1. High-resolution Near-Field Athenaion Island, Acropolis Massif, Lagoon Gorge, Ruins & Walled City
  const nearGeo = buildHeightGridGeometry(-1540, 540, -760, 820, 3.5);
  const nearMesh = new THREE.Mesh(nearGeo, mat);
  nearMesh.name = 'terrain:island-near';
  nearMesh.castShadow = true;
  nearMesh.receiveShadow = true;
  nearMesh.userData.castShadow = true;
  nearMesh.userData.receiveShadow = true;
  root.add(nearMesh);

  // 2. Outer Aegean Mountain Ring & Distant Coastline
  const farGeo = buildHeightGridGeometry(-8500, 8500, -8500, 8500, 85);
  // Push farGeo slightly down inside the near-field box so it never z-fights with nearGeo
  const farPos = farGeo.attributes.position;
  for (let i = 0; i < farPos.count; i++) {
    const x = farPos.getX(i);
    const z = farPos.getZ(i);
    if (x > -1500 && x < 500 && z > -720 && z < 780) {
      farPos.setY(i, farPos.getY(i) - 6.0);
    }
  }
  farGeo.computeVertexNormals();
  const farMesh = new THREE.Mesh(farGeo, mat);
  farMesh.name = 'terrain:mountains-far';
  farMesh.castShadow = false;
  farMesh.receiveShadow = true;
  farMesh.userData.castShadow = false;
  farMesh.userData.receiveShadow = true;
  root.add(farMesh);

  engine.add(root);
  engine.registry.terrain = {
    root,
    material: mat,
    groups: 2,
    sites: {
      templeMount: { center: L.HILL_TEMPLE.center, top: L.HILL_TEMPLE.top, summitRadius: 48, notch: MOUNT_NOTCH },
      westCrag: { center: WEST_CRAG.center, top: WEST_CRAG.top },
      hilltops: HILLTOPS.map((t) => ({ center: t.c, top: t.top, radius: t.rf })),
    },
  };

  try {
    scatterBoulders(engine);
  } catch (e) {
    console.warn('[terrain] boulders failed', e);
  }

  console.log(`[terrain] Athenaion WebGPU terrain built in ${Math.round(performance.now() - t0)} ms`);
  return root;
}

export async function build(engine) {
  await buildTerrain(engine);
}

export async function test(engine) {
  await buildTerrain(engine);
  return { views: SHOTS };
}
