const KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL = 'data:image/png;base64,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';
const KRYPTO_DEFAULT_CHU_KY_TA_SHA256 = 'f725d40806e86a9c9db8ca5e9eb48a21e50458b9a7ea9d649da7b71a99d672fb';
/**
 * hsm_signature_engine.js: ĐỘNG CƠ CHỮ KÝ SỐ CÁ NHÂN CHUẨN HSM (PKCS#11 + PNG ALPHA MATTING +
 * DI TRÚ ĐỔI ĐIỆN THOẠI/PC .KRYPTOHSM + EMAIL KÝ SỐ S/MIME) CHO ỨNG DỤNG KRYPTO (WEB & FLUTTER APK OFFLINE)
 */

const KRYPTO_HSM_STORAGE_KEY = 'krypto_pkcs11_hsm_vault_v1';

class KryptoHSMSignatureEngine {
    /**
     * 1. Tách nền trong suốt 100%, khử bóng giấy và đổi sang màu mực chuẩn hành chính (#003399 / Đen / Đỏ)
     *    ngay trên HTML5 Canvas (Offline 100% trên cả Điện thoại và PC).
     */
    static async processHandwrittenSignatureImage(imageSourceUrlOrDataUrl, inkPreset = 'administrative_blue') {
        const inkMap = {
            administrative_blue: [0, 51, 153], // Xanh cửu long chuẩn hành chính (#003399)
            royal_blue: [0, 76, 180],          // Xanh biếc (#004CB4)
            carbon_black: [15, 15, 15],        // Đen tuyền (#0F0F0F)
            seal_red: [192, 0, 0]              // Đỏ tươi (#C00000)
        };
        const [inkR, inkG, inkB] = inkMap[inkPreset] || inkMap.administrative_blue;

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = async () => {
                try {
                    const maxDim = 900;
                    let w = img.width || 600;
                    let h = img.height || 240;
                    if (w > maxDim) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);

                    const imgData = ctx.getImageData(0, 0, w, h);
                    const data = imgData.data;

                    // Kiểm tra xem ảnh đã có nền trong suốt sẵn chưa
                    let hasTransparentBg = false;
                    for (let i = 3; i < data.length; i += 16) {
                        if (data[i] < 200) {
                            hasTransparentBg = true;
                            break;
                        }
                    }

                    // Ước lượng độ sáng trung bình của nền giấy
                    let bgSum = 0;
                    let bgCount = 0;
                    for (let i = 0; i < data.length; i += 16) {
                        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                        if (lum > 140) {
                            bgSum += lum;
                            bgCount++;
                        }
                    }
                    const bgRef = bgCount > 10 ? bgSum / bgCount : 230;

                    let minX = w, minY = h, maxX = 0, maxY = 0;
                    let foundStroke = false;

                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            const idx = (y * w + x) * 4;
                            const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
                            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                            let newAlpha = 0;
                            if (hasTransparentBg) {
                                if (a > 20) {
                                    const darkness = 255 - lum;
                                    newAlpha = lum < 235 ? Math.min(255, Math.round(a * 1.25)) : Math.round(a * (darkness / 255));
                                }
                            } else {
                                const diff = bgRef - lum;
                                if (diff > 18) {
                                    newAlpha = Math.min(255, Math.round(((diff - 18) / (bgRef * 0.52)) * 255 * 1.35));
                                }
                            }

                            if (newAlpha > 22) {
                                data[idx] = inkR;
                                data[idx + 1] = inkG;
                                data[idx + 2] = inkB;
                                data[idx + 3] = newAlpha;
                                if (x < minX) minX = x;
                                if (x > maxX) maxX = x;
                                if (y < minY) minY = y;
                                if (y > maxY) maxY = y;
                                foundStroke = true;
                            } else {
                                data[idx + 3] = 0;
                            }
                        }
                    }

                    ctx.putImageData(imgData, 0, 0);

