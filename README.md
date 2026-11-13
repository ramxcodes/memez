# Memez

A local meme library for macOS. Paste or drop memes, give them a title and tags, then find them
from anywhere with a hotkey popup.

- Library folder: `~/Memez` (`library.json` + `media/`). Set `MEMEZ_LIBRARY` to use another folder.
- Types: PNG, JPG, WebP, GIF, MP4, WebM.
- Search: fuzzy match on tags, title and text in the image (Apple Vision OCR, images only),
  then search by meaning: "crying" finds a crying cat with no such tag.
- Local AI: each new image, GIF or video gets a title (if empty) and tags. GIFs and videos are
  read from a few frames across the clip, and the text in them is read too. It never changes
  what you typed. The models (about 570 MB) download once on first launch into the app data folder;
  the sidebar shows progress. Nothing leaves your Mac.

## Use

- **Add:** copy an image, GIF, video or link, then press ⌘V in the library window. Or drop files in.
  Copied images from a browser are downloaded from the source, so GIFs stay animated.
- **Find:** press the hotkey (default ⌘⇧M, change it in the library sidebar).
  Type, then click a meme or press Enter to paste it into the app you were in. ⌘1–⌘9 paste by
  position, ⌘C only copies. Before you type, recent memes come first.
  The first paste asks for Accessibility access (System Settings → Privacy & Security).
- **Quick add:** in the hotkey popup, press ⌘V to add the meme on the clipboard.
- **Settings (⌘,):** turn Local AI on or off, see or delete the downloaded models, change the
  hotkey, and choose whether picking a meme pastes it or only copies it.
- **Move to another Mac:** Export makes a zip. Import merges a zip; duplicates are skipped and
  their tags are added.

## Raycast

Settings → Raycast → **Install** adds two Raycast commands. Memez copies a built extension into
Raycast's folder (`~/.config/raycast/extensions/memez`), so no `npm` and no running process.
When Memez updates, it updates the extension too. **Remove** takes it out.

- **Search Memes:** a grid of your memes, 50 at a time, recent first. Same search as the popup,
  but no search by meaning. Enter pastes, ⌘↵ copies, ⌘⇧V adds the meme on the clipboard,
  ⌘⇧F shows it in Finder. It reads the library folder, so it works when Memez is closed.
- **Add Meme from Clipboard:** adds the copied image, GIF, video or link, like ⌘V in the popup.
  Memez starts if needed and shows the result as a notification.

Raycast never writes to the library. It sends `memez://add` or `memez://used/<id>` links to the
app (`src/main/links.ts`). A paste moves the meme up in "recent" only while Memez is running.
Your library is not in `~/Memez`? Change it in Raycast: Settings → Extensions → Memez.

To work on the extension: `cd raycast && npm install && npm run dev`. It uses the same Raycast
folder as Install, so Memez replaces your dev build when it starts. `npm run build:raycast`
builds it into `resources/raycast/` for the app; Install in `npm run dev` needs that first.

## Develop

```bash
npm install
npm --prefix raycast install  # once, build:mac also builds the Raycast extension
npm run dev        # run the app
npm test           # unit tests
npm run typecheck
npm run build:mac  # Memez.app in dist/mac-arm64/
```

The build is not signed. On first open, right-click the app and choose Open.
If macOS says the app is damaged, run `xattr -cr /Applications/Memez.app`.
