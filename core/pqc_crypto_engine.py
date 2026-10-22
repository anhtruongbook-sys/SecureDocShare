# -*- coding: utf-8 -*-
"""
pqc_crypto_engine.py: ĐỘNG CƠ MÃ HÓA HẬU LƯỢNG TỬ TÍCH HỢP (DROP-IN PQC ENGINE)
Chuẩn mực:
- NIST FIPS 203 (ML-KEM-768: pk=1184B, sk=2400B, ct=1088B, SharedSecret=32B)
- NIST FIPS 204 (ML-DSA-65: Chữ ký số hậu lượng tử tùy chọn)
- AES-256-GCM (DEM mã hóa dữ liệu xác thực) + PBKDF2-HMAC-SHA512 + SHAKE256 KDF
- Kiến trúc Triple-Unlock Envelope (SECDOC_PQC_V2):
  Cho phép giải mã tệp bằng 1 trong 3 phương thức độc lập:
    (1) Mật khẩu người dùng (Password)
    (2) Khóa bí mật Hậu lượng tử của Người nhận (Recipient ML-KEM-768 Secret Key)
    (3) Khóa Master Key của Tổ chức / Hệ thống (Master Key ML-KEM-768 / Shamir Seed)
- Tương thích ngược 100% với định dạng SECDOC_V1 của CryptoEngine hiện có.
"""

import base64
import hashlib
import json
import os
import secrets
import sys
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Thử nạp động cơ biên dịch C/Rust pqcrypto để tăng tốc phần cứng (nếu có)
try:
    from pqcrypto.kem import ml_kem_768 as _native_ml_kem_768
    HAS_NATIVE_PQCRYPTO = True
except ImportError:
    _native_ml_kem_768 = None
    HAS_NATIVE_PQCRYPTO = False

# ============================================================================
# HẰNG SỐ ĐỊNH DẠNG GÓI TIN
# ============================================================================
MAGIC_V1 = b"SECDOC_V1"
MAGIC_PQC_V2 = b"SECDOC_PQC_V2"
PBKDF2_ITERATIONS = 600000
SALT_SIZE = 32
NONCE_SIZE = 12


# ============================================================================
# LÕI TOÁN HỌC FIPS 203 ML-KEM-768 ĐỘC LẬP (ZERO-DEPENDENCY FALLBACK)
# Tương thích nhị phân từng bit (Bit-exact) với chuẩn NIST FIPS 203 & pqcrypto
# ============================================================================
def _bitrev7(x: int) -> int:
    res = 0
    for _ in range(7):
        res = (res << 1) | (x & 1)
        x >>= 1
    return res


