/**
 * KARSA POS - POS Cashier Engine Module
 * Mengelola keranjang belanja, pencarian SKU, transaksi atomic RPC Supabase,
 * dan antrian offline fallback saat jaringan kasir terputus.
 */

import { supabaseClient } from '../config/supabase.js';
import { panggilDatabaseAman } from '../services/db.js';
import { store } from '../services/state.js';
import { showToast } from '../services/notification.js';
import { queueOfflineTransaction } from '../services/offlineQueue.js';
import { renderTabelStok } from './inventory.js';
import { renderTabelMember } from './members.js';
import { kalkulasiLaporanDashboard } from './reports.js';

let checkoutInProgress = false;

const formatRupiah = (value) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`;

function updateCashPaymentUI() {
    const inputBayar = document.getElementById('pos-bayar');
    const metodeSelect = document.getElementById('pos-metode-bayar');
    const quickCash = document.getElementById('container-quick-cash');
    const feedback = document.getElementById('pos-cash-feedback');
    const checkoutBtn = document.getElementById('btn-checkout-pos');
    if (!inputBayar || !metodeSelect || !checkoutBtn) return;

    const total = store.keranjangPOS.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const isCash = metodeSelect.value === 'Tunai';
    const amountText = String(inputBayar.value ?? '').trim();
    const amount = amountText === '' ? NaN : Number(amountText);
    const hasCart = store.keranjangPOS.length > 0 && total > 0;

    if (quickCash) quickCash.hidden = !isCash;
    if (feedback) {
        feedback.hidden = !isCash;
        if (!hasCart) {
            feedback.dataset.state = 'neutral';
            feedback.textContent = 'Tambahkan item ke keranjang untuk menghitung pembayaran.';
        } else if (!Number.isFinite(amount) || amount < 0) {
            feedback.dataset.state = 'neutral';
            feedback.textContent = 'Masukkan nominal uang diterima.';
        } else if (amount < total) {
            feedback.dataset.state = 'error';
            feedback.textContent = `Kurang ${formatRupiah(total - amount)}.`;
        } else {
            feedback.dataset.state = 'success';
            feedback.textContent = `Kembalian ${formatRupiah(amount - total)}.`;
        }
    }

    document.querySelectorAll('[data-cash-amount]').forEach((button) => {
        const value = button.dataset.cashAmount === 'exact' ? total : Number(button.dataset.cashAmount);
        const selected = isCash && hasCart && Number.isFinite(amount) && amount === value;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });

    const ref = document.getElementById('pos-ref')?.value.trim() || '';
    const validPayment = isCash
        ? Number.isFinite(amount) && amount >= total
        : Number.isFinite(amount) && amount >= total && Boolean(ref);
    checkoutBtn.disabled = checkoutInProgress || !hasCart || !validPayment;
}

export function initQuickCash() {
    const inputBayar = document.getElementById('pos-bayar');
    if (!inputBayar || inputBayar.dataset.quickCashBound) return;
    inputBayar.dataset.quickCashBound = 'true';
    inputBayar.addEventListener('input', updateCashPaymentUI);

    document.querySelectorAll('[data-cash-amount]').forEach((button) => {
        button.addEventListener('click', () => {
            const total = store.keranjangPOS.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
            inputBayar.value = button.dataset.cashAmount === 'exact' ? String(total) : button.dataset.cashAmount;
            updateCashPaymentUI();
        });
    });

    document.querySelector('[data-cash-custom]')?.addEventListener('click', () => {
        inputBayar.value = '';
        inputBayar.focus();
        updateCashPaymentUI();
    });

    document.getElementById('pos-ref')?.addEventListener('input', updateCashPaymentUI);
    updateCashPaymentUI();
}

// --- PENCARIAN & AUTOCOMPLETE PRODUK POS ---
export function renderDaftarProdukPOS() {
    filterProdukPOS();
}

export function filterProdukPOS() {
    const searchInput = document.getElementById('pos-produk-search');
    const dropdown = document.getElementById('pos-produk-dropdown');
    if (!searchInput || !dropdown) return;

    const keyword = searchInput.value.toLowerCase().trim();
    const masterStok = store.masterStok;

    const filtered = masterStok.filter(b =>
        (b.id_produk && b.id_produk.toLowerCase().includes(keyword)) ||
        (b.nama && b.nama.toLowerCase().includes(keyword)) ||
        (b.kategori && b.kategori.toLowerCase().includes(keyword))
    );

    if (filtered.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-slate-500 italic text-xs">Produk tidak ditemukan</div>`;
    } else {
        dropdown.innerHTML = filtered.slice(0, 15).map(b => `
            <div data-sku="${b.id_produk}" data-nama="${escapeHtml(b.nama)}" data-harga="${b.harga}"
                 class="pos-product-item p-3 hover:bg-slate-800/80 cursor-pointer flex justify-between items-center transition-all">
                <div>
                    <span class="font-mono text-xs text-cyan-400 font-bold">[${b.id_produk}]</span>
                    <span class="text-slate-200 ml-1 font-medium">${escapeHtml(b.nama)}</span>
                </div>
                <div class="text-right">
                    <span class="text-[10px] ${b.stok <= 5 ? 'text-rose-400 font-bold' : 'text-slate-400'} block">Sisa: ${b.stok} pcs</span>
                    <span class="text-emerald-400 font-semibold text-xs">Rp ${Number(b.harga).toLocaleString('id-ID')}</span>
                </div>
            </div>
        `).join('');

        // Pasang event listener ke elemen hasil pencarian
        dropdown.querySelectorAll('.pos-product-item').forEach(el => {
            el.addEventListener('click', () => {
                const sku = el.getAttribute('data-sku');
                const nama = el.getAttribute('data-nama');
                const harga = parseFloat(el.getAttribute('data-harga')) || 0;
                pilihProdukPOS(sku, nama, harga);
            });
        });
    }

    if (document.activeElement === searchInput) {
        dropdown.classList.remove('hidden');
    }
}

