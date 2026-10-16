// Renders public/og.png, the 1200×630 card shown when a link to moshpit is shared.
// Usage: node scripts/og-image.mjs   (run again after changing the logo or the demo GIF)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const gif = 'data:image/gif;base64,' + fs.readFileSync(path.resolve('docs/demo.gif')).toString('base64');
const LOGO = 'M6 8a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14h-4v3h-4v-5h-4v7h-4v-4H6zM13.5 9v7l6-3.5z';
const html = `<!doctype html><html><body style="margin:0">
<div style="width:1200px;height:630px;box-sizing:border-box;padding:72px;background:#0b0b0d;color:#ededee;display:flex;gap:56px;align-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
  <div style="flex:1;display:flex;flex-direction:column;gap:28px">
    <div style="display:flex;align-items:center;gap:20px;font-size:84px;font-weight:800;letter-spacing:-4px">
      <svg width="92" height="98" viewBox="4 3 24 26"><path d="${LOGO}" fill="#c8f031" fill-rule="evenodd"/></svg>moshpit
    </div>
    <div style="font-size:38px;line-height:1.25;font-weight:600;letter-spacing:-0.5px">A video editor with a datamosher built in.</div>
    <div style="font-size:26px;line-height:1.4;color:#a4a4ac">Melt, bloom and glitch your clips in the browser. Free, open source, nothing uploaded.</div>
  </div>
  <div style="width:420px;height:420px;border-radius:20px;overflow:hidden;border:2px solid #323238;flex:none;background:#000">
    <img id="g" src="${gif}" style="width:100%;height:100%;object-fit:cover">
  </div>
</div></body></html>`;

const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.waitForFunction(() => document.getElementById('g').complete);
// let the GIF play into the melt
await page.waitForTimeout(2600);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
console.log('wrote public/og.png');
