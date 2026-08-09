//! A tiny hermetic HTTP test server (local loopback only) used by the
//! `ReqwestTransport` integration tests. Compiled only in `#[cfg(test)]`
//! (gated at the module declaration in `lib.rs`).
//!
//! Handlers see the parsed request head (method, path, headers, body) and
//! return a [`TestResponse`] that may delay, redirect, or stream chunked data —
//! everything the transport tests need without touching the real network.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// The head of an incoming request, parsed from the wire.
pub struct RequestHead {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Option<Vec<u8>>,
}

/// A canned HTTP response the server writes back.
#[derive(Clone)]
pub struct TestResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub delay: Option<Duration>,
    pub chunked: bool,
}

impl TestResponse {
    pub fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: body.into(),
            delay: None,
            chunked: false,
        }
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }

    pub fn delay(mut self, delay: Duration) -> Self {
        self.delay = Some(delay);
        self
    }

    pub fn chunked(mut self, chunked: bool) -> Self {
        self.chunked = chunked;
        self
    }
}

/// A running loopback server. Keep it alive for the duration of a test.
pub struct TestServer {
    addr: SocketAddr,
    hits: Arc<AtomicUsize>,
}

impl TestServer {
    /// Bind `127.0.0.1:0` and serve `handler` for every request until dropped.
    pub async fn start(
        handler: impl Fn(&RequestHead) -> TestResponse + Send + Sync + 'static,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback");
        let addr = listener.local_addr().expect("local address");
        let hits = Arc::new(AtomicUsize::new(0));
        let handler = Arc::new(handler);
        let hits_for_loop = Arc::clone(&hits);

        tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    break;
                };
                let handler = Arc::clone(&handler);
                let hits = Arc::clone(&hits_for_loop);
                tokio::spawn(async move {
                    handle_connection(socket, handler, hits).await;
                });
            }
        });

        Self { addr, hits }
    }

    /// A URL for this server's `path`, e.g. `http://127.0.0.1:PORT/status`.
    pub fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    /// Number of requests the server has accepted so far.
    pub fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

async fn handle_connection(
    mut socket: TcpStream,
    handler: Arc<dyn Fn(&RequestHead) -> TestResponse + Send + Sync>,
    hits: Arc<AtomicUsize>,
) {
    let mut data: Vec<u8> = Vec::with_capacity(4096);
    let mut tmp = [0u8; 8192];

    let head_len = loop {
        let n = match socket.read(&mut tmp).await {
            Ok(0) => return,
            Ok(n) => n,
            Err(_) => return,
        };
        data.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_subsequence(&data, b"\r\n\r\n") {
            break pos;
        }
    };

    let head_text = String::from_utf8_lossy(&data[..head_len]).into_owned();
    let mut request = parse_head(&head_text);

    // Consume the request body so the connection stays in sync, and expose it
    // to handlers (the POST echo test relies on it).
    if let Some(content_length) = request
        .headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
    {
        let mut have = data.len().saturating_sub(head_len + 4);
        while have < content_length {
            let n = match socket.read(&mut tmp).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            data.extend_from_slice(&tmp[..n]);
            have += n;
        }
        request.body = Some(data[head_len + 4..head_len + 4 + content_length.min(have)].to_vec());
    }

    hits.fetch_add(1, Ordering::SeqCst);
    let response = handler(&request);

    if let Some(delay) = response.delay {
        tokio::time::sleep(delay).await;
    }

    let _ = socket.write_all(&encode_response(&response)).await;
    let _ = socket.flush().await;
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn parse_head(head: &str) -> RequestHead {
    let mut lines = head.lines();
    let mut parts = lines.next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    RequestHead {
        method,
        path,
        headers,
        body: None,
    }
}

fn encode_response(response: &TestResponse) -> Vec<u8> {
    let reason = reason_phrase(response.status);

    let mut head = format!("HTTP/1.1 {} {}\r\n", response.status, reason);
    for (name, value) in &response.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if !response
        .headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("content-length"))
    {
        if response.chunked {
            head.push_str("transfer-encoding: chunked\r\n");
        } else {
            head.push_str(&format!("content-length: {}\r\n", response.body.len()));
        }
    }
    head.push_str("connection: close\r\n\r\n");

    let mut wire = head.into_bytes();
    if response.chunked {
        wire.extend_from_slice(format!("{:x}\r\n", response.body.len()).as_bytes());
        wire.extend_from_slice(&response.body);
        wire.extend_from_slice(b"\r\n0\r\n\r\n");
    } else {
        wire.extend_from_slice(&response.body);
    }
    wire
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        301 => "Moved Permanently",
        302 => "Found",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    }
}
