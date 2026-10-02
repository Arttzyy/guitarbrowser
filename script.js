// ==========================================
// CONFIGURAÇÕES E TECLAS
// ==========================================
const defaultKeys = { green: 'a', red: 's', yellow: 'j', blue: 'k', orange: 'l' };
let playerKeys = JSON.parse(localStorage.getItem('guitarBrowserKeys')) || defaultKeys;
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

if (gearIcon) gearIcon.onclick = () => settingsModal.style.display = 'flex';
if (btnCloseKeys) btnCloseKeys.onclick = () => settingsModal.style.display = 'none';
if (btnSaveKeys) btnSaveKeys.onclick = () => {
    Object.keys(playerKeys).forEach(color => {
        playerKeys[color] = document.getElementById(`key-${color}`).value.toLowerCase();
    });
    localStorage.setItem('guitarBrowserKeys', JSON.stringify(playerKeys));
    settingsModal.style.display = 'none';
};

// ==========================================
// LÓGICA DO MENU (mantida intacta)
// ==========================================
let currentSelectedSong = null;

async function loadMenu() {
    try {
        const response = await fetch('songs.json');
        const songs = await response.json();
        const listContainer = document.getElementById('song-list');

        for (const song of songs) {
            const txtResponse = await fetch(`${song.folder}/music.txt`);
            const txtText = await txtResponse.text();

            const songData = { folder: song.folder };
            txtText.split('\n').forEach(line => {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const key = parts.shift().trim();
                    songData[key] = parts.join(':').trim();
                }
            });

            const coverPath = `${song.folder}/${songData.cover}`;

            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `
                <img src="${coverPath}" alt="Capa">
                <div class="song-info">
                    <h2>${songData.name || 'Sem nome'}</h2>
                    <p>${songData.artist || ''}</p>
                    <p>${songData.year || ''}</p>
                </div>
            `;

            item.onclick = () => selectSong(item, songData, coverPath);
            listContainer.appendChild(item);
        }
    } catch (error) {
        console.error("Erro ao carregar o menu:", error);
    }
}