class FIPS203MLKEM768Core:
    """
    Cài đặt chuẩn bit-exact NIST FIPS 203 cho ML-KEM-768 (k=3, eta1=2, eta2=2, du=10, dv=4).
    Đảm bảo ứng dụng chạy được trên mọi môi trường (kể cả khi không có thư viện C pqcrypto)
    và tương thích nhị phân 100% với C/Rust pqcrypto cũng như JavaScript Web Engine.
    """
    Q = 3329
    K = 3
    PK_SIZE = 1184
    SK_SIZE = 2400
    CT_SIZE = 1088

    ZETAS = [pow(17, _bitrev7(i), 3329) for i in range(128)]
    GAMMAS = [pow(17, 2 * _bitrev7(i) + 1, 3329) for i in range(128)]
    N_INV = 3303  # 128^-1 mod 3329

    @classmethod
    def ntt(cls, f: List[int]) -> List[int]:
        f_hat = list(f)
        k = 1
        length = 128
        while length >= 2:
            for start in range(0, 256, 2 * length):
                zeta = cls.ZETAS[k]
                k += 1
                for j in range(start, start + length):
                    t = (zeta * f_hat[j + length]) % cls.Q
                    f_hat[j + length] = (f_hat[j] - t) % cls.Q
                    f_hat[j] = (f_hat[j] + t) % cls.Q
            length >>= 1
        return f_hat

    @classmethod
    def inv_ntt(cls, f_hat: List[int]) -> List[int]:
        f = list(f_hat)
        k = 127
        length = 2
        while length <= 128:
            for start in range(0, 256, 2 * length):
                zeta = cls.ZETAS[k]
                k -= 1
                for j in range(start, start + length):
                    t = f[j]
                    f[j] = (t + f[j + length]) % cls.Q
                    f[j + length] = (zeta * (f[j + length] - t)) % cls.Q
            length <<= 1
        return [(x * cls.N_INV) % cls.Q for x in f]

    @classmethod
    def multiply_ntt(cls, a: List[int], b: List[int]) -> List[int]:
        h = [0] * 256
        for i in range(128):
            a0, a1 = a[2 * i], a[2 * i + 1]
            b0, b1 = b[2 * i], b[2 * i + 1]
            h[2 * i] = (a0 * b0 + a1 * b1 * cls.GAMMAS[i]) % cls.Q
            h[2 * i + 1] = (a0 * b1 + a1 * b0) % cls.Q
        return h

    @classmethod
    def poly_add(cls, a: List[int], b: List[int]) -> List[int]:
        return [(x + y) % cls.Q for x, y in zip(a, b)]

    @classmethod
    def poly_sub(cls, a: List[int], b: List[int]) -> List[int]:
        return [(x - y) % cls.Q for x, y in zip(a, b)]

    @classmethod
    def sample_ntt(cls, rho: bytes, i: int, j: int) -> List[int]:
        stream = hashlib.shake_128(rho + bytes([j, i])).digest(840)
        a_hat: List[int] = []
        idx = 0
        while len(a_hat) < 256:
            d1 = stream[idx] + 256 * (stream[idx + 1] & 0x0F)
            d2 = (stream[idx + 1] >> 4) + 16 * stream[idx + 2]
            idx += 3
            if d1 < cls.Q:
                a_hat.append(d1)
            if d2 < cls.Q and len(a_hat) < 256:
                a_hat.append(d2)
        return a_hat

    @classmethod
    def sample_cbd2(cls, buf: bytes) -> List[int]:
        f = [0] * 256
        for i in range(128):
            b = buf[i]
            x0 = (b & 1) + ((b >> 1) & 1)
            y0 = ((b >> 2) & 1) + ((b >> 3) & 1)
            x1 = ((b >> 4) & 1) + ((b >> 5) & 1)
            y1 = ((b >> 6) & 1) + ((b >> 7) & 1)
            f[2 * i] = (x0 - y0) % cls.Q
            f[2 * i + 1] = (x1 - y1) % cls.Q
        return f

    @staticmethod
    def byte_encode(poly: List[int], d: int) -> bytes:
        """FIPS 203 Algorithm 5: ByteEncode_d (d in {1, 4, 10, 12})."""
        bits = 0
        for coeff in reversed(poly):
            bits = (bits << d) | (coeff & ((1 << d) - 1))
        return bits.to_bytes(32 * d, byteorder="little")

    @classmethod
    def byte_decode(cls, data: bytes, d: int) -> List[int]:
        """FIPS 203 Algorithm 6: ByteDecode_d."""
        bits = int.from_bytes(data, byteorder="little")
        mask = (1 << d) - 1
        modulus = cls.Q if d == 12 else (1 << d)
        return [((bits >> (i * d)) & mask) % modulus for i in range(256)]

    @classmethod
    def compress(cls, poly: List[int], d: int) -> List[int]:
        """Nén hằng thời gian Compress_d(x) = round((2^d / q) * x) mod 2^d (chính xác 100% cho mọi d in {1, 4, 10})."""
        mask = (1 << d) - 1
        return [((((x << d) + 1664) * 20642679) >> 36) & mask for x in poly]

    @classmethod
    def decompress(cls, poly: List[int], d: int) -> List[int]:
        """Giải nén Decompress_d(y) = round((q / 2^d) * y)."""
        half = 1 << (d - 1)
        return [((y * cls.Q + half) >> d) for y in poly]

    @classmethod
    def keygen_from_seed(cls, seed_64: bytes) -> Tuple[bytes, bytes]:
        """
        Sinh cặp khóa chuẩn FIPS 203 (ek: 1184B, dk: 2400B) từ hạt giống 64 byte (d || z).
        """
        if len(seed_64) != 64:
            raise ValueError("Hạt giống ML-KEM-768 phải dài đúng 64 byte (d || z).")
        d, z = seed_64[:32], seed_64[32:]
        g = hashlib.sha3_512(d + bytes([cls.K])).digest()
        rho, sigma = g[:32], g[32:]

        A_hat = [[cls.sample_ntt(rho, i, j) for j in range(cls.K)] for i in range(cls.K)]
        s = [cls.sample_cbd2(hashlib.shake_256(sigma + bytes([i])).digest(128)) for i in range(cls.K)]
        e = [cls.sample_cbd2(hashlib.shake_256(sigma + bytes([cls.K + i])).digest(128)) for i in range(cls.K)]

        s_hat = [cls.ntt(p) for p in s]
        e_hat = [cls.ntt(p) for p in e]

        t_hat = []
        for i in range(cls.K):
            acc = [0] * 256
            for j in range(cls.K):
                acc = cls.poly_add(acc, cls.multiply_ntt(A_hat[i][j], s_hat[j]))
            t_hat.append(cls.poly_add(acc, e_hat[i]))

        ek = b"".join(cls.byte_encode(p, 12) for p in t_hat) + rho
        dk_pke = b"".join(cls.byte_encode(p, 12) for p in s_hat)
        h_ek = hashlib.sha3_256(ek).digest()
        dk = dk_pke + ek + h_ek + z
        return ek, dk

    @classmethod
    def encaps_internal(cls, ek: bytes, m: bytes) -> Tuple[bytes, bytes]:
        """FIPS 203 Algorithm 17: ML-KEM.Encaps_internal(ek, m) -> (ct: 1088B, K: 32B)."""
        t_hat = [cls.byte_decode(ek[384 * i : 384 * (i + 1)], 12) for i in range(cls.K)]
        rho = ek[1152:1184]

        h_ek = hashlib.sha3_256(ek).digest()
        kr = hashlib.sha3_512(m + h_ek).digest()
        shared_k, r = kr[:32], kr[32:]

        A_hat = [[cls.sample_ntt(rho, i, j) for j in range(cls.K)] for i in range(cls.K)]
        y = [cls.sample_cbd2(hashlib.shake_256(r + bytes([i])).digest(128)) for i in range(cls.K)]
        e1 = [cls.sample_cbd2(hashlib.shake_256(r + bytes([cls.K + i])).digest(128)) for i in range(cls.K)]
        e2 = cls.sample_cbd2(hashlib.shake_256(r + bytes([2 * cls.K])).digest(128))

        y_hat = [cls.ntt(p) for p in y]

        u_polys = []
        for i in range(cls.K):
            acc = [0] * 256
            for j in range(cls.K):
                acc = cls.poly_add(acc, cls.multiply_ntt(A_hat[j][i], y_hat[j]))
            u_polys.append(cls.poly_add(cls.inv_ntt(acc), e1[i]))

        acc_v = [0] * 256
        for j in range(cls.K):
            acc_v = cls.poly_add(acc_v, cls.multiply_ntt(t_hat[j], y_hat[j]))
        mu = cls.decompress(cls.byte_decode(m, 1), 1)
        v_poly = cls.poly_add(cls.poly_add(cls.inv_ntt(acc_v), e2), mu)

        c1 = b"".join(cls.byte_encode(cls.compress(p, 10), 10) for p in u_polys)
        c2 = cls.byte_encode(cls.compress(v_poly, 4), 4)
        return c1 + c2, shared_k

    @classmethod
    def decaps_internal(cls, dk: bytes, ct: bytes) -> bytes:
        """FIPS 203 Algorithm 18: ML-KEM.Decaps_internal(dk, ct) -> K (32B)."""
        dk_pke = dk[:1152]
        ek = dk[1152:2336]
        h_ek = dk[2336:2368]
        z = dk[2368:2400]

        u_polys = [cls.decompress(cls.byte_decode(ct[320 * i : 320 * (i + 1)], 10), 10) for i in range(cls.K)]
        v_poly = cls.decompress(cls.byte_decode(ct[960:1088], 4), 4)
        s_hat = [cls.byte_decode(dk_pke[384 * i : 384 * (i + 1)], 12) for i in range(cls.K)]

        acc = [0] * 256
        for j in range(cls.K):
            acc = cls.poly_add(acc, cls.multiply_ntt(s_hat[j], cls.ntt(u_polys[j])))
        w = cls.poly_sub(v_poly, cls.inv_ntt(acc))
        m_prime = cls.byte_encode(cls.compress(w, 1), 1)

        kr_prime = hashlib.sha3_512(m_prime + h_ek).digest()
        k_prime = kr_prime[:32]
        ct_prime, _ = cls.encaps_internal(ek, m_prime)

        # So sánh hằng thời gian (Constant-time comparison) và Implicit Rejection
        if secrets.compare_digest(ct, ct_prime):
            return k_prime
        return hashlib.shake_256(z + ct).digest(32)


