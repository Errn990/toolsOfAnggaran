# Tools Kertas Kerja Anggaran (GitHub Pages)

Situs statis yang mengisi **kertas kerja anggaran** (.xlsx) dari **laporan monitoring** (Oracle BI `.xls`) dan memperbaiki rumus yang error, sepenuhnya otomatis di browser. Tidak ada server dan tidak ada file yang dikirim keluar dari komputer Anda.

## Memasang di GitHub Pages
1. Push seluruh isi folder ini ke branch `main`.
2. Buka **Settings → Pages**. Pada *Build and deployment* pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu **Save**.
3. Tunggu 1 sampai 2 menit. Alamatnya: `https://<username>.github.io/<nama-repo>/`.

## Cara pakai
Unggah file monitoring dan kertas kerja (boleh banyak), klik **Proses otomatis**, lalu unduh hasilnya dan laporan perbaikan.

## Yang dikerjakan
- **Pengisian sheet INVESTASI**: mengisi sel kosong (No. Kontrak, Nama Vendor, Task Description, No/Nilai PR, No/Nilai PO, No RID, Tgl RID, Nilai RID). Blok dipasangkan lewat nomor task + budget; baris lewat No RID atau No PR. Data yang sudah ada tidak ditimpa, selisih hanya dilaporkan.
- **Perbaikan rumus (semua sheet)**: `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A` berformula dibungkus `IFERROR(...,0)`; rumus bersama yang error dibuka menjadi rumus biasa; `SUM(#REF!)` dipulihkan dari rumus SUM kolom sebelahnya pada baris yang sama; suku `#REF!` pada penjumlahan dibuang (semua rusak menjadi `0`); nilai error tanpa rumus dikosongkan; rentang SUM/SUBTOTAL blok INVESTASI disesuaikan.
- **Aman untuk file asli**: ukuran tabel tidak berubah (jumlah baris dan dimensi diverifikasi). File diedit langsung di XML, jadi rumus, format, validasi data, dan link eksternal tetap. Sheet tanpa perubahan tidak disentuh. Excel menghitung ulang saat file dibuka.
- Setiap perbaikan dicatat (sel, rumus sebelum, rumus sesudah, aturan).

## Pengembangan
```bash
node --test          # butuh Node 18+
python3 -m http.server 8000 # buka http://localhost:8000
```
Struktur: `index.html`, `assets/engine.js` (mesin, tanpa library), `assets/app.js` (antarmuka), `tests/`.

## Batasan
- Metode Kontrak tidak ada di monitoring, jadi tidak diisi.
- Perbaikan `#REF!` bersifat inferensi berbasis aturan; cek daftar perbaikan di laporan.
- Pasangan monitoring hanya terbentuk bila nomor task dan budget sama; blok tanpa pasangan dilewati dan dicatat.
- Perlu browser dengan `CompressionStream` (Chrome/Edge 80+, Firefox 113+, Safari 16.4+).
