import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let supplierModuleSequence = 0;

function createSupplierHarness(databaseInsert) {
    const listeners = new Map();
    const notifications = [];
    const calls = { inserts: [], cached: 0 };
    const panelClasses = new Set(['hidden']);
    const panel = {
        classList: {
            add: value => panelClasses.add(value),
            remove: value => panelClasses.delete(value),
            contains: value => panelClasses.has(value),
            toggle(value) {
                if (panelClasses.has(value)) panelClasses.delete(value);
                else panelClasses.add(value);
            }
        }
    };
    const createElement = (id, value = '') => ({
        id,
        value,
        disabled: false,
        dataset: {},
        attributes: {},
        addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
        setAttribute(name, nextValue) { this.attributes[name] = nextValue; },
        focus() {},
        reset() { calls.reset = true; }
    });
    const elements = {
        'form-tambah-supplier': createElement('form-tambah-supplier'),
        'panel-tambah-supplier': panel,
        'btn-tambah-supplier': createElement('btn-tambah-supplier'),
        'btn-batal-supplier': createElement('btn-batal-supplier'),
        'error-tambah-supplier': createElement('error-tambah-supplier'),
        'btn-submit-supplier': createElement('btn-submit-supplier'),
        'supplier-id': createElement('supplier-id', 'SUP-001'),
        'supplier-nama': createElement('supplier-nama', 'Distributor Utama'),
        'supplier-kategori': createElement('supplier-kategori', ''),
        'supplier-kontak': createElement('supplier-kontak', '021-12345'),
        'supplier-table-body': createElement('supplier-table-body'),
        'restock-produk': createElement('restock-produk'),
        'restock-supplier': createElement('restock-supplier')
    };
    const store = {
        masterStok: [],
        masterSupplier: [],
        setMasterSupplier(value) { this.masterSupplier = value; }
    };
    globalThis.__supplierTestDeps = {
        store,
        panggilDatabaseAman: async payload => {
            calls.inserts.push(payload);
            return databaseInsert(payload);
        },
        cacheLocalData: async () => { calls.cached += 1; },
        showToast: (...args) => notifications.push(args)
    };
    globalThis.document = { getElementById: id => elements[id] || null };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    return { calls, elements, listeners, notifications, store, panelClasses };
}

async function loadSupplierModule() {
    let source = await readFile(new URL('../modules/suppliers.js', import.meta.url), 'utf8');
    source = source.replace(
        "import { store } from '../services/state.js';\nimport { panggilDatabaseAman } from '../services/db.js';\nimport { cacheLocalData } from '../services/offlineQueue.js';\nimport { showToast } from '../services/notification.js';",
        'const { store, panggilDatabaseAman, cacheLocalData, showToast } = globalThis.__supplierTestDeps;'
    );
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#supplier-test-${++supplierModuleSequence}`);
}

function clearSupplierHarness() {
    delete globalThis.document;
    delete globalThis.__supplierTestDeps;
    delete globalThis.navigator;
}

test('supplier form saves confirmed data, updates views, and ignores duplicate submits', async () => {
    let resolveInsert;
    const harness = createSupplierHarness(() => new Promise(resolve => { resolveInsert = resolve; }));
    try {
        const supplierModule = await loadSupplierModule();
        supplierModule.initSupplierForm();
        const submit = harness.listeners.get('form-tambah-supplier:submit');
        const firstSubmit = submit({ preventDefault() {} });
        const duplicateSubmit = submit({ preventDefault() {} });
        assert.equal(harness.calls.inserts.length, 1);
        assert.equal(harness.elements['btn-submit-supplier'].disabled, true);
        resolveInsert({ data: [{ id_supplier: 'SUP-001', nama: 'Distributor Utama', kategori: 'Distributor', kontak: '021-12345' }], error: null });
        await Promise.all([firstSubmit, duplicateSubmit]);

        assert.deepEqual(harness.calls.inserts[0], {
            tabel: 'supplier', aksi: 'INSERT',
            data: { id_supplier: 'SUP-001', nama: 'Distributor Utama', kategori: 'Distributor', kontak: '021-12345' }
        });
        assert.equal(harness.store.masterSupplier[0].id_supplier, 'SUP-001');
        assert.match(harness.elements['supplier-table-body'].innerHTML, /Distributor Utama/);
        assert.match(harness.elements['restock-supplier'].innerHTML, /SUP-001/);
        assert.equal(harness.calls.cached, 1);
        assert.equal(harness.calls.reset, true);
        assert.equal(harness.panelClasses.has('hidden'), true);
        assert.equal(harness.elements['btn-submit-supplier'].disabled, false);
        assert.deepEqual(harness.notifications[0], ['Supplier berhasil disimpan.', 'success']);
    } finally {
        clearSupplierHarness();
    }
});

test('supplier form preserves entered values after a database error', async () => {
    const harness = createSupplierHarness(async () => ({ data: null, error: new Error('insert denied') }));
    try {
        const supplierModule = await loadSupplierModule();
        supplierModule.initSupplierForm();
        await harness.listeners.get('form-tambah-supplier:submit')({ preventDefault() {} });

        assert.equal(harness.elements['supplier-id'].value, 'SUP-001');
        assert.equal(harness.elements['supplier-nama'].value, 'Distributor Utama');
        assert.match(harness.elements['error-tambah-supplier'].textContent, /gagal disimpan/i);
        assert.equal(harness.calls.reset, undefined);
        assert.equal(harness.notifications.length, 0);
        assert.equal(harness.store.masterSupplier.length, 0);
    } finally {
        clearSupplierHarness();
    }
});