# ============================================================================
# ĐỘNG CƠ MÃ HÓA HẬU LƯỢNG TỬ TÍCH HỢP CHO APP (PQCCryptoEngine)
# ============================================================================
class PQCCryptoEngine:
    """
    Động cơ mã hóa hậu lượng tử Drop-in thay thế/nâng cấp trực tiếp cho CryptoEngine hiện có:
    - Tự động dùng C/Rust pqcrypto nếu có, hoặc dùng FIPS203MLKEM768Core tích hợp sẵn.
    - Hỗ trợ Khóa Master Key cố định từ Seed 64-byte (hoặc chia sẻ ngưỡng Shamir).
    - Mọi gói tin mã hóa đều có thể mở bằng:
      (1) Mật khẩu người dùng (Password)
      (2) Khóa bí mật ML-KEM-768 của người nhận (Recipient SK)
      (3) Khóa Master Key của hệ thống (Master Key SK / Seed)
    """

    # Hạt giống Master Key mặc định dùng khi khởi tạo nhanh (Trong sản xuất, nạp từ biến môi trường / HSM / Shamir)
    DEFAULT_MASTER_SEED_HEX = (
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
    )

    @classmethod
    def derive_key_pair_from_master_seed(cls, master_seed_64b: bytes, domain: str = "MASTER_ESCROW", index: int = 0) -> Tuple[bytes, bytes]:
        """
        Từ 1 Master Seed 64-byte, sinh tất định cặp khóa chuẩn FIPS 203 (pk: 1184B, sk: 2400B).
        """
        if len(master_seed_64b) != 64:
            raise ValueError("Master Seed phải có độ dài đúng 64 byte (512-bit).")
        ctx = f"SECDOC-PQC-V2|{domain}|{index}".encode("utf-8")
        derived_seed = hashlib.shake_256(master_seed_64b + ctx).digest(64)
        return FIPS203MLKEM768Core.keygen_from_seed(derived_seed)

    @classmethod
    def get_default_master_public_key(cls) -> bytes:
        """Lấy khóa công khai Master Key (1184 byte) để nhúng vào ứng dụng."""
        seed = bytes.fromhex(cls.DEFAULT_MASTER_SEED_HEX)
        pk, _ = cls.derive_key_pair_from_master_seed(seed, "MASTER_ESCROW", 0)
        return pk

    @classmethod
    def get_default_master_secret_key(cls) -> bytes:
        """Lấy khóa bí mật Master Key (2400 byte) dành riêng cho Quản trị viên."""
        seed = bytes.fromhex(cls.DEFAULT_MASTER_SEED_HEX)
        _, sk = cls.derive_key_pair_from_master_seed(seed, "MASTER_ESCROW", 0)
        return sk

    @staticmethod
    def kem_keygen() -> Tuple[bytes, bytes]:
        """Sinh cặp khóa ML-KEM-768 ngẫu nhiên (pk: 1184B, sk: 2400B)."""
        if HAS_NATIVE_PQCRYPTO:
            pk, sk = _native_ml_kem_768.keygen()
            return bytes(pk), bytes(sk)
        return FIPS203MLKEM768Core.keygen_from_seed(os.urandom(64))

    @staticmethod
    def kem_encaps(pk_bytes: bytes) -> Tuple[bytes, bytes]:
        """Đóng gói khóa chung 256-bit bằng ML-KEM-768 -> (ct: 1088B, ss: 32B)."""
        if HAS_NATIVE_PQCRYPTO:
            ct, ss = _native_ml_kem_768.encaps(pk_bytes)
            return bytes(ct), bytes(ss)
        return FIPS203MLKEM768Core.encaps_internal(pk_bytes, os.urandom(32))

    @staticmethod
    def kem_decaps(sk_bytes: bytes, ct_bytes: bytes) -> bytes:
        """Giải mã bản mã ML-KEM-768 -> ss (32B)."""
        if HAS_NATIVE_PQCRYPTO:
            return bytes(_native_ml_kem_768.decaps(sk_bytes, ct_bytes))
        return FIPS203MLKEM768Core.decaps_internal(sk_bytes, ct_bytes)

    @staticmethod
    def derive_password_key(password: str, salt: bytes, iterations: int = PBKDF2_ITERATIONS) -> bytes:
        """Dẫn xuất khóa 256-bit từ mật khẩu bằng PBKDF2-HMAC-SHA512 (tương thích WebCrypto)."""
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA512(),
            length=32,
            salt=salt,
            iterations=iterations,
            backend=default_backend(),
        )
        return kdf.derive(password.encode("utf-8"))

    @classmethod
    def encrypt_bytes(
        cls,
        plaintext: bytes,
        password: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        recipient_pqc_pk: Optional[bytes] = None,
        master_pqc_pk: Optional[bytes] = None,
    ) -> bytes:
        """
        Mã hóa dữ liệu theo kiến trúc Hậu lượng tử Đa Nhánh (SECDOC_PQC_V2):
        - Dữ liệu gốc được mã hóa 1 lần bằng khóa ngẫu nhiên DEK 256-bit (AES-256-GCM).
        - DEK được đóng gói đồng thời vào:
          1) Nhánh Master Key (ML-KEM-768): Luôn được kích hoạt để đảm bảo Master Key mở được.
          2) Nhánh Password (nếu truyền password): Bao bọc DEK bằng khóa dẫn xuất từ mật khẩu.
          3) Nhánh Recipient PQC (nếu truyền recipient_pqc_pk): Đóng gói DEK bằng ML-KEM-768 cho người nhận.

        Cấu trúc nhị phân xuất ra:
        [MAGIC_PQC_V2 (13B)] [HEADER_LEN (4B BE)] [HEADER_JSON (UTF-8)] [DATA_NONCE (12B)] [CIPHERTEXT + 16B TAG]
        """
        dek = os.urandom(32)
        data_nonce = os.urandom(NONCE_SIZE)

        # Chuẩn bị nhánh Master Key (luôn bật)
        active_master_pk = master_pqc_pk or cls.get_default_master_public_key()
        ct_master, ss_master = cls.kem_encaps(active_master_pk)
        kek_master = hashlib.shake_256(ss_master + b"|SECDOC-MASTER-WRAP").digest(32)
        nonce_master = os.urandom(NONCE_SIZE)
        wrapped_dek_master = AESGCM(kek_master).encrypt(nonce_master, dek, b"MASTER_BRANCH")

        envelopes: Dict[str, Any] = {
            "master_pqc": {
                "alg": "ML-KEM-768",
                "ct_b64": base64.b64encode(ct_master).decode("ascii"),
                "nonce_b64": base64.b64encode(nonce_master).decode("ascii"),
                "wrapped_dek_b64": base64.b64encode(wrapped_dek_master).decode("ascii"),
            }
        }

        # Nhánh Password (nếu có)
        if password:
            pw_salt = os.urandom(SALT_SIZE)
            pw_kek = cls.derive_password_key(password, pw_salt)
            nonce_pw = os.urandom(NONCE_SIZE)
            wrapped_dek_pw = AESGCM(pw_kek).encrypt(nonce_pw, dek, b"PASSWORD_BRANCH")
            envelopes["password"] = {
                "kdf": "PBKDF2-HMAC-SHA512",
                "iterations": PBKDF2_ITERATIONS,
                "salt_b64": base64.b64encode(pw_salt).decode("ascii"),
                "nonce_b64": base64.b64encode(nonce_pw).decode("ascii"),
                "wrapped_dek_b64": base64.b64encode(wrapped_dek_pw).decode("ascii"),
            }

        # Nhánh Khóa Công khai Hậu lượng tử của Người nhận (nếu có)
        if recipient_pqc_pk:
            ct_rec, ss_rec = cls.kem_encaps(recipient_pqc_pk)
            kek_rec = hashlib.shake_256(ss_rec + b"|SECDOC-RECIPIENT-WRAP").digest(32)
            nonce_rec = os.urandom(NONCE_SIZE)
            wrapped_dek_rec = AESGCM(kek_rec).encrypt(nonce_rec, dek, b"RECIPIENT_BRANCH")
            envelopes["recipient_pqc"] = {
                "alg": "ML-KEM-768",
                "ct_b64": base64.b64encode(ct_rec).decode("ascii"),
                "nonce_b64": base64.b64encode(nonce_rec).decode("ascii"),
                "wrapped_dek_b64": base64.b64encode(wrapped_dek_rec).decode("ascii"),
            }

        header_obj = {
            "version": 2,
            "cipher": "AES-256-GCM",
            "pqc_kem": "FIPS-203-ML-KEM-768",
            "metadata": metadata or {},
            "envelopes": envelopes,
        }
        header_bytes = json.dumps(header_obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        header_len = len(header_bytes).to_bytes(4, byteorder="big")

        # Gắn toàn bộ header_bytes làm AAD để bất kỳ sự chỉnh sửa nào trên Header hoặc Envelopes đều bị phát hiện
        ciphertext = AESGCM(dek).encrypt(data_nonce, plaintext, header_bytes)
        return MAGIC_PQC_V2 + header_len + header_bytes + data_nonce + ciphertext

    @classmethod
    def decrypt_bytes(
        cls,
        payload: bytes,
        password: Optional[str] = None,
        recipient_pqc_sk: Optional[bytes] = None,
        master_pqc_sk: Optional[bytes] = None,
    ) -> Tuple[bytes, Dict[str, Any]]:
        """
        Giải mã đa năng gói tin SECDOC_PQC_V2 (và tương thích ngược với SECDOC_V1):
        - Có thể truyền `password` (người dùng nhập mật khẩu)
        - Hoặc truyền `recipient_pqc_sk` (2400B khóa bí mật ML-KEM-768 của người nhận)
        - Hoặc truyền `master_pqc_sk` (2400B khóa bí mật Master Key của Quản trị viên)
        """
        # 1. Tương thích ngược với SECDOC_V1 cũ
        if payload.startswith(MAGIC_V1):
            if not password:
                raise ValueError("Gói tin SECDOC_V1 cũ yêu cầu mật khẩu để giải mã.")
            return cls._decrypt_legacy_v1(payload, password)

        if not payload.startswith(MAGIC_PQC_V2):
            raise ValueError("Định dạng tệp không hợp lệ (Không phải SECDOC_PQC_V2 hay SECDOC_V1).")

        offset = len(MAGIC_PQC_V2)
        header_len = int.from_bytes(payload[offset : offset + 4], byteorder="big")
        offset += 4

        header_bytes = payload[offset : offset + header_len]
        offset += header_len

        data_nonce = payload[offset : offset + NONCE_SIZE]
        offset += NONCE_SIZE
        ciphertext = payload[offset:]

        header_obj = json.loads(header_bytes.decode("utf-8"))
        envelopes = header_obj.get("envelopes", {})
        dek: Optional[bytes] = None

        # Ưu tiên 1: Giải mã bằng Khóa Master Key (nếu được cung cấp)
        if master_pqc_sk and "master_pqc" in envelopes:
            b_info = envelopes["master_pqc"]
            ct_master = base64.b64decode(b_info["ct_b64"])
            nonce_m = base64.b64decode(b_info["nonce_b64"])
            w_dek = base64.b64decode(b_info["wrapped_dek_b64"])
            ss_master = cls.kem_decaps(master_pqc_sk, ct_master)
            kek_master = hashlib.shake_256(ss_master + b"|SECDOC-MASTER-WRAP").digest(32)
            try:
                dek = AESGCM(kek_master).decrypt(nonce_m, w_dek, b"MASTER_BRANCH")
            except Exception as e:
                raise ValueError("Khóa Master Key không khớp hoặc gói tin đã bị can thiệp!") from e

        # Ưu tiên 2: Giải mã bằng Khóa Bí mật Hậu lượng tử của Người nhận
        elif recipient_pqc_sk and "recipient_pqc" in envelopes:
            b_info = envelopes["recipient_pqc"]
            ct_rec = base64.b64decode(b_info["ct_b64"])
            nonce_r = base64.b64decode(b_info["nonce_b64"])
            w_dek = base64.b64decode(b_info["wrapped_dek_b64"])
            ss_rec = cls.kem_decaps(recipient_pqc_sk, ct_rec)
            kek_rec = hashlib.shake_256(ss_rec + b"|SECDOC-RECIPIENT-WRAP").digest(32)
            try:
                dek = AESGCM(kek_rec).decrypt(nonce_r, w_dek, b"RECIPIENT_BRANCH")
            except Exception as e:
                raise ValueError("Khóa bí mật ML-KEM-768 của người nhận không đúng!") from e

        # Ưu tiên 3: Giải mã bằng Mật khẩu người dùng
        elif password and "password" in envelopes:
            b_info = envelopes["password"]
            pw_salt = base64.b64decode(b_info["salt_b64"])
            nonce_p = base64.b64decode(b_info["nonce_b64"])
            w_dek = base64.b64decode(b_info["wrapped_dek_b64"])
            iters = int(b_info.get("iterations", PBKDF2_ITERATIONS))
            pw_kek = cls.derive_password_key(password, pw_salt, iters)
            try:
                dek = AESGCM(pw_kek).decrypt(nonce_p, w_dek, b"PASSWORD_BRANCH")
            except Exception as e:
                raise ValueError("Mật khẩu không chính xác!") from e
        else:
            raise ValueError("Cần cung cấp Mật khẩu, Khóa Người nhận (recipient_pqc_sk) hoặc Khóa Chủ (master_pqc_sk).")

        try:
            plaintext = AESGCM(dek).decrypt(data_nonce, ciphertext, header_bytes)
        except Exception as e:
            raise ValueError("Xác thực toàn vẹn dữ liệu thất bại: Header hoặc nội dung tệp đã bị chỉnh sửa!") from e

        return plaintext, header_obj.get("metadata", {})

    @classmethod
    def decrypt_with_master_seed(cls, payload: bytes, master_seed_64b: Optional[bytes] = None) -> Tuple[bytes, Dict[str, Any]]:
        """
        Hàm tiện ích cho Quản trị viên: Giải mã bất kỳ gói tin SECDOC_PQC_V2 nào
        chỉ bằng 64-byte Master Seed (hoặc dùng Master Key mặc định của hệ thống).
        """
        if master_seed_64b:
            _, master_sk = cls.derive_key_pair_from_master_seed(master_seed_64b, "MASTER_ESCROW", 0)
        else:
            master_sk = cls.get_default_master_secret_key()
        return cls.decrypt_bytes(payload, master_pqc_sk=master_sk)

    @classmethod
    def _decrypt_legacy_v1(cls, payload: bytes, password: str) -> Tuple[bytes, Dict[str, Any]]:
        """Giải mã tương thích ngược định dạng SECDOC_V1."""
        offset = len(MAGIC_V1)
        salt = payload[offset : offset + SALT_SIZE]
        offset += SALT_SIZE
        nonce = payload[offset : offset + NONCE_SIZE]
        offset += NONCE_SIZE
        meta_len = int.from_bytes(payload[offset : offset + 4], byteorder="big")
        offset += 4
        meta_bytes = payload[offset : offset + meta_len]
        offset += meta_len
        ciphertext = payload[offset:]

        key = cls.derive_password_key(password, salt)
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, meta_bytes)
        metadata = json.loads(meta_bytes.decode("utf-8")) if meta_bytes else {}
        return plaintext, metadata


