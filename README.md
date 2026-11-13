# Tugas Dasar Coding — UTS (Lanjutan) · Website Statis

Projek Scratch `tugas-dasar-coding-uts-lanjutan.sb3` yang dijalankan langsung
di browser tanpa server, siap di-host statis di **GitHub Pages**.

## Struktur

```
site/                  ← root GitHub Pages (yang di-deploy)
  index.html           ← halaman utama
  runtime.js           ← bundle scratch-vm + scratch-render + scratch-audio (~7.9 MB, minified)
  project.json         ← data projek (diekstrak dari .sb3)
  assets/              ← semua sprite / suara / backdrop (diekstrak dari .sb3)
src/
  main.js              ← entry runtime: load project.json + asset, init VM & renderer
build.js               ← script esbuild
package.json
tugas-dasar-coding-uts-lanjutan.sb3   ← berkas sumber asli
```

## Menjalankan Lokal

```
npm install
npm run build          # generate site/runtime.js
npm start              # python http.server di port 8099, direktori site/
```

Buka `http://localhost:8099`.

> Catatan: `fetch()` hanya bekerja via HTTP(S), bukan `file://`. Gunakan
> server statis apa pun (`npx serve site`, `python -m http.server`, `nginx`,
> dll.).

## Deploy ke GitHub Pages

### Opsi 1 — push folder `site/` langsung ke branch `gh-pages`

```
git checkout --orphan gh-pages
git rm -rf .            # bersihkan
git mv site/. .         # pindahkan isi site/ ke root branch
git add -A
git commit -m "Deploy statis: website Scratch tugas UTS"
git branch -M gh-pages
git push origin gh-pages
git checkout main      # balik ke branch utama
```

Aktifkan di GitHub: **Settings → Pages → Source: gh-pages / root**.

### Opsi 2 — deploy dari branch `main` (lebih rapi)

Simpan `site/` sebagai path, lalu di GitHub **Settings → Pages → Source:
main branch → Folder: `/site`**. Tidak perlu branch terpisah.

## Ukuran & Limit

- `runtime.js`: 7.9 MB (minified) — di bawah limit 100 MB/file GitHub Pages.
- `assets/` total ~55 MB (176 file, terbesar `9.8 MB` WAV) — di bawah limit
  100 MB/file. Repo total < 65 MB, aman tanpa Git LFS.
- Semua asset & JS di-serve secara lokal — tidak bergantung CDN, bekerja
  offline setelah halaman pertama dimuat.

## Kontrol

| Tombol | Fungsi |
| ------ | ------ |
| **Mulai** | Jalankan green-flag (semua `when flag clicked`) |
| **Stop**  | Hentikan semua thread (`stopAll`) |
| **Penuh** | Request fullscreen pada area stage |

Mouse & keyboard (spasi, panah, huruf) diteruskan ke VM sesuai block yang
didefinisikan dalam projek.
