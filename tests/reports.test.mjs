import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('report dashboard renders actual sales, payment, and item totals safely', async () => {
    const currentDate = new Date().toISOString();
    globalThis.__reportTestStore = {
        masterStok: [
            { id_produk: 'STK-0', nama: 'Produk Habis', stok: 0 },
            { id_produk: 'STK-1', nama: 'Produk Menipis', stok: 1 },
            { id_produk: 'STK-9', nama: 'Produk Ambang Dekat', stok: 9 },
            { id_produk: 'STK-10', nama: 'Produk Batas Minimum', stok: 10 },
            { id_produk: 'STK-11', nama: 'Produk Aman', stok: 11 }
        ],
        riwayatNotaTransaksi: [{
            created_at: currentDate,
            waktu: `${new Date().toLocaleDateString('id-ID')} 08:00 WIB`,
            nota: 'NT-1',
            pembeli: '<Pembeli>',
            rincian: 'Kopi (2), Roti (1)',
            metode: 'QRIS',
            total: 12500,
            items: [
                { id: 'SKU1', nama: 'Kopi', qty: 2, harga: 5000, subtotal: 10000 },
                { id: 'SKU2', nama: 'Roti', qty: 1, harga: 2500, subtotal: 2500 }
            ]
        }]
    };

    let rendered = '';
    const legacyTotal = {};
    const legacyCount = {};
    const legacyTable = {};
    const host = {
        addEventListener(_type, listener) { this.changeListener = listener; },
        set innerHTML(value) { rendered = value; },
        get innerHTML() { return rendered; }
    };
    globalThis.document = {
        getElementById(id) {
            if (id === 'report-analytics-root') return host;
            if (id === 'report-period') return { value: 'today' };
            if (id === 'rep-total-duit') return legacyTotal;
            if (id === 'rep-total-nota') return legacyCount;
            if (id === 'laporan-table-body') return legacyTable;
            return null;
        }
    };

    let source = await readFile(new URL('../modules/reports.js', import.meta.url), 'utf8');
    source = source.replace(
        "import { store } from '../services/state.js';",
        'const store = globalThis.__reportTestStore;'
    );
    const reportModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    reportModule.kalkulasiLaporanDashboard();

    assert.match(rendered, /Rp 12\.500/);
    assert.match(rendered, /QRIS/);
    assert.match(rendered, /Kopi/);
    assert.match(rendered, /2 unit terjual/);
    for (const icon of ['wallet', 'receipt', 'calculator', 'boxes-stacked', 'chart-line', 'credit-card', 'box', 'triangle-exclamation', 'clipboard-list']) {
        assert.match(rendered, new RegExp(`fa-${icon} report-dashboard__icon`));
    }
    assert.match(rendered, /Perhatian stok<\/span><strong>4<\/strong><small>Produk dengan stok ≤ 10 unit/);
    assert.match(rendered, /Produk Habis<\/span><span class="report-dashboard__stock-quantity">0 unit<\/span><strong class="report-dashboard__stock-status">Habis/);
    assert.match(rendered, /Produk Menipis<\/span><span class="report-dashboard__stock-quantity">1 unit<\/span><strong class="report-dashboard__stock-status">Menipis/);
    assert.match(rendered, /Produk Ambang Dekat<\/span><span class="report-dashboard__stock-quantity">9 unit<\/span><strong class="report-dashboard__stock-status">Menipis/);
    assert.match(rendered, /Produk Batas Minimum<\/span><span class="report-dashboard__stock-quantity">10 unit<\/span><strong class="report-dashboard__stock-status">Batas Minimum/);
    assert.doesNotMatch(rendered, /Produk Aman/);
    assert.equal((rendered.match(/class="report-dashboard__stock-item /g) || []).length, 4);
    assert.match(rendered, /&lt;Pembeli&gt;/);
    assert.equal(typeof host.changeListener, 'function');
    assert.equal(legacyTotal.innerText, 'Rp 12.500');
    assert.equal(legacyCount.innerText, '1 Nota');
    assert.match(legacyTable.innerHTML, /NT-1/);
    assert.match(legacyTable.innerHTML, /Kopi \(2\), Roti \(1\)/);
    reportModule.kalkulasiLaporanDashboard(false, 'loading');
    assert.match(rendered, /Memuat data stok…/);
    reportModule.kalkulasiLaporanDashboard(false, 'error');
    assert.match(rendered, /Data stok gagal dimuat/);
    reportModule.kalkulasiLaporanDashboard(false, 'ready');
    globalThis.__reportTestStore.masterStok = [];
    reportModule.kalkulasiLaporanDashboard(false, 'ready');
    assert.match(rendered, /Semua stok dalam kondisi aman/);
    assert.match(rendered, /Perhatian stok<\/span><strong>0<\/strong>/);
    globalThis.__reportTestStore.masterStok = [
        { id_produk: 'STK-0', nama: 'Produk Habis', stok: 0 },
        { id_produk: 'STK-1', nama: 'Produk Menipis', stok: 1 },
        { id_produk: 'STK-9', nama: 'Produk Ambang Dekat', stok: 9 },
        { id_produk: 'STK-10', nama: 'Produk Batas Minimum', stok: 10 },
        { id_produk: 'STK-11', nama: 'Produk Aman', stok: 11 }
    ];
    reportModule.refreshDashboardFromStore();
    assert.match(rendered, /Perhatian stok<\/span><strong>4<\/strong>/);
    reportModule.kalkulasiLaporanDashboard(true, 'error');
    assert.match(rendered, /Laporan belum dapat dimuat/);
    assert.match(rendered, /Data stok gagal dimuat/);
    assert.doesNotMatch(rendered, /Rp 12\.500/);
    assert.match(legacyTable.innerHTML, /NT-1/);

    delete globalThis.document;
    delete globalThis.__reportTestStore;
});

test('Dashboard and Laporan Manajemen have separate navigation and panels', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    for (const id of ['dashboard', 'laporan']) {
        assert.equal((html.match(new RegExp(`id="btn-${id}"`, 'g')) || []).length, 1);
        assert.equal((html.match(new RegExp(`id="tab-${id}"`, 'g')) || []).length, 1);
        assert.match(html, new RegExp(`switchTab\\('${id}'\\)`));
    }
    assert.match(html, /id="rep-total-duit"/);
    assert.match(html, /id="rep-total-nota"/);
    assert.match(html, /id="laporan-table-body"/);
});
