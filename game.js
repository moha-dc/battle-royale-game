// ============================================================
//  DROP ZONE — Top-down Battle Royale
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');

let W = window.innerWidth, H = window.innerHeight;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W; canvas.height = H;
}
window.addEventListener('resize', resize);
resize();

// ----- World constants -----
const WORLD = 4000;
const TILE = 80;
const FRICTION = 0.82;
const PLAYER_SPEED = 3.2;
const SPRINT_MULT = 1.5;
const BOT_COUNT = 24;
const TREE_COUNT = 130;
const ROCK_COUNT = 50;
const CHEST_COUNT = 22;

// ----- Game state -----
let state = {
  running: false,
  tick: 0,
  player: null,
  bots: [],
  trees: [],
  rocks: [],
  chests: [],
  walls: [],
  bullets: [],
  drops: [],
  particles: [],
  damageNumbers: [],
  storm: null,
  camera: { x: 0, y: 0 },
  alive: 0,
  kills: 0,
  killer: null
};

const keys = {};
const mouse = { x: 0, y: 0, down: false, worldX: 0, worldY: 0 };

window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === '1') selectWeapon(0);
  if (e.key === '2') selectWeapon(1);
  if (e.key === '3') selectWeapon(2);
  if (e.key === '4' || e.key.toLowerCase() === 'b') buildWall();
  if (e.key.toLowerCase() === 'e') tryPickup();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
});
canvas.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; });
canvas.addEventListener('mouseup',   e => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ============================================================
// Weapons definitions
// ============================================================
const WEAPONS = {
  pickaxe: { name: 'PIOCHE', kind: 'melee', dmg: 18, range: 55, cd: 22, color: '#cccccc' },
  pistol:  { name: 'PISTOLET', kind: 'gun', dmg: 14, cd: 18, speed: 14, spread: 0.04, range: 700, ammo: '∞', color: '#bbb' },
  shotgun: { name: 'FUSIL P.', kind: 'gun', dmg: 10, cd: 45, speed: 13, spread: 0.18, range: 350, pellets: 6, ammo: '∞', color: '#e88141' },
  rifle:   { name: 'FUSIL A.', kind: 'gun', dmg: 9,  cd: 7,  speed: 18, spread: 0.07, range: 800, ammo: '∞', color: '#4ec5f1' },
  smg:     { name: 'MITRAILLEUSE', kind: 'gun', dmg: 7, cd: 4, speed: 16, spread: 0.10, range: 500, ammo: '∞', color: '#a85bff' },
  sniper:  { name: 'SNIPER', kind: 'gun', dmg: 75, cd: 80, speed: 26, spread: 0.005, range: 1400, ammo: '∞', color: '#f6e651' }
};
const GUN_TYPES = ['pistol', 'shotgun', 'rifle', 'smg', 'sniper'];

// ============================================================
// Init
// ============================================================
function init() {
  state.tick = 0;
  state.bots = []; state.trees = []; state.rocks = [];
  state.chests = []; state.walls = []; state.bullets = [];
  state.drops = []; state.particles = []; state.damageNumbers = [];
  state.kills = 0; state.killer = null;

  state.player = makeFighter(WORLD/2, WORLD/2, true);

  for (let i = 0; i < BOT_COUNT; i++) {
    let pos = randomMapPos(300);
    while (dist(pos.x, pos.y, WORLD/2, WORLD/2) < 400) pos = randomMapPos(300);
    state.bots.push(makeFighter(pos.x, pos.y, false));
  }
  state.alive = 1 + state.bots.length;

  for (let i = 0; i < TREE_COUNT; i++) {
    let p = randomMapPos(200);
    state.trees.push({ x: p.x, y: p.y, hp: 40, r: 22, type: Math.random() < 0.5 ? 0 : 1 });
  }
  for (let i = 0; i < ROCK_COUNT; i++) {
    let p = randomMapPos(200);
    state.rocks.push({ x: p.x, y: p.y, hp: 60, r: 26 });
  }
  for (let i = 0; i < CHEST_COUNT; i++) {
    let p = randomMapPos(300);
    state.chests.push({ x: p.x, y: p.y, opened: false });
  }

  state.storm = {
    cx: WORLD/2, cy: WORLD/2,
    r: 2400, targetR: 2400,
    shrinkStart: 600,
    shrinkTime: 800,
    phase: 0,
    warnTime: 180,
    timer: 0
  };

  state.camera.x = state.player.x;
  state.camera.y = state.player.y;

  state.player.slots = [
    { type: 'pickaxe' },
    null,
    null
  ];
  state.player.slotIndex = 0;
  state.player.wood = 0;
  state.player.brick = 0;

  updateHUD();
  state.running = true;
}

function makeFighter(x, y, isPlayer) {
  return {
    x, y, vx: 0, vy: 0,
    r: 18,
    angle: 0,
    hp: 100, maxHp: 100,
    shield: 0, maxShield: 100,
    alive: true,
    isPlayer,
    speed: PLAYER_SPEED,
    cd: 0,
    aiState: 'wander',
    aiTimer: 0,
    aiTarget: null,
    aiDir: Math.random() * Math.PI * 2,
    slots: isPlayer ? null : [ { type: GUN_TYPES[Math.floor(Math.random()*GUN_TYPES.length)] } ],
    slotIndex: 0,
    color: isPlayer ? '#ffd23f' : pickBotColor(),
    name: isPlayer ? 'TOI' : 'BOT_' + Math.floor(Math.random()*1000),
    wood: 0, brick: 0,
    flash: 0,
  };
}

function pickBotColor() {
  const palette = ['#ff5252', '#ff8c4b', '#c155ff', '#52cfff', '#5dffac', '#ff5cd5'];
  return palette[Math.floor(Math.random()*palette.length)];
}

function randomMapPos(margin) {
  return {
    x: margin + Math.random() * (WORLD - margin*2),
    y: margin + Math.random() * (WORLD - margin*2)
  };
}

// ============================================================
// Update
// ============================================================
function update() {
  if (!state.running) return;
  state.tick++;

  updateStorm();
  updatePlayer();
  updateBots();
  updateBullets();
  updateWalls();
  updateParticles();
  updateDamageNumbers();
  updateCamera();

  if (!state.player.alive) {
    endGame(false);
  } else if (countAliveBots() === 0) {
    endGame(true);
  }
}

function countAliveBots() {
  return state.bots.filter(b => b.alive).length;
}

// ----- Storm -----
function updateStorm() {
  const s = state.storm;
  s.timer++;
  if (s.phase === 0 && s.timer > s.shrinkStart - s.warnTime) {
    document.getElementById('storm-warn').classList.remove('hidden');
  }
  if (s.phase === 0 && s.timer > s.shrinkStart) {
    document.getElementById('storm-warn').classList.add('hidden');
    s.phase = 1;
    s.timer = 0;
    s.targetR = Math.max(s.r * 0.55, 300);
    const ang = Math.random()*Math.PI*2;
    s.cx += Math.cos(ang) * 200;
    s.cy += Math.sin(ang) * 200;
  } else if (s.phase === 1 && s.timer > s.shrinkTime) {
    s.phase = 2;
    s.timer = 0;
    s.shrinkStart = 500;
  } else if (s.phase === 2 && s.timer > s.shrinkStart - s.warnTime) {
    document.getElementById('storm-warn').classList.remove('hidden');
  } else if (s.phase === 2 && s.timer > s.shrinkStart) {
    document.getElementById('storm-warn').classList.add('hidden');
    s.phase = 3;
    s.timer = 0;
    s.targetR = Math.max(s.r * 0.5, 150);
    const ang = Math.random()*Math.PI*2;
    s.cx += Math.cos(ang) * 100;
    s.cy += Math.sin(ang) * 100;
  } else if (s.phase === 3 && s.timer > s.shrinkTime) {
    s.phase = 4;
    s.timer = 0;
    s.shrinkStart = 400;
  } else if (s.phase === 4 && s.timer > s.shrinkStart - s.warnTime) {
    document.getElementById('storm-warn').classList.remove('hidden');
  } else if (s.phase === 4 && s.timer > s.shrinkStart) {
    document.getElementById('storm-warn').classList.add('hidden');
    s.phase = 5;
    s.timer = 0;
    s.targetR = 80;
  }

  if (s.r > s.targetR) {
    s.r -= 0.6;
    if (s.r < s.targetR) s.r = s.targetR;
  }

  if (state.tick % 30 === 0) {
    const dmg = s.phase < 2 ? 3 : s.phase < 4 ? 6 : 10;
    if (dist(state.player.x, state.player.y, s.cx, s.cy) > s.r) {
      damage(state.player, dmg, null);
    }
    for (const b of state.bots) {
      if (b.alive && dist(b.x, b.y, s.cx, s.cy) > s.r) damage(b, dmg, null);
    }
  }

  const info = document.getElementById('zone-info');
  if (state.player.alive) {
    const inside = dist(state.player.x, state.player.y, s.cx, s.cy) <= s.r;
    info.textContent = inside ? 'SÉCURISÉE' : 'TEMPÊTE !';
    info.style.color = inside ? '#fff' : '#ff5252';
  }
}

// ----- Player -----
function updatePlayer() {
  const p = state.player;
  if (!p.alive) return;

  let dx = 0, dy = 0;
  if (keys['w'] || keys['z'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['q'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;
  const sprint = keys['shift'] ? SPRINT_MULT : 1;
  if (dx || dy) {
    const m = Math.hypot(dx, dy);
    p.vx += (dx/m) * p.speed * sprint * 0.4;
    p.vy += (dy/m) * p.speed * sprint * 0.4;
  }
  p.vx *= FRICTION; p.vy *= FRICTION;
  tryMove(p);

  mouse.worldX = state.camera.x + (mouse.x - W/2);
  mouse.worldY = state.camera.y + (mouse.y - H/2);
  p.angle = Math.atan2(mouse.worldY - p.y, mouse.worldX - p.x);

  if (p.cd > 0) p.cd--;
  if (mouse.down && p.cd === 0) {
    fireWeapon(p);
  }

  if (p.flash > 0) p.flash--;
}

function fireWeapon(f) {
  const slot = f.slots[f.slotIndex];
  if (!slot) return;
  const w = WEAPONS[slot.type];
  if (!w) return;
  f.cd = w.cd;
  if (w.kind === 'melee') {
    meleeHit(f, w);
    spawnSwing(f);
  } else {
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const ang = f.angle + (Math.random()-0.5) * w.spread * 2;
      state.bullets.push({
        x: f.x + Math.cos(f.angle) * 22,
        y: f.y + Math.sin(f.angle) * 22,
        vx: Math.cos(ang) * w.speed,
        vy: Math.sin(ang) * w.speed,
        dmg: w.dmg,
        range: w.range,
        traveled: 0,
        owner: f,
        color: w.color
      });
    }
    for (let i = 0; i < 6; i++) {
      state.particles.push({
        x: f.x + Math.cos(f.angle) * 24,
        y: f.y + Math.sin(f.angle) * 24,
        vx: Math.cos(f.angle + (Math.random()-0.5)*0.6) * (2+Math.random()*3),
        vy: Math.sin(f.angle + (Math.random()-0.5)*0.6) * (2+Math.random()*3),
        life: 10, color: '#ffea00', r: 3
      });
    }
  }
}

function meleeHit(f, w) {
  const tx = f.x + Math.cos(f.angle) * w.range * 0.6;
  const ty = f.y + Math.sin(f.angle) * w.range * 0.6;

  for (const t of state.trees) {
    if (t.hp <= 0) continue;
    if (dist(t.x, t.y, tx, ty) < w.range * 0.6) {
      t.hp -= w.dmg;
      spawnParticles(t.x, t.y, '#5c3a1e', 8);
      if (t.hp <= 0) {
        f.wood = Math.min(999, (f.wood||0) + 30 + Math.floor(Math.random()*10));
        spawnParticles(t.x, t.y, '#c98a4a', 18);
      } else {
        f.wood = Math.min(999, (f.wood||0) + 4);
      }
      if (f.isPlayer) updateHUD();
      return;
    }
  }
  for (const r of state.rocks) {
    if (r.hp <= 0) continue;
    if (dist(r.x, r.y, tx, ty) < w.range * 0.6) {
      r.hp -= w.dmg;
      spawnParticles(r.x, r.y, '#aaa', 6);
      if (r.hp <= 0) {
        f.brick = Math.min(999, (f.brick||0) + 20);
        spawnParticles(r.x, r.y, '#ccc', 14);
      } else {
        f.brick = Math.min(999, (f.brick||0) + 3);
      }
      if (f.isPlayer) updateHUD();
      return;
    }
  }
  const targets = f.isPlayer ? state.bots : [state.player];
  for (const t of targets) {
    if (!t.alive) continue;
    if (dist(t.x, t.y, tx, ty) < w.range * 0.6) {
      damage(t, w.dmg, f);
      return;
    }
  }
  for (const wl of state.walls) {
    if (wl.hp <= 0) continue;
    if (dist(wl.x, wl.y, tx, ty) < w.range * 0.6) {
      wl.hp -= w.dmg;
      spawnParticles(wl.x, wl.y, '#c98a4a', 4);
      return;
    }
  }
}

function spawnSwing(f) {
  for (let i = 0; i < 5; i++) {
    const ang = f.angle + (Math.random()-0.5)*0.8;
    state.particles.push({
      x: f.x + Math.cos(ang)*30,
      y: f.y + Math.sin(ang)*30,
      vx: Math.cos(ang)*2, vy: Math.sin(ang)*2,
      life: 8, color: '#fff', r: 2
    });
  }
}

function tryMove(f) {
  const nx = f.x + f.vx;
  const ny = f.y + f.vy;
  let blockedX = false, blockedY = false;
  for (const w of state.walls) {
    if (w.hp <= 0) continue;
    if (rectCircle(w.x-30, w.y-30, 60, 60, nx, f.y, f.r)) blockedX = true;
    if (rectCircle(w.x-30, w.y-30, 60, 60, f.x, ny, f.r)) blockedY = true;
  }
  for (const t of state.trees) {
    if (t.hp <= 0) continue;
    if (dist(nx, f.y, t.x, t.y) < f.r + t.r*0.6) blockedX = true;
    if (dist(f.x, ny, t.x, t.y) < f.r + t.r*0.6) blockedY = true;
  }
  for (const r of state.rocks) {
    if (r.hp <= 0) continue;
    if (dist(nx, f.y, r.x, r.y) < f.r + r.r*0.7) blockedX = true;
    if (dist(f.x, ny, r.x, r.y) < f.r + r.r*0.7) blockedY = true;
  }
  if (!blockedX) f.x = nx;
  if (!blockedY) f.y = ny;
  f.x = clamp(f.x, f.r, WORLD - f.r);
  f.y = clamp(f.y, f.r, WORLD - f.r);
}

function rectCircle(rx, ry, rw, rh, cx, cy, cr) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  return dist(cx, cy, closestX, closestY) < cr;
}

// ----- Bots AI -----
function updateBots() {
  for (const b of state.bots) {
    if (!b.alive) continue;
    b.aiTimer++;
    if (b.flash > 0) b.flash--;
    if (b.cd > 0) b.cd--;

    const p = state.player;
    const d = dist(b.x, b.y, p.x, p.y);

    if (p.alive && d < 500) {
      b.aiState = 'attack';
      b.aiTarget = p;
    } else if (b.aiState === 'attack' && d > 700) {
      b.aiState = 'wander';
      b.aiTarget = null;
    }

    const s = state.storm;
    const outsideStorm = dist(b.x, b.y, s.cx, s.cy) > s.r - 60;
    if (outsideStorm) {
      const ang = Math.atan2(s.cy - b.y, s.cx - b.x);
      b.vx += Math.cos(ang) * 0.5;
      b.vy += Math.sin(ang) * 0.5;
    }

    if (b.aiState === 'wander') {
      if (b.aiTimer > 90 + Math.random()*60) {
        b.aiDir = Math.random()*Math.PI*2;
        b.aiTimer = 0;
      }
      b.vx += Math.cos(b.aiDir) * 0.15;
      b.vy += Math.sin(b.aiDir) * 0.15;
    } else if (b.aiState === 'attack' && b.aiTarget) {
      const tx = b.aiTarget.x, ty = b.aiTarget.y;
      b.angle = Math.atan2(ty - b.y, tx - b.x);
      const targetDist = 280;
      if (d > targetDist) {
        b.vx += Math.cos(b.angle) * 0.35;
        b.vy += Math.sin(b.angle) * 0.35;
      } else if (d < targetDist - 80) {
        b.vx -= Math.cos(b.angle) * 0.25;
        b.vy -= Math.sin(b.angle) * 0.25;
      } else {
        const strafe = (Math.floor(b.aiTimer / 60) % 2 === 0) ? 1 : -1;
        b.vx += Math.cos(b.angle + Math.PI/2) * 0.25 * strafe;
        b.vy += Math.sin(b.angle + Math.PI/2) * 0.25 * strafe;
      }
      if (b.cd === 0 && d < 480 && hasLineOfSight(b, b.aiTarget)) {
        b.angle += (Math.random()-0.5) * 0.15;
        fireWeapon(b);
      }
    }

    b.vx *= FRICTION; b.vy *= FRICTION;
    tryMove(b);
  }
}

function hasLineOfSight(a, t) {
  const steps = 10;
  for (let i = 1; i < steps; i++) {
    const px = a.x + (t.x - a.x) * (i/steps);
    const py = a.y + (t.y - a.y) * (i/steps);
    for (const w of state.walls) {
      if (w.hp <= 0) continue;
      if (Math.abs(px - w.x) < 30 && Math.abs(py - w.y) < 30) return false;
    }
  }
  return true;
}

// ----- Bullets -----
function updateBullets() {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += b.vx; b.y += b.vy;
    b.traveled += Math.hypot(b.vx, b.vy);
    if (b.traveled > b.range) { state.bullets.splice(i, 1); continue; }
    if (b.x < 0 || b.x > WORLD || b.y < 0 || b.y > WORLD) {
      state.bullets.splice(i, 1); continue;
    }
    let hit = false;
    for (const w of state.walls) {
      if (w.hp <= 0) continue;
      if (Math.abs(b.x - w.x) < 30 && Math.abs(b.y - w.y) < 30) {
        w.hp -= b.dmg;
        spawnParticles(b.x, b.y, '#c98a4a', 4);
        hit = true; break;
      }
    }
    if (hit) { state.bullets.splice(i, 1); continue; }
    for (const t of state.trees) {
      if (t.hp <= 0) continue;
      if (dist(b.x, b.y, t.x, t.y) < t.r * 0.6) {
        t.hp -= b.dmg * 0.4;
        spawnParticles(b.x, b.y, '#5c3a1e', 3);
        hit = true; break;
      }
    }
    if (hit) { state.bullets.splice(i, 1); continue; }
    for (const r of state.rocks) {
      if (r.hp <= 0) continue;
      if (dist(b.x, b.y, r.x, r.y) < r.r * 0.8) {
        r.hp -= b.dmg * 0.5;
        spawnParticles(b.x, b.y, '#aaa', 3);
        hit = true; break;
      }
    }
    if (hit) { state.bullets.splice(i, 1); continue; }
    const targets = (b.owner && b.owner.isPlayer) ? state.bots : [state.player];
    for (const f of targets) {
      if (!f.alive) continue;
      if (dist(b.x, b.y, f.x, f.y) < f.r) {
        damage(f, b.dmg, b.owner);
        spawnParticles(b.x, b.y, '#ff5252', 6);
        hit = true; break;
      }
    }
    if (hit) state.bullets.splice(i, 1);
  }
}

// ----- Walls -----
function updateWalls() {
  for (let i = state.walls.length - 1; i >= 0; i--) {
    if (state.walls[i].hp <= 0) {
      spawnParticles(state.walls[i].x, state.walls[i].y, '#c98a4a', 12);
      state.walls.splice(i, 1);
    }
  }
}

// ----- Damage -----
function damage(f, amount, attacker) {
  if (!f.alive) return;
  let dmg = amount;
  if (f.shield > 0) {
    const absorbed = Math.min(f.shield, dmg);
    f.shield -= absorbed;
    dmg -= absorbed;
  }
  f.hp -= dmg;
  f.flash = 8;
  state.damageNumbers.push({
    x: f.x, y: f.y - 20, vy: -1, life: 40,
    text: '-' + Math.ceil(amount),
    color: f.isPlayer ? '#ff5252' : '#ffea00'
  });
  if (f.isPlayer) {
    const fl = document.getElementById('flash');
    fl.style.opacity = '1';
    setTimeout(() => fl.style.opacity = '0', 80);
    updateHUD();
  }
  if (f.hp <= 0) {
    f.hp = 0;
    f.alive = false;
    state.alive--;
    spawnParticles(f.x, f.y, f.color, 30);
    if (f.slots) {
      for (const sl of f.slots) {
        if (sl && sl.type !== 'pickaxe') {
          state.drops.push({
            x: f.x + (Math.random()-0.5)*20,
            y: f.y + (Math.random()-0.5)*20,
            kind: 'weapon', type: sl.type
          });
        }
      }
    }
    if (attacker && attacker.isPlayer) {
      state.kills++;
      attacker.shield = Math.min(attacker.maxShield, attacker.shield + 10);
      if (attacker.isPlayer) updateHUD();
    }
    if (f.isPlayer) {
      state.killer = attacker;
    }
  }
}

// ----- Particles -----
function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    state.particles.push({
      x, y,
      vx: (Math.random()-0.5)*5,
      vy: (Math.random()-0.5)*5,
      life: 20 + Math.random()*15,
      color, r: 2 + Math.random()*2
    });
  }
}
function updateParticles() {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.9; p.vy *= 0.9;
    p.life--;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}
