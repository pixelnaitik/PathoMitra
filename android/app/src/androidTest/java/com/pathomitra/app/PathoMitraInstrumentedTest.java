package com.pathomitra.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.net.Uri;
import android.view.WindowManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PathoMitraInstrumentedTest {
    @Test
    public void appIdentityAndDefaultWindowProtectionAreCorrect() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.pathomitra.app", context.getPackageName());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> assertTrue(
                (activity.getWindow().getAttributes().flags & WindowManager.LayoutParams.FLAG_SECURE) != 0));
        }
    }

    @Test
    public void pdfViewerAcceptsOnlyOwnedPdfUris() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertTrue(PdfViewerPlugin.isAllowedUri(
            Uri.parse("content://com.pathomitra.app.fileprovider/shared_files/report.pdf"),
            context, "application/pdf"));
        assertFalse(PdfViewerPlugin.isAllowedUri(
            Uri.parse("content://com.other.fileprovider/report.pdf"),
            context, "application/pdf"));
        assertFalse(PdfViewerPlugin.isAllowedUri(
            Uri.parse("content://com.pathomitra.app.fileprovider/report.pdf"),
            context, "text/html"));
        assertFalse(PdfViewerPlugin.isAllowedUri(
            Uri.parse("file:///storage/emulated/0/Download/private.pdf"),
            context, "application/pdf"));
    }
}
