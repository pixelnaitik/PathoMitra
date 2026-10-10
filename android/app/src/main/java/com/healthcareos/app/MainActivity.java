package com.healthcareos.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The Capacitor bridge host.
 *
 * Screenshot and screen-recording protection (Android's FLAG_SECURE) was
 * deliberately removed: the lab wants report screens to be capturable, so the
 * window now uses Android's default behaviour — screenshots work, the
 * recent-apps thumbnail shows live content, and screen sharing captures the
 * app. Print / share / PDF output paths are unchanged.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin only feeds the bridge builder that super.onCreate()
        // consumes, so an app-defined plugin has to be declared before that call.
        registerPlugin(PdfViewerPlugin.class);

        super.onCreate(savedInstanceState);
    }
}
