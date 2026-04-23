// Procedural infinite world: sheet-atlas terrain, destructible obstacles, POIs.
const TILE = 64;
const CHUNK_TILES = 16;
const CHUNK_SIZE = TILE * CHUNK_TILES; // 1024 px

const BIOME = { WATER: 0, SAND: 1, GRASS: 2, DIRT: 3, ROCK: 4 };

// Kenney RPG pack sprite sheet (Public Domain / CC0).
const SHEET_TILE = 128;                 // Atlas native tile size (2X pack).
const atlas = new Image();
atlas.src = 'assets/world/rpg_sheet.png';
let atlasReady = false;
atlas.addEventListener('load', () => { atlasReady = true; });

// Atlas source rects for each tile / sprite (all 128×128 in atlas).
const ATLAS = {
  // Ground tiles — seamless centers of autotile blocks.
  grass:        { sx: 128,  sy: 128  },
  dirt:         { sx: 512,  sy: 128  },
  water:        { sx: 1408, sy: 128  },
  // Sandy/desert has no dedicated tile in this pack — we tint dirt at render time.
  sand:         { sx: 512,  sy: 128  },
  // Rock ground filler — dirt with extra stone overlay in code.
  rock:         { sx: 512,  sy: 128  },
  // Obstacle sprites.
  tree_conifer: { sx: 512,  sy: 1280 },
  tree_oak:     { sx: 512,  sy: 1408 },
  bush_green:   { sx: 256,  sy: 1152 },
  bush_orange:  { sx: 0,    sy: 1152 },
  rockpile:     { sx: 2048, sy: 896  },
  crate_wood:   { sx: 1024, sy: 1152 },
  barrel_wood:  { sx: 1152, sy: 1280 },
  barrel_metal: { sx: 1152, sy: 1408 },
  // POI / trader props.
  door_arch:    { sx: 1280, sy: 1152 }, // door in stone arch
  window:       { sx: 2176, sy: 896  }, // small window
  fence_h:      { sx: 768,  sy: 1280 },
};

// Biome fallback colors used before atlas loads and for rock/sand tinting.
const BIOME_TINT = {
  [BIOME.WATER]: '#2e6ea5',
  [BIOME.SAND]:  'rgba(220,195,120,0.55)',   // amber overlay on dirt
  [BIOME.GRASS]: '#3d7a3d',
  [BIOME.DIRT]:  '#6b4e34',
  [BIOME.ROCK]:  'rgba(90,90,100,0.60)',     // gray overlay on dirt
};

function biomeAt(tx, ty, seed) {
  const n = fbm(tx, ty, seed, 4, 0.55, 1 / 28);
  const v = fbm(tx + 1000, ty + 1000, seed, 3, 0.5, 1 / 60);
  const mixed = n * 0.7 + v * 0.3;
  if (mixed < 0.30) return BIOME.WATER;
  if (mixed < 0.36) return BIOME.SAND;
  if (mixed < 0.70) return BIOME.GRASS;
  if (mixed < 0.83) return BIOME.DIRT;
  return BIOME.ROCK;
}

function isWalkableBiome(biome) { return biome !== BIOME.WATER; }

// World-coord → "cx,cy" key for the chunk containing that point.
function chunkOfWorld(x, y) {
  return Math.floor(x / CHUNK_SIZE) + ',' + Math.floor(y / CHUNK_SIZE);
}

// True when (cx,cy) chunk is designated as a military base.
function isMilitaryBaseChunk(cx, cy) {
  const distFromSpawn = Math.hypot(cx, cy);
  if (distFromSpawn <= 3) return false;
  const poiHash = hash2D(cx, cy, World.seed + 9991);
  // Same thresholds as buildChunk so the two stay in sync.
  return poiHash >= 0.075 && poiHash < 0.085;
}

