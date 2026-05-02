import os
import sys
import json
import subprocess
import platform
import socket
import urllib.request
import urllib.error

CREDENTIALS_PATH = os.path.expanduser("~/.kimi/credentials/kimi-code.json")
LOCAL_CREDENTIALS_PATH = os.path.join(os.getcwd(), ".kimi-code.json")
DEVICE_ID_PATH = os.path.expanduser("~/.kimi/device_id")


def _ascii_header_value(value: str, *, fallback: str = "unknown") -> str:
    try:
        value.encode("ascii")
        return value.strip()
    except UnicodeEncodeError:
        sanitized = value.encode("ascii", errors="ignore").decode("ascii").strip()
        return sanitized or fallback


def _device_model() -> str:
    system = platform.system()
    arch = platform.machine() or ""
    if system == "Darwin":
        version = platform.mac_ver()[0] or platform.release()
        if version and arch:
            return f"macOS {version} {arch}"
        if version:
            return f"macOS {version}"
        return f"macOS {arch}".strip()
    if system:
        version = platform.release()
        if version and arch:
            return f"{system} {version} {arch}"
        if version:
            return f"{system} {version}"
        return f"{system} {arch}".strip()
    return "Unknown"


def get_common_headers():
    device_name = platform.node() or socket.gethostname()
    device_model = _device_model()
    device_id = ""
    if os.path.exists(DEVICE_ID_PATH):
        try:
            with open(DEVICE_ID_PATH, "r") as f:
                device_id = f.read().strip()
        except Exception:
            pass
    return {
        "X-Msh-Platform": "kimi_cli",
        "X-Msh-Version": os.environ.get("KIMI_CODE_VERSION", "1.40.0"),
        "X-Msh-Device-Name": _ascii_header_value(device_name),
        "X-Msh-Device-Model": _ascii_header_value(device_model),
        "X-Msh-Os-Version": _ascii_header_value(platform.version()),
        "X-Msh-Device-Id": device_id,
    }

def _get_key_from_file(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            data = json.load(f)
            if isinstance(data, dict):
                if data.get("access_token"):
                    return data["access_token"]
                for key in ["api_key", "apiKey", "key", "token"]:
                    if data.get(key):
                        return data[key]
            if isinstance(data, str):
                return data
    except Exception as e:
        print(f"Error reading credentials from {path}: {e}", file=sys.stderr)
    return None

def get_kimi_api_key():
    # Priority 1: Environment Variable
    env_key = os.environ.get("KIMI_API_KEY")
    if env_key:
        return env_key

    # Priority 2: Local Project Credentials (ignored by git)
    local_key = _get_key_from_file(LOCAL_CREDENTIALS_PATH)
    if local_key:
        return local_key

    # Priority 3: Global Credentials File
    global_key = _get_key_from_file(CREDENTIALS_PATH)
    if global_key:
        return global_key
        
    print(f"Kimi API key not found in {LOCAL_CREDENTIALS_PATH} or {CREDENTIALS_PATH}", file=sys.stderr)
    return None

def assemble_prompt(phase, index):
    try:
        result = subprocess.run(
            ["bash", "scripts/assemble-kimi-prompt.sh", str(phase), str(index)],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"Error assembling prompt: {e.stderr if e.stderr else 'unknown error'}", file=sys.stderr)
        return None

def call_kimi_api(api_key, prompt):
    # Use Kimi Code CLI managed endpoint by default
    url = os.environ.get(
        "KIMI_API_URL", "https://api.kimi.com/coding/v1/chat/completions"
    )

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": f"KimiCLI/{os.environ.get('KIMI_CODE_VERSION', '1.40.0')}",
    }
    headers.update(get_common_headers())

    model = os.environ.get("KIMI_MODEL", "kimi-for-coding")

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    print(f"Sending prompt to Kimi ({url})...", file=sys.stderr)
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return res_data["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        msg = f"API Error: {e.code} - {error_body}"
        print(msg, file=sys.stderr)
        print(msg) # Also print to stdout for the log file
        return None
    except urllib.error.URLError as e:
        print(f"Network/DNS Error: {e.reason}", file=sys.stderr)
        print("Check your internet connection or try setting KIMI_API_URL environment variable.", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        return None

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/kimi-implement.py <phase> <index>", file=sys.stderr)
        sys.exit(1)
        
    phase = sys.argv[1]
    index = sys.argv[2]
    
    api_key = get_kimi_api_key()
    if not api_key:
        sys.exit(1)
        
    prompt = assemble_prompt(phase, index)
    if not prompt:
        sys.exit(1)
        
    response = call_kimi_api(api_key, prompt)
    if response:
        print(response)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
