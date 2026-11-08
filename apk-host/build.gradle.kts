plugins {
    kotlin("jvm") version "2.4.10"
    kotlin("plugin.serialization") version "2.4.10"
    application
}

repositories {
    mavenCentral()
    // apksig (the APK signature verifier Android itself uses) is published here only.
    google()
    // Injekt, which Aniyomi extensions resolve their dependencies through.
    maven("https://jitpack.io")
}

kotlin { jvmToolchain(21) }

application { mainClass.set("app.hibiki.apkhost.MainKt") }

/**
 * Hibiki's shared Kotlin sources (GPL-3.0): the Aniyomi source API, the network helpers and the
 * adapter that answers in the shared JSON shapes. Hibiki compiled these from its Android build; RiuPlay
 * keeps its own copy in shared/ (it has no Android build), compiled against src/main/java's android.*
 * stand-ins. What needs the real Android is replaced by this project's src/main file of the same name.
 */
sourceSets.main { kotlin.srcDir("shared") }

dependencies {
    implementation("de.femtopedia.dex2jar:dex-translator:2.4.38")
    implementation("de.femtopedia.dex2jar:dex-tools:2.4.38")
    implementation("net.dongliu:apk-parser:2.6.10")
    implementation("com.android.tools.build:apksig:8.7.3")
    implementation("org.ow2.asm:asm:9.9.1")
    implementation("org.ow2.asm:asm-tree:9.9.1")
    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    implementation("com.squareup.okhttp3:okhttp-brotli:5.4.0")
    implementation("com.squareup.okhttp3:okhttp-dnsoverhttps:5.4.0")
    // Keiyoushi 1.6 sources decode zstd responses themselves (CompressionInterceptor with Zstd).
    implementation("com.squareup.okhttp3:okhttp-zstd:5.4.0")
    implementation("org.jsoup:jsoup:1.23.2")
    implementation("org.json:json:20250517")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("org.mozilla:rhino:1.7.15")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-protobuf:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json-okio:1.11.0")
    implementation("io.reactivex:rxjava:1.3.8")
    implementation("com.github.null2264.injekt:injekt-core:4135455a2a")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:5.4.0")
}

tasks.test {
    useJUnitPlatform()
    // The survey tests read the APK collection the extension ABI check downloads.
    System.getProperty("apk.only")?.let { systemProperty("apk.only", it) }
    System.getProperty("apk.live")?.let { systemProperty("apk.live", it) }
    System.getProperty("kei.apks")?.let { systemProperty("kei.apks", it) }
    testLogging { showStandardStreams = true }
    systemProperty("apk.samples", rootDir.resolve("../.tmp/extension-abi/apk-yuzono").absolutePath)
    maxHeapSize = "1g"
    // As the application runs the host (apkHost.ts): see HOST_JVM_ARGS there.
    jvmArgs("-XX:+UnlockDiagnosticVMOptions", "-XX:-BytecodeVerificationRemote")
    dependsOn("bundleNative")
    systemProperty("riuplay.native.dir", layout.buildDirectory.dir("bundle-" + (findProperty("bundleName") as String? ?: "dev") + "/native").get().asFile.absolutePath)
}

tasks.register<JavaExec>("survey") {
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("app.hibiki.apkhost.SurveyKt")
}

tasks.register<JavaExec>("members") {
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("app.hibiki.apkhost.MembersKt")
}

// --- what ships inside the application's installer ------------------------------------------------------
// resources/apk-host/lib (the jars) beside resources/apk-host/runtime (a Java trimmed to what they use),
// so nobody needs a Java of their own. The runtime is built from -PruntimeJdk=<a JDK of the *target*
// platform and architecture> (the release workflow passes one per build), else from the JDK building this.
// -PbundleName=<name> builds into build/bundle-<name>: the release builds make one per CPU architecture, and
// electron-builder picks the one named like the architecture it is packaging (see electron-builder.yml).
val bundleDir = layout.buildDirectory.dir("bundle-" + (findProperty("bundleName") as String? ?: "dev"))

