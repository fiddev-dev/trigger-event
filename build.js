const esbuild = require('esbuild');

const base = {
    entryPoints: ['src/main.js'],
    bundle: true,
    outfile: 'site/runtime.js',
    format: 'iife',
    target: 'es2018',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' }
};

// Usage: node build.js [--watch]
const watch = process.argv.includes('--watch');

if (watch) {
    esbuild.context({
        ...base,
        minify: false,
        sourcemap: true,
        define: { 'process.env.NODE_ENV': '"development"' }
    }).then(ctx => {
        ctx.watch(() => console.log('watch aktif: rebuild otomatis saat src/main.js berubah'));
        console.log('tekan Ctrl+C untuk berhenti');
    }).catch(() => process.exit(1));
} else {
    esbuild.build({ ...base, minify: true }).then(() => {
        console.log('build: site/runtime.js selesai (production, minified)');
    }).catch(() => process.exit(1));
}
