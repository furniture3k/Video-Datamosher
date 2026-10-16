// Keyboard shortcuts as a simple list, for the website's docs (made from the editor's commands, so
// the two can't disagree). The editor's own Help shows the same commands with your own keys.
import { COMMANDS, GROUPS, MOUSE_HINTS, keyLabel } from './commandlist';

export const SHORTCUTS: [string, string][] = [
  ...GROUPS.flatMap((g) => COMMANDS.filter((c) => c.group === g && c.keys.length).map((c): [string, string] => [c.keys.map((k) => keyLabel(k)).join('  or  '), c.title])),
  ...MOUSE_HINTS,
];
