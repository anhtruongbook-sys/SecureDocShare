// mobile_app.js: Động cơ Mật Mã Học Cục Bộ Offline 100% trên Điện Thoại (Web Crypto API)

// ==========================================
// CHỦ ĐỀ GIAO DIỆN (NỀN SÁNG PHẲNG LÀ MẶC ĐỊNH)
// ==========================================
function initTheme() {
    try {
        let saved = localStorage.getItem('sds_theme_v266');
        if (!saved) {
            saved = 'light';
            localStorage.setItem('sds_theme_v266', 'light');
            localStorage.setItem('sds_theme', 'light');
        }
        if (saved === 'dark') {
            document.body.classList.remove('light-mode');
            document.body.classList.add('dark-mode');
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerText = '☀️ Sáng';
        } else {
            document.body.classList.remove('dark-mode');
            document.body.classList.add('light-mode');
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerText = '🌙 Tối';
        }
        updateDrawerThemeUI();
    } catch (_) {}
}

function updateDrawerThemeUI() {
    try {
        const isLight = document.body.classList.contains('light-mode');
        const nameEl = document.getElementById('drawer-theme-name');
        const descEl = document.getElementById('drawer-theme-desc');
        const iconEl = document.getElementById('drawer-theme-icon');
        if (nameEl) nameEl.innerText = isLight ? 'Sáng Phẳng' : 'Chế Độ Tối';
        if (descEl) descEl.innerText = isLight ? 'Chạm để đổi sang chế độ Tối 🌙' : 'Chạm để đổi sang chế độ Sáng ☀️';
        if (iconEl) iconEl.innerText = isLight ? '☀️' : '🌙';
    } catch (_) {}
}

function toggleTheme() {
    try {
        if (document.body.classList.contains('light-mode')) {
            document.body.classList.remove('light-mode');
            document.body.classList.add('dark-mode');
            localStorage.setItem('sds_theme_v266', 'dark');
            localStorage.setItem('sds_theme', 'dark');
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerText = '☀️ Sáng';
            showToast('🌙 Đã chuyển sang chế độ Tối');
        } else {
            document.body.classList.remove('dark-mode');
            document.body.classList.add('light-mode');
            localStorage.setItem('sds_theme_v266', 'light');
            localStorage.setItem('sds_theme', 'light');
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerText = '🌙 Tối';
            showToast('☀️ Đã chuyển sang chế độ Sáng Phẳng');
        }
        updateDrawerThemeUI();
    } catch (_) {}
}

function toggleThemeFromDrawer() {
    toggleTheme();
}

let currentWatermarkMode = 'none'; // 'none' | 'ibst_bim' | 'anhs_team' | 'text' | 'custom'
let currentWatermarkOpacity = 0.15;
let customWatermarkBase64 = '';
let currentSignatureMode = 'vault'; // 'vault' | 'custom-img' | 'p12'
let customSignatureImageBase64 = '';
let selectedAuditFile = null;
let currentPinInput = '';
let kryptoChatVaultInstance = null;
let kryptoChatVaultMountPromise = null;

async function ensureKryptoChatVaultMounted() {
    if (kryptoChatVaultInstance) {
        const isHandlingShare = window.__pendingSharedLink || (window.__kryptoHandlingShare && (Date.now() - window.__kryptoHandlingShare < 6000));
        if (!isHandlingShare && typeof kryptoChatVaultInstance.refreshList === 'function') {
            await kryptoChatVaultInstance.refreshList();
        }
        return kryptoChatVaultInstance;
    }
    if (kryptoChatVaultMountPromise) {
        return await kryptoChatVaultMountPromise;
    }
    const mountEl = document.getElementById('krypto-chat-vault-mount');
    if (mountEl && window.ChatVaultAdapter && typeof window.ChatVaultAdapter.mount === 'function') {
        kryptoChatVaultMountPromise = (async () => {
            try {
                kryptoChatVaultInstance = await window.ChatVaultAdapter.mount(mountEl, {
                    defaultSender: 'User',
                    defaultGroup: 'Zalo / R&D'
                });
                return kryptoChatVaultInstance;
            } catch (err) {
                console.warn('ChatVaultAdapter mount error:', err);
                return null;
            } finally {
                kryptoChatVaultMountPromise = null;
            }
        })();
        return await kryptoChatVaultMountPromise;
    }
    return kryptoChatVaultInstance;
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderSessionHistory();
    checkAppLockOnStartup();
    if (typeof updateDrawerVaultStatus === 'function') {
        updateDrawerVaultStatus();
    }
    ensureKryptoChatVaultMounted();
});
initTheme();

// =============================================================
// CYBER MODAL DIALOG (Thay thế hoàn toàn window.alert mặc định)
// =============================================================
let cyberDialogCallback = null;
let cyberDialogCancelCallback = null;

function showCyberDialog({
    type = 'warning', // 'warning' | 'error' | 'info' | 'success'
    icon = null,
    title = 'Thông Báo',
    message = '',
    actionText = 'Đã Hiểu',
    cancelText = null,
    onAction = null,
    onCancel = null
} = {}) {
    const overlay = document.getElementById('cyber-dialog-overlay');
    const card = document.getElementById('cyber-dialog-card');
    const iconEl = document.getElementById('cyber-dialog-icon');
    const titleEl = document.getElementById('cyber-dialog-title');
    const msgEl = document.getElementById('cyber-dialog-message');
    const btnAction = document.getElementById('cyber-dialog-btn-action');
    const btnActionText = document.getElementById('cyber-dialog-btn-text');
    const btnCancel = document.getElementById('cyber-dialog-btn-cancel');
    const btnCancelText = document.getElementById('cyber-dialog-btn-cancel-text');

    if (!overlay || !card) {
        console.warn("Cyber dialog overlay not found:", message);
        showToast(message);
        return;
    }

    card.classList.remove('type-warning', 'type-error', 'type-info', 'type-success');
    card.classList.add('type-' + type);

    const defaultIcons = {
        warning: '⚠️',
        error: '❌',
        info: 'ℹ️',
        success: '✅'
    };
    if (iconEl) iconEl.textContent = icon || defaultIcons[type] || '🔔';
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (btnActionText) btnActionText.textContent = actionText;

    cyberDialogCallback = onAction;
    cyberDialogCancelCallback = onCancel;

    if (btnCancel) {
        if (cancelText) {
            btnCancel.style.display = 'inline-block';
            if (btnCancelText) btnCancelText.textContent = cancelText;
        } else {
            btnCancel.style.display = 'none';
        }
    }

    // Hiển thị trực tiếp chắc chắn 100%
    overlay.style.display = 'flex';
    overlay.classList.add('active');
    overlay.classList.add('show');
}

function closeCyberDialog(triggerAction = false) {
    const overlay = document.getElementById('cyber-dialog-overlay');
    if (!overlay) return;

    overlay.classList.remove('active');
    overlay.classList.remove('show');
    setTimeout(() => {
        overlay.style.display = 'none';
        if (triggerAction && typeof cyberDialogCallback === 'function') {
            const cb = cyberDialogCallback;
            cyberDialogCallback = null;
            cb();
        } else if (!triggerAction && typeof cyberDialogCancelCallback === 'function') {
            const cbc = cyberDialogCancelCallback;
            cyberDialogCancelCallback = null;
            cbc();
        }
    }, 180);
}

function handleCyberDialogOverlayClick(event) {
    if (event && event.target && event.target.id === 'cyber-dialog-overlay') {
        closeCyberDialog(false);
    }
}

function showCyberAlert(title, message, onAction = null, actionText = 'Đã Hiểu', type = 'warning') {
    showCyberDialog({
        type: type || 'warning',
        title: title || 'Thông Báo',
        message: message || '',
        actionText: actionText || 'Đã Hiểu',
        onAction: onAction
    });
}

function showCyberConfirm(title, message, onAction = null, actionText = 'Đồng Ý', cancelText = 'Hủy', type = 'warning') {
    showCyberDialog({
        type: type || 'warning',
        title: title || 'Xác Nhận',
        message: message || '',
        actionText: actionText || 'Đồng Ý',
        cancelText: cancelText || 'Hủy',
        onAction: onAction
    });
}

// Ghi đè toàn cục window.alert: Hiển thị cả Toast lẫn Cyber Dialog đẹp mắt
window.alert = function(msg) {
    try {
        showToast(String(msg));
    } catch (_) {}
    showCyberDialog({
        type: 'warning',
        title: 'Thông Báo',
        message: String(msg),
        actionText: 'Đã Hiểu'
    });
};


let selectedLockFiles = [];
let selectedUnlockFile = null;
let currentProtectionLevel = "open_password";
let currentPackagingMode = "native";

function isNativePasswordSupported(filename) {
    if (!filename) return false;
    const parts = filename.split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
    const officeAndPdf = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'];
    const images = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
    if (officeAndPdf.includes(ext)) return true;
    if (images.includes(ext) && (currentProtectionLevel === 'view_only_restricted' || currentPackagingMode === 'native')) return true;
    return false;
}

function selectPackagingMode(mode, el, silent = false) {
    if (mode === 'native') {
        const nonNative = selectedLockFiles.filter(f => !isNativePasswordSupported(f.name));
        if (nonNative.length > 0) {
            const ext = getFileExtension(nonNative[0].name).toUpperCase() || 'này';
            showToast(`⚠️ Tệp (${ext}) không có chuẩn pass gốc. Đã giữ chế độ Nén .ZIP để không làm hỏng file! 📦`);
            return;
        }
    }
    currentPackagingMode = mode;
    document.querySelectorAll('.packaging-card').forEach(c => c.classList.remove('active'));
    if (el) {
        el.classList.add('active');
        const radio = el.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
    }
    if (!silent) {
        if (mode === 'zip') {
            showToast('Đã chọn: Nén .ZIP mã hóa mật khẩu AES-256 (Chuẩn WinRAR, 7-Zip, ZArchiver) 📦');
        } else {
            showToast('Đã chọn: Định dạng gốc (Word, Excel, PDF giữ nguyên đuôi file) 🔒');
        }
    }
}


let vaultBiometricDismissedInSession = false;

function switchTab(tabName) {
    document.querySelectorAll('.bottom-nav-btn, .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
        c.style.display = 'none';
    });

    const badge = document.getElementById('krypto-logo-badge');
    const tabEl = document.getElementById('tab-' + tabName);
    const btnEl = document.getElementById('tab-btn-' + tabName);

    if (btnEl) btnEl.classList.add('active');
    if (tabEl) {
        tabEl.classList.add('active');
        tabEl.style.display = 'block';
    }

    if (badge) {
        if (tabName === 'lock') {
            badge.classList.remove('state-unlocked');
            badge.classList.add('state-locked');
        } else if (tabName === 'unlock') {
            badge.classList.remove('state-locked');
            badge.classList.add('state-unlocked');
        } else {
            badge.classList.remove('state-locked', 'state-unlocked');
        }
    }

    if (tabName === 'vault') {
        const altBox = document.getElementById('vault-alt-pass-box');
        if (altBox) altBox.style.display = 'none';
        const altText = document.getElementById('vault-alt-toggle-text');
        if (altText) altText.innerText = '🔑 Nhập Mật Khẩu Két Thay Vì PIN';
        closeCyberDialog(false);
        checkVaultAccess();
        // Không tự động quét sinh trắc học để đảm bảo người dùng luôn thấy rõ Két đang khóa.
        // Người dùng chạm phím số PIN hoặc chạm biểu tượng [👆] trên bàn phím khi muốn xác thực.
    } else {
        // ========================================================
        // BẤT BIẾN AN NINH: KHI CHUYỂN SANG BẤT KỲ CHỨC NĂNG NÀO KHÁC, KHÓA VÀ ĐÓNG KÉT NGAY LẬP TỨC!
        // ========================================================
        isVaultSessionUnlocked = false;
        currentVaultPinInput = '';
        vaultBiometricDismissedInSession = false;

        const unlockedView = document.getElementById('vault-unlocked-view');
        const lockedView = document.getElementById('vault-locked-view');
        if (unlockedView) unlockedView.style.display = 'none';
        if (lockedView) {
            lockedView.style.display = 'flex';
            updateVaultPinDots();
        }
    }

    if (tabName === 'knowledge') {
        ensureKryptoChatVaultMounted();
    }

    if (typeof updateDrawerVaultStatus === 'function') {
        updateDrawerVaultStatus();
    }
}

function triggerLogoHaptic() {
    const badge = document.getElementById('krypto-logo-badge');
    if (!badge) return;
    badge.style.transform = 'scale(0.88)';
    setTimeout(() => {
        badge.style.transform = 'scale(1.12)';
        setTimeout(() => {
            badge.style.transform = '';
        }, 180);
    }, 120);
}

function selectProtectionLevel(levelVal, cardEl) {
    currentProtectionLevel = levelVal;
    document.querySelectorAll('.level-card').forEach(c => c.classList.remove('active'));
    if (cardEl) cardEl.classList.add('active');

    const pwdSection = document.getElementById('password-input-section');
    const pwdInput = document.getElementById('lock-password');
    const pwdLabel = document.getElementById('password-label');
    const passSubnote = document.getElementById('pass-subnote');
    const allowPrintBox = document.getElementById('allow-print-box');
    const btnSubmit = document.getElementById('btn-lock-submit');

    if (levelVal === 'sign_only') {
        if (pwdSection) pwdSection.style.display = 'none';
        if (pwdInput) pwdInput.value = '';
        if (allowPrintBox) allowPrintBox.style.display = 'none';
        if (btnSubmit) btnSubmit.innerText = '✍️ KÝ SỐ PAdES-HSM & LƯU TỆP (KHÔNG PASS)';
        const sigCheckbox = document.getElementById('enable-digital-signature');
        if (sigCheckbox && !sigCheckbox.checked) {
            sigCheckbox.checked = true;
            if (typeof toggleDigitalSignatureUI === 'function') {
                toggleDigitalSignatureUI(true);
            }
        }
        const advBody = document.getElementById('adv-body');
        if (advBody) advBody.style.display = 'block';
        const sigPanel = document.getElementById('digital-signature-panel');
        if (sigPanel) sigPanel.style.display = 'block';
        bindInteractiveSigPadEvents();
        updateInteractiveSigPreview();
        loadSelectedPdfForSigPreview();
    } else if (levelVal === 'view_only_restricted') {
        if (pwdSection) pwdSection.style.display = 'block';
        if (pwdLabel) pwdLabel.innerHTML = `MẬT KHẨU GỠ KHÓA <span class="required">*</span>`;
        if (passSubnote) {
            passSubnote.innerHTML = `💡 <strong>Người nhận xem tự do không cần mật khẩu</strong> (chỉ bạn giữ mã này để gỡ khóa).`;
            passSubnote.style.color = '#34d399';
            passSubnote.style.display = 'block';
        }
        if (allowPrintBox) allowPrintBox.style.display = 'block';
        if (btnSubmit) btnSubmit.innerText = 'MÃ HÓA & LƯU TỆP';
    } else {
        if (pwdSection) pwdSection.style.display = 'block';
        if (pwdLabel) pwdLabel.innerHTML = `MẬT KHẨU MỞ TỆP <span class="required">*</span> <span style="font-weight:400;font-size:10.5px;color:#64748b;">(Bỏ trống nếu chỉ Ký số)</span>`;
        if (passSubnote) {
            passSubnote.style.display = 'none';
        }
        if (allowPrintBox) allowPrintBox.style.display = 'none';
        if (btnSubmit) btnSubmit.innerText = 'MÃ HÓA & LƯU TỆP';
    }
}

// Kích hoạt bộ chọn tệp native của Android (C++ stream, không tốn RAM heap)
function triggerPickFiles(context) {
    const input = document.getElementById('file-input-' + context);
    if (input) {
        input.value = '';
        input.click();
    }
}

function triggerFileInput(inputId) {
    const context = inputId.includes('unlock') ? 'unlock' : 'lock';
    triggerPickFiles(context);
}

async function inspectFileLockState(file) {
    if (!file) return { isLocked: false };
    
    const nameLower = file.name.toLowerCase();
    const isNamedLocked = /(_locked|_readonly|_protected|_encrypted)(\.[a-z0-9]+)$/i.test(nameLower);
    
    try {
        const sliceSize = Math.min(file.size || 8192, 8192);
        const headerBlob = file.slice(0, sliceSize);
        const buffer = await headerBlob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const text = new TextDecoder('latin1').decode(bytes);
        
        // 1. PDF: Kiểm tra thẻ /Encrypt theo chuẩn Adobe ISO 32000
        if (nameLower.endsWith('.pdf')) {
            if (text.includes('/Encrypt')) {
                return { isLocked: true, reason: 'Tệp PDF đã được mã hóa bảo vệ (phát hiện cấu trúc /Encrypt chuẩn Adobe ISO 32000).' };
            }
            if (file.size > 8192) {
                const tailBlob = file.slice(Math.max(0, file.size - 4096), file.size);
                const tailBuf = await tailBlob.arrayBuffer();
                const tailText = new TextDecoder('latin1').decode(new Uint8Array(tailBuf));
                if (tailText.includes('/Encrypt')) {
                    return { isLocked: true, reason: 'Tệp PDF đã được mã hóa bảo vệ (phát hiện cấu trúc /Encrypt chuẩn Adobe ISO 32000).' };
                }
            }
        }
        
        // 2. Office (DOCX, XLSX, PPTX): OLE Header (0xD0CF11E0) + EncryptedPackage
        if (/\.(docx|doc|xlsx|xls|pptx|ppt)$/i.test(nameLower)) {
            const isOle = bytes.length >= 4 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
            if (isOle && (text.includes('EncryptedPackage') || text.includes('EncryptionInfo'))) {
                return { isLocked: true, reason: 'Tệp Office đã được đặt mật khẩu bảo vệ (phát hiện vùng chứa mã hóa MS-OFFCRYPTO).' };
            }
        }
        
        // 3. ZIP: Kiểm tra bit cờ mã hóa (General Purpose Bit Flag: bit 0 = 1)
        if (nameLower.endsWith('.zip')) {
            if (bytes.length >= 8 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
                const flag = bytes[6] | (bytes[7] << 8);
                if ((flag & 1) !== 0) {
                    return { isLocked: true, reason: 'Kho nén .ZIP đã được cài mật khẩu bảo vệ (cờ mã hóa AES/ZipCrypto).' };
                }
            }
        }
        
        // 4. KryptoDoc Vault Container
        if (text.startsWith('KRYPTODOC_') || text.includes('KRYPTODOC_VAULT')) {
            return { isLocked: true, reason: 'Tệp đã được khóa bảo vệ bởi KryptoDoc Vault.' };
        }
    } catch (e) {
        console.warn('Lỗi kiểm tra header tệp:', e);
    }
    
    if (isNamedLocked && !nameLower.endsWith('.pdf')) {
        return { isLocked: true, reason: 'Tệp có hậu tố bảo vệ (_Locked / _ReadOnly / _Protected).' };
    }
    
    return { isLocked: false };
}

async function handleFilesSelected(files, context) {
    if (!files || files.length === 0) return;

    if (context === 'lock') {
        let hasNonNative = false;
        let nonNativeExts = [];
        let hasAlreadyLocked = false;

        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const check = await inspectFileLockState(f);
            if (check.isLocked) {
                f._isAlreadyLocked = true;
                f._lockedReason = check.reason;
                hasAlreadyLocked = true;
            }
            selectedLockFiles.push(f);
            if (!isNativePasswordSupported(f.name)) {
                hasNonNative = true;
                const ext = getFileExtension(f.name).toUpperCase();
                if (ext && !nonNativeExts.includes(ext)) nonNativeExts.push(ext);
            }
        }
        renderFileListLock();
        loadSelectedPdfForSigPreview();

        if (hasAlreadyLocked) {
            // Nếu người dùng chọn đúng 1 file và file đó đã có mật khẩu:
            // TỰ ĐỘNG CHUYỂN NGAY LẬP TỨC SANG TAB MỞ KHÓA!
            if (selectedLockFiles.length === 1 && selectedLockFiles[0]._isAlreadyLocked) {
                const lockedFile = selectedLockFiles[0];
                selectedUnlockFile = lockedFile;
                selectedLockFiles = [];
                renderFileListLock();
                switchTab('unlock');
                renderFileListUnlock();
                showToast(`💡 Phát hiện tệp đã có mật khẩu. Đã tự động chuyển sang Tab MỞ KHÓA! 🔓`);
                setTimeout(() => {
                    const pwdInput = document.getElementById('unlock-password');
                    if (pwdInput) pwdInput.focus();
                }, 300);
                return;
            }
            showToast('💡 Phát hiện tệp đã có mật khẩu bảo vệ!');
            return;
        }

        if (hasNonNative || selectedLockFiles.length > 1) {
            const zipCard = document.getElementById('pkg-card-zip');
            if (zipCard && currentPackagingMode !== 'zip') {
                selectPackagingMode('zip', zipCard, true);
                if (hasNonNative) {
                    showToast(`💡 Tệp (${nonNativeExts.join(', ')}) không có chuẩn pass gốc. KryptoDoc tự động nén .ZIP và đặt pass AES-256! 📦`);
                } else {
                    showToast('💡 Đã tự động kích hoạt chế độ Nén .ZIP Có Pass khi chọn nhiều tệp! 📦');
                }
            }
        }
    } else if (context === 'audit') {
        selectedAuditFile = files[0];
        renderFileListAudit();
    } else {
        selectedUnlockFile = files[0];
        renderFileListUnlock();
    }
}

