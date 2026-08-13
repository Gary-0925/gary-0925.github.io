let context: AudioContext | null = null
let enabled = true

export function setSoundEnabled(value: boolean) {
  enabled = value
}

export function playSound(type: 'paper' | 'ink' | 'hit' | 'chain' | 'win' | 'enemy') {
  if (!enabled || typeof window === 'undefined') return

  try {
    context ??= new AudioContext()
    const now = context.currentTime
    const gain = context.createGain()
    const oscillator = context.createOscillator()
    oscillator.connect(gain)
    gain.connect(context.destination)

    const settings = {
      paper: [180, 0.025, 'triangle'],
      ink: [320, 0.04, 'sine'],
      hit: [130, 0.06, 'square'],
      chain: [620, 0.13, 'sine'],
      win: [780, 0.2, 'triangle'],
      enemy: [90, 0.09, 'sawtooth'],
    } as const
    const [frequency, duration, wave] = settings[type]
    oscillator.type = wave
    oscillator.frequency.setValueAtTime(frequency, now)
    if (type === 'chain' || type === 'win') {
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + duration)
    }
    gain.gain.setValueAtTime(0.035, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.start(now)
    oscillator.stop(now + duration)
  } catch {
    // Audio is purely decorative; unsupported browsers can stay silent.
  }
}
