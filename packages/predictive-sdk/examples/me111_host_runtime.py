"""CPU-only worker for the constructed Woyengi ME111 host demonstration."""
import hashlib
import json
import sys
from zipfile import ZipFile

import numpy as np
import onnxruntime as ort

REFERENCE_SHA256 = "f64d6192eb925296261c71bc6c4fda9f811fa1d60cee352414e84d50ca4cd32d"
FORECASTS = {
    "log_location": "logLocation",
    "left_scale": "leftScale",
    "right_scale": "rightScale",
}
STATE_TENSORS = {
    "source_sum": ((13,), np.float32),
    "source_mass": ((13,), np.float32),
    "evidence_sum": ((62,), np.float32),
    "count": ((1,), np.int64),
    "memory": ((8, 8), np.float32),
    "last_hour": ((), np.int64),
}


def checked_asset(apk, name, expected, size_limit):
    member = apk.getinfo("assets/" + name)
    if member.file_size > size_limit:
        raise ValueError(f"{name} exceeds its expected size bound")
    content = apk.read(member)
    if hashlib.sha256(content).hexdigest() != expected:
        raise ValueError(f"{name} SHA-256 mismatch")
    return content


def predict(apk_path, model_sha, checkpoint_sha, runtime_version, request):
    if ort.__version__ != runtime_version:
        raise ValueError(f"expected ONNX Runtime {runtime_version}, got {ort.__version__}")
    with ZipFile(apk_path) as apk:
        model = checked_asset(apk, "tac_me111.onnx", model_sha, 4_000_000)
        reference = json.loads(checked_asset(
            apk, "me111_reference_vectors.json", REFERENCE_SHA256, 32_768
        ))
    if (reference["status"] != "CONSTRUCTED_SOFTWARE_PARITY_ONLY"
            or reference["original_checkpoint_sha256"] != checkpoint_sha
            or reference["exported_onnx_sha256"] != model_sha):
        raise ValueError("constructed PyTorch reference provenance mismatch")

    event, state = request["event"], request["state"]
    owner, hour = event["owner"], event["hour"]
    if state is None:
        state = {key: np.zeros(shape, dtype).tolist()
                 for key, (shape, dtype) in STATE_TENSORS.items()}
        state["last_hour"] = hour - 1
        state["owner"] = owner
    if state["owner"] != owner or state["last_hour"] >= hour:
        raise ValueError("foreign owner or duplicate/stale source hour")

    inputs = {
        "values": np.array([[event["values"]]], dtype=np.float32),
        "observed": np.array([[event["observed"]]], dtype=np.bool_),
        "ages": np.array([[event["ages"]]], dtype=np.float32),
        "clock": np.array([[event["clock"]]], dtype=np.float32),
        "owners": np.array([owner], dtype=np.int64),
        "hours": np.array([[hour]], dtype=np.int64),
    }
    for key, (shape, dtype) in STATE_TENSORS.items():
        inputs[key] = np.array(state[key], dtype=dtype).reshape((1, *shape))

    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    session = ort.InferenceSession(model, options, providers=["CPUExecutionProvider"])
    if session.get_providers() != ["CPUExecutionProvider"]:
        raise RuntimeError("expected local CPU provider only")
    session.disable_fallback()
    output_names = [*FORECASTS, *("next_" + key for key in STATE_TENSORS), "chronology_ok"]
    outputs = dict(zip(output_names, session.run(output_names, inputs), strict=True))
    if outputs["chronology_ok"].tolist() != [True]:
        raise RuntimeError("frozen model rejected chronology")

    expected = next(row for row in reference["records"] if row["hour"] == hour)
    error = {"forecast": 0.0, "state": 0.0}
    output = {}
    next_state = {"owner": owner}
    for key in FORECASTS:
        actual = outputs[key][0]
        target = np.asarray(expected[key], dtype=np.float32)
        np.testing.assert_allclose(actual, target, atol=2e-5, rtol=2e-5)
        error["forecast"] = max(error["forecast"], float(np.max(np.abs(actual - target))))
        output[FORECASTS[key]] = actual.tolist()
    for key, (_, dtype) in STATE_TENSORS.items():
        actual = outputs["next_" + key][0]
        target = np.asarray(expected[key], dtype=dtype)
        if dtype == np.int64:
            actual = np.asarray(actual).reshape(())
            np.testing.assert_array_equal(actual, target)
        else:
            np.testing.assert_allclose(actual, target, atol=2e-5, rtol=2e-5)
            error["state"] = max(error["state"], float(np.max(np.abs(actual - target))))
        next_state[key] = actual.tolist()
    if next_state["last_hour"] != hour:
        raise RuntimeError("runtime returned an incorrect source hour")
    next_state["count"] = [next_state["count"]]
    return {"forecast": output, "state": next_state, "maxAbsError": error}


if __name__ == "__main__":
    print(json.dumps(predict(*sys.argv[1:], json.load(sys.stdin)), allow_nan=False))
