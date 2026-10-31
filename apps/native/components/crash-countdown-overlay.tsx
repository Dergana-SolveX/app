import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, ScrollView, Text, Vibration, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getLabels, type Locale, type CrashCountdownState } from "@solvex-dergana/shared";

interface CrashCountdownOverlayProps {
  state: CrashCountdownState;
  locale?: Locale;
  onCancel: () => void;
  onReset: () => void;
}

export function CrashCountdownOverlay({
  state,
  locale = "fr",
  onCancel,
  onReset,
}: CrashCountdownOverlayProps) {
  const t = getLabels(locale, "crash");
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
    <View style={[styles.overlay, { direction: locale === "ar" ? "rtl" : "ltr" }]} testID="crash-countdown-overlay">
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

      <ScrollView contentContainerStyle={styles.container}>
        {isCountdown && (
          <>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>
                {t.detected}
              </Text>
            </View>

            <Animated.View
              style={[
                styles.timerCircle,
                {
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            >
              <Text style={styles.timerNumber}>{state.secondsRemaining}</Text>
              <Text style={styles.timerUnit}>{t.seconds}</Text>
            </Animated.View>

            <Text style={styles.helperText}>
              {t.helper}{" "}
              <Text style={styles.boldWhite}>{state.secondsRemaining} {locale === "ar" ? "ث" : "s"}</Text>.
            </Text>

            {/* Giant Cancel Button (PRD FR-S4-01: JE VAIS BIEN — ANNULER) */}
            <Pressable
              testID="cancel-crash-button"
              accessibilityLabel={t.cancelLabel}
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.cancelButtonPressed,
              ]}
            >
              <Ionicons name="hand-left" size={32} color="#B91C1C" style={styles.cancelButtonIcon} />
              <Text style={styles.cancelButtonMainText}>
                {t.cancel}
              </Text>
            </Pressable>

            {state.simulated && (
              <View style={styles.simulatedTag}>
                <Text style={styles.simulatedTagText}>{t.simulated}</Text>
              </View>
            )}
          </>
        )}

        {isCancelled && (
          <View style={styles.resultCard}>
            <Ionicons name="checkmark-circle" size={54} color="#4ADE80" style={styles.resultIcon} />
            <Text style={styles.resultTitle}>{t.cancelled}</Text>
            <Text style={styles.resultDescription}>{t.cancelledHelp}</Text>
            <Pressable
              accessibilityRole="button"
              testID="close-cancelled-button"
              onPress={onReset}
              style={styles.returnButton}
            >
              <Text style={styles.returnButtonText}>{t.home}</Text>
            </Pressable>
          </View>
        )}

        {(isSending || isExpired) && (
          <View style={styles.resultCard}>
            <Ionicons name="cellular" size={54} color="#60A5FA" style={styles.resultIcon} />
            <Text style={styles.resultTitle}>{t.sending}</Text>
            <Text style={styles.resultDescription}>{t.sendingHelp}</Text>
          </View>
        )}

        {state.status === "error" && (
          <View style={styles.resultCard} accessibilityLiveRegion="assertive">
            <Text style={styles.resultTitle}>{t.error}</Text>
            <Text style={styles.resultDescription}>{t.errorHelp}</Text>
            <Pressable accessibilityRole="button" onPress={onReset} style={styles.returnButton}>
              <Text style={styles.returnButtonText}>{t.home}</Text>
            </Pressable>
          </View>
        )}

        {isSent && (
          <View style={styles.resultCard}>
            <Ionicons name="megaphone" size={54} color="#2DD4BF" style={styles.resultIcon} />
            <Text style={styles.resultTitle}>{t.sent}</Text>
            <Text style={styles.resultDescription}>{t.sentHelp}</Text>
            <Pressable
              accessibilityRole="button"
              testID="close-sent-button"
              onPress={onReset}
              style={styles.returnButton}
            >
              <Text style={styles.returnButtonText}>{t.done}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
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
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  headerBadge: {
    backgroundColor: "#B91C1C",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FEE2E2",
    marginBottom: 8,
  },
  headerBadgeText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  arabicHeader: {
    color: "#FEE2E2",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 28,
    textAlign: "center",
  },
  timerCircle: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "#991B1B",
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
    fontWeight: "700",
    lineHeight: 76,
  },
  timerUnit: {
    color: "#FEE2E2",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  helperText: {
    color: "#FEE2E2",
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
    borderColor: "#FEE2E2",
  },
  cancelButtonPressed: {
    backgroundColor: "#EFF5F3",
    transform: [{ scale: 0.98 }],
  },
  cancelButtonIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  cancelButtonMainText: {
    color: "#B91C1C",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  cancelButtonSubText: {
    color: "#B91C1C",
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
    color: "#FEE2E2",
    fontSize: 11,
    fontWeight: "600",
  },
  resultCard: {
    backgroundColor: "rgba(11, 37, 34, 0.96)",
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
    fontWeight: "700",
    marginBottom: 6,
    textAlign: "center",
  },
  resultArabic: {
    color: "#A7C2BB",
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
  },
  resultDescription: {
    color: "#EAF5F2",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  returnButton: {
    backgroundColor: "#1D4ED8",
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
