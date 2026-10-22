import { chromium } from 'playwright';
import assert from 'node:assert/strict';
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
  const start = Date.now();
  await page.goto(process.env.REINCARNATION_URL || 'http://127.0.0.1:5199/');
  await page.waitForFunction(() => !!window.__serpentSpine, null, { timeout: 180_000 });
  await page.waitForTimeout(500);
  const bootMs = Date.now() - start;
  await page.evaluate(() => { window.__serpentSpine.combat.player.iFrameTimer = 300; });

  const blossoms = await page.evaluate(() => {
    let result;
    window.__serpentSpine.scene.traverse(object => {
      if (object.material?.map?.userData?.flowerScale) result = object.material.map.userData;
    });
    return result;
  });
  assert.equal(blossoms.flowerScale, .25);
  assert.equal(blossoms.clusterMultiplier, 16);
  assert.equal(await page.locator('.sym-stack:not(.collapsed)').count(), 1);
  await page.locator('[data-stack-toggle="blade"]').click();
  assert.equal(await page.locator('.sym-stack:not(.collapsed)').getAttribute('data-stack-group'), 'blade');
  assert.equal(await page.locator('.sym-stack:not(.collapsed) .skill-btn:visible').count(), 4);
  await page.locator('[data-stack-toggle="blade"]').click();
  assert.equal(await page.locator('.sym-stack:not(.collapsed)').count(), 0);
  await page.locator('[data-stack-toggle="atb"]').click();
  await page.locator('.crest-hub').click();
  assert.equal(await page.locator('.vessel-crest-strip .crest-btn:visible').count(), 4);
  await page.locator('.crest-hub').click();
  await page.screenshot({ path: new URL('twin-crests.png', output).pathname });

  await page.keyboard.press('Backquote');
  const stance = await page.evaluate(() => window.__serpentSpine.combat.player.stanceMode);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => window.__serpentSpine.combat.player.stanceMode), stance);
  await page.keyboard.press('o');
  await page.locator('#lighting-settings').waitFor({ state: 'visible' });
  const pausedAt = await page.evaluate(() => {
    const p = window.__serpentSpine.combat.player;
    return { hp: p.hp, iframe: p.iFrameTimer, position: p.pos.toArray() };
  });
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => {
    const p = window.__serpentSpine.combat.player;
    return { hp: p.hp, iframe: p.iFrameTimer, position: p.pos.toArray() };
  }), pausedAt);
  await page.locator('[name="preset"]').selectOption('original');
  const original = await page.evaluate(() => {
    const g = window.__serpentSpine;
    return { exposure: g.renderer.toneMappingExposure, ambient: g.lighting.rig.ambient.intensity, key: g.lighting.rig.sun.intensity, fill: g.lighting.fill.intensity, rim: g.lighting.rim.intensity, lamp: g.lighting.state.lamp };
  });
  assert.deepEqual(original, { exposure: 1.12, ambient: .85, key: 2.55, fill: 0, rim: 0, lamp: 'off' });
  await page.locator('[name="preset"]').selectOption('moonlit');
  assert.equal(await page.evaluate(() => window.__serpentSpine.renderer.toneMappingExposure), 1.08);
  assert.equal(await page.evaluate(() => window.__serpentSpine.lighting.lamp.color.getHexString()), 'ffd29c');
  await page.locator('[name="sky"]').selectOption('night');
  await page.locator('summary').filter({ hasText: 'Sky & performance' }).click();
  await page.locator('[data-control="skyRotation"]').evaluate(input => {
    input.value = '45'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => window.__serpentSpine.lighting.controls.skyRotation), 45);
  await page.screenshot({ path: new URL('lighting-settings.png', output).pathname });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#lighting-settings').isVisible(), false);
  assert.equal(await page.evaluate(() => window.__serpentSpine.hud.escapeExpanded), false);
  await page.evaluate(() => { window.__serpentSpine.lighting.setPreset('explorer'); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: new URL('explorer-lighting.png', output).pathname });

  const viewportChecks = [];
  for (const width of [1280, 768, 375, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 740 : 800 });
    for (const selector of ['#btn-mend-gourd', '.crest-hub', '#hud-combat-deck [data-combat-act="skill1"]', '#hud-combat-deck [data-combat-act="skill4"]']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1, `${selector} outside ${width}px viewport`);
    }
    viewportChecks.push(width);
  }
  await page.screenshot({ path: new URL('hud-small-screen.png', output).pathname });
  await page.keyboard.press('o');
  assert.ok(await page.locator('#lighting-settings').isVisible());
  assert.equal(await page.locator('#lighting-settings').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__serpentSpine.lighting.setControls({ exposure: 1.15 }));
  await page.reload();
  await page.waitForFunction(() => !!window.__serpentSpine, null, { timeout: 180_000 });
  assert.equal(await page.evaluate(() => window.__serpentSpine.lighting.state.preset), 'explorer');
  assert.equal(await page.evaluate(() => window.__serpentSpine.lighting.controls.exposure), 1.15);
  assert.deepEqual(errors, []);
  const result = { bootMs, original, blossoms, viewportChecks, persistedAfterReload: true, errors };
  await writeFile(new URL('presentation-smoke.json', output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
