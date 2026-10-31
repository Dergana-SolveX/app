import { useLocale } from "@/contexts/locale-context";
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import {
  countdownReducer,
  createCrashCountdownState,
  createPhoneTriggerFilter,
  createWitnessFlowState,
  flowReducer,
  buildWitnessSvxString,
  type DangerType,
  WITNESS_TEXT,
  getLabels,
} from "@solvex-dergana/shared";
import { trpc } from "@/utils/trpc";
import { CrashCountdownOverlay } from "@/components/crash-countdown-overlay";
import {
  addSvxAckListener,
  getCellIdAsync,
  requestPermissionsAsync,
  sendSmsAsync,
  type SvxCellId,
} from "@/modules/svx-sms";
import { type Href, router } from "expo-router";

const ALGIERS_COMMUNES = [
  { name: "Bab Ezzouar", arabic: "باب الزوار", lat: 36.7255, lng: 3.1836 },
  { name: "Alger-Centre", arabic: "الجزائر الوسطى", lat: 36.77, lng: 3.06 },
  { name: "El Harrach", arabic: "الحراش", lat: 36.7197, lng: 3.1347 },
  { name: "Rouiba", arabic: "الرويبة", lat: 36.7381, lng: 3.28 },
  { name: "Bab El Oued", arabic: "باب الوادي", lat: 36.7897, lng: 3.0514 },
  { name: "Hussein Dey", arabic: "حسين داي", lat: 36.7411, lng: 3.1019 },
  { name: "Aïn Taya", arabic: "عين طاية", lat: 36.7928, lng: 3.2886 },
  { name: "Baraki", arabic: "براقي", lat: 36.6667, lng: 3.1 },
  { name: "Beni Messous", arabic: "بني مسوس", lat: 36.79, lng: 2.998 },
  { name: "Zéralda", arabic: "زرالدة", lat: 36.7117, lng: 2.8394 },
];

function getNearestCommune(lat: number, lng: number, isArabic: boolean): string {
  let best = ALGIERS_COMMUNES[0];
  let minD = Infinity;
  for (const c of ALGIERS_COMMUNES) {
    const d = Math.hypot(c.lat - lat, c.lng - lng);
    if (d < minD) {
      minD = d;
      best = c;
    }
  }
  return isArabic ? `${best.arabic}، الجزائر` : `${best.name}, Alger`;
}

type Props = {
  onBack?: () => void;
};

