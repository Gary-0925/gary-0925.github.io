<?php
/**
 * 上传 .dat 存档，服务端重算分数后记入周榜和/或总榜。
 *
 * 这是一个普通网页表单，不是 JSON API：
 * 用户在游戏里点「导出」拿到 .dat，再到这个页面选文件上传。
 * 服务端会用 engine.php 完整重放一遍操作序列，自己算出分数，
 * 存档里写的 score 只用来对账 —— 对不上就直接拒绝。
 *
 * 需要登录账号才能上传。两张表都只存最好成绩：
 *   - 周榜（aknoi_scores）：只统计本周种子，每个账号每周一行；
 *   - 总榜（aknoi_alltime）：不限种子，每个账号一行历史最好成绩。
 * 比已有成绩高就原地更新那一行，等于或低于直接拒绝。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

// 未登录先去登录，登录后跳回本页。
$user = require_login($db);

// 页面底部的说明要用到本周种子，先算好。
$weekSeed = weekly_seed();

$message = null;   // [类型, 文本]
$result = null;    // 成功时的成绩详情

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    try {
        if (!csrf_valid((string) ($_POST['csrf'] ?? ''))) {
            throw new RuntimeException('表单已过期，请刷新页面后重新上传。');
        }

        $file = $_FILES['replay'] ?? null;
        if (!is_array($file) || !isset($file['error'])) {
            throw new RuntimeException('没有收到文件。');
        }
        if ((int) $file['error'] !== UPLOAD_ERR_OK) {
            throw new RuntimeException(upload_error_message((int) $file['error']));
        }

        $maxBytes = (int) cfg('max_body_bytes', 262144);
        if ((int) $file['size'] > $maxBytes) {
            throw new RuntimeException('文件太大了（最多 ' . (int) round($maxBytes / 1024) . ' KB）。');
        }
        if (!is_uploaded_file((string) $file['tmp_name'])) {
            throw new RuntimeException('文件上传异常，请重试。');
        }

        $raw = file_get_contents((string) $file['tmp_name']);
        if ($raw === false) {
            throw new RuntimeException('读取文件失败，请重试。');
        }

        $replay = parse_replay_file($raw);

        enforce_rate_limit($db);

        // 核心：不相信文件里写的分数，自己重放一遍算。
        $verified = aknoi_verify_replay($replay['seed'], $replay['actions']);
        $score = (float) $verified['score'];

        // 存档里的分数必须和重算结果一致，差之毫厘就是改过文件。
        if (abs($score - $replay['claimed_score']) > 0.05) {
            throw new RuntimeException(sprintf(
                '存档校验不通过：文件里写着 %s 分，但重放这局操作实际只有 %s 分。',
                format_score($replay['claimed_score']),
                format_score($score)
            ));
        }

        $maxScore = (float) cfg('max_score', 600.0);
        if ($score < 0 || $score > $maxScore) {
            throw new RuntimeException('分数超出合法范围。');
        }

        if (!$verified['finished']) {
            throw new RuntimeException('这局还没打完（六道题都提交后才能上榜）。');
        }

        $table = scores_table();
        $alltimeTable = alltime_table();
        $weekKey = current_week_key();
        $fingerprint = replay_fingerprint($replay['seed'], $replay['actions']);
        $userId = (int) $user['id'];

        // 旧周的成绩全部清掉：周榜只留本周。
        $db->query('DELETE FROM `' . $table . '` WHERE week_key <> ?', [$weekKey]);

        $onWeekSeed = $replay['seed'] === $weekSeed;

        /* ---------- 先查两边的现状，并做重复指纹预检 ----------
         * 所有校验都通过后才动手写，避免出现“周榜已写、总榜被拒”
         * 这种写了一半的状态。 */
        $weekly = ['counted' => false, 'best' => null, 'rank' => null, 'total' => 0];
        $alltime = ['counted' => false, 'best' => null, 'rank' => null, 'total' => 0];

        $existingWeekly = $onWeekSeed
            ? $db->query(
                'SELECT id, score FROM `' . $table . '`'
                . ' WHERE user_id = ? AND week_key = ? LIMIT 1',
                [$userId, $weekKey]
            )->fetch()
            : null;

        $alltimeRow = $db->query(
            'SELECT id, score FROM `' . $alltimeTable . '` WHERE user_id = ? LIMIT 1',
            [$userId]
        )->fetch();

        $weeklyShouldWrite = $onWeekSeed
            && (!is_array($existingWeekly) || $score > (float) $existingWeekly['score'] + 0.0001);
        $alltimeShouldWrite = !is_array($alltimeRow) || $score > (float) $alltimeRow['score'] + 0.0001;

        if ($weeklyShouldWrite) {
            $dup = $db->query(
                'SELECT id FROM `' . $table . '` WHERE replay_hash = ?'
                . (is_array($existingWeekly) ? ' AND user_id <> ?' : '') . ' LIMIT 1',
                is_array($existingWeekly)
                    ? [$fingerprint, $userId]
                    : [$fingerprint]
            )->fetch();
            if (is_array($dup)) {
                throw new RuntimeException('这局已经上过榜了，不能重复记录。');
            }
        }
        if ($alltimeShouldWrite) {
            $dup = $db->query(
                'SELECT id FROM `' . $alltimeTable . '` WHERE replay_hash = ?'
                . (is_array($alltimeRow) ? ' AND user_id <> ?' : '') . ' LIMIT 1',
                is_array($alltimeRow) ? [$fingerprint, $userId] : [$fingerprint]
            )->fetch();
            if (is_array($dup)) {
                throw new RuntimeException('这局已经上过榜了，不能重复记录。');
            }
        }

        /* ---------- 周榜写入 ---------- */
        if ($weeklyShouldWrite) {
            if (is_array($existingWeekly)) {
                $db->query(
                    'UPDATE `' . $table . '`'
                    . ' SET seed = ?, score = ?, moves = ?, action_count = ?,'
                    . ' actions = ?, replay_hash = ?, ip_hash = ?, created_at = NOW()'
                    . ' WHERE id = ?',
                    [
                        $replay['seed'],
                        $score,
                        (int) $verified['moves'],
                        $replay['action_count'],
                        json_encode($replay['actions'], JSON_UNESCAPED_SLASHES),
                        $fingerprint,
                        client_ip_hash(),
                        (int) $existingWeekly['id'],
                    ]
                );
            } else {
                $db->query(
                    'INSERT INTO `' . $table . '`'
                    . ' (user_id, week_key, seed, score, moves, action_count, actions, replay_hash, ip_hash, created_at)'
                    . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                    [
                        $userId,
                        $weekKey,
                        $replay['seed'],
                        $score,
                        (int) $verified['moves'],
                        $replay['action_count'],
                        json_encode($replay['actions'], JSON_UNESCAPED_SLASHES),
                        $fingerprint,
                        client_ip_hash(),
                    ]
                );
            }
            $weekly['counted'] = true;
        } elseif (is_array($existingWeekly)) {
            $weekly['best'] = (float) $existingWeekly['score'];
        }

        /* ---------- 总榜写入 ---------- */
        if ($alltimeShouldWrite) {
            if (is_array($alltimeRow)) {
                $db->query(
                    'UPDATE `' . $alltimeTable . '`'
                    . ' SET seed = ?, score = ?, moves = ?, action_count = ?,'
                    . ' actions = ?, replay_hash = ?, ip_hash = ?, created_at = NOW()'
                    . ' WHERE id = ?',
                    [
                        $replay['seed'],
                        $score,
                        (int) $verified['moves'],
                        $replay['action_count'],
                        json_encode($replay['actions'], JSON_UNESCAPED_SLASHES),
                        $fingerprint,
                        client_ip_hash(),
                        (int) $alltimeRow['id'],
                    ]
                );
            } else {
                $db->query(
                    'INSERT INTO `' . $alltimeTable . '`'
                    . ' (user_id, seed, score, moves, action_count, actions, replay_hash, ip_hash, created_at)'
                    . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                    [
                        $userId,
                        $replay['seed'],
                        $score,
                        (int) $verified['moves'],
                        $replay['action_count'],
                        json_encode($replay['actions'], JSON_UNESCAPED_SLASHES),
                        $fingerprint,
                        client_ip_hash(),
                    ]
                );
            }
            $alltime['counted'] = true;
        } elseif (is_array($alltimeRow)) {
            $alltime['best'] = (float) $alltimeRow['score'];
        }

        /* ---------- 提示语与名次 ---------- */
        if ($weekly['counted']) {
            $rankRow = $db->query(
                'SELECT COUNT(*) + 1 AS rank_value FROM `' . $table . '`'
                . ' WHERE week_key = ? AND seed = ? AND score > ?',
                [$weekKey, $weekSeed, $score]
            )->fetch();
            $weekly['rank'] = (int) ($rankRow['rank_value'] ?? 0);

            $totalRow = $db->query(
                'SELECT COUNT(*) AS total FROM `' . $table . '`'
                . ' WHERE week_key = ? AND seed = ?',
                [$weekKey, $weekSeed]
            )->fetch();
            $weekly['total'] = (int) ($totalRow['total'] ?? 0);
        }
        if ($alltime['counted']) {
            $rankRow = $db->query(
                'SELECT COUNT(*) + 1 AS rank_value FROM `' . $alltimeTable . '`'
                . ' WHERE score > ?',
                [$score]
            )->fetch();
            $alltime['rank'] = (int) ($rankRow['rank_value'] ?? 0);

            $totalRow = $db->query(
                'SELECT COUNT(*) AS total FROM `' . $alltimeTable . '`'
            )->fetch();
            $alltime['total'] = (int) ($totalRow['total'] ?? 0);
        }

        if ($weekly['counted'] && $alltime['counted']) {
            $message = ['ok', '上传成功，已同时计入周榜和总榜。'];
        } elseif ($weekly['counted']) {
            $message = ['ok', sprintf(
                '上传成功，已计入周榜（总榜仍保留你的历史最好成绩 %s 分）。',
                format_score((float) $alltime['best'])
            )];
        } elseif ($alltime['counted']) {
            $message = ['ok', $onWeekSeed
                ? '上传成功，已计入总榜（未超过你本周的最好成绩，周榜不变）。'
                : sprintf(
                    '上传成功，已计入总榜；这局种子不是本周种子（%s），不计入周榜。',
                    $weekSeed
                )];
        } else {
            throw new RuntimeException($onWeekSeed
                ? sprintf(
                    '这局没有超过你本周的最好成绩（%s 分），不上榜。',
                    format_score((float) $weekly['best'])
                )
                : sprintf(
                    '这局没有超过你的总榜纪录（%s 分），且不是本周种子（%s），未计入周榜。',
                    format_score((float) $alltime['best']),
                    $weekSeed
                ));
        }

        $result = [
            'name' => (string) $user['username'],
            'seed' => $replay['seed'],
            'score' => $score,
            'moves' => (int) $verified['moves'],
            'boards' => $verified['boards'],
            'week' => $weekKey,
            'week_seed' => $weekSeed,
            'weekly' => $weekly,
            'alltime' => $alltime,
        ];
    } catch (RuntimeException $error) {
        $message = ['bad', $error->getMessage()];
    } catch (Throwable $error) {
        error_log('[aknoi] submit failed: ' . $error->getMessage());
        $message = ['bad', '服务器出了点问题，请稍后再试。'];
    }
}

