package io.github.mcuzmenco.wordrecall;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands text that other apps send to WordRecall over to the web layer:
 * - the text-selection menu entry (ACTION_PROCESS_TEXT), e.g. "WordRecall" next to Copy
 * - the Share sheet (ACTION_SEND, text/plain), which is what Kindle uses
 *
 * Fires an "incoming" event with { text, subject, via }. The event is retained until
 * the web app adds its listener, so text that launched the app cold is not lost.
 */
@CapacitorPlugin(name = "IncomingText")
public class IncomingTextPlugin extends Plugin {

    private static IncomingTextPlugin instance;
    private static JSObject pending;

    @Override
    public void load() {
        instance = this;
        if (pending != null) {
            notifyListeners("incoming", pending, true);
            pending = null;
        }
    }

    static void deliver(Intent intent) {
        JSObject data = fromIntent(intent);
        if (data == null) return;
        // Consume the intent so it isn't handled twice.
        intent.setAction(Intent.ACTION_MAIN);
        if (instance != null) {
            instance.notifyListeners("incoming", data, true);
        } else {
            pending = data;
        }
    }

    private static JSObject fromIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) return null;
        String action = intent.getAction();
        CharSequence text = null;
        String via;
        if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            via = "select";
        } else if (Intent.ACTION_SEND.equals(action)) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            via = "share";
        } else {
            return null;
        }
        if (text == null || text.toString().trim().isEmpty()) return null;
        JSObject data = new JSObject();
        data.put("text", text.toString());
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        data.put("subject", subject == null ? "" : subject);
        data.put("via", via);
        return data;
    }
}
