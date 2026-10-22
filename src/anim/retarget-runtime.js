// Copied from rosebud/src/anim/retarget-runtime.js at commit 28108e5c (2026-10-15) for Tartarus's cast
// (src/anim/cast-actor.js). Unchanged below this header; fixes go to rosebud first.
// RUNTIME RETARGETING: an Anima actor (posed by any clip library) drives a different character.
//
// Every clip in the game is authored for, solved onto, or retargeted to the 44-bone Anima rig.
// New characters (Daz Genesis 8 bodies on an MHX rig, 191 deform bones) do not share its bones,
// axes or rest pose. Rather than re-bake every library for every character, the Anima actor keeps
// playing — invisible — and each frame its bones' MODEL-SPACE rotations are carried onto the
// character through constant per-bone offsets measured in a shared reference pose:
//
//   reference   the Anima `Tpose` take, and the character's rest bent into the same T by a swing
//               per mapped bone (parent first), aimed at the same child joint
//   G           the rotation between the two bodies' frames (hips left-right, up the spine), so
//               facing conventions do not matter
//   per bone    O = (G * Sref)^-1 * Tref;   every frame: T = G * S * O
//   hips        the source hips' position, scaled by the ratio of leg lengths
//
// Bones without a counterpart (twist bones, toes, face, spine-1) keep their rest pose relative to
// their parent, so they follow along.

import * as THREE from 'three';

const n = (s) => THREE.PropertyBinding.sanitizeNodeName(s);

/** Anima bone -> MHX (Daz via Diffeomorphic) deform bone, with the child each aims at. */
export const ANIMA_TO_MHX = [
  ['pelvis', 'hip', null, null],
  ['spine_01.x', 'spine', 'spine_02.x', 'chest'],
  ['spine_02.x', 'chest', 'spine_03.x', 'chest-1'],
  ['spine_03.x', 'chest-1', 'neck.x', 'neck'],
  ['neck.x', 'neck', 'head.x', 'head'],
  ['head.x', 'head', null, null],
  ...['l', 'r'].flatMap((s) => {
    const S = s.toUpperCase();
    return [
      [`shoulder.${s}`, `clavicle.${S}`, `arm_stretch.${s}`, `upper_arm.bend.${S}`],
      [`arm_stretch.${s}`, `upper_arm.bend.${S}`, `forearm_stretch.${s}`, `forearm.bend.${S}`],
      [`forearm_stretch.${s}`, `forearm.bend.${S}`, `hand.${s}`, `hand0.${S}`],
      [`hand.${s}`, `hand0.${S}`, `c_middle1.${s}`, `f_middle.01.${S}`],
      [`thigh_stretch.${s}`, `thigh.bend.${S}`, `leg_stretch.${s}`, `shin.${S}`],
      [`leg_stretch.${s}`, `shin.${S}`, `foot.${s}`, `foot.${S}`],
      [`foot.${s}`, `foot.${S}`, null, null],
      ...['index', 'middle', 'ring', 'pinky'].flatMap((f) => [
        [`c_${f}1.${s}`, `f_${f}.01.${S}`, `c_${f}2.${s}`, `f_${f}.02.${S}`],
        [`c_${f}2.${s}`, `f_${f}.02.${S}`, null, null],
      ]),
      [`c_thumb1.${s}`, `thumb.01.${S}`, `c_thumb2.${s}`, `thumb.02.${S}`],
      [`c_thumb2.${s}`, `thumb.02.${S}`, null, null],
    ];
  }),
];
const LEGS = { src: ['thigh_stretch.l', 'leg_stretch.l', 'foot.l'], tgt: ['thigh.bend.L', 'shin.L', 'foot.L'] };
const FRAME = { src: ['thigh_stretch.l', 'thigh_stretch.r', 'neck.x', 'pelvis'], tgt: ['thigh.bend.L', 'thigh.bend.R', 'neck', 'hip'] };

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** Model-space transform of a node (relative to `root`). */
function modelSpace(root, node, outQ, outP) {
  _inv.copy(root.matrixWorld).invert();
  _m.multiplyMatrices(_inv, node.matrixWorld);
  _m.decompose(outP || _p, outQ || _q, _s);
}
function frameQuat(root, nodes, upAxis = null) {
  const P = nodes.map((b) => { const v = new THREE.Vector3(); modelSpace(root, b, new THREE.Quaternion(), v); return v; });
  const up = upAxis ? upAxis.clone() : P[2].clone().sub(P[3]).normalize();
  const r = P[0].clone().sub(P[1]);
  r.sub(up.clone().multiplyScalar(r.dot(up))).normalize();
  const f = new THREE.Vector3().crossVectors(r, up);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, up, f));
}

/**
 * Pose `source` in its T-pose (`tposeClip`) once, bend `target` into the same T, measure.
 * Returns { apply() } which copies the source's current pose onto the target; call it after the
 * source's mixer has updated. `target` should be a sibling of `source` (same parent).
 */
// Characters converted from other rigs can lack a bone or two (no separate neck, no foot): stand
// in with the nearest one there is, so the frame and leg measures still work.
const STAND_IN = { neck: ['head', 'chest-1', 'chest'], 'chest-1': ['chest', 'spine'], chest: ['chest-1', 'spine'], spine: ['chest', 'hip'],
  'foot.L': ['shin.L'], 'foot.R': ['shin.R'], hip: ['pelvis'] };

/**
 * How a converted character's bones answer the canonical MHX names the retarget asks for.
 * `tb0` is the literal name (with the two spelling fallbacks the MHX exports vary in: a `DEF-`
 * prefix on the spine, and a split shin written `shin.bend.L`); `tb` adds the stand-ins above.
 * Shared by createRetargeter and by rigReport, so the bench and the game agree by construction.
 */
