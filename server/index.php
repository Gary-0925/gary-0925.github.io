<?php
/**
 * 排行榜首页（周榜）。
 *
 * 部署在站点根目录，所以 https://aknoi.page.gd/ 打开就是排行榜。
 *
 * 同样是普通网页而不是 JSON 接口：免费主机会拦截非浏览器请求，
 * 直接渲染 HTML 才能保证谁都打得开。
 *
 * 周榜规则：只显示本周（ISO 周，周一 00:00 换榜）的成绩；
 * 每个账号每周只存一行 —— 就是他的最好成绩，没有“全部记录”可看。
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

$table = scores_table();
$usersTable = users_table();
$weekKey = current_week_key();

$where = ['s.week_key = ?'];
$params = [$weekKey];

if ($seedFilter !== '') {
    $where[] = 's.seed = ?';
    $params[] = $seedFilter;
}

$whereSql = ' WHERE ' . implode(' AND ', $where);

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
    error_log('[aknoi] leaderboard failed: ' . $throwable->getMessage());
    $error = '排行榜暂时读不出来，请稍后再试。';
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
<h1>排行榜</h1>
<p class="sub">
  本周榜（<?= e($weekKey) ?>，每周一 00:00 换榜）·
  每个账号只显示本周最好成绩
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
  <p class="empty">本周还没有成绩，<a href="submit.php">来上传第一个</a>。</p>
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
      <?php foreach ($rows as $index => $row): ?>
      <?php
        $rank = $offset + $index + 1;
        $medal = medal_for_rank($rank, $cutoffs);
      ?>
      <tr>
        <td class="rank"><?= $rank ?></td>
        <td class="medal-col">
          <?php if ($medal !== null): ?>
          <span class="medal <?= e($medal['key']) ?>" title="<?= e($medal['label']) ?>"><?= e($medal['short']) ?></span>
          <?php endif; ?>
        </td>
        <td><?= e((string) $row['name']) ?></td>
        <td><code><?= e((string) $row['seed']) ?></code></td>
        <td class="num"><strong><?= format_display_score((float) $row['score']) ?></strong></td>
        <td class="num"><?= (int) $row['moves'] ?></td>
        <td class="note"><?= e(substr((string) $row['created_at'], 0, 16)) ?></td>
      </tr>
      <?php endforeach; ?>
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

<?php $bonus = (int) cfg('written_exam_score', 105); ?>
<?php $fullMark = format_score((float) cfg('max_score', 600.0) + (float) $bonus); ?>
<p class="note">总分 = 上机分 + 笔试 <?= $bonus ?> 分，满分 <?= $fullMark ?> 分。</p>
<p class="note">周榜每周一 00:00 重置；SQL 里每个账号每周只保留最好的一局，成绩不上榜就说明没超过你本周的最好成绩。</p>
<p class="note"><a href="submit.php">上传我的成绩 →</a></p>
<?php
render_page('排行榜', (string) ob_get_clean());
