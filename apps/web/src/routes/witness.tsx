import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, PhoneCall, Radio, ShieldAlert } from "lucide-react";
import React, { useState } from "react";

import CellSurveyFrame from "@/components/survey/cell-survey-frame";
import WitnessPhoneFrame from "@/components/witness/witness-phone-frame";

export const Route = createFileRoute("/witness")({
  component: WitnessRoute,
});

function WitnessRoute() {
  const [activeTab, setActiveTab] = useState<"witness" | "survey">("witness");

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex flex-col justify-between selection:bg-red-500 selection:text-white">
      {/* Top Banner */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 px-6 py-3.5 backdrop-blur-md flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition px-2.5 py-1.5 rounded-lg hover:bg-slate-800"
          >
            <ArrowLeft className="size-3.5" />
            <span>Portail</span>
          </Link>
          <div className="h-4 w-px bg-slate-800" />
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-red-600 text-white font-bold text-xs">
              <ShieldAlert className="size-3.5" />
            </span>
            <span className="text-sm font-bold tracking-tight text-white">
              SVX Rescue — Miroir Téléphone App
            </span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              FR-S4-08 / FR-S4-09
            </span>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/80 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("witness")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${
              activeTab === "witness"
                ? "bg-red-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <ShieldAlert className="size-3.5" />
            <span>Alerte Témoin (3-Tap)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("survey")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${
              activeTab === "survey"
                ? "bg-sky-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Radio className="size-3.5" />
            <span>Relevé Réseau (Survey)</span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5 font-medium">
            <PhoneCall className="size-3.5 text-red-500" />
            Numéro d'urgence : <strong className="text-slate-200">14 / 154</strong>
          </span>
        </div>
      </header>

      {/* Main Presentation View */}
      <main className="flex-1 flex items-center justify-center py-6 px-4">
        {activeTab === "witness" ? <WitnessPhoneFrame /> : <CellSurveyFrame />}
      </main>

      {/* Footer Info */}
      <footer className="border-t border-slate-900 bg-slate-950/50 py-3 text-center text-xs text-slate-500">
        SVX Rescue • Détection et réponse aux urgences routières • Démonstration Jury & Stand
      </footer>
    </div>
  );
}