const FROMSOFT_FINGER_MAP = {
  'f_index.01.L': 'Finger_01L',
  'f_index.02.L': 'Finger_11L',
  'f_index.03.L': 'Finger_21L',
  'f_middle.01.L': 'Finger_02L',
  'f_middle.02.L': 'Finger_12L',
  'f_middle.03.L': 'Finger_22L',
  'f_ring.01.L': 'Finger_03L',
  'f_ring.02.L': 'Finger_13L',
  'f_ring.03.L': 'Finger_23L',
  'f_pinky.01.L': 'Finger_04L',
  'f_pinky.02.L': 'Finger_14L',
  'f_pinky.03.L': 'Finger_24L',
  'thumb.01.L': 'Thumb_01L',
  'thumb.02.L': 'Thumb_11L',
  'thumb.03.L': 'Thumb_21L',
  'f_index.01.R': 'Finger_01R',
  'f_index.02.R': 'Finger_11R',
  'f_index.03.R': 'Finger_21R',
  'f_middle.01.R': 'Finger_02R',
  'f_middle.02.R': 'Finger_12R',
  'f_middle.03.R': 'Finger_22R',
  'f_ring.01.R': 'Finger_03R',
  'f_ring.02.R': 'Finger_13R',
  'f_ring.03.R': 'Finger_23R',
  'f_pinky.01.R': 'Finger_04R',
  'f_pinky.02.R': 'Finger_14R',
  'f_pinky.03.R': 'Finger_24R',
  'thumb.01.R': 'Thumb_01R',
  'thumb.02.R': 'Thumb_11R',
  'thumb.03.R': 'Thumb_21R',
};

export function targetResolver(target) {
  // Some MHX exports prefix the spine's deform bones (`DEF-spine`, `DEF-chest-1`),
  // and FromSoft cast rigs name finger bones `Finger_01..04L/R` & `Thumb_01L/R`.
  const tb0 = (name) =>
    target.getObjectByName(n(name)) ||
    target.getObjectByName(n('DEF-' + name)) ||
    target.getObjectByName(n(name.replace(/\.([LR])$/, '.bend.$1'))) ||
    (FROMSOFT_FINGER_MAP[name] ? target.getObjectByName(FROMSOFT_FINGER_MAP[name]) : undefined);
  const tb = (name) => {
    let b = tb0(name);
    for (const alt of STAND_IN[name] || []) { if (b) break; b = tb0(alt); }
    if (!b && name === 'hip') { const t = tb0('thigh.bend.L'); b = t && t.parent; }
    return b;
  };
  return { tb0, tb };
}

/** How much skin each bone of a converted character carries, by name, summed over its meshes. */
export function boneWeights(target) {
  const w = new Map();
  target.traverse((o) => {
    const g = o.geometry;
    if (!o.isSkinnedMesh || !g?.attributes?.skinIndex || !g.attributes.skinWeight) return;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = o.skeleton?.bones || [];
    for (let v = 0; v < si.count; v++) {
      for (let c = 0; c < si.itemSize; c++) {
        const weight = sw.getComponent(v, c);
        if (weight <= 0) continue;
        const b = bones[si.getComponent(v, c)];
        if (b && b.name) w.set(b.name, (w.get(b.name) || 0) + weight);
      }
    }
  });
  return w;
}

/**
 * The bones of `map` a converted character can actually be driven on, plus the two ways a converted
 * rig LOOKS rigged but is not:
 *
 *  - `leftBehind`: weighted bones sitting above a driven joint on the same limb. The runtime never
 *    rotates them, so the skin they carry stays behind and the limb bends at the wrong place — the
 *    classic "her thigh bends in the middle, not like a bone". A rig whose thigh is split into a
 *    twist bone at the hip plus a stretch bone at mid-thigh does this when the stretch bone is the
 *    one named `thigh.bend.L`.
 *  - `limbRatio`: the driven upper segment against the lower one. A thigh half the length of the
 *    shin means the driven bone is not the whole upper segment.
 */
