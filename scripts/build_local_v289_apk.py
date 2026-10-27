import os
import shutil
import struct
import zlib
import hashlib
import base64
import zipfile
from asn1crypto import cms
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes

ROOT = r"c:\Books\Common Study\SecureDocShare"
BASE_APK = os.path.join(ROOT, "build-output", "Krypto_v2.8.8_backup.apk")
OUT_APK = os.path.join(ROOT, "build-output", "Krypto.apk")
ROOT_APK = os.path.join(ROOT, "Krypto.apk")
P12_PATH = r"C:\Users\Admin\.gemini\config\skills\mobile-apk-packaging\resources\anhsteam-release.p12"
P12_PASS = b"anhsteam2026"

REPLACEMENTS = {
    "assets/flutter_assets/assets/www/index.html": os.path.join(ROOT, "mobile_app", "assets", "www", "index.html"),
    "assets/flutter_assets/assets/www/static/app.js": os.path.join(ROOT, "mobile_app", "assets", "www", "static", "app.js"),
    "assets/flutter_assets/assets/www/static/hsm_signature_engine.js": os.path.join(ROOT, "mobile_app", "assets", "www", "static", "hsm_signature_engine.js"),
    "assets/flutter_assets/assets/www/static/mobile_app.js": os.path.join(ROOT, "mobile_app", "assets", "www", "static", "mobile_app.js"),
}


def deflate_raw(raw_bytes: bytes) -> bytes:
    comp = zlib.compressobj(level=6, method=zlib.DEFLATED, wbits=-15)
    return comp.compress(raw_bytes) + comp.flush()


def compute_v2_sha256(sections):
    chunk_digests = []
    CHUNK_SIZE = 1024 * 1024
    for sec in sections:
        off = 0
        n = len(sec)
        while off < n:
            chunk = sec[off:off + CHUNK_SIZE]
            h = hashlib.sha256()
            h.update(b"\xa5")
            h.update(struct.pack("<I", len(chunk)))
            h.update(chunk)
            chunk_digests.append(h.digest())
            off += CHUNK_SIZE
    top = hashlib.sha256()
    top.update(b"\x5a")
    top.update(struct.pack("<I", len(chunk_digests)))
    for d in chunk_digests:
        top.update(d)
    return top.digest()


def build_sig_placement_block(start_u=703, target_after_place=1002):
    code = []
    labels = {}
    fixups = []

    def emit(*words):
        code.extend(words)

    def label(name):
        labels[name] = start_u + len(code)

    def branch16(op_byte, reg, target_label):
        idx = len(code)
        cur_u = start_u + idx
        emit(op_byte | (reg << 8), 0)
        fixups.append((idx + 1, cur_u, target_label))

    def branch22(op_byte, reg_a, reg_b, target_label):
        idx = len(code)
        cur_u = start_u + idx
        emit(op_byte | (reg_a << 8) | (reg_b << 12), 0)
        fixups.append((idx + 1, cur_u, target_label))

    def goto16(target_u):
        cur_u = start_u + len(code)
        off = (target_u - cur_u) & 0xFFFF
        emit(0x0029, off)

    def goto16_lbl(target_label):
        idx = len(code)
        cur_u = start_u + idx
        emit(0x0029, 0)
        fixups.append((idx + 1, cur_u, target_label))

    # If v3 (Image) == null (e.g. invisible signature mode), skip drawing on page
    branch16(0x38, 3, "L_done")                       # if-eqz v3, L_done

    # Check targetPage = v15.charAt(12) - 32 (0 = use base last_page/all_pages, >=1 = specific 1-based page)
    emit(0x0013, 0x000C)                              # const/16 v0, 12
    emit(0x206E, 0xA2FE, 0x000F)                      # invoke-virtual {v15, v0}, String.charAt(I)C
    emit(0x000A)                                      # move-result v0
    emit(0x00D8, 0xE000)                              # add-int/lit8 v0, v0, -32
    branch16(0x3D, 0, "L_page_ok")                    # if-lez v0, L_page_ok
    branch22(0x33, 6, 0, "L_done")                    # if-ne v6, v0, L_done

    label("L_page_ok")
    # Compute scalePct = (pageWidth * wPct) / imgWidth
    emit(0x0174, 0x6C53, 0x0010)                      # invoke-virtual/range {v16}, Rectangle.getWidth()F
    emit(0x090A)                                      # move-result v9 (pageWidth)
    emit(0x0013, 0x000B)                              # const/16 v0, 11
    emit(0x206E, 0xA2FE, 0x000F)                      # invoke-virtual {v15, v0}, String.charAt(I)C
    emit(0x000A)                                      # move-result v0
    emit(0x00D8, 0xE000)                              # add-int/lit8 v0, v0, -32 (wPct)
    emit(0x0082)                                      # int-to-float v0, v0
    emit(0x90C8)                                      # mul-float/2addr v0, v9 (wPct * pageWidth)
    emit(0x106E, 0x6A99, 0x0003)                      # invoke-virtual {v3}, Image.getWidth()F
    emit(0x0B0A)                                      # move-result v11 (imgWidth)
    emit(0xB0C9)                                      # div-float/2addr v0, v11
    emit(0x206E, 0x6AB4, 0x0003)                      # invoke-virtual {v3, v0}, Image.scalePercent(F)V

    # Compute absX = (pageWidth * xPct) / 100.0f in v9
    emit(0x0013, 0x0009)                              # const/16 v0, 9
    emit(0x206E, 0xA2FE, 0x000F)                      # invoke-virtual {v15, v0}, String.charAt(I)C
    emit(0x000A)                                      # move-result v0
    emit(0x00D8, 0xE000)                              # add-int/lit8 v0, v0, -32 (xPct)
    emit(0x0082)                                      # int-to-float v0, v0
    emit(0x09C8)                                      # mul-float/2addr v9, v0 (pageWidth * xPct)
    emit(0x09A9, 0x1909)                              # div-float v9, v9, v25 (/ 100.0f)

    # Compute absY = (pageHeight * yPct) / 100.0f in v11
    emit(0x0174, 0x6C4A, 0x0010)                      # invoke-virtual/range {v16}, Rectangle.getHeight()F
    emit(0x0B0A)                                      # move-result v11 (pageHeight)
    emit(0x0013, 0x000A)                              # const/16 v0, 10
    emit(0x206E, 0xA2FE, 0x000F)                      # invoke-virtual {v15, v0}, String.charAt(I)C
    emit(0x000A)                                      # move-result v0
    emit(0x00D8, 0xE000)                              # add-int/lit8 v0, v0, -32 (yPct)
    emit(0x0082)                                      # int-to-float v0, v0
    emit(0x0BC8)                                      # mul-float/2addr v11, v0 (pageHeight * yPct)
    emit(0x0BA9, 0x190B)                              # div-float v11, v11, v25 (/ 100.0f)

    emit(0x306E, 0x6AB8, 0x0B93)                      # invoke-virtual {v3, v9, v11}, Image.setAbsolutePosition(FF)V
    emit(0x206E, 0x74DA, 0x003A)                      # invoke-virtual {v10, v3}, PdfContentByte.addImage(Image)V

    label("L_done")
    emit(0x2608, 0x0003)                              # move-object/from16 v38, v3
    goto16(target_after_place)                        # goto/16 -> 1002

    for fix_idx, cur_u, lbl in fixups:
        code[fix_idx] = (labels[lbl] - cur_u) & 0xFFFF
    return code


