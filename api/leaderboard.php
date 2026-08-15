<?php
/**
 * GET /api/leaderboard.php
 *
 * 查询参数：
 *   limit   每页条数，1–100，默认 20
 *   offset  偏移量，默认 0
 *   seed    只看某个种子的榜单（可选）
 *   scope   all（默认，每条记录一行）| players（同一昵称只保留其最好成绩）
 *   name    查这个昵称的名次和最好成绩（可选）
 *
 * 返回 { ok:true, total, limit, offset, entries:[...], me:{...}|null }
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

send_cors_headers('GET');
require_method('GET');

$maxPageSize = (int) cfg('max_page_size', 100);

// 分页参数必须先转成 int 再拼进 SQL：db.php 关掉了 EMULATE_PREPARES，
// LIMIT/OFFSET 用占位符会被当成字符串而报语法错。
$limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 20;
$limit = max(1, min($maxPageSize, $limit));

$offset = isset($_GET['offset']) ? (int) $_GET['offset'] : 0;
$offset = max(0, min(1000000, $offset));

$scope = ($_GET['scope'] ?? 'all') === 'players' ? 'players' : 'all';

$seed = isset($_GET['seed']) ? trim((string) $_GET['seed']) : '';
if ($seed !== '' && preg_match('/^[A-Za-z0-9_-]{1,32}$/', $seed) !== 1) {
    fail(422, 'bad_seed', '种子参数不合法。');
}

$name = isset($_GET['name']) ? clean_name((string) $_GET['name']) : '';
if (mb_strlen($name, 'UTF-8') > (int) cfg('max_name_length', 24)) {
    $name = '';
}

$table = scores_table();

try {
    $where = '';
    $params = [];
    if ($seed !== '') {
        $where = ' WHERE seed = ?';
        $params[] = $seed;
    }

    if ($scope === 'players') {
        // 每个昵称只保留最好的一条。这里用 NOT EXISTS 而不是 GROUP BY，
        // 因为 MySQL 5.7+ 默认开着 ONLY_FULL_GROUP_BY，
        // 「GROUP BY 昵称却又 SELECT 其它列」会直接报错。
        // 条件读作：不存在同名玩家的另一条成绩比这条更好（分数更高，
        // 或分数相同但 id 更小），于是每个昵称恰好命中一行。
        $totalSql = 'SELECT COUNT(DISTINCT player_name) AS total FROM `' . $table . '`' . $where;

        $seedFilter = $seed !== '' ? ' AND x.seed = ?' : '';
        $listSql =
            'SELECT s.id, s.player_name, s.seed, s.score, s.moves, s.duration_ms, s.created_at'
            . ' FROM `' . $table . '` AS s'
            . ' WHERE ' . ($seed !== '' ? 's.seed = ? AND ' : '')
            . 'NOT EXISTS ('
            . '   SELECT 1 FROM `' . $table . '` AS x'
            . '   WHERE x.player_name = s.player_name' . $seedFilter
            . '     AND (x.score > s.score OR (x.score = s.score AND x.id < s.id))'
            . ' )'
            . ' ORDER BY s.score DESC, s.moves ASC, s.created_at ASC'
            . ' LIMIT ' . $limit . ' OFFSET ' . $offset;

        // seed 在外层和子查询各出现一次，参数要给两份。
        $listParams = array_merge($params, $params);
    } else {
        $totalSql = 'SELECT COUNT(*) AS total FROM `' . $table . '`' . $where;

        $listSql =
            'SELECT id, player_name, seed, score, moves, duration_ms, created_at'
            . ' FROM `' . $table . '`' . $where
            . ' ORDER BY score DESC, moves ASC, created_at ASC'
            . ' LIMIT ' . $limit . ' OFFSET ' . $offset;

        $listParams = $params;
    }

    $totalRow = $db->query($totalSql, $params)->fetch();
    $total = (int) ($totalRow['total'] ?? 0);

    $rows = $db->query($listSql, $listParams)->fetchAll();

    $entries = [];
    foreach ($rows as $index => $row) {
        $entries[] = [
            'rank' => $offset + $index + 1,
            'id' => (int) $row['id'],
            'name' => (string) $row['player_name'],
            'seed' => (string) $row['seed'],
            'score' => round((float) $row['score'], 1),
            'moves' => (int) $row['moves'],
            'durationMs' => (int) $row['duration_ms'],
            'createdAt' => (string) $row['created_at'],
        ];
    }

    $me = null;
    if ($name !== '') {
        $meRow = $db->query(
            'SELECT MAX(score) AS best FROM `' . $table . '` WHERE player_name = ?',
            [$name]
        )->fetch();

        if ($meRow !== false && $meRow['best'] !== null) {
            $best = round((float) $meRow['best'], 1);
            $rankRow = $db->query(
                'SELECT COUNT(*) + 1 AS rank_position FROM `' . $table . '` WHERE score > ?',
                [$best]
            )->fetch();
            $me = [
                'name' => $name,
                'best' => $best,
                'rank' => (int) ($rankRow['rank_position'] ?? 0),
            ];
        }
    }

    respond(200, [
        'ok' => true,
        'scope' => $scope,
        'seed' => $seed !== '' ? $seed : null,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
        'entries' => $entries,
        'me' => $me,
    ]);
} catch (PDOException $exception) {
    error_log('[aknoi] leaderboard failed: ' . $exception->getMessage());
    fail(500, 'server_error', '读取排行榜时出错，请稍后再试。');
}
