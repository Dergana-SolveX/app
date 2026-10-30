import React, { useEffect, useReducer, useRef, useState } from "react";
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
  type DangerType,
  WITNESS_TEXT,
} from "@solvex-dergana/shared";
import { trpc } from "@/utils/trpc";
import { CrashCountdownOverlay } from "@/components/crash-countdown-overlay";

export function WitnessReport() {
  const [state, dispatch] = useReducer(
    flowReducer,
    undefined,
    () => createWitnessFlowState(),
  );

  const [crashState, crashDispatch] = useReducer(
    countdownReducer,
    undefined,
    createCrashCountdownState,
  );
  const filterRef = useRef(createPhoneTriggerFilter());

  const t = WITNESS_TEXT[state.lang];
  const isRtl = state.lang === "ar";

  // Mutation
  const submitMutation = useMutation(
    trpc.alerts.submitOnline.mutationOptions({
      onSuccess: (res) => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        dispatch({ type: "SUBMISSION_SUCCESS", result: res });
      },
      onError: (err) => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
        dispatch({
          type: "SUBMISSION_ERROR",
          error: err.message || "Erreur de transmission",
        });
      },
    }),
  );

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
          onError: (err) => {
            crashDispatch({
              type: "ALERT_ERROR",
              payload: { error: err.message || "Erreur d'envoi automatique" },
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

    const payload = state.toSubmissionPayload();
    dispatch({ type: "SUBMISSION_START" });
    submitMutation.mutate(payload);
  };

  const handleManualLocationSubmit = () => {
    if (!commune.trim() && !pkMarker.trim()) {
      Alert.alert(
        state.lang === "ar" ? "تنبيه" : "Champ requis",
        state.lang === "ar"
          ? "يرجى إدخال البلدية أو النقطة الكيلومترية"
          : "Veuillez renseigner la commune ou le repère routier (PK).",
      );
      return;
    }

    triggerHaptic();
    dispatch({ type: "SET_MANUAL_LOCATION", commune, pkMarker });

    const payload = {
      ...state.toSubmissionPayload(),
      commune: commune.trim() || null,
      pkMarker: pkMarker.trim() || null,
    };

    dispatch({ type: "SUBMISSION_START" });
    submitMutation.mutate(payload);
  };

  const handleReset = () => {
    triggerHaptic();
    setCommune("");
    setPkMarker("");
    dispatch({ type: "RESET" });
  };

  return (
    <View style={{ flex: 1 }}>
      <CrashCountdownOverlay
        state={crashState}
        onCancel={() => crashDispatch({ type: "CANCEL" })}
        onReset={() => crashDispatch({ type: "RESET" })}
      />

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 16 }}
        className="bg-slate-950"
      >
        {/* Top Banner with Language Toggle & Hidden Simulation Trigger */}
        <View
          className={`items-center justify-between mb-4 pb-3 border-b border-slate-800 ${
            isRtl ? "flex-row-reverse" : "flex-row"
          }`}
        >
          <View
            className={`items-center gap-2 ${
              isRtl ? "flex-row-reverse" : "flex-row"
            }`}
          >
            <View className="size-8 rounded-lg bg-red-600 items-center justify-center">
              <Ionicons name="warning" size={18} color="#ffffff" />
            </View>
            <View>
              <Text
                style={{ writingDirection: isRtl ? "rtl" : "ltr" }}
                className="text-white font-black text-sm uppercase tracking-wide"
              >
                {t.title}
              </Text>
              <Text className="text-red-400 text-[10px] font-bold">
                14 / 154 URGENCE
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            {/* Hidden 'simuler un choc' button (FR-S4-01 / Issue #21) */}
            <Pressable
              testID="simulate-impact-button"
              accessibilityLabel="Simuler un choc"
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
              className="bg-slate-900 border border-slate-800 rounded px-2 py-1 active:opacity-100"
            >
              <Text className="text-[10px] text-slate-400 font-medium">
                simuler un choc
              </Text>
            </Pressable>

            <View className="flex-row bg-slate-800 rounded-full p-0.5 border border-slate-700">
              <Pressable
                onPress={() => dispatch({ type: "SET_LANG", lang: "fr" })}
                className={`px-3 py-1 rounded-full ${
                  state.lang === "fr" ? "bg-red-600" : "bg-transparent"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    state.lang === "fr" ? "text-white" : "text-slate-400"
                  }`}
                >
                  FR
                </Text>
              </Pressable>
              <Pressable
                onPress={() => dispatch({ type: "SET_LANG", lang: "ar" })}
                className={`px-3 py-1 rounded-full ${
                  state.lang === "ar" ? "bg-red-600" : "bg-transparent"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    state.lang === "ar" ? "text-white" : "text-slate-400"
                  }`}
                >
                  عربي
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

      {/* GPS Status Indicator */}
      <View className="mb-4 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          {state.gpsStatus === "acquired" ? (
            <>
              <Ionicons name="locate" size={16} color="#34d399" />
              <Text className="text-emerald-400 text-xs font-medium">
                {t.gps_acquired} ({state.coords?.lat.toFixed(4)},{" "}
                {state.coords?.lng.toFixed(4)})
              </Text>
            </>
          ) : state.gpsStatus === "timeout" || state.gpsStatus === "denied" ? (
            <>
              <Ionicons name="alert-circle" size={16} color="#fbbf24" />
              <Text className="text-amber-400 text-xs font-medium">
                {t.gps_timeout}
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="time-outline" size={16} color="#38bdf8" />
              <Text className="text-sky-400 text-xs font-medium">
                {t.gps_searching} ({20 - state.gpsSecondsElapsed}s)
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Step Counter */}
      {typeof state.step === "number" && (
        <View className="mb-4">
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-slate-400 font-semibold">
              {t.step} {state.step} {t.of} 3
            </Text>
          </View>
          <View className="flex-row gap-1 h-1.5">
            <View
              className={`flex-1 rounded-full ${
                state.step >= 1 ? "bg-red-600" : "bg-slate-800"
              }`}
            />
            <View
              className={`flex-1 rounded-full ${
                state.step >= 2 ? "bg-red-600" : "bg-slate-800"
              }`}
            />
            <View
              className={`flex-1 rounded-full ${
                state.step >= 3 ? "bg-red-600" : "bg-slate-800"
              }`}
            />
          </View>
        </View>
      )}

      {/* Tap 1: Victims */}
      {state.step === 1 && (
        <View className="flex-1 justify-between">
          <View>
            <Text className="text-xl font-black text-white mb-1">
              {t.step1_title}
            </Text>
            <Text className="text-xs text-slate-400 mb-5">
              {t.step1_subtitle}
            </Text>

            <View className="gap-3.5">
              <Pressable
                onPress={() => handleVictims(1)}
                className="h-20 bg-slate-900 border-2 border-slate-700 active:border-red-500 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <View className="size-10 rounded-xl bg-slate-800 items-center justify-center">
                    <Text className="text-red-400 font-black text-xl">1</Text>
                  </View>
                  <Text className="text-white font-bold text-base">
                    {t.victims_1}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => handleVictims(2)}
                className="h-20 bg-slate-900 border-2 border-slate-700 active:border-red-500 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <View className="size-10 rounded-xl bg-slate-800 items-center justify-center">
                    <Text className="text-amber-400 font-black text-xl">2</Text>
                  </View>
                  <Text className="text-white font-bold text-base">
                    {t.victims_2}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => handleVictims(3)}
                className="h-20 bg-slate-900 border-2 border-slate-700 active:border-red-500 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <View className="size-10 rounded-xl bg-slate-800 items-center justify-center">
                    <Text className="text-red-500 font-black text-xl">3+</Text>
                  </View>
                  <Text className="text-white font-bold text-base">
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
            <Text className="text-xl font-black text-white mb-1">
              {t.step2_title}
            </Text>
            <Text className="text-xs text-slate-400 mb-5">
              {t.step2_subtitle}
            </Text>

            <View className="gap-3.5">
              <Pressable
                onPress={() => handleConscious(1)}
                className="h-20 bg-slate-900 border-2 border-slate-700 active:border-emerald-500 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <Ionicons name="checkmark-circle" size={28} color="#34d399" />
                  <Text className="text-white font-bold text-base">
                    {t.conscious_yes}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => handleConscious(0)}
                className="h-20 bg-slate-900 border-2 border-slate-700 active:border-red-500 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <Ionicons name="close-circle" size={28} color="#f87171" />
                  <Text className="text-white font-bold text-base">
                    {t.conscious_no}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => handleConscious(2)}
                className="h-20 bg-slate-900 border-2 border-slate-700 active:border-amber-500 rounded-2xl flex-row items-center justify-between px-5"
              >
                <View className="flex-row items-center gap-3">
                  <Ionicons name="help-circle" size={28} color="#fbbf24" />
                  <Text className="text-white font-bold text-base">
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
            <Text className="text-xl font-black text-white mb-1">
              {t.step3_title}
            </Text>
            <Text className="text-xs text-slate-400 mb-4">
              {t.step3_subtitle}
            </Text>

            <View className="flex-row flex-wrap gap-2.5 mb-6">
              <Pressable
                onPress={() => handleDanger("fire")}
                className={`w-[48%] p-4 rounded-xl border-2 items-center justify-center gap-2 ${
                  state.dangers.includes("fire")
                    ? "bg-red-600/30 border-red-500"
                    : "bg-slate-900 border-slate-800"
                }`}
              >
                <Ionicons
                  name="flame"
                  size={24}
                  color={state.dangers.includes("fire") ? "#f87171" : "#94a3b8"}
                />
                <Text className="text-white font-bold text-xs text-center">
                  {t.danger_fire}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => handleDanger("trapped")}
                className={`w-[48%] p-4 rounded-xl border-2 items-center justify-center gap-2 ${
                  state.dangers.includes("trapped")
                    ? "bg-red-600/30 border-red-500"
                    : "bg-slate-900 border-slate-800"
                }`}
              >
                <Ionicons
                  name="warning"
                  size={24}
                  color={
                    state.dangers.includes("trapped") ? "#fbbf24" : "#94a3b8"
                  }
                />
                <Text className="text-white font-bold text-xs text-center">
                  {t.danger_trapped}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => handleDanger("bleeding")}
                className={`w-[48%] p-4 rounded-xl border-2 items-center justify-center gap-2 ${
                  state.dangers.includes("bleeding")
                    ? "bg-red-600/30 border-red-500"
                    : "bg-slate-900 border-slate-800"
                }`}
              >
                <Ionicons
                  name="water"
                  size={24}
                  color={
                    state.dangers.includes("bleeding") ? "#f87171" : "#94a3b8"
                  }
                />
                <Text className="text-white font-bold text-xs text-center">
                  {t.danger_bleeding}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => handleDanger("none")}
                className={`w-[48%] p-4 rounded-xl border-2 items-center justify-center gap-2 ${
                  state.dangers.includes("none")
                    ? "bg-emerald-600/30 border-emerald-500"
                    : "bg-slate-900 border-slate-800"
                }`}
              >
                <Ionicons
                  name="shield-checkmark"
                  size={24}
                  color={state.dangers.includes("none") ? "#34d399" : "#94a3b8"}
                />
                <Text className="text-white font-bold text-xs text-center">
                  {t.danger_none}
                </Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={submitMutation.isPending}
            className="w-full h-16 rounded-2xl bg-red-600 active:bg-red-500 items-center justify-center shadow-lg"
          >
            <Text className="text-white font-black text-base uppercase tracking-wider">
              {submitMutation.isPending ? t.submitting : t.submit_button}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Manual Location Prompt (GPS Timeout fallback) */}
      {state.step === "location_prompt" && (
        <View className="flex-1 justify-between">
          <View>
            <Text className="text-2xl font-black text-white mb-1">
              {t.gps_timeout_prompt}
            </Text>
            <Text className="text-xs text-slate-400 mb-5">
              {t.gps_timeout_helper}
            </Text>

            <View className="gap-4">
              <View>
                <Text className="text-xs font-bold text-slate-300 mb-1.5">
                  {t.commune_label}
                </Text>
                <TextInput
                  value={commune}
                  onChangeText={setCommune}
                  placeholder={t.commune_placeholder}
                  placeholderTextColor="#64748b"
                  className="w-full h-12 bg-slate-900 border border-slate-700 rounded-xl px-4 text-white text-sm"
                />
              </View>

              <View>
                <Text className="text-xs font-bold text-slate-300 mb-1.5">
                  {t.pk_label}
                </Text>
                <TextInput
                  value={pkMarker}
                  onChangeText={setPkMarker}
                  placeholder={t.pk_placeholder}
                  placeholderTextColor="#64748b"
                  className="w-full h-12 bg-slate-900 border border-slate-700 rounded-xl px-4 text-white text-sm"
                />
              </View>
            </View>
          </View>

          <Pressable
            onPress={handleManualLocationSubmit}
            disabled={submitMutation.isPending}
            className="w-full h-16 rounded-2xl bg-red-600 active:bg-red-500 items-center justify-center shadow-lg mt-6"
          >
            <Text className="text-white font-black text-sm uppercase tracking-wider">
              {submitMutation.isPending ? t.submitting : t.confirm_location_button}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Success screen */}
      {state.step === "submitted" && (
        <View className="flex-1 items-center justify-center py-6">
          <View className="size-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 items-center justify-center mb-4">
            <Ionicons name="checkmark" size={32} color="#34d399" />
          </View>
          <Text className="text-2xl font-black text-white mb-2 text-center">
            {t.success_title}
          </Text>
          <Text className="text-xs text-slate-300 mb-6 text-center">
            {t.success_desc}
          </Text>

          <View className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6">
            <Text className="text-xs text-slate-400 mb-1">
              {t.success_incident_id}
            </Text>
            <Text className="text-emerald-400 font-mono font-bold text-base">
              #{state.submissionResult?.incidentId.slice(0, 8).toUpperCase()}
            </Text>
          </View>

          <Pressable
            onPress={handleReset}
            className="w-full h-14 bg-slate-800 active:bg-slate-700 rounded-xl items-center justify-center"
          >
            <Text className="text-white font-bold text-sm uppercase">
              {t.new_report}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  </View>
);
}
