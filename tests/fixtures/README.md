# Test fixtures

- `BigShoulders-Bold.ttf`: Big Shoulders (variable), Copyright The Big Shoulders Project Authors,
  SIL Open Font License 1.1. From https://github.com/google/fonts/tree/main/ofl/bigshoulders.
  Used by the fonts step in `scripts/e2e-ui.mjs` (override with `FONT_FILE`).

## Photos for the model checks (`scripts/models-check.mjs`)

Both are public domain, from Wikimedia Commons.

- `dog.jpg`: "Golden Retriever Dukedestiny01 drvd.jpg",
  https://commons.wikimedia.org/wiki/File:Golden_Retriever_Dukedestiny01_drvd.jpg (public domain).
  A known subject to cut out.
- `portrait.jpg`: "President Barack Obama.jpg" (official White House photo by Pete Souza, scaled to 640 px wide),
  https://commons.wikimedia.org/wiki/File:President_Barack_Obama.jpg (public domain, work of the US federal government).
  A known face to find.
- `astronaut.jpg`: "Aldrin Apollo 11 original.jpg" (NASA, scaled to 640 px wide),
  https://commons.wikimedia.org/wiki/File:Aldrin_Apollo_11_original.jpg (public domain).
  A third subject for comparing the cut-out models: a person against a plain, dark sky.
