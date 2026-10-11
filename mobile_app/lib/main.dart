import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:file_picker/file_picker.dart';

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
        'FlutterFilePicker',
        onMessageReceived: (JavaScriptMessage message) async {
          final context = message.message; // 'lock' or 'unlock'
          final allowMultiple = (context == 'lock');
          try {
            final result = await FilePicker.platform.pickFiles(
              allowMultiple: allowMultiple,
              withData: true,
              type: FileType.any,
            );
            if (result != null && result.files.isNotEmpty) {
              final List<Map<String, dynamic>> fileList = [];
              for (final f in result.files) {
                if (f.bytes != null) {
                  fileList.add({
                    'name': f.name,
                    'size': f.size,
                    'bytes': base64Encode(f.bytes!),
                  });
                }
              }
              final payload = jsonEncode({
                'context': context,
                'files': fileList,
              });
              final escaped = payload.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
              await _controller.runJavaScript("if (window.onFlutterFilesPicked) { window.onFlutterFilesPicked('$escaped'); }");
            }
          } catch (e) {
            debugPrint('FilePicker JavaScriptChannel error: $e');
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
