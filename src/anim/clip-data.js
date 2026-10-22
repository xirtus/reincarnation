// THE BAKED CLIPS AS DATA: decoding the compact records scripts/anim/bake-clips.mjs writes, making
// the left twin of a right-hand clip, and reading root motion. No three.js here, so node tests can
// check it; src/anim/animator.js turns the result into THREE.AnimationClips.
//
// A record (rosebud's compact format, plus root motion):
//   { name, duration, fps, n, q: { bone: base64 Int16 x 32767 | [x,y,z,w] when it never moves },
//     p: base64 Int16, the pelvis in millimetres of the Armature frame,
//     rm?: base64 Int16, per frame x, y, z in millimetres of model space and yaw in milliradians,
//          relative to the first frame. Yaw is right-positive, like every angle in src/anim. }

function fromBase64(s) {
  if (typeof atob === 'function') { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  return Uint8Array.from(Buffer.from(s, 'base64'));
}
const int16 = (s) => { const b = fromBase64(s); return new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1); };

/** A compact record -> { name, duration, fps, n, times, tracks: {bone: Float32Array}, pelvisPos, rm }. */
export function decodeClip(rec) {
  const n = rec.n, times = new Float32Array(n);
  for (let i = 0; i < n; i++) times[i] = Math.min(rec.duration, i / rec.fps);
  const tracks = {};
  for (const [bone, v] of Object.entries(rec.q)) {
    if (Array.isArray(v)) { tracks[bone] = Float32Array.from(v); continue; }
    const q = int16(v), out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) out[i] = q[i] / 32767;
    tracks[bone] = out;
  }
  const p = int16(rec.p), pelvisPos = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) pelvisPos[i] = p[i] / 10;
  let rm = null;
  if (rec.rm) {
    const r = int16(rec.rm);
    rm = new Float32Array(r.length);
    for (let i = 0; i < r.length; i++) rm[i] = r[i] / 1000;
  }
  return { name: rec.name, duration: rec.duration, fps: rec.fps, n, times, tracks, pelvisPos, rm };
}

// --- quaternions on plain arrays ---------------------------------------------------------------------
export function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function qnorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
/** The rotation mirrored across the plane whose normal is `n`: axis reflected, sense reversed. */
export function qreflect(q, n) {
  const d = 2 * (q[0] * n[0] + q[1] * n[1] + q[2] * n[2]);
  return [-q[0] + d * n[0], -q[1] + d * n[1], -q[2] + d * n[2], q[3]];
}
const vreflect = (v, n) => { const d = 2 * (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]); return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]]; };

/** 'thigh_stretch.l' <-> 'thigh_stretch.r'; centre bones ('.x') are their own twin. */
export const twinBone = (b) => b.replace(/\.(l|r)$/, (_, s) => (s === 'l' ? '.r' : '.l'));

const at = (track, i) => (track.length === 4 ? Array.from(track) : Array.from(track.subarray(i * 4, i * 4 + 4)));

/**
 * The left twin of a decoded clip. `skeleton` is manifest.skeleton: the bones parent-first, a
 * symmetric reference pose (`ref`), the axis across the body in the Armature frame (`across`), the
 * model frame (`model.right`) the root motion is in, and the arm bones.
 *
 * Each bone's rotation away from the reference is mirrored onto its twin, in the Armature frame, so it
 * does not matter how the rig's left and right bones happen to be oriented. mode 'legs' mirrors the
 * whole body except the arms, which keep their own local rotations: a blade, torch or bow stays in
 * the hand that holds it, and the arms ride on the mirrored chest.
 */
export function mirrorClip(d, skeleton, mode = 'full', name = d.name) {
  const n = d.n, across = skeleton.across, keep = new Set(mode === 'legs' ? skeleton.arms : []);
  const bones = skeleton.bones.filter((b) => d.tracks[b.name]);
  const refW = {};
  for (const b of skeleton.bones) refW[b.name] = qnorm(b.parent ? qmul(refW[b.parent], skeleton.ref[b.name]) : skeleton.ref[b.name]);
  const out = {};
  for (const b of bones) out[b.name] = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const W = {}, M = {};
    for (const b of skeleton.bones) {
      const local = d.tracks[b.name] ? at(d.tracks[b.name], i) : skeleton.ref[b.name];
      W[b.name] = qnorm(b.parent ? qmul(W[b.parent], local) : local);
    }
    for (const b of skeleton.bones) {
      const parentM = b.parent ? M[b.parent] : [0, 0, 0, 1];
      let local;
      if (keep.has(b.name)) local = d.tracks[b.name] ? at(d.tracks[b.name], i) : skeleton.ref[b.name];
      else {
        const t = twinBone(b.name);
        const delta = qmul(W[t], qconj(refW[t]));                          // the twin's turn from the reference
        const world = qmul(qreflect(delta, across), refW[b.name]);
        local = qnorm(qmul(qconj(parentM), world));
      }
      M[b.name] = qnorm(qmul(parentM, local));
      if (out[b.name]) out[b.name].set(local, i * 4);
    }
  }
  const pelvisPos = new Float32Array(d.pelvisPos.length);
  for (let i = 0; i < d.pelvisPos.length; i += 3) pelvisPos.set(vreflect([d.pelvisPos[i], d.pelvisPos[i + 1], d.pelvisPos[i + 2]], across), i);
  let rm = null;
  if (d.rm) {
    rm = new Float32Array(d.rm.length);
    const right = skeleton.model.right;
    for (let i = 0; i < d.rm.length; i += 4) {
      rm.set(vreflect([d.rm[i], d.rm[i + 1], d.rm[i + 2]], right), i);
      rm[i + 3] = -d.rm[i + 3];
    }
  }
  // a bone that comes out still (both twins held still) goes back to one key
  for (const b of bones) {
    const v = out[b.name];
    let still = true;
    for (let i = 4; i < v.length && still; i++) if (Math.abs(v[i] - v[i % 4]) > 1e-4) still = false;
    if (still) out[b.name] = v.slice(0, 4);
  }
  return { ...d, name, tracks: out, pelvisPos, rm };
}

/** Root motion at time t (seconds, clamped to the clip): [x, y, z, yaw] in model space. */
export function rootMotionAt(d, t) {
  if (!d.rm) return [0, 0, 0, 0];
  const f = Math.max(0, Math.min(d.n - 1, t * d.fps)), i = Math.floor(f), k = f - i, j = Math.min(d.n - 1, i + 1);
  const r = d.rm;
  return [0, 1, 2, 3].map((c) => r[i * 4 + c] + (r[j * 4 + c] - r[i * 4 + c]) * k);
}

/**
 * Root motion between two playback times of the same clip, in the clip's start frame. A looping
 * clip that wrapped (t1 < t0, or `wraps` > 0 whole cycles) adds the travel of each full cycle.
 */
export function rootMotionBetween(d, t0, t1, wraps = t1 < t0 ? 1 : 0) {
  const a = rootMotionAt(d, t0), b = rootMotionAt(d, t1);
  if (!wraps) return b.map((v, c) => v - a[c]);
  const end = rootMotionAt(d, d.duration);
  return b.map((v, c) => end[c] - a[c] + v + end[c] * (wraps - 1));
}
