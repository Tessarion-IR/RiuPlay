package android.text;

/** RiuPlay: the type exists so a source links; laying out and drawing text fails (see android.graphics.Bitmap). */
public abstract class Layout {
    public enum Alignment { ALIGN_NORMAL, ALIGN_OPPOSITE, ALIGN_CENTER }

    public int getHeight() { throw new UnsupportedOperationException("The desktop host does not draw for extensions"); }

    public void draw(android.graphics.Canvas canvas) { throw new UnsupportedOperationException("The desktop host does not draw for extensions"); }
}
