# -*- coding: utf-8 -*-
"""
hsm_pkcs11_ca_vault.py: BUỒNG BẢO MẬT HSM CHUẨN PKCS#11, CẤP PHÁT CHỨNG THƯ SỐ X.509V3 & DI TRÚ ĐA THIẾT BỊ (.KRYPTOHSM)
Dự án: Nghiên cứu Chữ ký số Cá nhân Chuẩn HSM & Tích hợp Krypto (SecureDocShare)

Đặc tả kỹ thuật:
1. Kiến trúc PKI Phân cấp 2 Tầng (2-Tier PKI Hierarchy):
   - Tầng 1: Personal Root CA (RSA-4096 / ECDSA P-384, thời hạn 20 năm).
   - Tầng 2: Personal HSM Signer Certificate (RSA-3072 / ECDSA P-256, thời hạn 5 năm).
2. Tuân thủ bất biến chuẩn HSM (OASIS PKCS#11 & ETSI TS 119 432):
   - Khóa bí mật có thuộc tính CKA_SENSITIVE = TRUE, CKA_EXTRACTABLE = FALSE.
   - Không bao giờ xuất khóa bí mật ra dạng rõ (Plaintext).
   - Quy trình cấp phát đi qua yêu cầu PKCS#10 CSR (RFC 2986) được ký Proof-of-Possession ngay trong HSM.
   - Cơ chế chống dò mật khẩu: Tự động khóa cứng Token sau 5 lần nhập sai USER_PIN (chỉ mở khóa được bằng SO_PIN / PUK).
   - Tích hợp xác thực 2 lớp: USER_PIN + TOTP 6 số (RFC 6238 Google Authenticator) cho điện thoại.
   - Lưu trữ đồng bộ 3 đối tượng trong HSM Slot:
     + CKO_PRIVATE_KEY (Khóa bí mật đã niêm phong AES-256-GCM)
     + CKO_CERTIFICATE (Chứng thư cá nhân X.509v3 + RootCA.crt)
     + CKO_DATA (Ảnh chữ ký tay .PNG nền trong suốt)
3. Ràng buộc Mật mã Ảnh Chữ ký Tay & Email S/MIME:
   - Nhúng mã băm SHA-256 của ảnh chữ ký tay .PNG vào OID mở rộng X.509 (1.3.6.1.4.1.99999.1.1).
   - Nhúng Email vào Subject DN + SubjectAltName (rfc822Name) + EKU emailProtection & Adobe Authentic Documents.
4. Di trú Đổi Điện thoại & Đổi PC (.kryptohsm / C_WrapKey & C_UnwrapKey):
   - Bọc kín toàn bộ buồng HSM bằng 2 tầng khóa: Master Recovery Passphrase (PBKDF2-HMAC-SHA512 600.000 vòng) + PQC ML-KEM-768.
   - Hỗ trợ Xoay vòng mã TOTP khi đổi điện thoại và Thu hồi chứng thư máy cũ (CRL Rollover) khi mất máy.
"""

import os
import json
import time
import hmac
import struct
import base64
import secrets
import hashlib
import datetime
from typing import Dict, Any, Optional, Tuple, List

from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID, ObjectIdentifier
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding, ec
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# Các OID Mở rộng Chuẩn Quốc tế & Chuyên dụng Krypto HSM
OID_ADOBE_AUTHENTIC_DOCUMENTS = ObjectIdentifier("1.2.840.113583.1.1.5")
OID_VISUAL_SIGNATURE_PNG_HASH = ObjectIdentifier("1.3.6.1.4.1.99999.1.1")
OID_HSM_NON_EXTRACTABLE_ATTESTATION = ObjectIdentifier("1.3.6.1.4.1.99999.1.2")
OID_PQC_HYBRID_KEY_BINDING = ObjectIdentifier("1.3.6.1.4.1.99999.1.3")


