/**
 * ==============================================================================
 * KARSA POS
 * Entry Point & Modular Application Orchestrator
 * ==============================================================================
 */

// 1. Service Worker PWA Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log("[PWA] Service Worker Aktif & Terdaftar."))
            .catch((err) => console.warn("[PWA] Gagal mendaftarkan Service Worker:", err));
    });
}

// 2. Import Modular Services & Feature Modules
import { supabaseClient, SUPABASE_URL } from './config/supabase.js';
import { store } from './services/state.js';
import { panggilDatabaseAman } from './services/db.js';
import { periksaSesiAktif, loginUser, logoutUser, applyRolePermissions } from './services/auth.js';
import { mulaiLoginGoogle } from './services/googleAuth.js';
import { showToast } from './services/notification.js';
import { createEmployeeInvite } from './services/invitations.js';
import {
    initOfflineDb,
    initNetworkListeners,
    cacheLocalData,
    getCachedLocalData,
    syncOfflineTransactions,
    renderNetworkBadgeUI
} from './services/offlineQueue.js';

import {
    renderDaftarProdukPOS,
    initQuickCash,
    filterProdukPOS,
    pilihProdukPOS,
    handleCustomerSearch,
    pilihMemberPOS,
    handleMetodeBayarChange,
    tambahItemKeranjang,
    hapusItemKeranjang,
    renderTabelKeranjangPOS,
    cetakStrukKePrinterFisik,
    prosesCheckoutPOS
} from './modules/pos.js';

import {
    renderTabelStok,
    initProductCsvImport,
    bukaModalTambahProduk,
    tutupModalTambahProduk,
    simpanProdukBaruModal,
    eksekusiRestockBarang,
    ensureScannedSkuInSupabase,
    applyScannedSkuToPOS
} from './modules/inventory.js';

import {
    renderTabelMember,
    tambahMemberBaru
} from './modules/members.js';

import {
    initSupplierForm,
    renderTabelSupplier,
    renderMenusRestockDropdown
} from './modules/suppliers.js';

import {
    kalkulasiLaporanDashboard,
    renderDashboardLoading
} from './modules/reports.js';

import {
    switchTab,
    toggleSidebar,
    hideSidebar,
    initGlobalClickDismissers,
    initTheme,
    ubahTemaAplikasi
} from './modules/ui.js';

// ==============================================================================
// 3. EXPOSE GLOBAL WINDOW BINDINGS (Agar kompatibel dengan inline onclick di HTML)
// ==============================================================================
window.switchTab = switchTab;
window.toggleSidebar = toggleSidebar;
window.hideSidebar = hideSidebar;
window.logout = logoutUser;
window.filterProdukPOS = filterProdukPOS;
window.pilihProdukPOS = pilihProdukPOS;
window.pilihMemberPOS = pilihMemberPOS;
window.handleMetodeBayarChange = handleMetodeBayarChange;
window.tambahItemKeranjang = tambahItemKeranjang;
window.hapusItemKeranjang = hapusItemKeranjang;
window.prosesCheckoutPOS = prosesCheckoutPOS;
window.cetakStrukKePrinterFisik = cetakStrukKePrinterFisik;
window.tambahMemberBaru = tambahMemberBaru;
window.bukaModalTambahProduk = bukaModalTambahProduk;
window.tutupModalTambahProduk = tutupModalTambahProduk;
window.simpanProdukBaruModal = simpanProdukBaruModal;
window.eksekusiRestockBarang = eksekusiRestockBarang;
window.syncOfflineTransactions = syncOfflineTransactions;
window.ubahTemaAplikasi = ubahTemaAplikasi;

window.addEventListener('DOMContentLoaded', () => {
    initQuickCash();
    const inviteForm = document.getElementById('employeeInviteForm');
    const inviteButton = document.getElementById('invite-submit');
    const inviteMessage = document.getElementById('invite-message');
    inviteForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (inviteButton) { inviteButton.disabled = true; inviteButton.textContent = 'Membuat undangan…'; }
        if (inviteMessage) inviteMessage.textContent = '';
        try {
            const link = await createEmployeeInvite(
                document.getElementById('invite-email').value,
                document.getElementById('invite-role').value
            );
            if (inviteMessage) {
                inviteMessage.textContent = `Bagikan tautan ini kepada pegawai yang diundang (berlaku 7 hari): ${link}`;
                inviteMessage.className = 'text-xs break-all text-emerald-400';
            }
            inviteForm.reset();
        } catch {
            if (inviteMessage) {
                inviteMessage.textContent = 'Undangan gagal dibuat. Pastikan migration aktif dan akun Anda memiliki role owner.';
                inviteMessage.className = 'text-xs break-all text-rose-400';
            }
        } finally {
            if (inviteButton) { inviteButton.disabled = false; inviteButton.textContent = 'Buat tautan undangan'; }
        }
    });
});

