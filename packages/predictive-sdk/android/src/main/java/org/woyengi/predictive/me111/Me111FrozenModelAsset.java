package org.woyengi.predictive.me111;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Verifies the exact frozen ME111 ONNX bytes before a local Android ONNX session
 * is created. This class performs no network access and owns no input stream.
 *
 * The caller must open the stream from a trusted, app-packaged local asset and
 * close it after this method returns. This class does not prove that the caller
 * used AssetManager, that source rights are valid, or that inference is local.
 */
public final class Me111FrozenModelAsset {
    public static final String MODEL_SHA256 =
        "dd65519a9e4f3388966538af53119b56e9292b46a9209d63ad4927b87f0a176b";
    public static final int MAX_MODEL_BYTES = 4_000_000;
    private static final int BUFFER_BYTES = 8_192;

    private Me111FrozenModelAsset() { }

    /**
     * Read and verify the frozen model from a caller-owned local asset stream.
     * The stream is deliberately not closed here; ownership remains with caller.
     */
    public static VerifiedModel loadFrozen(InputStream input) throws IOException {
        return readAndVerify(input, MODEL_SHA256, MAX_MODEL_BYTES);
    }

    static VerifiedModel readAndVerify(InputStream input, String expectedSha256,
                                       int maximumBytes) throws IOException {
        if (input == null) {
            throw new IllegalArgumentException("model asset stream is required");
        }
        byte[] expected = parseSha256(expectedSha256);
        if (maximumBytes <= 0 || maximumBytes > MAX_MODEL_BYTES) {
            throw new IllegalArgumentException("maximum model size must be within the frozen asset bound");
        }

        final MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }

        ByteArrayOutputStream bytes = new ByteArrayOutputStream(
            Math.min(maximumBytes, 64 * 1024));
        byte[] buffer = new byte[BUFFER_BYTES];
        int total = 0;
        while (true) {
            int count = input.read(buffer, 0, buffer.length);
            if (count < 0) {
                break;
            }
            if (count == 0) {
                // InputStream permits a zero-length progress result. Make one
                // single-byte read so a nonconforming stream cannot spin forever.
                int one = input.read();
                if (one < 0) {
                    break;
                }
                if (total == maximumBytes) {
                    throw new IOException("ME111 model asset exceeds size limit");
                }
                bytes.write(one);
                digest.update((byte) one);
                total++;
                continue;
            }
            if (count > maximumBytes - total) {
                throw new IOException("ME111 model asset exceeds size limit");
            }
            bytes.write(buffer, 0, count);
            digest.update(buffer, 0, count);
            total += count;
        }
        if (total == 0) {
            throw new IOException("ME111 model asset is empty");
        }

        byte[] actual = digest.digest();
        if (!MessageDigest.isEqual(expected, actual)) {
            throw new SecurityException("frozen ME111 ONNX SHA-256 mismatch");
        }
        return new VerifiedModel(bytes.toByteArray(), toHex(actual));
    }

    private static byte[] parseSha256(String value) {
        if (value == null || value.length() != 64) {
            throw new IllegalArgumentException("expected SHA-256 must contain 64 hex characters");
        }
        byte[] result = new byte[32];
        for (int i = 0; i < result.length; i++) {
            int high = hexValue(value.charAt(i * 2));
            int low = hexValue(value.charAt(i * 2 + 1));
            if (high < 0 || low < 0) {
                throw new IllegalArgumentException("expected SHA-256 contains non-hex characters");
            }
            result[i] = (byte) ((high << 4) | low);
        }
        return result;
    }

    private static int hexValue(char value) {
        if (value >= '0' && value <= '9') return value - '0';
        if (value >= 'a' && value <= 'f') return value - 'a' + 10;
        if (value >= 'A' && value <= 'F') return value - 'A' + 10;
        return -1;
    }

    private static String toHex(byte[] bytes) {
        final char[] digits = "0123456789abcdef".toCharArray();
        char[] output = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int value = bytes[i] & 0xff;
            output[i * 2] = digits[value >>> 4];
            output[i * 2 + 1] = digits[value & 0x0f];
        }
        return new String(output);
    }

    /** Immutable byte owner; callers receive a defensive copy for ORT session creation. */
    public static final class VerifiedModel {
        private final byte[] modelBytes;
        private final String sha256;

        private VerifiedModel(byte[] modelBytes, String sha256) {
            this.modelBytes = modelBytes.clone();
            this.sha256 = sha256;
        }

        public int sizeBytes() {
            return modelBytes.length;
        }

        public String sha256() {
            return sha256;
        }

        public byte[] copyBytesForLocalSession() {
            return modelBytes.clone();
        }
    }
}
