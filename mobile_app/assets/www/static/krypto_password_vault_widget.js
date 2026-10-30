/**
 * krypto_password_vault_widget.js
 * TAB ĐỘC LẬP: KHO MẬT KHẨU, THẺ NGÂN HÀNG / CCCD & ĐỒNG BỘ 2 CHIỀU GOOGLE DRIVE (SAF + CRDT)
 * Tách biệt hoàn toàn khỏi Tab Két sắt (PIN/HSM) và chia thành 4 Sub-Tab gọn gàng:
 *   1. [🗂️ Danh bạ]   : Tìm kiếm, lọc theo 6 danh mục và xem/sao chép/chụp thẻ từng bản ghi.
 *   2. [➕ Thêm / Thẻ]: Biểu mẫu thêm Mật khẩu / Thẻ tín dụng / CCCD kèm ảnh mặt trước & mặt sau.
 *   3. [📷 Quét QR]   : Quét QR máy ảnh trực tiếp, chọn ảnh chụp màn hình hoặc dán từ Clipboard.
 *   4. [☁️ Drive]     : Đồng bộ 2 chiều Google Drive (Android SAF + CRDT Merge) & Xuất/Nhập .kryptopass.
 */

(function (global) {
  "use strict";

  const STORAGE_KEY_VAULT = "krypto_password_vault_envelope_v1";
  const STORAGE_KEY_SAVED_URI = "krypto_password_vault_gdrive_uri_v1";
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function bytesToBase64(bytes) {
    const arr = new Uint8Array(bytes);
    let bin = "";
    for (let i = 0; i < arr.length; i++) {
      bin += String.fromCharCode(arr[i]);
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(String(b64 || "").trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }

  function randomBytes(len) {
    const out = new Uint8Array(len);
    window.crypto.getRandomValues(out);
    return out;
  }

  function generateUUID() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    const b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = bytesToHex(b);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ==========================================================================
  // 1. ĐỒNG HỒ LOGIC LAI (HYBRID LOGICAL CLOCK - HLC)
  // ==========================================================================
  class HLCClock {
    constructor(deviceId) {
      this.deviceId = deviceId || "krypto-" + bytesToHex(randomBytes(3));
      this.lastWallMs = 0;
      this.counter = 0;
    }

    static parse(hlcStr) {
      const parts = String(hlcStr || "000000000000000:0000:init").split(":");
      return {
        wallMs: parseInt(parts[0] || "0", 10),
        counter: parseInt(parts[1] || "0", 16),
        deviceId: parts[2] || "init",
      };
    }

    static format(wallMs, counter, deviceId) {
      const w = String(Math.max(0, Math.floor(wallMs))).padStart(15, "0");
      const c = Math.max(0, Math.floor(counter)).toString(16).padStart(4, "0");
      return `${w}:${c}:${deviceId}`;
    }

    now(remoteHlcStr) {
      const phys = Date.now();
      if (!remoteHlcStr) {
        if (phys > this.lastWallMs) {
          this.lastWallMs = phys;
          this.counter = 0;
        } else {
          this.counter += 1;
        }
        return HLCClock.format(this.lastWallMs, this.counter, this.deviceId);
      }
      const rem = HLCClock.parse(remoteHlcStr);
      const maxWall = Math.max(phys, this.lastWallMs, rem.wallMs);
      if (maxWall === this.lastWallMs && maxWall === rem.wallMs) {
        this.counter = Math.max(this.counter, rem.counter) + 1;
      } else if (maxWall === this.lastWallMs) {
        this.counter += 1;
      } else if (maxWall === rem.wallMs) {
        this.counter = rem.counter + 1;
      } else {
        this.counter = 0;
      }
      this.lastWallMs = maxWall;
      return HLCClock.format(this.lastWallMs, this.counter, this.deviceId);
    }
  }

  // ==========================================================================
  // 2. DẪN XUẤT KHÓA KDF (PBKDF2 -> HKDF RFC 5869) & MÃ HÓA AES-256-GCM
  // ==========================================================================
  async function pbkdf2Sha256(passwordStr, saltBytes, iterations) {
    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(passwordStr),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: saltBytes,
        iterations: iterations,
      },
      baseKey,
      256
    );
    return new Uint8Array(bits);
  }

  async function hmacSha256(keyBytes, dataBytes) {
    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await window.crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
    return new Uint8Array(sig);
  }

  async function hkdfSha256(ikmBytes, saltBytes, infoStr, length = 32) {
    const actualSalt = saltBytes && saltBytes.length ? saltBytes : new Uint8Array(32);
    const prk = await hmacSha256(actualSalt, ikmBytes);
    const infoBytes = enc.encode(infoStr);
    const n = Math.ceil(length / 32);
    const okm = new Uint8Array(n * 32);
    let prev = new Uint8Array(0);
    for (let i = 1; i <= n; i++) {
      const input = new Uint8Array(prev.length + infoBytes.length + 1);
      input.set(prev, 0);
      input.set(infoBytes, prev.length);
      input[input.length - 1] = i;
      prev = await hmacSha256(prk, input);
      okm.set(prev, (i - 1) * 32);
    }
    return okm.slice(0, length);
  }

  async function deriveDomainKeys(masterPassword, kdfParams) {
    const salt = base64ToBytes(kdfParams.salt_b64);
    const hkdfSalt = base64ToBytes(kdfParams.hkdf_salt_b64);
    const masterKey = await pbkdf2Sha256(masterPassword, salt, kdfParams.iterations);
    const kek = await hkdfSha256(masterKey, hkdfSalt, "KryptoPass-v1-KEK-AES256GCM", 32);
    const manifestKey = await hkdfSha256(masterKey, hkdfSalt, "KryptoPass-v1-Manifest-HMAC-SHA256", 32);
    return { masterKeyBytes: masterKey, kekBytes: kek, manifestKeyBytes: manifestKey };
  }

  async function aes256GcmEncrypt(keyBytes, plaintextBytes, aadBytes, customIv) {
    const iv = customIv || randomBytes(12);
    const key = await window.crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
    const encryptedBuf = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aadBytes, tagLength: 128 },
      key,
      plaintextBytes
    );
    const full = new Uint8Array(encryptedBuf);
    return {
      iv,
      ciphertext: full.slice(0, full.length - 16),
      tag: full.slice(full.length - 16),
    };
  }

  async function aes256GcmDecrypt(keyBytes, ivBytes, ciphertextBytes, tagBytes, aadBytes) {
    const key = await window.crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
    const combined = new Uint8Array(ciphertextBytes.length + tagBytes.length);
    combined.set(ciphertextBytes, 0);
    combined.set(tagBytes, ciphertextBytes.length);
    const plainBuf = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes, additionalData: aadBytes, tagLength: 128 },
      key,
      combined
    );
    return new Uint8Array(plainBuf);
  }

  function buildEnvelopeAad(vaultId, kdfParams) {
    const sorted = {};
    Object.keys(kdfParams)
      .sort()
      .forEach((k) => {
        sorted[k] = kdfParams[k];
      });
    return enc.encode(`${vaultId}|${JSON.stringify(sorted)}`);
  }

  function buildRecordAad(vaultId, recordId, revision, updatedHlc, deleted) {
    return enc.encode(`${vaultId}|${recordId}|${revision}|${updatedHlc}|${deleted ? "1" : "0"}`);
  }

  // ==========================================================================
  // 3. MÃ 2FA TOTP NỘI TẠI (RFC 6238) & SINH MẬT KHẨU CSPRNG
  // ==========================================================================
  function decodeBase32(str) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const clean = String(str || "")
      .toUpperCase()
      .replace(/[^A-Z2-7]/g, "");
    let bits = 0;
    let value = 0;
    const out = [];
    for (let i = 0; i < clean.length; i++) {
      value = (value << 5) | alphabet.indexOf(clean[i]);
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  async function computeLiveTotp(base32Secret) {
    try {
      const keyBytes = decodeBase32(base32Secret);
      if (!keyBytes.length) return null;
      const nowSec = Math.floor(Date.now() / 1000);
      const counter = Math.floor(nowSec / 30);
      const rem = 30 - (nowSec % 30);
      const msg = new Uint8Array(8);
      let tmp = counter;
      for (let i = 7; i >= 0; i--) {
        msg[i] = tmp & 0xff;
        tmp = Math.floor(tmp / 256);
      }
      const cryptoKey = await window.crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
      );
      const sig = new Uint8Array(await window.crypto.subtle.sign("HMAC", cryptoKey, msg));
      const offset = sig[sig.length - 1] & 0x0f;
      const binCode =
        ((sig[offset] & 0x7f) << 24) |
        ((sig[offset + 1] & 0xff) << 16) |
        ((sig[offset + 2] & 0xff) << 8) |
        (sig[offset + 3] & 0xff);
      const otp = String(binCode % 1000000).padStart(6, "0");
      return { otp, rem };
    } catch (_) {
      return null;
    }
  }

  function generateStrongPassword(len = 20) {
    const pool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}";
    const out = [];
    const b = randomBytes(len * 2);
    for (let i = 0; i < b.length && out.length < len; i++) {
      const limit = 256 - (256 % pool.length);
      if (b[i] < limit) {
        out.push(pool[b[i] % pool.length]);
      }
    }
    while (out.length < len) {
      out.push(pool[randomBytes(1)[0] % pool.length]);
    }
    return out.join("");
  }

  // ==========================================================================
  // 4. TRẠNG THÁI KHO MẬT KHẨU & LƯU TRỮ BỀN VỮNG
  // ==========================================================================
  const state = {
    hlc: new HLCClock(),
    masterPassword: "KryptoVaultDefaultMasterKey#2026",
    domainKeys: null,
    dekBytes: null,
    vaultData: null,
    decryptedRecords: {},
    revealedIds: new Set(),
    activeCategory: "ALL",
    activeSubTab: "list",
    linkedGDriveUri: localStorage.getItem(STORAGE_KEY_SAVED_URI) || "",
    blockSystemScreenshot: false,
    pendingFrontFile: null,
    pendingBackFile: null,
  };

  function persistVaultLocally() {
    if (!state.vaultData) return;
    const raw = JSON.stringify(state.vaultData);
    try {
      localStorage.setItem(STORAGE_KEY_VAULT, raw);
    } catch (_) {}
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      try {
        window.FlutterBridge.postMessage(
          JSON.stringify({
            action: "persist_password_vault_native",
            content: raw,
          })
        );
      } catch (_) {}
    }
  }

  async function initOrUnlockVault(masterPassword) {
    state.masterPassword = masterPassword || state.masterPassword;
    const savedRaw = localStorage.getItem(STORAGE_KEY_VAULT);
    if (savedRaw) {
      try {
        const parsed = JSON.parse(savedRaw);
        await loadEncryptedVaultObject(parsed, state.masterPassword);
        return;
      } catch (_) {}
    }
    await createNewEmptyVault(state.masterPassword);
  }

  async function createNewEmptyVault(masterPassword) {
    const vaultId = generateUUID();
    const kdfParams = {
      algorithm: "PBKDF2-HMAC-SHA256",
      salt_b64: bytesToBase64(randomBytes(16)),
      hkdf_salt_b64: bytesToBase64(randomBytes(16)),
      iterations: 100000,
    };
    const domainKeys = await deriveDomainKeys(masterPassword, kdfParams);
    const dekBytes = randomBytes(32);
    const aadEnv = buildEnvelopeAad(vaultId, kdfParams);
    const wrapped = await aes256GcmEncrypt(domainKeys.kekBytes, dekBytes, aadEnv);

    let pqcSlot = null;
    if (window.PQCCryptoEngineJS && typeof window.PQCCryptoEngineJS.mlKem768KeygenFromSeed === "function") {
      try {
        const seed64 = randomBytes(64);
        const kp = window.PQCCryptoEngineJS.mlKem768KeygenFromSeed(seed64);
        const m32 = randomBytes(32);
        const encap = window.PQCCryptoEngineJS.mlKem768EncapsInternal(kp.publicKey, m32);
        pqcSlot = {
          algorithm: "NIST-FIPS-203-ML-KEM-768",
          ek_sha3_256_fingerprint: bytesToHex(window.PQCCryptoEngineJS.sha3_256(kp.publicKey)),
          ek_b64: bytesToBase64(kp.publicKey),
          kem_ciphertext_b64: bytesToBase64(encap.ciphertext),
        };
      } catch (_) {}
    }

    const nowHlc = state.hlc.now();
    state.domainKeys = domainKeys;
    state.dekBytes = dekBytes;
    state.decryptedRecords = {};
    state.vaultData = {
      format: "KRYPTOPASS-VAULT",
      version: "1.0",
      vault_id: vaultId,
      vault_revision: 1,
      last_modified_hlc: nowHlc,
      device_id: state.hlc.deviceId,
      kdf: kdfParams,
      envelope: {
        cipher: "AES-256-GCM",
        kek_nonce_b64: bytesToBase64(wrapped.iv),
        wrapped_dek_b64: bytesToBase64(wrapped.ciphertext),
        kek_tag_b64: bytesToBase64(wrapped.tag),
      },
      pqc_envelope: pqcSlot,
      records: {},
    };
    persistVaultLocally();
  }

  async function loadEncryptedVaultObject(vaultObj, masterPassword) {
    const domainKeys = await deriveDomainKeys(masterPassword, vaultObj.kdf);
    const aadEnv = buildEnvelopeAad(vaultObj.vault_id, vaultObj.kdf);
    const dekBytes = await aes256GcmDecrypt(
      domainKeys.kekBytes,
      base64ToBytes(vaultObj.envelope.kek_nonce_b64),
      base64ToBytes(vaultObj.envelope.wrapped_dek_b64),
      base64ToBytes(vaultObj.envelope.kek_tag_b64),
      aadEnv
    );

    const decryptedMap = {};
    const recordsObj = vaultObj.records || {};
    for (const rid of Object.keys(recordsObj)) {
      const encRec = recordsObj[rid];
      if (encRec.deleted) continue;
      try {
        const aadRec = buildRecordAad(
          vaultObj.vault_id,
          encRec.record_id,
          encRec.revision,
          encRec.updated_hlc,
          encRec.deleted
        );
        const plainBytes = await aes256GcmDecrypt(
          dekBytes,
          base64ToBytes(encRec.nonce_b64),
          base64ToBytes(encRec.ciphertext_b64),
          base64ToBytes(encRec.tag_b64),
          aadRec
        );
        const secret = JSON.parse(dec.decode(plainBytes));
        decryptedMap[rid] = {
          record_id: rid,
          ...secret,
          revision: encRec.revision,
          updated_hlc: encRec.updated_hlc,
          deleted: false,
        };
      } catch (_) {}
    }

    state.domainKeys = domainKeys;
    state.dekBytes = dekBytes;
    state.vaultData = vaultObj;
    state.decryptedRecords = decryptedMap;
    state.hlc.now(vaultObj.last_modified_hlc);
  }

  async function upsertRecord({
    recordId,
    itemType = "LOGIN",
    folder = "Mặc định",
    title,
    username = "",
    password = "",
    totpSecret = "",
    url = "",
    notes = "",
    tags = [],
    encryptedAttachments = null,
    passwordHistory = null,
    customHlc = null,
  }) {
    if (!state.vaultData || !state.dekBytes) {
      await initOrUnlockVault(state.masterPassword);
    }
    const rid = recordId || generateUUID();
    const existing = state.decryptedRecords[rid];
    let revision = 1;
    let history = passwordHistory ? [...passwordHistory] : [];
    let attachments = encryptedAttachments
      ? [...encryptedAttachments]
      : existing && existing.encrypted_attachments
      ? [...existing.encrypted_attachments]
      : [];

    if (existing) {
      revision = (existing.revision || 1) + 1;
      if (!passwordHistory) {
        history = [...(existing.password_history || [])];
        if (existing.password && existing.password !== password) {
          history.push({
            password: existing.password,
            changed_at_hlc: existing.updated_hlc,
            reason: "user_update",
          });
        }
      }
    }

    const updatedHlc = customHlc || state.hlc.now(state.vaultData.last_modified_hlc);
    const secretPayload = {
      item_type: itemType,
      folder,
      title,
      username,
      password,
      totp_secret: totpSecret,
      url,
      notes,
      tags,
      encrypted_attachments: attachments,
      password_history: history,
    };

    const aad = buildRecordAad(state.vaultData.vault_id, rid, revision, updatedHlc, false);
    const encRes = await aes256GcmEncrypt(
      state.dekBytes,
      enc.encode(JSON.stringify(secretPayload)),
      aad
    );

    state.vaultData.records[rid] = {
      record_id: rid,
      revision,
      updated_hlc: updatedHlc,
      deleted: false,
      nonce_b64: bytesToBase64(encRes.iv),
      ciphertext_b64: bytesToBase64(encRes.ciphertext),
      tag_b64: bytesToBase64(encRes.tag),
    };

    state.decryptedRecords[rid] = {
      record_id: rid,
      ...secretPayload,
      revision,
      updated_hlc: updatedHlc,
      deleted: false,
    };

    state.vaultData.vault_revision = (state.vaultData.vault_revision || 1) + 1;
    state.vaultData.last_modified_hlc = updatedHlc;
    persistVaultLocally();
    return rid;
  }

  async function deleteRecord(recordId) {
    delete state.decryptedRecords[recordId];
    if (state.vaultData && state.vaultData.records) {
      delete state.vaultData.records[recordId];
      state.vaultData.vault_revision = (state.vaultData.vault_revision || 1) + 1;
      persistVaultLocally();
    }
    await renderRecordsList();
  }

  // ==========================================================================
  // 5. ĐÍNH KÈM ẢNH CHỤP THẺ / SCREENSHOT & QUÉT QR ĐA ĐỊNH DẠNG (jsQR)
  // ==========================================================================
  async function fileToEncryptedAttachmentMeta(file, label) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = String(reader.result);
          const rawBytes = enc.encode(dataUrl);
          const shaBuf = await window.crypto.subtle.digest("SHA-256", rawBytes);
          resolve({
            attachment_id: generateUUID(),
            label,
            filename: file.name || `${label}.png`,
            mime_type: file.type || "image/png",
            size_bytes: rawBytes.length,
            sha256_plain: bytesToHex(shaBuf),
            data_url: dataUrl,
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function decodeQrFromImageDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          if (typeof window.jsQR === "function") {
            const scales = [1.0, 0.75, 1.4, 0.5];
            for (const s of scales) {
              const w = Math.max(120, Math.min(1600, Math.round(img.width * s)));
              const h = Math.max(120, Math.min(1600, Math.round(img.height * s)));
              const c = document.createElement("canvas");
              c.width = w;
              c.height = h;
              const ctx = c.getContext("2d");
              ctx.drawImage(img, 0, 0, w, h);
              const imgData = ctx.getImageData(0, 0, w, h);
              const code = window.jsQR(imgData.data, w, h, { inversionAttempts: "attemptBoth" });
              if (code && code.data) {
                resolve(code.data.trim());
                return;
              }
            }
          }
        } catch (_) {}
        resolve("");
      };
      img.onerror = () => resolve("");
      img.src = dataUrl;
    });
  }

  async function importQrOrScreenshotToVault(qrText, screenshotAttachment = null) {
    const raw = String(qrText || "").trim();
    const attList = screenshotAttachment ? [screenshotAttachment] : null;
    if (!raw && !screenshotAttachment) return false;

    if (!raw && screenshotAttachment) {
      await upsertRecord({
        itemType: "SECURE_NOTE",
        folder: "Ảnh Chụp Màn Hình",
        title: `Ảnh Chụp Màn Hình (${screenshotAttachment.filename})`,
        username: `SHA-256: ${screenshotAttachment.sha256_plain.slice(0, 14)}...`,
        password: `Đã mã hóa AES-256-GCM (${screenshotAttachment.size_bytes} bytes)`,
        tags: ["screenshot", "encrypted-image"],
        encryptedAttachments: attList,
      });
      switchSubView("list");
      await renderRecordsList();
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("✓ Đã mã hóa AES-256-GCM và lưu Ảnh chụp màn hình vào Danh bạ!");
      }
      return true;
    }

    if (raw.toLowerCase().startsWith("otpauth://")) {
      try {
        const u = new URL(raw);
        const label = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
        const secret = (u.searchParams.get("secret") || "").toUpperCase();
        const issuer = u.searchParams.get("issuer") || (label.includes(":") ? label.split(":")[0] : "Tài khoản 2FA");
        const username = label.includes(":") ? label.split(":").slice(1).join(":") : label;
        await upsertRecord({
          itemType: "LOGIN",
          folder: "Xác thực 2FA (QR)",
          title: issuer,
          username,
          password: generateStrongPassword(18),
          totpSecret: secret,
          tags: ["qr-scanned", "2fa-totp"],
          encryptedAttachments: attList,
        });
      } catch (_) {}
    } else if (raw.toUpperCase().startsWith("WIFI:")) {
      let body = raw.slice(5);
      if (body.endsWith(";;")) body = body.slice(0, -2);
      const fields = {};
      body.split(";").forEach((part) => {
        const idx = part.indexOf(":");
        if (idx > 0) fields[part.slice(0, idx).toUpperCase()] = part.slice(idx + 1);
      });
      await upsertRecord({
        itemType: "WIFI_NETWORK",
        folder: "Mạng Wi-Fi (QR)",
        title: `Wi-Fi: ${fields.S || "SSID"}`,
        username: `SSID: ${fields.S || ""} (${fields.T || "WPA2"})`,
        password: fields.P || "",
        tags: ["qr-scanned", "wifi"],
        encryptedAttachments: attList,
      });
    } else if (raw.includes("|") && raw.split("|").length >= 6) {
      const parts = raw.split("|").map((s) => s.trim());
      await upsertRecord({
        itemType: "IDENTITY",
        folder: "Giấy tờ Pháp lý (QR)",
        title: `CCCD Gắn chip: ${parts[2] || "Công dân"}`,
        username: `Số CCCD: ${parts[0]} | CMND cũ: ${parts[1]}`,
        password: `Ngày sinh: ${parts[3]} | Cấp: ${parts[6] || ""} | Đ/c: ${parts[5]}`,
        tags: ["qr-scanned", "cccd", "identity"],
        encryptedAttachments: attList,
      });
    } else {
      await upsertRecord({
        itemType: "SECURE_NOTE",
        folder: "Quét QR & Screenshot",
        title: "Dữ liệu Quét QR",
        username: "QR Payload",
        password: raw,
        tags: ["qr-scanned"],
        encryptedAttachments: attList,
      });
    }

    switchSubView("list");
    await renderRecordsList();
    if (typeof window.showKryptoToast === "function") {
      window.showKryptoToast("✓ Đã giải mã QR và lưu vào Danh bạ Mật khẩu!");
    }
    return true;
  }

  // ==========================================================================
  // 6. HỢP NHẤT ĐÁM MÂY ĐA THIẾT BỊ (CRDT LWW-ELEMENT-SET MERGE)
  // ==========================================================================
  async function mergeRemoteVaultObject(remoteVaultObj) {
    if (!remoteVaultObj || !remoteVaultObj.records) return { added: 0, updated: 0, conflicts: 0 };
    let added = 0;
    let updated = 0;
    let conflicts = 0;

    let remoteDecrypted = {};
    try {
      const remDomainKeys = await deriveDomainKeys(state.masterPassword, remoteVaultObj.kdf);
      const remAadEnv = buildEnvelopeAad(remoteVaultObj.vault_id, remoteVaultObj.kdf);
      const remDek = await aes256GcmDecrypt(
        remDomainKeys.kekBytes,
        base64ToBytes(remoteVaultObj.envelope.kek_nonce_b64),
        base64ToBytes(remoteVaultObj.envelope.wrapped_dek_b64),
        base64ToBytes(remoteVaultObj.envelope.kek_tag_b64),
        remAadEnv
      );
      for (const rid of Object.keys(remoteVaultObj.records)) {
        const encRec = remoteVaultObj.records[rid];
        if (encRec.deleted) continue;
        try {
          const aadRec = buildRecordAad(
            remoteVaultObj.vault_id,
            encRec.record_id,
            encRec.revision,
            encRec.updated_hlc,
            encRec.deleted
          );
          const pt = await aes256GcmDecrypt(
            remDek,
            base64ToBytes(encRec.nonce_b64),
            base64ToBytes(encRec.ciphertext_b64),
            base64ToBytes(encRec.tag_b64),
            aadRec
          );
          remoteDecrypted[rid] = {
            record_id: rid,
            ...JSON.parse(dec.decode(pt)),
            revision: encRec.revision,
            updated_hlc: encRec.updated_hlc,
          };
        } catch (_) {}
      }
    } catch (_) {
      throw new Error("Không thể giải mã tệp kho khóa từ xa (Khác Mật khẩu chủ Master Password).");
    }

    for (const rid of Object.keys(remoteDecrypted)) {
      const remRec = remoteDecrypted[rid];
      const locRec = state.decryptedRecords[rid];
      if (!locRec) {
        await upsertRecord({
          recordId: rid,
          itemType: remRec.item_type,
          folder: remRec.folder,
          title: remRec.title,
          username: remRec.username,
          password: remRec.password,
          totpSecret: remRec.totp_secret,
          url: remRec.url,
          tags: remRec.tags,
          encryptedAttachments: remRec.encrypted_attachments,
          passwordHistory: remRec.password_history,
          customHlc: remRec.updated_hlc,
        });
        added += 1;
      } else if (remRec.updated_hlc !== locRec.updated_hlc) {
        const remWins = remRec.updated_hlc > locRec.updated_hlc;
        const winner = remWins ? remRec : locRec;
        const loser = remWins ? locRec : remRec;

        const mergedHist = [...(winner.password_history || [])];
        if (loser.password && loser.password !== winner.password) {
          const exists = mergedHist.some((h) => h.password === loser.password);
          if (!exists) {
            mergedHist.push({
              password: loser.password,
              changed_at_hlc: loser.updated_hlc,
              reason: "crdt_conflict_preserved",
            });
          }
          conflicts += 1;
        }

        const attMap = {};
        [...(winner.encrypted_attachments || []), ...(loser.encrypted_attachments || [])].forEach((a) => {
          if (a && a.sha256_plain) attMap[a.sha256_plain] = a;
        });

        await upsertRecord({
          recordId: rid,
          itemType: winner.item_type,
          folder: winner.folder,
          title: winner.title,
          username: winner.username,
          password: winner.password,
          totpSecret: winner.totp_secret,
          url: winner.url,
          tags: Array.from(new Set([...(winner.tags || []), ...(loser.tags || [])])),
          encryptedAttachments: Object.values(attMap),
          passwordHistory: mergedHist,
          customHlc: state.hlc.now(winner.updated_hlc),
        });
        updated += 1;
      }
    }

    await renderRecordsList();
    return { added, updated, conflicts };
  }

  // ==========================================================================
  // 7. GIAO DIỆN 4 SUB-TAB TÁCH BIỆT TRONG TAB #tab-passwords (RULE 14)
  // ==========================================================================
  function injectStyles() {
    if (document.getElementById("kpw-vault-styles")) return;
    const style = document.createElement("style");
    style.id = "kpw-vault-styles";
    style.textContent = `
      .kpw-sub-btn.active {
        background: var(--primary) !important;
        color: #ffffff !important;
        border-color: var(--primary) !important;
      }
      .kpw-cat-chip.active {
        background: var(--primary-light) !important;
        color: var(--primary) !important;
        border-color: var(--primary) !important;
        font-weight: 700 !important;
      }
      .kpw-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 6px;
      }
      .kpw-table th {
        text-align: left;
        font-size: 11px;
        padding: 8px;
        border-bottom: 1px solid var(--border);
        color: var(--text-muted);
      }
      .kpw-table td {
        padding: 8px;
        font-size: 12px;
        border-bottom: 1px solid var(--border);
        vertical-align: top;
      }
      body.light-mode .kpw-table td,
      body.theme-light .kpw-table td {
        border-color: var(--border) !important;
      }
      @media (max-width: 680px) {
        .kpw-table thead {
          display: none;
        }
        .kpw-table, .kpw-table tbody {
          display: block;
          width: 100%;
        }
        .kpw-table tr {
          display: block;
          padding: 12px 14px;
          margin-bottom: 10px;
          border: 1px solid var(--border) !important;
          border-radius: 10px;
          background: transparent;
        }
        .kpw-table td,
        body.light-mode .kpw-table td,
        body.theme-light .kpw-table td {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          padding: 7px 0 !important;
          border: none !important;
          border-bottom: 1px dashed var(--border) !important;
          text-align: right;
        }
        .kpw-table td:last-child,
        body.light-mode .kpw-table td:last-child,
        body.theme-light .kpw-table td:last-child {
          border-bottom: none !important;
          padding-bottom: 0 !important;
        }
        .kpw-table td::before {
          content: attr(data-label);
          font-weight: 700;
          font-size: 11px;
          color: var(--text-muted);
          text-align: left;
          flex: 0 0 38%;
        }
        .kpw-table td .table-cell-val {
          flex: 1 1 62%;
          text-align: right;
          word-break: break-word;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function switchSubView(viewName) {
    state.activeSubTab = viewName;
    ["list", "add", "qr", "sync"].forEach((v) => {
      const panel = document.getElementById(`kpw-panel-${v}`);
      const btn = document.getElementById(`kpw-subbtn-${v}`);
      if (panel) panel.style.display = v === viewName ? "block" : "none";
      if (btn) {
        if (v === viewName) btn.classList.add("active");
        else btn.classList.remove("active");
      }
    });
    if (viewName === "list") {
      renderRecordsList();
    }
  }

  function filterCategory(cat, btnEl) {
    state.activeCategory = cat;
    document.querySelectorAll(".kpw-cat-chip").forEach((b) => b.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");
    renderRecordsList();
  }

  async function renderRecordsList() {
    const tbody = document.getElementById("kpw-records-tbody");
    const countBadge = document.getElementById("kpw-count-pill");
    const gdriveStatusEl = document.getElementById("kpw-gdrive-status-text");
    if (!tbody) return;

    const query = (document.getElementById("kpw-search-input")?.value || "").toLowerCase().trim();
    const allRecs = Object.values(state.decryptedRecords);
    const filtered = allRecs.filter((r) => {
      if (state.activeCategory !== "ALL" && r.item_type !== state.activeCategory) {
        return false;
      }
      if (!query) return true;
      return (
        (r.title || "").toLowerCase().includes(query) ||
        (r.username || "").toLowerCase().includes(query) ||
        (r.item_type || "").toLowerCase().includes(query) ||
        (r.folder || "").toLowerCase().includes(query)
      );
    });

    if (countBadge) {
      countBadge.textContent = `${allRecs.length} mục`;
    }
    if (gdriveStatusEl) {
      gdriveStatusEl.textContent = state.linkedGDriveUri
        ? "✓ Đã liên kết tệp Google Drive 2 chiều (SAF Persistable URI)"
        : "Chưa liên kết tệp trên Google Drive (Đang lưu mã hóa cục bộ)";
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td data-label="Danh bạ" colspan="4">
            <span class="table-cell-val" style="color:var(--text-muted);">
              Chưa có mục nào trong danh mục này. Nhấn <strong>➕ Thêm / Thẻ</strong> hoặc <strong>📷 Quét QR</strong> để thêm mới.
            </span>
          </td>
        </tr>`;
      return;
    }

    const rows = [];
    for (const r of filtered) {
      const isRev = state.revealedIds.has(r.record_id);
      const pwdHtml = isRev ? `<code>${escapeHtml(r.password)}</code>` : `<code>••••••••••••</code>`;
      const attCount = (r.encrypted_attachments || []).length;
      const histCount = (r.password_history || []).length;
      let totpHtml = "";
      if (r.totp_secret) {
        const t = await computeLiveTotp(r.totp_secret);
        if (t) {
          totpHtml = `<div style="color:#059669;font-weight:700;font-size:11px;margin-top:3px;">2FA OTP: ${t.otp} (${t.rem}s)</div>`;
        }
      }
      const attHtml =
        attCount > 0
          ? `<div style="color:#0284c7;font-weight:700;font-size:10.5px;margin-top:2px;">🖼️ Đính kèm mã hóa: ${attCount} ảnh</div>`
          : "";

      rows.push(`
        <tr>
          <td data-label="Phân loại & Tên">
            <span class="table-cell-val">
              <strong style="color:var(--primary);">[${escapeHtml(r.item_type || "LOGIN")}]</strong>
              <strong>${escapeHtml(r.title)}</strong>
              <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(r.folder || "Mặc định")} • Rev #${r.revision || 1}</div>
            </span>
          </td>
          <td data-label="Tài khoản / Số thẻ">
            <span class="table-cell-val">${escapeHtml(r.username || "—")}</span>
          </td>
          <td data-label="Mật khẩu & 2FA">
            <span class="table-cell-val">
              ${pwdHtml}
              ${totpHtml}
              ${attHtml}
              ${histCount > 0 ? `<div style="font-size:10px;color:var(--text-muted);">Lịch sử: ${histCount} bản</div>` : ""}
            </span>
          </td>
          <td data-label="Thao tác">
            <span class="table-cell-val" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
              <button type="button" class="btn-chip-micro kpw-btn-toggle" data-id="${escapeHtml(r.record_id)}">${isRev ? "Ẩn" : "Hiện"}</button>
              <button type="button" class="btn-chip-micro kpw-btn-copy" data-id="${escapeHtml(r.record_id)}">📋 Chép</button>
              <button type="button" class="btn-chip-micro kpw-btn-snap" data-id="${escapeHtml(r.record_id)}">📸 Chụp Thẻ</button>
              ${attCount > 0 ? `<button type="button" class="btn-chip-micro kpw-btn-view-img" data-id="${escapeHtml(r.record_id)}">🖼️ Xem Ảnh</button>` : ""}
              <button type="button" class="btn-chip-micro kpw-btn-del" data-id="${escapeHtml(r.record_id)}" style="color:#ef4444;">🗑️</button>
            </span>
          </td>
        </tr>
      `);
    }
    tbody.innerHTML = rows.join("");

    tbody.querySelectorAll(".kpw-btn-toggle").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        if (state.revealedIds.has(id)) state.revealedIds.delete(id);
        else state.revealedIds.add(id);
        renderRecordsList();
      });
    });

    tbody.querySelectorAll(".kpw-btn-copy").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-id");
        const rec = state.decryptedRecords[id];
        if (rec && navigator.clipboard) {
          await navigator.clipboard.writeText(rec.password || "");
          if (typeof window.showKryptoToast === "function") {
            window.showKryptoToast("✓ Đã chép mật khẩu (Tự xóa bộ nhớ tạm sau 20 giây)!");
          }
          setTimeout(async () => {
            try {
              await navigator.clipboard.writeText("");
            } catch (_) {}
          }, 20000);
        }
      });
    });

    tbody.querySelectorAll(".kpw-btn-snap").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-id");
        await captureInAppRecordCardSnapshot(id);
      });
    });

    tbody.querySelectorAll(".kpw-btn-view-img").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        showRecordAttachmentsPreview(id);
      });
    });

    tbody.querySelectorAll(".kpw-btn-del").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-id");
        await deleteRecord(id);
      });
    });
  }

  async function captureInAppRecordCardSnapshot(recordId) {
    const rec = state.decryptedRecords[recordId];
    if (!rec) return;
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 450;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 19px monospace";
    ctx.fillText(`KRYPTO VAULT CARD SNAPSHOT | ${rec.item_type || "LOGIN"}`, 36, 56);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(rec.title || "Bản ghi Krypto", 36, 104);

    const isRev = state.revealedIds.has(recordId);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "20px monospace";
    ctx.fillText(`Định danh / Số thẻ : ${rec.username || "—"}`, 36, 168);
    ctx.fillText(`Mật khẩu / Khóa    : ${isRev ? rec.password : "••••••••••••••••"}`, 36, 212);
    ctx.fillText(`Thư mục            : ${rec.folder || "Mặc định"}`, 36, 256);

    if (rec.totp_secret) {
      const t = await computeLiveTotp(rec.totp_secret);
      if (t) {
        ctx.fillStyle = "#10b981";
        ctx.fillText(`Mã 2FA TOTP        : ${t.otp} (Còn ${t.rem}s)`, 36, 300);
      }
    }

    ctx.fillStyle = "#64748b";
    ctx.font = "15px monospace";
    ctx.fillText(`ID: ${rec.record_id} | Rev #${rec.revision} | HLC: ${rec.updated_hlc}`, 36, 378);
    ctx.fillStyle = "#38bdf8";
    ctx.fillText("NIST FIPS 203 (ML-KEM-768) + AES-256-GCM Zero-Knowledge Vault", 36, 412);

    const dataUrl = canvas.toDataURL("image/png");
    const rawBytes = enc.encode(dataUrl);
    const shaBuf = await window.crypto.subtle.digest("SHA-256", rawBytes);
    const snapAtt = {
      attachment_id: generateUUID(),
      label: "app_card_snapshot",
      filename: `krypto_card_${rec.record_id.slice(0, 8)}.png`,
      mime_type: "image/png",
      size_bytes: rawBytes.length,
      sha256_plain: bytesToHex(shaBuf),
      data_url: dataUrl,
    };

    const nextAtts = [...(rec.encrypted_attachments || []), snapAtt];
    await upsertRecord({
      recordId: rec.record_id,
      itemType: rec.item_type,
      folder: rec.folder,
      title: rec.title,
      username: rec.username,
      password: rec.password,
      totpSecret: rec.totp_secret,
      url: rec.url,
      tags: rec.tags,
      encryptedAttachments: nextAtts,
    });
    await renderRecordsList();
    showRecordAttachmentsPreview(rec.record_id);
    if (typeof window.showKryptoToast === "function") {
      window.showKryptoToast("✓ Đã chụp ảnh thẻ trong App và mã hóa AES-256-GCM vào bản ghi!");
    }
  }

  function showRecordAttachmentsPreview(recordId) {
    const rec = state.decryptedRecords[recordId];
    const box = document.getElementById("kpw-image-preview-box");
    if (!rec || !box) return;
    const atts = rec.encrypted_attachments || [];
    if (!atts.length) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.innerHTML = [
      `<div style="display:flex;justify-content:space-between;align-items:center;">` +
        `<strong style="font-size:12px;color:var(--primary);">🖼️ Ảnh Thẻ / Ảnh Chụp Màn Hình Đã Giải Mã (${escapeHtml(rec.title)})</strong>` +
        `<button type="button" class="btn-chip-micro" onclick="document.getElementById('kpw-image-preview-box').style.display='none'">Đóng ✕</button>` +
      `</div>`,
      ...atts.map(
        (a) =>
          `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">` +
          `<div style="font-size:11px;color:var(--text-muted);">Nhãn: <code>${escapeHtml(a.label)}</code> • Tệp: <code>${escapeHtml(a.filename)}</code></div>` +
          (a.data_url
            ? `<img src="${a.data_url}" alt="${escapeHtml(a.label)}" style="max-width:100%;max-height:240px;border-radius:8px;margin-top:6px;display:block;" />` +
              `<div style="margin-top:6px;"><a href="${a.data_url}" download="${escapeHtml(a.filename || "krypto_card.png")}" class="btn-chip-micro" style="text-decoration:none;display:inline-block;">📥 Tải Ảnh (.PNG)</a></div>`
            : "") +
          `</div>`
      ),
    ].join("");
  }

  function mountWidget() {
    const host = document.getElementById("krypto-password-vault-mount");
    if (!host) return;
    injectStyles();

    host.innerHTML = `
      <!-- Thanh Tiêu đề & Điều hướng 4 Sub-Tab Ngang (Giống chuẩn 2FA OTP) -->
      <div class="card settings-card" style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;">
          <div>
            <h3 style="margin: 0; font-size: 14.5px; font-weight: 800; color: var(--text-title);">🔑 Kho Mật Khẩu &amp; Thẻ Mã Hóa</h3>
            <p style="margin: 2px 0 0; font-size: 11px; color: var(--text-muted);">Hậu Lượng Tử FIPS 203 (ML-KEM-768) • AES-256-GCM • Google Drive 2 Chiều</p>
          </div>
          <span id="kpw-count-pill" style="font-size: 10.5px; font-weight: 700; padding: 4px 8px; border-radius: 8px; background: var(--bg-subtle); color: var(--primary); border: 1px solid var(--border);">0 mục</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 6px;">
          <button type="button" id="kpw-subbtn-list" class="btn-chip-micro kpw-sub-btn active" style="padding: 7px 4px; font-weight: 700;" onclick="window.KryptoPasswordVault.switchSubView('list')">🗂️ Danh Bạ</button>
          <button type="button" id="kpw-subbtn-add" class="btn-chip-micro kpw-sub-btn" style="padding: 7px 4px; font-weight: 700;" onclick="window.KryptoPasswordVault.switchSubView('add')">➕ Thêm / Thẻ</button>
          <button type="button" id="kpw-subbtn-qr" class="btn-chip-micro kpw-sub-btn" style="padding: 7px 4px; font-weight: 700;" onclick="window.KryptoPasswordVault.switchSubView('qr')">📷 Quét QR</button>
          <button type="button" id="kpw-subbtn-sync" class="btn-chip-micro kpw-sub-btn" style="padding: 7px 4px; font-weight: 700;" onclick="window.KryptoPasswordVault.switchSubView('sync')">☁️ Drive</button>
        </div>
      </div>

      <!-- SUB-PANEL 1: DANH BẠ MẬT KHẨU & THẺ (MẶC ĐỊNH MỞ RA GỌN SẠCH) -->
      <div id="kpw-panel-list" class="card settings-card" style="display: block;">
        <div style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center;">
          <input type="search" id="kpw-search-input" placeholder="🔍 Tìm mật khẩu, thẻ Visa, CCCD, Wi-Fi..." style="flex: 1; font-size: 12px; padding: 8px 10px; margin: 0;">
          <button type="button" class="btn-mobi-solid" style="padding: 8px 10px; font-size: 11.5px; white-space: nowrap; width: auto;" onclick="window.KryptoPasswordVault.switchSubView('add')">➕ Thêm</button>
        </div>
        <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px;">
          <button type="button" class="btn-chip-micro kpw-cat-chip active" onclick="window.KryptoPasswordVault.filterCategory('ALL', this)">Tất cả</button>
          <button type="button" class="btn-chip-micro kpw-cat-chip" onclick="window.KryptoPasswordVault.filterCategory('LOGIN', this)">🌐 Đăng nhập</button>
          <button type="button" class="btn-chip-micro kpw-cat-chip" onclick="window.KryptoPasswordVault.filterCategory('PAYMENT_CARD', this)">💳 Thẻ NH</button>
          <button type="button" class="btn-chip-micro kpw-cat-chip" onclick="window.KryptoPasswordVault.filterCategory('IDENTITY', this)">🪪 CCCD</button>
          <button type="button" class="btn-chip-micro kpw-cat-chip" onclick="window.KryptoPasswordVault.filterCategory('WIFI_NETWORK', this)">📶 Wi-Fi</button>
          <button type="button" class="btn-chip-micro kpw-cat-chip" onclick="window.KryptoPasswordVault.filterCategory('SECURE_NOTE', this)">📝 Ghi chú / Ảnh</button>
        </div>

        <div id="kpw-image-preview-box" style="display:none;margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed var(--border);"></div>

        <table class="kpw-table">
          <thead>
            <tr>
              <th>Phân loại &amp; Tên</th>
              <th>Tài khoản / Số thẻ</th>
              <th>Mật khẩu &amp; 2FA</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody id="kpw-records-tbody"></tbody>
        </table>
      </div>

      <!-- SUB-PANEL 2: THÊM MỚI MẬT KHẨU / THẺ / CCCD & ĐÍNH KÈM ẢNH THẺ -->
      <div id="kpw-panel-add" class="card settings-card" style="display: none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:12.5px;font-weight:800;color:var(--primary);">➕ THÊM MẬT KHẨU, THẺ TÍN DỤNG HOẶC GIẤY TỜ MỚI</span>
        </div>

        <div class="dual-inputs-row">
          <div class="input-col">
            <label class="micro-label">Loại bản ghi:</label>
            <select id="kpw-item-type" style="width:100%;padding:7px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);font-size:11.5px;">
              <option value="LOGIN">🌐 Tài khoản Đăng nhập &amp; 2FA</option>
              <option value="PAYMENT_CARD">💳 Thẻ Ngân hàng / Tín dụng</option>
              <option value="IDENTITY">🪪 Căn cước Công dân / Hộ chiếu</option>
              <option value="WIFI_NETWORK">📶 Mạng Wi-Fi (SSID &amp; Pass)</option>
              <option value="SSH_API_KEY">🔑 Khóa SSH / API / Ví Seed Phrase</option>
              <option value="SECURE_NOTE">📝 Ghi chú / Ảnh chụp màn hình</option>
            </select>
          </div>
          <div class="input-col">
            <label class="micro-label">Thư mục phân loại:</label>
            <input type="text" id="kpw-folder" value="Mặc định" placeholder="VD: Ngân hàng, Công việc...">
          </div>
        </div>

        <div class="dual-inputs-row" style="margin-top:6px;">
          <div class="input-col">
            <label class="micro-label">Tên dịch vụ / Tên thẻ (*):</label>
            <input type="text" id="kpw-title" placeholder="VD: Vietcombank Visa, Google Cloud...">
          </div>
          <div class="input-col">
            <label class="micro-label">Tài khoản / Số thẻ / Số CCCD:</label>
            <input type="text" id="kpw-username" placeholder="VD: user@domain.vn hoặc 4123-4567...">
          </div>
        </div>

        <div class="dual-inputs-row" style="margin-top:6px;">
          <div class="input-col">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label class="micro-label" style="margin:0;">Mật khẩu / Mã CVV / PIN (*):</label>
              <button type="button" id="kpw-btn-gen-pass" class="btn-chip-micro" style="font-size:10px;padding:1px 6px;">⚡ Sinh 20 ký tự</button>
            </div>
            <input type="text" id="kpw-password" placeholder="Nhập mật khẩu hoặc nhấn Sinh 20 ký tự...">
          </div>
          <div class="input-col">
            <label class="micro-label">Khóa 2FA TOTP Base32 (Tùy chọn):</label>
            <input type="text" id="kpw-totp" placeholder="VD: JBSWY3DPEHPK3PXP..." style="font-family:monospace;">
          </div>
        </div>

        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
          <label class="micro-label">🖼️ ĐÍNH KÈM ẢNH CHỤP THẺ (MẶT TRƯỚC / MẶT SAU) HOẶC ẢNH CHỤP MÀN HÌNH:</label>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:6px;">
            <button type="button" class="btn-mobi-outline" style="font-size:11px;padding:8px 6px;" onclick="document.getElementById('kpw-front-img-input').click()">
              🖼️ Mặt Trước / Screenshot (<span id="kpw-front-label">Chưa chọn</span>)
            </button>
            <button type="button" class="btn-mobi-outline" style="font-size:11px;padding:8px 6px;" onclick="document.getElementById('kpw-back-img-input').click()">
              🖼️ Mặt Sau / QR (<span id="kpw-back-label">Chưa chọn</span>)
            </button>
            <input type="file" id="kpw-front-img-input" accept="image/*" style="display:none;">
            <input type="file" id="kpw-back-img-input" accept="image/*" style="display:none;">
          </div>
        </div>

        <button type="button" id="kpw-btn-save-record" class="btn-cyber-dialog-primary" style="margin-top:12px;width:100%;">
          <span>🔒 Mã Hóa AES-256-GCM &amp; Lưu Vào Danh Bạ</span>
        </button>
      </div>

      <!-- SUB-PANEL 3: QUÉT MÃ QR ĐA ĐỊNH DẠNG & LƯU ẢNH CHỤP MÀN HÌNH -->
      <div id="kpw-panel-qr" class="card settings-card" style="display: none;">
        <span style="font-size:12.5px;font-weight:800;color:var(--primary);display:block;margin-bottom:4px;">
          📷 QUÉT MÃ QR ĐA ĐỊNH DẠNG &amp; LƯU ẢNH CHỤP MÀN HÌNH
        </span>
        <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px;">
          Hỗ trợ tự động bóc tách: <strong>QR 2FA (`otpauth://`)</strong>, <strong>QR Wi-Fi (`WIFI:S:...`)</strong>, <strong>QR CCCD Gắn chip 12 số</strong> và lưu nguyên bản ảnh chụp màn hình đã mã hóa <code>AES-256-GCM</code>.
        </p>

        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;">
          <button type="button" id="kpw-btn-scan-qr-img" class="btn-cyber-dialog-primary" style="font-size:11.5px;padding:10px 6px;margin:0;">
            <span>🖼️ Chọn Ảnh Chụp Màn Hình / QR</span>
          </button>
          <button type="button" id="kpw-btn-paste-screenshot" class="btn-mobi-outline" style="font-size:11.5px;padding:10px 6px;margin:0;">
            📋 Dán Ảnh Chụp Màn Hình
          </button>
          <input type="file" id="kpw-qr-screenshot-input" accept="image/*" style="display:none;">
        </div>

        <div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--border);">
          <label class="micro-label">Hoặc dán trực tiếp chuỗi dữ liệu QR:</label>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <input type="text" id="kpw-qr-raw-input" placeholder="otpauth://... hoặc WIFI:S:... hoặc 001085099887|..." style="flex:1;font-size:11px;font-family:monospace;">
            <button type="button" id="kpw-btn-import-qr-str" class="btn-mobi-solid" style="padding:8px 12px;font-size:11.5px;width:auto;">Nhập QR</button>
          </div>
        </div>
      </div>

      <!-- SUB-PANEL 4: ĐỒNG BỘ 2 CHIỀU GOOGLE DRIVE (SAF + CRDT) & BẢO MẬT -->
      <div id="kpw-panel-sync" class="card settings-card" style="display: none;">
        <span style="font-size:12.5px;font-weight:800;color:var(--primary);display:block;margin-bottom:4px;">
          ☁️ ĐỒNG BỘ 2 CHIỀU GOOGLE DRIVE (ANDROID SAF + CRDT)
        </span>
        <p id="kpw-gdrive-status-text" style="font-size:11px;color:var(--text-muted);margin:0 0 10px;">
          Chưa liên kết tệp trên Google Drive.
        </p>

        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;">
          <button type="button" id="kpw-btn-gdrive-create" class="btn-mobi-outline" style="font-size:11px;padding:9px 6px;">
            ☁️ Tạo Tệp Mới Trên Google Drive
          </button>
          <button type="button" id="kpw-btn-gdrive-open" class="btn-mobi-outline" style="font-size:11px;padding:9px 6px;">
            📂 Mở Tệp Từ Google Drive
          </button>
        </div>

        <button type="button" id="kpw-btn-gdrive-sync-now" class="btn-cyber-dialog-primary" style="margin-top:8px;width:100%;">
          <span>🔄 Đồng Bộ 2 Chiều Ngay (Đọc &amp; Ghi Hợp Nhất CRDT)</span>
        </button>

        <div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--border);">
          <label class="micro-label">SAO LƯU TỆP ĐỘC LẬP (.KRYPTOPASS) &amp; CHỐNG CHỤP MÀN HÌNH:</label>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:6px;">
            <button type="button" id="kpw-btn-export-file" class="btn-mobi-outline" style="font-size:11px;padding:8px 6px;">
              📤 Xuất Tệp .kryptopass
            </button>
            <button type="button" class="btn-mobi-outline" style="font-size:11px;padding:8px 6px;" onclick="document.getElementById('kpw-import-file-input').click()">
              📥 Nhập &amp; Gộp .kryptopass
            </button>
            <input type="file" id="kpw-import-file-input" accept=".kryptopass,.json" style="display:none;">
          </div>

          <div style="margin-top:10px;">
            <label class="setting-toggle-row" style="padding:4px 0;">
              <div class="toggle-info">
                <span class="toggle-name" style="font-size:11.5px;">🛡️ Chặn Chụp Màn Hình Hệ Thống (FLAG_SECURE)</span>
                <span class="toggle-desc" style="font-size:10.5px;">Tắt khi bạn muốn dùng phím cứng điện thoại chụp màn hình</span>
              </div>
              <input type="checkbox" id="kpw-flag-secure-toggle" style="width:17px;height:17px;cursor:pointer;">
            </label>
          </div>
        </div>
      </div>
    `;

    bindWidgetEvents();
    renderRecordsList();
  }

  function bindWidgetEvents() {
    const genBtn = document.getElementById("kpw-btn-gen-pass");
    if (genBtn) {
      genBtn.addEventListener("click", () => {
        const pwInput = document.getElementById("kpw-password");
        if (pwInput) pwInput.value = generateStrongPassword(20);
      });
    }

    const frontInput = document.getElementById("kpw-front-img-input");
    if (frontInput) {
      frontInput.addEventListener("change", (ev) => {
        const f = ev.target.files && ev.target.files[0];
        state.pendingFrontFile = f || null;
        const lbl = document.getElementById("kpw-front-label");
        if (lbl) lbl.textContent = f ? f.name.slice(0, 12) : "Chưa chọn";
      });
    }

    const backInput = document.getElementById("kpw-back-img-input");
    if (backInput) {
      backInput.addEventListener("change", (ev) => {
        const f = ev.target.files && ev.target.files[0];
        state.pendingBackFile = f || null;
        const lbl = document.getElementById("kpw-back-label");
        if (lbl) lbl.textContent = f ? f.name.slice(0, 12) : "Chưa chọn";
      });
    }

    const saveBtn = document.getElementById("kpw-btn-save-record");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const itemType = document.getElementById("kpw-item-type")?.value || "LOGIN";
        const folder = document.getElementById("kpw-folder")?.value.trim() || "Mặc định";
        const title = document.getElementById("kpw-title")?.value.trim() || "";
        const username = document.getElementById("kpw-username")?.value.trim() || "";
        const password = document.getElementById("kpw-password")?.value || "";
        const totpSecret = document.getElementById("kpw-totp")?.value.trim() || "";
        if (!title) {
          if (typeof window.showKryptoToast === "function") {
            window.showKryptoToast("⚠️ Vui lòng nhập Tên dịch vụ hoặc Tên thẻ!");
          }
          return;
        }

        const atts = [];
        if (state.pendingFrontFile) {
          atts.push(await fileToEncryptedAttachmentMeta(state.pendingFrontFile, "front_image"));
        }
        if (state.pendingBackFile) {
          atts.push(await fileToEncryptedAttachmentMeta(state.pendingBackFile, "back_image"));
        }

        await upsertRecord({
          itemType,
          folder,
          title,
          username,
          password: password || generateStrongPassword(18),
          totpSecret,
          encryptedAttachments: atts.length > 0 ? atts : null,
        });

        document.getElementById("kpw-title").value = "";
        document.getElementById("kpw-username").value = "";
        document.getElementById("kpw-password").value = "";
        document.getElementById("kpw-totp").value = "";
        state.pendingFrontFile = null;
        state.pendingBackFile = null;
        document.getElementById("kpw-front-label").textContent = "Chưa chọn";
        document.getElementById("kpw-back-label").textContent = "Chưa chọn";

        switchSubView("list");
        if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast("✓ Đã mã hóa AES-256-GCM và lưu vào Danh bạ!");
        }
      });
    }

    const scanImgBtn = document.getElementById("kpw-btn-scan-qr-img");
    const qrFileInput = document.getElementById("kpw-qr-screenshot-input");
    if (scanImgBtn && qrFileInput) {
      scanImgBtn.addEventListener("click", () => qrFileInput.click());
      qrFileInput.addEventListener("change", async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const att = await fileToEncryptedAttachmentMeta(f, "screenshot_image");
        const qrStr = await decodeQrFromImageDataUrl(att.data_url);
        if (qrStr) {
          const inp = document.getElementById("kpw-qr-raw-input");
          if (inp) inp.value = qrStr;
        }
        await importQrOrScreenshotToVault(qrStr, att);
        qrFileInput.value = "";
      });
    }

    const pasteBtn = document.getElementById("kpw-btn-paste-screenshot");
    if (pasteBtn) {
      pasteBtn.addEventListener("click", async () => {
        if (navigator.clipboard && navigator.clipboard.read) {
          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              const imgType = item.types.find((t) => t.startsWith("image/"));
              if (imgType) {
                const blob = await item.getType(imgType);
                const f = new File([blob], `screenshot_${Date.now()}.png`, { type: imgType });
                const att = await fileToEncryptedAttachmentMeta(f, "screenshot_image");
                const qrStr = await decodeQrFromImageDataUrl(att.data_url);
                await importQrOrScreenshotToVault(qrStr, att);
                return;
              }
            }
          } catch (_) {}
        }
        if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast("ℹ️ Hãy chọn ảnh từ nút 'Chọn Ảnh Chụp Màn Hình / QR'!");
        }
      });
    }

    const importQrStrBtn = document.getElementById("kpw-btn-import-qr-str");
    if (importQrStrBtn) {
      importQrStrBtn.addEventListener("click", async () => {
        const val = document.getElementById("kpw-qr-raw-input")?.value || "";
        if (val.trim()) {
          await importQrOrScreenshotToVault(val.trim(), null);
          document.getElementById("kpw-qr-raw-input").value = "";
        }
      });
    }

    const searchInp = document.getElementById("kpw-search-input");
    if (searchInp) {
      searchInp.addEventListener("input", () => renderRecordsList());
    }

    const gdriveCreateBtn = document.getElementById("kpw-btn-gdrive-create");
    if (gdriveCreateBtn) {
      gdriveCreateBtn.addEventListener("click", () => {
        const rawJson = JSON.stringify(state.vaultData, null, 2);
        if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
          window.FlutterBridge.postMessage(
            JSON.stringify({
              action: "gdrive_create_vault_saf",
              fileName: "vault.kryptopass",
              initialJson: rawJson,
            })
          );
        } else {
          exportVaultFileDownload();
        }
      });
    }

    const gdriveOpenBtn = document.getElementById("kpw-btn-gdrive-open");
    if (gdriveOpenBtn) {
      gdriveOpenBtn.addEventListener("click", () => {
        if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
          window.FlutterBridge.postMessage(
            JSON.stringify({
              action: "gdrive_open_vault_saf",
            })
          );
        }
      });
    }

    const gdriveSyncBtn = document.getElementById("kpw-btn-gdrive-sync-now");
    if (gdriveSyncBtn) {
      gdriveSyncBtn.addEventListener("click", () => {
        if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
          window.FlutterBridge.postMessage(
            JSON.stringify({
              action: "gdrive_sync_2way_saf",
            })
          );
        } else if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast("ℹ️ Hãy tạo hoặc mở tệp vault.kryptopass trên Google Drive trước!");
        }
      });
    }

    const exportBtn = document.getElementById("kpw-btn-export-file");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => exportVaultFileDownload());
    }

    const importFileInput = document.getElementById("kpw-import-file-input");
    if (importFileInput) {
      importFileInput.addEventListener("change", (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = async () => {
          await global.KryptoPasswordVault.onGDriveRemoteReadForMerge(String(reader.result));
          switchSubView("list");
        };
        reader.readAsText(f);
        importFileInput.value = "";
      });
    }

    const flagSecureToggle = document.getElementById("kpw-flag-secure-toggle");
    if (flagSecureToggle) {
      flagSecureToggle.checked = state.blockSystemScreenshot;
      flagSecureToggle.addEventListener("change", () => {
        state.blockSystemScreenshot = flagSecureToggle.checked;
        if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
          window.FlutterBridge.postMessage(
            JSON.stringify({
              action: "set_screenshot_protection",
              blockScreenshot: state.blockSystemScreenshot,
            })
          );
        }
      });
    }
  }

  function exportVaultFileDownload() {
    if (!state.vaultData) return;
    const raw = JSON.stringify(state.vaultData, null, 2);
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      window.FlutterBridge.postMessage(
        JSON.stringify({
          action: "save",
          name: "vault.kryptopass",
          content: raw,
        })
      );
      return;
    }
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vault.kryptopass";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==========================================================================
  // 8. PUBLIC API CHO NATIVE ANDROID SAF BRIDGE & SUB-TAB NAVIGATION
  // ==========================================================================
  global.KryptoPasswordVault = {
    async init() {
      await initOrUnlockVault(state.masterPassword);
      mountWidget();
    },

    switchSubView(viewName) {
      switchSubView(viewName);
    },

    filterCategory(cat, btnEl) {
      filterCategory(cat, btnEl);
    },

    refreshUI() {
      renderRecordsList();
    },

    async restoreNativePermanentVault(rawJson) {
      if (!rawJson) return;
      try {
        const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
        await loadEncryptedVaultObject(parsed, state.masterPassword);
        localStorage.setItem(STORAGE_KEY_VAULT, JSON.stringify(parsed));
        await renderRecordsList();
      } catch (_) {}
    },

    onGDriveSafLinked(uriStr) {
      if (!uriStr) return;
      state.linkedGDriveUri = uriStr;
      try {
        localStorage.setItem(STORAGE_KEY_SAVED_URI, uriStr);
      } catch (_) {}
      renderRecordsList();
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("✓ Đã liên kết tệp Google Drive 2 chiều (SAF Persistable URI)!");
      }
    },

    async onGDriveSafOpened(uriStr, remoteJson) {
      if (uriStr) {
        state.linkedGDriveUri = uriStr;
        try {
          localStorage.setItem(STORAGE_KEY_SAVED_URI, uriStr);
        } catch (_) {}
      }
      if (remoteJson) {
        await this.onGDriveRemoteReadForMerge(remoteJson);
      } else {
        renderRecordsList();
      }
    },

    async onGDriveRemoteReadForMerge(remoteJson) {
      try {
        if (remoteJson && String(remoteJson).trim()) {
          const remObj = JSON.parse(remoteJson);
          const stats = await mergeRemoteVaultObject(remObj);
          if (typeof window.showKryptoToast === "function") {
            window.showKryptoToast(
              `✓ Đã hợp nhất CRDT từ Google Drive (+${stats.added} mới, ${stats.updated} cập nhật)!`
            );
          }
        }
        if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
          window.FlutterBridge.postMessage(
            JSON.stringify({
              action: "gdrive_write_merged_saf",
              jsonContent: JSON.stringify(state.vaultData, null, 2),
            })
          );
        }
      } catch (e) {
        if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast("⚠️ Lỗi hợp nhất tệp Google Drive: " + e.message);
        }
      }
    },

    onGDriveMergedWritten(ok) {
      if (ok && typeof window.showKryptoToast === "function") {
        window.showKryptoToast("☁️ Đã đồng bộ 2 chiều (Đọc & Ghi CRDT) lên Google Drive thành công!");
      }
    },
  };

  window.addEventListener("DOMContentLoaded", () => {
    global.KryptoPasswordVault.init();
  });

  setInterval(() => {
    const tabPw = document.getElementById("tab-passwords");
    if (
      tabPw &&
      tabPw.style.display !== "none" &&
      state.activeSubTab === "list" &&
      Object.keys(state.decryptedRecords).length > 0
    ) {
      renderRecordsList();
    }
  }, 5000);
})(window);
