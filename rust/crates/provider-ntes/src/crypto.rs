//! The CRIS `AppServAnd` envelope: an AES-128-CBC encrypted payload preceded by
//! an uppercase MD5 of `plaintext + sckey`, all hex-encoded. Ported 1:1 from
//! the open-source `ntes-client`; constants confirmed against live responses.
//!
//! The wire shape is:
//!
//! ```text
//! jsonIn = "<hex(md5(plaintext + sckey))>#<hex(base64(AES-128-CBC(plaintext)))>"
//! ```
//!
//! The `#` is the envelope separator on the request side; the response is a
//! JSON body carrying the ciphertext under a `jsonIn` key.

use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use base64::Engine as _;
use md5::Digest as _;

use crate::crypto_error::CryptoError;

type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;
type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

const AES_KEY: &[u8; 16] = b"8EA4DB2CC1EB3DC5";
const AES_IV: &[u8; 16] = b"7DC5EB3BB4DB6EA8";
const SCKEY: &str = "645fbc1e56e23365f2f3c204ae0899f6";

/// `hex(base64(AES-128-CBC-PKCS7(plaintext)))`.
fn encrypt(plaintext: &[u8]) -> String {
    let cipher = Aes128CbcEnc::new_from_slices(AES_KEY, AES_IV).expect("valid AES key/iv");
    let ciphertext = cipher.encrypt_padded_vec_mut::<Pkcs7>(plaintext);
    let encoded = base64::engine::general_purpose::STANDARD.encode(ciphertext);
    hex::encode_upper(encoded)
}

/// `hex(md5(plaintext + sckey))` (uppercase).
fn signature(plaintext: &[u8]) -> String {
    let mut message = plaintext.to_vec();
    message.extend_from_slice(SCKEY.as_bytes());
    let digest = md5::Md5::digest(&message);
    format!("{:X}", digest)
}

/// Build the `jsonIn` value for a request.
pub fn build_envelope(plaintext: &str) -> String {
    format!(
        "{}#{}",
        signature(plaintext.as_bytes()),
        encrypt(plaintext.as_bytes())
    )
}

/// Decode a response `jsonIn` back to the plaintext JSON.
pub fn decode_envelope(json_in: &str) -> Result<String, CryptoError> {
    let encoded = json_in.split('#').next_back().unwrap_or_default();
    let b64 = hex::decode(encoded).map_err(|_| CryptoError::NotHex)?;
    let b64 = String::from_utf8(b64).map_err(|_| CryptoError::InvalidUtf8)?;
    let ciphertext = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| CryptoError::NotBase64)?;

    let mut buf = ciphertext.to_vec();
    let plaintext = Aes128CbcDec::new_from_slices(AES_KEY, AES_IV)
        .expect("valid AES key/iv")
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| CryptoError::Decrypt)?;
    String::from_utf8(plaintext.to_vec()).map_err(|_| CryptoError::InvalidUtf8)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAINTEXT: &str =
        "service=TrainRunningMob&subService=ShowFullRunJson&trainNo=12301&startDate=10-Aug-2026";

    #[test]
    fn envelope_roundtrips() {
        let envelope = build_envelope(PLAINTEXT);
        assert!(envelope.contains('#'));
        assert_eq!(decode_envelope(&envelope).as_deref(), Ok(PLAINTEXT));
    }

    #[test]
    fn envelope_matches_known_fixture() {
        // Captured from the live CRIS endpoint on 10-Aug-2026 for train 12301.
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/ntes_live_request.json"
        ))
        .expect("fixture exists");
        let json_in: String = serde_json::from_str(&raw).expect("fixture is a JSON string");
        assert_eq!(
            decode_envelope(&json_in).as_deref(),
            Ok("service=TrainRunningMob&subService=ShowFullRunJson&trainNo=12301&startDate=10-Aug-2026")
        );
    }

    #[test]
    fn malformed_envelope_is_an_error() {
        assert!(decode_envelope("zzz").is_err());
        assert!(decode_envelope("#").is_err());
    }
}
