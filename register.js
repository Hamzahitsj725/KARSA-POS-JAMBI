import { getSupabaseClient } from './config/supabase.js';
import { mulaiLoginGoogle } from './services/googleAuth.js';

const form = document.getElementById('registerForm');
if (form) {
  const button = document.getElementById('submitButton');
  const message = document.getElementById('formMessage');
  const field = (id) => document.getElementById(id);
  const invitationToken = new URLSearchParams(window.location.search).get('invite');
  let submitting = false;

  const googleButton = document.getElementById('google-register-button');
  googleButton?.addEventListener('click', async () => {
    if (submitting) return;
    submitting = true;
    const originalText = googleButton.textContent;
    googleButton.disabled = true;
    googleButton.setAttribute('aria-busy', 'true');
    googleButton.textContent = 'Menghubungkan ke Google...';
    try {
      await mulaiLoginGoogle({ fromRegistration: true });
    } catch (error) {
      showMessage('error', error.message || 'Pendaftaran Google gagal dimulai. Periksa konfigurasi Supabase Auth.');
      submitting = false;
      googleButton.disabled = false;
      googleButton.removeAttribute('aria-busy');
      googleButton.textContent = originalText;
    }
  });

  if (invitationToken) {
    document.getElementById('registrationTitle').textContent = 'Bergabung dengan Toko';
    document.getElementById('registrationSubtitle').textContent = 'Buat akun menggunakan undangan yang diberikan owner toko.';
    document.querySelectorAll('.owner-field').forEach((container) => {
      container.hidden = true;
      const input = container.querySelector('input');
      if (input) input.required = false;
    });
  }

  function showMessage(type, text, showLoginLink = false) {
    if (!message) return;
    message.dataset.type = type;
    message.textContent = text;
    if (showLoginLink) {
      const link = document.createElement('a');
      link.href = './index.html?login=1';
      link.textContent = ' Buka halaman login';
      link.style.cssText = 'display:inline-block;margin-left:.35rem;color:inherit;text-decoration:underline;font-weight:700';
      message.append(link);
    }
    message.hidden = false;
    message.setAttribute('role', type === 'error' ? 'alert' : 'status');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const password = field('password')?.value ?? '';
    if (password !== (field('confirmPassword')?.value ?? '')) {
      showMessage('error', 'Konfirmasi password harus sama dengan password.');
      field('confirmPassword')?.focus();
      return;
    }

    const client = getSupabaseClient();
    if (!client?.auth?.signUp) {
      showMessage('error', 'Layanan pendaftaran belum siap. Muat ulang halaman dan periksa koneksi internet.');
      return;
    }

    submitting = true;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Memproses pendaftaran…';
    }
    if (message) message.hidden = true;

    try {
      const { data, error } = await client.auth.signUp({
        email: field('email').value.trim(),
        password,
        options: {
          emailRedirectTo: new URL('./index.html?login=1', window.location.href).href,
          data: invitationToken ? {
            username: field('username').value.trim(),
            invitation_token: invitationToken
          } : {
            username: field('username').value.trim(),
            nama_toko: field('nama_toko').value.trim(),
            nama_pemilik: field('nama_pemilik').value.trim(),
            alamat: field('alamat').value.trim(),
            telepon: field('telepon').value.trim()
          }
        }
      });
      if (error) throw error;
      if (!data?.user?.id) throw new Error('Akun belum dapat dibuat. Silakan coba kembali.');
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('Email ini sudah terdaftar. Silakan masuk atau gunakan fitur pemulihan akun.');
      }

      const accountType = invitationToken ? 'Akun pegawai berhasil dikaitkan ke toko.' : 'Akun owner dan toko berhasil dibuat.';
      showMessage('success', data.session
        ? `${accountType} Anda dapat masuk sekarang.`
        : `${accountType} Cek inbox Gmail Anda (termasuk folder Spam/Promosi), lalu verifikasi akun sebelum login.`,
      Boolean(data.session));
      form.reset();
    } catch (error) {
      const raw = String(error?.message || error?.error_description || '').toLowerCase();
      const code = String(error?.code || error?.name || '').toLowerCase();
      const status = Number(error?.status || error?.statusCode || 0);
      let friendly = 'Pendaftaran ditolak oleh layanan Supabase. Periksa konfigurasi Auth dan data yang dimasukkan.';
      if (code.includes('already') || raw.includes('already registered') || raw.includes('already exists') || raw.includes('user already registered')) {
        friendly = 'Email ini sudah terdaftar. Silakan masuk atau gunakan fitur pemulihan akun.';
      } else if (code.includes('weak_password') || raw.includes('password')) {
        friendly = 'Password tidak memenuhi ketentuan Supabase. Gunakan password yang lebih kuat.';
      } else if (code.includes('fetch') || raw.includes('fetch') || raw.includes('network') || raw.includes('failed to') || raw.includes('load failed') || status === 0) {
        friendly = 'Tidak dapat terhubung ke Supabase Auth. Periksa koneksi, URL project, dan status layanan Supabase.';
      } else if (raw.includes('database error') || raw.includes('saving new user') || status >= 500) {
        friendly = invitationToken
          ? 'Supabase gagal memproses undangan. Pastikan migration aktif, token berlaku, dan email sesuai undangan.'
          : 'Supabase gagal membuat akun atau profil toko. Admin perlu memeriksa migration signup dan Auth Logs.';
      } else if (code.includes('signup_disabled') || raw.includes('signups not allowed')) {
        friendly = 'Pendaftaran publik sedang dinonaktifkan pada pengaturan Supabase Auth.';
      } else if (code.includes('email_address_invalid') || raw.includes('invalid email')) {
        friendly = 'Format email tidak valid.';
      } else if (code === 'over_email_send_rate_limit' || raw.includes('over_email_send_rate_limit')) {
        friendly = 'Alamat Gmail yang sama tetap dapat dipakai. Supabase sedang membatasi pengiriman email verifikasi. Cek inbox Gmail (termasuk Spam/Promosi) untuk email yang mungkin sudah terkirim. Jika akun masih ada di Supabase Auth, verifikasi akun itu; jika sudah dihapus, tunggu sampai batas email pulih lalu daftar lagi dengan Gmail yang sama. Jangan klik Daftar berulang kali.';
      } else if (status === 429 || raw.includes('rate limit') || raw.includes('too many')) {
        friendly = 'Terlalu banyak percobaan atau email verifikasi. Tunggu beberapa menit lalu coba kembali.';
      }
      const diagnostic = [code && `kode ${code}`, status && `HTTP ${status}`].filter(Boolean).join(', ');
      const existingAccount = code.includes('already') || raw.includes('already registered') || raw.includes('already exists') || raw.includes('user already registered');
      showMessage('error', diagnostic ? `${friendly} (${diagnostic})` : friendly, existingAccount);
    } finally {
      submitting = false;
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = 'Daftar Sekarang';
      }
    }
  });
}
