/** Validate catalog fields against public.produk's current text/numeric constraints. */
export function validateProductFields({ sku, nama, kategori, harga, stok }, { editing = false, existingProducts = [] } = {}) {
    const errors = {};
    const id_produk = typeof sku === 'string' ? sku.trim().toUpperCase() : '';
    const cleanName = typeof nama === 'string' ? nama.trim() : '';
    const cleanCategory = typeof kategori === 'string' && kategori.trim() ? kategori.trim() : 'Umum';
    const priceText = String(harga ?? '').trim();
    const stockText = String(stok ?? '').trim();
    const parsedPrice = Number(priceText);
    const parsedStock = Number(stockText);

    if (!id_produk) errors.sku = 'Kode SKU tidak boleh kosong.';
    else if (!editing && existingProducts.some(product => String(product.id_produk).toLowerCase() === id_produk.toLowerCase())) {
        errors.sku = `Kode SKU [${id_produk}] sudah digunakan produk lain.`;
    }
    if (!cleanName) errors.nama = 'Nama produk wajib diisi.';
    if (!priceText || !Number.isFinite(parsedPrice) || parsedPrice < 0) errors.harga = 'Harga jual harus berupa angka minimal 0.';
    if (!editing && (!stockText || !Number.isInteger(parsedStock) || parsedStock < 0)) errors.stok = 'Kuantitas stok awal harus bilangan bulat minimal 0.';

    return {
        valid: Object.keys(errors).length === 0,
        errors,
        product: {
            id_produk,
            nama: cleanName,
            kategori: cleanCategory,
            harga: parsedPrice,
            ...(editing ? {} : { stok: parsedStock })
        }
    };
}
