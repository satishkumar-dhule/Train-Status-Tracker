//! Rail Saarthi — `tt-mapper` crate.
//!
//! Seam: `MappedStatus`/`MappedStation` normalization contract (ZTA untrusted
//! payloads) plus the conversion to the wire response types.
//!
//! This mirrors `providers/normalize.ts`: adapters translate their own
//! payloads into [`ProviderStationRow`]s, then [`assemble_mapped_status`] turns
//! rows into the shared [`MappedStatus`] contract. The wire conversion
//! (`MappedStatus -> contract::wire::TrainStatusResponse`) reproduces the TS
//! route's response construction byte-for-byte.
//!
//! Deep module: this file is the whole public surface. Implementation lives in
//! private submodules; callers and tests cross the same seam.

mod rows;
mod types;
mod wire;

pub use rows::{
    assemble_mapped_status, compute_row_current_serial, to_mapped_station, AssembleOptions,
    ProviderStationRow,
};
pub use types::{KnownTrain, MappedStation, MappedStatus};
pub use wire::to_wire_status;
