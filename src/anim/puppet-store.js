import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { decodeClip, mirrorClip } from './clip-data.js';
import { createClipLibrary } from './clip-library.js';
import { toThreeClip } from './animator.js';
import { createRetargeter, targetResolver, ANIMA_TO_MHX } from './retarget-runtime.js';
import { normalizeModelMaterials } from '../render/fix-materials.js';

let sharedLoader = null;
const gltfCache = new Map();

export function getGLTFLoader() {
  if (!sharedLoader) {
    sharedLoader = new GLTFLoader();
    sharedLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return sharedLoader;
}

export function loadGLTF(url) {
  if (!gltfCache.has(url)) {
    gltfCache.set(
      url,
      getGLTFLoader()
        .loadAsync(url)
        .catch((err) => {
          console.warn(`[GLTF] Failed to load ${url}:`, err?.message || err);
          return null;
        }),
    );
  }
  return gltfCache.get(url);
}

export async function waitForGLTFLoads() {
  // World placement callbacks attach their clones in these promise turns.
  // Finish them under the loading screen, before preparing all material variants.
  await Promise.allSettled([...gltfCache.values()]);
  await Promise.resolve();
}

// Hide adult-only, alternate-outfit, or duplicate .001/.002 head meshes on Rosebud/Tartarus characters
const ADULT_MESH = /nudeonly_|futa|^(?!.*_with_penis).*(?:shaft|penis|cock|dick|donor_attachment|scrot|testic)|^outfitalt_|^Eliot_Mesh_[56]$|^_Pubes_$|^Plane$/i;
const DUPLICATE_HEAD_MESH = /^(?:hair\d*|head_fur|teeth)00[1-9]$/i;
const CORRUPTED_HAIR_SKIN_MESH = /^hair\d*$/i;
const CORRUPTED_CLOAK_SKIN_MESH = /^hood$/i;
const UNSKINNED_RIBBON_PROP = /ribbon/i;
const UNSKINNED_HEAD_PROP = /hair|teeth|eye|horn|crown|hat|helm|mask/i;
const ADULT_BONE = /^(?:shaftRoot|shaft\d+|shaft_\d+|foreskin_\d+|glans|glans_tip|urethra|scrotum|[lr]Testicle|[lr]_testicle|testicleCrease|shaftFold|Penis_\d+|rectum\d+|colon)$/i;
const ADULT_MAT = /testic|genital|^Torso_Back/i;

export const HERO_HAIR_COLOR = '#4f3926';
const HAIR_MESH_RE = /hair|lash|brow|beard|mustache/i;
const OUTFIT_MESH_RE = /^outfit_/i;
const OUTFIT_INFLATE = 0.006;

function inflateGeometryAlongNormals(geometry, metres) {
  const g = geometry.clone();
  const pos = g.attributes?.position;
  let nor = g.attributes?.normal;
  if (!pos) return g;
  if (!nor) {
    g.computeVertexNormals();
    nor = g.attributes.normal;
  }
  const p = new Float32Array(pos.array.length);
  for (let i = 0; i < pos.count; i++) {
    const k = i * 3;
    p[k] = pos.array[k] + nor.array[k] * metres;
    p[k + 1] = pos.array[k + 1] + nor.array[k + 1] * metres;
    p[k + 2] = pos.array[k + 2] + nor.array[k + 2] * metres;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return g;
}

/**
 * Ported from tartarus/src/render/hero-look.js:
 * Styles Andreas Xirtus's hair cards (alpha cutout + warm brown tint) and fitted jacket/trousers.
 */
export function dressHero(root, { hairColor = HERO_HAIR_COLOR } = {}) {
  const tint = new THREE.Color(hairColor);
  const outfitDone = new WeakSet();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const isHair =
      HAIR_MESH_RE.test(o.name) ||
      (Array.isArray(o.material) ? o.material : [o.material]).some((m) => HAIR_MESH_RE.test(m?.name || ''));
    const isOutfit = OUTFIT_MESH_RE.test(o.name);
    if (isOutfit && o.geometry && !outfitDone.has(o)) {
      o.geometry = inflateGeometryAlongNormals(o.geometry, OUTFIT_INFLATE);
      outfitDone.add(o);
    }
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
      if (!m) return m;
      if (isHair) {
        const c = m.clone();
        if (/hair/i.test(`${o.name} ${m.name}`)) c.color.copy(tint);
        if (c.map && !c.alphaMap) c.alphaMap = c.map;
        c.alphaTest = 0.45;
        c.transparent = false;
        c.depthWrite = true;
        c.side = THREE.DoubleSide;
        c.roughness = Math.max(c.roughness ?? 0.7, 0.72);
        c.metalness = 0;
        c.needsUpdate = true;
        return c;
      }
      if (isOutfit) {
        m.polygonOffset = true;
        m.polygonOffsetFactor = -1;
        m.polygonOffsetUnits = -2;
        m.side = THREE.DoubleSide;
        m.roughness = Math.max(m.roughness ?? 0.7, 0.65);
        m.needsUpdate = true;
      }
      return m;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });
}

/**
 * Ported from tartarus/src/render/hero-look.js:
 * Masks body triangles covered by fitted clothing so skin never pokes through jacket/trousers during sword swings.
 */
export function maskUnderOutfit(
  bodyRoot,
  outfits,
  { radius = 0.058, yPad = 0.015, onlySkinRe = null, minVerticesCovered = 2 } = {}
) {
  const pts = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const root of outfits) {
    if (!root) continue;
    root.traverse((o) => {
      const pos = o.isMesh && o.geometry?.attributes?.position;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        pts.push(x, y, z);
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    });
  }
  if (!pts.length) return;
  yMin += yPad;
  yMax -= yPad;
  const r2 = radius * radius;
  const n = pts.length;
  bodyRoot.traverse((o) => {
    if (!o.isSkinnedMesh || OUTFIT_MESH_RE.test(o.name) || HAIR_MESH_RE.test(o.name)) return;
    if (/head|eye|teeth|lash|tongue/i.test(o.name)) return;
    if (onlySkinRe && !onlySkinRe.test(o.name)) return;
    const g = o.geometry;
    const pos = g?.attributes?.position;
    const idx = g?.index;
    if (!pos || !idx) return;
    const covered = new Uint8Array(pos.count);
    let any = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < yMin || y > yMax) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      for (let j = 0; j < n; j += 3) {
        const dy = pts[j + 1] - y;
        if (dy * dy > r2) continue;
        const dx = pts[j] - x;
        const dz = pts[j + 2] - z;
        if (dx * dx + dy * dy + dz * dz < r2) {
          covered[i] = 1;
          any++;
          break;
        }
      }
    }
    if (!any) return;
    const src = idx.array;
    const keep = [];
    for (let t = 0; t < src.length; t += 3) {
      const a = src[t];
      const b = src[t + 1];
      const c = src[t + 2];
      if (covered[a] + covered[b] + covered[c] >= minVerticesCovered) continue;
      keep.push(a, b, c);
    }
    const next = g.clone();
    next.setIndex(keep);
    o.geometry = next;
  });
}

/**
 * Ported from tartarus/src/player/player-character.js:
 * Binds fitted outfit GLBs (e.g. Andreas Xirtus's jacket and trousers) directly onto the character's skeleton.
 */
export function attachHeroOutfits(character, outfitGltfs = []) {
  if (!outfitGltfs.length) return;
  let bodyMesh = null;
  character.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton && (!bodyMesh || o.skeleton.bones.length > bodyMesh.skeleton.bones.length)) {
      bodyMesh = o;
    }
  });
  if (!bodyMesh) return;
  const boneByName = new Map(bodyMesh.skeleton.bones.map((b) => [b.name, b]));
  const scenes = [];
  for (const gltf of outfitGltfs) {
    if (!gltf?.scene) continue;
    const outfitScene = gltf.scene.clone(true);
    normalizeModelMaterials(outfitScene, { envMapped: true });
    const pieces = [];
    outfitScene.traverse((o) => {
      if (o.isSkinnedMesh) pieces.push(o);
    });
    for (const o of pieces) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const bones = o.skeleton.bones.map((b) => boneByName.get(b.name) || b);
      o.bind(new THREE.Skeleton(bones, o.skeleton.boneInverses), o.bindMatrix);
      (bodyMesh.parent || character).add(o);
    }
    scenes.push(outfitScene);
  }
  maskUnderOutfit(character, scenes);
}

const EYE_GLOSS_MAT_RE = /^(?:eye\s*gloss|gloss)$/i;
const EYE_GLOSS_MESH_RE = /^eyegloss$/i;
const EYEBROW_MAT_RE = /eyebrow/i;
const BUILTIN_COAT_MESH_RE = /^m3_body00[07]$/i;

