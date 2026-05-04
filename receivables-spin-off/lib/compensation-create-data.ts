import type { PercentageType, CompensationType } from "@prisma/client"

type Validated = {
  compensationType: "SALARY_BONUS" | "PERCENTAGE_BASED" | "SALARY_BONUS_FINDER_MANAGEMENT"
  effectiveFrom: Date
  baseSalary?: number | null
  maxBonusMultiplier?: number | null
  percentageType?: "PROJECT_TOTAL" | "DIRECT_WORK" | "BOTH" | null
  projectPercentage?: number | null
  directWorkPercentage?: number | null
  projectFixedAmount?: number | null
  directWorkFixedAmount?: number | null
  bonusFixedAmount?: number | null
  bonusPercent?: number | null
  finderFeePercent?: number | null
  finderFeeFixedAmount?: number | null
  managementFeePercent?: number | null
  managementFeeFixedAmount?: number | null
  employmentStartDate?: Date | null
  bonusDueFrequency?: "MONTHLY" | "QUARTERLY" | "YEARLY" | null
  bonusDueMonth?: number | null
  effectiveTo?: Date | null
}

/**
 * Prisma `UserCompensation` create payload: null out fields that do not apply to the selected type.
 */
export function buildNormalizedCompensationCreateData(
  userId: string,
  v: Validated
) {
  const t = v.compensationType
  if (t === "SALARY_BONUS") {
    return {
      userId,
      compensationType: "SALARY_BONUS" as CompensationType,
      baseSalary: v.baseSalary ?? null,
      maxBonusMultiplier: v.maxBonusMultiplier ?? null,
      percentageType: null,
      projectPercentage: null,
      directWorkPercentage: null,
      projectFixedAmount: null,
      directWorkFixedAmount: null,
      bonusFixedAmount: null,
      bonusPercent: null,
      finderFeePercent: v.finderFeePercent ?? null,
      finderFeeFixedAmount: v.finderFeeFixedAmount ?? null,
      managementFeePercent: null,
      managementFeeFixedAmount: null,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo ?? null,
      employmentStartDate: v.employmentStartDate ?? null,
      bonusDueFrequency: v.bonusDueFrequency ?? "MONTHLY",
      bonusDueMonth: v.bonusDueMonth ?? 12,
    }
  }
  if (t === "PERCENTAGE_BASED") {
    return {
      userId,
      compensationType: "PERCENTAGE_BASED" as CompensationType,
      baseSalary: null,
      maxBonusMultiplier: null,
      percentageType: (v.percentageType ?? null) as PercentageType | null,
      projectPercentage: v.projectPercentage ?? null,
      directWorkPercentage: v.directWorkPercentage ?? null,
      projectFixedAmount: v.projectFixedAmount ?? null,
      directWorkFixedAmount: v.directWorkFixedAmount ?? null,
      bonusFixedAmount: null,
      bonusPercent: null,
      finderFeePercent: null,
      finderFeeFixedAmount: null,
      managementFeePercent: null,
      managementFeeFixedAmount: null,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo ?? null,
      employmentStartDate: null,
      bonusDueFrequency: null,
      bonusDueMonth: null,
    }
  }
  return {
    userId,
    compensationType: "SALARY_BONUS_FINDER_MANAGEMENT" as CompensationType,
    baseSalary: v.baseSalary ?? null,
    maxBonusMultiplier: null,
    percentageType: null,
    projectPercentage: null,
    directWorkPercentage: null,
    projectFixedAmount: null,
    directWorkFixedAmount: null,
    bonusFixedAmount: v.bonusFixedAmount ?? null,
    bonusPercent: v.bonusPercent ?? null,
    finderFeePercent: v.finderFeePercent ?? null,
    finderFeeFixedAmount: v.finderFeeFixedAmount ?? null,
    managementFeePercent: v.managementFeePercent ?? null,
    managementFeeFixedAmount: v.managementFeeFixedAmount ?? null,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo ?? null,
    employmentStartDate: v.employmentStartDate ?? null,
    // SBFM: bonus schedule is policy-locked (monthly); not user-editable in UI
    bonusDueFrequency: "MONTHLY",
    bonusDueMonth: null,
  }
}
