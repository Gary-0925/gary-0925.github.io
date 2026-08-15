/**
 * 笔试分。
 *
 * 上机分（引擎算出来的 0~600）本身不含笔试分，存档和服务端校验用的
 * 都是纯上机分；只有「展示给人看」的时候才加上这 105 分。
 * 所以对外显示的总分范围是 105 ~ 705。
 */
export const WRITTEN_EXAM_SCORE = 105

/** 上机满分。 */
export const MAX_MACHINE_SCORE = 600

/** 对外显示的满分（含笔试分）。 */
export const MAX_TOTAL_SCORE = MAX_MACHINE_SCORE + WRITTEN_EXAM_SCORE

/** 上机分 → 含笔试分的总分。 */
export function withWrittenExam(machineScore: number) {
  return Math.round((machineScore + WRITTEN_EXAM_SCORE) * 10) / 10
}

/** 整数不带小数点，否则保留一位。 */
export function formatScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

/** 直接格式化成含笔试分的总分，展示层用这个。 */
export function formatTotalScore(machineScore: number) {
  return formatScore(withWrittenExam(machineScore))
}
