/**
 * KARSA POS - Notification & Toast Service
 * Sistem pemberitahuan toast modern pengganti alert() browser bawaan
 */

let toastContainer = null;

function ensureToastContainer() {
    if (!toastContainer) {
        toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'fixed top-5 right-5 z-[99999] flex flex-col gap-2.5 max-w-sm pointer-events-none';
            document.body.appendChild(toastContainer);
        }
    }
    return toastContainer;
}

export function showToast(message, type = 'info', duration = 3500) {
    const container = ensureToastContainer();

    const toast = document.createElement('div');
    toast.className = `app-toast pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl text-sm font-medium shadow-2xl border transition-all duration-300 transform translate-x-12 opacity-0`;

    let icon = 'fa-circle-info';
    if (type === 'success') {
        icon = 'fa-circle-check';
    } else if (type === 'error') {
        icon = 'fa-circle-exclamation';
    } else if (type === 'warning') {
        icon = 'fa-triangle-exclamation';
    }

    toast.dataset.type = ['success', 'error', 'warning'].includes(type) ? type : 'info';

    toast.innerHTML = `
        <i class="toast-icon fa-solid ${icon} mt-0.5 text-base flex-shrink-0" aria-hidden="true"></i>
        <div class="toast-message flex-1 text-xs leading-relaxed">${message}</div>
        <button class="toast-close transition-colors ml-1 p-0.5" aria-label="Tutup pemberitahuan">
            <i class="fa-solid fa-xmark text-xs"></i>
        </button>
    `;

    const closeBtn = toast.querySelector('button');
    const dismiss = () => {
        toast.classList.add('translate-x-12', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    };

    closeBtn.addEventListener('click', dismiss);

    container.appendChild(toast);

    // Animasi masuk
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-12', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
    });

    // Otomatis hilang
    if (duration > 0) {
        setTimeout(dismiss, duration);
    }

    return dismiss;
}

// Global alert replacement jika dibutuhkan
export function notifyUser(message, type = 'info') {
    showToast(message, type);
}