# ============================================================================
# KIỂM THỬ TỰ ĐỘNG KHI CHẠY TRỰC TIẾP
# ============================================================================
def _self_test() -> None:
    print("=" * 85)
    print("KIỂM ĐỊNH ĐỘNG CƠ MÃ HÓA TÍCH HỢP PQCCryptoEngine (SECDOC_PQC_V2)")
    print("=" * 85)

    # 1. Kiểm tra tương thích nhị phân giữa lõi thuần Python FIPS203MLKEM768Core và C/Rust pqcrypto
    seed = os.urandom(64)
    ek_py, dk_py = FIPS203MLKEM768Core.keygen_from_seed(seed)
    assert len(ek_py) == 1184 and len(dk_py) == 2400

    ct_py, ss_py_enc = FIPS203MLKEM768Core.encaps_internal(ek_py, os.urandom(32))
    assert len(ct_py) == 1088
    ss_py_dec = FIPS203MLKEM768Core.decaps_internal(dk_py, ct_py)
    assert ss_py_enc == ss_py_dec

    if HAS_NATIVE_PQCRYPTO:
        ss_native_dec = bytes(_native_ml_kem_768.decaps(dk_py, ct_py))
        assert ss_py_enc == ss_native_dec
        print("[OK] Lõi thuần Python FIPS203MLKEM768Core tương thích nhị phân 100% với C/Rust pqcrypto.")

    # 2. Kiểm tra mã hóa 1 lần và mở khóa bằng cả 3 phương thức (Password, Recipient PQC Key, Master Key)
    rec_pk, rec_sk = PQCCryptoEngine.kem_keygen()
    secret_doc = "Hồ sơ Thiết kế Kỹ thuật & Bản vẽ Thi công - Bảo mật Hậu lượng tử PQC V2".encode("utf-8")
    meta_in = {"filename": "HoSoKyThuat_2026.pdf", "classification": "CONFIDENTIAL"}

    encrypted_pkg = PQCCryptoEngine.encrypt_bytes(
        plaintext=secret_doc,
        password="MatKhauNguoiDung@2026",
        metadata=meta_in,
        recipient_pqc_pk=rec_pk,
    )
    print(f"[OK] Đã đóng gói SECDOC_PQC_V2: Kích thước gốc {len(secret_doc)} B -> Gói bảo mật {len(encrypted_pkg)} B.")

    # Cách 1: Giải mã bằng mật khẩu
    pt1, m1 = PQCCryptoEngine.decrypt_bytes(encrypted_pkg, password="MatKhauNguoiDung@2026")
    assert pt1 == secret_doc and m1 == meta_in
    print("[OK] Mở khóa Nhánh 1 (Mật khẩu người dùng)                  : Thành công.")

    # Cách 2: Giải mã bằng khóa bí mật ML-KEM-768 của người nhận (không cần mật khẩu)
    pt2, m2 = PQCCryptoEngine.decrypt_bytes(encrypted_pkg, recipient_pqc_sk=rec_sk)
    assert pt2 == secret_doc and m2 == meta_in
    print("[OK] Mở khóa Nhánh 2 (Khóa bí mật ML-KEM-768 của Người nhận) : Thành công.")

    # Cách 3: Giải mã bằng Khóa Master Key của Quản trị viên (không cần mật khẩu & không cần khóa người nhận)
    pt3, m3 = PQCCryptoEngine.decrypt_with_master_seed(encrypted_pkg)
    assert pt3 == secret_doc and m3 == meta_in
    print("[OK] Mở khóa Nhánh 3 (Khóa Master Key Tổ chức)              : Thành công.")
    print("=" * 85)


if __name__ == "__main__":
    _self_test()
