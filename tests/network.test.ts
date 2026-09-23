import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { createGameServer } from '../server/index.js';
import type { JoinReply, Snapshot } from '../shared/protocol.js';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const join = (s: Socket, data: object) => new Promise<JoinReply>((r) => s.emit('join', data, r));
const snap = (s: Socket, predicate: (s: Snapshot) => boolean) =>
  new Promise<Snapshot>((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off('snapshot', fn);
      reject(new Error('snapshot timeout'));
    }, 4000);
    const fn = (v: Snapshot) => {
      if (predicate(v)) {
        clearTimeout(timer);
        s.off('snapshot', fn);
        resolve(v);
      }
    };
    s.on('snapshot', fn);
  });
test('real WebSockets: private rooms, isolation, validation, eating, deaths, disconnect, and respawn', async () => {
  const game = createGameServer();
  await new Promise<void>((r) => game.http.listen(0, '127.0.0.1', r));
  const port = (game.http.address() as { port: number }).port;
  const sockets: Socket[] = [];
  const client = async () => {
    const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    sockets.push(s);
    await new Promise<void>((r) => s.on('connect', r));
    return s;
  };
  try {
    const a = await client(),
      b = await client(),
      c = await client();
    const created = await join(a, { mode: 'create', name: '<PlayerOne>', skin: 0 });
    assert.ok(created.ok);
    if (!created.ok) return;
    assert.match(created.code, /^\d{6}$/);
    assert.equal(created.name, 'PlayerOne');
    const second = await join(b, { mode: 'join', code: created.code, name: 'PlayerOne', skin: 1 });
    assert.ok(second.ok);
    if (second.ok) assert.equal(second.name, 'PlayerOne 2');
    const room = game.rooms.get(created.code)!;
    await snap(a, (s) => s.count === 2 && s.snakes.some((p) => p.id === b.id));
    await snap(b, (s) => s.count === 2 && s.snakes.some((p) => p.id === a.id));
    const invalid = await join(c, { mode: 'join', code: '000000', name: 'X', skin: 0 });
    assert.equal(invalid.ok, false);
    const pub = await join(c, { mode: 'public', name: 'X', skin: 0 });
    assert.ok(pub.ok);
    if (pub.ok) assert.notEqual(pub.code, created.code);
    const p = room.players.get(a.id!)!,
      q = room.players.get(b.id!)!;
    Object.assign(p, {
      x: 0,
      y: 0,
      angle: 0,
      target: 0,
      trail: [{ x: 0, y: 0 }],
      shieldUntil: Date.now() + 3000,
    });
    Object.assign(q, {
      x: 0,
      y: 180,
      angle: 0,
      target: 0,
      trail: [{ x: 0, y: 180 }],
      shieldUntil: Date.now() + 3000,
    });
    const x = p.x;
    a.emit('input', { angle: NaN, boost: 'yes', x: 99999, mass: 99999 });
    a.emit('input', { angle: 0, boost: false, x: 99999, mass: 99999 });
    await wait(100);
    assert.ok(p.x > x && p.x < 60);
    assert.ok(p.mass < 100);
    const f = room.addFood(p.x + 90, p.y, 9, 1)!;
    await Promise.all([
      snap(a, (s) => s.foodAdd.some((v) => v.id === f.id)),
      snap(b, (s) => s.foodAdd.some((v) => v.id === f.id)),
    ]);
    await Promise.all([
      snap(a, (s) => s.foodRemove.includes(f.id)),
      snap(b, (s) => s.foodRemove.includes(f.id)),
    ]);
    assert.ok(p.mass >= 41);
    await snap(b, (s) => s.leaders.some((l) => l.id === a.id && l.score >= 41));
    const died = new Promise<any>((r) => a.once('death', r));
    Object.assign(p, { x: 2590, y: 0, angle: 0, target: 0 });
    const death = await died;
    assert.match(death.reason, /edge/);
    await snap(b, (s) => !s.snakes.some((v) => v.id === a.id));
    await wait(1000);
    assert.equal(await new Promise((r) => a.emit('respawn', r)), true);
    assert.equal(p.alive, true);
    b.disconnect();
    await snap(a, (s) => s.count === 1);
    assert.equal(room.players.size, 1);
    a.disconnect();
    await wait(50);
    room.emptySince = Date.now() - 61000;
    await wait(100);
    assert.equal(game.rooms.has(created.code), false);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await game.close();
  }
});
test('public rooms spill over at capacity; room-full joins are rejected', async () => {
  const game = createGameServer();
  await new Promise<void>((r) => game.http.listen(0, '127.0.0.1', r));
  const port = (game.http.address() as { port: number }).port;
  const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  try {
    await new Promise<void>((r) => s.on('connect', r));
    const first = await join(s, { mode: 'public', name: 'A', skin: 0 });
    assert.ok(first.ok);
    if (!first.ok) return;
    const full = game.rooms.get(first.code)!;
    for (let i = 0; i < 32; i++) full.addPlayer(`fixture-${i}`, `F${i}`, 0);
    const second = await join(s, { mode: 'public', name: 'A', skin: 0 });
    assert.ok(second.ok);
    if (second.ok) assert.notEqual(first.code, second.code);
    full.privateRoom = true;
    const reject = await join(s, { mode: 'join', code: full.code, name: 'A', skin: 0 });
    assert.equal(reject.ok, false);
  } finally {
    s.disconnect();
    await game.close();
  }
});
