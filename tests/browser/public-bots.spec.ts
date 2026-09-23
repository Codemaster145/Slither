import { test, expect, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../../server/index';
import type { Player } from '../../server/arena';
import type { Snapshot, JoinReply } from '../../shared/protocol';
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
        frames.push(JSON.parse(text.slice(2))[1]);
        if (frames.length > 400) frames.shift();
      }
    }),
  );
  return frames;
}
function place(p: Player, x: number, y: number) {
  Object.assign(p, {
    x,
    y,
    angle: 0,
    target: 0,
    shieldUntil: Date.now() + 10000,
    trail: Array.from({ length: 40 }, (_, i) => ({ x: x - i * 5, y })),
  });
}

test('two Quick Play browsers share server bots, food, leaderboard, human collisions and bot respawns; human arrivals retire bots', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    one = await a.newPage(),
    two = await b.newPage();
  const extra: Socket[] = [];
  const errors: string[] = [];
  for (const page of [one, two]) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
  }
  const first = observe(one),
    second = observe(two);
  try {
    await one.goto(url);
    await expect(one.locator('#status')).toHaveText('SERVER ONLINE');
    await one.locator('#name').fill('HumanOne');
    await one.locator('#quick').click();
    await expect(one.locator('#population')).toHaveText('1 HUMAN · 17 AI');
    const room = [...game.rooms.values()].find((r) => !r.privateRoom)!;
    expect(room.bots.brains.size).toBe(17);
    await two.goto(url);
    await expect(two.locator('#status')).toHaveText('SERVER ONLINE');
    await two.locator('#name').fill('HumanTwo');
    await two.locator('#quick').click();
    await expect.poll(() => room.humanCount).toBe(2);
    const p = [...room.players.values()].find((p) => p.name === 'HumanOne')!,
      q = [...room.players.values()].find((p) => p.name === 'HumanTwo')!;
    place(p, 0, -200);
    place(q, 0, 250);
    p.mass = 140;
    q.mass = 120;
    await expect
      .poll(() => [...room.bots.brains.values()].filter((b) => b.retiring).length)
      .toBe(1);
    const retiringId = [...room.bots.brains].find(([, brain]) => brain.retiring)![0];
    place(room.players.get(retiringId)!, 2400, 0);
    await expect.poll(() => room.bots.brains.size).toBe(16);
    const bots = [...room.players.values()].filter((p) => p.bot);
    bots.forEach((p, i) =>
      place(
        p,
        Math.cos((i / bots.length) * Math.PI * 2) * 800,
        Math.sin((i / bots.length) * Math.PI * 2) * 800,
      ),
    );
    const bot = bots[0];
    place(bot, 0, 40);
    bot.mass = 90;
    const after = Date.now();
    await expect
      .poll(() => first.filter((s) => s.time > after).some((s) => s.leaders.some((l) => l.bot)))
      .toBe(true);
    await expect(one.locator('#leaders')).toContainText('· AI');
    await expect(one.locator('#leaders .is-you')).toContainText('HumanOne');
    await expect
      .poll(() => first.some((f) => f.time > after && second.some((s) => s.time === f.time)))
      .toBe(true);
    const common = first.find((f) => f.time > after && second.some((s) => s.time === f.time))!,
      other = second.find((s) => s.time === common.time)!;
    expect(common.snakes.filter((p) => p.bot)).toEqual(other.snakes.filter((p) => p.bot));
    expect(common.leaders).toEqual(other.leaders);
    expect(common.snakes.filter((p) => p.bot).length).toBeGreaterThan(10);
    const before = common.snakes.find((p) => p.id === bot.id)!;
    await expect
      .poll(() => first.at(-1)?.snakes.find((p) => p.id === bot.id)?.x)
      .not.toBe(before.x);
    const mass = bot.mass;
    const food = room.addFood(bot.x + 6, bot.y, 8, 1)!;
    await expect.poll(() => room.foods.has(food.id)).toBe(false);
    await expect.poll(() => bot.mass).toBeGreaterThan(mass + 6);
    await expect
      .poll(() => first.at(-1)?.leaders.find((l) => l.id === bot.id)?.score)
      .toBeGreaterThan(mass + 6);
    await expect
      .poll(() => second.at(-1)?.leaders.find((l) => l.id === bot.id)?.score)
      .toBeGreaterThan(mass + 6);
    await one.screenshot({ path: 'test-results/public-bots.png' });
    // A human collides with the normal body of a server AI coil.
    place(p, 0, 0);
    place(bot, 150, 0);
    p.shieldUntil = 0;
    bot.shieldUntil = 0;
    bot.mass = 150;
    await expect(one.locator('#death')).toBeVisible();
    await expect.poll(() => second.at(-1)?.snakes.some((s) => s.id === p.id)).toBe(false);
    await one.locator('#respawn').click();
    await expect(one.locator('#death')).not.toBeVisible();
    // An unavoidable edge encounter verifies AI death, food conversion, and delayed respawn over the wire.
    const deathAfter = Date.now();
    Object.assign(bot, { x: 2599, y: 0, angle: 0, target: 0 });
    await expect.poll(() => bot.alive).toBe(false);
    await expect
      .poll(() => first.some((s) => s.time > deathAfter && !s.snakes.some((v) => v.id === bot.id)))
      .toBe(true);
    expect([...room.foods.values()].some((f) => f.kind === 2)).toBe(true);
    await expect.poll(() => bot.alive, { timeout: 6000 }).toBe(true);
    expect(bot.mass).toBeLessThan(50);
    // Thirteen additional real sockets use ordinary Quick Play, sharing this public room.
    for (let i = 0; i < 13; i++) {
      const s = io(url, { transports: ['websocket'], reconnection: false });
      extra.push(s);
      await new Promise<void>((r) => s.on('connect', r));
      const result = await new Promise<JoinReply>((r) =>
        s.emit('join', { mode: 'public', name: `Arrival ${i}`, skin: i % 6 }, r),
      );
      expect(result.ok).toBe(true);
    }
    expect(room.humanCount).toBe(15);
    for (const v of room.players.values()) place(v, v.bot ? 2400 : 0, 0);
    await expect.poll(() => room.bots.brains.size).toBe(0);
    await expect(one.locator('#population')).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    extra.forEach((s) => s.disconnect());
    await a.close();
    await b.close();
  }
});