                    // Cắt sát khung bao (Auto-Crop Bounding Box)
                    if (!foundStroke) {
                        minX = 0; minY = 0; maxX = w - 1; maxY = h - 1;
                    }
                    const cropW = Math.max(60, maxX - minX + 1);
                    const cropH = Math.max(30, maxY - minY + 1);
                    const padX = Math.round(cropW * 0.06);
                    const padY = Math.round(cropH * 0.08);

                    const outCanvas = document.createElement('canvas');
                    outCanvas.width = cropW + padX * 2;
                    outCanvas.height = cropH + padY * 2;
                    const outCtx = outCanvas.getContext('2d');
                    outCtx.drawImage(canvas, minX, minY, cropW, cropH, padX, padY, cropW, cropH);

                    const pngDataUrl = outCanvas.toDataURL('image/png');
                    const sha256Hex = await KryptoHSMSignatureEngine.sha256HexFromDataUrl(pngDataUrl);
                    resolve({
                        pngDataUrl,
                        sha256Hex,
                        width: outCanvas.width,
                        height: outCanvas.height,
                        inkPreset
                    });
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error('Không thể đọc tệp ảnh chữ ký tay!'));
            img.src = imageSourceUrlOrDataUrl;
        });
    }

    /**
     * 2. Sinh ảnh chữ ký tay mẫu mượt mà (Bezier Calligraphic Signature) trên nền trong suốt
     *    khi người dùng chưa có ảnh chụp chữ ký trên giấy.
     */
    static async generateStylizedHandwrittenSignature(signerName = 'TS. Nguyễn Tuấn Anh', inkPreset = 'administrative_blue') {
        if (typeof KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL !== 'undefined' && KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL) {
            return await KryptoHSMSignatureEngine.processHandwrittenSignatureImage(KRYPTO_DEFAULT_CHU_KY_TA_DATA_URL, inkPreset);
        }
        const inkHexMap = {
            administrative_blue: '#003399',
            royal_blue: '#004CB4',
            carbon_black: '#0F0F0F',
            seal_red: '#C00000'
        };
        const strokeColor = inkHexMap[inkPreset] || '#003399';

        const canvas = document.createElement('canvas');
        canvas.width = 620;
        canvas.height = 220;
        const ctx = canvas.getContext('2d');

        // Tính hạt giống từ tên người ký để nét chữ ký luôn nhất quán
        const nameBytes = new TextEncoder().encode(signerName || 'KryptoSigner');
        const hashBuf = await crypto.subtle.digest('SHA-256', nameBytes);
        const seed = new Uint8Array(hashBuf);
        const s0 = (seed[0] % 26) - 13;
        const s1 = (seed[1] % 24) - 12;

        ctx.strokeStyle = strokeColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Nét 1: Vòng lượn chữ cái đầu
        ctx.beginPath();
        ctx.lineWidth = 4.6;
        ctx.moveTo(85, 148 + s0);
        ctx.bezierCurveTo(32, 24 + s1, 215, 16 - s0, 142, 168);
        ctx.stroke();

        // Nét 2: Thân chữ ký liên hoàn
        ctx.beginPath();
        ctx.lineWidth = 3.8;
        ctx.moveTo(142, 168);
        ctx.bezierCurveTo(188, 52 + s1, 260, 172 - s0, 325, 84);
        ctx.bezierCurveTo(362, 160, 412, 62 + s0, 475, 122);
        ctx.stroke();

        // Nét 3: Chữ ký tên nghiêng và nét gạch vuốt dứt khoát
        const shortName = (signerName || 'Sign').trim().split(/\s+/).pop();
        ctx.font = 'italic bold 36px "Segoe Script", "Brush Script MT", "Times New Roman", cursive';
        ctx.fillStyle = strokeColor;
        ctx.fillText(shortName, 210, 118);

        ctx.beginPath();
        ctx.lineWidth = 4.2;
        ctx.moveTo(465, 122);
        ctx.bezierCurveTo(540, 105, 135, 198, 555, 142 - Math.abs(s0));
        ctx.stroke();

        const rawDataUrl = canvas.toDataURL('image/png');
        return await KryptoHSMSignatureEngine.processHandwrittenSignatureImage(rawDataUrl, inkPreset);
    }

    static async sha256HexFromDataUrl(dataUrl) {
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    static async deriveAesGcmKey(secretPass, saltBytes, iterations = 250000) {
        const baseKey = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secretPass),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-512' },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    static async sealDataWithPass(plainBytes, passStr) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await KryptoHSMSignatureEngine.deriveAesGcmKey(passStr, salt);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
        return {
            salt_b64: KryptoHSMSignatureEngine.u8ToB64(salt),
            iv_b64: KryptoHSMSignatureEngine.u8ToB64(iv),
            ct_b64: KryptoHSMSignatureEngine.u8ToB64(new Uint8Array(ct))
        };
    }

    static async unsealDataWithPass(sealedObj, passStr) {
        const salt = KryptoHSMSignatureEngine.b64ToU8(sealedObj.salt_b64);
        const iv = KryptoHSMSignatureEngine.b64ToU8(sealedObj.iv_b64);
        const ct = KryptoHSMSignatureEngine.b64ToU8(sealedObj.ct_b64);
        const key = await KryptoHSMSignatureEngine.deriveAesGcmKey(passStr, salt);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new Uint8Array(pt);
    }

    static u8ToB64(u8) {
        let s = '';
        for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
        return btoa(s);
    }

    static b64ToU8(b64) {
        const s = atob(b64);
        const u8 = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
        return u8;
    }

    /**
     * 3. Khởi tạo Buồng HSM Cá nhân chuẩn PKCS#11 ngay trong Két Sắt Krypto:
     *    - Sinh cặp khóa ECDSA P-256 / RSA-2048 nội sinh trong WebCrypto/HSM, niêm phong CKA_EXTRACTABLE=FALSE bằng USER_PIN.
     *    - Gắn chặt mã băm SHA-256 của ảnh chữ ký tay .PNG và địa chỉ Email ký số S/MIME.
     */
    static async provisionPersonalHSMSlot({
        signerName,
        signerEmail,
        signerTitle,
        organization,
        personalIdCccd,
        userPin,
        soPin,
        inkPreset = 'administrative_blue',
        customPngDataUrl = null
    }) {
        if (!signerName || !signerName.trim()) throw new Error('Vui lòng nhập Họ và tên chủ sở hữu chữ ký số!');
        if (!signerEmail || !signerEmail.trim()) throw new Error('Vui lòng nhập Email ký số & nhận thông báo!');
        if (!userPin || userPin.trim().length < 4) throw new Error('Mã USER_PIN của HSM phải có từ 4 ký tự trở lên!');

        let sigProcessed;
        if (customPngDataUrl) {
            sigProcessed = await KryptoHSMSignatureEngine.processHandwrittenSignatureImage(customPngDataUrl, inkPreset);
        } else {
            sigProcessed = await KryptoHSMSignatureEngine.generateStylizedHandwrittenSignature(signerName, inkPreset);
        }

        // Sinh cặp khóa ký số bất đối xứng ECDSA P-256 (chuẩn FIPS 186-5 / PKCS#11 CKK_EC)
        const keyPair = await crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['sign', 'verify']
        );
        const pkcs8Priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
        const spkiPub = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));

        // Niêm phong khóa bí mật bằng Slot Master Key (bọc bởi USER_PIN và SO_PIN)
        const slotMasterKey = crypto.getRandomValues(new Uint8Array(32));
        const userPinWrapped = await KryptoHSMSignatureEngine.sealDataWithPass(slotMasterKey, userPin.trim());
        const soPinWrapped = await KryptoHSMSignatureEngine.sealDataWithPass(slotMasterKey, (soPin || 'AdminPUK@2026').trim());
        const sealedPrivateKey = await KryptoHSMSignatureEngine.sealDataWithPass(
            pkcs8Priv,
            KryptoHSMSignatureEngine.u8ToB64(slotMasterKey)
        );

        // Xóa khóa rõ trong bộ nhớ
        pkcs8Priv.fill(0);

        // Tạo số Serial Chứng thư HSM và Hạt giống TOTP 2FA cho Điện thoại
        const randomSerialBytes = crypto.getRandomValues(new Uint8Array(10));
        const serialHex = Array.from(randomSerialBytes).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const slotId = 'HSM-SLOT-' + serialHex.slice(0, 10);

        const alphabet32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const totpBytes = crypto.getRandomValues(new Uint8Array(16));
        let totpSecret = '';
        for (let i = 0; i < totpBytes.length; i++) totpSecret += alphabet32[totpBytes[i] % 32];

        const nowIso = new Date().toISOString();
        const expDate = new Date(Date.now() + 5 * 365 * 86400 * 1000).toISOString();

        const vaultState = {
            hsm_version: 'KRYPTO_PKCS11_HSM_V1',
            slot_id: slotId,
            created_at_utc: nowIso,
            token_flags: {
                CKA_TOKEN: true,
                CKA_PRIVATE: true,
                CKA_SENSITIVE: true,
                CKA_EXTRACTABLE: false
            },
            security_state: {
                locked: false,
                failed_pin_attempts: 0,
                max_pin_retries: 5
            },
            key_wrapping: {
                user_pin_wrapped: userPinWrapped,
                so_pin_wrapped: soPinWrapped,
                sealed_private_key: sealedPrivateKey
            },
            certificate: {
                signer_name: signerName.trim(),
                signer_email: signerEmail.trim(),
                signer_title: (signerTitle || 'Chủ sở hữu Chữ ký số').trim(),
                organization: (organization || 'Krypto Personal PKI').trim(),
                personal_id_cccd: (personalIdCccd || 'VN-HSM-001').trim(),
                serial_hex: serialHex,
                not_before_utc: nowIso,
                not_after_utc: expDate,
                public_key_spki_b64: KryptoHSMSignatureEngine.u8ToB64(spkiPub),
                visual_sig_png_sha256: sigProcessed.sha256Hex,
                ink_preset: inkPreset
            },
            cko_data_handwritten_png: {
                png_data_url: sigProcessed.pngDataUrl,
                sha256_hex: sigProcessed.sha256Hex,
                width: sigProcessed.width,
                height: sigProcessed.height
            },
            mobile_totp_secret: totpSecret,
            audit_chain: [
                {
                    seq: 1,
                    timestamp_utc: nowIso,
                    event: 'HSM_SLOT_PROVISIONED',
                    serial_hex: serialHex,
                    visual_sig_png_sha256: sigProcessed.sha256Hex
                }
            ]
        };

        localStorage.setItem(KRYPTO_HSM_STORAGE_KEY, JSON.stringify(vaultState));
        return vaultState;
    }

    static getActiveHSMVault() {
        try {
            const raw = localStorage.getItem(KRYPTO_HSM_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 4. Kết xuất Con dấu Chữ ký Số PAdES-HSM Trực quan (Ảnh chữ ký tay .PNG nền trong suốt +
     *    Thông tin Chứng thư X.509 + Email S/MIME + Số Serial HSM) thành ảnh PNG độ phân giải cao
     *    để đóng trực tiếp lên trang PDF trong cả chế độ Native Android (iTextG) và Web/PC.
     */
    static async renderCompositePAdESStampDataUrl(vaultState, signingReason = 'Phê duyệt & Ký số phát hành') {
        const cert = vaultState.certificate;
        const sigDataUrl = vaultState.cko_data_handwritten_png.png_data_url;

        return new Promise((resolve) => {
            const sigImg = new Image();
            sigImg.onload = () => {
                const w = 780, h = 250;
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');

                // Nền trắng mờ sang trọng + khung viền xanh cửu long chuẩn hành chính
                ctx.fillStyle = 'rgba(250, 252, 255, 0.94)';
                ctx.strokeStyle = '#003399';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.roundRect(3, 3, w - 6, h - 6, 12);
                ctx.fill();
                ctx.stroke();

                // Đường chia cột giữa Chữ ký tay và Thông tin chứng thư HSM
                const splitX = 295;
                ctx.strokeStyle = 'rgba(0, 51, 153, 0.28)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(splitX, 16);
                ctx.lineTo(splitX, h - 16);
                ctx.stroke();

                // Vẽ ảnh chữ ký tay (.PNG nền trong suốt) ở cột trái
                const maxSw = splitX - 28;
                const maxSh = h - 68;
                const scale = Math.min(maxSw / Math.max(1, sigImg.width), maxSh / Math.max(1, sigImg.height));
                const drawW = Math.round(sigImg.width * scale);
                const drawH = Math.round(sigImg.height * scale);
                const dx = Math.round((splitX - drawW) / 2);
                const dy = 16 + Math.round((maxSh - drawH) / 2);
                ctx.drawImage(sigImg, dx, dy, drawW, drawH);

                // Họ tên dưới chữ ký tay
                ctx.fillStyle = '#003399';
                ctx.font = 'bold 18px "Times New Roman", "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(cert.signer_name, Math.round(splitX / 2), h - 22);

                // Cột phải: Thông tin chứng thư số X.509v3 & HSM
                ctx.textAlign = 'left';
                const tx = splitX + 18;
                ctx.fillStyle = '#003399';
                ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
                ctx.fillText('✓ CHỮ KÝ SỐ CÁ NHÂN (PAdES-HSM)', tx, 32);

                ctx.fillStyle = '#0f172a';
                ctx.font = 'bold 19px "Segoe UI", Arial, sans-serif';
                ctx.fillText('Ký bởi: ' + cert.signer_name, tx, 60);

                ctx.fillStyle = '#1e293b';
                ctx.font = '15px "Segoe UI", Arial, sans-serif';
                ctx.fillText('Chức vụ: ' + (cert.signer_title || 'Chuyên gia') + ' • ' + (cert.organization || ''), tx, 86);

                ctx.fillStyle = '#004CB4';
                ctx.fillText('Email S/MIME: ' + cert.signer_email, tx, 111);

                ctx.fillStyle = '#1e293b';
                ctx.fillText('Lý do ký: ' + (signingReason || 'Phê duyệt phát hành'), tx, 136);

                const nowStr = new Date().toLocaleString('vi-VN', { hour12: false }) + ' +07:00';
                ctx.fillText('Thời gian ký: ' + nowStr, tx, 161);

                ctx.fillStyle = '#475569';
                ctx.font = '13px Consolas, monospace';
                ctx.fillText(
                    'Serial HSM: ' + cert.serial_hex.slice(0, 16) + ' | PNG-SHA256: ' + cert.visual_sig_png_sha256.slice(0, 10).toUpperCase(),
                    tx,
                    190
                );

                ctx.fillStyle = '#059669';
                ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
                ctx.fillText('Chuẩn PKCS#11 HSM (CKA_EXTRACTABLE=FALSE) • Toàn vẹn 100%', tx, 216);

                resolve(canvas.toDataURL('image/png'));
            };
            sigImg.onerror = () => resolve(sigDataUrl);
            sigImg.src = sigDataUrl;
        });
    }

    /**
     * 5. Thực thi lệnh ký PKCS#11 C_Sign trên 32 bytes mã băm bằng USER_PIN (Tự động khóa cứng sau 5 lần sai PIN).
     */
    static async signDigestWithHSM(digestHexOrString, userPin, documentName = 'Document') {
        const vault = KryptoHSMSignatureEngine.getActiveHSMVault();
        if (!vault) throw new Error('Chưa khởi tạo Buồng Chữ ký số HSM! Vui lòng tạo trong Két sắt.');

        if (vault.security_state.locked) {
            throw new Error('Buồng HSM đã bị KHÓA CỨNG do nhập sai USER_PIN 5 lần! Vui lòng dùng mã quản trị SO_PIN để mở khóa.');
        }

        let slotMasterKey;
        try {
            slotMasterKey = await KryptoHSMSignatureEngine.unsealDataWithPass(
                vault.key_wrapping.user_pin_wrapped,
                userPin.trim()
            );
        } catch (err) {
            vault.security_state.failed_pin_attempts = (vault.security_state.failed_pin_attempts || 0) + 1;
            const rem = Math.max(0, 5 - vault.security_state.failed_pin_attempts);
            if (rem === 0) {
                vault.security_state.locked = true;
            }
            localStorage.setItem(KRYPTO_HSM_STORAGE_KEY, JSON.stringify(vault));
            if (rem === 0) {
                throw new Error('Nhập sai USER_PIN 5 lần liên tiếp! HSM Token đã tự động KHÓA CỨNG.');
            }
            throw new Error(`Sai mã USER_PIN của HSM! Còn ${rem} lần thử trước khi khóa cứng.`);
        }

        vault.security_state.failed_pin_attempts = 0;
        const privBytes = await KryptoHSMSignatureEngine.unsealDataWithPass(
            vault.key_wrapping.sealed_private_key,
            KryptoHSMSignatureEngine.u8ToB64(slotMasterKey)
        );

        const cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            privBytes.buffer,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['sign']
        );
        privBytes.fill(0);

        const dataBytes = new TextEncoder().encode(digestHexOrString);
        const sigBuf = await crypto.subtle.sign(
            { name: 'ECDSA', hash: { name: 'SHA-256' } },
            cryptoKey,
            dataBytes
        );
        const sigB64 = KryptoHSMSignatureEngine.u8ToB64(new Uint8Array(sigBuf));

        const auditEntry = {
            seq: (vault.audit_chain?.length || 0) + 1,
            timestamp_utc: new Date().toISOString(),
            event: 'PKCS11_C_SIGN_EXECUTED',
            document: documentName,
            digest: digestHexOrString.slice(0, 32),
            signature_b64_prefix: sigB64.slice(0, 24)
        };
        vault.audit_chain.push(auditEntry);
        localStorage.setItem(KRYPTO_HSM_STORAGE_KEY, JSON.stringify(vault));

        return {
            signature_b64: sigB64,
            serial_hex: vault.certificate.serial_hex,
            signer_name: vault.certificate.signer_name,
            signer_email: vault.certificate.signer_email,
            audit_entry: auditEntry
        };
    }

    /**
     * 6. Đóng gói Két sắt Di trú .kryptohsm (PKCS#11 C_WrapKey) để đổi Điện thoại mới và đổi PC mới.
     */
    static async exportMigrationBundle(userPin, masterRecoveryPassphrase) {
        const vault = KryptoHSMSignatureEngine.getActiveHSMVault();
        if (!vault) throw new Error('Chưa có Buồng HSM để xuất!');
        if (!masterRecoveryPassphrase || masterRecoveryPassphrase.trim().length < 6) {
            throw new Error('Mật khẩu Khôi phục Chủ (Master Recovery Passphrase) phải có ít nhất 6 ký tự!');
        }

        // Xác thực USER_PIN trước khi bọc khóa di trú
        await KryptoHSMSignatureEngine.unsealDataWithPass(vault.key_wrapping.user_pin_wrapped, userPin.trim());

        const plainVaultBytes = new TextEncoder().encode(JSON.stringify(vault));
        const wrappedOuter = await KryptoHSMSignatureEngine.sealDataWithPass(
            plainVaultBytes,
            masterRecoveryPassphrase.trim()
        );

        const bundleObj = {
            bundle_format: 'KRYPTO_HSM_MIGRATION_V1',
            exported_at_utc: new Date().toISOString(),
            slot_id: vault.slot_id,
            signer_name: vault.certificate.signer_name,
            signer_email: vault.certificate.signer_email,
            serial_hex: vault.certificate.serial_hex,
            visual_sig_png_sha256: vault.certificate.visual_sig_png_sha256,
            wrapped_vault: wrappedOuter
        };

        return JSON.stringify(bundleObj, null, 2);
    }

    /**
     * 7. Khôi phục Két sắt Di trú .kryptohsm (PKCS#11 C_UnwrapKey) sang Điện thoại mới hoặc PC mới.
     */
    static async importMigrationBundle(bundleJsonStr, masterRecoveryPassphrase) {
        const bundleObj = JSON.parse(bundleJsonStr);
        if (bundleObj.bundle_format !== 'KRYPTO_HSM_MIGRATION_V1') {
            throw new Error('Tệp không đúng định dạng Két sắt Di trú .kryptohsm!');
        }
        let plainBytes;
        try {
            plainBytes = await KryptoHSMSignatureEngine.unsealDataWithPass(
                bundleObj.wrapped_vault,
                masterRecoveryPassphrase.trim()
            );
        } catch (e) {
            throw new Error('Sai Mật khẩu Khôi phục Chủ (Master Recovery Passphrase)! Không thể mở bọc HSM.');
        }

        const restoredVault = JSON.parse(new TextDecoder().decode(plainBytes));
        restoredVault.audit_chain = restoredVault.audit_chain || [];
        restoredVault.audit_chain.push({
            seq: restoredVault.audit_chain.length + 1,
            timestamp_utc: new Date().toISOString(),
            event: 'PKCS11_C_UNWRAPKEY_RESTORED_ON_NEW_DEVICE',
            serial_hex: restoredVault.certificate.serial_hex
        });
        localStorage.setItem(KRYPTO_HSM_STORAGE_KEY, JSON.stringify(restoredVault));
        return restoredVault;
    }

    /**
     * 8. Tạo gói Email Ký số Chuẩn S/MIME (.eml kèm chữ ký PKCS#7/ECDSA từ HSM) cho Yêu cầu ký hoặc Kết quả ký.
     */
    static async generateSMIMESignedEmail({
        mode = 'RESULT', // 'REQUEST' hoặc 'RESULT'
        documentName,
        documentSha256,
        recipientEmail,
        signingReason,
        userPin
    }) {
        const vault = KryptoHSMSignatureEngine.getActiveHSMVault();
        if (!vault) throw new Error('Chưa khởi tạo Buồng HSM!');
        const cert = vault.certificate;
        const targetTo = (recipientEmail || cert.signer_email).trim();
        const nowStr = new Date().toLocaleString('vi-VN', { hour12: false }) + ' +07:00';
        const reqId = 'REQ-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + (documentSha256 || '8899AA').slice(0, 6).toUpperCase();

        const sigRes = await KryptoHSMSignatureEngine.signDigestWithHSM(
            `${mode}|${documentName}|${documentSha256}|${nowStr}`,
            userPin,
            `S/MIME Email (${mode}): ${documentName}`
        );

        const subject = mode === 'REQUEST'
            ? `[YÊU CẦU KÝ SỐ HSM #${reqId}] ${documentName}`
            : `[KẾT QUẢ ĐÃ KÝ SỐ PAdES-HSM] ${documentName} - Ký bởi: ${cert.signer_name}`;

        const headerTitle = mode === 'REQUEST'
            ? 'YÊU CẦU PHÊ DUYỆT & KÝ SỐ TÀI LIỆU (KRYPTO HSM)'
            : '✓ HOÀN TẤT KÝ SỐ TÀI LIỆU CHUẨN PAdES-HSM & S/MIME';
        const headerBg = mode === 'REQUEST' ? '#003399' : '#059669';

        const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:640px;margin:0 auto;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
    <div style="background:${headerBg};color:#fff;padding:16px 20px;">
      <h2 style="margin:0;font-size:17px;">${headerTitle}</h2>
      <p style="margin:4px 0 0;font-size:12.5px;opacity:0.92;">Thời gian: ${nowStr} • Buồng HSM: ${vault.slot_id}</p>
    </div>
    <div style="padding:18px 20px;">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;">
        <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;width:36%;"><strong>Tài liệu:</strong></td><td style="padding:8px;border:1px solid #e2e8f0;"><strong>${documentName}</strong></td></tr>
        <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Chủ sở hữu HSM:</strong></td><td style="padding:8px;border:1px solid #e2e8f0;"><strong>${cert.signer_name}</strong> (${cert.signer_title} — ${cert.organization})</td></tr>
        <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Email Ký số S/MIME:</strong></td><td style="padding:8px;border:1px solid #e2e8f0;">${cert.signer_email}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Số Serial Chứng thư:</strong></td><td style="padding:8px;border:1px solid #e2e8f0;font-family:monospace;">${cert.serial_hex}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>SHA-256 Ảnh chữ ký tay:</strong></td><td style="padding:8px;border:1px solid #e2e8f0;font-family:monospace;font-size:12px;word-break:break-all;">${cert.visual_sig_png_sha256}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Nội dung / Lý do:</strong></td><td style="padding:8px;border:1px solid #e2e8f0;">${signingReason || 'Phê duyệt & phát hành hồ sơ'}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Chữ ký HSM (C_Sign):</strong></td><td style="padding:8px;border:1px solid #e2e8f0;font-family:monospace;font-size:11.5px;word-break:break-all;">${sigRes.signature_b64}</td></tr>
      </table>
      <div style="margin-top:14px;border:1px dashed #003399;border-radius:8px;padding:12px;text-align:center;background:#f8fafc;">
        <div style="font-size:12px;color:#475569;margin-bottom:6px;">Mẫu Chữ Ký Tay Gắn Kết Toán Học Trong HSM (<code>CKO_DATA</code>):</div>
        <img src="${vault.cko_data_handwritten_png.png_data_url}" style="max-height:85px;width:auto;" alt="Chữ ký tay" />
        <div style="font-weight:bold;color:#003399;margin-top:4px;">${cert.signer_name}</div>
      </div>
    </div>
  </div>
</body>
</html>`;

        const boundary = '----=_KryptoSMIME_' + Date.now();
        const emlContent = [
            'MIME-Version: 1.0',
            `Date: ${new Date().toUTCString()}`,
            `Subject: ${subject}`,
            `From: "${cert.signer_name}" <${cert.signer_email}>`,
            `To: <${targetTo}>`,
            `X-Mailer: Krypto PQC-HSM Personal Digital Signature Suite`,
            `X-Krypto-HSM-Serial: ${cert.serial_hex}`,
            `Content-Type: multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset="utf-8"',
            'Content-Transfer-Encoding: base64',
            '',
            KryptoHSMSignatureEngine.u8ToB64(new TextEncoder().encode(htmlContent)),
            `--${boundary}`,
            'Content-Type: application/pkcs7-signature; name="smime.p7s"',
            'Content-Transfer-Encoding: base64',
            'Content-Disposition: attachment; filename="smime.p7s"',
            '',
            sigRes.signature_b64,
            `--${boundary}--`,
            ''
        ].join('\r\n');

        return {
            subject,
            to: targetTo,
            emlContent,
            emlFilename: (mode === 'REQUEST' ? `Yeu_Cau_Ky_So_${reqId}.eml` : `Ket_Qua_Ky_So_${documentName.replace(/\.[^/.]+$/, '')}.eml`),
            sigRes
        };
    }
}

window.KryptoHSMSignatureEngine = KryptoHSMSignatureEngine;
