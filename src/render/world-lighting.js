import * as THREE from 'three/webgpu';
import { texture, uniform, vec3, dot, mix } from 'three/tsl';
import { LIGHTING_PRESETS, CONTROL_SCHEMA } from '../vendor/pigaloo/presentation.js';
import { captureWorldLightingBaseline, applyWorldLightingPreset } from '../vendor/pigaloo/world/lighting-presets.js';
import { createSpotlightLens } from '../vendor/pigaloo/spotlight-lens.js';
import { applyLightColor } from '../vendor/pigaloo/light-color.js';
import { GAME_CONTROLS, PRESENTATION_KEY, sanitizeLightingControls, lampStrength } from './lighting-values.js';

// Gradient palettes adapted from J3Stage's src/kit/panel-sky.js. Pigaloo owns
// the shared look catalog, control limits, color maths, and Fresnel beam cookie.
const SKIES = {
  dawn: ['#7aa6e8', '#ffd2b0', '#56534c'],
  dusk: ['#4876cb', '#ffb074', '#3a2f3a'],
  noon: ['#2f74d0', '#bfe0ff', '#6f6a5c'],
  night: ['#05081a', '#1d2a55', '#05060a'],
  neon: ['#2a0a4a', '#ff5fb8', '#120a24'],
};
const SCHEMA = { ...CONTROL_SCHEMA, ...GAME_CONTROLS };
const SKY_MODES = { original: 'Original · Pigaloo panorama', dawn: 'Apricot dawn', dusk: 'Tangerine dusk', noon: 'Clear daylight', night: 'Blue night', neon: 'Neon', custom: 'Custom colors', image: 'My sky image' };
const BASE_CONTROLS = {
  exposure: 1, ambient: 1, key: 1, fill: 0, rim: 0, intensity: 1,
  height: 3.2, back: 2.2, side: 0.8, aim: 4.5, targetHeight: -1.7,
  angle: 48, focus: 0.12, softness: 0.82, range: 22, decay: 1.45,
  lampColor: '#ffe0ae', warmth: 0, lightSaturation: 1, tintAmount: 0,
  tintColor: '#ffbf80', skyBrightness: 1, skySaturation: 1, skySpeed: 0,
  skyZenith: '#4876cb', skyHorizon: '#ffb074', skyCloudColor: '#3a2f3a',
  fogDensity: 1, skyRotation: 0, renderScale: 1,
};

export class WorldLighting {
  constructor({ scene, renderer, camera, hemiLight, sunLight, playerRimLight, world, onRenderSettings }) {
    Object.assign(this, { scene, renderer, camera, world, playerRimLight, onRenderSettings });
    this.state = { preset: 'explorer', lamp: 'auto', sky: 'original', bloom: true, overrides: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(PRESENTATION_KEY) || '{}');
      if (saved.preset === 'original' || saved.preset === 'explorer' || Object.hasOwn(LIGHTING_PRESETS, saved.preset)) this.state.preset = saved.preset;
      if (['on', 'off', 'auto'].includes(saved.lamp)) this.state.lamp = saved.lamp;
      if (Object.hasOwn(SKY_MODES, saved.sky) && saved.sky !== 'image') this.state.sky = saved.sky;
      if (typeof saved.bloom === 'boolean') this.state.bloom = saved.bloom;
      this.state.overrides = sanitizeLightingControls(saved.overrides, SCHEMA);
    } catch { /* Storage is optional. */ }
    this.fill = new THREE.DirectionalLight('#ebaf88', 0);
    this.rim = new THREE.DirectionalLight('#c5b5ee', 0);
    this.fill.name = 'Presentation fill'; this.rim.name = 'Presentation rim';
    scene.add(this.fill, this.fill.target, this.rim, this.rim.target);
    this.rig = { ambient: hemiLight, sun: sunLight, fill: this.fill, rim: this.rim, scene, renderer };
    captureWorldLightingBaseline(this.rig);

