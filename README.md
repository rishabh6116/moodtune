# Moodtune

A local-first, Spotify-style music player that runs entirely in your browser. Point it at a folder of music on your computer and it builds a full library UI — browse, search, and play your own files with no server, account, or upload required.

## Features

- **Local folder playback** — pick a folder via the File System Access API (or drag-and-drop files/folders) and Moodtune indexes every track inside it.
- **Persistent library** — your folder handle and track metadata are cached in IndexedDB, so your library reloads automatically next time you open the app, without re-picking the folder.
- **ID3 tag reading** — uses [jsmediatags](https://github.com/aadsm/jsmediatags) to pull title, artist, and album info straight out of audio file metadata.
- **Folder-based playlists** — subfolders in your chosen directory are surfaced as browsable playlists in the sidebar / mobile nav.
- **Search** — query your local track pool by title/artist from the top search bar.
- **Full playback controls** — play/pause, next/prev, seek bar with drag support, volume control, and a live progress clock.
- **Light & dark themes** — toggle manually, or let it follow your OS `prefers-color-scheme` automatically; choice is remembered.
- **Responsive layout** — separate, optimized views for desktop sidebar navigation and a mobile-friendly folder/track browser.
- **Drag-and-drop import** — drop music files or folders anywhere on the page to load them.
- **Client-side only** — no backend, no accounts, no file uploads; everything (including caching) happens locally in your browser.

## Project structure

```
moodtune/
├── index.html            # Page markup/structure
├── style.css             # Theming (light/dark) and all visual styling
├── script.js             # Audio engine, library indexing, caching, UI logic
├── favicon.svg           # Scalable favicon (green circle, "M")
├── favicon.ico           # Multi-size fallback favicon (16/32/48px)
├── favicon-16x16.png     # PNG favicon, 16x16
├── favicon-32x32.png     # PNG favicon, 32x32
├── apple-touch-icon.png  # iOS/Android home-screen icon, 180x180
└── README.md             # This file
```

## Getting started

1. Download/clone this folder.
2. Open `index.html` in a modern browser (Chrome or Edge recommended — see Browser support below).
3. Click **Choose Music Folder** and select a folder containing your audio files.
4. Browse, search, and play. Your library will be remembered automatically the next time you open the app.

No build step, no `npm install`, no server — it's a static site you can open directly from disk or host anywhere static files are served.

## Browser support

Moodtune relies on a few modern web APIs:

| API | Used for | Notes |
|---|---|---|
| [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (`showDirectoryPicker`) | Picking and re-verifying a music folder, with persistence across sessions | Chrome/Edge (Chromium) only. Requires a secure context (`https://` or `localhost`). |
| IndexedDB | Caching track metadata and folder handles between sessions | Broadly supported |
| `<input webkitdirectory>` + drag-and-drop | Fallback folder/file import | Wider browser support, but without the persistent re-access that `showDirectoryPicker` provides |

On browsers without `showDirectoryPicker` (e.g. Firefox, Safari), use the manual folder/file picker or drag-and-drop instead — playback and search will still work, but the folder won't automatically reconnect on reload.

## How it works (high level)

- **`script.js`** is organized into a few key systems:
  - **Theme system** — reads/writes a `localStorage` preference and listens for OS theme changes.
  - **Audio engine** — wraps a single `<audio>` element with play/pause/seek/next/prev logic and a simulated progress clock.
  - **Local library / DB layer** — uses IndexedDB (`CrateFolderDB`) to store the folder handle and cached track records (including file blobs) so the library survives page reloads.
  - **Folder scanning** — recursively walks a picked directory (`scanDirectoryEntryTree`) to discover audio files and reads ID3 tags via jsmediatags.
  - **UI rendering / view router** — builds the home screen, folder views, search results, and mobile panels, with simple back/forward history handling via the History API.

## Credits

- Tag parsing via [jsmediatags](https://github.com/aadsm/jsmediatags) (loaded from cdnjs).
- Fonts: [Fraunces](https://fonts.google.com/specimen/Fraunces), [Inter](https://fonts.google.com/specimen/Inter), and [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) via Google Fonts.

## License

No license specified — add one here if you plan to share or publish this project.