function convertLuminanceMaskToEyebrowTexture(srcTex) {
  const img = srcTex?.image;
  if (!img || typeof document === 'undefined') return null;
  const w = img.width || 256;
  const h = img.height || 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
    const hairAlpha = Math.max(0, Math.min(255, Math.round((246 - lum) * 2.1)));
    d[i] = 104;
    d[i + 1] = 84;
    d[i + 2] = 64;
    d[i + 3] = hairAlpha;
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = srcTex.flipY;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function sanitizeCharacterModel(root) {
  const collapsedBones = [];
  normalizeModelMaterials(root, { envMapped: true });
  root.updateMatrixWorld(true);

  const { tb } = targetResolver(root);
  const headBone = tb('head') || tb('neck');
  const neckBone = tb('neck') || headBone;
  const chestBone = tb('chest-1') || tb('chest') || tb('spine') || neckBone;
  const spineBone = tb('spine') || chestBone;
  const unskinnedRibbonProps = [];
  const unskinnedHeadProps = [];
  const builtInCoatMeshes = [];
  let headBoneInverse = null;

  root.traverse((o) => {
    if (o.isBone && ADULT_BONE.test(o.name)) {
      o.scale.setScalar(0.001);
      collapsedBones.push(o);
    }
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;

    if (
      ADULT_MESH.test(o.name) ||
      ADULT_MESH.test(o.parent?.name || '') ||
      DUPLICATE_HEAD_MESH.test(o.name) ||
      EYE_GLOSS_MESH_RE.test(o.name)
    ) {
      o.visible = false;
      return;
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (
      mats.some(
        (m) =>
          ADULT_MAT.test(m?.name || '') ||
          (EYE_GLOSS_MAT_RE.test(m?.name || '') && !m?.map),
      )
    ) {
      o.visible = false;
      return;
    }

    // Center eye iris/pupil UVs and promote non-zero UV channel (e.g. Lady Maria TEXCOORD_3) to uv0 + uv3
    for (let mi = 0; mi < mats.length; mi++) {
      const m = mats[mi];
      if (!m) continue;
      if (/^eye$/i.test(m.name || '') && m.map) {
        const ch = m.map.channel || 0;
        const srcUv = (ch > 0 ? o.geometry?.attributes?.[`uv${ch}`] : null) || o.geometry?.attributes?.uv;
        if (srcUv) {
          const g = o.geometry.clone();
          const uvArr = new Float32Array(srcUv.count * 2);
          // On FromSoft eye spheres (m3_body002/029), +U is vertical (+Y on eyeball); -0.042 centers the pupil between eyelids
          const uShift = ch === 3 ? -0.042 : 0;
          const uvScale = ch === 3 ? 0.9 : 1.0;
          for (let i = 0; i < srcUv.count; i++) {
            uvArr[i * 2] = (srcUv.getX(i) - 0.5) * uvScale + 0.5 + uShift;
            uvArr[i * 2 + 1] = (srcUv.getY(i) - 0.5) * uvScale + 0.5;
          }
          const newAttr = new THREE.BufferAttribute(uvArr, 2);
          g.setAttribute('uv', newAttr);
          if (ch > 0) g.setAttribute(`uv${ch}`, newAttr);
          o.geometry = g;
        }
        const mc = m.clone();
        mc.map = m.map.clone();
        mc.map.channel = 0;
        mc.map.needsUpdate = true;
        mc.roughness = 0.14;
        mc.metalness = 0.04;
        mc.needsUpdate = true;
        mats[mi] = mc;
      } else if ((EYEBROW_MAT_RE.test(m.name || '') || EYEBROW_MAT_RE.test(o.name)) && m.map && !m.transparent) {
        const browTex = convertLuminanceMaskToEyebrowTexture(m.map);
        if (browTex) {
          const mc = m.clone();
          mc.map = browTex;
          mc.alphaTest = 0.22;
          mc.transparent = false;
          mc.depthWrite = true;
          mc.roughness = 0.85;
          mc.metalness = 0;
          mc.needsUpdate = true;
          mats[mi] = mc;
        }
      }
    }
    o.material = Array.isArray(o.material) ? mats : mats[0];

    if (BUILTIN_COAT_MESH_RE.test(o.name)) {
      builtInCoatMeshes.push(o);
    }

    if (headBone && o.isSkinnedMesh && o.skeleton && !headBoneInverse) {
      const hIdx = o.skeleton.bones.indexOf(headBone);
      if (hIdx >= 0 && o.skeleton.boneInverses[hIdx]) {
        headBoneInverse = o.skeleton.boneInverses[hIdx].clone();
      }
    }

    // Pin hair SkinnedMeshes with corrupted foot weights (e.g. Lady Maria Hair -> footL/R,
    // Millicent Hair3 -> Bone010R/007L) rigidly to headBone while preserving glTF bindMatrix & boneInverses!
    if (headBone && o.isSkinnedMesh && CORRUPTED_HAIR_SKIN_MESH.test(o.name) && o.skeleton) {
      let headIdx = o.skeleton.bones.indexOf(headBone);
      if (headIdx === -1) {
        headIdx = 0;
        o.skeleton.bones[0] = headBone;
      }

      const geo = o.geometry.clone();
      const count = geo.attributes.position.count;
      const si = new Uint16Array(count * 4);
      const sw = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        si[i * 4] = headIdx;
        sw[i * 4] = 1.0;
      }
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      o.geometry = geo;
    } else if (chestBone && o.isSkinnedMesh && CORRUPTED_CLOAK_SKIN_MESH.test(o.name) && o.skeleton) {
      // Fire Keeper Hood/Cloak (spans Y = 0.12..1.64): bind upper collar to neck/chest and lower cape to spine
      const neckIdx = Math.max(0, o.skeleton.bones.indexOf(neckBone));
      const chestIdx = Math.max(0, o.skeleton.bones.indexOf(chestBone));
      const spineIdx = Math.max(0, o.skeleton.bones.indexOf(spineBone));
      const geo = o.geometry.clone();
      const pos = geo.attributes.position;
      const count = pos.count;
      const si = new Uint16Array(count * 4);
      const sw = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const py = pos.getY(i);
        if (py > 1.42) {
          si[i * 4] = neckIdx;
          sw[i * 4] = 0.7;
          si[i * 4 + 1] = chestIdx;
          sw[i * 4 + 1] = 0.3;
        } else if (py > 1.05) {
          si[i * 4] = chestIdx;
          sw[i * 4] = 1.0;
        } else {
          si[i * 4] = spineIdx;
          sw[i * 4] = 1.0;
        }
      }
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      o.geometry = geo;
    } else if (headBone && !o.isSkinnedMesh && UNSKINNED_RIBBON_PROP.test(o.name)) {
      unskinnedRibbonProps.push(o);
    } else if (headBone && !o.isSkinnedMesh && UNSKINNED_HEAD_PROP.test(o.name)) {
      unskinnedHeadProps.push(o);
    }
  });

  if (builtInCoatMeshes.length) {
    maskUnderOutfit(root, builtInCoatMeshes, {
      radius: 0.045,
      yPad: 0.01,
      onlySkinRe: /^m3_body022$/i,
      minVerticesCovered: 3,
    });
  }

  // Lady Maria's Hair_ribbon has vertices authored in bind space (Y=1.64..1.83) plus a leftover node offset.
  // Transform its geometry by headBoneInverse and zero its local TRS under headBone so it sits inside her hair bun!
  for (const prop of unskinnedRibbonProps) {
    if (prop.parent !== headBone && headBoneInverse) {
      prop.geometry = prop.geometry.clone().applyMatrix4(headBoneInverse);
      prop.position.set(0, 0, 0);
      prop.quaternion.identity();
      prop.scale.set(1, 1, 1);
      headBone.add(prop);
    } else if (prop.parent !== headBone) {
      headBone.attach(prop);
    }
  }

  // Attach other unskinned head accessories (e.g. Millicent Teeth) to headBone preserving rest-pose world transform
  for (const prop of unskinnedHeadProps) {
    if (prop.parent !== headBone) {
      headBone.attach(prop);
    }
  }

  return collapsedBones;
}

export function measureCharacterStature(root) {
  root.updateMatrixWorld(true);
  const { tb } = targetResolver(root);
  const headBone = tb('head');
  const v = new THREE.Vector3();
  if (headBone) {
    headBone.getWorldPosition(v);
    const footBone = tb('foot.L') || tb('foot.R');
    const footY = footBone ? Math.max(0, footBone.getWorldPosition(new THREE.Vector3()).y - 0.09) : 0;
    const headSpan = v.y - footY;
    if (Number.isFinite(headSpan) && headSpan > 0.45) {
      return headSpan * 1.12;
    }
  }
  const box = new THREE.Box3();
  let minY = Infinity;
  let maxY = -Infinity;
  root.traverse((o) => {
    if (o.isBone && !/driver|holder|neutral|root/i.test(o.name)) {
      o.getWorldPosition(v);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  });
  if (Number.isFinite(minY) && maxY - minY > 0.35) {
    return (maxY - minY) * 1.06;
  }
  box.setFromObject(root);
  const h = box.max.y - box.min.y;
  return Number.isFinite(h) && h > 0.3 ? h : 1.75;
}

const CORE_PIGALOO_GLBS = [
  '/sibling/pigaloo/public/assets/archipelago/sword-actions.glb',
  '/sibling/pigaloo/public/assets/archipelago/combat-reactions.glb',
  '/sibling/pigaloo/public/assets/archipelago/player-actions.glb',
  '/sibling/pigaloo/public/assets/archipelago/magic-actions.glb',
  '/sibling/pigaloo/public/assets/animations/pixie-jump.glb',
  '/sibling/pigaloo/public/assets/animations/locomotion-library.glb',
  '/assets/pro-magic-pack.glb',
];
const EXTRA_LOCOMOTION_GLB = '/assets/locomotion-and-combat-pack.glb';

// Clips from locomotion-and-combat-pack.glb that had stripTwist=true in build-locomotion-and-combat-pack.mjs:
// their 43 limb/spine tracks are intact, only pelvis.quaternion was corrupted. We repair pelvis.quaternion!
const BROKEN_STRIP_TWIST_CLIPS = /^(?:AA_Turn_[LR]|Fem_Pivot_[LR]|Crouch_Turn_(?:Left|Right)_90|SnS_(?:180_Turn|Turn_[LR])|GS_(?:180_Turn|Turn_[LR]))$/;

// Pigaloo's steady-state gait cycle windows (from pigaloo fever-player.js GAITS)
export const PIGALOO_GAIT_TRIMS = {
  Walk: { start: 2.8667, duration: 34 / 30 },
  Jog: { start: 3.1667, duration: 0.7 },
  Sprint: { start: 2.3333, duration: 0.6 },
};

// Direct aliases so combat-engine clip IDs resolve to the high-impact greatsword & sword-and-shield clips
const CLIP_ALIASES = {
  gsGreatSwordKick: 'GS_Kick',
  gsGreatSwordJumpAttack: 'GS_Jump_Attack',
  gsGreatSword180Turn: 'GS_180_Turn',
  gsGreatSwordSlideAttack: 'GS_Slide_Attack',
  gsGreatSwordHighSpinAttack: 'GS_High_Spin',
  gsGreatSwordStrafeL: 'GS_Strafe_L',
  gsGreatSwordStrafeR: 'GS_Strafe_R',
  gsGreatSwordTurnL: 'GS_Turn_L',
  gsGreatSwordTurnR: 'GS_Turn_R',
  snsShieldKick: 'SnS_Shield_Kick',
  sns180Turn: 'SnS_180_Turn',
};

// Pigaloo GLBs were authored for anima44-rig facing +Z ([0, 0, 1]), whereas Tartarus anima-rig.glb
// has its rest-pose pelvis facing -X ([-1, 0, 0]) and rotates body.rotation.y by -PI/2.
// Pre-multiplying pelvis.quaternion by -PI/2 around world Y aligns all Pigaloo clips with -X!
const PIGALOO_PELVIS_YAW_FIX = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  -Math.PI / 2,
);
// Clean upright rest-pose pelvis quaternion in Pigaloo space (-90 deg X so pelvis stands upright)
const UPRIGHT_PIGALOO_PELVIS_Q = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
  .premultiply(PIGALOO_PELVIS_YAW_FIX)
  .normalize();
