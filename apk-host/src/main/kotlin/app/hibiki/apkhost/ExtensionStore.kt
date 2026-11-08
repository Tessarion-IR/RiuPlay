package app.hibiki.apkhost

import app.hibiki.apk.InstalledApkExtension
import com.android.apksig.ApkVerifier
import net.dongliu.apk.parser.ApkFile
import org.json.JSONObject
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.File
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import javax.xml.parsers.DocumentBuilderFactory

/** What an APK declares about itself, before it is installed or trusted. */
class ApkManifest(
    val packageName: String,
    val label: String?,
    val versionName: String?,
    val versionCode: Long,
    val isAnimeExtension: Boolean,
    val isMangaExtension: Boolean,
    val sourceClassName: String?,
    val isNsfw: Boolean,
    val iconPng: ByteArray?,
)

/**
 * APK sources installed into the app: the APK files under <data>/exts, each with its icon, and the
 * signing certificates the person has agreed to trust (<data>/trust.json). Nothing here touches
 * the operating system's own installed software; loading is the registry's job.
 */
class ExtensionStore(private val root: File) {
    private val directory = File(root, DIRECTORY).apply { mkdirs() }
    private val trustFile = File(root, "trust.json")
    private val lock = Any()

    fun list(): List<InstalledApkExtension> =
        directory.listFiles().orEmpty()
            .filter { it.isFile && (it.extension == EXTENSION || it.extension == JAR_EXTENSION) }
            .mapNotNull { read(it) }
            .sortedBy { it.name.lowercase() }

    fun find(packageName: String): InstalledApkExtension? = list().firstOrNull { it.packageName == packageName }

    /** What an APK file declares, or null for a file that is not an anime extension. */
    fun inspect(apk: File): InstalledApkExtension? = read(apk)

    private fun read(apk: File): InstalledApkExtension? {
        if (apk.name.endsWith(".jar") || apk.name.endsWith(".$JAR_EXTENSION")) return readSignedJar(apk)
        val manifest = runCatching { readManifest(apk) }.getOrNull() ?: return null
        if (!manifest.isAnimeExtension && !manifest.isMangaExtension) return null
        val versionName = manifest.versionName ?: return null
        val fingerprint = signingFingerprint(apk)
        val manga = !manifest.isAnimeExtension
        return InstalledApkExtension(
            packageName = manifest.packageName,
            name = (manifest.label ?: manifest.packageName).removePrefix("Aniyomi: ").removePrefix("Tachiyomi: "),
            versionName = versionName,
            versionCode = manifest.versionCode,
            // Aniyomi: the major version (14 in 14.10). Tachiyomi: the lib's minor (6 in 1.6.5).
            apiVersion = if (manga) versionName.split('.').getOrNull(1)?.toIntOrNull() else versionName.substringBefore('.').toIntOrNull(),
            kind = if (manga) "manga" else "anime",
            sourceClassName = manifest.sourceClassName,
            isNsfw = manifest.isNsfw,
            signingFingerprint = fingerprint,
            isTrusted = fingerprint != null && trustedFingerprint(manifest.packageName) == fingerprint,
            file = apk,
            iconFile = File(directory, "${manifest.packageName}.png").takeIf(File::isFile),
        )
    }

    /**
     * Takes a downloaded APK in: checks it is an anime extension of a supported API, then moves it
     * into place and saves its icon. [expectedPackage], when given, must match (a repository entry
     * names the package it is supposed to be).
     */
    fun install(downloaded: File, expectedPackage: String? = null): InstalledApkExtension {
        val inspected = read(downloaded) ?: error("The file is not an Aniyomi or Tachiyomi extension")
        require(inspected.packageName.matches(PACKAGE_NAME_PATTERN)) { "Invalid package name: ${inspected.packageName}" }
        if (expectedPackage != null) {
            require(inspected.packageName == expectedPackage) { "Package mismatch: expected $expectedPackage, got ${inspected.packageName}" }
        }
        requireNotNull(inspected.sourceClassName) { "The extension does not declare a source class" }
        val api = inspected.apiVersion
        if (inspected.kind == "manga") {
            require(inspected.versionName.substringBeforeLast('.') in SUPPORTED_MANGA_LIBS) {
                "This extension uses Tachiyomi extensions-lib ${inspected.versionName.substringBeforeLast('.')}; supported is ${SUPPORTED_MANGA_LIBS.joinToString()}"
            }
        } else {
            require(api != null && api in SUPPORTED_API_VERSIONS) {
                "This extension uses Aniyomi API ${api ?: "unknown"}; supported are ${SUPPORTED_API_VERSIONS.first}-${SUPPORTED_API_VERSIONS.last}"
            }
        }
        requireNotNull(inspected.signingFingerprint) { "The extension is not signed" }

        val target = File(directory, "${inspected.packageName}." + if (inspected.file.extension == "jar" || inspected.file.extension == JAR_EXTENSION) JAR_EXTENSION else EXTENSION)
        val icon = if (target.extension == JAR_EXTENSION) null else runCatching { readManifest(downloaded).iconPng }.getOrNull()
        synchronized(lock) {
            downloaded.copyTo(target, overwrite = true)
            downloaded.delete()
            // One form per package: a signed jar replaces an APK install and the other way round.
            File(directory, "${inspected.packageName}." + if (target.extension == JAR_EXTENSION) EXTENSION else JAR_EXTENSION).delete()
            File(directory, "${inspected.packageName}.png").let { file -> if (icon != null) file.writeBytes(icon) else file.delete() }
        }
        return read(target) ?: error("The installed extension could not be read back")
    }

