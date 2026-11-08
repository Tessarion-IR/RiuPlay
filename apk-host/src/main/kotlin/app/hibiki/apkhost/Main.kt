package app.hibiki.apkhost

import app.hibiki.apk.ApkImageProxy
import app.riuplay.apkhost.Broker
import java.io.File
import java.io.FileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.PrintStream
import kotlin.system.exitProcess

/**
 * The host process the application starts on demand (RiuPlay: inside riuplay-sandbox.exe's AppContainer):
 *
 *   --data <dir>          where extensions, settings and caches live (the only folder it may write)
 *   --image-base <url>    what the page loads pictures from; the host's picture addresses start with it
 *
 * It speaks frames on stdin/stdout (see Broker) and sends READY once it serves; logs go to stderr. Anything
 * an extension prints goes to stderr as well, so it cannot corrupt the frames. It exits when stdin closes.
 *
 *   --verify <apk>        instead: prints {"fingerprint": …} for the APK's verified signer (or null) and exits.
 *                         Run as a process of its own, with no extension loaded, before an install.
 */
fun main(args: Array<String>) {
    val options = args.toList().chunked(2).associate { (key, value) -> key to value }
    val frames = FileOutputStream(FileDescriptor.out)
    System.setOut(PrintStream(FileOutputStream(FileDescriptor.err), true, Charsets.UTF_8))

    options["--verify"]?.let { apk ->
        // The store's own reading (an APK, or a signed Keiyoushi jar), in a scratch store: nothing is installed.
        val inspected = runCatching {
            File(System.getProperty("java.io.tmpdir")).mkdirs()
            val scratch = java.nio.file.Files.createTempDirectory("verify").toFile()
            try { ExtensionStore(scratch).inspect(File(apk)) } finally { scratch.deleteRecursively() }
        }.getOrNull()
        val answer = org.json.JSONObject()
            .put("fingerprint", inspected?.signingFingerprint ?: org.json.JSONObject.NULL)
            .put("packageName", inspected?.packageName ?: org.json.JSONObject.NULL)
            .put("versionName", inspected?.versionName ?: org.json.JSONObject.NULL)
            .put("kind", inspected?.kind ?: org.json.JSONObject.NULL)
        frames.write((answer.toString() + "\n").toByteArray())
        frames.flush()
        exitProcess(0)
    }

    val data = File(options["--data"] ?: error("--data is required"))
    options["--image-base"]?.let { ApkImageProxy.base = it }
    File(data, "tmp").mkdirs()
    System.setProperty("java.io.tmpdir", File(data, "tmp").absolutePath)

    lateinit var server: Server
    Broker.start(FileInputStream(FileDescriptor.`in`), frames, onRequest = { channel, payload -> server.accept(channel, payload) }, onEnd = { exitProcess(0) })
    val host = ApkHost(data)
    val pages = RemotePages()
    android.webkit.WebView.backend = pages
    server = Server(host, pages)
    server.start()
    Broker.send(Broker.READY, 0, ByteArray(0))
}
