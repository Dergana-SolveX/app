import React, { useEffect, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createSurveyManager,
  formatCellId,
  getOperatorInfo,
  SURVEY_PRESETS_DZ,
  type CurrentCellInfo,
  type CurrentGpsFix,
  type SurveyPoint,
} from "@solvex-dergana/shared";
import { trpc } from "@/utils/trpc";

export function CellSurvey() {
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // Sync mutation
  const logSurveyMutation = useMutation(
    trpc.cells.logSurvey.mutationOptions({
      onSuccess: (res) => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      },
      onError: (err) => {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
      },
    }),
  );

  // Fetch recent surveys from server
  const surveysQuery = useQuery(trpc.cells.listSurveys.queryOptions({ limit: 30 }));

  const syncPoint = async (logged: SurveyPoint) => {
    try {
      await logSurveyMutation.mutateAsync({
        mcc: logged.mcc,
        mnc: logged.mnc,
        lac: logged.lac,
        cid: logged.cid,
        lat: logged.lat,
        lng: logged.lng,
        rangeM: 800,
        signalDbm: logged.signalDbm,
      });
      managerRef.current.markSynced(logged.id);
      void surveysQuery.refetch();
      forceUpdate();
    } catch {
      // Keeps point as pending in local history
    }
  };

  const managerRef = useRef(
    createSurveyManager({
      autoDistanceM: 50,
      onAutoLog: (point) => void syncPoint(point),
    }),
  );

  const [activeCell, setActiveCell] = useState<CurrentCellInfo>(SURVEY_PRESETS_DZ[0]!);
  const [gpsFix, setGpsFix] = useState<CurrentGpsFix | null>({
    lat: 36.7538,
    lng: 3.0588,
    accuracyM: 4.2,
    timestamp: Date.now(),
  });
  const [isContinuous, setIsContinuous] = useState(false);
  const [isSearchingGps, setIsSearchingGps] = useState(false);

  // Editable cell fields
  const [editMcc, setEditMcc] = useState(String(activeCell.mcc));
  const [editMnc, setEditMnc] = useState(String(activeCell.mnc));
  const [editLac, setEditLac] = useState(String(activeCell.lac));
  const [editCid, setEditCid] = useState(String(activeCell.cid));

  // Initialize and request GPS on mount
  useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;

    async function startLocation() {
      setIsSearchingGps(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const fix: CurrentGpsFix = {
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracyM: loc.coords.accuracy ?? 5,
            timestamp: loc.timestamp,
          };
          setGpsFix(fix);
          managerRef.current.updateGps(fix);
          forceUpdate();

          subscriber = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, distanceInterval: 10 },
            (newLoc) => {
              const updatedFix: CurrentGpsFix = {
                lat: newLoc.coords.latitude,
                lng: newLoc.coords.longitude,
                accuracyM: newLoc.coords.accuracy ?? 5,
                timestamp: newLoc.timestamp,
              };
              setGpsFix(updatedFix);
              managerRef.current.updateGps(updatedFix);
              forceUpdate();
            },
          );
        }
      } catch (err) {
        // Fallback to default Algiers scene coordinates if permission denied
      } finally {
        setIsSearchingGps(false);
      }
    }

    void startLocation();
    managerRef.current.updateCell(activeCell);

    return () => {
      if (subscriber) subscriber.remove();
    };
  }, []);

  const operator = getOperatorInfo(activeCell.mcc, activeCell.mnc);
  const managerState = managerRef.current.getState();

  const handleSelectPreset = (preset: CurrentCellInfo) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setActiveCell(preset);
    setEditMcc(String(preset.mcc));
    setEditMnc(String(preset.mnc));
    setEditLac(String(preset.lac));
    setEditCid(String(preset.cid));
    managerRef.current.updateCell(preset);
    forceUpdate();
  };

  const handleApplyCustomCell = () => {
    const mcc = Number.parseInt(editMcc, 10);
    const mnc = Number.parseInt(editMnc, 10);
    const lac = Number.parseInt(editLac, 10);
    const cid = Number.parseInt(editCid, 10);

    if (!mcc || !mnc || !lac || !cid) {
      Alert.alert("Erreur", "Tous les champs Cell-ID doivent être des entiers valides.");
      return;
    }

    const updated: CurrentCellInfo = {
      mcc,
      mnc,
      lac,
      cid,
      signalDbm: activeCell.signalDbm ?? -75,
    };
    setActiveCell(updated);
    managerRef.current.updateCell(updated);
    forceUpdate();
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  };

  const handleLogPoint = async () => {
    if (!gpsFix) {
      Alert.alert("GPS Inaccessible", "En attente d'un signal GPS valide pour enregistrer le relais.");
      return;
    }

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }

    const logged = managerRef.current.logPoint();
    if (logged) {
      forceUpdate();
      await syncPoint(logged);
    }
  };

  const handleToggleContinuous = (val: boolean) => {
    setIsContinuous(val);
    managerRef.current.setContinuous(val);
    forceUpdate();
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  };

  return (
    <ScrollView className="flex-1 bg-slate-950 px-4 py-4" contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header Badge */}
      <View className="mb-4 flex-row items-center justify-between border-b border-slate-800 pb-3">
        <View>
          <View className="flex-row items-center gap-2">
            <Ionicons name="radio" size={20} color="#38bdf8" />
            <Text className="text-lg font-extrabold text-white">Relevé Cellulaire</Text>
          </View>
          <Text className="text-xs text-slate-400">Cartographie des relais GSM (PRD FR-S4-08)</Text>
          <Text className="text-[11px] text-slate-500" style={{ writingDirection: "rtl" }}>
            مسح وتسجيل أبراج التغطية الخلوية
          </Text>
        </View>

        <View className="rounded-full border border-sky-500/30 bg-sky-950/40 px-2.5 py-1">
          <Text className="text-[10px] font-mono font-bold tracking-wider text-sky-400 uppercase">
            SOURCE = SURVEY
          </Text>
        </View>
      </View>

      {/* Serving Cell Card */}
      <View className="mb-4 rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg">
        <View className="mb-3 flex-row items-center justify-between border-b border-slate-800/80 pb-2">
          <View className="flex-row items-center gap-2">
            <View
              className="size-3 rounded-full"
              style={{ backgroundColor: operator.brandColor }}
            />
            <Text className="text-base font-bold text-white">{operator.name}</Text>
            <Text className="text-xs text-slate-400" style={{ writingDirection: "rtl" }}>
              ({operator.nameAr})
            </Text>
          </View>

          <View className="flex-row items-center gap-1.5 rounded-md bg-slate-800 px-2 py-0.5">
            <MaterialCommunityIcons name="signal-cellular-3" size={14} color="#34d399" />
            <Text className="text-xs font-mono font-semibold text-emerald-400">
              {activeCell.signalDbm ?? -75} dBm
            </Text>
          </View>
        </View>

        {/* Operator Presets (Fast Stage Demo) */}
        <Text className="mb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Opérateurs Démo :
        </Text>
        <View className="mb-4 flex-row gap-2">
          {SURVEY_PRESETS_DZ.map((preset) => {
            const op = getOperatorInfo(preset.mcc, preset.mnc);
            const isSelected = activeCell.mcc === preset.mcc && activeCell.mnc === preset.mnc && activeCell.cid === preset.cid;
            return (
              <Pressable
                key={`${preset.mcc}-${preset.mnc}-${preset.cid}`}
                onPress={() => handleSelectPreset(preset)}
                className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2 ${
                  isSelected ? "border-sky-400 bg-sky-950/60" : "border-slate-800 bg-slate-950/60"
                }`}
              >
                <View className="size-2 rounded-full" style={{ backgroundColor: op.brandColor }} />
                <Text className={`text-xs font-bold ${isSelected ? "text-sky-300" : "text-slate-300"}`}>
                  {op.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Cell Coordinates Inputs */}
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Text className="mb-1 text-[10px] font-mono text-slate-400">MCC</Text>
            <TextInput
              value={editMcc}
              onChangeText={setEditMcc}
              keyboardType="numeric"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-white"
            />
          </View>
          <View className="flex-1">
            <Text className="mb-1 text-[10px] font-mono text-slate-400">MNC</Text>
            <TextInput
              value={editMnc}
              onChangeText={setEditMnc}
              keyboardType="numeric"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-white"
            />
          </View>
          <View className="flex-1">
            <Text className="mb-1 text-[10px] font-mono text-slate-400">LAC</Text>
            <TextInput
              value={editLac}
              onChangeText={setEditLac}
              keyboardType="numeric"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-white"
            />
          </View>
          <View className="flex-1.2">
            <Text className="mb-1 text-[10px] font-mono text-slate-400">CID</Text>
            <TextInput
              value={editCid}
              onChangeText={setEditCid}
              keyboardType="numeric"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-white"
            />
          </View>
        </View>

        <Pressable
          onPress={handleApplyCustomCell}
          className="mt-2.5 self-end rounded-md bg-slate-800 px-3 py-1 active:opacity-70"
        >
          <Text className="text-[11px] font-semibold text-slate-200">Appliquer Cell-ID</Text>
        </Pressable>
      </View>

      {/* GPS Fix Card */}
      <View className="mb-4 rounded-xl border border-slate-800 bg-slate-900/90 p-4">
        <View className="mb-2 flex-row items-center justify-between">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="location" size={16} color="#38bdf8" />
            <Text className="text-xs font-bold text-slate-200 uppercase tracking-wide">
              Position GPS
            </Text>
          </View>

          {isSearchingGps ? (
            <View className="flex-row items-center gap-1">
              <ActivityIndicator size="small" color="#f59e0b" />
              <Text className="text-[10px] font-mono text-amber-400">Acquisition...</Text>
            </View>
          ) : gpsFix ? (
            <View className="rounded bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20">
              <Text className="text-[10px] font-mono font-bold text-emerald-400">FIX 3D (±{gpsFix.accuracyM.toFixed(1)}m)</Text>
            </View>
          ) : (
            <Text className="text-[10px] font-mono text-slate-500">Signal indisponible</Text>
          )}
        </View>

        {gpsFix && (
          <View className="flex-row justify-between rounded-lg bg-slate-950 p-2.5">
            <View>
              <Text className="text-[10px] text-slate-500">Latitude</Text>
              <Text className="text-xs font-mono font-bold text-slate-200">{gpsFix.lat.toFixed(5)}°N</Text>
            </View>
            <View>
              <Text className="text-[10px] text-slate-500">Longitude</Text>
              <Text className="text-xs font-mono font-bold text-slate-200">{gpsFix.lng.toFixed(5)}°E</Text>
            </View>
            <View>
              <Text className="text-[10px] text-slate-500">Précision</Text>
              <Text className="text-xs font-mono font-bold text-emerald-400">±{gpsFix.accuracyM.toFixed(0)} m</Text>
            </View>
          </View>
        )}
      </View>

      {/* Action Controls */}
      <View className="mb-4 gap-3">
        {/* Primary Log Button */}
        <Pressable
          onPress={handleLogPoint}
          disabled={!managerState.canLog || logSurveyMutation.isPending}
          className={`flex-row items-center justify-center gap-2 rounded-xl py-3.5 shadow-lg active:opacity-80 ${
            managerState.canLog && !logSurveyMutation.isPending
              ? "bg-sky-600 shadow-sky-900/30"
              : "bg-slate-800 opacity-60"
          }`}
        >
          {logSurveyMutation.isPending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="cloud-upload" size={18} color="#ffffff" />
          )}
          <Text className="text-sm font-bold text-white">
            Enregistrer ce Relais (Survey Point)
          </Text>
        </Pressable>

        {/* Continuous Drive-Test Mode */}
        <View className="flex-row items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <View className="flex-1 pr-3">
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="speedometer-outline" size={16} color={isContinuous ? "#38bdf8" : "#94a3b8"} />
              <Text className="text-xs font-bold text-slate-200">Mode Relevé Continu</Text>
            </View>
            <Text className="text-[10px] text-slate-400">
              Enregistre automatiquement dès déplacement &gt; 50 mètres.
            </Text>
          </View>
          <Switch
            value={isContinuous}
            onValueChange={handleToggleContinuous}
            trackColor={{ false: "#334155", true: "#0284c7" }}
            thumbColor={isContinuous ? "#38bdf8" : "#94a3b8"}
          />
        </View>
      </View>

      {/* Local Logged Points History */}
      <View className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        <View className="mb-2 flex-row items-center justify-between border-b border-slate-800/80 pb-2">
          <Text className="text-xs font-bold text-slate-300">
            Historique des Relevés ({managerState.loggedPoints.length})
          </Text>
          {managerState.loggedPoints.length > 0 && (
            <Pressable onPress={() => managerRef.current.clearHistory() || forceUpdate()}>
              <Text className="text-[10px] text-slate-500">Effacer</Text>
            </Pressable>
          )}
        </View>

        {managerState.loggedPoints.length === 0 ? (
          <Text className="py-4 text-center text-xs text-slate-500">
            Aucun point relevé dans cette session.
          </Text>
        ) : (
          <View className="gap-2">
            {managerState.loggedPoints.slice(0, 8).map((point) => (
              <View
                key={point.id}
                className="flex-row items-center justify-between rounded-lg border border-slate-800/60 bg-slate-950 p-2"
              >
                <View>
                  <View className="flex-row items-center gap-1.5">
                    <View
                      className="size-2 rounded-full"
                      style={{ backgroundColor: point.operator.brandColor }}
                    />
                    <Text className="text-xs font-mono font-bold text-slate-200">
                      {formatCellId(point)}
                    </Text>
                    <Text className="text-[10px] text-slate-400">({point.operator.name})</Text>
                  </View>
                  <Text className="text-[10px] font-mono text-slate-500">
                    {point.lat.toFixed(4)}°N, {point.lng.toFixed(4)}°E (±{point.accuracyM.toFixed(0)}m)
                  </Text>
                </View>

                <View className="items-end">
                  <View
                    className={`rounded px-1.5 py-0.5 ${
                      point.status === "synced"
                        ? "bg-emerald-500/20"
                        : "bg-amber-500/20"
                    }`}
                  >
                    <Text
                      className={`text-[9px] font-bold ${
                        point.status === "synced" ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {point.status === "synced" ? "SYNCHRONISÉ ✓" : "EN ATTENTE"}
                    </Text>
                  </View>
                  {point.signalDbm && (
                    <Text className="mt-0.5 text-[9px] font-mono text-slate-500">
                      {point.signalDbm} dBm
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
