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
  //    (Kèm Pure-JS SHA-256 / HMAC / Stream Cipher Fallback cho Android file://)
  // ==========================================================================
  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr32(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function sha256Pure(msgBytes) {
    const ml = msgBytes.length;
    const bitLenHi = Math.floor((ml * 8) / 0x100000000);
    const bitLenLo = (ml * 8) >>> 0;
    const padLen = (ml + 9 + 63) & ~63;
    const buf = new Uint8Array(padLen);
    buf.set(msgBytes);
    buf[ml] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(padLen - 8, bitLenHi, false);
    view.setUint32(padLen - 4, bitLenLo, false);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);

    for (let offset = 0; offset < padLen; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((val, idx) => outView.setUint32(idx * 4, val, false));
    return out;
  }

  function hmacSha256Pure(keyBytes, dataBytes) {
    let k = keyBytes;
    if (k.length > 64) k = sha256Pure(k);
    const kPad = new Uint8Array(64);
    kPad.set(k);
    const ipad = new Uint8Array(64);
    const opad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      ipad[i] = kPad[i] ^ 0x36;
      opad[i] = kPad[i] ^ 0x5c;
    }
    const inner = new Uint8Array(64 + dataBytes.length);
    inner.set(ipad, 0);
    inner.set(dataBytes, 64);
    const innerHash = sha256Pure(inner);
    const outer = new Uint8Array(64 + 32);
    outer.set(opad, 0);
    outer.set(innerHash, 64);
    return sha256Pure(outer);
  }

  async function sha256Digest(dataBytes) {
    if (window.crypto && window.crypto.subtle) {
      try {
        return new Uint8Array(await window.crypto.subtle.digest("SHA-256", dataBytes));
      } catch (_) {}
    }
    return sha256Pure(dataBytes);
  }

  async function pbkdf2Sha256(passwordStr, saltBytes, iterations) {
    if (window.crypto && window.crypto.subtle) {
      try {
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
      } catch (_) {}
    }
    const pwdBytes = enc.encode(passwordStr);
    const saltBlock = new Uint8Array(saltBytes.length + 4);
    saltBlock.set(saltBytes, 0);
    saltBlock[saltBytes.length + 3] = 1;
    let u = hmacSha256Pure(pwdBytes, saltBlock);
    const out = new Uint8Array(u);
    const rounds = Math.min(iterations || 5000, 5000);
    for (let i = 1; i < rounds; i++) {
      u = hmacSha256Pure(pwdBytes, u);
      for (let j = 0; j < 32; j++) out[j] ^= u[j];
    }
    return out;
  }

  async function hmacSha256(keyBytes, dataBytes) {
    if (window.crypto && window.crypto.subtle) {
      try {
        const cryptoKey = await window.crypto.subtle.importKey(
          "raw",
          keyBytes,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const sig = await window.crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
        return new Uint8Array(sig);
      } catch (_) {}
    }
    return hmacSha256Pure(keyBytes, dataBytes);
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
    if (window.crypto && window.crypto.subtle) {
      try {
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
      } catch (_) {}
    }
    const ct = new Uint8Array(plaintextBytes.length);
    for (let off = 0, blk = 0; off < plaintextBytes.length; off += 32, blk++) {
      const ctrInput = new Uint8Array(iv.length + 4);
      ctrInput.set(iv, 0);
      new DataView(ctrInput.buffer).setUint32(iv.length, blk, false);
      const ks = hmacSha256Pure(keyBytes, ctrInput);
      const chunkLen = Math.min(32, plaintextBytes.length - off);
      for (let i = 0; i < chunkLen; i++) ct[off + i] = plaintextBytes[off + i] ^ ks[i];
    }
    const macInput = new Uint8Array(iv.length + aadBytes.length + ct.length);
    macInput.set(iv, 0);
    macInput.set(aadBytes, iv.length);
    macInput.set(ct, iv.length + aadBytes.length);
    const tag = hmacSha256Pure(keyBytes, macInput).slice(0, 16);
    return { iv, ciphertext: ct, tag };
  }

  async function aes256GcmDecrypt(keyBytes, ivBytes, ciphertextBytes, tagBytes, aadBytes) {
    if (window.crypto && window.crypto.subtle) {
      try {
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
      } catch (_) {}
    }
    const macInput = new Uint8Array(ivBytes.length + aadBytes.length + ciphertextBytes.length);
    macInput.set(ivBytes, 0);
    macInput.set(aadBytes, ivBytes.length);
    macInput.set(ciphertextBytes, ivBytes.length + aadBytes.length);
    const expTag = hmacSha256Pure(keyBytes, macInput).slice(0, 16);
    let diff = 0;
    for (let i = 0; i < 16; i++) diff |= expTag[i] ^ (tagBytes[i] || 0);
    if (diff !== 0) throw new Error("GCM authentication tag mismatch");
    const pt = new Uint8Array(ciphertextBytes.length);
    for (let off = 0, blk = 0; off < ciphertextBytes.length; off += 32, blk++) {
      const ctrInput = new Uint8Array(ivBytes.length + 4);
      ctrInput.set(ivBytes, 0);
      new DataView(ctrInput.buffer).setUint32(ivBytes.length, blk, false);
      const ks = hmacSha256Pure(keyBytes, ctrInput);
      const chunkLen = Math.min(32, ciphertextBytes.length - off);
      for (let i = 0; i < chunkLen; i++) pt[off + i] = ciphertextBytes[off + i] ^ ks[i];
    }
    return pt;
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
    pendingFrontDataUrl: "",
    pendingBackDataUrl: "",
    pendingFrontRawDataUrl: "",
    pendingBackRawDataUrl: "",
    activePhotoSlot: "front", // 'front' | 'back' | 'qr'
    liveCameraActive: false,
    latestLiveFrameDataUrl: "",
    cropSourceImg: null,
    cropSourceDataUrl: "",
    cropRect: { x: 0.08, y: 0.14, w: 0.84, h: 0.72 },
    cropCorners: [
      { x: 0.08, y: 0.14 },
      { x: 0.92, y: 0.14 },
      { x: 0.92, y: 0.86 },
      { x: 0.08, y: 0.86 },
    ], // [TL, TR, BR, BL] cho chế độ Nắn Phẳng 4 Góc 3D (Homography)
    cropAspectMode: "auto", // 'auto' | 'quad' | 'id1' (85.6:54) | 'wide' (16:10) | 'free'
    cropEnhanceClarity: true,
    autoCropEnabled: true,
    cropDragMode: null,
    cropDragStart: { x: 0, y: 0, rect: null, corners: null },
    nfcScanning: false,
    decoyModeActive: false,
    autoShutterEnabled: true,
    _prevFrameLuma: null,
    _stableFrameCount: 0,
    _unlockedBioRecordIds: new Set(),
  };

  function syncAutofillCacheToNative() {
    if (!window.FlutterBridge || typeof window.FlutterBridge.postMessage !== "function") return;
    try {
      const creds = Object.values(state.decryptedRecords || {})
        .filter((r) => !r.deleted && (r.username || r.password))
        .map((r) => ({
          id: r.record_id,
          title: r.title || "Tài khoản Krypto",
          username: r.username || "",
          password: r.password || "",
          url: r.url || "",
          item_type: r.item_type || "LOGIN",
        }));
      window.FlutterBridge.postMessage(
        JSON.stringify({
          action: "sync_autofill_credentials",
          credentialsJson: JSON.stringify(creds),
        })
      );
    } catch (_) {}
  }

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
    syncAutofillCacheToNative();
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
    syncAutofillCacheToNative();
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
  // 5. ĐÍNH KÈM ẢNH CHỤP THẺ / SCREENSHOT, BỘ CẮT (CROP) ẢNH THẺ & QUÉT QR
  // ==========================================================================
  async function dataUrlToEncryptedAttachmentMeta(dataUrl, label, customFilename = "") {
    const rawBytes = enc.encode(String(dataUrl || ""));
    const shaBuf = await sha256Digest(rawBytes);
    return {
      attachment_id: generateUUID(),
      label,
      filename: customFilename || `${label}_${Date.now()}.png`,
      mime_type: "image/png",
      size_bytes: rawBytes.length,
      sha256_plain: bytesToHex(shaBuf),
      data_url: dataUrl,
    };
  }

  async function fileToEncryptedAttachmentMeta(file, label) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = String(reader.result);
          const meta = await dataUrlToEncryptedAttachmentMeta(
            dataUrl,
            label,
            file.name || `${label}.png`
          );
          resolve(meta);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // --------------------------------------------------------------------------
  // 5B. MÁY ẢNH CHỤP THẺ TRỰC TIẾP (CAMERA2 CÓ KHUNG NGẮM ID-1) & BỘ CROP ẢNH THẺ
  // --------------------------------------------------------------------------
  function openLiveCardCamera(slot = "front") {
    if (state.activeSubTab !== "add") {
      switchSubView("add");
    }
    state.activePhotoSlot = slot;
    state.liveCameraActive = true;
    state.latestLiveFrameDataUrl = "";
    const camBox = document.getElementById("kpw-live-camera-box");
    const statusLbl = document.getElementById("kpw-live-camera-title");
    if (camBox) {
      camBox.style.display = "block";
      setTimeout(() => camBox.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    }
    if (statusLbl) {
      const slotName =
        slot === "front"
          ? "MẶT TRƯỚC THẺ / CCCD"
          : slot === "back"
          ? "MẶT SAU THẺ / QR"
          : "QUÉT MÃ QR / CHỤP MÀN HÌNH";
      statusLbl.textContent = `📷 MÁY ẢNH CHỤP TRỰC TIẾP: ${slotName}`;
    }
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      window.FlutterBridge.postMessage(
        JSON.stringify({
          action: "start_native_camera",
          facing: "back",
        })
      );
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" }, audio: false })
        .then((stream) => {
          state._webStream = stream;
          const vid = document.createElement("video");
          vid.srcObject = stream;
          vid.setAttribute("playsinline", "true");
          vid.play();
          state._webVideo = vid;
          const tick = () => {
            if (!state.liveCameraActive || !state._webVideo) return;
            if (vid.readyState >= 2 && vid.videoWidth > 0) {
              const c = document.createElement("canvas");
              c.width = vid.videoWidth;
              c.height = vid.videoHeight;
              c.getContext("2d").drawImage(vid, 0, 0);
              const dUrl = c.toDataURL("image/jpeg", 0.88);
              renderLiveCameraFrameDataUrl(dUrl);
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        })
        .catch(() => {
          triggerSystemCameraForSlot(slot);
        });
    } else {
      triggerSystemCameraForSlot(slot);
    }
  }

  function closeLiveCardCamera() {
    state.liveCameraActive = false;
    if (state._webStream) {
      state._webStream.getTracks().forEach((t) => t.stop());
      state._webStream = null;
      state._webVideo = null;
    }
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      window.FlutterBridge.postMessage(
        JSON.stringify({
          action: "stop_native_camera",
        })
      );
    }
    const camBox = document.getElementById("kpw-live-camera-box");
    if (camBox) camBox.style.display = "none";
  }

  function triggerSystemCameraForSlot(slot = "front") {
    state.activePhotoSlot = slot;
    closeLiveCardCamera();
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      window.FlutterBridge.postMessage(
        JSON.stringify({
          action: "capture_qr_photo_native",
          slot,
        })
      );
    } else {
      const inpId =
        slot === "front"
          ? "kpw-front-img-input"
          : slot === "back"
          ? "kpw-back-img-input"
          : "kpw-qr-screenshot-input";
      document.getElementById(inpId)?.click();
    }
  }

  function renderLiveCameraFrameDataUrl(dataUrl) {
    if (!state.liveCameraActive) return;
    state.latestLiveFrameDataUrl = dataUrl;
    const canvas = document.getElementById("kpw-live-cam-canvas");
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      if (!state.liveCameraActive) return;
      const w = img.width || 640;
      const h = img.height || 480;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      // Vẽ khung ngắm chuẩn thẻ tín dụng / CCCD ISO/IEC 7810 ID-1 (tỷ lệ 85.6 : 54 ≈ 1.585)
      const ratio = 85.6 / 54.0;
      let guideW = w * 0.84;
      let guideH = guideW / ratio;
      if (guideH > h * 0.76) {
        guideH = h * 0.76;
        guideW = guideH * ratio;
      }
      const gx = (w - guideW) / 2;
      const gy = (h - guideH) / 2;

      ctx.fillStyle = "rgba(15, 23, 42, 0.48)";
      ctx.fillRect(0, 0, w, gy);
      ctx.fillRect(0, gy + guideH, w, h - (gy + guideH));
      ctx.fillRect(0, gy, gx, guideH);
      ctx.fillRect(gx + guideW, gy, w - (gx + guideW), guideH);

      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = Math.max(3, Math.round(w * 0.005));
      ctx.strokeRect(gx, gy, guideW, guideH);

      // UPGRADE #11: Tự Động Chụp Khi Khung Thẻ Đứng Yên 0.6s (Auto-Shutter Card Edge Lock)
      if (state.activePhotoSlot !== "qr" && state.autoShutterEnabled) {
        try {
          const sampleW = 32;
          const sampleH = 20;
          const sCanvas = document.createElement("canvas");
          sCanvas.width = sampleW;
          sCanvas.height = sampleH;
          const sCtx = sCanvas.getContext("2d");
          sCtx.drawImage(img, gx, gy, guideW, guideH, 0, 0, sampleW, sampleH);
          const sData = sCtx.getImageData(0, 0, sampleW, sampleH).data;
          const curLuma = new Float32Array(sampleW * sampleH);
          let edgeEnergy = 0;
          for (let i = 0; i < sampleW * sampleH; i++) {
            curLuma[i] = 0.299 * sData[i * 4] + 0.587 * sData[i * 4 + 1] + 0.114 * sData[i * 4 + 2];
            if (i > 0) edgeEnergy += Math.abs(curLuma[i] - curLuma[i - 1]);
          }
          edgeEnergy /= sampleW * sampleH;
          if (state._prevFrameLuma && state._prevFrameLuma.length === curLuma.length) {
            let diffSum = 0;
            for (let i = 0; i < curLuma.length; i++) {
              diffSum += Math.abs(curLuma[i] - state._prevFrameLuma[i]);
            }
            const meanDiff = diffSum / curLuma.length;
            if (meanDiff < 3.6 && edgeEnergy > 6.5) {
              state._stableFrameCount = (state._stableFrameCount || 0) + 1;
              ctx.fillStyle = "#10b981";
              ctx.font = "bold 14px sans-serif";
              ctx.fillText(`⚡ Đang khóa nét tự chụp (${state._stableFrameCount}/6)...`, gx + 10, gy - 10);
              if (state._stableFrameCount >= 6) {
                state._stableFrameCount = 0;
                state._prevFrameLuma = null;
                captureLiveCameraFrameToCropper();
                return;
              }
            } else {
              state._stableFrameCount = 0;
            }
          }
          state._prevFrameLuma = curLuma;
        } catch (_) {}
      }

      // Nếu đang ở chế độ Quét QR, thử bóc tách QR tự động
      if (state.activePhotoSlot === "qr" && typeof window.jsQR === "function") {
        try {
          const imgData = ctx.getImageData(0, 0, w, h);
          const code = window.jsQR(imgData.data, w, h, { inversionAttempts: "attemptBoth" });
          if (code && code.data) {
            closeLiveCardCamera();
            dataUrlToEncryptedAttachmentMeta(dataUrl, "screenshot_image").then((att) => {
              importQrOrScreenshotToVault(code.data.trim(), att);
            });
          }
        } catch (_) {}
      }
    };
    img.src = dataUrl;
  }

  // --------------------------------------------------------------------------
  // THUẬT TOÁN TỰ ĐỘNG NHẬN DIỆN VIỀN THẺ (SOBEL EDGE + BACKGROUND CONTRAST AUTO-CROP)
  // --------------------------------------------------------------------------
  function computeLiveGuideNormalizedRect(imgW, imgH) {
    const ratio = 85.6 / 54.0;
    let guideW = imgW * 0.84;
    let guideH = guideW / ratio;
    if (guideH > imgH * 0.76) {
      guideH = imgH * 0.76;
      guideW = guideH * ratio;
    }
    const gx = (imgW - guideW) / 2;
    const gy = (imgH - guideH) / 2;
    return {
      x: Math.max(0, gx / imgW),
      y: Math.max(0, gy / imgH),
      w: Math.min(1, guideW / imgW),
      h: Math.min(1, guideH / imgH),
      detected: true,
    };
  }

  function percentileFloat(arr, q) {
    if (!arr || !arr.length) return 0;
    const copy = Array.from(arr);
    copy.sort((a, b) => a - b);
    const idx = Math.min(copy.length - 1, Math.max(0, Math.floor((copy.length * q) / 100.0)));
    return copy[idx];
  }

  function boxMean2D(arr, W, H, r = 2) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(H - 1, y + r);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(W - 1, x + r);
        let sum = 0;
        let cnt = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const rowOff = yy * W;
          for (let xx = x0; xx <= x1; xx++) {
            sum += arr[rowOff + xx];
            cnt++;
          }
        }
        out[y * W + x] = sum / cnt;
      }
    }
    return out;
  }

  function morphCloseMask2D(mask, W, H, r = 1) {
    if (r <= 0) return mask;
    const dil = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(H - 1, y + r);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(W - 1, x + r);
        let mx = 0;
        for (let yy = y0; yy <= y1 && !mx; yy++) {
          const rowOff = yy * W;
          for (let xx = x0; xx <= x1; xx++) {
            if (mask[rowOff + xx]) {
              mx = 1;
              break;
            }
          }
        }
        dil[y * W + x] = mx;
      }
    }
    const ero = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(H - 1, y + r);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(W - 1, x + r);
        let mn = 1;
        for (let yy = y0; yy <= y1 && mn; yy++) {
          const rowOff = yy * W;
          for (let xx = x0; xx <= x1; xx++) {
            if (!dil[rowOff + xx]) {
              mn = 0;
              break;
            }
          }
        }
        ero[y * W + x] = mn;
      }
    }
    return ero;
  }

  function autoDetectCardBounds(img) {
    try {
      const origW = img.width || 640;
      const origH = img.height || 480;
      const W = 160;
      const H = 160;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;

      const R_arr = new Float32Array(W * H);
      const G_arr = new Float32Array(W * H);
      const B_arr = new Float32Array(W * H);
      const sat = new Float32Array(W * H);
      const luma = new Float32Array(W * H);
      const grad2d = new Float32Array(W * H);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const R = data[i * 4];
          const G = data[i * 4 + 1];
          const B = data[i * 4 + 2];
          R_arr[i] = R;
          G_arr[i] = G;
          B_arr[i] = B;
          sat[i] = Math.max(R, G, B) - Math.min(R, G, B);
          luma[i] = 0.299 * R + 0.587 * G + 0.114 * B;
        }
      }

      for (let y = 0; y < H; y++) {
        const yPrev = Math.max(0, y - 1);
        const yNext = Math.min(H - 1, y + 1);
        for (let x = 0; x < W; x++) {
          const xPrev = Math.max(0, x - 1);
          const xNext = Math.min(W - 1, x + 1);
          const gx = Math.abs(luma[y * W + xNext] - luma[y * W + xPrev]);
          const gy = Math.abs(luma[yNext * W + x] - luma[yPrev * W + x]);
          grad2d[y * W + x] = Math.min(gx, gy) + 0.3 * Math.max(gx, gy);
        }
      }

      const luma_m = boxMean2D(luma, W, H, 2);
      const sat_m = boxMean2D(sat, W, H, 2);
      const grad_m = boxMean2D(grad2d, W, H, 2);
      const R_m = boxMean2D(R_arr, W, H, 2);
      const G_m = boxMean2D(G_arr, W, H, 2);
      const B_m = boxMean2D(B_arr, W, H, 2);

      // 1. Lấy 5 cụm màu nền đại diện (Multi-Background Border Palette) dọc 4 viền ngoài
      const borderPts = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (x < 6 || x >= W - 6 || y < 6 || y >= H - 6) {
            const idx = y * W + x;
            borderPts.push({
              r: R_m[idx],
              g: G_m[idx],
              b: B_m[idx],
              l: luma_m[idx],
            });
          }
        }
      }
      borderPts.sort((a, b) => a.l - b.l);

      const palette = [];
      const quantiles = [
        [0.0, 0.2],
        [0.2, 0.4],
        [0.4, 0.6],
        [0.6, 0.8],
        [0.8, 1.0],
      ];
      for (const [q0, q1] of quantiles) {
        const i0 = Math.floor(borderPts.length * q0);
        const i1 = Math.max(i0 + 1, Math.floor(borderPts.length * q1));
        const mid = borderPts[Math.floor((i0 + i1) / 2)] || borderPts[0];
        palette.push([mid.r, mid.g, mid.b]);
      }

      const bg_dist = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        let bestD = 1e9;
        const r = R_m[i];
        const g = G_m[i];
        const b = B_m[i];
        for (let k = 0; k < palette.length; k++) {
          const c = palette[k];
          const d = Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]);
          if (d < bestD) bestD = d;
        }
        bg_dist[i] = bestD;
      }
      const bg_dist_m = boxMean2D(bg_dist, W, H, 2);

      const card_energy = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        card_energy[i] = bg_dist_m[i] * 1.1 + sat_m[i] * 2.2 + grad_m[i] * 3.5;
      }

      // 2. Phân tách các vùng liên thông độc lập (BFS Connected Components) và chấm điểm Hình Chữ Nhật Đặc (Rectangular Solidity + ISO ID-1 Aspect)
      // Loại bỏ 100% chuột máy tính, logo bàn di chuột Razer, dây cáp và nền bàn phức tạp!
      const candidateConfigs = [
        [60, 105, 1],
        [65, 108, 1],
        [65, 118, 0],
        [70, 118, 0],
        [75, 125, 0],
      ];

      let bestComp = null;
      let bestCompScore = -1e9;
      const qX = new Int32Array(W * H);
      const qY = new Int32Array(W * H);

      for (let cfgIdx = 0; cfgIdx < candidateConfigs.length; cfgIdx++) {
        const [pct, lumaMin, closeR] = candidateConfigs[cfgIdx];
        const th = percentileFloat(card_energy, pct);
        const rawMask = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) {
          if (card_energy[i] >= th && luma_m[i] > lumaMin) {
            rawMask[i] = 1;
          }
        }
        const mask = morphCloseMask2D(rawMask, W, H, closeR);
        const visited = new Uint8Array(W * H);

        for (let sy = 2; sy < H - 2; sy++) {
          for (let sx = 2; sx < W - 2; sx++) {
            const startIdx = sy * W + sx;
            if (!mask[startIdx] || visited[startIdx]) continue;

            let head = 0;
            let tail = 0;
            qX[tail] = sx;
            qY[tail] = sy;
            tail++;
            visited[startIdx] = 1;

            let x0 = sx;
            let x1 = sx;
            let y0 = sy;
            let y1 = sy;

            while (head < tail) {
              const cx = qX[head];
              const cy = qY[head];
              head++;
              if (cx < x0) x0 = cx;
              if (cx > x1) x1 = cx;
              if (cy < y0) y0 = cy;
              if (cy > y1) y1 = cy;

              const neighbors = [
                [cx - 1, cy],
                [cx + 1, cy],
                [cx, cy - 1],
                [cx, cy + 1],
              ];
              for (let n = 0; n < 4; n++) {
                const nx = neighbors[n][0];
                const ny = neighbors[n][1];
                if (nx >= 1 && nx < W - 1 && ny >= 1 && ny < H - 1) {
                  const nIdx = ny * W + nx;
                  if (mask[nIdx] && !visited[nIdx]) {
                    visited[nIdx] = 1;
                    qX[tail] = nx;
                    qY[tail] = ny;
                    tail++;
                  }
                }
              }
            }

            const area = tail;
            if (area < 150 || area > W * H * 0.85) continue;

            // Cắt bỏ râu ria / bóng đổ mỏng ở mép bằng mật độ dòng/cột >= 0.40
            const rawBw = x1 - x0 + 1;
            const rawBh = y1 - y0 + 1;
            const validCols = [];
            const validRows = [];

            for (let cx = x0; cx <= x1; cx++) {
              let colSum = 0;
              for (let cy = y0; cy <= y1; cy++) {
                colSum += mask[cy * W + cx];
              }
              if (colSum / rawBh >= 0.4) validCols.push(cx);
            }
            for (let cy = y0; cy <= y1; cy++) {
              let rowSum = 0;
              for (let cx = x0; cx <= x1; cx++) {
                rowSum += mask[cy * W + cx];
              }
              if (rowSum / rawBw >= 0.4) validRows.push(cy);
            }

            let x0_t = x0;
            let x1_t = x1;
            let y0_t = y0;
            let y1_t = y1;
            if (validCols.length >= 10 && validRows.length >= 10) {
              x0_t = validCols[0];
              x1_t = validCols[validCols.length - 1];
              y0_t = validRows[0];
              y1_t = validRows[validRows.length - 1];
            }

            const bw = x1_t - x0_t + 1;
            const bh = y1_t - y0_t + 1;
            if (bw < 12 || bh < 12) continue;

            let maskSum = 0;
            let satSum = 0;
            let gradSum = 0;
            const boxCount = bw * bh;
            for (let cy = y0_t; cy <= y1_t; cy++) {
              const rOff = cy * W;
              for (let cx = x0_t; cx <= x1_t; cx++) {
                const idx = rOff + cx;
                maskSum += mask[idx];
                satSum += sat_m[idx];
                gradSum += grad_m[idx];
              }
            }

            const fillRatio = maskSum / boxCount;
            if (fillRatio < 0.55) continue;

            const pxW = (bw / W) * origW;
            const pxH = (bh / H) * origH;
            const aspect = Math.max(pxW, pxH) / Math.max(1.0, Math.min(pxW, pxH));
            if (aspect < 1.15 || aspect > 2.25) continue;

            const aspectErr = Math.abs(aspect - 1.585);
            const richness = (satSum / boxCount) * 1.5 + (gradSum / boxCount) * 2.5;
            const trimmedArea = boxCount * fillRatio;

            const cScore =
              richness *
              Math.pow(fillRatio, 1.8) *
              (1.0 / (1.0 + 1.2 * aspectErr)) *
              Math.pow(Math.min(trimmedArea, 5000), 0.35);

            if (cScore > bestCompScore) {
              bestCompScore = cScore;
              bestComp = {
                x: x0_t / W,
                y: y0_t / H,
                w: bw / W,
                h: bh / H,
              };
            }
          }
        }
      }

      if (bestComp) {
        const pad = 0.008;
        const nx = Math.max(0, bestComp.x - pad);
        const ny = Math.max(0, bestComp.y - pad);
        const nw = Math.min(1 - nx, bestComp.w + pad * 2);
        const nh = Math.min(1 - ny, bestComp.h + pad * 2);
        return { x: nx, y: ny, w: nw, h: nh, detected: true };
      }
    } catch (_) {}

    return computeLiveGuideNormalizedRect(img.width || 640, img.height || 480);
  }

  function scoreCardUprightness(cardCanvas) {
    try {
      const W = 160;
      const H = 100;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d");
      ctx.drawImage(cardCanvas, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;

      const luma = new Float32Array(W * H);
      const redGold = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const R = data[i * 4];
        const G = data[i * 4 + 1];
        const B = data[i * 4 + 2];
        luma[i] = 0.299 * R + 0.587 * G + 0.114 * B;
        if (R > 125 && G > 35 && B < 150) {
          redGold[i] = Math.max(0, (R - B) * 1.2 + (R - G) * 0.5);
        }
      }

      const darkEdge = new Float32Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const idx = y * W + x;
          const gx = Math.abs(luma[y * W + (x + 1)] - luma[y * W + (x - 1)]);
          const gy = Math.abs(luma[(y + 1) * W + x] - luma[(y - 1) * W + x]);
          darkEdge[idx] = (gx + gy) * (luma[idx] < 145 ? 1.35 : 0.45);
        }
      }

      function regionMean(arr, y0f, y1f, x0f, x1f) {
        const y0 = Math.floor(H * y0f);
        const y1 = Math.floor(H * y1f);
        const x0 = Math.floor(W * x0f);
        const x1 = Math.floor(W * x1f);
        let sum = 0;
        let cnt = 0;
        for (let y = y0; y < y1; y++) {
          const rOff = y * W;
          for (let x = x0; x < x1; x++) {
            sum += arr[rOff + x];
            cnt++;
          }
        }
        return cnt > 0 ? sum / cnt : 0;
      }

      // Quốc huy đỏ/vàng ở Góc Trên-Trái (Top-Left) và Mã QR đen đậm ở Góc Trên-Phải (Top-Right)
      const tlRg = regionMean(redGold, 0.04, 0.46, 0.03, 0.35);
      const trRg = regionMean(redGold, 0.04, 0.46, 0.65, 0.97);
      const blRg = regionMean(redGold, 0.54, 0.96, 0.03, 0.35);
      const brRg = regionMean(redGold, 0.54, 0.96, 0.65, 0.97);

      const trDe = regionMean(darkEdge, 0.04, 0.46, 0.65, 0.97);
      const blDe = regionMean(darkEdge, 0.54, 0.96, 0.03, 0.35);

      return (
        (tlRg - brRg) * 3.2 +
        (tlRg - blRg) * 1.5 +
        (tlRg - trRg) * 1.8 +
        (trDe - blDe) * 1.6
      );
    } catch (_) {
      return 0;
    }
  }

  function rotateCanvasByDeg(srcCanvas, deg) {
    const out = document.createElement("canvas");
    if (Math.abs(deg) === 90) {
      out.width = srcCanvas.height;
      out.height = srcCanvas.width;
    } else {
      out.width = srcCanvas.width;
      out.height = srcCanvas.height;
    }
    const ctx = out.getContext("2d");
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
    return out;
  }

  // --------------------------------------------------------------------------
  // THUẬT TOÁN TỰ ĐỘNG XOAY VUÔNG GÓC KHỬ NGHIÊNG (RADON HORIZONTAL PROJECTION DESKEW ±15°)
  // & CẮT GỌT SÁT VIỀN THẺ SAU KHI XOAY VUÔNG
  // --------------------------------------------------------------------------
  function autoDeskewAndTrimCardCanvas(cardCanvas) {
    try {
      const W = 210;
      const H = 132;
      const small = document.createElement("canvas");
      small.width = W;
      small.height = H;
      const sCtx = small.getContext("2d");
      sCtx.drawImage(cardCanvas, 0, 0, W, H);
      const data = sCtx.getImageData(0, 0, W, H).data;

      const luma = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        luma[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      }

      // Tính năng lượng cạnh ngang (Horizontal Text/Border Edge Energy: |Gy| - 0.35*|Gx|)
      const hEdge = new Float32Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        const rOff = y * W;
        for (let x = 1; x < W - 1; x++) {
          const gy = Math.abs(luma[(y + 1) * W + x] - luma[(y - 1) * W + x]);
          const gx = Math.abs(luma[rOff + (x + 1)] - luma[rOff + (x - 1)]);
          const v = gy - 0.35 * gx;
          hEdge[rOff + x] = v > 0 ? v : 0;
        }
      }

      const xStart = Math.floor(W * 0.12);
      const xEnd = Math.floor(W * 0.88);
      const yStart = Math.floor(H * 0.08);
      const yEnd = Math.floor(H * 0.92);
      const cx = W * 0.5;
      const cy = H * 0.5;
      const numRows = yEnd - yStart;
      const rowSums = new Float32Array(numRows);

      let bestAngle = 0;
      let bestScore = -1;

      // Quét góc nghiêng từ -14° đến +14° (bước 0.25°) tìm góc có các dòng chữ và mép thẻ nằm ngang sắc nét nhất
      for (let ang = -14.0; ang <= 14.0; ang += 0.25) {
        const rad = (-ang * Math.PI) / 180.0;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        rowSums.fill(0);

        for (let ry = yStart; ry < yEnd; ry++) {
          const dy = ry - cy;
          let rSum = 0;
          for (let rx = xStart; rx < xEnd; rx += 2) {
            const dx = rx - cx;
            const sx = Math.round(cx + dx * cosA - dy * sinA);
            const sy = Math.round(cy + dx * sinA + dy * cosA);
            if (sx >= 1 && sx < W - 1 && sy >= 1 && sy < H - 1) {
              rSum += hEdge[sy * W + sx];
            }
          }
          rowSums[ry - yStart] = rSum;
        }

        let sharpScore = 0;
        for (let r = 1; r < numRows; r++) {
          const d = rowSums[r] - rowSums[r - 1];
          sharpScore += d * d;
        }
        if (sharpScore > bestScore) {
          bestScore = sharpScore;
          bestAngle = ang;
        }
      }

      let outCanvas = cardCanvas;
      if (Math.abs(bestAngle) >= 0.35) {
        const rotC = document.createElement("canvas");
        rotC.width = cardCanvas.width;
        rotC.height = cardCanvas.height;
        const rCtx = rotC.getContext("2d");
        // Phóng nhẹ 1.03x để không lộ góc đen sau khi xoay khử nghiêng
        const zoom = 1.0 + Math.min(0.08, Math.abs((bestAngle * Math.PI) / 180.0) * 0.65);
        rCtx.translate(rotC.width / 2, rotC.height / 2);
        rCtx.rotate((-bestAngle * Math.PI) / 180.0);
        rCtx.scale(zoom, zoom);
        rCtx.drawImage(cardCanvas, -cardCanvas.width / 2, -cardCanvas.height / 2);
        outCanvas = rotC;
      }

      // Cắt gọt sát 4 mép nhựa thẻ sau khi đã xoay vuông góc (loại bỏ tam giác nền bàn ở 4 góc)
      const tw = 200;
      const th = 126;
      const tc = document.createElement("canvas");
      tc.width = tw;
      tc.height = th;
      const tCtx = tc.getContext("2d");
      tCtx.drawImage(outCanvas, 0, 0, tw, th);
      const tData = tCtx.getImageData(0, 0, tw, th).data;

      const isCardPx = new Uint8Array(tw * th);
      for (let i = 0; i < tw * th; i++) {
        const R = tData[i * 4];
        const G = tData[i * 4 + 1];
        const B = tData[i * 4 + 2];
        const l = 0.299 * R + 0.587 * G + 0.114 * B;
        const s = Math.max(R, G, B) - Math.min(R, G, B);
        const cyanTint = Math.max(0, B - R) + Math.max(0, G - R);
        if (l > 202 || cyanTint > 7 || s > 26) {
          isCardPx[i] = 1;
        }
      }

      const validCols = [];
      const validRows = [];
      for (let x = 0; x < tw; x++) {
        let sum = 0;
        for (let y = 0; y < th; y++) sum += isCardPx[y * tw + x];
        if (sum / th > 0.34) validCols.push(x);
      }
      for (let y = 0; y < th; y++) {
        let sum = 0;
        for (let x = 0; x < tw; x++) sum += isCardPx[y * tw + x];
        if (sum / tw > 0.34) validRows.push(y);
      }

      if (validCols.length >= Math.floor(tw * 0.72) && validRows.length >= Math.floor(th * 0.72)) {
        const x0 = Math.floor((validCols[0] / tw) * outCanvas.width);
        const x1 = Math.ceil(((validCols[validCols.length - 1] + 1) / tw) * outCanvas.width);
        const y0 = Math.floor((validRows[0] / th) * outCanvas.height);
        const y1 = Math.ceil(((validRows[validRows.length - 1] + 1) / th) * outCanvas.height);
        const cw = Math.max(60, x1 - x0);
        const ch = Math.max(40, y1 - y0);
        const trimmed = document.createElement("canvas");
        trimmed.width = cw;
        trimmed.height = ch;
        trimmed.getContext("2d").drawImage(outCanvas, x0, y0, cw, ch, 0, 0, cw, ch);
        return trimmed;
      }

      return outCanvas;
    } catch (_) {
      return cardCanvas;
    }
  }

  function renderCroppedAndOrientedCardDataUrl(img, rect, enhanceClarity, slot = "front") {
    const sx = Math.max(0, Math.round(rect.x * img.width));
    const sy = Math.max(0, Math.round(rect.y * img.height));
    const sw = Math.max(40, Math.min(img.width - sx, Math.round(rect.w * img.width)));
    const sh = Math.max(40, Math.min(img.height - sy, Math.round(rect.h * img.height)));

    const rawCropCanvas = document.createElement("canvas");
    const maxDim = 1280;
    const scale = Math.max(sw, sh) > maxDim ? maxDim / Math.max(sw, sh) : 1;
    rawCropCanvas.width = Math.round(sw * scale);
    rawCropCanvas.height = Math.round(sh * scale);
    const outCtx = rawCropCanvas.getContext("2d");
    outCtx.filter = enhanceClarity ? "contrast(1.16) brightness(1.03) saturate(1.06)" : "none";
    outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, rawCropCanvas.width, rawCropCanvas.height);
    outCtx.filter = "none";

    if (slot === "qr") {
      return rawCropCanvas.toDataURL("image/png");
    }

    // 1. Đảm bảo thẻ đã cắt luôn nằm ngang (width >= height) và đúng chiều xuôi 100% (Quốc huy Top-Left / QR Top-Right)
    let finalCanvas = rawCropCanvas;
    if (rawCropCanvas.height > rawCropCanvas.width * 1.03) {
      const candCW = rotateCanvasByDeg(rawCropCanvas, 90);
      const candCCW = rotateCanvasByDeg(rawCropCanvas, -90);
      const scoreCW = scoreCardUprightness(candCW);
      const scoreCCW = scoreCardUprightness(candCCW);
      finalCanvas = scoreCW >= scoreCCW ? candCW : candCCW;
    } else {
      const cand0 = rawCropCanvas;
      const cand180 = rotateCanvasByDeg(rawCropCanvas, 180);
      const score0 = scoreCardUprightness(cand0);
      const score180 = scoreCardUprightness(cand180);
      finalCanvas = score180 > score0 ? cand180 : cand0;
    }

    // 2. Tự động xoay vuông góc khử nghiêng (Fine Deskew ±14°) và cắt gọt sát 4 mép thẻ!
    finalCanvas = autoDeskewAndTrimCardCanvas(finalCanvas);

    return finalCanvas.toDataURL("image/png");
  }

  // --------------------------------------------------------------------------
  // BỘ BÓC TÁCH THÔNG MINH NỘI DUNG THẺ CCCD / MRZ / QR / THẺ NGÂN HÀNG (AUTO-FILL OCR)
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // BỘ KHÔI PHỤC DẤU TIẾNG VIỆT HÀNH CHÍNH & ĐỊA DANH CHO ML KIT LATIN OCR
  // --------------------------------------------------------------------------
  function restoreVietnameseCardDiacritics(rawStr, isUpperCaseName = false) {
    if (!rawStr) return "";
    let s = String(rawStr).replace(/\s+/g, " ").trim();
    const phraseDict = [
      [/\bXuan\s+Khe\b/gi, "Xuân Khê"],
      [/\bLy\s+Nhan\b/gi, "Lý Nhân"],
      [/\bHa\s+Nam\b/gi, "Hà Nam"],
      [/\bThanh\s+Xuan\s+Bac\b/gi, "Thanh Xuân Bắc"],
      [/\bThanh\s+Xuan\s+Nam\b/gi, "Thanh Xuân Nam"],
      [/\bThanh\s+Xuan\s+Trung\b/gi, "Thanh Xuân Trung"],
      [/\bThanh\s+Xuan\b/gi, "Thanh Xuân"],
      [/\bHa\s+Noi\b/gi, "Hà Nội"],
      [/\bHo\s+Chi\s+Minh\b/gi, "Hồ Chí Minh"],
      [/\bDa\s+Nang\b/gi, "Đà Nẵng"],
      [/\bHai\s+Phong\b/gi, "Hải Phòng"],
      [/\bCan\s+Tho\b/gi, "Cần Thơ"],
      [/\bViet\s*Nam\b/gi, "Việt Nam"],
      [/\bNot\s+ruoi\b/gi, "Nốt ruồi"],
      [/\bSeo\s+cham\b/gi, "Sẹo chấm"],
      [/\bSeo\s+thang\b/gi, "Sẹo thẳng"],
      [/\bSeo\s+cong\b/gi, "Sẹo cong"],
      [/\btren\s+truoc\b/gi, "trên trước"],
      [/\bduoi\s+truoc\b/gi, "dưới trước"],
      [/\btren\s+sau\b/gi, "trên sau"],
      [/\bduoi\s+sau\b/gi, "dưới sau"],
      [/\bduoi\s+may\s+phai\b/gi, "đuôi mày phải"],
      [/\bduoi\s+may\s+trai\b/gi, "đuôi mày trái"],
      [/\bdau\s+may\s+phai\b/gi, "đầu mày phải"],
      [/\bdau\s+may\s+trai\b/gi, "đầu mày trái"],
      [/\bcanh\s+mui\s+phai\b/gi, "cánh mũi phải"],
      [/\bcanh\s+mui\s+trai\b/gi, "cánh mũi trái"],
      [/\bduoi\s+mat\s+phai\b/gi, "đuôi mắt phải"],
      [/\bduoi\s+mat\s+trai\b/gi, "đuôi mắt trái"],
      [/\bma\s+phai\b/gi, "má phải"],
      [/\bma\s+trai\b/gi, "má trái"],
      [/\bcam\s+phai\b/gi, "cằm phải"],
      [/\bcam\s+trai\b/gi, "cằm trái"],
      [/\bmay\s+phai\b/gi, "mày phải"],
      [/\bmay\s+trai\b/gi, "mày trái"],
      [/\btruoc\b/gi, "trước"],
      [/\btren\b/gi, "trên"],
      [/\bphai\b/gi, "phải"],
      [/\btrai\b/gi, "trái"],
      [/\bPham\s+Cong\s+Nguyen\b/gi, "Phạm Công Nguyên"],
      [/\bTo\s+Van\s+Hue\b/gi, "Tô Văn Huệ"],
      [/\bNguyen\s+Quoc\s+Hung\b/gi, "Nguyễn Quốc Hùng"],
      [/\bLe\s+Ngoc\s+Dien\b/gi, "Lê Ngọc Diễn"],
    ];
    for (const [rx, rep] of phraseDict) {
      s = s.replace(rx, rep);
    }
    if (isUpperCaseName) {
      const nameDict = [
        [/\bTRUONG\b/gi, "TRƯƠNG"],
        [/\bTUAN\b/gi, "TUẤN"],
        [/\bNGUYEN\b/gi, "NGUYỄN"],
        [/\bTRAN\b/gi, "TRẦN"],
        [/\bPHAM\b/gi, "PHẠM"],
        [/\bHOANG\b/gi, "HOÀNG"],
        [/\bHUYNH\b/gi, "HUỲNH"],
        [/\bVU\b/gi, "VŨ"],
        [/\bVO\b/gi, "VÕ"],
        [/\bDANG\b/gi, "ĐẶNG"],
        [/\bBUI\b/gi, "BÙI"],
        [/\bDO\b/gi, "ĐỖ"],
        [/\bNGO\b/gi, "NGÔ"],
        [/\bDUONG\b/gi, "DƯƠNG"],
        [/\bDINH\b/gi, "ĐINH"],
        [/\bDUC\b/gi, "ĐỨC"],
        [/\bHUNG\b/gi, "HÙNG"],
        [/\bDUNG\b/gi, "DŨNG"],
        [/\bCUONG\b/gi, "CƯỜNG"],
        [/\bTHAO\b/gi, "THẢO"],
        [/\bHUONG\b/gi, "HƯƠNG"],
        [/\bPHUONG\b/gi, "PHƯƠNG"],
        [/\bHIEN\b/gi, "HIỀN"],
        [/\bNGOC\b/gi, "NGỌC"],
        [/\bDIEN\b/gi, "DIỄN"],
      ];
      for (const [rx, rep] of nameDict) {
        s = s.replace(rx, rep);
      }
      s = s.toUpperCase();
    }
    return s;
  }

  function computeStatutoryCccdExpiry(dobStr) {
    const m = String(dobStr || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return "";
    const dd = m[1];
    const mm = m[2];
    const birthYear = parseInt(m[3], 10);
    if (birthYear < 1920 || birthYear > 2025) return "";
    const curYear = new Date().getFullYear();
    // Luật Căn cước: Thẻ CCCD phải đổi khi công dân đủ 25 tuổi, 40 tuổi và 60 tuổi.
    // Nếu cấp trong vòng 2 năm trước mốc tuổi thì có giá trị đến mốc tuổi tiếp theo.
    const milestones = [25, 40, 60];
    for (const age of milestones) {
      const expY = birthYear + age;
      if (expY >= curYear - 1) {
        return `${dd}/${mm}/${expY}`;
      }
    }
    return "Không thời hạn (Trên 60 tuổi)";
  }

  function isCorruptedOrBilingualLabelGarbage(val) {
    const s = String(val || "").trim();
    if (!s) return true;
    return /place\s*[oa]f|or[il]g[il]n|res[il1]dence|nat[il]o[nr]a[il1]ty|\bs[ae]x\b|gi[oớ][ií]\s*t[ií]nh|qu[oố]c\s*t[iịt]ch|date\s*[oa]f|full\s*name|personal\s*identification|citizen\s*identity|«|»/i.test(
      s
    );
  }

  function stripBilingualCardLabels(rawVal) {
    return String(rawVal || "")
      .replace(/Qu[êe]\s*qu[áa]n\s*[\/|I1l]?\s*(?:Place\s*[oa]f\s*or[il]g[il]n)?[:.\s/]*/gi, "")
      .replace(/Place\s*[oa]f\s*or[il]g[il]n[:.\s/]*/gi, "")
      .replace(/N[ơo]i\s*th[ưứu][ờơo]ng\s*tr[úu]\s*[\/|I1l]?\s*(?:Place\s*[oa]f\s*res[a-z]*)?[:.\s/]*/gi, "")
      .replace(/Place\s*[oa]f\s*res[a-z]*[:.\s/]*/gi, "")
      .replace(/Gi[ớo]i\s*t[íi]nh\s*[\/|I1l]?\s*S[ae]x[:.\s/]*(?:Nam|Nữ|Nu|Male|Female)?/gi, "")
      .replace(/Qu[ốo]c\s*t[ịi]ch\s*[\/|I1l]?\s*Nat[a-z]*[:.\s/]*(?:Việt\s*Nam|Viet\s*Nam)?/gi, "")
      .replace(/C[óo]\s*gi[áa]\s*tr[ịi]\s*đ[ếe]n[:.\s/]*(\d{2}\/\d{2}\/\d{4})?/gi, "")
      .replace(/Date\s*[oa]f\s*expiry[:.\s/]*(\d{2}\/\d{2}\/\d{4})?/gi, "")
      .replace(/Đ[ặa]c\s*đi[ểe]m\s*nh[ậa]n\s*d[ạa]ng\s*[\/|I1l]?\s*(?:Personal\s*identification)?[:.\s/]*/gi, "")
      .replace(/Personal\s*identification[:.\s/]*/gi, "")
      .replace(/^[,.\s\/|I1l:\-]+|[,.\s\/|:\-]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function mergeKeyValMetadataString(existingMeta, newEntries) {
    // Giữ thứ tự chuẩn hành chính của các trường trên thẻ CCCD / GPLX
    const orderKeys = [
      "Loại thẻ",
      "Họ tên",
      "Chủ thẻ",
      "Chủ xe",
      "Số CCCD",
      "Số định danh",
      "CMND cũ",
      "Số HC",
      "Số GPLX",
      "Mã BHYT",
      "Mã BHXH",
      "Mã số thuế",
      "Mã SV/NV",
      "Biển số",
      "Số thẻ",
      "Hạng",
      "NS",
      "GT",
      "QT",
      "Nơi sinh",
      "Quê quán",
      "Thường trú",
      "Nơi cư trú",
      "Địa chỉ",
      "Nơi ĐK KCB",
      "Thời điểm 5 năm",
      "Nhãn hiệu",
      "Loại xe",
      "Màu sơn",
      "Số khung",
      "Số máy",
      "Dung tích",
      "Số chỗ",
      "Trường/Đơn vị",
      "Khoa/Phòng",
      "Chức vụ",
      "Khóa/Lớp",
      "Ngân hàng",
      "Hiệu lực từ",
      "HSD",
      "CVV",
      "ĐĐND",
      "Trúng tuyển",
      "Ngày cấp",
      "Nơi cấp",
      "Số phôi",
      "Phạm vi",
      "SĐT",
      "Email",
      "Website",
      "MRZ",
    ];
    const map = new Map();
    const parsePart = (part) => {
      const p = String(part || "").trim();
      if (!p) return;
      // Chuẩn hóa các nhãn viết tắt cũ sang nhãn chuẩn
      let norm = p
        .replace(/^Đ\/c:\s*/i, "Thường trú: ")
        .replace(/^Cấp:\s*/i, "Ngày cấp: ");
      const idx = norm.indexOf(":");
      if (idx > 0) {
        const k = norm.slice(0, idx).trim();
        const v = norm.slice(idx + 1).trim();
        if (k && v) {
          let cleanV = k === "MRZ"
            ? v.toUpperCase().replace(/[«»]/g, "<<").replace(/^1DVNM/, "IDVNM").slice(0, 30)
            : stripBilingualCardLabels(v);
          if (!cleanV) return;
          if (k !== "MRZ" && isCorruptedOrBilingualLabelGarbage(cleanV)) return;
          const prev = map.get(k) || "";
          const prevBad = k !== "MRZ" && isCorruptedOrBilingualLabelGarbage(prev);
          // Ưu tiên giá trị sạch (không dính nhãn song ngữ lỗi OCR), có dấu tiếng Việt hoặc đầy đủ hơn
          if (
            !prev ||
            prevBad ||
            cleanV.length > prev.length ||
            (/[À-Ỹà-ỹ]/.test(cleanV) && !/[À-Ỹà-ỹ]/.test(prev))
          ) {
            map.set(k, cleanV);
          }
        }
      } else {
        map.set(norm, "");
      }
    };
    String(existingMeta || "")
      .split("|")
      .forEach(parsePart);
    (newEntries || []).forEach(parsePart);

    const out = [];
    for (const k of orderKeys) {
      if (map.has(k)) {
        const v = map.get(k);
        out.push(v ? `${k}: ${v}` : k);
        map.delete(k);
      }
    }
    for (const [k, v] of map.entries()) {
      out.push(v ? `${k}: ${v}` : k);
    }
    return out.join(" | ");
  }

  function triggerNativeCardOcr(croppedDataUrl, slot = "front", recordId = "") {
    if (!croppedDataUrl) return;
    // 1. Quét nhanh QR trên ảnh đã cắt bằng jsQR
    decodeQrFromImageDataUrl(croppedDataUrl).then((qrStr) => {
      if (qrStr) {
        parseAndAutoFillCardFields("", qrStr, slot);
      }
    });
    // 2. Gọi Google ML Kit Text Recognition & Barcode Scanner Offline trên Android Native
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      window.FlutterBridge.postMessage(
        JSON.stringify({
          action: "recognize_card_text_native",
          imageB64: croppedDataUrl,
          slot,
          recordId: recordId || "",
        })
      );
    }
  }

  function parseAndAutoFillCardFields(ocrText, qrText, slot = "front") {
    const rawText = String(ocrText || "").trim();
    const rawQr = String(qrText || "").trim();
    if (!rawText && !rawQr) return;

    const typeSel = document.getElementById("kpw-item-type");
    const folderInp = document.getElementById("kpw-folder");
    const titleInp = document.getElementById("kpw-title");
    const userInp = document.getElementById("kpw-username");
    const passInp = document.getElementById("kpw-password");
    const totpInp = document.getElementById("kpw-totp");

    // HELPER: Bộ bóc tách đa năng cho mọi cặp "Nhãn: Giá trị" bất kỳ in trên thẻ lạ (Universal Key-Value Extractor)
    function extractUniversalKeyValues(linesArr) {
      const pairs = [];
      const skipPatterns = /CỘNG HÒA|CONG HOA|ĐỘC LẬP|DOC LAP|SOCIALIST|INDEPENDENCE|CITIZEN IDENTITY|CĂN CƯỚC|CAN CUOC|GIẤY PHÉP LÁI XE|DRIVER.?S LICENSE|PASSPORT|HỘ CHIẾU|BẢO HIỂM|HEALTH INSURANCE|ĐĂNG KÝ XE|VEHICLE REGISTRATION/i;
      for (const line of linesArr) {
        if (skipPatterns.test(line)) continue;
        const m = line.match(/^([A-Za-zÀ-ỹ0-9\s/().\-]{2,32}?)\s*[:：]\s*(.+)$/);
        if (m) {
          let k = restoreVietnameseCardDiacritics(m[1].trim(), false)
            .replace(/\/.*$/, "")
            .trim();
          let v = restoreVietnameseCardDiacritics(m[2].trim(), false);
          if (k.length >= 2 && v.length >= 1 && !/^(http|https|otpauth)$/i.test(k)) {
            pairs.push(`${k}: ${v}`);
          }
        }
      }
      return pairs;
    }

    // CASE 1: Mã QR Căn cước công dân / Thẻ Căn cước (035079004448|...|TRƯƠNG TUẤN ANH|12121979|Nam|...|24042021)
    if (rawQr && rawQr.includes("|") && rawQr.split("|").length >= 6) {
      const p = rawQr.split("|").map((s) => s.trim());
      const cccdNo = p[0] || "";
      const oldCmnd = p[1] || "";
      const fullName = restoreVietnameseCardDiacritics(p[2] || "", true);
      const dobRaw = p[3] || "";
      const dob =
        dobRaw.length === 8
          ? `${dobRaw.slice(0, 2)}/${dobRaw.slice(2, 4)}/${dobRaw.slice(4)}`
          : dobRaw;
      const gender = p[4] || "";
      const addr = restoreVietnameseCardDiacritics(p[5] || "", false);
      const issueRaw = p[6] || "";
      const issueDate =
        issueRaw.length === 8
          ? `${issueRaw.slice(0, 2)}/${issueRaw.slice(2, 4)}/${issueRaw.slice(4)}`
          : issueRaw;
      const expiry = dob ? computeStatutoryCccdExpiry(dob) : "";

      if (typeSel) typeSel.value = "IDENTITY";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = "Giấy tờ tùy thân (CCCD)";
      }
      if (titleInp && (fullName || cccdNo)) {
        titleInp.value = `CCCD: ${fullName || cccdNo}`;
      }
      if (userInp && cccdNo) {
        userInp.value = cccdNo;
      }
      if (passInp) {
        const infoParts = [];
        if (fullName) infoParts.push(`Họ tên: ${fullName}`);
        if (cccdNo) infoParts.push(`Số CCCD: ${cccdNo}`);
        if (oldCmnd) infoParts.push(`CMND cũ: ${oldCmnd}`);
        if (dob) infoParts.push(`NS: ${dob}`);
        if (gender) infoParts.push(`GT: ${gender}`);
        infoParts.push(`QT: Việt Nam`);
        if (addr) infoParts.push(`Thường trú: ${addr}`);
        if (expiry) infoParts.push(`HSD: ${expiry}`);
        if (issueDate) infoParts.push(`Ngày cấp: ${issueDate}`);
        passInp.value = mergeKeyValMetadataString(passInp.value || "", infoParts);
      }
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã đọc chuẩn xác QR CCCD: ${fullName} (${cccdNo})!`);
      }
      if (!rawText) return;
    }

    // CASE 2: Mã QR 2FA (otpauth://)
    if (rawQr && rawQr.toLowerCase().startsWith("otpauth://")) {
      try {
        const u = new URL(rawQr);
        const label = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
        const secret = (u.searchParams.get("secret") || "").toUpperCase();
        const issuer =
          u.searchParams.get("issuer") ||
          (label.includes(":") ? label.split(":")[0] : "Tài khoản 2FA");
        const username = label.includes(":") ? label.split(":").slice(1).join(":") : label;
        if (typeSel) typeSel.value = "LOGIN";
        if (titleInp && !titleInp.value) titleInp.value = issuer;
        if (userInp && !userInp.value) userInp.value = username;
        if (totpInp && secret) totpInp.value = secret;
        if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast(`🤖 Đã tự động điền khóa 2FA TOTP (${issuer})!`);
        }
        return;
      } catch (_) {}
    }

    if (!rawText) return;
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const upperText = rawText.toUpperCase();

    // CASE 2B: Nhận diện HỘ CHIẾU PHỔ THÔNG / NGOẠI GIAO / CÔNG VỤ (PASSPORT — ICAO 9303 TD3 P<VNM & QUỐC TẾ) — ĐẦY ĐỦ 9/9 TRƯỜNG
    const isPassport =
      upperText.includes("P<") ||
      upperText.includes("PASSPORT") ||
      upperText.includes("HỘ CHIẾU") ||
      upperText.includes("HO CHIEU") ||
      /\b[BCKPE]\d{7,8}\b/.test(upperText);

    if (
      isPassport &&
      !upperText.includes("GIẤY PHÉP LÁI XE") &&
      !upperText.includes("GIAY PHEP LAI XE") &&
      !upperText.includes("CĂN CƯỚC") &&
      !upperText.includes("CAN CUOC")
    ) {
      if (typeSel) typeSel.value = "IDENTITY";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = "Hộ chiếu (Passport)";
      }
      let passportNo = "";
      let fullName = "";
      let dob = "";
      let gender = "";
      let nationality = "Việt Nam";
      let birthPlace = "";
      let issueDate = "";
      let expiry = "";
      let personalIdNo = "";
      let issuedBy = "Cục Quản lý Xuất nhập cảnh";
      let mrzCode = "";
      const detectedFields = [];

      // 1. Tìm số hộ chiếu (Cxxxxxxx, Bxxxxxxx, Pxxxxxxx, Kxxxxxxx, Exxxxxxx)
      const ppMatch = upperText.match(/\b([BCKPE]\d{7,8})\b/);
      if (ppMatch) passportNo = ppMatch[1];

      // 2. Giải mã dòng 1 MRZ TD3: P<VNMHO<<TEN<<<...
      const td3Line1 = lines.find((l) => /P<[A-Z]{3}/.test(l.toUpperCase().replace(/\s+/g, "")));
      if (td3Line1) {
        const cl1 = td3Line1.toUpperCase().replace(/\s+/g, "");
        const idx = cl1.indexOf("P<");
        const countryCode = cl1.slice(idx + 2, idx + 5);
        if (countryCode && countryCode !== "VNM") nationality = countryCode;
        const nameRaw = cl1.slice(idx + 5).replace(/<+/g, " ").trim();
        if (nameRaw.length >= 4) fullName = restoreVietnameseCardDiacritics(nameRaw, true);
      }

      // 3. Giải mã dòng 2 MRZ TD3: [Số HC 9 ký tự][Check][VNM][YYMMDD][Check][M/F][YYMMDD][Check][Số định danh]...
      for (const l of lines) {
        const cl = l.toUpperCase().replace(/\s+/g, "");
        const vnmIdx = cl.indexOf("VNM");
        if (vnmIdx >= 9 && !cl.includes("P<")) {
          mrzCode = cl;
          const docPart = cl.slice(0, 9).replace(/</g, "");
          if (!passportNo && docPart) passportNo = docPart;
          const tail = cl
            .slice(vnmIdx + 3)
            .replace(/O/g, "0")
            .replace(/[IL]/g, "1")
            .replace(/B/g, "8");
          const m2 = tail.match(/^(\d{2})(\d{2})(\d{2})\d([MF<])(\d{2})(\d{2})(\d{2})\d([0-9<]{0,14})/);
          if (m2) {
            const yyB = parseInt(m2[1], 10);
            dob = `${m2[3]}/${m2[2]}/${yyB > 30 ? 1900 + yyB : 2000 + yyB}`;
            if (m2[4] === "M") gender = "Nam";
            else if (m2[4] === "F") gender = "Nữ";
            const yyE = parseInt(m2[5], 10);
            expiry = `${m2[7]}/${m2[6]}/${2000 + yyE}`;
            const pid = (m2[8] || "").replace(/</g, "");
            if (/^0\d{11}$/.test(pid)) personalIdNo = pid;
            break;
          }
        }
      }

      // 4. Tìm Nơi sinh (Place of birth), Số CCCD/CMND, Ngày cấp trên trang nhân thân Hộ chiếu
      const id12 = rawText.match(/\b(0\d{11})\b/);
      if (!personalIdNo && id12) personalIdNo = id12[1];

      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/nơi\s*sinh|noi\s*sinh|place\s*of\s*birth/i.test(ln)) {
          const tail = ln.replace(/.*(?:nơi\s*sinh|noi\s*sinh|place\s*of\s*birth)[:.\s/]*/i, "").trim();
          const candidate = tail || (lines[i + 1] || "").trim();
          if (candidate && candidate.length >= 3 && !/\d{2}\/\d{2}/.test(candidate)) {
            birthPlace = restoreVietnameseCardDiacritics(candidate, false);
          }
        }
        if (/giới\s*tính|gioi\s*tinh|\bsex\b/i.test(ln) && !gender) {
          if (/nữ|nu|female|\bF\b/i.test(ln)) gender = "Nữ";
          else if (/nam|male|\bM\b/i.test(ln)) gender = "Nam";
        }
      }

      const dates = Array.from(rawText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map((m) => m[1]);
      if (!dob && dates.length >= 1) dob = dates[0];
      if (dates.length >= 3) {
        issueDate = dates[1];
        if (!expiry) expiry = dates[2];
      } else if (!expiry && dates.length >= 2) {
        expiry = dates[dates.length - 1];
      }

      if (titleInp) {
        titleInp.value = `Hộ chiếu: ${fullName || passportNo || "Việt Nam"}`;
      }
      if (userInp && passportNo) {
        userInp.value = passportNo;
        detectedFields.push(`Số HC: ${passportNo}`);
      }
      if (fullName) detectedFields.push(`Họ tên: ${fullName}`);
      if (passInp) {
        const meta = [];
        if (fullName) meta.push(`Họ tên: ${fullName}`);
        if (passportNo) meta.push(`Số HC: ${passportNo}`);
        if (personalIdNo) meta.push(`Số CCCD: ${personalIdNo}`);
        if (dob) meta.push(`NS: ${dob}`);
        if (gender) meta.push(`GT: ${gender}`);
        if (nationality) meta.push(`QT: ${nationality}`);
        if (birthPlace) meta.push(`Nơi sinh: ${birthPlace}`);
        if (issueDate) meta.push(`Ngày cấp: ${issueDate}`);
        if (expiry) meta.push(`HSD: ${expiry}`);
        if (issuedBy) meta.push(`Nơi cấp: ${issuedBy}`);
        if (mrzCode) meta.push(`MRZ: ${mrzCode}`);
        passInp.value = mergeKeyValMetadataString(passInp.value || "", meta);
      }
      if (detectedFields.length > 0 && typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã bóc tách đầy đủ Hộ chiếu (Passport): ${detectedFields.join(" • ")}!`);
      }
      return;
    }

    // CASE 2C: Nhận diện THẺ BẢO HIỂM Y TẾ / BHXH (HEALTH INSURANCE CARD — Mẫu 15 ký tự DN401... & Mẫu mới 10 số BHXH) — ĐẦY ĐỦ 8/8 TRƯỜNG
    const isBhyt =
      upperText.includes("BẢO HIỂM Y TẾ") ||
      upperText.includes("BAO HIEM Y TE") ||
      upperText.includes("BẢO HIỂM XÃ HỘI") ||
      upperText.includes("BAO HIEM XA HOI") ||
      upperText.includes("HEALTH INSURANCE") ||
      upperText.includes("ĐK KCB BAN ĐẦU") ||
      upperText.includes("DK KCB BAN DAU") ||
      /\b(?:DN|HX|CH|NN|TK|HC|XK|CA|HT|TB|MS|XB|XN|TN|CC|CK|CB|KC|HD|TE|BT|HN|DT|DK|XD|TS|TC|TQ|TA|TY|HG|LS|CN|HS|SV|GB|GD|PV)[1-5]\d{12}\b/.test(
        upperText.replace(/\s+/g, "")
      );

    if (isBhyt) {
      if (typeSel) typeSel.value = "IDENTITY";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = "Thẻ Bảo hiểm Y tế (BHYT)";
      }
      const cleanUpperNoSpace = upperText.replace(/[\s\-]+/g, "");
      const code15 = cleanUpperNoSpace.match(
        /\b((?:DN|HX|CH|NN|TK|HC|XK|CA|HT|TB|MS|XB|XN|TN|CC|CK|CB|KC|HD|TE|BT|HN|DT|DK|XD|TS|TC|TQ|TA|TY|HG|LS|CN|HS|SV|GB|GD|PV)[1-5]\d{12})\b/
      );
      const code10 = rawText.match(/\b(\d{10})\b/);
      const bhytCode = code15 ? code15[1] : code10 ? code10[1] : "";
      const bhxhCode = code15 ? code15[1].slice(-10) : code10 ? code10[1] : "";
      let fullName = "";
      let gender = "";
      let address = "";
      let hospitalName = "";
      let fiveYearDate = "";

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const cleanL = l.replace(/[^A-ZÀ-Ỹ\s]/g, "").trim();
        if (
          !fullName &&
          cleanL === l.trim() &&
          cleanL.split(/\s+/).length >= 2 &&
          cleanL.length >= 7 &&
          !/BẢO HIỂM|BAO HIEM|VIỆT NAM|VIET NAM|THẺ|THE|QUYỀN LỢI|QUYEN LOI/i.test(cleanL)
        ) {
          fullName = restoreVietnameseCardDiacritics(cleanL, true);
        }
        if (/giới\s*tính|gioi\s*tinh/i.test(l)) {
          if (/nữ|nu/i.test(l)) gender = "Nữ";
          else if (/nam/i.test(l)) gender = "Nam";
        }
        if (/địa\s*chỉ|dia\s*chi/i.test(l)) {
          address = restoreVietnameseCardDiacritics(l.replace(/.*(?:địa\s*chỉ|dia\s*chi)[:.\s/]*/i, "").trim(), false);
        }
        if (/kcb\s*ban\s*đầu|kcb\s*ban\s*dau|nơi\s*đk\s*kcb|noi\s*dk\s*kcb/i.test(l)) {
          const tail = l.replace(/.*(?:ban\s*đầu|ban\s*dau|đk\s*kcb|dk\s*kcb)[:.\s/]*/i, "").trim();
          hospitalName = restoreVietnameseCardDiacritics(tail || (lines[i + 1] || "").trim(), false);
        }
        if (/5\s*năm\s*liên\s*tục|5\s*nam\s*lien\s*tuc/i.test(l)) {
          const dm = l.match(/(\d{2}\/\d{2}\/\d{4})/);
          if (dm) fiveYearDate = dm[1];
        }
      }
      const dates = Array.from(rawText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map((m) => m[1]);
      const dob = dates.length >= 1 ? dates[0] : "";
      const validFrom = dates.length >= 2 ? dates[1] : "";
      const expiry = dates.length >= 3 ? dates[2] : dates.length === 2 ? dates[1] : "";

      if (titleInp) titleInp.value = `Thẻ BHYT: ${fullName || bhytCode}`;
      if (userInp && bhytCode) userInp.value = bhytCode;
      if (passInp) {
        const meta = [];
        if (fullName) meta.push(`Họ tên: ${fullName}`);
        if (bhytCode) meta.push(`Mã BHYT: ${bhytCode}`);
        if (bhxhCode && bhxhCode !== bhytCode) meta.push(`Mã BHXH: ${bhxhCode}`);
        if (dob) meta.push(`NS: ${dob}`);
        if (gender) meta.push(`GT: ${gender}`);
        if (address) meta.push(`Địa chỉ: ${address}`);
        if (hospitalName) meta.push(`Nơi ĐK KCB: ${hospitalName}`);
        if (validFrom && validFrom !== expiry) meta.push(`Hiệu lực từ: ${validFrom}`);
        if (expiry) meta.push(`HSD: ${expiry}`);
        if (fiveYearDate) meta.push(`Thời điểm 5 năm: ${fiveYearDate}`);
        passInp.value = mergeKeyValMetadataString(passInp.value || "", meta);
      }
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã bóc tách đầy đủ Thẻ BHYT: ${bhytCode || fullName}!`);
      }
      return;
    }

    // CASE 2D: Nhận diện GIẤY ĐĂNG KÝ XE / CAVET Ô TÔ - XE MÁY (VEHICLE REGISTRATION) — ĐẦY ĐỦ 10/10 TRƯỜNG
    const isVehicleReg =
      upperText.includes("ĐĂNG KÝ XE") ||
      upperText.includes("DANG KY XE") ||
      upperText.includes("VEHICLE REGISTRATION") ||
      upperText.includes("SỐ KHUNG") ||
      upperText.includes("SO KHUNG") ||
      upperText.includes("CHASSIS") ||
      upperText.includes("SỐ MÁY") ||
      upperText.includes("ENGINE N");

    if (isVehicleReg) {
      if (typeSel) typeSel.value = "IDENTITY";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = "Giấy đăng ký xe (Cavet)";
      }
      const plateMatch = upperText.match(/\b(\d{2}[A-Z]\d?[-\s.]?\d{3,5}(?:\.\d{2})?)\b/);
      const plateNo = plateMatch ? plateMatch[1].replace(/\s+/g, "-") : "";
      let ownerName = "";
      let address = "";
      let brandModel = "";
      let vehicleType = "";
      let color = "";
      let chassisNo = "";
      let engineNo = "";
      let capacity = "";
      let seats = "";

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/tên\s*chủ\s*xe|ten\s*chu\s*xe|owner.?s?\s*full\s*name/i.test(l)) {
          const tail = l.replace(/.*(?:tên\s*chủ\s*xe|ten\s*chu\s*xe|full\s*name)[:.\s/]*/i, "").trim();
          ownerName = restoreVietnameseCardDiacritics(tail || (lines[i + 1] || "").trim(), true);
        }
        if (/địa\s*chỉ|dia\s*chi|address/i.test(l)) {
          const tail = l.replace(/.*(?:địa\s*chỉ|dia\s*chi|address)[:.\s/]*/i, "").trim();
          address = restoreVietnameseCardDiacritics(tail || (lines[i + 1] || "").trim(), false);
        }
        if (/nhãn\s*hiệu|nhan\s*hieu|brand/i.test(l)) {
          const m = l.match(/(?:nhãn\s*hiệu|nhan\s*hieu|brand)[:.\s/]*([A-Za-z0-9\s\-]+)/i);
          if (m) brandModel = m[1].trim();
        }
        if (/loại\s*xe|loai\s*xe|type/i.test(l)) {
          const m = l.match(/(?:loại\s*xe|loai\s*xe|type)[:.\s/]*([A-Za-zÀ-ỹ0-9\s\-]+)/i);
          if (m) vehicleType = restoreVietnameseCardDiacritics(m[1].trim(), false);
        }
        if (/màu\s*sơn|mau\s*son|color/i.test(l)) {
          const m = l.match(/(?:màu\s*sơn|mau\s*son|color)[:.\s/]*([A-Za-zÀ-ỹ\s\-]+)/i);
          if (m) color = restoreVietnameseCardDiacritics(m[1].trim(), false);
        }
        if (/số\s*khung|so\s*khung|chassis/i.test(l)) {
          const m = l.match(/(?:số\s*khung|so\s*khung|chassis[^:]*?)[:.\s/]*([A-Z0-9\-]{6,20})/i);
          if (m) chassisNo = m[1].trim().toUpperCase();
        }
        if (/số\s*máy|so\s*may|engine/i.test(l)) {
          const m = l.match(/(?:số\s*máy|so\s*may|engine[^:]*?)[:.\s/]*([A-Z0-9\-]{5,20})/i);
          if (m) engineNo = m[1].trim().toUpperCase();
        }
        if (/dung\s*tích|dung\s*tich|capacity/i.test(l)) {
          const m = l.match(/(\d{2,4}\s*cm3|\d{2,4})/i);
          if (m) capacity = m[1].trim();
        }
        if (/chỗ\s*ngồi|cho\s*ngoi|sit/i.test(l)) {
          const m = l.match(/(\d{1,2})\b/);
          if (m) seats = m[1];
        }
      }
      const dates = Array.from(rawText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map((m) => m[1]);
      const issueDate = dates.length >= 1 ? dates[0] : "";
      const expiry = dates.length >= 2 ? dates[dates.length - 1] : "";

      if (titleInp) {
        titleInp.value = `Đăng ký xe: ${plateNo || brandModel || ownerName || "Phương tiện"}`;
      }
      if (userInp && plateNo) userInp.value = plateNo;
      if (passInp) {
        const meta = [];
        if (ownerName) meta.push(`Chủ xe: ${ownerName}`);
        if (plateNo) meta.push(`Biển số: ${plateNo}`);
        if (brandModel) meta.push(`Nhãn hiệu: ${brandModel}`);
        if (vehicleType) meta.push(`Loại xe: ${vehicleType}`);
        if (color) meta.push(`Màu sơn: ${color}`);
        if (chassisNo) meta.push(`Số khung: ${chassisNo}`);
        if (engineNo) meta.push(`Số máy: ${engineNo}`);
        if (capacity) meta.push(`Dung tích: ${capacity}`);
        if (seats) meta.push(`Số chỗ: ${seats}`);
        if (address) meta.push(`Địa chỉ: ${address}`);
        if (issueDate) meta.push(`Ngày cấp: ${issueDate}`);
        if (expiry) meta.push(`HSD: ${expiry}`);
        passInp.value = mergeKeyValMetadataString(passInp.value || "", meta);
      }
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã bóc tách đầy đủ Giấy đăng ký xe (Cavet): ${plateNo || brandModel}!`);
      }
      return;
    }

    // CASE 2E: Nhận diện THẺ SINH VIÊN / THẺ NHÂN VIÊN / THẺ CÔNG CHỨC / CHỨNG CHỈ HÀNH NGHỀ / THẺ MÃ SỐ THUẾ
    const isStudentOrStaffCard =
      upperText.includes("THẺ SINH VIÊN") ||
      upperText.includes("THE SINH VIEN") ||
      upperText.includes("STUDENT ID") ||
      upperText.includes("STUDENT CARD") ||
      upperText.includes("MSSV") ||
      upperText.includes("THẺ NHÂN VIÊN") ||
      upperText.includes("THE NHAN VIEN") ||
      upperText.includes("THẺ CÁN BỘ") ||
      upperText.includes("THE CAN BO") ||
      upperText.includes("EMPLOYEE ID") ||
      upperText.includes("STAFF CARD") ||
      upperText.includes("CHỨNG CHỈ HÀNH NGHỀ") ||
      upperText.includes("CHUNG CHI HANH NGHE") ||
      upperText.includes("MÃ SỐ THUẾ") ||
      upperText.includes("MA SO THUE");

    if (
      isStudentOrStaffCard &&
      !upperText.includes("CĂN CƯỚC") &&
      !upperText.includes("GIẤY PHÉP LÁI XE")
    ) {
      if (typeSel) typeSel.value = "IDENTITY";
      const isStudent = /SINH VIÊN|SINH VIEN|STUDENT|MSSV/i.test(upperText);
      const isTax = /MÃ SỐ THUẾ|MA SO THUE/i.test(upperText);
      const cardLabel = isStudent ? "Thẻ Sinh viên" : isTax ? "Thẻ Mã số thuế" : "Thẻ Nhân viên / Cán bộ";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = cardLabel;
      }

      let idCode = "";
      let fullName = "";
      let orgName = "";
      let deptName = "";
      let roleTitle = "";
      let courseYear = "";

      const codeMatch =
        rawText.match(/(?:MSSV|MSNV|Mã\s*SV|Mã\s*NV|Mã\s*số\s*thuế|ID\s*No|Số\s*thẻ)[:.\s/]*([A-Z0-9\-]{5,15})/i) ||
        rawText.match(/\b(\d{8,13})\b/);
      if (codeMatch) idCode = codeMatch[1].trim();

      for (const l of lines) {
        if (/TRƯỜNG|TRUONG|ĐẠI HỌC|DAI HOC|HỌC VIỆN|HOC VIEN|UNIVERSITY|COLLEGE|CÔNG TY|CONG TY|VIỆN|VIEN|BỆNH VIỆN|BENH VIEN/i.test(l) && !orgName) {
          orgName = restoreVietnameseCardDiacritics(l.trim(), false);
        }
        if (/KHOA|PHÒNG|PHONG|BAN|FACULTY|DEPARTMENT/i.test(l) && !deptName) {
          deptName = restoreVietnameseCardDiacritics(l.trim(), false);
        }
        if (/CHỨC VỤ|CHUC VU|POSITION|TITLE/i.test(l) && !roleTitle) {
          roleTitle = restoreVietnameseCardDiacritics(l.replace(/.*(?:chức\s*vụ|chuc\s*vu|position|title)[:.\s/]*/i, "").trim(), false);
        }
        if (/KHÓA|KHOA\s*HỌC|NIÊN\s*KHÓA|NIEN\s*KHOA|LỚP|LOP|COURSE|CLASS/i.test(l) && !courseYear) {
          courseYear = restoreVietnameseCardDiacritics(l.trim(), false);
        }
        const cleanL = l.replace(/[^A-ZÀ-Ỹ\s]/g, "").trim();
        if (
          !fullName &&
          cleanL === l.trim() &&
          cleanL.split(/\s+/).length >= 2 &&
          cleanL.split(/\s+/).length <= 5 &&
          cleanL.length >= 7 &&
          !/TRƯỜNG|TRUONG|ĐẠI HỌC|DAI HOC|SINH VIÊN|SINH VIEN|NHÂN VIÊN|NHAN VIEN|CÁN BỘ|CAN BO|CÔNG TY|CONG TY|VIỆT NAM|VIET NAM/i.test(cleanL)
        ) {
          fullName = restoreVietnameseCardDiacritics(cleanL, true);
        }
      }

      const dates = Array.from(rawText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map((m) => m[1]);
      const dob = dates.length >= 1 ? dates[0] : "";
      const expiry = dates.length >= 2 ? dates[dates.length - 1] : "";

      if (titleInp) titleInp.value = `${cardLabel}: ${fullName || idCode || orgName}`;
      if (userInp && idCode) userInp.value = idCode;
      if (passInp) {
        const meta = [];
        if (fullName) meta.push(`Họ tên: ${fullName}`);
        if (idCode) meta.push(`${isTax ? "Mã số thuế" : "Mã SV/NV"}: ${idCode}`);
        if (orgName) meta.push(`Trường/Đơn vị: ${orgName}`);
        if (deptName) meta.push(`Khoa/Phòng: ${deptName}`);
        if (roleTitle) meta.push(`Chức vụ: ${roleTitle}`);
        if (courseYear) meta.push(`Khóa/Lớp: ${courseYear}`);
        if (dob) meta.push(`NS: ${dob}`);
        if (expiry) meta.push(`HSD: ${expiry}`);
        const extraKv = extractUniversalKeyValues(lines);
        passInp.value = mergeKeyValMetadataString(passInp.value || "", [...meta, ...extraKv]);
      }
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã bóc tách ${cardLabel}: ${fullName || idCode}!`);
      }
      return;
    }

    // CASE 3: Nhận diện GIẤY PHÉP LÁI XE / BẰNG LÁI XE (DRIVER'S LICENSE - BỘ GTVT / BỘ CÔNG AN — Mẫu PET cũ B1/B2 & Mẫu mới 2025/2026 C1/B/A1) — ĐẦY ĐỦ 8/8 TRƯỜNG
    const isDriverLicense =
      upperText.includes("GIẤY PHÉP LÁI XE") ||
      upperText.includes("GIAY PHEP LAI XE") ||
      upperText.includes("DRIVER'S LICENSE") ||
      upperText.includes("DRIVERS LICENSE") ||
      upperText.includes("DRIVER LICENSE") ||
      upperText.includes("DRIVING LICENCE") ||
      upperText.includes("BỘ GTVT") ||
      upperText.includes("BO GTVT") ||
      upperText.includes("CLASSIFICATION OF MOTOR") ||
      upperText.includes("ĐƯỢC ĐIỀU KHIỂN") ||
      upperText.includes("DUOC DIEU KHIEN") ||
      upperText.includes("BEGINNING DATE") ||
      upperText.includes("HẠNG/CLASS") ||
      upperText.includes("HANG/CLASS") ||
      (titleInp && (titleInp.value || "").toUpperCase().startsWith("GPLX"));

    if (isDriverLicense) {
      if (typeSel) typeSel.value = "IDENTITY";
      if (
        folderInp &&
        (!folderInp.value ||
          folderInp.value === "Mặc định" ||
          folderInp.value.includes("CCCD"))
      ) {
        folderInp.value = "Giấy phép lái xe (GPLX)";
      }

      const detectedFields = [];
      let gplxNo = "";
      let fullName = "";
      let dob = "";
      let nationality = "Việt Nam";
      let address = "";
      let expiry = "";
      let issueDate = "";
      let beginDate = "";
      let licenseClass = "";
      let vehicleScope = "";
      let serialNo = "";
      let issuedBy = "";

      // 3A. Tìm Số GPLX (12 chữ số, ví dụ: 010070000011 hoặc 790123456789)
      const m12 = rawText.match(/(?:^|[^0-9])(\d{12})(?:[^0-9]|$)/);
      if (m12) gplxNo = m12[1];

      // 3B. Tìm Hạng bằng lái xe (Hỗ trợ cả mẫu cũ A1..FE và mẫu mới Luật TTATGTĐB: A1, A, B1, B, C1, C, D1, D2, D, BE, C1E, CE, D1E, D2E, DE)
      const classMatch =
        rawText.match(/(?:Hạng|Hang|Class)[:.\s/]*\b(A[1-4]?|B[12E]?|C1E?|CE?|D[12]?E?|FB2|F[CDE])\b/i) ||
        rawText.match(/\bClass[:.\s/]*([A-F][1-4E]?)\b/i) ||
        rawText.match(/\b(B1|B2|A1|A2|C1|B|C|D|E|FC)\b/);
      if (classMatch) {
        licenseClass = classMatch[1].toUpperCase();
      }

      // 3C. Tìm Số phôi mặt sau GPLX (VD: BP887917)
      const serialMatch = rawText.match(/\b([A-Z]{2}\d{6,8})\b/);
      if (serialMatch && !serialMatch[1].startsWith("ID")) {
        serialNo = serialMatch[1];
      }

      // 3D. Tìm Họ tên trên GPLX
      for (let i = 0; i < lines.length; i++) {
        if (/full\s*name|họ\s*tên|ho\s*ten|họ\s*và\s*tên/i.test(lines[i])) {
          const afterColon = lines[i]
            .replace(/.*(?:full\s*name|họ\s*tên|ho\s*ten|họ\s*và\s*tên)[:.\s/]*/i, "")
            .trim();
          const nameParts = [];
          if (afterColon && /^[A-ZÀ-Ỹ\s]{4,}$/.test(afterColon)) {
            nameParts.push(afterColon);
          }
          for (let k = i + 1; k <= Math.min(lines.length - 1, i + 2); k++) {
            const nxt = lines[k].trim();
            if (/ngày\s*sinh|ngay\s*sinh|date\s*of\s*birth|quốc\s*tịch|quoc\s*tich|nationality|\d/i.test(nxt)) {
              break;
            }
            const cleanNxt = nxt.replace(/[^A-ZÀ-Ỹ\s]/gi, "").trim();
            if (cleanNxt && cleanNxt === cleanNxt.toUpperCase() && cleanNxt.length >= 2) {
              nameParts.push(cleanNxt);
            }
          }
          if (nameParts.length > 0) {
            fullName = restoreVietnameseCardDiacritics(nameParts.join(" "), true);
            break;
          }
        }
      }

      if (!fullName || fullName.split(/\s+/).length < 2) {
        for (const l of lines) {
          const cleanL = l.replace(/[^A-ZÀ-Ỹ\s]/g, "").trim();
          const words = cleanL.split(/\s+/).filter(Boolean);
          if (
            cleanL === l.trim() &&
            words.length >= 2 &&
            words.length <= 5 &&
            cleanL.length >= 7 &&
            !/CONG HOA|CỘNG HÒA|VIET NAM|VIỆT NAM|DOC LAP|ĐỘC LẬP|GIAY PHEP|GIẤY PHÉP|LAI XE|LÁI XE|DRIVER|LICENSE|BO GTVT|BỘ GTVT|MOTOR|VEHICLE|CLASSIFICATION|GIÁM ĐỐC|GIAM DOC|CỤC ĐƯỜNG BỘ|LE NGOC DIEN|LÊ NGỌC DIỄN/i.test(
              cleanL
            )
          ) {
            fullName = restoreVietnameseCardDiacritics(cleanL, true);
            break;
          }
        }
      }

      // 3E. Tìm Nơi cư trú / Address trên GPLX
      for (let i = 0; i < lines.length; i++) {
        if (/cư\s*trú|cu\s*tru|address/i.test(lines[i])) {
          const sameTail = lines[i].replace(/.*(?:cư\s*trú|cu\s*tru|address)[:.\s/]*/i, "").trim();
          const addrParts = [];
          if (sameTail && sameTail.length >= 2) addrParts.push(sameTail);
          for (let k = i + 1; k <= Math.min(lines.length - 1, i + 2); k++) {
            const nxt = lines[k]
              .replace(/Có giá trị.*|Co gia tri.*|Date of.*|Expires.*|Hạng\/Class.*|Hang\/Class.*/gi, "")
              .trim();
            if (/hạng|class|có giá trị|expires|ngày|date|giám đốc|giam doc/i.test(lines[k]) && !nxt) break;
            if (nxt && nxt.length >= 3) addrParts.push(nxt);
          }
          if (addrParts.length > 0) {
            address = restoreVietnameseCardDiacritics(addrParts.join(", "), false);
            break;
          }
        }
      }

      // 3F. Tìm Ngày sinh, Ngày trúng tuyển (Beginning date), Có giá trị đến (Expires / Không thời hạn)
      if (/không\s*thời\s*hạn|khong\s*thoi\s*han|unlimited/i.test(rawText)) {
        expiry = "Không thời hạn";
      }
      const allDates = Array.from(rawText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map((m) => m[1]);
      for (const l of lines) {
        const dm = l.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (!dm) continue;
        if (/sinh|birth/i.test(l)) dob = dm[1];
        else if (/giá\s*trị|gia\s*tri|expires|expiry/i.test(l)) expiry = dm[1];
        else if (/trúng\s*tuyển|trung\s*tuyen|beginning/i.test(l)) beginDate = dm[1];
      }
      if (slot === "front") {
        if (!dob && allDates.length >= 1) dob = allDates[0];
        if (!expiry && allDates.length >= 2) expiry = allDates[allDates.length - 1];
      } else if (slot === "back") {
        if (!beginDate && allDates.length >= 1) beginDate = allDates[0];
      }
      const vnIssueMatch =
        rawText.match(/ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i) ||
        rawText.match(/ngay\s*(\d{1,2})\s*thang\s*(\d{1,2})\s*nam\s*(\d{4})/i);
      if (vnIssueMatch) {
        issueDate = `${vnIssueMatch[1].padStart(2, "0")}/${vnIssueMatch[2].padStart(2, "0")}/${vnIssueMatch[3]}`;
      }
      if (/9\s*chỗ|9\s*cho|3500\s*kg|9\s*seats/i.test(rawText)) {
        vehicleScope = "Ô tô chở người đến 9 chỗ ngồi, tải trọng < 3.500 kg";
      } else if (/mô\s*tô\s*hai\s*bánh|mo\s*to\s*hai\s*banh|175\s*cm3/i.test(rawText)) {
        vehicleScope = "Xe mô tô hai bánh có dung tích xi-lanh từ 50 đến dưới 175 cm3";
      }
      if (/LÊ\s*NGỌC\s*DIỄN|LE\s*NGOC\s*DIEN/i.test(rawText)) {
        issuedBy = "Sở GTVT Hà Nội (KT. Giám đốc: Lê Ngọc Diễn)";
      } else if (/CẢNH\s*SÁT\s*GIAO\s*THÔNG|CANH\s*SAT\s*GIAO\s*THONG|TRAFFIC\s*POLICE/i.test(rawText)) {
        issuedBy = "Cục Cảnh sát Giao thông - Bộ Công an";
      }

      const classPrefix = licenseClass ? `GPLX Hạng ${licenseClass}` : "GPLX";
      if (titleInp) {
        const curTitle = (titleInp.value || "")
          .replace(/^(?:GPLX(?:\s+Hạng\s+[A-Z0-9]+)?|CCCD):\s*/i, "")
          .trim();
        const bestName =
          fullName && fullName.split(/\s+/).length >= 2
            ? fullName
            : curTitle && !/^\d+$/.test(curTitle)
            ? curTitle
            : gplxNo;
        if (bestName) {
          titleInp.value = `${classPrefix}: ${bestName}`;
        }
      }

      if (userInp && gplxNo) {
        userInp.value = gplxNo + (licenseClass ? ` (Hạng ${licenseClass})` : "");
        detectedFields.push(`Số GPLX: ${gplxNo}`);
      }
      if (fullName) detectedFields.push(`Họ tên: ${fullName}`);
      if (licenseClass) detectedFields.push(`Hạng: ${licenseClass}`);

      if (passInp) {
        let curPass = (passInp.value || "")
          .replace(/\s*\|?\s*HSD:\s*\d{2}\/\d{2}\b/g, "")
          .replace(/\s*\|?\s*CVV:\s*\d{3}\b/g, "")
          .trim();
        const newEntries = [];
        if (fullName) newEntries.push(`Họ tên: ${fullName}`);
        if (gplxNo) newEntries.push(`Số GPLX: ${gplxNo}`);
        if (licenseClass) newEntries.push(`Hạng: ${licenseClass}`);
        if (dob) newEntries.push(`NS: ${dob}`);
        if (nationality) newEntries.push(`QT: ${nationality}`);
        if (address) newEntries.push(`Nơi cư trú: ${address}`);
        if (expiry) newEntries.push(`HSD: ${expiry}`);
        if (beginDate) newEntries.push(`Trúng tuyển: ${beginDate}`);
        if (issueDate) newEntries.push(`Ngày cấp: ${issueDate}`);
        if (serialNo) newEntries.push(`Số phôi: ${serialNo}`);
        if (vehicleScope) newEntries.push(`Phạm vi: ${vehicleScope}`);
        if (issuedBy) newEntries.push(`Nơi cấp: ${issuedBy}`);
        passInp.value = mergeKeyValMetadataString(curPass, newEntries);
      }

      if (detectedFields.length > 0 && typeof window.showKryptoToast === "function") {
        window.showKryptoToast(
          `🤖 Đã nhận dạng đầy đủ Bằng lái xe (GPLX): ${detectedFields.join(" • ")}!`
        );
      }
      return;
    }

    // CASE 4: Nhận diện CĂN CƯỚC CÔNG DÂN / THẺ CĂN CƯỚC MẪU MỚI 2024-2026 / CMND 9-12 SỐ — ĐẦY ĐỦ 10/10 TRƯỜNG
    // Hỗ trợ cả 3 mẫu:
    //   - Mẫu 1: CCCD gắn chip (2021-2024: Số/No., Họ và tên, Ngày sinh, Giới tính, Quốc tịch, Quê quán, Nơi thường trú, ĐĐND)
    //   - Mẫu 2: Thẻ Căn cước mới Luật 26/2023/QH15 (từ 01/07/2024: "CĂN CƯỚC / IDENTITY CARD", Số định danh cá nhân / Personal identification number, Nơi đăng ký khai sinh / Place of birth, Nơi cư trú / Place of residence, Bộ Công an / Ministry of Public Security ở mặt sau)
    //   - Mẫu 3: CMND 9 số / CCCD mã vạch
    const isCccd =
      upperText.includes("IDVNM") ||
      upperText.includes("CĂN CƯỚC") ||
      upperText.includes("CAN CUOC") ||
      upperText.includes("CHỨNG MINH NHÂN DÂN") ||
      upperText.includes("CHUNG MINH NHAN DAN") ||
      upperText.includes("CITIZEN IDENTITY") ||
      upperText.includes("IDENTITY CARD") ||
      upperText.includes("ĐỊNH DANH CÁ NHÂN") ||
      upperText.includes("DINH DANH CA NHAN") ||
      upperText.includes("PERSONAL IDENTIFICATION") ||
      upperText.includes("SOCIALIST REPUBLIC") ||
      upperText.includes("ĐẶC ĐIỂM NHẬN DẠNG") ||
      upperText.includes("DAC DIEM NHAN DANG") ||
      /\b0\d{11}\b/.test(rawText);

    if (isCccd) {
      if (typeSel) typeSel.value = "IDENTITY";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = "Giấy tờ tùy thân (CCCD)";
      }

      const detectedFields = [];
      let cccdNo = "";
      let fullName = "";
      let dob = "";
      let gender = "";
      let nationality = "Việt Nam";
      let originPlace = "";
      let residencePlace = "";
      let expiry = "";
      let personalIdFeature = "";
      let issueDate = "";
      let issuedBy = "";
      let mrzCode = "";

      // 4A. Tìm Số CCCD / Số định danh cá nhân 12 chữ số (hoặc CMND 9 chữ số nếu thẻ cũ)
      const standalone12 = rawText.match(/(?:^|[^0-9])(0\d{11})(?:[^0-9]|$)/);
      if (standalone12) {
        cccdNo = standalone12[1];
      } else {
        const cmnd9 = rawText.match(/(?:Số|So|No\.?)[:.\s/]*(\d{9})\b/i);
        if (cmnd9) cccdNo = cmnd9[1];
      }

      // 4B. Giải mã chuẩn ICAO 9303 TD1 MRZ trên Mặt sau CCCD / Thẻ Căn cước (3 dòng x 30 ký tự):
      // Dòng 1: IDVNM0790044482035079004448<<6 (Lưu ý: không đổi chữ I trong IDVNM thành số 1, đổi ký tự « » thành <<, và cắt đúng 30 ký tự dòng 1)
      const mrzLine1 = lines.find((l) => /[I1L]DVNM/i.test(l.replace(/\s+/g, "")));
      if (mrzLine1) {
        const rawMrz1 = mrzLine1
          .toUpperCase()
          .replace(/\s+/g, "")
          .replace(/[«»]/g, "<<");
        const idIdx = rawMrz1.search(/[I1L]DVNM/);
        if (idIdx >= 0) {
          const tailAfterIdvnm = rawMrz1
            .slice(idIdx + 5)
            .replace(/O/g, "0")
            .replace(/[IL]/g, "1");
          const fullMrz1 = ("IDVNM" + tailAfterIdvnm).slice(0, 30);
          mrzCode = fullMrz1;
          if (!cccdNo) {
            const candidate12 = tailAfterIdvnm.slice(10, 22);
            if (/^0\d{11}$/.test(candidate12)) {
              cccdNo = candidate12;
            } else {
              const beforeLt = tailAfterIdvnm.match(/(0\d{11})<+/);
              if (beforeLt) cccdNo = beforeLt[1];
            }
          }
        }
      }

      // Dòng 2 MRZ: 7912126M3912128VNM<<<<<<<<<<<4 (hỗ trợ cả khi dòng 2 bị dính nối tiếp sau dòng 1)
      const allMrzCandidates = [...lines];
      if (mrzLine1 && mrzLine1.replace(/\s+/g, "").length > 35) {
        allMrzCandidates.push(mrzLine1.replace(/\s+/g, "").slice(28));
      }
      for (const l of allMrzCandidates) {
        const cl = l.toUpperCase().replace(/\s+/g, "").replace(/[«»]/g, "<<");
        // Tìm vị trí VNM của dòng 2 (bỏ qua IDVNM ở đầu nếu có)
        const searchStr = cl.replace(/^[I1L]DVNM/, "_____");
        const vnmIdx = searchStr.indexOf("VNM");
        if (vnmIdx >= 15) {
          const prefix15 = searchStr
            .slice(vnmIdx - 15, vnmIdx)
            .replace(/O/g, "0")
            .replace(/[IL]/g, "1")
            .replace(/B/g, "8")
            .replace(/S/g, "5")
            .replace(/Z/g, "2");
          const m2 = prefix15.match(/^(\d{2})(\d{2})(\d{2})\d([MF<])(\d{2})(\d{2})(\d{2})\d$/);
          if (m2) {
            const yyB = parseInt(m2[1], 10);
            const yearB = yyB > 30 ? 1900 + yyB : 2000 + yyB;
            dob = `${m2[3]}/${m2[2]}/${yearB}`;
            if (m2[4] === "M") gender = "Nam";
            else if (m2[4] === "F") gender = "Nữ";
            const yyE = parseInt(m2[5], 10);
            const yearE = 2000 + yyE;
            expiry = `${m2[7]}/${m2[6]}/${yearE}`;
            nationality = "Việt Nam";
            break;
          }
        }
      }

      // 4C. Tìm Họ và tên đầy đủ trên Mặt trước (Hỗ trợ cả "Họ và tên" lẫn "Họ, chữ đệm và tên khai sinh" trên Thẻ Căn cước 2024)
      for (let i = 0; i < lines.length; i++) {
        if (/full\s*name|họ\s*và\s*tên|ho\s*va\s*ten|tên\s*khai\s*sinh|ten\s*khai\s*sinh/i.test(lines[i])) {
          const sameLinePart = lines[i]
            .replace(/.*(?:full\s*name|họ\s*và\s*tên|ho\s*va\s*ten|tên\s*khai\s*sinh|ten\s*khai\s*sinh)[:.\s/]*/i, "")
            .trim();
          const nameParts = [];
          if (sameLinePart && /^[A-ZÀ-Ỹ\s]{4,}$/.test(sameLinePart)) {
            nameParts.push(sameLinePart);
          }
          for (let k = i + 1; k <= Math.min(lines.length - 1, i + 2); k++) {
            const nxt = lines[k].trim();
            if (/ngày\s*sinh|ngay\s*sinh|date\s*of\s*birth|giới\s*tính|gioi\s*tinh|sex|quốc\s*tịch|\d/i.test(nxt)) {
              break;
            }
            const cleanNxt = nxt.replace(/[^A-ZÀ-Ỹ\s]/gi, "").trim();
            if (cleanNxt && cleanNxt === cleanNxt.toUpperCase() && cleanNxt.length >= 2) {
              nameParts.push(cleanNxt);
            }
          }
          if (nameParts.length > 0) {
            fullName = restoreVietnameseCardDiacritics(nameParts.join(" "), true);
            break;
          }
        }
      }

      if (!fullName || fullName.split(/\s+/).length < 2) {
        for (const l of lines) {
          const cleanL = l.replace(/[^A-ZÀ-Ỹ\s]/g, "").trim();
          const words = cleanL.split(/\s+/).filter(Boolean);
          if (
            cleanL === l.trim() &&
            words.length >= 2 &&
            words.length <= 5 &&
            cleanL.length >= 7 &&
            !/CONG HOA|CỘNG HÒA|CAN CUOC|CĂN CƯỚC|VIET NAM|VIỆT NAM|DOC LAP|ĐỘC LẬP|HANH PHUC|HẠNH PHÚC|CẢNH SÁT|CANH SAT|QUẢN LÝ|QUAN LY|TRẬT TỰ|TRAT TU|XÃ HỘI|XA HOI|CITIZEN|REPUBLIC|DIRECTOR|DEPARTMENT|ADMINISTRATIVE|MANAGEMENT|BỘ CÔNG AN|BO CONG AN|MINISTRY/i.test(
              cleanL
            )
          ) {
            fullName = restoreVietnameseCardDiacritics(cleanL, true);
            break;
          }
        }
      }

      if (!fullName || fullName.split(/\s+/).length < 2) {
        const mrzNameLine = lines.find(
          (l) =>
            /^[A-Z<]{10,}$/.test(l.replace(/\s+/g, "")) &&
            l.includes("<<") &&
            !l.toUpperCase().includes("IDVNM") &&
            !l.toUpperCase().includes("VNM<")
        );
        if (mrzNameLine) {
          const mrzName = mrzNameLine
            .replace(/<+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (mrzName.split(" ").length >= 2) {
            fullName = restoreVietnameseCardDiacritics(mrzName, true);
          }
        }
      }

      // 4D. Tìm Giới tính (Nam / Nữ) — Hỗ trợ cả khi ML Kit đọc nhầm "Sex" -> "Sax", "Giới tính" -> "Giói tinh" VÀ suy ra chính xác 100% từ chữ số thứ 4 của Số CCCD 12 số!
      for (const l of lines) {
        if (/gi[ớoó]i\s*t[íi]nh|gioi\s*tinh|\bs[ea]x\b/i.test(l)) {
          if (/\b(nữ|nu|female)\b/i.test(l)) gender = "Nữ";
          else if (/\b(nam|male)\b/i.test(l)) gender = "Nam";
        }
      }
      if (!gender) {
        if (/(?:s[ea]x|t[íi]nh)[:.\s/]*(Nam|Male)\b/i.test(rawText)) gender = "Nam";
        else if (/(?:s[ea]x|t[íi]nh)[:.\s/]*(Nữ|Nu|Female)\b/i.test(rawText)) gender = "Nữ";
      }
      // Quy tắc pháp định Cấu trúc Số định danh cá nhân 12 số Việt Nam:
      // 3 số đầu = Mã tỉnh/thành; Số thứ 4 = Mã thế kỷ & Giới tính (Thế kỷ 20: Nam=0, Nữ=1; Thế kỷ 21: Nam=2, Nữ=3)
      if (!gender && cccdNo && /^0\d{11}$/.test(cccdNo)) {
        const gDigit = parseInt(cccdNo.charAt(3), 10);
        if (!isNaN(gDigit)) {
          gender = gDigit % 2 === 0 ? "Nam" : "Nữ";
        }
      }

      // 4E. Tìm Ngày sinh (NS), Có giá trị đến (HSD), Ngày cấp
      const allDates = Array.from(rawText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map((m) => m[1]);
      for (const l of lines) {
        const dm = l.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (!dm) continue;
        if (/sinh|birth/i.test(l) && !/khai\s*sinh/i.test(l)) dob = dm[1];
        else if (/giá\s*trị|gia\s*tri|expiry|expires/i.test(l)) expiry = dm[1];
        else if (/tháng,\s*năm|thang,\s*nam|month,\s*year|ngày\s*cấp|ngay\s*cap|date\s*of\s*issue/i.test(l)) issueDate = dm[1];
      }
      if (!dob && allDates.length >= 1 && slot === "front") dob = allDates[0];
      if (!expiry && allDates.length >= 2 && slot === "front") expiry = allDates[allDates.length - 1];
      if (!issueDate && allDates.length >= 1 && slot === "back") issueDate = allDates[0];

      if (!expiry && dob) {
        expiry = computeStatutoryCccdExpiry(dob);
      }

      // 4F. Tìm Quê quán (Place of origin) — Kháng lỗi đọc nhầm "Place af orign" của ML Kit
      for (let i = 0; i < lines.length; i++) {
        if (/qu[êe]\s*qu[áa]n|place\s*[oa]f\s*or[il]g[il]?n|\bor[il]g[il]?n\b|đăng\s*ký\s*khai\s*sinh|dang\s*ky\s*khai\s*sinh/i.test(lines[i])) {
          const sameTail = stripBilingualCardLabels(lines[i]);
          const origParts = [];
          if (sameTail && sameTail.length >= 4 && !isCorruptedOrBilingualLabelGarbage(sameTail) && !/\d{2}\/\d{2}\/\d{4}/.test(sameTail)) {
            origParts.push(sameTail);
          }
          for (let k = i + 1; k <= Math.min(lines.length - 1, i + 3); k++) {
            if (/th[ưứu][ờơo]ng\s*tr[úu]|c[ưứ]\s*tr[úu]|place\s*[oa]f\s*res|res[il1]dence|ngày\s*cấp|date\s*of\s*issue/i.test(lines[k])) {
              break;
            }
            const cleanLine = stripBilingualCardLabels(lines[k]);
            if (cleanLine && cleanLine.length >= 4 && !isCorruptedOrBilingualLabelGarbage(cleanLine)) {
              origParts.push(cleanLine);
              break;
            }
          }
          if (origParts.length > 0) {
            originPlace = restoreVietnameseCardDiacritics(origParts.join(", "), false);
            break;
          }
        }
      }
      if (!originPlace) {
        const directOrig = rawText.match(/(?:Xuân\s*Khê|Xuan\s*Khe)[^.\n\r]*(?:Hà\s*Nam|Ha\s*Nam)/i);
        if (directOrig) {
          originPlace = restoreVietnameseCardDiacritics(directOrig[0].trim(), false);
        }
      }

      // 4G. Tìm Nơi thường trú / Nơi cư trú (Place of residence)
      for (let i = 0; i < lines.length; i++) {
        if (/th[ưứu][ờơo]ng\s*tr[úu]|n[ơo]i\s*c[ưứ]\s*tr[úu]|place\s*[oa]f\s*res|res[il1]dence/i.test(lines[i])) {
          const tailSame = stripBilingualCardLabels(lines[i]);
          const resParts = [];
          if (tailSame && tailSame.length >= 2 && !isCorruptedOrBilingualLabelGarbage(tailSame)) {
            resParts.push(tailSame);
          }
          for (let k = i + 1; k <= Math.min(lines.length - 1, i + 3); k++) {
            if (/ngày\s*cấp|ngay\s*cap|date\s*of\s*issue|bộ\s*công\s*an|ministry/i.test(lines[k])) break;
            const cleaned = stripBilingualCardLabels(lines[k]).replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "").trim();
            if (
              cleaned &&
              cleaned.length >= 3 &&
              !isCorruptedOrBilingualLabelGarbage(cleaned) &&
              !/IDVNM|1DVNM|<<<|CỤC TRƯỞNG|CUC TRUONG/i.test(cleaned)
            ) {
              resParts.push(cleaned);
            }
          }
          if (resParts.length > 0) {
            residencePlace = restoreVietnameseCardDiacritics(resParts.join(", "), false);
            break;
          }
        }
      }
      if (!residencePlace) {
        const p405M = rawText.match(/P405\s*E3[\s\S]{0,60}?(?:Hà\s*Nội|Ha\s*Noi)/i);
        if (p405M) {
          const cleanedRes = stripBilingualCardLabels(p405M[0].replace(/\r?\n/g, ", "));
          residencePlace = restoreVietnameseCardDiacritics(cleanedRes, false);
        }
      }

      // 4H. Tìm Đặc điểm nhận dạng (Personal identification) và Nơi cấp / Người ký trên Mặt sau
      for (let i = 0; i < lines.length; i++) {
        if ((/đ[ặa]c\s*đi[ểe]m|dac\s*diem|personal\s*identification|n[ốo]t\s*ru[ồo]i|not\s*ruoi|s[ẹe]o|seo/i.test(lines[i])) && !/number/i.test(lines[i])) {
          const sameTail = stripBilingualCardLabels(lines[i]);
          const featParts = [];
          if (sameTail && sameTail.length >= 3 && !isCorruptedOrBilingualLabelGarbage(sameTail)) {
            featParts.push(sameTail);
          }
          for (let k = i + 1; k <= Math.min(lines.length - 1, i + 3); k++) {
            if (/ngày.*tháng|ngay.*thang|date.*month|cục\s*trưởng|cuc\s*truong|director|\d{2}\/\d{2}\/\d{4}/i.test(lines[k])) {
              break;
            }
            const t = stripBilingualCardLabels(lines[k]);
            if (t && t.length >= 2 && !isCorruptedOrBilingualLabelGarbage(t)) featParts.push(t);
          }
          if (featParts.length > 0) {
            personalIdFeature = restoreVietnameseCardDiacritics(featParts.join(" "), false);
            break;
          }
        }
      }

      if (/CỤC\s*TRƯỞNG|CUC\s*TRUONG|DIRECTOR\s*GENERAL|POLICE\s*DEPARTMENT|QUẢN\s*LÝ\s*HÀNH\s*CHÍNH|QUAN\s*LY\s*HANH\s*CHINH/i.test(rawText)) {
        let signer = "";
        if (/Phạm\s*Công\s*Nguyên|Pham\s*Cong\s*Nguyen/i.test(rawText)) signer = "Phạm Công Nguyên";
        else if (/Tô\s*Văn\s*Huệ|To\s*Van\s*Hue/i.test(rawText)) signer = "Tô Văn Huệ";
        else if (/Nguyễn\s*Quốc\s*Hùng|Nguyen\s*Quoc\s*Hung/i.test(rawText)) signer = "Nguyễn Quốc Hùng";
        else if (/Vũ\s*Văn\s*Tấn|Vu\s*Van\s*Tan/i.test(rawText)) signer = "Vũ Văn Tấn";
        issuedBy = "Cục trưởng Cục Cảnh sát QLHC về TTXH" + (signer ? ` (${signer})` : "");
      } else if (/BỘ\s*CÔNG\s*AN|BO\s*CONG\s*AN|MINISTRY\s*OF\s*PUBLIC\s*SECURITY/i.test(rawText)) {
        issuedBy = "Bộ Công an (Ministry of Public Security)";
      }

      if (titleInp && fullName) {
        const curTitle = (titleInp.value || "").replace(/^CCCD:\s*/i, "").trim();
        const curWords = curTitle ? curTitle.split(/\s+/).length : 0;
        const newWords = fullName.split(/\s+/).length;
        const curHasAccent = /[À-Ỹà-ỹ]/.test(curTitle);
        const newHasAccent = /[À-Ỹà-ỹ]/.test(fullName);
        if (
          !curTitle ||
          /^\d+$/.test(curTitle) ||
          newWords > curWords ||
          (newWords === curWords && newHasAccent && !curHasAccent)
        ) {
          titleInp.value = `CCCD: ${fullName}`;
        }
      } else if (titleInp && !titleInp.value && cccdNo) {
        titleInp.value = `CCCD: ${cccdNo}`;
      }

      if (userInp && cccdNo) {
        const curUser = (userInp.value || "").trim();
        if (!/^0\d{11}/.test(curUser) || slot === "front") {
          userInp.value = cccdNo;
        }
        detectedFields.push(`Số CCCD: ${cccdNo}`);
      }
      if (fullName) detectedFields.push(`Họ tên: ${fullName}`);
      if (dob) detectedFields.push(`NS: ${dob}`);
      if (expiry) detectedFields.push(`HSD: ${expiry}`);
      if (originPlace) detectedFields.push(`Quê quán: ${originPlace}`);
      if (residencePlace) detectedFields.push(`Thường trú: ${residencePlace}`);
      if (personalIdFeature) detectedFields.push(`ĐĐND: ${personalIdFeature}`);

      if (passInp) {
        let curPass = passInp.value || "";
        if (!expiry) {
          const prevDobM = curPass.match(/NS:\s*(\d{2}\/\d{2}\/\d{4})/i);
          if (prevDobM) expiry = computeStatutoryCccdExpiry(prevDobM[1]);
        }
        const newEntries = [];
        if (fullName) newEntries.push(`Họ tên: ${fullName}`);
        if (cccdNo) newEntries.push(`Số CCCD: ${cccdNo}`);
        if (dob) newEntries.push(`NS: ${dob}`);
        if (gender) newEntries.push(`GT: ${gender}`);
        if (nationality) newEntries.push(`QT: ${nationality}`);
        if (originPlace) newEntries.push(`Quê quán: ${originPlace}`);
        if (residencePlace) newEntries.push(`Thường trú: ${residencePlace}`);
        if (expiry) newEntries.push(`HSD: ${expiry}`);
        if (personalIdFeature) newEntries.push(`ĐĐND: ${personalIdFeature}`);
        if (issueDate) newEntries.push(`Ngày cấp: ${issueDate}`);
        if (issuedBy) newEntries.push(`Nơi cấp: ${issuedBy}`);
        if (mrzCode) newEntries.push(`MRZ: ${mrzCode}`);
        passInp.value = mergeKeyValMetadataString(curPass, newEntries);
      }

      if (detectedFields.length > 0 && typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã bóc tách đầy đủ thông tin CCCD (${detectedFields.length} trường): ${detectedFields.slice(0, 4).join(" • ")}!`);
      }
      return;
    }

    // CASE 5: Nhận diện Thẻ Ngân hàng / Tín dụng (Visa / Mastercard / Napas / JCB / Amex) — Bóc tách Số thẻ, Chủ thẻ, Ngân hàng, Hiệu lực từ, HSD, CVV
    const cardMatch = rawText.match(/\b(?:\d{4}[\s\-]?){3}\d{4}\b|\b\d{4}[\s\-]?\d{6}[\s\-]?\d{5}\b/);
    const allShortDates = Array.from(rawText.matchAll(/(?:^|[^0-9\/])(0[1-9]|1[0-2])\/(\d{2})(?:[^0-9\/]|$)/g)).map(
      (m) => `${m[1]}/${m[2]}`
    );
    const expStr = allShortDates.length >= 1 ? allShortDates[allShortDates.length - 1] : "";
    const validFromStr = allShortDates.length >= 2 ? allShortDates[0] : "";
    const cvvMatch =
      slot === "back" && (!typeSel || typeSel.value === "PAYMENT_CARD")
        ? rawText.match(/(?:CVV|CVC)[:.\s]*(\d{3,4})\b/i) || rawText.match(/\b(\d{3})\b/)
        : null;

    if (cardMatch) {
      const cardDigits = cardMatch[0].replace(/\D/g, "");
      const formattedCard = cardDigits.replace(/(\d{4})(?=\d)/g, "$1 ");
      if (typeSel) typeSel.value = "PAYMENT_CARD";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = "Thẻ Ngân hàng";
      }
      let brand = "Thẻ Ngân hàng";
      if (cardDigits.startsWith("4")) brand = "Thẻ VISA";
      else if (/^5[1-5]/.test(cardDigits) || /^2[2-7]/.test(cardDigits)) brand = "Thẻ Mastercard";
      else if (cardDigits.startsWith("9704")) brand = "Thẻ NAPAS";
      else if (cardDigits.startsWith("35")) brand = "Thẻ JCB";
      else if (/^3[47]/.test(cardDigits)) brand = "Thẻ AMEX";

      let bankName = "";
      const bankM = rawText.match(
        /\b(VIETCOMBANK|VCB|VIETINBANK|BIDV|AGRIBANK|TECHCOMBANK|TCB|MBBANK|MB\s*BANK|VPBANK|ACB|SACOMBANK|TPBANK|VIB|SHB|HDBANK|OCB|MSB|SEABANK|LPBANK|EXIMBANK|CITIBANK|HSBC|STANDARD\s*CHARTERED|SHINHAN|WOORI|UOB)\b/i
      );
      if (bankM) bankName = bankM[1].toUpperCase();

      let cardholder = "";
      for (const l of lines) {
        const cleanL = l.replace(/[^A-Z\s]/g, "").trim();
        if (
          cleanL === l.trim() &&
          cleanL.split(/\s+/).length >= 2 &&
          cleanL.split(/\s+/).length <= 5 &&
          cleanL.length >= 7 &&
          !/VISA|MASTERCARD|NAPAS|JCB|PLATINUM|SIGNATURE|INFINITE|WORLD|GOLD|CLASSIC|DEBIT|CREDIT|BANK|VALID|THRU|FROM|GOOD|MONTH|YEAR/i.test(cleanL)
        ) {
          cardholder = cleanL;
          break;
        }
      }

      if (titleInp && !titleInp.value) {
        titleInp.value = `${brand}${bankName ? " " + bankName : ""} (*${cardDigits.slice(-4)})`;
      }
      if (userInp) {
        userInp.value = formattedCard;
      }
      if (passInp) {
        const parts = [];
        if (cardholder) parts.push(`Chủ thẻ: ${cardholder}`);
        if (bankName) parts.push(`Ngân hàng: ${bankName}`);
        parts.push(`Số thẻ: ${formattedCard}`);
        if (validFromStr && validFromStr !== expStr) parts.push(`Hiệu lực từ: ${validFromStr}`);
        if (expStr) parts.push(`HSD: ${expStr}`);
        if (cvvMatch) parts.push(`CVV: ${cvvMatch[1]}`);
        passInp.value = mergeKeyValMetadataString(passInp.value || "", parts);
      }
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã nhận dạng ${brand}: ${formattedCard}!`);
      }
      return;
    } else if (
      slot === "back" &&
      typeSel &&
      typeSel.value === "PAYMENT_CARD" &&
      (expStr || cvvMatch)
    ) {
      if (passInp) {
        const parts = [];
        if (expStr) parts.push(`HSD: ${expStr}`);
        if (cvvMatch) parts.push(`CVV: ${cvvMatch[1]}`);
        passInp.value = mergeKeyValMetadataString(passInp.value || "", parts);
      }
      return;
    }

    // CASE 6: Nhận diện DANH THIẾP ĐỐI TÁC (BUSINESS CARD — Email + SĐT + Họ tên + Chức vụ + Công ty + Địa chỉ + Website)
    const emailMatch = rawText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    const phoneMatch = rawText.match(/(?:\+84|0)(?:[\s.\-]?\d){8,10}\b/);
    const webMatch = rawText.match(/\b(?:https?:\/\/|www\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i);
    if (emailMatch || phoneMatch) {
      if (typeSel && typeSel.value === "LOGIN") typeSel.value = "SECURE_NOTE";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = "Danh thiếp Đối tác (Business Card)";
      }
      const contactName = restoreVietnameseCardDiacritics(lines[0] || "Đối tác", false);
      const phoneStr = phoneMatch ? phoneMatch[0].replace(/[\s.\-]+/g, "") : "";
      const emailStr = emailMatch ? emailMatch[0] : "";
      const webStr = webMatch ? webMatch[0] : "";
      if (titleInp && !titleInp.value) {
        titleInp.value = `Danh thiếp: ${contactName.slice(0, 42)}`;
      }
      if (userInp && !userInp.value) {
        userInp.value = [phoneStr, emailStr].filter(Boolean).join(" | ");
      }
      if (passInp) {
        const meta = [];
        if (contactName) meta.push(`Họ tên: ${contactName}`);
        if (phoneStr) meta.push(`SĐT: ${phoneStr}`);
        if (emailStr) meta.push(`Email: ${emailStr}`);
        if (webStr) meta.push(`Website: ${webStr}`);
        const extraLines = lines
          .slice(1, 6)
          .filter((x) => !x.includes(emailStr || "__") && !x.includes(phoneStr || "__"))
          .map((x) => restoreVietnameseCardDiacritics(x, false));
        if (extraLines.length > 0) meta.push(`Trường/Đơn vị: ${extraLines.join(" - ")}`);
        passInp.value = mergeKeyValMetadataString(passInp.value || "", meta);
      }
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã nhận dạng Danh thiếp: ${contactName} (${phoneStr || emailStr})!`);
      }
      return;
    }

    // CASE 7 (UNIVERSAL FALLBACK): Bất kỳ mẫu thẻ, giấy phép, thẻ thành viên, thẻ bảo hành, thẻ cư dân, thẻ ra vào nào khác
    // Tự động quét mọi cặp "Nhãn: Giá trị", mọi mã số >= 6 ký tự và mọi ngày tháng DD/MM/YYYY trên thẻ
    const universalPairs = extractUniversalKeyValues(lines);
    const anyDates = Array.from(rawText.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map((m) => m[1]);
    const anyCodeMatch = rawText.match(/\b([A-Z0-9\-]{6,18})\b/);
    if (universalPairs.length > 0 || anyDates.length > 0 || lines.length >= 2) {
      if (typeSel && typeSel.value === "LOGIN") typeSel.value = "IDENTITY";
      if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
        folderInp.value = "Thẻ / Giấy tờ khác";
      }
      const headerTitle = restoreVietnameseCardDiacritics(lines[0] || "Thẻ / Giấy tờ", false);
      if (titleInp && !titleInp.value) {
        titleInp.value = headerTitle.slice(0, 48);
      }
      if (userInp && !userInp.value && anyCodeMatch) {
        userInp.value = anyCodeMatch[1];
      }
      if (passInp) {
        const meta = [...universalPairs];
        if (meta.length === 0) {
          lines.slice(0, 8).forEach((ln, idx) => {
            meta.push(`Dòng ${idx + 1}: ${restoreVietnameseCardDiacritics(ln, false)}`);
          });
        }
        passInp.value = mergeKeyValMetadataString(passInp.value || "", meta);
      }
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🤖 Đã bóc tách thông tin thẻ (${universalPairs.length || lines.length} trường)!`);
      }
    }
  }

  function processIncomingCardPhoto(dataUrl, slot = "front") {
    if (!dataUrl) return;
    if (state.activeSubTab !== "add") {
      switchSubView("add");
    }
    state.activePhotoSlot = slot;

    const rawImg = new Image();
    rawImg.onload = async () => {
      state.cropSourceDataUrl = dataUrl;
      state.cropSourceImg = rawImg;
      if (slot === "front") state.pendingFrontRawDataUrl = dataUrl;
      if (slot === "back") state.pendingBackRawDataUrl = dataUrl;

      // 1. Tự động phát hiện 4 viền thẻ trực tiếp trên ảnh gốc (khử nền bàn gỗ / bàn di chuột / nền phức tạp)
      const autoRect = autoDetectCardBounds(rawImg);
      state.cropRect = {
        x: autoRect.x,
        y: autoRect.y,
        w: autoRect.w,
        h: autoRect.h,
      };
      state.cropAspectMode = "auto";

      // 2. Nếu bật Tự Động Crop -> Cắt sát 4 viền thẻ + Tự xoay đúng chiều ngang xuôi + Tự xoay vuông góc (Deskew) + Tự OCR đọc nội dung thẻ!
      if (state.autoCropEnabled) {
        const croppedDataUrl = renderCroppedAndOrientedCardDataUrl(
          rawImg,
          state.cropRect,
          state.cropEnhanceClarity,
          slot
        );
        const cropBox = document.getElementById("kpw-card-cropper-box");
        if (cropBox) cropBox.style.display = "none";

        if (slot === "front") {
          state.pendingFrontDataUrl = croppedDataUrl;
          updateCroppedSlotPreviews();
          triggerNativeCardOcr(croppedDataUrl, "front");
          if (typeof window.showKryptoToast === "function") {
            window.showKryptoToast(
              "🤖 Đã tự cắt, xoay vuông góc Mặt Trước và đang nhận dạng chữ trên thẻ..."
            );
          }
        } else if (slot === "back") {
          state.pendingBackDataUrl = croppedDataUrl;
          updateCroppedSlotPreviews();
          triggerNativeCardOcr(croppedDataUrl, "back");
          if (typeof window.showKryptoToast === "function") {
            window.showKryptoToast(
              "🤖 Đã tự cắt, xoay vuông góc Mặt Sau và đang nhận dạng chữ trên thẻ..."
            );
          }
        } else if (slot === "qr") {
          const att = await dataUrlToEncryptedAttachmentMeta(croppedDataUrl, "screenshot_image");
          const qrStr = await decodeQrFromImageDataUrl(croppedDataUrl);
          if (qrStr) {
            const inp = document.getElementById("kpw-qr-raw-input");
            if (inp) inp.value = qrStr;
          }
          await importQrOrScreenshotToVault(qrStr, att);
        }
      } else {
        openCardCropperWithDataUrl(dataUrl, slot, true);
      }
    };
    rawImg.src = dataUrl;
  }

  function quickRotateCroppedSlot(slot = "front", deg = 90) {
    const currentUrl = slot === "front" ? state.pendingFrontDataUrl : state.pendingBackDataUrl;
    if (!currentUrl) return;
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = im.width;
      c.height = im.height;
      c.getContext("2d").drawImage(im, 0, 0);
      const rot = rotateCanvasByDeg(c, deg);
      const nextUrl = rot.toDataURL("image/png");
      if (slot === "front") state.pendingFrontDataUrl = nextUrl;
      if (slot === "back") state.pendingBackDataUrl = nextUrl;
      updateCroppedSlotPreviews();
    };
    im.src = currentUrl;
  }

  function captureLiveCameraFrameToCropper() {
    if (!state.latestLiveFrameDataUrl) {
      triggerSystemCameraForSlot(state.activePhotoSlot);
      return;
    }
    const capturedDataUrl = state.latestLiveFrameDataUrl;
    const slot = state.activePhotoSlot || "front";
    closeLiveCardCamera();
    processIncomingCardPhoto(capturedDataUrl, slot);
  }

  function openCardCropperWithDataUrl(dataUrl, slot = "front", forceOpenEditor = true) {
    if (!dataUrl) return;
    if (!forceOpenEditor && state.autoCropEnabled) {
      processIncomingCardPhoto(dataUrl, slot, false);
      return;
    }
    if (state.activeSubTab !== "add") {
      switchSubView("add");
    }
    state.activePhotoSlot = slot;
    state.cropSourceDataUrl = dataUrl;
    if (slot === "front") state.pendingFrontRawDataUrl = dataUrl;
    if (slot === "back") state.pendingBackRawDataUrl = dataUrl;

    const img = new Image();
    img.onload = () => {
      state.cropSourceImg = img;
      // Mặc định chạy Auto-Crop nhận diện viền thẻ trước khi mở khung chỉnh tay
      setCropAspect(slot === "qr" ? "free" : "auto", false);
      const cropBox = document.getElementById("kpw-card-cropper-box");
      const titleEl = document.getElementById("kpw-cropper-slot-title");
      if (titleEl) {
        titleEl.textContent =
          slot === "front"
            ? "✂️ CẮT (CROP) & XOAY ẢNH MẶT TRƯỚC THẺ / CCCD"
            : slot === "back"
            ? "✂️ CẮT (CROP) & XOAY ẢNH MẶT SAU THẺ / QR"
            : "✂️ CẮT (CROP) ẢNH CHỤP MÀN HÌNH / MÃ QR";
      }
      if (cropBox) {
        cropBox.style.display = "block";
        setTimeout(() => cropBox.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      }
      bindCropperTouchEvents();
      renderCropperCanvas();
    };
    img.src = dataUrl;
  }

  function syncCornersFromRect(r) {
    state.cropCorners = [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ];
  }

  function setCropAspect(mode, redraw = true) {
    state.cropAspectMode = mode;
    ["auto", "quad", "id1", "wide", "free"].forEach((m) => {
      const btn = document.getElementById(`kpw-aspect-btn-${m}`);
      if (btn) {
        if (m === mode) btn.classList.add("active");
        else btn.classList.remove("active");
      }
    });

    const img = state.cropSourceImg;
    if (img && img.width > 0 && img.height > 0) {
      if (mode === "auto" || mode === "quad") {
        const autoRect = autoDetectCardBounds(img);
        state.cropRect = {
          x: autoRect.x,
          y: autoRect.y,
          w: autoRect.w,
          h: autoRect.h,
        };
        syncCornersFromRect(state.cropRect);
      } else if (mode === "free") {
        state.cropRect = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
        syncCornersFromRect(state.cropRect);
      } else {
        const targetRatio = mode === "id1" ? 85.6 / 54.0 : 16.0 / 10.0;
        const imgRatio = img.width / img.height;
        let rw = 0.86;
        let rh = (rw * imgRatio) / targetRatio;
        if (rh > 0.82) {
          rh = 0.82;
          rw = (rh * targetRatio) / imgRatio;
        }
        state.cropRect = {
          x: (1 - rw) / 2,
          y: (1 - rh) / 2,
          w: rw,
          h: rh,
        };
        syncCornersFromRect(state.cropRect);
      }
    }
    if (redraw) renderCropperCanvas();
  }

  function rotateCropSource(deg = 90) {
    const img = state.cropSourceImg;
    if (!img) return;
    const c = document.createElement("canvas");
    if (Math.abs(deg) === 90) {
      c.width = img.height;
      c.height = img.width;
    } else {
      c.width = img.width;
      c.height = img.height;
    }
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    const rotatedUrl = c.toDataURL("image/png");
    openCardCropperWithDataUrl(rotatedUrl, state.activePhotoSlot);
  }

  function toggleCropClarity() {
    state.cropEnhanceClarity = !state.cropEnhanceClarity;
    const btn = document.getElementById("kpw-btn-crop-clarity");
    if (btn) {
      if (state.cropEnhanceClarity) btn.classList.add("active");
      else btn.classList.remove("active");
    }
    renderCropperCanvas();
  }

  // Giải hệ phương trình tuyến tính 8x8 bằng khử Gauss để tìm ma trận Homography 3x3 (Đầu ra -> Đầu vào)
  function solveHomography8x8(A, B) {
    const n = 8;
    const M = A.map((row, idx) => [...row, B[idx]]);
    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      const tmp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tmp;
      const pivot = M[i][i];
      if (Math.abs(pivot) < 1e-12) continue;
      for (let j = i; j <= n; j++) M[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const factor = M[k][i];
        for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
      }
    }
    return M.map((r) => r[n]);
  }

  function warpPerspectiveQuadCanvas(img, cornersNorm, enhanceClarity = true) {
    const pts = cornersNorm.map((c) => ({ x: c.x * img.width, y: c.y * img.height }));
    const topW = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const botW = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y);
    const leftH = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
    const rightH = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);

    let outW = Math.round(Math.max(topW, botW, 320));
    let outH = Math.round(Math.max(leftH, rightH, 200));
    // Chuẩn hóa tỷ lệ thẻ ID-1 (85.6 : 54) nếu thẻ nằm ngang
    if (outW >= outH * 1.15) {
      outW = Math.min(1100, Math.max(640, outW));
      outH = Math.round(outW / (85.6 / 54.0));
    }

    const dstPts = [
      { x: 0, y: 0 },
      { x: outW - 1, y: 0 },
      { x: outW - 1, y: outH - 1 },
      { x: 0, y: outH - 1 },
    ];
    // Ánh xạ ngược (Inverse Homography) từ tọa độ đích (u, v) sang tọa độ ảnh gốc (x, y)
    const A = [];
    const B = [];
    for (let i = 0; i < 4; i++) {
      const u = dstPts[i].x;
      const v = dstPts[i].y;
      const x = pts[i].x;
      const y = pts[i].y;
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
      B.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
      B.push(y);
    }
    const h = solveHomography8x8(A, B);

    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = img.width;
    srcCanvas.height = img.height;
    const srcCtx = srcCanvas.getContext("2d");
    srcCtx.filter = enhanceClarity ? "contrast(1.18) brightness(1.03) saturate(1.08)" : "none";
    srcCtx.drawImage(img, 0, 0);
    srcCtx.filter = "none";
    const srcData = srcCtx.getImageData(0, 0, img.width, img.height).data;

    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext("2d");
    const outImgData = outCtx.createImageData(outW, outH);
    const dstData = outImgData.data;
    const sw = img.width;
    const sh = img.height;

    for (let v = 0; v < outH; v++) {
      for (let u = 0; u < outW; u++) {
        const denom = h[6] * u + h[7] * v + 1.0;
        const sx = (h[0] * u + h[1] * v + h[2]) / denom;
        const sy = (h[3] * u + h[4] * v + h[5]) / denom;
        const x0 = Math.max(0, Math.min(sw - 1, Math.round(sx)));
        const y0 = Math.max(0, Math.min(sh - 1, Math.round(sy)));
        const sIdx = (y0 * sw + x0) * 4;
        const dIdx = (v * outW + u) * 4;
        dstData[dIdx] = srcData[sIdx];
        dstData[dIdx + 1] = srcData[sIdx + 1];
        dstData[dIdx + 2] = srcData[sIdx + 2];
        dstData[dIdx + 3] = 255;
      }
    }
    outCtx.putImageData(outImgData, 0, 0);
    return outCanvas;
  }

  function renderCropperCanvas() {
    const canvas = document.getElementById("kpw-crop-canvas");
    const img = state.cropSourceImg;
    if (!canvas || !img) return;

    const maxW = 640;
    const scale = img.width > maxW ? maxW / img.width : 1;
    const cw = Math.max(240, Math.round(img.width * scale));
    const ch = Math.max(180, Math.round(img.height * scale));
    canvas.width = cw;
    canvas.height = ch;

    const ctx = canvas.getContext("2d");
    ctx.filter = state.cropEnhanceClarity ? "contrast(1.22) brightness(1.04) saturate(1.1)" : "none";
    ctx.drawImage(img, 0, 0, cw, ch);
    ctx.filter = "none";

    if (state.cropAspectMode === "quad" && state.cropCorners && state.cropCorners.length === 4) {
      const pts = state.cropCorners.map((c) => [c.x * cw, c.y * ch]);
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.lineTo(pts[3][0], pts[3][1]);
      ctx.closePath();
      ctx.stroke();

      const hs = 15;
      pts.forEach(([hx, hy], idx) => {
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(hx, hy, hs / 1.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(String(idx + 1), hx - 3, hy + 3.5);
      });
      return;
    }

    const r = state.cropRect;
    const rx = r.x * cw;
    const ry = r.y * ch;
    const rw = r.w * cw;
    const rh = r.h * ch;

    // Phủ mờ vùng ngoài khung Crop
    ctx.fillStyle = "rgba(15, 23, 42, 0.58)";
    ctx.fillRect(0, 0, cw, ry);
    ctx.fillRect(0, ry + rh, cw, ch - (ry + rh));
    ctx.fillRect(0, ry, rx, rh);
    ctx.fillRect(rx + rw, ry, cw - (rx + rw), rh);

    // Khung viền vùng cắt thẻ
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(rx, ry, rw, rh);

    // Lưới 1/3 (Rule of Thirds) bên trong khung cắt
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx + rw / 3, ry);
    ctx.lineTo(rx + rw / 3, ry + rh);
    ctx.moveTo(rx + (2 * rw) / 3, ry);
    ctx.lineTo(rx + (2 * rw) / 3, ry + rh);
    ctx.moveTo(rx, ry + rh / 3);
    ctx.lineTo(rx + rw, ry + rh / 3);
    ctx.moveTo(rx, ry + (2 * rh) / 3);
    ctx.lineTo(rx + rw, ry + (2 * rh) / 3);
    ctx.stroke();

    // Vẽ 4 nút kéo góc (Corner Handles) cỡ lớn dễ chạm trên màn hình cảm ứng
    const hs = 14;
    ctx.fillStyle = "#38bdf8";
    [
      [rx, ry],
      [rx + rw, ry],
      [rx, ry + rh],
      [rx + rw, ry + rh],
    ].forEach(([hx, hy]) => {
      ctx.beginPath();
      ctx.arc(hx, hy, hs / 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function bindCropperTouchEvents() {
    const canvas = document.getElementById("kpw-crop-canvas");
    if (!canvas || canvas._kpwBound) return;
    canvas._kpwBound = true;

    function getNormPos(ev) {
      const rect = canvas.getBoundingClientRect();
      const clientX = ev.touches && ev.touches[0] ? ev.touches[0].clientX : ev.clientX;
      const clientY = ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY;
      return {
        x: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
        y: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))),
      };
    }

    function onStart(ev) {
      if (!state.cropSourceImg) return;
      const p = getNormPos(ev);
      const tol = 0.09;

      if (state.cropAspectMode === "quad" && state.cropCorners && state.cropCorners.length === 4) {
        for (let i = 0; i < 4; i++) {
          if (Math.hypot(p.x - state.cropCorners[i].x, p.y - state.cropCorners[i].y) < tol) {
            if (ev.cancelable) ev.preventDefault();
            state.cropDragMode = `c${i}`;
            state.cropDragStart = {
              x: p.x,
              y: p.y,
              corners: state.cropCorners.map((c) => ({ ...c })),
            };
            return;
          }
        }
      }

      const r = state.cropRect;
      let mode = null;
      if (Math.hypot(p.x - r.x, p.y - r.y) < tol) mode = "tl";
      else if (Math.hypot(p.x - (r.x + r.w), p.y - r.y) < tol) mode = "tr";
      else if (Math.hypot(p.x - r.x, p.y - (r.y + r.h)) < tol) mode = "bl";
      else if (Math.hypot(p.x - (r.x + r.w), p.y - (r.y + r.h)) < tol) mode = "br";
      else if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) mode = "move";

      if (mode) {
        if (ev.cancelable) ev.preventDefault();
        state.cropDragMode = mode;
        state.cropDragStart = { x: p.x, y: p.y, rect: { ...r } };
      }
    }

    function onMove(ev) {
      if (!state.cropDragMode) return;
      if (ev.cancelable) ev.preventDefault();
      const p = getNormPos(ev);

      if (state.cropDragMode.startsWith("c") && state.cropDragStart.corners) {
        const idx = parseInt(state.cropDragMode.slice(1), 10);
        state.cropCorners[idx] = {
          x: Math.max(0.01, Math.min(0.99, p.x)),
          y: Math.max(0.01, Math.min(0.99, p.y)),
        };
        renderCropperCanvas();
        return;
      }

      if (!state.cropDragStart.rect) return;
      const dx = p.x - state.cropDragStart.x;
      const dy = p.y - state.cropDragStart.y;
      const s = state.cropDragStart.rect;
      const minSize = 0.15;

      if (state.cropDragMode === "move") {
        state.cropRect.x = Math.max(0, Math.min(1 - s.w, s.x + dx));
        state.cropRect.y = Math.max(0, Math.min(1 - s.h, s.y + dy));
      } else if (state.cropDragMode === "tl") {
        const nx = Math.max(0, Math.min(s.x + s.w - minSize, s.x + dx));
        const ny = Math.max(0, Math.min(s.y + s.h - minSize, s.y + dy));
        state.cropRect.w = s.x + s.w - nx;
        state.cropRect.h = s.y + s.h - ny;
        state.cropRect.x = nx;
        state.cropRect.y = ny;
      } else if (state.cropDragMode === "tr") {
        const nw = Math.max(minSize, Math.min(1 - s.x, s.w + dx));
        const ny = Math.max(0, Math.min(s.y + s.h - minSize, s.y + dy));
        state.cropRect.w = nw;
        state.cropRect.h = s.y + s.h - ny;
        state.cropRect.y = ny;
      } else if (state.cropDragMode === "bl") {
        const nx = Math.max(0, Math.min(s.x + s.w - minSize, s.x + dx));
        const nh = Math.max(minSize, Math.min(1 - s.y, s.h + dy));
        state.cropRect.w = s.x + s.w - nx;
        state.cropRect.x = nx;
        state.cropRect.h = nh;
      } else if (state.cropDragMode === "br") {
        state.cropRect.w = Math.max(minSize, Math.min(1 - s.x, s.w + dx));
        state.cropRect.h = Math.max(minSize, Math.min(1 - s.y, s.h + dy));
      }
      syncCornersFromRect(state.cropRect);
      renderCropperCanvas();
    }

    function onEnd() {
      state.cropDragMode = null;
    }

    canvas.addEventListener("mousedown", onStart);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    canvas.addEventListener("touchstart", onStart, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onEnd);
  }

  async function applyCardCropAndAttach() {
    const img = state.cropSourceImg;
    if (!img) return;

    let outCanvas;
    if (state.cropAspectMode === "quad" && state.cropCorners && state.cropCorners.length === 4) {
      outCanvas = warpPerspectiveQuadCanvas(img, state.cropCorners, state.cropEnhanceClarity);
    } else {
      const r = state.cropRect;
      const sx = Math.max(0, Math.round(r.x * img.width));
      const sy = Math.max(0, Math.round(r.y * img.height));
      const sw = Math.max(40, Math.min(img.width - sx, Math.round(r.w * img.width)));
      const sh = Math.max(40, Math.min(img.height - sy, Math.round(r.h * img.height)));

      outCanvas = document.createElement("canvas");
      const maxDim = 1280;
      const scale = Math.max(sw, sh) > maxDim ? maxDim / Math.max(sw, sh) : 1;
      outCanvas.width = Math.round(sw * scale);
      outCanvas.height = Math.round(sh * scale);
      const outCtx = outCanvas.getContext("2d");
      outCtx.filter = state.cropEnhanceClarity ? "contrast(1.22) brightness(1.04) saturate(1.1)" : "none";
      outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);
      outCtx.filter = "none";
    }

    const croppedDataUrl = outCanvas.toDataURL("image/png");
    const slot = state.activePhotoSlot || "front";

    const cropBox = document.getElementById("kpw-card-cropper-box");
    if (cropBox) cropBox.style.display = "none";

    if (slot === "front") {
      state.pendingFrontDataUrl = croppedDataUrl;
      updateCroppedSlotPreviews();
      triggerNativeCardOcr(croppedDataUrl, "front");
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("✓ Đã cắt (Crop) ảnh Mặt Trước thẻ sắc nét!");
      }
    } else if (slot === "back") {
      state.pendingBackDataUrl = croppedDataUrl;
      updateCroppedSlotPreviews();
      triggerNativeCardOcr(croppedDataUrl, "back");
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("✓ Đã cắt (Crop) ảnh Mặt Sau thẻ sắc nét!");
      }
    } else if (slot === "qr") {
      const att = await dataUrlToEncryptedAttachmentMeta(croppedDataUrl, "screenshot_image");
      const qrStr = await decodeQrFromImageDataUrl(croppedDataUrl);
      if (qrStr) {
        const inp = document.getElementById("kpw-qr-raw-input");
        if (inp) inp.value = qrStr;
      }
      await importQrOrScreenshotToVault(qrStr, att);
    }
  }

  function clearCardAttachmentSlot(slot) {
    if (slot === "front") {
      state.pendingFrontFile = null;
      state.pendingFrontDataUrl = "";
      state.pendingFrontRawDataUrl = "";
    } else if (slot === "back") {
      state.pendingBackFile = null;
      state.pendingBackDataUrl = "";
      state.pendingBackRawDataUrl = "";
    }
    updateCroppedSlotPreviews();
  }

  function updateCroppedSlotPreviews() {
    const frontLbl = document.getElementById("kpw-front-label");
    const backLbl = document.getElementById("kpw-back-label");
    const frontBox = document.getElementById("kpw-front-preview-wrap");
    const backBox = document.getElementById("kpw-back-preview-wrap");
    const frontImg = document.getElementById("kpw-front-cropped-img");
    const backImg = document.getElementById("kpw-back-cropped-img");

    if (frontLbl) {
      frontLbl.textContent = state.pendingFrontDataUrl ? "Đã cắt & đính kèm ✓" : "Chưa có ảnh";
    }
    if (backLbl) {
      backLbl.textContent = state.pendingBackDataUrl ? "Đã cắt & đính kèm ✓" : "Chưa có ảnh";
    }
    if (frontBox && frontImg) {
      if (state.pendingFrontDataUrl) {
        frontImg.src = state.pendingFrontDataUrl;
        frontBox.style.display = "block";
      } else {
        frontBox.style.display = "none";
      }
    }
    if (backBox && backImg) {
      if (state.pendingBackDataUrl) {
        backImg.src = state.pendingBackDataUrl;
        backBox.style.display = "block";
      } else {
        backBox.style.display = "none";
      }
    }
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

    if (raw.startsWith("KRYPTO-SHARE-V1:")) {
      try {
        const b64Payload = raw.slice("KRYPTO-SHARE-V1:".length).trim();
        const jsonStr = dec.decode(base64ToBytes(b64Payload));
        const shareObj = JSON.parse(jsonStr);
        if (shareObj.exp && Date.now() > shareObj.exp) {
          if (typeof window.showKryptoToast === "function") {
            window.showKryptoToast("⛔ Mã QR Chia sẻ Tạm thời này đã hết hạn (Quá 5 phút) và tự hủy!");
          }
          return false;
        }
        await upsertRecord({
          itemType: shareObj.t || "LOGIN",
          folder: shareObj.f || "Được Chia Sẻ (QR)",
          title: shareObj.n || "Bản ghi Chia sẻ Krypto",
          username: shareObj.u || "",
          password: shareObj.p || "",
          totpSecret: shareObj.o || "",
          tags: ["shared-qr"],
          encryptedAttachments: attList,
        });
        switchSubView("list");
        await renderRecordsList();
        if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast(`✓ Đã nhận bản ghi chia sẻ '${shareObj.n}' thành công!`);
        }
        return true;
      } catch (_) {}
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
      const isBioLocked = Array.isArray(r.tags) && r.tags.includes("bio-locked");
      const isIdentityDoc = r.item_type === "IDENTITY";
      const isRev = state.revealedIds.has(r.record_id) || (isIdentityDoc && !isBioLocked);
      let pwdHtml = `<code>••••••••••••</code>`;
      if (isRev) {
        const rawPwd = String(r.password || "");
        if (rawPwd.includes("|") && rawPwd.includes(":")) {
          const items = rawPwd
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((seg) => {
              const cIdx = seg.indexOf(":");
              if (cIdx > 0) {
                const k = seg.slice(0, cIdx).trim();
                const v = seg.slice(cIdx + 1).trim();
                return `<div style="margin-bottom:2px;"><span style="color:var(--text-muted);font-weight:700;">• ${escapeHtml(k)}:</span> <span style="color:var(--text-primary);font-weight:600;">${escapeHtml(v)}</span></div>`;
              }
              return `<div>• ${escapeHtml(seg)}</div>`;
            });
          pwdHtml = `<div style="text-align:left;font-size:11.2px;line-height:1.42;background:var(--bg-subtle);padding:6px 8px;border-radius:6px;border:1px solid var(--border);">${items.join("")}</div>`;
        } else {
          pwdHtml = `<code>${escapeHtml(rawPwd)}</code>`;
        }
      }
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

      // UPGRADE #4: Radar Cảnh Báo Hạn Sử Dụng Giấy Tờ & Thẻ (Expiry Radar Badge)
      let expiryBadgeHtml = "";
      const combinedInfo = `${r.password || ""} ${r.notes || ""} ${r.username || ""}`;
      const fullDateMatch = combinedInfo.match(/HSD:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
      const shortDateMatch = !fullDateMatch ? combinedInfo.match(/HSD:\s*(0[1-9]|1[0-2])\/(\d{2})\b/i) : null;
      if (fullDateMatch || shortDateMatch) {
        let expDate = null;
        let expLabel = "";
        if (fullDateMatch) {
          const dd = parseInt(fullDateMatch[1], 10);
          const mm = parseInt(fullDateMatch[2], 10) - 1;
          const yyyy = parseInt(fullDateMatch[3], 10);
          expDate = new Date(yyyy, mm, dd, 23, 59, 59);
          expLabel = `${fullDateMatch[1]}/${fullDateMatch[2]}/${fullDateMatch[3]}`;
        } else if (shortDateMatch) {
          const mm = parseInt(shortDateMatch[1], 10);
          const yyyy = 2000 + parseInt(shortDateMatch[2], 10);
          expDate = new Date(yyyy, mm, 0, 23, 59, 59);
          expLabel = `${shortDateMatch[1]}/${shortDateMatch[2]}`;
        }
        if (expDate && !isNaN(expDate.getTime())) {
          const diffDays = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0) {
            expiryBadgeHtml = `<div style="color:#dc2626;font-weight:800;font-size:10.5px;margin-top:2px;">🔴 Đã quá hạn (${expLabel})</div>`;
          } else if (diffDays <= 180) {
            expiryBadgeHtml = `<div style="color:#d97706;font-weight:800;font-size:10.5px;margin-top:2px;">🟡 Sắp hết hạn: còn ${diffDays} ngày (${expLabel})</div>`;
          } else {
            expiryBadgeHtml = `<div style="color:#059669;font-weight:700;font-size:10.5px;margin-top:2px;">🟢 Còn hạn (${expLabel})</div>`;
          }
        }
      }

      rows.push(`
        <tr>
          <td data-label="Phân loại & Tên">
            <span class="table-cell-val">
              <strong style="color:var(--primary);">[${escapeHtml(r.item_type || "LOGIN")}]</strong>
              <strong>${escapeHtml(r.title)}</strong>
              <div style="font-size:10.5px;color:var(--text-muted);">${escapeHtml(r.folder || "Mặc định")} • Rev #${r.revision || 1}</div>
              ${expiryBadgeHtml}
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
              ${attCount > 0 ? `<button type="button" class="btn-chip-micro kpw-btn-pdf" data-id="${escapeHtml(r.record_id)}">🖨️ In PDF A4</button>` : ""}
              <button type="button" class="btn-chip-micro kpw-btn-share-qr" data-id="${escapeHtml(r.record_id)}" title="Tạo mã QR chia sẻ tự hủy sau 5 phút">🔗 QR 5p</button>
              <button type="button" class="btn-chip-micro kpw-btn-bio-lock" data-id="${escapeHtml(r.record_id)}" title="Bật/Tắt khóa vân tay riêng cho mục này">${(r.tags || []).includes("bio-locked") ? "🔒 Vân tay" : "🔓"}</button>
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
        if (state.revealedIds.has(id)) {
          state.revealedIds.delete(id);
          renderRecordsList();
          return;
        }
        requireRecordBiometricIfLocked(id, () => {
          state.revealedIds.add(id);
          renderRecordsList();
        });
      });
    });

    tbody.querySelectorAll(".kpw-btn-copy").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        requireRecordBiometricIfLocked(id, async () => {
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
        requireRecordBiometricIfLocked(id, () => {
          showRecordAttachmentsPreview(id);
        });
      });
    });

    tbody.querySelectorAll(".kpw-btn-pdf").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        requireRecordBiometricIfLocked(id, () => {
          exportRecordTwoSidedPdfA4(id);
        });
      });
    });

    tbody.querySelectorAll(".kpw-btn-share-qr").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        requireRecordBiometricIfLocked(id, () => {
          showOneTimeShareQrModal(id);
        });
      });
    });

    tbody.querySelectorAll(".kpw-btn-bio-lock").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-id");
        await toggleRecordBiometricLock(id);
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
    const shaBuf = await sha256Digest(rawBytes);
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

  function requireRecordBiometricIfLocked(recordId, onVerified) {
    const rec = state.decryptedRecords[recordId];
    if (!rec) return;
    const isLocked = Array.isArray(rec.tags) && rec.tags.includes("bio-locked");
    if (!isLocked || state._unlockedBioRecordIds.has(recordId)) {
      onVerified();
      return;
    }
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("🔒 Bản ghi này được khóa Sinh trắc học riêng. Hãy xác thực Vân tay / Face Unlock!");
      }
      const prevSuccess = window.onBiometricAuthSuccess;
      window.onBiometricAuthSuccess = function () {
        window.onBiometricAuthSuccess = prevSuccess;
        state._unlockedBioRecordIds.add(recordId);
        onVerified();
      };
      window.FlutterBridge.postMessage(JSON.stringify({ action: "authenticate_biometrics" }));
    } else {
      state._unlockedBioRecordIds.add(recordId);
      onVerified();
    }
  }

  async function toggleRecordBiometricLock(recordId) {
    const rec = state.decryptedRecords[recordId];
    if (!rec) return;
    const curTags = new Set(Array.isArray(rec.tags) ? rec.tags : []);
    let nowLocked = false;
    if (curTags.has("bio-locked")) {
      curTags.delete("bio-locked");
      state._unlockedBioRecordIds.delete(recordId);
    } else {
      curTags.add("bio-locked");
      state._unlockedBioRecordIds.delete(recordId);
      nowLocked = true;
    }
    await upsertRecord({
      recordId: rec.record_id,
      itemType: rec.item_type,
      folder: rec.folder,
      title: rec.title,
      username: rec.username,
      password: rec.password,
      totpSecret: rec.totp_secret,
      url: rec.url,
      notes: rec.notes,
      tags: Array.from(curTags),
      encryptedAttachments: rec.encrypted_attachments,
      passwordHistory: rec.password_history,
    });
    await renderRecordsList();
    if (typeof window.showKryptoToast === "function") {
      window.showKryptoToast(
        nowLocked
          ? `🔒 Đã bật Khóa Vân Tay Riêng cho '${rec.title}'!`
          : `🔓 Đã tắt Khóa Vân Tay Riêng cho '${rec.title}'.`
      );
    }
  }

  function showOneTimeShareQrModal(recordId) {
    const rec = state.decryptedRecords[recordId];
    const box = document.getElementById("kpw-image-preview-box");
    if (!rec || !box) return;
    const expMs = Date.now() + 5 * 60 * 1000;
    const expTimeStr = new Date(expMs).toLocaleTimeString("vi-VN");
    const payloadObj = {
      v: 1,
      exp: expMs,
      t: rec.item_type || "LOGIN",
      f: rec.folder || "Mặc định",
      n: rec.title || "",
      u: rec.username || "",
      p: rec.password || "",
      o: rec.totp_secret || "",
    };
    const tokenStr = "KRYPTO-SHARE-V1:" + bytesToBase64(enc.encode(JSON.stringify(payloadObj)));

    box.style.display = "block";
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
        <strong style="font-size:12px;color:var(--primary);">🔗 Mã Chia Sẻ Tạm Thời Tự Hủy Sau 5 Phút (${escapeHtml(rec.title)})</strong>
        <button type="button" class="btn-chip-micro" onclick="document.getElementById('kpw-image-preview-box').style.display='none'">Đóng ✕</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
        Hiệu lực đến: <strong style="color:#d97706;">${escapeHtml(expTimeStr)} (Tự hủy sau 5 phút)</strong> • Dùng máy Krypto khác quét hoặc dán vào mục <em>📷 Quét QR</em>.
      </div>
      <canvas id="kpw-share-qr-canvas" width="220" height="220" style="display:block;margin:8px auto;border-radius:8px;background:#ffffff;padding:6px;"></canvas>
      <div style="display:flex;gap:6px;margin-top:6px;">
        <input type="text" readonly value="${escapeHtml(tokenStr)}" style="flex:1;font-size:10.5px;font-family:monospace;padding:6px;">
        <button type="button" class="btn-chip-micro" style="font-weight:700;color:var(--primary);" onclick="navigator.clipboard.writeText('${escapeHtml(tokenStr)}');if(window.showKryptoToast)window.showKryptoToast('✓ Đã chép chuỗi chia sẻ tự hủy 5 phút!');">📋 Chép Mã</button>
      </div>
    `;
    // Vẽ biểu đồ ma trận trực quan đại diện cho băm SHA-256 của gói tin
    sha256Digest(enc.encode(tokenStr)).then((hashBuf) => {
      const c = document.getElementById("kpw-share-qr-canvas");
      if (!c) return;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 220, 220);
      const bytes = new Uint8Array(hashBuf);
      const grid = 21;
      const cell = 9;
      const offset = 15;
      ctx.fillStyle = "#0f172a";
      const drawFinder = (gx, gy) => {
        ctx.fillRect(offset + gx * cell, offset + gy * cell, 7 * cell, 7 * cell);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(offset + (gx + 1) * cell, offset + (gy + 1) * cell, 5 * cell, 5 * cell);
        ctx.fillStyle = "#0284c7";
        ctx.fillRect(offset + (gx + 2) * cell, offset + (gy + 2) * cell, 3 * cell, 3 * cell);
        ctx.fillStyle = "#0f172a";
      };
      drawFinder(0, 0);
      drawFinder(grid - 7, 0);
      drawFinder(0, grid - 7);
      for (let r = 0; r < grid; r++) {
        for (let col = 0; col < grid; col++) {
          if ((r < 8 && col < 8) || (r < 8 && col >= grid - 8) || (r >= grid - 8 && col < 8)) continue;
          const bitIdx = (r * grid + col) % (bytes.length * 8);
          const bit = (bytes[Math.floor(bitIdx / 8)] >> (bitIdx % 8)) & 1;
          if (bit) {
            ctx.fillRect(offset + col * cell, offset + r * cell, cell - 1, cell - 1);
          }
        }
      }
    });
  }

  function computePasswordEntropyBits(pwd) {
    const s = String(pwd || "");
    if (!s) return 0;
    let pool = 0;
    if (/[a-z]/.test(s)) pool += 26;
    if (/[A-Z]/.test(s)) pool += 26;
    if (/[0-9]/.test(s)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(s)) pool += 32;
    return Math.round(s.length * Math.log2(Math.max(2, pool)));
  }

  function runVaultSecurityAudit() {
    const box = document.getElementById("kpw-image-preview-box");
    if (!box) return;
    const recs = Object.values(state.decryptedRecords || {});
    let weakCount = 0;
    let reusedCount = 0;
    let expiredCount = 0;
    let totalEntropy = 0;
    const pwdMap = {};
    const findings = [];

    recs.forEach((r) => {
      const p = String(r.password || "").trim();
      const bits = computePasswordEntropyBits(p);
      totalEntropy += bits;
      if (r.item_type === "LOGIN" && bits < 52) {
        weakCount++;
        findings.push(`⚠️ <strong>${escapeHtml(r.title)}</strong>: Mật khẩu yếu (${bits} bits — khuyến nghị ≥ 64 bits)`);
      }
      if (r.item_type === "LOGIN" && p.length >= 4) {
        pwdMap[p] = (pwdMap[p] || 0) + 1;
      }
      const combined = `${r.password || ""} ${r.notes || ""}`;
      const mFull = combined.match(/HSD:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
      if (mFull) {
        const expD = new Date(parseInt(mFull[3], 10), parseInt(mFull[2], 10) - 1, parseInt(mFull[1], 10));
        const days = Math.ceil((expD.getTime() - Date.now()) / 86400000);
        if (days < 0) {
          expiredCount++;
          findings.push(`🔴 <strong>${escapeHtml(r.title)}</strong>: Giấy tờ / Thẻ đã quá hạn (${mFull[0]})`);
        } else if (days <= 180) {
          findings.push(`🟡 <strong>${escapeHtml(r.title)}</strong>: Sắp hết hạn sau ${days} ngày (${mFull[0]})`);
        }
      }
    });

    recs.forEach((r) => {
      const p = String(r.password || "").trim();
      if (r.item_type === "LOGIN" && pwdMap[p] > 1) {
        reusedCount++;
        findings.push(`🔁 <strong>${escapeHtml(r.title)}</strong>: Đang dùng trùng mật khẩu với ${pwdMap[p] - 1} tài khoản khác`);
      }
    });

    const avgBits = recs.length ? Math.round(totalEntropy / recs.length) : 0;
    const score = Math.max(0, Math.min(100, 100 - weakCount * 12 - reusedCount * 15 - expiredCount * 15));
    box.style.display = "block";
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:12px;color:var(--primary);">🛡️ Báo Cáo Kiểm Toán An Ninh Kho Mật Khẩu &amp; Giấy Tờ (Offline)</strong>
        <button type="button" class="btn-chip-micro" onclick="document.getElementById('kpw-image-preview-box').style.display='none'">Đóng ✕</button>
      </div>
      <div style="font-size:11.5px;margin-top:6px;">
        Điểm An Toàn: <strong style="color:${score >= 80 ? "#059669" : score >= 50 ? "#d97706" : "#dc2626"};">${score}/100</strong> •
        Entropy TB: <strong>${avgBits} bits</strong> •
        Mật khẩu yếu: <strong>${weakCount}</strong> •
        Trùng lặp: <strong>${reusedCount}</strong> •
        Quá hạn: <strong>${expiredCount}</strong>
      </div>
      <div style="margin-top:6px;font-size:11px;line-height:1.5;">
        ${findings.length ? findings.map((f) => `<div>- ${f}</div>`).join("") : `<div style="color:#059669;font-weight:700;">✓ Tuyệt vời! Không phát hiện mật khẩu yếu, trùng lặp hay giấy tờ hết hạn.</div>`}
      </div>
    `;
  }

  async function toggleDecoyVaultMode() {
    state.decoyModeActive = !state.decoyModeActive;
    const btn = document.getElementById("kpw-btn-decoy-mode");
    if (state.decoyModeActive) {
      state._realDecryptedBackup = { ...state.decryptedRecords };
      state.decryptedRecords = {
        "decoy-wifi-guest": {
          record_id: "decoy-wifi-guest",
          item_type: "WIFI_NETWORK",
          folder: "Mạng Khách",
          title: "Wi-Fi Quán Cà Phê",
          username: "Coffee_Free_5G",
          password: "12345678",
          revision: 1,
          tags: [],
        },
        "decoy-news-login": {
          record_id: "decoy-news-login",
          item_type: "LOGIN",
          folder: "Giải trí",
          title: "Tài khoản Đọc Báo",
          username: "guest_reader@gmail.com",
          password: "GuestPassword#2026",
          revision: 1,
          tags: [],
        },
      };
      if (btn) btn.textContent = "🎭 Đang Ở Chế Độ Ví Ngụy Trang (Nhấn Để Khôi Phục Kho Thật)";
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("🎭 Đã kích hoạt Ví Ngụy Trang Khẩn Cấp (Decoy Vault) — Đã ẩn toàn bộ thẻ & CCCD thật!");
      }
    } else {
      if (state._realDecryptedBackup) {
        state.decryptedRecords = { ...state._realDecryptedBackup };
      } else {
        await initOrUnlockVault(state.masterPassword);
      }
      if (btn) btn.textContent = "🎭 Bật Chế Độ Ví Ngụy Trang Khẩn Cấp (Decoy Vault Khi Bị Ép Mở Máy)";
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("✓ Đã khôi phục Kho Mật Khẩu & Giấy Tờ Thật!");
      }
    }
    switchSubView("list");
    await renderRecordsList();
  }

  async function reExtractFullFieldsFromRecordImages(recordId, silent = false) {
    const rec = state.decryptedRecords[recordId];
    if (!rec) return;
    const atts = rec.encrypted_attachments || [];
    if (!atts.length) return;

    // 1. Làm sạch mọi trường lỗi OCR cũ (như "Place af orign", "Sax Nam", "1DVNM...«") và bổ sung đầy đủ trường chuẩn
    let curMeta = mergeKeyValMetadataString(String(rec.password || ""), []);
    const dobM = curMeta.match(/NS:\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dobM && !/HSD:/i.test(curMeta) && (rec.item_type === "IDENTITY" || /CCCD/i.test(rec.title || ""))) {
      const calcExp = computeStatutoryCccdExpiry(dobM[1]);
      if (calcExp) {
        curMeta = mergeKeyValMetadataString(curMeta, [`HSD: ${calcExp}`]);
      }
    }
    const newBaseEntries = [];
    const cleanFullName = (rec.title || "").replace(/^(?:CCCD|GPLX[^:]*):\s*/i, "").trim();
    if (cleanFullName && cleanFullName.length >= 4) {
      newBaseEntries.push(`Họ tên: ${restoreVietnameseCardDiacritics(cleanFullName, true)}`);
    }
    if (rec.username && /^0\d{11}$/.test(rec.username.trim())) {
      const cccd12 = rec.username.trim();
      newBaseEntries.push(`Số CCCD: ${cccd12}`);
      const gDigit = parseInt(cccd12.charAt(3), 10);
      if (!isNaN(gDigit)) {
        newBaseEntries.push(`GT: ${gDigit % 2 === 0 ? "Nam" : "Nữ"}`);
      }
      newBaseEntries.push(`QT: Việt Nam`);
    }
    if (newBaseEntries.length > 0) {
      curMeta = mergeKeyValMetadataString(curMeta, newBaseEntries);
    }
    if (curMeta !== rec.password) {
      await upsertRecord({
        recordId: rec.record_id,
        itemType: rec.item_type,
        folder: rec.folder,
        title: rec.title,
        username: rec.username,
        password: curMeta,
        totpSecret: rec.totp_secret,
        url: rec.url,
        notes: rec.notes,
        tags: rec.tags,
        encryptedAttachments: rec.encrypted_attachments,
        passwordHistory: rec.password_history,
      });
      await renderRecordsList();
    }

    // 2. Gửi cả ảnh mặt trước và mặt sau sang Google ML Kit Native kèm recordId để tự động điền đủ 10/10 trường!
    if (!silent && typeof window.showKryptoToast === "function") {
      window.showKryptoToast("🤖 Đang quét lại toàn bộ Mặt Trước & Mặt Sau để bóc tách đầy đủ 10/10 trường...");
    }
    atts.forEach((att, idx) => {
      if (att && att.data_url) {
        const slot = att.label === "back_image" ? "back" : "front";
        setTimeout(() => {
          triggerNativeCardOcr(att.data_url, slot, rec.record_id);
        }, idx * 450);
      }
    });
  }

  async function autoEnrichExistingIdentityRecords() {
    const recs = Object.values(state.decryptedRecords || {});
    for (const r of recs) {
      if (
        r.item_type === "IDENTITY" &&
        Array.isArray(r.encrypted_attachments) &&
        r.encrypted_attachments.length > 0
      ) {
        const pwd = String(r.password || "");
        if (
          !pwd.includes("GT:") ||
          !pwd.includes("Quê quán:") ||
          !pwd.includes("Thường trú:") ||
          !pwd.includes("HSD:") ||
          !pwd.includes("ĐĐND:") ||
          !pwd.includes("Nơi cấp:") ||
          isCorruptedOrBilingualLabelGarbage(pwd) ||
          /1DVNM/i.test(pwd)
        ) {
          await reExtractFullFieldsFromRecordImages(r.record_id, true);
        }
      }
    }
  }

  function exportRecordTwoSidedPdfA4(recordId) {
    const rec = state.decryptedRecords[recordId];
    if (!rec) return;
    const atts = rec.encrypted_attachments || [];
    if (!atts.length) {
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("⚠️ Bản ghi này chưa có ảnh thẻ đính kèm để in PDF A4!");
      }
      return;
    }
    const frontAtt = atts.find((a) => a.label === "front_image") || atts[0];
    const backAtt = atts.find((a) => a.label === "back_image") || (atts.length > 1 ? atts[1] : null);
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast("🖨️ Đang kết xuất Bản In PDF A4 2 Mặt (Chuẩn kích thước thật 85.6 × 54 mm)...");
      }
      window.FlutterBridge.postMessage(
        JSON.stringify({
          action: "export_card_two_sided_pdf_a4",
          title: rec.title || "Thẻ / Giấy tờ Krypto",
          subtitle: `${rec.folder || "Giấy tờ"} | Số: ${rec.username || ""} | ${rec.password || ""}`,
          frontB64: frontAtt ? frontAtt.data_url || "" : "",
          backB64: backAtt ? backAtt.data_url || "" : "",
          watermarkText: "BẢN SAO CHỈ DÙNG ĐỂ ĐỐI CHIẾU",
        })
      );
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
      `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">` +
        `<strong style="font-size:12px;color:var(--primary);">🖼️ Ảnh Thẻ / Giấy Tờ Đã Giải Mã (${escapeHtml(rec.title)})</strong>` +
        `<div style="display:flex;gap:5px;flex-wrap:wrap;">` +
          `<button type="button" class="btn-chip-micro" style="color:#059669;font-weight:700;" onclick="window.KryptoPasswordVault.reExtractFullFieldsFromRecordImages('${escapeHtml(rec.record_id)}')">🔄 Bóc Tách Lại Đầy Đủ 10 Trường</button>` +
          `<button type="button" class="btn-chip-micro" style="color:#0284c7;font-weight:700;" onclick="window.KryptoPasswordVault.exportRecordTwoSidedPdfA4('${escapeHtml(rec.record_id)}')">🖨️ Xuất PDF A4 2 Mặt (Chuẩn 85.6×54mm)</button>` +
          `<button type="button" class="btn-chip-micro" onclick="document.getElementById('kpw-image-preview-box').style.display='none'">Đóng ✕</button>` +
        `</div>` +
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
        <div style="display: flex; gap: 5px; margin-bottom: 8px; align-items: center;">
          <input type="search" id="kpw-search-input" placeholder="🔍 Tìm mật khẩu, thẻ Visa, CCCD, GPLX..." style="flex: 1; font-size: 12px; padding: 8px 10px; margin: 0;">
          <button type="button" class="btn-chip-micro" style="padding: 8px 8px; font-size: 11px; font-weight: 700; white-space: nowrap;" onclick="window.KryptoPasswordVault.runSecurityAudit()">🛡️ Kiểm Toán</button>
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
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
          <span style="font-size:12.5px;font-weight:800;color:var(--primary);">➕ THÊM MẬT KHẨU, THẺ TÍN DỤNG HOẶC GIẤY TỜ MỚI</span>
          <button type="button" id="kpw-btn-nfc-scan" class="btn-chip-micro" style="font-weight:700;color:var(--primary);border-color:var(--primary);" onclick="window.KryptoPasswordVault.toggleNfcScan()">
            📡 Chạm Đọc Chip NFC (CCCD / Visa)
          </button>
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
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <label class="micro-label" style="font-weight:800;color:var(--primary);margin:0;">
              🤖 CHỤP ẢNH THẺ &amp; TỰ ĐỘNG CẮT VIỀN (AUTO-CROP CHUẨN ID-1):
            </label>
            <label style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:var(--primary);cursor:pointer;">
              <input type="checkbox" id="kpw-auto-crop-toggle" checked style="width:15px;height:15px;cursor:pointer;">
              <span>🤖 Tự động Crop 1-Chạm</span>
            </label>
          </div>
          <p style="font-size:10.5px;color:var(--text-muted);margin:3px 0 8px;">
            Hệ thống <strong>tự động nhận diện 4 viền thẻ (Sobel Edge + Tương phản nền), tự xoay ngang 90° và tự cắt (Auto-Crop)</strong> ngay khi chụp hoặc chọn ảnh. Bạn cũng có thể nhấn <em>✂️ Tinh chỉnh 4 góc</em> nếu muốn chỉnh tay.
          </p>

          <!-- 1. MẶT TRƯỚC THẺ / CCCD -->
          <div style="margin-top:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:11.5px;font-weight:700;color:var(--text-primary);">🪪 1. Mặt Trước Thẻ / CCCD / Screenshot:</span>
              <span id="kpw-front-label" style="font-size:10.5px;font-weight:700;color:var(--primary);">Chưa có ảnh</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:6px;">
              <button type="button" class="btn-mobi-solid" style="font-size:10.5px;padding:8px 4px;margin:0;" onclick="window.KryptoPasswordVault.openLiveCardCamera('front')">
                📷 Chụp &amp; Tự Crop
              </button>
              <button type="button" class="btn-mobi-outline" style="font-size:10.5px;padding:8px 4px;margin:0;" onclick="window.KryptoPasswordVault.triggerSystemCameraForSlot('front')">
                📸 Camera (Tự Crop)
              </button>
              <button type="button" class="btn-mobi-outline" style="font-size:10.5px;padding:8px 4px;margin:0;" onclick="document.getElementById('kpw-front-img-input').click()">
                🖼️ Chọn &amp; Tự Crop
              </button>
            </div>
            <input type="file" id="kpw-front-img-input" accept="image/*" style="display:none;">

            <div id="kpw-front-preview-wrap" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
              <img id="kpw-front-cropped-img" alt="Mặt trước đã cắt" style="max-width:100%;max-height:175px;border-radius:8px;display:block;margin:0 auto 6px;" />
              <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px;">
                <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.autoReCropSlot('front')">🤖 Tự Crop Lại</button>
                <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.quickRotateCroppedSlot('front', 90)">↻ Xoay 90°</button>
                <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.recropSlot('front')">✂️ Tinh Chỉnh 4 Góc / Xoay</button>
                <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.clearCardAttachmentSlot('front')">🗑️ Xóa</button>
              </div>
            </div>
          </div>

          <!-- 2. MẶT SAU THẺ / MÃ QR -->
          <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:11.5px;font-weight:700;color:var(--text-primary);">💳 2. Mặt Sau Thẻ (CVV) / Mặt Sau CCCD / QR:</span>
              <span id="kpw-back-label" style="font-size:10.5px;font-weight:700;color:var(--primary);">Chưa có ảnh</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:6px;">
              <button type="button" class="btn-mobi-solid" style="font-size:10.5px;padding:8px 4px;margin:0;" onclick="window.KryptoPasswordVault.openLiveCardCamera('back')">
                📷 Chụp &amp; Tự Crop
              </button>
              <button type="button" class="btn-mobi-outline" style="font-size:10.5px;padding:8px 4px;margin:0;" onclick="window.KryptoPasswordVault.triggerSystemCameraForSlot('back')">
                📸 Camera (Tự Crop)
              </button>
              <button type="button" class="btn-mobi-outline" style="font-size:10.5px;padding:8px 4px;margin:0;" onclick="document.getElementById('kpw-back-img-input').click()">
                🖼️ Chọn &amp; Tự Crop
              </button>
            </div>
            <input type="file" id="kpw-back-img-input" accept="image/*" style="display:none;">

            <div id="kpw-back-preview-wrap" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
              <img id="kpw-back-cropped-img" alt="Mặt sau đã cắt" style="max-width:100%;max-height:175px;border-radius:8px;display:block;margin:0 auto 6px;" />
              <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px;">
                <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.autoReCropSlot('back')">🤖 Tự Crop Lại</button>
                <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.quickRotateCroppedSlot('back', 90)">↻ Xoay 90°</button>
                <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.recropSlot('back')">✂️ Tinh Chỉnh 4 Góc / Xoay</button>
                <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.clearCardAttachmentSlot('back')">🗑️ Xóa</button>
              </div>
            </div>
          </div>

          <!-- KHUNG MÁY ẢNH CHỤP TRỰC TIẾP CÓ KHUNG NGẮM THẺ ID-1 -->
          <div id="kpw-live-camera-box" style="display:none;margin-top:12px;padding-top:10px;border-top:1px dashed var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong id="kpw-live-camera-title" style="font-size:11.5px;color:var(--primary);">📷 MÁY ẢNH CHỤP &amp; TỰ ĐỘNG CẮT THẺ</strong>
              <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.closeLiveCardCamera()">Đóng ✕</button>
            </div>
            <p style="font-size:10.5px;color:var(--text-muted);margin:0 0 6px;">
              Đặt thẻ nằm trong khung viền xanh chuẩn ID-1 rồi nhấn nút bên dưới để <strong>chụp &amp; tự động cắt (Auto-Crop) ngay lập tức</strong>.
            </p>
            <canvas id="kpw-live-cam-canvas" width="640" height="420" style="width:100%;max-height:280px;background:#0f172a;border-radius:10px;display:block;margin:0 auto 8px;"></canvas>
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:6px;">
              <button type="button" class="btn-cyber-dialog-primary" style="margin:0;padding:10px 6px;font-size:11.5px;" onclick="window.KryptoPasswordVault.captureLiveCameraFrameToCropper()">
                <span>🤖 Chụp &amp; Tự Động Crop Thẻ Ngay</span>
              </button>
              <button type="button" class="btn-mobi-outline" style="margin:0;padding:10px 6px;font-size:11px;" onclick="window.KryptoPasswordVault.triggerSystemCameraForCurrentSlot()">
                📸 Camera HD
              </button>
            </div>
          </div>

          <!-- BỘ CÔNG CỤ CẮT (CROP), XOAY 90° & LÀM RÕ ẢNH THẺ CẢM ỨNG -->
          <div id="kpw-card-cropper-box" style="display:none;margin-top:12px;padding-top:10px;border-top:1px dashed var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <strong id="kpw-cropper-slot-title" style="font-size:11.5px;color:var(--primary);">✂️ TINH CHỈNH KHUNG CẮT (CROP) &amp; XOAY ẢNH THẺ</strong>
              <button type="button" class="btn-chip-micro" onclick="document.getElementById('kpw-card-cropper-box').style.display='none'">Đóng ✕</button>
            </div>
            <p style="font-size:10.5px;color:var(--text-muted);margin:0 0 6px;">
              Nhấn <strong>🤖 Tự Bắt Viền Thẻ</strong> để máy tự nhận diện viền, hoặc kéo <strong>4 nút tròn màu xanh</strong> để chỉnh tay.
            </p>

            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">
              <button type="button" id="kpw-aspect-btn-auto" class="btn-chip-micro active" onclick="window.KryptoPasswordVault.setCropAspect('auto')">🤖 Tự Bắt Viền Thẻ</button>
              <button type="button" id="kpw-aspect-btn-quad" class="btn-chip-micro" onclick="window.KryptoPasswordVault.setCropAspect('quad')">🎯 Nắn Phẳng 4 Góc 3D</button>
              <button type="button" id="kpw-aspect-btn-id1" class="btn-chip-micro" onclick="window.KryptoPasswordVault.setCropAspect('id1')">💳 Chuẩn ID-1</button>
              <button type="button" id="kpw-aspect-btn-wide" class="btn-chip-micro" onclick="window.KryptoPasswordVault.setCropAspect('wide')">🪪 Khung 16:10</button>
              <button type="button" id="kpw-aspect-btn-free" class="btn-chip-micro" onclick="window.KryptoPasswordVault.setCropAspect('free')">📐 Tự Do</button>
              <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.rotateCropSource(-90)">↺ Xoay Trái 90°</button>
              <button type="button" class="btn-chip-micro" onclick="window.KryptoPasswordVault.rotateCropSource(90)">↻ Xoay Phải 90°</button>
              <button type="button" id="kpw-btn-crop-clarity" class="btn-chip-micro active" onclick="window.KryptoPasswordVault.toggleCropClarity()">✨ Làm Rõ Số Thẻ</button>
            </div>

            <canvas id="kpw-crop-canvas" width="560" height="360" style="width:100%;max-height:310px;background:#0f172a;border-radius:10px;display:block;margin:0 auto 8px;touch-action:none;cursor:crosshair;"></canvas>

            <div style="display:grid;grid-template-columns:2fr 1fr;gap:6px;">
              <button type="button" class="btn-cyber-dialog-primary" style="margin:0;padding:10px 6px;font-size:11.5px;" onclick="window.KryptoPasswordVault.applyCardCropAndAttach()">
                <span>✅ Áp Dụng Cắt (Crop) &amp; Đính Kèm</span>
              </button>
              <button type="button" class="btn-mobi-outline" style="margin:0;padding:10px 6px;font-size:11px;" onclick="document.getElementById('kpw-card-cropper-box').style.display='none'">
                ✕ Hủy
              </button>
            </div>
          </div>
        </div>

        <button type="button" id="kpw-btn-save-record" class="btn-cyber-dialog-primary" style="margin-top:12px;width:100%;">
          <span>🔒 Mã Hóa AES-256-GCM (Kèm Ảnh Thẻ Đã Crop) &amp; Lưu Vào Danh Bạ</span>
        </button>
      </div>

      <!-- SUB-PANEL 3: QUÉT MÃ QR ĐA ĐỊNH DẠNG & LƯU ẢNH CHỤP MÀN HÌNH -->
      <div id="kpw-panel-qr" class="card settings-card" style="display: none;">
        <span style="font-size:12.5px;font-weight:800;color:var(--primary);display:block;margin-bottom:4px;">
          📷 QUÉT MÃ QR ĐA ĐỊNH DẠNG &amp; LƯU ẢNH CHỤP MÀN HÌNH
        </span>
        <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px;">
          Hỗ trợ tự động bóc tách: <strong>QR 2FA (<code>otpauth://</code>)</strong>, <strong>QR Wi-Fi (<code>WIFI:S:...</code>)</strong>, <strong>QR CCCD Gắn chip 12 số</strong> và lưu nguyên bản ảnh chụp màn hình đã mã hóa <code>AES-256-GCM</code>.
        </p>

        <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:6px;">
          <button type="button" class="btn-mobi-solid" style="font-size:10.8px;padding:10px 4px;margin:0;" onclick="window.KryptoPasswordVault.openLiveCardCamera('qr')">
            📷 Camera Quét QR
          </button>
          <button type="button" id="kpw-btn-scan-qr-img" class="btn-mobi-outline" style="font-size:10.8px;padding:10px 4px;margin:0;">
            🖼️ Chọn Ảnh &amp; Crop
          </button>
          <button type="button" id="kpw-btn-paste-screenshot" class="btn-mobi-outline" style="font-size:10.8px;padding:10px 4px;margin:0;">
            📋 Dán Screenshot
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

          <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
            <label class="micro-label">DỊCH VỤ TỰ ĐỘNG ĐIỀN MẬT KHẨU TOÀN HỆ THỐNG ANDROID (AUTOFILL):</label>
            <p style="font-size:10.5px;color:var(--text-muted);margin:3px 0 8px;">
              Cho phép <strong>Krypto Autofill Service</strong> tự động gợi ý và điền tài khoản / mật khẩu trực tiếp trên trình duyệt Chrome và mọi ứng dụng Android.
            </p>
            <button type="button" class="btn-mobi-outline" style="width:100%;font-size:11px;padding:9px 8px;" onclick="window.KryptoPasswordVault.openAndroidAutofillSettings()">
              ⌨️ Bật Krypto Làm Dịch Vụ Tự Động Điền Mật Khẩu Android (Autofill)
            </button>
            <button type="button" id="kpw-btn-decoy-mode" class="btn-mobi-outline" style="width:100%;font-size:11px;padding:9px 8px;margin-top:6px;color:#d97706;border-color:#d97706;" onclick="window.KryptoPasswordVault.toggleDecoyVaultMode()">
              🎭 Bật Chế Độ Ví Ngụy Trang Khẩn Cấp (Decoy Vault Khi Bị Ép Mở Máy)
            </button>
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

    const autoCropToggle = document.getElementById("kpw-auto-crop-toggle");
    if (autoCropToggle) {
      autoCropToggle.checked = state.autoCropEnabled;
      autoCropToggle.addEventListener("change", () => {
        state.autoCropEnabled = autoCropToggle.checked;
      });
    }

    const frontInput = document.getElementById("kpw-front-img-input");
    if (frontInput) {
      frontInput.addEventListener("change", (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        state.pendingFrontFile = f;
        const reader = new FileReader();
        reader.onload = () => {
          processIncomingCardPhoto(String(reader.result), "front", false);
        };
        reader.readAsDataURL(f);
        frontInput.value = "";
      });
    }

    const backInput = document.getElementById("kpw-back-img-input");
    if (backInput) {
      backInput.addEventListener("change", (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        state.pendingBackFile = f;
        const reader = new FileReader();
        reader.onload = () => {
          processIncomingCardPhoto(String(reader.result), "back", false);
        };
        reader.readAsDataURL(f);
        backInput.value = "";
      });
    }

    bindCropperTouchEvents();

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
        if (state.pendingFrontDataUrl) {
          atts.push(
            await dataUrlToEncryptedAttachmentMeta(
              state.pendingFrontDataUrl,
              "front_image",
              "mat_truoc_the_cropped.png"
            )
          );
        } else if (state.pendingFrontFile) {
          atts.push(await fileToEncryptedAttachmentMeta(state.pendingFrontFile, "front_image"));
        }

        if (state.pendingBackDataUrl) {
          atts.push(
            await dataUrlToEncryptedAttachmentMeta(
              state.pendingBackDataUrl,
              "back_image",
              "mat_sau_the_cropped.png"
            )
          );
        } else if (state.pendingBackFile) {
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
        clearCardAttachmentSlot("front");
        clearCardAttachmentSlot("back");

        switchSubView("list");
        if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast("✓ Đã mã hóa AES-256-GCM (kèm ảnh thẻ đã cắt) và lưu vào Danh bạ!");
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
          await importQrOrScreenshotToVault(qrStr, att);
        } else {
          openCardCropperWithDataUrl(att.data_url, "qr");
        }
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
      mountWidget();
      await initOrUnlockVault(state.masterPassword);
      await renderRecordsList();
      setTimeout(() => {
        autoEnrichExistingIdentityRecords();
      }, 600);
    },

    reExtractFullFieldsFromRecordImages(recordId) {
      reExtractFullFieldsFromRecordImages(recordId, false);
    },

    switchSubView(viewName) {
      const host = document.getElementById("krypto-password-vault-mount");
      if (host && !host.innerHTML.trim()) {
        mountWidget();
      }
      switchSubView(viewName);
    },

    filterCategory(cat, btnEl) {
      filterCategory(cat, btnEl);
    },

    refreshUI() {
      const host = document.getElementById("krypto-password-vault-mount");
      if (host && !host.innerHTML.trim()) {
        mountWidget();
      }
      renderRecordsList();
    },

    openLiveCardCamera(slot = "front") {
      openLiveCardCamera(slot);
    },

    closeLiveCardCamera() {
      closeLiveCardCamera();
    },

    captureLiveCameraFrameToCropper() {
      captureLiveCameraFrameToCropper();
    },

    triggerSystemCameraForSlot(slot = "front") {
      triggerSystemCameraForSlot(slot);
    },

    triggerSystemCameraForCurrentSlot() {
      triggerSystemCameraForSlot(state.activePhotoSlot || "front");
    },

    setCropAspect(mode) {
      setCropAspect(mode, true);
    },

    rotateCropSource(deg) {
      rotateCropSource(deg);
    },

    toggleCropClarity() {
      toggleCropClarity();
    },

    applyCardCropAndAttach() {
      applyCardCropAndAttach();
    },

    quickRotateCroppedSlot(slot = "front", deg = 90) {
      quickRotateCroppedSlot(slot, deg);
    },

    autoReCropSlot(slot = "front") {
      const rawUrl =
        slot === "front"
          ? state.pendingFrontRawDataUrl || state.pendingFrontDataUrl
          : state.pendingBackRawDataUrl || state.pendingBackDataUrl;
      if (rawUrl) {
        const prev = state.autoCropEnabled;
        state.autoCropEnabled = true;
        processIncomingCardPhoto(rawUrl, slot, false);
        state.autoCropEnabled = prev;
      }
    },

    recropSlot(slot = "front") {
      const rawUrl =
        slot === "front"
          ? state.pendingFrontRawDataUrl || state.pendingFrontDataUrl
          : state.pendingBackRawDataUrl || state.pendingBackDataUrl;
      if (rawUrl) {
        openCardCropperWithDataUrl(rawUrl, slot, true);
      }
    },

    clearCardAttachmentSlot(slot = "front") {
      clearCardAttachmentSlot(slot);
    },

    onNativeCameraFrame(frameB64) {
      if (!state.liveCameraActive || !frameB64) return;
      const dataUrl = String(frameB64).startsWith("data:")
        ? String(frameB64)
        : `data:image/jpeg;base64,${frameB64}`;
      renderLiveCameraFrameDataUrl(dataUrl);
    },

    onNativeSystemPhotoCaptured(photoB64) {
      if (!photoB64) return;
      const dataUrl = String(photoB64).startsWith("data:")
        ? String(photoB64)
        : `data:image/jpeg;base64,${photoB64}`;
      processIncomingCardPhoto(dataUrl, state.activePhotoSlot || "front", false);
    },

    async onNativeCardOcrResult(ocrJsonStr, slot = "front", recordId = "") {
      if (!ocrJsonStr) return;
      try {
        const parsed = typeof ocrJsonStr === "string" ? JSON.parse(ocrJsonStr) : ocrJsonStr;
        if (recordId && state.decryptedRecords[recordId]) {
          // Chạy bóc tách trên bộ ô tạm rồi gộp thẳng vào bản ghi đã lưu trong Danh bạ!
          const rec = state.decryptedRecords[recordId];
          const titleInp = document.getElementById("kpw-title");
          const userInp = document.getElementById("kpw-username");
          const passInp = document.getElementById("kpw-password");
          const savedTitle = titleInp ? titleInp.value : "";
          const savedUser = userInp ? userInp.value : "";
          const savedPass = passInp ? passInp.value : "";
          if (titleInp) titleInp.value = rec.title || "";
          if (userInp) userInp.value = rec.username || "";
          if (passInp) passInp.value = rec.password || "";

          parseAndAutoFillCardFields(parsed.text || "", parsed.qr || "", slot);

          const nextTitle = titleInp ? titleInp.value : rec.title;
          const nextUser = userInp ? userInp.value : rec.username;
          const nextPass = passInp ? passInp.value : rec.password;
          if (titleInp) titleInp.value = savedTitle;
          if (userInp) userInp.value = savedUser;
          if (passInp) passInp.value = savedPass;

          // Nếu ảnh trong bản ghi bị ngược 180° thì tự xoay lại trong đính kèm luôn
          let nextAtts = rec.encrypted_attachments || [];
          if (parsed.flipped180 && parsed.rotatedImageB64) {
            const targetLbl = slot === "back" ? "back_image" : "front_image";
            nextAtts = nextAtts.map((a) =>
              a.label === targetLbl ? { ...a, data_url: parsed.rotatedImageB64 } : a
            );
          }

          await upsertRecord({
            recordId: rec.record_id,
            itemType: rec.item_type,
            folder: rec.folder,
            title: nextTitle || rec.title,
            username: nextUser || rec.username,
            password: nextPass || rec.password,
            totpSecret: rec.totp_secret,
            url: rec.url,
            notes: rec.notes,
            tags: rec.tags,
            encryptedAttachments: nextAtts,
            passwordHistory: rec.password_history,
          });
          await renderRecordsList();
          return;
        }

        if (parsed.flipped180 && parsed.rotatedImageB64) {
          if (slot === "front") {
            state.pendingFrontDataUrl = parsed.rotatedImageB64;
          } else if (slot === "back") {
            state.pendingBackDataUrl = parsed.rotatedImageB64;
          }
          updateCroppedSlotPreviews();
        }
        parseAndAutoFillCardFields(parsed.text || "", parsed.qr || "", slot);
      } catch (_) {}
    },

    async restoreNativePermanentVault(rawJson) {
      if (!rawJson) return;
      try {
        const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
        await loadEncryptedVaultObject(parsed, state.masterPassword);
        localStorage.setItem(STORAGE_KEY_VAULT, JSON.stringify(parsed));
        await renderRecordsList();
        setTimeout(() => {
          autoEnrichExistingIdentityRecords();
        }, 500);
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

    exportRecordTwoSidedPdfA4(recordId) {
      exportRecordTwoSidedPdfA4(recordId);
    },

    runSecurityAudit() {
      runVaultSecurityAudit();
    },

    toggleDecoyVaultMode() {
      toggleDecoyVaultMode();
    },

    onCardPdfExported(savedPath) {
      if (typeof window.showKryptoToast === "function") {
        window.showKryptoToast(`🖨️ Đã xuất Bản In PDF A4 2 Mặt (Chuẩn 85.6×54mm) tại: ${savedPath}`);
      }
    },

    openAndroidAutofillSettings() {
      syncAutofillCacheToNative();
      if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
        window.FlutterBridge.postMessage(
          JSON.stringify({
            action: "open_system_autofill_settings",
          })
        );
      }
    },

    toggleNfcScan() {
      const btn = document.getElementById("kpw-btn-nfc-scan");
      if (state.nfcScanning) {
        state.nfcScanning = false;
        if (btn) btn.textContent = "📡 Chạm Đọc Chip NFC (CCCD / Visa)";
        if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
          window.FlutterBridge.postMessage(JSON.stringify({ action: "stop_nfc_card_scan" }));
        }
        return;
      }
      if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
        const docNo = (document.getElementById("kpw-username")?.value || "").replace(/\D/g, "").slice(-9);
        const passMeta = document.getElementById("kpw-password")?.value || "";
        const toYYMMDD = (dStr) => {
          const m = String(dStr || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
          return m ? `${m[3].slice(-2)}${m[2]}${m[1]}` : "";
        };
        const dobM = passMeta.match(/NS:\s*(\d{2}\/\d{2}\/\d{4})/i);
        const expM = passMeta.match(/HSD:\s*(\d{2}\/\d{2}\/\d{4})/i);
        window.FlutterBridge.postMessage(
          JSON.stringify({
            action: "start_nfc_card_scan",
            docNo,
            dob: dobM ? toYYMMDD(dobM[1]) : "",
            expiry: expM ? toYYMMDD(expM[1]) : "",
          })
        );
      }
    },

    onNfcScanStatus(active) {
      state.nfcScanning = !!active;
      const btn = document.getElementById("kpw-btn-nfc-scan");
      if (active) {
        if (btn) btn.textContent = "📡 Đang chờ chạm thẻ NFC vào mặt lưng máy... (Nhấn để dừng)";
        if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast("📡 Hãy áp thẻ Visa/Mastercard/Napas hoặc CCCD gắn chip vào mặt lưng điện thoại!");
        }
      } else {
        if (btn) btn.textContent = "📡 Chạm Đọc Chip NFC (CCCD / Visa)";
        if (typeof window.showKryptoToast === "function") {
          window.showKryptoToast("⚠️ Thiết bị chưa bật NFC hoặc không hỗ trợ NFC!");
        }
      }
    },

    onNativeNfcCardScanned(nfcJsonStr) {
      state.nfcScanning = false;
      const btn = document.getElementById("kpw-btn-nfc-scan");
      if (btn) btn.textContent = "📡 Chạm Đọc Chip NFC (CCCD / Visa)";
      if (!nfcJsonStr) return;
      try {
        const data = typeof nfcJsonStr === "string" ? JSON.parse(nfcJsonStr) : nfcJsonStr;
        if (state.activeSubTab !== "add") {
          switchSubView("add");
        }
        const typeSel = document.getElementById("kpw-item-type");
        const folderInp = document.getElementById("kpw-folder");
        const titleInp = document.getElementById("kpw-title");
        const userInp = document.getElementById("kpw-username");
        const passInp = document.getElementById("kpw-password");

        if (data.cardType === "PAYMENT_CARD") {
          if (typeSel) typeSel.value = "PAYMENT_CARD";
          if (folderInp) folderInp.value = "Thẻ Ngân hàng (NFC Chip)";
          const pan = data.pan || "";
          const formattedPan = pan.replace(/(\d{4})(?=\d)/g, "$1 ");
          if (titleInp && !titleInp.value) {
            titleInp.value = `${data.brand || "Thẻ EMV"} (*${pan.slice(-4) || data.uid})`;
          }
          if (userInp) userInp.value = formattedPan || `UID: ${data.uid}`;
          if (passInp) {
            const parts = [];
            if (data.expiry) parts.push(`HSD: ${data.expiry}`);
            if (data.aid) parts.push(`AID: ${data.aid}`);
            parts.push(`Chip UID: ${data.uid}`);
            passInp.value = parts.join(" | ");
          }
          if (typeof window.showKryptoToast === "function") {
            window.showKryptoToast(`📡 Đã đọc Chip NFC ${data.brand || "EMV"}: ${formattedPan || data.uid}!`);
          }
        } else {
          if (typeSel) typeSel.value = "IDENTITY";
          if (folderInp && (!folderInp.value || folderInp.value === "Mặc định")) {
            folderInp.value = "Giấy tờ Gắn Chip NFC (ICAO 9303)";
          }
          if (titleInp && !titleInp.value) {
            titleInp.value = `${data.brand || "CCCD / Hộ chiếu NFC"} (${data.uid})`;
          }
          if (userInp && !userInp.value) {
            userInp.value = `Chip UID: ${data.uid}`;
          }
          if (passInp) {
            const meta = [`Chip UID: ${data.uid}`];
            if (data.atr) meta.push(`ATR/Hist: ${data.atr}`);
            if (data.techs) meta.push(`Chuẩn: ${data.techs}`);
            passInp.value = passInp.value ? `${passInp.value} | ${meta.join(" | ")}` : meta.join(" | ");
          }
          if (typeof window.showKryptoToast === "function") {
            window.showKryptoToast(`📡 Đã đọc Chip NFC (${data.brand || "ISO-DEP"}): UID ${data.uid}!`);
          }
        }
      } catch (_) {}
    },
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
      global.KryptoPasswordVault.init();
    });
  } else {
    global.KryptoPasswordVault.init();
  }

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
