// Active skills cast by digit keys (1..9 directly; two digits held together
// for 10+). Each skill has a cooldown tracked on the player. Visual effects
// live in Game.effects — same lifecycle as particles.

// ----- Visual effects ---------------------------------------------------

// Expanding damage ring — travels out until it passes the screen edge.
class SoundWave {
  constructor(x, y, damage, maxR) {
    this.x = x; this.y = y;
    this.r = 12;
    this.maxR = maxR;
    this.speed = 820;
    this.damage = damage;
    // Using Set so both Enemy and Obstacle refs work as keys.
    this.hit = new Set();
    this.alive = true;
  }
  update(dt) {
    this.r += this.speed * dt;
    if (this.r >= this.maxR) { this.alive = false; return; }
    const r2 = this.r * this.r;
    // Enemies.
    for (const e of Game.enemies) {
      if (!e.alive || this.hit.has(e)) continue;
      if (dist2(this.x, this.y, e.x, e.y) < r2) {
        e.takeDamage(this.damage, 'player');
        this.hit.add(e);
      }
    }
    // Neutral civilians too — the wave doesn't discriminate.
    for (const n of Game.neutrals) {
      if (!n.alive || this.hit.has(n)) continue;
      if (dist2(this.x, this.y, n.x, n.y) < r2) {
        n.takeDamage(this.damage, 'player');
        this.hit.add(n);
      }
    }
    // Destructible obstacles.
    const near = World.getObstaclesNear(this.x, this.y, this.r + 40);
    for (const o of near) {
      if (o.dead || this.hit.has(o)) continue;
      if (dist2(this.x, this.y, o.x, o.y) < r2) {
        o.hit(this.damage, 'player');
        this.hit.add(o);
      }
    }
  }
  render(ctx) {
    const t = this.r / this.maxR;
    const alpha = Math.max(0, 1 - t);
    ctx.save();
    // Leading ring — thick glow then hair-thin white core.
    ctx.strokeStyle = `rgba(140, 220, 255, ${alpha * 0.85})`;
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.stroke();
    // Echo ring just inside.
    if (this.r > 60) {
      ctx.strokeStyle = `rgba(140, 220, 255, ${alpha * 0.35})`;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r - 48, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

// Short-lived jagged lightning bolt between two points.
class LightningArc {
  constructor(x1, y1, x2, y2, color) {
    this.alive = true;
    this.life = 0.35;
    this.maxLife = 0.35;
    this.color = color || '#c8a8ff';
    const pts = [];
    const segments = 9;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const amp = Math.min(18, len * 0.12);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const j = (i === 0 || i === segments) ? 0 : (Math.random() * 2 - 1) * amp;
      pts.push([x1 + dx * t + nx * j, y1 + dy * t + ny * j]);
    }
    this.points = pts;
  }
  update(dt) { this.life -= dt; if (this.life <= 0) this.alive = false; }
  render(ctx) {
    const a = this.life / this.maxLife;
    ctx.save();
    // Outer glow.
    ctx.strokeStyle = `rgba(200, 170, 255, ${a * 0.55})`;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(this.points[0][0], this.points[0][1]);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i][0], this.points[i][1]);
    ctx.stroke();
    // Middle.
    ctx.strokeStyle = `rgba(180, 140, 255, ${a})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    // White core.
    ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
}

// ----- Skill behaviours -------------------------------------------------

// Cast chain lightning from `caster` to the nearest visible enemy, then fan
// out geometrically: each struck enemy re-emits 2 bolts at its nearest two
// un-hit visible enemies, doubling until the roster is exhausted.
function castChainLightning(caster, damage) {
  const viewR = Math.hypot(Game.w, Game.h) / 2;
  const visible = [];
  for (const e of Game.enemies) {
    if (!e.alive) continue;
    if (dist2(e.x, e.y, caster.x, caster.y) < viewR * viewR) visible.push(e);
  }
  if (!visible.length) return false;

  const hit = new Set();
  visible.sort((a, b) => dist2(caster.x, caster.y, a.x, a.y) - dist2(caster.x, caster.y, b.x, b.y));
  const first = visible[0];
  hit.add(first);
  Game.effects.push(new LightningArc(caster.x, caster.y, first.x, first.y));
  first.takeDamage(damage, 'player');

  let frontier = [first];
  // Safety cap — 2^20 is way beyond any realistic enemy count.
  for (let depth = 0; depth < 20 && frontier.length; depth++) {
    const next = [];
    for (const src of frontier) {
      const remaining = visible.filter(e => !hit.has(e) && e.alive);
      if (!remaining.length) break;
      remaining.sort((a, b) => dist2(src.x, src.y, a.x, a.y) - dist2(src.x, src.y, b.x, b.y));
      for (let k = 0; k < Math.min(2, remaining.length); k++) {
        const t = remaining[k];
        if (hit.has(t)) continue;
        hit.add(t);
        Game.effects.push(new LightningArc(src.x, src.y, t.x, t.y));
        t.takeDamage(damage, 'player');
        next.push(t);
      }
    }
    frontier = next;
  }
  return true;
}

// ----- Registry ---------------------------------------------------------

// Ordered list. Keyboard digit N (1..9) casts SKILLS[N-1]. Two-digit combos
// (e.g. 1+0) will reach indices 9+ once those are defined.
// Skills are hold-to-cast. The `cooldown` field here is an internal rate
// limit so spamming a key can't spawn 60 effects per second — not a gameplay
// cooldown for the user to wait out. Values are tiny on purpose.
const SKILLS = [
  {
    id: 'soundwave',
    name: 'Звуковая волна',
    icon: '〰',
    keyLabel: '1',
    cooldown: 0.12,                  // ~8 waves/sec while held
    cast(p) {
      const maxR = Math.hypot(Game.w, Game.h) / 2 + 20;
      Game.effects.push(new SoundWave(p.x, p.y, p.damage * 0.5, maxR));
      Game.shake = Math.min(Game.shake + 3, 10);
      return true;
    },
  },
  {
    id: 'chainlightning',
    name: 'Цепная молния',
    icon: '⚡',
    keyLabel: '2',
    cooldown: 0.18,                  // ~5 chains/sec while held
    cast(p) { return castChainLightning(p, p.damage * 1.5); },
  },
];

// ----- Runtime ----------------------------------------------------------

const Skills = {
  // Returns true if the cast actually fired (so we only start a cooldown on
  // a successful cast — pressing 2 with no enemies in sight is a free retry).
  tryCast(player, index) {
    if (!player || !player.alive) return false;
    const skill = SKILLS[index];
    if (!skill) return false;
    if (!player.skillCd) player.skillCd = {};
    if ((player.skillCd[skill.id] || 0) > 0) return false;
    const ok = skill.cast(player);
    if (ok !== false) player.skillCd[skill.id] = skill.cooldown;
    return ok !== false;
  },
  tick(player, dt) {
    if (!player || !player.skillCd) return;
    for (const id in player.skillCd) {
      player.skillCd[id] = Math.max(0, player.skillCd[id] - dt);
    }
  },
};
