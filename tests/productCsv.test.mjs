import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const validationSource = await readFile(new URL('../services/productValidation.js', import.meta.url), 'utf8');
let csvSource = await readFile(new URL('../services/productCsv.js', import.meta.url), 'utf8');
csvSource = csvSource.replace("import { validateProductFields } from './productValidation.js';", '');
const combinedSource = `${validationSource}\n${csvSource}`;
const { PRODUCT_CSV_TEMPLATE_HEADERS, validateProductCsv, importValidProducts } = await import(
    `data:text/javascript;base64,${Buffer.from(combinedSource).toString('base64')}`
);

test('latest template CSV header is accepted and timestamps map to schema fields', async () => {
    const template = await readFile(new URL('../assets/template_import_produk_karsa_pos.csv', import.meta.url), 'utf8');
    const [header] = template.replace(/^\uFEFF/, '').split(/\r?\n/);
    assert.deepEqual(header.split(','), PRODUCT_CSV_TEMPLATE_HEADERS);
    const actualTemplate = validateProductCsv(template);
    assert.equal(actualTemplate.error, undefined);
    assert.ok(actualTemplate.rows.length > 0);
    assert.ok(actualTemplate.rows.every(row => row.product));
    const templateResult = validateProductCsv(`${header}\nSKU-02,Teh,Makanan,1000,2,2026-10-29 00:00:00.123456+00,2026-10-29 00:00:00.123456+00`);
    assert.equal(templateResult.error, undefined);
    assert.match(templateResult.rows[0].product.created_at, /^2026-/);

    const csv = '\uFEFFid_produk,nama,kategori,harga,stok\r\nSKU-01,"Kopi ""Arabika"", Premium – khas Jambi",Minuman,12500,4\r\n\r\n';
    const result = validateProductCsv(csv);
    assert.equal(result.error, undefined);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].product.nama, 'Kopi "Arabika", Premium – khas Jambi');
    assert.equal(result.rows[0].product.kategori, 'Minuman');
    assert.equal(result.rows[0].product.id_produk, 'SKU-01');
});

test('empty files, mismatched headers, and malformed quotes are rejected before preview import', () => {
    assert.match(validateProductCsv(' \r\n').error, /kosong/);
    assert.match(validateProductCsv('nama,id_produk,kategori,harga,stok\nItem,SKU-1,Makanan,10,1').error, /Header tidak sesuai/);
    assert.match(validateProductCsv('id_produk,nama,kategori,harga,stok\nSKU-1,"Item,Makanan,10,1').error, /belum ditutup/);
});

test('invalid values and duplicate text SKUs are reported by source line', () => {
    const csv = [
        'id_produk,nama,kategori,harga,stok',
        'old-1,Duplikat,Makanan,10,1',
        'new-1,Produk Baru,Makanan,10,1',
        'NEW-1,Duplikat Dalam File,Makanan,20,2',
        'new-2,,Makanan,10,1',
        'new-3,Invalid,Makanan,-2,1.5'
    ].join('\n');
    const result = validateProductCsv(csv, [{ id_produk: 'OLD-1' }]);
    assert.deepEqual(result.rows.map(row => row.line), [2, 3, 4, 5, 6]);
    assert.equal(result.rows[0].errors[0].includes('sudah digunakan'), true);
    assert.equal(result.rows[1].errors.length, 0);
    assert.equal(result.rows[2].errors[0].includes('sudah digunakan'), true);
    assert.ok(result.rows[3].errors.some(message => message.includes('Nama produk wajib')));
    assert.ok(result.rows[4].errors.some(message => message.includes('Harga jual')));
    assert.ok(result.rows[4].errors.some(message => message.includes('Kuantitas stok')));
});

test('database failures and missing insert responses are counted without false successes', async () => {
    const rows = [
        { line: 2, product: { id_produk: 'OK' } },
        { line: 3, product: { id_produk: 'DUP' } },
        { line: 4, product: { id_produk: 'NO-RETURN' } }
    ];
    let calls = 0;
    const result = await importValidProducts(rows, async product => {
        calls += 1;
        if (product.id_produk === 'DUP') return { data: null, error: { code: '23505', message: 'duplicate' } };
        if (product.id_produk === 'NO-RETURN') return { data: null, error: null };
        return { data: [product], error: null };
    });
    assert.equal(calls, 3);
    assert.deepEqual(result.succeeded.map(row => row.product.id_produk), ['OK']);
    assert.deepEqual(result.failed.map(row => row.line), [3, 4]);
    assert.match(result.failed[0].reason, /SKU sudah digunakan/);
});

test('upload and confirmation controls are present while selection itself has no storage action', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="btn-upload-produk-csv"/);
    assert.match(html, /id="input-import-produk-csv" type="file" accept="\.csv,text\/csv"/);
    assert.match(html, /id="btn-konfirmasi-import-produk-csv"/);
    const inventory = await readFile(new URL('../modules/inventory.js', import.meta.url), 'utf8');
    assert.match(inventory, /confirmButton\.addEventListener\('click'/);
    assert.match(inventory, /tabel: 'produk', aksi: 'INSERT', data: \[product\]/);
    assert.match(inventory, /if \(isImportingProductCsv \|\| productCsvImportCompleted\) return/);
    assert.match(inventory, /file\.name\.toLowerCase\(\)\.endsWith\('\.csv'\)/);
});
