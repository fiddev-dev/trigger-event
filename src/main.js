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

    // Wire controls
    document.getElementById('btn-flag').addEventListener('click', () => vm.greenFlag());
    document.getElementById('btn-stop').addEventListener('click', () => vm.stopAll());

    // Helper: post a key down/up to the VM keyboard device
    const key = (k, isDown) => vm.postIOData('keyboard', { key: k, isDown });

    // ---- Mobile on-screen action buttons ----
    // Maps on-screen buttons to the exact keys the project expects:
    //   a / d = move character, space + f = interact / pick up, 2/3/4 = dialog choices
    const heldKeys = {};
    const pressKey = (k) => {
        if (heldKeys[k]) return;
        heldKeys[k] = true;
        key(k, true);
    };
    const releaseKey = (k) => {
        if (!heldKeys[k]) return;
        heldKeys[k] = false;
        key(k, false);
    };
    const releaseAllHeld = () => {
        for (const k of Object.keys(heldKeys)) releaseKey(k);
    };

    const bindHoldButton = (id, k, opt = {}) => {
        const el = document.getElementById(id);
        if (!el) return;
        const down = (e) => {
            e.preventDefault();
            if (opt.resume !== false) resumeAudio();
            pressKey(k);
            el.classList.add('pressed');
            if (opt.click) vm.postIOData('mouse', { isDown: true, wasDragged: false, x: 0, y: 0, canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT });
        };
        const up = (e) => {
            if (e) e.preventDefault();
            releaseKey(k);
            el.classList.remove('pressed');
            if (opt.click) vm.postIOData('mouse', { isDown: false, wasDragged: true });
        };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    };

    bindHoldButton('mbtn-left', 'a');
    bindHoldButton('mbtn-right', 'd');
    bindHoldButton('mbtn-interact', 'f');
    bindHoldButton('mbtn-confirm', ' ');
    // One-tap dialog choices (2/3/4): down + quick up
    const bindTapButton = (id, k) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            resumeAudio();
            pressKey(k);
            el.classList.add('pressed');
        });
        const finishTap = () => {
            releaseKey(k);
            el.classList.remove('pressed');
        };
        el.addEventListener('pointerup', finishTap);
        el.addEventListener('pointercancel', finishTap);
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    bindTapButton('mopt-2', '2');
    bindTapButton('mopt-3', '3');
    bindTapButton('mopt-4', '4');

    // Hide the mobile bar on desktop (>= 1024px) so it never shows on desktop
    const mq = window.matchMedia('(min-width: 1024px)');
    const mobileBar = document.getElementById('mobile-controls');
    const applyMobileBar = () => {
        if (mobileBar) mobileBar.style.display = mq.matches ? 'none' : 'flex';
    };
    applyMobileBar();
    if (mq.addEventListener) mq.addEventListener('change', applyMobileBar);
    else if (mq.addListener) mq.addListener(applyMobileBar);

    // Release all held keys if the page loses focus / user navigates away
    window.addEventListener('blur', releaseAllHeld);

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
