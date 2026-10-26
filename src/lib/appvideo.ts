// The Linux desktop app's webview plays video from http(s) and blob: URLs only: WebKitGTK before
// 2.52 (Ubuntu 22.04, Debian 12) can't play the app's own files (tauri://), so the template
// previews stayed blank there. On Linux they are read into blobs first; everywhere else a video
// gets its file's URL as it is.
import { isDesktop } from './platform';

const viaBlob = isDesktop && typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent);
const blobs = new Map<string, Promise<string>>();

function blobUrl(src: string): Promise<string> {
  let url = blobs.get(src);
  if (!url) {
    url = fetch(src)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${src}: ${r.status}`))))
      .then((b) => URL.createObjectURL(b));
    blobs.set(src, url);
    url.catch(() => blobs.delete(src));
  }
  return url;
}

/**
 * `<video use:appVideo={'examples/x.webm'}>`: plays one of the app's own videos. A video that should
 * be playing when its file arrives (`autoplay`, or `data-play="on"`) starts then.
 */
export function appVideo(node: HTMLVideoElement, src: string) {
  let current = src;
  const set = (s: string) => {
    current = s;
    if (!viaBlob) {
      node.src = s;
      return;
    }
    // a file that can't be read is given as is, so the video's own error handling takes over
    blobUrl(s).then(
      (url) => {
        if (current !== s) return;
        node.src = url;
        if (node.dataset.play === 'on') node.play().catch(() => {});
      },
      () => current === s && (node.src = s),
    );
  };
  set(src);
  return { update: set };
}
