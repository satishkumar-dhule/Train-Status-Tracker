//! Map an untrusted Paytm body to a [`MappedStatus`], ported 1:1 from
//! `mapPaytmPayload` in `lib/providers/paytm.ts`.

use serde_json::Value;

use crate::parse::{parse_paytm_response_body, PaytmError};
use crate::row::to_row;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus};
use tt_provider_core::ProviderError;

/// Map an untrusted Paytm body to a `MappedStatus`, adapting its error
/// taxonomy into [`ProviderError`]: a confirmed `failure` becomes
/// [`ProviderError::NotFound`]; every other parse rejection (bad shape,
/// ambiguous error result, missing body) becomes [`ProviderError::Upstream`].
pub fn map_paytm_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    match parse_paytm_response_body(raw) {
        Ok(payload) => {
            let rows: Vec<_> = payload.stations.iter().map(to_row).collect();
            let assemble = AssembleOptions {
                train_number: options.train_number.clone(),
                departure_date: options.departure_date.clone(),
                known_train: options.known_train.clone(),
                current_station_code: payload.current_station,
                status_message: payload.train_status_message,
                last_updated: payload.server_timestamp,
            };
            Ok(assemble_mapped_status(&rows, &assemble))
        }
        Err(PaytmError::NotFound(_)) => Err(ProviderError::not_found("paytm")),
        Err(PaytmError::Upstream(message)) => Err(ProviderError::upstream("paytm", message)),
    }
}
