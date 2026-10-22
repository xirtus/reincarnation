import * as THREE from 'three/webgpu';
import {
  loadGLTF,
  createFighterPuppet,
  mountWeaponToPuppet,
  testWeaponOBBvsCapsule,
  closestDistanceBetweenSegments,
  WEAPON_CATALOG,
  ELEMENTS,
} from '../anim/puppet-store.js';
import {
  createObsidianSealMesh,
  RibbonBladeTrail,
} from '../render/shaders.js';
import { sound } from '../audio/sound-engine.js';
import {
  getDifficultyProfile,
  loadDifficultyId,
  saveDifficultyId,
  scaleEnemyVitals,
  playerVitalsForDifficulty,
} from './difficulty.js';

export const HERO_ROSTER = [
  {
    id: 'lady_maria',
    name: 'Lady Maria (Astral Hunter)',
    shortName: 'Lady Maria',
    file: '/sibling/tartarus/public/cast/lady_maria.glb',
    height: 1.82,
    defaultWeapon: 'buster_sword',
  },
  {
    id: 'blaidd',
    name: 'Blaidd (Half-Wolf Buster Knight)',
    shortName: 'Blaidd',
    file: '/sibling/tartarus/public/cast/blaidd.glb',
    height: 2.05,
    defaultWeapon: 'buster_sword',
  },
  {
    id: 'malenia',
    name: 'Malenia (Blade of Miquella)',
    shortName: 'Malenia',
    file: '/sibling/tartarus/public/cast/malenia.glb',
    height: 1.88,
    defaultWeapon: 'masamune',
  },
  {
    id: 'millicent',
    name: 'Millicent (Scarlet Valkyrie)',
    shortName: 'Millicent',
    file: '/sibling/tartarus/public/cast/millicent.glb',
    height: 1.78,
    defaultWeapon: 'emberwing',
  },
  {
    id: 'fire_keeper',
    name: 'The Fire Keeper (Archmage)',
    shortName: 'Fire Keeper',
    file: '/sibling/tartarus/public/cast/fire_keeper.glb',
    height: 1.76,
    defaultWeapon: 'magical_rod',
  },
];

export const STYLE_COMBO_STARTERS = {
  great: { light: 'great_cut_a', heavy: 'punisher1', air: 'leaping_smash', rising: 'great_rising' },
  katana: { light: 'katana_cut_1', heavy: 'katana_heavy_1', air: 'katana_air_slash', rising: 'sword_rising' },
  blade: { light: 'sword_cut_a', heavy: 'blade_heavy_1', air: 'blade_air_slash', rising: 'sword_rising' },
  staff: { light: 'staff_cut_1', heavy: 'staff_heavy_1', air: 'staff_air_slash', rising: 'sword_rising' },
  baton: { light: 'baton_cut_1', heavy: 'baton_heavy_1', air: 'baton_air_slash', rising: 'sword_rising' },
};

export const GRIMOIRE_SPELLS = [
  {
    id: 'spell_phoenix_tide',
    name: 'Serpent Tide Phoenix',
    keyLabel: 'HandCast_Phoenix',
    color: '#ff6a26',
    colorHex: 0xff6a26,
    costFocus: 0.5,
    desc: 'Summons a flapping blackbody Phoenix, 3 fire serpents & homing beak fireballs',
  },
  {
    id: 'spell_celestial_rend',
    name: 'Celestial Rend',
    keyLabel: 'Cast_CelestialRend',
    color: '#ffe078',
    colorHex: 0xffe078,
    costFocus: 1.0,
    desc: '4-point concave star sigil, fluted astral pillar & 36 converging crystal shards',
  },
  {
    id: 'spell_caustic_bloom',
    name: 'Caustic Bloom',
    keyLabel: 'Cast_CausticBloom',
    color: '#55ff88',
    colorHex: 0x55ff88,
    costFocus: 0.5,
    desc: 'Voronoi-crazed acid pool & surfaceBoil sparks that corrode enemy armor (+12% DMG)',
  },
  {
    id: 'spell_venom_surge',
    name: 'Crystallized Venom Surge',
    keyLabel: 'Cast_VenomSurge',
    color: '#38f2ff',
    colorHex: 0x38f2ff,
    costFocus: 0.5,
    desc: '3-wave procedural 6-faceted crystal spear line eruption (13m piercing)',
  },
  {
    id: 'spell_threadlight',
    name: 'Threadlight Void Slash',
    keyLabel: 'Cast_Thread',
    color: '#9fffe6',
    colorHex: 0x9fffe6,
    costFocus: 0.5,
    desc: 'Linear Void Slash + 3-lane piercing light ribbons (13.5m range & Immobilize)',
  },
  {
    id: 'spell_prism_surge',
    name: 'Prism Surge',
    keyLabel: 'Cast_Surge',
    color: '#c6a4ff',
    colorHex: 0xc6a4ff,
    costFocus: 1.0,
    desc: '18-ray Fibonacci sphere + Celestial Rend burst that shatters posture in 6.4m',
  },
  {
    id: 'spell_crimson_meteor',
    name: 'Ignis Meteor',
    keyLabel: 'Magic_2H_Attack_3',
    color: '#ff6a26',
    colorHex: 0xff6a26,
    costFocus: 1.0,
    desc: 'Molten meteor barrage + Phoenix pyre that inflicts BURN DoT for 6s',
  },
  {
    id: 'spell_rime_tempest',
    name: 'Rime Tempest',
    keyLabel: 'Magic_2H_Attack_5',
    color: '#7be0ff',
    colorHex: 0x7be0ff,
    costFocus: 1.0,
    desc: 'Frost-lightning storm vortex that inflicts FROST SLOW (-35% speed)',
  },
  {
    id: 'spell_abyssal_nova',
    name: 'Abyssal Nova',
    keyLabel: 'Magic_2H_Attack_4',
    color: '#b85cff',
    colorHex: 0xb85cff,
    costFocus: 1.0,
    desc: 'Gravity-well pull & Void detonation that cracks enemy armor',
  },
  {
    id: 'spell_blade_imbue',
    name: 'Elemental Imbue',
    keyLabel: 'rpg2HandBaseBurnFire',
    color: '#ffd700',
    colorHex: 0xffd700,
    costFocus: 0.5,
    desc: 'Coats your weapon in Elemental Magic (+30% DMG & status for 25s)',
  },
];

/**
 * Full Pigaloo + Pro Magic Pack + FF7 Remake + Tartarus Moveset Catalog
 * Covers all 5 weapon styles (Great, Katana, 1H Blade, Staff/Polearm, Baton/Twin),
 * 3-Hit 1H Arcane Bolt -> 2H Beam Combo, and 6 Grimoire Spells.
 */
export const PLAYER_ATTACKS = {
  // ==========================================================================
  // 1. GREATSWORD / BUSTER STYLE (Pigaloo Great_Cut_A..C + FF7R Operator A4..A6)
  // ==========================================================================
  great_cut_a: {
    id: 'great_cut_a',
    label: 'Buster Diagonal Cleave I',
    clip: 'Great_Cut_A',
    duration: 0.78,
    hitWindow: [0.26, 0.54],
    damage: 52,
    poiseDamage: 28,
    stamina: 14,
    lunge: 2.4,
    flowKind: 'cut',
    next: 'great_cut_b',
  },
  great_cut_b: {
    id: 'great_cut_b',
    label: 'Buster Return Sweep II',
    clip: 'Great_Cut_B',
    duration: 0.76,
    hitWindow: [0.28, 0.56],
    damage: 58,
    poiseDamage: 32,
    stamina: 14,
    lunge: 2.3,
    flowKind: 'cut',
    next: 'great_cut_c',
  },
  great_cut_c: {
    id: 'great_cut_c',
    label: 'Buster Spinning Cross III',
    clip: 'Great_Cut_C',
    duration: 0.84,
    hitWindow: [0.30, 0.60],
    damage: 66,
    poiseDamage: 38,
    stamina: 16,
    lunge: 2.6,
    flowKind: 'cut',
    next: 'great_combo_4',
  },
  great_combo_4: {
    id: 'great_combo_4',
    label: 'Operator Wide Arc IV',
    clip: 'rpg2HandBaseAttackA4Combo',
    duration: 0.78,
    hitWindow: [0.24, 0.54],
    damage: 72,
    poiseDamage: 42,
    stamina: 16,
    lunge: 2.7,
    flowKind: 'cut',
    next: 'great_combo_5',
  },
  great_combo_5: {
    id: 'great_combo_5',
    label: 'Operator Whirl Cleave V',
    clip: 'rpg2HandBaseAttackA5Combo',
    duration: 0.80,
    hitWindow: [0.24, 0.56],
    damage: 80,
    poiseDamage: 48,
    stamina: 18,
    lunge: 2.9,
    flowKind: 'cut',
    next: 'great_combo_6',
  },
  great_combo_6: {
    id: 'great_combo_6',
    label: 'Operator Finisher Slam VI',
    clip: 'rpg2HandBaseAttackA6Combo',
    duration: 0.92,
    hitWindow: [0.26, 0.60],
    damage: 108,
    poiseDamage: 68,
    stamina: 22,
    lunge: 3.4,
    flowKind: 'heavy',
    heavyImpact: true,
    next: null,
  },

  // ==========================================================================
  // 2. KATANA / ODACHI STYLE (Sephiroth Masamune bcdCKComboA01..03 + Slash01..05)
  // ==========================================================================
  katana_cut_1: {
    id: 'katana_cut_1',
    label: 'Odachi Swift Draw I',
    clip: 'bcdCKComboA01',
    duration: 0.64,
    hitWindow: [0.20, 0.50],
    damage: 50,
    poiseDamage: 24,
    stamina: 12,
    lunge: 2.6,
    flowKind: 'cut',
    next: 'katana_cut_2',
  },
  katana_cut_2: {
    id: 'katana_cut_2',
    label: 'Odachi Crossing Fang II',
    clip: 'bcdCKComboA02',
    duration: 0.64,
    hitWindow: [0.22, 0.52],
    damage: 56,
    poiseDamage: 28,
    stamina: 12,
    lunge: 2.6,
    flowKind: 'cut',
    next: 'katana_cut_3',
  },
  katana_cut_3: {
    id: 'katana_cut_3',
    label: 'Odachi Whirlwind III',
    clip: 'bcdCKComboA03',
    duration: 0.70,
    hitWindow: [0.22, 0.54],
    damage: 64,
    poiseDamage: 32,
    stamina: 14,
    lunge: 2.8,
    flowKind: 'cut',
    next: 'katana_cut_4',
  },
  katana_cut_4: {
    id: 'katana_cut_4',
    label: 'Masamune Crescent IV',
    clip: 'bcdCKSlash01',
    duration: 0.68,
    hitWindow: [0.22, 0.52],
    damage: 70,
    poiseDamage: 36,
    stamina: 14,
    lunge: 2.9,
    flowKind: 'cut',
    next: 'katana_cut_5',
  },
  katana_cut_5: {
    id: 'katana_cut_5',
    label: 'Masamune Reverse Flash V',
    clip: 'bcdCKSlash02',
    duration: 0.72,
    hitWindow: [0.22, 0.54],
    damage: 78,
    poiseDamage: 42,
    stamina: 16,
    lunge: 3.1,
    flowKind: 'cut',
    next: 'katana_cut_6',
  },
  katana_cut_6: {
    id: 'katana_cut_6',
    label: 'Octaslash Finisher VI',
    clip: 'bcdCKSlash05',
    duration: 0.86,
    hitWindow: [0.24, 0.58],
    damage: 112,
    poiseDamage: 64,
    stamina: 20,
    lunge: 3.6,
    flowKind: 'heavy',
    heavyImpact: true,
    next: null,
  },
  katana_heavy_1: {
    id: 'katana_heavy_1',
    label: 'Iaijutsu Heavy Rend I',
    clip: 'bcdCKComboB01',
    duration: 0.74,
    hitWindow: [0.22, 0.54],
    damage: 72,
    poiseDamage: 44,
    stamina: 18,
    lunge: 3.0,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'katana_heavy_2',
  },
  katana_heavy_2: {
    id: 'katana_heavy_2',
    label: 'Iaijutsu Crimson Arc II',
    clip: 'bcdCKComboB02',
    duration: 0.76,
    hitWindow: [0.22, 0.54],
    damage: 82,
    poiseDamage: 50,
    stamina: 18,
    lunge: 3.1,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'katana_heavy_3',
  },
  katana_heavy_3: {
    id: 'katana_heavy_3',
    label: 'Iaijutsu Severing Moon III',
    clip: 'bcdCKSlash03',
    duration: 0.78,
    hitWindow: [0.24, 0.56],
    damage: 92,
    poiseDamage: 58,
    stamina: 20,
    lunge: 3.2,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'katana_heavy_4',
  },
  katana_heavy_4: {
    id: 'katana_heavy_4',
    label: 'Iaijutsu Void Fang IV',
    clip: 'bcdCKSlash04',
    duration: 0.82,
    hitWindow: [0.24, 0.58],
    damage: 102,
    poiseDamage: 64,
    stamina: 22,
    lunge: 3.4,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'katana_heavy_5',
  },
  katana_heavy_5: {
    id: 'katana_heavy_5',
    label: 'Hell’s Gate Guillotine V',
    clip: 'gsGreatSwordSlash5',
    duration: 0.94,
    hitWindow: [0.26, 0.58],
    damage: 134,
    poiseDamage: 88,
    stamina: 24,
    lunge: 3.8,
    flowKind: 'heavy',
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },
  katana_air_slash: {
    id: 'katana_air_slash',
    label: 'Aerial Odachi Swallow Plunge',
    clip: 'bcdCKJumpAttack01',
    duration: 0.88,
    hitWindow: [0.24, 0.58],
    damage: 110,
    poiseDamage: 74,
    stamina: 20,
    lunge: 4.8,
    flowKind: 'leap',
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },

  // ==========================================================================
  // 3. 1H ELEMENTAL BLADE / SABER STYLE (Pigaloo Sword_Cut + Tartarus 1H Combos)
  // ==========================================================================
  sword_cut_a: {
    id: 'sword_cut_a',
    label: 'Swift Saber Slash I',
    clip: 'Sword_Cut_A',
    duration: 0.64,
    hitWindow: [0.22, 0.50],
    damage: 46,
    poiseDamage: 24,
    stamina: 11,
    lunge: 2.4,
    flowKind: 'cut',
    next: 'sword_cut_b',
  },
  sword_cut_b: {
    id: 'sword_cut_b',
    label: 'Cross Saber Cut II',
    clip: 'Sword_Cut_B',
    duration: 0.64,
    hitWindow: [0.24, 0.54],
    damage: 52,
    poiseDamage: 26,
    stamina: 11,
    lunge: 2.3,
    flowKind: 'cut',
    next: 'sword_cut_c',
  },
  sword_cut_c: {
    id: 'sword_cut_c',
    label: 'Crimson Spin III',
    clip: 'Sword_Cut_C',
    duration: 0.70,
    hitWindow: [0.26, 0.56],
    damage: 58,
    poiseDamage: 32,
    stamina: 13,
    lunge: 2.6,
    flowKind: 'cut',
    next: 'blade_cut_4',
  },
  blade_cut_4: {
    id: 'blade_cut_4',
    label: 'Elemental Fang IV',
    clip: 'rpg1HandBaseAttackA4Combo',
    duration: 0.68,
    hitWindow: [0.22, 0.52],
    damage: 66,
    poiseDamage: 36,
    stamina: 14,
    lunge: 2.7,
    flowKind: 'cut',
    next: 'blade_cut_5',
  },
  blade_cut_5: {
    id: 'blade_cut_5',
    label: 'Tempest Saber Whirl V',
    clip: 'rpg1HandBaseAttackA5Combo',
    duration: 0.72,
    hitWindow: [0.22, 0.54],
    damage: 74,
    poiseDamage: 42,
    stamina: 15,
    lunge: 2.9,
    flowKind: 'cut',
    next: 'sword_heavy',
  },
  sword_heavy: {
    id: 'sword_heavy',
    label: 'Starfall Cleave VI',
    clip: 'Sword_Heavy',
    duration: 0.84,
    hitWindow: [0.26, 0.56],
    damage: 98,
    poiseDamage: 62,
    stamina: 18,
    lunge: 3.3,
    flowKind: 'heavy',
    heavyImpact: true,
    next: null,
  },
  blade_heavy_1: {
    id: 'blade_heavy_1',
    label: 'Saber Heavy Lunge I',
    clip: 'rpg1HandBaseAttackC1',
    duration: 0.72,
    hitWindow: [0.22, 0.52],
    damage: 68,
    poiseDamage: 42,
    stamina: 16,
    lunge: 2.8,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'blade_heavy_2',
  },
  blade_heavy_2: {
    id: 'blade_heavy_2',
    label: 'Saber Heavy Cross II',
    clip: 'rpg1HandBaseAttackC2Combo',
    duration: 0.72,
    hitWindow: [0.22, 0.54],
    damage: 76,
    poiseDamage: 48,
    stamina: 16,
    lunge: 2.9,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'blade_heavy_3',
  },
  blade_heavy_3: {
    id: 'blade_heavy_3',
    label: 'Saber Heavy Rend III',
    clip: 'rpg1HandBaseAttackC3Combo',
    duration: 0.76,
    hitWindow: [0.24, 0.56],
    damage: 86,
    poiseDamage: 54,
    stamina: 18,
    lunge: 3.0,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'blade_heavy_4',
  },
  blade_heavy_4: {
    id: 'blade_heavy_4',
    label: 'Saber Heavy Vortex IV',
    clip: 'rpg1HandBaseAttackC4Combo',
    duration: 0.80,
    hitWindow: [0.24, 0.56],
    damage: 94,
    poiseDamage: 60,
    stamina: 20,
    lunge: 3.2,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'sword_heavy',
  },
  blade_air_slash: {
    id: 'blade_air_slash',
    label: 'Aerial Saber Plunge',
    clip: 'rpg1HandBaseJumpAttack1',
    duration: 0.86,
    hitWindow: [0.24, 0.58],
    damage: 106,
    poiseDamage: 72,
    stamina: 18,
    lunge: 4.5,
    flowKind: 'leap',
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },

  // ==========================================================================
  // 4. POLEARM & MAGE STAFF STYLE (bcdSpearSlashA..B, ComboA..D, StabA..E)
  // ==========================================================================
  staff_cut_1: {
    id: 'staff_cut_1',
    label: 'Polearm Sweeping Arc I',
    clip: 'bcdSpearSlashA',
    duration: 0.70,
    hitWindow: [0.22, 0.52],
    damage: 48,
    poiseDamage: 28,
    stamina: 12,
    lunge: 2.7,
    flowKind: 'cut',
    next: 'staff_cut_2',
  },
  staff_cut_2: {
    id: 'staff_cut_2',
    label: 'Polearm Reverse Sweep II',
    clip: 'bcdSpearSlashB',
    duration: 0.70,
    hitWindow: [0.22, 0.52],
    damage: 54,
    poiseDamage: 32,
    stamina: 12,
    lunge: 2.7,
    flowKind: 'cut',
    next: 'staff_cut_3',
  },
  staff_cut_3: {
    id: 'staff_cut_3',
    label: 'Halberd Whirlwind III',
    clip: 'bcdSpearComboA',
    duration: 0.74,
    hitWindow: [0.22, 0.54],
    damage: 62,
    poiseDamage: 38,
    stamina: 14,
    lunge: 2.9,
    flowKind: 'cut',
    next: 'staff_cut_4',
  },
  staff_cut_4: {
    id: 'staff_cut_4',
    label: 'Halberd Spiral Strike IV',
    clip: 'bcdSpearComboB',
    duration: 0.76,
    hitWindow: [0.24, 0.56],
    damage: 70,
    poiseDamage: 44,
    stamina: 15,
    lunge: 3.0,
    flowKind: 'cut',
    next: 'staff_cut_5',
  },
  staff_cut_5: {
    id: 'staff_cut_5',
    label: 'Archmage Staff Flurry V',
    clip: 'bcdSpearComboC',
    duration: 0.78,
    hitWindow: [0.24, 0.56],
    damage: 78,
    poiseDamage: 50,
    stamina: 16,
    lunge: 3.1,
    flowKind: 'cut',
    next: 'staff_cut_6',
  },
  staff_cut_6: {
    id: 'staff_cut_6',
    label: 'Sanctum Sovereign Slam VI',
    clip: 'bcdSpearComboD',
    duration: 0.88,
    hitWindow: [0.26, 0.60],
    damage: 106,
    poiseDamage: 72,
    stamina: 20,
    lunge: 3.6,
    flowKind: 'heavy',
    heavyImpact: true,
    next: null,
  },
  staff_heavy_1: {
    id: 'staff_heavy_1',
    label: 'Impaling Lance Thrust I',
    clip: 'bcdSpearStabA',
    duration: 0.70,
    hitWindow: [0.20, 0.50],
    damage: 68,
    poiseDamage: 46,
    stamina: 16,
    lunge: 3.4,
    flowKind: 'thrust',
    isThrust: true,
    heavyImpact: true,
    next: 'staff_heavy_2',
  },
  staff_heavy_2: {
    id: 'staff_heavy_2',
    label: 'Dragon-Piercer Lunge II',
    clip: 'bcdSpearStabB',
    duration: 0.72,
    hitWindow: [0.20, 0.52],
    damage: 76,
    poiseDamage: 52,
    stamina: 16,
    lunge: 3.5,
    flowKind: 'thrust',
    isThrust: true,
    heavyImpact: true,
    next: 'staff_heavy_3',
  },
  staff_heavy_3: {
    id: 'staff_heavy_3',
    label: 'Trident Heart-Seeker III',
    clip: 'bcdSpearStabC',
    duration: 0.76,
    hitWindow: [0.22, 0.54],
    damage: 86,
    poiseDamage: 58,
    stamina: 18,
    lunge: 3.6,
    flowKind: 'thrust',
    isThrust: true,
    heavyImpact: true,
    next: 'staff_heavy_4',
  },
  staff_heavy_4: {
    id: 'staff_heavy_4',
    label: 'Valkyrie Sky-Thrust IV',
    clip: 'bcdSpearStabD',
    duration: 0.80,
    hitWindow: [0.22, 0.56],
    damage: 96,
    poiseDamage: 66,
    stamina: 20,
    lunge: 3.8,
    flowKind: 'thrust',
    isThrust: true,
    heavyImpact: true,
    next: 'staff_heavy_5',
  },
  staff_heavy_5: {
    id: 'staff_heavy_5',
    label: 'Gungnir Cataclysm Thrust V',
    clip: 'bcdSpearStabE',
    duration: 0.90,
    hitWindow: [0.24, 0.58],
    damage: 128,
    poiseDamage: 88,
    stamina: 22,
    lunge: 4.4,
    flowKind: 'heavy',
    isThrust: true,
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },
  staff_air_slash: {
    id: 'staff_air_slash',
    label: 'Dragoon Skyward Plunge',
    clip: 'bcdSpearJumpAttackA',
    duration: 0.90,
    hitWindow: [0.24, 0.58],
    damage: 114,
    poiseDamage: 80,
    stamina: 20,
    lunge: 4.8,
    flowKind: 'leap',
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },

  // ==========================================================================
  // 5. ELECTRO-MAG BATON & TWIN-BLADE STYLE (bcdCS1Slash01..05 + bcdTSComboA)
  // ==========================================================================
  baton_cut_1: {
    id: 'baton_cut_1',
    label: 'Electro-Baton Snap Jab I',
    clip: 'bcdCS1Slash01',
    duration: 0.56,
    hitWindow: [0.18, 0.46],
    damage: 42,
    poiseDamage: 22,
    stamina: 10,
    lunge: 2.3,
    flowKind: 'cut',
    next: 'baton_cut_2',
  },
  baton_cut_2: {
    id: 'baton_cut_2',
    label: 'Electro-Baton Arc Sweep II',
    clip: 'bcdCS1Slash02',
    duration: 0.58,
    hitWindow: [0.20, 0.48],
    damage: 48,
    poiseDamage: 25,
    stamina: 10,
    lunge: 2.4,
    flowKind: 'cut',
    next: 'baton_cut_3',
  },
  baton_cut_3: {
    id: 'baton_cut_3',
    label: 'Turk Spinning Whip III',
    clip: 'bcdCS1Slash03',
    duration: 0.62,
    hitWindow: [0.20, 0.50],
    damage: 54,
    poiseDamage: 30,
    stamina: 11,
    lunge: 2.5,
    flowKind: 'cut',
    next: 'baton_cut_4',
  },
  baton_cut_4: {
    id: 'baton_cut_4',
    label: 'Volt Risinglash IV',
    clip: 'bcdCS1Slash04',
    duration: 0.64,
    hitWindow: [0.22, 0.52],
    damage: 62,
    poiseDamage: 34,
    stamina: 12,
    lunge: 2.6,
    flowKind: 'cut',
    next: 'baton_cut_5',
  },
  baton_cut_5: {
    id: 'baton_cut_5',
    label: 'Tempest Baton Flurry V',
    clip: 'bcdCS1Slash05',
    duration: 0.68,
    hitWindow: [0.22, 0.54],
    damage: 70,
    poiseDamage: 40,
    stamina: 14,
    lunge: 2.8,
    flowKind: 'cut',
    next: 'baton_cut_6',
  },
  baton_cut_6: {
    id: 'baton_cut_6',
    label: 'Overload Shock Lunge VI',
    clip: 'bcdCS1Stab03',
    duration: 0.78,
    hitWindow: [0.22, 0.56],
    damage: 96,
    poiseDamage: 62,
    stamina: 16,
    lunge: 3.5,
    flowKind: 'thrust',
    isThrust: true,
    heavyImpact: true,
    next: null,
  },
  baton_heavy_1: {
    id: 'baton_heavy_1',
    label: 'Twin-Fang Cyclone I',
    clip: 'bcdTSComboA01',
    duration: 0.66,
    hitWindow: [0.20, 0.50],
    damage: 64,
    poiseDamage: 38,
    stamina: 14,
    lunge: 2.8,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'baton_heavy_2',
  },
  baton_heavy_2: {
    id: 'baton_heavy_2',
    label: 'Twin-Fang Scissor Rend II',
    clip: 'bcdTSComboA02',
    duration: 0.68,
    hitWindow: [0.20, 0.52],
    damage: 74,
    poiseDamage: 44,
    stamina: 15,
    lunge: 2.9,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'baton_heavy_3',
  },
  baton_heavy_3: {
    id: 'baton_heavy_3',
    label: 'Twin-Fang Whirling Dance III',
    clip: 'bcdTSComboA03',
    duration: 0.74,
    hitWindow: [0.22, 0.54],
    damage: 84,
    poiseDamage: 52,
    stamina: 16,
    lunge: 3.1,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'baton_heavy_4',
  },
  baton_heavy_4: {
    id: 'baton_heavy_4',
    label: 'Twin-Fang Cross-Cut IV',
    clip: 'bcdTSSlash02',
    duration: 0.76,
    hitWindow: [0.22, 0.56],
    damage: 92,
    poiseDamage: 58,
    stamina: 18,
    lunge: 3.2,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'baton_heavy_5',
  },
  baton_heavy_5: {
    id: 'baton_heavy_5',
    label: 'Electro-Mag Discharge Finale V',
    clip: 'bcdTSSlash03',
    duration: 0.86,
    hitWindow: [0.24, 0.58],
    damage: 118,
    poiseDamage: 78,
    stamina: 20,
    lunge: 3.6,
    flowKind: 'heavy',
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },
  baton_air_slash: {
    id: 'baton_air_slash',
    label: 'Aerial Volt Dive',
    clip: 'bcdCS1JumpAttack01',
    duration: 0.82,
    hitWindow: [0.22, 0.56],
    damage: 102,
    poiseDamage: 68,
    stamina: 16,
    lunge: 4.4,
    flowKind: 'leap',
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },

  // ==========================================================================
  // 6. FF7 REMAKE PUNISHER MODE 5-HIT BERSERK HEAVY CHAIN
  // ==========================================================================
  punisher1: {
    id: 'punisher1',
    label: 'Punisher Berserk Slash I',
    clip: 'rpg2HandBaseAttackB1',
    duration: 0.80,
    hitWindow: [0.25, 0.54],
    damage: 74,
    poiseDamage: 46,
    stamina: 20,
    lunge: 2.8,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'punisher2',
  },
  punisher2: {
    id: 'punisher2',
    label: 'Punisher Cross Rend II',
    clip: 'rpg2HandBaseAttackB2Combo',
    duration: 0.78,
    hitWindow: [0.24, 0.54],
    damage: 82,
    poiseDamage: 52,
    stamina: 20,
    lunge: 2.9,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'punisher3',
  },
  punisher3: {
    id: 'punisher3',
    label: 'Punisher Guillotine III',
    clip: 'rpg2HandBaseAttackB3Combo',
    duration: 0.82,
    hitWindow: [0.24, 0.56],
    damage: 90,
    poiseDamage: 58,
    stamina: 22,
    lunge: 3.0,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'punisher4',
  },
  punisher4: {
    id: 'punisher4',
    label: 'Punisher Whirlwind IV',
    clip: 'rpg2HandBaseAttackB4Combo',
    duration: 0.84,
    hitWindow: [0.26, 0.58],
    damage: 98,
    poiseDamage: 64,
    stamina: 24,
    lunge: 3.2,
    flowKind: 'heavy',
    heavyImpact: true,
    next: 'great_heavy',
  },
  great_heavy: {
    id: 'great_heavy',
    label: 'Buster Overhead Crush V',
    clip: 'Great_Heavy',
    duration: 0.96,
    hitWindow: [0.26, 0.56],
    damage: 132,
    poiseDamage: 92,
    stamina: 26,
    lunge: 3.6,
    flowKind: 'heavy',
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },

  // ==========================================================================
  // 7. SPRINT DASH CLEAVE, RISING UNDERCUT, THRUST, KICK, BACKHAND & FATALITIES
  // ==========================================================================
  sprint_dash_attack: {
    id: 'sprint_dash_attack',
    label: 'Sprint Dash Buster Cleave',
    clip: 'rpg2HandBaseAttackDash1',
    duration: 0.82,
    hitWindow: [0.20, 0.56],
    damage: 88,
    poiseDamage: 62,
    stamina: 18,
    lunge: 5.8,
    flowKind: 'dash',
    heavyImpact: true,
    next: 'great_cut_b',
  },
  sprint_slide_cleave: {
    id: 'sprint_slide_cleave',
    label: 'Buster Low Slide Sweep',
    clip: 'gsGreatSwordSlideAttack',
    duration: 0.88,
    hitWindow: [0.22, 0.58],
    damage: 92,
    poiseDamage: 68,
    stamina: 20,
    lunge: 6.2,
    flowKind: 'dash',
    heavyImpact: true,
    isLauncher: true,
    next: 'great_rising',
  },
  great_rising: {
    id: 'great_rising',
    label: 'Buster Rising Undercut',
    clip: 'Great_Rising',
    duration: 0.86,
    hitWindow: [0.26, 0.54],
    damage: 90,
    poiseDamage: 72,
    stamina: 20,
    lunge: 3.2,
    flowKind: 'rising',
    heavyImpact: true,
    isLauncher: true,
    next: 'leaping_smash',
  },
  sword_rising: {
    id: 'sword_rising',
    label: 'Rising Crescent Undercut',
    clip: 'Sword_Rising',
    duration: 0.78,
    hitWindow: [0.26, 0.54],
    damage: 78,
    poiseDamage: 62,
    stamina: 18,
    lunge: 3.0,
    flowKind: 'rising',
    heavyImpact: true,
    isLauncher: true,
    next: 'leaping_smash',
  },
  sword_thrust: {
    id: 'sword_thrust',
    label: 'Piercing Needle Thrust',
    clip: 'Sword_Thrust',
    duration: 0.74,
    hitWindow: [0.20, 0.48],
    damage: 82,
    poiseDamage: 56,
    stamina: 16,
    lunge: 4.6,
    flowKind: 'thrust',
    isThrust: true,
    next: 'great_rising',
  },
  guard_break_kick: {
    id: 'guard_break_kick',
    label: 'Buster Guard-Break Kick',
    clip: 'gsGreatSwordKick',
    duration: 0.68,
    hitWindow: [0.20, 0.48],
    damage: 48,
    poiseDamage: 92,
    stamina: 14,
    lunge: 2.8,
    flowKind: 'kick',
    breaksGuard: true,
    heavyImpact: true,
    next: 'punisher1',
  },
  backhand_turn_slash: {
    id: 'backhand_turn_slash',
    label: '180° Backhand Seam Counter',
    clip: 'gsGreatSword180Turn',
    duration: 0.76,
    hitWindow: [0.18, 0.54],
    damage: 94,
    poiseDamage: 72,
    stamina: 16,
    lunge: 2.6,
    flowKind: 'counter',
    heavyImpact: true,
    hyperArmor: true,
    aoeRadius: 3.4,
    next: 'great_cut_c',
  },
  leaping_smash: {
    id: 'leaping_smash',
    label: 'Leaping Plunge Cleave',
    clip: 'gsGreatSwordJumpAttack',
    duration: 0.96,
    hitWindow: [0.28, 0.60],
    damage: 112,
    poiseDamage: 78,
    stamina: 22,
    lunge: 4.6,
    flowKind: 'leap',
    heavyImpact: true,
    hyperArmor: true,
    next: null,
  },
  punisher_counter: {
    id: 'punisher_counter',
    label: 'Punisher Counterstance Slash',
    clip: 'rpg2HandBaseAttackC2To1',
    duration: 0.84,
    hitWindow: [0.18, 0.56],
    damage: 124,
    poiseDamage: 86,
    stamina: 0,
    lunge: 3.2,
    flowKind: 'counter',
    heavyImpact: true,
    hyperArmor: true,
    next: 'punisher2',
  },
  resolute_counter: {
    id: 'resolute_counter',
    label: 'RESOLUTE STRIKE (SEE-THROUGH)',
    clip: 'rpg2HandBaseAttackC2To1',
    duration: 0.76,
    hitWindow: [0.20, 0.58],
    seeThroughWindow: [0.0, 0.48],
    damage: 138,
    poiseDamage: 108,
    stamina: 10,
    lunge: 3.8,
    flowKind: 'counter',
    heavyImpact: true,
    hyperArmor: true,
    cracksArmor: true,
    next: 'skyfall_strike',
  },
  skyfall_strike: {
    id: 'skyfall_strike',
    label: 'SKYFALL STRIKE (HEAVEN CLEAVE)',
    clip: 'gsGreatSwordJumpAttack',
    duration: 0.86,
    hitWindow: [0.24, 0.62],
    damage: 188,
    poiseDamage: 148,
    stamina: 12,
    lunge: 5.2,
    flowKind: 'heavy',
    heavyImpact: true,
    hyperArmor: true,
    cracksArmor: true,
    aoeRadius: 4.4,
    next: null,
  },
  pillar_churn_slam: {
    id: 'pillar_churn_slam',
    label: 'PILLAR STANCE: CHURNING GALE SLAM',
    clip: 'GS_Jump_Attack',
    duration: 0.94,
    hitWindow: [0.32, 0.64],
    damage: 164,
    poiseDamage: 132,
    stamina: 16,
    lunge: 5.4,
    flowKind: 'leap',
    heavyImpact: true,
    hyperArmor: true,
    cracksArmor: true,
    aoeRadius: 4.6,
    next: null,
  },
  mirage_flash_strike: {
    id: 'mirage_flash_strike',
    label: 'MIRAGE FLASH COUNTER (PERFECT DODGE)',
    clip: 'bcdCKComboA04',
    duration: 0.68,
    hitWindow: [0.16, 0.56],
    damage: 162,
    poiseDamage: 112,
    stamina: 8,
    lunge: 5.0,
    flowKind: 'counter',
    heavyImpact: true,
    hyperArmor: true,
    cracksArmor: true,
    aoeRadius: 3.8,
    next: 'skyfall_strike',
  },
  fatal_riposte_2h: {
    id: 'fatal_riposte_2h',
    label: 'VISCERAL EXECUTION (2H Fatal)',
    clip: 'rpg2HandBaseFatalAttack1',
    duration: 1.05,
    hitWindow: [0.22, 0.65],
    damage: 245,
    poiseDamage: 140,
    stamina: 0,
    lunge: 2.4,
    flowKind: 'fatal',
    heavyImpact: true,
    hyperArmor: true,
    cracksArmor: true,
    next: null,
  },
  fatal_riposte_1h: {
    id: 'fatal_riposte_1h',
    label: 'VISCERAL EXECUTION (1H Fatal)',
    clip: 'rpg1HandBaseFatalAttack1',
    duration: 0.98,
    hitWindow: [0.20, 0.62],
    damage: 235,
    poiseDamage: 135,
    stamina: 0,
    lunge: 2.4,
    flowKind: 'fatal',
    heavyImpact: true,
    hyperArmor: true,
    cracksArmor: true,
    next: null,
  },

  // ==========================================================================
  // 8. PRO MAGIC PACK 3-HIT ARCANE SPELL COMBO ([T] Key) + 2H BEAM FINISHER
  // ==========================================================================
  magic_bolt_1: {
    id: 'magic_bolt_1',
    label: 'Arcane Starbolt I',
    clip: 'Magic_1H_Attack_1',
    duration: 0.72,
    hitWindow: [0.28, 0.52],
    damage: 64,
    poiseDamage: 34,
    stamina: 10,
    lunge: 1.0,
    flowKind: 'spell',
    isSpell: true,
    spellType: 'bolt1',
    next: 'magic_bolt_2',
  },
  magic_bolt_2: {
    id: 'magic_bolt_2',
    label: 'Twin Rime-Fire Volley II',
    clip: 'Magic_1H_Attack_2',
    duration: 0.72,
    hitWindow: [0.28, 0.52],
    damage: 76,
    poiseDamage: 42,
    stamina: 12,
    lunge: 1.0,
    flowKind: 'spell',
    isSpell: true,
    spellType: 'bolt2',
    next: 'magic_bolt_3',
  },
  magic_bolt_3: {
    id: 'magic_bolt_3',
    label: 'Coalesced Arcane Lance III',
    clip: 'Magic_2H_Attack_2',
    duration: 0.92,
    hitWindow: [0.30, 0.62],
    damage: 118,
    poiseDamage: 74,
    stamina: 16,
    lunge: 1.2,
    flowKind: 'spell',
    heavyImpact: true,
    isSpell: true,
    spellType: 'beam',
    next: null,
  },

  // ==========================================================================
  // 9. THE 10 GRIMOIRE SPELLS (Elemental Sandboxes + Pro Magic Pack + Pigaloo)
  // ==========================================================================
  spell_phoenix_tide: {
    id: 'spell_phoenix_tide',
    label: 'GRIMOIRE: SERPENT TIDE PHOENIX',
    clip: 'Magic_2H_Attack_3',
    duration: 1.06,
    hitWindow: [0.28, 0.62],
    damage: 174,
    poiseDamage: 122,
    stamina: 14,
    lunge: 0.8,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    isSpell: true,
    spellType: 'phoenix_tide',
    aoeRadius: 6.4,
  },
  spell_celestial_rend: {
    id: 'spell_celestial_rend',
    label: 'GRIMOIRE: CELESTIAL REND CATACLYSM',
    clip: 'Cast_Surge',
    duration: 1.04,
    hitWindow: [0.28, 0.62],
    damage: 182,
    poiseDamage: 146,
    stamina: 16,
    lunge: 1.0,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    cracksArmor: true,
    isSpell: true,
    spellType: 'celestial_rend',
    aoeRadius: 6.8,
  },
  spell_caustic_bloom: {
    id: 'spell_caustic_bloom',
    label: 'GRIMOIRE: CAUSTIC BLOOM MIASMA',
    clip: 'Magic_2H_Attack_4',
    duration: 0.96,
    hitWindow: [0.26, 0.58],
    damage: 146,
    poiseDamage: 108,
    stamina: 12,
    lunge: 0.8,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    cracksArmor: true,
    isSpell: true,
    spellType: 'caustic_bloom',
    aoeRadius: 6.2,
  },
  spell_venom_surge: {
    id: 'spell_venom_surge',
    label: 'GRIMOIRE: CRYSTALLIZED VENOM SURGE',
    clip: 'Magic_2H_Attack_2',
    duration: 0.94,
    hitWindow: [0.26, 0.60],
    damage: 154,
    poiseDamage: 118,
    stamina: 14,
    lunge: 1.0,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    cracksArmor: true,
    isSpell: true,
    spellType: 'venom_surge',
  },
  spell_threadlight: {
    id: 'spell_threadlight',
    label: 'GRIMOIRE: THREADLIGHT RIBBONS',
    clip: 'Cast_Thread',
    duration: 0.92,
    hitWindow: [0.30, 0.58],
    damage: 124,
    poiseDamage: 82,
    stamina: 14,
    lunge: 0.8,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    isSpell: true,
    spellType: 'threadlight',
  },
  spell_prism_surge: {
    id: 'spell_prism_surge',
    label: 'GRIMOIRE: PRISM SURGE',
    clip: 'Cast_Surge',
    duration: 1.02,
    hitWindow: [0.30, 0.62],
    damage: 142,
    poiseDamage: 128,
    stamina: 14,
    lunge: 1.0,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    isSpell: true,
    spellType: 'prism_surge',
    aoeRadius: 6.4,
  },
  spell_crimson_meteor: {
    id: 'spell_crimson_meteor',
    label: 'GRIMOIRE: IGNIS METEOR CATACLYSM',
    clip: 'Magic_2H_Attack_3',
    duration: 1.12,
    hitWindow: [0.34, 0.66],
    damage: 168,
    poiseDamage: 110,
    stamina: 16,
    lunge: 0.8,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    isSpell: true,
    spellType: 'meteor',
  },
  spell_rime_tempest: {
    id: 'spell_rime_tempest',
    label: 'GRIMOIRE: RIME TEMPEST VORTEX',
    clip: 'Magic_2H_Attack_5',
    duration: 1.08,
    hitWindow: [0.32, 0.64],
    damage: 148,
    poiseDamage: 115,
    stamina: 16,
    lunge: 0.8,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    isSpell: true,
    spellType: 'storm',
    aoeRadius: 6.8,
  },
  spell_abyssal_nova: {
    id: 'spell_abyssal_nova',
    label: 'GRIMOIRE: ABYSSAL VOID NOVA',
    clip: 'Magic_2H_Attack_4',
    duration: 1.06,
    hitWindow: [0.32, 0.64],
    damage: 158,
    poiseDamage: 120,
    stamina: 16,
    lunge: 0.8,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    cracksArmor: true,
    isSpell: true,
    spellType: 'nova',
    aoeRadius: 6.6,
  },
  spell_blade_imbue: {
    id: 'spell_blade_imbue',
    label: 'GRIMOIRE: ELEMENTAL BLADE IMBUE',
    clip: 'rpg2HandBaseBurnFire',
    duration: 0.82,
    hitWindow: [0.24, 0.54],
    damage: 90,
    poiseDamage: 68,
    stamina: 10,
    lunge: 0.6,
    flowKind: 'spell',
    hyperArmor: true,
    heavyImpact: true,
    isSpell: true,
    spellType: 'imbue',
    aoeRadius: 4.2,
  },

  // ==========================================================================
  // 10. FF7 REMAKE ATB WEAPON SKILLS ([1/F], [2], [3], [4]) & LIMIT BREAK ([I])
  // ==========================================================================
  braver: {
    id: 'braver',
    label: 'BRAVER (Vaulting Buster Cleave)',
    clip: 'rpg2HandBaseSkill1',
    duration: 1.04,
    hitWindow: [0.28, 0.62],
    damage: 168,
    poiseDamage: 118,
    stamina: 10,
    lunge: 5.2,
    flowKind: 'skill',
    hyperArmor: true,
    heavyImpact: true,
    cracksArmor: true,
  },
  focused_thrust: {
    id: 'focused_thrust',
    label: 'FOCUSED THRUST (Stagger Drill)',
    clip: 'rpg2HandBaseSkill2',
    duration: 0.96,
    hitWindow: [0.18, 0.66],
    damage: 115,
    poiseDamage: 168,
    stamina: 10,
    lunge: 6.4,
    flowKind: 'skill',
    hyperArmor: true,
    heavyImpact: true,
    isThrust: true,
  },
  infinity_spin: {
    id: 'infinity_spin',
    label: 'INFINITY SPIN (Cyclone Slash)',
    clip: 'gsGreatSwordHighSpinAttack',
    duration: 1.10,
    hitWindow: [0.20, 0.70],
    damage: 152,
    poiseDamage: 112,
    stamina: 10,
    lunge: 5.8,
    flowKind: 'skill',
    hyperArmor: true,
    heavyImpact: true,
    aoeRadius: 4.2,
  },
  arcane_surge: {
    id: 'arcane_surge',
    label: 'ARCANE SURGE (Prism + Thread)',
    clip: 'Cast_Surge',
    duration: 1.02,
    hitWindow: [0.28, 0.62],
    damage: 142,
    poiseDamage: 118,
    stamina: 10,
    lunge: 1.2,
    flowKind: 'skill',
    hyperArmor: true,
    heavyImpact: true,
    isSpell: true,
    spellType: 'prism_surge',
    aoeRadius: 6.4,
  },
  limit_cross_slash: {
    id: 'limit_cross_slash',
    label: 'LIMIT BREAK: CROSS-SLASH',
    clip: 'gsGreatSwordHighSpinAttack',
    duration: 1.28,
    hitWindow: [0.16, 0.78],
    damage: 285,
    poiseDamage: 240,
    stamina: 0,
    lunge: 6.6,
    flowKind: 'limit',
    hyperArmor: true,
    heavyImpact: true,
    isLimitBreak: true,
    cracksArmor: true,
    aoeRadius: 5.0,
  },
};

