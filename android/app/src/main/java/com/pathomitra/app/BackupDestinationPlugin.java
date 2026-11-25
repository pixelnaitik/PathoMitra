package com.pathomitra.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** User-selected SAF destination for verified encrypted backup copies. */
@CapacitorPlugin(name = "BackupDestination")
public class BackupDestinationPlugin extends Plugin {
    private static final String PREFS = "pathomitra-backup-destination";
    private static final String URI_KEY = "tree-uri";
    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    private JSObject describe(Uri uri) throws Exception {
        String name = queryName(uri);
        JSObject result = new JSObject();
        result.put("id", uri.toString());
        result.put("label", name == null ? uri.toString() : name);
        return result;
    }

    private String queryName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) { }
        return null;
    }

    @PluginMethod
    public void chooseDestination(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) { call.reject("No activity available"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "destinationResult");
    }

    @ActivityCallback
    private void destinationResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) { call.reject("Destination selection cancelled"); return; }
        Uri uri = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            prefs().edit().putString(URI_KEY, uri.toString()).apply();
            call.resolve(describe(uri));
        } catch (Exception error) { call.reject("Could not retain destination access", error); }
    }

    @PluginMethod
    public void status(PluginCall call) {
        String stored = prefs().getString(URI_KEY, null);
        if (stored == null) { call.resolve(); return; }
        try { call.resolve(describe(Uri.parse(stored))); }
        catch (Exception error) { call.reject("Saved backup destination is unavailable", error); }
    }

    @PluginMethod
    public void copy(PluginCall call) {
        String fileName = call.getString("fileName");
        String payload = call.getString("payload");
        String stored = prefs().getString(URI_KEY, null);
        if (stored == null) { call.reject("Choose an off-device backup destination first"); return; }
        if (fileName == null || !fileName.matches("[A-Za-z0-9._-]+\\.json") || payload == null) { call.reject("Invalid backup payload"); return; }
        Uri tree = Uri.parse(stored);
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Uri created = null;
        try {
            created = DocumentsContract.createDocument(getContext().getContentResolver(), parent, "application/json", fileName);
            if (created == null) throw new Exception("Could not create destination document");
            try (OutputStream output = getContext().getContentResolver().openOutputStream(created, "w")) {
                if (output == null) throw new Exception("Could not open destination document");
                output.write(payload.getBytes(StandardCharsets.UTF_8));
                output.flush();
            }
            try (InputStream input = getContext().getContentResolver().openInputStream(created)) {
                if (input == null) throw new Exception("Could not read destination document");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
                if (!payload.equals(new String(bytes.toByteArray(), StandardCharsets.UTF_8))) throw new Exception("Off-device backup read-back verification failed");
            }
            JSObject result = new JSObject();
            result.put("fileName", queryName(created));
            result.put("verified", true);
            call.resolve(result);
        } catch (Exception error) {
            if (created != null) {
                try { DocumentsContract.deleteDocument(getContext().getContentResolver(), created); } catch (Exception ignored) { }
            }
            call.reject("Off-device backup copy failed", error);
        }
    }
}
