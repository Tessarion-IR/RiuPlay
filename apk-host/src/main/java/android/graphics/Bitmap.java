package android.graphics;

/**
 * Only a type for the API's signatures (tile thumbnails): the desktop host does not decode or draw images for
 * extensions. RiuPlay: createBitmap and compress exist for Keiyoushi sources that render text pages (Webtoons'
 * author notes); calling them fails, which fails only that page.
 */
public class Bitmap {
    public enum Config { ARGB_8888, RGB_565 }

    public enum CompressFormat { JPEG, PNG, WEBP }

    public static Bitmap createBitmap(int width, int height, Config config) {
        throw new UnsupportedOperationException("The desktop host does not draw for extensions");
    }

    public boolean compress(CompressFormat format, int quality, java.io.OutputStream stream) {
        throw new UnsupportedOperationException("The desktop host does not draw for extensions");
    }

    public int getWidth() { return 0; }

    public int getHeight() { return 0; }
}
