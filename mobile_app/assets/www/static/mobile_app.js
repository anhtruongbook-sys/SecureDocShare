// mobile_app.js: Động cơ Mật Mã Học Cục Bộ Offline 100% trên Điện Thoại (Web Crypto API)

// ==========================================
// CHỦ ĐỀ GIAO DIỆN (NỀN TỐI LÀ MẶC ĐỊNH)
// ==========================================
function initTheme() {
    try {
        const saved = localStorage.getItem('sds_theme') || 'dark';
        if (saved === 'light') {
            document.body.classList.remove('dark-mode');
            document.body.classList.add('light-mode');
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerText = '☀️';
        } else {
            document.body.classList.remove('light-mode');
            document.body.classList.add('dark-mode');
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerText = '🌙';
        }
    } catch (_) {}
}

function toggleTheme() {
    try {
        if (document.body.classList.contains('light-mode')) {
            document.body.classList.remove('light-mode');
            document.body.classList.add('dark-mode');
            localStorage.setItem('sds_theme', 'dark');
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerText = '🌙';
        } else {
            document.body.classList.remove('dark-mode');
            document.body.classList.add('light-mode');
            localStorage.setItem('sds_theme', 'light');
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerText = '☀️';
        }
    } catch (_) {}
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderSessionHistory();
});
initTheme();

let selectedLockFiles = [];
let selectedUnlockFile = null;
let currentProtectionLevel = "open_password";
let currentPackagingMode = "native";

