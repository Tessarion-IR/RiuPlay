package app.riuplay.apkhost

import org.json.JSONObject
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket

/**
 * RiuPlay: what confined code can and cannot do, for the sandbox's escape tests (src/platform/electron/
 * apkSandbox.e2e.test.ts). Run inside riuplay-sandbox.exe exactly as the host is; prints one JSON object
 * with "ok" or the error for each attempt. Nothing here is reachable from an extension.
 *
 *   --data <dir>       the folder the host may write (expected: allowed)
 *   --secret <file>    a file of the person's (expected: unreadable)
 *   --outside <dir>    a folder of the person's (expected: no listing, no writing)
 *   --port <n>         a loopback port the test listens on (expected: unreachable)
 */
fun main(args: Array<String>) {
    val options = args.toList().chunked(2).associate { (key, value) -> key to value }
    val results = JSONObject()
    fun attempt(name: String, block: () -> Any?) {
        results.put(name, try {
            "ok:" + (block()?.toString()?.take(80) ?: "")
        } catch (error: Throwable) {
            "denied:" + error.javaClass.simpleName + ": " + (error.message ?: "").take(120)
        })
    }
    val data = File(options.getValue("--data"))
    attempt("writeData") { File(data, "probe.txt").apply { writeText("x") }.delete() }
    attempt("readRuntime") { File(System.getProperty("java.home"), "release").readText().length }
    options["--secret"]?.let { secret -> attempt("readSecret") { File(secret).readText() } }
    options["--outside"]?.let { outside ->
        attempt("listOutside") { File(outside).listFiles()?.size ?: throw SecurityException("no listing") }
        attempt("writeOutside") { File(outside, "escaped.txt").apply { writeText("escaped") }.exists() }
    }
    attempt("listProfile") { File(System.getenv("USERPROFILE") ?: "C:\\Users").listFiles()?.size ?: throw SecurityException("no listing") }
    attempt("connectInternet") { Socket().use { it.connect(InetSocketAddress("1.1.1.1", 443), 5000); "connected" } }
    options["--port"]?.let { port -> attempt("connectLoopback") { Socket().use { it.connect(InetSocketAddress("127.0.0.1", port.toInt()), 5000); "connected" } } }
    attempt("resolveDns") { InetAddress.getByName("example.com").hostAddress }
    attempt("startProcess") { ProcessBuilder("cmd.exe", "/c", "echo", "escaped").start().inputStream.readBytes().decodeToString() }
    println(results.toString())
}
