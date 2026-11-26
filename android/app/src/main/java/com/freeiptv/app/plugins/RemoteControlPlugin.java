package com.freeiptv.app.plugins;

import android.content.Context;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "RemoteControlPlugin")
public class RemoteControlPlugin extends Plugin {

    private static final String TAG = "RemoteControlPlugin";
    private static final int BASE_PORT = 8765;

    private ServerSocket serverSocket;
    private volatile boolean running = false;
    private int currentPort = BASE_PORT;
    private String sessionToken = "";
    private ExecutorService executor;

    @PluginMethod
    public void startServer(PluginCall call) {
        try {
            if (running && serverSocket != null && !serverSocket.isClosed()) {
                call.resolve(buildInfo());
                return;
            }

            if (sessionToken.isEmpty()) {
                int pin = 1000 + new SecureRandom().nextInt(9000);
                sessionToken = String.valueOf(pin);
            }

            ServerSocket sock = null;
            int port = BASE_PORT;
            for (int i = 0; i < 10; i++) {
                try {
                    sock = new ServerSocket(BASE_PORT + i);
                    port = BASE_PORT + i;
                    break;
                } catch (Exception ignored) {}
            }
            if (sock == null) {
                call.reject("No se pudo abrir un puerto local para el control móvil");
                return;
            }

            serverSocket = sock;
            currentPort = port;
            running = true;
            executor = Executors.newCachedThreadPool();

            final ServerSocket activeSocket = sock;
            executor.submit(() -> acceptLoop(activeSocket));

            call.resolve(buildInfo());
        } catch (Exception e) {
            Log.e(TAG, "Error iniciando servidor remoto", e);
            call.reject("Error iniciando servidor: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        stopInternal();
        JSObject res = new JSObject();
        res.put("running", false);
        call.resolve(res);
    }

    @PluginMethod
    public void getServerInfo(PluginCall call) {
        call.resolve(buildInfo());
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        super.handleOnDestroy();
    }

    private synchronized void stopInternal() {
        running = false;
        try {
            if (serverSocket != null && !serverSocket.isClosed()) {
                serverSocket.close();
            }
        } catch (Exception ignored) {}
        serverSocket = null;
        if (executor != null) {
            try { executor.shutdownNow(); } catch (Exception ignored) {}
            executor = null;
        }
    }

    private JSObject buildInfo() {
        String ip = getLocalIpAddress();
        String url = "http://" + ip + ":" + currentPort + "/?t=" + sessionToken;
        JSObject res = new JSObject();
        res.put("running", running);
        res.put("ip", ip);
        res.put("port", currentPort);
        res.put("token", sessionToken);
        res.put("url", url);
        return res;
    }

    private void acceptLoop(ServerSocket sock) {
        while (running && !sock.isClosed()) {
            try {
                final Socket client = sock.accept();
                if (executor != null && !executor.isShutdown()) {
                    executor.submit(() -> handleClient(client));
                } else {
                    client.close();
                }
            } catch (Exception e) {
                if (running) Log.w(TAG, "Accept error: " + e.getMessage());
            }
        }
    }

    private void handleClient(Socket client) {
        try {
            client.setSoTimeout(8000);
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));

            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) {
                client.close();
                return;
            }

            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "GET";
            String fullPath = parts.length > 1 ? parts[1] : "/";

            int contentLength = 0;
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    String key = line.substring(0, idx).trim().toLowerCase();
                    String val = line.substring(idx + 1).trim();
                    if ("content-length".equals(key)) {
                        try { contentLength = Integer.parseInt(val); } catch (Exception ignored) {}
                    }
                }
            }

            String body = "";
            if (contentLength > 0 && contentLength < 1024 * 256) {
                char[] buf = new char[contentLength];
                int read = 0;
                while (read < contentLength) {
                    int n = reader.read(buf, read, contentLength - read);
                    if (n < 0) break;
                    read += n;
                }
                body = new String(buf, 0, read);
            }

            if ("OPTIONS".equalsIgnoreCase(method)) {
                sendResponse(out, 204, "text/plain; charset=utf-8", "");
            } else if ("POST".equalsIgnoreCase(method) && fullPath.startsWith("/api/cmd")) {
                handleCommand(out, body);
            } else if ("GET".equalsIgnoreCase(method) && fullPath.startsWith("/api/ping")) {
                sendResponse(out, 200, "application/json; charset=utf-8", "{\"ok\":true,\"app\":\"EDU-IPTV PRO\"}");
            } else {
                String tokenParam = extractQueryParam(fullPath, "t");
                sendResponse(out, 200, "text/html; charset=utf-8", buildRemoteHtml(tokenParam));
            }
        } catch (Exception e) {
            Log.w(TAG, "Client error: " + e.getMessage());
        } finally {
            try { client.close(); } catch (Exception ignored) {}
        }
    }

    private void handleCommand(OutputStream out, String body) throws Exception {
        JSONObject json = new JSONObject(body.isEmpty() ? "{}" : body);
        String token = json.optString("token", "");
        if (!sessionToken.equals(token)) {
            sendResponse(out, 401, "application/json; charset=utf-8", "{\"ok\":false,\"error\":\"PIN invalido\"}");
            return;
        }

        String type = json.optString("type", "");
        String action = json.optString("action", "");

        // Volumen nativo directo si es ajuste de audio del sistema
        if ("media".equals(type) && ("vol_up".equals(action) || "vol_down".equals(action) || "mute".equals(action))) {
            handleSystemVolume(action);
        }

        JSObject eventData = new JSObject();
        IteratorHelper.copyToJSObject(json, eventData);
        notifyListeners("remoteCommand", eventData);

        sendResponse(out, 200, "application/json; charset=utf-8", "{\"ok\":true}");
    }

    private void handleSystemVolume(String action) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if ("vol_up".equals(action)) {
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
            } else if ("vol_down".equals(action)) {
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
            } else if ("mute".equals(action)) {
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI);
            }
        } catch (Exception ignored) {}
    }

    private static class IteratorHelper {
        static void copyToJSObject(JSONObject src, JSObject dst) {
            java.util.Iterator<String> keys = src.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if ("token".equals(k)) continue;
                try { dst.put(k, src.get(k)); } catch (Exception ignored) {}
            }
        }
    }

    private String extractQueryParam(String path, String key) {
        int q = path.indexOf('?');
        if (q < 0) return "";
        String query = path.substring(q + 1);
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && key.equals(pair.substring(0, eq))) {
                try {
                    return URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                } catch (Exception ignored) {}
            }
        }
        return "";
    }

    private void sendResponse(OutputStream out, int code, String contentType, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String statusText = code == 200 ? "OK" : code == 204 ? "No Content" : code == 401 ? "Unauthorized" : "Error";
        String headers = "HTTP/1.1 " + code + " " + statusText + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                + "Access-Control-Allow-Headers: Content-Type\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        if (bytes.length > 0) out.write(bytes);
        out.flush();
    }

    private String getLocalIpAddress() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface nif : Collections.list(interfaces)) {
                if (!nif.isUp() || nif.isLoopback() || nif.isVirtual()) continue;
                for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress() && addr.isSiteLocalAddress()) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}

        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                int ipInt = wm.getConnectionInfo().getIpAddress();
                if (ipInt != 0) {
                    return String.format("%d.%d.%d.%d",
                            (ipInt & 0xff), (ipInt >> 8 & 0xff), (ipInt >> 16 & 0xff), (ipInt >> 24 & 0xff));
                }
            }
        } catch (Exception ignored) {}

        return "127.0.0.1";
    }

    private String buildRemoteHtml(String prefilledToken) {
        String safeToken = prefilledToken.replaceAll("[^0-9]", "");
        return "<!doctype html><html lang='es'><head><meta charset='utf-8'>"
            + "<meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no'>"
            + "<title>EDU-IPTV PRO · Control Móvil</title>"
            + "<style>"
            + ":root{--bg:#05050a;--card:#10101c;--line:rgba(255,255,255,.1);--txt:#f4f7fb;--mut:#8b93a7;--acc:#00f3ff;--acc2:#00b8d4}"
            + "*{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif;-webkit-tap-highlight-color:transparent}"
            + "body{margin:0;background:var(--bg);color:var(--txt);padding:16px;max-width:480px;margin-inline:auto}"
            + ".hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}"
            + ".brand{font-weight:800;letter-spacing:.12em;font-size:1rem}.brand span{color:var(--acc)}"
            + ".pin{display:flex;align-items:center;gap:6px;font-size:.82rem;color:var(--mut)}"
            + ".pin input{width:72px;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--acc);font-weight:700;text-align:center}"
            + ".tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}"
            + ".tab{padding:11px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--mut);font-weight:700;cursor:pointer}"
            + ".tab.on{background:rgba(0,243,255,.14);border-color:var(--acc);color:var(--acc)}"
            + ".card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;display:grid;gap:12px}"
            + ".hide{display:none!important}"
            + "label{font-size:.8rem;color:var(--mut);display:block;margin-bottom:5px}"
            + "input,textarea{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:#090912;color:var(--txt);font-size:.95rem;outline:none}"
            + "input:focus,textarea:focus{border-color:var(--acc)}"
            + ".btn{padding:13px 16px;border-radius:99px;border:0;font-weight:700;font-size:.95rem;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}"
            + ".btn-p{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#001014}"
            + ".btn-g{background:#181828;color:var(--txt);border:1px solid var(--line)}"
            + ".dpad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:250px;margin:6px auto}"
            + ".dpad button{height:58px;border-radius:14px;border:1px solid var(--line);background:#181828;color:var(--txt);font-size:1.2rem;font-weight:700;cursor:pointer}"
            + ".dpad button:active,.btn:active{transform:scale(.96)}"
            + ".dpad .ok{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#001014;border:0}"
            + ".row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}"
            + ".msg{padding:10px 12px;border-radius:10px;font-size:.85rem;text-align:center;display:none}"
            + ".msg.ok{display:block;background:rgba(34,197,94,.16);color:#4ade80}"
            + ".msg.err{display:block;background:rgba(255,77,109,.16);color:#ff758f}"
            + "</style></head><body>"
            + "<div class='hdr'><div class='brand'>EDU-IPTV <span>PRO</span></div>"
            + "<div class='pin'>PIN <input id='pin' type='tel' maxlength='4' value='" + safeToken + "'></div></div>"
            + "<div class='tabs'>"
            + "<button class='tab on' onclick='sw(\"list\",this)'>Cargar Lista</button>"
            + "<button class='tab' onclick='sw(\"ctrl\",this)'>Control TV</button>"
            + "</div>"
            + "<div id='msg' class='msg'></div>"
            + "<div id='p-list' class='card'>"
            + "<div><label>Pegar URL M3U o enlace Xtream completo</label>"
            + "<textarea id='m3u-url' rows='3' placeholder='http://servidor:8080/get.php?username=...'></textarea></div>"
            + "<div><label>Nombre (opcional)</label><input id='m3u-name' placeholder='Mi lista'></div>"
            + "<button class='btn btn-p' onclick='sendUrl()'>Enviar lista al TV</button>"
            + "<hr style='border:0;border-top:1px solid var(--line);width:100%'>"
            + "<div style='font-size:.82rem;color:var(--mut);font-weight:700'>O datos Xtream por separado:</div>"
            + "<input id='xt-srv' placeholder='Servidor (http://host:8080)'>"
            + "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>"
            + "<input id='xt-usr' placeholder='Usuario'><input id='xt-pwd' type='password' placeholder='Contraseña'></div>"
            + "<button class='btn btn-g' onclick='sendXtream()'>Conectar Xtream en TV</button>"
            + "</div>"
            + "<div id='p-ctrl' class='card hide'>"
            + "<div style='display:flex;gap:8px'><input id='q' placeholder='Buscar canal, película o serie...'>"
            + "<button class='btn btn-p' style='border-radius:12px' onclick='sendSearch()'>Buscar</button></div>"
            + "<div class='dpad'>"
            + "<div></div><button onclick='nav(\"up\")'>▲</button><div></div>"
            + "<button onclick='nav(\"left\")'>◀</button><button class='ok' onclick='nav(\"ok\")'>OK</button><button onclick='nav(\"right\")'>▶</button>"
            + "<button onclick='nav(\"back\")' style='font-size:.85rem'>Atrás</button><button onclick='nav(\"down\")'>▼</button><button onclick='nav(\"home\")' style='font-size:.85rem'>Inicio</button>"
            + "</div>"
            + "<div class='row'>"
            + "<button class='btn btn-g' onclick='media(\"play_pause\")'>⏯ Play/Pausa</button>"
            + "<button class='btn btn-g' onclick='media(\"stop\")'>⏹ Stop</button>"
            + "<button class='btn btn-g' onclick='media(\"mute\")'>🔇 Mute</button>"
            + "</div>"
            + "<div class='row' style='grid-template-columns:1fr 1fr'>"
            + "<button class='btn btn-g' onclick='media(\"vol_down\")'>🔉 Vol -</button>"
            + "<button class='btn btn-g' onclick='media(\"vol_up\")'>🔊 Vol +</button>"
            + "</div></div>"
            + "<script>"
            + "function sw(id,el){document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));el.classList.add('on');"
            + "document.getElementById('p-list').classList.toggle('hide',id!=='list');document.getElementById('p-ctrl').classList.toggle('hide',id!=='ctrl');}"
            + "function show(t,ok){var m=document.getElementById('msg');m.textContent=t;m.className='msg '+(ok?'ok':'err');setTimeout(()=>m.className='msg',3500);}"
            + "async function cmd(payload){payload.token=document.getElementById('pin').value.trim();"
            + "try{var r=await fetch('/api/cmd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});"
            + "var j=await r.json();if(!r.ok||!j.ok){show(j.error||'Error de conexión',false);return false;}return true;}catch(e){show('Sin conexión con el TV',false);return false;}}"
            + "async function sendUrl(){var url=document.getElementById('m3u-url').value.trim();if(!url){show('Pega una URL primero',false);return;}"
            + "if(await cmd({type:'load_url',url:url,name:document.getElementById('m3u-name').value.trim()}))show('¡Lista enviada al TV!',true);}"
            + "async function sendXtream(){var s=document.getElementById('xt-srv').value.trim(),u=document.getElementById('xt-usr').value.trim(),p=document.getElementById('xt-pwd').value;"
            + "if(!s||!u||!p){show('Completa servidor, usuario y contraseña',false);return;}"
            + "if(await cmd({type:'load_xtream',server:s,username:u,password:p}))show('¡Datos enviados al TV!',true);}"
            + "function nav(a){cmd({type:'nav',action:a});}"
            + "function media(a){cmd({type:'media',action:a});}"
            + "async function sendSearch(){var q=document.getElementById('q').value.trim();if(!q)return;if(await cmd({type:'search',query:q}))show('Buscando en el TV...',true);}"
            + "</script></body></html>";
    }
}
