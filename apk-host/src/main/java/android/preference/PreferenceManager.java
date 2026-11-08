package android.preference;

import android.content.Context;
import android.content.SharedPreferences;

/** RiuPlay: the framework's (deprecated) twin of androidx.preference.PreferenceManager, which it defers to. */
public class PreferenceManager {
    public static SharedPreferences getDefaultSharedPreferences(Context context) {
        return androidx.preference.PreferenceManager.getDefaultSharedPreferences(context);
    }
}
