// ==========================================
// CONFIGURAÇÕES E TECLAS
// ==========================================
const defaultKeys = { green: 'a', red: 's', yellow: 'j', blue: 'k', orange: 'l' };
function readPlayerKeys() {
    try {
        const saved = JSON.parse(localStorage.getItem('guitarBrowserKeys') || 'null');
        return saved && typeof saved === 'object' ? { ...defaultKeys, ...saved } : { ...defaultKeys };
    } catch (_) {
        return { ...defaultKeys };
    }
}
let playerKeys = readPlayerKeys();
const activeKeys = { green: false, red: false, yellow: false, blue: false, orange: false };

const laneX = { green: 10, red: 30, yellow: 50, blue: 70, orange: 90 };
const FRET_ORDER = ['green', 'red', 'yellow', 'blue', 'orange'];

const gearIcon = document.getElementById('gear-icon');
const settingsModal = document.getElementById('settings-modal');
const btnSaveKeys = document.getElementById('btn-save-keys');
const btnCloseKeys = document.getElementById('btn-close-keys');
const btnJogar = document.getElementById('btn-jogar');

Object.keys(playerKeys).forEach(color => {
    const input = document.getElementById(`key-${color}`);
    if (input) input.value = playerKeys[color];
});

if (gearIcon && settingsModal) gearIcon.onclick = () => { settingsModal.style.display = 'flex'; };
if (btnCloseKeys && settingsModal) btnCloseKeys.onclick = () => { settingsModal.style.display = 'none'; };
if (btnSaveKeys && settingsModal) btnSaveKeys.onclick = () => {
    Object.keys(playerKeys).forEach(color => {
        const input = document.getElementById(`key-${color}`);
        if (input) playerKeys[color] = (input.value || defaultKeys[color]).toLowerCase();
    });
    localStorage.setItem('guitarBrowserKeys', JSON.stringify(playerKeys));
    settingsModal.style.display = 'none';
};

// ==========================================
// BIBLIOTECA LOCAL E IMPORTAÇÃO DE MÚSICAS
// ==========================================
let currentSelectedSong = null;
let sessionImportedSongs = [];
let libraryDbPromise = null;
let chartsDirectoryHandle = null;
let projectDirectoryHandle = null;
let importUi = null;
let localDiskSongs = [];
let librarySongs = [];
let songSearchTerm = '';
let editSongUi = null;
let gamepadSettingsUi = null;
const DEFAULT_GAMEPAD_BINDINGS = { green: 0, red: 1, yellow: 2, blue: 3, orange: 4, star: 8 };
let gamepadBindings = readGamepadBindings();
const coverObjectUrls = new Map();
const DEFAULT_COVER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#42464f"/><stop offset="1" stop-color="#15171b"/></linearGradient></defs><rect width="320" height="320" rx="22" fill="url(#g)"/><path d="M194 68v133a35 35 0 1 1-16-29V99l-82 18v102a35 35 0 1 1-16-29V98l114-25z" fill="#aeb8c8"/><text x="160" y="292" fill="#dce1e9" font-family="sans-serif" font-size="16" text-anchor="middle">SEM CAPA</text></svg>'
);

function openLibraryDb() {
    if (libraryDbPromise) return libraryDbPromise;
    if (!window.indexedDB) return Promise.reject(new Error('Este navegador não oferece IndexedDB.'));
    libraryDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('GuitarBrowserLibrary', 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Não foi possível abrir a biblioteca local.'));
        request.onblocked = () => reject(new Error('Feche outra aba do Guitar Browser e tente novamente.'));
    });
    return libraryDbPromise;
}

function idbRequest(storeName, mode, makeRequest) {
    return openLibraryDb().then(db => new Promise((resolve, reject) => {
        let result;
        let request;
        let settled = false;
        const tx = db.transaction(storeName, mode);
        tx.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
        tx.onerror = () => { if (!settled) { settled = true; reject(tx.error || new Error('Falha ao guardar na biblioteca local.')); } };
        tx.onabort = () => { if (!settled) { settled = true; reject(tx.error || new Error('A gravação local foi cancelada.')); } };
        try {
            request = makeRequest(tx.objectStore(storeName));
            if (request) {
                request.onsuccess = () => { result = request.result; };
                request.onerror = () => { if (!settled) { settled = true; reject(request.error || new Error('Falha na operação da biblioteca.')); } };
            }
        } catch (error) {
            if (!settled) { settled = true; reject(error); }
        }
    }));
}

function dbGetAllSongs() { return idbRequest('songs', 'readonly', store => store.getAll()); }
function dbSaveSong(song) { return idbRequest('songs', 'readwrite', store => store.put(song)); }
function dbDeleteSong(id) { return idbRequest('songs', 'readwrite', store => store.delete(id)); }
function dbGetSetting(key) {
    return idbRequest('settings', 'readonly', store => store.get(key)).then(row => row ? row.value : null);
}
function dbSetSetting(key, value) { return idbRequest('settings', 'readwrite', store => store.put({ key, value })); }

async function restoreDirectoryHandles() {
    try {
        chartsDirectoryHandle = await dbGetSetting('chartsDirectoryHandle');
        projectDirectoryHandle = await dbGetSetting('projectDirectoryHandle');
    } catch (error) {
        console.warn('Não foi possível restaurar a pasta local Charts:', error);
    }
}
const libraryReady = restoreDirectoryHandles().then(async () => {
    try { localDiskSongs = await scanLocalChartsDirectory(); }
    catch (error) { console.warn('Não foi possível reler Charts nesta abertura:', error); localDiskSongs = []; }
}).catch(() => {});

function injectImportStyles() {
    if (document.getElementById('gb-import-styles')) return;
    const style = document.createElement('style');
    style.id = 'gb-import-styles';
    style.textContent = `
        .sidebar.gb-sidebar { flex-direction: column; align-items: center; justify-content: flex-start; gap: 14px; padding: 15px 0; box-sizing: border-box; }
        #gear-icon { flex: 0 0 auto; }
        #gb-add-song { width: 34px; height: 34px; display:flex; align-items:center; justify-content:center; padding:0; border:1px solid #565b64; border-radius:9px; background:#202227; color:#f4f4f4; cursor:pointer; transition:all .18s ease; }
        #gb-add-song:hover { background:#30343b; border-color:#8fd0ff; transform:scale(1.06); }
        #gb-add-song svg { width:22px; height:22px; display:block; }
        #gb-import-modal { position:fixed; inset:0; z-index:1300; display:none; align-items:center; justify-content:center; padding:18px; box-sizing:border-box; background:rgba(0,0,0,.78); color:#fff; font-family:inherit; }
        #gb-import-dialog { width:min(620px, 100%); max-height:min(90vh, 760px); overflow:auto; box-sizing:border-box; padding:26px; border:1px solid #42464e; border-radius:16px; background:#202125; box-shadow:0 24px 90px rgba(0,0,0,.65); }
        #gb-import-dialog * { box-sizing:border-box; }
        #gb-import-dialog header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:9px; }
        #gb-import-dialog h2 { margin:0; font-size:1.35rem; font-weight:700; }
        #gb-import-dialog p { color:#c1c4cc; line-height:1.5; margin:8px 0 16px; font-size:.91rem; }
        #gb-import-close { flex:0 0 auto; border:0; border-radius:7px; background:transparent; color:#bbb; font-size:1.55rem; line-height:1; cursor:pointer; padding:3px 8px; }
        #gb-import-close:hover { color:#fff; background:#34363c; }
        .gb-import-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:16px 0; }
        .gb-import-action, .gb-link-folder { min-height:48px; padding:11px 13px; border:1px solid #4b5059; border-radius:9px; background:#2a2d33; color:#fff; font:inherit; font-size:.9rem; text-align:left; cursor:pointer; transition:background .15s,border-color .15s,transform .15s; }
        .gb-import-action:hover, .gb-link-folder:hover { background:#353a43; border-color:#80bff0; transform:translateY(-1px); }
        .gb-import-action strong { display:block; margin-bottom:3px; }
        .gb-import-action span { display:block; color:#aeb4bf; font-size:.78rem; }
        .gb-import-location { margin-top:18px; padding:15px; border:1px solid #3e424a; border-radius:10px; background:#191a1e; }
        .gb-import-location strong { display:block; font-size:.92rem; }
        #gb-location-status { margin:7px 0 12px; color:#bbc1cb; font-size:.8rem; line-height:1.45; overflow-wrap:anywhere; }
        .gb-link-folder { min-height:40px; padding:9px 12px; font-size:.82rem; }
        #gb-import-status { min-height:38px; margin:15px 0 0; padding:10px 12px; border-radius:8px; background:#17181b; color:#d6d9df; font-size:.83rem; line-height:1.5; overflow-wrap:anywhere; }
        #gb-import-status[data-kind="success"] { color:#a8efb1; }
        #gb-import-status[data-kind="error"] { color:#ffb1a8; }
        #gb-import-status[data-kind="busy"] { color:#a8d9ff; }
        .gb-import-note { margin-top:14px !important; font-size:.76rem !important; color:#9ea3ad !important; }
        .gb-import-hidden-input { display:none !important; }
        @media (max-width:620px) { #gb-import-dialog { padding:20px; } .gb-import-actions { grid-template-columns:1fr; } .sidebar.gb-sidebar { width:44px; } }
    `;
    document.head.appendChild(style);
}

function makeHiddenInput(id, accept, directory = false) {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = id;
    input.className = 'gb-import-hidden-input';
    input.multiple = directory || id === 'gb-input-files';
    if (accept) input.accept = accept;
    if (directory) {
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
    }
    document.body.appendChild(input);
    return input;
}

function setupImportUi() {
    if (document.getElementById('gb-add-song')) return;
    injectImportStyles();
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    sidebar.classList.add('gb-sidebar');

    const addButton = document.createElement('button');
    addButton.id = 'gb-add-song';
    addButton.type = 'button';
    addButton.title = 'Adicionar músicas';
    addButton.setAttribute('aria-label', 'Adicionar músicas');
    addButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    if (gearIcon && gearIcon.parentNode === sidebar) gearIcon.insertAdjacentElement('afterend', addButton);
    else sidebar.appendChild(addButton);

    const modal = document.createElement('div');
    modal.id = 'gb-import-modal';
    modal.innerHTML = `
        <section id="gb-import-dialog" role="dialog" aria-modal="true" aria-labelledby="gb-import-title">
            <header><h2 id="gb-import-title">Adicionar músicas</h2><button id="gb-import-close" type="button" aria-label="Fechar">×</button></header>
            <p>Importe um ZIP, uma pasta de música ou ficheiros soltos. O jogo procura automaticamente o áudio principal, a chart e os metadados, mesmo dentro de subpastas. Para manter as músicas nos ficheiros do jogo, ligue primeiro a pasta local GuitarBrowser/Charts.</p>
            <div class="gb-import-actions">
                <button class="gb-import-action" id="gb-pick-zip" type="button"><strong>Importar arquivo .zip</strong><span>Clone Hero, packs de charts ou pastas compactadas</span></button>
                <button class="gb-import-action" id="gb-pick-folder" type="button"><strong>Importar pasta</strong><span>Selecione a pasta da música ou uma pasta Charts inteira</span></button>
                <button class="gb-import-action" id="gb-pick-files" type="button"><strong>Escolher ficheiros</strong><span>Áudio + chart + song.ini, music.txt ou capa</span></button>
            </div>
            <div class="gb-import-location">
                <strong>Destino local: pasta Charts do jogo</strong>
                <div id="gb-location-status">A preparar a biblioteca local…</div>
                <button class="gb-link-folder" id="gb-link-game-folder" type="button">Escolher pasta local GuitarBrowser</button>
            </div>
            <div id="gb-import-status" role="status" aria-live="polite">Os ficheiros são processados neste navegador; não são enviados para um servidor.</div>
            <p class="gb-import-note">Charts reconhecidas: Clone Hero (.chart), MIDI (.mid/.midi), StepMania (.sm/.ssc), osu!mania (.osu), BMS (.bms/.bme/.bml) e charts JSON compatíveis. Áudio comum: MP3, OGG, WAV, M4A, FLAC, AAC, OPUS e WebM.</p>
        </section>`;
    document.body.appendChild(modal);

    const zipInput = makeHiddenInput('gb-input-zip', '.zip,application/zip');
    const folderInput = makeHiddenInput('gb-input-folder', '', true);
    const filesInput = makeHiddenInput('gb-input-files', '.chart,.mid,.midi,.sm,.ssc,.osu,.bms,.bme,.bml,.json,.mp3,.ogg,.oga,.wav,.wave,.m4a,.mp4,.flac,.aac,.opus,.webm,.wma,.ini,.txt,.jpg,.jpeg,.png,.webp');
    const status = modal.querySelector('#gb-import-status');
    const closeModal = () => { modal.style.display = 'none'; };
    const runPicker = (input, kind) => {
        input.value = '';
        input.onchange = () => {
            const files = Array.from(input.files || []);
            if (files.length) handleImportFiles(files, kind);
        };
        input.click();
    };

    addButton.addEventListener('click', async () => {
        await libraryReady;
        modal.style.display = 'flex';
        updateLocationStatus();
    });
    modal.querySelector('#gb-import-close').addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.style.display === 'flex') closeModal(); });
    modal.querySelector('#gb-pick-zip').addEventListener('click', () => runPicker(zipInput, 'zip'));
    modal.querySelector('#gb-pick-folder').addEventListener('click', () => runPicker(folderInput, 'folder'));
    modal.querySelector('#gb-pick-files').addEventListener('click', () => runPicker(filesInput, 'files'));
    modal.querySelector('#gb-link-game-folder').addEventListener('click', chooseGameDirectory);

    importUi = { modal, status, location: modal.querySelector('#gb-location-status') };
}

function setImportStatus(message, kind = '') {
    if (!importUi || !importUi.status) return;
    importUi.status.textContent = message;
    importUi.status.dataset.kind = kind;
}

function updateLocationStatus() {
    if (!importUi || !importUi.location) return;
    if (chartsDirectoryHandle) {
        const localName = projectDirectoryHandle ? projectDirectoryHandle.name : chartsDirectoryHandle.name;
        const indexText = projectDirectoryHandle ? 'A pasta do jogo também permite atualizar songs.json.' : 'Apenas Charts está ligada; a lista será mantida nesta biblioteca do navegador.';
        importUi.location.textContent = `Ligada: ${localName} → Charts. ${localDiskSongs.length} chart(s) relida(s) nesta abertura; a pasta será relida ao abrir o jogo. ${indexText}`;
    } else if (window.showDirectoryPicker) {
        importUi.location.textContent = 'Ligue primeiro a pasta local GuitarBrowser (ou a própria pasta Charts). A importação para o jogo só será concluída depois de escolher o destino; a ligação fica guardada para as próximas aberturas.';
    } else {
        importUi.location.textContent = 'Este navegador não permite escolher pastas locais. A única alternativa é IndexedDB neste navegador; os ficheiros não podem ser copiados para Charts até usar um navegador com acesso a pastas.';
    }
}

async function chooseGameDirectory() {
    if (!window.showDirectoryPicker) {
        setImportStatus('O acesso a pastas locais não está disponível neste navegador. A importação ainda pode ser guardada na biblioteca do browser.', 'error');
        return;
    }
    try {
        const selected = await window.showDirectoryPicker({ id: 'guitar-browser-project', mode: 'readwrite' });
        let root = null;
        let charts = null;
        if ((selected.name || '').toLowerCase() === 'charts') {
            charts = selected;
        } else {
            root = selected;
            charts = await findChildDirectory(selected, 'Charts');
            if (!charts) charts = await selected.getDirectoryHandle('Charts', { create: true });
        }
        if (charts.requestPermission) {
            const permission = await charts.requestPermission({ mode: 'readwrite' });
            if (permission !== 'granted') throw new Error('Sem permissão de escrita na pasta escolhida.');
        }
        chartsDirectoryHandle = charts;
        projectDirectoryHandle = root;
        try {
            await dbSetSetting('chartsDirectoryHandle', charts);
            await dbSetSetting('projectDirectoryHandle', root);
        } catch (error) {
            console.warn('A pasta ficará ligada apenas até fechar esta aba:', error);
        }
        if (navigator.storage && navigator.storage.persist) {
            try { await navigator.storage.persist(); } catch (_) {}
        }
        localDiskSongs = await scanLocalChartsDirectory().catch(error => { console.warn('Falha ao reler Charts:', error); return []; });
        updateLocationStatus();
        await loadMenu('', localDiskSongs[0] ? localDiskSongs[0].folder : '');
        setImportStatus(`Pasta local ligada. ${localDiskSongs.length} chart(s) lida(s) de Charts; as próximas importações serão guardadas na mesma pasta.`, 'success');
    } catch (error) {
        if (error && error.name === 'AbortError') return;
        console.warn('Não foi possível ligar a pasta do jogo:', error);
        setImportStatus(`Não foi possível ligar a pasta: ${error.message || error}`, 'error');
    }
}

async function findChildDirectory(parent, wantedName) {
    try { return await parent.getDirectoryHandle(wantedName, { create: false }); } catch (_) {}
    if (parent.entries) {
        try {
            for await (const [name, handle] of parent.entries()) {
                if (handle.kind === 'directory' && name.toLowerCase() === wantedName.toLowerCase()) return handle;
            }
        } catch (_) {}
    }
    return null;
}

function cleanRelativePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^[a-zA-Z]:\//, '').replace(/^\/+/, '')
        .split('/').filter(part => part && part !== '.' && part !== '..').map(part => part.replace(/[\u0000-\u001f]/g, '')).filter(Boolean).join('/');
}
function pathParts(path) { return cleanRelativePath(path).split('/').filter(Boolean); }
function pathDirectory(path) { const parts = pathParts(path); parts.pop(); return parts.join('/'); }
function commonDirectory(pathA, pathB) {
    const a = pathParts(pathA); const b = pathParts(pathB); a.pop(); b.pop();
    const out = [];
    for (let i = 0; i < Math.min(a.length, b.length) && a[i].toLowerCase() === b[i].toLowerCase(); i++) out.push(a[i]);
    return out.join('/');
}
function commonPartsCount(pathA, pathB) {
    const a = pathParts(pathA); const b = pathParts(pathB); a.pop(); b.pop();
    let count = 0;
    for (let i = 0; i < Math.min(a.length, b.length) && a[i].toLowerCase() === b[i].toLowerCase(); i++) count++;
    return count;
}
function pathStartsWith(path, root) {
    const p = cleanRelativePath(path).toLowerCase(); const r = cleanRelativePath(root).toLowerCase();
    return !r || p === r || p.startsWith(r + '/');
}
function relativeToRoot(path, root) {
    const p = cleanRelativePath(path); const r = cleanRelativePath(root);
    if (!r) return p;
    return p.toLowerCase().startsWith(r.toLowerCase() + '/') ? p.slice(r.length + 1) : p;
}
function fileExtension(path) {
    const name = pathParts(path).pop() || '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}
function baseNameWithoutExtension(path) {
    const name = pathParts(path).pop() || '';
    return name.replace(/\.[^.]+$/, '').toLowerCase();
}
function assetUrl(folder, asset) {
    const rawAsset = String(asset || '').trim();
    if (/^(https?:|blob:|data:)/i.test(rawAsset)) return rawAsset;
    const safeFolder = cleanRelativePath(folder);
    const safeAsset = cleanRelativePath(rawAsset);
    return [...safeFolder.split('/').filter(Boolean), ...safeAsset.split('/').filter(Boolean)].map(encodeURIComponent).join('/');
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'ogg', 'oga', 'wav', 'wave', 'm4a', 'mp4', 'flac', 'aac', 'opus', 'wma', 'webm']);
const CHART_EXTENSIONS = new Set(['chart', 'mid', 'midi', 'sm', 'ssc', 'osu', 'bms', 'bme', 'bml', 'json']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const METADATA_NAMES = new Set(['song.ini', 'music.txt', 'song.txt', 'info.txt', 'info.ini', 'metadata.txt', 'metadata.json', 'song.json', 'songinfo.txt', 'guitar-browser.json']);

function isAudioEntry(entry) { return AUDIO_EXTENSIONS.has(fileExtension(entry.path || entry.name)); }
function isImageEntry(entry) { return IMAGE_EXTENSIONS.has(fileExtension(entry.path || entry.name)); }
function isMetadataEntry(entry) { return METADATA_NAMES.has((pathParts(entry.path || entry.name).pop() || '').toLowerCase()); }
function isChartEntry(entry) {
    const ext = fileExtension(entry.path || entry.name);
    if (CHART_EXTENSIONS.has(ext)) {
        const leaf = (pathParts(entry.path || entry.name).pop() || '').toLowerCase();
        if (ext === 'json' && /^(song|metadata|info)\.json$/.test(leaf)) return true; // parsing later verifies that it contains notes
        return true;
    }
    if (ext === 'txt') {
        const leaf = (pathParts(entry.path || entry.name).pop() || '').toLowerCase();
        return /(chart|notes|notas|beatmap|track)/.test(leaf);
    }
    return false;
}

async function unzipFile(zipFile) {
    const buffer = await zipFile.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const minSearch = Math.max(0, bytes.length - 22 - 65535);
    let eocd = -1;
    for (let p = bytes.length - 22; p >= minSearch; p--) {
        if (view.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
    }
    if (eocd < 0) throw new Error('O ZIP está inválido ou não é compatível (fim do arquivo não encontrado).');
    const entryCount = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (entryCount === 0xffff || centralOffset === 0xffffffff) throw new Error('Este ZIP usa ZIP64; extraia a pasta no computador e importe a pasta em vez do ZIP.');
    if (entryCount > 10000) throw new Error('O ZIP contém demasiados ficheiros (limite: 10.000).');
    const decoderUtf8 = new TextDecoder('utf-8');
    const decoderLegacy = (() => { try { return new TextDecoder('windows-1252'); } catch (_) { return decoderUtf8; } })();
    const entries = [];
    let cursor = centralOffset;
    let totalSize = 0;
    for (let i = 0; i < entryCount; i++) {
        if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('A tabela de ficheiros do ZIP está corrompida.');
        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
        const rawName = ((flags & 0x0800) ? decoderUtf8 : decoderLegacy).decode(nameBytes);
        cursor += 46 + nameLength + extraLength + commentLength;
        const normalizedName = cleanRelativePath(rawName);
        if (!normalizedName || rawName.endsWith('/')) continue;
        if (uncompressedSize > 250 * 1024 * 1024) throw new Error(`O ficheiro ${normalizedName} ultrapassa 250 MB.`);
        totalSize += uncompressedSize;
        if (totalSize > 600 * 1024 * 1024) throw new Error('O conteúdo extraído do ZIP ultrapassa 600 MB.');
        if ((flags & 0x0001) !== 0) throw new Error(`O ZIP está protegido por palavra-passe (${normalizedName}).`);
        if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Cabeçalho inválido no ZIP (${normalizedName}).`);
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > bytes.length) throw new Error(`Dados truncados no ZIP (${normalizedName}).`);
        const compressed = bytes.slice(dataStart, dataEnd);
        let blob;
        if (method === 0) {
            blob = new Blob([compressed]);
        } else if (method === 8) {
            if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não consegue descompactar ZIPs. Importe uma pasta descompactada.');
            try {
                const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                blob = await new Response(stream).blob();
            } catch (error) {
                throw new Error(`Não foi possível descompactar ${normalizedName}: ${error.message || error}`);
            }
        } else {
            throw new Error(`Método de compressão não suportado no ZIP (${method}).`);
        }
        if (uncompressedSize && blob.size !== uncompressedSize) throw new Error(`Tamanho inválido depois de descompactar ${normalizedName}.`);
        entries.push({ path: normalizedName, name: pathParts(normalizedName).pop() || normalizedName, blob, type: blob.type || '' });
    }
    return entries;
}

function parseMetadataText(text, extension = '') {
    const source = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!source) return {};
    if (extension === 'json' || /^[{[]/.test(source)) {
        try {
            const parsed = JSON.parse(source);
            const obj = parsed.metadata && typeof parsed.metadata === 'object' ? { ...parsed, ...parsed.metadata } : parsed;
            const song = obj.song && typeof obj.song === 'object' ? { ...obj, ...obj.song } : obj;
            return lowerCaseKeys(song);
        } catch (_) {}
    }
    const values = {};
    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith(';') || line.startsWith('//') || /^\[[^\]]+\]$/.test(line)) continue;
        const sepEq = line.indexOf('=');
        const sepColon = line.indexOf(':');
        let splitAt = -1;
        if (sepEq >= 0 && sepColon >= 0) splitAt = Math.min(sepEq, sepColon);
        else splitAt = Math.max(sepEq, sepColon);
        if (splitAt <= 0) continue;
        const key = line.slice(0, splitAt).trim().replace(/^#/, '').toLowerCase();
        let value = line.slice(splitAt + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (key && value) values[key] = value;
    }
    return values;
}
function lowerCaseKeys(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const [key, item] of Object.entries(value)) result[String(key).toLowerCase()] = item;
    return result;
}
function normalizeSongMeta(meta, fallbackName = '') {
    const values = lowerCaseKeys(meta || {});
    const asText = value => value == null ? '' : String(value).trim();
    return {
        name: asText(values.name || values.title || values.titleunicode || values.song || values.track || values.label || fallbackName),
        artist: asText(values.artist || values.artistunicode || values.performer || values.author || values.composer || values.band || ''),
        year: asText(values.year || values.released || values.date || ''),
        album: asText(values.album || ''),
        genre: asText(values.genre || ''),
        cover: asText(values.cover || values.albumart || values.album_art || values.artwork || values.background || ''),
        chart: asText(values.chart || values.chartfile || values.notes || values.notesfile || values.beatmap || ''),
        audio: asText(values.audio || values.audiofile || values.audiofilename || values.music || values.musicfile || values.file || ''),
        charter: asText(values.charter || values.creator || values.mapper || ''),
        description: asText(values.description || values.comment || values.loading_phrase || values.loadingphrase || values.subtitle || ''),
        chartTimeShiftMs: Number(values.charttimeshiftms || values.chart_time_shift_ms || values.charttimeshift || 0) || 0,
        raw: values
    };
}
async function textFromEntry(entry) {
    return new TextDecoder('utf-8').decode(await entry.blob.arrayBuffer()).replace(/^\uFEFF/, '');
}

async function loadStaticSong(indexEntry) {
    const folder = cleanRelativePath(indexEntry.folder || indexEntry.path || '');
    const fallbackName = pathParts(folder).pop() || 'Música sem nome';
    let rawMeta = {};
    const manifestNames = ['song.ini', 'music.txt', 'song.txt', 'info.txt', 'info.ini', 'metadata.txt', 'songinfo.txt', 'song.json', 'metadata.json', 'guitar-browser.json'];
    for (const name of manifestNames) {
        try {
            const response = await fetch(assetUrl(folder, name), { cache: 'no-store' });
            if (!response.ok) continue;
            const text = await response.text();
            rawMeta = { ...rawMeta, ...parseMetadataText(text, fileExtension(name)) };
        } catch (_) {}
    }
    const data = normalizeSongMeta(rawMeta, fallbackName);
    const coverPath = data.cover ? assetUrl(folder, data.cover) : '';
    return { ...data, folder, coverPath, imported: false, staticEntry: true };
}

function getObjectUrl(key, blob) {
    if (!blob) return '';
    const existing = coverObjectUrls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    coverObjectUrls.set(key, url);
    return url;
}

function ensureDetailTitle() {
    let title = document.getElementById('detail-title');
    if (title) return title;
    const details = document.querySelector('.details-content');
    if (!details) return null;
    title = document.createElement('h2');
    title.id = 'detail-title';
    title.textContent = '';
    const playButton = document.getElementById('btn-jogar');
    if (playButton && playButton.parentNode === details) details.insertBefore(title, playButton);
    else details.appendChild(title);
    return title;
}

function ensureDetailSubtitle() {
    let subtitle = document.getElementById('gb-detail-subtitle');
    if (subtitle) return subtitle;
    const details = document.querySelector('.details-content');
    if (!details) return null;
    subtitle = document.createElement('p');
    subtitle.id = 'gb-detail-subtitle';
    const playButton = document.getElementById('btn-jogar');
    if (playButton && playButton.parentNode === details) details.insertBefore(subtitle, playButton);
    else details.appendChild(subtitle);
    return subtitle;
}

function normalizeForSearch(value) {
    return String(value || '').toLocaleLowerCase('pt-PT').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function renderSongList(preferredId = '', preferredFolder = '') {
    const listContainer = document.getElementById('song-list');
    if (!listContainer) return;
    listContainer.textContent = '';
    const allSongs = Array.isArray(librarySongs) ? librarySongs : [];
    const filtered = allSongs.filter(song => {
        if (!songSearchTerm) return true;
        const haystack = normalizeForSearch([song.name, song.artist, song.year, song.album, song.genre, song.charter, song.description].join(' '));
        return haystack.includes(songSearchTerm);
    });
    const count = document.getElementById('gb-song-count');
    if (count) count.textContent = songSearchTerm ? `${filtered.length} / ${allSongs.length}` : `${allSongs.length} música${allSongs.length === 1 ? '' : 's'}`;
    if (!filtered.length) {
        const empty = document.createElement('div');
        empty.id = 'gb-no-results';
        empty.textContent = allSongs.length ? 'Nenhuma música corresponde à pesquisa.' : 'Ainda não há músicas na biblioteca. Use + para adicionar.';
        listContainer.appendChild(empty);
        return;
    }
    let preferredElement = null;
    for (const song of filtered) {
        const item = document.createElement('div');
        item.className = 'song-item';
        if (song.id) item.dataset.songId = song.id;
        if (song.folder) item.dataset.folder = song.folder;
        const cover = document.createElement('img');
        cover.alt = 'Capa';
        if (song.coverBlob) cover.src = getObjectUrl(`cover:${song.id}`, song.coverBlob);
        else cover.src = song.coverPath || DEFAULT_COVER;
        cover.onerror = () => { cover.onerror = null; cover.src = DEFAULT_COVER; };
        const info = document.createElement('div');
        info.className = 'song-info';
        const title = document.createElement('h2');
        title.textContent = song.name || 'Sem nome';
        const artist = document.createElement('p');
        artist.textContent = song.artist || '';
        const year = document.createElement('p');
        year.textContent = song.year || '';
        info.append(title, artist, year);
        item.append(cover, info);
        item.addEventListener('click', () => selectSong(item, song, song.coverBlob ? getObjectUrl(`cover:${song.id}`, song.coverBlob) : (song.coverPath || DEFAULT_COVER)));
        listContainer.appendChild(item);
        const sameFolder = preferredFolder && cleanRelativePath(song.folder || '').toLowerCase() === cleanRelativePath(preferredFolder).toLowerCase();
        const sameId = preferredId && song.id === preferredId;
        const wasSelected = !preferredId && !preferredFolder && currentSelectedSong && ((song.id && song.id === currentSelectedSong.id) || (song.folder && currentSelectedSong.folder && cleanRelativePath(song.folder).toLowerCase() === cleanRelativePath(currentSelectedSong.folder).toLowerCase()));
        if (sameId || sameFolder || wasSelected) preferredElement = item;
    }
    if (preferredElement) preferredElement.click();
}

async function loadMenu(preferredId = '', preferredFolder = '') {
    if (!document.getElementById('song-list')) return;
    const previous = currentSelectedSong;
    try {
        await libraryReady;
        let index = [];
        try {
            const response = await fetch('songs.json', { cache: 'no-store' });
            index = response.ok ? await response.json() : [];
        } catch (_) { index = []; }
        let staticSongs = await Promise.all((Array.isArray(index) ? index : []).filter(entry => entry && (entry.folder || entry.path)).map(loadStaticSong));
        let savedImports = [];
        try { savedImports = await dbGetAllSongs(); } catch (error) { console.warn('A biblioteca local não pôde ser lida:', error); }
        const importMap = new Map();
        [...sessionImportedSongs, ...(Array.isArray(savedImports) ? savedImports : [])].forEach(song => {
            if (song && song.id) importMap.set(song.id, song);
        });
        const diskFolderSet = new Set(localDiskSongs.map(song => cleanRelativePath(song.folder).toLowerCase()));
        staticSongs = staticSongs.filter(song => !diskFolderSet.has(cleanRelativePath(song.folder).toLowerCase()));
        const indexedFolders = new Set([...staticSongs, ...localDiskSongs].map(song => cleanRelativePath(song.folder || '').toLowerCase()));
        const imports = [...importMap.values()].filter(song => !song.folder || !indexedFolders.has(cleanRelativePath(song.folder).toLowerCase()));
        const overrides = await dbGetSetting('songOverrides').catch(() => ({})) || {};
        const hiddenFolders = new Set((await dbGetSetting('hiddenSongFolders').catch(() => [])) || []);
        const applyOverrides = song => {
            const key = cleanRelativePath(song.folder || '').toLowerCase();
            const override = overrides[key];
            if (!override || typeof override !== 'object') return song;
            return { ...song, ...override, id: song.id, folder: song.folder, chartData: song.chartData, chartBlob: song.chartBlob, audioBlob: song.audioBlob, coverBlob: song.coverBlob };
        };
        const songs = [...localDiskSongs, ...staticSongs, ...imports].map(applyOverrides).filter(song => !hiddenFolders.has(cleanRelativePath(song.folder || '').toLowerCase()));
        librarySongs = songs;
        if (!preferredId && !preferredFolder && previous) {
            preferredId = previous.id || '';
            preferredFolder = previous.folder || '';
        }
        renderSongList(preferredId, preferredFolder);
    } catch (error) {
        console.error('Erro ao carregar o menu:', error);
        setImportStatus(`Não foi possível carregar a lista de músicas: ${error.message || error}`, 'error');
    }
}

function selectSong(element, songData, coverPath) {
    document.querySelectorAll('.song-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    currentSelectedSong = songData;
    const detailCover = document.getElementById('detail-cover');
    const detailTitle = ensureDetailTitle();
    if (detailCover) {
        detailCover.onerror = () => { detailCover.onerror = null; detailCover.src = DEFAULT_COVER; };
        detailCover.crossOrigin = 'anonymous';
        detailCover.src = coverPath || DEFAULT_COVER;
        detailCover.style.display = 'block';
        if (detailCover.complete) extractColor(detailCover, detailTitle);
        else detailCover.onload = () => extractColor(detailCover, detailTitle);
    }
    if (detailTitle) {
        detailTitle.innerText = songData.name || 'Sem nome';
        detailTitle.style.display = 'block';
    }
    const subtitle = ensureDetailSubtitle();
    if (subtitle) {
        const identity = [songData.artist, songData.year, songData.album].filter(Boolean).join(' · ');
        const chartInfo = songData.chartData && songData.chartData.difficulty
            ? `Chart: ${songData.chartData.difficulty}${songData.chartData.track ? ` (${songData.chartData.track})` : ''}` : '';
        subtitle.textContent = [identity, songData.genre ? `Género: ${songData.genre}` : '', songData.charter ? `Autor: ${songData.charter}` : '', chartInfo, songData.description].filter(Boolean).join(' — ');
    }
    if (btnJogar) btnJogar.style.display = 'inline-block';
    const actions = document.getElementById('gb-song-actions');
    if (actions) actions.style.display = 'flex';
}

function extractColor(_img, titleEl) {
    if (titleEl) titleEl.style.backgroundColor = '#383a3e';
}

function slugifyFolderName(name) {
    const cleaned = String(name || 'Nova música').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
    return (cleaned || 'Nova música').slice(0, 90);
}
function makeSongId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `song-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
async function directoryHasName(directory, name) {
    if (!directory) return false;
    try { await directory.getDirectoryHandle(name, { create: false }); return true; } catch (_) { return false; }
}
async function allocateFolderName(baseName, knownSongs = []) {
    const base = slugifyFolderName(baseName);
    const known = new Set(knownSongs.map(song => String(song.folderName || pathParts(song.folder || '').pop() || '').toLowerCase()));
    try {
        if (projectDirectoryHandle) {
            const indexFile = await projectDirectoryHandle.getFileHandle('songs.json', { create: false });
            const rows = JSON.parse(await (await indexFile.getFile()).text());
            if (Array.isArray(rows)) rows.forEach(row => { const folder = pathParts(row.folder || '').pop(); if (folder) known.add(folder.toLowerCase()); });
        } else {
            const response = await fetch('songs.json', { cache: 'no-store' });
            if (response.ok) {
                const rows = await response.json();
                if (Array.isArray(rows)) rows.forEach(row => { const folder = pathParts(row.folder || '').pop(); if (folder) known.add(folder.toLowerCase()); });
            }
        }
    } catch (_) {}
    let candidate = base;
    let suffix = 2;
    while (known.has(candidate.toLowerCase()) || await directoryHasName(chartsDirectoryHandle, candidate)) candidate = `${base} (${suffix++})`;
    return candidate;
}

async function collectDirectoryFiles(directoryHandle, prefix = '', out = [], depth = 0) {
    if (depth > 12 || out.length > 10000) return out;
    for await (const [name, handle] of directoryHandle.entries()) {
        if (!name || name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini') continue;
        const relative = cleanRelativePath(prefix ? `${prefix}/${name}` : name);
        if (handle.kind === 'directory') {
            await collectDirectoryFiles(handle, relative, out, depth + 1);
            continue;
        }
        const ext = fileExtension(name);
        if (!AUDIO_EXTENSIONS.has(ext) && !CHART_EXTENSIONS.has(ext) && !IMAGE_EXTENSIONS.has(ext) && !METADATA_NAMES.has(name.toLowerCase()) && ext !== 'txt' && ext !== 'ini') continue;
        try {
            const file = await handle.getFile();
            if (!file.size) continue;
            out.push({ path: relative, name, blob: file, type: file.type || '' });
        } catch (_) {}
    }
    return out;
}

async function scanLocalChartsDirectory() {
    if (!chartsDirectoryHandle || !chartsDirectoryHandle.entries) return [];
    try {
        const permission = chartsDirectoryHandle.queryPermission ? await chartsDirectoryHandle.queryPermission({ mode: 'read' }) : 'granted';
        if (permission !== 'granted') return [];
    } catch (_) { return []; }
    const found = new Map();
    for await (const [name, handle] of chartsDirectoryHandle.entries()) {
        if (!name || name.startsWith('.') || name === 'Thumbs.db' || handle.kind !== 'directory') continue;
        try {
            const entries = await collectDirectoryFiles(handle);
            if (!entries.some(isChartEntry) || !entries.some(isAudioEntry)) continue;
            const bundles = await discoverSongBundles(entries, { autoTrim: false, lazyAudio: true });
            for (const bundle of bundles) {
                const nestedRoot = cleanRelativePath(bundle.sourceRoot || '');
                const folderName = cleanRelativePath([name, nestedRoot].filter(Boolean).join('/'));
                if (!folderName) continue;
                const folder = `Charts/${folderName}`;
                const key = folder.toLowerCase();
                if (found.has(key)) continue;
                const id = `disk:${key}`;
                const data = {
                    id, imported: true, diskSource: true, storage: 'filesystem',
                    name: bundle.meta.name || pathParts(folderName).pop() || 'Música sem nome',
                    artist: bundle.meta.artist || '', year: bundle.meta.year || '', album: bundle.meta.album || '',
                    genre: bundle.meta.genre || '', charter: bundle.meta.charter || '', description: bundle.meta.description || '',
                    chartTimeShiftMs: Number(bundle.meta.chartTimeShiftMs || 0) || 0,
                    folder, folderName, chartName: bundle.chartName, chartExt: bundle.chartExt, chartBlob: bundle.chartBlob,
                    audioName: bundle.audioName, audioBlob: bundle.audioBlob, coverName: bundle.coverName || '',
                    coverBlob: bundle.coverBlob || null, chartData: serializeChartData(bundle.parsed),
                    coverPath: '', files: []
                };
                if (data.coverBlob) data.coverPath = getObjectUrl(`cover:${id}`, data.coverBlob);
                found.set(key, data);
            }
        } catch (error) {
            console.warn(`Não foi possível ler Charts/${name}:`, error);
        }
    }
    return [...found.values()];
}

async function requestPersistentStorage() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try { return await navigator.storage.persist(); } catch (_) { return false; }
}

async function handleImportFiles(files, mode) {
    if (!files || !files.length) return;
    if (!chartsDirectoryHandle && window.showDirectoryPicker) {
        setImportStatus('Antes de importar, ligue a pasta local GuitarBrowser/Charts para que os ficheiros fiquem guardados no jogo.', 'error');
        return;
    }
    try {
        setImportStatus('A ler e analisar os ficheiros…', 'busy');
        let entries;
        if (mode === 'zip') {
            if (files.length !== 1) throw new Error('Escolha um ZIP de cada vez.');
            entries = await unzipFile(files[0]);
        } else {
            entries = files.map(file => {
                const path = cleanRelativePath(file.webkitRelativePath || file.name || '');
                return { path, name: pathParts(path).pop() || file.name, blob: file, type: file.type || '' };
            }).filter(entry => entry.path && entry.blob);
        }
        if (!entries.length) throw new Error('Não encontrei ficheiros para importar.');
        const bundles = await discoverSongBundles(entries);
        if (!bundles.length) throw new Error('Não encontrei uma combinação válida de chart e áudio. Inclua um áudio completo e uma chart suportada.');
        await requestPersistentStorage();
        const storedSongs = await dbGetAllSongs().catch(() => []);
        const results = [];
        for (let i = 0; i < bundles.length; i++) {
            setImportStatus(`A preparar ${i + 1} de ${bundles.length}: ${bundles[i].meta.name || 'música'}…`, 'busy');
            const installed = await installSongBundle(bundles[i], storedSongs);
            results.push(installed);
            storedSongs.push(installed.song);
        }
        await loadMenu(results[0] && results[0].song ? results[0].song.id : '', results[0] && results[0].song ? results[0].song.folder : '');
        const diskCount = results.filter(result => result.onDisk).length;
        const browserCount = results.filter(result => result.savedToBrowser && !result.onDisk).length;
        const sessionCount = results.filter(result => !result.savedToBrowser && !result.onDisk).length;
        let summary = `${results.length} música(s) importada(s) e pronta(s) para jogar.`;
        if (diskCount) summary += ` ${diskCount} gravada(s) na pasta Charts do disco.`;
        if (browserCount) summary += ` ${browserCount} guardada(s) na biblioteca local deste navegador (os dados do site podem ser limpos pelo navegador).`;
        if (sessionCount) summary += ` ${sessionCount} disponível(is) apenas até fechar esta aba; o armazenamento persistente falhou.`;
        const writeFailures = results.filter(result => !result.onDisk && result.song.diskWriteError).length;
        if (writeFailures) summary += ` Atenção: ${writeFailures} música(s) não puderam ser gravadas em Charts; reveja a permissão da pasta e tente importar novamente.`;
        const trimmed = results.map(result => result.song.trimMs || 0).filter(value => value > 0);
        if (trimmed.length) summary += ` Silêncio inicial removido e chart alinhada em ${trimmed.map(value => `${(value / 1000).toFixed(2)} s`).join(', ')}.`;
        if (results.some(result => result.song.audioIsStem)) summary += ' Aviso: pelo menos uma importação só tinha faixas separadas; confirme se o áudio principal completo está incluído.';
        setImportStatus(summary, sessionCount ? 'error' : 'success');
    } catch (error) {
        console.error('Erro ao importar música:', error);
        setImportStatus(error.message || 'Não foi possível importar estes ficheiros.', 'error');
    }
}

function findAudioReference(meta) {
    const raw = meta && (meta.audiofilename || meta.musicfile || meta.audio || meta.music || meta.file);
    return cleanRelativePath(raw || '');
}
function isStemAudioName(name) {
    const base = baseNameWithoutExtension(name);
    return /(^|[\s._-])(guitar|rhythm|drums?|bass|vocals?|lead|keys|keyboard|stem|instrumental|preview|sample)(?=$|[\s._-])/i.test(base);
}
function scoreAudioMatch(chartEntry, audioEntry, reference = '') {
    const chartPath = cleanRelativePath(chartEntry.path);
    const audioPath = cleanRelativePath(audioEntry.path);
    const chartDir = pathDirectory(chartPath);
    const audioDir = pathDirectory(audioPath);
    const chartBase = baseNameWithoutExtension(chartPath);
    const audioBase = baseNameWithoutExtension(audioPath);
    const stem = isStemAudioName(audioBase);
    let score = commonPartsCount(chartPath, audioPath) * 100 - Math.abs(pathParts(chartDir).length - pathParts(audioDir).length) * 18;
    if (chartBase === audioBase) score += 600;
    if (reference) {
        const ref = reference.toLowerCase();
        const exact = audioPath.toLowerCase() === ref || audioPath.toLowerCase().endsWith('/' + ref);
        const baseMatch = audioBase === baseNameWithoutExtension(ref);
        if (exact) score += stem ? 350 : 2200;
        if (baseMatch) score += stem ? 250 : 1500;
    }
    if (/^(audio|song|music|full|main|complete|backing|track|songfile)$/.test(audioBase)) score += 520;
    if (stem) score -= 1000;
    return score;
}
function metadataPriority(entry) {
    const name = (pathParts(entry.path).pop() || '').toLowerCase();
    return ({ 'guitar-browser.json': 70, 'song.ini': 60, 'music.txt': 55, 'song.txt': 54, 'metadata.json': 50, 'metadata.txt': 49, 'song.json': 48, 'info.ini': 42, 'songinfo.txt': 41, 'info.txt': 40 })[name] || 0;
}
async function closestMetadata(entries, chartEntry) {
    const candidates = entries.filter(isMetadataEntry).map(entry => {
        const shared = commonPartsCount(chartEntry.path, entry.path);
        const depths = Math.abs(pathParts(pathDirectory(chartEntry.path)).length - pathParts(pathDirectory(entry.path)).length);
        return { entry, score: shared * 100 - depths * 15 + metadataPriority(entry) };
    }).sort((a, b) => b.score - a.score);
    if (!candidates.length) return { entry: null, meta: {} };
    try {
        const entry = candidates[0].entry;
        return { entry, meta: parseMetadataText(await textFromEntry(entry), fileExtension(entry.path)) };
    } catch (_) { return { entry: null, meta: {} }; }
}

function chartFormatPriority(entry, parsed) {
    const ext = fileExtension(entry.path);
    const order = { chart: 100, mid: 90, midi: 90, bms: 85, bme: 85, bml: 85, ssc: 82, sm: 80, osu: 80, json: 70, txt: 60 };
    const name = (pathParts(entry.path).pop() || '').toLowerCase();
    const difficultyName = /expert|challenge|edit/.test(name) ? 8 : /hard/.test(name) ? 6 : /medium/.test(name) ? 4 : /easy|beginner/.test(name) ? 2 : 0;
    return (order[ext] || 0) + difficultyName + Math.min(30, Math.floor((parsed.notes || []).length / 250));
}

function shiftParsedChart(parsed, shiftMs) {
    const delta = Number(shiftMs) || 0;
    if (!parsed || !delta) return parsed;
    const notes = [];
    for (const note of parsed.notes || []) {
        const originalStart = Number(note.time) || 0;
        const originalEnd = Number.isFinite(Number(note.end)) ? Number(note.end) : originalStart;
        const shiftedStart = originalStart + delta;
        const shiftedEnd = originalEnd + delta;
        if (shiftedEnd < 0) continue;
        notes.push({ ...note, time: Math.max(0, shiftedStart), end: Math.max(0, shiftedEnd) });
    }
    return { ...parsed, notes, spPhrases: Array.isArray(parsed.spPhrases) ? parsed.spPhrases.map(phrase => ({ ...phrase })) : [] };
}

function encodeAudioBufferAsWav(audioBuffer, startFrame = 0) {
    const channelCount = Math.max(1, Math.min(2, audioBuffer.numberOfChannels || 1));
    const sampleRate = audioBuffer.sampleRate;
    const frames = Math.max(0, audioBuffer.length - startFrame);
    const bytesPerSample = 2;
    const dataSize = frames * channelCount * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeText = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    writeText(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeText(8, 'WAVE');
    writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
    view.setUint16(32, channelCount * bytesPerSample, true); view.setUint16(34, 16, true);
    writeText(36, 'data'); view.setUint32(40, dataSize, true);
    const channels = [];
    for (let channel = 0; channel < channelCount; channel++) channels.push(audioBuffer.getChannelData(channel));
    let offset = 44;
    for (let frame = startFrame; frame < audioBuffer.length; frame++) {
        for (let channel = 0; channel < channelCount; channel++) {
            const sample = Math.max(-1, Math.min(1, channels[channel][frame] || 0));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += bytesPerSample;
        }
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

async function trimLeadingSilence(audioBlob) {
    if (!(audioBlob instanceof Blob) || !audioBlob.size || audioBlob.size > 120 * 1024 * 1024) return { blob: audioBlob, trimMs: 0 };
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return { blob: audioBlob, trimMs: 0 };
    let context = null;
    try {
        context = new AudioContextClass();
        const decoded = await context.decodeAudioData(await audioBlob.arrayBuffer());
        const sampleRate = decoded.sampleRate;
        const windowFrames = Math.max(1, Math.floor(sampleRate * 0.02));
        const maxFrames = Math.min(decoded.length, Math.floor(sampleRate * 10));
        const channelCount = Math.max(1, decoded.numberOfChannels);
        const channels = [];
        for (let channel = 0; channel < channelCount; channel++) channels.push(decoded.getChannelData(channel));
        const rmsValues = [];
        let maxRms = 0;
        for (let start = 0; start < maxFrames; start += windowFrames) {
            const end = Math.min(maxFrames, start + windowFrames);
            let sum = 0;
            let count = 0;
            for (let frame = start; frame < end; frame++) {
                for (const channel of channels) {
                    const sample = channel[frame] || 0;
                    sum += sample * sample;
                    count++;
                }
            }
            const rms = count ? Math.sqrt(sum / count) : 0;
            rmsValues.push(rms);
            if (rms > maxRms) maxRms = rms;
        }
        if (maxRms < 0.002) return { blob: audioBlob, trimMs: 0 };
        const threshold = Math.max(0.00065, maxRms * 0.018);
        let activeWindow = -1;
        for (let i = 0; i < rmsValues.length - 1; i++) {
            if (rmsValues[i] >= threshold && rmsValues[i + 1] >= threshold) { activeWindow = i; break; }
        }
        if (activeWindow < 0) return { blob: audioBlob, trimMs: 0 };
        const prerollFrames = Math.floor(sampleRate * 0.01);
        const trimFrames = Math.max(0, activeWindow * windowFrames - prerollFrames);
        const trimMs = Math.round(trimFrames * 1000 / sampleRate);
        if (trimMs < 180 || trimMs > 10000 || decoded.length - trimFrames < sampleRate * 2) return { blob: audioBlob, trimMs: 0 };
        return { blob: encodeAudioBufferAsWav(decoded, trimFrames), trimMs };
    } catch (error) {
        console.warn('Não foi possível detetar/remover o silêncio inicial; o áudio original será preservado.', error);
        return { blob: audioBlob, trimMs: 0 };
    } finally {
        if (context) { try { await context.close(); } catch (_) {} }
    }
}

async function discoverSongBundles(entries, options = {}) {
    const chartEntries = entries.filter(isChartEntry);
    const audioEntries = entries.filter(isAudioEntry);
    if (!chartEntries.length) return [];
    if (!audioEntries.length) throw new Error('Encontrei chart(s), mas nenhum áudio. Inclua um ficheiro completo MP3, OGG, WAV, M4A ou outro formato suportado.');

    const groups = new Map();
    const failures = [];
    for (const chartEntry of chartEntries) {
        let parsed;
        try { parsed = await parseChartEntry(chartEntry); }
        catch (error) { failures.push(`${chartEntry.name}: ${error.message || error}`); continue; }
        if (!parsed.notes || !parsed.notes.length) { failures.push(`${chartEntry.name}: não contém notas jogáveis`); continue; }
        const metadata = await closestMetadata(entries, chartEntry);
        const combinedMeta = { ...parsed.meta, ...metadata.meta };
        const reference = findAudioReference(combinedMeta);
        const audioEntry = [...audioEntries].sort((a, b) => scoreAudioMatch(chartEntry, b, reference) - scoreAudioMatch(chartEntry, a, reference))[0];
        if (!audioEntry) continue;
        const root = commonDirectory(chartEntry.path, audioEntry.path);
        const key = `${root.toLowerCase()}\u0000${audioEntry.path.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, { root, audio: audioEntry, charts: [], metadata: [] });
        const group = groups.get(key);
        group.charts.push({ entry: chartEntry, parsed });
        if (metadata.entry && !group.metadata.some(item => item.path === metadata.entry.path)) group.metadata.push(metadata.entry);
    }

    const groupList = [...groups.values()];
    const bundles = [];
    for (const group of groupList) {
        group.charts.sort((a, b) => chartFormatPriority(b.entry, b.parsed) - chartFormatPriority(a.entry, a.parsed));
        const chosen = group.charts[0];
        if (!chosen) continue;
        const chartMeta = chosen.parsed.meta || {};
        const metadata = group.metadata.map(entry => ({ entry, priority: metadataPriority(entry) })).sort((a, b) => b.priority - a.priority)[0];
        let rawMeta = { ...chartMeta };
        if (metadata) {
            try { rawMeta = { ...rawMeta, ...parseMetadataText(await textFromEntry(metadata.entry), fileExtension(metadata.entry.path)) }; } catch (_) {}
        }
        const fallbackName = pathParts(group.root).pop() || baseNameWithoutExtension(chosen.entry.path) || 'Nova música';
        const meta = normalizeSongMeta(rawMeta, fallbackName);
        const relevant = entries.filter(entry => pathStartsWith(entry.path, group.root));
        const otherSongRoots = groupList.some(other => other !== group && other.root && group.root && other.root.toLowerCase() !== group.root.toLowerCase() && pathStartsWith(other.root, group.root));
        let coverEntry = relevant.filter(isImageEntry).sort((a, b) => {
            const rank = entry => {
                const name = (pathParts(entry.path).pop() || '').toLowerCase();
                return (/^(cover|capa|album|art|albumart|front)/.test(name) ? 100 : /background|banner/.test(name) ? 60 : 0) - Math.min(20, Math.floor((entry.blob.size || 0) / 1000000));
            };
            return rank(b) - rank(a);
        })[0] || null;
        const selectedSet = new Set([chosen.entry.path, group.audio.path, coverEntry && coverEntry.path, metadata && metadata.entry.path].filter(Boolean).map(path => path.toLowerCase()));
        let bundleEntries;
        if (!otherSongRoots) {
            bundleEntries = relevant;
        } else {
            bundleEntries = relevant.filter(entry => selectedSet.has(entry.path.toLowerCase()) ||
                (pathDirectory(entry.path).toLowerCase() === pathDirectory(chosen.entry.path).toLowerCase() && !isAudioEntry(entry) && !isChartEntry(entry)) ||
                (pathDirectory(entry.path).toLowerCase() === pathDirectory(group.audio.path).toLowerCase() && !isAudioEntry(entry) && !isChartEntry(entry)));
        }
        for (const required of [chosen.entry, group.audio, coverEntry, metadata && metadata.entry]) {
            if (required && !bundleEntries.some(entry => entry.path.toLowerCase() === required.path.toLowerCase())) bundleEntries.push(required);
        }
        const relChart = relativeToRoot(chosen.entry.path, group.root);
        const relAudio = relativeToRoot(group.audio.path, group.root);
        const relCover = coverEntry ? relativeToRoot(coverEntry.path, group.root) : '';
        const files = [];
        const seenPaths = new Set();
        for (const entry of bundleEntries) {
            let relativePath = relativeToRoot(entry.path, group.root);
            relativePath = cleanRelativePath(relativePath);
            if (!relativePath || seenPaths.has(relativePath.toLowerCase())) continue;
            seenPaths.add(relativePath.toLowerCase());
            files.push({ path: relativePath, name: pathParts(relativePath).pop(), blob: entry.blob, type: entry.type || entry.blob.type || '' });
        }
        const chartBlob = chosen.entry.blob;
        let parsed = shiftParsedChart(chosen.parsed, meta.chartTimeShiftMs);
        let audioBlob = options.lazyAudio ? group.audio.blob : await normalizeAudioBlob(group.audio.blob, group.audio.path);
        let audioName = relAudio;
        let trimMs = 0;
        if (options.autoTrim !== false) {
            const trimmed = await trimLeadingSilence(audioBlob);
            if (trimmed.trimMs > 0) {
                audioBlob = trimmed.blob;
                trimMs = trimmed.trimMs;
                parsed = shiftParsedChart(parsed, -trimMs);
                meta.chartTimeShiftMs = (Number(meta.chartTimeShiftMs) || 0) - trimMs;
                audioName = relAudio.replace(/\.[^./]+$/, '') + '.wav';
            }
        }
        const coverBlob = coverEntry ? coverEntry.blob : null;
        bundles.push({
            meta,
            parsed,
            chartBlob,
            chartExt: fileExtension(chosen.entry.path),
            chartName: relChart,
            audioBlob,
            audioName,
            trimMs,
            coverBlob,
            coverName: relCover,
            audioIsStem: isStemAudioName(group.audio.path),
            files,
            sourceRoot: group.root
        });
    }
    if (!bundles.length) {
        const sample = failures.slice(0, 3).join(' | ');
        throw new Error(`Não consegui converter nenhuma chart. ${sample ? `Detalhes: ${sample}` : 'Confirme se o áudio e a chart estão na mesma pasta ou dentro de subpastas da mesma música.'}`);
    }
    return bundles;
}

async function installSongBundle(bundle, existingSongs = []) {
    const folderName = await allocateFolderName(bundle.meta.name, existingSongs);
    const folder = `Charts/${folderName}`;
    const audioBlob = await normalizeAudioBlob(bundle.audioBlob);
    const record = {
        id: makeSongId(),
        imported: true,
        name: bundle.meta.name || folderName,
        artist: bundle.meta.artist || '',
        year: bundle.meta.year || '',
        album: bundle.meta.album || '',
        genre: bundle.meta.genre || '',
        charter: bundle.meta.charter || '',
        description: bundle.meta.description || '',
        chartTimeShiftMs: Number(bundle.meta.chartTimeShiftMs || 0) || 0,
        trimMs: Number(bundle.trimMs || 0) || 0,
        audioIsStem: !!bundle.audioIsStem,
        folder,
        folderName,
        chartName: bundle.chartName,
        chartExt: bundle.chartExt,
        chartBlob: bundle.chartBlob,
        audioName: bundle.audioName,
        audioBlob,
        coverName: bundle.coverName || '',
        coverBlob: bundle.coverBlob || null,
        chartData: serializeChartData(bundle.parsed),
        files: bundle.files.filter(file => !isAudioEntry(file) && ![bundle.chartName, bundle.audioName, bundle.coverName].filter(Boolean).some(corePath => cleanRelativePath(corePath).toLowerCase() === cleanRelativePath(file.path).toLowerCase())),
        importedAt: new Date().toISOString()
    };

    let savedToBrowser = false;
    try {
        await dbSaveSong(record);
        savedToBrowser = true;
        sessionImportedSongs = sessionImportedSongs.filter(song => song.id !== record.id).concat(record);
    } catch (error) {
        console.warn('A biblioteca IndexedDB não conseguiu guardar a música:', error);
        sessionImportedSongs.push(record);
    }

    let onDisk = false;
    if (chartsDirectoryHandle) {
        try {
            let permission = chartsDirectoryHandle.queryPermission ? await chartsDirectoryHandle.queryPermission({ mode: 'readwrite' }) : 'granted';
            if (permission !== 'granted' && chartsDirectoryHandle.requestPermission) permission = await chartsDirectoryHandle.requestPermission({ mode: 'readwrite' });
            if (permission !== 'granted') throw new Error('A permissão da pasta expirou. Ligue novamente a pasta GuitarBrowser.');
            await writeBundleToCharts(record, chartsDirectoryHandle, projectDirectoryHandle);
            onDisk = true;
        } catch (error) {
            console.warn('Falha ao gravar na pasta Charts:', error);
            record.diskWriteError = error.message || String(error);
        }
    }
    return { song: record, onDisk, savedToBrowser };
}

function serializeChartData(parsed) {
    return {
        difficulty: parsed.difficulty || '',
        track: parsed.track || '',
        resolution: parsed.resolution || 0,
        offset: parsed.offset || 0,
        notes: (parsed.notes || []).map(note => ({
            time: Number(note.time) || 0,
            end: Number(note.end) || Number(note.time) || 0,
            fret: Number.isFinite(Number(note.fret)) ? Number(note.fret) : FRET_ORDER.indexOf(note.lane),
            lane: note.lane || FRET_ORDER[Number(note.fret)] || 'green',
            star: !!note.star,
            phrase: Number.isFinite(note.phrase) ? note.phrase : -1,
            tick: Number.isFinite(note.tick) ? note.tick : undefined
        })),
        spPhrases: (parsed.spPhrases || []).map(phrase => ({ total: phrase.total || 0, startTick: phrase.startTick || 0, endTick: phrase.endTick || 0 }))
    };
}

async function writeBundleToCharts(record, chartsHandle, projectHandle) {
    if (!chartsHandle) throw new Error('A pasta Charts não está ligada.');
    const songDir = await chartsHandle.getDirectoryHandle(record.folderName, { create: true });
    const files = Array.isArray(record.files) ? record.files : [];
    for (const file of files) await writeFileAtPath(songDir, file.path, file.blob);
    await writeFileAtPath(songDir, record.chartName, record.chartBlob);
    await writeFileAtPath(songDir, record.audioName, record.audioBlob);
    if (record.coverBlob && record.coverName) await writeFileAtPath(songDir, record.coverName, record.coverBlob);
    const manifest = {
        name: record.name,
        artist: record.artist,
        year: record.year,
        album: record.album,
        genre: record.genre,
        charter: record.charter,
        description: record.description,
        chart: record.chartName,
        audio: record.audioName,
        cover: record.coverName || undefined,
        chartFormat: record.chartExt,
        chartTimeShiftMs: Number(record.chartTimeShiftMs || 0) || 0
    };
    await writeFileAtPath(songDir, 'guitar-browser.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    if (projectHandle) await appendSongToIndex(projectHandle, record.folder);
}

async function writeFileAtPath(rootHandle, relativePath, blob) {
    const segments = pathParts(relativePath);
    if (!segments.length) return;
    let directory = rootHandle;
    for (let i = 0; i < segments.length - 1; i++) directory = await directory.getDirectoryHandle(segments[i], { create: true });
    const fileHandle = await directory.getFileHandle(segments[segments.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}

async function appendSongToIndex(projectHandle, folderPath) {
    const fileHandle = await projectHandle.getFileHandle('songs.json', { create: true });
    let rows = [];
    try {
        const text = await (await fileHandle.getFile()).text();
        const parsed = JSON.parse(text || '[]');
        if (Array.isArray(parsed)) rows = parsed;
    } catch (_) { rows = []; }
    const target = cleanRelativePath(folderPath).toLowerCase();
    if (!rows.some(row => cleanRelativePath(row.folder || '').toLowerCase() === target)) rows.push({ folder: cleanRelativePath(folderPath) });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }));
    await writable.close();
}

async function normalizeAudioBlob(inputBlob, sourceName = '') {
    const blob = inputBlob instanceof Blob ? inputBlob : new Blob([inputBlob]);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let type = (blob.type || '').toLowerCase().split(';')[0];
    if (bytes.length >= 4) {
        if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) type = 'audio/ogg';
        else if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) type = 'audio/flac';
        else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes.length >= 12 && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE') type = 'audio/wav';
        else if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) type = 'audio/mpeg';
        else if (bytes[0] === 0x66 && bytes[1] === 0x74 && bytes[2] === 0x79 && bytes[3] === 0x70) type = 'audio/mp4';
        else if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) type = 'audio/webm';
        else if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) type = 'audio/aac';
        else if (type === 'application/octet-stream' || type === 'application/x-octet-stream') type = '';
    }
    if (!type || !type.startsWith('audio/')) {
        const extType = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/ogg', webm: 'audio/webm', wma: 'audio/x-ms-wma' }[fileExtension(blob.name || sourceName)];
        type = extType || 'application/octet-stream';
    }
    return new Blob([buffer], { type });
}

// ==========================================
// MENU MINIMALISTA, PESQUISA, EDIÇÃO E REMOÇÃO
// ==========================================
function injectMenuStyles() {
    if (document.getElementById('gb-menu-style')) return;
    const style = document.createElement('style');
    style.id = 'gb-menu-style';
    style.textContent = `
        #menu-container { background:#232427; color:#e7e8eb; }
        #menu-container .sidebar.gb-sidebar { width:56px; min-width:56px; background:#1e1f22; border-right:1px solid #383a3e; box-shadow:none; }
        #menu-container #gear-icon { fill:#b9bbc0; }
        #menu-container #gear-icon:hover { fill:#fff; }
        #menu-container .song-list-container { background:#252629; border-right:1px solid #3a3b3f; padding:18px 20px; }
        #menu-container #song-list { gap:9px; }
        #menu-container .song-item { background:#2e3033; border:1px solid #3d3f43; border-radius:8px; box-shadow:none; padding:9px; transition:background .15s,border-color .15s; }
        #menu-container .song-item:hover, #menu-container .song-item.active { background:#383a3f; border-color:#63666d; transform:none; }
        #menu-container .song-item img { width:58px; height:58px; border-radius:6px; margin-right:12px; }
        #menu-container .song-info h2 { color:#f1f2f4; font-size:1rem; }
        #menu-container .song-info p { color:#a7a9ae; font-size:.78rem; }
        #menu-container .song-details-container { background:#292a2d; padding:30px; }
        #menu-container #detail-cover { width:min(300px, 62vw); height:auto; aspect-ratio:1; border-radius:8px; box-shadow:0 8px 22px rgba(0,0,0,.25); }
        #menu-container #detail-title { color:#f1f2f4; background:#383a3e !important; padding:10px 16px; border-radius:7px; font-size:1.35rem; margin:4px 0 9px; }
        #gb-detail-subtitle { color:#aeb0b5; font-size:.85rem; line-height:1.5; margin:0 0 16px; min-height:1.2em; }
        #menu-container #btn-jogar { background:#4a4c51; border:1px solid #606267; border-radius:7px; box-shadow:none; padding:12px 44px; font-size:1.05rem; }
        #menu-container #btn-jogar:hover { background:#5b5d62; transform:translateY(-1px); }
        #gb-song-toolbar { position:sticky; top:-18px; z-index:2; display:flex; align-items:center; gap:10px; margin:-18px -20px 14px; padding:14px 20px 12px; background:#252629; border-bottom:1px solid #3b3d41; }
        #gb-search-box { min-width:0; flex:1; display:flex; align-items:center; gap:9px; padding:0 12px; height:42px; border:1px solid #45474c; border-radius:8px; background:#1f2023; color:#c8c9cd; }
        #gb-search-box:focus-within { border-color:#85888f; box-shadow:0 0 0 2px rgba(180,183,190,.1); }
        #gb-search-box svg { width:18px; height:18px; flex:0 0 auto; color:#9b9da3; }
        #gb-song-search { flex:1; min-width:0; height:100%; border:0; outline:0; background:transparent; color:#f4f4f5; font:inherit; font-size:.9rem; user-select:text; }
        #gb-song-search::placeholder { color:#898b91; }
        #gb-clear-search { display:none; border:0; background:transparent; color:#aeb0b4; font-size:1.2rem; cursor:pointer; padding:2px 4px; }
        #gb-song-count { flex:0 0 auto; color:#96989e; font-size:.76rem; white-space:nowrap; }
        #gb-no-results { padding:30px 12px; text-align:center; color:#a7a9ae; font-size:.9rem; }
        .gb-song-actions { display:flex; justify-content:center; gap:9px; margin-top:12px; }
        .gb-song-action { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; padding:8px 12px; border:1px solid #4a4c51; border-radius:7px; background:#323438; color:#e6e7e9; font:inherit; font-size:.8rem; cursor:pointer; }
        .gb-song-action:hover { background:#414348; border-color:#6a6d73; }
        .gb-song-action svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
        .gb-song-action.remove:hover { background:#473638; border-color:#75585b; color:#ffe5e6; }
        #gb-edit-modal { position:fixed; inset:0; z-index:1350; display:none; align-items:center; justify-content:center; padding:18px; background:rgba(0,0,0,.78); color:#eee; font-family:inherit; }
        #gb-edit-dialog { width:min(520px,100%); max-height:90vh; overflow:auto; padding:24px; border:1px solid #484a4f; border-radius:12px; background:#252629; box-shadow:0 18px 70px rgba(0,0,0,.55); }
        #gb-edit-dialog header { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:16px; }
        #gb-edit-dialog h2 { margin:0; font-size:1.2rem; }
        #gb-edit-close { border:0; background:transparent; color:#bbb; font-size:1.5rem; cursor:pointer; }
        .gb-edit-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .gb-edit-field { display:flex; flex-direction:column; gap:5px; color:#b8bac0; font-size:.78rem; }
        .gb-edit-field.wide { grid-column:1/-1; }
        .gb-edit-field input, .gb-edit-field textarea { width:100%; padding:10px 11px; border:1px solid #45474c; border-radius:7px; outline:0; background:#1e1f22; color:#f4f4f5; font:inherit; font-size:.9rem; user-select:text; }
        .gb-edit-field textarea { min-height:72px; resize:vertical; }
        .gb-edit-field input:focus, .gb-edit-field textarea:focus { border-color:#8d9097; }
        .gb-edit-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:18px; }
        .gb-edit-actions button { padding:9px 15px; border:1px solid #4c4e53; border-radius:7px; background:#34363a; color:#eee; font:inherit; cursor:pointer; }
        .gb-edit-actions button.primary { background:#4a4c51; }
        .gb-edit-actions button:hover { background:#505258; }
        @media (max-width:760px) { #menu-container .song-details-container { padding:18px; } #menu-container #detail-cover { width:min(220px,54vw); } #gb-song-toolbar { gap:7px; } #gb-song-count { font-size:.68rem; } }
        @media (max-width:500px) { #menu-container .song-list-container { padding:12px; } #gb-song-toolbar { top:-12px; margin:-12px -12px 10px; padding:10px 12px; } #menu-container .song-item img { width:48px; height:48px; } #gb-song-count { display:none; } .gb-edit-grid { grid-template-columns:1fr; } .gb-edit-field.wide { grid-column:auto; } }
    `;
    document.head.appendChild(style);
}

function setupSearchUi() {
    const listContainer = document.getElementById('song-list');
    const holder = listContainer && listContainer.parentElement;
    if (!holder || document.getElementById('gb-song-toolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.id = 'gb-song-toolbar';
    toolbar.innerHTML = '<label id="gb-search-box" for="gb-song-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4.1 4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><input id="gb-song-search" type="search" autocomplete="off" placeholder="Buscar música, artista ou ano…" aria-label="Buscar por música, artista ou ano"><button id="gb-clear-search" type="button" aria-label="Limpar busca">×</button></label><span id="gb-song-count" aria-live="polite"></span>';
    holder.insertBefore(toolbar, listContainer);
    const input = toolbar.querySelector('#gb-song-search');
    const clear = toolbar.querySelector('#gb-clear-search');
    input.addEventListener('input', () => {
        songSearchTerm = normalizeForSearch(input.value);
        clear.style.display = input.value ? 'block' : 'none';
        renderSongList();
    });
    clear.addEventListener('click', () => {
        input.value = '';
        songSearchTerm = '';
        clear.style.display = 'none';
        renderSongList();
        input.focus();
    });
}

function setupSongActions() {
    const details = document.querySelector('.details-content');
    const playButton = document.getElementById('btn-jogar');
    if (!details || !playButton || document.getElementById('gb-song-actions')) return;
    const actions = document.createElement('div');
    actions.id = 'gb-song-actions';
    actions.className = 'gb-song-actions';
    actions.style.display = 'none';
    actions.innerHTML = '<button class="gb-song-action" id="gb-edit-song" type="button" title="Editar música"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>Editar</button><button class="gb-song-action remove" id="gb-remove-song" type="button" title="Remover música"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>Remover</button>';
    playButton.insertAdjacentElement('afterend', actions);
    actions.querySelector('#gb-edit-song').addEventListener('click', openEditSong);
    actions.querySelector('#gb-remove-song').addEventListener('click', removeSelectedSong);
}

function setupEditModal() {
    if (document.getElementById('gb-edit-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'gb-edit-modal';
    modal.innerHTML = `<section id="gb-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="gb-edit-title">
        <header><h2 id="gb-edit-title">Editar música</h2><button id="gb-edit-close" type="button" aria-label="Fechar">×</button></header>
        <form id="gb-edit-form"><div class="gb-edit-grid">
            <label class="gb-edit-field wide">Título<input name="name" maxlength="160" required></label>
            <label class="gb-edit-field">Artista<input name="artist" maxlength="160"></label>
            <label class="gb-edit-field">Ano<input name="year" maxlength="12" inputmode="numeric"></label>
            <label class="gb-edit-field">Álbum<input name="album" maxlength="160"></label>
            <label class="gb-edit-field">Género<input name="genre" maxlength="80"></label>
            <label class="gb-edit-field">Charter / autor<input name="charter" maxlength="160"></label>
            <label class="gb-edit-field wide">Descrição<textarea name="description" maxlength="500"></textarea></label>
        </div><div class="gb-edit-actions"><button type="button" id="gb-edit-cancel">Cancelar</button><button class="primary" type="submit">Guardar</button></div></form>
    </section>`;
    document.body.appendChild(modal);
    const close = () => { modal.style.display = 'none'; };
    modal.querySelector('#gb-edit-close').addEventListener('click', close);
    modal.querySelector('#gb-edit-cancel').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('#gb-edit-form').addEventListener('submit', saveEditedSong);
    editSongUi = { modal, form: modal.querySelector('#gb-edit-form') };
}

function openEditSong() {
    if (!currentSelectedSong || !editSongUi) return;
    const song = currentSelectedSong;
    for (const field of ['name', 'artist', 'year', 'album', 'genre', 'charter', 'description']) {
        const input = editSongUi.form.elements.namedItem(field);
        if (input) input.value = song[field] || '';
    }
    editSongUi.modal.style.display = 'flex';
    editSongUi.form.elements.namedItem('name').focus();
}

async function saveEditedSong(event) {
    event.preventDefault();
    if (!currentSelectedSong || !editSongUi) return;
    const form = editSongUi.form;
    const updated = { ...currentSelectedSong };
    for (const field of ['name', 'artist', 'year', 'album', 'genre', 'charter', 'description']) {
        const input = form.elements.namedItem(field);
        updated[field] = String(input && input.value || '').trim();
    }
    if (!updated.name) return;
    try {
        const overrides = await dbGetSetting('songOverrides').catch(() => ({})) || {};
        if (updated.folder) overrides[cleanRelativePath(updated.folder).toLowerCase()] = Object.fromEntries(['name', 'artist', 'year', 'album', 'genre', 'charter', 'description'].map(field => [field, updated[field]]));
        await dbSetSetting('songOverrides', overrides).catch(() => {});
        if (updated.id && updated.imported && !String(updated.id).startsWith('disk:')) {
            await dbSaveSong(updated);
            sessionImportedSongs = sessionImportedSongs.map(song => song.id === updated.id ? updated : song);
        }
        let savedToDisk = false;
        if (chartsDirectoryHandle && updated.folder) {
            const relative = cleanRelativePath(updated.folder).replace(/^charts\//i, '');
            if (relative) {
                let permission = chartsDirectoryHandle.queryPermission ? await chartsDirectoryHandle.queryPermission({ mode: 'readwrite' }) : 'granted';
                if (permission !== 'granted' && chartsDirectoryHandle.requestPermission) permission = await chartsDirectoryHandle.requestPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                    const manifest = {
                        name: updated.name, artist: updated.artist, year: updated.year, album: updated.album,
                        genre: updated.genre, charter: updated.charter, description: updated.description,
                        chart: updated.chartName || updated.chart || '', audio: updated.audioName || updated.audio || '',
                        cover: updated.coverName || updated.cover || undefined,
                        chartFormat: updated.chartExt || undefined,
                        chartTimeShiftMs: Number(updated.chartTimeShiftMs || 0) || 0
                    };
                    await writeFileAtPath(chartsDirectoryHandle, `${relative}/guitar-browser.json`, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
                    savedToDisk = true;
                }
            }
        }
        currentSelectedSong = updated;
        editSongUi.modal.style.display = 'none';
        await loadMenu('', updated.folder || '');
        if (!savedToDisk) window.alert('Alterações guardadas nesta biblioteca do navegador. Para gravar os metadados também na pasta local Charts, ligue a pasta GuitarBrowser nas opções de importação.');
    } catch (error) {
        console.error('Falha ao editar música:', error);
        window.alert(`Não foi possível guardar as alterações: ${error.message || error}`);
    }
}

async function removeSelectedSong() {
    const song = currentSelectedSong;
    if (!song) return;
    const folderPath = cleanRelativePath(song.folder || '');
    const confirmed = window.confirm(`Remover “${song.name || 'esta música'}” da biblioteca?${chartsDirectoryHandle ? '\n\nSe estiver na pasta Charts ligada, os ficheiros serão removidos do disco.' : '\n\nSem uma pasta local ligada, a música será removida da lista deste navegador.'}`);
    if (!confirmed) return;
    let deletedFromDisk = false;
    try {
        if (chartsDirectoryHandle && folderPath.toLowerCase().startsWith('charts/')) {
            let permission = chartsDirectoryHandle.queryPermission ? await chartsDirectoryHandle.queryPermission({ mode: 'readwrite' }) : 'granted';
            if (permission !== 'granted' && chartsDirectoryHandle.requestPermission) permission = await chartsDirectoryHandle.requestPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                await removeDirectoryAtPath(chartsDirectoryHandle, folderPath.slice('Charts/'.length));
                deletedFromDisk = true;
                localDiskSongs = localDiskSongs.filter(entry => cleanRelativePath(entry.folder).toLowerCase() !== folderPath.toLowerCase());
            }
        }
        if (projectDirectoryHandle && folderPath) await removeSongFromIndex(projectDirectoryHandle, folderPath).catch(error => console.warn('Não foi possível atualizar songs.json:', error));
        if (song.id && !String(song.id).startsWith('disk:')) await dbDeleteSong(song.id).catch(() => {});
        sessionImportedSongs = sessionImportedSongs.filter(entry => entry.id !== song.id);
        if (folderPath) {
            const hidden = await dbGetSetting('hiddenSongFolders').catch(() => []) || [];
            const key = folderPath.toLowerCase();
            if (!hidden.includes(key)) hidden.push(key);
            await dbSetSetting('hiddenSongFolders', hidden).catch(() => {});
            const overrides = await dbGetSetting('songOverrides').catch(() => ({})) || {};
            delete overrides[key];
            await dbSetSetting('songOverrides', overrides).catch(() => {});
        }
        currentSelectedSong = null;
        const cover = document.getElementById('detail-cover');
        const title = ensureDetailTitle();
        const subtitle = document.getElementById('gb-detail-subtitle');
        if (cover) { cover.style.display = 'none'; cover.src = ''; }
        if (title) { title.textContent = ''; title.style.display = 'none'; }
        if (subtitle) subtitle.textContent = '';
        if (btnJogar) btnJogar.style.display = 'none';
        const actions = document.getElementById('gb-song-actions');
        if (actions) actions.style.display = 'none';
        await loadMenu();
        if (!deletedFromDisk && chartsDirectoryHandle && folderPath.toLowerCase().startsWith('charts/')) {
            window.alert('A música saiu da lista deste navegador, mas a pasta não foi apagada do disco. Verifique a permissão da pasta Charts e remova-a manualmente se necessário.');
        } else if (!deletedFromDisk && !chartsDirectoryHandle) {
            window.alert('A música foi removida da lista deste navegador. Os ficheiros de uma instalação local não puderam ser apagados porque a pasta Charts não está ligada.');
        }
    } catch (error) {
        console.error('Falha ao remover música:', error);
        window.alert(`Não foi possível remover a música: ${error.message || error}`);
    }
}

async function removeDirectoryAtPath(rootHandle, relativePath) {
    const segments = pathParts(relativePath);
    if (!segments.length) return;
    let parent = rootHandle;
    for (let i = 0; i < segments.length - 1; i++) parent = await parent.getDirectoryHandle(segments[i], { create: false });
    try { await parent.removeEntry(segments[segments.length - 1], { recursive: true }); } catch (error) { if (!error || error.name !== 'NotFoundError') throw error; }
}

async function removeSongFromIndex(projectHandle, folderPath) {
    const fileHandle = await projectHandle.getFileHandle('songs.json', { create: false });
    const parsed = JSON.parse(await (await fileHandle.getFile()).text());
    const target = cleanRelativePath(folderPath).toLowerCase();
    const rows = Array.isArray(parsed) ? parsed.filter(row => cleanRelativePath(row.folder || '').toLowerCase() !== target) : [];
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }));
    await writable.close();
}


// ==========================================
// CONTROLADORES / JOYSTICKS
// ==========================================
let gamepadRaf = 0;
let gamepadCaptureLane = '';
let gamepadSeen = new Map();
let gamepadPrev = new Map();

function readGamepadBindings() {
    try {
        const saved = JSON.parse(localStorage.getItem('guitarBrowserGamepad') || 'null');
        const result = { ...DEFAULT_GAMEPAD_BINDINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
        for (const key of Object.keys(DEFAULT_GAMEPAD_BINDINGS)) {
            const value = Number(result[key]);
            result[key] = Number.isInteger(value) && value >= 0 && value <= 31 ? value : DEFAULT_GAMEPAD_BINDINGS[key];
        }
        return result;
    } catch (_) { return { ...DEFAULT_GAMEPAD_BINDINGS }; }
}

function saveGamepadBindings() {
    localStorage.setItem('guitarBrowserGamepad', JSON.stringify(gamepadBindings));
    if (gamepadSettingsUi) updateGamepadSettingsUi();
}

function setupGamepadSettingsUi() {
    const settings = document.querySelector('.settings-content');
    if (!settings || document.getElementById('gb-gamepad-settings')) return;
    const panel = document.createElement('section');
    panel.id = 'gb-gamepad-settings';
    panel.innerHTML = `<h3>Comando / joystick</h3>
        <p id="gb-gamepad-status" role="status">A procurar controladores…</p>
        <div class="gb-gamepad-row"><label for="gb-map-lane">Pista a mapear</label><select id="gb-map-lane"><option value="green">Verde</option><option value="red">Vermelha</option><option value="yellow">Amarela</option><option value="blue">Azul</option><option value="orange">Laranja</option><option value="star">Star Power</option></select></div>
        <div class="gb-gamepad-row"><button id="gb-map-capture" type="button">Mapear botão premindo-o</button></div>
        <div id="gb-gamepad-mappings"></div>
        <p class="gb-gamepad-hint">Se não houver um comando detetado, use as teclas de teclado configuradas acima. Os mapeamentos ficam guardados neste navegador.</p>`;
    const calibrate = document.getElementById('btn-calibrate');
    if (calibrate && calibrate.parentNode === settings) calibrate.insertAdjacentElement('afterend', panel);
    else settings.appendChild(panel);
    gamepadSettingsUi = {
        panel,
        status: panel.querySelector('#gb-gamepad-status'),
        mappings: panel.querySelector('#gb-gamepad-mappings'),
        lane: panel.querySelector('#gb-map-lane'),
        capture: panel.querySelector('#gb-map-capture')
    };
    const style = document.createElement('style');
    style.id = 'gb-gamepad-style';
    style.textContent = `
        #settings-modal { overflow:auto; padding:14px; box-sizing:border-box; }
        #settings-modal .settings-content { max-height:94vh; overflow:auto; background:#252629; border:1px solid #484a4f; color:#eee; box-sizing:border-box; }
        #settings-modal .settings-content h2 { margin:0 0 14px; }
        #settings-modal .settings-content h3 { margin:10px 0 8px; font-size:.94rem; }
        #settings-modal .key-config { color:#d6d7da; }
        #settings-modal .key-config input { background:#1c1d20; border:1px solid #55575d; color:#fff; padding:5px; border-radius:4px; }
        #settings-modal .settings-content button { margin:6px 4px 0; border:1px solid #55575d; border-radius:6px; background:#37393e; color:#eee; }
        #settings-modal .settings-content button:hover { background:#4a4c52; }
        #gb-gamepad-settings { margin-top:18px; padding-top:13px; border-top:1px solid #484a4f; text-align:left; }
        #gb-gamepad-settings p { margin:8px 0; color:#babcc2; font-size:.75rem; line-height:1.45; }
        #gb-gamepad-status { color:#d8d9dc !important; }
        #gb-gamepad-mappings { display:grid; grid-template-columns:1fr 1fr; gap:6px 10px; margin-top:9px; }
        .gb-gamepad-binding { display:flex; align-items:center; justify-content:space-between; gap:8px; color:#ddd; font-size:.76rem; }
        .gb-gamepad-binding select, #gb-map-lane { min-width:76px; padding:5px 7px; border:1px solid #55575d; border-radius:5px; background:#1e1f22; color:#eee; font:inherit; }
        .gb-gamepad-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; color:#ccc; font-size:.78rem; }
        #gb-map-capture { padding:7px 9px !important; font-size:.74rem !important; }
        @media (max-width:420px) { #gb-gamepad-mappings { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
    gamepadSettingsUi.capture.addEventListener('click', () => {
        gamepadCaptureLane = gamepadSettingsUi.lane.value;
        gamepadSettingsUi.capture.textContent = 'Agora prima um botão do comando…';
        if (gamepadSettingsUi.status) gamepadSettingsUi.status.textContent = 'À espera do botão escolhido no comando…';
    });
    updateGamepadSettingsUi();
}

function updateGamepadSettingsUi() {
    if (!gamepadSettingsUi) return;
    const pads = typeof navigator.getGamepads === 'function' ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    const count = pads.length;
    gamepadSettingsUi.status.textContent = count
        ? `${count} comando${count === 1 ? '' : 's'} detetado${count === 1 ? '' : 's'}: ${pads.map(pad => pad.id || 'Gamepad').join(' · ')}`
        : 'Nenhum comando detetado. As teclas de teclado configuradas acima continuam disponíveis.';
    gamepadSettingsUi.mappings.textContent = '';
    const labels = { green: 'Verde', red: 'Vermelha', yellow: 'Amarela', blue: 'Azul', orange: 'Laranja', star: 'Star Power' };
    for (const lane of Object.keys(DEFAULT_GAMEPAD_BINDINGS)) {
        const row = document.createElement('label');
        row.className = 'gb-gamepad-binding';
        const title = document.createElement('span');
        title.textContent = labels[lane];
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Botão para ${labels[lane]}`);
        for (let button = 0; button < 32; button++) {
            const option = document.createElement('option');
            option.value = String(button);
            option.textContent = `Botão ${button}`;
            select.appendChild(option);
        }
        select.value = String(gamepadBindings[lane]);
        select.addEventListener('change', () => {
            gamepadBindings[lane] = Number(select.value);
            gamepadPrev.clear();
            saveGamepadBindings();
        });
        row.append(title, select);
        gamepadSettingsUi.mappings.appendChild(row);
    }
}

function gamepadLaneDown(lane) {
    if (calState && calState.running) { calRegisterPress(); return; }
    if (!FRET_ORDER.includes(lane)) return;
    activeKeys[lane] = true;
    const button = document.getElementById(`btn-${lane}`);
    if (button) button.classList.add('pressed');
    tryHit(lane);
}
function gamepadLaneUp(lane) {
    if (!FRET_ORDER.includes(lane)) return;
    activeKeys[lane] = false;
    const button = document.getElementById(`btn-${lane}`);
    if (button) button.classList.remove('pressed');
}
function gamepadStarDown() {
    if (calState && calState.running) { calRegisterPress(); return; }
    activateStarPower();
}

function pollGamepads() {
    if (typeof navigator.getGamepads === 'function') {
        let gamepads = [];
        try { gamepads = Array.from(navigator.getGamepads()).filter(pad => pad && pad.connected); } catch (_) {}
        const connected = new Map(gamepads.map(pad => [pad.index, pad]));
        const currentIds = [...connected.values()].map(pad => pad.id || `Gamepad ${pad.index}`).join('|');
        const previousIds = [...gamepadSeen.values()].map(pad => pad.id || `Gamepad ${pad.index}`).join('|');
        if (currentIds !== previousIds) {
            for (const lane of FRET_ORDER) if (gamepadPrev.get(`active:${lane}`)) gamepadLaneUp(lane);
            gamepadPrev.clear();
            gamepadSeen = connected;
            updateGamepadSettingsUi();
        } else gamepadSeen = connected;
        const pressedNow = new Map();
        for (const pad of gamepads) {
            const buttons = pad.buttons || [];
            const getPressed = index => !!(buttons[index] && (buttons[index].pressed || buttons[index].value > 0.55));
            for (const lane of FRET_ORDER) {
                const buttonIndex = gamepadBindings[lane];
                if (getPressed(buttonIndex)) pressedNow.set(lane, true);
            }
            if (getPressed(gamepadBindings.star)) pressedNow.set('star', true);
            if (gamepadCaptureLane) {
                let captured = -1;
                for (let i = 0; i < buttons.length; i++) {
                    const wasPressed = !!gamepadPrev.get(`${pad.index}:${i}`);
                    if (getPressed(i) && !wasPressed) { captured = i; break; }
                }
                if (captured >= 0) {
                    gamepadBindings[gamepadCaptureLane] = captured;
                    gamepadCaptureLane = '';
                    gamepadPrev.clear();
                    saveGamepadBindings();
                    if (gamepadSettingsUi && gamepadSettingsUi.capture) gamepadSettingsUi.capture.textContent = 'Mapear botão premindo-o';
                    if (gamepadSettingsUi && gamepadSettingsUi.status) gamepadSettingsUi.status.textContent = `Mapeamento guardado: botão ${captured}.`;
                }
            }
            for (let i = 0; i < buttons.length; i++) gamepadPrev.set(`${pad.index}:${i}`, getPressed(i));
        }
        for (const lane of [...FRET_ORDER, 'star']) {
            const active = !!pressedNow.get(lane);
            const wasActive = !!gamepadPrev.get(`active:${lane}`);
            if (active && !wasActive) {
                if (lane === 'star') gamepadStarDown(); else gamepadLaneDown(lane);
            } else if (!active && wasActive && lane !== 'star') gamepadLaneUp(lane);
            gamepadPrev.set(`active:${lane}`, active);
        }
    }
    gamepadRaf = requestAnimationFrame(pollGamepads);
}

window.addEventListener('gamepadconnected', () => updateGamepadSettingsUi());
window.addEventListener('gamepaddisconnected', () => updateGamepadSettingsUi());


injectMenuStyles();
setupImportUi();
setupSearchUi();
setupSongActions();
setupEditModal();
setupGamepadSettingsUi();
loadMenu();

// ==========================================
// PARSERS DE CHART: Clone Hero, MIDI, StepMania, osu!mania, BMS e JSON
// ==========================================
function makeGameNote(fretOrLane, time, end = time, extras = {}) {
    let fret = typeof fretOrLane === 'string' ? FRET_ORDER.indexOf(fretOrLane.toLowerCase()) : Number(fretOrLane);
    if (!Number.isFinite(fret) || fret < 0 || fret > 4) fret = 0;
    return {
        ...extras,
        fret,
        lane: FRET_ORDER[fret],
        time: Number(time) || 0,
        end: Number.isFinite(Number(end)) ? Number(end) : (Number(time) || 0),
        star: !!extras.star,
        phrase: Number.isFinite(extras.phrase) ? extras.phrase : -1,
        el: null,
        spawned: false,
        hit: false,
        missed: false,
        done: false,
        holding: false
    };
}
function orderNotes(notes) { return notes.sort((a, b) => a.time - b.time || a.fret - b.fret); }
function chartSectionDifficulty(name) {
    const lower = String(name || '').toLowerCase();
    if (/expert/.test(lower)) return { rank: 4, label: 'Expert' };
    if (/hard/.test(lower)) return { rank: 3, label: 'Hard' };
    if (/medium/.test(lower)) return { rank: 2, label: 'Medium' };
    if (/easy|beginner/.test(lower)) return { rank: 1, label: 'Easy' };
    return { rank: 2, label: 'Normal' };
}
function parsePropertyBlock(lines) {
    const result = {};
    for (const line of lines || []) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim().toLowerCase();
        const value = line.slice(eq + 1).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
        if (key) result[key] = value;
    }
    return result;
}

function parseChart(text) {
    const sections = Object.create(null);
    let current = '';
    const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('//') || line.startsWith(';')) continue;
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            current = header[1].trim();
            if (!sections[current]) sections[current] = [];
            continue;
        }
        if (line === '{' || line === '}') continue;
        if (current) sections[current].push(line);
    }

    const songFields = parsePropertyBlock(sections.Song || []);
    const resolutionValue = Number.parseInt(songFields.resolution, 10);
    const resolution = Number.isFinite(resolutionValue) && resolutionValue > 0 ? resolutionValue : 192;
    const offsetValue = Number.parseFloat(songFields.offset);
    const offset = Number.isFinite(offsetValue) ? offsetValue : 0;
    const tempoEvents = [];
    for (const line of sections.SyncTrack || []) {
        const match = line.match(/^(-?\d+)\s*=\s*B\s+(-?\d+(?:\.\d+)?)/i);
        if (!match) continue;
        const tick = Number(match[1]);
        let bpm = Number(match[2]);
        if (Math.abs(bpm) > 1000) bpm /= 1000;
        if (Number.isFinite(tick) && Number.isFinite(bpm) && bpm > 0) tempoEvents.push({ tick, bpm });
    }
    if (!tempoEvents.length) tempoEvents.push({ tick: 0, bpm: 120 });
    tempoEvents.sort((a, b) => a.tick - b.tick);
    const uniqueBpms = [];
    for (const event of tempoEvents) {
        if (uniqueBpms.length && uniqueBpms[uniqueBpms.length - 1].tick === event.tick) uniqueBpms[uniqueBpms.length - 1] = event;
        else uniqueBpms.push(event);
    }
    if (uniqueBpms[0].tick > 0) uniqueBpms.unshift({ tick: 0, bpm: uniqueBpms[0].bpm });
    function tickToMs(tick) {
        let ms = 0;
        for (let i = 0; i < uniqueBpms.length; i++) {
            const start = uniqueBpms[i].tick;
            const end = i + 1 < uniqueBpms.length ? uniqueBpms[i + 1].tick : Infinity;
            const msPerTick = 60000 / (uniqueBpms[i].bpm * resolution);
            if (tick >= end) ms += (end - start) * msPerTick;
            else { ms += (tick - start) * msPerTick; break; }
        }
        return ms + offset * 1000;
    }

    const candidateSections = Object.keys(sections).filter(name => {
        if (/^(song|synctrack|events|lyrics|solo|faceoff|drums|vocals|keys)$/i.test(name)) return false;
        if (/drum|vocal|keys|percussion/i.test(name)) return false;
        return /single|guitar|lead|rhythm|bass|coop|sixfret|expert|hard|medium|easy/i.test(name);
    }).map(name => {
        const lines = sections[name] || [];
        const noteCount = lines.reduce((sum, line) => sum + (/=\s*N\s+\d+/i.test(line) ? 1 : 0), 0);
        const instrumentScore = /single/i.test(name) ? 5 : /guitar|lead/i.test(name) ? 4 : /rhythm|bass/i.test(name) ? 3 : 1;
        return { name, lines, noteCount, ...chartSectionDifficulty(name), instrumentScore };
    }).filter(section => section.noteCount > 0)
      .sort((a, b) => b.rank - a.rank || b.instrumentScore - a.instrumentScore || b.noteCount - a.noteCount);

    const chosen = candidateSections[0] || null;
    const notes = [];
    const spPhrases = [];
    if (chosen) {
        for (const line of chosen.lines) {
            const eq = line.indexOf('=');
            if (eq < 0) continue;
            const tick = Number.parseInt(line.slice(0, eq).trim(), 10);
            if (!Number.isFinite(tick)) continue;
            const parts = line.slice(eq + 1).trim().split(/\s+/);
            const kind = (parts[0] || '').toUpperCase();
            if (kind === 'S' && Number.parseInt(parts[1], 10) === 2) {
                const length = Number.parseInt(parts[2] || '0', 10);
                if (length > 0) spPhrases.push({ startTick: tick, endTick: tick + length, total: 0 });
                continue;
            }
            if (kind !== 'N') continue;
            const rawFret = Number.parseInt(parts[1], 10);
            const length = Math.max(0, Number.parseInt(parts[2] || '0', 10) || 0);
            // N 7 é uma nota open: converte-a para a primeira pista, pois o jogo tem cinco trastes.
            // N 5/6 são modificadores (forced/tap), não notas independentes.
            if (!Number.isFinite(rawFret) || (rawFret < 0 || rawFret > 4) && rawFret !== 7) continue;
            const fret = rawFret === 7 ? 0 : rawFret;
            const time = tickToMs(tick);
            const end = length > 0 ? tickToMs(tick + length) : time;
            notes.push(makeGameNote(fret, time, end, { tick, star: false, phrase: -1 }));
        }
    }
    spPhrases.forEach((phrase, phraseIndex) => {
        for (const note of notes) {
            if (note.tick >= phrase.startTick && note.tick < phrase.endTick) {
                note.star = true;
                note.phrase = phraseIndex;
                phrase.total++;
            }
        }
    });
    const meta = {
        name: songFields.name || songFields.title || '',
        artist: songFields.artist || '',
        album: songFields.album || '',
        year: songFields.year || '',
        genre: songFields.genre || '',
        charter: songFields.charter || '',
        audio: songFields.audio || songFields.music || ''
    };
    return { resolution, offset, bpms: uniqueBpms, difficulty: chosen ? chosen.label : null, track: chosen ? chosen.name : null, notes: orderNotes(notes), spPhrases, meta };
}

function readVlq(bytes, state, end) {
    let value = 0;
    let count = 0;
    while (state.pos < end && count < 4) {
        const byte = bytes[state.pos++];
        value = (value << 7) | (byte & 0x7f);
        count++;
        if (!(byte & 0x80)) return value;
    }
    return value;
}
function decodeMidiText(bytes) {
    try { return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim(); } catch (_) { return ''; }
}
function parseMidi(arrayBuffer) {
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const readU32 = position => view.getUint32(position, false);
    const readU16 = position => view.getUint16(position, false);
    if (bytes.length < 14 || readU32(0) !== 0x4d546864) throw new Error('O ficheiro não tem cabeçalho MIDI MThd válido.');
    const headerLength = readU32(4);
    if (headerLength < 6 || 8 + headerLength > bytes.length) throw new Error('Cabeçalho MIDI incompleto.');
    const format = readU16(8);
    const trackCount = readU16(10);
    const division = readU16(12);
    const smpte = (division & 0x8000) !== 0;
    let ppqn = division & 0x7fff;
    if (!smpte && !ppqn) throw new Error('A resolução temporal deste MIDI é inválida.');
    const tracks = [];
    const tempos = [];
    let position = 8 + headerLength;
    for (let trackIndex = 0; trackIndex < trackCount && position + 8 <= bytes.length; trackIndex++) {
        const tag = readU32(position);
        const length = readU32(position + 4);
        position += 8;
        if (tag !== 0x4d54726b || position + length > bytes.length) throw new Error('Uma faixa MIDI está truncada ou inválida.');
        const end = position + length;
        const state = { pos: position };
        let tick = 0;
        let runningStatus = 0;
        let trackName = '';
        const active = new Map();
        const notes = [];
        while (state.pos < end) {
            tick += readVlq(bytes, state, end);
            if (state.pos >= end) break;
            let status = bytes[state.pos];
            if (status & 0x80) {
                state.pos++;
                if (status < 0xf0) runningStatus = status;
            } else {
                status = runningStatus;
                if (!status) throw new Error('MIDI contém um evento sem running status.');
            }
            if (status === 0xff) {
                if (state.pos >= end) break;
                const metaType = bytes[state.pos++];
                const metaLength = readVlq(bytes, state, end);
                const metaStart = state.pos;
                const metaEnd = Math.min(end, metaStart + metaLength);
                if (metaType === 0x51 && metaEnd - metaStart >= 3) {
                    const micros = (bytes[metaStart] << 16) | (bytes[metaStart + 1] << 8) | bytes[metaStart + 2];
                    if (micros > 0) tempos.push({ tick, micros });
                } else if (metaType === 0x03 && metaEnd > metaStart) {
                    trackName = decodeMidiText(bytes.subarray(metaStart, metaEnd));
                }
                state.pos = metaEnd;
                continue;
            }
            if (status === 0xf0 || status === 0xf7) {
                const sysexLength = readVlq(bytes, state, end);
                state.pos = Math.min(end, state.pos + sysexLength);
                continue;
            }
            const command = status & 0xf0;
            const channel = status & 0x0f;
            const data1 = bytes[state.pos++];
            const needsTwo = command !== 0xc0 && command !== 0xd0;
            const data2 = needsTwo && state.pos < end ? bytes[state.pos++] : 0;
            if (command === 0x90 && data2 > 0) {
                const key = `${channel}:${data1}`;
                if (!active.has(key)) active.set(key, []);
                active.get(key).push({ pitch: data1, startTick: tick, channel, velocity: data2 });
            } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
                const key = `${channel}:${data1}`;
                const queue = active.get(key);
                if (queue && queue.length) {
                    const started = queue.shift();
                    notes.push({ ...started, endTick: Math.max(tick, started.startTick), trackName });
                }
            }
        }
        for (const queue of active.values()) for (const started of queue) notes.push({ ...started, endTick: started.startTick, trackName });
        tracks.push({ index: trackIndex, name: trackName, notes });
        position = end;
    }
    if (!tracks.some(track => track.notes.length)) throw new Error('O MIDI não contém notas.');

    const namedTracks = tracks.filter(track => track.notes.length && /guitar|lead|rhythm|bass|part|instrument/i.test(track.name) && !/drum|vocal|piano|keyboard/i.test(track.name));
    const pool = namedTracks.length ? namedTracks : tracks.filter(track => track.notes.length && !/drum|vocal|piano|keyboard/i.test(track.name));
    const selectedTrack = pool.sort((a, b) => b.notes.length - a.notes.length)[0];
    const sourceNotes = selectedTrack ? selectedTrack.notes : tracks.flatMap(track => track.notes);
    const groups = [
        { base: 96, difficulty: 'Expert', rank: 4 },
        { base: 84, difficulty: 'Hard', rank: 3 },
        { base: 72, difficulty: 'Medium', rank: 2 },
        { base: 60, difficulty: 'Easy', rank: 1 }
    ].map(group => ({ ...group, count: sourceNotes.filter(note => note.pitch >= group.base && note.pitch <= group.base + 4).length }));
    let chosen = groups.filter(group => group.count > 0).sort((a, b) => b.rank - a.rank)[0];
    let genericBase = 0;
    if (!chosen) {
        const baseCounts = new Map();
        for (const note of sourceNotes) {
            if (note.pitch < 24 || note.pitch > 119) continue;
            const base = Math.floor(note.pitch / 5) * 5;
            baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
        }
        genericBase = [...baseCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? Math.min(...sourceNotes.map(note => note.pitch));
        chosen = { base: genericBase, difficulty: 'MIDI', count: 0 };
    }
    const validNotes = sourceNotes.filter(note => (note.pitch >= chosen.base && note.pitch <= chosen.base + 4) || (chosen.base === 96 && note.pitch === 95));
    const tempoMap = tempos.sort((a, b) => a.tick - b.tick).reduce((out, tempo) => {
        if (out.length && out[out.length - 1].tick === tempo.tick) out[out.length - 1] = tempo;
        else out.push(tempo);
        return out;
    }, []);
    if (!tempoMap.length) tempoMap.push({ tick: 0, micros: 500000 });
    if (tempoMap[0].tick > 0) tempoMap.unshift({ tick: 0, micros: tempoMap[0].micros });
    const signedSmpte = (bytes[12] << 24) >> 24;
    const ticksPerFrame = bytes[13] || 1;
    const fps = Math.abs(signedSmpte) === 29 ? 29.97 : Math.max(1, Math.abs(signedSmpte));
    const ticksPerSecond = fps * ticksPerFrame;
    function tickToMs(targetTick) {
        if (smpte) return targetTick * 1000 / ticksPerSecond;
        let milliseconds = 0;
        for (let i = 0; i < tempoMap.length; i++) {
            const start = tempoMap[i].tick;
            const end = i + 1 < tempoMap.length ? tempoMap[i + 1].tick : Infinity;
            const msPerTick = tempoMap[i].micros / ppqn / 1000;
            if (targetTick >= end) milliseconds += (end - start) * msPerTick;
            else { milliseconds += (targetTick - start) * msPerTick; break; }
        }
        return milliseconds;
    }
    const notes = validNotes.map(note => {
        const fret = note.pitch === 95 && chosen.base === 96 ? 0 : note.pitch - chosen.base;
        return makeGameNote(fret, tickToMs(note.startTick), tickToMs(note.endTick), { tick: note.startTick, star: false, phrase: -1 });
    });
    return {
        resolution: smpte ? 0 : ppqn,
        offset: 0,
        bpms: tempoMap.map(event => ({ tick: event.tick, bpm: 60000000 / event.micros })),
        difficulty: chosen.difficulty,
        track: selectedTrack ? selectedTrack.name : '',
        notes: orderNotes(notes),
        spPhrases: [],
        meta: {}
    };
}

function parseStepMania(text) {
    const source = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
    const readTag = name => {
        const match = source.match(new RegExp(`#${name}\\s*:\\s*([^;]*);`, 'i'));
        return match ? match[1].trim() : '';
    };
    const bpmText = readTag('BPMS');
    const tempoEvents = [];
    const bpmPair = /(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/g;
    let pair;
    while ((pair = bpmPair.exec(bpmText))) {
        const beat = Number(pair[1]); const bpm = Number(pair[2]);
        if (Number.isFinite(beat) && Number.isFinite(bpm) && bpm > 0) tempoEvents.push({ beat, bpm });
    }
    if (!tempoEvents.length) tempoEvents.push({ beat: 0, bpm: 120 });
    tempoEvents.sort((a, b) => a.beat - b.beat);
    if (tempoEvents[0].beat > 0) tempoEvents.unshift({ beat: 0, bpm: tempoEvents[0].bpm });
    const offsetValue = Number.parseFloat(readTag('OFFSET'));
    const offset = Number.isFinite(offsetValue) ? offsetValue : 0;
    function beatToMs(beat) {
        let ms = 0;
        for (let i = 0; i < tempoEvents.length; i++) {
            const start = tempoEvents[i].beat;
            const end = i + 1 < tempoEvents.length ? tempoEvents[i + 1].beat : Infinity;
            const msPerBeat = 60000 / tempoEvents[i].bpm;
            if (beat >= end) ms += (end - start) * msPerBeat;
            else { ms += (beat - start) * msPerBeat; break; }
        }
        return ms + offset * 1000;
    }
    const chartBlocks = [];
    const notesTag = /#NOTES\s*:\s*([\s\S]*?);/gi;
    let blockMatch;
    while ((blockMatch = notesTag.exec(source))) {
        const parts = blockMatch[1].split(':');
        if (parts.length < 6) continue;
        const noteData = parts.slice(5).join(':');
        const stepType = parts[0].trim();
        const difficulty = parts[2].trim() || parts[1].trim() || 'Normal';
        const difficultyInfo = chartSectionDifficulty(difficulty);
        let preference = /single/i.test(stepType) ? 3 : /double/i.test(stepType) ? 0 : /solo/i.test(stepType) ? 2 : 1;
        if (/dance-single|pump-single|para-single|kb7-single/i.test(stepType)) preference += 3;
        chartBlocks.push({ stepType, difficulty, rank: difficultyInfo.rank, preference, noteData });
    }
    // SSC guarda o cabeçalho de cada dificuldade em tags separadas e deixa só as linhas dentro de #NOTES.
    const sscBlocks = source.split(/#NOTEDATA\s*:\s*[^;]*;/i).slice(1);
    for (const sscBlock of sscBlocks) {
        const notesMatch = sscBlock.match(/#NOTES\s*:\s*([\s\S]*?);/i);
        if (!notesMatch) continue;
        const tagValue = tagName => {
            const match = sscBlock.match(new RegExp(`#${tagName}\\s*:\\s*([^;]*);`, 'i'));
            return match ? match[1].trim() : '';
        };
        const stepType = tagValue('STEPSTYPE') || 'dance-single';
        const difficulty = tagValue('DIFFICULTY') || tagValue('DESCRIPTION') || 'Normal';
        const difficultyInfo = chartSectionDifficulty(difficulty);
        let preference = /single/i.test(stepType) ? 6 : /double/i.test(stepType) ? 0 : 2;
        chartBlocks.push({ stepType, difficulty, rank: difficultyInfo.rank, preference, noteData: notesMatch[1] });
    }
    if (!chartBlocks.length) throw new Error('O arquivo StepMania/SSC não contém blocos #NOTES válidos.');
    chartBlocks.sort((a, b) => b.rank - a.rank || b.preference - a.preference);
    let chosen = null;
    let chosenNotes = [];
    for (const block of chartBlocks) {
        const notes = [];
        const holds = new Map();
        const measures = block.noteData.split(',');
        let beatOffset = 0;
        for (const measure of measures) {
            const rows = measure.split('\n').map(line => line.trim().replace(/\/\/.*$/, '')).filter(line => /^[0-9A-DMFX]+$/i.test(line));
            if (!rows.length) { beatOffset += 4; continue; }
            const columns = Math.max(...rows.map(row => row.length));
            for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                const row = rows[rowIndex].padEnd(columns, '0');
                const beat = beatOffset + rowIndex * 4 / rows.length;
                const time = beatToMs(beat);
                for (let column = 0; column < row.length; column++) {
                    const symbol = row[column].toUpperCase();
                    let fret;
                    if (columns === 4) fret = [0, 1, 3, 4][column];
                    else if (columns === 3) fret = [0, 2, 4][column];
                    else fret = Math.max(0, Math.min(4, Math.round(column * 4 / Math.max(1, columns - 1))));
                    if (symbol === '1') notes.push(makeGameNote(fret, time, time, { beat }));
                    else if (symbol === '2' || symbol === '4') holds.set(column, { fret, beat, time });
                    else if (symbol === '3' && holds.has(column)) {
                        const start = holds.get(column);
                        notes.push(makeGameNote(start.fret, start.time, Math.max(start.time, time), { beat: start.beat }));
                        holds.delete(column);
                    }
                }
            }
            beatOffset += 4;
        }
        for (const start of holds.values()) notes.push(makeGameNote(start.fret, start.time, start.time, { beat: start.beat }));
        if (notes.length) { chosen = block; chosenNotes = notes; break; }
    }
    if (!chosen) throw new Error('Não foram encontradas notas StepMania jogáveis.');
    return {
        resolution: 0,
        offset,
        bpms: tempoEvents.map(event => ({ tick: event.beat, bpm: event.bpm })),
        difficulty: chosen.difficulty,
        track: chosen.stepType,
        notes: orderNotes(chosenNotes),
        spPhrases: [],
        meta: { name: readTag('TITLE'), artist: readTag('ARTIST'), audio: readTag('MUSIC'), offset }
    };
}

function parseOsu(text) {
    const source = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
    const sections = Object.create(null);
    let current = '';
    for (const raw of source.split('\n')) {
        const line = raw.trim();
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) { current = header[1]; sections[current] = []; continue; }
        if (current && line && !line.startsWith('//')) sections[current].push(line);
    }
    const fieldMap = Object.create(null);
    for (const line of sections.Metadata || []) {
        const colon = line.indexOf(':');
        if (colon > 0) fieldMap[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const generalMap = Object.create(null);
    for (const line of sections.General || []) {
        const colon = line.indexOf(':');
        if (colon > 0) generalMap[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const mode = Number.parseInt(generalMap.mode || '0', 10);
    if (mode !== 3) throw new Error('Só charts osu!mania (Mode: 3) podem ser convertidas para as cinco pistas.');
    const keys = Math.max(1, Math.min(18, Number.parseFloat((sections.Difficulty || []).find(line => /^CircleSize:/i.test(line))?.split(':')[1]) || 4));
    const notes = [];
    for (const line of sections.HitObjects || []) {
        const parts = line.split(',');
        if (parts.length < 5) continue;
        const x = Number(parts[0]);
        const time = Number(parts[2]);
        const type = Number(parts[3]);
        if (!Number.isFinite(x) || !Number.isFinite(time) || !Number.isFinite(type)) continue;
        const column = Math.max(0, Math.min(keys - 1, Math.floor(x * keys / 512)));
        const fret = keys === 1 ? 2 : Math.max(0, Math.min(4, Math.round(column * 4 / (keys - 1))));
        let end = time;
        if (type & 128) {
            const hold = (parts[5] || '').split(':')[0];
            const endTime = Number(hold);
            if (Number.isFinite(endTime) && endTime >= time) end = endTime;
        }
        if ((type & 1) || (type & 128)) notes.push(makeGameNote(fret, time, end));
    }
    if (!notes.length) throw new Error('O .osu não contém hit objects de mania válidos.');
    const timingPoints = [];
    for (const line of sections.TimingPoints || []) {
        const parts = line.split(',');
        const time = Number(parts[0]); const beatLength = Number(parts[1]);
        const uninherited = Number(parts[6] || 1);
        if (Number.isFinite(time) && Number.isFinite(beatLength) && beatLength > 0 && uninherited === 1) timingPoints.push({ time, bpm: 60000 / beatLength });
    }
    const modeTitle = fieldMap.version || 'osu!mania';
    return {
        resolution: 0,
        offset: 0,
        bpms: timingPoints,
        difficulty: modeTitle,
        track: 'osu!mania',
        notes: orderNotes(notes),
        spPhrases: [],
        meta: {
            name: fieldMap.titleunicode || fieldMap.title || '',
            artist: fieldMap.artistunicode || fieldMap.artist || '',
            charter: fieldMap.creator || '',
            audio: generalMap.audiofilename || '',
            difficulty: modeTitle
        }
    };
}

function parseBms(text) {
    const source = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
    const meta = {};
    const bpmDefinitions = new Map();
    const measureRatios = new Map();
    const objectLines = [];
    let baseBpm = 120;
    const lines = source.split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('#')) continue;
        const bpmMatch = line.match(/^#BPM\s+([\d.]+)/i);
        if (bpmMatch) { baseBpm = Number(bpmMatch[1]) || baseBpm; continue; }
        const bpmDef = line.match(/^#BPM([0-9A-Z]{2})\s+([\d.]+)/i);
        if (bpmDef) { bpmDefinitions.set(bpmDef[1].toUpperCase(), Number(bpmDef[2])); continue; }
        const titleMatch = line.match(/^#(TITLE|ARTIST|GENRE|PLAYER|PLAYLEVEL|STAGEFILE|BANNER|WAV)\s+(.*)$/i);
        if (titleMatch) { meta[titleMatch[1].toLowerCase()] = titleMatch[2].trim(); continue; }
        const noteLine = line.match(/^#(\d{3})(\w{2}):\s*([0-9A-Z.]+)$/i);
        if (noteLine) objectLines.push({ measure: Number(noteLine[1]), channel: noteLine[2].toUpperCase(), data: noteLine[3].toUpperCase() });
    }
    for (const item of objectLines) if (item.channel === '02') {
        const ratio = Number(item.data);
        if (Number.isFinite(ratio) && ratio > 0) measureRatios.set(item.measure, ratio);
    }
    const maxMeasure = objectLines.reduce((max, item) => Math.max(max, item.measure), 0);
    const measureStarts = [0];
    for (let measure = 0; measure <= maxMeasure; measure++) measureStarts[measure + 1] = measureStarts[measure] + 4 * (measureRatios.get(measure) || 1);
    const tempoChanges = [];
    const rawNotes = [];
    for (const item of objectLines) {
        const count = Math.floor(item.data.length / 2);
        if (!count) continue;
        for (let i = 0; i < count; i++) {
            const object = item.data.slice(i * 2, i * 2 + 2);
            if (!object || object === '00') continue;
            const beat = measureStarts[item.measure] + (i / count) * (measureStarts[item.measure + 1] - measureStarts[item.measure]);
            if (item.channel === '03') {
                const bpm = Number.parseInt(object, 16);
                if (bpm > 0) tempoChanges.push({ beat, bpm });
            } else if (item.channel === '08') {
                const bpm = bpmDefinitions.get(object);
                if (bpm > 0) tempoChanges.push({ beat, bpm });
            } else {
                const keyChannel = Number.parseInt(item.channel, 10);
                let lane = -1;
                if (keyChannel >= 11 && keyChannel <= 15) lane = keyChannel - 11;
                else if (keyChannel >= 21 && keyChannel <= 25) lane = keyChannel - 21;
                if (lane >= 0) rawNotes.push({ beat, lane });
            }
        }
    }
    tempoChanges.push({ beat: 0, bpm: baseBpm });
    tempoChanges.sort((a, b) => a.beat - b.beat);
    const tempos = [];
    for (const tempo of tempoChanges) {
        if (tempos.length && tempos[tempos.length - 1].beat === tempo.beat) tempos[tempos.length - 1] = tempo;
        else tempos.push(tempo);
    }
    function beatToMs(beat) {
        let ms = 0;
        for (let i = 0; i < tempos.length; i++) {
            const start = tempos[i].beat;
            const end = i + 1 < tempos.length ? tempos[i + 1].beat : Infinity;
            const perBeat = 60000 / tempos[i].bpm;
            if (beat >= end) ms += (end - start) * perBeat;
            else { ms += (beat - start) * perBeat; break; }
        }
        return ms;
    }
    const notes = rawNotes.map(item => makeGameNote(item.lane, beatToMs(item.beat), beatToMs(item.beat), { beat: item.beat }));
    if (!notes.length) throw new Error('O BMS não contém notas nos canais de keys 11–15.');
    return {
        resolution: 0,
        offset: 0,
        bpms: tempos,
        difficulty: meta.playlevel ? `BMS ${meta.playlevel}` : 'BMS',
        track: 'BMS keys',
        notes: orderNotes(notes),
        spPhrases: [],
        meta: { name: meta.title || '', artist: meta.artist || '', genre: meta.genre || '', audio: '' }
    };
}

function parseJsonChart(text) {
    let root;
    try { root = JSON.parse(String(text || '').replace(/^\uFEFF/, '')); }
    catch (_) { throw new Error('O JSON da chart está malformado.'); }
    const rootMeta = root.metadata && typeof root.metadata === 'object' ? { ...root, ...root.metadata } : root;
    const source = root.chart && typeof root.chart === 'object' ? { ...root, ...root.chart } : root;
    let rawNotes = Array.isArray(source) ? source : (source.notes || source.hitObjects || source.hitobjects || source.events || source.gems || source.chartData?.notes || (Array.isArray(source.chart) ? source.chart : []));
    if (!Array.isArray(rawNotes) && rawNotes && typeof rawNotes === 'object') {
        rawNotes = Object.values(rawNotes).flatMap(value => Array.isArray(value) ? value : []);
    }
    if (!Array.isArray(rawNotes) || !rawNotes.length) {
        const tracks = Array.isArray(source.tracks) ? source.tracks : [];
        rawNotes = tracks.flatMap(track => Array.isArray(track.notes) ? track.notes : []);
    }
    if (!Array.isArray(rawNotes) || !rawNotes.length) throw new Error('O JSON não tem uma lista notes/hitObjects reconhecida.');
    const unit = String(source.timeUnit || source.timeunit || source.units || '').toLowerCase();
    const bpm = Number(source.bpm || source.BPM || 120) || 120;
    const laneNames = new Map(FRET_ORDER.map((lane, index) => [lane, index]));
    const numericLanes = rawNotes.map(item => Number(item.lane ?? item.fret ?? item.column ?? item.key)).filter(Number.isFinite);
    const oneBased = numericLanes.length > 0 && Math.min(...numericLanes) >= 1 && Math.max(...numericLanes) <= 5 && !numericLanes.includes(0);
    const notes = [];
    for (const item of rawNotes) {
        if (!item || typeof item !== 'object') continue;
        let rawLane = item.lane ?? item.fret ?? item.column ?? item.key ?? item.note ?? item.color;
        let lane;
        if (typeof rawLane === 'string' && laneNames.has(rawLane.toLowerCase())) lane = laneNames.get(rawLane.toLowerCase());
        else if (Number.isFinite(Number(rawLane))) lane = Number(rawLane) - (oneBased ? 1 : 0);
        else continue;
        lane = Math.max(0, Math.min(4, Math.round(lane)));
        const beat = Number(item.beat ?? item.beats);
        let time;
        let scale = 1;
        if (item.timeMs != null || item.time_ms != null || item.ms != null) time = Number(item.timeMs ?? item.time_ms ?? item.ms);
        else if (item.timeSeconds != null || item.seconds != null) { time = Number(item.timeSeconds ?? item.seconds); scale = 1000; }
        else if (Number.isFinite(beat)) time = beat * 60000 / bpm;
        else time = Number(item.time ?? item.start ?? item.timestamp);
        if (!Number.isFinite(time)) continue;
        if (scale === 1000) time *= scale;
        else if (unit.includes('sec') || unit === 's') time *= 1000;
        let end = Number(item.endMs ?? item.end ?? item.endTime ?? item.end_time ?? time);
        if (item.durationMs != null || item.duration != null) {
            let duration = Number(item.durationMs ?? item.duration);
            if ((item.duration != null && unit.includes('sec')) || item.durationSeconds != null) duration *= 1000;
            end = time + (Number.isFinite(duration) ? duration : 0);
        } else if (item.endSeconds != null) end = Number(item.endSeconds) * 1000;
        if (!Number.isFinite(end)) end = time;
        if (end < time) end = time;
        notes.push(makeGameNote(lane, time, end, { star: !!item.star, phrase: Number.isFinite(item.phrase) ? Number(item.phrase) : -1 }));
    }
    if (!notes.length) throw new Error('O JSON não tem notas com tempo e pista legíveis.');
    const meta = {
        name: rootMeta.title || rootMeta.name || '',
        artist: rootMeta.artist || rootMeta.author || '',
        year: rootMeta.year || '',
        album: rootMeta.album || '',
        genre: rootMeta.genre || '',
        charter: rootMeta.charter || rootMeta.creator || rootMeta.mapper || '',
        description: rootMeta.description || rootMeta.comment || '',
        audio: rootMeta.audio || rootMeta.music || rootMeta.audioFile || ''
    };
    return { resolution: 0, offset: Number(source.offset || 0), bpms: [{ tick: 0, bpm }], difficulty: source.difficulty || 'JSON', track: '', notes: orderNotes(notes), spPhrases: [], meta };
}

async function parseChartEntry(entry) {
    const ext = fileExtension(entry.path || entry.name);
    const buffer = await entry.blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isMidi = ext === 'mid' || ext === 'midi' || (bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64);
    if (isMidi) return parseMidi(buffer);
    const text = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
    if (ext === 'sm' || ext === 'ssc' || /#NOTES\s*:/i.test(text)) return parseStepMania(text);
    if (ext === 'osu' || /^osu file format v/i.test(text)) return parseOsu(text);
    if (['bms', 'bme', 'bml'].includes(ext) || /^#(PLAYER|BPM|TITLE)\s/m.test(text) && /^#\d{3}(?:11|12|13|14|15):/m.test(text)) return parseBms(text);
    if (ext === 'json' || /^[\s\uFEFF]*\{/.test(text)) return parseJsonChart(text);
    if (ext === 'chart' || ext === 'txt' || /^\s*\[Song\]/i.test(text)) return parseChart(text);
    throw new Error(`Formato de chart não suportado (.${ext || 'sem extensão'}).`);
}

// ==========================================
// CARREGAMENTO UNIFICADO DOS FICHEIROS DA MÚSICA
// ==========================================
function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const text = String(value || '').trim();
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
    }
    return out;
}

function staticChartCandidates(song) {
    const raw = song.raw || {};
    return uniqueStrings([
        song.chart, raw.chart, raw.chartfile, raw.notes, raw.notesfile,
        'notas.chart', 'notes.chart', 'chart.chart', 'expert.chart', 'song.chart', 'rhythm.chart',
        'notes.mid', 'notes.midi', 'chart.mid', 'chart.midi', 'notes.sm', 'notes.ssc',
        'chart.sm', 'chart.ssc', 'notes.osu', 'beatmap.osu', 'notes.bms', 'notes.bme', 'notes.bml',
        'notes.json', 'chart.json'
    ]);
}
function staticAudioCandidates(song) {
    const raw = song.raw || {};
    const extensions = ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac', 'opus', 'webm', 'oga', 'mp4', 'wma'];
    const names = [];
    for (const ext of extensions) {
        names.push(`audio.${ext}`, `song.${ext}`, `music.${ext}`, `main.${ext}`, `full.${ext}`, `complete.${ext}`, `backing.${ext}`, `track.${ext}`);
    }
    for (const ext of ['ogg', 'mp3', 'wav', 'm4a', 'flac', 'opus', 'aac']) names.push(`guitar.${ext}`, `rhythm.${ext}`);
    return uniqueStrings([song.audio, raw.audio, raw.music, raw.audiofilename, raw.musicfile, ...names]);
}

async function loadSongChart(song) {
    if (song.chartData && Array.isArray(song.chartData.notes) && song.chartData.notes.length) {
        return {
            ...song.chartData,
            notes: song.chartData.notes.map(note => makeGameNote(note.fret ?? note.lane, note.time, note.end, { star: !!note.star, phrase: Number.isFinite(note.phrase) ? note.phrase : -1, tick: note.tick })),
            spPhrases: Array.isArray(song.chartData.spPhrases) ? song.chartData.spPhrases.map(phrase => ({ ...phrase })) : []
        };
    }
    if (song.chartBlob) {
        const parsed = await parseChartEntry({ path: song.chartName || `notes.${song.chartExt || 'chart'}`, name: song.chartName || `notes.${song.chartExt || 'chart'}`, blob: song.chartBlob });
        if (parsed.notes && parsed.notes.length) return parsed;
    }
    if (!song.folder) throw new Error('A chart desta música não está guardada na biblioteca local. Importe-a novamente.');
    const attempted = [];
    for (const candidate of staticChartCandidates(song)) {
        attempted.push(candidate);
        try {
            const response = await fetch(assetUrl(song.folder, candidate), { cache: 'no-store' });
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob.size || blob.size > 100 * 1024 * 1024) continue;
            const parsed = await parseChartEntry({ path: candidate, name: candidate, blob });
            if (parsed.notes && parsed.notes.length) return shiftParsedChart(parsed, Number(song.chartTimeShiftMs || 0));
        } catch (_) {}
    }
    throw new Error(`Não encontrei uma chart jogável em ${song.folder}. Verifique os nomes notes.chart/notas.chart, .mid/.midi, .sm/.ssc, .osu, .bms ou .json. Tentados: ${attempted.slice(0, 8).join(', ')}.`);
}

async function loadSongAudio(song) {
    if (song.audioBlob) return normalizeAudioBlob(song.audioBlob, song.audioName || 'audio');
    if (!song.folder) throw new Error('O áudio desta música não está guardado na biblioteca local. Importe a música novamente.');
    const candidates = staticAudioCandidates(song);
    const ordered = [...candidates.filter(candidate => !isStemAudioName(candidate)), ...candidates.filter(candidate => isStemAudioName(candidate))];
    let stemFallback = null;
    for (const candidate of ordered) {
        try {
            const response = await fetch(assetUrl(song.folder, candidate), { cache: 'no-store' });
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob.size || blob.size > 500 * 1024 * 1024) continue;
            const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
            if (bytes.length >= 4 && bytes[0] === 0x3c && bytes[1] === 0x21 && bytes[2] === 0x44 && bytes[3] === 0x4f) continue;
            if (blob.type && blob.type.startsWith('text/')) continue;
            const normalized = await normalizeAudioBlob(blob, candidate);
            if (isStemAudioName(candidate)) { if (!stemFallback) stemFallback = normalized; continue; }
            return normalized;
        } catch (_) {}
    }
    if (stemFallback) return stemFallback;
    throw new Error(`Não encontrei áudio completo em ${song.folder}. O jogo procura audio.*, song.*, music.*, main.*, full.*, track.* e guitar.* nos formatos MP3/OGG/WAV/M4A/FLAC/AAC/OPUS/WebM.`);
}

function makeRuntimeNotes(parsed, calibrationOffset = 0) {
    return (parsed.notes || []).map(note => {
        const time = (Number(note.time) || 0) + calibrationOffset;
        const end = (Number.isFinite(Number(note.end)) ? Number(note.end) : Number(note.time) || 0) + calibrationOffset;
        const fret = Number.isFinite(Number(note.fret)) ? Number(note.fret) : FRET_ORDER.indexOf(note.lane);
        return makeGameNote(fret, time, end, {
            tick: note.tick,
            star: !!note.star,
            phrase: Number.isFinite(note.phrase) ? note.phrase : -1
        });
    });
}

// ==========================================
// ESTADO DO JOGO
// ==========================================
const NOTE_TRAVEL_MS = 1600;   // tempo que a nota leva do topo até a linha de acerto
const HIT_WINDOW = 140;        // janela de acerto (ms) para cada lado
const PERFECT_WINDOW = 55;     // janela de "Perfeito"

// Star Power
const SP_PER_PHRASE = 50;         // % ganho ao completar uma frase estrelada
const SP_ACTIVATE_MIN = 50;       // % mínimo para ativar
const SP_DURATION_MS = 7000;      // duração de uma barra cheia (100%)

// Calibração (offset somado de áudio + vídeo, em ms)
function getCalibrationOffset() {
    return parseInt(localStorage.getItem('guitarBrowserOffset') || '0') || 0;
}

let spLastPerf = 0;

let gameState = null;
let isPlaying = false;
let audioPlayer = null;
let audioStarted = false;
let audioStartPerf = 0;
let leadInStart = 0;
let rafId = null;

const highwayEl = document.getElementById('highway');
const notesLayer = document.getElementById('highway-notes');
const hitZoneEl = document.getElementById('hit-zone');
const strikeLineEl = document.getElementById('strike-line');

// ==========================================
// TRANSIÇÃO (clicar em "Jogar")
// ==========================================
if (btnJogar) btnJogar.addEventListener('click', iniciarTransicao);
let transitionLoading = false;

async function iniciarTransicao() {
    if (!currentSelectedSong || transitionLoading) return;
    transitionLoading = true;
    btnJogar.disabled = true;
    btnJogar.setAttribute('aria-busy', 'true');

    const fadeOverlay = document.getElementById('fade-overlay');
    const menuContainer = document.getElementById('menu-container');
    const gameContainer = document.getElementById('game-container');
    document.getElementById('results-screen').style.display = 'none';
    if (fadeOverlay) fadeOverlay.style.opacity = '1';

    try {
        await prepareGame();
        await new Promise(resolve => setTimeout(resolve, 500));
        menuContainer.style.display = 'none';
        gameContainer.style.display = 'block';
        if (fadeOverlay) fadeOverlay.style.opacity = '0';
        layoutHighway();
        iniciarContagem();
    } catch (error) {
        console.error('Erro ao preparar a música:', error);
        if (fadeOverlay) fadeOverlay.style.opacity = '0';
        const message = error && error.message ? error.message : 'Verifique se a pasta contém um áudio e uma chart suportada.';
        window.alert(`Não foi possível iniciar esta música.\n\n${message}`);
    } finally {
        transitionLoading = false;
        btnJogar.disabled = false;
        btnJogar.removeAttribute('aria-busy');
    }
}

// Localiza e converte a chart, carrega o áudio e só então inicia a contagem.
async function prepareGame() {
    if (!currentSelectedSong) throw new Error('Selecione uma música primeiro.');
    gameState = {
        notes: [],
        score: 0,
        combo: 0,
        maxCombo: 0,
        multiplier: 1,
        hitCount: 0,
        totalNotes: 0,
        health: 50,
        starPower: 0,
        starActive: false,
        spPhrases: []
    };

    const [parsed, audioBlob] = await Promise.all([
        loadSongChart(currentSelectedSong),
        loadSongAudio(currentSelectedSong)
    ]);
    if (!parsed.notes || !parsed.notes.length) throw new Error('A chart não contém notas que o jogo consiga tocar.');
    if (!audioBlob || !audioBlob.size) throw new Error('O arquivo de áudio está vazio.');

    const calOffset = getCalibrationOffset();
    gameState.notes = makeRuntimeNotes(parsed, calOffset);
    gameState.totalNotes = gameState.notes.length;
    gameState.spPhrases = (parsed.spPhrases || []).map(phrase => ({
        total: phrase.total || 0,
        hitCount: 0,
        broken: false,
        awarded: false
    }));
    console.log(`Chart carregado: ${parsed.notes.length} notas (${parsed.difficulty || 'N/D'}) | ${gameState.spPhrases.length} frases de SP | offset ${calOffset}ms`);

    if (audioPlayer) {
        try { audioPlayer.pause(); } catch (_) {}
    }
    audioPlayer = new Audio();
    audioPlayer.preload = 'auto';
    audioPlayer.volume = 1;
    audioStarted = false;
    const audioKey = `audio:${currentSelectedSong.id || currentSelectedSong.folder || currentSelectedSong.name}`;
    audioPlayer.src = getObjectUrl(audioKey, audioBlob);
    audioPlayer.load();
    audioPlayer.addEventListener('error', () => console.error('O navegador não conseguiu descodificar o áudio desta música.'));
}

// Posiciona a linha de acerto e os botões conforme o tamanho real da pista
let hitLineTop = 0;
function layoutHighway() {
    const h = highwayEl.offsetHeight;
    hitLineTop = h - 95; // posição vertical da linha de acerto dentro da pista
    hitZoneEl.style.top = `${hitLineTop - 31}px`;   // centraliza os botões (62px) na linha
    strikeLineEl.style.top = `${hitLineTop}px`;
}
window.addEventListener('resize', () => { if (isPlaying) layoutHighway(); });

// ==========================================
// CONTAGEM REGRESSIVA
// ==========================================
function iniciarContagem() {
    const countdown = document.getElementById('countdown-display');
    countdown.style.display = 'block';
    let count = 3;
    countdown.innerText = count;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playTick(freq) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        osc.type = 'square';
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    }

    playTick(800);
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdown.innerText = count;
            playTick(800);
        } else if (count === 0) {
            countdown.innerText = 'GO!';
            playTick(1200);
        } else {
            clearInterval(interval);
            countdown.style.display = 'none';
            iniciarJogo();
        }
    }, 1000);
}

// ==========================================
// RELÓGIO DE JOGO + SINCRONIA DE ÁUDIO
// ==========================================
// Antes do áudio começar usamos performance.now (lead-in).
// Assim que o relógio chega a 0, o áudio toca e vira o relógio-mestre
// (audio.currentTime) -> notas e som ficam 100% sincronizados, sem drift.
function getGameTime() {
    if (audioStarted) {
        // Áudio é o relógio-mestre -> sincronia perfeita, sem drift.
        // Se por algum motivo o áudio não avançar (falha/latência), usa um
        // fallback por performance.now para o jogo nunca congelar.
        if (audioPlayer && audioPlayer.currentTime > 0) {
            return audioPlayer.currentTime * 1000;
        }
        return performance.now() - audioStartPerf;
    }
    return (performance.now() - leadInStart) - NOTE_TRAVEL_MS;
}

function iniciarJogo() {
    isPlaying = true;
    notesLayer.innerHTML = '';
    leadInStart = performance.now();
    audioStarted = false;
    spLastPerf = 0;
    document.getElementById('game-container').classList.remove('star-active');
    updateHud();
    rafId = requestAnimationFrame(gameLoop);
}

function spawnNote(note) {
    const el = document.createElement('div');
    el.className = `note ${note.lane}${note.star ? ' star' : ''}`;
    el.style.left = `${laneX[note.lane]}%`;

    if (note.end > note.time) {
        const sustainPx = ((note.end - note.time) / NOTE_TRAVEL_MS) * hitLineTop;
        const sustain = document.createElement('div');
        sustain.className = 'note-sustain';
        sustain.style.height = `${Math.max(0, sustainPx)}px`;
        el.appendChild(sustain);
    }

    const head = document.createElement('div');
    head.className = 'note-head';
    el.appendChild(head);

    notesLayer.appendChild(el);
    note.el = el;
    note.spawned = true;
}

function gameLoop() {
    if (!isPlaying) return;
    const gt = getGameTime();

    // Dispara o áudio exatamente quando o relógio cruza 0 (tick 0 do chart)
    if (!audioStarted && gt >= 0) {
        audioStarted = true;
        audioStartPerf = performance.now();
        try { audioPlayer.currentTime = 0; } catch (e) {}
        audioPlayer.play().catch(e => console.log('Áudio indisponível:', e));
    }

    // Drenagem do Star Power enquanto ativo
    const nowP = performance.now();
    const dt = spLastPerf ? (nowP - spLastPerf) : 16;
    spLastPerf = nowP;
    if (gameState.starActive) {
        gameState.starPower -= (dt / SP_DURATION_MS) * 100;
        if (gameState.starPower <= 0) {
            gameState.starPower = 0;
            gameState.starActive = false;
            document.getElementById('game-container').classList.remove('star-active');
        }
    }

    const notes = gameState.notes;
    let allDone = true;

    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        if (note.done) continue;
        allDone = false;

        const rel = note.time - gt; // ms até a linha de acerto

        // Spawn quando entra na janela de visão
        if (!note.spawned && rel <= NOTE_TRAVEL_MS + 50) spawnNote(note);

        if (note.el && !note.hit) {
            const progress = rel / NOTE_TRAVEL_MS; // 1 = topo, 0 = linha
            const top = hitLineTop - progress * hitLineTop;
            note.el.style.top = `${top}px`;
            const op = Math.min(1, Math.max(0.15, (1 - progress) * 1.6));
            note.el.style.opacity = op;
        }

        // Nota perdida (passou da janela sem acerto)
        if (!note.hit && !note.missed && gt > note.time + HIT_WINDOW) {
            note.missed = true;
            registerMiss(note);
        }

        // Sustain: mantém a cabeça parada na linha enquanto segura
        if (note.hit && note.end > note.time) {
            if (gt < note.end && activeKeys[note.lane] && note.holding) {
                if (note.el) {
                    note.el.style.top = `${hitLineTop}px`;
                    // encurta o rastro conforme consome o sustain
                    const remaining = ((note.end - gt) / NOTE_TRAVEL_MS) * hitLineTop;
                    const s = note.el.querySelector('.note-sustain');
                    if (s) s.style.height = `${Math.max(0, remaining)}px`;
                }
                addSustainPoints();
            } else if (gt >= note.end) {
                note.holding = false;
                finishNote(note);
            } else if (!activeKeys[note.lane]) {
                note.holding = false;
                finishNote(note);
            }
        }

        // Limpeza
        if ((note.missed) && gt > note.time + 400) finishNote(note);
        if (note.hit && note.end <= note.time && !note.done) finishNote(note);
    }

    updateHud();

    // Fim da música
    if (!allDone) {
        rafId = requestAnimationFrame(gameLoop);
    } else if (audioStarted && (audioPlayer.ended || audioPlayer.paused && getGameTime() > 0)) {
        endSong();
    } else {
        // ainda tocando áudio depois da última nota
        if (audioStarted && !audioPlayer.ended) {
            rafId = requestAnimationFrame(gameLoop);
        } else {
            endSong();
        }
    }
}

function finishNote(note) {
    note.done = true;
    if (note.el) { note.el.remove(); note.el = null; }
}

// ==========================================
// ACERTO / ERRO / PONTUAÇÃO
// ==========================================
function tryHit(lane) {
    if (!isPlaying) return;
    const gt = getGameTime();
    const notes = gameState.notes;

    let best = null;
    let bestDiff = Infinity;
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.lane !== lane || n.hit || n.missed || n.done) continue;
        const diff = Math.abs(n.time - gt);
        if (diff <= HIT_WINDOW && diff < bestDiff) { best = n; bestDiff = diff; }
    }

    if (best) {
        best.hit = true;
        best.holding = best.end > best.time;
        gameState.combo++;
        gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo);
        gameState.hitCount++;
        updateMultiplier();
        // Star Power: só vem das notas estreladas (frases marcadas com "S 2" no chart)
        if (best.star && best.phrase >= 0 && gameState.spPhrases[best.phrase]) {
            const ph = gameState.spPhrases[best.phrase];
            ph.hitCount++;
            if (!ph.broken && !ph.awarded && ph.hitCount >= ph.total) {
                ph.awarded = true;
                gameState.starPower = Math.min(100, gameState.starPower + SP_PER_PHRASE);
            }
        }
        const points = (bestDiff <= PERFECT_WINDOW ? 100 : 50) * effectiveMultiplier();
        gameState.score += points;
        changeHealth(+4);
        showFeedback(bestDiff <= PERFECT_WINDOW ? 'PERFEITO!' : 'BOM!', bestDiff <= PERFECT_WINDOW ? '#2ecc71' : '#f1c40f');
        flashFret(lane, true);
        if (!best.holding) finishNote(best);
        else if (best.el) best.el.classList.add('held');
    } else {
        // Overstrum / tecla errada: quebra combo
        breakCombo();
        showFeedback('ERROU', '#e74c3c');
    }
}

// Multiplicador efetivo (dobra durante o Star Power)
function effectiveMultiplier() {
    return gameState.multiplier * (gameState.starActive ? 2 : 1);
}

function activateStarPower() {
    if (!isPlaying || !gameState) return;
    if (gameState.starActive) return;
    if (gameState.starPower < SP_ACTIVATE_MIN) return;
    gameState.starActive = true;
    document.getElementById('game-container').classList.add('star-active');
}

function registerMiss(note) {
    breakCombo();
    changeHealth(-6);
    // Se a nota estrelada for perdida, a frase de Star Power é quebrada
    if (note.star && note.phrase >= 0 && gameState.spPhrases[note.phrase]) {
        gameState.spPhrases[note.phrase].broken = true;
    }
    showFeedback('PERDEU', '#888');
    if (note.el) note.el.style.opacity = '0.2';
}

function breakCombo() {
    gameState.combo = 0;
    gameState.multiplier = 1;
}

function updateMultiplier() {
    const c = gameState.combo;
    gameState.multiplier = c >= 30 ? 4 : c >= 20 ? 3 : c >= 10 ? 2 : 1;
}

function addSustainPoints() {
    gameState.score += 1 * effectiveMultiplier();
}

function changeHealth(delta) {
    gameState.health = Math.max(0, Math.min(100, gameState.health + delta));
}

// ==========================================
// HUD
// ==========================================
function updateHud() {
    if (!gameState) return;
    document.getElementById('score-value').innerText = gameState.score.toLocaleString('pt-BR');
    document.getElementById('mult-value').innerText = 'x' + effectiveMultiplier();
    document.getElementById('combo-value').innerText = 'Combo ' + gameState.combo;

    const mask = document.getElementById('meter-mask');
    const marker = document.getElementById('meter-marker');
    mask.style.height = `${100 - gameState.health}%`;
    marker.style.bottom = `${gameState.health}%`;

    // Star Power
    const spFill = document.getElementById('sp-fill');
    const spBox = document.getElementById('hud-starpower');
    if (spFill) spFill.style.width = `${gameState.starPower}%`;
    if (spBox) {
        spBox.classList.toggle('ready', gameState.starPower >= SP_ACTIVATE_MIN && !gameState.starActive);
        spBox.classList.toggle('active', gameState.starActive);
    }
}

function showFeedback() {
    // Avisos de acerto/erro desativados a pedido do jogador (não atrapalhar a gameplay).
}

function flashFret(lane, hit) {
    const btn = document.getElementById(`btn-${lane}`);
    if (!btn) return;
    if (hit) {
        btn.classList.add('hit');
        setTimeout(() => btn.classList.remove('hit'), 350);
    }
}

// ==========================================
// FIM DA MÚSICA / RESULTADOS
// ==========================================
function endSong() {
    if (!isPlaying) return;
    isPlaying = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (audioPlayer) { try { audioPlayer.pause(); } catch (e) {} }

    const total = gameState.totalNotes || 1;
    const acc = Math.round((gameState.hitCount / total) * 100);

    document.getElementById('final-score').innerText = gameState.score.toLocaleString('pt-BR');
    document.getElementById('res-hit').innerText = `${gameState.hitCount} / ${gameState.totalNotes}`;
    document.getElementById('res-acc').innerText = `${isFinite(acc) ? acc : 0}%`;
    document.getElementById('res-combo').innerText = gameState.maxCombo;

    document.getElementById('game-container').style.display = 'none';
    document.getElementById('results-screen').style.display = 'flex';
}

document.getElementById('btn-back-menu').addEventListener('click', voltarAoMenu);

function voltarAoMenu() {
    isPlaying = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (audioPlayer) { try { audioPlayer.pause(); audioPlayer.currentTime = 0; } catch (e) {} }
    notesLayer.innerHTML = '';
    document.getElementById('game-container').classList.remove('star-active');
    document.getElementById('results-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('menu-container').style.display = 'flex';
}

// ==========================================
// TECLADO
// ==========================================
function isTextInputTarget(target) {
    const tag = String(target && target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(target && target.isContentEditable);
}

window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();

    // Não transformar a escrita na pesquisa/metadados/configurações em notas da gameplay.
    if (!calState.running && isTextInputTarget(e.target)) return;

    // Durante a calibração, as teclas vão para o medidor de calibração
    if (calState.running) {
        if (key === ' ' || e.code === 'Space') e.preventDefault();
        if (key === ' ' || e.code === 'Space' || Object.values(playerKeys).includes(key)) {
            calRegisterPress();
        }
        return;
    }

    // Espaço aciona o Star Power
    if (key === ' ' || e.code === 'Space') {
        e.preventDefault();
        activateStarPower();
        return;
    }

    Object.keys(playerKeys).forEach(color => {
        if (key === playerKeys[color]) {
            activeKeys[color] = true;
            const btn = document.getElementById(`btn-${color}`);
            if (btn) btn.classList.add('pressed');
            tryHit(color);
        }
    });
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    Object.keys(playerKeys).forEach(color => {
        if (key === playerKeys[color]) {
            activeKeys[color] = false;
            const btn = document.getElementById(`btn-${color}`);
            if (btn) btn.classList.remove('pressed');
        }
    });
});


// ==========================================
// CALIBRAÇÃO DE ÁUDIO E VÍDEO
// ==========================================
const CAL_BEAT = 850;      // intervalo entre notas de teste (ms)
const CAL_TRAVEL = 1400;   // tempo de queda da nota de teste (ms)
const CAL_LEAD = 1400;     // atraso inicial para a 1a nota cair
const CAL_COUNT = 12;      // quantidade de notas de teste

const calState = {
    running: false,
    start: 0,
    notes: [],
    deltas: [],
    rafId: null,
    audioCtx: null,
    targetCenterY: 300
};

const calScreen = document.getElementById('calibration-screen');
const calNotesEl = document.getElementById('cal-notes');
const calTargetEl = document.getElementById('cal-target');
const calSamplesEl = document.getElementById('cal-samples');
const calResultEl = document.getElementById('cal-result');
const btnCalibrate = document.getElementById('btn-calibrate');
const btnCalStart = document.getElementById('btn-cal-start');
const btnCalSave = document.getElementById('btn-cal-save');
const btnCalClose = document.getElementById('btn-cal-close');

if (btnCalibrate) btnCalibrate.onclick = () => {
    settingsModal.style.display = 'none';
    openCalibration();
};

function openCalibration() {
    stopCalibration();
    calState.deltas = [];
    calState.notes = [];
    calNotesEl.innerHTML = '';
    calSamplesEl.innerText = '0';
    const saved = getCalibrationOffset();
    calResultEl.innerText = saved ? `${saved > 0 ? '+' : ''}${saved} ms (atual)` : '—';
    btnCalSave.disabled = true;
    calScreen.style.display = 'flex';
}

function closeCalibration() {
    stopCalibration();
    calScreen.style.display = 'none';
}

if (btnCalClose) btnCalClose.onclick = closeCalibration;

if (btnCalStart) btnCalStart.onclick = () => {
    stopCalibration();
    calState.deltas = [];
    calNotesEl.innerHTML = '';
    calSamplesEl.innerText = '0';
    calResultEl.innerText = 'Toque no ritmo...';
    btnCalSave.disabled = true;

    // AudioContext precisa ser criado/retomado após gesto do usuário
    calState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (calState.audioCtx.state === 'suspended') calState.audioCtx.resume();

    calState.targetCenterY = calTargetEl.offsetTop + calTargetEl.offsetHeight / 2;

    const t0 = performance.now();
    calState.start = t0;
    calState.notes = [];
    for (let i = 0; i < CAL_COUNT; i++) {
        calState.notes.push({
            hitTime: t0 + CAL_LEAD + i * CAL_BEAT,
            el: null,
            clicked: false,
            counted: false
        });
    }
    calState.running = true;
    calState.rafId = requestAnimationFrame(calLoop);
};

function calClick() {
    const ctx = calState.audioCtx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1000;
    osc.type = 'square';
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
}

function calLoop() {
    if (!calState.running) return;
    const now = performance.now();
    const targetY = calState.targetCenterY;

    for (const n of calState.notes) {
        const rel = n.hitTime - now;

        // Spawn
        if (!n.el && rel <= CAL_TRAVEL && rel > -300) {
            const el = document.createElement('div');
            el.className = 'cal-note';
            calNotesEl.appendChild(el);
            n.el = el;
        }

        if (n.el) {
            const top = targetY * (1 - rel / CAL_TRAVEL);
            n.el.style.top = `${top}px`;
            if (rel < -250) { n.el.remove(); n.el = null; }
        }

        // Clique do metrônomo exatamente quando a nota toca o alvo
        if (!n.clicked && now >= n.hitTime) {
            n.clicked = true;
            calClick();
            calTargetEl.classList.add('flash');
            setTimeout(() => calTargetEl.classList.remove('flash'), 120);
        }
    }

    // Fim do teste
    const last = calState.notes[calState.notes.length - 1];
    if (now > last.hitTime + 700) {
        finishCalibration();
        return;
    }
    calState.rafId = requestAnimationFrame(calLoop);
}

function calRegisterPress() {
    if (!calState.running) return;
    const now = performance.now();
    let best = null;
    let bestDiff = Infinity;
    for (const n of calState.notes) {
        if (n.counted) continue;
        const d = Math.abs(n.hitTime - now);
        if (d < bestDiff && d <= 450) { best = n; bestDiff = d; }
    }
    if (best) {
        best.counted = true;
        calState.deltas.push(now - best.hitTime);
        calSamplesEl.innerText = String(calState.deltas.length);
        const med = median(calState.deltas);
        calResultEl.innerText = `${med > 0 ? '+' : ''}${med} ms`;
    }
    calTargetEl.classList.add('flash');
    setTimeout(() => calTargetEl.classList.remove('flash'), 100);
}

function finishCalibration() {
    calState.running = false;
    if (calState.rafId) cancelAnimationFrame(calState.rafId);
    calNotesEl.innerHTML = '';
    calState.notes.forEach(n => { n.el = null; });

    if (calState.deltas.length >= 3) {
        const med = median(calState.deltas);
        calResultEl.innerText = `${med > 0 ? '+' : ''}${med} ms`;
        btnCalSave.disabled = false;
        calState._pending = med;
    } else {
        calResultEl.innerText = 'Poucas amostras — tente de novo';
        btnCalSave.disabled = true;
    }
}

function stopCalibration() {
    calState.running = false;
    if (calState.rafId) cancelAnimationFrame(calState.rafId);
    if (calState.audioCtx) { try { calState.audioCtx.close(); } catch (e) {} calState.audioCtx = null; }
}

function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return Math.round(m);
}

if (btnCalSave) btnCalSave.onclick = () => {
    if (typeof calState._pending === 'number') {
        localStorage.setItem('guitarBrowserOffset', String(calState._pending));
        calResultEl.innerText = `${calState._pending > 0 ? '+' : ''}${calState._pending} ms (salvo!)`;
        btnCalSave.disabled = true;
    }
};

if (typeof requestAnimationFrame === 'function') gamepadRaf = requestAnimationFrame(pollGamepads);
