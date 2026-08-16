/**
 * Integration test for the PHP leaderboard server (server/).
 *
 * Boots a real PHP 8.3 runtime through php-wasm, serves the actual server/*.php
 * pages via PHPRequestHandler (real sessions, real multipart uploads), backed by
 * a SQLite stand-in for the production db/db.php (which is deployment-specific
 * and not in this repository).
 *
 * Exercises the weekly-leaderboard contract:
 *   - accounts: register / login / logout, login required to upload
 *   - SQL stores only the best score: one row per account per ISO week,
 *     better uploads update the row in place, equal/worse uploads are rejected
 *   - the "show all records" scope is gone from the leaderboard page
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  PHP,
  PHPRequestHandler,
  ProcessIdAllocator,
  setPhpIniEntries,
} from '@php-wasm/universal'
import { loadNodeRuntime } from '@php-wasm/node'
import { beforeAll, describe, expect, it } from 'vitest'
import { finishAnimation, moveBoard, replayGame, startGame, submitBoard } from '../game/engine'
import type { Direction, GameAction } from '../game/types'

const SERVER_DIR = fileURLToPath(new URL('../../server', import.meta.url))
const DOCROOT = '/www'

/**
 * Stand-in for htdocs/db/db.php: SQLite backend + MySQL dialect translation.
 * Template literal: every backtick must be escaped as \`.
 */
const STUB_DB_PHP = `<?php
/**
 * Test-only stand-in for the production db/db.php.
 * Provides the same \`dataBase\` interface, backed by SQLite, with a small
 * MySQL → SQLite translation layer for the handful of constructs used here.
 */
declare(strict_types=1);

if (!class_exists('dataBase')) {
    class dataBase
    {
        private PDO \$pdo;

        public function __construct(PDO \$pdo)
        {
            \$this->pdo = \$pdo;
            \$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            \$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            \$pdo->sqliteCreateFunction('NOW', static fn (): string => date('Y-m-d H:i:s'));
        }

        public function query(string \$sql, array \$params = []): PDOStatement
        {
            // install.php 的旧表检测：information_schema.COLUMNS → pragma_table_info
            if (stripos(\$sql, 'information_schema.COLUMNS') !== false) {
                \$table = (string) (\$params[0] ?? '');
                \$column = (string) (\$params[1] ?? '');
                if (preg_match('/^[A-Za-z0-9_]+$/', \$table) !== 1
                    || preg_match('/^[A-Za-z0-9_]+$/', \$column) !== 1) {
                    \$stmt = \$this->pdo->prepare('SELECT 0 AS n');
                    \$stmt->execute();
                    return \$stmt;
                }
                \$stmt = \$this->pdo->prepare(
                    'SELECT COUNT(*) AS n FROM pragma_table_info("' . \$table . '")'
                    . ' WHERE name = "' . \$column . '"'
                );
                \$stmt->execute();
                return \$stmt;
            }

            if (preg_match('/^RENAME TABLE \`([^\`]+)\` TO \`([^\`]+)\`\$/i', trim(\$sql), \$m) === 1) {
                \$stmt = \$this->pdo->prepare('ALTER TABLE \`' . \$m[1] . '\` RENAME TO \`' . \$m[2] . '\`');
                \$stmt->execute();
                return \$stmt;
            }

            if (preg_match('/^DESCRIBE \`([^\`]+)\`\$/i', trim(\$sql), \$m) === 1) {
                \$stmt = \$this->pdo->prepare(
                    "SELECT name AS Field, type AS Type, '' AS Key FROM pragma_table_info(?)"
                );
                \$stmt->execute([\$m[1]]);
                return \$stmt;
            }

            \$sql = \$this->translate(\$sql);
            \$stmt = \$this->pdo->prepare(\$sql);
            \$stmt->execute(\$params);
            return \$stmt;
        }

        private function translate(string \$sql): string
        {
            // (NOW() - INTERVAL n SECOND) → datetime 表达式
            \$sql = preg_replace(
                '/\\(NOW\\(\\) - INTERVAL (\\d+) SECOND\\)/i',
                "datetime('now', '-\$1 seconds')",
                \$sql
            ) ?? \$sql;
            // 裸 NOW() → datetime('now')
            \$sql = str_ireplace('NOW()', "datetime('now')", \$sql);
            // CREATE TABLE 尾部选项
            \$sql = preg_replace(
                '/\\s+ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/',
                '',
                \$sql
            ) ?? \$sql;
            // SQLite 没有 AUTO_INCREMENT 与普通 KEY 索引；
            // INT UNSIGNED 换成 INTEGER 才能让 PRIMARY KEY (id) 变成自增 rowid。
            \$sql = str_ireplace(' AUTO_INCREMENT', '', \$sql);
            \$sql = str_ireplace('INT UNSIGNED', 'INTEGER', \$sql);
            \$sql = preg_replace('/UNIQUE KEY \`?\\w+\`?/', 'UNIQUE', \$sql) ?? \$sql;
            \$sql = preg_replace('/,\\s*KEY \`?\\w+\`?\\s*\\([^)]*\\)/', '', \$sql) ?? \$sql;
            // 反引号 → 双引号
            \$sql = preg_replace('/\`([^\`]+)\`/', '"\$1"', \$sql) ?? \$sql;
            return \$sql;
        }
    }

    \$db = new dataBase(new PDO('sqlite:/www/db/aknoi.sqlite'));
}
`

