import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const roleModule = await import(`data:text/javascript;base64,${Buffer.from(
    await readFile(new URL('../services/roles.js', import.meta.url), 'utf8')
).toString('base64')}`);
const { canRoleOpenTab, normalizeRole, needsGoogleProfileProvisioning, roleSelectionMatches, roleDisplayName, ROLE_HOME_TABS, ROLE_TABS } = roleModule;

test('normalizes supported role casing and whitespace, rejects unknown roles', () => {
    assert.equal(normalizeRole('  OWNER  '), 'owner');
    assert.equal(normalizeRole(' Admin   Gudang '), 'admin gudang');
    assert.equal(normalizeRole('superadmin'), null);
    assert.equal(normalizeRole(null), null);
});

test('home tabs match each database role', () => {
    assert.deepEqual(ROLE_HOME_TABS, {
        owner: 'penjualan', kasir: 'penjualan', 'admin gudang': 'stok', manajer: 'dashboard'
    });
});

test('menu page titles omit decorative sequence numbers', async () => {
    const uiSource = await readFile(new URL('../modules/ui.js', import.meta.url), 'utf8');
    assert.doesNotMatch(uiSource, /'(?:penjualan|pelanggan|stok|supplier|dashboard|laporan)': '\d+\.\d+ /);
});

test('login selection must match the verified database profile role', () => {
    for (const role of ['owner', 'kasir', 'admin gudang', 'manajer']) {
        assert.equal(roleSelectionMatches(role, role), true);
    }
    assert.equal(roleSelectionMatches('admin gudang', 'admin_gudang'), true);
    assert.equal(roleSelectionMatches('owner', 'kasir'), false);
    assert.equal(roleSelectionMatches('kasir', 'owner'), false);
    assert.equal(roleSelectionMatches('unknown', 'owner'), false);
    assert.equal(roleDisplayName('admin_gudang'), 'Admin Gudang');
});

test('Google signup profiles created alongside the Auth account require verified provisioning', () => {
    const createdAt = '2026-10-29T10:00:00.000Z';
    assert.equal(needsGoogleProfileProvisioning({ app_metadata: { provider: 'google' }, created_at: createdAt }, { created_at: createdAt }), true);
    assert.equal(needsGoogleProfileProvisioning({ app_metadata: { provider: 'email' }, created_at: createdAt }, { created_at: createdAt }), false);
    assert.equal(needsGoogleProfileProvisioning({ app_metadata: { provider: 'google' }, created_at: createdAt }, { created_at: '2026-10-29T10:05:00.000Z' }), false);
});

test('role menu permissions follow the requested matrix', () => {
    assert.deepEqual(ROLE_TABS.owner, ['penjualan', 'pelanggan', 'stok', 'supplier', 'dashboard', 'laporan', 'setting']);
    assert.equal(canRoleOpenTab('owner', 'supplier'), true);
    assert.equal(canRoleOpenTab('owner', 'dashboard'), true);
    assert.equal(canRoleOpenTab('manajer', 'dashboard'), true);
    assert.equal(canRoleOpenTab('manajer', 'laporan'), true);
    assert.equal(canRoleOpenTab('kasir', 'pelanggan'), true);
    for (const tab of ['stok', 'supplier', 'dashboard', 'laporan']) assert.equal(canRoleOpenTab('kasir', tab), false);
    for (const tab of ['penjualan', 'dashboard', 'laporan']) assert.equal(canRoleOpenTab('admin gudang', tab), false);
    for (const tab of ['penjualan', 'stok', 'supplier']) assert.equal(canRoleOpenTab('manajer', tab), false);
});

test('missing or invalid profile roles grant no tabs', () => {
    assert.equal(canRoleOpenTab(null, 'penjualan'), false);
    assert.equal(canRoleOpenTab('invalid', 'setting'), false);
});

test('logout state cleanup removes the previous user and role', async () => {
    const stateSource = await readFile(new URL('../services/state.js', import.meta.url), 'utf8');
    const stateModule = await import(`data:text/javascript;base64,${Buffer.from(stateSource).toString('base64')}`);
    stateModule.store.setActiveUser({ id: 'user-1' }, 'owner');
    stateModule.store.clearActiveUser();
    assert.equal(stateModule.store.activeUser, null);
    assert.equal(stateModule.store.activeRole, '');
});
