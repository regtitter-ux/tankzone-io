// Pickup items dropped from crates/barrels/chests, plus the deployable Mine and
// TurretBot entities they grant. Items magnet toward the player.

const ITEM_DEFS = {
  mine:   { color: '#f85149', stroke: '#9a1d16', label: 'M', radius: 8,  life: 30 },
  turret: { color: '#58a6ff', stroke: '#1a4c82', label: 'T', radius: 9,  life: 30 },
  bot:    { color: '#7de2a0', stroke: '#1c7a42', label: 'G', radius: 9,  life: 30 },
  coin:   { color: '#ffd670', stroke: '#a07a1e', label: '$', radius: 7,  life: 22 },
};

class Item {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.vx = rand(-80, 80); this.vy = rand(-80, 80);
    this.type = type;
    const d = ITEM_DEFS[type];
    this.r = d.radius;
    this.life = d.life;      // seconds until it auto-collects / despawns
    this.maxLife = d.life;
    this.alive = true;
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.vx *= Math.pow(0.08, dt);
    this.vy *= Math.pow(0.08, dt);
    const p = Game.player;
    if (!p || !p.alive) return;
    const d = dist(this.x, this.y, p.x, p.y);
    const mag = 170 + p.level * 2;
    if (d < mag) {
      const pull = (1 - d / mag) * 620 * dt;
      const a = angleTo(this.x, this.y, p.x, p.y);
      this.vx += Math.cos(a) * pull;
      this.vy += Math.sin(a) * pull;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (d < p.r + 6) {
      this.collect();
      this.alive = false;
    }
  }
  collect() {
    const p = Game.player;
    if (this.type === 'mine')        p.mines      += 1;
    else if (this.type === 'turret') p.turrets    += 1;
    else if (this.type === 'bot')    p.companions += 1;
    else if (this.type === 'coin')   p.coins      += 1;
    Game.particles.push(new Particle(this.x, this.y, 0.3, 'xp'));
  }
  render(ctx) {
    const d = ITEM_DEFS[this.type];
    const bob = Math.sin(this.t * 5) * 2;
    // Blink when about to expire.
    const blink = this.life < 4 ? (Math.sin(this.t * 20) > 0 ? 1 : 0.35) : 1;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(this.x, this.y + bob, this.r + 2, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = d.stroke;
    ctx.beginPath(); ctx.arc(this.x, this.y + bob, this.r + 2, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.label, this.x, this.y + bob + 0.5);
  }
}

// Mine: armed after a short delay, explodes on enemy contact or expiry.
class Mine {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 10;
    this.armTime = 0.6;
    this.life = 30;           // auto-detonate timer
    this.damage = 80;
    this.radius = 110;
    this.alive = true;
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    this.armTime -= dt;
    this.life -= dt;
    if (this.life <= 0) { this.explode(); return; }
    if (this.armTime > 0) return;
    // Look for enemies in trigger range.
    for (const e of Game.enemies) {
      if (!e.alive) continue;
      if (dist2(this.x, this.y, e.x, e.y) < (e.r + this.r + 6) * (e.r + this.r + 6)) {
        this.explode();
        return;
      }
    }
  }
  explode() {
    if (!this.alive) return;
    this.alive = false;
    // Area damage to enemies and obstacles.
    const r2 = this.radius * this.radius;
    for (const e of Game.enemies) {
      if (!e.alive) continue;
      const d2 = dist2(this.x, this.y, e.x, e.y);
      if (d2 < r2) {
        const fall = 1 - Math.sqrt(d2) / this.radius;
        e.takeDamage(this.damage * (0.5 + fall * 0.5), 'player');
      }
    }
    const obs = World.getObstaclesNear(this.x, this.y, this.radius + 24);
    for (const o of obs) {
      if (o.dead) continue;
      const d2 = dist2(this.x, this.y, o.x, o.y);
      if (d2 < r2) o.hit(this.damage);
    }
    // Damage player if standing on it.
    const p = Game.player;
    if (p && p.alive) {
      const d2 = dist2(this.x, this.y, p.x, p.y);
      if (d2 < r2) p.takeDamage(this.damage * 0.45);
    }
    // Big effect.
    for (let i = 0; i < 28; i++) Game.particles.push(new Particle(this.x, this.y, rand(0.45, 0.9), 'explode'));
    Game.particles.push(new Particle(this.x, this.y, 0.35, 'flash'));
    Game.shake = Math.min(Game.shake + 10, 22);
  }
  render(ctx) {
    // Beacon ring that blinks faster when armed.
    const pulse = (this.armTime > 0 ? 0.6 : 1) + Math.sin(this.t * (this.armTime > 0 ? 5 : 10)) * 0.35;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#2a0d0d';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 2, 0, TAU); ctx.fill();
    ctx.fillStyle = this.armTime > 0 ? '#f59a3a' : '#f85149';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.35 * pulse;
    ctx.fillStyle = '#ff4136';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 6 + pulse * 5, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

// TurretBot: stationary friendly turret with its own HP, targets nearest enemy.
class TurretBot {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 18;
    this.angle = 0;
    this.hp = 120;
    this.maxHp = 120;
    this.damage = 14;
    this.fireRate = 2.2;
    this.shootCd = 0.5;
    this.bulletSpeed = 540;
    this.bulletRange = 640;
    this.sight = 520;
    this.alive = true;
    this.t = 0;
  }
  takeDamage(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0 && this.alive) this.destroy();
  }
  destroy() {
    this.alive = false;
    for (let i = 0; i < 16; i++) Game.particles.push(new Particle(this.x, this.y, rand(0.4, 0.8), 'explode'));
  }
  update(dt) {
    this.t += dt;
    // Find nearest enemy in sight.
    let best = null, bestD = this.sight * this.sight;
    for (const e of Game.enemies) {
      if (!e.alive) continue;
      const d2 = dist2(this.x, this.y, e.x, e.y);
      if (d2 < bestD) { bestD = d2; best = e; }
    }
    if (best) {
      const target = angleTo(this.x, this.y, best.x, best.y);
      const diff = angleDiff(this.angle, target);
      this.angle += clamp(diff, -4 * dt, 4 * dt);
      this.shootCd -= dt;
      if (Math.abs(diff) < 0.2 && this.shootCd <= 0) {
        const a = this.angle;
        const mx = this.x + Math.cos(a) * 22;
        const my = this.y + Math.sin(a) * 22;
        Game.bullets.push(new Bullet(mx, my, a, this.bulletSpeed, this.damage, this.bulletRange, 0, true, 'turret'));
        Game.particles.push(new Particle(mx, my, 0.08, 'flash'));
        this.shootCd = 1 / this.fireRate;
      }
    } else {
      this.shootCd = Math.max(this.shootCd - dt, 0);
    }
  }
  render(ctx) {
    // Base
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(2, 3, this.r + 3, this.r * 0.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath(); ctx.arc(0, 0, this.r + 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.stroke();
    ctx.rotate(this.angle);
    // Barrel
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(-2, -4, 30, 8);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(28, -3, 4, 6);
    // Center dome
    ctx.fillStyle = '#8fd9ff';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    ctx.restore();

    // HP bar.
    const bw = 36, bh = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(this.x - bw / 2, this.y - this.r - 12, bw, bh);
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(this.x - bw / 2, this.y - this.r - 12, bw * (this.hp / this.maxHp), bh);
  }
}

// Friendly companion mini-tank. Follows the player at a small distance and
// shoots any enemy within its sight range (tuned to roughly screen radius).
// Persistent until destroyed — no life timer, cheap to spawn.
class Companion {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 14;
    this.angle = 0;
    this.type = TANK_TYPE.LIGHT;
    this.color = 'blue';
    this.hp = 60;
    this.maxHp = 60;
    this.damage = 9;
    this.fireRate = 2.5;
    this.bulletSpeed = 480;
    this.bulletRange = 560;
    this.sight = 560;               // ~ screen radius at 1280×800 / 2
    this.followDist = 80;           // ideal distance behind player
    this.speed = 320;
    this.shootCd = rand(0, 0.6);
    this.alive = true;
  }
  takeDamage(dmg) {
    this.hp -= dmg;
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      for (let i = 0; i < 10; i++) Game.particles.push(new Particle(this.x, this.y, rand(0.3, 0.7), 'explode'));
    }
  }
  update(dt) {
    const p = Game.player;
    if (!p) return;

    // Find nearest enemy within sight; aim at it, otherwise face player dir.
    let best = null, bestD = this.sight * this.sight;
    for (const e of Game.enemies) {
      if (!e.alive) continue;
      const d2 = dist2(this.x, this.y, e.x, e.y);
      if (d2 < bestD) { bestD = d2; best = e; }
    }
    if (best) {
      const aim = angleTo(this.x, this.y, best.x, best.y);
      const diff = angleDiff(this.angle, aim);
      this.angle += clamp(diff, -6 * dt, 6 * dt);
      this.shootCd -= dt;
      if (Math.abs(diff) < 0.25 && this.shootCd <= 0) {
        const a = this.angle;
        const mx = this.x + Math.cos(a) * 18;
        const my = this.y + Math.sin(a) * 18;
        Game.bullets.push(new Bullet(mx, my, a, this.bulletSpeed, this.damage, this.bulletRange, 0, true, 'companion'));
        Game.particles.push(new Particle(mx, my, 0.07, 'flash'));
        this.shootCd = 1 / this.fireRate;
      }
    } else {
      // Face the direction we're moving so the follow looks natural.
      const moveAng = angleTo(0, 0, this.vx, this.vy);
      if (Math.hypot(this.vx, this.vy) > 20) {
        const diff = angleDiff(this.angle, moveAng);
        this.angle += clamp(diff, -4 * dt, 4 * dt);
      }
    }

    // Follow behaviour — steer to a trailing spot behind the player.
    const followX = p.x - Math.cos(p.angle) * this.followDist;
    const followY = p.y - Math.sin(p.angle) * this.followDist;
    const toX = followX - this.x, toY = followY - this.y;
    const d = Math.hypot(toX, toY);
    const target = d > 2 ? this.speed * Math.min(1, d / 120) : 0;
    if (d > 0) {
      const ax = (toX / d) * target - this.vx;
      const ay = (toY / d) * target - this.vy;
      this.vx += ax * Math.min(1, dt * 6);
      this.vy += ay * Math.min(1, dt * 6);
    }
    // Don't overlap the player, don't walk into water/obstacles.
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    if (!World.blocked(nx, this.y, this.r)) this.x = nx; else this.vx *= -0.3;
    if (!World.blocked(this.x, ny, this.r)) this.y = ny; else this.vy *= -0.3;
  }
  render(ctx) {
    drawTank(ctx, this.x, this.y, this.angle, this.type, this.color, 0.28);
    // Subtle "ally" ring under the sprite so it reads as friendly.
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#8fd9ff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 3, 0, TAU); ctx.stroke();
    ctx.restore();
    if (this.hp < this.maxHp) {
      const w = 26, h = 3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(this.x - w / 2, this.y - this.r - 10, w, h);
      ctx.fillStyle = '#8fd9ff'; ctx.fillRect(this.x - w / 2, this.y - this.r - 10, w * (this.hp / this.maxHp), h);
    }
  }
}

