-- Read-only Supabase status audit. Run before any migration.

-- Installed Auth user triggers and their enabled state.
SELECT t.tgname AS trigger_name,
       CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled'
            WHEN 'R' THEN 'replica' WHEN 'A' THEN 'always' END AS trigger_state,
       pg_get_triggerdef(t.oid) AS trigger_definition,
       p.oid::regprocedure AS trigger_function,
       pg_get_functiondef(p.oid) AS function_definition
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname;

-- Actual prototype RLS state, independent of local migration files.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
WHERE c.oid IN (
  'public.toko'::regclass, 'public.profil'::regclass,
  'public.produk'::regclass, 'public.member'::regclass,
  'public.supplier'::regclass, 'public.riwayat_transaksi'::regclass
)
ORDER BY c.relname;

-- Current profile roles; no role or user data is changed.
SELECT jabatan, count(*) AS accounts
FROM public.profil
GROUP BY jabatan
ORDER BY jabatan;

-- Exact UUIDs needing manual role review before role-constraint cleanup.
SELECT p.id AS auth_user_id, u.email, p.username, p.jabatan, p.store_id
FROM public.profil p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.jabatan NOT IN ('owner', 'kasir', 'admin gudang', 'manajer')
ORDER BY p.created_at;

-- Auth users lacking profiles; verify exact email, UUID and metadata.
SELECT u.id, u.email, u.created_at, u.email_confirmed_at, u.raw_user_meta_data
FROM auth.users u
LEFT JOIN public.profil p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;

-- Current policies and their exact expressions.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
