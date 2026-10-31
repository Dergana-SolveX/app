package expo.modules.svxsms

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
import android.telephony.CellIdentityGsm
import android.telephony.CellIdentityLte
import android.telephony.CellIdentityWcdma
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoWcdma
import android.telephony.SmsManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger

class SvxSmsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is unavailable")

  private var smsReceiver: BroadcastReceiver? = null
  private val requestCounter = AtomicInteger(1)

  companion object {
    private const val ACTION_SMS_SENT = "expo.modules.svxsms.SMS_SENT"
    private const val ACTION_SMS_DELIVERED = "expo.modules.svxsms.SMS_DELIVERED"
    private const val EVENT_SVX_ACK_RECEIVED = "onSvxAckReceived"
    private const val EVENT_SVX_DELIVERY_REPORT = "onSvxDeliveryReport"
  }

  override fun definition() = ModuleDefinition {
    Name("SvxSms")

    Events(EVENT_SVX_ACK_RECEIVED, EVENT_SVX_DELIVERY_REPORT)

    OnCreate {
      registerSmsReceiver()
    }

    OnDestroy {
      unregisterSmsReceiver()
    }

    AsyncFunction("isAvailableAsync") {
      val packageManager = context.packageManager
      packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    }

    AsyncFunction("requestPermissionsAsync") {
      val required = listOf(
        Manifest.permission.SEND_SMS,
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.ACCESS_FINE_LOCATION
      )

      val activity = appContext.currentActivity
      if (activity != null) {
        val missing = required.filter {
          ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
          androidx.core.app.ActivityCompat.requestPermissions(
            activity,
            missing.toTypedArray(),
            9001
          )
        }
      }

      val permissionsMap = mutableMapOf<String, Boolean>()
      var allGranted = true

      for (perm in required) {
        val granted = ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED
        permissionsMap[perm] = granted
        if (!granted) {
          allGranted = false
        }
      }

      mapOf(
        "granted" to allGranted,
        "permissions" to permissionsMap
      )
    }

    AsyncFunction("sendSms") { to: String, message: String, promise: Promise ->
      val hasSendPermission = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.SEND_SMS
      ) == PackageManager.PERMISSION_GRANTED

      if (!hasSendPermission) {
        promise.reject("PERMISSION_DENIED", "SEND_SMS permission is not granted", null)
        return@AsyncFunction
      }

      val reqId = requestCounter.getAndIncrement()
      val sentAction = "$ACTION_SMS_SENT.$reqId"
      val deliveredAction = "$ACTION_SMS_DELIVERED.$reqId"

      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
      } else {
        PendingIntent.FLAG_ONE_SHOT
      }

      val sentPendingIntent = PendingIntent.getBroadcast(
        context,
        reqId,
        Intent(sentAction),
        flags
      )

      val deliveredPendingIntent = PendingIntent.getBroadcast(
        context,
        reqId,
        Intent(deliveredAction),
        flags
      )

      var isSent = false
      var isDelivered = false
      var hasResolved = false

      val deliveryFilter = IntentFilter().apply {
        addAction(sentAction)
        addAction(deliveredAction)
      }

      var receiver: BroadcastReceiver? = null
      val watchdogHandler = Handler(Looper.getMainLooper())
      val watchdogRunnable = Runnable {
        receiver?.let {
          try {
            context.unregisterReceiver(it)
          } catch (_: Exception) {}
        }
      }

      receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) {
          when (intent?.action) {
            sentAction -> {
              if (resultCode == Activity.RESULT_OK) {
                isSent = true
              }
              if (resultCode != Activity.RESULT_OK && !hasResolved) {
                hasResolved = true
                watchdogHandler.removeCallbacks(watchdogRunnable)
                try {
                  context.unregisterReceiver(this)
                } catch (_: Exception) {}
                promise.reject("SMS_SEND_FAILED", "SmsManager send failed with resultCode $resultCode", null)
                return
              }
              if (!hasResolved) {
                hasResolved = true
                promise.resolve(
                  mapOf(
                    "sent" to true,
                    "delivered" to isDelivered,
                    "ref" to reqId
                  )
                )
              }
            }
            deliveredAction -> {
              if (resultCode == Activity.RESULT_OK) {
                isDelivered = true
                sendEvent(
                  EVENT_SVX_DELIVERY_REPORT,
                  mapOf(
                    "ref" to reqId,
                    "status" to "delivered"
                  )
                )
              }
              watchdogHandler.removeCallbacks(watchdogRunnable)
              try {
                context.unregisterReceiver(this)
              } catch (_: Exception) {}
            }
          }
        }
      }

      // System telephony broadcasts originate outside the app; API 33+ requires RECEIVER_EXPORTED
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(receiver, deliveryFilter, Context.RECEIVER_EXPORTED)
      } else {
        context.registerReceiver(receiver, deliveryFilter)
      }

      // Guarantee receiver cleanup after 45 seconds if no delivery report arrives
      watchdogHandler.postDelayed(watchdogRunnable, 45000)

      try {
        val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          context.getSystemService(SmsManager::class.java) ?: SmsManager.getDefault()
        } else {
          @Suppress("DEPRECATION")
          SmsManager.getDefault()
        }

        smsManager.sendTextMessage(to, null, message, sentPendingIntent, deliveredPendingIntent)
      } catch (e: Exception) {
        watchdogHandler.removeCallbacks(watchdogRunnable)
        try {
          context.unregisterReceiver(receiver)
        } catch (_: Exception) {}
        if (!hasResolved) {
          promise.reject("SMS_SEND_ERROR", e.message ?: "Failed to dispatch SMS", e)
        }
      }
    }

    AsyncFunction("getCellId") { promise: Promise ->
      val hasFineLoc = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_FINE_LOCATION
      ) == PackageManager.PERMISSION_GRANTED

      if (!hasFineLoc) {
        promise.resolve(null)
        return@AsyncFunction
      }

      val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
      if (tm == null) {
        promise.resolve(null)
        return@AsyncFunction
      }

      try {
        val cellInfoList = tm.allCellInfo
        if (cellInfoList == null || cellInfoList.isEmpty()) {
          promise.resolve(null)
          return@AsyncFunction
        }

        for (info in cellInfoList) {
          if (!info.isRegistered) continue

          when (info) {
            is CellInfoGsm -> {
              val id = info.cellIdentity
              val mcc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) id.mccString?.toIntOrNull() else id.mcc
              val mnc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) id.mncString?.toIntOrNull() else id.mnc
              val lac = id.lac
              val cid = id.cid
              if (mcc != null && mnc != null && lac != -1 && lac != Int.MAX_VALUE && cid != -1 && cid != Int.MAX_VALUE) {
                promise.resolve(
                  mapOf(
                    "mcc" to mcc,
                    "mnc" to mnc,
                    "lac" to lac,
                    "cid" to cid,
                    "formatted" to "$mcc,$mnc,$lac,$cid"
                  )
                )
                return@AsyncFunction
              }
            }
            is CellInfoLte -> {
              val id = info.cellIdentity
              val mcc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) id.mccString?.toIntOrNull() else id.mcc
              val mnc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) id.mncString?.toIntOrNull() else id.mnc
              val lac = id.tac
              val cid = id.ci
              if (mcc != null && mnc != null && lac != -1 && lac != Int.MAX_VALUE && cid != -1 && cid != Int.MAX_VALUE) {
                promise.resolve(
                  mapOf(
                    "mcc" to mcc,
                    "mnc" to mnc,
                    "lac" to lac,
                    "cid" to cid,
                    "formatted" to "$mcc,$mnc,$lac,$cid"
                  )
                )
                return@AsyncFunction
              }
            }
            is CellInfoWcdma -> {
              val id = info.cellIdentity
              val mcc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) id.mccString?.toIntOrNull() else id.mcc
              val mnc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) id.mncString?.toIntOrNull() else id.mnc
              val lac = id.lac
              val cid = id.cid
              if (mcc != null && mnc != null && lac != -1 && lac != Int.MAX_VALUE && cid != -1 && cid != Int.MAX_VALUE) {
                promise.resolve(
                  mapOf(
                    "mcc" to mcc,
                    "mnc" to mnc,
                    "lac" to lac,
                    "cid" to cid,
                    "formatted" to "$mcc,$mnc,$lac,$cid"
                  )
                )
                return@AsyncFunction
              }
            }
          }
        }
        promise.resolve(null)
      } catch (e: SecurityException) {
        promise.resolve(null)
      } catch (e: Exception) {
        promise.resolve(null)
      }
    }
  }

  private fun registerSmsReceiver() {
    if (smsReceiver != null) return

    smsReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        val fullBody = StringBuilder()
        var sender = ""

        for (sms in messages) {
          fullBody.append(sms.displayMessageBody)
          sender = sms.displayOriginatingAddress ?: sender
        }

        val text = fullBody.toString()
        val regex = Regex("SVXACK#([0-9A-Fa-f]{8})")
        val match = regex.find(text)

        if (match != null) {
          val ackRef = match.groupValues[1]
          sendEvent(
            EVENT_SVX_ACK_RECEIVED,
            mapOf(
              "sender" to sender,
              "body" to text,
              "ackRef" to ackRef
            )
          )
        }
      }
    }

    val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(smsReceiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      context.registerReceiver(smsReceiver, filter)
    }
  }

  private fun unregisterSmsReceiver() {
    smsReceiver?.let {
      try {
        context.unregisterReceiver(it)
      } catch (_: Exception) {}
      smsReceiver = null
    }
  }
}
