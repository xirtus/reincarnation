import * as THREE from 'three';

// Master Control Points for the Inverted-U Arterial Trail ("The Serpent's Spine")
// Tightly wound across a 230m x 240m footprint so zero open-world space is wasted.
const SPINE_POINTS = [
  // Zone 1: The Drowned Threshold (Bottom-Left coastal basalt ravine, t: 0.00 -> 0.20)
  new THREE.Vector3(-88, 0.0, 104),
  new THREE.Vector3(-96, 0.4, 84),
  new THREE.Vector3(-76, 1.0, 64),   // Encounter 1A pinch point (t ~ 0.08)
  new THREE.Vector3(-98, 1.8, 42),
  new THREE.Vector3(-74, 2.8, 20),   // Encounter 1B Twin Sentinels (t ~ 0.15)
  new THREE.Vector3(-90, 4.2, -2),

  // Zone 2: The Twin Courtyards (Mid-Left Fork, t: 0.20 -> 0.42)
  new THREE.Vector3(-82, 5.2, -20),  // Shrine 2 & Left Branch Fork (t ~ 0.22)
  new THREE.Vector3(-60, 6.5, -36),  // Encounter 2A Courtyard Halberdier (t ~ 0.28)
  new THREE.Vector3(-78, 8.0, -58),
  new THREE.Vector3(-64, 9.2, -80),  // Boss 1 Arena: Vanguard Krampus (t ~ 0.36)
  new THREE.Vector3(-72, 11.0, -96), // Zone 2 Exit Gate Seal

  // Zone 3: The Serpent's Ascent (Top Map Arc — Suspension Bridge & Cavern Switchbacks, t: 0.42 -> 0.64)
  new THREE.Vector3(-50, 14.2, -108), // Shrine 3 (t ~ 0.43)
  new THREE.Vector3(-22, 18.5, -116),
  new THREE.Vector3(6, 21.0, -114),   // Encounter 3A Suspension Bridge Choke + Perch Caster (t ~ 0.51)
  new THREE.Vector3(36, 23.5, -104),
  new THREE.Vector3(62, 20.5, -84),   // Encounter 3B Ascent Warden Blaidd (t ~ 0.59)
  new THREE.Vector3(78, 17.0, -62),

  // Zone 4: The Mirror Basin (Mid-Right Amphitheater — "Whiteclad Noble" Water Arena, t: 0.64 -> 0.82)
  new THREE.Vector3(70, 14.5, -42),   // Shrine 4 (t ~ 0.65)
  new THREE.Vector3(86, 13.5, -16),   // Boss 2 Arena: Mirror Basin Center (t ~ 0.73)
  new THREE.Vector3(72, 13.5, 8),     // Mirror Basin South Exit Seal

  // Zone 5: The Sanctum of Tartarus (Bottom-Right Subterranean Artery & Crater Peak, t: 0.82 -> 1.00)
  new THREE.Vector3(86, 11.2, 28),    // Shrine 5 (t ~ 0.83)
  new THREE.Vector3(66, 9.0, 52),     // Encounter 5A Sanctum Honour Guard (t ~ 0.88)
  new THREE.Vector3(84, 7.2, 76),
  new THREE.Vector3(68, 6.0, 102),    // Boss 3 Arena: The Apex Sovereign Crater (t ~ 0.96)
  new THREE.Vector3(62, 6.0, 116),    // Final Sanctum Altar (t = 1.00)
];

// Zone 2 Optional Left Branch ("Wandering Wight" Sunken Tidal Clearing)
// Branches from main spine near t = 0.225 (-82, 5.2, -20) out to (-126, 3.0, -48)
const LEFT_BRANCH_POINTS = [
  new THREE.Vector3(-82, 5.2, -20),
  new THREE.Vector3(-102, 4.2, -28),
  new THREE.Vector3(-118, 3.2, -38),
  new THREE.Vector3(-128, 3.0, -52), // Optional Mini-Boss Clearing Center (u = 0.82)
  new THREE.Vector3(-132, 3.0, -60), // Ancient Spirit Totem (u = 1.0)
];

