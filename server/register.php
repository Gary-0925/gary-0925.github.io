<?php
/**
 * 注册账号。
 *
 * 注册成功即自动登录。之后上传成绩时不再手填名字，
 * 排行榜上的“选手”就是账号用户名。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

// 已登录就不需要注册页。
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
            throw new RuntimeException('表单已过期，请刷新页面后重新提交。');
        }

        $username = (string) ($_POST['username'] ?? '');
        $password = (string) ($_POST['password'] ?? '');
        $confirm = (string) ($_POST['confirm'] ?? '');

        if ($password !== $confirm) {
            throw new RuntimeException('两次输入的密码不一致。');
        }

        register_user($db, $username, $password);

        header('Location: ' . $next);
        exit;
    } catch (RuntimeException $error) {
        $message = ['bad', $error->getMessage()];
    } catch (Throwable $error) {
        error_log('[aknoi] register failed: ' . $error->getMessage());
        $message = ['bad', '服务器出了点问题，请稍后再试。'];
    }
}

$token = csrf_token();

ob_start();
?>
<h1>注册</h1>
<p class="sub">注册后即可上传成绩，排行榜上的“选手”就是你的用户名。</p>

<?php if ($message !== null): ?>
<div class="msg <?= e($message[0]) ?>"><?= $message[1] ?></div>
<?php endif; ?>

<form class="card" method="post">
  <input type="hidden" name="csrf" value="<?= e($token) ?>">
  <label for="username">用户名</label>
  <input type="text" id="username" name="username" maxlength="<?= (int) cfg('max_username_length', 24) ?>"
         required autocomplete="username" placeholder="显示在排行榜上的名字"
         value="<?= e((string) ($_POST['username'] ?? '')) ?>">
  <label for="password" style="margin-top:14px">密码</label>
  <input type="password" id="password" name="password" required autocomplete="new-password"
         placeholder="至少 <?= (int) cfg('min_password_length', 6) ?> 个字符">
  <label for="confirm" style="margin-top:14px">再输一次密码</label>
  <input type="password" id="confirm" name="confirm" required autocomplete="new-password">
  <button type="submit">注册并登录</button>
</form>

<p class="note"><a href="login.php">已经有账号了？去登录 →</a></p>
<?php
render_page('注册', (string) ob_get_clean());
