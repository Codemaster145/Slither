import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { performance } from 'node:perf_hooks';
import { createGameServer } from '../server/index.js';
import type { JoinReply, Snapshot } from '../shared/protocol.js';
test('32 concurrent real WebSocket clients receive healthy shared snapshots', async () => {
  const game = createGameServer();
  await new Promise<void>((r) => game.http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(game.http.address() as { port: number }).port}`;
  const clients: Socket[] = [];
  let snapshots = 0,
    bytes = 0;
  try {
    for (let i = 0; i < 32; i++) {
      const s = io(url, { transports: ['websocket'], reconnection: false });
      clients.push(s);
      await new Promise<void>((r) => s.on('connect', r));
      const result = await new Promise<JoinReply>((r) =>
        s.emit('join', { mode: 'public', name: `Load ${i}`, skin: i % 6 }, r),
      );
      assert.ok(result.ok);
      s.on('snapshot', (state: Snapshot) => {
        assert.ok(state.count <= 32);
        snapshots++;
        bytes += Buffer.byteLength(JSON.stringify(state));
      });
    }
    const room = [...game.rooms.values()][0];
    assert.equal(room.players.size, 32);
    assert.equal(room.foods.size >= 2300, true);
    const timer = setInterval(
      () =>
        clients.forEach((s, i) =>
          s.emit('input', { angle: performance.now() / 900 + i, boost: false }),
        ),
      34,
    );
    const start = performance.now();
    await new Promise((r) => setTimeout(r, 3000));
    clearInterval(timer);
    const elapsed = (performance.now() - start) / 1000;
    const rate = snapshots / 32 / elapsed;
    assert.ok(rate > 10, `snapshot rate was ${rate.toFixed(1)} Hz`);
    console.log(
      `32-client test: ${rate.toFixed(1)} snapshots/sec/client, ${(bytes / 32 / elapsed / 1024).toFixed(1)} KiB/sec/client (includes initial food delivery).`,
    );
  } finally {
    clients.forEach((s) => s.disconnect());
    await game.close();
  }
});
