import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena, type Player } from '../server/arena.js';
import { BotController, desiredBots } from '../server/bots.js';
import { BASE_MASS, BOOST_SPEED, WORLD_RADIUS } from '../shared/protocol.js';

function seeded(seed = 42) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function setup() {
  const room = new Arena('111111', false, 0);
  const human = room.addPlayer('human', 'Human', 0);
  const ai = new BotController(room, seeded());
  const now = Date.now();
  ai.update(now);
  return { room, human, ai, now };
}
function place(p: Player, x: number, y: number, angle = 0) {
  Object.assign(p, {
    x,
    y,
    angle,
    target: angle,
    shieldUntil: 0,
    trail: Array.from({ length: 40 }, (_, i) => ({
      x: x - Math.cos(angle) * i * 5,
      y: y - Math.sin(angle) * i * 5,
    })),
  });
}

test('public population uses unique server bots, mixed skill, existing skins; private and empty rooms have none', () => {
  const { room, human, ai, now } = setup();
  assert.equal(room.humanCount, 1);
  assert.equal(ai.brains.size, 17);
  const bots = [...room.players.values()].filter((p) => p.bot);
  assert.equal(new Set(bots.map((p) => p.name)).size, 17);
  assert.ok(bots.every((p) => p.skin >= 0 && p.skin < 6 && p.id.startsWith('ai-')));
  const skills = [...ai.brains.values()].map((b) => b.skill);
  assert.ok(skills.includes('easy'));
  assert.ok(skills.includes('good'));
  assert.ok(skills.filter((s) => s === 'normal').length > 8);
  assert.equal(desiredBots(5), 13);
  assert.equal(desiredBots(15), 0);
  assert.equal(desiredBots(32), 0);
  const privateRoom = new Arena('222222', true, 0);
  privateRoom.addPlayer('friend', 'Friend', 0);
  privateRoom.bots.update(now);
  assert.equal(privateRoom.players.size, 1);
  room.players.delete(human.id);
  ai.update(now + 1);
  assert.equal(room.players.size, 0);
  assert.equal(ai.brains.size, 0);
});

test('visible excess bots retire naturally, unseen excess leave, and dead excess never respawn', () => {
  const { room, human, ai, now } = setup();
  place(human, 0, 0);
  for (const p of room.players.values()) if (p.bot) place(p, 300, 0);
  room.addPlayer('second', 'Second', 1);
  ai.update(now + 600);
  assert.equal(ai.brains.size, 17, 'visible bots must not pop out');
  assert.equal([...ai.brains.values()].filter((b) => b.retiring).length, 1);
  const retired = [...ai.brains].find(([, b]) => b.retiring)!;
  room.kill(room.players.get(retired[0])!, 'normal death', now + 650);
  ai.update(now + 660);
  assert.equal(ai.brains.size, 16);
  const second = room.players.get('second')!;
  place(second, 0, 0);
  for (let i = 2; i < 15; i++) {
    const p = room.addPlayer(`human-${i}`, `Human${i}`, 0);
    place(p, 0, 0);
  }
  for (const p of room.players.values()) if (p.bot) place(p, 2400, 0);
  ai.update(now + 1200);
  assert.equal(ai.brains.size, 0);
  assert.equal(room.humanCount, 15);
});

test('AI chooses nearby valuable food, grows via shared pickup, boosts at legal speed and sheds mass', () => {
  const { room, human, ai, now } = setup();
  const bot = [...room.players.values()].find((p) => p.bot)!;
  for (const id of [...ai.brains.keys()])
    if (id !== bot.id) {
      ai.brains.delete(id);
      room.players.delete(id);
    }
  place(human, 1800, 1800);
  place(bot, 0, 0);
  bot.mass = 80;
  const brain = ai.brains.get(bot.id)!;
  brain.nextThink = now;
  room.addFood(100, 0, 4, 1);
  room.addFood(0, 180, 1, 0);
  ai.update(now + 1);
  assert.ok(Math.abs(bot.target) < 0.6, 'AI should steer toward nearby valuable food');
  const pellet = room.addFood(5, 0, 5, 1)!;
  const before = bot.mass;
  room.tick(1 / 30, now + 2);
  assert.equal(room.foods.has(pellet.id), false);
  assert.ok(bot.mass >= before + 4);
  // Deterministic random stream will eventually trigger a short voluntary burst in a clear lane.
  let boosted = false;
  for (let i = 1; i <= 100; i++) {
    place(bot, 0, 0);
    room.bodyGrid.clear();
    brain.nextThink = now + i * 10;
    ai.update(now + i * 10);
    if (bot.boost) {
      const mass = bot.mass;
      const x = bot.x,
        y = bot.y;
      room.tick(1 / 30, now + i * 10);
      assert.ok(bot.boosting);
      assert.ok(Math.hypot(bot.x - x, bot.y - y) <= BOOST_SPEED / 30 + 0.001);
      assert.ok(bot.mass < mass);
      boosted = true;
      break;
    }
  }
  assert.ok(boosted, 'bots should sometimes choose boost');
  bot.mass = BASE_MASS;
  brain.boostUntil = now + 20000;
  room.tick(1 / 30, now + 1001);
  assert.equal(bot.boosting, false);
});

