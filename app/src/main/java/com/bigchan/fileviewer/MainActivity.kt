package com.bigchan.fileviewer

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.res.ColorStateList
import android.util.Base64
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream

class MainActivity : Activity() {

    companion object {
        private const val HOST = "appassets.androidplatform.net"
        private const val BASE = "https://$HOST/"
        private const val REQ_PICK = 1001
        private const val REQ_SAVE = 1002
        private const val MAX_RECENT = 20
        private const val MAX_COPY_BYTES = 80L * 1024 * 1024
    }

    private lateinit var web: WebView
    private lateinit var titleView: TextView
    private lateinit var pageView: TextView
    private lateinit var homeBtn: ImageButton
    private lateinit var shareBtn: ImageButton
    private lateinit var editBtn: ImageButton
    private var pendingSave: ByteArray? = null

    /** 웹 쪽에서 /doc/<id> 로 요청하면 이 표에서 실제 파일 Uri를 찾아 넘겨줌 */
    private val docs = HashMap<String, Uri>()
    private var currentUri: Uri? = null
    private val prefs by lazy { getSharedPreferences("viewer", MODE_PRIVATE) }
    private val recentLock = Any()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        titleView = findViewById(R.id.title)
        pageView = findViewById(R.id.pageInfo)
        homeBtn = findViewById(R.id.btnHome)
        shareBtn = findViewById(R.id.btnShare)
        editBtn = findViewById(R.id.btnEdit)

