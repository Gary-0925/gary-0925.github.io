<?php
/**
 * GET /api/replay.php?id=123
 *
 * 取回某条成绩的完整操作序列，前端可以用 replayGame(seed, actions) 复现这一局。
 * 返回 { ok:true, entry:{ id, name, seed, score, moves, durationMs, createdAt, actions } }
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

send_cors_headers('GET');
require_method('GET');

$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
if ($id <= 0) {
    fail(422, 'bad_id', '缺少合法的 id 参数。');
}

$table = scores_table();

try {
    $row = $db->query(
        'SELECT id, player_name, seed, score, moves, duration_ms, actions, created_at'
        . ' FROM `' . $table . '` WHERE id = ? LIMIT 1',
        [$id]
    )->fetch();

    if ($row === false) {
        fail(404, 'not_found', '没有找到这条成绩。');
    }

    $actions = json_decode((string) $row['actions'], true);
    if (!is_array($actions)) {
        $actions = [];
    }

    respond(200, [
        'ok' => true,
        'entry' => [
            'id' => (int) $row['id'],
            'name' => (string) $row['player_name'],
            'seed' => (string) $row['seed'],
            'score' => round((float) $row['score'], 1),
            'moves' => (int) $row['moves'],
            'durationMs' => (int) $row['duration_ms'],
            'createdAt' => (string) $row['created_at'],
            'actions' => $actions,
        ],
    ]);
} catch (PDOException $exception) {
    error_log('[aknoi] replay failed: ' . $exception->getMessage());
    fail(500, 'server_error', '读取回放时出错，请稍后再试。');
}