// Chapter IX: The Sacred Island of Athenaion — Sacred Way Processional Spine (t: 0.00 -> 1.00)
const ATHENAION_SPINE_POINTS = [
  // Zone 1: Western Lagoon Port, Vaulted Arcade & Water Temple Quay (t: 0.00 -> 0.20)
  new THREE.Vector3(-128, 2.4, 106),
  new THREE.Vector3(-104, 2.4, 106),
  new THREE.Vector3(-78, 2.4, 106),  // Encounter 1A Vaulted Lagoon Arcade (t ~ 0.08)
  new THREE.Vector3(-56, 2.3, 102),
  new THREE.Vector3(-36, 2.2, 98),   // Encounter 1B Water Temple Nymphaeum Quay (t ~ 0.15)
  new THREE.Vector3(-4, 2.3, 102),

  // Zone 2: Lagoon Quay & Lower Grand Staircase Terraces IV-III (t: 0.20 -> 0.42)
  new THREE.Vector3(24, 2.0, 97),    // Shrine 2: The Lagoon Quay & Trireme Berth (t ~ 0.22)
  new THREE.Vector3(28, 11.0, 78),   // Encounter 2A: Grand Stair Lower Flight (t ~ 0.28)
  new THREE.Vector3(28, 15.0, 65),
  new THREE.Vector3(28, 19.5, 52),   // Boss 1 Arena: Terrace III Minotaur Landing (t ~ 0.36)
  new THREE.Vector3(28, 25.0, 40),

  // Zone 3: Upper Grand Staircase Terraces II-I & Acropolis Ascent (t: 0.42 -> 0.64)
  new THREE.Vector3(28, 30.0, 31.5), // Shrine 3: The Grand Stair Mid-Landing (t ~ 0.43)
  new THREE.Vector3(28, 35.0, 20),
  new THREE.Vector3(28, 40.0, 10),   // Encounter 3A: Grand Staircase Upper Flight (t ~ 0.51)
  new THREE.Vector3(28, 45.0, 1),
  new THREE.Vector3(28, 50.0, -5),   // Encounter 3B: Terrace I Talos Warden (t ~ 0.59)
  new THREE.Vector3(26, 54.3, -11),

  // Zone 4: Forecourt of Athena & Twin Colossi of Athena Promachos (t: 0.64 -> 0.82)
  new THREE.Vector3(24, 54.3, -15),  // Shrine 4: Bastion at Top of Grand Stair (t ~ 0.65)
  new THREE.Vector3(24, 54.3, -17),  // Boss 2 Arena: The Forecourt of Athena between the Colossi (t ~ 0.73)
  new THREE.Vector3(20, 60.0, -20),  // Podium South Staircase Ascent

  // Zone 5: 12m Athenaion Podium, Pronaos Colonnade & Parthenon Naos (t: 0.82 -> 1.00)
  new THREE.Vector3(20, 66.0, -24),  // Shrine 5: Athenaion Podium Crest (t ~ 0.83)
  new THREE.Vector3(20, 67.5, -27.4),// Encounter 5A: The Athenaion Octastyle Pronaos (t ~ 0.88)
  new THREE.Vector3(20, 67.5, -48),
  new THREE.Vector3(20, 67.5, -64),  // Boss 3 Arena: Parthenon Naos of Athena Parthenos (t ~ 0.96)
  new THREE.Vector3(20, 67.5, -78),  // Parthenon Opisthodomos Altar (t = 1.00)
];

// Chapter IX Optional Branch: Lagoon Quay -> Arched Island Bridge -> Island Tholos -> Ruined Terrace & Fallen Head
const ATHENAION_BRANCH_POINTS = [
  new THREE.Vector3(24, 2.0, 97),
  new THREE.Vector3(2, 5.2, 108),    // Island Arched Bridge
  new THREE.Vector3(-3, 8.2, 128),   // The Island Tholos
  new THREE.Vector3(116, 52.0, 156), // Optional Mini-Boss: The Ruined Terrace & Fallen Head (u = 0.82)
  new THREE.Vector3(150, 52.0, 138), // The Ruined Portico Overlook (u = 1.00)
];


