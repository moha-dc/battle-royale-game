<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

define('WORLD', 4000);
define('STATE_FILE', __DIR__ . '/gamestate.json');
define('LOCK_FILE',  __DIR__ . '/gamestate.lock');

function defaultState() {
    return [
        'players'      => [],
        'openedChests' => [],
        'mapSeed'      => rand(1, 999999999),
        'storm' => [
            'cx' => WORLD/2, 'cy' => WORLD/2,
            'r' => 2400, 'targetR' => 2400,
            'phase' => 0, 'timer' => 0,
            'shrinkStart' => 600, 'shrinkTime' => 800,
            'lastDamage' => 0, 'lastUpdate' => microtime(true)
        ]
    ];
}

function readState() {
    if (!file_exists(STATE_FILE)) return defaultState();
    $d = @file_get_contents(STATE_FILE);
    return $d ? (json_decode($d, true) ?: defaultState()) : defaultState();
}

function writeState($s) {
    file_put_contents(STATE_FILE, json_encode($s));
}

function stormAngle($seed, $idx) {
    $s = abs(($seed + $idx * 123456) % 2147483647) ?: 1;
    return (($s * 16807 % 2147483647) / 2147483647.0) * M_PI * 2;
}

function tickStorm(&$storm, $seed) {
    $s = &$storm;
    $s['timer']++;
    if ($s['phase'] === 0 && $s['timer'] > $s['shrinkStart']) {
        $s['phase'] = 1; $s['timer'] = 0;
        $s['targetR'] = max($s['r'] * 0.55, 300);
        $a = stormAngle($seed, 0);
        $s['cx'] = max(400, min(WORLD-400, $s['cx'] + cos($a)*200));
        $s['cy'] = max(400, min(WORLD-400, $s['cy'] + sin($a)*200));
    } elseif ($s['phase'] === 1 && $s['timer'] > $s['shrinkTime']) {
        $s['phase'] = 2; $s['timer'] = 0; $s['shrinkStart'] = 500;
    } elseif ($s['phase'] === 2 && $s['timer'] > $s['shrinkStart']) {
        $s['phase'] = 3; $s['timer'] = 0;
        $s['targetR'] = max($s['r'] * 0.5, 150);
        $a = stormAngle($seed, 1);
        $s['cx'] = max(300, min(WORLD-300, $s['cx'] + cos($a)*100));
        $s['cy'] = max(300, min(WORLD-300, $s['cy'] + sin($a)*100));
    } elseif ($s['phase'] === 3 && $s['timer'] > $s['shrinkTime']) {
        $s['phase'] = 4; $s['timer'] = 0; $s['shrinkStart'] = 400;
    } elseif ($s['phase'] === 4 && $s['timer'] > $s['shrinkStart']) {
        $s['phase'] = 5; $s['timer'] = 0; $s['targetR'] = 80;
    }
    if ($s['r'] > $s['targetR']) { $s['r'] -= 0.6; if ($s['r'] < $s['targetR']) $s['r'] = $s['targetR']; }
}

function updateStorm(&$state) {
    $now   = microtime(true);
    $ticks = min(600, intval(($now - $state['storm']['lastUpdate']) * 60));
    for ($i = 0; $i < $ticks; $i++) tickStorm($state['storm'], $state['mapSeed']);
    $state['storm']['lastUpdate'] = $now;
}

function stormDamage(&$state) {
    $now = microtime(true);
    if ($now - $state['storm']['lastDamage'] < 0.5) return;
    $state['storm']['lastDamage'] = $now;
    $s   = $state['storm'];
    $dmg = $s['phase'] < 2 ? 3 : ($s['phase'] < 4 ? 6 : 10);
    foreach ($state['players'] as $id => &$p) {
        if (!$p['alive']) continue;
        if (sqrt(pow($p['x']-$s['cx'],2)+pow($p['y']-$s['cy'],2)) > $s['r'])
            applyDmg($state['players'], $id, null, $dmg);
    }
}

