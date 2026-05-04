/**
 * Shared compensation math: employment-anchored salary proration and first-year bonus scale.
 * Calendar-day proration; UI may describe “last business day” pay; accrual uses month fractions.
 */

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function startOfMonthDate(year: number, month: number): Date {
  return new Date(year, month - 1, 1, 0, 0, 0, 0)
}

function endOfMonthDate(year: number, month: number): Date {
  return new Date(year, month, 0, 23, 59, 59, 999)
}

export function diffDaysInclusive(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1)
}

/** Full monthly base, including hire-month and compensation-start proration, when applicable. */
export function computeMonthlyBaseSalaryForPeriod(params: {
  year: number
  month: number
  fullMonthlyBase: number
  employmentStartDate: Date | null
  effectiveFrom: Date
}): number {
  const { year, month, fullMonthlyBase, employmentStartDate, effectiveFrom } = params
  if (fullMonthlyBase <= 0) return 0

  const periodStart = startOfMonthDate(year, month)
  const periodEnd = endOfMonthDate(year, month)
  const monthDays = diffDaysInclusive(periodStart, periodEnd)

  const emp = employmentStartDate
  if (emp) {
    const empSod = startOfDay(emp)
    if (periodEnd < empSod) {
      return 0
    }
    const inEmpMonth = empSod.getFullYear() === year && empSod.getMonth() + 1 === month
    if (inEmpMonth) {
      const activeStart = new Date(Math.max(periodStart.getTime(), empSod.getTime()))
      if (activeStart > periodEnd) return 0
      const activeDays = diffDaysInclusive(activeStart, periodEnd)
      const pr = monthDays > 0 ? activeDays / monthDays : 0
      return Number((fullMonthlyBase * pr).toFixed(2))
    }
    // Employed: full month after hire month
    return Number(fullMonthlyBase.toFixed(2))
  }

  // Legacy: no employment date — prorate the month of effectiveFrom if mid-month
  const eff = effectiveFrom
  const sameMonth = eff.getFullYear() === year && eff.getMonth() + 1 === month
  if (sameMonth && eff.getDate() > 1) {
    const effSod = startOfDay(eff)
    const activeStart = new Date(Math.max(periodStart.getTime(), effSod.getTime()))
    if (activeStart > periodEnd) return 0
    const activeDays = diffDaysInclusive(activeStart, periodEnd)
    const pr = monthDays > 0 ? activeDays / monthDays : 0
    return Number((fullMonthlyBase * pr).toFixed(2))
  }

  return Number(fullMonthlyBase.toFixed(2))
}

/**
 * Ramp during the first 12 months from anchor (employment start, else effective from).
 * Month 0 => 1/12, …, month 11 => 1; month 12+ => 1. Periods before anchor => 0.
 */
export function firstYearBonusScale(params: {
  year: number
  month: number
  employmentStartDate: Date | null
  effectiveFrom: Date
}): number {
  const { year, month, employmentStartDate, effectiveFrom } = params
  const anchor = employmentStartDate ?? effectiveFrom
  const ay = anchor.getFullYear()
  const am = anchor.getMonth() + 1
  const monthsSince = (year - ay) * 12 + (month - am)
  if (monthsSince < 0) return 0
  if (monthsSince >= 12) return 1
  return (monthsSince + 1) / 12
}