const _tmpPelvisQ = new THREE.Quaternion();

function trimClipWindow(clip, start, duration) {
  const end = start + duration;
  const tracks = [];
  for (const track of clip.tracks) {
    const stride = track.getValueSize();
    const times = [];
    const values = [];
    for (let i = 0; i < track.times.length; i++) {
      const t = track.times[i];
      if (t >= start - 1e-4 && t <= end + 1e-4) {
        times.push(Math.max(0, t - start));
        for (let k = 0; k < stride; k++) {
          values.push(track.values[i * stride + k]);
        }
      }
    }
    if (times.length >= 2) {
      const TrackCtor = track.constructor;
      tracks.push(new TrackCtor(track.name, new Float32Array(times), new Float32Array(values)));
    } else {
      tracks.push(track);
    }
  }
  return new THREE.AnimationClip(clip.name, duration, tracks);
}

function cleanPigalooClip(clip, pelvisScale = 100, repairPelvisTwist = false) {
  const tracks = [];
  for (const t of clip.tracks) {
    let valid = true;
    for (let i = 0; i < t.values.length; i++) {
      if (!Number.isFinite(t.values[i])) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    if (/\.scale$/.test(t.name)) continue;

    if (t.name === 'pelvis.position') {
      // Pigaloo GLBs store pelvis.position in meters (~0.985m), whereas anima-rig.glb has
      // an Armature with scale=0.01 expecting centimeter units (~98.57).
      // Scale Y by pelvisScale (100) and keep X/Z centered on the character capsule.
      const scaledValues = new Float32Array(t.values.length);
      for (let i = 0; i < t.values.length; i += 3) {
        scaledValues[i] = 0;
        scaledValues[i + 1] = t.values[i + 1] * pelvisScale;
        scaledValues[i + 2] = 0;
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times.slice(), scaledValues));
    } else if (t.name === 'pelvis.quaternion') {
      const rotValues = new Float32Array(t.values.length);
      for (let i = 0; i < t.values.length; i += 4) {
        if (repairPelvisTwist) {
          rotValues[i] = UPRIGHT_PIGALOO_PELVIS_Q.x;
          rotValues[i + 1] = UPRIGHT_PIGALOO_PELVIS_Q.y;
          rotValues[i + 2] = UPRIGHT_PIGALOO_PELVIS_Q.z;
          rotValues[i + 3] = UPRIGHT_PIGALOO_PELVIS_Q.w;
        } else {
          _tmpPelvisQ.set(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]);
          _tmpPelvisQ.premultiply(PIGALOO_PELVIS_YAW_FIX).normalize();
          rotValues[i] = _tmpPelvisQ.x;
          rotValues[i + 1] = _tmpPelvisQ.y;
          rotValues[i + 2] = _tmpPelvisQ.z;
          rotValues[i + 3] = _tmpPelvisQ.w;
        }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times.slice(), rotValues));
    } else if (!/\.position$/.test(t.name)) {
      tracks.push(t);
    }
  }
  let outClip = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  const trimSpec = PIGALOO_GAIT_TRIMS[clip.name];
  if (trimSpec && clip.duration > trimSpec.start + trimSpec.duration * 0.8) {
    outClip = trimClipWindow(outClip, trimSpec.start, trimSpec.duration);
  }
  return outClip;
}

