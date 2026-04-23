// Persistent save: player stats, world seed, destroyed obstacles.
// Uses localStorage under a versioned key so we can invalidate cleanly when
// schema changes ship in a future release. Saves are small JSON (~a few KB);
// IndexedDB would be overkill for this footprint.

const SAVE_KEY = 'tankzone.save.v2';
const SAVE_VERSION = 2;
const AUTOSAVE_EVERY = 4; // seconds

// Which player fields to persist. Derived per-frame state (velocity, flash,
// shootCd) and runtime refs are intentionally excluded.
const PLAYER_FIELDS = [
  'x', 'y', 'angle',
  'maxHp', 'hp', 'regen', 'speed', 'accel', 'friction', 'turnSpeed',
  'damage', 'fireRate', 'bulletSpeed', 'bulletRange', 'pierce', 'multishot', 'spread', 'recoil',
  'level', 'xp', 'xpNext',
  'score', 'kills',
  'mines', 'turrets', 'coins',
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

    // POIs — remember which ones have spawned (so we don't re-spawn herds).
    const pois = {};
    for (const [key, poi] of World.poisByChunk) {
      pois[key] = { type: poi.type, spawned: !!poi.spawned };
    }
    const poisPersisted = this._pois || {};
    const poisMerged = { ...poisPersisted, ...pois };

    // Killed neutrals/traders: we don't track these in saves; they're cheap to
    // re-spawn and the player can always revisit. Score+kills already reflect
    // past runs.

    return {
      v: SAVE_VERSION,
      when: Date.now(),
      seed: World.seed,
      player,
      destroyed: merged,
      pois: poisMerged,
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
    // Seed memory caches for chunks that might get rebuilt later.
    this._destroyed = snap.destroyed || {};
    this._pois = snap.pois || {};

    // Restore player at saved pose, then overwrite stats.
    const p = new Player(snap.player.x || 0, snap.player.y || 0);
    for (const f of PLAYER_FIELDS) if (snap.player[f] !== undefined) p[f] = snap.player[f];
    Game.player = p;
    // Clear transient state so a reloaded game doesn't resume mid-flash.
    p.vx = 0; p.vy = 0; p.flash = 0; p.shootCd = 0; p.boostHeat = 0;
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

  // Same idea for POI spawned flags: if a herd/trader has already been
  // generated in a prior session, keep it generated.
  replayPOI(key, poi) {
    if (!this._pois || !poi) return;
    const rec = this._pois[key];
    if (rec && rec.spawned) poi.spawned = true;
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
