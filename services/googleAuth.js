import { getSupabaseClient } from '../config/supabase.js';
import { normalizeRole } from './roles.js';

/** Start Supabase's Google OAuth flow and return to the existing login page. */
export async function mulaiLoginGoogle({ selectedRole = null, fromRegistration = false } = {}) {
    const client = getSupabaseClient();
    if (!client?.auth?.signInWithOAuth) throw new Error('Klien Supabase belum siap. Muat ulang halaman dan coba kembali.');

    const redirectTo = new URL('./index.html?login=1', window.location.href);
    if (fromRegistration) {
        redirectTo.searchParams.set('oauth_mode', 'register');
    } else {
        const role = normalizeRole(selectedRole);
        if (!role) throw new Error('Pilih jabatan pada kolom “Masuk sebagai” sebelum melanjutkan dengan Google.');
        redirectTo.searchParams.set('oauth_role', role === 'admin gudang' ? 'admin_gudang' : role);
    }

    const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo.href }
    });
    if (error) throw error;
}
