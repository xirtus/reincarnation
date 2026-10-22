// PLAYING THE CLIPS ON A CHARACTER: bundles loaded when first wanted, left twins mirrored on load,
// cross-fades, an upper-body overlay, and the root motion of whatever is playing handed back to the
// controller each frame. Works the same under WebGPURenderer and WebGLRenderer (animation is CPU).
//
//   const animator = createAnimator({ model: gltf.scene, manifest, baseUrl: '/anim/' });
//   await animator.want('move');                        // or let play() fetch on demand
//   animator.play('rpgWalkAIdleToF', { fade: 0.15 });
//   const { move, yaw } = animator.update(dt);          // apply to the body when the clip drives it
//
// `model` is a loaded 44-bone Anima character (rosebud's casting pipeline). Bone names are matched
// through THREE.PropertyBinding.sanitizeNodeName, as GLTFLoader names them.

import * as THREE from 'three';
import { decodeClip, mirrorClip, rootMotionBetween } from './clip-data.js';
import { createClipLibrary } from './clip-library.js';

const node = (b) => THREE.PropertyBinding.sanitizeNodeName(b);

/** A decoded clip (src/anim/clip-data.js) -> THREE.AnimationClip; `only`/`except` filter bones. */
export function toThreeClip(d, root = 'pelvis', { only = null, except = null } = {}) {
  const one = new Float32Array([0]);
  const take = (b) => (!only || only.has(b)) && (!except || !except.has(b));
  const tracks = Object.entries(d.tracks).filter(([b]) => take(b))
    .map(([b, v]) => new THREE.QuaternionKeyframeTrack(`${node(b)}.quaternion`, v.length === 4 ? one : d.times, v));
  if (take(root)) tracks.push(new THREE.VectorKeyframeTrack(`${node(root)}.position`, d.times, d.pelvisPos));
  return new THREE.AnimationClip(d.name, d.duration, tracks);
}

