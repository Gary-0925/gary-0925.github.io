<?php
/**
 * 上传 .dat 存档，服务端重算分数后记入本周榜。
 *
 * 这是一个普通网页表单，不是 JSON API：
 * 用户在游戏里点「导出」拿到 .dat，再到这个页面选文件上传。
 * 服务端会用 engine.php 完整重放一遍操作序列，自己算出分数，
 * 存档里写的 score 只用来对账 —— 对不上就直接拒绝。
 *
 * 需要登录账号才能上传。每个账号每周只存一行最好成绩：
 * 比本周已有成绩高就更新那一行，等于或低于就直接拒绝，
 * 所以 SQL 里永远只有最好成绩，没有“全部记录”。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

// 未登录先去登录，登录后跳回本页。
$user = require_login($db);

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
        $weekKey = current_week_key();
        $fingerprint = replay_fingerprint($replay['seed'], $replay['actions']);
        $userId = (int) $user['id'];

        // 旧周的成绩全部清掉：表里只留本周最好成绩。
        $db->query(
            'DELETE FROM `' . $table . '` WHERE week_key <> ?',
            [$weekKey]
        );

        $existing = $db->query(
            'SELECT id, score FROM `' . $table . '`'
            . ' WHERE user_id = ? AND week_key = ? LIMIT 1',
            [$userId, $weekKey]
        )->fetch();

        if (is_array($existing)) {
            $best = (float) $existing['score'];
            if ($score <= $best + 0.0001) {
                throw new RuntimeException(sprintf(
                    '这局没有超过你本周的最好成绩（%s 分），不上榜。',
                    format_score($best)
                ));
            }

            // 同局只能上榜一次：换成了别人的指纹也不行。
            $dup = $db->query(
                'SELECT id FROM `' . $table . '`'
                . ' WHERE replay_hash = ? AND user_id <> ? LIMIT 1',
                [$fingerprint, $userId]
            )->fetch();
            if (is_array($dup)) {
                throw new RuntimeException('这局已经上过榜了，不能重复记录。');
            }

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
                    (int) $existing['id'],
                ]
            );
            $message = ['ok', '比本周最好成绩更高，记录已更新。'];
        } else {
            $dup = $db->query(
                'SELECT id FROM `' . $table . '` WHERE replay_hash = ? LIMIT 1',
                [$fingerprint]
            )->fetch();
            if (is_array($dup)) {
                throw new RuntimeException('这局已经上过榜了，不能重复记录。');
            }

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
            $message = ['ok', '上传成功，分数已通过服务端重算校验。'];
        }

        // 名次和奖牌都按本周榜算，否则页面上会对不上。
        $rankRow = $db->query(
            'SELECT COUNT(*) + 1 AS rank_value FROM `' . $table . '`'
            . ' WHERE week_key = ? AND score > ?',
            [$weekKey, $score]
        )->fetch();

        $totalRow = $db->query(
            'SELECT COUNT(*) AS total FROM `' . $table . '` WHERE week_key = ?',
            [$weekKey]
        )->fetch();

        $rank = (int) ($rankRow['rank_value'] ?? 0);
        $result = [
            'name' => (string) $user['username'],
            'seed' => $replay['seed'],
            'score' => $score,
            'moves' => (int) $verified['moves'],
            'boards' => $verified['boards'],
            'rank' => $rank,
            'week' => $weekKey,
            'medal' => medal_for_rank($rank, medal_cutoffs((int) ($totalRow['total'] ?? 0))),
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
<p class="sub">把游戏里导出的 <code>.dat</code> 存档传上来，服务器会重放整局操作、重新算分后记入本周榜。</p>

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
    <tr><th>当前排名</th><td>第 <?= (int) $result['rank'] ?> 名
      <span class="note">（<?= e($result['week']) ?> 周榜）</span>
      <?php if (!empty($result['medal'])): ?>
      <span class="medal <?= e($result['medal']['key']) ?>"><?= e($result['medal']['short']) ?></span>
      <?php endif; ?></td></tr>
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
  <p class="note" style="margin-bottom:0"><a href="./">查看排行榜 →</a></p>
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
    <li>同一局（相同种子 + 相同操作）每周只会记录一次。</li>
    <li>每个账号每周只保留最好的一局：分数更高会顶掉旧记录，等于或更低会被拒绝，排行榜上没有“全部记录”。</li>
  </ol>
  <p class="note" style="margin-bottom:0"><a href="./">排行榜</a> · <a href="register.php">注册新账号</a></p>
</div>
<?php
render_page('上传成绩', (string) ob_get_clean());
