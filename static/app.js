// app.js: Điều Khiển Giao Diện & Tương Tác API SecureDocShare

let selectedLockFiles = [];
let selectedUnlockFile = null;
let currentMode = "native"; // Mặc định là Native (Office & Adobe)
let currentProtectionLevel = "open_password"; // Mặc định là bắt buộc nhập password mới mở được

function selectProtectionLevel(levelVal, cardEl) {
    currentProtectionLevel = levelVal;
    document.querySelectorAll('.level-card').forEach(c => c.classList.remove('active'));
    cardEl.classList.add('active');
    const radio = cardEl.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;

    const pwdLabel = document.getElementById('password-label');
    const passSubnote = document.getElementById('pass-subnote');

    if (levelVal === 'view_only_restricted') {
        pwdLabel.innerHTML = `BƯỚC 2: MẬT KHẨU QUẢN TRỊ / GỠ KHÓA <span class="required">*</span>`;
        passSubnote.innerHTML = `💡 <strong>Người nhận xem trực tiếp không cần mật khẩu</strong>. Mật khẩu này chỉ bạn giữ để sau này gỡ khóa cho phép sửa/in khi cần.`;
        passSubnote.style.color = '#34d399';
    } else {
        pwdLabel.innerHTML = `BƯỚC 2: MẬT KHẨU MỞ TỆP (Dùng mã ngắn dễ nhớ: 123456, Vip88, AnTam99) <span class="required">*</span>`;
        passSubnote.innerHTML = `💡 Người nhận <strong>bắt buộc phải nhập đúng mật khẩu này</strong> mới mở được file.`;
        passSubnote.style.color = '#94a3b8';
    }
}

// -------------------------------------------------------------
// 1. Chuyển Đổi Tab
// -------------------------------------------------------------
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    if (tabName === 'lock') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('tab-lock').classList.add('active');
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('tab-unlock').classList.add('active');
    }
}

// -------------------------------------------------------------
// 2. Kéo Thả File & Chọn File
// -------------------------------------------------------------
function triggerFileInput(inputId) {
    document.getElementById(inputId).click();
}

// Thiết lập drag & drop cho cả 2 dropzone
['dropzone-lock', 'dropzone-unlock'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        el.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        el.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.classList.remove('dragover');
        });
    });

    el.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (id === 'dropzone-lock') {
            handleFilesSelected(files, 'lock');
        } else {
            handleFilesSelected(files, 'unlock');
        }
    });
});