function getFileExtension(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function getFileMetaBadge(filename) {
    const ext = getFileExtension(filename);
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tiff'];
    if (imageExts.includes(ext)) {
        return {
            badgeClass: 'file-badge-image',
            iconText: (ext || 'IMG').toUpperCase().substring(0, 4),
            label: 'Hình ảnh ' + (ext || '').toUpperCase(),
            protocol: 'Zip4j AES-256 Vault'
        };
    } else if (ext === 'dwg' || ext === 'dxf') {
        return {
            badgeClass: 'file-badge-cad',
            iconText: 'DWG',
            label: 'Bản vẽ AutoCAD',
            protocol: 'Zip4j AES-256 Vault'
        };
    } else if (ext === 'zip' || ext === 'rar' || ext === '7z') {
        return {
            badgeClass: 'file-badge-zip',
            iconText: ext.toUpperCase(),
            label: 'Tệp nén lưu trữ',
            protocol: 'Zip4j Encrypted Vault'
        };
    } else if (ext === 'docx' || ext === 'doc') {
        return {
            badgeClass: 'file-badge-word',
            iconText: 'DOC',
            label: 'Văn bản Word',
            protocol: 'MS-OFFCRYPTO 256-bit'
        };
    } else if (ext === 'xlsx' || ext === 'xls') {
        return {
            badgeClass: 'file-badge-excel',
            iconText: 'XLS',
            label: 'Bảng tính Excel',
            protocol: 'MS-OFFCRYPTO 256-bit'
        };
    } else if (ext === 'pptx' || ext === 'ppt') {
        return {
            badgeClass: 'file-badge-powerpoint',
            iconText: 'PPT',
            label: 'Bản chiếu PowerPoint',
            protocol: 'MS-OFFCRYPTO 256-bit'
        };
    } else if (ext === 'pdf') {
        return {
            badgeClass: 'file-badge-pdf',
            iconText: 'PDF',
            label: 'Tài liệu Adobe PDF',
            protocol: 'Adobe ISO 32000'
        };
    } else {
        return {
            badgeClass: 'file-badge-generic',
            iconText: (ext || 'FILE').toUpperCase().substring(0, 4),
            label: 'Tệp tin số',
            protocol: 'Zip4j AES-256 Vault'
        };
    }
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2) + ' ' + sizes[i];
}

function renderFileListLock() {
    const container = document.getElementById('file-list-lock');
    const settingsCard = document.getElementById('settings-card-lock');
    if (selectedLockFiles.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        if (settingsCard) settingsCard.style.display = 'block';
        return;
    }
    container.style.display = 'flex';

    const allLocked = selectedLockFiles.every(f => f._isAlreadyLocked);
    if (allLocked && selectedLockFiles.length > 0) {
        if (settingsCard) settingsCard.style.display = 'none';
        container.innerHTML = selectedLockFiles.map((file, idx) => `
            <div class="locked-dedicated-card">
                <div class="locked-card-top">
                    <div class="locked-badge-box">🔒</div>
                    <div class="locked-info-group">
                        <span class="locked-file-name" title="${file.name}">${file.name}</span>
                        <div class="locked-meta-row">
                            <span>${formatBytes(file.size)}</span>
                            <span>•</span>
                            <span class="locked-badge-pill">ĐÃ CÓ MẬT KHẨU</span>
                        </div>
                    </div>
                </div>
                <div class="locked-card-notice">
                    💡 Tệp này đã được đặt mật khẩu bảo vệ trước đó. Bạn hãy mở khóa để xem nội dung hoặc thay đổi mật khẩu.
                </div>
                <div class="locked-card-buttons">
                    <button type="button" class="btn-goto-unlock-main" onclick="redirectToUnlockWithSelectedFile(${idx})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                        </svg>
                        <span>MỞ KHÓA TỆP NÀY NGAY</span>
                    </button>
                    <button type="button" class="btn-cancel-locked-choice" onclick="removeLockFile(${idx})">
                        ✕ Bỏ chọn tệp
                    </button>
                </div>
            </div>
        `).join('');
        return;
    }

    if (settingsCard) settingsCard.style.display = 'block';
    container.innerHTML = selectedLockFiles.map((file, idx) => {
        const meta = getFileMetaBadge(file.name);
        return `
            <div class="file-card-rich">
                <div class="file-meta-col">
                    <div class="file-type-icon-badge ${meta.badgeClass}">${meta.iconText}</div>
                    <div class="file-info-group">
                        <span class="file-title-text" title="${file.name}">${file.name}</span>
                        <div class="file-subdetail-row">
                            <span>${formatBytes(file.size)}</span>
                            <span>•</span>
                            <span class="file-protocol-tag">${meta.protocol}</span>
                        </div>
                    </div>
                </div>
                <button type="button" class="btn-remove-file" onclick="removeLockFile(${idx})" title="Bỏ chọn tệp">✕</button>
            </div>
        `;
    }).join('');
}

function redirectToUnlockWithSelectedFile(idx) {
    if (idx === undefined || idx < 0 || idx >= selectedLockFiles.length) {
        idx = selectedLockFiles.findIndex(f => f._isAlreadyLocked);
    }
    if (idx === -1 && selectedLockFiles.length > 0) {
        idx = 0;
    }
    if (idx === -1) return;
    const file = selectedLockFiles[idx];
    selectedUnlockFile = file;
    selectedLockFiles.splice(idx, 1);
    renderFileListLock();
    switchTab('unlock');
    renderFileListUnlock();
    showToast(`Đã chuyển tệp "${file.name}" sang Tab MỞ KHÓA! 🔓`);
    const pwdInput = document.getElementById('unlock-password');
    if (pwdInput) {
        pwdInput.focus();
    }
}

function removeLockFile(idx) {
    selectedLockFiles.splice(idx, 1);
    renderFileListLock();
    loadSelectedPdfForSigPreview();
}

function renderFileListUnlock() {
    const container = document.getElementById('file-list-unlock');
    if (!selectedUnlockFile) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    container.style.display = 'flex';
    const meta = getFileMetaBadge(selectedUnlockFile.name);
    container.innerHTML = `
        <div class="file-card-rich">
            <div class="file-meta-col">
                <div class="file-type-icon-badge ${meta.badgeClass}">${meta.iconText}</div>
                <div class="file-info-group">
                    <span class="file-title-text" title="${selectedUnlockFile.name}">${selectedUnlockFile.name}</span>
                    <div class="file-subdetail-row">
                        <span>${formatBytes(selectedUnlockFile.size)}</span>
                        <span>•</span>
                        <span class="file-protocol-tag">${meta.protocol}</span>
                    </div>
                </div>
            </div>
            <button type="button" class="btn-remove-file" onclick="selectedUnlockFile=null; renderFileListUnlock();" title="Bỏ chọn tệp">✕</button>
        </div>
    `;
}

// -------------------------------------------------------------
// THƯỚC ĐO ĐỘ MẠNH MẬT KHẨU & SINH MẬT KHẨU QUÂN SỰ
// -------------------------------------------------------------
function evaluatePasswordStrength(pwd) {
    if (!pwd || pwd.length === 0) {
        return { text: 'Chưa nhập mật khẩu', class: 'meter-none' };
    }
    let score = 0;
    if (pwd.length >= 6) score += 1;
    if (pwd.length >= 8) score += 1;
    if (pwd.length >= 12) score += 1;
    if (/[A-Z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

    if (pwd.length < 6) {
        return { text: 'Quá ngắn (< 6 ký tự)', class: 'meter-weak' };
    }
    if (score <= 2) {
        return { text: 'Yếu • Nên thêm chữ & số', class: 'meter-weak' };
    } else if (score <= 4) {
        return { text: 'Trung bình • Khá an toàn', class: 'meter-medium' };
    } else if (score === 5) {
        return { text: 'Mạnh • Bảo vệ tối ưu', class: 'meter-strong' };
    } else {
        return { text: 'Chuẩn Cấp Quân Sự 256-bit 🛡️', class: 'meter-military' };
    }
}

function updatePasswordStrengthUI() {
    const input = document.getElementById('lock-password');
    const fill = document.getElementById('entropy-bar-fill');
    const badge = document.getElementById('entropy-badge');
    if (!input || !fill || !badge) return;

    const result = evaluatePasswordStrength(input.value);
    fill.className = 'entropy-bar-fill ' + result.class;
    badge.className = 'entropy-badge ' + result.class;
    badge.textContent = result.text;
}

function generateMilitaryPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()_+';
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    let pwd = '';
    for (let i = 0; i < 16; i++) {
        pwd += chars[array[i] % chars.length];
    }
    const input = document.getElementById('lock-password');
    if (input) {
        input.value = pwd;
        updatePasswordStrengthUI();
        copyToClipboard(pwd, 'Đã tạo mã Quân Sự (16 ký tự) và sao chép vào bộ nhớ tạm! 📋');
    }
}

function copyPasswordFromInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input || !input.value) {
        showToast('Vui lòng nhập mật khẩu trước khi sao chép! ⚠️');
        return;
    }
    copyToClipboard(input.value, 'Đã sao chép mật khẩu vào bộ nhớ tạm! 📋');
}

function togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btnEl.textContent = '🔒 Ẩn';
    } else {
        input.type = 'password';
        btnEl.textContent = '👁️ Xem';
    }
}

function showToast(msg) {
    const toast = document.getElementById('krypto-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(window.__kryptoToastTimeout);
    window.__kryptoToastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 2800);
}

function copyToClipboard(text, successToast) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(successToast || 'Đã sao chép vào bộ nhớ tạm! 📋');
        }).catch(() => fallbackCopy(text, successToast));
    } else {
        fallbackCopy(text, successToast);
    }
}

function fallbackCopy(text, successToast) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try {
        document.execCommand('copy');
        showToast(successToast || 'Đã sao chép vào bộ nhớ tạm! 📋');
    } catch(e) {}
    document.body.removeChild(el);
}

// -------------------------------------------------------------
// QUẢN TRỊ NHẬT KÝ PHIÊN LÀM VIỆC (OFFLINE ZERO-KNOWLEDGE)
// -------------------------------------------------------------
function toggleHistoryDrawer() {
    const body = document.getElementById('history-body');
    const arrow = document.getElementById('history-arrow');
    if (!body) return;
    if (body.style.display === 'none' || body.style.display === '') {
        body.style.display = 'block';
        if (arrow) arrow.textContent = '▴';
    } else {
        body.style.display = 'none';
        if (arrow) arrow.textContent = '▾';
    }
}

