//! Train-status provider list parsing, ported from `buildStatusProviders` in
//! `lib/providers/registry.ts`.

/// Fallback provider order when `TRAIN_STATUS_PROVIDERS` is unset or blank.
///
/// The original six are followed by the ported providers in confidence order
/// (tier A live-verified first, then tier B, then tier C). Key-gated
/// `indianrailapi` is intentionally *not* here — see [`KNOWN_PROVIDERS`].
pub const DEFAULT_PROVIDER_ORDER: [&str; 15] = [
    "paytm",
    "goibibo",
    "railyatri",
    "whereismytrain",
    "easemytrip",
    "railradar",
    "confirmtkt",
    "redrail",
    "ntes",
    "erail",
    "etrain",
    "railmitra",
    "runningstatus",
    "trainspnrstatus",
    "railbeeps",
];

/// Every provider name the server can build. Superset of
/// [`DEFAULT_PROVIDER_ORDER`]: key-gated `indianrailapi` is known but only
/// enabled when `INDIANRAILAPI_API_KEY` is set.
const KNOWN_PROVIDERS: [&str; 16] = [
    "paytm",
    "goibibo",
    "railyatri",
    "whereismytrain",
    "easemytrip",
    "railradar",
    "confirmtkt",
    "redrail",
    "ntes",
    "erail",
    "etrain",
    "railmitra",
    "runningstatus",
    "trainspnrstatus",
    "railbeeps",
    "indianrailapi",
];

/// Parses a comma-separated provider list: split, trim, lowercase, drop empty
/// entries, fall back to [`DEFAULT_PROVIDER_ORDER`] when nothing is configured,
/// then deduplicate (preserving order) and drop unknown names.
///
/// RailRadar is *not* dropped here — it is gated by `RAILRADAR_API_KEY` in
/// [`crate::Config::providers_enabled`], mirroring `buildStatusProviders` which
/// checks `provider.enabled`.
pub(crate) fn parse_list(raw: Option<&str>) -> Vec<String> {
    let parsed: Vec<String> = raw
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .map(str::to_ascii_lowercase)
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let mut names = if parsed.is_empty() {
        DEFAULT_PROVIDER_ORDER
            .iter()
            .map(|s| s.to_string())
            .collect()
    } else {
        parsed
    };

    let mut seen = std::collections::HashSet::new();
    names.retain(|name| KNOWN_PROVIDERS.contains(&name.as_str()) && seen.insert(name.clone()));
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_order_is_used_when_unset_or_blank() {
        assert_eq!(parse_list(None), DEFAULT_PROVIDER_ORDER);
        assert_eq!(parse_list(Some("  , ")), DEFAULT_PROVIDER_ORDER);
    }

    #[test]
    fn parses_custom_order_with_trimming_and_lowercasing() {
        assert_eq!(
            parse_list(Some("Paytm, Goibibo ")),
            vec!["paytm", "goibibo"]
        );
    }

    #[test]
    fn deduplicates_preserving_first_seen_order() {
        assert_eq!(
            parse_list(Some("railradar,paytm,railradar")),
            vec!["railradar", "paytm"]
        );
    }

    #[test]
    fn drops_unknown_names() {
        assert_eq!(
            parse_list(Some("paytm,bogus,easemytrip")),
            vec!["paytm", "easemytrip"]
        );
    }
}
