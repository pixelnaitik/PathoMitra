package com.pathomitra.app;

import android.os.Environment;
import android.os.StatFs;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Real filesystem capacity used by the renderer's fail-closed safe-mode check. */
@CapacitorPlugin(name = "StoragePressure")
public class StoragePressurePlugin extends Plugin {
    @PluginMethod
    public void pressure(PluginCall call) {
        try {
            StatFs stat = new StatFs(Environment.getDataDirectory().getAbsolutePath());
            long total = stat.getTotalBytes();
            long available = stat.getAvailableBytes();
            long used = Math.max(0L, total - available);
            JSObject result = new JSObject();
            result.put("usage", (double) used);
            result.put("quota", (double) total);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Storage capacity could not be read", error);
        }
    }
}