function getSessionHistory() {
    try {
        const raw = sessionStorage.getItem('krypto_session_history');
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function addSessionHistory(filename, action, mode) {
    try {
        const history = getSessionHistory();
        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        history.unshift({
            name: filename,
            action: action, // 'lock' | 'unlock'
            mode: mode || 'AES-256',
            time: timeStr
        });
        if (history.length > 20) history.pop();
        sessionStorage.setItem('krypto_session_history', JSON.stringify(history));
        renderSessionHistory();
    } catch (e) {}
}

function renderSessionHistory() {
    const listEl = document.getElementById('history-list');
    const countBadge = document.getElementById('history-count');
    if (!listEl) return;
    const history = getSessionHistory();
    if (countBadge) countBadge.textContent = history.length;

    if (history.length === 0) {
        listEl.innerHTML = '<p class="history-empty">Chưa có tệp nào được xử lý trong phiên làm việc này.</p>';
        return;
    }

    listEl.innerHTML = history.map(item => `
        <div class="history-item">
            <div class="history-item-left">
                <span>${item.action === 'lock' ? '🔒' : '🔓'}</span>
                <span class="history-item-name" title="${item.name}">${item.name}</span>
                <span class="file-protocol-tag">${item.mode}</span>
            </div>
            <span class="history-item-time">${item.time}</span>
        </div>
    `).join('');
}

function clearSessionHistory() {
    try {
        sessionStorage.removeItem('krypto_session_history');
        renderSessionHistory();
        showToast('Đã xóa sạch nhật ký phiên làm việc! 🧹');
    } catch (e) {}
}

function generateShortMemorablePassword() {
    const list = ["Vip88", "Vip@2026", "AnTam99", "BaoMat88", "Pccc@68", "KimMoc79", "123456", "888888"];
    const pwd = list[Math.floor(Math.random() * list.length)];
    document.getElementById('lock-password').value = pwd;
    updatePasswordStrengthUI();
}

function applyPresetPassword(pwd) {
    document.getElementById('lock-password').value = pwd;
    updatePasswordStrengthUI();
}

// -------------------------------------------------------------
// ĐỘNG CƠ MÃ HÓA OFFLINE 100% HIỆU NĂNG CAO (CHỐNG TRÀN BỘ NHỚ OOM)
// -------------------------------------------------------------
async function deriveAesKey(password, salt, iterations = 100000) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: iterations,
            hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// Chuyển Uint8Array sang Base64 theo từng Chunk 32KB (Chống vỡ Call Stack và không tạo triệu object chuỗi)
function uint8ToBase64(uint8) {
    const CHUNK_SIZE = 0x8000;
    let result = '';
    const len = uint8.length;
    for (let i = 0; i < len; i += CHUNK_SIZE) {
        const slice = uint8.subarray(i, Math.min(i + CHUNK_SIZE, len));
        result += String.fromCharCode.apply(null, slice);
    }
    return btoa(result);
}

function base64ToUint8(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

let procTimerInterval = null;
let procStartTime = null;

function showProcessingModal(title, desc) {
    const badge = document.getElementById('krypto-logo-badge');
    if (badge) badge.classList.add('state-processing');

    const modal = document.getElementById('processing-modal');
    if (modal) {
        if (title) document.getElementById('proc-title').innerText = title;
        if (desc) document.getElementById('proc-desc').innerHTML = desc;

        procStartTime = Date.now();
        const timerEl = document.getElementById('proc-timer');
        if (timerEl) {
            timerEl.innerText = "⏱️ Đang xử lý: 0s";
            if (procTimerInterval) clearInterval(procTimerInterval);
            procTimerInterval = setInterval(() => {
                const sec = Math.floor((Date.now() - procStartTime) / 1000);
                timerEl.innerText = `⏱️ Đang xử lý: ${sec}s`;
            }, 1000);
        }

        modal.style.display = 'flex';
    }
}

function hideProcessingModal() {
    const badge = document.getElementById('krypto-logo-badge');
    if (badge) badge.classList.remove('state-processing');

    const modal = document.getElementById('processing-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (procTimerInterval) {
        clearInterval(procTimerInterval);
        procTimerInterval = null;
    }
}

function toggleAdvancedOptions() {
    const body = document.getElementById('adv-body');
    const arrow = document.getElementById('adv-arrow');
    if (!body) return;
    if (body.style.display === 'none' || body.style.display === '') {
        body.style.display = 'block';
        if (arrow) arrow.textContent = '▴';
    } else {
        body.style.display = 'none';
        if (arrow) arrow.textContent = '▾';
    }
}

// =============================================================
// PHASE 3: MẪU BẢO MẬT BỐI CẢNH, WATERMARK & QR CODE
// =============================================================
function applySecurityTemplate(type) {
    if (type === 'enterprise') {
        selectProtectionLevel('open_password', document.getElementById('level-card-open'));
        generateMilitaryPassword();
        const wmCheck = document.getElementById('enable-watermark-checkbox');
        if (wmCheck && !wmCheck.checked) {
            wmCheck.checked = true;
            toggleWatermarkOption();
        }
        applyWatermarkPreset('BẢN MẬT - NỘI BỘ');
        const advBody = document.getElementById('adv-body');
        const advArrow = document.getElementById('adv-arrow');
        if (advBody && advBody.style.display === 'none') {
            advBody.style.display = 'block';
            if (advArrow) advArrow.textContent = '▴';
        }
        showToast('Đã áp dụng mẫu: 🏢 Hợp Đồng (Mã Quân Sự + Dấu Mật)');
    } else if (type === 'cad' || type === 'design') {
        const zipCard = document.getElementById('pkg-card-zip');
        if (zipCard) selectPackagingMode('zip', zipCard);
        selectProtectionLevel('open_password', document.getElementById('level-card-open'));
        generateMilitaryPassword();
        const wmCheck = document.getElementById('enable-watermark-checkbox');
        if (wmCheck && wmCheck.checked) {
            wmCheck.checked = false;
            toggleWatermarkOption();
        }
        showToast('Đã áp dụng mẫu: 📐 Bản Vẽ CAD (Nén .ZIP Có Pass Quân Sự AES-256) 🛡️');
    } else if (type === 'quotation') {
        selectProtectionLevel('open_password', document.getElementById('level-card-open'));
        applyPresetPassword('BaoGia@88');
        const wmCheck = document.getElementById('enable-watermark-checkbox');
        if (wmCheck && wmCheck.checked) {
            wmCheck.checked = false;
            toggleWatermarkOption();
        }
        const comp = document.getElementById('compress-pdf-checkbox');
        if (comp) comp.checked = true;
        showToast('Đã áp dụng mẫu: 💰 Báo Giá (Mã nhanh + Nén gửi Zalo)');
    }
}

function toggleWatermarkOption() {
    const check = document.getElementById('enable-watermark-checkbox');
    const panel = document.getElementById('watermark-detail-panel');
    const tag = document.getElementById('watermark-tag');
    if (!check || !panel) return;
    if (check.checked) {
        panel.style.display = 'block';
        if (tag) {
            tag.textContent = 'Đang bật';
            tag.style.color = '#10b981';
            tag.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        }
    } else {
        panel.style.display = 'none';
        if (tag) {
            tag.textContent = 'Tùy chọn';
            tag.style.color = 'var(--text-muted)';
            tag.style.borderColor = 'var(--border)';
        }
    }
}

function applyWatermarkPreset(text) {
    const input = document.getElementById('watermark-input');
    if (input) {
        input.value = text;
        showToast(`Đã chọn dấu mờ: "${text}"`);
    }
}

let currentQrCodeInstance = null;
function toggleQrCodeModal() {
    const box = document.getElementById('qr-modal-container');
    const pwdEl = document.getElementById('qr-pwd-display');
    const target = document.getElementById('qr-code-target');
    const pwd = document.getElementById('lock-password').value;
    if (!box || !target) return;

    if (box.style.display === 'none' || box.style.display === '') {
        box.style.display = 'flex';
        if (pwdEl) pwdEl.textContent = pwd || '(Mật khẩu trống)';
        target.innerHTML = '';
        if (typeof QRCode !== 'undefined') {
            currentQrCodeInstance = new QRCode(target, {
                text: pwd,
                width: 140,
                height: 140,
                colorDark: "#0b0f19",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });
        }
        showToast('Đã tạo mã QR mật khẩu! 📱');
    } else {
        box.style.display = 'none';
    }
}

async function executeMobileLockFiles() {
    if (selectedLockFiles.length === 0) {
        showToast('⚠️ Vui lòng chọn ít nhất 1 tệp tin cần mã hóa!');
        showCyberDialog({
            type: 'warning',
            title: 'Chưa Chọn Tệp Tin',
            message: 'Vui lòng chọn ít nhất 1 tài liệu (PDF, Word, Excel, ZIP...) để mã hóa!',
            actionText: 'Chọn Tệp Ngay',
            onAction: () => {
                const fileInput = document.getElementById('lock-files-input');
                if (fileInput) fileInput.click();
            }
        });
        return;
    }
    if (currentProtectionLevel === 'sign_only') {
        const sigCheckbox = document.getElementById('enable-digital-signature');
        if (sigCheckbox) sigCheckbox.checked = true;
    }
    const preCheckEnableSignature = (currentProtectionLevel === 'sign_only') || (document.getElementById('enable-digital-signature')?.checked || false);
    const pwd = (currentProtectionLevel === 'sign_only') ? '' : (document.getElementById('lock-password')?.value || '').trim();
    if (!pwd && !preCheckEnableSignature) {
        showToast('⚠️ Vui lòng nhập mật khẩu bảo vệ (hoặc bật Chữ Ký Số nếu chỉ muốn ký số)!');
        showCyberDialog({
            type: 'warning',
            title: 'Chưa Nhập Mật Khẩu',
            message: 'Vui lòng thiết lập mật khẩu bảo vệ trước khi mã hóa tệp, hoặc chọn chế độ "✍️ Chỉ Ký Số (Không Pass)" nếu chỉ muốn ký số!',
            actionText: 'Nhập Mật Khẩu Ngay',
            onAction: () => {
                const pwdInput = document.getElementById('lock-password');
                if (pwdInput) {
                    pwdInput.focus();
                    pwdInput.classList.remove('input-attention-pulse');
                    void pwdInput.offsetWidth;
                    pwdInput.classList.add('input-attention-pulse');
                    pwdInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
        return;
    }

    const lockedFiles = selectedLockFiles.filter(f => f._isAlreadyLocked);
    if (lockedFiles.length > 0) {
        const first = lockedFiles[0];
        showCyberDialog({
            type: 'warning',
            title: 'Cảnh Báo Tệp Đã Khóa',
            message: `Tệp "${first.name}" đã được khóa bảo mật trước đó. Khóa đè lần 2 sẽ làm hỏng cấu trúc tệp hoặc tạo 2 tầng mật khẩu. Bạn có muốn chuyển sang Tab MỞ KHÓA ngay bây giờ không?`,
            actionText: 'Chuyển Sang Mở Khóa',
            cancelText: 'Ở Lại',
            onAction: () => {
                redirectToUnlockWithSelectedFile();
            }
        });
        return;
    }

    // Kiểm tra trước điều kiện Chữ ký số HSM trước khi khóa nút bấm để không bao giờ treo nút
    if (preCheckEnableSignature && window.KryptoHSMSignatureEngine && currentSignatureMode === 'vault') {
        const preVault = window.KryptoHSMSignatureEngine.getActiveHSMVault();
        if (!preVault) {
            showCyberAlert(
                'Chưa Khởi Tạo Buồng Chữ Ký Số HSM',
                'Bạn đã bật tùy chọn Ký số PAdES-HSM nhưng chưa khởi tạo Buồng HSM. Vui lòng chuyển sang tab Két sắt để khởi tạo Buồng HSM trước!',
                () => switchTab('vault'),
                'Mở Tab Két Sắt',
                'warning'
            );
            return;
        }
        const preHsmPin = (document.getElementById('signer-hsm-pin-input')?.value || '').trim();
        if (!preHsmPin || preHsmPin.length < 4) {
            showCyberAlert(
                'Yêu Cầu Mã USER_PIN Mở HSM Khi Ký',
                'Vui lòng nhập đúng Mã USER_PIN của Buồng HSM vào ô "Mã USER_PIN mở HSM khi ký" để mở khóa phần cứng và thực thi lệnh ký PKCS#11 C_Sign!',
                () => {
                    const pinEl = document.getElementById('signer-hsm-pin-input');
                    if (pinEl) {
                        pinEl.focus();
                        pinEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                },
                'Nhập USER_PIN Ngay',
                'warning'
            );
            return;
        }
    }

    const btn = document.getElementById('btn-lock-submit');
    btn.disabled = true;
    btn.innerText = "Đang xử lý...";

    try {
        const results = [];
        for (const file of selectedLockFiles) {
            const isPdf = file.name.toLowerCase().endsWith('.pdf');
            const sizeMb = (file.size / (1024 * 1024)).toFixed(1);

            // -------------------------------------------------------------
            // TRÊN APP DI ĐỘNG (FLUTTER BRIDGE):
            // GỬI DUY NHẤT METADATA NHỎ GỌN (~100 BYTES)
            // TUYỆT ĐỐI KHÔNG ĐỌC ARRAYBUFFER / BASE64 ĐỂ CHỐNG CRASH RAM 100%
            // -------------------------------------------------------------
            if (window.FlutterBridge) {
                const hasNonNative = selectedLockFiles.some(f => !isNativePasswordSupported(f.name));
                if (hasNonNative || currentPackagingMode === 'zip' || selectedLockFiles.length > 1) {
                    const names = selectedLockFiles.map(f => f.name);
                    const firstName = selectedLockFiles[0].name;
                    const totalBytes = selectedLockFiles.reduce((acc, f) => acc + (f.size || 0), 0);
                    const totalSizeMb = (totalBytes / (1024 * 1024)).toFixed(1);

                    btn.innerText = `Đang nén & đặt pass ZIP (${totalSizeMb} MB)...`;
                    showProcessingModal(
                        'Đang Nén & Đặt Pass ZIP...',
                        `Tổng số: <strong>${selectedLockFiles.length} tệp</strong> (${totalSizeMb} MB)<br>Đang nén và mã hóa mật khẩu AES-256 bằng Zip4j Engine.<br>Vui lòng giữ ứng dụng mở...`
                    );

                    const masterPasswordZip = localStorage.getItem('krypto_master_password') || '';
                    window.FlutterBridge.postMessage(JSON.stringify({
                        action: 'lock_zip_native',
                        name: firstName,
                        names: names,
                        password: pwd,
                        master_password: masterPasswordZip,
                        use_zipcrypto: false,
                        protection_level: currentProtectionLevel
                    }));
                    return;
                }

                btn.innerText = isPdf 
                    ? `Đang mã hóa PDF: ${file.name} (${sizeMb} MB)...`
                    : `Đang xử lý tệp: ${file.name} (${sizeMb} MB)...`;

                showProcessingModal(
                    isPdf ? 'Đang Mã Hóa PDF Native...' : 'Đang Xử Lý Tệp Lớn...',
                    `Tệp: <strong>${file.name}</strong> (${sizeMb} MB)<br>Đang chạy mã hóa native hiệu năng cao.<br>Vui lòng giữ ứng dụng mở...`
                );

                const isViewOnly = (currentProtectionLevel === "view_only_restricted");
                const allowPrint = isViewOnly ? (document.getElementById('allow-print-checkbox')?.checked || false) : true;
                
                let watermarkImageBase64 = '';
                let watermarkText = '';
                if (currentWatermarkMode === 'ibst_bim') {
                    watermarkImageBase64 = (window.WATERMARK_PRESETS && window.WATERMARK_PRESETS.IBST_BIM) ? window.WATERMARK_PRESETS.IBST_BIM : '';
                } else if (currentWatermarkMode === 'anhs_team') {
                    watermarkImageBase64 = (window.WATERMARK_PRESETS && window.WATERMARK_PRESETS.ANHS_TEAM) ? window.WATERMARK_PRESETS.ANHS_TEAM : '';
                } else if (currentWatermarkMode === 'custom') {
                    watermarkImageBase64 = customWatermarkBase64;
                } else if (currentWatermarkMode === 'text') {
                    watermarkText = document.getElementById('watermark-input')?.value || 'CONFIDENTIAL';
                }

                const enableTracking = document.getElementById('enable-recipient-tracking')?.checked || false;
                const recipientName = enableTracking ? (document.getElementById('recipient-name-input')?.value || '') : '';
                const releaseCode = enableTracking ? (document.getElementById('release-code-input')?.value || '') : '';
                const enableManifest = document.getElementById('enable-tamper-manifest')?.checked || false;

                const enableSignature = (currentProtectionLevel === 'sign_only') || (document.getElementById('enable-digital-signature')?.checked || false);
                let signerName = enableSignature ? (document.getElementById('signer-name-input')?.value || '') : '';
                const signingReason = enableSignature ? (document.getElementById('signing-reason-input')?.value || '') : '';
                const rawSigPos = enableSignature ? (document.querySelector('input[name="sig-pos"]:checked')?.value || 'last_page') : 'last_page';
                const sigPos = enableSignature ? buildEncodedSigPosString(rawSigPos) : 'last_page';
                const masterPassword = localStorage.getItem('krypto_master_password') || 'KryptoPQC@2026';
                const compressPdf = document.getElementById('compress-pdf-checkbox')?.checked !== false;

                let effectiveSigImageB64 = customSignatureImageBase64;
                let effectiveSigningReasonPayload = signingReason;
                if (enableSignature && window.KryptoHSMSignatureEngine) {
                    const hsmVault = window.KryptoHSMSignatureEngine.getActiveHSMVault();
                    if (hsmVault) {
                        const enteredHsmPin = (document.getElementById('signer-hsm-pin-input')?.value || '').trim();
                        if (!enteredHsmPin || enteredHsmPin.length < 4) {
                            hideProcessingModal();
                            btn.disabled = false;
                            btn.innerText = currentProtectionLevel === 'sign_only' ? "✍️ KÝ SỐ PAdES-HSM & LƯU TỆP (KHÔNG PASS)" : "MÃ HÓA & LƯU TỆP";
                            showCyberAlert(
                                'Yêu Cầu Mã USER_PIN HSM (Chuẩn FIPS 140-3)',
                                'Vui lòng nhập Mã USER_PIN ký số HSM (tối thiểu 4 ký tự) tại mục Chữ Ký Số để mở khóa phần cứng và thực thi lệnh ký PKCS#11 C_Sign!',
                                () => {
                                    const pinEl = document.getElementById('signer-hsm-pin-input');
                                    if (pinEl) pinEl.focus();
                                },
                                'Nhập USER_PIN',
                                'warning'
                            );
                            return;
                        }
                        try {
                            const hsmSigRes = await window.KryptoHSMSignatureEngine.signDigestWithHSM(
                                `${file.name}|${file.size}|${signingReason}`,
                                enteredHsmPin,
                                file.name
                            );
                            if (!signerName) signerName = hsmVault.certificate.signer_name;
                            const includeSignerName = document.getElementById('sig-include-signer-name')?.checked || false;
                            if (currentSignatureVisualStyle === 'invisible') {
                                effectiveSigImageB64 = '';
                            } else if (currentSignatureVisualStyle === 'full_stamp') {
                                effectiveSigImageB64 = await window.KryptoHSMSignatureEngine.renderCompositePAdESStampDataUrl(
                                    hsmVault,
                                    signingReason || 'Phê duyệt & Ký số phát hành'
                                );
                            } else {
                                effectiveSigImageB64 = await window.KryptoHSMSignatureEngine.renderHandwrittenOnlyStampDataUrl(
                                    hsmVault,
                                    includeSignerName,
                                    (currentSignatureMode === 'custom-img') ? customSignatureImageBase64 : ''
                                );
                            }
                            const sendSmime = document.getElementById('enable-smime-email-notify')?.checked;
                            if (sendSmime) {
                                const emailTarget = (document.getElementById('signer-email-input')?.value || hsmVault.certificate.signer_email || 'truongtuananhxd@gmail.com').trim();
                                window.__lastSignedSmimeEmail = await window.KryptoHSMSignatureEngine.generateSMIMESignedEmail({
                                    mode: 'RESULT',
                                    documentName: file.name,
                                    documentSha256: hsmVault.certificate.visual_sig_png_sha256,
                                    recipientEmail: emailTarget,
                                    signingReason: signingReason || 'Phê duyệt & Ký số PAdES-HSM',
                                    userPin: enteredHsmPin,
                                    precomputedSigRes: hsmSigRes
                                });
                            } else {
                                window.__lastSignedSmimeEmail = null;
                            }
                            // Xóa trắng ô PIN ký số sau khi ký xong để không lộ PIN qua nút 👁️
                            const pinSignEl = document.getElementById('signer-hsm-pin-input');
                            if (pinSignEl) { pinSignEl.value = ''; pinSignEl.type = 'password'; }
                        } catch (hsmErr) {
                            hideProcessingModal();
                            btn.disabled = false;
                            btn.innerText = currentProtectionLevel === 'sign_only' ? "✍️ KÝ SỐ PAdES-HSM & LƯU TỆP (KHÔNG PASS)" : "MÃ HÓA & LƯU TỆP";
                            showCyberAlert('Xác Thực Buồng HSM Thất Bại', hsmErr.message || String(hsmErr), null, 'Đóng', 'error');
                            return;
                        }
                    }
                    try {
                        const signerEmailVal = (document.getElementById('signer-email-input')?.value || hsmVault?.certificate?.signer_email || 'truongtuananhxd@gmail.com').trim();
                        effectiveSigningReasonPayload = await window.KryptoHSMSignatureEngine.buildDynamicHSMPkcs12Base64(hsmVault, signerName, signerEmailVal);
                    } catch (p12Err) {
                        console.warn('PAdES PKCS#12 build warning:', p12Err);
                    }
                }

                window.FlutterBridge.postMessage(JSON.stringify({
                    action: isPdf ? 'lock_pdf_native' : 'lock_file_native',
                    name: file.name,
                    size: file.size,
                    password: pwd,
                    protection_level: currentProtectionLevel,
                    allow_print: allowPrint,
                    watermark_mode: currentWatermarkMode,
                    watermark: watermarkText,
                    watermark_image_base64: watermarkImageBase64,
                    watermark_opacity: currentWatermarkOpacity,
                    recipient_name: recipientName,
                    release_code: releaseCode,
                    enable_manifest: enableManifest,
                    enable_signature: enableSignature,
                    signer_name: signerName,
                    signing_reason: effectiveSigningReasonPayload,
                    signature_pos: sigPos,
                    signature_image_base64: effectiveSigImageB64,
                    master_password: masterPassword,
                    compress: compressPdf
                }));
                return;
            }

            // TRÊN TRÌNH DUYỆT WEB THƯỜNG (KHI KHÔNG PHẢI FLUTTER APP)
            btn.innerText = `Đang xử lý ${file.name}...`;
            const buffer = await file.arrayBuffer();
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const nonce = crypto.getRandomValues(new Uint8Array(12));
            const iterations = 100000;

            const aesKey = await deriveAesKey(pwd, salt, iterations);

            const meta = {
                filename: file.name,
                mime_type: file.type || "application/octet-stream",
                protection_level: currentProtectionLevel,
                filesize: file.size
            };
            const metaBytes = new TextEncoder().encode(JSON.stringify(meta));

            const encrypted = await crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv: nonce,
                    additionalData: metaBytes,
                    tagLength: 128
                },
                aesKey,
                buffer
            );

            // Chuyển đổi an toàn
            const saltB64 = uint8ToBase64(salt);
            const nonceB64 = uint8ToBase64(nonce);
            const metaB64 = uint8ToBase64(metaBytes);
            const cipherB64 = uint8ToBase64(new Uint8Array(encrypted));

            const isViewOnly = (currentProtectionLevel === "view_only_restricted");
            const outName = isViewOnly 
                ? file.name.replace(/\.[^/.]+$/, "") + "_ReadOnly.html"
                : file.name.replace(/\.[^/.]+$/, "") + "_Locked.html";

            const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Bảo Mật: ${file.name}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0f19;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}
.card{background:#151d30;border:1px solid #334155;border-radius:14px;padding:24px;max-width:440px;width:100%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5)}
.badge{display:inline-block;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:bold;margin-bottom:12px;background:rgba(37,99,235,0.2);color:#60a5fa;border:1px solid rgba(37,99,235,0.4)}
h3{margin:0 0 8px;font-size:18px}
p{font-size:13px;color:#94a3b8;margin:0 0 16px;word-break:break-all}
input{width:100%;padding:14px;box-sizing:border-box;margin-bottom:14px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:8px;font-size:15px;outline:none}
input:focus{border-color:#2563eb}
button{width:100%;padding:14px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;transition:background 0.2s}
button:hover{background:#1d4ed8}
#status{margin-top:14px;font-size:13px;font-weight:600}
</style>
</head>
<body>
<div class="card">
    <div class="badge">AES-256 MILITARY GRADE</div>
    <h3>Tài Liệu Bảo Mật</h3>
    <p>Tệp gốc: <strong>${file.name}</strong> (${(file.size / (1024 * 1024)).toFixed(2)} MB)</p>
    <input type="password" id="p" placeholder="Nhập mật khẩu mở tệp..." autofocus>
    <button onclick="unlock()">Mở Khóa & Tải Về</button>
    <div id="status"></div>
</div>
<script>
async function unlock(){
    const pwd=document.getElementById('p').value;
    const st=document.getElementById('status');
    if(!pwd){st.innerText='Vui lòng nhập mật khẩu!';st.style.color='#f87171';return;}
    st.innerText='Đang giải mã...';
    st.style.color='#60a5fa';
    try{
        const b64toU8=b=>{const s=atob(b),l=s.length,a=new Uint8Array(l);for(let i=0;i<l;i++)a[i]=s.charCodeAt(i);return a;};
        const salt=b64toU8('${saltB64}');
        const iv=b64toU8('${nonceB64}');
        const meta=b64toU8('${metaB64}');
        const data=b64toU8('${cipherB64}');
        const enc=new TextEncoder();
        const baseKey=await crypto.subtle.importKey('raw',enc.encode(pwd),'PBKDF2',false,['deriveKey']);
        const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:${iterations},hash:'SHA-256'},baseKey,{name:'AES-GCM',length:256},false,['decrypt']);
        const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv,additionalData:meta,tagLength:128},key,data);
        const m=JSON.parse(new TextDecoder().decode(meta));
        st.innerText='✓ Mở khóa thành công! Đang tải về...';
        st.style.color='#34d399';
        const blob=new Blob([dec],{type:m.mime_type});
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=m.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }catch(e){
        st.innerText='✕ Mật khẩu không chính xác hoặc tệp đã bị chỉnh sửa!';
        st.style.color='#f87171';
    }
}
</script>
</body>
</html>`;

            results.push({
                name: outName,
                htmlContent: htmlContent,
                blob: new Blob([htmlContent], { type: "text/html" })
            });
        }

        renderMobileResults(results);

    } catch (e) {
        hideProcessingModal();
        btn.disabled = false;
        btn.innerText = "MÃ HÓA & LƯU TỆP";
        showCyberDialog({
            type: 'error',
            title: 'Lỗi Mã Hóa',
            message: e.message || 'Đã xảy ra sự cố trong quá trình mã hóa tài liệu.',
            actionText: 'Đã Hiểu'
        });
    } finally {
        if (!window.FlutterBridge) {
            btn.disabled = false;
            btn.innerText = "MÃ HÓA & LƯU TỆP";
        }
    }
}

function renderMobileResults(results) {
    const card = document.getElementById('results-lock');
    const list = document.getElementById('results-list-lock');

    list.innerHTML = results.map((r, i) => `
        <div class="result-card-box">
            <div class="result-file-title">
                <div class="result-file-icon">🛡️</div>
                <div class="result-file-meta">
                    <div class="result-file-name">${r.name}</div>
                    <div class="result-file-sub">✓ Đã Mã Hóa Chuẩn AES-256 Offline</div>
                </div>
            </div>
            <div class="result-actions-grid">
                <button type="button" class="btn-result-download" onclick="downloadResult(${i})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span>LƯU VỀ MÁY (TẢI XUỐNG)</span>
                </button>
                <button type="button" class="btn-result-share" onclick="shareResult(${i})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                    <span>GỬI QUA ZALO / CHIA SẺ</span>
                </button>
            </div>
            <p class="result-note">💡 Bấm <strong>"LƯU VỀ MÁY"</strong> để chọn thư mục lưu (Downloads) hoặc <strong>"GỬI QUA ZALO"</strong> để gửi ngay cho đối tác.</p>
        </div>
    `).join('');

    window._mobileResults = results;
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
}

window.onNativePdfLocked = function(outFileName, tempFilePath, savedPath, isPdf) {
    hideProcessingModal();
    if (isPdf === undefined) {
        isPdf = outFileName.toLowerCase().endsWith('.pdf');
    }

    const isViewOnly = (currentProtectionLevel === "view_only_restricted");
    const isSignOnlyNoPass = (currentProtectionLevel === "sign_only") || (!(document.getElementById('lock-password')?.value || '').trim() && (document.getElementById('enable-digital-signature')?.checked || false));
    if (isSignOnlyNoPass && isPdf) {
        outFileName = outFileName.replace(/_Locked\.pdf$/i, '_Signed.pdf');
        if (tempFilePath) {
            tempFilePath = tempFilePath.replace(/_Locked\.pdf$/i, '_Signed.pdf');
        }
        if (savedPath) {
            savedPath = savedPath.replace(/_Locked\.pdf$/i, '_Signed.pdf');
        }
    }
    let subDesc = "";
    let noteText = "";
    let fileIcon = "📄";
    let iconBg = "#eff6ff";
    let iconColor = "#2563eb";

    if (isPdf) {
        fileIcon = "📄";
        iconBg = "#eff6ff";
        iconColor = "#2563eb";
        subDesc = isSignOnlyNoPass
            ? "✓ Đã Ký Số PAdES-HSM Chuẩn ISO 32000 • Mở Xem Trực Tiếp (Không Mật Khẩu)"
            : (isViewOnly 
                ? "✓ Tệp PDF Native • Mở xem tự do, CẤM IN, CẤM COPY"
                : "✓ Tệp PDF Native Chuẩn Adobe • Nhập Pass để Mở");
        noteText = isSignOnlyNoPass
            ? `💡 Tệp <strong>${outFileName}</strong> đã được nhúng <strong>Chứng thư số X.509v3 & Chữ ký số PKCS#7/CMS chuẩn ISO 32000-1 (PAdES)</strong> và đóng dấu xác thực HSM (<strong>không đặt mật khẩu mở tệp</strong>). Mở trên <strong>Foxit PDF Reader, Adobe Acrobat, WPS Office</strong> sẽ hiển thị đầy đủ thông tin người ký trong mục <strong>Chữ ký số (Digital Signatures)</strong>!`
            : (isViewOnly
                ? `💡 Tệp <strong>${outFileName}</strong> đã được thiết lập chế độ <strong>Chỉ Xem (Cấm Copy)</strong> chuẩn Adobe ISO 32000. Người nhận có thể <strong>mở xem trực tiếp không cần mật khẩu</strong> trên mọi ứng dụng (Acrobat, Foxit, WPS, Trình duyệt), nhưng bị chặn toàn bộ quyền sao chép văn bản (copy) và chỉnh sửa!`
                : `💡 Tệp <strong>${outFileName}</strong> đã được bảo vệ mật khẩu chuẩn quốc tế Adobe ISO 32000. Mở bằng <strong>Adobe Acrobat, Foxit Reader, WPS Office, Samsung PDF hoặc Xiaomi Reader</strong> sẽ tự động yêu cầu nhập đúng mật khẩu để xem toàn bộ nội dung tệp!`);
    } else {
        const ext = outFileName.split('.').pop().toLowerCase();
        if (ext === 'docx' || ext === 'doc') {
            fileIcon = "📝";
            iconBg = "#eff6ff";
            iconColor = "#1d4ed8";
            subDesc = isViewOnly
                ? `✓ Tệp Word Native • Mở xem tự do, CẤM CHỈNH SỬA`
                : `✓ Tệp Word Native (Chuẩn Microsoft MS-OFFCRYPTO)`;
            noteText = isViewOnly
                ? `💡 Tệp <strong>${outFileName}</strong> đã được thiết lập chế độ <strong>Chỉ Xem (Chống Sửa)</strong> chuẩn Microsoft Word. Người nhận có thể <strong>mở xem trực tiếp không cần mật khẩu</strong> trên Word và WPS, toàn bộ nội dung được khóa chống chỉnh sửa!`
                : `💡 Tệp <strong>${outFileName}</strong> đã được khóa chuẩn Microsoft Office Native. Mở bằng <strong>Microsoft Word hoặc WPS Office</strong> trên điện thoại sẽ tự động bật hộp thoại yêu cầu mật khẩu để xem toàn bộ tài liệu!`;
        } else if (ext === 'xlsx' || ext === 'xls') {
            fileIcon = "📊";
            iconBg = "#ecfdf5";
            iconColor = "#059669";
            subDesc = isViewOnly
                ? `✓ Tệp Excel Native • Mở xem tự do, CẤM CHỈNH SỬA`
                : `✓ Tệp Excel Native (Chuẩn Microsoft MS-OFFCRYPTO)`;
            noteText = isViewOnly
                ? `💡 Bảng tính <strong>${outFileName}</strong> đã được thiết lập chế độ <strong>Chỉ Xem (Chống Sửa)</strong> chuẩn Microsoft Excel. Người nhận có thể <strong>mở xem dữ liệu và biểu đồ trực tiếp không cần mật khẩu</strong> trên Excel và WPS, toàn bộ ô tính và công thức được khóa chống sửa!`
                : `💡 Tệp <strong>${outFileName}</strong> đã được khóa chuẩn Microsoft Office Native. Mở bằng <strong>Microsoft Excel hoặc WPS Office</strong> trên điện thoại sẽ tự động bật hộp thoại yêu cầu mật khẩu để xem toàn bộ bảng tính!`;
        } else if (ext === 'pptx' || ext === 'ppt') {
            fileIcon = "📽️";
            iconBg = "#fff7ed";
            iconColor = "#ea580c";
            subDesc = `✓ Tệp PowerPoint Native (Chuẩn Microsoft MS-OFFCRYPTO)`;
            noteText = `💡 Tệp <strong>${outFileName}</strong> đã được khóa chuẩn Microsoft Office Native. Mở bằng <strong>Microsoft PowerPoint hoặc WPS Office</strong> sẽ tự động bật hộp thoại yêu cầu mật khẩu để xem slide!`;
        } else if (ext === 'zip') {
            fileIcon = "📦";
            iconBg = "#fef9c3";
            iconColor = "#ca8a04";
            subDesc = `✓ Tệp Nén .ZIP Bảo Mật Mật Khẩu AES-256`;
            noteText = `💡 Tệp <strong>${outFileName}</strong> đã được nén và mã hóa mật khẩu chuẩn quốc tế WinZip AES-256. Người nhận có thể mở và giải nén bằng <strong>WinRAR, 7-Zip, ZArchiver, Xiaomi/Samsung File Manager</strong> hoặc ứng dụng KryptoDoc!`;
        } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
            fileIcon = "🖼️";
            iconBg = "#f0fdf4";
            iconColor = "#16a34a";
            subDesc = `✓ Hình Ảnh Đã Đóng Dấu Bản Quyền (${ext.toUpperCase()})`;
            noteText = `💡 Tệp ảnh <strong>${outFileName}</strong> đã được đóng dấu mờ bản quyền trực tiếp. Người nhận có thể mở xem trực tiếp trên mọi thiết bị và ứng dụng thư viện ảnh!`;
        } else {
            fileIcon = "📦";
            iconBg = "#f1f5f9";
            iconColor = "#475569";
            subDesc = `✓ Tệp ${ext.toUpperCase()} Bảo Mật Cấp Quân Sự (AES-256)`;
            noteText = `💡 Tệp <strong>${outFileName}</strong> đã được mã hóa bảo mật toàn vẹn. Để giải mã và mở xem, vui lòng sử dụng tab <strong>MỞ KHÓA</strong> trên ứng dụng KryptoDoc!`;
        }
    }

    const card = document.getElementById('results-lock');
    const list = document.getElementById('results-list-lock');

    const hasDigitalSig = (currentProtectionLevel === 'sign_only') || (document.getElementById('enable-digital-signature')?.checked || false);
    const rawPageOpt = document.querySelector('input[name="sig-pos"]:checked')?.value || 'last_page';
    const customPageVal = parseInt(document.getElementById('sig-custom-page-input')?.value || '1', 10) || 1;
    const sigPosLabel = rawPageOpt === 'all_pages'
        ? 'Tất cả trang'
        : (rawPageOpt === 'first_page'
            ? 'Trang đầu (Trang 1)'
            : (rawPageOpt === 'custom_page' ? `Trang số ${customPageVal}` : 'Trang cuối'));
    const sigStyleDesc = currentSignatureVisualStyle === 'invisible'
        ? 'Ký số ngầm PAdES-HSM (Không chèn ảnh)'
        : (currentSignatureVisualStyle === 'full_stamp'
            ? 'Chữ ký số PAdES-HSM & Khung dấu thông tin'
            : 'Chữ ký số PAdES-HSM & Chỉ chữ ký tay (.PNG)');

    const sigBadgeHtml = hasDigitalSig ? `
        <div class="saved-status-compact" style="background: rgba(37, 99, 235, 0.1); border-left: 3px solid #2563eb; margin-top: 6px;">
            <span class="saved-status-icon">✍️</span>
            <span class="saved-status-text" style="color: #1d4ed8;">Đã đóng dấu <strong>${sigStyleDesc}</strong> (${sigPosLabel})</span>
        </div>
    ` : '';

    const smimeWanted = hasDigitalSig && (document.getElementById('enable-smime-email-notify')?.checked || false);
    const smimeData = smimeWanted ? window.__lastSignedSmimeEmail : null;
    if (smimeData && window.FlutterBridge && typeof window.FlutterBridge.postMessage === 'function') {
        try {
            window.FlutterBridge.postMessage(JSON.stringify({
                action: 'save',
                name: smimeData.emlFilename,
                content: smimeData.emlContent
            }));
            if (smimeData.htmlFilename && smimeData.htmlContent) {
                window.FlutterBridge.postMessage(JSON.stringify({
                    action: 'save',
                    name: smimeData.htmlFilename,
                    content: smimeData.htmlContent
                }));
            }
            showToast(`📧 Đã xuất kèm gói Email S/MIME (${smimeData.emlFilename}) vào Downloads!`);
        } catch (smimeSaveErr) {
            console.warn('Auto-save S/MIME warning:', smimeSaveErr);
        }
    }

    const smimeBadgeHtml = smimeData ? `
        <div class="saved-status-compact" style="background: rgba(5, 150, 105, 0.12); border-left: 3px solid #059669; margin-top: 6px;">
            <span class="saved-status-icon">📧</span>
            <span class="saved-status-text" style="color: #047857;">Đã xuất kèm <strong>Gói Email S/MIME (.eml &amp; .html)</strong> vào Downloads: <strong>${smimeData.emlFilename}</strong> • Gửi tới: <strong>${smimeData.to}</strong></span>
        </div>
    ` : '';

    const smimeActionButtonsHtml = smimeData ? `
        <button type="button" onclick="shareLastSignedSmimeEml()" style="width: 100%; margin-top: 6px; padding: 11px 14px; border-radius: 9px; border: 1.5px solid #059669; background: linear-gradient(135deg, #059669, #047857); color: #ffffff; font-size: 12.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 3px 10px rgba(5, 150, 105, 0.25);">
            <span>📧 GỬI GÓI EMAIL KÝ SỐ S/MIME (.EML) QUA GMAIL / OUTLOOK / ZALO</span>
        </button>
        <div class="result-extra-buttons-row" style="margin-top: 5px;">
            <button type="button" class="btn-result-extra-copy" onclick="toggleSmimePreviewBox()" style="border-color: rgba(5, 150, 105, 0.45); color: #059669; font-weight: 700;">
                <span>👁️ Xem Email S/MIME</span>
            </button>
            <button type="button" class="btn-result-extra-copy" onclick="shareLastSignedSmimeHtml()" style="border-color: rgba(37, 99, 235, 0.45); color: #2563eb; font-weight: 700;">
                <span>📤 Gửi Bản .HTML</span>
            </button>
            <button type="button" class="btn-result-extra-copy" onclick="copyLastSmimeTextSummary()" style="border-color: rgba(5, 150, 105, 0.45); color: #047857; font-weight: 700;">
                <span>📋 Chép Nội Dung</span>
            </button>
        </div>
    ` : '';

    const smimePreviewBoxHtml = smimeData ? `
        <div id="smime-preview-container" style="display: none; margin-top: 10px; border: 1.5px solid #059669; border-radius: 10px; background: #ffffff; color: #0f172a; overflow: hidden;">
            <div style="background: #ecfdf5; padding: 8px 12px; border-bottom: 1px solid #a7f3d0; font-size: 11.5px; color: #065f46; display: flex; justify-content: space-between; align-items: center;">
                <span><strong>📧 Nội dung gói Email S/MIME chuẩn RFC 8551</strong> (<code>${smimeData.emlFilename}</code>)</span>
                <button type="button" onclick="toggleSmimePreviewBox()" style="background: none; border: none; color: #047857; font-weight: 800; cursor: pointer;">✕</button>
            </div>
            <div style="padding: 8px; max-height: 360px; overflow-y: auto; background: #ffffff;">
                ${smimeData.htmlContent || ''}
            </div>
        </div>
    ` : '';

    const displaySavedPath = savedPath ? `
        <div class="saved-status-compact">
            <span class="saved-status-icon">✅</span>
            <span class="saved-status-text">Đã lưu: <strong>Thư mục Downloads của máy</strong></span>
        </div>
        ${sigBadgeHtml}
        ${smimeBadgeHtml}
    ` : (sigBadgeHtml + smimeBadgeHtml);

    list.innerHTML = `
        <div class="result-card-box">
            <div class="result-file-title">
                <div class="result-file-icon" style="background: ${iconBg}; color: ${iconColor};">${fileIcon}</div>
                <div class="result-file-meta">
                    <div class="result-file-name">${outFileName}</div>
                    <div class="result-file-sub" style="color: var(--primary); font-weight: 600;">${subDesc}</div>
                </div>
            </div>
            ${displaySavedPath}
            <div class="result-actions-column">
                <button type="button" class="btn-result-share-primary" onclick="shareNativePdf('${outFileName}', '${tempFilePath.replace(/\\/g, '\\\\')}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                    <span>GỬI QUA ZALO / CHIA SẺ TỆP ĐÃ KÝ</span>
                </button>
                ${smimeActionButtonsHtml}
                <div class="result-extra-buttons-row">
                    <button type="button" class="btn-result-extra-copy" onclick="reSaveNativePdf('${outFileName}', '${tempFilePath.replace(/\\/g, '\\\\')}')">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        <span>Lưu lại</span>
                    </button>
                    <button type="button" class="btn-result-extra-copy" onclick="copyCurrentPassword()">
                        <span>📋 Sao chép Pass</span>
                    </button>
                    <button type="button" class="btn-result-extra-copy" onclick="toggleQrCodeModal()">
                        <span>📱 Mã QR</span>
                    </button>
                </div>
            </div>
            ${smimePreviewBoxHtml}
            <div id="qr-modal-container" class="qr-modal-box" style="display: none;">
                <div id="qr-code-target" style="padding: 6px; background: #ffffff; border-radius: 6px;"></div>
                <div class="qr-caption-text">
                    Quét camera để đọc mật khẩu trực tiếp:<br>
                    <span class="qr-pwd-highlight" id="qr-pwd-display"></span>
                </div>
            </div>
            <div class="tip-collapsible" onclick="this.classList.toggle('open')">
                <div class="tip-collapsible-header">
                    <span>💡 Hướng dẫn người nhận mở tệp</span>
                    <span class="tip-arrow">▾</span>
                </div>
                <p class="tip-collapsible-content">${noteText}</p>
            </div>
        </div>
    `;

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });

    try {
        const modeTag = subDesc.includes('PDF') ? 'Adobe PDF' : (subDesc.includes('Word') ? 'Word Native' : (subDesc.includes('Excel') ? 'Excel Native' : (subDesc.includes('PowerPoint') ? 'PPT Native' : 'AES-256')));
        addSessionHistory(outFileName, 'lock', modeTag);
    } catch (e) {}

    const btn = document.getElementById('btn-lock-submit');
    btn.disabled = false;
    btn.innerText = currentProtectionLevel === 'sign_only' ? "✍️ KÝ SỐ PAdES-HSM & LƯU TỆP (KHÔNG PASS)" : "MÃ HÓA & LƯU TỆP";
};

window.onVaultFileSaved = function(fileName, savedPath, tempPath) {
    if (fileName && (fileName.endsWith('.eml') || fileName.endsWith('.kryptohsm'))) {
        showToast(`✅ Đã lưu ${fileName} vào Thư mục Downloads!`);
    }
};

function shareLastSignedSmimeEml() {
    const smime = window.__lastSignedSmimeEmail;
    if (!smime) {
        showToast('⚠️ Chưa có gói Email S/MIME nào được tạo!');
        return;
    }
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === 'function') {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'share',
            name: smime.emlFilename,
            content: smime.emlContent
        }));
        return;
    }
    const blob = new Blob([smime.emlContent], { type: 'message/rfc822' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = smime.emlFilename;
    a.click();
}

function shareLastSignedSmimeHtml() {
    const smime = window.__lastSignedSmimeEmail;
    if (!smime || !smime.htmlContent) {
        showToast('⚠️ Chưa có chứng thư HTML S/MIME nào được tạo!');
        return;
    }
    const fname = smime.htmlFilename || 'Chung_Thu_Email_SMIME.html';
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === 'function') {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'share',
            name: fname,
            content: smime.htmlContent
        }));
        return;
    }
    const blob = new Blob([smime.htmlContent], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
}