// Enemy Attack Movesets with High-Speed Sword Swings, Multi-Hit Combo Chains, Perilous Thrust/Sweep Telegraphs & Gap-Closers
export const ENEMY_MOVES = {
  slashFast: { id: 'slashFast', clip: 'Sword_Cut_A', duration: 0.58, hitWindow: [0.20, 0.54], damage: 92, poise: 54, lunge: 3.8, delayed: false, nextCombo: 'slashCombo', comboChance: 0.86 },
  slashCombo: { id: 'slashCombo', clip: 'Great_Cut_B', duration: 0.58, hitWindow: [0.18, 0.54], damage: 104, poise: 62, lunge: 4.0, delayed: false, nextCombo: 'risingCut', comboChance: 0.78 },
  risingCut: { id: 'risingCut', clip: 'Great_Rising', duration: 0.64, hitWindow: [0.22, 0.56], damage: 116, poise: 72, lunge: 4.2, delayed: false, nextCombo: 'overheadSlam', comboChance: 0.72 },
  whirlwindCleave: { id: 'whirlwindCleave', clip: 'Great_Whirl', duration: 0.68, hitWindow: [0.18, 0.62], damage: 124, poise: 78, lunge: 4.6, delayed: false, perilous: 'sweep', nextCombo: 'slashCombo', comboChance: 0.76 },
  katanaBlitz: { id: 'katanaBlitz', clip: 'bcdCKComboA02', duration: 0.52, hitWindow: [0.16, 0.56], damage: 98, poise: 58, lunge: 4.4, delayed: false, nextCombo: 'katanaFinisher', comboChance: 0.90 },
  katanaFinisher: { id: 'katanaFinisher', clip: 'bcdCKComboA03', duration: 0.58, hitWindow: [0.18, 0.58], damage: 118, poise: 68, lunge: 4.6, delayed: false, nextCombo: 'cycloneFury', comboChance: 0.74 },
  heavyDelayed: { id: 'heavyDelayed', clip: 'Great_Heavy', duration: 0.86, hitWindow: [0.28, 0.60], damage: 142, poise: 88, lunge: 4.6, delayed: true, nextCombo: 'whirlwindCleave', comboChance: 0.75 },
  overheadSlam: { id: 'overheadSlam', clip: 'gsGreatSwordSlash5', duration: 0.90, hitWindow: [0.30, 0.62], damage: 164, poise: 98, lunge: 5.0, delayed: true, nextCombo: 'leapingCrush', comboChance: 0.68 },
  leapingCrush: { id: 'leapingCrush', clip: 'GS_Jump_Attack', duration: 0.78, hitWindow: [0.26, 0.62], damage: 158, poise: 94, lunge: 6.8, delayed: false, nextCombo: 'whirlwindCleave', comboChance: 0.74 },
  polearmSweep: { id: 'polearmSweep', clip: 'bcdSpearSlashA', duration: 0.74, hitWindow: [0.24, 0.58], damage: 126, poise: 76, lunge: 4.8, delayed: true, perilous: 'sweep', nextCombo: 'polearmComboB', comboChance: 0.84 },
  polearmComboB: { id: 'polearmComboB', clip: 'bcdSpearComboB', duration: 0.66, hitWindow: [0.20, 0.58], damage: 132, poise: 82, lunge: 4.6, delayed: false, nextCombo: 'gapCloserThrust', comboChance: 0.74 },
  flurryChain: { id: 'flurryChain', clip: 'rpgEnemyAttack42Combo', duration: 0.84, hitWindow: [0.14, 0.74], damage: 128, poise: 78, lunge: 5.4, delayed: false, nextCombo: 'risingCut', comboChance: 0.80 },
  gapCloserThrust: { id: 'gapCloserThrust', clip: 'Sword_Thrust', duration: 0.52, hitWindow: [0.16, 0.54], damage: 125, poise: 84, lunge: 9.2, delayed: false, perilous: 'thrust', nextCombo: 'slashCombo', comboChance: 0.86 },
  waterfowlDance: { id: 'waterfowlDance', clip: 'gsGreatSwordHighSpinAttack', duration: 0.88, hitWindow: [0.14, 0.78], damage: 172, poise: 96, lunge: 7.0, delayed: true, nextCombo: 'katanaBlitz', comboChance: 0.84 },
  predatorPounce: { id: 'predatorPounce', clip: 'GS_Jump_Attack', duration: 0.50, hitWindow: [0.16, 0.52], damage: 112, poise: 68, lunge: 6.2, delayed: false, perilous: 'thrust', nextCombo: 'slashFast', comboChance: 0.88 },
  cycloneFury: { id: 'cycloneFury', clip: 'gsGreatSwordHighSpinAttack', duration: 0.62, hitWindow: [0.15, 0.64], damage: 138, poise: 86, lunge: 5.2, delayed: false, nextCombo: 'leapingCrush', comboChance: 0.82 },
  sovereignCataclysm: { id: 'sovereignCataclysm', clip: 'gsGreatSwordSlash5', duration: 0.84, hitWindow: [0.24, 0.62], damage: 195, poise: 110, lunge: 6.2, delayed: true, nextCombo: 'cycloneFury', comboChance: 0.84 },
};

