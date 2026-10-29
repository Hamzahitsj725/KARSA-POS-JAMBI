/** Canonical UI role policy. Database profile jabatan remains the source of truth. */
export const ROLE_TABS = Object.freeze({
    owner: Object.freeze(['penjualan', 'pelanggan', 'stok', 'supplier', 'dashboard', 'laporan', 'setting']),
    kasir: Object.freeze(['penjualan', 'pelanggan', 'setting']),
    'admin gudang': Object.freeze(['stok', 'supplier', 'setting']),
    manajer: Object.freeze(['dashboard', 'laporan', 'setting'])
});

export const ROLE_HOME_TABS = Object.freeze({
    owner: 'penjualan',
    kasir: 'penjualan',
    'admin gudang': 'stok',
    manajer: 'dashboard'
});

export function normalizeRole(role) {
    if (typeof role !== 'string') return null;
    const normalized = role.trim().toLocaleLowerCase('id').replace(/[_\s]+/g, ' ');
    return Object.hasOwn(ROLE_TABS, normalized) ? normalized : null;
}

export function roleSelectionMatches(profileRole, selectedRole) {
    const verifiedRole = normalizeRole(profileRole);
    return Boolean(verifiedRole && normalizeRole(selectedRole) === verifiedRole);
}

export function roleDisplayName(role) {
    const names = { owner: 'Owner', kasir: 'Kasir', 'admin gudang': 'Admin Gudang', manajer: 'Manajer' };
    const canonicalRole = normalizeRole(role);
    return canonicalRole ? names[canonicalRole] : null;
}

/** Fail closed when a Google Auth signup and its profile were created atomically. */
export function needsGoogleProfileProvisioning(authUser, profile) {
    if (authUser?.app_metadata?.provider !== 'google' || !profile?.created_at || !authUser?.created_at) return false;
    const authCreatedAt = Date.parse(authUser.created_at);
    const profileCreatedAt = Date.parse(profile.created_at);
    return Number.isFinite(authCreatedAt) && Number.isFinite(profileCreatedAt)
        && Math.abs(profileCreatedAt - authCreatedAt) <= 2000;
}

export function canRoleOpenTab(role, tabId) {
    const canonicalRole = normalizeRole(role);
    return Boolean(canonicalRole && ROLE_TABS[canonicalRole].includes(tabId));
}
