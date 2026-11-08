// extensions-lib 1.6 models (see ../Source.kt for where the shapes come from).
@file:Suppress("PropertyName")

package eu.kanade.tachiyomi.source.model

import android.net.Uri
import kotlinx.serialization.json.JsonObject

sealed class Filter<T>(val name: String, var state: T) {
    open class Header(name: String) : Filter<Any>(name, 0)
    open class Separator(name: String = "") : Filter<Any>(name, 0)
    abstract class Select<V>(name: String, val values: Array<V>, state: Int = 0) : Filter<Int>(name, state)
    abstract class Text(name: String, state: String = "") : Filter<String>(name, state)
    abstract class CheckBox(name: String, state: Boolean = false) : Filter<Boolean>(name, state)
    abstract class TriState(name: String, state: Int = STATE_IGNORE) : Filter<Int>(name, state) {
        fun isIgnored() = state == STATE_IGNORE
        fun isIncluded() = state == STATE_INCLUDE
        fun isExcluded() = state == STATE_EXCLUDE

        companion object {
            const val STATE_IGNORE = 0
            const val STATE_INCLUDE = 1
            const val STATE_EXCLUDE = 2
        }
    }
    abstract class Group<V>(name: String, state: List<V>) : Filter<List<V>>(name, state)
    abstract class Sort(name: String, val values: Array<String>, state: Selection? = null) : Filter<Sort.Selection?>(name, state) {
        data class Selection(val index: Int, val ascending: Boolean)
    }
}

@Suppress("JavaDefaultMethodsNotOverriddenByDelegation")
data class FilterList(val list: List<Filter<*>>) : List<Filter<*>> by list {
    constructor(vararg fs: Filter<*>) : this(if (fs.isNotEmpty()) fs.asList() else emptyList())
}

class MangasPage(val mangas: List<SManga>, val hasNextPage: Boolean) {
    @Deprecated("MangasPage is now a regular class")
    operator fun component1(): List<SManga> = mangas

    @Deprecated("MangasPage is now a regular class")
    operator fun component2(): Boolean = hasNextPage

    @Deprecated("MangasPage is now a regular class")
    fun copy(mangas: List<SManga> = this.mangas, hasNextPage: Boolean = this.hasNextPage): MangasPage = MangasPage(mangas, hasNextPage)
}

class Page(
    val index: Int,
    val url: String = "",
    var imageUrl: String? = null,
    var uri: Uri? = null,
)

enum class UpdateStrategy {
    ALWAYS_UPDATE,
    ONLY_FETCH_ONCE,
}

private val EMPTY_MEMO = JsonObject(emptyMap())

interface SChapter {
    var url: String
    var name: String
    var chapter_number: Float
    var scanlator: String?
    var date_upload: Long
    var memo: JsonObject

    companion object {
        fun create(): SChapter = SChapterImpl()
    }
}

class SChapterImpl : SChapter {
    override lateinit var url: String
    override lateinit var name: String
    override var chapter_number: Float = -1f
    override var scanlator: String? = null
    override var date_upload: Long = 0
    override var memo: JsonObject = EMPTY_MEMO
}

interface SManga {
    var url: String
    var title: String
    var thumbnail_url: String?
    var artist: String?
    var author: String?
    var status: Int
    var description: String?
    var genre: String?
    var update_strategy: UpdateStrategy
    var memo: JsonObject
    var initialized: Boolean

    companion object {
        const val UNKNOWN = 0
        const val ONGOING = 1
        const val COMPLETED = 2
        const val LICENSED = 3
        const val PUBLISHING_FINISHED = 4
        const val CANCELLED = 5
        const val ON_HIATUS = 6

        fun create(): SManga = SMangaImpl()
    }
}

class SMangaImpl : SManga {
    override lateinit var url: String
    override lateinit var title: String
    override var thumbnail_url: String? = null
    override var artist: String? = null
    override var author: String? = null
    override var status: Int = 0
    override var description: String? = null
    override var genre: String? = null
    override var update_strategy: UpdateStrategy = UpdateStrategy.ALWAYS_UPDATE
    override var memo: JsonObject = EMPTY_MEMO
    override var initialized: Boolean = false
}

class SMangaUpdate(val manga: SManga, val chapters: List<SChapter>)
