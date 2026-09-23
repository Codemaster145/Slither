import { test, expect, type Page } from '@playwright/test';
import { createGameServer } from '../../server/index';
import type { Snapshot } from '../../shared/protocol';
let game: ReturnType<typeof createGameServer>, url: string;
test.beforeAll(async () => {
  game = createGameServer();
  await new Promise<void>((r) => game.http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(game.http.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  await game.close();
});
function observe(page: Page) {
  const frames: Snapshot[] = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', (event) => {
      const text = String(event.payload);
      if (text.startsWith('42["snapshot",')) {
        const [, snapshot] = JSON.parse(text.slice(2));
        frames.push(snapshot);
        if (frames.length > 300) frames.shift();
      }
    }),
  );
  return frames;
}
test('two separate browsers share movements, food, leaderboard, death, respawn, reconnect, and invite', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const one = await a.newPage(),
    two = await b.newPage();
  const errors: string[] = [];
  for (const p of [one, two]) p.on('pageerror', (e) => errors.push(e.message));
  const first = observe(one),
    second = observe(two);
  await one.goto(url);
  await expect(one.locator('#status')).toHaveText('SERVER ONLINE');
  await one.screenshot({ path: 'test-results/menu.png', fullPage: true });
  await one.locator('#name').fill('PlayerOne');
  await one.locator('#create').click();
  await expect(one.locator('#hud')).toBeVisible();
  const code = (await one.locator('#room-label').innerText()).match(/\d{6}/)![0];
  await two.goto(`${url}/?room=${code}`);
  await expect(two.locator('#modal')).toBeVisible();
  await two.locator('#modal-close').click();
  await two.locator('#name').fill('PlayerTwo');
  await two.locator('#join').click();
  await two.locator('#code').fill(code);
  await two.locator('#join-form button').click();
  await expect(two.locator('#hud')).toBeVisible();
  await expect(one.locator('#players')).toHaveText('2');
  await expect(two.locator('#players')).toHaveText('2');
  const room = game.rooms.get(code)!;
  const p = [...room.players.values()].find((p) => p.name === 'PlayerOne')!,
    q = [...room.players.values()].find((p) => p.name === 'PlayerTwo')!;
  Object.assign(p, {
    x: 0,
    y: 0,
    angle: 0,
    target: 0,
    trail: [
      { x: 0, y: 0 },
      { x: -60, y: 0 },
      { x: -120, y: 0 },
    ],
    shieldUntil: Date.now() + 3000,
  });
  Object.assign(q, {
    x: 0,
    y: 180,
    angle: 0,
    target: 0,
    trail: [
      { x: 0, y: 180 },
      { x: -60, y: 180 },
      { x: -120, y: 180 },
    ],
    shieldUntil: Date.now() + 3000,
  });
  first.length = 0;
  second.length = 0;
  await expect.poll(() => first.at(-1)?.snakes.length).toBe(2);
  await expect.poll(() => second.at(-1)?.snakes.length).toBe(2);
  const before = first.at(-1)!.snakes.find((s) => s.id === q.id)!.x;
  await expect
    .poll(() => first.at(-1)?.snakes.find((s) => s.id === q.id)?.x)
    .toBeGreaterThan(before + 20);
  const beforeP = second.at(-1)!.snakes.find((s) => s.id === p.id)!.x;
  await expect
    .poll(() => second.at(-1)?.snakes.find((s) => s.id === p.id)?.x)
    .toBeGreaterThan(beforeP + 20);
  const food = room.addFood(p.x + 100, p.y, 12, 1)!;
  await expect.poll(() => first.some((s) => s.foodAdd.some((f) => f.id === food.id))).toBe(true);
  await expect.poll(() => second.some((s) => s.foodAdd.some((f) => f.id === food.id))).toBe(true);
  await expect.poll(() => first.some((s) => s.foodRemove.includes(food.id))).toBe(true);
  await expect.poll(() => second.some((s) => s.foodRemove.includes(food.id))).toBe(true);
  await expect(one.locator('#score')).toHaveText(String(Math.floor(p.mass)));
  await expect(two.locator('#leaders')).toContainText('PlayerOne');
  await one.screenshot({ path: 'test-results/arena.png' });
  await one.keyboard.down('Space');
  await expect.poll(() => p.boosting).toBe(true);
  await one.keyboard.up('Space');
  await expect.poll(() => p.boosting).toBe(false);
  Object.assign(p, {
    x: 0,
    y: 0,
    angle: 0,
    target: 0,
    shieldUntil: 0,
    trail: [
      { x: 0, y: 0 },
      { x: -10, y: 0 },
    ],
  });
  Object.assign(q, {
    x: 150,
    y: 0,
    angle: 0,
    target: 0,
    shieldUntil: 0,
    mass: 100,
    trail: Array.from({ length: 31 }, (_, i) => ({ x: 150 - i * 5, y: 0 })),
  });
  await expect(one.locator('#death')).toBeVisible();
  await expect.poll(() => second.at(-1)?.leaders.some((l) => l.id === p.id)).toBe(false);
  await expect(one.locator('#death-reason')).toContainText('another coil');
  await one.locator('#respawn').click();
  await expect(one.locator('#death')).not.toBeVisible();
  await expect.poll(() => p.alive).toBe(true);
  game.io.sockets.sockets.get(p.id)!.conn.close();
  await expect(one.locator('#reconnect')).not.toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => [...room.players.values()].some((v) => v.name === 'PlayerOne' && v.id !== p.id), {
      timeout: 15000,
    })
    .toBe(true);
  await expect(one.locator('#players')).toHaveText('2');
  await b.close();
  await expect(one.locator('#players')).toHaveText('1');
  await one.locator('#leave').click();
  await expect(one.locator('#menu')).toBeVisible();
  expect(errors).toEqual([]);
  await a.close();
});
test('responsive menu, invalid rooms, skin and audio settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await expect(page.locator('#status')).toHaveText('SERVER ONLINE');
  await page.locator('[aria-label="Orbit skin"]').click();
  await expect(page.locator('#skin-name')).toHaveText('Orbit');
  await page.locator('#settings').click();
  await page.locator('#sound').fill('0.6');
  await page.locator('#mute').check();
  await page.locator('#modal-close').click();
  await page.locator('#join').click();
  await page.locator('#code').fill('000000');
  await page.locator('#join-form button').click();
  await expect(page.locator('#menu-error')).toContainText('doesn’t exist');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