// ==============================================================================
// 4. DATA SYNCHRONIZATION INITIALIZER (CLOUD & OFFLINE-CACHE FALLBACK)
// ==============================================================================
function hasValidProductStockData(products) {
    return Array.isArray(products) && products.every(product => (
        product && typeof product.nama === 'string' && product.nama.trim()
        && product.stok !== null && product.stok !== undefined
        && Number.isSafeInteger(Number(product.stok)) && Number(product.stok) >= 0
    ));
}

export async function initAplikasi() {
    let reportLoadError = false;
    let stockLoadStatus = 'loading';
    let stockDataSource = 'database';
    renderDashboardLoading();
    try {
        if (navigator.onLine) {
            // Ambil data dari 4 tabel Supabase secara paralel
            const [stokRes, memberRes, supplierRes, transaksiRes] = await Promise.all([
                panggilDatabaseAman({ tabel: 'produk', aksi: 'SELECT' }),
                panggilDatabaseAman({ tabel: 'member', aksi: 'SELECT' }),
                panggilDatabaseAman({ tabel: 'supplier', aksi: 'SELECT' }),
                panggilDatabaseAman({ tabel: 'riwayat_transaksi', aksi: 'SELECT', orderBy: 'created_at', ascending: false })
            ]);
            reportLoadError = Boolean(transaksiRes.error);

            if (stokRes.error) {
                stockLoadStatus = 'error';
                console.error('[Dashboard] Gagal memuat data stok produk:', stokRes.error);
            } else if (!hasValidProductStockData(stokRes.data)) {
                stockLoadStatus = 'error';
                console.error('[Dashboard] Respons produk tidak memiliki kolom nama/stok yang valid:', stokRes.data);
            } else {
                const sortedStok = stokRes.data.sort((a, b) => (a.id_produk || '').localeCompare(b.id_produk || ''));
                store.setMasterStok(sortedStok);
                await cacheLocalData('master_stok', sortedStok);
                stockLoadStatus = 'ready';
            }
            if (memberRes.data) {
                const sortedMember = memberRes.data.sort((a, b) => (a.id_member || '').localeCompare(b.id_member || ''));
                store.setMasterMember(sortedMember);
                await cacheLocalData('master_member', sortedMember);
            }
            if (supplierRes.data) {
                const sortedSupplier = supplierRes.data.sort((a, b) => (a.id_supplier || '').localeCompare(b.id_supplier || ''));
                store.setMasterSupplier(sortedSupplier);
                await cacheLocalData('master_supplier', sortedSupplier);
            }
            if (transaksiRes.data) {
                store.setRiwayatNotaTransaksi(transaksiRes.data);
                await cacheLocalData('riwayat_transaksi', transaksiRes.data);
            }
        } else {
            // Jika perangkat kasir sedang offline, pulihkan data dari Cache IndexedDB
            console.log("[Offline Mode] Mengambil master data dari cache lokal IndexedDB...");
            const [cachedStok, cachedMember, cachedSupplier, cachedTx] = await Promise.all([
                getCachedLocalData('master_stok'),
                getCachedLocalData('master_member'),
                getCachedLocalData('master_supplier'),
                getCachedLocalData('riwayat_transaksi')
            ]);

            if (hasValidProductStockData(cachedStok)) {
                store.setMasterStok(cachedStok);
                stockLoadStatus = 'ready';
                stockDataSource = 'cache';
            } else {
                stockLoadStatus = 'unavailable';
                stockDataSource = 'offline';
            }
            if (cachedMember) store.setMasterMember(cachedMember);
            if (cachedSupplier) store.setMasterSupplier(cachedSupplier);
            if (cachedTx) store.setRiwayatNotaTransaksi(cachedTx);

            showToast("Berjalan dalam Mode Offline: Menggunakan salinan data lokal kasir.", "warning");
        }

        // Tangani SKU barcode hasil scan jika ada
        await ensureScannedSkuInSupabase();
        applyScannedSkuToPOS();

        // Render data ke seluruh elemen antarmuka
        renderDaftarProdukPOS();
        renderTabelStok();
        renderTabelMember();
        renderTabelSupplier();
        renderMenusRestockDropdown();
        kalkulasiLaporanDashboard(reportLoadError, stockLoadStatus, stockDataSource);
        renderNetworkBadgeUI();

    } catch (err) {
        console.error("Gagal sinkronisasi data cloud Supabase:", err);
        showToast("Terjadi kendala saat memuat data cloud. Menggunakan data cadangan lokal.", "warning");

        // Fallback coba ambil dari cache jika request gagal
        const cachedStok = await getCachedLocalData('master_stok');
        if (hasValidProductStockData(cachedStok)) {
            store.setMasterStok(cachedStok);
            stockLoadStatus = 'ready';
            stockDataSource = 'cache';
            renderTabelStok();
            renderDaftarProdukPOS();
        } else {
            stockLoadStatus = 'error';
        }
        kalkulasiLaporanDashboard(reportLoadError, stockLoadStatus, stockDataSource);
    }
}