// Deterministic global description of a military base centered on the given
// chunk. Returns world-space wall and loot positions plus scheduled enemies,
// so any chunk the base overlaps can pick out the parts that belong to it.
function militaryBaseLayout(chunkCX, chunkCY) {
  const cx = chunkCX * CHUNK_SIZE + CHUNK_SIZE / 2;
  const cy = chunkCY * CHUNK_SIZE + CHUNK_SIZE / 2;

  // Three rings, ~2 screen radii across (viewport ~640 px radius).
  const rings = [
    { r: 1200, count: 96, gateCount: 2, gateWidth: 3 }, // outer
    { r:  800, count: 66, gateCount: 2, gateWidth: 3 }, // middle
    { r:  450, count: 38, gateCount: 2, gateWidth: 3 }, // inner
  ];

  const walls = [];
  rings.forEach((ring, rIdx) => {
    // Gate positions are deterministic per ring; offset staggered so straight
    // radial lines don't pierce every ring at once.
    const gates = [];
    for (let g = 0; g < ring.gateCount; g++) {
      const h = hash2D(chunkCX, chunkCY, World.seed + 301 + rIdx * 53 + g * 7);
      gates.push(Math.floor(h * ring.count) + Math.floor(g * ring.count / ring.gateCount));
    }
    for (let i = 0; i < ring.count; i++) {
      let nearGate = false;
      for (const g of gates) {
        const d = Math.min((i - g + ring.count) % ring.count, (g - i + ring.count) % ring.count);
        if (d < ring.gateWidth) { nearGate = true; break; }
      }
      if (nearGate) continue;
      const a = (i / ring.count) * TAU;
      const x = cx + Math.cos(a) * ring.r;
      const y = cy + Math.sin(a) * ring.r;
      if (biomeAt(Math.floor(x / TILE), Math.floor(y / TILE), World.seed) === BIOME.WATER) continue;
      walls.push({ x, y });
    }
  });

  // Loot core: central chest + a tight cluster of chests/barrels/crates.
  const core = [];
  core.push({ x: cx, y: cy, type: 'chest' });
  const coreCount = 34;
  for (let i = 0; i < coreCount; i++) {
    const a = (i / coreCount) * TAU + hash2D(i, chunkCY, World.seed + 511) * 0.6;
    const r = 28 + hash2D(i, chunkCY, World.seed + 617) * 180;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (dist2(x, y, cx, cy) < 36 * 36) continue;
    if (biomeAt(Math.floor(x / TILE), Math.floor(y / TILE), World.seed) === BIOME.WATER) continue;
    const roll = hash2D(i, chunkCY + 77, World.seed + 719);
    const t = roll < 0.12 ? 'chest' :
              roll < 0.35 ? 'barrel_metal' :
              roll < 0.60 ? 'barrel_wood' : 'crate_wood';
    core.push({ x, y, type: t });
  }

  // Enemies staged across the layers. Tiers escalate towards the core so the
  // final push is a proper boss fight.
  const enemies = [];
  // Outer patrols (between outer & middle ring).
  const outerCount = 22;
  for (let i = 0; i < outerCount; i++) {
    const a = (i / outerCount) * TAU + 0.15;
    const r = (1200 + 800) / 2;
    enemies.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, tierBonus: 1 });
  }
  // Middle guards (between middle & inner ring).
  const midCount = 16;
  for (let i = 0; i < midCount; i++) {
    const a = (i / midCount) * TAU + 0.5;
    const r = (800 + 450) / 2;
    enemies.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, tierBonus: 2 });
  }
  // Inner guards (between inner ring & core).
  const innerCount = 12;
  for (let i = 0; i < innerCount; i++) {
    const a = (i / innerCount) * TAU + 0.9;
    const r = 300;
    enemies.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, tierBonus: 3 });
  }
  // Core elites clustered by the chest.
  const eliteCount = 6;
  for (let i = 0; i < eliteCount; i++) {
    const a = (i / eliteCount) * TAU;
    enemies.push({ x: cx + Math.cos(a) * 130, y: cy + Math.sin(a) * 130, tierBonus: 4 });
  }

  return { outerR: 1200, walls, core, enemies, centerX: cx, centerY: cy };
}

