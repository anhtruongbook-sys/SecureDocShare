// mobile_app.js: Động cơ Mật Mã Học Cục Bộ Offline 100% trên Điện Thoại (Web Crypto API)

let selectedLockFiles = [];
let selectedUnlockFile = null;
let currentProtectionLevel = "open_password";

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

function triggerFileInput(inputId) {
    document.getElementById(inputId).click();
}

function handleFilesSelected(files, context) {
    if (!files || files.length === 0) return;

    if (context === 'lock') {
        for (let i = 0; i < files.length; i++) {
            selectedLockFiles.push(files[i]);
        }
        renderFileListLock();
    } else {
        selectedUnlockFile = files[0];
        renderFileListUnlock();
    }
}

function renderFileListLock() {
    const container = document.getElementById('file-list-lock');
    if (selectedLockFiles.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    container.style.display = 'flex';
    container.innerHTML = selectedLockFiles.map((file, idx) => `
        <div class="file-item">
            <span class="file-name">${file.name}</span>
            <button type="button" class="btn-remove-file" onclick="removeLockFile(${idx})">✕</button>
        </div>
    `).join('');
}

function removeLockFile(idx) {
    selectedLockFiles.splice(idx, 1);
    renderFileListLock();
}

function renderFileListUnlock() {
    const container = document.getElementById('file-list-unlock');
    if (!selectedUnlockFile) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';
    container.innerHTML = `
        <div class="file-item">
            <span class="file-name">${selectedUnlockFile.name}</span>
            <button type="button" class="btn-remove-file" onclick="selectedUnlockFile=null; renderFileListUnlock();">✕</button>
        </div>
    `;
}

function generateShortMemorablePassword() {
    const list = ["Vip88", "Vip@2026", "AnTam99", "BaoMat88", "Pccc@68", "KimMoc79", "123456", "888888"];
    const pwd = list[Math.floor(Math.random() * list.length)];
    document.getElementById('lock-password').value = pwd;
}

function applyPresetPassword(pwd) {
    document.getElementById('lock-password').value = pwd;
}

// -------------------------------------------------------------
// ĐỘNG CƠ MÃ HÓA OFFLINE 100% (WEB CRYPTO API)
// -------------------------------------------------------------
async function deriveAesKey(password, salt, iterations = 200000) {
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
            hash: "SHA-512"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

function uint8ToBase64(uint8) {
    let binary = '';
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
}

function base64ToUint8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
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
    btn.innerText = "Đang mã hóa AES-256 Offline...";

    try {
        const results = [];
        for (const file of selectedLockFiles) {
            const buffer = await file.arrayBuffer();
            const salt = crypto.getRandomValues(new Uint8Array(32));
            const nonce = crypto.getRandomValues(new Uint8Array(12));
            const iterations = 200000;

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

            // Sinh HTML tự giải mã
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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bảo Mật: ${file.name}</title>
<style>
body{font-family:sans-serif;background:#0b0f19;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}
.card{background:#151d30;border:1px solid #334155;border-radius:12px;padding:24px;max-width:420px;width:100%;text-align:center}
input{width:100%;padding:12px;box-sizing:border-box;margin:15px 0;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;font-size:16px}
button{width:100%;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:16px;font-weight:bold;cursor:pointer}
#status{margin-top:12px;font-size:13px}
</style>
</head>
<body>
<div class="card">
    <h3>Tài Liệu Bảo Mật AES-256</h3>
    <p style="font-size:13px;color:#94a3b8">Tệp: ${file.name}</p>
    <input type="password" id="p" placeholder="Nhập mật khẩu mở tệp..." autofocus>
    <button onclick="unlock()">Mở Khóa & Tải Về</button>
    <div id="status"></div>
</div>
<script>
async function unlock(){
    const pwd=document.getElementById('p').value;
    const st=document.getElementById('status');
    if(!pwd)return;
    st.innerText='Đang giải mã...';
    try{
        const b64toU8=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
        const salt=b64toU8('${saltB64}');
        const iv=b64toU8('${nonceB64}');
        const meta=b64toU8('${metaB64}');
        const data=b64toU8('${cipherB64}');
        const enc=new TextEncoder();
        const baseKey=await crypto.subtle.importKey('raw',enc.encode(pwd),'PBKDF2',false,['deriveKey']);
        const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:${iterations},hash:'SHA-512'},baseKey,{name:'AES-GCM',length:256},false,['decrypt']);
        const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv,additionalData:meta,tagLength:128},key,data);
        const m=JSON.parse(new TextDecoder().decode(meta));
        st.innerText='✓ Mở khóa thành công!';
        const blob=new Blob([dec],{type:m.mime_type});
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download=m.filename;
        a.click();
    }catch(e){
        st.innerText='✕ Mật khẩu sai hoặc tệp bị hỏng!';
    }
}
</script>
</body>
</html>`;

            results.push({
                name: outName,
                blob: new Blob([htmlContent], { type: "text/html" })
            });
        }

        renderMobileResults(results);

    } catch (e) {
        alert("Lỗi mã hóa: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "MÃ HÓA & LƯU VỀ MÁY";
    }
}

function renderMobileResults(results) {
    const card = document.getElementById('results-lock');
    const list = document.getElementById('results-list-lock');

    list.innerHTML = results.map((r, i) => `
        <div class="result-item">
            <div class="result-info">
                <h5>${r.name}</h5>
                <p>Đã mã hóa chuẩn AES-256</p>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="btn-download-single" onclick="downloadResult(${i})">Lưu Tệp</button>
                <button class="btn-share" onclick="shareResult(${i})">Chia Sẻ</button>
            </div>
        </div>
    `).join('');

    window._mobileResults = results;
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
}

function downloadResult(idx) {
    const item = window._mobileResults[idx];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(item.blob);
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function shareResult(idx) {
    const item = window._mobileResults[idx];
    const file = new File([item.blob], item.name, { type: item.blob.type });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: 'Tài Liệu Bảo Mật ' + item.name,
                text: 'Gửi bạn tài liệu đã được mã hóa bảo vệ bằng SecureDocShare.'
            });
        } catch (e) {
            console.log('Share canceled or failed', e);
        }
    } else {
        downloadResult(idx);
        alert("Đã lưu tệp vào máy. Bạn có thể mở Zalo/Telegram đính kèm file vừa tải để gửi!");
    }
}