    fun uninstall(packageName: String) {
        require(packageName.matches(PACKAGE_NAME_PATTERN)) { "Invalid package name: $packageName" }
        synchronized(lock) {
            File(directory, "$packageName.$EXTENSION").delete()
            File(directory, "$packageName.$JAR_EXTENSION").delete()
            File(directory, "$packageName.png").delete()
        }
    }

    /**
     * RiuPlay: a Keiyoushi extension's signed jar (the repository's `jarUrl`): JVM class files built from the
     * same source as the APK, so nothing is converted. Every entry outside META-INF must be signed, and by
     * one certificate only; its SHA-256 is the fingerprint (the same form as an APK signer's). The manifest
     * inside is plain XML. Null when the file is not such a jar or a signature does not verify.
     */
    private fun readSignedJar(file: File): InstalledApkExtension? {
        val fingerprint = jarSigningFingerprint(file) ?: return null
        val xml = runCatching {
            java.util.zip.ZipFile(file).use { zip -> zip.getEntry("AndroidManifest.xml")?.let { e -> zip.getInputStream(e).use { it.readBytes() } } }
        }.getOrNull() ?: return null
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = false
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        }
        val doc = runCatching { factory.newDocumentBuilder().parse(ByteArrayInputStream(xml)) }.getOrNull() ?: return null
        val root = doc.documentElement
        if (doc.getElementsByTagName("uses-feature").let { list -> (0 until list.length).none { (list.item(it) as Element).getAttribute("android:name") == MANGA_EXTENSION_FEATURE } }) return null
        val metadata = HashMap<String, String>()
        val nodes = doc.getElementsByTagName("meta-data")
        for (i in 0 until nodes.length) {
            val element = nodes.item(i) as Element
            metadata[element.getAttribute("android:name")] = element.getAttribute("android:value")
        }
        val packageName = root.getAttribute("package").ifEmpty { return null }
        val versionName = root.getAttribute("android:versionName").ifEmpty { return null }
        val label = (doc.getElementsByTagName("application").item(0) as? Element)?.getAttribute("android:label")
        return InstalledApkExtension(
            packageName = packageName,
            name = metadata["tachiyomix.name"]?.takeIf(String::isNotBlank) ?: label?.removePrefix("Tachiyomi: ")?.takeIf(String::isNotBlank) ?: packageName,
            versionName = versionName,
            versionCode = root.getAttribute("android:versionCode").toLongOrNull() ?: 0,
            apiVersion = versionName.split('.').getOrNull(1)?.toIntOrNull(),
            kind = "manga",
            sourceClassName = metadata[MANGA_METADATA_SOURCE_CLASS]?.takeIf(String::isNotBlank),
            isNsfw = metadata[MANGA_METADATA_NSFW]?.toIntOrNull() == 1,
            signingFingerprint = fingerprint,
            isTrusted = trustedFingerprint(packageName) == fingerprint,
            file = file,
            iconFile = File(directory, "$packageName.png").takeIf(File::isFile),
        )
    }

    // --- trust ----------------------------------------------------------------------------------------

    private fun readTrust(): JSONObject = runCatching { JSONObject(trustFile.readText()) }.getOrDefault(JSONObject())

    fun trustedFingerprint(packageName: String): String? = synchronized(lock) { readTrust().optString(packageName, "").ifEmpty { null } }

    fun isTrusted(packageName: String, fingerprint: String): Boolean = trustedFingerprint(packageName) == fingerprint

    fun trust(packageName: String, fingerprint: String) = synchronized(lock) {
        trustFile.writeText(readTrust().put(packageName, fingerprint).toString())
    }

    fun forget(packageName: String) = synchronized(lock) {
        trustFile.writeText(readTrust().apply { remove(packageName) }.toString())
    }

    companion object {
        private const val DIRECTORY = "exts"
        private const val EXTENSION = "ext"
        /** RiuPlay: a Keiyoushi extension as the signed JVM jar its repository publishes beside the APK. */
        private const val JAR_EXTENSION = "kjar"
        private const val ANIME_EXTENSION_FEATURE = "tachiyomi.animeextension"
        private const val METADATA_SOURCE_CLASS = "tachiyomi.animeextension.class"
        private const val METADATA_NSFW = "tachiyomi.animeextension.nsfw"
        private const val MANGA_EXTENSION_FEATURE = "tachiyomi.extension"
        private const val MANGA_METADATA_SOURCE_CLASS = "tachiyomi.extension.class"
        private const val MANGA_METADATA_NSFW = "tachiyomi.extension.nsfw"

        /** Keiyoushi's extensions-lib (github.com/keiyoushi/extensions-lib): the 1.6 API in eu/kanade/tachiyomi/source. */
        val SUPPORTED_MANGA_LIBS = setOf("1.6")
        private val PACKAGE_NAME_PATTERN = Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")

        /** extensions-lib v14 through v17 (hosters, seasons and related titles arrived in 16; 17 adds JsonObject extras to Video and Hoster). */
        val SUPPORTED_API_VERSIONS = 14..17

        fun readManifest(apk: File): ApkManifest = ApkFile(apk).use { parsed ->
            val meta = parsed.apkMeta
            val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(ByteArrayInputStream(parsed.manifestXml.toByteArray()))
            val metadata = HashMap<String, String>()
            val children = doc.getElementsByTagName("application").item(0)?.childNodes
            if (children != null) {
                for (i in 0 until children.length) {
                    val node = children.item(i)
                    if (node.nodeType == Node.ELEMENT_NODE && node.nodeName == "meta-data") {
                        val element = node as Element
                        val name = element.getAttribute("android:name")
                        if (name.isNotEmpty()) metadata[name] = element.getAttribute("android:value")
                    }
                }
            }
            val icon = runCatching {
                parsed.allIcons
                    .filter { it.isFile && it.data != null && it.path?.lowercase()?.endsWith(".png") == true }
                    .maxByOrNull { it.data.size }?.data
            }.getOrNull()
            ApkManifest(
                packageName = meta.packageName,
                label = meta.label,
                versionName = meta.versionName,
                versionCode = meta.versionCode ?: 0,
                isAnimeExtension = meta.usesFeatures.orEmpty().any { it.name == ANIME_EXTENSION_FEATURE },
                isMangaExtension = meta.usesFeatures.orEmpty().any { it.name == MANGA_EXTENSION_FEATURE },
                sourceClassName = (metadata[METADATA_SOURCE_CLASS] ?: metadata[MANGA_METADATA_SOURCE_CLASS])?.takeIf(String::isNotBlank),
                isNsfw = (metadata[METADATA_NSFW] ?: metadata[MANGA_METADATA_NSFW])?.toIntOrNull() == 1,
                iconPng = icon,
            )
        }

        /**
         * SHA-256 of each signer certificate, sorted and joined: the same string the Android build
         * stores, so a trust decision means the same thing on both. Null when the signature does not verify.
         */
        /** RiuPlay: the one signer of every entry of a signed jar, or null (unsigned, partly signed, tampered, or several signers). */
        fun jarSigningFingerprint(file: File): String? = runCatching {
            val signers = HashSet<String>()
            java.util.jar.JarFile(file, true).use { jar ->
                for (entry in jar.entries()) {
                    // Reading an entry to its end is what makes JarFile check its digest (a mismatch throws).
                    jar.getInputStream(entry).use { it.readAllBytes() }
                    if (entry.isDirectory) continue
                    val name = entry.name.uppercase()
                    if (name.startsWith("META-INF/") && (name == "META-INF/MANIFEST.MF" || name.endsWith(".SF") || name.endsWith(".RSA") || name.endsWith(".DSA") || name.endsWith(".EC"))) continue
                    val certs = entry.codeSigners?.map { it.signerCertPath.certificates.first() } ?: return null
                    if (certs.size != 1) return null
                    signers += MessageDigest.getInstance("SHA-256").digest(certs.first().encoded).joinToString("") { b -> "%02x".format(b) }
                }
            }
            signers.singleOrNull()
        }.getOrNull()

        fun signingFingerprint(apk: File): String? = runCatching {
            if (apk.name.endsWith(".jar") || apk.name.endsWith(".$JAR_EXTENSION")) return jarSigningFingerprint(apk)
            val result = ApkVerifier.Builder(apk).build().verify()
            if (!result.isVerified) return null
            result.signerCertificates
                .map { MessageDigest.getInstance("SHA-256").digest(it.encoded).joinToString("") { b -> "%02x".format(b) } }
                .sorted()
                .joinToString(",")
                .takeIf(String::isNotBlank)
        }.getOrNull()
    }
}
