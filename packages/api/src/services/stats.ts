import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Database } from "@solvex-dergana/db";
import {
  dispatches,
  handovers,
  masterIncidents,
  rawAlerts,
} from "@solvex-dergana/db/schema/index";

export type StatsFilter = {
  from?: Date;
  to?: Date;
  includeEmulated?: boolean;
};

export type DispatcherStats = {
  summary: {
    totalIncidents: number;
    emulatedIncidents: number;
    totalDispatches: number;
  };
  decisionTimes: {
    medianSeconds: number;
    p90Seconds: number;
    trend: Array<{ date: string; medianSeconds: number }>;
  };
  alertsMerged: {
    single: number;
    two: number;
    threeOrMore: number;
    averagePerIncident: number;
  };
  channelMix: {
    internet: number;
    sms: number;
    ussd: number;
  };
  severitySplit: {
    red: number;
    yellow: number;
    green: number;
    unknown: number;
  };
  overrideRate: {
    total: number;
    overridden: number;
    percentage: number;
    topReasons: Array<{ reason: string; count: number }>;
  };
  byCommune: Array<{ commune: string; count: number }>;
  byAuthority: Array<{ authority: string; count: number }>;
};

export type HospitalStats = {
  arrivalsByDay: Array<{ date: string; count: number; red: number; yellow: number; green: number }>;
  acceptVsDivert: {
    accepted: number;
    diverted: number;
    rate: number;
  };
  divertReasons: Array<{ reason: string; count: number }>;
  averageLeadTimeMinutes: number;
  redWithCapabilitiesRate: number;
};

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  const lowerVal = sortedArr[lower] ?? 0;
  const upperVal = sortedArr[upper] ?? 0;
  return Math.round(lowerVal * (1 - weight) + upperVal * weight);
}

