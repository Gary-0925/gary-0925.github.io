<?php
/**
 * POST /api/submit.php
 *
 * 提交一局成绩。请求体：
 * {
 *   "name": "玩家昵称",
 *   "seed": "K3X9ZQ1",
 *   "score": 428.6,
 *   "durationMs": 512340,
 *   "actions": [ {"type":"move","direction":"left"}, {"type":"submit","boardId":"problem-D1T2"} ]
 * }
 *
 * 成功返回 { ok:true, id, rank, best, duplicate }。
 * 同一份回放（种子 + 操作序列完全一致）重复提交不会产生新记录，
 * 而是返回已存在的那条，duplicate = true。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

send_cors_headers('POST');
require_method('POST');

$body = read_json_body();
$entry = validate_submission($body);

$table = scores_table();
$fingerprint = replay_fingerprint($entry['seed'], $entry['actions']);

try {
    enforce_rate_limit($db);

    // 已存在同一份回放：直接返回原记录，不重复计分。
    $existing = $db->query(
        'SELECT id, score FROM `' . $table . '` WHERE replay_hash = ? LIMIT 1',
        [$fingerprint]
    )->fetch();

    if ($existing !== false) {
        $id = (int) $existing['id'];
        $score = (float) $existing['score'];
        $duplicate = true;
    } else {
        $db->query(
            'INSERT INTO `' . $table . '`'
            . ' (player_name, seed, score, moves, duration_ms, actions, replay_hash, ip_hash, created_at)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $entry['name'],
                $entry['seed'],
                $entry['score'],
                $entry['moves'],
                $entry['duration_ms'],
                json_encode($entry['actions'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                $fingerprint,
                client_ip_hash(),
            ]
        );
        $id = (int) $db->handle->lastInsertId();
        $score = $entry['score'];
        $duplicate = false;
    }

    // 名次：分数更高的有几条，再加一。并列取同一名次。
    $rankRow = $db->query(
        'SELECT COUNT(*) + 1 AS rank_position FROM `' . $table . '` WHERE score > ?',
        [$score]
    )->fetch();

    // 这个昵称的历史最好成绩。
    $bestRow = $db->query(
        'SELECT MAX(score) AS best FROM `' . $table . '` WHERE player_name = ?',
        [$entry['name']]
    )->fetch();

    respond(201, [
        'ok' => true,
        'id' => $id,
        'score' => round($score, 1),
        'moves' => $entry['moves'],
        'rank' => (int) ($rankRow['rank_position'] ?? 0),
        'best' => isset($bestRow['best']) ? round((float) $bestRow['best'], 1) : round($score, 1),
        'duplicate' => $duplicate,
    ]);
} catch (PDOException $exception) {
    // 唯一索引撞车（并发下两个请求同时插入同一份回放）。
    if ($exception->getCode() === '23000') {
        $row = $db->query(
            'SELECT id, score FROM `' . $table . '` WHERE replay_hash = ? LIMIT 1',
            [$fingerprint]
        )->fetch();
        if ($row !== false) {
            respond(200, [
                'ok' => true,
                'id' => (int) $row['id'],
                'score' => round((float) $row['score'], 1),
                'moves' => $entry['moves'],
                'rank' => 0,
                'best' => round((float) $row['score'], 1),
                'duplicate' => true,
            ]);
        }
    }
    error_log('[aknoi] submit failed: ' . $exception->getMessage());
    fail(500, 'server_error', '保存成绩时出错，请稍后再试。');
}
