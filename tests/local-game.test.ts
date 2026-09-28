import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGame, PROFILES, type Difficulty } from '../shared/local-game.js';
import { NORMAL_SPEED, BASE_MASS } from '../shared/protocol.js';
const seeded = () => {
  let s = 42;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
};
for (const difficulty of ['easy', 'normal', 'hard', 'expert', 'mixed'] as Difficulty[]) {
  for (const count of [10, 20, 30] as const)
    test(`${difficulty}: ${count} real simulated AI`, () => {
      const game = new LocalGame({ difficulty, count, name: 'Visitor', skin: 0 }, seeded());
      assert.equal(game.arena.players.size, count + 1);
      assert.equal(new Set([...game.arena.players.values()].map((p) => p.name)).size, count + 1);
      const bot = [...game.arena.players.values()].find((p) => p.bot)!;
      const x = bot.x,
        y = bot.y;
      game.step();
      assert.ok(Math.abs(Math.hypot(bot.x - x, bot.y - y) - NORMAL_SPEED / 30) < 0.001);
      assert.equal(game.snapshot().count, count + 1);
      if (difficulty === 'mixed')
        assert.equal(new Set([...game.brains.values()].map((b) => b.skill)).size, 4);
      else assert.ok([...game.brains.values()].every((b) => b.skill === difficulty));
    });
}
test('food, boost, death drops, bot respawn, and player life statistics use shared rules', () => {
  const g = new LocalGame({ difficulty: 'normal', count: 10, name: 'Me', skin: 0 }, seeded());
  const p = g.player;
  g.arena.addFood(p.x + Math.cos(p.angle) * 5, p.y + Math.sin(p.angle) * 5, 30);
  g.step();
  assert.ok(p.mass >= BASE_MASS + 30);
  assert.ok(p.foodEaten > 0);
  const before = p.mass;
  p.boost = true;
  g.step();
  assert.ok(p.boosting);
  assert.ok(p.mass < before);
  const food = g.arena.foods.size;
  const death = g.arena.kill(p, 'test', g.now);
  assert.ok(g.arena.foods.size > food);
  assert.ok(death.peakMass! >= BASE_MASS + 30);
  assert.ok(death.foodEaten! > 0);
  assert.ok(death.rank! > 0);
  g.respawn();
  assert.ok(p.alive);
  assert.equal(p.mass, BASE_MASS);
  assert.equal(p.foodEaten, 0);
  const bot = [...g.arena.players.values()].find((p) => p.bot)!;
  g.arena.kill(bot, 'test', g.now);
  for (let i = 0; i < 160; i++) g.step();
  assert.ok(bot.alive);
  assert.equal(g.arena.players.size, 11);
});
test('higher difficulty reacts sooner with longer but bounded perception', () => {
  assert.ok(PROFILES.easy.reaction > PROFILES.normal.reaction);
  assert.ok(PROFILES.normal.reaction > PROFILES.hard.reaction);
  assert.ok(PROFILES.hard.reaction > PROFILES.expert.reaction);
  assert.ok(PROFILES.expert.reaction >= 100);
  assert.ok(PROFILES.expert.vision < 800);
  assert.ok(PROFILES.easy.error > PROFILES.expert.error);
});
