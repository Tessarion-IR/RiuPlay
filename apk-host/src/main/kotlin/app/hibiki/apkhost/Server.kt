package app.hibiki.apkhost

import app.hibiki.apk.ApkPreferences
import app.riuplay.apkhost.Broker
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors

/**
 * The host's calls, for the application that started it. RiuPlay: they arrive as REQ frames on stdin (see
 * Broker) - the confined process listens on no port, and only its parent holds the pipe, so no token is
 * needed. Each request is {"method", "path", "body"} with a JSON body in the shapes of shared/types.ts; the
 * answer is a RES frame (u16 status, u16 type length, type, bytes). A failure is {"error": message}.
 *
 *   GET  /extensions                      installed extensions and the sources ready to use
 *   POST /install      {url, packageName?}  downloads (through the application) and installs
 *   POST /install-file {file, packageName?, fingerprint?}  installs an APK the application put in <data>/inbox
 *   POST /trust        {packageName, fingerprint}
 *   POST /uninstall    {packageName}
 *   POST /clearance    {url, userAgent, cookies}   what a passed Cloudflare check earned
 *   POST /source/<id>/<method>  {…}        anime: search, latest, getById, playbackGroups, playerLinks,
 *                                          filterCatalog, readSettings, writeSetting
 *                                          manga: search, latest, getById, playbackGroups, pages
 *   GET  /image?s=<source>&u=<url>        a picture fetched the way the source fetches
 *   GET  /page?s=<source>&t=<token>       a manga page's picture, by the token /pages gave
 *   GET  /icon?p=<package>                an extension's icon
 *   POST /pages/event                     what a page the application runs did (RemotePages); the commands
 *                                         for those pages go out as EVENT frames
 */
class Server(private val host: ApkHost, private val pages: RemotePages = RemotePages()) {
    private val workers = Executors.newCachedThreadPool { runnable -> Thread(runnable, "apk-host-call").apply { isDaemon = true } }

    class Reply(val status: Int, val type: String, val body: ByteArray)

    fun start() {
        Thread({
            while (true) {
                val line = pages.nextCommand(15_000)?.toString() ?: continue
                runCatching { Broker.send(Broker.EVENT, 0, line.toByteArray(Charsets.UTF_8)) }
            }
        }, "apk-pages-commands").apply { isDaemon = true }.start()
    }

    /** A REQ frame: answered on a worker thread, as a RES frame on the same channel. */
    fun accept(channel: Int, payload: ByteArray) {
        workers.execute {
            val reply = try {
                val request = JSONObject(payload.decodeToString())
                handle(request.getString("method"), request.getString("path"), request.optString("body", ""))
            } catch (error: Throwable) {
                json(500, JSONObject().put("error", error.message ?: error.javaClass.simpleName))
            }
            val type = reply.type.toByteArray()
            val frame = ByteBuffer.allocate(4 + type.size + reply.body.size)
            frame.putShort(reply.status.toShort()).putShort(type.size.toShort()).put(type).put(reply.body)
            runCatching { Broker.send(Broker.RES, channel, frame.array()) }
        }
    }

