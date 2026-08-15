export const BOARD_SIZE = 6
export const AC_LEVEL = 6

export interface VerdictDefinition {
  id: string
  label: string
  multiplier: number
  color: string
  ink: string
}

export interface ShapeTemplate {
  rows: number
  cols: number
}

export const VERDICTS: VerdictDefinition[] = [
  { id: 'ce', label: 'CE', multiplier: 0, color: '#f1c40f', ink: '#4b3b00' },
  { id: 're', label: 'RE', multiplier: 0, color: '#9b59b6', ink: '#ffffff' },
  { id: 'uke', label: 'UKE', multiplier: 0.1, color: '#4b3f92', ink: '#ffffff' },
  { id: 'mle', label: 'MLE', multiplier: 0.2, color: '#205493', ink: '#ffffff' },
  { id: 'tle', label: 'TLE', multiplier: 0.4, color: '#123f70', ink: '#ffffff' },
  { id: 'wa', label: 'WA', multiplier: 0.8, color: '#e74c3c', ink: '#ffffff' },
  { id: 'ac', label: 'AC', multiplier: 1, color: '#52c41a', ink: '#123b08' },
]

export const GENERATED_SHAPES: ShapeTemplate[] = [
  { rows: 1, cols: 2 },
  { rows: 2, cols: 1 },
  { rows: 1, cols: 3 },
  { rows: 3, cols: 1 },
  { rows: 2, cols: 2 },
  { rows: 1, cols: 4 },
  { rows: 4, cols: 1 },
  { rows: 2, cols: 3 },
  { rows: 3, cols: 2 },
]
