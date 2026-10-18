"""Write three synthetic artifact-delivery reports using public application APIs.

Keep this file beside artifact_delivery.py. No application writes, models,
credentials, network calls or research replay are involved.
"""

import argparse
from pathlib import Path

from artifact_delivery import build_trace, captured_readback
from consequa_x import render_report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="consequa-example", help="A new directory")
    args = parser.parse_args(argv)
    output = Path(args.output)
    cases = {
        "verified": build_trace(),
        "unknown": build_trace(captured_readback(available=False)),
        "other-actor": build_trace(captured_readback(actor="another-worker", action_id="another-action")),
    }
    # Build and validate documents before creating an output directory.
    documents = {name: (trace.to_json(), render_report(trace)) for name, trace in cases.items()}
    output.mkdir(parents=True, exist_ok=False)
    for name, (trace_json, report_html) in documents.items():
        (output / f"{name}.json").write_text(trace_json, encoding="utf-8")
        (output / f"{name}.html").write_text(report_html, encoding="utf-8")
    print(f"Open {(output / 'verified.html').resolve()} in your browser.")
    print("Compare unknown.html and other-actor.html. Every record is synthetic.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
