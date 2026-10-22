// Three r185's WebGPU backend passes `swizzle: "rgba"` (the identity swizzle)
// on every createView() call; Chromium versions without the texture-component-
// swizzle feature reject that member outright. Strip identity swizzles so the
// call succeeds on older Chrome too.
if (typeof GPUTexture !== 'undefined' && GPUTexture.prototype?.createView) {
  const origCreateView = GPUTexture.prototype.createView;
  GPUTexture.prototype.createView = function (desc) {
    if (desc && desc.swizzle === 'rgba') {
      const { swizzle, ...rest } = desc;
      return origCreateView.call(this, rest);
    }
    return origCreateView.call(this, desc);
  };
}

import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { SerpentSpineTopology } from './world/serpent-spline.js';
import { KitbashWorld } from './world/kitbash-world.js';
import { createSharedAnimStore, createWeaponArmory, waitForGLTFLoads } from './anim/puppet-store.js';
import { CombatVFXManager } from './render/shaders.js';
import { SoulslikeCombatEngine, HERO_ROSTER } from './combat/combat-engine.js';
import { SoulslikeHUDAndMap } from './ui/hud-and-map.js';
import { sound } from './audio/sound-engine.js';
import { WorldLighting } from './render/world-lighting.js';
import { prepareScene } from './render/prepare-scene.js';

