// Behind a proxy, libsoup 3.0 (Ubuntu 22.04's, which the AppImage bundles) crashes WebKit's network
// process on the first HTTPS download: when WebKit leaves the proxy to the system, GLib opens a
// CONNECT tunnel through it and libsoup then sends its own CONNECT inside that tunnel. So the online
// features (fonts, the cut-out and caption models) took the app down. Handing WebKit the system's
// proxy explicitly makes libsoup do the tunnelling alone, as libsoup 3.2 and later always do.
use std::ffi::{c_char, c_void, CStr};
use webkit2gtk::gio::prelude::*;
use webkit2gtk::{gio, NetworkProxyMode, NetworkProxySettings, WebView, WebViewExt, WebsiteDataManagerExt};

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

/// The libsoup the webview runs on, as (major, minor).
fn libsoup_version() -> Option<(u32, u32)> {
    let get = |name: &CStr| -> Option<u32> {
        // SAFETY: RTLD_DEFAULT (null) searches the libraries already loaded; the functions take
        // no arguments and return a guint
        let f = unsafe { dlsym(std::ptr::null_mut(), name.as_ptr()) };
        (!f.is_null()).then(|| unsafe { std::mem::transmute::<*mut c_void, extern "C" fn() -> u32>(f)() })
    };
    Some((get(c"soup_get_major_version")?, get(c"soup_get_minor_version")?))
}

/// Hosts that go direct: `no_proxy`, and this computer.
fn ignore_hosts() -> Vec<String> {
    let list = std::env::var("no_proxy").or_else(|_| std::env::var("NO_PROXY")).unwrap_or_default();
    let mut hosts: Vec<String> = list.split(',').map(str::trim).filter(|h| !h.is_empty() && *h != "*").map(String::from).collect();
    hosts.extend(["localhost", "127.0.0.0/8", "::1"].map(String::from));
    hosts
}

pub fn apply(webview: &WebView) {
    if !matches!(libsoup_version(), Some((3, minor)) if minor < 2) {
        return;
    }
    let webview = webview.clone();
    // the proxy the system would use for the internet (environment, desktop settings or PAC)
    gio::ProxyResolver::default().lookup_async("https://cdn.jsdelivr.net/", None::<&gio::Cancellable>, move |found| {
        let Some(proxy) = found.ok().and_then(|l| l.into_iter().next()) else { return };
        if proxy == "direct://" {
            return;
        }
        let Some(data) = webview.website_data_manager() else { return };
        let ignore = ignore_hosts();
        let ignore: Vec<&str> = ignore.iter().map(String::as_str).collect();
        let mut settings = NetworkProxySettings::new(Some(&proxy), &ignore);
        data.set_network_proxy_settings(NetworkProxyMode::Custom, Some(&mut settings));
    });
}
