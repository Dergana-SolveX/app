import React, { useEffect, useMemo, useReducer, useState } from "react";
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
  Smartphone,
  Zap,
  Droplet,
  MailCheck,
  Hand,
  SatelliteDish,
  Siren,
} from "lucide-react";
import { LogoMark } from "@solvex-dergana/ui/components/logo";
import { MedicalProfileModal } from "./medical-profile-modal";
import {
  createWitnessFlowState,
  flowReducer,
  createCrashCountdownState,
  countdownReducer,
  buildWitnessSvxString,
  type Coords,
  type DangerType,
  WITNESS_TEXT,
  getLabels,
  type WitnessLang,
} from "@solvex-dergana/shared";
import { trpc } from "@/utils/trpc";

type Props = {
  initialCoords?: Coords;
  autoGps?: boolean;
  onLocaleChange?: (locale: "fr" | "ar") => void;
};

export default function WitnessPhoneFrame({
  initialCoords,
  autoGps = true,
  onLocaleChange,
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

  const t = { ...WITNESS_TEXT[state.lang], ...getLabels(state.lang, "victim") };
  const crash = getLabels(state.lang, "crash");
  const isRtl = state.lang === "ar";

  // tRPC mutation (Online)
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

  // Forced SMS mode & Ack state (FR-S4-06)
  const [forcedSms, setForcedSms] = useState(false);
  const [smsAck, setSmsAck] = useState<string | null>(null);

  // tRPC mutation (Forced SMS emulator ingest)
  const submitSmsMutation = useMutation(
    trpc.alerts.submitSms.mutationOptions({
      onSuccess: (res) => {
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
            error: "Format SMS non reconnu",
          });
        }
      },
      onError: (err) => {
        dispatch({
          type: "SUBMISSION_ERROR",
          error: err.message || "Erreur de transmission SMS",
        });
      },
    }),
  );

  const isSubmitting = submitMutation.isPending || submitSmsMutation.isPending;

  // Real-time SVX v1 protocol string & length calculation
  const svxStringResult = useMemo(() => {
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

    dispatch({ type: "SUBMISSION_START" });
    if (forcedSms) {
      submitSmsMutation.mutate({
        from: "+213550000000",
        body: svxStringResult.svx,
        emulated: true,
      });
    } else {
      const payload = state.toSubmissionPayload();
      submitMutation.mutate(payload);
    }
  };

  const handleManualLocationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({
      type: "SET_MANUAL_LOCATION",
      commune: communeInput,
      pkMarker: pkInput,
    });

    dispatch({ type: "SUBMISSION_START" });
    if (forcedSms) {
      submitSmsMutation.mutate({
        from: "+213550000000",
        body: svxStringResult.svx,
        emulated: true,
      });
    } else {
      const payload = {
        ...state.toSubmissionPayload(),
        commune: communeInput.trim() || null,
        pkMarker: pkInput.trim() || null,
      };
      submitMutation.mutate(payload);
    }
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
    setSmsAck(null);
    dispatch({ type: "RESET" });
    dispatch({ type: "SET_LANG", lang: state.lang });
  };

  return (
    <div lang={state.lang} dir={isRtl ? "rtl" : "ltr"} className="flex flex-col items-center justify-center p-4 text-start">
      {/* Presentation Control Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2 rounded-full border border-border/40 bg-card/80 px-4 py-2 text-xs backdrop-blur-md shadow-sm">
        <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-sev-yellow" />
          {t.mirror}
        </span>
        <span className="text-muted-foreground/40">•</span>
        <button
          type="button"
          onClick={simulateGpsFix}
          className="rounded-md bg-sev-green/10 px-2.5 py-1 font-medium text-sev-green hover:bg-sev-green/20 active:scale-95 transition"
        >
          {t.gpsFix}
        </button>
        <button
          type="button"
          onClick={simulateGpsTimeout}
          className="rounded-md bg-sev-yellow/10 px-2.5 py-1 font-medium text-sev-yellow hover:bg-sev-yellow/20 active:scale-95 transition"
        >
          {t.gpsTimeout}
        </button>
        <button
          type="button"
          data-testid="force-sms-toggle"
          onClick={() => setForcedSms((prev) => !prev)}
          className={`rounded-md px-2.5 py-1 font-semibold transition flex items-center gap-1 active:scale-95 border ${
            forcedSms
              ? "bg-info-solid border-info/40 text-solid-foreground shadow-sm"
              : "bg-info/15 border-info/30 text-info hover:bg-info/25"
          }`}
        >
          <Smartphone className="size-3.5" aria-hidden="true" /> {t.forceSms}
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
          className="rounded-md bg-sev-red/15 px-2.5 py-1 font-semibold text-sev-red hover:bg-sev-red/25 border border-sev-red/30 active:scale-95 transition flex items-center gap-1"
        >
          <Zap className="size-3.5" aria-hidden="true" /> {t.simulate}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md bg-muted px-2.5 py-1 font-medium hover:bg-muted/80 active:scale-95 transition"
        >
          {t.reset}
        </button>
      </div>

      {/* Galaxy A71 Smartphone Mockup Frame */}
      <div
        className="relative w-full max-w-[390px] h-[780px] rounded-[48px] bg-background p-3 shadow-2xl ring-1 ring-border ring-offset-8 ring-offset-border overflow-hidden flex flex-col select-none"
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Phone Speaker & Camera punch-hole */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center justify-center">
          <div className="size-4 rounded-full bg-background ring-2 ring-border flex items-center justify-center">
            <div className="size-1 rounded-full bg-background" />
          </div>
        </div>

        {/* Screen Bezel & Container */}
        <div className="relative flex flex-col flex-1 rounded-[40px] bg-card border border-border text-foreground overflow-hidden font-sans">
          {/* Status Bar */}
          <div className="h-9 px-6 pt-2 flex items-center justify-between text-xs font-semibold text-muted-foreground z-20">
            <span>12:42</span>
            <div className="flex items-center gap-1.5">
              <Radio className="size-3 text-sev-green animate-pulse" />
              <span>4G</span>
              <div className="w-5 h-2.5 rounded-sm border border-border-strong p-0.5 flex items-center">
                <div className="h-full w-full bg-sev-green rounded-2xs" />
              </div>
            </div>
          </div>

          {/* Emergency Header */}
          <div className="px-4 py-3 bg-background/70 border-b border-border flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <LogoMark className="size-8" />
              <div>
                <h1 className="text-sm font-bold text-foreground">
                  {t.brand}
                </h1>
                <p className="text-xs text-sev-red font-medium">{t.emergency}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(true)}
                data-testid="open-profile-modal-btn"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                  profileCode
                    ? "bg-sev-green-soft border-sev-green/40 text-sev-green"
                    : "bg-muted border-border-strong text-muted-foreground hover:text-foreground"
                }`}
              >
                <Heart className="size-3 text-sev-red fill-sev-red/20" />
                <span>{profileCode ? `UID: ${profileCode}` : "Profil"}</span>
              </button>

            {/* Bilingual Language Switcher */}
            <div className="flex items-center rounded-full bg-muted p-0.5 text-xs font-bold border border-border-strong">
              <button
                type="button"
                lang="fr" aria-pressed={state.lang === "fr"}
                onClick={() => { dispatch({ type: "SET_LANG", lang: "fr" }); onLocaleChange?.("fr"); }}
                className={`rounded-full px-2.5 py-1 transition ${
                  state.lang === "fr"
                    ? "bg-primary-action text-primary-action-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                FR
              </button>
              <button
                type="button"
                lang="ar" aria-pressed={state.lang === "ar"}
                onClick={() => { dispatch({ type: "SET_LANG", lang: "ar" }); onLocaleChange?.("ar"); }}
                className={`rounded-full px-2.5 py-1 transition ${
                  state.lang === "ar"
                    ? "bg-primary-action text-primary-action-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                عربي
              </button>
            </div>
            </div>
          </div>

          {/* GPS Status Indicator Banner */}
          <div className="px-4 py-2 bg-card/90 border-b border-border/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {state.gpsStatus === "acquired" ? (
                <>
                  <Crosshair className="size-3.5 text-sev-green" />
                  <span className="text-sev-green font-medium text-xs">
                    {t.gps_acquired} ({state.coords?.lat.toFixed(4)},{" "}
                    {state.coords?.lng.toFixed(4)})
                  </span>
                </>
              ) : state.gpsStatus === "timeout" ? (
                <>
                  <AlertTriangle className="size-3.5 text-sev-yellow" />
                  <span className="text-sev-yellow font-medium text-xs">
                    {t.gps_timeout}
                  </span>
                </>
              ) : (
                <>
                  <Clock className="size-3.5 text-info animate-spin" />
                  <span className="text-info font-medium text-xs">
                    {t.gps_searching} ({20 - state.gpsSecondsElapsed} {t.seconds})
                  </span>
                </>
              )}
            </div>
            {state.manualCommune && (
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full border border-border-strong truncate max-w-[110px]">
                {state.manualCommune}
              </span>
            )}
          </div>

          {/* Forced SMS Status & Raw Preview Banner (FR-S4-06) */}
          {forcedSms && (
            <div
              data-testid="raw-sms-preview"
              className="px-4 py-2 bg-info-soft border-b border-info/80 text-xs"
            >
              <div className="flex items-center justify-between text-xs font-bold text-info mb-1">
                <span className="flex items-center gap-1">
                  <Smartphone className="size-3.5" aria-hidden="true" /> {t.smsForced}
                </span>
                <span
                  data-testid="sms-char-counter"
                  className="font-mono text-foreground"
                >
                  {svxStringResult.charCount} / 160 {t.chars}
                </span>
              </div>
              <div dir="ltr" className="font-mono text-xs text-foreground bg-background/80 p-2 rounded-lg border border-info/50 break-all select-all">
                {svxStringResult.svx}
              </div>
            </div>
          )}

          {/* Progress Indicator (3 Steps) */}
          {typeof state.step === "number" && (
            <div className="px-4 pt-3 pb-1">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mb-1.5">
                <span>
                  {t.step} {state.step} {t.of} 3
                </span>
                <span>
                  {state.step === 1
                    ? "1/3 : " + t.victims
                    : state.step === 2
                      ? "2/3 : " + t.consciousness
                      : "3/3 : " + t.dangers}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 h-1.5">
                <div
                  className={`rounded-full transition-all duration-300 ${
                    state.step >= 1 ? "bg-danger-solid" : "bg-muted"
                  }`}
                />
                <div
                  className={`rounded-full transition-all duration-300 ${
                    state.step >= 2 ? "bg-danger-solid" : "bg-muted"
                  }`}
                />
                <div
                  className={`rounded-full transition-all duration-300 ${
                    state.step >= 3 ? "bg-danger-solid" : "bg-muted"
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
                  <h2 className="text-xl font-bold text-foreground mt-1 mb-1 leading-snug">
                    {t.step1_title}
                  </h2>
                  <p className="text-xs text-muted-foreground mb-4">{t.step1_subtitle}</p>

                  <div className="space-y-3.5">
                    <button
                      type="button"
                      onClick={() => handleVictimSelect(1)}
                      className={`w-full min-h-24 py-3 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-lg active:scale-[0.98] transition shadow-lg ${
                        state.victims === 1
                          ? "bg-danger-solid border-sev-red/40 text-solid-foreground "
                          : "bg-muted/90 border-border-strong text-foreground hover:border-border-strong"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="flex size-12 items-center justify-center rounded-xl bg-card/70 text-2xl font-bold text-sev-red border border-border-strong/80">
                          1
                        </span>
                        <span className="text-base text-start">{t.victims_1}</span>
                      </div>
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-card/60 text-muted-foreground border border-border-strong">
                        {t.solo}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleVictimSelect(2)}
                      className={`w-full min-h-24 py-3 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-lg active:scale-[0.98] transition shadow-lg ${
                        state.victims === 2
                          ? "bg-danger-solid border-sev-red/40 text-solid-foreground "
                          : "bg-muted/90 border-border-strong text-foreground hover:border-border-strong"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="flex size-12 items-center justify-center rounded-xl bg-card/70 text-2xl font-bold text-sev-yellow border border-border-strong/80">
                          2
                        </span>
                        <span className="text-base text-start">{t.victims_2}</span>
                      </div>
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-card/60 text-muted-foreground border border-border-strong">
                        {t.duo}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleVictimSelect(3)}
                      className={`w-full min-h-24 py-3 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-lg active:scale-[0.98] transition shadow-lg ${
                        state.victims === 3
                          ? "bg-danger-solid border-sev-red/40 text-solid-foreground "
                          : "bg-muted/90 border-border-strong text-foreground hover:border-border-strong"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="flex size-12 items-center justify-center rounded-xl bg-card/70 text-2xl font-bold text-sev-red border border-border-strong/80">
                          3+
                        </span>
                        <span className="text-base text-start">{t.victims_3plus}</span>
                      </div>
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-sev-red-soft text-sev-red border border-sev-red/40">
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
                  <h2 className="text-xl font-bold text-foreground mt-1 mb-1 leading-snug">
                    {t.step2_title}
                  </h2>
                  <p className="text-xs text-muted-foreground mb-4">{t.step2_subtitle}</p>

                  <div className="space-y-3.5">
                    <button
                      type="button"
                      onClick={() => handleConsciousSelect(1)}
                      className={`w-full h-20 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-base active:scale-[0.98] transition shadow-lg ${
                        state.conscious === 1
                          ? "bg-success-solid border-sev-green/40 text-solid-foreground "
                          : "bg-muted/90 border-border-strong text-foreground hover:border-border-strong"
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-sev-green-soft text-sev-green border border-sev-green/40">
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
                          ? "bg-danger-solid border-sev-red/40 text-solid-foreground "
                          : "bg-muted/90 border-border-strong text-foreground hover:border-border-strong"
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-sev-red-soft text-sev-red border border-sev-red/40">
                          <UserX className="size-6" />
                        </span>
                        <span>{t.conscious_no}</span>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-sev-red-soft text-sev-red border border-sev-red/40">
                        Critique
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleConsciousSelect(2)}
                      className={`w-full h-20 rounded-2xl border-2 flex items-center justify-between px-5 font-bold text-base active:scale-[0.98] transition shadow-lg ${
                        state.conscious === 2
                          ? "bg-warning-solid border-sev-yellow/40 text-solid-foreground "
                          : "bg-muted/90 border-border-strong text-foreground hover:border-border-strong"
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-sev-yellow-soft text-sev-yellow border border-sev-yellow/40">
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
                    className="w-full py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
                  >
                    {isRtl ? "→" : "←"} {t.back}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Danger (Multi-select) */}
            {state.step === 3 && (
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <h2 className="text-xl font-bold text-foreground mt-1 mb-1 leading-snug">
                    {t.step3_title}
                  </h2>
                  <p className="text-xs text-muted-foreground mb-3">{t.step3_subtitle}</p>

                  <div className="grid grid-cols-2 gap-2.5 mb-4">
                    <button
                      type="button"
                      onClick={() => handleDangerToggle("fire")}
                      className={`p-3.5 rounded-xl border-2 flex flex-col items-center justify-center text-center gap-2 active:scale-95 transition ${
                        state.dangers.includes("fire")
                          ? "bg-sev-red/30 border-sev-red/40 text-foreground shadow-md "
                          : "bg-muted/80 border-border-strong text-muted-foreground hover:border-border-strong"
                      }`}
                    >
                      <Flame
                        className={`size-6 ${
                          state.dangers.includes("fire") ? "text-sev-red" : "text-muted-foreground"
                        }`}
                      />
                      <span className="text-xs font-bold leading-tight">{t.danger_fire}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDangerToggle("trapped")}
                      className={`p-3.5 rounded-xl border-2 flex flex-col items-center justify-center text-center gap-2 active:scale-95 transition ${
                        state.dangers.includes("trapped")
                          ? "bg-sev-red/30 border-sev-red/40 text-foreground shadow-md "
                          : "bg-muted/80 border-border-strong text-muted-foreground hover:border-border-strong"
                      }`}
                    >
                      <AlertTriangle
                        className={`size-6 ${
                          state.dangers.includes("trapped") ? "text-sev-yellow" : "text-muted-foreground"
                        }`}
                      />
                      <span className="text-xs font-bold leading-tight">{t.danger_trapped}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDangerToggle("bleeding")}
                      className={`p-3.5 rounded-xl border-2 flex flex-col items-center justify-center text-center gap-2 active:scale-95 transition ${
                        state.dangers.includes("bleeding")
                          ? "bg-sev-red/30 border-sev-red/40 text-foreground shadow-md "
                          : "bg-muted/80 border-border-strong text-muted-foreground hover:border-border-strong"
                      }`}
                    >
                      <div
                        className={`size-6 rounded-full flex items-center justify-center font-bold text-xs ${
                          state.dangers.includes("bleeding")
                            ? "bg-danger-solid text-solid-foreground"
                            : "bg-accent text-muted-foreground"
                        }`}
                      >
                        <Droplet className="size-6" aria-hidden="true" />
                      </div>
                      <span className="text-xs font-bold leading-tight">{t.danger_bleeding}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDangerToggle("none")}
                      className={`p-3.5 rounded-xl border-2 flex flex-col items-center justify-center text-center gap-2 active:scale-95 transition ${
                        state.dangers.includes("none")
                          ? "bg-sev-green/30 border-sev-green/40 text-foreground shadow-md "
                          : "bg-muted/80 border-border-strong text-muted-foreground hover:border-border-strong"
                      }`}
                    >
                      <CheckCircle2
                        className={`size-6 ${
                          state.dangers.includes("none") ? "text-sev-green" : "text-muted-foreground"
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
                    disabled={isSubmitting}
                    className="w-full min-h-16 py-3 rounded-2xl bg-danger-solid hover:bg-danger-solid/90 text-solid-foreground font-bold text-base shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2 border-2 border-sev-red/40 disabled:opacity-50"
                  >
                    <ShieldAlert className="size-5" />
                    {isSubmitting
                      ? t.submitting
                      : forcedSms
                        ? t.sendSms
                        : t.submit_button}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SELECT_CONSCIOUS",
                        value: state.conscious ?? 1,
                      })
                    }
                    className="w-full py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition mt-1"
                  >
                    {isRtl ? "→" : "←"} {t.back}
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
                  <div className="flex items-center gap-2 text-sev-yellow mb-2">
                    <MapPin className="size-5" />
                    <span className="text-xs font-bold">
                      {t.gps_timeout}
                    </span>
                  </div>

                  <h2 className="text-2xl font-bold text-foreground mb-1">
                    {t.gps_timeout_prompt}
                  </h2>
                  <p className="text-xs text-muted-foreground mb-5">{t.gps_timeout_helper}</p>

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="witness-commune" className="block text-xs font-bold text-muted-foreground mb-1.5">
                        {t.commune_label}
                      </label>
                      <input
                        id="witness-commune" type="text"
                        required
                        value={communeInput}
                        onChange={(e) => setCommuneInput(e.target.value)}
                        placeholder={t.commune_placeholder}
                        className="w-full h-12 rounded-xl bg-muted border-2 border-border-strong px-4 text-sm font-semibold text-foreground placeholder-subtle-foreground focus-visible:border-brand"
                      />
                    </div>

                    <div>
                      <label htmlFor="witness-marker" className="block text-xs font-bold text-muted-foreground mb-1.5">
                        {t.pk_label}
                      </label>
                      <input
                        id="witness-marker" type="text"
                        required
                        value={pkInput}
                        onChange={(e) => setPkInput(e.target.value)}
                        placeholder={t.pk_placeholder}
                        className="w-full h-12 rounded-xl bg-muted border-2 border-border-strong px-4 text-sm font-semibold text-foreground placeholder-subtle-foreground focus-visible:border-brand"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full min-h-14 py-3 rounded-2xl bg-danger-solid hover:bg-danger-solid/90 text-solid-foreground font-bold text-sm shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2 border border-sev-red disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-5" />
                    {isSubmitting
                      ? t.submitting
                      : forcedSms
                        ? t.sendSms
                        : t.confirm_location_button}
                  </button>
                </div>
              </form>
            )}

            {/* Submitting state */}
            {state.step === "submitting" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="size-20 rounded-full bg-sev-red/20 border-2 border-sev-red/40 flex items-center justify-center mb-6 animate-pulse">
                  <ShieldAlert className="size-10 text-sev-red animate-spin" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{t.submitting}</h3>
                <p className="text-xs text-muted-foreground max-w-xs">
                  {t.sendingHelp}
                </p>
              </div>
            )}

            {/* Success screen */}
            {state.step === "submitted" && (
              <div className="flex-1 flex flex-col items-center justify-between text-center py-6">
                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="size-20 rounded-full bg-sev-green/20 border-2 border-sev-green/40 flex items-center justify-center mb-4">
                    <CheckCircle2 className="size-10 text-sev-green" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground mb-2">{t.success_title}</h3>
                  <p className="text-xs text-muted-foreground mb-6">{t.success_desc}</p>

                  <div className="w-full rounded-2xl bg-muted/80 border border-border-strong p-4 mb-4 text-start">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">{t.success_incident_id}</span>
                      <span dir="ltr" className="text-xs font-mono font-bold text-sev-green">
                        #{state.submissionResult?.incidentId.slice(0, 8).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{t.status}</span>
                      <span className="font-semibold text-foreground">
                        {state.submissionResult?.merged ? t.merged : t.open}
                      </span>
                    </div>
                  </div>

                  {/* SMS Ack Card (FR-S4-06) */}
                  {smsAck && (
                    <div className="w-full rounded-2xl bg-info-soft border border-info/80 p-3 mb-4 text-start">
                      <div className="flex items-center justify-between text-xs font-bold text-info mb-1.5">
                        <span className="flex items-center gap-1">
                          <MailCheck className="size-3.5" aria-hidden="true" /> {t.smsAck}
                        </span>
                        <span className="text-xs bg-info-soft text-foreground px-2 py-0.5 rounded border border-info/50">
                          {t.emulated}
                        </span>
                      </div>
                      <div dir="ltr" className="font-mono text-xs font-bold text-foreground bg-card/90 px-3 py-2 rounded-xl border border-info/50">
                        {smsAck}
                      </div>
                    </div>
                  )}

                  <p className="flex items-start gap-2 text-base text-sev-yellow bg-sev-yellow-soft border border-sev-yellow/60 rounded-md p-3 font-medium">
                    <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden="true" />
                    {t.success_stay_safe}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleReset}
                  className="w-full h-12 rounded-xl bg-muted hover:bg-accent text-foreground font-bold text-xs flex items-center justify-center gap-2 border border-border-strong active:scale-95 transition"
                >
                  <RotateCcw className="size-4" />
                  {t.new_report}
                </button>
              </div>
            )}

            {/* Error screen */}
            {state.step === "error" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="size-16 rounded-full bg-sev-red/20 border-2 border-sev-red/40 flex items-center justify-center mb-4">
                  <AlertTriangle className="size-8 text-sev-red" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{t.error_title}</h3>
                <p className="text-xs text-sev-red mb-6">{t.transmissionError}</p>

                <button
                  type="button"
                  onClick={handleProceedSubmit}
                  className="w-full h-12 rounded-xl bg-danger-solid hover:bg-danger-solid/90 text-solid-foreground font-bold text-xs flex items-center justify-center gap-2 shadow-lg"
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
                className={`absolute inset-0 z-50 overflow-y-auto flex flex-col justify-between p-6 ${
                  crashState.status === "cancelled"
                    ? "bg-background/95"
                    : crashState.status === "sent"
                      ? "bg-brand-soft"
                      : "bg-sev-red-soft"
                } backdrop-blur-md transition-colors animate-in fade-in duration-200`}
              >
                {crashState.status === "countdown" && (
                  <div className="flex flex-col items-center justify-between h-full py-4 text-center">
                    <div className="flex flex-col items-center">
                      <span className="px-3 py-1 rounded-full bg-danger-solid text-solid-foreground font-bold text-xs border border-sev-red animate-pulse shadow-lg mb-2">
                        {crash.detected}
                      </span>
                      
                    </div>

                    <div className="flex flex-col items-center my-6">
                      <div className="relative size-44 rounded-full bg-danger-solid border-4 border-border-strong flex flex-col items-center justify-center shadow-2xl animate-pulse">
                        <span
                          data-testid="countdown-timer-value"
                          className="text-7xl font-bold text-foreground tracking-tighter leading-none"
                        >
                          {crashState.secondsRemaining}
                        </span>
                        <span className="text-xs font-bold text-foreground mt-1">
                          {crash.seconds}
                        </span>
                      </div>
                      <p className="text-xs text-foreground mt-4 max-w-[280px]">
                        {crash.helper}{" "}
                        <strong className="text-foreground font-bold">{crashState.secondsRemaining} {t.seconds}</strong>.
                      </p>
                    </div>

                    {/* Giant Cancel Button (PRD FR-S4-01: "{crash.cancel}") */}
                    <div className="w-full flex flex-col items-center gap-3">
                      <button
                        type="button"
                        data-testid="cancel-crash-button"
                        onClick={() => crashDispatch({ type: "CANCEL" })}
                        className="w-full py-5 px-4 rounded-2xl bg-card hover:bg-accent text-sev-red font-bold text-xl shadow-lg active:scale-95 transition border-2 border-sev-red flex flex-col items-center justify-center gap-1 cursor-pointer"
                      >
                        <Hand className="size-7" aria-hidden="true" />
                        <span>{crash.cancel}</span>
                        
                      </button>

                      {crashState.simulated && (
                        <span className="text-xs text-sev-red/80 font-medium bg-background/30 px-2.5 py-0.5 rounded-md">
                          {crash.simulated}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {crashState.status === "cancelled" && (
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="size-16 rounded-full bg-sev-green-soft border-2 border-sev-green text-sev-green flex items-center justify-center mb-4">
                      <CheckCircle2 className="size-8" aria-hidden="true" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-1">{crash.cancelled}</h3>
                    
                    <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed mb-6">
                      {crash.cancelledHelp}
                    </p>
                    <button
                      type="button"
                      onClick={() => crashDispatch({ type: "RESET" })}
                      className="w-full py-3 rounded-xl bg-info-solid hover:bg-info-solid/90 text-solid-foreground font-bold text-xs active:scale-95 transition cursor-pointer"
                    >
                      {crash.home}
                    </button>
                  </div>
                )}

                {(crashState.status === "sending" || crashState.status === "expired") && (
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="size-16 rounded-full bg-sev-red-soft border-2 border-sev-red text-sev-red flex items-center justify-center mb-4">
                      <SatelliteDish className="size-8" aria-hidden="true" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-1">{crash.sending}</h3>
                    
                    <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
                      {crash.sendingHelp}
                    </p>
                  </div>
                )}

                {crashState.status === "error" && (
                  <div role="alert" className="flex flex-col items-center justify-center h-full text-center p-4 gap-4">
                    <h3 className="text-xl font-bold text-foreground">{crash.error}</h3>
                    <p className="text-sm text-muted-foreground">{crash.errorHelp}</p>
                    <button type="button" onClick={() => crashDispatch({ type: "RESET" })}
                      className="w-full p-3 rounded-xl bg-info-solid text-solid-foreground font-bold">
                      {crash.home}
                    </button>
                  </div>
                )}
                {crashState.status === "sent" && (
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="size-16 rounded-full bg-brand-soft border-2 border-brand text-brand-soft-foreground flex items-center justify-center mb-4">
                      <Siren className="size-8" aria-hidden="true" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-1">{crash.sent}</h3>
                    
                    <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed mb-6">
                      {crash.sentHelp}
                    </p>
                    <button
                      type="button"
                      onClick={() => crashDispatch({ type: "RESET" })}
                      className="w-full py-3 rounded-xl bg-primary-action hover:bg-primary-hover text-solid-foreground font-bold text-xs active:scale-95 transition cursor-pointer"
                    >
                      {crash.done}
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
