/**
 * KARSA POS - Authentication & Role Claims Service
 * Menangani proses sign-in, verifikasi hak akses role, dan manajemen sesi Supabase
 */

import { getSupabaseClient } from '../config/supabase.js';
import { panggilDatabaseAman } from './db.js';
import { store } from './state.js';
import { showToast } from './notification.js';
import { normalizeRole, needsGoogleProfileProvisioning, roleDisplayName, roleSelectionMatches, ROLE_HOME_TABS } from './roles.js';

export async function periksaSesiAktif(onSuccessCallback, expectedRole = null) {
    store.clearActiveUser();
    try {
        const client = getSupabaseClient();
        if (!client) return;

        const { data: { session }, error } = await client.auth.getSession();
        if (error) {
            showToast('Sesi tidak dapat dipulihkan. Muat ulang halaman atau coba masuk kembali.', 'error', 6000);
            return;
        }
        if (!session) return;

        const userUuid = session.user.id;
        const { data: profil, error: profilErr } = await panggilDatabaseAman({
            tabel: 'profil',
            aksi: 'SELECT',
            filterKolom: 'id',
            filterNilai: userUuid,
            single: true
        });

        const role = !profilErr && profil ? normalizeRole(profil.jabatan) : null;
        if (profil && needsGoogleProfileProvisioning(session.user, profil)) {
            store.clearActiveUser();
            showToast('Profil akun Google dibuat bersamaan dengan akun dan belum dapat dipercaya untuk memberi akses. Hubungi administrator untuk menghubungkan profil toko secara terverifikasi.', 'error', 7000);
            return;
        }
        if (!role || profil.id !== userUuid) {
            store.clearActiveUser();
            const oauthRegistration = new URLSearchParams(window.location.search).get('oauth_mode') === 'register';
            const profileReadFailed = profilErr && profilErr.code !== 'PGRST116';
            showToast(profileReadFailed
                ? 'Profil gagal dibaca karena gangguan sistem. Akses dashboard dihentikan; coba lagi atau hubungi administrator.'
                : oauthRegistration
                    ? 'Akun Google berhasil diautentikasi, tetapi profil usaha belum tersedia. Tidak ada toko atau role yang dibuat otomatis. Hubungi administrator untuk onboarding yang terverifikasi.'
                    : 'Profil usaha akun ini belum tersedia atau jabatannya tidak valid. Tidak ada role yang diberikan otomatis. Minta Owner mengundang akun ini atau hubungi administrator.', 'error', 7000);
            return;
        }
        if (expectedRole && !roleSelectionMatches(role, expectedRole)) {
            store.clearActiveUser();
            const displayRole = roleDisplayName(role);
            showToast(`Akses Ditolak: role pilihan tidak sesuai. Akun ini terdaftar sebagai ${displayRole}. Pilih role ${displayRole} untuk melanjutkan.`, 'error', 7000);
            return;
        }
        store.setActiveUser(profil, role);
        aktifkanTampilanDashboard(profil.username, role, onSuccessCallback);
    } catch (err) {
        store.clearActiveUser();
        console.warn("Pemeriksaan sesi aktif:", err.message);
    }
}

