/**
 * KARSA POS - Safe Database Access Service
 * Menyediakan abstraksi query aman, error handling terpusat, dan integrasi RPC
 */

import { getSupabaseClient } from '../config/supabase.js';

export async function panggilDatabaseAman(payload) {
    try {
        const client = getSupabaseClient();
        if (!client) {
            throw new Error("Klien Supabase belum diinisialisasi atau tidak tersedia.");
        }

        // Aksi Khusus: RPC (Remote Procedure Call / Stored Procedure)
        if (payload.aksi === 'RPC') {
            const { data, error } = await client.rpc(payload.fungsi, payload.params || {});
            return { data, error };
        }

        // Aksi Khusus: AUTH
        if (payload.aksi === 'AUTH_LOGIN') {
            const { data, error } = await client.auth.signInWithPassword({
                email: payload.email,
                password: payload.password
            });
            return { data, error };
        }

        let query = client.from(payload.tabel);

        if (payload.aksi === 'SELECT') {
            query = query.select(payload.kolom || '*');

            if (payload.filterKolom && payload.filterNilai !== undefined) {
                query = query.eq(payload.filterKolom, payload.filterNilai);
            }
            if (payload.orderBy) {
                query = query.order(payload.orderBy, { ascending: payload.ascending ?? true });
            }
            if (payload.limit) {
                query = query.limit(payload.limit);
            }
            if (payload.single) {
                query = query.single();
            }
        } else if (payload.aksi === 'INSERT') {
            query = query.insert(payload.data).select();
        } else if (payload.aksi === 'UPDATE') {
            query = query.update(payload.data).eq(payload.filterKolom, payload.filterNilai).select();
        } else if (payload.aksi === 'DELETE') {
            query = query.delete().eq(payload.filterKolom, payload.filterNilai).select();
        }

        const { data, error } = await query;
        return { data, error };
    } catch (err) {
        console.error(`[DB ERROR - ${payload.tabel || payload.fungsi || payload.aksi}]:`, err);
        return { data: null, error: err };
    }
}
