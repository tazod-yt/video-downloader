# StreamGrab - In-Browser Video Downloader

> A zero-backend, client-side video downloader and HLS transmuxer browser extension designed for Chrome, Edge, Brave, Opera, Opera GX, Vivaldi, and other modern browsers.

Inspired by Video DownloadHelper, but **without requiring any external companion app, backend servers, or subscriptions**. Everything runs locally on your browser using client-side JavaScript, the Web Crypto API, and Mux.js.

---

## Features

- **Zero Backend / 100% Private:** No media ever touches third-party servers. All sniffing, fetching, decrypting, and assembling happens inside your browser.
- **Direct Video Sniffing:** Automatically detects `.mp4`, `.webm`, `.mov`, `.mkv`, and HTML5 video streams as you browse.
- **HLS (.m3u8) Transmuxer:**
  - Full-page interactive dashboard.
  - Detects master playlists and allows quality and resolution selection (1080p, 720p, etc.).
  - Concurrent multi-threaded downloading of `.ts` chunks (configurable 2x to 10x speeds).
  - Built-in AES-128 decryption using the standard Web Crypto API.
  - Converts MPEG-TS streams into a standard `.mp4` container directly on your CPU/GPU without ffmpeg.
  - Supports modern fragmented MP4 (fMP4 / `EXT-X-MAP`) streams.
  - Real-time download speed, segment count, and ETA timer.
  - In-browser playback preview before saving to disk.
- **Universal Browser Support:** Fully compatible with Chromium Manifest V3 and Chromium-based extensions.

---

## Installation Guide

Follow the instructions below for your specific browser:

### Google Chrome
1. Open Google Chrome.
2. Navigate to `chrome://extensions` in the address bar.
3. Toggle on **Developer mode** in the top-right corner.
4. Click the **Load unpacked** button in the top toolbar.
5. Select the project directory (the folder containing `manifest.json`).
6. Pin **StreamGrab** to your toolbar for easy access.

### Microsoft Edge
1. Open Microsoft Edge.
2. Navigate to `edge://extensions` in the address bar.
3. Turn on the **Developer mode** toggle located in the left sidebar.
4. Click the **Load unpacked** button at the top of the page.
5. Select the project directory (the folder containing `manifest.json`).
6. Pin **StreamGrab** to your toolbar.

### Brave Browser
1. Open Brave Browser.
2. Navigate to `brave://extensions` in the address bar.
3. Toggle on **Developer mode** in the top-right corner.
4. Click the **Load unpacked** button.
5. Select the project directory (the folder containing `manifest.json`).
6. Pin **StreamGrab** to your extensions toolbar.

### Opera / Opera GX
1. Open Opera or Opera GX.
2. Navigate to `opera://extensions` in the address bar.
3. Enable **Developer mode** via the toggle switch in the top-right corner.
4. Click the **Load unpacked** button from the top toolbar.
5. Select the project directory (the folder containing `manifest.json`).
6. Pin **StreamGrab** to your extensions toolbar.

### Vivaldi
1. Open Vivaldi.
2. Navigate to `vivaldi://extensions` in the address bar.
3. Enable **Developer mode** in the top-right corner.
4. Click the **Load unpacked** button.
5. Select the project directory (the folder containing `manifest.json`).

### Arc Browser
1. Open Arc Browser.
2. Open the command bar (`Ctrl+T` or `Cmd+T`) and go to `arc://extensions`.
3. Enable **Developer mode** in the upper-right corner.
4. Click **Load unpacked** and select the project directory.

### Mozilla Firefox (Developer / Testing)
1. Open Firefox.
2. Navigate to `about:debugging#/runtime/this-firefox` in the address bar.
3. Click the **Load Temporary Add-on...** button.
4. Navigate into the project folder and select the `manifest.json` file.
5. StreamGrab will be loaded temporarily for your debugging session.

---

## How to Use

### 1. Downloading Direct Videos (MP4, WebM)
1. Open any webpage containing a video player.
2. Start playing the video.
3. Click the **StreamGrab** extension icon in your browser toolbar.
4. The popup will display the detected media stream format and file size.
5. Click **Download MP4** or click **Preview** to view before saving.

### 2. Downloading Streaming Playlists (HLS / .m3u8)
1. Play any stream or video on a webpage.
2. Click the **StreamGrab** icon in the toolbar.
3. When an **HLS (.m3u8)** stream is detected, click **Convert HLS to MP4**.
4. A dedicated conversion dashboard will open displaying:
   - Available stream resolution and quality variants.
   - Segment counter and multi-threading parallel download settings.
5. Click **Start Download**. The extension fetches and decrypts segments, transmuxes them into a standard MP4 file, and lets you preview or save the completed video to disk.

---

## Project Structure

```
video-downloader/
├── manifest.json            # Manifest V3 extension configuration
├── background.js           # Background service worker (traffic sniffer & storage)
├── content.js              # DOM scanner for <video> elements
├── popup.html              # Extension toolbar popup interface
├── popup.css               # Dark theme styling for popup
├── popup.js                # Popup logic, media card rendering & filters
├── hls-downloader.html     # Dedicated tab for HLS transmuxing
├── hls-downloader.css      # Transmuxer dashboard styles
├── hls-downloader.js       # HLS parser, AES-128 decryptor & MP4 assembler
├── lib/
│   ├── hls.light.min.js    # Client-side HLS video player library
│   └── mux.min.js          # Video.js MPEG-TS to MP4 client-side transmuxer
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md               # Documentation & setup guide
```

---

## License & Privacy

- Runs 100% locally on your machine.
- No analytics, tracking, or network telemetry.
- No third-party server dependencies or companion apps.