export function rigReport(target, map = ANIMA_TO_MHX) {
  const { tb } = targetResolver(target);
  const wanted = [...new Set(map.flatMap(([, t, , ta]) => [t, ta]).filter(Boolean))];
  const matched = wanted.filter((name) => tb(name));
  const missing = wanted.filter((name) => !tb(name));
  const KEY = ['hip', 'spine', 'chest-1', 'neck', 'head', 'thigh.bend.L', 'shin.L', 'foot.L', 'upper_arm.bend.L', 'forearm.bend.L', 'hand0.L',
    'thigh.bend.R', 'shin.R', 'foot.R', 'upper_arm.bend.R', 'forearm.bend.R', 'hand0.R'];
  const driven = new Set(matched.map((name) => tb(name)).filter(Boolean));

  const weights = boneWeights(target);
  const maxW = Math.max(1, ...weights.values());
  // Bind-pose head positions: read from the skeleton's inverse bind matrices, so the measure is the
  // rig's own geometry and does not change with the pose the clip happens to be in.
  const bind = new Map();
  target.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton) return;
    o.skeleton.bones.forEach((b, i) => {
      const m = o.skeleton.boneInverses?.[i];
      if (!b || !m || bind.has(b.name)) return;
      bind.set(b.name, new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(m).invert()));
    });
  });
  const headOf = (b) => (b ? (bind.get(b.name) || new THREE.Vector3().setFromMatrixPosition(b.matrixWorld)) : null);
  const leftBehind = [];
  const limbRatio = {};
  const ancestors = (b) => { const out = new Set(); for (let n = b && b.parent, i = 0; n && n.isBone && i < 24; n = n.parent, i++) out.add(n); return out; };
  // A bone above the LEFT thigh that is also above the RIGHT one is the pelvis (miku's `下半身`),
  // not a piece of this leg left behind.
  const sharedByBoth = { thigh: new Set(), arm: new Set() };
  for (const [kind, a, b] of [['thigh', 'thigh.bend.L', 'thigh.bend.R'], ['arm', 'upper_arm.bend.L', 'upper_arm.bend.R']]) {
    const A = ancestors(tb(a)), B = ancestors(tb(b));
    for (const n of A) if (B.has(n)) sharedByBoth[kind].add(n);
  }
  for (const side of ['L', 'R']) {
    for (const [upper, lower, end] of [['thigh.bend.' + side, 'shin.' + side, 'foot.' + side],
      ['upper_arm.bend.' + side, 'forearm.bend.' + side, 'hand0.' + side]]) {
      const U = tb(upper), Lo = tb(lower), E = tb(end);
      const shared = sharedByBoth[upper.startsWith('thigh') ? 'thigh' : 'arm'];
      // Weighted, undriven bones between the driven joint and the body: the limb's real root.
      for (let n = U && U.parent, i = 0; n && n.isBone && i < 8; n = n.parent, i++) {
        if (driven.has(n) || shared.has(n) || /^(hip|hips|pelvis|root|chest|spine|torso)/i.test(n.name || '')) break;
        const w = weights.get(n.name) || 0;
        if (w > 0.05 * maxW) leftBehind.push({ joint: upper, bone: n.name, weight: +w.toFixed(1) });
      }
      const hU = headOf(U), hLo = headOf(Lo), hE = headOf(E);
      if (hU && hLo && hE) {
        const u = hU.distanceTo(hLo);
        const l = hLo.distanceTo(hE);
        limbRatio[upper] = +(u / Math.max(1e-6, l)).toFixed(2);
      }
    }
  }
  const ratioFlags = Object.entries(limbRatio).filter(([, r]) => r < 0.55 || r > 2.6).map(([k, r]) => `${k} ${r}`);
  // CHAIN: each driven joint must hang off the one above it. The retarget writes each bone's world
  // orientation and lets the hierarchy carry the positions, so a shin that is not under the thigh
  // rotates in place while the thigh swings away: the skin between them is stretched — warped.
  const chainBreaks = [];
  const under = (child, anc) => {
    for (let n = child && child.parent, i = 0; n && n.isBone && i < 64; n = n.parent, i++) if (n === anc) return true;
    return false;
  };
  const spine = ['hip', 'spine', 'chest', 'chest-1', 'neck', 'head'];
  for (let i = 1; i < spine.length; i++) {
    const A = tb(spine[i - 1]), B = tb(spine[i]);
    if (A && B && A !== B && !under(B, A)) chainBreaks.push(`${spine[i]} is not under ${spine[i - 1]}`);
  }
  for (const side of ['L', 'R']) {
    const chains = [['hip', 'thigh.bend.' + side, 'shin.' + side, 'foot.' + side],
      ['chest-1', 'clavicle.' + side, 'upper_arm.bend.' + side, 'forearm.bend.' + side, 'hand0.' + side],
      // ...and every finger, because a hand whose fingers do not follow it is stretched from the
      // wrist to wherever they went (raven's chained themselves to the chest).
      ['hand0.' + side, 'f_index.01.' + side, 'f_index.02.' + side],
      ['hand0.' + side, 'f_middle.01.' + side, 'f_middle.02.' + side],
      ['hand0.' + side, 'f_ring.01.' + side, 'f_ring.02.' + side],
      ['hand0.' + side, 'f_pinky.01.' + side, 'f_pinky.02.' + side],
      ['hand0.' + side, 'thumb.01.' + side, 'thumb.02.' + side],
      ['shin.' + side, 'foot.' + side]];
    for (const c of chains) {
      for (let i = 1; i < c.length; i++) {
        const A = tb(c[i - 1]), B = tb(c[i]);
        // A finger the skin does not use cannot distort anything, so only a weighted one counts.
        if (c[0].startsWith('hand0') && !(weights.get(B && B.name) > 0)) continue;
        if (A && B && A !== B && !under(B, A)) chainBreaks.push(`${c[i]} is not under ${c[i - 1]}`);
      }
    }
  }
  // Joints the exporter left out of the scene graph: three.js keeps a hole in `skeleton.bones` and
  // renders it as identity. Harmless while nothing is weighted to it; when something is, CPU skinning
  // throws and the vertices it carries collapse — so a hole is only reported when it carries weight.
  const holes = [];
  target.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton) return;
    const orphan = new Set();
    o.skeleton.bones.forEach((b, i) => { if (!b) orphan.add(i); });
    if (!orphan.size) return;
    const si = o.geometry?.attributes?.skinIndex, sw = o.geometry?.attributes?.skinWeight;
    let w = 0;
    if (si && sw) {
      for (let v = 0; v < si.count; v++) {
        for (let c = 0; c < si.itemSize; c++) if (orphan.has(si.getComponent(v, c))) w += sw.getComponent(v, c);
      }
    }
    if (w > 0) holes.push({ mesh: o.name, joints: orphan.size, weight: +w.toFixed(1) });
  });
  // WARP, MEASURED. Skinning a rig rotates and translates skin; it does not stretch it. So sample
  // edges of every skinned mesh and compare the posed length against the bind length: a rig that is
  // driven down a hierarchy the mesh does not share stretches the skin between the joints that moved
  // and the joints that did not. Ratios near 1 are healthy; the 95th percentile is the number that
  // moves first when something is wrong (a warped torso reads 1.4+ where a clean one reads 1.02).
  const stretch = [];
  const perMesh = [];
  let warpWorst = null;
  {
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), ra = new THREE.Vector3(), rb = new THREE.Vector3();
    target.traverse((o) => {
      const g = o.geometry, pos = g?.attributes?.position;
      if (!o.isSkinnedMesh || !pos) return;
      const idx = g.index;
      const edges = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 2);
      const step = Math.max(1, Math.floor(edges / 2500));
      const mine = [];
      for (let e = 0; e < edges && mine.length < 2500; e += step) {
        const i = idx ? idx.getX(e * 3) : e * 2;
        const j = idx ? idx.getX(e * 3 + 1) : e * 2 + 1;
        if (i >= pos.count || j >= pos.count) continue;
        // Compare the posed skin with the same authored wardrobe fit in bind
        // space. Mesh.getVertexPosition applies morphs without skinning; the
        // SkinnedMesh override below adds the current joint transforms.
        THREE.Mesh.prototype.getVertexPosition.call(o,i,ra);
        THREE.Mesh.prototype.getVertexPosition.call(o,j,rb);
        const bind = ra.distanceTo(rb);
        if (bind < 1e-5) continue;
        o.getVertexPosition(i, va); o.getVertexPosition(j, vb);
        const r = va.distanceTo(vb) / bind;
        stretch.push(r);
        mine.push(r);
      }
      if (mine.length) {
        const m = Math.max(...mine);
        mine.sort((a, b) => a - b);
        const e = { mesh: o.name, max: +m.toFixed(3), p95: +mine[Math.floor(mine.length * 0.95)].toFixed(3) };
        perMesh.push(e);
        if (!warpWorst || m > warpWorst.max) warpWorst = e;
      }
    });
    stretch.sort((a, b) => a - b);
  }
  // RELATIVE, because a model under a scaled root (honoka's is 0.29) reports every edge 1/0.29 longer
  // than its raw geometry: uniform, harmless, and it would mask nothing but noise. A warp is skin
  // stretched MORE than the rest of the same character, so the median is the baseline.
  const median = stretch.length ? stretch[Math.floor(stretch.length / 2)] : 1;
  var warpP95 = stretch.length ? +(stretch[Math.floor(stretch.length * 0.95)] / median).toFixed(3) : null;
  var warpMax = stretch.length ? +(stretch[stretch.length - 1] / median).toFixed(3) : null;
  for (const e of perMesh) { e.p95 = +(e.p95 / median).toFixed(3); e.max = +(e.max / median).toFixed(3); }
  // How much of the skin the driven bones actually hold. A conversion whose renamed bones carry no
  // vertices looks rigged and never moves: the retarget poses bones the mesh does not follow.
  const wTotal = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const share = (names) => names.reduce((a, name) => { const b = tb(name); return a + (b ? (weights.get(b.name) || 0) : 0); }, 0) / wTotal;
  // A rigid accessory can have zero edge stretch while being completely detached
  // from the animated hierarchy. Detect that separately from deformation.
  const unanchored = [];
  for (const [name, weight] of weights) {
    let bone = target.getObjectByName(name);
    while (bone && !driven.has(bone)) bone = bone.parent;
    if (!bone && weight > 1) unanchored.push({ bone: name, weight: +weight.toFixed(1) });
  }
  const drivenShare = +share(matched).toFixed(2);
  const keyShare = +share(KEY).toFixed(2);
  return { matched, missing, wanted, total: wanted.length, key: KEY, keyMissing: KEY.filter((name) => !tb(name)),
    leftBehind, limbRatio, ratioFlags, holes, chainBreaks, unanchored, drivenShare, keyShare,
    warp: { p95: warpP95, max: warpMax, edges: stretch.length, worst: warpWorst,
      meshes: perMesh.sort((a, b) => b.p95 - a.p95).slice(0, 5) },
    drivable: matched.length >= 10,
    ok: matched.length >= 10 && !leftBehind.length && !ratioFlags.length && !holes.length && !chainBreaks.length
      && !unanchored.length && keyShare >= 0.05 && (warpP95 ?? 1) < 1.15 };
}

