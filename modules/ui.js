/**
 * KARSA POS - UI Navigation & Layout Controller Module
 * Mengelola tab workspace, sidebar responsive, dan modal controller
 * + Theme Switcher & Setting Tab Support
 */

import { store } from '../services/state.js';
import { canRoleOpenTab } from '../services/roles.js';
import { showToast } from '../services/notification.js';
import { refreshDashboardFromStore } from './reports.js';

// ==============================================================================
// THEME MANAGEMENT
// ==============================================================================

const THEME_STORAGE_KEY = 'sim-market-theme';
const VALID_THEMES = ['light', 'green', 'dark'];

/**
 * Inisialisasi tema dari localStorage atau default ke 'light'
 */
export function initTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const theme = VALID_THEMES.includes(saved) ? saved : 'light';
    applyTheme(theme);
}

/**
 * Ganti tema aplikasi secara menyeluruh
 * @param {string} tema - 'light' | 'green' | 'dark'
 */
export function ubahTemaAplikasi(tema) {
    if (!VALID_THEMES.includes(tema)) {
        console.warn(`[Theme] Tema "${tema}" tidak valid. Opsi: ${VALID_THEMES.join(', ')}`);
        return;
    }
    applyTheme(tema);
    localStorage.setItem(THEME_STORAGE_KEY, tema);
}

/**
 * Aplikasikan tema ke elemen HTML dan perbarui UI tombol theme picker
 */
function applyTheme(tema) {
    document.documentElement.setAttribute('data-theme', tema);

    // Update body classes based on theme for Tailwind compatibility
    const body = document.body;
    if (tema === 'light') {
        body.classList.remove('text-slate-100');
        body.classList.add('text-slate-900');
    } else {
        body.classList.remove('text-slate-900');
        body.classList.add('text-slate-100');
    }

    // Update theme picker button active state
    updateThemePickerUI(tema);
}

/**
 * Update visual state on theme picker buttons
 */
function updateThemePickerUI(activeTema) {
    document.querySelectorAll('.theme-btn').forEach(btn => {
        const btnTheme = btn.getAttribute('data-theme-value');
        if (btnTheme === activeTema) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// ==============================================================================
// TAB NAVIGATION
// ==============================================================================

export function switchTab(tabId) {
    if (!tabId) return;

    if (!canRoleOpenTab(store.activeRole, tabId)) {
        showToast('Anda tidak memiliki izin untuk membuka menu tersebut.', 'error');
        return false;
    }

    // Sembunyikan semua tab content
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));

    const targetTab = document.getElementById('tab-' + tabId);
    if (targetTab) {
        targetTab.classList.remove('hidden');
    }

    // Reset style semua tombol navigasi
    document.querySelectorAll('nav button').forEach(btn => {
        btn.className = "module-nav-button w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 font-medium text-sm text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent smooth-transition";
    });

    // Beri highlight pada tombol tab aktif
    const activeBtn = document.getElementById('btn-' + tabId);
    if (activeBtn) {
        activeBtn.className = "module-nav-button module-active w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 font-medium text-sm border smooth-transition";
        activeBtn.setAttribute('aria-current', 'page');
    }
    document.querySelectorAll('nav button:not(#btn-' + tabId + ')').forEach(btn => btn.removeAttribute('aria-current'));

    const titles = {
        'penjualan': 'Penjualan & Transaksi Kasir',
        'pelanggan': 'Pusat Pengelolaan Keanggotaan Member',
        'stok': 'Manajemen & Pengendalian Sediaan Stok',
        'supplier': 'Logistik Sourcing & Pengadaan Restock',
        'dashboard': 'Dashboard Analitik',
        'laporan': 'Laporan Manajemen',
        'setting': '⚙️ Pengaturan Sistem & Kustomisasi'
    };
    const descs = {
        'penjualan': 'Kelola input belanja pembeli, kalkulasi nota atomic, dan cetak struk kasir.',
        'pelanggan': 'Kelola basis data keanggotaan pembeli loyal dan akumulasi poin reward terenkripsi.',
        'stok': 'Monitor status ketersediaan inventori gudang SKU produk minimarket.',
        'supplier': 'Terima restock inventori masuk dari supplier rekanan resmi terdaftar.',
        'dashboard': 'Ringkasan visual penjualan, pembayaran, produk terlaris, dan stok.',
        'laporan': 'Lihat ringkasan pendapatan hari ini dan histori transaksi penjualan.',
        'setting': 'Kelola akun profil, preferensi tampilan, dan informasi sistem aplikasi.'
    };

    const titleEl = document.getElementById('current-tab-title');
    const descEl = document.getElementById('current-tab-desc');

    if (titleEl) titleEl.innerText = titles[tabId] || "Dashboard";
    if (descEl) descEl.innerText = descs[tabId] || "";

    // Populate setting page with dynamic user data when navigating to setting tab
    if (tabId === 'setting') {
        populateSettingPage();
    }
    if (tabId === 'dashboard') refreshDashboardFromStore();

    // Tutup sidebar di layar mobile setelah memilih menu
    if (window.innerWidth < 1024) {
        hideSidebar();
    }
    return true;
}

/**
 * Populate setting page fields with current user data from store
 */
function populateSettingPage() {
    const user = store.activeUser;
    const role = store.activeRole;

    const nameEl = document.getElementById('setting-username');
    const emailEl = document.getElementById('setting-email');
    const roleEl = document.getElementById('setting-role');

    if (nameEl) nameEl.textContent = user?.username || 'Pengguna';
    if (emailEl) emailEl.textContent = user?.email || '-';
    if (roleEl) roleEl.textContent = (role || 'Tidak diketahui').toUpperCase();

    // Update active theme in picker
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    updateThemePickerUI(currentTheme);
}

// ==============================================================================
// SIDEBAR TOGGLE
// ==============================================================================

export function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const menuOverlay = document.getElementById('menu-overlay');
    if (!sidebar) return;

    sidebar.classList.toggle('sidebar-hidden');
    syncSidebarOverlay(sidebar, menuOverlay);
}

export function hideSidebar() {
    const sidebar = document.getElementById('sidebar');
    const menuOverlay = document.getElementById('menu-overlay');
    if (!sidebar) return;

    sidebar.classList.add('sidebar-hidden');
    syncSidebarOverlay(sidebar, menuOverlay);
}

function syncSidebarOverlay(sidebar, menuOverlay) {
    if (!sidebar || !menuOverlay) return;
    const sidebarExpanded = !sidebar.classList.contains('sidebar-hidden');
    const isMobileDrawer = window.innerWidth < 1024;
    menuOverlay.classList.toggle('active', isMobileDrawer && sidebarExpanded);
}

// ==============================================================================
// GLOBAL CLICK DISMISSERS
// ==============================================================================

export function initGlobalClickDismissers() {
    window.addEventListener('resize', () => {
        syncSidebarOverlay(
            document.getElementById('sidebar'),
            document.getElementById('menu-overlay')
        );
    });

    document.addEventListener('click', (e) => {
        // Dismiss POS search dropdown
        const searchInput = document.getElementById('pos-produk-search');
        const searchDropdown = document.getElementById('pos-produk-dropdown');
        if (searchInput && searchDropdown && !searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
            searchDropdown.classList.add('hidden');
        }

        // Dismiss POS customer dropdown
        const customerInput = document.getElementById('pos-customer');
        const customerDropdown = document.getElementById('pos-customer-dropdown');
        if (customerInput && customerDropdown && !customerInput.contains(e.target) && !customerDropdown.contains(e.target)) {
            customerDropdown.classList.add('hidden');
        }
    });
}