export async function createSharedAnimStore(animBase = '/sibling/tartarus/public/anim/') {
  const manifest = await fetch(`${animBase}manifest.json`).then((r) => r.json());
  const anima = await loadGLTF('/sibling/tartarus/public/rig/anima-rig.glb');
  const lib = createClipLibrary(manifest);
  const data = new Map();
  const clips = new Map();
  const pigalooDurations = new Map();
  const loading = new Map();
  const pelvisScale = 1 / (manifest.skeleton?.armature?.scale || 0.01);

  function want(bundle) {
    if (!loading.has(bundle)) {
      const info = manifest.bundles[bundle];
      loading.set(
        bundle,
        (info ? fetch(`${animBase}${info.url}`).then((r) => r.json()) : Promise.resolve(null))
          .then((pack) => {
            for (const rec of pack?.clips || []) {
              data.set(rec.name, decodeClip(rec));
            }
            for (const c of lib.clips) {
              if (c.mirrorOf && data.has(c.mirrorOf) && !data.has(c.id)) {
                data.set(c.id, mirrorClip(data.get(c.mirrorOf), manifest.skeleton, c.mirror || 'full', c.id));
              }
            }
            return true;
          })
          .catch((e) => {
            console.warn(`[AnimStore] bundle ${bundle} failed:`, e);
            return false;
          }),
      );
    }
    return loading.get(bundle);
  }

  // 1. Load core Pigaloo combat/action/jump/locomotion GLBs + Pro Magic Pack first
  for (const url of CORE_PIGALOO_GLBS) {
    const gltf = await loadGLTF(url);
    for (const rawClip of gltf?.animations || []) {
      if (clips.has(rawClip.name)) continue;
      const cleaned = cleanPigalooClip(rawClip, pelvisScale, false);
      clips.set(cleaned.name, cleaned);
      pigalooDurations.set(cleaned.name, cleaned.duration);
    }
  }

  await Promise.all(['move', 'armed', 'melee', 'blades', 'foes'].map(want));

  // 2. Load extra locomotion/combat pack (repairing pelvis twist on 180-turn & pivot clips)
  const extraGltf = await loadGLTF(EXTRA_LOCOMOTION_GLB);
  for (const rawClip of extraGltf?.animations || []) {
    if (clips.has(rawClip.name) || data.has(rawClip.name)) continue;
    const needsTwistRepair = BROKEN_STRIP_TWIST_CLIPS.test(rawClip.name);
    const cleaned = cleanPigalooClip(rawClip, pelvisScale, needsTwistRepair);
    clips.set(cleaned.name, cleaned);
    pigalooDurations.set(cleaned.name, cleaned.duration);
  }

  // 3. Register direct combat aliases (Kick, Leap Smash, Seam Counter 180 Turn, Slide Attack, etc.)
  for (const [alias, targetName] of Object.entries(CLIP_ALIASES)) {
    if (!clips.has(alias) && clips.has(targetName)) {
      const targetClip = clips.get(targetName);
      clips.set(alias, targetClip);
      pigalooDurations.set(alias, targetClip.duration);
    }
  }

  return {
    manifest,
    anima,
    lib,
    want,
    has: (id) => clips.has(id) || data.has(id) || (CLIP_ALIASES[id] && clips.has(CLIP_ALIASES[id])),
    duration: (id) =>
      pigalooDurations.get(id) ??
      (CLIP_ALIASES[id] ? pigalooDurations.get(CLIP_ALIASES[id]) : undefined) ??
      data.get(id)?.duration ??
      lib.get(id)?.duration ??
      1.0,
    clip(id) {
      const resolvedId = clips.has(id) ? id : CLIP_ALIASES[id] || id;
      if (!clips.has(resolvedId)) {
        const d = data.get(resolvedId);
        if (!d) return null;
        clips.set(resolvedId, toThreeClip(d, manifest.skeleton.root));
      }
      return clips.get(resolvedId);
    },
    listPigalooClips: () => Array.from(pigalooDurations.keys()),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytic Two-Bone IK Solver (Ported from pigaloo_amplituhedron sword-rig.js)
// Used for:
//   1. Left & Right Arm Sword Grip IK (hands holding upper & lower sword hilt)
//   2. Left & Right Leg Knee-Bend IK (crouch-before-jump, landing shock absorption, foot planting)
//   3. High Left-Leg Chamber & Front Kick IK (guard_break_kick)
// ─────────────────────────────────────────────────────────────────────────────
const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikC = new THREE.Vector3();
const _ikDir = new THREE.Vector3();
const _ikPole = new THREE.Vector3();
const _ikCur = new THREE.Vector3();
const _ikDes = new THREE.Vector3();
const _ikMid = new THREE.Vector3();
const _ikEnd = new THREE.Vector3();
const _ikParentQ = new THREE.Quaternion();
const _ikWorldQ = new THREE.Quaternion();
const _ikDeltaQ = new THREE.Quaternion();

export function solveTwoBone(upper, lower, end, targetWorld, poleWorld) {
  if (!upper || !lower || !end || !upper.parent) return;
  upper.parent.updateWorldMatrix(true, false);
  upper.updateWorldMatrix(true, true);

  _ikA.setFromMatrixPosition(upper.matrixWorld);
  _ikB.setFromMatrixPosition(lower.matrixWorld);
  _ikC.setFromMatrixPosition(end.matrixWorld);

  const L1 = _ikA.distanceTo(_ikB);
  const L2 = _ikB.distanceTo(_ikC);
  if (L1 < 1e-4 || L2 < 1e-4) return;

  const maxReach = (L1 + L2) * 0.998;
  const minReach = Math.abs(L1 - L2) + 1e-4;
  const rawDist = _ikA.distanceTo(targetWorld);
  const d = Math.min(maxReach, Math.max(minReach, rawDist));

  _ikDir.subVectors(targetWorld, _ikA);
  if (_ikDir.lengthSq() < 1e-8) _ikDir.set(0, -1, 0);
  else _ikDir.normalize();

  _ikPole.subVectors(poleWorld, _ikA);
  _ikPole.addScaledVector(_ikDir, -_ikPole.dot(_ikDir));
  if (_ikPole.lengthSq() < 1e-6) _ikPole.set(0, 0, 1);
  else _ikPole.normalize();

  const cosA = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  _ikMid.copy(_ikA).addScaledVector(_ikDir, L1 * cosA).addScaledVector(_ikPole, L1 * sinA);
  _ikEnd.copy(_ikA).addScaledVector(_ikDir, d);

  // 1. Swing upper bone so lower joint lands on _ikMid
  _ikCur.subVectors(_ikB, _ikA).normalize();
  _ikDes.subVectors(_ikMid, _ikA).normalize();
  _ikDeltaQ.setFromUnitVectors(_ikCur, _ikDes);
  upper.getWorldQuaternion(_ikWorldQ);
  _ikWorldQ.premultiply(_ikDeltaQ);
  upper.parent.getWorldQuaternion(_ikParentQ);
  upper.quaternion.copy(_ikParentQ.invert().multiply(_ikWorldQ));
  upper.updateMatrixWorld(true);

  // 2. Swing lower bone so end joint lands on _ikEnd
  _ikB.setFromMatrixPosition(lower.matrixWorld);
  _ikC.setFromMatrixPosition(end.matrixWorld);
  _ikCur.subVectors(_ikC, _ikB).normalize();
  _ikDes.subVectors(_ikEnd, _ikB).normalize();
  _ikDeltaQ.setFromUnitVectors(_ikCur, _ikDes);
  lower.getWorldQuaternion(_ikWorldQ);
  _ikWorldQ.premultiply(_ikDeltaQ);
  lower.parent.getWorldQuaternion(_ikParentQ);
  lower.quaternion.copy(_ikParentQ.invert().multiply(_ikWorldQ));
  lower.updateMatrixWorld(true);
}

const _footLTarget = new THREE.Vector3();
const _footRTarget = new THREE.Vector3();
const _footLQ = new THREE.Quaternion();
const _footRQ = new THREE.Quaternion();
const _kneePoleL = new THREE.Vector3();
const _kneePoleR = new THREE.Vector3();
const _charFwd = new THREE.Vector3();
const _charRight = new THREE.Vector3();
const _hipWorldPos = new THREE.Vector3();
const _hipParentInv = new THREE.Matrix4();

export function createFighterPuppet({
  store,
  characterGltf,
  outfitGltfs = [],
  isHeroStyle = false,
  targetHeight = 1.8,
  ground = true,
}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const character = cloneSkinned(characterGltf.scene);
  const collapsedBones = sanitizeCharacterModel(character);
  if (outfitGltfs.length) {
    attachHeroOutfits(character, outfitGltfs);
  }
  if (isHeroStyle) {
    dressHero(character);
  }

  const rawHeight = measureCharacterStature(character);
  const scale = targetHeight / Math.max(0.3, rawHeight);
  body.scale.setScalar(scale);

  const source = cloneSkinned(store.anima.scene);
  source.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) o.visible = false;
  });

  body.add(source, character);

  const f = store.manifest.skeleton.model.forward;
  body.rotation.y = Math.PI - Math.atan2(f[0], f[2]);
  body.updateMatrixWorld(true);

  const tposeClip = store.anima.animations.find((a) => a.name === 'Tpose');
  const retarget = createRetargeter({ source, target: character, tposeClip, ground });
  const mixer = new THREE.AnimationMixer(source);

  const { tb } = targetResolver(character);
  const targetHip = tb('hip') || source.getObjectByName('pelvis');
  const targetSpine = tb('spine') || tb('chest');
  const targetHead = tb('head') || source.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('head.x'));

  // Resolve leg chains for Pigaloo-style knee-bend IK, foot planting & high kick lift
  const thighL = tb('thigh.bend.L');
  const shinL = tb('shin.L');
  const footL = tb('foot.L');
  const thighR = tb('thigh.bend.R');
  const shinR = tb('shin.R');
  const footR = tb('foot.R');

  let currentAction = null;
  let currentClipId = null;
  let currentRate = 1.0;
  let hitstopTimer = 0;
  const _tmpWorld = new THREE.Vector3();

  return {
    root,
    body,
    character,
    source,
    mixer,
    retarget,
    scale,
    tb,
    get currentClipId() {
      return currentClipId;
    },
    get currentAction() {
      return currentAction;
    },
    get playbackRate() {
      return currentAction ? currentAction.timeScale : currentRate;
    },
    getPelvisWorldY() {
      root.updateWorldMatrix(true, true);
      if (!targetHip) return root.position.y + 0.95;
      targetHip.getWorldPosition(_tmpWorld);
      return _tmpWorld.y;
    },
    getHeadWorldY() {
      root.updateWorldMatrix(true, true);
      if (!targetHead) return root.position.y + targetHeight;
      targetHead.getWorldPosition(_tmpWorld);
      return _tmpWorld.y;
    },
    triggerHitstop(durationSec = 0.075) {
      hitstopTimer = Math.max(hitstopTimer, durationSec);
    },
    play(id, { loop = true, rate = 1.0, fade = 0.14, time = null, forceReset = false } = {}) {
      const clip = store.clip(id);
      if (!clip) return false;
      currentRate = rate;
      if (id !== currentClipId || forceReset) {
        const nextAction = mixer.clipAction(clip);
        for (const act of mixer._actions) {
          if (act !== nextAction && act.isRunning()) {
            act.fadeOut(fade);
          }
        }
        nextAction.reset();
        nextAction.enabled = true;
        nextAction.setEffectiveTimeScale(rate);
        nextAction.setEffectiveWeight(1);
        nextAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        nextAction.clampWhenFinished = !loop;
        if (currentAction && currentAction !== nextAction && fade > 0) {
          nextAction.fadeIn(fade);
        }
        nextAction.play();
        currentAction = nextAction;
        currentClipId = id;
      }
      if (currentAction) {
        if (time !== null) {
          currentAction.timeScale = 0;
          currentAction.time = Math.min(clip.duration - 1e-3, Math.max(0, time));
        } else {
          currentAction.timeScale = rate;
        }
      }
      return true;
    },
    update(dt, rateOverride = null, flipPitch = 0, ikOpts = null) {
      if (hitstopTimer > 0) {
        hitstopTimer = Math.max(0, hitstopTimer - dt);
      }
      const effDt = hitstopTimer > 0 ? dt * 0.01 : dt;
      if (currentAction) {
        currentAction.timeScale = rateOverride !== null ? rateOverride : currentRate;
      }
      mixer.update(effDt);
      source.updateMatrixWorld(true);
      for (const b of collapsedBones) b.scale.setScalar(0.001);
      retarget.apply();

      this.flipPitch = flipPitch;
      root.updateWorldMatrix(true, true);
      _charFwd.set(0, 0, -1).applyQuaternion(root.quaternion).normalize();
      _charRight.set(1, 0, 0).applyQuaternion(root.quaternion).normalize();

      if (flipPitch !== 0 && targetHip && targetHip.parent) {
        const flipNorm = THREE.MathUtils.clamp(Math.abs(flipPitch) / (Math.PI * 2), 0, 1);
        const flipArc = Math.sin(flipNorm * Math.PI);

        // Lift pelvis pivot toward center-of-mass during inversion so the somersault spins cleanly in mid-air
        targetHip.getWorldPosition(_hipWorldPos);
        _hipWorldPos.y += flipArc * 0.22;
        _hipParentInv.copy(targetHip.parent.matrixWorld).invert();
        targetHip.position.copy(_hipWorldPos.applyMatrix4(_hipParentInv));

        // Rotate hip in world space around character right axis (_charRight) for a true forward somersault
        const fq = new THREE.Quaternion().setFromAxisAngle(_charRight, -flipPitch);
        targetHip.getWorldQuaternion(_ikWorldQ);
        _ikWorldQ.premultiply(fq);
        targetHip.parent.getWorldQuaternion(_ikParentQ);
        targetHip.quaternion.copy(_ikParentQ.invert().multiply(_ikWorldQ));
        targetHip.updateMatrixWorld(true);
      }

      // Apply Two-Bone Leg IK for Pigaloo Knee Bending (jump windup, landing absorption, turn pivots, combat stance)
      // and High Left-Leg Kick Lift (guard_break_kick)
      const kneeBendSquash = ikOpts?.kneeBendSquash || 0;
      const kickLift = ikOpts?.kickLift || 0;
      const strideLean = ikOpts?.strideLean || 0;
      const turnBank = ikOpts?.turnBank || 0;
      this.kickLiftAmount = kickLift;
      this.kneeBendAmount = kneeBendSquash;

      if ((strideLean !== 0 || turnBank !== 0) && targetSpine) {
        const leanQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(strideLean, 0, turnBank));
        targetSpine.quaternion.multiply(leanQ);
        targetSpine.updateMatrixWorld(true);
      }

      if ((kneeBendSquash > 0.002 || kickLift > 0.01) && targetHip && thighL && shinL && footL && thighR && shinR && footR) {

        footL.getWorldPosition(_footLTarget);
        footR.getWorldPosition(_footRTarget);
        footL.getWorldQuaternion(_footLQ);
        footR.getWorldQuaternion(_footRQ);

        const ankleFloorY = root.position.y + 0.085;
        if (kneeBendSquash > 0.002 && targetHip.parent) {
          // Keep feet anchored on/above the floor while dropping the pelvis so both knees flex naturally
          _footLTarget.y = Math.max(ankleFloorY, _footLTarget.y);
          _footRTarget.y = Math.max(ankleFloorY, _footRTarget.y);

          targetHip.getWorldPosition(_hipWorldPos);
          _hipWorldPos.y -= kneeBendSquash;
          _hipParentInv.copy(targetHip.parent.matrixWorld).invert();
          targetHip.position.copy(_hipWorldPos.applyMatrix4(_hipParentInv));
          targetHip.updateMatrixWorld(true);
        }

        targetHip.getWorldPosition(_hipWorldPos);
        _kneePoleL
          .copy(_hipWorldPos)
          .addScaledVector(_charFwd, 0.85)
          .addScaledVector(_charRight, -0.18);
        _kneePoleR
          .copy(_hipWorldPos)
          .addScaledVector(_charFwd, 0.85)
          .addScaledVector(_charRight, 0.18);

        if (kickLift > 0.01) {
          // Plant standing right leg firmly on the ground while the left leg chambers high and thrusts forward
          _footRTarget
            .copy(root.position)
            .addScaledVector(_charRight, 0.16)
            .addScaledVector(_charFwd, -0.06);
          _footRTarget.y = ankleFloorY;
          solveTwoBone(thighR, shinR, footR, _footRTarget, _kneePoleR);

          // High Front Kick (left leg chambers high and thrusts forward at chest/head height)
          _footLTarget
            .copy(root.position)
            .addScaledVector(_charFwd, 0.42 + 0.48 * kickLift)
            .addScaledVector(_charRight, -0.10);
          _footLTarget.y = root.position.y + 0.35 + 1.05 * kickLift;
          _kneePoleL
            .copy(root.position)
            .addScaledVector(_charFwd, 0.78)
            .add(new THREE.Vector3(0, 1.55, 0));

          solveTwoBone(thighL, shinL, footL, _footLTarget, _kneePoleL);
        } else if (kneeBendSquash > 0.002) {
          solveTwoBone(thighL, shinL, footL, _footLTarget, _kneePoleL);
          solveTwoBone(thighR, shinR, footR, _footRTarget, _kneePoleR);

          footL.parent.getWorldQuaternion(_ikParentQ);
          footL.quaternion.copy(_ikParentQ.invert().multiply(_footLQ));
          footL.updateMatrixWorld(true);

          footR.parent.getWorldQuaternion(_ikParentQ);
          footR.quaternion.copy(_ikParentQ.invert().multiply(_footRQ));
          footR.updateMatrixWorld(true);
        }
      }
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(source);
    },
  };
}

