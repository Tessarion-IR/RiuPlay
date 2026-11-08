package android.graphics;

/** RiuPlay: the type exists so a source links; drawing fails (see Bitmap). */
public class Canvas {
    public Canvas(Bitmap bitmap) { throw new UnsupportedOperationException("The desktop host does not draw for extensions"); }

    public void drawColor(int color) { throw new UnsupportedOperationException("The desktop host does not draw for extensions"); }

    public int save() { throw new UnsupportedOperationException("The desktop host does not draw for extensions"); }

    public void restore() { throw new UnsupportedOperationException("The desktop host does not draw for extensions"); }

    public void translate(float dx, float dy) { throw new UnsupportedOperationException("The desktop host does not draw for extensions"); }
}
