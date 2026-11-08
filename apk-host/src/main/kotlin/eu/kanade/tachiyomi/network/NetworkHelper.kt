package eu.kanade.tachiyomi.network

import android.content.Context
import android.webkit.WebSettings
import app.hibiki.apkhost.TrustStores
import eu.kanade.tachiyomi.network.interceptor.ClearanceInterceptor
import eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor
import eu.kanade.tachiyomi.network.interceptor.IgnoreGzipInterceptor
import eu.kanade.tachiyomi.network.interceptor.UncaughtExceptionInterceptor
import eu.kanade.tachiyomi.network.interceptor.UserAgentInterceptor
import okhttp3.Cache
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.brotli.BrotliInterceptor
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Host implementation of the Aniyomi network service, the desktop twin of the Android build's:
 * cookies shared with the page backend (android.webkit.CookieManager), User-Agent defaulting,
 * Brotli, a small response cache. DNS falls back to DNS-over-HTTPS when the network's resolver
 * refuses a host. A Cloudflare challenge is passed by the person in the application's window (see
 * CloudflareInterceptor); what that earns is sent from then on.
 */
class NetworkHelper(
    context: Context,
    /**
     * Aniyomi's network interceptors (gzip passthrough, Brotli). Keiyoushi's 1.6 sources refuse a client that
     * has them - they install their own compression handling - so the manga instance leaves them out.
     */
    private val legacyCompression: Boolean = true,
) {
    internal val appContext: Context = context.applicationContext

    // One cookie store for every instance (it is the page backend's CookieManager underneath).
    val cookieJar: CookieJar = AndroidCookieJar()

    private fun clientBuilder(): OkHttpClient.Builder = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .apply {
            // RiuPlay: confined, the host has no network of its own; the application opens each connection.
            if (app.riuplay.apkhost.Broker.enabled) {
                dns(app.riuplay.apkhost.BrokerDns)
                socketFactory(app.riuplay.apkhost.BrokerSocketFactory)
                proxy(java.net.Proxy.NO_PROXY)
            } else {
                dns(FallbackDns())
            }
        }
        // The runtime's CA list plus the system's: a site on a newer CA than the runtime knows must still load.
        .sslSocketFactory(TrustStores.socketFactory, TrustStores.manager)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(120, TimeUnit.SECONDS)
        .cache(Cache(File(appContext.cacheDir, if (legacyCompression) "network_cache" else "network_cache_manga"), 5L * 1024 * 1024))
        .addInterceptor(ClearanceInterceptor())
        .addInterceptor(FailureRecordingInterceptor())
        .addInterceptor(UncaughtExceptionInterceptor())
        .addInterceptor(UserAgentInterceptor(::defaultUserAgentProvider))
        .apply {
            if (legacyCompression) {
                addNetworkInterceptor(IgnoreGzipInterceptor())
                addNetworkInterceptor(BrotliInterceptor)
            }
        }

    /** Without the Cloudflare interceptor, for hosts that must not be loaded in a page. */
    val nonCloudflareClient: OkHttpClient by lazy { clientBuilder().build() }

    /** Posters and icons: a disk cache of their own, as OkHttp wants one cache per directory. */
    val imageClient: OkHttpClient by lazy {
        nonCloudflareClient.newBuilder()
            .cache(Cache(File(appContext.cacheDir, if (legacyCompression) "image_cache" else "image_cache_manga"), 100L * 1024 * 1024))
            .build()
    }

    val client: OkHttpClient by lazy { clientBuilder().addInterceptor(CloudflareInterceptor()).build() }

    /** Retained for older sources; [client] already handles Cloudflare. */
    @Deprecated("The regular client handles Cloudflare by default")
    val cloudflareClient: OkHttpClient
        get() = client

    fun defaultUserAgentProvider(): String = WebSettings.getDefaultUserAgent(appContext)

    companion object {
        @Volatile
        private var sharedInstance: NetworkHelper? = null

        fun initialize(context: Context) {
            if (sharedInstance == null) {
                synchronized(this) {
                    if (sharedInstance == null) sharedInstance = NetworkHelper(context.applicationContext)
                }
            }
        }

        /** One shared instance, so every source reuses the same connection pool and cookie jar. */
        fun instance(): NetworkHelper =
            sharedInstance ?: error("NetworkHelper.initialize(context) must be called first")

        @Volatile
        private var mangaShared: NetworkHelper? = null

        /** RiuPlay: the instance manga (extensions-lib 1.6) sources get - same cookies, no legacy compression interceptors. */
        fun mangaInstance(): NetworkHelper = mangaShared ?: synchronized(this) {
            mangaShared ?: NetworkHelper(instance().appContext, legacyCompression = false).also { mangaShared = it }
        }

        const val FALLBACK_USER_AGENT = WebSettings.DEFAULT_USER_AGENT
    }
}
