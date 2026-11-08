package android.webkit;

/** RiuPlay: what Keiyoushi's WebView helper overrides; the host's pages report no console or progress. */
public class WebChromeClient {
    public boolean onConsoleMessage(ConsoleMessage message) { return false; }

    public void onProgressChanged(WebView view, int newProgress) {}
}
