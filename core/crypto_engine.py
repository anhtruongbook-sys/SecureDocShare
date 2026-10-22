# -*- coding: utf-8 -*-
"""
crypto_engine.py: ĐỘNG CƠ MÃ HÓA CẤP QUÂN SỰ (MILITARY-GRADE CRYPTOGRAPHY ENGINE)
Dự án: SecureDocShare - Bảo mật tài liệu truyền qua mạng Internet
Chuẩn mực: AES-256-GCM (Authenticated Encryption) + PBKDF2-HMAC-SHA512 / Argon2id

Đặc điểm an ninh:
1. Thuật toán: AES-256 trong chế độ GCM (Galois/Counter Mode).
2. Toàn vẹn dữ liệu: 128-bit Authentication Tag chống can thiệp hoặc sửa đổi dữ liệu dù chỉ 1 bit.
3. Dẫn xuất khóa: PBKDF2-HMAC-SHA512 với 600.000 vòng lặp (chuẩn NIST/OWASP 2024+) kết hợp Salt 32-byte ngẫu nhiên.
4. Tương thích Web Crypto API: Khóa và thuật toán đồng bộ 100% với Web Crypto API của trình duyệt (Chrome, Safari, Edge, Firefox),
   cho phép tạo tệp HTML Tự Giải Mã (Self-Decrypting Zero-Knowledge HTML) chạy offline trên mọi thiết bị di động và máy tính.
"""

import os
import json
import base64
from typing import Dict, Any, Tuple
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from core.pqc_crypto_engine import PQCCryptoEngine, MAGIC_PQC_V2

# Số vòng lặp dẫn xuất khóa (OWASP khuyến nghị tối thiểu 600.000 vòng cho SHA-512)
PBKDF2_ITERATIONS = 600000
SALT_SIZE = 32  # 256 bits salt ngẫu nhiên
NONCE_SIZE = 12 # 96 bits nonce chuẩn mực cho AES-GCM
MAGIC_HEADER = b"SECDOC_V1" # Header nhận diện định dạng tệp bảo mật


