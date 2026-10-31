import { useLocale } from "@/contexts/locale-context";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useThemeColor } from "heroui-native";

export default function TabLayout() {
  const { navigation, direction } = useLocale();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorBackground = useThemeColor("background");

  return (
    <Tabs
      screenOptions={{
        
        headerShown: false,
        headerStyle: {
          backgroundColor: themeColorBackground,
        },
        headerTintColor: themeColorForeground,
        headerTitleStyle: {
          color: themeColorForeground,
          fontWeight: "600",
        },
        tabBarStyle: {
          backgroundColor: themeColorBackground,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: navigation.home,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} style={{ color: color ?? themeColorForeground }} />
          ),
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          title: navigation.explore,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} style={{ color: color ?? themeColorForeground }} />
          ),
        }}
      />
    </Tabs>
  );
}
