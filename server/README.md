# AKNOI 排行榜后端

这些文件直接部署在 **站点根目录**（`aknoi.page.gd/`），所以打开 `https://aknoi.page.gd/` 就是排行榜。
游戏本体仍托管在 GitHub Pages，这个域名下只放排行榜后端。

用户在游戏里导出 `.dat` 存档，然后到 `submit.php` 手动上传；服务端**重放整局操作、自己算出分数**后才记入排行榜。

没有 JSON API，也没有自动提交。全是普通网页表单。

## 为什么是网页表单而不是 API

InfinityFree 免费主机会对所有请求做浏览器校验（要求客户端能执行 JS 并带上 `__test` cookie）。
curl、脚本、跨域 `fetch` 一律会拿到 403 或一段挑战页，免费版关不掉也绕不过。
做成普通网页后，请求全部由浏览器自己发出，天然满足这套校验。

## 部署

1. 把 `server/` 里的文件**全部传到 `htdocs/` 根目录**（不是子目录）。
   传完之后 `htdocs/` 里应该有 `index.php`、`submit.php`、`lib.php`、`engine.php`、`config.php`，
   以及原有的 `db/` 目录。
2. 复制 `config.local.example.php` 为 `config.local.php`，填好 `install_token` 和 `ip_salt`：

   ```bash
   php -r 'echo bin2hex(random_bytes(24)), "\n";'
   ```

   `config.local.php` 已在 `.gitignore` 里，不会进仓库。
3. 确认 `db/db.php` 存在（提供全局 `$db`，`lib.php` 会 `require` 它）。
4. 浏览器访问 `https://你的域名/install.php?token=你的令牌` 建表。
   老库也要跑一次：它会补建近一周排行榜需要的 `idx_recent` 索引。
5. **建完表后删掉 `install.php`。**
6. 打开 `https://你的域名/` 看排行榜，`https://你的域名/submit.php` 试传一个存档。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.php` | 排行榜首页。近一周成绩，支持按种子筛选、翻页、只看个人最好成绩。 |
| `submit.php` | 上传页面。接收 `.dat`，重算分数，写库。 |
| `engine.php` | 游戏引擎的 PHP 移植，和前端 `src/game/engine.ts` 逐位一致。 |
| `lib.php` | 配置、存档解析、限流、页面外壳。 |
| `config.php` | 默认配置（不含密钥）。 |
| `config.local.php` | 本地密钥配置，不进仓库。 |
| `install.php` | 一次性建表，用完删掉。 |

## 校验做了什么

`submit.php` 收到文件后依次做：

1. CSRF 令牌、名字非空且不超长。
2. 文件大小 ≤ `max_body_bytes`，且确实是上传上来的临时文件。
3. 解析 JSON，检查 `format` / `version` / `seed` 格式 / 每一个操作的合法性。
4. 限流：同一 IP（加盐哈希后存储）在 `rate_window` 秒内最多传 `rate_limit` 次。
5. **用 `engine.php` 从种子开始重放整个操作序列，算出真实分数。**
6. 拿重算结果和文件里写的 `score` 对账，差超过 0.05 就拒绝。
7. 要求这一局真的打完了（六道题全部提交）。
8. 按「种子 + 操作序列」算指纹，唯一索引保证同一局只上榜一次。

入库的分数**永远是服务端算出来的那个**，不是文件里写的那个。

改 `.dat` 里的 `score` 没有意义。想刷分只能真的构造出一个能跑出高分的操作序列，
而那和正常打一局是一回事。

## 分数口径

数据库里存的 `score` **永远是上机分**（0~600，引擎重放算出来的那个），`.dat` 里的也是。
笔试的 105 分只在**显示**的时候加上去，所以榜上看到的总分是 `上机分 + 105`，满分 705。

这样分开的好处是：引擎、存档、服务端校验三边始终用同一个数对账，
以后要调笔试分只改 `config.php` 里的 `written_exam_score` 就行，历史数据不用动。

## 近一周与奖牌

排行榜只显示最近 `leaderboard_days`（默认 7）天的成绩，奖牌线按**这个窗口内的总条数** `total` 算：

| 奖牌 | 名次范围 |
| --- | --- |
| Au 金 | 前 `min(50, ceil(total / 10))` 名 |
| Ag 银 | 到 `min(150, ceil(total * 3 / 10))` 名 |
| Cu 铜 | 到 `min(300, ceil(total * 6 / 10))` 名 |

三条线做了单调化处理（`max` 逐级抬），人很少的时候上界会互相压平，
比如 `total = 1` 时三条线都是 1，只发一块金牌，不会出现「银牌线比金牌线还靠前」。
人很多的时候 50 / 150 / 300 这三个上限会封顶。

「每人只留最好成绩」的那个 `NOT EXISTS` 子查询**也限定在同一个时间窗口内**，
否则上周的旧高分会把本周的成绩挤掉，榜上会出现空缺。

## 引擎一致性

`engine.php` 是 `src/game/engine.ts` 的逐行移植，两边必须在同一 `seed + actions` 下算出完全相同的分数，
否则诚实玩家会被当成作弊。

移植时需要注意 JS 和 PHP 的语义差异，`engine.php` 里都做了处理：

- `Math.imul` → `aknoi_imul()`，拆成 16 位分块相乘，避免 PHP 整数溢出成 float。
- `>>> 0` → `aknoi_u32()`。
- `Math.round` → `aknoi_js_round()`，JS 是 `floor(x + 0.5)`，PHP 的 `round()` 对 .5 的处理不一样。
- `charCodeAt` → `aknoi_utf16_units()`，按 UTF-16 码元取值，非 ASCII 种子才不会算错。
- `Array.prototype.sort` → `aknoi_stable_sort()`，带原索引比较，不依赖 PHP 版本的排序稳定性。

一致性由 `src/game/phpEngine.parity.test.ts` 保证：它启动一个真的 PHP 8.3（php-wasm），
用同样的种子和操作序列同时跑 TS 和 PHP 两边，逐项比对总分、步数、每题分数和开局棋盘。

```bash
npm test
```

## 已知的坑

- **`LIMIT ? / OFFSET ? / INTERVAL ? SECOND` 不能用占位符**。`db.php` 关了模拟预处理
  （`EMULATE_PREPARES = false`），这些位置在原生预处理下会报错。代码里都是强转 `int` 后直接拼进 SQL。
- **MySQL 5.7+ 默认开 `ONLY_FULL_GROUP_BY`**。「每人只留最好成绩」用 `NOT EXISTS` 实现，不要改成 `GROUP BY`。
- **免费主机拦截非浏览器请求**，所以别想着再加 JSON 接口，见开头。
- **`D1T1` / `D2T1` 只有三档子任务，100 分那档是 `2×2`**，其余四题仍是五档、`3×3`。
  这条规则在 `engine.php` 和 `src/game/engine.ts` 里各写了一遍，改一边必须改另一边，
  否则 parity 测试会红，线上会把诚实玩家判成作弊。
