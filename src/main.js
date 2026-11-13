import VirtualMachine from 'scratch-vm';
import Render from 'scratch-render';
import { ScratchStorage } from 'scratch-storage';
import AudioEngine from 'scratch-audio';

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 360;

// Minimal V2 bitmap adapter (scratch-gui provides a fuller one).
// Handles resolution-1 bitmaps by upscaling 2x and converting data URIs.
const V2BitmapAdapter = {
    resize (source, targetW, targetH) {
        const out = document.createElement('canvas');
        out.width = targetW;
        out.height = targetH;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, targetW, targetH);
        return out;
    },
    convertDataURIToBinary (dataURI) {
        const base64 = dataURI.substring(dataURI.indexOf(',') + 1);
        const binary = atob(base64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out;
    }
};

async function main () {
    const statusEl = document.getElementById('status');
    const setStatus = (msg) => { statusEl.textContent = msg; };

    const vm = new VirtualMachine();
    const storage = new ScratchStorage();

    const audioEngine = new AudioEngine(
        new (window.AudioContext || window.webkitAudioContext)()
    );

    const canvas = document.getElementById('stage');
    const renderer = new Render(canvas, -240, 240, -180, 180);

    vm.attachStorage(storage);
    vm.attachRenderer(renderer);
    vm.attachAudioEngine(audioEngine);
    vm.attachV2BitmapAdapter(V2BitmapAdapter);

    setStatus('Memuat project.json…');
    const projectJson = await (await fetch('project.json')).json();

    setStatus('Memuat asset…');
    const collect = () => {
        const items = new Set();
        if (projectJson.targets) {
            for (const t of projectJson.targets) {
                if (t.costumes) t.costumes.forEach(c => {
                    if (c.md5ext) items.add(c.md5ext);
                    if (c.textLayerMD5) items.add(c.textLayerMD5);
                });
                if (t.sounds) t.sounds.forEach(s => {
                    if (s.md5ext) items.add(s.md5ext);
                });
            }
        }
        return [...items];
    };

    const assetMdfes = [...new Set(collect())];
    setStatus(`Memuat ${assetMdfes.length} asset…`);
    const results = await Promise.all(assetMdfes.map(async (md5ext) => {
        const dot = md5ext.lastIndexOf('.');
        const md5 = md5ext.slice(0, dot);
        const ext = md5ext.slice(dot + 1).toLowerCase();
        const res = await fetch(`assets/${md5}.${ext}`);
        if (!res.ok) return { md5ext, ext, error: true };
        const buf = new Uint8Array(await res.arrayBuffer());
        return { md5ext, ext, buf };
    }));

    for (const r of results) {
        if (r.error) continue;
        const AT = storage.AssetType;
        const DF = storage.DataFormat;
        let assetType;
        let dataFormat;
        if (r.ext === 'svg') {
            assetType = AT.ImageVector;
            dataFormat = DF.SVG;
        } else if (r.ext === 'png') {
            assetType = AT.ImageBitmap;
            dataFormat = DF.PNG;
        } else if (r.ext === 'jpg') {
            assetType = AT.ImageBitmap;
            dataFormat = DF.JPG;
        } else if (r.ext === 'wav') {
            assetType = AT.Sound;
            dataFormat = DF.WAV;
        } else if (r.ext === 'mp3') {
            assetType = AT.Sound;
            dataFormat = DF.MP3;
        } else {
            continue;
        }
        storage.builtinHelper._store(assetType, dataFormat, r.buf, r.md5ext.slice(0, r.md5ext.lastIndexOf('.')));
    }

    setStatus('Menjalankan project…');
    await vm.loadProject(projectJson);
    vm.start();

    statusEl.textContent = '';
    statusEl.classList.add('hidden');
    window.__vm = vm;

    // Audio resume on first interaction (browser autoplay policy)
    const resumeAudio = () => {
        if (audioEngine.audioContext.state === 'suspended') {
            audioEngine.audioContext.resume();
        }
    };
    window.addEventListener('click', resumeAudio, { once: true });
    window.addEventListener('keydown', resumeAudio, { once: true });

    // Helper: post a key down/up to the VM keyboard device
    const key = (k, isDown) => vm.postIOData('keyboard', { key: k, isDown });

    // ---- Fullscreen 16:9 + landscape on mobile ----
    const stageWrapper = document.getElementById('stage-wrapper');
    const isMobileLayout = () => window.matchMedia('(pointer: coarse)').matches ||
        window.matchMedia('(max-width: 900px)').matches;
    const lockLandscape = () => {
        const orientation = window.screen && window.screen.orientation;
        if (!orientation || typeof orientation.lock !== 'function') return;
        try {
            const result = orientation.lock('landscape');
            if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch (err) { /* not supported / not allowed */ }
    };
    const enterStageFullscreen = () => {
        if (!stageWrapper) return;
        if (document.fullscreenElement === stageWrapper) {
            lockLandscape();
            return;
        }
        try {
            const request = stageWrapper.requestFullscreen &&
                stageWrapper.requestFullscreen({ navigationUI: 'hide' });
            if (request && typeof request.then === 'function') {
                request.then(lockLandscape).catch(() => {});
            } else {
                lockLandscape();
            }
        } catch (err) { /* fullscreen unavailable */ }
    };
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            lockLandscape();
        } else if (window.screen && window.screen.orientation &&
            typeof window.screen.orientation.unlock === 'function') {
            try { window.screen.orientation.unlock(); } catch (err) { /* ignore */ }
        }
    });

    document.getElementById('btn-flag').addEventListener('click', () => {
        vm.greenFlag();
        if (isMobileLayout() && !document.fullscreenElement) enterStageFullscreen();
    });
    document.getElementById('btn-stop').addEventListener('click', () => vm.stopAll());
    document.getElementById('btn-fullsize').addEventListener('click', enterStageFullscreen);
    const exitFullscreenBtn = document.getElementById('gc-exit');
    if (exitFullscreenBtn) {
        exitFullscreenBtn.addEventListener('click', () => {
            if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        });
    }

    // ---- In-game touch controls ----
    // Maps on-screen buttons to the exact keys the project expects:
    //   a / d = move character, f = interact / pick up / dialog / dispose, 2/3/4 = quick navigation
    const heldKeys = {};
    const holdKey = (k) => {
        const count = heldKeys[k] || 0;
        if (count === 0) key(k, true);
        heldKeys[k] = count + 1;
    };
    const releaseKey = (k) => {
        const count = heldKeys[k] || 0;
        if (count <= 0) return;
        if (count === 1) {
            heldKeys[k] = 0;
            key(k, false);
        } else {
            heldKeys[k] = count - 1;
        }
    };
    const releaseAllHeld = () => {
        for (const k of Object.keys(heldKeys)) {
            if (heldKeys[k] > 0) key(k, false);
            heldKeys[k] = 0;
        }
    };

    const bindHoldButton = (id, keys, minHoldMs = 0) => {
        const el = document.getElementById(id);
        if (!el) return;
        const keyList = Array.isArray(keys) ? keys : [keys];
        let pointerId = null;
        let downAt = 0;
        let releaseTimer = null;
        const finishRelease = () => {
            if (releaseTimer !== null) {
                clearTimeout(releaseTimer);
                releaseTimer = null;
            }
            el.classList.remove('pressed');
            keyList.forEach(releaseKey);
        };
        const down = (e) => {
            if (pointerId !== null) return;
            e.preventDefault();
            // A new tap while the previous tap is still being held: finish the
            // old press first so the key is registered as a fresh keydown.
            if (releaseTimer !== null) finishRelease();
            pointerId = e.pointerId;
            downAt = performance.now();
            el.classList.add('pressed');
            resumeAudio();
            keyList.forEach(holdKey);
            try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        };
        const up = (e) => {
            if (pointerId === null) return;
            if (e && e.pointerId !== undefined && e.pointerId !== pointerId) return;
            pointerId = null;
            // A very fast tap can start and end between VM ticks. Keep the key
            // down briefly so Scratch's wait_until/keypressed sees it.
            const remaining = minHoldMs - (performance.now() - downAt);
            if (remaining > 0) {
                releaseTimer = setTimeout(finishRelease, remaining);
            } else {
                finishRelease();
            }
        };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('lostpointercapture', up);
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    };

    bindHoldButton('gc-left', 'a');
    bindHoldButton('gc-right', 'd');
    // F = interaction / dialog / pick up / dispose; Space = start & skip splash.
    // Sending both keeps the game startable from the same in-game button.
    // The 120 ms floor prevents fast taps from being missed by the VM tick.
    bindHoldButton('gc-interact', ['f', ' '], 120);
    bindHoldButton('gc-trash', 'f', 120);

    // Quick-navigation chips (2/3/4): hold briefly so the VM registers the press,
    // then release automatically even on very fast taps.
    const bindTapButton = (id, k) => {
        const el = document.getElementById(id);
        if (!el) return;
        let timer = null;
        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            resumeAudio();
            el.classList.add('pressed');
            if (timer === null) holdKey(k);
            clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                el.classList.remove('pressed');
                releaseKey(k);
            }, 120);
        });
        el.addEventListener('pointerup', (e) => e.preventDefault());
        el.addEventListener('pointercancel', (e) => e.preventDefault());
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    bindTapButton('gc-2', '2');
    bindTapButton('gc-3', '3');
    bindTapButton('gc-4', '4');

    // Release all held keys if the page loses focus / user navigates away
    window.addEventListener('blur', releaseAllHeld);

    // While an in-game dialog is open, lift the HUD so it does not cover the
    // dialogue box (movement is locked by the project during dialogs).
    const gameControls = document.getElementById('game-controls');
    const stageTarget = vm.runtime.getTargetForStage();
    if (gameControls && stageTarget) {
        let dialogActive = false;
        const readDialogVariable = () => {
            if (typeof stageTarget.lookupVariableByNameAndType === 'function') {
                return stageTarget.lookupVariableByNameAndType('DialogAktif', '');
            }
            const vars = stageTarget.variables || {};
            for (const id of Object.keys(vars)) {
                if (vars[id].name === 'DialogAktif') return vars[id];
            }
            return null;
        };
        setInterval(() => {
            const variable = readDialogVariable();
            const value = variable && variable.value;
            const active = value === true || value === 'true' || value === 1;
            if (active !== dialogActive) {
                dialogActive = active;
                if (active) releaseAllHeld();
                gameControls.classList.toggle('dialog-active', active);
            }
        }, 150);
    }

    // Pointer input (unifies mouse + touch). Tapping the canvas drives the
    // sprite click / dialog buttons inside the stage.
    const canvasBounds = () => canvas.getBoundingClientRect();
    const toCanvas = (clientX, clientY) => {
        const b = canvasBounds();
        return {
            x: (clientX - b.left) * (CANVAS_WIDTH / b.width),
            y: (clientY - b.top) * (CANVAS_HEIGHT / b.height)
        };
    };
    const mouseData = (clientX, clientY, isDown, wasDragged) => {
        const p = toCanvas(clientX, clientY);
        return {
            x: p.x,
            y: p.y,
            isDown,
            wasDragged,
            canvasWidth: CANVAS_WIDTH,
            canvasHeight: CANVAS_HEIGHT
        };
    };

    // Track the active pointer so a touch-drag works like a mouse-drag.
    let activePointer = null;
    let lastPointer = { x: 0, y: 0 };
    let moved = false;

    canvas.addEventListener('pointerdown', (e) => {
        resumeAudio();
        if (activePointer !== null) return; // only track one pointer
        activePointer = e.pointerId;
        moved = false;
        lastPointer = toCanvas(e.clientX, e.clientY);
        vm.postIOData('mouse', mouseData(e.clientX, e.clientY, true, false));
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
        const p = toCanvas(e.clientX, e.clientY);
        if (activePointer !== null && e.pointerId === activePointer) {
            // Drag: report movement; mark as drag so click hats don't refire
            moved = true;
            vm.postIOData('mouse', mouseData(e.clientX, e.clientY, true, true));
            lastPointer = p;
        } else {
            // Hover (no button pressed)
            vm.postIOData('mouse', mouseData(e.clientX, e.clientY, false, false));
        }
    });

    const endPointer = (e) => {
        if (activePointer === null || (e.pointerId !== undefined && e.pointerId !== activePointer)) return;
        const wasTap = !moved;
        // A tap should fire the "clicked" hat. Scratch mouse model: release
        // with isDown=false; the click hat fires on the transition up when the
        // target was not draggable, or on down for draggable targets. Posting
        // up here with wasDragged=false lets the VM handle the click.
        if (e.clientX !== undefined) {
            vm.postIOData('mouse', mouseData(e.clientX, e.clientY, false, !wasTap));
        } else {
            vm.postIOData('mouse', { isDown: false, wasDragged: !wasTap });
        }
        activePointer = null;
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', () => {
        if (activePointer === null) vm.postIOData('mouse', { isDown: false });
    });

    // Keyboard
    window.addEventListener('keydown', (e) => {
        if (e.target === document.body || e.target === canvas) {
            vm.postIOData('keyboard', { key: e.key, isDown: true });
        }
    });
    window.addEventListener('keyup', (e) => {
        vm.postIOData('keyboard', { key: e.key, isDown: false });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    main().catch((err) => {
        document.getElementById('status').textContent = 'Error: ' + err.message;
        console.error(err);
    });
});
