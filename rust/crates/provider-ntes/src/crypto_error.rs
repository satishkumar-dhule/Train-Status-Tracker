//! [`CryptoError`] — the small, internal error type for the CRIS envelope
//! decode leg. Kept private to the crate; callers map failures onto
//! [`tt_provider_core::ProviderError::upstream`].

use std::fmt;

/// A failure decoding the NTES envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    /// The ciphertext part was not valid hex.
    NotHex,
    /// The hex-decoded bytes were not valid UTF-8 base64 text.
    InvalidUtf8,
    /// The base64 payload was malformed.
    NotBase64,
    /// AES-CBC decryption/padding failed.
    Decrypt,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::NotHex => "ciphertext is not hex",
            Self::InvalidUtf8 => "ciphertext is not valid UTF-8",
            Self::NotBase64 => "payload is not valid base64",
            Self::Decrypt => "AES decryption failed",
        };
        f.write_str(message)
    }
}

impl std::error::Error for CryptoError {}
