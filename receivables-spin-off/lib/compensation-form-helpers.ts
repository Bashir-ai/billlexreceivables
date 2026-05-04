export type FormCompensationType =
  | "SALARY_BONUS"
  | "PERCENTAGE_BASED"
  | "SALARY_BONUS_FINDER_MANAGEMENT"

export const defaultCompensationForm = () => ({
  compensationType: "SALARY_BONUS" as FormCompensationType,
  baseSalary: "",
  maxBonusMultiplier: "",
  percentageType: "PROJECT_TOTAL" as "PROJECT_TOTAL" | "DIRECT_WORK" | "BOTH" | null,
  projectPercentage: "",
  directWorkPercentage: "",
  projectFixedAmount: "",
  directWorkFixedAmount: "",
  bonusFixedAmount: "",
  bonusPercent: "",
  finderFeePercent: "",
  finderFeeFixedAmount: "",
  managementFeePercent: "",
  managementFeeFixedAmount: "",
  employmentStartDate: "",
  bonusDueFrequency: "MONTHLY" as "MONTHLY" | "QUARTERLY" | "YEARLY",
  bonusDueMonth: "12",
  effectiveFrom: new Date().toISOString().split("T")[0],
  effectiveTo: "",
})

export type CompensationFormData = ReturnType<typeof defaultCompensationForm>

/** Clear fields that are not used by the selected type (after switching dropdown). */
export function resetInapplicableFields(
  prev: CompensationFormData,
  nextType: FormCompensationType
): CompensationFormData {
  const sameEffective = { effectiveFrom: prev.effectiveFrom, effectiveTo: prev.effectiveTo }

  if (nextType === "SALARY_BONUS") {
    return {
      ...prev,
      ...sameEffective,
      compensationType: nextType,
      percentageType: "PROJECT_TOTAL",
      projectPercentage: "",
      directWorkPercentage: "",
      projectFixedAmount: "",
      directWorkFixedAmount: "",
      bonusFixedAmount: "",
      bonusPercent: "",
      managementFeePercent: "",
      managementFeeFixedAmount: "",
    }
  }
  if (nextType === "PERCENTAGE_BASED") {
    return {
      ...prev,
      ...sameEffective,
      compensationType: nextType,
      baseSalary: "",
      maxBonusMultiplier: "",
      bonusFixedAmount: "",
      bonusPercent: "",
      finderFeePercent: "",
      finderFeeFixedAmount: "",
      managementFeePercent: "",
      managementFeeFixedAmount: "",
      employmentStartDate: "",
      bonusDueFrequency: "MONTHLY",
      bonusDueMonth: "12",
    }
  }
  // SALARY_BONUS_FINDER_MANAGEMENT
  return {
    ...prev,
    ...sameEffective,
    compensationType: nextType,
    maxBonusMultiplier: "",
    percentageType: "PROJECT_TOTAL",
    projectPercentage: "",
    directWorkPercentage: "",
    projectFixedAmount: "",
    directWorkFixedAmount: "",
    bonusDueFrequency: "MONTHLY",
    bonusDueMonth: "12",
  }
}

export function isScheduleEditable(t: FormCompensationType): boolean {
  return t === "SALARY_BONUS" || t === "SALARY_BONUS_FINDER_MANAGEMENT"
}

export function isSalaryBonusBlock(t: FormCompensationType): boolean {
  return t === "SALARY_BONUS"
}

export function isPercentageBlock(t: FormCompensationType): boolean {
  return t === "PERCENTAGE_BASED"
}

export function isSbfmBlock(t: FormCompensationType): boolean {
  return t === "SALARY_BONUS_FINDER_MANAGEMENT"
}

/** SBFM: bonus $ / % are read-only in the UI (values come from the server). */
export function isSbfmBonusCompensationReadOnly(t: FormCompensationType): boolean {
  return t === "SALARY_BONUS_FINDER_MANAGEMENT"
}

/** Only Salary + Bonus type may edit bonus cadence; SBFM uses a fixed policy (POST forces monthly). */
export function isBonusScheduleFrequencyEditable(t: FormCompensationType): boolean {
  return t === "SALARY_BONUS"
}

