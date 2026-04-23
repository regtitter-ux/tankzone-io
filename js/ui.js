// HUD updates, level-up menu, trader shop, game over panel, minimap.

const UPGRADES = [
  { id: 'hp',     name: '+Здоровье',      icon: 'HP', desc: '+20% макс. HP, полное восполнение', apply: p => { p.maxHp = Math.round(p.maxHp * 1.2); p.hp = p.maxHp; } },
  { id: 'regen',  name: '+Регенерация',    icon: 'RG', desc: '+0.6 HP/сек',                         apply: p => { p.regen += 0.6; } },
  { id: 'speed',  name: '+Скорость',       icon: 'SP', desc: '+10% скорости',                        apply: p => { p.speed *= 1.10; } },
  { id: 'dmg',    name: '+Урон',           icon: 'DM', desc: '+18% урона',                           apply: p => { p.damage *= 1.18; } },
  { id: 'rate',   name: '+Скорострел',     icon: 'FR', desc: '+12% темпа стрельбы',                  apply: p => { p.fireRate *= 1.12; } },
  { id: 'bspeed', name: '+Скор. снаряда',  icon: 'BS', desc: '+15% скорости пуль',                  apply: p => { p.bulletSpeed *= 1.15; p.bulletRange *= 1.08; } },
  { id: 'mines',  name: '+Мины',           icon: 'M',  desc: '+3 мины в инвентарь',                  apply: p => { p.mines += 3; } },
  { id: 'turrets',name: '+Турель',         icon: 'T',  desc: '+1 турель в инвентарь',                apply: p => { p.turrets += 1; } },
  { id: 'bots',   name: '+Бот',            icon: 'G',  desc: '+1 бот-компаньон',                      apply: p => { p.companions += 1; } },
  { id: 'pierce', name: '+Пробитие',       icon: 'PI', desc: 'Пули проходят +1 цель',  rare: true,   apply: p => { p.pierce += 1; } },
  { id: 'multi',  name: '+Мультивыстрел',  icon: 'MS', desc: '+1 пуля за выстрел',     epic: true,   apply: p => { p.multishot += 1; } },
];

// Trader shop offerings — mostly stronger than level cards, bought with coins.
const TRADER_OFFERS = [
  { id: 'mines5',   name: '5 мин',         icon: 'M',  desc: 'Пачка мин',                 cost: 3, apply: p => { p.mines += 5; } },
  { id: 'mines15',  name: '15 мин',        icon: 'M+', desc: 'Ящик мин',                  cost: 8, rare: true,  apply: p => { p.mines += 15; } },
  { id: 'turrets3', name: '3 турели',      icon: 'T',  desc: 'Комплект турелей',          cost: 4, apply: p => { p.turrets += 3; } },
  { id: 'turrets8', name: '8 турелей',     icon: 'T+', desc: 'Ящик турелей',              cost: 10, rare: true, apply: p => { p.turrets += 8; } },
  { id: 'bots3',    name: '3 бота',        icon: 'G',  desc: 'Звено компаньонов',         cost: 5, apply: p => { p.companions += 3; } },
  { id: 'bots8',    name: '8 ботов',       icon: 'G+', desc: 'Ударный отряд ботов',       cost: 12, rare: true, apply: p => { p.companions += 8; } },
  { id: 'armor',    name: 'Броня+',        icon: 'HP', desc: '+40% макс. HP и полное HP', cost: 5, apply: p => { p.maxHp = Math.round(p.maxHp * 1.4); p.hp = p.maxHp; } },
  { id: 'caliber',  name: 'Калибр+',       icon: 'DM', desc: '+35% урона',                cost: 6, apply: p => { p.damage *= 1.35; } },
  { id: 'pierce',   name: 'Бронебой',      icon: 'PI', desc: '+2 пробитие',               cost: 7, rare: true,  apply: p => { p.pierce += 2; } },
  { id: 'multi',    name: 'Мультиствол',   icon: 'MS', desc: '+1 пуля за выстрел',        cost: 9, epic: true,  apply: p => { p.multishot += 1; } },
  { id: 'medpack',  name: 'Медпакет',      icon: 'RG', desc: '+1.5 HP/сек, полное HP',    cost: 5, apply: p => { p.regen += 1.5; p.hp = p.maxHp; } },
  { id: 'engines',  name: 'Двигатели+',    icon: 'SP', desc: '+20% скорости',             cost: 5, apply: p => { p.speed *= 1.20; } },
];

