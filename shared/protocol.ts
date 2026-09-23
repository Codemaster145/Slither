export const WORLD_RADIUS = 2600;
export const BASE_MASS = 32;
export const MAX_MASS = 1800;
export const NORMAL_SPEED = 145;
export const BOOST_SPEED = 245;
export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const ROOM_CAPACITY = 32;
export const VIEW_RADIUS = 1650;
export const SKINS = [
  { name: 'Ion', colors: ['#b4f85b', '#67cf43'], description: 'A little electric.' },
  { name: 'Glacier', colors: ['#6ee7f7', '#3486df'], description: 'Stay ice cold.' },
  { name: 'Afterglow', colors: ['#fc9c67', '#ed567c'], description: 'Leave a warm impression.' },
  { name: 'Orbit', colors: ['#c8a0ff', '#8756e7'], description: 'Out of this world.' },
  { name: 'Candyline', colors: ['#fba8dc', '#f2e8ff'], description: 'Sweet, with a sharp turn.' },
  { name: 'Voltage', colors: ['#f8dd68', '#ff963b'], description: 'Born to boost.' },
] as const;
export interface Point {
  x: number;
  y: number;
}
export interface Food extends Point {
  id: number;
  value: number;
  kind: number;
}
export interface SnakeView {
  bot: boolean;
  id: string;
  name: string;
  skin: number;
  x: number;
  y: number;
  angle: number;
  mass: number;
  boost: boolean;
  shield: boolean;
  body: number[];
}
export interface Leader {
  bot: boolean;
  id: string;
  name: string;
  score: number;
  skin: number;
}
export interface Snapshot {
  time: number;
  seq: number;
  snakes: SnakeView[];
  foodAdd: Food[];
  foodRemove: number[];
  leaders: Leader[];
  count: number;
  humanCount: number;
  botCount: number;
  rank: number;
  score: number;
}
export interface JoinRequest {
  mode: 'public' | 'create' | 'join';
  name: string;
  skin: number;
  code?: string;
}
export type JoinReply =
  | { ok: true; id: string; code: string; private: boolean; name: string }
  | { ok: false; error: string };
export interface Death {
  score: number;
  seconds: number;
  reason: string;
}
export interface ServerEvents {
  snapshot: (state: Snapshot) => void;
  death: (data: Death) => void;
}
export interface ClientEvents {
  join: (data: JoinRequest, reply: (result: JoinReply) => void) => void;
  input: (data: { angle: number; boost: boolean }) => void;
  respawn: (reply: (ok: boolean) => void) => void;
  leave: () => void;
  latency: (reply: () => void) => void;
}
export const radiusFor = (mass: number) => 10 + Math.min(8, Math.sqrt(mass) * 0.22);
export const lengthFor = (mass: number) => 100 + mass * 1.05;