// GROUND CONTACT. The hips are carried over scaled by the ratio of leg lengths, which is exact for
// the T-pose and drifts once the body folds or lies down: a character whose shin, foot or heel
// proportions differ from the Anima rig's crouches with its knees in the floor, or stands bent over
// with its feet a hand's width above it (white_woman on Standing_Doggy: 6.7 cm); a heavier body
// lying on its back sinks its back and buttocks into the floor (the mannequin is slim).
// So each frame the parts that can carry weight are compared with the source's:
//   limbs   ankles, knees, hands: the target joint at the source joint's height scaled by k (an
//           ankle keeps its T-pose height: heels), since a knee or a wrist is about as thick on
//           every adult;
//   torso   hips, chest, head: the SKIN under the joint, measured: each body's skin points around
//           the joint (bind pose, joint frame) give its support distance in whatever direction is
//           down this frame, so the target's skin is put as far over the floor as the source's.
// A soft minimum over the source's heights picks what is carrying the weight, so the correction does
// not jump when the weight moves from the feet to the knees; it fades out when the source is off its
// floor (jumps, the Read Me platforms), so nothing is pulled down to a floor the clip is not using.
const GROUND_JOINTS = [['foot.l', 'foot.L', true], ['foot.r', 'foot.R', true], ['leg_stretch.l', 'shin.L'], ['leg_stretch.r', 'shin.R'],
  ['hand.l', 'hand0.L'], ['hand.r', 'hand0.R']];
