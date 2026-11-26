# Woyengi Android ME111 frozen-model asset gate

This is the first Woyengi-owned Java component for the Android ME111 integration. It is JDK 8-compatible source that can be included in an Android application's source set without an Android framework dependency.

## Use from the Android host

Bundle the lawfully distributable, frozen model as an app asset. Open it through the Android `AssetManager`, verify it, then pass a defensive byte copy to the already-pinned local ONNX Runtime session:

```java
try (InputStream modelAsset = context.getAssets().open("tac_me111.onnx")) {
    Me111FrozenModelAsset.VerifiedModel verified =
        Me111FrozenModelAsset.loadFrozen(modelAsset);
    byte[] modelBytes = verified.copyBytesForLocalSession();
    // Create the ONNX Runtime session from modelBytes on this device.
}
```

Do not download model bytes, embeddings, features, inference results or state during customer inference. Model distribution may happen before deployment through a separately verified signed package; the running customer app must use the packaged local asset and have no remote fallback.

## Frozen identity

- Model: original TAC-OSM ME111, 104,663 learned parameters.
- ONNX opset: 18.
- ONNX Runtime target: Android CPU 1.23.2.
- ONNX SHA-256: `dd65519a9e4f3388966538af53119b56e9292b46a9209d63ad4927b87f0a176b`.
- Maximum asset size: 4,000,000 bytes, matching the upstream TAC Android prototype's bound.
- Upstream interface reference: [TAC-OSM draft PR #544](https://github.com/FPC-effortless/TAC-OSM/pull/544), original Java source at `eda076507f5762fa4413848cd3f0fd87a55c3681`.

The verifier reads a bounded stream, rejects empty/oversized content, checks SHA-256 before returning, and exposes only defensive byte copies. It does not close the caller-owned stream.

## Scope and limitations

This component only verifies model asset bytes. It does not implement preprocessing, embeddings, ONNX execution, recurrent-state updates/persistence, output calibration, speech, network isolation, source rights or scientific qualification. The caller must use an app-packaged local asset; an arbitrary caller-supplied stream is not proof of local origin. No model bytes are included in this repository increment.

ME111 remains 104,663 learned parameters, within the 95k–105k research budget, but its original real-world scientific status remains **FAILED/MIXED**. Target device is Samsung Galaxy A07 SM-A075F / Android 16. Physical ONNX operator support, parity, p50/p95, peak RAM, energy, airplane-mode/network trace and restart/state replay remain **NOT RUN/BLOCKED**. iPhone 13 and Raspberry Pi 5 remain NOT RUN.
