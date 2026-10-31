import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { getLabels } from "@solvex-dergana/shared";
import * as Location from "expo-location";
import { type Href, router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLocale } from "@/contexts/locale-context";

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

export default function Home() {
  const { locale, setLocale, direction } = useLocale();
  const isAr = locale === "ar";
  const witness = getLabels(locale, "witness");

  const [placeName, setPlaceName] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"searching" | "acquired" | "denied">("searching");

  useEffect(() => {
    let isMounted = true;

    async function detectLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (isMounted) setGpsStatus("denied");
          return;
        }

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!isMounted) return;
        setGpsStatus("acquired");

        try {
          const addrs = await Location.reverseGeocodeAsync({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          if (isMounted && addrs && addrs.length > 0) {
            const a = addrs[0];
            const parts = [a.street, a.city || a.district || a.subregion].filter(Boolean);
            if (parts.length > 0) {
              setPlaceName(parts.join(", "));
              return;
            }
          }
        } catch {
          // Fallback to nearest commune
        }

        if (isMounted) {
          setPlaceName(getNearestCommune(loc.coords.latitude, loc.coords.longitude, isAr));
        }
      } catch {
        if (isMounted) setGpsStatus("denied");
      }
    }

    detectLocation();

    return () => {
      isMounted = false;
    };
  }, [isAr]);

  const toggleLanguage = () => {
    setLocale(isAr ? "fr" : "ar");
  };

  const handleStartEmergency = () => {
    router.push("/emergency" as Href);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#ffffff" }} edges={["top", "bottom"]}>
      {/* Top Header Bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottomWidth: 1,
          borderBottomColor: "#f1f5f9",
          backgroundColor: "#ffffff",
          paddingHorizontal: 20,
          paddingVertical: 14,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: "#dc2626",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="medical" size={20} color="#ffffff" />
          </View>
          <View>
            <Text style={{ fontSize: 16, fontWeight: "900", color: "#0f172a", letterSpacing: -0.3 }}>
              {isAr ? "طوارئ SolveX" : "SolveX Urgence"}
            </Text>
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#dc2626" }}>
              14 / 154
            </Text>
          </View>
        </View>

        {/* Single language toggle button: displays opposite language */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isAr ? "Passer en français" : "التحويل إلى العربية"}
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
            {isAr ? "FR" : "عربي"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: "#ffffff" }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "space-between",
          paddingHorizontal: 20,
          paddingVertical: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Confirmed Location Banner */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#e2e8f0",
            backgroundColor: "#f8fafc",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: "#dcfce7",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="location"
                size={18}
                color={gpsStatus === "denied" ? "#dc2626" : "#16a34a"}
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
                  writingDirection: direction,
                  textAlign: isAr ? "right" : "left",
                }}
              >
                {isAr ? "الموقع الجغرافي المحدد" : "Localisation détectée"}
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "800",
                  color: "#0f172a",
                  marginTop: 2,
                  writingDirection: direction,
                  textAlign: isAr ? "right" : "left",
                }}
                numberOfLines={1}
              >
                {placeName
                  ? placeName
                  : gpsStatus === "acquired"
                    ? isAr
                      ? "باب الزوار، الجزائر (تم التحديد)"
                      : "Bab Ezzouar, Alger (Localisé)"
                    : gpsStatus === "denied"
                      ? isAr
                        ? "يرجى تفعيل الـ GPS لتحديد المكان"
                        : "Veuillez activer le GPS"
                      : isAr
                        ? "جاري تحديد موقعكم تلقائياً..."
                        : "Recherche de votre position..."}
              </Text>
            </View>
          </View>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "500",
              color: "#64748b",
              marginTop: 6,
              writingDirection: direction,
              textAlign: isAr ? "right" : "left",
            }}
          >
            {isAr
              ? "سيتم إرسال هذا الموقع تلقائياً لفرق الحماية والنجدة."
              : "Cette position sera transmise directement avec l'alerte."}
          </Text>
        </View>

        {/* Center Main SOS Button Section */}
        <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 12 }}>
          <Text
            style={{
              fontSize: 22,
              fontWeight: "900",
              color: "#0f172a",
              textAlign: "center",
              writingDirection: direction,
            }}
          >
            {witness.sos_title}
          </Text>
          <Text
            style={{
              fontSize: 13,
              lineHeight: 18,
              color: "#64748b",
              textAlign: "center",
              marginTop: 6,
              maxWidth: 290,
              writingDirection: direction,
            }}
          >
            {witness.sos_help}
          </Text>

          {/* Main Large Red SOS Button - Perfectly proportioned circle with clear glow */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${witness.sos_action} — ${witness.sos_help}`}
            testID="main-sos-button"
            onPress={handleStartEmergency}
            style={{
              width: 196,
              height: 196,
              borderRadius: 98,
              backgroundColor: "#dc2626",
              alignItems: "center",
              justifyContent: "center",
              marginVertical: 20,
              borderWidth: 6,
              borderColor: "#fee2e2",
              shadowColor: "#dc2626",
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.4,
              shadowRadius: 18,
              elevation: 14,
            }}
          >
            <Ionicons name="warning" size={38} color="#ffffff" />
            <Text
              style={{
                fontSize: 44,
                fontWeight: "900",
                letterSpacing: 4,
                color: "#ffffff",
                marginTop: 2,
              }}
            >
              {witness.sos_action}
            </Text>
            <Text
              style={{
                fontSize: 10,
                fontWeight: "800",
                textTransform: "uppercase",
                letterSpacing: 1.4,
                color: "#fee2e2",
                marginTop: 3,
              }}
            >
              {isAr ? "انقر للمساعدة" : "Toucher pour alerter"}
            </Text>
          </Pressable>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
            <Ionicons name="shield-checkmark" size={16} color="#16a34a" />
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                color: "#475569",
                writingDirection: direction,
              }}
            >
              {isAr ? "مسار طوارئ سريع في 3 خطوات" : "Signalement express en 3 étapes"}
            </Text>
          </View>
        </View>

        {/* Emergency Contacts Footer */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#fee2e2",
            backgroundColor: "#fef2f2",
            padding: 14,
            marginTop: 16,
          }}
        >
          <View
            style={{
              flexDirection: isAr ? "row-reverse" : "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View
              style={{
                flexDirection: isAr ? "row-reverse" : "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <MaterialCommunityIcons name="phone-alert" size={18} color="#dc2626" />
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#991b1b" }}>
                {isAr ? "أرقام الطوارئ المباشرة :" : "Numéros d'urgence :"}
              </Text>
            </View>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "900",
                color: "#b91c1c",
                writingDirection: "ltr",
              }}
            >
              14 / 154
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
