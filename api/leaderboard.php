<?php
/**
 * 排行榜页面。
 *
 * 同样是普通网页而不是 JSON 接口：免费主机会拦截非浏览器请求，
 * 直接渲染 HTML 才能保证谁都打得开。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

$pageSize = 20;
$maxPageSize = (int) cfg('max_page_size', 100);
if ($pageSize > $maxPageSize) {
    $pageSize = $maxPageSize;
}

$page = max(1, (int) ($_GET['page'] ?? 1));
$page = min($page, 500);
$offset = ($page - 1) * $pageSize;

// 只按种子筛选，值先过白名单再用占位符传进去。
$seedFilter = trim((string) ($_GET['seed'] ?? ''));
if ($seedFilter !== '' && preg_match('/^[A-Za-z0-9_-]{1,32}$/', $seedFilter) !== 1) {
    $seedFilter = '';
}

// 每人只留最好的一条。MySQL 5.7 起默认开 ONLY_FULL_GROUP_BY，
// 这里用 NOT EXISTS 而不是 GROUP BY，避免 SQL 模式差异。
$bestOnly = ($_GET['scope'] ?? 'best') !== 'all';

$table = scores_table();
$where = [];
$params = [];

if ($seedFilter !== '') {
    $where[] = 's.seed = ?';
    $params[] = $seedFilter;
}
if ($bestOnly) {
    $where[] = 'NOT EXISTS (SELECT 1 FROM `' . $table . '` b WHERE b.name = s.name'
        . ($seedFilter !== '' ? ' AND b.seed = s.seed' : '')
        . ' AND (b.score > s.score OR (b.score = s.score AND b.id < s.id)))';
}

$whereSql = $where === [] ? '' : ' WHERE ' . implode(' AND ', $where);

$rows = [];
$total = 0;
$error = null;

try {
    $countRow = $db->query(
        'SELECT COUNT(*) AS total FROM `' . $table . '` s' . $whereSql,
        $params
    )->fetch();
    $total = (int) ($countRow['total'] ?? 0);

    // LIMIT / OFFSET 在原生预处理下不能用占位符，所以强转 int 后内插。
    $rows = $db->query(
        'SELECT s.id, s.name, s.seed, s.score, s.moves, s.created_at'
        . ' FROM `' . $table . '` s' . $whereSql
        . ' ORDER BY s.score DESC, s.moves ASC, s.id ASC'
        . ' LIMIT ' . (int) $pageSize . ' OFFSET ' . (int) $offset,
        $params
    )->fetchAll();
} catch (Throwable $throwable) {
    error_log('[aknoi] leaderboard failed: ' . $throwable->getMessage());
    $error = '排行榜暂时读不出来，请稍后再试。';
}

$totalPages = $total > 0 ? (int) ceil($total / $pageSize) : 1;

/** 保留当前筛选条件的翻页链接。 */
function page_link(int $page, string $seed, bool $bestOnly): string
{
    $query = ['page' => $page];
    if ($seed !== '') {
        $query['seed'] = $seed;
    }
    if (!$bestOnly) {
        $query['scope'] = 'all';
    }
    return '?' . http_build_query($query);
}

ob_start();
?>
<h1>排行榜</h1>
<p class="sub">
  <?= $bestOnly ? '每位选手只显示最好成绩' : '显示全部记录' ?>
  <?php if ($seedFilter !== ''): ?>· 种子 <code><?= e($seedFilter) ?></code><?php endif; ?>
  · 共 <?= $total ?> 条
</p>

<?php if ($error !== null): ?>
<div class="msg bad"><?= e($error) ?></div>
<?php endif; ?>

<form class="card" method="get">
  <label for="seed">按种子筛选</label>
  <input type="text" id="seed" name="seed" maxlength="32" placeholder="留空看全部种子"
         value="<?= e($seedFilter) ?>">
  <label style="margin-top:12px; font-weight:400">
    <input type="checkbox" name="scope" value="all" style="width:auto"
           <?= $bestOnly ? '' : 'checked' ?>>
    显示每个人的全部记录（默认只看个人最好成绩）
  </label>
  <button type="submit">筛选</button>
</form>

<div class="card">
<?php if ($rows === []): ?>
  <p class="empty">还没有成绩，<a href="submit.php">来上传第一个</a>。</p>
<?php else: ?>
  <table>
    <thead>
      <tr>
        <th class="rank">#</th>
        <th>选手</th>
        <th>种子</th>
        <th class="num">分数</th>
        <th class="num">步数</th>
        <th>时间</th>
      </tr>
    </thead>
    <tbody>
      <?php foreach ($rows as $index => $row): ?>
      <tr>
        <td class="rank"><?= $offset + $index + 1 ?></td>
        <td><?= e((string) $row['name']) ?></td>
        <td><code><?= e((string) $row['seed']) ?></code></td>
        <td class="num"><strong><?= format_score((float) $row['score']) ?></strong></td>
        <td class="num"><?= (int) $row['moves'] ?></td>
        <td class="note"><?= e(substr((string) $row['created_at'], 0, 16)) ?></td>
      </tr>
      <?php endforeach; ?>
    </tbody>
  </table>

  <?php if ($totalPages > 1): ?>
  <p class="pager">
    <?php if ($page > 1): ?>
    <a href="<?= e(page_link($page - 1, $seedFilter, $bestOnly)) ?>">← 上一页</a>
    <?php endif; ?>
    <span class="note">第 <?= $page ?> / <?= $totalPages ?> 页</span>
    <?php if ($page < $totalPages): ?>
    <a href="<?= e(page_link($page + 1, $seedFilter, $bestOnly)) ?>">下一页 →</a>
    <?php endif; ?>
  </p>
  <?php endif; ?>
<?php endif; ?>
</div>

<p class="note"><a href="submit.php">上传我的成绩 →</a></p>
<?php
render_page('排行榜', (string) ob_get_clean());
