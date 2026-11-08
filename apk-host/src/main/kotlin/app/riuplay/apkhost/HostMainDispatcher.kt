@file:OptIn(kotlinx.coroutines.InternalCoroutinesApi::class)

package app.riuplay.apkhost

import kotlinx.coroutines.MainCoroutineDispatcher
import kotlinx.coroutines.internal.MainDispatcherFactory
import java.util.concurrent.Executors
import kotlin.coroutines.CoroutineContext

/**
 * RiuPlay: Dispatchers.Main for extensions (Manga UP! switches to it), which on Android is the UI thread.
 * The host has no UI, so "main" is one thread of its own; found through ServiceLoader
 * (META-INF/services/kotlinx.coroutines.internal.MainDispatcherFactory), as kotlinx-coroutines-android is.
 */
class HostMainDispatcherFactory : MainDispatcherFactory {
    override val loadPriority: Int = 0
    override fun createDispatcher(allFactories: List<MainDispatcherFactory>): MainCoroutineDispatcher = HostMainDispatcher
}

object HostMainDispatcher : MainCoroutineDispatcher() {
    private val thread = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "host-main").apply { isDaemon = true } }

    override val immediate: MainCoroutineDispatcher get() = this

    override fun dispatch(context: CoroutineContext, block: Runnable) = thread.execute(block)

    override fun toString(): String = "Dispatchers.Main[host]"
}
