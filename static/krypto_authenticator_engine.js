/**
 * krypto_authenticator_engine.js
 * BỘ XÁC THỰC ĐA NHÂN TỐ KRYPTO AUTHENTICATOR (2FA / MFA OFFLINE 100%)
 * Tích hợp trực tiếp vào ứng dụng Krypto (SecureDocShare Web & Mobile APK Offline)
 *
 * Đặc điểm:
 * - Zero Dummy Data: Không chứa bất kỳ tài khoản mẫu giả định nào; chỉ hiển thị Buồng HSM thật của người dùng
 *   và các tài khoản do người dùng trực tiếp quét QR hoặc thêm vào.
 * - Live Camera QR Scanner & Offline Image QR Decoder (tích hợp jsQR + WebRTC Camera).
 * - Chuẩn IETF RFC 4648 (Base32), RFC 4226 (HOTP), RFC 6238 (TOTP), RFC 6287 (OCRA).
 * - Tương thích hai chiều Google Authenticator (otpauth:// & otpauth-migration:// Protobuf).
 * - Sao lưu Két 2FA .kryptovault (PBKDF2-HMAC-SHA256 600,000 vòng + AES-256-GCM).
 */

(function () {
  "use strict";

  const AUTH_STORAGE_KEY = "krypto_integrated_authenticator_v1";
  const LEGACY_DUMMY_IDS = new Set([
    "acc_ibst_cde",
    "acc_google_workspace",
    "acc_github_ent",
    "acc_krypto_vault_8",
    "acc_hotp_token",
    "acc_ibst_hsm"
  ]);
  const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  // ==========================================================================
  // 1. BASE32 CODEC (RFC 4648)
  // ==========================================================================
  const Base32 = {
    normalize(str) {
      const cleaned = String(str || "")
        .trim()
        .replace(/[\s\-=]+/g, "")
        .toUpperCase();
      for (let i = 0; i < cleaned.length; i++) {
        if (B32_ALPHABET.indexOf(cleaned[i]) === -1) {
          throw new Error("Ký tự không thuộc bảng mã Base32 (A-Z, 2-7): " + cleaned[i]);
        }
      }
      return cleaned;
    },

    decode(str) {
      const cleaned = this.normalize(str);
      if (!cleaned.length) return new Uint8Array(0);
      let bits = 0;
      let value = 0;
      const out = [];
      for (let i = 0; i < cleaned.length; i++) {
        value = (value << 5) | B32_ALPHABET.indexOf(cleaned[i]);
        bits += 5;
        if (bits >= 8) {
          out.push((value >>> (bits - 8)) & 0xff);
          bits -= 8;
        }
      }
      return new Uint8Array(out);
    },

    encode(bytes) {
      let bits = 0;
      let value = 0;
      let output = "";
      for (let i = 0; i < bytes.length; i++) {
        value = (value << 8) | (bytes[i] & 0xff);
        bits += 8;
        while (bits >= 5) {
          output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
          bits -= 5;
        }
      }
      if (bits > 0) {
        output += B32_ALPHABET[(value << (5 - bits)) & 31];
      }
      return output;
    },

    randomSecret(byteLen = 20) {
      const buf = new Uint8Array(byteLen);
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(buf);
      } else {
        for (let i = 0; i < byteLen; i++) buf[i] = Math.floor(Math.random() * 256);
      }
      return this.encode(buf);
    }
  };

  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function utf8ToBytes(str) {
    return new TextEncoder().encode(str);
  }

  function bytesToUtf8(bytes) {
    return new TextDecoder().decode(bytes);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function notifyUser(msg) {
    if (typeof window.showToast === "function") {
      window.showToast(msg);
    } else {
      console.log("[KryptoAuth]", msg);
    }
  }

  // ==========================================================================
  // 2. PURE-JS SYNCHRONOUS SHA-1, SHA-256, SHA-512 & HMAC
  // ==========================================================================
  function rotr32(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function rotl32(x, n) {
    return (x << n) | (x >>> (32 - n));
  }

  function sha1(msgBytes) {
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

    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);

    for (let offset = 0; offset < padLen; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 80; i++) {
        w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) {
          f = (b & c) | (~b & d);
          k = 0x5a827999;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (i < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }
        const temp = (rotl32(a, 5) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = rotl32(b, 30) >>> 0; b = a; a = temp;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }

    const out = new Uint8Array(20);
    const outView = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((v, idx) => outView.setUint32(idx * 4, v, false));
    return out;
  }

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

  function sha256(msgBytes) {
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

  const SHA512_K = [
    0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
    0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
    0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
    0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
    0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
    0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
    0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
    0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
    0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
    0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
    0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
    0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
    0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
    0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
    0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
    0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
    0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
    0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
    0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
    0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n
  ];

  const MASK64 = 0xffffffffffffffffn;
  function rotr64(x, n) {
    const bn = BigInt(n);
    return ((x >> bn) | ((x << (64n - bn)) & MASK64)) & MASK64;
  }

  function sha512(msgBytes) {
    const ml = msgBytes.length;
    const padLen = (ml + 17 + 127) & ~127;
    const buf = new Uint8Array(padLen);
    buf.set(msgBytes);
    buf[ml] = 0x80;
    const view = new DataView(buf.buffer);
    view.setBigUint64(padLen - 8, BigInt(ml) * 8n, false);

    let h0 = 0x6a09e667f3bcc908n, h1 = 0xbb67ae8584caa73bn;
    let h2 = 0x3c6ef372fe94f82bn, h3 = 0xa54ff53a5f1d36f1n;
    let h4 = 0x510e527fade682d1n, h5 = 0x9b05688c2b3e6c1fn;
    let h6 = 0x1f83d9abfb41bd6bn, h7 = 0x5be0cd19137e2179n;
    const w = new Array(80).fill(0n);

    for (let offset = 0; offset < padLen; offset += 128) {
      for (let i = 0; i < 16; i++) w[i] = view.getBigUint64(offset + i * 8, false);
      for (let i = 16; i < 80; i++) {
        const s0 = rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> 7n);
        const s1 = rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> 6n);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 80; i++) {
        const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
        const ch = (e & f) ^ ((~e & MASK64) & g);
        const temp1 = (h + S1 + ch + SHA512_K[i] + w[i]) & MASK64;
        const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) & MASK64;
        h = g; g = f; f = e; e = (d + temp1) & MASK64;
        d = c; c = b; b = a; a = (temp1 + temp2) & MASK64;
      }
      h0 = (h0 + a) & MASK64; h1 = (h1 + b) & MASK64;
      h2 = (h2 + c) & MASK64; h3 = (h3 + d) & MASK64;
      h4 = (h4 + e) & MASK64; h5 = (h5 + f) & MASK64;
      h6 = (h6 + g) & MASK64; h7 = (h7 + h) & MASK64;
    }

    const out = new Uint8Array(64);
    const outView = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((val, idx) => outView.setBigUint64(idx * 8, val, false));
    return out;
  }

  function computeHmac(algo, keyBytes, msgBytes) {
    const norm = String(algo || "SHA1").toUpperCase().replace("-", "");
    const hashFn = norm === "SHA256" ? sha256 : norm === "SHA512" ? sha512 : sha1;
    const blockSize = norm === "SHA512" ? 128 : 64;

    let k = keyBytes;
    if (k.length > blockSize) k = hashFn(k);
    const kPadded = new Uint8Array(blockSize);
    kPadded.set(k);

    const ipad = new Uint8Array(blockSize + msgBytes.length);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = kPadded[i] ^ 0x36;
      opad[i] = kPadded[i] ^ 0x5c;
    }
    ipad.set(msgBytes, blockSize);
    const innerHash = hashFn(ipad);

    const outerBuf = new Uint8Array(blockSize + innerHash.length);
    outerBuf.set(opad);
    outerBuf.set(innerHash, blockSize);
    return hashFn(outerBuf);
  }

  // ==========================================================================
  // 3. HOTP (RFC 4226), TOTP (RFC 6238), AND OCRA (RFC 6287)
  // ==========================================================================
  function counterTo8Bytes(counter) {
    let c = BigInt(counter);
    const buf = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      buf[i] = Number(c & 0xffn);
      c >>= 8n;
    }
    return buf;
  }

  function computeHOTPWithTrace(secretBytes, counter, digits = 6, algorithm = "SHA1") {
    const counterBytes = counterTo8Bytes(counter);
    const digest = computeHmac(algorithm, secretBytes, counterBytes);
    const offset = digest[digest.length - 1] & 0x0f;
    const b0 = digest[offset] & 0x7f;
    const b1 = digest[offset + 1] & 0xff;
    const b2 = digest[offset + 2] & 0xff;
    const b3 = digest[offset + 3] & 0xff;
    const truncatedInt = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    const mod = Math.pow(10, digits);
    const otp = String(truncatedInt % mod).padStart(digits, "0");

    return {
      algorithm: String(algorithm).toUpperCase().replace("-", ""),
      digits: Number(digits),
      counter: String(counter),
      counterHex: bytesToHex(counterBytes).toUpperCase(),
      secretHex: bytesToHex(secretBytes),
      hmacBytes: Array.from(digest),
      hmacHex: bytesToHex(digest),
      offset,
      selected4BytesHex: bytesToHex(digest.slice(offset, offset + 4)),
      truncatedInt,
      otp
    };
  }

  function computeTOTPWithTrace(secretB32OrBytes, unixSeconds, period = 30, digits = 6, algorithm = "SHA1") {
    const secretBytes =
      typeof secretB32OrBytes === "string" ? Base32.decode(secretB32OrBytes) : secretB32OrBytes;
    const ts = Math.floor(Number(unixSeconds));
    const p = Number(period) || 30;
    const counter = Math.floor(ts / p);
    const remaining = p - (ts % p);
    const current = computeHOTPWithTrace(secretBytes, counter, digits, algorithm);
    const next = computeHOTPWithTrace(secretBytes, counter + 1, digits, algorithm);
    return {
      timestamp: ts,
      period: p,
      remainingSeconds: remaining,
      otp: current.otp,
      nextOtp: next.otp,
      trace: current
    };
  }

  function computeOCRATransactionOTP(secretB32, recipient, amount, reference, unixSeconds, period = 30, digits = 8) {
    const secretBytes = Base32.decode(secretB32);
    const suiteId = "OCRA-1:HOTP-SHA256-8:C-QH64-T30S";
    const ts = Math.floor(Number(unixSeconds));
    const counter = Math.floor(ts / period);
    const counterBytes = counterTo8Bytes(counter);

    const canonicalContext = `${String(recipient).trim()}|${String(amount).trim()}|${String(reference).trim()}`;
    const contextHash = sha256(utf8ToBytes(canonicalContext));
    const suiteBytes = utf8ToBytes(suiteId);

    const dataInput = new Uint8Array(suiteBytes.length + 1 + 8 + contextHash.length);
    dataInput.set(suiteBytes, 0);
    dataInput[suiteBytes.length] = 0x00;
    dataInput.set(counterBytes, suiteBytes.length + 1);
    dataInput.set(contextHash, suiteBytes.length + 9);

    const mac = computeHmac("SHA256", secretBytes, dataInput);
    const offset = mac[mac.length - 1] & 0x0f;
    const codeInt =
      (((mac[offset] & 0x7f) << 24) |
        ((mac[offset + 1] & 0xff) << 16) |
        ((mac[offset + 2] & 0xff) << 8) |
        (mac[offset + 3] & 0xff)) >>>
      0;
    const otp = String(codeInt % Math.pow(10, digits)).padStart(digits, "0");

    return {
      suite: suiteId,
      canonicalContext,
      contextSha256Hex: bytesToHex(contextHash),
      counter,
      hmacHex: bytesToHex(mac),
      offset,
      otp
    };
  }

  // ==========================================================================
  // 4. OTPAUTH:// & GOOGLE AUTHENTICATOR PROTOBUF MIGRATION CODEC
  // ==========================================================================
  function parseOtpAuthUri(uri) {
    const trimmed = String(uri || "").trim();
    if (!trimmed.toLowerCase().startsWith("otpauth://")) {
      throw new Error("Mã QR hoặc URI phải bắt đầu bằng otpauth://");
    }
    const url = new URL(trimmed);
    const type = (url.hostname || url.host || "totp").toLowerCase();
    const rawLabel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const params = url.searchParams;
    const secret = Base32.normalize(params.get("secret") || "");
    if (!secret) throw new Error("URI thiếu tham số secret");

    let labelIssuer = "";
    let accountName = rawLabel;
    if (rawLabel.includes(":")) {
      const parts = rawLabel.split(":");
      labelIssuer = parts[0].trim();
      accountName = parts.slice(1).join(":").trim();
    }
    const issuer = (params.get("issuer") || labelIssuer || "Dịch vụ 2FA").trim();
    const algorithm = (params.get("algorithm") || "SHA1").toUpperCase().replace("-", "");
    const digits = parseInt(params.get("digits") || "6", 10) || 6;
    const period = parseInt(params.get("period") || "30", 10) || 30;
    const counter = parseInt(params.get("counter") || "0", 10) || 0;

    return {
      id: "acc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      issuer,
      accountName: accountName || "Tài khoản",
      secret,
      otpType: type === "hotp" ? "hotp" : "totp",
      algorithm: ["SHA1", "SHA256", "SHA512"].includes(algorithm) ? algorithm : "SHA1",
      digits: [6, 7, 8].includes(digits) ? digits : 6,
      period: period > 0 ? period : 30,
      counter,
      category: "Google Auth"
    };
  }

  function buildOtpAuthUri(acc) {
    const label = acc.issuer ? `${acc.issuer}:${acc.accountName}` : acc.accountName;
    const params = new URLSearchParams();
    params.set("secret", Base32.normalize(acc.secret));
    if (acc.issuer) params.set("issuer", acc.issuer);
    params.set("algorithm", acc.algorithm || "SHA1");
    params.set("digits", String(acc.digits || 6));
    if (acc.otpType === "hotp") {
      params.set("counter", String(acc.counter || 0));
    } else {
      params.set("period", String(acc.period || 30));
    }
    return `otpauth://${acc.otpType || "totp"}/${encodeURIComponent(label)}?${params.toString()}`;
  }

  const GoogleMigration = {
    encodeVarint(num) {
      const out = [];
      let v = BigInt(num >= 0 ? num : 0);
      while (v > 0x7fn) {
        out.push(Number((v & 0x7fn) | 0x80n));
        v >>= 7n;
      }
      out.push(Number(v & 0x7fn));
      return out;
    },

    decodeVarint(buf, pos) {
      let result = 0n;
      let shift = 0n;
      while (pos < buf.length) {
        const b = buf[pos++];
        result |= BigInt(b & 0x7f) << shift;
        if ((b & 0x80) === 0) return { value: Number(result), pos };
        shift += 7n;
      }
      throw new Error("Protobuf Varint không hợp lệ");
    },

    encodeLenDelimited(fieldNum, dataBytes) {
      const tag = (fieldNum << 3) | 2;
      return [...this.encodeVarint(tag), ...this.encodeVarint(dataBytes.length), ...Array.from(dataBytes)];
    },

    encodeVarintField(fieldNum, val) {
      const tag = (fieldNum << 3) | 0;
      return [...this.encodeVarint(tag), ...this.encodeVarint(val)];
    },

    encodeAccountsToUri(accounts) {
      const payload = [];
      const algoMap = { SHA1: 1, SHA256: 2, SHA512: 3 };
      for (const acc of accounts) {
        const secretRaw = Base32.decode(acc.secret);
        const nameStr = acc.issuer ? `${acc.issuer}:${acc.accountName}` : acc.accountName;
        const entry = [
          ...this.encodeLenDelimited(1, secretRaw),
          ...this.encodeLenDelimited(2, utf8ToBytes(nameStr)),
          ...(acc.issuer ? this.encodeLenDelimited(3, utf8ToBytes(acc.issuer)) : []),
          ...this.encodeVarintField(4, algoMap[acc.algorithm] || 1),
          ...this.encodeVarintField(5, acc.digits === 8 ? 2 : 1),
          ...this.encodeVarintField(6, acc.otpType === "hotp" ? 1 : 2),
          ...(acc.otpType === "hotp" ? this.encodeVarintField(7, acc.counter || 0) : [])
        ];
        payload.push(...this.encodeLenDelimited(1, new Uint8Array(entry)));
      }
      payload.push(...this.encodeVarintField(2, 1));
      payload.push(...this.encodeVarintField(3, 1));
      payload.push(...this.encodeVarintField(4, 0));
      payload.push(...this.encodeVarintField(5, 20261028));

      const u8 = new Uint8Array(payload);
      let binStr = "";
      for (let i = 0; i < u8.length; i++) binStr += String.fromCharCode(u8[i]);
      const b64 = btoa(binStr);
      return "otpauth-migration://offline?data=" + encodeURIComponent(b64);
    },

    decodeUriToAccounts(migrationUri) {
      let b64 = String(migrationUri || "").trim();
      if (b64.toLowerCase().startsWith("otpauth-migration://")) {
        const u = new URL(b64);
        b64 = u.searchParams.get("data") || "";
      }
      b64 = decodeURIComponent(b64).replace(/\s/g, "+");
      while (b64.length % 4 !== 0) b64 += "=";
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);

      const accounts = [];
      let pos = 0;
      while (pos < buf.length) {
        const tagRes = this.decodeVarint(buf, pos);
        pos = tagRes.pos;
        const fieldNum = tagRes.value >> 3;
        const wireType = tagRes.value & 0x07;
        if (wireType === 0) {
          pos = this.decodeVarint(buf, pos).pos;
        } else if (wireType === 2) {
          const lenRes = this.decodeVarint(buf, pos);
          pos = lenRes.pos;
          const chunk = buf.slice(pos, pos + lenRes.value);
          pos += lenRes.value;
          if (fieldNum === 1) {
            accounts.push(this.parseOtpParameters(chunk));
          }
        } else {
          throw new Error("WireType không hỗ trợ: " + wireType);
        }
      }
      return accounts;
    },

    parseOtpParameters(chunk) {
      let pos = 0;
      let secretRaw = new Uint8Array(0);
      let name = "";
      let issuer = "";
      let algoEnum = 1;
      let digitsEnum = 1;
      let typeEnum = 2;
      let counter = 0;

      while (pos < chunk.length) {
        const t = this.decodeVarint(chunk, pos);
        pos = t.pos;
        const f = t.value >> 3;
        const w = t.value & 0x07;
        if (w === 0) {
          const v = this.decodeVarint(chunk, pos);
          pos = v.pos;
          if (f === 4) algoEnum = v.value;
          else if (f === 5) digitsEnum = v.value;
          else if (f === 6) typeEnum = v.value;
          else if (f === 7) counter = v.value;
        } else if (w === 2) {
          const l = this.decodeVarint(chunk, pos);
          pos = l.pos;
          const sub = chunk.slice(pos, pos + l.value);
          pos += l.value;
          if (f === 1) secretRaw = sub;
          else if (f === 2) name = bytesToUtf8(sub);
          else if (f === 3) issuer = bytesToUtf8(sub);
        }
      }

      const secretB32 = Base32.encode(secretRaw);
      let accountName = name;
      if (name.includes(":") && !issuer) {
        const sp = name.split(":");
        issuer = sp[0].trim();
        accountName = sp.slice(1).join(":").trim();
      } else if (issuer && name.startsWith(issuer + ":")) {
        accountName = name.slice(issuer.length + 1).trim();
      }

      const algoLookup = { 1: "SHA1", 2: "SHA256", 3: "SHA512" };
      return {
        id: "acc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        issuer: issuer || "Google Auth",
        accountName: accountName || "Tài khoản",
        secret: secretB32,
        otpType: typeEnum === 1 ? "hotp" : "totp",
        algorithm: algoLookup[algoEnum] || "SHA1",
        digits: digitsEnum === 2 ? 8 : 6,
        period: 30,
        counter,
        category: "Google Auth"
      };
    }
  };

  // ==========================================================================
  // 5. AES-256-GCM + PBKDF2-HMAC-SHA256 VAULT BACKUP (.kryptovault)
  // ==========================================================================
  function u8ToB64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }

  function b64ToU8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function encryptVaultAESGCM(accounts, masterPassword) {
    if (!masterPassword || masterPassword.length < 4) {
      throw new Error("Mật khẩu bảo vệ Két 2FA phải có ít nhất 4 ký tự");
    }
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const nonce = window.crypto.getRandomValues(new Uint8Array(12));
    const iterations = 600000;

    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      utf8ToBytes(masterPassword),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );

    const aad = utf8ToBytes("KRYPTO-AUTHENTICATOR-VAULT:v1");
    const plainBytes = utf8ToBytes(
      JSON.stringify({
        exported_at: new Date().toISOString(),
        accounts
      })
    );
    const cipherBuf = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
      aesKey,
      plainBytes
    );

    return {
      format: "KRYPTO-AUTHENTICATOR-VAULT",
      version: 1,
      kdf: {
        algorithm: "PBKDF2-HMAC-SHA256",
        iterations,
        salt_b64: u8ToB64(salt)
      },
      cipher: {
        algorithm: "AES-256-GCM",
        nonce_b64: u8ToB64(nonce),
        tag_bits: 128
      },
      created_at: new Date().toISOString(),
      account_count: accounts.length,
      ciphertext_b64: u8ToB64(new Uint8Array(cipherBuf))
    };
  }

  async function decryptVaultAESGCM(vaultObj, masterPassword) {
    if (!vaultObj || vaultObj.format !== "KRYPTO-AUTHENTICATOR-VAULT") {
      throw new Error("Tệp không đúng định dạng KRYPTO-AUTHENTICATOR-VAULT");
    }
    const salt = b64ToU8(vaultObj.kdf.salt_b64);
    const nonce = b64ToU8(vaultObj.cipher.nonce_b64);
    const iterations = Number(vaultObj.kdf.iterations || 600000);
    const cipherBytes = b64ToU8(vaultObj.ciphertext_b64);

    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      utf8ToBytes(masterPassword),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    const aad = utf8ToBytes(`KRYPTO-AUTHENTICATOR-VAULT:v${vaultObj.version || 1}`);
    let plainBuf;
    try {
      plainBuf = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
        aesKey,
        cipherBytes
      );
    } catch (e) {
      throw new Error("Sai mật khẩu chủ hoặc tệp .kryptovault đã bị thay đổi");
    }
    const decoded = JSON.parse(bytesToUtf8(new Uint8Array(plainBuf)));
    return decoded.accounts || [];
  }

  // ==========================================================================
  // 6. STATE MANAGEMENT (ZERO DUMMY DATA INVARIANT)
  // ==========================================================================
  let accounts = [];
  let activeCategory = "ALL";
  let searchQuery = "";

  // Camera Scanner state
  let activeVideoStream = null;
  let cameraScanAnimId = null;
  let currentFacingMode = "environment";

  function syncWithKryptoPersonalHSM() {
    try {
      const hsmVault = window.KryptoHSMSignatureEngine?.getActiveHSMVault?.();
      if (hsmVault && hsmVault.mobile_totp_secret) {
        const cleanSec = Base32.normalize(hsmVault.mobile_totp_secret);
        const hsmId = "acc_krypto_personal_hsm_slot";
        const signerEmail = hsmVault.certificate?.signer_email || hsmVault.certificate?.signer_name || "HSM Slot";
        const slotName = `Krypto HSM (${hsmVault.slot_id || "PKCS#11"})`;

        const existingIdx = accounts.findIndex((a) => a.id === hsmId);
        const hsmAcc = {
          id: hsmId,
          issuer: slotName,
          accountName: signerEmail,
          secret: cleanSec,
          otpType: "totp",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          counter: 0,
          category: "Nội bộ",
          isHsmLinked: true
        };
        if (existingIdx >= 0) {
          accounts[existingIdx] = hsmAcc;
        } else {
          accounts.unshift(hsmAcc);
        }
      }
    } catch (e) {
      // ignore if HSM not initialized yet
    }
  }

  function loadAccounts() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Purge any legacy dummy accounts so only real user accounts remain
          accounts = parsed.filter((a) => a && a.id && !LEGACY_DUMMY_IDS.has(a.id));
        }
      }
    } catch (e) {
      accounts = [];
    }
    syncWithKryptoPersonalHSM();
    saveAccounts();
  }

  function saveAccounts() {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(accounts));
    } catch (e) {
      console.warn("Save Krypto Authenticator storage error:", e);
    }
  }

  function formatOtpReadable(otpStr) {
    const s = String(otpStr);
    if (s.length === 6) return s.slice(0, 3) + " " + s.slice(3);
    if (s.length === 8) return s.slice(0, 4) + " " + s.slice(4);
    return s;
  }

  function getFilteredAccounts() {
    return accounts.filter((acc) => {
      const matchCat = activeCategory === "ALL" || acc.category === activeCategory;
      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        (acc.issuer || "").toLowerCase().includes(q) ||
        (acc.accountName || "").toLowerCase().includes(q) ||
        (acc.category || "").toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }

  // ==========================================================================
  // 7. UI RENDERING INSIDE KRYPTO (#tab-auth)
  // ==========================================================================
  function renderAuthCards() {
    syncWithKryptoPersonalHSM();
    const grid = document.getElementById("krypto-auth-otp-list");
    if (!grid) return;

    const list = getFilteredAccounts();
    if (list.length === 0) {
      grid.innerHTML = `
        <div class="card settings-card" style="text-align:center; padding:20px 16px;">
          <p style="font-size:12.5px; color:var(--text-title); font-weight:700; margin:0 0 6px;">Chưa có tài khoản 2FA nào trong danh mục này</p>
          <p style="font-size:11.5px; color:var(--text-muted); margin:0 0 12px;">Hãy bấm nút bên dưới để mở Máy ảnh quét mã QR 2FA hoặc thêm tài khoản mới.</p>
          <button type="button" class="btn-mobi-solid" style="font-size:12px; padding:8px 16px;" onclick="window.KryptoAuthenticator.openCameraQrScanner()">📷 Quét Mã QR Bằng Máy Ảnh</button>
        </div>`;
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const circumference = 2 * Math.PI * 15;

    grid.innerHTML = list
      .map((acc) => {
        const isHotp = acc.otpType === "hotp";
        const period = acc.period || 30;
        let otp = "------";
        let nextOtp = "------";
        let rem = period;

        try {
          if (isHotp) {
            otp = computeHOTPWithTrace(Base32.decode(acc.secret), acc.counter || 0, acc.digits || 6, acc.algorithm || "SHA1").otp;
          } else {
            const res = computeTOTPWithTrace(acc.secret, nowSec, period, acc.digits || 6, acc.algorithm || "SHA1");
            otp = res.otp;
            nextOtp = res.nextOtp;
            rem = res.remainingSeconds;
          }
        } catch (e) {
          otp = "ERROR";
        }

        const expiring = !isHotp && rem <= 5;
        const dashOffset = isHotp ? 0 : circumference * (1 - rem / period);

        return `
        <div class="card krypto-otp-item-card" data-acc-id="${acc.id}">
          <div class="krypto-otp-top">
            <div style="min-width:0;">
              <div class="krypto-otp-issuer">
                ${acc.isHsmLinked ? "🛡️ " : "🔑 "}${escapeHtml(acc.issuer)}
              </div>
              <div class="krypto-otp-account">${escapeHtml(acc.accountName)}</div>
            </div>
            <span class="krypto-otp-badge">${escapeHtml(acc.otpType.toUpperCase())} • ${escapeHtml(acc.algorithm)}</span>
          </div>

          <div class="krypto-otp-code-row" onclick="window.KryptoAuthenticator.copyOtp('${acc.id}')" title="Chạm để sao chép mã xác thực">
            <div class="krypto-otp-digits ${expiring ? "expiring" : ""}" id="kauth_val_${acc.id}">${formatOtpReadable(otp)}</div>
            ${
              isHotp
                ? `<button type="button" class="btn-mini-gen" onclick="event.stopPropagation(); window.KryptoAuthenticator.stepHotp('${acc.id}')">+1 Counter (${acc.counter || 0})</button>`
                : `<div class="krypto-timer-ring">
                    <svg viewBox="0 0 38 38" width="38" height="38" style="transform:rotate(-90deg);">
                      <circle cx="19" cy="19" r="15" fill="none" stroke="var(--border)" stroke-width="3.2"></circle>
                      <circle id="kauth_ring_${acc.id}" cx="19" cy="19" r="15" fill="none"
                        stroke="${expiring ? "#ef4444" : "var(--primary)"}"
                        stroke-width="3.2" stroke-linecap="round"
                        stroke-dasharray="${circumference.toFixed(2)}"
                        stroke-dashoffset="${dashOffset.toFixed(2)}"></circle>
                    </svg>
                    <span class="krypto-timer-sec" id="kauth_sec_${acc.id}">${rem}s</span>
                  </div>`
            }
          </div>

          <div class="krypto-otp-footer">
            <span class="krypto-otp-next" id="kauth_next_${acc.id}">
              ${isHotp ? `Danh mục: ${escapeHtml(acc.category || "Chung")}` : `Kế tiếp: ${formatOtpReadable(nextOtp)}`}
            </span>
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
              <button type="button" class="btn-chip-micro" onclick="window.KryptoAuthenticator.copyOtp('${acc.id}')">📋 Copy</button>
              <button type="button" class="btn-chip-micro" onclick="window.KryptoAuthenticator.inspectAccount('${acc.id}')">🔬 Giải phẫu</button>
              <button type="button" class="btn-chip-micro" onclick="window.KryptoAuthenticator.showAccountQrModal('${acc.id}')">📱 Mã QR</button>
              ${
                acc.isHsmLinked
                  ? ""
                  : `<button type="button" class="btn-chip-micro" style="color:#ef4444;" onclick="window.KryptoAuthenticator.deleteAccount('${acc.id}')">🗑️ Xóa</button>`
              }
            </div>
          </div>
        </div>`;
      })
      .join("");
  }

  function tickClocks() {
    const nowSec = Math.floor(Date.now() / 1000);
    const clockBadge = document.getElementById("kauth-unix-clock-pill");
    if (clockBadge) {
      clockBadge.textContent = `UTC Step: ${Math.floor(nowSec / 30)} (${30 - (nowSec % 30)}s)`;
    }

    const circumference = 2 * Math.PI * 15;
    const list = getFilteredAccounts();
    for (const acc of list) {
      if (acc.otpType === "hotp") continue;
      const period = acc.period || 30;
      try {
        const res = computeTOTPWithTrace(acc.secret, nowSec, period, acc.digits || 6, acc.algorithm || "SHA1");
        const valEl = document.getElementById(`kauth_val_${acc.id}`);
        const ringEl = document.getElementById(`kauth_ring_${acc.id}`);
        const secEl = document.getElementById(`kauth_sec_${acc.id}`);
        const nextEl = document.getElementById(`kauth_next_${acc.id}`);

        const expiring = res.remainingSeconds <= 5;
        if (valEl) {
          valEl.textContent = formatOtpReadable(res.otp);
          valEl.classList.toggle("expiring", expiring);
        }
        if (ringEl) {
          const offset = circumference * (1 - res.remainingSeconds / period);
          ringEl.style.strokeDashoffset = offset.toFixed(2);
          ringEl.setAttribute("stroke", expiring ? "#ef4444" : "var(--primary)");
        }
        if (secEl) secEl.textContent = `${res.remainingSeconds}s`;
        if (nextEl) nextEl.textContent = `Kế tiếp: ${formatOtpReadable(res.nextOtp)}`;
      } catch (e) {
        // ignore
      }
    }
  }

  function ensureRealDefaultSecretInLab() {
    const labSecEl = document.getElementById("kauth-lab-secret");
    const ocraSecEl = document.getElementById("kauth-ocra-secret");
    const firstSecret = accounts[0]?.secret || "";
    if (labSecEl && !labSecEl.value.trim() && firstSecret) {
      labSecEl.value = firstSecret;
    }
    if (ocraSecEl && !ocraSecEl.value.trim() && firstSecret) {
      ocraSecEl.value = firstSecret;
    }
  }

  function runLabTraceUI() {
    ensureRealDefaultSecretInLab();
    const secInput = document.getElementById("kauth-lab-secret")?.value.trim() || "";
    const algoInput = document.getElementById("kauth-lab-algo")?.value || "SHA1";
    const digitsInput = parseInt(document.getElementById("kauth-lab-digits")?.value || "6", 10);
    const outBox = document.getElementById("kauth-lab-trace-box");
    if (!outBox) return;

    if (!secInput) {
      outBox.innerHTML = `<p style="font-size:11px; color:var(--text-muted); margin:0;">Hãy bấm nút <strong>🔬 Giải phẫu</strong> trên một tài khoản 2FA bất kỳ hoặc nhập Khóa Base32 để xem chi tiết từng byte HMAC.</p>`;
      return;
    }

    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const res = computeTOTPWithTrace(secInput, nowSec, 30, digitsInput, algoInput);
      const tr = res.trace;

      const byteBadges = tr.hmacBytes
        .map((b, idx) => {
          const hex = b.toString(16).padStart(2, "0");
          const isSlice = idx >= tr.offset && idx < tr.offset + 4;
          const isLast = idx === tr.hmacBytes.length - 1;
          const style = isSlice
            ? "background:rgba(2,132,199,0.2); color:var(--primary); font-weight:700; border:1px solid var(--primary);"
            : isLast
            ? "background:rgba(245,158,11,0.2); color:#d97706; font-weight:700; border:1px solid #d97706;"
            : "background:var(--bg-subtle); color:var(--text-muted); border:1px solid var(--border);";
          return `<span style="display:inline-block; font-family:monospace; font-size:10.5px; padding:2px 5px; border-radius:4px; ${style}">[${idx}]${hex}</span>`;
        })
        .join(" ");

      outBox.innerHTML = `
        <div style="font-size:11px; line-height:1.55; color:var(--text-title);">
          <div style="padding:5px 0; border-bottom:1px dashed var(--border); display:flex; justify-content:space-between; gap:8px;">
            <span>1. Khóa K (Hex):</span>
            <strong style="font-family:monospace; word-break:break-all;">0x${tr.secretHex}</strong>
          </div>
          <div style="padding:5px 0; border-bottom:1px dashed var(--border); display:flex; justify-content:space-between; gap:8px;">
            <span>2. Bước đếm T_C (8-byte BE):</span>
            <strong style="font-family:monospace;">${tr.counter} (0x${tr.counterHex})</strong>
          </div>
          <div style="padding:6px 0; border-bottom:1px dashed var(--border);">
            <div style="margin-bottom:4px;">3. Mảng HMAC-${tr.algorithm} (Byte cuối <code>[${tr.hmacBytes.length - 1}]</code> chỉ định <code>offset=${tr.offset}</code>):</div>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">${byteBadges}</div>
          </div>
          <div style="padding:5px 0; border-bottom:1px dashed var(--border); display:flex; justify-content:space-between; gap:8px;">
            <span>4. Cắt động 31-bit tại offset ${tr.offset}:</span>
            <strong style="font-family:monospace;">0x${tr.selected4BytesHex} &rarr; ${tr.truncatedInt}</strong>
          </div>
          <div style="padding:6px 0; display:flex; justify-content:space-between; align-items:center;">
            <span>5. Kết quả Modulo 10^${tr.digits}:</span>
            <strong style="font-family:monospace; font-size:17px; color:var(--primary);">${formatOtpReadable(tr.otp)}</strong>
          </div>
        </div>
      `;
    } catch (err) {
      outBox.innerHTML = `<p style="font-size:11px; color:#ef4444; margin:0;">Lỗi giải phẫu: ${escapeHtml(err.message)}</p>`;
    }
  }

  function runOcraSignUI() {
    ensureRealDefaultSecretInLab();
    const sec = document.getElementById("kauth-ocra-secret")?.value.trim() || "";
    const rec = document.getElementById("kauth-ocra-recipient")?.value.trim() || "";
    const amt = document.getElementById("kauth-ocra-amount")?.value.trim() || "";
    const ref = document.getElementById("kauth-ocra-ref")?.value.trim() || "";
    const out = document.getElementById("kauth-ocra-output");
    if (!out) return;

    if (!sec || (!rec && !amt && !ref)) {
      out.innerHTML = `<p style="font-size:11px; color:var(--text-muted); margin:6px 0 0;">Nhập thông tin giao dịch/hồ sơ thực tế ở trên để tính mã xác thực OCRA 8 chữ số.</p>`;
      return;
    }

    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const res = computeOCRATransactionOTP(sec, rec, amt, ref, nowSec, 30, 8);
      out.innerHTML = `
        <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); font-size:11px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>Băm ngữ cảnh SHA-256:</span>
            <code style="font-size:10px;">${res.contextSha256Hex.slice(0, 24)}...</code>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Mã Ký Giao Dịch OCRA (8 số):</span>
            <strong style="font-family:monospace; font-size:17px; color:#059669;">${formatOtpReadable(res.otp)}</strong>
          </div>
        </div>
      `;
    } catch (err) {
      out.innerHTML = `<p style="font-size:11px; color:#ef4444; margin:0;">Lỗi OCRA: ${escapeHtml(err.message)}</p>`;
    }
  }

  function renderRealQrCode(containerEl, textData) {
    if (!containerEl) return;
    containerEl.innerHTML = "";
    if (typeof window.QRCode === "function") {
      new window.QRCode(containerEl, {
        text: textData,
        width: 188,
        height: 188,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0
      });
    } else {
      containerEl.innerHTML = `<div style="font-size:11px; color:#0f172a; padding:12px;">${escapeHtml(textData)}</div>`;
    }
  }

  // ==========================================================================
  // 8. OFFLINE QR DECODING ENGINE (jsQR + BarcodeDetector + Live Camera Stream)
  // ==========================================================================
  function decodeQrFromCanvasContext(ctx, width, height) {
    if (width <= 0 || height <= 0) return null;
    if (typeof window.jsQR === "function") {
      const imgData = ctx.getImageData(0, 0, width, height);
      const code = window.jsQR(imgData.data, width, height, {
        inversionAttempts: "attemptBoth"
      });
      if (code && code.data) {
        return code.data.trim();
      }
      // Second pass: cropped center region (68% x 68%) for small or distant QR codes inside the large scan box
      const cropW = Math.floor(width * 0.68);
      const cropH = Math.floor(height * 0.68);
      if (cropW >= 120 && cropH >= 120) {
        const startX = Math.floor((width - cropW) / 2);
        const startY = Math.floor((height - cropH) / 2);
        const centerData = ctx.getImageData(startX, startY, cropW, cropH);
        const centerCode = window.jsQR(centerData.data, cropW, cropH, {
          inversionAttempts: "attemptBoth"
        });
        if (centerCode && centerCode.data) {
          return centerCode.data.trim();
        }
      }
    }
    return null;
  }

  function processDecodedQrString(rawText) {
    const cleaned = String(rawText || "").trim();
    if (!cleaned) return false;
    const uriInput = document.getElementById("kauth-import-uri-input");
    if (uriInput) uriInput.value = cleaned;

    if (
      cleaned.toLowerCase().startsWith("otpauth://") ||
      cleaned.toLowerCase().startsWith("otpauth-migration://")
    ) {
      window.KryptoAuthenticator.importUriOrMigrationUI(cleaned);
      return true;
    } else if (/^[A-Z2-7\s\-=]{12,}$/i.test(cleaned)) {
      // Raw Base32 secret QR
      const secEl = document.getElementById("kauth-add-secret");
      if (secEl) secEl.value = Base32.normalize(cleaned);
      window.KryptoAuthenticator.switchSubView("add", document.getElementById("kauth-subbtn-add"));
      notifyUser("✅ Đã quét được Khóa Base32 từ mã QR! Hãy nhập tên dịch vụ và bấm Lưu.");
      return true;
    } else {
      throw new Error("Mã QR không chứa định dạng 2FA (otpauth:// hoặc otpauth-migration://)");
    }
  }

  let isNativeCameraActive = false;
  let isDecodingNativeFrame = false;

  function stopCameraStream() {
    isNativeCameraActive = false;
    isDecodingNativeFrame = false;
    const torchBtn = document.getElementById("kauth-btn-torch");
    if (torchBtn) {
      torchBtn.classList.remove("torch-on");
    }
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      try {
        window.FlutterBridge.postMessage(JSON.stringify({ action: "stop_native_camera" }));
      } catch (_) {}
    }
    if (cameraScanAnimId) {
      cancelAnimationFrame(cameraScanAnimId);
      cameraScanAnimId = null;
    }
    if (activeVideoStream) {
      activeVideoStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (_) {}
      });
      activeVideoStream = null;
    }
    const videoEl = document.getElementById("kauth-camera-video");
    if (videoEl) {
      videoEl.srcObject = null;
    }
  }

  async function startCameraQrStream(facingMode) {
    stopCameraStream();
    currentFacingMode = facingMode || "environment";

    const statusEl = document.getElementById("kauth-camera-status-text");
    const videoEl = document.getElementById("kauth-camera-video");
    const canvasEl = document.getElementById("kauth-camera-canvas");
    if (!videoEl || !canvasEl) return;

    // 1. NATIVE ANDROID CAMERA BRIDGE (100% OFFLINE HARDWARE CAMERA ON ANDROID APK)
    if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
      isNativeCameraActive = true;
      videoEl.style.display = "none";
      canvasEl.style.display = "block";
      canvasEl.style.width = "100%";
      canvasEl.style.height = "100%";
      canvasEl.style.objectFit = "cover";

      if (statusEl) {
        statusEl.textContent = "Đang mở máy ảnh thiết bị (hãy bấm 'Cho phép' nếu được hỏi quyền)...";
      }
      try {
        window.FlutterBridge.postMessage(
          JSON.stringify({
            action: "start_native_camera",
            facing: currentFacingMode === "user" ? "front" : "back"
          })
        );
      } catch (e) {
        if (statusEl) statusEl.textContent = "Lỗi gọi máy ảnh Native: " + e.message;
      }
      return;
    }

    // 2. DESKTOP / WEB BROWSER FALLBACK (WebRTC getUserMedia)
    videoEl.style.display = "block";
    canvasEl.style.display = "none";
    if (statusEl) {
      statusEl.textContent = "Đang khởi động ống kính máy ảnh...";
    }

    try {
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: currentFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      activeVideoStream = stream;
      videoEl.srcObject = stream;
      await videoEl.play();

      if (statusEl) {
        statusEl.textContent = "Đưa mã QR 2FA (hoặc QR Google Authenticator) vào khung ngắm...";
      }

      const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
      const scanFrame = () => {
        if (!activeVideoStream) return;
        if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
          const vw = videoEl.videoWidth || 640;
          const vh = videoEl.videoHeight || 480;
          const targetW = Math.min(640, vw);
          const targetH = Math.round((vh * targetW) / vw);
          canvasEl.width = targetW;
          canvasEl.height = targetH;
          ctx.drawImage(videoEl, 0, 0, targetW, targetH);

          try {
            const qrData = decodeQrFromCanvasContext(ctx, targetW, targetH);
            if (qrData) {
              window.KryptoAuthenticator.closeCameraQrScanner();
              processDecodedQrString(qrData);
              return;
            }
          } catch (scanErr) {
            if (statusEl) statusEl.textContent = scanErr.message;
          }
        }
        cameraScanAnimId = requestAnimationFrame(scanFrame);
      };
      cameraScanAnimId = requestAnimationFrame(scanFrame);
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = `Không mở được luồng video trực tiếp (${escapeHtml(err.message)}).<br>Hãy bấm nút <strong>📸 Chụp Ảnh QR</strong> ngay bên dưới!`;
      }
    }
  }

  // ==========================================================================
  // 9. PUBLIC CONTROLLER EXPOSED TO KRYPTO UI (window.KryptoAuthenticator)
  // ==========================================================================
  window.KryptoAuthenticator = {
    switchSubView(subName, btnEl) {
      document.querySelectorAll(".kauth-sub-btn").forEach((b) => b.classList.remove("active"));
      if (btnEl) btnEl.classList.add("active");
      document.querySelectorAll(".kauth-sub-panel").forEach((p) => {
        p.style.display = p.id === `kauth-panel-${subName}` ? "block" : "none";
      });
      if (subName === "lab") {
        runLabTraceUI();
        runOcraSignUI();
      }
    },

    filterCategory(cat, btnEl) {
      activeCategory = cat;
      document.querySelectorAll(".kauth-cat-chip").forEach((c) => c.classList.remove("active"));
      if (btnEl) btnEl.classList.add("active");
      renderAuthCards();
    },

    onSearchInput(val) {
      searchQuery = val || "";
      renderAuthCards();
    },

    copyOtp(accId) {
      const acc = accounts.find((a) => a.id === accId);
      if (!acc) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const otp =
        acc.otpType === "hotp"
          ? computeHOTPWithTrace(Base32.decode(acc.secret), acc.counter || 0, acc.digits || 6, acc.algorithm || "SHA1").otp
          : computeTOTPWithTrace(acc.secret, nowSec, acc.period || 30, acc.digits || 6, acc.algorithm || "SHA1").otp;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(otp).catch(() => {});
      }
      notifyUser(`✅ Đã sao chép mã 2FA: ${otp} (${acc.issuer})`);
    },

    stepHotp(accId) {
      const acc = accounts.find((a) => a.id === accId);
      if (!acc) return;
      acc.counter = (acc.counter || 0) + 1;
      saveAccounts();
      renderAuthCards();
      notifyUser(`🔢 Đã tăng bộ đếm HOTP lên ${acc.counter}`);
    },

    deleteAccount(accId) {
      const idx = accounts.findIndex((a) => a.id === accId);
      if (idx === -1) return;
      if (accounts[idx].isHsmLinked) {
        notifyUser("🛡️ Tài khoản gắn liền Buồng HSM Cá Nhân không thể xóa.");
        return;
      }
      const name = accounts[idx].issuer;
      accounts.splice(idx, 1);
      saveAccounts();
      renderAuthCards();
      notifyUser(`🗑️ Đã xóa tài khoản ${name}`);
    },

    inspectAccount(accId) {
      const acc = accounts.find((a) => a.id === accId);
      if (!acc) return;
      const secEl = document.getElementById("kauth-lab-secret");
      const ocraSecEl = document.getElementById("kauth-ocra-secret");
      const algoEl = document.getElementById("kauth-lab-algo");
      const digEl = document.getElementById("kauth-lab-digits");
      if (secEl) secEl.value = acc.secret;
      if (ocraSecEl) ocraSecEl.value = acc.secret;
      if (algoEl) algoEl.value = acc.algorithm || "SHA1";
      if (digEl) digEl.value = String(acc.digits || 6);

      const labBtn = document.getElementById("kauth-subbtn-lab");
      this.switchSubView("lab", labBtn);
    },

    showAccountQrModal(accId) {
      const acc = accounts.find((a) => a.id === accId);
      if (!acc) return;
      const uri = buildOtpAuthUri(acc);
      const modal = document.getElementById("kauth-qr-modal-overlay");
      const titleEl = document.getElementById("kauth-qr-modal-title");
      const uriEl = document.getElementById("kauth-qr-modal-uri");
      const boxEl = document.getElementById("kauth-qr-modal-canvas-box");
      if (titleEl) titleEl.textContent = `${acc.issuer} (${acc.accountName})`;
      if (uriEl) uriEl.value = uri;
      renderRealQrCode(boxEl, uri);
      if (modal) {
        modal.style.display = "flex";
        modal.style.opacity = "1";
        modal.style.pointerEvents = "auto";
        modal.classList.add("active", "show");
      }
    },

    closeQrModal() {
      const modal = document.getElementById("kauth-qr-modal-overlay");
      if (modal) {
        modal.classList.remove("active", "show");
        modal.style.opacity = "0";
        modal.style.pointerEvents = "none";
        modal.style.display = "none";
      }
    },

    openCameraQrScanner() {
      const modal = document.getElementById("kauth-camera-modal-overlay");
      if (modal) {
        modal.style.display = "flex";
        modal.style.opacity = "1";
        modal.style.pointerEvents = "auto";
        modal.classList.add("active", "show");
      }
      startCameraQrStream("environment");
    },

    switchCameraFacing() {
      currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
      const torchBtn = document.getElementById("kauth-btn-torch");
      if (torchBtn) torchBtn.classList.remove("torch-on");
      if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
        try {
          window.FlutterBridge.postMessage(JSON.stringify({ action: "switch_native_camera" }));
          return;
        } catch (_) {}
      }
      startCameraQrStream(currentFacingMode);
    },

    toggleCameraTorch() {
      if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
        try {
          window.FlutterBridge.postMessage(JSON.stringify({ action: "toggle_native_camera_torch" }));
          return;
        } catch (_) {}
      }
      if (activeVideoStream) {
        try {
          const track = activeVideoStream.getVideoTracks()[0];
          if (track && typeof track.applyConstraints === "function") {
            const settings = track.getSettings ? track.getSettings() : {};
            const nextTorch = !settings.torch;
            track.applyConstraints({ advanced: [{ torch: nextTorch }] }).then(() => {
              this.onNativeTorchToggled(nextTorch);
            }).catch(() => {});
          }
        } catch (_) {}
      }
    },

    onNativeTorchToggled(isOn) {
      const torchBtn = document.getElementById("kauth-btn-torch");
      if (!torchBtn) return;
      if (isOn) {
        torchBtn.classList.add("torch-on");
      } else {
        torchBtn.classList.remove("torch-on");
      }
    },

    switchScannerToManualInput() {
      this.closeCameraQrScanner();
      this.switchSubView("add", document.getElementById("kauth-subbtn-add"));
      const issuerInput = document.getElementById("kauth-add-issuer");
      if (issuerInput) {
        setTimeout(() => issuerInput.focus(), 120);
      }
    },

    closeCameraQrScanner() {
      stopCameraStream();
      const modal = document.getElementById("kauth-camera-modal-overlay");
      if (modal) {
        modal.classList.remove("active", "show");
        modal.style.opacity = "0";
        modal.style.pointerEvents = "none";
        modal.style.display = "none";
      }
    },

    captureSystemCameraPhoto() {
      this.closeCameraQrScanner();
      if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === "function") {
        try {
          window.FlutterBridge.postMessage(JSON.stringify({ action: "capture_qr_photo_native" }));
          return;
        } catch (_) {}
      }
      const inp = document.getElementById("kauth-qr-camera-capture-input");
      if (inp) inp.click();
    },

    onNativeCameraStarted(ok) {
      const statusEl = document.getElementById("kauth-camera-status-text");
      if (!statusEl) return;
      if (ok) {
        statusEl.textContent = "Đưa mã QR 2FA hoặc Google Authenticator vào vùng quét";
      } else {
        statusEl.innerHTML = "⚠️ Không thể mở máy ảnh (vui lòng cấp quyền Máy ảnh cho Krypto trong Cài đặt).";
      }
    },

    onNativeCameraFrame(b64Jpeg) {
      if (!isNativeCameraActive || isDecodingNativeFrame || !b64Jpeg) return;
      const canvasEl = document.getElementById("kauth-camera-canvas");
      if (!canvasEl) return;
      isDecodingNativeFrame = true;

      const img = new Image();
      img.onload = () => {
        try {
          if (!isNativeCameraActive) {
            isDecodingNativeFrame = false;
            return;
          }
          const w = img.width || 480;
          const h = img.height || 640;
          if (canvasEl.width !== w) canvasEl.width = w;
          if (canvasEl.height !== h) canvasEl.height = h;
          const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, h);

          const qrData = decodeQrFromCanvasContext(ctx, w, h);
          if (qrData) {
            this.closeCameraQrScanner();
            try {
              processDecodedQrString(qrData);
            } catch (qrErr) {
              notifyUser("⚠️ " + qrErr.message);
            }
          }
        } catch (_) {
        } finally {
          isDecodingNativeFrame = false;
        }
      };
      img.onerror = () => {
        isDecodingNativeFrame = false;
      };
      img.src = "data:image/jpeg;base64," + b64Jpeg;
    },

    onNativeCapturedPhotoB64(b64Jpeg) {
      if (!b64Jpeg) return;
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const scales = [1, 800 / Math.max(img.width, img.height, 1), 1200 / Math.max(img.width, img.height, 1)];
          let decodedText = null;
          for (const sc of scales) {
            const w = Math.max(64, Math.round(img.width * sc));
            const h = Math.max(64, Math.round(img.height * sc));
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(img, 0, 0, w, h);
            decodedText = decodeQrFromCanvasContext(ctx, w, h);
            if (decodedText) break;
          }
          if (decodedText) {
            processDecodedQrString(decodedText);
          } else {
            notifyUser("⚠️ Không tìm thấy mã QR trong ảnh chụp. Hãy dùng '📷 Quét QR Máy Ảnh' để bắt nét trực tiếp!");
          }
        } catch (err) {
          notifyUser("⚠️ " + err.message);
        }
      };
      img.src = "data:image/jpeg;base64," + b64Jpeg;
    },

    generateRandomSecretUI() {
      const el = document.getElementById("kauth-add-secret");
      if (el) el.value = Base32.randomSecret(20);
      notifyUser("⚡ Đã sinh khóa bí mật Base32 160-bit chuẩn CSPRNG");
    },

    addManualAccountUI() {
      try {
        const issuer = document.getElementById("kauth-add-issuer")?.value.trim() || "Dịch vụ 2FA";
        const accountName = document.getElementById("kauth-add-account")?.value.trim() || "Tài khoản";
        const secret = Base32.normalize(document.getElementById("kauth-add-secret")?.value || "");
        if (!secret) throw new Error("Vui lòng nhập khóa bí mật Base32");
        const otpType = document.getElementById("kauth-add-type")?.value || "totp";
        const algorithm = document.getElementById("kauth-add-algo")?.value || "SHA1";
        const digits = parseInt(document.getElementById("kauth-add-digits")?.value || "6", 10);
        const category = document.getElementById("kauth-add-category")?.value || "Chung";

        accounts.push({
          id: "acc_" + Date.now(),
          issuer,
          accountName,
          secret,
          otpType,
          algorithm,
          digits,
          period: 30,
          counter: 0,
          category
        });
        saveAccounts();
        renderAuthCards();
        document.getElementById("kauth-add-issuer").value = "";
        document.getElementById("kauth-add-account").value = "";
        document.getElementById("kauth-add-secret").value = "";
        this.switchSubView("live", document.getElementById("kauth-subbtn-live"));
        notifyUser(`✅ Đã thêm tài khoản 2FA: ${issuer}`);
      } catch (err) {
        notifyUser("⚠️ " + err.message);
      }
    },

    importUriOrMigrationUI(directRawUri) {
      const raw = (directRawUri || document.getElementById("kauth-import-uri-input")?.value || "").trim();
      if (!raw) {
        notifyUser("⚠️ Vui lòng quét mã QR hoặc dán chuỗi otpauth:// / otpauth-migration://");
        return;
      }
      try {
        if (raw.toLowerCase().startsWith("otpauth-migration://")) {
          const list = GoogleMigration.decodeUriToAccounts(raw);
          accounts.push(...list);
          saveAccounts();
          renderAuthCards();
          const inp = document.getElementById("kauth-import-uri-input");
          if (inp) inp.value = "";
          this.switchSubView("live", document.getElementById("kauth-subbtn-live"));
          notifyUser(`✅ Đã nhập ${list.length} tài khoản từ mã QR Google Authenticator!`);
        } else {
          const acc = parseOtpAuthUri(raw);
          accounts.push(acc);
          saveAccounts();
          renderAuthCards();
          const inp = document.getElementById("kauth-import-uri-input");
          if (inp) inp.value = "";
          this.switchSubView("live", document.getElementById("kauth-subbtn-live"));
          notifyUser(`✅ Đã thêm tài khoản ${acc.issuer} (${acc.accountName})`);
        }
      } catch (err) {
        notifyUser("⚠️ Lỗi giải mã QR / URI: " + err.message);
      }
    },

    exportGoogleMigrationQrUI() {
      if (accounts.length === 0) {
        notifyUser("⚠️ Chưa có tài khoản nào để xuất mã QR.");
        return;
      }
      try {
        const uri = GoogleMigration.encodeAccountsToUri(accounts);
        const outInput = document.getElementById("kauth-export-migration-uri");
        if (outInput) outInput.value = uri;

        const modal = document.getElementById("kauth-qr-modal-overlay");
        const titleEl = document.getElementById("kauth-qr-modal-title");
        const uriEl = document.getElementById("kauth-qr-modal-uri");
        const boxEl = document.getElementById("kauth-qr-modal-canvas-box");
        if (titleEl) titleEl.textContent = `Google Auth Migration (${accounts.length} tài khoản)`;
        if (uriEl) uriEl.value = uri;
        renderRealQrCode(boxEl, uri);
        if (modal) {
          modal.style.display = "flex";
          modal.style.opacity = "1";
          modal.style.pointerEvents = "auto";
          modal.classList.add("active", "show");
        }
        notifyUser("📱 Quét mã QR này từ Google Authenticator để chuyển toàn bộ tài khoản");
      } catch (err) {
        notifyUser("⚠️ " + err.message);
      }
    },

    decodeQrFromImageFile(inputEl) {
      const file = inputEl?.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = async () => {
          try {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d", { willReadFrequently: true });

            // Try multiple resolutions for reliable QR recognition on high-res mobile screenshots
            const scales = [1, 800 / Math.max(img.width, img.height, 1), 1200 / Math.max(img.width, img.height, 1)];
            let decodedText = null;

            for (const sc of scales) {
              const w = Math.max(64, Math.round(img.width * sc));
              const h = Math.max(64, Math.round(img.height * sc));
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(img, 0, 0, w, h);
              decodedText = decodeQrFromCanvasContext(ctx, w, h);
              if (decodedText) break;
            }

            if (!decodedText && "BarcodeDetector" in window) {
              try {
                const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
                const barcodes = await detector.detect(img);
                if (barcodes && barcodes.length > 0) {
                  decodedText = barcodes[0].rawValue;
                }
              } catch (_) {}
            }

            inputEl.value = "";
            if (decodedText) {
              this.closeCameraQrScanner();
              processDecodedQrString(decodedText);
            } else {
              notifyUser("⚠️ Không tìm thấy mã QR hợp lệ trong bức ảnh này. Vui lòng chụp rõ vùng mã QR!");
            }
          } catch (err) {
            notifyUser("⚠️ " + err.message);
          }
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    },

    runLabTrace: runLabTraceUI,
    runOcraSign: runOcraSignUI,

    async exportEncryptedVaultUI() {
      const pw = document.getElementById("kauth-vault-export-pass")?.value || "";
      try {
        const vaultObj = await encryptVaultAESGCM(accounts, pw);
        const jsonStr = JSON.stringify(vaultObj, null, 2);
        const previewEl = document.getElementById("kauth-vault-json-box");
        if (previewEl) previewEl.value = jsonStr;

        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Krypto_2FA_Vault_${new Date().toISOString().slice(0, 10)}.kryptovault`;
        a.click();
        URL.revokeObjectURL(url);
        notifyUser("🔒 Đã mã hóa AES-256-GCM và xuất tệp .kryptovault");
      } catch (err) {
        notifyUser("⚠️ " + err.message);
      }
    },

    async importEncryptedVaultUI() {
      const pw = document.getElementById("kauth-vault-import-pass")?.value || "";
      const jsonStr = document.getElementById("kauth-vault-json-box")?.value.trim() || "";
      if (!jsonStr) {
        notifyUser("⚠️ Vui lòng chọn tệp .kryptovault hoặc dán JSON vào ô dữ liệu");
        return;
      }
      try {
        const vaultObj = JSON.parse(jsonStr);
        const restored = await decryptVaultAESGCM(vaultObj, pw);
        accounts = restored.filter((a) => a && a.id && !LEGACY_DUMMY_IDS.has(a.id));
        syncWithKryptoPersonalHSM();
        saveAccounts();
        renderAuthCards();
        this.switchSubView("live", document.getElementById("kauth-subbtn-live"));
        notifyUser(`✅ Đã giải mã và khôi phục ${accounts.length} tài khoản 2FA!`);
      } catch (err) {
        notifyUser("⚠️ " + err.message);
      }
    },

    handleVaultFileSelected(inputEl) {
      const file = inputEl?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const box = document.getElementById("kauth-vault-json-box");
        if (box) box.value = String(reader.result || "");
        notifyUser("📂 Đã nạp tệp .kryptovault, hãy nhập mật khẩu để giải mã");
      };
      reader.readAsText(file);
    },

    refreshUI() {
      renderAuthCards();
      tickClocks();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    loadAccounts();
    renderAuthCards();
    runLabTraceUI();
    runOcraSignUI();
    tickClocks();
    setInterval(tickClocks, 500);
  });
})();
