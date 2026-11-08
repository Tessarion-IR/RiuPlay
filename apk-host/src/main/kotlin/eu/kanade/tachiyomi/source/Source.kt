// The Tachiyomi/Mihon manga source API at extensions-lib 1.6, as Keiyoushi's extensions are built against it
// (github.com/keiyoushi/extensions-lib @42255ee, Apache-2.0). The library publishes the declarations only;
// these are RiuPlay's implementations of them, with the same names and shapes so the compiled extensions link.
package eu.kanade.tachiyomi.source

import androidx.preference.PreferenceScreen
import eu.kanade.tachiyomi.source.model.FilterList
import eu.kanade.tachiyomi.source.model.MangasPage
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.model.SMangaUpdate

interface Source {
    val id: Long
    val name: String
    val supportsLatest: Boolean

    fun getFilterList(): FilterList = FilterList()

    suspend fun getPopularManga(page: Int): MangasPage
    suspend fun getLatestUpdates(page: Int): MangasPage
    suspend fun getSearchManga(page: Int, query: String, filters: FilterList): MangasPage
    suspend fun getMangaUpdate(manga: SManga, chapters: List<SChapter>, fetchDetails: Boolean, fetchChapters: Boolean): SMangaUpdate
    suspend fun getPageList(chapter: SChapter): List<Page>
}

interface CatalogueSource : Source {
    val lang: String
    val supportsRelatedMangas: Boolean get() = false
    val disableRelatedMangasBySearch: Boolean get() = false
    val disableRelatedMangas: Boolean get() = false
    suspend fun fetchRelatedMangaList(manga: SManga): List<SManga> = throw UnsupportedOperationException("Unsupported!")
}

interface ConfigurableSource {
    fun setupPreferenceScreen(screen: PreferenceScreen)
}

interface SourceFactory {
    fun createSources(): List<Source>
}

interface UnmeteredSource
