// Destructible world obstacles. Every prop has HP, awards XP on destruction, and
// optionally drops pickup items. Drawn live (not baked into chunk canvases).

const OBSTACLE_DEFS = {
  tree_conifer: {
    sprite: 'tree_conifer', r: 22, hp: 28,  xp: 3,
    displayW: 70, displayH: 88, anchorY: 0.78,
    particleColor: ['#3c6a2c', '#2f5823', '#6a4a24'],
  },
  tree_oak: {
    sprite: 'tree_oak', r: 26, hp: 38, xp: 5,
    displayW: 80, displayH: 96, anchorY: 0.78,
    particleColor: ['#3c6a2c', '#2f5823', '#6a4a24'],
  },
  bush_green: {
    sprite: 'bush_green', r: 14, hp: 10, xp: 2,
    displayW: 50, displayH: 50, anchorY: 0.6,
    particleColor: ['#4ea04a', '#378f38'],
    loot: [{ type: 'coin', chance: 0.08 }],
  },
  bush_orange: {
    sprite: 'bush_orange', r: 14, hp: 10, xp: 2,
    displayW: 50, displayH: 50, anchorY: 0.6,
    particleColor: ['#d07a2c', '#a85820'],
  },
  rockpile: {
    sprite: 'rockpile', r: 26, hp: 55, xp: 7,
    displayW: 78, displayH: 78, anchorY: 0.65,
    particleColor: ['#9599a1', '#707278', '#54555b'],
    loot: [{ type: 'coin', chance: 0.10 }],
  },
  crate_wood: {
    sprite: 'crate_wood', r: 20, hp: 18, xp: 5,
    displayW: 56, displayH: 56, anchorY: 0.55,
    particleColor: ['#b4843a', '#7f5a22'],
    loot: [
      { type: 'mine',   chance: 0.35 },
      { type: 'turret', chance: 0.22 },
      { type: 'coin',   chance: 0.18 },
    ],
  },
  barrel_wood: {
    sprite: 'barrel_wood', r: 18, hp: 14, xp: 4,
    displayW: 52, displayH: 58, anchorY: 0.6,
    particleColor: ['#b4843a', '#7f5a22'],
    loot: [
      { type: 'mine',   chance: 0.45 },
      { type: 'coin',   chance: 0.12 },
    ],
  },
  barrel_metal: {
    sprite: 'barrel_metal', r: 18, hp: 22, xp: 5,
    displayW: 52, displayH: 58, anchorY: 0.6,
    particleColor: ['#b0b3ba', '#7a7c84'],
    loot: [
      { type: 'turret', chance: 0.35 },
      { type: 'mine',   chance: 0.25 },
      { type: 'coin',   chance: 0.10 },
    ],
  },
  chest: {
    sprite: 'crate_wood', r: 24, hp: 60, xp: 30,
    displayW: 80, displayH: 80, anchorY: 0.55,
    particleColor: ['#b4843a', '#ffd670', '#7f5a22'],
    // Chests always drop a strong bundle of loot.
    loot: [
      { type: 'mine',   chance: 1.0, count: 3 },
      { type: 'turret', chance: 1.0, count: 2 },
      { type: 'coin',   chance: 1.0, count: 2 },
      { type: 'coin',   chance: 0.6 },
    ],
    glow: '#ffd670',
  },
};

class Obstacle {
  constructor(x, y, type) {
    const def = OBSTACLE_DEFS[type];
    this.x = x; this.y = y;
    this.type = type;
    this.r = def.r;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.dead = false;
    this.flash = 0;
    // tiny vertical offset per instance so repeated props don't perfectly align
    this.yJit = (hash2D(Math.floor(x), Math.floor(y), World.seed + 5) - 0.5) * 4;
  }

