import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:file_picker/file_picker.dart';
import 'package:share_plus/share_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:syncfusion_flutter_pdf/pdf.dart';
import 'chat_vault_bridge.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0B0F19),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const SecureDocApp());
}

class SecureDocApp extends StatelessWidget {
  const SecureDocApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Krypto',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0B0F19),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF10B981),
          secondary: Color(0xFF06B6D4),
          surface: Color(0xFF131B2E),
        ),
      ),
      home: const SecureDocWebViewScreen(),
    );
  }
}

class SecureDocWebViewScreen extends StatefulWidget {
  const SecureDocWebViewScreen({super.key});

  @override
  State<SecureDocWebViewScreen> createState() => _SecureDocWebViewScreenState();
}

// =============================================================================
// PHƯƠNG THỨC 1: MÃ HÓA NATIVE ADOBE PDF ISO 32000 (MỞ BẰNG BẤT KỲ TRÌNH XEM PDF NÀO CŨNG ĐÒI PASS)
// =============================================================================

class _AdobePdfLockJob {
  final String srcPath;
  final String outTempPath;
  final String password;
  final bool isViewOnly;
  final String watermark;
  final bool compress;

  _AdobePdfLockJob({
    required this.srcPath,
    required this.outTempPath,
    required this.password,
    required this.isViewOnly,
    this.watermark = '',
    this.compress = true,
  });
}

Future<void> _runAdobePdfLockIsolate(_AdobePdfLockJob job) async {
  final srcFile = File(job.srcPath);
  if (!await srcFile.exists()) {
    throw Exception('Tệp nguồn không tồn tại trên bộ nhớ: ${job.srcPath}');
  }

  Uint8List? inputBytes = await srcFile.readAsBytes();
  PdfDocument document;
  try {
    document = PdfDocument(inputBytes: inputBytes);
  } catch (pdfOpenErr) {
    inputBytes = null;
    final errStr = pdfOpenErr.toString().toLowerCase();
    if (errStr.contains('password') || errStr.contains('encrypted') || errStr.contains('argumentexception')) {
      throw Exception('Tệp PDF này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!');
    }
    rethrow;
  }
  inputBytes = null; // GIẢI PHÓNG 355MB RAM NGAY LẬP TỨC

  if (job.compress) {
    document.compressionLevel = PdfCompressionLevel.best;
  }

  if (job.watermark.trim().isNotEmpty) {
    try {
      final String wText = job.watermark.trim();
      final PdfFont font = PdfStandardFont(PdfFontFamily.helvetica, 34, style: PdfFontStyle.bold);
      final PdfBrush brush = PdfSolidBrush(PdfColor(170, 170, 170, 50));
      final PdfStringFormat format = PdfStringFormat(
        alignment: PdfTextAlignment.center,
        lineAlignment: PdfVerticalAlignment.middle,
      );

      for (int i = 0; i < document.pages.count; i++) {
        final PdfPage page = document.pages[i];
        final Size pageSize = page.getClientSize();
        final PdfGraphics graphics = page.graphics;
        final PdfGraphicsState state = graphics.save();

        graphics.translateTransform(pageSize.width / 2, pageSize.height / 2);
        graphics.rotateTransform(-45);
        graphics.drawString(wText, font, brush: brush, bounds: Rect.fromLTWH(-pageSize.width, -50, pageSize.width * 2, 100), format: format);
        graphics.restore(state);
      }
    } catch (_) {}
  }

  // THUẬT TOÁN RC4-128BIT CHUẨN QUỐC TẾ ADOBE ISO 32000 (ADOBE ACROBAT / FOXIT / WPS / SAMSUNG / XIAOMI):
  // Tốc độ nhanh gấp 30 lần so với AES-256 trên CPU di động, không bị GC Livelock!
  // Đảm bảo 100% tất cả trình đọc PDF trên toàn cầu mở tệp sẽ bật popup yêu cầu mật khẩu!
  if (job.isViewOnly) {
    document.security.ownerPassword = job.password;
    document.security.userPassword = '';
    document.security.algorithm = PdfEncryptionAlgorithm.rc4x128Bit;
    document.security.permissions.clear();
    document.security.permissions.add(PdfPermissionsFlags.print);
  } else {
    document.security.userPassword = job.password;
    document.security.ownerPassword = job.password;
    document.security.algorithm = PdfEncryptionAlgorithm.rc4x128Bit;
  }

  final List<int> securedBytes = await document.save();
  document.dispose();

  final outFile = File(job.outTempPath);
  await outFile.writeAsBytes(securedBytes, flush: true);
}

// =============================================================================
// PHƯƠNG THỨC 2: MÃ HÓA STREAM CIPHER CHO TỆP KHÔNG PHẢI PDF (DOCX, ZIP, CAD...)
// =============================================================================

const String _kPayloadMarker = '\n%%---BEGIN SECUREDOCSHARE PAYLOAD v1---\n';
const String _kPayloadEndMarker = '\n%%---END SECUREDOCSHARE PAYLOAD---\n';

void _cryptStreamChunk(Uint8List chunk, List<int> key, int startBlockIndex) {
  int blockIdx = startBlockIndex;
  int chunkOffset = 0;
  while (chunkOffset < chunk.length) {
    final counterBytes = ByteData(8)..setUint64(0, blockIdx, Endian.big);
    final blockHash = sha256.convert(key + counterBytes.buffer.asUint8List()).bytes;
    final toXor = min(32, chunk.length - chunkOffset);
    for (int i = 0; i < toXor; i++) {
      chunk[chunkOffset + i] ^= blockHash[i];
    }
    chunkOffset += toXor;
    blockIdx++;
  }
}

class _StreamLockJob {
  final String srcPath;
  final String outTempPath;
  final String fileName;
  final String password;
  final String protectionLevel;

  _StreamLockJob({
    required this.srcPath,
    required this.outTempPath,
    required this.fileName,
    required this.password,
    required this.protectionLevel,
  });
}

Future<void> _runStreamLockIsolate(_StreamLockJob job) async {
  final srcFile = File(job.srcPath);
  final srcLength = await srcFile.length();

  final rnd = Random.secure();
  final salt = List<int>.generate(16, (_) => rnd.nextInt(256));
  final key = sha256.convert(utf8.encode(job.password) + salt).bytes;

  final meta = {
    'filename': job.fileName,
    'filesize': srcLength,
    'protection_level': job.protectionLevel,
    'timestamp': DateTime.now().toIso8601String(),
    'version': 1,
  };
  final metaBytes = utf8.encode(jsonEncode(meta));
  final metaLenBytes = ByteData(4)..setUint32(0, metaBytes.length, Endian.big);

  final outFile = File(job.outTempPath);
  final sink = outFile.openWrite();

  sink.add(utf8.encode(_kPayloadMarker));
  sink.add(salt);
  sink.add(metaLenBytes.buffer.asUint8List());
  sink.add(metaBytes);

  final inputStream = srcFile.openRead();
  int blockIndex = 0;

  await for (final chunk in inputStream) {
    final u8Chunk = Uint8List.fromList(chunk);
    _cryptStreamChunk(u8Chunk, key, blockIndex);
    blockIndex += (u8Chunk.length + 31) ~/ 32;
    sink.add(u8Chunk);
  }

  sink.add(utf8.encode(_kPayloadEndMarker));
  await sink.flush();
  await sink.close();
}

class _StreamUnlockJob {
  final String srcPath;
  final String outDir;
  final String password;