// ==============================================================================
// 5. EVENT LISTENERS INITIALIZATION
// ==============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Setup Password Toggle di Halaman Login
    initSupplierForm();
    initProductCsvImport();
    const togglePwdBtn = document.getElementById('toggle-pwd');
    const passwordInput = document.getElementById('password');
    if (togglePwdBtn && passwordInput) {
        togglePwdBtn.addEventListener('click', () => {
            const isPwd = passwordInput.getAttribute('type') === 'password';
            passwordInput.setAttribute('type', isPwd ? 'text' : 'password');
            togglePwdBtn.innerHTML = isPwd ? `<i class="fa-solid fa-eye-slash text-sm"></i>` : `<i class="fa-solid fa-eye text-sm"></i>`;
        });
    }

    // 2. Setup Form Submit Login
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('username')?.value.trim();
            const password = passwordInput?.value;
            const jabatan = document.getElementById('jabatan')?.value;

            if (!email || !password) {
                showToast("Email dan password wajib diisi!", "warning");
                return;
            }

            loginUser(email, password, jabatan, initAplikasi);
        });
    }

    const googleLoginButton = document.getElementById('google-login-button');
    googleLoginButton?.addEventListener('click', async () => {
        const selectedRole = document.getElementById('jabatan')?.value;
        const originalText = googleLoginButton.innerHTML;
        googleLoginButton.disabled = true;
        googleLoginButton.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Menghubungkan ke Google...';
        try {
            await mulaiLoginGoogle({ selectedRole });
        } catch (error) {
            showToast(error.message || 'Login Google gagal dimulai. Periksa konfigurasi Supabase Auth.', 'error', 6000);
            googleLoginButton.disabled = false;
            googleLoginButton.innerHTML = originalText;
        }
    });

    // 3. Setup Toggle Sidebar Responsive
    const menuToggleBtn = document.getElementById('menu-toggle');
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuToggleBtn) menuToggleBtn.addEventListener('click', toggleSidebar);
    if (menuOverlay) menuOverlay.addEventListener('click', hideSidebar);

    // 4. Setup Input POS Search & Member Dropdown
    const posSearchInput = document.getElementById('pos-produk-search');
    if (posSearchInput) {
        posSearchInput.addEventListener('input', filterProdukPOS);
        posSearchInput.addEventListener('focus', filterProdukPOS);
    }

    const posCustomerInput = document.getElementById('pos-customer');
    if (posCustomerInput) {
        posCustomerInput.addEventListener('input', handleCustomerSearch);
        posCustomerInput.addEventListener('focus', handleCustomerSearch);
    }

    // 5. Setup Modal Tambah Produk Buttons
    const btnBukaModal = document.getElementById('btn-buka-modal-produk');
    if (btnBukaModal) {
        btnBukaModal.addEventListener('click', bukaModalTambahProduk);
    }

    const btnTutupModal = document.getElementById('btn-tutup-modal-produk');
    const btnBatalModal = document.getElementById('btn-batal-modal-produk');
    if (btnTutupModal) btnTutupModal.addEventListener('click', tutupModalTambahProduk);
    if (btnBatalModal) btnBatalModal.addEventListener('click', tutupModalTambahProduk);

    document.getElementById('form-tambah-produk')?.addEventListener('submit', (event) => {
        event.preventDefault();
        simpanProdukBaruModal();
    });

    // 6. Setup Global Click Dismissers (Dropdowns)
    initGlobalClickDismissers();

    // 7. Setup Network Listeners & Offline Queue Sync
    initNetworkListeners(initAplikasi);

    // 8. Inisialisasi Tema dari localStorage (sebelum login check)
    initTheme();

    const params = new URLSearchParams(window.location.search);
    const callbackRole = params.get('oauth_role');
    const roleSelect = document.getElementById('jabatan');
    if (callbackRole && roleSelect) roleSelect.value = callbackRole;

    // 9. Cek apakah ada sesi login aktif di Supabase
    const page = window.location.pathname.split('/').pop();
    const isLoginPage = !page || page === 'index.html';
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const explicitLogin = params.has('login');
        const oauthError = params.get('error_description') || params.get('error');
        if (oauthError) showToast('Autentikasi Google gagal atau dibatalkan. Silakan coba kembali.', 'error', 6000);
        if (!session && isLoginPage && !explicitLogin) {
            window.location.replace(new URL('./register.html', window.location.href));
            return;
        }
        if (session) await periksaSesiAktif(initAplikasi, callbackRole);
    } catch (error) {
        console.warn('Gagal memeriksa sesi pengguna. Periksa koneksi Supabase.');
        showToast('Sesi tidak dapat diperiksa karena gangguan koneksi. Coba muat ulang halaman.', 'error', 6000);
    }
});