def build_pades_block(start_u=785, target_after_close=1329):
    code = []
    labels = {}
    fixups = []

    def emit(*words):
        code.extend(words)

    def label(name):
        labels[name] = start_u + len(code)

    def branch16(op_byte, reg, target_label):
        idx = len(code)
        cur_u = start_u + idx
        emit(op_byte | (reg << 8), 0)
        fixups.append((idx + 1, cur_u, target_label))

    def goto16(target_u):
        cur_u = start_u + len(code)
        off = (target_u - cur_u) & 0xFFFF
        emit(0x0029, off)

    # Entry at u755: v3 = stamper, v37 = enableSignature, v44 = signerName, v45 = signingReason ('p12B64|cmsB64')
    branch16(0x38, 37, "L_close")                    # if-eqz v37, L_close
    emit(0x0408, 0x002D)                             # move-object/from16 v4, v45
    emit(0x0513, 0x007C)                             # const/16 v5, 0x7c ('|')
    emit(0x206E, 0xA312, 0x0054)                     # invoke-virtual {v4, v5}, String.indexOf(I)I
    emit(0x050A)                                     # move-result v5 (pipeIdx)
    branch16(0x3C, 5, "L_do_sign")                   # if-gtz v5, L_do_sign (0x3C = if-gtz!)

    label("L_close")
    emit(0x106E, 0x7CAD, 0x0003)                     # invoke-virtual {v3}, PdfStamper.close()V
    goto16(target_after_close)                       # goto/16 -> 1329

    label("L_do_sign")
    emit(0x0612)                                     # const/4 v6, 0
    emit(0x306E, 0xA32B, 0x0564)                     # invoke-virtual {v4, v6, v5}, String.substring(II)String
    emit(0x070C)                                     # move-result-object v7 (p12B64)
    emit(0x2071, 0x0917, 0x0067)                     # invoke-static {v7, v6}, Base64.decode(String, I)[B
    emit(0x070C)                                     # move-result-object v7 (p12Bytes)
    emit(0x05D8, 0x0105)                             # add-int/lit8 v5, v5, 1
    emit(0x206E, 0xA32A, 0x0054)                     # invoke-virtual {v4, v5}, String.substring(I)String
    emit(0x080C)                                     # move-result-object v8 (cmsB64)
    emit(0x2071, 0x0917, 0x0068)                     # invoke-static {v8, v6}, Base64.decode(String, I)[B
    emit(0x080C)                                     # move-result-object v8 (cmsBytes)

    # Build 'PKCS12' string in v9
    emit(0x091A, 0x69B5)                             # const-string v9, 'PKCS7Padding'
    emit(0x4A12)                                     # const/4 v10, 4
    emit(0x306E, 0xA32B, 0x0A69)                     # invoke-virtual {v9, v6, v10}, String.substring(II)String -> 'PKCS'
    emit(0x090C)                                     # move-result-object v9
    emit(0x0A1A, 0x68E5)                             # const-string v10, 'P12'
    emit(0x1B12)                                     # const/4 v11, 1
    emit(0x206E, 0xA32A, 0x00BA)                     # invoke-virtual {v10, v11}, String.substring(I)String -> '12'
    emit(0x0A0C)                                     # move-result-object v10
    emit(0x206E, 0xA304, 0x00A9)                     # invoke-virtual {v9, v10}, String.concat(String)String -> 'PKCS12'
    emit(0x090C)                                     # move-result-object v9

    # KeyStore.getInstance('PKCS12') & load(ByteArrayInputStream(p12Bytes), ''.toCharArray())
    emit(0x1071, 0xA508, 0x0009)                     # invoke-static {v9}, KeyStore.getInstance(String)KeyStore
    emit(0x090C)                                     # move-result-object v9 (ks)
    emit(0x0A22, 0x162A)                             # new-instance v10, ByteArrayInputStream
    emit(0x2070, 0xA0AB, 0x007A)                     # invoke-direct {v10, v7}, ByteArrayInputStream.<init>([B)V
    emit(0x0B1A, 0x0000)                             # const-string v11, ''
    emit(0x106E, 0xA32C, 0x000B)                     # invoke-virtual {v11}, String.toCharArray()[C
    emit(0x0B0C)                                     # move-result-object v11 (char[0])
    emit(0x306E, 0xA50C, 0x0BA9)                     # invoke-virtual {v9, v10, v11}, KeyStore.load(InputStream, [C)V
    emit(0x106E, 0xA506, 0x0009)                     # invoke-virtual {v9}, KeyStore.aliases()Enumeration
    emit(0x0A0C)                                     # move-result-object v10
    emit(0x1072, 0xA636, 0x000A)                     # invoke-interface {v10}, Enumeration.nextElement()Object
    emit(0x0A0C)                                     # move-result-object v10
    emit(0x0A1F, 0x168D)                             # check-cast v10, String
    emit(0x306E, 0xA50A, 0x0BA9)                     # invoke-virtual {v9, v10, v11}, KeyStore.getKey(String, [C)Key
    emit(0x090C)                                     # move-result-object v9
    emit(0x091F, 0x1708)                             # check-cast v9, PrivateKey

    # Configure PdfSignatureAppearance & PdfSignature, call sap.preClose(exc)
    emit(0x106E, 0x7CBB, 0x0003)                     # invoke-virtual {v3}, PdfStamper.getSignatureAppearance()
    emit(0x0A0C)                                     # move-result-object v10 (sap)
    emit(0x0B62, 0x3E76)                             # sget-object v11, PdfName.ADOBE_PPKLITE
    emit(0x0C62, 0x3E71)                             # sget-object v12, PdfName.ADBE_PKCS7_DETACHED
    emit(0x0D22, 0x10D8)                             # new-instance v13, PdfSignature
    emit(0x3070, 0x7C2E, 0x0CBD)                     # invoke-direct {v13, v11, v12}, PdfSignature.<init>(PdfName, PdfName)V
    emit(0x0B08, 0x002C)                             # move-object/from16 v11, v44 (signerName)
    emit(0x206E, 0x7C38, 0x00BD)                     # invoke-virtual {v13, v11}, PdfSignature.setName(String)V
    emit(0x206E, 0x7C34, 0x00BD)                     # invoke-virtual {v13, v11}, PdfSignature.setContact(String)V
    emit(0x0C22, 0x107E)                             # new-instance v12, PdfDate
    emit(0x1070, 0x7695, 0x000C)                     # invoke-direct {v12}, PdfDate.<init>()V
    emit(0x206E, 0x7C36, 0x00CD)                     # invoke-virtual {v13, v12}, PdfSignature.setDate(PdfDate)V
    emit(0x206E, 0x7C70, 0x00DA)                     # invoke-virtual {v10, v13}, PdfSignatureAppearance.setCryptoDictionary(PdfDictionary)V
    emit(0x0C22, 0x1739)                             # new-instance v12, HashMap
    emit(0x1070, 0xA641, 0x000C)                     # invoke-direct {v12}, HashMap.<init>()V
    emit(0x0D62, 0x3EEB)                             # sget-object v13, PdfName.CONTENTS
    emit(0x8E21)                                     # array-length v14, v8 (v14 = L = cmsBytes.length)
    emit(0x0FE0, 0x010E)                             # shl-int/lit8 v15, v14, 1 (v15 = L * 2)
    emit(0x0FD8, 0x020F)                             # add-int/lit8 v15, v15, 2 (v15 = L * 2 + 2)
    emit(0x1071, 0xA266, 0x000F)                     # invoke-static {v15}, Integer.valueOf(I)Integer
    emit(0x0F0C)                                     # move-result-object v15
    emit(0x306E, 0xA64F, 0x0FDC)                     # invoke-virtual {v12, v13, v15}, HashMap.put(Object, Object)Object
    emit(0x206E, 0x7C6B, 0x00CA)                     # invoke-virtual {v10, v12}, PdfSignatureAppearance.preClose(HashMap)V

    # Hash sap.getRangeStream(), patch cmsBytes, sign signedAttrs, call sap.close(dic2)
    emit(0x106E, 0x7C5A, 0x000A)                     # invoke-virtual {v10}, PdfSignatureAppearance.getRangeStream()InputStream
    emit(0x0B0C)                                     # move-result-object v11
    emit(0x0C1A, 0x7061)                             # const-string v12, 'SHA256'
    emit(0x0D12)                                     # const/4 v13, 0 (null)
    emit(0x3071, 0x8916, 0x0DCB)                     # invoke-static {v11, v12, v13}, DigestAlgorithms.digest(InputStream, String, String)[B
    emit(0x0B0C)                                     # move-result-object v11 (rangeHash, 32 bytes)
    emit(0xEFD0, (-307) & 0xFFFF)                    # add-int/lit16 v15, v14, -307
    emit(0x0013, 0x0020)                             # const/16 v0, 32
    emit(0x5071, 0xA375, 0xF86B)                     # invoke-static {v11, v6, v8, v15, v0}, System.arraycopy(Object, I, Object, I, I)V
    emit(0xEFD0, (-352) & 0xFFFF)                    # add-int/lit16 v15, v14, -352
    emit(0xE0D0, (-275) & 0xFFFF)                    # add-int/lit16 v0, v14, -275
    emit(0x3071, 0xA5AC, 0x00F8)                     # invoke-static {v8, v15, v0}, Arrays.copyOfRange([BII)[B
    emit(0x0B0C)                                     # move-result-object v11 (attrBytes, 77 bytes)
    emit(0x0013, 0x0031)                             # const/16 v0, 0x31
    emit(0x004F, 0x060B)                             # aput-byte v0, v11, v6
    emit(0x0022, 0x1262)                             # new-instance v0, PrivateKeySignature
    emit(0x4070, 0x89C8, 0xDC90)                     # invoke-direct {v0, v9, v12, v13}, PrivateKeySignature.<init>(PrivateKey, String, String)V
    emit(0x206E, 0x89CB, 0x00B0)                     # invoke-virtual {v0, v11}, PrivateKeySignature.sign([B)[B
    emit(0x000C)                                     # move-result-object v0 (rsaSig, 256 bytes)
    emit(0xEFD0, (-256) & 0xFFFF)                    # add-int/lit16 v15, v14, -256
    emit(0x0213, 0x0100)                             # const/16 v2, 256
    emit(0x5271, 0xA375, 0xF860)                     # invoke-static {v0, v6, v8, v15, v2}, System.arraycopy(Object, I, Object, I, I)V
    emit(0x0C22, 0x1082)                             # new-instance v12, PdfDictionary
    emit(0x1070, 0x76B3, 0x000C)                     # invoke-direct {v12}, PdfDictionary.<init>()V
    emit(0x0D62, 0x3EEB)                             # sget-object v13, PdfName.CONTENTS
    emit(0x0E22, 0x10E4)                             # new-instance v14, PdfString
    emit(0x2070, 0x7D63, 0x008E)                     # invoke-direct {v14, v8}, PdfString.<init>([B)V
    emit(0x1F12)                                     # const/4 v15, 1
    emit(0x206E, 0x7D6A, 0x00FE)                     # invoke-virtual {v14, v15}, PdfString.setHexWriting(Z)PdfString
    emit(0x0E0C)                                     # move-result-object v14
    emit(0x306E, 0x76CC, 0x0EDC)                     # invoke-virtual {v12, v13, v14}, PdfDictionary.put(PdfName, PdfObject)V
    emit(0x206E, 0x7C46, 0x00CA)                     # invoke-virtual {v10, v12}, PdfSignatureAppearance.close(PdfDictionary)V
    goto16(target_after_close)                       # goto/16 -> 1329

    for fix_idx, cur_u, lbl in fixups:
        code[fix_idx] = (labels[lbl] - cur_u) & 0xFFFF
    return code