$token = csrf_token();

ob_start();
?>
<h1>上传成绩</h1>
<p class="sub">把游戏里导出的 <code>.dat</code> 存档传上来，服务器会重放整局操作、重新算分后记入周榜和总榜。</p>

<?php if ($message !== null): ?>
<div class="msg <?= e($message[0]) ?>"><?= $message[1] ?></div>
<?php endif; ?>

<?php if ($result !== null): ?>
<div class="card">
  <h2 style="margin-top:0">本局成绩</h2>
  <table>
    <tr><th>选手</th><td><?= e($result['name']) ?></td></tr>
    <tr><th>种子</th><td><code><?= e($result['seed']) ?></code></td></tr>
    <?php $bonus = (int) cfg('written_exam_score', 105); ?>
    <?php $fullMark = format_score((float) cfg('max_score', 600.0) + (float) $bonus); ?>
    <tr><th>总分</th><td><strong><?= format_display_score((float) $result['score']) ?></strong> / <?= $fullMark ?>
      <span class="note">（上机 <?= format_score((float) $result['score']) ?> + 笔试 <?= $bonus ?>）</span></td></tr>
    <tr><th>步数</th><td><?= (int) $result['moves'] ?></td></tr>
    <tr>
      <th>周榜</th>
      <td>
        <?php if ($result['weekly']['counted']): ?>
          第 <?= (int) $result['weekly']['rank'] ?> 名
          <span class="note">（<?= e($result['week']) ?>，种子 <code><?= e($result['week_seed']) ?></code>）</span>
          <?php $weeklyMedal = medal_for_rank((int) $result['weekly']['rank'], medal_cutoffs((int) $result['weekly']['total'])); ?>
          <?php if ($weeklyMedal !== null): ?>
          <span class="medal <?= e($weeklyMedal['key']) ?>"><?= e($weeklyMedal['short']) ?></span>
          <?php endif; ?>
        <?php else: ?>
          <span class="note">未计入（本周只统计种子 <code><?= e($result['week_seed']) ?></code>）</span>
        <?php endif; ?>
      </td>
    </tr>
    <tr>
      <th>总榜</th>
      <td>
        <?php if ($result['alltime']['counted']): ?>
          第 <?= (int) $result['alltime']['rank'] ?> 名
          <?php $alltimeMedal = medal_for_rank((int) $result['alltime']['rank'], medal_cutoffs((int) $result['alltime']['total'])); ?>
          <?php if ($alltimeMedal !== null): ?>
          <span class="medal <?= e($alltimeMedal['key']) ?>"><?= e($alltimeMedal['short']) ?></span>
          <?php endif; ?>
        <?php else: ?>
          <span class="note">未超过你的历史最好成绩</span>
        <?php endif; ?>
      </td>
    </tr>
  </table>
  <h2>各题得分</h2>
  <table>
    <tr>
      <?php foreach ($result['boards'] as $label => $boardScore): ?>
      <th class="num"><?= e((string) $label) ?></th>
      <?php endforeach; ?>
    </tr>
    <tr>
      <?php foreach ($result['boards'] as $boardScore): ?>
      <td class="num"><?= format_score((float) $boardScore) ?></td>
      <?php endforeach; ?>
    </tr>
  </table>
  <p class="note" style="margin-bottom:0"><a href="./">查看周榜 →</a> · <a href="alltime.php">查看总榜 →</a></p>
