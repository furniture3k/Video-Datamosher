# Security

moshpit runs entirely on your device: media is never uploaded and the app talks to no server
(apart from loading a web font). Problems that could still matter: a crafted video or project
file that makes the app misbehave, or the desktop app reading or writing files it shouldn't.

Please report anything like that privately through GitHub's
[security advisory form](https://github.com/furniture3k/Video-Datamosher/security/advisories/new)
rather than a public issue. Fixes go into the latest release.

Bugs in FFmpeg itself should go to the FFmpeg project (https://ffmpeg.org/security.html); the
desktop app picks up their fixes with its next build.