def main():
    # Sync root web files into mobile_app/assets/www/ first
    shutil.copy2(os.path.join(ROOT, "index.html"), os.path.join(ROOT, "mobile_app", "assets", "www", "index.html"))
    shutil.copy2(os.path.join(ROOT, "static", "hsm_signature_engine.js"), os.path.join(ROOT, "mobile_app", "assets", "www", "static", "hsm_signature_engine.js"))
    shutil.copy2(os.path.join(ROOT, "static", "mobile_app.js"), os.path.join(ROOT, "mobile_app", "assets", "www", "static", "mobile_app.js"))

    if not os.path.exists(BASE_APK):
        shutil.copy2(OUT_APK, BASE_APK)

    with open(P12_PATH, "rb") as f:
        priv_key, cert, _ = pkcs12.load_key_and_certificates(f.read(), P12_PASS)

    with open(BASE_APK, "rb") as f:
        orig_data = f.read()

    # Locate EOCD, CD, and APK Sig Block 42 in original APK
    eocd_off = orig_data.rfind(b"PK\x05\x06")
    cd_size = struct.unpack("<I", orig_data[eocd_off + 12:eocd_off + 16])[0]
    cd_off = struct.unpack("<I", orig_data[eocd_off + 16:eocd_off + 20])[0]
    block_size_footer = struct.unpack("<Q", orig_data[cd_off - 24:cd_off - 16])[0]
    sig_block_start = cd_off - block_size_footer - 8

    # Read original MANIFEST.MF, CERT.SF, CERT.RSA, AndroidManifest.xml, classes.dex
    with zipfile.ZipFile(BASE_APK, "r") as zf:
        orig_mf = zf.read("META-INF/MANIFEST.MF").decode("utf-8")
        orig_sf = zf.read("META-INF/CERT.SF").decode("utf-8")
        orig_rsa = zf.read("META-INF/CERT.RSA")
        orig_am = bytearray(zf.read("AndroidManifest.xml"))
        orig_dex = bytearray(zf.read("classes.dex"))

    # Fix iText PdfStamper.createSignature + conditional setEncryption + PAdES CMS SignedData in MainActivity.encryptPdf (lambda15 @ 3673952)
    code_off = 3673952
    insns_off = code_off + 16
    insns_size = struct.unpack_from("<I", orig_dex, code_off + 12)[0]

    # 1. At units 185..194 (10 units): if enableSignature (v37 != 0), jump to 1271 (createSignature); else new PdfStamper(reader, fos) and jump to 1276
    u185_units = [
        0x2539, (1271 - 185) & 0xFFFF,  # 185: if-nez v37, -> 1271
        0x0622, 0x10E0,                 # 187: new-instance v6, PdfStamper
        0x3070, 0x7CA1, 0x07B6,         # 189: invoke-direct {v6, v11, v7}, PdfStamper.<init>(PdfReader, OutputStream)V
        0x0000,                         # 192: nop (aligns Try 11 end=193)
        0x0029, (1276 - 193) & 0xFFFF,  # 193: goto/16 -> 1276
    ]
    assert len(u185_units) == 10
    for idx_u, val_u in enumerate(u185_units):
        struct.pack_into("<H", orig_dex, insns_off + (185 + idx_u) * 2, val_u)

    # 2. At unit 1270: goto -> 1326 (+56 = 0x38)
    struct.pack_into("<H", orig_dex, insns_off + 1270 * 2, 0x3828)

    # 3. At units 1271..1325 (55 units): PdfStamper.createSignature (1271..1275) + conditional setEncryption (skip when !isViewOnly && password.isBlank)
    sub_units = [
        0x0212,                         # 1271: const/4 v2, 0 ('\0')
        0x3071, 0x7CAE, 0x027B,         # 1272: invoke-static {v11, v7, v2}, PdfStamper.createSignature(PdfReader, OutputStream, C)PdfStamper
        0x060C,                         # 1275: move-result-object v6
        0x3038, 0x0004,                 # 1276: if-eqz v48, -> 1280 (!isViewOnly)
        0x0312,                         # 1278: const/4 v3, 0 (userPwd = null for isViewOnly)
        0x0D28,                         # 1279: goto -> 1292
        0x1071, 0xD00E, 0x0009,         # 1280: invoke-static {v9}, StringsKt.isBlank(CharSequence)Z
        0x000A,                         # 1283: move-result v0
        0x0039, 0x001E,                 # 1284: if-nez v0, -> 1314 (skip setEncryption completely when password is blank and !isViewOnly!)
        0x0562, 0x5C8A,                 # 1286: sget-object v5, Charsets.UTF_8
        0x206E, 0xA30F, 0x0059,         # 1288: invoke-virtual {v9, v5}, String.getBytes
        0x030C,                         # 1291: move-result-object v3
        0x0262, 0x5C8A,                 # 1292: sget-object v2, Charsets.UTF_8
        0x206E, 0xA30F, 0x0028,         # 1294: invoke-virtual {v8, v2}, String.getBytes
        0x000C,                         # 1297: move-result-object v0
        0x3038, 0x000A,                 # 1298: if-eqz v48, -> 1308
        0x3138, 0x0005,                 # 1300: if-eqz v49, -> 1305
        0x0213, 0x0A04,                 # 1302: const/16 v2, 2564
        0x0628,                         # 1304: goto -> 1310
        0x0213, 0x0200,                 # 1305: const/16 v2, 512
        0x0328,                         # 1307: goto -> 1310
        0x0213, 0x0B14,                 # 1308: const/16 v2, 2836
        0x1412,                         # 1310: const/4 v4, 1
        0x546E, 0x7CCD, 0x2036,         # 1311: invoke-virtual {v6, v3, v0, v2, v4}, PdfStamper.setEncryption
        0x0308, 0x0024,                 # 1314: move-object/from16 v3, v36
        0x0408, 0x0026,                 # 1316: move-object/from16 v4, v38
        0x0502, 0x0027,                 # 1318: move/from16 v5, v39
        0x2338, 0x0004,                 # 1320: if-eqz v35, -> 1324
        0x0029, (195 - 1322) & 0xFFFF,  # 1322: goto/16 -> 195
        0x0029, (198 - 1324) & 0xFFFF,  # 1324: goto/16 -> 198
    ]
    assert len(sub_units) == 55, f"Expected 55 units, got {len(sub_units)}"
    for idx_u, val_u in enumerate(sub_units):
        struct.pack_into("<H", orig_dex, insns_off + (1271 + idx_u) * 2, val_u)

    # 4. At unit 666: use String.startsWith("all_pages") instead of Intrinsics.areEqual so signature_pos can carry coordinate suffix
    struct.pack_into("<HHH", orig_dex, insns_off + 666 * 2, 0x206E, 0xA327, 0x006F)

    # 5. Zero-fill units 703..1001 with nop (0x0000), write dynamic signature placement block at 703..782,
    #    and write PAdES CMS SignedData signing block at units 785..997 and jump to it from 1326
    for u_nop in range(703, 1002):
        struct.pack_into("<H", orig_dex, insns_off + u_nop * 2, 0x0000)
    place_units = build_sig_placement_block(start_u=703, target_after_place=1002)
    assert 703 + len(place_units) <= 784, f"place_units too long: {len(place_units)}"
    for idx_u, val_u in enumerate(place_units):
        struct.pack_into("<H", orig_dex, insns_off + (703 + idx_u) * 2, val_u)

    pades_start = 785
    pades_units = build_pades_block(start_u=pades_start, target_after_close=1329)
    assert pades_start + len(pades_units) <= 1001
    for idx_u, val_u in enumerate(pades_units):
        struct.pack_into("<H", orig_dex, insns_off + (pades_start + idx_u) * 2, val_u)
    struct.pack_into("<HHH", orig_dex, insns_off + 1326 * 2, 0x0029, (pades_start - 1326) & 0xFFFF, 0x0000)

    # 6. Update Try 30, Try 31, and Try 44
    padding_bytes = (4 - ((insns_size * 2) % 4)) % 4
    tries_off = insns_off + insns_size * 2 + padding_bytes
    try30_off = tries_off + 30 * 8
    try31_off = tries_off + 31 * 8
    try44_off = tries_off + 44 * 8
    start_30, count_30, handler_30 = struct.unpack_from("<IHH", orig_dex, try30_off)
    start_31, count_31, handler_31 = struct.unpack_from("<IHH", orig_dex, try31_off)
    start_44, count_44, handler_44 = struct.unpack_from("<IHH", orig_dex, try44_off)
    assert start_30 == 686 and start_31 == 753 and start_44 == 1277
    struct.pack_into("<IHH", orig_dex, try30_off, 686, len(place_units) + (703 - 686), handler_30)
    struct.pack_into("<IHH", orig_dex, try31_off, pades_start, len(pades_units), handler_44)
    struct.pack_into("<IHH", orig_dex, try44_off, 1326, 3, handler_44)

    # Recompute DEX SHA-1 signature and Adler32 checksum
    orig_dex[12:32] = hashlib.sha1(orig_dex[32:]).digest()
    struct.pack_into("<I", orig_dex, 8, zlib.adler32(orig_dex[12:]) & 0xFFFFFFFF)
    patched_dex_bytes = bytes(orig_dex)

    # Patch AndroidManifest.xml: versionName 2.8.8 -> 2.8.9 and versionCode 67 -> 68
    vname_old = b"2\x00.\x008\x00.\x008\x00"
    vname_new = b"2\x00.\x008\x00.\x009\x00"
    assert vname_old in orig_am, "2.8.8 not found in AndroidManifest.xml"
    orig_am = orig_am.replace(vname_old, vname_new, 1)
    assert struct.unpack_from("<I", orig_am, 4872)[0] == 67
    struct.pack_into("<I", orig_am, 4872, 68)
    patched_am_bytes = bytes(orig_am)

    dynamic_files = {}
    for entry_name, disk_path in REPLACEMENTS.items():
        with open(disk_path, "rb") as rf:
            dynamic_files[entry_name] = rf.read()
    dynamic_files["AndroidManifest.xml"] = patched_am_bytes
    dynamic_files["classes.dex"] = patched_dex_bytes

    # Update MANIFEST.MF and CERT.SF for the updated files
    new_mf = orig_mf
    new_sf = orig_sf
    for entry_name, raw_content in dynamic_files.items():
        b64_sha = base64.b64encode(hashlib.sha256(raw_content).digest()).decode("ascii")
        new_mf_block = f"Name: {entry_name}\r\nSHA-256-Digest: {b64_sha}\r\n\r\n"
        sf_b64_sha = base64.b64encode(hashlib.sha256(new_mf_block.encode("utf-8")).digest()).decode("ascii")
        new_sf_block = f"Name: {entry_name}\r\nSHA-256-Digest: {sf_b64_sha}\r\n\r\n"

        # Replace in new_mf
        prefix = f"Name: {entry_name}\r\nSHA-256-Digest: "
        idx = new_mf.find(prefix)
        assert idx != -1, f"Missing {entry_name} in MANIFEST.MF"
        end_idx = new_mf.find("\r\n\r\n", idx) + 4
        new_mf = new_mf[:idx] + new_mf_block + new_mf[end_idx:]

        # Replace in new_sf
        idx_sf = new_sf.find(prefix)
        assert idx_sf != -1, f"Missing {entry_name} in CERT.SF"
        end_idx_sf = new_sf.find("\r\n\r\n", idx_sf) + 4
        new_sf = new_sf[:idx_sf] + new_sf_block + new_sf[end_idx_sf:]

    new_mf_bytes = new_mf.encode("utf-8")
    mf_full_b64 = base64.b64encode(hashlib.sha256(new_mf_bytes).digest()).decode("ascii")
    # Update SHA-256-Digest-Manifest in CERT.SF
    sf_hdr_prefix = "SHA-256-Digest-Manifest: "
    h_idx = new_sf.find(sf_hdr_prefix)
    assert h_idx != -1
    h_end = new_sf.find("\r\n", h_idx)
    new_sf = new_sf[:h_idx + len(sf_hdr_prefix)] + mf_full_b64 + new_sf[h_end:]
    new_sf_bytes = new_sf.encode("utf-8")

    # Re-sign CERT.RSA (PKCS#7 SignedData over new_sf_bytes)
    ci = cms.ContentInfo.load(orig_rsa)
    sd = ci["content"]
    sf_sig = priv_key.sign(new_sf_bytes, padding.PKCS1v15(), hashes.SHA256())
    sd["signer_infos"][0]["signature"] = sf_sig
    new_rsa_bytes = ci.dump()

    dynamic_payloads = dict(dynamic_files)
    dynamic_payloads["META-INF/CERT.SF"] = new_sf_bytes
    dynamic_payloads["META-INF/CERT.RSA"] = new_rsa_bytes
    dynamic_payloads["META-INF/MANIFEST.MF"] = new_mf_bytes

    # Parse all Central Directory records from original APK
    cd_records = []
    pos = cd_off
    while pos < eocd_off:
        sig = orig_data[pos:pos + 4]
        assert sig == b"PK\x01\x02", f"Invalid CD sig at {pos}"
        (
            ver_made, ver_need, flags, comp, mtime, mdate,
            crc, csize, usize, fnlen, exlen, comlen,
            disk_num, int_attr, ext_attr, lhoff
        ) = struct.unpack("<HHHHHHIIIHHHHHII", orig_data[pos + 4:pos + 46])
        fn = orig_data[pos + 46:pos + 46 + fnlen].decode("utf-8")
        cd_extra = orig_data[pos + 46 + fnlen:pos + 46 + fnlen + exlen]
        cd_comment = orig_data[pos + 46 + fnlen + exlen:pos + 46 + fnlen + exlen + comlen]
        cd_records.append({
            "ver_made": ver_made, "ver_need": ver_need, "flags": flags,
            "comp": comp, "mtime": mtime, "mdate": mdate,
            "crc": crc, "csize": csize, "usize": usize,
            "fn": fn, "fn_bytes": orig_data[pos + 46:pos + 46 + fnlen],
            "cd_extra": cd_extra, "cd_comment": cd_comment,
            "disk_num": disk_num, "int_attr": int_attr, "ext_attr": ext_attr,
            "orig_lhoff": lhoff,
        })
        pos += 46 + fnlen + exlen + comlen

    # Reconstruct local file headers + data, preserving exact 4-byte alignment for all uncompressed entries
    entries_buf = bytearray()
    new_cd_buf = bytearray()

    for idx, rec in enumerate(cd_records):
        fn = rec["fn"]
        orig_lhoff = rec["orig_lhoff"]
        orig_lh = orig_data[orig_lhoff:orig_lhoff + 30]
        lh_sig, lh_ver, lh_flags, lh_comp, lh_mtime, lh_mdate, lh_crc, lh_csize, lh_usize, lh_fnlen, lh_exlen = struct.unpack(
            "<4sHHHHHIIIHH", orig_lh
        )
        assert lh_sig == b"PK\x03\x04"
        orig_data_start = orig_lhoff + 30 + lh_fnlen + lh_exlen
        orig_lh_extra = orig_data[orig_lhoff + 30 + lh_fnlen:orig_data_start]

        new_lhoff = len(entries_buf)

        if fn in dynamic_payloads:
            raw_bytes = dynamic_payloads[fn]
            usize = len(raw_bytes)
            crc = zlib.crc32(raw_bytes) & 0xFFFFFFFF
            comp_bytes = deflate_raw(raw_bytes) if lh_comp == 8 else raw_bytes
            csize = len(comp_bytes)
            new_lh_extra = b""
        else:
            usize = rec["usize"]
            crc = rec["crc"]
            csize = rec["csize"]
            comp_bytes = orig_data[orig_data_start:orig_data_start + csize]
            if lh_comp == 0:
                # Preserve exact mod4 (or mod4096 for .so) alignment of data start!
                orig_mod4096 = orig_data_start % 4096
                orig_mod4 = orig_data_start % 4
                base_data_start = new_lhoff + 30 + lh_fnlen
                if fn.startswith("lib/") and fn.endswith(".so"):
                    pad = (orig_mod4096 - (base_data_start % 4096)) % 4096
                else:
                    pad = (orig_mod4 - (base_data_start % 4)) % 4
                new_lh_extra = b"\x00" * pad
            else:
                new_lh_extra = orig_lh_extra

        new_lh = struct.pack(
            "<4sHHHHHIIIHH",
            b"PK\x03\x04", lh_ver, lh_flags, lh_comp, lh_mtime, lh_mdate,
            crc, csize, usize, len(rec["fn_bytes"]), len(new_lh_extra)
        )
        entries_buf.extend(new_lh)
        entries_buf.extend(rec["fn_bytes"])
        entries_buf.extend(new_lh_extra)
        entries_buf.extend(comp_bytes)

        # Build updated CD record
        cd_hdr = struct.pack(
            "<4sHHHHHHIIIHHHHHII",
            b"PK\x01\x02",
            rec["ver_made"], rec["ver_need"], rec["flags"], rec["comp"],
            rec["mtime"], rec["mdate"], crc, csize, usize,
            len(rec["fn_bytes"]), len(rec["cd_extra"]), len(rec["cd_comment"]),
            rec["disk_num"], rec["int_attr"], rec["ext_attr"], new_lhoff
        )
        new_cd_buf.extend(cd_hdr)
        new_cd_buf.extend(rec["fn_bytes"])
        new_cd_buf.extend(rec["cd_extra"])
        new_cd_buf.extend(rec["cd_comment"])

    # Pad entries_buf if needed or align APK Sig Block 42 to 4096 bytes like Signflinger
    # Note: In original APK, inspect pairs inside APK Sig Block 42
    orig_pairs = []
    p = sig_block_start + 8
    sig_block_end_pairs = cd_off - 24
    while p < sig_block_end_pairs:
        plen = struct.unpack("<Q", orig_data[p:p + 8])[0]
        pid = struct.unpack("<I", orig_data[p + 8:p + 12])[0]
        pval = orig_data[p + 12:p + 8 + plen]
        orig_pairs.append((pid, pval))
        p += 8 + plen

    # Compute APK Signature Scheme v2 digest over [entries_buf, new_cd_buf, eocd_for_digest]
    new_sig_block_start = len(entries_buf)
    eocd_template = bytearray(orig_data[eocd_off:])
    struct.pack_into("<I", eocd_template, 12, len(new_cd_buf))
    struct.pack_into("<I", eocd_template, 16, new_sig_block_start)

    v2_digest = compute_v2_sha256([
        memoryview(entries_buf),
        memoryview(new_cd_buf),
        bytes(eocd_template),
    ])

    # Re-build v2 pair (0x7109871a) using original pair template with updated digest + RSA signature
    v2_orig_val = [val for pid, val in orig_pairs if pid == 0x7109871A][0]
    signers_seq = v2_orig_val[4:4 + struct.unpack("<I", v2_orig_val[:4])[0]]
    signer = signers_seq[4:4 + struct.unpack("<I", signers_seq[:4])[0]]
    sd_len = struct.unpack("<I", signer[:4])[0]
    signed_data = bytearray(signer[4:4 + sd_len])

    # Replace the 32-byte SHA-256 digest inside signed_data
    # Structure of signed_data: digests_seq (len + [len + alg_id(0x0103) + len(32) + digest(32)])
    old_digest_pos = 16  # 4 (digests_seq len) + 4 (digest_0 len) + 4 (alg_id) + 4 (digest_len=32)
    assert struct.unpack("<I", signed_data[12:16])[0] == 32
    signed_data[16:48] = v2_digest

    # Sign the new signed_data using RSA-PKCS1-v1.5-SHA256 (0x0103)
    new_v2_sig = priv_key.sign(bytes(signed_data), padding.PKCS1v15(), hashes.SHA256())

    # Extract certificates and additional_attributes from signed_data, and public_key from signer
    pos_s = 4 + sd_len
    sigs_len = struct.unpack("<I", signer[pos_s:pos_s + 4])[0]
    pos_s += 4 + sigs_len
    pub_len = struct.unpack("<I", signer[pos_s:pos_s + 4])[0]
    pub_key_bytes = signer[pos_s + 4:pos_s + 4 + pub_len]

    # Build new signatures sequence: single signature entry (alg=0x0103, sig=new_v2_sig)
    sig_entry = struct.pack("<II", 0x0103, len(new_v2_sig)) + new_v2_sig
    new_sigs_seq = struct.pack("<I", len(sig_entry)) + sig_entry

    new_signer_body = (
        struct.pack("<I", len(signed_data)) + bytes(signed_data) +
        struct.pack("<I", len(new_sigs_seq)) + new_sigs_seq +
        struct.pack("<I", len(pub_key_bytes)) + pub_key_bytes
    )
    new_signers_seq = struct.pack("<I", len(new_signer_body)) + new_signer_body
    new_v2_val = struct.pack("<I", len(new_signers_seq)) + new_signers_seq

    # Keep dependency metadata pair (0x504b4453) and compute padding pair (0x42726577) so total block is 4096-aligned
    other_pairs = [(pid, val) for pid, val in orig_pairs if pid not in (0x7109871A, 0x42726577)]
    pairs_buf = bytearray()
    for pid, val in [(0x7109871A, new_v2_val)] + other_pairs:
        pairs_buf.extend(struct.pack("<QI", len(val) + 4, pid))
        pairs_buf.extend(val)

    # Calculate padding pair 0x42726577 so (len(entries_buf) + total_sig_block_size) % 4096 == 0 (or sig_block multiple of 4096)
    base_block_len = 8 + len(pairs_buf) + 24  # size_top(8) + pairs + size_bottom(8) + magic(16)
    rem = (base_block_len + 12) % 4096
    pad_len = (4096 - rem) % 4096
    pairs_buf.extend(struct.pack("<QI", pad_len + 4, 0x42726577))
    pairs_buf.extend(b"\x00" * pad_len)

    block_size_field = len(pairs_buf) + 24
    sig_block = bytearray()
    sig_block.extend(struct.pack("<Q", block_size_field))
    sig_block.extend(pairs_buf)
    sig_block.extend(struct.pack("<Q", block_size_field))
    sig_block.extend(b"APK Sig Block 42")

    new_cd_off = len(entries_buf) + len(sig_block)
    final_eocd = bytearray(eocd_template)
    struct.pack_into("<I", final_eocd, 16, new_cd_off)

    with open(OUT_APK, "wb") as out_f:
        out_f.write(entries_buf)
        out_f.write(sig_block)
        out_f.write(new_cd_buf)
        out_f.write(final_eocd)

    shutil.copy2(OUT_APK, ROOT_APK)
    print(f"Successfully built & signed v2.8.9 APK: {OUT_APK} ({os.path.getsize(OUT_APK):,} bytes)")

    # Verify v2 signature and alignment
    with open(OUT_APK, "rb") as vf:
        vdata = vf.read()
    veocd = vdata.rfind(b"PK\x05\x06")
    vcd_off = struct.unpack("<I", vdata[veocd + 16:veocd + 20])[0]
    vbs = struct.unpack("<Q", vdata[vcd_off - 24:vcd_off - 16])[0]
    vsig_start = vcd_off - vbs - 8
    veocd_dig = bytearray(vdata[veocd:])
    struct.pack_into("<I", veocd_dig, 16, vsig_start)
    check_digest = compute_v2_sha256([
        memoryview(vdata)[:vsig_start],
        memoryview(vdata)[vcd_off:veocd],
        bytes(veocd_dig),
    ])
    assert check_digest == v2_digest, "v2 digest verification failed!"
    cert.public_key().verify(new_v2_sig, bytes(signed_data), padding.PKCS1v15(), hashes.SHA256())
    print("Verified APK Signature Scheme v2 RSA-2048 signature & SHA-256 Merkle Tree: VALID (100% Match)")


if __name__ == "__main__":
    main()
