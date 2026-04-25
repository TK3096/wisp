import sys
import time
import json
import argparse


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--simulate-error", action="store_true")
    args = parser.parse_args()

    emit({"event": "ready"})

    if args.simulate_error:
        time.sleep(2.0)
        emit({"event": "error", "kind": "camera_unavailable", "message": "simulated failure"})
        sys.exit(1)

    while True:
        time.sleep(1.0)
        emit({"event": "spawn"})


if __name__ == "__main__":
    main()
