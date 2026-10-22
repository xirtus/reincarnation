# Art assets and licensing

**The GPL-3.0 license in [`LICENSE`](LICENSE) covers the source code in this repository. It does not cover the art assets.**

This project is a fan-made, non-commercial art project. The reference build ships with optimized,
heavily reworked art so that the game is playable out of the box. That art is **not** original to
this repository and is **not** licensed to you under the GPL.

## What is GPL-3.0

- Everything under `src/` (including the vendored Pigaloo lighting modules in `src/vendor/`).
- `index.html`, `vite.config.js`, `scripts/`, `tests/`, and the project documentation.
- Original procedural generation, combat, rendering, HUD, and world-building code.

## What is not GPL-3.0

| Path | Contents | Status |
| --- | --- | --- |
| `public/` | Characters, creatures, weapons, environment props, skybox, baked geometry, textures | Fan-made / derived art. All rights reserved by their respective creators. **Not GPL.** |
| `public/assets/` | Retargeted animation packs used by the build pipeline | Mixamo-derived and modified. **Not GPL.** |
| `src/ui/fonts/*.ttf` | Barlow Semi Condensed | SIL Open Font License 1.1; see `src/ui/fonts/OFL.txt`. |

These assets are **aggregated with** the code, not part of the GPL-licensed work. The GPL gives you
rights to the source code; it does not grant rights to redistribute, extract, or reuse the art.

## Character and environment art

The cast, weapons, and environment kits are fan-made assets built from or inspired by existing
franchises. They have been substantially rebuilt, retextured, optimized, and adapted for this
project, but they remain derivative works. They are included only so the reference build can run.
No permission is granted to reuse them separately, in whole or in part, and no ownership is claimed
over the underlying designs.

If you are a rights holder and want an asset removed, please open an issue or contact the maintainer.
We will remove it promptly.

## Animation

The animation clips are derived from Mixamo and other motion sources, then retargeted, trimmed,
repaired, and adjusted for the Anima 44-bone rig. Use of the original motion is subject to the
applicable source terms (including Adobe Mixamo's terms) and is not granted by the GPL. The optimized
`.glb` and JSON bundles in `public/assets/` and `public/sibling/` are likewise not GPL.

## Third-party textures and fonts

- Poly Haven textures in `public/textures/polyhaven/` are CC0.
- Barlow Semi Condensed is licensed under the SIL Open Font License 1.1.
- Inter and Cinzel are referenced as optional display fonts with system fallbacks; they are not bundled.

See [`THIRD_PARTY.md`](THIRD_PARTY.md) for dependency and credit details.

## What this means for forks

You are free to fork, modify, and redistribute the **code** under GPL-3.0. If you distribute a build,
you must either:

1. keep the included art under its separate terms (with this notice intact), or
2. replace the art with your own assets.

If you want a fully GPL-licensed build, remove the contents of `public/` and `public/assets/` and supply
your own models, animations, and textures.
