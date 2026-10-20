import { describe, expect, it } from 'vitest';
import { latinUrl } from '../src/engine/fonts';
import { fontId } from '../src/engine/layers';

describe("Google Fonts' CSS", () => {
  it('picks the Latin file out of one block per alphabet', () => {
    const css = `/* cyrillic */
@font-face {
  font-family: 'Oswald';
  src: url(https://fonts.gstatic.com/s/oswald/cyr.woff2) format('woff2');
}
/* latin-ext */
@font-face {
  font-family: 'Oswald';
  src: url(https://fonts.gstatic.com/s/oswald/ext.woff2) format('woff2');
}
/* latin */
@font-face {
  font-family: 'Oswald';
  src: url('https://fonts.gstatic.com/s/oswald/latin.woff2') format('woff2');
}`;
    expect(latinUrl(css)).toBe('https://fonts.gstatic.com/s/oswald/latin.woff2');
  });

  it('takes the only block when there are no alphabet comments, and nothing from an error page', () => {
    expect(latinUrl("@font-face { font-family: 'X'; src: url(https://e.x/x.ttf) format('truetype'); }")).toBe('https://e.x/x.ttf');
    expect(latinUrl('<html>400 Bad Request</html>')).toBeNull();
  });
});

describe('title fonts', () => {
  it('tell built-in typefaces from added fonts', () => {
    expect(fontId('sans')).toBeNull();
    expect(fontId('font:abc123')).toBe('abc123');
  });
});
