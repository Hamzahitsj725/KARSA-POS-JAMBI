/**
 * KARSA POS - Inventory Management Module
 * Mengelola pemantauan stok gudang, modal registrasi SKU baru dengan validasi ketat,
 * pengadaan restock pasokan vendor, dan penanganan scan barcode SKU.
 */

import { panggilDatabaseAman } from '../services/db.js';
import { store } from '../services/state.js';
import { showToast } from '../services/notification.js';
import { renderMenusRestockDropdown } from './suppliers.js';
import { cacheLocalData, getPendingTransactions } from '../services/offlineQueue.js';
import { validateProductFields } from '../services/productValidation.js';
import { importValidProducts, validateProductCsv } from '../services/productCsv.js';

let editingProductId = null;
let pendingDeleteProductId = null;
let lastProductActionTrigger = null;
let isDeletingProduct = false;
let productCsvImportRows = [];
let isImportingProductCsv = false;
let productCsvImportCompleted = false;
let productCsvImportInitialized = false;

export function initProductCsvImport() {
    if (productCsvImportInitialized) return;
    const uploadButton = document.getElementById('btn-upload-produk-csv');
    const fileInput = document.getElementById('input-import-produk-csv');
    const modal = document.getElementById('modal-import-produk-csv');
    const confirmButton = document.getElementById('btn-konfirmasi-import-produk-csv');
    if (!uploadButton || !fileInput || !modal || !confirmButton) return;
    productCsvImportInitialized = true;

    const closeModal = () => {
        if (isImportingProductCsv) return;
        modal.classList.add('hidden');
        productCsvImportRows = [];
        productCsvImportCompleted = false;
        uploadButton.focus();
    };

    uploadButton.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showToast('File tidak didukung. Pilih file berekstensi .csv.', 'error');
            return;
        }

        let validation;
        try {
            validation = validateProductCsv(await file.text(), store.masterStok);
        } catch (error) {
            console.error('[Import CSV] Gagal membaca file:', error);
            validation = { error: 'File CSV tidak dapat dibaca. Pastikan file menggunakan encoding UTF-8.', rows: [] };
        }
        productCsvImportRows = validation.rows || [];
        productCsvImportCompleted = false;
        document.getElementById('import-produk-csv-filename').textContent = file.name;
        document.getElementById('import-produk-csv-result').classList.add('hidden');
        renderProductCsvPreview(validation);
        modal.classList.remove('hidden');
        document.getElementById('btn-tutup-import-produk-csv')?.focus();
    });

    document.getElementById('btn-tutup-import-produk-csv')?.addEventListener('click', closeModal);
    document.getElementById('btn-batal-import-produk-csv')?.addEventListener('click', closeModal);
    modal.addEventListener('click', event => {
        if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });
    confirmButton.addEventListener('click', async () => {
        if (isImportingProductCsv || productCsvImportCompleted) return;
        const validRows = productCsvImportRows.filter(row => row.product);
        if (!validRows.length) return;
        if (!navigator.onLine) {
            showToast('Perangkat sedang offline. Hubungkan ke internet sebelum mengimpor produk.', 'warning');
            return;
        }

        isImportingProductCsv = true;
        confirmButton.disabled = true;
        confirmButton.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-1" aria-hidden="true"></i> Mengimpor...';
        document.getElementById('btn-batal-import-produk-csv').disabled = true;
        document.getElementById('btn-tutup-import-produk-csv').disabled = true;
        try {
            const result = await importValidProducts(validRows, product => panggilDatabaseAman({
                tabel: 'produk', aksi: 'INSERT', data: [product]
            }));
            productCsvImportCompleted = true;
            result.succeeded.forEach(({ product }) => store.upsertProductInState(product));
            if (result.succeeded.length) {
                await cacheLocalData('master_stok', store.masterStok);
                renderTabelStok();
                renderMenusRestockDropdown();
                window.filterProdukPOS?.();
            }
            const failedRows = [
                ...productCsvImportRows.filter(row => row.errors.length)
                    .map(row => ({ line: row.line, reason: row.errors.join(' ') })),
                ...result.failed
            ].sort((first, second) => first.line - second.line);
            const resultHost = document.getElementById('import-produk-csv-result');
            resultHost.innerHTML = `<p class="font-semibold text-white">${result.succeeded.length} produk berhasil diimpor; ${failedRows.length} baris gagal.</p>${failedRows.length ? `<ul class="mt-2 list-disc pl-5 text-rose-300">${failedRows.map(row => `<li>Baris ${row.line}: ${escapeHtml(row.reason)}</li>`).join('')}</ul>` : ''}`;
            resultHost.classList.remove('hidden');
            confirmButton.innerHTML = 'Impor Selesai';
            showToast(`${result.succeeded.length} produk berhasil diimpor; ${failedRows.length} baris gagal.`, failedRows.length ? 'warning' : 'success');
        } catch (error) {
            console.error('[Import CSV] Proses impor gagal:', error);
            const resultHost = document.getElementById('import-produk-csv-result');
            resultHost.textContent = 'Proses impor terhenti karena gangguan sistem. Produk yang sudah berhasil tersimpan tetap dipertahankan; periksa daftar produk sebelum mencoba kembali.';
            resultHost.classList.remove('hidden');
            confirmButton.disabled = productCsvImportCompleted;
            confirmButton.innerHTML = productCsvImportCompleted ? 'Impor Selesai' : 'Coba Impor Lagi';
        } finally {
            isImportingProductCsv = false;
            document.getElementById('btn-batal-import-produk-csv').disabled = false;
            document.getElementById('btn-tutup-import-produk-csv').disabled = false;
        }
    });
}