const UI = {
  pending: 0,
  active: false,
  activeTrader: null,

  init() {
    const menu = document.getElementById('menu');
    const startBtn = document.getElementById('start-btn');
    const contBtn = document.getElementById('continue-btn');
    const saveInfo = document.getElementById('save-info');
    startBtn.addEventListener('click', () => {
      if (Save.hasSave() && !confirm('Начать заново? Текущий прогресс будет удалён.')) return;
      Save.clear();
      menu.classList.add('hidden');
      Game.start({ fresh: true });
    });
    contBtn.addEventListener('click', () => {
      menu.classList.add('hidden');
      Game.start();
    });
    // Reveal continue + summary if a save exists.
    const snap = Save.read();
    if (snap) {
      contBtn.classList.remove('hidden');
      saveInfo.classList.remove('hidden');
      const mins = Math.round((Date.now() - snap.when) / 60000);
      saveInfo.innerHTML =
        `Последнее сохранение: ${mins <= 0 ? 'только что' : mins + ' мин. назад'} · ` +
        `<b>LVL ${snap.player.level}</b> · <b>${snap.player.score}</b> очков · ` +
        `<b>${snap.player.kills}</b> убийств`;
    }
    document.getElementById('retry-btn').addEventListener('click', () => {
      document.getElementById('gameover').classList.add('hidden');
      Game.start({ fresh: true });
    });
    document.getElementById('trader-close').addEventListener('click', () => this.closeTrader());
    // HUD shop button = open shop without needing a nearby trader NPC.
    document.getElementById('shop-btn').addEventListener('click', () => this.openShop());
    if (new URLSearchParams(location.search).has('auto')) {
      // Prefer continue on auto mode too, so testing a change verifies resume.
      setTimeout(() => (snap ? contBtn : startBtn).click(), 80);
    }
  },

  queueLevelUp(n) {
    this.pending++;
    if (!this.active) this.showLevelUp();
  },

  showLevelUp() {
    if (this.pending <= 0) return;
    this.active = true;
    Game.paused = true;
    const el = document.getElementById('levelup');
    document.getElementById('levelup-num').textContent = Game.player.level - this.pending + 1;

    const pool = [];
    for (const u of UPGRADES) {
      const w = u.epic ? 1 : u.rare ? 2 : 6;
      for (let i = 0; i < w; i++) pool.push(u);
    }
    const chosen = [];
    while (chosen.length < 3) {
      const c = pick(pool);
      if (!chosen.includes(c)) chosen.push(c);
    }

    const cardsEl = document.getElementById('cards');
    cardsEl.innerHTML = '';
    chosen.forEach(u => {
      const card = document.createElement('div');
      card.className = 'card' + (u.epic ? ' epic' : u.rare ? ' rare' : '');
      card.innerHTML = `<div class="icon">${u.icon}</div><div class="name">${u.name}</div><div class="desc">${u.desc}</div>`;
      card.addEventListener('click', () => {
        u.apply(Game.player);
        this.pending--;
        el.classList.add('hidden');
        this.active = false;
        if (this.pending > 0) setTimeout(() => this.showLevelUp(), 120);
        else Game.paused = false;
      });
      cardsEl.appendChild(card);
    });
    el.classList.remove('hidden');
  },

  openTrader(trader) {
    if (this.activeTrader) return;
    this.activeTrader = trader;
    Game.paused = true;
    this.renderTraderCards();
    document.getElementById('trader').classList.remove('hidden');
  },

  // Shop opened from the HUD button (no physical trader required). Using a
  // sentinel non-null value so closeTrader / renderTraderCards still work.
  openShop() {
    if (!Game.running || !Game.player) return;
    if (this.activeTrader) return;
    this.openTrader({ x: 0, y: 0, __hud: true });
  },

  renderTraderCards() {
    const p = Game.player;
    // Pick 4 different offers weighted by rarity.
    const pool = [];
    for (const o of TRADER_OFFERS) {
      const w = o.epic ? 1 : o.rare ? 2 : 5;
      for (let i = 0; i < w; i++) pool.push(o);
    }
    const chosen = [];
    while (chosen.length < 4) {
      const c = pick(pool);
      if (!chosen.includes(c)) chosen.push(c);
    }
    const cards = document.getElementById('trader-cards');
    cards.innerHTML = '';
    chosen.forEach(o => {
      const canAfford = p.coins >= o.cost;
      const card = document.createElement('div');
      card.className = 'card' + (o.epic ? ' epic' : o.rare ? ' rare' : '') + (canAfford ? '' : ' poor');
      card.innerHTML = `
        <div class="icon">${o.icon}</div>
        <div class="name">${o.name}</div>
        <div class="desc">${o.desc}</div>
        <div class="cost">${o.cost} $</div>`;
      card.addEventListener('click', () => {
        if (Game.player.coins < o.cost) {
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 400);
          return;
        }
        Game.player.coins -= o.cost;
        o.apply(Game.player);
        this.renderTraderCards(); // refresh to update affordability / reroll
      });
      cards.appendChild(card);
    });
    document.getElementById('trader-coins').textContent = 'Монет: ' + p.coins;
  },

  closeTrader() {
    if (!this.activeTrader) return;
    document.getElementById('trader').classList.add('hidden');
    this.activeTrader = null;
    Game.paused = false;
    Game.input.interact = false;
  },

  update() {
    const p = Game.player;
    if (!p) return;
    document.getElementById('lvl-val').textContent = p.level;
    document.getElementById('xp-text').textContent = Math.floor(p.xp) + ' / ' + p.xpNext;
    document.getElementById('xp-fill').style.width = (p.xp / p.xpNext * 100) + '%';
    document.getElementById('score-val').textContent = p.score;
    document.getElementById('kills-val').textContent = p.kills;
    document.getElementById('pos-x').textContent = Math.floor(p.x / 10);
    document.getElementById('pos-y').textContent = Math.floor(p.y / 10);
    document.getElementById('hp-text').textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
    document.getElementById('hp-fill').style.width = (p.hp / p.maxHp * 100) + '%';
    document.getElementById('ab-mine').textContent = p.mines;
    document.getElementById('ab-turret').textContent = p.turrets;
    document.getElementById('ab-companion').textContent = p.companions;
    document.getElementById('ab-coin').textContent = p.coins;
    // Live companion count (army size), counts only those still alive.
    let army = 0;
    for (const c of Game.companions) if (c.alive) army++;
    document.getElementById('army-count').textContent = army;
  },

  showGameOver() {
    const p = Game.player;
    document.getElementById('go-lvl').textContent = p.level;
    document.getElementById('go-score').textContent = p.score;
    document.getElementById('go-kills').textContent = p.kills;
    document.getElementById('go-dist').textContent = Math.floor(dist(p.x, p.y, 0, 0) / 10);
    document.getElementById('gameover').classList.remove('hidden');
  },
};

