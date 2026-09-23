import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { Arena, roomCode } from './arena.js';
import {
  ROOM_CAPACITY,
  SKINS,
  TICK_RATE,
  SNAPSHOT_RATE,
  type ClientEvents,
  type ServerEvents,
  type JoinRequest,
  type JoinReply,
} from '../shared/protocol.js';
export function createGameServer() {
  const app = express();
  const http = createServer(app);
  const origins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim());
  const io = new Server<ClientEvents, ServerEvents>(http, {
    maxHttpBufferSize: 2048,
    perMessageDeflate: false,
    cors: origins ? { origin: origins } : undefined,
    pingInterval: 5000,
    pingTimeout: 10000,
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(
        null,
        !origin ||
          (origins
            ? origins.includes(origin)
            : origin ===
              `${req.headers['x-forwarded-proto'] || ((req.socket as { encrypted?: boolean }).encrypted && 'https') || 'http'}://${req.headers.host}`),
      );
    },
  });
  const rooms = new Map<string, Arena>();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) =>
    res.json({
      ok: true,
      rooms: rooms.size,
      players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
    }),
  );
  app.use(express.static(resolve('dist/client')));
  app.get('/', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
  io.on('connection', (socket) => {
    let room: Arena | undefined;
    let inputs = 0,
      actions = 0,
      windowStart = Date.now(),
      lastRespawn = 0;
    const budget = (input = false) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        inputs = 0;
        actions = 0;
        windowStart = now;
      }
      return input ? ++inputs <= 45 : ++actions <= 5;
    };
    const leave = () => {
      if (room) {
        room.players.delete(socket.id);
        if (!room.players.size) room.emptySince = Date.now();
        room = undefined;
      }
    };
    socket.on('join', (data: JoinRequest, reply: (r: JoinReply) => void) => {
      if (typeof reply !== 'function') return;
      if (!budget()) {
        reply({ ok: false, error: 'A little too fast. Try again in a moment.' });
        return;
      }
      if (
        !data ||
        !['public', 'create', 'join'].includes(data.mode) ||
        typeof data.name !== 'string' ||
        data.name.length > 80 ||
        !Number.isInteger(data.skin) ||
        data.skin < 0 ||
        data.skin >= SKINS.length
      ) {
        reply({ ok: false, error: 'Please enter a name and choose a skin.' });
        return;
      }
      const name =
        data.name
          .normalize('NFKC')
          .replace(/[^\p{L}\p{N} _.-]/gu, '')
          .trim()
          .slice(0, 20) || 'Wanderer';
      let next: Arena | undefined;
      if (data.mode === 'join') {
        if (typeof data.code !== 'string' || !/^\d{6}$/.test(data.code)) {
          reply({ ok: false, error: 'Enter the six-digit room code.' });
          return;
        }
        next = rooms.get(data.code);
        if (!next?.privateRoom) {
          reply({
            ok: false,
            error: 'That room doesn’t exist. Check the code or create a new one.',
          });
          return;
        }
      }
      if (data.mode === 'public')
        next = [...rooms.values()].find((r) => !r.privateRoom && r.players.size < ROOM_CAPACITY);
      if (!next) {
        if (rooms.size >= 100) {
          reply({ ok: false, error: 'All arenas are busy. Please try again soon.' });
          return;
        }
        const code = roomCode(rooms);
        next = new Arena(code, data.mode === 'create');
        rooms.set(code, next);
      }
      if (next.players.size >= ROOM_CAPACITY) {
        reply({ ok: false, error: 'This arena is full. Try Quick Play for an open arena.' });
        return;
      }
      leave();
      room = next;
      const p = room.addPlayer(socket.id, name, data.skin);
      reply({ ok: true, id: socket.id, code: room.code, private: room.privateRoom, name: p.name });
      socket.emit('snapshot', room.snapshot(p));
    });
    socket.on('input', (data) => {
      if (
        !budget(true) ||
        !data ||
        typeof data.angle !== 'number' ||
        !Number.isFinite(data.angle) ||
        Math.abs(data.angle) > 100 ||
        typeof data.boost !== 'boolean'
      )
        return;
      const p = room?.players.get(socket.id);
      if (p?.alive) {
        p.target = Math.atan2(Math.sin(data.angle), Math.cos(data.angle));
        p.boost = data.boost;
        p.inputAt = Date.now();
      }
    });
    socket.on('respawn', (reply) => {
      if (typeof reply !== 'function') return;
      const p = room?.players.get(socket.id);
      if (!budget() || !p || p.alive || Date.now() - lastRespawn < 700) {
        reply(false);
        return;
      }
      lastRespawn = Date.now();
      room!.spawn(p);
      reply(true);
      socket.emit('snapshot', room!.snapshot(p));
    });
    socket.on('leave', () => {
      if (budget()) leave();
    });
    socket.on('disconnect', leave);
    socket.on('latency', (reply) => {
      if (budget() && typeof reply === 'function') reply();
    });
  });
  let tick = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (!room.players.size) {
        if (now - room.emptySince > 60000) rooms.delete(code);
        continue;
      }
      for (const [id, death] of room.tick(1 / TICK_RATE, now)) io.to(id).emit('death', death);
      if (tick % Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE)) === 0)
        for (const p of room.players.values()) {
          const s = io.sockets.sockets.get(p.id);
          if (s && s.conn.transport.writable) s.emit('snapshot', room.snapshot(p, now));
        }
    }
    tick++;
  }, 1000 / TICK_RATE);
  // Food deltas must be reliable. Skip congested transports before advancing their known-food set.
  const close = async () => {
    clearInterval(timer);
    await new Promise<void>((r) => io.close(() => r()));
  };
  return { http, io, rooms, close };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = createGameServer();
  const port = Number(process.env.PORT) || 3001;
  game.http.listen(port, '0.0.0.0', () =>
    console.log(`Luma Coil listening on http://0.0.0.0:${port}`),
  );
  process.on('SIGTERM', () => void game.close().then(() => process.exit(0)));
  process.on('SIGINT', () => void game.close().then(() => process.exit(0)));
}
