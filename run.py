"""Start the practice tool:  python3 run.py  [port]"""

import sys
import webbrowser
from pathlib import Path

from app.server import make_server


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = make_server(Path(__file__).resolve().parent, port)
    url = f"http://127.0.0.1:{port}"
    print(f"English practice is running at {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye.")


if __name__ == "__main__":
    main()