// torso joint, its region (bones whose skin it carries), source and target names
const GROUND_TORSO = [
  [['pelvis', 'root.x'], ['pelvis', 'root.x', 'spine_01.x'], ['hip'], ['hip', 'pelvis', 'spine']],
  [['spine_03.x'], ['spine_02.x', 'spine_03.x'], ['chest-1', 'chest'], ['chest', 'chest-1']],
  [['head.x'], ['neck.x', 'head.x'], ['head'], ['neck', 'head']],
];
// where a region stops: the limbs and the next torso region begin at these
const REGION_ROOTS = {
  src: ['pelvis', 'root.x', 'spine_01.x', 'spine_02.x', 'spine_03.x', 'neck.x', 'head.x', 'thigh_stretch.l', 'thigh_stretch.r', 'arm_stretch.l', 'arm_stretch.r', 'shoulder.l', 'shoulder.r'],
  tgt: ['hip', 'pelvis', 'spine', 'chest', 'chest-1', 'neck', 'head', 'thigh.bend.L', 'thigh.bend.R', 'upper_arm.bend.L', 'upper_arm.bend.R', 'clavicle.L', 'clavicle.R'],
};
// GROUND_MAX lowers at most (an export whose origin is under its soles: shaki 35 cm); GROUND_RAISE raises at most: a heavy
// creature lying on its back (yoshi, nosach) needs 30-40 cm more than the slim mannequin.
export const GROUND_NEAR = 0.15, GROUND_FAR = 0.35, GROUND_SOFT = 0.03, GROUND_MAX = 0.4, GROUND_RAISE = 0.45, LIMB_RADIUS = 0.04;
// Skin that does not carry weight even though it hangs off a torso bone: hair, tails, cloth.
const LOOSE_BONE = /tail|hair|bang|braid|ponytail|shaft|penis|testic|balls|skirt|cloth|cape|ribbon|chain|strap/i;
const LOOSE_MESH = /hair|lash|brow|scalp|bang|braid|strand|ponytail|tail|cape/i;

/**
 * The vertical correction for one frame (pure, so tests can check it). `joints` = [{ h, d }]: h the
 * source's height over its floor at that part (skin for the torso, joint less LIMB_RADIUS for a
 * limb), d the metres the target must rise for its own part to match. Returns metres to raise it.
 */
export function groundCorrection(joints) {
  if (!joints.length) return 0;
  const low = Math.min(...joints.map((j) => j.h));
  const w = Math.max(0, Math.min(1, (GROUND_FAR - low) / (GROUND_FAR - GROUND_NEAR)));
  if (!w) return 0;
  let sum = 0, wt = 0;
  for (const j of joints) {
    const a = Math.exp(-(j.h - low) / GROUND_SOFT);
    sum += a * j.d;
    wt += a;
  }
  return Math.max(-GROUND_MAX, Math.min(GROUND_RAISE, (sum / wt) * w));
}

/** The lowest skin of a model as it stands now (at rest when called before any pose), in its own
 * space; cached per geometry. Strided: a few millimetres at most. */
const restFloorCache = new WeakMap();
export function restFloor(root) {
  let first = null;
  root.traverse((o) => { if (!first && o.isSkinnedMesh) first = o; });
  if (first && restFloorCache.has(first.geometry)) return restFloorCache.get(first.geometry);
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), v = new THREE.Vector3();
  let low = Infinity;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const n = o.geometry.attributes.position.count, step = Math.max(1, Math.floor(n / 8000));
    for (let i = 0; i < n; i += step) { o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).applyMatrix4(inv); if (v.y < low) low = v.y; }
  });
  const out = Number.isFinite(low) ? low : 0;
  if (first) restFloorCache.set(first.geometry, out);
  return out;
}

// Skin points of a region in its joint's bind frame (cached per geometry: clones share them).
const supportCache = new WeakMap();
const _sv = new THREE.Vector3(), _sm = new THREE.Matrix4();
/** Up to `max` skin points of the vertices `members` carry (stopping at `roots`), in `joint`'s bind frame. */
export function supportPoints(model, joint, members, roots, { max = 400 } = {}) {
  if (!joint) return null;
  let mine = null;
  model.traverse((o) => { if (!mine && o.isSkinnedMesh) mine = o; });
  const key = mine?.geometry;
  if (key) { const c = supportCache.get(key)?.get(joint.name); if (c !== undefined) return c; }
  const pts = [];
  model.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton || !o.geometry?.attributes?.skinIndex) return;
    const bones = o.skeleton.bones, ji = bones.indexOf(joint);
    if (ji < 0 || !o.skeleton.boneInverses[ji]) return;
    // which region each of this skeleton's bones belongs to
    const names = `${o.name} ${(Array.isArray(o.material) ? o.material : [o.material]).map((m) => m?.name || '').join(' ')}`;
    if (LOOSE_MESH.test(names)) return;
    const region = bones.map((bone) => { for (let b = bone; b && b.isBone; b = b.parent) { if (roots.has(b)) return members.has(b); if (LOOSE_BONE.test(b.name)) return false; } return false; });
    if (!region.some(Boolean)) return;
    _sm.multiplyMatrices(o.skeleton.boneInverses[ji], o.bindMatrix);
    const g = o.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const step = Math.max(1, Math.floor(pos.count / 30000));
    for (let v = 0; v < pos.count; v += step) {
      let best = -1, bw = 0;
      for (let c = 0; c < si.itemSize; c++) { const w = sw.getComponent(v, c); if (w > bw) { bw = w; best = si.getComponent(v, c); } }
      if (best < 0 || !region[best]) continue;
      _sv.fromBufferAttribute(pos, v).applyMatrix4(_sm);
      pts.push(_sv.x, _sv.y, _sv.z);
    }
  });
  let out = null;
  if (pts.length) {
    const n = pts.length / 3, take = Math.min(n, max), stride = n / take;
    out = new Float32Array(take * 3);
    for (let i = 0; i < take; i++) { const k = Math.floor(i * stride) * 3; out.set([pts[k], pts[k + 1], pts[k + 2]], i * 3); }
  }
  if (key) { if (!supportCache.has(key)) supportCache.set(key, new Map()); supportCache.get(key).set(joint.name, out); }
  return out;
}
/**
 * A converted character's torso support shapes, by role: { hip, chest, head } -> { bone, pts }, for
 * anything that rests a body on a surface (world/device-fit.js seats and kneelers).
 */