// --- Weapon Armory, Elemental Affinities & Real-Time Bone OBB Sensor ---
export const ELEMENTS = {
  fire: { label: 'Fire', color: 0xff6a26, share: 0.30, status: 'burn' },
  frost: { label: 'Frost', color: 0x7be0ff, share: 0.30, status: 'frost' },
  water: { label: 'Tide', color: 0x3aa6ff, share: 0.28, status: 'frost' },
  nature: { label: 'Verdance', color: 0x7dff4a, share: 0.30, status: 'mend' },
  void: { label: 'Void', color: 0xb85cff, share: 0.34, status: 'rend' },
  light: { label: 'Light', color: 0x9fffe6, share: 0.28, status: 'shock' },
  shock: { label: 'Shock', color: 0xffe066, share: 0.30, status: 'shock' },
};

export const WEAPON_CATALOG = {
  // --- 1. Greatswords (Two-Handed FF7 Remake & Elemental Cleavers) ---
  buster_sword: {
    id: 'buster_sword',
    name: 'Buster Sword (FF7 Iconic Greatsword)',
    pack: 'ff7',
    style: 'great',
    element: 'light',
    reach: 1.62,
    radius: 0.32,
    damageMult: 1.34,
    poiseMult: 1.48,
    speedMult: 1.0,
    spellMult: 1.10,
    atbMult: 1.05,
    color: 0x58e6ff,
  },
  hardedge: {
    id: 'hardedge',
    name: 'Hardedge (Stagger Cleaver)',
    pack: 'ff7',
    style: 'great',
    element: 'fire',
    reach: 1.58,
    radius: 0.31,
    damageMult: 1.42,
    poiseMult: 1.65,
    speedMult: 0.96,
    spellMult: 1.0,
    atbMult: 0.95,
    color: 0xff5a26,
  },
  iron_blade: {
    id: 'iron_blade',
    name: 'Iron Blade (Broad Cleaver)',
    pack: 'ff7',
    style: 'great',
    element: 'light',
    reach: 1.56,
    radius: 0.30,
    damageMult: 1.28,
    poiseMult: 1.42,
    speedMult: 1.02,
    spellMult: 1.15,
    atbMult: 1.05,
    color: 0x8cd8ff,
  },
  voidrend: {
    id: 'voidrend',
    name: 'Voidrend (Abyssal Greatsword)',
    pack: 'elemental',
    style: 'great',
    element: 'void',
    reach: 1.60,
    radius: 0.30,
    damageMult: 1.36,
    poiseMult: 1.46,
    speedMult: 1.04,
    spellMult: 1.25,
    atbMult: 1.10,
    color: 0xb85cff,
  },
  nail_bat: {
    id: 'nail_bat',
    name: 'Nail Bat (Berserker Crusher)',
    pack: 'ff7',
    style: 'great',
    element: 'shock',
    reach: 1.48,
    radius: 0.32,
    damageMult: 1.26,
    poiseMult: 1.72,
    speedMult: 1.08,
    spellMult: 0.9,
    atbMult: 1.30,
    color: 0xffb840,
  },

  // --- 2. Katana / Odachi Style (Sephiroth Masamune) ---
  masamune: {
    id: 'masamune',
    name: 'Masamune (Sephiroth Odachi)',
    pack: 'ff7',
    style: 'katana',
    element: 'void',
    reach: 1.82,
    radius: 0.27,
    damageMult: 1.40,
    poiseMult: 1.26,
    speedMult: 1.16,
    spellMult: 1.20,
    atbMult: 1.18,
    color: 0x7be0ff,
  },

  // --- 3. One-Handed Elemental & Mythril Blades ---
  emberwing: {
    id: 'emberwing',
    name: 'Emberwing (Phoenix Flame Blade)',
    pack: 'elemental',
    style: 'blade',
    element: 'fire',
    reach: 1.44,
    radius: 0.26,
    damageMult: 1.24,
    poiseMult: 1.22,
    speedMult: 1.14,
    spellMult: 1.20,
    atbMult: 1.12,
    color: 0xff5a26,
  },
  frostwarden: {
    id: 'frostwarden',
    name: 'Frostwarden (Wolf Rimeblade)',
    pack: 'elemental',
    style: 'blade',
    element: 'frost',
    reach: 1.42,
    radius: 0.25,
    damageMult: 1.20,
    poiseMult: 1.28,
    speedMult: 1.12,
    spellMult: 1.22,
    atbMult: 1.10,
    color: 0x62efff,
  },
  tidecaller: {
    id: 'tidecaller',
    name: 'Tidecaller (Abyssal Pool Saber)',
    pack: 'elemental',
    style: 'blade',
    element: 'water',
    reach: 1.44,
    radius: 0.25,
    damageMult: 1.18,
    poiseMult: 1.20,
    speedMult: 1.16,
    spellMult: 1.28,
    atbMult: 1.22,
    color: 0x3aa6ff,
  },
  verdant_fang: {
    id: 'verdant_fang',
    name: 'Verdant Fang (Living Thornblade)',
    pack: 'elemental',
    style: 'blade',
    element: 'nature',
    reach: 1.44,
    radius: 0.25,
    damageMult: 1.22,
    poiseMult: 1.24,
    speedMult: 1.14,
    spellMult: 1.30,
    atbMult: 1.15,
    color: 0x7dff4a,
  },
  glacier_shard: {
    id: 'glacier_shard',
    name: 'Glacier Shard (Crystal Rapier)',
    pack: 'elemental',
    style: 'blade',
    element: 'frost',
    reach: 1.40,
    radius: 0.24,
    damageMult: 1.16,
    poiseMult: 1.18,
    speedMult: 1.20,
    spellMult: 1.32,
    atbMult: 1.25,
    color: 0x9cf0ff,
  },
  mythril_saber: {
    id: 'mythril_saber',
    name: 'Mythril Saber (Arcane Runeblade)',
    pack: 'ff7',
    style: 'blade',
    element: 'light',
    reach: 1.46,
    radius: 0.26,
    damageMult: 1.20,
    poiseMult: 1.24,
    speedMult: 1.14,
    spellMult: 1.38,
    atbMult: 1.18,
    color: 0x9fffe6,
  },
  twin_stinger: {
    id: 'twin_stinger',
    name: 'Twin Stinger (Shock Saber)',
    pack: 'ff7',
    style: 'blade',
    element: 'shock',
    reach: 1.48,
    radius: 0.26,
    damageMult: 1.24,
    poiseMult: 1.28,
    speedMult: 1.12,
    spellMult: 1.20,
    atbMult: 1.15,
    color: 0xffe066,
  },

  // --- 4. Polearms & Arcane Mage Rods (Staff / Spear Moveset + High Spell Power) ---
  strike_rod: {
    id: 'strike_rod',
    name: 'Strike Rod (Obsidian War Polearm)',
    pack: 'ff7',
    style: 'staff',
    element: 'shock',
    reach: 1.78,
    radius: 0.27,
    damageMult: 1.24,
    poiseMult: 1.36,
    speedMult: 1.08,
    spellMult: 1.35,
    atbMult: 1.18,
    color: 0xff9f40,
  },
  magical_rod: {
    id: 'magical_rod',
    name: 'Wizard Staff (Archmage Catalyst)',
    pack: 'ff7',
    style: 'staff',
    element: 'void',
    reach: 1.74,
    radius: 0.26,
    damageMult: 1.14,
    poiseMult: 1.22,
    speedMult: 1.10,
    spellMult: 1.65,
    atbMult: 1.28,
    color: 0xc6a4ff,
  },
  mythril_rod: {
    id: 'mythril_rod',
    name: 'Mythril Rod (Rime Conduit)',
    pack: 'ff7',
    style: 'staff',
    element: 'frost',
    reach: 1.72,
    radius: 0.26,
    damageMult: 1.15,
    poiseMult: 1.24,
    speedMult: 1.10,
    spellMult: 1.52,
    atbMult: 1.24,
    color: 0x7be0ff,
  },
  silver_rod: {
    id: 'silver_rod',
    name: 'Silver Rod (ThreadlightWeaver)',
    pack: 'ff7',
    style: 'staff',
    element: 'light',
    reach: 1.72,
    radius: 0.26,
    damageMult: 1.15,
    poiseMult: 1.22,
    speedMult: 1.12,
    spellMult: 1.48,
    atbMult: 1.25,
    color: 0x9fffe6,
  },
  guard_rod: {
    id: 'guard_rod',
    name: 'Guard Rod (Sanctum Crozier)',
    pack: 'ff7',
    style: 'staff',
    element: 'nature',
    reach: 1.70,
    radius: 0.26,
    damageMult: 1.12,
    poiseMult: 1.28,
    speedMult: 1.08,
    spellMult: 1.42,
    atbMult: 1.20,
    color: 0x7dff4a,
  },
  fullmetal_rod: {
    id: 'fullmetal_rod',
    name: 'Full Metal Staff (Iron Polearm)',
    pack: 'ff7',
    style: 'staff',
    element: 'fire',
    reach: 1.76,
    radius: 0.27,
    damageMult: 1.26,
    poiseMult: 1.38,
    speedMult: 1.06,
    spellMult: 1.32,
    atbMult: 1.15,
    color: 0xff7a2a,
  },

  // --- 5. Twin / Electro-Mag Baton Style (Reno's Rod) ---
  reno_rod: {
    id: 'reno_rod',
    name: 'Electro-Mag Rod (Turk Shock Baton)',
    pack: 'ff7',
    style: 'baton',
    element: 'shock',
    reach: 1.38,
    radius: 0.25,
    damageMult: 1.18,
    poiseMult: 1.22,
    speedMult: 1.24,
    spellMult: 1.30,
    atbMult: 1.36,
    color: 0x58e6ff,
  },
};

