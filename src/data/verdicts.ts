import type { CardKind } from '../game/types'

export interface VerdictDefinition {
  id: string
  label: string
  fullName: string
  value: number
  color: string
  ink: string
}

export interface SpecialDefinition {
  kind: Exclude<CardKind, 'verdict'>
  label: string
  name: string
  code: string
  description: string
  tone: 'boost' | 'danger' | 'utility'
}

export const VERDICTS: VerdictDefinition[] = [
  { id: 'ce', label: 'CE', fullName: 'Compile Error', value: 2, color: '#d8d2c5', ink: '#514f49' },
  { id: 'judging', label: '…', fullName: 'Judging', value: 4, color: '#eadb9c', ink: '#675615' },
  { id: 're', label: 'RE', fullName: 'Runtime Error', value: 8, color: '#d9c6dd', ink: '#673f72' },
  { id: 'tle', label: 'TLE', fullName: 'Time Limit Exceeded', value: 16, color: '#efc397', ink: '#7f4319' },
  { id: 'mle', label: 'MLE', fullName: 'Memory Limit Exceeded', value: 32, color: '#bed6df', ink: '#275a6d' },
  { id: 'wa', label: 'WA', fullName: 'Wrong Answer', value: 64, color: '#e9aaa1', ink: '#832b25' },
  { id: 'pc', label: 'PC', fullName: 'Partially Correct', value: 128, color: '#d7bd77', ink: '#654b08' },
  { id: 'ac', label: 'AC', fullName: 'Accepted', value: 256, color: '#8fc6a2', ink: '#174f2c' },
]

export const SPECIAL_CARDS: Record<Exclude<CardKind, 'verdict'>, SpecialDefinition> = {
  o2: {
    kind: 'o2',
    label: 'O2',
    name: '吸氧',
    code: '#pragma O2',
    description: '状态升一级；若优于 RE，30% 概率优化出错并退回 RE。',
    tone: 'boost',
  },
  o3: {
    kind: 'o3',
    label: 'O3',
    name: '激进优化',
    code: '#pragma O3',
    description: '状态升两级；若不差于 RE，45% 概率直接变成 RE。',
    tone: 'danger',
  },
  hack: {
    kind: 'hack',
    label: 'Hack',
    name: '加强数据',
    code: 'hack.cpp',
    description: '队尾降一级；每 6 轮必定出现一张。',
    tone: 'danger',
  },
  gdb: {
    kind: 'gdb',
    label: 'GDB',
    name: '断点调试',
    code: 'break main',
    description: '删除 CE、Judging 或 RE；对其他状态无效。',
    tone: 'utility',
  },
  longLong: {
    kind: 'longLong',
    label: 'LL',
    name: 'long long',
    code: '#define int long long',
    description: '将 RE 或 WA 升一级；对其他状态无效。',
    tone: 'utility',
  },
  subtask: {
    kind: 'subtask',
    label: 'Sub',
    name: '骗取部分分',
    code: 'subtask 1',
    description: '将 TLE、MLE 或 WA 直接变成 PC。',
    tone: 'boost',
  },
}

export const PROBLEM_QUEUES = [
  { number: 'T1', title: '暖身模拟', algorithm: '模拟', complexity: 'O(n)' },
  { number: 'T2', title: '区间选择', algorithm: '贪心', complexity: 'O(n log n)' },
  { number: 'T3', title: '状态设计', algorithm: '动态规划', complexity: 'O(n²)' },
  { number: 'T4', title: '带权网络', algorithm: '图论', complexity: 'O((n+m) log n)' },
]

export const MAX_QUEUE_HEIGHT = 4
export const HAND_SIZE = 3
