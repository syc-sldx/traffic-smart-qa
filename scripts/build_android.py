"""Build and sign the dependency-free Android client using an installed Android SDK.

Defaults use the locally downloaded, checksum-verified tools under ignored outputs/.
The release key and its password stay under outputs/android-signing/ and are never
copied into the APK or the public source. Keep that folder for future updates.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "outputs/android-toolchain"
VERSION = "1.0.0"
VERSION_CODE = 1


def choose(variable, pattern):
    value = os.environ.get(variable)
    matches = [Path(value)] if value else list(TOOLS.glob(pattern))
    if len(matches) != 1 or not matches[0].is_file():
        raise RuntimeError("Set " + variable + " to a valid tool file: " + pattern)
    return matches[0].resolve()


def main():
    java = choose("TRAFFIC_ANDROID_JAVA", "jdk-21/*/bin/java.exe")
    javac = java.with_name("javac.exe")
    keytool = java.with_name("keytool.exe")
    aapt = choose("TRAFFIC_ANDROID_AAPT2", "build-tools-35.0.0/*/aapt2.exe")
    build_tools = aapt.parent
    android = choose("TRAFFIC_ANDROID_JAR", "platforms-android-35/*/android.jar")
    parent = ROOT / "outputs/android-build"
    parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="release-", dir=parent)).resolve()
    assert work.is_relative_to(parent.resolve())
    env = os.environ.copy()

    def run(args):
        result = subprocess.run([str(arg) for arg in args], cwd=ROOT, env=env, text=True, encoding="utf-8", errors="replace", capture_output=True)
        if result.returncode:
            raise RuntimeError(Path(str(args[0])).name + " failed:\n" + result.stdout + result.stderr)
        return result.stdout + result.stderr

    signing = ROOT / "outputs/android-signing"
    signing.mkdir(exist_ok=True)
    if os.name == "nt":
        identity = os.environ.get("USERDOMAIN", "") + "\\" + os.environ["USERNAME"]
        subprocess.run(["icacls", str(signing), "/inheritance:r", "/grant:r", identity + ":(OI)(CI)F", "SYSTEM:(OI)(CI)F"], check=True, capture_output=True)
    config = signing / "release.json"
    if not config.exists():
        config.write_text(json.dumps({"alias": "traffic-qa-release", "password": secrets.token_urlsafe(36)}), encoding="utf-8")
    credentials = json.loads(config.read_text(encoding="utf-8"))
    env["TRAFFIC_APK_STOREPASS"] = credentials["password"]
    keystore = signing / "traffic-qa-release.p12"
    if not keystore.exists():
        run([keytool, "-genkeypair", "-alias", credentials["alias"], "-keystore", keystore, "-storetype", "PKCS12", "-storepass:env", "TRAFFIC_APK_STOREPASS", "-keypass:env", "TRAFFIC_APK_STOREPASS", "-keyalg", "RSA", "-keysize", "3072", "-validity", "36500", "-dname", "CN=Traffic Smart QA,OU=Application,O=Traffic Smart QA,C=CN"])
    print("Release signing identity ready (private key remains local).", flush=True)
    checks = work / "checks"
    checks.mkdir()
    run([javac, "--release", "8", "-d", checks, ROOT / "android/src/cn/syc/trafficqa/UrlPolicy.java", ROOT / "android/test/cn/syc/trafficqa/UrlPolicyTest.java"])
    print(run([java, "-cp", checks, "cn.syc.trafficqa.UrlPolicyTest"]).strip(), flush=True)

    res = work / "res"
    shutil.copytree(ROOT / "android/res", res)
    (res / "mipmap-mdpi").mkdir()
    shutil.copyfile(ROOT / "public/icons/app-192.png", res / "mipmap-mdpi/ic_launcher.png")
    shutil.copyfile(ROOT / "public/icons/app-maskable-512.png", res / "mipmap-mdpi/app_mark.png")
    compiled, resources = work / "compiled.zip", work / "resources.apk"
    generated, classes, dex = work / "generated", work / "classes", work / "dex"
    for directory in [generated, classes, dex]:
        directory.mkdir()
    run([aapt, "compile", "--dir", res, "-o", compiled])
    run([aapt, "link", "-o", resources, "-I", android, "--manifest", ROOT / "android/AndroidManifest.xml", "--java", generated, compiled])
    sources = list((ROOT / "android/src").rglob("*.java")) + list(generated.rglob("*.java"))
    run([javac, "-encoding", "UTF-8", "--release", "8", "-classpath", android, "-d", classes, *sources])
    run([java, "-cp", build_tools / "lib/d8.jar", "com.android.tools.r8.D8", "--release", "--min-api", "23", "--lib", android, "--output", dex, *classes.rglob("*.class")])
    unsigned = work / "unsigned.apk"
    shutil.copyfile(resources, unsigned)
    with zipfile.ZipFile(unsigned, "a") as archive:
        for file in sorted(dex.glob("*.dex")):
            archive.write(file, file.name, compress_type=zipfile.ZIP_STORED)
    aligned = work / "aligned.apk"
    run([build_tools / "zipalign.exe", "-f", "-p", "4", unsigned, aligned])
    downloads = ROOT / "public/downloads"
    downloads.mkdir(exist_ok=True)
    apk = downloads / ("traffic-smart-qa-" + VERSION + ".apk")
    signer = [java, "-jar", build_tools / "lib/apksigner.jar"]
    run([*signer, "sign", "--ks", keystore, "--ks-key-alias", credentials["alias"], "--ks-pass", "env:TRAFFIC_APK_STOREPASS", "--key-pass", "env:TRAFFIC_APK_STOREPASS", "--v1-signing-enabled", "true", "--v2-signing-enabled", "true", "--v3-signing-enabled", "true", "--v4-signing-enabled", "false", "--out", apk, aligned])
    verification = run([*signer, "verify", "--verbose", "--print-certs", apk])
    run([build_tools / "zipalign.exe", "-c", "4", apk])
    badging = run([aapt, "dump", "badging", apk])
    assert "cn.syc.trafficqa" in badging and "versionName='" + VERSION + "'" in badging
    assert "android.permission.RECORD_AUDIO" in badging and "android.permission.INTERNET" in badging
    permissions = set(re.findall(r"uses-permission: name='([^']+)'", badging))
    assert permissions == {"android.permission.RECORD_AUDIO", "android.permission.INTERNET"}, permissions
    with zipfile.ZipFile(apk) as archive:
        assert "classes.dex" in archive.namelist() and "AndroidManifest.xml" in archive.namelist()
        assert not any(name.endswith((".jks", ".p12", ".keystore", ".json")) for name in archive.namelist())
    fingerprint = re.search(r"certificate SHA-256 digest: ([0-9a-f]+)", verification).group(1)
    metadata = {"version": VERSION, "version_code": VERSION_CODE, "application_id": "cn.syc.trafficqa", "url": "/downloads/" + apk.name, "size_bytes": apk.stat().st_size, "sha256": hashlib.file_digest(apk.open("rb"), "sha256").hexdigest(), "signer_sha256": fingerprint, "minimum_android_api": 23, "target_android_api": 35, "compatibility": "支持安卓APK的鸿蒙系统及Android；鸿蒙NEXT原生版不适用", "requires_network": True, "google_services_required": False}
    (ROOT / "public/android-release.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (parent / "verification.txt").write_text(verification + "\n" + badging, encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=True, indent=2), flush=True)


if __name__ == "__main__":
    main()