function renderProductCsvPreview(validation) {
    const summary = document.getElementById('import-produk-csv-summary');
    const tbody = document.getElementById('import-produk-csv-preview');
    const confirmButton = document.getElementById('btn-konfirmasi-import-produk-csv');
    if (validation.error) {
        summary.innerHTML = `<span class="text-rose-300">${escapeHtml(validation.error)}</span>`;
        tbody.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-500">Tidak ada data untuk dipratinjau.</td></tr>';
        confirmButton.disabled = true;
        return;
    }

    const validCount = validation.rows.filter(row => row.product).length;
    const invalidCount = validation.rows.length - validCount;
    summary.textContent = `${validCount} baris valid dan siap diimpor; ${invalidCount} baris bermasalah. Baris gagal tidak akan disimpan.`;
    tbody.innerHTML = validation.rows.length ? validation.rows.map(row => {
        const raw = row.raw;
        const rawIndexes = { id_produk: 0, nama: 1, kategori: 2, harga: 3, stok: 4, Waktu_Input: 5, Waktu_Update: 6 };
        const value = key => Array.isArray(raw) ? raw[rawIndexes[key]] : raw?.[key];
        const product = row.product;
        const display = key => product?.[key] ?? value(key) ?? '';
        const status = row.errors.length ? row.errors.join(' ') : 'Siap diimpor';
        return `<tr class="${row.errors.length ? 'bg-rose-950/20' : ''}">
            <td class="p-3">${row.line}</td><td class="p-3 font-mono">${escapeHtml(display('id_produk'))}</td>
            <td class="p-3">${escapeHtml(display('nama'))}</td><td class="p-3">${escapeHtml(display('kategori') || 'Umum')}</td>
            <td class="p-3 text-right">${escapeHtml(display('harga'))}</td><td class="p-3 text-right">${escapeHtml(display('stok'))}</td>
            <td class="p-3">${escapeHtml(value('Waktu_Input') || '')}</td><td class="p-3">${escapeHtml(value('Waktu_Update') || '')}</td>
            <td class="p-3 ${row.errors.length ? 'text-rose-300' : 'text-emerald-300'}">${escapeHtml(status)}</td></tr>`;
    }).join('') : '<tr><td colspan="9" class="p-4 text-center text-slate-500">CSV hanya berisi header, belum ada baris produk.</td></tr>';
    confirmButton.disabled = validCount === 0;
}

