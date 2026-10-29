# Review registrasi dan isolasi toko

## Skema yang ditemukan

- `toko`: metadata toko.
- `profil`: `id` berelasi ke `auth.users.id`, menyimpan role dan satu `store_id`.
- `produk`, `member`, `supplier`, `riwayat_transaksi`: data bisnis. Kolom `store_id` ditambahkan hanya oleh migrasi tenant 20261028.
- Detail transaksi berada di `riwayat_transaksi.items` (JSONB). Tidak ada tabel detail transaksi, stok terpisah, pelanggan terpisah, atau pengeluaran pada skema proyek saat audit.
- Aplikasi saat ini menghubungkan satu profil ke satu toko dan belum memiliki pemilih toko aktif.

## Registrasi prototype

- `schema_and_rls.sql` sekarang mendefinisikan role `owner`, `kasir`, `admin gudang`, dan `manajer`. Skema dasar tidak menyalakan RLS; empat tabel bisnis dasar juga belum memiliki `store_id`.
- `20261031_owner_signup_role_cleanup.sql` memasang trigger Auth untuk pendaftaran. Trigger membuat toko sebelum profil, mengikat UUID Auth ke profil, dan menetapkan role publik `owner`. Role dari metadata pengguna diabaikan. Mode undangan tetap memakai role dan toko dari token undangan tersimpan.
- Insert Auth dan trigger database bersifat atomik. Kegagalan membuat toko/profil membatalkan insert Auth, termasuk ketika konfirmasi email aktif. Trigger tidak menyimpan password.
- Tidak ada INSERT frontend ke `profil` atau `toko`. `.env.example` hanya memuat URL dan publishable/anon key.
- `20261030_reconcile_orphan_auth_owner.sql` menyediakan rekonsiliasi manual satu akun Auth yatim setelah email, UUID, dan metadata diverifikasi. Fungsi tidak mengubah profil yang sudah ada dan berhenti jika metadata toko tidak lengkap atau data toko sama sudah ada.
- Penghapusan akun Auth menghapus profil lewat `ON DELETE CASCADE`, tetapi tidak otomatis menghapus toko. Jika migrasi tenant pernah diterapkan, penghapusan toko memiliki FK cascade ke tabel bisnis. Periksa UUID, foreign key, dan jumlah baris sebelum tindakan manual apa pun.

## Tahap isolasi tenant terpisah

- `20261028_owner_registration_and_store_isolation.sql` menambahkan `store_id`, trigger tenant, policy per toko, dan secara eksplisit mengaktifkan RLS. **Jangan jalankan file ini sebagai bagian dari perbaikan registrasi prototype.**
- Query aplikasi belum mengirim `store_id`; sebelum RLS diaktifkan, data antar toko tidak dibatasi database. Filter frontend bukan perlindungan keamanan.
- Data lama tanpa relasi toko tidak boleh di-backfill secara acak. Primary key SKU/member/supplier dan constraint nota juga masih unik global.
- Fallback POS lama dipertahankan untuk workflow prototype, tetapi menyimpan transaksi dan stok bertahap sehingga kegagalan dapat menghasilkan data parsial. Ganti dengan RPC atomik dalam tahap keamanan berikutnya setelah workflow ditinjau.

## File audit dan penerapan

- `registration_status_audit.sql`: status trigger Auth, status RLS aktual, role, profil yatim, dan policy.
- `account_deletion_preflight.sql`: pemeriksaan read-only untuk UUID akun yang telah diverifikasi, relasi, dan jumlah data toko jika tersedia.
- `tenant_isolation_audit.sql` dan `tenant_isolation_test_template.sql`: audit dan skenario dua akun untuk tahap isolasi berikutnya; jalankan test hanya di project uji.
- Untuk registrasi prototype, jalankan audit, pastikan RLS memang nonaktif dan tidak ada role lama yang belum ditinjau, lalu tinjau `20261031_owner_signup_role_cleanup.sql`. Untuk akun Auth yatim, jalankan juga migrasi 20261030 lalu panggil fungsi hanya dengan UUID terverifikasi.
- Migrasi 20261028 adalah tahap terpisah dan mengaktifkan RLS ketika dijalankan. Ia memerlukan audit, pengujian dua akun, dan persetujuan terpisah.

## Status validasi

Audit ini hanya mencakup file workspace. Tidak tersedia koneksi ke Supabase untuk memastikan trigger, migrasi yang sudah diterapkan, status RLS produksi, atau hasil pendaftaran. Pemeriksaan sintaks lokal tidak membuktikan row berhasil dibuat di Supabase. Isolasi produksi dan alur registrasi produksi belum diverifikasi.