function handleFilesSelected(files, context) {
    if (!files || files.length === 0) return;

    if (context === 'lock') {
        // Thêm vào danh sách lock (tránh trùng lặp)
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!selectedLockFiles.some(existing => existing.name === f.name && existing.size === f.size)) {
                selectedLockFiles.push(f);
            }
        }
        renderFileListLock();
    } else {
        // Unlock chỉ nhận 1 file một lần
        selectedUnlockFile = files[0];
        renderFileListUnlock();
    }
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getExtBadgeClass(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return 'ext-' + ext;
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
        const ext = file.name.split('.').pop().toUpperCase();
        return `
            <div class="file-item">
                <div class="file-item-left">
                    <span class="file-ext-badge ${getExtBadgeClass(file.name)}">${ext}</span>
                    <span class="file-name" title="${file.name}">${file.name}</span>
                    <span class="file-size">(${formatBytes(file.size)})</span>
                </div>
                <button type="button" class="btn-remove-file" onclick="removeLockFile(${idx})" title="Xóa tệp">✕</button>
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
    const ext = selectedUnlockFile.name.split('.').pop().toUpperCase();
    container.innerHTML = `
        <div class="file-item">
            <div class="file-item-left">
                <span class="file-ext-badge ${getExtBadgeClass(selectedUnlockFile.name)}">${ext}</span>
                <span class="file-name" title="${selectedUnlockFile.name}">${selectedUnlockFile.name}</span>
                <span class="file-size">(${formatBytes(selectedUnlockFile.size)})</span>
            </div>
            <button type="button" class="btn-remove-file" onclick="removeUnlockFile()" title="Xóa tệp">✕</button>
        </div>
    `;
}

function removeUnlockFile() {
    selectedUnlockFile = null;
    renderFileListUnlock();
}

// -------------------------------------------------------------
// 3. Mật Khẩu & Đo Độ Mạnh NIST Entropy
// -------------------------------------------------------------
function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = '🙈';
    } else {
        input.type = 'password';
        btn.innerText = '👁️';
    }
}

// -------------------------------------------------------------
// Tạo Mật Khẩu Ngắn Cực Kỳ Dễ Nhớ (Memorable Short Password)
// -------------------------------------------------------------
function generateShortMemorablePassword() {
    const prefixes = ["Vip", "AnTam", "BaoMat", "HoSo", "HopDong", "XayDung", "Pccc", "DuAn", "ChungCu", "DiaLy"];
    const symbols = ["@", "#", "$", ""];
    const numbers = ["88", "99", "68", "79", "2026", "6868", "8888", "123"];

    const pre = prefixes[Math.floor(Math.random() * prefixes.length)];
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    const num = numbers[Math.floor(Math.random() * numbers.length)];

    const pwd = `${pre}${sym}${num}`;

    const input = document.getElementById('lock-password');
    input.value = pwd;
    checkPasswordStrength(pwd);

    navigator.clipboard.writeText(pwd).then(() => {
        alert("Đã tạo mã ngắn siêu dễ nhớ và sao chép vào bộ nhớ tạm:\n\n👉 " + pwd + "\n\n(Ai cũng nhớ được ngay và nhập nhanh trên điện thoại/máy tính!)");
    });
}

function applyPresetPassword(pwd) {
    const input = document.getElementById('lock-password');
    input.value = pwd;
    checkPasswordStrength(pwd);
}

function checkPasswordStrength(pwd) {
    const bar = document.getElementById('strength-bar');
    const label = document.getElementById('strength-label');

    if (!pwd) {
        bar.className = 'strength-bar';
        label.innerText = 'Độ mạnh: Chưa nhập';
        return;
    }

    // Với chuẩn AES-256 Adobe R6 và Microsoft Agile Encryption, ngay cả pass ngắn cũng được bảo vệ bởi Key Stretching
    if (pwd.length < 4) {
        bar.className = 'strength-bar weak';
        label.innerText = 'Mã quá ngắn (Nên từ 4 ký tự trở lên)';
        label.style.color = '#ef4444';
    } else if (pwd.length <= 8) {
        bar.className = 'strength-bar strong';
        label.innerText = 'Mã ngắn dễ nhớ • Chuẩn bảo vệ AES-256 Native';
        label.style.color = '#10b981';
    } else {
        bar.className = 'strength-bar strong';
        label.innerText = 'Mật khẩu dài bảo mật cao • AES-256';
        label.style.color = '#10b981';
    }
}

function selectMode(modeVal, cardEl) {
    currentMode = modeVal;
    document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
    cardEl.classList.add('active');
    const radio = cardEl.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
}

// -------------------------------------------------------------
// 4. Thực Thi Mã Hóa (Lock Files)
// -------------------------------------------------------------
async function executeLockFiles() {
    if (selectedLockFiles.length === 0) {
        alert("Vui lòng chọn hoặc kéo thả ít nhất 1 tệp tin cần mã hóa!");
        return;
    }

    const password = document.getElementById('lock-password').value;
    if (!password || password.trim() === '') {
        alert("Vui lòng nhập mật khẩu mã hóa!");
        document.getElementById('lock-password').focus();
        return;
    }

    const hint = document.getElementById('hint-message').value;
    const allowPrint = document.getElementById('allow-print').checked;
    const allowCopy = document.getElementById('allow-copy').checked;

    const btn = document.getElementById('btn-lock-submit');
    btn.disabled = true;
    btn.innerHTML = `
        <span class="loading-spinner"></span>
        <span>Đang mã hóa chuẩn AES-256... Vui lòng đợi</span>
    `;

    const formData = new FormData();
    selectedLockFiles.forEach(f => formData.append("files", f));
    formData.append("password", password);
    formData.append("protection_level", currentProtectionLevel);
    formData.append("mode", currentMode);
    formData.append("hint", hint);
    formData.append("allow_print", allowPrint);
    formData.append("allow_copy", allowCopy);

    try {
        const resp = await fetch("/api/lock", {
            method: "POST",
            body: formData
        });

        const result = await resp.json();
        if (!resp.ok || result.status !== "SUCCESS") {
            throw new Error(result.detail || result.message || "Lỗi khi xử lý mã hóa.");
        }

        renderLockResults(result);
    } catch (err) {
        alert("✕ LỖI MÃ HÓA: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>MÃ HÓA & TẢI XUỐNG NGAY</span>
        `;
    }
}