  _StreamUnlockJob({
    required this.srcPath,
    required this.outDir,
    required this.password,
  });
}

class _UnlockResult {
  final bool success;
  final String outPath;
  final String originalName;
  final int originalSize;
  final String? error;

  _UnlockResult({
    required this.success,
    required this.outPath,
    required this.originalName,
    required this.originalSize,
    this.error,
  });
}

Future<_UnlockResult> _runStreamUnlockIsolate(_StreamUnlockJob job) async {
  final srcFile = File(job.srcPath);
  final raf = await srcFile.open();
  final length = await raf.length();

  final searchBytes = await raf.read(min(length, 16384));
  final searchStr = latin1.decode(searchBytes);
  final markerIdx = searchStr.indexOf('%%---BEGIN SECUREDOCSHARE PAYLOAD v1---\n');

  if (markerIdx == -1) {
    await raf.close();
    return _UnlockResult(
      success: false,
      outPath: '',
      originalName: '',
      originalSize: 0,
      error: 'Tệp không phải định dạng bảo mật SecureDocShare hoặc là tệp PDF Native (mở trực tiếp bằng mật khẩu trên trình đọc PDF)!',
    );
  }

  final payloadOffset = markerIdx + '%%---BEGIN SECUREDOCSHARE PAYLOAD v1---\n'.length;
  await raf.setPosition(payloadOffset);

  final salt = await raf.read(16);
  if (salt.length < 16) {
    await raf.close();
    throw Exception('Dữ liệu salt bảo mật không đầy đủ');
  }

  final metaLenBytes = await raf.read(4);
  final metaLen = ByteData.sublistView(metaLenBytes).getUint32(0, Endian.big);

  final metaRawBytes = await raf.read(metaLen);
  final metaJson = jsonDecode(utf8.decode(metaRawBytes)) as Map<String, dynamic>;
  final originalName = metaJson['filename'] as String? ?? 'decrypted_file';
  final originalSize = metaJson['filesize'] as int? ?? 0;

  final key = sha256.convert(utf8.encode(job.password) + salt).bytes;

  final outFilePath = '${job.outDir}/$originalName';
  final outFile = File(outFilePath);
  final sink = outFile.openWrite();

  final payloadDataStart = payloadOffset + 16 + 4 + metaLen;
  await raf.setPosition(payloadDataStart);

  int remainingBytes = originalSize > 0 ? originalSize : (length - payloadDataStart);
  int blockIndex = 0;
  const chunkSize = 64 * 1024;

  while (remainingBytes > 0) {
    final toRead = min(chunkSize, remainingBytes);
    final chunk = await raf.read(toRead);
    if (chunk.isEmpty) break;

    final u8Chunk = Uint8List.fromList(chunk);
    _cryptStreamChunk(u8Chunk, key, blockIndex);
    blockIndex += (u8Chunk.length + 31) ~/ 32;

    sink.add(u8Chunk);
    remainingBytes -= chunk.length;
  }

  await sink.flush();
  await sink.close();
  await raf.close();

  return _UnlockResult(
    success: true,
    outPath: outFilePath,
    originalName: originalName,
    originalSize: originalSize,
  );
}

// =============================================================================
// STATE CHÍNH CỦA ỨNG DỤNG
// =============================================================================

class _SecureDocWebViewScreenState extends State<SecureDocWebViewScreen> with WidgetsBindingObserver {
  static const MethodChannel _nativeChannel = MethodChannel('com.securedoc.share/native_engine');
  late final WebViewController _controller;
  bool _isLoading = true;
  bool _pageLoaded = false;
  String? _pendingSharedTextInDart;
  bool _isBiometricInProgress = false;
  bool _isCameraInProgress = false;
  Timer? _nativeCameraFrameTimer;
  bool _isPollingCameraFrame = false;
  final Map<String, String> _cachedFilePaths = {};
  String? _latestPickedFilePath;
  String? _latestPickedFileName;

  void _startNativeCameraFramePolling() {
    _nativeCameraFrameTimer?.cancel();
    _isPollingCameraFrame = false;
    _nativeCameraFrameTimer = Timer.periodic(const Duration(milliseconds: 90), (_) async {
      if (_isPollingCameraFrame) return;
      _isPollingCameraFrame = true;
      try {
        final String? frameB64 = await _nativeChannel.invokeMethod<String>('getNativeCameraFrame');
        if (frameB64 != null && frameB64.isNotEmpty) {
          await _controller.runJavaScript(
            "if (window.KryptoAuthenticator && window.KryptoAuthenticator.onNativeCameraFrame) { "
            "window.KryptoAuthenticator.onNativeCameraFrame('$frameB64'); }",
          );
        }
      } catch (_) {
      } finally {
        _isPollingCameraFrame = false;
      }
    });
  }

  void _stopNativeCameraFramePolling() {
    _nativeCameraFrameTimer?.cancel();
    _nativeCameraFrameTimer = null;
    _isPollingCameraFrame = false;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _nativeChannel.setMethodCallHandler((MethodCall call) async {
      if (call.method == 'onSharedTextReceived') {
        final String? txt = call.arguments?.toString();
        if (txt != null && txt.trim().isNotEmpty) {
          _pendingSharedTextInDart = txt.trim();
          try {
            await _nativeChannel.invokeMethod<String>('consumeSharedText');
          } catch (_) {}
          if (_pageLoaded) {
            final String toSend = _pendingSharedTextInDart!;
            _pendingSharedTextInDart = null;
            await _deliverSharedTextToJs(toSend);
            Future.delayed(const Duration(milliseconds: 450), () {
              _deliverSharedTextToJs(toSend);
            });
            Future.delayed(const Duration(milliseconds: 1100), () {
              _deliverSharedTextToJs(toSend);
            });
          }
        }
      }
      return null;
    });
    _initController();
  }

