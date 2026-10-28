# -*- coding: utf-8 -*-
"""
Core Authenticator Cryptographic Engine
Standards implemented:
- RFC 4648: Base32 Encoding/Decoding with human-input normalization
- RFC 4226: HOTP (HMAC-Based One-Time Password Algorithm)
- RFC 6238: TOTP (Time-Based One-Time Password Algorithm: SHA1, SHA256, SHA512)
- RFC 6287: OCRA / Transaction-Context Challenge-Response OTP
- Google Authenticator Key Uri Format (otpauth://totp/... & otpauth://hotp/...)
- Google Authenticator Migration Protobuf Format (otpauth-migration://offline?data=...)
- NIST SP 800-38D / SP 800-132: AES-256-GCM + PBKDF2-HMAC-SHA256 Encrypted Vault
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import time
import urllib.parse
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


# ============================================================================
# 1. BASE32 CODEC (RFC 4648)
# ============================================================================

class Base32Codec:
    """RFC 4648 Base32 encoder/decoder with normalization for user-entered keys."""

    ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    @classmethod
    def normalize(cls, b32_str: str) -> str:
        """Remove spaces, hyphens, padding and convert to uppercase."""
        cleaned = (
            b32_str.strip()
            .replace(" ", "")
            .replace("-", "")
            .replace("=", "")
            .upper()
        )
        for ch in cleaned:
            if ch not in cls.ALPHABET:
                raise ValueError(f"Ký tự không hợp lệ trong chuỗi Base32: '{ch}'")
        return cleaned

    @classmethod
    def decode(cls, b32_str: str) -> bytes:
        """Decode a Base32 string (with or without '=' padding) into raw bytes."""
        cleaned = cls.normalize(b32_str)
        if not cleaned:
            return b""
        pad_len = (8 - (len(cleaned) % 8)) % 8
        padded = cleaned + ("=" * pad_len)
        return base64.b32decode(padded, casefold=True)

    @classmethod
    def encode(cls, raw_bytes: bytes, with_padding: bool = False) -> str:
        """Encode raw bytes into Base32 string."""
        encoded = base64.b32encode(raw_bytes).decode("ascii")
        return encoded if with_padding else encoded.rstrip("=")

    @classmethod
    def generate_secret(cls, num_bytes: int = 20) -> str:
        """Generate a cryptographically secure random Base32 secret (default 160-bit / 20 bytes)."""
        return cls.encode(secrets.token_bytes(num_bytes), with_padding=False)


# ============================================================================
# 2. HOTP ENGINE (RFC 4226)
# ============================================================================

@dataclass
class OTPTrace:
    """Detailed step-by-step mathematical trace of an OTP calculation."""
    algorithm: str
    digits: int
    counter: int
    counter_hex: str
    secret_hex: str
    hmac_hex: str
    offset: int
    selected_4bytes_hex: str
    truncated_int_31bit: int
    otp: str


class HOTPEngine:
    """IETF RFC 4226 HMAC-Based One-Time Password Engine."""

    HASH_MAP = {
        "SHA1": hashlib.sha1,
        "SHA256": hashlib.sha256,
        "SHA512": hashlib.sha512,
    }

    @classmethod
    def compute_with_trace(
        cls,
        secret_bytes: bytes,
        counter: int,
        digits: int = 6,
        algorithm: str = "SHA1",
    ) -> OTPTrace:
        """Compute HOTP and return complete intermediate values for verification and inspection."""
        if counter < 0:
            raise ValueError("Giá trị bộ đếm (counter) phải >= 0")
        if digits not in (6, 7, 8):
            raise ValueError("Số chữ số OTP phải thuộc {6, 7, 8}")

        algo_norm = algorithm.upper().replace("-", "")
        if algo_norm not in cls.HASH_MAP:
            raise ValueError(f"Thuật toán băm không được hỗ trợ: {algorithm}")

        # Step 1: 8-byte Big-Endian counter
        counter_bytes = struct.pack(">Q", counter)
        counter_hex = counter_bytes.hex().upper()

        # Step 2: Compute HMAC(K, C)
        digest = hmac.new(secret_bytes, counter_bytes, cls.HASH_MAP[algo_norm]).digest()
        hmac_hex = digest.hex()

        # Step 3: Dynamic Truncation (DT)
        offset = digest[-1] & 0x0F
        selected_4bytes = digest[offset : offset + 4]
        code_int = (
            ((selected_4bytes[0] & 0x7F) << 24)
            | ((selected_4bytes[1] & 0xFF) << 16)
            | ((selected_4bytes[2] & 0xFF) << 8)
            | (selected_4bytes[3] & 0xFF)
        )

        # Step 4: Modulo 10^d and zero-pad
        modulo_val = code_int % (10 ** digits)
        otp_str = str(modulo_val).zfill(digits)

        return OTPTrace(
            algorithm=algo_norm,
            digits=digits,
            counter=counter,
            counter_hex=counter_hex,
            secret_hex=secret_bytes.hex(),
            hmac_hex=hmac_hex,
            offset=offset,
            selected_4bytes_hex=selected_4bytes.hex(),
            truncated_int_31bit=code_int,
            otp=otp_str,
        )

    @classmethod
    def generate(
        cls,
        secret_b32_or_bytes: str | bytes,
        counter: int,
        digits: int = 6,
        algorithm: str = "SHA1",
    ) -> str:
        secret_bytes = (
            Base32Codec.decode(secret_b32_or_bytes)
            if isinstance(secret_b32_or_bytes, str)
            else secret_b32_or_bytes
        )
        return cls.compute_with_trace(secret_bytes, counter, digits, algorithm).otp


# ============================================================================
# 3. TOTP ENGINE (RFC 6238)
# ============================================================================

class TOTPEngine:
    """IETF RFC 6238 Time-Based One-Time Password Engine."""

    @classmethod
    def time_counter(cls, timestamp: Optional[float] = None, period: int = 30, t0: int = 0) -> Tuple[int, int]:
        """Return (time_step_counter, remaining_seconds_in_step)."""
        ts = int(time.time() if timestamp is None else timestamp)
        elapsed = ts - t0
        counter = elapsed // period
        remaining = period - (elapsed % period)
        return counter, remaining

    @classmethod
    def compute_with_trace(
        cls,
        secret_b32_or_bytes: str | bytes,
        timestamp: Optional[float] = None,
        period: int = 30,
        digits: int = 6,
        algorithm: str = "SHA1",
        t0: int = 0,
    ) -> Dict[str, Any]:
        """Compute current TOTP, next-window TOTP, remaining time, and full trace."""
        secret_bytes = (
            Base32Codec.decode(secret_b32_or_bytes)
            if isinstance(secret_b32_or_bytes, str)
            else secret_b32_or_bytes
        )
        ts = int(time.time() if timestamp is None else timestamp)
        counter, remaining = cls.time_counter(ts, period=period, t0=t0)
        trace = HOTPEngine.compute_with_trace(secret_bytes, counter, digits=digits, algorithm=algorithm)
        next_trace = HOTPEngine.compute_with_trace(secret_bytes, counter + 1, digits=digits, algorithm=algorithm)

        return {
            "timestamp": ts,
            "period": period,
            "remaining_seconds": remaining,
            "otp": trace.otp,
            "next_otp": next_trace.otp,
            "trace": asdict(trace),
        }

    @classmethod
    def generate(
        cls,
        secret_b32_or_bytes: str | bytes,
        timestamp: Optional[float] = None,
        period: int = 30,
        digits: int = 6,
        algorithm: str = "SHA1",
        t0: int = 0,
    ) -> str:
        return cls.compute_with_trace(
            secret_b32_or_bytes, timestamp=timestamp, period=period, digits=digits, algorithm=algorithm, t0=t0
        )["otp"]

    @classmethod
    def verify(
        cls,
        secret_b32_or_bytes: str | bytes,
        candidate_otp: str,
        timestamp: Optional[float] = None,
        period: int = 30,
        digits: int = 6,
        algorithm: str = "SHA1",
        window: int = 1,
    ) -> Tuple[bool, Optional[int]]:
        """
        Verify candidate OTP within clock skew tolerance [-window, +window].
        Returns (is_valid, matched_step_delta).
        """
        secret_bytes = (
            Base32Codec.decode(secret_b32_or_bytes)
            if isinstance(secret_b32_or_bytes, str)
            else secret_b32_or_bytes
        )
        cleaned_candidate = candidate_otp.strip().replace(" ", "")
        base_counter, _ = cls.time_counter(timestamp, period=period)

        for delta in range(-window, window + 1):
            step = base_counter + delta
            if step < 0:
                continue
            expected = HOTPEngine.generate(secret_bytes, step, digits=digits, algorithm=algorithm)
            if hmac.compare_digest(expected, cleaned_candidate):
                return True, delta
        return False, None


# ============================================================================
# 4. OCRA TRANSACTION-BOUND OTP ENGINE (RFC 6287 ADAPTED)
# ============================================================================

class OCRAEngine:
    """
    Context-bound One-Time Password generator for Transaction Signing / Document Approval.
    Binds (Time Step + Recipient/Target + Amount/Value + Reference/DocHash) into HMAC-SHA256.
    """

    SUITE_ID = "OCRA-1:HOTP-SHA256-8:C-QH64-T30S"

    @classmethod
    def generate_transaction_otp(
        cls,
        secret_b32_or_bytes: str | bytes,
        recipient: str,
        amount: str,
        reference: str,
        timestamp: Optional[float] = None,
        period: int = 30,
        digits: int = 8,
    ) -> Dict[str, Any]:
        secret_bytes = (
            Base32Codec.decode(secret_b32_or_bytes)
            if isinstance(secret_b32_or_bytes, str)
            else secret_b32_or_bytes
        )
        counter, remaining = TOTPEngine.time_counter(timestamp, period=period)
        counter_bytes = struct.pack(">Q", counter)

        canonical_context = f"{recipient.strip()}|{amount.strip()}|{reference.strip()}"
        context_digest = hashlib.sha256(canonical_context.encode("utf-8")).digest()

        data_input = (
            cls.SUITE_ID.encode("ascii")
            + b"\x00"
            + counter_bytes
            + context_digest
        )
        mac = hmac.new(secret_bytes, data_input, hashlib.sha256).digest()
        offset = mac[-1] & 0x0F
        selected = mac[offset : offset + 4]
        code_int = (
            ((selected[0] & 0x7F) << 24)
            | ((selected[1] & 0xFF) << 16)
            | ((selected[2] & 0xFF) << 8)
            | (selected[3] & 0xFF)
        )
        otp = str(code_int % (10 ** digits)).zfill(digits)

        return {
            "suite": cls.SUITE_ID,
            "canonical_context": canonical_context,
            "context_sha256_hex": context_digest.hex(),
            "counter": counter,
            "remaining_seconds": remaining,
            "hmac_hex": mac.hex(),
            "offset": offset,
            "otp": otp,
        }


# ============================================================================
# 5. OTPAUTH:// URI PARSER & SERIALIZER
# ============================================================================

@dataclass
class AuthenticatorAccount:
    id: str
    issuer: str
    account_name: str
    secret: str  # Base32 normalized
    otp_type: str = "totp"  # "totp" or "hotp"
    algorithm: str = "SHA1"  # "SHA1", "SHA256", "SHA512"
    digits: int = 6
    period: int = 30
    counter: int = 0
    category: str = "Chung"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_otpauth_uri(self) -> str:
        """Serialize account to standard otpauth:// URI."""
        label = f"{self.issuer}:{self.account_name}" if self.issuer else self.account_name
        encoded_label = urllib.parse.quote(label, safe=":@")
        params: Dict[str, Any] = {
            "secret": Base32Codec.normalize(self.secret),
            "algorithm": self.algorithm.upper(),
            "digits": self.digits,
        }
        if self.issuer:
            params["issuer"] = self.issuer
        if self.otp_type.lower() == "hotp":
            params["counter"] = self.counter
        else:
            params["period"] = self.period

        query = urllib.parse.urlencode(params)
        return f"otpauth://{self.otp_type.lower()}/{encoded_label}?{query}"

    @classmethod
    def from_otpauth_uri(cls, uri: str, category: str = "Chung") -> "AuthenticatorAccount":
        """Parse an otpauth://totp/... or otpauth://hotp/... URI."""
        parsed = urllib.parse.urlparse(uri.strip())
        if parsed.scheme.lower() != "otpauth":
            raise ValueError("URI phải bắt đầu bằng 'otpauth://'")

        otp_type = parsed.netloc.lower()
        if otp_type not in ("totp", "hotp"):
            raise ValueError(f"Loại OTP không hợp lệ: {otp_type}")

        raw_label = urllib.parse.unquote(parsed.path.lstrip("/"))
        qs = urllib.parse.parse_qs(parsed.query)

        if "secret" not in qs or not qs["secret"][0]:
            raise ValueError("URI thiếu tham số bắt buộc 'secret'")

        secret_norm = Base32Codec.normalize(qs["secret"][0])

        if ":" in raw_label:
            label_issuer, account_name = raw_label.split(":", 1)
            label_issuer = label_issuer.strip()
            account_name = account_name.strip()
        else:
            label_issuer = ""
            account_name = raw_label.strip()

        issuer = qs.get("issuer", [label_issuer])[0].strip() or label_issuer or "Dịch vụ 2FA"
        algorithm = qs.get("algorithm", ["SHA1"])[0].upper().replace("-", "")
        digits = int(qs.get("digits", ["6"])[0])
        period = int(qs.get("period", ["30"])[0])
        counter = int(qs.get("counter", ["0"])[0])

        acc_id = hashlib.sha256(f"{issuer}:{account_name}:{secret_norm}".encode("utf-8")).hexdigest()[:12]
        return cls(
            id=acc_id,
            issuer=issuer,
            account_name=account_name or "Tài khoản",
            secret=secret_norm,
            otp_type=otp_type,
            algorithm=algorithm,
            digits=digits,
            period=period,
            counter=counter,
            category=category,
        )


