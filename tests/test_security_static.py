from pathlib import Path


def source_text(path: str) -> str:
    root = Path(path)
    return "\n".join(file.read_text(encoding="utf-8") for file in root.rglob("*") if file.is_file())


def test_no_demo_mode_symbols_remain_in_runtime():
    runtime = Path("main.py").read_text(encoding="utf-8") + source_text("public")
    for forbidden in ("APP_MODE", "demo_result", "is_demo", "demo_hint"):
        assert forbidden not in runtime


def test_public_bundle_has_no_server_secret_fields():
    public = source_text("public")
    for forbidden in ("qr_data", "CF_CLEARANCE", "LARAVEL_SESSION", "REMEMBER_WEB", "XSRF_TOKEN"):
        assert forbidden not in public
