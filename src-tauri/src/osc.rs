// OSC in: a UDP port the editor listens on, so apps like TouchOSC, Max or Pure Data can move
// effect settings. Off until turned on in the app; each message's first number goes to the
// webview as an "osc" event with its address.

use serde::Serialize;
use std::io::ErrorKind;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OscMessage {
    pub address: String,
    pub value: f64,
}

/// An OSC string: bytes up to a NUL, padded to a multiple of 4. Returns it and where the next field starts.
fn osc_str(b: &[u8], at: usize) -> Option<(&str, usize)> {
    let rest = b.get(at..)?;
    let end = rest.iter().position(|&c| c == 0)?;
    let s = std::str::from_utf8(&rest[..end]).ok()?;
    Some((s, at + ((end + 4) & !3)))
}

fn be4(b: &[u8], at: usize) -> Option<[u8; 4]> {
    b.get(at..at + 4)?.try_into().ok()
}

/// Messages in a packet (bundles are opened up), each with its first number (or true / false as 1 / 0).
pub fn parse(b: &[u8]) -> Vec<OscMessage> {
    let mut out = Vec::new();
    parse_into(b, &mut out, 0);
    out
}

fn parse_into(b: &[u8], out: &mut Vec<OscMessage>, depth: u32) {
    if depth > 8 {
        return;
    }
    if b.starts_with(b"#bundle\0") {
        // "#bundle", 8-byte time tag, then (size, element) pairs
        let mut at = 16;
        while let Some(n) = be4(b, at).map(i32::from_be_bytes) {
            let n = n.max(0) as usize;
            let Some(el) = b.get(at + 4..at + 4 + n) else { break };
            parse_into(el, out, depth + 1);
            at += 4 + n;
        }
        return;
    }
    let Some((address, at)) = osc_str(b, 0) else { return };
    if !address.starts_with('/') {
        return;
    }
    let Some((tags, mut at)) = osc_str(b, at) else { return };
    let Some(tags) = tags.strip_prefix(',') else { return };
    for t in tags.chars() {
        let value = match t {
            'f' => be4(b, at).map(|x| f32::from_be_bytes(x) as f64),
            'i' => be4(b, at).map(|x| i32::from_be_bytes(x) as f64),
            'd' => b.get(at..at + 8).and_then(|x| x.try_into().ok()).map(f64::from_be_bytes),
            'h' => b.get(at..at + 8).and_then(|x| x.try_into().ok()).map(|x| i64::from_be_bytes(x) as f64),
            'T' => Some(1.0),
            'F' => Some(0.0),
            _ => None,
        };
        if let Some(value) = value {
            out.push(OscMessage { address: address.to_string(), value });
            return;
        }
        // skip a field that isn't a number
        at += match t {
            'i' | 'f' | 'c' | 'r' | 'm' => 4,
            'd' | 'h' | 't' => 8,
            's' | 'S' => match osc_str(b, at) {
                Some((_, next)) => next - at,
                None => return,
            },
            'b' => match be4(b, at).map(i32::from_be_bytes) {
                Some(n) => 4 + ((n.max(0) as usize + 3) & !3),
                None => return,
            },
            _ => 0,
        };
    }
}

/// Which listener is the current one: a new port (or 0) makes the old thread stop.
static GENERATION: AtomicU64 = AtomicU64::new(0);
/// The port the current listener has (0: none).
static PORT: Mutex<u16> = Mutex::new(0);

/// Listen for OSC on `port` (all network interfaces, so a phone on the same network can send);
/// 0 stops listening. Async, so binding (which may wait for the old listener) never holds up the
/// window.
#[tauri::command]
pub async fn osc_listen(app: AppHandle, port: u16) -> Result<(), String> {
    let mut current = PORT.lock().unwrap_or_else(|e| e.into_inner());
    // already listening there (the page was reloaded): keep it, a second socket can't bind the port
    if port != 0 && *current == port {
        return Ok(());
    }
    let me = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    *current = 0;
    if port == 0 {
        return Ok(());
    }
    // a listener that was just stopped keeps the port until its read times out
    let mut tries = 0;
    let socket = loop {
        match UdpSocket::bind(("0.0.0.0", port)) {
            Ok(s) => break s,
            Err(e) if e.kind() == ErrorKind::AddrInUse && tries < 5 => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    socket.set_read_timeout(Some(Duration::from_millis(250))).map_err(|e| e.to_string())?;
    *current = port;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while GENERATION.load(Ordering::SeqCst) == me {
            if let Ok((n, _)) = socket.recv_from(&mut buf) {
                for m in parse(&buf[..n]) {
                    let _ = app.emit("osc", m);
                }
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pad(s: &str) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        while v.len() % 4 != 0 {
            v.push(0);
        }
        v
    }

    fn msg(addr: &str, tags: &str, args: &[u8]) -> Vec<u8> {
        [pad(addr), pad(tags), args.to_vec()].concat()
    }

    #[test]
    fn reads_floats_ints_and_switches() {
        assert_eq!(parse(&msg("/fader1", ",f", &0.25f32.to_be_bytes())), vec![OscMessage { address: "/fader1".into(), value: 0.25 }]);
        assert_eq!(parse(&msg("/cc/21", ",i", &64i32.to_be_bytes()))[0].value, 64.0);
        assert_eq!(parse(&msg("/toggle", ",T", &[]))[0].value, 1.0);
        // a string first, then the number
        let args = [pad("x"), 0.5f32.to_be_bytes().to_vec()].concat();
        assert_eq!(parse(&msg("/xy", ",sf", &args))[0].value, 0.5);
    }

    #[test]
    fn opens_bundles_and_ignores_rubbish() {
        let a = msg("/a", ",f", &1f32.to_be_bytes());
        let b = msg("/b", ",i", &3i32.to_be_bytes());
        let mut bundle = pad("#bundle");
        bundle.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 1]);
        for m in [&a, &b] {
            bundle.extend_from_slice(&(m.len() as i32).to_be_bytes());
            bundle.extend_from_slice(m);
        }
        let got = parse(&bundle);
        assert_eq!(got.iter().map(|m| m.address.as_str()).collect::<Vec<_>>(), ["/a", "/b"]);
        assert!(parse(b"hello").is_empty());
        assert!(parse(&msg("/short", ",f", &[0, 0])).is_empty());
        assert!(parse(&[]).is_empty());
    }
}
