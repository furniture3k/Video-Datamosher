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
  { id: 'looks', title: 'Templates… (make it look like an edit you\'ve seen)', group: 'Mosh', keys: ['Shift+L'], words: 'template style kinetic lyrics collage poster red notes behind subject' },
  { id: 'presets', title: 'Presets…', group: 'Mosh', keys: ['P'] },
  { id: 'randomize-graphics', title: 'Randomize the titles, shapes and canvas', group: 'Mosh', keys: [], words: 'chaos roll dice titles graphics look style layout' },
  { id: 'randomize', title: 'Randomize the effects', group: 'Mosh', keys: ['R'], words: 'chaos roll dice' },
  { id: 'nudge-settings', title: 'Nudge the effect settings', group: 'Mosh', keys: ['U'], words: 'mutate' },
  { id: 'variations', title: 'Variations…', group: 'Mosh', keys: ['V'], words: 'breed grid' },
  { id: 'chaos-up', title: 'Chaos dial: wilder', group: 'Mosh', keys: ['Q'] },
  { id: 'chaos-down', title: 'Chaos dial: calmer', group: 'Mosh', keys: ['Shift+Q'] },
  { id: 'sequencer', title: 'Add a Frame Sequencer at the playhead', group: 'Mosh', keys: ['G'] },
  { id: 'keyframe', title: 'Force a keyframe at the playhead', group: 'Mosh', keys: ['Shift+K'], words: 'i-frame' },
  { id: 'beat-edit', title: 'Auto-edit to the beat…', group: 'Mosh', keys: [], words: 'music cut' },
  { id: 'add-box', title: 'Add a box', group: 'Mosh', keys: [], words: 'shape rectangle annotate mark' },
  { id: 'add-circle', title: 'Add a circle', group: 'Mosh', keys: [], words: 'shape ring annotate mark' },
  { id: 'add-arrow', title: 'Add an arrow', group: 'Mosh', keys: [], words: 'shape pointer annotate mark' },
  { id: 'add-callout', title: 'Add a callout (box, leader line, title and small print)', group: 'Edit', keys: [], words: 'note label annotation point out leader' },
  { id: 'add-selection', title: 'Add selected text with handles and a menu (fake phone UI)', group: 'Edit', keys: [], words: 'fake ui handles copy paste menu highlight mockup' },
  { id: 'add-notification', title: 'Add a notification banner (fake phone UI)', group: 'Edit', keys: [], words: 'fake ui banner alert push message mockup' },
  { id: 'add-ripple', title: 'Add a click ripple (rings spreading from a tap)', group: 'Edit', keys: [], words: 'fake ui tap click cursor touch ring' },
  { id: 'add-polygon', title: 'Add a polygon', group: 'Edit', keys: [], words: 'shape sides hexagon pentagon octagon stop sign' },
  { id: 'add-leader', title: 'Add a leader line', group: 'Edit', keys: [], words: 'shape line squares ends pointer' },
  { id: 'pen', title: 'Draw with the pen', group: 'Mosh', keys: [], words: 'freehand scribble shape annotate' },
  { id: 'cutout', title: 'Cut out a subject (put titles behind it)', group: 'Mosh', keys: [], words: 'matte mask segment subject object person behind depth rotoscope' },
  { id: 'surface', title: 'Track a surface (pin titles to a screen, wall or sign)', group: 'Mosh', keys: [], words: 'pin plane corner perspective screen wall sign planar track homography' },
  { id: 'steal', title: 'Steal this edit: cut my clips like a reference video', group: 'Project', keys: [], words: 'copy reference rhythm cuts template style reel tiktok measure grade frame rate' },
  { id: 'script', title: 'Script: lines that become timed titles', group: 'Edit', keys: [], words: 'write lines titles words lyrics captions text timed beats' },
  { id: 'swap-cells', title: 'Swap the split screen’s clips between cells on the beat', group: 'Edit', keys: [], words: 'collage grid split screen swap shuffle rotate cells beat' },
  { id: 'reveal-beats', title: 'Reveal the selected layers one per beat', group: 'Edit', keys: [], words: 'stagger build up arrive beat titles shapes' },
  { id: 'flash-beats', title: 'Flash a colour on every beat', group: 'Edit', keys: [], words: 'white flash strobe hit drop beat frames colour' },
  { id: 'punch-beats', title: 'Zoom punch on every beat', group: 'Edit', keys: [], words: 'zoom in bounce pulse hit beat reel velocity edit camera' },
  { id: 'punch-bars', title: 'Zoom punch on every bar', group: 'Edit', keys: [], words: 'zoom in bounce pulse hit downbeat bar reel camera' },
  { id: 'shake-beats', title: 'Shake on every beat', group: 'Edit', keys: [], words: 'camera shake jolt hit beat impact reel velocity edit' },
  { id: 'ramp-beats', title: 'Speed ramp on the beat (velocity edit) for the selected clips', group: 'Edit', keys: [], words: 'velocity edit slow motion speed up beat ramp reel' },
  { id: 'punch-shake-beats', title: 'Zoom punch and shake on every beat', group: 'Edit', keys: [], words: 'camera shake zoom bounce hit impact beat reel' },
  { id: 'group', title: 'Group the selected titles and shapes', group: 'Edit', keys: [], words: 'link together move copy delete mark' },
  { id: 'ungroup', title: 'Ungroup the selected titles and shapes', group: 'Edit', keys: [], words: 'unlink separate' },
  { id: 'mark', title: 'Mark something moving', group: 'Mosh', keys: [], words: 'annotate box arrow label track follow' },
  { id: 'split-side', title: 'Split screen: side by side', group: 'Mosh', keys: [], words: 'grid layout collage two up' },
  { id: 'split-stack', title: 'Split screen: stacked', group: 'Mosh', keys: [], words: 'grid layout collage top bottom' },
  { id: 'split-grid', title: 'Split screen: 2 × 2 grid', group: 'Mosh', keys: [], words: 'grid layout collage four' },
  { id: 'flipbook', title: 'Flipbook…', group: 'Mosh', keys: [], words: 'pictures swap beat collage stop motion' },
  { id: 'word-beats', title: 'Words on the beat…', group: 'Mosh', keys: [], words: 'lyrics titles text kinetic type' },
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
  { id: 'toggle-media', title: 'Show / fold away the media panel', group: 'Show', keys: [], words: 'layout panel library' },
  { id: 'toggle-inspector', title: 'Show / fold away the inspector', group: 'Show', keys: [], words: 'layout panel settings' },
  { id: 'layout-edit', title: 'Layout: Edit', group: 'Show', keys: [], words: 'workspace panels cutting' },
  { id: 'layout-mosh', title: 'Layout: Mosh', group: 'Show', keys: [], words: 'workspace panels effects' },
  { id: 'layout-player', title: 'Layout: Big player', group: 'Show', keys: [], words: 'workspace panels watch preview' },
  { id: 'save-layout', title: 'Save this layout…', group: 'Show', keys: [], words: 'workspace panels' },
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
