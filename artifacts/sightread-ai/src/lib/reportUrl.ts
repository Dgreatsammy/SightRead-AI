export type ReportUrlDetails = {
  scoreTitle: string;
  measure: number | string;
  partName: string;
};

export function buildReportUrl(
  formUrl: string | undefined | null,
  details: ReportUrlDetails,
): string | null {
  if (!formUrl || formUrl.trim().length === 0) return null;

  const url = new URL(formUrl);
  const entries = Array.from(url.searchParams.entries());
  const hasPlaceholder = entries.some(([, value]) =>
    value === "SCORE" || value === "MEASURE" || value === "PART"
  );
  if (!hasPlaceholder) return formUrl;

  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(
      key,
      value === "SCORE"
        ? details.scoreTitle
        : value === "MEASURE"
          ? String(details.measure)
          : value === "PART"
            ? details.partName
            : value,
    );
  }
  url.search = params.toString();
  return url.toString();
}
