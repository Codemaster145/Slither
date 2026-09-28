import { LocalGame } from '../../shared/local-game';
import type { Command, GameEvent } from '../../shared/worker-protocol';
let game: LocalGame | undefined,
  paused = false,
  previous = performance.now(),
  accumulator = 0,
  ticks = 0,
  tickMs = 0;
const send = (event: GameEvent) => postMessage(event);
self.onmessage = (event: MessageEvent<Command>) => {
  const message = event.data;
  if (message.type === 'start') {
    game = new LocalGame(message.config);
    paused = false;
    accumulator = 0;
    previous = performance.now();
    ticks = 0;
    send({ type: 'ready' });
  }
  if (!game) return;
  if (message.type === 'input') game.input(message.angle, message.boost);
  if (message.type === 'respawn') {
    game.respawn();
    paused = false;
    accumulator = 0;
    previous = performance.now();
    send({ type: 'respawned' });
  }
  if (message.type === 'pause') {
    paused = message.paused;
    game.input(game.player.target, false);
    accumulator = 0;
    previous = performance.now();
  }
};
setInterval(() => {
  const time = performance.now();
  const elapsed = Math.min(100, time - previous);
  previous = time;
  if (!game || paused) return;
  accumulator += elapsed;
  while (accumulator >= 1000 / 30) {
    const before = performance.now(),
      death = game.step();
    tickMs = performance.now() - before;
    accumulator -= 1000 / 30;
    ticks++;
    if (ticks % 2 === 0)
      send({
        type: 'snapshot',
        state: game.snapshot(),
        seconds: Math.floor((game.now - game.player.born) / 1000),
        tickMs,
      });
    if (death) {
      send({ type: 'death', data: death });
      paused = true;
      accumulator = 0;
      break;
    }
  }
}, 8);
