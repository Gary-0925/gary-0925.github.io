<?php
/**
 * AKNOI 排行榜公共库：配置、上传文件解析、校验、限流。
 *
 * 这里没有 JSON API。InfinityFree 免费主机会拦截非浏览器请求
 * （要求客户端能执行 JS 并保存 __test cookie），所以排行榜完全做成
 * 普通网页 + 表单上传，全程在浏览器里走，不受这套限制影响。
 */

declare(strict_types=1);

// 这些文件部署在站点根目录（htdocs/），数据库连接在 htdocs/db/db.php。
// 为了在本地把它们放进子目录时也能跑，父目录的 db/ 也认。
$aknoiDbCandidates = [__DIR__ . '/db/db.php', __DIR__ . '/../db/db.php'];
$aknoiDbLoaded = false;
foreach ($aknoiDbCandidates as $aknoiDbFile) {
    if (is_file($aknoiDbFile)) {
        require_once $aknoiDbFile;
        $aknoiDbLoaded = true;
        break;
    }
}
if (!$aknoiDbLoaded) {
    http_response_code(500);
    exit('找不到数据库连接文件 db/db.php。');
}
unset($aknoiDbCandidates, $aknoiDbFile, $aknoiDbLoaded);

require_once __DIR__ . '/engine.php';

/** @var array<string,mixed> $AKNOI_CONFIG */
$AKNOI_CONFIG = require __DIR__ . '/config.php';

/**
 * 读取配置项。
 *
 * @param mixed $fallback
 * @return mixed
 */
function cfg(string $key, $fallback = null)
{
    global $AKNOI_CONFIG;
    return array_key_exists($key, $AKNOI_CONFIG) ? $AKNOI_CONFIG[$key] : $fallback;
}

/** 表名只允许字母数字下划线，杜绝任何拼接进 SQL 的风险。 */
function scores_table(): string
{
    $table = (string) cfg('table', 'aknoi_scores');
    if (preg_match('/^[A-Za-z0-9_]+$/', $table) !== 1) {
        throw new RuntimeException('配置中的表名不合法。');
    }
    return $table;
}

/** HTML 转义。 */
function e(?string $text): string
{
    return htmlspecialchars((string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** 分数显示：整数不带小数点，否则保留一位。 */
function format_score(float $score): string
{
    return abs($score - round($score)) < 0.0001
        ? (string) (int) round($score)
        : number_format($score, 1, '.', '');
}

/**
 * 上机分 → 对外展示的总分。
 *
 * 库里存的一律是引擎算出来的上机分（0~600），笔试分只在显示时加上，
 * 这样引擎、存档、校验三边的口径始终一致。
 */
function display_score(float $machineScore): float
{
    return round($machineScore + (float) cfg('written_exam_score', 105), 1);
}

/** 展示用总分的字符串形式。 */
function format_display_score(float $machineScore): string
{
    return format_score(display_score($machineScore));
}

/**
 * 奖牌分数线。
 *
 * $total 是本周上榜的总人数，名次落在各段内即得对应奖牌：
 *   金 前 min(50,  ceil(total * 1/10))
 *   银 到 min(150, ceil(total * 3/10))
 *   铜 到 min(300, ceil(total * 6/10))
 *
 * 三条线单调不减：人少的时候上界会互相压平（比如 total=1 时三条线都是 1，
 * 只发金牌），所以后面判定时按金→银→铜的顺序取第一个命中的即可。
 *
 * @return array{gold:int,silver:int,bronze:int}
 */
function medal_cutoffs(int $total): array
{
    if ($total <= 0) {
        return ['gold' => 0, 'silver' => 0, 'bronze' => 0];
    }
    $gold = min(50, (int) ceil($total / 10));
    $silver = max($gold, min(150, (int) ceil($total * 3 / 10)));
    $bronze = max($silver, min(300, (int) ceil($total * 6 / 10)));
    return ['gold' => $gold, 'silver' => $silver, 'bronze' => $bronze];
}

/**
 * 名次 → 奖牌。返回 null 表示无奖牌。
 *
 * @param array{gold:int,silver:int,bronze:int} $cutoffs
 * @return array{key:string,label:string,short:string}|null
 */
function medal_for_rank(int $rank, array $cutoffs): ?array
{
    if ($rank <= 0) {
        return null;
    }
    if ($rank <= $cutoffs['gold']) {
        return ['key' => 'au', 'label' => '金牌', 'short' => 'Au'];
    }
    if ($rank <= $cutoffs['silver']) {
        return ['key' => 'ag', 'label' => '银牌', 'short' => 'Ag'];
    }
    if ($rank <= $cutoffs['bronze']) {
        return ['key' => 'cu', 'label' => '铜牌', 'short' => 'Cu'];
    }
    return null;
}

/** 排行榜统计窗口（天）。只有这个窗口内的成绩会上榜。 */
function leaderboard_days(): int
{
    $days = (int) cfg('leaderboard_days', 7);
    return $days > 0 ? min($days, 3650) : 7;
}

/** 取真实客户端 IP。免费主机前面有反向代理，优先读代理头。 */
function client_ip(): string
{
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $key) {
        if (empty($_SERVER[$key])) {
            continue;
        }
        $first = trim(explode(',', (string) $_SERVER[$key])[0]);
        if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
            return $first;
        }
    }
    return '0.0.0.0';
}

/** 存 IP 的加盐哈希而不是明文。 */
function client_ip_hash(): string
{
    return hash('sha256', (string) cfg('ip_salt', '') . '|' . client_ip());
}

/** 去掉控制字符和零宽字符，压缩空白。 */
function clean_name(string $name): string
{
    $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?? '';
    $name = preg_replace('/[\p{Cf}]/u', '', $name) ?? '';
    $name = preg_replace('/\s+/u', ' ', $name) ?? '';
    return trim($name);
}

/** 表单 CSRF 令牌。 */
function csrf_token(): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        @session_start();
    }
    if (empty($_SESSION['aknoi_csrf'])) {
        $_SESSION['aknoi_csrf'] = bin2hex(random_bytes(16));
    }
    return (string) $_SESSION['aknoi_csrf'];
}

