package com.squareup.zstd;

import java.io.File;

/**
 * RiuPlay: replaces zstd-kmp's own loader (same class, same single method), which copies its DLL into the temp
 * folder and loads it from there. The confined host may not load code from a folder it can write (the
 * sandbox's low-label image mitigation, see apk-host/sandbox), so the DLL ships read-only in the bundle's
 * native/ folder (build.gradle.kts, bundleNative) and is loaded from there. The host jar comes first on the
 * class path (apkHost.ts), so this class is the one the JVM finds. zstd-kmp is Apache-2.0.
 */
final class Zstd__JvmZstdKt {
    private static boolean loaded;

    public static synchronized void loadNativeLibrary() {
        if (loaded) return;
        String dir = System.getProperty("riuplay.native.dir");
        if (dir == null) throw new IllegalStateException("riuplay.native.dir is not set");
        String name = System.getProperty("os.name", "").toLowerCase().contains("windows") ? "zstd-kmp.dll" : "libzstd-kmp.so";
        System.load(new File(dir, name).getAbsolutePath());
        loaded = true;
    }

    private Zstd__JvmZstdKt() {}
}
