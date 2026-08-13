# 评测队列 · Judge Queue

一款 OI 背景的高难度合成卡牌游戏。

每轮必须把三张提交牌全部放入四道题的评测队列。相邻且相同的评测状态会依次合并：

`CE → Judging → RE → TLE → MLE → WA → PC → AC`

让 T1～T4 各产生一次 AC 即可 AK；当剩余手牌全部无处可放时 AFO。

## 特殊卡

- **O2**：状态升一级；对优于 RE 的状态有 30% 概率优化出错并退回 RE。
- **O3**：状态升两级，但触发 RE 的风险更高。
- **Hack**：队尾状态降一级，每 6 轮强制出现。
- **GDB**：删除 CE、Judging 或 RE。
- **long long**：修复 RE 或 WA。
- **Subtask**：把 TLE、MLE 或 WA 变成 PC。

桌面端可直接拖放手牌；触屏设备可点选卡片后使用快速提交按钮。

## 运行

```bash
npm install
npm run dev
```

## 结构

- `src/data/verdicts.ts`：评测状态、特殊卡和题目数据
- `src/game/engine.ts`：纯函数游戏规则
- `src/components/`：卡牌与界面组件