test('bots avoid sensed walls and bodies but can collide with humans, drop food, and respawn after delay', () => {
  const { room, human, ai, now } = setup();
  const bot = [...room.players.values()].find((p) => p.bot)!;
  const brain = ai.brains.get(bot.id)!;
  place(bot, WORLD_RADIUS - 100, 0);
  brain.nextThink = now;
  ai.update(now + 1);
  assert.ok(Math.abs(bot.target) > 0.3, 'bot turns away from edge');
  place(bot, 0, 0);
  brain.nextThink = now + 2;
  room.bodyGrid.clear();
  for (let x = 50; x < 150; x += 10) room.bodyGrid.add({ x, y: 0, owner: human.id, radius: 12 });
  room.addFood(200, 0, 4, 1);
  ai.update(now + 2);
  assert.ok(Math.abs(bot.target) > 0.3, 'body danger outweighs food straight ahead');
  // Put a human body within the next simulation step. Reaction delay cannot dodge everything.
  place(bot, 0, 0);
  place(human, 150, 0);
  human.mass = 150;
  const deaths = room.tick(1 / 30, now + 3);
  assert.ok(deaths.has(bot.id));
  assert.ok([...room.foods.values()].some((f) => f.kind === 2));
  assert.equal(bot.alive, false);
  ai.update(now + 4);
  const respawnAt = brain.respawnAt;
  assert.ok(respawnAt >= now + 2000);
  ai.update(respawnAt - 1);
  assert.equal(bot.alive, false);
  ai.update(respawnAt);
  assert.equal(bot.alive, true);
  assert.equal(bot.mass, BASE_MASS);
  assert.equal(
    bot.id,
    [...ai.brains.keys()].find((id) => id === bot.id),
  );
  // Reverse roles: a human head colliding with an AI body is equally lethal.
  place(human, 0, 0);
  place(bot, 150, 0);
  bot.mass = 150;
  assert.ok(room.tick(1 / 30, respawnAt + 1).has(human.id));
});

test('one-minute simulation grows bots naturally and keeps tick cost bounded', () => {
  const room = new Arena('333333', false, 2400, seeded(39));
  const human = room.addPlayer('human', 'Watcher', 0);
  place(human, -2000, -2000);
  human.alive = false;
  let growth = 0,
    boost = 0,
    deaths = 0,
    respawns = 0;
  const start = performance.now(),
    now = Date.now();
  for (let tick = 0; tick < 1800; tick++) {
    const time = now + (tick * 1000) / 30;
    const dead = new Set(
      [...room.players.values()].filter((p) => p.bot && !p.alive).map((p) => p.id),
    );
    room.bots.update(time);
    for (const id of dead) if (room.players.get(id)?.alive) respawns++;
    deaths += room.tick(1 / 30, time).size;
    for (const p of room.players.values())
      if (p.bot) {
        if (p.mass > BASE_MASS + 5) growth++;
        if (p.boosting) boost++;
      }
  }
  assert.ok(growth > 100);
  assert.ok(boost > 0);
  assert.ok(deaths > 0);
  assert.ok(respawns > 0);
  assert.ok(performance.now() - start < 10000);
  console.log(
    `AI simulation: ${deaths} deaths, ${respawns} respawns, ${boost} boosting frames; ${(performance.now() - start).toFixed(0)} ms for 60 simulated seconds.`,
  );
});
