import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = new URL('../output/checks/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.REINCARNATION_BROWSER || undefined,
  args: ['--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.REINCARNATION_URL || 'http://127.0.0.1:5199/');
  await page.waitForFunction(() => !!window.__serpentSpine, null, { timeout: 180_000 });
  await page.waitForTimeout(3000);
  const result = await page.evaluate(async () => {
    const game = window.__serpentSpine, samples = [], longtasks = [];
    const observer = new PerformanceObserver(list => longtasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))));
    observer.observe({ type: 'longtask', buffered: false });
    // Isolate render/section transitions from combat and fog-gate restrictions.
    // This runs in a disposable browser session, not the user's game session.
    for (const encounter of game.combat.encounters) encounter.cleared = true;
    for (const t of [.02, .17, .33, .48, .65, .81, .95]) {
      game.combat.player.iFrameTimer = 60;
      game.teleportToSplineT(t);
      const frames = await new Promise(resolve => {
        let previous = performance.now(), start = previous; const frames = [];
        function next(now) {
          frames.push(now - previous); previous = now;
          if (now - start >= 2000) resolve(frames); else requestAnimationFrame(next);
        }
        requestAnimationFrame(next);
      });
      const sorted = [...frames].sort((a, b) => a - b);
      samples.push({ t, frames: frames.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: Math.max(...frames), over100: frames.filter(ms => ms > 100).length, over250: frames.filter(ms => ms > 250).length });
    }
    observer.disconnect();
    return { isWebGPU: game.isWebGPU, samples, longtasks: longtasks.filter(task => task.duration > 100), renderer: { ...game.renderer.info.render }, memory: { ...game.renderer.info.memory } };
  });
  result.errors = errors;
  result.method = { viewport: [1440, 900], sampleWindowMs: 2000, isolatedFromCombat: true, browser: browser.version(), preset: 'Explorer' };
  await writeFile(new URL('performance-after.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
