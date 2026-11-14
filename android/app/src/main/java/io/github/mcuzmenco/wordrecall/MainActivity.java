package io.github.mcuzmenco.wordrecall;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IncomingTextPlugin.class);
        super.onCreate(savedInstanceState);
        // A recreated activity (e.g. after rotation) must not re-deliver old shared text.
        if (savedInstanceState == null) {
            IncomingTextPlugin.deliver(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        IncomingTextPlugin.deliver(intent);
    }
}
