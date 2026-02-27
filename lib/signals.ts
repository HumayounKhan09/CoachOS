export function computeAdherenceRate(
  checkInsInLast7Days: number,
  checkInIntervalHours: number
): number {
  const expected = Math.floor((7 * 24) / checkInIntervalHours)
  const safeExpected = expected === 0 ? 1 : expected
  return Math.min(checkInsInLast7Days / safeExpected, 1.0)
}

export function computeDriftScore(params: {
  adherenceRate: number
  tasksWithHighFailure: number
  hoursSinceLastCheckIn: number | null
  lastSentiment: string | null
}): number {
  const { adherenceRate, tasksWithHighFailure, hoursSinceLastCheckIn, lastSentiment } = params

  let drift = 1.0 - adherenceRate
  drift += 0.1 * tasksWithHighFailure
  if (hoursSinceLastCheckIn !== null && hoursSinceLastCheckIn >= 48) {
    drift += 0.2
  }
  if (lastSentiment === 'stressed' || lastSentiment === 'overwhelmed') {
    drift += 0.1
  }
  if (lastSentiment === 'crisis') {
    drift += 0.2
  }

  return Math.min(drift, 1.0)
}

export function computeCheckInInterval(
  adherenceRate: number,
  driftScore: number,
  policies: { min_check_in_interval_hours: number; max_check_in_interval_hours: number }
): number {
  let interval: number
  if (adherenceRate > 0.8 && driftScore < 0.3) {
    interval = 48
  } else if (adherenceRate < 0.5 || driftScore > 0.5) {
    interval = 12
  } else {
    interval = 24
  }
  return Math.max(policies.min_check_in_interval_hours, Math.min(interval, policies.max_check_in_interval_hours))
}
