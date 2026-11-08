package android.view;

/** RiuPlay: layout types extension classes mention; nothing is laid out on the desktop. */
public class ViewGroup extends View implements ViewParent {
    public static class LayoutParams {
        public static final int MATCH_PARENT = -1, WRAP_CONTENT = -2;
        public int width, height;

        public LayoutParams(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }
}
