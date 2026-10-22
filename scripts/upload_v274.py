import urllib.request
import json
import os

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
file_path = 'KryptoDoc.apk'
with open(file_path, 'rb') as f:
    file_bytes = f.read()

header = (
    f'--{boundary}\r\n'
    f'Content-Disposition: form-data; name="file"; filename="kryptodoc_v2.7.4.apk"\r\n'
    f'Content-Type: application/vnd.android.package-archive\r\n\r\n'
).encode('utf-8')
footer = f'\r\n--{boundary}--\r\n'.encode('utf-8')

body = header + file_bytes + footer

req = urllib.request.Request(
    'https://tmpfiles.org/api/v1/upload',
    data=body,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'User-Agent': 'Mozilla/5.0'}
)

try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        raw_url = res['data']['url']
        direct_url = raw_url.replace('tmpfiles.org/', 'tmpfiles.org/dl/')
        print('RAW_URL:', raw_url)
        print('DIRECT_URL:', direct_url)
        with open('tmpfiles_url_v274.txt', 'w', encoding='utf-8') as out:
            out.write(direct_url)
except Exception as e:
    print('ERROR:', e)
