# 评测队列 · Judge Queue

一款 OI 背景的高难度合成卡牌游戏。

每轮必须把三张提交牌全部放入四道题的评测队列。相邻且相同的评测状态会依次合并：

`CE → Judging → RE → TLE → MLE → WA → PC → AC`

让 T1～T4 各产生一次 AC 即可 AK；当剩余手牌全部无处可放时 AFO。

## 策略工具

- **回滚栈**：消耗思考点，撤销上次提交。
- **记忆化**：把一张手牌存入缓存，之后可以交换。
- **并查集**：合并两条队列中相同的队尾状态。
- **Hack 数据**：每 6 轮出现，使指定队尾降级。

## 运行

```bash
npm install
npm run dev
```

## 结构

- `src/data/verdicts.ts`：评测状态与题目数据
- `src/game/engine.ts`：纯函数游戏规则
- `src/components/`：卡牌与界面组件
