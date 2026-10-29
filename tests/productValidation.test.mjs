import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../services/productValidation.js', import.meta.url), 'utf8');
const { validateProductFields } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('create accepts valid schema fields and normalizes SKU', () => {
    const result = validateProductFields({ sku: ' brg-1 ', nama: ' Teh ', kategori: ' Minuman ', harga: '0', stok: '0' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.product, { id_produk: 'BRG-1', nama: 'Teh', kategori: 'Minuman', harga: 0, stok: 0 });
});

test('create rejects empty, duplicate SKU, invalid price, and noninteger or negative stock', () => {
    const result = validateProductFields({ sku: 'p-1', nama: '', harga: '-1', stok: '1.5' }, {
        existingProducts: [{ id_produk: 'P-1' }]
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.sku);
    assert.ok(result.errors.nama);
    assert.ok(result.errors.harga);
    assert.ok(result.errors.stok);
    assert.ok(validateProductFields({ sku: 'p-2', nama: 'Valid', harga: '10', stok: '' }).errors.stok);
});

test('edit validates editable fields without changing stock or product ID', () => {
    const result = validateProductFields({ sku: 'P-1', nama: 'Updated name', kategori: 'Lainnya', harga: '12500', stok: 'not-used' }, {
        editing: true, existingProducts: [{ id_produk: 'P-1' }]
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.product, { id_produk: 'P-1', nama: 'Updated name', kategori: 'Lainnya', harga: 12500 });
});