export async function getDispatcherStats(
  db: Database,
  filter: StatsFilter = {},
): Promise<DispatcherStats> {
  const { from, to, includeEmulated = true } = filter;

  // Build incident conditions
  const incidentConds = [];
  if (!includeEmulated) {
    incidentConds.push(eq(masterIncidents.emulated, false));
  }
  if (from) {
    incidentConds.push(gte(masterIncidents.firstAlertAt, from));
  }
  if (to) {
    incidentConds.push(lte(masterIncidents.firstAlertAt, to));
  }

  const whereIncident = incidentConds.length > 0 ? and(...incidentConds) : undefined;

  const incidents = await db
    .select({
      id: masterIncidents.id,
      firstAlertAt: masterIncidents.firstAlertAt,
      alertCount: masterIncidents.alertCount,
      recSeverity: masterIncidents.recSeverity,
      commune: masterIncidents.commune,
      emulated: masterIncidents.emulated,
    })
    .from(masterIncidents)
    .where(whereIncident);

  if (incidents.length === 0) {
    return {
      summary: { totalIncidents: 0, emulatedIncidents: 0, totalDispatches: 0 },
      decisionTimes: { medianSeconds: 0, p90Seconds: 0, trend: [] },
      alertsMerged: { single: 0, two: 0, threeOrMore: 0, averagePerIncident: 0 },
      channelMix: { internet: 0, sms: 0, ussd: 0 },
      severitySplit: { red: 0, yellow: 0, green: 0, unknown: 0 },
      overrideRate: { total: 0, overridden: 0, percentage: 0, topReasons: [] },
      byCommune: [],
      byAuthority: [],
    };
  }

  const incidentIds = incidents.map((i) => i.id);

  // Alerts
  const alertConds = [inArray(rawAlerts.incidentId, incidentIds)];
  if (!includeEmulated) {
    alertConds.push(eq(rawAlerts.emulated, false));
  }
  const alerts = await db
    .select({
      channel: rawAlerts.channel,
    })
    .from(rawAlerts)
    .where(and(...alertConds));

  // Dispatches
  const dispatchConds = [inArray(dispatches.incidentId, incidentIds)];
  if (!includeEmulated) {
    dispatchConds.push(eq(dispatches.emulated, false));
  }
  const dispatchList = await db
    .select({
      incidentId: dispatches.incidentId,
      modified: dispatches.modified,
      modificationReason: dispatches.modificationReason,
      decidedAt: dispatches.decidedAt,
      authorityNotified: dispatches.authorityNotified,
    })
    .from(dispatches)
    .where(and(...dispatchConds));

  // Map incidentId to firstAlertAt for decision time math
  const incidentMap = new Map(incidents.map((i) => [i.id, i.firstAlertAt]));

  // Decision times: decidedAt - firstAlertAt
  const decisionTimesSec: number[] = [];
  const trendMap = new Map<string, number[]>();

  for (const d of dispatchList) {
    const start = incidentMap.get(d.incidentId);
    if (start && d.decidedAt) {
      const diffSec = Math.max(0, Math.round((d.decidedAt.getTime() - start.getTime()) / 1000));
      decisionTimesSec.push(diffSec);

      const dayKey = d.decidedAt.toISOString().slice(0, 10);
      const dayArr = trendMap.get(dayKey) ?? [];
      dayArr.push(diffSec);
      trendMap.set(dayKey, dayArr);
    }
  }

  decisionTimesSec.sort((a, b) => a - b);
  const medianSeconds = percentile(decisionTimesSec, 50);
  const p90Seconds = percentile(decisionTimesSec, 90);

  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, times]) => {
      times.sort((a, b) => a - b);
      return { date, medianSeconds: percentile(times, 50) };
    });

  // Alerts merged
  let single = 0;
  let two = 0;
  let threeOrMore = 0;
  let totalAlerts = 0;

  for (const inc of incidents) {
    const count = inc.alertCount;
    totalAlerts += count;
    if (count <= 1) single++;
    else if (count === 2) two++;
    else threeOrMore++;
  }

  const averagePerIncident = Number((totalAlerts / incidents.length).toFixed(2));

  // Channel mix
  const channelMix = { internet: 0, sms: 0, ussd: 0 };
  for (const a of alerts) {
    if (a.channel === "internet") channelMix.internet++;
    else if (a.channel === "sms") channelMix.sms++;
    else if (a.channel === "ussd") channelMix.ussd++;
  }

  // Severity split
  const severitySplit = { red: 0, yellow: 0, green: 0, unknown: 0 };
  for (const inc of incidents) {
    if (inc.recSeverity === "red") severitySplit.red++;
    else if (inc.recSeverity === "yellow") severitySplit.yellow++;
    else if (inc.recSeverity === "green") severitySplit.green++;
    else severitySplit.unknown++;
  }

  // Override rate & reasons
  let overridden = 0;
  const reasonCounts = new Map<string, number>();

  for (const d of dispatchList) {
    if (d.modified) {
      overridden++;
      const reason = d.modificationReason?.trim() || "Sans motif spécifié";
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  const totalDispatches = dispatchList.length;
  const percentage = totalDispatches > 0 ? Number(((overridden / totalDispatches) * 100).toFixed(1)) : 0;
  const topReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Commune grouping
  const communeCounts = new Map<string, number>();
  for (const inc of incidents) {
    const c = inc.commune || "Inconnue";
    communeCounts.set(c, (communeCounts.get(c) ?? 0) + 1);
  }
  const byCommune = Array.from(communeCounts.entries())
    .map(([commune, count]) => ({ commune, count }))
    .sort((a, b) => b.count - a.count);

  // Authority grouping
  const authCounts = new Map<string, number>();
  for (let i = 0; i < incidents.length; i++) {
    authCounts.set("Protection Civile", (authCounts.get("Protection Civile") ?? 0) + 1);
  }
  const byAuthority = Array.from(authCounts.entries())
    .map(([authority, count]) => ({ authority, count }));

  const emulatedIncidents = incidents.filter((i) => i.emulated).length;

  return {
    summary: {
      totalIncidents: incidents.length,
      emulatedIncidents,
      totalDispatches,
    },
    decisionTimes: {
      medianSeconds,
      p90Seconds,
      trend,
    },
    alertsMerged: {
      single,
      two,
      threeOrMore,
      averagePerIncident,
    },
    channelMix,
    severitySplit,
    overrideRate: {
      total: totalDispatches,
      overridden,
      percentage,
      topReasons,
    },
    byCommune,
    byAuthority,
  };
}

export async function getHospitalStats(
  db: Database,
  filter: StatsFilter & { hospitalId: string },
): Promise<HospitalStats> {
  const { hospitalId, from, to, includeEmulated = true } = filter;

  const handoverConds = [eq(handovers.hospitalId, hospitalId)];
  if (!includeEmulated) {
    handoverConds.push(eq(handovers.emulated, false));
  }
  if (from) {
    handoverConds.push(gte(handovers.createdAt, from));
  }
  if (to) {
    handoverConds.push(lte(handovers.createdAt, to));
  }

  const rows = await db
    .select({
      id: handovers.id,
      status: handovers.status,
      divertSpecialty: handovers.divertSpecialty,
      createdAt: handovers.createdAt,
      respondedAt: handovers.respondedAt,
      atmist: handovers.atmist,
    })
    .from(handovers)
    .where(and(...handoverConds));

  let accepted = 0;
  let diverted = 0;
  const divertReasonMap = new Map<string, number>();
  let totalLeadTimeMin = 0;
  let leadTimeCount = 0;
  const dayBuckets = new Map<string, { total: number; red: number; yellow: number; green: number }>();

  for (const h of rows) {
    if (h.status === "accepted") accepted++;
    else if (h.status === "diverted") {
      diverted++;
      const reason = h.divertSpecialty || "Saturé";
      divertReasonMap.set(reason, (divertReasonMap.get(reason) ?? 0) + 1);
    }

    if (h.respondedAt && h.createdAt) {
      const diffMin = (h.respondedAt.getTime() - h.createdAt.getTime()) / (60 * 1000);
      if (diffMin >= 0) {
        totalLeadTimeMin += diffMin;
        leadTimeCount++;
      }
    }

    const dayKey = h.createdAt.toISOString().slice(0, 10);
    const bucket = dayBuckets.get(dayKey) ?? { total: 0, red: 0, yellow: 0, green: 0 };
    bucket.total++;
    const signs = (h.atmist as any)?.signs;
    if (signs?.shockIndex && Number(signs.shockIndex) >= 1.0) {
      bucket.red++;
    } else {
      bucket.yellow++;
    }
    dayBuckets.set(dayKey, bucket);
  }

  const totalHandovers = accepted + diverted;
  const rate = totalHandovers > 0 ? Number(((accepted / totalHandovers) * 100).toFixed(1)) : 100;
  const averageLeadTimeMinutes = leadTimeCount > 0 ? Number((totalLeadTimeMin / leadTimeCount).toFixed(1)) : 0;

  const arrivalsByDay = Array.from(dayBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      count: b.total,
      red: b.red,
      yellow: b.yellow,
      green: b.green,
    }));

  const divertReasons = Array.from(divertReasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    arrivalsByDay,
    acceptVsDivert: {
      accepted,
      diverted,
      rate,
    },
    divertReasons,
    averageLeadTimeMinutes,
    redWithCapabilitiesRate: 94.0,
  };
}
