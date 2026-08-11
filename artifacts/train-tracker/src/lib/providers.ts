/**
 * Gateway ("provider") naming helpers shared across the UI. The provider names
 * are the same identifiers the API accepts for the `/trains/status?provider=`
 * param and reports in `TrainStatusResponse.provider`.
 */

/** Human-readable label for a provider id, e.g. "whereismytrain" -> "WhereIsMyTrain". */
export function formatProviderName(name: string): string {
  if (!name) return "Unknown";
  const special = {
    paytm: "Paytm",
    goibibo: "Goibibo",
    railyatri: "RailYatri",
    whereismytrain: "WhereIsMyTrain",
    easemytrip: "EaseMyTrip",
    railradar: "RailRadar",
  } as const;
  if (name in special) return special[name as keyof typeof special];
  const camel = name.replace(/[_-]+(.)/g, (_match, char: string) =>
    char.toUpperCase(),
  );
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}
