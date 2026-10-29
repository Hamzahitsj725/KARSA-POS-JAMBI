/**
 * KARSA POS - Central State Management Service
 * Menggantikan variabel array bebas dengan manajemen state terpusat & terstruktur
 */

class AppStore {
    constructor() {
        this._state = {
            activeUser: null,
            activeRole: "",
            masterStok: [],
            masterMember: [],
            masterSupplier: [],
            keranjangPOS: [],
            riwayatNotaTransaksi: [],
            isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
            offlineQueueCount: 0,
            isSyncing: false
        };

        this._listeners = new Map();
    }

    // Akses state langsung (Read-only reference)
    get state() {
        return this._state;
    }

    get activeUser() { return this._state.activeUser; }
    get activeRole() { return this._state.activeRole; }
    get masterStok() { return this._state.masterStok; }
    get masterMember() { return this._state.masterMember; }
    get masterSupplier() { return this._state.masterSupplier; }
    get keranjangPOS() { return this._state.keranjangPOS; }
    get riwayatNotaTransaksi() { return this._state.riwayatNotaTransaksi; }
    get isOnline() { return this._state.isOnline; }
    get offlineQueueCount() { return this._state.offlineQueueCount; }
    get isSyncing() { return this._state.isSyncing; }

    // Registrasi listener saat suatu slice data berubah
    subscribe(key, listener) {
        if (!this._listeners.has(key)) {
            this._listeners.set(key, new Set());
        }
        this._listeners.get(key).add(listener);

        return () => {
            this._listeners.get(key)?.delete(listener);
        };
    }

    _notify(key) {
        if (this._listeners.has(key)) {
            const listeners = this._listeners.get(key);
            for (const fn of listeners) {
                try {
                    fn(this._state[key], this._state);
                } catch (e) {
                    console.error(`Listener error on key '${key}':`, e);
                }
            }
        }
    }

    // Mutator Methods
    setActiveUser(user, role) {
        this._state.activeUser = user;
        this._state.activeRole = role || "";
        this._notify('activeUser');
        this._notify('activeRole');
    }

    clearActiveUser() {
        this._state.activeUser = null;
        this._state.activeRole = '';
        this._notify('activeUser');
        this._notify('activeRole');
    }

    setMasterStok(stokList) {
        this._state.masterStok = Array.isArray(stokList) ? [...stokList] : [];
        this._notify('masterStok');
    }

    upsertProductInState(product) {
        const index = this._state.masterStok.findIndex(p => p.id_produk === product.id_produk);
        if (index >= 0) {
            this._state.masterStok[index] = { ...this._state.masterStok[index], ...product };
        } else {
            this._state.masterStok.push(product);
        }
        this._state.masterStok.sort((a, b) => (a.id_produk || "").localeCompare(b.id_produk || ""));
        this._notify('masterStok');
    }

    removeProductFromState(idProduk) {
        const next = this._state.masterStok.filter(product => product.id_produk !== idProduk);
        if (next.length === this._state.masterStok.length) return false;
        this._state.masterStok = next;
        this._notify('masterStok');
        return true;
    }

    updateSingleProductStock(id_produk, newStok) {
        const target = this._state.masterStok.find(p => p.id_produk === id_produk);
        if (target) {
            target.stok = newStok;
            this._notify('masterStok');
        }
    }

    setMasterMember(memberList) {
        this._state.masterMember = Array.isArray(memberList) ? [...memberList] : [];
        this._notify('masterMember');
    }

    upsertMemberInState(member) {
        const index = this._state.masterMember.findIndex(m => m.id_member === member.id_member);
        if (index >= 0) {
            this._state.masterMember[index] = { ...this._state.masterMember[index], ...member };
        } else {
            this._state.masterMember.push(member);
        }
        this._notify('masterMember');
    }

    setMasterSupplier(supplierList) {
        this._state.masterSupplier = Array.isArray(supplierList) ? [...supplierList] : [];
        this._notify('masterSupplier');
    }

    setRiwayatNotaTransaksi(txList) {
        this._state.riwayatNotaTransaksi = Array.isArray(txList) ? [...txList] : [];
        this._notify('riwayatNotaTransaksi');
    }

    addRiwayatTransaksi(nota) {
        this._state.riwayatNotaTransaksi.unshift(nota);
        this._notify('riwayatNotaTransaksi');
    }

    setKeranjangPOS(items) {
        this._state.keranjangPOS = Array.isArray(items) ? [...items] : [];
        this._notify('keranjangPOS');
    }

    addToKeranjang(item) {
        const existing = this._state.keranjangPOS.find(i => i.id === item.id);
        if (existing) {
            existing.qty += item.qty;
            existing.subtotal = existing.qty * existing.harga;
        } else {
            this._state.keranjangPOS.push(item);
        }
        this._notify('keranjangPOS');
    }

    removeFromKeranjang(index) {
        if (index >= 0 && index < this._state.keranjangPOS.length) {
            this._state.keranjangPOS.splice(index, 1);
            this._notify('keranjangPOS');
        }
    }

    clearKeranjang() {
        this._state.keranjangPOS = [];
        this._notify('keranjangPOS');
    }

    setNetworkStatus(isOnline, queueCount = null) {
        this._state.isOnline = isOnline;
        if (queueCount !== null) {
            this._state.offlineQueueCount = queueCount;
        }
        this._notify('isOnline');
        this._notify('offlineQueueCount');
    }

    setSyncing(isSyncing) {
        this._state.isSyncing = isSyncing;
        this._notify('isSyncing');
    }
}

export const store = new AppStore();
