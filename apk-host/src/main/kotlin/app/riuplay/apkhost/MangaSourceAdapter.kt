package app.riuplay.apkhost

import android.util.Log
import app.hibiki.apk.ApkImageProxy
import app.hibiki.apk.ApkSourceException
import app.hibiki.apk.InstalledApkExtension
import eu.kanade.tachiyomi.network.NetworkFailureLog
import eu.kanade.tachiyomi.network.await
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

/**
 * RiuPlay: one Keiyoushi (Tachiyomi extensions-lib 1.6) manga source, answering the calls RiuPlay's media
 * catalogue makes of any source (host API 2, content type "manga"): search and latest as titles, a title's
 * details, its chapters as one playback group, and a chapter's pages. A title or chapter id is the source's
 * own URL, or - when the source keeps state in its `memo` - that URL and the memo packed together, so a
 * restart or the library can hand the same object back. A page is an opaque token the host turns back into
 * the source's own image request (headers, cookies, interceptors), see [image].
 */
class MangaSourceAdapter(
    val extension: InstalledApkExtension,
    val source: CatalogueSource,
) {
    val id: String = "apk:${java.lang.Long.toUnsignedString(source.id)}"
    val name: String get() = source.name
    val lang: String get() = source.lang
    val http: HttpSource? get() = source as? HttpSource
    val baseUrl: String? get() = runCatching { http?.baseUrl }.getOrNull()?.takeIf(String::isNotBlank)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val pageCache = LinkedHashMap<String, Cached>(16, 0.75f, true)
    private val paging = Mutex()
    private val listed = ConcurrentHashMap<String, SManga>()
    private val chapters = ConcurrentHashMap<String, SChapter>()
    private val updates = ConcurrentHashMap<String, Pair<Long, SMangaUpdate>>()
    private val updateLocks = ConcurrentHashMap<String, Mutex>()

    /**
     * Details and chapters in one getMangaUpdate, one at a time per title and shared for a short while: the
     * title page asks for both at once, and Keiyoushi's sources refuse concurrent updates of the same manga.
     */
    private suspend fun update(titleId: String): SMangaUpdate =
        updateLocks.getOrPut(titleId) { Mutex() }.withLock {
            updates[titleId]?.takeIf { System.currentTimeMillis() - it.first < UPDATE_TTL_MS }?.second
                ?: guarded("details") { source.getMangaUpdate(mangaFor(titleId), emptyList(), fetchDetails = true, fetchChapters = true) }
                    .also { updates[titleId] = System.currentTimeMillis() to it }
        }

    fun info(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("version", extension.versionName)
        put("lang", lang)
        put("isNsfw", extension.isNsfw)
        put("capabilities", JSONArray().apply { if (source.supportsLatest) put("LATEST_RELEASES") })
        put("settings", JSONArray())
        put("website", baseUrl ?: JSONObject.NULL)
        put("packageName", extension.packageName)
        put("contentType", "manga")
        put("pipeline", "media")
    }

    suspend fun search(request: JSONObject): JSONArray {
        val limit = request.optInt("limit", 24).coerceIn(0, MAX_PAGE_SIZE)
        if (limit == 0) return JSONArray()
        val offset = request.optInt("offset", 0).coerceAtLeast(0)
        val query = request.optString("query", "").trim()
        val latest = query.isEmpty() && request.optString("sort", "") == "latest" && source.supportsLatest
        val key = if (latest) "latest" else "q:$query"
        return guarded("search") {
            paging.withLock {
                val cached = pageCache.getOrPut(key) { Cached() }
                while (cached.titles.size < offset + limit && !cached.finished) {
                    val page = cached.nextPage
                    val result: MangasPage = when {
                        latest -> source.getLatestUpdates(page)
                        query.isEmpty() -> source.getPopularManga(page)
                        else -> source.getSearchManga(page, query, source.getFilterList())
                    }
                    cached.titles += result.mangas.mapNotNull { toTitle(it) }
                    cached.nextPage = page + 1
                    cached.finished = !result.hasNextPage || result.mangas.isEmpty()
                }
                while (pageCache.size > MAX_CACHED_QUERIES) pageCache.remove(pageCache.keys.first())
                JSONArray(cached.titles.drop(offset).take(limit))
            }
        }
    }

    suspend fun latest(limit: Int): JSONArray {
        if (limit <= 0) return JSONArray()
        return guarded("latest") {
            val page = if (source.supportsLatest) source.getLatestUpdates(1) else source.getPopularManga(1)
            JSONArray(page.mangas.take(limit.coerceAtMost(MAX_PAGE_SIZE)).mapNotNull { toTitle(it) })
        }
    }

    suspend fun getById(titleId: String): JSONObject {
        val manga = mangaFor(titleId)
        val details = update(titleId).manga
        // The id the title was asked by stays its id: the library and progress know it by that one.
        return (toTitle(details, fallback = manga) ?: JSONObject()).put("id", titleId).put("sourceId", id)
    }

    /** The chapters, oldest first (sources list newest first), as one group. */
    suspend fun playbackGroups(titleId: String): JSONArray {
        val list = update(titleId).chapters
        if (list.isEmpty()) return JSONArray()
        val ordered = list.reversed()
        val episodes = JSONArray()
        ordered.forEachIndexed { index, chapter ->
            val chapterId = pack(chapter.url, chapter.memo)
            chapters[chapterId] = chapter
            val number = chapter.chapter_number.takeIf { it >= 0f }?.toDouble() ?: (index + 1).toDouble()
            episodes.put(JSONObject().apply {
                put("id", chapterId)
                put("number", number)
                put("title", runCatching { chapter.name }.getOrNull()?.takeIf(String::isNotBlank) ?: JSONObject.NULL)
            })
        }
        return JSONArray().put(JSONObject().put("id", "chapters").put("title", source.name).put("episodes", episodes))
    }

    /** A chapter's pages as tokens for [image]. */
    suspend fun pages(titleId: String, chapterId: String): JSONArray {
        var chapter = chapters[chapterId]
        if (chapter == null) {
            // Opened from the library after a restart: the chapter list tells its name and number.
            runCatching { playbackGroups(titleId) }
            chapter = chapters[chapterId] ?: SChapter.create().apply {
                val (url, memo) = unpack(chapterId)
                this.url = url
                this.memo = memo
                name = url
            }
        }
        val startedAt = System.currentTimeMillis()
        val pages = guarded("page list") { source.getPageList(chapter) }
        if (pages.isEmpty()) {
            val cause = NetworkFailureLog.summary(startedAt)
            throw ApkSourceException("${source.name} returned no pages" + (cause?.let { " ($it)" } ?: ""))
        }
        return JSONArray(pages.mapIndexed { index, page ->
            val token = JSONObject().put("i", index).put("u", page.url).put("img", page.imageUrl ?: JSONObject.NULL).toString()
            JSONObject().put("url", Base64.getUrlEncoder().withoutPadding().encodeToString(token.toByteArray()))
        })
    }

    /** A page's picture, fetched with the source's own image request and client. */
    suspend fun image(token: String): Pair<String, ByteArray> {
        val json = JSONObject(String(Base64.getUrlDecoder().decode(token)))
        val page = Page(json.getInt("i"), json.optString("u", ""), json.optString("img").takeIf { !json.isNull("img") && it.isNotBlank() })
        val source = http ?: throw ApkSourceException("${source.name} cannot fetch pictures")
        return guarded("page") {
            if (page.imageUrl == null) page.imageUrl = source.getImageUrl(page)
            source.client.newCall(source.hostImageRequest(page)).await().use { response ->
                if (!response.isSuccessful) throw ApkSourceException("${source.name}: the page answered HTTP ${response.code}")
                val type = response.header("Content-Type")?.substringBefore(';')?.trim()?.takeIf { it.startsWith("image/") } ?: "image/jpeg"
                type to response.body.bytes()
            }
        }
    }

    private fun mangaFor(titleId: String): SManga {
        listed[titleId]?.let { known ->
            return SManga.create().apply {
                url = known.url
                title = known.title
                thumbnail_url = known.thumbnail_url
                memo = known.memo
            }
        }
        val (url, memo) = unpack(titleId)
        return SManga.create().apply {
            this.url = url
            this.title = url
            this.memo = memo
        }
    }

    private fun toTitle(manga: SManga, fallback: SManga? = null): JSONObject? {
        val url = runCatching { manga.url }.getOrNull()?.takeIf(String::isNotBlank) ?: fallback?.url ?: return null
        val memo = runCatching { manga.memo }.getOrNull() ?: fallback?.memo ?: EMPTY
        val titleId = pack(url, memo)
        val name = runCatching { manga.title }.getOrNull()?.takeIf(String::isNotBlank) ?: fallback?.title ?: url
        val thumbnail = runCatching { manga.thumbnail_url }.getOrNull()?.takeIf(String::isNotBlank)
            ?: listed[titleId]?.thumbnail_url ?: fallback?.thumbnail_url
        if (fallback == null) {
            listed[titleId] = SManga.create().apply {
                this.url = url
                this.title = name
                this.thumbnail_url = thumbnail
                this.memo = memo
            }
        }
        val pageUrl = runCatching { http?.getMangaUrl(manga) }.getOrNull()?.takeIf { it.startsWith("http") }
        return JSONObject().apply {
            put("id", titleId)
            put("sourceId", id)
            put("englishName", name)
            put("posterUrl", ApkImageProxy.wrap(id, thumbnail) ?: JSONObject.NULL)
            put("pageUrl", pageUrl ?: JSONObject.NULL)
            put("status", when (manga.status) {
                SManga.ONGOING -> "ongoing"
                SManga.COMPLETED, SManga.PUBLISHING_FINISHED -> "completed"
                SManga.ON_HIATUS -> "hiatus"
                SManga.CANCELLED -> "cancelled"
                else -> JSONObject.NULL
            })
            put("description", runCatching { manga.description }.getOrNull()?.takeIf(String::isNotBlank) ?: JSONObject.NULL)
            val genres = runCatching { manga.genre }.getOrNull()?.split(',')?.map(String::trim)?.filter(String::isNotEmpty).orEmpty()
            put("genres", JSONArray(genres))
        }
    }

    private suspend fun <T> guarded(operation: String, block: suspend () -> T): T {
        val work = scope.async { block() }
        try {
            return withTimeoutOrNull(OPERATION_TIMEOUT_MS) { work.await() }
                ?: throw ApkSourceException("${source.name} did not finish $operation within ${OPERATION_TIMEOUT_MS / 1000}s")
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApkSourceException) {
            throw error
        } catch (error: LinkageError) {
            Log.w(TAG, "${source.name}: $operation needs something missing", error)
            throw ApkSourceException("${source.name} needs something the app does not provide: ${error.message ?: error.javaClass.simpleName}", error)
        } catch (error: StackOverflowError) {
            throw ApkSourceException("${source.name} overflowed the stack during $operation", error)
        } finally {
            work.cancel()
        }
    }

    private class Cached {
        val titles = mutableListOf<JSONObject>()
        var nextPage = 1
        var finished = false
    }

    companion object {
        private const val TAG = "MangaSources"
        private const val MAX_PAGE_SIZE = 100
        private const val MAX_CACHED_QUERIES = 12
        private const val OPERATION_TIMEOUT_MS = 60_000L
        private const val UPDATE_TTL_MS = 30_000L
        private const val MEMO_PREFIX = "memo:"
        private val EMPTY = JsonObject(emptyMap())

        /** The source's URL alone, or "memo:" and base64url(JSON {u, m}) when the source keeps a memo. */
        fun pack(url: String, memo: JsonObject): String {
            if (memo.isEmpty() && !url.startsWith(MEMO_PREFIX)) return url
            val json = JSONObject().put("u", url).put("m", JSONObject(memo.toString())).toString()
            return MEMO_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
        }

        fun unpack(id: String): Pair<String, JsonObject> {
            if (!id.startsWith(MEMO_PREFIX)) return id to EMPTY
            val json = JSONObject(String(Base64.getUrlDecoder().decode(id.removePrefix(MEMO_PREFIX))))
            val memo = Json.parseToJsonElement(json.optJSONObject("m")?.toString() ?: "{}") as? JsonObject ?: EMPTY
            return json.getString("u") to memo
        }
    }
}
