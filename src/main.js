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

    // Mouse
    const canvasBounds = () => canvas.getBoundingClientRect();
    const mouseData = (clientX, clientY, isDown) => {
        const b = canvasBounds();
        return {
            x: (clientX - b.left) * (CANVAS_WIDTH / b.width),
            y: (clientY - b.top) * (CANVAS_HEIGHT / b.height),
            isDown,
            canvasWidth: CANVAS_WIDTH,
            canvasHeight: CANVAS_HEIGHT,
            wasDragged: false
        };
    };
    canvas.addEventListener('mousemove', (e) => {
        vm.postIOData('mouse', mouseData(e.clientX, e.clientY, false));
    });
    canvas.addEventListener('mousedown', (e) => {
        vm.postIOData('mouse', mouseData(e.clientX, e.clientY, true));
    });
    canvas.addEventListener('mouseup', (e) => {
        vm.postIOData('mouse', mouseData(e.clientX, e.clientY, false));
    });
    canvas.addEventListener('mouseleave', () => {
        vm.postIOData('mouse', { isDown: false });
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
