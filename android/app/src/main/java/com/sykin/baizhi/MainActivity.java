package com.sykin.baizhi;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoiceRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