export function createAnimator({ model, manifest, baseUrl = './anim/', fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)) }) {
  const lib = createClipLibrary(manifest);
  const skeleton = manifest.skeleton;
  const mixer = new THREE.AnimationMixer(model);
  const data = new Map();         // id -> decoded clip
  const clips = new Map();        // id|mask -> THREE.AnimationClip
  const loading = new Map();      // bundle -> Promise
  const listeners = new Set();
  let base = null, overlay = null;                 // { id, action, data, t, startQ, rootMotion }
  const q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();

  /** Load a bundle once; resolves to the ids it made playable (its own and their mirrored twins). */
  function want(bundle) {
    if (!loading.has(bundle)) {
      const info = manifest.bundles[bundle];
      loading.set(bundle, (info ? fetchJson(baseUrl + info.url) : Promise.resolve(null)).then((json) => {
        const made = [];
        for (const rec of json?.clips || []) { data.set(rec.name, decodeClip(rec)); made.push(rec.name); }
        for (const c of lib.clips) {
          if (!c.mirrorOf || !data.has(c.mirrorOf) || data.has(c.id)) continue;
          data.set(c.id, mirrorClip(data.get(c.mirrorOf), skeleton, c.mirror || 'full', c.id));
          made.push(c.id);
        }
        return made;
      }).catch(() => []));
    }
    return loading.get(bundle);
  }
  const ready = (id) => data.has(id);

  function clipFor(id, mask) {
    const key = mask ? `${id}|${mask.name}` : id;
    if (!clips.has(key)) {
      const d = data.get(id);
      clips.set(key, toThreeClip(d, skeleton.root, mask ? { [mask.mode]: mask.bones } : {}));
    }
    return clips.get(key);
  }

  function start(id, opts, layer) {
    const meta = lib.get(id);
    const d = data.get(id);
    const loop = opts.loop ?? meta?.loop ?? false;
    const mask = opts.mask ? { name: opts.maskName || opts.mask.join(','), mode: layer === 'overlay' ? 'only' : 'except', bones: new Set(opts.mask) } : null;
    const action = mixer.clipAction(clipFor(id, layer === 'overlay' ? mask : null));
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = opts.timeScale ?? 1;
    action.setEffectiveWeight(1);
    action.play();
    model.getWorldQuaternion(q);
    return { id, action, data: d, t: 0, loops: 0, startQ: q.clone(), rootMotion: opts.rootMotion ?? !loop, mask };
  }

  /**
   * Play a clip as the base layer, cross-fading from what was playing. Resolves false when the clip
   * is unknown; when its bundle has not arrived it loads it first. Options: fade (s), loop,
   * timeScale, rootMotion (hand its travel to update(); default for one-shots).
   */
  async function play(id, opts = {}) {
    if (!ready(id)) {
      const bundle = lib.bundleOf(id);
      if (!bundle) return false;
      await want(bundle);
      if (!ready(id)) return false;
    }
    const next = start(id, opts, 'base');
    if (base && base.action !== next.action) base.action.crossFadeTo(next.action, opts.fade ?? 0.2, false);
    base = next;
    if (overlay) applyOverlayMask();
    return true;
  }

  /**
   * Play a clip on some bones only, over the base (the torch-and-blade stance: torch movement below,
   * a one-hand attack on `mask` = boneMasks(skeleton).rightArm). The base is re-made without those
   * bones while the overlay plays, and given them back when it ends.
   */
  async function playOverlay(id, opts = {}) {
    if (!opts.mask) throw new Error('playOverlay needs a mask (bone names)');
    if (!ready(id)) { await want(lib.bundleOf(id)); if (!ready(id)) return false; }
    if (overlay) overlay.action.fadeOut(opts.fade ?? 0.1);
    overlay = start(id, { ...opts, rootMotion: false }, 'overlay');
    overlay.action.fadeIn(opts.fade ?? 0.1);
    applyOverlayMask();
    return true;
  }
  function applyOverlayMask() {
    if (!base) return;
    const want = overlay ? { name: overlay.mask.name, mode: 'except', bones: overlay.mask.bones } : null;
    const clip = clipFor(base.id, want);
    if (base.action.getClip() === clip) return;
    const t = base.action.time;
    const a = mixer.clipAction(clip);
    a.reset(); a.time = t;
    a.setLoop(base.action.loop, Infinity); a.clampWhenFinished = base.action.clampWhenFinished; a.timeScale = base.action.timeScale;
    a.play();
    base.action.stop();
    base.action = a;
  }
  function stopOverlay(fade = 0.15) {
    if (!overlay) return;
    overlay.action.fadeOut(fade);
    overlay = null;
    applyOverlayMask();
  }

  mixer.addEventListener('finished', (e) => {
    const which = base && e.action === base.action ? base : overlay && e.action === overlay.action ? overlay : null;
    if (!which) return;
    if (which === overlay) stopOverlay();
    for (const f of listeners) f({ id: which.id, layer: which === base ? 'base' : 'overlay' });
  });

  /**
   * Advance. Returns the root motion of the base clip over this step, in world space, for the
   * controller to apply when it lets the clip drive: { move: Vector3 (metres), yaw: radians to add
   * to the body's rotation.y, id }. Zero when the clip has none or `rootMotion` is off.
   */
  const out = { move: new THREE.Vector3(), yaw: 0, id: null };
  function update(dt) {
    const prev = base ? base.action.time : 0;
    mixer.update(dt);
    out.move.set(0, 0, 0); out.yaw = 0; out.id = base?.id || null;
    if (!base || !base.rootMotion || !base.data?.rm) return out;
    const t = base.action.time, d = base.data;
    const wraps = base.action.loop === THREE.LoopRepeat && t < prev ? 1 : 0;
    const [x, y, z, yaw] = rootMotionBetween(d, prev, t, wraps);
    model.getWorldScale(s);
    out.move.set(x * s.x, y * s.y, z * s.z).applyQuaternion(base.startQ);
    out.yaw = -yaw;                 // right-positive yaw is a negative turn about +Y
    return out;
  }

  return {
    lib, mixer, want, ready, play, playOverlay, stopOverlay, update,
    /** Called with { id, layer } when a one-shot clip ends. Returns an unsubscribe function. */
    onFinished(f) { listeners.add(f); return () => listeners.delete(f); },
    get current() { return base?.id || null; },
    get overlay() { return overlay?.id || null; },
    /** Seconds into the base clip, and its length. */
    get time() { return base ? base.action.time : 0; },
    get duration() { return base?.data?.duration || 0; },
    /** The decoded data of a loaded clip (tests, debugging, custom blending). */
    data: (id) => data.get(id) || null,
  };
}
