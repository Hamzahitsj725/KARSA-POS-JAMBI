import { validateProductFields } from './productValidation.js';

export const PRODUCT_CSV_HEADERS = ['id_produk', 'nama', 'kategori', 'harga', 'stok'];
export const PRODUCT_CSV_TEMPLATE_HEADERS = [...PRODUCT_CSV_HEADERS, 'Waktu_Input', 'Waktu_Update'];

function parseCsvRecords(csvText) {
    const text = String(csvText ?? '').replace(/^\uFEFF/, '');
    const records = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let quoteClosed = false;
    let line = 1;
    let rowLine = 1;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (inQuotes) {
            if (char === '"' && text[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (char === '"') {
                inQuotes = false;
                quoteClosed = true;
            } else {
                field += char;
                if (char === '\n') line += 1;
            }
            continue;
        }

        if (quoteClosed && char !== ',' && char !== '\r' && char !== '\n' && !/\s/.test(char)) {
            return { error: `Format kutip CSV tidak valid pada baris ${line}.`, records: [] };
        }
        if (quoteClosed && /\s/.test(char) && char !== '\r' && char !== '\n') continue;
        if (char === '"') {
            if (field.length) return { error: `Format kutip CSV tidak valid pada baris ${line}.`, records: [] };
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
            quoteClosed = false;
        } else if (char === '\r' || char === '\n') {
            row.push(field);
            if (row.some(value => value.trim() !== '')) records.push({ values: row, line: rowLine });
            row = [];
            field = '';
            quoteClosed = false;
            if (char === '\r' && text[index + 1] === '\n') index += 1;
            line += 1;
            rowLine = line;
        } else {
            field += char;
        }
    }

    if (inQuotes) return { error: `Tanda kutip CSV belum ditutup pada baris ${rowLine}.`, records: [] };
    if (field.length || row.length) {
        row.push(field);
        if (row.some(value => value.trim() !== '')) records.push({ values: row, line: rowLine });
    }
    return { records };
}

export function validateProductCsv(csvText, existingProducts = []) {
    const parsed = parseCsvRecords(csvText);
    if (parsed.error) return { error: parsed.error, rows: [] };
    if (!parsed.records.length) return { error: 'File CSV kosong atau tidak memiliki header.', rows: [] };

    const [headerRecord, ...dataRecords] = parsed.records;
    const headers = headerRecord.values.map(value => value.trim());
    const acceptedHeaders = [PRODUCT_CSV_HEADERS, PRODUCT_CSV_TEMPLATE_HEADERS];
    if (!acceptedHeaders.some(accepted => accepted.length === headers.length
        && accepted.every((value, index) => value === headers[index]))) {
        return {
            error: `Header tidak sesuai. Gunakan urutan: ${PRODUCT_CSV_HEADERS.join(', ')} atau ${PRODUCT_CSV_TEMPLATE_HEADERS.join(', ')}.`,
            rows: []
        };
    }

    const knownProducts = [...(Array.isArray(existingProducts) ? existingProducts : [])];
    const rows = dataRecords.map(({ values, line }) => {
        if (values.length !== headers.length) {
            return { line, raw: values, product: null, errors: ['Jumlah kolom tidak sesuai header.'] };
        }
        const rowData = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
        const validation = validateProductFields({
            sku: rowData.id_produk,
            nama: rowData.nama,
            kategori: rowData.kategori,
            harga: rowData.harga,
            stok: rowData.stok
        }, { existingProducts: knownProducts });
        const errors = Object.values(validation.errors);
        let product = validation.valid ? validation.product : null;
        if (product && headers.length === PRODUCT_CSV_TEMPLATE_HEADERS.length) {
            for (const [csvColumn, dbColumn] of [['Waktu_Input', 'created_at'], ['Waktu_Update', 'updated_at']]) {
                const value = rowData[csvColumn].trim();
                if (!value) continue;
                const timestamp = new Date(value);
                if (!Number.isFinite(timestamp.getTime())) errors.push(`${csvColumn} harus berisi tanggal/waktu yang valid.`);
                else product[dbColumn] = timestamp.toISOString();
            }
            if (errors.length) product = null;
        }
        if (product) knownProducts.push(product);
        return { line, raw: rowData, product, errors };
    });

    return { rows };
}

export async function importValidProducts(rows, insertProduct) {
    const succeeded = [];
    const failed = [];
    for (const row of rows) {
        try {
            const result = await insertProduct(row.product);
            if (result?.error) {
                console.error(`[Import CSV] Gagal menyimpan baris ${row.line}:`, result.error);
                failed.push({
                    line: row.line,
                    reason: result.error.code === '23505'
                        ? 'SKU sudah digunakan produk lain.'
                        : result.error.message || 'Gagal menyimpan ke database.'
                });
            } else if (!Array.isArray(result?.data) || result.data.length !== 1) {
                failed.push({ line: row.line, reason: 'Database tidak mengembalikan produk yang tersimpan.' });
            } else {
                succeeded.push({ line: row.line, product: result.data[0] });
            }
        } catch (error) {
            console.error(`[Import CSV] Pengecualian saat menyimpan baris ${row.line}:`, error);
            failed.push({ line: row.line, reason: error?.message || 'Gagal menyimpan ke database.' });
        }
    }
    return { succeeded, failed };
}