</div>
<?php endif; ?>

<form class="card" method="post" enctype="multipart/form-data">
  <input type="hidden" name="csrf" value="<?= e($token) ?>">
  <p class="sub" style="margin:0 0 14px">以账号 <strong><?= e((string) $user['username']) ?></strong> 的身份上传。</p>
  <label for="replay">存档文件</label>
  <input type="file" id="replay" name="replay" accept=".dat,application/json" required>
  <p class="note">在游戏结束界面点「导出 .dat」即可得到，文件名形如 <code>AKNOI-种子-分数.dat</code>。</p>
  <button type="submit">上传并校验</button>
</form>

<div class="card">
  <h2 style="margin-top:0">说明</h2>
  <ol>
    <li>服务端会用和游戏完全一致的引擎重放你的操作序列，分数以重算结果为准。</li>
    <li>改文件里的 <code>score</code> 没用 —— 对不上重算结果会被直接拒绝。</li>
    <li>只有六道题全部提交、这一局真正打完了才能上榜。</li>
    <li>周榜只统计本周种子 <code><?= e($weekSeed) ?></code> 的局；其他种子的局只计总榜。</li>
    <li>同一局（相同种子 + 相同操作）每周只会记录一次。</li>
    <li>两个榜都只保留最好成绩：分数更高会顶掉旧记录，等于或更低会被拒绝。</li>
  </ol>
  <p class="note" style="margin-bottom:0"><a href="./">周榜</a> · <a href="alltime.php">总榜</a> · <a href="register.php">注册新账号</a></p>
</div>
<?php
render_page('上传成绩', (string) ob_get_clean());
