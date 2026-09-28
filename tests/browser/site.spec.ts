import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import type { Server } from 'node:http';
import type { GameEvent } from '../../shared/worker-protocol';
let server: Server, url: string;
test.beforeAll(async () => {
  const app = express();
  app.use(express.static('dist/client'));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.on('listening', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((r) => server.close(() => r())));
async function observe(page: Page) {
  await page.addInitScript(() => {
    const w = window as typeof window & {
      events: unknown[];
      frameTimes: number[];
      tools: Record<string, { execute: (i: unknown) => unknown }>;
    };
    w.events = [];
    w.frameTimes = [];
    w.tools = {};
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: (tool: { name: string; execute: (i: unknown) => unknown }) => {
          w.tools[tool.name] = tool;
        },
      },
    });
    const RealWorker = Worker;
    window.Worker = class extends RealWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        w.events = [];
        this.addEventListener('message', (e) => {
          w.events.push(e.data);
          if (w.events.length > 500) w.events.shift();
        });
      }
    };
    let previous = 0;
    function frame(t: number) {
      if (previous) w.frameTimes.push(t - previous);
      if (w.frameTimes.length > 600) w.frameTimes.shift();
      previous = t;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
const events = (page: Page) =>
  page.evaluate(() => (window as typeof window & { events: GameEvent[] }).events);
test('Quick Play works offline, pauses, respawns, records stats and restarts without WebSockets', async ({
  page,
  context,
}) => {
  test.setTimeout(0);
  await observe(page);
  const errors: string[] = [];
  const sockets: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (w) => sockets.push(w.url()));
  await page.goto(url);
  await page.locator('#name').fill('Glow Guest');
  await page.locator('#quick').click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#room-label')).toHaveText('NORMAL · 20 AI');
  await expect
    .poll(async () => (await events(page)).filter((e) => e.type === 'snapshot').length)
    .toBeGreaterThan(2);
  await context.setOffline(true);
  await page.locator('#pause').click();
  await expect(page.locator('#pause-dialog')).toBeVisible();
  const t = await page.locator('#time').innerText();
  await page.waitForTimeout(400);
  await expect(page.locator('#time')).toHaveText(t);
  await page.locator('#resume').click();
  await page.mouse.move(1400, 500);
  await expect(page.locator('#death')).toBeVisible({ timeout: 0 });
  for (const id of [
    'death-score',
    'death-rank',
    'death-time',
    'death-food',
    'death-peak',
    'death-difficulty',
  ])
    await expect(page.locator('#' + id)).not.toBeEmpty();
  await page.screenshot({ path: 'test-results/site-death.png' });
  await page.locator('#respawn').click();
  await expect(page.locator('#death')).not.toBeVisible();
  await expect
    .poll(async () => (await events(page)).some((e) => e.type === 'respawned'))
    .toBe(true);
  await page.locator('#leave').click();
  await expect(page.locator('#session-stats')).toContainText('2');
  await context.setOffline(false);
  await page.locator('#quick').click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.locator('#leave').click();
  expect(errors).toEqual([]);
  expect(sockets).toEqual([]);
});
test('all difficulty and population choices run, preserving skin and highlighting the human', async ({
  page,
}) => {
  await observe(page);
  await page.goto(url);
  await page.locator('#name').fill('Aster');
  await page.getByRole('button', { name: 'Glacier skin' }).click();
  await page.locator('#mode-custom').click();
  for (const difficulty of ['easy', 'normal', 'hard', 'expert', 'mixed'])
    for (const count of [10, 20, 30]) {
      await page.locator(`[data-difficulty="${difficulty}"]`).click();
      await page.locator(`[data-count="${count}"]`).click();
      await page.locator('#quick').click();
      await expect(page.locator('#hud')).toBeVisible();
      await expect(page.locator('#room-label')).toHaveText(
        `${difficulty.toUpperCase()} · ${count} AI`,
      );
      await expect
        .poll(
          async () => {
            const list = await events(page);
            return list.find((e) => e.type === 'snapshot')?.state.count;
          },
          { timeout: 0 },
        )
        .toBe(count + 1);
      const state = (await events(page)).filter((e) => e.type === 'snapshot').at(-1)!.state;
      expect(state.snakes.find((p) => p.id === 'you')?.skin).toBe(1);
      expect(state.leaders.length).toBe(10);
      await page.locator('#leave').click();
    }
});
test('30 Expert AI render smoothly with clean console and bounded simulation work', async ({
  page,
}) => {
  await observe(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator('#mode-custom').click();
  await page.locator('[data-difficulty="expert"]').click();
  await page.locator('[data-count="30"]').click();
  await page.locator('#quick').click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForTimeout(7000);
  const data = await page.evaluate(() => {
    const w = window as typeof window & { events: GameEvent[]; frameTimes: number[] };
    return {
      ticks: w.events.filter((e) => e.type === 'snapshot').map((e) => e.tickMs),
      frames: w.frameTimes.slice(-300),
    };
  });
  data.ticks.sort((a, b) => a - b);
  data.frames.sort((a, b) => a - b);
  const metrics = {
    tickP95: data.ticks[Math.floor(data.ticks.length * 0.95)],
    frameMedian: data.frames[Math.floor(data.frames.length * 0.5)],
    frameP95: data.frames[Math.floor(data.frames.length * 0.95)],
  };
  console.log('30 Expert AI browser metrics', metrics);
  expect(metrics.tickP95).toBeLessThan(33.34);
  expect(metrics.frameMedian).toBeLessThan(25);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/site-30-ai.png' });
});
test('mobile controls fit, settings work, and optional agent read-back validates inputs', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await observe(page);
  await page.goto(url);
  await page.locator('#mode-custom').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#settings').click();
  await page.locator('#mute').check();
  await page.locator('#modal-close').click();
  await page.locator('#how').click();
  await expect(page.locator('#modal-content')).toContainText('Every opponent is AI');
  await page.locator('#modal-close').click();
  const result = await page.evaluate(() => {
    const w = window as typeof window & {
      tools: Record<string, { execute: (i: unknown) => unknown }>;
    };
    const state = w.tools.read_arena_status.execute({});
    let rejected = false;
    try {
      w.tools.read_arena_status.execute({ bad: true });
    } catch {
      rejected = true;
    }
    return { state, rejected };
  });
  expect(result.rejected).toBe(true);
  expect(result.state).toMatchObject({ playing: false, difficulty: 'normal', aiCount: 20 });
  await page.locator('#quick').click();
  await expect(page.locator('#touch-boost')).toBeVisible();
  await page.locator('#leave').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/site-mobile.png', fullPage: true });
  await context.close();
});

test('Escape pauses once and a second Escape resumes', async ({ page }) => {
  await page.goto(url);
  await page.locator('#quick').click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-dialog')).not.toBeVisible();
});