// Mini-map colors (one per biome) for coarse display.
const MINIMAP_COLORS = {
  [BIOME.WATER]: '#1e3a5f',
  [BIOME.SAND]:  '#c8ae62',
  [BIOME.GRASS]: '#3d7a3d',
  [BIOME.DIRT]:  '#6b4e34',
  [BIOME.ROCK]:  '#6f6f78',
};

function renderMinimap(ctx) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  const p = Game.player;
  if (!p) return;
  const range = 2400;
  const scale = W / (range * 2);

  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  const step = 6;
  for (let sy = 0; sy < H; sy += step) {
    for (let sx = 0; sx < W; sx += step) {
      const wx = p.x + (sx - W / 2) / scale;
      const wy = p.y + (sy - H / 2) / scale;
      const b = biomeAt(Math.floor(wx / TILE), Math.floor(wy / TILE), World.seed);
      ctx.fillStyle = MINIMAP_COLORS[b];
      ctx.fillRect(sx, sy, step, step);
    }
  }

  // POIs (gold $ for traders, yellow ring for bases, green for neutral herds).
  for (const [, poi] of World.poisByChunk) {
    const mx = W / 2 + (poi.x - p.x) * scale;
    const my = H / 2 + (poi.y - p.y) * scale;
    if (mx < 0 || my < 0 || mx > W || my > H) continue;
    ctx.save();
    if (poi.type === 'trader') {
      ctx.fillStyle = '#ffd670';
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = '8px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', mx, my);
    } else if (poi.type === 'base') {
      ctx.strokeStyle = '#d29922';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mx, my, 4, 0, TAU); ctx.stroke();
    } else if (poi.type === 'herd') {
      ctx.fillStyle = '#3fb950';
      ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
    } else if (poi.type === 'military_base') {
      // Crossed bars + red ring so a fortress is unmistakable on the map.
      ctx.strokeStyle = poi.cleared ? 'rgba(125,226,160,.7)' : '#f85149';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(mx, my, 7, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - 4, my - 4); ctx.lineTo(mx + 4, my + 4);
      ctx.moveTo(mx + 4, my - 4); ctx.lineTo(mx - 4, my + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Enemies red, neutrals pale green, turrets blue.
  for (const e of Game.enemies) {
    if (!e.alive) continue;
    const mx = W / 2 + (e.x - p.x) * scale;
    const my = H / 2 + (e.y - p.y) * scale;
    if (mx < 0 || my < 0 || mx > W || my > H) continue;
    ctx.fillStyle = '#f85149';
    ctx.fillRect(mx - 2, my - 2, 4, 4);
  }
  for (const n of Game.neutrals) {
    if (!n.alive) continue;
    const mx = W / 2 + (n.x - p.x) * scale;
    const my = H / 2 + (n.y - p.y) * scale;
    if (mx < 0 || my < 0 || mx > W || my > H) continue;
    ctx.fillStyle = '#7de2a0';
    ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
  }
  for (const t of Game.turrets) {
    if (!t.alive) continue;
    const mx = W / 2 + (t.x - p.x) * scale;
    const my = H / 2 + (t.y - p.y) * scale;
    if (mx < 0 || my < 0 || mx > W || my > H) continue;
    ctx.fillStyle = '#8fd9ff';
    ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
  }

  // Player.
  ctx.fillStyle = '#58a6ff';
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(W / 2, H / 2);
  ctx.lineTo(W / 2 + Math.cos(p.angle) * 10, H / 2 + Math.sin(p.angle) * 10);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}
