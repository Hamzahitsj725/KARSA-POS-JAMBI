/**
 * KARSA POS - Supplier & Procurement Logistics Module
 * Mengelola daftar distributor rekanan dan opsi pengadaan pasokan barang
 */

import { store } from '../services/state.js';
import { panggilDatabaseAman } from '../services/db.js';
import { cacheLocalData } from '../services/offlineQueue.js';
import { showToast } from '../services/notification.js';

export function initSupplierForm() {
    const form = document.getElementById('form-tambah-supplier');
    const panel = document.getElementById('panel-tambah-supplier');
    const openButton = document.getElementById('btn-tambah-supplier');
    const cancelButton = document.getElementById('btn-batal-supplier');
    const errorMessage = document.getElementById('error-tambah-supplier');
    const submitButton = document.getElementById('btn-submit-supplier');
    if (!form || !panel || !openButton || form.dataset.initialized) return;
    form.dataset.initialized = 'true';

    openButton.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        openButton.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
        if (!panel.classList.contains('hidden')) document.getElementById('supplier-id')?.focus();
    });
    cancelButton?.addEventListener('click', () => {
        panel.classList.add('hidden');
        openButton.setAttribute('aria-expanded', 'false');
        errorMessage.textContent = '';
    });
    form.addEventListener('input', () => {
        if (errorMessage) errorMessage.textContent = '';
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submitButton?.disabled) return;
        if (!navigator.onLine) {
            if (errorMessage) errorMessage.textContent = 'Perangkat sedang offline. Supplier belum disimpan; hubungkan internet lalu coba kembali.';
            return;
        }

        const supplier = {
            id_supplier: document.getElementById('supplier-id').value.trim(),
            nama: document.getElementById('supplier-nama').value.trim(),
            kategori: document.getElementById('supplier-kategori').value.trim() || 'Distributor',
            kontak: document.getElementById('supplier-kontak').value.trim()
        };
        if (!supplier.id_supplier || !supplier.nama || !supplier.kontak) {
            if (errorMessage) errorMessage.textContent = 'ID vendor, nama perusahaan, dan kontak wajib diisi.';
            return;
        }

        if (submitButton) submitButton.disabled = true;
        if (errorMessage) errorMessage.textContent = '';
        try {
            const result = await panggilDatabaseAman({ tabel: 'supplier', aksi: 'INSERT', data: supplier });
            const savedSupplier = Array.isArray(result.data) ? result.data[0] : null;
            if (result.error || !savedSupplier) throw result.error || new Error('Data supplier tidak dikonfirmasi oleh database.');

            const updatedSuppliers = [...store.masterSupplier, savedSupplier]
                .sort((first, second) => (first.id_supplier || '').localeCompare(second.id_supplier || ''));
            store.setMasterSupplier(updatedSuppliers);
            renderTabelSupplier();
            renderMenusRestockDropdown();
            await cacheLocalData('master_supplier', updatedSuppliers);
            form.reset();
            panel.classList.add('hidden');
            openButton.setAttribute('aria-expanded', 'false');
            showToast('Supplier berhasil disimpan.', 'success');
        } catch {
            if (errorMessage) errorMessage.textContent = 'Supplier gagal disimpan. Periksa ID vendor, koneksi, dan izin akun. Input tetap tersedia untuk diperbaiki.';
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}

export function renderTabelSupplier() {
    const tbody = document.getElementById('supplier-table-body');
    if (!tbody) return;

    const masterSupplier = store.masterSupplier;

    if (masterSupplier.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-xs text-slate-500 italic">Belum ada distributor rekanan terdaftar.</td></tr>`;
        return;
    }

    tbody.innerHTML = masterSupplier.map(s => `
        <tr class="hover:bg-slate-900/30">
            <td class="py-3 px-4 font-mono text-xs text-amber-400 font-bold">${escapeHtml(s.id_supplier)}</td>
            <td class="py-3 px-4 font-medium text-white font-semibold">${escapeHtml(s.nama)}</td>
            <td class="py-3 px-4 text-xs text-slate-400">${escapeHtml(s.kategori || 'Distributor')}</td>
            <td class="py-3 px-4 text-xs text-slate-400">${escapeHtml(s.kontak || '-')}</td>
        </tr>
    `).join('');
}

export function renderMenusRestockDropdown() {
    const pSelect = document.getElementById('restock-produk');
    const sSelect = document.getElementById('restock-supplier');
    if (!pSelect || !sSelect) return;

    const masterStok = store.masterStok;
    const masterSupplier = store.masterSupplier;

    if (masterStok.length === 0) {
        pSelect.innerHTML = `<option value="">(Belum ada produk di database)</option>`;
    } else {
        pSelect.innerHTML = masterStok.map(b => `
            <option value="${b.id_produk}">[${b.id_produk}] ${escapeHtml(b.nama)} (Sisa: ${b.stok} pcs)</option>
        `).join('');
    }

    if (masterSupplier.length === 0) {
        sSelect.innerHTML = `<option value="">(Belum ada supplier terdaftar)</option>`;
    } else {
        sSelect.innerHTML = masterSupplier.map(s => `
            <option value="${s.id_supplier}">[${s.id_supplier}] ${escapeHtml(s.nama)} (${escapeHtml(s.kategori || 'Distributor')})</option>
        `).join('');
    }
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