export const ZONES = [
  {
    id: 'zone1',
    index: 1,
    name: 'Zone I: The Drowned Threshold',
    subtitle: 'Coastal Basalt Gorge & Tidal Ravine',
    tStart: 0.0,
    tEnd: 0.20,
    fogColor: 0x0d1922,
    fogDensity: 0.014,
    ambientColor: 0x486a7c,
    sunColor: 0x9bd4e8,
    tint: '#4ecdc4',
  },
  {
    id: 'zone2',
    index: 2,
    name: 'Zone II: The Twin Courtyards',
    subtitle: 'Split Monolith, Sunken Grove & Ember Courtyard',
    tStart: 0.20,
    tEnd: 0.42,
    fogColor: 0x191512,
    fogDensity: 0.013,
    ambientColor: 0x705844,
    sunColor: 0xffb870,
    tint: '#f7b731',
  },
  {
    id: 'zone3',
    index: 3,
    name: "Zone III: The Serpent's Ascent",
    subtitle: 'Abyssal Suspension Chasm & GodRay Caverns',
    tStart: 0.42,
    tEnd: 0.64,
    fogColor: 0x111824,
    fogDensity: 0.012,
    ambientColor: 0x5c7296,
    sunColor: 0xd8ecff,
    tint: '#45aaf2',
  },
  {
    id: 'zone4',
    index: 4,
    name: 'Zone IV: The Mirror Basin',
    subtitle: 'Flooded Sky-Dome Amphitheater',
    tStart: 0.64,
    tEnd: 0.82,
    fogColor: 0x0e1f26,
    fogDensity: 0.010,
    ambientColor: 0x629aa8,
    sunColor: 0xc4f5ff,
    tint: '#2bcbba',
  },
  {
    id: 'zone5',
    index: 5,
    name: 'Zone V: The Sanctum of Tartarus',
    subtitle: 'Obsidian Artery & Sovereign Crater',
    tStart: 0.82,
    tEnd: 1.0,
    fogColor: 0x1a0b0e,
    fogDensity: 0.015,
    ambientColor: 0x7a3038,
    sunColor: 0xff6842,
    tint: '#eb3b5a',
  },
];

// Diegetic Shrines at the entrance of each of the 5 Zones
export const SHRINES = [
  { id: 'shrine1', zone: 1, name: 'Shrine of the Drowned Threshold', t: 0.022, sideOffset: -2.2 },
  { id: 'shrine2', zone: 2, name: 'Shrine of the Split Monolith', t: 0.212, sideOffset: 2.4 },
  { id: 'shrine3', zone: 3, name: 'Shrine of the Hanging Chasm', t: 0.432, sideOffset: -2.3 },
  { id: 'shrine4', zone: 4, name: 'Shrine of the Still Mirror', t: 0.652, sideOffset: 2.5 },
  { id: 'shrine5', zone: 5, name: 'Shrine of the Obsidian Maw', t: 0.832, sideOffset: -2.4 },
];

export class SerpentSpineTopology {
  constructor() {
    this.isAthenaionMode = false;
    this.athenaionFloorSampler = null;
    this._rebuildSamples(SPINE_POINTS, LEFT_BRANCH_POINTS);
  }

  _rebuildSamples(mainPoints, branchPoints) {
    this.mainCurve = new THREE.CatmullRomCurve3(mainPoints, false, 'centripetal', 0.45);
    this.branchCurve = new THREE.CatmullRomCurve3(branchPoints, false, 'centripetal', 0.45);
    this.totalLength = this.mainCurve.getLength();
    this.branchLength = this.branchCurve.getLength();

    this.samplesCount = 600;
    this.samples = [];
    for (let i = 0; i <= this.samplesCount; i++) {
      const t = i / this.samplesCount;
      const point = this.mainCurve.getPointAt(t);
      if (this.isAthenaionMode && this.athenaionFloorSampler) {
        point.y = this.athenaionFloorSampler(point.x, point.z, point.y);
      }
      const tangent = this.mainCurve.getTangentAt(t).normalize();
      const flatTangent = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
      const right = new THREE.Vector3(-flatTangent.z, 0, flatTangent.x).normalize();
      const halfWidth = this.computeHalfWidth(t, false);
      this.samples.push({ t, point, tangent, flatTangent, right, halfWidth });
    }

    this.branchSamplesCount = 120;
    this.branchSamples = [];
    for (let i = 0; i <= this.branchSamplesCount; i++) {
      const u = i / this.branchSamplesCount;
      const point = this.branchCurve.getPointAt(u);
      if (this.isAthenaionMode && this.athenaionFloorSampler) {
        point.y = this.athenaionFloorSampler(point.x, point.z, point.y);
      }
      const tangent = this.branchCurve.getTangentAt(u).normalize();
      const flatTangent = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
      const right = new THREE.Vector3(-flatTangent.z, 0, flatTangent.x).normalize();
      const halfWidth = this.computeHalfWidth(u, true);
      this.branchSamples.push({ u, point, tangent, flatTangent, right, halfWidth });
    }
  }

