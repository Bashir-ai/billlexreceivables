export type RootFormCompensationType = "SALARY_BONUS" | "PERCENTAGE_BASED"

export const defaultRootCompensationForm = () => ({
  compensationType: "SALARY_BONUS" as RootFormCompensationType,
  baseSalary: "",
  maxBonusMultiplier: "",
  percentageType: "PROJECT_TOTAL" as "PROJECT_TOTAL" | "DIRECT_WORK" | "BOTH" | null,
  projectPercentage: "",
  directWorkPercentage: "",
  effectiveFrom: new Date().toISOString().split("T")[0],
  effectiveTo: "",
})

export type RootCompensationFormData = ReturnType<typeof defaultRootCompensationForm>

export function resetInapplicableFieldsRoot(
  prev: RootCompensationFormData,
  nextType: RootFormCompensationType
): RootCompensationFormData {
  const sameEffective = { effectiveFrom: prev.effectiveFrom, effectiveTo: prev.effectiveTo }
  if (nextType === "SALARY_BONUS") {
    return {
      ...prev,
      ...sameEffective,
      compensationType: nextType,
      percentageType: "PROJECT_TOTAL",
      projectPercentage: "",
      directWorkPercentage: "",
    }
  }
  return {
    ...prev,
    ...sameEffective,
    compensationType: nextType,
    baseSalary: "",
    maxBonusMultiplier: "",
  }
}

export function projectBranchApplicable(
  percentageType: RootCompensationFormData["percentageType"]
): boolean {
  return percentageType === "PROJECT_TOTAL" || percentageType === "BOTH" || !percentageType
}

export function directBranchApplicable(
  percentageType: RootCompensationFormData["percentageType"]
): boolean {
  return percentageType === "DIRECT_WORK" || percentageType === "BOTH" || !percentageType
}

export function buildRootCompensationPostBody(formData: RootCompensationFormData) {
  const t = formData.compensationType
  const num = (s: string): number | null => (s ? parseFloat(s) : null)
  if (t === "SALARY_BONUS") {
    return {
      compensationType: t,
      baseSalary: num(formData.baseSalary),
      maxBonusMultiplier: num(formData.maxBonusMultiplier),
      percentageType: null,
      projectPercentage: null,
      directWorkPercentage: null,
      effectiveFrom: formData.effectiveFrom,
      effectiveTo: formData.effectiveTo || null,
    }
  }
  return {
    compensationType: t,
    baseSalary: null,
    maxBonusMultiplier: null,
    percentageType: formData.percentageType || null,
    projectPercentage: num(formData.projectPercentage),
    directWorkPercentage: num(formData.directWorkPercentage),
    effectiveFrom: formData.effectiveFrom,
    effectiveTo: formData.effectiveTo || null,
  }
}
