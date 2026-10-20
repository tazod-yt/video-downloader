// StreamGrab In-Browser HLS to MP4 Transmuxer

document.addEventListener("DOMContentLoaded", () => {
  const streamUrlInput = document.getElementById("streamUrl");
  const loadStreamBtn = document.getElementById("loadStreamBtn");
  const outputFilenameInput = document.getElementById("outputFilename");
  const qualitySelect = document.getElementById("qualitySelect");
  const concurrencySelect = document.getElementById("concurrencySelect");

  const progressCard = document.getElementById("progressCard");
  const statusHeading = document.getElementById("statusHeading");
  const statusSubtext = document.getElementById("statusSubtext");
  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const cancelBtn = document.getElementById("cancelBtn");

  const progressBar = document.getElementById("progressBar");
  const percentText = document.getElementById("percentText");
  const segmentCounter = document.getElementById("segmentCounter");
  const speedStat = document.getElementById("speedStat");
  const sizeStat = document.getElementById("sizeStat");
  const elapsedStat = document.getElementById("elapsedStat");
  const etaStat = document.getElementById("etaStat");
  const logOutput = document.getElementById("logOutput");
  const clearLogBtn = document.getElementById("clearLogBtn");

  const completedCard = document.getElementById("completedCard");
  const completionSummary = document.getElementById("completionSummary");
  const finalVideoPlayer = document.getElementById("finalVideoPlayer");
  const saveFileBtn = document.getElementById("saveFileBtn");
  const newConversionBtn = document.getElementById("newConversionBtn");

  let masterVariants = [];
  let currentSegments = [];
  let initMapUrl = null;
  let aesKeyInfo = null;

  let isRunning = false;
  let isPaused = false;
  let cancelRequested = false;

  let downloadedBytes = 0;
  let completedSegmentsCount = 0;
  let startTime = 0;
  let lastSpeedCheckTime = 0;
  let lastSpeedBytes = 0;
  let timerInterval = null;
  let finalMp4Blob = null;
  let finalBlobUrl = null;

  function log(msg, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === "error" ? "[ERROR] " : type === "warn" ? "[WARN] " : type === "success" ? "[SUCCESS] " : "[INFO] ";
    logOutput.textContent += `[${timestamp}] ${prefix}${msg}\n`;
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  // Parse URL query parameters
  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get("url");
  const initialTitle = params.get("title");

  if (initialUrl) {
    streamUrlInput.value = initialUrl;
  }
  if (initialTitle) {
    let clean = initialTitle.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().replace(/\s+/g, "_");
    if (!clean.endsWith(".mp4")) clean += ".mp4";
    outputFilenameInput.value = clean;
  } else {
    outputFilenameInput.value = `video_${Date.now()}.mp4`;
  }

  if (initialUrl) {
    loadPlaylist(initialUrl);
  }

  loadStreamBtn.addEventListener("click", () => {
    const url = streamUrlInput.value.trim();
    if (!url) return alert("Please enter a valid .m3u8 stream URL.");
    loadPlaylist(url);
  });

  clearLogBtn.addEventListener("click", () => {
    logOutput.textContent = "";
  });

  async function loadPlaylist(url) {
    try {
      log(`Fetching playlist: ${url}`);
      progressCard.classList.remove("hidden");
      completedCard.classList.add("hidden");
      statusHeading.textContent = "Analyzing Playlist";
      statusSubtext.textContent = "Reading HLS manifest...";

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
      const text = await res.text();

      if (!text.includes("#EXTM3U")) {
        throw new Error("Invalid playlist: Missing #EXTM3U header.");
      }

      // Check if Master Playlist
      if (text.includes("#EXT-X-STREAM-INF")) {
        log("Master playlist detected with multiple stream qualities.", "info");
        parseMasterPlaylist(text, url);
      } else {
        // Direct media playlist
        log("Direct media playlist detected.", "info");
        masterVariants = [];
        qualitySelect.innerHTML = `<option value="${url}">Default Quality</option>`;
        qualitySelect.disabled = true;
        await parseMediaPlaylist(text, url);
      }
    } catch (err) {
      log(`Failed to load playlist: ${err.message}`, "error");
      statusHeading.textContent = "Failed to load";
      statusSubtext.textContent = err.message;
    }
  }

  function parseMasterPlaylist(content, baseUrl) {
    masterVariants = [];
    qualitySelect.innerHTML = "";

    const lines = content.split("\n").map(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const nextLine = lines[i + 1];
        if (nextLine && !nextLine.startsWith("#")) {
          const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
          const bwMatch = line.match(/BANDWIDTH=(\d+)/);
          const resolution = resMatch ? resMatch[1] : null;
          const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
          const variantUrl = new URL(nextLine, baseUrl).href;

          const label = resolution
            ? `${resolution} (${(bandwidth / 1000000).toFixed(1)} Mbps)`
            : `Stream (${(bandwidth / 1000000).toFixed(1)} Mbps)`;

          masterVariants.push({ url: variantUrl, label, bandwidth });
          i++; // Skip URL line
        }
      }
    }

    if (masterVariants.length > 0) {
      // Sort highest quality first
      masterVariants.sort((a, b) => b.bandwidth - a.bandwidth);
      masterVariants.forEach((v, idx) => {
        const opt = document.createElement("option");
        opt.value = v.url;
        opt.textContent = `${idx === 0 ? "Best: " : ""}${v.label}`;
        qualitySelect.appendChild(opt);
      });
      qualitySelect.disabled = false;
      log(`Parsed ${masterVariants.length} stream qualities. Selected highest quality.`, "success");

      // Load the highest quality variant
      qualitySelect.onchange = () => {
        fetch(qualitySelect.value)
          .then(r => r.text())
          .then(t => parseMediaPlaylist(t, qualitySelect.value));
      };
      qualitySelect.dispatchEvent(new Event("change"));
    }
  }

  async function parseMediaPlaylist(content, baseUrl) {
    currentSegments = [];
    initMapUrl = null;
    aesKeyInfo = null;

    const lines = content.split("\n").map(l => l.trim());
    let currentKey = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle EXT-X-MAP (fMP4 init segment)
      if (line.startsWith("#EXT-X-MAP:")) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch) {
          initMapUrl = new URL(uriMatch[1], baseUrl).href;
          log(`Found fMP4 initialization segment: ${initMapUrl}`, "info");
        }
      }

      // Handle EXT-X-KEY (AES-128)
      if (line.startsWith("#EXT-X-KEY:")) {
        const methodMatch = line.match(/METHOD=([A-Z0-9-]+)/);
        const method = methodMatch ? methodMatch[1] : "NONE";

        if (method === "AES-128") {
          const uriMatch = line.match(/URI="([^"]+)"/);
          const ivMatch = line.match(/IV=(0x[0-9a-fA-F]+)/);
          if (uriMatch) {
            const keyUrl = new URL(uriMatch[1], baseUrl).href;
            currentKey = {
              url: keyUrl,
              ivHex: ivMatch ? ivMatch[1] : null,
              keyBuffer: null
            };
            log(`Encrypted stream detected (AES-128). Key URI: ${keyUrl}`, "warn");
          }
        } else if (method === "NONE") {
          currentKey = null;
        }
      }

      // Handle Segment EXTINF
      if (line.startsWith("#EXTINF:")) {
        const nextLine = lines[i + 1];
        if (nextLine && !nextLine.startsWith("#")) {
          const segmentUrl = new URL(nextLine, baseUrl).href;
          currentSegments.push({
            index: currentSegments.length,
            url: segmentUrl,
            keyInfo: currentKey ? { ...currentKey } : null
          });
          i++; // Skip segment line
        }
      }
    }

    log(`Total media segments detected: ${currentSegments.length}`, "success");
    statusHeading.textContent = "Ready to Transmux";
    statusSubtext.textContent = `${currentSegments.length} segments identified (${initMapUrl ? "fMP4 Stream" : "MPEG-TS Stream"}).`;
    segmentCounter.textContent = `0 / ${currentSegments.length} segments`;
    progressBar.style.width = "0%";
    percentText.textContent = "0%";

    if (params.get("autostart") === "1" && !isRunning && currentSegments.length > 0) {
      log("Auto-start mode enabled: Starting conversion immediately...", "info");
      startTransmuxing();
    }
  }

  // Web Crypto AES-128 Decrypt
  async function decryptChunk(encryptedData, keyBuffer, ivBuffer) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    return await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: ivBuffer },
      cryptoKey,
      encryptedData
    );
  }

  function makeIvFromSequence(seq) {
    const buf = new Uint8Array(16);
    const view = new DataView(buf.buffer);
    view.setUint32(12, seq, false);
    return buf;
  }

  function parseHexIv(hexStr) {
    const clean = hexStr.replace(/^0x/, "").padStart(32, "0");
    const arr = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      arr[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return arr;
  }

  // Pre-fetch any AES keys needed
  async function resolveAesKeys() {
    const keyCache = new Map();
    for (const seg of currentSegments) {
      if (seg.keyInfo && !seg.keyInfo.keyBuffer) {
        if (!keyCache.has(seg.keyInfo.url)) {
          log(`Fetching AES-128 decryption key: ${seg.keyInfo.url}...`);
          const res = await fetch(seg.keyInfo.url);
          if (!res.ok) throw new Error(`Could not fetch decryption key (${res.status})`);
          const buf = await res.arrayBuffer();
          keyCache.set(seg.keyInfo.url, buf);
        }
        seg.keyInfo.keyBuffer = keyCache.get(seg.keyInfo.url);
      }
    }
  }

  startBtn.addEventListener("click", () => {
    if (!isRunning) {
      startTransmuxing();
    }
  });

  pauseBtn.addEventListener("click", () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? "Resume" : "Pause";
    if (isPaused) {
      log("Download paused by user.");
      statusHeading.textContent = "Paused";
    } else {
      log("Resumed download.");
      statusHeading.textContent = "Downloading & Transmuxing...";
    }
  });

  cancelBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to cancel the current download?")) {
      cancelRequested = true;
      log("Download cancelled by user.", "warn");
    }
  });

  async function startTransmuxing() {
    if (currentSegments.length === 0) {
      alert("No stream segments available to download.");
      return;
    }

    isRunning = true;
    isPaused = false;
    cancelRequested = false;
    downloadedBytes = 0;
    completedSegmentsCount = 0;
    startTime = Date.now();
    lastSpeedCheckTime = startTime;
    lastSpeedBytes = 0;

    startBtn.classList.add("hidden");
    pauseBtn.classList.remove("hidden");
    cancelBtn.classList.remove("hidden");
    pauseBtn.textContent = "Pause";

    statusHeading.textContent = "Downloading & Transmuxing...";
    statusSubtext.textContent = "Fetching stream segments concurrently...";
    log(`Starting conversion with ${concurrencySelect.value} concurrent threads...`, "info");

    // Start timer for stats
    clearInterval(timerInterval);
    timerInterval = setInterval(updateMetrics, 1000);

    try {
      // 1. Fetch decryption keys if needed
      await resolveAesKeys();

      // 2. Fetch init segment if fMP4
      let initSegmentBytes = null;
      if (initMapUrl) {
        log(`Downloading fMP4 initialization header: ${initMapUrl}`);
        const res = await fetch(initMapUrl);
        initSegmentBytes = await res.arrayBuffer();
        downloadedBytes += initSegmentBytes.byteLength;
      }

      // 3. Setup Mux.js transmuxer for MPEG-TS streams
      const isMpegTs = !initMapUrl;
      let transmuxer = null;
      const mp4Chunks = [];

      if (isMpegTs) {
        log("Initializing client-side Mux.js MPEG-TS to MP4 converter engine.");
        transmuxer = new muxjs.mp4.Transmuxer({
          keepOriginalTimestamps: true
        });

        transmuxer.on("data", segment => {
          if (segment.initSegment) {
            mp4Chunks.push(segment.initSegment);
          }
          mp4Chunks.push(segment.data);
        });
      }

      // 4. Concurrently download chunks with queue
      const concurrency = parseInt(concurrencySelect.value, 10) || 6;
      const downloadedSegments = new Array(currentSegments.length);

      let nextIndexToFetch = 0;
      let activeWorkers = 0;
      let nextIndexToMux = 0;

      await new Promise((resolve, reject) => {
        function checkAndProceed() {
          if (cancelRequested) {
            return reject(new Error("Transmuxing cancelled by user."));
          }

          // In-order streaming to transmuxer as chunks arrive
          while (nextIndexToMux < currentSegments.length && downloadedSegments[nextIndexToMux]) {
            const chunkData = downloadedSegments[nextIndexToMux];
            downloadedSegments[nextIndexToMux] = null; // Free memory immediately

            if (isMpegTs && transmuxer) {
              transmuxer.push(new Uint8Array(chunkData));
            } else {
              mp4Chunks.push(chunkData);
            }
            nextIndexToMux++;
          }

          // Complete when all segments have been muxed
          if (nextIndexToMux >= currentSegments.length) {
            return resolve();
          }

          // Spawn downloads up to concurrency limit
          while (activeWorkers < concurrency && nextIndexToFetch < currentSegments.length && !isPaused && !cancelRequested) {
            const segIndex = nextIndexToFetch++;
            activeWorkers++;
            downloadSegment(currentSegments[segIndex])
              .then(data => {
                activeWorkers--;
                downloadedSegments[segIndex] = data;
                completedSegmentsCount++;
                updateProgressUI();
                checkAndProceed();
              })
              .catch(err => {
                activeWorkers--;
                log(`Error downloading segment #${segIndex + 1}: ${err.message}`, "error");
                // Retry once
                setTimeout(() => {
                  downloadSegment(currentSegments[segIndex])
                    .then(data => {
                      downloadedSegments[segIndex] = data;
                      completedSegmentsCount++;
                      updateProgressUI();
                      checkAndProceed();
                    })
                    .catch(e => reject(new Error(`Failed segment #${segIndex + 1}: ${e.message}`)));
                }, 1000);
              });
          }
        }

        // Check if paused regularly
        const pauseCheckInterval = setInterval(() => {
          if (!isPaused && activeWorkers < concurrency && nextIndexToFetch < currentSegments.length) {
            checkAndProceed();
          }
          if (cancelRequested || nextIndexToMux >= currentSegments.length) {
            clearInterval(pauseCheckInterval);
          }
        }, 300);

        checkAndProceed();
      });

      // Flush transmuxer
      if (isMpegTs && transmuxer) {
        log("Flushing transmuxer buffer...");
        transmuxer.flush();
      }

      // 5. Build final MP4 Blob
      log("Stitching MP4 buffer chunks into final file...", "info");
      let allBlobs = [];
      if (initSegmentBytes) {
        allBlobs.push(initSegmentBytes);
      }
      allBlobs = allBlobs.concat(mp4Chunks);

      finalMp4Blob = new Blob(allBlobs, { type: "video/mp4" });
      finalBlobUrl = URL.createObjectURL(finalMp4Blob);

      onSuccess();
    } catch (err) {
      log(`Transmuxing failed: ${err.message}`, "error");
      statusHeading.textContent = "Error Occurred";
      statusSubtext.textContent = err.message;
      resetControls();
    }
  }

  async function downloadSegment(seg) {
    const res = await fetch(seg.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data = await res.arrayBuffer();
    downloadedBytes += data.byteLength;

    // Check if segment is encrypted with AES-128
    if (seg.keyInfo && seg.keyInfo.keyBuffer) {
      let iv = seg.keyInfo.ivHex
        ? parseHexIv(seg.keyInfo.ivHex)
        : makeIvFromSequence(seg.index + 1);

      data = await decryptChunk(data, seg.keyInfo.keyBuffer, iv);
    }

    return data;
  }

  function updateProgressUI() {
    const total = currentSegments.length;
    const pct = total > 0 ? Math.round((completedSegmentsCount / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    percentText.textContent = `${pct}%`;
    segmentCounter.textContent = `${completedSegmentsCount} / ${total} segments`;
  }

  function updateMetrics() {
    if (!isRunning || isPaused) return;

    const now = Date.now();
    const elapsedSeconds = Math.max(1, (now - startTime) / 1000);
    elapsedStat.textContent = formatTime(elapsedSeconds);
    sizeStat.textContent = formatBytes(downloadedBytes);

    // Calculate speed based on interval
    const timeDelta = (now - lastSpeedCheckTime) / 1000;
    if (timeDelta >= 1) {
      const bytesDelta = downloadedBytes - lastSpeedBytes;
      const speedBps = bytesDelta / timeDelta;
      speedStat.textContent = `${(speedBps / (1024 * 1024)).toFixed(2)} MB/s`;

      // Estimate remaining time
      const remainingSegments = currentSegments.length - completedSegmentsCount;
      const segsPerSec = completedSegmentsCount / elapsedSeconds;
      if (segsPerSec > 0) {
        const remainingSeconds = remainingSegments / segsPerSec;
        etaStat.textContent = formatTime(remainingSeconds);
      }

      lastSpeedCheckTime = now;
      lastSpeedBytes = downloadedBytes;
    }
  }

  function onSuccess() {
    clearInterval(timerInterval);
    isRunning = false;
    resetControls();

    log(`Transmuxing complete! Generated ${formatBytes(finalMp4Blob.size)} MP4 video.`, "success");
    statusHeading.textContent = "Completed!";
    statusSubtext.textContent = `Successfully built ${formatBytes(finalMp4Blob.size)} MP4 file.`;

    progressCard.classList.add("hidden");
    completedCard.classList.remove("hidden");

    completionSummary.textContent = `Packaged ${completedSegmentsCount} segments into a single ${formatBytes(finalMp4Blob.size)} MP4 video.`;
    finalVideoPlayer.src = finalBlobUrl;
    finalVideoPlayer.play().catch(() => {});

    if (params.get("autostart") === "1") {
      log("Auto-start mode: Triggering MP4 download...", "success");
      setTimeout(() => {
        saveFileBtn.click();
      }, 500);
    }
  }

  function resetControls() {
    clearInterval(timerInterval);
    isRunning = false;
    isPaused = false;
    startBtn.classList.remove("hidden");
    pauseBtn.classList.add("hidden");
    cancelBtn.classList.add("hidden");
  }

  // Trigger MP4 Download to disk
  saveFileBtn.addEventListener("click", () => {
    if (!finalBlobUrl) return;

    let filename = outputFilenameInput.value.trim() || `streamgrab_${Date.now()}.mp4`;
    if (!filename.endsWith(".mp4")) filename += ".mp4";

    const a = document.createElement("a");
    a.href = finalBlobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    log(`Triggered download: ${filename}`, "success");
  });

  newConversionBtn.addEventListener("click", () => {
    if (finalBlobUrl) {
      URL.revokeObjectURL(finalBlobUrl);
      finalBlobUrl = null;
    }
    completedCard.classList.add("hidden");
    progressCard.classList.add("hidden");
    streamUrlInput.value = "";
    currentSegments = [];
    statusHeading.textContent = "Ready";
    statusSubtext.textContent = "Waiting for next stream...";
  });
});
