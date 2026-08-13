export interface VerdictDefinition {
  id: string
  label: string
  fullName: string
  value: number
  color: string
  ink: string
}

export const VERDICTS: VerdictDefinition[] = [
  {
    id: 'ce',
    label: 'CE',
    fullName: 'Compile Error',
    value: 2,
    color: '#d8d2c5',
    ink: '#514f49',
  },
  {
    id: 'judging',
    label: '…',
    fullName: 'Judging',
    value: 4,
    color: '#eadb9c',
    ink: '#675615',
  },
  {
    id: 're',
    label: 'RE',
    fullName: 'Runtime Error',
    value: 8,
    color: '#d9c6dd',
    ink: '#673f72',
  },
  {
    id: 'tle',
    label: 'TLE',
    fullName: 'Time Limit Exceeded',
    value: 16,
    color: '#efc397',
    ink: '#7f4319',
  },
  {
    id: 'mle',
    label: 'MLE',
    fullName: 'Memory Limit Exceeded',
    value: 32,
    color: '#bed6df',
    ink: '#275a6d',
  },
  {
    id: 'wa',
    label: 'WA',
    fullName: 'Wrong Answer',
    value: 64,
    color: '#e9aaa1',
    ink: '#832b25',
  },
  {
    id: 'pc',
    label: 'PC',
    fullName: 'Partially Correct',
    value: 128,
    color: '#d7bd77',
    ink: '#654b08',
  },
  {
    id: 'ac',
    label: 'AC',
    fullName: 'Accepted',
    value: 256,
    color: '#8fc6a2',
    ink: '#174f2c',
  },
]

export const PROBLEM_QUEUES = [
  {
    number: 'T1',
    title: '暖身模拟',
    algorithm: '模拟',
    complexity: 'O(n)',
  },
  {
    number: 'T2',
    title: '区间选择',
    algorithm: '贪心',
    complexity: 'O(n log n)',
  },
  {
    number: 'T3',
    title: '状态设计',
    algorithm: '动态规划',
    complexity: 'O(n²)',
  },
  {
    number: 'T4',
    title: '带权网络',
    algorithm: '图论',
    complexity: 'O((n+m) log n)',
  },
]

export const MAX_QUEUE_HEIGHT = 4
export const HAND_SIZE = 3