// Sample with a 1-pixel inset so bilinear filtering at downscaled draw sizes
// can't pull colour from the neighbouring atlas cell. Eliminates the visible
// dark/light seams that otherwise appear on a grass field.
const ATLAS_INSET = 1;

// Draw a single ground tile from the atlas. Tiles are randomly flipped /
// rotated per world position (by hash) so the grass doesn't repeat as a
// visible grid.
function drawTile(ctx, biome, dx, dy, wtx, wty) {
  let spriteName = 'grass';
  if (biome === BIOME.WATER) spriteName = 'water';
  else if (biome === BIOME.DIRT) spriteName = 'dirt';
  else if (biome === BIOME.SAND) spriteName = 'dirt';
  else if (biome === BIOME.ROCK) spriteName = 'dirt';
  else spriteName = 'grass';
  const a = ATLAS[spriteName];
  if (atlasReady) {
    const flipX = hash2D(wtx, wty, World.seed + 601) < 0.5;
    const flipY = hash2D(wtx, wty, World.seed + 607) < 0.5;
    const rot   = Math.floor(hash2D(wtx, wty, World.seed + 613) * 4); // 0..3
    ctx.save();
    ctx.translate(dx + TILE / 2, dy + TILE / 2);
    if (rot)            ctx.rotate(rot * Math.PI / 2);
    if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(
      atlas,
      a.sx + ATLAS_INSET, a.sy + ATLAS_INSET,
      SHEET_TILE - 2 * ATLAS_INSET, SHEET_TILE - 2 * ATLAS_INSET,
      -TILE / 2, -TILE / 2, TILE, TILE
    );
    ctx.restore();
  } else {
    ctx.fillStyle = BIOME_TINT[biome];
    ctx.fillRect(dx, dy, TILE, TILE);
  }
  if (biome === BIOME.SAND) {
    ctx.fillStyle = BIOME_TINT[BIOME.SAND];
    ctx.fillRect(dx, dy, TILE, TILE);
  } else if (biome === BIOME.ROCK) {
    ctx.fillStyle = BIOME_TINT[BIOME.ROCK];
    ctx.fillRect(dx, dy, TILE, TILE);
  }
}