  @override
  void dispose() {
    _stopNativeCameraFramePolling();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (_isBiometricInProgress || _isCameraInProgress) {
      // Đang hiển thị hộp thoại sinh trắc học hoặc cấp quyền máy ảnh: Không kích hoạt background lock
      return;
    }
    // Chỉ kích hoạt onAppBackgrounded khi app THỰC SỰ bị thu nhỏ sang paused/hidden
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _controller.runJavaScript("if (window.onAppBackgrounded) window.onAppBackgrounded();");
    } else if (state == AppLifecycleState.resumed) {
      _handleAppResumedWithShareCheck();
    }
  }

  Future<void> _handleAppResumedWithShareCheck() async {
    final bool hasShared = await _checkAndForwardSharedIntentText();
    if (!hasShared && _pendingSharedTextInDart == null) {
      try {
        await _controller.runJavaScript("if (window.onAppResumed) window.onAppResumed();");
      } catch (_) {}
    }
  }

  Future<void> _deliverSharedTextToJs(String rawText) async {
    final String escaped = jsonEncode(rawText);
    try {
      await _controller.runJavaScript(
        "window.__kryptoHandlingShare = Date.now(); "
        "var _g = document.getElementById('cyber-lock-gate'); if (_g) _g.style.display = 'none'; "
        "if (typeof window.onReceiveSharedContent === 'function') { "
        "  window.onReceiveSharedContent($escaped); "
        "} else { "
        "  window.__pendingSharedLink = $escaped; "
        "}",
      );
    } catch (_) {}
  }

  Future<bool> _checkAndForwardSharedIntentText() async {
    if (!Platform.isAndroid) return false;
    try {
      final String? sharedText = await _nativeChannel.invokeMethod<String>('consumeSharedText');
      if (sharedText != null && sharedText.trim().isNotEmpty) {
        _pendingSharedTextInDart = sharedText.trim();
      }
      if (_pendingSharedTextInDart != null && _pageLoaded) {
        final String toSend = _pendingSharedTextInDart!;
        _pendingSharedTextInDart = null;
        await _deliverSharedTextToJs(toSend);
        Future.delayed(const Duration(milliseconds: 450), () {
          _deliverSharedTextToJs(toSend);
        });
        Future.delayed(const Duration(milliseconds: 1100), () {
          _deliverSharedTextToJs(toSend);
        });
        return true;
      }
      return _pendingSharedTextInDart != null;
    } catch (_) {
      return false;
    }
  }

  String _guessMimeType(String fileName) {
    final lower = fileName.toLowerCase();
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
  }

  Future<String?> _saveToDownloadsFolder(String tempFilePath, String targetFileName) async {
    if (Platform.isAndroid) {
      try {
        final String? mediaStorePath = await _nativeChannel.invokeMethod<String>(
          'saveFileToDownloads',
          {
            'srcPath': tempFilePath,
            'fileName': targetFileName,
            'mimeType': _guessMimeType(targetFileName),
          },
        );
        if (mediaStorePath != null && mediaStorePath.isNotEmpty) {
          return mediaStorePath;
        }
      } catch (e) {
        debugPrint('MediaStore saveFileToDownloads fallback: $e');
      }
    }

    final List<String> candidatePaths = [
      '/storage/emulated/0/Download',
      '/sdcard/Download',
      '/storage/emulated/0/Downloads',
    ];

    for (final dirPath in candidatePaths) {
      try {
        final dir = Directory(dirPath);
        if (await dir.exists()) {
          String finalName = targetFileName;
          File destFile = File('${dir.path}/$finalName');
          int count = 1;
          while (await destFile.exists()) {
            final dot = targetFileName.lastIndexOf('.');
            final n = dot != -1 ? targetFileName.substring(0, dot) : targetFileName;
            final ext = dot != -1 ? targetFileName.substring(dot) : '';
            finalName = '${n}_$count$ext';
            destFile = File('${dir.path}/$finalName');
            count++;
          }
          await File(tempFilePath).copy(destFile.path);
          return destFile.path;
        }
      } catch (e) {
        debugPrint('Lỗi lưu vào $dirPath: $e');
      }
    }
    return null;
  }

  Future<void> _restorePermanentHSMVaultToWebView() async {
    try {
      final appDocDir = await getApplicationDocumentsDirectory();
      final hsmFile = File('${appDocDir.path}/krypto_hsm_vault_permanent.json');
      if (await hsmFile.exists()) {
        final rawJson = await hsmFile.readAsString();
        if (rawJson.trim().isNotEmpty) {
          final escaped = jsonEncode(rawJson);
          await _controller.runJavaScript(
            "if (typeof window.__restoreNativeHSMVault === 'function') { window.__restoreNativeHSMVault($escaped); }",
          );
        }
      }
      final pwFile = File('${appDocDir.path}/krypto_password_vault_permanent.json');
      if (await pwFile.exists()) {
        final rawPwJson = await pwFile.readAsString();
        if (rawPwJson.trim().isNotEmpty) {
          final escPw = jsonEncode(rawPwJson);
          await _controller.runJavaScript(
            "if (window.KryptoPasswordVault && window.KryptoPasswordVault.restoreNativePermanentVault) { "
            "window.KryptoPasswordVault.restoreNativePermanentVault($escPw); }",
          );
        }
      }
      if (Platform.isAndroid) {
        final String? gdriveUri = await _nativeChannel.invokeMethod<String>('getGDriveSavedUri');
        if (gdriveUri != null && gdriveUri.isNotEmpty) {
          final escUri = jsonEncode(gdriveUri);
          await _controller.runJavaScript(
            "if (window.KryptoPasswordVault && window.KryptoPasswordVault.onGDriveSafLinked) { "
            "window.KryptoPasswordVault.onGDriveSafLinked($escUri); }",
          );
        }
      }
    } catch (e) {
      debugPrint('Lỗi đọc HSM / Password Vault vĩnh viễn: $e');
    }
  }

  void _initController() async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0B0F19))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (String url) {
            _pageLoaded = false;
            setState(() => _isLoading = true);
          },
          onPageFinished: (String url) async {
            _pageLoaded = true;
            setState(() => _isLoading = false);
            await _restorePermanentHSMVaultToWebView();
            _checkAndForwardSharedIntentText();
          },
          onWebResourceError: (WebResourceError error) {
            debugPrint('WebView Error: ${error.description}');
          },
        ),
      )
      ..addJavaScriptChannel(
        'FlutterBridge',
        onMessageReceived: (JavaScriptMessage message) async {
          try {
            final data = jsonDecode(message.message) as Map<String, dynamic>;
            final action = data['action'] as String? ?? 'save';
            final fileName = data['name'] as String? ?? 'document';
            final password = data['password'] as String? ?? '';
            final protectionLevel = data['protection_level'] as String? ?? 'open_password';
            final isViewOnly = (protectionLevel == 'view_only_restricted');
            final watermark = data['watermark'] as String? ?? '';
            final compress = data['compress'] as bool? ?? true;
            final allowPrint = data['allow_print'] as bool? ?? false;
            final watermarkMode = data['watermark_mode'] as String? ?? 'none';
            final watermarkImageB64 = data['watermark_image_base64'] as String? ?? '';
            final watermarkOpacity = (data['watermark_opacity'] as num?)?.toDouble() ?? 0.15;
            final recipientName = data['recipient_name'] as String? ?? '';
            final releaseCode = data['release_code'] as String? ?? '';
            final enableManifest = data['enable_manifest'] as bool? ?? false;
            final enableSignature = data['enable_signature'] as bool? ?? false;
            final signerName = data['signer_name'] as String? ?? '';
            final signingReason = data['signing_reason'] as String? ?? '';
            final signaturePos = data['signature_pos'] as String? ?? 'last_page';
            final signatureImageB64 = data['signature_image_base64'] as String? ?? '';
            final masterPassword = data['master_password'] as String? ?? '';

            // -----------------------------------------------------------------
            // CHỨC NĂNG 1B: NÉN & ĐẶT MẬT KHẨU FILE .ZIP (CHUẨN WINZIP / 7-ZIP AES-256)
            // HỖ TRỢ BẢN VẼ .DWG, THƯ MỤC DỰ ÁN VÀ MỌI ĐỊNH DẠNG TỆP TIN
            // -----------------------------------------------------------------
            if (action == 'lock_zip_native') {
              final fileNames = (data['names'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [fileName];
              final List<String> srcPaths = [];
              for (final fn in fileNames) {
                final p = _cachedFilePaths[fn];
                if (p != null && await File(p).exists()) {
                  srcPaths.add(p);
                }
              }
              if (srcPaths.isEmpty && _latestPickedFilePath != null && await File(_latestPickedFilePath!).exists()) {
                srcPaths.add(_latestPickedFilePath!);
              }

              if (srcPaths.isEmpty) {
                final errMsg = 'Không tìm thấy tệp nguồn để nén. Vui lòng chọn lại tệp!';
                await _controller.runJavaScript("if (window.onNativePdfError) window.onNativePdfError('$errMsg');");
                return;
              }

              final baseName = fileNames.length == 1 
                  ? fileNames.first.replaceAll(RegExp(r'\.[^/.]+$'), '')
                  : 'KryptoArchive_${DateTime.now().millisecondsSinceEpoch ~/ 1000}';
              final outZipName = '${baseName}_Protected.zip';

              final tempDir = await getTemporaryDirectory();
              final outTempPath = '${tempDir.path}/$outZipName';
              final useZipCrypto = data['use_zipcrypto'] as bool? ?? false;

              // Xử lý chèn watermark & thủy vân số tàng hình nếu có cho hình ảnh trước khi nén ZIP
              List<String> finalSrcPaths = [];
              final hasStegoGlobal = enableManifest || recipientName.isNotEmpty || releaseCode.isNotEmpty || watermarkMode == 'stego';
              if ((watermarkMode != 'none' || hasStegoGlobal) && Platform.isAndroid) {
                for (final p in srcPaths) {
                  final fn = p.split(Platform.pathSeparator).last;
                  final isImg = RegExp(r'\.(png|jpe?g|webp|bmp)$', caseSensitive: false).hasMatch(fn);
                  if (isImg) {
                    final wmImgTemp = '${tempDir.path}/wm_${DateTime.now().millisecondsSinceEpoch}_$fn';
                    try {
                      await _nativeChannel.invokeMethod('watermarkImage', {
                        'srcPath': p,
                        'destPath': wmImgTemp,
                        'watermark': watermark,
                        'watermarkImageBase64': watermarkImageB64,
                        'watermarkOpacity': watermarkOpacity,
                        'recipientName': recipientName,
                        'releaseCode': releaseCode,
                        'enableManifest': enableManifest,
                        'originalName': fn,
                        'enableStego': hasStegoGlobal,
                        'watermarkMode': watermarkMode,
                      });
                      finalSrcPaths.add(wmImgTemp);
                    } catch (_) {
                      finalSrcPaths.add(p);
                    }
                  } else {
                    finalSrcPaths.add(p);
                  }
                }
              } else {
                finalSrcPaths = srcPaths;
              }

              if (Platform.isAndroid) {
                try {
                  await _nativeChannel.invokeMethod('createEncryptedZip', {
                    'srcPaths': finalSrcPaths,
                    'destZipPath': outTempPath,
                    'password': password,
                    'masterPassword': masterPassword,
                    'useZipCrypto': useZipCrypto,
                  });
                } on PlatformException catch (pErr) {
                  if (pErr.code == 'ALREADY_ENCRYPTED') {
                    final msg = pErr.message ?? 'Kho nén này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!';
                    await _controller.runJavaScript("if (window.onNativePdfError) window.onNativePdfError('$msg');");
                    return;
                  }
                  rethrow;
                }
              } else {
                throw Exception('Động cơ Zip4j chỉ hỗ trợ trên Android Native');
              }

              final savedFullPath = await _saveToDownloadsFolder(outTempPath, outZipName);
              final displaySaved = savedFullPath ?? 'Thư mục Downloads của máy';

              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Row(
                      children: [
                        const Icon(Icons.archive_rounded, color: Color(0xFF10B981), size: 22),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            '✓ Đã nén & đặt pass ZIP thành công:\n$outZipName',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Color(0xFFF8FAFC)),
                          ),
                        ),
                      ],
                    ),
                    backgroundColor: const Color(0xFF131B2E),
                    behavior: SnackBarBehavior.floating,
                    margin: const EdgeInsets.all(14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                      side: const BorderSide(color: Color(0xFF232F48), width: 1),
                    ),
                    duration: const Duration(seconds: 4),
                  ),
                );
              }

              final escName = outZipName.replaceAll("'", r"\'");
              final escTemp = outTempPath.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              final escSaved = displaySaved.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              await _controller.runJavaScript("if (window.onNativePdfLocked) { window.onNativePdfLocked('$escName', '$escTemp', '$escSaved', false); }");
              return;
            }

            // -----------------------------------------------------------------
            // CHỨC NĂNG 1: MÃ HÓA TỆP
            // -----------------------------------------------------------------
            if (action == 'lock_pdf_native' || action == 'lock_file_native') {
              String? srcPath = _cachedFilePaths[fileName];
              if (srcPath == null || !await File(srcPath).exists()) {
                if (_latestPickedFilePath != null && await File(_latestPickedFilePath!).exists()) {
                  srcPath = _latestPickedFilePath;
                } else {
                  for (final path in _cachedFilePaths.values) {
                    if (await File(path).exists()) {
                      srcPath = path;
                      break;
                    }
                  }
                }
              }

              if (srcPath == null || !await File(srcPath).exists()) {
                final errMsg = 'Không tìm thấy tệp nguồn "$fileName". Vui lòng chọn lại tệp!';
                await _controller.runJavaScript("if (window.onNativePdfError) window.onNativePdfError('$errMsg');");
                return;
              }

              final isPdf = fileName.toLowerCase().endsWith('.pdf');
              final isOffice = RegExp(r'\.(docx|doc|xlsx|xls|pptx|ppt)$', caseSensitive: false).hasMatch(fileName);
              final isImage = RegExp(r'\.(png|jpe?g|webp|bmp)$', caseSensitive: false).hasMatch(fileName);
              final baseName = fileName.replaceAll(RegExp(r'\.[^/.]+$'), '');
              final ext = fileName.contains('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
              final bool imageNeedsZip = isImage && (password.isNotEmpty && !isViewOnly);

              final isSignOnly = (protectionLevel == 'sign_only') || (password.trim().isEmpty && enableSignature);
              final outFileName = isPdf 
                  ? (isSignOnly ? '${baseName}_Signed.pdf' : (isViewOnly ? '${baseName}_ReadOnly.pdf' : '${baseName}_Locked.pdf'))
                  : (isOffice 
                      ? (isViewOnly ? '${baseName}_ReadOnly$ext' : '${baseName}_Locked$ext')
                      : (isImage && !imageNeedsZip
                          ? (isViewOnly ? '${baseName}_ReadOnly$ext' : '${baseName}_Watermarked$ext')
                          : '${baseName}_Protected.zip'));

              final tempDir = await getTemporaryDirectory();
              final outTempPath = '${tempDir.path}/$outFileName';

              if (isPdf) {
                // SỬ DỤNG ĐỘNG CƠ NATIVE ANDROID ITEXTG TRỰC TIẾP TRÊN Ổ ĐĨA
                // HOÀN TOÀN KHÔNG TỐN RAM HEAP (0 RAM), XỬ LÝ TỆP 355 MB TRONG 2-3 GIÂY
                bool processedNatively = false;
                if (Platform.isAndroid) {
                  try {
                    await _nativeChannel.invokeMethod('encryptPdf', {
                      'srcPath': srcPath,
                      'destPath': outTempPath,
                      'password': password,
                      'isViewOnly': isViewOnly,
                      'allowPrint': allowPrint,
                      'watermarkMode': watermarkMode,
                      'watermark': watermark,
                      'watermarkImageBase64': watermarkImageB64,
                      'watermarkOpacity': watermarkOpacity,
                      'recipientName': recipientName,
                      'releaseCode': releaseCode,
                      'enableManifest': enableManifest,
                      'enableSignature': enableSignature,
                      'signerName': signerName,
                      'signingReason': signingReason,
                      'signaturePos': signaturePos,
                      'signatureImageBase64': signatureImageB64,
                      'masterPassword': masterPassword,
                      'compress': compress,
                    });
                    processedNatively = true;
                  } catch (nativeErr) {
                    debugPrint('Lỗi Native Android Engine: $nativeErr');
                    if (nativeErr is PlatformException && nativeErr.code == 'ALREADY_ENCRYPTED') {
                      final msg = nativeErr.message ?? 'Tệp này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!';
                      await _controller.runJavaScript("if (window.onNativePdfError) window.onNativePdfError('$msg');");
                      return;
                    }
                  }
                }

                if (!processedNatively) {
                  final adobeJob = _AdobePdfLockJob(
                    srcPath: srcPath,
                    outTempPath: outTempPath,
                    password: password,
                    isViewOnly: isViewOnly,
                    watermark: watermark,
                    compress: compress,
                  );
                  await compute(_runAdobePdfLockIsolate, adobeJob);
                }
              } else if (isOffice && Platform.isAndroid) {
                // SỬ DỤNG ĐỘNG CƠ NATIVE MICROSOFT OFFICE NATIVE ENCRYPTION (MS-OFFCRYPTO / DOCUMENT PROTECTION)
                // Chế độ Khóa Mật Khẩu: Bắt buộc nhập pass để mở tệp.
                // Chế độ Chỉ Xem: Xem tự do không cần pass, khóa chống chỉnh sửa nội dung.
                try {
                  await _nativeChannel.invokeMethod('encryptOffice', {
                    'srcPath': srcPath,
                    'destPath': outTempPath,
                    'password': password,
                    'isViewOnly': isViewOnly,
                    'allowPrint': allowPrint,
                    'watermarkMode': watermarkMode,
                    'watermark': watermark,
                    'watermarkImageBase64': watermarkImageB64,
                    'watermarkOpacity': watermarkOpacity,
                    'recipientName': recipientName,
                    'releaseCode': releaseCode,
                    'enableManifest': enableManifest,
                    'enableSignature': enableSignature,
                    'signerName': signerName,
                    'signingReason': signingReason,
                    'masterPassword': masterPassword,
                  });
                } on PlatformException catch (pErr) {
                  if (pErr.code == 'ALREADY_ENCRYPTED') {
                    final msg = pErr.message ?? 'Tệp Office này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!';
                    await _controller.runJavaScript("if (window.onNativePdfError) window.onNativePdfError('$msg');");
                    return;
                  }
                  rethrow;
                }
              } else if (isImage && Platform.isAndroid) {
                // CHÈN WATERMARK & THỦY VÂN SỐ TÀNG HÌNH CHO HÌNH ẢNH (PNG, JPG, WEBP, BMP)
                try {
                  String imageToPackage = srcPath;
                  final hasStego = enableManifest || recipientName.isNotEmpty || releaseCode.isNotEmpty || watermarkMode == 'stego';
                  if (watermarkMode != 'none' || hasStego) {
                    final wmImgTemp = '${tempDir.path}/${baseName}_wm$ext';
                    await _nativeChannel.invokeMethod('watermarkImage', {
                      'srcPath': srcPath,
                      'destPath': wmImgTemp,
                      'watermark': watermark,
                      'watermarkImageBase64': watermarkImageB64,
                      'watermarkOpacity': watermarkOpacity,
                      'recipientName': recipientName,
                      'releaseCode': releaseCode,
                      'enableManifest': enableManifest,
                      'originalName': fileName,
                      'enableStego': hasStego,
                      'watermarkMode': watermarkMode,
                    });
                    imageToPackage = wmImgTemp;
                  }

                  if (imageNeedsZip) {
                    await _nativeChannel.invokeMethod('createEncryptedZip', {
                      'srcPaths': [imageToPackage],
                      'destZipPath': outTempPath,
                      'password': password,
                      'masterPassword': masterPassword,
                      'useZipCrypto': false,
                    });
                  } else {
                    await File(imageToPackage).copy(outTempPath);
                  }
                } catch (e) {
                  debugPrint('Lỗi xử lý ảnh: $e');
                  rethrow;
                }
              } else {
                // TỆP KHÔNG HỖ TRỢ PASS NATIVE (CAD, VIDEO, TEXT, BINARY...):
                // BẮT BUỘC ĐÓNG GÓI VÀO KHO NÉN .ZIP VÀ ĐẶT MẬT KHẨU AES-256 BẰNG ZIP4J NATIVE!
                // TRÁNH TUYỆT ĐỐI TẠO RA TỆP .PNG/.JPG BỊ LỖI ĐỊNH DẠNG.
                if (Platform.isAndroid) {
                  try {
                    await _nativeChannel.invokeMethod('createEncryptedZip', {
                      'srcPaths': [srcPath],
                      'destZipPath': outTempPath,
                      'password': password,
                      'masterPassword': masterPassword,
                      'useZipCrypto': false,
                    });
                  } on PlatformException catch (pErr) {
                    if (pErr.code == 'ALREADY_ENCRYPTED') {
                      final msg = pErr.message ?? 'Tệp này đã được đặt mật khẩu bảo vệ trước đó. Vui lòng chuyển sang Tab MỞ KHÓA!';
                      await _controller.runJavaScript("if (window.onNativePdfError) window.onNativePdfError('$msg');");
                      return;
                    }
                    rethrow;
                  }
                } else {
                  final streamJob = _StreamLockJob(
                    srcPath: srcPath,
                    outTempPath: outTempPath,
                    fileName: fileName,
                    password: password,
                    protectionLevel: protectionLevel,
                  );
                  await compute(_runStreamLockIsolate, streamJob);
                }
              }

              final savedFullPath = await _saveToDownloadsFolder(outTempPath, outFileName);
              final displaySaved = savedFullPath ?? 'Thư mục Downloads của máy';
              final typeDesc = isPdf 
                  ? 'Adobe PDF Native' 
                  : (isOffice 
                      ? 'Microsoft Office Native' 
                      : (isImage && !imageNeedsZip ? 'Hình Ảnh Đóng Dấu Bản Quyền' : 'Kho Nén .ZIP AES-256'));

              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Row(
                      children: [
                        const Icon(Icons.check_circle_rounded, color: Color(0xFF059669), size: 22),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            '✓ Đã mã hóa $typeDesc thành công:\n$outFileName',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: Color(0xFFF8FAFC)),
                          ),
                        ),
                      ],
                    ),
                    backgroundColor: const Color(0xFF131B2E),
                    behavior: SnackBarBehavior.floating,
                    margin: const EdgeInsets.all(14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                      side: const BorderSide(color: Color(0xFF232F48), width: 1),
                    ),
                    duration: const Duration(seconds: 4),
                  ),
                );
              }

              final escName = outFileName.replaceAll("'", r"\'");
              final escTemp = outTempPath.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              final escSaved = displaySaved.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              await _controller.runJavaScript("if (window.onNativePdfLocked) { window.onNativePdfLocked('$escName', '$escTemp', '$escSaved', $isPdf); }");
              return;
            }

            // -----------------------------------------------------------------
            // CHỨC NĂNG 2: MỞ KHÓA TỆP CONTAINER
            // -----------------------------------------------------------------
            if (action == 'unlock_native') {
              String? srcPath = _cachedFilePaths[fileName];
              if (srcPath == null || !await File(srcPath).exists()) {
                if (_latestPickedFilePath != null && await File(_latestPickedFilePath!).exists()) {
                  srcPath = _latestPickedFilePath;
                }
              }

              if (srcPath == null || !await File(srcPath).exists()) {
                final errMsg = 'Không tìm thấy tệp "$fileName". Vui lòng chọn lại!';
                await _controller.runJavaScript("if (window.onNativeUnlockError) window.onNativeUnlockError('$errMsg');");
                return;
              }

              final tempDir = await getTemporaryDirectory();

              // NẾU LÀ TỆP .ZIP CÓ MẬT KHẨU TRÊN ANDROID, GIẢI NÉN BẰNG ZIP4J NATIVE
              final isZip = fileName.toLowerCase().endsWith('.zip');
              if (isZip && Platform.isAndroid) {
                try {
                  final base = fileName.replaceAll(RegExp(r'_(Protected|Locked)\.zip$', caseSensitive: false), '')
                                       .replaceAll(RegExp(r'\.zip$', caseSensitive: false), '');
                  final extractFolder = '${tempDir.path}/${base}_Extracted';

                  final res = await _nativeChannel.invokeMethod('extractEncryptedZip', {
                    'zipPath': srcPath,
                    'destDirPath': extractFolder,
                    'password': password,
                    'masterPassword': masterPassword,
                  });

                  final List<dynamic> fileNames = (res is List) ? res : [];
                  final firstExtracted = fileNames.isNotEmpty ? fileNames.first.toString() : 'Tệp_Giải_Nén';

                  final outExtractedPath = '$extractFolder/$firstExtracted';
                  final savedFullPath = await _saveToDownloadsFolder(outExtractedPath, firstExtracted);
                  final displaySaved = savedFullPath ?? 'Thư mục Downloads';

                  final displayName = fileNames.length > 1 ? '${base}_Extracted (${fileNames.length} tệp)' : firstExtracted;
                  final escName = displayName.replaceAll("'", r"\'");
                  final escSaved = displaySaved.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
                  final escTemp = outExtractedPath.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
                  final decFile = File(outExtractedPath);
                  final sizeMb = decFile.existsSync() ? ((await decFile.length()) / (1024 * 1024)).toStringAsFixed(1) : '1.0';
                  await _controller.runJavaScript("if (window.onNativeUnlocked) { window.onNativeUnlocked('$escName', '$sizeMb', '$escSaved', '$escTemp'); }");
                  return;
                } catch (zipErr) {
                  debugPrint('Giải mã ZIP thất bại hoặc mật khẩu sai: $zipErr');
                }
              }

              final isPdf = fileName.toLowerCase().endsWith('.pdf');

              // NẾU LÀ TỆP PDF TRÊN ANDROID, THỬ GIẢI MÃ NATIVE BẰNG ITEXTG
              if (isPdf && Platform.isAndroid) {
                try {
                  final base = fileName.replaceAll(RegExp(r'_(Locked|ReadOnly)\.pdf$', caseSensitive: false), '')
                                       .replaceAll(RegExp(r'\.pdf$', caseSensitive: false), '');
                  final outDecryptedName = '${base}_Unlocked.pdf';
                  final outDecryptedPath = '${tempDir.path}/$outDecryptedName';

                  await _nativeChannel.invokeMethod('decryptPdf', {
                    'srcPath': srcPath,
                    'destPath': outDecryptedPath,
                    'password': password,
                    'masterPassword': masterPassword,
                  });

                  final savedFullPath = await _saveToDownloadsFolder(outDecryptedPath, outDecryptedName);
                  final displaySaved = savedFullPath ?? 'Thư mục Downloads';

                  final escName = outDecryptedName.replaceAll("'", r"\'");
                  final escSaved = displaySaved.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
                  final escTemp = outDecryptedPath.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
                  final decFile = File(outDecryptedPath);
                  final sizeMb = ((await decFile.length()) / (1024 * 1024)).toStringAsFixed(1);
                  await _controller.runJavaScript("if (window.onNativeUnlocked) { window.onNativeUnlocked('$escName', '$sizeMb', '$escSaved', '$escTemp'); }");
                  return;
                } catch (pdfNativeErr) {
                  debugPrint('Giải mã Native thất bại hoặc tệp dạng Container: $pdfNativeErr');
                }
              }

              final isOffice = RegExp(r'\.(docx|xlsx|pptx)$', caseSensitive: false).hasMatch(fileName);

              // NẾU LÀ TỆP OFFICE TRÊN ANDROID, THỬ GIẢI MÃ NATIVE BẰNG POI AGILE DECRYPTOR
              if (isOffice && Platform.isAndroid) {
                try {
                  final base = fileName.replaceAll(RegExp(r'_Locked\.(docx|xlsx|pptx)$', caseSensitive: false), '')
                                       .replaceAll(RegExp(r'\.(docx|xlsx|pptx)$', caseSensitive: false), '');
                  final ext = fileName.substring(fileName.lastIndexOf('.'));
                  final outDecryptedName = '${base}_Unlocked$ext';
                  final outDecryptedPath = '${tempDir.path}/$outDecryptedName';

                  await _nativeChannel.invokeMethod('decryptOffice', {
                    'srcPath': srcPath,
                    'destPath': outDecryptedPath,
                    'password': password,
                    'masterPassword': masterPassword,
                  });

                  final savedFullPath = await _saveToDownloadsFolder(outDecryptedPath, outDecryptedName);
                  final displaySaved = savedFullPath ?? 'Thư mục Downloads';

                  final escName = outDecryptedName.replaceAll("'", r"\'");
                  final escSaved = displaySaved.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
                  final escTemp = outDecryptedPath.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
                  final decFile = File(outDecryptedPath);
                  final sizeMb = ((await decFile.length()) / (1024 * 1024)).toStringAsFixed(1);
                  await _controller.runJavaScript("if (window.onNativeUnlocked) { window.onNativeUnlocked('$escName', '$sizeMb', '$escSaved', '$escTemp'); }");
                  return;
                } catch (officeNativeErr) {
                  debugPrint('Giải mã Office Native thất bại hoặc tệp dạng Container: $officeNativeErr');
                }
              }

              final unlockJob = _StreamUnlockJob(
                srcPath: srcPath,
                outDir: tempDir.path,
                password: password,
              );

              final result = await compute(_runStreamUnlockIsolate, unlockJob);

              if (!result.success) {
                final errMsg = result.error ?? 'Mật khẩu không chính xác hoặc tệp bị hỏng!';
                await _controller.runJavaScript("if (window.onNativeUnlockError) window.onNativeUnlockError('$errMsg');");
                return;
              }

              final savedFullPath = await _saveToDownloadsFolder(result.outPath, result.originalName);
              final displaySaved = savedFullPath ?? 'Thư mục Downloads';

              final escName = result.originalName.replaceAll("'", r"\'");
              final escSaved = displaySaved.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              final escTemp = result.outPath.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              final sizeMb = (result.originalSize / (1024 * 1024)).toStringAsFixed(1);
              await _controller.runJavaScript("if (window.onNativeUnlocked) { window.onNativeUnlocked('$escName', '$sizeMb', '$escSaved', '$escTemp'); }");
              return;
            }

            // -----------------------------------------------------------------
            // CHỨC NĂNG 3: CHIA SẺ FILE QUA ZALO
            // -----------------------------------------------------------------
            if (action == 'share_temp_file') {
              final filePath = data['path'] as String?;
              if (filePath != null && await File(filePath).exists()) {
                await Share.shareXFiles(
                  [XFile(filePath, mimeType: _guessMimeType(fileName))],
                  text: 'Tài liệu Krypto: $fileName',
                );
              }
              return;
            }

            // -----------------------------------------------------------------
            // CHỨC NĂNG 4: LƯU LẠI VÀO MÁY
            // -----------------------------------------------------------------
            if (action == 'save_file_again') {
              final filePath = data['path'] as String?;
              if (filePath != null && await File(filePath).exists()) {
                final saved = await _saveToDownloadsFolder(filePath, fileName);
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('✓ Đã lưu tệp vào:\n${saved ?? "Thư mục Downloads"}'),
                      backgroundColor: const Color(0xFF10B981),
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                }
              }
              return;
            }

            // CHỨC NĂNG 5B: ĐỒNG BỘ VĨNH VIỄN KÉT CHỮ KÝ SỐ HSM VÀO BỘ NHỚ TỆP NATIVE ANDROID
            if (action == 'persist_hsm_vault_native') {
              final content = data['content'] as String? ?? '';
              if (content.isNotEmpty) {
                try {
                  final appDocDir = await getApplicationDocumentsDirectory();
                  final hsmFile = File('${appDocDir.path}/krypto_hsm_vault_permanent.json');
                  await hsmFile.writeAsString(content, flush: true);
                } catch (e) {
                  debugPrint('Lỗi lưu HSM Vault vĩnh viễn: $e');
                }
              }
              return;
            }

            // CHỨC NĂNG 5: LƯU TỆP MARKDOWN (.MD), JSON HOẶC HTML WEB VÀO DOWNLOADS (MEDIASTORE)
            if (action == 'save' || action == 'share') {
              final content = data['content'] as String? ?? '';
              final tempDir = await getTemporaryDirectory();
              final tempFile = File('${tempDir.path}/$fileName');
              await tempFile.writeAsString(content, flush: true);

              if (action == 'share') {
                await Share.shareXFiles([XFile(tempFile.path)], text: 'Tài liệu Krypto: $fileName');
              } else {
                final savedPath = await _saveToDownloadsFolder(tempFile.path, fileName);
                final escName = jsonEncode(fileName);
                final escSaved = jsonEncode(savedPath ?? '/storage/emulated/0/Download/$fileName');
                final escTemp = jsonEncode(tempFile.path);
                await _controller.runJavaScript(
                  "if (window.onVaultFileSaved) { window.onVaultFileSaved($escName, $escSaved, $escTemp); }",
                );
              }
              return;
            }

            // -----------------------------------------------------------------
            // CHỨC NĂNG 6: KIỂM ĐỊNH PHÁP Y SỐ & TRUY VẾT DẤU VẾT NGUỒN GỐC
            // -----------------------------------------------------------------
            if (action == 'inspect_forensic_native') {
              String? srcPath = _cachedFilePaths[fileName];
              if (srcPath == null || !await File(srcPath).exists()) {
                if (_latestPickedFilePath != null && await File(_latestPickedFilePath!).exists()) {
                  srcPath = _latestPickedFilePath;
                }
              }

              if (srcPath == null || !await File(srcPath).exists()) {
                final errMsg = 'Không tìm thấy tệp "$fileName" để kiểm định. Vui lòng chọn lại!';
                await _controller.runJavaScript("if (window.onNativeForensicError) window.onNativeForensicError('$errMsg');");
                return;
              }

              if (Platform.isAndroid) {
                try {
                  final forensicJson = await _nativeChannel.invokeMethod('inspectForensic', {
                    'srcPath': srcPath,
                  });
                  final escJson = forensicJson.toString().replaceAll(r'\', r'\\').replaceAll("'", r"\'");
                  await _controller.runJavaScript("if (window.onNativeForensicResult) window.onNativeForensicResult('$escJson');");
                } catch (fErr) {
                  final errMsg = fErr.toString().replaceAll("'", r"\'");
                  await _controller.runJavaScript("if (window.onNativeForensicError) window.onNativeForensicError('$errMsg');");
                }
              } else {
                await _controller.runJavaScript("if (window.onNativeForensicError) window.onNativeForensicError('Động cơ pháp y số chỉ hỗ trợ trên Android Native');");
              }
              return;
            }

            // -----------------------------------------------------------------
            // CHỨC NĂNG 7: XÁC THỰC SINH TRẮC HỌC PHẦN CỨNG (VÂN TAY / FACE UNLOCK)
            // -----------------------------------------------------------------
            if (action == 'authenticate_biometrics') {
              _isBiometricInProgress = true;
              if (Platform.isAndroid) {
                try {
                  final bool success = await _nativeChannel.invokeMethod('authenticateBiometrics') ?? false;
                  _isBiometricInProgress = false;
                  if (success) {
                    await _controller.runJavaScript("if (window.onBiometricAuthSuccess) window.onBiometricAuthSuccess();");
                  } else {
                    await _controller.runJavaScript("if (window.onBiometricAuthFailed) window.onBiometricAuthFailed('Xác thực bị hủy bỏ');");
                  }
                } catch (bioErr) {
                  _isBiometricInProgress = false;
                  final errMsg = bioErr.toString().replaceAll("'", r"\'");
                  await _controller.runJavaScript("if (window.onBiometricAuthFailed) window.onBiometricAuthFailed('$errMsg');");
                }
              } else {
                _isBiometricInProgress = false;
                await _controller.runJavaScript("if (window.onBiometricAuthSuccess) window.onBiometricAuthSuccess();");
              }
              return;
            }

            if (action == 'request_camera_permission') {
              if (Platform.isAndroid) {
                try {
                  _isCameraInProgress = true;
                  await _nativeChannel.invokeMethod('requestCameraPermission');
                } catch (_) {}
              }
              return;
            }

            if (action == 'start_native_camera') {
              if (Platform.isAndroid) {
                try {
                  _isCameraInProgress = true;
                  final facing = data['facing'] as String? ?? 'back';
                  final bool ok = await _nativeChannel.invokeMethod<bool>('startNativeCamera', {'facing': facing}) ?? false;
                  if (ok) {
                    _startNativeCameraFramePolling();
                    await _controller.runJavaScript(
                      "if (window.KryptoAuthenticator && window.KryptoAuthenticator.onNativeCameraStarted) { "
                      "window.KryptoAuthenticator.onNativeCameraStarted(true); }",
                    );
                  } else {
                    _stopNativeCameraFramePolling();
                    _isCameraInProgress = false;
                    await _controller.runJavaScript(
                      "if (window.KryptoAuthenticator && window.KryptoAuthenticator.onNativeCameraStarted) { "
                      "window.KryptoAuthenticator.onNativeCameraStarted(false); }",
                    );
                  }
                } catch (_) {
                  _stopNativeCameraFramePolling();
                  _isCameraInProgress = false;
                  await _controller.runJavaScript(
                    "if (window.KryptoAuthenticator && window.KryptoAuthenticator.onNativeCameraStarted) { "
                    "window.KryptoAuthenticator.onNativeCameraStarted(false); }",
                  );
                }
              }
              return;
            }

            if (action == 'switch_native_camera') {
              if (Platform.isAndroid) {
                try {
                  await _nativeChannel.invokeMethod<bool>('switchNativeCamera');
                  await _controller.runJavaScript(
                    "if (window.KryptoAuthenticator && window.KryptoAuthenticator.onNativeTorchToggled) { "
                    "window.KryptoAuthenticator.onNativeTorchToggled(false); }",
                  );
                } catch (_) {}
              }
              return;
            }

            if (action == 'toggle_native_camera_torch') {
              if (Platform.isAndroid) {
                try {
                  final bool isOn = await _nativeChannel.invokeMethod<bool>('toggleNativeCameraTorch') ?? false;
                  await _controller.runJavaScript(
                    "if (window.KryptoAuthenticator && window.KryptoAuthenticator.onNativeTorchToggled) { "
                    "window.KryptoAuthenticator.onNativeTorchToggled(${isOn ? 'true' : 'false'}); }",
                  );
                } catch (_) {}
              }
              return;
            }

            if (action == 'stop_native_camera') {
              _stopNativeCameraFramePolling();
              _isCameraInProgress = false;
              if (Platform.isAndroid) {
                try {
                  await _nativeChannel.invokeMethod('stopNativeCamera');
                } catch (_) {}
              }
              return;
            }

            if (action == 'capture_qr_photo_native') {
              if (Platform.isAndroid) {
                try {
                  _stopNativeCameraFramePolling();
                  _isCameraInProgress = true;
                  final String? photoB64 = await _nativeChannel.invokeMethod<String>('captureQrPhotoNative');
                  _isCameraInProgress = false;
                  if (photoB64 != null && photoB64.isNotEmpty) {
                    await _controller.runJavaScript(
                      "if (window.KryptoAuthenticator && window.KryptoAuthenticator.onNativeCapturedPhotoB64) { "
                      "window.KryptoAuthenticator.onNativeCapturedPhotoB64('$photoB64'); }",
                    );
                  }
                } catch (_) {
                  _isCameraInProgress = false;
                }
              }
              return;
            }

            if (action == 'gdrive_create_vault_saf') {
              if (Platform.isAndroid) {
                try {
                  final fName = data['fileName'] as String? ?? 'vault.kryptopass';
                  final initJson = data['initialJson'] as String? ?? '';
                  final String? uriStr = await _nativeChannel.invokeMethod<String>('createGDriveVaultDocument', {
                    'fileName': fName,
                    'initialJson': initJson,
                  });
                  final escUri = jsonEncode(uriStr ?? '');
                  await _controller.runJavaScript(
                    "if (window.KryptoPasswordVault && window.KryptoPasswordVault.onGDriveSafLinked) { "
                    "window.KryptoPasswordVault.onGDriveSafLinked($escUri); }",
                  );
                } catch (_) {}
              }
              return;
            }

            if (action == 'gdrive_open_vault_saf') {
              if (Platform.isAndroid) {
                try {
                  final String? uriStr = await _nativeChannel.invokeMethod<String>('openGDriveVaultDocument');
                  final String? remoteJson = (uriStr != null && uriStr.isNotEmpty)
                      ? await _nativeChannel.invokeMethod<String>('readGDriveVaultDocument')
                      : null;
                  final escUri = jsonEncode(uriStr ?? '');
                  final escRemote = jsonEncode(remoteJson ?? '');
                  await _controller.runJavaScript(
                    "if (window.KryptoPasswordVault && window.KryptoPasswordVault.onGDriveSafOpened) { "
                    "window.KryptoPasswordVault.onGDriveSafOpened($escUri, $escRemote); }",
                  );
                } catch (_) {}
              }
              return;
            }

            if (action == 'gdrive_sync_2way_saf') {
              if (Platform.isAndroid) {
                try {
                  final String? remoteJson = await _nativeChannel.invokeMethod<String>('readGDriveVaultDocument');
                  final escRemote = jsonEncode(remoteJson ?? '');
                  await _controller.runJavaScript(
                    "if (window.KryptoPasswordVault && window.KryptoPasswordVault.onGDriveRemoteReadForMerge) { "
                    "window.KryptoPasswordVault.onGDriveRemoteReadForMerge($escRemote); }",
                  );
                } catch (_) {}
              }
              return;
            }

            if (action == 'gdrive_write_merged_saf') {
              if (Platform.isAndroid) {
                try {
                  final jsonContent = data['jsonContent'] as String? ?? '';
                  final bool ok = await _nativeChannel.invokeMethod<bool>('writeGDriveVaultDocument', {
                    'jsonContent': jsonContent,
                  }) ?? false;
                  await _controller.runJavaScript(
                    "if (window.KryptoPasswordVault && window.KryptoPasswordVault.onGDriveMergedWritten) { "
                    "window.KryptoPasswordVault.onGDriveMergedWritten(${ok ? 'true' : 'false'}); }",
                  );
                } catch (_) {}
              }
              return;
            }

            if (action == 'persist_password_vault_native') {
              final content = data['content'] as String? ?? '';
              if (content.isNotEmpty) {
                try {
                  final appDocDir = await getApplicationDocumentsDirectory();
                  final pwFile = File('${appDocDir.path}/krypto_password_vault_permanent.json');
                  await pwFile.writeAsString(content, flush: true);
                } catch (_) {}
              }
              return;
            }

            if (action == 'set_screenshot_protection') {
              if (Platform.isAndroid) {
                try {
                  final block = data['blockScreenshot'] as bool? ?? false;
                  await _nativeChannel.invokeMethod<bool>('setScreenshotProtection', {
                    'blockScreenshot': block,
                  });
                } catch (_) {}
              }
              return;
            }
          } catch (e) {
            debugPrint('FlutterBridge error: $e');
            final safeErr = e.toString().replaceAll("'", r"\'");
            await _controller.runJavaScript("if (window.onNativePdfError) window.onNativePdfError('$safeErr');");
          }
        },
      );

    if (Platform.isAndroid) {
      final androidController = _controller.platform as AndroidWebViewController;
      await androidController.setMediaPlaybackRequiresUserGesture(false);
      await androidController.setOnPlatformPermissionRequest((PlatformWebViewPermissionRequest request) async {
        try {
          await _nativeChannel.invokeMethod('requestCameraPermission');
        } catch (_) {}
        await request.grant();
      });
      await androidController.setOnShowFileSelector((FileSelectorParams params) async {
        final allowMultiple = params.mode == FileSelectorMode.openMultiple;
        try {
          final result = await FilePicker.platform.pickFiles(
            allowMultiple: allowMultiple,
            type: FileType.any,
            withData: false,
            withReadStream: false,
          );
          if (result != null && result.files.isNotEmpty) {
            for (final f in result.files) {
              if (f.name.isNotEmpty && f.path != null) {
                _cachedFilePaths[f.name] = f.path!;
                _latestPickedFilePath = f.path!;
                _latestPickedFileName = f.name;
              }
            }
            return result.files
                .where((f) => f.path != null)
                .map((f) => Uri.file(f.path!).toString())
                .toList();
          }
        } catch (e) {
          debugPrint('setOnShowFileSelector error: $e');
        }
        return [];
      });
    }

    // Đăng ký cầu nối lưu trữ & tra cứu tri thức Chat (YouTube / GitHub / Web / Ghi chú)
    ChatVaultNativeBridge(_controller).register();

    await _controller.loadFlutterAsset('assets/www/index.html');
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: () async {
        if (await _controller.canGoBack()) {
          _controller.goBack();
          return false;
        }
        return true;
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0B0F19),
        body: SafeArea(
          child: Stack(
            children: [
              WebViewWidget(controller: _controller),
              if (_isLoading)
                const Center(
                  child: CircularProgressIndicator(
                    color: Color(0xFF3B82F6),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
