// StreamGrab Content Script
// Detects HTML5 video elements, media sources, and video thumbnails

(() => {
  const detectedUrls = new Set();

  function isValidMediaUrl(src) {
    if (!src || typeof src !== "string") return false;
    src = src.trim();
    if (!src || src.startsWith("data:") || src.startsWith("javascript:")) return false;

    const lower = src.toLowerCase();
    if (
      lower.includes("google-analytics") ||
      lower.includes("/ad/") ||
      lower.includes("doubleclick") ||
      lower.includes("init.mp4") ||
      lower.includes("_init.") ||
      lower.includes("-init.") ||
      lower.includes(".m4s") ||
      lower.includes("ext-x-map") ||
      lower.includes("/frag") ||
      lower.includes("/segment") ||
      lower.includes("/chunk") ||
      lower.includes("range=") ||
      lower.includes("bytes=")
    ) {
      return false;
    }
    return true;
  }

  function getFormatFromUrl(url) {
    const clean = url.toLowerCase().split("?")[0];
    if (clean.endsWith(".m3u8")) return "HLS (.m3u8)";
    if (clean.endsWith(".mpd")) return "DASH (.mpd)";
    if (clean.endsWith(".mp4")) return "MP4";
    if (clean.endsWith(".webm")) return "WEBM";
    if (clean.endsWith(".mov") || clean.endsWith(".mkv") || clean.endsWith(".m4v") || clean.endsWith(".avi")) return "VIDEO";
    return "VIDEO";
  }

  function cleanFilename(url, format) {
    try {
      const u = new URL(url, window.location.href);
      let name = u.pathname.substring(u.pathname.lastIndexOf("/") + 1);
      if (!name || name.length > 50 || name.includes("playlist")) {
        name = document.title.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().replace(/\s+/g, "_").slice(0, 40) || "video";
      }
      name = name.split("?")[0];
      if (!name.includes(".")) {
        name += format.includes("HLS") ? ".mp4" : ".mp4";
      }
      return decodeURIComponent(name);
    } catch {
      return (document.title.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().replace(/\s+/g, "_").slice(0, 30) || "video") + ".mp4";
    }
  }

  function extractThumbnail(video) {
    if (!video) return null;

    // 1. Direct poster on this specific <video>
    if (video.poster && video.poster.startsWith("http")) {
      return video.poster;
    }

    // 2. Live canvas snapshot if video has loaded any frames
    try {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, 160, 90);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        if (dataUrl && dataUrl.length > 200) return dataUrl;
      }
    } catch (e) {
      // Cross-origin tainted canvas
    }

    // 3. Search this specific video's immediate parent card for its preview thumbnail img
    const container = video.closest(".video-container, .player, [class*='player'], [class*='video'], article, section") || video.parentElement;
    if (container) {
      const img = container.querySelector("img[src*='thumb'], img[src*='poster'], img[src*='preview'], [class*='poster'] img");
      if (img && img.src && img.src.startsWith("http") && !img.src.includes("avatar") && !img.src.includes("logo")) {
        return img.src;
      }
    }

    // Notice: We strictly DO NOT fall back to global og:image, to prevent showing the old/first video's image!
    return null;
  }

  function reportMedia(rawUrl, videoElement = null) {
    if (!isValidMediaUrl(rawUrl)) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(rawUrl, window.location.href).href;
    } catch {
      return;
    }

    const isBlob = absoluteUrl.startsWith("blob:");
    const cleanKey = absoluteUrl.split("?")[0];

    // If video is a blob URL, we capture its live frame and attach to the most recent stream
    if (isBlob && videoElement) {
      const thumb = extractThumbnail(videoElement);
      if (thumb) {
        chrome.runtime.sendMessage({
          type: "UPDATE_THUMBNAIL",
          url: absoluteUrl,
          thumbnail: thumb,
          isLatest: true
        }).catch(() => {});
      }
      return;
    }

    if (detectedUrls.has(cleanKey)) {
      if (videoElement) {
        const thumb = extractThumbnail(videoElement);
        if (thumb) {
          chrome.runtime.sendMessage({
            type: "UPDATE_THUMBNAIL",
            url: absoluteUrl,
            thumbnail: thumb,
            isLatest: true
          }).catch(() => {});
        }
      }
      return;
    }
    detectedUrls.add(cleanKey);

    const format = getFormatFromUrl(absoluteUrl);
    const thumbnail = extractThumbnail(videoElement);

    const media = {
      id: btoa(encodeURIComponent(absoluteUrl.slice(0, 100))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16),
      url: absoluteUrl,
      format,
      size: null,
      sizeRaw: 0,
      filename: cleanFilename(absoluteUrl, format),
      pageTitle: document.title || "Video",
      thumbnail: thumbnail || null,
      timestamp: Date.now()
    };

    chrome.runtime.sendMessage({
      type: "ADD_MEDIA_FROM_DOM",
      media
    }).catch(() => {});
  }

  function hookVideoElement(v) {
    if (v.__streamgrab_hooked) return;
    v.__streamgrab_hooked = true;

    if (v.src) reportMedia(v.src, v);
    if (v.currentSrc) reportMedia(v.currentSrc, v);

    const checkEvents = ["play", "loadedmetadata", "loadeddata", "playing", "timeupdate", "seeked"];
    checkEvents.forEach(evt => {
      v.addEventListener(evt, () => {
        const activeSrc = v.currentSrc || v.src;
        if (activeSrc) {
          reportMedia(activeSrc, v);
          if (v.videoWidth > 0) {
            const thumb = extractThumbnail(v);
            if (thumb) {
              chrome.runtime.sendMessage({
                type: "UPDATE_THUMBNAIL",
                url: activeSrc,
                thumbnail: thumb,
                isLatest: true
              }).catch(() => {});
            }
          }
        }
      }, { passive: true });
    });
  }

  function scanMediaElements() {
    const videos = document.querySelectorAll("video");
    videos.forEach(v => hookVideoElement(v));

    const sources = document.querySelectorAll("source");
    sources.forEach(s => {
      if (s.src) {
        const parentVideo = s.closest("video");
        reportMedia(s.src, parentVideo);
      }
    });

    const links = document.querySelectorAll("a[href]");
    links.forEach(a => {
      const href = a.getAttribute("href");
      if (href && /\.(mp4|m3u8|webm|mov|mkv)(\?.*)?$/i.test(href)) {
        reportMedia(href, null);
      }
    });
  }

  scanMediaElements();

  const observer = new MutationObserver(mutations => {
    let shouldScan = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0 || m.attributeName === "src") {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      scanMediaElements();
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"]
  });

  window.addEventListener("load", scanMediaElements);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SCAN_NOW") {
      scanMediaElements();
      sendResponse({ success: true, count: detectedUrls.size });
      return true;
    }
  });
})();