# ============================================================================
# 6. GOOGLE AUTHENTICATOR MIGRATION PROTOBUF CODEC (otpauth-migration://)
# ============================================================================

class GoogleAuthMigrationCodec:
    """
    Pure-Python encoder and decoder for Google Authenticator's
    `otpauth-migration://offline?data=...` Protocol Buffers payload.
    """

    ALGO_TO_PROTO = {"SHA1": 1, "SHA256": 2, "SHA512": 3}
    PROTO_TO_ALGO = {0: "SHA1", 1: "SHA1", 2: "SHA256", 3: "SHA512"}

    DIGITS_TO_PROTO = {6: 1, 8: 2}
    PROTO_TO_DIGITS = {0: 6, 1: 6, 2: 8}

    TYPE_TO_PROTO = {"hotp": 1, "totp": 2}
    PROTO_TO_TYPE = {0: "totp", 1: "hotp", 2: "totp"}

    @staticmethod
    def _encode_varint(value: int) -> bytes:
        out = bytearray()
        val = value & 0xFFFFFFFFFFFFFFFF
        while val > 0x7F:
            out.append((val & 0x7F) | 0x80)
            val >>= 7
        out.append(val & 0x7F)
        return bytes(out)

    @staticmethod
    def _decode_varint(buf: bytes, pos: int) -> Tuple[int, int]:
        result = 0
        shift = 0
        while pos < len(buf):
            b = buf[pos]
            pos += 1
            result |= (b & 0x7F) << shift
            if not (b & 0x80):
                return result, pos
            shift += 7
            if shift >= 64:
                raise ValueError("Varint vượt quá 64 bits")
        raise ValueError("Dữ liệu Protobuf kết thúc bất ngờ khi đọc Varint")

    @classmethod
    def _encode_len_delimited(cls, field_num: int, data: bytes) -> bytes:
        tag = (field_num << 3) | 2
        return cls._encode_varint(tag) + cls._encode_varint(len(data)) + data

    @classmethod
    def _encode_varint_field(cls, field_num: int, value: int) -> bytes:
        tag = (field_num << 3) | 0
        return cls._encode_varint(tag) + cls._encode_varint(value)

    @classmethod
    def encode_migration_uri(cls, accounts: List[AuthenticatorAccount]) -> str:
        """Encode a list of AuthenticatorAccount objects into an otpauth-migration:// URI."""
        payload = bytearray()
        for acc in accounts:
            secret_raw = Base32Codec.decode(acc.secret)
            entry = bytearray()
            entry += cls._encode_len_delimited(1, secret_raw)
            name_str = f"{acc.issuer}:{acc.account_name}" if acc.issuer else acc.account_name
            entry += cls._encode_len_delimited(2, name_str.encode("utf-8"))
            if acc.issuer:
                entry += cls._encode_len_delimited(3, acc.issuer.encode("utf-8"))
            entry += cls._encode_varint_field(4, cls.ALGO_TO_PROTO.get(acc.algorithm.upper(), 1))
            entry += cls._encode_varint_field(5, cls.DIGITS_TO_PROTO.get(acc.digits, 1))
            entry += cls._encode_varint_field(6, cls.TYPE_TO_PROTO.get(acc.otp_type.lower(), 2))
            if acc.otp_type.lower() == "hotp":
                entry += cls._encode_varint_field(7, acc.counter)

            payload += cls._encode_len_delimited(1, bytes(entry))

        # version = 1, batch_size = 1, batch_index = 0, batch_id = random 31-bit
        payload += cls._encode_varint_field(2, 1)
        payload += cls._encode_varint_field(3, 1)
        payload += cls._encode_varint_field(4, 0)
        payload += cls._encode_varint_field(5, 20261028)

        b64_data = base64.b64encode(bytes(payload)).decode("ascii")
        return "otpauth-migration://offline?data=" + urllib.parse.quote(b64_data, safe="")

    @classmethod
    def _parse_otp_parameters(cls, buf: bytes) -> AuthenticatorAccount:
        pos = 0
        secret_raw = b""
        name = ""
        issuer = ""
        algo_enum = 1
        digits_enum = 1
        type_enum = 2
        counter = 0

        while pos < len(buf):
            tag, pos = cls._decode_varint(buf, pos)
            field_num = tag >> 3
            wire_type = tag & 0x07

            if wire_type == 0:
                val, pos = cls._decode_varint(buf, pos)
                if field_num == 4:
                    algo_enum = val
                elif field_num == 5:
                    digits_enum = val
                elif field_num == 6:
                    type_enum = val
                elif field_num == 7:
                    counter = val
            elif wire_type == 2:
                length, pos = cls._decode_varint(buf, pos)
                chunk = buf[pos : pos + length]
                pos += length
                if field_num == 1:
                    secret_raw = chunk
                elif field_num == 2:
                    name = chunk.decode("utf-8", errors="replace")
                elif field_num == 3:
                    issuer = chunk.decode("utf-8", errors="replace")
            else:
                raise ValueError(f"Wire type không hỗ trợ trong OtpParameters: {wire_type}")

        secret_b32 = Base32Codec.encode(secret_raw, with_padding=False)
        if ":" in name and not issuer:
            issuer, account_name = name.split(":", 1)
        elif ":" in name and name.startswith(issuer + ":"):
            account_name = name[len(issuer) + 1 :]
        else:
            account_name = name

        issuer = issuer.strip() or "Google Auth Import"
        account_name = account_name.strip() or "Account"
        acc_id = hashlib.sha256(f"{issuer}:{account_name}:{secret_b32}".encode("utf-8")).hexdigest()[:12]

        return AuthenticatorAccount(
            id=acc_id,
            issuer=issuer,
            account_name=account_name,
            secret=secret_b32,
            otp_type=cls.PROTO_TO_TYPE.get(type_enum, "totp"),
            algorithm=cls.PROTO_TO_ALGO.get(algo_enum, "SHA1"),
            digits=cls.PROTO_TO_DIGITS.get(digits_enum, 6),
            period=30,
            counter=counter,
            category="Google Auth",
        )

    @classmethod
    def decode_migration_uri(cls, migration_uri: str) -> List[AuthenticatorAccount]:
        """Decode an otpauth-migration://offline?data=... URI into AuthenticatorAccount list."""
        cleaned = migration_uri.strip()
        if cleaned.startswith("otpauth-migration://"):
            parsed = urllib.parse.urlparse(cleaned)
            qs = urllib.parse.parse_qs(parsed.query)
            if "data" not in qs or not qs["data"][0]:
                raise ValueError("URI otpauth-migration thiếu tham số 'data'")
            b64_str = urllib.parse.unquote(qs["data"][0])
        else:
            b64_str = urllib.parse.unquote(cleaned)

        b64_str = b64_str.replace(" ", "+")
        pad = (4 - (len(b64_str) % 4)) % 4
        raw_payload = base64.b64decode(b64_str + ("=" * pad))

        accounts: List[AuthenticatorAccount] = []
        pos = 0
        while pos < len(raw_payload):
            tag, pos = cls._decode_varint(raw_payload, pos)
            field_num = tag >> 3
            wire_type = tag & 0x07
            if wire_type == 0:
                _, pos = cls._decode_varint(raw_payload, pos)
            elif wire_type == 2:
                length, pos = cls._decode_varint(raw_payload, pos)
                chunk = raw_payload[pos : pos + length]
                pos += length
                if field_num == 1:
                    accounts.append(cls._parse_otp_parameters(chunk))
            else:
                raise ValueError(f"Wire type không hỗ trợ: {wire_type}")

        return accounts