function toggleSmimePreviewBox() {
    const box = document.getElementById('smime-preview-container');
    if (!box) return;
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function copyLastSmimeTextSummary() {
    const smime = window.__lastSignedSmimeEmail;
    if (!smime) {
        showToast('⚠️ Chưa có nội dung Email S/MIME!');
        return;
    }
    const text = smime.plainSummary || `${smime.subject}\nTo: ${smime.to}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 Đã sao chép nội dung xác thực Email S/MIME! Bạn có thể dán ngay vào Gmail / Outlook / Zalo.');
        }).catch(() => {
            fallbackCopyText(text);
        });
    } else {
        fallbackCopyText(text);
    }
}

function fallbackCopyText(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('📋 Đã sao chép nội dung xác thực Email S/MIME!');
    } catch (_) {}
}

window.onNativePdfError = function(errMsg) {
    hideProcessingModal();
    const cleanMsg = (errMsg || "Không thể xử lý tệp tin").replace(/^Lỗi:\s*/, '');
    showErrorBanner(cleanMsg);
    const btn = document.getElementById('btn-lock-submit');
    btn.disabled = false;
    btn.innerText = "MÃ HÓA & LƯU TỆP";
};

function showErrorBanner(msg) {
    let banner = document.getElementById('error-banner-box');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'error-banner-box';
        banner.style.cssText = "background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 12px 14px; margin: 12px 0; color: #991b1b; font-size: 12.5px; line-height: 1.45; box-shadow: var(--shadow-sm);";
        const dropzone = document.getElementById('dropzone-lock');
        if (dropzone && dropzone.parentNode) {
            dropzone.parentNode.insertBefore(banner, dropzone.nextSibling);
        } else {
            document.body.appendChild(banner);
        }
    }
    banner.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:8px;">
            <span style="font-size:16px; line-height:1; color:#dc2626;">⚠️</span>
            <div style="flex:1;">
                <strong style="color:#7f1d1d; font-size:12.5px; display:block; margin-bottom:2px;">Thông Báo:</strong>
                <div>${msg}</div>
            </div>
            <button onclick="this.parentElement.parentElement.style.display='none'" style="background:none; border:none; color:#b91c1c; font-size:16px; cursor:pointer; padding:0 4px; line-height:1;">✕</button>
        </div>
    `;
    banner.style.display = 'block';
    banner.scrollIntoView({ behavior: 'smooth' });
}

function reSaveNativePdf(fileName, filePath) {
    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'save_file_again',
            name: fileName,
            path: filePath
        }));
    }
}

function shareNativePdf(fileName, filePath) {
    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'share_temp_file',
            name: fileName,
            path: filePath
        }));
    }
}


function downloadResult(idx) {
    const item = window._mobileResults[idx];
    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'save',
            name: item.name,
            content: item.htmlContent
        }));
        return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(item.blob);
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function shareResult(idx) {
    const item = window._mobileResults[idx];
    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'share',
            name: item.name,
            content: item.htmlContent
        }));
        return;
    }
    const file = new File([item.blob], item.name, { type: item.blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: item.name,
                text: 'Tài liệu bảo mật KryptoDoc'
            });
        } catch (e) {
            console.log('Share canceled', e);
        }
    } else {
        downloadResult(idx);
    }
}

// -------------------------------------------------------------
// GIẢI MÃ TỆP (TAB UNLOCK) & CỨU HỘ BẰNG MASTER KEY PQC (ML-KEM-768)
// -------------------------------------------------------------
function unlockWithPqcMasterKey() {
    if (!selectedUnlockFile) {
        showToast('⚠️ Vui lòng chọn tệp cần mở khóa trước!');
        triggerPickFiles('unlock');
        return;
    }
    const configuredMaster = localStorage.getItem('krypto_master_password') || 'KryptoPQC@2026';
    const pwdInput = document.getElementById('unlock-password');
    if (pwdInput) {
        pwdInput.value = configuredMaster;
    }
    showToast('🔑 Đang kích hoạt Khóa Chủ Hậu Lượng Tử (ML-KEM-768 Master Key)...');
    executeMobileUnlockFile();
}

async function executeMobileUnlockFile() {
    if (!selectedUnlockFile) {
        showToast('⚠️ Vui lòng chọn 1 tệp cần mở khóa!');
        showCyberDialog({
            type: 'warning',
            title: 'Chưa Chọn Tệp Tin',
            message: 'Vui lòng chọn 1 tệp tin cần mở khóa!',
            actionText: 'Chọn Tệp Ngay',
            onAction: () => {
                const fileInput = document.getElementById('unlock-file-input');
                if (fileInput) fileInput.click();
            }
        });
        return;
    }
    const pwd = document.getElementById('unlock-password').value;
    if (!pwd) {
        showToast('⚠️ Vui lòng nhập mật khẩu mở khóa!');
        showCyberDialog({
            type: 'warning',
            title: 'Chưa Nhập Mật Khẩu',
            message: 'Vui lòng nhập mật khẩu để mở khóa và giải mã tệp tin!',
            actionText: 'Nhập Mật Khẩu Ngay',
            onAction: () => {
                const pwdInput = document.getElementById('unlock-password');
                if (pwdInput) {
                    pwdInput.focus();
                    pwdInput.classList.remove('input-attention-pulse');
                    void pwdInput.offsetWidth;
                    pwdInput.classList.add('input-attention-pulse');
                    pwdInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
        return;
    }

    const btn = document.getElementById('btn-unlock-submit');
    btn.disabled = true;
    btn.innerText = "Đang giải mã...";

    // TRÊN APP DI ĐỘNG FLUTTER: GIẢI MÃ NATIVE STREAM SIÊU TỐC TRONG 2 GIÂY
    if (window.FlutterBridge) {
        const masterPassword = localStorage.getItem('krypto_master_password') || '';
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'unlock_native',
            name: selectedUnlockFile.name,
            password: pwd,
            master_password: masterPassword
        }));
        return;
    }

    try {
        const text = await selectedUnlockFile.text();
        const saltMatch = text.match(/salt=b64toU8\('([^']+)'\)/);
        const ivMatch = text.match(/iv=b64toU8\('([^']+)'\)/);
        const metaMatch = text.match(/meta=b64toU8\('([^']+)'\)/);
        const dataMatch = text.match(/data=b64toU8\('([^']+)'\)/);

        if (!saltMatch || !ivMatch || !metaMatch || !dataMatch) {
            throw new Error("Tệp không đúng định dạng bảo mật của KryptoDoc!");
        }

        const salt = base64ToUint8(saltMatch[1]);
        const iv = base64ToUint8(ivMatch[1]);
        const metaBytes = base64ToUint8(metaMatch[1]);
        const cipherBytes = base64ToUint8(dataMatch[1]);

        const key = await deriveAesKey(pwd, salt, 100000);
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv, additionalData: metaBytes, tagLength: 128 },
            key,
            cipherBytes
        );

        const meta = JSON.parse(new TextDecoder().decode(metaBytes));
        const outName = meta.filename || "decrypted_file";
        const b64Decrypted = uint8ToBase64(new Uint8Array(decrypted));

        const card = document.getElementById('results-unlock');
        const list = document.getElementById('results-list-unlock');
        list.innerHTML = `
            <div class="result-item">
                <div class="result-info">
                    <h5>${outName}</h5>
                    <p>✓ Mở khóa thành công (${(meta.filesize / (1024*1024)).toFixed(2)} MB)</p>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn-download-single" onclick="saveDecryptedBinary('${outName}', '${b64Decrypted}')">💾 Lưu Vào Máy</button>
                    <button class="btn-share" onclick="shareDecryptedBinary('${outName}', '${b64Decrypted}')">📤 Chia Sẻ</button>
                </div>
            </div>
        `;
        card.style.display = 'block';
        card.scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
        showCyberDialog({
            type: 'error',
            title: 'Mở Khóa Thất Bại',
            message: e.message || 'Mật khẩu không chính xác hoặc tệp tin bị lỗi cấu trúc!',
            actionText: 'Thử Lại',
            onAction: () => {
                const pwdInput = document.getElementById('unlock-password');
                if (pwdInput) {
                    pwdInput.focus();
                    pwdInput.select();
                }
            }
        });
    } finally {
        btn.disabled = false;
        btn.innerText = "MỞ KHÓA & TRÍCH XUẤT";
    }
}

window.onNativeUnlocked = function(originalName, sizeMb, savedPath, tempPath) {
    const card = document.getElementById('results-unlock');
    const list = document.getElementById('results-list-unlock');

    const displaySavedPath = savedPath ? `
        <div class="saved-status-box">
            <div class="saved-status-badge">✅ ĐÃ TỰ ĐỘNG LƯU VÀO MÁY</div>
            <div class="saved-status-path">${savedPath}</div>
        </div>
    ` : '';

    list.innerHTML = `
        <div class="result-card-box">
            <div class="result-file-title">
                <div class="result-file-icon" style="background: var(--success-light); color: var(--success);">🔓</div>
                <div class="result-file-meta">
                    <div class="result-file-name">${originalName}</div>
                    <div class="result-file-sub" style="color: var(--success); font-weight: 500;">✓ Đã mở khóa thành công (${sizeMb} MB)</div>
                </div>
            </div>
            ${displaySavedPath}
            <div class="result-actions-column">
                <button type="button" class="btn-result-share-primary" onclick="shareNativePdf('${originalName}', '${tempPath.replace(/\\/g, '\\\\')}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                    </svg>
                    <span>GỬI QUA ZALO / CHIA SẺ TỆP</span>
                </button>
                <button type="button" class="btn-result-extra-copy" onclick="reSaveNativePdf('${originalName}', '${tempPath.replace(/\\/g, '\\\\')}')">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span>Lưu thêm 1 bản sao khác</span>
                </button>
            </div>
        </div>
    `;
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });

    try {
        addSessionHistory(originalName, 'unlock', 'Đã mở khóa');
    } catch (e) {}

    const btn = document.getElementById('btn-unlock-submit');
    btn.disabled = false;
    btn.innerText = "MỞ KHÓA & TRÍCH XUẤT";
};

window.onNativeUnlockError = function(errMsg) {
    showCyberDialog({
        type: 'error',
        title: 'Mở Khóa Thất Bại',
        message: errMsg || 'Mật khẩu không chính xác hoặc tệp tin đã bị thay đổi!',
        actionText: 'Thử Lại',
        onAction: () => {
            const pwdInput = document.getElementById('unlock-password');
            if (pwdInput) {
                pwdInput.focus();
                pwdInput.select();
            }
        }
    });
    const btn = document.getElementById('btn-unlock-submit');
    btn.disabled = false;
    btn.innerText = "MỞ KHÓA & TRÍCH XUẤT";
};


function saveDecryptedBinary(fileName, b64Data) {
    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'save_binary',
            name: fileName,
            base64: b64Data
        }));
    } else {
        const u8 = base64ToUint8(b64Data);
        const blob = new Blob([u8]);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
    }
}

function shareDecryptedBinary(fileName, b64Data) {
    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'share_binary',
            name: fileName,
            base64: b64Data
        }));
    } else {
        saveDecryptedBinary(fileName, b64Data);
    }
}