export function hasSalaryInCompensationType(t: FormCompensationType): boolean {
  return t === "SALARY_BONUS" || t === "SALARY_BONUS_FINDER_MANAGEMENT"
}

/** Salary + Bonus + Finder: can edit finder add-ons; management fees are N/A. */
export function isSalaryBonusFinderFieldsEditable(t: FormCompensationType): boolean {
  return t === "SALARY_BONUS"
}

/** For PERCENTAGE_BASED: which project/direct inputs apply (fixed amounts follow the same pattern as the calculator). */
export function projectBranchApplicable(
  percentageType: CompensationFormData["percentageType"]
): boolean {
  return (
    percentageType === "PROJECT_TOTAL" || percentageType === "BOTH" || !percentageType
  )
}

export function directBranchApplicable(
  percentageType: CompensationFormData["percentageType"]
): boolean {
  return (
    percentageType === "DIRECT_WORK" || percentageType === "BOTH" || !percentageType
  )
}

/** Coerce form payload: only the selected type’s fields are non-null. */
export function buildCompensationPostBody(formData: CompensationFormData) {
  const t = formData.compensationType
  const num = (s: string): number | null => (s ? parseFloat(s) : null)

  const base = {
    compensationType: t,
    effectiveFrom: formData.effectiveFrom,
    effectiveTo: formData.effectiveTo || null,
  }

  if (t === "SALARY_BONUS") {
    return {
      ...base,
      baseSalary: num(formData.baseSalary),
      maxBonusMultiplier: num(formData.maxBonusMultiplier),
      percentageType: null,
      projectPercentage: null,
      directWorkPercentage: null,
      projectFixedAmount: null,
      directWorkFixedAmount: null,
      bonusFixedAmount: null,
      bonusPercent: null,
      finderFeePercent: num(formData.finderFeePercent),
      finderFeeFixedAmount: num(formData.finderFeeFixedAmount),
      managementFeePercent: null,
      managementFeeFixedAmount: null,
      employmentStartDate: formData.employmentStartDate || null,
      bonusDueFrequency: formData.bonusDueFrequency || "MONTHLY",
      bonusDueMonth: formData.bonusDueMonth
        ? parseInt(formData.bonusDueMonth, 10)
        : 12,
    }
  }
  if (t === "PERCENTAGE_BASED") {
    return {
      ...base,
      baseSalary: null,
      maxBonusMultiplier: null,
      percentageType: formData.percentageType || null,
      projectPercentage: num(formData.projectPercentage),
      directWorkPercentage: num(formData.directWorkPercentage),
      projectFixedAmount: num(formData.projectFixedAmount),
      directWorkFixedAmount: num(formData.directWorkFixedAmount),
      bonusFixedAmount: null,
      bonusPercent: null,
      finderFeePercent: null,
      finderFeeFixedAmount: null,
      managementFeePercent: null,
      managementFeeFixedAmount: null,
      employmentStartDate: null,
      bonusDueFrequency: null,
      bonusDueMonth: null,
    }
  }
  // SALARY_BONUS_FINDER_MANAGEMENT — bonus cadence is fixed; bonus $/% persisted from loaded state
  return {
    ...base,
    baseSalary: num(formData.baseSalary),
    maxBonusMultiplier: null,
    percentageType: null,
    projectPercentage: null,
    directWorkPercentage: null,
    projectFixedAmount: null,
    directWorkFixedAmount: null,
    bonusFixedAmount: num(formData.bonusFixedAmount),
    bonusPercent: num(formData.bonusPercent),
    finderFeePercent: num(formData.finderFeePercent),
    finderFeeFixedAmount: num(formData.finderFeeFixedAmount),
    managementFeePercent: num(formData.managementFeePercent),
    managementFeeFixedAmount: num(formData.managementFeeFixedAmount),
    employmentStartDate: formData.employmentStartDate || null,
    bonusDueFrequency: "MONTHLY" as const,
    bonusDueMonth: null,
  }
}
