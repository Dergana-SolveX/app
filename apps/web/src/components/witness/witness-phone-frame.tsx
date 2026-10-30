import React, { useEffect, useReducer, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Flame,
  UserX,
  Crosshair,
  MapPin,
  CheckCircle2,
  RotateCcw,
  ShieldAlert,
  Radio,
  Clock,
  Sparkles,
  Heart,
} from "lucide-react";
import { MedicalProfileModal } from "./medical-profile-modal";
import {
  createWitnessFlowState,
  flowReducer,
  createCrashCountdownState,
  countdownReducer,
  type Coords,
  type DangerType,
  WITNESS_TEXT,
  type WitnessLang,
} from "@solvex-dergana/shared";
import { trpc } from "@/utils/trpc";

type Props = {
  initialCoords?: Coords;
  autoGps?: boolean;
};

export default function WitnessPhoneFrame({
  initialCoords,
  autoGps = true,
}: Props) {
  const [state, dispatch] = useReducer(
    flowReducer,
    undefined,
    () => createWitnessFlowState(),
  );

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileCode, setProfileCode] = useState<string | null>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem("solvex_medical_profile_code");
    }
    return null;
  });

  useEffect(() => {
    if (profileCode) {
      dispatch({ type: "SET_PROFILE_CODE", profileCode });
    }
  }, [profileCode]);

  const handleProfileSaved = (code: string | null) => {
    setProfileCode(code);
    dispatch({ type: "SET_PROFILE_CODE", profileCode: code });
    if (typeof window !== "undefined" && window.localStorage) {
      if (code) {
        window.localStorage.setItem("solvex_medical_profile_code", code);
      } else {
        window.localStorage.removeItem("solvex_medical_profile_code");
      }
    }
  };

  const t = WITNESS_TEXT[state.lang];
  const isRtl = state.lang === "ar";

  // tRPC mutation
  const submitMutation = useMutation(
    trpc.alerts.submitOnline.mutationOptions({
      onSuccess: (res) => {
        dispatch({ type: "SUBMISSION_SUCCESS", result: res });
      },
      onError: (err) => {
        dispatch({
          type: "SUBMISSION_ERROR",
          error: err.message || "Erreur de transmission",
        });
      },
    }),
  );

  // Initial coords if supplied
  useEffect(() => {
    if (initialCoords) {
      dispatch({ type: "GPS_ACQUIRED", coords: initialCoords });
    }
  }, [initialCoords]);

  // GPS 20-second timer
  useEffect(() => {
    if (!autoGps || state.gpsStatus === "acquired" || state.gpsStatus === "timeout") {
      return;
    }

    const timer = setInterval(() => {
      dispatch({ type: "TICK_GPS_TIMER" });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoGps, state.gpsStatus]);

  // Crash detection countdown state machine (FR-S4-01 / Issue #21)
  const [crashState, crashDispatch] = useReducer(
    countdownReducer,
    undefined,
    createCrashCountdownState,
  );

  // 1-second countdown tick interval
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
      const payload = {
        idempotencyKey: `auto-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        source: "app_auto" as const,
        profileCode: profileCode ?? undefined,
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
      };
      submitMutation.mutate(payload, {
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
      });
    }
  }, [crashState.status]);

  // Manual location state
  const [communeInput, setCommuneInput] = useState(state.manualCommune);
  const [pkInput, setPkInput] = useState(state.manualPkMarker);

  const handleVictimSelect = (count: 1 | 2 | 3) => {
    dispatch({ type: "SELECT_VICTIMS", count });
  };

  const handleConsciousSelect = (value: 0 | 1 | 2) => {
    dispatch({ type: "SELECT_CONSCIOUS", value });
  };

  const handleDangerToggle = (danger: DangerType) => {
    dispatch({ type: "TOGGLE_DANGER", danger });
  };

  const handleProceedSubmit = () => {
    // If GPS is not acquired and no manual location entered, show prompt
    if (
      state.gpsStatus !== "acquired" &&
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

  const handleManualLocationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({
      type: "SET_MANUAL_LOCATION",
      commune: communeInput,
      pkMarker: pkInput,
    });

    const payload = {
      ...state.toSubmissionPayload(),
      commune: communeInput.trim() || null,
      pkMarker: pkInput.trim() || null,
    };

    dispatch({ type: "SUBMISSION_START" });
    submitMutation.mutate(payload);
  };

  const simulateGpsFix = () => {
    dispatch({
      type: "GPS_ACQUIRED",
      coords: { lat: 36.725, lng: 3.183, accuracyM: 10 },
    });
  };

  const simulateGpsTimeout = () => {
    dispatch({ type: "GPS_FAILED", status: "timeout" });
  };

  const handleReset = () => {
    setCommuneInput("");
    setPkInput("");
    dispatch({ type: "RESET" });
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">
      {/* Presentation Control Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2 rounded-full border border-border/40 bg-card/80 px-4 py-2 text-xs backdrop-blur-md shadow-sm">
        <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-amber-500" />
          Miroir Galaxy A71 (FR-S4-09)
        </span>
        <span className="text-muted-foreground/40">•</span>
        <button
          type="button"
          onClick={simulateGpsFix}
          className="rounded-md bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition"
        >
          Simuler GPS fixé
        </button>
        <button
          type="button"
          onClick={simulateGpsTimeout}
          className="rounded-md bg-amber-500/10 px-2.5 py-1 font-medium text-amber-400 hover:bg-amber-500/20 active:scale-95 transition"
        >
          Simuler timeout GPS (20s)
        </button>
        <button
          type="button"
          data-testid="simulate-impact-button"
          onClick={() => {
            crashDispatch({
              type: "TRIGGER_CRASH",
              payload: {
                peakG: 6.2,
                speedBeforeKmh: 65,
                simulated: true,
                timestamp: Date.now(),
              },
            });
          }}
          className="rounded-md bg-red-500/15 px-2.5 py-1 font-semibold text-red-400 hover:bg-red-500/25 border border-red-500/30 active:scale-95 transition flex items-center gap-1"
        >
          <span>💥</span> Simuler un choc
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md bg-muted px-2.5 py-1 font-medium hover:bg-muted/80 active:scale-95 transition"
        >
          Réinitialiser
        </button>
      </div>

      {/* Galaxy A71 Smartphone Mockup Frame */}
      <div
        className="relative w-full max-w-[390px] h-[780px] rounded-[48px] bg-slate-950 p-3 shadow-2xl ring-1 ring-slate-800 ring-offset-8 ring-offset-slate-900 overflow-hidden flex flex-col select-none"
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Phone Speaker & Camera punch-hole */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center justify-center">
          <div className="size-4 rounded-full bg-black ring-2 ring-slate-900 flex items-center justify-center">
            <div className="size-1 rounded-full bg-slate-950" />
          </div>
        </div>

        {/* Screen Bezel & Container */}
        <div className="relative flex flex-col flex-1 rounded-[40px] bg-slate-900 border border-slate-800 text-slate-100 overflow-hidden font-sans">
          {/* Status Bar */}
          <div className="h-9 px-6 pt-2 flex items-center justify-between text-[11px] font-semibold text-slate-400 z-20">
            <span>12:42</span>
            <div className="flex items-center gap-1.5">
              <Radio className="size-3 text-emerald-400 animate-pulse" />
              <span>4G</span>
              <div className="w-5 h-2.5 rounded-sm border border-slate-500 p-0.5 flex items-center">
                <div className="h-full w-full bg-emerald-400 rounded-2xs" />
              </div>
            </div>
          </div>

          {/* Emergency Header */}
          <div className="px-4 py-3 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-red-600 text-white shadow-md shadow-red-900/40">
                <ShieldAlert className="size-4" />
              </span>
              <div>
                <h1 className="text-sm font-black tracking-wide text-white uppercase">
                  SVX SECOURS
                </h1>
                <p className="text-[10px] text-red-400 font-medium">URGENCE ROUTIÈRE</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(true)}
                data-testid="open-profile-modal-btn"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                  profileCode
                    ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                    : "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                }`}
              >
                <Heart className="size-3 text-red-500 fill-red-500/20" />
                <span>{profileCode ? `UID: ${profileCode}` : "Profil"}</span>
              </button>

            {/* Bilingual Language Switcher */}
            <div className="flex items-center rounded-full bg-slate-800 p-0.5 text-xs font-bold border border-slate-700">
              <button
                type="button"
                onClick={() => dispatch({ type: "SET_LANG", lang: "fr" })}
                className={`rounded-full px-2.5 py-1 transition ${
                  state.lang === "fr"
                    ? "bg-red-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                FR
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: "SET_LANG", lang: "ar" })}
                className={`rounded-full px-2.5 py-1 transition ${
                  state.lang === "ar"
                    ? "bg-red-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                عربي
              </button>
            </div>
            </div>
          </div>

          {/* GPS Status Indicator Banner */}
          <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {state.gpsStatus === "acquired" ? (
                <>
                  <Crosshair className="size-3.5 text-emerald-400" />
                  <span className="text-emerald-300 font-medium text-[11px]">
                    {t.gps_acquired} ({state.coords?.lat.toFixed(4)},{" "}
                    {state.coords?.lng.toFixed(4)})
                  </span>
                </>
              ) : state.gpsStatus === "timeout" ? (
                <>
                  <AlertTriangle className="size-3.5 text-amber-400" />
                  <span className="text-amber-300 font-medium text-[11px]">
                    {t.gps_timeout}
                  </span>
                </>
              ) : (
                <>
                  <Clock className="size-3.5 text-sky-400 animate-spin" />
                  <span className="text-sky-300 font-medium text-[11px]">
                    {t.gps_searching} ({20 - state.gpsSecondsElapsed}s)
                  </span>
                </>
              )}
            </div>
            {state.manualCommune && (
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700 truncate max-w-[110px]">
                {state.manualCommune}
              </span>
            )}
          </div>

          {/* Progress Indicator (3 Steps) */}
          {typeof state.step === "number" && (
            <div className="px-4 pt-3 pb-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5">
                <span>
                  {t.step} {state.step} {t.of} 3
                </span>
                <span>
                  {state.step === 1
                    ? "1/3 : " + (isRtl ? "الضحايا" : "Victimes")
                    : state.step === 2
                      ? "2/3 : " + (isRtl ? "الوعي" : "Conscience")
                      : "3/3 : " + (isRtl ? "الأخطار" : "Dangers")}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 h-1.5">
                <div
                  className={`rounded-full transition-all duration-300 ${
                    state.step >= 1 ? "bg-red-600" : "bg-slate-800"
                  }`}
                />
                <div
                  className={`rounded-full transition-all duration-300 ${
                    state.step >= 2 ? "bg-red-600" : "bg-slate-800"
                  }`}
                />
                <div
                  className={`rounded-full transition-all duration-300 ${
                    state.step >= 3 ? "bg-red-600" : "bg-slate-800"
                  }`}
                />
              </div>
            </div>
          )}

          {/* Main Interactive Screen Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col justify-between">
            {/* Step 1: Victims */}
            {state.step === 1 && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <h2 className="text-xl font-extrabold text-white mt-1 mb-1 leading-snug">
                    {t.step1_title}
                  </h2>
                  <p className="text-xs text-slate-400 mb-4">{t.step1_subtitle}</p>

                  <div className="space-y-3.5">
                    <button
                      type="button"
                      onClick={() => handleVictimSelect(1)}
                      className={`w-full h-24 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-lg active:scale-[0.98] transition shadow-lg ${
                        state.victims === 1
                          ? "bg-red-600 border-red-500 text-white shadow-red-900/40"
                          : "bg-slate-800/90 border-slate-700 text-slate-100 hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="flex size-12 items-center justify-center rounded-xl bg-slate-900/70 text-2xl font-black text-red-400 border border-slate-700/80">
                          1
                        </span>
                        <span className="text-base text-left">{t.victims_1}</span>
                      </div>
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-900/60 text-slate-300 border border-slate-700">
                        Solo
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleVictimSelect(2)}
                      className={`w-full h-24 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-lg active:scale-[0.98] transition shadow-lg ${
                        state.victims === 2
                          ? "bg-red-600 border-red-500 text-white shadow-red-900/40"
                          : "bg-slate-800/90 border-slate-700 text-slate-100 hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="flex size-12 items-center justify-center rounded-xl bg-slate-900/70 text-2xl font-black text-amber-400 border border-slate-700/80">
                          2
                        </span>
                        <span className="text-base text-left">{t.victims_2}</span>
                      </div>
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-900/60 text-slate-300 border border-slate-700">
                        Duo
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleVictimSelect(3)}
                      className={`w-full h-24 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-lg active:scale-[0.98] transition shadow-lg ${
                        state.victims === 3
                          ? "bg-red-600 border-red-500 text-white shadow-red-900/40"
                          : "bg-slate-800/90 border-slate-700 text-slate-100 hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="flex size-12 items-center justify-center rounded-xl bg-slate-900/70 text-2xl font-black text-red-500 border border-slate-700/80">
                          3+
                        </span>
                        <span className="text-base text-left">{t.victims_3plus}</span>
                      </div>
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-red-950/70 text-red-300 border border-red-800">
                        Multi
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Conscious */}
            {state.step === 2 && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <h2 className="text-xl font-extrabold text-white mt-1 mb-1 leading-snug">
                    {t.step2_title}
                  </h2>
                  <p className="text-xs text-slate-400 mb-4">{t.step2_subtitle}</p>

                  <div className="space-y-3.5">
                    <button
                      type="button"
                      onClick={() => handleConsciousSelect(1)}
                      className={`w-full h-20 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-base active:scale-[0.98] transition shadow-lg ${
                        state.conscious === 1
                          ? "bg-emerald-600 border-emerald-500 text-white shadow-emerald-900/40"
                          : "bg-slate-800/90 border-slate-700 text-slate-100 hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-950/70 text-emerald-400 border border-emerald-800">
                          <CheckCircle2 className="size-6" />
                        </span>
                        <span>{t.conscious_yes}</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleConsciousSelect(0)}
                      className={`w-full h-20 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-base active:scale-[0.98] transition shadow-lg ${
                        state.conscious === 0
                          ? "bg-red-600 border-red-500 text-white shadow-red-900/40"
                          : "bg-slate-800/90 border-slate-700 text-slate-100 hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-red-950/70 text-red-400 border border-red-800">
                          <UserX className="size-6" />
                        </span>
                        <span>{t.conscious_no}</span>
                      </div>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800">
                        Critique
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleConsciousSelect(2)}
                      className={`w-full h-20 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-base active:scale-[0.98] transition shadow-lg ${
                        state.conscious === 2
                          ? "bg-amber-600 border-amber-500 text-white shadow-amber-900/40"
                          : "bg-slate-800/90 border-slate-700 text-slate-100 hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-amber-950/70 text-amber-400 border border-amber-800">
                          <AlertTriangle className="size-6" />
                        </span>
                        <span>{t.conscious_unknown}</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "SELECT_VICTIMS", count: state.victims ?? 1 })}
                    className="w-full py-2.5 text-xs font-semibold text-slate-400 hover:text-white transition"
                  >
                    ← {t.back}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Danger (Multi-select) */}
            {state.step === 3 && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <h2 className="text-xl font-extrabold text-white mt-1 mb-1 leading-snug">
                    {t.step3_title}
                  </h2>
                  <p className="text-xs text-slate-400 mb-3">{t.step3_subtitle}</p>

                  <div className="grid grid-cols-2 gap-2.5 mb-4">
                    <button
                      type="button"
                      onClick={() => handleDangerToggle("fire")}
                      className={`p-3.5 rounded-xl border-2 flex flex-col items-center justify-center text-center gap-2 active:scale-95 transition ${
                        state.dangers.includes("fire")
                          ? "bg-red-600/30 border-red-500 text-white shadow-md shadow-red-900/30"
                          : "bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <Flame
                        className={`size-6 ${
                          state.dangers.includes("fire") ? "text-red-400" : "text-slate-400"
                        }`}
                      />
                      <span className="text-xs font-bold leading-tight">{t.danger_fire}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDangerToggle("trapped")}
                      className={`p-3.5 rounded-xl border-2 flex flex-col items-center justify-center text-center gap-2 active:scale-95 transition ${
                        state.dangers.includes("trapped")
                          ? "bg-red-600/30 border-red-500 text-white shadow-md shadow-red-900/30"
                          : "bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <AlertTriangle
                        className={`size-6 ${
                          state.dangers.includes("trapped") ? "text-amber-400" : "text-slate-400"
                        }`}
                      />
                      <span className="text-xs font-bold leading-tight">{t.danger_trapped}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDangerToggle("bleeding")}
                      className={`p-3.5 rounded-xl border-2 flex flex-col items-center justify-center text-center gap-2 active:scale-95 transition ${
                        state.dangers.includes("bleeding")
                          ? "bg-red-600/30 border-red-500 text-white shadow-md shadow-red-900/30"
                          : "bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <div
                        className={`size-6 rounded-full flex items-center justify-center font-bold text-xs ${
                          state.dangers.includes("bleeding")
                            ? "bg-red-600 text-white"
                            : "bg-slate-700 text-slate-300"
                        }`}
                      >
                        🩸
                      </div>
                      <span className="text-xs font-bold leading-tight">{t.danger_bleeding}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDangerToggle("none")}
                      className={`p-3.5 rounded-xl border-2 flex flex-col items-center justify-center text-center gap-2 active:scale-95 transition ${
                        state.dangers.includes("none")
                          ? "bg-emerald-600/30 border-emerald-500 text-white shadow-md shadow-emerald-900/30"
                          : "bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <CheckCircle2
                        className={`size-6 ${
                          state.dangers.includes("none") ? "text-emerald-400" : "text-slate-400"
                        }`}
                      />
                      <span className="text-xs font-bold leading-tight">{t.danger_none}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={handleProceedSubmit}
                    disabled={submitMutation.isPending}
                    className="w-full h-16 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-black text-base uppercase tracking-wider shadow-lg shadow-red-900/50 active:scale-[0.98] transition flex items-center justify-center gap-2 border-2 border-red-500 disabled:opacity-50"
                  >
                    <ShieldAlert className="size-5" />
                    {submitMutation.isPending ? t.submitting : t.submit_button}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SELECT_CONSCIOUS",
                        value: state.conscious ?? 1,
                      })
                    }
                    className="w-full py-2.5 text-xs font-semibold text-slate-400 hover:text-white transition mt-1"
                  >
                    ← {t.back}
                  </button>
                </div>
              </div>
            )}

            {/* Location Prompt Fallback (when GPS timed out after 20s) */}
            {state.step === "location_prompt" && (
              <form
                onSubmit={handleManualLocationSubmit}
                className="flex-1 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 text-amber-400 mb-2">
                    <MapPin className="size-5" />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      {t.gps_timeout}
                    </span>
                  </div>

                  <h2 className="text-2xl font-black text-white mb-1">
                    {t.gps_timeout_prompt}
                  </h2>
                  <p className="text-xs text-slate-400 mb-5">{t.gps_timeout_helper}</p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">
                        {t.commune_label}
                      </label>
                      <input
                        type="text"
                        required
                        value={communeInput}
                        onChange={(e) => setCommuneInput(e.target.value)}
                        placeholder={t.commune_placeholder}
                        className="w-full h-12 rounded-xl bg-slate-800 border-2 border-slate-700 px-4 text-sm font-semibold text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">
                        {t.pk_label}
                      </label>
                      <input
                        type="text"
                        required
                        value={pkInput}
                        onChange={(e) => setPkInput(e.target.value)}
                        placeholder={t.pk_placeholder}
                        className="w-full h-12 rounded-xl bg-slate-800 border-2 border-slate-700 px-4 text-sm font-semibold text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={submitMutation.isPending}
                    className="w-full h-14 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-red-900/40 active:scale-[0.98] transition flex items-center justify-center gap-2 border border-red-400 disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-5" />
                    {submitMutation.isPending ? t.submitting : t.confirm_location_button}
                  </button>
                </div>
              </form>
            )}

            {/* Submitting state */}
            {state.step === "submitting" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="size-20 rounded-full bg-red-600/20 border-2 border-red-500 flex items-center justify-center mb-6 animate-pulse">
                  <ShieldAlert className="size-10 text-red-500 animate-spin" />
                </div>
                <h3 className="text-lg font-black text-white mb-2">{t.submitting}</h3>
                <p className="text-xs text-slate-400 max-w-xs">
                  Chiffrement et routage prioritaire vers le centre de commandement 14/154.
                </p>
              </div>
            )}

            {/* Success screen */}
            {state.step === "submitted" && (
              <div className="flex-1 flex flex-col items-center justify-between text-center py-6">
                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="size-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mb-4">
                    <CheckCircle2 className="size-10 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-black text-white mb-2">{t.success_title}</h3>
                  <p className="text-xs text-slate-300 mb-6">{t.success_desc}</p>

                  <div className="w-full rounded-2xl bg-slate-800/80 border border-slate-700 p-4 mb-4 text-left">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-400">{t.success_incident_id}</span>
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        #{state.submissionResult?.incidentId.slice(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span>{isRtl ? "الحالة" : "Statut"}</span>
                      <span className="font-semibold text-white">
                        {state.submissionResult?.merged
                          ? isRtl
                            ? "تم الدمج مع بلاغ قائم"
                            : "Fusionné avec dossier actif"
                          : isRtl
                            ? "حادث مفتوح — جاري الإرسال"
                            : "Incident ouvert — en cours"}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900/60 rounded-xl p-3 font-medium">
                    ⚠️ {t.success_stay_safe}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleReset}
                  className="w-full h-12 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 border border-slate-700 active:scale-95 transition"
                >
                  <RotateCcw className="size-4" />
                  {t.new_report}
                </button>
              </div>
            )}

            {/* Error screen */}
            {state.step === "error" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="size-16 rounded-full bg-red-600/20 border-2 border-red-500 flex items-center justify-center mb-4">
                  <AlertTriangle className="size-8 text-red-400" />
                </div>
                <h3 className="text-lg font-black text-white mb-2">{t.error_title}</h3>
                <p className="text-xs text-red-300 mb-6">{state.error}</p>

                <button
                  type="button"
                  onClick={handleProceedSubmit}
                  className="w-full h-12 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg"
                >
                  <RotateCcw className="size-4" />
                  {t.retry_button}
                </button>
              </div>
            )}

            {/* Crash Countdown Overlay (FR-S4-01 / Issue #21) */}
            {crashState.status !== "idle" && (
              <div
                data-testid="crash-countdown-overlay"
                className={`absolute inset-0 z-50 flex flex-col justify-between p-6 ${
                  crashState.status === "cancelled"
                    ? "bg-slate-950/95"
                    : crashState.status === "sent"
                      ? "bg-teal-950/95"
                      : "bg-red-950/95"
                } backdrop-blur-md transition-colors animate-in fade-in duration-200`}
              >
                {crashState.status === "countdown" && (
                  <div className="flex flex-col items-center justify-between h-full py-4 text-center">
                    <div className="flex flex-col items-center">
                      <span className="px-3 py-1 rounded-full bg-red-600 text-white font-black text-[11px] tracking-wider uppercase border border-red-400 animate-pulse shadow-lg mb-2">
                        ⚠️ CHOC DÉTECTÉ · ALERTE AUTOMATIQUE
                      </span>
                      <p className="text-sm font-bold text-red-200">
                        تم رصد اصطدام قوي · سيتم إرسال الإنذار
                      </p>
                    </div>

                    <div className="flex flex-col items-center my-6">
                      <div className="relative size-44 rounded-full bg-red-700/80 border-4 border-white flex flex-col items-center justify-center shadow-2xl animate-pulse">
                        <span
                          data-testid="countdown-timer-value"
                          className="text-7xl font-black text-white tracking-tighter leading-none"
                        >
                          {crashState.secondsRemaining}
                        </span>
                        <span className="text-[11px] font-black text-red-200 uppercase tracking-widest mt-1">
                          SECONDES
                        </span>
                      </div>
                      <p className="text-xs text-red-200 mt-4 max-w-[280px]">
                        Une alerte géolocalisée sera transmise aux secours dans{" "}
                        <strong className="text-white font-bold">{crashState.secondsRemaining} s</strong>.
                      </p>
                    </div>

                    {/* Giant Cancel Button (PRD FR-S4-01: "JE VAIS BIEN — ANNULER") */}
                    <div className="w-full flex flex-col items-center gap-3">
                      <button
                        type="button"
                        data-testid="cancel-crash-button"
                        onClick={() => crashDispatch({ type: "CANCEL" })}
                        className="w-full py-5 px-4 rounded-2xl bg-white hover:bg-slate-100 text-red-700 font-black text-xl tracking-tight shadow-2xl active:scale-95 transition border-2 border-red-300 flex flex-col items-center justify-center gap-1 cursor-pointer"
                      >
                        <span className="text-2xl leading-none">✋</span>
                        <span>JE VAIS BIEN — ANNULER</span>
                        <span className="text-sm font-bold text-red-600">أنا بخير — إلغاء</span>
                      </button>

                      {crashState.simulated && (
                        <span className="text-[10px] text-red-400/80 font-medium bg-black/30 px-2.5 py-0.5 rounded-md">
                          TEST SIMULÉ (DÉMO)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {crashState.status === "cancelled" && (
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="size-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-3xl mb-4">
                      ✅
                    </div>
                    <h3 className="text-xl font-black text-white mb-1">ALERTE ANNULÉE</h3>
                    <p className="text-sm font-semibold text-slate-400 mb-4">تم إلغاء الإنذار بنجاح</p>
                    <p className="text-xs text-slate-300 max-w-[280px] leading-relaxed mb-6">
                      Vous avez indiqué aller bien. Aucun appel ni message d&apos;urgence n&apos;a été envoyé. L&apos;événement a été consigné dans le journal local.
                    </p>
                    <button
                      type="button"
                      onClick={() => crashDispatch({ type: "RESET" })}
                      className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider active:scale-95 transition cursor-pointer"
                    >
                      Retour à l&apos;accueil
                    </button>
                  </div>
                )}

                {(crashState.status === "sending" || crashState.status === "expired") && (
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="size-16 rounded-full bg-red-600/20 border-2 border-red-400 flex items-center justify-center text-3xl mb-4 animate-bounce">
                      📡
                    </div>
                    <h3 className="text-xl font-black text-white mb-1">ENVOI DE L&apos;ALERTE...</h3>
                    <p className="text-sm font-semibold text-red-300 mb-4">جارٍ إرسال نداء الاستغاثة...</p>
                    <p className="text-xs text-slate-300 max-w-[280px] leading-relaxed">
                      Transmission prioritaire des coordonnées GPS et du profil médical aux centres de secours 14 / 154.
                    </p>
                  </div>
                )}

                {crashState.status === "sent" && (
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="size-16 rounded-full bg-teal-500/20 border-2 border-teal-400 flex items-center justify-center text-3xl mb-4">
                      🚨
                    </div>
                    <h3 className="text-xl font-black text-white mb-1">SECOURS ALERTÉS</h3>
                    <p className="text-sm font-semibold text-teal-300 mb-4">تم إخطار الحماية المدنية</p>
                    <p className="text-xs text-slate-300 max-w-[280px] leading-relaxed mb-6">
                      Dossier d&apos;urgence créé auprès de la Protection Civile. Restez calme et en sécurité.
                    </p>
                    <button
                      type="button"
                      onClick={() => crashDispatch({ type: "RESET" })}
                      className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs uppercase tracking-wider active:scale-95 transition cursor-pointer"
                    >
                      Terminer
                    </button>
                  </div>
                )}
              </div>
            )}
            <MedicalProfileModal
              isOpen={isProfileModalOpen}
              onClose={() => setIsProfileModalOpen(false)}
              currentShortCode={profileCode}
              onProfileSaved={handleProfileSaved}
              lang={state.lang}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