// java.base plus what the host reaches: XML for APK manifests, naming for OkHttp's host name check, the
// HTTP server and the EC curves TLS needs (a trimmed runtime has neither unless asked), Unsafe for libraries
// that use it, zipfs because dex2jar writes its jar through a zip file system. Anything missing shows up as a failure of the test suite run on this very runtime.
val runtimeModules = "java.base,java.logging,java.xml,java.naming,java.management,java.sql,jdk.httpserver,jdk.crypto.ec,jdk.unsupported,jdk.zipfs"

val bundleLibs = tasks.register<Sync>("bundleLibs") {
    from(tasks.named<Sync>("installDist").map { it.destinationDir.resolve("lib") })
    into(bundleDir.map { it.dir("lib") })
}

val jlinkRuntime = tasks.register<Exec>("jlinkRuntime") {
    val jdk = (findProperty("runtimeJdk") as String?) ?: javaToolchains.launcherFor(java.toolchain).get().metadata.installationPath.asFile.absolutePath
    val output = bundleDir.map { it.dir("runtime").asFile }
    inputs.property("jdk", jdk)
    // The Windows certificate store is read through a module only a Windows JDK has.
    val modules = runtimeModules + if (File(jdk, "jmods/jdk.crypto.mscapi.jmod").exists()) ",jdk.crypto.mscapi" else ""
    inputs.property("modules", modules)
    outputs.dir(output)
    doFirst { delete(output) }
    val exe = if (org.gradle.internal.os.OperatingSystem.current().isWindows) "jlink.exe" else "jlink"
    commandLine(
        File(jdk, "bin/$exe").absolutePath,
        "--module-path", File(jdk, "jmods").absolutePath,
        "--add-modules", modules,
        "--strip-debug", "--no-header-files", "--no-man-pages", "--compress", "zip-6",
        "--output", output.get().absolutePath,
    )
}

// RiuPlay: native libraries the host loads, read-only beside the jars (the sandbox will not load code from a
// folder the host can write). zstd-kmp's Windows DLL, for Keiyoushi sources' zstd responses.
val bundleNative = tasks.register<Copy>("bundleNative") {
    val zstd = configurations.runtimeClasspath.map { it.files.first { f -> f.name.startsWith("zstd-kmp-jvm") } }
    from(zstd.map { zipTree(it) }) {
        include("jni/amd64/zstd-kmp.dll")
        eachFile { path = name }
        includeEmptyDirs = false
    }
    into(bundleDir.map { it.dir("native") })
}

// RiuPlay K4: the launcher that confines the host (sandbox/RiuPlaySandbox.cs: AppContainer, Job Object). Built
// with the C# compiler of the .NET Framework 4.x every Windows 10/11 has; any CPU, so one build serves x64 and arm64.
val bundleSandbox = tasks.register<Exec>("bundleSandbox") {
    val source = file("sandbox/RiuPlaySandbox.cs")
    val output = bundleDir.map { it.file("riuplay-sandbox.exe").asFile }
    inputs.file(source)
    outputs.file(output)
    onlyIf { org.gradle.internal.os.OperatingSystem.current().isWindows }
    val csc = File(System.getenv("WINDIR") ?: "C:\\Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe")
    doFirst { output.get().parentFile.mkdirs() }
    commandLine(csc.absolutePath, "-nologo", "-optimize+", "-platform:anycpu", "-target:exe", "-out:" + output.get().absolutePath, source.absolutePath)
}

tasks.register("bundle") {
    description = "Builds build/bundle-<name>: the host's jars, native libraries, the trimmed Java runtime that runs them and the sandbox launcher."
    dependsOn(bundleLibs, bundleNative, jlinkRuntime, bundleSandbox)
}

// Runs the suite on the trimmed runtime instead of the full JDK: proves it has every module the host needs.
tasks.register<Test>("testOnBundledRuntime") {
    description = "The test suite, run on the bundle's trimmed runtime."
    dependsOn(jlinkRuntime)
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    useJUnitPlatform()
    val exe = if (org.gradle.internal.os.OperatingSystem.current().isWindows) "java.exe" else "java"
    executable = bundleDir.get().dir("runtime/bin/$exe").asFile.absolutePath
    systemProperty("apk.samples", rootDir.resolve("../.tmp/extension-abi/apk-yuzono").absolutePath)
    System.getProperty("apk.only")?.let { systemProperty("apk.only", it) }
    maxHeapSize = "1g"
}
