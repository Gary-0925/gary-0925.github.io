# AKNOI 排行榜 API

部署在 `aknoi.page.gd/api/` 下的 PHP 接口，复用同站 `../db/db.php` 里已有的 `$db`（`dataBase` 实例）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `config.php` | 默认配置。**不含密钥**，可以进仓库。 |
| `config.local.example.php` | 本地配置模板，复制成 `config.local.php` 后填密钥。 |
| `lib.php` | 公共库：CORS、JSON 响应、参数校验、限流、回放指纹。 |
| `install.php` | 一次性建表脚本，建完请删掉。 |
| `submit.php` | `POST` 提交成绩。 |
| `leaderboard.php` | `GET` 读排行榜。 |
| `replay.php` | `GET` 取某条成绩的完整操作序列。 |

## 部署步骤

1. 把 `api/` 整个目录上传到网站根目录下，使其成为 `aknoi.page.gd/api/`。
   确认 `../db/db.php` 存在（即 `aknoi.page.gd/db/db.php`）。
2. 复制 `config.local.example.php` 为 `config.local.php`，填入 `install_token` 和 `ip_salt`。
3. 浏览器访问 `https://aknoi.page.gd/api/install.php?token=你的令牌` 建表。
4. 看到「表已就绪」后，**删除 `install.php`**。

> `config.local.php` 已加入 `.gitignore`。另外你贴出来的 `db.php` 里带着明文数据库密码，
> 那份文件不要提交到公开仓库；密码既然已经出现在聊天里，建议去控制面板改一次。

## 接口

### POST `/api/submit.php`

```json
{
  "name": "Gary",
  "seed": "K3X9ZQ1",
  "score": 428.6,
  "durationMs": 512340,
  "actions": [
    { "type": "move", "direction": "left" },
    { "type": "submit", "boardId": "problem-D1T2" }
  ]
}
```

返回 `201`：

```json
{ "ok": true, "id": 42, "score": 428.6, "moves": 137, "rank": 3, "best": 428.6, "duplicate": false }
```

同一份回放（种子 + 操作序列完全一致）重复提交不会新增记录，返回原记录且 `duplicate: true`。

### GET `/api/leaderboard.php`

| 参数 | 说明 |
| --- | --- |
| `limit` | 每页条数，1–100，默认 20 |
| `offset` | 偏移量，默认 0 |
| `seed` | 只看某个种子的榜单 |
| `scope` | `all`（默认，每局一行）或 `players`（每个昵称只留最好成绩） |
| `name` | 附带查询这个昵称的名次，放在返回的 `me` 字段 |

```json
{
  "ok": true, "scope": "all", "seed": null, "total": 128, "limit": 20, "offset": 0,
  "entries": [
    { "rank": 1, "id": 87, "name": "Gary", "seed": "K3X9ZQ1",
      "score": 600, "moves": 214, "durationMs": 733000, "createdAt": "2026-08-15 11:02:31" }
  ],
  "me": { "name": "Gary", "best": 600, "rank": 1 }
}
```

### GET `/api/replay.php?id=87`

返回该局的 `actions` 数组，前端可以直接喂给 `replayGame(seed, actions)` 复现整局。

## 错误格式

所有失败都返回 `{ "ok": false, "error": "错误码", "message": "中文说明" }`，
配合 HTTP 状态码：`400` 请求体问题、`404` 找不到、`405` 方法不对、
`413` 体积过大、`422` 参数不合法、`429` 提交太频繁、`500` 服务端出错。

## 两个已知的坑

**1. `db.php` 关掉了模拟预处理。** `PDO::ATTR_EMULATE_PREPARES => false` 之下，
`LIMIT ?` / `INTERVAL ? SECOND` 用占位符会被当字符串绑定而报语法错。
所以分页和时间窗口的值都先经过 `(int)` 转换再内联进 SQL —— 这些值不来自用户拼接，
是强制转成整数并夹在合法区间之后才拼的，没有注入面。其余所有用户输入一律走占位符。

**2. InfinityFree 免费主机会拦截非浏览器请求。** 它的安全系统要求客户端能执行
JavaScript 并保存 `__test` cookie，`curl`、Postman、服务器到服务器的调用通常会吃
403 或拿到一段 HTML，官方明确说免费版绕不过去，只有付费版没有这个限制。
从浏览器里的前端页面 `fetch` 是正常的，但要注意两点：cookie 得能带上，
所以跨域请求建议加 `credentials: 'include'`；调试时别用 `curl` 测，
测不通不代表代码有问题。如果想彻底避开，把 API 放到别的主机上。

## 前端调用示例

```ts
const API = 'https://aknoi.page.gd/api'

export async function submitScore(state: GameState, name: string) {
  const res = await fetch(`${API}/submit.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name,
      seed: state.seed,
      score: state.contestScore,
      actions: state.history,
    }),
  })
  if (!res.ok) throw new Error((await res.json()).message ?? '提交失败')
  return res.json()
}

export async function fetchLeaderboard(limit = 20) {
  const res = await fetch(`${API}/leaderboard.php?scope=players&limit=${limit}`, {
    credentials: 'include',
  })
  return res.json()
}
```

`state.history` 就是本地存档里那份操作序列，格式和 `submit.php` 要求的完全一致。

## 关于作弊

`submit.php` 只做**结构**校验（分数区间、操作合法性、长度上限、去重、限流），
它不会重新跑一遍游戏去验证「这个分数确实由这串操作产生」。
真要防刷分，得把 `src/game/engine.ts` 的推演逻辑用 PHP 重写一遍，
在服务端 replay 后比对分数。存下来的 `actions` 字段就是为这件事留的余地 ——
现在也可以先靠 `replay.php` 拉回放，在前端用现成的 `replayGame` 人工复核可疑成绩。
