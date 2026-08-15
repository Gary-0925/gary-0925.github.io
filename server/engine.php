<?php
/**
 * AKNOI 游戏引擎的 PHP 移植版。
 *
 * 这是 src/game/engine.ts 的逐函数对照实现，用途只有一个：
 * 服务端拿到「种子 + 操作序列」后自己把整局重跑一遍，算出真实分数，
 * 再和上传文件里声称的分数比对。前端报的分数一律不可信。
 *
 * 因为要复现 JS 的结果，下面几处必须逐位对齐：
 *   - hashSeed  : FNV-1a，对 UTF-16 码元做异或
 *   - nextRandom: mulberry32，全程 uint32 运算
 *   - Math.imul : 32 位有符号乘法，要拆成高低 16 位算，否则 64 位会溢出成 float
 *   - Math.round: 用 floor(x + 0.5)，不要用 PHP 的 round()（半数进位规则不同）
 *   - 数组排序  : 显式稳定排序，不依赖 PHP 版本的 usort 稳定性
 *
 * 任何一处改动都必须同步改 engine.ts，否则合法成绩会被判为作弊。
 * 对应的前端版本：src/game/engine.ts
 */

declare(strict_types=1);

const AKNOI_BOARD_SIZE = 6;
const AKNOI_AC_LEVEL = 6;
const AKNOI_MAX_TOTAL = 600.0;

const AKNOI_BOARD_LABELS = ['D1T1', 'D1T2', 'D1T3', 'D2T1', 'D2T2', 'D2T3'];
const AKNOI_SUBTASK_SCORES = [10, 20, 30, 40, 50, 60, 70, 80, 90];

/** VERDICTS 的分数系数，顺序必须和 src/data/verdicts.ts 一致。 */
const AKNOI_VERDICT_MULTIPLIERS = [0.0, 0.0, 0.1, 0.2, 0.4, 0.8, 1.0];

/** GENERATED_SHAPES，顺序必须和 src/data/verdicts.ts 一致。 */
function aknoi_generated_shapes(): array
{
    return [
        ['rows' => 1, 'cols' => 2],
        ['rows' => 2, 'cols' => 1],
        ['rows' => 1, 'cols' => 3],
        ['rows' => 3, 'cols' => 1],
        ['rows' => 2, 'cols' => 2],
        ['rows' => 1, 'cols' => 4],
        ['rows' => 4, 'cols' => 1],
        ['rows' => 2, 'cols' => 3],
        ['rows' => 3, 'cols' => 2],
    ];
}

/* ------------------------------------------------------------------ */
/* 32 位整数与 JS 语义                                                  */
/* ------------------------------------------------------------------ */

/** 截成 uint32，等价于 JS 的 `x >>> 0`。 */
function aknoi_u32(int $value): int
{
    return $value & 0xFFFFFFFF;
}

/**
 * Math.imul 的等价实现，返回 uint32。
 *
 * 不能直接写 ($a * $b) & 0xFFFFFFFF：两个 32 位数相乘最大接近 2^64，
 * 会超过 PHP_INT_MAX 变成 float 而丢精度。所以拆成 16 位分块相乘。
 */
function aknoi_imul(int $a, int $b): int
{
    $a = $a & 0xFFFFFFFF;
    $b = $b & 0xFFFFFFFF;

    $ah = ($a >> 16) & 0xFFFF;
    $al = $a & 0xFFFF;
    $bh = ($b >> 16) & 0xFFFF;
    $bl = $b & 0xFFFF;

    // 高 16 位乘高 16 位的结果整体溢出 32 位，可以直接丢掉。
    $cross = (($ah * $bl) + ($al * $bh)) & 0xFFFF;
    return (($al * $bl) + ($cross << 16)) & 0xFFFFFFFF;
}

/** JS 的 Math.round：对正数等于 floor(x + 0.5)，和 PHP round() 的半数规则不同。 */
function aknoi_js_round(float $value): float
{
    return floor($value + 0.5);
}

/** 保留一位小数，对齐 engine.ts 里的 `Math.round(x * 10) / 10`。 */
function aknoi_round1(float $value): float
{
    return aknoi_js_round($value * 10) / 10;
}

/**
 * 取字符串的 UTF-16 码元序列，对应 JS 的 charCodeAt。
 * 种子已经限定为 ASCII，这里做完整实现只是为了不留隐患。
 */