export function torsoSupport(model) {
  const { tb0 } = targetResolver(model);
  const pick = (names) => names.map(tb0).filter(Boolean);
  const roots = new Set(pick(REGION_ROOTS.tgt)), out = {};
  for (const [key, [, , tj, tm]] of [['hip', GROUND_TORSO[0]], ['chest', GROUND_TORSO[1]], ['head', GROUND_TORSO[2]]]) {
    const bone = pick(tj)[0];
    const pts = bone ? supportPoints(model, bone, new Set(pick(tm)), roots) : null;
    if (bone && pts) out[key] = { bone, pts };
  }
  return out;
}
/** How far the skin reaches below a joint this frame (world metres): the support of its points along world down. */
export function supportBelow(joint, pts) {
  if (!pts) return 0;
  const e = joint.matrixWorld.elements;
  // down (0,-1,0) taken into the joint's frame through the transpose of its 3x3 (rotation x scale)
  const dx = -e[1], dy = -e[5], dz = -e[9];
  let m = 0;
  for (let i = 0; i < pts.length; i += 3) { const d = pts[i] * dx + pts[i + 1] * dy + pts[i + 2] * dz; if (d > m) m = d; }
  return m;
}

export function createRetargeter({ source, target, tposeClip, map = ANIMA_TO_MHX, ground = !globalThis.__rosebudNoGround }) {
  // The Party exports of the Anima rig call the hips `root.x`; the others `pelvis`.
  const sb = (name) => source.getObjectByName(n(name)) || (name === 'pelvis' ? source.getObjectByName(n('root.x')) : undefined);
  const { tb0, tb } = targetResolver(target);
  // the target's own soles, at rest, before it is bent into the T (see GROUND CONTACT)
  const restFloorT = ground ? restFloor(target) : 0;
  // Three-digit creature hands cannot take a five-finger human curl safely.
  // Keep their authored claw articulation while the wrist follows the clip.
  const preserveDigits = !tb0('f_index.01.L') && !tb0('f_index.01.R')
    && (tb0('f_middle.01.L') || tb0('f_middle.01.R'));
  const seenT = new Set();
  const pairs = [];
  // TWO PASSES, EXACT NAMES FIRST. A rig can be missing a bone in the middle of a chain — merida's
  // spine has hip/spine/spine-1 and no `chest` — and then the stand-in for the missing one (`chest`
  // -> `chest-1`) would take the bone that the next entry names exactly, leaving that entry to aim a
  // bone at ITSELF: the swing vector is zero, normalize gives NaN, and the torso shears. Exact
  // matches get their bone first; stand-ins only fill what is still missing.
  for (const pass of [0, 1]) {
    for (const [s, t, sa, ta] of map) {
      if (preserveDigits && /^(f_|thumb\.)/.test(t)) continue;
      const src = sb(s);
      if (!src) continue;
      const T = pass === 0 ? tb0(t) : tb(t);
      if (!T || seenT.has(T)) continue;
      let TA = ta ? tb(ta) : null;
      if (TA === T) TA = null;
      seenT.add(T);
      pairs.push({ s: src, t: T, sa: sa && sb(sa), ta: TA, neckStandIn: ta === 'neck' && !tb0(ta) });
    }
  }
  if (pairs.length < 10) throw new Error(`retarget: only ${pairs.length} bones matched`);

  // --- source reference: the Tpose take, evaluated on its own mixer at t=0 --------------------
  const saved = new Map();
  source.traverse((o) => { if (o.isBone) saved.set(o, { q: o.quaternion.clone(), p: o.position.clone() }); });
  // Measure WHILE the action is active: stopping an action restores the bindings' original values.
  let mix = null;
  if (tposeClip) {
    mix = new THREE.AnimationMixer(source);
    mix.clipAction(tposeClip).play();
    mix.update(0);
  }
  source.updateMatrixWorld(true);
  const sRef = new Map();
  for (const p of pairs) { const q = new THREE.Quaternion(); const v = new THREE.Vector3(); modelSpace(source, p.s, q, v); sRef.set(p, { q, v }); }
  // Where each aimed-at joint is in the T too: a joint the target has no bone for (a rig with no
  // neck) is not a pair, and read later it would be wherever the clip last left it.
  const sAim = new Map();
  for (const p of pairs) if (p.sa && !sAim.has(p.sa)) { const v = new THREE.Vector3(); modelSpace(source, p.sa, null, v); sAim.set(p.sa, v); }
  const Y = new THREE.Vector3(0, 1, 0);
  const sFrame = frameQuat(source, FRAME.src.map(sb), Y);
  const sHip = new THREE.Vector3(); modelSpace(source, sb('pelvis'), null, sHip);
  const sLeg = legLength(source, LEGS.src.map(sb));
  if (mix) { mix.stopAllAction(); mix.uncacheRoot(source); }
  for (const [o, v] of saved) { o.quaternion.copy(v.q); o.position.copy(v.p); }
  source.updateMatrixWorld(true);

  // --- target reference: rest, bent into the source's T, parent first --------------------------
  target.updateMatrixWorld(true);
  let tFrame0 = frameQuat(target, FRAME.tgt.map(tb));
  let preserveTorso = false;
  // A creature modelled hunched over (Nosach: hips to neck leans 60 degrees forward) would tip the
  // whole frame with it, and its hips would be set that far round and into the ground. Its model's
  // own up is the better up then; a body standing roughly upright keeps the measured one.
  if (Y.clone().applyQuaternion(tFrame0).angleTo(Y) > THREE.MathUtils.degToRad(30)) {
    preserveTorso = true;
  }
  tFrame0 = frameQuat(target, FRAME.tgt.map(tb), Y);
  const G = tFrame0.clone().multiply(sFrame.clone().invert());
  const tRest = new Map();
  target.traverse((o) => { if (o.isBone) tRest.set(o, o.quaternion.clone()); });
  // The head keeps facing the way it faced at rest: a creature built hunched forward (Nosach) is
  // stood up by the spine's bend, and its head would otherwise be carried round to face the sky.
  const headPair = pairs.find((p) => p.t === tb0('head'));
  const headRest = new THREE.Quaternion();
  if (headPair) modelSpace(target, headPair.t, headRest);
  const torso = new Set(['hip', 'spine', 'chest', 'chest-1', 'neck', 'head'].map(tb).filter(Boolean));
  for (const p of pairs) {
    if (!p.sa || !p.ta) continue;
    // No neck bone: the chest would be aimed at the head instead, and a neck built leaning forward
    // (Throh'gar) would tip the chest back and the face to the sky. The chest keeps its own set.
    // Keep a creature's authored hunch. Forcing its torso into a human T-pose
    // stretches skin around the neck and shoulders before any clip even plays.
    if (p.neckStandIn || (preserveTorso && torso.has(p.t))) continue;
    const sv = new THREE.Vector3(); modelSpace(source, p.s, null, sv);
    target.updateMatrixWorld(true);
    // desired direction, in the target's model space
    const want = sRefPos(p.sa).sub(sRef.get(p).v).applyQuaternion(G).normalize();
    const a = new THREE.Vector3(); const b = new THREE.Vector3();
    const tq = new THREE.Quaternion();
    modelSpace(target, p.t, tq, a);
    modelSpace(target, p.ta, null, b);
    const have = b.sub(a).normalize();
    const swing = new THREE.Quaternion().setFromUnitVectors(have, want);
    const newModel = swing.multiply(tq);
    // back to local: parent's model-space rotation
    const pq = new THREE.Quaternion();
    if (p.t.parent && p.t.parent !== target) modelSpace(target, p.t.parent, pq);
    p.t.quaternion.copy(pq.invert().multiply(newModel));
    target.updateMatrixWorld(true);
  }
  if (headPair) {
    const pq = new THREE.Quaternion();
    if (headPair.t.parent && headPair.t.parent !== target) modelSpace(target, headPair.t.parent, pq);
    headPair.t.quaternion.copy(pq.invert().multiply(headRest));
    target.updateMatrixWorld(true);
  }
  function sRefPos(bone) {
    const pr = pairs.find((x) => x.s === bone);
    if (pr) return sRef.get(pr).v.clone();
    if (sAim.has(bone)) return sAim.get(bone).clone();
    const v = new THREE.Vector3(); modelSpace(source, bone, null, v); return v;
  }
  const offsets = new Map();
  for (const p of pairs) {
    const tq = new THREE.Quaternion(); modelSpace(target, p.t, tq);
    const gs = G.clone().multiply(sRef.get(p).q);
    offsets.set(p, gs.invert().multiply(tq));
  }
  const tHip = new THREE.Vector3(); modelSpace(target, tb('hip'), null, tHip);
  const tLeg = legLength(target, LEGS.tgt.map(tb));
  const k = tLeg / sLeg;
  // ground joints, with their T-pose offsets (both bodies stand on their floor in the T)
  const groundJoints = [];
  if (ground) {
    // An ankle's height is measured from the body's own soles: most exports stand on their origin,
    // some do not (shaki's origin is 35 cm under her soles). The target's soles are its lowest skin
    // at rest (restFloor, measured before it is bent into the T); the Anima stands on its origin.
    for (const [s, t, foot] of GROUND_JOINTS) {
      const S = sb(s), T = tb0(t);
      if (!S || !T) continue;
      const pr = pairs.find((p) => p.s === S);
      const sy = pr ? sRef.get(pr).v.y : null;
      const tv = new THREE.Vector3(); modelSpace(target, T, null, tv);
      groundJoints.push({ S, T, e: foot && sy != null ? tv.y - restFloorT - k * sy : 0, h: 0, d: 0 });
    }
    const pick = (resolve, names) => names.map(resolve).filter(Boolean);
    const sRoots = new Set(pick(sb, REGION_ROOTS.src)), tRoots = new Set(pick(tb0, REGION_ROOTS.tgt));
    for (const [sj, sm, tj, tm] of GROUND_TORSO) {
      const S = pick(sb, sj)[0], T = pick(tb0, tj)[0];
      if (!S || !T) continue;
      const sp = supportPoints(source, S, new Set(pick(sb, sm)), sRoots), tp = supportPoints(target, T, new Set(pick(tb0, tm)), tRoots);
      if (sp && tp) groundJoints.push({ S, T, torso: true, sp, tp, h: 0, d: 0 });
    }
  }
  // restore the target's rest; the per-frame pass sets every mapped bone anyway
  for (const [o, q] of tRest) o.quaternion.copy(q);
  // Hips: target hip = G * (source pelvis * k) + c, with c putting the reference hips together.
  const c = tHip.clone().sub(sHip.clone().multiplyScalar(k).applyQuaternion(G));
  const Ginv = G.clone().invert();
  // Parent-first order for the per-frame pass.
  const order = [];
  target.traverse((o) => { const pr = pairs.find((x) => x.t === o); if (pr) order.push(pr); });

  const sq = new THREE.Quaternion();
  const sp = new THREE.Vector3();
  const pq = new THREE.Quaternion();
  const want = new THREE.Quaternion();
  const hipBone = tb('hip');
  const sourceHip = sb('pelvis');
  const sourceInv = new THREE.Matrix4();
  const targetInv = new THREE.Matrix4();
  const hipParentInv = new THREE.Matrix4();
  const pairByBone = new Map(order.map((p) => [p.t, p]));
  const nodes = [];
  target.traverse((o) => { if (o !== target) nodes.push(o); });
  // TAILS (the converter names their bones tail1, tail2, ...): no clip moves them, so they sway, each
  // segment a little behind the one before, side to side with a slower lift, more toward the tip.
  const tail = [];
  for (let i = 1; i < 40; i++) { const b = target.getObjectByName(`tail${i}`); if (!b) break; tail.push({ b, rest: b.quaternion.clone() }); }
  const cloth = [];
  target.traverse((o) => {
    if (o.isBone && /^(?:Shoulder[LR]\d+|Leg[LR]\d+)$/.test(o.name)) {
      cloth.push({ b: o, rest: o.quaternion.clone(), phase: cloth.length * 0.45 });
    }
  });
  const _tq = new THREE.Quaternion(), _tz = new THREE.Vector3(0, 0, 1), _tx = new THREE.Vector3(1, 0, 0);
  const tailPhase = Math.random() * 10;
  let lastGround = 0;
  return {
    pairs: order.length,
    G,
    scale: k,
    /** Copy the source's current pose. Places the target so it overlaps the source in the world. */
    apply() {
      target.position.copy(source.position);
      target.quaternion.copy(source.quaternion).multiply(Ginv);
      target.scale.copy(source.scale);
      source.updateMatrixWorld(true);
      target.updateWorldMatrix(true, false);
      sourceInv.copy(source.matrixWorld).invert();
      targetInv.copy(target.matrixWorld).invert();
      _m.multiplyMatrices(sourceInv, sourceHip.matrixWorld);
      sp.setFromMatrixPosition(_m).multiplyScalar(k).applyQuaternion(G).add(c);
      if (tail.length) {
        const t = performance.now() / 1000 + tailPhase;
        const n = tail.length;
        tail.forEach(({ b, rest }, i) => {
          const k = 0.35 + (0.65 * i) / n;               // stiff at the root, free at the tip
          b.quaternion.copy(rest)
            .multiply(_tq.setFromAxisAngle(_tz, Math.sin(t * 1.6 - i * 0.5) * 0.16 * k))
            .multiply(_tq.setFromAxisAngle(_tx, Math.sin(t * 0.7 - i * 0.3) * 0.07 * k));
        });
      }
      if (cloth.length) {
        const t = performance.now() / 1000 + tailPhase;
        for (const { b, rest, phase } of cloth) {
          b.quaternion.copy(rest)
            .multiply(_tq.setFromAxisAngle(_tx, Math.sin(t * 2.4 - phase) * 0.045))
            .multiply(_tq.setFromAxisAngle(_tz, Math.cos(t * 1.7 - phase * 0.7) * 0.035));
        }
      }
      // Visit every node once, parent first, including passive twist/face/cloth bones.
      // Updating each driven bone's entire subtree re-evaluated the same large skeleton
      // dozens of times. Parents are current here without recursively updating children.
      for (const node of nodes) {
        const p = pairByBone.get(node);
        if (p) {
          _m.multiplyMatrices(sourceInv, p.s.matrixWorld).decompose(_p, sq, _s);
          want.copy(G).multiply(sq).multiply(offsets.get(p));
          if (node.parent !== target) {
            _m.multiplyMatrices(targetInv, node.parent.matrixWorld).decompose(_p, pq, _s);
            pq.invert();
          } else pq.identity();
          node.quaternion.copy(pq.multiply(want));
        }
        if (node === hipBone) {
          hipBone.position.copy(sp);
          if (node.parent !== target) {
            hipParentInv.multiplyMatrices(targetInv, node.parent.matrixWorld).invert();
            hipBone.position.applyMatrix4(hipParentInv);
          }
        }
        node.updateWorldMatrix(false, false);
      }
      if (groundJoints.length) {
        // Heights over each root's own floor, in the roots' own units (the roots stand on their
        // floor). Read straight from the matrices the pass above just wrote: no extra walks.
        const se = source.matrixWorld.elements, te = target.matrixWorld.elements;
        const unit = Math.hypot(se[4], se[5], se[6]) || 1;
        for (const j of groundJoints) {
          const s = (j.S.matrixWorld.elements[13] - se[13]) / unit, t = (j.T.matrixWorld.elements[13] - te[13]) / unit;
          if (j.torso) {
            const ss = s - supportBelow(j.S, j.sp) / unit, ts = t - supportBelow(j.T, j.tp) / unit;
            j.h = ss; j.d = ss - ts;
          } else { j.h = s - LIMB_RADIUS; j.d = k * s + j.e - t; }
        }
        const dy = groundCorrection(groundJoints);
        lastGround = dy;
        if (Math.abs(dy) > 1e-4) {
          // raise the root, and carry every world matrix below it by the same world offset
          const ps = target.parent ? target.parent.matrixWorld.elements : null;
          const parentUnit = ps ? Math.hypot(ps[4], ps[5], ps[6]) || 1 : 1;
          target.position.y += (dy * unit) / parentUnit;
          target.updateMatrix();
          te[13] += dy * unit;
          for (const node of nodes) node.matrixWorld.elements[13] += dy * unit;
        }
      }
    },
    /** The last frame's ground correction (metres the target was raised; negative = lowered). */
    get ground() { return lastGround; },
  };
}

function legLength(root, [a, b, c]) {
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  modelSpace(root, a, null, pa); modelSpace(root, b, null, pb); modelSpace(root, c, null, pc);
  return pa.distanceTo(pb) + pb.distanceTo(pc);
}
