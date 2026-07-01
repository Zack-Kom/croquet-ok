package au.okinnovations.croquetok;

import android.os.Bundle;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Clerk's session handshake sets/reads cookies on the clerk.croquetok.com
        // FAPI domain, which is a different host than the croquetok.com page loaded
        // via server.url. Android WebView blocks such third-party cookies by default,
        // causing Clerk to return "unauthorized request". Allow them for our WebView.
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(getBridge().getWebView(), true);
    }
}
