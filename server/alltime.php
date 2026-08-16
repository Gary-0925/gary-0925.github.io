<?php
/**
 * 总榜（不限种子）。
 *
 * 和 index.php（周榜）一样是普通网页而不是 JSON 接口。
 *
 * 总榜规则：
 *   - 不限定种子，任何种子、任何一周的成绩都算；
 *   - 每个账号只保留一行 —— 历史最好成绩（上传时更高的分才顶掉旧的）；
 *   - 可以按种子筛选查看。
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

$table = alltime_table();
$usersTable = users_table();

$where = [];
$params = [];

if ($seedFilter !== '') {
    $where[] = 's.seed = ?';
    $params[] = $seedFilter;
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
        'SELECT s.id, u.username AS name, s.seed, s.score, s.moves, s.created_at'
        . ' FROM `' . $table . '` s'
        . ' JOIN `' . $usersTable . '` u ON u.id = s.user_id'
        . $whereSql
        . ' ORDER BY s.score DESC, s.moves ASC, s.id ASC'
        . ' LIMIT ' . (int) $pageSize . ' OFFSET ' . (int) $offset,
        $params
    )->fetchAll();
} catch (Throwable $throwable) {
    error_log('[aknoi] alltime leaderboard failed: ' . $throwable->getMessage());
    $error = '总榜暂时读不出来，请稍后再试。';
}

$totalPages = $total > 0 ? (int) ceil($total / $pageSize) : 1;

// 奖牌线按当前榜单的人数算。
$cutoffs = medal_cutoffs($total);

/** 保留当前筛选条件的翻页链接。 */
function page_link(int $page, string $seed): string
{
    $query = ['page' => $page];
    if ($seed !== '') {
        $query['seed'] = $seed;
    }
    return '?' . http_build_query($query);
}

ob_start();
?>
<h1>总榜</h1>
<p class="sub">
  不限定种子 · 每个账号只保留历史最好成绩
  <?php if ($seedFilter !== ''): ?>· 种子 <code><?= e($seedFilter) ?></code><?php endif; ?>
  · 共 <?= $total ?> 人
</p>

<?php if ($error !== null): ?>
<div class="msg bad"><?= e($error) ?></div>
<?php endif; ?>

<?php if ($total > 0): ?>
<p class="sub" style="margin-top:-12px">
  奖牌线：<span class="medal au">Au</span> 前 <?= $cutoffs['gold'] ?> 名 ·
  <span class="medal ag">Ag</span> 前 <?= $cutoffs['silver'] ?> 名 ·
  <span class="medal cu">Cu</span> 前 <?= $cutoffs['bronze'] ?> 名
</p>
<?php endif; ?>

<form class="card" method="get">
  <label for="seed">按种子筛选</label>
  <input type="text" id="seed" name="seed" maxlength="32" placeholder="留空看全部种子"
         value="<?= e($seedFilter) ?>">
  <button type="submit">筛选</button>
</form>

<div class="card">
<?php if ($rows === []): ?>
  <p class="empty"><?= $seedFilter !== '' ? '这个种子还没有成绩。' : '还没有人上传过成绩，<a href="submit.php">来上传第一个</a>。' ?></p>
<?php else: ?>
  <table>
    <thead>
      <tr>
        <th class="rank">#</th>
        <th class="medal-col">奖牌</th>
        <th>选手</th>
        <th>种子</th>
        <th class="num">总分</th>
        <th class="num">步数</th>
        <th>时间</th>
      </tr>
    </thead>
    <tbody>
      <?= render_board_rows($rows, $offset, $cutoffs) ?>
    </tbody>
  </table>

  <?php if ($totalPages > 1): ?>
  <p class="pager">
    <?php if ($page > 1): ?>
    <a href="<?= e(page_link($page - 1, $seedFilter)) ?>">← 上一页</a>
    <?php endif; ?>
    <span class="note">第 <?= $page ?> / <?= $totalPages ?> 页</span>
    <?php if ($page < $totalPages): ?>
    <a href="<?= e(page_link($page + 1, $seedFilter)) ?>">下一页 →</a>
    <?php endif; ?>
  </p>
  <?php endif; ?>
<?php endif; ?>
</div>

<p class="note"><a href="./">查看周榜（本周种子）→</a></p>
<p class="note">总分 = 上机分 + 笔试 <?= (int) cfg('written_exam_score', 105) ?> 分，满分 <?= format_score((float) cfg('max_score', 600.0) + (float) cfg('written_exam_score', 105)) ?> 分。</p>
<p class="note"><a href="submit.php">上传我的成绩 →</a></p>
<?php
render_page('总榜', (string) ob_get_clean());
