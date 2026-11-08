package android.graphics;

/** RiuPlay: the settings a Keiyoushi source configures at start (text interceptors). Nothing is ever drawn with it. */
public class Paint {
    public static final int ANTI_ALIAS_FLAG = 1;
    private int color;
    private float textSize;
    private Typeface typeface;
    private boolean antiAlias;

    public Paint() {}

    public Paint(int flags) { antiAlias = (flags & ANTI_ALIAS_FLAG) != 0; }

    public void setColor(int color) { this.color = color; }

    public int getColor() { return color; }

    public void setTextSize(float size) { textSize = size; }

    public float getTextSize() { return textSize; }

    public Typeface setTypeface(Typeface typeface) { this.typeface = typeface; return typeface; }

    public Typeface getTypeface() { return typeface; }

    public void setAntiAlias(boolean on) { antiAlias = on; }

    public boolean isAntiAlias() { return antiAlias; }
}
