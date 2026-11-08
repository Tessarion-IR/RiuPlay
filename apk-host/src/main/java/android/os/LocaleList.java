package android.os;

import java.util.Locale;

/** RiuPlay: the system's language list is the JVM's default locale. */
public final class LocaleList {
    private final Locale[] locales;

    public LocaleList(Locale... locales) { this.locales = locales.length == 0 ? new Locale[] { Locale.getDefault() } : locales; }

    public static LocaleList getDefault() { return new LocaleList(Locale.getDefault()); }

    public static LocaleList getAdjustedDefault() { return getDefault(); }

    public Locale get(int index) { return index >= 0 && index < locales.length ? locales[index] : null; }

    public int size() { return locales.length; }

    public boolean isEmpty() { return locales.length == 0; }

    public String toLanguageTags() {
        StringBuilder sb = new StringBuilder();
        for (Locale l : locales) { if (sb.length() > 0) sb.append(','); sb.append(l.toLanguageTag()); }
        return sb.toString();
    }
}