function selectSong(element, songData, coverPath) {
    document.querySelectorAll('.song-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    currentSelectedSong = songData;

    const detailCover = document.getElementById('detail-cover');
    const detailTitle = document.getElementById('detail-title');

    detailCover.crossOrigin = 'anonymous';
    detailCover.src = coverPath;
    detailCover.style.display = 'block';
    detailTitle.innerText = songData.name;
    btnJogar.style.display = 'inline-block';

    if (detailCover.complete) {
        extractColor(detailCover, detailTitle);
    } else {
        detailCover.onload = () => extractColor(detailCover, detailTitle);
    }
}

function extractColor(img, titleEl) {
    try {
        const ColorThiefLib = window.ColorThief;
        const colorThief = new ColorThiefLib();
        const color = colorThief.getColor(img);
        titleEl.style.backgroundColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.5)`;
    } catch (e) {
        titleEl.style.backgroundColor = 'rgba(255,255,255,0.1)';
    }
}

loadMenu();

// ==========================================
// PARSER DO ARQUIVO .CHART (Clone Hero / Moonscraper)
// ==========================================
function parseChart(text) {
    const lines = text.split(/\r?\n/);
    const sections = {};
    let current = null;

    for (let raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('[') && line.endsWith(']')) {
            current = line.slice(1, -1);
            sections[current] = [];
            continue;
        }
        if (line === '{' || line === '}') continue;
        if (current) sections[current].push(line);
    }

    // --- [Song] : Resolution e Offset ---
    let resolution = 192;
    let offset = 0;
    (sections['Song'] || []).forEach(l => {
        const eq = l.indexOf('=');
        if (eq < 0) return;
        const key = l.slice(0, eq).trim();
        const val = l.slice(eq + 1).trim().replace(/"/g, '');
        if (key === 'Resolution') resolution = parseInt(val) || 192;
        if (key === 'Offset') offset = parseFloat(val) || 0;
    });

    // --- [SyncTrack] : eventos de BPM (tick = B bpm*1000) ---
    const bpms = [];
    (sections['SyncTrack'] || []).forEach(l => {
        const eq = l.indexOf('=');
        if (eq < 0) return;
        const tick = parseInt(l.slice(0, eq).trim());
        const parts = l.slice(eq + 1).trim().split(/\s+/);
        if (parts[0] === 'B') bpms.push({ tick, bpm: parseInt(parts[1]) / 1000 });
    });
    if (bpms.length === 0) bpms.push({ tick: 0, bpm: 120 });
    bpms.sort((a, b) => a.tick - b.tick);
    if (bpms[0].tick !== 0) bpms.unshift({ tick: 0, bpm: bpms[0].bpm });

    // Converte tick -> milissegundos usando o mapa de BPM (suporta mudanças de andamento)
    function tickToMs(tick) {
        let ms = 0;
        for (let i = 0; i < bpms.length; i++) {
            const start = bpms[i].tick;
            const end = (i + 1 < bpms.length) ? bpms[i + 1].tick : Infinity;
            const msPerTick = 60000 / (bpms[i].bpm * resolution);
            if (tick >= end) {
                ms += (end - start) * msPerTick;
            } else {
                ms += (tick - start) * msPerTick;
                break;
            }
        }
        return ms + offset * 1000;
    }

    // --- Escolhe a dificuldade disponível (preferência: Expert > Hard > Medium > Easy) ---
    const diffOrder = ['ExpertSingle', 'HardSingle', 'MediumSingle', 'EasySingle'];
    let noteLines = [];
    let difficulty = null;
    for (const d of diffOrder) {
        if (sections[d] && sections[d].length) { noteLines = sections[d]; difficulty = d; break; }
    }

    // --- Parse das notas (N) e das frases de Star Power (S 2) ---
    const notes = [];
    const spPhrases = []; // frases de star power: { startTick, endTick }
    noteLines.forEach(l => {
        const eq = l.indexOf('=');
        if (eq < 0) return;
        const tick = parseInt(l.slice(0, eq).trim());
        const parts = l.slice(eq + 1).trim().split(/\s+/);

        if (parts[0] === 'S' && parseInt(parts[1]) === 2) {
            // Frase de Star Power: tick = S 2 length
            const len = parseInt(parts[2] || '0');
            spPhrases.push({ startTick: tick, endTick: tick + len });
            return;
        }
        if (parts[0] !== 'N') return;            // ignora outros eventos (E, etc.)
        const fret = parseInt(parts[1]);
        const len = parseInt(parts[2] || '0');
        if (fret < 0 || fret > 4) return;        // ignora forced(5)/tap(6)/open(7)
        const time = tickToMs(tick);
        const end = len > 0 ? tickToMs(tick + len) : time;
        notes.push({
            tick,
            fret,
            lane: FRET_ORDER[fret],
            time,
            end,
            star: false,
            phrase: -1,
            el: null,
            spawned: false,
            hit: false,
            missed: false,
            done: false,
            holding: false
        });
    });

    // Marca quais notas pertencem a cada frase de Star Power
    spPhrases.forEach((ph, idx) => {
        ph.total = 0;
        notes.forEach(n => {
            if (n.tick >= ph.startTick && n.tick < ph.endTick) {
                n.star = true;
                n.phrase = idx;
                ph.total++;
            }
        });
    });

    notes.sort((a, b) => a.time - b.time);
    return { resolution, offset, bpms, difficulty, notes, spPhrases };
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
btnJogar.addEventListener('click', iniciarTransicao);

function iniciarTransicao() {
    if (!currentSelectedSong) return;

    const fadeOverlay = document.getElementById('fade-overlay');
    const menuContainer = document.getElementById('menu-container');
    const gameContainer = document.getElementById('game-container');
    document.getElementById('results-screen').style.display = 'none';

    fadeOverlay.style.opacity = '1';

    // Pré-carrega chart e áudio durante o fade
    prepareGame();

    setTimeout(() => {
        menuContainer.style.display = 'none';
        gameContainer.style.display = 'block';
        fadeOverlay.style.opacity = '0';
        layoutHighway();
        iniciarContagem();
    }, 2000);
}

// Carrega o .chart e prepara o áudio (sem tocar ainda)
function prepareGame() {
    gameState = {
        notes: [],
        score: 0,
        combo: 0,
        maxCombo: 0,
        multiplier: 1,
        hitCount: 0,
        totalNotes: 0,
        health: 50,        // medidor de rock (0-100)
        starPower: 0,      // energia de star power (0-100)
        starActive: false, // star power acionado?
        spPhrases: []      // frases estreladas do chart
    };

    const calOffset = getCalibrationOffset();
    const folder = currentSelectedSong.folder;

    // Chart
    fetch(`${folder}/notas.chart`)
        .then(r => r.text())
        .then(txt => {
            const parsed = parseChart(txt);
            // Aplica o offset de calibração (compensa atraso de áudio+vídeo do PC)
            if (calOffset) parsed.notes.forEach(n => { n.time += calOffset; n.end += calOffset; });
            gameState.notes = parsed.notes;
            gameState.totalNotes = parsed.notes.length;
            gameState.spPhrases = (parsed.spPhrases || []).map(p => ({
                total: p.total, hitCount: 0, broken: false, awarded: false
            }));
            console.log(`Chart carregado: ${parsed.notes.length} notas (${parsed.difficulty || 'N/D'}) | ${gameState.spPhrases.length} frases de SP | offset ${calOffset}ms`);
        })
        .catch(err => console.error('Erro ao carregar o .chart:', err));

    // Áudio (tenta mp3, depois ogg, depois wav) e deixa pré-carregado
    audioPlayer = new Audio();
    audioPlayer.preload = 'auto';
    audioStarted = false;
    const candidates = [`${folder}/audio.mp3`, `${folder}/audio.ogg`, `${folder}/audio.wav`];
    let idx = 0;
    const tryLoad = () => {
        if (idx >= candidates.length) { console.warn('Nenhum arquivo de áudio encontrado na pasta.'); return; }
        audioPlayer.src = candidates[idx++];
        audioPlayer.load();
    };
    audioPlayer.addEventListener('error', () => { if (!audioStarted) tryLoad(); });
    tryLoad();
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
window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();

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
