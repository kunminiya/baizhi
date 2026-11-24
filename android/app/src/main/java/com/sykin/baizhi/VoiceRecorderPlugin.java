package com.sykin.baizhi;

import android.Manifest;
import android.media.MediaRecorder;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;

@CapacitorPlugin(
    name = "VoiceRecorder",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class VoiceRecorderPlugin extends Plugin {
    private MediaRecorder recorder = null;
    private File outputFile = null;

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermsCallback");
            return;
        }
        startRecording(call);
    }

    @PermissionCallback
    private void micPermsCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            startRecording(call);
        } else {
            call.reject("microphone_permission_denied");
        }
    }

    private void startRecording(PluginCall call) {
        cleanupRecorder(true);
        try {
            File file = new File(getContext().getCacheDir(), "baizhi_voice.m4a");
            if (file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
            MediaRecorder mr = new MediaRecorder();
            mr.setAudioSource(MediaRecorder.AudioSource.MIC);
            mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            mr.setAudioChannels(1);
            mr.setAudioSamplingRate(16000);
            mr.setAudioEncodingBitRate(32000);
            mr.setOutputFile(file.getAbsolutePath());
            mr.prepare();
            mr.start();
            recorder = mr;
            outputFile = file;
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            cleanupRecorder(true);
            call.reject("record_start_failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (recorder == null || outputFile == null) {
            call.reject("not_recording");
            return;
        }
        File file = outputFile;
        try {
            recorder.stop();
        } catch (Exception ignored) {
            // Very short recording can throw RuntimeException on stop
        } finally {
            cleanupRecorder(false);
        }
        try {
            if (!file.exists() || file.length() == 0) {
                call.reject("empty_audio");
                return;
            }
            byte[] bytes = new byte[(int) file.length()];
            try (FileInputStream fis = new FileInputStream(file)) {
                int offset = 0;
                while (offset < bytes.length) {
                    int read = fis.read(bytes, offset, bytes.length - offset);
                    if (read < 0) break;
                    offset += read;
                }
            }
            String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            JSObject ret = new JSObject();
            ret.put("base64", b64);
            ret.put("mimeType", "audio/mp4");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read_audio_failed: " + e.getMessage());
        } finally {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cleanupRecorder(true);
        JSObject ret = new JSObject();
        ret.put("canceled", true);
        call.resolve(ret);
    }

    private void cleanupRecorder(boolean deleteFile) {
        if (recorder != null) {
            try {
                recorder.release();
            } catch (Exception ignored) {}
            recorder = null;
        }
        if (deleteFile && outputFile != null) {
            //noinspection ResultOfMethodCallIgnored
            outputFile.delete();
        }
        outputFile = null;
    }

    @Override
    protected void handleOnDestroy() {
        cleanupRecorder(true);
    }
}
