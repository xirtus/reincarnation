# Third-party software and credits

## Runtime and build dependencies

| Project | Version | License | Use |
| --- | --- | --- | --- |
| [three.js](https://threejs.org/) | 0.185.1 | MIT | WebGPU renderer, TSL, GLTF loading |
| [Vite](https://vite.dev/) | 7.1.0 | MIT | Development server and production build |
| [Playwright](https://playwright.dev/) | 1.55.0 | Apache-2.0 | Browser presentation tests and screenshot capture |

Dependencies are installed with npm and are not vendored in this repository.

## Vendored code

`src/vendor/pigaloo/` contains the lighting presentation modules shared with
[Pigaloo](https://github.com/xirtus), authored by the same maintainer and licensed here under
GPL-3.0 as part of this project.

## Art and audio credits

- **Characters, creatures, weapons, and environment kits** — fan-made, heavily modified and
  optimized for this project. Not GPL; see [`ASSETS.md`](ASSETS.md).
- **Animation** — derived from Mixamo and other motion sources, retargeted to the Anima 44-bone
  rig and adjusted for combat timing. Not GPL; use is subject to the source terms.
- **Textures** — [Poly Haven](https://polyhaven.com/) (CC0), plus procedural canvas textures
  generated at runtime.
- **Fonts** — Barlow Semi Condensed (SIL OFL 1.1, bundled). Inter and Cinzel are referenced as optional display fonts with system fallbacks.
- **Sky panorama** — `public/sibling/pigaloo/public/assets/sky/sky_131_2k.png`, used under its
  original source terms.

## Disclaimer

This is an independent fan project. It is not affiliated with, endorsed by, or sponsored by
FromSoftware, Bandai Namco, Square Enix, Adobe, or any other rights holder. Character names and
designs referenced by the art belong to their respective owners.
