import type { PercentageType, CompensationType } from "@prisma/client"

type ValidatedRoot = {
  compensationType: "SALARY_BONUS" | "PERCENTAGE_BASED"
  effectiveFrom: Date
  baseSalary?: number | null
  maxBonusMultiplier?: number | null
  percentageType?: "PROJECT_TOTAL" | "DIRECT_WORK" | "BOTH" | null
  projectPercentage?: number | null
  directWorkPercentage?: number | null
  effectiveTo?: Date | null
}

export function buildNormalizedCompensationCreateData(
  userId: string,
  v: ValidatedRoot
) {
  if (v.compensationType === "SALARY_BONUS") {
    return {
      userId,
      compensationType: "SALARY_BONUS" as CompensationType,
      baseSalary: v.baseSalary ?? null,
      maxBonusMultiplier: v.maxBonusMultiplier ?? null,
      percentageType: null,
      projectPercentage: null,
      directWorkPercentage: null,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo ?? null,
    }
  }
  return {
    userId,
    compensationType: "PERCENTAGE_BASED" as CompensationType,
    baseSalary: null,
    maxBonusMultiplier: null,
    percentageType: (v.percentageType ?? null) as PercentageType | null,
    projectPercentage: v.projectPercentage ?? null,
    directWorkPercentage: v.directWorkPercentage ?? null,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo ?? null,
  }
}