const World = {
  seed: 1337,
  chunks: new Map(),
  obstaclesByChunk: new Map(),
  poisByChunk: new Map(),

  key(cx, cy) { return cx + ',' + cy; },

  // Build terrain and scatter obstacles / POIs for one chunk.
  buildChunk(cx, cy) {
    const k = this.key(cx, cy);
    if (this.chunks.has(k)) return this.chunks.get(k);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK_SIZE;
    const ctx = canvas.getContext('2d');

    const baseTX = cx * CHUNK_TILES;
    const baseTY = cy * CHUNK_TILES;

    // Terrain.
    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const wtx = baseTX + tx, wty = baseTY + ty;
        const b = biomeAt(wtx, wty, this.seed);
        drawTile(ctx, b, tx * TILE, ty * TILE, wtx, wty);
      }
    }

    // Decide whether this chunk has a POI. Skip the spawn-area chunk (0,0).
    // Military bases are rare and always at least a few chunks out so the
    // player can level up a bit before being drawn to a fortified site.
    const poiHash = hash2D(cx, cy, this.seed + 9991);
    let poi = null;
    const distFromSpawn = Math.hypot(cx, cy);
    if (distFromSpawn > 1.5) {
      if (poiHash < 0.04)       poi = 'base';     // abandoned mini-cache
      else if (poiHash < 0.065) poi = 'herd';
      else if (poiHash < 0.075) poi = 'trader';
      else if (poiHash < 0.085 && distFromSpawn > 3) poi = 'military_base';
    }

    // Obstacle placement. POIs override the random scatter inside their footprint.
    const obstacles = [];
    const poiData = this.generatePOI(cx, cy, poi, obstacles);

    // A military base's walls can span ~2 chunks in every direction from its
    // home chunk. Every chunk in that radius pulls in the wall positions that
    // fall within its own bounds and also inherits the base's keep-out zone
    // so nature scatter doesn't poke through the walls.
    const BASE_CHUNK_R = 2;
    let keepOut = poiData ? poiData.keepOut : null;
    for (let ny = cy - BASE_CHUNK_R; ny <= cy + BASE_CHUNK_R; ny++) {
      for (let nx = cx - BASE_CHUNK_R; nx <= cx + BASE_CHUNK_R; nx++) {
        if (nx === cx && ny === cy) continue;
        if (!isMilitaryBaseChunk(nx, ny)) continue;
        const layout = militaryBaseLayout(nx, ny);
        const selfKey = this.key(cx, cy);
        for (const w of layout.walls) {
          if (chunkOfWorld(w.x, w.y) === selfKey) obstacles.push(new Obstacle(w.x, w.y, 'wall_stone'));
        }
        const bCenterX = layout.centerX, bCenterY = layout.centerY;
        const R = layout.outerR + 80;
        const prevKeepOut = keepOut;
        keepOut = (x, y) => (prevKeepOut && prevKeepOut(x, y)) || dist2(x, y, bCenterX, bCenterY) < R * R;
      }
    }

    this.scatterObstacles(cx, cy, obstacles, keepOut);

    const chunk = { canvas, cx, cy };
    // Stamp chunk key and ordered index on each obstacle so destruction events
    // can be recorded against a stable identity (for persistent saves).
    for (let i = 0; i < obstacles.length; i++) {
      obstacles[i].chunkKey = k;
      obstacles[i].chunkIndex = i;
    }
    this.chunks.set(k, chunk);
    this.obstaclesByChunk.set(k, obstacles);
    if (poiData) this.poisByChunk.set(k, poiData);
    if (typeof Save !== 'undefined') {
      Save.replayDestruction(k, obstacles);
      if (poiData) Save.replayPOI(k, poiData);
    }
    return chunk;
  },

  // Random nature scatter (trees, rocks, bushes, occasional crates/barrels).
  scatterObstacles(cx, cy, out, keepOut) {
    const baseTX = cx * CHUNK_TILES;
    const baseTY = cy * CHUNK_TILES;
    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const wtx = baseTX + tx, wty = baseTY + ty;
        const b = biomeAt(wtx, wty, this.seed);
        if (b === BIOME.WATER) continue;
        const r = hash2D(wtx, wty, this.seed + 777);
        const density =
          b === BIOME.ROCK  ? 0.22 :
          b === BIOME.DIRT  ? 0.10 :
          b === BIOME.GRASS ? 0.09 : 0.03;
        if (r >= density) continue;

        const wx = wtx * TILE + 16 + hash2D(wtx, wty, this.seed + 111) * (TILE - 32);
        const wy = wty * TILE + 16 + hash2D(wtx, wty, this.seed + 222) * (TILE - 32);
        if (keepOut && keepOut(wx, wy)) continue;

        let type;
        if (b === BIOME.GRASS) {
          type = r < density * 0.25 ? 'tree_oak'
               : r < density * 0.55 ? 'tree_conifer'
               : r < density * 0.78 ? 'bush_green' : 'bush_orange';
        } else if (b === BIOME.ROCK) {
          type = r < density * 0.85 ? 'rockpile' : 'crate_wood';
        } else if (b === BIOME.SAND) {
          type = r < density * 0.6  ? 'rockpile' : 'bush_orange';
        } else { // DIRT
          type = r < density * 0.35 ? 'rockpile'
               : r < density * 0.60 ? 'crate_wood'
               : r < density * 0.82 ? 'barrel_wood' : 'barrel_metal';
        }
        out.push(new Obstacle(wx, wy, type));
      }
    }
  },

  // Place POI structures. Returns { keepOut, spawnOnEnter } or null.
  generatePOI(cx, cy, poiType, out) {
    if (!poiType) return null;
    const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerY = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
    // Nudge off water.
    const b = biomeAt(Math.floor(centerX / TILE), Math.floor(centerY / TILE), this.seed);
    if (b === BIOME.WATER) return null;

    const data = { type: poiType, cx, cy, x: centerX, y: centerY, spawned: false };

    if (poiType === 'base') {
      // Abandoned mini-base: 6–10 crates/barrels in a walled ring + chest.
      const R = 110;
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const px = centerX + Math.cos(a) * R + rand(-12, 12);
        const py = centerY + Math.sin(a) * R + rand(-12, 12);
        const t = i % 3 === 0 ? 'barrel_metal' : i % 3 === 1 ? 'barrel_wood' : 'crate_wood';
        out.push(new Obstacle(px, py, t));
      }
      out.push(new Obstacle(centerX, centerY, 'chest'));
      data.keepOut = (x, y) => dist2(x, y, centerX, centerY) < (R + 60) * (R + 60);
    } else if (poiType === 'herd') {
      data.keepOut = (x, y) => dist2(x, y, centerX, centerY) < 160 * 160;
    } else if (poiType === 'trader') {
      data.keepOut = (x, y) => dist2(x, y, centerX, centerY) < 140 * 140;
    } else if (poiType === 'military_base') {
      this.buildMilitaryBase(centerX, centerY, cx, cy, out, data);
    }
    return data;
  },

  // Fortress layout: 3 concentric walls (~2 screens across), loot core, and
  // dozens of scheduled enemies. The base's walls span multiple chunks, so we
  // delegate to `militaryBaseLayout` for a deterministic global description;
  // this chunk only pushes the walls that fall inside its own bounds.
  buildMilitaryBase(cx, cy, chunkCX, chunkCY, out, data) {
    const layout = militaryBaseLayout(chunkCX, chunkCY);
    const baseKey = this.key(chunkCX, chunkCY);

    // Walls that live in THIS chunk (home chunk).
    for (const w of layout.walls) {
      if (chunkOfWorld(w.x, w.y) === baseKey) out.push(new Obstacle(w.x, w.y, 'wall_stone'));
    }
    // Core loot obstacles — all live in the home chunk (center).
    for (const p of layout.core) {
      out.push(new Obstacle(p.x, p.y, p.type));
    }

    data.keepOut = (x, y) => dist2(x, y, cx, cy) < (layout.outerR + 80) * (layout.outerR + 80);
    data.enemies = layout.enemies;
    data.spawned = false;
    data.center  = { x: cx, y: cy };
    data.outerR  = layout.outerR;
  },

  getObstaclesNear(wx, wy, radius) {
    const out = [];
    const c0x = Math.floor((wx - radius) / CHUNK_SIZE);
    const c1x = Math.floor((wx + radius) / CHUNK_SIZE);
    const c0y = Math.floor((wy - radius) / CHUNK_SIZE);
    const c1y = Math.floor((wy + radius) / CHUNK_SIZE);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        const arr = this.obstaclesByChunk.get(this.key(cx, cy));
        if (arr) for (const o of arr) out.push(o);
      }
    return out;
  },

  blocked(x, y, r) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!isWalkableBiome(biomeAt(tx, ty, this.seed))) return true;
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const ttx = Math.floor((x + dx) / TILE), tty = Math.floor((y + dy) / TILE);
      if (!isWalkableBiome(biomeAt(ttx, tty, this.seed))) return true;
    }
    const nearby = this.getObstaclesNear(x, y, r + 40);
    for (const o of nearby) {
      if (o.dead) continue;
      const rr = r + o.r;
      if (dist2(x, y, o.x, o.y) < rr * rr) return o;
    }
    return false;
  },

  reset(seed) {
    this.seed = seed | 0;
    this.chunks.clear();
    this.obstaclesByChunk.clear();
    this.poisByChunk.clear();
  },

  evict(px, py, maxChunkRadius = 5) {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cy = Math.floor(py / CHUNK_SIZE);
    for (const [k, ch] of this.chunks) {
      if (Math.abs(ch.cx - cx) > maxChunkRadius || Math.abs(ch.cy - cy) > maxChunkRadius) {
        this.chunks.delete(k);
        this.obstaclesByChunk.delete(k);
        this.poisByChunk.delete(k);
      }
    }
  },
};