function selectPackagingMode(mode, el) {
    currentPackagingMode = mode;
    document.querySelectorAll('.packaging-card').forEach(c => c.classList.remove('active'));
    if (el) {
        el.classList.add('active');
        const radio = el.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
    }
    if (mode === 'zip') {
        showToast('Đã chọn: Nén .ZIP mã hóa mật khẩu AES-256 (Chuẩn WinRAR, 7-Zip, ZArchiver) 📦');
    } else {
        showToast('Đã chọn: Định dạng gốc (Word, Excel, PDF giữ nguyên đuôi file) 🔒');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const badge = document.getElementById('krypto-logo-badge');
    if (tabName === 'lock') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('tab-lock').classList.add('active');
        if (badge) {
            badge.classList.remove('state-unlocked');
            badge.classList.add('state-locked');
        }
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('tab-unlock').classList.add('active');
        if (badge) {
            badge.classList.remove('state-locked');
            badge.classList.add('state-unlocked');
        }
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
    cardEl.classList.add('active');

    const pwdLabel = document.getElementById('password-label');
    const passSubnote = document.getElementById('pass-subnote');

    if (levelVal === 'view_only_restricted') {
        pwdLabel.innerHTML = `BƯỚC 2: MẬT KHẨU QUẢN TRỊ / GỠ KHÓA <span class="required">*</span>`;
        passSubnote.innerHTML = `💡 <strong>Người nhận mở xem trực tiếp không cần mật khẩu</strong>. Mật khẩu này chỉ bạn giữ để gỡ khóa khi cần.`;
        passSubnote.style.color = '#34d399';
    } else {
        pwdLabel.innerHTML = `BƯỚC 2: MẬT KHẨU MỞ TỆP <span class="required">*</span>`;
        passSubnote.innerHTML = `💡 Người nhận <strong>bắt buộc phải nhập đúng mật khẩu này</strong> mới mở được file.`;
        passSubnote.style.color = '#94a3b8';
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

function handleFilesSelected(files, context) {
    if (!files || files.length === 0) return;

    if (context === 'lock') {
        let hasCadOrArchive = false;
        for (let i = 0; i < files.length; i++) {
            selectedLockFiles.push(files[i]);
            const ext = getFileExtension(files[i].name);
            if (['dwg', 'dxf', 'zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
                hasCadOrArchive = true;
            }
        }
        renderFileListLock();
        if (hasCadOrArchive || selectedLockFiles.length > 1) {
            const zipCard = document.getElementById('pkg-card-zip');
            if (zipCard && currentPackagingMode !== 'zip') {
                selectPackagingMode('zip', zipCard);
                showToast('💡 Đã tự động kích hoạt chế độ Nén .ZIP Có Pass để bảo vệ tối ưu! 📦');
            }
        }
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
    if (ext === 'dwg' || ext === 'dxf') {
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
            protocol: 'KryptoDoc Vault AES'
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
    if (selectedLockFiles.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    container.style.display = 'flex';
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

function removeLockFile(idx) {
    selectedLockFiles.splice(idx, 1);
    renderFileListLock();
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
        applyWatermarkPreset('BẢN MẬT HỢP ĐỒNG');
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
        showToast('Đã áp dụng mẫu: 📐 Bản Vẽ CAD .DWG (Nén .ZIP Có Pass Quân Sự AES-256) 🛡️');
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
        showToast('Đã áp dụng mẫu: 💰 Báo Giá / Dự Toán (Mã nhanh + Nén gửi Zalo)');
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
        alert("Vui lòng chọn ít nhất 1 tệp tin cần mã hóa!");
        return;
    }
    const pwd = document.getElementById('lock-password').value;
    if (!pwd) {
        alert("Vui lòng nhập mật khẩu!");
        return;
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
                if (currentPackagingMode === 'zip' || selectedLockFiles.length > 1) {
                    const names = selectedLockFiles.map(f => f.name);
                    const firstName = selectedLockFiles[0].name;
                    const totalBytes = selectedLockFiles.reduce((acc, f) => acc + (f.size || 0), 0);
                    const totalSizeMb = (totalBytes / (1024 * 1024)).toFixed(1);

                    btn.innerText = `Đang nén & đặt pass ZIP (${totalSizeMb} MB)...`;
                    showProcessingModal(
                        'Đang Nén & Đặt Pass ZIP...',
                        `Tổng số: <strong>${selectedLockFiles.length} tệp</strong> (${totalSizeMb} MB)<br>Đang nén và mã hóa mật khẩu AES-256 bằng Zip4j Engine.<br>Vui lòng giữ ứng dụng mở...`
                    );

                    window.FlutterBridge.postMessage(JSON.stringify({
                        action: 'lock_zip_native',
                        name: firstName,
                        names: names,
                        password: pwd,
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

                const enableWatermark = document.getElementById('enable-watermark-checkbox')?.checked || false;
                const watermarkText = enableWatermark ? (document.getElementById('watermark-input')?.value || '') : '';
                const compressPdf = document.getElementById('compress-pdf-checkbox')?.checked !== false;

                window.FlutterBridge.postMessage(JSON.stringify({
                    action: isPdf ? 'lock_pdf_native' : 'lock_file_native',
                    name: file.name,
                    size: file.size,
                    password: pwd,
                    protection_level: currentProtectionLevel,
                    watermark: watermarkText,
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
        alert("Lỗi mã hóa: " + e.message);
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
    let subDesc = "";
    let noteText = "";
    let fileIcon = "📄";
    let iconBg = "#eff6ff";
    let iconColor = "#2563eb";

    if (isPdf) {
        fileIcon = "📄";
        iconBg = "#eff6ff";
        iconColor = "#2563eb";
        subDesc = isViewOnly 
            ? "✓ Tệp PDF Native • Mở xem tự do, CẤM IN, CẤM COPY"
            : "✓ Tệp PDF Native Chuẩn Adobe • Nhập Pass để Mở";
        noteText = `💡 Tệp <strong>${outFileName}</strong> đã được bảo vệ mật khẩu chuẩn quốc tế Adobe ISO 32000. Mở bằng <strong>Adobe Acrobat, Foxit Reader, WPS Office, Samsung PDF hoặc Xiaomi Reader</strong> sẽ tự động yêu cầu nhập đúng mật khẩu để xem toàn bộ nội dung tệp!`;
    } else {
        const ext = outFileName.split('.').pop().toLowerCase();
        if (ext === 'docx' || ext === 'doc') {
            fileIcon = "📝";
            iconBg = "#eff6ff";
            iconColor = "#1d4ed8";
            subDesc = `✓ Tệp Word Native (Chuẩn Microsoft MS-OFFCRYPTO)`;
            noteText = `💡 Tệp <strong>${outFileName}</strong> đã được khóa chuẩn Microsoft Office Native. Mở bằng <strong>Microsoft Word hoặc WPS Office</strong> trên điện thoại sẽ tự động bật hộp thoại yêu cầu mật khẩu để xem toàn bộ tài liệu!`;
        } else if (ext === 'xlsx' || ext === 'xls') {
            fileIcon = "📊";
            iconBg = "#ecfdf5";
            iconColor = "#059669";
            subDesc = `✓ Tệp Excel Native (Chuẩn Microsoft MS-OFFCRYPTO)`;
            noteText = `💡 Tệp <strong>${outFileName}</strong> đã được khóa chuẩn Microsoft Office Native. Mở bằng <strong>Microsoft Excel hoặc WPS Office</strong> trên điện thoại sẽ tự động bật hộp thoại yêu cầu mật khẩu để xem toàn bộ bảng tính!`;
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
        } else {
            fileIcon = "📦";
            iconBg = "#f1f5f9";
            iconColor = "#475569";
            subDesc = `✓ Tệp ${ext.toUpperCase()} Bảo Mật Cấp Quân Sự (AES-256)`;
            noteText = `💡 Tệp <strong>${outFileName}</strong> đã được mã hóa bảo mật toàn vẹn. Để giải mã và mở xem, vui lòng sử dụng tab <strong>MỞ KHÓA</strong> trên ứng dụng SecureDocShare!`;
        }
    }

    const card = document.getElementById('results-lock');
    const list = document.getElementById('results-list-lock');

    const displaySavedPath = savedPath ? `
        <div class="saved-status-box">
            <div class="saved-status-badge">✅ ĐÃ TỰ ĐỘNG LƯU VÀO MÁY</div>
            <div class="saved-status-path">${savedPath}</div>
        </div>
    ` : '';

    list.innerHTML = `
        <div class="result-card-box">
            <div class="result-file-title">
                <div class="result-file-icon" style="background: ${iconBg}; color: ${iconColor};">${fileIcon}</div>
                <div class="result-file-meta">
                    <div class="result-file-name">${outFileName}</div>
                    <div class="result-file-sub" style="color: var(--primary); font-weight: 500;">${subDesc}</div>
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
                    <span>GỬI QUA ZALO / CHIA SẺ TỆP</span>
                </button>
                <div style="display: flex; gap: 6px;">
                    <button type="button" class="btn-result-extra-copy" style="flex: 1;" onclick="reSaveNativePdf('${outFileName}', '${tempFilePath.replace(/\\/g, '\\\\')}')">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        <span>Lưu bản sao</span>
                    </button>
                    <button type="button" class="btn-result-extra-copy" style="flex: 1;" onclick="copyCurrentPassword()">
                        <span>📋 Sao chép Pass</span>
                    </button>
                    <button type="button" class="btn-result-extra-copy" style="flex: 1;" onclick="toggleQrCodeModal()">
                        <span>📱 Mã QR</span>
                    </button>
                </div>
            </div>
            <div id="qr-modal-container" class="qr-modal-box" style="display: none;">
                <div id="qr-code-target" style="padding: 6px; background: #ffffff; border-radius: 6px;"></div>
                <div class="qr-caption-text">
                    Quét camera để đọc mật khẩu trực tiếp:<br>
                    <span class="qr-pwd-highlight" id="qr-pwd-display"></span>
                </div>
            </div>
            <p class="result-note">${noteText}</p>
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
    btn.innerText = "MÃ HÓA & LƯU TỆP";
};

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
                text: 'Tài liệu bảo mật SecureDocShare'
            });
        } catch (e) {
            console.log('Share canceled', e);
        }
    } else {
        downloadResult(idx);
    }
}

// -------------------------------------------------------------
// GIẢI MÃ TỆP (TAB UNLOCK)
// -------------------------------------------------------------
async function executeMobileUnlockFile() {
    if (!selectedUnlockFile) {
        alert("Vui lòng chọn 1 tệp cần mở khóa!");
        return;
    }
    const pwd = document.getElementById('unlock-password').value;
    if (!pwd) {
        alert("Vui lòng nhập mật khẩu mở khóa!");
        return;
    }

    const btn = document.getElementById('btn-unlock-submit');
    btn.disabled = true;
    btn.innerText = "Đang giải mã...";

    // TRÊN APP DI ĐỘNG FLUTTER: GIẢI MÃ NATIVE STREAM SIÊU TỐC TRONG 2 GIÂY
    if (window.FlutterBridge) {
        window.FlutterBridge.postMessage(JSON.stringify({
            action: 'unlock_native',
            name: selectedUnlockFile.name,
            password: pwd
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
            throw new Error("Tệp không đúng định dạng bảo mật của SecureDocShare!");
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
        alert("Mở khóa thất bại: " + (e.message || "Mật khẩu không đúng!"));
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
    alert("Mở khóa thất bại: " + (errMsg || "Mật khẩu không chính xác!"));
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
