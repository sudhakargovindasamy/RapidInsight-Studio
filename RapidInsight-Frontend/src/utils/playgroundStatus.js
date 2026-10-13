export function getEntityStatus(entity, isGenerating = false) {
  if (isGenerating) {
    return { variant: "generating", label: "Generating" };
  }

  if (!entity?.generatedTableId) {
    return { variant: "not-built", label: "Not built" };
  }

  const rows = Number(entity.rowCount || 0);

  if (rows > 0) {
    return { variant: "ready", label: "Data ready" };
  }

  return { variant: "empty", label: "Empty" };
}
