import { randomUUID } from 'node:crypto';
import type { Arena, Player } from './arena.js';
import {
  BASE_MASS,
  NORMAL_SPEED,
  SKINS,
  VIEW_RADIUS,
  WORLD_RADIUS,
  radiusFor,
} from '../shared/protocol.js';

export const PUBLIC_POPULATION = 18;
export const HUMAN_ONLY_THRESHOLD = 15;
export const desiredBots = (humans: number) =>
  humans === 0 || humans >= HUMAN_ONLY_THRESHOLD ? 0 : PUBLIC_POPULATION - humans;
export type BotSkill = 'easy' | 'normal' | 'good';
export const SKILL_SETTINGS = {
  easy: { reaction: 380, vision: 260, lookahead: 0.55, error: 0.28, caution: 0.8 },
  normal: { reaction: 240, vision: 380, lookahead: 0.8, error: 0.12, caution: 1.0 },
  good: { reaction: 160, vision: 520, lookahead: 1.0, error: 0.05, caution: 1.2 },
} as const;
const NAMES = [
  'Nova',
  'Orbit',
  'Pixel',
  'Comet',
  'Drift',
  'Flux',
  'Echo',
  'Vortex',
  'Bolt',
  'Neon',
  'Mica',
  'Prism',
  'Nimbus',
  'Fable',
  'Quasar',
  'Cinder',
  'Pebble',
  'Ripple',
  'Wisp',
  'Dusk',
  'Solstice',
  'Tumble',
  'Glimmer',
  'Moss',
  'Kestrel',
  'Flicker',
  'Saffron',
  'Cobalt',
  'Pollen',
  'Hush',
  'Velvet',
  'Copper',
  'Sprout',
  'Zephyr',
  'Juniper',
  'Ember',
  'Tinsel',
  'Sundrop',
  'Bramble',
  'Pip',
  'Aster',
  'Cricket',
  'Tonic',
  'Doodle',
  'Frost',
  'Sprocket',
  'Marble',
  'Lantern',
  'Breeze',
  'Nectar',
  'Tango',
  'Mallow',
  'Indigo',
  'Whim',
  'Acorn',
  'Starlit',
  'Sizzle',
  'Petal',
  'Sway',
  'Lilt',
];
export interface BotBrain {
  skill: BotSkill;
  nextThink: number;
  boostUntil: number;
  respawnAt: number;
  retiring: boolean;
  wander: number;
}
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/** Produces ordinary movement inputs. Arena.tick remains the only gameplay authority. */
export class BotController {
  readonly brains = new Map<string, BotBrain>();
  private nextBalance = 0;
  private skillBag: BotSkill[] = [];
  constructor(
    private arena: Arena,
    private random: () => number = Math.random,
  ) {}

  update(now: number) {
    if (now >= this.nextBalance || this.arena.humanCount === 0 || this.arena.privateRoom) {
      this.balance(now);
      this.nextBalance = now + 500;
    }
    for (const [id, brain] of this.brains) {
      const p = this.arena.players.get(id);
      if (!p) {
        this.brains.delete(id);
        continue;
      }
      if (!p.alive) {
        if (brain.retiring) {
          this.remove(id);
          continue;
        }
        if (!brain.respawnAt) brain.respawnAt = now + 2000 + this.random() * 2000;
        if (now >= brain.respawnAt) {
          this.arena.spawn(p, now);
          brain.respawnAt = 0;
          brain.nextThink = now;
          brain.boostUntil = 0;
        }
        continue;
      }
      if (now >= brain.nextThink) {
        this.think(p, brain, now);
        brain.nextThink = now + SKILL_SETTINGS[brain.skill].reaction * (0.85 + this.random() * 0.3);
      }
      p.boost = now < brain.boostUntil;
      p.inputAt = now;
    }
  }

  private remove(id: string) {
    this.arena.players.delete(id);
    this.brains.delete(id);
  }

