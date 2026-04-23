// Main game loop, input, camera, spawning.
const Game = {
  canvas: null,
  ctx: null,
  w: 0, h: 0,
  dpr: 1,

  player: null,
  enemies: [],
  bullets: [],
  orbs: [],
  items: [],
  mines: [],
  turrets: [],
  companions: [],
  neutrals: [],
  traders: [],
  particles: [],
  effects: [],
  tracks: [],

  cam: { x: 0, y: 0 },
  shake: 0,

  paused: false,
  running: false,

  input: {
    keys: new Set(),
    mouseX: 0, mouseY: 0,
    shooting: false,
    abilityMine: false,
    abilityTurret: false,
    abilityCompanion: false,
    interact: false,
  },

  lastTime: 0,
  spawnTimer: 0,

  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.miniCtx = document.getElementById('minimap').getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    UI.init();
    requestAnimationFrame(t => this.loop(t));
  },

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },

  bindInput() {
    // Use e.code (physical key) so Cyrillic / AZERTY / etc. keyboards still
    // behave as WASD. e.key returns 'ц' for the 'W' key in Russian layout.
    const codeToAction = code => {
      if (code === 'KeyW' || code === 'ArrowUp')    return 'up';
      if (code === 'KeyS' || code === 'ArrowDown')  return 'down';
      if (code === 'KeyA' || code === 'ArrowLeft')  return 'left';
      if (code === 'KeyD' || code === 'ArrowRight') return 'right';
      if (code === 'ShiftLeft' || code === 'ShiftRight') return 'boost';
      if (code === 'Space') return 'shoot';
      if (code === 'KeyQ') return 'mine';
      if (code === 'KeyE') return 'turret';
      if (code === 'KeyG') return 'companion';
      if (code === 'KeyF') return 'interact';
      if (code === 'KeyB') return 'shop';
      // Digits 1..9 and 0 — skills. Two digits held together address skill
      // slots 10+ (ab where a and b are the digits, in press order).
      if (/^Digit[0-9]$/.test(code)) return 'digit' + code.slice(5);
      return null;
    };
    // Two-digit skill combo: if a digit is pressed while another is held, the
    // two-digit index takes priority. `heldDigits` is an ordered stack used
    // both on edge (first press) and every frame while held — see Game.update.
    this.heldDigits = [];
    window.addEventListener('keydown', e => {
      const a = codeToAction(e.code);
      if (!a) return;
      // Edge-trigger flags fire once per keydown; keys Set tracks held state.
      if (!this.input.keys.has(a)) {
        if (a === 'mine')      this.input.abilityMine = true;
        if (a === 'turret')    this.input.abilityTurret = true;
        if (a === 'companion') this.input.abilityCompanion = true;
        if (a === 'interact')  this.input.interact = true;
        if (a === 'shop')      UI.openShop();
        if (a.startsWith('digit')) {
          const d = a.slice(5);
          if (!this.heldDigits.includes(d)) this.heldDigits.push(d);
          this.castHeldSkill();
        }
      }
      this.input.keys.add(a);
      if (a === 'shoot') this.input.shooting = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      const a = codeToAction(e.code);
      if (!a) return;
      this.input.keys.delete(a);
      if (a === 'shoot') this.input.shooting = false;
      if (a === 'interact') this.input.interact = false;
      if (a.startsWith('digit')) {
        const d = a.slice(5);
        const i = this.heldDigits.indexOf(d);
        if (i >= 0) this.heldDigits.splice(i, 1);
      }
    });
    // Drop all held keys if window loses focus (avoids "stuck" inputs).
    window.addEventListener('blur', () => { this.input.keys.clear(); this.input.shooting = false; this.heldDigits.length = 0; });
    this.canvas.addEventListener('mousemove', e => {
      const r = this.canvas.getBoundingClientRect();
      this.input.mouseX = e.clientX - r.left;
      this.input.mouseY = e.clientY - r.top;
    });
    this.canvas.addEventListener('mousedown', e => { if (e.button === 0) this.input.shooting = true; });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.input.shooting = false; });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    // Touch fallback for mobile.
    this.canvas.addEventListener('touchstart', e => { e.preventDefault(); this.input.shooting = true; const t = e.touches[0]; this.input.mouseX = t.clientX; this.input.mouseY = t.clientY; }, { passive: false });
    this.canvas.addEventListener('touchmove', e => { const t = e.touches[0]; this.input.mouseX = t.clientX; this.input.mouseY = t.clientY; }, { passive: false });
    this.canvas.addEventListener('touchend', () => { this.input.shooting = false; });
  },

  start(opts = {}) {
    const snap = opts.fresh ? null : Save.read();

    // Clear runtime collections regardless of load/fresh path.
    this.enemies = [];
    this.bullets = [];
    this.orbs = [];
    this.items = [];
    this.mines = [];
    this.turrets = [];
    this.companions = [];
    this.neutrals = [];
    this.traders = [];
    this.particles = [];
    this.effects = [];
    this.tracks = [];

    if (snap) {
      // Resume: restore seed + player in the saved pose.
      World.reset(snap.seed | 0);
      Save.apply(snap);
    } else {
      // Fresh game: new seed, scan near origin for a walkable spawn.
      World.reset((Math.random() * 1e9) | 0);
      Save._destroyed = {}; Save._pois = {};
      let sx = 0, sy = 0;
      for (let ring = 0; ring < 40; ring++) {
        let found = false;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          const tx = Math.cos(a) * ring * TILE;
          const ty = Math.sin(a) * ring * TILE;
          if (!World.blocked(tx, ty, 28)) { sx = tx; sy = ty; found = true; break; }
        }
        if (found) break;
      }
      this.player = new Player(sx, sy);
    }

    this.cam.x = this.player.x; this.cam.y = this.player.y;
    this.shake = 0;
    this.spawnTimer = 0;
    this.paused = false;
    this.running = true;
    Save.lastAutosave = 0;
    document.getElementById('hud').classList.remove('hidden');
    this.ensureChunksAroundPlayer();
    // Immediate first write so a refresh within seconds still resumes.
    Save.write();
  },

  // Called every frame + on digit edge: tries to cast the current held-key
  // skill (single or two-digit combo). Rate-limited by skill.cooldown so it's
  // safe to call on every frame while a key is held.
  castHeldSkill() {
    if (!this.player || !this.heldDigits.length) return;
    if (this.heldDigits.length >= 2) {
      const idx = parseInt(this.heldDigits.slice(0, 2).join(''), 10) - 1;
      Skills.tryCast(this.player, idx);
    } else {
      Skills.tryCast(this.player, parseInt(this.heldDigits[0], 10) - 1);
    }
  },

  ensureChunksAroundPlayer() {
    const p = this.player;
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cy = Math.floor(p.y / CHUNK_SIZE);
    const R = 3;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++)
        World.buildChunk(cx + dx, cy + dy);
    this.spawnPOIs();
    World.evict(p.x, p.y, 5);
    this.cleanupEvictedPOIs();
  },

  // Ensure entities exist for every live POI within loaded chunks.
  spawnPOIs() {
    for (const [key, poi] of World.poisByChunk) {
      if (poi.type === 'trader') {
        const live = this.traders.some(t => t.chunkKey === key);
        if (!live) {
          const t = new Trader(poi.x, poi.y);
          t.chunkKey = key;
          this.traders.push(t);
        }
      } else if (poi.type === 'herd' && !poi.cleared) {
        const live = this.neutrals.some(n => n.chunkKey === key);
        if (!live) {
          const n = 4 + Math.floor(hash2D(poi.cx, poi.cy, World.seed + 3131) * 3);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU, r = 46 + hash2D(poi.cx, poi.cy + i, World.seed + 42) * 70;
            const x = poi.x + Math.cos(a) * r;
            const y = poi.y + Math.sin(a) * r;
            if (!World.blocked(x, y, 22)) {
              const nt = new NeutralTank(x, y);
              nt.chunkKey = key;
              this.neutrals.push(nt);
            }
          }
        }
      } else if (poi.type === 'military_base' && !poi.spawned && !poi.cleared) {
        poi.spawned = true;
        Save.markSpawned(key);
        // Base enemies scale with the player's current level + the POI's
        // designated tier bonus, so deeper-tier guards are meaningfully
        // stronger than patrols at the perimeter.
        const baseLvl = Math.max(
          Math.floor(Math.hypot(poi.cx, poi.cy) / 1.4),
          this.player ? Math.floor(this.player.level / 3) : 0
        );
        for (const spec of (poi.enemies || [])) {
          const tier = Math.min(6, baseLvl + (spec.tierBonus || 0));
          const e = new Enemy(spec.x, spec.y, tier);
          e.chunkKey = key;
          e.fromPOI = true;
          this.enemies.push(e);
        }
      }
    }
  },

  // Remove POI-bound entities when their chunk is evicted, so we don't keep a
  // distant trader alive forever. They'll re-spawn when the player returns.
  cleanupEvictedPOIs() {
    this.traders  = this.traders.filter(t => !t.chunkKey || World.chunks.has(t.chunkKey));
    this.neutrals = this.neutrals.filter(n => !n.chunkKey || World.chunks.has(n.chunkKey));
  },

  // Keys for chunks overlapping the viewport + a small margin.
  activeChunkKeys() {
    const camX = this.cam.x, camY = this.cam.y;
    const margin = CHUNK_SIZE;
    const c0x = Math.floor((camX - this.w / 2 - margin) / CHUNK_SIZE);
    const c1x = Math.floor((camX + this.w / 2 + margin) / CHUNK_SIZE);
    const c0y = Math.floor((camY - this.h / 2 - margin) / CHUNK_SIZE);
    const c1y = Math.floor((camY + this.h / 2 + margin) / CHUNK_SIZE);
    const keys = [];
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++)
        keys.push(World.key(cx, cy));
    return keys;
  },

  spawnEnemies(dt) {
    this.spawnTimer -= dt;
    const active = this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    // Target count scales with player level and distance from origin.
    const distFromSpawn = dist(this.player.x, this.player.y, 0, 0);
    const distBonus = Math.floor(distFromSpawn / 1200);
    const target = clamp(8 + Math.floor(this.player.level / 2) + distBonus, 8, 40);
    if (active >= target) return;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = rand(0.4, 1.2);

    // Spawn just outside screen, on walkable tile.
    const a = Math.random() * TAU;
    const r = Math.max(this.w, this.h) * 0.65 + rand(40, 200);
    let sx = this.player.x + Math.cos(a) * r;
    let sy = this.player.y + Math.sin(a) * r;
    // Nudge off water/obstacles.
    for (let tries = 0; tries < 6; tries++) {
      if (!World.blocked(sx, sy, 28)) break;
      const a2 = Math.random() * TAU;
      sx = this.player.x + Math.cos(a2) * r;
      sy = this.player.y + Math.sin(a2) * r;
    }
    if (World.blocked(sx, sy, 28)) return;

    // Tier based on distance from origin + small random.
    const tier = Math.min(6, Math.floor(distFromSpawn / 1400) + Math.floor(Math.random() * 2));
    this.enemies.push(new Enemy(sx, sy, tier));
  },

  cullDead() {
    const maxD2 = 2500 * 2500;
    const px = this.player.x, py = this.player.y;
    // POI-tagged enemies (military base garrisons) are exempt from the
    // distance cull — they stay at their post until killed.
    this.enemies  = this.enemies.filter(e => e.alive && (e.fromPOI || dist2(e.x, e.y, px, py) < maxD2));
    // Traders + neutrals are cleaned up by chunk eviction (cleanupEvictedPOIs),
    // never by distance alone — so a trader doesn't vanish because the player
    // wandered slightly out of range.
    this.neutrals = this.neutrals.filter(e => e.alive);
    this.bullets  = this.bullets.filter(b => b.alive);
    this.orbs     = this.orbs.filter(o => o.alive);
    this.items    = this.items.filter(i => i.alive);
    this.mines    = this.mines.filter(m => m.alive);
    this.turrets  = this.turrets.filter(t => t.alive);
    this.companions = this.companions.filter(c => c.alive);
    this.particles = this.particles.filter(p => p.alive);
    this.effects = this.effects.filter(e => e.alive);
    this.tracks = this.tracks.filter(t => t.life > 0);

    // Flag a military base as cleared once its garrison is wiped, so the
    // minimap icon flips to green and the save remembers the victory.
    for (const [key, poi] of World.poisByChunk) {
      if (poi.type !== 'military_base' || poi.cleared || !poi.spawned) continue;
      const live = this.enemies.some(e => e.fromPOI && e.chunkKey === key);
      if (!live) { poi.cleared = true; Save.markCleared(key); }
    }
  },

  update(dt) {
    if (!this.running || this.paused) return;
    this.ensureChunksAroundPlayer();
    this.spawnEnemies(dt);

    this.player.update(dt, this.input);
    for (const e of this.enemies) e.update(dt);
    for (const n of this.neutrals) n.update(dt);
    for (const t of this.traders) t.update(dt);
    for (const b of this.bullets) b.update(dt);
    for (const o of this.orbs) o.update(dt);
    for (const it of this.items) it.update(dt);
    for (const m of this.mines) m.update(dt);
    for (const tur of this.turrets) tur.update(dt);
    for (const c of this.companions) c.update(dt);
    // Tick obstacle flash timers.
    const activeChunks = this.activeChunkKeys();
    for (const key of activeChunks) {
      const arr = World.obstaclesByChunk.get(key);
      if (arr) for (const o of arr) o.update(dt);
    }
    for (const pa of this.particles) pa.update(dt);
    for (const fx of this.effects) fx.update(dt);
    Skills.tick(this.player, dt);
    // Repeat-fire the currently-held skill hotkey while down.
    this.castHeldSkill();
    // Fade out track marks.
    for (const t of this.tracks) t.life -= dt;
    if (this.tracks.length > 300) this.tracks.splice(0, this.tracks.length - 300);

    // Camera follow with slight lag.
    const targetX = this.player.x;
    const targetY = this.player.y;
    this.cam.x = lerp(this.cam.x, targetX, 1 - Math.pow(0.001, dt));
    this.cam.y = lerp(this.cam.y, targetY, 1 - Math.pow(0.001, dt));
    this.shake = shakeDecay(this.shake, dt);

    this.cullDead();

    if (!this.player.alive && this.running) {
      this.running = false;
      // Clear save so the next start is a fresh run, not a corpse.
      Save.clear();
      UI.showGameOver();
    }

    // Periodic persistence.
    Save.tick(dt);

    UI.update();
  },

  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.w, this.h);

    // Menu state: paint a gradient backdrop so the overlay isn't on pure black.
    if (!this.player) {
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, '#0f2538'); g.addColorStop(1, '#0d1117');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
      return;
    }

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const camX = this.cam.x + sx;
    const camY = this.cam.y + sy;
    const offX = this.w / 2 - camX;
    const offY = this.h / 2 - camY;

    // Draw visible chunks.
    const c0x = Math.floor((camX - this.w / 2) / CHUNK_SIZE);
    const c1x = Math.floor((camX + this.w / 2) / CHUNK_SIZE);
    const c0y = Math.floor((camY - this.h / 2) / CHUNK_SIZE);
    const c1y = Math.floor((camY + this.h / 2) / CHUNK_SIZE);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const ch = World.buildChunk(cx, cy);
        ctx.drawImage(ch.canvas, cx * CHUNK_SIZE + offX, cy * CHUNK_SIZE + offY);
      }
    }

    // Apply world transform for entities.
    ctx.translate(offX, offY);

    // Track marks under everything.
    ctx.save();
    for (const t of this.tracks) {
      const a = Math.max(0, t.life / t.maxLife) * 0.35;
      ctx.fillStyle = `rgba(20,12,6,${a})`;
      ctx.beginPath(); ctx.arc(t.x, t.y, 4, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // Collect visible obstacles for y-sorted render.
    const drawables = [];
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const arr = World.obstaclesByChunk.get(World.key(cx, cy));
        if (!arr) continue;
        for (const o of arr) if (!o.dead) drawables.push(o);
      }
    }

    // XP orbs + items under tanks.
    for (const o of this.orbs) o.render(ctx);
    for (const it of this.items) it.render(ctx);

    // Mines painted on the ground under tanks.
    for (const m of this.mines) m.render(ctx);

    // Y-sort tanks + obstacles so overlap looks right.
    const entities = [];
    if (this.player.alive) entities.push(this.player);
    for (const e of this.enemies)  entities.push(e);
    for (const n of this.neutrals) entities.push(n);
    for (const t of this.traders)  entities.push(t);
    for (const t of this.turrets)  entities.push(t);
    for (const c of this.companions) entities.push(c);
    const all = drawables.concat(entities);
    all.sort((a, b) => a.y - b.y);
    for (const o of all) o.render(ctx);

    // Bullets on top.
    for (const b of this.bullets) b.render(ctx);

    // Skill effects (sound waves, lightning arcs) above bullets.
    for (const fx of this.effects) fx.render(ctx);

    // Particles on very top.
    for (const pa of this.particles) pa.render(ctx);

    ctx.restore();

    // HUD minimap.
    renderMinimap(this.miniCtx);
  },

  loop(t) {
    const now = t / 1000;
    let dt = this.lastTime ? now - this.lastTime : 0;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05; // clamp big frame gaps

    this.update(dt);
    this.render();
    requestAnimationFrame(t2 => this.loop(t2));
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