        homeBtn.setOnClickListener { confirmLeave { goHome() } }
        findViewById<View>(R.id.btnOpen).setOnClickListener { confirmLeave { pickFile() } }
        editBtn.setOnClickListener { web.evaluateJavascript("window.toggleFill && toggleFill()", null) }
        shareBtn.setOnClickListener { shareCurrent() }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = false
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
        }
        web.webChromeClient = WebChromeClient() // 비밀번호 입력창(prompt) 등 표시용
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                intercept(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == HOST) return false
                // 문서 안의 링크는 브라우저로
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) {}
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "Android")

        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        confirmLeave {
            if (web.canGoBack()) web.goBack() else finish()
        }
    }

    /** 채우기 중 저장 안 한 내용이 있으면 한 번 물어봄 */
    private fun confirmLeave(action: () -> Unit) {
        web.evaluateJavascript("!!window.__dirty") { r ->
            if (r == "true") {
                AlertDialog.Builder(this)
                    .setMessage("작성한 내용을 저장하지 않았어요. 그냥 나갈까요?")
                    .setPositiveButton("나가기") { _, _ ->
                        web.evaluateJavascript("window.__dirty=false", null)
                        action()
                    }
                    .setNegativeButton("계속 작성", null)
                    .show()
            } else action()
        }
    }

    // ---------------------------------------------------------------- 열기

    @Suppress("DEPRECATION")
    private fun handleIntent(i: Intent?) {
        val uri: Uri? = when (i?.action) {
            Intent.ACTION_VIEW -> i.data
            Intent.ACTION_SEND -> i.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> null
        }
        if (uri != null) openDoc(uri) else goHome()
    }

    private fun goHome() {
        web.loadUrl(BASE + "assets/viewer.html")
    }

    private fun pickFile() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(i, REQ_PICK)
        } catch (e: Exception) {
            toast("파일 선택 창을 열 수 없어요")
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PICK && resultCode == RESULT_OK) {
            data?.data?.let { openDoc(it) }
        } else if (requestCode == REQ_SAVE) {
            val bytes = pendingSave
            pendingSave = null
            val uri = data?.data
            if (resultCode != RESULT_OK || uri == null || bytes == null) {
                web.evaluateJavascript("window.onSaved && onSaved(false)", null)
                return
            }
            try {
                contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) }
                    ?: throw IOException("no stream")
                web.evaluateJavascript("window.onSaved && onSaved(true)", null)
                toast("저장했어요")
                openDoc(uri)
            } catch (e: Exception) {
                web.evaluateJavascript("window.onSaved && onSaved(false)", null)
                toast("저장하지 못했어요")
            }
        }
    }

    private fun openDoc(uri: Uri, nameHint: String? = null, fromRecent: Boolean = false) {
        val name = nameHint ?: queryName(uri) ?: "문서"
        val id = java.lang.Long.toString(System.nanoTime(), 36)
        docs[id] = uri
        if (fromRecent) bumpRecent(uri.toString()) else rememberRecent(uri, name)
        web.loadUrl(BASE + "assets/viewer.html?doc=" + id + "&name=" + Uri.encode(name))
    }

    private fun queryName(uri: Uri): String? {
        val n = try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (_: Exception) { null }
        return n ?: uri.lastPathSegment?.substringAfterLast('/')
    }

    private fun shareCurrent() {
        val uri = currentUri ?: return
        val type = try { contentResolver.getType(uri) } catch (_: Exception) { null } ?: "application/octet-stream"
        val send = Intent(Intent.ACTION_SEND).apply {
            setType(type)
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try { startActivity(Intent.createChooser(send, "공유")) } catch (_: Exception) { toast("공유할 수 없어요") }
    }

    // ---------------------------------------------------------------- 내부 주소 처리

    private fun intercept(url: Uri): WebResourceResponse? {
        val scheme = url.scheme ?: return null
        if (scheme != "http" && scheme != "https") return null
        // 외부 인터넷 요청은 전부 막음 (광고·추적 없음)
        if (url.host != HOST) return status(403, "Forbidden")
        val path = url.path ?: return status(404, "Not Found")
        return when {
            path.startsWith("/assets/") -> {
                val name = path.removePrefix("/assets/")
                try { ok(mimeOf(name), assets.open(name)) } catch (_: IOException) { status(404, "Not Found") }
            }
            path.startsWith("/doc/") -> {
                val uri = docs[path.removePrefix("/doc/")] ?: return status(404, "Not Found")
                try {
                    val input = contentResolver.openInputStream(uri) ?: return status(404, "Not Found")
                    ok("application/octet-stream", input)
                } catch (_: Exception) { status(500, "Cannot Read") }
            }
            else -> status(404, "Not Found")
        }
    }

    private fun ok(mime: String, input: InputStream): WebResourceResponse {
        val enc = if (mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("javascript")) "utf-8" else null
        return WebResourceResponse(mime, enc, 200, "OK", mapOf("Cache-Control" to "no-cache"), input)
    }

    private fun status(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "wasm" -> "application/wasm"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "ttf" -> "font/ttf"
        "otf" -> "font/otf"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }

    // ---------------------------------------------------------------- 최근 파일

    private fun loadRecent(): JSONArray = synchronized(recentLock) {
        try { JSONArray(prefs.getString("recent", "[]")) } catch (_: Exception) { JSONArray() }
    }

    private fun saveRecent(a: JSONArray) = synchronized(recentLock) {
        prefs.edit().putString("recent", a.toString()).apply()
    }

    private fun isOwnFile(uri: Uri) = uri.authority == "$packageName.files"

    private fun rememberRecent(uri: Uri, name: String) {
        if (isOwnFile(uri)) { bumpRecent(uri.toString()); return }
        val persisted = try {
            contentResolver.takePersistableUriPermission(uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION); true
        } catch (_: Exception) {
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); true
            } catch (_: Exception) { false }
        }
        if (persisted) {
            putRecent(uri.toString(), name, false)
            return
        }
        // 카톡·파일앱에서 연 파일은 나중에 다시 열 권한이 없어서 앱 안에 사본을 저장
        Thread {
            val dir = File(filesDir, "recent").apply { mkdirs() }
            val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(80)
            val dest = File(dir, "${System.currentTimeMillis()}_$safe")
            try {
                var total = 0L
                contentResolver.openInputStream(uri)?.use { input ->
                    dest.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val r = input.read(buf)
                            if (r < 0) break
                            total += r
                            if (total > MAX_COPY_BYTES) throw IOException("too big")
                            out.write(buf, 0, r)
                        }
                    }
                } ?: return@Thread
                val key = FileProvider.getUriForFile(this, "$packageName.files", dest).toString()
                runOnUiThread { putRecent(key, name, true, dedupeByName = true) }
            } catch (_: Exception) {
                // 너무 크거나 읽기 실패: 최근 목록에만 안 남김
                dest.delete()
            }
        }.start()
    }

    private fun putRecent(key: String, name: String, copy: Boolean, dedupeByName: Boolean = false) {
        val old = loadRecent()
        val out = JSONArray()
        out.put(JSONObject().put("key", key).put("name", name).put("time", System.currentTimeMillis()).put("copy", copy))
        for (i in 0 until old.length()) {
            val o = old.getJSONObject(i)
            val same = o.optString("key") == key || (dedupeByName && o.optBoolean("copy") && o.optString("name") == name)
            if (same) { if (o.optString("key") != key) dropRecentStorage(o); continue }
            if (out.length() >= MAX_RECENT) { dropRecentStorage(o); continue }
            out.put(o)
        }
        saveRecent(out)
    }

    private fun bumpRecent(key: String) {
        val old = loadRecent()
        var hit: JSONObject? = null
        val rest = JSONArray()
        for (i in 0 until old.length()) {
            val o = old.getJSONObject(i)
            if (o.optString("key") == key) hit = o else rest.put(o)
        }
        if (hit == null) return
        hit.put("time", System.currentTimeMillis())
        val out = JSONArray().put(hit)
        for (i in 0 until rest.length()) out.put(rest.get(i))
        saveRecent(out)
    }

    private fun removeRecent(key: String) {
        val old = loadRecent()
        val out = JSONArray()
        for (i in 0 until old.length()) {
            val o = old.getJSONObject(i)
            if (o.optString("key") == key) dropRecentStorage(o) else out.put(o)
        }
        saveRecent(out)
    }

    private fun dropRecentStorage(o: JSONObject) {
        val uri = Uri.parse(o.optString("key"))
        if (o.optBoolean("copy")) {
            uri.lastPathSegment?.let { File(File(filesDir, "recent"), it).delete() }
        } else {
            try { contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    // ---------------------------------------------------------------- 웹 ↔ 앱 연결

    inner class Bridge {
        @JavascriptInterface
        fun setDoc(id: String, name: String) = runOnUiThread {
            pageView.text = ""
            editBtn.visibility = View.GONE
            editBtn.imageTintList = null
            if (id.isEmpty()) {
                currentUri = null
                titleView.text = getString(R.string.app_name)
                homeBtn.visibility = View.GONE
                shareBtn.visibility = View.GONE
            } else {
                currentUri = docs[id]
                titleView.text = name
                homeBtn.visibility = View.VISIBLE
                shareBtn.visibility = if (currentUri != null) View.VISIBLE else View.GONE
            }
        }

        @JavascriptInterface
        fun setFillable(yes: Boolean) = runOnUiThread {
            editBtn.visibility = if (yes) View.VISIBLE else View.GONE
        }

        @JavascriptInterface
        fun setFillMode(active: Boolean) = runOnUiThread {
            editBtn.imageTintList = if (active) ColorStateList.valueOf(0xFF2F6BFF.toInt()) else null
        }

        /** 원본에 덮어쓰기. 권한이 없거나 앱 안 사본이면 false → 웹 쪽에서 "다른 이름으로 저장" */
        @JavascriptInterface
        fun overwrite(base64: String): Boolean {
            val uri = currentUri ?: return false
            if (isOwnFile(uri)) return false
            return try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val out = contentResolver.openOutputStream(uri, "wt") ?: return false
                out.use { it.write(bytes) }
                true
            } catch (_: Exception) { false }
        }

        @JavascriptInterface
        fun saveFile(name: String, mime: String, base64: String) = runOnUiThread {
            try {
                pendingSave = Base64.decode(base64, Base64.DEFAULT)
                val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                @Suppress("DEPRECATION")
                startActivityForResult(i, REQ_SAVE)
            } catch (e: Exception) {
                pendingSave = null
                toast("저장 창을 열 수 없어요")
                web.evaluateJavascript("window.onSaved && onSaved(false)", null)
            }
        }

        @JavascriptInterface
        fun setPageInfo(text: String) = runOnUiThread { pageView.text = text }

        @JavascriptInterface
        fun pickFile() = runOnUiThread { this@MainActivity.pickFile() }

        @JavascriptInterface
        fun getRecent(): String = loadRecent().toString()

        @JavascriptInterface
        fun openRecent(key: String) = runOnUiThread {
            val uri = Uri.parse(key)
            val arr = loadRecent()
            var name: String? = null
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                if (o.optString("key") == key) name = o.optString("name")
            }
            val readable = try { contentResolver.openInputStream(uri)?.close(); true } catch (_: Exception) { false }
            if (!readable) {
                toast("파일이 지워졌거나 옮겨져서 열 수 없어요")
                removeRecent(key)
                web.evaluateJavascript("window.refreshRecent && refreshRecent()", null)
            } else {
                openDoc(uri, name, fromRecent = true)
            }
        }

        @JavascriptInterface
        fun removeRecent(key: String) = this@MainActivity.removeRecent(key)
    }
}