async function bootstrap() {
  const loadingScreen = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  const loadingBarFill = document.getElementById('loading-bar-fill');
  const backendBadge = document.getElementById('hud-backend-badge');

  const setProgress = (pct, msg) => {
    if (loadingBarFill) loadingBarFill.style.width = `${pct}%`;
    if (loadingStatus) loadingStatus.textContent = msg;
  };

  setProgress(10, 'Initializing Three.js WebGPURenderer & TSL Pipeline...');

  const container = document.getElementById('canvas-container');
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  await renderer.init();

  const isWebGPU = renderer.backend?.isWebGPUBackend === true;
  if (backendBadge) {
    backendBadge.textContent = isWebGPU ? 'WEBGPU + TSL ACTIVE' : 'WEBGL2 FALLBACK ACTIVE';
    backendBadge.classList.toggle('webgpu-ok', isWebGPU);
  }

  // Scene & Atmospheric Fog
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b151e);
  scene.fog = new THREE.FogExp2(0x0b151e, 0.011);

  // Camera
  const camera = new THREE.PerspectiveCamera(
    56,
    window.innerWidth / window.innerHeight,
    0.25,
    18000
  );

  // TSL Post-Processing Bloom Pipeline
  let renderPipeline = null;
  let useBloomPipeline = true;
  let scenePass = null;
  try {
    renderPipeline = new THREE.RenderPipeline(renderer);
    scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomPass = bloom(sceneColor, 0.26, 0.38, 0.85);
    renderPipeline.outputNode = sceneColor.add(bloomPass);
  } catch (err) {
    console.warn('[SerpentSpine] RenderPipeline bloom fallback to direct render:', err);
    useBloomPipeline = false;
  }

  // Lighting Rig (Atmospheric Sun + Hemisphere + Player Lantern Rim)
  const hemiLight = new THREE.HemisphereLight(0xaec8e8, 0x1a1510, 0.82);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xffdfba, 2.25);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 2;
  sunLight.shadow.camera.far = 110;
  const shadowExtent = 26;
  sunLight.shadow.camera.left = -shadowExtent;
  sunLight.shadow.camera.right = shadowExtent;
  sunLight.shadow.camera.top = shadowExtent;
  sunLight.shadow.camera.bottom = -shadowExtent;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const playerRimLight = new THREE.PointLight(0x78c8ff, 1.02, 11, 1.8);
  scene.add(playerRimLight);

  // 1. Build Serpent's Spine Topology & Kitbashed World
  setProgress(28, 'Sculpting Inverted-U Serpent’s Spine & Pigaloo Water Basins...');
  const topology = new SerpentSpineTopology();
  const world = new KitbashWorld(scene, topology);
  await world.build();

  // 2. Load Tartarus 44-Bone Anima Rig & Animation Bundles + Fantasia Weapons
  setProgress(54, 'Loading Tartarus 44-Bone Anima Rig & Fantasia Weapon Armory...');
  const [animStore, armory] = await Promise.all([
    createSharedAnimStore(),
    createWeaponArmory(),
  ]);

  // 3. Initialize Combat VFX Manager, Soulslike Combat Engine & Diegetic HUD
  setProgress(78, 'Forging Playable Vessel & Spawning 5-Zone Encounters & Bosses...');
  const vfx = new CombatVFXManager(scene);

  let hud = null;
  const combat = new SoulslikeCombatEngine({
    scene,
    spine: topology,
    world,
    animStore,
    armory,
    vfx,
    onBanner: (text, color) => {
      if (hud) hud.showBanner(text, color);
    },
    onStateChange: () => {},
  });

  await combat.init();

  const lighting = new WorldLighting({
    scene, renderer, camera, hemiLight, sunLight, playerRimLight, world,
    onRenderSettings: ({ bloom: enabled, renderScale }) => {
      useBloomPipeline = !!renderPipeline && enabled;
      const ratio = Math.min(window.devicePixelRatio, 1.75) * renderScale;
      if (renderer.getPixelRatio() !== ratio) {
        renderer.setPixelRatio(ratio);
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
    },
  });

  setProgress(95, 'Binding Diegetic HUD & Interactive Serpent’s Spine Trail Map...');
  let camYaw = combat.player.yaw;

  hud = new SoulslikeHUDAndMap({
    topology,
    world,
    combat,
    onTeleportShrine: (zoneIndex) => {
      sound.init();
      combat.teleportToShrine(zoneIndex);
      camYaw = combat.player.yaw;
    },
    onCycleWeapon: () => {
      sound.init();
      combat.cycleWeapon();
    },
    onCycleHero: () => {
      sound.init();
      combat.cycleHero();
    },
    onCycleSpell: () => {
      sound.init();
      combat.cycleGrimoireSpell();
    },
  });

  // Input State & Camera Rig
  const keys = new Set();
  let camPitch = 0.34;
  let camDist = 5.4;
  let lastMouseLookTime = -10;
  let shiftDownTime = 0;
  const smoothCamPos = new THREE.Vector3();
  const smoothLookAt = new THREE.Vector3();
  let cameraInitialized = false;
  document.body.classList.toggle('debug-hud', new URLSearchParams(location.search).has('debug'));

  const clearHeldInput = () => {
    keys.clear(); shiftDownTime = 0; combat.setGuardHeld(false);
  };
  window.addEventListener('blur', clearHeldInput);
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) clearHeldInput();
    else if (hud) hud.cursorMode = false;
  });
  lighting.dialog.addEventListener('close', clearHeldInput);
  lighting.dialog.addEventListener('presentationopen', clearHeldInput);

  // Pointer Lock & Mouse Controls
  renderer.domElement.addEventListener('click', (e) => {
    sound.init();
    if (hud.mapExpanded || hud.escapeExpanded || lighting.isOpen) return;
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock?.();
    }
  });

  window.addEventListener('mousedown', (e) => {
    sound.init();
    if (hud.mapExpanded || hud.escapeExpanded || lighting.isOpen) return;
    if (document.pointerLockElement === renderer.domElement) {
      if (e.button === 0) {
        const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
        combat.triggerLightAttack(sprinting);
      } else if (e.button === 2) {
        combat.setGuardHeld(true);
      } else if (e.button === 1) {
        e.preventDefault();
        combat.toggleLockOn();
      }
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      combat.setGuardHeld(false);
    }
  });

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === renderer.domElement && !hud.mapExpanded && !hud.escapeExpanded && !lighting.isOpen) {
      camYaw -= e.movementX * 0.0028;
      camPitch = Math.max(0.08, Math.min(0.88, camPitch + e.movementY * 0.0024));
      lastMouseLookTime = performance.now() * 0.001;
    } else if (e.buttons === 1 && !hud.mapExpanded && !hud.escapeExpanded && !lighting.isOpen && e.target === renderer.domElement) {
      camYaw -= e.movementX * 0.004;
      camPitch = Math.max(0.08, Math.min(0.88, camPitch + e.movementY * 0.003));
      lastMouseLookTime = performance.now() * 0.001;
    }
  });

  window.addEventListener(
    'wheel',
    (e) => {
      if (hud.mapExpanded || hud.escapeExpanded || lighting.isOpen) return;
      camDist = Math.max(3.2, Math.min(9.5, camDist + e.deltaY * 0.003));
    },
    { passive: true }
  );

  window.addEventListener('keydown', (e) => {
    sound.init();
    const code = e.code;
    // Native dialog inputs own their keyboard events, including Escape.
    if (lighting.isOpen) return;
    if (hud.cursorMode && e.target.closest?.('#hud-layer') && ['Tab', 'Enter', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(code)) return;
    if (code === 'KeyO' && !e.repeat) {
      e.preventDefault(); clearHeldInput();
      hud.toggleFullMap(false); hud.toggleEscapeMenu(false);
      lighting.toggle(); return;
    }
    if ((hud.mapExpanded || hud.escapeExpanded) && code !== 'Escape' && code !== 'KeyM') return;
    if (code === 'Backquote' && !e.repeat) {
      e.preventDefault(); clearHeldInput(); hud.releaseActionCursor(); return;
    }
    const wasDown = keys.has(code);
    keys.add(code);

    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      if (!wasDown) shiftDownTime = performance.now();
    }

    if (code === 'KeyM') {
      e.preventDefault();
      clearHeldInput();
      hud.toggleFullMap();
      return;
    }
    if (code === 'Escape') {
      e.preventDefault();
      clearHeldInput();
      if (hud.mapExpanded) {
        hud.toggleFullMap(false);
      } else {
        hud.toggleEscapeMenu();
      }
      return;
    }
    if (hud.mapExpanded || hud.escapeExpanded) return;

    const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');

    if (code === 'Tab' || code === 'KeyX') {
      e.preventDefault();
      combat.toggleStanceMode();
    } else if (code === 'Space') {
      e.preventDefault();
      if (!wasDown) {
        const moveVec = computeInputMoveVector();
        combat.triggerJump(moveVec);
      }
    } else if (code === 'KeyL' || code === 'AltLeft' || code === 'AltRight') {
      e.preventDefault();
      if (!wasDown) {
        const moveVec = computeInputMoveVector();
        combat.triggerDodge(moveVec);
      }
    } else if (code === 'KeyJ') {
      combat.triggerLightAttack(sprinting);
    } else if (code === 'KeyU') {
      combat.triggerHeavyAttack(sprinting);
    } else if (code === 'KeyR') {
      combat.triggerRisingUndercut();
    } else if (code === 'KeyV') {
      combat.triggerPiercingThrust();
    } else if (code === 'KeyC') {
      combat.triggerGuardBreakKick();
    } else if (code === 'KeyB') {
      combat.triggerBackhandSlash();
    } else if (code === 'KeyQ') {
      combat.triggerLeapingSmash();
    } else if (code === 'KeyT') {
      combat.triggerArcaneSpellCombo();
    } else if (code === 'KeyY') {
      combat.triggerGrimoireSpell();
    } else if (code === 'KeyN') {
      combat.cycleGrimoireSpell();
    } else if (code === 'ControlLeft' || code === 'ControlRight') {
      combat.toggleCrouch();
    } else if (code === 'KeyK') {
      combat.setGuardHeld(true);
    } else if (code === 'KeyF' || (code === 'Digit1' && !e.altKey)) {
      combat.triggerWeaponSkill(1); // Braver
    } else if (code === 'Digit2' && !e.altKey) {
      combat.triggerWeaponSkill(2); // Focused Thrust
    } else if (code === 'Digit3' && !e.altKey) {
      combat.triggerWeaponSkill(3); // Infinity Spin
    } else if (code === 'Digit4' && !e.altKey) {
      combat.triggerWeaponSkill(4); // Arcane Surge
    } else if (code === 'KeyI' || (code === 'Digit5' && !e.altKey)) {
      combat.triggerLimitBreak(); // Limit Break: Cross-Slash
    } else if (code === 'KeyH') {
      combat.triggerHealGourd();
    } else if (code === 'KeyG') {
      combat.toggleLockOn();
    } else if (code === 'KeyE') {
      const portalPos = world.ascensionPortal?.pos;
      if (portalPos && combat.player.pos.distanceTo(portalPos) < 8.5) {
        combat.advanceToNextChapter().then(() => {
          camYaw = combat.player.yaw;
        });
      } else {
        const sh = combat.getNearestShrine();
        if (sh) {
          combat.restAtShrine(sh);
        } else {
          combat.triggerRisingUndercut();
        }
      }
    } else if (code === 'KeyZ') {
      combat.cycleWeapon();
    } else if (code === 'KeyP') {
      combat.cycleHero();
    } else if (code === 'F1' || (code === 'Digit1' && e.altKey)) {
      e.preventDefault();
      combat.teleportToShrine(1);
      camYaw = combat.player.yaw;
    } else if (code === 'F2' || (code === 'Digit2' && e.altKey)) {
      e.preventDefault();
      combat.teleportToShrine(2);
      camYaw = combat.player.yaw;
    } else if (code === 'F3' || (code === 'Digit3' && e.altKey)) {
      e.preventDefault();
      combat.teleportToShrine(3);
      camYaw = combat.player.yaw;
    } else if (code === 'F4' || (code === 'Digit4' && e.altKey)) {
      e.preventDefault();
      combat.teleportToShrine(4);
      camYaw = combat.player.yaw;
    } else if (code === 'F5' || (code === 'Digit5' && e.altKey)) {
      e.preventDefault();
      combat.teleportToShrine(5);
      camYaw = combat.player.yaw;
    } else if (code === 'F6' || (code === 'Digit7' && !e.altKey)) {
      e.preventDefault();
      combat.cycleChapter(1).then(() => {
        camYaw = combat.player.yaw;
      });
    } else if (code === 'F7' || (code === 'Digit8' && !e.altKey)) {
      e.preventDefault();
      window.__serpentSpine?.teleportToEgyptianVista?.();
    } else if (code === 'Digit6') {
      // Direct shortcut to Zone 2 Left Branch ("Wandering Wight" Sunken Clearing / Secret Gold Vault)
      const bf = topology.getBranchSampleAt(0.55);
      combat.player.pos.copy(bf.point);
      combat.player.yaw = Math.atan2(-bf.flatTangent.x, -bf.flatTangent.z);
      combat.player.puppet.root.position.copy(combat.player.pos);
      combat.player.puppet.root.rotation.y = combat.player.yaw;
      camYaw = combat.player.yaw;
      hud.showBanner('SUNKEN TIDAL HOLLOW — WANDERING COLOSSUS AWAITS', '#62e8c8');
    }
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (lighting.isOpen) return;
    if (e.code === 'KeyK') {
      combat.setGuardHeld(false);
    } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      // Souls/Elden Ring style: quick tap of Shift (< 220ms) triggers Mirage Dodge Roll!
      const heldMs = performance.now() - shiftDownTime;
      if (heldMs > 0 && heldMs < 220 && !hud.mapExpanded && !hud.escapeExpanded) {
        const moveVec = computeInputMoveVector();
        combat.triggerDodge(moveVec);
      }
    }
  });

  function computeInputMoveVector() {
    let forward = 0;
    let right = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) right += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) right -= 1;

    if (forward === 0 && right === 0) return new THREE.Vector3();

    const camForward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw)).normalize();
    // Right-handed cross(camForward, Up(0,1,0)) = (-camForward.z, 0, camForward.x)
    const camRight = new THREE.Vector3(-camForward.z, 0, camForward.x).normalize();

    const move = new THREE.Vector3()
      .addScaledVector(camForward, forward)
      .addScaledVector(camRight, right);
    if (move.lengthSq() > 1e-4) move.normalize();
    return move;
  }

  // Resize Handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  setProgress(96, 'Finishing stonework and scenery...');
  await waitForGLTFLoads();
  await lighting.ready;
  const initialPlayer = combat.player;
  camera.position.set(initialPlayer.pos.x, initialPlayer.pos.y + 3.5, initialPlayer.pos.z + 5.4);
  camera.lookAt(initialPlayer.pos.x, initialPlayer.pos.y + 1.4, initialPlayer.pos.z);
  world.localLightPool.update(1, initialPlayer.pos);
  lighting.update(1, initialPlayer, topology.getZoneForT(0.02), 0);
  setProgress(98, 'Preparing lighting and materials for every section...');
  await new Promise(requestAnimationFrame);
  // Configure the bloom pass target before compiling against its format.
  if (renderPipeline) renderPipeline.render();
  await prepareScene(renderer, scene, camera, scenePass, () => {
    if (renderPipeline) renderPipeline.render();
    renderer.render(scene, camera);
  });
  clearHeldInput();

  // Hide loading overlay
  setProgress(100, 'Entering the Serpent’s Spine...');
  setTimeout(() => {
    if (loadingScreen) loadingScreen.classList.add('fade-out');
  }, 180);

  // Expose automation / inspection handle on window.__serpentSpine
  window.__serpentSpine = {
    renderer,
    scene,
    camera,
    topology,
    world,
    combat,
    animStore,
    hud,
    lighting,
    isWebGPU,
    getCamYaw: () => camYaw,
    setCamYaw: (y) => {
      camYaw = y;
    },
    getCamPitch: () => camPitch,
    setCamPitch: (p) => {
      camPitch = p;
    },
    computeInputMoveVector,
    selectHero: (idOrIdx) => combat.selectHero(idOrIdx),
    selectWeapon: (id) => combat.selectWeapon(id),
    selectSpell: (idxOrId) => combat.selectGrimoireSpell(idxOrId),
    setDifficulty: (id) => {
      const profile = combat.setDifficulty(id);
      hud?._syncDifficultyUI?.();
      return profile;
    },
    getDifficulty: () => combat.getDifficulty(),
    selectChapter: async (chapterNum) => {
      const realm = await combat.selectChapter(chapterNum);
      camYaw = combat.player.yaw;
      if (combat.chapterIndex >= 5) camPitch = 0.14;
      return realm;
    },
    cycleChapter: async (step = 1) => {
      const realm = await combat.cycleChapter(step);
      camYaw = combat.player.yaw;
      if (combat.chapterIndex >= 5) camPitch = 0.14;
      return realm;
    },
    teleportToShrine: (zoneIdx) => {
      combat.teleportToShrine(zoneIdx);
      camYaw = combat.player.yaw;
    },
    teleportToSplineT: (t) => {
      const s = topology.getSampleAt(t);
      combat.player.pos.copy(s.point);
      combat.player.yaw = Math.atan2(-s.flatTangent.x, -s.flatTangent.z);
      combat.player.puppet.root.position.copy(combat.player.pos);
      combat.player.puppet.root.rotation.y = combat.player.yaw;
      camYaw = combat.player.yaw;
      if (combat.chapterIndex >= 5) camPitch = t < 0.22 ? 0.14 : 0.26;
    },
    teleportToBranch: (u = 0.55) => {
      const bf = topology.getBranchSampleAt(u);
      combat.player.pos.copy(bf.point);
      combat.player.yaw = Math.atan2(-bf.flatTangent.x, -bf.flatTangent.z);
      combat.player.puppet.root.position.copy(combat.player.pos);
      combat.player.puppet.root.rotation.y = combat.player.yaw;
      camYaw = combat.player.yaw;
      if (combat.chapterIndex >= 5) camPitch = 0.26;
    },
    teleportToBiomeVista: async (chapterNum = 5, vistaIdx = 0) => {
      if (combat.chapterIndex !== chapterNum) {
        await combat.selectChapter(chapterNum);
      }
      const biomeVistas = {
        5: [
          { label: 'GIZA DESERT & GREAT PYRAMIDS', t: 0.055, isBranch: false, pitch: 0.14 },
          { label: 'PHARAONIC TOMB MURAL CORRIDOR', t: 0.285, isBranch: false, pitch: 0.26 },
          { label: 'SECRET SLIDING-STONE GOLD VAULT', u: 0.72, isBranch: true, pitch: 0.26 },
          { label: 'SOLAR BARQUE SANCTUM OF KHAEMWASET', t: 0.945, isBranch: false, pitch: 0.26 },
        ],
        6: [
          { label: 'BABYLONIAN ZIGGURAT OF ETEMENANKI & ISHTAR GATE', t: 0.055, isBranch: false, pitch: 0.14 },
          { label: 'HANGING GARDENS COLONNADE & CUNEIFORM HALL', t: 0.285, isBranch: false, pitch: 0.24 },
          { label: 'SECRET CHALDEAN ASTROLOGER STAR-VAULT', u: 0.72, isBranch: true, pitch: 0.24 },
          { label: 'ESAGILA ZIGGURAT SANCTUM OF GILGAMESH', t: 0.945, isBranch: false, pitch: 0.22 },
        ],
        7: [
          { label: 'NORSE VALHALLA FJORDS & VIKING DRAGON LONGSHIPS', t: 0.055, isBranch: false, pitch: 0.14 },
          { label: 'GLADSHEIM GREAT MEAD HALL & ELDER FUTHARK RUNESTONES', t: 0.285, isBranch: false, pitch: 0.24 },
          { label: 'SECRET NIDAVELLIR DWARVEN RUNEFORGE TREASURY', u: 0.72, isBranch: true, pitch: 0.24 },
          { label: 'YGGDRASIL WORLD-ASH SANCTUM OF ODIN ALLFATHER', t: 0.945, isBranch: false, pitch: 0.22 },
        ],
        8: [
          { label: 'SUNKEN ATLANTIS ORICHALCUM ACROPOLIS & POSEIDON COLOSSI', t: 0.055, isBranch: false, pitch: 0.14 },
          { label: 'PAROS MARBLE & BIOLUMINESCENT CORAL COLONNADE', t: 0.285, isBranch: false, pitch: 0.24 },
          { label: 'SECRET ATLANTEAN ORICHALCUM ASTROLABE & PEARL VAULT', u: 0.72, isBranch: true, pitch: 0.24 },
          { label: 'ABYSSAL MAELSTROM SANCTUM OF POSEIDON-AEGEUS', t: 0.945, isBranch: false, pitch: 0.22 },
        ],
        9: [
          { label: 'ATHENAION ACROPOLIS APPROACH — GRAND STAIRCASE & TWIN COLOSSI', pos: [24, 50], lookAt: [8, -35], pitch: -0.22 },
          { label: 'FORECOURT OF THE 40M TWIN COLOSSI OF ATHENA PROMACHOS', pos: [24, 34], lookAt: [32, -32], pitch: -0.14 },
          { label: 'THE PARTHENON NAOS — SANCTUARY OF ATHENA PARTHENOS', pos: [20, -27.4], lookAt: [20, -64], pitch: 0.04 },
          { label: 'SACRED ISLAND CORINTHIAN THOLOS & ARCHED LAGOON BRIDGE', pos: [2, 100], lookAt: [-10, 128], pitch: 0.12 },
          { label: 'RUINS TERRACE OF THE FALLEN COLOSSUS HEAD (ΠΑΝΤΑ ΡΕΙ)', pos: [135.5, 145.5], lookAt: [83.2, 59.5], pitch: 0.08 },
          { label: 'THE PALLAS — DOCKED ATHENIAN TRIREME & LAGOON QUAY', pos: [24, 98], lookAt: [30, 110], pitch: 0.14 },
        ],
      };
      const vistas = biomeVistas[chapterNum] || biomeVistas[5];
      const nextIdx =
        vistaIdx !== null
          ? ((vistaIdx % vistas.length) + vistas.length) % vistas.length
          : ((window.__egyptVistaIdx ?? -1) + 1) % vistas.length;
      window.__egyptVistaIdx = nextIdx;
      const v = vistas[nextIdx];
      combat.vfx?.sandbox?.clearAll?.();
      combat.player.hp = combat.player.maxHp;
      combat.player.stamina = combat.player.maxStamina;
      combat.player.state = 'idle';
      combat.player.iFrameTimer = 2.5;
      combat.lockedTarget = null;
      if (Array.isArray(combat.projectiles)) combat.projectiles.length = 0;
      if (Array.isArray(v.pos)) {
        const [px, pz] = v.pos;
        const py = topology.locateWorldPoint({ x: px, y: 0, z: pz }).groundY;
        combat.player.pos.set(px, py, pz);
        if (Array.isArray(v.lookAt)) {
          combat.player.yaw = Math.atan2(-(v.lookAt[0] - px), -(v.lookAt[1] - pz));
        }
      } else if (v.isBranch) {
        const bf = topology.getBranchSampleAt(v.u);
        combat.player.pos.copy(bf.point);
        combat.player.yaw = Math.atan2(-bf.flatTangent.x, -bf.flatTangent.z);
      } else {
        const s = topology.getSampleAt(v.t);
        combat.player.pos.copy(s.point);
        combat.player.yaw = Math.atan2(-s.flatTangent.x, -s.flatTangent.z);
      }
      // Keep nearby enemies from clipping directly into the third-person camera lens on teleport
      for (const enc of combat.encounters || []) {
        enc.engaged = false;
        for (const f of enc.fighters || []) {
          if (f.state === 'dead') continue;
          f.state = 'idle';
          f.attackMove = null;
          f.cooldown = 1.6;
          const dx = f.pos.x - combat.player.pos.x;
          const dz = f.pos.z - combat.player.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 8.5) {
            const fwdX = -Math.sin(combat.player.yaw);
            const fwdZ = -Math.cos(combat.player.yaw);
            const rightX = Math.cos(combat.player.yaw);
            const rightZ = -Math.sin(combat.player.yaw);
            f.pos.x = combat.player.pos.x + fwdX * 8.5 + rightX * 1.8;
            f.pos.z = combat.player.pos.z + fwdZ * 8.5 + rightZ * 1.8;
            f.pos.y = topology.locateWorldPoint(f.pos).groundY;
            if (f.puppet?.root) f.puppet.root.position.copy(f.pos);
          }
        }
      }
      combat.player.puppet.root.position.copy(combat.player.pos);
      combat.player.puppet.root.rotation.y = combat.player.yaw;
      combat.player.puppet.play(combat.getIdleClip(), { loop: true, forceReset: true });
      camYaw = combat.player.yaw;
      camPitch = v.pitch;
      hud.showBanner(v.label, '#ffd740');
      return v;
    },

    teleportToEgyptianVista: async (vistaIdx = null) => {
      return window.__serpentSpine.teleportToBiomeVista(5, vistaIdx);
    },
    teleportToAthenaionVista: async (vistaIdx = null) => {
      return window.__serpentSpine.teleportToBiomeVista(9, vistaIdx);
    },
    getDiagnostics: () => {
      const p = combat.player;
      const loc = topology.locateWorldPoint(p.pos);
      const t = loc.isBranch ? 0.225 : loc.t;
      const zone = topology.getZoneForT(t);
      const chapter = combat.getChapterRealm?.() || { chapter: 1, name: 'The Sakura Threshold' };
      let aliveEnemies = 0;
      let deadEnemies = 0;
      for (const enc of combat.encounters) {
        for (const f of enc.fighters) {
          if (!f.isDead) aliveEnemies++;
          else deadEnemies++;
        }
      }
      return {
        isWebGPU,
        difficulty: combat.getDifficultyId?.() || 'expert',
        difficultyName: combat.getDifficulty?.()?.name || 'Expert',
        chapterIndex: combat.chapterIndex || 1,
        chapterName: chapter.name,
        chapterSubtitle: chapter.subtitle,
        playerPos: p.pos.toArray().map((n) => Number(n.toFixed(2))),
        jumpOffsetY: Number(p.jumpOffsetY.toFixed(2)),
        isGrounded: p.isGrounded,
        playerHp: p.hp,
        playerStamina: Number(p.stamina.toFixed(1)),
        focus: Number(p.focus.toFixed(2)),
        limitGauge: Number(p.limitGauge.toFixed(0)),
        stanceMode: p.stanceMode,
        lastMoveName: p.lastMoveName,
        flowCount: p.flowCount,
        currentClip: p.puppet?.currentClipId,
        playbackRate: Number((p.puppet?.playbackRate || 1).toFixed(2)),
        tiltPitch: Number((p.leanPitch || 0).toFixed(3)),
        tiltRoll: Number((p.leanRoll || 0).toFixed(3)),
        weapon: p.weaponId,
        selectedSpell: combat.getSelectedSpell()?.name,
        imbueTimer: Number((p.imbueTimer || 0).toFixed(1)),
        hero: HERO_ROSTER[p.heroIndex]?.id,
        state: p.state,
        splineT: Number(t.toFixed(3)),
        isBranch: loc.isBranch,
        zoneId: zone.id,
        zoneName: zone.name,
        aliveEnemies,
        deadEnemies,
        solidObstaclesCount: world.solidObstacles.length,
        pigalooClipsCount: animStore.listPigalooClips().length,
        activeBoss: combat.getActiveBoss()?.name || null,
        mapExpanded: hud.mapExpanded,
        escapeExpanded: hud.escapeExpanded,
      };
    },
  };

  // Main High-Responsiveness Frame Loop
  const clock = new THREE.Clock();
  const frameTimings = { frames: 0, lastFrameMs: 0, maxFrameMs: 0, over100ms: 0 };
  let previousFrameTime = performance.now();
  let lastFrameState = { playerLoc: topology.locateWorldPoint(combat.player.pos) };
  window.__serpentSpine.getPerformance = () => ({ ...frameTimings, render: { ...renderer.info.render }, memory: { ...renderer.info.memory } });

  const urlParams = new URLSearchParams(location.search);
  const mapParam = (urlParams.get('map') || '').toLowerCase();
  if (mapParam === 'egypt' || urlParams.get('chapter') === '5') {
    window.__serpentSpine.teleportToBiomeVista(5, 0);
  } else if (mapParam === 'babylon' || urlParams.get('chapter') === '6') {
    window.__serpentSpine.teleportToBiomeVista(6, 0);
  } else if (mapParam === 'valhalla' || mapParam === 'norse' || urlParams.get('chapter') === '7') {
    window.__serpentSpine.teleportToBiomeVista(7, 0);
  } else if (mapParam === 'atlantis' || urlParams.get('chapter') === '8') {
    window.__serpentSpine.teleportToBiomeVista(8, 0);
  } else if (mapParam === 'athenaion' || mapParam === 'athena' || urlParams.get('chapter') === '9') {
    window.__serpentSpine.teleportToBiomeVista(9, 0);
  } else if (urlParams.has('chapter')) {
    const ch = Number(urlParams.get('chapter'));
    if (Number.isFinite(ch) && ch >= 1) {
      window.__serpentSpine.selectChapter(ch);
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const rawDt = Math.min(0.05, clock.getDelta());
    const nowSec = performance.now() * 0.001;
    const frameMs = nowSec * 1000 - previousFrameTime;
    previousFrameTime = nowSec * 1000;
    frameTimings.frames++;
    frameTimings.lastFrameMs = frameMs;
    frameTimings.maxFrameMs = Math.max(frameTimings.maxFrameMs, frameMs);
    if (frameMs > 100) frameTimings.over100ms++;

    const p = combat.player;
    const modalOpen = hud.mapExpanded || hud.escapeExpanded || lighting.isOpen;
    if (!modalOpen) {
      if (keys.has('BracketLeft') || keys.has('Comma')) camYaw += 2.2 * rawDt;
      if (keys.has('BracketRight') || keys.has('Period')) camYaw -= 2.2 * rawDt;
    }

    const moveVec = modalOpen ? new THREE.Vector3() : computeInputMoveVector();
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');

    // 1. Update Extreme Soulslike Combat Engine & VFX
    const simDt = modalOpen ? 0 : rawDt;
    if (!modalOpen) lastFrameState = combat.update(simDt, { moveVec, sprint });
    const frameState = lastFrameState;
    vfx.update(simDt);

    // 2. Update Spring-Arm Lock-On & Scale-Aware Colossal Boss Framing Camera Rig
    const activeLockPos =
      combat.lockedTarget && !combat.lockedTarget.isDead
        ? combat.getLockedTargetWorldPos?.() ||
          combat.lockedTarget.pos.clone().add(new THREE.Vector3(0, (combat.lockedTarget.height || 2.0) * 0.62, 0))
        : null;

    if (activeLockPos) {
      const toTarget = activeLockPos.clone().sub(p.pos);
      const desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
      let diff = desiredYaw - camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      camYaw += diff * Math.min(1, rawDt * 9.5);
    } else if (moveVec.lengthSq() > 0.01 && nowSec - lastMouseLookTime > 0.35) {
      // Gentle third-person auto-follow behind character travel when turning corners
      let diff = p.yaw - camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const forwardBackHold =
        (keys.has('KeyS') || keys.has('ArrowDown')) &&
        !(keys.has('KeyW') || keys.has('ArrowUp'));
      if (!forwardBackHold) {
        camYaw += diff * Math.min(1, rawDt * 1.85);
      }
    }

    const lookTarget = p.pos.clone();
    lookTarget.y += 1.45 - p.jumpOffsetY * 0.18;
    if (activeLockPos) {
      lookTarget.lerp(activeLockPos, 0.36);
    }

    // Scale-aware camera distance pullback when locked onto Giant/Colossal enemies (2.85m - 6.45m)
    const lockHeight =
      combat.lockedTarget && !combat.lockedTarget.isDead ? combat.lockedTarget.height || 2.0 : 2.0;
    const scalePullback = Math.min(3.8, Math.max(0, (lockHeight - 2.15) * 0.82));
    const effectiveCamDist = camDist + scalePullback;

    const horizDist = Math.cos(camPitch) * effectiveCamDist;
    const vertDist = Math.sin(camPitch) * effectiveCamDist;
    const desiredCamPos = new THREE.Vector3(
      p.pos.x + Math.sin(camYaw) * horizDist,
      p.pos.y + 1.35 + scalePullback * 0.22 + vertDist - p.jumpOffsetY * 0.15,
      p.pos.z + Math.cos(camYaw) * horizDist
    );

    // Keep camera above ground, inside canyon walls & out of solid rocks/pillars so walls never occlude the duel
    topology.clampCameraPosition(lookTarget, desiredCamPos, world.solidObstacles);

    if (!cameraInitialized) {
      smoothCamPos.copy(desiredCamPos);
      smoothLookAt.copy(lookTarget);
      cameraInitialized = true;
    } else {
      smoothCamPos.lerp(desiredCamPos, Math.min(1, rawDt * 16));
      smoothLookAt.lerp(lookTarget, Math.min(1, rawDt * 20));
    }

    camera.position.copy(smoothCamPos);

    // Apply camera trauma shake on heavy impacts / deflections
    if (combat.cameraShake > 0.001) {
      const shakeAmt = combat.cameraShake * 0.28;
      camera.position.x += (Math.random() - 0.5) * shakeAmt;
      camera.position.y += (Math.random() - 0.5) * shakeAmt;
      camera.position.z += (Math.random() - 0.5) * shakeAmt;
    }

    // Dynamic FOV pulse during Mirage Step time dilation or Focus Strike
    const targetFov =
      combat.mirageSlowTimer > 0
        ? 64
        : p.state === 'attack' && p.attackDef?.id === 'focusStrike'
        ? 62
        : sprint
        ? 59
        : 56;
    camera.fov += (targetFov - camera.fov) * Math.min(1, rawDt * 9);
    camera.updateProjectionMatrix();

    camera.lookAt(smoothLookAt);

    // 3. Update Sun Shadow Tracking & Per-Zone Atmosphere
    sunLight.position.set(p.pos.x + 24, p.pos.y + 38, p.pos.z + 18);
    sunLight.target.position.copy(p.pos);
    playerRimLight.position.set(p.pos.x, p.pos.y + 2.2, p.pos.z);

    const playerLoc = frameState.playerLoc;
    const zone = topology.getZoneForT(playerLoc.isBranch ? 0.225 : playerLoc.t);
    lighting.update(rawDt, p, zone, nowSec, playerLoc);

    // 4. Update World (Water Basins, Obsidian Seals, Spline Sector Culling) & HUD
    world.update(simDt, playerLoc);
    hud.update(rawDt, camera, frameState);

    // 5. Render Frame via WebGPU TSL RenderPipeline or direct renderer
    if (useBloomPipeline && renderPipeline) {
      renderPipeline.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  animate();
}

bootstrap().catch((err) => {
  console.error('[SerpentSpine] Fatal initialization error:', err);
  const statusEl = document.getElementById('loading-status');
  if (statusEl) {
    statusEl.textContent = `Initialization error: ${err.message}`;
    statusEl.style.color = '#ff5544';
  }
});
