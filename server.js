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
const COLORS = ['#52cfff', '#ff8c4b', '#c155ff', '#5dffac', '#ff5cd5', '#ff5252'];
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
  const alive = Object.values(players).filter(p => p.alive);
  if (alive.length <= 1) io.emit('gameOver', { winner: alive[0]?.id || null });
}

// 60 fps server loop
setInterval(() => {
  if (!gameActive) return;
  tick++;
  tickStorm();

  // Storm damage every ~0.5s
  if (tick % 30 === 0) {
    const dmg = storm.phase < 2 ? 3 : storm.phase < 4 ? 6 : 10;
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      if (Math.hypot(p.x - storm.cx, p.y - storm.cy) > storm.r) {
        applyDamage(id, null, dmg);
        io.to(id).emit('stormDamage', dmg);
      }
    }
  }

  // Broadcast storm at 10 fps
  if (tick % 6 === 0) io.emit('stormSync', storm);
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
    if (Object.keys(players).length === 0) {
      gameActive = false; tick = 0;
      storm = { cx: WORLD/2, cy: WORLD/2, r: 2400, targetR: 2400, phase: 0, timer: 0, shrinkStart: 600, shrinkTime: 800, warnTime: 180 };
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DROP ZONE server → http://localhost:${PORT}`));
