<?php
/**
 * AKNOI 排行榜默认配置。
 *
 * 部署时不要改这个文件：复制一份为 config.local.php 再改。
 * lib.php 会用 config.local.php 返回的数组覆盖下面的默认值：
 *
 *   <?php
 *   return [
 *       'install_token' => '一串随机字符串',
 *       'ip_salt'       => '另一串随机字符串',
 *   ];
 */

declare(strict_types=1);

$defaults = [
    // 数据表名。install.php 会按这个名字建表。
    'table' => 'aknoi_scores',

    // 账号表名。
    'users_table' => 'aknoi_users',

    // 总榜表名：每个账号一行，只存历史最好成绩。
    'alltime_table' => 'aknoi_alltime',

    // 访问 install.php 时必须带上的令牌：install.php?token=xxx
    // 保持为空字符串时 install.php 会直接拒绝执行。
    'install_token' => '',

    // 用来给 IP 加盐哈希，避免数据库里存明文 IP。随便一串长随机字符串即可。
    'ip_salt' => '',

    // 单局最高分（六题 × 100）。超过这个分数的提交一律拒绝。
    'max_score' => 600.0,

    // 一局最多允许多少个操作，防止有人塞一个几百万步的回放把服务器算到超时。
    'max_actions' => 20000,

    // 用户名长度（按字符数计，中文算 1 个）。
    'max_username_length' => 24,

    // 密码长度范围（按字节计；bcrypt 只取前 72 字节，所以上限设为 72）。
    'min_password_length' => 6,
    'max_password_length' => 72,

    // 限流：同一 IP 在 rate_window 秒内最多上传 rate_limit 次。
    'rate_window' => 600,
    'rate_limit' => 12,

    // 上传的 .dat 文件大小上限（字节）。
    'max_body_bytes' => 262144,

    // 排行榜单页最多返回多少条。
    'max_page_size' => 100,

    // 笔试分。库里存的是上机分，展示时统一加上这个数（满分 600 + 105 = 705）。
    'written_exam_score' => 105,

    // 周榜的时区。周一到周日按这个时区划分，每周一 00:00 换榜。
    'timezone' => 'Asia/Shanghai',

    // 周榜限定的“本周种子”。留空时自动按 ISO 周生成
    // （形如 AKNOI-2026-W33，每周一自动换一个）。
    // 想手动指定就在 config.local.php 里覆盖，例如 'weekly_seed' => 'SEED2026A'。
    'weekly_seed' => '',
];

return $defaults;
