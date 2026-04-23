// Entities: Player, Enemy, Bullet, XPOrb, Particle.
// Tank sprite sheet (tanks_painted.png): 2 columns (blue/red) × 4 rows (types).
// Column 0 (x=0..311) is blue, column 1 (x=311..622) is red. Rows 0..3 → types.
const SPRITE_COL = 311;
const SPRITE_ROW = 200;
const TANK_TYPE = { HEAVY: 0, ROCKET: 1, LIGHT: 2, TURRET: 3 };
const TANK_SCALE = 0.48;

// Per-type body center within the 311×200 cell (measured from tight bbox of
// opaque pixels). Rotation happens around this point so tanks spin around
// their visual mass, not the cell center.
const BODY_CENTER = {
  [TANK_TYPE.HEAVY]:  { x: 152, y: 138 },
  [TANK_TYPE.ROCKET]: { x: 150, y: 98  },
  [TANK_TYPE.LIGHT]:  { x: 150, y: 101 },
  [TANK_TYPE.TURRET]: { x: 152, y: 66  },
};

// Muzzle tip offset from BODY_CENTER in sprite pixels (sprite faces right,
// so local +x is forward). Y!=0 means barrel sits off the hull centerline
// (e.g. the rocket tank's launcher mounts below the body center).
const MUZZLE = {
  [TANK_TYPE.HEAVY]:  { x: 98,  y: 5  },
  [TANK_TYPE.ROCKET]: { x: 102, y: 32 },
  [TANK_TYPE.LIGHT]:  { x: 82,  y: 0  },
  [TANK_TYPE.TURRET]: { x: 86,  y: 0  },
};

// Convert a tank-local offset to world coords given the tank's angle.
function tankLocalToWorld(tx, ty, angle, lx, ly) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return {
    x: tx + (lx * c - ly * s) * TANK_SCALE,
    y: ty + (lx * s + ly * c) * TANK_SCALE,
  };
}

function muzzleWorld(tx, ty, angle, type) {
  const m = MUZZLE[type];
  return tankLocalToWorld(tx, ty, angle, m.x, m.y);
}

const sheet = new Image();
sheet.src = 'assets/tanks/tanks_painted.png';
let sheetReady = false;
sheet.addEventListener('load', () => { sheetReady = true; });

function drawTank(ctx, x, y, angle, type, color, scale = TANK_SCALE) {
  const srcX = color === 'red' ? SPRITE_COL : 0;
  const srcY = type * SPRITE_ROW;
  const w = SPRITE_COL, h = SPRITE_ROW;
  const b = BODY_CENTER[type];
  // Destination rect is placed so the body-center pixel lands at (0,0) after rotate.
  const dx = -b.x * scale, dy = -b.y * scale;
  const dw = w * scale, dh = h * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Drop shadow hugs the body (not the whole cell).
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(4, 6, 50 * scale * 1.6, 34 * scale * 1.6, 0, 0, TAU);
  ctx.fill();
  if (sheetReady) {
    // 1-px inset source rect — avoids pulling colour from the adjacent
    // tank cell when the sprite is downscaled.
    const INS = 1;
    ctx.drawImage(sheet, srcX + INS, srcY + INS, w - 2 * INS, h - 2 * INS, dx + INS * scale, dy + INS * scale, dw - 2 * INS * scale, dh - 2 * INS * scale);
  } else {
    ctx.fillStyle = color === 'red' ? '#c23b3b' : '#3b7ec2';
    ctx.fillRect(-40, -26, 80, 52);
  }
  ctx.restore();
}

