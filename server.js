const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static('.'));

const WORLD = 4000;
const COLORS     = ['#52cfff', '#ff8c4b', '#c155ff', '#5dffac', '#ff5cd5', '#ff5252'];
const BOT_COLORS = ['#ff5252', '#ff8c4b', '#c155ff', '#52cfff', '#5dffac', '#ff5cd5'];
const GUN_TYPES  = ['pistol', 'shotgun', 'rifle', 'smg', 'sniper'];
const WEAPONS    = {
  pickaxe: { dmg:18, cd:22, speed:0,  spread:0,    range:55,   pellets:1, color:'#ccc' },
  pistol:  { dmg:14, cd:25, speed:14, spread:0.06, range:700,  pellets:1, color:'#bbb' },
  shotgun: { dmg:10, cd:50, speed:13, spread:0.20, range:350,  pellets:6, color:'#e88141' },
  rifle:   { dmg:9,  cd:10, speed:18, spread:0.09, range:800,  pellets:1, color:'#4ec5f1' },
  smg:     { dmg:7,  cd:6,  speed:16, spread:0.12, range:500,  pellets:1, color:'#a85bff' },
  sniper:  { dmg:75, cd:90, speed:26, spread:0.01, range:1400, pellets:1, color:'#f6e651' },
};
const BOT_COUNT = 8;
const FRICTION  = 0.82;
const mapSeed = Math.floor(Math.random() * 1e9);

let players = {};
let storm = { cx: WORLD/2, cy: WORLD/2, r: 2400, targetR: 2400, phase: 0, timer: 0, shrinkStart: 600, shrinkTime: 800, warnTime: 180 };
let tick = 0;
let gameActive = false;

// ---- Storm logic (server authoritative) ----
function tickStorm() {
  const s = storm;
  s.timer++;
  if (s.phase === 0 && s.timer > s.shrinkStart) {
    s.phase = 1; s.timer = 0; s.targetR = Math.max(s.r * 0.55, 300);
    const a = Math.random() * Math.PI * 2;
    s.cx += Math.cos(a) * 200; s.cy += Math.sin(a) * 200;
  } else if (s.phase === 1 && s.timer > s.shrinkTime) {
    s.phase = 2; s.timer = 0; s.shrinkStart = 500;
  } else if (s.phase === 2 && s.timer > s.shrinkStart) {
    s.phase = 3; s.timer = 0; s.targetR = Math.max(s.r * 0.5, 150);
    const a = Math.random() * Math.PI * 2;
    s.cx += Math.cos(a) * 100; s.cy += Math.sin(a) * 100;
  } else if (s.phase === 3 && s.timer > s.shrinkTime) {
    s.phase = 4; s.timer = 0; s.shrinkStart = 400;
  } else if (s.phase === 4 && s.timer > s.shrinkStart) {
    s.phase = 5; s.timer = 0; s.targetR = 80;
  }
  if (s.r > s.targetR) s.r = Math.max(s.targetR, s.r - 0.6);
}

function applyDamage(targetId, killerId, amount) {
  const t = players[targetId];
  if (!t || !t.alive) return;
  let dmg = amount;
  if (t.shield > 0) { const a = Math.min(t.shield, dmg); t.shield -= a; dmg -= a; }
  t.hp = Math.max(0, t.hp - dmg);
  if (t.hp <= 0 && t.alive) {
    t.alive = false;
    if (killerId && players[killerId]) players[killerId].kills++;
    io.emit('playerDied', { id: targetId, killerId });
    broadcastAlive();
    checkWin();
  }
}

function broadcastAlive() {
  io.emit('aliveCount', Object.values(players).filter(p => p.alive).length);
}

function checkWin() {
  const realAlive = Object.values(players).filter(p => p.alive && !p.isBot);
  const allAlive  = Object.values(players).filter(p => p.alive);
  if (realAlive.length === 0) return; // no real players, don't end
  if (allAlive.length <= 1) io.emit('gameOver', { winner: allAlive[0]?.id || null });
}

// ---- Bots ----
function createBots() {
  for (let i = 0; i < BOT_COUNT; i++) {
    const id  = `bot_${i}`;
    const a   = Math.random() * Math.PI * 2;
    const d   = 500 + Math.random() * 1200;
    const gun = GUN_TYPES[Math.floor(Math.random() * GUN_TYPES.length)];
    players[id] = {
      id, isBot: true, alive: true, kills: 0,
      x: Math.max(100, Math.min(WORLD-100, WORLD/2 + Math.cos(a)*d)),
      y: Math.max(100, Math.min(WORLD-100, WORLD/2 + Math.sin(a)*d)),
      vx: 0, vy: 0, angle: 0,
      hp: 100, maxHp: 100, shield: 0, maxShield: 100,
      r: 18, flash: 0,
      slots: [{ type: gun }], slotIndex: 0,
      wood: 0, brick: 0,
      color: BOT_COLORS[i % BOT_COLORS.length],
      aiState: 'wander', aiTimer: 0,
      aiDir: Math.random() * Math.PI * 2, cd: 0,
    };
  }
}

