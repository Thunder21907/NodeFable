//! `nfasset` URI scheme: serves project assets to the editor (thumbnails) and
//! the preview iframe (`<base href>` + relative `assets/…` URLs).
//!
//! URL forms (decoded path `/<Project>/assets/<rel path>`):
//! * `nfasset://localhost/<Project>/assets/bg/forest.png`   (Linux, macOS)
//! * `http://nfasset.localhost/<Project>/assets/bg/forest.png` (Windows, Android)
//! * `convertFileSrc('<Project>/assets/bg/forest.png', 'nfasset')`, which
//!   percent-encodes the whole path into one segment — decoded the same way.
//!
//! Supports HTTP `Range` requests (audio/video seeking); open-ended ranges are
//! served in chunks so large videos are never read into memory at once.

use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

use crate::storage;

const MAX_CHUNK: u64 = 4 * 1024 * 1024;

type Resp = Response<Cow<'static, [u8]>>;

fn text(status: StatusCode, msg: &str) -> Resp {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Cow::Owned(msg.as_bytes().to_vec()))
        .expect("static response")
}

/// `/<Project>/assets/<rel>` → (project, rel). `None` if malformed.
pub fn split_asset_path(raw_path: &str) -> Option<(String, String)> {
    let decoded = percent_decode_str(raw_path).decode_utf8().ok()?;
    let path = decoded.trim_start_matches('/');
    let (project, rest) = path.split_once('/')?;
    let rel = rest.strip_prefix("assets/")?;
    if project.is_empty() || rel.is_empty() {
        return None;
    }
    Some((project.to_string(), rel.to_string()))
}

/// Parse `bytes=start-end` / `bytes=start-` / `bytes=-suffix` for a file of
/// `len` bytes → inclusive (start, end). `Err(())` = unsatisfiable.
pub fn parse_range(value: &str, len: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = value.trim().strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim(); // multi-range: serve the first
    let (s, e) = first.split_once('-')?;
    if len == 0 {
        return Some(Err(()));
    }
    let range = if s.is_empty() {
        let suffix: u64 = e.parse().ok()?;
        if suffix == 0 {
            return Some(Err(()));
        }
        (len.saturating_sub(suffix), len - 1)
    } else {
        let start: u64 = s.parse().ok()?;
        if start >= len {
            return Some(Err(()));
        }
        let end = if e.is_empty() {
            (start + MAX_CHUNK - 1).min(len - 1)
        } else {
            e.parse::<u64>().ok()?.min(len - 1)
        };
        if end < start {
            return Some(Err(()));
        }
        (start, end)
    };
    Some(Ok(range))
}

pub fn handle(data_dir: &Path, request: &Request<Vec<u8>>) -> Resp {
    let Some((project, rel)) = split_asset_path(request.uri().path()) else {
        return text(StatusCode::NOT_FOUND, "Asset not found");
    };
    let file_path = match storage::find_asset_file(data_dir, &project, &rel) {
        Ok(p) => p,
        Err(err) => {
            let status = StatusCode::from_u16(err.status).unwrap_or(StatusCode::NOT_FOUND);
            return text(status, &err.detail);
        }
    };
    let mime = mime_guess::from_path(&file_path).first_or_octet_stream().essence_str().to_string();
    let Ok(mut file) = File::open(&file_path) else {
        return text(StatusCode::NOT_FOUND, "Asset not found");
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);

    let builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        // The editor (tauri://) and assets (nfasset://) are different origins.
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Content-Length, Accept-Ranges")
        .header(header::CACHE_CONTROL, "no-cache");

    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| parse_range(v, len));
    match range {
        Some(Ok((start, end))) => {
            let n = (end - start + 1) as usize;
            let mut buf = vec![0u8; n];
            if file.seek(SeekFrom::Start(start)).and_then(|_| file.read_exact(&mut buf)).is_err() {
                return text(StatusCode::INTERNAL_SERVER_ERROR, "Failed to read asset");
            }
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .header(header::CONTENT_LENGTH, n.to_string())
                .body(Cow::Owned(buf))
                .unwrap_or_else(|_| text(StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response"))
        }
        Some(Err(())) => Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Cow::Borrowed(&[][..]))
            .expect("static response"),
        None => {
            let mut buf = Vec::with_capacity(len as usize);
            if file.read_to_end(&mut buf).is_err() {
                return text(StatusCode::INTERNAL_SERVER_ERROR, "Failed to read asset");
            }
            builder
                .status(StatusCode::OK)
                .header(header::CONTENT_LENGTH, buf.len().to_string())
                .body(Cow::Owned(buf))
                .unwrap_or_else(|_| text(StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response"))
        }
    }
}
