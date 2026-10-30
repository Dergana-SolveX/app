import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { type CrashCountdownState } from "@solvex-dergana/shared";

interface CrashCountdownOverlayProps {
  state: CrashCountdownState;
  onCancel: () => void;
  onReset: () => void;
}

export function CrashCountdownOverlay({
  state,
  onCancel,
  onReset,
}: CrashCountdownOverlayProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation and vibration loop during active countdown
  useEffect(() => {
    if (state.status === "countdown") {
      // Vibrate pattern: vibrate 600ms, pause 300ms, repeat
      Vibration.vibrate([0, 600, 300, 600], true);

      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();

      return () => {
        Vibration.cancel();
        pulse.stop();
      };
    } else {
      Vibration.cancel();
      pulseAnim.setValue(1);
    }
  }, [state.status, pulseAnim]);

  if (state.status === "idle") {
    return null;
  }

  const isCountdown = state.status === "countdown";
  const isCancelled = state.status === "cancelled";
  const isSending = state.status === "sending";
  const isSent = state.status === "sent";
  const isExpired = state.status === "expired";

  return (
    <View style={styles.overlay} testID="crash-countdown-overlay">
      {/* Background warning tint */}
      <View
        style={[
          styles.backdrop,
          isCancelled
            ? styles.backdropCancelled
            : isSent
              ? styles.backdropSent
              : styles.backdropAlert,
        ]}
      />

      <View style={styles.container}>
        {isCountdown && (
          <>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>
                ⚠️ IMPACT DÉTECTÉ · ALERTE AUTOMATIQUE
              </Text>
            </View>

            <Text style={styles.arabicHeader}>
              تم رصد اصطدام قوي · سيتم إرسال الإنذار
            </Text>

            <Animated.View
              style={[
                styles.timerCircle,
                {
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            >
              <Text style={styles.timerNumber}>{state.secondsRemaining}</Text>
              <Text style={styles.timerUnit}>SECONDES</Text>
            </Animated.View>

            <Text style={styles.helperText}>
              Une alerte géolocalisée sera transmise aux secours dans{" "}
              <Text style={styles.boldWhite}>{state.secondsRemaining} s</Text>.
            </Text>

            {/* Giant Cancel Button (PRD FR-S4-01: JE VAIS BIEN — ANNULER) */}
            <Pressable
              testID="cancel-crash-button"
              accessibilityLabel="Annuler l'alerte"
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.cancelButtonPressed,
              ]}
            >
              <Text style={styles.cancelButtonIcon}>✋</Text>
              <Text style={styles.cancelButtonMainText}>
                JE VAIS BIEN — ANNULER
              </Text>
              <Text style={styles.cancelButtonSubText}>أنا بخير — إلغاء</Text>
            </Pressable>

            {state.simulated && (
              <View style={styles.simulatedTag}>
                <Text style={styles.simulatedTagText}>TEST SIMULÉ (DÉMO)</Text>
              </View>
            )}
          </>
        )}

        {isCancelled && (
          <View style={styles.resultCard}>
            <Text style={styles.resultIcon}>✅</Text>
            <Text style={styles.resultTitle}>ALERTE ANNULÉE</Text>
            <Text style={styles.resultArabic}>تم إلغاء الإنذار بنجاح</Text>
            <Text style={styles.resultDescription}>
              Vous avez indiqué aller bien. Aucun appel ni message d&apos;urgence
              n&apos;a été envoyé. L&apos;événement a été consigné dans le journal
              local.
            </Text>
            <Pressable
              testID="close-cancelled-button"
              onPress={onReset}
              style={styles.returnButton}
            >
              <Text style={styles.returnButtonText}>Retour à l&apos;accueil</Text>
            </Pressable>
          </View>
        )}

        {(isSending || isExpired) && (
          <View style={styles.resultCard}>
            <Text style={styles.resultIcon}>📡</Text>
            <Text style={styles.resultTitle}>ENVOI DE L&apos;ALERTE...</Text>
            <Text style={styles.resultArabic}>جارٍ إرسال نداء الاستغاثة...</Text>
            <Text style={styles.resultDescription}>
              Transmission prioritaire des coordonnées GPS et du profil médical
              aux centres de secours 14 / 154.
            </Text>
          </View>
        )}

        {isSent && (
          <View style={styles.resultCard}>
            <Text style={styles.resultIcon}>🚨</Text>
            <Text style={styles.resultTitle}>SECOURS ALERTÉS</Text>
            <Text style={styles.resultArabic}>تم إخطار الحماية المدنية</Text>
            <Text style={styles.resultDescription}>
              Dossier d&apos;urgence créé auprès de la Protection Civile. Restez
              calme et en sécurité si possible.
            </Text>
            <Pressable
              testID="close-sent-button"
              onPress={onReset}
              style={styles.returnButton}
            >
              <Text style={styles.returnButtonText}>Terminer</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  backdropAlert: {
    backgroundColor: "rgba(127, 29, 29, 0.96)", // deep emergency red
  },
  backdropCancelled: {
    backgroundColor: "rgba(15, 23, 42, 0.96)", // slate 900
  },
  backdropSent: {
    backgroundColor: "rgba(19, 78, 74, 0.96)", // dark teal
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  headerBadge: {
    backgroundColor: "#ef4444",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#fca5a5",
    marginBottom: 8,
  },
  headerBadgeText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  arabicHeader: {
    color: "#fecaca",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 28,
    textAlign: "center",
  },
  timerCircle: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "#b91c1c",
    borderWidth: 4,
    borderColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
    marginBottom: 24,
  },
  timerNumber: {
    color: "#ffffff",
    fontSize: 72,
    fontWeight: "900",
    lineHeight: 76,
  },
  timerUnit: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  helperText: {
    color: "#fecaca",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 32,
    maxWidth: 320,
  },
  boldWhite: {
    color: "#ffffff",
    fontWeight: "700",
  },
  cancelButton: {
    backgroundColor: "#ffffff",
    width: "100%",
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    borderWidth: 2,
    borderColor: "#fca5a5",
  },
  cancelButtonPressed: {
    backgroundColor: "#f1f5f9",
    transform: [{ scale: 0.98 }],
  },
  cancelButtonIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  cancelButtonMainText: {
    color: "#991b1b",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  cancelButtonSubText: {
    color: "#dc2626",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
  },
  simulatedTag: {
    marginTop: 20,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  simulatedTagText: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "600",
  },
  resultCard: {
    backgroundColor: "rgba(30, 41, 59, 0.95)",
    padding: 32,
    borderRadius: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    width: "100%",
  },
  resultIcon: {
    fontSize: 54,
    marginBottom: 16,
  },
  resultTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 6,
    textAlign: "center",
  },
  resultArabic: {
    color: "#94a3b8",
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
  },
  resultDescription: {
    color: "#cbd5e1",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  returnButton: {
    backgroundColor: "#3b82f6",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  returnButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});