const SERVER_PHP_FILES = [
  'config.php',
  'engine.php',
  'lib.php',
  'install.php',
  'index.php',
  'submit.php',
  'login.php',
  'register.php',
  'logout.php',
]

let php: PHP
let handler: PHPRequestHandler

/** alice 本周最好成绩所在种子（后面的种子筛选断言要用）。 */
let aliceBestSeed: string | null = null

/** Runs PHP code in the wasm runtime (used to inspect the SQLite db). */
async function runPhp(code: string): Promise<string> {
  const result = await php.run({ code })
  if (result.errors) throw new Error(`PHP error: ${result.errors}`)
  return result.text
}

/** SQL rows as JSON, through the same stub db the pages use. */
async function sqlRows(sql: string, params: (string | number)[] = []): Promise<Record<string, unknown>[]> {
  const payload = JSON.stringify(params)
  const out = await runPhp(`<?php
require '/www/db/db.php';
$params = json_decode(<<<'JSON'
${payload}
JSON, true);
$rows = $db->query(${JSON.stringify(sql)}, $params)->fetchAll();
echo json_encode($rows);
`)
  return JSON.parse(out) as Record<string, unknown>[]
}

async function get(path: string): Promise<{ status: number; html: string; location?: string }> {
  const res = await handler.request({ url: path })
  const location = res.headers['location']?.[0]
  return { status: res.httpStatusCode, html: res.text, location }
}

async function post(
  path: string,
  fields: Record<string, string | File>,
): Promise<{ status: number; html: string; location?: string }> {
  const res = await handler.request({ url: path, method: 'POST', body: fields })
  const location = res.headers['location']?.[0]
  return { status: res.httpStatusCode, html: res.text, location }
}

/** Extracts the CSRF token from a rendered form page. */
function csrfOf(html: string): string {
  const match = html.match(/name="csrf" value="([0-9a-f]+)"/)
  if (!match) throw new Error(`CSRF token not found in page: ${html.slice(0, 400)}`)
  return match[1]
}

/** 当前会话的 CSRF 令牌：从能渲染出表单的页面里取。 */
async function sessionCsrf(): Promise<string> {
  const submit = await get('/submit.php')
  if (submit.html.includes('name="csrf"')) return csrfOf(submit.html)
  const login = await get('/login.php')
  return csrfOf(login.html)
}

/** 上机分 → 页面展示的总分（笔试 105）。 */
function displayScore(machineScore: number): string {
  const total = Math.round((machineScore + 105) * 10) / 10
  return Math.abs(total - Math.round(total)) < 0.0001 ? String(Math.round(total)) : total.toFixed(1)
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function makeRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function playRandomGame(seed: string, rng: () => number, steps: number) {
  let state = startGame(seed)
  const actions: GameAction[] = []

  for (let index = 0; index < steps; index += 1) {
    if (state.screen !== 'playing') break

    const active = state.boards.filter((board) => board.status === 'active')
    if (active.length > 0 && rng() < 0.06) {
      const board = active[Math.floor(rng() * active.length)]
      const next = finishAnimation(submitBoard(state, board.id))
      if (next !== state) actions.push({ type: 'submit', boardId: board.id })
      state = next
      continue
    }

    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]
    const next = finishAnimation(moveBoard(state, direction))
    if (next !== state) actions.push({ type: 'move', direction })
    state = next
  }

  return { state, actions }
}

