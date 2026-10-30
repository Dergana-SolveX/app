import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Radio,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Wifi,
  Battery,
  Signal,
  ArrowRight,
  Layers,
  Sparkles,
} from "lucide-react";
import {
  formatCellId,
  getOperatorInfo,
  SURVEY_PRESETS_DZ,
  type CurrentCellInfo,
} from "@solvex-dergana/shared";
import { trpc } from "@/utils/trpc";

type Props = {
  initialCoords?: { lat: number; lng: number; accuracyM: number };
};

export default function CellSurveyFrame({
  initialCoords = { lat: 36.7538, lng: 3.0588, accuracyM: 4.5 },
}: Props) {
  const [activePreset, setActivePreset] = useState<CurrentCellInfo>(SURVEY_PRESETS_DZ[0]!);
  const [mcc, setMcc] = useState(String(activePreset.mcc));
  const [mnc, setMnc] = useState(String(activePreset.mnc));
  const [lac, setLac] = useState(String(activePreset.lac));
  const [cid, setCid] = useState(String(activePreset.cid));
  const [isContinuous, setIsContinuous] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const operator = getOperatorInfo(
    Number.parseInt(mcc, 10) || 603,
    Number.parseInt(mnc, 10) || 1,
  );

  const logSurveyMutation = useMutation(
    trpc.cells.logSurvey.mutationOptions({
      onSuccess: () => {
        setStatusMessage("Point enregistré avec succès dans cell_towers (source='survey')");
        void surveysQuery.refetch();
        setTimeout(() => setStatusMessage(null), 3500);
      },
      onError: (err) => {
        setStatusMessage(`Erreur: ${err.message}`);
        setTimeout(() => setStatusMessage(null), 4000);
      },
    }),
  );

  const surveysQuery = useQuery(
    trpc.cells.listSurveys.queryOptions({ limit: 10 }),
  );

  const handleSelectPreset = (p: CurrentCellInfo) => {
    setActivePreset(p);
    setMcc(String(p.mcc));
    setMnc(String(p.mnc));
    setLac(String(p.lac));
    setCid(String(p.cid));
  };

  const handleLog = async () => {
    const numMcc = Number.parseInt(mcc, 10);
    const numMnc = Number.parseInt(mnc, 10);
    const numLac = Number.parseInt(lac, 10);
    const numCid = Number.parseInt(cid, 10);

    if (!numMcc || !numMnc || !numLac || !numCid) return;

    await logSurveyMutation.mutateAsync({
      mcc: numMcc,
      mnc: numMnc,
      lac: numLac,
      cid: numCid,
      lat: initialCoords.lat,
      lng: initialCoords.lng,
      rangeM: 800,
      signalDbm: activePreset.signalDbm ?? -75,
    });
  };

  return (
    <div className="relative mx-auto w-[380px] max-w-full rounded-[44px] border-[6px] border-slate-800 bg-slate-950 p-3 shadow-[0_0_60px_rgba(0,0,0,0.8)] ring-1 ring-slate-700/50">
      {/* Dynamic Island / Notch */}
      <div className="relative mx-auto mb-2 flex h-5 w-32 items-center justify-center rounded-full bg-slate-900 border border-slate-800">
        <span className="size-2 rounded-full bg-slate-800 mr-2" />
        <span className="size-2.5 rounded-full bg-slate-950 border border-slate-700" />
      </div>

      {/* Screen Frame */}
      <div className="flex h-[680px] flex-col justify-between overflow-y-auto rounded-[32px] bg-slate-950 p-4 text-slate-100 select-none">
        {/* Top Status Bar */}
        <div>
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-slate-800/80 pb-2">
            <span className="font-semibold text-slate-200">14:02</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-emerald-400">4G LTE</span>
              <Signal className="size-3 text-emerald-400" />
              <Wifi className="size-3 text-slate-300" />
              <Battery className="size-3 text-slate-300" />
            </div>
          </div>

          {/* Header */}
          <div className="mt-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <Radio className="size-4 text-sky-400" />
                <h1 className="text-sm font-bold text-white tracking-tight">
                  Relevé Réseau (Survey)
                </h1>
              </div>
              <p className="text-[10px] text-slate-400" dir="rtl">
                مسح وتسجيل أبراج التغطية الخلوية
              </p>
            </div>
            <span className="rounded-full border border-sky-500/30 bg-sky-950/60 px-2 py-0.5 text-[9px] font-mono font-bold text-sky-400 uppercase">
              SOURCE = SURVEY
            </span>
          </div>

          {/* Operator Preset Selector */}
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {SURVEY_PRESETS_DZ.map((p) => {
              const op = getOperatorInfo(p.mcc, p.mnc);
              const isSelected = activePreset.mcc === p.mcc && activePreset.mnc === p.mnc;
              return (
                <button
                  type="button"
                  key={`${p.mcc}-${p.mnc}`}
                  onClick={() => handleSelectPreset(p)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-bold transition ${
                    isSelected
                      ? "border-sky-400 bg-sky-950/60 text-sky-300"
                      : "border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-900"
                  }`}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: op.brandColor }} />
                  <span>{op.name}</span>
                </button>
              );
            })}
          </div>

          {/* Serving Cell Parameter Card */}
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: operator.brandColor }} />
                <span className="text-xs font-bold text-white">{operator.name}</span>
                <span className="text-[10px] text-slate-400" dir="rtl">({operator.nameAr})</span>
              </div>
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                {activePreset.signalDbm ?? -75} dBm
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-4 gap-1.5 text-center">
              <div>
                <label className="block text-[9px] font-mono text-slate-400">MCC</label>
                <input
                  type="text"
                  value={mcc}
                  onChange={(e) => setMcc(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-1 text-center font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-slate-400">MNC</label>
                <input
                  type="text"
                  value={mnc}
                  onChange={(e) => setMnc(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-1 text-center font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-slate-400">LAC</label>
                <input
                  type="text"
                  value={lac}
                  onChange={(e) => setLac(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-1 text-center font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-slate-400">CID</label>
                <input
                  type="text"
                  value={cid}
                  onChange={(e) => setCid(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 p-1 text-center font-mono text-xs text-white"
                />
              </div>
            </div>
          </div>

          {/* GPS Coordinates Card */}
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                <MapPin className="size-3.5 text-sky-400" />
                <span>Position GPS Relevée</span>
              </div>
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-400 border border-emerald-500/20">
                FIX 3D (±{initialCoords.accuracyM}m)
              </span>
            </div>
            <div className="mt-2 flex justify-between rounded bg-slate-950 p-2 font-mono text-xs">
              <div>
                <span className="block text-[9px] text-slate-500">Latitude</span>
                <span className="font-bold text-slate-200">{initialCoords.lat.toFixed(5)}°N</span>
              </div>
              <div>
                <span className="block text-[9px] text-slate-500">Longitude</span>
                <span className="font-bold text-slate-200">{initialCoords.lng.toFixed(5)}°E</span>
              </div>
            </div>
          </div>

          {/* Notification Feedback Banner */}
          {statusMessage && (
            <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-950/60 p-2 text-xs text-sky-300">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
              <span className="truncate text-[11px]">{statusMessage}</span>
            </div>
          )}
        </div>

        {/* Bottom Actions & History */}
        <div className="space-y-2.5 pt-2">
          {/* Continuous Mode Toggle */}
          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-300 font-medium">
              <Layers className="size-3.5 text-sky-400" />
              <span>Relevé continu (&gt;50m)</span>
            </div>
            <input
              type="checkbox"
              checked={isContinuous}
              onChange={(e) => setIsContinuous(e.target.checked)}
              className="size-4 accent-sky-500"
            />
          </div>

          {/* Primary CTA */}
          <button
            type="button"
            onClick={handleLog}
            disabled={logSurveyMutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-xs font-bold text-white shadow-lg shadow-sky-950/50 hover:bg-sky-500 active:scale-[0.99] transition disabled:opacity-60"
          >
            <Radio className="size-4" />
            <span>
              {logSurveyMutation.isPending
                ? "Enregistrement..."
                : "Enregistrer ce Relais (Survey Point)"}
            </span>
          </button>

          {/* Server Survey History Snippet */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-950 p-2 text-[10px]">
            <div className="mb-1.5 flex items-center justify-between text-slate-400 font-bold border-b border-slate-900 pb-1">
              <span>Relais Recensés (Serveur)</span>
              <span className="font-mono text-sky-400">{surveysQuery.data?.length ?? 0}</span>
            </div>
            <div className="max-h-24 overflow-y-auto space-y-1">
              {surveysQuery.data?.slice(0, 4).map((t, i) => (
                <div
                  key={`${t.mcc}-${t.mnc}-${t.lac}-${t.cid}-${i}`}
                  className="flex items-center justify-between text-slate-400 font-mono text-[9px]"
                >
                  <span className="text-slate-300">{formatCellId(t)}</span>
                  <span className="text-emerald-400 font-semibold">SYNCHRONISÉ ✓</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
