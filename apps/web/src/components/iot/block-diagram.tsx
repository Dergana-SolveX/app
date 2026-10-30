import { useId } from "react";
import type { ChipState } from "@solvex-dergana/shared";
import { BatteryChargingIcon, CpuIcon, ActivityIcon, NavigationIcon, RadioIcon, WifiIcon } from "lucide-react";

export type ActiveBlocks = {
  power: boolean;
  mcu: boolean;
  sensors: boolean;
  gnss: boolean;
  modem: boolean;
  antenna: boolean;
};

export function getActiveBlocks(state: ChipState): ActiveBlocks {
  const isBoot = state === "BOOT";
  const isArmed = state === "ARMED";
  const isImpact = state === "IMPACT";
  const isConfirm = state === "CONFIRM";
  const isSend = state === "SEND";
  const isAwaitAck = state === "AWAIT_ACK";
  const isDone = state === "DONE";

  return {
    power: true,
    mcu: true,
    sensors: isArmed || isImpact || isConfirm || isSend,
    gnss: isArmed || isImpact || isConfirm || isSend,
    modem: isBoot || isSend || isAwaitAck,
    antenna: isSend || isAwaitAck,
  };
}

export function getActiveAtCommand({
  state,
  channel,
  attempt = 1,
}: {
  state: ChipState;
  channel: "http" | "sms";
  attempt?: number;
}): string {
  if (state === "BOOT" || state === "ARMED") {
    return "AT+CSQ"; // Signal quality interrogation
  }
  if (state === "SEND") {
    return channel === "sms" ? 'AT+CMGS="+2135550100"' : "AT+HTTPACTION=1";
  }
  if (state === "AWAIT_ACK") {
    return channel === "sms" ? "AT+CMGL" : "AT+HTTPREAD";
  }
  return "IDLE";
}