function applyDmg(&$players, $tid, $kid, $dmg) {
    $t = &$players[$tid];
    if (!$t || !$t['alive']) return;
    if ($t['shield'] > 0) { $a = min($t['shield'],$dmg); $t['shield'] -= $a; $dmg -= $a; }
    $t['hp'] = max(0, $t['hp'] - $dmg);
    if ($t['hp'] <= 0 && $t['alive']) {
        $t['alive'] = false;
        if ($kid && isset($players[$kid])) $players[$kid]['kills']++;
    }
}

// ---- Main ----
$lock = fopen(LOCK_FILE, 'c');
flock($lock, LOCK_EX);
$state = readState();
$now   = time();
$body  = json_decode(file_get_contents('php://input'), true) ?? [];

// Purge inactive players (8s timeout)
foreach ($state['players'] as $id => $p)
    if ($now - ($p['lastSeen'] ?? 0) > 8) unset($state['players'][$id]);

// Advance storm & apply storm damage if anyone is playing
if (!empty($state['players'])) { updateStorm($state); stormDamage($state); }

$alive = count(array_filter($state['players'], fn($p) => $p['alive']));
$COLORS = ['#52cfff','#ff8c4b','#c155ff','#5dffac','#ff5cd5','#ff5252'];

switch ($body['action'] ?? '') {

    case 'join':
        $id = uniqid('p', true);
        $a  = mt_rand(0, 628) / 100.0;
        $d  = mt_rand(100, 300);
        $state['players'][$id] = [
            'id'=>$id, 'alive'=>true, 'kills'=>0,
            'x'=>WORLD/2+cos($a)*$d, 'y'=>WORLD/2+sin($a)*$d,
            'angle'=>0, 'hp'=>100, 'shield'=>0,
            'slots'=>[['type'=>'pickaxe'],null,null], 'slotIndex'=>0,
            'wood'=>0, 'brick'=>0,
            'color'=>$COLORS[array_rand($COLORS)],
            'lastSeen'=>$now
        ];
        writeState($state);
        flock($lock, LOCK_UN); fclose($lock);
        echo json_encode(['id'=>$id, 'player'=>$state['players'][$id], 'mapSeed'=>$state['mapSeed']]);
        break;

    case 'sync':
        $id = $body['id'] ?? '';
        if ($id && isset($state['players'][$id])) {
            $p = $body['player'] ?? [];
            foreach (['x','y','angle','hp','shield','alive','slots','slotIndex','wood','brick'] as $k)
                if (isset($p[$k])) $state['players'][$id][$k] = $p[$k];
            $state['players'][$id]['lastSeen'] = $now;
        }
        $alive = count(array_filter($state['players'], fn($p) => $p['alive']));
        writeState($state);
        flock($lock, LOCK_UN); fclose($lock);
        echo json_encode([
            'players'      => $state['players'],
            'storm'        => $state['storm'],
            'openedChests' => $state['openedChests'],
            'alive'        => $alive,
            'me'           => ($id && isset($state['players'][$id])) ? $state['players'][$id] : null
        ]);
        break;

    case 'hit':
        $tid = $body['targetId']  ?? '';
        $kid = $body['attackerId']?? '';
        $dmg = min(100, max(0, intval($body['damage'] ?? 0)));
        if ($tid && isset($state['players'][$tid]))
            applyDmg($state['players'], $tid, $kid, $dmg);
        $alive = count(array_filter($state['players'], fn($p) => $p['alive']));
        writeState($state);
        flock($lock, LOCK_UN); fclose($lock);
        echo json_encode(['ok'=>true,'alive'=>$alive,'targetAlive'=>$state['players'][$tid]['alive']??false]);
        break;

    case 'openChest':
        $idx = intval($body['index'] ?? -1);
        if ($idx >= 0 && !in_array($idx, $state['openedChests']))
            $state['openedChests'][] = $idx;
        writeState($state);
        flock($lock, LOCK_UN); fclose($lock);
        echo json_encode(['ok'=>true]);
        break;

    case 'leave':
        $id = $body['id'] ?? '';
        if ($id) unset($state['players'][$id]);
        if (empty($state['players'])) $state = defaultState();
        writeState($state);
        flock($lock, LOCK_UN); fclose($lock);
        echo json_encode(['ok'=>true]);
        break;

    default:
        flock($lock, LOCK_UN); fclose($lock);
        echo json_encode(['error'=>'unknown action']);
}
?>
