/**
 * KARSA POS - Supabase Configuration Module
 * Memisahkan konfigurasi Supabase dari kode utama dan mendukung Environment Variables
 */

// Mendukung dynamic environment dari window.ENV, process.env (bundler), atau default runtime
const getEnvVar = (key, fallback = "") => {
    if (typeof window !== "undefined" && window.ENV && window.ENV[key]) {
        return window.ENV[key];
    }
    if (typeof process !== "undefined" && process.env && process.env[key]) {
        return process.env[key];
    }
    return fallback;
};

export const SUPABASE_URL = getEnvVar(
    "VITE_SUPABASE_URL",
    getEnvVar("SUPABASE_URL", "https://vbxbwwngrjbjljgcumcl.supabase.co")
);

export const SUPABASE_ANON_KEY = getEnvVar(
    "VITE_SUPABASE_ANON_KEY",
    getEnvVar("SUPABASE_ANON_KEY", "sb_publishable_W-LuxiwjSIrCgbcRVsnHGw_gcB66SPQ")
);

// Inisialisasi Supabase Client
let _client = null;

export function getSupabaseClient() {
    if (_client) return _client;

    if (typeof window !== "undefined" && window.supabase && typeof window.supabase.createClient === "function") {
        _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        });
    } else {
        console.warn("Library Supabase JS belum dimuat dari CDN/NPM. Menunggu inisialisasi...");
    }

    return _client;
}

// Proksi dinamis agar pemanggilan supabaseClient selalu mengarah ke instance aktif
export const supabaseClient = new Proxy({}, {
    get(target, prop) {
        const client = getSupabaseClient();
        if (!client) {
            console.warn(`[Supabase] Klien belum tersedia saat mengakses properti '${prop}'`);
            return undefined;
        }
        const val = client[prop];
        return typeof val === 'function' ? val.bind(client) : val;
    }
});

/**
 * Uji konektivitas ke server Supabase
 */
export async function testSupabaseConnection() {
    try {
        const client = getSupabaseClient();
        if (!client) return { ok: false, error: "Klien Supabase belum siap" };
        
        const { error } = await client.from('produk').select('id_produk').limit(1);
        if (error && error.code !== "PGRST116") {
            return { ok: false, error: error.message };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}
