package com.securedoc.share

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillContext
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import org.json.JSONArray
import java.io.File

class KryptoAutofillService : AutofillService() {

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback
    ) {
        try {
            val contexts: List<FillContext> = request.fillContexts
            val structure: AssistStructure = contexts[contexts.size - 1].structure
            val parsedFields = mutableListOf<ParsedAutofillNode>()
            val numNodes = structure.windowNodeCount
            for (i in 0 until numNodes) {
                val windowNode = structure.getWindowNodeAt(i)
                traverseViewNode(windowNode.rootViewNode, parsedFields)
            }

            val usernameIds = parsedFields.filter { it.kind == "username" }.map { it.id }
            val passwordIds = parsedFields.filter { it.kind == "password" }.map { it.id }

            if (usernameIds.isEmpty() && passwordIds.isEmpty()) {
                callback.onSuccess(null)
                return
            }

            val cacheFile = File(filesDir, "krypto_autofill_cache.json")
            if (!cacheFile.exists()) {
                callback.onSuccess(null)
                return
            }
            val raw = cacheFile.readText(Charsets.UTF_8)
            val arr = JSONArray(raw)
            if (arr.length() == 0) {
                callback.onSuccess(null)
                return
            }

            val responseBuilder = FillResponse.Builder()
            var addedCount = 0

            for (idx in 0 until arr.length()) {
                val obj = arr.optJSONObject(idx) ?: continue
                val title = obj.optString("title", "Tài khoản Krypto")
                val user = obj.optString("username", "")
                val pass = obj.optString("password", "")
                if (user.isBlank() && pass.isBlank()) continue

                val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1)
                presentation.setTextViewText(
                    android.R.id.text1,
                    "🔑 $title (${if (user.isNotEmpty()) user else "•••"})"
                )

                val datasetBuilder = Dataset.Builder(presentation)
                var hasField = false
                for (uid in usernameIds) {
                    if (user.isNotEmpty()) {
                        datasetBuilder.setValue(uid, AutofillValue.forText(user), presentation)
                        hasField = true
                    }
                }
                for (pid in passwordIds) {
                    if (pass.isNotEmpty()) {
                        datasetBuilder.setValue(pid, AutofillValue.forText(pass), presentation)
                        hasField = true
                    }
                }

                if (hasField) {
                    responseBuilder.addDataset(datasetBuilder.build())
                    addedCount++
                }
            }

            if (addedCount > 0) {
                callback.onSuccess(responseBuilder.build())
            } else {
                callback.onSuccess(null)
            }
        } catch (_: Throwable) {
            callback.onSuccess(null)
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        callback.onSuccess()
    }

    private data class ParsedAutofillNode(val id: AutofillId, val kind: String)

    private fun traverseViewNode(
        node: AssistStructure.ViewNode?,
        out: MutableList<ParsedAutofillNode>
    ) {
        if (node == null) return
        val afId = node.autofillId
        if (afId != null) {
            val hints = node.autofillHints?.joinToString(" ")?.lowercase() ?: ""
            val idEntry = (node.idEntry ?: "").lowercase()
            val hintText = (node.hint ?: "").toString().lowercase()
            val inputType = node.inputType

            val isPass = hints.contains("password") ||
                    idEntry.contains("pass") ||
                    idEntry.contains("pwd") ||
                    hintText.contains("mật khẩu") ||
                    hintText.contains("password") ||
                    ((inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0) ||
                    ((inputType and android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD) != 0) ||
                    ((inputType and android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) != 0)

            val isUser = !isPass && (
                    hints.contains("username") ||
                    hints.contains("email") ||
                    hints.contains("phone") ||
                    hints.contains("creditcard") ||
                    idEntry.contains("user") ||
                    idEntry.contains("email") ||
                    idEntry.contains("login") ||
                    idEntry.contains("account") ||
                    idEntry.contains("phone") ||
                    idEntry.contains("card") ||
                    hintText.contains("tài khoản") ||
                    hintText.contains("email") ||
                    hintText.contains("số điện thoại") ||
                    hintText.contains("username")
                    )

            if (isPass) {
                out.add(ParsedAutofillNode(afId, "password"))
            } else if (isUser) {
                out.add(ParsedAutofillNode(afId, "username"))
            }
        }

        val childCount = node.childCount
        for (i in 0 until childCount) {
            traverseViewNode(node.getChildAt(i), out)
        }
    }
}
