package com.pathomitra.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.TimeUnit;

/** Copies the newest encrypted local snapshot to the operator-selected SAF tree daily. */
public class BackupCopyWorker extends Worker {
    public static final String WORK_NAME = "pathomitra-off-device-backup";

    public BackupCopyWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiresBatteryNotLow(true)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(BackupCopyWorker.class, 1, TimeUnit.DAYS)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences("pathomitra-backup-destination", Context.MODE_PRIVATE);
        String stored = prefs.getString("tree-uri", null);
        if (stored == null) return Result.success();
        File directory = new File(getApplicationContext().getFilesDir(), "PathoMitra/Backups");
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null || files.length == 0) return Result.success();
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        File source = files[0];
        Uri tree = Uri.parse(stored);
        Uri created = null;
        try {
            byte[] payload;
            try (InputStream input = new FileInputStream(source); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
                payload = bytes.toByteArray();
            }
            JSONObject envelope = new JSONObject(new String(payload, java.nio.charset.StandardCharsets.UTF_8));
            if (!"backup-encrypted".equals(envelope.optString("kind"))) return Result.success();
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            created = DocumentsContract.createDocument(getApplicationContext().getContentResolver(), parent, "application/json", source.getName());
            if (created == null) throw new Exception("Could not create destination document");
            try (OutputStream output = getApplicationContext().getContentResolver().openOutputStream(created, "w")) {
                if (output == null) throw new Exception("Could not open destination document");
                output.write(payload);
                output.flush();
            }
            try (InputStream input = getApplicationContext().getContentResolver().openInputStream(created); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                if (input == null) throw new Exception("Could not read destination document");
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
                if (!Arrays.equals(payload, bytes.toByteArray())) throw new Exception("Read-back verification failed");
            }
            return Result.success();
        } catch (Exception error) {
            Log.w("PathoMitraBackup", "Scheduled off-device backup copy failed", error);
            if (created != null) {
                try { DocumentsContract.deleteDocument(getApplicationContext().getContentResolver(), created); } catch (Exception ignored) { }
            }
            return Result.retry();
        }
    }
}