    this.lamp = new THREE.SpotLight('#ffe0ae', 0, 22, Math.PI / 3.75, 0.82, 1.45);
    this.lamp.name = 'Character shoulder lantern';
    // No extra shadow pass or topology changes when toggling the lantern.
    this.lamp.castShadow = false;
    this.lens = createSpotlightLens();
    this.lamp.map = this.lens.texture;
    this.spill = new THREE.PointLight('#c5d0df', 0, 5.5, 1.8);
    this.spill.name = 'Character lantern soft spill';
    scene.add(this.lamp, this.lamp.target, this.spill);
    this.mount = new THREE.Vector3(); this.aim = new THREE.Vector3();
    this.forward = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.fogTarget = new THREE.Color();
    this.probeTime = Infinity; this.sheltered = false; this.nearPractical = false;
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 512; this.skyCanvas.height = 256;
    this.gradientTexture = new THREE.CanvasTexture(this.skyCanvas);
    this.gradientTexture.colorSpace = THREE.SRGBColorSpace;
    this.originalTexture = null; this.customTexture = null;
    this.skySample = texture(this.gradientTexture);
    this.skyBrightness = uniform(1); this.skySaturation = uniform(1);
    const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    const sample = this.skySample.rgb;
    skyMaterial.colorNode = mix(vec3(dot(sample, vec3(0.2126, 0.7152, 0.0722))), sample, this.skySaturation).mul(this.skyBrightness);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(15500, 32, 20), skyMaterial);
    this.sky.name = 'Presentation sky'; this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.apply();
    this.ready = new THREE.TextureLoader().loadAsync('/sibling/pigaloo/public/assets/sky/sky_131_2k.png').then(tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      this.originalTexture = tex;
      this.applySky();
    }).catch(error => { console.warn('[Lighting] Original sky unavailable:', error.message); });
    this.buildPanel();
  }

  get isOpen() { return this.dialog.open; }

  get controls() {
    const base = LIGHTING_PRESETS[this.state.preset];
    const colors = {};
    for (const key of ['lampColor', 'skyColor', 'sunColor', 'fillColor', 'rimColor']) if (base?.[key]) colors[key] = base[key];
    return { ...BASE_CONTROLS, ...(base ? { fill: 1, rim: 1 } : {}), ...colors, ...(base?.controls || {}), ...this.state.overrides };
  }

  setPreset(preset) {
    if (preset !== 'original' && preset !== 'explorer' && !Object.hasOwn(LIGHTING_PRESETS, preset)) return;
    this.state.preset = preset;
    this.state.overrides = {};
    this.state.lamp = preset === 'original' ? 'off' : 'auto';
    this.state.sky = ({ sunset: 'dusk', cycle: 'original' })[LIGHTING_PRESETS[preset]?.controls?.skyMode] || 'original';
    this.apply(); this.save(); this.syncPanel();
  }

  setControls(values) {
    this.state.overrides = { ...this.state.overrides, ...sanitizeLightingControls(values, SCHEMA) };
    this.apply(); this.save();
  }

  save() {
    try { localStorage.setItem(PRESENTATION_KEY, JSON.stringify(this.state)); } catch { /* Optional storage. */ }
  }

  apply() {
    this.activeControls = null;
    const controls = this.controls;
    const authored = this.state.preset === 'original' || this.state.preset === 'explorer';
    const profile = authored ? { id: 'noir', exposure: 1.06, controls } : { ...LIGHTING_PRESETS[this.state.preset], controls };
    applyWorldLightingPreset(this.rig, profile);
    // These are added presentation lights, so the authored preset starts at
    // zero. Treat their sliders as power instead of multiplying zero forever.
    if (authored) { this.fill.intensity = controls.fill; this.rim.intensity = controls.rim; }
    this.lamp.color.set(controls.lampColor);
    applyLightColor(this.lamp.color, controls);
    this.lamp.angle = THREE.MathUtils.degToRad(controls.angle);
    this.lamp.penumbra = controls.softness;
    this.lamp.distance = controls.range;
    this.lamp.decay = controls.decay;
    this.lens.update(controls.focus);
    this.skyBrightness.value = controls.skyBrightness;
    this.skySaturation.value = controls.skySaturation;
    this.onRenderSettings?.({ bloom: this.state.bloom, renderScale: controls.renderScale });
    this.applySky();
  }

  applySky() {
    const mode = this.state.sky;
    if (mode === 'original' && this.originalTexture) { this.skySample.value = this.originalTexture; return; }
    if (mode === 'image' && this.customTexture) { this.skySample.value = this.customTexture; return; }
    const controls = this.controls;
    const colors = SKIES[mode] || (mode === 'original' ? ['#0b151e', '#0d1922', '#0b151e'] : [controls.skyZenith, controls.skyHorizon, controls.skyCloudColor]);
    const ctx = this.skyCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, colors[0]); gradient.addColorStop(0.48, colors[1]); gradient.addColorStop(0.57, colors[2]); gradient.addColorStop(1, colors[2]);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 256);
    this.gradientTexture.needsUpdate = true;
    this.skySample.value = this.gradientTexture;
  }

  update(dt, player, zone, time, location = null) {
    const controls = this.activeControls || (this.activeControls = this.controls);
    const blend = 1 - Math.exp(-dt * 9);
    this.forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    this.right.set(-this.forward.z, 0, this.forward.x);
    this.mount.copy(player.pos).addScaledVector(this.forward, -controls.back).addScaledVector(this.right, controls.side);
    this.mount.y += 1.7 + controls.height;
    this.aim.copy(player.pos).addScaledVector(this.forward, controls.aim);
    this.aim.y += 1.7 + controls.targetHeight;
    this.lamp.position.lerp(this.mount, blend);
    this.lamp.target.position.lerp(this.aim, blend);
    this.spill.position.copy(player.pos); this.spill.position.y += 1.8;
    this.fill.position.copy(player.pos).addScaledVector(this.right, 8); this.fill.position.y += 8;
    this.fill.target.position.copy(player.pos);
    this.rim.position.copy(player.pos).addScaledVector(this.forward, -6); this.rim.position.y += 6;
    this.rim.target.position.copy(player.pos);
    this.probeTime += dt;
    if (this.probeTime >= 0.2) {
      this.probeTime = 0;
      const chIdx = this.world?.activeChapterIndex || 1;
      const isAthenaion = chIdx === 9 || Boolean(this.world?.isAthenaionBiome);
      const inMonumentBiome = !isAthenaion && (Boolean(this.world?.isEgyptianBiome) || chIdx >= 5);
      const inMonumentInterior = inMonumentBiome && (Boolean(location?.isBranch) || (location?.t ?? 0) >= 0.24);
      this.sheltered = !isAthenaion && (zone?.index === 3 || player.pos.y < 4 || inMonumentInterior);
      for (const obstacle of this.world.solidObstacles) {
        if (obstacle.kind !== 'arch_pier') continue;
        const dx = obstacle.x - player.pos.x, dz = obstacle.z - player.pos.z;
        if (dx * dx + dz * dz < 64) { this.sheltered = true; break; }
      }
      this.nearPractical = this.world.shrineObjects.some(shrine => shrine.worldPos.distanceToSquared(player.pos) < 64);
    }
    const chIdx = this.world?.activeChapterIndex || 1;
    const isAthenaion = chIdx === 9 || Boolean(this.world?.isAthenaionBiome);
    const inMonumentBiome = !isAthenaion && (Boolean(this.world?.isEgyptianBiome) || chIdx >= 5);
    const inMonumentOutdoors = inMonumentBiome && !location?.isBranch && (location?.t ?? 0) < 0.24;
    const brightArena = isAthenaion || (zone?.index === 5 && location?.t > 0.925 && !inMonumentBiome);
    const adaptiveGain = this.state.lamp === 'auto' && brightArena ? 0.12 : 1;
    const monumentBoost = inMonumentBiome && !inMonumentOutdoors ? 1.25 : 1.0;
    const strength = lampStrength(this.state.lamp, this.sheltered, this.nearPractical) * controls.intensity * adaptiveGain * monumentBoost;
    const profile = LIGHTING_PRESETS[this.state.preset];
    this.lamp.intensity += (75 * strength * (profile?.lampIntensity ?? 1) - this.lamp.intensity) * blend;
    this.spill.intensity += (2.4 * strength * (profile?.lampSpill ?? 1) - this.spill.intensity) * blend;
    if (this.camera) this.sky.position.copy(this.camera.position);
    this.sky.rotation.y = THREE.MathUtils.degToRad(controls.skyRotation) + time * controls.skySpeed * 0.0015;
    if (zone && this.scene.fog) {
      let targetFogHex = zone.fogColor;
      let baseDensity = zone.fogDensity;
      if (isAthenaion) {
        targetFogHex = 0x8cb4d2;
        baseDensity = 0.00038;
      } else if (chIdx === 5 || this.world?.isEgyptianBiome) {
        targetFogHex = inMonumentOutdoors ? 0x382816 : 0x1c140b;
        baseDensity = inMonumentOutdoors ? 0.0021 : 0.0046;
      } else if (chIdx === 6) {
        targetFogHex = inMonumentOutdoors ? 0x102a42 : 0x0a1c2d;
        baseDensity = inMonumentOutdoors ? 0.0020 : 0.0042;
      } else if (chIdx === 7) {
        targetFogHex = inMonumentOutdoors ? 0x0e2433 : 0x121b26;
        baseDensity = inMonumentOutdoors ? 0.0021 : 0.0042;
      } else if (chIdx === 8) {
        targetFogHex = inMonumentOutdoors ? 0x082636 : 0x061924;
        baseDensity = inMonumentOutdoors ? 0.0021 : 0.0042;
      }
      this.fogTarget.setHex(targetFogHex);
      const fogBlend = Math.min(1, dt * 2.5);
      this.scene.fog.color.lerp(this.fogTarget, fogBlend);
      if (this.scene.background && typeof this.scene.background.lerp === 'function') {
        this.scene.background.lerp(this.fogTarget, fogBlend);
      } else {
        this.scene.background = this.fogTarget.clone();
      }
      this.scene.fog.density += (baseDensity * controls.fogDensity - this.scene.fog.density) * fogBlend;
    }
  }

  toggle(force = !this.isOpen) {
    if (force && !this.isOpen) {
      document.exitPointerLock?.();
      this.dialog.showModal();
      this.dialog.dispatchEvent(new Event('presentationopen'));
    } else if (!force && this.isOpen) this.dialog.close();
  }

  syncPanel() {
    this.activeControls = null;
    this.dialog.querySelector('[name="preset"]').value = this.state.preset;
    this.dialog.querySelector('[name="lamp"]').value = this.state.lamp;
    this.dialog.querySelector('[name="sky"]').value = this.state.sky;
    this.dialog.querySelector('[name="bloom"]').checked = this.state.bloom;
    const controls = this.controls;
    this.dialog.querySelectorAll('[data-control]').forEach(input => {
      input.value = controls[input.dataset.control] ?? SCHEMA[input.dataset.control].value;
      const output = input.parentElement.querySelector('output');
      if (output) output.value = input.value;
    });
  }

  buildPanel() {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'presentation-panel'; this.dialog.id = 'lighting-settings';
    this.dialog.setAttribute('aria-labelledby', 'lighting-title');
    this.dialog.innerHTML = `<header><div><h2 id="lighting-title">Light & sky</h2><p>Original preserves the authored look. Explorer adds a soft character lantern.</p></div><button type="button" data-close aria-label="Close lighting settings">Close · Esc</button></header>
      <div class="presentation-pickers"><label>Lighting look<select name="preset"><option value="original">Original</option><option value="explorer">Explorer · readable shadows</option>${Object.values(LIGHTING_PRESETS).map(p => `<option value="${p.id}">${p.label}</option>`).join('')}</select></label><label>Character lantern<select name="lamp"><option value="auto">Auto · stronger in sheltered areas</option><option value="on">Always on</option><option value="off">Off</option></select></label><label>Skybox<select name="sky">${Object.entries(SKY_MODES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label></div>
      <div class="presentation-groups"></div><footer><label class="presentation-check"><input type="checkbox" name="bloom"> Bloom</label><label class="sky-file">Load sky image <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose a panorama sky image"></label><button type="button" data-reset>Reset this look</button><button type="button" data-original>Restore Original</button><span role="status" class="presentation-status">Settings save on this device.</span></footer>`;
    const groups = [
      ['Scene', ['exposure', 'ambient', 'key', 'fill', 'rim', 'fogDensity']],
      ['Character lantern', ['intensity', 'range', 'angle', 'softness', 'focus', 'decay', 'lampColor']],
      ['Placement & color', ['height', 'back', 'side', 'aim', 'targetHeight', 'warmth', 'lightSaturation', 'tintAmount', 'tintColor', 'skyColor', 'sunColor', 'fillColor', 'rimColor']],
      ['Sky & performance', ['skyBrightness', 'skySaturation', 'skyRotation', 'skySpeed', 'skyZenith', 'skyHorizon', 'skyCloudColor', 'renderScale']],
    ];
    const host = this.dialog.querySelector('.presentation-groups');
    for (const [title, keys] of groups) {
      const section = document.createElement('details'); section.open = title === 'Scene';
      section.addEventListener('toggle', () => {
        if (section.open) for (const other of host.children) if (other !== section) other.open = false;
      });
      const summary = document.createElement('summary'); summary.textContent = title; section.append(summary);
      for (const key of keys) {
        const spec = SCHEMA[key];
        const label = document.createElement('label');
        label.innerHTML = `<span>${spec.label}</span>${spec.type === 'color' ? `<input type="color" data-control="${key}">` : `<output></output><input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" data-control="${key}">`}`;
        label.querySelector('input').addEventListener('input', event => {
          const input = event.currentTarget;
          const value = spec.type === 'color' ? input.value : Number(input.value);
          const output = label.querySelector('output'); if (output) output.value = input.value;
          this.setControls({ [key]: value }); this.activeControls = null;
        });
        section.append(label);
      }
      host.append(section);
    }
    this.dialog.querySelector('[data-close]').onclick = () => this.toggle(false);
    this.dialog.querySelector('[name="preset"]').onchange = event => this.setPreset(event.target.value);
    this.dialog.querySelector('[name="lamp"]').onchange = event => { this.state.lamp = event.target.value; this.save(); };
    this.dialog.querySelector('[name="sky"]').onchange = event => { this.state.sky = event.target.value; this.applySky(); this.save(); };
    this.dialog.querySelector('[name="bloom"]').onchange = event => { this.state.bloom = event.target.checked; this.apply(); this.save(); };
    this.dialog.querySelector('[data-reset]').onclick = () => this.setPreset(this.state.preset);
    this.dialog.querySelector('[data-original]').onclick = () => this.setPreset('original');
    this.dialog.querySelector('[type="file"]').onchange = async event => {
      const file = event.target.files?.[0]; if (!file) return;
      const url = URL.createObjectURL(file);
      const request = this.skyUploadRequest = (this.skyUploadRequest || 0) + 1;
      try {
        const tex = await new THREE.TextureLoader().loadAsync(url);
        if (request !== this.skyUploadRequest) { tex.dispose(); return; }
        this.customTexture?.dispose(); this.customTexture = tex; tex.colorSpace = THREE.SRGBColorSpace;
        this.state.sky = 'image'; this.applySky(); this.save(); this.syncPanel();
        this.dialog.querySelector('[role="status"]').textContent = 'Your sky image stays for this session. Other settings save on this device.';
      } catch { this.dialog.querySelector('[role="status"]').textContent = 'Could not load that sky image.'; }
      finally { URL.revokeObjectURL(url); }
    };
    document.body.append(this.dialog);
    document.getElementById('btn-lighting-settings')?.addEventListener('click', () => this.toggle());
    this.syncPanel();
  }
}
