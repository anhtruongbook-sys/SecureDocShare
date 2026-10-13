import urllib.request
import json
import os
import qrcode

apk_path = r'C:\Books\Common Study\SecureDocShare\build-output\KryptoDoc.apk'
print(f'File size: {os.path.getsize(apk_path)} bytes')

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
with open(apk_path, 'rb') as f:
    file_bytes = f.read()

header = (
    f'--{boundary}\r\n'
    f'Content-Disposition: form-data; name="file"; filename="KryptoDoc_v2.6.3.apk"\r\n'
    f'Content-Type: application/vnd.android.package-archive\r\n\r\n'
).encode('utf-8')
footer = f'\r\n--{boundary}--\r\n'.encode('utf-8')
body = header + file_bytes + footer

req = urllib.request.Request('https://tmpfiles.org/api/v1/upload', data=body)
req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')

resp = urllib.request.urlopen(req, timeout=120)
res_json = json.loads(resp.read().decode())
print('Upload response:', res_json)

url = res_json['data']['url']
direct_url = url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/')
print('Direct URL:', direct_url)

with open('tmpfiles_url_v263.txt', 'w', encoding='utf-8') as out:
    out.write(direct_url)

qr = qrcode.QRCode(version=1, box_size=10, border=3)
qr.add_data(direct_url)
qr.make(fit=True)
img = qr.make_image(fill_color='black', back_color='white')
artifact_qr_path = r'C:\Users\Admin\.gemini\antigravity\brain\42a27254-df3e-4e60-9f7e-4bfcfa9b1391\qr_download_apk_v263_direct.png'
img.save(artifact_qr_path)
print('Saved QR to:', artifact_qr_path)