export function pilihProdukPOS(id, nama, harga) {
    const selectedIdInput = document.getElementById('pos-produk-selected-id');
    const searchInput = document.getElementById('pos-produk-search');
    const dropdown = document.getElementById('pos-produk-dropdown');

    if (selectedIdInput) selectedIdInput.value = id;
    if (searchInput) searchInput.value = `[${id}] ${nama} - Rp ${harga.toLocaleString('id-ID')}`;
    if (dropdown) dropdown.classList.add('hidden');

    const qtyInput = document.getElementById('pos-qty');
    if (qtyInput) qtyInput.focus();
}

// --- PENCARIAN & AUTOCOMPLETE MEMBER POS ---
export function handleCustomerSearch() {
    const customerInput = document.getElementById('pos-customer');
    const dropdown = document.getElementById('pos-customer-dropdown');
    if (!customerInput || !dropdown) return;

    const query = customerInput.value.trim().toLowerCase();
    if (query === "") {
        dropdown.classList.add('hidden');
        return;
    }

    const masterMember = store.masterMember;
    const matches = masterMember.filter(m =>
        (m.nama && m.nama.toLowerCase().includes(query)) ||
        (m.id_member && m.id_member.toLowerCase().includes(query))
    );

    if (matches.length === 0) {
        dropdown.innerHTML = `<div class="p-3 text-slate-500 italic text-xs">Tidak ada member terdaftar dengan nama ini.</div>`;
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = matches.slice(0, 10).map(m => `
        <div data-member-name="${escapeHtml(m.nama)}" class="pos-member-item px-3 py-2 hover:bg-slate-800/80 cursor-pointer text-sm text-slate-200 flex justify-between items-center">
            <div>
                <span class="font-mono text-[10px] text-cyan-400 font-bold">${m.id_member}</span>
                <span class="ml-2 font-medium">${escapeHtml(m.nama)}</span>
            </div>
            <span class="text-[11px] text-amber-400">${m.poin || 0} Pts</span>
        </div>
    `).join('');

    dropdown.querySelectorAll('.pos-member-item').forEach(el => {
        el.addEventListener('click', () => {
            pilihMemberPOS(el.getAttribute('data-member-name'));
        });
    });

    dropdown.classList.remove('hidden');
}

export function pilihMemberPOS(nama) {
    const customerInput = document.getElementById('pos-customer');
    const dropdown = document.getElementById('pos-customer-dropdown');

    if (customerInput) customerInput.value = nama;
    if (dropdown) dropdown.classList.add('hidden');
}

// --- METODE PEMBAYARAN & REKAP ---
export function handleMetodeBayarChange() {
    const metodeSelect = document.getElementById('pos-metode-bayar');
    const containerRef = document.getElementById('container-ref-bayar');
    const inputBayar = document.getElementById('pos-bayar');
    const labelNominal = document.getElementById('label-nominal-bayar');
    if (!metodeSelect || !inputBayar || !labelNominal) return;

    const metode = metodeSelect.value;
    const total = store.keranjangPOS.reduce((sum, item) => sum + item.subtotal, 0);

    if (metode === "Tunai") {
        labelNominal.innerText = "Nominal Uang Tunai Pembeli (Rp)";
        inputBayar.value = '';
        inputBayar.readOnly = false;
        if (containerRef) containerRef.classList.add('hidden');
    } else {
        labelNominal.innerText = "Nominal Mutasi Non-Tunai (Rp)";
        inputBayar.value = total;
        inputBayar.readOnly = true;
        if (containerRef) containerRef.classList.remove('hidden');
    }
    updateCashPaymentUI();
}

// --- LOGIKA KERANJANG BELANJA ---
export function tambahItemKeranjang() {
    const pIdInput = document.getElementById('pos-produk-selected-id');
    const pId = pIdInput ? pIdInput.value : '';
    if (!pId) {
        showToast("Silakan ketik dan pilih produk terlebih dahulu melalui daftar pencarian!", "warning");
        return;
    }

    const qtyInput = document.getElementById('pos-qty');
    const qty = parseInt(qtyInput ? qtyInput.value : '1', 10);
    if (isNaN(qty) || qty < 1) {
        showToast("Isi kuantitas belanja dengan benar (minimal 1)!", "warning");
        return;
    }

    const produk = store.masterStok.find(b => b.id_produk === pId);
    if (!produk) {
        showToast("Produk tidak ditemukan di database gudang!", "error");
        return;
    }

    const existingInCart = store.keranjangPOS.find(item => item.id === pId);
    const totalQtyRequested = (existingInCart ? existingInCart.qty : 0) + qty;

    if (produk.stok < totalQtyRequested) {
        showToast(`Stok gudang tidak cukup! Sisa stok SKU [${produk.id_produk}]: ${produk.stok} pcs`, "error");
        return;
    }

    store.addToKeranjang({
        id: produk.id_produk,
        nama: produk.nama,
        harga: Number(produk.harga),
        qty: qty,
        subtotal: Number(produk.harga) * qty
    });

    // Reset input pencarian
    const searchInput = document.getElementById('pos-produk-search');
    if (searchInput) searchInput.value = '';
    if (pIdInput) pIdInput.value = '';
    if (qtyInput) qtyInput.value = '1';

    renderTabelKeranjangPOS();
    showToast(`"${produk.nama}" (+${qty}) dimasukkan ke keranjang`, "info", 1800);
}

export function hapusItemKeranjang(idx) {
    store.removeFromKeranjang(idx);
    renderTabelKeranjangPOS();
}

export function renderTabelKeranjangPOS() {
    const tbody = document.getElementById('cart-table-body');
    const grandTotalEl = document.getElementById('pos-grand-total');
    if (!tbody) return;

    const keranjang = store.keranjangPOS;

    if (keranjang.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-xs text-slate-500 italic">Keranjang belanja kosong.</td></tr>`;
        if (grandTotalEl) grandTotalEl.innerText = "Rp 0";
        if (document.getElementById('pos-metode-bayar')?.value !== 'Tunai') {
            const inputBayar = document.getElementById('pos-bayar');
            if (inputBayar) inputBayar.value = '0';
        }
        updateCashPaymentUI();
        return;
    }

    let gTotal = 0;
    tbody.innerHTML = keranjang.map((item, idx) => {
        gTotal += item.subtotal;
        return `
            <tr class="hover:bg-slate-900/30">
                <td class="py-3 px-4 font-medium text-white">${escapeHtml(item.nama)}</td>
                <td class="py-3 px-4 text-right">Rp ${item.harga.toLocaleString('id-ID')}</td>
                <td class="py-3 px-4 text-center font-bold text-cyan-400">${item.qty}</td>
                <td class="py-3 px-4 text-right font-semibold text-white">Rp ${item.subtotal.toLocaleString('id-ID')}</td>
                <td class="py-3 px-4 text-center">
                    <button data-cart-index="${idx}" class="btn-delete-cart p-1 text-slate-500 hover:text-rose-400 smooth-transition" title="Hapus Item">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Attach listeners
    tbody.querySelectorAll('.btn-delete-cart').forEach(btn => {
        btn.addEventListener('click', () => {
            const index = parseInt(btn.getAttribute('data-cart-index'), 10);
            hapusItemKeranjang(index);
        });
    });

    if (grandTotalEl) grandTotalEl.innerText = formatRupiah(gTotal);

    const metodeSelect = document.getElementById('pos-metode-bayar');
    const inputBayar = document.getElementById('pos-bayar');
    if (metodeSelect && inputBayar && metodeSelect.value !== "Tunai") {
        inputBayar.value = gTotal;
    }
    updateCashPaymentUI();
}

// --- CETAK STRUK FISIK (58mm KASIR) ---
export function cetakStrukKePrinterFisik(notaData, isOffline = false) {
    const receiptArea = document.getElementById('print-receipt-area');
    if (!receiptArea) {
        console.warn("Elemen #print-receipt-area tidak ditemukan di DOM!");
        return;
    }

    const itemLines = (notaData.items || []).map(item => {
        return `${item.nama}\n${item.qty} pcs x Rp ${Number(item.harga).toLocaleString('id-ID')} = Rp ${Number(item.subtotal).toLocaleString('id-ID')}`;
    }).join('\n--------------------------------\n');

    const userName = document.getElementById('user-display-name')?.innerText || 'Kasir';
    const userRole = document.getElementById('user-display-role')?.innerText || 'Staff';

    receiptArea.innerHTML = `
<div style="text-align: center; font-weight: bold; font-size: 13px; margin-bottom: 3px;">KARSA POS</div>
<div style="text-align: center; margin-bottom: 8px; font-size: 9px;">Jl. Raya Terpadu No. 67, Jambi</div>
${isOffline ? '<div style="text-align: center; font-size: 8px; font-weight: bold; padding: 2px; border: 1px dashed #000; margin-bottom: 6px;">[MODE OFFLINE - TERSIMPAN DI KASIR]</div>' : ''}
<div>Nota  : ${notaData.nota}</div>
<div>Waktu : ${notaData.waktu}</div>
<div>Kasir : ${userName} (${userRole})</div>
<div>Cust  : ${notaData.pembeli}</div>
<div>Jenis : ${notaData.metode}</div>
${notaData.ref ? `<div>No.Ref: ${notaData.ref}</div>` : ''}
<div style="margin: 4px 0; border-top: 1px dashed #000;"></div>
<div style="white-space: pre-wrap;">${itemLines}</div>
<div style="margin: 4px 0; border-top: 1px dashed #000;"></div>
<div style="display: flex; justify-content: space-between; font-weight: bold;"><span>TOTAL:</span><span>Rp ${Number(notaData.total).toLocaleString('id-ID')}</span></div>
<div style="display: flex; justify-content: space-between;"><span>BAYAR:</span><span>Rp ${Number(notaData.bayar).toLocaleString('id-ID')}</span></div>
<div style="display: flex; justify-content: space-between;"><span>KEMBALI:</span><span>Rp ${Number(notaData.kembalian).toLocaleString('id-ID')}</span></div>
<div style="margin: 8px 0 4px 0; border-top: 1px dashed #000;"></div>
<div style="text-align: center; font-size: 9px; margin-top: 4px;">-- TERIMA KASIH ATAS KUNJUNGAN ANDA --</div>
    `;

    // Beri sedikit jeda mikro agar DOM dirender sempurna sebelum dialog print muncul
    setTimeout(() => {
        try {
            window.print();
        } catch (e) {
            console.warn("Gagal membuka dialog print browser:", e);
        }
    }, 120);
}

// --- CHECKOUT ATOMIC POS (RPC SUPABASE & FALLBACK TABLE MODE) ---
export async function prosesCheckoutPOS() {
    if (checkoutInProgress) return;
    const keranjang = store.keranjangPOS;
    if (keranjang.length === 0) {
        showToast("Keranjang belanja masih kosong! Pilih produk terlebih dahulu.", "warning");
        return;
    }

    const bayarInput = document.getElementById('pos-bayar');
    const metodeSelect = document.getElementById('pos-metode-bayar');
    const refInput = document.getElementById('pos-ref');
    const custInput = document.getElementById('pos-customer');

    const bayar = bayarInput && bayarInput.value.trim() !== '' ? Number(bayarInput.value) : NaN;
    const metode = metodeSelect ? metodeSelect.value : 'Tunai';
    const ref = refInput ? refInput.value.trim() : '';
    const total = keranjang.reduce((sum, item) => sum + item.subtotal, 0);

    if (!Number.isFinite(total) || total <= 0) {
        showToast("Total transaksi harus lebih dari Rp 0 sebelum checkout.", "warning");
        updateCashPaymentUI();
        return;
    }

    if (!Number.isFinite(bayar) || bayar < total) {
        showToast(`Nominal pembayaran belum mencukupi! Total: Rp ${total.toLocaleString('id-ID')}`, "warning");
        updateCashPaymentUI();
        return;
    }

    if (metode !== "Tunai" && !ref) {
        showToast("Silakan isi Nomor Referensi / Trace ID transaksi pembayaran non-tunai!", "warning");
        if (refInput) refInput.focus();
        return;
    }

    const customer = custInput && custInput.value.trim() ? custInput.value.trim() : "Pembeli Umum";
    const rincian = keranjang.map(i => `${i.nama} (${i.qty})`).join(', ');

    const d = new Date();
    const tglFormat = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(-2);
    const noNota = `NT-${tglFormat}-${Math.floor(1000 + Math.random() * 9000)}`;
    const waktu = new Date().toLocaleDateString('id-ID') + " " + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + " WIB";
    const kembalian = bayar - total;

    // Cari member jika terdaftar untuk bonus poin
    const member = store.masterMember.find(m => m.nama.toLowerCase() === customer.toLowerCase());

    const dataNota = {
        nota: noNota,
        waktu: waktu,
        pembeli: customer,
        rincian: rincian,
        total: total,
        bayar: bayar,
        kembalian: kembalian,
        metode: metode,
        ref: ref,
        items: [...keranjang]
    };

    // Payload untuk Database Function / RPC Atomic
    const rpcPayload = {
        p_nota: noNota,
        p_waktu: waktu,
        p_pembeli: customer,
        p_rincian: rincian,
        p_total: total,
        p_bayar: bayar,
        p_kembalian: kembalian,
        p_metode: metode,
        p_ref: ref || null,
        p_items: keranjang,
        p_id_member: member ? member.id_member : null
    };

    const checkoutBtn = document.getElementById('btn-checkout-pos') ||
        document.querySelector('button[onclick="prosesCheckoutPOS()"]') ||
        document.querySelector('#tab-penjualan button.from-emerald-500');
    const originalBtnText = checkoutBtn ? checkoutBtn.innerHTML : "Eksekusi & Cetak Struk";

    if (checkoutBtn) {
        checkoutBtn.disabled = true;
        checkoutBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Memproses Nota...`;
    }
    checkoutInProgress = true;

    try {
        let isSavedOffline = false;

        // 1. Jika terdeteksi offline di browser kasir
        if (!navigator.onLine) {
            await queueOfflineTransaction(rpcPayload);
            isSavedOffline = true;
        } else {
            // 2. Jika online, coba RPC fn_proses_checkout_pos terlebih dahulu
            try {
                const { data, error } = await supabaseClient.rpc('fn_proses_checkout_pos', rpcPayload);
                if (error) {
                    throw error;
                }
            } catch (rpcErr) {
                console.warn("Panggilan RPC fn_proses_checkout_pos dialihkan ke fallback:", rpcErr);

                // Periksa apakah koneksi putus saat checkout
                if (rpcErr.message && (rpcErr.message.includes('fetch') || rpcErr.message.includes('network') || rpcErr.message.includes('Failed to fetch'))) {
                    console.warn("Koneksi internet terputus, menyimpan ke antrian offline...");
                    await queueOfflineTransaction(rpcPayload);
                    isSavedOffline = true;
                } else {
                    console.info("Menjalankan transaksi kasir melalui direct sequential fallback...");
                    await fallbackSequentialCheckout(dataNota, keranjang, member, total);
                }
            }
        }

        // Perbarui State Lokal
        for (const item of keranjang) {
            const prod = store.masterStok.find(p => p.id_produk === item.id);
            if (prod) {
                prod.stok = Math.max(0, prod.stok - item.qty);
            }
        }
        store.setMasterStok(store.masterStok);

        if (member) {
            member.poin = (member.poin || 0) + Math.floor(total / 10000);
            store.upsertMemberInState(member);
        }

        store.addRiwayatTransaksi(dataNota);

        // Cetak struk nota fisik kasir
        cetakStrukKePrinterFisik(dataNota, isSavedOffline);

        // Bersihkan form POS
        store.clearKeranjang();
        if (bayarInput) bayarInput.value = '';
        if (custInput) custInput.value = '';
        if (refInput) refInput.value = '';
        if (metodeSelect) metodeSelect.value = 'Tunai';
        handleMetodeBayarChange();

        // Render ulang tampilan yang terpengaruh
        renderTabelKeranjangPOS();
        renderTabelStok();
        renderTabelMember();
        kalkulasiLaporanDashboard();

        if (isSavedOffline) {
            showToast(`[MODE OFFLINE] Nota ${noNota} tersimpan di antrian kasir perangkat & struk dicetak. Akan auto-sync saat online.`, "warning", 5000);
        } else {
            showToast(`Transaksi Sukses! Nota: ${noNota} berhasil dicatat & struk dicetak.`, "success", 4000);
        }

        const mainContent = document.querySelector('main');
        if (mainContent) mainContent.scrollTop = 0;

    } catch (err) {
        console.error("Gagal melakukan checkout POS:", err);
        showToast("Transaksi Gagal: " + (err.message || err), "error", 5000);
    } finally {
        checkoutInProgress = false;
        if (checkoutBtn) {
            checkoutBtn.innerHTML = originalBtnText;
        }
        updateCashPaymentUI();
    }
}

// Prototype fallback untuk database yang belum menyediakan RPC checkout.
async function fallbackSequentialCheckout(dataNota, keranjang, member, total) {
    const txInsert = await panggilDatabaseAman({
        tabel: 'riwayat_transaksi',
        aksi: 'INSERT',
        data: [{
            nota: dataNota.nota,
            waktu: dataNota.waktu,
            pembeli: dataNota.pembeli,
            rincian: dataNota.rincian,
            total: dataNota.total,
            bayar: dataNota.bayar,
            kembalian: dataNota.kembalian,
            metode: dataNota.metode,
            ref: dataNota.ref || '',
            items: dataNota.items
        }]
    });
    if (txInsert.error) throw txInsert.error;

    for (const item of keranjang) {
        const prod = store.masterStok.find((product) => product.id_produk === item.id);
        if (!prod) continue;
        const result = await panggilDatabaseAman({
            tabel: 'produk', aksi: 'UPDATE', data: { stok: Math.max(0, prod.stok - item.qty) },
            filterKolom: 'id_produk', filterNilai: item.id
        });
        if (result.error) console.warn(`Gagal update stok produk ${item.id}:`, result.error);
    }

    if (member) {
        const result = await panggilDatabaseAman({
            tabel: 'member', aksi: 'UPDATE', data: { poin: (member.poin || 0) + Math.floor(total / 10000) },
            filterKolom: 'id_member', filterNilai: member.id_member
        });
        if (result.error) console.warn(`Gagal update poin member ${member.id_member}:`, result.error);
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
