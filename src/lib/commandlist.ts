// Every editor command with its name and default keys. Plain data (no app state), so the website's
// docs can list them too; what each command does is in commands.ts. Keys use "Mod" for Ctrl
// (⌘ on a Mac) and the key's name as the browser reports it ("Space", "ArrowLeft", "F9", "/").

export type CommandGroup = 'Playback' | 'Edit' | 'Marks' | 'Timeline' | 'Mosh' | 'Project' | 'Show';

export interface CommandInfo {
  id: string;
  title: string;
  group: CommandGroup;
  /** default shortcuts (can be changed in Help → Keyboard shortcuts) */
  keys: string[];
  /** extra words the palette matches */
  words?: string;
}

export const GROUPS: CommandGroup[] = ['Playback', 'Edit', 'Marks', 'Timeline', 'Mosh', 'Project', 'Show'];

export const COMMANDS: CommandInfo[] = [
  // playback
  { id: 'play', title: 'Play / pause', group: 'Playback', keys: ['Space'] },
  { id: 'shuttle-back', title: 'Play backwards (again for 2×, 4×…)', group: 'Playback', keys: ['J'], words: 'reverse rewind shuttle' },
  { id: 'stop', title: 'Stop', group: 'Playback', keys: ['K'] },
  { id: 'shuttle-forward', title: 'Play forwards (again for 2×, 4×…)', group: 'Playback', keys: ['L'], words: 'fast forward shuttle' },
  { id: 'frame-next', title: 'Next frame', group: 'Playback', keys: ['ArrowRight'], words: 'step' },
  { id: 'frame-prev', title: 'Previous frame', group: 'Playback', keys: ['ArrowLeft'], words: 'step' },
  { id: 'second-next', title: 'Forward one second', group: 'Playback', keys: ['Shift+ArrowRight'] },
  { id: 'second-prev', title: 'Back one second', group: 'Playback', keys: ['Shift+ArrowLeft'] },
  { id: 'edit-next', title: 'Next edit point', group: 'Playback', keys: ['ArrowDown'], words: 'cut jump' },
  { id: 'edit-prev', title: 'Previous edit point', group: 'Playback', keys: ['ArrowUp'], words: 'cut jump' },
  { id: 'marker-next', title: 'Next marker', group: 'Playback', keys: ['Shift+ArrowDown'] },
  { id: 'marker-prev', title: 'Previous marker', group: 'Playback', keys: ['Shift+ArrowUp'] },
  { id: 'go-start', title: 'Go to the start', group: 'Playback', keys: ['Home'] },
  { id: 'go-end', title: 'Go to the end', group: 'Playback', keys: ['End'] },
  { id: 'loop', title: 'Loop on / off', group: 'Playback', keys: ['/'] },
  { id: 'compare', title: 'Compare with the original', group: 'Playback', keys: ['C'], words: 'before after split' },

  // editing
  { id: 'tool-select', title: 'Select tool', group: 'Edit', keys: ['A'] },
  { id: 'tool-trim', title: 'Trim tool (roll cuts, slip clips)', group: 'Edit', keys: ['T'] },
  { id: 'tool-blade', title: 'Blade tool (click to cut)', group: 'Edit', keys: ['B'], words: 'razor' },
  { id: 'split', title: 'Split at the playhead', group: 'Edit', keys: ['S', 'Mod+B', 'Mod+K'], words: 'cut razor' },
  { id: 'delete', title: 'Delete', group: 'Edit', keys: ['Delete', 'Backspace'], words: 'remove' },
  { id: 'ripple-delete', title: 'Ripple delete (close the gap)', group: 'Edit', keys: ['Shift+Delete', 'Shift+Backspace'] },
  { id: 'toggle-enabled', title: 'Turn the selection off / on', group: 'Edit', keys: ['D'], words: 'disable enable mute' },
  { id: 'duplicate', title: 'Duplicate', group: 'Edit', keys: ['Mod+D'] },
  { id: 'copy', title: 'Copy', group: 'Edit', keys: ['Mod+C'] },
  { id: 'paste', title: 'Paste at the playhead', group: 'Edit', keys: ['Mod+V'] },
  { id: 'cut', title: 'Cut', group: 'Edit', keys: ['Mod+X'] },
  { id: 'select-all', title: 'Select all clips', group: 'Edit', keys: ['Mod+A'] },
  { id: 'nudge-left', title: 'Nudge one frame left', group: 'Edit', keys: [','] },
  { id: 'nudge-right', title: 'Nudge one frame right', group: 'Edit', keys: ['.'] },
  { id: 'nudge-left-10', title: 'Nudge ten frames left', group: 'Edit', keys: ['<'] },
  { id: 'nudge-right-10', title: 'Nudge ten frames right', group: 'Edit', keys: ['>'] },
  { id: 'freeze', title: 'Freeze frame (2 s hold) at the playhead', group: 'Edit', keys: ['Shift+R'], words: 'still hold' },
  { id: 'melt-cut', title: 'Melt the nearest cut', group: 'Edit', keys: ['Mod+T'], words: 'transition mosh' },
  { id: 'dissolve-cut', title: 'Cross dissolve the nearest cut', group: 'Edit', keys: ['Alt+T'], words: 'transition fade' },
  { id: 'insert', title: 'Insert the picked media at the playhead', group: 'Edit', keys: ['F9'] },
  { id: 'overwrite', title: 'Overwrite with the picked media', group: 'Edit', keys: ['F10'] },
  { id: 'place-on-top', title: 'Place the picked media on top', group: 'Edit', keys: ['F12'] },
  { id: 'append', title: 'Append the picked media at the end', group: 'Edit', keys: ['Shift+F12'] },

  // marks
  { id: 'mark-in', title: 'Mark In', group: 'Marks', keys: ['I'] },
  { id: 'mark-out', title: 'Mark Out', group: 'Marks', keys: ['O'] },
  { id: 'mark-clip', title: 'Mark the clip under the playhead', group: 'Marks', keys: ['X'] },
  { id: 'clear-in', title: 'Clear In', group: 'Marks', keys: ['Alt+I'] },
  { id: 'clear-out', title: 'Clear Out', group: 'Marks', keys: ['Alt+O'] },
  { id: 'clear-marks', title: 'Clear In and Out', group: 'Marks', keys: ['Alt+X'] },
  { id: 'marker', title: 'Add / remove a marker', group: 'Marks', keys: ['M'] },

  // timeline
  { id: 'snap', title: 'Snapping on / off', group: 'Timeline', keys: ['N'], words: 'magnet' },
  { id: 'zoom-in', title: 'Zoom in', group: 'Timeline', keys: ['=', '+', 'Mod+='] },
  { id: 'zoom-out', title: 'Zoom out', group: 'Timeline', keys: ['-', 'Mod+-'] },
  { id: 'zoom-fit', title: 'Fit the timeline', group: 'Timeline', keys: ['Shift+Z', '\\'] },

  // mosh
  { id: 'render', title: 'Render the mosh now', group: 'Mosh', keys: ['Enter'] },
  { id: 'add-effect', title: 'Add an effect…', group: 'Mosh', keys: ['Shift+A'], words: 'fx' },
  { id: 'presets', title: 'Presets…', group: 'Mosh', keys: ['P'] },
  { id: 'randomize', title: 'Randomize the effects', group: 'Mosh', keys: ['R'], words: 'chaos roll dice' },
  { id: 'nudge-settings', title: 'Nudge the effect settings', group: 'Mosh', keys: ['U'], words: 'mutate' },
  { id: 'variations', title: 'Variations…', group: 'Mosh', keys: ['V'], words: 'breed grid' },
  { id: 'chaos-up', title: 'Chaos dial: wilder', group: 'Mosh', keys: ['Q'] },
  { id: 'chaos-down', title: 'Chaos dial: calmer', group: 'Mosh', keys: ['Shift+Q'] },
  { id: 'sequencer', title: 'Add a Frame Sequencer at the playhead', group: 'Mosh', keys: ['G'] },
  { id: 'keyframe', title: 'Force a keyframe at the playhead', group: 'Mosh', keys: ['Shift+K'], words: 'i-frame' },
  { id: 'beat-edit', title: 'Auto-edit to the beat…', group: 'Mosh', keys: [], words: 'music cut' },
  { id: 'bake', title: 'Bake the mosh into a clip…', group: 'Mosh', keys: [] },
  { id: 'captions', title: 'Auto captions…', group: 'Mosh', keys: [], words: 'subtitles whisper' },
  { id: 'live', title: 'Live mode…', group: 'Mosh', keys: [], words: 'camera webcam' },

  // project
  { id: 'undo', title: 'Undo', group: 'Project', keys: ['Mod+Z'] },
  { id: 'redo', title: 'Redo', group: 'Project', keys: ['Mod+Shift+Z', 'Mod+Y'] },
  { id: 'history', title: 'History…', group: 'Project', keys: ['Mod+Alt+Z'], words: 'undo list' },
  { id: 'save', title: 'Save project file', group: 'Project', keys: ['Mod+S'] },
  { id: 'save-as', title: 'Save project as…', group: 'Project', keys: [] },
  { id: 'snapshot', title: 'Save a snapshot', group: 'Project', keys: ['Mod+Shift+S'], words: 'version' },
  { id: 'snapshots', title: 'Snapshots…', group: 'Project', keys: [] },
  { id: 'export', title: 'Export…', group: 'Project', keys: ['E'], words: 'render mp4 gif' },
  { id: 'new-project', title: 'New project', group: 'Project', keys: [] },
  { id: 'home', title: 'All projects', group: 'Project', keys: [], words: 'home' },
  { id: 'share-code', title: 'Share code…', group: 'Project', keys: [], words: 'recipe' },
  { id: 'save-recipe', title: 'Save recipe file…', group: 'Project', keys: [], words: 'moshrecipe preset effects' },
  { id: 'open-recipe', title: 'Open recipe file…', group: 'Project', keys: [], words: 'moshrecipe load effects' },
  { id: 'batch', title: 'Batch: same mosh on many videos…', group: 'Project', keys: [], words: 'export many files queue' },
  { id: 'midi', title: 'Use a MIDI controller', group: 'Mosh', keys: [], words: 'knob fader osc controller hardware' },
  { id: 'record', title: 'Record from camera or screen…', group: 'Project', keys: [] },
  { id: 'generate', title: 'Generate footage…', group: 'Project', keys: [] },

  // showing things
  { id: 'palette', title: 'Find a command…', group: 'Show', keys: ['Mod+P', 'Mod+Shift+P'], words: 'palette search' },
  { id: 'help', title: 'Help & shortcuts', group: 'Show', keys: ['?'] },
  { id: 'scopes', title: 'Scopes on / off', group: 'Show', keys: ['Shift+S'], words: 'waveform vectorscope histogram' },
  { id: 'advanced', title: 'Advanced controls on / off', group: 'Show', keys: [], words: 'simple mode' },
  { id: 'theme', title: 'Light / dark theme', group: 'Show', keys: [] },
  { id: 'auto-render', title: 'Auto-render on / off', group: 'Show', keys: [] },
  { id: 'storage', title: 'Storage…', group: 'Show', keys: [] },
  { id: 'whats-new', title: "What's new", group: 'Show', keys: [] },
  { id: 'tour', title: 'Take the tour', group: 'Show', keys: [] },
  { id: 'report', title: 'Report a problem…', group: 'Show', keys: [], words: 'bug' },
];

/** Things the mouse does with keys held, shown in Help and the docs (not commands). */
export const MOUSE_HINTS: [string, string][] = [
  ['Click the timecode', 'Type a time to jump to: 1:30, 00:01:12:05, +2, -10f'],
  ['Alt + drag', 'Select tool: roll a cut (on an edge) or slip a clip (on its body)'],
  ['Shift while dragging', 'No snapping'],
  ['Ctrl + wheel / Alt + wheel', 'Zoom the timeline'],
  ['Esc', 'Back to the Select tool / deselect / close'],
];

/** "Mod+Shift+K" → "Ctrl Shift K" (⌘ ⇧ K on a Mac). */
export function keyLabel(combo: string, mac = false): string {
  const names: Record<string, string> = mac
    ? { Mod: '⌘', Shift: '⇧', Alt: '⌥', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Backspace: '⌫', Delete: 'Del', Enter: '↩' }
    : { Mod: 'Ctrl', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Del' };
  return combo
    .split(/\+(?!$)/)
    .map((p) => names[p] ?? p)
    .join(' ');
}