// Peaceful "civilian" vehicles that wander. Drop XP and sometimes coins when
// destroyed, but never shoot back. Used by 'herd' POIs.
class NeutralTank {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 22;
    this.angle = Math.random() * TAU;
    this.type = TANK_TYPE.LIGHT;
    this.color = 'blue';
    this.speed = 70;
    this.maxHp = 40;
    this.hp = this.maxHp;
    this.xpReward = 12;
    this.scoreReward = 20;
    this.wanderDir = Math.random() * TAU;
    this.wanderTimer = rand(1, 3);
    this.alive = true;
    this.flash = 0;
    this.faction = 'neutral';
  }
  takeDamage(dmg, source) {
    this.hp -= dmg;
    this.flash = 0.15;
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      if (source === 'turret' || source === 'companion') {
        // Consistent with Enemy: auto-credit XP/coins to the player.
        Game.player.gainXp(this.xpReward);
        Game.player.coins += 1;
        Game.player.score += this.scoreReward;
        Game.player.kills++;
        Game.particles.push(new Particle(this.x, this.y, 0.35, 'xp'));
      } else {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * TAU, d = rand(4, 18);
          Game.orbs.push(new XPOrb(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, Math.ceil(this.xpReward / 6)));
        }
        if (Math.random() < 0.4) Game.items.push(new Item(this.x, this.y, 'coin'));
        if (source === 'player') {
          Game.player.score += this.scoreReward;
          Game.player.kills++;
        }
      }
      for (let i = 0; i < 14; i++) Game.particles.push(new Particle(this.x, this.y, rand(0.4, 0.8), 'explode'));

      // If this was the last member of its herd, mark the POI cleared so it
      // won't respawn on re-entry.
      if (this.chunkKey) {
        const poi = World.poisByChunk.get(this.chunkKey);
        if (poi && poi.type === 'herd' && !poi.cleared) {
          const siblings = Game.neutrals.some(n => n !== this && n.alive && n.chunkKey === this.chunkKey);
          if (!siblings) { poi.cleared = true; Save.markCleared(this.chunkKey); }
        }
      }
    }
  }
  update(dt) {
    if (!this.alive) return;
    if (this.flash > 0) this.flash -= dt;
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) { this.wanderDir = Math.random() * TAU; this.wanderTimer = rand(1.5, 4); }
    const diff = angleDiff(this.angle, this.wanderDir);
    this.angle += clamp(diff, -2 * dt, 2 * dt);
    const vx = Math.cos(this.wanderDir) * this.speed;
    const vy = Math.sin(this.wanderDir) * this.speed;
    const nx = this.x + vx * dt, ny = this.y + vy * dt;
    if (!World.blocked(nx, this.y, this.r)) this.x = nx; else this.wanderDir += Math.PI;
    if (!World.blocked(this.x, ny, this.r)) this.y = ny;
  }
  render(ctx) {
    drawTank(ctx, this.x, this.y, this.angle, this.type, this.color, 0.38);
    // Peace badge: small green dot above so the player knows not to mow them down.
    ctx.fillStyle = '#3fb950';
    ctx.beginPath(); ctx.arc(this.x, this.y - this.r - 8, 3, 0, TAU); ctx.fill();
    if (this.hp < this.maxHp) {
      const w = 36, h = 4;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(this.x - w / 2, this.y - this.r - 16, w, h);
      ctx.fillStyle = '#3fb950'; ctx.fillRect(this.x - w / 2, this.y - this.r - 16, w * (this.hp / this.maxHp), h);
    }
  }
}