function tickBots() {
  for (const id in players) {
    const b = players[id];
    if (!b.isBot || !b.alive) continue;
    b.aiTimer++;
    if (b.cd > 0) b.cd--;

    // Find nearest real player
    let target = null, targetDist = Infinity;
    for (const pid in players) {
      const p = players[pid];
      if (p.isBot || !p.alive) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < targetDist) { targetDist = d; target = p; }
    }

    // Storm avoidance
    if (Math.hypot(b.x - storm.cx, b.y - storm.cy) > storm.r - 80) {
      const a = Math.atan2(storm.cy - b.y, storm.cx - b.x);
      b.vx += Math.cos(a) * 0.5; b.vy += Math.sin(a) * 0.5;
    }

    // State machine
    if (target && targetDist < 320)       b.aiState = 'attack';
    else if (targetDist > 500)            b.aiState = 'wander';

    if (b.aiState === 'wander') {
      if (b.aiTimer % 120 === 0) b.aiDir = Math.random() * Math.PI * 2;
      b.vx += Math.cos(b.aiDir) * 0.15;
      b.vy += Math.sin(b.aiDir) * 0.15;
    } else if (b.aiState === 'attack' && target) {
      b.angle = Math.atan2(target.y - b.y, target.x - b.x);
      if (targetDist > 260) {
        b.vx += Math.cos(b.angle) * 0.18; b.vy += Math.sin(b.angle) * 0.18;
      } else {
        const strafe = (Math.floor(b.aiTimer / 60) % 2 === 0) ? 1 : -1;
        b.vx += Math.cos(b.angle + Math.PI/2) * 0.12 * strafe;
        b.vy += Math.sin(b.angle + Math.PI/2) * 0.12 * strafe;
      }
      // Fire
      if (b.cd === 0 && targetDist < 320) {
        const w   = WEAPONS[b.slots[0].type];
        const aim = b.angle + (Math.random() - 0.5) * 0.18;
        b.cd = w.cd;
        // Visual bullet for clients
        io.emit('remoteBullet', {
          ownerId: id,
          x: b.x + Math.cos(aim) * 22, y: b.y + Math.sin(aim) * 22,
          vx: Math.cos(aim) * w.speed,  vy: Math.sin(aim) * w.speed,
          dmg: w.dmg, range: w.range, color: w.color
        });
        // Damage only if roughly on target (simulate spread)
        if (Math.abs(aim - b.angle) < 0.12) {
          applyDamage(target.id, id, w.dmg);
          io.to(target.id).emit('takeDamage', { amount: w.dmg, attackerId: id });
        }
      }
    }

    b.vx *= FRICTION; b.vy *= FRICTION;
    b.x = Math.max(18, Math.min(WORLD - 18, b.x + b.vx));
    b.y = Math.max(18, Math.min(WORLD - 18, b.y + b.vy));
  }
}

// 60 fps server loop
setInterval(() => {
  if (!gameActive) return;
  tick++;
  tickStorm();
  tickBots();

  // Storm damage every ~0.5s
  if (tick % 30 === 0) {
    const dmg = storm.phase < 2 ? 3 : storm.phase < 4 ? 6 : 10;
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      if (Math.hypot(p.x - storm.cx, p.y - storm.cy) > storm.r) {
        applyDamage(id, null, dmg);
        if (!p.isBot) io.to(id).emit('stormDamage', dmg);
      }
    }
  }

  // Broadcast storm + bot positions at 10 fps
  if (tick % 6 === 0) {
    io.emit('stormSync', storm);
    for (const id in players) {
      const b = players[id];
      if (!b.isBot) continue;
      io.emit('playerMoved', { id, x: b.x, y: b.y, angle: b.angle, hp: b.hp, maxHp: 100, shield: b.shield, alive: b.alive, slots: b.slots, slotIndex: b.slotIndex, color: b.color, r: 18, isBot: true });
    }
  }
}, 1000 / 60);

// ---- Socket events ----
io.on('connection', (socket) => {
  const id = socket.id;

  socket.on('joinGame', () => {
    const a = Math.random() * Math.PI * 2;
    const d = 100 + Math.random() * 300;
    players[id] = {
      id, alive: true, kills: 0,
      x: WORLD/2 + Math.cos(a) * d,
      y: WORLD/2 + Math.sin(a) * d,
      angle: 0, hp: 100, shield: 0,
      slots: [{ type: 'pickaxe' }, null, null], slotIndex: 0,
      wood: 0, brick: 0,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]
    };
    // Create bots on first join
    const hasRealPlayers = Object.values(players).filter(p => !p.isBot).length;
    if (hasRealPlayers === 1) createBots();
    gameActive = true;
    socket.emit('welcome', { id, players, storm, mapSeed });
    socket.broadcast.emit('playerJoined', players[id]);
    broadcastAlive();
  });

  socket.on('playerUpdate', (data) => {
    if (players[id]) Object.assign(players[id], data);
    socket.broadcast.emit('playerMoved', { id, ...data });
  });

  socket.on('shoot', (data) => {
    socket.broadcast.emit('remoteBullet', { ownerId: id, ...data });
  });

  socket.on('hitPlayer', ({ targetId, damage }) => {
    if (!players[targetId]?.alive) return;
    applyDamage(targetId, id, damage);
    io.to(targetId).emit('takeDamage', { amount: damage, attackerId: id });
  });

  socket.on('wallBuild', (data) => {
    io.emit('wallBuilt', { ownerId: id, ...data });
  });

  socket.on('chestOpen', (pos) => {
    io.emit('chestOpened', pos);
  });

  socket.on('disconnect', () => {
    delete players[id];
    io.emit('playerLeft', id);
    broadcastAlive();
    checkWin();
    const realLeft = Object.values(players).filter(p => !p.isBot).length;
    if (realLeft === 0) {
      // Remove bots and reset
      for (const pid in players) if (players[pid].isBot) delete players[pid];
      gameActive = false; tick = 0;
      storm = { cx: WORLD/2, cy: WORLD/2, r: 2400, targetR: 2400, phase: 0, timer: 0, shrinkStart: 600, shrinkTime: 800, warnTime: 180 };
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DROP ZONE server → http://localhost:${PORT}`));
