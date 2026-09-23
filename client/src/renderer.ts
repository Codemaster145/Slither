import {
  BOOST_SPEED,
  NORMAL_SPEED,
  SKINS,
  WORLD_RADIUS,
  radiusFor,
  type Food,
  type Snapshot,
  type SnakeView,
} from '../../shared/protocol';
interface Frame {
  state: Snapshot;
  at: number;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const palette = ['#b6ee76', '#82dada', '#dc97c7', '#ecd88c', '#ad9be6'];
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private frames: Frame[] = [];
  foods = new Map<number, Food>();
  id = '';
  active = false;
  skin = 0;
  camera = { x: 0, y: 0, zoom: 1 };
  private ready = false;
  private width = 0;
  private height = 0;
  private raf = 0;
  private last = performance.now();
  private particles: { x: number; y: number; at: number; color: string }[] = [];
  private ambient = Array.from({ length: 95 }, (_, i) => ({
    x: Math.sin(i * 127.1) * 0.5 + 0.5,
    y: Math.cos(i * 311.7) * 0.5 + 0.5,
    r: 1.3 + (i % 4) * 0.6,
  }));
  onFrame?: (x: number, y: number) => void;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.draw);
  }
  resize = () => {
    this.width = innerWidth;
    this.height = innerHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  reset(id = '') {
    this.id = id;
    this.frames = [];
    this.foods.clear();
    this.ready = false;
    this.active = !!id;
  }
  push(state: Snapshot) {
    const at = performance.now();
    for (const f of state.foodAdd) this.foods.set(f.id, f);
    for (const id of state.foodRemove) {
      const f = this.foods.get(id);
      if (f && Math.hypot(f.x - this.camera.x, f.y - this.camera.y) < 60)
        this.particles.push({ x: f.x, y: f.y, at, color: palette[f.id % 5] });
      this.foods.delete(id);
    }
    this.frames.push({ state, at });
    if (this.frames.length > 12) this.frames.shift();
  }
  private interpolate(now: number): SnakeView[] {
    if (!this.frames.length) return [];
    const target = now - 100;
    let a = this.frames[0],
      b = this.frames.at(-1)!;
    for (let i = 1; i < this.frames.length; i++) {
      if (this.frames[i].at >= target) {
        a = this.frames[i - 1];
        b = this.frames[i];
        break;
      }
      a = this.frames[i];
    }
    const t = a === b ? 1 : Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at)));
    const old = new Map(a.state.snakes.map((s) => [s.id, s]));
    return b.state.snakes.map((s) => {
      const prev = old.get(s.id) ?? s;
      const body = s.body.map((v, i) => lerp(prev.body[i] ?? v, v, t));
      const angle =
        prev.angle + Math.atan2(Math.sin(s.angle - prev.angle), Math.cos(s.angle - prev.angle)) * t;
      // A bounded 50 ms extrapolation bridges one late snapshot; bodies move as a single continuous trail.
      const extra = a === b ? Math.min(50, Math.max(0, target - b.at)) / 1000 : 0;
      const speed = s.boost ? BOOST_SPEED : NORMAL_SPEED;
      const x = lerp(prev.x, s.x, t) + Math.cos(angle) * speed * extra,
        y = lerp(prev.y, s.y, t) + Math.sin(angle) * speed * extra;
      body[0] = x;
      body[1] = y;
      return { ...s, x, y, angle, body };
    });
  }
  private draw = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const c = this.ctx,
      w = this.width,
      h = this.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#101512';
    c.fillRect(0, 0, w, h);
    if (!this.active) {
      this.drawMenu(now);
      this.raf = requestAnimationFrame(this.draw);
      return;
    }
    const snakes = this.interpolate(now),
      me = snakes.find((s) => s.id === this.id);
    if (me) {
      if (!this.ready) {
        this.camera.x = me.x;
        this.camera.y = me.y;
        this.ready = true;
      }
      const follow = 1 - Math.exp(-12 * dt);
      this.camera.x = lerp(this.camera.x, me.x, follow);
      this.camera.y = lerp(this.camera.y, me.y, follow);
      const zoom = Math.max(0.38, Math.hypot(w, h) / 2900, 0.94 - Math.sqrt(me.mass) * 0.012);
      this.camera.zoom = lerp(this.camera.zoom, zoom, 1 - Math.exp(-3 * dt));
    }
    const z = this.camera.zoom;
    c.save();
    c.translate(w / 2, h / 2);
    c.scale(z, z);
    c.translate(-this.camera.x, -this.camera.y);
    const left = this.camera.x - w / 2 / z,
      right = this.camera.x + w / 2 / z,
      top = this.camera.y - h / 2 / z,
      bottom = this.camera.y + h / 2 / z;
    c.strokeStyle = '#1c261f';
    c.lineWidth = 1 / z;
    c.beginPath();
    for (let x = Math.floor(left / 80) * 80; x < right; x += 80) {
      c.moveTo(x, top);
      c.lineTo(x, bottom);
    }
    for (let y = Math.floor(top / 80) * 80; y < bottom; y += 80) {
      c.moveTo(left, y);
      c.lineTo(right, y);
    }
    c.stroke();
    c.strokeStyle = '#e9877060';
    c.lineWidth = 18;
    c.beginPath();
    c.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = '#f29c85';
    c.lineWidth = 2;
    c.stroke();
    for (const f of this.foods.values()) {
      if (f.x < left - 20 || f.x > right + 20 || f.y < top - 20 || f.y > bottom + 20) continue;
      const r = f.kind === 1 ? 5 : f.kind === 2 ? 4 : 2.8;
      const color = palette[f.id % palette.length];
      c.globalAlpha = 0.13;
      c.fillStyle = color;
      c.beginPath();
      c.arc(f.x, f.y, r * 3, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 0.8 + 0.2 * Math.sin(now * 0.002 + f.id);
      c.beginPath();
      c.arc(f.x, f.y, r, 0, Math.PI * 2);
      c.fill();
      if (f.kind === 1) {
        c.fillStyle = '#fffce0';
        c.beginPath();
        c.arc(f.x - 1, f.y - 1, 1.5, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
    for (const snake of snakes) this.drawSnake(snake, now);
    this.particles = this.particles.filter((p) => now - p.at < 450);
    for (const p of this.particles) {
      const t = (now - p.at) / 450;
      c.globalAlpha = 1 - t;
      c.strokeStyle = p.color;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(p.x, p.y, 6 + t * 18, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.restore();
    if (me) {
      this.drawMinimap(me);
      if (WORLD_RADIUS - Math.hypot(me.x, me.y) < 300) {
        c.fillStyle = '#edab91';
        c.font = '600 13px system-ui';
        c.textAlign = 'center';
        c.fillText('ARENA EDGE · TURN BACK', w / 2, 110);
      }
    }
    this.onFrame?.(this.camera.x, this.camera.y);
    this.raf = requestAnimationFrame(this.draw);
  };
  private drawSnake(s: SnakeView, now: number, label = true) {
    const c = this.ctx,
      colors = SKINS[s.skin]?.colors ?? SKINS[0].colors,
      r = radiusFor(s.mass),
      points = s.body;
    if (points.length < 4) return;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const path = () => {
      c.beginPath();
      c.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
    };
    if (s.boost) {
      path();
      c.strokeStyle = colors[0] + '24';
      c.lineWidth = r * 3.8;
      c.stroke();
      path();
      c.strokeStyle = colors[0] + '30';
      c.lineWidth = r * 2.9;
      c.stroke();
    }
    path();
    c.strokeStyle = '#060b08';
    c.lineWidth = r * 2 + 5;
    c.stroke();
    const gradient = c.createLinearGradient(s.x, s.y, points.at(-2)!, points.at(-1)!);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    path();
    c.strokeStyle = gradient;
    c.lineWidth = r * 2;
    c.stroke();
    for (let i = points.length - 2; i >= 2; i -= 2) {
      c.globalAlpha = (i / 2) % 3 === 0 ? 0.3 : 0.08;
      c.fillStyle = s.skin === 4 && (i / 2) % 3 === 0 ? '#fff' : '#102817';
      c.beginPath();
      c.arc(points[i], points[i + 1], r * 0.94, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = colors[0];
    c.beginPath();
    c.arc(s.x, s.y, r, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(s.x, s.y);
    c.rotate(s.angle);
    for (const side of [-1, 1]) {
      c.fillStyle = '#faffee';
      c.beginPath();
      c.ellipse(r * 0.36, side * r * 0.49, r * 0.35, r * 0.3, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#172519';
      c.beginPath();
      c.arc(r * 0.49, side * r * 0.49, r * 0.16, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    if (s.shield) {
      c.setLineDash([5, 6]);
      c.strokeStyle = colors[0] + '99';
      c.lineWidth = 1.3;
      c.beginPath();
      c.arc(s.x, s.y, r + 9 + Math.sin(now * 0.006) * 2, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    if (label) {
      c.font = '500 12px system-ui';
      c.textAlign = 'center';
      c.fillStyle = s.id === this.id ? '#e8f4dc' : '#c5d3c6';
      c.fillText(s.name, s.x, s.y - r - 15);
    }
    c.restore();
  }
  private drawMinimap(me: SnakeView) {
    const c = this.ctx,
      size = this.width < 600 ? 86 : 116,
      x = this.width - size / 2 - 30,
      y = this.height - size / 2 - 38,
      r = size / 2;
    c.save();
    c.fillStyle = '#0a100cbb';
    c.strokeStyle = '#72856c44';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.strokeStyle = '#72856c22';
    c.beginPath();
    c.moveTo(x - r, y);
    c.lineTo(x + r, y);
    c.moveTo(x, y - r);
    c.lineTo(x, y + r);
    c.stroke();
    c.fillStyle = '#b4f85b';
    c.shadowColor = '#b4f85b';
    c.shadowBlur = 8;
    c.beginPath();
    c.arc(x + (me.x / WORLD_RADIUS) * r, y + (me.y / WORLD_RADIUS) * r, 3, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#92a18c';
    c.font = '9px system-ui';
    c.textAlign = 'center';
    c.fillText('YOUR CORNER OF THE COSMOS', x, y + r + 18);
    c.restore();
  }
  private drawMenu(now: number) {
    const c = this.ctx,
      w = this.width,
      h = this.height;
    c.save();
    const glow = c.createRadialGradient(w * 0.72, h * 0.47, 0, w * 0.72, h * 0.47, w * 0.6);
    glow.addColorStop(0, '#293b223d');
    glow.addColorStop(1, '#10151200');
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#59704b';
    for (const p of this.ambient) {
      c.globalAlpha = 0.14;
      c.beginPath();
      c.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    if (w > 850) {
      const cx = w * 0.71,
        cy = h * 0.52,
        scale = Math.min(w / 1400, h / 850);
      c.translate(cx, cy);
      c.scale(scale, scale);
      c.strokeStyle = '#9ab88413';
      c.lineWidth = 1;
      for (const r of [175, 270, 365]) {
        c.beginPath();
        c.ellipse(0, 0, r, r * 0.82, -0.3, 0, Math.PI * 2);
        c.stroke();
      }
      const points: number[] = [];
      for (let i = 0; i < 140; i++) {
        const t = i / 139;
        const a = -0.4 + t * 5.6;
        const radius = 90 + t * 140;
        points.push(Math.cos(a) * radius + Math.sin(now * 0.0003) * 8, Math.sin(a) * radius * 0.9);
      }
      const angle = Math.atan2(points[1] - points[3], points[0] - points[2]);
      this.drawSnake(
        {
          id: 'hero',
          bot: false,
          name: '',
          skin: this.skin,
          x: points[0],
          y: points[1],
          angle,
          mass: 1100,
          boost: true,
          shield: false,
          body: points,
        },
        now,
        false,
      );
      for (let i = 0; i < 22; i++) {
        const a = i * 2.399,
          r = 240 + (i % 5) * 20,
          x = Math.cos(a) * r,
          y = Math.sin(a) * r * 0.83;
        c.fillStyle = palette[i % 5];
        c.globalAlpha = 0.12;
        c.beginPath();
        c.arc(x, y, 12, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 0.7;
        c.beginPath();
        c.arc(x, y, 3 + (i % 3), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      c.font = '11px system-ui';
      c.fillStyle = '#718369';
      c.fillText('ENDLESS POSSIBILITIES. ONE LITTLE COIL.', -136, 320);
    }
    c.restore();
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
  }
}
