package org.woyengi.predictive.me111;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;

/** Dependency-free adversarial JVM tests for the Android-compatible asset gate. */
public final class Me111FrozenModelAssetTest {
    private Me111FrozenModelAssetTest() { }

    public static void main(String[] args) throws Exception {
        verifiesExactBytesAndReturnsDefensiveCopies();
        rejectsWrongDigest();
        acceptsAssetExactlyAtConfiguredLimit();
        rejectsOversizedAsset();
        rejectsEmptyAsset();
        rejectsNonPositiveMaximum();
        handlesZeroProgressStreams();
        leavesStreamOwnershipWithCaller();
        rejectsNonFrozenBytesAtPublicEntryPoint();
        rejectsMalformedExpectedDigest();
        rejectsNonAsciiDigestAndUnboundedLimit();
        rejectsNullInput();
        System.out.println("ME111_MODEL_ASSET_TESTS=12 PASS");
    }

    private static void verifiesExactBytesAndReturnsDefensiveCopies() throws Exception {
        byte[] fixture = "constructed-only model bytes".getBytes(StandardCharsets.UTF_8);
        String digest = sha256(fixture);
        Me111FrozenModelAsset.VerifiedModel model =
            Me111FrozenModelAsset.readAndVerify(new ByteArrayInputStream(fixture), digest, 128);
        check(model.sizeBytes() == fixture.length, "size must match fixture");
        check(model.sha256().equals(digest), "digest must match fixture");
        byte[] first = model.copyBytesForLocalSession();
        first[0] ^= 0x7f;
        check(Arrays.equals(model.copyBytesForLocalSession(), fixture),
            "returned bytes must not mutate verified model owner");
    }

    private static void rejectsWrongDigest() throws Exception {
        byte[] fixture = "wrong model".getBytes(StandardCharsets.UTF_8);
        expect(SecurityException.class, () -> Me111FrozenModelAsset.readAndVerify(
            new ByteArrayInputStream(fixture), repeat('0', 64), 128));
    }

    private static void acceptsAssetExactlyAtConfiguredLimit() throws Exception {
        byte[] fixture = new byte[] {1, 2, 3, 4, 5, 6, 7, 8};
        Me111FrozenModelAsset.VerifiedModel model =
            Me111FrozenModelAsset.readAndVerify(
                new ByteArrayInputStream(fixture), sha256(fixture), fixture.length);
        check(model.sizeBytes() == fixture.length,
            "asset exactly at the configured byte limit must be accepted");
        check(Arrays.equals(model.copyBytesForLocalSession(), fixture),
            "exact-limit asset bytes must be preserved");
    }

    private static void rejectsOversizedAsset() throws Exception {
        byte[] fixture = new byte[9];
        expect(IOException.class, () -> Me111FrozenModelAsset.readAndVerify(
            new ByteArrayInputStream(fixture), sha256(fixture), 8));
    }

    private static void rejectsEmptyAsset() throws Exception {
        expect(IOException.class, () -> Me111FrozenModelAsset.readAndVerify(
            new ByteArrayInputStream(new byte[0]), sha256(new byte[0]), 8));
    }

    private static void rejectsNonPositiveMaximum() throws Exception {
        byte[] fixture = new byte[] {1};
        String digest = sha256(fixture);
        expect(IllegalArgumentException.class, () -> Me111FrozenModelAsset.readAndVerify(
            new ByteArrayInputStream(fixture), digest, 0));
        expect(IllegalArgumentException.class, () -> Me111FrozenModelAsset.readAndVerify(
            new ByteArrayInputStream(fixture), digest, -1));
    }

    private static void handlesZeroProgressStreams() throws Exception {
        byte[] fixture = "zero-progress-safe".getBytes(StandardCharsets.UTF_8);
        InputStream stream = new ZeroProgressOnce(fixture);
        Me111FrozenModelAsset.VerifiedModel model =
            Me111FrozenModelAsset.readAndVerify(stream, sha256(fixture), 128);
        check(Arrays.equals(model.copyBytesForLocalSession(), fixture),
            "zero-progress stream must still be consumed exactly");
    }

    private static void leavesStreamOwnershipWithCaller() throws Exception {
        byte[] fixture = "caller owns stream".getBytes(StandardCharsets.UTF_8);
        CloseTrackingStream stream = new CloseTrackingStream(fixture);
        Me111FrozenModelAsset.readAndVerify(stream, sha256(fixture), 128);
        check(!stream.closed, "asset verifier must not close caller-owned stream");
    }

    private static void rejectsNonFrozenBytesAtPublicEntryPoint() throws Exception {
        byte[] fixture = "constructed fixture is not the frozen ONNX model"
            .getBytes(StandardCharsets.UTF_8);
        expect(SecurityException.class, () -> Me111FrozenModelAsset.loadFrozen(
            new ByteArrayInputStream(fixture)));
    }

    private static void rejectsMalformedExpectedDigest() throws Exception {
        expect(IllegalArgumentException.class, () -> Me111FrozenModelAsset.readAndVerify(
            new ByteArrayInputStream(new byte[] {1}), "not-a-digest", 8));
    }

    private static void rejectsNonAsciiDigestAndUnboundedLimit() throws Exception {
        byte[] fixture = new byte[] {1};
        String valid = sha256(fixture);
        String nonAscii = valid.substring(0, 1) + '\u0661' + valid.substring(2);
        expect(IllegalArgumentException.class, () -> Me111FrozenModelAsset.readAndVerify(
            new ByteArrayInputStream(fixture), nonAscii, 8));
        expect(IllegalArgumentException.class, () -> Me111FrozenModelAsset.readAndVerify(
            new ByteArrayInputStream(fixture), valid, Me111FrozenModelAsset.MAX_MODEL_BYTES + 1));
    }

    private static void rejectsNullInput() throws Exception {
        expect(IllegalArgumentException.class, () -> Me111FrozenModelAsset.loadFrozen(null));
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        char[] digits = "0123456789abcdef".toCharArray();
        StringBuilder result = new StringBuilder(64);
        for (byte item : digest) {
            int value = item & 0xff;
            result.append(digits[value >>> 4]).append(digits[value & 0x0f]);
        }
        return result.toString();
    }

    private static String repeat(char value, int count) {
        char[] chars = new char[count];
        Arrays.fill(chars, value);
        return new String(chars);
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void expect(Class<? extends Throwable> type, ThrowingRunnable action)
            throws Exception {
        try {
            action.run();
        } catch (Throwable actual) {
            if (type.isInstance(actual)) return;
            throw new AssertionError("expected " + type.getSimpleName() + " but got " + actual,
                actual);
        }
        throw new AssertionError("expected " + type.getSimpleName());
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static final class ZeroProgressOnce extends InputStream {
        private final ByteArrayInputStream delegate;
        private boolean first = true;

        ZeroProgressOnce(byte[] bytes) {
            delegate = new ByteArrayInputStream(bytes);
        }

        @Override public int read() {
            return delegate.read();
        }

        @Override public int read(byte[] bytes, int offset, int length) {
            if (first) {
                first = false;
                return 0;
            }
            return delegate.read(bytes, offset, length);
        }
    }

    private static final class CloseTrackingStream extends ByteArrayInputStream {
        boolean closed;

        CloseTrackingStream(byte[] bytes) {
            super(bytes);
        }

        @Override public void close() throws IOException {
            closed = true;
            super.close();
        }
    }
}
