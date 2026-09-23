import test from 'node:test';
import assert from 'node:assert/strict';
import { Arena } from '../server/arena.js';
import { BASE_MASS, NORMAL_SPEED, WORLD_RADIUS } from '../shared/protocol.js';
const setup = () => {
  const arena = new Arena('123456', true, 0),
    p = arena.addPlayer('a', 'A', 0);
  Object.assign(p, {
    x: 0,
    y: 0,
    angle: 0,
    target: 0,
    trail: [
      { x: 0, y: 0 },
      { x: -10, y: 0 },
      { x: -20, y: 0 },
    ],
    shieldUntil: 0,
    inputAt: Date.now(),
  });
  return { arena, p };
};
test('authoritative movement, turn limit, boost cost, and minimum mass', () => {
  const { arena, p } = setup();
  arena.tick(1 / 30);
  assert.ok(Math.abs(p.x - NORMAL_SPEED / 30) < 0.01);
  p.target = Math.PI;
  const angle = p.angle;
  arena.tick(1 / 30);
  assert.ok(Math.abs(p.angle - angle) <= 3.7 / 30 + 0.001);
  p.mass = 70;
  p.boost = true;
  const previous = p.mass;
  arena.tick(1 / 30);
  assert.ok(p.boosting);
  assert.ok(p.mass < previous);
  p.mass = BASE_MASS;
  arena.tick(1 / 30);
  assert.equal(p.boosting, false);
});
test('food is removed once and delta removal reaches all clients', () => {
  const { arena, p } = setup();
  const b = arena.addPlayer('b', 'B', 1);
  Object.assign(b, { x: 0, y: 200 });
  const food = arena.addFood(5, 0, 4, 1)!;
  assert.equal(arena.snapshot(p).foodAdd.length, 1);
  assert.equal(arena.snapshot(b).foodAdd.length, 1);
  arena.tick(1 / 30);
  assert.equal(p.mass, BASE_MASS + 4);
  assert.equal(arena.foods.has(food.id), false);
  assert.deepEqual(arena.snapshot(p).foodRemove, [food.id]);
  assert.deepEqual(arena.snapshot(b).foodRemove, [food.id]);
  assert.equal(arena.snapshot(p).foodAdd.length, 0);
});
test('own body safe; another body kills; mass becomes food; respawn works', () => {
  const { arena, p } = setup();
  p.trail = [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
    { x: 10, y: 0 },
  ];
  assert.equal(arena.tick(1 / 30).size, 0);
  const b = arena.addPlayer('b', 'B', 1);
  Object.assign(b, {
    x: 150,
    y: 0,
    angle: 0,
    target: 0,
    shieldUntil: 0,
    mass: 100,
    trail: Array.from({ length: 31 }, (_, i) => ({ x: 150 - i * 5, y: 0 })),
  });
  const deaths = arena.tick(1 / 30);
  assert.ok(deaths.has(p.id));
  assert.equal(p.alive, false);
  assert.ok(arena.foods.size > 0);
  arena.spawn(p);
  assert.equal(p.alive, true);
  assert.equal(p.mass, BASE_MASS);
  assert.ok(p.shieldUntil > Date.now());
});
test('simultaneous head collisions kill both, independently of player order', () => {
  const { arena, p } = setup();
  const b = arena.addPlayer('b', 'B', 1);
  Object.assign(p, { x: -8, y: 0 });
  Object.assign(b, {
    x: 8,
    y: 0,
    angle: Math.PI,
    target: Math.PI,
    shieldUntil: 0,
    trail: [{ x: 8, y: 0 }],
  });
  const deaths = arena.tick(1 / 30);
  assert.equal(deaths.size, 2);
});
test('spawn shield protects both players from bodies, but never the boundary', () => {
  const { arena, p } = setup();
  const b = arena.addPlayer('b', 'B', 1);
  Object.assign(b, {
    x: 8,
    y: 0,
    angle: Math.PI,
    target: Math.PI,
    shieldUntil: 0,
    trail: [{ x: 8, y: 0 }],
  });
  p.shieldUntil = Date.now() + 2000;
  assert.equal(arena.tick(1 / 30).size, 0);
  assert.equal(b.alive, true);
  p.x = WORLD_RADIUS;
  assert.match(arena.tick(1 / 30).get(p.id)!.reason, /edge/);
});
test('names are made unique and distant food is culled', () => {
  const { arena, p } = setup();
  const b = arena.addPlayer('b', 'A', 0);
  assert.equal(b.name, 'A 2');
  arena.addFood(2400, 0);
  assert.equal(arena.snapshot(p).foodAdd.length, 0);
});