function updateDamageNumbers() {
  for (let i = state.damageNumbers.length - 1; i >= 0; i--) {
    const d = state.damageNumbers[i];
    d.y += d.vy;
    d.vy *= 0.95;
    d.life--;
    if (d.life <= 0) state.damageNumbers.splice(i, 1);
  }
}

// ----- Camera -----
function updateCamera() {
  state.camera.x += (state.player.x - state.camera.x) * 0.12;
  state.camera.y += (state.player.y - state.camera.y) * 0.12;
}

// ============================================================
// Actions
// ============================================================
function selectWeapon(i) {
  if (!state.player.alive) return;
  if (!state.player.slots[i]) return;
  state.player.slotIndex = i;
  state.player.cd = 5;
  updateHUD();
}

function buildWall() {
  const p = state.player;
  if (!p.alive) return;
  if ((p.wood||0) < 10) return;
  const wx = Math.round((p.x + Math.cos(p.angle) * 70) / 30) * 30;
  const wy = Math.round((p.y + Math.sin(p.angle) * 70) / 30) * 30;
  if (dist(wx, wy, p.x, p.y) < 40) return;
  for (const w of state.walls) {
    if (dist(w.x, w.y, wx, wy) < 50) return;
  }
  state.walls.push({ x: wx, y: wy, hp: 100, owner: p });
  p.wood -= 10;
  spawnParticles(wx, wy, '#c98a4a', 8);
  updateHUD();
}

