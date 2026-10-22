import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sanitizeLightingControls, lampStrength, GAME_CONTROLS } from '../src/render/lighting-values.js';
import { LocalLightPool } from '../src/render/local-light-pool.js';
import { createWeatheredRockGeometry } from '../src/world/weathered-rocks.js';
import { prepareScene } from '../src/render/prepare-scene.js';

test('saved and imported control values cannot poison lighting with invalid colors or nonfinite numbers', () => {
  const schema = { ...GAME_CONTROLS, color: { type: 'color' }, mode: { type: 'select', options: { night: 'Night' } }, shadows: { type: 'checkbox' } };
  assert.deepEqual(sanitizeLightingControls({ fogDensity: 200, renderScale: -3, skyRotation: NaN, color: 'url(script)', mode: '__proto__', shadows: 'false', unknown: 1 }, schema), { fogDensity: 2, renderScale: .65 });
  assert.deepEqual(sanitizeLightingControls({ color: '#ffc783', mode: 'night', shadows: false, skyRotation: -30 }, schema), { skyRotation: -30, color: '#ffc783', mode: 'night', shadows: false });
});

test('Original can disable the lamp while auto prioritizes sheltered paths', () => {
  assert.equal(lampStrength('off', true, false), 0);
  assert.equal(lampStrength('on', false, true), 1);
  assert.ok(lampStrength('auto', true, false) > lampStrength('auto', false, false));
  assert.ok(lampStrength('auto', false, true) < lampStrength('auto', false, false));
});

test('sector changes preserve the render light set and copy the nearest authored practical', () => {
  const scene = new THREE.Scene(), first = new THREE.Group(), second = new THREE.Group();
  const a = new THREE.PointLight('#ffa040', 8, 15, 1.5), b = new THREE.PointLight('#70aaff', 5, 15, 1.8);
  first.add(a); second.add(b); second.position.x = 60; scene.add(first, second);
  const pool = new LocalLightPool(scene, [first, second], 3);
  const identities = pool.slots.map(light => light.uuid);
  pool.update(.2, new THREE.Vector3());
  assert.equal(pool.slots[0].intensity, 8);
  assert.equal(pool.slots[0].color.getHex(), a.color.getHex());
  a.intensity = 6; pool.update(.01, new THREE.Vector3());
  assert.equal(pool.slots[0].intensity, 6);
  first.visible = false; pool.update(.2, new THREE.Vector3(60, 0, 0));
  assert.equal(pool.slots[0].intensity, 5);
  assert.equal(pool.slots[0].position.x, 60);
  assert.deepEqual(pool.slots.map(light => light.uuid), identities);
  assert.equal(scene.children.filter(object => object.isPointLight).length, 3);
  assert.ok(pool.slots.every(light => light.visible));
});

test('sculpted stepping stones retain a level cap and the authored jump height', () => {
  for (const walkableTop of [true, false]) {
    const geometry = createWeatheredRockGeometry(1.5, 1.2, { walkableTop, seed: 8 });
    geometry.computeBoundingBox();
    assert.ok(Math.abs(geometry.boundingBox.min.y) < 1e-6);
    assert.ok(Math.abs(geometry.boundingBox.max.y - 1.2) < 1e-6);
    assert.ok(geometry.attributes.position.count > 100);
    assert.equal(geometry.attributes.color.count, geometry.attributes.position.count);
    assert.ok(geometry.attributes.normal.array.every(Number.isFinite));
    geometry.dispose();
  }
});

test('preparation compiles offscreen meshes and always restores culling after failure', async () => {
  const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(mesh); const camera = new THREE.PerspectiveCamera();
  let prepared = false;
  await prepareScene({ compileAsync: async () => { assert.equal(mesh.frustumCulled, false); prepared = true; } }, scene, camera);
  assert.ok(prepared); assert.equal(mesh.frustumCulled, true);
  let drew = false;
  await prepareScene({ compileAsync: async () => {} }, scene, camera, null, () => {
    assert.equal(mesh.frustumCulled, false); drew = true;
  });
  assert.ok(drew); assert.equal(mesh.frustumCulled, true);
  await assert.rejects(prepareScene({ compileAsync: async () => { throw new Error('test compile failure'); } }, scene, camera), /test compile failure/);
  assert.equal(mesh.frustumCulled, true);
});