export async function loginUser(email, password, expectedRole = null, onSuccessCallback = null) {
    const submitBtn = document.querySelector('#loginForm button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : "Autentikasi & Masuk";
    const restoreSubmitButton = () => {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
    };
    store.clearActiveUser();

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `Memverifikasi... <i class="fa-solid fa-spinner animate-spin ml-2"></i>`;
        }

        const resLogin = await panggilDatabaseAman({
            aksi: 'AUTH_LOGIN',
            email: email,
            password: password
        });

        if (resLogin.error) {
            throw new Error(resLogin.error.message || "Gagal melakukan autentikasi.");
        }

        const userUuid = resLogin.data.user.id;

        const profilResult = await panggilDatabaseAman({
            tabel: 'profil',
            aksi: 'SELECT',
            filterKolom: 'id',
            filterNilai: userUuid,
            single: true
        });

        const profil = profilResult.data;
        const role = !profilResult.error && profil ? normalizeRole(profil.jabatan) : null;
        if (profil && needsGoogleProfileProvisioning(resLogin.data.user, profil)) {
            store.clearActiveUser();
            showToast('Profil akun Google belum dihubungkan melalui onboarding terverifikasi. Akses dashboard tidak diberikan; hubungi administrator.', 'error', 7000);
            restoreSubmitButton();
            return;
        }
        if (!role || profil.id !== userUuid) {
            store.clearActiveUser();
            const profileReadFailed = profilResult.error && profilResult.error.code !== 'PGRST116';
            const message = profileReadFailed
                ? 'Profil akun gagal dibaca karena gangguan sistem. Silakan coba kembali.'
                : 'Profil atau jabatan akun belum terdaftar dengan benar. Hubungi administrator toko.';
            showToast(`<strong>Login Ditolak</strong><br>${message}`, 'error', 6000);
            restoreSubmitButton();
            return;
        }

        // Require the selected role to match the verified profile before entering the app.
        if (!roleSelectionMatches(role, expectedRole)) {
            store.clearActiveUser();
            const displayRole = roleDisplayName(role);
            showToast(`<strong>Akses Ditolak</strong><br>Role yang Anda pilih tidak sesuai dengan jabatan akun Anda. Akun ini terdaftar sebagai ${displayRole}. Silakan pilih role ${displayRole} untuk melanjutkan.`, 'error', 7000);
            restoreSubmitButton();
            return;
        }

        const roleAkhir = role;
        store.setActiveUser(profil, roleAkhir);

        const loginScreen = document.getElementById('login-screen');
        if (loginScreen) {
            loginScreen.classList.add('opacity-0', 'scale-95');
        }

        showToast(`Selamat datang, ${profil.username}! Anda login sebagai ${String(roleAkhir).toUpperCase()}.`, "success");

        setTimeout(() => {
            aktifkanTampilanDashboard(profil.username, roleAkhir, onSuccessCallback);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
        }, 400);

    } catch (err) {
        console.error("Login gagal:", err.message);
        restoreSubmitButton();

        const loginScreen = document.getElementById('login-screen');
        const container = loginScreen ? loginScreen.firstElementChild : null;
        if (container) {
            container.classList.add('animate-shake', 'border-rose-500/40');
            setTimeout(() => { container.classList.remove('animate-shake'); }, 400);
        }

        showToast("Autentikasi gagal atau layanan login sedang terganggu. Periksa kredensial dan coba kembali.", "error", 5000);
    }
}

export function aktifkanTampilanDashboard(username, role, onReadyCallback = null) {
    const canonicalRole = normalizeRole(role);
    if (!canonicalRole) return;
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');

    if (loginScreen) loginScreen.classList.add('hidden');
    if (mainApp) {
        mainApp.classList.remove('hidden');
        document.body.className = "text-slate-100 min-h-screen w-full block bg-[#020617]";

        const nameEl = document.getElementById('user-display-name');
        const roleEl = document.getElementById('user-display-role');
        const avatarEl = document.getElementById('avatar-box');

        if (nameEl) nameEl.innerText = username;
        if (roleEl) roleEl.innerText = canonicalRole;
        if (avatarEl) avatarEl.innerText = (username || "U").charAt(0).toUpperCase();

        setTimeout(() => {
            applyRolePermissions(canonicalRole);
            mainApp.classList.remove('opacity-0');
            if (onReadyCallback && typeof onReadyCallback === 'function') {
                onReadyCallback();
            }
        }, 50);
    }
}

export function applyRolePermissions(role) {
    document.querySelectorAll('.menu-section').forEach(el => el.classList.add('hidden'));
    const cleanRole = normalizeRole(role);

    const secKasir = document.getElementById('sec-kasir');
    const secGudang = document.getElementById('sec-gudang');
    const secManajer = document.getElementById('sec-manajer');
    const secSetting = document.getElementById('sec-setting');
    const ownerInvitePanel = document.getElementById('owner-invite-panel');

    if (!cleanRole) {
        store.clearActiveUser();
        return;
    }

    if (cleanRole === "kasir") {
        if (secKasir) secKasir.classList.remove('hidden');
    } else if (cleanRole === "admin gudang") {
        if (secGudang) secGudang.classList.remove('hidden');
    } else if (cleanRole === "manajer") {
        if (secManajer) secManajer.classList.remove('hidden');
    } else if (cleanRole === "owner") {
        if (secKasir) secKasir.classList.remove('hidden');
        if (secGudang) secGudang.classList.remove('hidden');
        if (secManajer) secManajer.classList.remove('hidden');
    }

    if (ownerInvitePanel) ownerInvitePanel.classList.toggle('hidden', cleanRole !== 'owner');

    // Setting menu tersedia untuk semua role
    if (secSetting) secSetting.classList.remove('hidden');

    if (window.switchTab && typeof window.switchTab === 'function') {
        window.switchTab(ROLE_HOME_TABS[cleanRole]);
    }
}

export async function logoutUser() {
    if (confirm("Keluar dari KARSA POS?")) {
        store.clearActiveUser();
        document.querySelectorAll('.menu-section').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        document.getElementById('user-display-name')?.replaceChildren();
        document.getElementById('user-display-role')?.replaceChildren();
        const avatarEl = document.getElementById('avatar-box');
        if (avatarEl) avatarEl.textContent = '';
        try {
            const client = getSupabaseClient();
            if (client) {
                await client.auth.signOut();
            }
        } catch (e) {
            console.error("Logout error:", e);
        }
        location.reload();
    }
}