// --- RENDER TABEL STOK GUDANG ---
export function renderTabelStok() {
    const tbody = document.getElementById('stok-table-body');
    if (!tbody) return;
    bindProductActionHandler(tbody);

    const masterStok = store.masterStok;

    if (masterStok.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-xs text-slate-500 italic">Belum ada data inventori produk di gudang.</td></tr>`;
        return;
    }

    tbody.innerHTML = masterStok.map(b => {
        let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Aman</span>`;
        if (b.stok <= 15 && b.stok > 0) {
            statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Menipis</span>`;
        } else if (b.stok === 0) {
            statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">Habis</span>`;
        }

        return `
            <tr class="hover:bg-slate-900/30">
                <td class="py-3 px-4 font-mono font-bold text-xs text-cyan-400">${escapeHtml(b.id_produk)}</td>
                <td class="py-3 px-4 font-medium text-white">${escapeHtml(b.nama)}</td>
                <td class="py-3 px-4 text-xs text-slate-400">${escapeHtml(b.kategori || 'Umum')}</td>
                <td class="py-3 px-4 text-right font-medium">Rp ${Number(b.harga || 0).toLocaleString('id-ID')}</td>
                <td class="py-3 px-4 text-center font-bold ${b.stok <= 15 ? 'text-amber-400' : 'text-slate-200'}">${b.stok} Pcs</td>
                <td class="py-3 px-4 text-center">${statusBadge}</td>
                <td class="py-2 px-3">
                    <div class="flex justify-center gap-1.5">
                        <button type="button" data-product-action="detail" data-product-id="${escapeHtml(b.id_produk)}" class="p-2 rounded-lg text-cyan-400 hover:bg-cyan-500/10" aria-label="Detail ${escapeHtml(b.nama)}" title="Detail"><i class="fa-solid fa-eye"></i></button>
                        <button type="button" data-product-action="edit" data-product-id="${escapeHtml(b.id_produk)}" class="p-2 rounded-lg text-amber-400 hover:bg-amber-500/10" aria-label="Edit ${escapeHtml(b.nama)}" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button type="button" data-product-action="delete" data-product-id="${escapeHtml(b.id_produk)}" class="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10" aria-label="Hapus ${escapeHtml(b.nama)}" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    renderMenusRestockDropdown();
}

function bindProductActionHandler(tbody) {
    if (tbody.dataset.productActionsBound === 'true') return;
    tbody.dataset.productActionsBound = 'true';
    tbody.addEventListener('click', (event) => {
        const button = event.target.closest('[data-product-action]');
        if (!button) return;
        const { productAction, productId } = button.dataset;
        lastProductActionTrigger = button;
        if (productAction === 'detail') tampilkanDetailProduk(productId);
        if (productAction === 'edit') bukaModalEditProduk(productId);
        if (productAction === 'delete') bukaKonfirmasiHapusProduk(productId);
    });
}

// --- MODAL REGISTRASI PRODUK BARU & VALIDASI FORM (PENGGANTI PROMPT()) ---
export function bukaModalTambahProduk() {
    const modal = document.getElementById('modal-tambah-produk');
    if (!modal) return;
    lastProductActionTrigger = document.activeElement;

    // Reset pesan error form
    resetErrorMessages();
    editingProductId = null;
    configureProductForm(false);

    // Rekomendasi Kode SKU otomatis berurutan
    const nextNum = store.masterStok.length + 1;
    const formattedNum = String(nextNum).padStart(3, '0');
    const autoSku = `BRG-${formattedNum}`;

    const skuInput = document.getElementById('modal-prod-sku');
    const namaInput = document.getElementById('modal-prod-nama');
    const kategoriSelect = document.getElementById('modal-prod-kategori');
    const hargaInput = document.getElementById('modal-prod-harga');
    const stokInput = document.getElementById('modal-prod-stok');

    if (skuInput) skuInput.value = autoSku;
    if (namaInput) {
        namaInput.value = '';
        setTimeout(() => namaInput.focus(), 100);
    }
    if (kategoriSelect) kategoriSelect.value = 'Makanan';
    if (hargaInput) hargaInput.value = '';
    if (stokInput) stokInput.value = '50';

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        const modalBox = modal.querySelector('.modal-box');
        if (modalBox) modalBox.classList.remove('scale-95');
    });
}

export function bukaModalEditProduk(idProduk) {
    const product = store.masterStok.find(item => item.id_produk === idProduk);
    if (!product) {
        showToast('Produk tidak ditemukan pada data inventori. Muat ulang daftar lalu coba kembali.', 'error');
        return;
    }
    const modal = document.getElementById('modal-tambah-produk');
    if (!modal) return;
    lastProductActionTrigger = document.activeElement;
    resetErrorMessages();
    editingProductId = product.id_produk;
    configureProductForm(true);
    document.getElementById('modal-prod-sku').value = product.id_produk;
    document.getElementById('modal-prod-nama').value = product.nama ?? '';
    const category = document.getElementById('modal-prod-kategori');
    const knownCategory = [...category.options].some(option => option.value === (product.kategori || 'Umum'));
    if (!knownCategory) category.add(new Option(product.kategori, product.kategori));
    category.value = product.kategori || 'Umum';
    document.getElementById('modal-prod-harga').value = product.harga ?? '';
    document.getElementById('modal-prod-stok').value = product.stok ?? 0;
    openProductModal(modal);
}

function configureProductForm(isEditing) {
    const title = document.querySelector('#modal-tambah-produk h3');
    const subtitle = document.querySelector('#modal-tambah-produk h3 + p');
    const skuInput = document.getElementById('modal-prod-sku');
    const stockInput = document.getElementById('modal-prod-stok');
    const stockLabel = stockInput?.closest('div')?.parentElement?.querySelector('label');
    const submitButton = document.getElementById('btn-submit-modal-produk');
    if (title) title.textContent = isEditing ? 'Edit Produk' : 'Registrasi SKU Produk Baru';
    if (subtitle) subtitle.textContent = isEditing ? 'Perbarui nama, kategori, atau harga produk' : 'Tambahkan item ke katalog sediaan inventori gudang';
    if (skuInput) skuInput.readOnly = isEditing;
    if (stockInput) stockInput.readOnly = isEditing;
    if (stockLabel) stockLabel.textContent = isEditing ? 'Stok Saat Ini (ubah melalui restock)' : 'Kuantitas Awal Gudang';
    if (submitButton) submitButton.innerHTML = isEditing ? '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan' : '<i class="fa-solid fa-floppy-disk"></i> Simpan Produk SKU';
}

function openProductModal(modal) {
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('.modal-box')?.classList.remove('scale-95');
        document.getElementById('modal-prod-nama')?.focus();
    });
}

export function tampilkanDetailProduk(idProduk) {
    const product = store.masterStok.find(item => item.id_produk === idProduk);
    if (!product) {
        showToast('Produk tidak ditemukan pada data inventori. Muat ulang daftar lalu coba kembali.', 'error');
        return;
    }
    const modal = document.getElementById('modal-detail-produk');
    const fields = document.getElementById('detail-produk-fields');
    const labels = { id_produk: 'Kode SKU', nama: 'Nama Produk', kategori: 'Kategori', harga: 'Harga Jual', stok: 'Stok Saat Ini', created_at: 'Dibuat', updated_at: 'Diperbarui' };
    fields.replaceChildren();
    Object.entries(product).forEach(([key, value]) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'rounded-xl border border-slate-800 bg-slate-950/40 p-3';
        const label = document.createElement('dt');
        label.className = 'text-[10px] uppercase tracking-wider text-slate-400';
        label.textContent = labels[key] || key;
        const detail = document.createElement('dd');
        detail.className = 'mt-1 break-words text-sm text-white';
        detail.textContent = value == null ? '—' : key === 'harga' ? `Rp ${Number(value).toLocaleString('id-ID')}` : String(value);
        wrapper.append(label, detail);
        fields.append(wrapper);
    });
    modal.classList.remove('hidden');
    modal.querySelector('[data-close-product-detail]')?.focus();
}

function closeDetailModal() {
    document.getElementById('modal-detail-produk')?.classList.add('hidden');
    lastProductActionTrigger?.focus();
}

function bukaKonfirmasiHapusProduk(idProduk) {
    const product = store.masterStok.find(item => item.id_produk === idProduk);
    if (!product) {
        showToast('Produk tidak ditemukan pada data inventori. Muat ulang daftar lalu coba kembali.', 'error');
        return;
    }
    pendingDeleteProductId = product.id_produk;
    document.getElementById('hapus-produk-nama').textContent = `${product.nama} (${product.id_produk})`;
    document.getElementById('hapus-produk-error').textContent = '';
    document.getElementById('modal-hapus-produk').classList.remove('hidden');
    document.getElementById('btn-batal-hapus-produk').focus();
}

function tutupKonfirmasiHapusProduk() {
    if (isDeletingProduct) return;
    document.getElementById('modal-hapus-produk')?.classList.add('hidden');
    pendingDeleteProductId = null;
    lastProductActionTrigger?.focus();
}

async function konfirmasiHapusProduk() {
    const idProduk = pendingDeleteProductId;
    const product = store.masterStok.find(item => item.id_produk === idProduk);
    const button = document.getElementById('btn-konfirmasi-hapus-produk');
    const errorEl = document.getElementById('hapus-produk-error');
    if (!idProduk || !product || button.disabled) return;
    if (!navigator.onLine) {
        errorEl.textContent = 'Perangkat sedang offline. Hubungkan ke internet sebelum menghapus produk.';
        return;
    }
    if (store.keranjangPOS.some(item => item.id === idProduk)) {
        errorEl.textContent = 'Produk masih ada di keranjang aktif. Hapus produk dari keranjang sebelum menghapusnya dari inventori.';
        return;
    }
    button.disabled = true;
    isDeletingProduct = true;
    document.getElementById('btn-batal-hapus-produk').disabled = true;
    const oldText = button.innerHTML;
    button.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-2"></i>Menghapus...';
    errorEl.textContent = '';
    try {
        const pending = await getPendingTransactions();
        const queuedReference = pending.some(transaction => transaction.payload?.p_items?.some(item => item.id === idProduk));
        if (queuedReference) throw new Error('Produk masih dipakai oleh transaksi offline yang belum tersinkron. Sinkronkan transaksi tersebut sebelum menghapus produk.');

        const { data, error } = await panggilDatabaseAman({
            tabel: 'produk', aksi: 'DELETE', filterKolom: 'id_produk', filterNilai: idProduk
        });
        if (error) {
            if (error.code === '23503') throw new Error('Produk masih memiliki relasi data dan tidak dapat dihapus. Riwayat terkait tetap dipertahankan.');
            throw error;
        }
        if (!Array.isArray(data) || data.length !== 1) throw new Error('Produk tidak ditemukan atau tidak dapat dihapus. Daftar inventori tidak diubah.');

        store.removeProductFromState(idProduk);
        await cacheLocalData('master_stok', store.masterStok);
        renderTabelStok();
        renderMenusRestockDropdown();
        document.getElementById('pos-produk-dropdown')?.classList.add('hidden');
        const selectedSku = document.getElementById('pos-produk-selected-id');
        if (selectedSku?.value === idProduk) {
            selectedSku.value = '';
            document.getElementById('pos-produk-search').value = '';
        }
        isDeletingProduct = false;
        tutupKonfirmasiHapusProduk();
        showToast(`Produk ${product.nama} berhasil dihapus dari inventori. Riwayat transaksi tidak diubah.`, 'success');
    } catch (error) {
        console.error('Gagal menghapus produk:', error);
        errorEl.textContent = error.message?.includes('masih dipakai') || error.message?.includes('masih memiliki')
            ? error.message
            : error.code === '23503'
                ? 'Produk memiliki relasi yang mencegah penghapusan. Data inventori tetap dipertahankan.'
                : 'Produk gagal dihapus karena gangguan database atau jaringan. Data inventori tetap dipertahankan.';
    } finally {
        isDeletingProduct = false;
        button.disabled = false;
        document.getElementById('btn-batal-hapus-produk').disabled = false;
        button.innerHTML = oldText;
    }
}

function initProductActionListeners() {
    document.getElementById('btn-batal-hapus-produk')?.addEventListener('click', tutupKonfirmasiHapusProduk);
    document.getElementById('btn-konfirmasi-hapus-produk')?.addEventListener('click', konfirmasiHapusProduk);
    document.querySelectorAll('[data-close-product-detail]').forEach(button => button.addEventListener('click', closeDetailModal));
    document.getElementById('modal-detail-produk')?.addEventListener('click', event => {
        if (event.target.id === 'modal-detail-produk') closeDetailModal();
    });
    document.getElementById('modal-hapus-produk')?.addEventListener('click', event => {
        if (event.target.id === 'modal-hapus-produk') tutupKonfirmasiHapusProduk();
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (!document.getElementById('modal-hapus-produk')?.classList.contains('hidden')) tutupKonfirmasiHapusProduk();
        else if (!document.getElementById('modal-detail-produk')?.classList.contains('hidden')) closeDetailModal();
    });
}

initProductActionListeners();

export function tutupModalTambahProduk() {
    const modal = document.getElementById('modal-tambah-produk');
    if (!modal) return;

    modal.classList.add('opacity-0');
    const modalBox = modal.querySelector('.modal-box');
    if (modalBox) modalBox.classList.add('scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
        lastProductActionTrigger?.focus?.();
    }, 250);
    editingProductId = null;
}

function resetErrorMessages() {
    document.querySelectorAll('.form-error-msg').forEach(el => el.innerText = '');
    document.querySelectorAll('.form-input-highlight').forEach(el => el.classList.remove('border-rose-500'));
}

export async function simpanProdukBaruModal() {
    const skuInput = document.getElementById('modal-prod-sku');
    const namaInput = document.getElementById('modal-prod-nama');
    const kategoriSelect = document.getElementById('modal-prod-kategori');
    const hargaInput = document.getElementById('modal-prod-harga');
    const stokInput = document.getElementById('modal-prod-stok');
    const submitBtn = document.getElementById('btn-submit-modal-produk');
    if (submitBtn?.disabled) return;
    if (!navigator.onLine) {
        showToast('Perangkat sedang offline. Hubungkan ke internet sebelum menyimpan produk.', 'warning');
        return;
    }

    resetErrorMessages();

    const validation = validateProductFields({
        sku: skuInput?.value,
        nama: namaInput?.value,
        kategori: kategoriSelect?.value,
        harga: hargaInput?.value,
        stok: stokInput?.value
    }, { editing: Boolean(editingProductId), existingProducts: store.masterStok });
    Object.entries(validation.errors).forEach(([field, message]) => {
        const ids = { sku: ['modal-prod-sku', 'error-prod-sku'], nama: ['modal-prod-nama', 'error-prod-nama'], harga: ['modal-prod-harga', 'error-prod-harga'], stok: ['modal-prod-stok', 'error-prod-stok'] };
        setFieldError(...ids[field], message);
    });
    if (!validation.valid) return;

    const { id_produk: skuVal, nama: namaVal, kategori: kategoriVal, harga: hargaVal, stok: stokVal } = validation.product;

    const originalText = submitBtn ? submitBtn.innerHTML : "Simpan Produk";

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Menyimpan...`;
    }

    const produkBaru = validation.product;

    try {
        const editing = Boolean(editingProductId);
        const result = editing
            ? await panggilDatabaseAman({ tabel: 'produk', aksi: 'UPDATE', data: { nama: namaVal, kategori: kategoriVal, harga: hargaVal }, filterKolom: 'id_produk', filterNilai: editingProductId })
            : await panggilDatabaseAman({ tabel: 'produk', aksi: 'INSERT', data: [produkBaru] });
        if (result.error) throw result.error;
        if (!Array.isArray(result.data) || result.data.length !== 1) {
            throw new Error(editing ? 'Produk tidak ditemukan atau tidak dapat diperbarui.' : 'Database tidak mengembalikan produk yang tersimpan.');
        }

        const savedProduct = result.data[0];
        store.upsertProductInState(savedProduct);
        await cacheLocalData('master_stok', store.masterStok);
        renderTabelStok();
        renderMenusRestockDropdown();
        window.filterProdukPOS?.();

        showToast(editing ? `Produk "${savedProduct.nama}" berhasil diperbarui.` : `SKU [${skuVal}] "${namaVal}" berhasil didaftarkan ke gudang!`, "success");
        tutupModalTambahProduk();

    } catch (err) {
        console.error("Gagal menambahkan SKU baru:", err);
        showToast(err.code === '23505' ? 'Kode SKU tersebut sudah digunakan produk lain.' : 'Produk gagal disimpan karena gangguan database atau jaringan. Data formulir tetap tersedia.', "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }
}

function setFieldError(inputId, errorId, message) {
    const input = document.getElementById(inputId);
    const errorEl = document.getElementById(errorId);
    if (input) input.classList.add('border-rose-500');
    if (errorEl) errorEl.innerText = message;
}

// --- RESTOCK BARANG MASUK ---
export async function eksekusiRestockBarang() {
    const produkIdEl = document.getElementById('restock-produk');
    const supplierIdEl = document.getElementById('restock-supplier');
    const qtyInput = document.getElementById('restock-qty');

    const produkId = produkIdEl ? produkIdEl.value : '';
    const supplierId = supplierIdEl ? supplierIdEl.value : '';
    const qtyMasuk = parseInt(qtyInput ? qtyInput.value : '0', 10);

    if (isNaN(qtyMasuk) || qtyMasuk < 1) {
        showToast("Masukkan kuantitas restock masuk yang valid (minimal 1 pcs)!", "warning");
        return;
    }

    const produkTarget = store.masterStok.find(b => b.id_produk === produkId);
    const supplierTarget = store.masterSupplier.find(s => s.id_supplier === supplierId);

    if (!produkTarget) {
        showToast("Pilih produk yang ingin direstock terlebih dahulu!", "warning");
        return;
    }

    const kuantitasBaru = produkTarget.stok + qtyMasuk;

    const restockBtn = document.querySelector('button[onclick="eksekusiRestockBarang()"]') ||
                       document.querySelector('#tab-supplier button.from-amber-500');
    const originalText = restockBtn ? restockBtn.innerHTML : "Konfirmasi Pasokan Masuk";

    if (restockBtn) {
        restockBtn.disabled = true;
        restockBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Mengupdate Pasokan...`;
    }

    try {
        const { error } = await panggilDatabaseAman({
            tabel: 'produk',
            aksi: 'UPDATE',
            data: { stok: kuantitasBaru },
            filterKolom: 'id_produk',
            filterNilai: produkId
        });

        if (error) throw error;

        store.updateSingleProductStock(produkId, kuantitasBaru);
        renderTabelStok();

        showToast(`[RESTOCK SUKSES] Produk: ${produkTarget.nama} (+${qtyMasuk} pcs). Total Stok: ${kuantitasBaru} pcs`, "success", 4000);
        if (qtyInput) qtyInput.value = "50";

    } catch (err) {
        console.error("Gagal restock:", err);
        showToast("Gagal melakukan restock barang: " + (err.message || err), "error");
    } finally {
        if (restockBtn) {
            restockBtn.disabled = false;
            restockBtn.innerHTML = originalText;
        }
    }
}

// --- DUKUNGAN SCAN BARCODE SKU (DARI URL ATAU LOCALSTORAGE) ---
export async function ensureScannedSkuInSupabase() {
    const params = new URLSearchParams(window.location.search);
    const scannedSku = params.get('sku') || localStorage.getItem('last_scanned_sku');
    if (!scannedSku) return false;

    const trimmedSku = scannedSku.trim();
    if (!trimmedSku) return false;

    const note = params.get('note') || localStorage.getItem('last_scanned_note') || '';
    const qtyFromParams = parseInt(params.get('qty') || localStorage.getItem('last_scanned_qty') || '1', 10);
    const qtyToAdd = Number.isFinite(qtyFromParams) && qtyFromParams > 0 ? qtyFromParams : 1;

    const existingProduct = store.masterStok.find(item => item.id_produk?.toString().toLowerCase() === trimmedSku.toLowerCase());
    const baseName = note ? `Produk ${trimmedSku} (${note})` : `Produk ${trimmedSku}`;

    try {
        if (existingProduct) {
            const nextQty = (Number(existingProduct.stok) || 0) + qtyToAdd;
            const { error } = await panggilDatabaseAman({
                tabel: 'produk',
                aksi: 'UPDATE',
                data: {
                    stok: nextQty,
                    nama: note ? `${existingProduct.nama || baseName} (${note})` : existingProduct.nama || baseName
                },
                filterKolom: 'id_produk',
                filterNilai: existingProduct.id_produk
            });

            if (error) throw error;

            existingProduct.stok = nextQty;
            if (note) existingProduct.nama = `${existingProduct.nama || baseName} (${note})`;
            store.upsertProductInState(existingProduct);
        } else {
            const newProduct = {
                id_produk: trimmedSku,
                nama: baseName,
                kategori: 'Scan',
                harga: 0,
                stok: qtyToAdd
            };

            const { data, error } = await panggilDatabaseAman({
                tabel: 'produk',
                aksi: 'INSERT',
                data: [newProduct]
            });
            if (error) throw error;

            store.upsertProductInState((data && data[0]) ? data[0] : newProduct);
        }

        localStorage.removeItem('last_scanned_sku');
        localStorage.removeItem('last_scanned_note');
        localStorage.removeItem('last_scanned_qty');
        renderTabelStok();
        renderMenusRestockDropdown();
        return true;
    } catch (err) {
        console.error('Gagal memproses SKU hasil scan barcode:', err);
        return false;
    }
}

export function applyScannedSkuToPOS() {
    const searchInput = document.getElementById('pos-produk-search');
    const selectedIdInput = document.getElementById('pos-produk-selected-id');
    if (!searchInput || !selectedIdInput) return;

    const params = new URLSearchParams(window.location.search);
    const scannedSku = params.get('sku') || localStorage.getItem('last_scanned_sku');
    if (!scannedSku) return;

    const trimmedSku = scannedSku.trim();
    const product = store.masterStok.find(item => item.id_produk?.toString().toLowerCase() === trimmedSku.toLowerCase());

    if (product) {
        selectedIdInput.value = product.id_produk;
        searchInput.value = `[${product.id_produk}] ${product.nama} - Rp ${Number(product.harga).toLocaleString('id-ID')}`;
    } else {
        selectedIdInput.value = trimmedSku;
        searchInput.value = trimmedSku;
    }

    searchInput.focus();
    localStorage.removeItem('last_scanned_sku');
    localStorage.removeItem('last_scanned_note');
    localStorage.removeItem('last_scanned_qty');
    window.history.replaceState({}, '', window.location.pathname);
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
