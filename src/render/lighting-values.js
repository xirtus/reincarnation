export const PRESENTATION_KEY = 'reincarnation-presentation-v1';

export const GAME_CONTROLS = {
  fogDensity: { label: 'Fog density', min: 0, max: 2, step: 0.05, value: 1 },
  skyRotation: { label: 'Sky rotation', min: -180, max: 180, step: 1, value: 0 },
  renderScale: { label: 'Render scale', min: 0.65, max: 1, step: 0.05, value: 1 },
};

export function sanitizeLightingControls(input, schema) {
  const result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const [key, spec] of Object.entries(schema)) {
    const value = input[key];
    if (spec.type === 'color') {
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) result[key] = value;
    } else if (spec.type === 'select') {
      if (typeof value === 'string' && Object.hasOwn(spec.options, value)) result[key] = value;
    } else if (spec.type === 'checkbox') {
      if (typeof value === 'boolean') result[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = Math.max(spec.min, Math.min(spec.max, value));
    }
  }
  return result;
}

export function lampStrength(mode, sheltered, nearPractical) {
  if (mode === 'off') return 0;
  if (mode === 'on') return 1;
  return sheltered ? 1 : nearPractical ? 0.25 : 0.65;
}
