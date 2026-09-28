import type { GameConfig } from './local-game';
import type { Death, Snapshot } from './protocol';
export type Command =
  | { type: 'start'; config: GameConfig }
  | { type: 'input'; angle: number; boost: boolean }
  | { type: 'respawn' }
  | { type: 'pause'; paused: boolean };
export type GameEvent =
  | { type: 'ready' }
  | { type: 'snapshot'; state: Snapshot; seconds: number; tickMs: number }
  | { type: 'death'; data: Death }
  | { type: 'respawned' };