  hit(dmg, source) {
    if (this.dead) return;
    this.hp -= dmg;
    this.flash = 0.12;
    const def = OBSTACLE_DEFS[this.type];
    for (let i = 0; i < 3; i++) {
      const c = pick(def.particleColor);
      Game.particles.push(new Particle(this.x, this.y, rand(0.15, 0.35), 'debris', c));
    }
    if (this.hp <= 0) this.destroy(source);
  }

  destroy(source) {
    this.dead = true;
    if (typeof Save !== 'undefined' && this.chunkKey !== undefined) {
      Save.recordDestroyed(this.chunkKey, this.chunkIndex);
    }
    const def = OBSTACLE_DEFS[this.type];
    const autoCredit = source === 'turret' || source === 'companion';

    // XP reward: orbs for the player, direct credit for turret/companion kills.
    if (autoCredit) {
      Game.player.gainXp(def.xp);
      Game.particles.push(new Particle(this.x, this.y, 0.35, 'xp'));
    } else {
      const orbs = Math.max(1, Math.floor(def.xp / 2));
      for (let i = 0; i < orbs; i++) {
        const a = Math.random() * TAU, d = rand(4, 18);
        Game.orbs.push(new XPOrb(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, Math.max(1, Math.ceil(def.xp / orbs))));
      }
    }

    // Explosion particles.
    const n = this.type === 'chest' ? 24 : 10;
    for (let i = 0; i < n; i++) {
      const c = pick(def.particleColor);
      Game.particles.push(new Particle(this.x, this.y, rand(0.35, 0.8), 'debris', c));
    }
    if (this.type === 'chest') {
      Game.particles.push(new Particle(this.x, this.y, 0.4, 'flash'));
      Game.shake = Math.min(Game.shake + 6, 18);
    }

    // Loot: auto-credit for turret/companion kills, scatter as Items otherwise.
    if (def.loot) {
      for (const d of def.loot) {
        if (Math.random() >= d.chance) continue;
        const count = d.count || 1;
        if (autoCredit) {
          if      (d.type === 'mine')   Game.player.mines      += count;
          else if (d.type === 'turret') Game.player.turrets    += count;
          else if (d.type === 'bot')    Game.player.companions += count;
          else if (d.type === 'coin')   Game.player.coins      += count;
        } else {
          for (let i = 0; i < count; i++) {
            const a = Math.random() * TAU, r = rand(10, 30);
            Game.items.push(new Item(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, d.type));
          }
        }
      }
    }
  }

  update(dt) {
    if (this.flash > 0) this.flash -= dt;
  }

  render(ctx) {
    if (this.dead) return;
    const def = OBSTACLE_DEFS[this.type];
    const a = ATLAS[def.sprite];
    const w = def.displayW, h = def.displayH;
    const dx = this.x - w / 2;
    const dy = this.y - h * def.anchorY + this.yJit;
    // Soft ground shadow.
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 3, this.r * 1.0, this.r * 0.45, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (def.glow) {
      ctx.save();
      ctx.shadowColor = def.glow;
      ctx.shadowBlur = 18 + Math.sin(performance.now() * 0.005) * 6;
      if (atlasReady) ctx.drawImage(atlas, a.sx, a.sy, SHEET_TILE, SHEET_TILE, dx, dy, w, h);
      ctx.restore();
    } else if (atlasReady) {
      ctx.drawImage(atlas, a.sx, a.sy, SHEET_TILE, SHEET_TILE, dx, dy, w, h);
    } else {
      ctx.fillStyle = '#555';
      ctx.fillRect(dx, dy, w, h);
    }

    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = clamp(this.flash * 4, 0, 0.7);
      ctx.fillStyle = '#fff';
      ctx.fillRect(dx, dy, w, h);
      ctx.restore();
    }

    // HP bar once damaged.
    if (this.hp < this.maxHp) {
      const bw = Math.min(w, 54), bh = 4;
      const bx = this.x - bw / 2, by = dy - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.type === 'chest' ? '#ffd670' : '#9be34b';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }
  }
}