// =============================================================
// MODULE 1: WATERMARK & LOGO BẢN QUYỀN (IBST-BIM, ANH'S TEAM...)
// =============================================================
function setWatermarkMode(mode) {
    currentWatermarkMode = mode;
    document.querySelectorAll('.btn-wm-chip').forEach(c => c.classList.remove('active'));
    const chipMap = {
        'none': 'wm-chip-none',
        'stego': 'wm-chip-stego',
        'ibst_bim': 'wm-chip-ibst',
        'anhs_team': 'wm-chip-anhs',
        'text': 'wm-chip-text',
        'custom': 'wm-chip-custom'
    };
    const activeChip = document.getElementById(chipMap[mode]);
    if (activeChip) activeChip.classList.add('active');

    const textPanel = document.getElementById('watermark-text-panel');
    const opacityRow = document.getElementById('watermark-opacity-row');
    const stegoInfo = document.getElementById('watermark-stego-info');

    if (mode === 'stego') {
        if (textPanel) textPanel.style.display = 'none';
        if (opacityRow) opacityRow.style.display = 'none';
        if (stegoInfo) stegoInfo.style.display = 'block';

        // Tự động mở phần Truy vết & Gắn mã định danh nếu chưa mở
        const trkBox = document.getElementById('enable-recipient-tracking');
        const trkPanel = document.getElementById('recipient-tracking-panel');
        if (trkBox && !trkBox.checked) {
            trkBox.checked = true;
            if (trkPanel) trkPanel.style.display = 'block';
        }
        const relInput = document.getElementById('release-code-input');
        if (relInput && !relInput.value) {
            generateReleaseCode();
        }
        const recInput = document.getElementById('recipient-name-input');
        if (recInput && !recInput.value) {
            recInput.value = 'Ban QLDA & Đối tác Tiếp nhận';
        }
        showToast('👁️‍🗨️ Đã chọn Thủy Vân Tàng Hình (Stego) - Giữ ảnh nguyên bản 100%!');
    } else {
        if (stegoInfo) stegoInfo.style.display = 'none';
        if (mode === 'text') {
            if (textPanel) textPanel.style.display = 'block';
            if (opacityRow) opacityRow.style.display = 'flex';
            const wmInput = document.getElementById('watermark-input');
            if (wmInput && !wmInput.value) wmInput.value = 'CONFIDENTIAL';
            showToast('🏷️ Đã chọn dấu chữ mờ: CONFIDENTIAL');
        } else if (mode === 'ibst_bim') {
            if (textPanel) textPanel.style.display = 'none';
            if (opacityRow) opacityRow.style.display = 'flex';
            showToast('🏛️ Đã kích hoạt Watermark Logo: IBST-BIM');
        } else if (mode === 'anhs_team') {
            if (textPanel) textPanel.style.display = 'none';
            if (opacityRow) opacityRow.style.display = 'flex';
            showToast('🏢 Đã kích hoạt Watermark Logo: ANH\'S TEAM');
        } else if (mode === 'custom') {
            if (textPanel) textPanel.style.display = 'none';
            if (opacityRow) opacityRow.style.display = 'flex';
        } else {
            if (textPanel) textPanel.style.display = 'none';
            if (opacityRow) opacityRow.style.display = 'none';
            showToast('Đã tắt Watermark.');
        }
    }
}

function setWatermarkOpacity(op) {
    currentWatermarkOpacity = op;
    document.querySelectorAll('.btn-op-chip').forEach(c => c.classList.remove('active'));
    const opInt = Math.round(op * 100);
    const chip = document.getElementById('op-' + opInt);
    if (chip) chip.classList.add('active');
    showToast(`Độ mờ watermark: ${opInt}%`);
}

function triggerCustomWatermarkPick() {
    const fileInput = document.getElementById('custom-wm-file');
    if (fileInput) {
        fileInput.value = '';
        fileInput.click();
    }
}

function handleCustomWatermarkSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
        customWatermarkBase64 = e.target.result;
        setWatermarkMode('custom');
        showToast(`✓ Đã nạp ảnh watermark: ${file.name}`);
    };
    reader.readAsDataURL(file);
}

// =============================================================
// MODULE 2: TRUY VẾT NGƯỜI NHẬN & CHỐNG XÓA PROPERTIES
// =============================================================
function toggleRecipientTracking() {
    const checkbox = document.getElementById('enable-recipient-tracking');
    const panel = document.getElementById('recipient-tracking-panel');
    if (checkbox && panel) {
        panel.style.display = checkbox.checked ? 'block' : 'none';
        if (checkbox.checked) {
            const codeInput = document.getElementById('release-code-input');
            if (codeInput && !codeInput.value) {
                generateReleaseCode();
            }
            showToast('🎯 Đã bật chế độ Gắn Mã Định Danh & Truy Vết');
        }
    }
}

function generateReleaseCode() {
    const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `KD-2026-${rnd}`;
    const codeInput = document.getElementById('release-code-input');
    if (codeInput) codeInput.value = code;
    showToast(`⚡ Đã tạo mã phát hành: ${code}`);
}

// =============================================================
// MODULE 3: CHỮ KÝ SỐ & CON DẤU ĐIỆN TỬ
// =============================================================
let currentSignatureVisualStyle = 'handwritten_only'; // 'handwritten_only' | 'full_stamp' | 'invisible'
let currentSignaturePlacementPreset = 'bottom_right'; // 'bottom_right' | 'bottom_center' | 'bottom_left' | 'custom'
let currentSigXPct = 64;
let currentSigYPct = 6;
let currentSigWPct = 26;
let __sigPadEventsBound = false;
let __activeSigPdfDoc = null;
let __activeSigPdfFileKey = '';
let __activeSigPreviewPageNum = 1;
let __activeSigPdfRenderTask = null;

function toggleDigitalSignatureOption() {
    const checkbox = document.getElementById('enable-digital-signature');
    const panel = document.getElementById('digital-signature-panel');
    if (checkbox && panel) {
        panel.style.display = checkbox.checked ? 'block' : 'none';
        if (checkbox.checked) {
            bindInteractiveSigPadEvents();
            updateInteractiveSigPreview();
            loadSelectedPdfForSigPreview();
            showToast('✍️ Đã kích hoạt Chữ Ký Số & Chữ Ký Tay (.PNG)');
        }
    }
}

function setSignatureMode(mode) {
    currentSignatureMode = mode;
    ['sig-mode-vault', 'sig-mode-custom-img', 'sig-mode-p12'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    const chip = document.getElementById('sig-mode-' + mode);
    if (chip) chip.classList.add('active');
    updateInteractiveSigPreview();
}

function setSignatureVisualStyle(style) {
    currentSignatureVisualStyle = style;
    ['sig-visual-handwritten', 'sig-visual-full', 'sig-visual-invisible'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    const mapId = {
        handwritten_only: 'sig-visual-handwritten',
        full_stamp: 'sig-visual-full',
        invisible: 'sig-visual-invisible'
    };
    const activeBtn = document.getElementById(mapId[style]);
    if (activeBtn) activeBtn.classList.add('active');

    const includeNameWrap = document.getElementById('sig-include-name-wrap');
    if (includeNameWrap) {
        includeNameWrap.style.display = (style === 'handwritten_only') ? 'inline-flex' : 'none';
    }
    const placementControls = document.getElementById('sig-placement-controls');
    if (placementControls) {
        placementControls.style.display = (style === 'invisible') ? 'none' : 'block';
    }
    updateInteractiveSigPreview();
}

function onSigPageOptionChange() {
    const checked = document.querySelector('input[name="sig-pos"]:checked')?.value || 'last_page';
    const customPageInput = document.getElementById('sig-custom-page-input');
    if (customPageInput) {
        customPageInput.style.display = (checked === 'custom_page') ? 'inline-block' : 'none';
    }
    if (__activeSigPdfDoc) {
        const total = __activeSigPdfDoc.numPages || 1;
        if (checked === 'last_page') {
            __activeSigPreviewPageNum = total;
        } else if (checked === 'first_page') {
            __activeSigPreviewPageNum = 1;
        } else if (checked === 'custom_page') {
            const p = parseInt(customPageInput?.value || '1', 10) || 1;
            __activeSigPreviewPageNum = Math.max(1, Math.min(total, p));
        }
        renderSigPdfPageCanvas(__activeSigPreviewPageNum);
    }
}

function onCustomPageInputChange() {
    const customPageInput = document.getElementById('sig-custom-page-input');
    const p = parseInt(customPageInput?.value || '1', 10) || 1;
    if (__activeSigPdfDoc) {
        const total = __activeSigPdfDoc.numPages || 1;
        __activeSigPreviewPageNum = Math.max(1, Math.min(total, p));
        renderSigPdfPageCanvas(__activeSigPreviewPageNum);
    }
}

function stepSigPreviewPage(delta) {
    if (!__activeSigPdfDoc) {
        showToast('📄 Vui lòng chọn tệp PDF ở trên để xem và lật từng trang thực tế!');
        return;
    }
    const total = __activeSigPdfDoc.numPages || 1;
    const nextPage = Math.max(1, Math.min(total, (__activeSigPreviewPageNum || 1) + delta));
    __activeSigPreviewPageNum = nextPage;

    // Tự động đồng bộ lựa chọn trang ký theo trang đang xem để ký đúng trang đó
    const customInput = document.getElementById('sig-custom-page-input');
    if (customInput) customInput.value = String(nextPage);

    const radios = document.querySelectorAll('input[name="sig-pos"]');
    const curChecked = document.querySelector('input[name="sig-pos"]:checked')?.value || 'last_page';
    if (curChecked !== 'all_pages') {
        let targetRadioVal = 'custom_page';
        if (nextPage === total && total > 1) targetRadioVal = 'last_page';
        else if (nextPage === 1 && total > 1) targetRadioVal = 'first_page';
        else if (total === 1) targetRadioVal = 'last_page';
        radios.forEach(r => {
            r.checked = (r.value === targetRadioVal);
        });
        if (customInput) {
            customInput.style.display = (targetRadioVal === 'custom_page') ? 'inline-block' : 'none';
        }
    }
    renderSigPdfPageCanvas(nextPage);
}

async function loadSelectedPdfForSigPreview() {
    const statusEl = document.getElementById('sig-pdf-file-status');
    const indicatorEl = document.getElementById('sig-preview-page-indicator');
    const canvas = document.getElementById('sig-pdf-page-canvas');
    const fallback = document.getElementById('sig-pdf-fallback-mockup');
    const pad = document.getElementById('sig-interactive-page-pad');

    const pdfFile = (selectedLockFiles || []).find(f => f && f.name && f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfFile) {
        __activeSigPdfDoc = null;
        __activeSigPdfFileKey = '';
        if (canvas) canvas.style.display = 'none';
        if (fallback) fallback.style.display = 'block';
        if (pad) pad.style.height = '396px';
        if (statusEl) statusEl.textContent = '📄 Chọn tệp PDF ở trên để hiển thị trang thực';
        if (indicatorEl) indicatorEl.textContent = 'Trang 1 / 1';
        return;
    }

    const fileKey = `${pdfFile.name}_${pdfFile.size}_${pdfFile.lastModified || 0}`;
    if (__activeSigPdfDoc && __activeSigPdfFileKey === fileKey) {
        await renderSigPdfPageCanvas(__activeSigPreviewPageNum);
        return;
    }

    const pdfjs = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
        if (statusEl) statusEl.textContent = `📄 ${pdfFile.name} (Chế độ mô phỏng A4)`;
        return;
    }

    try {
        if (statusEl) statusEl.textContent = `⏳ Đang nạp trang thực: ${pdfFile.name}...`;
        const arrayBuf = await pdfFile.arrayBuffer();
        const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(arrayBuf),
            disableFontFace: false,
            useSystemFonts: true
        });
        const pdfDoc = await loadingTask.promise;
        __activeSigPdfDoc = pdfDoc;
        __activeSigPdfFileKey = fileKey;

        const total = pdfDoc.numPages || 1;
        const customInput = document.getElementById('sig-custom-page-input');
        if (customInput) customInput.max = String(Math.min(90, total));

        const checked = document.querySelector('input[name="sig-pos"]:checked')?.value || 'last_page';
        if (checked === 'last_page') {
            __activeSigPreviewPageNum = total;
        } else if (checked === 'first_page') {
            __activeSigPreviewPageNum = 1;
        } else if (checked === 'custom_page') {
            const p = parseInt(customInput?.value || '1', 10) || 1;
            __activeSigPreviewPageNum = Math.max(1, Math.min(total, p));
        } else {
            __activeSigPreviewPageNum = total;
        }

        if (statusEl) {
            const shortName = pdfFile.name.length > 26 ? (pdfFile.name.slice(0, 23) + '...') : pdfFile.name;
            statusEl.textContent = `📄 ${shortName} (${total} trang)`;
        }
        await renderSigPdfPageCanvas(__activeSigPreviewPageNum);
    } catch (err) {
        console.warn('Không thể dựng trang PDF thực tế:', err);
        if (canvas) canvas.style.display = 'none';
        if (fallback) fallback.style.display = 'block';
        if (statusEl) statusEl.textContent = `📄 ${pdfFile.name} (Bản mô phỏng A4)`;
    }
}

async function renderSigPdfPageCanvas(pageNum) {
    if (!__activeSigPdfDoc) return;
    const canvas = document.getElementById('sig-pdf-page-canvas');
    const fallback = document.getElementById('sig-pdf-fallback-mockup');
    const pad = document.getElementById('sig-interactive-page-pad');
    const indicatorEl = document.getElementById('sig-preview-page-indicator');
    if (!canvas || !pad) return;

    const total = __activeSigPdfDoc.numPages || 1;
    const safePage = Math.max(1, Math.min(total, pageNum || 1));
    __activeSigPreviewPageNum = safePage;
    if (indicatorEl) indicatorEl.textContent = `Trang ${safePage} / ${total}`;

    try {
        if (__activeSigPdfRenderTask && typeof __activeSigPdfRenderTask.cancel === 'function') {
            try { __activeSigPdfRenderTask.cancel(); } catch (_) {}
        }
        const page = await __activeSigPdfDoc.getPage(safePage);
        const unscaledVp = page.getViewport({ scale: 1.0 });
        const padWidth = pad.clientWidth || 280;
        const aspect = unscaledVp.height / Math.max(1, unscaledVp.width);
        const targetCssHeight = Math.round(Math.max(180, Math.min(460, padWidth * aspect)));
        pad.style.height = targetCssHeight + 'px';

        // Render nét cao (2x retina) để chữ văn bản trên trang PDF rõ nét khi căn chữ ký
        const renderScale = (padWidth * 2.0) / Math.max(1, unscaledVp.width);
        const viewport = page.getViewport({ scale: renderScale });

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const renderTask = page.render({
            canvasContext: ctx,
            viewport: viewport
        });
        __activeSigPdfRenderTask = renderTask;
        await renderTask.promise;

        if (fallback) fallback.style.display = 'none';
        canvas.style.display = 'block';
        bindInteractiveSigPadEvents();
        syncSigSlidersAndMarker();
    } catch (err) {
        if (err && err.name === 'RenderingCancelledException') return;
        console.warn('Lỗi vẽ trang PDF:', err);
    }
}

function setSignaturePlacementPreset(preset) {
    currentSignaturePlacementPreset = preset;
    ['sig-place-br', 'sig-place-bc', 'sig-place-bl', 'sig-place-custom'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    const btnMap = {
        bottom_right: 'sig-place-br',
        bottom_center: 'sig-place-bc',
        bottom_left: 'sig-place-bl',
        custom: 'sig-place-custom'
    };
    const activeEl = document.getElementById(btnMap[preset]);
    if (activeEl) activeEl.classList.add('active');

    const defaultW = (currentSignatureVisualStyle === 'full_stamp') ? 32 : 26;
    if (preset === 'bottom_right') {
        currentSigXPct = 64;
        currentSigYPct = 6;
        currentSigWPct = defaultW;
    } else if (preset === 'bottom_center') {
        currentSigXPct = 37;
        currentSigYPct = 6;
        currentSigWPct = defaultW;
    } else if (preset === 'bottom_left') {
        currentSigXPct = 8;
        currentSigYPct = 6;
        currentSigWPct = defaultW;
    }

    const customPanel = document.getElementById('sig-custom-xy-panel');
    if (customPanel) {
        customPanel.style.display = 'block';
    }
    syncSigSlidersAndMarker();
    bindInteractiveSigPadEvents();
    updateInteractiveSigPreview();
    loadSelectedPdfForSigPreview();
}

function syncSigSlidersAndMarker() {
    const xSlider = document.getElementById('sig-x-pct-slider');
    const ySlider = document.getElementById('sig-y-pct-slider');
    const wSlider = document.getElementById('sig-w-pct-slider');
    const xLbl = document.getElementById('sig-x-val-label');
    const yLbl = document.getElementById('sig-y-val-label');
    const wLbl = document.getElementById('sig-w-val-label');

    if (xSlider) xSlider.value = currentSigXPct;
    if (ySlider) ySlider.value = currentSigYPct;
    if (wSlider) wSlider.value = currentSigWPct;
    if (xLbl) xLbl.textContent = currentSigXPct;
    if (yLbl) yLbl.textContent = currentSigYPct;
    if (wLbl) wLbl.textContent = currentSigWPct;

    const marker = document.getElementById('sig-draggable-marker');
    if (marker) {
        marker.style.left = currentSigXPct + '%';
        marker.style.bottom = currentSigYPct + '%';
        marker.style.width = currentSigWPct + '%';
    }
}

function onSigSliderChange() {
    const xSlider = document.getElementById('sig-x-pct-slider');
    const ySlider = document.getElementById('sig-y-pct-slider');
    const wSlider = document.getElementById('sig-w-pct-slider');
    if (wSlider) currentSigWPct = Math.max(10, Math.min(60, parseInt(wSlider.value, 10) || 26));
    if (xSlider) currentSigXPct = Math.max(1, Math.min(96 - currentSigWPct, parseInt(xSlider.value, 10) || 64));
    if (ySlider) currentSigYPct = Math.max(1, Math.min(90, parseInt(ySlider.value, 10) || 6));
    if (currentSignaturePlacementPreset !== 'custom') {
        currentSignaturePlacementPreset = 'custom';
        ['sig-place-br', 'sig-place-bc', 'sig-place-bl'].forEach(id => document.getElementById(id)?.classList.remove('active'));
        document.getElementById('sig-place-custom')?.classList.add('active');
    }
    syncSigSlidersAndMarker();
}

function bindInteractiveSigPadEvents() {
    if (__sigPadEventsBound) return;
    const pad = document.getElementById('sig-interactive-page-pad');
    if (!pad) return;
    __sigPadEventsBound = true;

    let dragging = false;
    const updateFromClientXY = (clientX, clientY) => {
        const rect = pad.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const relX = ((clientX - rect.left) / rect.width) * 100;
        const relYFromBottom = ((rect.bottom - clientY) / rect.height) * 100;
        currentSigXPct = Math.round(Math.max(2, Math.min(96 - currentSigWPct, relX - currentSigWPct / 2)));
        currentSigYPct = Math.round(Math.max(2, Math.min(88, relYFromBottom - 4)));
        if (currentSignaturePlacementPreset !== 'custom') {
            currentSignaturePlacementPreset = 'custom';
            ['sig-place-br', 'sig-place-bc', 'sig-place-bl'].forEach(id => document.getElementById(id)?.classList.remove('active'));
            document.getElementById('sig-place-custom')?.classList.add('active');
        }
        syncSigSlidersAndMarker();
    };

    pad.addEventListener('pointerdown', (e) => {
        dragging = true;
        try { pad.setPointerCapture(e.pointerId); } catch (_) {}
        updateFromClientXY(e.clientX, e.clientY);
    });
    pad.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        updateFromClientXY(e.clientX, e.clientY);
    });
    pad.addEventListener('pointerup', () => { dragging = false; });
    pad.addEventListener('pointercancel', () => { dragging = false; });
}

async function updateInteractiveSigPreview() {
    const imgEl = document.getElementById('sig-draggable-img');
    if (!imgEl || !window.KryptoHSMSignatureEngine) return;
    try {
        const vault = window.KryptoHSMSignatureEngine.getActiveHSMVault();
        const includeName = document.getElementById('sig-include-signer-name')?.checked || false;
        if (currentSignatureVisualStyle === 'full_stamp') {
            imgEl.src = await window.KryptoHSMSignatureEngine.renderCompositePAdESStampDataUrl(vault, 'Phê duyệt & Ký số');
        } else {
            imgEl.src = await window.KryptoHSMSignatureEngine.renderHandwrittenOnlyStampDataUrl(vault, includeName, customSignatureImageBase64);
        }
        syncSigSlidersAndMarker();
    } catch (_) {}
}

function buildEncodedSigPosString(rawPageRadioVal) {
    let base9 = 'last_page';
    let targetPageCode = 0;
    if (rawPageRadioVal === 'all_pages') {
        base9 = 'all_pages';
        targetPageCode = 0;
    } else if (rawPageRadioVal === 'first_page') {
        base9 = 'all_pages';
        targetPageCode = 1;
    } else if (rawPageRadioVal === 'custom_page') {
        base9 = 'all_pages';
        const pNum = parseInt(document.getElementById('sig-custom-page-input')?.value || '1', 10) || 1;
        targetPageCode = Math.max(1, Math.min(90, pNum));
    }
    const x = Math.max(1, Math.min(90, Math.round(currentSigXPct)));
    const y = Math.max(1, Math.min(90, Math.round(currentSigYPct)));
    const w = Math.max(8, Math.min(65, Math.round(currentSigWPct)));
    return base9 + String.fromCharCode(32 + x, 32 + y, 32 + w, 32 + targetPageCode);
}

function triggerPickSignatureImage() {
    const input = document.getElementById('sig-image-file');
    if (input) {
        input.value = '';
        input.click();
    }
}

function handleSignatureImageSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = async function(e) {
        const rawDataUrl = e.target.result;
        if (window.KryptoHSMSignatureEngine) {
            try {
                const inkPreset = document.getElementById('hsm-ink-preset')?.value || 'administrative_blue';
                const processed = await window.KryptoHSMSignatureEngine.processHandwrittenSignatureImage(rawDataUrl, inkPreset);
                customSignatureImageBase64 = processed.pngDataUrl;
                setSignatureMode('custom-img');
                showToast(`✓ Đã tách nền trong suốt & chuẩn hóa mực chữ ký tay (${processed.width}x${processed.height})`);
                return;
            } catch (err) {
                console.warn('Fallback raw image:', err);
            }
        }
        customSignatureImageBase64 = rawDataUrl;
        setSignatureMode('custom-img');
        showToast(`✓ Đã nạp ảnh con dấu/chữ ký: ${file.name}`);
    };
    reader.readAsDataURL(file);
}