function csrf_valid(string $given): bool
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        @session_start();
    }
    $expected = (string) ($_SESSION['aknoi_csrf'] ?? '');
    return $expected !== '' && hash_equals($expected, $given);
}

/**
 * 上传失败时 PHP 给出的错误码转成人话。
 */
function upload_error_message(int $code): string
{
    switch ($code) {
        case UPLOAD_ERR_INI_SIZE:
        case UPLOAD_ERR_FORM_SIZE:
            return '文件太大了。';
        case UPLOAD_ERR_PARTIAL:
            return '文件只上传了一部分，请重试。';
        case UPLOAD_ERR_NO_FILE:
            return '没有选择文件。';
        case UPLOAD_ERR_NO_TMP_DIR:
        case UPLOAD_ERR_CANT_WRITE:
            return '服务器暂时无法保存文件，请稍后再试。';
        case UPLOAD_ERR_EXTENSION:
            return '上传被服务器扩展拦截了。';
        default:
            return '上传失败。';
    }
}

/**
 * 解析并结构校验 .dat 存档。
 *
 * 只检查结构，不检查分数对不对 —— 分数由 aknoi_verify_replay 重算。
 *
 * @throws RuntimeException 文件不合法时抛出，消息可直接展示给用户
 * @return array{seed:string,claimed_score:float,actions:array,action_count:int}
 */
function parse_replay_file(string $raw): array
{
    $maxActions = (int) cfg('max_actions', 20000);

    if (trim($raw) === '') {
        throw new RuntimeException('文件是空的。');
    }

    // 去掉可能的 UTF-8 BOM，某些编辑器另存会加上。
    $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw) ?? $raw;

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('这不是一个有效的 AKNOI 存档文件（JSON 解析失败）。');
    }

    if (($data['format'] ?? '') !== 'aknoi-replay') {
        throw new RuntimeException('这不是 AKNOI 的存档文件。');
    }
    if ((int) ($data['version'] ?? 0) !== 1) {
        throw new RuntimeException('存档版本不受支持，请用最新版游戏重新导出。');
    }

    $seed = trim((string) ($data['seed'] ?? ''));
    if (preg_match('/^[A-Za-z0-9_-]{1,32}$/', $seed) !== 1) {
        throw new RuntimeException('存档中的种子不合法。');
    }

    if (!isset($data['score']) || !is_numeric($data['score'])) {
        throw new RuntimeException('存档中缺少分数。');
    }
    $claimed = (float) $data['score'];

    $rawActions = $data['actions'] ?? null;
    if (!is_array($rawActions) || $rawActions === []) {
        throw new RuntimeException('存档中没有操作记录。');
    }
    if (count($rawActions) > $maxActions) {
        throw new RuntimeException('操作序列过长（超过 ' . $maxActions . ' 步）。');
    }

    $actions = [];
    foreach ($rawActions as $action) {
        if (!is_array($action)) {
            throw new RuntimeException('操作序列中含有非法元素。');
        }
        $type = (string) ($action['type'] ?? '');
        if ($type === 'move') {
            $direction = (string) ($action['direction'] ?? '');
            if (!in_array($direction, ['up', 'down', 'left', 'right'], true)) {
                throw new RuntimeException('存档中含有非法的移动方向。');
            }
            $actions[] = ['type' => 'move', 'direction' => $direction];
        } elseif ($type === 'submit') {
            $boardId = (string) ($action['boardId'] ?? '');
            if (preg_match('/^problem-[A-Za-z0-9]{1,16}$/', $boardId) !== 1) {
                throw new RuntimeException('存档中含有非法的题目 ID。');
            }
            $actions[] = ['type' => 'submit', 'boardId' => $boardId];
        } else {
            throw new RuntimeException('存档中含有未知的操作类型。');
        }
    }

    return [
        'seed' => $seed,
        'claimed_score' => $claimed,
        'actions' => $actions,
        'action_count' => count($actions),
    ];
}