export function BlockDiagram({
  state,
  channel = "http",
  peakG = 0,
  rollDeg = 0,
  pitchDeg = 0,
}: {
  state: ChipState;
  channel?: "http" | "sms";
  peakG?: number;
  rollDeg?: number;
  pitchDeg?: number;
}) {
  const diagramId = useId();
  const active = getActiveBlocks(state);
  const atCommand = getActiveAtCommand({ state, channel });

  return (
    <section aria-labelledby="block-diagram-title" className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="mb-3 flex items-center justify-between border-b pb-2">
        <div>
          <h2 id="block-diagram-title" className="text-sm font-bold tracking-tight">
            Schéma Bloc Matériel
          </h2>
          <p className="text-xs text-muted-foreground" dir="rtl">
            المخطط الهيكلي للعتاد والمكونات
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">État MCU :</span>
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
            {state}
          </span>
        </div>
      </div>

      <div className="relative w-full overflow-hidden rounded-md border border-border/50 bg-slate-950/80 p-3">
        {/* SVG Wiring Connections */}
        <svg className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
          <defs>
            <linearGradient id={`${diagramId}-bus`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.8" />
            </linearGradient>
          </defs>
          {/* Signal Bus connecting blocks to MCU */}
          <line
            x1="18%"
            y1="50%"
            x2="50%"
            y2="50%"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={active.sensors ? "4 2" : "none"}
            className={active.sensors ? "text-emerald-400 animate-[dash_1s_linear_infinite]" : "text-slate-800"}
          />
          <line
            x1="50%"
            y1="50%"
            x2="82%"
            y2="50%"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={active.modem ? "4 2" : "none"}
            className={active.modem ? "text-amber-400 animate-[dash_1s_linear_infinite]" : "text-slate-800"}
          />
        </svg>

        <div className="relative z-10 grid grid-cols-1 gap-3 sm:grid-cols-5">
          {/* Block 1: Power Supply */}
          <div
            className={`flex flex-col justify-between rounded-md border p-2.5 transition-all ${
              active.power ? "border-emerald-500/50 bg-emerald-950/30" : "border-slate-800 bg-slate-900/50"
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <BatteryChargingIcon className={`h-4 w-4 ${active.power ? "text-emerald-400" : "text-muted-foreground"}`} />
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              </div>
              <div className="mt-2 text-xs font-bold text-foreground">Alimentation</div>
              <div className="text-[10px] text-muted-foreground" dir="rtl">تغذية الطاقة</div>
            </div>
            <div className="mt-2 text-[10px] font-mono text-emerald-300">
              12V ➔ 3.8V DC-DC<br />
              <span className="text-muted-foreground">LiPo 1200mAh</span>
            </div>
          </div>

          {/* Block 2: Sensors & IMU */}
          <div
            className={`flex flex-col justify-between rounded-md border p-2.5 transition-all ${
              active.sensors ? "border-cyan-500/60 bg-cyan-950/30 ring-1 ring-cyan-500/20" : "border-slate-800 bg-slate-900/50"
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <ActivityIcon className={`h-4 w-4 ${active.sensors ? "text-cyan-400 animate-pulse" : "text-muted-foreground"}`} />
                <span className={`text-[10px] font-mono ${active.sensors ? "text-cyan-400 font-bold" : "text-muted-foreground"}`}>
                  I2C/SPI
                </span>
              </div>
              <div className="mt-2 text-xs font-bold text-foreground">IMU LSM6DSOX</div>
              <div className="text-[10px] text-muted-foreground" dir="rtl">مستشعر الصدمات</div>
            </div>
            <div className="mt-2 text-[10px] font-mono text-cyan-300">
              Choc : {peakG.toFixed(1)} g<br />
              <span className="text-muted-foreground">Tilt : {Math.abs(rollDeg).toFixed(0)}°</span>
            </div>
          </div>

          {/* Block 3: Central MCU */}
          <div
            className={`flex flex-col justify-between rounded-md border p-2.5 transition-all ${
              active.mcu ? "border-primary/60 bg-primary/10 shadow-[0_0_15px_rgba(59,130,246,0.15)] ring-1 ring-primary/30" : "border-slate-800 bg-slate-900/50"
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <CpuIcon className={`h-4 w-4 ${active.mcu ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
                <span className="rounded bg-primary/20 px-1 py-0.2 text-[9px] font-mono text-primary">
                  FreeRTOS
                </span>
              </div>
              <div className="mt-2 text-xs font-bold text-foreground">MCU ESP32-S3</div>
              <div className="text-[10px] text-muted-foreground" dir="rtl">المعالج المركزي</div>
            </div>
            <div className="mt-2 text-[10px] font-mono text-primary-foreground/90">
              240 MHz Dual-Core<br />
              <span className="text-emerald-400">État : {state}</span>
            </div>
          </div>

          {/* Block 4: GNSS / GPS */}
          <div
            className={`flex flex-col justify-between rounded-md border p-2.5 transition-all ${
              active.gnss ? "border-indigo-500/60 bg-indigo-950/30" : "border-slate-800 bg-slate-900/50"
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <NavigationIcon className={`h-4 w-4 ${active.gnss ? "text-indigo-400" : "text-muted-foreground"}`} />
                <span className={`text-[9px] font-mono ${active.gnss ? "text-indigo-300" : "text-muted-foreground"}`}>
                  UART 9600
                </span>
              </div>
              <div className="mt-2 text-xs font-bold text-foreground">GNSS NEO-M8N</div>
              <div className="text-[10px] text-muted-foreground" dir="rtl">تحديد الموقع GPS</div>
            </div>
            <div className="mt-2 text-[10px] font-mono text-indigo-300">
              Fix 3D (Alger)<br />
              <span className="text-muted-foreground">36.75°N, 3.05°E</span>
            </div>
          </div>

          {/* Block 5: Modem GSM & Antenna */}
          <div
            className={`flex flex-col justify-between rounded-md border p-2.5 transition-all ${
              active.modem ? "border-amber-500/70 bg-amber-950/30 ring-1 ring-amber-500/30" : "border-slate-800 bg-slate-900/50"
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <RadioIcon className={`h-4 w-4 ${active.modem ? "text-amber-400" : "text-muted-foreground"}`} />
                {active.antenna ? (
                  <WifiIcon className="h-4 w-4 text-amber-400 animate-ping" />
                ) : (
                  <WifiIcon className="h-4 w-4 text-muted-foreground opacity-40" />
                )}
              </div>
              <div className="mt-2 text-xs font-bold text-foreground">Modem SIM800L</div>
              <div className="text-[10px] text-muted-foreground" dir="rtl">مودم الاتصال الخلوي</div>
            </div>
            <div className="mt-2 rounded bg-black/50 p-1 font-mono text-[10px] text-amber-300 truncate">
              {atCommand}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