// 4-Chapter Multi-Level Campaign Progression with Escalating Difficulty & Creature/Boss Rosters
export const CHAPTER_REALMS = [
  {
    chapter: 1,
    index: 1,
    id: 'chapter_1',
    name: 'Chapter I: The Sakura Threshold',
    subtitle: 'Weeping Somei-Yoshino Gorge & Sovereign Crater',
    diffHp: 1.0,
    diffDmg: 1.0,
    diffSpeed: 1.0,
    bannerColor: '#ffb8d2',
    overrides: {},
  },
  {
    chapter: 2,
    index: 2,
    id: 'chapter_2',
    name: 'Chapter II: The Crimson Autumn Sanctum',
    subtitle: 'Blood-Maple Highland, Beast Packs & Black Blade',
    diffHp: 1.45,
    diffDmg: 1.32,
    diffSpeed: 1.14,
    bannerColor: '#ff6a36',
    overrides: {
      ravine_guai_1: { name: 'Blood-Claw Stalker Guai', file: '/sibling/tartarus/public/cast/katakan.glb', height: 1.24, moves: ['predatorPounce', 'slashFast', 'katanaBlitz'] },
      ravine_guai_2: { name: 'Crimson Feral Guai', file: '/sibling/tartarus/public/cast/reptilian.glb', height: 1.26, moves: ['predatorPounce', 'slashFast', 'katanaBlitz'] },
      spartos_1: { name: 'Blood-Moon Werewolf Stalker', file: '/sibling/tartarus/public/cast/werewolf.glb', height: 2.38, moves: ['predatorPounce', 'flurryChain', 'leapingCrush'] },
      tide_exec: { name: 'Katakan Elder Vampire', file: '/sibling/tartarus/public/cast/katakan.glb', height: 2.95, moves: ['predatorPounce', 'cycloneFury', 'leapingCrush'] },
      elder_lithos: { name: 'Blighted Ogre Behemoth', file: '/sibling/tartarus/public/cast/ogre.glb', height: 5.35, moves: ['sovereignCataclysm', 'leapingCrush', 'overheadSlam'] },
      drakaina_halberd: { name: 'Centaur Crimson Lancer', file: '/sibling/tartarus/public/cast/centaur_m.glb', height: 2.85, moves: ['polearmSweep', 'polearmComboB', 'gapCloserThrust'] },
      boss_krampus: { name: 'Azazel, Arch-Demon Lord', title: 'Warden of the Crimson Maple Sanctum', file: '/sibling/tartarus/public/cast/demon_lord.glb', height: 4.65, moves: ['sovereignCataclysm', 'cycloneFury', 'leapingCrush', 'flurryChain'] },
      warden_blaidd: { name: 'Harvester of the Blood Boughs', file: '/sibling/tartarus/public/cast/harvester.glb', height: 3.65, moves: ['cycloneFury', 'whirlwindCleave', 'leapingCrush'] },
      boss_mirror_noble: { name: 'Lady Maria of the Astral Clocktower', title: 'Blood-Flame Duelist of the Basin', file: '/sibling/tartarus/public/cast/lady_maria.glb', height: 2.08, moves: ['waterfowlDance', 'katanaBlitz', 'katanaFinisher', 'gapCloserThrust'] },
      boss_apex_sovereign: { name: 'Maliketh, the Black Blade', title: 'Colossal Death-Rune Sovereign of Chapter II', file: '/sibling/tartarus/public/cast/maliketh.glb', height: 5.85, moves: ['sovereignCataclysm', 'waterfowlDance', 'cycloneFury', 'leapingCrush'] },
    },
  },
  {
    chapter: 3,
    index: 3,
    id: 'chapter_3',
    name: 'Chapter III: The Frostbound Dragon Spire',
    subtitle: 'Glacial Switchbacks, Dragonkin & Frost Sovereign',
    diffHp: 1.85,
    diffDmg: 1.58,
    diffSpeed: 1.24,
    bannerColor: '#7be0ff',
    overrides: {
      ravine_guai_1: { name: 'Glacial Frost Skulker', file: '/sibling/tartarus/public/cast/reptilian.glb', height: 1.22, moves: ['predatorPounce', 'katanaBlitz'] },
      ravine_guai_2: { name: 'Rime-Cursed Nosferatu', file: '/sibling/tartarus/public/cast/katakan.glb', height: 1.28, moves: ['predatorPounce', 'flurryChain'] },
      spartos_1: { name: 'Frost-Fang Werewolf', file: '/sibling/tartarus/public/cast/werewolf.glb', height: 2.25, moves: ['predatorPounce', 'katanaBlitz', 'gapCloserThrust'] },
      scale_guard: { name: 'Dragonkin Frost Sentinel', file: '/sibling/tartarus/public/cast/dragonkin_1.glb', height: 2.35, moves: ['polearmSweep', 'whirlwindCleave', 'leapingCrush'] },
      tide_exec: { name: 'Dragonkin Glacier Executioner', file: '/sibling/tartarus/public/cast/dragonkin_2.glb', height: 3.25, moves: ['cycloneFury', 'overheadSlam', 'leapingCrush'] },
      elder_lithos: { name: 'Glacial Behemoth Titan', file: '/sibling/tartarus/public/cast/behemoth.glb', height: 5.55, moves: ['sovereignCataclysm', 'leapingCrush', 'whirlwindCleave'] },
      boss_krampus: { name: 'Ulsamir, Frost Wyrm Sovereign', title: 'Colossal Guardian of the Glacial Courtyard', file: '/sibling/tartarus/public/cast/ulsamir.glb', height: 4.85, moves: ['sovereignCataclysm', 'cycloneFury', 'leapingCrush', 'polearmSweep'] },
      warden_blaidd: { name: 'Silver Lynel of the Spire', file: '/sibling/tartarus/public/cast/lynel.glb', height: 3.85, moves: ['cycloneFury', 'leapingCrush', 'gapCloserThrust'] },
      boss_mirror_noble: { name: 'Rennala of the Frozen Moon', title: 'Arch-Sorceress of the Ice Mirror', file: '/sibling/tartarus/public/cast/rennala.glb', height: 2.35, moves: ['waterfowlDance', 'polearmSweep', 'katanaBlitz', 'gapCloserThrust'] },
      boss_apex_sovereign: { name: 'Darkeater Midir, Frost Sovereign', title: 'Colossal Dragon-Emperor of Chapter III', file: '/sibling/tartarus/public/cast/midir_humanoid.glb', height: 6.85, moves: ['sovereignCataclysm', 'waterfowlDance', 'cycloneFury', 'leapingCrush'] },
    },
  },
  {
    chapter: 4,
    index: 4,
    id: 'chapter_4',
    name: 'Chapter IV: The Abyssal Caldera',
    subtitle: 'Obsidian Magma Artery & Primordial World-Eater',
    diffHp: 2.35,
    diffDmg: 1.88,
    diffSpeed: 1.35,
    bannerColor: '#ff3b30',
    overrides: {
      ravine_guai_1: { name: 'Abyssal Xenomorph Stalker', file: '/sibling/tartarus/public/cast/xeno_entity.glb', height: 1.30, moves: ['predatorPounce', 'katanaBlitz', 'flurryChain'] },
      ravine_guai_2: { name: 'Caldera Hell-Stalker', file: '/sibling/tartarus/public/cast/katakan.glb', height: 1.24, moves: ['predatorPounce', 'slashFast'] },
      spartos_1: { name: 'Mutadon Magma Predator', file: '/sibling/tartarus/public/cast/mutadon.glb', height: 2.45, moves: ['predatorPounce', 'cycloneFury', 'leapingCrush'] },
      tide_exec: { name: 'Doom Slayer Executioner', file: '/sibling/tartarus/public/cast/slayer.glb', height: 2.65, moves: ['cycloneFury', 'waterfowlDance', 'leapingCrush'] },
      elder_lithos: { name: 'Gargantua the World-Breaker', file: '/sibling/tartarus/public/cast/gargantua.glb', height: 5.75, moves: ['sovereignCataclysm', 'cycloneFury', 'leapingCrush'] },
      boss_krampus: { name: 'Diabolus, Hellfire Colossus', title: 'Infernal Overlord of the Obsidian Courtyard', file: '/sibling/tartarus/public/cast/diabolus.glb', height: 5.95, moves: ['sovereignCataclysm', 'cycloneFury', 'waterfowlDance', 'leapingCrush'] },
      warden_blaidd: { name: 'Demogorgon of the Rift', file: '/sibling/tartarus/public/cast/demogorgon.glb', height: 3.75, moves: ['predatorPounce', 'cycloneFury', 'flurryChain'] },
      boss_mirror_noble: { name: 'Malenia, Blade of Miquella', title: 'Goddess of Rot & Unrelenting Waterfowl', file: '/sibling/tartarus/public/cast/malenia.glb', height: 2.20, moves: ['waterfowlDance', 'katanaBlitz', 'katanaFinisher', 'cycloneFury'] },
      boss_apex_sovereign: { name: 'Titanus, Primordial World-Eater', title: 'Mythic 7.25m Colossal Apex God of Reincarnation', file: '/sibling/tartarus/public/cast/titanus.glb', height: 7.25, moves: ['sovereignCataclysm', 'waterfowlDance', 'cycloneFury', 'leapingCrush'] },
    },
  },
  {
    chapter: 5,
    index: 5,
    id: 'chapter_5_egypt',
    name: 'Chapter V: The Sunken Necropolis of Khufu-Ra',
    subtitle: 'Giza Desert Pyramids, Pharaonic Hieroglyph Tomb, Secret Gold Vault & Undying Mummies',
    diffHp: 1.55,
    diffDmg: 1.42,
    diffSpeed: 1.18,
    bannerColor: '#ffd740',
    overrides: {
      ravine_guai_1: {
        name: 'Desiccated Tomb Mummy (Linen-Wrapped Shabti)',
        file: '/sibling/tartarus/public/cast/scp106.glb',
        matScheme: 'linen_mummy',
        weapon: 'twin_stinger',
        height: 1.65,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      ravine_guai_2: {
        name: 'Natron-Embalmed Crypt Mummy',
        file: '/sibling/tartarus/public/cast/nocteserper.glb',
        matScheme: 'linen_mummy',
        weapon: 'emberwing',
        height: 1.68,
        moves: ['katanaBlitz', 'slashFast', 'slashCombo'],
      },
      spartos_1: {
        name: 'Nakht-Hor, Royal Khopesh Mummy Captain',
        file: '/sibling/tartarus/public/cast/perdit.glb',
        matScheme: 'linen_mummy',
        weapon: 'hardedge',
        height: 2.16,
        moves: ['slashFast', 'slashCombo', 'risingCut', 'whirlwindCleave', 'heavyDelayed'],
      },
      scale_guard: {
        name: 'Gilded Ushabti Pylon Sentinel',
        file: '/sibling/tartarus/public/cast/dragon_warrior2.glb',
        matScheme: 'ushabti_colossus',
        weapon: 'buster_sword',
        height: 2.28,
        moves: ['slashFast', 'whirlwindCleave', 'heavyDelayed', 'overheadSlam', 'leapingCrush'],
      },
      tide_exec: {
        name: 'Anubis Jackal-Headed Obsidian Executioner',
        file: '/sibling/tartarus/public/cast/werewolf.glb',
        matScheme: 'anubis_obsidian',
        weapon: 'voidrend',
        height: 2.95,
        moves: ['predatorPounce', 'katanaBlitz', 'slashCombo', 'risingCut', 'flurryChain', 'heavyDelayed'],
      },
      elder_lithos: {
        name: 'Imhotep-Kha, Secret Treasury Mummy-Lord Warden',
        title: 'Bitumen-Crowned Keeper of the Golden Vault',
        file: '/sibling/tartarus/public/cast/ogre.glb',
        matScheme: 'mummy_lord_treasury',
        weapon: 'voidrend',
        height: 5.35,
        moves: ['sovereignCataclysm', 'overheadSlam', 'leapingCrush', 'whirlwindCleave', 'heavyDelayed', 'polearmSweep'],
      },
      courtyard_guai_1: {
        name: 'Bitumen-Soaked Embalmer Mummy',
        file: '/sibling/tartarus/public/cast/scp096.glb',
        matScheme: 'linen_mummy',
        weapon: 'verdant_fang',
        height: 1.74,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      drakaina_halberd: {
        name: 'Meritamun, Horned Temple Halberdier of Isis',
        file: '/sibling/tartarus/public/cast/draconic_f.glb',
        matScheme: 'isis_priestess',
        weapon: 'strike_rod',
        height: 2.18,
        moves: ['polearmSweep', 'polearmComboB', 'risingCut', 'slashCombo', 'heavyDelayed'],
      },
      boss_krampus: {
        name: 'Amenhotep-Ptah, Golden Ushabti Colossus',
        title: 'Towering 4.65m Gilded Monolith of the Hypostyle Hall',
        file: '/sibling/tartarus/public/cast/golem.glb',
        matScheme: 'ushabti_colossus',
        weapon: 'fullmetal_rod',
        height: 4.65,
        moves: ['sovereignCataclysm', 'polearmSweep', 'polearmComboB', 'leapingCrush', 'overheadSlam', 'flurryChain'],
      },
      bridge_duelist: {
        name: 'Senusret, Bandaged Royal Blade-Mummy',
        file: '/sibling/tartarus/public/cast/katakan.glb',
        matScheme: 'linen_mummy',
        weapon: 'masamune',
        height: 1.98,
        moves: ['katanaBlitz', 'katanaFinisher', 'slashCombo', 'risingCut', 'flurryChain', 'slashFast'],
      },
      perch_caster: {
        name: 'Neferu, Cursed High Priestess of Isis',
        file: '/sibling/tartarus/public/cast/sellen.glb',
        matScheme: 'isis_priestess',
        weapon: 'magical_rod',
        height: 1.94,
        moves: ['slashFast', 'polearmSweep', 'polearmComboB'],
      },
      warden_blaidd: {
        name: 'Anubis-Wepwawet, Obsidian Jackal Warden of the Scales',
        file: '/sibling/tartarus/public/cast/blaidd.glb',
        matScheme: 'anubis_obsidian',
        weapon: 'buster_sword',
        height: 3.65,
        moves: ['leapingCrush', 'whirlwindCleave', 'heavyDelayed', 'risingCut', 'overheadSlam', 'flurryChain'],
      },
      boss_mirror_noble: {
        name: 'High Priestess Nefertari of Isis',
        title: 'Cursed Oracle of the Subterranean Nile (Phase I)',
        phase2Name: 'Nefertari-Sekhmet, Winged Goddess of the Crimson Nile',
        phase2Title: 'Awakened Solar Valkyrie of Isis & Hathor (Phase II)',
        file: '/sibling/tartarus/public/cast/millicent.glb',
        phase2File: '/sibling/tartarus/public/cast/malenia.glb',
        matScheme: 'isis_priestess',
        phase2MatScheme: 'sekhmet_blood_gold',
        weapon: 'masamune',
        phase2Weapon: 'emberwing',
        height: 2.18,
        phase2Height: 2.48,
        moves: ['waterfowlDance', 'katanaBlitz', 'slashCombo', 'risingCut', 'heavyDelayed', 'flurryChain'],
      },
      sanctum_guai_1: {
        name: 'Royal Canopic Mummy-Bearer',
        file: '/sibling/tartarus/public/cast/scp106.glb',
        matScheme: 'linen_mummy',
        weapon: 'twin_stinger',
        height: 1.65,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      sanctum_lion: {
        name: 'Maahes, Solar Lion-Sphinx Berserker Chief',
        file: '/sibling/tartarus/public/cast/lion.glb',
        matScheme: 'sekhmet_blood_gold',
        weapon: 'hardedge',
        height: 3.80,
        moves: ['leapingCrush', 'whirlwindCleave', 'overheadSlam', 'heavyDelayed', 'flurryChain'],
      },
      sanctum_reaper: {
        name: 'Khenti-Amentiu, High Mummy-Lord of the Antechamber',
        file: '/sibling/tartarus/public/cast/harvester.glb',
        matScheme: 'mummy_lord_treasury',
        weapon: 'voidrend',
        height: 3.05,
        moves: ['katanaBlitz', 'slashCombo', 'risingCut', 'polearmSweep', 'heavyDelayed'],
      },
      boss_apex_sovereign: {
        name: 'Pharaoh Khaemwaset, Undying Sovereign of the Golden Pyramid',
        title: 'Lord of the Two Lands & Keeper of the Book of Thoth (Phase I)',
        phase2Name: 'God-Pharaoh Khaemwaset, Ascended Avatar of Amun-Ra',
        phase2Title: 'Colossal 7.15m Solar-Obsidian Sovereign of Eternity (Phase II)',
        file: '/sibling/tartarus/public/cast/dancer.glb',
        phase2File: '/sibling/tartarus/public/cast/maliketh.glb',
        matScheme: 'pharaoh_khaemwaset_p1',
        phase2MatScheme: 'pharaoh_khaemwaset_p2',
        weapon: 'hardedge',
        phase2Weapon: 'voidrend',
        height: 6.25,
        phase2Height: 7.15,
        moves: ['sovereignCataclysm', 'waterfowlDance', 'leapingCrush', 'whirlwindCleave', 'overheadSlam', 'polearmSweep', 'flurryChain', 'heavyDelayed'],
      },
    },
  },
  {
    chapter: 6,
    index: 6,
    id: 'chapter_6_babylon',
    name: 'Chapter VI: The Hanging Gardens & Lapis Ziggurat of Babylon',
    subtitle: 'Glazed Ishtar Gateways, Stepped Ziggurat of Etemenanki, Lamassu Colossi & God-King Gilgamesh',
    diffHp: 1.75,
    diffDmg: 1.54,
    diffSpeed: 1.22,
    bannerColor: '#38f2b8',
    overrides: {
      ravine_guai_1: {
        name: 'Akkadian Bronze-Scale Skirmisher',
        file: '/sibling/tartarus/public/cast/reptilian.glb',
        matScheme: 'babylon_lapis_gold',
        weapon: 'twin_stinger',
        height: 1.68,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      ravine_guai_2: {
        name: 'Ishtar Glazed-Ward Assassin',
        file: '/sibling/tartarus/public/cast/katakan.glb',
        matScheme: 'babylon_lapis_gold',
        weapon: 'masamune',
        height: 1.74,
        moves: ['katanaBlitz', 'slashFast', 'slashCombo'],
      },
      spartos_1: {
        name: 'Ashurbanipal, Royal Immortal of the Ishtar Gate',
        file: '/sibling/tartarus/public/cast/dragon_warrior.glb',
        matScheme: 'babylon_lapis_gold',
        weapon: 'hardedge',
        height: 2.22,
        moves: ['slashFast', 'slashCombo', 'risingCut', 'whirlwindCleave', 'heavyDelayed'],
      },
      scale_guard: {
        name: 'Gilded Marduk Temple Vanguard',
        file: '/sibling/tartarus/public/cast/dragon_warrior2.glb',
        matScheme: 'ushabti_colossus',
        weapon: 'buster_sword',
        height: 2.34,
        moves: ['slashFast', 'whirlwindCleave', 'heavyDelayed', 'overheadSlam', 'leapingCrush'],
      },
      tide_exec: {
        name: 'Winged Bull Lamassu Sentinel',
        file: '/sibling/tartarus/public/cast/lion.glb',
        matScheme: 'babylon_lapis_gold',
        weapon: 'voidrend',
        height: 3.15,
        moves: ['leapingCrush', 'whirlwindCleave', 'slashCombo', 'risingCut', 'flurryChain', 'heavyDelayed'],
      },
      elder_lithos: {
        name: 'Enkidu, Wild-Born Titan of the Cedar Forest',
        title: 'Sworn Brother of Gilgamesh & Guardian of the Chaldean Star-Vault',
        file: '/sibling/tartarus/public/cast/ogre.glb',
        matScheme: 'babylon_lapis_gold',
        weapon: 'buster_sword',
        height: 5.45,
        moves: ['sovereignCataclysm', 'overheadSlam', 'leapingCrush', 'whirlwindCleave', 'heavyDelayed', 'polearmSweep'],
      },
      boss_krampus: {
        name: 'Humbaba, Terracotta & Lapis Guardian of Etemenanki',
        title: 'Colossal 4.85m Seven-Radiance Cedar Colossus',
        file: '/sibling/tartarus/public/cast/golem.glb',
        matScheme: 'babylon_lapis_gold',
        weapon: 'fullmetal_rod',
        height: 4.85,
        moves: ['sovereignCataclysm', 'polearmSweep', 'polearmComboB', 'leapingCrush', 'overheadSlam', 'flurryChain'],
      },
      boss_mirror_noble: {
        name: 'High Priestess Inanna-Ishtar of the Hanging Gardens',
        title: 'Queen of Heaven & Keeper of the Euphrates Cascades (Phase I)',
        phase2Name: 'Ishtar-Ereshkigal, Ascended Star of Babylon',
        phase2Title: 'Goddess of Lapis Fire & Sacred War (Phase II)',
        file: '/sibling/tartarus/public/cast/millicent.glb',
        phase2File: '/sibling/tartarus/public/cast/malenia.glb',
        matScheme: 'isis_priestess',
        phase2MatScheme: 'babylon_lapis_gold',
        weapon: 'masamune',
        phase2Weapon: 'emberwing',
        height: 2.22,
        phase2Height: 2.52,
        moves: ['waterfowlDance', 'katanaBlitz', 'slashCombo', 'risingCut', 'heavyDelayed', 'flurryChain'],
      },
      boss_apex_sovereign: {
        name: 'Gilgamesh, Undying God-King of Uruk & Babylon',
        title: 'Two-Thirds Divine Sovereign of the Lapis Ziggurat (Phase I)',
        phase2Name: 'God-Emperor Gilgamesh, Wielder of the Tablets of Destiny',
        phase2Title: 'Colossal 7.20m Solar-Lapis Sovereign of Mesopotamia (Phase II)',
        file: '/sibling/tartarus/public/cast/dancer.glb',
        phase2File: '/sibling/tartarus/public/cast/maliketh.glb',
        matScheme: 'babylon_lapis_gold',
        phase2MatScheme: 'pharaoh_khaemwaset_p1',
        weapon: 'hardedge',
        phase2Weapon: 'voidrend',
        height: 6.35,
        phase2Height: 7.20,
        moves: ['sovereignCataclysm', 'waterfowlDance', 'leapingCrush', 'whirlwindCleave', 'overheadSlam', 'polearmSweep', 'flurryChain', 'heavyDelayed'],
      },
    },
  },
  {
    chapter: 7,
    index: 7,
    id: 'chapter_7_valhalla',
    name: 'Chapter VII: The Norse Valhalla Fjords & Yggdrasil Great Hall',
    subtitle: 'Aurora Fjords, Viking Dragon Longships, Elder Futhark Runestones & Odin Allfather',
    diffHp: 1.95,
    diffDmg: 1.68,
    diffSpeed: 1.28,
    bannerColor: '#58f2ff',
    overrides: {
      ravine_guai_1: {
        name: 'Frost-Bitten Draugr Revenant',
        file: '/sibling/tartarus/public/cast/scp106.glb',
        matScheme: 'valhalla_bifrost_rune',
        weapon: 'twin_stinger',
        height: 1.72,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      ravine_guai_2: {
        name: 'Fjord Ulfhednar Blood-Stalker',
        file: '/sibling/tartarus/public/cast/katakan.glb',
        matScheme: 'valhalla_bifrost_rune',
        weapon: 'masamune',
        height: 1.78,
        moves: ['predatorPounce', 'katanaBlitz', 'slashCombo'],
      },
      spartos_1: {
        name: 'Einherjar Huscarl of Gladsheim',
        file: '/sibling/tartarus/public/cast/dragon_warrior.glb',
        matScheme: 'valhalla_bifrost_rune',
        weapon: 'buster_sword',
        height: 2.28,
        moves: ['slashFast', 'slashCombo', 'risingCut', 'whirlwindCleave', 'heavyDelayed'],
      },
      tide_exec: {
        name: 'Fenrir-Spawn Vargr Berserker Chief',
        file: '/sibling/tartarus/public/cast/werewolf.glb',
        matScheme: 'valhalla_bifrost_rune',
        weapon: 'voidrend',
        height: 3.12,
        moves: ['predatorPounce', 'katanaBlitz', 'slashCombo', 'risingCut', 'flurryChain', 'heavyDelayed'],
      },
      elder_lithos: {
        name: 'Ymir-Surtr, Nidavellir Runeforge Jotunn King',
        title: 'Colossal Keeper of the Secret Dwarven Runeforge Vault',
        file: '/sibling/tartarus/public/cast/gargantua.glb',
        matScheme: 'valhalla_bifrost_rune',
        weapon: 'buster_sword',
        height: 5.65,
        moves: ['sovereignCataclysm', 'overheadSlam', 'leapingCrush', 'whirlwindCleave', 'heavyDelayed', 'polearmSweep'],
      },
      boss_krampus: {
        name: 'Hrungnir, Runestone Jotunn Colossus of the Bifrost',
        title: 'Towering 5.10m Granite & Cyan-Rune Guardian of Valhalla',
        file: '/sibling/tartarus/public/cast/golem.glb',
        matScheme: 'valhalla_bifrost_rune',
        weapon: 'fullmetal_rod',
        height: 5.10,
        moves: ['sovereignCataclysm', 'polearmSweep', 'polearmComboB', 'leapingCrush', 'overheadSlam', 'flurryChain'],
      },
      warden_blaidd: {
        name: 'Sköll & Hati, Fenrir Dire-Wolf Warden of Yggdrasil',
        file: '/sibling/tartarus/public/cast/blaidd.glb',
        matScheme: 'valhalla_bifrost_rune',
        weapon: 'buster_sword',
        height: 3.78,
        moves: ['leapingCrush', 'whirlwindCleave', 'heavyDelayed', 'risingCut', 'overheadSlam', 'flurryChain'],
      },
      boss_mirror_noble: {
        name: 'Brynhildr, Shieldmaiden Valkyrie of Valhalla',
        title: 'Chooser of the Slain & Choirmaster of Gladsheim (Phase I)',
        phase2Name: 'Freya-Brynhildr, Ascended Winged Queen of the Valkyries',
        phase2Title: 'Bifrost Aurora Blade of Asgard (Phase II)',
        file: '/sibling/tartarus/public/cast/millicent.glb',
        phase2File: '/sibling/tartarus/public/cast/malenia.glb',
        matScheme: 'valhalla_bifrost_rune',
        phase2MatScheme: 'pharaoh_khaemwaset_p1',
        weapon: 'masamune',
        phase2Weapon: 'voidrend',
        height: 2.25,
        phase2Height: 2.55,
        moves: ['waterfowlDance', 'katanaBlitz', 'slashCombo', 'risingCut', 'heavyDelayed', 'flurryChain'],
      },
      boss_apex_sovereign: {
        name: 'Odin Allfather, High Sovereign of Valhalla & Yggdrasil',
        title: 'One-Eyed Lord of the Einherjar & Wielder of Gungnir (Phase I)',
        phase2Name: 'Allfather Odin, Ragnarok Avatar of the World-Tree',
        phase2Title: 'Colossal 7.25m Bifrost & Rune-Storm God of Asgard (Phase II)',
        file: '/sibling/tartarus/public/cast/dancer.glb',
        phase2File: '/sibling/tartarus/public/cast/midir_humanoid.glb',
        matScheme: 'valhalla_bifrost_rune',
        phase2MatScheme: 'anubis_obsidian',
        weapon: 'fullmetal_rod',
        phase2Weapon: 'voidrend',
        height: 6.45,
        phase2Height: 7.25,
        moves: ['sovereignCataclysm', 'waterfowlDance', 'leapingCrush', 'whirlwindCleave', 'overheadSlam', 'polearmSweep', 'flurryChain', 'heavyDelayed'],
      },
    },
  },
  {
    chapter: 8,
    index: 8,
    id: 'chapter_8_atlantis',
    name: 'Chapter VIII: The Sunken Atlantis Orichalcum Acropolis',
    subtitle: 'Paros Marble Tholos Temples, Bioluminescent Coral Spires, Orichalcum Astrolabes & Poseidon',
    diffHp: 2.20,
    diffDmg: 1.82,
    diffSpeed: 1.32,
    bannerColor: '#ff78c8',
    overrides: {
      ravine_guai_1: {
        name: 'Abyssal Trench Siren-Skirmisher',
        file: '/sibling/tartarus/public/cast/reptilian.glb',
        matScheme: 'atlantis_orichalcum',
        weapon: 'twin_stinger',
        height: 1.68,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      ravine_guai_2: {
        name: 'Bioluminescent Reef Stalker',
        file: '/sibling/tartarus/public/cast/xeno_entity.glb',
        matScheme: 'atlantis_orichalcum',
        weapon: 'masamune',
        height: 1.72,
        moves: ['predatorPounce', 'katanaBlitz', 'slashCombo'],
      },
      spartos_1: {
        name: 'Critias, Royal Orichalcum Hoplite of the Outer Ring',
        file: '/sibling/tartarus/public/cast/dragon_warrior2.glb',
        matScheme: 'atlantis_orichalcum',
        weapon: 'hardedge',
        height: 2.28,
        moves: ['slashFast', 'slashCombo', 'risingCut', 'whirlwindCleave', 'heavyDelayed'],
      },
      tide_exec: {
        name: 'Charybdis Trench Leviathan Executioner',
        file: '/sibling/tartarus/public/cast/mutadon.glb',
        matScheme: 'atlantis_orichalcum',
        weapon: 'voidrend',
        height: 3.10,
        moves: ['predatorPounce', 'cycloneFury', 'slashCombo', 'risingCut', 'flurryChain', 'heavyDelayed'],
      },
      elder_lithos: {
        name: 'Atlas the First King, Bearer of the Orichalcum Astrolabe',
        title: 'Colossal Guardian of the Secret Pearl & Orichalcum Vault',
        file: '/sibling/tartarus/public/cast/gargantua.glb',
        matScheme: 'atlantis_orichalcum',
        weapon: 'buster_sword',
        height: 5.75,
        moves: ['sovereignCataclysm', 'overheadSlam', 'leapingCrush', 'whirlwindCleave', 'heavyDelayed', 'polearmSweep'],
      },
      boss_krampus: {
        name: 'Talos-Orichalcum, Bronze Automaton Colossus of Atlantis',
        title: 'Towering 5.25m Living Orichalcum Citadel Sentinel',
        file: '/sibling/tartarus/public/cast/golem.glb',
        matScheme: 'atlantis_orichalcum',
        weapon: 'fullmetal_rod',
        height: 5.25,
        moves: ['sovereignCataclysm', 'polearmSweep', 'polearmComboB', 'leapingCrush', 'overheadSlam', 'flurryChain'],
      },
      boss_mirror_noble: {
        name: 'Amphitrite, High Oracle of the Bioluminescent Tide',
        title: 'Queen of the Sunken Paros Colonnade (Phase I)',
        phase2Name: 'Scylla-Amphitrite, Abyssal Empress of the Coral Maelstrom',
        phase2Title: 'Awakened Blade of the Deep Trench (Phase II)',
        file: '/sibling/tartarus/public/cast/millicent.glb',
        phase2File: '/sibling/tartarus/public/cast/malenia.glb',
        matScheme: 'atlantis_orichalcum',
        phase2MatScheme: 'sekhmet_blood_gold',
        weapon: 'masamune',
        phase2Weapon: 'emberwing',
        height: 2.24,
        phase2Height: 2.56,
        moves: ['waterfowlDance', 'katanaBlitz', 'slashCombo', 'risingCut', 'heavyDelayed', 'flurryChain'],
      },
      boss_apex_sovereign: {
        name: 'Poseidon-Aegeus, Undying Sea-Emperor of Sunken Atlantis',
        title: 'Earth-Shaker & Sovereign of the Ten Orichalcum Kings (Phase I)',
        phase2Name: 'Primordial Poseidon, Abyssal Kraken-God of the Deep',
        phase2Title: 'Colossal 7.35m Orichalcum & Bioluminescent Apex God (Phase II)',
        file: '/sibling/tartarus/public/cast/dancer.glb',
        phase2File: '/sibling/tartarus/public/cast/titanus.glb',
        matScheme: 'atlantis_orichalcum',
        phase2MatScheme: 'pharaoh_khaemwaset_p2',
        weapon: 'fullmetal_rod',
        phase2Weapon: 'voidrend',
        height: 6.55,
        phase2Height: 7.35,
        moves: ['sovereignCataclysm', 'waterfowlDance', 'leapingCrush', 'whirlwindCleave', 'overheadSlam', 'polearmSweep', 'flurryChain', 'heavyDelayed'],
      },
    },
  },
  {
    chapter: 9,
    index: 9,
    id: 'chapter_9_athenaion',
    name: 'Chapter IX: The Sacred Island of Athenaion',
    subtitle: 'Aegean Acropolis, Twin Colossi of Promachos & Parthenon Naos',
    diffHp: 2.35,
    diffDmg: 1.92,
    diffSpeed: 1.35,
    bannerColor: '#ffd86b',
    skyPreset: 'day',
    zoneOverrides: {
      1: { name: 'Western Lagoon Arcade & Water Temple Quay', subtitle: 'Vaulted Limestone Pier, Nymphaeum & Aegean Harbour', fogColor: 0x8cb4d2, fogDensity: 0.00042 },
      2: { name: 'Grand Processional Staircase & Twin Colossi', subtitle: 'Terraces IV–I, Propylon & 40m Statues of Athena Promachos', fogColor: 0x8cb4d2, fogDensity: 0.00042 },
      3: { name: 'The Sacred Island Tholos & Ruins Terrace', subtitle: 'Arched Lagoon Bridge, Corinthian Tholos & Fallen Colossus Head', fogColor: 0x8cb4d2, fogDensity: 0.00042 },
      4: { name: 'The Acropolis Summit & 12m Athenaion Podium', subtitle: 'Peristyle Stoas, Sacred Olive Grove & Pentelic Marble Terrace', fogColor: 0x8cb4d2, fogDensity: 0.00042 },
      5: { name: 'The Parthenon Naos — Sanctuary of Athena Parthenos', subtitle: 'Chryselephantine Inner Cella & Sacred Hearth of the Goddess', fogColor: 0x8cb4d2, fogDensity: 0.00042 },
    },
    overrides: {
      ravine_guai_1: {
        name: 'Delian League Hoplite Phalangite',
        file: '/sibling/tartarus/public/cast/dragon_warrior2.glb',
        matScheme: 'athenaion_pentelic_gold',
        weapon: 'hardedge',
        height: 2.15,
        worldXZ: [25.5, 62.0],
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      ravine_guai_2: {
        name: 'Myrmidon Bronze Vanguard of the Propylon',
        file: '/sibling/tartarus/public/cast/xeno_entity.glb',
        matScheme: 'athenaion_pentelic_gold',
        weapon: 'masamune',
        height: 2.18,
        worldXZ: [30.5, 60.0],
        moves: ['predatorPounce', 'katanaBlitz', 'slashCombo'],
      },
      spartos_1: {
        name: 'Polemarch Leonidas, Crested Champion of the Grand Staircase',
        file: '/sibling/tartarus/public/cast/dragon_warrior2.glb',
        matScheme: 'athenaion_pentelic_gold',
        weapon: 'hardedge',
        height: 2.32,
        worldXZ: [28.0, 52.0],
        moves: ['slashFast', 'slashCombo', 'risingCut', 'whirlwindCleave', 'heavyDelayed'],
      },
      scale_guard: {
        name: 'Areopagus Marble Shield-Captain',
        file: '/sibling/tartarus/public/cast/dragon_warrior2.glb',
        matScheme: 'athenaion_pentelic_gold',
        weapon: 'buster_sword',
        height: 2.24,
        worldXZ: [25.0, 26.0],
        moves: ['slashFast', 'whirlwindCleave', 'heavyDelayed', 'overheadSlam', 'leapingCrush'],
      },
      tide_exec: {
        name: 'Asterion, Cretan Minotaur of the Acropolis Bastion',
        file: '/sibling/tartarus/public/cast/mutadon.glb',
        matScheme: 'ushabti_gold_colossus',
        weapon: 'voidrend',
        height: 3.15,
        worldXZ: [30.5, 22.0],
        moves: ['predatorPounce', 'cycloneFury', 'slashCombo', 'risingCut', 'flurryChain', 'heavyDelayed'],
      },
      courtyard_guai_1: {
        worldXZ: [25.5, 8.0],
      },
      courtyard_guai_2: {
        worldXZ: [30.5, 6.0],
      },
      courtyard_spear: {
        worldXZ: [28.0, 3.0],
      },
      bridge_warden_1: {
        worldXZ: [-2.0, 114.0],
      },
      bridge_warden_2: {
        worldXZ: [-6.0, 122.0],
      },
      elder_lithos: {
        name: 'Medusa-Euryale, Gorgon Warden of the Fallen Colossus Head',
        title: 'Serpent-Crowned Guardian of the ΠΑΝΤΑ ΡΕΙ Ruins Terrace',
        file: '/sibling/tartarus/public/cast/malenia.glb',
        matScheme: 'athenaion_pentelic_gold',
        weapon: 'emberwing',
        height: 2.85,
        worldXZ: [144.5, 142.5],
        moves: ['sovereignCataclysm', 'waterfowlDance', 'slashCombo', 'whirlwindCleave', 'heavyDelayed', 'polearmSweep'],
      },
      boss_krampus: {
        name: 'Talos-Hephaestus, Living Bronze Colossus of the Twin Promachoi',
        title: 'Towering 3.6m Bronze & Pentelic Forecourt Sentinel',
        file: '/sibling/tartarus/public/cast/golem.glb',
        matScheme: 'athenaion_pentelic_gold',
        weapon: 'fullmetal_rod',
        height: 3.60,
        worldXZ: [28.0, -3.5],
        moves: ['sovereignCataclysm', 'polearmSweep', 'polearmComboB', 'leapingCrush', 'overheadSlam', 'flurryChain'],
      },
      boss_mirror_noble: {
        name: 'Nike Apteros, Wingless Herald of the Acropolis',
        title: 'Chryselephantine Blade of the Summit Stoa (Phase I)',
        phase2Name: 'Nemesis-Nike, Avenging Goddess of the Golden Aegis',
        phase2Title: 'Awakened Arbiter of Olympic Wrath (Phase II)',
        file: '/sibling/tartarus/public/cast/millicent.glb',
        phase2File: '/sibling/tartarus/public/cast/malenia.glb',
        matScheme: 'athenaion_pentelic_gold',
        phase2MatScheme: 'ushabti_gold_colossus',
        weapon: 'masamune',
        phase2Weapon: 'emberwing',
        height: 2.26,
        phase2Height: 2.58,
        worldXZ: [20.0, -18.5],
        moves: ['waterfowlDance', 'katanaBlitz', 'slashCombo', 'risingCut', 'heavyDelayed', 'flurryChain'],
      },
      sanctum_guai_1: {
        worldXZ: [-8.0, 126.0],
      },
      sanctum_lion: {
        worldXZ: [17.5, -39.0],
      },
      sanctum_reaper: {
        worldXZ: [22.5, -42.0],
      },
      boss_apex_sovereign: {
        name: 'Athena Parthenos, Aegis-Crowned Goddess of the Naos',
        title: 'Chryselephantine Sovereign of Wisdom & War (Phase I)',
        phase2Name: 'Pallas Athena Promachos, Spear of the Olympic Sky',
        phase2Title: 'Colossal Gold & Pentelic Ivory Apex Deity (Phase II)',
        file: '/sibling/tartarus/public/cast/dancer.glb',
        phase2File: '/sibling/tartarus/public/cast/malenia.glb',
        matScheme: 'athenaion_pentelic_gold',
        phase2MatScheme: 'pharaoh_khaemwaset_p2',
        weapon: 'fullmetal_rod',
        phase2Weapon: 'voidrend',
        height: 3.15,
        phase2Height: 3.65,
        worldXZ: [20.0, -54.0],
        moves: ['sovereignCataclysm', 'waterfowlDance', 'leapingCrush', 'whirlwindCleave', 'overheadSlam', 'polearmSweep', 'flurryChain', 'heavyDelayed'],
      },
    },
  },
];

export const EGYPTIAN_MATERIAL_SCHEMES = {
  athenaion_pentelic_gold: {
    primaryColor: 0xf2ede2,
    secondaryColor: 0xd4a843,
    accentColor: 0x1e6b9e,
    eyeEmissive: 0xffe078,
    bodyEmissive: 0x2c2008,
    emissiveIntensity: 0.42,
    roughness: 0.22,
    metalness: 0.86,
    trailColor: 0xffd86b,
  },
  babylon_lapis_gold: {
    primaryColor: 0x0e4d8a,
    secondaryColor: 0xffc83b,
    accentColor: 0x24d896,
    eyeEmissive: 0x38f2b8,
    bodyEmissive: 0x062844,
    emissiveIntensity: 0.46,
    roughness: 0.22,
    metalness: 0.88,
    trailColor: 0x38f2b8,
  },
  valhalla_bifrost_rune: {
    primaryColor: 0x1e2836,
    secondaryColor: 0x38f2ff,
    accentColor: 0xffd258,
    eyeEmissive: 0x58f8ff,
    bodyEmissive: 0x083448,
    emissiveIntensity: 0.54,
    roughness: 0.26,
    metalness: 0.84,
    trailColor: 0x58f2ff,
  },
  atlantis_orichalcum: {
    primaryColor: 0xff8c38,
    secondaryColor: 0xf0ece1,
    accentColor: 0xff48a8,
    eyeEmissive: 0x38f2ff,
    bodyEmissive: 0x481a08,
    emissiveIntensity: 0.52,
    roughness: 0.18,
    metalness: 0.92,
    trailColor: 0xff78c8,
  },
  linen_mummy: {
    primaryColor: 0xd8c79e,
    secondaryColor: 0x2b1e16,
    accentColor: 0x8c6d3b,
    eyeEmissive: 0xff9a22,
    bodyEmissive: 0x241608,
    emissiveIntensity: 0.22,
    roughness: 0.90,
    metalness: 0.06,
    trailColor: 0xd4b872,
  },
  anubis_obsidian: {
    primaryColor: 0x12141a,
    secondaryColor: 0xffbf36,
    accentColor: 0x1367a0,
    eyeEmissive: 0x00f0ff,
    bodyEmissive: 0x382200,
    emissiveIntensity: 0.35,
    roughness: 0.24,
    metalness: 0.82,
    armorRoughness: 0.18,
    armorMetalness: 0.94,
    trailColor: 0xffc83b,
  },
  isis_priestess: {
    primaryColor: 0xf2ead8,
    secondaryColor: 0x1367a0,
    accentColor: 0xffc840,
    skinColor: 0xc68b59,
    eyeEmissive: 0x38f8ff,
    bodyEmissive: 0x103836,
    emissiveIntensity: 0.38,
    roughness: 0.62,
    metalness: 0.22,
    armorRoughness: 0.20,
    armorMetalness: 0.90,
    trailColor: 0x38f2ff,
  },
  ushabti_colossus: {
    primaryColor: 0xe6b84c,
    secondaryColor: 0x1367a0,
    accentColor: 0xd49b35,
    eyeEmissive: 0x28f0e0,
    bodyEmissive: 0x422a04,
    emissiveIntensity: 0.42,
    roughness: 0.25,
    metalness: 0.88,
    trailColor: 0xffd700,
  },
  sekhmet_blood_gold: {
    primaryColor: 0xe89b28,
    secondaryColor: 0xb81d14,
    accentColor: 0xffd740,
    eyeEmissive: 0xff3b14,
    bodyEmissive: 0x521004,
    emissiveIntensity: 0.48,
    roughness: 0.28,
    metalness: 0.84,
    trailColor: 0xff4518,
  },
  mummy_lord_treasury: {
    primaryColor: 0x1e2b22,
    secondaryColor: 0xd4a024,
    accentColor: 0x28c868,
    eyeEmissive: 0x55ff88,
    bodyEmissive: 0x0d3318,
    emissiveIntensity: 0.52,
    roughness: 0.42,
    metalness: 0.68,
    trailColor: 0x55ff88,
  },
  pharaoh_khaemwaset_p1: {
    primaryColor: 0xffd448,
    secondaryColor: 0x1367a0,
    accentColor: 0xe8dfd0,
    eyeEmissive: 0xffa822,
    bodyEmissive: 0x5c3400,
    emissiveIntensity: 0.55,
    roughness: 0.16,
    metalness: 0.94,
    trailColor: 0xffd700,
  },
  pharaoh_khaemwaset_p2: {
    primaryColor: 0x160d0a,
    secondaryColor: 0xff5a14,
    accentColor: 0xffd700,
    eyeEmissive: 0xffe066,
    bodyEmissive: 0x8f2400,
    emissiveIntensity: 0.92,
    roughness: 0.18,
    metalness: 0.92,
    trailColor: 0xff3814,
  },
};

export function applyEgyptianMaterialScheme(root, schemeId) {
  const scheme = EGYPTIAN_MATERIAL_SCHEMES[schemeId];
  if (!root || !scheme) return;

  const cPrimary = new THREE.Color(scheme.primaryColor);
  const cSecondary = new THREE.Color(scheme.secondaryColor);
  const cAccent = new THREE.Color(scheme.accentColor || scheme.secondaryColor);
  const cSkin = scheme.skinColor ? new THREE.Color(scheme.skinColor) : null;
  const cEyeEmissive = new THREE.Color(scheme.eyeEmissive || 0xffaa22);
  const cBodyEmissive = new THREE.Color(scheme.bodyEmissive || 0x000000);

  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const meshName = (o.name || '').toLowerCase();
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
      if (!m) return m;
      const mc = m.clone();
      const matName = (mc.name || '').toLowerCase();
      const tag = `${meshName} ${matName}`;

      const isEye = /eye|cornea|pupil|iris/i.test(tag) && !/brow|lash|occlusion/i.test(tag);
      const isArmorOrGold = /armor|armour|iron|metal|gold|mask|crown|helm|belt|buckle|strap|strip|acc|outfit|sword|maze/i.test(tag);
      const isClothOrRobe = /cloth|coth|fabric|robe|dress|sweater|coat|cape|hood|textil|cover|jacket|skirt|linen/i.test(tag);
      const isSkinOrFur = /body|skin|fur|crinos|vamp|head|arms|legs|torso|pelvis|hand/i.test(tag);

      if (isEye && mc.color) {
        mc.color.copy(cEyeEmissive);
        mc.emissive = cEyeEmissive.clone();
        mc.emissiveIntensity = 2.4;
        mc.roughness = 0.12;
        mc.metalness = 0.1;
      } else if (schemeId === 'linen_mummy' && mc.color) {
        const useBitumen = /skin|head|hand|arm/i.test(tag) && !/jacket|cloth|106_mat/i.test(tag);
        mc.color.lerp(useBitumen ? cSecondary : cPrimary, 0.82);
        mc.emissive = cBodyEmissive.clone();
        mc.emissiveIntensity = scheme.emissiveIntensity;
        mc.roughness = useBitumen ? 0.78 : scheme.roughness;
        mc.metalness = scheme.metalness;
      } else if (schemeId === 'anubis_obsidian' && mc.color) {
        if (isArmorOrGold || isClothOrRobe) {
          mc.color.lerp(/belt|strap|cape|fabric/i.test(tag) ? cAccent : cSecondary, 0.85);
          mc.roughness = scheme.armorRoughness ?? 0.18;
          mc.metalness = scheme.armorMetalness ?? 0.94;
          mc.emissive = cBodyEmissive.clone();
          mc.emissiveIntensity = 0.42;
        } else {
          mc.color.lerp(cPrimary, 0.88);
          mc.roughness = scheme.roughness;
          mc.metalness = scheme.metalness;
          mc.emissive = new THREE.Color(0x050811);
          mc.emissiveIntensity = 0.20;
        }
      } else if (schemeId === 'isis_priestess' && mc.color) {
        if (isArmorOrGold) {
          mc.color.lerp(cAccent, 0.86);
          mc.roughness = scheme.armorRoughness ?? 0.20;
          mc.metalness = scheme.armorMetalness ?? 0.90;
          mc.emissive = cBodyEmissive.clone();
          mc.emissiveIntensity = 0.35;
        } else if (isClothOrRobe) {
          mc.color.lerp(/strip|trim|crystal|submesh/i.test(tag) ? cSecondary : cPrimary, 0.80);
          mc.roughness = 0.64;
          mc.metalness = 0.18;
          mc.emissive = cBodyEmissive.clone();
          mc.emissiveIntensity = 0.28;
        } else if (isSkinOrFur && cSkin) {
          mc.color.lerp(cSkin, 0.55);
          mc.roughness = 0.52;
          mc.metalness = 0.08;
        }
      } else if (mc.color) {
        if (isArmorOrGold) {
          mc.color.lerp(cPrimary, 0.86);
          mc.roughness = scheme.roughness;
          mc.metalness = scheme.metalness;
        } else if (isClothOrRobe) {
          mc.color.lerp(cSecondary, 0.82);
          mc.roughness = Math.min(0.58, scheme.roughness + 0.18);
          mc.metalness = Math.max(0.35, scheme.metalness - 0.25);
        } else {
          mc.color.lerp(cAccent, 0.78);
          mc.roughness = scheme.roughness;
          mc.metalness = scheme.metalness;
        }
        mc.emissive = cBodyEmissive.clone();
        mc.emissiveIntensity = scheme.emissiveIntensity;
      }

      mc.needsUpdate = true;
      return mc;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });
}

// Master Encounter Blueprint along The Serpent's Spine (5-Tier Enemy Scale Spectrum: 1.15m Lesser Guai Swarms -> 7.25m Colossal Titans)
export const ENCOUNTER_BLUEPRINTS = [
  {
    id: 'enc_z1_vanguard',
    zone: 1,
    name: 'Drowned Ravine Pinch',
    entryT: 0.055,
    gateT: 0.105,
    isBoss: false,
    enemies: [
      {
        id: 'ravine_guai_1',
        name: 'Mire-Claw Lesser Guai',
        scaleTier: 'swarm',
        file: '/sibling/tartarus/public/cast/reptilian.glb',
        weapon: 'twin_stinger',
        t: 0.074,
        lat: -1.45,
        height: 1.18,
        hp: 2600,
        maxPoise: 620,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      {
        id: 'ravine_guai_2',
        name: 'Tidal Skulker Guai',
        scaleTier: 'swarm',
        file: '/sibling/tartarus/public/cast/katakan.glb',
        weapon: 'masamune',
        t: 0.077,
        lat: 1.45,
        height: 1.22,
        hp: 2750,
        maxPoise: 640,
        moves: ['katanaBlitz', 'slashFast', 'slashCombo'],
      },
      {
        id: 'spartos_1',
        name: 'Spartos, Drowned Vanguard Captain',
        scaleTier: 'vanguard',
        file: '/sibling/tartarus/public/cast/dragon_warrior.glb',
        weapon: 'hardedge',
        t: 0.085,
        lat: 0.0,
        height: 2.08,
        hp: 5400,
        maxPoise: 1250,
        moves: ['slashFast', 'slashCombo', 'risingCut', 'whirlwindCleave', 'heavyDelayed'],
      },
    ],
  },
  {
    id: 'enc_z1_sentinels',
    zone: 1,
    name: 'Threshold Twin Sentinels',
    entryT: 0.122,
    gateT: 0.185,
    isBoss: false,
    enemies: [
      {
        id: 'scale_guard',
        name: 'Abyssal Scale-Guard Captain',
        scaleTier: 'vanguard',
        file: '/sibling/tartarus/public/cast/dragon_warrior2.glb',
        weapon: 'buster_sword',
        t: 0.145,
        lat: -1.3,
        height: 2.12,
        hp: 5800,
        maxPoise: 1350,
        moves: ['slashFast', 'whirlwindCleave', 'heavyDelayed', 'overheadSlam', 'leapingCrush'],
      },
      {
        id: 'tide_exec',
        name: 'Tide-Carved Executioner Chief',
        scaleTier: 'chief',
        file: '/sibling/tartarus/public/cast/reptilian.glb',
        weapon: 'twin_stinger',
        t: 0.162,
        lat: 1.3,
        height: 2.85,
        hp: 7600,
        maxPoise: 1650,
        moves: ['katanaBlitz', 'slashCombo', 'risingCut', 'flurryChain', 'heavyDelayed'],
      },
    ],
  },
  {
    id: 'enc_z2_optional_wight',
    zone: 2,
    name: 'Sunken Tidal Clearing (Optional Yaoguai King)',
    isBranch: true,
    branchU: 0.82,
    isBoss: true,
    optional: true,
    rewardBuff: 'Elder Spirit: Wandering Colossus (+35% Poise Break, +1 Max Focus & [V] Spirit Slam)',
    enemies: [
      {
        id: 'elder_lithos',
        name: 'Elder Lithos, the Wandering Colossus',
        title: 'Colossal Guardian of the Sunken Totems',
        scaleTier: 'king',
        file: '/sibling/tartarus/public/cast/ogre.glb',
        weapon: 'buster_sword',
        u: 0.82,
        lat: 0.0,
        height: 5.35,
        hp: 14800,
        maxPoise: 2400,
        isBoss: true,
        moves: ['overheadSlam', 'leapingCrush', 'whirlwindCleave', 'heavyDelayed', 'polearmSweep', 'flurryChain'],
      },
    ],
  },
  {
    id: 'enc_z2_courtyard_guard',
    zone: 2,
    name: 'Outer Ember Courtyard',
    entryT: 0.252,
    gateT: 0.308,
    isBoss: false,
    enemies: [
      {
        id: 'courtyard_guai_1',
        name: 'Ember-Claw Lesser Guai',
        scaleTier: 'swarm',
        file: '/sibling/tartarus/public/cast/katakan.glb',
        weapon: 'twin_stinger',
        t: 0.273,
        lat: -1.4,
        height: 1.24,
        hp: 2950,
        maxPoise: 680,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      {
        id: 'drakaina_halberd',
        name: 'Drakaina, Courtyard Halberdier',
        scaleTier: 'vanguard',
        file: '/sibling/tartarus/public/cast/draconic_f.glb',
        weapon: 'strike_rod',
        t: 0.284,
        lat: 0.5,
        height: 2.10,
        hp: 6400,
        maxPoise: 1450,
        moves: ['polearmSweep', 'polearmComboB', 'risingCut', 'slashCombo', 'heavyDelayed'],
      },
    ],
  },
  {
    id: 'enc_z2_boss_krampus',
    zone: 2,
    name: 'Inner Ember Courtyard (Main Gate)',
    entryT: 0.325,
    gateT: 0.398,
    isBoss: true,
    enemies: [
      {
        id: 'boss_krampus',
        name: 'Yaoguai King Krampus',
        title: 'Towering Polearm Sovereign of the Ember Court',
        scaleTier: 'king',
        file: '/sibling/tartarus/public/cast/krampus.glb',
        weapon: 'emberwing',
        t: 0.362,
        lat: 0.0,
        height: 4.35,
        hp: 16800,
        maxPoise: 2600,
        isBoss: true,
        moves: ['polearmSweep', 'polearmComboB', 'leapingCrush', 'overheadSlam', 'flurryChain', 'heavyDelayed'],
      },
    ],
  },
  {
    id: 'enc_z3_bridge_gauntlet',
    zone: 3,
    name: "The Serpent's Suspension Bridge",
    entryT: 0.472,
    gateT: 0.548,
    isBoss: false,
    enemies: [
      {
        id: 'bridge_duelist',
        name: 'Nykteris, Chasm Bridge Duelist',
        scaleTier: 'vanguard',
        file: '/sibling/tartarus/public/cast/katakan.glb',
        weapon: 'masamune',
        t: 0.505,
        lat: 0.0,
        height: 1.96,
        hp: 6600,
        maxPoise: 1380,
        moves: ['katanaBlitz', 'katanaFinisher', 'slashCombo', 'risingCut', 'flurryChain', 'slashFast'],
      },
      {
        id: 'perch_caster',
        name: 'Sellen, Basalt Ledge Pyromancer',
        scaleTier: 'vanguard',
        file: '/sibling/tartarus/public/cast/sellen.glb',
        weapon: 'strike_rod',
        t: 0.532,
        lat: 1.1,
        height: 1.88,
        hp: 4800,
        maxPoise: 1150,
        rangedCaster: true,
        moves: ['slashFast', 'polearmSweep', 'polearmComboB'],
      },
    ],
  },
  {
    id: 'enc_z3_cavern_warden',
    zone: 3,
    name: 'Upper Cavern Mouth',
    entryT: 0.565,
    gateT: 0.622,
    isBoss: false,
    enemies: [
      {
        id: 'warden_blaidd',
        name: 'Chief Blaidd, Giant Wolf-Warden of the Ascent',
        scaleTier: 'chief',
        file: '/sibling/tartarus/public/cast/blaidd.glb',
        weapon: 'buster_sword',
        t: 0.592,
        lat: 0.0,
        height: 3.55,
        hp: 9600,
        maxPoise: 1950,
        moves: ['leapingCrush', 'whirlwindCleave', 'heavyDelayed', 'risingCut', 'overheadSlam', 'flurryChain'],
      },
    ],
  },
  {
    id: 'enc_z4_boss_mirror_basin',
    zone: 4,
    name: 'The Mirror Basin Amphitheater',
    entryT: 0.682,
    gateT: 0.785,
    isBoss: true,
    enemies: [
      {
        id: 'boss_mirror_noble',
        name: 'Lady Millicent of the Mirror Tide',
        title: 'Disciple of the Still Water (Phase I)',
        phase2Name: 'Malenia, Goddess of the Mirror Basin',
        phase2Title: 'Awakened Blade of the Scarlet Tide (Phase II)',
        phase2File: '/sibling/tartarus/public/cast/malenia.glb',
        scaleTier: 'vanguard',
        file: '/sibling/tartarus/public/cast/millicent.glb',
        weapon: 'masamune',
        t: 0.732,
        lat: 0.0,
        height: 2.15,
        hp: 14500,
        phase2Hp: 18000,
        maxPoise: 2350,
        isBoss: true,
        twoPhase: true,
        moves: ['katanaBlitz', 'waterfowlDance', 'slashCombo', 'risingCut', 'heavyDelayed', 'flurryChain'],
      },
    ],
  },
  {
    id: 'enc_z5_sanctum_guard',
    zone: 5,
    name: 'Obsidian Maw Stairway',
    entryT: 0.852,
    gateT: 0.908,
    isBoss: false,
    enemies: [
      {
        id: 'sanctum_guai_1',
        name: 'Obsidian Imp Guai',
        scaleTier: 'swarm',
        file: '/sibling/tartarus/public/cast/reptilian.glb',
        weapon: 'twin_stinger',
        t: 0.866,
        lat: 0.0,
        height: 1.18,
        hp: 3300,
        maxPoise: 750,
        moves: ['katanaBlitz', 'slashFast', 'gapCloserThrust'],
      },
      {
        id: 'sanctum_lion',
        name: 'Leon, Giant Maned Berserker Chief',
        scaleTier: 'chief',
        file: '/sibling/tartarus/public/cast/lion.glb',
        weapon: 'hardedge',
        t: 0.876,
        lat: -1.4,
        height: 3.75,
        hp: 9400,
        maxPoise: 1900,
        moves: ['leapingCrush', 'whirlwindCleave', 'overheadSlam', 'heavyDelayed', 'flurryChain'],
      },
      {
        id: 'sanctum_reaper',
        name: 'Thanatos, Obsidian Reaper Chief',
        scaleTier: 'chief',
        file: '/sibling/tartarus/public/cast/harvester.glb',
        weapon: 'voidrend',
        t: 0.888,
        lat: 1.4,
        height: 2.95,
        hp: 8600,
        maxPoise: 1800,
        moves: ['katanaBlitz', 'slashCombo', 'risingCut', 'polearmSweep', 'heavyDelayed'],
      },
    ],
  },
  {
    id: 'enc_z5_final_sovereign',
    zone: 5,
    name: 'Crater of the Apex Sovereign',
    entryT: 0.922,
    gateT: 0.992,
    isBoss: true,
    isFinalBoss: true,
    enemies: [
      {
        id: 'boss_apex_sovereign',
        name: 'The Apex Sovereign — Colossal Titan of the Crown',
        title: 'Colossal Lord of the Serpent Spine',
        scaleTier: 'colossal',
        file: '/sibling/tartarus/public/cast/dancer.glb',
        weapon: 'voidrend',
        t: 0.960,
        lat: 0.0,
        height: 6.45,
        hp: 28000,
        maxPoise: 3400,
        isBoss: true,
        destroysPillars: true,
        moves: ['waterfowlDance', 'leapingCrush', 'whirlwindCleave', 'overheadSlam', 'polearmSweep', 'flurryChain', 'heavyDelayed'],
      },
    ],
  },
];

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class SoulslikeCombatEngine {
  constructor({ scene, spine, world, animStore, armory, vfx, onBanner, onStateChange }) {
    this.scene = scene;
    this.spine = spine;
    this.world = world;
    this.animStore = animStore;
    this.armory = armory;
    this.vfx = vfx;
    if (this.vfx) {
      this.vfx.combatEngine = this;
    }
    this.onBanner = onBanner || (() => {});
    this.onStateChange = onStateChange || (() => {});

    // Player State with FF7 Remake Stances, Limit Gauge, Grimoire Spells, Elemental Imbue & Vertical Jump Physics
    this.player = {
      pos: this.spine.getWorldPos(0.015, 0, 0),
      vel: new THREE.Vector3(),
      yaw: Math.PI,
      height: 1.82,
      radius: 0.52,
      jumpOffsetY: 0,
      velY: 0,
      isGrounded: true,
      airTime: 0,
      airJumpsUsed: 0,
      airPlunging: false,
      landRecoveryTimer: 0,
      sprintStartTimer: 0,
      runStopTimer: 0,
      wasMoving: false,
      wasSprinting: false,
      turnRate: 0,
      bodyBankRoll: 0,
      bodyPitchLean: 0,
      hp: 500,
      maxHp: 500,
      baseMaxHp: 500,
      stamina: 150,
      maxStamina: 150,
      baseMaxStamina: 150,
      focus: 2.5, // Starts with 2.5 ATB/Focus Bars ready so player can immediately test Weapon Skills & Grimoire Spells
      maxFocus: 3.0,
      limitGauge: 100, // Starts at 100% Limit Ready
      maxLimitGauge: 100,
      stanceMode: 'operator', // 'operator' (Agile Style Combos) | 'punisher' (FF7R Berserk 2H +25% DMG & Auto-Counterstance)
      selectedSpellIndex: 0, // Index into GRIMOIRE_SPELLS ([N] to cycle, [Y] to cast)
      imbueTimer: 0, // Elemental Blade Imbue remaining seconds
      imbueElement: null,
      imbueColor: 0xffd700,
      imbueSparkAccum: 0,
      crouching: false,
      sprinting: false,
      gourds: 5,
      maxGourds: 5,
      baseMaxGourds: 5,
      elderSpiritBuff: false, // Unlocked by defeating Optional Left Branch Boss Elder Lithos
      heroIndex: 0,
      weaponId: 'buster_sword',
      state: 'idle', // idle | move | attack | dodge | guard | heal | stagger | dead
      attackDef: null,
      attackTime: 0,
      attackHitSet: new Set(),
      attackEffectFired: false,
      queuedAttackId: null,
      lastMoveName: 'READY',
      flowHistory: [], // Pigaloo Prismatic Flow tracker (rewards chaining 3 distinct move families)
      flowTimer: 0,
      flowCount: 0,
      dodgeTimer: 0,
      dodgeDir: new THREE.Vector3(0, 0, -1),
      iFrameTimer: 0,
      guardTimer: 0,
      deflectMashCount: 0,
      lastGuardReleaseTime: -10,
      deflectWindow: 0.22,
      deflectChain: 0,
      combatClock: 0,
      healTimer: 0,
      staggerTimer: 0,
      stepRippleAccum: 0,
      puppet: null,
      weaponMount: null,
      bladeTrail: new RibbonBladeTrail(scene, 0x58e6ff, 24),
      focusBarsSpent: 1,
    };

    // Trial difficulty (Easy / Normal / Expert). Expert is the untouched original balance.
    this.difficultyId = loadDifficultyId();
    this._applyDifficultyPlayerStats({ preserveRatio: false });

    // Orient player along initial spine tangent
    const startSample = this.spine.getSampleAt(0.015);
    this.player.yaw = Math.atan2(-startSample.flatTangent.x, -startSample.flatTangent.z);

    // Camera, Chapter Realm & Time Dilation state
    this.chapterIndex = 1;
    this.chapters = CHAPTER_REALMS;
    this.mirageSlowTimer = 0;
    this.cameraShake = 0;
    this.chromaticPulse = 0;
    this.lockedTarget = null;
    this.lastCheckpointShrine = this.world.shrineObjects[0];

    // Pooled Projectiles (rendered via single InstancedMesh in CombatVFXManager)
    this.projectiles = [];
    this.encounters = [];
  }

  async init() {
    await this.equipHero(0);
    await this.spawnAllEncounters();
  }

  getChapterRealm() {
    return CHAPTER_REALMS[(this.chapterIndex - 1) % CHAPTER_REALMS.length] || CHAPTER_REALMS[0];
  }

  // ---------------------------------------------------------------------------
  // Trial Difficulty (Easy / Normal / Expert)
  // ---------------------------------------------------------------------------
  getDifficulty() {
    return getDifficultyProfile(this.difficultyId);
  }

  getDifficultyId() {
    return this.getDifficulty().id;
  }

  /**
   * Switch difficulty live. Expert keeps every original multiplier at 1.0, so
   * returning to it restores the shipped balance exactly.
   */
  setDifficulty(id, { announce = true } = {}) {
    const profile = getDifficultyProfile(id);
    const changed = profile.id !== this.difficultyId;
    this.difficultyId = profile.id;
    saveDifficultyId(profile.id);
    this._applyDifficultyPlayerStats({ preserveRatio: true });
    this._applyDifficultyEnemyStats();

    if (changed && announce) {
      const color = profile.id === 'easy' ? '#7be0ff' : profile.id === 'normal' ? '#ffd270' : '#ff6a36';
      this.onBanner(
        `TRIAL DIFFICULTY: ${profile.name.toUpperCase()} — ${profile.tagline.toUpperCase()}`,
        color,
      );
    }
    if (changed) this.onStateChange();
    return profile;
  }

  _applyDifficultyPlayerStats({ preserveRatio = true } = {}) {
    const p = this.player;
    if (!p) return;
    const diff = this.getDifficulty();
    const hpRatio = preserveRatio && p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const staminaRatio = preserveRatio && p.maxStamina > 0 ? p.stamina / p.maxStamina : 1;
    const vitals = playerVitalsForDifficulty(
      {
        maxHp: p.baseMaxHp || 500,
        maxStamina: p.baseMaxStamina || 150,
        maxGourds: p.baseMaxGourds || 5,
      },
      diff.id,
    );

    p.maxHp = vitals.maxHp;
    p.maxStamina = vitals.maxStamina;
    p.maxGourds = vitals.maxGourds;
    p.hp =
      p.state === 'dead'
        ? 0
        : Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * hpRatio)));
    p.stamina = Math.max(0, Math.min(p.maxStamina, p.maxStamina * staminaRatio));
    // A fresh game fills the difficulty's gourds; mid-run switches never mint free heals.
    p.gourds = preserveRatio ? Math.min(p.gourds ?? 0, p.maxGourds) : p.maxGourds;
    p.deflectWindow = this.getDeflectWindow(0.22);
  }

  _applyDifficultyEnemyStats() {
    const diff = this.getDifficulty();
    for (const enc of this.encounters || []) {
      for (const f of enc.fighters || []) {
        if (!f.baseMaxHp) continue;
        const hpRatio = f.maxHp > 0 ? Math.max(0, Math.min(1, f.hp / f.maxHp)) : 0;
        const vitals = scaleEnemyVitals(f.baseMaxHp, f.baseMaxPoise || f.maxPoise || 1, diff.id);
        f.maxHp = vitals.maxHp;
        f.maxPoise = vitals.maxPoise;
        f.maxLegDamage = vitals.maxLegDamage;
        f.poise = Math.min(f.poise || 0, f.maxPoise);
        f.legDamage = Math.min(f.legDamage || 0, f.maxLegDamage);
        f.hp = f.isDead ? 0 : Math.max(1, Math.min(f.maxHp, Math.round(f.maxHp * hpRatio)));
      }
    }
  }

  getDeflectWindow(base = 0.22) {
    return Math.min(0.32, base + (this.getDifficulty().deflectWindowBonus || 0));
  }

  scalePlayerDamage(raw) {
    return Math.max(1, Math.round(raw * (this.getDifficulty().playerDamageMult || 1)));
  }

  scalePlayerHealing(raw) {
    return Math.max(1, Math.round(raw * (this.getDifficulty().healMult || 1)));
  }

  async selectChapter(chapterNumber) {
    const idx = (((chapterNumber - 1) % CHAPTER_REALMS.length) + CHAPTER_REALMS.length) % CHAPTER_REALMS.length;
    this.chapterIndex = idx + 1;
    const realm = this.getChapterRealm();

    // Dispose existing encounter fighters & seals
    for (const enc of this.encounters) {
      if (enc.sealMesh) {
        this.scene.remove(enc.sealMesh);
      }
      for (const f of enc.fighters) {
        if (f.puppet?.root) {
          this.scene.remove(f.puppet.root);
          f.puppet.dispose();
        }
        f.weaponMount?.dispose();
        f.bladeTrail?.dispose();
      }
    }
    this.encounters = [];
    this.projectiles = [];
    this.lockedTarget = null;

    // Reset destructible pillars
    if (this.world?.destructiblePillars) {
      for (const pillar of this.world.destructiblePillars) {
        pillar.intact = true;
        pillar.hp = pillar.maxHp || 300;
        if (pillar.mesh) pillar.mesh.visible = true;
      }
    }

    // Apply Chapter Biome (trees, foliage colors, rain puddles / frost sparkles / magma fissures)
    this.world?.setChapterBiome?.(this.chapterIndex);

    // Respawn all encounters with Chapter overrides & difficulty multipliers
    await this.spawnAllEncounters();

    // Teleport player to Chapter entry threshold
    if (this.chapterIndex === 9) {
      const py = this.spine.locateWorldPoint({ x: 28, y: 0, z: 42 }).groundY;
      this.player.pos.set(28, py, 42);
      this.player.yaw = Math.atan2(-(24 - 28), -(-30 - 42));
    } else {
      const startSample = this.spine.getSampleAt(0.015);
      this.player.pos.copy(startSample.point);
      this.player.yaw = Math.atan2(-startSample.flatTangent.x, -startSample.flatTangent.z);
    }
    this.player.vel.set(0, 0, 0);
    this.player.jumpOffsetY = 0;
    this.player.velY = 0;
    this.player.isGrounded = true;
    this.player.state = 'idle';
    this.player.hp = this.player.maxHp;
    this.player.stamina = this.player.maxStamina;
    this.player.gourds = this.player.maxGourds;
    this.player.focus = Math.max(this.player.focus, 2.5);
    this.player.limitGauge = 100;
    if (this.player.puppet?.root) {
      this.player.puppet.root.position.copy(this.player.pos);
      this.player.puppet.root.rotation.y = this.player.yaw;
      this.player.puppet.play(this.getIdleClip(), { loop: true, forceReset: true });
    }
    this.lastCheckpointShrine = this.world.shrineObjects[0];
    sound.shrine();
    this.vfx.spawnShockwaveRing(this.player.pos, 5.2, 0xffd700);
    this.onBanner(
      `CHAPTER ${realm.chapter}: ${realm.name.toUpperCase()} — ${realm.subtitle.toUpperCase()} (${realm.diffHp.toFixed(2)}x HP / ${realm.diffDmg.toFixed(2)}x DMG)`,
      '#ffd700',
    );
    this.onStateChange();
    return realm;
  }

  async cycleChapter(step = 1) {
    return this.selectChapter(this.chapterIndex + step);
  }

  async advanceToNextChapter() {
    const nextChapter = (this.chapterIndex % CHAPTER_REALMS.length) + 1;
    return this.selectChapter(nextChapter);
  }

  getWeaponStyle(weaponId = this.player.weaponId) {
    return WEAPON_CATALOG[weaponId]?.style || 'great';
  }

  getSelectedSpell() {
    return GRIMOIRE_SPELLS[this.player.selectedSpellIndex] || GRIMOIRE_SPELLS[0];
  }

  getIdleClip() {
    const p = this.player;
    if (p.crouching) return 'Crouch_Idle';
    if (p.stanceMode === 'punisher') return 'rpg2HandBaseStandIdleA1';
    const style = this.getWeaponStyle();
    if (style === 'katana' && this.animStore.has('bcdCKIdleS1')) return 'bcdCKIdleS1';
    if (style === 'staff' && this.animStore.has('bcdSpearIdleS1')) return 'bcdSpearIdleS1';
    return style === 'great' ? 'Great_Idle' : 'Sword_Idle';
  }

  getGuardClip() {
    const p = this.player;
    if (p.stanceMode === 'punisher') return 'rpg2HandBaseBlockIdle';
    const style = this.getWeaponStyle();
    return style === 'great' || style === 'katana' || style === 'staff' ? 'Great_Guard' : 'Sword_Guard';
  }

  async equipHero(heroIdx) {
    const idx = ((heroIdx % HERO_ROSTER.length) + HERO_ROSTER.length) % HERO_ROSTER.length;
    const entry = HERO_ROSTER[idx];
    const [gltf, ...outfitGltfs] = await Promise.all([
      loadGLTF(entry.file),
      ...(entry.outfits || []).map((url) => loadGLTF(url)),
    ]);
    if (!gltf) return;

    if (this.player.puppet) {
      this.scene.remove(this.player.puppet.root);
      this.player.puppet.dispose();
    }
    this.player.heroIndex = idx;
    this.player.height = entry.height;
    this.player.puppet = createFighterPuppet({
      store: this.animStore,
      characterGltf: gltf,
      outfitGltfs: outfitGltfs.filter(Boolean),
      isHeroStyle: !!entry.isHeroStyle,
      targetHeight: entry.height,
    });
    this.scene.add(this.player.puppet.root);
    this.player.puppet.root.position.copy(this.player.pos);
    this.player.puppet.root.rotation.y = this.player.yaw;
    this.player.puppet.play(this.getIdleClip(), { loop: true });

    await this.equipWeapon(entry.defaultWeapon || this.player.weaponId);
  }

  async selectHero(indexOrId) {
    let idx = typeof indexOrId === 'number' ? indexOrId : HERO_ROSTER.findIndex((h) => h.id === indexOrId);
    if (idx < 0) idx = 0;
    await this.equipHero(idx);
    const h = HERO_ROSTER[this.player.heroIndex];
    this.onBanner(`VESSEL INCARNATED: ${h.name.toUpperCase()}`, '#ffd270');
    this.onStateChange();
  }

  async equipWeapon(weaponId) {
    if (!WEAPON_CATALOG[weaponId]) weaponId = 'buster_sword';
    this.player.weaponId = weaponId;
    const spec = WEAPON_CATALOG[weaponId];
    const wMesh = await this.armory.makeWeapon(weaponId);
    if (this.player.weaponMount) {
      this.player.weaponMount.dispose();
    }
    this.player.weaponMount = mountWeaponToPuppet(wMesh, this.player.puppet, {
      height: this.player.height,
    });
    this.player.bladeTrail.setColor(this.player.imbueTimer > 0 ? this.player.imbueColor : spec.color);
    this.onStateChange();
  }

  async selectWeapon(weaponId) {
    if (!WEAPON_CATALOG[weaponId]) return;
    await this.equipWeapon(weaponId);
    const spec = WEAPON_CATALOG[weaponId];
    if (this.player.state === 'idle' && this.player.puppet) {
      const drawClip =
        spec.style === 'great' || spec.style === 'katana' || spec.style === 'staff'
          ? 'gsDrawAGreatSword1'
          : 'rpg1HandBaseFightReadyR1';
      this.player.puppet.play(drawClip, { loop: false, rate: 1.35, fade: 0.08, forceReset: true });
    }
    const elInfo = ELEMENTS[spec.element];
    const elTag = elInfo ? ` • ${elInfo.label.toUpperCase()} AFFINITY` : '';
    this.onBanner(`ARMORY: ${spec.name.toUpperCase()} (${spec.style.toUpperCase()}${elTag})`, '#7be0ff');
  }

  async cycleWeapon(step = 1) {
    const keys = Object.keys(WEAPON_CATALOG);
    const cur = keys.indexOf(this.player.weaponId);
    const next = keys[(cur + step + keys.length) % keys.length];
    await this.selectWeapon(next);
  }

  async cycleHero(step = 1) {
    await this.selectHero(this.player.heroIndex + step);
  }

  selectGrimoireSpell(indexOrId) {
    const p = this.player;
    const idx =
      typeof indexOrId === 'number'
        ? ((indexOrId % GRIMOIRE_SPELLS.length) + GRIMOIRE_SPELLS.length) % GRIMOIRE_SPELLS.length
        : Math.max(0, GRIMOIRE_SPELLS.findIndex((s) => s.id === indexOrId));
    p.selectedSpellIndex = idx;
    const sp = this.getSelectedSpell();
    this.onBanner(`GRIMOIRE ATTUNED: ${sp.name.toUpperCase()} — ${sp.desc}`, sp.color);
    this.onStateChange();
  }

  cycleGrimoireSpell(step = 1) {
    this.selectGrimoireSpell(this.player.selectedSpellIndex + step);
  }

  // Toggle between FF7 Remake OPERATOR Mode and PUNISHER Mode ([Tab] or [X])
  toggleStanceMode() {
    const p = this.player;
    if (p.state === 'dead') return;
    p.stanceMode = p.stanceMode === 'operator' ? 'punisher' : 'operator';
    p.crouching = false;
    sound.swing(p.stanceMode === 'punisher');
    const ringColor = p.stanceMode === 'punisher' ? 0xff4e2a : 0x58e6ff;
    this.vfx.spawnShockwaveRing(p.pos, 2.8, ringColor);

    if (p.state === 'idle') {
      p.puppet.play(
        p.stanceMode === 'punisher' ? 'gsGreatSwordPowerUp' : this.getIdleClip(),
        { loop: p.stanceMode !== 'punisher', rate: 1.35, fade: 0.1 },
      );
    }
    this.onBanner(
      p.stanceMode === 'punisher'
        ? 'PUNISHER MODE — BERSERK 2H (+25% DMG & GUARD COUNTERSTANCE)'
        : 'OPERATOR MODE — AGILE WEAPON-STYLE SLASH CHAIN',
      p.stanceMode === 'punisher' ? '#ff5a36' : '#58e6ff',
    );
    this.onStateChange();
  }

  toggleCrouch(force = null) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'attack' || p.state === 'dodge') return;
    p.crouching = force !== null ? force : !p.crouching;
    p.puppet.play(p.crouching ? 'Crouch_Down' : 'Crouch_Rise', { loop: false, rate: 1.3, fade: 0.1 });
    this.onStateChange();
  }

  async spawnAllEncounters() {
    for (const bp of ENCOUNTER_BLUEPRINTS) {
      const enc = {
        ...bp,
        engaged: false,
        cleared: false,
        dissolveVal: 0.0,
        sealMesh: null,
        rearSealMesh: null,
        fighters: [],
      };

      // Create Obsidian Fog Seal across the exit pinch point of main-trail encounters (canyon chapters 1-8)
      if (!bp.isBranch && bp.gateT && this.chapterIndex !== 9) {
        const gateSample = this.spine.getSampleAt(bp.gateT);
        const sealWidth = gateSample.halfWidth * 2.3;
        const sealColor = bp.isBoss ? 0xff3820 : this.chapterIndex === 5 ? 0xffa830 : 0xb85cff;
        const sealMesh = createObsidianSealMesh(sealWidth, 6.2, sealColor);
        sealMesh.position.copy(gateSample.point);
        sealMesh.rotation.y = Math.atan2(gateSample.flatTangent.x, gateSample.flatTangent.z);
        this.scene.add(sealMesh);
        enc.sealMesh = sealMesh;
      }

      for (const eSpec of bp.enemies) {
        const fighter = await this.spawnEnemyFighter(eSpec, enc);
        if (fighter) enc.fighters.push(fighter);
      }

      this.encounters.push(enc);
    }
  }

  async spawnEnemyFighter(rawSpec, enc) {
    const chapter = this.getChapterRealm();
    const override = chapter?.overrides?.[rawSpec.id] || {};
    const eSpec = { ...rawSpec, ...override };
    const diffHp = chapter?.diffHp || 1.0;

    let gltf = await loadGLTF(eSpec.file);
    if (!gltf && eSpec.file !== rawSpec.file) {
      gltf = await loadGLTF(rawSpec.file);
    }
    if (!gltf) return null;

    const spawnPos = Array.isArray(eSpec.worldXZ)
      ? new THREE.Vector3(
          eSpec.worldXZ[0],
          this.spine.locateWorldPoint({ x: eSpec.worldXZ[0], y: 0, z: eSpec.worldXZ[1] }).groundY,
          eSpec.worldXZ[1],
        )
      : enc.isBranch
      ? this.spine.getWorldPos(eSpec.u, eSpec.lat || 0, 0, true)
      : this.spine.getWorldPos(eSpec.t, eSpec.lat || 0, 0, false);

    const s = enc.isBranch
      ? this.spine.getBranchSampleAt(eSpec.u)
      : this.spine.getSampleAt(eSpec.t);

    const h = eSpec.height || 1.95;
    const scaleTier =
      eSpec.scaleTier ||
      (h >= 5.5 ? 'colossal' : h >= 4.0 ? 'king' : h >= 2.6 ? 'chief' : h < 1.45 ? 'swarm' : 'vanguard');

    let puppet = null;
    try {
      puppet = createFighterPuppet({
        store: this.animStore,
        characterGltf: gltf,
        targetHeight: h,
      });
    } catch (_err) {
      const fallbackGltf = await loadGLTF(rawSpec.file);
      if (!fallbackGltf) return null;
      puppet = createFighterPuppet({
        store: this.animStore,
        characterGltf: fallbackGltf,
        targetHeight: h,
      });
    }
    if (eSpec.matScheme) {
      applyEgyptianMaterialScheme(puppet.character || puppet.root, eSpec.matScheme);
    }
    this.scene.add(puppet.root);

    const weaponMesh = await this.armory.makeWeapon(eSpec.weapon || 'buster_sword');
    const weaponMount = mountWeaponToPuppet(weaponMesh, puppet, { height: h });
    const schemeTrail = eSpec.matScheme ? EGYPTIAN_MATERIAL_SCHEMES[eSpec.matScheme]?.trailColor : null;
    const trailColor = schemeTrail || (eSpec.isBoss ? 0xff4520 : scaleTier === 'swarm' ? 0x72ff98 : 0xffaa40);
    const bladeTrail = new RibbonBladeTrail(this.scene, trailColor, 18);

    const initialYaw = Math.atan2(s.flatTangent.x, s.flatTangent.z);
    puppet.root.position.copy(spawnPos);
    puppet.root.rotation.y = initialYaw;
    const idleClip = WEAPON_CATALOG[eSpec.weapon]?.style === 'great' ? 'Great_Idle' : 'Sword_Idle';
    puppet.play(idleClip, { loop: true });

    const findBone = (candidates) => {
      if (!puppet?.source) return null;
      for (const name of candidates) {
        const b = puppet.source.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
        if (b) return b;
      }
      return null;
    };

    // Chapter scaling first, then the player-selected trial difficulty.
    const baseMaxHp = Math.round(eSpec.hp * diffHp);
    const baseMaxPoise = Math.round((eSpec.maxPoise || 100) * Math.sqrt(diffHp));
    const difficultyVitals = scaleEnemyVitals(baseMaxHp, baseMaxPoise, this.difficultyId);
    const scaledMaxHp = difficultyVitals.maxHp;
    const scaledMaxPoise = difficultyVitals.maxPoise;

    const fighter = {
      ...eSpec,
      height: h,
      scaleTier,
      sizeClass: scaleTier,
      encounter: enc,
      spawnPos: spawnPos.clone(),
      pos: spawnPos.clone(),
      yaw: initialYaw,
      radius: h * (scaleTier === 'colossal' || scaleTier === 'king' ? 0.22 : 0.28),
      baseMaxHp,
      baseMaxPoise,
      maxHp: scaledMaxHp,
      hp: scaledMaxHp,
      poise: 0,
      maxPoise: scaledMaxPoise,
      legDamage: 0,
      maxLegDamage: difficultyVitals.maxLegDamage,
      armorCrack: 1.0,
      pressuredTimer: 0,
      immobilizedTimer: 0,
      immobilizedDmgAccum: 0,
      burnTimer: 0,
      burnTickAccum: 0,
      frostTimer: 0,
      phase: 1,
      isDead: false,
      deathClip: null,
      deathTimer: 0,
      state: 'idle', // idle | pursue | strafe | attack | stagger | dead
      stance: 'highGuard', // highGuard | berserkFlurry
      stanceTimer: 5.0,
      blockedHitsCount: 0,
      attackMove: null,
      attackTime: 0,
      attackHitPlayer: false,
      attackDeflected: false,
      cooldown: 0.5,
      staggerTimer: 0,
      stepRippleAccum: 0,
      puppet,
      weaponMount,
      bladeTrail,
      socketBones: {
        ankleL: findBone(['foot_l', 'calf_l', 'Bip001_L_Foot', 'LeftFoot']),
        ankleR: findBone(['foot_r', 'calf_r', 'Bip001_R_Foot', 'RightFoot']),
        torso: findBone(['spine_02', 'spine_01', 'pelvis', 'Bip001_Spine1']),
        head: findBone(['head', 'neck_01', 'Bip001_Head', 'Head']),
      },
      hurtboxes: [],
    };
    this.updateEnemyHurtboxes(fighter);
    return fighter;
  }

  updateEnemyHurtboxes(f) {
    const h = f.height || 2.0;
    const isToppled = f.state === 'stagger' && f.staggerTimer > 1.6;
    const fwdX = -Math.sin(f.yaw);
    const fwdZ = -Math.cos(f.yaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;

    if (!f.hurtboxes || f.hurtboxes.length === 0) {
      f.hurtboxes = [
        {
          id: 'ankle_l',
          label: 'LEFT ANKLE',
          pos: new THREE.Vector3(),
          height: h * 0.36,
          radius: Math.max(0.32, h * 0.13),
          dmgMult: 0.92,
          poiseMult: 1.45,
          legMult: 1.65,
        },
        {
          id: 'ankle_r',
          label: 'RIGHT ANKLE',
          pos: new THREE.Vector3(),
          height: h * 0.36,
          radius: Math.max(0.32, h * 0.13),
          dmgMult: 0.92,
          poiseMult: 1.45,
          legMult: 1.65,
        },
        {
          id: 'torso',
          label: 'TORSO CORE',
          pos: new THREE.Vector3(),
          height: h * 0.48,
          radius: Math.max(0.42, h * 0.19),
          dmgMult: 1.0,
          poiseMult: 1.0,
          legMult: 0.35,
        },
        {
          id: 'head',
          label: 'CROWN WEAKPOINT',
          pos: new THREE.Vector3(),
          height: h * 0.30,
          radius: Math.max(0.36, h * 0.15),
          dmgMult: 1.65,
          poiseMult: 1.75,
          legMult: 0.0,
          isWeakPoint: true,
        },
      ];
    }

    const [hbAnkleL, hbAnkleR, hbTorso, hbHead] = f.hurtboxes;
    const spread = h * 0.16;

    if (f.socketBones?.ankleL) {
      f.socketBones.ankleL.getWorldPosition(hbAnkleL.pos);
      hbAnkleL.pos.y = f.pos.y;
    } else {
      hbAnkleL.pos.set(f.pos.x - rightX * spread, f.pos.y, f.pos.z - rightZ * spread);
    }

    if (f.socketBones?.ankleR) {
      f.socketBones.ankleR.getWorldPosition(hbAnkleR.pos);
      hbAnkleR.pos.y = f.pos.y;
    } else {
      hbAnkleR.pos.set(f.pos.x + rightX * spread, f.pos.y, f.pos.z + rightZ * spread);
    }

    hbTorso.pos.set(f.pos.x, f.pos.y + (isToppled ? h * 0.15 : h * 0.32), f.pos.z);

    if (isToppled) {
      // When a Giant/Colossal enemy is toppled, its head crashes down to ground level in front of it!
      hbHead.pos.set(f.pos.x + fwdX * (h * 0.35), f.pos.y + 0.35, f.pos.z + fwdZ * (h * 0.35));
    } else if (f.socketBones?.head) {
      f.socketBones.head.getWorldPosition(hbHead.pos);
      hbHead.pos.y = Math.max(f.pos.y + h * 0.58, hbHead.pos.y - h * 0.12);
    } else {
      hbHead.pos.set(f.pos.x + fwdX * (h * 0.08), f.pos.y + h * 0.68, f.pos.z + fwdZ * (h * 0.08));
    }
  }

  // Respawns non-boss guards when resting at a Shrine
  restAtShrine(shrine) {
    sound.shrine();
    this.lastCheckpointShrine = shrine;
    shrine.discovered = true;
    this.player.hp = this.player.maxHp;
    this.player.stamina = this.player.maxStamina;
    this.player.gourds = this.player.maxGourds;
    this.player.focus = Math.max(this.player.focus, 2.5);
    this.player.limitGauge = 100;
    this.player.state = 'idle';

    for (const enc of this.encounters) {
      if (enc.isBoss && enc.cleared) continue; // Conquered bosses stay dead!
      enc.engaged = false;
      if (!enc.isBoss) {
        enc.cleared = false;
        enc.dissolveVal = 0.0;
        if (enc.sealMesh) {
          enc.sealMesh.visible = true;
          enc.sealMesh.userData.uDissolve.value = 0.0;
        }
      }
      for (const f of enc.fighters) {
        if (enc.isBoss && f.isDead) continue;
        f.isDead = false;
        f.deathTimer = 0;
        f.deathClip = null;
        f.hp = f.maxHp;
        f.poise = 0;
        f.legDamage = 0;
        f.pressuredTimer = 0;
        f.immobilizedTimer = 0;
        f.immobilizedDmgAccum = 0;
        f.burnTimer = 0;
        f.frostTimer = 0;
        f.armorCrack = 1.0;
        f.state = 'idle';
        f.pos.copy(f.spawnPos);
        f.puppet.root.visible = true;
        f.puppet.body.position.y = 0;
        f.puppet.root.position.copy(f.pos);
        const idleClip = WEAPON_CATALOG[f.weapon]?.style === 'great' ? 'Great_Idle' : 'Sword_Idle';
        f.puppet.play(idleClip, { loop: true, forceReset: true });
        this.updateEnemyHurtboxes(f);
      }
    }

    this.onBanner(`SHRINE KINDLED: ${shrine.name.toUpperCase()}`, '#ffd270');
    this.onStateChange();
  }

  teleportToShrine(zoneIndex) {
    const sh = this.world.shrineObjects.find((s) => s.zone === zoneIndex);
    if (!sh) return;
    sh.discovered = true;
    this.lastCheckpointShrine = sh;
    if (this.chapterIndex === 9) {
      const athenaShrines = {
        1: [28, 86, 28, 40],
        2: [28, 38, 24, -30],
        3: [2, 100, -10, 128],
        4: [24, -14, 32, -32],
        5: [20, -27.4, 20, -64],
      };
      const [sx, sz, lx, lz] = athenaShrines[zoneIndex] || athenaShrines[1];
      const sy = this.spine.locateWorldPoint({ x: sx, y: 0, z: sz }).groundY;
      this.player.pos.set(sx, sy, sz);
      this.player.yaw = Math.atan2(-(lx - sx), -(lz - sz));
    } else {
      const sample = this.spine.getSampleAt(sh.t);
      this.player.pos.copy(sample.point);
      this.player.yaw = Math.atan2(-sample.flatTangent.x, -sample.flatTangent.z);
    }
    this.player.puppet.root.position.copy(this.player.pos);
    this.player.puppet.root.rotation.y = this.player.yaw;
    this.lockedTarget = null;
    this.restAtShrine(sh);
  }

  // --- Player Combat & Locomotion Inputs (Full FF7 Remake + Pigaloo + Pro Magic Pack Repertoire) ---
  triggerJump(moveInputVec) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger' || p.state === 'heal') return;
    if (p.state === 'attack' && p.attackTime < (p.attackDef?.duration || 0.7) * 0.42) return;

    p.crouching = false;
    const hasMove = !!(moveInputVec && moveInputVec.lengthSq() > 0.01);
    const horizSpd = Math.hypot(p.vel.x, p.vel.z);

    if (p.isGrounded) {
      // Ground Jump using Pigaloo's Jump (idle-to-jump with knee bend) & Jump_Run (stride leap)
      p.isGrounded = false;
      p.velY = p.sprinting ? 9.35 : 8.75;
      p.airTime = 0;
      p.jumpWindup = hasMove || horizSpd > 2.2 ? 0.038 : 0.072;
      p.airJumpsUsed = 0;
      p.airPlunging = false;
      p.flipTimer = 0;
      p.landRecoveryTimer = 0;
      if (p.state === 'guard' || p.state === 'attack' || p.state === 'dodge') {
        p.state = 'move';
        p.attackDef = null;
      }

      if (hasMove) {
        const launchSpd = p.sprinting ? 9.4 : 7.0;
        p.vel.x = moveInputVec.x * launchSpd;
        p.vel.z = moveInputVec.z * launchSpd;
        if (!this.lockedTarget || this.lockedTarget.isDead) {
          p.yaw = Math.atan2(-moveInputVec.x, -moveInputVec.z);
        }
      }
      p.lastMoveName = 'ASTRAL LEAP';
      const jumpTakeoffClip =
        hasMove || horizSpd > 2.2
          ? this.animStore.has('Jump_Run')
            ? 'Jump_Run'
            : 'Jump'
          : this.animStore.has('Jump')
          ? 'Jump'
          : 'Jump_Start';
      p.jumpTakeoffClip = jumpTakeoffClip;
      p.puppet.play(jumpTakeoffClip, {
        loop: false,
        rate: jumpTakeoffClip === 'Jump' ? 1.22 : 1.24,
        fade: 0.06,
        time: jumpTakeoffClip === 'Jump' ? 0.14 : 0.0,
        forceReset: true,
      });
      sound.swing(false);
      this.vfx.spawnShockwaveRing(p.pos.clone(), 1.65, 0x8ad8ff);
      if (this.world.injectWaterRipple(p.pos, 1.15)) {
        this.vfx.emitWaterDroplets(p.pos, 12);
        sound.waterStep();
      }
      this.onStateChange();
    } else if (p.airJumpsUsed < 1) {
      // Double Jump (Astral Vault with 360° Mid-Air Somersault around Center of Mass)
      p.airJumpsUsed = 1;
      p.velY = 8.65;
      p.airTime = 0;
      p.jumpWindup = 0;
      p.airPlunging = false;
      p.flipTimer = 0.48;
      p.flipDur = 0.48;
      p.iFrameTimer = Math.max(p.iFrameTimer, 0.32);
      if (p.state === 'attack' || p.state === 'dodge') {
        p.state = 'move';
        p.attackDef = null;
      }
      if (hasMove) {
        const vaultSpd = p.sprinting ? 9.3 : 7.4;
        p.vel.x = moveInputVec.x * vaultSpd;
        p.vel.z = moveInputVec.z * vaultSpd;
        if (!this.lockedTarget || this.lockedTarget.isDead) {
          p.yaw = Math.atan2(-moveInputVec.x, -moveInputVec.z);
        }
      }
      p.lastMoveName = 'ASTRAL DOUBLE VAULT';
      const airLoopClip = this.animStore.has('Jump_Run') ? 'Jump_Run' : 'Jump';
      p.puppet.play(airLoopClip, { loop: false, rate: 1.25, fade: 0.05, forceReset: true });
      sound.mirageStep();
      this.vfx.spawnShockwaveRing(p.pos.clone(), 2.6, 0x58e6ff);
      this.vfx.spawnMagicLightRings(p.pos.clone(), 0x58e6ff, 0xffd700);
      this.vfx.emitSparks(p.pos.clone().add(new THREE.Vector3(0, 0.45, 0)), null, 12, 0x58e6ff, 0.85);

      // Shinobi Duel Perilous Sweep Head-Vault Counter!
      const sweepTarget = this.findNearestAliveEnemy(3.8);
      if (
        sweepTarget &&
        sweepTarget.state === 'attack' &&
        sweepTarget.attackMove?.perilous === 'sweep'
      ) {
        sweepTarget.attackDeflected = true;
        sweepTarget.pressuredTimer = 5.5;
        const vaultPoise = Math.round(sweepTarget.maxPoise * 0.36);
        sweepTarget.poise = Math.min(sweepTarget.maxPoise, sweepTarget.poise + vaultPoise);
        p.focus = Math.min(p.maxFocus, p.focus + 0.85);
        p.limitGauge = Math.min(100, p.limitGauge + 25);
        sound.deflect(true);
        this.cameraShake = Math.max(this.cameraShake, 0.34);
        this.vfx.emitSwordClash(sweepTarget.pos.clone().add(new THREE.Vector3(0, sweepTarget.height * 0.8, 0)), null, 0xffd700);
        this.onBanner(`危 SHINOBI HEAD-VAULT COUNTER — ${sweepTarget.name.toUpperCase()} POSTURE CRUSHED!`, '#ffd700');
        if (sweepTarget.poise >= sweepTarget.maxPoise) {
          sweepTarget.poise = 0;
          sweepTarget.state = 'stagger';
          sweepTarget.staggerTimer = 3.2;
          sweepTarget.attackMove = null;
          sweepTarget.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
        }
      }
      this.onStateChange();
    }
  }

  triggerLightAttack(isSprinting = false) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;

    // 0. If airborne -> execute style-specific Aerial Plunge Cleave!
    if (!p.isGrounded && p.jumpOffsetY > 0.22 && p.state !== 'attack') {
      this.triggerLeapingSmash();
      return;
    }

    // 1. Check if an enemy in front is STAGGERED -> execute Visceral Fatal Execution!
    const staggeredTarget = this.findNearestAliveEnemy(3.8);
    if (staggeredTarget && staggeredTarget.state === 'stagger') {
      this.executeVisceralRiposte(staggeredTarget);
      return;
    }

    // 1a. Mirage Flash Counter when attacking during active Mirage Slow Time!
    if (this.mirageSlowTimer > 0.05 && p.state !== 'attack') {
      this.mirageSlowTimer = 0;
      this.startPlayerAttack('mirage_flash_strike');
      this.vfx.spawnMagicLightRings(p.pos, 0x58e6ff, 0xffd700);
      this.onBanner('聚形一闪 MIRAGE FLASH COUNTER — HYPER-LUNGE CLEAVE!', '#58e6ff');
      return;
    }

    // 1b. Rapid-Response Dodge-Cancel Lunge Slash!
    if (p.state === 'dodge') {
      this.startPlayerAttack('sprint_dash_attack');
      this.onBanner('EVASIVE LUNGE CLEAVE!', '#58e6ff');
      return;
    }

    // 2. If currently in an attack, queue the next combo link
    if (p.state === 'attack') {
      if (p.attackDef?.next) p.queuedAttackId = p.attackDef.next;
      return;
    }
    if (p.stamina < 8) return;

    // 3. If sprinting -> trigger FF7 Remake Sprint Dash Attack!
    if (isSprinting || p.sprinting) {
      this.triggerSprintDashAttack(false);
      return;
    }

    // 4. If crouching -> trigger Rising Undercut from crouch!
    if (p.crouching) {
      p.crouching = false;
      this.triggerRisingUndercut();
      return;
    }

    // 5. Select combo starter based on Stance Mode (Punisher vs Operator) & 5 Weapon Styles
    if (p.stanceMode === 'punisher') {
      this.startPlayerAttack('punisher1');
    } else {
      const style = this.getWeaponStyle();
      const starter = STYLE_COMBO_STARTERS[style]?.light || 'great_cut_a';
      this.startPlayerAttack(starter);
    }
  }

  triggerHeavyAttack(isSprinting = false) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;

    if (!p.isGrounded && p.jumpOffsetY > 0.22 && p.state !== 'attack') {
      this.triggerLeapingSmash();
      return;
    }

    // Rapid-Response Dodge-Cancel Rising Launcher!
    if (p.state === 'dodge') {
      this.triggerRisingUndercut();
      return;
    }

    // Black Myth: Wukong "See-Through" (识破 / Resolute Counterflow) Varied Combo!
    // Pressing Heavy Attack [U] mid-Light-Combo weaves directly into Resolute Strike with See-Through i-frames!
    if (p.state === 'attack' && p.attackDef) {
      if (p.attackDef.id === 'resolute_counter') {
        p.queuedAttackId = 'skyfall_strike';
        return;
      }
      if (
        p.attackDef.flowKind === 'cut' ||
        p.attackDef.flowKind === 'thrust' ||
        p.attackDef.flowKind === 'light' ||
        p.attackDef.flowKind === 'dash'
      ) {
        p.seeThroughTimer = 0.38;
        p.iFrameTimer = Math.max(p.iFrameTimer, 0.34);
        this.startPlayerAttack('resolute_counter');
        const threat = this.detectImminentEnemyThreat(p.pos, 5.2);
        if (threat) {
          threat.attackDeflected = true;
          threat.pressuredTimer = Math.max(threat.pressuredTimer, 5.0);
          threat.poise = Math.min(threat.maxPoise, threat.poise + 65);
          p.focus = Math.min(p.maxFocus, p.focus + 1.0);
          p.limitGauge = Math.min(100, p.limitGauge + 25);
          p.queuedAttackId = 'skyfall_strike';
          sound.deflect(true);
          this.mirageSlowTimer = Math.max(this.mirageSlowTimer, 0.22);
          this.vfx.spawnMagicLightRings(p.pos, 0xffd700, 0xff4e2a);
          this.vfx.spawnShockwaveRing(p.pos, 4.2, 0xffd700);
          this.onBanner('识破 SEE-THROUGH COUNTERFLOW — PRESS [U] FOR SKYFALL STRIKE!', '#ffd700');
        } else {
          this.vfx.spawnShockwaveRing(p.pos, 2.8, 0xff9f40);
          this.onBanner('VARIED COMBO: RESOLUTE STRIKE (PRESS [U] FOR SKYFALL CLEAVE)!', '#ff9f40');
        }
        return;
      }
    }

    const style = this.getWeaponStyle();
    const heavyStarter =
      p.stanceMode === 'punisher'
        ? 'punisher1'
        : STYLE_COMBO_STARTERS[style]?.heavy || 'punisher1';

    if (p.state === 'attack') {
      if (p.attackDef?.flowKind === 'heavy' && p.attackDef?.next) {
        p.queuedAttackId = p.attackDef.next;
      } else {
        p.queuedAttackId = heavyStarter;
      }
      return;
    }
    if (p.stamina < 12) return;

    if (isSprinting || p.sprinting) {
      this.triggerSprintDashAttack(true);
      return;
    }

    this.startPlayerAttack(heavyStarter);
  }

  triggerSprintDashAttack(slideVariant = false) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    if (p.stamina < 12) return;
    const attackId = slideVariant ? 'sprint_slide_cleave' : 'sprint_dash_attack';
    this.startPlayerAttack(attackId);
    this.onBanner(
      slideVariant ? 'BUSTER SLIDE SWEEP!' : 'SPRINT DASH BUSTER CLEAVE!',
      '#58e6ff',
    );
  }

  triggerRisingUndercut() {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    const style = this.getWeaponStyle();
    const id = STYLE_COMBO_STARTERS[style]?.rising || (style === 'great' ? 'great_rising' : 'sword_rising');
    if (p.state === 'attack' && p.attackTime < (p.attackDef?.duration || 0.7) * 0.55) {
      p.queuedAttackId = id;
      return;
    }
    if (p.stamina < 12) return;
    this.startPlayerAttack(id);
    this.onBanner('RISING UNDERCUT LAUNCHER!', '#62f4ff');
  }

  triggerPiercingThrust() {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    const style = this.getWeaponStyle();
    const thrustId = style === 'staff' ? 'staff_heavy_1' : 'sword_thrust';
    if (p.state === 'attack' && p.attackTime < (p.attackDef?.duration || 0.7) * 0.55) {
      p.queuedAttackId = thrustId;
      return;
    }
    if (p.stamina < 12) return;
    this.startPlayerAttack(thrustId);
    this.onBanner('PIERCING NEEDLE THRUST!', '#7be0ff');
  }

  triggerGuardBreakKick() {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    if (p.state === 'attack' && p.attackTime < (p.attackDef?.duration || 0.7) * 0.45) {
      p.queuedAttackId = 'guard_break_kick';
      return;
    }
    if (p.stamina < 10) return;
    this.startPlayerAttack('guard_break_kick');
    this.vfx.spawnShockwaveRing(p.pos, 2.8, 0xff9f40);
    this.vfx.emitSparks(p.pos.clone().add(new THREE.Vector3(0, 0.95, 0)), null, 20, 0xff9f40, 0.95);
    this.onBanner('BUSTER HIGH GUARD-BREAK KICK!', '#ff9f40');
  }

  // Pigaloo Backhand Seam 180° Quick-Turn Counter ([B] Key)
  triggerBackhandSlash() {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    if (p.stamina < 10) return;
    // Rotate player 180° toward rear threat if no target locked in front, and grant counter i-frames!
    if (!this.lockedTarget || this.lockedTarget.isDead) {
      p.yaw = wrapAngle(p.yaw + Math.PI);
    }
    p.iFrameTimer = Math.max(p.iFrameTimer, 0.34);
    this.startPlayerAttack('backhand_turn_slash');
    this.vfx.emitSwordClash(p.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), null, 0xff9f40);
    this.onBanner('180° BACKHAND SEAM COUNTER!', '#ff9f40');
  }

  triggerLeapingSmash() {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    const style = this.getWeaponStyle();
    const airId = STYLE_COMBO_STARTERS[style]?.air || 'leaping_smash';
    if (p.state === 'attack' && p.attackTime < (p.attackDef?.duration || 0.7) * 0.45) {
      p.queuedAttackId = airId;
      return;
    }
    if (p.stamina < 12) return;
    if (!p.isGrounded) {
      p.airPlunging = true;
      p.velY = Math.min(p.velY, -12.5);
    } else {
      // Vaulting leap arc on grounded Leaping Plunge Smash!
      p.isGrounded = false;
      p.jumpOffsetY = Math.max(p.jumpOffsetY, 0.08);
      p.velY = 7.4;
      p.airTime = 0;
      p.airPlunging = true;
    }
    this.startPlayerAttack(airId);
    this.vfx.spawnShockwaveRing(p.pos, 3.2, 0xffd270);
    this.onBanner(`${PLAYER_ATTACKS[airId]?.label?.toUpperCase() || 'LEAPING PLUNGE CLEAVE'}!`, '#ffd270');
  }

  // Pro Magic Pack 3-Hit Arcane Spell Combo ([T] Key): Magic_1H_Attack_1 -> Magic_1H_Attack_2 -> Magic_2H_Attack_2 Beam!
  triggerArcaneSpellCombo() {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    if (p.state === 'attack') {
      const cur = p.attackDef?.id;
      if (cur === 'magic_bolt_1') p.queuedAttackId = 'magic_bolt_2';
      else if (cur === 'magic_bolt_2') p.queuedAttackId = 'magic_bolt_3';
      else p.queuedAttackId = 'magic_bolt_1';
      return;
    }
    if (p.stamina < 10) return;
    this.startPlayerAttack('magic_bolt_1');
    this.onBanner('ARCANE SPELL WEAVE — STARBOLT CHAIN!', '#9fffe6');
  }

  // Casts the currently attuned Grimoire Spell ([Y] Key) or a specific Grimoire spell index
  triggerGrimoireSpell(spellIndexOverride = null) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    if (spellIndexOverride !== null && GRIMOIRE_SPELLS[spellIndexOverride]) {
      p.selectedSpellIndex = spellIndexOverride;
    }
    const spellMeta = this.getSelectedSpell();
    const cost = spellMeta.costFocus || 0.5;
    if (p.focus < cost) {
      this.onBanner(
        `NEED ${cost} ATB / FOCUS BAR FOR ${spellMeta.name.toUpperCase()} — LAND SLASHES OR CAST [T] BOLTS!`,
        spellMeta.color,
      );
      return;
    }
    p.focus = Math.max(0, p.focus - cost);
    this.startPlayerAttack(spellMeta.id);
    this.vfx.spawnMagicLightRings(p.pos, spellMeta.colorHex, 0xffffff);
    this.onBanner(`GRIMOIRE INVOCATION: ${spellMeta.name.toUpperCase()}!`, spellMeta.color);
    this.onStateChange();
  }

  // FF7 Remake ATB / Focus Abilities (Slot 1 = Braver, Slot 2 = Focused Thrust, Slot 3 = Infinity Spin, Slot 4 = Arcane Surge)
  triggerWeaponSkill(slot = 1) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    if (p.focus < 1.0) {
      this.onBanner('NEED 1 ATB / FOCUS BAR — LAND SLASHES, PARRY, OR MIRAGE DODGE!', '#7be0ff');
      return;
    }

    p.focus = Math.max(0, p.focus - 1.0);
    p.focusBarsSpent = 1;

    const skillMap = {
      1: 'braver',
      2: 'focused_thrust',
      3: 'infinity_spin',
      4: 'arcane_surge',
    };
    const skillId = skillMap[slot] || 'braver';
    this.startPlayerAttack(skillId);
    const def = PLAYER_ATTACKS[skillId];
    this.vfx.spawnMagicLightRings(p.pos, 0x58e6ff, 0xffd270);
    this.onBanner(`ATB SKILL: ${def.label.toUpperCase()}!`, '#54f0ff');
    this.onStateChange();
  }

  triggerFocusStrike() {
    this.triggerWeaponSkill(1);
  }

  triggerLimitBreak() {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger') return;
    if (p.limitGauge < 100 && p.focus < 2.0) {
      this.onBanner(`LIMIT GAUGE ${Math.floor(p.limitGauge)}% — FILL TO 100% FOR CROSS-SLASH!`, '#ff9f40');
      return;
    }
    if (p.limitGauge >= 100) {
      p.limitGauge = 0;
    } else {
      p.focus = Math.max(0, p.focus - 2.0);
    }
    p.iFrameTimer = 1.35; // Invulnerable during Limit Break!
    this.startPlayerAttack('limit_cross_slash');
    this.vfx.spawnMagicLightRings(p.pos, 0xffd700, 0x58e6ff);
    this.vfx.spawnShockwaveRing(p.pos, 6.2, 0xffd700);
    this.cameraShake = 0.48;
    this.onBanner('LIMIT BREAK UNLEASHED — CROSS-SLASH!', '#ffd700');
    this.onStateChange();
  }

  startPlayerAttack(attackId) {
    const p = this.player;
    const def = PLAYER_ATTACKS[attackId];
    if (!def) return;
    const wSpec = WEAPON_CATALOG[p.weaponId] || WEAPON_CATALOG.buster_sword;

    p.crouching = false;
    p.state = 'attack';
    p.attackId = attackId;
    p.attackDef = def;
    p.attackTime = 0;
    p.attackHitSet.clear();
    p.attackEffectFired = false;
    p.crescentSlashFired = false;
    p.queuedAttackId = null;
    p.lastMoveName = def.label || def.id;
    p.stamina = Math.max(
      0,
      p.stamina - (def.stamina || 14) * (this.getDifficulty().staminaCostMult || 1.0),
    );
    p.swingAltDir = p.swingAltDir === 1 ? -1 : 1;
    if (p.puppet) {
      p.puppet.swingState = {
        active: !def.isSpell,
        frac: 0,
        dir: p.swingAltDir,
        overhead: Boolean(def.heavyImpact || def.flowKind === 'heavy' || def.flowKind === 'leap'),
      };
    }

    if (def.isSpell) {
      // Spawn Concentric Runic Rings of Light around the player as magic channeling begins!
      this.vfx.spawnMagicLightRings(p.pos, wSpec.color || 0x7be0ff, 0xc6a4ff);
    } else if (this.vfx?.sandbox) {
      // Elemental Sandbox VFX adaptations for Weapon Specials, Limit Break & Counterflows!
      const fwdPos = p.pos.clone().add(new THREE.Vector3(-Math.sin(p.yaw) * 2.2, 0, -Math.cos(p.yaw) * 2.2));
      if (attackId === 'braver' || attackId === 'skyfall_strike' || attackId === 'pillar_churn_slam') {
        const pCol = attackId === 'skyfall_strike' ? 0xff5a26 : attackId === 'pillar_churn_slam' ? 0x55ff99 : 0x58e6ff;
        this.vfx.sandbox.spawnCelestialRend(fwdPos, pCol, 0xffd700, 4.2, 0.95);
      } else if (attackId === 'limit_cross_slash') {
        this.vfx.sandbox.spawnCelestialRend(fwdPos, 0xffd700, 0x58e6ff, 5.2, 1.25);
        this.vfx.sandbox.spawnLinearVoidSlash(p.pos, p.yaw, 12.0, 0xffd700);
      } else if (attackId === 'focused_thrust' || attackId === 'sword_thrust') {
        this.vfx.sandbox.spawnLinearVoidSlash(p.pos, p.yaw, 9.5, wSpec.color || 0x58e6ff);
      } else if (attackId === 'infinity_spin' || attackId === 'resolute_counter' || attackId === 'mirage_flash_strike') {
        this.vfx.sandbox.spawnMetallicCausticClash(p.pos, wSpec.color || 0xffd700, 1.35);
      }
    }

    // Pigaloo Prismatic Flow Combo Tracker:
    // Reward chaining 3 distinct attack families (e.g. cut -> rising -> thrust/leap/heavy/spell)
    if (def.flowKind) {
      if (p.flowTimer <= 0) p.flowHistory = [];
      const lastKind = p.flowHistory[p.flowHistory.length - 1];
      if (lastKind !== def.flowKind) {
        p.flowHistory.push(def.flowKind);
        if (p.flowHistory.length > 3) p.flowHistory.shift();
      }
      p.flowTimer = 3.2;
      p.flowCount = p.flowHistory.length;
    }

    // Snap facing toward locked target or nearest enemy within 11m (or 16m for spells)
    const snapRange = def.isSpell ? 16.5 : 8.5;
    const snapTarget =
      this.lockedTarget && !this.lockedTarget.isDead
        ? this.lockedTarget
        : this.findNearestAliveEnemy(snapRange);
    if (snapTarget && attackId !== 'backhand_turn_slash') {
      const dx = snapTarget.pos.x - p.pos.x;
      const dz = snapTarget.pos.z - p.pos.z;
      p.yaw = Math.atan2(-dx, -dz);
    }

    // Pro Magic Pack clips have longer raw durations (~2.2s - 4.2s), so scale playback rate so they match def.duration!
    const rawClipDur = this.animStore.duration(def.clip) || def.duration;
    const baseRate =
      rawClipDur > def.duration * 1.15
        ? rawClipDur / def.duration
        : (wSpec.speedMult || 1.0) * (def.isLimitBreak ? 1.18 : 1.12);
    p.attackBaseRate = baseRate;
    p.puppet.play(def.clip, { loop: false, rate: baseRate, fade: 0.06, forceReset: true });
    sound.swing(!!def.heavyImpact);
    this.onStateChange();
  }

  /**
   * Ported from tartarus/src/combat/ff/swing-feel.js:
   * Non-linear sword swing pacing curve (wind-up -> coil anticipation -> razor-fast snap through cut -> follow-through).
   */
  computeSwingPace(frac, hitWindow = [0.24, 0.54], heavyImpact = false) {
    const [hStart, hEnd] = hitWindow;
    const coilStart = hStart * 0.62;
    if (frac < coilStart) return 0.92;
    if (frac < hStart) return heavyImpact ? 0.62 : 0.74;
    if (frac <= hEnd) return heavyImpact ? 1.72 : 1.56;
    if (frac <= hEnd + 0.16) return 1.18;
    return 0.98;
  }

  executeVisceralRiposte(enemy) {
    const p = this.player;
    p.yaw = Math.atan2(-(enemy.pos.x - p.pos.x), -(enemy.pos.z - p.pos.z));
    const style = this.getWeaponStyle();
    const fatalId =
      style === 'great' || style === 'katana' || style === 'staff'
        ? 'fatal_riposte_2h'
        : 'fatal_riposte_1h';
    p.iFrameTimer = 1.05;
    this.startPlayerAttack(fatalId);
    const riposteDmg = this.scalePlayerDamage(
      Math.round(235 * (WEAPON_CATALOG[p.weaponId]?.damageMult || 1.25) * enemy.armorCrack),
    );
    enemy.hp = Math.max(0, enemy.hp - riposteDmg);
    enemy.poise = 0;
    enemy.staggerTimer = 0;
    enemy.state = 'idle';
    p.limitGauge = Math.min(100, p.limitGauge + 25);
    p.focus = Math.min(p.maxFocus, p.focus + 0.75);
    sound.hit(true, true);
    this.vfx.emitSwordClash(
      enemy.pos.clone().add(new THREE.Vector3(0, 1.2, 0)),
      null,
      0xff3b30,
    );
    this.vfx.spawnShockwaveRing(enemy.pos, 5.2, 0xffd270);
    this.cameraShake = 0.45;
    this.onBanner(`VISCERAL FATAL EXECUTION — ${riposteDmg} CRITICAL DMG!`, '#ff4e2a');
    if (enemy.hp <= 0) {
      this.handleEnemyDeath(enemy, PLAYER_ATTACKS[fatalId]);
    } else {
      enemy.puppet.play('rpg2HandBaseFatalHit1', { loop: false, rate: 1.15, fade: 0.05, forceReset: true });
    }
  }

  triggerDodge(moveInputVec) {
    const p = this.player;
    if (p.state === 'dead' || (p.state === 'stagger' && p.staggerTimer > 0.16)) return;
    if (p.stamina < 10) return;

    p.crouching = false;
    p.staggerTimer = 0;
    if (p.puppet?.swingState) p.puppet.swingState.active = false;
    p.stamina = Math.max(0, p.stamina - 12 * (this.getDifficulty().staminaCostMult || 1.0));

    // Check if an enemy has an active or imminent hitbox within 165ms for PERFECT DODGE (Mirage Step) or MIKIRI THRUST COUNTER!
    const incomingThreat = this.detectImminentEnemyThreat(p.pos, 4.8);
    if (incomingThreat && incomingThreat.attackMove?.perilous === 'thrust') {
      // Shinobi Duel MIKIRI COUNTER (看破): Stepping into a Perilous Thrust stomps the enemy blade!
      incomingThreat.attackDeflected = true;
      incomingThreat.attackHitPlayer = true;
      incomingThreat.pressuredTimer = 6.0;
      const mikiriPoise = Math.round(incomingThreat.maxPoise * 0.44);
      incomingThreat.poise = Math.min(incomingThreat.maxPoise, incomingThreat.poise + mikiriPoise);
      incomingThreat.hp = Math.max(0, incomingThreat.hp - this.scalePlayerDamage(165));
      p.iFrameTimer = 0.65;
      p.focus = Math.min(p.maxFocus, p.focus + 1.0);
      p.limitGauge = Math.min(100, p.limitGauge + 30);
      this.mirageSlowTimer = 0.42;
      sound.deflect(true);
      this.cameraShake = 0.42;
      this.vfx.emitSwordClash(incomingThreat.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), null, 0xff3b30);
      this.vfx.sandbox?.spawnCelestialRend(incomingThreat.pos, 0xff3b30, 0xffd700, 3.8, 0.90);
      this.onBanner(`看破 MIKIRI THRUST COUNTER — ${incomingThreat.name.toUpperCase()} BLADE STOMPED!`, '#ffd700');
      if (incomingThreat.hp <= 0) {
        this.handleEnemyDeath(incomingThreat, PLAYER_ATTACKS.guard_break_kick);
      } else if (incomingThreat.poise >= incomingThreat.maxPoise) {
        incomingThreat.poise = 0;
        incomingThreat.state = 'stagger';
        incomingThreat.staggerTimer = 3.4;
        incomingThreat.attackMove = null;
        incomingThreat.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
      }
      this.onStateChange();
    } else if (incomingThreat) {
      // MIRAGE STEP TRIGGERED!
      sound.mirageStep();
      this.mirageSlowTimer = 0.40; // 0.3x global time dilation for 400ms
      p.iFrameTimer = 0.54;
      p.focus = Math.min(p.maxFocus, p.focus + 1.0);
      p.limitGauge = Math.min(100, p.limitGauge + 25);
      this.vfx.spawnMirage(p.puppet, p.pos, p.yaw);
      this.vfx.spawnMagicLightRings(p.pos, 0x38f2ff, 0xffffff);
      this.vfx.spawnShockwaveRing(p.pos, 3.8, 0x38f2ff);
      this.onBanner('MIRAGE STEP — PERFECT DODGE (+1 FOCUS & +25% LIMIT)', '#38f2ff');
      this.onStateChange();
    } else {
      p.iFrameTimer = 0.30;
    }

    p.state = 'dodge';
    p.attackDef = null;
    p.dodgeTimer = 0.36;
    let rollClip = 'rpgBaseRollF';

    if (moveInputVec && moveInputVec.lengthSq() > 0.01) {
      p.dodgeDir.copy(moveInputVec).normalize();
      if (this.lockedTarget && !this.lockedTarget.isDead) {
        // Directional 4-way dodge roll / sidestep while locked on!
        const dx = this.lockedTarget.pos.x - p.pos.x;
        const dz = this.lockedTarget.pos.z - p.pos.z;
        p.yaw = Math.atan2(-dx, -dz);
        const fwdVec = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        const rightVec = new THREE.Vector3(-fwdVec.z, 0, fwdVec.x);
        const fDot = p.dodgeDir.dot(fwdVec);
        const rDot = p.dodgeDir.dot(rightVec);
        if (Math.abs(rDot) > Math.abs(fDot)) {
          rollClip = rDot > 0 ? 'rpgBaseRollR' : 'rpgBaseRollL';
        } else if (fDot < -0.2) {
          rollClip = 'rpgBaseRollB';
        }
      } else {
        p.yaw = Math.atan2(-p.dodgeDir.x, -p.dodgeDir.z);
      }
    } else if (this.lockedTarget && !this.lockedTarget.isDead) {
      // Backstep roll away from locked enemy when no direction held
      p.dodgeDir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      rollClip = 'rpgBaseRollB';
    } else {
      p.dodgeDir.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    }

    p.lastMoveName = incomingThreat ? 'MIRAGE STEP' : 'EVASIVE ROLL';
    p.puppet.play(rollClip, { loop: false, rate: 1.52, fade: 0.05, forceReset: true });

    if (this.world.injectWaterRipple(p.pos, 1.35)) {
      this.vfx.emitWaterDroplets(p.pos, 18);
      sound.waterStep();
    }
  }

  setGuardHeld(held) {
    const p = this.player;
    if (p.state === 'dead' || (p.state === 'stagger' && p.staggerTimer > 0.16)) return;
    if (held) {
      // Rapid-response Slayer/Sekiro parry cancel: allow guard cancel from idle, move, dodge, stagger recovery, or attack!
      const canCancelAttack = p.state === 'attack';
      if (
        p.state === 'idle' ||
        p.state === 'move' ||
        p.state === 'stagger' ||
        (p.state === 'dodge' && p.dodgeTimer < 0.24) ||
        canCancelAttack
      ) {
        // Shinobi Duel Anti-Mash Deflect Decay: re-pressing block within 0.50s shrinks the deflect window
        if ((p.combatClock || 0) - (p.lastGuardReleaseTime || -10) < 0.50) {
          p.deflectMashCount = Math.min(4, (p.deflectMashCount || 0) + 1);
        } else {
          p.deflectMashCount = 0;
        }
        const decayTable = [0.22, 0.22, 0.18, 0.14, 0.10];
        p.deflectWindow = this.getDeflectWindow(decayTable[p.deflectMashCount] || 0.18);
        p.crouching = false;
        p.staggerTimer = 0;
        if (p.puppet?.swingState) p.puppet.swingState.active = false;
        p.state = 'guard';
        p.attackDef = null;
        p.guardTimer = 0.0;
        p.puppet.play(this.getGuardClip(), { loop: true, fade: 0.05 });
      }
    } else if (p.state === 'guard') {
      p.lastGuardReleaseTime = p.combatClock || 0;
      p.state = 'idle';
    }
  }

  triggerHealGourd() {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'stagger' || p.state === 'heal') return;
    if (p.gourds <= 0) {
      this.onBanner('CRIMSON GOURD EMPTY — REST AT A SHRINE', '#ff5252');
      return;
    }
    p.gourds--;
    p.state = 'heal';
    p.healTimer = 0.65;
    p.hp = Math.min(p.maxHp, p.hp + this.scalePlayerHealing(Math.round(p.maxHp * 0.48)));
    p.stamina = Math.min(p.maxStamina, p.stamina + this.scalePlayerHealing(45));
    // Play Pigaloo's Cast_Mend (Mending Knot) animation on heal!
    p.puppet.play('Cast_Mend', { loop: false, rate: 2.2, fade: 0.08, forceReset: true });
    sound.shrine();
    this.vfx.spawnShockwaveRing(p.pos, 2.8, 0xffe8a0);
    this.vfx.emitSparks(p.pos.clone().add(new THREE.Vector3(0, 1.0, 0)), null, 24, 0xffe8a0, 0.9);
    this.onStateChange();

    // Section 5.3 Directive: Estus / Heal Input Reading!
    for (const enc of this.encounters) {
      if (!enc.engaged || enc.cleared) continue;
      for (const f of enc.fighters) {
        if (f.isDead || f.state === 'stagger' || f.state === 'attack') continue;
        const dist = f.pos.distanceTo(p.pos);
        if (dist < 13.5) {
          if (f.rangedCaster) {
            this.fireEnemyProjectile(f, p.pos);
          } else {
            this.startEnemyAttack(f, ENEMY_MOVES.gapCloserThrust);
          }
          this.onBanner(`${f.name.toUpperCase()} READ YOUR HEAL — INCOMING LUNGE!`, '#ff9f40');
        }
      }
    }
  }

  toggleLockOn() {
    if (this.lockedTarget && !this.lockedTarget.isDead) {
      if (this.lockedTarget.height >= 2.8 && this.lockedTarget.hurtboxes?.length === 4) {
        this.lockedSocketIndex = ((this.lockedSocketIndex ?? 0) + 1);
        if (this.lockedSocketIndex < 4) {
          const hb = this.lockedTarget.hurtboxes[this.lockedSocketIndex];
          this.onBanner(
            `TARGET SOCKET: ${this.lockedTarget.name.toUpperCase()} — [${hb.label}]`,
            hb.isWeakPoint ? '#ffd700' : '#58e6ff',
          );
          return;
        }
      }
      this.lockedTarget = null;
      this.lockedSocketIndex = 0;
      return;
    }
    this.lockedTarget = this.findNearestAliveEnemy(24.0);
    if (this.lockedTarget) {
      // Default to nearest ankle for towering bosses (> 3.2m), or torso for humanoid enemies
      this.lockedSocketIndex = this.lockedTarget.height >= 3.2 ? 0 : 2;
      if (this.lockedTarget.height >= 2.8 && this.lockedTarget.hurtboxes?.length === 4) {
        const hb = this.lockedTarget.hurtboxes[this.lockedSocketIndex];
        this.onBanner(
          `LOCKED ON: ${this.lockedTarget.name.toUpperCase()} [${hb.label}] (PRESS [G] TO CYCLE LIMBS)`,
          '#58e6ff',
        );
      }
    }
  }

  getLockedTargetWorldPos() {
    if (!this.lockedTarget || this.lockedTarget.isDead) return null;
    const t = this.lockedTarget;
    if (t.hurtboxes && t.hurtboxes.length === 4) {
      const idx = THREE.MathUtils.clamp(this.lockedSocketIndex ?? 2, 0, 3);
      return t.hurtboxes[idx].pos.clone().add(new THREE.Vector3(0, t.hurtboxes[idx].height * 0.45, 0));
    }
    return t.pos.clone().add(new THREE.Vector3(0, t.height * 0.55, 0));
  }

  findNearestAliveEnemy(maxDist = 20.0) {
    let best = null;
    let bestD = maxDist;
    for (const enc of this.encounters) {
      if (enc.cleared) continue;
      for (const f of enc.fighters) {
        if (f.isDead) continue;
        const d = f.pos.distanceTo(this.player.pos);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
    }
    return best;
  }

  detectImminentEnemyThreat(playerPos, radius = 4.4) {
    for (const enc of this.encounters) {
      if (!enc.engaged || enc.cleared) continue;
      for (const f of enc.fighters) {
        if (f.isDead || f.state !== 'attack' || !f.attackMove) continue;
        const d = f.pos.distanceTo(playerPos);
        if (d > radius + f.weaponMount.obb.halfLength * 2) continue;
        const frac = f.attackTime / f.attackMove.duration;
        const [hStart, hEnd] = f.attackMove.hitWindow;
        if (frac >= hStart - 0.16 && frac <= hEnd + 0.04) {
          return f;
        }
      }
    }
    return null;
  }

  // --- Main Frame Step ---
  update(dt, inputState) {
    const p = this.player;
    p.combatClock = (p.combatClock || 0) + dt;
    if (p.deflectChainTimer > 0) {
      p.deflectChainTimer = Math.max(0, p.deflectChainTimer - dt);
      if (p.deflectChainTimer <= 0) p.deflectChain = 0;
    }

    // 1. Update Mirage Step time-dilation, Elemental Imbue Timer, Flow Timer & camera FX timers
    if (this.mirageSlowTimer > 0) {
      this.mirageSlowTimer = Math.max(0, this.mirageSlowTimer - dt);
    }
    if (p.seeThroughTimer > 0) {
      p.seeThroughTimer = Math.max(0, p.seeThroughTimer - dt);
    }
    if (p.imbueTimer > 0) {
      p.imbueTimer = Math.max(0, p.imbueTimer - dt);
      p.imbueSparkAccum += dt;
      if (p.imbueSparkAccum >= 0.08 && p.weaponMount) {
        p.imbueSparkAccum = 0;
        this.vfx.emitSparks(p.weaponMount.obb.center, null, 2, p.imbueColor, 0.45);
      }
      if (p.imbueTimer <= 0) {
        const wSpec = WEAPON_CATALOG[p.weaponId] || WEAPON_CATALOG.buster_sword;
        p.bladeTrail.setColor(wSpec.color);
      }
    }
    if (p.flowTimer > 0) {
      p.flowTimer = Math.max(0, p.flowTimer - dt);
      if (p.flowTimer <= 0) {
        p.flowHistory = [];
        p.flowCount = 0;
      }
    }
    const worldTimeScale = this.mirageSlowTimer > 0 ? 0.30 : 1.0;
    const enemyDt = dt * worldTimeScale;

    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 2.4);
    if (this.chromaticPulse > 0) this.chromaticPulse = Math.max(0, this.chromaticPulse - dt * 2.8);
    if (p.iFrameTimer > 0) p.iFrameTimer = Math.max(0, p.iFrameTimer - dt);

    // 2. Step Player State Machine & Vertical Jump Physics
    this.stepPlayer(dt, inputState);

    // 3. Enforce Physical Fighter Capsule Separation & Triple-Lock Corridor + Solid Obstacle Clamping
    this.resolveFighterCapsuleSeparation();
    const playerLoc = this.spine.clampPositionToCorridor(
      p.pos,
      p.radius,
      this.encounters,
      p.jumpOffsetY,
      this.world.solidObstacles,
      p.vel,
    );
    p.puppet.root.position.copy(p.pos);
    p.puppet.root.rotation.y = p.yaw;
    p.puppet.body.rotation.z = p.bodyBankRoll;
    p.puppet.body.rotation.x = p.bodyPitchLean;

    // Player weapon glint during attack startup or Elemental Blade Imbue
    let playerGlint = p.imbueTimer > 0 ? 0.65 : 0;
    let playerGlintColor = p.imbueTimer > 0 ? p.imbueColor : null;
    let playerBladeActive = false;
    let attackRateOverride = null;
    if (p.state === 'attack' && p.attackDef) {
      const frac = p.attackTime / p.attackDef.duration;
      const [hStart, hEnd] = p.attackDef.hitWindow;
      if (frac < hStart) playerGlint = 0.85;
      else if (frac >= hStart && frac <= hEnd) {
        playerGlint = 1.0;
        playerBladeActive = true;
      }
      if (!p.attackDef.isSpell) {
        const pace = this.computeSwingPace(frac, p.attackDef.hitWindow, !!p.attackDef.heavyImpact);
        attackRateOverride = (p.attackBaseRate || 1.08) * pace;
      }
    }
    let flipPitch = 0;
    if (!p.isGrounded && p.flipTimer > 0 && p.flipDur > 0) {
      const t = THREE.MathUtils.clamp(1 - p.flipTimer / p.flipDur, 0, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      flipPitch = (0.35 * t + 0.65 * eased) * Math.PI * 2;
    }

    // Compute Pigaloo Knee-Bend Squash & High Left-Leg Kick Lift IK options
    let kneeBendSquash = 0;
    let kickLift = 0;
    let strideLean = 0;
    if (p.jumpWindup > 0) {
      kneeBendSquash = Math.sin((p.jumpWindup / 0.072) * Math.PI * 0.5) * 0.24;
    } else if (!p.isGrounded && p.flipTimer > 0 && p.flipDur > 0) {
      kneeBendSquash = Math.sin(THREE.MathUtils.clamp(1 - p.flipTimer / p.flipDur, 0, 1) * Math.PI) * 0.24;
    } else if (p.landRecoveryTimer > 0) {
      const maxLandDur = p.hardLanding ? 0.28 : 0.18;
      kneeBendSquash =
        Math.sin(THREE.MathUtils.clamp(p.landRecoveryTimer / maxLandDur, 0, 1) * Math.PI) *
        (p.hardLanding ? 0.26 : 0.18);
    } else if (p.crouching) {
      kneeBendSquash = 0.22;
    } else if (p.state === 'attack' && p.attackDef) {
      const frac = p.attackTime / p.attackDef.duration;
      if (p.attackId === 'guard_break_kick' || p.attackDef.breaksGuard) {
        kickLift = Math.sin(THREE.MathUtils.clamp((frac - 0.05) / 0.62, 0, 1) * Math.PI);
        strideLean = -0.22 * kickLift;
        kneeBendSquash = 0.07;
      } else if (p.attackDef.flowKind === 'counter' || p.attackDef.flowKind === 'heavy') {
        kneeBendSquash = 0.095 * Math.sin(THREE.MathUtils.clamp(frac, 0, 1) * Math.PI);
        strideLean = 0.09 * Math.sin(THREE.MathUtils.clamp(frac, 0, 1) * Math.PI);
      } else {
        kneeBendSquash = 0.05;
        strideLean = 0.055 * Math.sin(THREE.MathUtils.clamp(frac, 0, 1) * Math.PI);
      }
    } else if (p.isGrounded) {
      if (p.state === 'move') {
        const turnFlex = Math.min(0.085, Math.abs(p.turnRate || 0) * 0.016);
        kneeBendSquash = 0.055 + turnFlex;
      } else if (p.state === 'guard') {
        kneeBendSquash = 0.085;
      } else {
        kneeBendSquash = 0.038;
      }
    }

    p.puppet.update(dt, attackRateOverride, flipPitch, {
      kneeBendSquash,
      kickLift,
      strideLean,
      turnBank: p.bodyBankRoll * 0.35,
    });
    p.weaponMount?.sync(
      p.flipTimer > 0 ? Math.max(playerGlint, 0.85) : p.seeThroughTimer > 0 ? 1.0 : playerGlint,
      p.flipTimer > 0 ? 0x58e6ff : p.seeThroughTimer > 0 ? 0xffd700 : playerGlintColor,
    );
    if (p.weaponMount) {
      // Vertical aim-pitch compensation when swinging at low Tier-1 Swarm enemies (< 1.45m)
      const nearTarget = this.lockedTarget && !this.lockedTarget.isDead ? this.lockedTarget : this.findNearestAliveEnemy(3.6);
      if (playerBladeActive && nearTarget && nearTarget.height < 1.45) {
        p.weaponMount.obb.basePos.y -= 0.32;
        p.weaponMount.obb.tipPos.y -= 0.32;
        p.weaponMount.obb.center.y -= 0.32;
      }
      const trailActive = playerBladeActive || p.imbueTimer > 0 || p.flipTimer > 0;
      p.bladeTrail.update(
        dt,
        p.weaponMount.obb.basePos,
        p.weaponMount.obb.tipPos,
        trailActive,
        playerBladeActive
          ? p.attackDef?.isLimitBreak || p.attackDef?.flowKind === 'skill'
            ? 1.85
            : 1.15
          : p.flipTimer > 0
          ? 0.95
          : 0.35,
      );
      if (playerBladeActive) {
        this.world.injectWaterRipple(p.weaponMount.obb.tipPos, 0.9);
      }
    }

    // 4. Evaluate Player Weapon OBB & AoE Skills vs Active Enemies & Destructible Pillars
    if (playerBladeActive && p.weaponMount) {
      this.checkPlayerBladeCollisions();
    }

    // 5. Step All Encounters, Obsidian Fog Seals & Lethal Guard AI
    this.stepEncounters(enemyDt, dt, playerLoc);

    // 6. Step Projectiles & Sync to InstancedMesh (Zero runtime allocation!)
    this.stepProjectiles(enemyDt);

    return {
      playerLoc,
      activeBoss: this.getActiveBoss(),
      nearestShrine: this.getNearestShrine(),
    };
  }

  resolveFighterCapsuleSeparation() {
    const p = this.player;
    if (p.state === 'dead' || p.jumpOffsetY > 1.35) return;
    for (const enc of this.encounters) {
      if (enc.cleared) continue;
      for (const e of enc.fighters) {
        if (e.isDead) continue;
        // For Giant / Colossal enemies (>= 3.0m) standing upright, separate against Left & Right Ankles
        // so the player can roll and dash between a colossal boss's legs!
        if (e.height >= 3.0 && e.hurtboxes?.length === 4 && !(e.state === 'stagger' && e.staggerTimer > 1.6)) {
          for (let legIdx = 0; legIdx < 2; legIdx++) {
            const legHb = e.hurtboxes[legIdx];
            const dx = p.pos.x - legHb.pos.x;
            const dz = p.pos.z - legHb.pos.z;
            const distSq = dx * dx + dz * dz;
            const minDist = p.radius + legHb.radius * 0.92;
            if (distSq > 1e-6 && distSq < minDist * minDist) {
              const dist = Math.sqrt(distSq);
              const overlap = minDist - dist;
              p.pos.x += (dx / dist) * overlap * 0.85;
              p.pos.z += (dz / dist) * overlap * 0.85;
            }
          }
          continue;
        }
        const dx = p.pos.x - e.pos.x;
        const dz = p.pos.z - e.pos.z;
        const distSq = dx * dx + dz * dz;
        const minDist = p.radius + e.radius * 0.78;
        if (distSq > 1e-6 && distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          p.pos.x += nx * overlap * 0.7;
          p.pos.z += nz * overlap * 0.7;
          if (!e.isBoss) {
            e.pos.x -= nx * overlap * 0.3;
            e.pos.z -= nz * overlap * 0.3;
          }
        }
      }
    }
  }

  resolvePlungeLandingImpact() {
    const p = this.player;
    if (p.state === 'attack' && p.attackDef) {
      p.attackTime = Math.max(p.attackTime, p.attackDef.duration - 0.14);
    }
    p.hardLanding = true;
    p.landRecoveryTimer = 0.24;
    sound.hit(true, true);
    this.cameraShake = Math.max(this.cameraShake, 0.38);
    this.vfx.spawnShockwaveRing(p.pos, 5.2, 0xffd270);
    this.vfx.emitSwordClash(p.pos.clone().add(new THREE.Vector3(0, 0.35, 0)), null, 0xffd270);
    if (this.world.injectWaterRipple(p.pos, 1.85)) {
      this.vfx.emitWaterDroplets(p.pos, 26);
      sound.waterStep();
    }

    const wSpec = WEAPON_CATALOG[p.weaponId] || WEAPON_CATALOG.buster_sword;
    for (const enc of this.encounters) {
      if (enc.cleared) continue;
      for (const e of enc.fighters) {
        if (e.isDead) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d <= 4.2 + e.radius) {
          enc.engaged = true;
          const plungeDmg = this.scalePlayerDamage(Math.round(88 * (wSpec.damageMult || 1.25)));
          const plungePoise = Math.round(72 * (wSpec.poiseMult || 1.25));
          e.hp = Math.max(0, e.hp - plungeDmg);
          e.poise = Math.min(e.maxPoise, e.poise + plungePoise);
          p.focus = Math.min(p.maxFocus, p.focus + 0.40);
          p.limitGauge = Math.min(100, p.limitGauge + 15);
          if (e.hp <= 0) {
            this.handleEnemyDeath(e, PLAYER_ATTACKS.leaping_smash);
          } else if (e.poise >= e.maxPoise) {
            e.poise = 0;
            e.state = 'stagger';
            e.staggerTimer = 3.2;
            e.attackMove = null;
            e.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
            this.onBanner('PLUNGE IMPACT — POSTURE BROKEN!', '#ff4e2a');
          } else if (e.state !== 'attack') {
            e.puppet.play('Hurt_Large_Front', { loop: false, rate: 1.2, fade: 0.05, forceReset: true });
          }
        }
      }
    }
    this.onStateChange();
  }

  stepPlayerVerticalPhysics(dt) {
    const p = this.player;
    if (p.landRecoveryTimer > 0) {
      p.landRecoveryTimer = Math.max(0, p.landRecoveryTimer - dt);
    }
    if (p.sprintStartTimer > 0) {
      p.sprintStartTimer = Math.max(0, p.sprintStartTimer - dt);
    }
    if (p.runStopTimer > 0) {
      p.runStopTimer = Math.max(0, p.runStopTimer - dt);
    }
    if (p.flipTimer > 0) {
      p.flipTimer = Math.max(0, p.flipTimer - dt);
    }
    if (p.jumpWindup > 0) {
      p.jumpWindup = Math.max(0, p.jumpWindup - dt);
      if (p.jumpWindup > 0) return;
    }

    if (!p.isGrounded) {
      p.airTime += dt;
      // During a grounded Leaping Smash (GS_Jump_Attack), allow the vault to rise during early windup before plunging!
      const isVaultAscending =
        p.airPlunging &&
        p.state === 'attack' &&
        p.attackDef?.flowKind === 'leap' &&
        p.attackTime < p.attackDef.duration * 0.36;
      const gravity = isVaultAscending ? 18.5 : p.airPlunging ? 36.0 : p.velY < 0 ? 23.5 : 19.5;
      p.velY -= gravity * dt;
      p.jumpOffsetY += p.velY * dt;

      if (p.jumpOffsetY <= 0 && !isVaultAscending) {
        const impactVelY = p.velY;
        p.jumpOffsetY = 0;
        p.velY = 0;
        p.isGrounded = true;
        p.airJumpsUsed = 0;
        p.flipTimer = 0;

        if (p.airPlunging) {
          p.airPlunging = false;
          this.resolvePlungeLandingImpact();
        } else {
          p.hardLanding = impactVelY < -10.8;
          p.landRecoveryTimer = p.hardLanding ? 0.28 : 0.18;
          if (p.hardLanding) {
            this.vfx.spawnShockwaveRing(p.pos, 1.85, 0x8ad8ff);
          }
          if (this.world.injectWaterRipple(p.pos, 1.25)) {
            this.vfx.emitWaterDroplets(p.pos, 14);
            sound.waterStep();
          }
        }
      }
    }
  }

  stepPlayer(dt, input) {
    const p = this.player;
    if (p.state === 'dead') return;

    this.stepPlayerVerticalPhysics(dt);

    const mv = input.moveVec;
    const hasMoveInput = mv.lengthSq() > 0.01;
    p.sprinting = !!(input.sprint && hasMoveInput && p.stamina > 5 && !p.crouching);

    if (p.state !== 'attack' && p.puppet?.swingState) {
      p.puppet.swingState.active = false;
    }

    // Track Idle -> Run / Sprint start and Run -> Idle stop transitions
    const prevSpeedSq = p.vel.x * p.vel.x + p.vel.z * p.vel.z;
    if (hasMoveInput && !p.wasMoving && p.isGrounded) {
      p.sprintStartTimer = 0.20;
    } else if (p.sprinting && !p.wasSprinting && p.isGrounded) {
      p.sprintStartTimer = 0.20;
    }
    if (!hasMoveInput && p.wasMoving && p.isGrounded && prevSpeedSq > 10.0) {
      p.runStopTimer = 0.20;
    }
    if (hasMoveInput) {
      // Never freeze legs with Land or Run_Stop recovery clips when player is actively holding WASD!
      p.runStopTimer = 0;
      if (!p.hardLanding) p.landRecoveryTimer = 0;
    }
    p.wasMoving = hasMoveInput;
    p.wasSprinting = p.sprinting;

    // Stamina regen when not attacking, dodging, or sprinting
    if (p.state === 'idle' || p.state === 'move' || p.state === 'guard') {
      let regenRate = p.state === 'guard' ? 18 : p.sprinting ? -5 : 42;
      if (regenRate > 0) regenRate *= this.getDifficulty().staminaRegenMult || 1.0;
      p.stamina = Math.max(0, Math.min(p.maxStamina, p.stamina + regenRate * dt));
    }

    // Smoothly reset body lean during non-locomotion states (except subtle lunge lean during attack)
    if (p.state !== 'move' && p.state !== 'idle') {
      p.turnRate = 0;
      const atkLean = p.state === 'attack' ? 0.055 : 0;
      p.bodyBankRoll = THREE.MathUtils.lerp(p.bodyBankRoll, 0, Math.min(1, dt * 14));
      p.bodyPitchLean = THREE.MathUtils.lerp(p.bodyPitchLean, atkLean, Math.min(1, dt * 14));
    }

    if (p.state === 'stagger') {
      p.staggerTimer -= dt;
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 14));
      // Allow responsive WASD locomotion cancel out of late stagger so player never feels frozen
      if (p.staggerTimer <= 0 || (p.staggerTimer <= 0.14 && hasMoveInput)) {
        p.staggerTimer = 0;
        p.state = hasMoveInput ? 'move' : 'idle';
      } else {
        return;
      }
    }

    if (p.state === 'heal') {
      p.healTimer -= dt;
      if (hasMoveInput) {
        p.pos.addScaledVector(mv, 3.2 * dt);
      } else {
        p.vel.multiplyScalar(Math.max(0, 1 - dt * 14));
      }
      if (p.healTimer <= 0) p.state = 'idle';
      return;
    }

    if (p.state === 'dodge') {
      p.dodgeTimer -= dt;
      const dodgeSpeed = 12.6;
      p.pos.addScaledVector(p.dodgeDir, dodgeSpeed * dt);
      p.vel.copy(p.dodgeDir).multiplyScalar(dodgeSpeed * 0.72);
      if (p.dodgeTimer <= 0) {
        p.state = hasMoveInput ? 'move' : 'idle';
      }
      return;
    }

    if (p.state === 'attack' && p.attackDef) {
      p.attackTime += dt;
      const frac = p.attackTime / p.attackDef.duration;
      const [hStart, hEnd] = p.attackDef.hitWindow;

      if (p.puppet?.swingState) {
        p.puppet.swingState.active = !p.attackDef.isSpell;
        p.puppet.swingState.frac = frac;
      }

      // Execute Spell Release at hStart for all Pro Magic Pack & Pigaloo Spells!
      if (p.attackDef.isSpell && !p.attackEffectFired && frac >= hStart) {
        p.attackEffectFired = true;
        this.executePlayerSpellRelease(p.attackDef);
      } else if (!p.attackDef.isSpell && !p.crescentSlashFired && frac >= hStart * 0.85) {
        p.crescentSlashFired = true;
        const wSpec = WEAPON_CATALOG[p.weaponId] || WEAPON_CATALOG.buster_sword;
        const slashCol = p.imbueTimer > 0 ? p.imbueColor : wSpec.color || 0x58e6ff;
        const slashRadius = p.attackDef.heavyImpact || p.attackDef.isLimitBreak ? 3.35 : 2.85;
        const slashTilt = (p.swingAltDir || 1) * (p.attackDef.heavyImpact ? 0.36 : 0.18);
        this.vfx?.sandbox?.spawnCrescentSlash?.(p.pos, p.yaw, {
          radius: slashRadius,
          roll: slashTilt,
          edgeColor: slashCol,
          coreColor: 0xfff8e0,
          speed: 6.8,
          life: 0.30,
        });
      }

      // Responsive directional footwork mobility & steering while swinging (never freezes player movement!)
      if (hasMoveInput) {
        if (!this.lockedTarget || this.lockedTarget.isDead) {
          const steerYaw = Math.atan2(-mv.x, -mv.z);
          const diff = wrapAngle(steerYaw - p.yaw);
          const steerRate = frac < hStart ? 14.0 : frac > hEnd ? 12.0 : 6.8;
          p.yaw = wrapAngle(p.yaw + diff * Math.min(1, dt * steerRate));
        }
        const footworkSpeed = frac < hStart ? 4.6 : frac <= hEnd ? 3.2 : 5.4;
        p.pos.addScaledVector(mv, footworkSpeed * dt);
        p.vel.copy(mv).multiplyScalar(footworkSpeed);
      } else {
        p.vel.multiplyScalar(Math.max(0, 1 - dt * 12));
      }

      // Forward lunge during startup & active cut
      if (frac >= 0.05 && frac <= hEnd) {
        const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        const nearEnemy = this.findNearestAliveEnemy(2.2);
        const lungeBlocked = nearEnemy && nearEnemy.pos.distanceTo(p.pos) < 1.32;
        if (!lungeBlocked) {
          p.pos.addScaledVector(fwd, (p.attackDef.lunge / p.attackDef.duration) * dt);
        }
      }

      // Combo chain transition in early recovery
      if (p.queuedAttackId && frac >= hEnd + 0.02) {
        const nextId = p.queuedAttackId;
        this.startPlayerAttack(nextId);
        return;
      }

      // Immediate locomotion cancel out of follow-through as soon as the active cut finishes!
      if (!p.queuedAttackId && hasMoveInput && frac >= hEnd + 0.04) {
        if (p.puppet?.swingState) p.puppet.swingState.active = false;
        p.state = 'move';
        p.attackDef = null;
      } else if (p.attackTime >= p.attackDef.duration) {
        if (p.puppet?.swingState) p.puppet.swingState.active = false;
        p.state = 'idle';
        p.attackDef = null;
      } else {
        return;
      }
    }

    if (p.state === 'guard') {
      p.guardTimer += dt;
      if (this.lockedTarget && !this.lockedTarget.isDead) {
        const dx = this.lockedTarget.pos.x - p.pos.x;
        const dz = this.lockedTarget.pos.z - p.pos.z;
        p.yaw = Math.atan2(-dx, -dz);
      }
      // Agile block-strafe allowed
      if (hasMoveInput) {
        p.pos.addScaledVector(mv, 3.8 * dt);
      }
      return;
    }

    // Standard Idle / Airborne / Ground Locomotion with Pigaloo Trimmed Gait Cycles, Turning & Knee Bending
    const sprinting = p.sprinting && !p.crouching;
    const targetSpeed = !hasMoveInput
      ? 0
      : p.crouching
      ? 3.6
      : sprinting
      ? 9.6
      : p.stanceMode === 'punisher'
      ? 6.4
      : 7.2;

    const accel = hasMoveInput ? (p.isGrounded ? 26.0 : 14.0) : p.isGrounded ? 20.0 : 5.0;
    p.vel.x = THREE.MathUtils.lerp(p.vel.x, mv.x * targetSpeed, Math.min(1, dt * accel));
    p.vel.z = THREE.MathUtils.lerp(p.vel.z, mv.z * targetSpeed, Math.min(1, dt * accel));
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;

    const horizSpeed = Math.hypot(p.vel.x, p.vel.z);

    if (hasMoveInput || !p.isGrounded || horizSpeed > 0.28) {
      p.state = 'move';
      const lockedOnActive = this.lockedTarget && !this.lockedTarget.isDead && !sprinting;

      if (lockedOnActive) {
        const dx = this.lockedTarget.pos.x - p.pos.x;
        const dz = this.lockedTarget.pos.z - p.pos.z;
        const desiredYaw = Math.atan2(-dx, -dz);
        const diff = wrapAngle(desiredYaw - p.yaw);
        const stepYaw = diff * Math.min(1, dt * 18);
        p.yaw = wrapAngle(p.yaw + stepYaw);
        p.turnRate = stepYaw / Math.max(0.001, dt);
      } else if (hasMoveInput) {
        const targetYaw = Math.atan2(-mv.x, -mv.z);
        const diff = wrapAngle(targetYaw - p.yaw);
        const turnSpeed = !p.isGrounded ? 12.0 : sprinting ? 16.5 : 21.0;
        const stepYaw = diff * Math.min(1, dt * turnSpeed);
        p.yaw = wrapAngle(p.yaw + stepYaw);
        p.turnRate = stepYaw / Math.max(0.001, dt);
      } else {
        p.turnRate = 0;
      }

      // Smooth velocity-driven forward pitch lean + lateral turn-rate banking tilt
      const speedNorm = THREE.MathUtils.clamp(horizSpeed / 9.2, 0, 1.15);
      const targetBank = THREE.MathUtils.clamp(
        -p.turnRate * (0.026 + speedNorm * 0.034),
        -0.24,
        0.24,
      );
      const targetPitch = !p.isGrounded
        ? THREE.MathUtils.clamp(-p.velY * 0.007, -0.07, 0.07)
        : speedNorm * 0.1 + (p.sprintStartTimer > 0 ? 0.045 : 0) + (p.runStopTimer > 0 ? -0.045 : 0);
      p.bodyBankRoll = THREE.MathUtils.lerp(p.bodyBankRoll, targetBank, Math.min(1, dt * 13));
      p.bodyPitchLean = THREE.MathUtils.lerp(p.bodyPitchLean, targetPitch, Math.min(1, dt * 13));

      // Select animation clip & dynamic speed-proportional playback rate
      if (!p.isGrounded) {
        const takeoffClip = p.jumpTakeoffClip || (horizSpeed > 2.2 ? 'Jump_Run' : 'Jump');
        // Velocity-driven playback rate: brisk push-off -> weightless apex suspension -> landing reach
        const airRate = p.velY > 1.8 ? 1.24 : p.velY > -2.2 ? 0.68 : 1.16;
        if (p.flipTimer > 0 && this.animStore.has('Jump_Run')) {
          p.puppet.play('Jump_Run', { loop: false, rate: 1.25, fade: 0.05 });
        } else if (takeoffClip === 'Jump' && this.animStore.has('Jump')) {
          p.puppet.play('Jump', { loop: false, rate: airRate, fade: 0.08 });
        } else {
          const airClip = this.animStore.has('Jump_Run') ? 'Jump_Run' : takeoffClip;
          p.puppet.play(airClip, { loop: false, rate: airRate, fade: 0.08 });
        }
      } else if (!hasMoveInput && p.landRecoveryTimer > 0) {
        // Pigaloo Land & Land_Hard with knee-bending shock absorption (only when not actively running)
        const landClip =
          p.hardLanding && this.animStore.has('Land_Hard')
            ? 'Land_Hard'
            : this.animStore.has('Land')
            ? 'Land'
            : 'Jump_Land';
        p.puppet.play(landClip, { loop: false, rate: 1.45, fade: 0.06 });
      } else if (!hasMoveInput && p.runStopTimer > 0) {
        const stopClip = this.animStore.has('Run_Stop') ? 'Run_Stop' : 'rpgRunAFStop';
        p.puppet.play(stopClip, { loop: false, rate: 1.32, fade: 0.08 });
      } else if (p.crouching) {
        const crouchRate = THREE.MathUtils.clamp(0.8 + (horizSpeed / 3.4) * 0.45, 0.78, 1.32);
        p.puppet.play('Crouch_Walk', { loop: true, rate: crouchRate, fade: 0.12 });
      } else if (lockedOnActive && hasMoveInput) {
        // 4-Way Directional Lock-On Strafe with speed-scaled playback rate
        const fwdVec = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        const rightVec = new THREE.Vector3(-fwdVec.z, 0, fwdVec.x);
        const fDot = mv.dot(fwdVec);
        const rDot = mv.dot(rightVec);
        const isGreatStyle = this.getWeaponStyle() === 'great';
        let strafeClip = 'Jog';
        let strafeRate = THREE.MathUtils.clamp(0.85 + (horizSpeed / 6.5) * 0.45, 0.85, 1.38);
        if (Math.abs(rDot) > Math.abs(fDot) * 1.05) {
          if (rDot > 0) {
            strafeClip =
              isGreatStyle && this.animStore.has('GS_Strafe_R')
                ? 'GS_Strafe_R'
                : this.animStore.has('SnS_Strafe_R')
                ? 'SnS_Strafe_R'
                : 'rpgWalkAFR90A';
          } else {
            strafeClip =
              isGreatStyle && this.animStore.has('GS_Strafe_L')
                ? 'GS_Strafe_L'
                : this.animStore.has('SnS_Strafe_L')
                ? 'SnS_Strafe_L'
                : 'rpgWalkAFL90A';
          }
          strafeRate = THREE.MathUtils.clamp(0.95 + (horizSpeed / 6.5) * 0.48, 0.95, 1.48);
        } else if (fDot < -0.25) {
          strafeClip = 'rpgJoggingB';
          strafeRate = THREE.MathUtils.clamp(0.9 + (horizSpeed / 6.5) * 0.42, 0.9, 1.38);
        }
        p.puppet.play(strafeClip, { loop: true, rate: strafeRate, fade: 0.12 });
      } else if (sprinting || horizSpeed > 6.8) {
        // Trimmed Pigaloo Sprint cycle with dynamic speed-proportional animation rate
        const sprintRate = THREE.MathUtils.clamp(0.92 + (horizSpeed / 9.2) * 0.42, 0.98, 1.42);
        p.puppet.play('Sprint', {
          loop: true,
          rate: sprintRate,
          fade: 0.11,
        });
      } else if (horizSpeed < 2.2 && this.animStore.has('Walk')) {
        // Trimmed Pigaloo steady-state Walk cycle
        const walkRate = THREE.MathUtils.clamp(0.88 + (horizSpeed / 2.2) * 0.38, 0.88, 1.28);
        p.puppet.play('Walk', { loop: true, rate: walkRate, fade: 0.12 });
      } else {
        // Trimmed Pigaloo steady-state Jog cycle
        const jogRate = THREE.MathUtils.clamp(0.92 + (horizSpeed / 7.2) * 0.38, 0.92, 1.34);
        p.puppet.play('Jog', {
          loop: true,
          rate: jogRate,
          fade: 0.12,
        });
      }

      if (p.isGrounded) {
        p.stepRippleAccum += horizSpeed * dt;
        if (p.stepRippleAccum > 1.65) {
          p.stepRippleAccum = 0;
          if (this.world.injectWaterRipple(p.pos, sprinting ? 0.95 : 0.65)) {
            this.vfx.emitWaterDroplets(p.pos, 8);
            sound.waterStep();
          }
        }
      }
    } else {
      p.state = 'idle';
      p.turnRate = 0;
      const stopPitch = p.runStopTimer > 0 ? -0.04 * (p.runStopTimer / 0.20) : 0;
      p.bodyBankRoll = THREE.MathUtils.lerp(p.bodyBankRoll, 0, Math.min(1, dt * 14));
      p.bodyPitchLean = THREE.MathUtils.lerp(p.bodyPitchLean, stopPitch, Math.min(1, dt * 14));
      if (this.lockedTarget && !this.lockedTarget.isDead) {
        const dx = this.lockedTarget.pos.x - p.pos.x;
        const dz = this.lockedTarget.pos.z - p.pos.z;
        const desiredYaw = Math.atan2(-dx, -dz);
        const diff = wrapAngle(desiredYaw - p.yaw);
        p.yaw = wrapAngle(p.yaw + diff * Math.min(1, dt * 16));
      }
      if (p.landRecoveryTimer > 0) {
        const landIdleClip =
          p.hardLanding && this.animStore.has('Land_Hard')
            ? 'Land_Hard'
            : this.animStore.has('Land')
            ? 'Land'
            : 'Jump_Land';
        p.puppet.play(landIdleClip, { loop: false, rate: 1.45, fade: 0.08 });
      } else if (p.runStopTimer > 0) {
        const stopClip = this.animStore.has('Run_Stop') ? 'Run_Stop' : 'rpgRunAFStop';
        p.puppet.play(stopClip, { loop: false, rate: 1.38, fade: 0.08 });
      } else {
        p.puppet.play(this.getIdleClip(), { loop: true, rate: 1.0, fade: 0.16 });
      }
    }
  }

  // Executes release of all Elemental Sandbox, Pro Magic Pack & Pigaloo Grimoire Spells
  executePlayerSpellRelease(def) {
    const p = this.player;
    const wSpec = WEAPON_CATALOG[p.weaponId] || WEAPON_CATALOG.buster_sword;
    const spellPower = wSpec.spellMult || 1.15;
    const st = def.spellType || 'prism_surge';

    if (st === 'phoenix_tide') {
      // HandCastAbilityThreeJS Serpent Tide Field: Flapping blackbody Phoenix + 3 Fire Serpents + Homing Beak Fireballs!
      this.vfx.emitPhoenixTide(p.pos, p.yaw, 0xff6a20);
      this.cameraShake = Math.max(this.cameraShake, 0.42);
      this.applyRadialSpellDamage(
        p.pos,
        6.4,
        Math.round(def.damage * spellPower),
        Math.round(def.poiseDamage * spellPower),
        0xff6a20,
        'fire',
        def,
      );
      return;
    }

    if (st === 'celestial_rend') {
      // LinearAbiltyCastingExtendedThreeJS Celestial Rend: 4-point concave star sigil + fluted pillar + 36 converging crystal shards!
      const targetEnemy =
        this.lockedTarget && !this.lockedTarget.isDead
          ? this.lockedTarget
          : this.findNearestAliveEnemy(14.0);
      const centerPos = targetEnemy
        ? targetEnemy.pos.clone()
        : p.pos.clone().add(new THREE.Vector3(-Math.sin(p.yaw) * 4.5, 0, -Math.cos(p.yaw) * 4.5));
      this.vfx.sandbox?.spawnCelestialRend(centerPos, 0xffe078, 0x7be0ff, 6.4, 1.35);
      this.cameraShake = Math.max(this.cameraShake, 0.44);
      this.applyRadialSpellDamage(
        centerPos,
        6.8,
        Math.round(def.damage * spellPower),
        Math.round(def.poiseDamage * spellPower),
        0xffe078,
        'light',
        def,
      );
      return;
    }

    if (st === 'caustic_bloom') {
      // LinearAbiltyCastingExtendedThreeJS Caustic Bloom: Voronoi-crazed acid pool + surfaceBoil spark rims + BurstSphere!
      const targetEnemy =
        this.lockedTarget && !this.lockedTarget.isDead
          ? this.lockedTarget
          : this.findNearestAliveEnemy(12.0);
      const centerPos = targetEnemy ? targetEnemy.pos.clone() : p.pos.clone();
      this.vfx.sandbox?.spawnGroundSigil(centerPos, 5.2, 0x55ff88, 1, 1.85, 1.55);
      this.vfx.sandbox?.spawnBurstSphere(
        new THREE.Vector3(centerPos.x, centerPos.y + 0.9, centerPos.z),
        0.4,
        3.2,
        0x55ff88,
        1,
        0.55,
        0.85,
        0.42,
      );
      this.vfx.emitSparks(centerPos.clone().add(new THREE.Vector3(0, 0.6, 0)), null, 38, 0x55ff88, 1.25);
      this.cameraShake = Math.max(this.cameraShake, 0.32);
      this.applyRadialSpellDamage(
        centerPos,
        6.2,
        Math.round(def.damage * spellPower),
        Math.round(def.poiseDamage * spellPower),
        0x55ff88,
        'void',
        def,
      );
      return;
    }

    if (st === 'venom_surge') {
      // LinearAbiltyCastingExtendedThreeJS Crystallized Venom Surge: 3-wave procedural 6-faceted crystal spear line eruption!
      this.vfx.sandbox?.spawnCrystalOrMonolithRupture(p.pos, p.yaw, 13.0, 0x38f2ff, true);
      this.cameraShake = Math.max(this.cameraShake, 0.34);
      this.applyDirectionalLineSpellDamage(
        13.0,
        2.2,
        Math.round(def.damage * spellPower),
        Math.round(def.poiseDamage * spellPower),
        0x38f2ff,
        'frost',
        def,
      );
      return;
    }

    if (st === 'bolt1') {
      // Single fast Arcane Starbolt
      this.firePlayerArcaneBolt(0, 0x9fffe6, Math.round(def.damage * spellPower), def.poiseDamage, 'light');
      this.vfx.spawnShockwaveRing(p.pos, 2.2, 0x9fffe6);
      return;
    }

    if (st === 'bolt2') {
      // Twin Rime-Fire Volley (spread -0.14 and +0.14 rad)
      this.firePlayerArcaneBolt(-0.14, 0x7be0ff, Math.round(def.damage * 0.72 * spellPower), 32, 'frost');
      this.firePlayerArcaneBolt(0.14, 0xff6a26, Math.round(def.damage * 0.72 * spellPower), 32, 'fire');
      this.vfx.spawnShockwaveRing(p.pos, 2.6, 0x7be0ff);
      return;
    }

    if (st === 'beam') {
      // Coalesced Arcane Lance Beam (15m forward piercing ray)
      this.vfx.emitArcaneBeam(p.pos, p.yaw, 15.0, 0x58e6ff);
      this.cameraShake = Math.max(this.cameraShake, 0.28);
      this.applyDirectionalLineSpellDamage(15.0, 1.35, Math.round(def.damage * spellPower), Math.round(def.poiseDamage * spellPower), 0x58e6ff, 'shock', def);
      return;
    }

    if (st === 'threadlight') {
      // Pigaloo Threadlight: 3 piercing lanes (-0.22, 0, +0.22 rad) up to 13.5m
      this.vfx.emitThreadlightLanes(p.pos, p.yaw, 13.5, 0x9fffe6);
      this.cameraShake = Math.max(this.cameraShake, 0.24);
      this.applyDirectionalLineSpellDamage(13.5, 2.4, Math.round(def.damage * spellPower), Math.round(def.poiseDamage * spellPower), 0x9fffe6, 'light', def);
      return;
    }

    if (st === 'prism_surge') {
      // Pigaloo Prism Surge: 18-ray Fibonacci sphere burst + radial shockwave
      this.vfx.emitPrismSurge(p.pos, 6.4, 0xc6a4ff);
      this.firePlayerArcaneBolt(0, 0xc6a4ff, Math.round(85 * spellPower), 55, 'void');
      this.cameraShake = Math.max(this.cameraShake, 0.34);
      return;
    }

    if (st === 'meteor') {
      // Ignis Meteor Cataclysm + Serpent Tide Phoenix centered on locked target or 5.5m ahead
      const targetEnemy =
        this.lockedTarget && !this.lockedTarget.isDead
          ? this.lockedTarget
          : this.findNearestAliveEnemy(16.0);
      const centerPos = targetEnemy
        ? targetEnemy.pos.clone()
        : p.pos.clone().add(new THREE.Vector3(-Math.sin(p.yaw) * 5.5, 0, -Math.cos(p.yaw) * 5.5));
      this.vfx.emitSpellCataclysm(centerPos, 5.8, 0xff5a26, 'meteor');
      this.vfx.emitPhoenixTide(p.pos, p.yaw, 0xff6a20);
      this.cameraShake = Math.max(this.cameraShake, 0.42);
      this.applyRadialSpellDamage(centerPos, 5.8, Math.round(def.damage * spellPower), Math.round(def.poiseDamage * spellPower), 0xff5a26, 'fire', def);
      return;
    }

    if (st === 'storm') {
      // Rime Tempest Vortex around player / target
      const targetEnemy =
        this.lockedTarget && !this.lockedTarget.isDead
          ? this.lockedTarget
          : this.findNearestAliveEnemy(9.0);
      const centerPos = targetEnemy ? targetEnemy.pos.clone() : p.pos.clone();
      this.vfx.emitSpellCataclysm(centerPos, 6.5, 0x7be0ff, 'storm');
      this.cameraShake = Math.max(this.cameraShake, 0.34);
      this.applyRadialSpellDamage(centerPos, 6.5, Math.round(def.damage * spellPower), Math.round(def.poiseDamage * spellPower), 0x7be0ff, 'frost', def);
      return;
    }

    if (st === 'nova') {
      // Abyssal Void Nova: pulls enemies inward toward singularity & cracks armor!
      this.vfx.emitSpellCataclysm(p.pos, 6.6, 0xb85cff, 'nova');
      this.cameraShake = Math.max(this.cameraShake, 0.38);
      for (const enc of this.encounters) {
        if (enc.cleared) continue;
        for (const e of enc.fighters) {
          if (e.isDead) continue;
          const d = e.pos.distanceTo(p.pos);
          if (d <= 8.5 && d > 1.8) {
            const pull = new THREE.Vector3().subVectors(p.pos, e.pos).normalize().multiplyScalar(2.2);
            e.pos.add(pull);
          }
        }
      }
      this.applyRadialSpellDamage(p.pos, 6.6, Math.round(def.damage * spellPower), Math.round(def.poiseDamage * spellPower), 0xb85cff, 'void', def);
      return;
    }

    if (st === 'imbue') {
      // Elemental Blade Imbue (25s weapon enchantment + heal pulse + runic light rings!)
      const elKey = wSpec.element || 'fire';
      const elInfo = ELEMENTS[elKey] || ELEMENTS.fire;
      p.imbueTimer = 25.0;
      p.imbueElement = elKey;
      p.imbueColor = elInfo.color;
      p.bladeTrail.setColor(elInfo.color);
      p.hp = Math.min(p.maxHp, p.hp + this.scalePlayerHealing(65));
      this.vfx.spawnMagicLightRings(p.pos, elInfo.color);
      this.vfx.spawnShockwaveRing(p.pos, 4.4, elInfo.color);
      this.vfx.emitSparks(p.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), null, 42, elInfo.color, 1.3);
      this.onBanner(
        `BLADE IMBUED: ${elInfo.label.toUpperCase()} ENCHANTMENT (+30% DMG & STATUS FOR 25S)!`,
        `#${elInfo.color.toString(16).padStart(6, '0')}`,
      );
      this.onStateChange();
    }
  }

  applyDirectionalLineSpellDamage(range, halfWidth, dmg, poiseDmg, colorHex, elementKey, def) {
    const p = this.player;
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    for (const enc of this.encounters) {
      if (enc.cleared) continue;
      for (const e of enc.fighters) {
        if (e.isDead) continue;
        const rel = new THREE.Vector3().subVectors(e.pos, p.pos);
        const along = rel.dot(fwd);
        const lat = Math.abs(rel.dot(right));
        if (along >= -0.5 && along <= range + e.radius && lat <= halfWidth + e.radius) {
          this.inflictSpellDamageOnEnemy(e, enc, dmg, poiseDmg, colorHex, elementKey, def);
        }
      }
    }
  }

  applyRadialSpellDamage(centerPos, radius, dmg, poiseDmg, colorHex, elementKey, def) {
    for (const enc of this.encounters) {
      if (enc.cleared) continue;
      for (const e of enc.fighters) {
        if (e.isDead) continue;
        const d = Math.hypot(e.pos.x - centerPos.x, e.pos.z - centerPos.z);
        if (d <= radius + e.radius) {
          this.inflictSpellDamageOnEnemy(e, enc, dmg, poiseDmg, colorHex, elementKey, def);
        }
      }
    }
  }

  inflictSpellDamageOnEnemy(e, enc, dmg, poiseDmg, colorHex, elementKey, def) {
    const p = this.player;
    p.attackHitSet.add(e.id);
    enc.engaged = true;
    this.applyElementalStatusToEnemy(e, elementKey);

    // Wukong "Immobilize (定)" Golden Runic Stasis on Threadlight / Prism Surge invocations!
    if (def?.id === 'spell_threadlight' || def?.id === 'spell_prism_surge') {
      e.immobilizedTimer = e.isBoss ? 2.0 : 3.0;
      e.immobilizedDmgAccum = 0;
      this.vfx.spawnMagicLightRings(e.pos, 0xffd700, 0xffffff);
      this.onBanner(`定 IMMOBILIZED: ${e.name.toUpperCase()} FROZEN IN GOLDEN STASIS!`, '#ffd700');
    }

    const finalDmg = this.scalePlayerDamage(Math.max(12, Math.round(dmg * 0.52 * e.armorCrack)));
    e.hp = Math.max(0, e.hp - finalDmg);
    e.poise = Math.min(e.maxPoise, e.poise + poiseDmg);
    p.limitGauge = Math.min(100, p.limitGauge + 10);

    sound.hit(true, false);
    this.vfx.emitSparks(e.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), null, 32, colorHex, 1.3);

    if (e.hp <= 0) {
      this.handleEnemyDeath(e, def);
    } else if (e.poise >= e.maxPoise) {
      e.poise = 0;
      e.state = 'stagger';
      e.staggerTimer = 3.2;
      e.attackMove = null;
      e.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
      this.vfx.spawnShockwaveRing(e.pos, 4.5, 0xff4e2a);
      this.onBanner(`SPELL SHATTERED POSTURE — PRESS LMB FOR VISCERAL RIPOSTE!`, '#ff4e2a');
    } else if (e.state !== 'attack' && e.state !== 'stagger' && e.immobilizedTimer <= 0) {
      const hurtClip = this.pickDirectionalHurtClip(e, p.pos, true);
      e.puppet.play(hurtClip, { loop: false, rate: 1.35, fade: 0.05, forceReset: true });
    }
    this.onStateChange();
  }

  applyElementalStatusToEnemy(e, elementKey) {
    if (!elementKey) return;
    if (elementKey === 'fire') {
      e.burnTimer = 6.0;
    } else if (elementKey === 'frost' || elementKey === 'water') {
      e.frostTimer = 6.0;
    } else if (elementKey === 'void') {
      e.armorCrack = Math.min(1.22, e.armorCrack + 0.04);
    } else if (elementKey === 'shock' || elementKey === 'light') {
      e.pressuredTimer = Math.max(e.pressuredTimer, 4.5);
    } else if (elementKey === 'nature') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.scalePlayerHealing(12));
    }
  }

  checkPlayerBladeCollisions() {
    const p = this.player;
    const def = p.attackDef;
    if (!def) return;
    const obb = p.weaponMount.obb;
    const hitPoint = new THREE.Vector3();
    const wSpec = WEAPON_CATALOG[p.weaponId] || WEAPON_CATALOG.buster_sword;

    // Stance, Elemental Imbue & Prismatic Flow multipliers
    const punisherBoost = p.stanceMode === 'punisher' ? 1.25 : 1.0;
    const imbueBoost = p.imbueTimer > 0 ? 1.30 : 1.0;
    const isPrismaticFlow = p.flowCount >= 3;
    const flowDmgMult = isPrismaticFlow ? 1.30 : 1.0;
    const flowPoiseMult = isPrismaticFlow ? 1.45 : 1.0;

    // Check against destructible pillars in Zone 5
    for (const pillar of this.world.destructiblePillars) {
      if (!pillar.intact || p.attackHitSet.has(pillar.id)) continue;
      const inAoE = def.aoeRadius && p.pos.distanceTo(pillar.pos) <= def.aoeRadius + pillar.radius;
      if (inAoE || testWeaponOBBvsCapsule(obb, pillar.pos, 5.2, pillar.radius, hitPoint)) {
        p.attackHitSet.add(pillar.id);
        const pillarDmg = def.cracksArmor || def.heavyImpact ? 150 : 55;
        const shattered = this.world.damagePillar(pillar, pillarDmg, obb.axis);
        this.vfx.emitSwordClash(inAoE ? pillar.pos : hitPoint, obb.axis, 0xffaa44, 1.15);
        if (shattered) {
          sound.hit(true, true);
          this.cameraShake = 0.35;
          this.onBanner('OBSIDIAN PILLAR SHATTERED!', '#ff9f40');
        }
      }
    }

    // Check against all active enemies (including active Steel-on-Steel Blade Clashes & Multi-Bone Hurtboxes!)
    for (const enc of this.encounters) {
      if (enc.cleared) continue;
      for (const e of enc.fighters) {
        if (e.isDead || p.attackHitSet.has(e.id)) continue;

        // 1. Slayers-style Steel-on-Steel Active Blade Clash when both weapons swing simultaneously!
        if (
          e.state === 'attack' &&
          e.attackMove &&
          !e.attackDeflected &&
          e.weaponMount?.obb &&
          !def.isSpell &&
          !def.breaksGuard
        ) {
          const eFrac = e.attackTime / e.attackMove.duration;
          const [ehStart, ehEnd] = e.attackMove.hitWindow;
          if (eFrac >= ehStart * 0.72 && eFrac <= ehEnd) {
            const clashPt = new THREE.Vector3();
            const bladeDist = closestDistanceBetweenSegments(
              obb.basePos,
              obb.tipPos,
              e.weaponMount.obb.basePos,
              e.weaponMount.obb.tipPos,
              clashPt,
            );
            if (bladeDist <= obb.radius + e.weaponMount.obb.radius + 0.52) {
              p.attackHitSet.add(e.id);
              enc.engaged = true;
              e.attackDeflected = true;
              e.pressuredTimer = Math.max(e.pressuredTimer, 4.5);
              e.poise = Math.min(e.maxPoise, e.poise + Math.round(def.poiseDamage * 1.35));
              p.focus = Math.min(p.maxFocus, p.focus + 0.55);
              p.limitGauge = Math.min(100, p.limitGauge + 20);
              sound.deflect(true);
              p.puppet.triggerHitstop(0.075);
              e.puppet.triggerHitstop(0.075);
              this.cameraShake = Math.max(this.cameraShake, 0.32);
              this.vfx.emitSwordClash(clashPt, obb.axis, 0xfff0a8, 1.55);
              this.onBanner(`BLADE CLASH DEFLECT — ${e.name.toUpperCase()} REELING!`, '#ffd700');
              if (e.poise >= e.maxPoise) {
                e.poise = 0;
                e.state = 'stagger';
                e.staggerTimer = 3.4;
                e.attackMove = null;
                e.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
                this.onBanner('CLASH SHATTERED POSTURE — PRESS LMB FOR VISCERAL RIPOSTE!', '#ff4e2a');
              }
              this.onStateChange();
              continue;
            }
          }
        }

        // 2. Multi-Bone Hurtbox Socket Evaluation (Head Weakpoint -> Ankles -> Torso -> Capsule Fallback)
        let struckHurtbox = null;
        let hitMatched = false;
        if (e.hurtboxes && e.hurtboxes.length === 4) {
          const checkOrder = [3, 0, 1, 2]; // 3: head weakpoint, 0: ankle_l, 1: ankle_r, 2: torso
          for (const hbIdx of checkOrder) {
            const hb = e.hurtboxes[hbIdx];
            if (testWeaponOBBvsCapsule(obb, hb.pos, hb.height, hb.radius, hitPoint)) {
              struckHurtbox = hb;
              hitMatched = true;
              break;
            }
          }
        }
        if (!hitMatched) {
          hitMatched = testWeaponOBBvsCapsule(obb, e.pos, e.height, e.radius, hitPoint);
        }
        if (!hitMatched && def.aoeRadius) {
          const dist = p.pos.distanceTo(e.pos);
          if (dist <= def.aoeRadius + e.radius) {
            hitMatched = true;
            struckHurtbox = e.hurtboxes?.[2] || null;
            hitPoint.copy(e.pos).add(new THREE.Vector3(0, 1.1, 0));
          }
        }
        if (!hitMatched) continue;

        p.attackHitSet.add(e.id);
        enc.engaged = true;

        // Apply weapon innate element or active Elemental Blade Imbue status!
        const activeElement = p.imbueTimer > 0 ? p.imbueElement : wSpec.element;
        if (activeElement && (p.imbueTimer > 0 || def.heavyImpact || isPrismaticFlow)) {
          this.applyElementalStatusToEnemy(e, activeElement);
        }

        // Guard-Break Kick ([C]) shatters High Guard and inflicts PRESSURED status!
        if (def.breaksGuard) {
          e.stance = 'berserkFlurry';
          e.pressuredTimer = 6.0;
          e.blockedHitsCount = 0;
          this.vfx.spawnShockwaveRing(hitPoint, 3.8, 0xff9f40);
          this.onBanner(`${e.name.toUpperCase()} GUARD SHATTERED — PRESSURED!`, '#ff9f40');
        }

        // High Guard Stance light-spam counter check (bypassed by Heavy, Rising, Kick, Skills, or Punisher Mode)
        if (
          !def.heavyImpact &&
          !def.breaksGuard &&
          p.stanceMode !== 'punisher' &&
          e.stance === 'highGuard' &&
          e.state !== 'attack' &&
          e.state !== 'stagger' &&
          e.immobilizedTimer <= 0
        ) {
          e.blockedHitsCount++;
          e.puppet.play('Guard_React', { loop: false, rate: 1.35, fade: 0.05, forceReset: true });
          this.vfx.emitSwordClash(hitPoint, obb.axis, 0xffd270, 0.95);
          if (e.blockedHitsCount >= 2) {
            e.blockedHitsCount = 0;
            sound.deflect(false);
            this.vfx.emitSwordClash(hitPoint, obb.axis, 0xffd270, 1.35);
            this.startEnemyAttack(e, ENEMY_MOVES.slashCombo);
            this.onBanner(`${e.name.toUpperCase()} HIGH-GUARD COUNTER! (USE [C] KICK OR [R] UNDERCUT)`, '#ff9f40');
            continue;
          }
        }

        // Check if enemy is in their RECOVERY window -> CRUSHING COUNTER!
        let isCrushingCounter = false;
        if (e.state === 'attack' && e.attackMove) {
          const eFrac = e.attackTime / e.attackMove.duration;
          if (eFrac > e.attackMove.hitWindow[1]) {
            isCrushingCounter = true;
          }
        }

        const partDmgMult = struckHurtbox?.dmgMult || 1.0;
        const partPoiseMult = struckHurtbox?.poiseMult || 1.0;
        const isWeakPointCrit = !!struckHurtbox?.isWeakPoint && e.height >= 2.6;
        const crushingMult = isCrushingCounter ? (def.isThrust ? 1.40 : 1.28) : 1.0;
        const elderPoiseMult = p.elderSpiritBuff ? 1.35 : 1.0;
        const pressuredMult = e.pressuredTimer > 0 ? 1.45 : 1.0;

        if (def.cracksArmor || isWeakPointCrit) {
          e.armorCrack = Math.min(1.22, e.armorCrack + (isWeakPointCrit ? 0.06 : 0.04));
        }

        // Soulslike combat realism scale (0.50x) so even lesser foes require 50–75+ clean hits over minutes of combat
        const combatRealismScale = 0.50;
        const dmg = this.scalePlayerDamage(
          Math.max(
            10,
            Math.round(
              def.damage *
                combatRealismScale *
                wSpec.damageMult *
                punisherBoost *
                imbueBoost *
                flowDmgMult *
                crushingMult *
                partDmgMult *
                e.armorCrack,
            ),
          ),
        );
        const poiseDmg = Math.round(
          def.poiseDamage *
            wSpec.poiseMult *
            punisherBoost *
            flowPoiseMult *
            pressuredMult *
            partPoiseMult *
            (isCrushingCounter ? 1.65 : 1.0) *
            elderPoiseMult,
        );

        e.hp = Math.max(0, e.hp - dmg);
        e.poise = Math.min(e.maxPoise, e.poise + poiseDmg);
        const atbGain = (isCrushingCounter || isWeakPointCrit ? 0.44 : 0.25) * (wSpec.atbMult || 1.0);
        p.focus = Math.min(p.maxFocus, p.focus + atbGain);
        p.limitGauge = Math.min(100, p.limitGauge + (def.isLimitBreak ? 0 : isCrushingCounter || isWeakPointCrit ? 15 : 8));

        // Check Immobilize (定) Golden Stasis Shatter!
        if (e.immobilizedTimer > 0) {
          e.immobilizedDmgAccum = (e.immobilizedDmgAccum || 0) + dmg;
          if (e.immobilizedDmgAccum >= 180) {
            e.immobilizedTimer = 0;
            e.immobilizedDmgAccum = 0;
            e.poise = Math.min(e.maxPoise, e.poise + 85);
            this.vfx.spawnShockwaveRing(hitPoint, 4.4, 0xffd700);
            this.vfx.emitSwordClash(hitPoint, obb.axis, 0xffd700, 1.6);
            this.onBanner(`定 IMMOBILIZE SHATTERED — ${e.name.toUpperCase()} REELING!`, '#ffd700');
          }
        }

        // Accumulate Ankle/Leg Topple Damage on Giant & Colossal Enemies (>= 2.8m)!
        let triggeredLegTopple = false;
        if (e.height >= 2.8 && !(e.state === 'stagger' && e.staggerTimer > 1.6)) {
          const legMult = struckHurtbox ? struckHurtbox.legMult : 0.75;
          e.legDamage = (e.legDamage || 0) + Math.round(poiseDmg * legMult);
          if (e.legDamage >= (e.maxLegDamage || 850)) {
            e.legDamage = 0;
            triggeredLegTopple = true;
          }
        }

        if (isPrismaticFlow) {
          p.flowHistory = [];
          p.flowCount = 0;
          p.focus = Math.min(p.maxFocus, p.focus + 0.5);
          p.limitGauge = Math.min(100, p.limitGauge + 18);
          this.vfx.spawnShockwaveRing(hitPoint, 4.6, 0x62f4ff);
          this.onBanner(`PRISMATIC FLOW FINISHER! (${dmg} DMG)`, '#62f4ff');
        } else if (isWeakPointCrit) {
          this.vfx.spawnShockwaveRing(hitPoint, 3.8, 0xffd700);
          this.onBanner(`CROWN WEAKPOINT CRITICAL! (${dmg} DMG)`, '#ffd700');
        }

        // Frame-Accurate Hitstop on Attacker (and Defender if alive)
        p.puppet.triggerHitstop(0.065);
        if (e.hp > 0) {
          e.puppet.triggerHitstop(0.065);
        }

        sound.hit(def.heavyImpact || def.isLimitBreak || isWeakPointCrit, isCrushingCounter || isPrismaticFlow || isWeakPointCrit);
        this.cameraShake = Math.max(
          this.cameraShake,
          def.isLimitBreak || isCrushingCounter || isWeakPointCrit ? 0.38 : def.heavyImpact ? 0.24 : 0.15,
        );
        const sparkColor =
          def.isLimitBreak || isCrushingCounter || isWeakPointCrit
            ? 0xffd700
            : p.imbueTimer > 0
            ? p.imbueColor
            : wSpec.color;
        if (def.isLimitBreak || isCrushingCounter || def.heavyImpact || isWeakPointCrit) {
          this.vfx.emitSwordClash(
            hitPoint,
            obb.axis,
            sparkColor,
            def.isLimitBreak || isCrushingCounter || isWeakPointCrit ? 1.45 : 1.15,
          );
        } else {
          this.vfx.emitSparks(hitPoint, obb.axis, 28, sparkColor, 1.1);
        }

        if (this.world.injectWaterRipple(e.pos, 1.4)) {
          this.vfx.emitWaterDroplets(e.pos, 16);
        }

        if (isCrushingCounter && !isPrismaticFlow && !isWeakPointCrit) {
          this.vfx.spawnShockwaveRing(hitPoint, 3.6, 0xffd700);
          this.onBanner(`CRUSHING COUNTER! (${dmg} DMG)`, '#ffd700');
        }

        // If enemy HP reached 0, trigger immediate Death Falling Animation!
        if (e.hp <= 0) {
          this.handleEnemyDeath(e, def);
          this.onStateChange();
          continue;
        }

        // Boss Phase-II Blood-Moon Awakening when dropping below 55% HP!
        if (e.isBoss && !e.twoPhase && e.phase === 1 && e.hp <= e.maxHp * 0.55) {
          e.phase = 2;
          e.stance = 'berserkFlurry';
          e.bladeTrail?.setColor?.(0xff1e00);
          sound.shrine();
          this.cameraShake = Math.max(this.cameraShake, 0.48);
          this.vfx.spawnShockwaveRing(e.pos, 7.6, 0xff1e00);
          this.vfx.spawnMagicLightRings(e.pos, 0xff1e00, 0xffd700);
          this.onBanner(`PHASE II AWAKENED: ${e.name.toUpperCase()} — BLOOD-MOON OVERDRIVE (+20% SPEED)!`, '#ff2e1a');
        }

        // Check Colossal Leg-Buckle Topple, Posture / Poise Break, or Hyper-Armor / Counter-Retaliation
        // Enemies NEVER get trivially stun-locked during attacks — you must shatter their posture bar!
        if (triggeredLegTopple) {
          e.state = 'stagger';
          e.staggerTimer = 3.8;
          e.attackMove = null;
          e.puppet.play('rpgHitFDown', { loop: false, rate: 0.78, fade: 0.08, forceReset: true });
          this.updateEnemyHurtboxes(e);
          if (this.lockedTarget === e) {
            this.lockedSocketIndex = 3; // Auto-shift lock-on to exposed Crown Weakpoint!
          }
          this.cameraShake = Math.max(this.cameraShake, 0.46);
          this.vfx.spawnShockwaveRing(e.pos, 5.4, 0xffd700);
          this.onBanner(`COLOSSUS ANKLES BUCKLED — CROWN WEAKPOINT EXPOSED (1.65x CRIT)!`, '#ffd700');
        } else if (e.poise >= e.maxPoise) {
          e.poise = 0;
          e.state = 'stagger';
          e.staggerTimer = 3.2;
          e.attackMove = null;
          e.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
          this.updateEnemyHurtboxes(e);
          if (this.lockedTarget === e && e.height >= 2.8) {
            this.lockedSocketIndex = 3;
          }
          this.vfx.spawnShockwaveRing(e.pos, 4.5, 0xff4e2a);
          this.onBanner(`POSTURE BROKEN — PRESS LMB FOR VISCERAL RIPOSTE!`, '#ff4e2a');
        } else if (def.isLauncher && e.pressuredTimer > 0 && !e.isBoss && e.state !== 'attack' && e.height < 2.5) {
          // Rising Undercut only launches non-boss enemies whose guard was already pressured!
          e.state = 'stagger';
          e.staggerTimer = 1.15;
          e.attackMove = null;
          e.puppet.play('rpgHitFUp', { loop: false, rate: 1.1, fade: 0.06, forceReset: true });
          this.vfx.spawnShockwaveRing(e.pos, 3.8, 0x62f4ff);
        } else if (e.state !== 'attack' && e.state !== 'stagger' && e.immobilizedTimer <= 0) {
          // If struck while idle/moving, enemies do not sit still—they immediately counter-attack or flinch briefly!
          if (e.cooldown <= 0.45 && Math.random() < 0.72) {
            const pool = e.moves || ['slashFast', 'slashCombo'];
            const counterKey = pool[0] || 'slashFast';
            this.startEnemyAttack(e, ENEMY_MOVES[counterKey] || ENEMY_MOVES.slashFast, false);
          } else {
            const hurtClip = this.pickDirectionalHurtClip(e, p.pos, !!def.heavyImpact);
            e.puppet.play(hurtClip, { loop: false, rate: 1.45, fade: 0.05, forceReset: true });
          }
        }

        this.onStateChange();
      }
    }
  }

  pickDirectionalHurtClip(defender, attackerPos, large = false) {
    const toAttacker = new THREE.Vector3().subVectors(attackerPos, defender.pos).normalize();
    const defFwd = new THREE.Vector3(-Math.sin(defender.yaw), 0, -Math.cos(defender.yaw));
    const defRight = new THREE.Vector3(-defFwd.z, 0, defFwd.x);
    const fDot = defFwd.dot(toAttacker);
    const rDot = defRight.dot(toAttacker);
    const prefix = large && this.animStore.has('Hurt_Large_Front') ? 'Hurt_Large_' : 'Hurt_';
    if (fDot < -0.45) return `${prefix}Back`;
    if (rDot > 0.45) return `${prefix}Right`;
    if (rDot < -0.45) return `${prefix}Left`;
    return `${prefix}Front`;
  }

  pickEnemyDeathClip(e, killingAttack) {
    if (killingAttack?.flowKind === 'fatal') {
      return 'rpg2HandBaseFatalHit1Die';
    }
    if (killingAttack?.isLauncher) {
      return 'rpgDieFUp';
    }
    // Use directional deaths from Pro Magic Pack (`Death_Forward`, `Death_Left`, `Death_Right`, `Defeat`) + `gsTwoHandedSwordDeath`!
    const toPlayer = new THREE.Vector3().subVectors(this.player.pos, e.pos).normalize();
    const defFwd = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
    const defRight = new THREE.Vector3(-defFwd.z, 0, defFwd.x);
    const fDot = defFwd.dot(toPlayer);
    const rDot = defRight.dot(toPlayer);
    if (fDot < -0.45 && this.animStore.has('Death_Forward')) return 'Death_Forward';
    if (rDot > 0.48 && this.animStore.has('Death_Left')) return 'Death_Left';
    if (rDot < -0.48 && this.animStore.has('Death_Right')) return 'Death_Right';

    if (killingAttack?.isLimitBreak || killingAttack?.heavyImpact) {
      const heavyDeaths = ['Defeat', 'gsTwoHandedSwordDeath', 'Death_Forward', 'rpgDieB1'];
      return heavyDeaths[Math.abs(e.id.charCodeAt(0)) % heavyDeaths.length];
    }
    const stdDeaths = ['Defeat', 'Death_Forward', 'gsTwoHandedSwordDeath', 'Death_Left', 'Death_Right'];
    return stdDeaths[Math.abs(e.id.charCodeAt(e.id.length - 1)) % stdDeaths.length];
  }

  handleEnemyDeath(e, killingAttack = null) {
    // Check if Boss 2 (Lady Millicent -> Malenia Phase 2) triggers her 2-Phase Transformation!
    if (e.twoPhase && e.phase === 1) {
      const diffHp = this.getChapterRealm()?.diffHp || 1.0;
      const baseP2Hp = Math.round((e.phase2Hp || 720) * diffHp);
      const p2Hp = scaleEnemyVitals(baseP2Hp, e.baseMaxPoise || e.maxPoise || 1, this.difficultyId).maxHp;
      e.baseMaxHp = baseP2Hp;
      e.phase = 2;
      e.name = e.phase2Name;
      e.title = e.phase2Title;
      e.maxHp = p2Hp;
      e.hp = p2Hp;
      e.poise = 0;
      e.burnTimer = 0;
      e.frostTimer = 0;
      e.state = 'idle';
      e.stance = 'berserkFlurry';
      e.bladeTrail?.setColor?.(0xff1e00);
      sound.shrine();
      this.vfx.spawnShockwaveRing(e.pos, 9.5, 0xff3b30);
      this.vfx.emitWaterDroplets(e.pos, 45);
      this.world.injectWaterRipple(e.pos, 2.2);
      this.cameraShake = 0.55;
      this.onBanner(`PHASE II AWAKENED: ${e.phase2Name.toUpperCase()} — ${e.phase2Title.toUpperCase()}!`, '#ff3b30');

      if (e.phase2File) {
        loadGLTF(e.phase2File).then((gltf) => {
          if (!gltf || e.isDead) return;
          this.scene.remove(e.puppet.root);
          e.puppet.dispose();
          const p2H = e.phase2Height || (e.height >= 2.2 ? e.height : 2.15);
          e.height = p2H;
          e.puppet = createFighterPuppet({
            store: this.animStore,
            characterGltf: gltf,
            targetHeight: p2H,
          });
          const p2Scheme = e.phase2MatScheme || e.matScheme;
          if (p2Scheme) {
            applyEgyptianMaterialScheme(e.puppet.character || e.puppet.root, p2Scheme);
          }
          this.scene.add(e.puppet.root);
          e.puppet.root.position.copy(e.pos);
          e.puppet.root.rotation.y = e.yaw;
          const p2WeaponId = e.phase2Weapon || 'masamune';
          this.armory.makeWeapon(p2WeaponId).then((wMesh) => {
            if (e.weaponMount) e.weaponMount.dispose();
            e.weaponMount = mountWeaponToPuppet(wMesh, e.puppet, { height: p2H });
          });
        });
      }
      return;
    }

    e.isDead = true;
    e.state = 'dead';
    e.attackMove = null;
    e.deathTimer = 0;

    // Clear hitstop immediately so the death falling animation plays at full speed!
    e.puppet.triggerHitstop(0);
    const deathClip = this.pickEnemyDeathClip(e, killingAttack);
    e.deathClip = deathClip;
    e.puppet.play(deathClip, { loop: false, rate: 1.05, fade: 0.06, forceReset: true });

    this.vfx.emitSparks(
      e.pos.clone().add(new THREE.Vector3(0, 1.0, 0)),
      null,
      45,
      0xff5a26,
      1.4,
    );
    this.vfx.spawnShockwaveRing(e.pos, 3.4, 0xff4e2a);

    if (this.lockedTarget === e) {
      this.lockedTarget = this.findNearestAliveEnemy(18.0);
    }

    // Check if the entire Encounter is now cleared!
    const enc = e.encounter;
    if (enc.fighters.every((f) => f.isDead)) {
      enc.cleared = true;
      enc.engaged = false;
      sound.shrine();
      if (enc.optional && enc.rewardBuff) {
        this.player.elderSpiritBuff = true;
        this.player.maxFocus = 4.0;
        this.player.focus = 4.0;
        this.onBanner(`SPIRIT ABSORBED: ${enc.rewardBuff.toUpperCase()}!`, '#ffd700');
      } else if (enc.isFinalBoss) {
        const ch = this.getChapterRealm();
        this.onBanner(
          this.chapterIndex < CHAPTER_REALMS.length
            ? `${ch.name.toUpperCase()} CONQUERED — ENTER ASCENSION PORTAL [E] OR PRESS [F6] FOR NEXT REALM!`
            : `ALL FOUR REALMS CONQUERED — GOD-SLAYER OF THE SERPENT SPINE!`,
          '#ffd700',
        );
      } else if (enc.isBoss) {
        this.onBanner(`GREAT FOE FELLED — OBSIDIAN SEAL DISSOLVED!`, '#ffd270');
      } else {
        this.onBanner(`CHOKELOCK CLEARED — TRAIL UNSEALED`, '#55ff99');
      }
      this.onStateChange();
    }
  }

  stepDeadFighterCorpse(f, dt) {
    f.deathTimer = (f.deathTimer || 0) + dt;
    // Stop updating skeleton matrices once death animation has settled (> 4.2s) for 60 FPS!
    if (f.deathTimer > 4.2) return;
    f.puppet.body.position.y = 0;
    f.puppet.update(dt, 1.05);
    f.weaponMount?.sync(0);
    f.bladeTrail.update(dt, f.pos, f.pos, false, 0);
  }

  stepEncounters(enemyDt, rawDt, playerLoc) {
    const p = this.player;
    const pFwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));

    for (const enc of this.encounters) {
      // Smoothly dissolve the Obsidian Fog Seal when cleared, and cull distant unengaged seals
      if (enc.sealMesh) {
        if (enc.cleared) {
          if (enc.dissolveVal < 1.0) {
            enc.dissolveVal = Math.min(1.0, enc.dissolveVal + rawDt * 0.85);
            enc.sealMesh.userData.uDissolve.value = enc.dissolveVal;
          }
          if (enc.dissolveVal >= 1.0) enc.sealMesh.visible = false;
        } else {
          const distSq = enc.sealMesh.position.distanceToSquared(p.pos);
          enc.sealMesh.visible = Boolean(enc.engaged) || distSq < 38 * 38;
        }
      }

      if (enc.cleared) {
        for (const f of enc.fighters) {
          this.stepDeadFighterCorpse(f, rawDt);
        }
        continue;
      }

      for (const f of enc.fighters) {
        if (f.isDead) {
          this.stepDeadFighterCorpse(f, rawDt);
          continue;
        }

        // Cloud Step (聚形散气) Mirage Decoy Aggro: active holograms draw enemy targeting!
        let targetEntityPos = p.pos;
        if (this.vfx?.mirageClones) {
          for (const clone of this.vfx.mirageClones) {
            if (clone.active && clone.group.position.distanceTo(f.pos) < 9.5) {
              targetEntityPos = clone.group.position;
              break;
            }
          }
        }

        const toPlayer = new THREE.Vector3().subVectors(targetEntityPos, f.pos);
        toPlayer.y = 0;
        const dist = toPlayer.length();

        // 60 FPS & Visual Culling: Hide unengaged enemies > 48m away or across the outdoor / indoor monument threshold
        const inTombPlayer = Boolean(playerLoc?.isBranch) || (playerLoc?.t ?? 0) >= 0.238;
        const inTombEnc = Boolean(enc.isBranch) || (enc.t ?? 0) >= 0.238;
        const realmSeparation = this.chapterIndex >= 5 && inTombPlayer !== inTombEnc && dist > 26.0;
        if (!enc.engaged && (dist > 48.0 || realmSeparation)) {
          if (f.puppet?.root) f.puppet.root.visible = false;
          continue;
        }
        if (f.puppet?.root) f.puppet.root.visible = true;

        if (f.pressuredTimer > 0) {
          f.pressuredTimer = Math.max(0, f.pressuredTimer - enemyDt);
        }

        // Tick Elemental Burn DoT & Frost Slow status effects!
        if (f.burnTimer > 0) {
          f.burnTimer = Math.max(0, f.burnTimer - enemyDt);
          f.burnTickAccum = (f.burnTickAccum || 0) + enemyDt;
          if (f.burnTickAccum >= 0.5) {
            f.burnTickAccum = 0;
            f.hp = Math.max(0, f.hp - this.scalePlayerDamage(18));
            this.vfx.emitSparks(f.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), null, 6, 0xff6a26, 0.7);
            if (f.hp <= 0) {
              this.handleEnemyDeath(f, PLAYER_ATTACKS.spell_crimson_meteor);
              continue;
            }
          }
        }
        if (f.frostTimer > 0) {
          f.frostTimer = Math.max(0, f.frostTimer - enemyDt);
        }

        // Black Myth: Wukong Immobilize Spell ("定" Golden Runic Stasis Freeze)
        if (f.immobilizedTimer > 0) {
          f.immobilizedTimer = Math.max(0, f.immobilizedTimer - rawDt);
          f.immobilizeSparkAccum = (f.immobilizeSparkAccum || 0) + rawDt;
          if (f.immobilizeSparkAccum >= 0.16) {
            f.immobilizeSparkAccum = 0;
            this.vfx.emitSparks(
              f.pos.clone().add(new THREE.Vector3(0, (f.height || 2.0) * 0.52, 0)),
              null,
              4,
              0xffd700,
              0.55,
            );
          }
          f.weaponMount?.sync(0.95, 0xffd700);
          this.updateEnemyHurtboxes(f);
          continue;
        }

        const frostSpeedMult = f.frostTimer > 0 ? 0.65 : 1.0;
        const phaseSpeedMult = f.phase === 2 ? 1.18 : 1.0;
        const chapterSpeedMult = this.getChapterRealm()?.diffSpeed || 1.0;
        const difficultySpeedMult = this.getDifficulty().enemySpeedMult || 1.0;
        const effEnemyDt = enemyDt * frostSpeedMult * phaseSpeedMult * chapterSpeedMult * difficultySpeedMult;
        const dirToEnemy = toPlayer.clone().negate().normalize();

        // Aggro trigger (14.5m radius)
        if (!enc.engaged && dist < 14.5) {
          enc.engaged = true;
          if (enc.isBoss) {
            this.onBanner(`BOSS ENGAGED: ${f.name.toUpperCase()}`, '#ff4e2a');
          } else {
            this.onBanner(`OBSIDIAN SEAL LOCKED — DEFEAT ALL GUARDS TO ADVANCE`, '#b85cff');
          }
          this.onStateChange();
        }

        if (!enc.engaged) {
          if (f.puppet) f.puppet.swingState = null;
          f.puppet.update(effEnemyDt);
          f.weaponMount?.sync(0);
          this.updateEnemyHurtboxes(f);
          continue;
        }

        // Dynamic Stance Adaptation (High Guard vs Berserk Flurry)
        f.stanceTimer -= effEnemyDt;
        if (f.stanceTimer <= 0) {
          f.stance = f.stance === 'highGuard' ? 'berserkFlurry' : 'highGuard';
          f.stanceTimer = 5.5 + Math.random() * 3.0;
        }

        // Shinobi Duel Vitality-Coupled Posture Regeneration: chipping enemy HP directly slows their posture recovery!
        if (f.state !== 'stagger' && f.pressuredTimer <= 0 && f.poise > 0) {
          const hpRatio = f.hp / Math.max(1, f.maxHp);
          const vitalityPostureMult =
            hpRatio > 0.75 ? 1.0 : hpRatio > 0.50 ? 0.66 : hpRatio > 0.25 ? 0.33 : 0.08;
          f.poise = Math.max(0, f.poise - 22.0 * vitalityPostureMult * effEnemyDt);
        }

        // Section 4 Lock 2: Pursuit & Back-Turn Punish AI!
        if (f.state !== 'attack' && f.state !== 'stagger' && !f.rangedCaster && dist > 1.8 && dist < 8.5) {
          const facingDot = pFwd.dot(dirToEnemy);
          const passedBehindGuard = !enc.isBranch && playerLoc.t > (f.t || 0) + 0.004;
          if ((facingDot < -0.32 || passedBehindGuard) && f.cooldown <= 0.25) {
            this.startEnemyAttack(f, ENEMY_MOVES.gapCloserThrust);
            this.onBanner(`${f.name.toUpperCase()} BACK-TURN PUNISH THRUST!`, '#ff4e2a');
          }
        }

        this.stepSingleEnemyAI(f, effEnemyDt, dist, toPlayer);
        this.updateEnemyHurtboxes(f);
      }
    }
  }

  stepSingleEnemyAI(f, dt, dist, toPlayer) {
    const p = this.player;
    const attackReach = 2.45 + (f.height || 1.95) * 0.30;

    if (f.state === 'stagger') {
      f.staggerTimer -= dt;
      if (f.puppet) f.puppet.swingState = null;
      f.puppet.update(dt, null, 0, { kneeBendSquash: 0.11, strideLean: -0.08 });
      f.weaponMount?.sync(0);
      f.bladeTrail.update(dt, f.weaponMount.obb.basePos, f.weaponMount.obb.tipPos, false, 0);
      if (f.staggerTimer <= 0) {
        f.state = 'idle';
      }
      return;
    }

    if (f.state === 'attack' && f.attackMove) {
      const move = f.attackMove;
      const frac = f.attackTime / move.duration;
      const [hStart, hEnd] = move.hitWindow;

      let timeWarp = 1.0;
      let glintIntensity = 0.0;
      let glintColor = 0xffaa33;

      if (move.delayed) {
        if (frac >= 0.12 && frac < hStart) {
          timeWarp = 0.44;
          glintIntensity = 0.95;
          glintColor = 0xffb830;
        } else if (frac >= hStart && frac <= hEnd) {
          timeWarp = 2.25;
          glintIntensity = 1.0;
          glintColor = 0xff2818;
        } else {
          timeWarp = 1.18;
        }
      } else {
        if (frac < hStart) {
          timeWarp = 1.18;
          glintIntensity = 0.78;
          glintColor = 0xff8828;
        } else if (frac <= hEnd) {
          timeWarp = 1.95;
          glintIntensity = 1.0;
          glintColor = 0xff3018;
        } else {
          timeWarp = 1.14;
        }
      }

      f.attackTime += dt * (move.delayed && frac >= 0.12 && frac < hStart ? 0.62 : 1.08);
      const newFrac = f.attackTime / move.duration;

      if (newFrac < hStart * 1.16) {
        const targetYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
        const diff = wrapAngle(targetYaw - f.yaw);
        f.yaw = wrapAngle(f.yaw + diff * Math.min(1, dt * 12.5));
      }

      if (newFrac >= hStart * 0.42 && newFrac <= hEnd && dist > Math.max(1.15, (f.radius || 0.55) + 0.68)) {
        const fwd = new THREE.Vector3(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
        f.pos.addScaledVector(fwd, (move.lunge / move.duration) * dt * 1.32);
        this.spine.clampPositionToCorridor(f.pos, f.radius, [], 0, this.world.solidObstacles);
      }

      // Dynamic enemy combat IK coil & lunge posture + Wide 200° Procedural Sword Cleave Amplifier
      const dirSign = f.swingDirSign || 1;
      const swingStyle = f.swingStyle || 'horizontal';
      let atkSquash = 0.06;
      let atkLean = 0.04;
      let atkBank = 0;
      if (newFrac < hStart) {
        const windupT = THREE.MathUtils.clamp(newFrac / Math.max(0.01, hStart), 0, 1);
        atkSquash = 0.05 + windupT * 0.065;
        atkLean = -0.055 * windupT;
        atkBank = -0.055 * windupT * dirSign;
      } else if (newFrac <= hEnd) {
        const strikeT = THREE.MathUtils.clamp((newFrac - hStart) / Math.max(0.01, hEnd - hStart), 0, 1);
        const strikeBell = Math.sin(strikeT * Math.PI);
        atkSquash = 0.11 + strikeBell * 0.045;
        atkLean = 0.145 * strikeBell;
        atkBank = 0.095 * strikeBell * dirSign;
      } else {
        const recovT = THREE.MathUtils.clamp((newFrac - hEnd) / Math.max(0.01, 1 - hEnd), 0, 1);
        atkSquash = 0.09 * (1 - recovT * 0.6);
        atkLean = 0.06 * (1 - recovT);
      }

      if (f.puppet) {
        f.puppet.swingState = !f.attackDeflected
          ? {
              active: true,
              frac: newFrac,
              hStart,
              hEnd,
              dirSign,
              style: swingStyle,
              arcScale: f.isBoss ? 1.18 : 1.05,
            }
          : null;
      }

      const animRate = (f.attackBaseRate || 1.28) * timeWarp;
      f.puppet.root.position.copy(f.pos);
      f.puppet.root.rotation.y = f.yaw;
      f.puppet.update(dt, animRate, 0, {
        kneeBendSquash: atkSquash,
        strideLean: atkLean,
        turnBank: atkBank,
      });
      f.weaponMount?.sync(glintIntensity, glintColor);

      const bladeActive = newFrac >= hStart && newFrac <= hEnd && !f.attackDeflected;
      f.bladeTrail.update(
        dt,
        f.weaponMount.obb.basePos,
        f.weaponMount.obb.tipPos,
        bladeActive,
        f.isBoss ? 1.85 : 1.52,
      );

      // Emit wide 3D Crescent Slash ribbon on enemy sword swings
      if (
        !f.attackSlashArcFired &&
        !f.attackDeflected &&
        newFrac >= hStart + (hEnd - hStart) * 0.18 &&
        this.vfx?.sandbox
      ) {
        f.attackSlashArcFired = true;
        const slashRadius = Math.max(2.35, (f.height || 2.0) * 1.12);
        const slashRoll =
          swingStyle === 'vertical'
            ? Math.PI * 0.48 * dirSign
            : swingStyle === 'whirlwind'
            ? 0.08 * dirSign
            : 0.24 * dirSign;
        const schemeTrail = f.matScheme ? EGYPTIAN_MATERIAL_SCHEMES[f.matScheme]?.trailColor : null;
        this.vfx.sandbox.spawnCrescentSlash(f.pos, f.yaw, {
          radius: slashRadius,
          roll: slashRoll,
          pitch: swingStyle === 'vertical' ? -0.22 : 0.0,
          coreColor: 0xfff0d0,
          edgeColor: schemeTrail || (f.isBoss ? 0xff3b1e : 0xff8828),
          speed: 7.5,
          life: 0.30,
        });
      }

      // Ground shockwave VFX at peak of heavy slams & whirlwind cleaves
      if (
        !f.attackImpactVfxFired &&
        newFrac >= (hStart + hEnd) * 0.5 &&
        (move.id === 'overheadSlam' ||
          move.id === 'leapingCrush' ||
          move.id === 'whirlwindCleave' ||
          move.id === 'waterfowlDance' ||
          move.id === 'sovereignCataclysm' ||
          move.id === 'cycloneFury' ||
          move.id === 'predatorPounce')
      ) {
        f.attackImpactVfxFired = true;
        this.vfx.spawnShockwaveRing(f.weaponMount?.obb?.tipPos || f.pos, f.isBoss ? 3.8 : 2.5, 0xff5a2a);
        this.vfx.emitSparks(
          (f.weaponMount?.obb?.tipPos || f.pos).clone().add(new THREE.Vector3(0, 0.2, 0)),
          null,
          12,
          0xff6a2a,
          0.95,
        );
      }

      if (bladeActive) {
        this.world.injectWaterRipple(f.weaponMount.obb.tipPos, 1.0);
        if (f.destroysPillars) {
          const hpPt = new THREE.Vector3();
          for (const pillar of this.world.destructiblePillars) {
            if (pillar.intact && testWeaponOBBvsCapsule(f.weaponMount.obb, pillar.pos, 5.2, pillar.radius, hpPt)) {
              if (this.world.damagePillar(pillar, 150, f.weaponMount.obb.axis)) {
                sound.hit(true, true);
                this.cameraShake = 0.42;
                this.onBanner('THE SOVEREIGN SHATTERED AN OBSIDIAN PILLAR!', '#ff4e2a');
              }
            }
          }
        }

        if (!f.attackHitPlayer) {
          const hitPt = new THREE.Vector3();
          if (testWeaponOBBvsCapsule(f.weaponMount.obb, p.pos, p.height, p.radius, hitPt)) {
            this.resolveEnemyHitOnPlayer(f, move, hitPt);
          }
        }
      }

      // Relentless Multi-Hit Combo Chaining in early recovery when player is within reach
      const maxChain = f.isBoss ? 4 : 3;
      if (
        !f.attackDeflected &&
        move.nextCombo &&
        ENEMY_MOVES[move.nextCombo] &&
        newFrac >= hEnd + 0.06 &&
        (f.comboCount || 0) < maxChain &&
        dist < attackReach + 2.15
      ) {
        const chainProb =
          (move.comboChance || 0.72) + (f.stance === 'berserkFlurry' ? 0.22 : 0) + (f.isBoss ? 0.16 : 0);
        if (!f.comboRolled) {
          f.comboRolled = true;
          if (Math.random() < chainProb) {
            f.comboCount = (f.comboCount || 0) + 1;
            this.startEnemyAttack(f, ENEMY_MOVES[move.nextCombo], true);
            return;
          }
        }
      }

      if (f.attackTime >= move.duration) {
        f.state = 'idle';
        f.attackMove = null;
        if (f.puppet) f.puppet.swingState = null;
        f.comboCount = 0;
        f.cooldown =
          (f.stance === 'berserkFlurry' ? 0.08 : f.isBoss ? 0.14 : 0.22) *
          (this.getDifficulty().enemyCooldownMult || 1.0);
      }
      return;
    }

    // Idle / Aggressive Gap-Closer / Active Circle-Strafe / Ranged Caster Logic
    if (f.puppet) f.puppet.swingState = null;
    f.cooldown = Math.max(0, f.cooldown - dt);
    const targetYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
    const diff = wrapAngle(targetYaw - f.yaw);
    f.yaw = wrapAngle(f.yaw + diff * Math.min(1, dt * 11.5));

    const isGreatWeapon = WEAPON_CATALOG[f.weapon]?.style === 'great';
    const idleClip = isGreatWeapon ? 'Great_Idle' : 'Sword_Idle';
    let enemyIkOpts = { kneeBendSquash: 0.045, strideLean: 0.02, turnBank: 0 };

    if (f.rangedCaster && dist > 5.0) {
      f.puppet.play('Magic_1H_Attack_1', { loop: true, rate: 1.24 });
      if (f.cooldown <= 0) {
        this.fireEnemyProjectile(f, p.pos);
        f.cooldown = 1.25 * (this.getDifficulty().enemyCooldownMult || 1.0);
      }
    } else if (!f.rangedCaster && dist > attackReach + 0.85 && dist < attackReach + 6.4 && f.cooldown <= 0 && Math.random() < 0.65 * (this.getDifficulty().enemyAggressionMult || 1.0)) {
      // Aggressive Mid-Range Lunge / Leaping Crush / Predator Pounce Gap-Closer!
      const pool = f.moves || [];
      const gapMove = pool.includes('predatorPounce')
        ? ENEMY_MOVES.predatorPounce
        : pool.includes('leapingCrush')
        ? ENEMY_MOVES.leapingCrush
        : ENEMY_MOVES.gapCloserThrust;
      f.comboCount = 0;
      this.startEnemyAttack(f, gapMove, false);
      return;
    } else if (dist > attackReach) {
      const moveDir = toPlayer.clone().normalize();
      const sprintingPursuit = dist > attackReach + 2.0;
      const runSpd = (f.isBoss ? 7.6 : f.sizeClass === 'swarm' ? 7.8 : 6.6) * (sprintingPursuit ? 1.18 : 1.0);
      f.pos.addScaledVector(moveDir, runSpd * dt);
      this.spine.clampPositionToCorridor(f.pos, f.radius, [], 0, this.world.solidObstacles);
      const pursuitClip = sprintingPursuit && this.animStore.has('Sprint') ? 'Sprint' : 'Jog';
      f.puppet.play(pursuitClip, { loop: true, rate: sprintingPursuit ? 1.32 : 1.28, fade: 0.12 });
      enemyIkOpts = { kneeBendSquash: 0.065, strideLean: sprintingPursuit ? 0.095 : 0.065, turnBank: -diff * 0.08 };

      f.stepRippleAccum += runSpd * dt;
      if (f.stepRippleAccum > 1.8) {
        f.stepRippleAccum = 0;
        this.world.injectWaterRipple(f.pos, 0.85);
      }
    } else {
      if (f.cooldown <= 0) {
        const pool = f.moves || ['slashFast', 'heavyDelayed'];
        const pickKey =
          f.stance === 'berserkFlurry' && pool.includes('flurryChain') && Math.random() < 0.65
            ? 'flurryChain'
            : pool[Math.floor(Math.random() * pool.length)];
        f.comboCount = 0;
        this.startEnemyAttack(f, ENEMY_MOVES[pickKey] || ENEMY_MOVES.slashFast, false);
        return;
      } else {
        // Active Combat Circle-Strafing during brief cooldown windows so fights look dynamic and predatory
        if (!f.strafeSign) f.strafeSign = Math.random() < 0.5 ? 1 : -1;
        const rightVec = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
        const strafeSpd = (f.isBoss ? 3.8 : 3.2) * f.strafeSign;
        f.pos.addScaledVector(rightVec, strafeSpd * dt);
        this.spine.clampPositionToCorridor(f.pos, f.radius, [], 0, this.world.solidObstacles);
        const strafeClip =
          f.strafeSign > 0
            ? isGreatWeapon && this.animStore.has('GS_Strafe_R')
              ? 'GS_Strafe_R'
              : this.animStore.has('SnS_Strafe_R')
              ? 'SnS_Strafe_R'
              : idleClip
            : isGreatWeapon && this.animStore.has('GS_Strafe_L')
            ? 'GS_Strafe_L'
            : this.animStore.has('SnS_Strafe_L')
            ? 'SnS_Strafe_L'
            : idleClip;
        f.puppet.play(strafeClip, { loop: true, rate: 1.22, fade: 0.12 });
        enemyIkOpts = { kneeBendSquash: 0.075, strideLean: 0.035, turnBank: f.strafeSign * 0.045 };
      }
    }

    f.puppet.root.position.copy(f.pos);
    f.puppet.root.rotation.y = f.yaw;
    f.puppet.update(dt, null, 0, enemyIkOpts);
    f.weaponMount?.sync(0);
    f.bladeTrail.update(dt, f.weaponMount.obb.basePos, f.weaponMount.obb.tipPos, false, 0);
  }

  startEnemyAttack(f, moveDef, isComboChain = false) {
    f.state = 'attack';
    f.attackMove = moveDef;
    f.attackTime = 0;
    f.attackHitPlayer = false;
    f.attackDeflected = false;
    f.attackImpactVfxFired = false;
    f.attackSlashArcFired = false;
    f.comboRolled = false;
    f.strafeSign = Math.random() < 0.5 ? 1 : -1;
    f.swingDirSign = ((f.comboCount || 0) % 2 === 0 ? 1 : -1) * f.strafeSign;
    f.swingStyle =
      moveDef.id === 'overheadSlam' || moveDef.id === 'leapingCrush' || moveDef.id === 'sovereignCataclysm'
        ? 'vertical'
        : moveDef.id === 'whirlwindCleave' || moveDef.id === 'waterfowlDance' || moveDef.id === 'cycloneFury'
        ? 'whirlwind'
        : moveDef.id === 'gapCloserThrust' || moveDef.id === 'spearFlurry' || moveDef.perilous === 'thrust'
        ? 'thrust'
        : 'horizontal';
    const rawDur = this.animStore.duration?.(moveDef.clip) || this.animStore.getClip?.(moveDef.clip)?.duration || 1.12;
    const chapterSpeed = this.getChapterRealm()?.diffSpeed || 1.0;
    const phaseSpeed = f.phase === 2 ? 1.18 : 1.0;
    f.attackBaseRate =
      Math.max(1.28, rawDur / moveDef.duration) * (f.isBoss ? 1.18 : 1.10) * chapterSpeed * phaseSpeed;
    f.puppet.play(moveDef.clip, {
      loop: false,
      rate: f.attackBaseRate,
      fade: isComboChain ? 0.05 : 0.07,
      forceReset: true,
    });
    sound.swing(moveDef.damage >= 55);

    // Shinobi Duel Perilous Attack (危) Crimson Kanji Glint Telegraph!
    if (moveDef.perilous && this.vfx?.sandbox) {
      const glintPos = f.pos.clone().add(new THREE.Vector3(0, (f.height || 2.0) * 0.72, 0));
      this.vfx.sandbox.spawnStarGlint(glintPos, 2.2, 0xff1e1e, 0.38);
      if (f.pos.distanceTo(this.player.pos) < 11.5) {
        this.onBanner(
          moveDef.perilous === 'thrust'
            ? `危 PERILOUS THRUST (${f.name.toUpperCase()}) — DODGE [SHIFT] INTO BLADE FOR MIKIRI COUNTER!`
            : `危 PERILOUS SWEEP (${f.name.toUpperCase()}) — JUMP [SPACE] TO VAULT COUNTER!`,
          '#ff3b30',
        );
      }
    }
  }

  resolveEnemyHitOnPlayer(f, move, hitPt) {
    const p = this.player;
    const chapterDmgMult = (this.getChapterRealm()?.diffDmg || 1.0) * (f?.phase === 2 ? 1.18 : 1.0);
    const scaledDamage = Math.round(
      (move.damage || 85) * chapterDmgMult * (this.getDifficulty().enemyDamageMult || 1.0),
    );

    // 0a. Shinobi Duel Airborne Sweep Evasion: jumping over a Perilous Sweep evades it cleanly!
    if (move.perilous === 'sweep' && !p.isGrounded && p.jumpOffsetY > 0.22) {
      return;
    }

    // 0. Check Black Myth: Wukong "See-Through" (识破 / Resolute Counterflow) Active Window!
    if (p.seeThroughTimer > 0) {
      f.attackHitPlayer = true;
      f.attackDeflected = true;
      f.pressuredTimer = Math.max(f.pressuredTimer || 0, 5.0);
      f.poise = Math.min(f.maxPoise, f.poise + 135);
      p.focus = Math.min(p.maxFocus, p.focus + 1.0);
      p.limitGauge = Math.min(100, p.limitGauge + 25);
      p.queuedAttackId = 'skyfall_strike';
      this.mirageSlowTimer = Math.max(this.mirageSlowTimer, 0.22);
      sound.deflect(true);
      p.puppet.triggerHitstop(0.06);
      f.puppet?.triggerHitstop(0.06);
      this.cameraShake = 0.3;
      this.vfx.emitSwordClash(hitPt, p.weaponMount?.obb?.axis, 0xffd700, 1.75);
      this.vfx.spawnMagicLightRings(p.pos, 0xffd700, 0xff4e2a);
      this.onBanner('识破 SEE-THROUGH COUNTERFLOW — PRESS [U] FOR SKYFALL STRIKE!', '#ffd700');
      if (f.poise >= f.maxPoise) {
        f.poise = 0;
        f.state = 'stagger';
        f.staggerTimer = 3.2;
        f.attackMove = null;
        f.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
        this.onBanner('POSTURE BROKEN — PRESS LMB FOR VISCERAL RIPOSTE!', '#ff4e2a');
      }
      this.onStateChange();
      return;
    }

    // 1. Check Player i-frames (Mirage Step / Dodge Roll / Limit Break / Visceral Riposte)
    if (p.iFrameTimer > 0) {
      return;
    }

    f.attackHitPlayer = true;

    // 2. Check Player Deflect / Parry (with Shinobi Duel Anti-Mash Window & Deflect Chain Multiplier) OR Punisher Mode Counterstance!
    if (p.state === 'guard') {
      const activeDeflectWin = p.deflectWindow || 0.20;
      if (p.guardTimer <= activeDeflectWin && move.perilous !== 'sweep') {
        // PERFECT DEFLECT / PARRY! Reset anti-mash decay & increment deflectChain!
        p.deflectMashCount = 0;
        p.deflectChain = Math.min(8, (p.deflectChain || 0) + 1);
        p.deflectChainTimer = 2.6;
        p.stamina = Math.max(12, p.stamina); // Never break player posture on a Perfect Deflect!
        f.attackDeflected = true;
        f.pressuredTimer = 5.0;
        sound.deflect(true);
        p.focus = Math.min(p.maxFocus, p.focus + 0.65);
        p.limitGauge = Math.min(100, p.limitGauge + 25);
        const chainMult = 1 + 0.12 * Math.min(p.deflectChain, 4);
        const deflectPoise = Math.round((p.elderSpiritBuff ? 145 : 110) * chainMult);
        f.poise = Math.min(f.maxPoise, f.poise + deflectPoise);

        const style = this.getWeaponStyle();
        const parryClip =
          style === 'great' || style === 'katana' || style === 'staff'
            ? 'rpg2HandBaseWParryA1'
            : 'rpg1HandBaseShieldBlockParry1';
        p.puppet.play(parryClip, { loop: false, rate: 1.35, fade: 0.05, forceReset: true });

        p.puppet.triggerHitstop(0.065);
        f.puppet.triggerHitstop(0.065);
        this.cameraShake = 0.28;
        this.vfx.emitSwordClash(hitPt, p.weaponMount?.obb?.axis, 0xffd700, 1.5);
        this.onBanner(
          `PERFECT DEFLECT (${p.deflectChain}x CHAIN) — ENEMY PRESSURED (+25% LIMIT)!`,
          '#ffd700',
        );

        if (f.poise >= f.maxPoise) {
          f.poise = 0;
          f.state = 'stagger';
          f.staggerTimer = 3.2;
          f.attackMove = null;
          f.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
          this.onBanner('POSTURE BROKEN — PRESS LMB FOR VISCERAL RIPOSTE!', '#ff4e2a');
        }
        this.onStateChange();
        return;
      }

      // FF7 Remake Punisher Mode Guard -> Auto-Counterstance Slash (requires stamina & takes 22% chip damage)!
      if (p.stanceMode === 'punisher' && f.pos && p.stamina >= 18) {
        f.attackDeflected = true;
        sound.deflect(true);
        p.stamina = Math.max(0, p.stamina - 22 * (this.getDifficulty().staminaCostMult || 1.0));
        p.hp = Math.max(0, p.hp - Math.round(scaledDamage * 0.22));
        if (p.hp <= 0) {
          p.state = 'dead';
          p.puppet.triggerHitstop(0);
          p.puppet.play('Defeat', { loop: false, rate: 1.0, fade: 0.08, forceReset: true });
          this.onBanner('YOU DIED — RETURNING TO LAST KINDLED SHRINE...', '#ff3b30');
          setTimeout(() => {
            if (this.player.state === 'dead' && this.lastCheckpointShrine) this.teleportToShrine(this.lastCheckpointShrine.zone);
          }, 2400);
          this.onStateChange();
          return;
        }
        p.limitGauge = Math.min(100, p.limitGauge + 15);
        this.vfx.emitSwordClash(hitPt, p.weaponMount?.obb?.axis, 0xff5a26, 1.35);
        this.startPlayerAttack('punisher_counter');
        this.onBanner('PUNISHER COUNTERSTANCE UNLEASHED!', '#ff5a26');
        this.onStateChange();
        return;
      }

      // Standard Guard Block (drains heavy stamina and deals 28% chip damage; lethal if HP hits 0!)
      sound.deflect(false);
      p.stamina = Math.max(0, p.stamina - move.poise * 0.85 * (this.getDifficulty().staminaCostMult || 1.0));
      p.hp = Math.max(0, p.hp - Math.round(scaledDamage * 0.28));
      p.limitGauge = Math.min(100, p.limitGauge + 8);
      p.puppet.play('Guard_React', { loop: false, rate: 1.35, fade: 0.05, forceReset: true });
      this.vfx.emitSwordClash(hitPt, p.weaponMount?.obb?.axis, 0xffaa44, 0.95);
      this.cameraShake = 0.18;
      if (p.hp <= 0) {
        p.state = 'dead';
        p.puppet.triggerHitstop(0);
        p.puppet.play('Defeat', { loop: false, rate: 1.0, fade: 0.08, forceReset: true });
        this.onBanner('YOU DIED — RETURNING TO LAST KINDLED SHRINE...', '#ff3b30');
        setTimeout(() => {
          if (this.player.state === 'dead' && this.lastCheckpointShrine) this.teleportToShrine(this.lastCheckpointShrine.zone);
        }, 2400);
      } else if (p.stamina <= 0) {
        p.state = 'stagger';
        p.staggerTimer = 0.52;
        p.puppet.play('Hurt_Large_Front', { loop: false, rate: 1.25, fade: 0.06, forceReset: true });
        this.onBanner('GUARD BROKEN!', '#ff4e2a');
      }
      this.onStateChange();
      return;
    }

    // 3. Direct Hit on Player
    sound.hit(true, false);
    p.hp = Math.max(0, p.hp - scaledDamage);
    p.limitGauge = Math.min(100, p.limitGauge + 14);
    p.puppet.triggerHitstop(0.055);
    f?.puppet?.triggerHitstop(0.055);
    this.cameraShake = 0.38;
    this.chromaticPulse = 1.0;
    this.vfx.emitSparks(hitPt, null, 28, 0xff3b30, 1.15);

    if (p.hp <= 0) {
      p.state = 'dead';
      if (p.puppet) p.puppet.swingState = null;
      p.puppet.triggerHitstop(0);
      p.puppet.play('Defeat', { loop: false, rate: 1.0, fade: 0.08, forceReset: true });
      this.onBanner('YOU DIED — RETURNING TO LAST KINDLED SHRINE...', '#ff3b30');
      setTimeout(() => {
        if (this.player.state === 'dead' && this.lastCheckpointShrine) {
          this.teleportToShrine(this.lastCheckpointShrine.zone);
        }
      }, 2400);
    } else if (!(p.state === 'attack' && p.attackDef?.hyperArmor)) {
      p.state = 'stagger';
      p.staggerTimer = 0.24;
      if (p.puppet) p.puppet.swingState = null;
      if (f?.pos) {
        const knockDir = p.pos.clone().sub(f.pos).setY(0);
        if (knockDir.lengthSq() > 0.001) {
          knockDir.normalize();
          p.vel.x = knockDir.x * 5.2;
          p.vel.z = knockDir.z * 5.2;
        }
      }
      const hurtClip = f?.pos ? this.pickDirectionalHurtClip(p, f.pos, move.damage >= 95) : 'Hurt_Front';
      p.puppet.play(hurtClip, { loop: false, rate: 1.48, fade: 0.05, forceReset: true });
    }
    this.onStateChange();
  }

  // Zero-allocation Pooled Player Spell Projectile
  firePlayerArcaneBolt(yawOffset = 0, colorHex = 0x62f4ff, damage = 95, poise = 52, element = 'light') {
    const p = this.player;
    const startPos = p.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    const target =
      this.lockedTarget && !this.lockedTarget.isDead
        ? this.lockedTarget
        : this.findNearestAliveEnemy(22.0);
    let baseYaw = p.yaw;
    if (target) {
      baseYaw = Math.atan2(-(target.pos.x - startPos.x), -(target.pos.z - startPos.z));
    }
    const finalYaw = baseYaw + yawOffset;
    const dir = new THREE.Vector3(-Math.sin(finalYaw), 0, -Math.cos(finalYaw));
    if (target) {
      const dy = target.pos.y + 1.1 - startPos.y;
      const horizD = Math.max(1.0, Math.hypot(target.pos.x - startPos.x, target.pos.z - startPos.z));
      dir.y = dy / horizD;
      dir.normalize();
    }

    this.projectiles.push({
      fromPlayer: true,
      pos: startPos,
      vel: dir.multiplyScalar(23.5),
      radius: 0.28,
      colorHex,
      damage: Math.max(12, Math.round(damage * 0.52)),
      poise,
      element,
      life: 2.0,
    });
  }

  // Zero-allocation Pooled Enemy Spell Projectile
  fireEnemyProjectile(caster, targetPos) {
    const startPos = caster.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
    const dir = new THREE.Vector3()
      .subVectors(targetPos.clone().add(new THREE.Vector3(0, 1.0, 0)), startPos)
      .normalize();

    this.projectiles.push({
      fromPlayer: false,
      caster,
      pos: startPos,
      vel: dir.multiplyScalar(17.5),
      radius: 0.26,
      colorHex: 0xff5a20,
      damage: 88,
      poise: 48,
      life: 2.6,
    });
  }

  stepProjectiles(dt) {
    const p = this.player;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const b = this.projectiles[i];
      b.life -= dt;
      b.pos.addScaledVector(b.vel, dt);

      if (b.fromPlayer) {
        for (const enc of this.encounters) {
          if (enc.cleared) continue;
          for (const e of enc.fighters) {
            if (e.isDead) continue;
            const d = b.pos.distanceTo(e.pos.clone().add(new THREE.Vector3(0, 1.1, 0)));
            if (d < e.radius + 0.48) {
              enc.engaged = true;
              this.applyElementalStatusToEnemy(e, b.element);
              const hitDmg = this.scalePlayerDamage(Math.round((b.damage || 95) * e.armorCrack));
              e.hp = Math.max(0, e.hp - hitDmg);
              e.poise = Math.min(e.maxPoise, e.poise + (b.poise || 52));
              p.focus = Math.min(p.maxFocus, p.focus + 0.35);
              p.limitGauge = Math.min(100, p.limitGauge + 10);
              this.vfx.emitSparks(b.pos, null, 28, b.colorHex, 1.25);
              sound.hit(true, false);
              if (e.hp <= 0) {
                this.handleEnemyDeath(e, PLAYER_ATTACKS.magic_bolt_1);
              } else if (e.poise >= e.maxPoise) {
                e.poise = 0;
                e.state = 'stagger';
                e.staggerTimer = 3.2;
                e.attackMove = null;
                e.puppet.play('rpgHitFDown', { loop: false, rate: 0.85, fade: 0.08, forceReset: true });
                this.onBanner('ARCANE BOLT SHATTERED POSTURE!', '#62f4ff');
              } else if (e.state !== 'attack') {
                e.puppet.play('Hurt_Front', { loop: false, rate: 1.2, fade: 0.05, forceReset: true });
              }
              b.life = -1;
              this.onStateChange();
              break;
            }
          }
          if (b.life <= 0) break;
        }
      } else {
        const d = b.pos.distanceTo(p.pos.clone().add(new THREE.Vector3(0, 1.0, 0)));
        if (d < 0.78) {
          if (p.iFrameTimer > 0) {
            continue;
          }
          if (p.state === 'guard' && p.guardTimer <= this.getDeflectWindow(0.165)) {
            sound.deflect(true);
            p.focus = Math.min(p.maxFocus, p.focus + 0.5);
            p.limitGauge = Math.min(100, p.limitGauge + 18);
            this.vfx.emitSparks(b.pos, null, 24, 0xffd700, 1.2);
            this.onBanner('SPELL DEFLECTED!', '#ffd700');
          } else {
            this.resolveEnemyHitOnPlayer(b.caster, { damage: 30, poise: 18 }, b.pos);
          }
          b.life = -1;
        }
      }

      if (b.life <= 0) {
        this.projectiles.splice(i, 1);
      }
    }

    // Update the single InstancedMesh for all live projectiles
    this.vfx.syncProjectiles(this.projectiles);
  }

  getActiveBoss() {
    let best = null;
    let bestDist = 38.0;
    for (const enc of this.encounters) {
      if (enc.engaged && !enc.cleared && enc.isBoss) {
        const b = enc.fighters.find((f) => !f.isDead);
        if (b) {
          const d = b.pos.distanceTo(this.player.pos);
          if (d < bestDist) {
            bestDist = d;
            best = b;
          }
        }
      }
    }
    return best;
  }

  getNearestShrine(maxDist = 4.5) {
    let best = null;
    let bestD = maxDist;
    for (const sh of this.world.shrineObjects) {
      const d = sh.worldPos.distanceTo(this.player.pos);
      if (d < bestD) {
        bestD = d;
        best = sh;
      }
    }
    return best;
  }
}
