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

// Draw a single ground tile from the atlas, scaled to TILE size.
function drawTile(ctx, biome, dx, dy) {
  let spriteName = 'grass';
  if (biome === BIOME.WATER) spriteName = 'water';
  else if (biome === BIOME.DIRT) spriteName = 'dirt';
  else if (biome === BIOME.SAND) spriteName = 'dirt';
  else if (biome === BIOME.ROCK) spriteName = 'dirt';
  else spriteName = 'grass';
  const a = ATLAS[spriteName];
  if (atlasReady) {
    ctx.drawImage(atlas, a.sx, a.sy, SHEET_TILE, SHEET_TILE, dx, dy, TILE, TILE);
  } else {
    ctx.fillStyle = BIOME_TINT[biome];
    ctx.fillRect(dx, dy, TILE, TILE);
  }
  // Tint overlays where the atlas lacks a dedicated tile.
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
        const b = biomeAt(baseTX + tx, baseTY + ty, this.seed);
        drawTile(ctx, b, tx * TILE, ty * TILE);
      }
    }

    // Decide whether this chunk has a POI. Skip the spawn-area chunk (0,0).
    const poiHash = hash2D(cx, cy, this.seed + 9991);
    let poi = null;
    const distFromSpawn = Math.hypot(cx, cy);
    if (distFromSpawn > 1.5) {
      if (poiHash < 0.04)       poi = 'base';     // abandoned base w/ chest
      else if (poiHash < 0.065) poi = 'herd';     // neutral mob cluster
      else if (poiHash < 0.075) poi = 'trader';   // friendly trader tank
    }

    // Obstacle placement. POIs override the random scatter inside their footprint.
    const obstacles = [];
    const poiData = this.generatePOI(cx, cy, poi, obstacles);
    this.scatterObstacles(cx, cy, obstacles, poiData ? poiData.keepOut : null);

    const chunk = { canvas, cx, cy };
    this.chunks.set(k, chunk);
    this.obstaclesByChunk.set(k, obstacles);
    if (poiData) this.poisByChunk.set(k, poiData);
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
      // Abandoned base: 6–10 crates/barrels in a walled ring, plus a "chest" in the center.
      const R = 110;
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const px = centerX + Math.cos(a) * R + rand(-12, 12);
        const py = centerY + Math.sin(a) * R + rand(-12, 12);
        const t = i % 3 === 0 ? 'barrel_metal' : i % 3 === 1 ? 'barrel_wood' : 'crate_wood';
        out.push(new Obstacle(px, py, t));
      }
      // Chest in the middle (a super-crate).
      out.push(new Obstacle(centerX, centerY, 'chest'));
      data.keepOut = (x, y) => dist2(x, y, centerX, centerY) < (R + 60) * (R + 60);
    } else if (poiType === 'herd') {
      data.keepOut = (x, y) => dist2(x, y, centerX, centerY) < 160 * 160;
    } else if (poiType === 'trader') {
      data.keepOut = (x, y) => dist2(x, y, centerX, centerY) < 140 * 140;
    }
    return data;
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