    fun handle(method: String, target: String, bodyText: String): Reply {
        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "")
        fun body() = if (bodyText.isBlank()) JSONObject() else JSONObject(bodyText)
        return try {
            when {
                method == "GET" && path == "/extensions" -> json(200, host.describe())
                method == "GET" && path == "/image" -> image(query)
                method == "GET" && path == "/page" -> page(query)
                method == "GET" && path == "/icon" -> icon(query)
                method == "POST" && path == "/pages/event" -> {
                    pages.deliver(body())
                    json(200, JSONObject())
                }
                method == "POST" && path == "/install" -> {
                    val body = body()
                    installed(runBlocking { host.install(body.getString("url"), body.optString("packageName").ifEmpty { null }) })
                }
                method == "POST" && path == "/install-file" -> {
                    val body = body()
                    installed(host.installFromInbox(body.getString("file"), body.optString("packageName").ifEmpty { null }, body.optString("fingerprint").ifEmpty { null }))
                }
                method == "POST" && path == "/trust" -> {
                    val body = body()
                    host.trust(body.getString("packageName"), body.getString("fingerprint"))
                    json(200, host.describe())
                }
                method == "POST" && path == "/clearance" -> {
                    val body = body()
                    val cookies = body.getJSONObject("cookies")
                    host.applyClearance(body.getString("url"), body.getString("userAgent"), cookies.keys().asSequence().associateWith { cookies.getString(it) })
                    json(200, JSONObject())
                }
                method == "POST" && path == "/clearance/reset" -> {
                    host.resetClearances()
                    json(200, JSONObject())
                }
                method == "POST" && path == "/uninstall" -> {
                    host.uninstall(body().getString("packageName"))
                    json(200, host.describe())
                }
                method == "POST" && path.startsWith("/source/") -> {
                    val parts = path.removePrefix("/source/").split('/', limit = 2)
                    require(parts.size == 2) { "Expected /source/<id>/<method>" }
                    val sourceId = java.net.URLDecoder.decode(parts[0], Charsets.UTF_8)
                    json(200, runBlocking { call(sourceId, parts[1], body()) })
                }
                else -> json(404, JSONObject().put("error", "Not found"))
            }
        } catch (error: Throwable) {
            var cause: Throwable = error
            if (error is java.lang.reflect.InvocationTargetException && error.cause != null) cause = error.cause!!
            json(if (error is IllegalArgumentException || error is org.json.JSONException) 400 else 500,
                JSONObject().put("error", cause.message ?: cause.javaClass.simpleName))
        }
    }

    private fun installed(installed: app.hibiki.apk.InstalledApkExtension) = json(200, JSONObject()
        .put("packageName", installed.packageName)
        .put("name", installed.name)
        .put("versionName", installed.versionName)
        .put("kind", installed.kind)
        .put("fingerprint", installed.signingFingerprint ?: JSONObject.NULL)
        .put("trusted", true))

    /** One of the source's calls, answered as the shared JSON shapes: a list comes as {"items": […]}. */
    private suspend fun call(sourceId: String, method: String, body: JSONObject): Any {
        fun items(array: JSONArray) = JSONObject().put("items", array)
        host.registry.mangaAdapter(sourceId)?.let { manga ->
            return when (method) {
                "search" -> items(manga.search(body.optJSONObject("request") ?: JSONObject()))
                "latest" -> items(manga.latest(body.optInt("limit", 24)))
                "getById" -> manga.getById(body.getString("id"))
                "playbackGroups" -> items(manga.playbackGroups(body.getString("titleId")))
                "pages" -> items(manga.pages(body.getString("titleId"), body.getString("chapterId")))
                "readSettings" -> JSONObject()
                "filterCatalog" -> JSONObject().put("sortOptions", JSONArray()).put("filters", JSONArray())
                else -> throw IllegalArgumentException("Manga sources do not support $method()")
            }
        }
        val adapter = host.adapter(sourceId)
        return when (method) {
            "search" -> items(adapter.search(body.optJSONObject("request") ?: JSONObject()))
            "latest" -> items(adapter.latest(body.optInt("limit", 24)))
            "getById" -> adapter.getById(body.getString("id"))
            "playbackGroups" -> items(adapter.playbackGroups(body.getString("titleId")))
            "playerLinks" -> items(adapter.playerLinks(body.optString("titleId").ifEmpty { null }, body.getString("episodeId")))
            "filterCatalog" -> adapter.filterCatalog()
            "readSettings" -> ApkPreferences.values(host.application, adapter)
            "writeSetting" -> {
                ApkPreferences.write(host.application, adapter, body.getString("key"), if (body.isNull("value")) null else body.getString("value"))
                JSONObject()
            }
            else -> throw IllegalArgumentException("APK sources do not support $method()")
        }
    }

    // --- pictures -----------------------------------------------------------------------------------------

    private fun query(query: String, name: String): String? =
        query.split('&').firstNotNullOfOrNull { pair ->
            val key = pair.substringBefore('=')
            if (java.net.URLDecoder.decode(key, Charsets.UTF_8) == name) java.net.URLDecoder.decode(pair.substringAfter('=', ""), Charsets.UTF_8) else null
        }

    /**
     * A picture fetched the way the source fetches its pages - its own headers and the shared cookie
     * store, so a site that let the source in serves its posters too. The client without the
     * challenge interceptor: one blocked picture must never open a challenge page.
     */
    private fun image(q: String): Reply {
        val url = query(q, "u")
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return json(400, JSONObject().put("error", "Bad Request"))
        val sourceId = query(q, "s")
        val headers = sourceId?.let { id ->
            host.registry.mangaAdapter(id)?.http?.headers ?: (host.registry.adapter(id)?.catalogue as? AnimeHttpSource)?.headers
        }
        val client = if (sourceId != null && host.registry.mangaAdapter(sourceId) != null) NetworkHelper.mangaInstance().imageClient else NetworkHelper.instance().imageClient
        return try {
            val builder = Request.Builder().url(url)
            headers?.let { builder.headers(it) }
            client.newCall(builder.build()).execute().use { response ->
                if (!response.isSuccessful) return json(response.code, JSONObject().put("error", "Upstream ${response.code}"))
                val type = response.header("Content-Type")?.substringBefore(';')?.trim() ?: "image/jpeg"
                Reply(200, type, response.body.bytes())
            }
        } catch (_: java.io.IOException) {
            json(502, JSONObject().put("error", "Bad Gateway"))
        }
    }

    private fun page(q: String): Reply {
        val adapter = query(q, "s")?.let { host.registry.mangaAdapter(it) } ?: return json(404, JSONObject().put("error", "Not found"))
        val token = query(q, "t") ?: return json(400, JSONObject().put("error", "Bad Request"))
        val (type, bytes) = runBlocking { adapter.image(token) }
        return Reply(200, type, bytes)
    }

    private fun icon(q: String): Reply {
        val packageName = query(q, "p") ?: return json(400, JSONObject().put("error", "Bad Request"))
        val file: File = host.store.find(packageName)?.iconFile ?: return json(404, JSONObject().put("error", "Not found"))
        return Reply(200, "image/png", file.readBytes())
    }

    private fun json(status: Int, json: Any) = Reply(status, "application/json; charset=utf-8", json.toString().toByteArray(Charsets.UTF_8))
}