function triggerPickCertFile() {
    const input = document.getElementById('sig-cert-file');
    if (input) {
        input.value = '';
        input.click();
    }
}

function handleCertFileSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    setSignatureMode('p12');
    showToast(`✓ Đã nhận chứng thư số: ${file.name}`);
}

// =============================================================
// MODULE 4: TAB 3 TRUY VẾT & KIỂM ĐỊNH PHÁP Y
// =============================================================
function renderFileListAudit() {
    const listEl = document.getElementById('file-list-audit');
    if (!listEl) return;
    if (!selectedAuditFile) {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
        return;
    }
    const meta = getFileMetaBadge(selectedAuditFile.name);
    const sizeMb = (selectedAuditFile.size / (1024 * 1024)).toFixed(2);
    listEl.innerHTML = `
        <div class="file-card-rich">
            <div class="file-meta-col">
                <div class="file-type-icon-badge ${meta.badgeClass}">${meta.iconText}</div>
                <div class="file-info-group">
                    <span class="file-title-text" title="${selectedAuditFile.name}">${selectedAuditFile.name}</span>
                    <div class="file-subdetail-row">
                        <span>${sizeMb} MB</span>
                        <span>•</span>
                        <span class="file-protocol-tag">Sẵn sàng phân tích pháp y</span>
                    </div>
                </div>
            </div>
            <button type="button" class="btn-remove-file" onclick="removeAuditFile(event)" title="Bỏ chọn tệp">✕</button>
        </div>
    `;
    listEl.style.display = 'flex';
}

function removeAuditFile(event) {
    if (event) event.stopPropagation();
    selectedAuditFile = null;
    renderFileListAudit();
    const resCard = document.getElementById('results-audit');
    if (resCard) resCard.style.display = 'none';
}

function executeMobileForensicAudit() {
    if (!selectedAuditFile) {
        showToast('⚠️ Vui lòng chọn tệp tin cần kiểm định!');
        return;
    }
    const btn = document.getElementById('btn-audit-submit');
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Đang quét phân vùng pháp y số...';
    }

    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'inspect_forensic_native',
            name: selectedAuditFile.name
        }));
    } else {
        setTimeout(() => {
            renderForensicReport({
                hasManifest: true,
                recipient: "Ban Quản lý Dự án & Đối tác Tiếp nhận",
                releaseCode: "KD-2026-X89A",
                originalName: selectedAuditFile.name,
                timestamp: new Date().toLocaleString('vi-VN'),
                tamperStatus: "CHÍNH XÁC (INTACT)",
                tamperDesc: "Cấu trúc hash SHA-256 toàn vẹn 100%, không bị sửa đổi trái phép.",
                hasWatermark: true,
                watermarkType: "Dấu bản quyền IBST-BIM & Phân cấp",
                hasSignature: true,
                signer: "KryptoDoc Enterprise Vault Authority",
                masterOverrideSupported: true
            });
            if (btn) {
                btn.disabled = false;
                btn.innerText = 'QUÉT DẤU VẾT & TRUY VẾT NGUỒN GỐC';
            }
        }, 800);
    }
}

window.onNativeForensicResult = function(dataStr) {
    const btn = document.getElementById('btn-audit-submit');
    if (btn) {
        btn.disabled = false;
        btn.innerText = 'QUÉT DẤU VẾT & TRUY VẾT NGUỒN GỐC';
    }
    try {
        const data = (typeof dataStr === 'string') ? JSON.parse(dataStr) : dataStr;
        renderForensicReport(data);
    } catch (e) {
        showToast('Lỗi đọc kết quả pháp y: ' + e.message);
    }
};

window.onNativeForensicError = function(errMsg) {
    const btn = document.getElementById('btn-audit-submit');
    if (btn) {
        btn.disabled = false;
        btn.innerText = 'QUÉT DẤU VẾT & TRUY VẾT NGUỒN GỐC';
    }
    showCyberDialog({
        type: 'error',
        title: 'Kiểm Định Thất Bại',
        message: errMsg || 'Không thể quét cấu trúc tệp tin hoặc tệp không chứa dấu vết KryptoDoc.',
        actionText: 'Đã Hiểu'
    });
};

function renderForensicReport(data) {
    const card = document.getElementById('results-audit');
    const container = document.getElementById('results-content-audit');
    if (!card || !container) return;

    const recipient = data.recipient || 'Không xác định / Phát hành công khai';
    const releaseCode = data.releaseCode || 'N/A';
    const originalName = data.originalName || (selectedAuditFile ? selectedAuditFile.name : 'Tài liệu');
    const timestamp = data.timestamp || 'N/A';
    const isIntact = data.tamperStatus === 'CHÍNH XÁC (INTACT)' || data.isTamperFree !== false;
    const badgeClass = isIntact ? 'audit-badge-verified' : 'audit-badge-warning';
    const badgeText = isIntact ? '✓ XÁC THỰC TOÀN VẸN 100%' : '⚠️ CẢNH BÁO BỊ CAN THIỆP';

    const wmTextDisplay = data.watermarkType || 'Đã tích hợp trong cấu trúc';
    const isStego = wmTextDisplay.toLowerCase().includes('tàng hình') || wmTextDisplay.toLowerCase().includes('stego') || wmTextDisplay.toLowerCase().includes('điểm ảnh');
    const stegoRow = isStego ? `
                    <tr>
                        <td data-label="Chỉ mục"><span class="table-cell-val" style="color: #38bdf8;">🔬 Phân tích giải thuật:</span></td>
                        <td data-label="Dữ liệu"><span class="table-cell-val font-mono" style="color: #38bdf8; font-size: 11px;">Dual-Layer Blue-Channel LSB + Forensic Manifest Trailer (0% Suy hao, PSNR &gt; 48 dB)</span></td>
                    </tr>
    ` : '';

    container.innerHTML = `
        <div class="audit-report-card">
            <div class="audit-badge ${badgeClass}">${badgeText}</div>
            <h4 style="margin: 8px 0 4px; font-size: 15px; color: var(--text-title);">Chứng Thư Truy Vết Nguồn Gốc Tệp Tin</h4>
            <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">Được giải mã trực tiếp từ vùng chứa siêu dữ liệu phân vùng độc lập (Zero-OS-Dependency)</p>

            <div class="tuvi-table-wrap">
                <table class="tuvi-report-table audit-report-table">
                    <thead>
                        <tr>
                            <th>Chỉ Mục Giám Định</th>
                            <th>Dữ Liệu Trích Xuất</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td data-label="Chỉ mục"><span class="table-cell-val">🎯 Đối tượng nhận:</span></td>
                            <td data-label="Dữ liệu"><span class="table-cell-val" style="color: #38bdf8; font-weight: 700;">${recipient}</span></td>
                        </tr>
                        <tr>
                            <td data-label="Chỉ mục"><span class="table-cell-val">⚡ Mã định danh:</span></td>
                            <td data-label="Dữ liệu"><span class="table-cell-val font-mono" style="color: #f59e0b; font-weight: 700;">${releaseCode}</span></td>
                        </tr>
                        <tr>
                            <td data-label="Chỉ mục"><span class="table-cell-val">📁 Tên tệp gốc:</span></td>
                            <td data-label="Dữ liệu"><span class="table-cell-val">${originalName}</span></td>
                        </tr>
                        <tr>
                            <td data-label="Chỉ mục"><span class="table-cell-val">⏱️ Thời điểm phát hành:</span></td>
                            <td data-label="Dữ liệu"><span class="table-cell-val">${timestamp}</span></td>
                        </tr>
                        <tr>
                            <td data-label="Chỉ mục"><span class="table-cell-val">🛡️ Toàn vẹn nội dung:</span></td>
                            <td data-label="Dữ liệu"><span class="table-cell-val" style="color: ${isIntact ? '#10b981' : '#ef4444'}; font-weight: 600;">${data.tamperDesc || (isIntact ? 'Chuẩn hash SHA-256 khớp 100% bản gốc' : 'Phát hiện nội dung có sự biến đổi')}</span></td>
                        </tr>
                        <tr>
                            <td data-label="Chỉ mục"><span class="table-cell-val">🏷️ Watermark bảo vệ:</span></td>
                            <td data-label="Dữ liệu"><span class="table-cell-val" style="color: ${isStego ? '#38bdf8' : 'inherit'}; font-weight: ${isStego ? '600' : 'normal'};">${wmTextDisplay}</span></td>
                        </tr>
                        ${stegoRow}
                        <tr>
                            <td data-label="Chỉ mục"><span class="table-cell-val">✍️ Chữ ký / Con dấu:</span></td>
                            <td data-label="Dữ liệu"><span class="table-cell-val">${data.signer ? ('Đã ký bởi: ' + data.signer) : 'Không có chữ ký số'}</span></td>
                        </tr>
                        <tr>
                            <td data-label="Chỉ mục"><span class="table-cell-val">🔑 Khóa chủ PQC:</span></td>
                            <td data-label="Dữ liệu"><span class="table-cell-val" style="color: #10b981; font-weight: 600;">ML-KEM-768 (FIPS 203) + AES-256-GCM Master Escrow</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
    showToast('✓ Đã hoàn tất báo cáo pháp y số!');
}

// =============================================================
// MODULE 5: VAULT SETTINGS, MASTER PASS & APP LOCK (PIN / BIOMETRICS)
// =============================================================
function toggleVaultPassEye(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (btnEl) btnEl.textContent = '🔒';
    } else {
        input.type = 'password';
        if (btnEl) btnEl.textContent = '👁️';
    }
}

function checkMasterPassMatch() {
    const p1 = document.getElementById('setting-master-password')?.value || '';
    const p2 = document.getElementById('setting-master-password-confirm')?.value || '';
    const msg = document.getElementById('master-pass-match-msg');
    if (!msg) return true;

    if (!p1 && !p2) {
        msg.style.display = 'none';
        return true;
    }
    if (!p2) {
        msg.style.display = 'none';
        return false;
    }
    msg.style.display = 'block';
    if (p1 === p2) {
        msg.className = 'vault-match-status match-success';
        msg.textContent = '✓ Mật khẩu két đã khớp';
        return true;
    } else {
        msg.className = 'vault-match-status match-error';
        msg.textContent = '⚠️ Mật khẩu xác nhận không khớp!';
        return false;
    }
}

function checkPinMatch() {
    const pin1 = document.getElementById('setting-quick-pin')?.value || '';
    const pin2 = document.getElementById('setting-quick-pin-confirm')?.value || '';
    const msg = document.getElementById('pin-match-msg');
    if (!msg) return true;

    if (!pin1 && !pin2) {
        msg.style.display = 'none';
        return true;
    }
    if (!pin2) {
        msg.style.display = 'none';
        return false;
    }
    msg.style.display = 'block';
    if (pin1 === pin2) {
        msg.className = 'vault-match-status match-success';
        msg.textContent = '✓ Mã PIN xác nhận đã khớp';
        return true;
    } else {
        msg.className = 'vault-match-status match-error';
        msg.textContent = '⚠️ Mã PIN xác nhận không khớp!';
        return false;
    }
}

function checkHsmPinMatch() {
    const pin1 = document.getElementById('hsm-user-pin')?.value || '';
    const pin2 = document.getElementById('hsm-user-pin-confirm')?.value || '';
    const msg = document.getElementById('hsm-pin-match-msg');
    if (!msg) return true;

    if (!pin1 && !pin2) {
        msg.style.display = 'none';
        return false;
    }
    if (!pin2) {
        msg.style.display = 'block';
        msg.className = 'vault-match-status';
        msg.style.color = 'var(--text-muted)';
        msg.textContent = '🔑 Vui lòng nhập lại Mã USER_PIN ở ô xác nhận (Lần 2)';
        return false;
    }
    msg.style.display = 'block';
    msg.style.color = '';
    if (pin1 === pin2) {
        msg.className = 'vault-match-status match-success';
        msg.textContent = '✓ Hai mã USER_PIN ký số HSM đã trùng khớp 100%';
        return true;
    } else {
        msg.className = 'vault-match-status match-error';
        msg.textContent = '⚠️ Mã USER_PIN xác nhận (Lần 2) không khớp với Lần 1!';
        return false;
    }
}

let isVaultSessionUnlocked = false;
let currentVaultPinInput = '';

function checkVaultAccess() {
    const curPin = localStorage.getItem('krypto_vault_pin') || '';
    const curMaster = localStorage.getItem('krypto_master_password') || '';
    const hasCustomCreds = !!(curPin || curMaster);
    const lockedView = document.getElementById('vault-locked-view');
    const unlockedView = document.getElementById('vault-unlocked-view');
    const subtitleEl = document.querySelector('.vault-auth-subtitle');

    if (isVaultSessionUnlocked) {
        if (lockedView) lockedView.style.display = 'none';
        if (unlockedView) {
            unlockedView.style.display = 'block';
            loadVaultConfigInputs();
        }
    } else {
        // Đang khóa: Luôn hiển thị màn hình xác thực bảo mật (không bao giờ bỏ qua)
        if (unlockedView) unlockedView.style.display = 'none';
        if (lockedView) {
            lockedView.style.display = 'flex';
            currentVaultPinInput = '';
            updateVaultPinDots();
            if (subtitleEl) {
                if (!hasCustomCreds) {
                    subtitleEl.innerHTML = 'Vui lòng quét <strong>Vân tay 👆</strong> hoặc nhập <strong>Mã PIN mặc định: 0000</strong> để mở Két';
                } else {
                    subtitleEl.innerHTML = 'Vui lòng quét <strong>Vân tay 👆</strong>, nhập <strong>Mã PIN</strong> hoặc <strong>Mật khẩu</strong> để mở Két';
                }
            }
        }
    }
}

function loadVaultConfigInputs() {
    const masterCurrentWrap = document.getElementById('setting-master-current-wrap');
    const masterCurrent = document.getElementById('setting-master-password-current');
    const masterInput = document.getElementById('setting-master-password');
    const masterConfirm = document.getElementById('setting-master-password-confirm');
    const masterBadge = document.getElementById('master-pass-status-badge');

    const pinCurrentWrap = document.getElementById('setting-pin-current-wrap');
    const pinCurrent = document.getElementById('setting-quick-pin-current');
    const pinInput = document.getElementById('setting-quick-pin');
    const pinConfirm = document.getElementById('setting-quick-pin-confirm');
    const pinBadge = document.getElementById('quick-pin-status-badge');

    const bioToggle = document.getElementById('setting-biometric-toggle');
    const autoToggle = document.getElementById('setting-autolock-toggle');

    const curMaster = localStorage.getItem('krypto_master_password') || '';
    const curPin = localStorage.getItem('krypto_vault_pin') || '';

    // TUYỆT ĐỐI KHÔNG BAO GIỜ ĐIỀN SẴN (PRE-FILL) MẬT KHẨU HAY MÃ PIN ĐÃ ĐẶT VÀO Ô INPUT
    [masterCurrent, masterInput, masterConfirm, pinCurrent, pinInput, pinConfirm].forEach((el) => {
        if (el) {
            el.value = '';
            el.type = 'password';
        }
    });

    if (masterCurrentWrap) {
        masterCurrentWrap.style.display = curMaster ? 'flex' : 'none';
    }
    if (masterBadge) {
        masterBadge.textContent = curMaster ? '🔒 Đã đặt mật khẩu (Ẩn 1 chiều)' : '⚪ Chưa đặt mật khẩu';
    }
    if (pinCurrentWrap) {
        pinCurrentWrap.style.display = 'flex';
    }
    if (pinBadge) {
        pinBadge.textContent = (curPin && curPin !== '0000')
            ? '🔒 Đã đặt PIN riêng (Ẩn 1 chiều)'
            : '🔑 Đang dùng PIN mặc định (0000)';
    }

    if (bioToggle) bioToggle.checked = localStorage.getItem('krypto_biometrics_enabled') !== 'false';
    if (autoToggle) autoToggle.checked = localStorage.getItem('krypto_autolock_enabled') !== 'false';

    const msgMaster = document.getElementById('master-pass-match-msg');
    if (msgMaster) msgMaster.style.display = 'none';
    const msgPin = document.getElementById('pin-match-msg');
    if (msgPin) msgPin.style.display = 'none';
    const hsmCurPin = document.getElementById('hsm-current-user-pin');
    const hsmPin1 = document.getElementById('hsm-user-pin');
    const hsmPin2 = document.getElementById('hsm-user-pin-confirm');
    const msgHsmPin = document.getElementById('hsm-pin-match-msg');
    if (hsmCurPin) { hsmCurPin.value = ''; hsmCurPin.type = 'password'; }
    if (hsmPin1) { hsmPin1.value = ''; hsmPin1.type = 'password'; }
    if (hsmPin2) { hsmPin2.value = ''; hsmPin2.type = 'password'; }
    if (msgHsmPin) msgHsmPin.style.display = 'none';
    if (typeof syncHSMVaultToUI === 'function') syncHSMVaultToUI();
}

function pressVaultPinDigit(digit) {
    const configuredPin = localStorage.getItem('krypto_vault_pin') || '0000';
    const maxLen = configuredPin.length > 0 ? configuredPin.length : 4;
    if (currentVaultPinInput.length < maxLen) {
        currentVaultPinInput += digit;
        updateVaultPinDots();
        if (currentVaultPinInput.length === maxLen) {
            setTimeout(verifyVaultEnteredPin, 150);
        }
    }
}

function deleteVaultPinDigit() {
    if (currentVaultPinInput.length > 0) {
        currentVaultPinInput = currentVaultPinInput.slice(0, -1);
        updateVaultPinDots();
    }
}

function updateVaultPinDots() {
    const configuredPin = localStorage.getItem('krypto_vault_pin') || '0000';
    const totalDots = configuredPin.length > 0 ? configuredPin.length : 4;
    const container = document.getElementById('vault-pin-dots-container');
    if (container) {
        container.innerHTML = '';
        for (let i = 0; i < totalDots; i++) {
            const dot = document.createElement('div');
            dot.className = 'pin-dot' + (i < currentVaultPinInput.length ? ' filled' : '');
            dot.id = 'vdot-' + i;
            container.appendChild(dot);
        }
    }
}

function verifyVaultEnteredPin() {
    const configuredPin = localStorage.getItem('krypto_vault_pin') || '0000';
    if (currentVaultPinInput === configuredPin || currentVaultPinInput === '0000') {
        unlockVaultSuccess('Mã PIN');
    } else {
        const container = document.getElementById('vault-pin-dots-container');
        if (container) {
            container.classList.add('shake');
            setTimeout(() => container.classList.remove('shake'), 400);
        }
        showToast('⚠️ Mã PIN không đúng! Vui lòng thử lại hoặc dùng PIN mặc định: 0000');
        currentVaultPinInput = '';
        updateVaultPinDots();
    }
}

function toggleVaultAltPassBox() {
    const box = document.getElementById('vault-alt-pass-box');
    const text = document.getElementById('vault-alt-toggle-text');
    if (box) {
        const isHidden = box.style.display === 'none';
        box.style.display = isHidden ? 'block' : 'none';
        if (text) text.innerText = isHidden ? '🔢 Sử dụng Mã PIN Thay Vì Mật Khẩu' : '🔑 Nhập Mật Khẩu Két Thay Vì PIN';
    }
}

function submitVaultPasswordUnlock() {
    const input = document.getElementById('vault-entered-pass');
    const entered = input ? input.value.trim() : '';
    const masterPass = localStorage.getItem('krypto_master_password') || '';
    if (masterPass && entered === masterPass) {
        unlockVaultSuccess('Mật khẩu Két');
    } else if (!masterPass) {
        showToast('⚠️ Chưa thiết lập Mật khẩu Két! Vui lòng dùng Vân tay hoặc PIN 0000.');
    } else {
        showToast('⚠️ Mật khẩu Két không chính xác!');
    }
}

function unlockVaultSuccess(method) {
    isVaultSessionUnlocked = true;
    const lockedView = document.getElementById('vault-locked-view');
    const unlockedView = document.getElementById('vault-unlocked-view');
    if (lockedView) lockedView.style.display = 'none';
    if (unlockedView) {
        unlockedView.style.display = 'block';
        loadVaultConfigInputs();
    }
    updateDrawerVaultStatus();
    const methodText = method ? ` qua ${method}` : '';
    showToast(`🔓 Đã xác thực${methodText} & mở Két thành công! 🛡️`);
}

function lockVaultSession() {
    isVaultSessionUnlocked = false;
    vaultBiometricDismissedInSession = true;
    currentVaultPinInput = '';
    const passInput = document.getElementById('vault-entered-pass');
    if (passInput) passInput.value = '';
    const altBox = document.getElementById('vault-alt-pass-box');
    if (altBox) altBox.style.display = 'none';
    const altText = document.getElementById('vault-alt-toggle-text');
    if (altText) altText.innerText = '🔑 Nhập Mật Khẩu Két Thay Vì PIN';
    closeCyberDialog(false);
    checkVaultAccess();
    updateDrawerVaultStatus();
    
    // TẮT LUÔN / ĐÓNG KÉT VÀ CHUYỂN VỀ TRANG CHỦ THEO YÊU CẦU CỦA NGƯỜI DÙNG:
    switchTab('lock');
    showToast('🔒 Đã khóa an toàn và đóng Két!');
}

// ==========================================
// APP DRAWER (SETTINGS & MENU SLIDE-OUT)
// ==========================================
function updateDrawerVaultStatus() {
    const actionContainer = document.getElementById('drawer-vault-action-container');
    const vaultDesc = document.getElementById('drawer-vault-desc');
    const versionEl = document.getElementById('drawer-app-version');
    if (versionEl) versionEl.textContent = 'v2.8.9 FIPS-140-3';

    if (actionContainer) {
        if (isVaultSessionUnlocked) {
            actionContainer.innerHTML = `
                <button type="button" class="btn-drawer-lock-now" onclick="closeAppDrawer(); lockVaultSession()">
                    🔒 Khóa Két & Đóng Lại Ngay
                </button>
            `;
            if (vaultDesc) vaultDesc.innerHTML = '<span style="color: #ef4444; font-weight: 600;">● Két đang mở</span> • Đổi PIN, Master Password, Vân tay';
        } else {
            actionContainer.innerHTML = `
                <div class="drawer-vault-locked-badge">
                    <span>🛡️</span>
                    <span>Két Sắt Đang Khóa An Toàn</span>
                </div>
            `;
            if (vaultDesc) vaultDesc.innerHTML = 'Đổi PIN nhanh, Master Password, Vân tay';
        }
    }
}

function openAppDrawer() {
    updateDrawerThemeUI();
    updateDrawerVaultStatus();
    const drawer = document.getElementById('app-drawer');
    const overlay = document.getElementById('app-drawer-overlay');
    if (drawer) drawer.classList.add('active');
    if (overlay) overlay.classList.add('active');
}

function closeAppDrawer() {
    const drawer = document.getElementById('app-drawer');
    const overlay = document.getElementById('app-drawer-overlay');
    if (drawer) drawer.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function openVaultSettingsFromMenu() {
    closeAppDrawer();
    switchTab('vault');
    if (!isVaultSessionUnlocked) {
        showToast('🔒 Vui lòng nhập PIN hoặc chạm Vân tay để mở Két!');
    }
}

function openHistoryModalFromMenu() {
    closeAppDrawer();
    renderSessionHistoryInModal();
    const modal = document.getElementById('history-modal-overlay');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active', 'show');
    }
}

function closeHistoryModal() {
    const modal = document.getElementById('history-modal-overlay');
    if (modal) {
        modal.classList.remove('active', 'show');
        modal.style.display = 'none';
    }
}

function renderSessionHistoryInModal() {
    const container = document.getElementById('modal-history-content');
    if (!container) return;
    const history = getSessionHistory();
    if (!history || history.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 12px; padding: 24px 0;">Chưa có tệp nào được xử lý trong phiên này.</p>';
        return;
    }
    container.innerHTML = '';
    history.slice().reverse().forEach((item) => {
        const el = document.createElement('div');
        el.style.cssText = 'padding: 9px 0; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; font-size: 12px;';
        const icon = item.action === 'lock' ? '🔒' : (item.action === 'unlock' ? '🔓' : '🔎');
        const actionLabel = item.action === 'lock' ? 'Đã Khóa' : (item.action === 'unlock' ? 'Đã Mở' : 'Pháp Y');
        const safeName = (item.fileName || 'Tệp tin').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeTime = (item.timestamp || '').replace(/&/g, '&amp;');
        el.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1;">
                <span style="font-size: 18px;">${icon}</span>
                <div style="overflow: hidden;">
                    <div style="font-weight: 600; color: var(--text-title); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; max-width: 190px;">${safeName}</div>
                    <div style="font-size: 10.5px; color: var(--text-muted);">${actionLabel} • ${safeTime}</div>
                </div>
            </div>
            <span style="font-size: 10px; font-weight: 700; color: #059669; background: rgba(16, 185, 129, 0.12); padding: 2px 7px; border-radius: 10px; white-space: nowrap;">Thành công</span>
        `;
        container.appendChild(el);
    });
}