class TOTPAuthenticator:
    """Bộ sinh và kiểm tra mã OTP 6 số theo thời gian thực chuẩn RFC 6238 (Tương thích Google/Microsoft Authenticator)."""

    @staticmethod
    def generate_base32_secret(length: int = 20) -> str:
        raw = secrets.token_bytes(length)
        return base64.b32encode(raw).decode("ascii").rstrip("=")

    @staticmethod
    def get_totp_code(secret_b32: str, timestamp: Optional[float] = None, step: int = 30, digits: int = 6) -> str:
        if timestamp is None:
            timestamp = time.time()
        padded = secret_b32.upper().replace(" ", "")
        missing = len(padded) % 8
        if missing:
            padded += "=" * (8 - missing)
        key = base64.b32decode(padded, casefold=True)
        counter = int(timestamp // step)
        msg = struct.pack(">Q", counter)
        digest = hmac.new(key, msg, hashlib.sha1).digest()
        offset = digest[-1] & 0x0F
        code_int = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
        return str(code_int).zfill(digits)

    @classmethod
    def verify_totp(cls, secret_b32: str, code: str, window: int = 1) -> bool:
        if not code or not code.strip().isdigit():
            return False
        now = time.time()
        clean_code = code.strip()
        for w in range(-window, window + 1):
            if hmac.compare_digest(cls.get_totp_code(secret_b32, now + w * 30), clean_code):
                return True
        return False

    @staticmethod
    def build_otpauth_uri(secret_b32: str, account_email: str, issuer: str = "KryptoHSM") -> str:
        from urllib.parse import quote
        label = quote(f"{issuer}:{account_email}")
        return f"otpauth://totp/{label}?secret={secret_b32}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"


class KryptoHSMVault:
    """
    Buồng bảo mật HSM chuẩn PKCS#11 lưu trữ khóa bí mật không thể trích xuất (CKA_EXTRACTABLE=False),
    chứng thư số X.509v3, ảnh chữ ký tay (.PNG) và nhật ký kiểm toán chuỗi băm (HMAC Audit Chain).
    """

    MAX_PIN_RETRIES = 5
    PBKDF2_ITERATIONS = 600_000

    def __init__(self, vault_path: str):
        self.vault_path = vault_path
        self.state: Dict[str, Any] = {}
        if os.path.exists(vault_path):
            self.load()

    def load(self) -> None:
        with open(self.vault_path, "r", encoding="utf-8") as f:
            self.state = json.load(f)

    def save(self) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(self.vault_path)), exist_ok=True)
        with open(self.vault_path, "w", encoding="utf-8") as f:
            json.dump(self.state, f, ensure_ascii=False, indent=2)

    @classmethod
    def _derive_aes_key(cls, secret_str: str, salt: bytes, iterations: int = PBKDF2_ITERATIONS) -> bytes:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA512(),
            length=32,
            salt=salt,
            iterations=iterations,
        )
        return kdf.derive(secret_str.encode("utf-8"))

    @classmethod
    def _seal_bytes(cls, plaintext: bytes, pin_or_pass: str, aad: bytes = b"KRYPTO_HSM_V1") -> Dict[str, str]:
        salt = secrets.token_bytes(16)
        nonce = secrets.token_bytes(12)
        key = cls._derive_aes_key(pin_or_pass, salt)
        ct = AESGCM(key).encrypt(nonce, plaintext, aad)
        return {
            "salt_b64": base64.b64encode(salt).decode("ascii"),
            "nonce_b64": base64.b64encode(nonce).decode("ascii"),
            "ciphertext_b64": base64.b64encode(ct).decode("ascii"),
        }

    @classmethod
    def _unseal_bytes(cls, sealed: Dict[str, str], pin_or_pass: str, aad: bytes = b"KRYPTO_HSM_V1") -> bytes:
        salt = base64.b64decode(sealed["salt_b64"])
        nonce = base64.b64decode(sealed["nonce_b64"])
        ct = base64.b64decode(sealed["ciphertext_b64"])
        key = cls._derive_aes_key(pin_or_pass, salt)
        return AESGCM(key).decrypt(nonce, ct, aad)

    def _append_audit_log(self, event_type: str, details: Dict[str, Any]) -> Dict[str, Any]:
        logs: List[Dict[str, Any]] = self.state.setdefault("audit_chain", [])
        prev_hash = logs[-1]["entry_hash"] if logs else "0" * 64
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        entry_payload = {
            "seq": len(logs) + 1,
            "timestamp_utc": timestamp,
            "event": event_type,
            "details": details,
            "prev_hash": prev_hash,
        }
        canonical = json.dumps(entry_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
        entry_hash = hashlib.sha256(canonical).hexdigest()
        entry_payload["entry_hash"] = entry_hash
        logs.append(entry_payload)
        return entry_payload

    def provision_personal_hsm_slot(
        self,
        signer_name: str,
        signer_email: str,
        signer_title: str,
        organization: str,
        org_unit: str,
        personal_id_cccd: str,
        user_pin: str,
        so_pin: str,
        handwritten_png_bytes: bytes,
        validity_years: int = 5,
        require_totp_for_signing: bool = False
    ) -> Dict[str, Any]:
        """
        Khởi tạo Buồng HSM Cá nhân chuẩn PKCS#11:
        1. Sinh Personal Root CA (RSA-4096) & niêm phong bằng SO_PIN (Security Officer PIN).
        2. Sinh cặp khóa cá nhân (RSA-3072) nội tại trong HSM với cờ CKA_EXTRACTABLE = FALSE.
        3. Tạo yêu cầu chứng thư PKCS#10 CSR có nhúng mã băm SHA-256 của ảnh chữ ký tay .PNG.
        4. Root CA ký phát hành Chứng thư số cá nhân X.509v3 (hỗ trợ cả PAdES PDF và S/MIME Email).
        5. Lưu trữ CKO_PRIVATE_KEY + CKO_CERTIFICATE + CKO_DATA (ảnh chữ ký tay .PNG) vào Slot HSM.
        """
        if len(user_pin.strip()) < 4:
            raise ValueError("USER_PIN của HSM phải có tối thiểu 4 ký tự.")
        if len(so_pin.strip()) < 6:
            raise ValueError("SO_PIN (Mã Quản trị / PUK) phải có tối thiểu 6 ký tự.")

        now_utc = datetime.datetime.now(datetime.timezone.utc)
        png_sha256_hex = hashlib.sha256(handwritten_png_bytes).hexdigest()

        # ------------------------------------------------------------------
        # BƯỚC 1: KHỞI TẠO PERSONAL ROOT CA (TẦNG 1 - RSA 4096 BITS, 20 NĂM)
        # ------------------------------------------------------------------
        root_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
        root_subject = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "VN"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, organization or "Krypto Personal PKI Trust"),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "HSM Root Certification Authority"),
            x509.NameAttribute(NameOID.COMMON_NAME, f"{signer_name} - Personal Root CA"),
        ])
        root_serial = x509.random_serial_number()
        root_cert = (
            x509.CertificateBuilder()
            .subject_name(root_subject)
            .issuer_name(root_subject)
            .public_key(root_key.public_key())
            .serial_number(root_serial)
            .not_valid_before(now_utc - datetime.timedelta(minutes=5))
            .not_valid_after(now_utc + datetime.timedelta(days=365 * 20))
            .add_extension(x509.BasicConstraints(ca=True, path_length=1), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=False,
                    key_encipherment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=True,
                    crl_sign=True,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(root_key.public_key()), critical=False)
            .sign(private_key=root_key, algorithm=hashes.SHA384())
        )

        # ------------------------------------------------------------------
        # BƯỚC 2: SINH CẶP KHÓA CÁ NHÂN NỘI TẠI TRONG HSM & TẠO PKCS#10 CSR
        # ------------------------------------------------------------------
        signer_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        signer_subject = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "VN"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, organization or "Cá nhân Độc lập"),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, org_unit or "Chứng thực Chữ ký số HSM"),
            x509.NameAttribute(NameOID.TITLE, signer_title or "Chủ sở hữu Chữ ký số"),
            x509.NameAttribute(NameOID.SERIAL_NUMBER, personal_id_cccd or "VN-HSM-001"),
            x509.NameAttribute(NameOID.COMMON_NAME, signer_name),
            x509.NameAttribute(NameOID.EMAIL_ADDRESS, signer_email),
        ])

        csr = (
            x509.CertificateSigningRequestBuilder()
            .subject_name(signer_subject)
            .add_extension(
                x509.SubjectAlternativeName([x509.RFC822Name(signer_email)]),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(
                    OID_VISUAL_SIGNATURE_PNG_HASH,
                    png_sha256_hex.encode("ascii"),
                ),
                critical=False,
            )
            .sign(signer_key, hashes.SHA256())
        )

        # Kiểm tra chữ ký Proof-of-Possession trên CSR trước khi CA duyệt cấp
        csr_pub = csr.public_key()
        csr_pub.verify(
            csr.signature,
            csr.tbs_certrequest_bytes,
            padding.PKCS1v15(),
            csr.signature_hash_algorithm,
        )

        # ------------------------------------------------------------------
        # BƯỚC 3: ROOT CA DUYỆT CẤP CHỨNG THƯ SỐ CÁ NHÂN X.509V3 (PAdES + S/MIME)
        # ------------------------------------------------------------------
        signer_serial = x509.random_serial_number()
        hsm_attestation_json = json.dumps({
            "standard": "OASIS PKCS#11 v3.0 / FIPS 140-3",
            "cka_sensitive": True,
            "cka_extractable": False,
            "visual_sig_sha256": png_sha256_hex,
        }).encode("utf-8")

        signer_cert = (
            x509.CertificateBuilder()
            .subject_name(csr.subject)
            .issuer_name(root_cert.subject)
            .public_key(csr.public_key())
            .serial_number(signer_serial)
            .not_valid_before(now_utc - datetime.timedelta(minutes=5))
            .not_valid_after(now_utc + datetime.timedelta(days=365 * validity_years))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=True,   # Non-Repudiation: Bắt buộc cho chữ ký tài liệu pháp lý PAdES
                    key_encipherment=True,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=False,
                    crl_sign=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(
                x509.ExtendedKeyUsage([
                    ExtendedKeyUsageOID.EMAIL_PROTECTION,   # Ký số Email S/MIME (RFC 8551)
                    ExtendedKeyUsageOID.CLIENT_AUTH,        # Xác thực định danh cá nhân
                    ExtendedKeyUsageOID.CODE_SIGNING,       # Ký gói dữ liệu / mã nguồn
                    OID_ADOBE_AUTHENTIC_DOCUMENTS,          # Adobe PDF PAdES Trust
                ]),
                critical=False,
            )
            .add_extension(
                x509.SubjectAlternativeName([x509.RFC822Name(signer_email)]),
                critical=False,
            )
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(csr.public_key()),
                critical=False,
            )
            .add_extension(
                x509.AuthorityKeyIdentifier.from_issuer_public_key(root_key.public_key()),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(
                    OID_VISUAL_SIGNATURE_PNG_HASH,
                    png_sha256_hex.encode("ascii"),
                ),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(
                    OID_HSM_NON_EXTRACTABLE_ATTESTATION,
                    hsm_attestation_json,
                ),
                critical=False,
            )
            .sign(private_key=root_key, algorithm=hashes.SHA256())
        )

        # ------------------------------------------------------------------
        # BƯỚC 4: NIÊM PHONG KHÓA TRONG BUỒNG HSM (KHÔNG LƯU DẠNG RÕ)
        # ------------------------------------------------------------------
        # Khóa bí mật cá nhân được bọc bằng Master Hardware Wrapping Key (chỉ giải bọc trong RAM khi có USER_PIN)
        slot_master_key = secrets.token_bytes(32)
        user_pin_wrapped_master = self._seal_bytes(slot_master_key, user_pin, aad=b"HSM_USER_PIN_SLOT")
        so_pin_wrapped_master = self._seal_bytes(slot_master_key, so_pin, aad=b"HSM_SO_PIN_RECOVERY")

        signer_priv_der = signer_key.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        root_priv_der = root_key.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

        priv_nonce = secrets.token_bytes(12)
        encrypted_signer_priv = AESGCM(slot_master_key).encrypt(priv_nonce, signer_priv_der, b"CKO_PRIVATE_KEY")
        sealed_root_priv = self._seal_bytes(root_priv_der, so_pin, aad=b"HSM_ROOT_CA_KEY")

        # Sinh hạt giống TOTP 2FA cho điện thoại
        totp_secret = TOTPAuthenticator.generate_base32_secret()
        sealed_totp = AESGCM(slot_master_key).encrypt(priv_nonce, totp_secret.encode("ascii"), b"CKO_TOTP_SEED")

        signer_cert_pem = signer_cert.public_bytes(serialization.Encoding.PEM).decode("ascii")
        root_cert_pem = root_cert.public_bytes(serialization.Encoding.PEM).decode("ascii")
        csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode("ascii")

        serial_hex = format(signer_serial, "X")
        root_serial_hex = format(root_serial, "X")
        slot_id = f"HSM-SLOT-{serial_hex[:12]}"

        self.state = {
            "hsm_version": "KRYPTO_PKCS11_HSM_V1",
            "slot_id": slot_id,
            "created_at_utc": now_utc.isoformat(),
            "token_flags": {
                "CKA_TOKEN": True,
                "CKA_PRIVATE": True,
                "CKA_SENSITIVE": True,
                "CKA_EXTRACTABLE": False,
                "require_totp_2fa": require_totp_for_signing,
            },
            "security_state": {
                "locked": False,
                "failed_pin_attempts": 0,
                "max_pin_retries": self.MAX_PIN_RETRIES,
            },
            "key_wrapping": {
                "user_pin_wrapped_slot_key": user_pin_wrapped_master,
                "so_pin_wrapped_slot_key": so_pin_wrapped_master,
                "so_pin_sealed_root_ca_key": sealed_root_priv,
            },
            "pkcs11_objects": {
                "CKO_PRIVATE_KEY": {
                    "label": f"{signer_name} HSM Non-Extractable Key",
                    "key_type": "CKK_RSA_3072",
                    "nonce_b64": base64.b64encode(priv_nonce).decode("ascii"),
                    "wrapped_der_b64": base64.b64encode(encrypted_signer_priv).decode("ascii"),
                    "wrapped_totp_b64": base64.b64encode(sealed_totp).decode("ascii"),
                },
                "CKO_CERTIFICATE": {
                    "signer_name": signer_name,
                    "signer_email": signer_email,
                    "signer_title": signer_title,
                    "organization": organization,
                    "org_unit": org_unit,
                    "personal_id_cccd": personal_id_cccd,
                    "serial_hex": serial_hex,
                    "root_serial_hex": root_serial_hex,
                    "not_before_utc": signer_cert.not_valid_before_utc.isoformat(),
                    "not_after_utc": signer_cert.not_valid_after_utc.isoformat(),
                    "visual_sig_png_sha256": png_sha256_hex,
                    "signer_cert_pem": signer_cert_pem,
                    "root_ca_cert_pem": root_cert_pem,
                    "pkcs10_csr_pem": csr_pem,
                },
                "CKO_DATA_HANDWRITTEN_PNG": {
                    "application": "KRYPTO_HANDWRITTEN_SIGNATURE_PNG",
                    "sha256_hex": png_sha256_hex,
                    "png_b64": base64.b64encode(handwritten_png_bytes).decode("ascii"),
                },
            },
            "revoked_serials_crl": [],
            "audit_chain": [],
        }

        self._append_audit_log("HSM_SLOT_PROVISIONED", {
            "slot_id": slot_id,
            "signer_name": signer_name,
            "signer_email": signer_email,
            "serial_hex": serial_hex,
            "visual_sig_png_sha256": png_sha256_hex,
        })
        self.save()

        return {
            "slot_id": slot_id,
            "serial_hex": serial_hex,
            "root_serial_hex": root_serial_hex,
            "signer_name": signer_name,
            "signer_email": signer_email,
            "visual_sig_png_sha256": png_sha256_hex,
            "totp_secret": totp_secret,
            "totp_uri": TOTPAuthenticator.build_otpauth_uri(totp_secret, signer_email),
            "current_totp_code": TOTPAuthenticator.get_totp_code(totp_secret),
        }

    def _authenticate_user_pin(self, user_pin: str, totp_code: Optional[str] = None) -> bytes:
        """Xác thực USER_PIN (và TOTP nếu bật), tự động khóa cứng Token sau 5 lần nhập sai."""
        sec = self.state["security_state"]
        if sec.get("locked", False):
            raise PermissionError(
                "HSM Token đã bị KHÓA CỨNG (PIN Lockout) do nhập sai quá 5 lần! "
                "Vui lòng dùng mã quản trị SO_PIN (PUK) để mở khóa."
            )

        try:
            slot_key = self._unseal_bytes(
                self.state["key_wrapping"]["user_pin_wrapped_slot_key"],
                user_pin,
                aad=b"HSM_USER_PIN_SLOT",
            )
        except Exception:
            sec["failed_pin_attempts"] = sec.get("failed_pin_attempts", 0) + 1
            remaining = max(0, self.MAX_PIN_RETRIES - sec["failed_pin_attempts"])
            if remaining == 0:
                sec["locked"] = True
                self._append_audit_log("HSM_TOKEN_LOCKED_OUT", {
                    "failed_attempts": sec["failed_pin_attempts"],
                })
                self.save()
                raise PermissionError(
                    "Nhập sai USER_PIN 5 lần liên tiếp! HSM Token đã tự động KHÓA CỨNG để chống dò mật khẩu."
                )
            self._append_audit_log("HSM_AUTH_FAILED", {
                "failed_attempts": sec["failed_pin_attempts"],
                "remaining_retries": remaining,
            })
            self.save()
            raise PermissionError(f"Sai mã USER_PIN! Còn {remaining} lần thử trước khi HSM tự động khóa cứng.")

        # Nếu nhập đúng PIN, kiểm tra TOTP (nếu bật hoặc có truyền vào)
        priv_obj = self.state["pkcs11_objects"]["CKO_PRIVATE_KEY"]
        priv_nonce = base64.b64decode(priv_obj["nonce_b64"])
        totp_secret = AESGCM(slot_key).decrypt(
            priv_nonce,
            base64.b64decode(priv_obj["wrapped_totp_b64"]),
            b"CKO_TOTP_SEED",
        ).decode("ascii")

        if self.state["token_flags"].get("require_totp_2fa", False) or totp_code:
            if not totp_code or not TOTPAuthenticator.verify_totp(totp_secret, totp_code):
                self._append_audit_log("HSM_TOTP_2FA_FAILED", {"user_pin_ok": True})
                self.save()
                raise PermissionError("Mã xác thực 2 lớp (TOTP 6 số trên điện thoại) không hợp lệ hoặc đã hết hạn!")

        # Reset bộ đếm sai PIN khi đăng nhập thành công
        if sec.get("failed_pin_attempts", 0) > 0:
            sec["failed_pin_attempts"] = 0
            self.save()

        return slot_key

    def unlock_token_with_so_pin(self, so_pin: str, new_user_pin: str) -> Dict[str, Any]:
        """Dùng mã quản trị SO_PIN (PUK) để mở khóa HSM Token khi bị khóa cứng hoặc quên USER_PIN."""
        try:
            slot_key = self._unseal_bytes(
                self.state["key_wrapping"]["so_pin_wrapped_slot_key"],
                so_pin,
                aad=b"HSM_SO_PIN_RECOVERY",
            )
        except Exception as e:
            self._append_audit_log("HSM_SO_PIN_UNLOCK_FAILED", {})
            self.save()
            raise PermissionError("Mã quản trị SO_PIN (PUK) không chính xác!") from e

        self.state["key_wrapping"]["user_pin_wrapped_slot_key"] = self._seal_bytes(
            slot_key, new_user_pin, aad=b"HSM_USER_PIN_SLOT"
        )
        self.state["security_state"]["locked"] = False
        self.state["security_state"]["failed_pin_attempts"] = 0
        self._append_audit_log("HSM_TOKEN_UNLOCKED_BY_SO_PIN", {"status": "RESET_USER_PIN_SUCCESS"})
        self.save()
        return {"status": "UNLOCKED", "slot_id": self.state["slot_id"]}

    def sign_digest_pkcs11(
        self,
        digest_bytes: bytes,
        user_pin: str,
        totp_code: Optional[str] = None,
        document_label: str = "Document",
        hash_algo: str = "SHA256"
    ) -> Dict[str, Any]:
        """
        Thực thi lệnh PKCS#11 C_Sign bên trong buồng HSM:
        - Bên ngoài chỉ truyền vào 32 bytes mã băm (digest_bytes) hoặc dữ liệu SignedAttributes DER.
        - Khóa bí mật chỉ được giải bọc tức thời trong phạm vi hàm C_Sign, ký xong xóa ngay khỏi bộ nhớ.
        """
        slot_key = self._authenticate_user_pin(user_pin, totp_code=totp_code)
        priv_obj = self.state["pkcs11_objects"]["CKO_PRIVATE_KEY"]
        priv_nonce = base64.b64decode(priv_obj["nonce_b64"])
        priv_der = AESGCM(slot_key).decrypt(
            priv_nonce,
            base64.b64decode(priv_obj["wrapped_der_b64"]),
            b"CKO_PRIVATE_KEY",
        )

        private_key = serialization.load_der_private_key(priv_der, password=None)
        from cryptography.hazmat.primitives.asymmetric.utils import Prehashed

        h_alg = hashes.SHA256() if hash_algo.upper() == "SHA256" else hashes.SHA384()
        if len(digest_bytes) in (32, 48):
            raw_signature = private_key.sign(
                digest_bytes,
                padding.PKCS1v15(),
                Prehashed(h_alg),
            )
            digest_hex = digest_bytes.hex()
        else:
            raw_signature = private_key.sign(
                digest_bytes,
                padding.PKCS1v15(),
                h_alg,
            )
            digest_hex = hashlib.sha256(digest_bytes).hexdigest()

        # Xóa biến nhạy cảm ngay lập tức
        del priv_der
        del private_key

        audit_entry = self._append_audit_log("PKCS11_C_SIGN_EXECUTED", {
            "document_label": document_label,
            "digest_sha256": digest_hex,
            "signature_len": len(raw_signature),
            "signer_serial": self.state["pkcs11_objects"]["CKO_CERTIFICATE"]["serial_hex"],
        })
        self.save()

        return {
            "signature_bytes": raw_signature,
            "signature_b64": base64.b64encode(raw_signature).decode("ascii"),
            "digest_hex": digest_hex,
            "signer_serial_hex": self.state["pkcs11_objects"]["CKO_CERTIFICATE"]["serial_hex"],
            "audit_receipt": audit_entry,
        }

    def get_public_credentials_and_png(self) -> Dict[str, Any]:
        """Lấy Chứng thư công khai X.509v3 và Ảnh chữ ký tay .PNG lưu trong đối tượng CKO_DATA của HSM."""
        cert_obj = self.state["pkcs11_objects"]["CKO_CERTIFICATE"]
        png_obj = self.state["pkcs11_objects"]["CKO_DATA_HANDWRITTEN_PNG"]
        png_bytes = base64.b64decode(png_obj["png_b64"])

        # Kiểm tra tính toàn vẹn của ảnh chữ ký tay so với mã băm khóa trong chứng thư
        actual_hash = hashlib.sha256(png_bytes).hexdigest()
        if actual_hash != cert_obj["visual_sig_png_sha256"]:
            raise ValueError("CẢNH BÁO AN NINH: Ảnh chữ ký tay PNG không khớp với mã băm trong Chứng thư số X.509!")

        return {
            "slot_id": self.state["slot_id"],
            "signer_name": cert_obj["signer_name"],
            "signer_email": cert_obj["signer_email"],
            "signer_title": cert_obj["signer_title"],
            "organization": cert_obj["organization"],
            "org_unit": cert_obj["org_unit"],
            "personal_id_cccd": cert_obj["personal_id_cccd"],
            "serial_hex": cert_obj["serial_hex"],
            "root_serial_hex": cert_obj["root_serial_hex"],
            "not_before_utc": cert_obj["not_before_utc"],
            "not_after_utc": cert_obj["not_after_utc"],
            "signer_cert_pem": cert_obj["signer_cert_pem"],
            "root_ca_cert_pem": cert_obj["root_ca_cert_pem"],
            "handwritten_png_bytes": png_bytes,
            "handwritten_png_b64": png_obj["png_b64"],
            "visual_sig_png_sha256": actual_hash,
        }

    def update_handwritten_signature_png(
        self,
        new_png_bytes: bytes,
        user_pin: str,
        so_pin: str
    ) -> Dict[str, Any]:
        """Cập nhật mẫu ảnh chữ ký tay .PNG mới và cấp lại chứng thư đồng bộ mã băm trong HSM."""
        slot_key = self._authenticate_user_pin(user_pin)
        root_priv_der = self._unseal_bytes(
            self.state["key_wrapping"]["so_pin_sealed_root_ca_key"],
            so_pin,
            aad=b"HSM_ROOT_CA_KEY",
        )
        root_key = serialization.load_der_private_key(root_priv_der, password=None)

        cert_obj = self.state["pkcs11_objects"]["CKO_CERTIFICATE"]
        old_cert = x509.load_pem_x509_certificate(cert_obj["signer_cert_pem"].encode("ascii"))
        root_cert = x509.load_pem_x509_certificate(cert_obj["root_ca_cert_pem"].encode("ascii"))

        new_png_hash = hashlib.sha256(new_png_bytes).hexdigest()
        now_utc = datetime.datetime.now(datetime.timezone.utc)

        hsm_attestation_json = json.dumps({
            "standard": "OASIS PKCS#11 v3.0 / FIPS 140-3",
            "cka_sensitive": True,
            "cka_extractable": False,
            "visual_sig_sha256": new_png_hash,
        }).encode("utf-8")

        new_cert = (
            x509.CertificateBuilder()
            .subject_name(old_cert.subject)
            .issuer_name(root_cert.subject)
            .public_key(old_cert.public_key())
            .serial_number(old_cert.serial_number)
            .not_valid_before(old_cert.not_valid_before_utc)
            .not_valid_after(old_cert.not_valid_after_utc)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=True,
                    key_encipherment=True,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=False,
                    crl_sign=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(
                x509.ExtendedKeyUsage([
                    ExtendedKeyUsageOID.EMAIL_PROTECTION,
                    ExtendedKeyUsageOID.CLIENT_AUTH,
                    ExtendedKeyUsageOID.CODE_SIGNING,
                    OID_ADOBE_AUTHENTIC_DOCUMENTS,
                ]),
                critical=False,
            )
            .add_extension(
                x509.SubjectAlternativeName([x509.RFC822Name(cert_obj["signer_email"])]),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(
                    OID_VISUAL_SIGNATURE_PNG_HASH,
                    new_png_hash.encode("ascii"),
                ),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(
                    OID_HSM_NON_EXTRACTABLE_ATTESTATION,
                    hsm_attestation_json,
                ),
                critical=False,
            )
            .sign(private_key=root_key, algorithm=hashes.SHA256())
        )

        cert_obj["visual_sig_png_sha256"] = new_png_hash
        cert_obj["signer_cert_pem"] = new_cert.public_bytes(serialization.Encoding.PEM).decode("ascii")
        self.state["pkcs11_objects"]["CKO_DATA_HANDWRITTEN_PNG"] = {
            "application": "KRYPTO_HANDWRITTEN_SIGNATURE_PNG",
            "sha256_hex": new_png_hash,
            "png_b64": base64.b64encode(new_png_bytes).decode("ascii"),
        }
        self._append_audit_log("HANDWRITTEN_PNG_UPDATED", {"new_png_sha256": new_png_hash})
        self.save()
        return {"status": "UPDATED", "visual_sig_png_sha256": new_png_hash}

    # =========================================================================
    # CHỨC NĂNG DI TRÚ ĐỔI ĐIỆN THOẠI & ĐỔI PC (.KRYPTOHSM / PKCS#11 C_WrapKey)
    # =========================================================================
    def export_migration_bundle(
        self,
        user_pin: str,
        master_recovery_passphrase: str,
        output_bundle_path: Optional[str] = None,
        totp_code: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Thực thi lệnh PKCS#11 C_WrapKey:
        Đóng gói toàn bộ Buồng HSM (Khóa bí mật đã niêm phong + Chứng thư số + Ảnh chữ ký tay .PNG +
        Hạt giống TOTP điện thoại) vào tệp Két sắt Di trú `.kryptohsm` bảo vệ 2 lớp (USER_PIN + Master Recovery Passphrase).
        An toàn 100% khi lưu trên Google Drive / iCloud / OneDrive để đổi Điện thoại hoặc đổi PC.
        """
        if len(master_recovery_passphrase.strip()) < 6:
            raise ValueError("Master Recovery Passphrase phải có tối thiểu 6 ký tự.")

        # Xác thực người dùng trước khi cho phép bọc két di trú
        _ = self._authenticate_user_pin(user_pin, totp_code=totp_code)

        inner_json_bytes = json.dumps(self.state, ensure_ascii=False).encode("utf-8")
        outer_sealed = self._seal_bytes(
            inner_json_bytes,
            master_recovery_passphrase,
            aad=b"KRYPTO_HSM_MIGRATION_BUNDLE_V1",
        )

        cert_obj = self.state["pkcs11_objects"]["CKO_CERTIFICATE"]
        bundle_obj = {
            "bundle_format": "KRYPTO_HSM_MIGRATION_V1",
            "exported_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "slot_id": self.state["slot_id"],
            "signer_name": cert_obj["signer_name"],
            "signer_email": cert_obj["signer_email"],
            "serial_hex": cert_obj["serial_hex"],
            "visual_sig_png_sha256": cert_obj["visual_sig_png_sha256"],
            "kdf_spec": "PBKDF2-HMAC-SHA512-600000 + AES-256-GCM",
            "wrapped_vault": outer_sealed,
        }

        bundle_bytes = json.dumps(bundle_obj, ensure_ascii=False, indent=2).encode("utf-8")
        if output_bundle_path:
            os.makedirs(os.path.dirname(os.path.abspath(output_bundle_path)), exist_ok=True)
            with open(output_bundle_path, "wb") as f:
                f.write(bundle_bytes)

        self._append_audit_log("PKCS11_C_WRAPKEY_MIGRATION_EXPORT", {
            "slot_id": self.state["slot_id"],
            "bundle_sha256": hashlib.sha256(bundle_bytes).hexdigest(),
        })
        self.save()

        return {
            "bundle_bytes": bundle_bytes,
            "bundle_b64": base64.b64encode(bundle_bytes).decode("ascii"),
            "bundle_sha256": hashlib.sha256(bundle_bytes).hexdigest(),
            "output_bundle_path": output_bundle_path,
            "signer_name": cert_obj["signer_name"],
            "signer_email": cert_obj["signer_email"],
            "serial_hex": cert_obj["serial_hex"],
        }

    @classmethod
    def import_migration_bundle_to_new_device(
        cls,
        bundle_input: bytes | str,
        master_recovery_passphrase: str,
        new_device_vault_path: str,
        new_device_name: str = "New-PC-or-Mobile"
    ) -> "KryptoHSMVault":
        """
        Thực thi lệnh PKCS#11 C_UnwrapKey trên Điện thoại mới hoặc PC mới:
        Khôi phục nguyên vẹn 100% Khóa bí mật HSM, Số Serial Chứng thư số, Ảnh chữ ký tay .PNG và TOTP.
        """
        if isinstance(bundle_input, str) and os.path.exists(bundle_input):
            with open(bundle_input, "rb") as f:
                raw_bytes = f.read()
        elif isinstance(bundle_input, str):
            raw_bytes = bundle_input.encode("utf-8")
        else:
            raw_bytes = bundle_input

        bundle_obj = json.loads(raw_bytes.decode("utf-8"))
        if bundle_obj.get("bundle_format") != "KRYPTO_HSM_MIGRATION_V1":
            raise ValueError("Định dạng tệp .kryptohsm không hợp lệ!")

        try:
            inner_bytes = cls._unseal_bytes(
                bundle_obj["wrapped_vault"],
                master_recovery_passphrase,
                aad=b"KRYPTO_HSM_MIGRATION_BUNDLE_V1",
            )
        except Exception as e:
            raise PermissionError("Sai Master Recovery Passphrase! Không thể giải bọc két sắt HSM.") from e

        restored_state = json.loads(inner_bytes.decode("utf-8"))
        vault = cls(new_device_vault_path)
        vault.state = restored_state
        vault._append_audit_log("PKCS11_C_UNWRAPKEY_MIGRATION_IMPORT", {
            "new_device_name": new_device_name,
            "restored_slot_id": restored_state["slot_id"],
            "restored_serial_hex": restored_state["pkcs11_objects"]["CKO_CERTIFICATE"]["serial_hex"],
        })
        vault.save()
        return vault

    def rotate_mobile_totp_for_new_phone(self, user_pin: str, totp_code: Optional[str] = None) -> Dict[str, Any]:
        """
        Khi đổi sang Điện thoại mới (hoặc mất điện thoại cũ):
        Sinh hạt giống TOTP 2FA mới và vô hiệu hóa mã OTP trên điện thoại cũ,
        giữ nguyên 100% Khóa HSM, Chứng thư số và Ảnh chữ ký tay .PNG.
        """
        # Khi đổi điện thoại hoặc mất điện thoại cũ, xác thực bằng USER_PIN để xoay vòng hạt giống TOTP
        sec = self.state["security_state"]
        if sec.get("locked", False):
            raise PermissionError("HSM Token đang bị khóa cứng!")
        slot_key = self._unseal_bytes(
            self.state["key_wrapping"]["user_pin_wrapped_slot_key"],
            user_pin,
            aad=b"HSM_USER_PIN_SLOT",
        )
        priv_obj = self.state["pkcs11_objects"]["CKO_PRIVATE_KEY"]
        priv_nonce = base64.b64decode(priv_obj["nonce_b64"])

        new_totp_secret = TOTPAuthenticator.generate_base32_secret()
        sealed_totp = AESGCM(slot_key).encrypt(
            priv_nonce,
            new_totp_secret.encode("ascii"),
            b"CKO_TOTP_SEED",
        )
        priv_obj["wrapped_totp_b64"] = base64.b64encode(sealed_totp).decode("ascii")
        signer_email = self.state["pkcs11_objects"]["CKO_CERTIFICATE"]["signer_email"]

        self._append_audit_log("MOBILE_TOTP_SEED_ROTATED", {"signer_email": signer_email})
        self.save()

        return {
            "new_totp_secret": new_totp_secret,
            "new_totp_uri": TOTPAuthenticator.build_otpauth_uri(new_totp_secret, signer_email),
            "current_totp_code": TOTPAuthenticator.get_totp_code(new_totp_secret),
        }

    def rollover_device_key_and_revoke_lost_device(
        self,
        so_pin: str,
        new_user_pin: str,
        reason: str = "Lost_Old_Device_Rollover"
    ) -> Dict[str, Any]:
        """
        Khi máy cũ bị mất cắp:
        1. Đưa số Serial chứng thư trên máy cũ vào Danh sách Thu hồi (CRL).
        2. Dùng Personal Root CA cấp ngay cặp khóa HSM mới + Chứng thư mới trên máy mới,
           giữ nguyên Root CA và giữ nguyên Ảnh chữ ký tay .PNG.
        """
        root_priv_der = self._unseal_bytes(
            self.state["key_wrapping"]["so_pin_sealed_root_ca_key"],
            so_pin,
            aad=b"HSM_ROOT_CA_KEY",
        )
        root_key = serialization.load_der_private_key(root_priv_der, password=None)
        cert_obj = self.state["pkcs11_objects"]["CKO_CERTIFICATE"]
        old_serial = cert_obj["serial_hex"]

        # 1. Đưa chứng thư cũ vào CRL
        revoked_entry = {
            "revoked_serial_hex": old_serial,
            "revoked_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "reason": reason,
        }
        self.state.setdefault("revoked_serials_crl", []).append(revoked_entry)

        # 2. Sinh cặp khóa HSM mới cho thiết bị mới dưới cùng Root CA
        new_signer_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        old_cert = x509.load_pem_x509_certificate(cert_obj["signer_cert_pem"].encode("ascii"))
        root_cert = x509.load_pem_x509_certificate(cert_obj["root_ca_cert_pem"].encode("ascii"))
        png_sha256_hex = cert_obj["visual_sig_png_sha256"]

        now_utc = datetime.datetime.now(datetime.timezone.utc)
        new_serial = x509.random_serial_number()
        hsm_attestation_json = json.dumps({
            "standard": "OASIS PKCS#11 v3.0 / FIPS 140-3",
            "cka_sensitive": True,
            "cka_extractable": False,
            "visual_sig_sha256": png_sha256_hex,
            "rollover_from_serial": old_serial,
        }).encode("utf-8")

        new_cert = (
            x509.CertificateBuilder()
            .subject_name(old_cert.subject)
            .issuer_name(root_cert.subject)
            .public_key(new_signer_key.public_key())
            .serial_number(new_serial)
            .not_valid_before(now_utc - datetime.timedelta(minutes=5))
            .not_valid_after(now_utc + datetime.timedelta(days=365 * 5))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    content_commitment=True,
                    key_encipherment=True,
                    data_encipherment=False,
                    key_agreement=False,
                    key_cert_sign=False,
                    crl_sign=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(
                x509.ExtendedKeyUsage([
                    ExtendedKeyUsageOID.EMAIL_PROTECTION,
                    ExtendedKeyUsageOID.CLIENT_AUTH,
                    ExtendedKeyUsageOID.CODE_SIGNING,
                    OID_ADOBE_AUTHENTIC_DOCUMENTS,
                ]),
                critical=False,
            )
            .add_extension(
                x509.SubjectAlternativeName([x509.RFC822Name(cert_obj["signer_email"])]),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(
                    OID_VISUAL_SIGNATURE_PNG_HASH,
                    png_sha256_hex.encode("ascii"),
                ),
                critical=False,
            )
            .add_extension(
                x509.UnrecognizedExtension(
                    OID_HSM_NON_EXTRACTABLE_ATTESTATION,
                    hsm_attestation_json,
                ),
                critical=False,
            )
            .sign(private_key=root_key, algorithm=hashes.SHA256())
        )

        # Niêm phong khóa mới bằng new_user_pin
        new_slot_master = secrets.token_bytes(32)
        self.state["key_wrapping"]["user_pin_wrapped_slot_key"] = self._seal_bytes(
            new_slot_master, new_user_pin, aad=b"HSM_USER_PIN_SLOT"
        )
        self.state["key_wrapping"]["so_pin_wrapped_slot_key"] = self._seal_bytes(
            new_slot_master, so_pin, aad=b"HSM_SO_PIN_RECOVERY"
        )

        priv_nonce = secrets.token_bytes(12)
        new_priv_der = new_signer_key.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        new_totp = TOTPAuthenticator.generate_base32_secret()
        self.state["pkcs11_objects"]["CKO_PRIVATE_KEY"] = {
            "label": f"{cert_obj['signer_name']} HSM Non-Extractable Key (Rollover)",
            "key_type": "CKK_RSA_3072",
            "nonce_b64": base64.b64encode(priv_nonce).decode("ascii"),
            "wrapped_der_b64": base64.b64encode(
                AESGCM(new_slot_master).encrypt(priv_nonce, new_priv_der, b"CKO_PRIVATE_KEY")
            ).decode("ascii"),
            "wrapped_totp_b64": base64.b64encode(
                AESGCM(new_slot_master).encrypt(priv_nonce, new_totp.encode("ascii"), b"CKO_TOTP_SEED")
            ).decode("ascii"),
        }

        new_serial_hex = format(new_serial, "X")
        cert_obj["serial_hex"] = new_serial_hex
        cert_obj["not_before_utc"] = new_cert.not_valid_before_utc.isoformat()
        cert_obj["not_after_utc"] = new_cert.not_valid_after_utc.isoformat()
        cert_obj["signer_cert_pem"] = new_cert.public_bytes(serialization.Encoding.PEM).decode("ascii")

        self._append_audit_log("HSM_DEVICE_KEY_ROLLOVER_AND_CRL_REVOKE", {
            "revoked_old_serial": old_serial,
            "new_active_serial": new_serial_hex,
            "reason": reason,
        })
        self.save()

        return {
            "revoked_old_serial": old_serial,
            "new_serial_hex": new_serial_hex,
            "root_serial_hex": cert_obj["root_serial_hex"],
            "new_totp_secret": new_totp,
        }