class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.angVel = 0;
    this.r = 26;
    this.type = TANK_TYPE.HEAVY;
    this.color = 'blue';

    // Base stats → scaled by upgrades.
    this.maxHp = 100;
    this.hp = 100;
    this.regen = 0.5;
    this.speed = 260;           // px/sec cruise speed
    this.accel = 1400;          // px/s² drive power
    this.friction = 3.2;        // 1/s exponential damping
    this.turnSpeed = 9;         // rad/s peak body rotation
    this.damage = 12;
    this.fireRate = 2.5;
    this.bulletSpeed = 520;
    this.bulletRange = 700;
    this.pierce = 0;
    this.multishot = 1;
    this.spread = 0.06;
    this.recoil = 25;           // backward impulse per shot (px/s)

    this.shootCd = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = 10;
    this.score = 0;
    this.kills = 0;
    this.alive = true;
    this.flash = 0;
    this.boostHeat = 0;
    this.trackT = 0;            // track-mark emitter phase

    // Consumables & economy.
    this.mines = 2;
    this.turrets = 1;
    this.companions = 1;
    this.coins = 0;
    this.abilityCd = { mine: 0, turret: 0, companion: 0 };
  }

  xpForLevel(n) { return Math.floor(10 * Math.pow(1.35, n - 1)); }

  gainXp(amount) {
    this.xp += amount;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = this.xpForLevel(this.level);
      // Free consumables every level — keeps the ability loop flowing.
      this.mines      += 100;
      this.turrets    += 100;
      this.companions += 100;
      UI.queueLevelUp(this.level);
    }
  }

  takeDamage(dmg) {
    this.hp -= dmg;
    this.flash = 0.25;
    Game.shake = Math.min(Game.shake + 4, 16);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  update(dt, input) {
    if (!this.alive) return;

    // Body angle eases toward mouse aim (turret rotation isn't separate on these
    // sprites, so the hull turn-rate IS the aim-turn-rate — keep it snappy).
    const targetAngle = angleTo(Game.w / 2, Game.h / 2, input.mouseX, input.mouseY);
    const angDiff = angleDiff(this.angle, targetAngle);
    const maxTurn = this.turnSpeed * dt;
    this.angle += clamp(angDiff, -maxTurn, maxTurn);

    // Desired direction from WASD (world-aligned for io-style control).
    let dx = 0, dy = 0;
    const k = input.keys;
    if (k.has('up'))    dy -= 1;
    if (k.has('down'))  dy += 1;
    if (k.has('left'))  dx -= 1;
    if (k.has('right')) dx += 1;
    const mag = Math.hypot(dx, dy);
    if (mag > 0) { dx /= mag; dy /= mag; }

    // Boost toggle — increases max speed, overheats over time.
    const boosting = k.has('boost') && this.boostHeat < 1 && mag > 0;
    this.boostHeat = boosting
      ? Math.min(1, this.boostHeat + dt * 0.33)
      : Math.max(0, this.boostHeat - dt * 0.5);

    const maxSpeed = this.speed * (boosting ? 1.55 : 1);
    const accel = this.accel * (boosting ? 1.4 : 1);

    // Integrate velocity: push toward input dir, otherwise bleed off with friction.
    if (mag > 0) {
      this.vx += dx * accel * dt;
      this.vy += dy * accel * dt;
    }
    // Friction always runs; when pushing, it gives us a natural terminal velocity feel.
    const damp = Math.exp(-this.friction * dt);
    this.vx *= damp; this.vy *= damp;

    // Cap speed without killing diagonal blending (scale both components).
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > maxSpeed) {
      const s = maxSpeed / sp;
      this.vx *= s; this.vy *= s;
    }

    // Step with slide-along-wall behaviour; kill component velocity on impact.
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (!World.blocked(nx, this.y, this.r)) this.x = nx; else this.vx = 0;
    if (!World.blocked(this.x, ny, this.r)) this.y = ny; else this.vy = 0;

    // Track marks — leave faint streaks while moving.
    if (sp > 40) {
      this.trackT += dt * (sp / 200);
      if (this.trackT > 0.06) {
        this.trackT = 0;
        const perpL = tankLocalToWorld(this.x, this.y, this.angle, -20, -32);
        const perpR = tankLocalToWorld(this.x, this.y, this.angle, -20,  32);
        Game.tracks.push({ x: perpL.x, y: perpL.y, life: 4, maxLife: 4 });
        Game.tracks.push({ x: perpR.x, y: perpR.y, life: 4, maxLife: 4 });
      }
    }

    // Regen & flash timer.
    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
    if (this.flash > 0) this.flash -= dt;

    // Shoot.
    this.shootCd -= dt;
    if (input.shooting && this.shootCd <= 0) {
      this.shoot();
      this.shootCd = 1 / this.fireRate;
    }

    // Ability cooldowns + deploy on key press. Edge triggers are always
    // consumed so stale flags can't fire on a later inventory refill.
    this.abilityCd.mine      = Math.max(0, this.abilityCd.mine      - dt);
    this.abilityCd.turret    = Math.max(0, this.abilityCd.turret    - dt);
    this.abilityCd.companion = Math.max(0, this.abilityCd.companion - dt);
    // Hold-Q spams mines behind the tank at ~12/sec. Each drop gets a
    // randomised arc offset so a burst scatters into a minefield instead
    // of stacking on one tile.
    const wantMine = input.abilityMine || input.keys.has('mine');
    if (wantMine) {
      input.abilityMine = false;
      if (this.mines > 0 && this.abilityCd.mine === 0) {
        this.mines--;
        const spawnAngle = this.angle + Math.PI + rand(-0.8, 0.8);
        const spawnR    = rand(32, 60);
        const dropX = this.x + Math.cos(spawnAngle) * spawnR;
        const dropY = this.y + Math.sin(spawnAngle) * spawnR;
        Game.mines.push(new Mine(dropX, dropY));
        this.abilityCd.mine = 0.08;
      }
    }
    // Hold-E spams turrets at ~10/sec. Blocked spots don't consume inventory
    // but keep a short retry cooldown so mashing against a wall doesn't lock
    // placement while the player re-aims.
    const wantTurret = input.abilityTurret || input.keys.has('turret');
    if (wantTurret) {
      input.abilityTurret = false;
      if (this.turrets > 0 && this.abilityCd.turret === 0) {
        const spawnAngle = this.angle + Math.PI + rand(-0.9, 0.9);
        const spawnR    = rand(52, 80);
        const dropX = this.x + Math.cos(spawnAngle) * spawnR;
        const dropY = this.y + Math.sin(spawnAngle) * spawnR;
        if (!World.blocked(dropX, dropY, 20)) {
          this.turrets--;
          Game.turrets.push(new TurretBot(dropX, dropY));
          this.abilityCd.turret = 0.10;
        } else {
          this.abilityCd.turret = 0.04;
        }
      }
    }
    // Hold-G auto-spawns a stream of bots so you don't have to mash the key.
    // Edge-trigger is also accepted (first press fires instantly); the held
    // path rate-limits via abilityCd.companion.
    const wantCompanion = input.abilityCompanion || input.keys.has('companion');
    if (wantCompanion) {
      input.abilityCompanion = false;
      if (this.companions > 0 && this.abilityCd.companion === 0) {
        // Randomise spawn angle behind/around the tank so a burst doesn't
        // stack at a single point.
        const spawnAngle = this.angle + Math.PI + rand(-0.6, 0.6);
        const spawnR    = rand(48, 76);
        const dropX = this.x + Math.cos(spawnAngle) * spawnR;
        const dropY = this.y + Math.sin(spawnAngle) * spawnR;
        this.companions--;
        Game.companions.push(new Companion(dropX, dropY));
        this.abilityCd.companion = 0.06;  // ~16 bots/sec when held
      }
    }
  }

  shoot() {
    const m = muzzleWorld(this.x, this.y, this.angle, this.type);
    const n = this.multishot;
    const spreadTotal = (n - 1) * this.spread;
    for (let i = 0; i < n; i++) {
      const a = this.angle - spreadTotal / 2 + i * this.spread;
      Game.bullets.push(new Bullet(m.x, m.y, a, this.bulletSpeed, this.damage, this.bulletRange, this.pierce, true));
    }
    // Muzzle flash + light recoil (applied as a short-lived impulse only; never
    // so strong that it cancels forward throttle).
    Game.particles.push(new Particle(m.x, m.y, 0.12, 'flash'));
    const push = this.recoil * 0.35;
    this.vx -= Math.cos(this.angle) * push;
    this.vy -= Math.sin(this.angle) * push;
    Game.shake = Math.min(Game.shake + 1.2, 7);
  }

  render(ctx) {
    drawTank(ctx, this.x, this.y, this.angle, this.type, this.color);
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(this.flash * 3, 0, 0.6);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 4, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // Boost heat ring
    if (this.boostHeat > 0) {
      ctx.save();
      ctx.strokeStyle = this.boostHeat > 0.9 ? '#ff6b3c' : '#fca62d';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * this.boostHeat);
      ctx.stroke();
      ctx.restore();
    }
  }
}

