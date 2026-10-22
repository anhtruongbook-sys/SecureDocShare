/**
 * pqc_crypto_engine.js: ĐỘNG CƠ MÃ HÓA HẬU LƯỢNG TỬ ĐỘC LẬP CHO WEB & FLUTTER MOBILE OFFLINE
 * Chuẩn mực:
 * - NIST FIPS 202 (Keccak-f[1600]: SHA3-256, SHA3-512, SHAKE128, SHAKE256 độc lập 100% offline)
 * - NIST FIPS 203 (ML-KEM-768 bit-exact: pk=1184B, sk=2400B, ct=1088B, ss=32B)
 * - Web Crypto API (AES-256-GCM + PBKDF2-HMAC-SHA512)
 * - Tương thích nhị phân 100% hai chiều (Python <-> JavaScript) với định dạng SECDOC_PQC_V2 và SECDOC_V1.
 */

(function (globalScope) {
  "use strict";

  const MAGIC_V1 = new TextEncoder().encode("SECDOC_V1");
  const MAGIC_PQC_V2 = new TextEncoder().encode("SECDOC_PQC_V2");
  const PBKDF2_ITERATIONS = 600000;
  const Q = 3329;
  const K = 3;

  // ==========================================================================
  // 1. KECCAK-f[1600] (FIPS 202: SHA3-256, SHA3-512, SHAKE128, SHAKE256)
  // ==========================================================================
  const RC_LOW = new Uint32Array([
    0x00000001, 0x00008082, 0x0000808a, 0x80008000, 0x0000808b, 0x80000001,
    0x80008081, 0x00008009, 0x0000008a, 0x00000088, 0x80008009, 0x8000000a,
    0x8000808b, 0x0000008b, 0x00008089, 0x00008003, 0x00008002, 0x00000080,
    0x0000800a, 0x8000000a, 0x80008081, 0x00008080, 0x80000001, 0x80008008
  ]);
  const RC_HIGH = new Uint32Array([
    0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000,
    0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
    0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000,
    0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x00000000, 0x80000000
  ]);
  const ROTC = [
    1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44
  ];
  const PILN = [
    10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1
  ];

  function keccakF1600(stateBytes) {
    const sLow = new Uint32Array(25);
    const sHigh = new Uint32Array(25);
    const view = new DataView(stateBytes.buffer, stateBytes.byteOffset, 200);
    for (let i = 0; i < 25; i++) {
      sLow[i] = view.getUint32(i * 8, true);
      sHigh[i] = view.getUint32(i * 8 + 4, true);
    }

    const cLow = new Uint32Array(5);
    const cHigh = new Uint32Array(5);

    for (let round = 0; round < 24; round++) {
      for (let x = 0; x < 5; x++) {
        cLow[x] = sLow[x] ^ sLow[x + 5] ^ sLow[x + 10] ^ sLow[x + 15] ^ sLow[x + 20];
        cHigh[x] = sHigh[x] ^ sHigh[x + 5] ^ sHigh[x + 10] ^ sHigh[x + 15] ^ sHigh[x + 20];
      }
      for (let x = 0; x < 5; x++) {
        const x4 = (x + 4) % 5;
        const x1 = (x + 1) % 5;
        const dLow = cLow[x4] ^ ((cLow[x1] << 1) | (cHigh[x1] >>> 31));
        const dHigh = cHigh[x4] ^ ((cHigh[x1] << 1) | (cLow[x1] >>> 31));
        for (let y = 0; y < 25; y += 5) {
          sLow[x + y] ^= dLow;
          sHigh[x + y] ^= dHigh;
        }
      }

      let curLow = sLow[1];
      let curHigh = sHigh[1];
      for (let i = 0; i < 24; i++) {
        const j = PILN[i];
        const r = ROTC[i];
        const tmpLow = sLow[j];
        const tmpHigh = sHigh[j];
        if (r < 32) {
          sLow[j] = (curLow << r) | (curHigh >>> (32 - r));
          sHigh[j] = (curHigh << r) | (curLow >>> (32 - r));
        } else {
          const r32 = r - 32;
          sLow[j] = (curHigh << r32) | (curLow >>> (32 - r32));
          sHigh[j] = (curLow << r32) | (curHigh >>> (32 - r32));
        }
        curLow = tmpLow;
        curHigh = tmpHigh;
      }

      for (let y = 0; y < 25; y += 5) {
        const tL0 = sLow[y], tL1 = sLow[y + 1], tL2 = sLow[y + 2], tL3 = sLow[y + 3], tL4 = sLow[y + 4];
        const tH0 = sHigh[y], tH1 = sHigh[y + 1], tH2 = sHigh[y + 2], tH3 = sHigh[y + 3], tH4 = sHigh[y + 4];
        sLow[y] = tL0 ^ (~tL1 & tL2);
        sHigh[y] = tH0 ^ (~tH1 & tH2);
        sLow[y + 1] = tL1 ^ (~tL2 & tL3);
        sHigh[y + 1] = tH1 ^ (~tH2 & tH3);
        sLow[y + 2] = tL2 ^ (~tL3 & tL4);
        sHigh[y + 2] = tH2 ^ (~tH3 & tH4);
        sLow[y + 3] = tL3 ^ (~tL4 & tL0);
        sHigh[y + 3] = tH3 ^ (~tH4 & tH0);
        sLow[y + 4] = tL4 ^ (~tL0 & tL1);
        sHigh[y + 4] = tH4 ^ (~tH0 & tH1);
      }

      sLow[0] ^= RC_LOW[round];
      sHigh[0] ^= RC_HIGH[round];
    }

    for (let i = 0; i < 25; i++) {
      view.setUint32(i * 8, sLow[i], true);
      view.setUint32(i * 8 + 4, sHigh[i], true);
    }
  }

  function keccakSponge(rateBytes, domainSuffix, inputBytes, outputLen) {
    const state = new Uint8Array(200);
    let offset = 0;
    while (offset + rateBytes <= inputBytes.length) {
      for (let i = 0; i < rateBytes; i++) state[i] ^= inputBytes[offset + i];
      keccakF1600(state);
      offset += rateBytes;
    }
    const rem = inputBytes.length - offset;
    for (let i = 0; i < rem; i++) state[i] ^= inputBytes[offset + i];
    state[rem] ^= domainSuffix;
    state[rateBytes - 1] ^= 0x80;
    keccakF1600(state);

    const out = new Uint8Array(outputLen);
    let outOffset = 0;
    while (outOffset < outputLen) {
      const block = Math.min(rateBytes, outputLen - outOffset);
      out.set(state.subarray(0, block), outOffset);
      outOffset += block;
      if (outOffset < outputLen) keccakF1600(state);
    }
    return out;
  }

  const sha3_256 = (msg) => keccakSponge(136, 0x06, msg, 32);
  const sha3_512 = (msg) => keccakSponge(72, 0x06, msg, 64);
  const shake128 = (msg, outLen) => keccakSponge(168, 0x1f, msg, outLen);
  const shake256 = (msg, outLen) => keccakSponge(136, 0x1f, msg, outLen);

  // ==========================================================================
  // 2. TOÁN HỌC VÀNH ĐA THỨC FIPS 203 ML-KEM-768
  // ==========================================================================
  function bitrev7(x) {
    let r = 0;
    for (let i = 0; i < 7; i++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    return r;
  }

  function modPow(base, exp, mod) {
    let res = 1;
    let b = base % mod;
    let e = exp;
    while (e > 0) {
      if (e & 1) res = (res * b) % mod;
      b = (b * b) % mod;
      e >>= 1;
    }
    return res;
  }

  const ZETAS = new Int32Array(128);
  const GAMMAS = new Int32Array(128);
  for (let i = 0; i < 128; i++) {
    ZETAS[i] = modPow(17, bitrev7(i), Q);
    GAMMAS[i] = modPow(17, 2 * bitrev7(i) + 1, Q);
  }
  const N_INV = 3303;

  function modQ(x) {
    const r = x % Q;
    return r < 0 ? r + Q : r;
  }

  function ntt(f) {
    const fHat = Int32Array.from(f);
    let k = 1;
    for (let len = 128; len >= 2; len >>= 1) {
      for (let start = 0; start < 256; start += 2 * len) {
        const zeta = ZETAS[k++];
        for (let j = start; j < start + len; j++) {
          const t = modQ(zeta * fHat[j + len]);
          fHat[j + len] = modQ(fHat[j] - t);
          fHat[j] = modQ(fHat[j] + t);
        }
      }
    }
    return fHat;
  }

  function invNtt(fHat) {
    const f = Int32Array.from(fHat);
    let k = 127;
    for (let len = 2; len <= 128; len <<= 1) {
      for (let start = 0; start < 256; start += 2 * len) {
        const zeta = ZETAS[k--];
        for (let j = start; j < start + len; j++) {
          const t = f[j];
          f[j] = modQ(t + f[j + len]);
          f[j + len] = modQ(zeta * (f[j + len] - t));
        }
      }
    }
    for (let i = 0; i < 256; i++) f[i] = modQ(f[i] * N_INV);
    return f;
  }

  function multiplyNtt(a, b) {
    const h = new Int32Array(256);
    for (let i = 0; i < 128; i++) {
      const a0 = a[2 * i], a1 = a[2 * i + 1];
      const b0 = b[2 * i], b1 = b[2 * i + 1];
      h[2 * i] = modQ(a0 * b0 + modQ(a1 * b1) * GAMMAS[i]);
      h[2 * i + 1] = modQ(a0 * b1 + a1 * b0);
    }
    return h;
  }

  function polyAdd(a, b) {
    const r = new Int32Array(256);
    for (let i = 0; i < 256; i++) r[i] = modQ(a[i] + b[i]);
    return r;
  }

  function polySub(a, b) {
    const r = new Int32Array(256);
    for (let i = 0; i < 256; i++) r[i] = modQ(a[i] - b[i]);
    return r;
  }

  function concatBytes(...arrays) {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
      out.set(a, off);
      off += a.length;
    }
    return out;
  }

  function sampleNtt(rho, i, j) {
    const stream = shake128(concatBytes(rho, new Uint8Array([j, i])), 840);
    const aHat = new Int32Array(256);
    let count = 0;
    let idx = 0;
    while (count < 256) {
      const d1 = stream[idx] + 256 * (stream[idx + 1] & 0x0f);
      const d2 = (stream[idx + 1] >> 4) + 16 * stream[idx + 2];
      idx += 3;
      if (d1 < Q) aHat[count++] = d1;
      if (d2 < Q && count < 256) aHat[count++] = d2;
    }
    return aHat;
  }

  function sampleCbd2(buf) {
    const f = new Int32Array(256);
    for (let i = 0; i < 128; i++) {
      const b = buf[i];
      const x0 = (b & 1) + ((b >> 1) & 1);
      const y0 = ((b >> 2) & 1) + ((b >> 3) & 1);
      const x1 = ((b >> 4) & 1) + ((b >> 5) & 1);
      const y1 = ((b >> 6) & 1) + ((b >> 7) & 1);
      f[2 * i] = modQ(x0 - y0);
      f[2 * i + 1] = modQ(x1 - y1);
    }
    return f;
  }

  function byteEncode(poly, d) {
    const out = new Uint8Array(32 * d);
    let bitPos = 0;
    for (let i = 0; i < 256; i++) {
      let val = poly[i] & ((1 << d) - 1);
      for (let b = 0; b < d; b++) {
        if (val & 1) out[bitPos >> 3] |= 1 << (bitPos & 7);
        val >>= 1;
        bitPos++;
      }
    }
    return out;
  }

  function byteDecode(bytes, d) {
    const poly = new Int32Array(256);
    const mod = d === 12 ? Q : 1 << d;
    let bitPos = 0;
    for (let i = 0; i < 256; i++) {
      let val = 0;
      for (let b = 0; b < d; b++) {
        const bit = (bytes[bitPos >> 3] >> (bitPos & 7)) & 1;
        val |= bit << b;
        bitPos++;
      }
      poly[i] = val % mod;
    }
    return poly;
  }

  function compress(poly, d) {
    const out = new Int32Array(256);
    const mask = (1 << d) - 1;
    for (let i = 0; i < 256; i++) {
      const num = (poly[i] << d) + 1664;
      out[i] = Math.floor(num / Q) & mask;
    }
    return out;
  }

  function decompress(poly, d) {
    const out = new Int32Array(256);
    const half = 1 << (d - 1);
    for (let i = 0; i < 256; i++) {
      out[i] = (poly[i] * Q + half) >> d;
    }
    return out;
  }

  // ==========================================================================
  // 3. ML-KEM-768 KEYGEN, ENCAPS, DECAPS (CHUẨN FIPS 203)
  // ==========================================================================
  function mlKem768KeygenFromSeed(seed64) {
    const d = seed64.subarray(0, 32);
    const z = seed64.subarray(32, 64);
    const g = sha3_512(concatBytes(d, new Uint8Array([K])));
    const rho = g.subarray(0, 32);
    const sigma = g.subarray(32, 64);

    const A = [];
    for (let i = 0; i < K; i++) {
      A[i] = [];
      for (let j = 0; j < K; j++) A[i][j] = sampleNtt(rho, i, j);
    }

    const sHat = [];
    const eHat = [];
    for (let i = 0; i < K; i++) {
      sHat.push(ntt(sampleCbd2(shake256(concatBytes(sigma, new Uint8Array([i])), 128))));
      eHat.push(ntt(sampleCbd2(shake256(concatBytes(sigma, new Uint8Array([K + i])), 128))));
    }

    const tHat = [];
    for (let i = 0; i < K; i++) {
      let acc = new Int32Array(256);
      for (let j = 0; j < K; j++) acc = polyAdd(acc, multiplyNtt(A[i][j], sHat[j]));
      tHat.push(polyAdd(acc, eHat[i]));
    }

    const ek = concatBytes(...tHat.map((p) => byteEncode(p, 12)), rho);
    const dkPke = concatBytes(...sHat.map((p) => byteEncode(p, 12)));
    const hEk = sha3_256(ek);
    const dk = concatBytes(dkPke, ek, hEk, z);
    return { publicKey: ek, secretKey: dk };
  }

  function mlKem768EncapsInternal(ek, m32) {
    const tHat = [];
    for (let i = 0; i < K; i++) tHat.push(byteDecode(ek.subarray(384 * i, 384 * (i + 1)), 12));
    const rho = ek.subarray(1152, 1184);
    const hEk = sha3_256(ek);
    const kr = sha3_512(concatBytes(m32, hEk));
    const sharedK = kr.subarray(0, 32);
    const r = kr.subarray(32, 64);

    const A = [];
    for (let i = 0; i < K; i++) {
      A[i] = [];
      for (let j = 0; j < K; j++) A[i][j] = sampleNtt(rho, i, j);
    }

    const yHat = [];
    const e1 = [];
    for (let i = 0; i < K; i++) {
      yHat.push(ntt(sampleCbd2(shake256(concatBytes(r, new Uint8Array([i])), 128))));
      e1.push(sampleCbd2(shake256(concatBytes(r, new Uint8Array([K + i])), 128)));
    }
    const e2 = sampleCbd2(shake256(concatBytes(r, new Uint8Array([2 * K])), 128));

    const uPolys = [];
    for (let i = 0; i < K; i++) {
      let acc = new Int32Array(256);
      for (let j = 0; j < K; j++) acc = polyAdd(acc, multiplyNtt(A[j][i], yHat[j]));
      uPolys.push(polyAdd(invNtt(acc), e1[i]));
    }

    let accV = new Int32Array(256);
    for (let j = 0; j < K; j++) accV = polyAdd(accV, multiplyNtt(tHat[j], yHat[j]));
    const mu = decompress(byteDecode(m32, 1), 1);
    const vPoly = polyAdd(polyAdd(invNtt(accV), e2), mu);

    const c1 = concatBytes(...uPolys.map((p) => byteEncode(compress(p, 10), 10)));
    const c2 = byteEncode(compress(vPoly, 4), 4);
    return { ciphertext: concatBytes(c1, c2), sharedSecret: sharedK };
  }

  function mlKem768DecapsInternal(dk, ct) {
    const dkPke = dk.subarray(0, 1152);
    const ek = dk.subarray(1152, 2336);
    const hEk = dk.subarray(2336, 2368);
    const z = dk.subarray(2368, 2400);

    const uPolys = [];
    for (let i = 0; i < K; i++) {
      uPolys.push(decompress(byteDecode(ct.subarray(320 * i, 320 * (i + 1)), 10), 10));
    }
    const vPoly = decompress(byteDecode(ct.subarray(960, 1088), 4), 4);

    const sHat = [];
    for (let i = 0; i < K; i++) sHat.push(byteDecode(dkPke.subarray(384 * i, 384 * (i + 1)), 12));

    let acc = new Int32Array(256);
    for (let j = 0; j < K; j++) acc = polyAdd(acc, multiplyNtt(sHat[j], ntt(uPolys[j])));
    const w = polySub(vPoly, invNtt(acc));
    const mPrime = byteEncode(compress(w, 1), 1);

    const krPrime = sha3_512(concatBytes(mPrime, hEk));
    const kPrime = krPrime.subarray(0, 32);
    const { ciphertext: ctPrime } = mlKem768EncapsInternal(ek, mPrime);

    let diff = 0;
    for (let i = 0; i < ct.length; i++) diff |= ct[i] ^ ctPrime[i];
    if (diff === 0) return kPrime;
    return shake256(concatBytes(z, ct), 32);
  }

  // ==========================================================================
  // 4. TIỆN ÍCH CHUYỂN ĐỔI & GIẢI MÃ ĐA NHÁNH SECDOC_PQC_V2
  // ==========================================================================
  const DEFAULT_MASTER_SEED_HEX =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" +
    "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a";

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  function b64ToBytes(b64) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function deriveMasterKeyPair(masterSeedHex = DEFAULT_MASTER_SEED_HEX, domain = "MASTER_ESCROW", index = 0) {
    const seedBytes = hexToBytes(masterSeedHex);
    const ctx = new TextEncoder().encode(`SECDOC-PQC-V2|${domain}|${index}`);
    const derivedSeed = shake256(concatBytes(seedBytes, ctx), 64);
    return mlKem768KeygenFromSeed(derivedSeed);
  }

  async function derivePasswordKeyWebCrypto(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
    const subtle = globalScope.crypto.subtle;
    const baseKey = await subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: iterations, hash: "SHA-512" },
      baseKey,
      256
    );
    return new Uint8Array(bits);
  }

  async function aesGcmEncrypt(key32, nonce12, plaintextBytes, aadBytes) {
    const subtle = globalScope.crypto.subtle;
    const cryptoKey = await subtle.importKey("raw", key32, { name: "AES-GCM" }, false, ["encrypt"]);
    const ctBuf = await subtle.encrypt(
      { name: "AES-GCM", iv: nonce12, additionalData: aadBytes, tagLength: 128 },
      cryptoKey,
      plaintextBytes
    );
    return new Uint8Array(ctBuf);
  }

  async function aesGcmDecrypt(key32, nonce12, ciphertextBytes, aadBytes) {
    const subtle = globalScope.crypto.subtle;
    const cryptoKey = await subtle.importKey("raw", key32, { name: "AES-GCM" }, false, ["decrypt"]);
    const ptBuf = await subtle.decrypt(
      { name: "AES-GCM", iv: nonce12, additionalData: aadBytes, tagLength: 128 },
      cryptoKey,
      ciphertextBytes
    );
    return new Uint8Array(ptBuf);
  }

  /**
   * Mã hóa dữ liệu sang gói tin nhị phân SECDOC_PQC_V2 (Tương thích 100% với Python PQCCryptoEngine.encrypt_bytes)
   */
  async function encryptBytes(plaintextBytes, options = {}) {
    const { password = null, metadata = {}, recipientPqcPk = null, masterPqcPk = null } = options;
    const dek = globalScope.crypto.getRandomValues(new Uint8Array(32));
    const dataNonce = globalScope.crypto.getRandomValues(new Uint8Array(12));

    const activeMasterPk = masterPqcPk || deriveMasterKeyPair().publicKey;
    const mSeedMaster = globalScope.crypto.getRandomValues(new Uint8Array(32));
    const { ciphertext: ctMaster, sharedSecret: ssMaster } = mlKem768EncapsInternal(activeMasterPk, mSeedMaster);
    const kekMaster = shake256(concatBytes(ssMaster, new TextEncoder().encode("|SECDOC-MASTER-WRAP")), 32);
    const nonceMaster = globalScope.crypto.getRandomValues(new Uint8Array(12));
    const wrappedDekMaster = await aesGcmEncrypt(
      kekMaster,
      nonceMaster,
      dek,
      new TextEncoder().encode("MASTER_BRANCH")
    );

    const envelopes = {
      master_pqc: {
        alg: "ML-KEM-768",
        ct_b64: bytesToB64(ctMaster),
        nonce_b64: bytesToB64(nonceMaster),
        wrapped_dek_b64: bytesToB64(wrappedDekMaster)
      }
    };

    if (password) {
      const pwSalt = globalScope.crypto.getRandomValues(new Uint8Array(32));
      const pwKek = await derivePasswordKeyWebCrypto(password, pwSalt, PBKDF2_ITERATIONS);
      const noncePw = globalScope.crypto.getRandomValues(new Uint8Array(12));
      const wrappedDekPw = await aesGcmEncrypt(
        pwKek,
        noncePw,
        dek,
        new TextEncoder().encode("PASSWORD_BRANCH")
      );
      envelopes.password = {
        kdf: "PBKDF2-HMAC-SHA512",
        iterations: PBKDF2_ITERATIONS,
        salt_b64: bytesToB64(pwSalt),
        nonce_b64: bytesToB64(noncePw),
        wrapped_dek_b64: bytesToB64(wrappedDekPw)
      };
    }

    if (recipientPqcPk) {
      const mSeedRec = globalScope.crypto.getRandomValues(new Uint8Array(32));
      const { ciphertext: ctRec, sharedSecret: ssRec } = mlKem768EncapsInternal(recipientPqcPk, mSeedRec);
      const kekRec = shake256(concatBytes(ssRec, new TextEncoder().encode("|SECDOC-RECIPIENT-WRAP")), 32);
      const nonceRec = globalScope.crypto.getRandomValues(new Uint8Array(12));
      const wrappedDekRec = await aesGcmEncrypt(
        kekRec,
        nonceRec,
        dek,
        new TextEncoder().encode("RECIPIENT_BRANCH")
      );
      envelopes.recipient_pqc = {
        alg: "ML-KEM-768",
        ct_b64: bytesToB64(ctRec),
        nonce_b64: bytesToB64(nonceRec),
        wrapped_dek_b64: bytesToB64(wrappedDekRec)
      };
    }

    const headerObj = {
      version: 2,
      cipher: "AES-256-GCM",
      pqc_kem: "FIPS-203-ML-KEM-768",
      metadata: metadata,
      envelopes: envelopes
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(headerObj));
    const headerLenBytes = new Uint8Array(4);
    new DataView(headerLenBytes.buffer).setUint32(0, headerBytes.length, false);

    const ciphertext = await aesGcmEncrypt(dek, dataNonce, plaintextBytes, headerBytes);
    return concatBytes(MAGIC_PQC_V2, headerLenBytes, headerBytes, dataNonce, ciphertext);
  }

  /**
   * Giải mã gói tin SECDOC_PQC_V2 bằng Password, Khóa Người nhận (recipientPqcSk), hoặc Khóa Master (masterSeedHex / masterPqcSk)
   */
  async function decryptBytes(payloadBytes, options = {}) {
    const { password = null, recipientPqcSk = null, masterPqcSk = null, masterSeedHex = null } = options;
    const magicStr = new TextDecoder().decode(payloadBytes.subarray(0, 13));
    if (magicStr !== "SECDOC_PQC_V2") {
      throw new Error("Gói tin không có định dạng SECDOC_PQC_V2.");
    }

    let offset = 13;
    const headerLen = new DataView(
      payloadBytes.buffer,
      payloadBytes.byteOffset + offset,
      4
    ).getUint32(0, false);
    offset += 4;

    const headerBytes = payloadBytes.subarray(offset, offset + headerLen);
    offset += headerLen;

    const dataNonce = payloadBytes.subarray(offset, offset + 12);
    offset += 12;
    const ciphertext = payloadBytes.subarray(offset);

    const headerObj = JSON.parse(new TextDecoder().decode(headerBytes));
    const envelopes = headerObj.envelopes || {};
    let dek = null;

    const activeMasterSk = masterPqcSk || (masterSeedHex ? deriveMasterKeyPair(masterSeedHex).secretKey : null);

    if (activeMasterSk && envelopes.master_pqc) {
      const b = envelopes.master_pqc;
      const ssMaster = mlKem768DecapsInternal(activeMasterSk, b64ToBytes(b.ct_b64));
      const kekMaster = shake256(concatBytes(ssMaster, new TextEncoder().encode("|SECDOC-MASTER-WRAP")), 32);
      dek = await aesGcmDecrypt(
        kekMaster,
        b64ToBytes(b.nonce_b64),
        b64ToBytes(b.wrapped_dek_b64),
        new TextEncoder().encode("MASTER_BRANCH")
      );
    } else if (recipientPqcSk && envelopes.recipient_pqc) {
      const b = envelopes.recipient_pqc;
      const ssRec = mlKem768DecapsInternal(recipientPqcSk, b64ToBytes(b.ct_b64));
      const kekRec = shake256(concatBytes(ssRec, new TextEncoder().encode("|SECDOC-RECIPIENT-WRAP")), 32);
      dek = await aesGcmDecrypt(
        kekRec,
        b64ToBytes(b.nonce_b64),
        b64ToBytes(b.wrapped_dek_b64),
        new TextEncoder().encode("RECIPIENT_BRANCH")
      );
    } else if (password && envelopes.password) {
      const b = envelopes.password;
      const pwKek = await derivePasswordKeyWebCrypto(password, b64ToBytes(b.salt_b64), b.iterations || PBKDF2_ITERATIONS);
      dek = await aesGcmDecrypt(
        pwKek,
        b64ToBytes(b.nonce_b64),
        b64ToBytes(b.wrapped_dek_b64),
        new TextEncoder().encode("PASSWORD_BRANCH")
      );
    } else {
      throw new Error("Cần truyền password, recipientPqcSk hoặc masterSeedHex / masterPqcSk.");
    }

    const plaintext = await aesGcmDecrypt(dek, dataNonce, ciphertext, headerBytes);
    return { plaintext, metadata: headerObj.metadata || {} };
  }

  globalScope.PQCCryptoEngineJS = {
    DEFAULT_MASTER_SEED_HEX,
    sha3_256,
    sha3_512,
    shake128,
    shake256,
    mlKem768KeygenFromSeed,
    mlKem768EncapsInternal,
    mlKem768DecapsInternal,
    deriveMasterKeyPair,
    encryptBytes,
    decryptBytes
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.PQCCryptoEngineJS;
  }
})(typeof window !== "undefined" ? window : globalThis);
