import { Arena, type Player } from './arena.js';
import { NAMES } from './names.js';
import {
  BASE_MASS,
  BOOST_SPEED,
  NORMAL_SPEED,
  SKINS,
  WORLD_RADIUS,
  radiusFor,
  type Death,
} from './protocol.js';
export type Skill = 'easy' | 'normal' | 'hard' | 'expert';
export type Difficulty = Skill | 'mixed';
export interface GameConfig {
  difficulty: Difficulty;
  count: 10 | 20 | 30;
  name: string;
  skin: number;
}
export const PROFILES = {
  easy: {
    reaction: 480,
    vision: 280,
    horizon: 0.55,
    error: 0.48,
    caution: 0.65,
    predict: false,
    cutoff: 0,
    boost: 0.012,
    paths: 5,
  },
  normal: {
    reaction: 260,
    vision: 410,
    horizon: 0.85,
    error: 0.16,
    caution: 1,
    predict: false,
    cutoff: 0,
    boost: 0.06,
    paths: 7,
  },
  hard: {
    reaction: 170,
    vision: 550,
    horizon: 1.15,
    error: 0.065,
    caution: 1.3,
    predict: true,
    cutoff: 0.23,
    boost: 0.14,
    paths: 9,
  },
  expert: {
    reaction: 115,
    vision: 690,
    horizon: 1.55,
    error: 0.025,
    caution: 1.7,
    predict: true,
    cutoff: 0.38,
    boost: 0.2,
    paths: 11,
  },
} as const;
const PERSONALITIES = [
  { aggression: 1.5, caution: 0.82, food: 1, boost: 1.5 },
  { aggression: 0.3, caution: 1.4, food: 1, boost: 0.7 },
  { aggression: 0.5, caution: 1, food: 1.7, boost: 1.1 },
  { aggression: 1, caution: 1, food: 1, boost: 1 },
];
export interface Brain {
  skill: Skill;
  personality: number;
  nextThink: number;
  boostUntil: number;
  respawnAt: number;
  wander: number;
  decisions: number;
}
const delta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));
/** Inputs only: every coil uses Arena.tick for movement, pickups and collisions. */
export class LocalGame {
  readonly arena: Arena;
  readonly player: Player;
  readonly brains = new Map<string, Brain>();
  now = 0;
  constructor(
    public readonly config: GameConfig,
    private random: () => number = Math.random,
  ) {
    this.arena = new Arena('LOCAL', false, 2800, random);
    this.player = this.arena.addPlayer(
      'you',
      config.name.trim().slice(0, 20) || 'Wanderer',
      config.skin,
    );
    this.arena.spawn(this.player, 0);
    const names = [...NAMES];
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    const mix: Skill[] = [
      'easy',
      'normal',
      'normal',
      'hard',
      'normal',
      'expert',
      'normal',
      'hard',
      'normal',
      'easy',
    ];
    for (let i = 0; i < config.count; i++) {
      const p = this.arena.addPlayer(
        `ai-${i}`,
        names[i],
        Math.floor(random() * SKINS.length),
        true,
      );
      this.arena.spawn(p, 0);
      const skill = config.difficulty === 'mixed' ? mix[i % 10] : config.difficulty;
      this.brains.set(p.id, {
        skill,
        personality: i % 4,
        nextThink: random() * PROFILES[skill].reaction,
        boostUntil: 0,
        respawnAt: 0,
        wander: random() * 6.28,
        decisions: 0,
      });
    }
  }
  input(angle: number, boost: boolean) {
    if (Number.isFinite(angle)) this.player.target = angle;
    this.player.boost = boost;
    this.player.inputAt = this.now;
  }
  respawn() {
    this.arena.spawn(this.player, this.now);
  }
  snapshot() {
    return this.arena.snapshot(this.player, this.now);
  }
  step(): Death | undefined {
    this.now += 1000 / 30;
    for (const [id, b] of this.brains) {
      const p = this.arena.players.get(id)!;
      if (!p.alive) {
        if (!b.respawnAt) b.respawnAt = this.now + 2000 + this.random() * 1800;
        if (this.now >= b.respawnAt) {
          this.arena.spawn(p, this.now);
          b.respawnAt = 0;
          b.nextThink = this.now;
          b.boostUntil = 0;
        }
        continue;
      }
      if (this.now >= b.nextThink) {
        this.think(p, b);
        b.nextThink = this.now + PROFILES[b.skill].reaction * (0.9 + this.random() * 0.2);
        b.decisions++;
      }
      p.boost = this.now < b.boostUntil && p.mass > BASE_MASS + 12;
      p.inputAt = this.now;
    }
    return this.arena.tick(1 / 30, this.now).get(this.player.id);
  }
  think(p: Player, b: Brain) {
    const cfg = PROFILES[b.skill],
      persona = PERSONALITIES[b.personality];
    const bodies = this.arena.bodyGrid.near(p.x, p.y, cfg.vision).filter((v) => v.owner !== p.id);
    // Derive perceived heads from nearby bodies, and explicitly bound head vision.
    const heads = cfg.predict
      ? [...new Set(bodies.map((v) => v.owner))]
          .map((id) => this.arena.players.get(id)!)
          .filter((v) => v.alive && Math.hypot(v.x - p.x, v.y - p.y) < cfg.vision)
      : [];
    const food = this.arena.foodGrid.near(p.x, p.y, cfg.vision);
    b.wander += (this.random() - 0.5) * 0.5;
    let goal = p.angle + Math.sin(b.wander) * 0.6,
      value = 0,
      best = Infinity;
    for (const f of food) {
      const a = Math.atan2(f.y - p.y, f.x - p.x),
        dist = Math.hypot(f.x - p.x, f.y - p.y);
      const merit =
        (dist + Math.abs(delta(a, p.angle)) * 65) /
        (1 + Math.min(f.value, 15) * 0.4 * persona.food + (f.kind === 2 ? 0.8 * persona.food : 0));
      if (merit < best) {
        best = merit;
        goal = a;
        value = f.value;
      }
    }
    let attacking = false;
    if (cfg.cutoff && this.random() < cfg.cutoff * persona.aggression) {
      const target = heads.find(
        (h) => Math.hypot(h.x - p.x, h.y - p.y) > 100 && h.mass < p.mass * 1.4,
      );
      if (target) {
        const t = 0.65,
          x = target.x + Math.cos(target.angle) * NORMAL_SPEED * t,
          y = target.y + Math.sin(target.angle) * NORMAL_SPEED * t;
        // Only contest reachable space in front; path scoring still vetoes unsafe approaches.
        if (Math.hypot(x - p.x, y - p.y) < 220) {
          goal = Math.atan2(y - p.y, x - p.x);
          attacking = true;
        }
      }
    }
    const edge = WORLD_RADIUS - Math.hypot(p.x, p.y);
    if (edge < 360) goal = Math.atan2(-p.y, -p.x);
    goal += (this.random() - 0.5) * cfg.error * 2;
    const horizon = cfg.horizon + (b.skill === 'expert' ? Math.min(0.3, p.mass / 2000) : 0);
    const size = radiusFor(p.mass);
    const risk = (heading: number, speed: number) => {
      let x = p.x,
        y = p.y,
        a = p.angle,
        danger = 0;
      for (let step = 1; step <= 6; step++) {
        const dt = horizon / 6;
        a += clamp(delta(heading, a), 3.7 * dt);
        x += Math.cos(a) * speed * dt;
        y += Math.sin(a) * speed * dt;
        const wall = WORLD_RADIUS - Math.hypot(x, y) - size;
        if (wall < 75) danger += (75 - wall) / 18;
        // Local hash query avoids multiplying every trail point by every candidate path.
        for (const body of this.arena.bodyGrid.near(x, y, 65)) {
          if (body.owner === p.id || Math.hypot(body.x - p.x, body.y - p.y) > cfg.vision) continue;
          const gap = Math.hypot(body.x - x, body.y - y) - size - body.radius;
          if (gap < 42) danger += (42 - gap) / 24;
        }
        for (const h of heads) {
          const t = step * dt,
            hs = h.boosting ? BOOST_SPEED : NORMAL_SPEED;
          const gap =
            Math.hypot(h.x + Math.cos(h.angle) * hs * t - x, h.y + Math.sin(h.angle) * hs * t - y) -
            size -
            radiusFor(h.mass);
          if (gap < 55) danger += (55 - gap) / 20;
        }
      }
      if (b.skill === 'expert') {
        // Count locally obstructed exits at the endpoint to discourage pockets/traps.
        let blocked = 0;
        for (const offset of [-1.1, 0, 1.1]) {
          const ex = x + Math.cos(a + offset) * 85,
            ey = y + Math.sin(a + offset) * 85;
          if (
            Math.hypot(ex, ey) > WORLD_RADIUS - 50 ||
            this.arena.bodyGrid
              .near(ex, ey, 45)
              .some((v) => v.owner !== p.id && Math.hypot(v.x - p.x, v.y - p.y) < cfg.vision)
          )
            blocked++;
        }
        danger += blocked === 3 ? 6 : blocked * 0.55;
      }
      return danger;
    };
    let choice = goal,
      cost = Infinity,
      chosenRisk = 0;
    for (let i = 0; i < cfg.paths; i++) {
      const candidate = goal + (i - (cfg.paths - 1) / 2) * 0.36;
      const danger = risk(candidate, NORMAL_SPEED);
      const score =
        Math.abs(delta(candidate, goal)) * 0.75 +
        Math.abs(delta(candidate, p.angle)) * 0.14 +
        danger * cfg.caution * persona.caution +
        this.random() * cfg.error;
      if (score < cost) {
        cost = score;
        choice = candidate;
        chosenRisk = danger;
      }
    }
    p.target = choice;
    const escape = cfg.predict && risk(p.angle, NORMAL_SPEED) > 2 && chosenRisk < 0.6;
    const chance = cfg.boost * persona.boost * (value > 1 ? 2 : 1);
    if (
      p.mass > 54 &&
      edge > 330 &&
      chosenRisk < 0.8 &&
      risk(choice, BOOST_SPEED) < 0.8 &&
      (escape || attacking || this.random() < chance)
    )
      b.boostUntil = this.now + 350 + this.random() * 650;
    if (chosenRisk > 1 || edge < 260) b.boostUntil = 0;
  }
}
