// Persistent save: player stats, world seed, destroyed obstacles.
// Uses localStorage under a versioned key so we can invalidate cleanly when
// schema changes ship in a future release. Saves are small JSON (~a few KB);
// IndexedDB would be overkill for this footprint.

// Bumped whenever the snapshot shape changes in a way we can't migrate.
// v4: adds placed companions.
const SAVE_KEY = 'tankzone.save.v4';
const SAVE_VERSION = 4;
const AUTOSAVE_EVERY = 4; // seconds

// Which player fields to persist. Derived per-frame state (velocity, flash,
// shootCd) and runtime refs are intentionally excluded.
const PLAYER_FIELDS = [
  'x', 'y', 'angle',
  'maxHp', 'hp', 'regen', 'speed', 'accel', 'friction', 'turnSpeed',
  'damage', 'fireRate', 'bulletSpeed', 'bulletRange', 'pierce', 'multishot', 'spread', 'recoil',
  'level', 'xp', 'xpNext',
  'score', 'kills',
  'mines', 'turrets', 'companions', 'coins',
  'type', 'color',
];

const Save = {
  lastAutosave: 0,

  // Gather the full snapshot into a plain JSON object.
  snapshot() {
    const p = Game.player;
    if (!p) return null;
    const player = {};
    for (const f of PLAYER_FIELDS) player[f] = p[f];

    // Destroyed obstacle indices per chunk key, and chunks that have been
    // generated (so POIs stay consistent / visited state persists).
    const destroyed = {};
    for (const [key, arr] of World.obstaclesByChunk) {
      const dead = [];
      for (let i = 0; i < arr.length; i++) if (arr[i].dead) dead.push(i);
      if (dead.length) destroyed[key] = dead;
    }
    // Persistent destroyed record: merges in any chunk that's been evicted
    // since last save but whose destruction we already recorded.
    const persisted = this._destroyed || {};
    const merged = { ...persisted, ...destroyed };

    // Placed structures (player-deployed). These are authoritative: whatever
    // is on the field gets written verbatim.
    const mines = Game.mines.filter(m => m.alive).map(m => ({
      x: m.x, y: m.y, armTime: m.armTime, life: m.life,
    }));
    const turrets = Game.turrets.filter(t => t.alive).map(t => ({
      x: t.x, y: t.y, angle: t.angle, hp: t.hp,
    }));
    const companions = Game.companions.filter(c => c.alive).map(c => ({
      x: c.x, y: c.y, angle: c.angle, hp: c.hp,
    }));

    // POI state: cleared (wiped-out herd, can't farm) and spawned (one-shot
    // garrisons like a military base whose enemies we've already placed).
    const pois = {};
    for (const [key, poi] of World.poisByChunk) {
      pois[key] = { type: poi.type, cleared: !!poi.cleared, spawned: !!poi.spawned };
    }
    const poisMerged = { ...(this._pois || {}), ...pois };

    return {
      v: SAVE_VERSION,
      when: Date.now(),
      seed: World.seed,
      player,
      destroyed: merged,
      pois: poisMerged,
      mines,
      turrets,
      companions,
    };
  },

  write() {
    try {
      const snap = this.snapshot();
      if (!snap) return;
      localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
      // Cache the persistent records in memory so chunks evicted after save
      // don't lose their destruction history until next full save.
      this._destroyed = snap.destroyed;
      this._pois = snap.pois;
    } catch (e) {
      console.warn('save failed', e);
    }
  },

  read() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== SAVE_VERSION) return null;
      return data;
    } catch (e) {
      console.warn('save corrupted, ignoring', e);
      return null;
    }
  },

  hasSave() { return !!this.read(); },

  clear() {
    localStorage.removeItem(SAVE_KEY);
    this._destroyed = {};
    this._pois = {};
  },

  // Apply a loaded snapshot into the current game. Called from Game.start().
  apply(snap) {
    if (!snap) return false;
    World.seed = snap.seed | 0;
    // Seed memory caches for chunks that get rebuilt later.
    this._destroyed = snap.destroyed || {};
    this._pois = snap.pois || {};

    // Restore player at saved pose, then overwrite stats.
    const p = new Player(snap.player.x || 0, snap.player.y || 0);
    for (const f of PLAYER_FIELDS) if (snap.player[f] !== undefined) p[f] = snap.player[f];
    Game.player = p;
    p.vx = 0; p.vy = 0; p.flash = 0; p.shootCd = 0; p.boostHeat = 0;

    // Restore placed structures.
    if (Array.isArray(snap.mines)) {
      for (const d of snap.mines) {
        const m = new Mine(d.x, d.y);
        if (typeof d.armTime === 'number') m.armTime = d.armTime;
        if (typeof d.life === 'number') m.life = d.life;
        Game.mines.push(m);
      }
    }
    if (Array.isArray(snap.turrets)) {
      for (const d of snap.turrets) {
        const t = new TurretBot(d.x, d.y);
        if (typeof d.angle === 'number') t.angle = d.angle;
        if (typeof d.hp === 'number') t.hp = d.hp;
        Game.turrets.push(t);
      }
    }
    if (Array.isArray(snap.companions)) {
      for (const d of snap.companions) {
        const c = new Companion(d.x, d.y);
        if (typeof d.angle === 'number') c.angle = d.angle;
        if (typeof d.hp === 'number') c.hp = d.hp;
        Game.companions.push(c);
      }
    }
    return true;
  },

  // Called right after a chunk is built: replay recorded destruction into
  // the fresh obstacle array so destroyed trees/chests stay destroyed across
  // chunk evict+rebuild cycles.
  replayDestruction(key, obstacles) {
    if (!this._destroyed) return;
    const dead = this._destroyed[key];
    if (!dead) return;
    for (const idx of dead) {
      const o = obstacles[idx];
      if (o) o.dead = true;
    }
  },

  // Restore POI state (cleared / already-spawned).
  replayPOI(key, poi) {
    if (!this._pois || !poi) return;
    const rec = this._pois[key];
    if (!rec) return;
    if (rec.cleared) poi.cleared = true;
    if (rec.spawned) poi.spawned = true;
  },

  // Mark a POI as cleared so its entities won't respawn on future chunk loads.
  markCleared(chunkKey) {
    if (!this._pois) this._pois = {};
    const rec = this._pois[chunkKey] || (this._pois[chunkKey] = {});
    rec.cleared = true;
  },

  // Mark that a one-shot POI (e.g. a military base) has been spawned so we
  // don't re-spawn its enemy garrison on chunk rebuild.
  markSpawned(chunkKey) {
    if (!this._pois) this._pois = {};
    const rec = this._pois[chunkKey] || (this._pois[chunkKey] = {});
    rec.spawned = true;
  },

  // Immediate record of a destruction event. Called from Obstacle.destroy() so
  // the death survives even if the chunk is evicted before the next autosave.
  recordDestroyed(chunkKey, index) {
    if (!this._destroyed) this._destroyed = {};
    const arr = this._destroyed[chunkKey] || (this._destroyed[chunkKey] = []);
    if (!arr.includes(index)) arr.push(index);
  },

  tick(dt) {
    this.lastAutosave += dt;
    if (this.lastAutosave >= AUTOSAVE_EVERY) {
      this.lastAutosave = 0;
      this.write();
    }
  },
};

// Final save on tab close / reload — browsers allow synchronous localStorage
// writes in unload handlers.
window.addEventListener('beforeunload', () => { if (Game.running) Save.write(); });
