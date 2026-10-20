// StreamGrab Popup Script

document.addEventListener("DOMContentLoaded", async () => {
  const tabHostEl = document.getElementById("tabHost");
  const mediaCountEl = document.getElementById("mediaCount");
  const mediaListEl = document.getElementById("mediaList");
  const emptyStateEl = document.getElementById("emptyState");
  const loadingStateEl = document.getElementById("loadingState");
  const refreshBtn = document.getElementById("refreshBtn");
  const clearBtn = document.getElementById("clearBtn");

  let currentTab = null;
  let activeCardPlayer = null;

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return null;
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function getBadgeClass(format) {
    if (format.includes("HLS")) return "badge-hls";
    if (format.includes("MP4")) return "badge-mp4";
    if (format.includes("WEBM")) return "badge-webm";
    return "badge-mp4";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function closeCurrentInlinePlayer() {
    if (!activeCardPlayer) return;

    const { videoEl, hlsInstance, containerEl, playBtnEl, cardEl } = activeCardPlayer;

    try {
      videoEl.pause();
      if (hlsInstance) {
        hlsInstance.destroy();
      }
      videoEl.removeAttribute("src");
      videoEl.load();
    } catch {}

    containerEl.classList.add("hidden");
    cardEl.classList.remove("has-player-open");
    playBtnEl.classList.remove("active");
    playBtnEl.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      Play
    `;

    activeCardPlayer = null;
  }

  // Parse HLS master playlist to discover all resolutions & estimated sizes
  async function parseHlsVariants(masterUrl) {
    try {
      const res = await fetch(masterUrl);
      if (!res.ok) return null;
      const text = await res.text();

      if (!text.includes("#EXT-X-STREAM-INF")) {
        // Direct media playlist: calculate duration
        let duration = 0;
        const extinfRegex = /#EXTINF:([\d.]+)/g;
        let m;
        while ((m = extinfRegex.exec(text)) !== null) {
          duration += parseFloat(m[1]);
        }
        const estBytes = duration > 0 ? Math.round((2200000 / 8) * duration) : null;
        return [{
          url: masterUrl,
          resolution: "Original",
          bandwidth: 2200000,
          duration,
          sizeText: estBytes ? `~${formatBytes(estBytes)}` : "Streaming"
        }];
      }

      // Master playlist with multiple qualities
      const variants = [];
      const lines = text.split("\n").map(l => l.trim());
      let firstSubUrl = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          const nextLine = lines[i + 1];
          if (nextLine && !nextLine.startsWith("#")) {
            const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
            const bwMatch = line.match(/BANDWIDTH=(\d+)/);
            const resolution = resMatch ? resMatch[1] : null;
            const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
            const variantUrl = new URL(nextLine, masterUrl).href;

            if (!firstSubUrl) firstSubUrl = variantUrl;

            let shortRes = "Original";
            if (resolution) {
              const h = resolution.split("x")[1];
              shortRes = h ? `${h}p` : resolution;
            }

            variants.push({
              url: variantUrl,
              resolution: shortRes,
              fullResolution: resolution || shortRes,
              bandwidth,
              duration: 0,
              sizeText: ""
            });
            i++;
          }
        }
      }

      // Fetch first sub-playlist to compute actual duration
      let streamDuration = 0;
      if (firstSubUrl) {
        try {
          const subRes = await fetch(firstSubUrl);
          const subText = await subRes.text();
          const extinfRegex = /#EXTINF:([\d.]+)/g;
          let m;
          while ((m = extinfRegex.exec(subText)) !== null) {
            streamDuration += parseFloat(m[1]);
          }
        } catch {}
      }

      if (!streamDuration) streamDuration = 180; // default 3 min fallback

      variants.forEach(v => {
        v.duration = streamDuration;
        if (v.bandwidth > 0) {
          const bytes = (v.bandwidth / 8) * streamDuration;
          v.sizeText = `~${formatBytes(bytes)}`;
        } else {
          v.sizeText = "Adaptive";
        }
      });

      // Sort highest quality first (e.g. 1080p, 720p, 360p)
      variants.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
      return variants.length > 0 ? variants : null;
    } catch {
      return null;
    }
  }

  function renderMediaList(mediaList) {
    closeCurrentInlinePlayer();
    mediaListEl.innerHTML = "";

    // 1. Strict filter: discard init fragments and non-video stubs
    let filtered = (mediaList || []).filter(item => {
      const lower = (item.url || "").toLowerCase();
      if (
        lower.includes("init.mp4") ||
        lower.includes("_init.") ||
        lower.includes(".m4s") ||
        lower.includes("ext-x-map") ||
        lower.includes("/chunk") ||
        lower.includes("/frag")
      ) {
        return false;
      }
      if (item.format === "MP4" && item.sizeRaw && item.sizeRaw < 150 * 1024) {
        return false;
      }
      return true;
    });

    // 2. Deduplicate by clean URL without query tokens
    const seen = new Set();
    filtered = filtered.filter(item => {
      const clean = item.url.split("?")[0];
      if (seen.has(clean)) return false;
      seen.add(clean);
      return true;
    });

    if (filtered.length === 0) {
      emptyStateEl.classList.remove("hidden");
      mediaCountEl.textContent = "0 videos";
      return;
    }

    emptyStateEl.classList.add("hidden");
    mediaCountEl.textContent = `${filtered.length} video${filtered.length > 1 ? "s" : ""}`;

    filtered.forEach(item => {
      const card = document.createElement("div");
      card.className = "media-card";

      const isHls = item.format && item.format.includes("HLS");
      const badgeClass = getBadgeClass(item.format);

      let displayTitle = item.filename;
      if (!displayTitle || displayTitle.startsWith("playlist") || displayTitle.startsWith("video_")) {
        displayTitle = currentTab?.title?.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim() || "Full Video Stream";
      }

      const initialSize = item.size ? item.size : (isHls ? "Adaptive Stream" : "Video Stream");

      card.innerHTML = `
        <div class="card-top">
          <!-- Thumbnail Box -->
          <div class="thumb-container">
            ${item.thumbnail ? `
              <img src="${escapeHtml(item.thumbnail)}" class="thumb-img" alt="Thumbnail">
            ` : `
              <div class="thumb-fallback">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </div>
            `}
          </div>

          <div class="title-wrap">
            <div class="media-title" title="${escapeHtml(displayTitle)}">
              ${escapeHtml(displayTitle)}
            </div>
            <div class="meta-tags">
              <span class="badge-format ${badgeClass}">${escapeHtml(item.format)}</span>
              <span class="badge-res res-badge hidden">--</span>
              <span class="media-size size-label">${escapeHtml(initialSize)}</span>
            </div>
          </div>
        </div>

        <!-- Quality & Size Dropdown Row -->
        <div class="quality-row hidden">
          <span class="quality-label">Choose Quality & Size:</span>
          <select class="quality-dropdown"></select>
        </div>

        <div class="card-actions">
          <button class="btn-play" title="Play preview right under this tile">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            Play
          </button>

          <button class="btn-primary dl-btn" title="Download video to computer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span class="dl-text">Download Video</span>
          </button>

          <button class="btn-secondary copy-btn" title="Copy Video Link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>

        <!-- Inline Video Player Under Tile -->
        <div class="card-inline-player hidden">
          <div class="player-top-bar">
            <span class="player-title-text">
              <span class="live-dot"></span>
              Video Preview
            </span>
            <button class="close-inline-btn" title="Close video">&times;</button>
          </div>
          <div class="video-wrapper">
            <video class="inline-video" controls playsinline></video>
          </div>
        </div>
      `;

      const playBtn = card.querySelector(".btn-play");
      const dlBtn = card.querySelector(".dl-btn");
      const dlText = card.querySelector(".dl-text");
      const copyBtn = card.querySelector(".copy-btn");
      const inlineContainer = card.querySelector(".card-inline-player");
      const videoEl = card.querySelector(".inline-video");
      const closeInlineBtn = card.querySelector(".close-inline-btn");
      const thumbBox = card.querySelector(".thumb-container");
      const qualityRow = card.querySelector(".quality-row");
      const qualityDropdown = card.querySelector(".quality-dropdown");
      const resBadge = card.querySelector(".res-badge");
      const sizeLabel = card.querySelector(".size-label");

      let selectedDownloadUrl = item.url;
      let selectedResolution = "Full HD";

      // If no thumbnail yet, automatically generate one from the stream
      if (!item.thumbnail) {
        autoGenerateThumbnail(item.url, thumbBox);
      }

      // If HLS: asynchronously fetch and parse variants to populate quality & size choices
      if (isHls) {
        parseHlsVariants(item.url).then(variants => {
          if (variants && variants.length > 0) {
            qualityDropdown.innerHTML = "";
            variants.forEach(v => {
              const opt = document.createElement("option");
              opt.value = v.url;
              opt.textContent = `${v.resolution} (${v.sizeText})`;
              opt.dataset.res = v.resolution;
              opt.dataset.size = v.sizeText;
              qualityDropdown.appendChild(opt);
            });

            qualityRow.classList.remove("hidden");

            // Select highest quality by default
            const topVar = variants[0];
            selectedDownloadUrl = topVar.url;
            selectedResolution = topVar.resolution;
            resBadge.textContent = topVar.resolution;
            resBadge.classList.remove("hidden");
            sizeLabel.textContent = topVar.sizeText;
            dlText.textContent = `Download ${topVar.resolution} (MP4)`;

            // When user changes quality dropdown
            qualityDropdown.addEventListener("change", () => {
              const opt = qualityDropdown.options[qualityDropdown.selectedIndex];
              selectedDownloadUrl = opt.value;
              selectedResolution = opt.dataset.res;
              resBadge.textContent = opt.dataset.res;
              sizeLabel.textContent = opt.dataset.size;
              dlText.textContent = `Download ${opt.dataset.res} (MP4)`;

              // If inline video is currently open, switch to the chosen quality
              if (activeCardPlayer && activeCardPlayer.cardEl === card) {
                switchInlineQuality(selectedDownloadUrl);
              }
            });
          }
        });
      } else {
        // Direct file: show size
        if (item.size) {
          sizeLabel.textContent = item.size;
          dlText.textContent = `Download MP4 (${item.size})`;
        }
      }

      function switchInlineQuality(url) {
        try {
          if (activeCardPlayer?.hlsInstance) {
            activeCardPlayer.hlsInstance.loadSource(url);
          } else {
            videoEl.src = url;
            videoEl.play().catch(() => {});
          }
        } catch {}
      }

      // Play / Toggle Inline Video
      playBtn.addEventListener("click", () => {
        if (activeCardPlayer && activeCardPlayer.cardEl === card) {
          closeCurrentInlinePlayer();
          return;
        }

        closeCurrentInlinePlayer();

        inlineContainer.classList.remove("hidden");
        card.classList.add("has-player-open");
        playBtn.classList.add("active");
        playBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
          Playing
        `;

        let hlsInst = null;
        const targetUrl = selectedDownloadUrl || item.url;

        if (isHls && window.Hls && Hls.isSupported()) {
          hlsInst = new Hls({ enableWorker: true });
          hlsInst.loadSource(targetUrl);
          hlsInst.attachMedia(videoEl);
          hlsInst.on(Hls.Events.MANIFEST_PARSED, () => {
            videoEl.play().catch(() => {});
          });
        } else {
          videoEl.src = targetUrl;
          videoEl.play().catch(() => {});
        }

        // Capture frame snapshot if thumbnail is missing
        videoEl.addEventListener("loadeddata", () => {
          captureInlineThumbnail(videoEl, thumbBox, item.url);
        }, { once: true });

        activeCardPlayer = {
          cardEl: card,
          containerEl: inlineContainer,
          videoEl,
          playBtnEl: playBtn,
          hlsInstance: hlsInst
        };
      });

      // Close Inline Video Button
      closeInlineBtn.addEventListener("click", () => {
        closeCurrentInlinePlayer();
      });

      // Download Action
      dlBtn.addEventListener("click", () => {
        const urlToDownload = selectedDownloadUrl || item.url;
        const filename = `${displayTitle}_${selectedResolution}.mp4`;

        if (isHls) {
          chrome.runtime.sendMessage({
            type: "OPEN_HLS_DOWNLOADER",
            url: urlToDownload,
            title: filename,
            autostart: true
          });
          window.close();
        } else {
          chrome.runtime.sendMessage({
            type: "DOWNLOAD_DIRECT",
            url: urlToDownload,
            filename
          });
        }
      });

      // Copy Link
      copyBtn.addEventListener("click", async (e) => {
        const urlToCopy = selectedDownloadUrl || item.url;
        await navigator.clipboard.writeText(urlToCopy);
        const origHtml = e.currentTarget.innerHTML;
        e.currentTarget.innerHTML = `<span style="color:#10b981;font-size:11px;">Copied!</span>`;
        setTimeout(() => {
          e.currentTarget.innerHTML = origHtml;
        }, 1500);
      });

      mediaListEl.appendChild(card);
    });
  }

  const thumbPending = new Set();
  function autoGenerateThumbnail(url, thumbBox) {
    if (!url || thumbPending.has(url)) return;
    thumbPending.add(url);

    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    let hls = null;

    const cleanup = () => {
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
        if (hls) hls.destroy();
      } catch {}
    };

    const timer = setTimeout(() => {
      cleanup();
      thumbPending.delete(url);
    }, 4500);

    const grab = () => {
      try {
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 90;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(v, 0, 0, 160, 90);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          if (dataUrl && dataUrl.length > 200) {
            thumbBox.innerHTML = `<img src="${dataUrl}" class="thumb-img" alt="Thumbnail">`;
            chrome.runtime.sendMessage({
              type: "UPDATE_THUMBNAIL",
              url,
              thumbnail: dataUrl
            }).catch(() => {});
            clearTimeout(timer);
            cleanup();
            thumbPending.delete(url);
            return;
          }
        }
      } catch {}
    };

    v.addEventListener("loadeddata", () => {
      try {
        v.currentTime = 0.5;
      } catch {
        grab();
      }
    }, { once: true });

    v.addEventListener("seeked", () => {
      grab();
    }, { once: true });

    const isHls = url.includes(".m3u8") || url.includes("m3u8");
    if (isHls && window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false });
      hls.loadSource(url);
      hls.attachMedia(v);
    } else {
      v.src = url;
    }
  }

  function captureInlineThumbnail(video, thumbBox, mediaUrl) {
    try {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, 160, 90);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        if (dataUrl && dataUrl.length > 100) {
          thumbBox.innerHTML = `<img src="${dataUrl}" class="thumb-img" alt="Thumbnail">`;
          chrome.runtime.sendMessage({
            type: "UPDATE_THUMBNAIL",
            url: mediaUrl,
            thumbnail: dataUrl
          }).catch(() => {});
        }
      }
    } catch {}
  }

  async function loadMedia() {
    loadingStateEl.classList.remove("hidden");
    emptyStateEl.classList.add("hidden");
    mediaListEl.innerHTML = "";

    currentTab = await getActiveTab();
    if (!currentTab) {
      loadingStateEl.classList.add("hidden");
      emptyStateEl.classList.remove("hidden");
      tabHostEl.textContent = "Unknown Tab";
      return;
    }

    try {
      const u = new URL(currentTab.url);
      tabHostEl.textContent = u.hostname || currentTab.title;
    } catch {
      tabHostEl.textContent = currentTab.title || "Current Tab";
    }

    chrome.runtime.sendMessage({
      type: "GET_MEDIA",
      tabId: currentTab.id
    }, response => {
      loadingStateEl.classList.add("hidden");
      const list = response?.media || [];
      renderMediaList(list);
    });
  }

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.classList.add("spinning");
    try {
      if (currentTab?.id) {
        // Rescan webpage DOM for new videos without reloading the tab!
        try {
          await chrome.tabs.sendMessage(currentTab.id, { type: "SCAN_NOW" });
        } catch {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: currentTab.id },
              files: ["content.js"]
            });
          } catch {}
        }
      }
    } finally {
      setTimeout(async () => {
        await loadMedia();
        refreshBtn.classList.remove("spinning");
      }, 400);
    }
  });

  clearBtn.addEventListener("click", () => {
    if (currentTab?.id) {
      chrome.runtime.sendMessage({
        type: "CLEAR_MEDIA",
        tabId: currentTab.id
      }, () => {
        loadMedia();
      });
    }
  });

  loadMedia();
});
