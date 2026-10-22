// FINDING A CLIP: the manifest (public/anim/manifest.json) as a lookup by what a controller knows,
// not by file name. Pure, no three.js; src/anim/animator.js loads and plays what this picks.
//
// Every clip in the manifest carries the facts scripts/anim/catalog.mjs gave it and what the bake
// measured:
//   stance   unarmed, oneHand, twoHand, torch, lantern, bow, katana, sword, swordShield, twinSword,
//            spear, greatSword, rock, knife...
//   posture  stand | crouch (as the pack files it);  pose: upright | low | lying (measured)
//   gait     idle, walk, jog, run, sprint, shieldWalk, shieldRun, blockWalk, blockRun, parryWalk, aimWalk
//   kind     loop, idle, start, stop, change, turn, shuffle, pivot, transition, roll, jump, attack,
//            finisher, finisherVictim, parry, block, blockHit, guardBreak, qte, craft, shoot...
//   angle    where the body travels relative to its facing, degrees, right-positive (F 0, R90 90, B 180)
//   turn     how far a start, turn or pivot turns the facing, right-positive
//   speed    measured root speed (m/s); heading: measured travel direction; travel: whole-clip root motion
//   mirrorOf the right-hand clip a left one is mirrored from at load
// A query names any of those fields; `angle` and `turn` match the nearest, everything else exactly.

const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const angleGap = (a, b) => Math.abs(wrap(a - b));

export function createClipLibrary(manifest) {
  const clips = manifest.clips;
  const byId = new Map(clips.map((c) => [c.id, c]));
  const index = new Map();                                    // "stance|kind" -> clips
  for (const c of clips) {
    const k = `${c.stance}|${c.kind}`;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(c);
  }

  /** Every clip matching a query, best first. Fields: any manifest fact; `angle`/`turn` are nearest. */
  function findAll(q) {
    const pool = q.stance && q.kind ? index.get(`${q.stance}|${q.kind}`) || [] : clips;
    const exact = Object.entries(q).filter(([k, v]) => v !== undefined && !['angle', 'turn', 'speed', 'prefer'].includes(k));
    const hits = pool.filter((c) => exact.every(([k, v]) => (Array.isArray(v) ? v.includes(c[k]) : c[k] === v)));
    const score = (c) => {
      let s = 0;
      if (q.angle !== undefined) s += c.angle == null ? 1e3 : angleGap(c.angle, q.angle);
      if (q.turn !== undefined) s += c.turn == null ? 1e3 : Math.abs((c.turn || 0) - q.turn);
      if (q.speed !== undefined) s += Math.abs((c.speed || 0) - q.speed) * 10;
      if (q.prefer) for (const [k, v] of Object.entries(q.prefer)) if (c[k] !== v) s += 0.5;
      return s;
    };
    return hits.map((c) => [score(c), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  }
  const find = (q) => findAll(q)[0] || null;

  /** The gaits a stance can move at, slowest first, with each one's forward loop speed. */
  function gaits(stance, posture = 'stand') {
    const out = new Map();
    for (const c of index.get(`${stance}|loop`) || []) {
      if (c.posture !== posture || c.angle !== 0 || !c.speed) continue;
      if (!out.has(c.gait) || out.get(c.gait) > c.speed) out.set(c.gait, c.speed);
    }
    return [...out].map(([gait, speed]) => ({ gait, speed })).sort((a, b) => a.speed - b.speed);
  }
  /** The gait whose loop speed is nearest a wanted speed (m/s). */
  function gaitFor(stance, speed, posture = 'stand', allowed) {
    const list = gaits(stance, posture).filter((g) => !allowed || allowed.includes(g.gait));
    let best = null;
    for (const g of list) if (!best || Math.abs(g.speed - speed) < Math.abs(best.speed - speed)) best = g;
    return best;
  }

  return {
    manifest, clips, get: (id) => byId.get(id) || null, find, findAll, gaits, gaitFor,
    /** The bundle a clip's data lives in (a mirrored clip lives with its right-hand twin). */
    bundleOf: (id) => { const c = byId.get(id); return c && (c.mirrorOf ? byId.get(c.mirrorOf)?.bundle : c.bundle); },
    /** The bundles a stance needs for movement and actions. */
    bundlesFor: (stance) => [...new Set(clips.filter((c) => c.stance === stance).map((c) => c.bundle))],
  };
}

// --- the locomotion picks, which most controllers want --------------------------------------------------

/**
 * The loop for moving at `angle` (relative to facing). Sideways (90) comes in two leg crossings, A
 * with the hips open to the front and B to the back; `from` (the angle we come from) keeps the hips
 * from flipping: coming from the back half picks B.
 */
export function pickLoop(lib, { stance, posture = 'stand', gait, angle = 0, from = 0 }) {
  const foot = Math.abs(angle) > 60 && Math.abs(angle) < 120 ? (Math.abs(from) > 100 ? 'B' : 'A') : undefined;
  return lib.find({ stance, posture, gait, kind: 'loop', angle, prefer: foot ? { foot } : { foot: null } })
    || lib.find({ stance, posture, gait, kind: 'loop', angle });
}
/** Leaving idle toward `angle`; with `turn` (degrees) the start also turns the body that far first. */
export function pickStart(lib, { stance, posture = 'stand', gait, angle = 0, turn = 0 }) {
  if (Math.abs(turn) >= 45) {
    const c = lib.find({ stance, posture, gait, kind: 'start', turn, angle: 0 });
    if (c && Math.abs((c.turn || 0) - turn) <= 45) return c;
  }
  return lib.find({ stance, posture, gait, kind: 'start', turn: 0, angle });
}
export const pickStop = (lib, { stance, posture = 'stand', gait, angle = 0 }) => lib.find({ stance, posture, gait, kind: 'stop', angle });
/** A turn on the spot (idle pivot), nearest to `turn` degrees. */
export function pickPivot(lib, { stance, posture = 'stand', turn }) {
  return lib.find({ stance, posture, kind: 'pivot', turn }) || lib.find({ stance, kind: 'pivot', turn });
}
/** A turn while moving forward (`turn` degrees), or null when the stance has none near it. */
export function pickMovingTurn(lib, { stance, posture = 'stand', gait, turn }) {
  const c = lib.find({ stance, posture, gait, kind: 'turn', turn });
  return c && Math.abs(c.turn - turn) <= 30 ? c : null;
}
/** A change of direction without stopping (lock-on: forward to back, left to right). */
export function pickChange(lib, { stance, posture = 'stand', gait, from, to }) {
  const list = lib.findAll({ stance, posture, gait, kind: 'change', angle: from });
  let best = null, gap = Infinity;
  for (const c of list) {
    const g = angleGap(c.angle, from) + angleGap(c.toAngle ?? 0, to);
    if (g < gap) { best = c; gap = g; }
  }
  return gap <= 60 ? best : null;
}
export const idleOf = (lib, { stance, posture = 'stand', variant }) => lib.find({ stance, posture, kind: 'idle', ...(variant ? { variant } : {}) })
  || lib.find({ stance, kind: 'idle' });
export { wrap as wrapAngle, angleGap };
