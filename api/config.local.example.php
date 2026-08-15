<?php
/**
 * 把这个文件复制成 api/config.local.php，填上自己的随机串。
 * config.local.php 已经在 .gitignore 里，不会被提交。
 *
 * 生成随机串（任选其一）：
 *   php -r "echo bin2hex(random_bytes(24));"
 *   在浏览器控制台：crypto.randomUUID()
 */

declare(strict_types=1);

return [
    // 访问 install.php 建表时要带的令牌。
    'install_token' => '换成一串长随机字符串',

    // IP 哈希的盐。设定后不要再改，否则限流计数会重新开始。
    'ip_salt' => '换成另一串长随机字符串',

    // 如果你的前端域名不同，在这里补上。
    // 'allowed_origins' => ['https://aknoi.page.gd', 'https://gary-0925.github.io'],
];
