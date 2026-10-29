/** KARSA POS - report analytics backed by the transaction/product data already loaded by the app. */
import { store } from '../services/state.js';

const TIME_ZONE = 'Asia/Jakarta';
const MAX_RECENT_TRANSACTIONS = 8;
const STOCK_MINIMUM = 10;
const money = value => `Rp ${(Number(value) || 0).toLocaleString('id-ID')}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

let dashboardStockState = { status: 'loading', source: 'database' };
let dashboardReportLoadError = false;

function getStockAttentionProducts(products) {
    return (Array.isArray(products) ? products : [])
        .filter(product => {
            if (product?.stok === null || product?.stok === undefined || product?.stok === '') return false;
            const stock = Number(product.stok);
            return Number.isFinite(stock) && stock >= 0 && stock <= STOCK_MINIMUM;
        })
        .sort((first, second) => Number(first.stok) - Number(second.stok)
            || String(first.nama || '').localeCompare(String(second.nama || ''), 'id'));
}

export function renderDashboardLoading() {
    dashboardStockState = { status: 'loading', source: 'database' };
    const host = document.getElementById('report-analytics-root');
    if (!host) return;
    host.innerHTML = '<div class="report-dashboard__card report-dashboard__stock-state" role="status" aria-busy="true">Memuat data Dashboard dan stok…</div>';
}

export function refreshDashboardFromStore() {
    if (dashboardStockState.status === 'loading') return;
    renderDashboard(dashboardReportLoadError);
}

function renderLegacyManagementReport() {
    const tanggalHariIni = new Date().toLocaleDateString('id-ID');
    const riwayat = Array.isArray(store.riwayatNotaTransaksi) ? store.riwayatNotaTransaksi : [];
    const transaksiHariIni = riwayat.filter(tx => tx?.waktu && tx.waktu.split(' ')[0] === tanggalHariIni);
    const pendapatan = transaksiHariIni.reduce((sum, tx) => sum + (Number(tx.total) || 0), 0);
    const totalElement = document.getElementById('rep-total-duit');
    const countElement = document.getElementById('rep-total-nota');
    if (totalElement) totalElement.innerText = `Rp ${pendapatan.toLocaleString('id-ID')}`;
    if (countElement) countElement.innerText = `${transaksiHariIni.length} Nota`;

    const tbody = document.getElementById('laporan-table-body');
    if (!tbody) return;
    if (transaksiHariIni.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-xs text-slate-500 italic">Belum ada sirkulasi transaksi penjualan hari ini (${tanggalHariIni}).</td></tr>`;
        return;
    }
    tbody.innerHTML = transaksiHariIni.map(tx => `
        <tr class="hover:bg-slate-900/30">
            <td class="py-3 px-4 font-mono text-xs font-bold text-indigo-400">${escapeHtml(tx.nota)}</td>
            <td class="py-3 px-4 text-xs text-slate-400">${escapeHtml(tx.waktu)}</td>
            <td class="py-3 px-4 font-medium text-white">
                ${escapeHtml(tx.pembeli)}
                <span class="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">${escapeHtml(tx.metode || 'Tunai')}</span>
            </td>
            <td class="py-3 px-4 text-xs text-slate-400 max-w-xs truncate" title="${escapeHtml(tx.rincian)}">${escapeHtml(tx.rincian)}</td>
            <td class="py-3 px-4 text-right font-bold text-emerald-400">Rp ${Number(tx.total || 0).toLocaleString('id-ID')}</td>
        </tr>
    `).join('');
}

function dateKeyInJakarta(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
}

function transactionDate(tx) {
    if (tx?.created_at) {
        const date = new Date(tx.created_at);
        if (Number.isFinite(date.getTime())) return dateKeyInJakarta(date);
    }
    // Offline/local records may not have created_at; checkout stores DD/MM/YYYY ... WIB.
    const match = String(tx?.waktu || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return '';
    const [, day, month, year] = match;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00+07:00`);
    return Number.isFinite(parsed.getTime()) && dateKeyInJakarta(parsed) === date ? date : '';
}

function parseItems(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function periodBounds(period, now = new Date()) {
    const today = dateKeyInJakarta(now);
    if (!today) return { from: '', to: '' };
    if (period === 'custom') {
        return {
            from: document.getElementById('report-date-from')?.value || today,
            to: document.getElementById('report-date-to')?.value || today
        };
    }
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 1;
    const [year, month, day] = today.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, day - days + 1));
    return {
        from: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`,
        to: today
    };
}

