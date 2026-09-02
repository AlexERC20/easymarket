export function getInactivityBurnTransition(currentStageInput, daysInactiveInput) {
  const currentStage = Math.max(0, Math.min(3, Math.floor(Number(currentStageInput) || 0)));
  const daysInactive = Math.max(0, Math.floor(Number(daysInactiveInput) || 0));
  if (currentStage >= 3 || daysInactive < 1) {
    return null;
  }
  const isFinal = daysInactive >= 3;
  const targetStage = isFinal ? 3 : Math.min(daysInactive, 2);
  if (targetStage <= currentStage) {
    return null;
  }
  return { targetStage, isFinal };
}
