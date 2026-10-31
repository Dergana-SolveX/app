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
import { useThemeColor } from "heroui-native";
import {
  addSvxAckListener,
  getCellIdAsync,
  requestPermissionsAsync,
  sendSmsAsync,
  type SvxCellId,
} from "@/modules/svx-sms";

export function WitnessReport() {
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

  const t = { ...WITNESS_TEXT[state.lang], ...getLabels(state.lang, "victim") };
  const [cSuccess, cWarning, cDanger, cMuted, cAccent] = useThemeColor(["success", "warning", "danger", "muted", "accent"]);
  const isRtl = state.lang === "ar";

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
          error: t.transmissionError,
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
            error: t.smsFormat,
          });
        }
      },
      onError: () => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
        dispatch({
          type: "SUBMISSION_ERROR",
          error: t.transmissionError,
        });
      },
    }),
  );

  const isSubmitting = submitMutation.isPending || submitSmsMutation.isPending || isSendingNativeSms;

  const svxResult = useMemo(() => {
    return buildWitnessSvxString({
      victims: state.victims ?? 1,
      conscious: state.conscious,
      fire: state.dangers.includes("fire"),
      trapped: state.dangers.includes("trapped"),
      bleeding: state.dangers.includes("bleeding"),
      lat: state.coords?.lat ?? null,
      lng: state.coords?.lng ?? null,
      cell: cellId,
    });
  }, [state.victims, state.conscious, state.dangers, state.coords, cellId]);

  // Accelerometer at ~50 Hz (20ms interval) feeding phone_trigger filter (FR-S4-01)
  useEffect(() => {
    Accelerometer.setUpdateInterval(20);
    const sub = Accelerometer.addListener(({ x, y, z }: { x: number; y: number; z: number }) => {
      const g = Math.sqrt(x * x + y * y + z * z);
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

  // 1-second countdown interval
  useEffect(() => {
    if (crashState.status !== "countdown") return;
    const interval = setInterval(() => {
      crashDispatch({ type: "TICK" });
    }, 1000);
    return () => clearInterval(interval);
  }, [crashState.status]);

  // Handle countdown expiration -> submit automatic crash alert
  useEffect(() => {
    if (crashState.status === "expired") {
      crashDispatch({ type: "SENDING_ALERT" });
      submitMutation.mutate(
        {
          idempotencyKey: `auto-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          source: "app_auto",
          victims: 1,
          conscious: null,
          fire: false,
          trapped: false,
          bleeding: false,
          lat: state.coords?.lat ?? null,
          lng: state.coords?.lng ?? null,
          accuracyM: state.coords?.accuracyM ?? null,
          commune: null,
          pkMarker: null,
        },
        {
          onSuccess: (res) => {
            crashDispatch({
              type: "ALERT_SENT",
              payload: {
                alertId: res.alertId,
                incidentId: res.incidentId,
                timestamp: Date.now(),
              },
            });
          },
          onError: () => {
            crashDispatch({
              type: "ALERT_ERROR",
              payload: { error: t.transmissionError },
            });
          },
        },
      );
    }
  }, [crashState.status]);

  // GPS Acquisition & Speed tracking
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
        }

        // Speed tracking feeding phone_trigger
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
        if (isMounted) {
          dispatch({ type: "GPS_FAILED", status: "timeout" });
        }
      }
    }

    startGps();
    return () => {
      isMounted = false;
      posSub?.remove();
    };
  }, []);

  // 20-second GPS Timer
  useEffect(() => {
    if (state.gpsStatus === "acquired" || state.gpsStatus === "timeout" || state.gpsStatus === "denied") {
      return;
    }

    const interval = setInterval(() => {
      dispatch({ type: "TICK_GPS_TIMER" });
    }, 1000);

    return () => clearInterval(interval);
  }, [state.gpsStatus]);

  // Manual location state
  const [commune, setCommune] = useState("");
  const [pkMarker, setPkMarker] = useState("");

  const triggerHaptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  };

  const handleVictims = (count: 1 | 2 | 3) => {
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

  const dispatchNativeSms = async () => {
    setIsSendingNativeSms(true);
    try {
      const perm = await requestPermissionsAsync();
      if (!perm.granted && Platform.OS === "android") {
        Alert.alert(t.sms_permission_title, t.sms_permission_desc);
        dispatch({
          type: "SUBMISSION_ERROR",
          error: "Permission SMS non accordée",
        });
        return;
      }

      const res = await sendSmsAsync("+213550000000", svxResult.svx);
      if (res.sent) {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        dispatch({
          type: "SUBMISSION_SUCCESS",
          result: {
            alertId: `sms-native-${Date.now()}`,
            incidentId: `gsm-${Date.now().toString(36).toUpperCase()}`,
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
      Alert.alert(t.required, t.locationRequired);
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

  return (
    <View testID="witness-report-container" style={{ flex: 1, direction: isRtl ? "rtl" : "ltr" }}>
      <CrashCountdownOverlay
        state={crashState}
        locale={state.lang}
        onCancel={() => crashDispatch({ type: "CANCEL" })}
        onReset={() => crashDispatch({ type: "RESET" })}
      />

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 16 }}
        className="bg-background"
      >
        {/* Top Banner with Language Toggle & Hidden Simulation Trigger */}
        <View
          className={`flex-wrap gap-3 items-center justify-between mb-4 pb-3 border-b border-border ${
            "flex-row"
          }`}
        >
          <View
            className={`items-center gap-2 ${
              "flex-row"
            }`}
          >
            <View className="size-8 rounded-lg bg-danger-solid items-center justify-center">
              <Ionicons name="warning" size={18} color="#ffffff" />
            </View>
            <View>
              <Text
                style={{ writingDirection: isRtl ? "rtl" : "ltr" }}
                className="text-foreground font-bold text-sm"
              >
                {t.title}
              </Text>
              <Text className="text-danger text-xs font-bold">
                <Text style={{ writingDirection: "ltr" }}>14 / 154</Text> {t.emergency}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            {/* Hidden 'simuler un choc' button (FR-S4-01 / Issue #21) */}
            <Pressable
                accessibilityRole="button"
              testID="simulate-impact-button"
              accessibilityLabel={t.simulate}
              onPress={() => {
                const res = filterRef.current.triggerSimulated(Date.now());
                crashDispatch({
                  type: "TRIGGER_CRASH",
                  payload: {
                    peakG: res.peakG,
                    speedBeforeKmh: res.speedBeforeKmh,
                    simulated: true,
                    timestamp: Date.now(),
                  },
                });
              }}
              style={{ opacity: 0.25 }}
              className="bg-surface border border-border rounded px-2 py-1 active:opacity-100"
            >
              <Text className="text-xs text-muted font-medium">
                {t.simulate}
              </Text>
            </Pressable>

            <View className="flex-row bg-surface-secondary rounded-full p-0.5 border border-separator">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: state.lang === "fr" }}
                onPress={() => { setLocale("fr"); dispatch({ type: "SET_LANG", lang: "fr" }); }}
                className={`px-3 py-1 rounded-full ${
                  state.lang === "fr" ? "bg-danger-solid" : "bg-transparent"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    state.lang === "fr" ? "text-foreground" : "text-muted"
                  }`}
                >
                  FR
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: state.lang === "ar" }}
                onPress={() => { setLocale("ar"); dispatch({ type: "SET_LANG", lang: "ar" }); }}
                className={`px-3 py-1 rounded-full ${
                  state.lang === "ar" ? "bg-danger-solid" : "bg-transparent"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    state.lang === "ar" ? "text-foreground" : "text-muted"
                  }`}
                >
                  عربي
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

      {/* GPS Status Indicator */}
      <View className="mb-4 bg-surface border border-border rounded-xl px-3 py-2 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          {state.gpsStatus === "acquired" ? (
            <>
              <Ionicons name="locate" size={16} color={cSuccess} />
              <Text className="text-success text-xs font-medium">
                {t.gps_acquired} ({state.coords?.lat.toFixed(4)},{" "}
                {state.coords?.lng.toFixed(4)})
              </Text>
            </>
          ) : state.gpsStatus === "timeout" || state.gpsStatus === "denied" ? (
            <>
              <Ionicons name="alert-circle" size={16} color={cWarning} />
              <Text className="text-warning text-xs font-medium">
                {t.gps_timeout}
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="time-outline" size={16} color={cAccent} />
              <Text className="text-info text-xs font-medium">
                {t.gps_searching} ({20 - state.gpsSecondsElapsed}{t.seconds})
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Forced SMS Toggle, Mode Selector & Preview (FR-S4-05, FR-S4-06) */}
      <View className="mb-3">
        <Pressable
                accessibilityRole="button"
          testID="force-sms-toggle"
          onPress={() => setForcedSms((prev) => !prev)}
          className={`p-2.5 rounded-xl border flex-row items-center justify-between ${
            forcedSms
              ? "bg-info-soft border-info/40"
              : "bg-surface border-border"
          }`}
        >
          <View className="flex-row items-center gap-2">
            <Ionicons
              name="chatbox-ellipses"
              size={16}
              color={forcedSms ? cAccent : cMuted}
            />
            <Text
              className={`text-xs font-bold ${
                forcedSms ? "text-info" : "text-muted"
              }`}
            >
              {t.forceSms}
            </Text>
          </View>
          <Text
            className={`text-xs font-bold px-2 py-0.5 rounded ${
              forcedSms
                ? "bg-info-solid text-solid-foreground"
                : "bg-surface-secondary text-muted"
            }`}
          >
            {forcedSms ? t.active : t.off}
          </Text>
        </Pressable>

        {forcedSms && (
          <View
            testID="raw-sms-preview"
            className="mt-2 p-3 bg-info-soft border border-info/80 rounded-xl"
          >
            {/* SMS Mode Selector: GSM Réel vs GSM Émulé */}
            <View className="flex-row gap-2 mb-3">
              <Pressable
                testID="sms-mode-native"
                onPress={() => setSmsMode("native")}
                className={`flex-1 py-1.5 px-2 rounded-lg border items-center justify-center ${
                  smsMode === "native"
                    ? "bg-info-solid border-info"
                    : "bg-surface border-border"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    smsMode === "native" ? "text-foreground" : "text-muted"
                  }`}
                >
                  {t.sms_mode_native}
                </Text>
              </Pressable>
              <Pressable
                testID="sms-mode-emulated"
                onPress={() => setSmsMode("emulated")}
                className={`flex-1 py-1.5 px-2 rounded-lg border items-center justify-center ${
                  smsMode === "emulated"
                    ? "bg-info-solid border-info"
                    : "bg-surface border-border"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    smsMode === "emulated" ? "text-foreground" : "text-muted"
                  }`}
                >
                  {t.sms_mode_emulated}
                </Text>
              </Pressable>
            </View>

            {/* Serving Cell-ID Badge (FR-S4-05) */}
            {cellId && (
              <View className="flex-row items-center gap-1.5 bg-surface/90 border border-info/40 px-2.5 py-1.5 rounded-lg mb-2">
                <Ionicons name="radio" size={14} color={cAccent} />
                <Text className="text-xs text-info font-medium">
                  {t.cell_id_label}{" "}
                  <Text className="font-mono font-bold">
                    {cellId.formatted ?? `${cellId.mcc}-${cellId.mnc}-${cellId.lac}-${cellId.cid}`}
                  </Text>
                </Text>
              </View>
            )}

            <View className="flex-row justify-between items-center mb-1.5">
              <Text className="text-xs font-bold text-info">
                {t.rawSms}
              </Text>
              <Text
                testID="sms-char-counter"
                className="font-mono text-xs text-foreground"
              >
                {svxResult.charCount} / 160 {t.chars}
              </Text>
            </View>
            <Text style={{ writingDirection: "ltr", textAlign: "left" }} className="font-mono text-xs text-foreground bg-surface/90 p-2 rounded-lg border border-info/40">
              {svxResult.svx}
            </Text>
          </View>
        )}
      </View>

      {/* Step Counter */}
      {typeof state.step === "number" && (
        <View className="mb-4">
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted font-semibold">
              {t.step} {state.step} {t.of} 3
            </Text>
          </View>
          <View className="flex-row gap-1 h-1.5">
            <View
              className={`flex-1 rounded-full ${
                state.step >= 1 ? "bg-danger-solid" : "bg-surface-secondary"
              }`}
            />
            <View
              className={`flex-1 rounded-full ${
                state.step >= 2 ? "bg-danger-solid" : "bg-surface-secondary"
              }`}
            />
            <View
              className={`flex-1 rounded-full ${
                state.step >= 3 ? "bg-danger-solid" : "bg-surface-secondary"
              }`}
            />
          </View>
        </View>
      )}

      {/* Tap 1: Victims */}
      {state.step === 1 && (
        <View className="flex-1 justify-between">
          <View>
            <Text className="text-xl font-bold text-foreground mb-1">
              {t.step1_title}
            </Text>
            <Text className="text-xs text-muted mb-5">
              {t.step1_subtitle}
            </Text>

            <View className="gap-3.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => handleVictims(1)}
                className="min-h-20 py-3 bg-surface border-2 border-separator active:border-danger/40 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <View className="size-10 rounded-xl bg-surface-secondary items-center justify-center">
                    <Text className="text-danger font-bold text-xl">1</Text>
                  </View>
                  <Text className="text-foreground font-bold text-base">
                    {t.victims_1}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => handleVictims(2)}
                className="min-h-20 py-3 bg-surface border-2 border-separator active:border-danger/40 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <View className="size-10 rounded-xl bg-surface-secondary items-center justify-center">
                    <Text className="text-warning font-bold text-xl">2</Text>
                  </View>
                  <Text className="text-foreground font-bold text-base">
                    {t.victims_2}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => handleVictims(3)}
                className="min-h-20 py-3 bg-surface border-2 border-separator active:border-danger/40 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <View className="size-10 rounded-xl bg-surface-secondary items-center justify-center">
                    <Text className="text-danger font-bold text-xl">3+</Text>
                  </View>
                  <Text className="text-foreground font-bold text-base">
                    {t.victims_3plus}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Tap 2: Conscious */}
      {state.step === 2 && (
        <View className="flex-1 justify-between">
          <View>
            <Text className="text-xl font-bold text-foreground mb-1">
              {t.step2_title}
            </Text>
            <Text className="text-xs text-muted mb-5">
              {t.step2_subtitle}
            </Text>

            <View className="gap-3.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => handleConscious(1)}
                className="min-h-20 py-3 bg-surface border-2 border-separator active:border-success/40 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <Ionicons name="checkmark-circle" size={28} color={cSuccess} />
                  <Text className="text-foreground font-bold text-base">
                    {t.conscious_yes}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => handleConscious(0)}
                className="min-h-20 py-3 bg-surface border-2 border-separator active:border-danger/40 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <Ionicons name="close-circle" size={28} color={cDanger} />
                  <Text className="text-foreground font-bold text-base">
                    {t.conscious_no}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => handleConscious(2)}
                className="min-h-20 py-3 bg-surface border-2 border-separator active:border-warning/40 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <Ionicons name="help-circle" size={28} color={cWarning} />
                  <Text className="text-foreground font-bold text-base">
                    {t.conscious_unknown}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Tap 3: Danger (Multi-select) */}
      {state.step === 3 && (
        <View className="flex-1 justify-between">
          <View>
            <Text className="text-xl font-bold text-foreground mb-1">
              {t.step3_title}
            </Text>
            <Text className="text-xs text-muted mb-4">
              {t.step3_subtitle}
            </Text>

            <View className="flex-row flex-wrap gap-2.5 mb-6">
              <Pressable
                accessibilityRole="button"
                onPress={() => handleDanger("fire")}
                className={`w-[48%] p-4 rounded-xl border-2 items-center justify-center gap-2 ${
                  state.dangers.includes("fire")
                    ? "bg-danger/30 border-danger/40"
                    : "bg-surface border-border"
                }`}
              >
                <Ionicons
                  name="flame"
                  size={24}
                  color={state.dangers.includes("fire") ? cDanger : cMuted}
                />
                <Text className="text-foreground font-bold text-xs text-center">
                  {t.danger_fire}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => handleDanger("trapped")}
                className={`w-[48%] p-4 rounded-xl border-2 items-center justify-center gap-2 ${
                  state.dangers.includes("trapped")
                    ? "bg-danger/30 border-danger/40"
                    : "bg-surface border-border"
                }`}
              >
                <Ionicons
                  name="warning"
                  size={24}
                  color={
                    state.dangers.includes("trapped") ? cWarning : cMuted
                  }
                />
                <Text className="text-foreground font-bold text-xs text-center">
                  {t.danger_trapped}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => handleDanger("bleeding")}
                className={`w-[48%] p-4 rounded-xl border-2 items-center justify-center gap-2 ${
                  state.dangers.includes("bleeding")
                    ? "bg-danger/30 border-danger/40"
                    : "bg-surface border-border"
                }`}
              >
                <Ionicons
                  name="water"
                  size={24}
                  color={
                    state.dangers.includes("bleeding") ? cDanger : cMuted
                  }
                />
                <Text className="text-foreground font-bold text-xs text-center">
                  {t.danger_bleeding}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => handleDanger("none")}
                className={`w-[48%] p-4 rounded-xl border-2 items-center justify-center gap-2 ${
                  state.dangers.includes("none")
                    ? "bg-success/30 border-success/40"
                    : "bg-surface border-border"
                }`}
              >
                <Ionicons
                  name="shield-checkmark"
                  size={24}
                  color={state.dangers.includes("none") ? cSuccess : cMuted}
                />
                <Text className="text-foreground font-bold text-xs text-center">
                  {t.danger_none}
                </Text>
              </Pressable>
            </View>
          </View>

          <Pressable
                accessibilityRole="button"
            onPress={handleSubmit}
            disabled={isSubmitting}
            className="w-full min-h-16 py-3 rounded-2xl bg-danger-solid active:bg-danger-solid items-center justify-center shadow-lg"
          >
            <Text className="text-foreground font-bold text-base">
              {isSubmitting
                ? t.submitting
                : forcedSms
                  ? t.sendSms
                  : t.submit_button}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Manual Location Prompt (GPS Timeout fallback) */}
      {state.step === "location_prompt" && (
        <View className="flex-1 justify-between">
          <View>
            <Text className="text-2xl font-bold text-foreground mb-1">
              {t.gps_timeout_prompt}
            </Text>
            <Text className="text-xs text-muted mb-5">
              {t.gps_timeout_helper}
            </Text>

            <View className="gap-4">
              <View>
                <Text className="text-xs font-bold text-muted mb-1.5">
                  {t.commune_label}
                </Text>
                <TextInput
                  accessibilityLabel={t.commune_label}
                  style={{ textAlign: isRtl ? "right" : "left", writingDirection: isRtl ? "rtl" : "ltr" }}
                  value={commune}
                  onChangeText={setCommune}
                  placeholder={t.commune_placeholder}
                  placeholderTextColor={cMuted}
                  className="w-full h-12 bg-surface border border-separator rounded-xl px-4 text-foreground text-sm"
                />
              </View>

              <View>
                <Text className="text-xs font-bold text-muted mb-1.5">
                  {t.pk_label}
                </Text>
                <TextInput
                  accessibilityLabel={t.pk_label}
                  style={{ textAlign: isRtl ? "right" : "left", writingDirection: isRtl ? "rtl" : "ltr" }}
                  value={pkMarker}
                  onChangeText={setPkMarker}
                  placeholder={t.pk_placeholder}
                  placeholderTextColor={cMuted}
                  className="w-full h-12 bg-surface border border-separator rounded-xl px-4 text-foreground text-sm"
                />
              </View>
            </View>
          </View>

          <Pressable
                accessibilityRole="button"
            onPress={handleManualLocationSubmit}
            disabled={isSubmitting}
            className="w-full min-h-16 py-3 rounded-2xl bg-danger-solid active:bg-danger-solid items-center justify-center shadow-lg mt-6"
          >
            <Text className="text-foreground font-bold text-sm">
              {isSubmitting
                ? t.submitting
                : forcedSms
                  ? t.sendSms
                  : t.confirm_location_button}
            </Text>
          </Pressable>
        </View>
      )}


      {state.step === "submitting" && (
        <View accessibilityLiveRegion="polite" className="items-center py-6">
          <Text className="text-foreground text-center font-bold">{t.submitting}</Text>
          <Text className="text-muted text-center">{t.sendingHelp}</Text>
        </View>
      )}
      {state.step === "error" && (
        <View accessibilityLiveRegion="assertive" className="items-center py-6 gap-4">
          <Text className="text-foreground text-center font-bold">{t.error_title}</Text>
          <Text className="text-muted text-center">{t.transmissionError}</Text>
          <Pressable accessibilityRole="button" onPress={handleSubmit} className="bg-danger-solid rounded-xl p-4">
            <Text className="text-foreground font-bold">{t.retry_button}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={handleReset} className="bg-surface-secondary rounded-xl p-4">
            <Text className="text-foreground font-bold">{t.new_report}</Text>
          </Pressable>
        </View>
      )}
      {/* Success screen */}
      {state.step === "submitted" && (
        <View className="flex-1 items-center justify-center py-6">
          <View className="size-16 rounded-full bg-success/20 border-2 border-success/40 items-center justify-center mb-4">
            <Ionicons name="checkmark" size={32} color={cSuccess} />
          </View>
          <Text className="text-2xl font-bold text-foreground mb-2 text-center">
            {t.success_title}
          </Text>
          <Text className="text-xs text-muted mb-6 text-center">
            {t.success_desc}
          </Text>

          <View className="w-full bg-surface border border-border rounded-2xl p-4 mb-4">
            <Text className="text-xs text-muted mb-1">
              {t.success_incident_id}
            </Text>
            <Text style={{ writingDirection: "ltr", textAlign: "left" }} className="text-success font-mono font-bold text-base">
              #{state.submissionResult?.incidentId.slice(0, 8).toUpperCase()}
            </Text>
          </View>

          {/* SMS Ack Card (FR-S4-05, FR-S4-06) */}
          {smsAck && (
            <View className="w-full bg-info-soft border border-info/40 rounded-2xl p-4 mb-4">
              <View className="flex-row justify-between items-center mb-1">
                <Text className="text-xs text-info font-bold">
                  {t.smsAck}
                </Text>
                <Text className="text-xs text-foreground bg-info-soft px-2 py-0.5 rounded">
                  {t.emulated}
                </Text>
              </View>
              <Text style={{ writingDirection: "ltr", textAlign: "left" }} className="text-foreground font-mono font-bold text-sm bg-surface p-2.5 rounded-lg border border-info/50">
                {smsAck}
              </Text>
            </View>
          )}

          <Pressable
                accessibilityRole="button"
            onPress={handleReset}
            className="w-full min-h-14 py-3 bg-surface-secondary active:bg-surface-tertiary rounded-xl items-center justify-center"
          >
            <Text className="text-foreground font-bold text-sm">
              {t.new_report}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  </View>
);
}