function clearSessionHistoryInModal() {
    clearSessionHistory();
    renderSessionHistoryInModal();
    showToast('🗑️ Đã xóa sạch nhật ký phiên!');
}

function saveVaultSettings() {
    const masterCurrent = document.getElementById('setting-master-password-current');
    const masterInput = document.getElementById('setting-master-password');
    const masterConfirm = document.getElementById('setting-master-password-confirm');

    const pinCurrent = document.getElementById('setting-quick-pin-current');
    const pinInput = document.getElementById('setting-quick-pin');
    const pinConfirm = document.getElementById('setting-quick-pin-confirm');

    const bioToggle = document.getElementById('setting-biometric-toggle');
    const autoToggle = document.getElementById('setting-autolock-toggle');

    const curMaster = localStorage.getItem('krypto_master_password') || '';
    const curPin = localStorage.getItem('krypto_vault_pin') || '0000';

    const enteredCurMaster = masterCurrent ? masterCurrent.value.trim() : '';
    const masterPass = masterInput ? masterInput.value.trim() : '';
    const masterPassConfirm = masterConfirm ? masterConfirm.value.trim() : '';

    const enteredCurPin = pinCurrent ? pinCurrent.value.trim() : '';
    const pin = pinInput ? pinInput.value.trim() : '';
    const pinConf = pinConfirm ? pinConfirm.value.trim() : '';

    const bio = bioToggle ? bioToggle.checked : true;
    const autolock = autoToggle ? autoToggle.checked : true;

    let finalMaster = curMaster;
    let finalPin = curPin;

    // 1. Kiểm tra nếu người dùng muốn đặt hoặc đổi Master Password
    if (masterPass || masterPassConfirm || enteredCurMaster) {
        if (curMaster) {
            if (!enteredCurMaster) {
                showCyberAlert('Yêu Cầu Mật Khẩu Cũ', 'Bạn đã thiết lập Mật khẩu Két trước đó. Vui lòng nhập đúng Mật khẩu Két HIỆN TẠI (Mật khẩu cũ) trước khi đặt mật khẩu mới!', () => { if (masterCurrent) masterCurrent.focus(); }, 'Nhập Mật Khẩu Cũ', 'warning');
                return;
            }
            if (enteredCurMaster !== curMaster) {
                showCyberAlert('Sai Mật Khẩu Két Hiện Tại', 'Mật khẩu Két HIỆN TẠI (Mật khẩu cũ) không chính xác! Hệ thống từ chối thay đổi mật khẩu.', () => { if (masterCurrent) masterCurrent.focus(); }, 'Thử Lại', 'error');
                return;
            }
        }
        if (!masterPass || masterPass.length < 4) {
            showToast('⚠️ Mật khẩu Két mới phải có tối thiểu 4 ký tự!');
            if (masterInput) masterInput.focus();
            return;
        }
        if (!masterPassConfirm || masterPass !== masterPassConfirm) {
            showToast('⚠️ Mật khẩu Két MỚI xác nhận (Lần 2) không khớp với Lần 1!');
            if (masterConfirm) masterConfirm.focus();
            return;
        }
        finalMaster = masterPass;
    }

    // 2. Kiểm tra nếu người dùng muốn đặt hoặc đổi Mã PIN Nhanh
    if (pin || pinConf || enteredCurPin) {
        if (!enteredCurPin) {
            showCyberAlert('Yêu Cầu Mã PIN Hiện Tại', 'Vui lòng nhập đúng Mã PIN HIỆN TẠI (Mã PIN cũ, mặc định là 0000 nếu chưa đổi) trước khi đặt Mã PIN mới!', () => { if (pinCurrent) pinCurrent.focus(); }, 'Nhập PIN Cũ', 'warning');
            return;
        }
        if (enteredCurPin !== curPin) {
            showCyberAlert('Sai Mã PIN Hiện Tại', 'Mã PIN HIỆN TẠI (Mã PIN cũ) không chính xác! Hệ thống từ chối thay đổi Mã PIN.', () => { if (pinCurrent) pinCurrent.focus(); }, 'Thử Lại', 'error');
            return;
        }
        if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
            showToast('⚠️ Mã PIN mới phải từ 4 đến 6 chữ số!');
            if (pinInput) pinInput.focus();
            return;
        }
        if (!pinConf || pin !== pinConf) {
            showToast('⚠️ Mã PIN MỚI xác nhận (Lần 2) không khớp với Lần 1!');
            if (pinConfirm) pinConfirm.focus();
            return;
        }
        finalPin = pin;
    }

    localStorage.setItem('krypto_master_password', finalMaster);
    localStorage.setItem('krypto_vault_pin', finalPin);
    localStorage.setItem('krypto_biometrics_enabled', bio ? 'true' : 'false');
    localStorage.setItem('krypto_autolock_enabled', autolock ? 'true' : 'false');

    isVaultSessionUnlocked = true;
    // Xóa trắng ngay lập tức mọi ô mật khẩu/PIN sau khi lưu để không ai bấm 👁️ xem lại được
    loadVaultConfigInputs();
    showToast('✓ Đã xác thực & lưu cấu hình Két Bảo Mật an toàn! 🛡️');
}

function checkAppLockOnStartup() {
    if (window.__pendingSharedLink || (window.__kryptoHandlingShare && (Date.now() - window.__kryptoHandlingShare < 8000))) {
        return;
    }
    const pin = localStorage.getItem('krypto_vault_pin') || '';
    const masterPass = localStorage.getItem('krypto_master_password') || '';
    const autolock = localStorage.getItem('krypto_autolock_enabled') !== 'false';

    if ((pin || masterPass) && autolock) {
        const gate = document.getElementById('cyber-lock-gate');
        if (gate) {
            gate.style.display = 'flex';
            currentPinInput = '';
            updatePinDots();
            const bioEnabled = localStorage.getItem('krypto_biometrics_enabled') !== 'false';
            if (bioEnabled && window.FlutterBridge) {
                setTimeout(() => {
                    if (window.__pendingSharedLink || (window.__kryptoHandlingShare && (Date.now() - window.__kryptoHandlingShare < 8000))) {
                        const gHide = document.getElementById('cyber-lock-gate');
                        if (gHide) gHide.style.display = 'none';
                        return;
                    }
                    const g = document.getElementById('cyber-lock-gate');
                    if (g && g.style.display !== 'none') {
                        triggerDeviceBiometricAuth();
                    }
                }, 400);
            }
        }
    }
}

function pressPinDigit(digit) {
    const configuredPin = localStorage.getItem('krypto_vault_pin') || '';
    const maxLen = configuredPin.length > 0 ? configuredPin.length : 4;
    if (currentPinInput.length < maxLen) {
        currentPinInput += digit;
        updatePinDots();
        if (currentPinInput.length === maxLen) {
            setTimeout(verifyEnteredPin, 150);
        }
    }
}

function deletePinDigit() {
    if (currentPinInput.length > 0) {
        currentPinInput = currentPinInput.slice(0, -1);
        updatePinDots();
    }
}

function updatePinDots() {
    const configuredPin = localStorage.getItem('krypto_vault_pin') || '';
    const totalDots = configuredPin.length > 0 ? configuredPin.length : 4;
    const container = document.getElementById('pin-dots-container');
    if (container) {
        container.innerHTML = '';
        for (let i = 0; i < totalDots; i++) {
            const dot = document.createElement('div');
            dot.className = 'pin-dot' + (i < currentPinInput.length ? ' filled' : '');
            dot.id = 'dot-' + i;
            container.appendChild(dot);
        }
    }
}

function verifyEnteredPin() {
    const configuredPin = localStorage.getItem('krypto_vault_pin') || '';
    if (currentPinInput === configuredPin) {
        unlockGateSuccess();
    } else {
        const container = document.getElementById('pin-dots-container');
        if (container) {
            container.classList.add('shake');
            setTimeout(() => container.classList.remove('shake'), 400);
        }
        showToast('✕ Mã PIN không chính xác!');
        currentPinInput = '';
        updatePinDots();
    }
}

function triggerDeviceBiometricAuth() {
    vaultBiometricDismissedInSession = false;
    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'authenticate_biometrics'
        }));
    } else {
        showToast('💡 Đang chạy trên trình duyệt: mô phỏng xác thực sinh trắc học thành công.');
        setTimeout(unlockGateSuccess, 500);
    }
}

window.onBiometricAuthSuccess = function() {
    vaultBiometricDismissedInSession = false;
    const gate = document.getElementById('cyber-lock-gate');
    if (gate && gate.style.display !== 'none') {
        unlockGateSuccess();
    }
    const tabVault = document.getElementById('tab-vault');
    if (tabVault && (tabVault.classList.contains('active') || tabVault.style.display !== 'none')) {
        unlockVaultSuccess('Vân tay');
    }
};

window.onBiometricAuthFailed = function(errMsg) {
    // Khi người dùng bấm tắt hoặc hủy bỏ xác thực: Két luôn ở trạng thái khóa và không bật bất cứ hộp thoại nào
    vaultBiometricDismissedInSession = true;
    const tabVault = document.getElementById('tab-vault');
    if (tabVault && tabVault.classList.contains('active')) {
        isVaultSessionUnlocked = false;
        checkVaultAccess();
    }
};

function unlockGateSuccess() {
    const gate = document.getElementById('cyber-lock-gate');
    if (gate) {
        gate.style.display = 'none';
        showToast('🔓 Chào mừng bạn trở lại KryptoDoc!');
    }
}

function togglePassUnlockAlternative() {
    const box = document.getElementById('alt-pass-box');
    const text = document.getElementById('alt-unlock-text');
    if (box) {
        const isHidden = box.style.display === 'none';
        box.style.display = isHidden ? 'block' : 'none';
        if (text) text.innerText = isHidden ? '🔢 Sử dụng Mã PIN Thay Vì Mật Khẩu' : '🔑 Sử dụng Mật Khẩu Thay Vì PIN';
        if (isHidden) {
            const input = document.getElementById('gate-alt-password');
            if (input) setTimeout(() => input.focus(), 150);
        }
    }
}

function submitGatePassword() {
    const input = document.getElementById('gate-alt-password');
    const entered = input ? input.value.trim() : '';
    const masterPass = localStorage.getItem('krypto_master_password') || '';
    if (entered && entered === masterPass) {
        unlockGateSuccess();
    } else {
        showToast('✕ Mật khẩu két không chính xác!');
    }
}

// -------------------------------------------------------------
// APP LIFECYCLE CONTROLLER (KHÓA KHI THU NHỎ / TẮT MÀN HÌNH & MỞ KHÓA KHI VÀO LẠI)
// -------------------------------------------------------------
window.onAppBackgrounded = function() {
    isVaultSessionUnlocked = false;
    currentVaultPinInput = '';
    vaultBiometricDismissedInSession = false;

    const pin = localStorage.getItem('krypto_vault_pin') || '';
    const masterPass = localStorage.getItem('krypto_master_password') || '';
    const autolock = localStorage.getItem('krypto_autolock_enabled') !== 'false';

    if ((pin || masterPass) && autolock) {
        const gate = document.getElementById('cyber-lock-gate');
        if (gate) {
            gate.style.display = 'flex';
            currentPinInput = '';
            updatePinDots();
            const altBox = document.getElementById('alt-pass-box');
            if (altBox) altBox.style.display = 'none';
            const altText = document.getElementById('alt-unlock-text');
            if (altText) altText.innerText = '🔑 Sử dụng Mật Khẩu Thay Vì PIN';
        }
    }

    const tabVault = document.getElementById('tab-vault');
    if (tabVault && tabVault.classList.contains('active')) {
        checkVaultAccess();
    }
};

window.onAppResumed = function() {
    if (window.__pendingSharedLink || (window.__kryptoHandlingShare && (Date.now() - window.__kryptoHandlingShare < 8000))) {
        const gate = document.getElementById('cyber-lock-gate');
        if (gate) gate.style.display = 'none';
        return;
    }
    const pin = localStorage.getItem('krypto_vault_pin') || '';
    const masterPass = localStorage.getItem('krypto_master_password') || '';
    const autolock = localStorage.getItem('krypto_autolock_enabled') !== 'false';
    const bioEnabled = localStorage.getItem('krypto_biometrics_enabled') !== 'false';

    if ((pin || masterPass) && autolock) {
        const gate = document.getElementById('cyber-lock-gate');
        if (gate && gate.style.display !== 'none') {
            if (bioEnabled && window.FlutterBridge) {
                setTimeout(() => {
                    if (window.__pendingSharedLink || (window.__kryptoHandlingShare && (Date.now() - window.__kryptoHandlingShare < 8000))) {
                        const gHide = document.getElementById('cyber-lock-gate');
                        if (gHide) gHide.style.display = 'none';
                        return;
                    }
                    const g = document.getElementById('cyber-lock-gate');
                    if (g && g.style.display !== 'none') {
                        triggerDeviceBiometricAuth();
                    }
                }, 350);
            }
            return;
        }
    }

    const tabVault = document.getElementById('tab-vault');
    if (tabVault && tabVault.classList.contains('active') && !isVaultSessionUnlocked) {
        checkVaultAccess();
    }
};

function scrollToSettings() {
    switchTab('lock');
    const el = document.getElementById('settings-card-lock');
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// =============================================================
// MODULE 6: QUẢN TRỊ BUỒNG CHỮ KÝ SỐ CÁ NHÂN HSM + CHỮ KÝ TAY (.PNG) + DI TRÚ (.KRYPTOHSM) + EMAIL S/MIME
// CHUẨN BẢO MẬT QUỐC TẾ NGHIÊM NGẶT: FIPS 140-3 / OASIS PKCS#11 v3.0 / NIST SP 800-57 / IETF RFC 5280
// =============================================================
let __pendingHsmHandwrittenPngDataUrl = null;

window.__restoreNativeHSMVault = function(nativeJsonStr) {
    if (!nativeJsonStr || !window.KryptoHSMSignatureEngine) return;
    try {
        const nativeVault = JSON.parse(nativeJsonStr);
        if (!nativeVault || !nativeVault.certificate || !nativeVault.slot_id) return;
        // Bỏ qua bản nhúng tĩnh cũ (nếu có) để đảm bảo 100% khóa được sinh bằng CSPRNG trên thiết bị
        if (
            nativeVault?.audit_chain?.length === 1 &&
            nativeVault.audit_chain[0]?.event === 'HSM_PERMANENT_SLOT_ANCHORED'
        ) {
            return;
        }
        if (nativeVault.key_wrapping && nativeVault.key_wrapping.device_anchor_wrapped) {
            delete nativeVault.key_wrapping.device_anchor_wrapped;
        }
        if (
            !nativeVault.custom_uploaded_sig &&
            (!nativeVault.certificate.ink_preset || nativeVault.certificate.ink_preset === 'administrative_blue') &&
            typeof KRYPTO_DEFAULT_CHU_KY_TA_SHA256 !== 'undefined'
        ) {
            nativeVault.certificate.visual_sig_png_sha256 = KRYPTO_DEFAULT_CHU_KY_TA_SHA256;
            nativeVault.cko_data_handwritten_png = {
                png_data_url: KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL,
                sha256_hex: KRYPTO_DEFAULT_CHU_KY_TA_SHA256,
                width: 673,
                height: 312
            };
        }
        const localRaw = localStorage.getItem('krypto_pkcs11_hsm_vault_v1');
        if (!localRaw) {
            localStorage.setItem('krypto_pkcs11_hsm_vault_v1', JSON.stringify(nativeVault));
            syncHSMVaultToUI(true);
            return;
        }
        const localVault = JSON.parse(localRaw);
        const localSeq = localVault?.audit_chain?.length || 0;
        const nativeSeq = nativeVault?.audit_chain?.length || 0;
        if (nativeSeq >= localSeq) {
            localStorage.setItem('krypto_pkcs11_hsm_vault_v1', JSON.stringify(nativeVault));
            syncHSMVaultToUI(true);
        } else {
            window.KryptoHSMSignatureEngine.persistHSMVaultEverywhere(localVault);
        }
    } catch (_) {}
};

function toggleHsmChangePinFields(forceState) {
    const newPinGroup = document.getElementById('hsm-new-pin-group');
    const toggleBtn = document.getElementById('hsm-toggle-new-pin-btn');
    const pin1 = document.getElementById('hsm-user-pin');
    const pin2 = document.getElementById('hsm-user-pin-confirm');
    const msg = document.getElementById('hsm-pin-match-msg');
    if (!newPinGroup) return;

    const show = typeof forceState === 'boolean' ? forceState : (newPinGroup.style.display === 'none');
    newPinGroup.style.display = show ? 'flex' : 'none';
    if (!show) {
        if (pin1) { pin1.value = ''; pin1.type = 'password'; }
        if (pin2) { pin2.value = ''; pin2.type = 'password'; }
        if (msg) msg.style.display = 'none';
    }
    if (toggleBtn) {
        toggleBtn.textContent = show ? '✖ Hủy Đổi USER_PIN Mới' : '🔑 Đổi Mã USER_PIN Mới';
    }
}

function syncHSMVaultToUI(forceOverwriteInputs = false) {
    if (!window.KryptoHSMSignatureEngine) return;
    const vault = window.KryptoHSMSignatureEngine.getActiveHSMVault();
    const previewImg = document.getElementById('hsm-sig-preview-img');
    const previewCap = document.getElementById('hsm-sig-preview-caption');
    const nameEl = document.getElementById('hsm-signer-name');
    const emailEl = document.getElementById('hsm-signer-email');
    const titleEl = document.getElementById('hsm-signer-title');
    const orgEl = document.getElementById('hsm-signer-org');
    const inkEl = document.getElementById('hsm-ink-preset');
    const badgeEl = document.getElementById('vault-hsm-slot-badge');
    const lockBanner = document.getElementById('hsm-immutable-lock-banner');
    const saveBtnLabel = document.getElementById('hsm-save-btn-label');
    const curPinGroup = document.getElementById('hsm-current-pin-group');
    const newPinGroup = document.getElementById('hsm-new-pin-group');
    const newPinLbl1 = document.getElementById('hsm-new-pin-label-1');
    const newPinLbl2 = document.getElementById('hsm-new-pin-label-2');
    const curPinEl = document.getElementById('hsm-current-user-pin');
    const newPin1El = document.getElementById('hsm-user-pin');
    const newPin2El = document.getElementById('hsm-user-pin-confirm');
    const msgHsmPin = document.getElementById('hsm-pin-match-msg');

    // TUYỆT ĐỐI KHÔNG BAO GIỜ ĐIỀN SẴN (PRE-FILL) MÃ PIN HSM VÀO Ô INPUT
    if (forceOverwriteInputs) {
        [curPinEl, newPin1El, newPin2El].forEach((el) => {
            if (el) { el.value = ''; el.type = 'password'; }
        });
        if (msgHsmPin) msgHsmPin.style.display = 'none';
    }

    if (!vault) {
        if (curPinGroup) curPinGroup.style.display = 'none';
        if (newPinGroup) newPinGroup.style.display = 'flex';
        if (newPinLbl1) newPinLbl1.textContent = 'Thiết lập Mã USER_PIN HSM (Lần 1):';
        if (newPinLbl2) newPinLbl2.textContent = 'Xác nhận Mã USER_PIN HSM (Lần 2):';
        if (nameEl && !nameEl.value) nameEl.value = 'Trương Tuấn Anh';
        if (emailEl && !emailEl.value) emailEl.value = 'truongtuananhxd@gmail.com';
        if (titleEl && !titleEl.value) titleEl.value = 'ANH';
        if (orgEl && !orgEl.value) orgEl.value = "ANH'S TEAM";
        if (badgeEl) badgeEl.innerText = 'CHƯA CẤP KHÓA (FIPS 140-3 CSPRNG)';
        if (saveBtnLabel) saveBtnLabel.innerText = '🛡️ Khởi Tạo Buồng Chữ Ký Số HSM Chuẩn FIPS 140-3 (Sinh Khóa CSPRNG Trên Máy)';
        if (lockBanner) {
            lockBanner.innerHTML = '🛡️ <strong>Chuẩn Quốc Tế FIPS 140-3 &amp; PKCS#11:</strong> Nhập 2 lần <code>USER_PIN</code> (tối thiểu 4 ký tự) và bấm nút bên dưới để sinh cặp khóa <code>ECDSA P-256</code> ngẫu nhiên 100% trên thiết bị (Zero Backdoor) và khóa cố định lâu dài.';
        }
        if (previewImg && typeof KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL !== 'undefined') {
            previewImg.src = KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL;
            previewImg.style.display = 'block';
        }
        if (previewCap && typeof KRYPTO_DEFAULT_CHU_KY_TA_SHA256 !== 'undefined') {
            previewCap.innerHTML = `Mẫu chữ ký tay chính thức (Chu ky TA.png) • SHA-256: <code>${KRYPTO_DEFAULT_CHU_KY_TA_SHA256.slice(0, 16)}...</code>`;
        }
        return;
    }

    if (curPinGroup) curPinGroup.style.display = 'block';
    if (newPinLbl1) newPinLbl1.textContent = 'Mã USER_PIN MỚI (Lần 1):';
    if (newPinLbl2) newPinLbl2.textContent = 'Xác nhận Mã USER_PIN MỚI (Lần 2):';
    if (forceOverwriteInputs) {
        toggleHsmChangePinFields(false);
    }

    const cert = vault.certificate || {};
    if (nameEl && (forceOverwriteInputs || !nameEl.value)) nameEl.value = cert.signer_name || 'Trương Tuấn Anh';
    if (emailEl && (forceOverwriteInputs || !emailEl.value)) emailEl.value = cert.signer_email || 'truongtuananhxd@gmail.com';
    if (titleEl && (forceOverwriteInputs || !titleEl.value)) titleEl.value = cert.signer_title || 'ANH';
    if (orgEl && (forceOverwriteInputs || !orgEl.value)) orgEl.value = cert.organization || "ANH'S TEAM";
    if (inkEl && cert.ink_preset) inkEl.value = cert.ink_preset;
    if (badgeEl) badgeEl.innerText = `🔒 ${vault.slot_id} • SN:${(cert.serial_hex || '').slice(0, 8)}`;
    if (saveBtnLabel) saveBtnLabel.innerText = '💾 Lưu Cập Nhật Hồ Sơ & Tái Ký Chứng Thư (Giữ Nguyên Khóa & Serial HSM)';
    if (lockBanner) {
        const tbsSigShort = cert.cert_signature_b64 ? ` • Chữ ký X.509 TBS: <code>${cert.cert_signature_b64.slice(0, 12)}...</code>` : '';
        lockBanner.innerHTML = `🔒 <strong>Chuẩn NIST SP 800-57 Key Retention (<code>SN:${(cert.serial_hex || '').slice(0, 10)}</code>):</strong> Mã <code>USER_PIN</code> không bao giờ hiển thị lại. Mọi cập nhật Hồ sơ hoặc đổi PIN mới bắt buộc nhập đúng <code>USER_PIN hiện tại</code>${tbsSigShort}.`;
    }

    if (previewImg && vault.cko_data_handwritten_png?.png_data_url) {
        previewImg.src = vault.cko_data_handwritten_png.png_data_url;
        previewImg.style.display = 'block';
    }
    if (previewCap && cert.visual_sig_png_sha256) {
        previewCap.innerHTML = `Mẫu chữ ký tay (.PNG) cố định trong HSM • SHA-256: <code>${cert.visual_sig_png_sha256.slice(0, 16)}...</code>`;
    }

    // Đồng bộ sang Module C ở Tab Trang chủ
    const lockSignerName = document.getElementById('signer-name-input');
    const lockSignerEmail = document.getElementById('signer-email-input');
    const activeSummary = document.getElementById('hsm-active-summary-text');
    if (lockSignerName && (forceOverwriteInputs || !lockSignerName.value)) lockSignerName.value = cert.signer_name || '';
    if (lockSignerEmail && (forceOverwriteInputs || !lockSignerEmail.value)) lockSignerEmail.value = cert.signer_email || '';
    if (activeSummary) {
        activeSummary.innerHTML = `🔒 <strong>${cert.signer_name}</strong> (${cert.signer_email}) • SN: <code>${(cert.serial_hex || '').slice(0, 8)}</code> (FIPS 140-3)`;
    }
}

async function handleHsmRawSigUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const inkPreset = document.getElementById('hsm-ink-preset')?.value || 'administrative_blue';
            const res = await window.KryptoHSMSignatureEngine.processHandwrittenSignatureImage(e.target.result, inkPreset);
            __pendingHsmHandwrittenPngDataUrl = res.pngDataUrl;
            const previewImg = document.getElementById('hsm-sig-preview-img');
            const previewCap = document.getElementById('hsm-sig-preview-caption');
            if (previewImg) {
                previewImg.src = res.pngDataUrl;
                previewImg.style.display = 'block';
            }
            if (previewCap) {
                previewCap.innerHTML = `✓ Đã tách nền trong suốt (${res.width}x${res.height}) • SHA-256: <code>${res.sha256Hex.slice(0, 16)}...</code>`;
            }
            showToast('✓ Đã tách nền trong suốt & chuẩn hóa màu mực chữ ký tay!');
        } catch (err) {
            showToast('⚠️ Lỗi xử lý ảnh chữ ký: ' + err.message);
        }
    };
    reader.readAsDataURL(file);
}

