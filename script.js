  (function () {
    /* ── THEME SYSTEM ── */
    const THEME_KEY = 'moodtune-theme';

    function getSystemTheme() {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(THEME_KEY, theme);
      const label = document.getElementById('themeToggleMobileLabel');
      if (label) label.textContent = theme === 'light' ? 'Dark' : 'Light';
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    // On load: use saved pref, else system pref
    (function initTheme() {
      const saved = localStorage.getItem(THEME_KEY);
      applyTheme(saved || getSystemTheme());
    })();

    // Listen for system theme changes (respects when no manual override stored)
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      // Only auto-switch if the user hasn't manually set a theme
      if (!localStorage.getItem(THEME_KEY)) {
        applyTheme(e.matches ? 'light' : 'dark');
      }
    });

    // Wire up all toggle buttons
    ['themeToggleDesktop'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', toggleTheme);
    });

    /* ── AUDIO ENGINE ── */
    const audioEl = new Audio();
    audioEl.volume = 0.7;

    let current = null;
    let isPlaying = false;
    let localTracks = [];
    let currentActiveQueue = [];
    let simulatedTicker = null;
    let curTimeSimulated = 0;
    let isDraggingSeek = false;

    let viewHistoryStack = ['home'];
    let viewHistoryPointer = 0;

    /* ── APP LOADER ── */
    let loaderHidden = false;
    function hideAppLoader() {
      if (loaderHidden) return;
      loaderHidden = true;
      const loader = document.getElementById('appLoader');
      if (loader) loader.classList.add('is-hidden');
    }
    // Safety net: never let the loader get stuck if something above throws.
    setTimeout(hideAppLoader, 2500);

    const DB_NAME = "CrateFolderDB";
    const STORE_NAME = "handles";
    const KEY_NAME = "rootFolderHandle";
    const TRACKS_STORE_NAME = "cachedTracks";

    function initInterface() {
      document.getElementById('volFill').style.width = (audioEl.volume * 100) + '%';
      updateHistoryButtonStates();
      setupDragAndDrop();
      setupSeekControlGestures();

      if (!history.state || history.state.view !== 'home') {
        history.replaceState({ view: 'home' }, "");
      }
      history.pushState({ view: 'home_anchor' }, "");

      autoFetchCachedTracks();
    }

    function getDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
          if (!db.objectStoreNames.contains(TRACKS_STORE_NAME)) db.createObjectStore(TRACKS_STORE_NAME, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function cacheTracksToDatabase(tracksToCache) {
      try {
        const db = await getDB();
        const tx = db.transaction(TRACKS_STORE_NAME, "readwrite");
        const store = tx.objectStore(TRACKS_STORE_NAME);
        store.clear();
        for (const t of tracksToCache) {
          store.put({ id: t.id, title: t.title, artist: t.artist, album: t.album, dur: t.dur, folder: t.folder, fileBlob: t.fileBlob });
        }
      } catch (e) { console.warn("Cache error", e); }
    }

    async function autoFetchCachedTracks() {
      try {
        const db = await getDB();
        const tx = db.transaction(TRACKS_STORE_NAME, "readonly");
        const store = tx.objectStore(TRACKS_STORE_NAME);
        const cachedData = await new Promise((res) => {
          const req = store.getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => res([]);
        });
        if (cachedData && cachedData.length > 0) {
          const reconstructed = cachedData.map(item => ({
            ...item,
            fileUrl: URL.createObjectURL(item.fileBlob)
          }));
          renderLocalInterfaceLayout(reconstructed);
          hideAppLoader();
        } else {
          document.getElementById('appLoaderStatus').textContent = 'almost there…';
          document.getElementById('firstVisitPopupModal').classList.add('show');
          await verifyAndRestoreCachedFolder();
          hideAppLoader();
        }
      } catch (e) {
        hideAppLoader();
      }
    }

    window.closeWelcomeSyncModal = function () {
      document.getElementById('firstVisitPopupModal').classList.remove('show');
    };

    async function storeFolderHandle(handle) {
      try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(handle, KEY_NAME);
      } catch (e) { }
    }

    async function verifyAndRestoreCachedFolder() {
      if (!window.showDirectoryPicker || !window.isSecureContext) return;
      try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const handle = await new Promise((res) => {
          const req = tx.objectStore(STORE_NAME).get(KEY_NAME);
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(null);
        });
        if (handle) {
          const opts = { mode: 'read' };
          if ((await handle.queryPermission(opts)) === 'granted' || (await handle.requestPermission(opts)) === 'granted') {
            window.closeWelcomeSyncModal();
            scanDirectoryEntryTree(handle);
          }
        }
      } catch (e) { }
    }

    const fmt = s => {
      if (isNaN(s) || s === Infinity || s < 0) return "0:00";
      return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    };

    function playTrack(t) {
      current = t;
      document.getElementById('npTitle').textContent = t.title;
      document.getElementById('npArtist').textContent = t.artist;
      document.getElementById('durTime').textContent = fmt(t.dur);

      document.querySelectorAll('.track-row').forEach(row => {
        const titleEl = row.querySelector('.t-title');
        if (titleEl) row.classList.toggle('is-playing', titleEl.textContent === t.title);
      });

      clearInterval(simulatedTicker);
      curTimeSimulated = 0;
      document.getElementById('curTime').textContent = "0:00";
      document.getElementById('seekFill').style.width = "0%";

      if (t.fileUrl) {
        audioEl.src = t.fileUrl;
        audioEl.onloadedmetadata = function () {
          t.dur = audioEl.duration;
          document.getElementById('durTime').textContent = fmt(audioEl.duration);
          const match = localTracks.find(x => x.id === t.id);
          if (match) match.dur = audioEl.duration;
          document.querySelectorAll('.track-row').forEach(row => {
            if (row.querySelector('.t-title')?.textContent === t.title) {
              const durCell = row.querySelector('.t-dur');
              if (durCell) durCell.textContent = fmt(audioEl.duration);
            }
          });
        };
        audioEl.play().then(() => setPlayingState(true)).catch(() => { setPlayingState(true); startSimulatedClock(t.dur); });
      } else {
        audioEl.src = '';
        setPlayingState(true);
        startSimulatedClock(t.dur);
      }
    }

    function startSimulatedClock(duration) {
      clearInterval(simulatedTicker);
      simulatedTicker = setInterval(() => {
        if (!isPlaying || isDraggingSeek) return;
        curTimeSimulated++;
        if (curTimeSimulated >= duration) { clearInterval(simulatedTicker); nextTrack(); }
        else {
          document.getElementById('curTime').textContent = fmt(curTimeSimulated);
          document.getElementById('seekFill').style.width = (curTimeSimulated / duration * 100) + '%';
        }
      }, 1000);
    }

    function setPlayingState(playing) {
      isPlaying = playing;
      const icon = document.getElementById('playIcon');
      if (isPlaying) {
        icon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
        if (current && current.fileUrl && audioEl.src) audioEl.play().catch(() => { });
        else if (current) startSimulatedClock(current.dur);
      } else {
        icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
        audioEl.pause();
        clearInterval(simulatedTicker);
      }
    }

    audioEl.addEventListener('timeupdate', () => {
      if (current && current.fileUrl && isPlaying && !isDraggingSeek) {
        const dur = audioEl.duration || current.dur;
        document.getElementById('curTime').textContent = fmt(audioEl.currentTime);
        document.getElementById('seekFill').style.width = (audioEl.currentTime / dur * 100) + '%';
      }
    });
    audioEl.addEventListener('ended', () => nextTrack());

    function nextTrack() {
      const pool = currentActiveQueue.length > 0 ? currentActiveQueue : localTracks;
      if (!pool.length) return;
      let idx = pool.findIndex(x => x.title === current?.title);
      if (idx === -1) idx = 0;
      playTrack(pool[(idx + 1) % pool.length]);
    }

    function prevTrack() {
      const pool = currentActiveQueue.length > 0 ? currentActiveQueue : localTracks;
      if (!pool.length) return;
      let idx = pool.findIndex(x => x.title === current?.title);
      if (idx === -1) idx = 0;
      playTrack(pool[(idx - 1 + pool.length) % pool.length]);
    }

    document.getElementById('playBtn').addEventListener('click', () => {
      if (!current) {
        currentActiveQueue = localTracks.length > 0 ? localTracks : [];
        if (currentActiveQueue.length > 0) playTrack(currentActiveQueue[0]);
        return;
      }
      setPlayingState(!isPlaying);
    });
    document.getElementById('nextBtn').addEventListener('click', nextTrack);
    document.getElementById('prevBtn').addEventListener('click', prevTrack);

    window.addEventListener('keydown', (e) => {
      if (document.activeElement.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); setPlayingState(!isPlaying); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); nextTrack(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); prevTrack(); }
    });

    const seekTrack = document.getElementById('seekTrack');

    window.addEventListener('popstate', () => {
      if (viewHistoryStack.length > 1 && viewHistoryPointer > 0) {
        viewHistoryPointer--;
        switchView(viewHistoryStack[viewHistoryPointer], true);
        history.pushState({ view: 'home_anchor' }, "");
      } else {
        history.pushState({ view: 'home_anchor' }, "");
        document.getElementById('applicationExitConfirmationModal').classList.add('show');
      }
    });

    window.dismissExitConfirmationModal = function () {
      document.getElementById('applicationExitConfirmationModal').classList.remove('show');
    };
    window.confirmSystemExitAction = function () {
      document.getElementById('applicationExitConfirmationModal').classList.remove('show');
      audioEl.pause(); window.close();
    };

    function updateSeekRealtime(clientX, el) {
      if (!current) return 0;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const dur = (current.fileUrl && audioEl.duration) ? audioEl.duration : current.dur;
      const t = pct * dur;
      document.getElementById('seekFill').style.width = (pct * 100) + '%';
      document.getElementById('curTime').textContent = fmt(t);
      return t;
    }

    function setupSeekControlGestures() {
      seekTrack.addEventListener('mousedown', (e) => {
        if (!current) return;
        isDraggingSeek = true;
        updateSeekRealtime(e.clientX, seekTrack);
        const move = (ev) => updateSeekRealtime(ev.clientX, seekTrack);
        const up = (ev) => {
          isDraggingSeek = false;
          const t = updateSeekRealtime(ev.clientX, seekTrack);
          if (current.fileUrl && audioEl.src) audioEl.currentTime = t;
          else { curTimeSimulated = Math.floor(t); if (isPlaying) startSimulatedClock(current.dur); }
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      seekTrack.addEventListener('touchstart', (e) => { if (!current) return; isDraggingSeek = true; updateSeekRealtime(e.touches[0].clientX, seekTrack); }, { passive: true });
      seekTrack.addEventListener('touchmove', (e) => { updateSeekRealtime(e.touches[0].clientX, seekTrack); }, { passive: true });
      seekTrack.addEventListener('touchend', (e) => {
        isDraggingSeek = false;
        const t = updateSeekRealtime(e.changedTouches[0].clientX, seekTrack);
        if (current?.fileUrl && audioEl.src) audioEl.currentTime = t;
        else if (current) { curTimeSimulated = Math.floor(t); }
      });
      seekTrack.addEventListener('click', (e) => {
        if (!current) return;
        const t = updateSeekRealtime(e.clientX, seekTrack);
        if (current.fileUrl && audioEl.src) audioEl.currentTime = t;
        else curTimeSimulated = Math.floor(t);
      });
    }

    function setupDragAndDrop() {
      window.addEventListener('dragenter', (e) => { e.preventDefault(); document.body.classList.add('drag-active'); });
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('dragleave', (e) => {
        if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)
          document.body.classList.remove('drag-active');
      });
      window.addEventListener('drop', (e) => {
        e.preventDefault();
        document.body.classList.remove('drag-active');
        if (e.dataTransfer.files.length > 0) handleLocalFiles(e.dataTransfer.files);
      });
    }

    window.triggerUnifiedPickerSequence = function () {
      if (!window.showDirectoryPicker || !window.isSecureContext) {
        document.getElementById('localFolderScanner').click();
        return;
      }
      triggerModernFolderPicker();
    };

    async function triggerModernFolderPicker() {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        await storeFolderHandle(handle);
        window.closeWelcomeSyncModal();
        scanDirectoryEntryTree(handle);
      } catch (e) { }
    }
    window.triggerModernFolderPicker = triggerModernFolderPicker;

    const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];

    async function scanDirectoryEntryTree(dirHandle) {
      const entries = [];
      async function read(dir, path = []) {
        for await (const entry of dir.values()) {
          if (entry.kind === 'directory') await read(entry, [...path, entry.name]);
          else {
            const ext = entry.name.split('.').pop().toLowerCase();
            if (AUDIO_EXTS.includes(ext)) entries.push({ entry, path: [...path, entry.name].join('/') });
          }
        }
      }
      await read(dirHandle, [dirHandle.name]);
      const files = [];
      for (const item of entries) {
        const file = await item.entry.getFile();
        Object.defineProperty(file, 'webkitRelativePath', { value: item.path, writable: true, configurable: true });
        files.push(file);
      }
      handleLocalFiles(files);
    }

    function handleLocalFiles(filesList) {
      const valid = Array.from(filesList).filter(f => AUDIO_EXTS.includes(f.name.split('.').pop().toLowerCase()));
      if (!valid.length) { alert("No valid audio files found."); return; }

      const tracks = valid.map((file, i) => {
        const path = file.webkitRelativePath || file.name;
        const parts = path.split('/');
        const folder = parts.length > 1 ? parts[parts.length - 2] : "Root Folder";
        return {
          id: 9000 + i,
          title: file.name.replace(/\.[^.]+$/, ''),
          artist: "Local Track",
          album: folder,
          dur: 0,
          fileBlob: file,
          fileUrl: URL.createObjectURL(file),
          folder
        };
      });

      cacheTracksToDatabase(tracks);
      renderLocalInterfaceLayout(tracks);
    }

    function updateDurationCell(trackId, dur) {
      document.querySelectorAll('.track-row[data-id="' + trackId + '"] .t-dur').forEach(cell => {
        cell.textContent = fmt(dur);
      });
      if (current && current.id === trackId && !(current.fileUrl && audioEl.src)) {
        document.getElementById('durTime').textContent = fmt(dur);
      }
    }

    function probeAudioDuration(track) {
      return new Promise((resolve) => {
        if (!track.fileUrl) { resolve(track.dur || 0); return; }
        const probe = new Audio();
        probe.preload = 'metadata';
        probe.muted = true;
        let resolved = false;
        let fallbackTimer = null;

        const finish = (d) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(fallbackTimer);
          probe.removeAttribute('src');
          probe.load();
          resolve(isFinite(d) && d > 0 ? d : 0);
        };

        probe.addEventListener('loadedmetadata', () => {
          const initialReading = probe.duration;
          // A quick metadata-only read can return an inaccurate (or Infinity)
          // duration for some local audio files, e.g. VBR MP3s with no
          // duration header. Seeking forces the browser to actually resolve
          // the real length, reported via 'durationchange'.
          probe.addEventListener('durationchange', () => {
            if (isFinite(probe.duration) && probe.duration > 0) finish(probe.duration);
          }, { once: true });
          probe.currentTime = 1e101;
          // If no correction shows up quickly, the initial reading was fine.
          fallbackTimer = setTimeout(() => finish(initialReading), 700);
        }, { once: true });

        probe.addEventListener('error', () => finish(0), { once: true });
        probe.src = track.fileUrl;
      });
    }

    let durationProbeRunId = 0;
    async function loadDurationsProgressively(tracks) {
      const runId = ++durationProbeRunId;
      const CONCURRENCY = 6;
      let cursor = 0;
      let anyUpdated = false;

      async function worker() {
        while (cursor < tracks.length) {
          if (runId !== durationProbeRunId) return; // a newer scan superseded this one
          const t = tracks[cursor++];
          const dur = await probeAudioDuration(t);
          if (runId !== durationProbeRunId) return;
          if (dur > 0 && dur !== t.dur) {
            t.dur = dur;
            updateDurationCell(t.id, dur);
            anyUpdated = true;
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (runId === durationProbeRunId && anyUpdated) cacheTracksToDatabase(tracks);
    }

    function renderLocalInterfaceLayout(tracksArray) {
      localTracks = tracksArray;

      if (localTracks.length > 0) {
        document.getElementById('homeEmptyState').style.display = 'none';
        document.getElementById('homeLoadedState').style.display = 'block';
        buildHomeScreenInterface(localTracks);
      } else {
        document.getElementById('homeLoadedState').style.display = 'none';
        document.getElementById('homeEmptyState').style.display = 'block';
      }

      const localBody = document.getElementById('localTracksBody');
      localBody.innerHTML = '';
      document.getElementById('mymusic-empty-state').style.display = 'none';
      document.getElementById('mymusic-loaded-state').style.display = 'block';

      const countStr = `${localTracks.length} Tracks Loaded`;
      document.getElementById('scanStatus').textContent = countStr;
      document.getElementById('scanMobileStatus').textContent = countStr;

      const folderMap = {};
      localTracks.forEach((t, i) => {
        if (!folderMap[t.folder]) folderMap[t.folder] = [];
        folderMap[t.folder].push(t);

        const tr = document.createElement('tr');
        tr.className = 'track-row';
        tr.dataset.id = t.id;
        tr.innerHTML = `<td>${i+1}</td><td><div class="t-title">${t.title}</div><div class="t-sub">${t.artist}</div></td><td>${t.album}</td><td class="t-dur">${fmt(t.dur)}</td>`;
        localBody.appendChild(tr);
      });

      buildSidebarFolders(folderMap);
      buildMobileFoldersView(folderMap);
      loadDurationsProgressively(localTracks);
    }

    function buildHomeScreenInterface(tracks) {
      const quickGrid = document.getElementById('quickGrid');
      const browseBody = document.getElementById('browseAll');
      quickGrid.innerHTML = '';
      browseBody.innerHTML = '';

      tracks.forEach((t, i) => {
        const tr = document.createElement('tr');
        tr.className = 'track-row';
        tr.dataset.id = t.id;
        tr.innerHTML = `<td>${i+1}</td><td><div class="t-title">${t.title}</div><div class="t-sub">${t.artist}</div></td><td>${t.album}</td><td class="t-dur">${fmt(t.dur)}</td>`;
        tr.addEventListener('click', () => { currentActiveQueue = tracks; playTrack(t); });
        browseBody.appendChild(tr);

        if (i < 6) {
          const card = document.createElement('div');
          card.className = 'quick-card';
          card.innerHTML = `<div class="quick-cover"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.5"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3z"/></svg></div><span>${t.title}</span>`;
          card.addEventListener('click', () => { currentActiveQueue = tracks; playTrack(t); });
          quickGrid.appendChild(card);
        }
      });
    }

    function buildSidebarFolders(map) {
      const container = document.getElementById('sidebarPlaylists');
      container.innerHTML = '';
      Object.keys(map).forEach(name => {
        const songs = map[name];
        const row = document.createElement('div');
        row.className = 'playlist-row';
        row.innerHTML = `<div class="pl-cover"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div><div class="pl-info"><div class="pl-name">${name}</div><div class="pl-count">${songs.length} songs</div></div>`;
        row.addEventListener('click', () => {
          document.querySelectorAll('.playlist-row').forEach(r => r.classList.remove('active'));
          row.classList.add('active');
          openFolderSubView(name, songs);
        });
        container.appendChild(row);
      });
    }

    function buildMobileFoldersView(map) {
      const container = document.getElementById('mobileFoldersContainer');
      container.innerHTML = '';
      const keys = Object.keys(map);
      if (!keys.length) { container.innerHTML = '<div style="font-size:12px; color:var(--text-tertiary); padding:20px 0;">No folders loaded yet.</div>'; return; }
      keys.forEach(name => {
        const songs = map[name];
        const row = document.createElement('div');
        row.className = 'playlist-row';
        row.style.cssText = 'padding:12px; border-radius:8px;';
        row.innerHTML = `<div style="display:flex;align-items:center;gap:16px;"><div class="pl-cover" style="width:44px;height:44px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div><div class="folder-card-info"><div class="pl-name">${name}</div><div class="pl-count">${songs.length} songs</div></div></div>`;
        row.addEventListener('click', () => openFolderSubView(name, songs));
        container.appendChild(row);
      });
    }

    function openFolderSubView(name, songList) {
      window.switchView('folder-tracks');
      document.getElementById('folderViewTitle').textContent = name;
      const tbody = document.getElementById('folderTracksBody');
      tbody.innerHTML = '';
      songList.forEach((t, i) => {
        const tr = document.createElement('tr');
        tr.className = 'track-row';
        tr.dataset.id = t.id;
        tr.innerHTML = `<td>${i+1}</td><td><div class="t-title">${t.title}</div><div class="t-sub">${t.artist}</div></td><td>${t.album}</td><td class="t-dur">${fmt(t.dur)}</td>`;
        tr.addEventListener('click', () => { currentActiveQueue = songList; playTrack(t); });
        tbody.appendChild(tr);
      });
    }

    document.getElementById('modalSyncActionTrigger').addEventListener('click', window.triggerUnifiedPickerSequence);
    document.getElementById('pickFolderTrigger').addEventListener('click', window.triggerUnifiedPickerSequence);
    document.getElementById('changeFolderTrigger').addEventListener('click', window.triggerUnifiedPickerSequence);
    document.getElementById('pickFolderMobileTrigger').addEventListener('click', window.triggerUnifiedPickerSequence);
    document.getElementById('localFolderScanner').addEventListener('change', (e) => { if (e.target.files.length > 0) handleLocalFiles(e.target.files); });

    document.getElementById('topSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const body = document.getElementById('searchResults');
      const ph = document.getElementById('searchPlaceholder');
      if (!q) { body.innerHTML = ''; ph.style.display = 'block'; return; }
      ph.style.display = 'none';
      const matches = localTracks.filter(t => t.title.toLowerCase().includes(q));
      body.innerHTML = '';
      matches.forEach((t, i) => {
        const tr = document.createElement('tr');
        tr.className = 'track-row';
        tr.dataset.id = t.id;
        tr.innerHTML = `<td>${i+1}</td><td><div class="t-title">${t.title}</div><div class="t-sub">${t.artist}</div></td><td>${t.album}</td><td class="t-dur">${fmt(t.dur)}</td>`;
        tr.addEventListener('click', () => { currentActiveQueue = matches; playTrack(t); });
        body.appendChild(tr);
      });
    });

    const volTrack = document.getElementById('volTrack');
    function updateVol(x) {
      const rect = volTrack.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      volTrack.querySelector('.vol-fill').style.width = (pct * 100) + '%';
      audioEl.volume = pct;
    }
    volTrack.addEventListener('mousedown', (e) => {
      updateVol(e.clientX);
      const move = (ev) => updateVol(ev.clientX);
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    volTrack.addEventListener('click', (e) => updateVol(e.clientX));

    function switchView(name, isHistory = false) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const target = document.getElementById('view-' + name);
      if (target) target.classList.add('active');
      document.querySelectorAll('.nav-item, .mob-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === name);
      });
      if (!isHistory) {
        if (viewHistoryPointer < viewHistoryStack.length - 1)
          viewHistoryStack = viewHistoryStack.slice(0, viewHistoryPointer + 1);
        viewHistoryStack.push(name);
        viewHistoryPointer = viewHistoryStack.length - 1;
        history.pushState({ view: name }, "");
        history.pushState({ view: name + '_anchor' }, "");
      }
      updateHistoryButtonStates();
    }
    window.switchView = switchView;

    window.handleHistoryGoBack = function () {
      if (viewHistoryPointer > 0) history.go(-2);
      else document.getElementById('applicationExitConfirmationModal').classList.add('show');
    };

    function handleHistoryGoForward() {
      if (viewHistoryPointer < viewHistoryStack.length - 1) {
        viewHistoryPointer++;
        switchView(viewHistoryStack[viewHistoryPointer], true);
      }
    }

    function updateHistoryButtonStates() {
      const back = document.getElementById('navHistoryBackBtn');
      const fwd = document.getElementById('navHistoryForwardBtn');
      if (back) { back.style.opacity = viewHistoryPointer > 0 ? "1" : "0.3"; back.style.cursor = viewHistoryPointer > 0 ? "pointer" : "not-allowed"; }
      if (fwd) { fwd.style.opacity = viewHistoryPointer < viewHistoryStack.length - 1 ? "1" : "0.3"; fwd.style.cursor = viewHistoryPointer < viewHistoryStack.length - 1 ? "pointer" : "not-allowed"; }
    }

    document.getElementById('navHistoryBackBtn').addEventListener('click', window.handleHistoryGoBack);
    document.getElementById('navHistoryForwardBtn').addEventListener('click', handleHistoryGoForward);
    document.querySelectorAll('[data-view]').forEach(b => {
      if (!b.id?.startsWith('themeToggle')) b.addEventListener('click', () => switchView(b.dataset.view));
    });

    initInterface();
  })();
