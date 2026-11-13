const { build } = require('esbuild');
build({
    entryPoints: ['src/main.js'],
    bundle: true,
    outfile: 'site/runtime.js',
    format: 'iife',
    target: 'es2018',
    platform: 'browser',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
}).catch(() => process.exit(1));
