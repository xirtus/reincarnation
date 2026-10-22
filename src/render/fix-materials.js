// Making imported characters render as they were painted.
//
// Rosebud's exports (and some of the sibling games' models) carry quirks that look fine in the
// tool that made them and wrong here:
//   - the skin of a baked model samples its atlas through a later UV set (TEXCOORD_3, so
//     map.channel 3 and a geometry attribute `uv3`). Under three's WebGPU renderer those maps
//     came out sampling the wrong set, so whole patches of the face and hands read the atlas's
//     black background. The cure is to move the set the maps use into `uv` and point them at
//     channel 0, which every path in the renderer handles;
//   - a metalness near 1 with no metalness map and no environment to reflect renders as a black
//     mirror in a cave lit by a handful of lights;
//   - a colour texture left in linear space reads washed out (or, worse, dark and muddy).
// Nothing here imports three, so it runs under node --test on stand-in objects.

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'specularMap', 'lightMap'];
const COLOUR_MAPS = ['map', 'emissiveMap'];
const SRGB = 'srgb';   // THREE.SRGBColorSpace

/** The UV set a material's maps read, or 0. When maps disagree, the colour map's set wins. */
export function materialChannel(mat) {
  if (!mat) return 0;
  if (mat.map?.channel > 0) return mat.map.channel;
  for (const k of MAP_KEYS) if (mat[k]?.channel > 0) return mat[k].channel;
  return 0;
}

const uvName = (n) => (n > 0 ? `uv${n}` : 'uv');

/**
 * Normalise every mesh under `root` in place. Returns a tally:
 * { meshes, remapped, cloned, metal, srgb }.
 * `envMapped` true keeps metals as they are (a scene with an environment map reflects them).
 */
export function normalizeModelMaterials(root, { envMapped = false } = {}) {
  const tally = { meshes: 0, remapped: 0, cloned: 0, metal: 0, srgb: 0 };
  if (!root?.traverse) return tally;
  const geomChannel = new Map();   // geometry -> the set already moved into its `uv`
  const seenMat = new Set();
  const matChannel = new Map();    // material -> the set its maps read before they were pointed at 0
  const channelOf = (m) => { if (!matChannel.has(m)) matChannel.set(m, materialChannel(m)); return matChannel.get(m); };
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    tally.meshes++;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // UV set: a mesh with one material (or several that agree) gets that set in `uv`.
    const channels = [...new Set(mats.map(channelOf))];
    const n = channels.length === 1 ? channels[0] : Math.max(...channels);
    if (n > 0) {
      let g = o.geometry;
      const src = g.getAttribute?.(uvName(n));
      if (src) {
        const done = geomChannel.get(g);
        if (done !== undefined && done !== n) { g = o.geometry = g.clone(); tally.cloned++; }
        if (done !== n) {
          g.setAttribute('uv', src);
          geomChannel.set(g, n);
        }
        for (const m of mats) for (const k of MAP_KEYS) {
          const t = m?.[k];
          if (t && (t.channel === n || (t.channel > 0 && channelOf(m) === n))) { t.channel = 0; t.needsUpdate = true; }
        }
        tally.remapped++;
      } else {
        for (const m of mats) for (const k of MAP_KEYS) {
          const t = m?.[k];
          if (t && t.channel > 0) { t.channel = 0; t.needsUpdate = true; }
        }
      }
    }
    for (const m of mats) for (const k of MAP_KEYS) {
      const t = m?.[k];
      if (t && t.channel > 0 && !o.geometry.getAttribute?.(uvName(t.channel))) {
        t.channel = 0;
        t.needsUpdate = true;
      }
    }
    for (const m of mats) {
      if (!m || seenMat.has(m)) continue;
      seenMat.add(m);
      // A mirror with nothing to mirror is black: a character is cloth and skin.
      if (!envMapped && !m.envMap && !m.metalnessMap && m.metalness > 0.5) { m.metalness = 0.15; m.needsUpdate = true; tally.metal++; }
      if (m.roughness !== undefined && !(m.roughness >= 0.05)) { m.roughness = 0.6; m.needsUpdate = true; }
      for (const k of COLOUR_MAPS) {
        const t = m[k];
        if (t && t.colorSpace !== SRGB) { t.colorSpace = SRGB; t.needsUpdate = true; tally.srgb++; }
      }
    }
  });
  return tally;
}
