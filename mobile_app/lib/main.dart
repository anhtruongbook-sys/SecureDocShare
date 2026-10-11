import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:file_picker/file_picker.dart';
import 'package:share_plus/share_plus.dart';
import 'package:path_provider/path_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0A0E17),
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
        scaffoldBackgroundColor: const Color(0xFF0A0E17),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF2563EB),
          secondary: Color(0xFF10B981),
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

class _SecureDocWebViewScreenState extends State<SecureDocWebViewScreen> {
  late final WebViewController _controller;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _initController();
  }

  void _initController() async {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0A0E17))
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
            final fileName = data['name'] as String? ?? 'SecureDoc_Protected.html';
            
            File savedFile;
            final tempDir = await getTemporaryDirectory();
            savedFile = File('${tempDir.path}/$fileName');

            if (data.containsKey('base64')) {
              final bytes = base64Decode(data['base64'] as String);
              await savedFile.writeAsBytes(bytes);
            } else {
              final content = data['content'] as String? ?? '';
              await savedFile.writeAsString(content, encoding: utf8);
            }

            if (action == 'share' || action == 'share_binary') {
              await Share.shareXFiles(
                [XFile(savedFile.path)],
                text: 'Tài liệu bảo mật $fileName (SecureDocShare)',
              );
            } else if (action == 'save' || action == 'save_binary') {
              bool savedPublic = false;
              String targetPath = savedFile.path;

              // Thử lưu trực tiếp vào thư mục Downloads công khai của Android
              try {
                final downloadDir = Directory('/storage/emulated/0/Download');
                if (await downloadDir.exists()) {
                  final target = File('${downloadDir.path}/$fileName');
                  if (data.containsKey('base64')) {
                    final bytes = base64Decode(data['base64'] as String);
                    await target.writeAsBytes(bytes);
                  } else {
                    final content = data['content'] as String? ?? '';
                    await target.writeAsString(content, encoding: utf8);
                  }
                  savedPublic = true;
                  targetPath = target.path;
                }
              } catch (e) {
                debugPrint('Direct Downloads write error: $e');
              }

              if (mounted) {
                if (savedPublic) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Row(
                        children: [
                          const Icon(Icons.check_circle, color: Colors.white),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Đã lưu thành công vào mục Tải về (Downloads):\n$fileName',
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                          ),
                        ],
                      ),
                      backgroundColor: const Color(0xFF10B981),
                      duration: const Duration(seconds: 5),
                      behavior: SnackBarBehavior.floating,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  );
                } else {
                  // Mở hộp thoại Share Sheet để người dùng bấm "Lưu vào thiết bị" hoặc gửi Zalo/Drive
                  await Share.shareXFiles(
                    [XFile(savedFile.path)],
                    text: 'Lưu tệp bảo mật $fileName',
                  );
                }
              }
            }
          } catch (e) {
            debugPrint('FlutterBridge error: $e');
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Lỗi xử lý tệp: $e'),
                  backgroundColor: Colors.red,
                ),
              );
            }
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
          );
          if (result != null && result.files.isNotEmpty) {
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
                    color: Color(0xFF2563EB),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
