<?php
/**
 * AKNOI 排行榜公共库：响应、校验、限流、回放校验。
 */

declare(strict_types=1);

require_once __DIR__ . '/../db/db.php';

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

/** 表名只允许字母数字下划线，避免任何拼接进 SQL 的风险。 */
function scores_table(): string
{
    $table = (string) cfg('table', 'aknoi_scores');
    if (preg_match('/^[A-Za-z0-9_]+$/', $table) !== 1) {
        fail(500, 'bad_config', '配置中的表名不合法。');
    }
    return $table;
}

/** 按白名单回显 CORS 头，并处理预检请求。 */
function send_cors_headers(string $methods): void
{
    $allowed = (array) cfg('allowed_origins', []);
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';

    if ($origin !== '' && in_array($origin, $allowed, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Allow-Methods: ' . $methods . ', OPTIONS');
        header('Access-Control-Max-Age: 86400');
    }

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/** 统一 JSON 输出。 */
function respond(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** 统一错误输出。 */
function fail(int $status, string $code, string $message): void
{
    respond($status, ['ok' => false, 'error' => $code, 'message' => $message]);
}

/** 只允许指定的 HTTP 方法。 */
function require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        header('Allow: ' . $method . ', OPTIONS');
        fail(405, 'method_not_allowed', '请使用 ' . $method . ' 请求这个接口。');
    }
}

/** 读取并解析 JSON 请求体。 */
function read_json_body(): array
{
    $limit = (int) cfg('max_body_bytes', 262144);
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($raw === false) {
        fail(400, 'bad_body', '无法读取请求体。');
    }
    if (strlen($raw) > $limit) {
        fail(413, 'body_too_large', '请求体过大。');
    }
    if (trim($raw) === '') {
        fail(400, 'bad_body', '请求体为空，需要 JSON。');
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail(400, 'bad_json', '请求体不是合法的 JSON 对象。');
    }
    return $data;
}

/** 取真实客户端 IP。InfinityFree 前面有反向代理，优先读代理头。 */
function client_ip(): string
{
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $key) {
        if (empty($_SERVER[$key])) {
            continue;
        }
        $value = (string) $_SERVER[$key];
        // X-Forwarded-For 可能是 "client, proxy1, proxy2"，取第一个。
        $first = trim(explode(',', $value)[0]);
        if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
            return $first;
        }
    }
    return '0.0.0.0';
}

/** 存 IP 的加盐哈希而不是明文。 */
function client_ip_hash(): string
{
    $salt = (string) cfg('ip_salt', '');
    return hash('sha256', $salt . '|' . client_ip());
}

/** 去掉控制字符并压缩空白，防止昵称里塞换行、零宽字符搞乱排行榜。 */
function clean_name(string $name): string
{
    $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?? '';
    $name = preg_replace('/[\p{Cf}]/u', '', $name) ?? '';
    $name = preg_replace('/\s+/u', ' ', $name) ?? '';
    return trim($name);
}

/**
 * 校验并归一化提交内容。
 *
 * @return array{name:string,seed:string,score:float,moves:int,duration_ms:int,actions:array}
 */
function validate_submission(array $body): array
{
    $maxName = (int) cfg('max_name_length', 24);
    $maxScore = (float) cfg('max_score', 600.0);
    $maxActions = (int) cfg('max_actions', 20000);

    $name = clean_name((string) ($body['name'] ?? ''));
    if ($name === '') {
        fail(422, 'bad_name', '昵称不能为空。');
    }
    if (mb_strlen($name, 'UTF-8') > $maxName) {
        fail(422, 'bad_name', '昵称最长 ' . $maxName . ' 个字符。');
    }

    $seed = trim((string) ($body['seed'] ?? ''));
    if ($seed === '' || preg_match('/^[A-Za-z0-9_-]{1,32}$/', $seed) !== 1) {
        fail(422, 'bad_seed', '种子不合法：只允许字母、数字、下划线和连字符，最长 32 位。');
    }

    if (!isset($body['score']) || !is_numeric($body['score'])) {
        fail(422, 'bad_score', '缺少分数。');
    }
    $score = round((float) $body['score'], 1);
    if ($score < 0 || $score > $maxScore) {
        fail(422, 'bad_score', '分数必须在 0 到 ' . $maxScore . ' 之间。');
    }

    $actions = $body['actions'] ?? null;
    if (!is_array($actions) || $actions === []) {
        fail(422, 'bad_actions', '缺少操作序列。');
    }
    if (count($actions) > $maxActions) {
        fail(422, 'bad_actions', '操作序列过长。');
    }

    $normalized = [];
    $moves = 0;
    foreach ($actions as $action) {
        if (!is_array($action)) {
            fail(422, 'bad_actions', '操作序列中含有非法元素。');
        }
        $type = (string) ($action['type'] ?? '');
        if ($type === 'move') {
            $direction = (string) ($action['direction'] ?? '');
            if (!in_array($direction, ['up', 'down', 'left', 'right'], true)) {
                fail(422, 'bad_actions', '非法的移动方向：' . $direction);
            }
            $normalized[] = ['type' => 'move', 'direction' => $direction];
            $moves++;
        } elseif ($type === 'submit') {
            $boardId = (string) ($action['boardId'] ?? '');
            if (preg_match('/^problem-[A-Za-z0-9]{1,16}$/', $boardId) !== 1) {
                fail(422, 'bad_actions', '非法的题目 ID：' . $boardId);
            }
            $normalized[] = ['type' => 'submit', 'boardId' => $boardId];
        } else {
            fail(422, 'bad_actions', '未知的操作类型：' . $type);
        }
    }

    $duration = isset($body['durationMs']) && is_numeric($body['durationMs'])
        ? (int) $body['durationMs']
        : 0;
    if ($duration < 0 || $duration > 86400000) {
        $duration = 0;
    }

    return [
        'name' => $name,
        'seed' => $seed,
        'score' => $score,
        'moves' => $moves,
        'duration_ms' => $duration,
        'actions' => $normalized,
    ];
}

/**
 * 同一份回放只记一次：用种子 + 操作序列算指纹。
 * 表上对这个列建了唯一索引。
 */
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

/** 简单限流：数最近 rate_window 秒内同一 IP 的提交次数。 */
function enforce_rate_limit(dataBase $db): void
{
    $window = (int) cfg('rate_window', 600);
    $limit = (int) cfg('rate_limit', 12);
    if ($limit <= 0 || $window <= 0) {
        return;
    }

    $table = scores_table();
    // 注意：db.php 里 EMULATE_PREPARES=false，占位符会以字符串绑定，
    // INTERVAL ? SECOND 在原生预处理下不可靠，所以这里内联已经转成 int 的窗口值。
    $sql = 'SELECT COUNT(*) AS hits FROM `' . $table . '`'
        . ' WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL ' . $window . ' SECOND)';
    $row = $db->query($sql, [client_ip_hash()])->fetch();
    $hits = (int) ($row['hits'] ?? 0);

    if ($hits >= $limit) {
        header('Retry-After: ' . $window);
        fail(429, 'rate_limited', '提交太频繁了，请稍后再试。');
    }
}