/**
 * A replay that is fully finished, exactly like an exported .dat file.
 * With steps = 0 the boards are submitted immediately, which yields a very
 * low score — handy when a test needs a game that is clearly worse.
 */
function finishedReplay(
  seed: string,
  rngSeed: number,
  steps = 120,
): { seed: string; actions: GameAction[]; score: number } {
  const rng = makeRng(rngSeed)
  let { state, actions } = playRandomGame(seed, rng, steps)

  for (const board of state.boards) {
    if (board.status !== 'active') continue
    const next = finishAnimation(submitBoard(state, board.id))
    if (next !== state) actions.push({ type: 'submit', boardId: board.id })
    state = next
  }

  if (state.screen !== 'finished') {
    throw new Error(`seed ${seed} did not finish`)
  }
  const replayState = replayGame(seed, actions)
  return { seed, actions, score: replayState.contestScore }
}

function replayDat(replay: { seed: string; actions: GameAction[]; score: number }): string {
  return JSON.stringify({
    format: 'aknoi-replay',
    version: 1,
    seed: replay.seed,
    score: replay.score,
    moves: 0,
    finished: true,
    actions: replay.actions,
    exportedAt: '2026-08-16T00:00:00.000Z',
  })
}

beforeAll(async () => {
  const allocator = new ProcessIdAllocator()
  const runtime = await loadNodeRuntime('8.3', {
    emscriptenOptions: { processId: allocator.claim() },
  })
  php = new PHP(runtime)
  await setPhpIniEntries(php, {
    'session.save_path': '/tmp',
    'session.use_cookies': '1',
    'session.use_strict_mode': '0',
  })
  handler = new PHPRequestHandler({ php, documentRoot: DOCROOT })

  php.mkdir('/www/db')
  php.writeFile('/www/db/db.php', STUB_DB_PHP)

  for (const file of SERVER_PHP_FILES) {
    php.writeFile(`/www/${file}`, readFileSync(`${SERVER_DIR}/${file}`, 'utf8'))
  }

  // 部署方式：config.php 保持默认，config.local.php 覆盖令牌和盐。
  php.writeFile('/www/config.php', readFileSync(`${SERVER_DIR}/config.php`, 'utf8'))
  php.writeFile(
    '/www/config.local.php',
    `<?php
return ['install_token' => 'test-token', 'ip_salt' => 'test-salt'];
`,
  )

  // 模拟旧版成绩表（按名字记多条记录），验证 install.php 会把它改名备份。
  await runPhp(`<?php
require '/www/db/db.php';
$db->query('CREATE TABLE aknoi_scores (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(32) NOT NULL,
    seed VARCHAR(32) NOT NULL,
    score DECIMAL(5,1) NOT NULL DEFAULT 0.0,
    moves INT UNSIGNED NOT NULL DEFAULT 0,
    action_count INT UNSIGNED NOT NULL DEFAULT 0,
    actions MEDIUMTEXT NOT NULL,
    replay_hash CHAR(64) NOT NULL,
    ip_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_replay (replay_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
echo 'legacy table created';
`)
})

