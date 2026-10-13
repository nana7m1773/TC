package cn.muyu.assistant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAssistantPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
