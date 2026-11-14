package au.com.sheltuh.app;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Map;

/**
 * The phone app's activity (docs/mobile-app.md). Capacitor's own, plus one
 * change: a page the site answers with an HTTP error (a missing event's 404,
 * a 500) shows the site's own error page, as in a browser. Capacitor 8.6.2's
 * BridgeWebViewClient.onReceivedHttpError loads the bundled "couldn't load"
 * page (server.errorPath) for any 4xx/5xx main-frame response; that page is
 * for network failures only (onReceivedError, unchanged).
 *
 * Written against @capacitor/android 8.6.2's public API (Bridge.setWebViewClient,
 * BridgeWebViewClient). Not yet compiled or run on a device: see the checklist
 * in docs/mobile-app.md.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Null only when the device has no usable WebView (BridgeActivity shows its own message then).
        if (bridge != null) {
            bridge.setWebViewClient(new SiteErrorPagesClient(bridge));
        }
    }

    /** Capacitor's client, except that HTTP error responses never swap in the bundled error page. */
    static class SiteErrorPagesClient extends BridgeWebViewClient {

        SiteErrorPagesClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            // Capacitor's handler still runs (it tells plugins' WebViewListeners), but sees the
            // request as a sub-resource, so it never loads errorPath over the site's own page.
            super.onReceivedHttpError(view, new NotMainFrame(request), errorResponse);
        }
    }

    /** The same request, reported as not for the main frame. */
    static final class NotMainFrame implements WebResourceRequest {

        private final WebResourceRequest request;

        NotMainFrame(WebResourceRequest request) {
            this.request = request;
        }

        @Override
        public Uri getUrl() {
            return request.getUrl();
        }

        @Override
        public boolean isForMainFrame() {
            return false;
        }

        @Override
        public boolean isRedirect() {
            return request.isRedirect();
        }

        @Override
        public boolean hasGesture() {
            return request.hasGesture();
        }

        @Override
        public String getMethod() {
            return request.getMethod();
        }

        @Override
        public Map<String, String> getRequestHeaders() {
            return request.getRequestHeaders();
        }
    }
}