# ============================================================================
# 7. AES-256-GCM ENCRYPTED AUTHENTICATOR VAULT (.kryptovault)
# ============================================================================

class EncryptedAuthenticatorVault:
    """
    Encrypts and decrypts AuthenticatorAccount lists using PBKDF2-HMAC-SHA256 (600,000 iterations)
    and AES-256-GCM (via cryptography library if installed, with standard NIST SP 800-38D verification).
    """

    FORMAT_ID = "KRYPTO-AUTHENTICATOR-VAULT"
    VERSION = 1
    PBKDF2_ITERATIONS = 600_000

    @classmethod
    def encrypt_vault(cls, accounts: List[AuthenticatorAccount], master_password: str) -> Dict[str, Any]:
        if not master_password or len(master_password) < 4:
            raise ValueError("Mật khẩu bảo vệ Két khóa phải có ít nhất 4 ký tự")

        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        salt = os.urandom(16)
        nonce = os.urandom(12)
        key = hashlib.pbkdf2_hmac(
            "sha256",
            master_password.encode("utf-8"),
            salt,
            cls.PBKDF2_ITERATIONS,
            dklen=32,
        )

        plaintext_Obj = {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "accounts": [asdict(a) for a in accounts],
        }
        plaintext_bytes = json.dumps(plaintext_Obj, ensure_ascii=False).encode("utf-8")
        aad = f"{cls.FORMAT_ID}:v{cls.VERSION}".encode("ascii")

        aesgcm = AESGCM(key)
        ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext_bytes, aad)

        return {
            "format": cls.FORMAT_ID,
            "version": cls.VERSION,
            "kdf": {
                "algorithm": "PBKDF2-HMAC-SHA256",
                "iterations": cls.PBKDF2_ITERATIONS,
                "salt_b64": base64.b64encode(salt).decode("ascii"),
            },
            "cipher": {
                "algorithm": "AES-256-GCM",
                "nonce_b64": base64.b64encode(nonce).decode("ascii"),
                "tag_bits": 128,
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
            "account_count": len(accounts),
            "ciphertext_b64": base64.b64encode(ciphertext_with_tag).decode("ascii"),
        }

    @classmethod
    def decrypt_vault(cls, vault_dict: Dict[str, Any], master_password: str) -> List[AuthenticatorAccount]:
        if vault_dict.get("format") != cls.FORMAT_ID:
            raise ValueError("Định dạng tệp Két khóa (.kryptovault) không hợp lệ")

        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        kdf_info = vault_dict["kdf"]
        cipher_info = vault_dict["cipher"]
        salt = base64.b64decode(kdf_info["salt_b64"])
        nonce = base64.b64decode(cipher_info["nonce_b64"])
        iterations = int(kdf_info.get("iterations", cls.PBKDF2_ITERATIONS))
        ciphertext_with_tag = base64.b64decode(vault_dict["ciphertext_b64"])

        key = hashlib.pbkdf2_hmac(
            "sha256",
            master_password.encode("utf-8"),
            salt,
            iterations,
            dklen=32,
        )
        aad = f"{cls.FORMAT_ID}:v{vault_dict.get('version', 1)}".encode("ascii")

        aesgcm = AESGCM(key)
        try:
            plaintext_bytes = aesgcm.decrypt(nonce, ciphertext_with_tag, aad)
        except Exception as exc:
            raise ValueError("Sai mật khẩu chủ hoặc tệp Két khóa đã bị thay đổi cấu trúc") from exc

        payload = json.loads(plaintext_bytes.decode("utf-8"))
        return [AuthenticatorAccount(**item) for item in payload.get("accounts", [])]
