import * as THREE from 'three';

/** Keep the render light topology constant across sector boundaries.
 * Adding/removing a sector's PointLights otherwise recompiles every lit material.
 * Sources retain their authored color, falloff and animated intensity; only the
 * six nearest practical lights are assigned to a fixed set of shader slots. */
export class LocalLightPool {
  constructor(scene, roots, count = 6) {
    this.sources = [];
    this.candidates = [];
    this.bindings = [];
    this.elapsed = Infinity;
    scene.updateMatrixWorld(true);
    for (const root of roots) root.traverse(object => {
      if (!object.isPointLight) return;
      this.sources.push({ light: object, parent: object.parent, position: object.getWorldPosition(new THREE.Vector3()), distanceSq: 0 });
    });
    for (const source of this.sources) source.light.removeFromParent();
    this.slots = Array.from({ length: count }, (_, index) => {
      const light = new THREE.PointLight(0xffffff, 0, 15, 1.5);
      light.name = `Practical light slot ${index + 1}`;
      // Keep visible even at zero power: visibility changes the shader cache key.
      scene.add(light);
      return light;
    });
  }

  update(dt, position) {
    this.elapsed += dt;
    if (this.elapsed >= 0.1) {
      this.elapsed = 0;
      this.candidates.length = 0;
      for (const source of this.sources) {
        let visible = true;
        for (let parent = source.parent; parent; parent = parent.parent) {
          if (!parent.visible) { visible = false; break; }
        }
        source.distanceSq = source.position.distanceToSquared(position);
        if (visible && source.distanceSq < (source.light.distance + 24) ** 2) this.candidates.push(source);
      }
      this.candidates.sort((a, b) => a.distanceSq - b.distanceSq);
      this.bindings = this.candidates.slice(0, this.slots.length);
      for (let i = 0; i < this.slots.length; i++) {
        const source = this.bindings[i], slot = this.slots[i];
        if (!source) { slot.intensity = 0; continue; }
        slot.position.copy(source.position);
        slot.color.copy(source.light.color);
        slot.distance = source.light.distance;
        slot.decay = source.light.decay;
      }
    }
    for (let i = 0; i < this.bindings.length; i++) this.slots[i].intensity = this.bindings[i].light.intensity;
  }
}