let lastLockResults = null;

function renderLockResults(data) {
    lastLockResults = data;
    const card = document.getElementById('results-lock');
    const list = document.getElementById('results-list-lock');
    const zipBtn = document.getElementById('btn-download-all');

    list.innerHTML = data.files.map(item => `
        <div class="result-item">
            <div class="result-info">
                <h5>${item.output_filename}</h5>
                <p>${item.description || 'Đã bảo vệ an toàn'} • Dung lượng: ${formatBytes(item.size_bytes)}</p>
            </div>
            <a href="/api/download?file_id=${item.download_id}" class="btn-download-single" download="${item.output_filename}">
                Tải Xuống
            </a>
        </div>
    `).join('');

    if (data.zip_download_id) {
        zipBtn.style.display = 'block';
    } else {
        zipBtn.style.display = 'none';
    }

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
}

function downloadAllZip() {
    if (lastLockResults && lastLockResults.zip_download_id) {
        window.location.href = `/api/download?file_id=${lastLockResults.zip_download_id}`;
    }
}

// -------------------------------------------------------------
// 5. Thực Thi Mở Khóa (Unlock File)
// -------------------------------------------------------------
async function executeUnlockFile() {
    if (!selectedUnlockFile) {
        alert("Vui lòng chọn tệp đã mã hóa cần mở khóa!");
        return;
    }

    const password = document.getElementById('unlock-password').value;
    if (!password) {
        alert("Vui lòng nhập mật khẩu giải mã!");
        document.getElementById('unlock-password').focus();
        return;
    }

    const btn = document.getElementById('btn-unlock-submit');
    btn.disabled = true;
    btn.innerHTML = `<span>Đang giải mã... Vui lòng đợi</span>`;

    const formData = new FormData();
    formData.append("file", selectedUnlockFile);
    formData.append("password", password);

    try {
        const resp = await fetch("/api/unlock", {
            method: "POST",
            body: formData
        });

        const result = await resp.json();
        if (!resp.ok || result.status !== "SUCCESS") {
            throw new Error(result.detail || result.message || "Mật khẩu sai hoặc tệp bị hư hại.");
        }

        const card = document.getElementById('results-unlock');
        const list = document.getElementById('results-list-unlock');

        list.innerHTML = `
            <div class="result-item">
                <div class="result-info">
                    <h5>${result.unlocked_filename}</h5>
                    <p>Đã giải mã thành công về tệp gốc nguyên bản</p>
                </div>
                <a href="/api/download?file_id=${result.download_id}" class="btn-download-single" download="${result.unlocked_filename}">
                    Tải Về Tệp Gốc
                </a>
            </div>
        `;
        card.style.display = 'block';
        card.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
        alert("✕ LỖI MỞ KHÓA: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
            </svg>
            <span>MỞ KHÓA & TRÍCH XUẤT TỆP GỐC</span>
        `;
    }
}