const PACK_URLS = {
  ff7: '/sibling/fantasia/public/assets/weapons/ff7-weapons.glb',
  elemental: '/sibling/fantasia/public/assets/weapons/elemental-swords.glb',
};

const MHX = Object.fromEntries(ANIMA_TO_MHX.map(([a, m]) => [a, m]));
const GRIP = new THREE.Vector3(-0.86, -0.13, 0.49).normalize();

export async function createWeaponArmory() {
  const packs = {};
  const getPack = (name) => (packs[name] ||= loadGLTF(PACK_URLS[name]));

  // Preload both weapon packs
  await Promise.all([getPack('ff7'), getPack('elemental')]);

  return {
    async makeWeapon(weaponId) {
      const spec = WEAPON_CATALOG[weaponId] || WEAPON_CATALOG.masamune;
      const gltf = await getPack(spec.pack);
      const holder = new THREE.Group();
      holder.name = `weapon_${spec.id}`;

      let foundMesh = false;
      if (gltf?.scene) {
        const src = gltf.scene.getObjectByName(spec.id);
        if (src) {
          const model = src.clone(true);
          // Shift -0.055m along Y so y=0 is the upper handle grip right below the crossguard
          // and y=-0.115m is the lower handle grip above the pommel for the left hand!
          model.position.set(0, -0.055, 0);
          model.quaternion.identity();
          model.scale.setScalar(1.15);
          model.rotation.x = Math.PI / 2; // Align blade along +Y
          model.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.frustumCulled = false;
              const m = o.material;
              if (m) {
                m.metalness = Math.min(0.65, m.metalness ?? 0.5);
                m.roughness = Math.max(0.32, m.roughness ?? 0.4);
              }
            }
          });
          holder.add(model);
          foundMesh = true;
        }
      }

      if (!foundMesh) {
        const bladeGeo = new THREE.BoxGeometry(0.06, spec.reach, 0.015);
        bladeGeo.translate(0, spec.reach * 0.5, 0);
        const bladeMat = new THREE.MeshStandardMaterial({
          color: 0xd0d8e0,
          metalness: 0.85,
          roughness: 0.22,
          emissive: spec.color,
          emissiveIntensity: 0.25,
        });
        holder.add(new THREE.Mesh(bladeGeo, bladeMat));
      }

      // Add Stereopolis Bloom Edge-Glint core along the blade (for Startup & Delayed-Swing telegraphs)
      const glintGeo = new THREE.CylinderGeometry(0.012, 0.028, spec.reach * 0.92, 6);
      glintGeo.translate(0, spec.reach * 0.52, 0);
      const glintMat = new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glintMesh = new THREE.Mesh(glintGeo, glintMat);
      holder.add(glintMesh);

      holder.userData = {
        ...spec,
        glintMesh,
        glintMat,
      };
      return holder;
    },
  };
}

const _pR = new THREE.Vector3();
const _mR = new THREE.Vector3();
const _pL = new THREE.Vector3();
const _mL = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _bodyQ = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const _mat = new THREE.Matrix4();

const _tmpFist = new THREE.Vector3();
const _wristPos = new THREE.Vector3();
const _knucklePos = new THREE.Vector3();
const _childPos = new THREE.Vector3();
const _fDir = new THREE.Vector3();
const _toHilt = new THREE.Vector3();
const _curlAxis = new THREE.Vector3();
const _curlQ = new THREE.Quaternion();
const _boneWorldQ = new THREE.Quaternion();
const _parentWorldQ = new THREE.Quaternion();
const _rightWristTarget = new THREE.Vector3();
const _rightElbowPole = new THREE.Vector3();
const _leftWristTarget = new THREE.Vector3();
const _leftElbowPole = new THREE.Vector3();
const _lowerGripWorld = new THREE.Vector3();
const _charUp = new THREE.Vector3(0, 1, 0);

// Unarmed locomotion / jump / turn clips where the animation itself has empty hands swinging by the sides;
// we pose the right arm into a sword-carry guard and bring the left hand onto the lower hilt via two-bone IK!
const UNARMED_SWORD_HOLD_CLIPS = /^(?:Jump|Jump_Run|Land|Land_Hard|Walk|Jog|Sprint|Turn_L|Turn_R|Sprint_Turn|Run_Stop|Idle|Idle_Variant|Crouch_Idle|Crouch_Walk|Dodge_Back|Dodge_Right|Roll_Forward|rpgBaseJump.*|baseMove.*)$/;
const ONE_HAND_SPELL_CLIPS = /^(?:Magic_.*|ProMagic_.*)$/;

function computePalmGripPoint(wrist, indexKnuckle, middleKnuckle, pinkyKnuckle, out) {
  wrist.updateWorldMatrix(true, false);
  _wristPos.setFromMatrixPosition(wrist.matrixWorld);
  out.copy(_wristPos);

  const refKnuckle = middleKnuckle || indexKnuckle;
  if (refKnuckle) {
    refKnuckle.updateWorldMatrix(true, false);
    _knucklePos.setFromMatrixPosition(refKnuckle.matrixWorld);
    // Position the hilt 62% of the way from wrist to middle knuckle (center of the palm)
    out.lerp(_knucklePos, 0.62);

    if (indexKnuckle && pinkyKnuckle) {
      indexKnuckle.updateWorldMatrix(true, false);
      pinkyKnuckle.updateWorldMatrix(true, false);
      const pIdx = new THREE.Vector3().setFromMatrixPosition(indexKnuckle.matrixWorld);
      const pPnk = new THREE.Vector3().setFromMatrixPosition(pinkyKnuckle.matrixWorld);
      const palmAcross = pPnk.sub(pIdx);
      const wristToKnuckle = _knucklePos.clone().sub(_wristPos);
      const palmNormal = new THREE.Vector3().crossVectors(wristToKnuckle, palmAcross).normalize();
      // Offset 1.8cm into the palm hollow so the leather handle sits inside the closed grip
      out.addScaledVector(palmNormal, 0.018);
    }
  }
  return out;
}

function curlHandFingersAroundHilt(fingerChains, hiltPointWorld, bladeDirWorld, curlStrength = 1.0) {
  if (curlStrength <= 0.01) return;
  for (const chain of fingerChains) {
    const [f1, f2, f3, isThumb] = chain;
    if (!f1 || !f1.parent) continue;
    f1.parent.updateWorldMatrix(true, false);
    f1.updateWorldMatrix(true, true);

    _knucklePos.setFromMatrixPosition(f1.matrixWorld);
    if (f2) {
      _childPos.setFromMatrixPosition(f2.matrixWorld);
      _fDir.subVectors(_childPos, _knucklePos);
    } else {
      _fDir.set(0, -1, 0);
    }
    if (_fDir.lengthSq() < 1e-6) continue;
    _fDir.normalize();

    // Vector from knuckle to the closest point on the sword handle axis
    _toHilt.subVectors(hiltPointWorld, _knucklePos);
    _toHilt.addScaledVector(bladeDirWorld, -_toHilt.dot(bladeDirWorld));
    if (_toHilt.lengthSq() < 1e-6) {
      _curlAxis.copy(bladeDirWorld);
    } else {
      _toHilt.normalize();
      _curlAxis.crossVectors(_fDir, _toHilt);
      if (_curlAxis.lengthSq() < 1e-6) _curlAxis.copy(bladeDirWorld);
      else _curlAxis.normalize();
    }

    const angles = isThumb
      ? [0.58 * curlStrength, 0.68 * curlStrength, 0.45 * curlStrength]
      : [0.96 * curlStrength, 1.22 * curlStrength, 0.88 * curlStrength];
    const bones = [f1, f2, f3];

    for (let i = 0; i < 3; i++) {
      const b = bones[i];
      if (!b || !b.parent) continue;
      b.parent.updateWorldMatrix(true, false);
      b.getWorldQuaternion(_boneWorldQ);
      _curlQ.setFromAxisAngle(_curlAxis, angles[i]);
      _boneWorldQ.premultiply(_curlQ);
      b.parent.getWorldQuaternion(_parentWorldQ);
      b.quaternion.copy(_parentWorldQ.invert().multiply(_boneWorldQ));
      b.updateMatrixWorld(true);
    }
  }
}