export function WitnessReport({ onBack }: Props = {}) {
  const { locale, setLocale } = useLocale();
  const [state, dispatch] = useReducer(
    flowReducer,
    undefined,
    () => flowReducer(createWitnessFlowState(), { type: "SET_LANG", lang: locale }),
  );

  const [crashState, crashDispatch] = useReducer(
    countdownReducer,
    undefined,
    createCrashCountdownState,
  );
  const filterRef = useRef(createPhoneTriggerFilter());

  const t = {
    ...WITNESS_TEXT[state.lang],
    ...getLabels(state.lang, "victim"),
    ...getLabels(state.lang, "witness"),
  };
  const isRtl = state.lang === "ar";

  const [detectedPlace, setDetectedPlace] = useState<string | null>(null);

  // Mutations
  const submitMutation = useMutation(
    trpc.alerts.submitOnline.mutationOptions({
      onSuccess: (res) => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        dispatch({ type: "SUBMISSION_SUCCESS", result: res });
      },
      onError: () => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
        dispatch({
          type: "SUBMISSION_ERROR",
          error: t.transmissionError || "Erreur de transmission",
        });
      },
    }),
  );

  const [forcedSms, setForcedSms] = useState(false);
  const [smsMode, setSmsMode] = useState<"native" | "emulated">(
    Platform.OS === "web" ? "emulated" : "native",
  );
  const [smsAck, setSmsAck] = useState<string | null>(null);
  const [cellId, setCellId] = useState<SvxCellId | null>(null);
  const [isSendingNativeSms, setIsSendingNativeSms] = useState(false);

  // Poll serving cell ID on Android
  useEffect(() => {
    let isMounted = true;
    async function loadCell() {
      try {
        const cell = await getCellIdAsync();
        if (isMounted && cell) {
          setCellId(cell);
        }
      } catch {}
    }
    loadCell();
    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for incoming SVXACK broadcasts
  useEffect(() => {
    const sub = addSvxAckListener((event) => {
      if (event.ackRef) {
        setSmsAck(`SVXACK#${event.ackRef}`);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      }
    });
    return () => {
      sub.remove();
    };
  }, []);

  const submitSmsMutation = useMutation(
    trpc.alerts.submitSms.mutationOptions({
      onSuccess: (res) => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        if (res.kind === "alert") {
          setSmsAck(res.ack);
          dispatch({
            type: "SUBMISSION_SUCCESS",
            result: {
              alertId: `sms-${res.incidentId}`,
              incidentId: res.incidentId,
              duplicate: res.duplicate,
              merged: res.merged,
            },
          });
        } else {
          dispatch({
            type: "SUBMISSION_ERROR",
            error: t.smsFormat || "Format SMS non reconnu",
          });
        }
      },
      onError: () => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
        dispatch({
          type: "SUBMISSION_ERROR",
          error: t.transmissionError || "Erreur de transmission",
        });
      },
    }),
  );

  const isSubmitting = submitMutation.isPending || submitSmsMutation.isPending || isSendingNativeSms;

  // Real-time SVX payload builder
  const svxResult = useMemo(() => {
    return buildWitnessSvxString({
      victims: state.victims ?? 1,
      conscious: state.conscious,
      fire: state.dangers.includes("fire"),
      trapped: state.dangers.includes("trapped"),
      bleeding: state.dangers.includes("bleeding"),
      lat: state.coords?.lat ?? null,
      lng: state.coords?.lng ?? null,
    });
  }, [state.victims, state.conscious, state.dangers, state.coords]);

  // Accelerometer subscription
  useEffect(() => {
    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener((data) => {
      const g = Math.hypot(data.x, data.y, data.z);
      const now = Date.now();
      filterRef.current.pushAccel(now, g);
      const res = filterRef.current.evaluate(now);
      if (res.triggered) {
        crashDispatch({
          type: "TRIGGER_CRASH",
          payload: {
            peakG: res.peakG,
            speedBeforeKmh: res.speedBeforeKmh,
            simulated: false,
            timestamp: now,
          },
        });
      }
    });

    return () => {
      sub.remove();
    };
  }, []);

  // Crash countdown tick
  useEffect(() => {
    if (crashState.status !== "countdown") return;
    const interval = setInterval(() => {
      crashDispatch({ type: "TICK" });
    }, 1000);
    return () => clearInterval(interval);
  }, [crashState.status]);

  // GPS 20s tick
  useEffect(() => {
    if (state.gpsStatus === "acquired" || state.gpsStatus === "timeout" || state.gpsStatus === "denied") {
      return;
    }
    const timer = setInterval(() => {
      dispatch({ type: "TICK_GPS_TIMER" });
    }, 1000);
    return () => clearInterval(timer);
  }, [state.gpsStatus]);

  // GPS Acquisition & Speed tracking & Geocoding
  useEffect(() => {
    let isMounted = true;
    let posSub: Location.LocationSubscription | null = null;

    async function startGps() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (isMounted) dispatch({ type: "GPS_FAILED", status: "denied" });
          return;
        }

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        if (isMounted) {
          dispatch({
            type: "GPS_ACQUIRED",
            coords: {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              accuracyM: loc.coords.accuracy ?? 10,
            },
          });

          // Reverse geocode to get city / place name
          try {
            const addrs = await Location.reverseGeocodeAsync({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
            if (isMounted && addrs && addrs.length > 0) {
              const a = addrs[0];
              const parts = [a.name, a.street, a.city || a.district || a.subregion].filter(Boolean);
              if (parts.length > 0) {
                setDetectedPlace(parts.join(", "));
                return;
              }
            }
          } catch {}

          if (isMounted) {
            setDetectedPlace(getNearestCommune(loc.coords.latitude, loc.coords.longitude, isRtl));
          }
        }

        // Speed tracking
        posSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 1,
          },
          (position) => {
            if (!isMounted) return;
            const speedKmh =
              position.coords.speed && position.coords.speed > 0
                ? position.coords.speed * 3.6
                : 0;
            const now = Date.now();
            filterRef.current.pushSpeed(now, speedKmh);
            const res = filterRef.current.evaluate(now);
            if (res.triggered) {
              crashDispatch({
                type: "TRIGGER_CRASH",
                payload: {
                  peakG: res.peakG,
                  speedBeforeKmh: res.speedBeforeKmh,
                  simulated: false,
                  timestamp: now,
                },
              });
            }
          },
        );
      } catch {
        if (isMounted) dispatch({ type: "GPS_FAILED", status: "denied" });
      }
    }

    startGps();

    return () => {
      isMounted = false;
      if (posSub) posSub.remove();
    };
  }, [isRtl]);

  const triggerHaptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  };

  const handleVictims = (count: number) => {
    triggerHaptic();
    dispatch({ type: "SELECT_VICTIMS", count });
  };

  const handleConscious = (value: 0 | 1 | 2) => {
    triggerHaptic();
    dispatch({ type: "SELECT_CONSCIOUS", value });
  };

  const handleDanger = (danger: DangerType) => {
    triggerHaptic();
    dispatch({ type: "TOGGLE_DANGER", danger });
  };

  const handleGoBack = () => {
    triggerHaptic();
    if (state.step === 1) {
      if (onBack) {
        onBack();
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.push("/" as Href);
      }
    } else {
      dispatch({ type: "GO_BACK" });
    }
  };

  const [commune, setCommune] = useState("");
  const [pkMarker, setPkMarker] = useState("");

  const dispatchNativeSms = async () => {
    try {
      setIsSendingNativeSms(true);
      const permGranted = await requestPermissionsAsync();
      if (!permGranted) {
        Alert.alert(t.sms_permission_title, t.sms_permission_desc);
        dispatch({
          type: "SUBMISSION_ERROR",
          error: t.sms_permission_desc,
        });
        return;
      }

      const res = await sendSmsAsync("+213550000000", svxResult.svx);

      if (res.sent) {
        dispatch({
          type: "SUBMISSION_SUCCESS",
          result: {
            alertId: `gsm-${Date.now()}`,
            incidentId: `gsm-inc-${Date.now()}`,
            duplicate: false,
            merged: false,
          },
        });
      } else {
        dispatch({
          type: "SUBMISSION_ERROR",
          error: res.error || "Échec de l'envoi SMS",
        });
      }
    } catch (e: any) {
      dispatch({
        type: "SUBMISSION_ERROR",
        error: e.message || "Erreur de transmission GSM",
      });
    } finally {
      setIsSendingNativeSms(false);
    }
  };

  const handleSubmit = () => {
    triggerHaptic();
    if (
      (state.gpsStatus === "timeout" || state.gpsStatus === "denied") &&
      !state.manualCommune.trim() &&
      !state.manualPkMarker.trim()
    ) {
      dispatch({ type: "PROCEED_SUBMIT" });
      return;
    }

    dispatch({ type: "SUBMISSION_START" });
    if (forcedSms) {
      if (smsMode === "native") {
        dispatchNativeSms();
      } else {
        submitSmsMutation.mutate({
          from: "+213550000000",
          body: svxResult.svx,
          emulated: true,
        });
      }
    } else {
      const payload = state.toSubmissionPayload();
      submitMutation.mutate(payload);
    }
  };

  const handleManualLocationSubmit = () => {
    if (!commune.trim() && !pkMarker.trim()) {
      Alert.alert(t.required || "Champ requis", t.locationRequired || "Veuillez renseigner un lieu.");
      return;
    }

    triggerHaptic();
    dispatch({ type: "SET_MANUAL_LOCATION", commune, pkMarker });

    dispatch({ type: "SUBMISSION_START" });
    if (forcedSms) {
      if (smsMode === "native") {
        dispatchNativeSms();
      } else {
        submitSmsMutation.mutate({
          from: "+213550000000",
          body: svxResult.svx,
          emulated: true,
        });
      }
    } else {
      const payload = {
        ...state.toSubmissionPayload(),
        commune: commune.trim() || null,
        pkMarker: pkMarker.trim() || null,
      };
      submitMutation.mutate(payload);
    }
  };

  const handleReset = () => {
    triggerHaptic();
    setCommune("");
    setPkMarker("");
    setSmsAck(null);
    dispatch({ type: "RESET" });
    dispatch({ type: "SET_LANG", lang: state.lang });
  };

  const toggleLanguage = () => {
    const nextLang = state.lang === "fr" ? "ar" : "fr";
    setLocale(nextLang);
    dispatch({ type: "SET_LANG", lang: nextLang });
  };

  return (
    <View
      testID="witness-report-container"
      style={{ flex: 1, backgroundColor: "#ffffff" }}
    >
      <CrashCountdownOverlay
        state={crashState}
        locale={state.lang}
        onCancel={() => crashDispatch({ type: "CANCEL" })}
        onReset={() => crashDispatch({ type: "RESET" })}
      />

      {/* Top Header Bar */}
      <View
        style={{
          flexDirection: isRtl ? "row-reverse" : "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottomWidth: 1,
          borderBottomColor: "#f1f5f9",
          backgroundColor: "#ffffff",
          paddingHorizontal: 20,
          paddingVertical: 14,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRtl ? "الرجوع" : "Retour"}
          onPress={handleGoBack}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#f1f5f9",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={isRtl ? "arrow-forward" : "arrow-back"}
            size={20}
            color="#0f172a"
          />
        </Pressable>

        <View
          style={{
            flexDirection: isRtl ? "row-reverse" : "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#dc2626" }} />
          <Text style={{ fontSize: 16, fontWeight: "900", color: "#0f172a", letterSpacing: -0.3 }}>
            {t.title}
          </Text>
        </View>

        {/* Single Language Button: shows opposite language */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.lang === "fr" ? "التحويل إلى العربية" : "Passer en français"}
          onPress={toggleLanguage}
          style={{
            borderRadius: 9999,
            borderWidth: 1,
            borderColor: "#cbd5e1",
            backgroundColor: "#f8fafc",
            paddingHorizontal: 14,
            paddingVertical: 6,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "800", color: "#0f172a" }}>
            {state.lang === "fr" ? "عربي" : "FR"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: "#ffffff" }}
        contentContainerStyle={{ flexGrow: 1, padding: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Confirmed Localisation Card */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#e2e8f0",
            backgroundColor: "#f8fafc",
            padding: 14,
            marginBottom: 20,
          }}
        >
          <View
            style={{
              flexDirection: isRtl ? "row-reverse" : "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: "#dcfce7",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="location"
                size={18}
                color={state.gpsStatus === "denied" ? "#dc2626" : "#16a34a"}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  color: "#64748b",
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.detected_location}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "800",
                  color: "#0f172a",
                  marginTop: 2,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
                numberOfLines={1}
              >
                {detectedPlace
                  ? detectedPlace
                  : state.gpsStatus === "acquired" && state.coords
                    ? getNearestCommune(state.coords.lat, state.coords.lng, isRtl)
                    : state.gpsStatus === "denied"
                      ? isRtl
                        ? "GPS غير متاح — يرجى تحديد المكان يدوياً"
                        : "GPS désactivé — lieu à confirmer"
                      : isRtl
                        ? "جاري تحديد موقعكم الدقيق..."
                        : "Localisation automatique en cours..."}
              </Text>
            </View>
            {state.gpsStatus === "acquired" && (
              <View
                style={{
                  borderRadius: 9999,
                  backgroundColor: "#f0fdf4",
                  borderWidth: 1,
                  borderColor: "#bbf7d0",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: "800", color: "#15803d" }}>
                  {t.location_confirmed}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Step Progress Dots */}
        {typeof state.step === "number" && (
          <View style={{ marginBottom: 20 }}>
            <View
              style={{
                flexDirection: isRtl ? "row-reverse" : "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                }}
              >
                {t.step} {state.step} {t.of} 3
              </Text>
              <Text style={{ fontSize: 12, fontWeight: "800", color: "#dc2626" }}>
                {state.step === 1
                  ? t.victims
                  : state.step === 2
                    ? t.consciousness
                    : t.dangers}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8, height: 6 }}>
              <View
                style={{
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor: state.step >= 1 ? "#dc2626" : "#e2e8f0",
                }}
              />
              <View
                style={{
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor: state.step >= 2 ? "#dc2626" : "#e2e8f0",
                }}
              />
              <View
                style={{
                  flex: 1,
                  borderRadius: 3,
                  backgroundColor: state.step >= 3 ? "#dc2626" : "#e2e8f0",
                }}
              />
            </View>
          </View>
        )}

        {/* STEP 1: VICTIMS */}
        {state.step === 1 && (
          <View style={{ flex: 1, justifyContent: "space-between" }}>
            <View>
              {/* Bigger Title */}
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "900",
                  color: "#0f172a",
                  letterSpacing: -0.4,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.step1_title}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  marginTop: 4,
                  marginBottom: 20,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.step1_subtitle}
              </Text>

              {/* Line 1: Numbers 1, 2, 3 (Bigger!) */}
              <View
                style={{
                  flexDirection: isRtl ? "row-reverse" : "row",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                {[1, 2, 3].map((num) => {
                  const label =
                    num === 1
                      ? t.victims_1
                      : num === 2
                        ? t.victims_2
                        : t.victims_3plus;
                  const isSelected = state.victims === num;
                  return (
                    <Pressable
                      key={num}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      onPress={() => handleVictims(num)}
                      style={{
                        flex: 1,
                        minHeight: 96,
                        paddingVertical: 14,
                        borderRadius: 16,
                        borderWidth: 2,
                        borderColor: isSelected ? "#dc2626" : "#e2e8f0",
                        backgroundColor: isSelected ? "#dc2626" : "#ffffff",
                        alignItems: "center",
                        justifyContent: "center",
                        shadowColor: "#000000",
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.05,
                        shadowRadius: 4,
                        elevation: 2,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 36,
                          fontWeight: "900",
                          color: isSelected ? "#ffffff" : "#0f172a",
                        }}
                      >
                        {num}
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          marginTop: 2,
                          textAlign: "center",
                          color: isSelected ? "#fee2e2" : "#64748b",
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Line 2: Numbers 4, 5, 6+ */}
              <View
                style={{
                  flexDirection: isRtl ? "row-reverse" : "row",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                {[
                  { num: 4, label: t.victims_4 },
                  { num: 5, label: t.victims_5 },
                  { num: 6, label: t.victims_6plus },
                ].map(({ num, label }) => {
                  const isSelected = state.victims === num;
                  return (
                    <Pressable
                      key={num}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      onPress={() => handleVictims(num)}
                      style={{
                        flex: 1,
                        minHeight: 96,
                        paddingVertical: 14,
                        borderRadius: 16,
                        borderWidth: 2,
                        borderColor: isSelected ? "#dc2626" : "#e2e8f0",
                        backgroundColor: isSelected ? "#dc2626" : "#ffffff",
                        alignItems: "center",
                        justifyContent: "center",
                        shadowColor: "#000000",
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.05,
                        shadowRadius: 4,
                        elevation: 2,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 36,
                          fontWeight: "900",
                          color: isSelected ? "#ffffff" : "#0f172a",
                        }}
                      >
                        {num === 6 ? "6+" : num}
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          marginTop: 2,
                          textAlign: "center",
                          color: isSelected ? "#fee2e2" : "#64748b",
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Line 3: Two buttons down of truck and bus with their icons */}
              <View
                style={{
                  flexDirection: isRtl ? "row-reverse" : "row",
                  gap: 12,
                  marginBottom: 24,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.vehicle_truck} — ${t.vehicle_truck_sub}`}
                  onPress={() => handleVictims(2)}
                  style={{
                    flex: 1,
                    minHeight: 76,
                    padding: 12,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: "#e2e8f0",
                    backgroundColor: "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    gap: 10,
                    shadowColor: "#000000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: "#fef2f2",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <MaterialCommunityIcons name="truck" size={26} color="#dc2626" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "900",
                        color: "#0f172a",
                        textAlign: isRtl ? "right" : "left",
                      }}
                    >
                      {t.vehicle_truck}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        color: "#64748b",
                        marginTop: 2,
                        textAlign: isRtl ? "right" : "left",
                      }}
                    >
                      {t.vehicle_truck_sub}
                    </Text>
                  </View>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.vehicle_bus} — ${t.vehicle_bus_sub}`}
                  onPress={() => handleVictims(6)}
                  style={{
                    flex: 1,
                    minHeight: 76,
                    padding: 12,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: "#e2e8f0",
                    backgroundColor: "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    gap: 10,
                    shadowColor: "#000000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: "#fef2f2",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <MaterialCommunityIcons name="bus" size={26} color="#dc2626" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "900",
                        color: "#0f172a",
                        textAlign: isRtl ? "right" : "left",
                      }}
                    >
                      {t.vehicle_bus}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        color: "#64748b",
                        marginTop: 2,
                        textAlign: isRtl ? "right" : "left",
                      }}
                    >
                      {t.vehicle_bus_sub}
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>

            {/* Bottom Retour Button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isRtl ? "العودة للرئيسية" : "Retour à l'accueil"}
              onPress={handleGoBack}
              style={{
                width: "100%",
                minHeight: 48,
                paddingVertical: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#e2e8f0",
                backgroundColor: "#f8fafc",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 16,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#475569" }}>
                {isRtl ? "← العودة إلى الرئيسية" : "← Retour à l'accueil"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* STEP 2: CONSCIOUSNESS WITH PEOPLE ICONS */}
        {state.step === 2 && (
          <View style={{ flex: 1, justifyContent: "space-between" }}>
            <View>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "900",
                  color: "#0f172a",
                  letterSpacing: -0.4,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.step2_title}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  marginTop: 4,
                  marginBottom: 20,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.step2_subtitle}
              </Text>

              <View style={{ gap: 14 }}>
                {/* Inconscient (Urgent / Red) */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.conscious_no} — ${t.conscious_sub_no}`}
                  onPress={() => handleConscious(0)}
                  style={{
                    minHeight: 88,
                    padding: 16,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: state.conscious === 0 ? "#dc2626" : "#e2e8f0",
                    backgroundColor: state.conscious === 0 ? "#dc2626" : "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    shadowColor: "#000000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: 14,
                      flex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 14,
                        backgroundColor: state.conscious === 0 ? "#b91c1c" : "#fef2f2",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <MaterialCommunityIcons
                        name="account-alert"
                        size={30}
                        color={state.conscious === 0 ? "#ffffff" : "#dc2626"}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 18,
                          fontWeight: "900",
                          color: state.conscious === 0 ? "#ffffff" : "#0f172a",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.conscious_no}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          marginTop: 2,
                          color: state.conscious === 0 ? "#fee2e2" : "#64748b",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.conscious_sub_no}
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name={
                      state.conscious === 0
                        ? "checkmark-circle"
                        : isRtl
                          ? "chevron-back"
                          : "chevron-forward"
                    }
                    size={24}
                    color={state.conscious === 0 ? "#ffffff" : "#94a3b8"}
                  />
                </Pressable>

                {/* Conscient (Green) */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.conscious_yes} — ${t.conscious_sub_yes}`}
                  onPress={() => handleConscious(1)}
                  style={{
                    minHeight: 88,
                    padding: 16,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: state.conscious === 1 ? "#16a34a" : "#e2e8f0",
                    backgroundColor: state.conscious === 1 ? "#16a34a" : "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    shadowColor: "#000000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: 14,
                      flex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 14,
                        backgroundColor: state.conscious === 1 ? "#15803d" : "#f0fdf4",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <MaterialCommunityIcons
                        name="account-check"
                        size={30}
                        color={state.conscious === 1 ? "#ffffff" : "#16a34a"}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 18,
                          fontWeight: "900",
                          color: state.conscious === 1 ? "#ffffff" : "#0f172a",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.conscious_yes}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          marginTop: 2,
                          color: state.conscious === 1 ? "#dcfce7" : "#64748b",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.conscious_sub_yes}
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name={
                      state.conscious === 1
                        ? "checkmark-circle"
                        : isRtl
                          ? "chevron-back"
                          : "chevron-forward"
                    }
                    size={24}
                    color={state.conscious === 1 ? "#ffffff" : "#94a3b8"}
                  />
                </Pressable>

                {/* Inconnu / Pas sûr (Amber) */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.conscious_unknown} — ${t.conscious_sub_unknown}`}
                  onPress={() => handleConscious(2)}
                  style={{
                    minHeight: 88,
                    padding: 16,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: state.conscious === 2 ? "#d97706" : "#e2e8f0",
                    backgroundColor: state.conscious === 2 ? "#d97706" : "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    shadowColor: "#000000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: 14,
                      flex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 14,
                        backgroundColor: state.conscious === 2 ? "#b45309" : "#fffbeb",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <MaterialCommunityIcons
                        name="account-question"
                        size={30}
                        color={state.conscious === 2 ? "#ffffff" : "#d97706"}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 18,
                          fontWeight: "900",
                          color: state.conscious === 2 ? "#ffffff" : "#0f172a",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.conscious_unknown}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          marginTop: 2,
                          color: state.conscious === 2 ? "#fef3c7" : "#64748b",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.conscious_sub_unknown}
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name={
                      state.conscious === 2
                        ? "checkmark-circle"
                        : isRtl
                          ? "chevron-back"
                          : "chevron-forward"
                    }
                    size={24}
                    color={state.conscious === 2 ? "#ffffff" : "#94a3b8"}
                  />
                </Pressable>
              </View>
            </View>

            {/* Bottom Retour Button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.back}
              onPress={handleGoBack}
              style={{
                width: "100%",
                minHeight: 48,
                paddingVertical: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#e2e8f0",
                backgroundColor: "#f8fafc",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 20,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#475569" }}>
                {isRtl ? "← رجوع إلى الخطوة السابقة" : "← Retour à l'étape précédente"}
              </Text>
            </Pressable>
          </View>
        )}

        {/* STEP 3: DANGERS (EACH ONE IN A LINE) */}
        {state.step === 3 && (
          <View style={{ flex: 1, justifyContent: "space-between" }}>
            <View>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "900",
                  color: "#0f172a",
                  letterSpacing: -0.4,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.step3_title}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  marginTop: 4,
                  marginBottom: 20,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.step3_subtitle}
              </Text>

              {/* Dangers: each one in a line (full-width horizontal card) */}
              <View style={{ gap: 12, marginBottom: 20 }}>
                {/* 1. Fire / Smoke */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.danger_fire} — ${t.danger_fire_sub}`}
                  onPress={() => handleDanger("fire")}
                  style={{
                    width: "100%",
                    padding: 14,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: state.dangers.includes("fire") ? "#dc2626" : "#e2e8f0",
                    backgroundColor: state.dangers.includes("fire") ? "#fef2f2" : "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: 12,
                      flex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: "#ffedd5",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="flame" size={24} color="#ea580c" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: "800",
                          color: "#0f172a",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.danger_fire}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "500",
                          color: "#64748b",
                          marginTop: 2,
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.danger_fire_sub}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: state.dangers.includes("fire") ? "#dc2626" : "#cbd5e1",
                      backgroundColor: state.dangers.includes("fire") ? "#dc2626" : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {state.dangers.includes("fire") && (
                      <Ionicons name="checkmark" size={16} color="#ffffff" />
                    )}
                  </View>
                </Pressable>

                {/* 2. Trapped Person */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.danger_trapped} — ${t.danger_trapped_sub}`}
                  onPress={() => handleDanger("trapped")}
                  style={{
                    width: "100%",
                    padding: 14,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: state.dangers.includes("trapped") ? "#d97706" : "#e2e8f0",
                    backgroundColor: state.dangers.includes("trapped") ? "#fffbeb" : "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: 12,
                      flex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: "#fef3c7",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="warning" size={24} color="#d97706" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: "800",
                          color: "#0f172a",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.danger_trapped}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "500",
                          color: "#64748b",
                          marginTop: 2,
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.danger_trapped_sub}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: state.dangers.includes("trapped") ? "#d97706" : "#cbd5e1",
                      backgroundColor: state.dangers.includes("trapped") ? "#d97706" : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {state.dangers.includes("trapped") && (
                      <Ionicons name="checkmark" size={16} color="#ffffff" />
                    )}
                  </View>
                </Pressable>

                {/* 3. Severe Bleeding */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.danger_bleeding} — ${t.danger_bleeding_sub}`}
                  onPress={() => handleDanger("bleeding")}
                  style={{
                    width: "100%",
                    padding: 14,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: state.dangers.includes("bleeding") ? "#dc2626" : "#e2e8f0",
                    backgroundColor: state.dangers.includes("bleeding") ? "#fef2f2" : "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: 12,
                      flex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: "#ffe4e6",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="water" size={24} color="#e11d48" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: "800",
                          color: "#0f172a",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.danger_bleeding}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "500",
                          color: "#64748b",
                          marginTop: 2,
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.danger_bleeding_sub}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: state.dangers.includes("bleeding") ? "#dc2626" : "#cbd5e1",
                      backgroundColor: state.dangers.includes("bleeding") ? "#dc2626" : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {state.dangers.includes("bleeding") && (
                      <Ionicons name="checkmark" size={16} color="#ffffff" />
                    )}
                  </View>
                </Pressable>

                {/* 4. No Apparent Danger */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.danger_none} — ${t.danger_none_sub}`}
                  onPress={() => handleDanger("none")}
                  style={{
                    width: "100%",
                    padding: 14,
                    borderRadius: 16,
                    borderWidth: 2,
                    borderColor: state.dangers.includes("none") ? "#16a34a" : "#e2e8f0",
                    backgroundColor: state.dangers.includes("none") ? "#f0fdf4" : "#ffffff",
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: 12,
                      flex: 1,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: "#dcfce7",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="shield-checkmark" size={24} color="#16a34a" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: "800",
                          color: "#0f172a",
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.danger_none}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "500",
                          color: "#64748b",
                          marginTop: 2,
                          textAlign: isRtl ? "right" : "left",
                        }}
                      >
                        {t.danger_none_sub}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: state.dangers.includes("none") ? "#16a34a" : "#cbd5e1",
                      backgroundColor: state.dangers.includes("none") ? "#16a34a" : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {state.dangers.includes("none") && (
                      <Ionicons name="checkmark" size={16} color="#ffffff" />
                    )}
                  </View>
                </Pressable>
              </View>

              {/* Clean SMS Fallback Toggle (No bits/crypto data!) */}
              <View
                style={{
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#e2e8f0",
                  backgroundColor: "#f8fafc",
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  testID="force-sms-toggle"
                  onPress={() => setForcedSms((prev) => !prev)}
                  style={{
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={18}
                      color={forcedSms ? "#dc2626" : "#64748b"}
                    />
                    <Text style={{ fontSize: 13, fontWeight: "700", color: "#0f172a" }}>
                      {t.forced_sms_title || "Canal SMS d'urgence"}
                    </Text>
                  </View>
                  <View
                    style={{
                      borderRadius: 9999,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      backgroundColor: forcedSms ? "#dc2626" : "#e2e8f0",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "800",
                        color: forcedSms ? "#ffffff" : "#475569",
                      }}
                    >
                      {forcedSms
                        ? t.forced_sms_active || "Actif"
                        : t.forced_sms_off || "Inactif"}
                    </Text>
                  </View>
                </Pressable>
              </View>

              {/* Main Submit Button */}
              <Pressable
                accessibilityRole="button"
                onPress={handleSubmit}
                disabled={isSubmitting}
                style={{
                  width: "100%",
                  minHeight: 56,
                  paddingVertical: 14,
                  borderRadius: 16,
                  backgroundColor: isSubmitting ? "#94a3b8" : "#dc2626",
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: "#dc2626",
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.35,
                  shadowRadius: 16,
                  elevation: 10,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="notifications" size={20} color="#ffffff" />
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "900",
                      color: "#ffffff",
                      letterSpacing: 0.5,
                    }}
                  >
                    {isSubmitting ? t.submitting : t.submit_button}
                  </Text>
                </View>
              </Pressable>

              {/* Bottom Retour Button */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.back}
                onPress={handleGoBack}
                style={{
                  width: "100%",
                  minHeight: 48,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#e2e8f0",
                  backgroundColor: "#f8fafc",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 12,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#475569" }}>
                  {isRtl ? "← رجوع إلى الخطوة السابقة" : "← Retour à l'étape précédente"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* MANUAL LOCATION FALLBACK PROMPT */}
        {state.step === "location_prompt" && (
          <View style={{ flex: 1, justifyContent: "space-between" }}>
            <View>
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "900",
                  color: "#0f172a",
                  letterSpacing: -0.4,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.gps_timeout_prompt}
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  marginTop: 4,
                  marginBottom: 20,
                  writingDirection: isRtl ? "rtl" : "ltr",
                  textAlign: isRtl ? "right" : "left",
                }}
              >
                {t.gps_timeout_helper}
              </Text>

              <View style={{ gap: 16 }}>
                <View>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: "#334155",
                      marginBottom: 6,
                      textAlign: isRtl ? "right" : "left",
                    }}
                  >
                    {t.commune_label}
                  </Text>
                  <TextInput
                    accessibilityLabel={t.commune_label}
                    value={commune}
                    onChangeText={setCommune}
                    placeholder={t.commune_placeholder}
                    placeholderTextColor="#94a3b8"
                    style={{
                      width: "100%",
                      minHeight: 52,
                      backgroundColor: "#f8fafc",
                      borderWidth: 1,
                      borderColor: "#cbd5e1",
                      borderRadius: 12,
                      paddingHorizontal: 16,
                      fontSize: 15,
                      color: "#0f172a",
                      textAlign: isRtl ? "right" : "left",
                    }}
                  />
                </View>

                <View>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "700",
                      color: "#334155",
                      marginBottom: 6,
                      textAlign: isRtl ? "right" : "left",
                    }}
                  >
                    {t.pk_label}
                  </Text>
                  <TextInput
                    accessibilityLabel={t.pk_label}
                    value={pkMarker}
                    onChangeText={setPkMarker}
                    placeholder={t.pk_placeholder}
                    placeholderTextColor="#94a3b8"
                    style={{
                      width: "100%",
                      minHeight: 52,
                      backgroundColor: "#f8fafc",
                      borderWidth: 1,
                      borderColor: "#cbd5e1",
                      borderRadius: 12,
                      paddingHorizontal: 16,
                      fontSize: 15,
                      color: "#0f172a",
                      textAlign: isRtl ? "right" : "left",
                    }}
                  />
                </View>
              </View>
            </View>

            <View style={{ marginTop: 28 }}>
              <Pressable
                accessibilityRole="button"
                onPress={handleManualLocationSubmit}
                disabled={isSubmitting}
                style={{
                  width: "100%",
                  minHeight: 52,
                  paddingVertical: 14,
                  borderRadius: 16,
                  backgroundColor: isSubmitting ? "#94a3b8" : "#dc2626",
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: "#dc2626",
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                  elevation: 8,
                }}
              >
                <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 16 }}>
                  {isSubmitting ? t.submitting : t.confirm_location_button}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.back}
                onPress={handleGoBack}
                style={{
                  width: "100%",
                  minHeight: 48,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#e2e8f0",
                  backgroundColor: "#f8fafc",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 12,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#475569" }}>
                  {isRtl ? "← رجوع" : "← Retour"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* SUBMITTING STATE */}
        {state.step === "submitting" && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: "#fee2e2",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="sync" size={32} color="#dc2626" />
            </View>
            <Text style={{ fontSize: 20, fontWeight: "900", color: "#0f172a", marginBottom: 8, textAlign: "center" }}>
              {t.submitting}
            </Text>
            <Text style={{ fontSize: 13, color: "#64748b", textAlign: "center" }}>
              {isRtl
                ? "يتم نقل الإحداثيات وتفاصيل البلاغ لغرفة العمليات..."
                : "Transmission des coordonnées et détails aux secours..."}
            </Text>
          </View>
        )}

        {/* ERROR STATE */}
        {state.step === "error" && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 32 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: "#fee2e2",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="alert-circle" size={36} color="#dc2626" />
            </View>
            <Text style={{ fontSize: 22, fontWeight: "900", color: "#0f172a", marginBottom: 8, textAlign: "center" }}>
              {t.error_title}
            </Text>
            <Text style={{ fontSize: 13, color: "#64748b", marginBottom: 24, textAlign: "center" }}>
              {state.error || (isRtl ? "فشل الإرسال" : "Échec de transmission")}
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={handleSubmit}
              style={{
                width: "100%",
                minHeight: 52,
                paddingVertical: 14,
                backgroundColor: "#dc2626",
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 15 }}>
                {t.retry_button}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={handleReset}
              style={{
                width: "100%",
                minHeight: 48,
                paddingVertical: 12,
                backgroundColor: "#f1f5f9",
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#334155", fontWeight: "700", fontSize: 14 }}>
                {t.new_report}
              </Text>
            </Pressable>
          </View>
        )}

        {/* SUBMITTED / SUCCESS STATE */}
        {state.step === "submitted" && (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 24 }}>
            <View
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: "#dcfce7",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Ionicons name="checkmark-circle" size={48} color="#16a34a" />
            </View>
            <Text style={{ fontSize: 22, fontWeight: "900", color: "#0f172a", marginBottom: 8, textAlign: "center" }}>
              {t.success_title}
            </Text>
            <Text style={{ fontSize: 13, color: "#64748b", marginBottom: 24, textAlign: "center", lineHeight: 20, maxWidth: 300 }}>
              {t.success_desc}
            </Text>

            <View
              style={{
                width: "100%",
                backgroundColor: "#f8fafc",
                borderWidth: 1,
                borderColor: "#e2e8f0",
                borderRadius: 16,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>
                {t.success_incident_id}
              </Text>
              <Text style={{ writingDirection: "ltr", textAlign: "left", color: "#15803d", fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontWeight: "900", fontSize: 20 }}>
                #{state.submissionResult?.incidentId.slice(0, 8).toUpperCase() || "DEMO-999"}
              </Text>
            </View>

            {smsAck && (
              <View
                style={{
                  width: "100%",
                  backgroundColor: "#eff6ff",
                  borderWidth: 1,
                  borderColor: "#bfdbfe",
                  borderRadius: 16,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#1e3a8a", marginBottom: 4 }}>
                  {t.sms_ack_title || "Accusé de réception SMS"}
                </Text>
                <Text style={{ writingDirection: "ltr", textAlign: "left", color: "#172554", fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontWeight: "700", fontSize: 14 }}>
                  {smsAck}
                </Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={handleReset}
              style={{
                width: "100%",
                minHeight: 52,
                paddingVertical: 14,
                backgroundColor: "#dc2626",
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
                shadowColor: "#dc2626",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25,
                shadowRadius: 8,
                elevation: 4,
              }}
            >
              <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 15 }}>
                {t.new_report}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={handleGoBack}
              style={{
                width: "100%",
                minHeight: 48,
                paddingVertical: 12,
                backgroundColor: "#f1f5f9",
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#334155", fontWeight: "700", fontSize: 14 }}>
                {isRtl ? "العودة إلى شاشة SOS" : "Retour à l'écran SOS"}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