/** 同一份回放只上榜一次：用种子 + 操作序列算指纹，表上有唯一索引。 */
function replay_fingerprint(string $seed, array $actions): string
{
    $parts = [];
    foreach ($actions as $action) {
        $parts[] = $action['type'] === 'move'
            ? 'm:' . $action['direction']
            : 's:' . $action['boardId'];
    }
    return hash('sha256', $seed . '|' . implode(',', $parts));
}

/**
 * 限流：同一 IP 在窗口期内最多上传若干次。
 *
 * @throws RuntimeException 超过限制时抛出
 */
function enforce_rate_limit(dataBase $db): void
{
    $window = (int) cfg('rate_window', 600);
    $limit = (int) cfg('rate_limit', 12);
    if ($limit <= 0 || $window <= 0) {
        return;
    }

    $table = scores_table();
    // db.php 里 EMULATE_PREPARES=false，占位符按字符串绑定，
    // INTERVAL ? SECOND 在原生预处理下不可靠，所以内联已转成 int 的窗口值。
    $sql = 'SELECT COUNT(*) AS hits FROM `' . $table . '`'
        . ' WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL ' . $window . ' SECOND)';
    $row = $db->query($sql, [client_ip_hash()])->fetch();

    if ((int) ($row['hits'] ?? 0) >= $limit) {
        throw new RuntimeException('上传太频繁了，请过几分钟再试。');
    }
}

/** 页面外壳，上传页和排行榜页共用。 */
function render_page(string $title, string $body): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    $safeTitle = e($title);
    echo <<<HTML
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{$safeTitle} · AKNOI</title>
<style>
:root { --bg:#faf8ef; --ink:#5b5148; --muted:#9a8f84; --line:#e3dbd0; --button:#8f7a66; }
* { box-sizing: border-box; }
body { margin:0; padding:20px 14px 48px; background:var(--bg); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
  font-size:14px; line-height:1.6; }
.wrap { max-width:860px; margin:0 auto; }
h1 { font-size:1.6rem; margin:0 0 4px; letter-spacing:.06em; }
h2 { font-size:1rem; margin:24px 0 8px; }
.sub { color:var(--muted); font-size:.82rem; margin:0 0 20px; }
a { color:#7a6752; }
.card { background:#fff; border:1px solid var(--line); border-radius:6px; padding:16px; margin-bottom:16px; }
label { display:block; font-weight:700; font-size:.82rem; margin-bottom:6px; }
input[type=text], input[type=file] { width:100%; padding:8px; border:1px solid var(--line);
  border-radius:4px; font-size:.88rem; background:#fdfcfa; }
button { margin-top:12px; padding:9px 18px; border:0; border-radius:4px; background:var(--button);
  color:#fff; font-size:.88rem; font-weight:700; cursor:pointer; }
button:hover { background:#7d6a58; }
table { width:100%; border-collapse:collapse; font-size:.85rem; }
th, td { padding:7px 8px; text-align:left; border-bottom:1px solid var(--line); }
th { font-size:.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
.rank { width:44px; color:var(--muted); font-weight:700; }
.msg { padding:11px 13px; border-radius:4px; margin-bottom:16px; font-size:.85rem; }
.msg.ok { background:#e8f6e2; border:1px solid #b9dfa8; color:#33691e; }
.msg.bad { background:#fdeceb; border:1px solid #f2b8b4; color:#a5342c; }
.msg.warn { background:#fdf5e2; border:1px solid #ecd9a3; color:#8a6d1f; }
.note { color:var(--muted); font-size:.78rem; }
.empty { color:var(--muted); text-align:center; padding:28px 0; }
.pager { margin-top:14px; font-size:.82rem; }
.medal-col { width:52px; }
.medal { display:inline-block; min-width:26px; padding:1px 6px; border-radius:10px;
  font-size:.72rem; font-weight:700; text-align:center; letter-spacing:.02em; }
.medal.au { background:#f6e2a8; border:1px solid #d9b64e; color:#6d5310; }
.medal.ag { background:#e6e6e6; border:1px solid #b6b6b6; color:#4f4f4f; }
.medal.cu { background:#f0d9c4; border:1px solid #c69267; color:#6f4522; }
ol { padding-left:1.2em; }
code { background:#f2ede6; padding:1px 5px; border-radius:3px; font-size:.85em; }
</style>
</head>
<body><div class="wrap">
{$body}
</div></body>
</html>
HTML;
}