class Enemy {
  constructor(x, y, tier) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 26;
    this.tier = tier;
    this.type = tier >= 3 ? TANK_TYPE.ROCKET : tier >= 2 ? TANK_TYPE.TURRET : tier >= 1 ? TANK_TYPE.LIGHT : TANK_TYPE.HEAVY;
    this.color = 'red';
    this.angle = Math.random() * TAU;

    // Stats scale with tier (distance from origin).
    const t = tier;
    this.maxHp = Math.floor(30 + t * 22);
    this.hp = this.maxHp;
    this.damage = 8 + t * 4;
    this.fireRate = 0.6 + t * 0.12;
    this.bulletSpeed = 320 + t * 18;
    this.bulletRange = 520;
    this.speed = 110 + t * 14;
    this.accel = 900 + t * 80;
    this.friction = 3.5;
    this.turnSpeed = 3.2 + t * 0.2;
    this.sightRange = 720;
    this.shootRange = 560;
    this.xpReward = 4 + t * 3;
    this.scoreReward = 10 + t * 10;

    this.shootCd = rand(0.2, 1.2);
    this.alive = true;
    this.flash = 0;
    this.wanderTimer = 0;
    this.wanderDir = Math.random() * TAU;
    this.trackT = 0;
  }

  takeDamage(dmg, source) {
    this.hp -= dmg;
    this.flash = 0.15;
    Game.particles.push(new Particle(this.x, this.y, 0.3, 'hit'));
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      const coins = 1 + Math.floor(this.tier / 2) + (Math.random() < 0.35 ? 1 : 0);
      const autoCredit = source === 'turret' || source === 'companion';
      // 35% chance for a bot drop from any enemy kill. Auto-credited on
      // turret/companion kills so you never chase them across the field.
      const botRoll = Math.random() < 0.35;
      if (autoCredit) {
        Game.player.gainXp(this.xpReward);
        Game.player.coins += coins;
        Game.player.score += this.scoreReward;
        Game.player.kills++;
        if (botRoll) Game.player.companions += 1;
        Game.particles.push(new Particle(this.x, this.y, 0.35, 'xp'));
      } else {
        // Normal kill path: drop orbs + coin items so they magnet to player.
        const orbs = 3 + Math.floor(this.xpReward / 8);
        for (let i = 0; i < orbs; i++) {
          const a = Math.random() * TAU, d = rand(4, 20);
          Game.orbs.push(new XPOrb(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, Math.ceil(this.xpReward / orbs)));
        }
        for (let i = 0; i < coins; i++) {
          const a = Math.random() * TAU, d = rand(8, 22);
          Game.items.push(new Item(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, 'coin'));
        }
        if (botRoll) {
          const a = Math.random() * TAU, d = rand(12, 24);
          Game.items.push(new Item(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d, 'bot'));
        }
        if (source === 'player') {
          Game.player.score += this.scoreReward;
          Game.player.kills++;
        }
      }
      for (let i = 0; i < 14; i++) Game.particles.push(new Particle(this.x, this.y, rand(0.4, 0.8), 'explode'));
    }
  }

  update(dt) {
    if (!this.alive) return;
    // Pick the closest threat: player or any deployed turret. Turrets act as
    // distraction — if one's nearer than the player, they draw fire.
    let tx = Game.player.x, ty = Game.player.y, targetAlive = Game.player.alive;
    let td = dist(this.x, this.y, tx, ty);
    for (const tur of Game.turrets) {
      if (!tur.alive) continue;
      const d2 = dist(this.x, this.y, tur.x, tur.y);
      if (d2 < td) { td = d2; tx = tur.x; ty = tur.y; targetAlive = true; }
    }
    const d = td;

    if (this.flash > 0) this.flash -= dt;

    // Pick drive direction (relative to world) and aim angle.
    let driveX = 0, driveY = 0, aimAngle = this.angle, throttle = 1;
    if (d < this.sightRange && targetAlive) {
      aimAngle = angleTo(this.x, this.y, tx, ty);
      const wantDist = this.shootRange * 0.72;
      const dir = d > wantDist ? 1 : d < wantDist * 0.55 ? -1 : 0;
      if (dir !== 0) { driveX = Math.cos(aimAngle) * dir; driveY = Math.sin(aimAngle) * dir; }

      this.shootCd -= dt;
      const aimOk = Math.abs(angleDiff(this.angle, aimAngle)) < 0.4;
      if (this.shootCd <= 0 && d < this.shootRange && aimOk) {
        const a = this.angle + rand(-0.05, 0.05);
        const mPos = muzzleWorld(this.x, this.y, a, this.type);
        Game.bullets.push(new Bullet(mPos.x, mPos.y, a, this.bulletSpeed, this.damage, this.bulletRange, 0, false));
        Game.particles.push(new Particle(mPos.x, mPos.y, 0.08, 'flash'));
        this.shootCd = 1 / this.fireRate;
      }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderDir = Math.random() * TAU;
        this.wanderTimer = rand(1.5, 4);
      }
      aimAngle = this.wanderDir;
      driveX = Math.cos(this.wanderDir); driveY = Math.sin(this.wanderDir);
      throttle = 0.45;
    }

    // Rotate body smoothly toward aim direction.
    const angDiff = angleDiff(this.angle, aimAngle);
    this.angle += clamp(angDiff, -this.turnSpeed * dt, this.turnSpeed * dt);

    // Accelerate + friction (same model as player).
    this.vx += driveX * this.accel * throttle * dt;
    this.vy += driveY * this.accel * throttle * dt;
    const damp = Math.exp(-this.friction * dt);
    this.vx *= damp; this.vy *= damp;
    const maxSp = this.speed * throttle;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > maxSp) { const s = maxSp / sp; this.vx *= s; this.vy *= s; }

    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (!World.blocked(nx, this.y, this.r)) this.x = nx;
    else { this.vx = 0; this.wanderDir += Math.PI; }
    if (!World.blocked(this.x, ny, this.r)) this.y = ny;
    else this.vy = 0;

    // Track marks.
    if (sp > 30) {
      this.trackT += dt * (sp / 200);
      if (this.trackT > 0.08) {
        this.trackT = 0;
        const pl = tankLocalToWorld(this.x, this.y, this.angle, -20, -32);
        const pr = tankLocalToWorld(this.x, this.y, this.angle, -20,  32);
        Game.tracks.push({ x: pl.x, y: pl.y, life: 3.5, maxLife: 3.5 });
        Game.tracks.push({ x: pr.x, y: pr.y, life: 3.5, maxLife: 3.5 });
      }
    }
  }

  render(ctx) {
    drawTank(ctx, this.x, this.y, this.angle, this.type, this.color);
    // HP bar.
    if (this.hp < this.maxHp) {
      const w = 44, h = 5;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(this.x - w / 2, this.y - this.r - 14, w, h);
      ctx.fillStyle = '#f85149';
      ctx.fillRect(this.x - w / 2, this.y - this.r - 14, w * (this.hp / this.maxHp), h);
    }
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r + 3, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

class Bullet {
  constructor(x, y, angle, speed, damage, range, pierce, fromPlayer, source) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.damage = damage;
    this.traveled = 0;
    this.range = range;
    this.pierce = pierce;
    this.fromPlayer = fromPlayer;
    // Source tag for kill attribution: 'player', 'turret', 'enemy'.
    this.source = source || (fromPlayer ? 'player' : 'enemy');
    this.alive = true;
    this.r = 5;
    this.trail = [];
  }
  update(dt) {
    const step = Math.hypot(this.vx, this.vy) * dt;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 5) this.trail.shift();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.traveled += step;
    if (this.traveled > this.range) { this.alive = false; return; }

    // Destructible obstacle collision.
    const near = World.getObstaclesNear(this.x, this.y, 60);
    for (const o of near) {
      if (o.dead) continue;
      if (circleHit(this.x, this.y, this.r, o.x, o.y, o.r)) {
        o.hit(this.damage, this.source);
        this.alive = false;
        Game.particles.push(new Particle(this.x, this.y, 0.15, 'spark'));
        return;
      }
    }

    // Actor collision.
    if (this.fromPlayer) {
      for (const e of Game.enemies) {
        if (!e.alive) continue;
        if (circleHit(this.x, this.y, this.r, e.x, e.y, e.r)) {
          e.takeDamage(this.damage, this.source);
          if (this.pierce-- <= 0) this.alive = false;
          Game.particles.push(new Particle(this.x, this.y, 0.15, 'spark'));
          return;
        }
      }
    } else {
      const p = Game.player;
      if (p.alive && circleHit(this.x, this.y, this.r, p.x, p.y, p.r)) {
        p.takeDamage(this.damage);
        this.alive = false;
        Game.particles.push(new Particle(this.x, this.y, 0.15, 'spark'));
        return;
      }
      // Enemy bullets also damage friendly turrets and companions.
      for (const t of Game.turrets) {
        if (!t.alive) continue;
        if (circleHit(this.x, this.y, this.r, t.x, t.y, t.r)) {
          t.takeDamage(this.damage);
          this.alive = false;
          Game.particles.push(new Particle(this.x, this.y, 0.15, 'spark'));
          return;
        }
      }
      for (const c of Game.companions) {
        if (!c.alive) continue;
        if (circleHit(this.x, this.y, this.r, c.x, c.y, c.r)) {
          c.takeDamage(this.damage);
          this.alive = false;
          Game.particles.push(new Particle(this.x, this.y, 0.15, 'spark'));
          return;
        }
      }
    }
  }
  render(ctx) {
    // Trail
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const a = (i / this.trail.length) * 0.5;
      ctx.fillStyle = this.fromPlayer ? `rgba(140,220,255,${a})` : `rgba(255,160,80,${a})`;
      ctx.beginPath(); ctx.arc(t.x, t.y, this.r * (0.4 + i / this.trail.length * 0.8), 0, TAU); ctx.fill();
    }
    ctx.fillStyle = this.fromPlayer ? '#8fd9ff' : '#ffb067';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.r * 0.5, 0, TAU); ctx.fill();
  }
}

