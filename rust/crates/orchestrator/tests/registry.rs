//! Port of `lib/providers/registry.test.ts`. Env-list parsing (case, dedupe,
//! unknown names) is owned by `tt-config`; this suite pins the assembly
//! behavior — order preserved, RailRadar/IndianRailAPI gated by key — on
//! pre-parsed names.

use std::sync::Arc;

use tt_orchestrator::build_status_providers;
use tt_provider_http::MockTransport;

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn uses_the_default_order_without_a_railradar_key() {
    let providers = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&[
            "paytm",
            "goibibo",
            "railyatri",
            "whereismytrain",
            "easemytrip",
            "railradar",
        ]),
        None,
        None,
    );
    let got: Vec<&str> = providers.iter().map(|p| p.name()).collect();
    assert_eq!(
        got,
        [
            "paytm",
            "goibibo",
            "railyatri",
            "whereismytrain",
            "easemytrip"
        ]
    );
    assert!(providers.iter().all(|p| p.enabled()));
}

#[test]
fn includes_railradar_in_the_order_when_a_key_is_set() {
    let providers = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&["paytm", "railradar", "goibibo"]),
        Some("secret"),
        None,
    );
    let got: Vec<&str> = providers.iter().map(|p| p.name()).collect();
    assert_eq!(got, ["paytm", "railradar", "goibibo"]);
}

#[test]
fn skips_unknown_names_silently() {
    let providers = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&["easemytrip", "paytm", "nonsense", "goibibo"]),
        None,
        None,
    );
    let got: Vec<&str> = providers.iter().map(|p| p.name()).collect();
    assert_eq!(got, ["easemytrip", "paytm", "goibibo"]);
}

#[test]
fn deduplicates_repeated_names() {
    let providers = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&["paytm", "paytm", "railyatri"]),
        None,
        None,
    );
    let got: Vec<&str> = providers.iter().map(|p| p.name()).collect();
    assert_eq!(got, ["paytm", "railyatri"]);
}

#[test]
fn returns_an_empty_list_when_everything_is_unknown() {
    let providers = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&["bogus"]),
        None,
        None,
    );
    assert!(providers.is_empty());
}

#[test]
fn omits_railradar_without_an_api_key() {
    let providers = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&["paytm", "railradar"]),
        None,
        None,
    );
    let got: Vec<&str> = providers.iter().map(|p| p.name()).collect();
    assert_eq!(got, ["paytm"]);
}

#[test]
fn an_empty_list_yields_an_empty_provider_list() {
    let providers = build_status_providers(Arc::new(MockTransport::new()), &[], None, None);
    assert!(providers.is_empty());
}

#[test]
fn assembles_all_ported_providers_in_order() {
    let providers = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&[
            "confirmtkt",
            "redrail",
            "ntes",
            "erail",
            "etrain",
            "railmitra",
            "runningstatus",
            "trainspnrstatus",
            "railbeeps",
        ]),
        None,
        None,
    );
    let got: Vec<&str> = providers.iter().map(|p| p.name()).collect();
    assert_eq!(
        got,
        [
            "confirmtkt",
            "redrail",
            "ntes",
            "erail",
            "etrain",
            "railmitra",
            "runningstatus",
            "trainspnrstatus",
            "railbeeps"
        ]
    );
    assert!(providers.iter().all(|p| p.enabled()));
}

#[test]
fn indianrailapi_is_key_gated() {
    let without = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&["indianrailapi"]),
        None,
        None,
    );
    assert!(without.is_empty());

    let with = build_status_providers(
        Arc::new(MockTransport::new()),
        &names(&["indianrailapi"]),
        None,
        Some("key"),
    );
    let got: Vec<&str> = with.iter().map(|p| p.name()).collect();
    assert_eq!(got, ["indianrailapi"]);
}