  /**
   * Switches between the standard Inverted-U Canyon Spine (Chapters I-VIII) and the open-island
   * Sacred Way of Athenaion (Chapter IX).
   */
  setAthenaionMode(enabled, floorSampler = null) {
    const nextMode = Boolean(enabled);
    if (this.isAthenaionMode === nextMode && this.athenaionFloorSampler === floorSampler) return;
    this.isAthenaionMode = nextMode;
    this.athenaionFloorSampler = floorSampler;
    if (this.isAthenaionMode) {
      this._rebuildSamples(ATHENAION_SPINE_POINTS, ATHENAION_BRANCH_POINTS);
    } else {
      this._rebuildSamples(SPINE_POINTS, LEFT_BRANCH_POINTS);
    }
  }

  /**
   * Computes half-width (in meters) of the walkable trail at spline parameter `t`.
   * Tight choke points (2.3m-3.2m half-width = 4.6m-6.4m total width) expand smoothly at boss arenas.
   */
  computeHalfWidth(t, isBranch = false) {
    if (isBranch) {
      // Narrow 3.0m half-width path opening into a 12.5m radius sunken clearing at u = 0.82
      const clearingBell = Math.exp(-Math.pow((t - 0.82) / 0.14, 2));
      return 2.8 + clearingBell * 9.8;
    }
    let hw = 3.2; // Default 6.4m wide arterial trail

    // Zone 1 pinch points & combat pockets
    hw += 1.4 * Math.exp(-Math.pow((t - 0.08) / 0.025, 2));
    hw += 1.8 * Math.exp(-Math.pow((t - 0.15) / 0.028, 2));

    // Zone 2 fork & Vanguard Krampus Courtyard Arena (t = 0.36)
    hw += 2.2 * Math.exp(-Math.pow((t - 0.22) / 0.025, 2));
    hw += 6.8 * Math.exp(-Math.pow((t - 0.36) / 0.036, 2));

    // Zone 3 Suspension Bridge Choke at t = 0.51 (narrows to 2.2m half-width = 4.4m bridge!)
    hw -= 1.0 * Math.exp(-Math.pow((t - 0.51) / 0.026, 2));
    hw += 2.4 * Math.exp(-Math.pow((t - 0.59) / 0.028, 2));

    // Zone 4 Mirror Basin Circular Water Arena at t = 0.73 (expands to 15.5m half-width = 31m diameter!)
    hw += 12.3 * Math.exp(-Math.pow((t - 0.73) / 0.045, 2));

    // Zone 5 Sanctum Guard pocket (t = 0.88) & Apex Sovereign Crater Arena (t = 0.96, 16.5m half-width = 33m diameter!)
    hw += 2.2 * Math.exp(-Math.pow((t - 0.88) / 0.025, 2));
    hw += 13.3 * Math.exp(-Math.pow((t - 0.96) / 0.038, 2));

    return hw;
  }

  getSampleAt(t) {
    const clamped = Math.max(0, Math.min(1, t));
    const idx = Math.round(clamped * this.samplesCount);
    return this.samples[idx];
  }

  getBranchSampleAt(u) {
    const clamped = Math.max(0, Math.min(1, u));
    const idx = Math.round(clamped * this.branchSamplesCount);
    return this.branchSamples[idx];
  }

  getWorldPos(t, lateralOffset = 0, heightOffset = 0, isBranch = false) {
    const s = isBranch ? this.getBranchSampleAt(t) : this.getSampleAt(t);
    return new THREE.Vector3()
      .copy(s.point)
      .addScaledVector(s.right, lateralOffset)
      .add(new THREE.Vector3(0, heightOffset, 0));
  }

  getZoneForT(t) {
    for (const z of ZONES) {
      if (t >= z.tStart && t <= z.tEnd) return z;
    }
    return ZONES[ZONES.length - 1];
  }

  /**
   * Finds the closest point on either the main Serpent's Spine or the Zone 2 Left Branch.
   */
  locateWorldPoint(pos) {
    let bestMain = null;
    let bestMainDistSq = Infinity;
    for (let i = 0; i <= this.samplesCount; i++) {
      const s = this.samples[i];
      const dx = pos.x - s.point.x;
      const dz = pos.z - s.point.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestMainDistSq) {
        bestMainDistSq = d2;
        bestMain = s;
      }
    }