class XPOrb {
  constructor(x, y, value) {
    this.x = x; this.y = y; this.value = value;
    this.vx = rand(-40, 40); this.vy = rand(-40, 40);
    this.t = 0; this.alive = true;
  }
  update(dt) {
    this.t += dt;
    this.vx *= Math.pow(0.08, dt);
    this.vy *= Math.pow(0.08, dt);

    // Companions act as proxy pickup points — anything they touch is
    // credited to the player. Magnet+pickup seek the nearest alive picker.
    const p = Game.player;
    if (!p) return;
    const magnetR = 150 + p.level * 2;
    const magnetR2 = magnetR * magnetR;
    let bestX = 0, bestY = 0, bestHitR = 0, bestD2 = magnetR2, found = false;
    if (p.alive) {
      const d2 = dist2(this.x, this.y, p.x, p.y);
      if (d2 < bestD2) { bestD2 = d2; bestX = p.x; bestY = p.y; bestHitR = p.r + 4; found = true; }
    }
    for (const c of Game.companions) {
      if (!c.alive) continue;
      const d2 = dist2(this.x, this.y, c.x, c.y);
      if (d2 < bestD2) { bestD2 = d2; bestX = c.x; bestY = c.y; bestHitR = c.r + 4; found = true; }
    }

    if (found) {
      const d = Math.sqrt(bestD2);
      if (d < bestHitR) {
        p.gainXp(this.value);
        this.alive = false;
        Game.particles.push(new Particle(this.x, this.y, 0.25, 'xp'));
        return;
      }
      const pull = (1 - d / magnetR) * 520 * dt;
      const a = angleTo(this.x, this.y, bestX, bestY);
      this.vx += Math.cos(a) * pull;
      this.vy += Math.sin(a) * pull;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
  render(ctx) {
    const pulse = 4 + Math.sin(this.t * 7) * 1.2;
    ctx.save();
    ctx.shadowColor = '#b5ff5a';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#b5ff5a';
    ctx.beginPath(); ctx.arc(this.x, this.y, pulse, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.x, this.y, pulse * 0.4, 0, TAU); ctx.fill();
  }
}

class Particle {
  constructor(x, y, life, kind, colorOverride) {
    this.x = x; this.y = y;
    this.life = life; this.maxLife = life;
    this.kind = kind;
    if (kind === 'explode') {
      const a = Math.random() * TAU, s = rand(60, 280);
      this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
      this.r = rand(3, 7); this.color = pick(['#ff8c3c', '#ffc455', '#ff5a30', '#fff7c8']);
    } else if (kind === 'spark') {
      const a = Math.random() * TAU, s = rand(80, 220);
      this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
      this.r = 2.2; this.color = '#ffe89a';
    } else if (kind === 'hit') {
      this.vx = rand(-40, 40); this.vy = rand(-40, 40);
      this.r = 3; this.color = '#f85149';
    } else if (kind === 'xp') {
      this.vx = 0; this.vy = 0; this.r = 6; this.color = '#b5ff5a';
    } else if (kind === 'flash') {
      this.vx = 0; this.vy = 0; this.r = 10; this.color = '#fff7c8';
    } else if (kind === 'debris') {
      const a = Math.random() * TAU, s = rand(40, 160);
      this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
      this.r = rand(2, 4); this.color = colorOverride || '#8a6a3a';
    }
    if (colorOverride && kind !== 'debris') this.color = colorOverride;
    this.alive = true;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vx *= Math.pow(0.04, dt);
    this.vy *= Math.pow(0.04, dt);
  }
  render(ctx) {
    const t = this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = this.color;
    const r = this.kind === 'flash' ? this.r * (1 + (1 - t) * 1.5) : this.r * (0.6 + t * 0.8);
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }
}
