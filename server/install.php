<?php
/**
 * 一次性建表脚本。
 *
 * 用法：先在 config.local.php 里设置 install_token，然后浏览器访问
 *   https://aknoi.page.gd/install.php?token=你的令牌
 * 建完表后建议直接删掉这个文件。
 *
 * 新结构：
 *   - aknoi_users     账号表（用户名 + 密码哈希）
 *   - aknoi_scores    周榜成绩表，每个账号每周只保留最好的一行
 *   - aknoi_alltime   总榜成绩表，每个账号只保留历史最好成绩的一行
 *
 * 如果发现旧版成绩表（按名字记多条记录那种），会先改名备份成
 * aknoi_scores_legacy_<时间戳>，再建新表，不会丢数据。
 *
 * 已有周榜数据时会把每个账号的最好成绩回填进总榜（只在总榜为空时做）。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

header('Content-Type: text/plain; charset=utf-8');

$expected = (string) cfg('install_token', '');
$given = isset($_GET['token']) ? (string) $_GET['token'] : '';

if ($expected === '') {
    http_response_code(403);
    echo "install_token 尚未配置。请先在 config.local.php 里设置一个随机令牌。\n";
    exit;
}

if (!hash_equals($expected, $given)) {
    http_response_code(403);
    echo "令牌不正确。\n";
    exit;
}

$table = scores_table();
$usersTable = users_table();
$alltimeTable = alltime_table();

try {
    // 旧版成绩表（有 name 列、没有 user_id 列）先改名备份。
    $oldRow = $db->query(
        'SELECT COUNT(*) AS n FROM information_schema.COLUMNS'
        . ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [$table, 'name']
    )->fetch();
    $newRow = $db->query(
        'SELECT COUNT(*) AS n FROM information_schema.COLUMNS'
        . ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [$table, 'user_id']
    )->fetch();

    if ((int) ($oldRow['n'] ?? 0) > 0 && (int) ($newRow['n'] ?? 0) === 0) {
        $backup = $table . '_legacy_' . date('Ymd_His');
        $db->query('RENAME TABLE `' . $table . '` TO `' . $backup . '`');
        echo "发现旧版成绩表，已改名备份为 `{$backup}`（旧数据保留，不会自动迁移账号）。\n\n";
    }

    $db->query("CREATE TABLE IF NOT EXISTS `{$usersTable}` (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        username   VARCHAR(24)  NOT NULL,
        pass_hash  VARCHAR(255) NOT NULL,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    echo "账号表 `{$usersTable}` 已就绪。\n\n";

    $db->query("CREATE TABLE IF NOT EXISTS `{$table}` (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id      INT UNSIGNED NOT NULL,
        week_key     CHAR(8)      NOT NULL,
        seed         VARCHAR(32)  NOT NULL,
        score        DECIMAL(5,1) NOT NULL DEFAULT 0.0,
        moves        INT UNSIGNED NOT NULL DEFAULT 0,
        action_count INT UNSIGNED NOT NULL DEFAULT 0,
        actions      MEDIUMTEXT   NOT NULL,
        replay_hash  CHAR(64)     NOT NULL,
        ip_hash      CHAR(64)     NOT NULL DEFAULT '',
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_user_week (user_id, week_key),
        UNIQUE KEY uniq_replay (replay_hash),
        KEY idx_week (week_key, seed, score DESC, moves ASC, id ASC),
        KEY idx_rate (ip_hash, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    echo "周榜表 `{$table}` 已就绪（每周每账号最多一行，只存最好成绩）。\n\n";

    $db->query("CREATE TABLE IF NOT EXISTS `{$alltimeTable}` (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id      INT UNSIGNED NOT NULL,
        seed         VARCHAR(32)  NOT NULL,
        score        DECIMAL(5,1) NOT NULL DEFAULT 0.0,
        moves        INT UNSIGNED NOT NULL DEFAULT 0,
        action_count INT UNSIGNED NOT NULL DEFAULT 0,
        actions      MEDIUMTEXT   NOT NULL,
        replay_hash  CHAR(64)     NOT NULL,
        ip_hash      CHAR(64)     NOT NULL DEFAULT '',
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_user (user_id),
        UNIQUE KEY uniq_replay (replay_hash),
        KEY idx_score (score DESC, moves ASC, id ASC),
        KEY idx_rate (ip_hash, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    echo "总榜表 `{$alltimeTable}` 已就绪（每账号一行，只存历史最好成绩）。\n\n";

    // 回填总榜：总榜为空但周榜已有数据时，把每个账号的最好成绩抄过去。
    // 不用 GROUP BY（MySQL 5.7 的 ONLY_FULL_GROUP_BY），用 NOT EXISTS 挑出
    // “没有任何更高分同行”的那一行，即每个账号的当前最好成绩。
    $alltimeCount = (int) ($db->query('SELECT COUNT(*) AS n FROM `' . $alltimeTable . '`')->fetch()['n'] ?? 0);
    $weeklyCount = (int) ($db->query('SELECT COUNT(*) AS n FROM `' . $table . '`')->fetch()['n'] ?? 0);
    if ($alltimeCount === 0 && $weeklyCount > 0) {
        $db->query(
            'INSERT INTO `' . $alltimeTable . '`'
            . ' (user_id, seed, score, moves, action_count, actions, replay_hash, ip_hash, created_at)'
            . ' SELECT s.user_id, s.seed, s.score, s.moves, s.action_count, s.actions,'
            . ' s.replay_hash, s.ip_hash, s.created_at'
            . ' FROM `' . $table . '` s'
            . ' LEFT JOIN `' . $table . '` s2 ON s2.user_id = s.user_id'
            . '   AND (s2.score > s.score OR (s2.score = s.score AND s2.id < s.id))'
            . ' WHERE s2.id IS NULL'
        );
        echo "已将周榜里每个账号的最好成绩回填进总榜（" . $weeklyCount . " 条周榜记录）。\n\n";
    }

    $rows = $db->query('DESCRIBE `' . $table . '`')->fetchAll();
    foreach ($rows as $row) {
        echo str_pad((string) $row['Field'], 14)
            . str_pad((string) $row['Type'], 20)
            . (string) $row['Key'] . "\n";
    }

    echo "\n建表完成，请删除 install.php。\n";
} catch (PDOException $exception) {
    http_response_code(500);
    echo "建表失败：" . $exception->getMessage() . "\n";
}