function formatDateLabel(key, options = { day: 'numeric', month: 'short' }) {
    const [year, month, day] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('id-ID', { ...options, timeZone: TIME_ZONE })
        .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function renderSalesChart(days, totals) {
    const width = 720, height = 220, left = 54, right = 12, top = 14, bottom = 38;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const max = totals.reduce((highest, value) => Math.max(highest, value), 0);
    const scale = max || 1;
    const points = totals.map((value, index) => {
        const x = left + (days.length <= 1 ? plotWidth / 2 : index * plotWidth / (days.length - 1));
        const y = top + plotHeight - (value / scale) * plotHeight;
        return `${x},${y}`;
    });
    const labelStep = Math.max(1, Math.ceil(days.length / 7));
    const labels = days.map((key, index) => index % labelStep === 0 || index === days.length - 1
        ? `<text x="${left + (days.length <= 1 ? plotWidth / 2 : index * plotWidth / (days.length - 1))}" y="${height - 10}" text-anchor="middle">${escapeHtml(formatDateLabel(key))}</text>` : '').join('');
    const guides = [0, 0.5, 1].map(fraction => {
        const y = top + plotHeight * fraction;
        return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${escapeHtml(money(max * (1 - fraction)))}</text>`;
    }).join('');
    const first = points.length ? `${left},${top + plotHeight} ${points.join(' ')} ${width - right},${top + plotHeight}` : '';
    return `<svg class="report-dashboard__chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik total penjualan harian">
        <g class="report-dashboard__chart-guides">${guides}</g>
        ${points.length ? `<polygon class="report-dashboard__chart-area" points="${first}"/><polyline class="report-dashboard__chart-line" points="${points.join(' ')}"/>` : ''}
        ${points.map(point => { const [x, y] = point.split(','); return `<circle class="report-dashboard__chart-point" cx="${x}" cy="${y}" r="3"/>`; }).join('')}
        <g class="report-dashboard__chart-labels">${labels}</g></svg>`;
}

function renderPayments(totals, sum) {
    const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const colors = ['#0284c7', '#7c3aed', '#06b6d4', '#a78bfa'];
    const total = rows.reduce((value, [, amount]) => value + amount, 0);
    const segments = rows.map(([method, amount], index) => {
        const portion = total > 0 ? amount / total * 100 : 0;
        return `<div class="report-dashboard__legend-row"><span class="report-dashboard__legend-dot" style="--legend-color:${colors[index % colors.length]}"></span><span>${escapeHtml(method)}</span><strong>${escapeHtml(money(amount))}</strong><small>${total ? `${(portion * 100).toFixed(1)}%` : '0%'}</small></div>`;
    }).join('');
    const chart = total ? `conic-gradient(${rows.map(([, amount], index) => {
        const end = rows.slice(0, index + 1).reduce((value, row) => value + row[1], 0) / total * 100;
        const start = rows.slice(0, index).reduce((value, row) => value + row[1], 0) / total * 100;
        return `${colors[index % colors.length]} ${start}% ${end}%`;
    }).join(', ')})` : 'conic-gradient(#cbd5e1 0 100%)';
    return `<div class="report-dashboard__payment-content"><div class="report-dashboard__donut" style="--payment-chart:${chart}"><span>${escapeHtml(money(sum))}<small>Total</small></span></div><div class="report-dashboard__legend">${segments || '<p class="report-dashboard__muted">Belum ada data metode pembayaran.</p>'}</div></div>`;
}

function renderDashboard(loadError = false) {
    const host = document.getElementById('report-analytics-root');
    if (!host) return;
    if (loadError) {
        const stockError = dashboardStockState.status === 'error'
            ? '<div class="report-dashboard__stock-state report-dashboard__stock-state--error" role="alert"><strong>Data stok gagal dimuat</strong><p>Periksa koneksi dan izin akses produk, lalu coba muat ulang.</p></div>' : '';
        host.innerHTML = `<div class="report-dashboard"><div class="report-dashboard__card report-dashboard__load-error" role="status"><strong>Laporan belum dapat dimuat</strong><p>Riwayat transaksi tidak dapat diambil. Periksa koneksi dan akses akun, lalu muat ulang aplikasi.</p></div>${stockError}</div>`;
        return;
    }
    const period = document.getElementById('report-period')?.value || '7d';
    let { from, to } = periodBounds(period);
    if (from > to) [from, to] = [to, from];
    const allTransactions = Array.isArray(store.riwayatNotaTransaksi) ? store.riwayatNotaTransaksi : [];
    const transactions = allTransactions.filter(tx => {
        const date = transactionDate(tx);
        return date && date >= from && date <= to;
    });
    const totalSales = transactions.reduce((sum, tx) => sum + (Number.isFinite(Number(tx.total)) ? Number(tx.total) : 0), 0);
    const count = transactions.length;
    const stockProducts = getStockAttentionProducts(store.masterStok);
    const fromDate = new Date(`${from}T00:00:00+07:00`);
    const toDate = new Date(`${to}T00:00:00+07:00`);
    const dayCount = Math.max(1, Math.floor((toDate - fromDate) / 86400000) + 1);
    const days = Array.from({ length: dayCount }, (_, i) => {
        const date = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)) + i));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    });
    const salesByDay = Object.fromEntries(days.map(day => [day, 0]));
    const payments = {};
    const products = new Map();
    let missingItemDetails = false;
    for (const tx of transactions) {
        const key = transactionDate(tx);
        if (key in salesByDay) salesByDay[key] += Number(tx.total) || 0;
        const method = String(tx.metode || 'Tidak diketahui');
        payments[method] = (payments[method] || 0) + (Number(tx.total) || 0);
        const items = parseItems(tx.items);
        if (!items.length && Number(tx.total) > 0) missingItemDetails = true;
        for (const item of items) {
            const name = String(item?.nama || item?.id || '').trim();
            const qty = Number(item?.qty);
            if (!name || !Number.isFinite(qty) || qty <= 0) continue;
            const product = products.get(name) || { name, units: 0, sales: 0 };
            product.units += qty;
            product.sales += Number.isFinite(Number(item.subtotal)) ? Number(item.subtotal) : (Number(item.harga) || 0) * qty;
            products.set(name, product);
        }
    }
    const bestSellers = [...products.values()].sort((a, b) => b.units - a.units).slice(0, 5);
    const recent = [...transactions].sort((a, b) => transactionDate(b).localeCompare(transactionDate(a)))
        .slice(0, MAX_RECENT_TRANSACTIONS);
    const tableBody = recent.length ? recent.map(tx => `<tr>
        <td class="report-dashboard__mono">${escapeHtml(tx.nota || '—')}</td>
        <td>${escapeHtml(tx.waktu || (tx.created_at ? formatDateLabel(transactionDate(tx), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'))}</td>
        <td>${escapeHtml(tx.pembeli || '—')}</td><td>${escapeHtml(tx.metode || '—')}</td>
        <td class="report-dashboard__amount">${escapeHtml(money(tx.total))}</td></tr>`).join('')
        : '<tr><td colspan="5" class="report-dashboard__empty">Belum ada transaksi pada periode ini.</td></tr>';
    const bestSellerMarkup = bestSellers.length ? bestSellers.map((product, index) => `<li><span class="report-dashboard__rank">${index + 1}</span><span class="report-dashboard__product-name">${escapeHtml(product.name)}<small>${product.units.toLocaleString('id-ID')} unit terjual</small></span><strong>${escapeHtml(money(product.sales))}</strong></li>`).join('')
        : `<li class="report-dashboard__empty">${missingItemDetails ? 'Data item historis belum tersedia untuk seluruh transaksi pada periode ini.' : 'Belum ada data item transaksi pada periode ini.'}</li>`;
    const partialItemsNotice = missingItemDetails && bestSellers.length
        ? '<p class="report-dashboard__notice">Sebagian transaksi tidak menyimpan rincian item; daftar ini hanya mencakup item yang tersedia.</p>' : '';
    const filterLabel = `${formatDateLabel(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDateLabel(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const stockCount = dashboardStockState.status === 'ready' ? stockProducts.length : '—';
    const stockSummary = dashboardStockState.status === 'ready'
        ? `Produk dengan stok ≤ ${STOCK_MINIMUM} unit`
        : dashboardStockState.status === 'loading' ? 'Memuat data stok'
            : dashboardStockState.status === 'unavailable' ? 'Data stok tidak tersedia'
                : 'Data stok gagal dimuat';
    const stockPanel = dashboardStockState.status === 'loading'
        ? '<div class="report-dashboard__stock-state" role="status" aria-busy="true">Memuat data stok…</div>'
        : dashboardStockState.status === 'error'
            ? '<div class="report-dashboard__stock-state report-dashboard__stock-state--error" role="alert"><strong>Data stok gagal dimuat</strong><p>Periksa koneksi dan izin akses produk, lalu coba muat ulang.</p></div>'
            : dashboardStockState.status === 'unavailable'
                ? '<div class="report-dashboard__stock-state" role="status">Data stok belum tersedia pada perangkat ini.</div>'
                : stockProducts.length
                    ? `<ul class="report-dashboard__stock-list">${stockProducts.map(product => {
                        const stock = Number(product.stok);
                        const status = stock === 0 ? 'Habis' : stock < STOCK_MINIMUM ? 'Menipis' : 'Batas Minimum';
                        const stateClass = stock === 0 ? 'out' : stock < STOCK_MINIMUM ? 'low' : 'minimum';
                        return `<li class="report-dashboard__stock-item report-dashboard__stock-item--${stateClass}"><span class="report-dashboard__stock-name">${escapeHtml(product.nama)}</span><span class="report-dashboard__stock-quantity">${stock.toLocaleString('id-ID')} unit</span><strong class="report-dashboard__stock-status">${status}</strong></li>`;
                    }).join('')}</ul><p class="report-dashboard__stock-footnote">Batas minimum: ${STOCK_MINIMUM} unit.</p>`
                    : '<p class="report-dashboard__stock-safe" role="status">Semua stok dalam kondisi aman.</p>';
    const stockSourceNote = dashboardStockState.status === 'ready' && dashboardStockState.source === 'cache'
        ? '<p class="report-dashboard__notice">Menampilkan salinan data stok lokal; belum diperbarui dari database.</p>' : '';

    host.innerHTML = `<div class="report-dashboard">
        <div class="report-dashboard__intro"><div><p class="report-dashboard__eyebrow">RINGKASAN USAHA</p><h2>Analitik Penjualan</h2><p>Performa tercatat ${escapeHtml(filterLabel)} · zona waktu WIB</p></div>
            <div class="report-dashboard__filters"><label for="report-period">Periode</label><select id="report-period"><option value="today" ${period === 'today' ? 'selected' : ''}>Hari ini</option><option value="7d" ${period === '7d' ? 'selected' : ''}>7 hari terakhir</option><option value="30d" ${period === '30d' ? 'selected' : ''}>30 hari terakhir</option><option value="custom" ${period === 'custom' ? 'selected' : ''}>Rentang khusus</option></select>
            <input id="report-date-from" type="date" aria-label="Tanggal mulai" value="${escapeHtml(from)}" ${period === 'custom' ? '' : 'hidden'}><input id="report-date-to" type="date" aria-label="Tanggal akhir" value="${escapeHtml(to)}" ${period === 'custom' ? '' : 'hidden'}></div></div>
        <div class="report-dashboard__kpis">
            <article class="report-dashboard__card report-dashboard__kpi"><span><i class="fa-solid fa-wallet report-dashboard__icon" aria-hidden="true"></i>Total penjualan</span><strong>${escapeHtml(money(totalSales))}</strong><small>Nilai transaksi tercatat pada periode</small></article>
            <article class="report-dashboard__card report-dashboard__kpi"><span><i class="fa-solid fa-receipt report-dashboard__icon" aria-hidden="true"></i>Jumlah transaksi</span><strong>${count.toLocaleString('id-ID')}</strong><small>Skema tidak menyediakan status pembatalan</small></article>
            <article class="report-dashboard__card report-dashboard__kpi"><span><i class="fa-solid fa-calculator report-dashboard__icon" aria-hidden="true"></i>Rata-rata transaksi</span><strong>${escapeHtml(money(count ? totalSales / count : 0))}</strong><small>Total penjualan ÷ jumlah transaksi</small></article>
            <article class="report-dashboard__card report-dashboard__kpi"><span><i class="fa-solid fa-boxes-stacked report-dashboard__icon" aria-hidden="true"></i>Perhatian stok</span><strong>${stockCount}</strong><small>${stockSummary}</small></article>
        </div>
        <div class="report-dashboard__main-grid">
            <article class="report-dashboard__card"><div class="report-dashboard__card-heading"><div><h3><i class="fa-solid fa-chart-line report-dashboard__icon" aria-hidden="true"></i>Tren penjualan</h3><p>Total harian berdasarkan waktu transaksi</p></div><span class="report-dashboard__period-label">${escapeHtml(filterLabel)}</span></div>
                <div class="report-dashboard__chart-wrap">${count ? renderSalesChart(days, days.map(day => salesByDay[day])) : '<div class="report-dashboard__chart-empty">Belum ada penjualan pada periode ini.</div>'}</div></article>
            <article class="report-dashboard__card"><div class="report-dashboard__card-heading"><div><h3><i class="fa-solid fa-credit-card report-dashboard__icon" aria-hidden="true"></i>Metode pembayaran</h3><p>Distribusi nilai transaksi</p></div></div>${renderPayments(payments, totalSales)}</article>
        </div>
        <div class="report-dashboard__secondary-grid">
            <article class="report-dashboard__card"><div class="report-dashboard__card-heading"><div><h3><i class="fa-solid fa-box report-dashboard__icon" aria-hidden="true"></i>Produk terlaris</h3><p>Diurutkan berdasarkan unit terjual</p></div></div><ol class="report-dashboard__seller-list">${bestSellerMarkup}</ol>${partialItemsNotice}</article>
            <article class="report-dashboard__card"><div class="report-dashboard__card-heading"><div><h3><i class="fa-solid fa-triangle-exclamation report-dashboard__icon" aria-hidden="true"></i>Perhatian stok</h3><p>Status berdasarkan jumlah stok aktual</p></div></div>${stockPanel}${stockSourceNote}</article>
        </div>
        <article class="report-dashboard__card report-dashboard__transactions"><div class="report-dashboard__card-heading"><div><h3><i class="fa-solid fa-clipboard-list report-dashboard__icon" aria-hidden="true"></i>Transaksi terbaru</h3><p>Maksimal ${MAX_RECENT_TRANSACTIONS} transaksi pada periode terpilih</p></div></div><div class="report-dashboard__table-wrap"><table><thead><tr><th>No. nota</th><th>Waktu</th><th>Pembeli</th><th>Metode</th><th class="report-dashboard__amount">Total</th></tr></thead><tbody>${tableBody}</tbody></table></div></article>
        <p class="report-dashboard__footnote">Angka dihitung dari riwayat transaksi yang tersedia bagi akun aktif. Data transaksi lama tanpa rincian item tidak masuk ke peringkat produk.</p>
    </div>`;
    attachFilters();

}

let filtersAttached = false;
function attachFilters() {
    if (filtersAttached) return;
    const host = document.getElementById('report-analytics-root');
    if (!host) return;
    filtersAttached = true;
    host.addEventListener('change', event => {
        if (!['report-period', 'report-date-from', 'report-date-to'].includes(event.target?.id)) return;
        if (event.target.id === 'report-period' && event.target.value === 'custom') {
            const from = document.getElementById('report-date-from');
            const to = document.getElementById('report-date-to');
            if (from) from.hidden = false;
            if (to) to.hidden = false;
            return;
        }
        renderDashboard();
    });
}

export function kalkulasiLaporanDashboard(loadError = false, stockStatus = 'ready', stockSource = 'database') {
    dashboardReportLoadError = loadError;
    dashboardStockState = { status: stockStatus, source: stockSource };
    renderLegacyManagementReport();
    renderDashboard(loadError);
}