export function mountWeaponToPuppet(weapon, puppet, { height = 1.8 } = {}) {
  const character = puppet.character;
  const host = puppet.root;
  const { tb } = targetResolver(character);
  const findBone = (animaName) =>
    tb(MHX[animaName] || animaName) ||
    character.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(animaName)) ||
    puppet.source.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(animaName));

  const upperR = tb('upper_arm.bend.R');
  const lowerR = tb('forearm.bend.R');
  const handR = tb('hand0.R') || findBone('hand.r');

  const upperL = tb('upper_arm.bend.L');
  const lowerL = tb('forearm.bend.L');
  const handL = tb('hand0.L') || findBone('hand.l');

  const buildFingerChains = (sideChar) => {
    const chains = [];
    for (const fname of ['index', 'middle', 'ring', 'pinky']) {
      const b1 = tb(`f_${fname}.01.${sideChar}`);
      const b2 = tb(`f_${fname}.02.${sideChar}`);
      const b3 = tb(`f_${fname}.03.${sideChar}`);
      if (b1) chains.push([b1, b2, b3, false]);
    }
    const t1 = tb(`thumb.01.${sideChar}`);
    const t2 = tb(`thumb.02.${sideChar}`);
    const t3 = tb(`thumb.03.${sideChar}`);
    if (t1) chains.push([t1, t2, t3, true]);
    return chains;
  };

  const fingerChainsR = buildFingerChains('R');
  const fingerChainsL = buildFingerChains('L');

  const indexR = tb('f_index.01.R');
  const middleR = tb('f_middle.01.R');
  const pinkyR = tb('f_pinky.01.R');
  const indexL = tb('f_index.01.L');
  const middleL = tb('f_middle.01.L');
  const pinkyL = tb('f_pinky.01.L');

  const k = Math.min(1.35, Math.max(0.75, height / 1.75));
  host.add(weapon);

  // Real-Time 3D Oriented Bounding Box (OBB) / Swept Blade Capsule state
  const obb = {
    basePos: new THREE.Vector3(),
    tipPos: new THREE.Vector3(),
    prevBasePos: new THREE.Vector3(),
    prevTipPos: new THREE.Vector3(),
    center: new THREE.Vector3(),
    axis: new THREE.Vector3(0, 1, 0),
    halfLength: (weapon.userData.reach || 1.45) * 0.5 * k,
    radius: weapon.userData.radius || 0.25,
    initialized: false,
  };

  let walkBobPhase = 0;

  function sync(glintIntensity = 0, glintColor = null) {
    if (weapon.parent !== host) host.add(weapon);
    host.updateWorldMatrix(true, false);
    _inv.copy(host.matrixWorld).invert();
    _bodyQ.setFromRotationMatrix(host.matrixWorld);
    const ws = new THREE.Vector3().setFromMatrixScale(host.matrixWorld).x || 1;

    const clipId = puppet.currentClipId || '';
    const isUnarmedClip = UNARMED_SWORD_HOLD_CLIPS.test(clipId);
    const isSpellClip = ONE_HAND_SPELL_CLIPS.test(clipId);
    const style = weapon.userData.style || 'great';
    const isTwoHandWeapon = style === 'great' || style === 'katana' || style === 'staff';

    _fwd.set(0, 0, -1).applyQuaternion(_bodyQ).normalize();
    _side.set(1, 0, 0).applyQuaternion(_bodyQ).normalize();

    const flipAngle = puppet.flipPitch || 0;
    const isFlipping = Math.abs(flipAngle) > 0.001;
    const pelvisH = Math.max(0.55, puppet.getPelvisWorldY() - host.position.y);
    const pelvisPivot = _tmpFist.copy(host.position).addScaledVector(_charUp, pelvisH);
    const upPose = new THREE.Vector3().copy(_charUp);
    const fwdPose = new THREE.Vector3().copy(_fwd);
    if (isFlipping) {
      const fq = new THREE.Quaternion().setFromAxisAngle(_side, -flipAngle);
      upPose.applyQuaternion(fq).normalize();
      fwdPose.applyQuaternion(fq).normalize();
    }

    if (handR) {
      const actTime = puppet.currentAction ? puppet.currentAction.time : 0;
      const actDur = puppet.currentAction?.getClip?.()?.duration || 0.8;
      const actFrac = actDur > 1e-4 ? Math.min(1, Math.max(0, actTime / actDur)) : 0;
      const isNonAttackClip =
        isUnarmedClip ||
        isSpellClip ||
        /Idle|Guard|Block|Parry|Hit|React|Death|Stun|Turn|Stop|Roll|Dodge|Dash/i.test(clipId);
      const isAttackSwing = Boolean(puppet.swingState?.active) || !isNonAttackClip;
      const swingFrac = puppet.swingState?.active ? puppet.swingState.frac : actFrac;
      const swingSign =
        puppet.swingState?.dir ||
        (/L2R|2|4|Spin|Whirl/i.test(clipId) ? -1 : 1);
      const isOverheadCleave =
        Boolean(puppet.swingState?.overhead) || /Heavy|Slam|Leap|Jump_Attack|Thrust/i.test(clipId);

      // 1. If playing an unarmed locomotion, jump, or landing clip (e.g. Pigaloo Jump, Jump_Run, Land, Walk, Jog, Sprint),
      // modify the right arm via two-bone IK so the character holds the sword in an authentic ready guard!
      if (isUnarmedClip && upperR && lowerR) {
        walkBobPhase = actTime * Math.PI * 2;
        const isSprint = clipId === 'Sprint' || (clipId === 'Jump_Run' && !isFlipping);
        const isJumpOrLand = /Jump|Land/i.test(clipId);
        const isLand = /Land/i.test(clipId);
        const bobY = isJumpOrLand ? 0 : Math.sin(walkBobPhase * 2) * 0.026;
        const strideSwayX = isJumpOrLand ? 0 : Math.cos(walkBobPhase) * (isSprint ? 0.032 : 0.018);

        _rightWristTarget
          .copy(pelvisPivot)
          .addScaledVector(_side, ((isFlipping ? 0.16 : isSprint ? 0.22 : 0.14) + strideSwayX) * k)
          .addScaledVector(upPose, ((isFlipping ? 0.14 : isLand ? 0.02 : isJumpOrLand ? 0.09 : 0.08) * k + bobY))
          .addScaledVector(fwdPose, (isFlipping ? 0.34 : isSprint ? 0.22 : 0.30) * k);

        _rightElbowPole
          .copy(pelvisPivot)
          .addScaledVector(_side, 0.44 * k)
          .addScaledVector(upPose, -0.04 * k)
          .addScaledVector(fwdPose, -0.22 * k);

        solveTwoBone(upperR, lowerR, handR, _rightWristTarget, _rightElbowPole);
      } else if (isAttackSwing && upperR && lowerR) {
        // 1b. Wide-Arc Procedural Sword Cleave Amplifier:
        // Sweeps the right arm IK target across a wide 205° horizontal/diagonal cleave arc so sword swings never look cramped!
        const windupEnd = 0.16;
        const whipEnd = 0.76;
        let sweepPhase = 0; // -1 = coiled windup flank, 0 = center apex extension, +1 = wide follow-through flank
        let whipWeight = 0;
        if (swingFrac < windupEnd) {
          const u = swingFrac / windupEnd;
          sweepPhase = -1.0 * (u * (2 - u));
          whipWeight = u * 0.78;
        } else if (swingFrac < whipEnd) {
          const u = (swingFrac - windupEnd) / (whipEnd - windupEnd);
          // Fast S-curve whip through the hitting arc
          const smoothU = u * u * (3 - 2 * u);
          sweepPhase = -1.0 + 2.05 * smoothU;
          whipWeight = 0.92;
        } else {
          const u = (swingFrac - whipEnd) / Math.max(0.01, 1.0 - whipEnd);
          sweepPhase = 1.05 * (1 - u * u);
          whipWeight = 0.92 * (1 - u);
        }

        const arcYaw = sweepPhase * swingSign * 1.72; // +/- 98.5° (~197° total horizontal sweep of the hand!)
        const sinA = Math.sin(arcYaw);
        const cosA = Math.cos(arcYaw);
        const reachRadius = (0.48 + 0.14 * Math.cos(sweepPhase * 1.2)) * k;
        const slashPitchY = isOverheadCleave
          ? (0.52 - sweepPhase * 0.42) * k
          : (0.24 - sweepPhase * swingSign * 0.12) * k;

        handR.updateWorldMatrix(true, false);
        _wristPos.setFromMatrixPosition(handR.matrixWorld);

        _rightWristTarget
          .copy(pelvisPivot)
          .addScaledVector(_side, sinA * reachRadius)
          .addScaledVector(upPose, slashPitchY)
          .addScaledVector(fwdPose, Math.max(0.12 * k, cosA * reachRadius));

        _rightWristTarget.lerpVectors(_wristPos, _rightWristTarget, whipWeight * 0.76);

        _rightElbowPole
          .copy(pelvisPivot)
          .addScaledVector(_side, (swingSign * 0.46 + sinA * 0.22) * k)
          .addScaledVector(upPose, 0.04 * k)
          .addScaledVector(fwdPose, -0.18 * k);

        solveTwoBone(upperR, lowerR, handR, _rightWristTarget, _rightElbowPole);
      }

      computePalmGripPoint(handR, indexR, middleR, pinkyR, _pR);

      // 2. Determine blade direction (_dir)
      if (isUnarmedClip) {
        if (clipId === 'Sprint' && !isFlipping) {
          // Low aerodynamic side-swept greatsword sprint carry
          _dir
            .copy(fwdPose)
            .multiplyScalar(-0.32)
            .addScaledVector(upPose, 0.78)
            .addScaledVector(_side, 0.52)
            .normalize();
        } else if (isFlipping) {
          // Coiled aerial somersault cleave posture (sweeps 360° with the flipping torso!)
          _dir
            .copy(fwdPose)
            .multiplyScalar(0.54)
            .addScaledVector(upPose, 0.78)
            .addScaledVector(_side, -0.28)
            .normalize();
        } else {
          // Diagonal forward-across ready guard (coils naturally during Jump & Land!)
          _dir
            .copy(fwdPose)
            .multiplyScalar(0.36)
            .addScaledVector(upPose, 0.86)
            .addScaledVector(_side, -0.36)
            .normalize();
        }
      } else {
        // Derive base blade orientation directly from the right hand grip (never lock to pre-IK _pR - _pL!)
        _q.setFromRotationMatrix(handR.matrixWorld);
        _dir.copy(GRIP).applyQuaternion(_q).normalize();

        if (isAttackSwing) {
          // Blend in a wide 210° radial cleave blade whip so the sword tip sweeps far across the screen!
          const windupEnd = 0.16;
          const whipEnd = 0.76;
          let sweepPhase = 0;
          let bladeBlend = 0;
          if (swingFrac < windupEnd) {
            const u = swingFrac / windupEnd;
            sweepPhase = -1.05 * u;
            bladeBlend = u * 0.85;
          } else if (swingFrac < whipEnd) {
            const u = (swingFrac - windupEnd) / (whipEnd - windupEnd);
            const smoothU = u * u * (3 - 2 * u);
            sweepPhase = -1.05 + 2.15 * smoothU;
            bladeBlend = 0.94;
          } else {
            const u = (swingFrac - whipEnd) / Math.max(0.01, 1.0 - whipEnd);
            sweepPhase = 1.10 * (1 - u);
            bladeBlend = 0.94 * (1 - u);
          }

          const bladeAzimuth = sweepPhase * swingSign * 1.82; // +/- 104° (~208° full blade arc!)
          const bladeElev = isOverheadCleave
            ? 0.58 - sweepPhase * 0.65
            : 0.12 - sweepPhase * 0.18;

          _ikDes
            .copy(fwdPose)
            .multiplyScalar(Math.cos(bladeAzimuth))
            .addScaledVector(_side, Math.sin(bladeAzimuth))
            .addScaledVector(upPose, bladeElev)
            .normalize();

          _dir.lerp(_ikDes, bladeBlend).normalize();
        }
      }

      // 3. Place weapon at right hand palm center (_pR) aligned with _dir
      _fwd.copy(fwdPose);
      _side.crossVectors(_dir, _fwd);
      if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0).applyQuaternion(_bodyQ);
      _side.normalize();
      _fwd.crossVectors(_side, _dir).normalize();

      _mat.makeBasis(_side, _dir, _fwd);
      _q.setFromRotationMatrix(_mat);
      weapon.position.copy(_pR).applyMatrix4(_inv);
      weapon.quaternion.copy(_bodyQ).invert().multiply(_q);
      weapon.scale.setScalar((k * 1.12) / ws);
      weapon.updateMatrixWorld(true);

      // 4. Solve Two-Bone IK for the Left Support Arm so the Left Hand firmly grips the lower handle!
      const useTwoHandIK = isTwoHandWeapon && !isSpellClip && clipId !== 'GS_Kick' && clipId !== 'SnS_Shield_Kick';
      if (useTwoHandIK && upperL && lowerL && handL) {
        // Lower grip point on the sword handle in world space (11.5cm below upper grip along -_dir)
        _lowerGripWorld.copy(_pR).addScaledVector(_dir, -0.115 * k);

        // Compute wrist target so the left palm center lands right on _lowerGripWorld
        handL.updateWorldMatrix(true, false);
        _wristPos.setFromMatrixPosition(handL.matrixWorld);
        computePalmGripPoint(handL, indexL, middleL, pinkyL, _pL);
        _leftWristTarget.copy(_lowerGripWorld).sub(_pL).add(_wristPos);

        _side.set(1, 0, 0).applyQuaternion(_bodyQ).normalize();
        _leftElbowPole
          .copy(pelvisPivot)
          .addScaledVector(_side, -0.42 * k)
          .addScaledVector(upPose, -0.02 * k)
          .addScaledVector(fwdPose, -0.18 * k);

        solveTwoBone(upperL, lowerL, handL, _leftWristTarget, _leftElbowPole);

        // Swing left wrist so fingers point across the handle for a natural wrap
        if (middleL && handL.parent) {
          handL.updateWorldMatrix(true, true);
          _wristPos.setFromMatrixPosition(handL.matrixWorld);
          _knucklePos.setFromMatrixPosition(middleL.matrixWorld);
          _ikCur.subVectors(_knucklePos, _wristPos).normalize();
          _ikDes.copy(fwdPose).addScaledVector(_side, 0.35).normalize();
          _ikDeltaQ.setFromUnitVectors(_ikCur, _ikDes);
          handL.getWorldQuaternion(_boneWorldQ);
          _boneWorldQ.premultiply(_ikDeltaQ);
          handL.parent.getWorldQuaternion(_parentWorldQ);
          handL.quaternion.copy(_parentWorldQ.invert().multiply(_boneWorldQ));
          handL.updateMatrixWorld(true);
        }
      }

      // 5. Curl fingers and thumb on BOTH hands tightly around the sword handle axis!
      curlHandFingersAroundHilt(fingerChainsR, _pR, _dir, 1.0);
      if (useTwoHandIK && handL) {
        _lowerGripWorld.copy(_pR).addScaledVector(_dir, -0.115 * k);
        curlHandFingersAroundHilt(fingerChainsL, _lowerGripWorld, _dir, 1.0);
      }
    }

    // Update OBB endpoints in world space (expanded reach & radius for wide-arc sword cleaves)
    if (obb.initialized) {
      obb.prevBasePos.copy(obb.basePos);
      obb.prevTipPos.copy(obb.tipPos);
    }
    const reach = (weapon.userData.reach || 1.55) * 1.16;
    obb.basePos.set(0, 0.08, 0).applyMatrix4(weapon.matrixWorld);
    obb.tipPos.set(0, reach, 0).applyMatrix4(weapon.matrixWorld);
    obb.center.addVectors(obb.basePos, obb.tipPos).multiplyScalar(0.5);
    obb.axis.subVectors(obb.tipPos, obb.basePos);
    const len = obb.axis.length();
    obb.halfLength = len * 0.5;
    if (len > 1e-4) obb.axis.divideScalar(len);
    if (!obb.initialized) {
      obb.prevBasePos.copy(obb.basePos);
      obb.prevTipPos.copy(obb.tipPos);
      obb.initialized = true;
    }

    if (weapon.userData.glintMat) {
      weapon.userData.glintMat.opacity = glintIntensity * 0.75;
      if (glintColor) weapon.userData.glintMat.color.setHex(glintColor);
    }
  }

  sync(0);

  return {
    weapon,
    handR,
    handL,
    obb,
    sync,
    dispose() {
      weapon.removeFromParent();
    },
  };
}