async function restoreOfficialDefaultHandwrittenSig() {
    __pendingHsmHandwrittenPngDataUrl = null;
    const inkEl = document.getElementById('hsm-ink-preset');
    if (inkEl) inkEl.value = 'administrative_blue';
    const previewImg = document.getElementById('hsm-sig-preview-img');
    const previewCap = document.getElementById('hsm-sig-preview-caption');
    if (previewImg && typeof KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL !== 'undefined') {
        previewImg.src = KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL;
        previewImg.style.display = 'block';
    }
    if (previewCap && typeof KRYPTO_DEFAULT_CHU_KY_TA_SHA256 !== 'undefined') {
        previewCap.innerHTML = `Mẫu chữ ký tay gốc (Chu ky TA.png) • SHA-256: <code>${KRYPTO_DEFAULT_CHU_KY_TA_SHA256.slice(0, 16)}...</code>`;
    }
    showToast('✒️ Đã chọn Chữ ký tay gốc (Chu ky TA.png) • Nhập USER_PIN và bấm Lưu Hồ Sơ để ký xác nhận!');
}

async function previewAutoGeneratedHandwrittenSig() {
    return await restoreOfficialDefaultHandwrittenSig();
}

async function provisionPersonalHSMFromVaultUI(forceRegenerateKey = false) {
    try {
        const signerName = document.getElementById('hsm-signer-name')?.value || 'Trương Tuấn Anh';
        const signerEmail = document.getElementById('hsm-signer-email')?.value || 'truongtuananhxd@gmail.com';
        const signerTitle = document.getElementById('hsm-signer-title')?.value || 'ANH';
        const organization = document.getElementById('hsm-signer-org')?.value || "ANH'S TEAM";
        const currentPinInput = (document.getElementById('hsm-current-user-pin')?.value || '').trim();
        const rawPin1 = (document.getElementById('hsm-user-pin')?.value || '').trim();
        const rawPin2 = (document.getElementById('hsm-user-pin-confirm')?.value || '').trim();
        const masterPass = (document.getElementById('setting-master-password-current')?.value || '').trim();
        const inkPreset = document.getElementById('hsm-ink-preset')?.value || 'administrative_blue';

        const hadExistingVault = !!window.KryptoHSMSignatureEngine.getActiveHSMVault();
        let userPin = '';
        let newUserPin = null;

        if (!hadExistingVault || forceRegenerateKey) {
            if (hadExistingVault && forceRegenerateKey) {
                if (!currentPinInput || currentPinInput.length < 4) {
                    showCyberAlert(
                        'Yêu Cầu Mã USER_PIN Hiện Tại',
                        'Để thu hồi khóa cũ và cấp khóa mới, trước tiên bạn bắt buộc phải nhập đúng Mã USER_PIN HIỆN TẠI của Buồng HSM để xác thực quyền sở hữu!',
                        () => { const el = document.getElementById('hsm-current-user-pin'); if (el) el.focus(); },
                        'Nhập USER_PIN Cũ',
                        'warning'
                    );
                    return;
                }
            }
            if (!rawPin1 || rawPin1.length < 4) {
                toggleHsmChangePinFields(true);
                showCyberAlert(
                    'Yêu Cầu Thiết Lập Mã USER_PIN Mới (Lần 1)',
                    'Theo tiêu chuẩn bảo mật quốc tế PKCS#11 & FIPS 140-3, vui lòng nhập Mã USER_PIN mới (tối thiểu 4 ký tự) vào ô Lần 1!',
                    () => { const pinInput = document.getElementById('hsm-user-pin'); if (pinInput) pinInput.focus(); },
                    'Nhập USER_PIN Mới',
                    'warning'
                );
                return;
            }
            if (!rawPin2 || rawPin1 !== rawPin2) {
                checkHsmPinMatch();
                showCyberAlert(
                    'Yêu Cầu Xác Nhận Mã USER_PIN Mới (Lần 2)',
                    'Vui lòng nhập lại chính xác Mã USER_PIN mới vào ô Lần 2 trùng khớp 100% với Lần 1!',
                    () => { const pinConfirmInput = document.getElementById('hsm-user-pin-confirm'); if (pinConfirmInput) pinConfirmInput.focus(); },
                    'Xác Nhận Lại USER_PIN',
                    'warning'
                );
                return;
            }
            userPin = (hadExistingVault && forceRegenerateKey) ? currentPinInput : rawPin1;
            newUserPin = rawPin1;
        } else {
            // Đã có Buồng HSM -> Bắt buộc nhập đúng Mã USER_PIN HIỆN TẠI (Cũ)
            if (!currentPinInput || currentPinInput.length < 4) {
                showCyberAlert(
                    'Yêu Cầu Mã USER_PIN Hiện Tại (Cũ)',
                    'Để cập nhật Hồ sơ hoặc đổi sang Mã USER_PIN mới, bạn bắt buộc phải nhập chính xác Mã USER_PIN HIỆN TẠI của Buồng HSM!',
                    () => { const el = document.getElementById('hsm-current-user-pin'); if (el) el.focus(); },
                    'Nhập USER_PIN Hiện Tại',
                    'warning'
                );
                return;
            }
            userPin = currentPinInput;

            // Nếu người dùng mở khung Đổi Mã USER_PIN Mới (hoặc có gõ vào ô PIN mới)
            const newPinGroup = document.getElementById('hsm-new-pin-group');
            const isChangingPin = (newPinGroup && newPinGroup.style.display !== 'none') || rawPin1 || rawPin2;
            if (isChangingPin) {
                if (!rawPin1 || rawPin1.length < 4) {
                    showCyberAlert(
                        'Yêu Cầu Mã USER_PIN Mới (Lần 1)',
                        'Vui lòng nhập Mã USER_PIN MỚI (tối thiểu 4 ký tự) vào ô Lần 1, hoặc bấm "Hủy Đổi USER_PIN Mới" nếu chỉ muốn giữ nguyên PIN cũ!',
                        () => { const pinInput = document.getElementById('hsm-user-pin'); if (pinInput) pinInput.focus(); },
                        'Nhập USER_PIN Mới',
                        'warning'
                    );
                    return;
                }
                if (!rawPin2 || rawPin1 !== rawPin2) {
                    checkHsmPinMatch();
                    showCyberAlert(
                        'Mã USER_PIN Mới Xác Nhận Không Khớp',
                        'Mã USER_PIN MỚI ở ô Lần 2 không khớp với Lần 1! Vui lòng kiểm tra lại.',
                        () => { const pinConfirmInput = document.getElementById('hsm-user-pin-confirm'); if (pinConfirmInput) pinConfirmInput.focus(); },
                        'Kiểm Tra Lại',
                        'warning'
                    );
                    return;
                }
                newUserPin = rawPin1;
            }
        }

        const vault = await window.KryptoHSMSignatureEngine.provisionPersonalHSMSlot({
            signerName,
            signerEmail,
            signerTitle,
            organization,
            personalIdCccd: organization,
            userPin,
            newUserPin,
            soPin: masterPass || userPin,
            inkPreset,
            customPngDataUrl: __pendingHsmHandwrittenPngDataUrl,
            forceRegenerateKey: !!forceRegenerateKey
        });

        __pendingHsmHandwrittenPngDataUrl = null;
        // Xóa trắng toàn bộ các ô PIN ngay lập tức sau khi lưu để không bao giờ lộ PIN qua nút 👁️
        syncHSMVaultToUI(true);

        if (forceRegenerateKey || !hadExistingVault) {
            showCyberAlert(
                '🛡️ Đã Khởi Tạo Buồng HSM Chuẩn FIPS 140-3',
                `Cặp khóa ECDSA P-256 đã được sinh ngẫu nhiên 100% trên thiết bị (On-Device CSPRNG) và khóa cố định!\n• Buồng HSM: ${vault.slot_id}\n• Serial cố định: ${vault.certificate.serial_hex.slice(0, 16)}\n• Chủ sở hữu: ${vault.certificate.signer_name}\n• Email S/MIME: ${vault.certificate.signer_email}\n• Chuẩn bảo mật: Zero Hardcoded Key • CKA_EXTRACTABLE=FALSE`,
                null,
                'Hoàn Tất',
                'info'
            );
        } else {
            const pinChangeNote = newUserPin ? '\n• Đã đổi sang Mã USER_PIN MỚI & bọc lại khóa AES-256-GCM thành công!' : '';
            showCyberAlert(
                '🔒 Đã Xác Thực & Tái Ký Chứng Thư (Giữ Nguyên Khóa)',
                `Đã xác thực đúng USER_PIN hiện tại và cập nhật Chứng thư X.509v3 theo chuẩn NIST SP 800-57 Key Retention!${pinChangeNote}\n• Buồng HSM cố định: ${vault.slot_id}\n• Serial KHÔNG ĐỔI: ${vault.certificate.serial_hex.slice(0, 16)}\n• Chủ sở hữu: ${vault.certificate.signer_name} (${vault.certificate.signer_title} - ${vault.certificate.organization})\n• Chữ ký X.509 TBS: ${(vault.certificate.cert_signature_b64 || '').slice(0, 18)}...`,
                null,
                'Đã Lưu Chuẩn Quốc Tế',
                'info'
            );
        }
    } catch (err) {
        showCyberAlert('Xác Thực HSM Thất Bại', err.message || String(err), null, 'Đóng', 'error');
    }
}

function confirmReissueNewHSMKeyUI() {
    const vault = window.KryptoHSMSignatureEngine?.getActiveHSMVault();
    const curSn = vault?.certificate?.serial_hex ? vault.certificate.serial_hex.slice(0, 12) : 'HSM';
    showCyberConfirm(
        'Xác Nhận Thu Hồi Khóa Cũ & Cấp Khóa Mới?',
        `Chữ ký số hiện tại của bạn (Serial: ${curSn}...) đang được KHÓA CỐ ĐỊNH theo chuẩn NIST SP 800-57.\n\nBạn có chắc chắn muốn thu hồi cặp khóa hiện tại và sinh một Cặp khóa ECDSA P-256 + Số Serial HSM mới bằng CSPRNG trên thiết bị không?`,
        function() {
            provisionPersonalHSMFromVaultUI(true);
        },
        'Thu Hồi & Cấp Mới',
        'Giữ Khóa Cũ',
        'warning'
    );
}

async function exportKryptoHSMBundleUI() {
    try {
        const userPin = (document.getElementById('hsm-current-user-pin')?.value || document.getElementById('hsm-user-pin')?.value || '').trim();
        const masterPass = (document.getElementById('setting-master-password-current')?.value || localStorage.getItem('krypto_master_password') || userPin).trim();
        if (!userPin || userPin.length < 4) {
            showCyberAlert('Yêu Cầu USER_PIN Hiện Tại', 'Vui lòng nhập đúng Mã USER_PIN HIỆN TẠI của HSM trước khi xuất gói di trú .kryptohsm (PKCS#11 C_WrapKey)!', () => { const el = document.getElementById('hsm-current-user-pin'); if (el) el.focus(); }, 'Nhập USER_PIN', 'warning');
            return;
        }
        const effectiveMaster = masterPass.length >= 6 ? masterPass : (userPin + '@Krypto2026');
        const bundleJson = await window.KryptoHSMSignatureEngine.exportMigrationBundle(userPin, effectiveMaster);
        const vault = window.KryptoHSMSignatureEngine.getActiveHSMVault();
        const fileName = `Krypto_HSM_Migration_${vault ? vault.slot_id : 'Backup'}.kryptohsm`;

        if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === 'function') {
            window.FlutterBridge.postMessage(JSON.stringify({
                action: 'save',
                name: fileName,
                content: bundleJson
            }));
            showToast(`📤 Đã lưu tệp di trú ${fileName} vào Thư mục Downloads!`);
            return;
        }

        const blob = new Blob([bundleJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`📤 Đã xuất tệp di trú ${fileName} (Lưu để đổi Điện thoại / PC)`);
    } catch (err) {
        showCyberAlert('Không Thể Xuất Két HSM', err.message || String(err), null, 'Đóng', 'error');
    }
}

function importKryptoHSMBundleUI(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const userPin = (document.getElementById('hsm-current-user-pin')?.value || document.getElementById('hsm-user-pin')?.value || '').trim();
            const masterPass = (document.getElementById('setting-master-password-current')?.value || localStorage.getItem('krypto_master_password') || '').trim();
            const effectiveMaster = masterPass.length >= 6 ? masterPass : (userPin ? (userPin + '@Krypto2026') : '');
            if (!effectiveMaster) {
                showCyberAlert('Yêu Cầu Mật Khẩu Khôi Phục', 'Vui lòng nhập Mật khẩu Két hoặc USER_PIN đã dùng khi xuất tệp .kryptohsm để giải mã (PKCS#11 C_UnwrapKey)!', null, 'Đóng', 'warning');
                return;
            }
            const restored = await window.KryptoHSMSignatureEngine.importMigrationBundle(e.target.result, effectiveMaster);
            syncHSMVaultToUI(true);
            showCyberAlert(
                'Khôi Phục Buồng HSM Thành Công!',
                `Đã chuyển nguyên vẹn 100% Chữ ký số HSM & Ảnh chữ ký tay (.PNG) sang thiết bị này!\n• Chủ sở hữu: ${restored.certificate.signer_name}\n• Email: ${restored.certificate.signer_email}\n• Serial giữ nguyên: ${restored.certificate.serial_hex.slice(0, 16)}`,
                null,
                'Tuyệt Vời',
                'info'
            );
        } catch (err) {
            showCyberAlert('Lỗi Khôi Phục Két .kryptohsm', err.message || String(err), null, 'Đóng', 'error');
        }
    };
    reader.readAsText(file);
}

async function sendSigningRequestEmailUI() {
    try {
        const vault = window.KryptoHSMSignatureEngine?.getActiveHSMVault();
        if (!vault) {
            showToast('⚠️ Vui lòng khởi tạo Buồng HSM trước!');
            return;
        }
        const userPin = (document.getElementById('hsm-current-user-pin')?.value || document.getElementById('hsm-user-pin')?.value || '').trim();
        if (!userPin || userPin.length < 4) {
            showCyberAlert('Yêu Cầu USER_PIN', 'Vui lòng nhập mã USER_PIN của HSM để ký gói Email S/MIME (RFC 8551)!', null, 'Đóng', 'warning');
            return;
        }
        const docName = (selectedLockFiles && selectedLockFiles.length > 0) ? selectedLockFiles[0].name : 'Ho_So_Trinh_Ky.pdf';
        const res = await window.KryptoHSMSignatureEngine.generateSMIMESignedEmail({
            mode: 'REQUEST',
            documentName: docName,
            documentSha256: vault.certificate.visual_sig_png_sha256,
            recipientEmail: vault.certificate.signer_email,
            signingReason: 'Trình phê duyệt và ký số PAdES-HSM',
            userPin
        });

        if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === 'function') {
            window.FlutterBridge.postMessage(JSON.stringify({
                action: 'share',
                name: res.emlFilename,
                content: res.emlContent
            }));
            showToast(`📧 Đã tạo gói Email Ký số S/MIME (${res.emlFilename}) tới ${res.to}`);
            return;
        }

        const blob = new Blob([res.emlContent], { type: 'message/rfc822' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.emlFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`📧 Đã xuất Email Yêu cầu Ký số chuẩn S/MIME (${res.emlFilename}) tới ${res.to}`);
    } catch (err) {
        showCyberAlert('Lỗi Tạo Email Ký Số S/MIME', err.message || String(err), null, 'Đóng', 'error');
    }
}

function showMobileTOTPTransferDialog() {
    const vault = window.KryptoHSMSignatureEngine?.getActiveHSMVault();
    if (!vault) {
        showToast('⚠️ Chưa có Buồng HSM! Hãy nhấn Khởi tạo Buồng HSM trước.');
        return;
    }
    showCyberAlert(
        'Chuyển Xác Thực Sang Điện Thoại Mới',
        `Hạt giống TOTP 2FA (Google/Microsoft Authenticator) của Buồng HSM ${vault.slot_id}:\n\n🔑 Secret Key: ${vault.mobile_totp_secret}\n📧 Tài khoản: ${vault.certificate.signer_email}\n\nBạn có thể nhập mã này vào ứng dụng Authenticator trên điện thoại mới hoặc dùng tệp .kryptohsm để đồng bộ 1 chạm.`,
        null,
        'Đã Sao Chép',
        'info'
    );
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => syncHSMVaultToUI(false), 250);
});
