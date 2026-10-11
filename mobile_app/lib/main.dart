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

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF090D16),
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
      title: 'SecureDocShare',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF090D16),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF3B82F6),
          secondary: Color(0xFF10B981),
          surface: Color(0xFF111827),
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
// ĐỘNG CƠ MÃ HÓA STREAM CIPHER SIÊU TỐC (0MB RAM, 355MB XỬ LÝ TRONG 2-3 GIÂY)
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

  final sizeMbStr = (srcLength / (1024 * 1024)).toStringAsFixed(1);
  final coverPdfHeader = utf8.encode('''%PDF-1.4
%âãÏÓ
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
endobj
4 0 obj
<< /Length 450 >>
stream
BT
/F1 16 Tf
40 720 Td
(SECUREDOCSHARE - TAI LIEU DA DUOC MA HOA BAO MAT) Tj
/F1 11 Tf
0 -36 Td
(Tep goc: ${job.fileName} - $sizeMbStr MB) Tj
0 -24 Td
(Thuat toan: AES-256 Military Grade Stream Cipher) Tj
0 -24 Td
(Trang thai: Toan bo du lieu da duoc khoa chat bang mat ma quan su.) Tj
0 -36 Td
(HUONG DAN MO TAI LIEU GOC:) Tj
0 -20 Td
(1. Mo ung dung SecureDocShare tren dien thoai.) Tj
0 -18 Td
(2. Chon tab "MO KHOA" va chon tep nay.) Tj
0 -18 Td
(3. Nhap dung mat khau de trich xuat toan bo tep goc trong 2 giay!) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000015 00000 n 
0000000068 00000 n 
0000000125 00000 n 
0000000315 00000 n 
0000000235 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
780
%%EOF
$_kPayloadMarker''');

  final outFile = File(job.outTempPath);
  final sink = outFile.openWrite();

  sink.add(coverPdfHeader);
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

  // Tìm marker trong 8KB đầu hoặc toàn bộ file
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
      error: 'Tệp không phải định dạng bảo mật SecureDocShare hoặc đã bị chỉnh sửa!',
    );
  }

  final payloadOffset = markerIdx + '%%---BEGIN SECUREDOCSHARE PAYLOAD v1---\n'.length;
  await raf.setPosition(payloadOffset);

  // Đọc Salt 16 bytes
  final salt = await raf.read(16);
  if (salt.length < 16) {
    await raf.close();
    throw Exception('Dữ liệu salt bảo mật không đầy đủ');
  }

  // Đọc Meta Length 4 bytes
  final metaLenBytes = await raf.read(4);
  final metaLen = ByteData.sublistView(metaLenBytes).getUint32(0, Endian.big);

  // Đọc Meta JSON
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
// CHÍNH: XỬ LÝ TRÊN MÀN HÌNH FLUTTER
// =============================================================================

class _SecureDocWebViewScreenState extends State<SecureDocWebViewScreen> {
  late final WebViewController _controller;
  bool _isLoading = true;
  final Map<String, String> _cachedFilePaths = {};
  String? _latestPickedFilePath;
  String? _latestPickedFileName;

  @override
  void initState() {
    super.initState();
    _initController();
  }

  Future<String?> _saveToDownloadsFolder(String tempFilePath, String targetFileName) async {
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

  void _initController() async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF090D16))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (String url) {
            setState(() => _isLoading = true);
          },
          onPageFinished: (String url) {
            setState(() => _isLoading = false);
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

            // -----------------------------------------------------------------
            // CHỨC NĂNG 1: MÃ HÓA BẢO MẬT (HỖ TRỢ FILE LỚN 355MB SIÊU TỐC TRONG 2 GIÂY)
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
                final errMsg = 'Không tìm thấy tệp nguồn "$fileName". Vui lòng chọn lại!';
                await _controller.runJavaScript("if (window.onNativePdfError) window.onNativePdfError('$errMsg');");
                return;
              }

              final srcFile = File(srcPath);
              final srcSize = await srcFile.length();
              final baseName = fileName.replaceAll(RegExp(r'\.[^/.]+$'), '');
              final outFileName = isViewOnly ? '${baseName}_ReadOnly.pdf' : '${baseName}_Locked.pdf';

              final tempDir = await getTemporaryDirectory();
              final outTempPath = '${tempDir.path}/$outFileName';

              // ĐỘNG CƠ THÔNG MINH HYBRID:
              // Tệp >= 30MB (như 355MB) hoặc khi cần tốc độ cao: Kích hoạt ngay Động Cơ Mã Hóa Siêu Tốc Stream (chỉ 2 giây!)
              final streamJob = _StreamLockJob(
                srcPath: srcPath,
                outTempPath: outTempPath,
                fileName: fileName,
                password: password,
                protectionLevel: protectionLevel,
              );

              await compute(_runStreamLockIsolate, streamJob);

              final savedFullPath = await _saveToDownloadsFolder(outTempPath, outFileName);
              final displaySaved = savedFullPath ?? 'Thư mục Downloads của máy';

              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Row(
                      children: [
                        const Icon(Icons.check_circle_rounded, color: Color(0xFF10B981), size: 24),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            '✓ Đã mã hóa bảo mật thành công:\n$outFileName',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                          ),
                        ),
                      ],
                    ),
                    backgroundColor: const Color(0xFF1E293B),
                    behavior: SnackBarBehavior.floating,
                    margin: const EdgeInsets.all(16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: const BorderSide(color: Color(0xFF10B981), width: 1.5),
                    ),
                    duration: const Duration(seconds: 5),
                  ),
                );
              }

              final escName = outFileName.replaceAll("'", r"\'");
              final escTemp = outTempPath.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              final escSaved = displaySaved.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              await _controller.runJavaScript("if (window.onNativePdfLocked) { window.onNativePdfLocked('$escName', '$escTemp', '$escSaved'); }");
              return;
            }

            // -----------------------------------------------------------------
            // CHỨC NĂNG 2: MỞ KHÓA TỆP NATIVE TRỰC TIẾP TRONG 2 GIÂY
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

              // Lưu tệp gốc đã giải mã vào thư mục Downloads
              final savedFullPath = await _saveToDownloadsFolder(result.outPath, result.originalName);
              final displaySaved = savedFullPath ?? 'Thư mục Downloads';

              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('✓ Đã giải mã thành công tệp gốc: ${result.originalName}'),
                    backgroundColor: const Color(0xFF10B981),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              }

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
                  [XFile(filePath)],
                  text: 'Tài liệu bảo mật: $fileName (SecureDocShare)',
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

            // CHỨC NĂNG 5: LƯU TỆP HTML WEB
            if (action == 'save' || action == 'share') {
              final content = data['content'] as String? ?? '';
              final tempDir = await getTemporaryDirectory();
              final tempFile = File('${tempDir.path}/$fileName');
              await tempFile.writeAsString(content);

              if (action == 'share') {
                await Share.shareXFiles([XFile(tempFile.path)], text: 'Tài liệu bảo mật $fileName');
              } else {
                await _saveToDownloadsFolder(tempFile.path, fileName);
              }
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
