export const dynamic = "force-dynamic";

/**
 * Local extension package import.
 *
 * RiuPlay's provider interface only natively supports two formats in this
 * build: (1) built-in Direct URL / Manual sources, and (2) a remote
 * Suwayomi Server connection. Aniyomi/Mihon-style .apk packages (Android/
 * Kotlin, used by the yuzono and keiyoushi repositories) require an Android
 * runtime and are not executed inside this process for security and
 * technical-compatibility reasons — see THIRD_PARTY_NOTICES.md. We never
 * report success for an import we cannot actually perform.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return Response.json({ error: "No file was provided." }, { status: 400 });
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".apk")) {
    return Response.json(
      {
        error:
          "Unsupported format: Android APK packages require an Android runtime and cannot be executed inside RiuPlay's desktop/web process. Installation was not performed.",
      },
      { status: 415 },
    );
  }
  if (name.endsWith(".jar")) {
    return Response.json(
      {
        error:
          "Unsupported format: JVM .jar extension packages are not supported by RiuPlay's native provider interface in this build. Installation was not performed.",
      },
      { status: 415 },
    );
  }
  return Response.json(
    { error: `Unrecognized extension package format for "${file.name}". Installation was not performed.` },
    { status: 415 },
  );
}