  private balance(now: number) {
    const humans = [...this.arena.players.values()].filter((p) => !p.bot);
    const desired = this.arena.privateRoom ? 0 : desiredBots(humans.length);
    if (!humans.length || this.arena.privateRoom) {
      for (const id of this.brains.keys()) this.remove(id);
      return;
    }
    // A coil is visible if ANY part of its trail falls in a human's relevance area.
    const visible = (p: Player) =>
      humans.some((h) => p.trail.some((b) => Math.hypot(b.x - h.x, b.y - h.y) < VIEW_RADIUS + 180));
    const candidates = [...this.brains.keys()]
      .map((id) => this.arena.players.get(id)!)
      .filter(Boolean);
    const visibility = new Map(candidates.map((p) => [p.id, visible(p)]));
    // Keep established, visible coils first. Dead or offscreen excess bots can leave quietly.
    candidates.sort(
      (a, b) =>
        Number(b.alive) - Number(a.alive) ||
        Number(visibility.get(b.id)) - Number(visibility.get(a.id)) ||
        Number(this.brains.get(a.id)!.retiring) - Number(this.brains.get(b.id)!.retiring) ||
        b.mass - a.mass,
    );
    candidates.forEach((p, i) => {
      const brain = this.brains.get(p.id)!;
      brain.retiring = i >= desired;
      if (brain.retiring && (!p.alive || !visibility.get(p.id))) this.remove(p.id);
    });
    while (this.brains.size < desired) {
      const used = new Set([...this.arena.players.values()].map((p) => p.name.toLowerCase()));
      const available = NAMES.filter((name) => !used.has(name.toLowerCase()));
      const name =
        available[Math.floor(this.random() * available.length)] ?? `Glow ${this.brains.size + 1}`;
      if (!this.skillBag.length) {
        this.skillBag = ['normal', 'normal', 'easy', 'normal', 'good', 'normal', 'normal'];
        for (let i = this.skillBag.length - 1; i > 0; i--) {
          const j = Math.floor(this.random() * (i + 1));
          [this.skillBag[i], this.skillBag[j]] = [this.skillBag[j], this.skillBag[i]];
        }
      }
      const skill = this.skillBag.pop()!;
      const p = this.arena.addPlayer(
        `ai-${randomUUID()}`,
        name,
        Math.floor(this.random() * SKINS.length),
        true,
      );
      this.brains.set(p.id, {
        skill,
        nextThink: now + this.random() * 300,
        boostUntil: 0,
        respawnAt: 0,
        retiring: false,
        wander: p.angle,
      });
    }
  }

  private think(p: Player, brain: BotBrain, now: number) {
    const skill = SKILL_SETTINGS[brain.skill];
    let goal = brain.wander;
    let valuable = false;
    let nearestCost = Infinity;
    const edge = WORLD_RADIUS - Math.hypot(p.x, p.y);
    // Vision is local, and decisions are staggered at 2.5–6 Hz rather than every tick.
    for (const f of this.arena.foodGrid.near(p.x, p.y, skill.vision)) {
      const distance = Math.hypot(f.x - p.x, f.y - p.y);
      const direction = Math.atan2(f.y - p.y, f.x - p.x);
      const turn = Math.abs(angleDelta(direction, p.angle));
      const cost = (distance + turn * 65) / (1 + Math.min(8, f.value) * 0.32);
      if (cost < nearestCost) {
        nearestCost = cost;
        goal = direction;
        valuable = f.value > 1 && distance > 90;
      }
    }
    if (!Number.isFinite(nearestCost)) {
      brain.wander = p.angle + (this.random() - 0.5) * 0.8;
      goal = brain.wander;
    }
    if (edge < 350) goal = Math.atan2(-p.y, -p.x);
    // Retiring visible bots swim outward under normal movement rules, then die at the boundary.
    // This temporarily allows over-target populations instead of popping a visible coil out of existence.
    if (brain.retiring) goal = Math.atan2(p.y, p.x);
    const nearby = this.arena.bodyGrid
      .near(p.x, p.y, Math.min(skill.vision, 300))
      .filter((b) => b.owner !== p.id);
    let best = Infinity,
      bestAngle = p.angle,
      bestDanger = Infinity;
    for (const offset of [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2]) {
      const candidate = p.angle + offset;
      let direction = p.angle,
        x = p.x,
        y = p.y,
        danger = 0;
      for (let step = 0; step < 5; step++) {
        const dt = skill.lookahead / 5;
        direction += clamp(angleDelta(candidate, direction), 3.7 * dt);
        x += Math.cos(direction) * NORMAL_SPEED * dt;
        y += Math.sin(direction) * NORMAL_SPEED * dt;
        if (!brain.retiring) danger += Math.max(0, Math.hypot(x, y) - (WORLD_RADIUS - 65)) * 0.3;
        for (const b of nearby) {
          const clearance = Math.hypot(x - b.x, y - b.y) - (radiusFor(p.mass) + b.radius);
          if (clearance < 45) danger += Math.max(0, 45 - clearance) / 15;
        }
      }
      const score =
        Math.abs(angleDelta(candidate, goal)) * 1.8 +
        Math.abs(offset) * 0.15 +
        danger * skill.caution +
        (this.random() - 0.5) * skill.error;
      if (score < best) {
        best = score;
        bestAngle = candidate;
        bestDanger = danger;
      }
    }
    p.target = bestAngle + (this.random() - 0.5) * skill.error;
    if (bestDanger > 1 || edge < 400 || p.mass < BASE_MASS + 14) brain.boostUntil = 0;
    else if (
      now >= brain.boostUntil &&
      p.mass > BASE_MASS + 22 &&
      this.random() < (valuable ? 0.18 : 0.018)
    )
      brain.boostUntil = now + 300 + this.random() * 650;
  }
}