    let bestBranch = null;
    let bestBranchDistSq = Infinity;
    for (let i = 0; i <= this.branchSamplesCount; i++) {
      const s = this.branchSamples[i];
      const dx = pos.x - s.point.x;
      const dz = pos.z - s.point.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestBranchDistSq) {
        bestBranchDistSq = d2;
        bestBranch = s;
      }
    }

    const mainDist = Math.sqrt(bestMainDistSq);
    const branchDist = Math.sqrt(bestBranchDistSq);
    const mainMargin = mainDist - bestMain.halfWidth;
    const branchMargin = branchDist - bestBranch.halfWidth;

    if (branchMargin < mainMargin && bestBranch.u > 0.08) {
      const rel = new THREE.Vector3().subVectors(pos, bestBranch.point);
      const lateral = rel.dot(bestBranch.right);
      const along = rel.dot(bestBranch.flatTangent);
      const slopeY = along * (bestBranch.tangent.y / Math.max(0.25, Math.hypot(bestBranch.tangent.x, bestBranch.tangent.z)));
      const camberY = 0.08 * Math.min(1.0, Math.abs(lateral) / Math.max(1.0, bestBranch.halfWidth));
      const groundY = (this.isAthenaionMode && this.athenaionFloorSampler)
        ? this.athenaionFloorSampler(pos.x, pos.z, pos.y)
        : bestBranch.point.y + slopeY + camberY;
      return {
        isBranch: true,
        t: 0.225,
        u: bestBranch.u,
        sample: bestBranch,
        lateral,
        dist: branchDist,
        groundY,
      };
    }

    const rel = new THREE.Vector3().subVectors(pos, bestMain.point);
    const lateral = rel.dot(bestMain.right);
    const along = rel.dot(bestMain.flatTangent);
    const slopeY = along * (bestMain.tangent.y / Math.max(0.25, Math.hypot(bestMain.tangent.x, bestMain.tangent.z)));
    const camberY = 0.08 * Math.min(1.0, Math.abs(lateral) / Math.max(1.0, bestMain.halfWidth));
    const bridgePlankY = bestMain.t > 0.475 && bestMain.t < 0.545 ? 0.08 : 0.0;
    const groundY = (this.isAthenaionMode && this.athenaionFloorSampler)
      ? this.athenaionFloorSampler(pos.x, pos.z, pos.y)
      : bestMain.point.y + slopeY + camberY + bridgePlankY;
    return {
      isBranch: false,
      t: bestMain.t,
      u: 0,
      sample: bestMain,
      lateral,
      dist: mainDist,
      groundY,
    };
  }

  /**
   * Enforces the Triple-Lock Corridor Boundaries, Solid World Obstacles & Active Obsidian Fog Seals!
   * Prevents the player or any fighter from walking through canyon walls, rocks, shrines, arches, pillars, or gates.
   */
  clampPositionToCorridor(pos, radius = 0.55, activeSealGates = [], jumpOffsetY = 0, solidObstacles = null, vel = null) {
    const applyLateralWallClamp = () => {
      const loc = this.locateWorldPoint(pos);
      if (this.isAthenaionMode) {
        // Open-island exploration on Chapter IX (Athenaion): only clamp to island world bounds
        pos.x = Math.max(-1450, Math.min(480, pos.x));
        pos.z = Math.max(-680, Math.min(720, pos.z));
        return loc;
      }
      const s = loc.sample;
      // Stop capsule 0.38m inside the rock curb/wall edge so meshes never intersect
      const maxLat = Math.max(1.15, s.halfWidth - radius - 0.38);
      const nearFork = !loc.isBranch && Math.abs(loc.t - 0.225) < 0.022 && loc.lateral < 0;

      if (!nearFork && Math.abs(loc.lateral) > maxLat) {
        const sideSign = Math.sign(loc.lateral);
        const clampedLat = sideSign * maxLat;
        const corr = clampedLat - loc.lateral;
        pos.x += s.right.x * corr;
        pos.z += s.right.z * corr;

        if (vel) {
          const outwardV = (vel.x * s.right.x + vel.z * s.right.z) * sideSign;
          if (outwardV > 0) {
            vel.x -= s.right.x * sideSign * outwardV;
            vel.z -= s.right.z * sideSign * outwardV;
          }
        }
      }
      return loc;
    };

    let loc = applyLateralWallClamp();

    // Clamp start and end of spline (only in canyon chapters)
    if (!this.isAthenaionMode && !loc.isBranch && loc.t < 0.005) {
      const startPt = this.samples[3].point;
      pos.x = THREE.MathUtils.lerp(pos.x, startPt.x, 0.5);
      pos.z = THREE.MathUtils.lerp(pos.z, startPt.z, 0.5);
    }

    // Enforce Hard Gate Obsidian Fog Seals (both forward exit seal and arena back-leash seal)
    if (!loc.isBranch) {
      for (const gate of activeSealGates) {
        if (gate.cleared) continue;
        // Player cannot pass gate.gateT without killing all guards in that encounter!
        if (loc.t > gate.gateT - 0.004 && loc.t < gate.gateT + 0.012) {
          const gateSample = this.getSampleAt(gate.gateT - 0.004);
          const toPos = new THREE.Vector3().subVectors(pos, gateSample.point);
          const forwardProj = toPos.dot(gateSample.flatTangent);
          if (forwardProj > 0) {
            pos.addScaledVector(gateSample.flatTangent, -forwardProj - 0.05);
            if (vel) {
              const vf = vel.x * gateSample.flatTangent.x + vel.z * gateSample.flatTangent.z;
              if (vf > 0) {
                vel.x -= gateSample.flatTangent.x * vf;
                vel.z -= gateSample.flatTangent.z * vf;
              }
            }
          }
        }
        // If engaged in a boss/guard cage match, also seal the rear entrance so there is zero-cheese kiting
        if (gate.engaged && gate.entryT && loc.t < gate.entryT + 0.003 && loc.t > gate.entryT - 0.015) {
          const entrySample = this.getSampleAt(gate.entryT + 0.003);
          const toPos = new THREE.Vector3().subVectors(pos, entrySample.point);
          const forwardProj = toPos.dot(entrySample.flatTangent);
          if (forwardProj < 0) {
            pos.addScaledVector(entrySample.flatTangent, -forwardProj + 0.05);
            if (vel) {
              const vf = vel.x * entrySample.flatTangent.x + vel.z * entrySample.flatTangent.z;
              if (vf < 0) {
                vel.x -= entrySample.flatTangent.x * vf;
                vel.z -= entrySample.flatTangent.z * vf;
              }
            }
          }
        }
      }
    } else if (loc.u > 0.94) {
      const endSample = this.getBranchSampleAt(0.94);
      const toPos = new THREE.Vector3().subVectors(pos, endSample.point);
      const forwardProj = toPos.dot(endSample.flatTangent);
      if (forwardProj > 0) {
        pos.addScaledVector(endSample.flatTangent, -forwardProj);
      }
    }

    // Multi-pass Solid Obstacle Collision Resolution (Rocks, Boulders, Shrines, Arch Piers, Pillars, Fences, Trees)
    let supportTopY = -Infinity;
    if (solidObstacles && solidObstacles.length > 0) {
      const footY = loc.groundY + Math.max(0, jumpOffsetY);
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < solidObstacles.length; i++) {
          const obs = solidObstacles[i];
          if (obs.pillarRef && !obs.pillarRef.intact) continue;

          // Quick 2D broadphase
          const dx = pos.x - obs.x;
          const dz = pos.z - obs.z;
          if (Math.abs(dx) > 8.0 || Math.abs(dz) > 8.0) continue;

          const obsTopY = obs.y + (obs.h || 5.0);
          if (footY > obsTopY + 0.25) continue;

          if (obs.type === 'obb') {
            // Rotate delta into OBB local frame
            const lx = dx * obs.cos - dz * obs.sin;
            const lz = dx * obs.sin + dz * obs.cos;
            const cx = Math.max(-obs.hx, Math.min(obs.hx, lx));
            const cz = Math.max(-obs.hz, Math.min(obs.hz, lz));
            const ex = lx - cx;
            const ez = lz - cz;
            const distSq = ex * ex + ez * ez;
            if (distSq < radius * radius) {
              let nxLocal = 0;
              let nzLocal = 0;
              let pen = 0;
              if (distSq > 1e-6) {
                const dist = Math.sqrt(distSq);
                nxLocal = ex / dist;
                nzLocal = ez / dist;
                pen = radius - dist;
              } else {
                const penX = obs.hx - Math.abs(lx);
                const penZ = obs.hz - Math.abs(lz);
                if (penX < penZ) {
                  nxLocal = lx >= 0 ? 1 : -1;
                  pen = penX + radius;
                } else {
                  nzLocal = lz >= 0 ? 1 : -1;
                  pen = penZ + radius;
                }
              }
              const nx = nxLocal * obs.cos + nzLocal * obs.sin;
              const nz = -nxLocal * obs.sin + nzLocal * obs.cos;
              pos.x += nx * pen;
              pos.z += nz * pen;
              if (vel) {
                const vn = vel.x * nx + vel.z * nz;
                if (vn < 0) {
                  vel.x -= nx * vn;
                  vel.z -= nz * vn;
                }
              }
            }
          } else {
            // Cylinder collider
            const distSq = dx * dx + dz * dz;
            const minDist = obs.r + radius;
            if (distSq < minDist * minDist) {
              // If this is a flat walkable boulder and the character is above its top surface, stand on top!
              if (obs.walkableTop && footY >= obsTopY - 0.42 && distSq < (obs.r + radius * 0.45) ** 2) {
                if (obsTopY > supportTopY) supportTopY = obsTopY;
                continue;
              }
              const dist = Math.sqrt(Math.max(1e-6, distSq));
              const nx = dx / dist;
              const nz = dz / dist;
              const pen = minDist - dist;
              pos.x += nx * pen;
              pos.z += nz * pen;
              if (vel) {
                const vn = vel.x * nx + vel.z * nz;
                if (vn < 0) {
                  vel.x -= nx * vn;
                  vel.z -= nz * vn;
                }
              }
            }
          }
        }
      }
      // Re-clamp to corridor wall after obstacle pushout
      applyLateralWallClamp();
    }

    // Smooth ground height snap + walkable boulder support + vertical jump offset
    const updatedLoc = this.locateWorldPoint(pos);
    const effectiveGroundY = supportTopY > updatedLoc.groundY ? supportTopY : updatedLoc.groundY;
    updatedLoc.groundY = effectiveGroundY;
    pos.y = effectiveGroundY + Math.max(0, jumpOffsetY);
    return updatedLoc;
  }

  /**
   * Ray-marches the camera boom from the player's shoulder pivot to `desiredCamPos`
   * and pulls the boom in before any canyon wall or solid obstacle can occlude the player.
   */
  clampCameraPosition(pivotPos, desiredCamPos, solidObstacles = null) {
    const dir = new THREE.Vector3().subVectors(desiredCamPos, pivotPos);
    const totalDist = dir.length();
    if (totalDist < 0.2) return desiredCamPos;
    dir.divideScalar(totalDist);

    let safeDist = totalDist;
    const steps = 10;
    const probePt = new THREE.Vector3();

    for (let i = 2; i <= steps; i++) {
      const d = (i / steps) * totalDist;
      probePt.copy(pivotPos).addScaledVector(dir, d);
      const loc = this.locateWorldPoint(probePt);
      const maxCamLat = Math.max(1.4, loc.sample.halfWidth - 0.15);

      if ((!this.isAthenaionMode && Math.abs(loc.lateral) > maxCamLat) || probePt.y < loc.groundY + 0.55) {
        safeDist = Math.max(1.35, ((i - 1) / steps) * totalDist);
        break;
      }

      if (solidObstacles) {
        let hitSolid = false;
        for (let k = 0; k < solidObstacles.length; k++) {
          const obs = solidObstacles[k];
          if (obs.pillarRef && !obs.pillarRef.intact) continue;
          if (obs.h && obs.h < 1.1) continue;
          const dx = probePt.x - obs.x;
          const dz = probePt.z - obs.z;
          const rCheck = (obs.r || 1.0) + 0.35;
          if (dx * dx + dz * dz < rCheck * rCheck && probePt.y < obs.y + (obs.h || 5.0)) {
            hitSolid = true;
            break;
          }
        }
        if (hitSolid) {
          safeDist = Math.max(1.35, ((i - 1) / steps) * totalDist);
          break;
        }
      }
    }

    desiredCamPos.copy(pivotPos).addScaledVector(dir, safeDist);
    const finalLoc = this.locateWorldPoint(desiredCamPos);
    desiredCamPos.y = Math.max(desiredCamPos.y, finalLoc.groundY + 0.85);
    return desiredCamPos;
  }
}
