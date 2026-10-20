// StreamGrab Background Service Worker
const mediaStore = new Map();

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return null;
  const num = parseInt(bytes, 10);
  if (num === 0) return null;
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return parseFloat((num / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function cleanFilename(url, format) {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    let name = pathname.substring(pathname.lastIndexOf("/") + 1);
    if (!name || name.length > 50 || name.includes("playlist")) {
      name = "video_" + Date.now();
    }
    name = name.split("?")[0];
    if (format && format.includes("HLS") && !name.endsWith(".mp4")) {
      name = name.replace(/\.[^/.]+$/, "") + ".mp4";
    }
    return decodeURIComponent(name);
  } catch {
    return "video_" + Date.now() + ".mp4";
  }
}

function isFragmentOrInit(url) {
  const lower = url.toLowerCase();
  if (
    lower.includes("init.mp4") ||
    lower.includes("_init.") ||
    lower.includes("-init.") ||
    lower.includes("init-") ||
    lower.includes("init_") ||
    lower.includes(".m4s") ||
    lower.includes("ext-x-map") ||
    lower.includes("/frag") ||
    lower.includes("/segment") ||
    lower.includes("/chunk") ||
    lower.includes("range=") ||
    lower.includes("bytes=") ||
    lower.includes("google-analytics") ||
    lower.includes("/ad/") ||
    lower.includes("doubleclick") ||
    lower.includes("beacon")
  ) {
    return true;
  }
  return false;
}

function parseMediaDetails(details) {
  const url = details.url;
  if (!url || url.startsWith("chrome-extension://")) return null;
  if (isFragmentOrInit(url)) return null;

  let contentType = "";
  let contentLength = null;

  if (details.responseHeaders) {
    for (const h of details.responseHeaders) {
      const name = h.name.toLowerCase();
      if (name === "content-type") contentType = (h.value || "").toLowerCase();
      if (name === "content-length") contentLength = h.value;
    }
  }

  const urlLower = url.toLowerCase().split("?")[0];

  let format = null;
  if (
    contentType.includes("application/x-mpegurl") ||
    contentType.includes("application/vnd.apple.mpegurl") ||
    urlLower.endsWith(".m3u8")
  ) {
    format = "HLS (.m3u8)";
  } else if (contentType.includes("application/dash+xml") || urlLower.endsWith(".mpd")) {
    format = "DASH (.mpd)";
  } else if (contentType.includes("video/mp4") || urlLower.endsWith(".mp4")) {
    format = "MP4";
  } else if (contentType.includes("video/webm") || urlLower.endsWith(".webm")) {
    format = "WEBM";
  } else if (contentType.startsWith("video/") || /\.(mov|mkv|flv|m4v|avi)(\?.*)?$/i.test(url)) {
    format = "VIDEO";
  }

  if (!format) return null;

  if (urlLower.endsWith(".ts") && !urlLower.includes("master")) return null;

  // Filter out tiny files (< 150 KB) for direct video
  if (format === "MP4" || format === "WEBM" || format === "VIDEO") {
    if (contentLength && parseInt(contentLength, 10) < 150 * 1024) {
      return null;
    }
  }

  return {
    id: btoa(encodeURIComponent(url.slice(0, 100))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16),
    url,
    format,
    size: formatBytes(contentLength),
    sizeRaw: contentLength ? parseInt(contentLength, 10) : 0,
    filename: cleanFilename(url, format),
    thumbnail: null,
    timestamp: Date.now()
  };
}

function getBaseDir(urlString) {
  try {
    const u = new URL(urlString);
    return u.origin + u.pathname.substring(0, u.pathname.lastIndexOf("/"));
  } catch {
    return "";
  }
}

chrome.webRequest.onHeadersReceived.addListener(
  details => {
    if (details.tabId < 0) return;

    const media = parseMediaDetails(details);
    if (!media) return;

    let list = mediaStore.get(details.tabId) || [];

    // Deduplicate by clean path without query params
    const cleanUrl = media.url.split("?")[0];
    const existingIndex = list.findIndex(item => item.url.split("?")[0] === cleanUrl);
    if (existingIndex >= 0) {
      // Already exists: merge size or update url if needed
      if (!list[existingIndex].size && media.size) {
        list[existingIndex].size = media.size;
        list[existingIndex].sizeRaw = media.sizeRaw;
      }
      return;
    }

    // If master playlist exists, do not clutter with sub-playlists from the same folder
    const isMaster = media.url.includes("master") || media.url.includes("playlist.m3u8");
    if (!isMaster && media.format.includes("HLS")) {
      const hasMaster = list.some(i => (i.url.includes("master") || i.url.includes("playlist.m3u8")) && getBaseDir(i.url) === getBaseDir(media.url));
      if (hasMaster) return;
    }

    list.push(media);
    mediaStore.set(details.tabId, list);

    chrome.action.setBadgeText({ tabId: details.tabId, text: String(list.length) });
    chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#6366f1" });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener(tabId => {
  mediaStore.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    mediaStore.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || sender.tab?.id;

  if (message.type === "GET_MEDIA") {
    const list = mediaStore.get(tabId) || [];
    sendResponse({ media: list });
    return true;
  }

  if (message.type === "ADD_MEDIA_FROM_DOM") {
    if (tabId && message.media && !isFragmentOrInit(message.media.url)) {
      let list = mediaStore.get(tabId) || [];
      const cleanUrl = message.media.url.split("?")[0];
      const existing = list.find(item => item.url.split("?")[0] === cleanUrl);

      if (existing) {
        if (!existing.thumbnail && message.media.thumbnail) {
          existing.thumbnail = message.media.thumbnail;
        }
        if (message.media.pageTitle) {
          existing.pageTitle = message.media.pageTitle;
        }
      } else {
        list.push(message.media);
        mediaStore.set(tabId, list);
        chrome.action.setBadgeText({ tabId, text: String(list.length) });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#6366f1" });
      }
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "UPDATE_THUMBNAIL") {
    if (tabId && message.thumbnail) {
      let list = mediaStore.get(tabId) || [];
      const cleanTarget = (message.url || "").split("?")[0];
      let match = list.find(i => i.url.split("?")[0] === cleanTarget);
      if (!match && list.length > 0) {
        // Assign to the latest media item on this tab
        match = list[list.length - 1];
      }
      if (match) {
        match.thumbnail = message.thumbnail;
      }
      mediaStore.set(tabId, list);
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "CLEAR_MEDIA") {
    if (tabId) {
      mediaStore.delete(tabId);
      chrome.action.setBadgeText({ tabId, text: "" });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "DOWNLOAD_DIRECT") {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename || "video.mp4",
      saveAs: true
    }, downloadId => {
      sendResponse({ downloadId, error: chrome.runtime.lastError?.message });
    });
    return true;
  }

  if (message.type === "OPEN_HLS_DOWNLOADER") {
    const url = chrome.runtime.getURL("hls-downloader.html") +
      "?url=" + encodeURIComponent(message.url) +
      "&title=" + encodeURIComponent(message.title || "video") +
      (message.autostart ? "&autostart=1" : "");
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return true;
  }
});
