# Local Review

## Public generator

From the repository root:

```bash
npm run app
```

Open:

```text
http://127.0.0.1:4173/
```

## Template Studio

From the repository root:

```bash
npm run studio
```

Open:

```text
http://127.0.0.1:4173/studio/
```

Both commands use the same existing loopback-only Node server. The command selects the URL announced at startup; it does not create a second server implementation or change either surface.

Never review `public/index.html` through `file://`. The application uses an ES module and fetches `templates.json`; browser security rules differ for local files, so the static shell and logo can appear even though the template catalog cannot load. That is an invalid review environment, not evidence that flyers disappeared.

When opened through `file://`, the public HTML displays a developer-facing warning with the correct command and URL. The warning remains hidden during normal localhost and production HTTP(S) use.
