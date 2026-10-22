// confirm(), prompt() and alert() that work everywhere. The desktop app's macOS webview (WKWebView)
// has no built-in alert/confirm/prompt dialogs (they silently do nothing), so on desktop
// these show a small in-app dialog instead. The browser keeps its native dialogs.
import { isDesktop } from './platform';

/** OK/Cancel question. Resolves true for OK. */
export function ask(message: string, ok = 'OK'): Promise<boolean> {
  if (!isDesktop) return Promise.resolve(confirm(message));
  return show(message, null, ok).then((r) => r !== null);
}

/** Text question. Resolves with the text, or null when cancelled. */
export function askText(message: string, value = ''): Promise<string | null> {
  if (!isDesktop) return Promise.resolve(prompt(message, value));
  return show(message, value, 'OK');
}

/** A message with an OK button (alert()). */
export function tell(message: string): Promise<void> {
  if (!isDesktop) return Promise.resolve(alert(message));
  return show(message, null, 'OK', false).then(() => {});
}

function show(message: string, value: string | null, okLabel: string, withCancel = true): Promise<string | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'ask-backdrop';
    back.setAttribute('style', 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px');
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('style', 'width:min(420px,100%);background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r);box-shadow:var(--shadow);padding:16px;display:flex;flex-direction:column;gap:12px');
    const text = document.createElement('div');
    text.textContent = message;
    text.setAttribute('style', 'white-space:pre-wrap;line-height:1.45');
    box.appendChild(text);
    let input: HTMLInputElement | null = null;
    if (value !== null) {
      input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      input.setAttribute('style', 'width:100%');
      box.appendChild(input);
    }
    const row = document.createElement('div');
    row.setAttribute('style', 'display:flex;justify-content:flex-end;gap:8px');
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = okLabel;
    row.append(...(withCancel ? [cancel] : []), ok);
    box.appendChild(row);
    back.appendChild(box);
    const prevFocus = document.activeElement as HTMLElement | null;
    const done = (r: string | null) => {
      back.remove();
      prevFocus?.focus?.();
      resolve(r);
    };
    ok.onclick = () => done(input ? input.value : '');
    cancel.onclick = () => done(null);
    back.onclick = (e) => e.target === back && done(null);
    // keep keys away from the editor's shortcuts while the question is open
    back.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
      // (Enter on a focused button presses that button: Cancel stays Cancel)
      else if (e.key === 'Enter' && e.target !== cancel) {
        e.preventDefault();
        ok.click();
      }
    });
    document.body.appendChild(back);
    (input ?? ok).focus();
    input?.select();
  });
}