describe('server leaderboard', () => {
  it('installs the new schema and backs up the legacy table', async () => {
    const res = await handler.request({ url: '/install.php?token=test-token' })
    expect(res.httpStatusCode).toBe(200)
    expect(res.text).toContain('账号表')
    expect(res.text).toContain('成绩表')

    const legacy = await sqlRows(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'aknoi_scores_legacy_%'",
    )
    expect(legacy.length).toBe(1)

    const users = await sqlRows(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='aknoi_users'",
    )
    expect(users.length).toBe(1)

    const scoresCols = await sqlRows("SELECT name FROM pragma_table_info('aknoi_scores')")
    const colNames = scoresCols.map((row) => row.name)
    expect(colNames).toContain('user_id')
    expect(colNames).toContain('week_key')
    expect(colNames).not.toContain('name')
  })

  it('rejects install.php without a valid token', async () => {
    const res = await handler.request({ url: '/install.php' })
    expect(res.httpStatusCode).toBe(403)
  })

  it('every PHP file has no parse errors', async () => {
    for (const file of ['install.php', 'index.php', 'submit.php', 'login.php', 'register.php', 'logout.php']) {
      try {
        await php.run({ code: `<?php require '/www/${file}';` })
      } catch (error) {
        const message = String((error as { message?: string }).message ?? error)
        if (/Parse error|syntax error|Fatal error/i.test(message)) {
          throw new Error(`parse error in ${file}: ${message}`)
        }
        // 其他退出（如未登录跳转、install 令牌校验失败）属于正常流程。
      }
    }
  })

  it('registers an account and lands on the weekly leaderboard', async () => {
    const page = await get('/register.php')
    expect(page.status).toBe(200)

    const res = await post('/register.php', {
      csrf: csrfOf(page.html),
      username: 'alice',
      password: 'secret1',
      confirm: 'secret1',
    })
    expect(res.status).toBe(302)
    expect(res.location).toBe('./')

    // 已自动登录：导航里出现用户名。
    const home = await get('/')
    expect(home.html).toContain('class="who">alice<')
    expect(home.html).toContain('本周榜')
    expect(home.html).not.toContain('显示每个人的全部记录')
    expect(home.html).not.toContain('scope')
    expect(home.html).toContain('共 0 人')
  })

  it('rejects duplicate usernames and wrong passwords', async () => {
    // 注册页在已登录时会跳走，先退出。
    await get('/logout.php?csrf=' + (await sessionCsrf()))

    const page = await get('/register.php')
    const res = await post('/register.php', {
      csrf: csrfOf(page.html),
      username: 'alice',
      password: 'secret1',
      confirm: 'secret1',
    })
    expect(res.html).toContain('这个用户名已经被注册了')

    const loginPage = await get('/login.php')
    const bad = await post('/login.php', {
      csrf: csrfOf(loginPage.html),
      username: 'alice',
      password: 'wrong-password',
    })
    expect(bad.html).toContain('用户名或密码不对')

    const ok = await post('/login.php', {
      csrf: csrfOf(loginPage.html),
      username: 'alice',
      password: 'secret1',
    })
    expect(ok.status).toBe(302)
    const home = await get('/')
    expect(home.html).toContain('class="who">alice<')
  })

  it('uploads a finished game: stored, ranked #1, one row only', async () => {
    const aliceBest = finishedReplay('ALICE-BEST', 20260815)

    const submitPage = await get('/submit.php')
    expect(submitPage.html).toContain('以账号 <strong>alice</strong> 的身份上传')

    const res = await post('/submit.php', {
      csrf: csrfOf(submitPage.html),
      replay: new File([replayDat(aliceBest)], `AKNOI-${aliceBest.seed}.dat`),
    })
    expect(res.html).toContain('上传成功，分数已通过服务端重算校验。')
    expect(res.html).toContain('第 1 名')
    expect(res.html).toContain(`<td><strong>${displayScore(aliceBest.score)}</strong>`)

    // SQL 里只有一行，就是最好成绩。
    const rows = await sqlRows('SELECT COUNT(*) AS n, MAX(score) AS best FROM aknoi_scores')
    expect(Number(rows[0].n)).toBe(1)
    expect(Number(rows[0].best)).toBeCloseTo(aliceBest.score, 6)

    const home = await get('/')
    expect(home.html).toContain('共 1 人')
    expect(home.html).toContain('<td>alice</td>')
  })

  it('rejects equal or worse replays; a better one updates the single row', async () => {
    const aliceBest = finishedReplay('ALICE-BEST', 20260815)

    // 同样的文件再传一次：等于本周最好成绩 → 拒绝。
    const submitPage = await get('/submit.php')
    const same = await post('/submit.php', {
      csrf: csrfOf(submitPage.html),
      replay: new File([replayDat(aliceBest)], 'dup.dat'),
    })
    expect(same.html).toContain('没有超过你本周的最好成绩')

    // 更差的一局（直接提交的低分局）→ 拒绝。
    let worse: ReturnType<typeof finishedReplay> | null = null
    for (const seed of ['ALICE-WORSE1', 'ALICE-WORSE2', 'ALICE-WORSE3']) {
      const candidate = finishedReplay(seed, 0, 0)
      if (candidate.score < aliceBest.score) {
        worse = candidate
        break
      }
    }
    if (!worse) throw new Error('no worse game found')
    const bad = await post('/submit.php', {
      csrf: csrfOf(submitPage.html),
      replay: new File([replayDat(worse)], 'worse.dat'),
    })
    expect(bad.html).toContain('没有超过你本周的最好成绩')

    // 更高的一局 → 原地更新，行数不变。
    let better: ReturnType<typeof finishedReplay> | null = null
    for (const [seed, rngSeed] of [
      ['ALICE-NEW1', 999],
      ['ALICE-NEW2', 777],
      ['ALICE-NEW3', 555],
    ] as const) {
      const candidate = finishedReplay(seed, rngSeed)
      if (candidate.score > aliceBest.score) {
        better = candidate
        break
      }
    }
    if (!better) throw new Error('no better game found')
    if (better.seed === aliceBest.seed) throw new Error('same seed')

    const ok = await post('/submit.php', {
      csrf: csrfOf(submitPage.html),
      replay: new File([replayDat(better)], 'better.dat'),
    })
    expect(ok.html).toContain('比本周最好成绩更高，记录已更新。')

    const rows = await sqlRows('SELECT COUNT(*) AS n, MAX(score) AS best, week_key FROM aknoi_scores')
    expect(Number(rows[0].n)).toBe(1)
    expect(Number(rows[0].best)).toBeCloseTo(better.score, 6)
    expect(String(rows[0].week_key)).toMatch(/^\d{4}-W\d{2}$/)
    aliceBestSeed = better.seed
  })

  it('rejects unfinished games', async () => {
    const rng = makeRng(424242)
    let state = startGame('UNFINISHED1')
    const actions: GameAction[] = []
    for (let i = 0; i < 40; i += 1) {
      if (state.screen !== 'playing') break
      const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]
      const next = finishAnimation(moveBoard(state, direction))
      if (next !== state) actions.push({ type: 'move', direction })
      state = next
    }
    if (state.screen === 'finished') throw new Error('expected unfinished game')

    const replay = replayGame('UNFINISHED1', actions)
    const submitPage = await get('/submit.php')
    const res = await post('/submit.php', {
      csrf: csrfOf(submitPage.html),
      replay: new File([replayDat({ seed: 'UNFINISHED1', actions, score: replay.contestScore })], 'unfinished.dat'),
    })
    expect(res.html).toContain('这局还没打完')
  })

  it('a second account uploads and the board shows both, best first', async () => {
    const aliceBest = Number((await sqlRows('SELECT MAX(score) AS best FROM aknoi_scores'))[0].best)
    let bobGame: ReturnType<typeof finishedReplay> | null = null
    for (const seed of ['BOB-GAME1', 'BOB-GAME2', 'BOB-GAME3', 'BOB-GAME4', 'BOB-GAME5']) {
      const candidate = finishedReplay(seed, 0, 0) // 立即提交的低分局
      if (candidate.score < aliceBest) {
        bobGame = candidate
        break
      }
    }
    if (!bobGame) throw new Error('no game below alice found')

    // alice 还登录着，注册页会跳走，先退出。
    await get('/logout.php?csrf=' + (await sessionCsrf()))
    const reg = await get('/register.php')
    const res = await post('/register.php', {
      csrf: csrfOf(reg.html),
      username: 'bob',
      password: 'secret2',
      confirm: 'secret2',
    })
    expect(res.status).toBe(302)

    const submitPage = await get('/submit.php')
    const ok = await post('/submit.php', {
      csrf: csrfOf(submitPage.html),
      replay: new File([replayDat(bobGame)], 'bob.dat'),
    })
    expect(ok.html).toContain('上传成功')

    const home = await get('/')
    expect(home.html).toContain('共 2 人')
    expect(home.html).toContain('<td>alice</td>')
    expect(home.html).toContain('<td>bob</td>')
    // 分数高的 alice 排在 bob 前面。
    expect(home.html.indexOf('<td>alice</td>')).toBeLessThan(home.html.indexOf('<td>bob</td>'))

    // 种子筛选：不存在的种子 → 空榜；alice 的种子 → 只剩 alice。
    const empty = await get('/?seed=NOPE')
    expect(empty.html).toContain('本周还没有成绩')
    const filtered = await get(`/?seed=${aliceBestSeed}`)
    expect(filtered.html).toContain('<td>alice</td>')
    expect(filtered.html).not.toContain('<td>bob</td>')
  })

  it('anonymous uploads redirect to login', async () => {
    await get('/logout.php?csrf=' + (await sessionCsrf()))

    const res = await get('/submit.php')
    expect(res.status).toBe(302)
    expect(res.location).toContain('login.php')

    // 登录后还能正常回到上传页。
    const loginPage = await get('/login.php')
    await post('/login.php', {
      csrf: csrfOf(loginPage.html),
      username: 'alice',
      password: 'secret1',
    })
    const submitPage = await get('/submit.php')
    expect(submitPage.status).toBe(200)
  })
})
