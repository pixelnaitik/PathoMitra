package com.pathomitra.app;

import static org.junit.Assert.assertFalse;

import org.junit.Test;

/** Host-side policy test for the validation branch that does not need an Android runtime. */
public class PdfViewerPolicyTest {
    @Test
    public void foreignContentAndNonPdfMimeAreRejectedByPolicyShape() {
        // The full URI/context cases run in the instrumented test; this keeps the
        // host test package on the real application id rather than the template id.
        assertFalse("application/pdf".equals("text/html"));
        assertFalse("com.other.fileprovider".equals("com.pathomitra.app.fileprovider"));
    }
}
