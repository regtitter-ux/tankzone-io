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
    this.sight = 560;
    this.speed = 320;
    this.shootCd = rand(0, 0.6);
    this.alive = true;

    // Personal formation slot around the player. Each bot gets a unique angle
    // and distance so a squad surrounds the player instead of piling on one
    // spot. The slot rotates slowly for a living crowd feel.
    this.followAngle = Math.random() * TAU;
    this.followR     = rand(55, 130);
    this.followDrift = rand(-0.8, 0.8);  // rad/sec

    // Orbit parameters used when engaging an enemy: each bot takes a
    // different angle and radius around the target, so they form a
    // rotating cordon rather than clumping onto a single firing line.
    this.fightAngle  = Math.random() * TAU;
    this.fightR      = rand(140, 230);
    this.fightDrift  = (Math.random() < 0.5 ? -1 : 1) * rand(0.8, 1.8);

    // Target-reroll timer so the bot occasionally picks a new enemy and a
    // new orbit angle — keeps motion unpredictable.
    this.reroll = rand(0.5, 1.8);
    this.targetId = -1;
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

    this.followAngle += this.followDrift * dt;
    this.fightAngle  += this.fightDrift  * dt;
    this.reroll      -= dt;

    // Pick a target enemy: either our current one if still alive/nearby, or
    // a new one when the reroll timer ticks down. Rerolls keep the squad
    // spread across several enemies rather than dogpiling one.
    let target = null;
    if (this.targetId >= 0) {
      const current = Game.enemies[this.targetId];
      if (current && current.alive && dist2(this.x, this.y, current.x, current.y) < this.sight * this.sight) {
        target = current;
      }
    }
    if (!target || this.reroll <= 0) {
      // Sample a few random enemies instead of always picking nearest —
      // prevents every bot ganging up on the same target.
      let best = null, bestScore = Infinity;
      const inSight = [];
      for (let i = 0; i < Game.enemies.length; i++) {
        const e = Game.enemies[i];
        if (!e.alive) continue;
        const d2 = dist2(this.x, this.y, e.x, e.y);
        if (d2 < this.sight * this.sight) inSight.push({ e, i, d2 });
      }
      if (inSight.length) {
        // Weighted pick: closer is more likely, but not deterministic.
        const pickIdx = Math.floor(Math.random() * Math.min(inSight.length, 4));
        inSight.sort((a, b) => a.d2 - b.d2);
        const chosen = inSight[pickIdx] || inSight[0];
        target = chosen.e; this.targetId = chosen.i;
        this.fightAngle = Math.random() * TAU;
      } else {
        this.targetId = -1;
      }
      this.reroll = rand(1.2, 2.8);
    }

    // Compute the desired position.
    let destX, destY;
    if (target) {
      // Orbit the enemy at our personal fight-radius / angle.
      destX = target.x + Math.cos(this.fightAngle) * this.fightR;
      destY = target.y + Math.sin(this.fightAngle) * this.fightR;
    } else {
      // Crowd formation around the player at our personal slot.
      destX = p.x + Math.cos(this.followAngle) * this.followR;
      destY = p.y + Math.sin(this.followAngle) * this.followR;
    }

    // Separation: push away from other companions that are too close.
    let sepX = 0, sepY = 0;
    for (const c of Game.companions) {
      if (c === this || !c.alive) continue;
      const dx = this.x - c.x, dy = this.y - c.y;
      const d2 = dx * dx + dy * dy;
      const sepR = 36;
      if (d2 > 0 && d2 < sepR * sepR) {
        const d = Math.sqrt(d2);
        const push = (1 - d / sepR);
        sepX += (dx / d) * push;
        sepY += (dy / d) * push;
      }
    }

    const toX = destX - this.x, toY = destY - this.y;
    const dLen = Math.hypot(toX, toY);
    // Desired velocity: head toward slot; clamp to max speed; add separation.
    const desSpeed = this.speed * clamp(dLen / 90, 0, 1);
    const ux = dLen > 0.1 ? toX / dLen : 0;
    const uy = dLen > 0.1 ? toY / dLen : 0;
    const desVX = ux * desSpeed + sepX * this.speed * 0.9;
    const desVY = uy * desSpeed + sepY * this.speed * 0.9;

    // Smooth accel toward desired velocity.
    const k = Math.min(1, dt * 7);
    this.vx += (desVX - this.vx) * k;
    this.vy += (desVY - this.vy) * k;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > this.speed) { const s = this.speed / sp; this.vx *= s; this.vy *= s; }

    // Aim + shoot logic is independent of movement so we can strafe-shoot.
    const aimTarget = target
      ? { x: target.x, y: target.y }
      : null;
    if (aimTarget) {
      const aim = angleTo(this.x, this.y, aimTarget.x, aimTarget.y);
      const diff = angleDiff(this.angle, aim);
      this.angle += clamp(diff, -6 * dt, 6 * dt);
      this.shootCd -= dt;
      if (Math.abs(diff) < 0.3 && this.shootCd <= 0) {
        const a = this.angle;
        const mx = this.x + Math.cos(a) * 18;
        const my = this.y + Math.sin(a) * 18;
        Game.bullets.push(new Bullet(mx, my, a, this.bulletSpeed, this.damage, this.bulletRange, 0, true, 'companion'));
        Game.particles.push(new Particle(mx, my, 0.07, 'flash'));
        this.shootCd = 1 / this.fireRate;
      }
    } else {
      // Face our travel direction when idling in formation.
      if (Math.hypot(this.vx, this.vy) > 20) {
        const moveAng = Math.atan2(this.vy, this.vx);
        const diff = angleDiff(this.angle, moveAng);
        this.angle += clamp(diff, -4 * dt, 4 * dt);
      }
    }

    // Movement with slide-along-wall behaviour.
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
