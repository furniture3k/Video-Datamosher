// Reading Google Fonts' answers (pure, so it's tested without the network).

/**
 * The font file in Google Fonts' CSS for the Latin alphabet. Google sends one @font-face per
 * alphabet, each after a comment naming it (/* latin *\/); without comments there's just one.
 */
export function latinUrl(css: string): string | null {
  const faces = [...css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)].map((m) => ({ subset: m[1] ?? '', body: m[2] }));
  const face = faces.find((f) => f.subset === 'latin') ?? faces.at(-1);
  const url = face && /url\(([^)]+)\)/.exec(face.body)?.[1];
  return url ? url.replace(/['"]/g, '') : null;
}