function tryPickup() {
  const p = state.player;
  if (!p.alive) return;
  for (const c of state.chests) {
    if (c.opened) continue;
    if (dist(p.x, p.y, c.x, c.y) < 50) {
      c.opened = true;
      openChest(c);
      return;
    }
  }
  for (let i = state.drops.length - 1; i >= 0; i--) {
    const d = state.drops[i];
    if (dist(p.x, p.y, d.x, d.y) < 40) {
      pickupDrop(d);
      state.drops.splice(i, 1);
      return;
    }
  }
}

function openChest(c) {
  const loot = [];
  const n = 1 + Math.floor(Math.random()*2);
  for (let i = 0; i < n; i++) {
    loot.push({ kind: 'weapon', type: GUN_TYPES[Math.floor(Math.random()*GUN_TYPES.length)] });
  }
  if (Math.random() < 0.5) loot.push({ kind: 'shield' });
  if (Math.random() < 0.5) loot.push({ kind: 'heal' });
  for (const it of loot) {
    state.drops.push({
      x: c.x + (Math.random()-0.5)*40,
      y: c.y + (Math.random()-0.5)*40,
      ...it
    });
  }
  spawnParticles(c.x, c.y, '#ffea00', 20);
}

function pickupDrop(d) {
  const p = state.player;
  if (d.kind === 'weapon') {
    let placed = false;
    for (let i = 1; i < 3; i++) {
      if (!p.slots[i]) { p.slots[i] = { type: d.type }; p.slotIndex = i; placed = true; break; }
    }
    if (!placed) {
      const idx = Math.max(1, p.slotIndex);
      p.slots[idx] = { type: d.type };
      p.slotIndex = idx;
    }
  } else if (d.kind === 'heal') {
    p.hp = Math.min(p.maxHp, p.hp + 50);
  } else if (d.kind === 'shield') {
    p.shield = Math.min(p.maxShield, p.shield + 50);
  }
  spawnParticles(p.x, p.y, '#5dffac', 10);
  updateHUD();
}

