import urllib.request
import urllib.error
import json

with open(r"C:\Users\Admin\.gemini\config\github_token.txt", "r", encoding="utf-8") as f:
    token = f.read().strip()


def gh_req(url, data=None, method="GET", content_type="application/json"):
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
    }
    body = None
    if data is not None:
        headers["Content-Type"] = content_type
        body = json.dumps(data).encode("utf-8") if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


code, rel = gh_req("https://api.github.com/repos/anhtruongbook-sys/SecureDocShare/releases/tags/v2.8.9")
rel_id = rel["id"]
for a in rel.get("assets", []):
    aid = a["id"]
    gh_req(f"https://api.github.com/repos/anhtruongbook-sys/SecureDocShare/releases/assets/{aid}", method="DELETE")

apk_path = r"c:\Books\Common Study\SecureDocShare\build-output\Krypto.apk"
with open(apk_path, "rb") as af:
    apk_bytes = af.read()

for asset_name in ["Krypto.apk", "KryptoDoc.apk"]:
    up_url = f"https://uploads.github.com/repos/anhtruongbook-sys/SecureDocShare/releases/{rel_id}/assets?name={asset_name}"
    sc, ares = gh_req(up_url, apk_bytes, "POST", "application/vnd.android.package-archive")
    print(f"Updated {asset_name}:", sc, ares.get("browser_download_url") if isinstance(ares, dict) else ares)