class CryptoEngine:
    """Động cơ mã hóa và giải mã Hậu Lượng Tử (ML-KEM-768 FIPS 203 + Master Key) & AES-256-GCM đa nền tảng."""

    @staticmethod
    def derive_key(password: str, salt: bytes, iterations: int = PBKDF2_ITERATIONS) -> bytes:
        """Dẫn xuất khóa AES 256-bit từ mật khẩu sử dụng PBKDF2-HMAC-SHA512."""
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA512(),
            length=32, # 256 bits key
            salt=salt,
            iterations=iterations,
            backend=default_backend()
        )
        return kdf.derive(password.encode("utf-8"))

    @classmethod
    def encrypt_bytes(
        cls,
        plaintext: bytes,
        password: str,
        metadata: Dict[str, Any] = None,
        use_pqc_v2: bool = True,
        recipient_pqc_pk: bytes = None,
        master_pqc_pk: bytes = None
    ) -> bytes:
        """
        Mã hóa dữ liệu nhị phân với kiến trúc Hậu lượng tử SECDOC_PQC_V2 (ML-KEM-768 + Master Key + AES-256-GCM)
        hoặc SECDOC_V1 cổ điển.
        """
        if use_pqc_v2:
            return PQCCryptoEngine.encrypt_bytes(
                plaintext=plaintext,
                password=password,
                metadata=metadata,
                recipient_pqc_pk=recipient_pqc_pk,
                master_pqc_pk=master_pqc_pk
            )

        salt = os.urandom(SALT_SIZE)
        nonce = os.urandom(NONCE_SIZE)
        key = cls.derive_key(password, salt)

        meta = metadata or {}
        meta_bytes = json.dumps(meta, ensure_ascii=False).encode("utf-8")
        meta_len = len(meta_bytes).to_bytes(4, byteorder="big")

        # Gán metadata làm Associated Data (AAD) để xác thực toàn vẹn không bị giả mạo
        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(nonce, plaintext, meta_bytes)

        return MAGIC_HEADER + salt + nonce + meta_len + meta_bytes + ciphertext

    @classmethod
    def decrypt_bytes(
        cls,
        payload: bytes,
        password: str = None,
        recipient_pqc_sk: bytes = None,
        master_pqc_sk: bytes = None
    ) -> Tuple[bytes, Dict[str, Any]]:
        """
        Giải mã gói tin SECDOC_PQC_V2 (bằng Mật khẩu, Khóa PQC Người nhận hoặc Khóa Master Key)
        và tương thích ngược 100% với SECDOC_V1.
        """
        if payload.startswith(MAGIC_PQC_V2):
            return PQCCryptoEngine.decrypt_bytes(
                payload=payload,
                password=password,
                recipient_pqc_sk=recipient_pqc_sk,
                master_pqc_sk=master_pqc_sk
            )
        magic_len = len(MAGIC_HEADER)
        if len(payload) < magic_len + SALT_SIZE + NONCE_SIZE + 4 + 16:
            raise ValueError("Dữ liệu tệp không đúng định dạng hoặc đã bị hư hại.")

        if payload[:magic_len] != MAGIC_HEADER:
            raise ValueError("Tiêu đề tệp không hợp lệ. Đây không phải tệp bảo mật SECDOC.")

        offset = magic_len
        salt = payload[offset : offset + SALT_SIZE]
        offset += SALT_SIZE

        nonce = payload[offset : offset + NONCE_SIZE]
        offset += NONCE_SIZE

        meta_len = int.from_bytes(payload[offset : offset + 4], byteorder="big")
        offset += 4

        meta_bytes = payload[offset : offset + meta_len]
        offset += meta_len

        ciphertext = payload[offset:]

        key = cls.derive_key(password, salt)
        aesgcm = AESGCM(key)

        try:
            plaintext = aesgcm.decrypt(nonce, ciphertext, meta_bytes)
        except Exception as e:
            raise ValueError("Mật khẩu không chính xác hoặc tệp đã bị chỉnh sửa/can thiệp!") from e

        metadata = json.loads(meta_bytes.decode("utf-8")) if meta_bytes else {}
        return plaintext, metadata

    @classmethod
    def generate_self_decrypting_html(
        cls,
        file_bytes: bytes,
        filename: str,
        password: str,
        mime_type: str = "application/octet-stream",
        hint_message: str = ""
    ) -> str:
        """
        Tạo tệp HTML tự giải mã (Self-Decrypting Zero-Knowledge HTML).
        Người nhận mở tệp HTML này trên bất kỳ trình duyệt nào (iOS, Android, Windows, Mac),
        nhập mật khẩu để giải mã trực tiếp trong RAM của máy trạm mà không cần cài đặt phần mềm!
        """
        salt = os.urandom(SALT_SIZE)
        nonce = os.urandom(NONCE_SIZE)
        key = cls.derive_key(password, salt)

        meta = {
            "filename": filename,
            "mime_type": mime_type,
            "filesize": len(file_bytes),
            "hint": hint_message
        }
        meta_bytes = json.dumps(meta, ensure_ascii=False).encode("utf-8")

        aesgcm = AESGCM(key)
        ciphertext = aesgcm.encrypt(nonce, file_bytes, meta_bytes)

        # Đóng gói Base64
        salt_b64 = base64.b64encode(salt).decode("ascii")
        nonce_b64 = base64.b64encode(nonce).decode("ascii")
        meta_b64 = base64.b64encode(meta_bytes).decode("ascii")
        cipher_b64 = base64.b64encode(ciphertext).decode("ascii")

        html_template = f"""<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tài Liệu Bảo Mật: {filename}</title>
    <style>
        :root {{
            --bg: #0b0f19;
            --card-bg: #151d30;
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --text-main: #f8fafc;
            --text-sub: #94a3b8;
            --border: #334155;
            --success: #10b981;
            --danger: #ef4444;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: radial-gradient(circle at 50% 20%, #1e293b 0%, var(--bg) 100%);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        .vault-card {{
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 16px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
            max-width: 480px;
            width: 100%;
            padding: 32px;
            text-align: center;
        }}
        .shield-icon {{
            width: 64px;
            height: 64px;
            margin: 0 auto 16px;
            background: rgba(37, 99, 235, 0.15);
            border: 1px solid rgba(37, 99, 235, 0.3);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #60a5fa;
        }}
        h2 {{ font-size: 22px; font-weight: 700; margin-bottom: 8px; }}
        .file-info {{
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px;
            margin: 16px 0;
            font-size: 14px;
            word-break: break-all;
            color: #cbd5e1;
        }}
        .form-group {{ margin-bottom: 20px; text-align: left; }}
        label {{ display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-sub); }}
        input[type="password"] {{
            width: 100%;
            padding: 14px 16px;
            border-radius: 8px;
            border: 1px solid var(--border);
            background: #0f172a;
            color: #fff;
            font-size: 16px;
            outline: none;
            transition: border-color 0.2s;
        }}
        input[type="password"]:focus {{ border-color: var(--primary); }}
        .btn-unlock {{
            width: 100%;
            padding: 14px;
            background: var(--primary);
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }}
        .btn-unlock:hover {{ background: var(--primary-hover); }}
        .status-msg {{ margin-top: 16px; font-size: 14px; min-height: 20px; }}
        .status-msg.error {{ color: var(--danger); font-weight: 600; }}
        .status-msg.success {{ color: var(--success); font-weight: 600; }}
        .status-msg.loading {{ color: #fbbf24; }}
        .security-badge {{
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--border);
            font-size: 12px;
            color: var(--text-sub);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }}
    </style>
</head>
<body>
    <div class="vault-card">
        <div class="shield-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <rect x="9" y="9" width="6" height="6" rx="1"/>
            </svg>
        </div>
        <h2>Tài Liệu Bảo Mật Mã Hóa</h2>
        <p style="font-size: 13px; color: var(--text-sub);">Chuẩn mã hóa cấp quân sự AES-256-GCM</p>

        <div class="file-info">
            <strong>Tệp tin:</strong> {filename}
            {f'<div style="margin-top:4px; font-size:12px; color:#fbbf24;">Gợi ý: {hint_message}</div>' if hint_message else ''}
        </div>

        <form id="unlockForm" onsubmit="handleUnlock(event)">
            <div class="form-group">
                <label for="password">Nhập Mật Khẩu Để Mở Khóa:</label>
                <input type="password" id="password" placeholder="Nhập mật khẩu..." required autofocus autocomplete="current-password">
            </div>
            <button type="submit" id="unlockBtn" class="btn-unlock">Mở Khóa & Tải Xuống</button>
        </form>

        <div id="status" class="status-msg"></div>

        <div class="security-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
            </svg>
            <span>Giải mã Zero-Knowledge 100% Cục bộ trên Thiết bị của bạn</span>
        </div>
    </div>

    <script>
        const ENCRYPTED_DATA = {{
            salt: "{salt_b64}",
            nonce: "{nonce_b64}",
            meta: "{meta_b64}",
            ciphertext: "{cipher_b64}",
            iterations: {PBKDF2_ITERATIONS}
        }};

        function base64ToUint8(b64) {{
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {{
                bytes[i] = binary.charCodeAt(i);
            }}
            return bytes;
        }}

        async function handleUnlock(e) {{
            e.preventDefault();
            const pwd = document.getElementById("password").value;
            const btn = document.getElementById("unlockBtn");
            const status = document.getElementById("status");

            if (!pwd) return;

            btn.disabled = true;
            btn.innerText = "Đang dẫn xuất khóa & giải mã...";
            status.className = "status-msg loading";
            status.innerText = "Đang xử lý 600.000 vòng lặp PBKDF2 bảo mật...";

            // Dùng setTimeout để UI kịp render trạng thái
            setTimeout(async () => {{
                try {{
                    const enc = new TextEncoder();
                    const passwordKey = await crypto.subtle.importKey(
                        "raw",
                        enc.encode(pwd),
                        "PBKDF2",
                        false,
                        ["deriveKey"]
                    );

                    const saltBytes = base64ToUint8(ENCRYPTED_DATA.salt);
                    const nonceBytes = base64ToUint8(ENCRYPTED_DATA.nonce);
                    const metaBytes = base64ToUint8(ENCRYPTED_DATA.meta);
                    const cipherBytes = base64ToUint8(ENCRYPTED_DATA.ciphertext);

                    const aesKey = await crypto.subtle.deriveKey(
                        {{
                            name: "PBKDF2",
                            salt: saltBytes,
                            iterations: ENCRYPTED_DATA.iterations,
                            hash: "SHA-512"
                        }},
                        passwordKey,
                        {{ name: "AES-GCM", length: 256 }},
                        false,
                        ["decrypt"]
                    );

                    // Giải mã AES-GCM với AAD (Additional Authenticated Data) là metadata
                    const decrypted = await crypto.subtle.decrypt(
                        {{
                            name: "AES-GCM",
                            iv: nonceBytes,
                            additionalData: metaBytes,
                            tagLength: 128
                        }},
                        aesKey,
                        cipherBytes
                    );

                    const meta = JSON.parse(new TextDecoder().decode(metaBytes));
                    status.className = "status-msg success";
                    status.innerText = "✓ Mở khóa thành công! Tệp tin đang được tải xuống...";

                    // Tải tệp giải mã về máy
                    const blob = new Blob([decrypted], {{ type: meta.mime_type || "application/octet-stream" }});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = meta.filename || "decrypted_file";
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {{
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        btn.disabled = false;
                        btn.innerText = "Tải Lại Tệp Tin";
                    }}, 2000);

                }} catch (err) {{
                    console.error(err);
                    status.className = "status-msg error";
                    status.innerText = "✕ Mật khẩu không chính xác hoặc tệp đã bị chỉnh sửa!";
                    btn.disabled = false;
                    btn.innerText = "Thử Lại";
                }}
            }}, 50);
        }}
    </script>
</body>
</html>"""
        return html_template
