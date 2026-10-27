# -*- coding: utf-8 -*-
"""
Nghien_Cuu_Chu_Ky_So_Ca_Nhan.src: Bộ lõi Chữ ký số Cá nhân chuẩn PKCS#11 HSM,
Xử lý Ảnh Chữ ký Tay (.PNG), Ký số PDF PAdES-B, Di trú Thiết bị (.kryptohsm) & Email S/MIME.
"""

from .handwritten_sig_processor import HandwrittenSignatureProcessor, INK_COLOR_PRESETS
from .hsm_pkcs11_ca_vault import (
    KryptoHSMVault,
    TOTPAuthenticator,
    OID_ADOBE_AUTHENTIC_DOCUMENTS,
    OID_VISUAL_SIGNATURE_PNG_HASH,
    OID_HSM_NON_EXTRACTABLE_ATTESTATION,
)
from .pdf_pades_hsm_signer import PDFPAdESHSMSigner
from .smime_email_workflow import SMIMEEmailWorkflowEngine

__all__ = [
    "HandwrittenSignatureProcessor",
    "INK_COLOR_PRESETS",
    "KryptoHSMVault",
    "TOTPAuthenticator",
    "PDFPAdESHSMSigner",
    "SMIMEEmailWorkflowEngine",
    "OID_ADOBE_AUTHENTIC_DOCUMENTS",
    "OID_VISUAL_SIGNATURE_PNG_HASH",
    "OID_HSM_NON_EXTRACTABLE_ATTESTATION",
]