// ============================================================
// Rendering
// ============================================================
function render() {
  ctx.fillStyle = '#0e1424';
  ctx.fillRect(0, 0, W, H);
  if (!state.player || !state.storm) return;

  ctx.save();
  ctx.translate(W/2 - state.camera.x, H/2 - state.camera.y);

  drawGround();
  drawChests();
  drawDrops();
  drawTrees();
  drawRocks();
  drawWalls();
  drawBullets();
  drawFighters();
  drawParticles();
  drawDamageNumbers();
  drawStorm();

  ctx.restore();

  drawMinimap();
}

function drawGround() {
  const startX = Math.max(0, Math.floor((state.camera.x - W/2) / TILE) * TILE);
  const startY = Math.max(0, Math.floor((state.camera.y - H/2) / TILE) * TILE);
  const endX = Math.min(WORLD, startX + W + TILE*2);
  const endY = Math.min(WORLD, startY + H + TILE*2);
  for (let x = startX; x < endX; x += TILE) {
    for (let y = startY; y < endY; y += TILE) {
      const c = ((x/TILE + y/TILE) % 2 === 0) ? '#5fb04a' : '#56a542';
      ctx.fillStyle = c;
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
  ctx.strokeStyle = '#2a3142';
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, WORLD, WORLD);
}

function drawTrees() {
  for (const t of state.trees) {
    if (t.hp <= 0) continue;
    if (!onScreen(t.x, t.y, 50)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(t.x+4, t.y+8, t.r*0.9, t.r*0.4, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#5c3a1e';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r*0.4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = t.type ? '#2b6e2a' : '#3a8a3a';
    ctx.beginPath(); ctx.arc(t.x - 6, t.y - 8, t.r*0.9, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(t.x + 7, t.y - 4, t.r*0.85, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(t.x, t.y - 14, t.r*0.8, 0, Math.PI*2); ctx.fill();
    if (t.hp < 40) {
      drawSmallBar(t.x, t.y - t.r - 12, t.hp / 40, '#5dffac');
    }
  }
}

function drawRocks() {
  for (const r of state.rocks) {
    if (r.hp <= 0) continue;
    if (!onScreen(r.x, r.y, 50)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(r.x+3, r.y+6, r.r, r.r*0.4, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#8a8d99';
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#a8acb8';
    ctx.beginPath(); ctx.arc(r.x - 5, r.y - 6, r.r*0.6, 0, Math.PI*2); ctx.fill();
    if (r.hp < 60) {
      drawSmallBar(r.x, r.y - r.r - 12, r.hp / 60, '#5dffac');
    }
  }
}

function drawChests() {
  for (const c of state.chests) {
    if (!onScreen(c.x, c.y, 30)) continue;
    if (c.opened) {
      ctx.fillStyle = '#5a3a1f';
      ctx.fillRect(c.x - 16, c.y - 8, 32, 16);
    } else {
      const t = state.tick * 0.05;
      const glow = 8 + Math.sin(t) * 3;
      ctx.shadowColor = '#ffea00'; ctx.shadowBlur = glow;
      ctx.fillStyle = '#c98a4a';
      ctx.fillRect(c.x - 18, c.y - 12, 36, 24);
      ctx.fillStyle = '#ffea00';
      ctx.fillRect(c.x - 18, c.y - 12, 36, 4);
      ctx.fillStyle = '#5a3a1f';
      ctx.fillRect(c.x - 3, c.y - 8, 6, 6);
      ctx.shadowBlur = 0;
    }
  }
}

function drawDrops() {
  for (const d of state.drops) {
    if (!onScreen(d.x, d.y, 30)) continue;
    const float = Math.sin(state.tick * 0.1 + d.x) * 3;
    ctx.save();
    ctx.translate(d.x, d.y + float);
    if (d.kind === 'weapon') {
      const w = WEAPONS[d.type];
      ctx.fillStyle = w.color;
      ctx.shadowColor = w.color; ctx.shadowBlur = 12;
      ctx.fillRect(-12, -4, 24, 8);
      ctx.fillStyle = '#222'; ctx.fillRect(-4, -7, 6, 4);
    } else if (d.kind === 'heal') {
      ctx.shadowColor = '#5dffac'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#fff'; ctx.fillRect(-10, -10, 20, 20);
      ctx.fillStyle = '#ff3a3a'; ctx.fillRect(-8, -3, 16, 6); ctx.fillRect(-3, -8, 6, 16);
    } else if (d.kind === 'shield') {
      ctx.shadowColor = '#3da9fc'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#3da9fc';
      ctx.beginPath();
      ctx.moveTo(0, -12); ctx.lineTo(10, -6); ctx.lineTo(8, 8); ctx.lineTo(0, 12);
      ctx.lineTo(-8, 8); ctx.lineTo(-10, -6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
    if (dist(d.x, d.y, state.player.x, state.player.y) < 40) {
      ctx.fillStyle = '#ffea00';
      ctx.font = 'bold 12px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText('[E]', d.x, d.y - 22);
    }
  }
}

function drawWalls() {
  for (const w of state.walls) {
    ctx.fillStyle = '#c98a4a';
    ctx.fillRect(w.x - 30, w.y - 30, 60, 60);
    ctx.strokeStyle = '#7a4a1a';
    ctx.lineWidth = 3;
    ctx.strokeRect(w.x - 30, w.y - 30, 60, 60);
    ctx.fillStyle = '#a8702f';
    ctx.fillRect(w.x - 28, w.y - 28, 56, 12);
    ctx.fillRect(w.x - 28, w.y - 4, 56, 8);
    ctx.fillRect(w.x - 28, w.y + 16, 56, 12);
    if (w.hp < 100) drawSmallBar(w.x, w.y - 38, w.hp / 100, '#c98a4a');
  }
}

function drawBullets() {
  for (const b of state.bullets) {
    if (!onScreen(b.x, b.y, 20)) continue;
    ctx.fillStyle = b.color || '#ffea00';
    ctx.shadowColor = b.color || '#ffea00';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = b.color || '#ffea00';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx*1.5, b.y - b.vy*1.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawFighters() {
  for (const b of state.bots) {
    if (b.alive) drawFighter(b);
  }
  if (state.player.alive) drawFighter(state.player);
}

function drawFighter(f) {
  if (!onScreen(f.x, f.y, 60)) return;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(f.x+2, f.y+12, f.r*1.1, f.r*0.5, 0, 0, Math.PI*2); ctx.fill();

  const bodyColor = f.flash > 0 ? '#ffffff' : f.color;
  ctx.fillStyle = bodyColor;
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = f.isPlayer ? '#000' : 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI*2); ctx.stroke();

  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle);
  const slot = f.slots && f.slots[f.slotIndex];
  if (slot) {
    const w = WEAPONS[slot.type];
    if (w.kind === 'melee') {
      ctx.fillStyle = '#bbb';
      ctx.fillRect(14, -3, 18, 6);
      ctx.fillStyle = '#5c3a1e';
      ctx.fillRect(8, -2, 10, 4);
    } else {
      ctx.fillStyle = w.color;
      ctx.fillRect(8, -4, 22, 8);
      ctx.fillStyle = '#222';
      ctx.fillRect(28, -2, 4, 4);
    }
  }
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(2, -8, 12, 5);
  ctx.fillStyle = '#3da9fc';
  ctx.fillRect(3, -7, 10, 2);
  ctx.restore();

  if (f.hp < f.maxHp || f.shield > 0) {
    drawSmallBar(f.x, f.y - f.r - 14, f.hp / f.maxHp, '#5dffac');
    if (f.shield > 0) {
      drawSmallBar(f.x, f.y - f.r - 20, f.shield / f.maxShield, '#7fd1ff');
    }
  }
  if (f.isPlayer) {
    ctx.fillStyle = '#ffea00';
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('TOI', f.x, f.y - f.r - 26);
  }
}

function drawSmallBar(x, y, ratio, color) {
  const w = 36, h = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - w/2, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x - w/2, y, w * Math.max(0, ratio), h);
}

function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / 30);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawDamageNumbers() {
  for (const d of state.damageNumbers) {
    ctx.globalAlpha = Math.max(0, d.life / 40);
    ctx.font = 'bold 14px Bungee';
    ctx.fillStyle = d.color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.strokeText(d.text, d.x, d.y);
    ctx.fillText(d.text, d.x, d.y);
  }
  ctx.globalAlpha = 1;
}

function drawStorm() {
  const s = state.storm;
  ctx.save();
  ctx.fillStyle = 'rgba(180, 70, 220, 0.25)';
  ctx.beginPath();
  ctx.rect(0, 0, WORLD, WORLD);
  ctx.arc(s.cx, s.cy, s.r, 0, Math.PI*2, true);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#c44fff';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#c44fff'; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur = 0;
  if (s.r > s.targetR + 1) {
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.cx, s.cy, s.targetR, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function onScreen(x, y, pad) {
  return x > state.camera.x - W/2 - pad &&
         x < state.camera.x + W/2 + pad &&
         y > state.camera.y - H/2 - pad &&
         y < state.camera.y + H/2 + pad;
}

// ----- Minimap -----
function drawMinimap() {
  const size = 160;
  mctx.fillStyle = '#0e1424';
  mctx.fillRect(0, 0, size, size);

  const scale = size / WORLD;
  mctx.fillStyle = '#3a6a2a';
  mctx.fillRect(0, 0, size, size);

  const s = state.storm;
  mctx.fillStyle = 'rgba(180,70,220,0.4)';
  mctx.fillRect(0, 0, size, size);
  mctx.globalCompositeOperation = 'destination-out';
  mctx.beginPath();
  mctx.arc(s.cx*scale, s.cy*scale, s.r*scale, 0, Math.PI*2);
  mctx.fill();
  mctx.globalCompositeOperation = 'source-over';

  mctx.strokeStyle = '#c44fff';
  mctx.lineWidth = 1.5;
  mctx.beginPath();
  mctx.arc(s.cx*scale, s.cy*scale, s.r*scale, 0, Math.PI*2);
  mctx.stroke();
  if (s.r > s.targetR + 1) {
    mctx.setLineDash([3, 3]);
    mctx.strokeStyle = '#fff';
    mctx.beginPath();
    mctx.arc(s.cx*scale, s.cy*scale, s.targetR*scale, 0, Math.PI*2);
    mctx.stroke();
    mctx.setLineDash([]);
  }

  for (const b of state.bots) {
    if (!b.alive) continue;
    mctx.fillStyle = '#ff5252';
    mctx.fillRect(b.x*scale - 1.5, b.y*scale - 1.5, 3, 3);
  }
  if (state.player.alive) {
    mctx.fillStyle = '#ffea00';
    mctx.beginPath();
    mctx.arc(state.player.x*scale, state.player.y*scale, 3, 0, Math.PI*2);
    mctx.fill();
    mctx.strokeStyle = '#000'; mctx.lineWidth = 1; mctx.stroke();
  }

  mctx.strokeStyle = 'rgba(255,234,0,0.5)';
  mctx.lineWidth = 1;
  mctx.strokeRect(0.5, 0.5, size-1, size-1);
}

// ============================================================
// HUD updates
// ============================================================
function updateHUD() {
  const p = state.player;
  document.getElementById('hp-bar').style.width = (p.hp / p.maxHp * 100) + '%';
  document.getElementById('hp-text').textContent = Math.ceil(p.hp);
  document.getElementById('sh-bar').style.width = (p.shield / p.maxShield * 100) + '%';
  document.getElementById('sh-text').textContent = Math.ceil(p.shield);
  document.getElementById('wood').textContent = p.wood || 0;
  document.getElementById('brick').textContent = p.brick || 0;
  document.getElementById('alive').textContent = state.alive;
  document.getElementById('kills').textContent = state.kills;
  for (let i = 0; i < 3; i++) {
    const slot = document.getElementById('slot-' + (i+1));
    const s = p.slots[i];
    slot.classList.toggle('active', i === p.slotIndex);
    slot.classList.toggle('empty', !s);
    const nameEl = slot.querySelector('.name');
    nameEl.textContent = s ? WEAPONS[s.type].name : '—';
  }
}

// ============================================================
// Game over
// ============================================================
function endGame(victory) {
  state.running = false;
  const endScreen = document.getElementById('end-screen');
  const title = document.getElementById('end-title');
  const stats = document.getElementById('end-stats');
  if (victory) {
    title.textContent = 'VICTOIRE !';
    title.className = 'title victory';
    stats.innerHTML = `Tu es le dernier survivant.<br><span>${state.kills}</span> éliminations<br>Position : <span>#1</span> / ${BOT_COUNT + 1}`;
  } else {
    title.textContent = 'ÉLIMINÉ';
    title.className = 'title defeat';
    const place = state.alive;
    stats.innerHTML = `<span>${state.kills}</span> éliminations<br>Position : <span>#${place}</span> / ${BOT_COUNT + 1}`;
  }
  setTimeout(() => endScreen.classList.remove('hidden'), 600);
}

// ============================================================
// Helpers
// ============================================================
function dist(x1, y1, x2, y2) { return Math.hypot(x2-x1, y2-y1); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ============================================================
// Main loop
// ============================================================
function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

// ============================================================
// Buttons
// ============================================================
document.getElementById('btn-start').addEventListener('click', () => {
  document.getElementById('start-screen').classList.add('hidden');
  init();
});
document.getElementById('btn-restart').addEventListener('click', () => {
  document.getElementById('end-screen').classList.add('hidden');
  init();
});

loop();
