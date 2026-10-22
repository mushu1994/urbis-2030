package io.github.mushu1994.urbis2030;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

/**
 * URBIS 2030 — application Android : le jeu web (dossier assets/public) affiché dans une WebView Capacitor.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebSettings settings = getBridge().getWebView().getSettings();
        // La taille de police du système ne doit pas agrandir l'interface du jeu (elle a sa propre échelle)
        settings.setTextZoom(100);
        // Le son du jeu démarre sans geste préalable de l'utilisateur
        settings.setMediaPlaybackRequiresUserGesture(false);
        // L'écran ne se met pas en veille pendant une partie
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