// Analytical 3D Swept Weapon OBB vs Defender Capsule intersection test
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _capA = new THREE.Vector3();
const _capB = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export function closestDistanceBetweenSegments(p1, q1, p2, q2, outHitPoint = null) {
  _u.subVectors(q1, p1);
  _v.subVectors(q2, p2);
  _w.subVectors(p1, p2);
  const a = _u.dot(_u);
  const b = _u.dot(_v);
  const c = _v.dot(_v);
  const d = _u.dot(_w);
  const e = _v.dot(_w);
  const D = a * c - b * b;
  let sc, sN, sD = D;
  let tc, tN, tD = D;

  if (D < 1e-6) {
    sN = 0.0;
    sD = 1.0;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0.0) {
      sN = 0.0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }

  if (tN < 0.0) {
    tN = 0.0;
    if (-d < 0.0) sN = 0.0;
    else if (-d > a) sN = sD;
    else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0.0) sN = 0.0;
    else if (-d + b > a) sN = sD;
    else {
      sN = -d + b;
      sD = a;
    }
  }

  sc = Math.abs(sN) < 1e-6 ? 0.0 : sN / sD;
  tc = Math.abs(tN) < 1e-6 ? 0.0 : tN / tD;

  const ptOnBlade = _u.multiplyScalar(sc).add(p1);
  const ptOnBody = _v.multiplyScalar(tc).add(p2);
  if (outHitPoint) {
    outHitPoint.addVectors(ptOnBlade, ptOnBody).multiplyScalar(0.5);
  }
  return ptOnBlade.distanceTo(ptOnBody);
}

/**
 * Tests 3 sub-step interpolations of the swept weapon OBB against a target's 3D vertical capsule.
 */
export function testWeaponOBBvsCapsule(obb, targetPos, targetHeight = 1.8, targetRadius = 0.55, outHitPoint = new THREE.Vector3()) {
  _capA.set(targetPos.x, targetPos.y + targetRadius, targetPos.z);
  _capB.set(targetPos.x, targetPos.y + Math.max(targetRadius + 0.2, targetHeight - targetRadius * 0.5), targetPos.z);
  const threshold = obb.radius + targetRadius;

  for (let step = 0; step <= 2; step++) {
    const alpha = step / 2;
    _segA.lerpVectors(obb.prevBasePos, obb.basePos, alpha);
    _segB.lerpVectors(obb.prevTipPos, obb.tipPos, alpha);
    const dist = closestDistanceBetweenSegments(_segA, _segB, _capA, _capB, outHitPoint);
    if (dist <= threshold) {
      return true;
    }
  }
  return false;
}
