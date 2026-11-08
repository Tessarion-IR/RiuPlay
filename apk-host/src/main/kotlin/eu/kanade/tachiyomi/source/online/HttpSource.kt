// extensions-lib 1.6 HttpSource (see ../Source.kt for where the shape comes from). The id formula and the
// URL helpers are the ones every Tachiyomi host uses, so a source keeps the id its repository publishes.
package eu.kanade.tachiyomi.source.online

import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.net.URISyntaxException
import java.security.MessageDigest

@Suppress("unused")
abstract class HttpSource : CatalogueSource {
    protected val network: NetworkHelper = NetworkHelper.mangaInstance()

    abstract val baseUrl: String

    open fun getHomeUrl(): String = baseUrl

    open val versionId: Int = 1

    override val id: Long by lazy { generateId(name, lang, versionId) }

    // A delegate field named headers$delegate: Keiyoushi's KeiSource replaces it by reflection.
    val headers: Headers by lazy { headersBuilder().build() }

    open val client: OkHttpClient get() = network.client

    protected open fun headersBuilder(): Headers.Builder = Headers.Builder().add("User-Agent", network.defaultUserAgentProvider())

    override fun toString(): String = "$name (${lang.uppercase()})"

    open suspend fun getImageUrl(page: Page): String = throw UnsupportedOperationException("${toString()} has no image URL for page ${page.index}")

    protected open fun imageRequest(page: Page): Request = GET(page.imageUrl!!, headers)

    /** RiuPlay: the source's own request for a page's picture (imageRequest is protected). */
    fun hostImageRequest(page: Page): Request = imageRequest(page)

    fun SChapter.setUrlWithoutDomain(url: String) {
        this.url = getUrlWithoutDomain(url)
    }

    fun SManga.setUrlWithoutDomain(url: String) {
        this.url = getUrlWithoutDomain(url)
    }

    private fun getUrlWithoutDomain(orig: String): String = try {
        val uri = URI(orig.replace(" ", "%20"))
        var out = uri.path
        if (uri.query != null) out += "?" + uri.query
        if (uri.fragment != null) out += "#" + uri.fragment
        out
    } catch (_: URISyntaxException) {
        orig
    }

    abstract fun getMangaUrl(manga: SManga): String

    abstract fun getChapterUrl(chapter: SChapter): String

    companion object {
        /** The first 64 bits of MD5("name/lang/versionId"), sign bit cleared. */
        fun generateId(name: String, lang: String, versionId: Int): Long {
            val bytes = MessageDigest.getInstance("MD5").digest("${name.lowercase()}/$lang/$versionId".toByteArray())
            return (0..7).map { bytes[it].toLong() and 0xff shl 8 * (7 - it) }.reduce(Long::or) and Long.MAX_VALUE
        }
    }
}