function aknoi_utf16_units(string $text): array
{
    $encoded = @mb_convert_encoding($text, 'UTF-16LE', 'UTF-8');
    if ($encoded === false || $encoded === '') {
        return [];
    }
    $units = [];
    $length = strlen($encoded);
    for ($index = 0; $index + 1 < $length; $index += 2) {
        $units[] = ord($encoded[$index]) | (ord($encoded[$index + 1]) << 8);
    }
    return $units;
}

/** FNV-1a，对齐 engine.ts 的 hashSeed。 */
function aknoi_hash_seed(string $seed): int
{
    $hash = 2166136261;
    foreach (aknoi_utf16_units($seed) as $code) {
        $hash = ($hash ^ $code) & 0xFFFFFFFF;
        $hash = aknoi_imul($hash, 16777619);
    }
    return $hash & 0xFFFFFFFF;
}

/**
 * mulberry32。$context 必须按引用传入，rngState 会被推进。
 * 返回 [0, 1) 的浮点数。
 */
function aknoi_next_random(array &$context): float
{
    $context['rngState'] = ($context['rngState'] + 0x6d2b79f5) & 0xFFFFFFFF;
    $value = $context['rngState'];

    $value = aknoi_imul($value ^ ($value >> 15), $value | 1);
    // JS 里这一步是 value ^= value + imul(...)，加法结果按 ToInt32 取模 2^32。
    $value = ($value ^ (($value + aknoi_imul($value ^ ($value >> 7), $value | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF;

    return (($value ^ ($value >> 14)) & 0xFFFFFFFF) / 4294967296;
}

function aknoi_uid(array &$context, string $prefix): string
{
    $context['nextId'] += 1;
    return $prefix . '-' . $context['nextId'];
}

/** Fisher-Yates，方向和 engine.ts 的 shuffle 一致（从后往前）。 */
function aknoi_shuffle(array $items, array &$context): array
{
    $result = array_values($items);
    for ($index = count($result) - 1; $index > 0; $index -= 1) {
        $target = (int) floor(aknoi_next_random($context) * ($index + 1));
        $swap = $result[$index];
        $result[$index] = $result[$target];
        $result[$target] = $swap;
    }
    return $result;
}

/**
 * 稳定排序。JS 的 Array#sort 规范要求稳定，PHP 只有 8.0+ 的 usort 才稳定，
 * 这里自己带上原始下标做次级比较，任何版本结果都一致。
 */
function aknoi_stable_sort(array $items, callable $comparator): array
{
    $decorated = [];
    foreach (array_values($items) as $index => $item) {
        $decorated[] = [$item, $index];
    }
    usort($decorated, static function (array $left, array $right) use ($comparator): int {
        $result = $comparator($left[0], $right[0]);
        if ($result !== 0) {
            return $result < 0 ? -1 : 1;
        }
        return $left[1] <=> $right[1];
    });
    return array_map(static fn(array $entry) => $entry[0], $decorated);
}

/* ------------------------------------------------------------------ */
/* 棋盘查询                                                             */
/* ------------------------------------------------------------------ */

function aknoi_get_subtask(array $board, string $subtaskId): array
{
    foreach ($board['subtasks'] as $subtask) {
        if ($subtask['id'] === $subtaskId) {
            return $subtask;
        }
    }
    throw new RuntimeException('未知的子任务：' . $subtaskId);
}

function aknoi_piece_size(array $board, array $piece): array
{
    if ($piece['kind'] === 'o2') {
        return ['rows' => 1, 'cols' => 1];
    }
    $subtask = aknoi_get_subtask($board, $piece['subtaskId']);
    return ['rows' => $subtask['rows'], 'cols' => $subtask['cols']];
}

function aknoi_piece_score(array $board, array $piece): float
{
    if ($piece['kind'] === 'o2') {
        return 0.0;
    }
    $subtask = aknoi_get_subtask($board, $piece['subtaskId']);
    $multiplier = AKNOI_VERDICT_MULTIPLIERS[$piece['verdictLevel']] ?? 0.0;
    return aknoi_round1($subtask['maxScore'] * $multiplier);
}

function aknoi_pieces_overlap(array $board, array $left, array $right): bool
{
    $leftSize = aknoi_piece_size($board, $left);
    $rightSize = aknoi_piece_size($board, $right);
    return !(
        $left['col'] + $leftSize['cols'] <= $right['col'] ||
        $right['col'] + $rightSize['cols'] <= $left['col'] ||
        $left['row'] + $leftSize['rows'] <= $right['row'] ||
        $right['row'] + $rightSize['rows'] <= $left['row']
    );
}

function aknoi_inside_board(array $board, array $piece): bool
{
    $size = aknoi_piece_size($board, $piece);
    return $piece['row'] >= 0
        && $piece['col'] >= 0
        && $piece['row'] + $size['rows'] <= AKNOI_BOARD_SIZE
        && $piece['col'] + $size['cols'] <= AKNOI_BOARD_SIZE;
}

function aknoi_cross_section_fits(array $board, array $moving, array $target, string $direction): bool
{
    $movingSize = aknoi_piece_size($board, $moving);
    $targetSize = aknoi_piece_size($board, $target);
    if ($direction === 'left' || $direction === 'right') {
        return $target['row'] <= $moving['row']
            && $target['row'] + $targetSize['rows'] >= $moving['row'] + $movingSize['rows'];
    }
    return $target['col'] <= $moving['col']
        && $target['col'] + $targetSize['cols'] >= $moving['col'] + $movingSize['cols'];
}

function aknoi_available_placements(array $board, array $subtask): array
{
    $placements = [];
    for ($row = 0; $row <= AKNOI_BOARD_SIZE - $subtask['rows']; $row += 1) {
        for ($col = 0; $col <= AKNOI_BOARD_SIZE - $subtask['cols']; $col += 1) {
            $candidate = [
                'kind' => 'verdict',
                'id' => 'candidate',
                'subtaskId' => $subtask['id'],
                'verdictLevel' => 0,
                'row' => $row,
                'col' => $col,
            ];
            $blocked = false;
            foreach ($board['pieces'] as $piece) {
                if (aknoi_pieces_overlap($board, $candidate, $piece)) {
                    $blocked = true;
                    break;
                }
            }
            if (!$blocked) {
                $placements[] = ['row' => $row, 'col' => $col];
            }
        }
    }
    return $placements;
}

function aknoi_available_o2_placements(array $board): array
{
    $placements = [];
    for ($row = 0; $row < AKNOI_BOARD_SIZE; $row += 1) {
        for ($col = 0; $col < AKNOI_BOARD_SIZE; $col += 1) {
            $candidate = ['kind' => 'o2', 'id' => 'candidate-o2', 'row' => $row, 'col' => $col];
            $blocked = false;
            foreach ($board['pieces'] as $piece) {
                if (aknoi_pieces_overlap($board, $candidate, $piece)) {
                    $blocked = true;
                    break;
                }
            }
            if (!$blocked) {
                $placements[] = ['row' => $row, 'col' => $col];
            }
        }
    }
    return $placements;
}

/** 1×1 是生成/填充单元，3×3 是 100 分块。排序后不能按下标取，只能按形状找。 */
function aknoi_unit_subtask(array $board): array
{
    foreach ($board['subtasks'] as $subtask) {
        if ($subtask['rows'] === 1 && $subtask['cols'] === 1) {
            return $subtask;
        }
    }
    throw new RuntimeException('棋盘缺少 1x1 子任务。');
}

/**
 * 100 分的那档。按分数找而不是按形状找：
 * T1 的 100 分是 2x2，其余题是 3x3。
 */
function aknoi_jackpot_subtask(array $board): array
{
    foreach ($board['subtasks'] as $subtask) {
        if ((int) $subtask['maxScore'] === 100) {
            return $subtask;
        }
    }
    throw new RuntimeException('棋盘缺少 100 分子任务。');
}

/* ------------------------------------------------------------------ */
/* 生成                                                                 */
/* ------------------------------------------------------------------ */

function aknoi_choose_spawn_subtask(array $board, array &$context): array
{
    $unit = aknoi_unit_subtask($board);
    $jackpot = aknoi_jackpot_subtask($board);
    $roll = aknoi_next_random($context);
    if ($roll < 0.8) {
        return $unit;
    }
    if ($roll < 0.985) {
        $middle = [];
        foreach ($board['subtasks'] as $subtask) {
            if ($subtask['id'] !== $unit['id'] && $subtask['id'] !== $jackpot['id']) {
                $middle[] = $subtask;
            }
        }
        return $middle[(int) floor(aknoi_next_random($context) * count($middle))];
    }
    return $jackpot;
}

/** 生成一枚新块。$board 与 $context 都按引用修改。 */
function aknoi_spawn_piece(array &$board, array &$context, ?array $forcedSubtask = null): ?string
{
    if ($forcedSubtask === null && aknoi_next_random($context) < 0.05) {
        $placements = aknoi_available_o2_placements($board);
        if (count($placements) > 0) {
            $placement = $placements[(int) floor(aknoi_next_random($context) * count($placements))];
            $piece = [
                'kind' => 'o2',
                'id' => aknoi_uid($context, 'o2'),
                'row' => $placement['row'],
                'col' => $placement['col'],
            ];
            $board['pieces'][] = $piece;
            return $piece['id'];
        }
    }

    $preferred = $forcedSubtask ?? aknoi_choose_spawn_subtask($board, $context);

    $fallback = aknoi_stable_sort(
        $board['subtasks'],
        static fn(array $left, array $right): int
            => ($left['rows'] * $left['cols']) - ($right['rows'] * $right['cols'])
    );

    $ordered = [$preferred];
    foreach ($fallback as $subtask) {
        if ($subtask['id'] !== $preferred['id']) {
            $ordered[] = $subtask;
        }
    }

    foreach ($ordered as $subtask) {
        $placements = aknoi_available_placements($board, $subtask);
        if (count($placements) === 0) {
            continue;
        }
        $placement = $placements[(int) floor(aknoi_next_random($context) * count($placements))];
        $verdictLevel = aknoi_next_random($context) < 0.88 ? 0 : 1;
        $piece = [
            'kind' => 'verdict',
            'id' => aknoi_uid($context, 'piece'),
            'subtaskId' => $subtask['id'],
            'verdictLevel' => $verdictLevel,
            'row' => $placement['row'],
            'col' => $placement['col'],
        ];
        $board['pieces'][] = $piece;
        return $piece['id'];
    }
    return null;
}

/** 两天的 T1 都是签到题：只有三档分，且 100 分那档是 2x2。 */
function aknoi_is_easy_problem(string $label): bool
{
    return substr($label, -2) === 'T1';
}

function aknoi_generate_subtasks(string $boardId, array &$context, bool $easy): array
{
    // 先把 jackpot 形状从池子里剔掉，中间档就不可能和它重复。
    $jackpotShape = $easy ? ['rows' => 2, 'cols' => 2] : ['rows' => 3, 'cols' => 3];
    $pool = [];
    foreach (aknoi_generated_shapes() as $shape) {
        if ($shape['rows'] === $jackpotShape['rows'] && $shape['cols'] === $jackpotShape['cols']) {
            continue;
        }
        $pool[] = $shape;
    }

    $middleCount = $easy ? 1 : 3;
    $generatedShapes = array_slice(aknoi_shuffle($pool, $context), 0, $middleCount);
    $scores = array_slice(aknoi_shuffle(AKNOI_SUBTASK_SCORES, $context), 0, $middleCount + 1);

    $shapes = array_merge(
        [['rows' => 1, 'cols' => 1]],
        $generatedShapes,
        [$jackpotShape]
    );

    $subtasks = [];
    $last = count($shapes) - 1;
    foreach ($shapes as $index => $shape) {
        $subtasks[] = [
            'id' => $boardId . '-subtask-' . ($index + 1),
            'rows' => $shape['rows'],
            'cols' => $shape['cols'],
            'maxScore' => $index === $last ? 100 : $scores[$index],
        ];
    }

    return aknoi_stable_sort(
        $subtasks,
        static fn(array $left, array $right): int => $left['maxScore'] - $right['maxScore']
    );
}

function aknoi_create_board(string $label, array &$context): array
{
    $id = 'problem-' . $label;
    $board = [
        'id' => $id,
        'label' => $label,
        'status' => 'active',
        'subtasks' => aknoi_generate_subtasks($id, $context, aknoi_is_easy_problem($label)),
        'pieces' => [],
        'currentScore' => 0.0,
        'submittedScore' => null,
    ];
    $unit = aknoi_unit_subtask($board);
    aknoi_spawn_piece($board, $context, $unit);
    aknoi_spawn_piece($board, $context, $unit);
    return $board;
}

function aknoi_start_game(string $seed = 'AKNOI'): array
{
    $normalized = trim($seed);
    if ($normalized === '') {
        $normalized = 'AKNOI';
    }

    $context = ['rngState' => aknoi_hash_seed($normalized), 'nextId' => 0];

    $boards = [];
    foreach (AKNOI_BOARD_LABELS as $label) {
        $boards[] = aknoi_create_board($label, $context);
    }

    return [
        'screen' => 'playing',
        'seed' => $normalized,
        'rngState' => $context['rngState'],
        'nextId' => $context['nextId'],
        'boards' => $boards,
        'contestScore' => 0.0,
        'moves' => 0,
        'mergeCount' => 0,
    ];
}

/* ------------------------------------------------------------------ */
/* 移动                                                                 */
/* ------------------------------------------------------------------ */

function aknoi_movement_delta(string $direction): array
{
    if ($direction === 'up') {
        return ['row' => -1, 'col' => 0];
    }
    if ($direction === 'down') {
        return ['row' => 1, 'col' => 0];
    }
    if ($direction === 'left') {
        return ['row' => 0, 'col' => -1];
    }
    return ['row' => 0, 'col' => 1];
}

function aknoi_order_pieces(array $board, string $direction): array
{
    return aknoi_stable_sort(
        $board['pieces'],
        static function (array $left, array $right) use ($board, $direction): int {
            $leftSize = aknoi_piece_size($board, $left);
            $rightSize = aknoi_piece_size($board, $right);

            if ($direction === 'left') {
                $primary = $left['col'] - $right['col'];
                return $primary !== 0 ? $primary : $left['row'] - $right['row'];
            }
            if ($direction === 'right') {
                $primary = ($right['col'] + $rightSize['cols']) - ($left['col'] + $leftSize['cols']);
                return $primary !== 0 ? $primary : $left['row'] - $right['row'];
            }
            if ($direction === 'up') {
                $primary = $left['row'] - $right['row'];
                return $primary !== 0 ? $primary : $left['col'] - $right['col'];
            }
            $primary = ($right['row'] + $rightSize['rows']) - ($left['row'] + $leftSize['rows']);
            return $primary !== 0 ? $primary : $left['col'] - $right['col'];
        }
    );
}

/**
 * 从前往后压实：每个块一次走到底，只会被已经落定的块挡住。
 * 返回 ['pieces' => 新的块列表, 'changed' => bool, 'merges' => int]。
 *
 * 这是纯函数，不消耗随机数 —— 和 engine.ts 里的 simulateMove 一致。
 */
function aknoi_simulate_move(array $board, string $direction): array
{
    $settled = [];
    $mergedIds = [];
    $delta = aknoi_movement_delta($direction);
    $changed = false;
    $merges = 0;

    foreach (aknoi_order_pieces($board, $direction) as $original) {
        $moving = $original;
        $collisions = [];
        $collisionPosition = null;

        while (true) {
            $proposed = $moving;
            $proposed['row'] = $moving['row'] + $delta['row'];
            $proposed['col'] = $moving['col'] + $delta['col'];

            if (!aknoi_inside_board($board, $proposed)) {
                break;
            }

            $collisions = [];
            foreach ($settled as $index => $target) {
                if (aknoi_pieces_overlap($board, $proposed, $target)) {
                    $collisions[] = $index;
                }
            }
            if (count($collisions) > 0) {
                $collisionPosition = $proposed;
                break;
            }
            $moving = $proposed;
        }

        $targetIndex = count($collisions) === 1 ? $collisions[0] : null;
        $target = $targetIndex !== null ? $settled[$targetIndex] : null;

        $fitsTarget = $target !== null
            && $collisionPosition !== null
            && !isset($mergedIds[$target['id']])
            && aknoi_cross_section_fits($board, $moving, $target, $direction);

        $o2Merge = $fitsTarget
            && $moving['kind'] === 'o2'
            && $target['kind'] === 'verdict'
            && $target['verdictLevel'] < AKNOI_AC_LEVEL;

        $verdictMerge = $fitsTarget
            && $moving['kind'] === 'verdict'
            && $target['kind'] === 'verdict'
            && $target['verdictLevel'] === $moving['verdictLevel']
            && $target['verdictLevel'] < AKNOI_AC_LEVEL;

        if ($target !== null && $target['kind'] === 'verdict' && $collisionPosition !== null && ($o2Merge || $verdictMerge)) {
            $settled[$targetIndex]['verdictLevel'] += 1;
            $mergedIds[$target['id']] = true;
            $changed = true;
            $merges += 1;
            continue;
        }

        if ($moving['row'] !== $original['row'] || $moving['col'] !== $original['col']) {
            $changed = true;
        }
        $settled[] = $moving;
    }

    return ['pieces' => $settled, 'changed' => $changed, 'merges' => $merges];
}

function aknoi_refresh_board_score(array &$board): void
{
    if ($board['status'] === 'submitted') {
        return;
    }
    $best = 0.0;
    foreach ($board['pieces'] as $piece) {
        $score = aknoi_piece_score($board, $piece);
        if ($score > $best) {
            $best = $score;
        }
    }
    $board['currentScore'] = $best;
}

function aknoi_refresh_contest(array &$state): void
{
    $sum = 0.0;
    foreach ($state['boards'] as $board) {
        $sum += $board['submittedScore'] ?? $board['currentScore'];
    }
    $state['contestScore'] = aknoi_round1($sum);
}

function aknoi_finish_if_complete(array &$state): void
{
    foreach ($state['boards'] as $board) {
        if ($board['status'] !== 'submitted') {
            return;
        }
    }
    $state['screen'] = 'finished';
}

function aknoi_move_board(array $state, string $direction): array
{
    if ($state['screen'] !== 'playing') {
        return $state;
    }

    $plans = [];
    $anyChanged = false;
    foreach ($state['boards'] as $index => $board) {
        if ($board['status'] === 'active') {
            $plan = aknoi_simulate_move($board, $direction);
            $plans[$index] = $plan;
            if ($plan['changed']) {
                $anyChanged = true;
            }
        } else {
            $plans[$index] = null;
        }
    }

    // 一步都动不了就不算一次操作，也不消耗随机数。
    if (!$anyChanged) {
        return $state;
    }

    $state['moves'] += 1;

    foreach ($state['boards'] as $index => $board) {
        $plan = $plans[$index];
        if ($plan === null || !$plan['changed'] || $board['status'] !== 'active') {
            continue;
        }

        $board['pieces'] = $plan['pieces'];
        $state['mergeCount'] += $plan['merges'];
        aknoi_refresh_board_score($board);

        // 生成时用的是整个 state 作为随机上下文，和 engine.ts 保持一致。
        aknoi_spawn_piece($board, $state);
        aknoi_refresh_board_score($board);

        $state['boards'][$index] = $board;
    }

    aknoi_refresh_contest($state);
    return $state;
}

function aknoi_submit_board(array $state, string $boardId): array
{
    if ($state['screen'] !== 'playing') {
        return $state;
    }

    $targetIndex = null;
    foreach ($state['boards'] as $index => $board) {
        if ($board['id'] === $boardId) {
            $targetIndex = $index;
            break;
        }
    }
    if ($targetIndex === null || $state['boards'][$targetIndex]['status'] !== 'active') {
        return $state;
    }

    $board = $state['boards'][$targetIndex];
    aknoi_refresh_board_score($board);
    $board['status'] = 'submitted';
    $board['submittedScore'] = $board['currentScore'];
    $state['boards'][$targetIndex] = $board;

    aknoi_refresh_contest($state);
    aknoi_finish_if_complete($state);
    return $state;
}

/**
 * 重放整局。$actions 是已经校验过结构的操作数组。
 * 失效的操作（比如提交一个不存在的题）直接跳过，与前端 replayGame 行为一致。
 */
function aknoi_replay_game(string $seed, array $actions): array
{
    $state = aknoi_start_game($seed);
    foreach ($actions as $action) {
        if ($action['type'] === 'move') {
            $state = aknoi_move_board($state, $action['direction']);
        } else {
            $state = aknoi_submit_board($state, $action['boardId']);
        }
    }
    return $state;
}

/**
 * 重放并汇总结果，供上传接口比对用。
 *
 * @return array{score:float,moves:int,finished:bool,boards:array<string,float>}
 */
function aknoi_verify_replay(string $seed, array $actions): array
{
    $state = aknoi_replay_game($seed, $actions);

    $boards = [];
    foreach ($state['boards'] as $board) {
        $boards[$board['label']] = (float) ($board['submittedScore'] ?? $board['currentScore']);
    }

    return [
        'score' => (float) $state['contestScore'],
        'moves' => (int) $state['moves'],
        'finished' => $state['screen'] === 'finished',
        'boards' => $boards,
    ];
}
