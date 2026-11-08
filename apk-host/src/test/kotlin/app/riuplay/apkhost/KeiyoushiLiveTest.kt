package app.riuplay.apkhost

import app.hibiki.apkhost.ApkHost
import app.hibiki.apkhost.ExtensionStore
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * RiuPlay: real Keiyoushi (extensions-lib 1.6) manga APKs against their live sites: the signer is the
 * repository's key, then popular list, search, a title's details, its chapters, a chapter's pages and the
 * first page's picture. Off unless -Dkei.apks=<folder of APKs> (sites change; a check to run by hand).
 */
class KeiyoushiLiveTest {
    private val folder = System.getProperty("kei.apks")?.let(::File)

    @Test
    fun `manga sources answer every call`() {
        if (folder == null) { println("Keiyoushi live test is off (-Dkei.apks=<folder>)"); return }
        val data = Files.createTempDirectory("apk-host-kei").toFile()
        val host = ApkHost(data)
        var passed = 0
        val apks = folder.listFiles { f -> f.extension == "apk" || f.extension == "jar" }.orEmpty().sortedBy { it.name }
        for (apk in apks) {
            val line = StringBuilder(apk.name).append(": ")
            try {
                assertEquals(KEIYOUSHI_KEY, ExtensionStore.signingFingerprint(apk), "signer")
                val copy = File(data, "in-${apk.name}")
                apk.copyTo(copy, overwrite = true)
                val installed = host.install(copy, null)
                assertEquals("manga", installed.kind)
                val failure = host.registry.failures().firstOrNull { it.extension.packageName == installed.packageName }
                check(failure == null) { "load failed: ${failure?.message}" }
                val loaded = host.registry.extensions().first { it.extension.packageName == installed.packageName }
                val adapter = loaded.mangaAdapters.firstOrNull { it.lang == "en" } ?: loaded.mangaAdapters.first()
                line.append("${adapter.name} [${adapter.lang}] (${loaded.mangaAdapters.size} sources) ")
                runBlocking {
                    val popular = adapter.search(JSONObject().put("limit", 5))
                    line.append("popular=${popular.length()} ")
                    val found = adapter.search(JSONObject().put("query", "love").put("limit", 5))
                    line.append("search=${found.length()} ")
                    val id = popular.getJSONObject(0).getString("id")
                    val details = adapter.getById(id)
                    line.append("title='${details.optString("englishName")}' ")
                    val chapters = adapter.playbackGroups(id).getJSONObject(0).getJSONArray("episodes")
                    line.append("chapters=${chapters.length()} ")
                    val chapterId = chapters.getJSONObject(0).getString("id")
                    val pages = adapter.pages(id, chapterId)
                    line.append("pages=${pages.length()} ")
                    val (type, bytes) = adapter.image(pages.getJSONObject(0).getString("url"))
                    line.append("page1=$type ${bytes.size}B")
                    assertTrue(bytes.size > 1000)
                }
                passed++
            } catch (error: Throwable) {
                var cause: Throwable = error
                while (cause.cause != null && cause.cause !== cause) cause = cause.cause!!
                line.append("FAILED: ${error.message} <- ${cause.javaClass.name}: ${cause.message} @ ${cause.stackTrace.take(8).joinToString(" | ")}")
            }
            println(line)
        }
        assertEquals(apks.size, passed, "every APK answered")
    }

    companion object {
        /** repo.json's signingKeyFingerprint for https://keiyoushi.github.io (checked 2026-11-08). */
        const val KEIYOUSHI_KEY = "9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2"
    }
}
