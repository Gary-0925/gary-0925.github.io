<?php
/**
 * 登录页。
 *
 * 登录后把 aknoi_user_id 写进 session。next 参数登录成功后跳回原页面。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

// 已登录就直接跳走。
if (current_user($db) !== null) {
    header('Location: ./');
    exit;
}

$next = trim((string) ($_GET['next'] ?? ''));
if ($next === '' || preg_match('#^[A-Za-z0-9_./?=&%-]+$#', $next) !== 1) {
    $next = './';
}

$message = null;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    try {
        if (!csrf_valid((string) ($_POST['csrf'] ?? ''))) {
            throw new RuntimeException('表单已过期，请刷新页面后重新登录。');
        }

        login_user($db, (string) ($_POST['username'] ?? ''), (string) ($_POST['password'] ?? ''));

        header('Location: ' . $next);
        exit;
    } catch (RuntimeException $error) {
        $message = ['bad', $error->getMessage()];
    } catch (Throwable $error) {
        error_log('[aknoi] login failed: ' . $error->getMessage());
        $message = ['bad', '服务器出了点问题，请稍后再试。'];
    }
}

$token = csrf_token();

ob_start();
?>
<h1>登录</h1>
<p class="sub">登录后才能上传成绩。还没有账号？<a href="register.php">先注册一个</a>。</p>

<?php if ($message !== null): ?>
<div class="msg <?= e($message[0]) ?>"><?= $message[1] ?></div>
<?php endif; ?>

<form class="card" method="post">
  <input type="hidden" name="csrf" value="<?= e($token) ?>">
  <label for="username">用户名</label>
  <input type="text" id="username" name="username" maxlength="<?= (int) cfg('max_username_length', 24) ?>"
         required autocomplete="username" value="<?= e((string) ($_POST['username'] ?? '')) ?>">
  <label for="password" style="margin-top:14px">密码</label>
  <input type="password" id="password" name="password" required autocomplete="current-password">
  <button type="submit">登录</button>
</form>
<?php
render_page('登录', (string) ob_get_clean());
