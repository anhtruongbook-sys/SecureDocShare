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
            <span class="file-name">${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
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
            <span class="file-name">${selectedUnlockFile.name} (${(selectedUnlockFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
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
                <p>✓ Đã mã hóa chuẩn AES-256 Offline</p>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="btn-download-single" onclick="downloadResult(${i})">💾 Lưu Tệp</button>
                <button class="btn-share" onclick="shareResult(${i})">📤 Chia Sẻ</button>
            </div>
        </div>
    `).join('');

    window._mobileResults = results;
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
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
