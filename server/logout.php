<?php
/**
 * 退出登录。
 *
 * 导航里的「退出」链接带上了 CSRF 令牌，这里校验通过才销毁 session。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

if (!csrf_valid((string) ($_GET['csrf'] ?? ''))) {
    header('Location: ./');
    exit;
}

if (session_status() !== PHP_SESSION_ACTIVE) {
    @session_start();
}
unset($_SESSION['aknoi_user_id']);

header('Location: ./');
exit;
