import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGame, PROFILES, type Skill } from '../shared/local-game.js';
import { WORLD_RADIUS, NORMAL_SPEED, BOOST_SPEED } from '../shared/protocol.js';
function random() {
  let seed = 42;
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const game = (skill: Skill) =>
  new LocalGame({ difficulty: skill, count: 30, name: 'Observer', skin: 0 }, random());
test('distant food and snake heads outside perception cannot change an Expert decision', () => {
  const a = game('expert'),
    b = game('expert');
  const p = a.arena.players.get('ai-0')!,
    q = b.arena.players.get('ai-0')!;
  b.arena.addFood(q.x + PROFILES.expert.vision + 200, q.y, 100, 2);
  const other = b.arena.players.get('ai-1')!;
  other.x = q.x + 900;
  other.y = q.y;
  b.arena.bodyGrid.add({ x: q.x + 600, y: q.y, owner: other.id, radius: 12 });
  a.think(p, a.brains.get(p.id)!);
  b.think(q, b.brains.get(q.id)!);
  assert.equal(p.target, q.target);
});
test('Expert steers away from an imminent body and boundary without changing legal physics', () => {
  const g = game('expert'),
    p = g.arena.players.get('ai-0')!,
    b = g.brains.get(p.id)!;
  p.x = WORLD_RADIUS - 130;
  p.y = 0;
  p.angle = 0;
  p.target = 0;
  p.mass = 100;
  p.shieldUntil = 0;
  g.think(p, b);
  assert.ok(Math.abs(p.target) > 1);
  p.x = 0;
  p.y = 0;
  p.angle = 0;
  p.target = 0;
  g.arena.bodyGrid.clear();
  for (let y = -40; y <= 40; y += 10)
    g.arena.bodyGrid.add({ x: 65, y, owner: 'obstacle', radius: 12 });
  // Perception must reference a real coil, as in the simulation's spatial index.
  const other = g.arena.players.get('ai-1')!;
  other.x = 65;
  other.y = 0;
  g.arena.bodyGrid.clear();
  for (let y = -40; y <= 40; y += 10)
    g.arena.bodyGrid.add({ x: 65, y, owner: other.id, radius: 12 });
  g.arena.addFood(120, 0, 20);
  g.think(p, b);
  assert.ok(Math.abs(p.target) > 0.5);
});
test('human and AI both collide, die into food, and obey identical speed and boost costs', () => {
  const g = game('normal');
  const bot = g.arena.players.get('ai-0')!;
  const p = g.player;
  for (const [v, y] of [
    [p, 0],
    [bot, 300],
  ] as const) {
    Object.assign(v, {
      x: 0,
      y,
      angle: 0,
      target: 0,
      mass: 100,
      boost: true,
      shieldUntil: Infinity,
      inputAt: g.now,
    });
    v.trail = [{ x: 0, y }];
  }
  g.arena.tick(1 / 30, g.now);
  assert.equal(p.x, BOOST_SPEED / 30);
  assert.equal(bot.x, p.x);
  assert.equal(p.mass, bot.mass);
  for (const v of [p, bot]) {
    v.x = WORLD_RADIUS;
    v.y = 0;
    v.boost = false;
  }
  const before = g.arena.foods.size,
    deaths = g.arena.tick(1 / 30, g.now);
  assert.ok(deaths.has(p.id) && deaths.has(bot.id));
  assert.ok(g.arena.foods.size > before);
  assert.ok(NORMAL_SPEED < BOOST_SPEED);
});
test('three-minute 30-AI benchmark: every tier eats, boosts, dies and respawns; Expert survives better', () => {
  const rows = [];
  for (const skill of ['easy', 'normal', 'hard', 'expert'] as Skill[]) {
    const g = game(skill);
    let deaths = 0,
      respawns = 0,
      boosts = 0,
      eats = 0;
    const ticks: number[] = [];
    for (let i = 0; i < 5400; i++) {
      const prior = new Map(
        [...g.arena.players.values()].map((p) => [p.id, { alive: p.alive, food: p.foodEaten }]),
      );
      const start = performance.now();
      g.step();
      if (i % 2 === 0) g.snapshot();
      ticks.push(performance.now() - start);
      for (const p of g.arena.players.values()) {
        if (!p.bot) continue;
        const prev = prior.get(p.id)!;
        if (prev.alive && !p.alive) deaths++;
        if (!prev.alive && p.alive) respawns++;
        if (p.boosting) boosts++;
        if (p.foodEaten > prev.food) eats += p.foodEaten - prev.food;
      }
    }
    ticks.sort((a, b) => a - b);
    const p95 = ticks[Math.floor(ticks.length * 0.95)];
    rows.push({ skill, deaths, respawns, boosts, eats, p95Ms: Number(p95.toFixed(2)) });
    assert.ok(eats > 100);
    assert.ok(boosts > 0);
    assert.ok(deaths > 0);
    assert.ok(respawns > 0);
    assert.ok(p95 < 33.34);
  }
  console.log('Local 30-AI benchmark:', JSON.stringify(rows));
  assert.ok(rows[3].deaths < rows[0].deaths / 2);
  assert.ok(rows[3].deaths < rows[1].deaths / 2);
});
