import os
import sys
import json
import subprocess
import urllib.request
import urllib.error

CREDENTIALS_PATH = "/Users/manwe/.kimi/credentials/kimi-code.json"

def get_kimi_api_key():
    try:
        with open(CREDENTIALS_PATH, "r") as f:
            data = json.load(f)
            return data.get("api_key") or data.get("apiKey")
    except Exception as e:
        print(f"Error reading credentials: {e}", file=sys.stderr)
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
    url = "https://api.moonshot.cn/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    payload = {
        "model": "moonshot-v1-128k",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    
    print("Sending prompt to Kimi (this may take a minute)...", file=sys.stderr)
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return res_data["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        print(f"API Error: {e.code} - {e.read().decode('utf-8')}", file=sys.stderr)
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
        print("Kimi API key not found in " + CREDENTIALS_PATH, file=sys.stderr)
        sys.exit(1)
        
    prompt = assemble_prompt(phase, index)
    if not prompt:
        sys.exit(1)
        
    response = call_kimi_api(api_key, prompt)
    if response:
        # Output the response to stdout so it can be captured
        print(response)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
