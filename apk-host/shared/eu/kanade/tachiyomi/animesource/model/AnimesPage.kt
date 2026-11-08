package eu.kanade.tachiyomi.animesource.model



open class AnimesPage(open val animes: List<SAnime>, open val hasNextPage: Boolean) {
    val mangas: List<SAnime>
        get() = animes

    // SY -->
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is AnimesPage) return false

        if (mangas != other.mangas) return false
        if (hasNextPage != other.hasNextPage) return false

        return true
    }

    override fun hashCode(): Int {
        var result = mangas.hashCode()
        result = 31 * result + hasNextPage.hashCode()
        return result
    }
    // SY <--

    fun copy(mangas: List<SAnime> = this.mangas, hasNextPage: Boolean = this.hasNextPage): AnimesPage {
        return AnimesPage(mangas, hasNextPage)
    }

    override fun toString(): String {
        return "MangasPage(mangas=$mangas, hasNextPage=$hasNextPage)"
    }

    // KMK -->
    // Additional methods to mimic data class behavior
    operator fun component1() = mangas
    operator fun component2() = hasNextPage
    // KMK <--
}
