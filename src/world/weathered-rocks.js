import * as THREE from 'three';

// Shared, bounded sculpting preserves the existing cylindrical collision volumes.
// Angular harmonics stay continuous at the UV seam and across cap vertices.
export function createWeatheredRockGeometry(radius, height, { walkableTop = false, seed = 0 } = {}) {
  const geometry = walkableTop
    ? new THREE.CylinderGeometry(radius * 0.91, radius, height, 24, 6)
    : new THREE.SphereGeometry(1, 24, 16);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const low = new THREE.Color('#454740');
  const high = new THREE.Color('#737366');
  const moss = new THREE.Color('#59674c');
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    let x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const angle = Math.atan2(z, x);
    const normalizedY = walkableTop ? y / height + 0.5 : (y + 1) * 0.5;
    const erosion = 0.94 + 0.035 * Math.sin(angle * 5 + seed) + 0.025 * Math.cos(angle * 9 - seed * 0.7);
    const strata = 1 + 0.035 * Math.sin(normalizedY * 23 + seed + angle * 2);
    if (walkableTop) {
      x *= erosion * strata; z *= erosion * strata;
      y += height * 0.5; // Flat cap stays exactly at the authored walkable height.
    } else {
      x *= radius * erosion * strata;
      z *= radius * erosion * strata * 0.96;
      y = normalizedY * height;
      x += Math.sin(normalizedY * 4 + seed) * radius * 0.06;
      z += Math.sin(normalizedY * 5 - seed) * radius * 0.04;
    }
    positions.setXYZ(i, x, y, z);
    const variation = 0.35 + 0.35 * Math.sin(angle * 3 + normalizedY * 12 + seed);
    color.copy(low).lerp(high, Math.max(0, variation));
    if (normalizedY > 0.75) color.lerp(moss, (normalizedY - 0.75) * 1.4);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.walkableTop = walkableTop;
  return geometry;
}

export function createRockMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    name: 'PolyHaven Weathered Rock PBR',
    color: 0xd4d0c8,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.04,
  });

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const pixels = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const grain = Math.sin(x * 14.17 + y * 91.73) * 43758.5453;
        const noise = grain - Math.floor(grain);
        const vein = Math.abs(Math.sin(y * 0.23 + Math.sin(x * 0.09) * 1.4));
        const value = Math.round(155 + noise * 60 - (vein < 0.09 ? 35 : 0));
        const i = (y * 128 + x) * 4;
        pixels.data.set([value, value, value, 255], i);
      }
    }
    ctx.putImageData(pixels, 0, 0);
    const fallbackBump = new THREE.CanvasTexture(canvas);
    fallbackBump.wrapS = fallbackBump.wrapT = THREE.RepeatWrapping;
    fallbackBump.repeat.set(2.5, 2.5);
    mat.bumpMap = fallbackBump;
    mat.bumpScale = 0.045;

    // Load Poly Haven CC0 1K Photogrammetric Rock PBR Suite (Diffuse + NormalGL + Roughness)
    const loader = new THREE.TextureLoader();
    const setupTex = (tex, isSrgb = false) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2.5, 2.5);
      tex.anisotropy = 8;
      if (isSrgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    };

    loader.load('/textures/polyhaven/aerial_rocks_02_diff_1k.jpg', (diffTex) => {
      setupTex(diffTex, true);
      mat.map = diffTex;
      mat.needsUpdate = true;
    });
    loader.load('/textures/polyhaven/aerial_rocks_02_nor_gl_1k.jpg', (norTex) => {
      setupTex(norTex, false);
      mat.normalMap = norTex;
      mat.normalScale = new THREE.Vector2(1.45, 1.45);
      mat.bumpMap = null;
      mat.needsUpdate = true;
    });
    loader.load('/textures/polyhaven/aerial_rocks_02_rough_1k.jpg', (roughTex) => {
      setupTex(roughTex, false);
      mat.roughnessMap = roughTex;
      mat.roughness = 0.96;
      mat.needsUpdate = true;
    });
  }

  return mat;
}
