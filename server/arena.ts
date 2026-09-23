import { randomInt } from 'node:crypto';
import {
  BASE_MASS,
  MAX_MASS,
  BOOST_SPEED,
  NORMAL_SPEED,
  WORLD_RADIUS,
  VIEW_RADIUS,
  lengthFor,
  radiusFor,
  type Point,
  type Food,
  type Snapshot,
  type Death,
} from '../shared/protocol.js';
import { SpatialHash } from './spatial.js';
export interface Player extends Point {
  id: string;
  name: string;
  skin: number;
  angle: number;
  target: number;
  boost: boolean;
  boosting: boolean;
  mass: number;
  alive: boolean;
  trail: Point[];
  born: number;
  shieldUntil: number;
  knownFood: Set<number>;
  dropped: number;
  inputAt: number;
}
interface BodyPoint extends Point {
  owner: string;
  radius: number;
}
const round = (n: number) => Math.round(n);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export class Arena {
  players = new Map<string, Player>();
  foods = new Map<number, Food>();
  foodGrid = new SpatialHash<Food>(100);
  bodyGrid = new SpatialHash<BodyPoint>(64);
  emptySince = Date.now();
  private foodId = 0;
  private seq = 0;
  constructor(
    public code: string,
    public privateRoom: boolean,
    public foodTarget = 2400,
  ) {
    for (let i = 0; i < foodTarget; i++) this.spawnFood();
  }
  point(): Point {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (WORLD_RADIUS - 80);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  addFood(x: number, y: number, value = 1, kind = 0) {
    if (this.foods.size >= this.foodTarget + 2200) return;
    const food = { id: ++this.foodId, x: round(x), y: round(y), value, kind };
    this.foods.set(food.id, food);
    this.foodGrid.add(food);
    return food;
  }
  spawnFood() {
    let p = this.point();
    for (let i = 0; i < 4 && this.foodGrid.near(p.x, p.y, 14).length; i++) p = this.point();
    const rich = Math.random() < 0.1;
    this.addFood(p.x, p.y, rich ? 4 : 1, rich ? 1 : 0);
  }
  addPlayer(id: string, name: string, skin: number) {
    const names = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    const base = name;
    let suffix = 2;
    while (names.has(name.toLowerCase())) name = `${base.slice(0, 16)} ${suffix++}`;
    const player: Player = {
      id,
      name,
      skin,
      x: 0,
      y: 0,
      angle: 0,
      target: 0,
      boost: false,
      boosting: false,
      mass: BASE_MASS,
      alive: false,
      trail: [],
      born: 0,
      shieldUntil: 0,
      knownFood: new Set(),
      dropped: 0,
      inputAt: 0,
    };
    this.players.set(id, player);
    this.spawn(player);
    return player;
  }
  spawn(p: Player, now = Date.now()) {
    let pos: Point = { x: 0, y: 0 };
    // Private friends start in the same region; protection gives both time to turn.
    const friend = [...this.players.values()].find((v) => v.id !== p.id && v.alive);
    for (let tries = 0; tries < 30; tries++) {
      if (this.privateRoom && friend) {
        const a = Math.random() * Math.PI * 2;
        pos = { x: friend.x + Math.cos(a) * 360, y: friend.y + Math.sin(a) * 360 };
      } else {
        const a = Math.random() * Math.PI * 2,
          r = 300 + Math.random() * 1000;
        pos = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      }
      if (
        Math.hypot(pos.x, pos.y) < WORLD_RADIUS - 250 &&
        !this.bodyGrid.near(pos.x, pos.y, 100).length
      )
        break;
    }
    Object.assign(p, pos, {
      angle: Math.atan2(-pos.y, -pos.x),
      mass: BASE_MASS,
      alive: true,
      boost: false,
      boosting: false,
      born: now,
      shieldUntil: now + 2500,
      dropped: 0,
      inputAt: now,
    });
    p.target = p.angle;
    p.trail = Array.from({ length: 30 }, (_, i) => ({
      x: p.x - Math.cos(p.angle) * i * 5,
      y: p.y - Math.sin(p.angle) * i * 5,
    }));
    p.knownFood.clear();
  }
  kill(p: Player, reason: string, now: number): Death {
    p.alive = false;
    p.boost = false;
    p.boosting = false;
    const step = 3;
    const count = Math.ceil(p.trail.length / step);
    const value = Math.max(1, Math.floor((p.mass * 0.72) / count));
    for (let i = 0; i < p.trail.length; i += step)
      this.addFood(
        p.trail[i].x + (Math.random() - 0.5) * 14,
        p.trail[i].y + (Math.random() - 0.5) * 14,
        value,
        2,
      );
    return { score: Math.floor(p.mass), seconds: Math.floor((now - p.born) / 1000), reason };
  }
  tick(dt: number, now = Date.now()): Map<string, Death> {
    const deaths = new Map<string, Death>();
    const previous = new Map<string, Point>();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      previous.set(p.id, { x: p.x, y: p.y });
      if (now - p.inputAt > 1000) p.boost = false;
      const delta = Math.atan2(Math.sin(p.target - p.angle), Math.cos(p.target - p.angle));
      p.angle += Math.max(-3.7 * dt, Math.min(3.7 * dt, delta));
      p.boosting = p.boost && p.mass > BASE_MASS + 4;
      const speed = p.boosting ? BOOST_SPEED : NORMAL_SPEED;
      p.x += Math.cos(p.angle) * speed * dt;
      p.y += Math.sin(p.angle) * speed * dt;
      p.trail.unshift({ x: p.x, y: p.y });
      let total = 0,
        keep = p.trail.length;
      for (let i = 1; i < p.trail.length; i++) {
        total += distance(p.trail[i - 1], p.trail[i]);
        if (total > lengthFor(p.mass)) {
          keep = i + 1;
          break;
        }
      }
      p.trail.length = keep;
      if (p.boosting) {
        p.mass = Math.max(BASE_MASS, p.mass - 7 * dt);
        p.dropped += dt;
        if (p.dropped > 0.16) {
          const tail = p.trail.at(-1)!;
          this.addFood(tail.x, tail.y, 1, 2);
          p.dropped = 0;
        }
      }
    }
    this.bodyGrid.clear();
    for (const p of this.players.values())
      if (p.alive && now >= p.shieldUntil)
        for (let i = 0; i < p.trail.length; i += 2)
          this.bodyGrid.add({ ...p.trail[i], owner: p.id, radius: radiusFor(p.mass) });
    const doomed = new Map<string, string>();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (Math.hypot(p.x, p.y) > WORLD_RADIUS - radiusFor(p.mass)) {
        doomed.set(p.id, 'You reached the edge of the arena.');
        continue;
      }
      if (now < p.shieldUntil) continue;
      const prev = previous.get(p.id)!;
      // Swept head samples prevent tunneling. A forgiving hit radius leaves room for interpolation delay.
      for (let s = 0; s <= 2; s++) {
        const x = prev.x + ((p.x - prev.x) * s) / 2,
          y = prev.y + ((p.y - prev.y) * s) / 2;
        if (
          this.bodyGrid
            .near(x, y, 40)
            .some(
              (b) =>
                b.owner !== p.id &&
                Math.hypot(b.x - x, b.y - y) < (radiusFor(p.mass) + b.radius) * 0.72,
            )
        ) {
          doomed.set(p.id, 'Your path crossed another coil.');
          break;
        }
      }
    }
    // Resolve deaths simultaneously so head-on encounters do not favor iteration order.
    for (const [id, reason] of doomed)
      deaths.set(id, this.kill(this.players.get(id)!, reason, now));
    for (const p of this.players.values())
      if (p.alive)
        for (const f of this.foodGrid.near(p.x, p.y, radiusFor(p.mass) + 6)) {
          p.mass = Math.min(MAX_MASS, p.mass + f.value);
          this.foods.delete(f.id);
          this.foodGrid.remove(f);
        }
    for (let i = 0; i < 8 && this.foods.size < this.foodTarget; i++) this.spawnFood();
    return deaths;
  }
  snapshot(p: Player, now = Date.now()): Snapshot {
    const alive = [...this.players.values()].filter((p) => p.alive).sort((a, b) => b.mass - a.mass);
    const nearby = this.foodGrid.near(p.x, p.y, VIEW_RADIUS);
    const visible = new Set(nearby.map((f) => f.id));
    const foodAdd = nearby.filter((f) => !p.knownFood.has(f.id));
    const foodRemove = [...p.knownFood].filter((id) => !visible.has(id));
    p.knownFood = visible;
    return {
      time: now,
      seq: ++this.seq,
      count: this.players.size,
      rank: alive.findIndex((v) => v.id === p.id) + 1,
      score: Math.floor(p.mass),
      foodAdd,
      foodRemove,
      leaders: alive
        .slice(0, 10)
        .map((v) => ({ id: v.id, name: v.name, score: Math.floor(v.mass), skin: v.skin })),
      snakes: alive
        .filter(
          (v) =>
            v.id === p.id ||
            v.trail.some((b, i) => i % 8 === 0 && distance(b, p) < VIEW_RADIUS + 120),
        )
        .map((v) => {
          const body: number[] = [];
          let accumulated = 20;
          for (let i = 0; i < v.trail.length; i++) {
            if (i) accumulated += distance(v.trail[i - 1], v.trail[i]);
            if (accumulated >= 15 || i === v.trail.length - 1) {
              body.push(round(v.trail[i].x), round(v.trail[i].y));
              accumulated = 0;
            }
          }
          return {
            id: v.id,
            name: v.name,
            skin: v.skin,
            x: round(v.x),
            y: round(v.y),
            angle: v.angle,
            mass: Math.floor(v.mass),
            boost: v.boosting,
            shield: now < v.shieldUntil,
            body,
          };
        }),
    };
  }
}
export function roomCode(existing: Map<string, unknown>) {
  let code: string;
  do {
    code = String(randomInt(100000, 1000000));
  } while (existing.has(code));
  return code;
}