// Friendly trader: stationary, opens upgrade shop when the player steps near.
class Trader {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = 24;
    this.angle = 0;
    this.type = TANK_TYPE.TURRET;
    this.color = 'blue';
    this.alive = true;
    this.faction = 'trader';
  }
  update(dt) {
    const p = Game.player;
    if (!p || !p.alive) return;
    const target = angleTo(this.x, this.y, p.x, p.y);
    const diff = angleDiff(this.angle, target);
    this.angle += clamp(diff, -1.5 * dt, 1.5 * dt);
    // Open shop when player is within 140px and presses F. UI.activeTrader
    // guards against accidental double-open.
    const close = dist2(this.x, this.y, p.x, p.y) < 140 * 140;
    if (close && Game.input.interact && !UI.activeTrader) {
      Game.input.interact = false;
      UI.openTrader(this);
    }
  }
  render(ctx) {
    // Aura
    ctx.save();
    const pulse = 0.4 + 0.2 * Math.sin(performance.now() * 0.004);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffd670';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 16, 0, TAU); ctx.fill();
    ctx.restore();
    drawTank(ctx, this.x, this.y, this.angle, this.type, this.color);
    // Floating $ badge.
    ctx.fillStyle = '#ffd670';
    ctx.font = 'bold 20px system-ui';
    ctx.textAlign = 'center';
    const bob = Math.sin(performance.now() * 0.004) * 3;
    ctx.fillText('$', this.x, this.y - this.r - 10 + bob);
    // Interact hint.
    const p = Game.player;
    if (p && dist2(this.x, this.y, p.x, p.y) < 140 * 140) {
      ctx.font = '12px system-ui';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('F — торговля', this.x, this.y - this.r - 28);
    }
  }
}
