// The app's version and release notes, baked in at build time.
import pkg from '../../package.json';
import changelogMd from '../../CHANGELOG.md?raw';
import { parseChangelog } from '../engine/changelog';

export const VERSION: string = pkg.version;
export const REPO = 'https://github.com/furniture3k/Video-Datamosher';
export const releases = parseChangelog(changelogMd);
