import { randomInt } from 'node:crypto';
import { Arena as SharedArena } from '../shared/arena.js';
import { BotController } from './bots.js';
export type { Player } from '../shared/arena.js';
export class Arena extends SharedArena {
  readonly bots: BotController;
  constructor(
    code: string,
    privateRoom: boolean,
    foodTarget = 2400,
    random: () => number = Math.random,
  ) {
    super(code, privateRoom, foodTarget, random);
    this.bots = new BotController(this, random);
  }
}
export function roomCode(existing: Map<string, unknown>) {
  let code: string;
  do {
    code = String(randomInt(100000, 1000000));
  } while (existing.has(code));
  return code;
}
