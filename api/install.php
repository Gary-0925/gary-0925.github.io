<?php
/**
 * 一次性建表脚本。
 *
 * 用法：先在 api/config.local.php 里设置 install_token，然后浏览器访问
 *   https://aknoi.page.gd/api/install.php?token=你的令牌
 * 建完表后建议直接删掉这个文件。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

header('Content-Type: text/plain; charset=utf-8');

$expected = (string) cfg('install_token', '');
$given = isset($_GET['token']) ? (string) $_GET['token'] : '';

if ($expected === '') {
    http_response_code(403);
    echo "install_token 尚未配置。请先在 api/config.local.php 里设置一个随机令牌。\n";
    exit;
}

if (!hash_equals($expected, $given)) {
    http_response_code(403);
    echo "令牌不正确。\n";
    exit;
}

$table = scores_table();

$sql = <<<SQL
CREATE TABLE IF NOT EXISTS `{$table}` (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name         VARCHAR(32)      NOT NULL,
    seed         VARCHAR(32)      NOT NULL,
    score        DECIMAL(5,1)     NOT NULL DEFAULT 0.0,
    moves        INT UNSIGNED     NOT NULL DEFAULT 0,
    action_count INT UNSIGNED     NOT NULL DEFAULT 0,
    actions      MEDIUMTEXT       NOT NULL,
    replay_hash  CHAR(64)         NOT NULL,
    ip_hash      CHAR(64)         NOT NULL DEFAULT '',
    created_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_replay (replay_hash),
    KEY idx_board (score DESC, moves ASC, id ASC),
    KEY idx_seed (seed, score DESC),
    KEY idx_name (name, score DESC),
    KEY idx_rate (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL;

try {
    $db->query($sql);
    echo "表 `{$table}` 已就绪。\n\n";

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
