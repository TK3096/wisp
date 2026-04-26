import argparse

from detector import Detector
from protocol import EventEmitter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="Print per-frame state to stderr")
    args = parser.parse_args()

    emitter = EventEmitter()
    detector = Detector(emitter=emitter, debug=args.debug)
    detector.run()


if __name__ == "__main__":
    main()
